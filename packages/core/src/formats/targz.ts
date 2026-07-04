import { createGunzip } from 'node:zlib';
import type { ArchiveEntry, ArchivePlugin, PluginArchiveInput, ParseContext } from '../types.ts';
import { parseTarStream } from './tar-common.ts';

async function* parseTargz(
  input: PluginArchiveInput,
  _ctx: ParseContext,
): AsyncIterable<ArchiveEntry> {
  yield* parseTarStream(input.stream(), 'tar.gz', input.signal, createGunzip());
}

export const targzPlugin: ArchivePlugin = {
  name: 'tar.gz',
  formats: ['tar.gz', 'tgz'],
  detect: (buffer: Buffer) => buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b,
  parse: parseTargz,
};
