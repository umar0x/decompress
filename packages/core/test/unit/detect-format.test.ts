// Magic-byte detection tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import nodePath from 'node:path';
import { fileURLToPath } from 'node:url';

import { detectFormat, isEmptyTar } from '../../src/detect-format.ts';

const here = nodePath.dirname(fileURLToPath(import.meta.url));
const fixtures = nodePath.join(here, '..', '..', '..', 'test-fixtures', 'benign');

test('detectFormat: ZIP magic PK\\x03\\x04', async () => {
  const buf = await readFile(nodePath.join(fixtures, 'file.zip'));
  assert.equal(detectFormat(buf), 'zip');
});

test('detectFormat: TAR magic ustar at offset 257', async () => {
  const buf = await readFile(nodePath.join(fixtures, 'file.tar'));
  assert.equal(detectFormat(buf), 'tar');
});

test('detectFormat: GZIP magic \\x1f\\x8b', async () => {
  const buf = await readFile(nodePath.join(fixtures, 'file.tar.gz'));
  assert.equal(detectFormat(buf), 'gz');
});

test('detectFormat: BZIP2 magic BZh', async () => {
  const buf = await readFile(nodePath.join(fixtures, 'file.tar.bz2'));
  assert.equal(detectFormat(buf), 'bz2');
});

test('detectFormat: empty buffer returns null', () => {
  assert.equal(detectFormat(Buffer.alloc(0)), null);
  assert.equal(detectFormat(Buffer.alloc(3)), null);
});

test('detectFormat: unrecognized magic returns null', () => {
  assert.equal(detectFormat(Buffer.from('hello world this is not an archive!!')), null);
});

test('detectFormat: ZIP empty-archive magic PK\\x05\\x06', () => {
  const emptyZip = Buffer.from([
    0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  ]);
  assert.equal(detectFormat(emptyZip), 'zip');
});

test('detectFormat: ZIP data-descriptor magic PK\\x07\\x08', () => {
  const dd = Buffer.from([0x50, 0x4b, 0x07, 0x08, 0, 0, 0, 0]);
  assert.equal(detectFormat(dd), 'zip');
});

test('isEmptyTar: requires two complete zero blocks', () => {
  assert.equal(isEmptyTar(Buffer.alloc(1024), 1024), true);
  assert.equal(isEmptyTar(Buffer.alloc(512), 512), false);
  assert.equal(isEmptyTar(Buffer.alloc(1024), 1025), false);
  const nonzero = Buffer.alloc(1024);
  nonzero[100] = 1;
  assert.equal(isEmptyTar(nonzero, 1024), false);
});
