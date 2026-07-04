import { createReadStream } from 'node:fs';
import { mkdtemp, open, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import nodePath from 'node:path';
import { Readable } from 'node:stream';
import type { ArchiveInput } from './types.ts';
import {
  AbortError,
  ArchiveNotFoundError,
  ArchiveSizeExceededError,
  InvalidInputError,
} from './errors.ts';

export type ResolvedInput = {
  buffer: Buffer | undefined;
  filePath: string | undefined;
  size: number;
  peek: Buffer;
  stream: () => NodeJS.ReadableStream;
  cleanup: () => Promise<void>;
};

export type ResolveInputOptions = {
  maxArchiveSize: number;
  signal?: AbortSignal;
  peekBytes?: number;
};

/**
 * Resolve input without unbounded heap buffering. File paths remain file-backed,
 * caller Buffers remain in memory, and one-shot streams are copied into a private,
 * bounded spool file so random-access parsers can safely consume them.
 */
export async function resolveInput(
  input: ArchiveInput,
  options: ResolveInputOptions,
): Promise<ResolvedInput> {
  const peekBytes = options.peekBytes ?? 512;
  checkAbort(options.signal);

  if (typeof input === 'string') {
    let st;
    try {
      st = await stat(input);
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') throw new ArchiveNotFoundError(`archive not found: ${input}`);
      throw e;
    }
    if (!st.isFile()) {
      throw new InvalidInputError(`input path is not a regular file: ${input}`);
    }
    checkSize(st.size, options.maxArchiveSize);
    const peek = await readPrefix(input, peekBytes);
    return {
      buffer: undefined,
      filePath: input,
      size: st.size,
      peek,
      stream: () => createReadStream(input),
      cleanup: async () => {},
    };
  }

  if (Buffer.isBuffer(input)) {
    checkSize(input.length, options.maxArchiveSize);
    return {
      buffer: input,
      filePath: undefined,
      size: input.length,
      peek: input.subarray(0, peekBytes),
      stream: () => Readable.from([input]),
      cleanup: async () => {},
    };
  }

  return spoolInput(input, options, peekBytes);
}

async function spoolInput(
  input: Exclude<ArchiveInput, string | Buffer>,
  options: ResolveInputOptions,
  peekBytes: number,
): Promise<ResolvedInput> {
  const root = await mkdtemp(nodePath.join(tmpdir(), 'decompress-input-'));
  const filePath = nodePath.join(root, 'archive.bin');
  const fh = await open(filePath, 'wx', 0o600);
  let size = 0;
  const peekChunks: Buffer[] = [];
  let peekLength = 0;

  try {
    for await (const value of toAsyncIterable(input)) {
      checkAbort(options.signal);
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      size += chunk.length;
      checkSize(size, options.maxArchiveSize);
      if (peekLength < peekBytes) {
        const part = chunk.subarray(0, peekBytes - peekLength);
        peekChunks.push(part);
        peekLength += part.length;
      }
      await writeAll(fh, chunk);
    }
  } catch (error) {
    await fh.close().catch(() => {});
    await rm(root, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
  await fh.close();

  let cleaned = false;
  return {
    buffer: undefined,
    filePath,
    size,
    peek: Buffer.concat(peekChunks, peekLength),
    stream: () => createReadStream(filePath),
    cleanup: async () => {
      if (cleaned) return;
      cleaned = true;
      await rm(root, { recursive: true, force: true });
    },
  };
}

function toAsyncIterable(
  input: Exclude<ArchiveInput, string | Buffer>,
): AsyncIterable<Buffer | Uint8Array> {
  if (typeof (input as AsyncIterable<Buffer | Uint8Array>)[Symbol.asyncIterator] === 'function') {
    return input as AsyncIterable<Buffer | Uint8Array>;
  }
  if (typeof (input as ReadableStream<Uint8Array>).getReader === 'function') {
    return Readable.fromWeb(input as ReadableStream<Uint8Array>);
  }
  return Readable.from(input as unknown as Iterable<Buffer | Uint8Array>);
}

async function readPrefix(filePath: string, length: number): Promise<Buffer> {
  const fh = await open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await fh.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

async function writeAll(
  fh: {
    write(buffer: Buffer, offset?: number, length?: number): Promise<{ bytesWritten: number }>;
  },
  buffer: Buffer,
): Promise<void> {
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesWritten } = await fh.write(buffer, offset, buffer.length - offset);
    if (bytesWritten <= 0) throw new InvalidInputError('failed to spool archive input');
    offset += bytesWritten;
  }
}

function checkSize(size: number, maxArchiveSize: number): void {
  if (size > maxArchiveSize) throw new ArchiveSizeExceededError(size, maxArchiveSize);
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new AbortError(signal.reason);
}
