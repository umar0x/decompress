// Bit-level helpers, the bzip2 block-boundary scanner, and the bzip2 flavor
// of CRC-32, shared by the parallel bzip2 decoder and its worker.

import { open, type FileHandle } from 'node:fs/promises';

/** 48-bit block header magic (digits of pi). */
export const BLOCK_MAGIC = 0x314159265359;
/** 48-bit end-of-stream magic (digits of the square root of pi). */
export const EOS_MAGIC = 0x177245385090;

/**
 * Minimum compressed size before the parallel decoder is worth its worker
 * startup cost. Below this the sequential decoder is used.
 */
export const MIN_PARALLEL_BYTES = 256 * 1024;

// ---------------------------------------------------------------------------
// CRC-32 (bzip2 flavor): big-endian, polynomial 0x04C11DB7, init and final
// XOR 0xFFFFFFFF. Same construction seek-bzip and unbzip2-stream use.
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i << 24;
    for (let k = 0; k < 8; k++) {
      c = c & 0x80000000 ? ((c << 1) ^ 0x04c11db7) >>> 0 : (c << 1) >>> 0;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

/** Compute the bzip2 CRC-32 of a whole buffer. */
export function bz2Crc32(buf: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = ((crc << 8) ^ (CRC_TABLE[((crc >>> 24) ^ buf[i]!) & 0xff] ?? 0)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Fold one block CRC into the running stream CRC (bzip2 bit-rotate combine). */
export function foldStreamCrc(streamCrc: number, blockCrc: number): number {
  return (blockCrc ^ ((streamCrc << 1) | (streamCrc >>> 31))) >>> 0;
}

// ---------------------------------------------------------------------------
// Bit reading: bzip2 bit i of the stream is bit (7 - (i % 8)) of byte
// floor(i / 8), i.e. big-endian bit order within little-endian bytes.
// ---------------------------------------------------------------------------

/** Read up to 48 bits starting at `bitPos`, big-endian bit order. */
export function readBitsBE(buf: Uint8Array, bitPos: number, count: number): number {
  // Arithmetic accumulation: the 48-bit magics exceed JavaScript's 32-bit
  // bitwise operator range.
  let result = 0;
  for (let i = 0; i < count; i++) {
    const bit = bitPos + i;
    const byte = buf[bit >>> 3] ?? 0;
    const bitValue = (byte >> (7 - (bit & 7))) & 1;
    result = result * 2 + bitValue;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Block-boundary scanning.
//
// A 48-bit magic whose first bit sits at bit offset r (0..7) inside its first
// byte covers: r magic bits in the low positions of byte `hit`, five fully
// covered bytes at hit+1..hit+5 (magic bits [8-r, 48-r)), and r magic bits in
// the high positions of byte hit+6. Scanning for those five known bytes with
// Buffer.indexOf (fast, native) and verifying the partial bits in the
// neighboring bytes finds every occurrence at every alignment. False
// positives are possible in adversarial data; block CRC checks during decode
// catch them and surface a typed corrupt-archive error.
// ---------------------------------------------------------------------------

const CORE_PATTERNS: Array<{ magic: number; alignment: number; pattern: Buffer }> = (() => {
  const out: Array<{ magic: number; alignment: number; pattern: Buffer }> = [];
  for (const magic of [BLOCK_MAGIC, EOS_MAGIC]) {
    for (let r = 0; r < 8; r++) {
      // Magic bits [8-r, 48-r) as five big-endian bytes. Plain arithmetic
      // throughout: the magic is 48 bits, beyond the reach of JavaScript's
      // 32-bit bitwise operators.
      const core = Math.floor(magic / 2 ** r) % 2 ** 40;
      const pattern = Buffer.allocUnsafe(5);
      for (let i = 0; i < 5; i++) {
        pattern[i] = Math.floor(core / 2 ** (8 * (4 - i))) % 256;
      }
      out.push({ magic, alignment: r, pattern });
    }
  }
  return out;
})();

/**
 * Verify the partial bits around a five-byte core hit found at `coreIndex`.
 * The byte holding the magic's first bit is `coreIndex - 1`. Returns the
 * magic's absolute bit position, or null when the partial bits do not match.
 */
function verifyHit(
  buf: Buffer,
  coreIndex: number,
  alignment: number,
  magic: number,
): number | null {
  const hit = coreIndex - 1;
  if (hit < 0) return null;
  // Magic bits [0, 8-alignment) live in the low bits of byte `hit`. For
  // alignment 0 that is the whole first magic byte.
  const leading = 8 - alignment;
  if ((buf[hit]! & ((1 << leading) - 1)) !== Math.floor(magic / 2 ** (40 + alignment))) {
    return null;
  }
  // Magic bits [48-alignment, 48) live in the high bits of byte hit+6.
  if (alignment > 0) {
    const after = buf[hit + 6];
    if (after === undefined) return null;
    if (after >> leading !== magic % 2 ** alignment) return null;
  }
  return hit * 8 + alignment;
}

export type Bz2Boundaries = {
  /** Bit positions of every block magic, ascending. */
  blockBits: number[];
  /** Bit position of the end-of-stream magic. */
  eosBit: number;
  /** Stream CRC stored after the EOS magic. */
  expectedStreamCrc: number;
  /** Total compressed bytes. */
  totalBytes: number;
};

export type ScanResult = { ok: true; boundaries: Bz2Boundaries } | { ok: false };

/**
 * Scan a bzip2 stream for block boundaries. `readRange` must return the
 * requested half-open byte range (used for both whole-buffer and file-backed
 * inputs). Sequential, bounded-memory: the file is walked in chunks with a
 * small overlap.
 *
 * Returns ok:false whenever the stream does not have the exact shape the
 * parallel decoder understands (single stream, first block at bit 32, EOS
 * last, nothing trailing); the caller then uses the sequential decoder with
 * unchanged 1.0.x semantics.
 */
export async function scanBz2Boundaries(
  totalBytes: number,
  readRange: (start: number, end: number) => Promise<Buffer>,
): Promise<ScanResult> {
  if (totalBytes < 8) return { ok: false };

  // Header: 'BZh' + level digit.
  const header = await readRange(0, 4);
  if (header.length < 4) return { ok: false };
  if (header[0] !== 0x42 || header[1] !== 0x5a || header[2] !== 0x68) return { ok: false };
  const level = header[3]! - 0x30;
  if (level < 1 || level > 9) return { ok: false };

  // Scan the body for magic occurrences at any bit alignment.
  const CHUNK = 1 << 20;
  const occurrences: Array<{ bit: number; magic: number }> = [];
  let carry: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  for (let start = 0; start < totalBytes; start += CHUNK) {
    const end = Math.min(totalBytes, start + CHUNK);
    let chunk = await readRange(start, end);
    // Prepend the previous tail so patterns spanning the boundary are found.
    if (carry.length > 0) {
      chunk = Buffer.concat([carry, chunk]);
    }
    const base = start - carry.length;
    for (const { magic, alignment, pattern } of CORE_PATTERNS) {
      let idx = chunk.indexOf(pattern);
      while (idx !== -1) {
        const bit = verifyHit(chunk, idx, alignment, magic);
        // verifyHit is relative to the concatenated chunk; rebase to the
        // absolute stream position. Hits inside the carry region are found
        // twice (previous and current chunk); duplicates collapse below.
        if (bit !== null && bit + base * 8 >= 32) {
          occurrences.push({ bit: bit + base * 8, magic });
        }
        idx = chunk.indexOf(pattern, idx + 1);
      }
    }
    carry = chunk.subarray(Math.max(0, chunk.length - 8));
  }

  if (occurrences.length === 0) return { ok: false };
  occurrences.sort((a, b) => a.bit - b.bit || a.magic - b.magic);
  const deduped: Array<{ bit: number; magic: number }> = [];
  for (const o of occurrences) {
    const last = deduped[deduped.length - 1];
    if (last === undefined || last.bit !== o.bit || last.magic !== o.magic) {
      deduped.push(o);
    }
  }

  // The first magic must sit immediately after the four-byte header, and it
  // must be a block (an empty stream has nothing to parallelize).
  const first = deduped[0]!;
  if (first.bit !== 32 || first.magic !== BLOCK_MAGIC) return { ok: false };

  // All block magics first, then exactly one EOS magic at the end.
  const eosIndex = deduped.length - 1;
  if (deduped[eosIndex]!.magic !== EOS_MAGIC) return { ok: false };
  const eosBit = deduped[eosIndex]!.bit;
  for (let i = 0; i < eosIndex; i++) {
    if (deduped[i]!.magic !== BLOCK_MAGIC) return { ok: false };
    if (deduped[i]!.bit >= eosBit) return { ok: false };
  }
  const blockBits = deduped.slice(0, eosIndex).map((o) => o.bit);

  // The stream must end exactly after the EOS magic plus its 32-bit CRC
  // (rounded up to a whole byte). Anything trailing means multistream data,
  // padding, or truncation: let the sequential decoder decide.
  const endBit = eosBit + 48 + 32;
  const exactEndBytes = Math.ceil(endBit / 8);
  if (totalBytes !== exactEndBytes) return { ok: false };

  // Read the trailing bits: the 32-bit stream CRC after the EOS magic.
  const tailStart = Math.floor(eosBit / 8);
  const tail = await readRange(tailStart, totalBytes);
  const expectedStreamCrc = readBitsBE(tail, eosBit + 48 - tailStart * 8, 32);

  return {
    ok: true,
    boundaries: { blockBits, eosBit, expectedStreamCrc, totalBytes },
  };
}

/** Open a file-backed range reader for the scanner and workers. */
export async function openFileRangeReader(filePath: string): Promise<{
  readRange: (start: number, end: number) => Promise<Buffer>;
  close: () => Promise<void>;
}> {
  const fh: FileHandle = await open(filePath, 'r');
  return {
    readRange: async (start, end) => {
      const length = end - start;
      const buf = Buffer.alloc(length);
      let read = 0;
      while (read < length) {
        const { bytesRead } = await fh.read(buf, read, length - read, start + read);
        if (bytesRead <= 0) break;
        read += bytesRead;
      }
      return buf.subarray(0, read);
    },
    close: () => fh.close(),
  };
}
