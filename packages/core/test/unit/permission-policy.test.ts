// Permission sanitization tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeMode } from '../../src/policy/permission-policy.ts';

const UMASK_022 = 0o022;
const UMASK_077 = 0o077;
const UMASK_000 = 0o000;

test('sanitizeMode: strips setuid and preserves executable files', () => {
  // 0o4755 → strip 0o4000 → 0o755 → has exec bit → cap 0o755 → & ~0o022 → 0o755
  assert.equal(
    sanitizeMode(0o4755, 'file', { preservePermissions: false, umask: UMASK_022 }),
    0o755,
  );
});

test('sanitizeMode: SUID stripped under preservePermissions (file)', () => {
  // 0o4755 → strip 0o4000 → 0o755 → cap 0o777 → 0o755 → & ~0o022 → 0o755
  assert.equal(
    sanitizeMode(0o4755, 'file', { preservePermissions: true, umask: UMASK_022 }),
    0o755,
  );
});

test('sanitizeMode: strips setgid and preserves executable files', () => {
  // 0o2755 → strip 0o2000 → 0o755 → has exec → cap 0o755 (default) / 0o755 (preserve)
  assert.equal(
    sanitizeMode(0o2755, 'file', { preservePermissions: false, umask: UMASK_022 }),
    0o755,
  );
  assert.equal(
    sanitizeMode(0o2755, 'directory', { preservePermissions: false, umask: UMASK_022 }),
    0o755,
  );
  assert.equal(
    sanitizeMode(0o2755, 'file', { preservePermissions: true, umask: UMASK_022 }),
    0o755,
  );
});

test('sanitizeMode: sticky bit stripped', () => {
  // 0o1755 → strip 0o1000 → 0o755 → cap → 0o644 (file) / 0o755 (dir)
  assert.equal(
    sanitizeMode(0o1755, 'directory', { preservePermissions: false, umask: UMASK_022 }),
    0o755,
  );
  assert.equal(
    sanitizeMode(0o1777, 'directory', { preservePermissions: true, umask: UMASK_022 }),
    0o755,
  );
});

test('sanitizeMode: strips all special bits from executable files', () => {
  // 0o7755 → strip 0o7000 → 0o755 → has exec → cap 0o755
  assert.equal(
    sanitizeMode(0o7755, 'file', { preservePermissions: true, umask: UMASK_022 }),
    0o755,
  );
  assert.equal(
    sanitizeMode(0o7755, 'file', { preservePermissions: false, umask: UMASK_022 }),
    0o755,
  );
});

test('sanitizeMode: applies safe default file modes', () => {
  // 0o777 has exec bit → cap 0o755
  assert.equal(
    sanitizeMode(0o777, 'file', { preservePermissions: false, umask: UMASK_022 }),
    0o755,
  );
  assert.equal(
    sanitizeMode(0o777, 'file', { preservePermissions: false, umask: UMASK_000 }),
    0o755,
  );
  // 0o666 NO exec bit → cap 0o644
  assert.equal(
    sanitizeMode(0o666, 'file', { preservePermissions: false, umask: UMASK_022 }),
    0o644,
  );
  assert.equal(
    sanitizeMode(0o666, 'file', { preservePermissions: false, umask: UMASK_000 }),
    0o644,
  );
});

test('sanitizeMode: default cap dirs = 0o755', () => {
  assert.equal(
    sanitizeMode(0o777, 'directory', { preservePermissions: false, umask: UMASK_022 }),
    0o755,
  );
  assert.equal(
    sanitizeMode(0o777, 'directory', { preservePermissions: false, umask: UMASK_000 }),
    0o755,
  );
});

test('sanitizeMode: preservePermissions widens cap to 0o777 (minus 0o7000)', () => {
  assert.equal(sanitizeMode(0o777, 'file', { preservePermissions: true, umask: UMASK_022 }), 0o755);
  assert.equal(sanitizeMode(0o777, 'file', { preservePermissions: true, umask: UMASK_000 }), 0o777);
  assert.equal(
    sanitizeMode(0o777, 'directory', { preservePermissions: true, umask: UMASK_077 }),
    0o700,
  );
});

test('sanitizeMode: more-restrictive archive mode honored', () => {
  // 0o600 → cap 0o644 → min is 0o600 (cap is AND-ed) → & ~0o022 → 0o600
  assert.equal(
    sanitizeMode(0o600, 'file', { preservePermissions: false, umask: UMASK_022 }),
    0o600,
  );
  assert.equal(sanitizeMode(0o600, 'file', { preservePermissions: true, umask: UMASK_022 }), 0o600);
});

test('sanitizeMode: umask 0o077 applied', () => {
  // 0o777 preserve → 0o777 & ~0o077 = 0o700
  assert.equal(sanitizeMode(0o777, 'file', { preservePermissions: true, umask: UMASK_077 }), 0o700);
  // 0o644 default → 0o644 & ~0o077 = 0o600
  assert.equal(
    sanitizeMode(0o644, 'file', { preservePermissions: false, umask: UMASK_077 }),
    0o600,
  );
});

test('sanitizeMode: undefined archive mode uses safe defaults', () => {
  assert.equal(
    sanitizeMode(undefined, 'file', { preservePermissions: false, umask: UMASK_022 }),
    0o644,
  );
  assert.equal(
    sanitizeMode(undefined, 'directory', { preservePermissions: true, umask: 0 }),
    0o755,
  );
});

test('sanitizeMode: never returns bits above 0o777', () => {
  for (const m of [0o4755, 0o7755, 0o2755, 0o1755, 0o7777]) {
    for (const kind of ['file', 'directory'] as const) {
      for (const pp of [true, false]) {
        const result = sanitizeMode(m, kind, { preservePermissions: pp, umask: UMASK_022 });
        assert.equal(
          result & ~0o777,
          0,
          `mode ${m.toString(8)} kind ${kind} pp ${pp} result ${result.toString(8)}`,
        );
        assert.equal(result & 0o7000, 0, `SUID/SGID/sticky leaked: ${result.toString(8)}`);
      }
    }
  }
});
