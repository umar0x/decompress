// Audit first, extract only what passed review. Audit never writes to disk,
// so a hostile archive is inspected without ever being unpacked.

import { auditArchive, extract } from '@umar0x/decompress';
import { isDecompressError } from '@umar0x/decompress';

const report = await auditArchive('bundle.zip', { maxFiles: 5_000 });

if (report.riskLevel === 'low' || report.riskLevel === 'medium') {
  const result = await extract('bundle.zip', 'out', { maxFiles: 5_000 });
  console.log(`extracted ${result.entries.length} entries`);
} else {
  console.error(`refusing archive: ${report.riskLevel} risk`);
  for (const finding of report.findings) {
    console.error(`  [${finding.severity}] ${finding.code}: ${finding.message}`);
  }
}

// Any policy failure throws a typed error, so handling is by code:
try {
  await extract('maybe-hostile.zip', 'out2');
} catch (error) {
  if (isDecompressError(error) && error.code === 'PATH_TRAVERSAL') {
    console.error('blocked a path traversal attempt, output untouched');
  }
}
