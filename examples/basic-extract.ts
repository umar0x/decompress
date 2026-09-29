// Smallest useful case: extract an archive with defaults.
// Defaults refuse links, cap resources, and commit atomically.

import { extract } from '@umar0x/decompress';

const result = await extract('release.zip', 'dist');

console.log(
  `extracted ${result.entries.length} entries (${result.totalBytes} bytes) to ${result.output}`,
);
for (const entry of result.entries) {
  console.log(`  ${entry.type.padEnd(9)} ${entry.path}`);
}
