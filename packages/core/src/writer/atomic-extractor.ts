import nodePath from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, realpath, rename, rm, rmdir, lstat } from 'node:fs/promises';
import type { ArchiveEntry, Limits, PathCtx, Warning } from '../types.ts';
import { writeEntry, type WriteContext, type EntryResult } from './secure-writer.ts';
import { applyMtime } from './permissions.ts';
import { detectPlatform } from './path-security.ts';
import {
  AbortError,
  CrossDeviceRenameError,
  OutputExistsError,
  OutputIsFileError,
  OutputIsSymlinkError,
  FileCountExceededError,
} from '../errors.ts';

const TEMP_PREFIX = '.decompress-tmp-';

/** Batch size for deferred mtime application. */
const MTIME_BATCH = 64;

function tempDirName(): string {
  return `${TEMP_PREFIX}${randomUUID()}.tmp`;
}

function isTempDir(name: string): boolean {
  return /^\.decompress-tmp-[0-9a-fA-F-]{16,}\.tmp$/.test(nodePath.basename(name));
}

/**
 * Bounded recursive delete that does not follow symlinks.
 */
export async function boundedRimraf(target: string, maxDepth = 64): Promise<void> {
  if (maxDepth <= 0) return;
  let st;
  try {
    st = await lstat(target);
  } catch {
    return; // already gone
  }
  if (st.isDirectory() && !st.isSymbolicLink()) {
    const { readdir } = await import('node:fs/promises');
    const children = await readdir(target);
    for (const child of children) {
      await boundedRimraf(nodePath.join(target, child), maxDepth - 1);
    }
    try {
      await rmdir(target);
    } catch {
      // Cleanup must not hide the extraction error.
    }
  } else {
    try {
      await rm(target, { force: true });
    } catch {
      // Cleanup must not hide the extraction error.
    }
  }
}

/**
 * Recursively delete the temp directory. Best-effort: never throws (a cleanup failure
 * must not mask the original extraction failure).
 */
export async function cleanupTempDir(tempRoot: string): Promise<void> {
  // Never recursively remove a path that was not created by this extractor.
  if (!isTempDir(tempRoot)) {
    console.error(`decompress: refusing to clean up suspicious temp dir: ${tempRoot}`);
    return;
  }
  try {
    await boundedRimraf(tempRoot);
  } catch (e) {
    console.error(
      `decompress: FAILED to clean up temp dir ${tempRoot}. ` +
        `Manual removal required. Original error: ${(e as Error).message}`,
    );
  }
}

export type AtomicExtractOptions = {
  output: string;
  limits: Limits;
  policy: WriteContext['policy'];
  signal?: AbortSignal;
  perEntryOverwrite?: Set<number>;
  onEntry?: (entry: EntryResult, index: number) => void;
  onWarning?: (warning: Warning) => void;
  onProgress?: (processed: number, total: number | null, bytes: number) => void;
  archiveSize: number;
  /**
   * Maximum number of entries written concurrently. All policy validation
   * (paths, duplicates, limits) happens before writes begin, and the output
   * stays atomic regardless, so concurrency only changes write scheduling.
   * TAR-family bodies are inherently ordered, so those formats remain
   * sequential; ZIP benefits from parallel writes. Default: 8.
   */
  concurrency?: number;
};

/**
 * Extract `entries` atomically: write into a temp dir, rename to `output` on success,
 * delete the temp dir on any failure (including abort).
 *
 * Two-phase extraction: non-hardlinks first, then hardlinks (their targets must exist).
 * Settle-all-then-rethrow: all entries settled, first failure in entry order rethrown.
 */
export async function atomicExtract(
  entries: Iterable<ArchiveEntry> | AsyncIterable<ArchiveEntry>,
  opts: AtomicExtractOptions,
): Promise<{
  entries: EntryResult[];
  totalBytes: number;
  output: string;
  tempDir: string;
  warnings: Warning[];
}> {
  const signal = opts.signal;
  const requestedOutput = nodePath.resolve(opts.output);

  // canonical output root. Create if missing, realpath it.
  // Check pre-existing output state.
  let existingStat;
  try {
    existingStat = await lstat(requestedOutput);
  } catch (error) {
    const fsError = error as NodeJS.ErrnoException;
    if (fsError.code !== 'ENOENT') throw error;
  }
  if (existingStat) {
    if (existingStat.isSymbolicLink()) {
      throw new OutputIsSymlinkError(`output is a symlink: ${requestedOutput}`);
    }
    if (!existingStat.isDirectory()) {
      throw new OutputIsFileError(`output is not a directory: ${requestedOutput}`);
    }
    // It's a directory. If non-empty and overwrite is false, refuse.
    if (!opts.policy.overwrite) {
      const { readdir } = await import('node:fs/promises');
      const children = await readdir(requestedOutput);
      if (children.length > 0) {
        throw new OutputExistsError(
          `output is non-empty and overwrite is false: ${requestedOutput}`,
        );
      }
    }
  }

  const requestedParent = nodePath.dirname(requestedOutput);
  await mkdir(requestedParent, { recursive: true, mode: 0o755 });
  const realParent = await realpath(requestedParent);
  const realOutputPath = existingStat
    ? await realpath(requestedOutput)
    : nodePath.join(realParent, nodePath.basename(requestedOutput));

  // Create the temp dir as a sibling of realOutputPath (same filesystem → atomic rename).
  const tempRoot = nodePath.join(realParent, tempDirName());
  await mkdir(tempRoot, { mode: 0o700 });

  const pathCtx: PathCtx = {
    platform: detectPlatform(),
    caseInsensitive: process.platform === 'win32' || process.platform === 'darwin',
    limits: opts.limits,
  };

  const ctx: WriteContext = {
    realOutputPath: tempRoot,
    signal,
    umask: process.umask(),
    limits: opts.limits,
    policy: opts.policy,
    createdDirs: new Set<string>([tempRoot]),
    warnings: [],
    pathCtx,
    budget: { totalBytes: 0, archiveSize: opts.archiveSize },
  };

  const knownTotal = Array.isArray(entries) ? entries.length : null;
  const results: Array<EntryResult | undefined> = [];
  const hardlinks: Array<{ entry: ArchiveEntry; index: number }> = [];
  const deferredMtimes: Array<{
    path: string;
    mtime: Date;
    type: 'file' | 'directory' | 'symlink';
    order: number;
  }> = [];
  let entryCount = 0;
  let processedCount = 0;

  // Ordered callback emission: onEntry/onProgress must fire in entry order
  // regardless of write completion order. Progress counts reflect the number
  // of entries EMITTED, not completed, so the sequence stays monotonic.
  // Hardlink placeholders advance the slot without counting: their callbacks
  // fire when the hardlink is actually written, after the main phase.
  const pendingCallbacks = new Map<number, ((emitted: number) => void) | null>();
  let emittedIndex = 0;
  let emittedWritten = 0;
  function emitOrdered(index: number, afterWritten: ((emitted: number) => void) | null) {
    pendingCallbacks.set(index, afterWritten);
    while (pendingCallbacks.has(emittedIndex)) {
      const cb = pendingCallbacks.get(emittedIndex)!;
      pendingCallbacks.delete(emittedIndex);
      emittedIndex++;
      if (cb !== null) {
        emittedWritten++;
        cb(emittedWritten);
      }
    }
  }

  async function writeAndRecord(
    entry: ArchiveEntry,
    originalIndex: number,
    phase: 'main' | 'hardlinks' = 'main',
  ): Promise<void> {
    if (signal?.aborted) throw new AbortError(signal);
    // For 'overwrite' duplicate entries, use a per-entry context with overwrite enabled.
    const entryCtx = opts.perEntryOverwrite?.has(originalIndex)
      ? { ...ctx, policy: { ...ctx.policy, overwrite: true } }
      : ctx;
    const warningStart = ctx.warnings.length;
    const r = await writeEntry(entry, entryCtx);
    for (const warning of ctx.warnings.slice(warningStart)) opts.onWarning?.(warning);
    results[originalIndex] = r;
    if (r.kind !== 'hardlink' && r.mtime !== null && r.mtime !== undefined) {
      deferredMtimes.push({ path: r.path, mtime: r.mtime, type: r.kind, order: originalIndex });
    }
    processedCount++;
    if (phase === 'hardlinks') {
      // Hardlinks are written after the main phase; their callbacks fire at
      // write time, matching the sequential contract.
      opts.onEntry?.(r, originalIndex);
      opts.onProgress?.(processedCount, knownTotal, ctx.budget!.totalBytes);
    } else {
      emitOrdered(originalIndex, (emitted) => {
        opts.onEntry?.(r, originalIndex);
        // Read the byte count at emission time so the onProgress sequence
        // stays monotonic regardless of write completion order.
        opts.onProgress?.(emitted, knownTotal, ctx.budget!.totalBytes);
      });
    }
  }

  async function writeOne(entry: ArchiveEntry, originalIndex: number): Promise<void> {
    await writeAndRecord(entry, originalIndex, 'hardlinks');
  }

  const concurrency = Math.max(1, Math.min(32, Math.floor(opts.concurrency ?? 8)));

  try {
    if (concurrency === 1 || Symbol.asyncIterator in (entries as object)) {
      const iterator = (entries as AsyncIterable<ArchiveEntry>)[Symbol.asyncIterator]();
      const entryErrors = new Map<number, unknown>();
      // Serialized pull: only one worker advances the parser at a time. For
      // TAR-family generators this degenerates to today's strictly sequential
      // behavior because each body must drain before the next entry yields;
      // ZIP generators yield metadata lazily and parallelize cleanly.
      let pullChain: Promise<void> = Promise.resolve();
      const pullNext = (): Promise<IteratorResult<ArchiveEntry>> => {
        const run = pullChain.then(() => iterator.next());
        pullChain = run.then(
          () => undefined,
          () => undefined,
        );
        return run;
      };
      const worker = async (): Promise<void> => {
        for (;;) {
          if (entryErrors.size > 0 || signal?.aborted) return;
          const next = await pullNext();
          if (next.done) return;
          const entry = next.value;
          const index = entryCount++;
          if (entryCount > opts.limits.maxFiles) {
            entryErrors.set(index, new FileCountExceededError(entryCount, opts.limits.maxFiles));
            return;
          }
          if (entry.type === 'hardlink') {
            hardlinks.push({ entry, index });
            // Reserve the callback slot so later entries can emit in order;
            // the hardlink's own callbacks fire when it is written later.
            emitOrdered(index, null);
            continue;
          }
          try {
            await writeAndRecord(entry, index);
          } catch (error) {
            // Settle-all-then-rethrow: in-flight entries finish, then the first
            // failure in entry order is rethrown. The output is atomic either way.
            entryErrors.set(index, error);
            return;
          }
        }
      };
      await Promise.all(Array.from({ length: concurrency }, () => worker()));
      if (entryErrors.size > 0) {
        // Deterministically unwind the parser so its cleanup (stream
        // destruction) runs instead of waiting for GC of a suspended generator.
        await iterator.return?.().catch(() => undefined);
        const firstIndex = Math.min(...entryErrors.keys());
        throw entryErrors.get(firstIndex);
      }
    } else {
      const list = entries as Iterable<ArchiveEntry>;
      let index = 0;
      for (const entry of list) {
        if (index >= opts.limits.maxFiles) {
          throw new FileCountExceededError(index + 1, opts.limits.maxFiles);
        }
        if (entry.type === 'hardlink') {
          hardlinks.push({ entry, index });
          emitOrdered(index, null);
        } else await writeAndRecord(entry, index);
        index++;
      }
    }

    await writeHardlinksWithDependencies(hardlinks, writeOne);

    // Apply entry mtimes now that all content exists. The staging tree is
    // private and invisible until the commit rename, so deferral is
    // externally unobservable. Files and symlinks are applied in bounded
    // parallel batches; directories are applied last, deepest first, because
    // directory creation mutates parent mtimes (utimes on files does not).
    const fileMtimes = deferredMtimes.filter((m) => m.type !== 'directory');
    const dirMtimes = deferredMtimes
      .filter((m) => m.type === 'directory')
      .sort((a, b) => pathDepth(b.path) - pathDepth(a.path));
    const mtimeErrors: Array<{ order: number; error: unknown }> = [];
    for (let i = 0; i < fileMtimes.length; i += MTIME_BATCH) {
      const batch = fileMtimes.slice(i, i + MTIME_BATCH);
      await Promise.all(
        batch.map(async (item) => {
          try {
            await applyMtime(item.path, item.mtime, item.type, signal);
          } catch (error) {
            mtimeErrors.push({ order: item.order, error });
          }
        }),
      );
    }
    for (const item of dirMtimes) {
      try {
        await applyMtime(item.path, item.mtime, 'directory', signal);
      } catch (error) {
        mtimeErrors.push({ order: item.order, error });
      }
    }
    if (mtimeErrors.length > 0) {
      // First failure in entry order, matching the writer's failure contract.
      mtimeErrors.sort((a, b) => a.order - b.order);
      throw mtimeErrors[0]!.error;
    }

    // Final abort check before rename.
    if (signal?.aborted) throw new AbortError(signal);
  } catch (e) {
    await cleanupTempDir(tempRoot);
    throw e;
  }

  // Success: rename temp → realOutputPath.
  // On POSIX, rename to a non-empty directory fails with ENOTEMPTY.
  // When overwrite is true, use a 3-step backup-rename for crash safety:
  //   1. rename existing output → output.old.<timestamp>
  //   2. rename temp → output
  //   3. rm output.old
  // If step 2 fails, restore output.old → output.
  try {
    await atomicRename(tempRoot, realOutputPath, opts.policy.overwrite, signal);
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === 'EXDEV') {
      await cleanupTempDir(tempRoot);
      throw new CrossDeviceRenameError('atomic rename crossed a filesystem boundary', { cause: e });
    } else {
      await cleanupTempDir(tempRoot);
      throw new CrossDeviceRenameError(`atomic rename failed: ${err.message}`, { cause: e });
    }
  }

  const finalResults = results.filter((r): r is EntryResult => r !== undefined);
  return {
    entries: finalResults,
    totalBytes: ctx.budget!.totalBytes,
    output: realOutputPath,
    tempDir: tempRoot,
    warnings: [...ctx.warnings],
  };
}

/**
 * Atomic rename with overwrite support.
 * - If dest doesn't exist: simple rename (atomic on POSIX).
 * - If dest exists but is empty: remove it, then simple rename.
 * - If dest exists and is non-empty and overwrite is true: backup-rename.
 * - If dest exists and is non-empty and overwrite is false: throw OutputExistsError.
 */
async function atomicRename(
  tempRoot: string,
  dest: string,
  overwrite: boolean,
  _signal?: AbortSignal,
): Promise<void> {
  let destExists: boolean;
  try {
    await lstat(dest);
    destExists = true;
  } catch (error) {
    const fsError = error as NodeJS.ErrnoException;
    if (fsError.code !== 'ENOENT') throw error;
    destExists = false;
  }

  if (!destExists) {
    await rename(tempRoot, dest);
    return;
  }

  // Check whether an existing destination is empty.
  const { readdir } = await import('node:fs/promises');
  const children = await readdir(dest);
  const isEmpty = children.length === 0;

  if (isEmpty) {
    // Remove an empty destination before renaming staging into place.
    const { rmdir } = await import('node:fs/promises');
    try {
      await rmdir(dest);
    } catch {
      // The next rename reports the useful failure.
    }
    await rename(tempRoot, dest);
    return;
  }

  if (!overwrite) {
    // A non-empty destination requires explicit replacement.
    throw new OutputExistsError(`refusing to overwrite non-empty output: ${dest}`);
  }

  // Overwrite: 3-step backup-rename for crash safety.
  const backup = `${dest}.old.${randomUUID()}`;
  await rename(dest, backup);
  try {
    await rename(tempRoot, dest);
  } catch (e) {
    // Restore the backup.
    try {
      await rename(backup, dest);
    } catch {
      // Preserve the original commit failure.
    }
    throw e;
  }
  // Clean up the backup.
  try {
    await rm(backup, { recursive: true, force: true });
  } catch {
    // A stale backup is safer than deleting the committed output.
  }
}

async function writeHardlinksWithDependencies(
  hardlinks: Array<{ entry: ArchiveEntry; index: number }>,
  writeOne: (entry: ArchiveEntry, index: number) => Promise<void>,
): Promise<void> {
  let remaining = [...hardlinks];
  let lastError: unknown;
  while (remaining.length > 0) {
    const retry: typeof remaining = [];
    let progress = false;
    for (const item of remaining) {
      try {
        await writeOne(item.entry, item.index);
        progress = true;
      } catch (error) {
        if ((error as { code?: string }).code === 'HARDLINK_TARGET_MISSING') {
          retry.push(item);
          lastError = error;
        } else {
          throw error;
        }
      }
    }
    if (!progress && retry.length > 0) throw lastError;
    remaining = retry;
  }
}

function pathDepth(path: string): number {
  return path.split(nodePath.sep).length;
}
