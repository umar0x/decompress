import { sanitizeMode as sanitize } from '../policy/permission-policy.ts';
import { safeUtimes, safeLutimes } from './fs-ops.ts';
import type { EntryType } from '../types.ts';

export function sanitizeMode(
  archiveMode: number | undefined,
  kind: EntryType,
  opts: { preservePermissions: boolean; umask: number },
): number {
  return sanitize(archiveMode, kind, opts);
}

/**
 * Apply mtime to an entry path. For symlinks, uses lutimes (POSIX only).
 * Hardlinks are skipped because they share an inode with the target;
 * applying utimes would mutate the target's mtime.
 */
export async function applyMtime(
  entryPath: string,
  mtime: Date | null | undefined,
  type: EntryType,
  signal?: AbortSignal,
): Promise<void> {
  if (mtime === null || mtime === undefined) return;
  if (type === 'hardlink') return; // hardlinks share an inode with the target
  if (type === 'symlink') {
    await safeLutimes(entryPath, mtime, signal);
    return;
  }
  await safeUtimes(entryPath, mtime, signal);
}
