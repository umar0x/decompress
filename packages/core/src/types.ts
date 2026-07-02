export type EntryType = 'file' | 'directory' | 'symlink' | 'hardlink';

export type Platform = 'posix' | 'windows';

export type DupPolicy = 'error' | 'skip' | 'overwrite';

export type SizeInput = number | string;

/** What plugins emit. Every field is UNTRUSTED; the policy engine revalidates. */
export type ArchiveEntry = {
  path: string;
  type: EntryType;
  size?: number;
  mode?: number;
  mtime?: Date;
  linkTarget?: string;
  sourceFormat: string;
  stream?: () => NodeJS.ReadableStream;
  buffer?: () => Promise<Buffer>;
  metadata?: Record<string, unknown>;
};

/** Post-policy, post-sanitization entry surfaced in ExtractResult. */
export type Entry = {
  path: string;
  type: EntryType;
  mode: number;
  mtime: Date | null;
  linkTarget: string | null;
  size: number;
  sourceFormat: string;
  rawPath: string;
  rawMode: number;
  disposition: 'extracted' | 'skipped' | 'renamed';
};

export type Warning = {
  code: string;
  message: string;
  entryPath?: string;
  rawPath?: string;
  details?: Record<string, unknown>;
};

export type Progress = {
  entriesProcessed: number;
  entriesTotal: number | null;
  bytesProcessed: number;
  bytesTotal: number | null;
};

export type ExtractResult = {
  entries: Entry[];
  totalBytes: number;
  warnings: Warning[];
  output: string;
  detectedFormats: string[];
  durationMs: number;
};

export type AuditFinding = {
  code: string;
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  message: string;
  path?: string;
  details?: Record<string, unknown>;
};

export type AuditReport = {
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  detectedFormats: string[];
  totalSize: number;
  compressionRatio: number;
  entryCount: number;
  findings: AuditFinding[];
  entries: Array<
    Pick<ArchiveEntry, 'path' | 'type' | 'size' | 'mode' | 'linkTarget' | 'sourceFormat'>
  >;
};

export type ExtractOptions = {
  strip?: number;
  filter?: (entry: Entry) => boolean | Promise<boolean>;
  map?: (entry: Entry) => Entry | Promise<Entry>;
  overwrite?: boolean;
  onDuplicate?: DupPolicy;
  allowSymlinks?: boolean;
  allowHardlinks?: boolean;
  symlinkFallback?: 'error' | 'hardlink' | 'skip';
  preservePermissions?: boolean;
  maxArchiveSize?: SizeInput;
  maxFiles?: number;
  maxTotalSize?: SizeInput;
  maxEntrySize?: SizeInput;
  maxDepth?: number;
  maxCompressionRatio?: number;
  signal?: AbortSignal;
  onEntry?: (entry: Entry) => void;
  onWarning?: (warning: Warning) => void;
  onProgress?: (progress: Progress) => void;
  plugins?: ArchivePlugin[];
  legacyPluginUnsafe?: boolean;
};

export type ListOptions = {
  signal?: AbortSignal;
  maxFiles?: number;
  maxArchiveSize?: SizeInput;
  plugins?: ArchivePlugin[];
  legacyPluginUnsafe?: boolean;
  onWarning?: (warning: Warning) => void;
};

export type AuditOptions = {
  signal?: AbortSignal;
  maxFiles?: number;
  maxTotalSize?: SizeInput;
  maxArchiveSize?: SizeInput;
  maxEntrySize?: SizeInput;
  maxDepth?: number;
  maxCompressionRatio?: number;
  allowSymlinks?: boolean;
  allowHardlinks?: boolean;
  plugins?: ArchivePlugin[];
  legacyPluginUnsafe?: boolean;
};

export type ArchiveInput =
  | string
  | Buffer
  | NodeJS.ReadableStream
  | ReadableStream<Uint8Array>
  | AsyncIterable<Buffer | Uint8Array>;

export type ArchivePlugin = {
  name: string;
  formats: readonly string[];
  detect?: (buffer: Buffer) => boolean;
  parse: (input: PluginArchiveInput, ctx: ParseContext) => AsyncIterable<ArchiveEntry>;
};

export type PluginArchiveInput = {
  readonly stream: () => NodeJS.ReadableStream;
  readonly buffer: Buffer | undefined;
  /** File-backed input for parsers that require random access (for example ZIP). */
  readonly filePath?: string;
  readonly size: number | undefined;
  readonly hints: readonly string[];
  readonly signal: AbortSignal;
};

export type ParseContext = {
  warn(code: string, message: string, details?: Record<string, unknown>): void;
};

export type PathCtx = {
  platform: Platform;
  caseInsensitive: boolean;
  limits: Limits;
};

export type Limits = {
  maxArchiveSize: number;
  maxFiles: number;
  maxTotalSize: number;
  maxEntrySize: number;
  maxDepth: number;
  maxCompressionRatio: number;
};

export const DEFAULT_LIMITS: Limits = {
  maxArchiveSize: 512 * 1024 * 1024,
  maxFiles: 10_000,
  maxTotalSize: 2 * 1024 * 1024 * 1024,
  maxEntrySize: 512 * 1024 * 1024,
  maxDepth: 128,
  maxCompressionRatio: 100,
};
