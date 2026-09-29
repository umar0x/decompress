// Extracting an archive from an untrusted source. Tight limits, an abort
// signal, and a warning callback. Nothing here can write outside the output,
// expand past the ceilings, or hang the caller.

import { extract } from '@umar0x/decompress';

const controller = new AbortController();
setTimeout(() => controller.abort(), 10_000).unref();

const result = await extract('upload.tar.gz', 'uploads/processed', {
  maxArchiveSize: '50mb',
  maxFiles: 2_000,
  maxTotalSize: '200mb',
  maxEntrySize: '25mb',
  maxDepth: 16,
  maxCompressionRatio: 40,
  signal: controller.signal,
  onWarning: (warning) => console.warn(`[${warning.code}] ${warning.message}`),
});

console.log(`accepted ${result.entries.length} entries, ${result.warnings.length} warnings`);
