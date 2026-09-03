import { parseArgs } from 'node:util';
import { extract, listArchive, auditArchive } from '@umar0x/decompress';
import { isDecompressError } from '@umar0x/decompress';
import type { ExtractOptions, SizeInput } from '@umar0x/decompress';

const HELP = `decompress - secure archive extraction for Node.js

Usage:
  decompress extract <archive> [output] [options]
  decompress list    <archive> [options]
  decompress audit   <archive> [options]
  decompress --version
  decompress --help

Commands:
  extract   Extract <archive> into [output] (default: ./<archive-without-ext>)
  list      List entries in <archive> (JSON to stdout)
  audit     Audit <archive> for suspicious entries (JSON to stderr; exit 1 if findings)

Options:
  --strip <n>                 Strip N leading path segments
  --allow-symlinks            Allow symlink entries (default: refuse)
  --allow-hardlinks           Allow hardlink entries (default: refuse)
  --preserve-permissions      Preserve archive mode bits (still strips SUID/SGID/sticky)
  --overwrite                 Overwrite existing output directory
  --max-files <n>             Max entries (default: 10000)
  --max-total-size <size>     Max total extracted size (default: 2gb)
  --max-entry-size <size>     Max single entry size (default: 512mb)
  --max-archive-size <size>   Max input archive size (default: 512mb)
  --max-depth <n>             Max path depth (default: 128)
  --max-compression-ratio <n> Max compression ratio (default: 100)
  --concurrency <n>           Max entries written in parallel (default: 8)
  --pretty                    Pretty-print JSON output (list/audit)
  --help, -h                  Show this help
  --version, -v               Show version

Size strings: 512mb, 2gb, 1.5gib, 1024, 100kb (kb=1000, kib=1024)
Exit codes: 0=success, 1=policy/error, 2=usage error, 130=SIGINT
`;

function parseCliArgs(argv: string[]) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      strip: { type: 'string', short: 's' },
      'allow-symlinks': { type: 'boolean' },
      'allow-hardlinks': { type: 'boolean' },
      'preserve-permissions': { type: 'boolean' },
      overwrite: { type: 'boolean' },
      'max-files': { type: 'string' },
      'max-total-size': { type: 'string' },
      'max-entry-size': { type: 'string' },
      'max-archive-size': { type: 'string' },
      'max-depth': { type: 'string' },
      'max-compression-ratio': { type: 'string' },
      concurrency: { type: 'string' },
      pretty: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  });
  return { values, positionals };
}

function toNumber(v: string | undefined): number | undefined {
  return v !== undefined ? Number(v) : undefined;
}

function toSize(v: string | undefined): SizeInput | undefined {
  return v;
}

function buildExtractOpts(values: Record<string, unknown>): ExtractOptions {
  const opts: ExtractOptions = {};
  if (values.strip !== undefined) opts.strip = Number(values.strip);
  if (values['allow-symlinks']) opts.allowSymlinks = true;
  if (values['allow-hardlinks']) opts.allowHardlinks = true;
  if (values['preserve-permissions']) opts.preservePermissions = true;
  if (values.overwrite) opts.overwrite = true;
  if (values['max-files'] !== undefined) opts.maxFiles = toNumber(values['max-files'] as string)!;
  if (values['max-total-size'] !== undefined)
    opts.maxTotalSize = toSize(values['max-total-size'] as string)!;
  if (values['max-entry-size'] !== undefined)
    opts.maxEntrySize = toSize(values['max-entry-size'] as string)!;
  if (values['max-archive-size'] !== undefined)
    opts.maxArchiveSize = toSize(values['max-archive-size'] as string)!;
  if (values['max-depth'] !== undefined) opts.maxDepth = toNumber(values['max-depth'] as string)!;
  if (values.concurrency !== undefined) opts.concurrency = toNumber(values.concurrency as string)!;
  if (values['max-compression-ratio'] !== undefined)
    opts.maxCompressionRatio = toNumber(values['max-compression-ratio'] as string)!;
  return opts;
}

async function main(argv = process.argv.slice(2)): Promise<number> {
  if (argv.length === 0) {
    process.stderr.write(HELP);
    return 2;
  }

  const { values, positionals } = parseCliArgs(argv);

  if (values.help) {
    process.stdout.write(HELP);
    return 0;
  }
  if (values.version) {
    const pkg = (await import('../package.json', { with: { type: 'json' } })) as {
      default: { version: string };
    };
    process.stdout.write(`${pkg.default.version}\n`);
    return 0;
  }

  const command = positionals[0];
  const archive = positionals[1];

  if (!command || !archive) {
    process.stderr.write(`Error: command and archive required\n\n${HELP}`);
    return 2;
  }

  const pretty = values.pretty ? 2 : 0;

  // Install SIGINT handler.
  const ac = new AbortController();
  const onSigint = () => {
    ac.abort();
  };
  process.once('SIGINT', onSigint);

  try {
    if (command === 'extract') {
      const output = positionals[2] ?? defaultOutput(archive);
      const opts = buildExtractOpts(values);
      opts.signal = ac.signal;
      const result = await extract(archive, output, opts);
      process.stderr.write(
        `extracted ${result.entries.length} entries (${result.totalBytes} bytes) to ${result.output} in ${result.durationMs}ms\n`,
      );
      return 0;
    } else if (command === 'list') {
      const common = buildExtractOpts(values);
      const entries = await listArchive(archive, {
        signal: ac.signal,
        maxFiles: common.maxFiles,
        maxArchiveSize: common.maxArchiveSize,
      });
      process.stdout.write(JSON.stringify(entries, null, pretty) + '\n');
      return 0;
    } else if (command === 'audit') {
      const common = buildExtractOpts(values);
      const report = await auditArchive(archive, {
        signal: ac.signal,
        maxFiles: common.maxFiles,
        maxTotalSize: common.maxTotalSize,
        maxEntrySize: common.maxEntrySize,
        maxArchiveSize: common.maxArchiveSize,
        maxDepth: common.maxDepth,
        maxCompressionRatio: common.maxCompressionRatio,
        allowSymlinks: common.allowSymlinks,
        allowHardlinks: common.allowHardlinks,
      });
      process.stdout.write(JSON.stringify(report, null, pretty) + '\n');
      return report.riskLevel === 'critical' || report.riskLevel === 'high' ? 1 : 0;
    } else {
      process.stderr.write(`Error: unknown command "${command}"\n\n${HELP}`);
      return 2;
    }
  } catch (e) {
    if (ac.signal.aborted) {
      process.stderr.write('error: extraction aborted\n');
      return 130;
    }
    if (isDecompressError(e)) {
      process.stderr.write(`error: ${e.code}: ${e.message}\n`);
      return 1;
    }
    process.stderr.write(`error: ${(e as Error).message}\n`);
    return 1;
  } finally {
    process.removeListener('SIGINT', onSigint);
  }
}

function defaultOutput(archive: string): string {
  // Strip extension: foo.tar.gz → foo, bar.zip → bar
  const base = archive.replace(/\.(tar\.gz|tar\.bz2|tar|tgz|tbz2|zip)$/i, '');
  return base || 'output';
}

export { main, defaultOutput, parseCliArgs, buildExtractOpts };
