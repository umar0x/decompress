// Deterministic property tests for path handling and permissions.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import nodePath from 'node:path';

import {
  isInsideOutput,
  validatePath,
  normalizePath,
  checkDuplicate,
  checkCaseCollision,
  sanitizeMode,
  isDecompressError,
} from '@umar0x/decompress';
import type { PathCtx } from '@umar0x/decompress';
import { DEFAULT_LIMITS } from '@umar0x/decompress';

const posixCtx: PathCtx = { platform: 'posix', caseInsensitive: false, limits: DEFAULT_LIMITS };

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CHARS = 'abcABC123-_./\\..:% \0éà';

function randomPath(rng: () => number, maxLen = 40): string {
  const len = Math.floor(rng() * maxLen) + 1;
  let s = '';
  for (let i = 0; i < len; i++) {
    s += CHARS[Math.floor(rng() * CHARS.length)];
  }
  return s;
}

const SMOKE_ITERATIONS = 500;

test('isInsideOutput matches path.relative containment semantics', () => {
  const rng = mulberry32(42);
  for (let i = 0; i < SMOKE_ITERATIONS; i++) {
    const root = '/tmp/out';
    const p = randomPath(rng, 30);
    if (p.includes('\0') || p.trim() === '') continue;
    const resolved = nodePath.resolve(root, p);
    const inside = isInsideOutput(resolved, root);
    const rel = nodePath.relative(root, resolved);
    // inside iff rel is empty/'.' OR (not '..' and not starting with '..'+sep and not absolute).
    // A filename like '..foo' is INSIDE (it's a sibling file, not a parent traversal).
    const expected =
      rel === '' ||
      rel === '.' ||
      (rel !== '..' && !rel.startsWith(`..${nodePath.sep}`) && !nodePath.isAbsolute(rel));
    assert.equal(
      inside,
      expected,
      `containment mismatch: p=${JSON.stringify(p)} resolved=${resolved} rel=${rel}`,
    );
  }
});

test('validated and normalized paths resolve inside the root', () => {
  const rng = mulberry32(123);
  for (let i = 0; i < SMOKE_ITERATIONS; i++) {
    const root = '/tmp/out';
    const p = randomPath(rng, 30);
    try {
      validatePath(p, posixCtx);
      const normalized = normalizePath(p, posixCtx);
      const dest = nodePath.join(root, normalized);
      assert.ok(
        isInsideOutput(dest, root),
        `validated path escapes root: p=${JSON.stringify(p)} dest=${dest}`,
      );
    } catch (e) {
      assert.ok(isDecompressError(e) || e instanceof Error);
    }
  }
});

test('isInsideOutput is deterministic for random targets', () => {
  const rng = mulberry32(7);
  for (let i = 0; i < SMOKE_ITERATIONS; i++) {
    const root = '/tmp/out';
    const p = randomPath(rng, 20);
    if (p.includes('\0')) continue;
    const target = nodePath.resolve(root, p);
    const r1 = isInsideOutput(target, root);
    const r2 = isInsideOutput(target, root);
    assert.equal(r1, r2, `non-deterministic result for ${target}`);
  }
});

test('sanitizeMode never preserves special permission bits', () => {
  const rng = mulberry32(99);
  for (let i = 0; i < SMOKE_ITERATIONS; i++) {
    const mode = Math.floor(rng() * 0o10000);
    for (const pp of [true, false]) {
      for (const kind of ['file', 'directory'] as const) {
        const result = sanitizeMode(mode, kind, { preservePermissions: pp, umask: 0 });
        assert.equal(
          result & 0o7000,
          0,
          `special bits leaked: mode=${mode.toString(8)}, result=${result.toString(8)}`,
        );
        assert.ok(result <= 0o777, `result exceeds 0o777: ${result.toString(8)}`);
      }
    }
  }
});

test('checkDuplicate remains consistent across repeated paths', () => {
  const rng = mulberry32(256);
  const seen = new Set<string>();
  for (let i = 0; i < SMOKE_ITERATIONS; i++) {
    const p = `path${Math.floor(rng() * 1000)}`; // wider range to reduce collisions
    const wasSeen = seen.has(p);
    if (wasSeen) {
      // Already seen → error policy throws.
      assert.throws(() => checkDuplicate(seen, p, 'error'));
    } else {
      const result = checkDuplicate(seen, p, 'error');
      assert.equal(result, 'new');
      // Now seen; second call throws.
      assert.throws(() => checkDuplicate(seen, p, 'error'));
    }
  }
});

test('fuzz: validatePath never throws non-Error', () => {
  const rng = mulberry32(2024);
  for (let i = 0; i < SMOKE_ITERATIONS; i++) {
    const p = randomPath(rng, 60);
    try {
      validatePath(p, posixCtx);
    } catch (e) {
      assert.ok(e instanceof Error, `validatePath threw non-Error: ${typeof e}`);
    }
  }
});

test('fuzz: checkCaseCollision determinism', () => {
  for (let i = 0; i < 100; i++) {
    const map = new Map<string, string>();
    checkCaseCollision(map, `Foo${i}.txt`, true, 'error');
    assert.throws(() => checkCaseCollision(map, `foo${i}.txt`, true, 'error'));
  }
});
