import type {
  ArchiveEntry,
  ArchivePlugin,
  PluginArchiveInput,
  ParseContext,
  EntryType,
} from '../types.ts';

type LegacyEntry = {
  path: string;
  type?: string;
  data?: Buffer;
  mode?: number;
  mtime?: Date;
  linkname?: string;
};

type LegacyPlugin = (input: Buffer, opts: unknown) => Promise<LegacyEntry[]>;

function mapLegacyType(t: string | undefined): EntryType {
  switch (t) {
    case 'file':
    case 'contiguous-file':
      return 'file';
    case 'directory':
      return 'directory';
    case 'symlink':
      return 'symlink';
    case 'link':
      return 'hardlink';
    default:
      return 'file';
  }
}

/**
 * Wrap a legacy-shape plugin into the new ArchivePlugin interface.
 * The legacy callback receives the archive buffer and compatibility flags, but
 * no output path or writer. Every emitted entry is revalidated before writing.
 */
export function wrapLegacyPlugin(name: string, legacyPlugin: LegacyPlugin): ArchivePlugin {
  return {
    name,
    formats: ['*'],
    parse: async function* (
      input: PluginArchiveInput,
      ctx: ParseContext,
    ): AsyncIterable<ArchiveEntry> {
      ctx.warn(
        'legacy_plugin_used',
        `legacy plugin ${name} buffers the complete archive and executes with process privileges`,
      );
      const archiveBuffer = input.buffer ?? (await readStream(input.stream()));
      // Legacy plugins receive only compatibility flags.
      const sanitizedOpts: Record<string, unknown> = {
        strip: 0,
      };
      const entries = await legacyPlugin(archiveBuffer, sanitizedOpts);
      for (const e of entries) {
        const ae: ArchiveEntry = {
          path: e.path,
          type: mapLegacyType(e.type),
          size: e.data?.length ?? 0,
          mode: e.mode ?? 0,
          mtime: e.mtime,
          sourceFormat: name,
          linkTarget: e.linkname,
          buffer: e.data ? () => Promise.resolve(e.data!) : undefined,
        };
        yield ae;
      }
    },
  };
}

async function readStream(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const value of stream) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value as unknown as Uint8Array);
    chunks.push(chunk);
    size += chunk.length;
  }
  return Buffer.concat(chunks, size);
}
