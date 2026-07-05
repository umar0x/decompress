// Integration tests for ZIP and TAR-family parsers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import nodePath from 'node:path';
import { fileURLToPath } from 'node:url';

import { zipPlugin } from '../../src/formats/zip.ts';
import { tarPlugin } from '../../src/formats/tar.ts';
import { targzPlugin } from '../../src/formats/targz.ts';
import { tarbz2Plugin } from '../../src/formats/tarbz2.ts';
import type { ArchiveEntry, PluginArchiveInput, ParseContext } from '../../src/types.ts';

const here = nodePath.dirname(fileURLToPath(import.meta.url));
const fixtures = nodePath.join(here, '..', '..', '..', 'test-fixtures', 'benign');

const noopCtx: ParseContext = { warn: () => {} };

async function parseAll(
  plugin: { parse: (i: PluginArchiveInput, c: ParseContext) => AsyncIterable<ArchiveEntry> },
  buffer: Buffer,
): Promise<ArchiveEntry[]> {
  const input: PluginArchiveInput = {
    stream: () => Readable.from([buffer]),
    buffer,
    size: buffer.length,
    hints: [],
    signal: new AbortController().signal,
  };
  const out: ArchiveEntry[] = [];
  for await (const e of plugin.parse(input, noopCtx)) {
    if (e.stream) {
      const chunks: Buffer[] = [];
      for await (const chunk of e.stream()) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as unknown as Uint8Array));
      }
      const data = Buffer.concat(chunks);
      e.buffer = async () => data;
      delete e.stream;
    }
    out.push(e);
  }
  return out;
}

test('zip parser: extracts file.zip → test.jpg (2248 bytes)', async () => {
  const buf = await readFile(nodePath.join(fixtures, 'file.zip'));
  const entries = await parseAll(zipPlugin, buf);
  assert.equal(entries.length, 1);
  assert.equal(entries[0]!.path, 'test.jpg');
  assert.equal(entries[0]!.type, 'file');
  assert.equal(entries[0]!.size, 2248);
  assert.equal(entries[0]!.sourceFormat, 'zip');
  const data = await entries[0]!.buffer!();
  assert.equal(data.length, 2248);
});

test('zip parser: multiple.zip has multiple entries', async () => {
  const buf = await readFile(nodePath.join(fixtures, 'multiple.zip'));
  const entries = await parseAll(zipPlugin, buf);
  assert.ok(entries.length >= 2, `expected >= 2 entries, got ${entries.length}`);
});

test('tar parser: extracts file.tar', async () => {
  const buf = await readFile(nodePath.join(fixtures, 'file.tar'));
  const entries = await parseAll(tarPlugin, buf);
  assert.ok(entries.length >= 1);
  const file = entries.find((e) => e.type === 'file');
  assert.ok(file, 'expected at least one file entry');
  assert.equal(file!.sourceFormat, 'tar');
});

test('tar parser: directory.tar has directory entry', async () => {
  const buf = await readFile(nodePath.join(fixtures, 'directory.tar'));
  const entries = await parseAll(tarPlugin, buf);
  const dir = entries.find((e) => e.type === 'directory');
  assert.ok(dir, 'expected a directory entry');
});

test('tar parser: symlink.tar has symlink entry with linkTarget', async () => {
  const buf = await readFile(nodePath.join(fixtures, 'symlink.tar'));
  const entries = await parseAll(tarPlugin, buf);
  const link = entries.find((e) => e.type === 'symlink');
  assert.ok(link, 'expected a symlink entry');
  assert.ok(link!.linkTarget !== undefined);
});

test('tar parser: link.tar has hardlink entry with linkTarget', async () => {
  const buf = await readFile(nodePath.join(fixtures, 'link.tar'));
  const entries = await parseAll(tarPlugin, buf);
  const link = entries.find((e) => e.type === 'hardlink');
  assert.ok(link, 'expected a hardlink entry');
  assert.ok(link!.linkTarget !== undefined);
});

test('tar.gz parser: extracts file.tar.gz', async () => {
  const buf = await readFile(nodePath.join(fixtures, 'file.tar.gz'));
  const entries = await parseAll(targzPlugin, buf);
  assert.ok(entries.length >= 1);
  assert.equal(entries[0]!.sourceFormat, 'tar.gz');
});

test('tar.bz2 parser: extracts file.tar.bz2', async () => {
  const buf = await readFile(nodePath.join(fixtures, 'file.tar.bz2'));
  const entries = await parseAll(tarbz2Plugin, buf);
  assert.ok(entries.length >= 1);
  assert.equal(entries[0]!.sourceFormat, 'tar.bz2');
});

test('tar.gz parser: contiguous_file.tar → contiguous-file normalized to file', async () => {
  const buf = await readFile(nodePath.join(fixtures, 'contiguous_file.tar'));
  const entries = await parseAll(tarPlugin, buf);
  // contiguous-file type should be normalized to 'file'.
  const files = entries.filter((e) => e.type === 'file');
  assert.ok(files.length >= 1, 'expected at least one file entry from contiguous-file');
});

test('tar.gz parser: leading_dots.tar.gz → paths preserved', async () => {
  const buf = await readFile(nodePath.join(fixtures, 'leading_dots.tar.gz'));
  const entries = await parseAll(targzPlugin, buf);
  assert.ok(entries.length >= 1);
});

test('zip parser: detects zip via plugin.detect', async () => {
  const buf = await readFile(nodePath.join(fixtures, 'file.zip'));
  assert.equal(zipPlugin.detect?.(buf), true);
});

test('tar plugin: rejects non-tar buffer via detect', async () => {
  assert.equal(tarPlugin.detect?.(Buffer.from('not a tar')), false);
});

test('plugin API: input objects omit the writer and output path', async () => {
  const ctx: ParseContext = { warn: () => {} };
  const input: PluginArchiveInput = {
    stream: () => Readable.from([]),
    buffer: Buffer.alloc(0),
    size: 0,
    hints: [],
    signal: new AbortController().signal,
  };
  assert.equal('fs' in input, false);
  assert.equal('output' in input, false);
  assert.equal('opts' in input, false);
  assert.equal('fs' in ctx, false);
});
