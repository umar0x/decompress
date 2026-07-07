import { readFile } from 'node:fs/promises';
import nodePath from 'node:path';
import process from 'node:process';

const root = process.cwd();
const packages = [
  'package.json',
  'packages/core/package.json',
  'packages/decompress-compatible/package.json',
  'packages/cli/package.json',
  'packages/benchmarks/package.json',
  'packages/fuzz/package.json',
  'packages/test-fixtures/package.json',
];

async function readJson(relativePath) {
  return JSON.parse(await readFile(nodePath.join(root, relativePath), 'utf8'));
}

const manifests = await Promise.all(packages.map(readJson));
const version = manifests[0].version;
const mismatches = packages.filter((_, index) => manifests[index].version !== version);

if (mismatches.length > 0) {
  throw new Error(`package versions do not match ${version}: ${mismatches.join(', ')}`);
}

for (const [index, manifest] of manifests.entries()) {
  if (manifest.author !== 'umar0x <hello@umar.ac>' && index < 4) {
    throw new Error(`${packages[index]} has incorrect author metadata`);
  }
}

const expectedRepository = 'git+https://github.com/umar0x/decompress.git';
for (const index of [1, 2, 3]) {
  const manifest = manifests[index];
  if (manifest.repository?.url !== expectedRepository) {
    throw new Error(`${packages[index]} has incorrect repository metadata`);
  }
  if (manifest.publishConfig?.access !== 'public') {
    throw new Error(`${packages[index]} must publish with public access`);
  }
}

if (manifests[2].dependencies?.['@umar0x/decompress'] !== `^${version}`) {
  throw new Error('compatibility package dependency version is not synchronized');
}
if (manifests[3].dependencies?.['@umar0x/decompress'] !== `^${version}`) {
  throw new Error('CLI dependency version is not synchronized');
}

const changelog = await readFile(nodePath.join(root, 'CHANGELOG.md'), 'utf8');
if (!changelog.includes(`## [${version}]`)) {
  throw new Error(`CHANGELOG.md has no ${version} release entry`);
}

if (process.env.GITHUB_REF_TYPE === 'tag' && process.env.GITHUB_REF_NAME !== `v${version}`) {
  throw new Error(`tag ${process.env.GITHUB_REF_NAME} does not match package version ${version}`);
}

process.stdout.write(`Release metadata verified for v${version}.\n`);
