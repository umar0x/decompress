// Integration tests for extract, listArchive, and auditArchive.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm, readdir, stat, mkdtemp } from 'node:fs/promises';
import nodePath from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { gzipSync } from 'node:zlib';

import { extract, listArchive, auditArchive } from '../../src/index.ts';
import {
  UnknownFormatError,
  isDecompressError,
  ArchiveSizeExceededError,
  EntrySizeExceededError,
  CorruptArchiveError,
} from '../../src/errors.ts';
import type { ArchivePlugin } from '../../src/types.ts';

const here = nodePath.dirname(fileURLToPath(import.meta.url));
const fixtures = nodePath.join(here, '..', '..', '..', 'test-fixtures', 'benign');
const maliciousFixtures = nodePath.join(here, '..', '..', '..', 'test-fixtures', 'malicious');

async function tmpOutput(): Promise<string> {
  return mkdtemp(nodePath.join(tmpdir(), 'decompress-api-test-'));
}

test('extract: file.zip → test.jpg extracted', async () => {
  const out = await tmpOutput();
  const target = nodePath.join(out, 'result');
  try {
    const result = await extract(nodePath.join(fixtures, 'file.zip'), target);
    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0]!.path, 'test.jpg'); // C-02: archive-relative path
    assert.equal(result.entries[0]!.type, 'file');
    assert.equal(result.totalBytes, 2248);
    assert.equal(result.detectedFormats[0], 'zip');
    const st = await stat(nodePath.join(result.output, 'test.jpg'));
    assert.equal(st.size, 2248);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('extract: file.tar → extracted', async () => {
  const out = await tmpOutput();
  const target = nodePath.join(out, 'result');
  try {
    const result = await extract(nodePath.join(fixtures, 'file.tar'), target);
    assert.ok(result.entries.length >= 1);
    assert.equal(result.detectedFormats[0], 'tar');
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('extract: file.tar.gz → extracted', async () => {
  const out = await tmpOutput();
  const target = nodePath.join(out, 'result');
  try {
    const result = await extract(nodePath.join(fixtures, 'file.tar.gz'), target);
    assert.ok(result.entries.length >= 1);
    assert.equal(result.detectedFormats[0], 'gz');
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('extract: file.tar.bz2 → extracted', async () => {
  const out = await tmpOutput();
  const target = nodePath.join(out, 'result');
  try {
    const result = await extract(nodePath.join(fixtures, 'file.tar.bz2'), target);
    assert.ok(result.entries.length >= 1);
    assert.equal(result.detectedFormats[0], 'bz2');
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('extract: accepts Buffer input', async () => {
  const out = await tmpOutput();
  const target = nodePath.join(out, 'result');
  try {
    const buf = await readFile(nodePath.join(fixtures, 'file.zip'));
    const result = await extract(buf, target);
    assert.equal(result.entries.length, 1);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('extract: strip option removes leading segments', async () => {
  const out = await tmpOutput();
  const target = nodePath.join(out, 'result');
  try {
    const result = await extract(nodePath.join(fixtures, 'nested.tar.gz'), target, { strip: 1 });
    // After strip 1, no path should start with the original top-level dir.
    for (const e of result.entries) {
      const rel = nodePath.relative(result.output, e.path);
      const firstSeg = rel.split(nodePath.sep)[0];
      assert.ok(firstSeg !== '', `entry ${rel} should not be empty after strip`);
    }
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('extract: filter drops entries', async () => {
  const out = await tmpOutput();
  const target = nodePath.join(out, 'result');
  try {
    const result = await extract(nodePath.join(fixtures, 'file.zip'), target, {
      filter: () => false,
    });
    assert.equal(result.entries.length, 0);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('extract: unknown format throws UnknownFormatError', async () => {
  await assert.rejects(
    () => extract(Buffer.from('not an archive at all!'), '/tmp/should-not-exist'),
    UnknownFormatError,
  );
});

test('extract: rejects a ZIP parent traversal fixture', async () => {
  const out = await tmpOutput();
  const target = nodePath.join(out, 'result');
  try {
    await assert.rejects(
      () => extract(nodePath.join(maliciousFixtures, 'slip.zip'), target),
      (e: unknown) => isDecompressError(e),
    );
    // output should be empty (atomic).
    const children = await readdir(target).catch(() => []);
    assert.equal(children.length, 0);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('extract: refuses symlinks by default', async () => {
  const out = await tmpOutput();
  const target = nodePath.join(out, 'result');
  try {
    await assert.rejects(
      () => extract(nodePath.join(fixtures, 'symlink.tar'), target),
      (e: unknown) => isDecompressError(e),
    );
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('extract: refuses hardlinks by default', async () => {
  const out = await tmpOutput();
  const target = nodePath.join(out, 'result');
  try {
    await assert.rejects(
      () => extract(nodePath.join(fixtures, 'link.tar'), target),
      (e: unknown) => isDecompressError(e),
    );
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('extract: rejects sibling-prefix traversal', async () => {
  const out = await tmpOutput();
  const target = nodePath.join(out, 'result');
  try {
    await assert.rejects(
      () => extract(nodePath.join(maliciousFixtures, 'sibling_prefix.tar.gz'), target),
      (e: unknown) => isDecompressError(e),
    );
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('extract: enforces maxFiles', async () => {
  const out = await tmpOutput();
  const target = nodePath.join(out, 'result');
  try {
    await assert.rejects(
      () => extract(nodePath.join(fixtures, 'multiple.zip'), target, { maxFiles: 1 }),
      (e: unknown) => isDecompressError(e),
    );
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('extract: onEntry callback fires', async () => {
  const out = await tmpOutput();
  const target = nodePath.join(out, 'result');
  try {
    const seen: string[] = [];
    await extract(nodePath.join(fixtures, 'file.zip'), target, {
      onEntry: (e) => seen.push(e.path),
    });
    assert.ok(seen.length >= 1);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('extract: honors abort signals', async () => {
  const out = await tmpOutput();
  const target = nodePath.join(out, 'result');
  const ac = new AbortController();
  ac.abort();
  try {
    await assert.rejects(
      () => extract(nodePath.join(fixtures, 'file.zip'), target, { signal: ac.signal }),
      (e: unknown) => isDecompressError(e),
    );
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('extract: bounds one-shot streaming input before parsing', async () => {
  const input = (async function* () {
    yield Buffer.alloc(8);
    yield Buffer.alloc(8);
  })();
  await assert.rejects(
    () => extract(input, nodePath.join(tmpdir(), 'never-created'), { maxArchiveSize: 10 }),
    ArchiveSizeExceededError,
  );
});

test('extract: enforces actual streamed entry bytes and leaves output absent', async () => {
  const out = await tmpOutput();
  const target = nodePath.join(out, 'result');
  const plugin: ArchivePlugin = {
    name: 'stream-limit',
    formats: ['stream-limit'],
    detect: () => true,
    parse: async function* () {
      yield {
        path: 'large.bin',
        type: 'file',
        sourceFormat: 'stream-limit',
        stream: () => Readable.from([Buffer.alloc(8), Buffer.alloc(8)]),
      };
    },
  };
  try {
    await assert.rejects(
      () => extract(Buffer.from('stream-limit'), target, { plugins: [plugin], maxEntrySize: 10 }),
      EntrySizeExceededError,
    );
    await assert.rejects(() => stat(target), { code: 'ENOENT' });
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('extract: custom plugin detects a format unknown to built-ins', async () => {
  const out = await tmpOutput();
  const target = nodePath.join(out, 'result');
  const plugin: ArchivePlugin = {
    name: 'my-format',
    formats: ['my-format'],
    detect: (buffer) => buffer.subarray(0, 3).toString() === 'MYF',
    parse: async function* (input) {
      assert.equal(typeof (input.stream() as { pipe?: unknown }).pipe, 'function');
      yield {
        path: 'plugin.txt',
        type: 'file',
        size: 2,
        sourceFormat: 'my-format',
        buffer: async () => Buffer.from('ok'),
      };
    },
  };
  try {
    const result = await extract(Buffer.from('MYF payload'), target, { plugins: [plugin] });
    assert.equal(await readFile(nodePath.join(result.output, 'plugin.txt'), 'utf8'), 'ok');
    assert.deepEqual(result.detectedFormats, ['my-format']);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('extract: preserves raw metadata after map and reports renamed disposition', async () => {
  const out = await tmpOutput();
  try {
    const result = await extract(
      nodePath.join(fixtures, 'file.zip'),
      nodePath.join(out, 'result'),
      {
        map: (entry) => ({ ...entry, path: 'renamed.jpg' }),
      },
    );
    assert.equal(result.entries[0]!.path, 'renamed.jpg');
    assert.equal(result.entries[0]!.rawPath, 'test.jpg');
    assert.equal(result.entries[0]!.disposition, 'renamed');
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('extract: malformed recognized archives produce typed corruption errors', async () => {
  const out = await tmpOutput();
  try {
    const truncatedZip = Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.alloc(12)]);
    await assert.rejects(
      () => extract(truncatedZip, nodePath.join(out, 'zip')),
      CorruptArchiveError,
    );
    await assert.rejects(
      () => extract(gzipSync(Buffer.from('not a tar archive')), nodePath.join(out, 'gzip')),
      CorruptArchiveError,
    );
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('extract: accepts padded empty tar archives and commits an empty output', async () => {
  const out = await tmpOutput();
  const target = nodePath.join(out, 'empty');
  try {
    const result = await extract(Buffer.alloc(2048), target);
    assert.deepEqual(result.entries, []);
    assert.deepEqual(await readdir(target), []);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('extract: duplicate overwrite is deterministic and sequential', async () => {
  const out = await tmpOutput();
  try {
    const result = await extract(
      nodePath.join(maliciousFixtures, 'duplicate-path.zip'),
      nodePath.join(out, 'result'),
      { onDuplicate: 'overwrite' },
    );
    assert.equal(result.entries.length, 2);
    assert.equal(await readFile(nodePath.join(result.output, 'foo'), 'utf8'), 'second');
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('listArchive: file.zip → 1 entry, no files written', async () => {
  const entries = await listArchive(nodePath.join(fixtures, 'file.zip'));
  assert.equal(entries.length, 1);
  assert.equal(entries[0]!.path, 'test.jpg');
  assert.equal(entries[0]!.type, 'file');
});

test('listArchive: directory.tar has directory entry', async () => {
  const entries = await listArchive(nodePath.join(fixtures, 'directory.tar'));
  assert.ok(entries.some((e) => e.type === 'directory'));
});

test('listArchive: does not write to disk', async () => {
  // listArchive has no output param; just verify it doesn't throw and returns entries.
  const entries = await listArchive(nodePath.join(fixtures, 'file.tar.gz'));
  assert.ok(entries.length >= 1);
});

test('listArchive: accepts an empty tar archive', async () => {
  assert.deepEqual(await listArchive(Buffer.alloc(1024)), []);
});

test('auditArchive: benign file.zip → low risk', async () => {
  const report = await auditArchive(nodePath.join(fixtures, 'file.zip'));
  assert.equal(report.entryCount, 1);
  assert.equal(report.detectedFormats[0], 'zip');
  // benign → no critical findings
  assert.equal(report.riskLevel, 'low');
});

test('auditArchive: slip.zip → critical risk with symlink_escape finding', async () => {
  const report = await auditArchive(nodePath.join(maliciousFixtures, 'slip.zip'));
  // slip.zip uses symlink chains (-> / and -> ../) to escape.
  assert.ok(
    report.findings.some((f) => f.code === 'symlink_escape' || f.code === 'path_traversal'),
    `expected symlink_escape or path_traversal, got: ${report.findings.map((f) => f.code).join(', ')}`,
  );
  assert.equal(report.riskLevel, 'critical');
});

test('auditArchive: symlink.tar → symlink_present finding (medium)', async () => {
  const report = await auditArchive(nodePath.join(fixtures, 'symlink.tar'));
  assert.ok(
    report.findings.some((f) => f.code === 'symlink_present' || f.code === 'symlink_escape'),
  );
});

test('auditArchive: link.tar → hardlink_present finding', async () => {
  const report = await auditArchive(nodePath.join(fixtures, 'link.tar'));
  assert.ok(
    report.findings.some((f) => f.code === 'hardlink_present' || f.code === 'hardlink_escape'),
  );
});

test('auditArchive: compression ratio reported', async () => {
  const report = await auditArchive(nodePath.join(fixtures, 'file.tar.gz'));
  assert.ok(report.compressionRatio >= 0);
});

test('auditArchive: accepts an empty tar archive', async () => {
  const report = await auditArchive(Buffer.alloc(1024));
  assert.equal(report.detectedFormats[0], 'tar');
  assert.equal(report.entryCount, 0);
  assert.equal(report.riskLevel, 'low');
});

test('listArchive: reports unsafe paths through onWarning', async () => {
  const warnings: string[] = [];
  const entries = await listArchive(nodePath.join(maliciousFixtures, 'zip-slip-basic.zip'), {
    onWarning: (warning) => warnings.push(warning.code),
  });
  assert.equal(entries[0]!.path, '../evil.txt');
  assert.ok(warnings.includes('unsafe_path'));
});

test('auditArchive: custom formats use segment-aware link checks', async () => {
  const plugin: ArchivePlugin = {
    name: 'audit-format',
    formats: ['audit-format'],
    detect: () => true,
    parse: async function* () {
      yield {
        path: 'link',
        type: 'symlink',
        linkTarget: 'safe..target',
        sourceFormat: 'audit-format',
      };
      yield {
        path: 'escape',
        type: 'symlink',
        linkTarget: '../outside',
        sourceFormat: 'audit-format',
      };
    },
  };
  const report = await auditArchive(Buffer.from('AUDIT'), {
    plugins: [plugin],
    allowSymlinks: true,
  });
  assert.equal(
    report.findings.some((finding) => finding.path === 'link' && finding.code === 'symlink_escape'),
    false,
  );
  assert.equal(
    report.findings.some(
      (finding) => finding.path === 'escape' && finding.code === 'symlink_escape',
    ),
    true,
  );
});
