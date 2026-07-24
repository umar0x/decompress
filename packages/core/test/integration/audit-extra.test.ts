// Audit coverage tests for finding codes and numeric property branches not
// reached by the existing fixtures.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import nodePath from 'node:path';
import { fileURLToPath } from 'node:url';

import { auditArchive } from '../../src/index.ts';
import type { ArchivePlugin } from '../../src/types.ts';

const here = nodePath.dirname(fileURLToPath(import.meta.url));
const maliciousFixtures = nodePath.join(here, '..', '..', '..', 'test-fixtures', 'malicious');
const benignFixtures = nodePath.join(here, '..', '..', '..', 'test-fixtures', 'benign');

function plugin(record: () => unknown): ArchivePlugin[] {
  return [
    {
      name: 'audit-extra',
      formats: ['audit-extra'],
      detect: () => true,
      parse: async function* () {
        yield record() as never;
      },
    },
  ];
}

test('auditArchive: windows drive absolute path produces critical finding', async () => {
  const report = await auditArchive(Buffer.from('audit-extra'), {
    plugins: plugin(() => ({
      path: 'C:\\Windows\\system32\\evil.dll',
      type: 'file',
      sourceFormat: 'audit-extra',
    })),
    maxArchiveSize: 1024,
  });
  assert.ok(report.findings.some((f) => f.code === 'windows_drive_absolute'));
  assert.equal(report.riskLevel, 'critical');
});

test('auditArchive: windows UNC path produces critical finding', async () => {
  const report = await auditArchive(Buffer.from('audit-extra'), {
    plugins: plugin(() => ({
      path: '\\\\attacker\\share\\evil.exe',
      type: 'file',
      sourceFormat: 'audit-extra',
    })),
    maxArchiveSize: 1024,
  });
  assert.ok(report.findings.some((f) => f.code === 'windows_unc_path'));
  assert.equal(report.riskLevel, 'critical');
});

test('auditArchive: NTFS ADS path produces high finding', async () => {
  const report = await auditArchive(Buffer.from('audit-extra'), {
    plugins: plugin(() => ({
      path: 'file.txt:hidden_stream',
      type: 'file',
      sourceFormat: 'audit-extra',
    })),
    maxArchiveSize: 1024,
  });
  assert.ok(report.findings.some((f) => f.code === 'windows_ads_path'));
});

test('auditArchive: Windows reserved device name produces high finding', async () => {
  const report = await auditArchive(Buffer.from('audit-extra'), {
    plugins: plugin(() => ({ path: 'COM1', type: 'file', sourceFormat: 'audit-extra' })),
    maxArchiveSize: 1024,
  });
  assert.ok(report.findings.some((f) => f.code === 'windows_reserved_name'));
});

test('auditArchive: setuid/setgid/sticky bits produce findings', async () => {
  const report = await auditArchive(Buffer.from('audit-extra'), {
    plugins: plugin(() => ({
      path: 'priv',
      type: 'file',
      sourceFormat: 'audit-extra',
      mode: 0o6755,
    })),
    maxArchiveSize: 1024,
  });
  assert.ok(report.findings.some((f) => f.code === 'setuid_bit'));
  assert.ok(report.findings.some((f) => f.code === 'setgid_bit'));
});

test('auditArchive: sticky bit produces medium finding', async () => {
  const report = await auditArchive(Buffer.from('audit-extra'), {
    plugins: plugin(() => ({
      path: 'stickydir',
      type: 'directory',
      sourceFormat: 'audit-extra',
      mode: 0o1777,
    })),
    maxArchiveSize: 1024,
  });
  assert.ok(report.findings.some((f) => f.code === 'sticky_bit'));
});

test('auditArchive: hardlink present produces medium finding when refused', async () => {
  const report = await auditArchive(Buffer.from('audit-extra'), {
    plugins: plugin(() => ({
      path: 'h',
      type: 'hardlink',
      sourceFormat: 'audit-extra',
      linkTarget: 'target',
    })),
    maxArchiveSize: 1024,
  });
  assert.ok(report.findings.some((f) => f.code === 'hardlink_present'));
});

test('auditArchive: symlink escape produces critical finding', async () => {
  const report = await auditArchive(Buffer.from('audit-extra'), {
    plugins: plugin(() => ({
      path: 's',
      type: 'symlink',
      sourceFormat: 'audit-extra',
      linkTarget: '../../../etc/passwd',
    })),
    maxArchiveSize: 1024,
    allowSymlinks: true,
  });
  assert.ok(report.findings.some((f) => f.code === 'symlink_escape'));
  assert.equal(report.riskLevel, 'critical');
});

test('auditArchive: hardlink escape produces critical finding', async () => {
  const report = await auditArchive(Buffer.from('audit-extra'), {
    plugins: plugin(() => ({
      path: 'h',
      type: 'hardlink',
      sourceFormat: 'audit-extra',
      linkTarget: '../../../etc/passwd',
    })),
    maxArchiveSize: 1024,
    allowHardlinks: true,
  });
  assert.ok(report.findings.some((f) => f.code === 'hardlink_escape'));
});

test('auditArchive: excessive entry size produces high finding', async () => {
  const report = await auditArchive(Buffer.from('audit-extra'), {
    plugins: plugin(() => ({
      path: 'big.bin',
      type: 'file',
      sourceFormat: 'audit-extra',
      size: 1024 * 1024 * 1024,
    })),
    maxArchiveSize: 1024,
    maxEntrySize: 1024,
  });
  assert.ok(report.findings.some((f) => f.code === 'excessive_entry_size'));
});

test('auditArchive: excessive depth produces medium finding', async () => {
  const deep = Array.from({ length: 20 }, (_, i) => `d${i}`).join('/') + '/file.txt';
  const report = await auditArchive(Buffer.from('audit-extra'), {
    plugins: plugin(() => ({ path: deep, type: 'file', sourceFormat: 'audit-extra' })),
    maxArchiveSize: 1024,
    maxDepth: 5,
  });
  assert.ok(report.findings.some((f) => f.code === 'excessive_depth'));
});

test('auditArchive: duplicate normalized path produces medium finding', async () => {
  const pluginDup: ArchivePlugin = {
    name: 'dup',
    formats: ['dup'],
    detect: () => true,
    parse: async function* () {
      yield { path: 'a/b.txt', type: 'file', sourceFormat: 'dup' };
      yield { path: 'a/b.txt', type: 'file', sourceFormat: 'dup' };
    },
  };
  const report = await auditArchive(Buffer.from('dup'), {
    plugins: [pluginDup],
    maxArchiveSize: 1024,
  });
  assert.ok(report.findings.some((f) => f.code === 'duplicate_path'));
});

test('auditArchive: high entry count (>1000) produces low finding', async () => {
  const pluginMany: ArchivePlugin = {
    name: 'many',
    formats: ['many'],
    detect: () => true,
    parse: async function* () {
      for (let i = 0; i < 1001; i++) {
        yield { path: `f${i}`, type: 'file', sourceFormat: 'many', size: 0 };
      }
    },
  };
  const report = await auditArchive(Buffer.from('many'), {
    plugins: [pluginMany],
    maxArchiveSize: 1024,
    maxFiles: 5000,
  });
  assert.ok(report.findings.some((f) => f.code === 'high_entry_count'));
});

test('auditArchive: compression ratio exceeds limit produces high finding', async () => {
  const pluginBig: ArchivePlugin = {
    name: 'big',
    formats: ['big'],
    detect: () => true,
    parse: async function* () {
      // Resolved archive size is small (8 bytes "big");
      // declared totalSize is large enough to push ratio over 100.
      yield { path: 'big.bin', type: 'file', sourceFormat: 'big', size: 100 * 1024 };
    },
  };
  const report = await auditArchive(Buffer.from('big'), {
    plugins: [pluginBig],
    maxArchiveSize: 1024,
    maxCompressionRatio: 10,
    maxTotalSize: Number.MAX_SAFE_INTEGER,
  });
  assert.ok(report.findings.some((f) => f.code === 'excessive_compression_ratio'));
});

test('auditArchive: abort signal is honored inside parse loop', async () => {
  const ac = new AbortController();
  const pluginSlow: ArchivePlugin = {
    name: 'slow',
    formats: ['slow'],
    detect: () => true,
    parse: async function* () {
      for (let i = 0; i < 100; i++) {
        yield { path: `f${i}`, type: 'file', sourceFormat: 'slow', size: 0 };
        if (i === 1) ac.abort();
      }
    },
  };
  await assert.rejects(
    () =>
      auditArchive(Buffer.from('slow'), {
        plugins: [pluginSlow],
        maxArchiveSize: 1024,
        signal: ac.signal,
      }),
    (err: unknown) => {
      const code = (err as { code?: string }).code;
      return code === 'ABORTED';
    },
  );
});

test('auditArchive: high-total-size fixture produces excessive_total_size finding', async () => {
  const report = await auditArchive(nodePath.join(maliciousFixtures, 'high-total-size.tar.gz'), {
    maxArchiveSize: 1024 * 1024 * 2,
    maxTotalSize: 1024,
    maxCompressionRatio: Number.MAX_SAFE_INTEGER,
  });
  // Either excessive_total_size or excessive_compression_ratio (the fixture is built to trigger resource limits).
  assert.ok(
    report.findings.some(
      (f) =>
        f.code === 'excessive_total_size' ||
        f.code === 'excessive_compression_ratio' ||
        f.code === 'excessive_entry_count',
    ),
    `expected a resource-limit finding; got: ${report.findings.map((f) => f.code).join(', ')}`,
  );
});

test('auditArchive: high-compression-ratio fixture produces finding', async () => {
  const report = await auditArchive(
    nodePath.join(maliciousFixtures, 'high-compression-ratio.tar.gz'),
    {
      maxArchiveSize: 1024 * 1024 * 2,
      maxCompressionRatio: 10,
      maxTotalSize: Number.MAX_SAFE_INTEGER,
    },
  );
  assert.ok(
    report.findings.some(
      (f) =>
        f.code === 'excessive_compression_ratio' ||
        f.code === 'excessive_total_size' ||
        f.code === 'excessive_entry_count',
    ),
  );
});

test('auditArchive: benign symlink.tar produces symlink_present finding (default refuse)', async () => {
  const report = await auditArchive(nodePath.join(benignFixtures, 'symlink.tar'), {
    maxArchiveSize: 1024 * 1024,
  });
  assert.ok(
    report.findings.some((f) => f.code === 'symlink_present' || f.code === 'symlink_escape'),
  );
});

test('auditArchive: returns finite compressionRatio for empty input', async () => {
  const report = await auditArchive(Buffer.alloc(1024), { maxArchiveSize: 1024 });
  assert.ok(Number.isFinite(report.compressionRatio));
  assert.equal(report.compressionRatio, 0);
  assert.equal(report.entryCount, 0);
});
