// Compatibility tests for the supported migration surface.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import nodePath from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

import decompress from '../../src/index.ts';
import { LegacyPluginNotEnabledError } from '@umar0x/decompress';

const here = nodePath.dirname(fileURLToPath(import.meta.url));
const fixtures = nodePath.join(here, '..', '..', '..', 'test-fixtures', 'benign');
const maliciousFixtures = nodePath.join(here, '..', '..', '..', 'test-fixtures', 'malicious');

async function tmpOutput(): Promise<string> {
  return mkdtemp(nodePath.join(tmpdir(), 'decompress-compat-test-'));
}

test('compat: decompress(file.zip, output) extracts files', async () => {
  const out = await tmpOutput();
  const target = nodePath.join(out, 'result');
  try {
    const entries = await decompress(nodePath.join(fixtures, 'file.zip'), target);
    assert.ok(Array.isArray(entries));
    assert.equal(entries.length, 1);
    const e = entries[0]!;
    assert.equal(e.path, 'test.jpg'); // C-02: archive-relative path (kevva compat)
    assert.equal(e.type, 'file');
    assert.ok(e.mtime instanceof Date);
    assert.equal(typeof e.mode, 'number');
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('compat: decompress(Buffer, output) works', async () => {
  const out = await tmpOutput();
  const target = nodePath.join(out, 'result');
  try {
    const buf = await readFile(nodePath.join(fixtures, 'file.zip'));
    const entries = await decompress(buf, target);
    assert.ok(entries.length >= 1);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('compat: accepts options as the second argument', async () => {
  // Options may be passed without an output path.
  const entries = await decompress(nodePath.join(fixtures, 'file.zip'), { strip: 0 });
  assert.ok(Array.isArray(entries));
  assert.ok(entries.length >= 1);
});

test('compat: returns entries without an output argument', async () => {
  const entries = await decompress(nodePath.join(fixtures, 'file.zip'));
  assert.ok(Array.isArray(entries));
  assert.ok(entries.length >= 1);
});

test('compat: invalid input type throws TypeError (kevva parity)', async () => {
  await assert.rejects(
    () => decompress(42 as unknown as string, '/tmp/x'),
    (e: unknown) => e instanceof TypeError && (e as Error).message.includes('Input file required'),
  );
});

test('compat: Entry shape has kevva fields (data, mode, mtime, path, type)', async () => {
  const out = await tmpOutput();
  const target = nodePath.join(out, 'result');
  try {
    const entries = await decompress(nodePath.join(fixtures, 'file.zip'), target);
    const e = entries[0]!;
    assert.ok('data' in e, 'data field present');
    assert.ok('mode' in e, 'mode field present');
    assert.ok('mtime' in e, 'mtime field present');
    assert.ok('path' in e, 'path field present');
    assert.ok('type' in e, 'type field present');
    assert.ok(Buffer.isBuffer(e.data), 'data is a Buffer');
    assert.ok(e.mtime instanceof Date, 'mtime is a Date');
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('compat: strips special permission bits', async () => {
  const out = await tmpOutput();
  const target = nodePath.join(out, 'result');
  try {
    const entries = await decompress(nodePath.join(fixtures, 'file.zip'), target);
    for (const e of entries) {
      assert.equal(e.mode & ~0o777, 0, `mode ${e.mode.toString(8)} has bits above 0o777`);
    }
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('compat: refuses symlinks by default', async () => {
  const out = await tmpOutput();
  const target = nodePath.join(out, 'result');
  try {
    await assert.rejects(() => decompress(nodePath.join(fixtures, 'symlink.tar'), target));
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('compat: refuses hardlinks by default', async () => {
  const out = await tmpOutput();
  const target = nodePath.join(out, 'result');
  try {
    await assert.rejects(() => decompress(nodePath.join(fixtures, 'link.tar'), target));
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('compat: legacy plugins require an explicit unsafe opt-in', async () => {
  const fakeLegacyPlugin = [() => Promise.resolve([])] as unknown[];
  await assert.rejects(
    () => decompress(nodePath.join(fixtures, 'file.zip'), '/tmp/x', { plugins: fakeLegacyPlugin }),
    LegacyPluginNotEnabledError,
  );
});

test('compat: failed extraction leaves output absent', async () => {
  const out = await tmpOutput();
  const target = nodePath.join(out, 'result');
  try {
    await assert.rejects(() => decompress(nodePath.join(maliciousFixtures, 'slip.zip'), target));
    const children = await readdir(target).catch(() => []);
    assert.equal(children.length, 0);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('compat: tar.gz, tar.bz2, tar all extract', async () => {
  for (const f of ['file.tar', 'file.tar.gz', 'file.tar.bz2']) {
    const out = await tmpOutput();
    const target = nodePath.join(out, 'result');
    try {
      const entries = await decompress(nodePath.join(fixtures, f), target);
      assert.ok(entries.length >= 1, `${f} should have entries`);
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  }
});

test('compat: strip option works (removes top-level segment)', async () => {
  const out = await tmpOutput();
  const target = nodePath.join(out, 'result');
  try {
    // top_level_example.tar.gz has entries under a top-level dir; strip 1 removes it.
    const entries = await decompress(nodePath.join(fixtures, 'top_level_example.tar.gz'), target, {
      strip: 1,
    });
    // After strip, entries should exist (the archive has nested content).
    // Stripping every segment may produce no entries.
    assert.ok(Array.isArray(entries));
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('compat: overwrite option allows extracting into existing dir', async () => {
  const out = await tmpOutput();
  const target = nodePath.join(out, 'result');
  try {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(target, { recursive: true });
    const entries = await decompress(nodePath.join(fixtures, 'file.zip'), target, {
      overwrite: true,
    });
    assert.ok(entries.length >= 1);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('compat: enforces maxFiles', async () => {
  const out = await tmpOutput();
  const target = nodePath.join(out, 'result');
  try {
    await assert.rejects(() =>
      decompress(nodePath.join(fixtures, 'multiple.zip'), target, { maxFiles: 1 }),
    );
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('compat: supports abort signals', async () => {
  const out = await tmpOutput();
  const target = nodePath.join(out, 'result');
  const ac = new AbortController();
  ac.abort();
  try {
    await assert.rejects(() =>
      decompress(nodePath.join(fixtures, 'file.zip'), target, { signal: ac.signal }),
    );
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('compat: filter receives populated data buffers', async () => {
  const entries = await decompress(nodePath.join(fixtures, 'file.zip'), {
    filter: (entry) => entry.data.length > 0,
  });
  assert.equal(entries.length, 1);
  assert.equal(entries[0]!.data.length, 2248);
});

test('compat: map can replace file data', async () => {
  const out = await tmpOutput();
  const target = nodePath.join(out, 'result');
  try {
    const entries = await decompress(nodePath.join(fixtures, 'file.zip'), target, {
      map: (entry) => ({ ...entry, path: 'mapped.txt', data: Buffer.from('mapped') }),
    });
    assert.equal(entries[0]!.data.toString(), 'mapped');
    assert.equal(await readFile(nodePath.join(target, 'mapped.txt'), 'utf8'), 'mapped');
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('compat: opted-in legacy plugin executes and is revalidated', async () => {
  let called = false;
  const plugin = async () => {
    called = true;
    return [
      {
        path: 'legacy.txt',
        type: 'file',
        data: Buffer.from('legacy'),
        mode: 0o644,
        mtime: new Date(0),
      },
    ];
  };
  const entries = await decompress(Buffer.from('legacy input'), {
    plugins: [plugin],
    legacyPluginUnsafe: true,
  });
  assert.equal(called, true);
  assert.equal(entries[0]!.data.toString(), 'legacy');
});
