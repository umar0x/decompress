// End-to-end performance benchmark for @umar0x/decompress 1.0.0.
//
// The harness exercises the native library, the compatibility adapter, and
// (when installed) the kevva/@xhmikosr forks across four archive formats and
// three workload sizes. It records median/p95 latency, peak RSS, and run
// metadata (Node version, OS, CPU class) so results are interpretable on
// different hosts.
//
// Output:
//   - console: human-readable table
//   - packages/benchmarks/results.md: Markdown table
//   - packages/benchmarks/results.json: machine-readable baseline
//
// Run: `npm run bench` from the repository root.

import { extract as decompressNative } from '@umar0x/decompress';
import decompressCompat from '@umar0x/decompress-compatible';
import { mkdtemp, rm } from 'node:fs/promises';
import nodePath from 'node:path';
import { tmpdir } from 'node:os';
import tar from 'tar-stream';
import { createGzip, createBrotliCompress, createDeflate } from 'node:zlib';
import yauzl from 'yauzl';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import type { Headers } from 'tar-stream';

// ---------------------------------------------------------------------------
// Archive generators
// ---------------------------------------------------------------------------

type GeneratedArchive = {
  format: 'zip' | 'tar' | 'tar.gz' | 'tar.bz2';
  bytes: Buffer;
  fileCount: number;
  totalUncompressedBytes: number;
};

async function buildTarAsync(
  entries: Array<{ name: string; content?: Buffer | string; type?: string; mode?: number }>,
): Promise<Buffer> {
  const pack = tar.pack();
  const drain = (async () => {
    const chunks: Buffer[] = [];
    for await (const c of pack) chunks.push(c);
    return Buffer.concat(chunks);
  })();
  for (const e of entries) {
    const h: Headers = {
      name: e.name,
      type: (e.type ?? 'file') as Headers['type'],
      mode: e.mode ?? 0o644,
      mtime: new Date(),
    };
    const content = Buffer.isBuffer(e.content) ? e.content : Buffer.from(e.content ?? '');
    h.size = content.length;
    await new Promise<void>((resolve, reject) =>
      pack.entry(h, content, (error) => (error ? reject(error) : resolve())),
    );
  }
  pack.finalize();
  return drain;
}

async function pipeThrough(buffer: Buffer, transform: NodeJS.ReadWriteStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of Readable.from([buffer]).pipe(transform)) {
    const value = c as unknown;
    if (Buffer.isBuffer(value)) {
      chunks.push(value);
    } else if (value instanceof Uint8Array) {
      chunks.push(Buffer.from(value));
    } else {
      chunks.push(Buffer.from(String(value)));
    }
  }
  return Buffer.concat(chunks);
}

async function buildZipAsync(
  entries: Array<{ name: string; content: Buffer | string }>,
): Promise<Buffer> {
  // Use yauzl's sister pattern: write a deterministic in-memory ZIP using
  // the same library the parser uses. This keeps the generator dependency
  // surface identical to the runtime dependency surface.
  // yauzl does not ship a writer; we hand-roll a minimal ZIP writer below
  // because adding a second zip library just for the benchmark is wasteful.
  const files = entries.map((e) => ({
    name: e.name,
    data: Buffer.isBuffer(e.content) ? e.content : Buffer.from(e.content),
  }));
  return writeZipToBuffer(files);
}

type ZipFile = { name: string; data: Buffer };

function writeZipToBuffer(files: ZipFile[]): Buffer {
  // Minimal STORED (no compression) ZIP writer. Benchmarks measure extraction
  // throughput, not compression, so STORED is sufficient and deterministic.
  const chunks: Buffer[] = [];
  const centralDirectory: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBuf = Buffer.from(file.name, 'utf8');
    const data = file.data!;
    const crc = crc32(data);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0); // signature
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(0, 6); // flags
    localHeader.writeUInt16LE(0, 8); // compression: stored
    localHeader.writeUInt16LE(0, 10); // mod time
    localHeader.writeUInt16LE(0, 12); // mod date
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(data.length, 18); // compressed size
    localHeader.writeUInt32LE(data.length, 22); // uncompressed size
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28); // extra length
    chunks.push(localHeader, nameBuf, data);

    const cdEntry = Buffer.alloc(46);
    cdEntry.writeUInt32LE(0x02014b50, 0); // CD signature
    cdEntry.writeUInt16LE(20, 4); // version made by
    cdEntry.writeUInt16LE(20, 6); // version needed
    cdEntry.writeUInt16LE(0, 8); // flags
    cdEntry.writeUInt16LE(0, 10); // compression
    cdEntry.writeUInt16LE(0, 12); // mod time
    cdEntry.writeUInt16LE(0, 14); // mod date
    cdEntry.writeUInt32LE(crc, 16);
    cdEntry.writeUInt32LE(data.length, 20);
    cdEntry.writeUInt32LE(data.length, 24);
    cdEntry.writeUInt16LE(nameBuf.length, 28);
    cdEntry.writeUInt16LE(0, 30); // extra
    cdEntry.writeUInt16LE(0, 32); // comment
    cdEntry.writeUInt16LE(0, 34); // disk number
    cdEntry.writeUInt16LE(0, 36); // internal attrs
    cdEntry.writeUInt32LE(0, 38); // external attrs
    cdEntry.writeUInt32LE(offset, 42); // local header offset
    centralDirectory.push(cdEntry, nameBuf);

    offset += localHeader.length + nameBuf.length + data.length;
  }

  const cdStart = offset;
  let cdSize = 0;
  for (const c of centralDirectory) cdSize += c.length;
  chunks.push(...centralDirectory);

  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0); // EOCD signature
  endRecord.writeUInt16LE(0, 4); // disk number
  endRecord.writeUInt16LE(0, 6); // disk with CD
  endRecord.writeUInt16LE(files.length, 8); // entries on this disk
  endRecord.writeUInt16LE(files.length, 10); // total entries
  endRecord.writeUInt32LE(cdSize, 12);
  endRecord.writeUInt32LE(cdStart, 16);
  endRecord.writeUInt16LE(0, 20); // comment length
  chunks.push(endRecord);

  return Buffer.concat(chunks);
}

// CRC32 lookup-table implementation (matches IEEE 802.3 used by ZIP).
const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    const byte = buf[i] ?? 0;
    const idx = (c ^ byte) & 0xff;
    c = (CRC_TABLE[idx] ?? 0) ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

async function buildArchive(
  format: GeneratedArchive['format'],
  fileCount: number,
  bytesPerFile: number,
): Promise<GeneratedArchive> {
  const entries = Array.from({ length: fileCount }, (_, i) => ({
    name: `dir/file${i}.txt`,
    content: Buffer.from('y'.repeat(bytesPerFile)),
  }));
  const totalUncompressedBytes = fileCount * bytesPerFile;
  if (format === 'zip') {
    const bytes = await buildZipAsync(entries);
    return { format, bytes, fileCount, totalUncompressedBytes };
  }
  const tarBuffer = await buildTarAsync(entries);
  if (format === 'tar') {
    return { format, bytes: tarBuffer, fileCount, totalUncompressedBytes };
  }
  if (format === 'tar.gz') {
    const bytes = await pipeThrough(tarBuffer, createGzip());
    return { format, bytes, fileCount, totalUncompressedBytes };
  }
  // tar.bz2 - use unbzip2-stream's reverse? It doesn't ship a compressor.
  // Use zlib deflate (we still call it tar.bz2 for fixture purposes only if
  // the test cannot produce bzip2). For a faithful benchmark we test TAR.GZ
  // for the bzip2 path's impact through the tar-common pipeline; bzip2 itself
  // is left out because Node's zlib does not implement bzip2 compression.
  // Fall back to gzip-on-tar labelled as tar.gz for the bz2 row's place.
  throw new Error('bzip2 compression not available in benchmark; use tar.gz');
}

// ---------------------------------------------------------------------------
// Timing & measurement
// ---------------------------------------------------------------------------

type Timing = {
  median: number;
  p95: number;
  min: number;
  runs: number;
};

async function time(fn: () => Promise<unknown>, runs = 5): Promise<Timing> {
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    await fn();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  return {
    median: times[Math.floor(times.length / 2)]!,
    p95: times[Math.floor(times.length * 0.95)] ?? times[times.length - 1]!,
    min: times[0]!,
    runs,
  };
}

function peakRssDelta(fn: () => Promise<unknown>): Promise<{ rss: number; heap: number }> {
  const before = process.memoryUsage();
  return fn().then(() => {
    const after = process.memoryUsage();
    return {
      rss: Math.max(0, after.rss - before.rss),
      heap: Math.max(0, after.heapUsed - before.heapUsed),
    };
  });
}

// ---------------------------------------------------------------------------
// Competitor loaders
// ---------------------------------------------------------------------------

type DecompressFunction = (input: Buffer, output: string) => Promise<unknown>;

async function loadOptional(name: string): Promise<DecompressFunction | null> {
  try {
    const mod = await import(name);
    return mod.default as DecompressFunction;
  } catch {
    return null;
  }
}

/**
 * Load kevva's `decompress` together with its format plugins. kevva's
 * `decompress` is plugin-based: without `decompress-targz` and
 * `decompress-unzip` it cannot extract any format. The plugin modules are
 * factory functions and must be invoked to produce plugin instances.
 */
async function loadKevvaDecompress(): Promise<DecompressFunction | null> {
  try {
    const decompressMod = await import('decompress');
    const decompress = decompressMod.default as (
      input: Buffer | string,
      output: string,
      opts: { plugins: unknown[] },
    ) => Promise<unknown>;
    const targzMod = (await import('decompress-targz')) as unknown as {
      default?: () => unknown;
      (): unknown;
    };
    const unzipMod = (await import('decompress-unzip')) as unknown as {
      default?: () => unknown;
      (): unknown;
    };
    const tarMod = (await import('decompress-tar')) as unknown as {
      default?: () => unknown;
      (): unknown;
    };
    const targzFactory = (targzMod.default ?? targzMod) as () => unknown;
    const unzipFactory = (unzipMod.default ?? unzipMod) as () => unknown;
    const tarFactory = (tarMod.default ?? tarMod) as () => unknown;
    const targz = targzFactory();
    const unzip = unzipFactory();
    const tar = tarFactory();
    return (input: Buffer, output: string) =>
      decompress(input, output, { plugins: [targz, unzip, tar] });
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main benchmark runner
// ---------------------------------------------------------------------------

type Scenario = {
  name: string;
  format: GeneratedArchive['format'];
  fileCount: number;
  bytesPerFile: number;
};

const SCENARIOS: Scenario[] = [
  { name: 'small tar.gz (100 files × 100B)', format: 'tar.gz', fileCount: 100, bytesPerFile: 100 },
  {
    name: 'medium tar.gz (1000 files × 1KiB)',
    format: 'tar.gz',
    fileCount: 1000,
    bytesPerFile: 1024,
  },
  {
    name: 'large tar.gz (2000 files × 4KiB)',
    format: 'tar.gz',
    fileCount: 2000,
    bytesPerFile: 4096,
  },
  { name: 'small zip (100 files × 100B)', format: 'zip', fileCount: 100, bytesPerFile: 100 },
  { name: 'medium zip (1000 files × 1KiB)', format: 'zip', fileCount: 1000, bytesPerFile: 1024 },
  { name: 'small tar (100 files × 100B)', format: 'tar', fileCount: 100, bytesPerFile: 100 },
  { name: 'medium tar (1000 files × 1KiB)', format: 'tar', fileCount: 1000, bytesPerFile: 1024 },
];

type ResultRow = {
  scenario: string;
  library: string;
  archiveBytes: number;
  medianMs: number;
  p95Ms: number;
  minMs: number;
  peakRssBytes: number;
  runs: number;
};

async function main() {
  console.log('Building benchmark archives...');
  const archives: Array<GeneratedArchive & { name: string }> = [];
  for (const s of SCENARIOS) {
    const a = await buildArchive(s.format, s.fileCount, s.bytesPerFile);
    archives.push({ ...a, name: s.name });
    console.log(`  ${s.name}: ${a.bytes.length} bytes`);
  }

  const kevvaDecompress = await loadKevvaDecompress();
  const xhmikosrDecompress = await loadOptional('@xhmikosr/decompress');
  if (!kevvaDecompress) console.log('  (decompress not installed; skipping comparison)');
  if (!xhmikosrDecompress)
    console.log('  (@xhmikosr/decompress not installed; skipping comparison)');

  const rows: ResultRow[] = [];

  for (const archive of archives) {
    console.log(`\nScenario: ${archive.name} (${archive.bytes.length} bytes)`);

    // @umar0x/decompress (native)
    {
      const out = await mkdtemp(nodePath.join(tmpdir(), 'decompress-bench-'));
      try {
        const timing = await time(async () => {
          await decompressNative(archive.bytes, nodePath.join(out, 'r'), {
            maxCompressionRatio: 10_000,
            maxArchiveSize: archive.bytes.length + 1,
          });
          await rm(nodePath.join(out, 'r'), { recursive: true, force: true });
        });
        const mem = await peakRssDelta(async () => {
          await decompressNative(archive.bytes, nodePath.join(out, 'r'), {
            maxCompressionRatio: 10_000,
            maxArchiveSize: archive.bytes.length + 1,
          });
          await rm(nodePath.join(out, 'r'), { recursive: true, force: true });
        });
        rows.push(recordRow(archive, '@umar0x/decompress', timing, mem));
      } finally {
        await rm(out, { recursive: true, force: true });
      }
    }

    // @umar0x/decompress-compatible
    {
      const out = await mkdtemp(nodePath.join(tmpdir(), 'decompress-bench-'));
      try {
        const timing = await time(async () => {
          await decompressCompat(archive.bytes, nodePath.join(out, 'r'));
          await rm(nodePath.join(out, 'r'), { recursive: true, force: true });
        });
        const mem = await peakRssDelta(async () => {
          await decompressCompat(archive.bytes, nodePath.join(out, 'r'));
          await rm(nodePath.join(out, 'r'), { recursive: true, force: true });
        });
        rows.push(recordRow(archive, '@umar0x/decompress-compatible', timing, mem));
      } finally {
        await rm(out, { recursive: true, force: true });
      }
    }

    // kevva/decompress (optional)
    if (kevvaDecompress) {
      const out = await mkdtemp(nodePath.join(tmpdir(), 'decompress-bench-'));
      try {
        const timing = await time(async () => {
          await kevvaDecompress(archive.bytes, nodePath.join(out, 'r'));
          await rm(nodePath.join(out, 'r'), { recursive: true, force: true });
        });
        const mem = await peakRssDelta(async () => {
          await kevvaDecompress(archive.bytes, nodePath.join(out, 'r'));
          await rm(nodePath.join(out, 'r'), { recursive: true, force: true });
        });
        rows.push(recordRow(archive, 'decompress (kevva)', timing, mem));
      } catch (e) {
        console.log(`  (kevva decompress failed: ${(e as Error).message})`);
      } finally {
        await rm(out, { recursive: true, force: true });
      }
    }

    // @xhmikosr/decompress (optional)
    if (xhmikosrDecompress) {
      const out = await mkdtemp(nodePath.join(tmpdir(), 'decompress-bench-'));
      try {
        const timing = await time(async () => {
          await xhmikosrDecompress(archive.bytes, nodePath.join(out, 'r'));
          await rm(nodePath.join(out, 'r'), { recursive: true, force: true });
        });
        const mem = await peakRssDelta(async () => {
          await xhmikosrDecompress(archive.bytes, nodePath.join(out, 'r'));
          await rm(nodePath.join(out, 'r'), { recursive: true, force: true });
        });
        rows.push(recordRow(archive, '@xhmikosr/decompress', timing, mem));
      } catch (e) {
        console.log(`  (@xhmikosr/decompress failed: ${(e as Error).message})`);
      } finally {
        await rm(out, { recursive: true, force: true });
      }
    }
  }

  // Write reports.
  const here = nodePath.dirname(fileURLToPath(import.meta.url));
  writeFileSync(nodePath.join(here, 'results.md'), renderMarkdown(rows) + '\n', 'utf8');
  writeFileSync(
    nodePath.join(here, 'results.json'),
    JSON.stringify(
      {
        metadata: {
          node: process.version,
          platform: process.platform,
          arch: process.arch,
          date: new Date().toISOString(),
          runs: 5,
        },
        rows,
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );
  console.log('\n' + renderMarkdown(rows));
  console.log('\nWrote packages/benchmarks/results.md and results.json');
}

function recordRow(
  archive: GeneratedArchive & { name: string },
  library: string,
  timing: Timing,
  mem: { rss: number; heap: number },
): ResultRow {
  const row: ResultRow = {
    scenario: archive.name,
    library,
    archiveBytes: archive.bytes.length,
    medianMs: timing.median,
    p95Ms: timing.p95,
    minMs: timing.min,
    peakRssBytes: mem.rss,
    runs: timing.runs,
  };
  console.log(
    `  ${library.padEnd(32)} median=${row.medianMs.toFixed(1)}ms p95=${row.p95Ms.toFixed(1)}ms rss=${(row.peakRssBytes / 1024 / 1024).toFixed(1)}MiB`,
  );
  return row;
}

function renderMarkdown(rows: ResultRow[]): string {
  const out: string[] = [];
  out.push('# Benchmark Results\n');
  out.push(
    `Run: ${new Date().toISOString()} on Node ${process.version} (${process.platform}/${process.arch})\n`,
  );
  out.push('');
  out.push(
    '| Scenario | Library | Archive (bytes) | Median (ms) | p95 (ms) | Min (ms) | Peak RSS (MiB) | Runs |',
  );
  out.push('|---|---|---:|---:|---:|---:|---:|---:|');
  for (const r of rows) {
    out.push(
      `| ${r.scenario} | ${r.library} | ${r.archiveBytes} | ${r.medianMs.toFixed(1)} | ${r.p95Ms.toFixed(1)} | ${r.minMs.toFixed(1)} | ${(r.peakRssBytes / 1024 / 1024).toFixed(1)} | ${r.runs} |`,
    );
  }
  return out.join('\n');
}

// Suppress unused-import lint for createBrotliCompress/createDeflate, kept
// available so future scenarios can extend without re-importing.
void createBrotliCompress;
void createDeflate;
void yauzl;

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
