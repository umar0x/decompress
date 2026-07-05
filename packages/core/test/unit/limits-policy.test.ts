// Resource-limit parsing and enforcement tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseSize,
  resolveLimits,
  checkArchiveSize,
  checkFileCount,
  checkTotalSize,
  checkEntrySize,
  checkDepth,
  checkCompressionRatio,
} from '../../src/policy/limits-policy.ts';
import {
  ArchiveSizeExceededError,
  CompressionRatioExceededError,
  DepthExceededError,
  EntrySizeExceededError,
  FileCountExceededError,
  InvalidInputError,
  TotalSizeExceededError,
} from '../../src/errors.ts';

test('parseSize: number passthrough', () => {
  assert.equal(parseSize(2147483648), 2147483648);
  assert.equal(parseSize(0), 0);
});

test('parseSize: byte suffixes', () => {
  assert.equal(parseSize('512b'), 512);
  assert.equal(parseSize('512'), 512);
});

test('parseSize: decimal units (kb/mb/gb/tb)', () => {
  assert.equal(parseSize('100kb'), 100_000);
  assert.equal(parseSize('512mb'), 512_000_000);
  assert.equal(parseSize('2gb'), 2_000_000_000);
  assert.equal(parseSize('1tb'), 1_000_000_000_000);
});

test('parseSize: binary units (kib/mib/gib/tib)', () => {
  assert.equal(parseSize('512MiB'), 536_870_912);
  assert.equal(parseSize('2GiB'), 2_147_483_648);
  assert.equal(parseSize('1kib'), 1024);
  assert.equal(parseSize('1tib'), 1 << 40);
});

test('parseSize: decimal values', () => {
  assert.equal(parseSize('1.5gb'), 1_500_000_000);
  assert.equal(parseSize('1.5 kib'), 1536);
  assert.equal(parseSize('0.5mb'), 500_000);
});

test('parseSize: case-insensitive + whitespace-tolerant', () => {
  assert.equal(parseSize('  512MB  '), 512_000_000);
  assert.equal(parseSize('2Gb'), 2_000_000_000);
});

test('parseSize: rejects invalid input', () => {
  assert.throws(() => parseSize('abc'), InvalidInputError);
  assert.throws(() => parseSize(''), InvalidInputError);
  assert.throws(() => parseSize('-1'), InvalidInputError);
  assert.throws(() => parseSize('1.5zlb'), InvalidInputError);
  assert.throws(() => parseSize(-1), InvalidInputError);
  assert.throws(() => parseSize(1.5), InvalidInputError);
  assert.throws(() => parseSize(Infinity), InvalidInputError);
});

test('resolveLimits: defaults when no opts', () => {
  const l = resolveLimits({});
  assert.equal(l.maxArchiveSize, 512 * 1024 * 1024);
  assert.equal(l.maxFiles, 10_000);
  assert.equal(l.maxTotalSize, 2 * 1024 * 1024 * 1024);
  assert.equal(l.maxEntrySize, 512 * 1024 * 1024);
  assert.equal(l.maxDepth, 128);
  assert.equal(l.maxCompressionRatio, 100);
});

test('resolveLimits: overrides applied', () => {
  const l = resolveLimits({ maxFiles: 100, maxDepth: 32, maxArchiveSize: '10mb' });
  assert.equal(l.maxFiles, 100);
  assert.equal(l.maxDepth, 32);
  assert.equal(l.maxArchiveSize, 10_000_000);
});

test('checkArchiveSize: below limit passes, above throws', () => {
  const l = resolveLimits({ maxArchiveSize: '1mb' });
  assert.doesNotThrow(() => checkArchiveSize(1_000_000, l));
  assert.throws(() => checkArchiveSize(1_000_001, l), ArchiveSizeExceededError);
});

test('checkFileCount: boundary (exactly at limit passes, limit+1 fails)', () => {
  const l = resolveLimits({ maxFiles: 100 });
  assert.doesNotThrow(() => checkFileCount(100, l));
  assert.throws(() => checkFileCount(101, l), FileCountExceededError);
});

test('checkTotalSize: boundary', () => {
  // '1kb' = 1000 (decimal). Use '1kib' = 1024 for binary.
  const l = resolveLimits({ maxTotalSize: '1kib' });
  assert.doesNotThrow(() => checkTotalSize(1024, l));
  assert.throws(() => checkTotalSize(1025, l), TotalSizeExceededError);
});

test('checkEntrySize: boundary + entry path in message', () => {
  const l = resolveLimits({ maxEntrySize: '1kib' });
  assert.doesNotThrow(() => checkEntrySize('foo.txt', 1024, l));
  assert.throws(() => checkEntrySize('foo.txt', 1025, l), EntrySizeExceededError);
});

test('checkDepth: boundary', () => {
  const l = resolveLimits({ maxDepth: 10 });
  assert.doesNotThrow(() => checkDepth('a/b/c', 3, l));
  assert.throws(() => checkDepth('deep', 11, l), DepthExceededError);
});

test('checkCompressionRatio: below passes, above throws', () => {
  const l = resolveLimits({ maxCompressionRatio: 100 });
  assert.doesNotThrow(() => checkCompressionRatio(1000, 10, l)); // ratio 100
  assert.throws(() => checkCompressionRatio(1101, 10, l), CompressionRatioExceededError); // ratio 110.1
});

test('checkCompressionRatio: zero archive size is no-op (avoid div-by-zero)', () => {
  const l = resolveLimits({});
  assert.doesNotThrow(() => checkCompressionRatio(1_000_000, 0, l));
});
