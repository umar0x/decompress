export const ErrorCode = {
  InvalidInput: 'INVALID_INPUT',
  ArchiveNotFound: 'ARCHIVE_NOT_FOUND',
  UnknownFormat: 'UNKNOWN_FORMAT',
  CorruptArchive: 'CORRUPT_ARCHIVE',
  TruncatedArchive: 'TRUNCATED_ARCHIVE',
  PathPolicy: 'PATH_POLICY_VIOLATION',
  PathTraversal: 'PATH_TRAVERSAL',
  WindowsPath: 'PATH_WINDOWS',
  AbsolutePath: 'PATH_ABSOLUTE',
  NulByte: 'PATH_NUL_BYTE',
  WindowsDevice: 'PATH_WINDOWS_DEVICE',
  WindowsAds: 'PATH_WINDOWS_ADS',
  WindowsTrailingDots: 'PATH_WINDOWS_TRAILING_DOTS',
  DuplicatePath: 'DUPLICATE_PATH',
  CaseCollision: 'CASE_COLLISION',
  LinkPolicy: 'LINK_POLICY_VIOLATION',
  LinkEscape: 'LINK_ESCAPE',
  SymlinkRefused: 'LINK_SYMLINK_REFUSED',
  HardlinkRefused: 'LINK_HARDLINK_REFUSED',
  LinkThroughSymlink: 'LINK_THROUGH_SYMLINK',
  HardlinkTargetMissing: 'HARDLINK_TARGET_MISSING',
  PermissionPolicy: 'PERMISSION_POLICY_VIOLATION',
  LimitExceeded: 'LIMIT_EXCEEDED',
  ArchiveSizeExceeded: 'LIMIT_ARCHIVE_SIZE',
  FileCountExceeded: 'LIMIT_FILE_COUNT',
  TotalSizeExceeded: 'LIMIT_TOTAL_SIZE',
  EntrySizeExceeded: 'LIMIT_ENTRY_SIZE',
  DepthExceeded: 'LIMIT_DEPTH',
  CompressionRatioExceeded: 'LIMIT_COMPRESSION_RATIO',
  Atomicity: 'ATOMICITY',
  OutputExists: 'ATOMIC_OUTPUT_EXISTS',
  OutputIsSymlink: 'ATOMIC_OUTPUT_IS_SYMLINK',
  OutputIsFile: 'ATOMIC_OUTPUT_IS_FILE',
  TempDirCleanup: 'ATOMIC_CLEANUP_FAILED',
  CrossDeviceRename: 'ATOMIC_EXDEV',
  Abort: 'ABORTED',
  Plugin: 'PLUGIN_ERROR',
  PluginInvalidEntry: 'PLUGIN_INVALID_ENTRY',
  LegacyPluginNotEnabled: 'LEGACY_PLUGIN_NOT_ENABLED',
  UnsupportedFormat: 'UNSUPPORTED_FORMAT',
  UserFunction: 'USER_FUNCTION_ERROR',
  NotADirectory: 'NOT_A_DIRECTORY',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export class DecompressError extends Error {
  readonly code: string = ErrorCode.InvalidInput;
  readonly isDecompressError = true as const;
  readonly entryPath?: string;
  readonly entryIndex?: number;
  override readonly cause?: unknown;
  readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    opts?: {
      entryPath?: string;
      entryIndex?: number;
      cause?: unknown;
      details?: Record<string, unknown>;
    },
  ) {
    super(message);
    this.name = this.constructor.name;
    if (opts) {
      // Use Object.assign to avoid exactOptionalPropertyTypes errors when
      // assigning undefined to optional properties.
      const filtered: Record<string, unknown> = {};
      if (opts.entryPath !== undefined) filtered.entryPath = opts.entryPath;
      if (opts.entryIndex !== undefined) filtered.entryIndex = opts.entryIndex;
      if (opts.cause !== undefined) filtered.cause = opts.cause;
      if (opts.details !== undefined) filtered.details = opts.details;
      Object.assign(this, filtered);
    }
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      entryPath: this.entryPath,
      entryIndex: this.entryIndex,
      cause:
        this.cause instanceof Error
          ? { name: this.cause.name, message: this.cause.message }
          : this.cause,
      details: this.details,
    };
  }
}

// Input errors
export class InvalidInputError extends DecompressError {
  override readonly code: string = ErrorCode.InvalidInput;
}
export class ArchiveNotFoundError extends DecompressError {
  override readonly code: string = ErrorCode.ArchiveNotFound;
}

// Format errors
export class UnknownFormatError extends DecompressError {
  override readonly code: string = ErrorCode.UnknownFormat;
}
export class CorruptArchiveError extends DecompressError {
  override readonly code: string = ErrorCode.CorruptArchive;
}
export class TruncatedArchiveError extends DecompressError {
  override readonly code: string = ErrorCode.TruncatedArchive;
}
export class UnsupportedFormatError extends DecompressError {
  override readonly code: string = ErrorCode.UnsupportedFormat;
}

// Path errors
export class PathPolicyError extends DecompressError {
  override readonly code: string = ErrorCode.PathPolicy;
}
export class PathTraversalError extends PathPolicyError {
  override readonly code: string = ErrorCode.PathTraversal;
}
export class AbsolutePathError extends PathPolicyError {
  override readonly code: string = ErrorCode.AbsolutePath;
  readonly kind: 'posix' | 'windows-drive' | 'windows-unc';
  constructor(
    raw: string,
    kind: 'posix' | 'windows-drive' | 'windows-unc',
    opts?: { entryPath?: string },
  ) {
    super(`absolute path rejected (${kind}): ${raw}`, opts);
    this.kind = kind;
  }
}
export class NulByteError extends PathPolicyError {
  override readonly code: string = ErrorCode.NulByte;
}
export class WindowsDeviceNameError extends PathPolicyError {
  override readonly code: string = ErrorCode.WindowsDevice;
  readonly segment: string;
  constructor(raw: string, segment: string, opts?: { entryPath?: string }) {
    super(`Windows reserved device name "${segment}" in path: ${raw}`, opts);
    this.segment = segment;
  }
}
export class WindowsAdsError extends PathPolicyError {
  override readonly code: string = ErrorCode.WindowsAds;
}
export class WindowsTrailingDotsError extends PathPolicyError {
  override readonly code: string = ErrorCode.WindowsTrailingDots;
  readonly segment: string;
  constructor(raw: string, segment: string, opts?: { entryPath?: string }) {
    super(`trailing dots/spaces in segment "${segment}" of path: ${raw}`, opts);
    this.segment = segment;
  }
}
export class DuplicatePathError extends PathPolicyError {
  override readonly code: string = ErrorCode.DuplicatePath;
}
export class CaseCollisionError extends PathPolicyError {
  override readonly code: string = ErrorCode.CaseCollision;
  readonly existing: string;
  constructor(existing: string, normalized: string, opts?: { entryPath?: string }) {
    super(`case collision: "${normalized}" conflicts with existing "${existing}"`, opts);
    this.existing = existing;
  }
}

// Link errors
export class LinkPolicyError extends DecompressError {
  override readonly code: string = ErrorCode.LinkPolicy;
}
export class LinkEscapeError extends LinkPolicyError {
  override readonly code: string = ErrorCode.LinkEscape;
  readonly kind: 'symlink' | 'hardlink';
  readonly linkname: string;
  readonly resolved: string;
  constructor(entryPath: string, kind: 'symlink' | 'hardlink', linkname: string, resolved: string) {
    super(`${kind} target escapes output: "${linkname}" -> ${resolved}`, { entryPath });
    this.kind = kind;
    this.linkname = linkname;
    this.resolved = resolved;
  }
}
export class SymlinkRefusedError extends LinkPolicyError {
  override readonly code: string = ErrorCode.SymlinkRefused;
}
export class HardlinkRefusedError extends LinkPolicyError {
  override readonly code: string = ErrorCode.HardlinkRefused;
}
export class LinkThroughSymlinkError extends LinkPolicyError {
  override readonly code: string = ErrorCode.LinkThroughSymlink;
}
export class HardlinkTargetMissingError extends LinkPolicyError {
  override readonly code: string = ErrorCode.HardlinkTargetMissing;
}

// Permission errors
export class PermissionPolicyError extends DecompressError {
  override readonly code: string = ErrorCode.PermissionPolicy;
}

// Resource limit errors
export class LimitExceededError extends DecompressError {
  override readonly code: string = ErrorCode.LimitExceeded;
  readonly limit: string;
  readonly value: number;
  readonly threshold: number;
  constructor(limit: string, value: number, threshold: number, message?: string) {
    super(message ?? `limit ${limit} exceeded: ${value} > ${threshold}`);
    this.limit = limit;
    this.value = value;
    this.threshold = threshold;
  }
}
export class ArchiveSizeExceededError extends LimitExceededError {
  override readonly code: string = ErrorCode.ArchiveSizeExceeded;
  constructor(value: number, threshold: number) {
    super(
      'maxArchiveSize',
      value,
      threshold,
      `archive size ${value} exceeds maxArchiveSize ${threshold}`,
    );
  }
}
export class FileCountExceededError extends LimitExceededError {
  override readonly code: string = ErrorCode.FileCountExceeded;
  constructor(value: number, threshold: number) {
    super('maxFiles', value, threshold, `entry count ${value} exceeds maxFiles ${threshold}`);
  }
}
export class TotalSizeExceededError extends LimitExceededError {
  override readonly code: string = ErrorCode.TotalSizeExceeded;
  constructor(value: number, threshold: number) {
    super(
      'maxTotalSize',
      value,
      threshold,
      `total size ${value} exceeds maxTotalSize ${threshold}`,
    );
  }
}
export class EntrySizeExceededError extends LimitExceededError {
  override readonly code: string = ErrorCode.EntrySizeExceeded;
  constructor(entryPath: string, value: number, threshold: number) {
    super(
      'maxEntrySize',
      value,
      threshold,
      `entry "${entryPath}" size ${value} exceeds maxEntrySize ${threshold}`,
    );
  }
}
export class DepthExceededError extends LimitExceededError {
  override readonly code: string = ErrorCode.DepthExceeded;
  constructor(entryPath: string, value: number, threshold: number) {
    super(
      'maxDepth',
      value,
      threshold,
      `entry "${entryPath}" depth ${value} exceeds maxDepth ${threshold}`,
    );
  }
}
export class CompressionRatioExceededError extends LimitExceededError {
  override readonly code: string = ErrorCode.CompressionRatioExceeded;
  constructor(value: number, threshold: number) {
    super(
      'maxCompressionRatio',
      value,
      threshold,
      `compression ratio ${value} exceeds maxCompressionRatio ${threshold}`,
    );
  }
}

// Output errors
export class AtomicityError extends DecompressError {
  override readonly code: string = ErrorCode.Atomicity;
}
export class OutputExistsError extends AtomicityError {
  override readonly code: string = ErrorCode.OutputExists;
}
export class OutputIsSymlinkError extends AtomicityError {
  override readonly code: string = ErrorCode.OutputIsSymlink;
}
export class OutputIsFileError extends AtomicityError {
  override readonly code: string = ErrorCode.OutputIsFile;
}
export class TempDirCleanupError extends AtomicityError {
  override readonly code: string = ErrorCode.TempDirCleanup;
}
export class CrossDeviceRenameError extends AtomicityError {
  override readonly code: string = ErrorCode.CrossDeviceRename;
}

// Cancellation errors
export class AbortError extends DecompressError {
  override readonly code: string = ErrorCode.Abort;
  constructor(cause?: unknown) {
    super('extraction aborted', cause !== undefined ? { cause } : undefined);
    this.name = 'AbortError';
  }
}

// Plugin errors
export class PluginError extends DecompressError {
  override readonly code: string = ErrorCode.Plugin;
  readonly pluginName?: string;
  constructor(
    message: string,
    opts?: { pluginName?: string; cause?: unknown; entryPath?: string; entryIndex?: number },
  ) {
    super(message, {
      cause: opts?.cause,
      entryPath: opts?.entryPath,
      entryIndex: opts?.entryIndex,
    });
    if (opts?.pluginName !== undefined) this.pluginName = opts.pluginName;
  }
}
export class PluginInvalidEntryError extends PluginError {
  override readonly code: string = ErrorCode.PluginInvalidEntry;
  constructor(
    message: string,
    opts?: { pluginName?: string; cause?: unknown; entryPath?: string; entryIndex?: number },
  ) {
    super(message, opts);
  }
}
export class LegacyPluginNotEnabledError extends DecompressError {
  override readonly code: string = ErrorCode.LegacyPluginNotEnabled;
}

// Callback errors
export class UserFunctionError extends DecompressError {
  override readonly code: string = ErrorCode.UserFunction;
  readonly fn: string;
  constructor(fn: 'filter' | 'map', cause: unknown) {
    super(`${fn} function threw`, { cause });
    this.fn = fn;
  }
}

// Filesystem errors
export class NotADirectoryError extends DecompressError {
  override readonly code: string = ErrorCode.NotADirectory;
}

export function isDecompressError(e: unknown): e is DecompressError {
  return (
    e instanceof DecompressError ||
    (e instanceof Error && (e as DecompressError).isDecompressError === true)
  );
}
