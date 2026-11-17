import unbzip2Stream from 'unbzip2-stream';
import type { ArchiveEntry, ArchivePlugin, PluginArchiveInput, ParseContext } from '../types.ts';
import { parseTarStream } from './tar-common.ts';
import { createParallelBz2Stream } from './bz2-parallel.ts';

async function* parseTarbz2(
  input: PluginArchiveInput,
  _ctx: ParseContext,
): AsyncIterable<ArchiveEntry> {
  // File-backed and buffer-backed inputs (which is every input after stream
  // spooling) can use the parallel block decoder; anything structurally
  // unusual falls back to the sequential decoder with unchanged semantics.
  const signal = input.signal;
  const parallel = await createParallelBz2Stream(
    {
      filePath: input.filePath,
      buffer: input.buffer,
      size: input.size ?? 0,
    },
    signal,
  );
  if (parallel !== null) {
    yield* parseTarStream(parallel, 'tar.bz2', signal);
    return;
  }
  yield* parseTarStream(input.stream(), 'tar.bz2', input.signal, unbzip2Stream());
}

export const tarbz2Plugin: ArchivePlugin = {
  name: 'tar.bz2',
  formats: ['tar.bz2', 'tbz2'],
  detect: (buffer: Buffer) =>
    buffer.length >= 3 && buffer[0] === 0x42 && buffer[1] === 0x5a && buffer[2] === 0x68,
  parse: parseTarbz2,
};
