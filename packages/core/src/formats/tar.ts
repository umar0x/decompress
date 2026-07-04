import type { ArchiveEntry, ArchivePlugin, PluginArchiveInput, ParseContext } from '../types.ts';
import { parseTarStream } from './tar-common.ts';

async function* parseTar(
  input: PluginArchiveInput,
  _ctx: ParseContext,
): AsyncIterable<ArchiveEntry> {
  yield* parseTarStream(input.stream(), 'tar', input.signal);
}

export const tarPlugin: ArchivePlugin = {
  name: 'tar',
  formats: ['tar'],
  detect: (buffer: Buffer) =>
    buffer.length >= 262 && buffer.slice(257, 262).toString('ascii') === 'ustar',
  parse: parseTar,
};
