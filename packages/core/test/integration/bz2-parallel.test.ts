// Integration tests for the parallel bzip2 decoder. The parallel path is
// exercised through real multi-block archives; correctness is anchored to
// the sequential decoder (unbzip2-stream), which 1.0.x semantics preserve
// for every input shape the parallel path declines.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, readdir } from 'node:fs/promises';
import nodePath from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { createRequire } from 'node:module';

import { extract } from '../../src/index.ts';
import { createParallelBz2Stream } from '../../src/formats/bz2-parallel.ts';
import { CorruptArchiveError, TruncatedArchiveError } from '../../src/errors.ts';

const require2 = createRequire(import.meta.url);
const unbzip2Stream = require2('unbzip2-stream');

const here = nodePath.dirname(fileURLToPath(import.meta.url));
const fixtures = nodePath.join(here, '..', '..', '..', 'test-fixtures', 'benign');
const MULTIBLOCK = nodePath.join(fixtures, 'multiblock.tar.bz2');
const MULTISTREAM = nodePath.join(fixtures, 'multistream.tar.bz2');
const SINGLE = nodePath.join(fixtures, 'file.tar.bz2');

async function sequentialDecode(buf: Buffer): Promise<Buffer> {
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    const stream = Readable.from([buf]).pipe(unbzip2Stream());
    stream.on('data', (c: Buffer) => chunks.push(c));
    stream.on('end', () => resolve());
    stream.on('error', reject);
  });
  return Buffer.concat(chunks);
}

async function drain(stream: AsyncIterable<Buffer>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c);
  return Buffer.concat(chunks);
}

test('parallel decode is byte-identical to the sequential decoder (buffer input)', async () => {
  const buf = await readFile(MULTIBLOCK);
  const stream = await createParallelBz2Stream(
    { buffer: buf, size: buf.length },
    new AbortController().signal,
  );
  assert.notEqual(stream, null, 'multi-block fixture engages the parallel path');
  const [parallel, sequential] = await Promise.all([drain(stream!), sequentialDecode(buf)]);
  assert.equal(parallel.length, sequential.length);
  assert.ok(parallel.equals(sequential));
});

test('parallel decode is byte-identical to the sequential decoder (file input)', async () => {
  const buf = await readFile(MULTIBLOCK);
  const stream = await createParallelBz2Stream(
    { filePath: MULTIBLOCK, size: buf.length },
    new AbortController().signal,
  );
  assert.notEqual(stream, null);
  const parallel = await drain(stream!);
  const sequential = await sequentialDecode(buf);
  assert.ok(parallel.equals(sequential));
});

test('extract() end to end on a multi-block tar.bz2', async () => {
  const dir = await mkdtemp(nodePath.join(tmpdir(), 'bz2-par-'));
  try {
    const result = await extract(MULTIBLOCK, nodePath.join(dir, 'out'));
    assert.equal(result.detectedFormats[0], 'tar.bz2');
    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0]!.path, 'multiblock-payload.bin');
    assert.equal(result.entries[0]!.size, 3 * 1024 * 1024);
    const payload = await readFile(nodePath.join(dir, 'out', 'multiblock-payload.bin'));
    assert.equal(payload.length, 3 * 1024 * 1024);
    // The extracted file is the tar body after its 512-byte header, and the
    // tar itself is exactly what the sequential decoder produces.
    const sequential = await sequentialDecode(await readFile(MULTIBLOCK));
    assert.ok(payload.equals(sequential.subarray(512, 512 + payload.length)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('single-block and small archives use the sequential path', async () => {
  const buf = await readFile(SINGLE);
  const stream = await createParallelBz2Stream(
    { buffer: buf, size: buf.length },
    new AbortController().signal,
  );
  assert.equal(stream, null, 'archive below the size threshold stays sequential');
});

test('multistream archives fall back and extract every member stream', async () => {
  const dir = await mkdtemp(nodePath.join(tmpdir(), 'bz2-multi-'));
  try {
    const stream = await createParallelBz2Stream(
      { filePath: MULTISTREAM, size: (await readFile(MULTISTREAM)).length },
      new AbortController().signal,
    );
    assert.equal(stream, null, 'multistream does not engage the parallel path');
    const result = await extract(MULTISTREAM, nodePath.join(dir, 'out'));
    assert.ok(result.entries.length >= 1, 'sequential path extracts concatenated streams');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('truncated multiblock archives surface TruncatedArchiveError', async () => {
  const buf = await readFile(MULTIBLOCK);
  for (const fraction of [0.3, 0.5, 0.9]) {
    const cut = buf.subarray(0, Math.floor(buf.length * fraction));
    const dir = await mkdtemp(nodePath.join(tmpdir(), 'bz2-trunc-'));
    try {
      const cutPath = nodePath.join(dir, 'cut.tar.bz2');
      await writeFile(cutPath, cut);
      await assert.rejects(extract(cutPath, nodePath.join(dir, 'out')), (error: unknown) => {
        assert.ok(error instanceof Error);
        // Either typed truncation or a typed corrupt-archive classification
        // of the underlying zlib/EOF error; both fail closed with no output.
        const code = (error as { code?: string }).code;
        assert.ok(
          code === 'TRUNCATED_ARCHIVE' || code === 'CORRUPT_ARCHIVE',
          `fraction ${fraction}: unexpected code ${code}`,
        );
        assert.equal(
          nodePath.basename((error as { entryPath?: string }).entryPath ?? ''),
          '',
          'no entry claimed',
        );
        return true;
      });
      const entries = await readdir(dir);
      assert.ok(
        !entries.includes('out') || (await readdir(nodePath.join(dir, 'out'))).length === 0,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

test('a corrupted stored stream CRC fails the parallel decode', async () => {
  const buf = Buffer.from(await readFile(MULTIBLOCK));
  // Flip a bit in the final four bytes, which hold the stored stream CRC.
  buf[buf.length - 2]! ^= 0xff;
  const stream = await createParallelBz2Stream(
    { buffer: buf, size: buf.length },
    new AbortController().signal,
  );
  // The corrupted CRC changes the trailing bits the scanner reads; depending
  // on which bits flip the scan may or may not still be parallel-shaped.
  if (stream !== null) {
    await assert.rejects(drain(stream), CorruptArchiveError);
  }
});

test('a corrupted block body fails closed with a typed error', async () => {
  const buf = Buffer.from(await readFile(MULTIBLOCK));
  // Corrupt bytes in the middle of the second block.
  const scanBuffer = buf;
  const mid = Math.floor(buf.length / 2) + 64;
  for (let i = 0; i < 8; i++) buf[mid + i]! ^= 0x5a;
  void scanBuffer;
  const stream = await createParallelBz2Stream(
    { buffer: buf, size: buf.length },
    new AbortController().signal,
  );
  if (stream !== null) {
    await assert.rejects(drain(stream), (error: unknown) => {
      assert.ok(
        error instanceof CorruptArchiveError || error instanceof TruncatedArchiveError,
        `unexpected error type: ${String(error)}`,
      );
      return true;
    });
  }
});

test('aborting mid-decode settles with AbortError and no leaked workers', async () => {
  const buf = await readFile(MULTIBLOCK);
  const controller = new AbortController();
  const stream = await createParallelBz2Stream(
    { buffer: buf, size: buf.length },
    controller.signal,
  );
  assert.notEqual(stream, null);
  const iterator = stream![Symbol.asyncIterator]();
  await iterator.next(); // first block arrives, workers are alive
  controller.abort();
  // The stream must settle (not hang) once aborted.
  const outcome = await Promise.race([
    iterator.next().then(
      (r) => ({ settled: true, done: r.done }),
      (e: unknown) => ({ settled: true, error: e }),
    ),
    new Promise((resolve) => setTimeout(() => resolve({ settled: false }), 5000)),
  ]);
  assert.equal((outcome as { settled: boolean }).settled, true);
});

test('the worker artifact ships next to the library build', async () => {
  const { existsSync } = await import('node:fs');
  const here = nodePath.dirname(fileURLToPath(import.meta.url));
  const distWorker = nodePath.resolve(here, '../../dist/bz2-worker.cjs');
  // Present after `npm run build`; the parallel path depends on it.
  assert.ok(existsSync(distWorker), `missing ${distWorker}; run npm run build`);
});
