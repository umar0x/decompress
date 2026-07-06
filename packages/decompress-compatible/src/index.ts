import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import nodePath from 'node:path';
import type {
  ArchiveInput,
  ArchivePlugin,
  Entry,
  ExtractOptions,
  Warning,
} from '@umar0x/decompress';
import { extract, LegacyPluginNotEnabledError } from '@umar0x/decompress';

export type DecompressEntry = {
  data: Buffer;
  mode: number;
  mtime: Date;
  path: string;
  type: 'file' | 'directory' | 'symlink' | 'link';
  linkname?: string;
  rawMode?: number;
  rawPath?: string;
  disposition?: 'extracted' | 'skipped' | 'renamed';
};

export type DecompressOptions = {
  plugins?: unknown[];
  strip?: number;
  filter?: (file: DecompressEntry) => boolean;
  map?: (file: DecompressEntry) => DecompressEntry;
  legacyPluginUnsafe?: boolean;
  allowSymlinks?: boolean;
  allowHardlinks?: boolean;
  symlinkFallback?: 'error' | 'hardlink' | 'skip';
  preservePermissions?: boolean;
  overwrite?: boolean;
  maxFiles?: number;
  maxTotalSize?: string | number;
  maxEntrySize?: string | number;
  maxDepth?: number;
  maxArchiveSize?: string | number;
  maxCompressionRatio?: number;
  signal?: AbortSignal;
  onEntry?: (entry: DecompressEntry) => void;
  onWarning?: (warning: Warning) => void;
};

export async function decompress(
  input: string | Buffer,
  output?: string | DecompressOptions,
  opts?: DecompressOptions,
): Promise<DecompressEntry[]> {
  if (typeof input !== 'string' && !Buffer.isBuffer(input)) {
    throw new TypeError('Input file required');
  }

  const realOutput = typeof output === 'string' ? output : undefined;
  const realOpts =
    output !== undefined && typeof output === 'object' ? { ...output, ...opts } : (opts ?? {});
  if (realOpts.plugins?.length && !realOpts.legacyPluginUnsafe) {
    throw new LegacyPluginNotEnabledError(
      'Legacy plugins require legacyPluginUnsafe: true. See MIGRATION.md.',
    );
  }
  if (
    realOpts.strip !== undefined &&
    (!Number.isSafeInteger(realOpts.strip) || realOpts.strip < 0)
  ) {
    throw new TypeError('strip must be a non-negative integer');
  }

  const root = await mkdtemp(nodePath.join(tmpdir(), 'decompress-compat-'));
  const parsedOutput = nodePath.join(root, 'parsed');
  try {
    const parsed = await extract(input as ArchiveInput, parsedOutput, {
      ...baseOptions(realOpts),
      plugins: realOpts.plugins as ExtractOptions['plugins'],
      legacyPluginUnsafe: realOpts.legacyPluginUnsafe,
      overwrite: false,
    });

    let entries: DecompressEntry[] = [];
    for (const entry of parsed.entries) {
      const compatEntry = await readCompatEntry(parsed.output, entry);
      compatEntry.path = stripPath(compatEntry.path, realOpts.strip ?? 0);
      if (compatEntry.path !== '') entries.push(compatEntry);
    }
    if (realOpts.filter) entries = entries.filter(realOpts.filter);
    if (realOpts.map) entries = entries.map((entry) => realOpts.map!({ ...entry }));

    if (!realOutput) return entries;

    const replayPlugin: ArchivePlugin = {
      name: 'compat-replay',
      formats: ['compat-replay'],
      detect: () => true,
      parse: async function* () {
        for (const entry of entries) {
          yield {
            path: entry.path,
            type: entry.type === 'link' ? 'hardlink' : entry.type,
            size: entry.type === 'file' ? entry.data.length : 0,
            mode: entry.mode,
            mtime: entry.mtime,
            linkTarget: entry.linkname,
            sourceFormat: 'compat-replay',
            buffer: entry.type === 'file' ? async () => entry.data : undefined,
          };
        }
      },
    };
    const written = await extract(Buffer.from('compat-replay'), realOutput, {
      ...baseOptions(realOpts),
      plugins: [replayPlugin],
      overwrite: realOpts.overwrite,
      maxArchiveSize: Number.MAX_SAFE_INTEGER,
      maxCompressionRatio: Number.MAX_VALUE,
    });
    const outputEntries = written.entries.map((entry, index) =>
      toDecompressEntry(entry, entries[index]?.data ?? Buffer.alloc(0)),
    );
    for (const entry of outputEntries) realOpts.onEntry?.(entry);
    return outputEntries;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

export default decompress;

function baseOptions(options: DecompressOptions): ExtractOptions {
  return {
    allowSymlinks: options.allowSymlinks,
    allowHardlinks: options.allowHardlinks,
    symlinkFallback: options.symlinkFallback,
    preservePermissions: options.preservePermissions,
    maxFiles: options.maxFiles,
    maxTotalSize: options.maxTotalSize,
    maxEntrySize: options.maxEntrySize,
    maxDepth: options.maxDepth,
    maxArchiveSize: options.maxArchiveSize,
    maxCompressionRatio: options.maxCompressionRatio,
    signal: options.signal,
    onWarning: options.onWarning,
  };
}

async function readCompatEntry(output: string, entry: Entry): Promise<DecompressEntry> {
  const data =
    entry.type === 'file' ? await readFile(nodePath.join(output, entry.path)) : Buffer.alloc(0);
  return toDecompressEntry(entry, data);
}

function toDecompressEntry(entry: Entry, data: Buffer): DecompressEntry {
  return {
    data,
    mode: entry.mode,
    mtime: entry.mtime ?? new Date(0),
    path: entry.path,
    type: entry.type === 'hardlink' ? 'link' : entry.type,
    linkname: entry.linkTarget ?? undefined,
    rawMode: entry.rawMode,
    rawPath: entry.rawPath,
    disposition: entry.disposition,
  };
}

function stripPath(path: string, count: number): string {
  if (count === 0) return path;
  const segments = path.split(/[\\/]/);
  return segments.length <= count ? '' : segments.slice(count).join('/');
}
