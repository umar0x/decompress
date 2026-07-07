import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import nodePath from 'node:path';
import process from 'node:process';

const groups = {
  unit: ['packages/core/test/unit'],
  integration: ['packages/core/test/integration'],
  security: ['packages/core/test/security'],
  compat: ['packages/decompress-compatible/test/compat'],
  cli: ['packages/cli/test'],
  fuzz: ['packages/fuzz/test'],
  core: [
    'packages/core/test/unit',
    'packages/core/test/integration',
    'packages/core/test/security',
  ],
  all: [
    'packages/core/test/unit',
    'packages/core/test/integration',
    'packages/core/test/security',
    'packages/decompress-compatible/test/compat',
    'packages/cli/test',
    'packages/fuzz/test',
  ],
};

const group = process.argv[2] ?? 'all';
const reporter = process.argv[3] ?? 'spec';
const directories = groups[group];
if (!directories) {
  process.stderr.write(`Unknown test group: ${group}\n`);
  process.exitCode = 2;
} else {
  const files = directories
    .flatMap((directory) =>
      readdirSync(nodePath.resolve(directory), { recursive: true })
        .filter((file) => typeof file === 'string' && file.endsWith('.test.ts'))
        .map((file) => nodePath.resolve(directory, file)),
    )
    .sort();
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', '--test', `--test-reporter=${reporter}`, ...files],
    { stdio: 'inherit', env: process.env },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
