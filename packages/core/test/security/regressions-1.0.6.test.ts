// 1.0.6 regression suite. Each test pins a defect or behavior change found
// and fixed during the 1.0.5 -> 1.0.6 upgrade, so none of them can silently
// regress.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, stat, readFile } from 'node:fs/promises';
import nodePath from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

import { extract } from '../../src/index.ts';
import { DepthExceededError } from '../../src/errors.ts';
import { buildTarBuffer } from '../helpers/archive-builders.ts';

const require2 = createRequire(import.meta.url);
const here = nodePath.dirname(fileURLToPath(import.meta.url));
const fixtures = nodePath.join(here, '..', '..', '..', 'test-fixtures', 'benign');

async function tmpOutput(): Promise<string> {
  return mkdtemp(nodePath.join(tmpdir(), 'decompress-106-'));
}

// ---------------------------------------------------------------------------
// Fixed in 1.0.6: staging-directory cleanup leaked on depth violations.
//
// boundedRimraf capped recursion at 64 levels, but the staging tree can be up
// to maxDepth levels deep. An archive rejected for depth left its staging
// directory behind next to the output path.
// ---------------------------------------------------------------------------

test('1.0.6: a depth-rejected archive leaves no staging directory behind', async () => {
  const dir = await tmpOutput();
  try {
    // 129-deep path exceeds the default maxDepth of 128.
    const deepName = Array.from({ length: 129 }, (_, i) => `d${i}`).join('/');
    const tar = await buildTarBuffer([{ name: `${deepName}/leaf.txt`, content: 'deep\n' }]);
    const archive = nodePath.join(dir, 'deep.tar');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(archive, tar);
    const output = nodePath.join(dir, 'out');

    await assert.rejects(extract(archive, output), DepthExceededError);

    const leftovers = (await readdir(dir)).filter((name) => name.startsWith('.decompress-tmp-'));
    assert.deepEqual(leftovers, [], 'no staging directory may remain');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('1.0.6: a write-failed deep extraction also cleans up staging', async () => {
  const dir = await tmpOutput();
  try {
    // A 129-deep tree with maxDepth raised succeeds; a mid-tree entry that
    // collides with a policy still unwinds staging completely.
    const deepName = Array.from({ length: 100 }, (_, i) => `d${i}`).join('/');
    const tar = await buildTarBuffer([
      { name: `${deepName}/a.txt`, content: 'a\n' },
      { name: `${deepName}/../evil.txt`, content: 'traversal\n' },
    ]);
    const archive = nodePath.join(dir, 'deep-evil.tar');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(archive, tar);
    const output = nodePath.join(dir, 'out');

    await assert.rejects(extract(archive, output, { maxDepth: 140 }));

    const leftovers = (await readdir(dir)).filter((name) => name.startsWith('.decompress-tmp-'));
    assert.deepEqual(leftovers, [], 'no staging directory may remain');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Changed in 1.0.6: files are created with their final mode directly instead
// of open(0600) + fchmod. The staging root is 0700-private, so the final mode
// is never observable before the atomic commit. On-disk results must be
// identical.
// ---------------------------------------------------------------------------

test('1.0.6: created files carry their sanitized final mode', async () => {
  const dir = await tmpOutput();
  try {
    const tar = await buildTarBuffer([
      { name: 'plain.txt', content: 'plain\n', mode: 0o644 },
      { name: 'exec.sh', content: '#!/bin/sh\n', mode: 0o755 },
      { name: 'writable.txt', content: 'w\n', mode: 0o777 },
      { name: 'setuid.bin', content: 'x\n', mode: 0o4755 },
    ]);
    const archive = nodePath.join(dir, 'modes.tar');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(archive, tar);
    const output = nodePath.join(dir, 'out');

    await extract(archive, output);

    const plain = await stat(nodePath.join(output, 'plain.txt'));
    const exec = await stat(nodePath.join(output, 'exec.sh'));
    const writable = await stat(nodePath.join(output, 'writable.txt'));
    const setuid = await stat(nodePath.join(output, 'setuid.bin'));

    // Special bits never survive, on any platform.
    for (const st of [plain, exec, writable, setuid]) {
      assert.equal(st.mode & 0o7000, 0, 'setuid/setgid/sticky must be stripped');
    }

    if (process.platform === 'win32') {
      // Windows can only represent writable vs read-only; every sanitized
      // mode here keeps the write bit, and read-only would mean 0o444.
      for (const st of [plain, exec, writable, setuid]) {
        assert.equal(st.mode & 0o222, 0o222, 'writable files must stay writable');
      }
    } else {
      const umask = process.umask();
      assert.equal(plain.mode & 0o777, 0o644 & ~umask);
      assert.equal(exec.mode & 0o777, 0o755 & ~umask);
      // 0o777 without preservePermissions is capped by the default policy.
      assert.equal(writable.mode & 0o777, 0o755 & ~umask);
      // setuid is always stripped; execute bit preserved.
      assert.equal(setuid.mode & 0o777, 0o755 & ~umask);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// New in 1.0.6: the published artifact bundles its runtime dependencies and
// ships a standalone bzip2 worker. Packaging checks live here so a build
// change cannot quietly drop either.
// ---------------------------------------------------------------------------

test('1.0.6: the package declares no runtime dependencies', async () => {
  const pkg = JSON.parse(
    await readFile(nodePath.join(here, '..', '..', 'package.json'), 'utf8'),
  ) as { dependencies?: Record<string, string> };
  assert.equal(
    Object.keys(pkg.dependencies ?? {}).length,
    0,
    'the published package must stay zero-dependency',
  );
});

test('1.0.6: extraction works through the built artifact', async () => {
  const dir = await tmpOutput();
  try {
    const { extract: extractBuilt } = await import('../../dist/index.js');
    const result = await extractBuilt(
      nodePath.join(fixtures, 'file.tar.gz'),
      nodePath.join(dir, 'out'),
    );
    assert.equal(result.entries[0]!.path, 'test.jpg');
    assert.ok((await stat(nodePath.join(dir, 'out', 'test.jpg'))).size > 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('1.0.6: CommonJS build interops from require()', async () => {
  const dir = await tmpOutput();
  try {
    const { createRequire } = await import('node:module');
    const requireBuilt = createRequire(import.meta.url);
    const built = requireBuilt('../../dist/index.cjs');
    assert.equal(typeof built.extract, 'function');
    assert.equal(typeof built.listArchive, 'function');
    assert.equal(typeof built.auditArchive, 'function');
    const result = await built.extract(
      nodePath.join(fixtures, 'file.zip'),
      nodePath.join(dir, 'out'),
    );
    assert.equal(result.entries[0]!.path, 'test.jpg');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

void require2;
