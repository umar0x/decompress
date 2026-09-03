#!/usr/bin/env node
// Enforces per-file coverage floors for security-critical modules.
// Reads lcov.info produced by the coverage run and fails loudly when a
// critical file drops below its floor.

import { readFileSync, existsSync } from 'node:fs';
import nodePath from 'node:path';
import process from 'node:process';

const LCOV = process.argv[2] ?? 'coverage/lcov.info';
// Floors reflect what is reachable on a Linux CI runner; the Windows-only
// error branches (symlink EPERM fallbacks) cannot be executed there.
const FLOORS = {
  'packages/core/src/audit.ts': { lines: 85, branches: 80 },
  'packages/core/src/writer/secure-writer.ts': { lines: 75, branches: 68 },
  'packages/core/src/writer/path-security.ts': { lines: 95, branches: 90 },
  'packages/core/src/writer/atomic-extractor.ts': { lines: 85, branches: 78 },
  'packages/core/src/policy/link-policy.ts': { lines: 100, branches: 100 },
  'packages/core/src/policy/limits-policy.ts': { lines: 90, branches: 85 },
};

function out(message) {
  process.stdout.write(message + '\n');
}

if (!existsSync(LCOV)) {
  process.stderr.write(`coverage floors: ${LCOV} not found (run the coverage suite first)\n`);
  process.exit(1);
}

const lcov = readFileSync(LCOV, 'utf8');
const records = lcov.split('end_of_record\n').filter((r) => r.includes('SF:'));
const failures = [];

for (const record of records) {
  const file = (record.match(/SF:(.+)/) ?? [])[1]?.trim();
  if (!file) continue;
  const norm = file.replace(/\\/g, '/');
  const entry = Object.entries(FLOORS).find(([key]) => norm.endsWith(key.replace(/\\/g, '/')));
  if (!entry) continue;
  const floor = entry[1];
  const lh = Number((record.match(/LH:(\d+)/) ?? [])[1]);
  const lf = Number((record.match(/LF:(\d+)/) ?? [])[1]);
  const brh = Number((record.match(/BRH:(\d+)/) ?? [])[1]);
  const brf = Number((record.match(/BRF:(\d+)/) ?? [])[1]);
  const linePct = lf > 0 ? (lh / lf) * 100 : 100;
  const branchPct = brf > 0 ? (brh / brf) * 100 : 100;
  if (linePct < floor.lines || branchPct < floor.branches) {
    failures.push(
      `${nodePath.basename(norm)}: lines ${linePct.toFixed(1)}% (floor ${floor.lines}%), ` +
        `branches ${branchPct.toFixed(1)}% (floor ${floor.branches}%)`,
    );
  } else {
    out(
      `coverage floors OK: ${nodePath.basename(norm)} lines ${linePct.toFixed(1)}%, branches ${branchPct.toFixed(1)}%`,
    );
  }
}

if (failures.length > 0) {
  process.stderr.write('\ncoverage floor violations:\n');
  for (const f of failures) process.stderr.write('  ' + f + '\n');
  process.exit(1);
}
