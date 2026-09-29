import { Readable, type Transform } from 'node:stream';
import tar from 'tar-stream';
import {
  AbortError,
  CorruptArchiveError,
  TruncatedArchiveError,
  isDecompressError,
} from '../errors.ts';
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
    let bodyEnded = false;
    let resolveBody!: () => void;
    let rejectBody!: (error: Error) => void;
    const bodyDone = new Promise<void>((resolve, reject) => {
      resolveBody = resolve;
      rejectBody = reject;
    });
    // The main loop consumes bodyDone lazily (only when the consumer asks for
    // the next entry), so a premature rejection can sit unobserved until then.
    // Attach a no-op rejection handler so Node never flags it as unhandled;
    // later awaiters still receive the rejection.
    bodyDone.catch(() => undefined);
    body.once('end', () => {
      bodyEnded = true;
      resolveBody();
      next();
    });
    body.once('error', (error: Error) => {
      bodyEnded = true;
      rejectBody(error);
      fail(error);
    });
    // A claimed body that is destroyed before it ends (for example when a
    // writer abandons it after a failed write) must fail the drain instead of
    // leaving it pending forever: the queue cannot advance past an entry whose
    // bodyDone never settles, and that was the 1.0.3 pool deadlock. The
    // rejection is marked collateral: the write failure that caused the
    // abandonment is the primary error, and the pool demotes marked errors
    // whenever an unmarked failure exists.
    body.once('close', () => {
      if (bodyEnded) return;
      const error = new Error(`entry body closed before completion: ${path}`);
      (error as { collateralUnwind?: boolean }).collateralUnwind = true;
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
      if (failure) throw classifyParseFailure(failure);

      const queued = queue.shift();
      if (!queued) {
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
        continue;
      }

      yield queued.entry;
      if (!queued.wasClaimed()) {
        // A stream already destroyed upstream (truncation during a previous
        // entry) throws synchronously on resume; classify instead of letting
        // the raw ERR_STREAM_DESTROYED escape the typed-error contract.
        try {
          queued.body.resume();
        } catch (error) {
          throw classifyParseFailure(failure ?? error);
        }
      }
      try {
        await queued.bodyDone;
      } catch (error) {
        // The body failed on its own or was destroyed by the writer after a
        // failed write. Either way the failure is already typed or must not
        // be re-wrapped here (for example an injected EFBIG/EACCES fs error).
        throw classifyParseFailure(error);
      }
    }
    if (failure) throw classifyParseFailure(failure);
  } finally {
    source.destroy();
    decompressor?.destroy();
    extract.destroy();
  }
}

/**
 * Classify a parser- or body-level failure into the typed error contract.
 * DecompressErrors and writer-injected fs errors surface unchanged; messages
 * that indicate truncation map to TruncatedArchiveError; everything else is a
 * corrupt archive. Without this, raw tar-stream errors ("Unexpected end of
 * data") escape as plain Errors.
 */
function classifyParseFailure(error: unknown): Error {
  if (error instanceof Error) {
    if (isDecompressError(error)) return error;
    if ((error as { injectedByWriter?: boolean }).injectedByWriter) return error;
    const collateral = (error as { collateralUnwind?: boolean }).collateralUnwind === true;
    const message = error.message ?? String(error);
    const classified = /end of data|truncated|premature|unexpected end/i.test(message)
      ? new TruncatedArchiveError(message, { cause: error })
      : new CorruptArchiveError(message, { cause: error });
    if (collateral) (classified as { collateralUnwind?: boolean }).collateralUnwind = true;
    return classified;
  }
  return new CorruptArchiveError(String(error));
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
