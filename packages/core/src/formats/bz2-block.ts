// Single-block bzip2 decode job, shared by the worker entry point and the
// test suite. Runs in the worker thread during extraction.

import { open } from 'node:fs/promises';
import seekBzip from 'seek-bzip';
import { bz2Crc32 } from './bz2-bits.ts';

export type FileJob = {
  jobId: number;
  kind: 'file';
  filePath: string;
  byteStart: number;
  byteEnd: number;
  /** Bit offset of the block magic within the payload buffer (after the 4-byte header). */
  bitOffsetInBuffer: number;
};

export type BufferJob = {
  jobId: number;
  kind: 'buffer';
  /** Header (4 bytes) + block bytes, transferred from the main thread. */
  payload: ArrayBuffer;
  bitOffsetInBuffer: number;
};

export type BlockJob = FileJob | BufferJob;

export type BlockJobResult = { data: ArrayBuffer; crc: number };

async function readRange(filePath: string, start: number, end: number): Promise<Buffer> {
  const fh = await open(filePath, 'r');
  try {
    const length = end - start;
    const buf = Buffer.alloc(length);
    let read = 0;
    while (read < length) {
      const { bytesRead } = await fh.read(buf, read, length - read, start + read);
      if (bytesRead <= 0) break;
      read += bytesRead;
    }
    return buf.subarray(0, read);
  } finally {
    await fh.close();
  }
}

/**
 * Decode exactly one bzip2 block. The payload must begin with the stream's
 * four-byte `BZh` header (the decoder constructor consumes it) followed by
 * the block's bytes; `bitOffsetInBuffer` points at the block magic within the
 * payload. seek-bzip verifies the block CRC; the returned CRC covers the
 * decompressed bytes and feeds the stream CRC fold on the main thread.
 */
export async function runBlockJob(job: BlockJob): Promise<BlockJobResult> {
  let payload: Buffer;
  if (job.kind === 'file') {
    const header = await readRange(job.filePath, 0, 4);
    if (header.length !== 4) throw new Error('bzip2 input truncated before header');
    const body = await readRange(job.filePath, job.byteStart, job.byteEnd);
    payload = Buffer.concat([header, body]);
  } else {
    payload = Buffer.from(job.payload);
  }
  const decoded: Buffer = seekBzip.decodeBlock(payload, job.bitOffsetInBuffer);
  const crc = bz2Crc32(decoded);
  // Copy into a standalone ArrayBuffer so it can be transferred back without
  // detaching a shared Node buffer pool.
  const copy = new ArrayBuffer(decoded.length);
  Buffer.from(copy).set(decoded);
  return { data: copy, crc };
}
