// Unit tests for the legacy plugin adapter: record mapping, warnings, and
// revalidation through the standard policy pipeline.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import nodePath from 'node:path';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import { Readable } from 'node:stream';
import { wrapLegacyPlugin } from '../../src/plugins/legacy-adapter.ts';
import { extract } from '../../src/extract.ts';

async function tmpOut(): Promise<string> {
  return mkdtemp(nodePath.join(tmpdir(), 'decompress-legacy-test-'));
}

test('wrapLegacyPlugin: buffers the archive and maps legacy entries', async () => {
  const out = await tmpOut();
  try {
    const warnings: Array<{ code: string; message: string }> = [];
    const plugin = wrapLegacyPlugin('legacy-test', async (input: Buffer) => {
      assert.ok(Buffer.isBuffer(input), 'legacy plugin receives a Buffer');
      assert.equal(input.length, 9);
      return [
        { path: 'a.txt', data: Buffer.from('AAA'), mode: 0o644 },
        { path: 'sub/b.txt', data: Buffer.from('BBB'), mode: 0o600 },
        { path: 'empty-dir', type: 'directory' },
        { path: 'linked', type: 'link', linkname: 'a.txt' },
        { path: 'sym', type: 'symlink', linkname: 'a.txt' },
      ];
    });

    const entries: Array<Record<string, unknown>> = [];
    for await (const entry of plugin.parse(
      {
        stream: () => Readable.from([Buffer.from('synthetic')]),
        buffer: undefined,
        size: 9,
        hints: ['legacy-test'],
        signal: new AbortController().signal,
      },
      { warn: (code, message) => warnings.push({ code, message }) },
    )) {
      entries.push(entry as Record<string, unknown>);
    }

    assert.equal(entries.length, 5);
    assert.equal(entries[0]!.path, 'a.txt');
    assert.equal(entries[0]!.type, 'file');
    assert.equal(entries[0]!.size, 3);
    assert.equal(entries[1]!.path, 'sub/b.txt');
    assert.equal(entries[2]!.type, 'directory');
    assert.equal(entries[3]!.type, 'hardlink');
    assert.equal(entries[3]!.linkTarget, 'a.txt');
    assert.equal(entries[4]!.type, 'symlink');
    // The buffering warning must be emitted to the parse context.
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0]!.code, 'legacy_plugin_used');

    // Buffer factory replays content.
    const buf = await (entries[0]!.buffer as () => Promise<Buffer>)();
    assert.equal(buf.toString('utf8'), 'AAA');
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('wrapLegacyPlugin: unknown legacy entry types map to file', async () => {
  const plugin = wrapLegacyPlugin('legacy-unknown', async () => [
    { path: 'weird', type: 'char-device', data: Buffer.from('x') },
  ]);
  const entries: Array<Record<string, unknown>> = [];
  for await (const entry of plugin.parse(
    {
      stream: () => Readable.from([]),
      buffer: undefined,
      size: 0,
      hints: [],
      signal: new AbortController().signal,
    },
    { warn: () => {} },
  )) {
    entries.push(entry as Record<string, unknown>);
  }
  assert.equal(entries[0]!.type, 'file');
});

test('wrapLegacyPlugin: output flows through the secure writer with policy intact', async () => {
  const out = await tmpOut();
  try {
    const plugin = wrapLegacyPlugin('legacy-write', async () => [
      { path: 'file.txt', data: Buffer.from('CONTENT'), mode: 0o4755 },
    ]);
    const output = nodePath.join(out, 'result');
    await extract(Buffer.from('legacy-write'), output, {
      plugins: [plugin],
      legacyPluginUnsafe: true,
      maxCompressionRatio: 1e9,
    });
    assert.equal(await readFile(nodePath.join(output, 'file.txt'), 'utf8'), 'CONTENT');
    // setuid bit must be stripped even from legacy plugin output.
    const st = await (await import('node:fs/promises')).stat(nodePath.join(output, 'file.txt'));
    assert.equal(st.mode & 0o7000, 0);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('wrapLegacyPlugin: traversal paths from legacy plugins are rejected by the writer', async () => {
  const out = await tmpOut();
  try {
    const plugin = wrapLegacyPlugin('legacy-evil', async () => [
      { path: '../../escape.txt', data: Buffer.from('PWNED') },
    ]);
    const output = nodePath.join(out, 'result');
    await assert.rejects(
      extract(Buffer.from('legacy-evil'), output, {
        plugins: [plugin],
        legacyPluginUnsafe: true,
        maxCompressionRatio: 1e9,
      }),
      (e: Error & { code: string }) => e.code === 'PATH_TRAVERSAL',
    );
    // Atomic: no output committed.
    await assert.rejects(
      () => readdir(output),
      (e: NodeJS.ErrnoException) => e.code === 'ENOENT',
    );
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('legacy plugin streaming input is spooled when no buffer is provided', async () => {
  const plugin = wrapLegacyPlugin('legacy-stream', async (input: Buffer) => {
    assert.equal(input.toString('utf8'), 'streamed-archive');
    return [{ path: 'ok.txt', data: Buffer.from('OK') }];
  });
  const { Readable } = await import('node:stream');
  const entries: Array<Record<string, unknown>> = [];
  for await (const entry of plugin.parse(
    {
      stream: () => Readable.from([Buffer.from('streamed-archive')]),
      buffer: undefined,
      size: 15,
      hints: [],
      signal: new AbortController().signal,
    },
    { warn: () => {} },
  )) {
    entries.push(entry as Record<string, unknown>);
  }
  assert.equal(entries.length, 1);
  assert.equal(entries[0]!.path, 'ok.txt');
});
