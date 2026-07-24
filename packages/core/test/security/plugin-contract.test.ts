// Plugin record contract regression suite.
//
// Every malformed plugin record below must produce a typed
// PluginInvalidEntryError (or, for audit overflow, a typed critical finding)
// in all three public APIs. The suite is table-driven so the contract cannot
// drift across extract, listArchive, and auditArchive.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import nodePath from 'node:path';
import { tmpdir } from 'node:os';

import { extract, listArchive, auditArchive } from '../../src/index.ts';
import {
  PluginInvalidEntryError,
  isDecompressError,
  type ArchivePlugin,
  type ArchiveEntry,
} from '../../src/index.ts';

type MalformedRecord = {
  name: string;
  record: () => unknown;
};

const MALFORMED_RECORDS: MalformedRecord[] = [
  { name: 'null', record: () => null },
  { name: 'primitive number', record: () => 42 },
  { name: 'primitive string', record: () => 'path' },
  { name: 'array', record: () => ['file.txt'] },
  { name: 'missing path', record: () => ({ type: 'file', sourceFormat: 'test' }) },
  { name: 'empty path', record: () => ({ path: '', type: 'file', sourceFormat: 'test' }) },
  { name: 'number path', record: () => ({ path: 42, type: 'file', sourceFormat: 'test' }) },
  {
    name: 'unsupported type',
    record: () => ({ path: 'a', type: 'char-device', sourceFormat: 'test' }),
  },
  {
    name: 'missing sourceFormat',
    record: () => ({ path: 'a', type: 'file' }),
  },
  {
    name: 'empty sourceFormat',
    record: () => ({ path: 'a', type: 'file', sourceFormat: '' }),
  },
  {
    name: 'negative size',
    record: () => ({ path: 'a', type: 'file', sourceFormat: 'test', size: -1 }),
  },
  {
    name: 'float size',
    record: () => ({ path: 'a', type: 'file', sourceFormat: 'test', size: 1.5 }),
  },
  {
    name: 'Infinity size',
    record: () => ({ path: 'a', type: 'file', sourceFormat: 'test', size: Infinity }),
  },
  {
    name: 'NaN size',
    record: () => ({ path: 'a', type: 'file', sourceFormat: 'test', size: NaN }),
  },
  {
    name: 'unsafe integer size',
    record: () => ({
      path: 'a',
      type: 'file',
      sourceFormat: 'test',
      size: Number.MAX_SAFE_INTEGER + 1,
    }),
  },
  {
    name: 'invalid mode (negative)',
    record: () => ({ path: 'a', type: 'file', sourceFormat: 'test', mode: -1 }),
  },
  {
    name: 'invalid mode (non-integer)',
    record: () => ({ path: 'a', type: 'file', sourceFormat: 'test', mode: 1.5 }),
  },
  {
    name: 'invalid mode (too large)',
    record: () => ({ path: 'a', type: 'file', sourceFormat: 'test', mode: 0o20000 }),
  },
  {
    name: 'invalid mtime (string)',
    record: () => ({ path: 'a', type: 'file', sourceFormat: 'test', mtime: 'yesterday' }),
  },
  {
    name: 'invalid mtime (invalid Date)',
    record: () => ({
      path: 'a',
      type: 'file',
      sourceFormat: 'test',
      mtime: new Date('not a date'),
    }),
  },
  {
    name: 'non-string linkTarget',
    record: () => ({ path: 'a', type: 'symlink', sourceFormat: 'test', linkTarget: 42 }),
  },
  {
    name: 'symlink missing linkTarget',
    record: () => ({ path: 'a', type: 'symlink', sourceFormat: 'test' }),
  },
  {
    name: 'hardlink missing linkTarget',
    record: () => ({ path: 'a', type: 'hardlink', sourceFormat: 'test' }),
  },
  {
    name: 'non-callable stream',
    record: () => ({ path: 'a', type: 'file', sourceFormat: 'test', stream: 'nope' }),
  },
  {
    name: 'non-callable buffer',
    record: () => ({ path: 'a', type: 'file', sourceFormat: 'test', buffer: 'nope' }),
  },
  {
    name: 'non-object metadata',
    record: () => ({ path: 'a', type: 'file', sourceFormat: 'test', metadata: 'nope' }),
  },
  {
    name: 'array metadata',
    record: () => ({ path: 'a', type: 'file', sourceFormat: 'test', metadata: [1, 2, 3] }),
  },
];

function makePlugin(record: () => unknown): ArchivePlugin {
  return {
    name: 'malformed-test',
    formats: ['malformed-test'],
    detect: () => true,
    parse: async function* () {
      yield record() as ArchiveEntry;
    },
  };
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(nodePath.join(tmpdir(), 'decompress-contract-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// extract: every malformed record must throw PluginInvalidEntryError
// ---------------------------------------------------------------------------

test('extract: malformed plugin records throw PluginInvalidEntryError', async () => {
  for (const { name, record } of MALFORMED_RECORDS) {
    await withTempDir(async (dir) => {
      const target = nodePath.join(dir, 'out');
      await assert.rejects(
        () =>
          extract(Buffer.from('malformed-test'), target, {
            plugins: [makePlugin(record)],
            maxCompressionRatio: 10_000,
            maxArchiveSize: 1024,
          }),
        (err: unknown) => {
          assert.ok(
            err instanceof PluginInvalidEntryError,
            `${name}: expected PluginInvalidEntryError, got ${(err as Error)?.constructor?.name}`,
          );
          assert.ok(isDecompressError(err), `${name}: expected isDecompressError`);
          return true;
        },
        `${name}: expected rejection`,
      );
      // Atomic: failed extraction must not create the output.
      const { stat } = await import('node:fs/promises');
      await assert.rejects(
        () => stat(target),
        { code: 'ENOENT' },
        `${name}: output should not exist`,
      );
    });
  }
});

// ---------------------------------------------------------------------------
// listArchive: every malformed record must throw PluginInvalidEntryError
// ---------------------------------------------------------------------------

test('listArchive: malformed plugin records throw PluginInvalidEntryError', async () => {
  for (const { name, record } of MALFORMED_RECORDS) {
    await assert.rejects(
      () =>
        listArchive(Buffer.from('malformed-test'), {
          plugins: [makePlugin(record)],
          maxArchiveSize: 1024,
        }),
      (err: unknown) => {
        assert.ok(
          err instanceof PluginInvalidEntryError,
          `${name}: expected PluginInvalidEntryError, got ${(err as Error)?.constructor?.name}`,
        );
        return true;
      },
      `${name}: expected rejection`,
    );
  }
});

// ---------------------------------------------------------------------------
// auditArchive: malformed records must throw OR produce a finite report
// ---------------------------------------------------------------------------

test('auditArchive: malformed plugin records throw PluginInvalidEntryError', async () => {
  for (const { name, record } of MALFORMED_RECORDS) {
    await assert.rejects(
      () =>
        auditArchive(Buffer.from('malformed-test'), {
          plugins: [makePlugin(record)],
          maxArchiveSize: 1024,
        }),
      (err: unknown) => {
        assert.ok(
          err instanceof PluginInvalidEntryError,
          `${name}: expected PluginInvalidEntryError, got ${(err as Error)?.constructor?.name}`,
        );
        return true;
      },
      `${name}: expected rejection`,
    );
  }
});

// ---------------------------------------------------------------------------
// Infinity size must not leak through audit JSON.
// ---------------------------------------------------------------------------

test('auditArchive: Infinity-size record is rejected (no JSON null leakage)', async () => {
  // The validator rejects Infinity before any arithmetic runs.
  const plugin: ArchivePlugin = {
    name: 'infinity-test',
    formats: ['infinity-test'],
    detect: () => true,
    parse: async function* () {
      yield {
        path: 'a',
        type: 'file',
        sourceFormat: 'infinity-test',
        size: Infinity,
      } as unknown as ArchiveEntry;
    },
  };
  await assert.rejects(
    () => auditArchive(Buffer.from('infinity'), { plugins: [plugin], maxArchiveSize: 1024 }),
    PluginInvalidEntryError,
  );
});

test('auditArchive: large-but-valid cumulative size produces finite report', async () => {
  // A plugin that emits many valid entries with declared sizes near the
  // safe-integer boundary must still produce a finite, JSON-serializable
  // report. Total arithmetic that would exceed safe-integer range yields a
  // total_size_overflow critical finding instead of Infinity.
  const N = 100;
  const each = Math.floor(Number.MAX_SAFE_INTEGER / N) + 1; // sums > MAX_SAFE_INTEGER
  const plugin: ArchivePlugin = {
    name: 'overflow-test',
    formats: ['overflow-test'],
    detect: () => true,
    parse: async function* () {
      for (let i = 0; i < N; i++) {
        yield {
          path: `f${i}`,
          type: 'file',
          sourceFormat: 'overflow-test',
          size: each,
        };
      }
    },
  };
  const report = await auditArchive(Buffer.from('overflow'), {
    plugins: [plugin],
    maxArchiveSize: 1024,
    maxFiles: 1000,
    maxTotalSize: Number.MAX_SAFE_INTEGER,
  });
  // Numeric fields must be finite.
  assert.ok(Number.isFinite(report.totalSize), `totalSize must be finite, got ${report.totalSize}`);
  assert.ok(
    Number.isFinite(report.compressionRatio),
    `compressionRatio must be finite, got ${report.compressionRatio}`,
  );
  assert.ok(
    Number.isFinite(report.entryCount),
    `entryCount must be finite, got ${report.entryCount}`,
  );
  // JSON serialization must not produce null for any numeric field.
  const json = JSON.parse(JSON.stringify(report));
  assert.equal(typeof json.totalSize, 'number', 'totalSize JSON is a number');
  assert.equal(typeof json.compressionRatio, 'number', 'compressionRatio JSON is a number');
  assert.equal(typeof json.entryCount, 'number', 'entryCount JSON is a number');
});

// ---------------------------------------------------------------------------
// detect() is invoked at most once per plugin.
// ---------------------------------------------------------------------------

test('listArchive: detect() is invoked at most once per plugin', async () => {
  let detectCalls = 0;
  const plugin: ArchivePlugin = {
    name: 'detect-once',
    formats: ['detect-once'],
    detect: (buffer: Buffer) => {
      detectCalls++;
      return buffer.length > 0;
    },
    parse: async function* () {
      yield { path: 'a', type: 'file', sourceFormat: 'detect-once', size: 0 };
    },
  };
  await listArchive(Buffer.from('detect-once'), { plugins: [plugin], maxArchiveSize: 1024 });
  assert.equal(detectCalls, 1, `detect() should be called exactly once, got ${detectCalls}`);
});

// ---------------------------------------------------------------------------
// Valid plugin record still works (negative test for the validator).
// ---------------------------------------------------------------------------

test('all APIs accept a valid plugin record', async () => {
  const validPlugin: ArchivePlugin = {
    name: 'valid',
    formats: ['valid'],
    detect: () => true,
    parse: async function* () {
      yield {
        path: 'hello.txt',
        type: 'file',
        size: 5,
        mode: 0o644,
        mtime: new Date(0),
        sourceFormat: 'valid',
        buffer: async () => Buffer.from('hello'),
      };
    },
  };
  const input = Buffer.from('valid');

  const listed = await listArchive(input, { plugins: [validPlugin], maxArchiveSize: 1024 });
  assert.equal(listed.length, 1);
  assert.equal(listed[0]!.path, 'hello.txt');

  const audited = await auditArchive(input, { plugins: [validPlugin], maxArchiveSize: 1024 });
  assert.equal(audited.entryCount, 1);
  assert.equal(audited.entries[0]!.path, 'hello.txt');

  await withTempDir(async (dir) => {
    const target = nodePath.join(dir, 'out');
    const result = await extract(input, target, {
      plugins: [validPlugin],
      maxArchiveSize: 1024,
    });
    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0]!.path, 'hello.txt');
  });
});
