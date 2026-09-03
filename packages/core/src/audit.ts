import nodePath from 'node:path';

import type {
  ArchiveEntry,
  ArchiveInput,
  AuditOptions,
  AuditReport,
  AuditFinding,
  ParseContext,
  PluginArchiveInput,
  Limits,
  PathCtx,
  Warning,
} from './types.ts';
import { resolveInput } from './input-utils.ts';
import { detectFormat, isEmptyTar } from './detect-format.ts';
import { selectPlugins } from './plugin-selection.ts';
import { validateArchiveEntry } from './entry-validation.ts';
import { resolveLimits } from './policy/limits-policy.ts';
import {
  validatePath,
  normalizePath,
  checkDuplicate,
  checkCaseCollision,
  detectPlatform,
  WINDOWS_DEVICE_NAME_REGEX,
  NTFS_ADS_REGEX,
} from './writer/path-security.ts';
import { AbortError, UnknownFormatError, isDecompressError } from './errors.ts';

/**
 * Audit an archive for risk-relevant findings without extracting it.
 *
 * Returns a deterministic, finite, JSON-serializable risk report. Plugin
 * records are structurally validated before any field access, and numeric
 * aggregates are guarded to remain finite safe integers so the report can
 * always be serialized without loss.
 *
 * Audit is not a malware scan and not a safe-to-extract verdict. It reduces
 * risk by surfacing suspicious metadata; callers must still enforce policy
 * at extraction time.
 */
export async function auditArchive(
  input: ArchiveInput,
  options?: AuditOptions,
): Promise<AuditReport> {
  const opts = options ?? {};
  const signal = opts.signal;
  if (signal?.aborted) throw new AbortError(signal);

  const limits = resolveLimits({
    maxFiles: opts.maxFiles,
    maxTotalSize: opts.maxTotalSize,
    maxArchiveSize: opts.maxArchiveSize,
    maxEntrySize: opts.maxEntrySize,
    maxDepth: opts.maxDepth,
    maxCompressionRatio: opts.maxCompressionRatio,
  });
  const resolved = await resolveInput(input, {
    maxArchiveSize: limits.maxArchiveSize,
    signal,
  });
  const teardown: Array<() => void> = [];

  try {
    let format = detectFormat(resolved.peek);
    if (format === null && isEmptyTar(resolved.peek, resolved.size)) format = 'tar';

    const plugins = selectPlugins({
      plugins: opts.plugins,
      legacyPluginUnsafe: opts.legacyPluginUnsafe,
      format,
      peek: resolved.peek,
    });
    if (plugins.length === 0) {
      throw new UnknownFormatError(`no plugin for format: ${format ?? 'unknown'}`);
    }

    // Capture parser warnings as low severity findings so corruption
    // signals from the parser surface in the report.
    const findings: AuditFinding[] = [];
    const warnings: Warning[] = [];
    const parseCtx: ParseContext = {
      warn: (code, message, details) => {
        const warning: Warning = { code, message, details };
        warnings.push(warning);
        findings.push({
          code: code ?? 'parser_warning',
          severity: 'low',
          message,
          details,
        });
      },
    };
    const pluginInput: PluginArchiveInput = {
      stream: resolved.stream,
      buffer: resolved.buffer,
      filePath: resolved.filePath,
      size: resolved.size,
      hints: [format ?? plugins[0]!.name],
      signal: signal ?? new AbortController().signal,
      teardown,
    };

    const entrySummaries: AuditReport['entries'] = [];
    let totalSize = 0;
    let entryCount = 0;
    let totalOverflowed = false;

    const allowSymlinks = opts.allowSymlinks ?? false;
    const allowHardlinks = opts.allowHardlinks ?? false;
    const platform = detectPlatform();
    const pathCtx: PathCtx = {
      platform,
      caseInsensitive: process.platform === 'win32' || process.platform === 'darwin',
      limits,
    };
    const seenPaths = new Set<string>();
    const caseFoldedPaths = new Map<string, string>();

    archiveLoop: for (const plugin of plugins) {
      let entryIndex = 0;
      for await (const raw of plugin.parse(pluginInput, parseCtx)) {
        if (signal?.aborted) throw new AbortError(signal);

        // Validate the record before any field access to prevent raw
        // TypeErrors from malformed plugin output.
        validateArchiveEntry(raw, { pluginName: plugin.name, entryIndex });
        entryIndex++;

        entryCount++;
        if (entryCount > limits.maxFiles) {
          findings.push({
            code: 'excessive_entry_count',
            severity: 'high',
            message: `entry count exceeds maxFiles ${limits.maxFiles}; audit stopped`,
            details: { count: entryCount, limit: limits.maxFiles, truncated: true },
          });
          break archiveLoop;
        }

        // Guard arithmetic so totals stay finite and safe. A plugin record
        // with a huge but valid size must not produce an Infinity total.
        const entrySize = raw.size ?? 0;
        if (!totalOverflowed) {
          const candidate = totalSize + entrySize;
          if (!Number.isSafeInteger(candidate)) {
            totalOverflowed = true;
            findings.push({
              code: 'total_size_overflow',
              severity: 'critical',
              message: `cumulative entry size exceeded safe-integer range; totalSize clamped to maxTotalSize ${limits.maxTotalSize}`,
              details: {
                lastTotal: totalSize,
                attemptedAdd: entrySize,
                limit: limits.maxTotalSize,
              },
            });
            totalSize = Math.min(totalSize, limits.maxTotalSize);
          } else {
            totalSize = candidate;
          }
        }

        const entryFindings = auditEntry(raw, {
          allowSymlinks,
          allowHardlinks,
          limits,
          pathCtx,
          seenPaths,
          caseFoldedPaths,
        });
        findings.push(...entryFindings);

        entrySummaries.push(
          stripUndefined({
            path: raw.path,
            type: raw.type,
            size: raw.size,
            mode: raw.mode,
            linkTarget: raw.linkTarget,
            sourceFormat: raw.sourceFormat,
          }) as AuditReport['entries'][number],
        );
      }
      break;
    }

    if (
      entryCount > limits.maxFiles &&
      !findings.some((finding) => finding.code === 'excessive_entry_count')
    ) {
      findings.push({
        code: 'excessive_entry_count',
        severity: 'high',
        message: `entry count ${entryCount} exceeds maxFiles ${limits.maxFiles}`,
        details: { count: entryCount, limit: limits.maxFiles },
      });
    }
    if (totalSize > limits.maxTotalSize) {
      findings.push({
        code: 'excessive_total_size',
        severity: 'high',
        message: `total size ${totalSize} exceeds maxTotalSize ${limits.maxTotalSize}`,
        details: { total: totalSize, limit: limits.maxTotalSize },
      });
    }

    // Never emit a non-finite compressionRatio. JSON.stringify would turn
    // Infinity or NaN into null and break the report contract.
    const compressionRatio = computeFiniteRatio(totalSize, resolved.size);
    if (resolved.size > 0 && compressionRatio > limits.maxCompressionRatio) {
      findings.push({
        code: 'excessive_compression_ratio',
        severity: 'high',
        message: `compression ratio ${compressionRatio.toFixed(1)} exceeds maxCompressionRatio ${limits.maxCompressionRatio}`,
        details: { ratio: compressionRatio, limit: limits.maxCompressionRatio },
      });
    }

    if (entryCount > 1000) {
      findings.push({
        code: 'high_entry_count',
        severity: 'low',
        message: `archive has ${entryCount} entries (approaching maxFiles ${limits.maxFiles})`,
        details: { count: entryCount, limit: limits.maxFiles },
      });
    }

    const riskLevel = computeRiskLevel(findings);

    return {
      riskLevel,
      detectedFormats: [format ?? plugins[0]!.name],
      totalSize: finiteSafeNumber(totalSize),
      compressionRatio,
      entryCount: finiteSafeNumber(entryCount),
      findings,
      entries: entrySummaries,
    };
  } finally {
    for (const fn of teardown) {
      try {
        fn();
      } catch {
        // Teardown must not mask the primary outcome.
      }
    }
    await resolved.cleanup();
  }
}

type AuditEntryCtx = {
  allowSymlinks: boolean;
  allowHardlinks: boolean;
  limits: Limits;
  pathCtx: PathCtx;
  seenPaths: Set<string>;
  caseFoldedPaths: Map<string, string>;
};

function auditEntry(raw: ArchiveEntry, ctx: AuditEntryCtx): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const p = raw.path;

  // Convert extraction path errors into audit findings.
  try {
    validatePath(p, ctx.pathCtx, p);
  } catch (e) {
    if (isDecompressError(e)) {
      const severity: AuditFinding['severity'] =
        e.code.includes('ABSOLUTE') || e.code.includes('TRAVERSAL') || e.code.includes('UNC')
          ? 'critical'
          : e.code.includes('DEVICE') || e.code.includes('ADS') || e.code.includes('TRAILING')
            ? 'high'
            : 'medium';
      let code = 'path_policy_violation';
      if (e.code.includes('ABSOLUTE')) code = 'absolute_path';
      else if (e.code.includes('UNC')) code = 'windows_unc_path';
      else if (e.code.includes('DRIVE')) code = 'windows_drive_absolute';
      else if (e.code.includes('DEVICE')) code = 'windows_reserved_name';
      else if (e.code.includes('ADS')) code = 'windows_ads_path';
      else if (e.code.includes('TRAILING')) code = 'trailing_dots_spaces';
      else if (e.code.includes('TRAVERSAL') || e.code.includes('SEGMENT')) code = 'path_traversal';
      else if (e.code.includes('NUL')) code = 'path_traversal';
      else if (e.code.includes('DEPTH')) code = 'excessive_depth';
      findings.push({
        code,
        severity,
        message: e.message,
        path: p,
      });
    }
  }

  try {
    const normalized = normalizePath(p, ctx.pathCtx);
    try {
      checkDuplicate(ctx.seenPaths, normalized, 'error');
    } catch {
      findings.push({
        code: 'duplicate_path',
        severity: 'medium',
        message: `duplicate normalized path: ${normalized}`,
        path: p,
      });
    }
    try {
      // Audit for portability to case-insensitive filesystems.
      checkCaseCollision(ctx.caseFoldedPaths, normalized, true, 'error');
    } catch {
      findings.push({
        code: 'case_collision',
        severity: 'medium',
        message: `case collision: ${normalized}`,
        path: p,
      });
    }
  } catch {
    // validatePath already recorded the normalization failure.
  }

  // Record independent Windows indicators even when another path error appears first.
  if (/^[a-zA-Z]:[\\/]/.test(p) || /^[a-zA-Z]:/.test(p)) {
    if (!findings.some((f) => f.code === 'windows_drive_absolute')) {
      findings.push({
        code: 'windows_drive_absolute',
        severity: 'critical',
        message: `Windows drive-absolute path: ${p}`,
        path: p,
      });
    }
  }
  if (/^\\\\/.test(p) || /^\/\//.test(p)) {
    if (!findings.some((f) => f.code === 'windows_unc_path')) {
      findings.push({
        code: 'windows_unc_path',
        severity: 'critical',
        message: `Windows UNC path: ${p}`,
        path: p,
      });
    }
  }
  if (NTFS_ADS_REGEX.test(p)) {
    if (!findings.some((f) => f.code === 'windows_ads_path')) {
      findings.push({
        code: 'windows_ads_path',
        severity: 'high',
        message: `NTFS ADS path: ${p}`,
        path: p,
      });
    }
  }
  for (const seg of p.split(/[\\/]/)) {
    if (WINDOWS_DEVICE_NAME_REGEX.test(seg)) {
      if (!findings.some((f) => f.code === 'windows_reserved_name')) {
        findings.push({
          code: 'windows_reserved_name',
          severity: 'high',
          message: `Windows reserved device name: ${seg} in ${p}`,
          path: p,
        });
      }
    }
  }

  if (raw.type === 'symlink') {
    if (!ctx.allowSymlinks) {
      findings.push({
        code: 'symlink_present',
        severity: 'medium',
        message: `symlink entry present: ${p}`,
        path: p,
      });
    }
    if (raw.linkTarget && linkTargetEscapes(raw.path, raw.linkTarget, 'symlink')) {
      findings.push({
        code: 'symlink_escape',
        severity: 'critical',
        message: `symlink target may escape: ${raw.linkTarget}`,
        path: p,
      });
    }
  }
  if (raw.type === 'hardlink') {
    if (!ctx.allowHardlinks) {
      findings.push({
        code: 'hardlink_present',
        severity: 'medium',
        message: `hardlink entry present: ${p}`,
        path: p,
      });
    }
    if (raw.linkTarget && linkTargetEscapes(raw.path, raw.linkTarget, 'hardlink')) {
      findings.push({
        code: 'hardlink_escape',
        severity: 'critical',
        message: `hardlink target may escape: ${raw.linkTarget}`,
        path: p,
      });
    }
  }

  const mode = raw.mode ?? 0;
  if (mode & 0o4000) {
    findings.push({
      code: 'setuid_bit',
      severity: 'high',
      message: `setuid bit set: ${p} (mode 0o${mode.toString(8)})`,
      path: p,
    });
  }
  if (mode & 0o2000) {
    findings.push({
      code: 'setgid_bit',
      severity: 'high',
      message: `setgid bit set: ${p} (mode 0o${mode.toString(8)})`,
      path: p,
    });
  }
  if (mode & 0o1000) {
    findings.push({
      code: 'sticky_bit',
      severity: 'medium',
      message: `sticky bit set: ${p} (mode 0o${mode.toString(8)})`,
      path: p,
    });
  }

  if (raw.size !== undefined && raw.size > ctx.limits.maxEntrySize) {
    findings.push({
      code: 'excessive_entry_size',
      severity: 'high',
      message: `entry size ${raw.size} exceeds maxEntrySize ${ctx.limits.maxEntrySize}`,
      path: p,
    });
  }

  const depth = p.split(/[\\/]/).length;
  if (depth > ctx.limits.maxDepth) {
    if (!findings.some((f) => f.code === 'excessive_depth')) {
      findings.push({
        code: 'excessive_depth',
        severity: 'medium',
        message: `path depth ${depth} exceeds maxDepth ${ctx.limits.maxDepth}`,
        path: p,
      });
    }
  }

  return findings;
}

function computeRiskLevel(findings: AuditFinding[]): AuditReport['riskLevel'] {
  if (findings.some((f) => f.severity === 'critical')) return 'critical';
  if (findings.some((f) => f.severity === 'high')) return 'high';
  if (findings.some((f) => f.severity === 'medium')) return 'medium';
  return 'low';
}

function linkTargetEscapes(
  entryPath: string,
  target: string,
  kind: 'symlink' | 'hardlink',
): boolean {
  if (
    target.includes('\0') ||
    nodePath.posix.isAbsolute(target) ||
    nodePath.win32.isAbsolute(target)
  ) {
    return true;
  }
  if (/^[a-zA-Z]:/u.test(target) || target.startsWith('\\\\') || target.startsWith('//')) {
    return true;
  }

  const posixEntry = entryPath.replace(/\\/gu, '/');
  const posixTarget = target.replace(/\\/gu, '/');
  const posixBase =
    kind === 'symlink'
      ? nodePath.posix.join('/output', nodePath.posix.dirname(posixEntry))
      : '/output';
  const posixResolved = nodePath.posix.resolve(posixBase, posixTarget);
  const posixRelative = nodePath.posix.relative('/output', posixResolved);
  if (posixRelative === '..' || posixRelative.startsWith('../')) return true;

  const windowsEntry = entryPath.replace(/\//gu, '\\');
  const windowsTarget = target.replace(/\//gu, '\\');
  const windowsRoot = 'C:\\output';
  const windowsBase =
    kind === 'symlink'
      ? nodePath.win32.join(windowsRoot, nodePath.win32.dirname(windowsEntry))
      : windowsRoot;
  const windowsRelative = nodePath.win32.relative(
    windowsRoot,
    nodePath.win32.resolve(windowsBase, windowsTarget),
  );
  return windowsRelative === '..' || windowsRelative.startsWith(`..${nodePath.win32.sep}`);
}

/**
 * Compute a finite compression ratio. Returns 0 when archiveSize is 0 or
 * non-finite, otherwise returns totalSize / archiveSize clamped to a finite
 * safe value.
 */
function computeFiniteRatio(totalSize: number, archiveSize: number): number {
  if (!Number.isFinite(archiveSize) || archiveSize <= 0) return 0;
  if (!Number.isFinite(totalSize) || totalSize < 0) return 0;
  const ratio = totalSize / archiveSize;
  if (!Number.isFinite(ratio)) return Number.MAX_SAFE_INTEGER;
  return ratio;
}

/**
 * Coerce a numeric report field to a finite safe integer. If the input is
 * not finite or out of safe range, returns 0 (the only neutral value for a
 * count/size that cannot be reported precisely).
 */
function finiteSafeNumber(value: number): number {
  if (!Number.isFinite(value) || !Number.isSafeInteger(value)) {
    return Number.isFinite(value) ? Math.trunc(value) : 0;
  }
  return value;
}

/** Remove keys with undefined values (for exactOptionalPropertyTypes compatibility). */
function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    if (obj[key] !== undefined) result[key] = obj[key];
  }
  return result as Partial<T>;
}
