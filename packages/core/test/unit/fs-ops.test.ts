import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import nodePath from 'node:path';
import {
  ensureNotSymlink,
  safeChmod,
  safeClose,
  safeFchmod,
  safeHardlink,
  safeLstat,
  safeMkdir,
  safeOpenExclusive,
  safeRealpath,
  safeRename,
  safeRm,
  safeUnlink,
  safeUtimes,
  safeWriteAll,
} from '../../src/writer/fs-ops.ts';
import { NotADirectoryError } from '../../src/errors.ts';

test('safeWriteAll retries partial writes until the complete buffer is written', async () => {
  const written: Buffer[] = [];
  const handle = {
    async write(buffer: Buffer, offset = 0, length = buffer.length) {
      const bytesWritten = Math.min(2, length);
      written.push(Buffer.from(buffer.subarray(offset, offset + bytesWritten)));
      return { bytesWritten };
    },
  };
  await safeWriteAll(handle, Buffer.from('abcdef'));
  assert.equal(Buffer.concat(written).toString(), 'abcdef');
});

test('filesystem wrappers create, write, link, rename, and remove safely', async () => {
  const root = await mkdtemp(nodePath.join(tmpdir(), 'fs-ops-test-'));
  try {
    const directory = nodePath.join(root, 'dir');
    await safeMkdir(directory, { mode: 0o700 });
    assert.equal((await safeLstat(directory)).isDirectory(), true);
    assert.equal(await safeRealpath(directory), directory);
    await ensureNotSymlink(directory);

    const file = nodePath.join(directory, 'file.txt');
    const handle = await safeOpenExclusive(file, 0o600);
    await safeWriteAll(handle, Buffer.from('content'));
    await safeFchmod(handle, 0o600);
    await safeClose(handle);
    assert.equal(await readFile(file, 'utf8'), 'content');
    await assert.rejects(() => safeOpenExclusive(file, 0o600), { code: 'EEXIST' });
    await assert.rejects(() => ensureNotSymlink(file), NotADirectoryError);

    await safeChmod(file, 0o600);
    await safeUtimes(file, new Date('2020-01-01T00:00:00Z'));
    assert.equal((await stat(file)).mtime.getUTCFullYear(), 2020);

    const hardlink = nodePath.join(directory, 'hardlink.txt');
    await safeHardlink(file, hardlink);
    assert.equal(await readFile(hardlink, 'utf8'), 'content');
    await safeUnlink(hardlink);

    const renamed = nodePath.join(directory, 'renamed.txt');
    await safeRename(file, renamed);
    assert.equal(await readFile(renamed, 'utf8'), 'content');
    await safeRm(directory);
    await assert.rejects(() => safeLstat(directory), { code: 'ENOENT' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('filesystem wrappers honor an already-aborted signal', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() => safeLstat('unused', controller.signal), { code: 'ABORTED' });
});
