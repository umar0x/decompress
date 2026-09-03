// Regression tests for dot-segment path compatibility: archives produced by
// commands like `tar czf archive.tgz .` carry './' prefixes and interior
// '/./' segments that are semantically neutral and must extract cleanly.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import nodePath from 'node:path';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

import { extract } from '../../src/extract.ts';
import { listArchive } from '../../src/list.ts';
import { auditArchive } from '../../src/audit.ts';
import { stripDotSegments, validatePath } from '../../src/writer/path-security.ts';
import type { PathCtx } from '../../src/types.ts';
import { DEFAULT_LIMITS } from '../../src/types.ts';

const require2 = createRequire(import.meta.url);
const tar = require2('tar-stream');
const fixtures = nodePath.join(import.meta.dirname, '..', '..', '..', 'test-fixtures');

const posixCtx: PathCtx = { platform: 'posix', caseInsensitive: false, limits: DEFAULT_LIMITS };

async function buildTar(entries: Array<{ name: string; content?: Buffer }>): Promise<Buffer> {
  const pack = tar.pack();
  const drain = (async () => {
    const chunks: Buffer[] = [];
    for await (const c of pack) chunks.push(c);
    return Buffer.concat(chunks);
  })();
  for (const e of entries) {
    await new Promise<void>((resolve, reject) =>
      pack.entry(
        {
          name: e.name,
          type: 'file',
          mode: 0o644,
          mtime: new Date('2020-01-01T00:00:00Z'),
          size: e.content?.length ?? 0,
        },
        e.content ?? Buffer.alloc(0),
        (error: Error | null | undefined) => (error ? reject(error) : resolve()),
      ),
    );
  }
  pack.finalize();
  return drain;
}

test('extract: leading ./ prefixes extract like tar czf x.tgz . output', async () => {
  const out = await mkdtemp(nodePath.join(tmpdir(), 'decompress-dots-test-'));
  try {
    const archive = nodePath.join(out, 'dots.tar');
    const { writeFileSync } = await import('node:fs');
    writeFileSync(
      archive,
      await buildTar([
        { name: './file.txt', content: Buffer.from('LEADING') },
        { name: './dir/nested.txt', content: Buffer.from('NESTED') },
      ]),
    );
    const result = await extract(archive, nodePath.join(out, 'result'), {});
    assert.deepEqual(result.entries.map((e) => e.path).sort(), ['dir/nested.txt', 'file.txt']);
    assert.equal(await readFile(nodePath.join(out, 'result', 'file.txt'), 'utf8'), 'LEADING');
    assert.equal(
      await readFile(nodePath.join(out, 'result', 'dir', 'nested.txt'), 'utf8'),
      'NESTED',
    );
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('extract: interior /./ segments are normalized away', async () => {
  const out = await mkdtemp(nodePath.join(tmpdir(), 'decompress-dots-test-'));
  try {
    const archive = nodePath.join(out, 'interior.tar');
    const { writeFileSync } = await import('node:fs');
    writeFileSync(
      archive,
      await buildTar([{ name: 'a/./b/./file.txt', content: Buffer.from('INTERIOR') }]),
    );
    const result = await extract(archive, nodePath.join(out, 'result'), {});
    assert.deepEqual(
      result.entries.map((e) => e.path),
      ['a/b/file.txt'],
    );
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('leading_dots.tar.gz fixture extracts with paths preserved', async () => {
  const out = await mkdtemp(nodePath.join(tmpdir(), 'decompress-dots-test-'));
  try {
    const result = await extract(
      nodePath.join(fixtures, 'benign', 'leading_dots.tar.gz'),
      nodePath.join(out, 'result'),
      {},
    );
    assert.ok(result.entries.length >= 2);
    for (const entry of result.entries) {
      assert.ok(!entry.path.startsWith('./'), `path still has ./ prefix: ${entry.path}`);
    }
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('dot-only paths are still rejected as empty', () => {
  assert.throws(() => validatePath('.', posixCtx), /empty path/);
  assert.throws(() => validatePath('././', posixCtx), /trailing separator|empty path/);
});

test('stripDotSegments is idempotent and preserves benign names', () => {
  assert.equal(stripDotSegments(stripDotSegments('./a/./b')), 'a/b');
  assert.equal(stripDotSegments('a/b'), 'a/b');
  assert.equal(stripDotSegments('.hidden'), '.hidden');
  assert.equal(stripDotSegments('..sibling'), '..sibling');
  assert.equal(stripDotSegments('...'), '...');
});

test('listArchive and auditArchive accept dot-segment archives', async () => {
  const out = await mkdtemp(nodePath.join(tmpdir(), 'decompress-dots-test-'));
  try {
    const archive = nodePath.join(out, 'list.tar');
    const { writeFileSync } = await import('node:fs');
    writeFileSync(archive, await buildTar([{ name: './x.txt', content: Buffer.from('X') }]));
    const entries = await listArchive(archive);
    // listArchive reports archive facts: the raw declared path.
    assert.deepEqual(
      entries.map((e) => e.path),
      ['./x.txt'],
    );
    const report = await auditArchive(archive);
    assert.equal(report.riskLevel, 'low');
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});
