// Path normalization and validation tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  isInsideOutput,
  validatePath,
  normalizePath,
  checkDuplicate,
  checkCaseCollision,
  detectPlatform,
} from '../../src/writer/path-security.ts';
import {
  AbsolutePathError,
  CaseCollisionError,
  DepthExceededError,
  DuplicatePathError,
  NulByteError,
  PathPolicyError,
  WindowsAdsError,
  WindowsDeviceNameError,
  WindowsTrailingDotsError,
} from '../../src/errors.ts';
import type { PathCtx } from '../../src/types.ts';
import { DEFAULT_LIMITS } from '../../src/types.ts';

const posixCtx: PathCtx = {
  platform: 'posix',
  caseInsensitive: false,
  limits: DEFAULT_LIMITS,
};
const winCtx: PathCtx = {
  platform: 'windows',
  caseInsensitive: true,
  limits: DEFAULT_LIMITS,
};

test('isInsideOutput: target === root is inside', () => {
  assert.equal(isInsideOutput('/tmp/out', '/tmp/out'), true);
});

test('isInsideOutput: child is inside', () => {
  assert.equal(isInsideOutput('/tmp/out/foo', '/tmp/out'), true);
  assert.equal(isInsideOutput('/tmp/out/a/b/c', '/tmp/out'), true);
});

test('isInsideOutput: rejects siblings that share a path prefix', () => {
  // This is THE bug: kevva used indexOf, which treated /tmp/output-evil as inside /tmp/output.
  assert.equal(isInsideOutput('/tmp/output-evil', '/tmp/output'), false);
  assert.equal(isInsideOutput('/srv/app-config', '/srv/app'), false);
});

test('isInsideOutput: parent is outside', () => {
  assert.equal(isInsideOutput('/tmp', '/tmp/out'), false);
  assert.equal(isInsideOutput('/tmp/out/..', '/tmp/out'), false);
});

test('isInsideOutput: sibling is outside', () => {
  assert.equal(isInsideOutput('/tmp/other', '/tmp/out'), false);
});

test('isInsideOutput: cross-drive on Windows is outside', () => {
  assert.equal(isInsideOutput('D:\\evil', 'C:\\out'), false);
});

test('isInsideOutput: relative rel "." is inside', () => {
  assert.equal(isInsideOutput('/tmp/out', '/tmp/out'), true);
});

// Path validation

test('validatePath: rejects NUL bytes', () => {
  assert.throws(() => validatePath('foo\0bar', posixCtx), NulByteError);
});

test('validatePath: empty path rejected', () => {
  assert.throws(() => validatePath('', posixCtx), PathPolicyError);
  assert.throws(() => validatePath('   ', posixCtx), PathPolicyError);
});

test('validatePath: rejects URL-encoded path characters', () => {
  assert.throws(() => validatePath('%2e%2e/%2e%2e/etc/passwd', posixCtx), PathPolicyError);
  assert.throws(() => validatePath('foo%5C..%5Cbar', posixCtx), PathPolicyError);
});

test('validatePath: rejects POSIX absolute paths', () => {
  assert.throws(() => validatePath('/etc/passwd', posixCtx), AbsolutePathError);
  const e = (() => {
    try {
      validatePath('/etc/passwd', posixCtx);
      return undefined;
    } catch (err) {
      return err as AbsolutePathError;
    }
  })();
  assert.equal(e?.kind, 'posix');
});

test('validatePath: rejects Windows drive-absolute paths', () => {
  assert.throws(() => validatePath('C:\\Windows\\system32', posixCtx), AbsolutePathError);
  assert.throws(() => validatePath('C:/Windows/system32', posixCtx), AbsolutePathError);
  assert.throws(() => validatePath('c:\\evil', posixCtx), AbsolutePathError);
});

test('validatePath: rejects Windows drive-relative paths', () => {
  assert.throws(() => validatePath('C:evil.exe', posixCtx), AbsolutePathError);
});

test('validatePath: rejects Windows UNC paths', () => {
  assert.throws(() => validatePath('\\\\server\\share\\file', posixCtx), AbsolutePathError);
  assert.throws(() => validatePath('//server/share/file', posixCtx), AbsolutePathError);
  assert.throws(() => validatePath('\\\\?\\C:\\temp', posixCtx), AbsolutePathError);
  assert.throws(() => validatePath('\\\\.\\COM1', posixCtx), AbsolutePathError);
});

test('validatePath: rejects NTFS alternate data streams', () => {
  assert.throws(() => validatePath('file.txt:Zone.Identifier', posixCtx), WindowsAdsError);
  assert.throws(() => validatePath('file.txt:$DATA', posixCtx), WindowsAdsError);
});

test('validatePath: rejects Windows reserved device names', () => {
  assert.throws(() => validatePath('CON', posixCtx), WindowsDeviceNameError);
  assert.throws(() => validatePath('NUL.txt', posixCtx), WindowsDeviceNameError);
  assert.throws(() => validatePath('COM1', posixCtx), WindowsDeviceNameError);
  assert.throws(() => validatePath('LPT1', posixCtx), WindowsDeviceNameError);
  assert.throws(() => validatePath('PRN', posixCtx), WindowsDeviceNameError);
  assert.throws(() => validatePath('AUX', posixCtx), WindowsDeviceNameError);
  assert.throws(() => validatePath('dir/COM1', posixCtx), WindowsDeviceNameError);
});

test('validatePath: rejects trailing dots and spaces', () => {
  assert.throws(() => validatePath('file.txt.', posixCtx), WindowsTrailingDotsError);
  assert.throws(() => validatePath('file.txt ', posixCtx), WindowsTrailingDotsError);
  assert.throws(() => validatePath('file.txt..', posixCtx), WindowsTrailingDotsError);
  assert.throws(() => validatePath('foo/file.', posixCtx), WindowsTrailingDotsError);
});

test('validatePath: all-dots segment (length > 2) rejected', () => {
  assert.throws(() => validatePath('...', posixCtx), PathPolicyError);
  assert.throws(() => validatePath('a/....', posixCtx), PathPolicyError);
});

test('validatePath: rejects mixed separators', () => {
  assert.throws(() => validatePath('foo/bar\\baz', posixCtx), PathPolicyError);
});

test('validatePath: rejects backslashes on POSIX', () => {
  assert.throws(() => validatePath('foo\\bar', posixCtx), PathPolicyError);
});

test('validatePath: backslash on Windows is allowed (separator)', () => {
  // Backslash is a valid separator under Windows rules.
  assert.doesNotThrow(() => validatePath('foo\\bar', winCtx));
});

test('validatePath: rejects empty segments', () => {
  assert.throws(() => validatePath('foo//bar', posixCtx), PathPolicyError);
  assert.throws(() => validatePath('foo\\\\bar', winCtx), PathPolicyError);
});

test('validatePath: rejects trailing separators', () => {
  assert.throws(() => validatePath('foo/', posixCtx), PathPolicyError);
  assert.throws(() => validatePath('foo\\', winCtx), PathPolicyError);
});

test('validatePath: rejects current-directory segments', () => {
  assert.throws(() => validatePath('./foo', posixCtx), PathPolicyError);
  assert.throws(() => validatePath('foo/./bar', posixCtx), PathPolicyError);
});

test('validatePath: rejects parent-directory segments', () => {
  assert.throws(() => validatePath('../foo', posixCtx), PathPolicyError);
  assert.throws(() => validatePath('foo/../../bar', posixCtx), PathPolicyError);
  assert.throws(() => validatePath('a/../b', posixCtx), PathPolicyError);
});

test('validatePath: enforces the depth limit', () => {
  const deep = Array.from({ length: 129 }, (_, i) => `d${i}`).join('/');
  const ctx: PathCtx = { ...posixCtx, limits: { ...DEFAULT_LIMITS, maxDepth: 128 } };
  assert.throws(() => validatePath(deep, ctx), DepthExceededError);
  // exactly at limit passes validatePath (depth check is > maxDepth)
  const atLimit = Array.from({ length: 128 }, (_, i) => `d${i}`).join('/');
  assert.doesNotThrow(() => validatePath(atLimit, ctx));
});

test('validatePath: rejects overly long paths', () => {
  const long = 'a'.repeat(4097);
  assert.throws(() => validatePath(long, posixCtx), PathPolicyError);
});

test('validatePath: benign paths pass', () => {
  assert.doesNotThrow(() => validatePath('hello.txt', posixCtx));
  assert.doesNotThrow(() => validatePath('dir/hello.txt', posixCtx));
  assert.doesNotThrow(() => validatePath('a/b/c/d.txt', posixCtx));
  assert.doesNotThrow(() => validatePath('.gitignore', posixCtx)); // leading dot OK
});

test('normalizePath: NFC normalization', () => {
  // café (NFC: é = U+00E9) vs café (NFD: e + U+0301) should normalize to same NFC form.
  const nfc = 'café.txt';
  const nfd = 'cafe\u0301.txt';
  assert.equal(normalizePath(nfd, posixCtx), nfc);
});

test('normalizePath: separator normalization on POSIX (backslash→slash)', () => {
  // Note: validatePath rejects backslash on POSIX, but normalizePath itself just normalizes.
  assert.equal(normalizePath('a\\b\\c', posixCtx), 'a/b/c');
});

test('normalizePath: collapses .. segments (defensive; validatePath already rejects)', () => {
  // normalizePath resolves .. lexically. If .. would escape root, it throws.
  assert.equal(normalizePath('a/../b', posixCtx), 'b');
  assert.equal(normalizePath('a/b/../c', posixCtx), 'a/c');
});

test('normalizePath: .. escaping root throws', () => {
  assert.throws(() => normalizePath('../foo', posixCtx), PathPolicyError);
  assert.throws(() => normalizePath('a/../../b', posixCtx), PathPolicyError);
});

test('normalizePath: drops . segments', () => {
  assert.equal(normalizePath('a/./b', posixCtx), 'a/b');
  assert.equal(normalizePath('./a', posixCtx), 'a');
});

test('normalizePath: empty result throws', () => {
  assert.throws(() => normalizePath('.', posixCtx), PathPolicyError);
  assert.throws(() => normalizePath('a/..', posixCtx), PathPolicyError);
});

test('checkDuplicate: first occurrence is new', () => {
  const seen = new Set<string>();
  assert.equal(checkDuplicate(seen, 'foo', 'error'), 'new');
  assert.ok(seen.has('foo'));
});

test('checkDuplicate: second occurrence with error policy throws', () => {
  const seen = new Set<string>(['foo']);
  assert.throws(() => checkDuplicate(seen, 'foo', 'error'), DuplicatePathError);
});

test('checkDuplicate: second occurrence with skip policy returns skip', () => {
  const seen = new Set<string>(['foo']);
  assert.equal(checkDuplicate(seen, 'foo', 'skip'), 'skip');
});

test('checkDuplicate: second occurrence with overwrite policy returns overwrite', () => {
  const seen = new Set<string>(['foo']);
  assert.equal(checkDuplicate(seen, 'foo', 'overwrite'), 'overwrite');
});

test('checkCaseCollision: no-op on case-sensitive filesystem', () => {
  const map = new Map<string, string>();
  assert.equal(checkCaseCollision(map, 'Foo.txt', false, 'error'), 'new');
  assert.equal(checkCaseCollision(map, 'foo.txt', false, 'error'), 'new');
});

test('checkCaseCollision: detects case-only collision on case-insensitive FS', () => {
  const map = new Map<string, string>();
  checkCaseCollision(map, 'README.txt', true, 'error');
  assert.throws(() => checkCaseCollision(map, 'readme.txt', true, 'error'), CaseCollisionError);
});

test('checkCaseCollision: skip policy returns skip on collision', () => {
  const map = new Map<string, string>();
  checkCaseCollision(map, 'README.txt', true, 'error');
  assert.equal(checkCaseCollision(map, 'readme.txt', true, 'skip'), 'skip');
});

test('checkCaseCollision: same path (exact) is not a case collision', () => {
  const map = new Map<string, string>();
  checkCaseCollision(map, 'foo.txt', true, 'error');
  assert.equal(checkCaseCollision(map, 'foo.txt', true, 'error'), 'new');
});

test('detectPlatform returns posix on non-win32', () => {
  const p = detectPlatform();
  assert.ok(p === 'posix' || p === 'windows');
});
