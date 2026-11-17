// Parallel bzip2 decoder. bzip2 streams are a sequence of independently
// compressed blocks; once the block boundaries are known (bit positions of
// each block magic), the blocks can be decoded concurrently and the
// decompressed bytes emitted in order.
//
// Correctness properties, matching the sequential decoder exactly:
//   - every block's CRC is verified by the underlying decoder,
//   - the final stream CRC is folded from the block CRCs and verified,
//   - a truncated or structurally unusual stream is handed to the sequential
//     decoder unchanged (see the fallback rules in bz2-bits.ts).
//
// The only inputs the parallel path accepts are file-backed or buffer-backed
// archives, which is every input shape after input resolution (one-shot
// streams are spooled to a bounded temp file upstream). Memory stays bounded:
// at most (in-flight cap) blocks of at most 900,000 decompressed bytes each
// are held, regardless of archive size.

import { existsSync } from 'node:fs';
import nodePath from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { Readable } from 'node:stream';
import os from 'node:os';
import { AbortError, CorruptArchiveError, TruncatedArchiveError } from '../errors.ts';
import {
  MIN_PARALLEL_BYTES,
  foldStreamCrc,
  openFileRangeReader,
  scanBz2Boundaries,
  type Bz2Boundaries,
} from './bz2-bits.ts';

/** seek-bzip error code for unexpected input EOF (truncation). */
const SEEK_BZIP_EOF = -3;

/** Max concurrently scheduled (not yet emitted) blocks. */
const INFLIGHT_BLOCKS = 6;

type BlockResult = { data: Buffer; crc: number };

function workerEntry(): string | null {
  // Resolve this module's directory across module systems: the CJS build has
  // __filename, the ESM build has import.meta.url (esbuild's CJS shim leaves
  // import.meta.url undefined, hence the __filename path first).
  let here: string | undefined;
  if (typeof __filename === 'string') {
    here = __filename;
  } else if (typeof import.meta.url === 'string') {
    here = fileURLToPath(import.meta.url);
  }
  if (here === undefined) return null;
  const candidates = [
    // Built output: the worker sits next to this file in dist/.
    nodePath.join(nodePath.dirname(here), 'bz2-worker.cjs'),
    // Running from source (tsx): use the built artifact.
    nodePath.resolve(nodePath.dirname(here), '../../dist/bz2-worker.cjs'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export type ParallelBz2Input = {
  filePath?: string;
  buffer?: Buffer;
  size: number;
};

/**
 * Try to build a parallel decode stream for a bzip2 archive. Returns null
 * when the parallel path does not apply (too small, no worker artifact,
 * or a stream shape the sequential decoder should handle).
 *
 * The returned Readable yields the decompressed bytes in order and errors
 * with typed DecompressErrors on any decode failure.
 */
export async function createParallelBz2Stream(
  input: ParallelBz2Input,
  signal: AbortSignal,
): Promise<Readable | null> {
  if (input.size < MIN_PARALLEL_BYTES) return null;
  if (input.filePath === undefined && input.buffer === undefined) return null;
  const entry = workerEntry();
  if (entry === null) return null;
  if (signal.aborted) throw new AbortError(signal);

  const bufferInput = input.buffer;
  const fileReader =
    input.filePath !== undefined ? await openFileRangeReader(input.filePath) : null;
  try {
    const readRange =
      bufferInput !== undefined
        ? async (start: number, end: number) => bufferInput.subarray(start, end)
        : fileReader!.readRange;
    const scan = await scanBz2Boundaries(input.size, readRange);
    if (!scan.ok) return null;
    if (scan.boundaries.blockBits.length < 2) return null;
    const header = Buffer.from(await readRange(0, 4));
    return buildOrderedStream(scan.boundaries, input, header, entry, signal);
  } finally {
    await fileReader?.close();
  }
}

function buildOrderedStream(
  boundaries: Bz2Boundaries,
  input: ParallelBz2Input,
  header: Buffer,
  workerEntryPath: string,
  signal: AbortSignal,
): Readable {
  const { blockBits, eosBit, expectedStreamCrc, totalBytes } = boundaries;
  const nBlocks = blockBits.length;
  const workerCount = Math.max(1, Math.min(4, os.availableParallelism()));

  const workers: Worker[] = [];
  // One promise per block, created at dispatch time so a fast worker can
  // never resolve before the consumer is listening.
  const pending = new Map<
    number,
    { promise: Promise<BlockResult>; resolve: (r: BlockResult) => void; reject: (e: Error) => void }
  >();
  let scheduled = 0;
  let emitted = 0;
  let failed = false;
  let terminated = false;

  const terminate = (): void => {
    if (terminated) return;
    terminated = true;
    for (const w of workers) w.terminate();
  };

  const failAll = (error: Error): void => {
    if (failed) return;
    failed = true;
    for (const [, p] of pending) p.reject(error);
    pending.clear();
    terminate();
  };

  const normalizeError = (message: string, errorCode?: number): Error => {
    if (errorCode === SEEK_BZIP_EOF || /eof/i.test(message)) {
      return new TruncatedArchiveError(`truncated bzip2 stream: ${message}`);
    }
    return new CorruptArchiveError(`invalid bzip2 block: ${message}`);
  };

  const onMessage = (value: {
    jobId: number;
    ok: boolean;
    data?: ArrayBuffer;
    crc?: number;
    message?: string;
    errorCode?: number;
  }): void => {
    // Entries are never removed on completion: the ordered generator reads
    // them after resuming from a yield, by which time the worker may have
    // answered long ago. Re-resolving or rejecting a settled promise is a
    // no-op, so stale entries are harmless.
    const job = pending.get(value.jobId);
    if (job === undefined) return;
    if (value.ok && value.data !== undefined && typeof value.crc === 'number') {
      job.resolve({ data: Buffer.from(value.data), crc: value.crc });
    } else {
      job.reject(normalizeError(value.message ?? 'worker decode failed', value.errorCode));
    }
  };

  const dispatchMore = (): void => {
    if (failed || terminated) return;
    while (scheduled < nBlocks && scheduled - emitted < INFLIGHT_BLOCKS) {
      const i = scheduled++;
      const startBit = blockBits[i]!;
      const endBit = i + 1 < nBlocks ? blockBits[i + 1]! : eosBit;
      const byteStart = Math.floor(startBit / 8);
      const byteEnd = Math.min(totalBytes, Math.floor(endBit / 8) + 1 + 8);
      const bitOffsetInBuffer = 32 + (startBit - byteStart * 8);

      const entry = { promise: null!, resolve: null!, reject: null! } as {
        promise: Promise<BlockResult>;
        resolve: (r: BlockResult) => void;
        reject: (e: Error) => void;
      };
      entry.promise = new Promise<BlockResult>((resolve, reject) => {
        entry.resolve = resolve;
        entry.reject = reject;
      });
      // A block scheduled ahead of the emission point can reject before the
      // ordered generator reaches it; keep the rejection observed so Node
      // never flags it as unhandled. The generator still receives it.
      entry.promise.catch(() => undefined);
      pending.set(i, entry);

      const worker = workers[i % workers.length]!;
      if (input.buffer !== undefined) {
        const payload = Buffer.concat([header, input.buffer.subarray(byteStart, byteEnd)]);
        const arrayBuffer = payload.buffer.slice(
          payload.byteOffset,
          payload.byteOffset + payload.length,
        ) as ArrayBuffer;
        worker.postMessage({ jobId: i, kind: 'buffer', payload: arrayBuffer, bitOffsetInBuffer }, [
          arrayBuffer,
        ]);
      } else {
        worker.postMessage({
          jobId: i,
          kind: 'file',
          filePath: input.filePath!,
          byteStart,
          byteEnd,
          bitOffsetInBuffer,
        });
      }
    }
  };

  async function* ordered(): AsyncGenerator<Buffer> {
    // Spawn workers lazily on first pull so an unused stream costs nothing.
    // execArgv is cleared: the worker is plain prebuilt JavaScript and must
    // not inherit eval-style flags (for example --input-type) from the host
    // process, which workers reject.
    for (let w = 0; w < workerCount; w++) {
      const worker = new Worker(workerEntryPath, { execArgv: [] });
      worker.on('message', onMessage);
      worker.on('error', (error: Error) => {
        failAll(new CorruptArchiveError(`bzip2 worker failed: ${error.message}`));
      });
      worker.on('exit', (code) => {
        if (!terminated && code !== 0) {
          failAll(new CorruptArchiveError(`bzip2 worker exited unexpectedly (code ${code})`));
        }
      });
      workers.push(worker);
    }

    let streamCrc = 0;
    try {
      for (let i = 0; i < nBlocks; i++) {
        if (signal.aborted) throw new AbortError(signal);
        dispatchMore();
        const job = pending.get(i);
        if (job === undefined) {
          throw new CorruptArchiveError('bzip2 decode scheduler lost a block');
        }
        const result = await job.promise;
        emitted = i + 1;
        dispatchMore();
        streamCrc = foldStreamCrc(streamCrc, result.crc);
        yield result.data;
      }
      if (streamCrc !== expectedStreamCrc) {
        throw new CorruptArchiveError(
          `bzip2 stream CRC mismatch (got 0x${streamCrc.toString(16)}, expected 0x${expectedStreamCrc.toString(16)})`,
        );
      }
    } finally {
      const abandoned = new CorruptArchiveError('bzip2 decode abandoned');
      for (const [, p] of pending) p.reject(abandoned);
      pending.clear();
      terminate();
    }
  }

  return Readable.from(ordered());
}
