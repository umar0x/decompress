import nodePath from 'node:path';
import type { ArchiveEntry, Limits, PathCtx, Warning } from '../types.ts';
import { isInsideOutput, validatePath, normalizePath } from './path-security.ts';
import { sanitizeMode } from './permissions.ts';
import {
  safeLstat,
  safeMkdir,
  safeOpenExclusive,
  safeWriteAll,
  safeClose,
  safeSymlink,
  safeHardlink,
  safeUnlink,
  safeFchmod,
} from './fs-ops.ts';
import {
  AbortError,
  EntrySizeExceededError,
  HardlinkTargetMissingError,
  LinkEscapeError,
  LinkThroughSymlinkError,
  NotADirectoryError,
  SymlinkRefusedError,
  HardlinkRefusedError,
  OutputExistsError,
  TotalSizeExceededError,
  CompressionRatioExceededError,
} from '../errors.ts';
import { validateSymlinkTarget, validateHardlinkTarget } from '../policy/link-policy.ts';

export type WriteContext = {
  realOutputPath: string;
  signal?: AbortSignal;
  umask: number;
  limits: Limits;
  policy: {
    allowSymlinks: boolean;
    allowHardlinks: boolean;
    preservePermissions: boolean;
    overwrite: boolean;
    symlinkFallback: 'error' | 'hardlink' | 'skip';
  };
  createdDirs: Set<string>;
  warnings: Warning[];
  pathCtx: PathCtx;
  budget?: {
    totalBytes: number;
    archiveSize: number;
  };
};

export type EntryResult =
  | { kind: 'file'; path: string; mode: number; bytes: number; mtime: Date | null }
  | { kind: 'directory'; path: string; mode: number; mtime: Date | null }
  | { kind: 'symlink'; path: string; target: string; mtime: Date | null }
  | { kind: 'hardlink'; path: string; target: string };

/**
 * Write a single archive entry to disk under ctx.realOutputPath.
 * Throws a subclass of DecompressError on any policy violation or I/O failure.
 *
 * Ancestor containment: `ensureParentInside` is the single authority. Each
 * directory below the staging root is created by this writer or verified with
 * one lstat on first touch, then cached. The staging root is created with mode
 * 0700 and owned by this process, so once a directory is verified no other
 * process can replace it with a symlink underneath us.
 *
 * Final-component containment: files are opened with O_CREAT | O_EXCL |
 * O_NOFOLLOW, so the kernel refuses to create through an existing path or a
 * symlink. Directories, symlinks, and hardlinks rely on their EEXIST handling,
 * which lstats the destination before any destructive action.
 */
export async function writeEntry(entry: ArchiveEntry, ctx: WriteContext): Promise<EntryResult> {
  // abort check (between entries)
  if (ctx.signal?.aborted) throw new AbortError(ctx.signal);

  // reject unsafe paths before writing
  validatePath(entry.path, ctx.pathCtx, entry.path);

  // canonical output root + safe resolution
  const normalizedRel = normalizePath(entry.path, ctx.pathCtx);
  const dest = nodePath.join(ctx.realOutputPath, normalizedRel);

  // Re-check containment on the joined path (defense in depth).
  if (!isInsideOutput(dest, ctx.realOutputPath)) {
    throw new LinkEscapeError(entry.path, 'symlink', entry.path, dest);
  }

  // per-entry size limit
  if (entry.type === 'file' && entry.size !== undefined && entry.size > ctx.limits.maxEntrySize) {
    throw new EntrySizeExceededError(entry.path, entry.size, ctx.limits.maxEntrySize);
  }

  switch (entry.type) {
    case 'directory':
      return writeDirectory(entry, dest, ctx);
    case 'symlink':
      if (!ctx.policy.allowSymlinks) {
        throw new SymlinkRefusedError(`symlink entry refused: ${entry.path}`);
      }
      return writeSymlink(entry, dest, ctx);
    case 'hardlink':
      if (!ctx.policy.allowHardlinks) {
        throw new HardlinkRefusedError(`hardlink entry refused: ${entry.path}`);
      }
      return writeHardlink(entry, dest, ctx);
    case 'file':
    default:
      return writeFileEntry(entry, dest, ctx);
  }
}

/**
 * Reject writes that would travel through a symlink planted at `dest` (or any
 * ancestor below realOutputPath). Defends against symlink-based traversal of
 * the output tree.
 *
 * Retained as a standalone check for callers that need it; the hot entry path
 * now relies on `ensureParentInside`'s cached ancestor verification plus
 * kernel-level O_NOFOLLOW/O_EXCL enforcement, which provide the same
 * guarantees without re-walking every component of every entry.
 */
export async function preventWritingThroughSymlink(
  dest: string,
  realOutputPath: string,
  signal?: AbortSignal,
): Promise<void> {
  const rel = nodePath.relative(realOutputPath, dest);
  if (rel === '' || rel === '.') return; // dest === realOutputPath
  if (isParentEscape(rel) || nodePath.isAbsolute(rel)) {
    throw new LinkThroughSymlinkError(`dest outside output: ${dest}`);
  }

  // Walk each intermediate path component; reject if any is a symlink.
  let cur = realOutputPath;
  const segments = rel.split(nodePath.sep).filter(Boolean);
  for (const seg of segments) {
    cur = nodePath.join(cur, seg);
    let st;
    try {
      st = await safeLstat(cur, signal);
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') continue;
      throw e;
    }
    if (st.isSymbolicLink()) {
      throw new LinkThroughSymlinkError(`symlink in path: ${cur}`);
    }
  }
}

/**
 * True when `rel` (a path.relative result) actually escapes upward: exactly
 * '..' or a '../...' prefix. Names like '..foo' are legal siblings, not
 * traversal, and must not be treated as escapes.
 */
function isParentEscape(rel: string): boolean {
  return rel === '..' || rel.startsWith(`..${nodePath.sep}`);
}

/**
 * Ensure every ancestor directory of `parent` exists inside the staging root
 * and is a real directory (not a symlink).
 *
 * The staging root is private (0700, this process). Each directory is therefore
 * either created by this writer (mkdir) or, when mkdir reports EEXIST, is a
 * prior artifact of this extraction and is verified once with lstat. Verified
 * directories are cached in `ctx.createdDirs`; re-touching a cached directory
 * costs no syscalls.
 */
async function ensureParentInside(parent: string, ctx: WriteContext): Promise<void> {
  const rel = nodePath.relative(ctx.realOutputPath, parent);
  if (rel === '' || rel === '.') return;
  if (isParentEscape(rel) || nodePath.isAbsolute(rel)) {
    throw new NotADirectoryError(`parent escapes output: ${parent}`);
  }

  let cur = ctx.realOutputPath;
  const segments = rel.split(nodePath.sep).filter(Boolean);
  for (const seg of segments) {
    const next = nodePath.join(cur, seg);
    if (ctx.createdDirs.has(next)) {
      cur = next;
      continue;
    }

    try {
      await safeMkdir(next, { mode: 0o755 & ~ctx.umask, signal: ctx.signal });
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code !== 'EEXIST') throw e;
      // Something already exists at this path. Since the staging root is
      // private, it can only be a prior artifact of this extraction; a
      // symlink here means an archive entry is trying to plant a traversal
      // path (for example a symlink entry followed by a file write through it).
      const st = await safeLstat(next, ctx.signal);
      if (st.isSymbolicLink()) throw new LinkThroughSymlinkError(`symlink in path: ${next}`);
      if (!st.isDirectory()) throw new NotADirectoryError(`not a directory: ${next}`);
    }

    // Recheck containment after creation (defense in depth, once per directory).
    if (!isInsideOutput(next, ctx.realOutputPath)) {
      throw new NotADirectoryError(`path escaped output after mkdir: ${next}`);
    }

    ctx.createdDirs.add(next);
    cur = next;
  }
}

async function writeDirectory(
  entry: ArchiveEntry,
  dest: string,
  ctx: WriteContext,
): Promise<EntryResult> {
  await ensureParentInside(nodePath.dirname(dest), ctx);

  const mode = sanitizeMode(entry.mode, 'directory', {
    preservePermissions: ctx.policy.preservePermissions,
    umask: ctx.umask,
  });

  try {
    await safeMkdir(dest, { mode, signal: ctx.signal });
    ctx.createdDirs.add(dest);
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === 'EEXIST') {
      if (ctx.createdDirs.has(dest)) {
        // Repeated directory entries are idempotent.
      } else if (ctx.policy.overwrite) {
        const st = await safeLstat(dest, ctx.signal);
        if (st.isSymbolicLink()) throw new LinkThroughSymlinkError(`symlink at dest: ${dest}`);
        if (!st.isDirectory()) throw new NotADirectoryError(`not a directory: ${dest}`);
      } else {
        throw new OutputExistsError(`refusing to overwrite existing directory: ${dest}`);
      }
    } else {
      throw e;
    }
  }

  return { kind: 'directory', path: dest, mode, mtime: entry.mtime ?? null };
}

async function writeFileEntry(
  entry: ArchiveEntry,
  dest: string,
  ctx: WriteContext,
): Promise<EntryResult> {
  // Claim the body stream before the first await. The TAR parser auto-drains
  // unclaimed bodies when the pipeline advances past an entry; concurrent
  // writers must therefore claim synchronously on receipt so the drain only
  // ever applies to entries the pipeline actually skipped.
  const contents = entry.buffer ? [await entry.buffer()] : entry.stream ? entry.stream() : [];

  await ensureParentInside(nodePath.dirname(dest), ctx);

  const mode = sanitizeMode(entry.mode, 'file', {
    preservePermissions: ctx.policy.preservePermissions,
    umask: ctx.umask,
  });

  // Exclusive creation with O_NOFOLLOW (refuses to follow a final-component
  // symlink) and O_EXCL (refuses to clobber an existing path).
  let fh;
  try {
    fh = await safeOpenExclusive(dest, 0o600, ctx.signal);
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === 'EEXIST') {
      if (ctx.policy.overwrite) {
        // Verify it's a regular file (not a symlink we'd be clobbering through).
        const st = await safeLstat(dest, ctx.signal);
        if (st.isSymbolicLink()) throw new LinkThroughSymlinkError(`symlink at dest: ${dest}`);
        await safeUnlink(dest, ctx.signal);
        fh = await safeOpenExclusive(dest, 0o600, ctx.signal);
      } else {
        throw new OutputExistsError(`refusing to overwrite existing file: ${dest}`);
      }
    } else {
      throw e;
    }
  }

  let bytes = 0;
  try {
    for await (const value of contents) {
      if (ctx.signal?.aborted) throw new AbortError(ctx.signal.reason);
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value as unknown as Uint8Array);
      bytes += chunk.length;
      enforceRollingLimits(entry.path, bytes, chunk.length, ctx);
      await safeWriteAll(fh, chunk, ctx.signal);
    }
    await safeFchmod(fh, mode, ctx.signal);
  } finally {
    await safeClose(fh);
  }

  // mtime is applied by the caller in a post-write batch; the staging tree is
  // invisible until the atomic rename, so deferral is externally unobservable.
  return { kind: 'file', path: dest, mode, bytes, mtime: entry.mtime ?? null };
}

async function writeSymlink(
  entry: ArchiveEntry,
  dest: string,
  ctx: WriteContext,
): Promise<EntryResult> {
  await ensureParentInside(nodePath.dirname(dest), ctx);
  const linkBase = nodePath.dirname(dest);
  const linkname = entry.linkTarget ?? '';
  // validate target via realpath chain check.
  await validateSymlinkTarget(linkname, linkBase, {
    allowSymlinks: true, // already checked above
    allowHardlinks: ctx.policy.allowHardlinks,
    realOutputPath: ctx.realOutputPath,
  });

  try {
    await safeSymlink(linkname, dest, ctx.signal);
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === 'EEXIST') {
      if (ctx.policy.overwrite) {
        const st = await safeLstat(dest, ctx.signal);
        if (!st.isSymbolicLink()) throw new NotADirectoryError(`dest not a symlink: ${dest}`);
        await safeUnlink(dest, ctx.signal);
        await safeSymlink(linkname, dest, ctx.signal);
      } else {
        throw new OutputExistsError(`refusing to overwrite existing symlink: ${dest}`);
      }
    } else if (err.code === 'EPERM' || err.code === 'EACCES') {
      // Windows may refuse symlink creation with EPERM.
      const fallback = ctx.policy.symlinkFallback;
      if (fallback === 'hardlink') {
        const target = nodePath.resolve(linkBase, linkname);
        await safeHardlink(target, dest, ctx.signal);
        ctx.warnings.push({
          code: 'symlink_fallback_hardlink',
          message: `symlink degraded to hardlink: ${entry.path}`,
        });
      } else if (fallback === 'skip') {
        ctx.warnings.push({
          code: 'symlink_fallback_skip',
          message: `symlink skipped: ${entry.path}`,
        });
        return { kind: 'symlink', path: dest, target: linkname, mtime: entry.mtime ?? null };
      } else {
        throw e;
      }
    } else {
      throw e;
    }
  }

  return { kind: 'symlink', path: dest, target: linkname, mtime: entry.mtime ?? null };
}

async function writeHardlink(
  entry: ArchiveEntry,
  dest: string,
  ctx: WriteContext,
): Promise<EntryResult> {
  await ensureParentInside(nodePath.dirname(dest), ctx);
  const linkname = entry.linkTarget ?? '';
  // validate target. Resolve relative to output root (tar hardlink semantics).
  const target = await validateHardlinkTarget(linkname, {
    allowSymlinks: ctx.policy.allowSymlinks,
    allowHardlinks: true, // already checked above
    realOutputPath: ctx.realOutputPath,
  });

  try {
    await safeHardlink(target, dest, ctx.signal);
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === 'EEXIST') {
      if (ctx.policy.overwrite) {
        await safeUnlink(dest, ctx.signal);
        await safeHardlink(target, dest, ctx.signal);
      } else {
        throw new OutputExistsError(`refusing to overwrite existing hardlink: ${dest}`);
      }
    } else if (err.code === 'ENOENT') {
      throw new HardlinkTargetMissingError(`hardlink target missing: ${linkname}`);
    } else {
      throw e;
    }
  }

  // Do not update hardlink times because links share the target inode.
  return { kind: 'hardlink', path: dest, target };
}

function enforceRollingLimits(
  entryPath: string,
  entryBytes: number,
  delta: number,
  ctx: WriteContext,
): void {
  if (entryBytes > ctx.limits.maxEntrySize) {
    throw new EntrySizeExceededError(entryPath, entryBytes, ctx.limits.maxEntrySize);
  }
  if (!ctx.budget) return;
  ctx.budget.totalBytes += delta;
  if (ctx.budget.totalBytes > ctx.limits.maxTotalSize) {
    throw new TotalSizeExceededError(ctx.budget.totalBytes, ctx.limits.maxTotalSize);
  }
  if (ctx.budget.archiveSize > 0) {
    const ratio = ctx.budget.totalBytes / ctx.budget.archiveSize;
    if (ratio > ctx.limits.maxCompressionRatio) {
      throw new CompressionRatioExceededError(ratio, ctx.limits.maxCompressionRatio);
    }
  }
}
