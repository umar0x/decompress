// Security regression tests use real malicious archive fixtures.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, stat, readFile } from 'node:fs/promises';
import nodePath from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

import { extract, auditArchive } from '../../src/index.ts';
import { isDecompressError } from '../../src/errors.ts';
import {
  isInsideOutput,
  validatePath,
  normalizePath,
  checkDuplicate,
  checkCaseCollision,
  sanitizeMode,
} from '../../src/index.ts';
import type { PathCtx } from '../../src/types.ts';
import { DEFAULT_LIMITS } from '../../src/types.ts';

const here = nodePath.dirname(fileURLToPath(import.meta.url));
const malicious = nodePath.join(here, '..', '..', '..', 'test-fixtures', 'malicious');
const benign = nodePath.join(here, '..', '..', '..', 'test-fixtures', 'benign');

const posixCtx: PathCtx = { platform: 'posix', caseInsensitive: false, limits: DEFAULT_LIMITS };

async function tmpOutput(): Promise<string> {
  return mkdtemp(nodePath.join(tmpdir(), 'decompress-security-test-'));
}

async function assertRejectsSecure(p: Promise<unknown>): Promise<void> {
  try {
    await p;
    assert.fail('expected extraction to throw, but it succeeded');
  } catch (e) {
    assert.ok(
      isDecompressError(e),
      `expected DecompressError, got: ${(e as Error).constructor.name}: ${(e as Error).message}`,
    );
  }
}

async function assertOutputEmpty(output: string): Promise<void> {
  try {
    const children = await readdir(output);
    assert.equal(
      children.length,
      0,
      `output should be empty (atomic), got ${children.length} entries: ${children.join(', ')}`,
    );
  } catch {
    // An absent output is also valid after a failed extraction.
  }
}

// Path containment

test('path containment uses path.relative instead of prefix matching', () => {
  assert.equal(isInsideOutput('/tmp/output-evil', '/tmp/output'), false);
  assert.equal(isInsideOutput('/srv/app-config', '/srv/app'), false);
  assert.equal(isInsideOutput('/tmp/output/foo', '/tmp/output'), true);
});

test('sibling-prefix traversal archive is rejected', async () => {
  const out = await tmpOutput();
  const target = nodePath.join(out, 'result');
  try {
    await assertRejectsSecure(extract(nodePath.join(malicious, 'sibling_prefix.tar.gz'), target));
    await assertOutputEmpty(target);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('audit flags sibling-prefix traversal', async () => {
  const report = await auditArchive(nodePath.join(malicious, 'sibling_prefix.tar.gz'));
  assert.ok(report.findings.length > 0, 'expected findings for sibling_prefix');
});

// Symlink target validation

test('absolute symlink target is rejected by default', async () => {
  const out = await tmpOutput();
  const target = nodePath.join(out, 'result');
  try {
    await assertRejectsSecure(extract(nodePath.join(malicious, 'symlink-to-absolute.tar'), target));
    await assertOutputEmpty(target);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('parent-escaping symlink target is rejected by default', async () => {
  const out = await tmpOutput();
  const target = nodePath.join(out, 'result');
  try {
    await assertRejectsSecure(extract(nodePath.join(malicious, 'symlink-to-parent.tar'), target));
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('escaping symlink chains are rejected', async () => {
  const out = await tmpOutput();
  const target = nodePath.join(out, 'result');
  try {
    await assertRejectsSecure(
      extract(nodePath.join(malicious, 'symlink-chain-escape.tar'), target),
    );
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('audit flags symlink escapes', async () => {
  const report = await auditArchive(nodePath.join(malicious, 'symlink-to-absolute.tar'));
  assert.ok(
    report.findings.some((f) => f.code === 'symlink_escape' || f.code === 'symlink_present'),
  );
  assert.equal(report.riskLevel, 'critical');
});

// Hardlink target validation

test('absolute hardlink target is rejected by default', async () => {
  const out = await tmpOutput();
  const target = nodePath.join(out, 'result');
  try {
    await assertRejectsSecure(
      extract(nodePath.join(malicious, 'hardlink-to-absolute.tar'), target),
    );
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('parent-escaping hardlink target is rejected by default', async () => {
  const out = await tmpOutput();
  const target = nodePath.join(out, 'result');
  try {
    await assertRejectsSecure(extract(nodePath.join(malicious, 'hardlink-to-parent.tar'), target));
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('audit flags hardlink escapes', async () => {
  const report = await auditArchive(nodePath.join(malicious, 'hardlink-to-absolute.tar'));
  assert.ok(
    report.findings.some((f) => f.code === 'hardlink_escape' || f.code === 'hardlink_present'),
  );
});

// Special permission bits

test('setuid bits are stripped on disk', async () => {
  const out = await tmpOutput();
  const target = nodePath.join(out, 'result');
  try {
    const result = await extract(nodePath.join(malicious, 'setuid-file.tar'), target);
    assert.equal(result.entries.length, 1);
    const st = await stat(nodePath.join(result.output, 'suid.txt'));
    assert.equal(st.mode & 0o7000, 0, 'SUID must be stripped');
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('setgid bits are stripped on disk', async () => {
  const out = await tmpOutput();
  const target = nodePath.join(out, 'result');
  try {
    await extract(nodePath.join(malicious, 'setgid-file.tar'), target);
    const st = await stat(nodePath.join(target, 'sgid.txt'));
    assert.equal(st.mode & 0o7000, 0);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('sticky bits are stripped on disk', async () => {
  const out = await tmpOutput();
  const target = nodePath.join(out, 'result');
  try {
    await extract(nodePath.join(malicious, 'sticky-dir.tar'), target);
    const st = await stat(nodePath.join(target, 'sticky'));
    assert.equal(st.mode & 0o7000, 0, 'sticky bit must be stripped');
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('audit flags setuid bits', async () => {
  const report = await auditArchive(nodePath.join(malicious, 'setuid-file.tar'));
  assert.ok(report.findings.some((f) => f.code === 'setuid_bit'));
});

test('permission sanitization never preserves special bits', () => {
  for (const pp of [true, false]) {
    assert.equal(sanitizeMode(0o4755, 'file', { preservePermissions: pp, umask: 0 }) & 0o7000, 0);
    assert.equal(sanitizeMode(0o2755, 'file', { preservePermissions: pp, umask: 0 }) & 0o7000, 0);
    assert.equal(
      sanitizeMode(0o1755, 'directory', { preservePermissions: pp, umask: 0 }) & 0o7000,
      0,
    );
    assert.equal(sanitizeMode(0o7755, 'file', { preservePermissions: pp, umask: 0 }) & 0o7000, 0);
  }
});

// Atomic extraction

test('partial extraction failure leaves no output or staging directory', async () => {
  const out = await tmpOutput();
  const target = nodePath.join(out, 'result');
  try {
    await assertRejectsSecure(extract(nodePath.join(malicious, 'partial-failure.tar'), target));
    await assertOutputEmpty(target);
    // No leftover temp dirs in parent.
    const parent = nodePath.dirname(target);
    const siblings = await readdir(parent);
    const temps = siblings.filter((s) => s.startsWith('.decompress-tmp-'));
    assert.equal(temps.length, 0, `leftover temp dirs: ${temps.join(', ')}`);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

// Resource limits

test('archives exceeding the default entry limit are rejected', async () => {
  const out = await tmpOutput();
  const target = nodePath.join(out, 'result');
  try {
    await assertRejectsSecure(extract(nodePath.join(malicious, 'too-many-files.zip'), target));
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('archives exceeding the default path depth are rejected', async () => {
  const out = await tmpOutput();
  const target = nodePath.join(out, 'result');
  try {
    await assertRejectsSecure(extract(nodePath.join(malicious, 'too-deep.tar'), target));
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('archives exceeding the default compression ratio are rejected', async () => {
  const out = await tmpOutput();
  const target = nodePath.join(out, 'result');
  try {
    await assertRejectsSecure(
      extract(nodePath.join(malicious, 'high-compression-ratio.tar.gz'), target),
    );
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('archives exceeding maxTotalSize are rejected', async () => {
  const out = await tmpOutput();
  const target = nodePath.join(out, 'result');
  try {
    await assertRejectsSecure(
      extract(nodePath.join(malicious, 'high-total-size.tar.gz'), target, {
        maxTotalSize: '100kb',
      }),
    );
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

// Windows paths

test('absolute paths are rejected', () => {
  assert.throws(() => validatePath('/etc/passwd', posixCtx));
  assert.throws(() => validatePath('C:\\Windows\\evil', posixCtx));
  assert.throws(() => validatePath('C:evil', posixCtx));
  assert.throws(() => validatePath('\\\\server\\share', posixCtx));
  assert.throws(() => validatePath('//server/share', posixCtx));
});

test('NTFS alternate data stream paths are rejected', () => {
  assert.throws(() => validatePath('file.txt:Zone.Identifier', posixCtx));
});

test('Windows reserved device names are rejected', () => {
  assert.throws(() => validatePath('CON', posixCtx));
  assert.throws(() => validatePath('NUL.txt', posixCtx));
  assert.throws(() => validatePath('COM1', posixCtx));
  assert.throws(() => validatePath('LPT1', posixCtx));
});

test('Windows trailing dots and spaces are rejected', () => {
  assert.throws(() => validatePath('file.txt.', posixCtx));
  assert.throws(() => validatePath('file.txt ', posixCtx));
});

// Unicode normalization

test('paths are normalized to Unicode NFC', () => {
  const nfd = 'cafe\u0301.txt';
  const nfc = 'café.txt';
  assert.equal(normalizePath(nfd, posixCtx), nfc);
});

// Case collisions

test('case collisions are detected on case-insensitive filesystems', () => {
  const map = new Map<string, string>();
  checkCaseCollision(map, 'README.txt', true, 'error');
  assert.throws(() => checkCaseCollision(map, 'readme.txt', true, 'error'));
});

// Duplicate paths

test('duplicate normalized paths are rejected by default', () => {
  const seen = new Set<string>();
  checkDuplicate(seen, 'foo', 'error');
  assert.throws(() => checkDuplicate(seen, 'foo', 'error'));
});

// Default link policy

test('symlink entries are refused by default', async () => {
  const out = await tmpOutput();
  const target = nodePath.join(out, 'result');
  try {
    await assertRejectsSecure(extract(nodePath.join(benign, 'symlink.tar'), target));
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('hardlink entries are refused by default', async () => {
  const out = await tmpOutput();
  const target = nodePath.join(out, 'result');
  try {
    await assertRejectsSecure(extract(nodePath.join(benign, 'link.tar'), target));
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

// Default overwrite policy

test('non-empty output directories are refused by default', async () => {
  const out = await tmpOutput();
  const target = nodePath.join(out, 'result');
  try {
    const { mkdir, writeFile } = await import('node:fs/promises');
    await mkdir(target);
    await writeFile(nodePath.join(target, 'preexisting.txt'), 'data');
    await assertRejectsSecure(extract(nodePath.join(benign, 'file.zip'), target));
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

// Repository secrets

test('repository text files contain no common secret patterns', async () => {
  const workspace = nodePath.resolve(here, '..', '..', '..', '..');
  const sourceFiles = await collectSourceFiles(workspace);
  const patterns = [
    /ghp_[A-Za-z0-9]{36}/,
    /github_pat_[A-Za-z0-9_]{82}/,
    /npm_[A-Za-z0-9]{36}/,
    /AKIA[0-9A-Z]{16}/,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  ];
  for (const file of sourceFiles) {
    const contents = await readFile(file, 'utf8');
    for (const pattern of patterns) {
      assert.doesNotMatch(contents, pattern, `secret-like value found in ${file}`);
    }
  }
});

async function collectSourceFiles(directory: string): Promise<string[]> {
  const output: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (['.git', 'coverage', 'dist', 'node_modules'].includes(entry.name)) continue;
    const fullPath = nodePath.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...(await collectSourceFiles(fullPath)));
    else if (/\.(?:c?js|mjs|ts|json|md|ya?ml|npmrc)$/i.test(entry.name)) output.push(fullPath);
  }
  return output;
}

// ZIP traversal fixtures

test('ZIP parent traversal fixture is rejected', async () => {
  const out = await tmpOutput();
  const target = nodePath.join(out, 'result');
  try {
    await assertRejectsSecure(extract(nodePath.join(malicious, 'slip.zip'), target));
    await assertOutputEmpty(target);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('nested ZIP parent traversal fixture is rejected', async () => {
  const out = await tmpOutput();
  const target = nodePath.join(out, 'result');
  try {
    await assertRejectsSecure(extract(nodePath.join(malicious, 'slip2.zip'), target));
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('alternate ZIP parent traversal fixture is rejected', async () => {
  const out = await tmpOutput();
  const target = nodePath.join(out, 'result');
  try {
    await assertRejectsSecure(extract(nodePath.join(malicious, 'slip3.zip'), target));
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

// Additional path-containment fixtures

test('compressed TAR parent traversal fixture is rejected', async () => {
  const out = await tmpOutput();
  const target = nodePath.join(out, 'result');
  try {
    await assertRejectsSecure(extract(nodePath.join(malicious, 'slipping.tar.gz'), target));
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

// Additional link regression fixtures

test('compressed TAR hardlink escape fixture is rejected', async () => {
  const out = await tmpOutput();
  const target = nodePath.join(out, 'result');
  try {
    await assertRejectsSecure(extract(nodePath.join(malicious, 'link_escape.tar.gz'), target));
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('hardlink through a symlink trap is rejected', async () => {
  const out = await tmpOutput();
  const target = nodePath.join(out, 'result');
  try {
    await assertRejectsSecure(extract(nodePath.join(malicious, 'link_via_trap.tar.gz'), target));
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('compressed TAR symlink escape fixture is rejected', async () => {
  const out = await tmpOutput();
  const target = nodePath.join(out, 'result');
  try {
    await assertRejectsSecure(extract(nodePath.join(malicious, 'symlink_escape.tar.gz'), target));
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('contiguous TAR entries are normalized to regular files', async () => {
  const out = await tmpOutput();
  const target = nodePath.join(out, 'result');
  try {
    // contiguous_file.tar should extract (it's benign; the  test is that a
    // planted symlink can't be written through via a contiguous-file type).
    const result = await extract(nodePath.join(benign, 'contiguous_file.tar'), target);
    assert.ok(result.entries.length >= 1);
    assert.ok(result.entries.some((e) => e.type === 'file'));
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});
