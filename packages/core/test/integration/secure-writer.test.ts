// Integration tests for the secure writer and atomic extractor.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import nodePath from 'node:path';
import {
  mkdtemp,
  mkdir,
  writeFile,
  symlink,
  rm,
  readdir,
  readFile,
  lstat,
  stat,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';

import { atomicExtract, cleanupTempDir } from '../../src/writer/atomic-extractor.ts';
import { writeEntry, preventWritingThroughSymlink } from '../../src/writer/secure-writer.ts';
import { sanitizeMode } from '../../src/writer/permissions.ts';
import { detectPlatform } from '../../src/writer/path-security.ts';
import type { ArchiveEntry } from '../../src/types.ts';
import { DEFAULT_LIMITS } from '../../src/types.ts';
import {
  AbortError,
  LinkThroughSymlinkError,
  OutputExistsError,
  OutputIsSymlinkError,
  OutputIsFileError,
  SymlinkRefusedError,
  HardlinkRefusedError,
  EntrySizeExceededError,
} from '../../src/errors.ts';

function makeEntry(p: Partial<ArchiveEntry> & { path: string }): ArchiveEntry {
  return {
    type: 'file',
    sourceFormat: 'test',
    ...p,
  };
}

function defaultPolicy() {
  return {
    allowSymlinks: false,
    allowHardlinks: false,
    preservePermissions: false,
    overwrite: false,
    symlinkFallback: 'error' as const,
  };
}

async function makeTempDir(): Promise<string> {
  return mkdtemp(nodePath.join(tmpdir(), 'decompress-writer-test-'));
}

test('atomicExtract: writes a file and a directory atomically', async () => {
  const out = await makeTempDir();
  const output = nodePath.join(out, 'result');
  try {
    const entries: ArchiveEntry[] = [
      makeEntry({ path: 'dir', type: 'directory', mode: 0o755 }),
      makeEntry({
        path: 'dir/hello.txt',
        type: 'file',
        mode: 0o644,
        buffer: () => Promise.resolve(Buffer.from('hello world')),
      }),
    ];
    const result = await atomicExtract(entries, {
      output,
      limits: DEFAULT_LIMITS,
      policy: defaultPolicy(),
      archiveSize: 100,
    });
    assert.equal(result.entries.length, 2);
    assert.equal(result.totalBytes, 11);
    const content = await readFile(nodePath.join(output, 'dir', 'hello.txt'), 'utf8');
    assert.equal(content, 'hello world');
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('atomicExtract: creates implicit parents for nested directory entries', async () => {
  const out = await makeTempDir();
  const output = nodePath.join(out, 'result');
  try {
    await atomicExtract([makeEntry({ path: 'a/b', type: 'directory' })], {
      output,
      limits: DEFAULT_LIMITS,
      policy: defaultPolicy(),
      archiveSize: 1,
    });
    assert.equal((await stat(nodePath.join(output, 'a', 'b'))).isDirectory(), true);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

// Failure cleanup

test('atomicExtract: failure preserves output and removes staging', async () => {
  const out = await makeTempDir();
  const output = nodePath.join(out, 'result');
  try {
    // One good entry, one entry that escapes (.. → rejected by validatePath).
    const entries: ArchiveEntry[] = [
      makeEntry({
        path: 'good.txt',
        type: 'file',
        buffer: () => Promise.resolve(Buffer.from('ok')),
      }),
      makeEntry({
        path: '../evil.txt',
        type: 'file',
        buffer: () => Promise.resolve(Buffer.from('evil')),
      }),
    ];
    await assert.rejects(() =>
      atomicExtract(entries, {
        output,
        limits: DEFAULT_LIMITS,
        policy: defaultPolicy(),
        archiveSize: 100,
      }),
    );
    await assert.rejects(() => lstat(output), { code: 'ENOENT' });
    // No temp dirs left behind.
    const parent = nodePath.dirname(output);
    const parentChildren = await readdir(parent);
    const leftoverTemps = parentChildren.filter((c) => c.startsWith('.decompress-tmp-'));
    assert.equal(leftoverTemps.length, 0, 'temp dir should be cleaned up');
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('atomicExtract: refuses non-empty existing output by default', async () => {
  const out = await makeTempDir();
  const output = nodePath.join(out, 'result');
  try {
    await mkdir(output);
    await writeFile(nodePath.join(output, 'preexisting.txt'), 'data');
    const entries: ArchiveEntry[] = [
      makeEntry({ path: 'a.txt', type: 'file', buffer: () => Promise.resolve(Buffer.from('a')) }),
    ];
    await assert.rejects(
      () =>
        atomicExtract(entries, {
          output,
          limits: DEFAULT_LIMITS,
          policy: defaultPolicy(),
          archiveSize: 1,
        }),
      OutputExistsError,
    );
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('atomicExtract: overwrite atomically replaces an existing output tree', async () => {
  const out = await makeTempDir();
  const output = nodePath.join(out, 'result');
  try {
    await mkdir(output);
    await writeFile(nodePath.join(output, 'old.txt'), 'old');
    await atomicExtract([makeEntry({ path: 'new.txt', buffer: async () => Buffer.from('new') })], {
      output,
      limits: DEFAULT_LIMITS,
      policy: { ...defaultPolicy(), overwrite: true },
      archiveSize: 3,
    });
    assert.equal(await readFile(nodePath.join(output, 'new.txt'), 'utf8'), 'new');
    await assert.rejects(() => lstat(nodePath.join(output, 'old.txt')), { code: 'ENOENT' });
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('atomicExtract: commits over an existing empty output directory', async () => {
  const out = await makeTempDir();
  const output = nodePath.join(out, 'result');
  try {
    await mkdir(output);
    await atomicExtract([], {
      output,
      limits: DEFAULT_LIMITS,
      policy: defaultPolicy(),
      archiveSize: 0,
    });
    assert.deepEqual(await readdir(output), []);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('atomicExtract: refuses a regular file as output', async () => {
  const out = await makeTempDir();
  const output = nodePath.join(out, 'result');
  try {
    await writeFile(output, 'not a directory');
    await assert.rejects(
      () =>
        atomicExtract([], {
          output,
          limits: DEFAULT_LIMITS,
          policy: defaultPolicy(),
          archiveSize: 0,
        }),
      OutputIsFileError,
    );
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('atomicExtract: refuses a symlink as output', async (t) => {
  const out = await makeTempDir();
  const real = nodePath.join(out, 'real');
  const link = nodePath.join(out, 'link');
  try {
    await mkdir(real);
    if (!(await createSymlinkOrSkip(t, real, link))) return;
    const entries: ArchiveEntry[] = [
      makeEntry({ path: 'a.txt', type: 'file', buffer: () => Promise.resolve(Buffer.from('a')) }),
    ];
    await assert.rejects(
      () =>
        atomicExtract(entries, {
          output: link,
          limits: DEFAULT_LIMITS,
          policy: defaultPolicy(),
          archiveSize: 1,
        }),
      OutputIsSymlinkError,
    );
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('atomicExtract: refuses symlink entries by default', async () => {
  const out = await makeTempDir();
  const output = nodePath.join(out, 'result');
  try {
    const entries: ArchiveEntry[] = [
      makeEntry({ path: 'link', type: 'symlink', linkTarget: 'target' }),
    ];
    await assert.rejects(
      () =>
        atomicExtract(entries, {
          output,
          limits: DEFAULT_LIMITS,
          policy: defaultPolicy(),
          archiveSize: 1,
        }),
      SymlinkRefusedError,
    );
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('atomicExtract: refuses hardlink entries by default', async () => {
  const out = await makeTempDir();
  const output = nodePath.join(out, 'result');
  try {
    const entries: ArchiveEntry[] = [
      makeEntry({
        path: 'real.txt',
        type: 'file',
        buffer: () => Promise.resolve(Buffer.from('x')),
      }),
      makeEntry({ path: 'link', type: 'hardlink', linkTarget: 'real.txt' }),
    ];
    await assert.rejects(
      () =>
        atomicExtract(entries, {
          output,
          limits: DEFAULT_LIMITS,
          policy: defaultPolicy(),
          archiveSize: 1,
        }),
      HardlinkRefusedError,
    );
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('atomicExtract: strips setuid from extracted files', async () => {
  const out = await makeTempDir();
  const output = nodePath.join(out, 'result');
  try {
    const entries: ArchiveEntry[] = [
      makeEntry({
        path: 'suid.txt',
        type: 'file',
        mode: 0o4755,
        buffer: () => Promise.resolve(Buffer.from('x')),
      }),
    ];
    await atomicExtract(entries, {
      output,
      limits: DEFAULT_LIMITS,
      policy: defaultPolicy(),
      archiveSize: 1,
    });
    const st = await stat(nodePath.join(output, 'suid.txt'));
    assert.equal(st.mode & 0o7000, 0, 'SUID/SGID/sticky bits must be stripped');
    // Executable files remain executable after special bits are stripped.
    if (process.platform !== 'win32') {
      assert.equal(st.mode & 0o100, 0o100, 'execute bit preserved');
    }
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('preventWritingThroughSymlink: rejects a planted symlink', async (t) => {
  const out = await makeTempDir();
  try {
    // Plant a symlink at out/trap → /tmp
    if (!(await createSymlinkOrSkip(t, tmpdir(), nodePath.join(out, 'trap')))) return;
    await assert.rejects(
      () => preventWritingThroughSymlink(nodePath.join(out, 'trap', 'evil'), out),
      LinkThroughSymlinkError,
    );
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('preventWritingThroughSymlink: rejects directories through a planted symlink', async (t) => {
  const out = await makeTempDir();
  const output = nodePath.join(out, 'result');
  try {
    // Pre-create the output dir and plant a symlink inside it BEFORE extraction.
    // We can't easily do this through atomicExtract (it creates a fresh temp dir),
    // so test writeEntry directly with a pre-planted symlink at the dest.
    await mkdir(output, { recursive: true });
    if (!(await createSymlinkOrSkip(t, tmpdir(), nodePath.join(output, 'trap')))) return;

    const entries: ArchiveEntry[] = [makeEntry({ path: 'trap/subdir', type: 'directory' })];
    // Use writeEntry directly against the pre-planted output.
    await assert.rejects(
      () =>
        writeEntry(entries[0]!, {
          realOutputPath: output,
          umask: process.umask(),
          limits: DEFAULT_LIMITS,
          policy: defaultPolicy(),
          createdDirs: new Set([output]),
          warnings: [],
          pathCtx: { platform: detectPlatform(), caseInsensitive: false, limits: DEFAULT_LIMITS },
        }),
      LinkThroughSymlinkError,
    );
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('atomicExtract: honors an abort signal', async () => {
  const out = await makeTempDir();
  const output = nodePath.join(out, 'result');
  const ac = new AbortController();
  try {
    const entries: ArchiveEntry[] = [
      makeEntry({ path: 'a.txt', type: 'file', buffer: () => Promise.resolve(Buffer.from('a')) }),
      makeEntry({ path: 'b.txt', type: 'file', buffer: () => Promise.resolve(Buffer.from('b')) }),
    ];
    ac.abort();
    await assert.rejects(
      () =>
        atomicExtract(entries, {
          output,
          limits: DEFAULT_LIMITS,
          policy: defaultPolicy(),
          signal: ac.signal,
          archiveSize: 2,
        }),
      AbortError,
    );
    await assert.rejects(() => lstat(output), { code: 'ENOENT' });
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

async function createSymlinkOrSkip(
  t: { skip(message?: string): void },
  target: string,
  linkPath: string,
): Promise<boolean> {
  try {
    await symlink(target, linkPath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM') {
      t.skip('symlink creation is not permitted in this environment');
      return false;
    }
    throw error;
  }
}

test('atomicExtract: hardlinks do not change target timestamps', async () => {
  const out = await makeTempDir();
  const output = nodePath.join(out, 'result');
  try {
    // Create a file with a specific mtime, then a hardlink whose mtime differs.
    const oldTime = new Date('2020-01-01T00:00:00Z');
    const linkTime = new Date('2030-01-01T00:00:00Z');
    const entries: ArchiveEntry[] = [
      makeEntry({
        path: 'real.txt',
        type: 'file',
        mode: 0o644,
        mtime: oldTime,
        buffer: () => Promise.resolve(Buffer.from('x')),
      }),
      makeEntry({ path: 'link.txt', type: 'hardlink', linkTarget: 'real.txt', mtime: linkTime }),
    ];
    await atomicExtract(entries, {
      output,
      limits: DEFAULT_LIMITS,
      policy: { ...defaultPolicy(), allowHardlinks: true },
      archiveSize: 1,
    });
    // The real file's mtime should be oldTime (2020), NOT linkTime (2030).
    const st = await stat(nodePath.join(output, 'real.txt'));
    const realMtime = new Date(st.mtime.getTime());
    // Should be close to oldTime (within a few seconds for FS precision).
    assert.ok(
      Math.abs(realMtime.getTime() - oldTime.getTime()) < 5000,
      `real mtime ${realMtime.toISOString()} should be ~${oldTime.toISOString()}, not ${linkTime.toISOString()}`,
    );
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('atomicExtract: enforces entry size limits', async () => {
  const out = await makeTempDir();
  const output = nodePath.join(out, 'result');
  try {
    const big = Buffer.alloc(2000, 0x41); // 2000 bytes
    const entries: ArchiveEntry[] = [
      makeEntry({ path: 'big.txt', type: 'file', size: 2000, buffer: () => Promise.resolve(big) }),
    ];
    await assert.rejects(
      () =>
        atomicExtract(entries, {
          output,
          limits: { ...DEFAULT_LIMITS, maxEntrySize: 1024 },
          policy: defaultPolicy(),
          archiveSize: 2000,
        }),
      EntrySizeExceededError,
    );
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('atomicExtract: creates hardlinks after their targets', async () => {
  const out = await makeTempDir();
  const output = nodePath.join(out, 'result');
  try {
    // Hardlink declared BEFORE its target in entry order.
    const entries: ArchiveEntry[] = [
      makeEntry({ path: 'link.txt', type: 'hardlink', linkTarget: 'real.txt' }),
      makeEntry({
        path: 'real.txt',
        type: 'file',
        mode: 0o644,
        buffer: () => Promise.resolve(Buffer.from('target content')),
      }),
    ];
    const result = await atomicExtract(entries, {
      output,
      limits: DEFAULT_LIMITS,
      policy: { ...defaultPolicy(), allowHardlinks: true },
      archiveSize: 14,
    });
    assert.equal(result.entries.length, 2);
    // Both should exist and link.txt should share content with real.txt.
    const realContent = await readFile(nodePath.join(output, 'real.txt'), 'utf8');
    assert.equal(realContent, 'target content');
    const linkSt = await lstat(nodePath.join(output, 'link.txt'));
    assert.ok(linkSt.nlink >= 2, 'hardlink should have nlink >= 2');
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('atomicExtract: resolves forward hardlink dependency chains', async () => {
  const out = await makeTempDir();
  const output = nodePath.join(out, 'result');
  try {
    const entries: ArchiveEntry[] = [
      makeEntry({ path: 'second', type: 'hardlink', linkTarget: 'first' }),
      makeEntry({ path: 'first', type: 'hardlink', linkTarget: 'target.txt' }),
      makeEntry({ path: 'target.txt', buffer: async () => Buffer.from('target') }),
    ];
    const progress: number[] = [];
    await atomicExtract(entries, {
      output,
      limits: DEFAULT_LIMITS,
      policy: { ...defaultPolicy(), allowHardlinks: true },
      archiveSize: 6,
      onProgress: (processed) => progress.push(processed),
    });
    assert.equal(await readFile(nodePath.join(output, 'second'), 'utf8'), 'target');
    assert.deepEqual(progress, [1, 2, 3]);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('sanitizeMode strips setuid while preserving executable modes', () => {
  const m = sanitizeMode(0o4755, 'file', { preservePermissions: false, umask: 0o022 });
  assert.equal(m & 0o7000, 0);
  assert.equal(m, 0o755);
});

test('cleanupTempDir: refuses to delete non-temp paths (safety guard)', async () => {
  const out = await makeTempDir();
  try {
    // Should NOT delete `out` because it doesn't match the temp pattern.
    await cleanupTempDir(out);
    // out should still exist.
    const st = await lstat(out);
    assert.ok(st.isDirectory());
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});
