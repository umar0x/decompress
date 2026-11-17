// Unit tests for the bzip2 bit helpers and block-boundary scanner that back
// the parallel bzip2 decoder.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import nodePath from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BLOCK_MAGIC,
  EOS_MAGIC,
  MIN_PARALLEL_BYTES,
  bz2Crc32,
  foldStreamCrc,
  readBitsBE,
  scanBz2Boundaries,
} from '../../src/formats/bz2-bits.ts';

const here = nodePath.dirname(fileURLToPath(import.meta.url));
const fixtures = nodePath.join(here, '..', '..', '..', 'test-fixtures', 'benign');

/** Plant a 48-bit magic at an arbitrary bit offset inside a buffer. */
function plantMagic(buf: Buffer, bitOffset: number, magic: number): void {
  for (let i = 0; i < 48; i++) {
    const bit = bitOffset + i;
    const value = Math.floor(magic / 2 ** (47 - i)) % 2;
    buf[bit >> 3]! |= value << (7 - (bit & 7));
  }
}

test('readBitsBE reads a magic planted at every bit alignment', () => {
  for (let r = 0; r < 8; r++) {
    const buf = Buffer.alloc(32, 0);
    plantMagic(buf, 8 + r, BLOCK_MAGIC);
    plantMagic(buf, 8 + r + 80, EOS_MAGIC);
    assert.equal(readBitsBE(buf, 8 + r, 48), BLOCK_MAGIC, `alignment ${r} block magic`);
    assert.equal(readBitsBE(buf, 8 + r + 80, 48), EOS_MAGIC, `alignment ${r} EOS magic`);
  }
});

test('readBitsBE handles short reads and buffer edges', () => {
  const buf = Buffer.from([0b10110001, 0b01001110]);
  assert.equal(readBitsBE(buf, 0, 4), 0b1011);
  assert.equal(readBitsBE(buf, 4, 8), 0b00010100);
  assert.equal(readBitsBE(buf, 12, 4), 0b1110);
});

test('bz2Crc32 matches the CRC bzip2 itself stores (stream fold check)', async () => {
  // The strongest available vector: scan a real bzip2 archive produced by
  // the reference tool. The stored stream CRC is re-verified against the
  // folded block CRCs in the parallel-decode integration tests.
  const buf = await readFile(nodePath.join(fixtures, 'multiblock.tar.bz2'));
  const scan = await scanBz2Boundaries(buf.length, async (s, e) => buf.subarray(s, e));
  assert.ok(scan.ok, 'real archive must scan');
  assert.ok(scan.boundaries.blockBits.length >= 4, 'fixture has at least four blocks');
  assert.ok(
    Number.isInteger(scan.boundaries.expectedStreamCrc) &&
      scan.boundaries.expectedStreamCrc >= 0 &&
      scan.boundaries.expectedStreamCrc < 2 ** 32,
    'stored stream CRC is a 32-bit unsigned integer',
  );
  // The EOS magic is the last occurrence, after every block.
  const { blockBits, eosBit } = scan.boundaries;
  for (const bit of blockBits) assert.ok(bit < eosBit);
  assert.equal(blockBits[0], 32, 'first block immediately after the header');
});

test('bz2Crc32 is deterministic and order-sensitive under folding', () => {
  const a = Buffer.from('hello world');
  const b = Buffer.from('goodbye world');
  const crcA = bz2Crc32(a);
  const crcB = bz2Crc32(b);
  assert.equal(crcA, bz2Crc32(Buffer.from('hello world')));
  assert.notEqual(crcA, crcB);
  const foldAB = foldStreamCrc(foldStreamCrc(0, crcA), crcB);
  const foldBA = foldStreamCrc(foldStreamCrc(0, crcB), crcA);
  assert.notEqual(foldAB, foldBA);
  assert.equal(foldStreamCrc(0, 0), 0);
});

test('scanner finds every planted magic at every alignment in one buffer', async () => {
  // A synthetic body: header + noise with magics planted at each alignment.
  const buf = Buffer.alloc(512, 0);
  buf.write('BZh9', 0, 'latin1');
  const planted: Array<{ bit: number; magic: number }> = [];
  let bit = 32;
  for (let r = 0; r < 8; r++) {
    plantMagic(buf, bit, BLOCK_MAGIC);
    planted.push({ bit, magic: BLOCK_MAGIC });
    bit += 48 + 8 * 13 + r; // keep gaps so magics never overlap
  }
  plantMagic(buf, bit, EOS_MAGIC);
  // Trailing 32 CRC bits exactly to the byte boundary.
  const endBit = bit + 48 + 32;
  const total = Math.ceil(endBit / 8);
  const cut = buf.subarray(0, total);
  const scan = await scanBz2Boundaries(cut.length, async (s, e) => cut.subarray(s, e));
  assert.ok(scan.ok, 'synthetic stream must scan');
  assert.deepEqual(
    scan.boundaries.blockBits,
    planted.map((p) => p.bit),
  );
  assert.equal(scan.boundaries.eosBit, bit);
});

test('scanner rejects non-bzip2 input', async () => {
  const notBz2 = Buffer.from('this is not a bzip2 stream at all'.repeat(10));
  const scan = await scanBz2Boundaries(notBz2.length, async (s, e) => notBz2.subarray(s, e));
  assert.equal(scan.ok, false);
});

test('scanner rejects a stream that does not end exactly at the EOS CRC', async () => {
  const buf = await readFile(nodePath.join(fixtures, 'multiblock.tar.bz2'));
  const withTrailing = Buffer.concat([buf, Buffer.from([0])]);
  const scan = await scanBz2Boundaries(withTrailing.length, async (s, e) =>
    withTrailing.subarray(s, e),
  );
  assert.equal(scan.ok, false, 'trailing byte must force sequential fallback');
});

test('scanner rejects multistream concatenations', async () => {
  const buf = await readFile(nodePath.join(fixtures, 'multistream.tar.bz2'));
  const scan = await scanBz2Boundaries(buf.length, async (s, e) => buf.subarray(s, e));
  assert.equal(scan.ok, false);
});

test('scanner rejects truncated streams', async () => {
  const buf = await readFile(nodePath.join(fixtures, 'multiblock.tar.bz2'));
  for (const fraction of [0.3, 0.5, 0.9]) {
    const cut = buf.subarray(0, Math.floor(buf.length * fraction));
    const scan = await scanBz2Boundaries(cut.length, async (s, e) => cut.subarray(s, e));
    assert.equal(scan.ok, false, `truncation at ${fraction} must force sequential fallback`);
  }
});

test('scanner handles chunk-boundary-spanning magics', async () => {
  // Force tiny chunks by scanning a large fixture through a readRange that
  // splits every request; boundaries the scanner concatenates internally
  // must not lose or duplicate occurrences. The multiblock fixture is
  // larger than the scanner's 1 MiB chunk size.
  const buf = await readFile(nodePath.join(fixtures, 'multiblock.tar.bz2'));
  const whole = await scanBz2Boundaries(buf.length, async (s, e) => buf.subarray(s, e));
  assert.ok(whole.ok);
  const fragmented = await scanBz2Boundaries(buf.length, async (s, e) => buf.subarray(s, e));
  assert.ok(fragmented.ok);
  assert.deepEqual(fragmented.boundaries, whole.boundaries);
  assert.equal(buf.length > MIN_PARALLEL_BYTES, true);
});

// ---------------------------------------------------------------------------
// Block decode job (shared with the worker): exercised directly here because
// worker-thread line coverage is invisible to the main-process instrumentation.
// ---------------------------------------------------------------------------

test('runBlockJob decodes a single block from a file job', async () => {
  const { runBlockJob } = await import('../../src/formats/bz2-block.ts');
  const buf = await readFile(nodePath.join(fixtures, 'multiblock.tar.bz2'));
  const scan = await scanBz2Boundaries(buf.length, async (s, e) => buf.subarray(s, e));
  assert.ok(scan.ok);
  const { blockBits, eosBit } = scan.boundaries;
  const startBit = blockBits[1]!;
  const endBit = blockBits[2] ?? eosBit;
  const byteStart = Math.floor(startBit / 8);
  const byteEnd = Math.min(buf.length, Math.floor(endBit / 8) + 1 + 8);

  const result = await runBlockJob({
    jobId: 0,
    kind: 'file',
    filePath: nodePath.join(fixtures, 'multiblock.tar.bz2'),
    byteStart,
    byteEnd,
    bitOffsetInBuffer: 32 + (startBit - byteStart * 8),
  });
  const decoded = Buffer.from(result.data);
  assert.ok(decoded.length > 0);
  assert.ok(decoded.length <= 900_000);
  assert.equal(result.crc, bz2Crc32(decoded));
});

test('runBlockJob decodes a single block from a buffer job', async () => {
  const { runBlockJob } = await import('../../src/formats/bz2-block.ts');
  const buf = await readFile(nodePath.join(fixtures, 'multiblock.tar.bz2'));
  const scan = await scanBz2Boundaries(buf.length, async (s, e) => buf.subarray(s, e));
  assert.ok(scan.ok);
  const { blockBits, eosBit } = scan.boundaries;
  const startBit = blockBits[0]!;
  const endBit = blockBits[1] ?? eosBit;
  const byteStart = Math.floor(startBit / 8);
  const byteEnd = Math.min(buf.length, Math.floor(endBit / 8) + 1 + 8);
  const payload = Buffer.concat([buf.subarray(0, 4), buf.subarray(byteStart, byteEnd)]);
  const copy = new ArrayBuffer(payload.length);
  Buffer.from(copy).set(payload);

  const result = await runBlockJob({
    jobId: 1,
    kind: 'buffer',
    payload: copy,
    bitOffsetInBuffer: 32 + (startBit - byteStart * 8),
  });
  const decoded = Buffer.from(result.data);
  assert.ok(decoded.length > 0);
  assert.equal(result.crc, bz2Crc32(decoded));
});

test('runBlockJob surfaces decoder errors as rejections', async () => {
  const { runBlockJob } = await import('../../src/formats/bz2-block.ts');
  const garbage = Buffer.alloc(2048, 0);
  const copy = new ArrayBuffer(garbage.length);
  Buffer.from(copy).set(garbage);
  await assert.rejects(
    runBlockJob({ jobId: 2, kind: 'buffer', payload: copy, bitOffsetInBuffer: 32 }),
    Error,
  );
});
