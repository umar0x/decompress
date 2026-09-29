// 1.0.4 regression tests. Each test pins a defect found and fixed in this
// release; every one of them fails (hangs or misclassifies) on 1.0.3.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, readFile, chmod, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import nodePath from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { gzipSync } from 'node:zlib';

import { extract } from '../../src/index.ts';
import { EntrySizeExceededError, TruncatedArchiveError } from '../../src/errors.ts';
import { atomicExtract } from '../../src/writer/atomic-extractor.ts';
import type { ArchivePlugin, ArchiveEntry } from '../../src/types.ts';
import { DEFAULT_LIMITS } from '../../src/types.ts';

const requireCore = createRequire(import.meta.url);
const tar = requireCore('tar-stream');

async function tmpOutput(): Promise<string> {
  return mkdtemp(nodePath.join(tmpdir(), 'decompress-104-regression-'));
}

/**
 * Extraction can legitimately leave non-writable directories behind (an
 * archive-declared 0444/0000 mode is applied verbatim after content lands,
 * the same contract GNU tar gives). Make the tree deletable before rm.
 */
async function unlockTree(root: string): Promise<void> {
  const stack = [root];
  while (stack.length) {
    const cur = stack.pop()!;
    try {
      await chmod(cur, 0o700);
      const st = await stat(cur);
      if (st.isDirectory()) for (const c of await readdir(cur)) stack.push(nodePath.join(cur, c));
    } catch {
      // Already gone or not ours; rm(force) handles the rest.
    }
  }
}

async function buildTar(
  entries: Array<{ name: string; type?: string; mode?: number; content?: Buffer }>,
): Promise<Buffer> {
  const pack = tar.pack();
  const drain = (async () => {
    const chunks: Buffer[] = [];
    for await (const c of pack) chunks.push(c);
    return Buffer.concat(chunks);
  })();
  for (const e of entries) {
    const content = e.content ?? Buffer.alloc(0);
    await new Promise<void>((resolve, reject) => {
      pack.entry(
        {
          name: e.name,
          type: (e.type ?? 'file') as 'file' | 'directory',
          mode: e.mode ?? 0o644,
          mtime: new Date('2026-01-01T00:00:00Z'),
          size: (e.type ?? 'file') === 'directory' ? 0 : content.length,
        },
        (e.type ?? 'file') === 'directory' ? undefined : content,
        (error: Error | null | undefined) => (error ? reject(error) : resolve()),
      );
    });
  }
  pack.finalize();
  return drain;
}

// ---------------------------------------------------------------------------
// Fix 1: deferred directory modes (was: EACCES / hang on non-executable dir
// entries; unusable output when a childless dir carried such a mode).
// ---------------------------------------------------------------------------

test('1.0.4: directory entries with non-executable declared modes extract and keep children usable', async () => {
  const out = await tmpOutput();
  const target = nodePath.join(out, 'result');
  try {
    // nested/a is declared 0755 so the deepest dir's mode stays assertable
    // through a traversable ancestor chain; every other dir is declared with
    // a mode that has no execute bit at all.
    const archive = await buildTar([
      { name: 'd0644/', type: 'directory', mode: 0o0644 },
      { name: 'd0644/child.txt', content: Buffer.from('under 0644 dir') },
      // 0000-declared directories cannot travel through tar-stream's packer
      // (it normalizes a falsy mode to 0755); that case is covered by the
      // hand-built header test below this one.
      { name: 'd0444/', type: 'directory', mode: 0o0444 },
      { name: 'd0444/child.txt', content: Buffer.from('under 0444 dir') },
      { name: 'nested/a/', type: 'directory', mode: 0o0755 },
      { name: 'nested/a/b/', type: 'directory', mode: 0o0400 },
      { name: 'nested/a/b/deep.txt', content: Buffer.from('deep') },
      { name: 'tail/', type: 'directory', mode: 0o0000 },
    ]);
    const result = await extract(archive, target, {});
    assert.equal(result.entries.length, 8);
    assert.equal(
      result.totalBytes,
      'under 0644 dir'.length + 'under 0444 dir'.length + 'deep'.length,
    );

    // Final directory modes are the sanitized declaration (capped at 0755,
    // umask applied), applied after content lands like GNU tar does. Assert
    // these before unlocking, while the tree is exactly as extracted.
    const umask = process.umask();
    const expect = (declared: number) => declared & 0o755 & ~umask;
    assert.equal((await stat(nodePath.join(target, 'd0644'))).mode & 0o7777, expect(0o0644));
    assert.equal((await stat(nodePath.join(target, 'd0444'))).mode & 0o7777, expect(0o0444));
    assert.equal((await stat(nodePath.join(target, 'nested/a'))).mode & 0o7777, expect(0o0755));
    assert.equal((await stat(nodePath.join(target, 'nested/a/b'))).mode & 0o7777, expect(0o0400));
    // tail declared 0000 but tar-stream's packer normalizes a falsy mode to
    // 0755, so the archive on disk actually declares 0755 for it. Assert what
    // the bytes say; the genuine 0000 case is the hand-built test below.
    assert.equal((await stat(nodePath.join(target, 'tail'))).mode & 0o7777, expect(0o0755));

    // Children were written through directories that were non-traversable at
    // declaration time. Verify content after unlocking the tree for cleanup.
    await unlockTree(target);
    assert.equal(
      await readFile(nodePath.join(target, 'd0644/child.txt'), 'utf8'),
      'under 0644 dir',
    );
    assert.equal(
      await readFile(nodePath.join(target, 'd0444/child.txt'), 'utf8'),
      'under 0444 dir',
    );
    assert.equal(await readFile(nodePath.join(target, 'nested/a/b/deep.txt'), 'utf8'), 'deep');
  } finally {
    await unlockTree(target).catch(() => {});
    await unlockTree(nodePath.dirname(target)).catch(() => {});
    await rm(out, { recursive: true, force: true });
  }
});

/** Build a TAR with hand-computed headers so fields tar-stream would
 * normalize (mode 0000) reach the library verbatim. */
function handTar(
  entries: Array<{ name: string; type: 'directory' | 'file'; mode: number; content?: Buffer }>,
): Buffer {
  const chunks: Buffer[] = [];
  for (const e of entries) {
    const content = e.content ?? Buffer.alloc(0);
    const header = Buffer.alloc(512);
    header.write(e.name, 0, 99, 'ascii');
    header.write(e.mode.toString(8).padStart(7, '0') + '\0', 100, 'ascii');
    header.write('0000000\0', 108, 'ascii'); // uid
    header.write('0000000\0', 116, 'ascii'); // gid
    header.write(content.length.toString(8).padStart(11, '0') + ' ', 124, 'ascii');
    header.write('13501340520\0', 136, 'ascii'); // mtime 2026-01-01
    header.fill(0x20, 148, 156); // checksum placeholder
    header[156] = e.type === 'directory' ? 0x35 : 0x30; // typeflag '5' dir, '0' file
    header.write('ustar\0', 257, 'ascii');
    header.write('00', 263, 'ascii');
    let checksum = 0;
    for (const b of header) checksum += b;
    header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii');
    chunks.push(header);
    if (content.length) {
      chunks.push(content);
      chunks.push(
        Buffer.alloc(512 - (content.length % 512) === 512 ? 0 : 512 - (content.length % 512)),
      );
    }
  }
  chunks.push(Buffer.alloc(1024)); // two zero blocks
  return Buffer.concat(chunks);
}

test('1.0.4: a hand-built tar declaring mode 0000 directories extracts them and applies 0000 last', async () => {
  const out = await tmpOutput();
  const target = nodePath.join(out, 'result');
  try {
    const archive = handTar([
      { name: 'locked/', type: 'directory', mode: 0o0000 },
      {
        name: 'locked/inside.txt',
        type: 'file',
        mode: 0o0644,
        content: Buffer.from('inside a 0000 dir'),
      },
    ]);
    const result = await extract(archive, target, {});
    assert.equal(result.entries.length, 2);
    assert.equal(result.totalBytes, 'inside a 0000 dir'.length);
    // Declared 0000, umask cannot add bits: final mode is 0000.
    const umask = process.umask();
    assert.equal((await stat(nodePath.join(target, 'locked'))).mode & 0o7777, 0o0000 & ~umask);
    await unlockTree(target);
    assert.equal(
      await readFile(nodePath.join(target, 'locked/inside.txt'), 'utf8'),
      'inside a 0000 dir',
    );
  } finally {
    await unlockTree(target).catch(() => {});
    await unlockTree(nodePath.dirname(target)).catch(() => {});
    await rm(out, { recursive: true, force: true });
  }
});

test('1.0.4: deep nesting over non-executable directories terminates (1.0.3 hung indefinitely)', async () => {
  const out = await tmpOutput();
  const target = nodePath.join(out, 'result');
  try {
    const entries: Array<{ name: string; type?: string; content?: Buffer }> = [];
    for (let depth = 0; depth < 60; depth++) {
      const prefix = Array.from({ length: depth + 1 }, (_, k) => `d${k}`).join('/');
      entries.push({ name: `${prefix}/`, type: 'directory' }); // packer default mode 0644: non-executable
      for (let f = 0; f < 3; f++)
        entries.push({ name: `${prefix}/f${f}.txt`, content: Buffer.alloc(16) });
    }
    const archive = gzipSync(await buildTar(entries));
    const result = await extract(archive, target, {});
    assert.equal(result.entries.length, 240);
    assert.equal(result.totalBytes, 180 * 16);
    // 1.0.3 never reached this line. The declared 0644 tree is faithful to the
    // archive, so unlock before touching the leaf.
    await unlockTree(target);
    const leaf = nodePath.join(target, ...Array.from({ length: 60 }, (_, k) => `d${k}`), 'f0.txt');
    assert.equal((await stat(leaf)).size, 16);
  } finally {
    await unlockTree(target).catch(() => {});
    await unlockTree(nodePath.dirname(target)).catch(() => {});
    await rm(out, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Fix 2: worker pool unwinds when a claimed body is abandoned by a failed
// write (was: permanent deadlock, extract() never settled, staging leaked).
// ---------------------------------------------------------------------------

test('1.0.4: a write that fails mid-body rejects typed instead of deadlocking the pool', async () => {
  const out = await tmpOutput();
  const target = nodePath.join(out, 'result');
  try {
    // Three file entries; the first streams more bytes than maxEntrySize, so
    // the writer fails it after claiming (the exact 1.0.3 deadlock trigger:
    // rolling limits throw mid-drain while sibling workers are mid-pull).
    let consumedFirst = false;
    const plugin: ArchivePlugin = {
      name: 'fail-mid-body',
      formats: ['fail-mid-body'],
      parse: async function* (): AsyncIterable<ArchiveEntry> {
        for (let i = 1; i <= 3; i++) {
          yield {
            path: `file${i}.txt`,
            type: 'file',
            size: i === 1 ? 64 * 1024 : 4,
            mode: 0o644,
            sourceFormat: 'fail-mid-body',
            stream: () =>
              Readable.from(
                (async function* () {
                  if (i === 1 && !consumedFirst) {
                    consumedFirst = true;
                    for (let n = 0; n < 32; n++) yield Buffer.alloc(4096, 7); // 128 KiB > maxEntrySize
                  } else {
                    yield Buffer.alloc(4, 1);
                  }
                })(),
              ),
          };
        }
      },
    };

    const rejection = extract(Buffer.concat([Buffer.from('PK'), Buffer.alloc(2)]), target, {
      plugins: [plugin],
      maxEntrySize: 8 * 1024,
      concurrency: 8,
    });

    // Regression guard: on 1.0.3 this promise never settled. Race it against
    // a watchdog so the test fails loudly instead of hanging the runner.
    let watchdogTimer: ReturnType<typeof setTimeout> | undefined;
    const watchdog = new Promise<never>((_, reject) => {
      watchdogTimer = setTimeout(
        () => reject(new Error('regression: extraction did not settle in 5s (pool deadlock)')),
        5000,
      );
    });
    const settled = await Promise.race([
      rejection.then(
        () => assert.fail('expected rejection'),
        (e: unknown) => e,
      ),
      watchdog,
    ]);
    clearTimeout(watchdogTimer);
    const error = settled as Error;

    assert.ok(
      error instanceof EntrySizeExceededError,
      `expected EntrySizeExceededError, got ${String(error)}`,
    );
    // Output stays absent: no partial tree, no leaked staging sibling.
    await assert.rejects(stat(target), /ENOENT/);
    const siblings = await import('node:fs/promises').then((fs) =>
      fs.readdir(nodePath.dirname(target)),
    );
    assert.equal(siblings.filter((name) => name.startsWith('.decompress-tmp-')).length, 0);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('1.0.4: atomicExtract settles when a body errors on its own mid-read', async () => {
  const entries: ArchiveEntry[] = [
    {
      path: 'a.txt',
      type: 'file',
      size: 16,
      mode: 0o644,
      sourceFormat: 'test',
      stream: () =>
        Readable.from(
          (async function* () {
            yield Buffer.alloc(8, 1);
            throw new Error('Unexpected end of data');
          })(),
        ),
    },
  ];
  const out = await tmpOutput();
  try {
    const result = await atomicExtract(entries, {
      output: nodePath.join(out, 'result'),
      limits: DEFAULT_LIMITS,
      policy: {
        allowSymlinks: false,
        allowHardlinks: false,
        preservePermissions: false,
        overwrite: false,
        symlinkFallback: 'error',
      },
      archiveSize: 32,
      concurrency: 4,
    });
    void result;
    assert.fail('expected rejection');
  } catch (e) {
    // The raw body error is normalized to the typed contract.
    assert.ok(
      e instanceof TruncatedArchiveError,
      `expected TruncatedArchiveError, got ${String(e)}`,
    );
    assert.equal((e as TruncatedArchiveError).code, 'TRUNCATED_ARCHIVE');
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Fix 3: truncation errors are typed instead of leaking raw parser errors.
// ---------------------------------------------------------------------------

test('1.0.4: a tar truncated inside an entry body rejects as TRUNCATED_ARCHIVE', async () => {
  const out = await tmpOutput();
  const target = nodePath.join(out, 'result');
  try {
    const whole = await buildTar([
      { name: 'first.txt', content: Buffer.alloc(2048, 3) },
      { name: 'second.txt', content: Buffer.alloc(512, 4) },
    ]);
    const truncated = whole.subarray(0, Math.floor(whole.length * 0.6));
    await assert.rejects(extract(truncated, target, {}), (e: unknown) => {
      assert.ok(
        e instanceof TruncatedArchiveError,
        `expected TruncatedArchiveError, got ${String(e)}`,
      );
      assert.equal((e as TruncatedArchiveError).code, 'TRUNCATED_ARCHIVE');
      return true;
    });
    await assert.rejects(stat(target), /ENOENT/);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('1.0.4: a tar.gz truncated inside an entry body rejects typed (not raw Z_BUF_ERROR)', async () => {
  const out = await tmpOutput();
  const target = nodePath.join(out, 'result');
  try {
    const whole = gzipSync(
      await buildTar([
        { name: 'first.txt', content: Buffer.alloc(4096, 5) },
        { name: 'second.txt', content: Buffer.alloc(1024, 6) },
      ]),
    );
    const truncated = whole.subarray(0, Math.floor(whole.length * 0.55));
    await assert.rejects(extract(truncated, target, {}), (e: unknown) => {
      assert.ok(
        e instanceof TruncatedArchiveError ||
          (e as { code?: string })?.code === 'TRUNCATED_ARCHIVE',
        `expected typed truncation, got ${String(e)}`,
      );
      return true;
    });
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Unit coverage for the two writer helpers introduced in 1.0.4.
// ---------------------------------------------------------------------------

test('1.0.4 unit: destroyClaimedBody is a no-op for buffers, arrays, and ended streams', async () => {
  const { destroyClaimedBody } = await import('../../src/writer/secure-writer.ts');
  // Array contents (buffer-backed entries): nothing to destroy.
  destroyClaimedBody([Buffer.from('x')], new Error('e'));
  destroyClaimedBody(undefined, new Error('e'));
  destroyClaimedBody(null, new Error('e'));
  // A stream that already ended must not be re-destroyed with the error.
  const { Readable: R } = await import('node:stream');
  const ended = R.from([Buffer.alloc(4)]);
  for await (const _ of ended) void _;
  let errored = false;
  ended.on('error', () => {
    errored = true;
  });
  destroyClaimedBody(ended, new Error('late'));
  // Node auto-destroys fully consumed streams (destroyed === true); what
  // matters is that no late error event was injected after the end.
  assert.equal(ended.readableEnded, true);
  assert.equal(errored, false);
  // A destroyed stream stays as-is.
  const gone = R.from([Buffer.alloc(4)]);
  gone.destroy();
  destroyClaimedBody(gone, new Error('again'));
  assert.equal(gone.destroyed, true);
});

test('1.0.4 unit: destroyClaimedBody injects the error and flags it', async () => {
  const { Readable: R } = await import('node:stream');
  const { destroyClaimedBody } = await import('../../src/writer/secure-writer.ts');
  const body = R.from([Buffer.alloc(8)]);
  const failure = new Error('EACCES-ish');
  let observed: Error | undefined;
  body.on('error', (e: Error) => {
    observed = e;
  });
  destroyClaimedBody(body, failure);
  await new Promise((resolve) => body.on('close', resolve));
  assert.equal(observed, failure);
  assert.equal((failure as { injectedByWriter?: boolean }).injectedByWriter, true);
});

test('1.0.4 unit: normalizeBodyError classifies truncation, corruption, and pass-throughs', async () => {
  const { normalizeBodyError } = await import('../../src/writer/secure-writer.ts');
  const { TruncatedArchiveError: TE, CorruptArchiveError: CE } =
    await import('../../src/errors.ts');
  const { EntrySizeExceededError: EE } = await import('../../src/errors.ts');

  const trunc = normalizeBodyError(new Error('Unexpected end of data')) as Error & { code: string };
  assert.ok(trunc instanceof TE);
  assert.equal(trunc.code, 'TRUNCATED_ARCHIVE');

  const corrupt = normalizeBodyError(new Error('bad header magic')) as Error & { code: string };
  assert.ok(corrupt instanceof CE);
  assert.equal(corrupt.code, 'CORRUPT_ARCHIVE');

  const policy = new EE('f', 1, 1);
  assert.equal(normalizeBodyError(policy), policy);

  const injected = new Error('EBIG') as Error & { injectedByWriter?: boolean };
  injected.injectedByWriter = true;
  assert.equal(normalizeBodyError(injected), injected);
});

test('1.0.4: a real tar.gz whose first entry exceeds a rolling limit rejects typed and settles the pool', async () => {
  // Same mechanism as the EFBIG/ENOSPC class: the write fails MID-DRAIN of a
  // claimed TAR body. The for-await cleanup destroys the body without an
  // error, so recovery relies on the parser's premature-close handling.
  const out = await tmpOutput();
  const target = nodePath.join(out, 'result');
  try {
    const archive = gzipSync(
      await buildTar([
        { name: 'first.bin', content: Buffer.alloc(256 * 1024, 9) },
        { name: 'second.txt', content: Buffer.alloc(64, 1) },
        { name: 'third.txt', content: Buffer.alloc(64, 2) },
      ]),
    );
    let watchdogTimer: ReturnType<typeof setTimeout> | undefined;
    const watchdog = new Promise<never>((_, reject) => {
      watchdogTimer = setTimeout(
        () => reject(new Error('regression: pool did not settle in 5s')),
        5000,
      );
    });
    const settled = await Promise.race([
      extract(archive, target, { maxEntrySize: 64 * 1024, concurrency: 8 }).then(
        () => assert.fail('expected rejection'),
        (e: unknown) => e,
      ),
      watchdog,
    ]);
    clearTimeout(watchdogTimer);
    assert.ok(
      settled instanceof EntrySizeExceededError,
      `expected EntrySizeExceededError, got ${String(settled)}`,
    );
    await assert.rejects(stat(target), /ENOENT/);
    const siblings = await import('node:fs/promises').then((fs) =>
      fs.readdir(nodePath.dirname(target)),
    );
    assert.equal(siblings.filter((name) => name.startsWith('.decompress-tmp-')).length, 0);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});
