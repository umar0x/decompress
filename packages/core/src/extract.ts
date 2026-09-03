import { Readable } from 'node:stream';
import type {
  ArchiveEntry,
  ArchiveInput,
  DupPolicy,
  Entry,
  ExtractOptions,
  ExtractResult,
  ParseContext,
  PluginArchiveInput,
  Warning,
} from './types.ts';
import { detectFormat, isEmptyTar } from './detect-format.ts';
import {
  AbortError,
  CompressionRatioExceededError,
  EntrySizeExceededError,
  FileCountExceededError,
  InvalidInputError,
  TotalSizeExceededError,
  UnknownFormatError,
  UserFunctionError,
} from './errors.ts';
import { resolveInput } from './input-utils.ts';
import { selectPlugins } from './plugin-selection.ts';
import { validateArchiveEntry, validateMappedEntry } from './entry-validation.ts';
import { resolveLimits } from './policy/limits-policy.ts';
import { sanitizeMode } from './policy/permission-policy.ts';
import { stripUndefined } from './utils.ts';
import { atomicExtract } from './writer/atomic-extractor.ts';
import type { EntryResult } from './writer/secure-writer.ts';
import {
  checkCaseCollision,
  checkDuplicate,
  detectPlatform,
  normalizePath,
  stripDotSegments,
  validatePath,
} from './writer/path-security.ts';

/**
 * Extract a ZIP, TAR, TAR.GZ, or TAR.BZ2 archive into `output`.
 *
 * Extraction is atomic: a private sibling staging directory is populated and
 * renamed to `output` only after every entry has been written successfully.
 * On any failure (policy violation, I/O error, or abort) the staging tree is
 * removed and `output` is left absent.
 *
 * @param input  Archive source: file path, Buffer, Node stream, Web stream, or async iterable.
 * @param output Destination directory. Must be a non-empty string.
 * @param options Optional extraction policy, limits, callbacks, and plugins.
 * @throws {import('./errors.ts').DecompressError} subclass on any policy/limit/IO failure.
 */
export async function extract(
  input: ArchiveInput,
  output: string,
  options?: ExtractOptions,
): Promise<ExtractResult> {
  validateInput(input);
  if (typeof output !== 'string' || output.trim().length === 0) {
    throw new InvalidInputError('output must be a non-empty string');
  }

  const opts = options ?? {};
  validateOptions(opts);
  const signal = opts.signal;
  const startTime = Date.now();
  if (signal?.aborted) throw new AbortError(signal.reason);

  try {
    return await doExtract(input, output, opts, startTime);
  } catch (error) {
    if (signal?.aborted && !(error instanceof AbortError)) throw new AbortError(signal.reason);
    if (error instanceof Error && error.name === 'AbortError' && !(error instanceof AbortError)) {
      throw new AbortError(signal?.reason);
    }
    throw error;
  }
}

async function doExtract(
  input: ArchiveInput,
  output: string,
  opts: ExtractOptions,
  startTime: number,
): Promise<ExtractResult> {
  const limits = resolveLimits(
    stripUndefined({
      maxArchiveSize: opts.maxArchiveSize,
      maxFiles: opts.maxFiles,
      maxTotalSize: opts.maxTotalSize,
      maxEntrySize: opts.maxEntrySize,
      maxDepth: opts.maxDepth,
      maxCompressionRatio: opts.maxCompressionRatio,
    }),
  );
  const resolved = await resolveInput(input, {
    maxArchiveSize: limits.maxArchiveSize,
    signal: opts.signal,
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
      throw new UnknownFormatError(
        `could not detect archive format (first bytes: ${resolved.peek.subarray(0, 16).toString('hex')})`,
      );
    }
    const plugin = plugins[0]!;
    const detectedFormat = format ?? plugin.name;
    const warnings: Warning[] = [];
    const emitWarning = (warning: Warning) => {
      warnings.push(warning);
      opts.onWarning?.(warning);
    };
    const parseCtx: ParseContext = {
      warn: (code, message, details) => emitWarning({ code, message, details }),
    };
    const pluginInput: PluginArchiveInput = {
      stream: resolved.stream,
      buffer: resolved.buffer,
      filePath: resolved.filePath,
      size: resolved.size,
      hints: [detectedFormat],
      signal: opts.signal ?? new AbortController().signal,
      teardown,
    };

    const platform = detectPlatform();
    const pathCtx = {
      platform,
      caseInsensitive: process.platform === 'win32' || process.platform === 'darwin',
      limits,
    };
    const policy = {
      allowSymlinks: opts.allowSymlinks ?? false,
      allowHardlinks: opts.allowHardlinks ?? false,
      preservePermissions: opts.preservePermissions ?? false,
      overwrite: opts.overwrite ?? false,
      symlinkFallback: opts.symlinkFallback ?? 'error',
    };
    const dupPolicy: DupPolicy = opts.onDuplicate ?? 'error';
    const umask = process.umask();
    const seenPaths = new Set<string>();
    const caseFoldedPaths = new Map<string, string>();
    const overwriteEntryIndices = new Set<number>();
    const metadata: Entry[] = [];
    let rawCount = 0;
    let declaredTotal = 0;

    const processedEntries = (async function* (): AsyncIterable<ArchiveEntry> {
      let entryIndex = 0;
      for await (const raw of plugin.parse(pluginInput, parseCtx)) {
        if (opts.signal?.aborted) throw new AbortError(opts.signal.reason);

        validateArchiveEntry(raw, { pluginName: plugin.name, entryIndex });
        entryIndex++;

        rawCount++;
        if (rawCount > limits.maxFiles) throw new FileCountExceededError(rawCount, limits.maxFiles);
        if (raw.size !== undefined) {
          if (raw.size > limits.maxEntrySize) {
            throw new EntrySizeExceededError(raw.path, raw.size, limits.maxEntrySize);
          }
          declaredTotal = safeAdd(declaredTotal, raw.size, raw.path);
          if (declaredTotal > limits.maxTotalSize) {
            throw new TotalSizeExceededError(declaredTotal, limits.maxTotalSize);
          }
          if (resolved.size > 0 && declaredTotal / resolved.size > limits.maxCompressionRatio) {
            throw new CompressionRatioExceededError(
              declaredTotal / resolved.size,
              limits.maxCompressionRatio,
            );
          }
        }

        // Validate the raw archive path before applying strip so unsafe
        // paths are rejected before any transformation. The stripped result
        // is revalidated after map.
        validatePath(raw.path, pathCtx, raw.path);

        // Dot segments are semantically neutral; the reported path is the
        // normalized landing path so entry.path matches the disk location.
        let strippedPath = stripDotSegments(raw.path);
        if ((opts.strip ?? 0) > 0) {
          strippedPath = stripSegments(strippedPath, opts.strip!);
          if (strippedPath === '') {
            emitWarning({
              code: 'path_strip_collapsed',
              message: `entry dropped by strip: ${raw.path}`,
              entryPath: raw.path,
            });
            continue;
          }
        }

        const preliminary: Entry = {
          path: strippedPath,
          type: raw.type,
          mode: sanitizeMode(raw.mode, raw.type, {
            preservePermissions: policy.preservePermissions,
            umask,
          }),
          mtime: raw.mtime ?? null,
          linkTarget: raw.linkTarget ?? null,
          size: raw.size ?? 0,
          sourceFormat: raw.sourceFormat,
          rawPath: raw.path,
          rawMode: raw.mode ?? 0,
          disposition: 'extracted',
        };

        if (opts.filter) {
          try {
            if (!(await opts.filter(preliminary))) continue;
          } catch (error) {
            throw new UserFunctionError('filter', error);
          }
        }

        let mapped = preliminary;
        if (opts.map) {
          try {
            mapped = await opts.map({ ...preliminary });
          } catch (error) {
            throw new UserFunctionError('map', error);
          }
          validateMappedEntry(mapped);
        }

        validatePath(mapped.path, pathCtx, raw.path);
        const normalized = normalizePath(mapped.path, pathCtx);
        const duplicate = checkDuplicate(seenPaths, normalized, dupPolicy);
        if (duplicate === 'skip') {
          emitWarning({
            code: 'duplicate_skipped',
            message: `duplicate path skipped: ${normalized}`,
            entryPath: raw.path,
          });
          continue;
        }
        const collision = checkCaseCollision(
          caseFoldedPaths,
          normalized,
          pathCtx.caseInsensitive,
          dupPolicy,
        );
        if (collision === 'skip') {
          emitWarning({
            code: 'case_collision_skipped',
            message: `case-colliding path skipped: ${normalized}`,
            entryPath: raw.path,
          });
          continue;
        }

        const index = metadata.length;
        if (duplicate === 'overwrite' || collision === 'overwrite') {
          overwriteEntryIndices.add(index);
        }
        metadata.push({
          ...mapped,
          rawPath: raw.path,
          rawMode: raw.mode ?? 0,
          disposition: mapped.path === strippedPath ? 'extracted' : 'renamed',
        });
        yield {
          path: mapped.path,
          type: mapped.type,
          size: mapped.size,
          mode: mapped.mode,
          mtime: mapped.mtime ?? undefined,
          linkTarget: mapped.linkTarget ?? undefined,
          sourceFormat: mapped.sourceFormat,
          buffer: raw.buffer,
          stream: raw.stream,
          metadata: raw.metadata,
        };
      }
    })();

    const result = await atomicExtract(processedEntries, {
      output,
      limits,
      policy,
      signal: opts.signal,
      concurrency: opts.concurrency,
      perEntryOverwrite: overwriteEntryIndices,
      onEntry: (written, index) => opts.onEntry?.(toEntry(written, metadata[index]!)),
      onWarning: (warning) => {
        warnings.push(warning);
        opts.onWarning?.(warning);
      },
      onProgress: (processed, total, bytes) =>
        opts.onProgress?.({
          entriesProcessed: processed,
          entriesTotal: total,
          bytesProcessed: bytes,
          bytesTotal: null,
        }),
      archiveSize: resolved.size,
    });

    return {
      entries: result.entries.map((written, index) => toEntry(written, metadata[index]!)),
      totalBytes: result.totalBytes,
      warnings,
      output: result.output,
      detectedFormats: [detectedFormat],
      durationMs: Date.now() - startTime,
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

function validateInput(input: unknown): asserts input is ArchiveInput {
  if (input === null || input === undefined) {
    throw new InvalidInputError('input must be a string, Buffer, or readable stream');
  }
  if (typeof input === 'string' || Buffer.isBuffer(input) || input instanceof Readable) return;
  if (typeof input === 'object') {
    if (typeof (input as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === 'function')
      return;
    if (typeof (input as { getReader?: unknown }).getReader === 'function') return;
  }
  throw new InvalidInputError(`unsupported archive input: ${typeof input}`);
}

function validateOptions(opts: ExtractOptions): void {
  validateInteger('strip', opts.strip, 0);
  validateInteger('maxFiles', opts.maxFiles, 0);
  validateInteger('maxDepth', opts.maxDepth, 0);
  validateInteger('concurrency', opts.concurrency, 1, 32);
  if (
    opts.maxCompressionRatio !== undefined &&
    (!Number.isFinite(opts.maxCompressionRatio) || opts.maxCompressionRatio <= 0)
  ) {
    throw new InvalidInputError('maxCompressionRatio must be a positive finite number');
  }
  if (opts.onDuplicate && !['error', 'skip', 'overwrite'].includes(opts.onDuplicate)) {
    throw new InvalidInputError(`invalid onDuplicate policy: ${opts.onDuplicate}`);
  }
  if (opts.symlinkFallback && !['error', 'hardlink', 'skip'].includes(opts.symlinkFallback)) {
    throw new InvalidInputError(`invalid symlinkFallback policy: ${opts.symlinkFallback}`);
  }
}

function validateInteger(
  name: string,
  value: number | undefined,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): void {
  if (value === undefined) return;
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new InvalidInputError(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
}

function safeAdd(a: number, b: number, _entryPath: string): number {
  const sum = a + b;
  if (!Number.isSafeInteger(sum) || sum < 0) {
    throw new TotalSizeExceededError(sum, Number.MAX_SAFE_INTEGER);
  }
  return sum;
}

function stripSegments(path: string, count: number): string {
  const segments = path.split(/[\\/]/);
  return segments.length <= count ? '' : segments.slice(count).join('/');
}

function toEntry(written: EntryResult, metadata: Entry): Entry {
  return {
    ...metadata,
    type: written.kind,
    mode: written.kind === 'file' || written.kind === 'directory' ? written.mode : 0,
    linkTarget: written.kind === 'symlink' || written.kind === 'hardlink' ? written.target : null,
    size: written.kind === 'file' ? written.bytes : 0,
  };
}
