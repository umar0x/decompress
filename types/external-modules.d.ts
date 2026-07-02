// Type declarations for packages without bundled types.
declare module 'decompress' {
  function decompress(
    input: Buffer | string,
    output?: string,
    opts?: Record<string, unknown>,
  ): Promise<unknown[]>;
  export default decompress;
}

declare module '@xhmikosr/decompress' {
  function decompress(
    input: Buffer | string,
    output?: string,
    opts?: Record<string, unknown>,
  ): Promise<unknown[]>;
  export default decompress;
}
