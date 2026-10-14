// 1.0.5 security and correctness regressions.
// Each case here guards behavior that was broken, unsafe, or unverified in a
// prior release. A failure in this file means a regression, not a new feature.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import nodePath from 'node:path';
import { createZstdCompress } from 'node:zlib';
import { setTimeout as sleep } from 'node:timers/promises';
import { extract } from '../../src/index.ts';
import { checkCaseCollision } from '../../src/writer/path-security.ts';
import { buildTarBuffer, gzipBuffer } from '../helpers/archive-builders.ts';

const target = await mkdtemp(nodePath.join(tmpdir(), 'reg-105-'));

/** Make the tree deletable: archive-declared non-writable modes are honored. */
async function unlockTree(root: string): Promise<void> {
  const { chmod, stat, readdir } = await import('node:fs/promises');
  const stack = [root];
  while (stack.length) {
    const cur = stack.pop()!;
    try {
      await chmod(cur, 0o700);
      if ((await stat(cur)).isDirectory()) {
        for (const c of await readdir(cur)) stack.push(nodePath.join(cur, c));
      }
    } catch {
      // already gone; rm(force) handles the rest
    }
  }
}

test.after(async () => {
  await unlockTree(target);
  await rm(target, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Truncation deadlock (1.0.4): a gzip/zstd stream cut mid-entry-body left the
// tar pipeline idle. Piped error events are not forwarded, the pending entry
// body never ended, and extract() parked on bodyDone forever with no active
// handles - the process exited with an unsettled top-level await. The promise
// MUST settle with a typed error, and it must do so promptly.
// ---------------------------------------------------------------------------

const PAYLOAD = Buffer.alloc(256 * 1024, 7);

async function settleWithin(
  promise: Promise<unknown>,
  ms: number,
): Promise<{ settled: true; error?: unknown } | { settled: false }> {
  let outcome: { settled: true; error?: unknown } | { settled: false } | undefined;
  const raced = Promise.race([
    promise.then(
      () => (outcome = { settled: true }),
      (error) => (outcome = { settled: true, error }),
    ),
    sleep(ms).then(() => (outcome ??= { settled: false })),
  ]);
  await raced;
  return outcome ?? { settled: false };
}

for (const cut of [0.3, 0.5, 0.7, 0.9]) {
  test(`1.0.5: tar.gz truncated at ${Math.round(cut * 100)}% settles with a typed error`, async () => {
    const whole = await gzipBuffer(await buildTarBuffer([{ name: 'blob.bin', content: PAYLOAD }]));
    const truncated = whole.subarray(0, Math.floor(whole.length * cut));
    const out = nodePath.join(target, `gz-${cut}`);
    const outcome = await settleWithin(extract(truncated, out), 10_000);
    assert.equal(outcome.settled, true, 'extract() promise must settle');
    if (outcome.settled && outcome.error) {
      assert.match(
        (outcome.error as Error).name,
        /TruncatedArchiveError|CorruptArchiveError|CompressionRatioExceededError/,
        `expected a typed decompress error, got ${String(outcome.error)}`,
      );
    }
  });

  test(`1.0.5: tar.zst truncated at ${Math.round(cut * 100)}% settles with a typed error`, async () => {
    const whole = await zstdBuffer(await buildTarBuffer([{ name: 'blob.bin', content: PAYLOAD }]));
    const truncated = whole.subarray(0, Math.floor(whole.length * cut));
    const out = nodePath.join(target, `zst-${cut}`);
    const outcome = await settleWithin(extract(truncated, out), 10_000);
    assert.equal(outcome.settled, true, 'extract() promise must settle');
    if (outcome.settled && outcome.error) {
      assert.match(
        (outcome.error as Error).name,
        /TruncatedArchiveError|CorruptArchiveError|CompressionRatioExceededError/,
        `expected a typed decompress error, got ${String(outcome.error)}`,
      );
    }
  });
}

test('1.0.5: plain tar truncated inside an entry body stays typed', async () => {
  const whole = await buildTarBuffer([{ name: 'blob.bin', content: PAYLOAD }]);
  const truncated = whole.subarray(0, Math.floor(whole.length * 0.5));
  const out = nodePath.join(target, 'plain');
  const outcome = await settleWithin(extract(truncated, out), 10_000);
  assert.equal(outcome.settled, true);
  if (outcome.settled && outcome.error) {
    assert.equal((outcome.error as Error).name, 'TruncatedArchiveError');
  }
});

// ---------------------------------------------------------------------------
// futimes behavior (1.0.5): file mtimes land while the handle is open.
// Extraction-visible contract is unchanged: mtime matches the archive header.
// ---------------------------------------------------------------------------

test('1.0.5: file mtime preserved after extraction (futimes path)', async () => {
  const mtime = new Date('2026-06-15T12:00:00.000Z');
  const archive = await buildTarBuffer([{ name: 'timed.txt', content: 'x', mtime }]);
  const out = nodePath.join(target, 'mtime');
  await extract(archive, out);
  const { stat } = await import('node:fs/promises');
  const st = await stat(nodePath.join(out, 'timed.txt'));
  assert.equal(st.mtime.toISOString(), mtime.toISOString());
});

test('1.0.5: directory mtime still applied deepest-first after children', async () => {
  const mtime = new Date('2026-06-15T12:00:00.000Z');
  const archive = await buildTarBuffer([
    { name: 'd', type: 'directory', mode: 0o755, mtime },
    { name: 'd/child.txt', content: 'x', mtime },
  ]);
  const out = nodePath.join(target, 'dirmtime');
  await extract(archive, out);
  const { stat } = await import('node:fs/promises');
  const st = await stat(nodePath.join(out, 'd'));
  assert.equal(st.mtime.toISOString(), mtime.toISOString());
});

// ---------------------------------------------------------------------------
// ASCII case-fold fast path (1.0.5): duplicate detection must behave
// identically for ASCII (toLowerCase fast path) and non-ASCII (ICU fold).
// ---------------------------------------------------------------------------

test('1.0.5: ASCII case folding fast path matches ICU folding exactly', () => {
  // The fast path must agree with the ICU fold for every ASCII path, and the
  // non-ASCII path must still go through toLocaleLowerCase('en-US').
  const cases = ['READme.txt', 'MiXeD/Case/FILE.bin', 'a~b!c#d.txt'];
  for (const path of cases) {
    const a = new Map<string, string>();
    const b = new Map<string, string>();
    const first = checkCaseCollision(a, path, true, 'error');
    const second = checkCaseCollision(b, path, true, 'error');
    assert.equal(first, 'new');
    assert.equal(second, 'new');
    assert.equal([...a.keys()][0], [...b.keys()][0]);
    // both folds must be the plain lowercase form for ASCII
    assert.equal([...a.keys()][0], path.toLowerCase());
  }
});

test(
  '1.0.5: non-ASCII case-collision integration (case-insensitive platforms only)',
  {
    skip:
      process.platform !== 'darwin' && process.platform !== 'win32'
        ? 'case-sensitive filesystem'
        : false,
  },
  async () => {
    const archive = await buildTarBuffer([
      { name: 'Ärger.txt', content: 'a' },
      { name: 'ärger.txt', content: 'b' },
    ]);
    const out = nodePath.join(target, 'case-unicode');
    await assert.rejects(extract(archive, out), (e: unknown) => {
      assert.equal((e as Error).name, 'CaseCollisionError');
      return true;
    });
  },
);

async function zstdBuffer(buf: Buffer): Promise<Buffer> {
  const { pipeline } = await import('node:stream/promises');
  const chunks: Buffer[] = [];
  await pipeline([buf], createZstdCompress(), async (src: AsyncIterable<Buffer | Uint8Array>) => {
    for await (const c of src) chunks.push(Buffer.from(c));
  });
  return Buffer.concat(chunks);
}
