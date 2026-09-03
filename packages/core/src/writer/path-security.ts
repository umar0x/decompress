import nodePath from 'node:path';
import type { DupPolicy, PathCtx, Platform } from '../types.ts';
import {
  AbsolutePathError,
  CaseCollisionError,
  DepthExceededError,
  DuplicatePathError,
  NulByteError,
  PathPolicyError,
  PathTraversalError,
  WindowsAdsError,
  WindowsDeviceNameError,
  WindowsTrailingDotsError,
} from '../errors.ts';

// Matches Windows device basenames, with or without an extension.
export const WINDOWS_DEVICE_NAME_REGEX = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i;

// A colon within a segment identifies an NTFS alternate data stream.
export const NTFS_ADS_REGEX = /:[^/\\]/;

const MAX_PATH_LEN = 4096;

/**
 * Remove no-op '.' path segments (leading './' and interior '/./'). Dot
 * segments are semantically neutral, so stripping them before validation lets
 * archives produced by commands like `tar czf archive.tgz .` extract while
 * every other path rule stays unchanged. A path consisting only of dot
 * segments ('.', '././') normalizes to '' and is rejected as empty.
 */
export function stripDotSegments(p: string): string {
  if (!p.includes('.')) return p;
  const segs = p.split(/[\\/]/);
  const kept = segs.filter((s) => s !== '.');
  if (kept.length === segs.length) return p;
  return kept.join('/');
}

/**
 * Return true iff `target` is inside `root` (or equal to `root`).
 * Uses path.relative instead of substring prefix matching.
 */
export function isInsideOutput(target: string, root: string): boolean {
  const rel = nodePath.relative(root, target);
  if (rel === '' || rel === '.') return true;
  if (rel === '..') return false;
  if (rel.startsWith(`..${nodePath.sep}`)) return false;
  // Cross-drive relative paths are absolute on Windows.
  if (nodePath.isAbsolute(rel)) return false;
  return true;
}

/**
 * Reject paths that violate the path-policy. Throws PathPolicyError (or subclass)
 * on any violation. This runs on the raw archive-declared path after dot-segment
 * normalization; the original path is preserved in `entryPath` context fields.
 */
export function validatePath(rawInput: string, ctx: PathCtx, entryPath?: string): void {
  // Dot stripping must not rewrite paths that still carry backslashes; those
  // are either rejected below (POSIX) or normalized later (Windows), and the
  // rejection messages should reference the original bytes.
  const canStrip = !rawInput.includes('\\');
  const raw = canStrip ? stripDotSegments(rawInput) : rawInput;
  if (rawInput.includes('\0') || raw.includes('\0')) {
    throw new NulByteError(`NUL byte in path: ${rawInput}`, { entryPath });
  }

  if (raw.length === 0 || raw.trim().length === 0) {
    throw new PathPolicyError(`empty path`, { entryPath });
  }
  if ([...raw].some((character) => character.codePointAt(0)! < 0x20)) {
    throw new PathPolicyError(`control character in path: ${JSON.stringify(raw)}`, { entryPath });
  }

  // Reject percent-encoded path characters.
  // Archive paths are literal, so encoded separators and traversal are invalid.
  if (raw.includes('%')) {
    throw new PathPolicyError(`URL-encoded character in path (percent-sign forbidden): ${raw}`, {
      entryPath,
    });
  }

  if (raw.startsWith('/')) {
    throw new AbsolutePathError(raw, 'posix', { entryPath });
  }

  if (/^[a-zA-Z]:[\\/]/.test(raw)) {
    throw new AbsolutePathError(raw, 'windows-drive', { entryPath });
  }

  if (/^[a-zA-Z]:/.test(raw)) {
    throw new AbsolutePathError(raw, 'windows-drive', { entryPath });
  }

  if (/^\\\\/.test(raw) || /^\/\//.test(raw)) {
    throw new AbsolutePathError(raw, 'windows-unc', { entryPath });
  }

  if (NTFS_ADS_REGEX.test(raw)) {
    throw new WindowsAdsError(`NTFS alternate data stream in path: ${raw}`, { entryPath });
  }

  for (const seg of raw.split(/[\\/]/)) {
    if (/[<>"|?*]/u.test(seg)) {
      throw new PathPolicyError(`Windows-invalid character in path segment: ${seg}`, { entryPath });
    }
    if (WINDOWS_DEVICE_NAME_REGEX.test(seg)) {
      throw new WindowsDeviceNameError(raw, seg, { entryPath });
    }
  }

  // Check '..' parent-dir segments BEFORE trailing dots, so '..' produces a
  // clear PathTraversalError ('..' segment) rather than a misleading WindowsTrailingDotsError.
  const segs = raw.split(/[\\/]/);
  if (segs.includes('..')) {
    throw new PathTraversalError(`'..' segment in path: ${raw}`, { entryPath });
  }

  // Parent traversal is checked first so it receives the correct error type.
  for (const seg of segs) {
    if (/[. ]$/.test(seg)) {
      throw new WindowsTrailingDotsError(raw, seg, { entryPath });
    }
    if (/^\.+$/.test(seg) && seg.length > 2) {
      throw new PathPolicyError(`all-dots segment in path: ${raw}`, { entryPath });
    }
  }

  if (raw.includes('/') && raw.includes('\\')) {
    throw new PathPolicyError(`mixed separators in path: ${raw}`, { entryPath });
  }

  if (ctx.platform === 'posix' && raw.includes('\\')) {
    throw new PathPolicyError(`backslash in POSIX path: ${raw}`, { entryPath });
  }

  if (raw.includes('//') || raw.includes('\\\\')) {
    throw new PathPolicyError(`empty segment in path: ${raw}`, { entryPath });
  }
  if (raw.endsWith('/') || raw.endsWith('\\')) {
    throw new PathPolicyError(`trailing separator in path: ${raw}`, { entryPath });
  }

  if (segs.length > ctx.limits.maxDepth) {
    throw new DepthExceededError(raw, segs.length, ctx.limits.maxDepth);
  }

  if (raw.length > MAX_PATH_LEN) {
    throw new PathPolicyError(`path too long (${raw.length} chars)`, { entryPath });
  }
}

/**
 * Normalize an archive-declared path to a canonical relative form.
 *   1. NFC-normalize (so visually-identical Unicode strings compare equal).
 *   2. Normalize separators.
 *   3. Resolve segments and reject parent traversal outside the root.
 *   4. Strip trailing separator.
 */
export function normalizePath(raw: string, ctx: PathCtx): string {
  let s = raw.normalize('NFC');

  const sep: string = ctx.platform === 'windows' ? '\\' : '/';
  s = s.replace(/[\\/]/g, sep);

  const parts = s.split(sep);
  const out: string[] = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (out.length === 0) {
        throw new PathPolicyError(`'..' escapes root in path: ${raw}`);
      }
      out.pop();
      continue;
    }
    out.push(part);
  }

  const result = out.join(sep);

  if (result.length === 0) {
    throw new PathPolicyError(`path normalizes to empty: ${raw}`);
  }
  if (nodePath.isAbsolute(result)) {
    throw new PathPolicyError(`path normalizes to absolute: ${raw} → ${result}`);
  }

  return result;
}

/**
 * Reject (or skip, or overwrite) entries that normalize to the same path.
 */
export function checkDuplicate(
  seen: Set<string>,
  normalized: string,
  policy: DupPolicy,
): 'new' | 'skip' | 'overwrite' {
  if (!seen.has(normalized)) {
    seen.add(normalized);
    return 'new';
  }
  if (policy === 'error') {
    throw new DuplicatePathError(`duplicate path: ${normalized}`);
  }
  return policy === 'skip' ? 'skip' : 'overwrite';
}

/**
 * On case-insensitive filesystems, detect case-only collisions.
 * No-op on case-sensitive filesystems.
 */
export function checkCaseCollision(
  seen: Map<string, string>,
  normalized: string,
  caseInsensitive: boolean,
  policy: DupPolicy,
): 'new' | 'skip' | 'overwrite' {
  if (!caseInsensitive) return 'new';

  // A fixed locale keeps case folding deterministic across hosts.
  const folded = normalized.toLocaleLowerCase('en-US');
  const existing = seen.get(folded);
  if (existing === undefined) {
    seen.set(folded, normalized);
    return 'new';
  }
  if (existing === normalized) {
    return 'new';
  }
  if (policy === 'error') {
    throw new CaseCollisionError(existing, normalized);
  }
  return policy === 'skip' ? 'skip' : 'overwrite';
}

export function detectPlatform(): Platform {
  return process.platform === 'win32' ? 'windows' : 'posix';
}
