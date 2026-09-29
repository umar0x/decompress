// Archive bytes from a stream. One-shot streams are spooled to a private,
// size-bounded temp file (never an unbounded buffer), then extracted.

import { extract } from '@umar0x/decompress';
import { createReadStream } from 'node:fs';

// Path input stays file-backed the whole way through:
await extract('big.tar.zst', 'out', { maxTotalSize: '10gb' });

// Node streams, Web streams, and async iterables are one-shot inputs:
const nodeStream = createReadStream('downloaded.zip');
await extract(nodeStream, 'out2', { maxArchiveSize: '1gb' });

async function* chunks() {
  yield new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
  // ...
}
await extract(chunks(), 'out3');
