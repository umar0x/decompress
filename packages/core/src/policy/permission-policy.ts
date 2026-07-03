import type { EntryType } from '../types.ts';

export type SanitizeModeOptions = {
  preservePermissions: boolean;
  umask: number;
};

/**
 * Sanitize an archive-declared mode for application to disk.
 *   1. Coerce to 12-bit integer.
 *   2. Always strip 0o7000 (setuid, setgid, and sticky).
 *   3. Apply default cap: files 0o644 (or 0o755 if archive has any execute bit set,
 *      to match common tar defaults). preservePermissions widens to 0o777.
 *      Dirs 0o755.
 *   4. Apply umask: mode & ~umask.
 */
export function sanitizeMode(
  archiveMode: number | undefined,
  kind: EntryType | 'file' | 'directory',
  opts: SanitizeModeOptions,
): number {
  const raw = archiveMode ?? (kind === 'directory' ? 0o755 : 0o644);
  let mode = raw & 0o7777;

  // unconditionally strip SUID/SGID/sticky.
  mode &= ~0o7000;

  if (opts.preservePermissions) {
    // No cap (SUID/SGID/sticky already stripped).
  } else if (kind === 'directory') {
    mode &= 0o755;
  } else {
    // Preserve execute bit if the archive declares it (matches common tar defaults).
    const hasExec = (raw & 0o111) !== 0;
    mode &= hasExec ? 0o755 : 0o644;
  }

  mode &= ~opts.umask;

  return mode & 0o777;
}
