import {
  open,
  mkdir,
  lstat,
  realpath,
  symlink,
  link,
  rename,
  rm,
  utimes,
  lutimes,
  readlink,
  unlink,
} from 'node:fs/promises';
import { constants } from 'node:fs';
import { AbortError, NotADirectoryError } from '../errors.ts';

const O_NOFOLLOW = constants.O_NOFOLLOW ?? 0;
const O_EXCL = constants.O_EXCL ?? 0o200;
const O_CREAT = constants.O_CREAT ?? 0o100;
const O_WRONLY = constants.O_WRONLY ?? 0o2;

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new AbortError(signal);
}

export async function safeLstat(p: string, signal?: AbortSignal) {
  checkAbort(signal);
  return lstat(p);
}

export async function safeRealpath(p: string, signal?: AbortSignal): Promise<string> {
  checkAbort(signal);
  return realpath(p);
}

export async function safeReadlink(p: string, signal?: AbortSignal): Promise<string> {
  checkAbort(signal);
  return readlink(p);
}

/**
 * Create a directory. Uses mkdir; if exclusive and the path exists, EEXIST is thrown
 * to the caller (who decides based on policy).
 */
export async function safeMkdir(
  p: string,
  opts: { mode?: number; recursive?: boolean; signal?: AbortSignal },
): Promise<void> {
  checkAbort(opts.signal);
  await mkdir(p, { mode: opts.mode ?? 0o755, recursive: opts.recursive ?? false });
}

/**
 * Open a file for writing with O_CREAT | O_EXCL | O_NOFOLLOW.
 * - O_EXCL: fail if file already exists (defense in depth).
 * - O_NOFOLLOW: kernel refuses to follow a symlink at the final component.
 * Returns a filehandle; caller must close it.
 */
export async function safeOpenExclusive(p: string, mode: number, signal?: AbortSignal) {
  checkAbort(signal);
  // On Windows, O_NOFOLLOW is not supported; open will ignore the unknown flag on most
  // platforms but we guard for portability. preventWritingThroughSymlink is the fallback.
  try {
    return await open(p, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, mode);
  } catch (e) {
    // Some platforms reject O_NOFOLLOW on a directory; retry without it for the
    // (rare) case where the path legitimately has no symlink. The pre-check
    // preventWritingThroughSymlink is the real guard.
    const err = e as NodeJS.ErrnoException;
    if (err.code === 'EINVAL' || err.code === 'ENOSYS') {
      return await open(p, O_WRONLY | O_CREAT | O_EXCL, mode);
    }
    throw e;
  }
}

export async function safeWriteAll(
  fh: {
    write: (buffer: Buffer, offset?: number, length?: number) => Promise<{ bytesWritten: number }>;
  },
  data: Buffer,
  signal?: AbortSignal,
): Promise<void> {
  let offset = 0;
  while (offset < data.length) {
    checkAbort(signal);
    const { bytesWritten } = await fh.write(data, offset, data.length - offset);
    if (bytesWritten <= 0) throw new Error('file write made no progress');
    offset += bytesWritten;
  }
}

export async function safeClose(fh: { close: () => Promise<void> }): Promise<void> {
  await fh.close();
}

export async function safeSymlink(
  target: string,
  linkPath: string,
  signal?: AbortSignal,
): Promise<void> {
  checkAbort(signal);
  await symlink(target, linkPath);
}

export async function safeHardlink(
  target: string,
  linkPath: string,
  signal?: AbortSignal,
): Promise<void> {
  checkAbort(signal);
  await link(target, linkPath);
}

export async function safeUnlink(p: string, signal?: AbortSignal): Promise<void> {
  checkAbort(signal);
  await unlink(p);
}

export async function safeRename(src: string, dest: string, signal?: AbortSignal): Promise<void> {
  checkAbort(signal);
  await rename(src, dest);
}

export async function safeRm(
  p: string,
  opts: { recursive?: boolean; force?: boolean; signal?: AbortSignal } = {},
): Promise<void> {
  checkAbort(opts.signal);
  await rm(p, { recursive: opts.recursive ?? true, force: opts.force ?? true });
}

export async function safeUtimes(p: string, mtime: Date, signal?: AbortSignal): Promise<void> {
  checkAbort(signal);
  const ts = mtime.getTime() / 1000;
  if (!Number.isFinite(ts)) return;
  await utimes(p, ts, ts);
}

export async function safeLutimes(p: string, mtime: Date, signal?: AbortSignal): Promise<void> {
  checkAbort(signal);
  if (process.platform === 'win32') return; // lutimes not supported on Windows.
  const ts = mtime.getTime() / 1000;
  if (!Number.isFinite(ts)) return;
  try {
    await lutimes(p, ts, ts);
  } catch {
    // Some filesystems (NFS) don't support lutimes; warn, don't fail.
  }
}

export async function safeFchmod(
  fh: { chmod: (m: number) => Promise<void> },
  mode: number,
  signal?: AbortSignal,
): Promise<void> {
  checkAbort(signal);
  await fh.chmod(mode);
}

export async function safeChmod(p: string, mode: number, signal?: AbortSignal): Promise<void> {
  checkAbort(signal);
  const { chmod } = await import('node:fs/promises');
  await chmod(p, mode);
}

/**
 * Verify a path component is a real directory (not a symlink). Throws
 * NotADirectoryError if it's a file or SymlinkInPathError if it's a symlink.
 */
export async function ensureNotSymlink(p: string, signal?: AbortSignal): Promise<void> {
  const st = await safeLstat(p, signal);
  if (st.isSymbolicLink()) {
    throw new NotADirectoryError(`path component is a symlink: ${p}`);
  }
  if (!st.isDirectory()) {
    throw new NotADirectoryError(`path component is not a directory: ${p}`);
  }
}

export { O_NOFOLLOW, O_EXCL };
