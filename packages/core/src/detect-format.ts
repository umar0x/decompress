export type DetectedFormat = 'zip' | 'tar' | 'gz' | 'bz2' | null;

/**
 * Detect archive format from the first bytes of the input.
 */
export function detectFormat(buffer: Buffer): DetectedFormat {
  if (buffer.length < 4) return null;

  // ZIP: PK\x03\x04 | PK\x05\x06 (empty) | PK\x07\x08 at offset 0
  if (
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07) &&
    (buffer[3] === 0x04 || buffer[3] === 0x06 || buffer[3] === 0x08)
  ) {
    return 'zip';
  }

  // GZIP: \x1f\x8b at offset 0
  if (buffer[0] === 0x1f && buffer[1] === 0x8b) {
    return 'gz';
  }

  // BZIP2: BZh at offset 0
  if (buffer[0] === 0x42 && buffer[1] === 0x5a && buffer[2] === 0x68) {
    return 'bz2';
  }

  // TAR: ustar at offset 257
  if (buffer.length >= 262 && buffer.slice(257, 262).toString('ascii') === 'ustar') {
    return 'tar';
  }

  return null;
}

/** Recognize the canonical empty TAR representation: two or more zero blocks. */
export function isEmptyTar(buffer: Buffer, size: number): boolean {
  if (size < 1024 || size % 512 !== 0 || buffer.length < 512) return false;
  return buffer.every((byte) => byte === 0);
}
