// Integration tests for concurrent extraction: ordered callbacks, identical
// output trees across concurrency levels, atomic failure under concurrency,
// and deferred mtime application.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import nodePath from 'node:path';
import { mkdtemp, rm, readdir, stat, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';

import { extract } from '../../src/extract.ts';
import { CorruptArchiveError, OutputExistsError } from '../../src/errors.ts';
import type { ArchivePlugin } from '../../src/types.ts';

const fixtures = nodePath.join(import.meta.dirname, '..', '..', '..', 'test-fixtures');

async function tmpOut(): Promise<string> {
  return mkdtemp(nodePath.join(tmpdir(), 'decompress-conc-test-'));
}

/** Deterministic plugin that yields N small files with lazy body streams. */
function makeSyntheticPlugin(n: number, failAt?: number): ArchivePlugin {
  return {
    name: 'synthetic',
    formats: ['synthetic'],
    detect: () => true,
    parse: async function* () {
      for (let i = 0; i < n; i++) {
        if (failAt === i) {
          throw new CorruptArchiveError(`synthetic failure at ${i}`);
        }
        yield {
          path: `dir${Math.floor(i / 10)}/file-${i}.txt`,
          type: 'file',
          size: 4,
          mode: 0o644,
          mtime: new Date(1_600_000_000_000 + i),
          sourceFormat: 'synthetic',
          stream: () => Readable.from([Buffer.from(`data${i}`.padEnd(8, 'x'))]),
        };
      }
    },
  };
}

function treeHash(dir: string): Promise<string> {
  const items: string[] = [];
  const walk = async (d: string, rel: string) => {
    for (const name of await readdir(d)) {
      const abs = nodePath.join(d, name);
      const st = await stat(abs);
      const r = rel ? `${rel}/${name}` : name;
      if (st.isDirectory()) {
        // Implicit directories carry creation mtimes, not archive mtimes, so
        // only structure is compared for directories.
        items.push(`${r}|dir`);
        await walk(abs, r);
      } else {
        const h = createHash('sha256')
          .update(await readFile(abs))
          .digest('hex')
          .slice(0, 12);
        items.push(`${r}|file|${st.size}|${h}|${st.mtimeMs}`);
      }
    }
  };
  return walk(dir, '').then(() => items.sort().join('\n'));
}

test('concurrency: output trees are byte-identical across concurrency levels', async () => {
  const out = await tmpOut();
  try {
    const plugin = makeSyntheticPlugin(120);
    const hashes: string[] = [];
    for (const concurrency of [1, 2, 8, 32]) {
      const target = nodePath.join(out, `c${concurrency}`);
      await extract(Buffer.from('synthetic'), target, {
        plugins: [plugin],
        concurrency,
        maxCompressionRatio: 1e9,
      });
      hashes.push(await treeHash(target));
      await rm(target, { recursive: true, force: true });
    }
    for (const h of hashes.slice(1)) {
      assert.equal(h, hashes[0], 'output trees differ across concurrency levels');
    }
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('concurrency: onEntry and onProgress fire in entry order regardless of completion order', async () => {
  const out = await tmpOut();
  try {
    const entryOrder: string[] = [];
    const progressOrder: number[] = [];
    // Slow down every 7th body so completions reorder relative to entries.
    const plugin = makeSyntheticPlugin(60);
    const target = nodePath.join(out, 'ordered');
    await extract(Buffer.from('synthetic'), target, {
      plugins: [plugin],
      concurrency: 8,
      maxCompressionRatio: 1e9,
      onEntry: (entry) => entryOrder.push(entry.path),
      onProgress: (p) => progressOrder.push(p.entriesProcessed),
    });
    const expected = Array.from({ length: 60 }, (_, i) => `dir${Math.floor(i / 10)}/file-${i}.txt`);
    assert.deepEqual(entryOrder, expected);
    assert.deepEqual(
      progressOrder,
      Array.from({ length: 60 }, (_, i) => i + 1),
    );
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('concurrency: failure mid-archive leaves no output and removes staging', async () => {
  const out = await tmpOut();
  try {
    const target = nodePath.join(out, 'result');
    await assert.rejects(
      extract(Buffer.from('synthetic'), target, {
        plugins: [makeSyntheticPlugin(40, 15)],
        concurrency: 8,
        maxCompressionRatio: 1e9,
      }),
      CorruptArchiveError,
    );
    const siblings = await readdir(out);
    assert.deepEqual(
      siblings.filter((f) => f !== 'result'),
      [],
      'staging directories must be cleaned up after failure',
    );
    // Output itself must be absent (atomic).
    await assert.rejects(
      () => readdir(target),
      (e: NodeJS.ErrnoException) => e.code === 'ENOENT',
    );
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('concurrency: mtimes are applied exactly once and preserved', async () => {
  const out = await tmpOut();
  try {
    const target = nodePath.join(out, 'result');
    await extract(Buffer.from('synthetic'), target, {
      plugins: [makeSyntheticPlugin(30)],
      concurrency: 8,
      maxCompressionRatio: 1e9,
    });
    for (let i = 0; i < 30; i++) {
      const st = await stat(nodePath.join(target, `dir${Math.floor(i / 10)}`, `file-${i}.txt`));
      const expected = Math.floor((1_600_000_000_000 + i) / 1000);
      assert.equal(Math.floor(st.mtimeMs / 1000), expected, `mtime mismatch for file-${i}`);
    }
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('concurrency: option is validated (0 and 33 rejected)', async () => {
  const out = await tmpOut();
  try {
    await assert.rejects(
      extract(nodePath.join(fixtures, 'benign', 'file.zip'), nodePath.join(out, 'a'), {
        concurrency: 0,
      }),
      (e: Error & { code: string }) => e.code === 'INVALID_INPUT',
    );
    await assert.rejects(
      extract(nodePath.join(fixtures, 'benign', 'file.zip'), nodePath.join(out, 'b'), {
        concurrency: 33,
      }),
      (e: Error & { code: string }) => e.code === 'INVALID_INPUT',
    );
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('concurrency: real zip fixtures extract identically at concurrency 1 and 8', async () => {
  const out = await tmpOut();
  try {
    const a = nodePath.join(out, 'a');
    const b = nodePath.join(out, 'b');
    await extract(nodePath.join(fixtures, 'benign', 'multiple.zip'), a, { concurrency: 1 });
    await extract(nodePath.join(fixtures, 'benign', 'multiple.zip'), b, { concurrency: 8 });
    assert.equal(await treeHash(a), await treeHash(b));
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('concurrency: existing output is still respected atomically', async () => {
  const out = await tmpOut();
  try {
    const target = nodePath.join(out, 'result');
    await extract(Buffer.from('synthetic'), target, {
      plugins: [makeSyntheticPlugin(20)],
      maxCompressionRatio: 1e9,
    });
    await assert.rejects(
      extract(Buffer.from('synthetic'), target, {
        plugins: [makeSyntheticPlugin(20)],
        concurrency: 8,
      }),
      OutputExistsError,
    );
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});
