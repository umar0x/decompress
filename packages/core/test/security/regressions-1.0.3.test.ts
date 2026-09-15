// Regression tests for fixes shipped in 1.0.3.
//
// Each test pins a specific behavior that was wrong or inconsistent before
// the fix. Failing any of these blocks the release.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import nodePath from 'node:path';
import { mkdtemp, rm, readdir, stat, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import { extract, listArchive, auditArchive } from '../../src/index.ts';
import { isDecompressError } from '../../src/errors.ts';
import type { ArchivePlugin } from '../../src/types.ts';

async function tmpOut(): Promise<string> {
  return mkdtemp(nodePath.join(tmpdir(), 'decompress-103-regression-'));
}

test('1.0.3 regression: detectedFormat reports plugin name (tar.gz) for gzip magic', async () => {
  const out = await tmpOut();
  try {
    const here = nodePath.join(import.meta.dirname, '..', '..', '..', 'test-fixtures', 'benign');
    const target = nodePath.join(out, 'r');
    const result = await extract(nodePath.join(here, 'file.tar.gz'), target);
    assert.equal(result.detectedFormats[0], 'tar.gz');
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('1.0.3 regression: detectedFormat reports plugin name (tar.bz2) for bzip2 magic', async () => {
  const out = await tmpOut();
  try {
    const here = nodePath.join(import.meta.dirname, '..', '..', '..', 'test-fixtures', 'benign');
    const target = nodePath.join(out, 'r');
    const result = await extract(nodePath.join(here, 'file.tar.bz2'), target);
    assert.equal(result.detectedFormats[0], 'tar.bz2');
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('1.0.3 regression: auditArchive detectedFormats matches plugin name', async () => {
  const here = nodePath.join(import.meta.dirname, '..', '..', '..', 'test-fixtures', 'benign');
  const report = await auditArchive(nodePath.join(here, 'file.tar.gz'));
  assert.equal(report.detectedFormats[0], 'tar.gz');
});

test('1.0.3 regression: listArchive hints use plugin name (consistent across APIs)', async () => {
  // A custom plugin that records the hints it received.
  let receivedHints: readonly string[] | undefined;
  const plugin: ArchivePlugin = {
    name: 'hint-probe',
    formats: ['hint-probe'],
    detect: () => true,
    parse: async function* (input) {
      receivedHints = input.hints;
      yield { path: 'a.txt', type: 'file', sourceFormat: 'hint-probe', size: 1 };
    },
  };
  await listArchive(Buffer.from('hint-probe'), { plugins: [plugin], maxArchiveSize: 1024 });
  assert.deepEqual(receivedHints, ['hint-probe']);
});

test('1.0.3 regression: rename error classification does not misclassify non-EXDEV failures', async () => {
  // Trigger an ENOTEMPTY-equivalent by planting a non-empty target dir, then
  // attempting extraction with overwrite: false. The pre-check should reject
  // with OutputExistsError, not CrossDeviceRenameError.
  const out = await tmpOut();
  try {
    const target = nodePath.join(out, 'r');
    await mkdir(target, { recursive: true });
    await writeFile(nodePath.join(target, 'preexisting.txt'), 'data');
    const here = nodePath.join(import.meta.dirname, '..', '..', '..', 'test-fixtures', 'benign');
    await assert.rejects(
      () => extract(nodePath.join(here, 'file.zip'), target),
      (e: unknown) => {
        const code = (e as { code?: string }).code;
        return code === 'ATOMIC_OUTPUT_EXISTS';
      },
    );
    // Pre-existing file must still be there (no destructive overwrite).
    const st = await stat(nodePath.join(target, 'preexisting.txt'));
    assert.equal(st.size, 4);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('1.0.3 regression: large-zip extraction completes with all entries present', async () => {
  // Smoke test that a 500-entry synthetic zip extracts fully. Catches any
  // regression where a body stream is dropped or a write is silently skipped.
  const out = await tmpOut();
  try {
    const plugin: ArchivePlugin = {
      name: 'large-synth',
      formats: ['large-synth'],
      detect: () => true,
      parse: async function* () {
        for (let i = 0; i < 500; i++) {
          yield {
            path: `f${i}.txt`,
            type: 'file',
            size: 8,
            mode: 0o644,
            mtime: new Date(0),
            sourceFormat: 'large-synth',
            buffer: async () => Buffer.from(`data-${i}`.padEnd(8, 'x')),
          };
        }
      },
    };
    const target = nodePath.join(out, 'r');
    const result = await extract(Buffer.from('large-synth'), target, {
      plugins: [plugin],
      maxCompressionRatio: 1e9,
      maxArchiveSize: 1024,
    });
    assert.equal(result.entries.length, 500);
    assert.equal(result.totalBytes, 500 * 8);
    // Verify a sample of files actually landed on disk.
    for (const i of [0, 1, 249, 250, 499]) {
      const st = await stat(nodePath.join(target, `f${i}.txt`));
      assert.equal(st.size, 8, `f${i}.txt size mismatch`);
    }
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('1.0.3 regression: parser warning surfaces through onWarning on all APIs', async () => {
  const plugin: ArchivePlugin = {
    name: 'warn-probe',
    formats: ['warn-probe'],
    detect: () => true,
    parse: async function* (input, ctx) {
      ctx.warn('parser_test_warning', 'a parser-emitted warning', { extra: 1 });
      yield { path: 'a.txt', type: 'file', sourceFormat: 'warn-probe', size: 0 };
    },
  };
  const input = Buffer.from('warn-probe');

  // extract
  const out = await tmpOut();
  try {
    const extractWarnings: string[] = [];
    await extract(input, nodePath.join(out, 'r'), {
      plugins: [plugin],
      maxArchiveSize: 1024,
      onWarning: (w) => extractWarnings.push(w.code),
    });
    assert.ok(extractWarnings.includes('parser_test_warning'));

    // listArchive
    const listWarnings: string[] = [];
    await listArchive(input, {
      plugins: [plugin],
      maxArchiveSize: 1024,
      onWarning: (w) => listWarnings.push(w.code),
    });
    assert.ok(listWarnings.includes('parser_test_warning'));

    // auditArchive captures parser warnings as low-severity findings
    const report = await auditArchive(input, { plugins: [plugin], maxArchiveSize: 1024 });
    assert.ok(report.findings.some((f) => f.code === 'parser_test_warning'));
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('1.0.3 regression: cleanup leaves no staging directories after a limit violation', async () => {
  // When a resource limit triggers mid-archive, the staging directory must
  // be removed and the output must be absent (atomic).
  const out = await tmpOut();
  try {
    const plugin: ArchivePlugin = {
      name: 'over-limit',
      formats: ['over-limit'],
      detect: () => true,
      parse: async function* () {
        for (let i = 0; i < 5; i++) {
          yield {
            path: `f${i}.txt`,
            type: 'file',
            size: 100,
            sourceFormat: 'over-limit',
            buffer: async () => Buffer.alloc(100),
          };
        }
      },
    };
    const target = nodePath.join(out, 'r');
    await assert.rejects(
      () =>
        extract(Buffer.from('over-limit'), target, {
          plugins: [plugin],
          maxTotalSize: 250,
          maxArchiveSize: 1024,
          maxCompressionRatio: 1e9,
        }),
      (e: unknown) => isDecompressError(e),
    );
    // Output absent
    await assert.rejects(() => stat(target), (e: NodeJS.ErrnoException) => e.code === 'ENOENT');
    // No staging directories left in parent
    const siblings = await readdir(out);
    const staging = siblings.filter((s) => s.startsWith('.decompress-tmp-'));
    assert.deepEqual(staging, []);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});
