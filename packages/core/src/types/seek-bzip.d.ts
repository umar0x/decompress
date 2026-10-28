declare module 'seek-bzip' {
  /**
   * Minimal surface of seek-bzip used by the parallel bzip2 decoder.
   * `decodeBlock` decodes exactly one bzip2 block starting at `pos` (a bit
   * offset relative to the start of `input`), verifying the block CRC, and
   * returns the decompressed bytes. The input must begin with the four-byte
   * `BZh` stream header because the decoder constructor consumes it.
   */
  function decodeBlock(input: Buffer, pos: number, output?: Buffer): Buffer;
  function decode(input: Buffer, output?: Buffer | number): Buffer;
  export default { decodeBlock, decode };
}
