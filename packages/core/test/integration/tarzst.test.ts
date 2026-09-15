// Integration tests for the tar.zst format plugin.
//
// Zstd decompression is built into node:zlib as of Node 22.15. The plugin
// feature-detects at module load time, so tests assert both the supported
// path (real extraction) and the graceful-degradation path (when running on
// a Node version without node:zlib.createZstdDecompress, the format reports
// as unknown and surfaces a clear runtime error if a caller bypasses
// detection).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import nodePath from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { zstdCompressSync } from 'node:zlib';

import { extract, listArchive, auditArchive } from '../../src/index.ts';
import { tarZstdPlugin, isTarZstdSupported } from '../../src/formats/tarzst.ts';
import { detectFormat } from '../../src/detect-format.ts';

const require2 = createRequire(import.meta.url);
const tar = require2('tar-stream');

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

async function buildTarZst(entries: Array<{ name: string; content?: Buffer }>): Promise<Buffer> {
  const tarBuf = await buildTar(entries);
  return zstdCompressSync(tarBuf);
}

test('tar.zst: detect() recognizes the Zstd frame magic', () => {
  const zstBuf = zstdCompressSync(Buffer.from('hello'));
  assert.equal(zstBuf[0], 0x28);
  assert.equal(zstBuf[1], 0xb5);
  assert.equal(zstBuf[2], 0x2f);
  assert.equal(zstBuf[3], 0xfd);
  assert.equal(detectFormat(zstBuf), 'zst');
  assert.equal(tarZstdPlugin.detect?.(zstBuf), isTarZstdSupported());
});

test('tar.zst: extract() returns sourceFormat tar.zst and writes files', async () => {
  if (!isTarZstdSupported()) {
    test.skip('node:zlib.createZstdDecompress unavailable on this Node');
    return;
  }
  const out = await mkdtemp(nodePath.join(tmpdir(), 'decompress-tarzst-'));
  try {
    const archive = await buildTarZst([
      { name: 'hello.txt', content: Buffer.from('hello world') },
      { name: 'dir/nested.txt', content: Buffer.from('nested') },
    ]);
    const target = nodePath.join(out, 'result');
    const result = await extract(archive, target, { maxArchiveSize: archive.length + 1 });
    assert.deepEqual(result.detectedFormats, ['tar.zst']);
    assert.equal(result.entries.length, 2);
    assert.equal(result.entries[0]!.sourceFormat, 'tar.zst');
    assert.equal(await readFile(nodePath.join(target, 'hello.txt'), 'utf8'), 'hello world');
    assert.equal(await readFile(nodePath.join(target, 'dir', 'nested.txt'), 'utf8'), 'nested');
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('tar.zst: listArchive returns entries without writing', async () => {
  if (!isTarZstdSupported()) {
    test.skip('node:zlib.createZstdDecompress unavailable on this Node');
    return;
  }
  const archive = await buildTarZst([{ name: 'a.txt', content: Buffer.from('a') }]);
  const entries = await listArchive(archive, { maxArchiveSize: archive.length + 1 });
  assert.equal(entries.length, 1);
  assert.equal(entries[0]!.path, 'a.txt');
  assert.equal(entries[0]!.sourceFormat, 'tar.zst');
});

test('tar.zst: auditArchive reports low risk for a benign archive', async () => {
  if (!isTarZstdSupported()) {
    test.skip('node:zlib.createZstdDecompress unavailable on this Node');
    return;
  }
  const archive = await buildTarZst([{ name: 'a.txt', content: Buffer.from('a') }]);
  const report = await auditArchive(archive, { maxArchiveSize: archive.length + 1 });
  assert.deepEqual(report.detectedFormats, ['tar.zst']);
  assert.equal(report.entryCount, 1);
  assert.equal(report.riskLevel, 'low');
});

test('tar.zst: corrupted zstd bytes produce a typed corruption error', async () => {
  if (!isTarZstdSupported()) {
    test.skip('node:zlib.createZstdDecompress unavailable on this Node');
    return;
  }
  const out = await mkdtemp(nodePath.join(tmpdir(), 'decompress-tarzst-'));
  try {
    // Valid magic but garbage after.
    const corrupted = Buffer.concat([
      Buffer.from([0x28, 0xb5, 0x2f, 0xfd]),
      Buffer.alloc(32, 0xff),
    ]);
    await assert.rejects(
      () => extract(corrupted, nodePath.join(out, 'r'), { maxArchiveSize: corrupted.length + 1 }),
      (e: unknown) => {
        const code = (e as { code?: string }).code;
        return code === 'CORRUPT_ARCHIVE' || code === 'UNKNOWN_FORMAT';
      },
    );
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('tar.zst: plugin honors the same path-policy pipeline as other formats', async () => {
  if (!isTarZstdSupported()) {
    test.skip('node:zlib.createZstdDecompress unavailable on this Node');
    return;
  }
  const out = await mkdtemp(nodePath.join(tmpdir(), 'decompress-tarzst-'));
  try {
    // Traversal path must be rejected by the central path policy, not by the
    // parser, so the same regression applies to tar.zst as to tar.gz/tar.bz2.
    const archive = await buildTarZst([{ name: '../escape.txt', content: Buffer.from('x') }]);
    await assert.rejects(
      () => extract(archive, nodePath.join(out, 'r'), { maxArchiveSize: archive.length + 1 }),
      (e: unknown) => (e as { code?: string }).code === 'PATH_TRAVERSAL',
    );
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('tar.zst: directory entries from a tar.zst archive are honored', async () => {
  if (!isTarZstdSupported()) {
    test.skip('node:zlib.createZstdDecompress unavailable on this Node');
    return;
  }
  const out = await mkdtemp(nodePath.join(tmpdir(), 'decompress-tarzst-'));
  try {
    const pack = tar.pack();
    const drain = (async () => {
      const chunks: Buffer[] = [];
      for await (const c of pack) chunks.push(c);
      return Buffer.concat(chunks);
    })();
    await new Promise<void>((resolve, reject) =>
      pack.entry(
        { name: 'sub/', type: 'directory', mode: 0o755, mtime: new Date(0) },
        (e: Error | null) => (e ? reject(e) : resolve()),
      ),
    );
    await new Promise<void>((resolve, reject) =>
      pack.entry(
        { name: 'sub/f.txt', type: 'file', mode: 0o644, mtime: new Date(0), size: 1 },
        Buffer.from('x'),
        (e: Error | null) => (e ? reject(e) : resolve()),
      ),
    );
    pack.finalize();
    const tarBuf = await drain;
    const archive = zstdCompressSync(tarBuf);
    const target = nodePath.join(out, 'r');
    const result = await extract(archive, target, { maxArchiveSize: archive.length + 1 });
    assert.equal(result.entries.length, 2);
    assert.ok(result.entries.some((e) => e.type === 'directory'));
    const children = await readdir(target);
    assert.ok(children.includes('sub'));
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});
