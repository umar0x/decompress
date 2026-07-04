import unbzip2Stream from 'unbzip2-stream';
import type { ArchiveEntry, ArchivePlugin, PluginArchiveInput, ParseContext } from '../types.ts';
import { parseTarStream } from './tar-common.ts';

async function* parseTarbz2(
  input: PluginArchiveInput,
  _ctx: ParseContext,
): AsyncIterable<ArchiveEntry> {
  yield* parseTarStream(input.stream(), 'tar.bz2', input.signal, unbzip2Stream());
}

export const tarbz2Plugin: ArchivePlugin = {
  name: 'tar.bz2',
  formats: ['tar.bz2', 'tbz2'],
  detect: (buffer: Buffer) =>
    buffer.length >= 3 && buffer[0] === 0x42 && buffer[1] === 0x5a && buffer[2] === 0x68,
  parse: parseTarbz2,
};
