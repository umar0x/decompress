import { createZstdDecompress, type ZstdDecompress } from 'node:zlib';
import type { ArchiveEntry, ArchivePlugin, PluginArchiveInput, ParseContext } from '../types.ts';
import { parseTarStream } from './tar-common.ts';

// Zstd decompression landed in node:zlib as Stable in Node 22.15 and is
// present on every Node version the CI matrix exercises. Feature-detect so
// the format simply reports "unknown" on older runtimes instead of crashing
// the process on import.
const zstdSupported: boolean = typeof createZstdDecompress === 'function';

async function* parseTarZst(
  input: PluginArchiveInput,
  _ctx: ParseContext,
): AsyncIterable<ArchiveEntry> {
  if (!zstdSupported) {
    throw new Error('tar.zst requires Node 22.15 or later (node:zlib.createZstdDecompress)');
  }
  const decompressor = createZstdDecompress() as ZstdDecompress;
  yield* parseTarStream(input.stream(), 'tar.zst', input.signal, decompressor);
}

export const tarZstdPlugin: ArchivePlugin = {
  name: 'tar.zst',
  formats: ['tar.zst', 'tzst'],
  // Zstd frame magic: 0x28 0xB5 0x2F 0xFD (RFC 8478).
  detect: (buffer: Buffer) =>
    zstdSupported &&
    buffer.length >= 4 &&
    buffer[0] === 0x28 &&
    buffer[1] === 0xb5 &&
    buffer[2] === 0x2f &&
    buffer[3] === 0xfd,
  parse: parseTarZst,
};

export function isTarZstdSupported(): boolean {
  return zstdSupported;
}
