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
  const directories: Array<{ path: string; mtime: Date | null }> = [];
  let entryCount = 0;
  let processedCount = 0;

  async function writeOne(entry: ArchiveEntry, originalIndex: number): Promise<void> {
    if (signal?.aborted) throw new AbortError(signal);
    // For 'overwrite' duplicate entries, use a per-entry context with overwrite enabled.
    const entryCtx = opts.perEntryOverwrite?.has(originalIndex)
      ? { ...ctx, policy: { ...ctx.policy, overwrite: true } }
      : ctx;
    const warningStart = ctx.warnings.length;
    const r = await writeEntry(entry, entryCtx);
    for (const warning of ctx.warnings.slice(warningStart)) opts.onWarning?.(warning);
    results[originalIndex] = r;
    if (r.kind === 'directory') directories.push({ path: r.path, mtime: entry.mtime ?? null });
    processedCount++;
    opts.onEntry?.(r, originalIndex);
    opts.onProgress?.(processedCount, knownTotal, ctx.budget!.totalBytes);
  }

  try {
    for await (const entry of entries) {
      const index = entryCount++;
      if (entryCount > opts.limits.maxFiles) {
        throw new FileCountExceededError(entryCount, opts.limits.maxFiles);
      }
      if (entry.type === 'hardlink') hardlinks.push({ entry, index });
      else await writeOne(entry, index);
    }

    await writeHardlinksWithDependencies(hardlinks, writeOne);

    directories.sort((a, b) => pathDepth(b.path) - pathDepth(a.path));
    for (const directory of directories) {
      await applyMtime(directory.path, directory.mtime, 'directory', signal);
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
