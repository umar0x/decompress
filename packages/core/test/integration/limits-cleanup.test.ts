// Tests for resource-limit enforcement and staging cleanup.
//
// Each scenario exercises a specific limit or failure path and verifies the
// staging directory is removed and the output is absent (atomicity).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import nodePath from 'node:path';
import { mkdtemp, rm, readdir, stat, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import { extract } from '../../src/extract.ts';
import { isDecompressError } from '../../src/errors.ts';
import type { ArchivePlugin } from '../../src/types.ts';

async function tmpOut(): Promise<string> {
  return mkdtemp(nodePath.join(tmpdir(), 'decompress-limit-test-'));
}

function synth(n: number, opts?: { bytes?: number; failAt?: number }): ArchivePlugin {
  const bytes = opts?.bytes ?? 16;
  return {
    name: 'synth-limit',
    formats: ['synth-limit'],
    detect: () => true,
    parse: async function* () {
      for (let i = 0; i < n; i++) {
        if (opts?.failAt === i) {
          throw new Error(`synthetic failure at entry ${i}`);
        }
        yield {
          path: `f${i}.txt`,
          type: 'file',
          size: bytes,
          mode: 0o644,
          mtime: new Date(0),
          sourceFormat: 'synth-limit',
          buffer: async () => Buffer.alloc(bytes, i & 0xff),
        };
      }
    },
  };
}

async function assertOutputAbsent(target: string): Promise<void> {
  await assert.rejects(
    () => stat(target),
    (e: NodeJS.ErrnoException) => e.code === 'ENOENT',
    `output should be absent, got: ${target}`,
  );
}

async function assertNoStaging(parent: string): Promise<void> {
  const siblings = await readdir(parent);
  const staging = siblings.filter((s) => s.startsWith('.decompress-tmp-'));
  assert.deepEqual(staging, [], `leftover staging directories: ${staging.join(', ')}`);
}

test('limit: maxFiles is enforced and removes staging', async () => {
  const out = await tmpOut();
  try {
    const target = nodePath.join(out, 'r');
    await assert.rejects(
      () =>
        extract(Buffer.from('synth-limit'), target, {
          plugins: [synth(20)],
          maxFiles: 5,
          maxArchiveSize: 1024,
          maxCompressionRatio: 1e9,
        }),
      (e: unknown) => isDecompressError(e) && (e as { code: string }).code === 'LIMIT_FILE_COUNT',
    );
    await assertOutputAbsent(target);
    await assertNoStaging(out);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('limit: maxTotalSize is enforced mid-write and removes staging', async () => {
  const out = await tmpOut();
  try {
    const target = nodePath.join(out, 'r');
    await assert.rejects(
      () =>
        extract(Buffer.from('synth-limit'), target, {
          plugins: [synth(20, { bytes: 1024 })],
          maxTotalSize: 2048,
          maxArchiveSize: 1024,
          maxCompressionRatio: 1e9,
        }),
      (e: unknown) => isDecompressError(e) && (e as { code: string }).code === 'LIMIT_TOTAL_SIZE',
    );
    await assertOutputAbsent(target);
    await assertNoStaging(out);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('limit: maxEntrySize is enforced per entry and removes staging', async () => {
  const out = await tmpOut();
  try {
    const target = nodePath.join(out, 'r');
    await assert.rejects(
      () =>
        extract(Buffer.from('synth-limit'), target, {
          plugins: [synth(5, { bytes: 4096 })],
          maxEntrySize: 1024,
          maxArchiveSize: 1024,
          maxCompressionRatio: 1e9,
        }),
      (e: unknown) => isDecompressError(e) && (e as { code: string }).code === 'LIMIT_ENTRY_SIZE',
    );
    await assertOutputAbsent(target);
    await assertNoStaging(out);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('limit: maxCompressionRatio is enforced and removes staging', async () => {
  const out = await tmpOut();
  try {
    const target = nodePath.join(out, 'r');
    // 4 entries of 4 KiB each from an 8-byte archive: declared ratio > 200.
    await assert.rejects(
      () =>
        extract(Buffer.from('synth-limit'), target, {
          plugins: [synth(4, { bytes: 4096 })],
          maxArchiveSize: 1024,
          maxCompressionRatio: 10,
        }),
      (e: unknown) =>
        isDecompressError(e) && (e as { code: string }).code === 'LIMIT_COMPRESSION_RATIO',
    );
    await assertOutputAbsent(target);
    await assertNoStaging(out);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('limit: parser error mid-stream removes staging and leaves output absent', async () => {
  const out = await tmpOut();
  try {
    const target = nodePath.join(out, 'r');
    await assert.rejects(
      () =>
        extract(Buffer.from('synth-limit'), target, {
          plugins: [synth(10, { failAt: 3 })],
          maxArchiveSize: 1024,
          maxCompressionRatio: 1e9,
        }),
      (e: unknown) => isDecompressError(e) || e instanceof Error,
    );
    await assertOutputAbsent(target);
    await assertNoStaging(out);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('limit: AbortSignal after partial writes removes staging', async () => {
  const out = await tmpOut();
  try {
    const target = nodePath.join(out, 'r');
    const ac = new AbortController();
    let count = 0;
    const plugin: ArchivePlugin = {
      name: 'abort-synth',
      formats: ['abort-synth'],
      detect: () => true,
      parse: async function* () {
        for (let i = 0; i < 50; i++) {
          if (count++ === 5) ac.abort();
          yield {
            path: `f${i}.txt`,
            type: 'file',
            size: 64,
            mode: 0o644,
            mtime: new Date(0),
            sourceFormat: 'abort-synth',
            buffer: async () => Buffer.alloc(64),
          };
        }
      },
    };
    await assert.rejects(
      () =>
        extract(Buffer.from('abort-synth'), target, {
          plugins: [plugin],
          signal: ac.signal,
          maxArchiveSize: 1024,
          maxCompressionRatio: 1e9,
        }),
      (e: unknown) => isDecompressError(e) && (e as { code: string }).code === 'ABORTED',
    );
    await assertOutputAbsent(target);
    await assertNoStaging(out);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('limit: successful extraction leaves no staging directory', async () => {
  const out = await tmpOut();
  try {
    const target = nodePath.join(out, 'r');
    const result = await extract(Buffer.from('synth-limit'), target, {
      plugins: [synth(10, { bytes: 32 })],
      maxArchiveSize: 1024,
      maxCompressionRatio: 1e9,
    });
    assert.equal(result.entries.length, 10);
    assert.equal(result.totalBytes, 10 * 32);
    // Verify a file landed
    const data = await readFile(nodePath.join(target, 'f0.txt'));
    assert.equal(data.length, 32);
    // Staging dir removed after rename
    await assertNoStaging(out);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('limit: overwrite=true replaces staging target cleanly without leftover backups', async () => {
  const out = await tmpOut();
  try {
    const target = nodePath.join(out, 'r');
    // First extract: plants 3 files
    await extract(Buffer.from('synth-limit'), target, {
      plugins: [synth(3, { bytes: 16 })],
      maxArchiveSize: 1024,
      maxCompressionRatio: 1e9,
    });
    // Second extract with overwrite=true: replaces the tree
    const result = await extract(Buffer.from('synth-limit'), target, {
      plugins: [synth(5, { bytes: 8 })],
      overwrite: true,
      maxArchiveSize: 1024,
      maxCompressionRatio: 1e9,
    });
    assert.equal(result.entries.length, 5);
    // No .old.* backup siblings left
    const siblings = await readdir(out);
    const backups = siblings.filter((s) => s.startsWith('r.old.'));
    assert.deepEqual(backups, [], `leftover backup directories: ${backups.join(', ')}`);
    // New tree has 5 files (old tree's 3 are gone)
    const files = await readdir(target);
    assert.equal(files.length, 5);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});
