import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import nodePath from 'node:path';
import { Readable } from 'node:stream';
import { resolveInput } from '../../src/input-utils.ts';
import {
  AbortError,
  ArchiveNotFoundError,
  ArchiveSizeExceededError,
  InvalidInputError,
} from '../../src/errors.ts';

test('resolveInput keeps paths file-backed and Buffers caller-owned', async () => {
  const root = await mkdtemp(nodePath.join(tmpdir(), 'input-utils-test-'));
  const file = nodePath.join(root, 'archive.bin');
  try {
    await writeFile(file, 'abcdef');
    const fromPath = await resolveInput(file, { maxArchiveSize: 100 });
    assert.equal(fromPath.filePath, file);
    assert.equal(fromPath.buffer, undefined);
    assert.equal(fromPath.peek.toString(), 'abcdef');

    const buffer = Buffer.from('buffer');
    const fromBuffer = await resolveInput(buffer, { maxArchiveSize: 100 });
    assert.equal(fromBuffer.buffer, buffer);
    assert.equal(fromBuffer.filePath, undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('resolveInput spools one-shot streams to a private bounded file', async () => {
  const resolved = await resolveInput(Readable.from(['abc', 'def']), {
    maxArchiveSize: 100,
    peekBytes: 4,
  });
  assert.equal(resolved.buffer, undefined);
  assert.equal(resolved.peek.toString(), 'abcd');
  assert.equal((await stat(resolved.filePath!)).size, 6);
  const filePath = resolved.filePath!;
  await resolved.cleanup();
  await assert.rejects(() => stat(filePath), { code: 'ENOENT' });
  await resolved.cleanup();
});

test('resolveInput rejects missing paths, directories, oversize data, and aborts', async () => {
  const root = await mkdtemp(nodePath.join(tmpdir(), 'input-utils-test-'));
  try {
    await assert.rejects(
      () => resolveInput(nodePath.join(root, 'missing'), { maxArchiveSize: 100 }),
      ArchiveNotFoundError,
    );
    await assert.rejects(() => resolveInput(root, { maxArchiveSize: 100 }), InvalidInputError);
    await assert.rejects(
      () => resolveInput(Buffer.alloc(2), { maxArchiveSize: 1 }),
      ArchiveSizeExceededError,
    );
    await assert.rejects(
      () => resolveInput(Readable.from([Buffer.alloc(2)]), { maxArchiveSize: 1 }),
      ArchiveSizeExceededError,
    );
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      () => resolveInput(Buffer.alloc(0), { maxArchiveSize: 1, signal: controller.signal }),
      AbortError,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
