import { Readable, type Transform } from 'node:stream';
import tar from 'tar-stream';
import { AbortError, CorruptArchiveError } from '../errors.ts';
import type { ArchiveEntry, EntryType } from '../types.ts';

type TarHeader = {
  name: string;
  type: string;
  mode: number;
  size: number;
  mtime: Date;
  linkname?: string;
};

type QueuedEntry = {
  entry: ArchiveEntry;
  body: NodeJS.ReadableStream;
  bodyDone: Promise<void>;
  wasClaimed: () => boolean;
};

export async function* parseTarStream(
  inputSource: NodeJS.ReadableStream,
  sourceFormat: string,
  signal: AbortSignal,
  decompressor?: Transform,
): AsyncIterable<ArchiveEntry> {
  const source =
    inputSource instanceof Readable
      ? inputSource
      : Readable.from(inputSource as unknown as AsyncIterable<Buffer | Uint8Array>);
  const extract = tar.extract();
  const queue: QueuedEntry[] = [];
  let finished = false;
  let failure: Error | undefined;
  let wake: (() => void) | undefined;

  const notify = () => {
    wake?.();
    wake = undefined;
  };
  const fail = (error: Error) => {
    failure ??= error;
    notify();
  };

  source.on('error', fail);
  decompressor?.on('error', fail);
  extract.on('error', fail);
  extract.on('finish', () => {
    finished = true;
    notify();
  });

  extract.on('entry', (header: TarHeader, body: NodeJS.ReadableStream, next: () => void) => {
    const type = mapType(header.type);
    if (type === null) {
      body.resume();
      body.once('end', next);
      fail(
        new CorruptArchiveError(
          `unsupported tar entry type ${JSON.stringify(header.type)}: ${header.name}`,
        ),
      );
      return;
    }

    const path = header.name.endsWith('/') ? header.name.slice(0, -1) : header.name;
    let claimed = false;
    let resolveBody!: () => void;
    let rejectBody!: (error: Error) => void;
    const bodyDone = new Promise<void>((resolve, reject) => {
      resolveBody = resolve;
      rejectBody = reject;
    });
    body.once('end', () => {
      resolveBody();
      next();
    });
    body.once('error', (error: Error) => {
      rejectBody(error);
      fail(error);
    });

    const entry: ArchiveEntry = {
      path,
      type,
      size: type === 'directory' ? 0 : header.size,
      mode: header.mode & 0o7777,
      mtime: header.mtime,
      sourceFormat,
    };
    if (type === 'symlink' || type === 'hardlink') {
      entry.linkTarget = header.linkname ?? '';
    } else if (type === 'file') {
      entry.stream = () => {
        if (claimed) throw new CorruptArchiveError(`entry stream consumed more than once: ${path}`);
        claimed = true;
        return body;
      };
    }

    queue.push({ entry, body, bodyDone, wasClaimed: () => claimed });
    notify();
  });

  if (decompressor) source.pipe(decompressor).pipe(extract);
  else source.pipe(extract);

  try {
    while (!finished || queue.length > 0) {
      if (signal.aborted) throw new AbortError(signal.reason);
      if (failure) throw new CorruptArchiveError(failure.message, { cause: failure });

      const queued = queue.shift();
      if (!queued) {
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
        continue;
      }

      yield queued.entry;
      if (!queued.wasClaimed()) queued.body.resume();
      await queued.bodyDone;
    }
    if (failure) throw new CorruptArchiveError(failure.message, { cause: failure });
  } finally {
    source.destroy();
    decompressor?.destroy();
    extract.destroy();
  }
}

function mapType(tarType: string): EntryType | null {
  switch (tarType) {
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
      return null;
  }
}
