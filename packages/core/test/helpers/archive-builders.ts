// Shared archive builders for security regression suites. Kept tiny: tar
// buffers with declared modes and mtimes, plus gzip/zstd wrappers.

import { createRequire } from 'node:module';
import { gzipSync } from 'node:zlib';

const requireCore = createRequire(import.meta.url);
const tar = requireCore('tar-stream');

export type TarEntrySpec = {
  name: string;
  type?: 'file' | 'directory' | 'symlink' | 'link';
  mode?: number;
  mtime?: Date;
  linkname?: string;
  content?: Buffer | string;
};

/** Build a raw (uncompressed) TAR buffer from entry specs. */
export async function buildTarBuffer(entries: TarEntrySpec[]): Promise<Buffer> {
  const pack = tar.pack();
  const drain = (async () => {
    const chunks: Buffer[] = [];
    for await (const c of pack) chunks.push(Buffer.from(c));
    return Buffer.concat(chunks);
  })();
  for (const e of entries) {
    const content =
      typeof e.content === 'string' ? Buffer.from(e.content) : (e.content ?? Buffer.alloc(0));
    const type = e.type ?? 'file';
    const isMeta = type === 'directory' || type === 'symlink' || type === 'link';
    await new Promise<void>((resolve, reject) => {
      pack.entry(
        {
          name: e.name,
          type,
          mode: e.mode ?? 0o644,
          mtime: e.mtime ?? new Date('2026-01-01T00:00:00Z'),
          linkname: e.linkname,
          size: isMeta ? 0 : content.length,
        },
        isMeta ? undefined : content,
        (error: Error | null | undefined) => (error ? reject(error) : resolve()),
      );
    });
  }
  pack.finalize();
  return drain;
}

export function gzipBuffer(buf: Buffer): Buffer {
  return gzipSync(buf);
}
