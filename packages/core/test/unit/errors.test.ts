// Error hierarchy and serialization tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DecompressError,
  ErrorCode,
  PathPolicyError,
  PathTraversalError,
  AbsolutePathError,
  NulByteError,
  DuplicatePathError,
  CaseCollisionError,
  LinkEscapeError,
  SymlinkRefusedError,
  HardlinkRefusedError,
  PermissionPolicyError,
  LimitExceededError,
  ArchiveSizeExceededError,
  FileCountExceededError,
  TotalSizeExceededError,
  EntrySizeExceededError,
  DepthExceededError,
  CompressionRatioExceededError,
  OutputExistsError,
  AbortError,
  PluginError,
  LegacyPluginNotEnabledError,
  UserFunctionError,
  NotADirectoryError,
  isDecompressError,
} from '../../src/errors.ts';

test('DecompressError is the base class for all subclasses', () => {
  const errors = [
    new PathPolicyError('x'),
    new PathTraversalError('x'),
    new NulByteError('x'),
    new DuplicatePathError('x'),
    new CaseCollisionError('a', 'b'),
    new LinkEscapeError('p', 'symlink', 'l', '/etc'),
    new SymlinkRefusedError('x'),
    new HardlinkRefusedError('x'),
    new PermissionPolicyError('x'),
    new ArchiveSizeExceededError(1, 2),
    new OutputExistsError('x'),
    new AbortError(),
    new PluginError('x'),
    new LegacyPluginNotEnabledError('x'),
    new UserFunctionError('map', new Error('inner')),
    new NotADirectoryError('x'),
  ];
  for (const e of errors) {
    assert.ok(
      e instanceof DecompressError,
      `${e.constructor.name} not instanceof DecompressError`,
    );
    assert.equal(e.isDecompressError, true);
  }
});

test('each error has a stable code', () => {
  assert.equal(new PathPolicyError('x').code, ErrorCode.PathPolicy);
  assert.equal(new PathTraversalError('x').code, ErrorCode.PathTraversal);
  assert.equal(new NulByteError('x').code, ErrorCode.NulByte);
  assert.equal(new DuplicatePathError('x').code, ErrorCode.DuplicatePath);
  assert.equal(new CaseCollisionError('a', 'b').code, ErrorCode.CaseCollision);
  assert.equal(new LinkEscapeError('p', 'symlink', 'l', '/etc').code, ErrorCode.LinkEscape);
  assert.equal(new SymlinkRefusedError('x').code, ErrorCode.SymlinkRefused);
  assert.equal(new HardlinkRefusedError('x').code, ErrorCode.HardlinkRefused);
  assert.equal(new PermissionPolicyError('x').code, ErrorCode.PermissionPolicy);
  assert.equal(new ArchiveSizeExceededError(1, 2).code, ErrorCode.ArchiveSizeExceeded);
  assert.equal(new FileCountExceededError(1, 2).code, ErrorCode.FileCountExceeded);
  assert.equal(new TotalSizeExceededError(1, 2).code, ErrorCode.TotalSizeExceeded);
  assert.equal(new EntrySizeExceededError('p', 1, 2).code, ErrorCode.EntrySizeExceeded);
  assert.equal(new DepthExceededError('p', 1, 2).code, ErrorCode.DepthExceeded);
  assert.equal(new CompressionRatioExceededError(1, 2).code, ErrorCode.CompressionRatioExceeded);
  assert.equal(new OutputExistsError('x').code, ErrorCode.OutputExists);
  assert.equal(new AbortError().code, ErrorCode.Abort);
  assert.equal(new PluginError('x').code, ErrorCode.Plugin);
  assert.equal(new LegacyPluginNotEnabledError('x').code, ErrorCode.LegacyPluginNotEnabled);
  assert.equal(new UserFunctionError('filter', new Error('x')).code, ErrorCode.UserFunction);
});

test('name is set to constructor name', () => {
  assert.equal(new PathPolicyError('x').name, 'PathPolicyError');
  assert.equal(new AbortError().name, 'AbortError');
  assert.equal(new ArchiveSizeExceededError(1, 2).name, 'ArchiveSizeExceededError');
});

test('AbsolutePathError carries kind', () => {
  const e = new AbsolutePathError('/etc/passwd', 'posix');
  assert.equal(e.kind, 'posix');
  assert.equal(e.code, ErrorCode.AbsolutePath);
});

test('LinkEscapeError carries kind/linkname/resolved', () => {
  const e = new LinkEscapeError('entry', 'hardlink', '../secret', '/tmp/secret');
  assert.equal(e.kind, 'hardlink');
  assert.equal(e.linkname, '../secret');
  assert.equal(e.resolved, '/tmp/secret');
});

test('LimitExceededError carries limit/value/threshold', () => {
  const e = new ArchiveSizeExceededError(100, 50);
  assert.equal(e.limit, 'maxArchiveSize');
  assert.equal(e.value, 100);
  assert.equal(e.threshold, 50);
  assert.ok(e instanceof LimitExceededError);
});

test('errors carry entryPath and cause', () => {
  const inner = new Error('inner');
  const e = new PathPolicyError('bad', { entryPath: '../evil', cause: inner });
  assert.equal(e.entryPath, '../evil');
  assert.equal(e.cause, inner);
});

test('UserFunctionError carries fn', () => {
  const e = new UserFunctionError('map', new Error('boom'));
  assert.equal(e.fn, 'map');
});

test('toJSON serializes structured fields', () => {
  const e = new PathPolicyError('bad', { entryPath: 'p', details: { reason: 'x' } });
  const json = e.toJSON() as Record<string, unknown>;
  assert.equal(json.name, 'PathPolicyError');
  assert.equal(json.code, ErrorCode.PathPolicy);
  assert.equal(json.entryPath, 'p');
});

test('isDecompressError predicate', () => {
  assert.equal(isDecompressError(new PathPolicyError('x')), true);
  assert.equal(isDecompressError(new Error('plain')), false);
  assert.equal(isDecompressError(null), false);
  assert.equal(isDecompressError(undefined), false);
});

test('subclass instanceof chain', () => {
  const e = new ArchiveSizeExceededError(1, 2);
  assert.ok(e instanceof ArchiveSizeExceededError);
  assert.ok(e instanceof LimitExceededError);
  assert.ok(e instanceof DecompressError);
  assert.ok(e instanceof Error);
});
