import type {
  ArchiveInput,
  Entry,
  ListOptions,
  ParseContext,
  PluginArchiveInput,
  Warning,
  Limits,
  PathCtx,
} from './types.ts';
import { detectFormat, isEmptyTar } from './detect-format.ts';
import { AbortError, UnknownFormatError } from './errors.ts';
import { resolveInput } from './input-utils.ts';
import { selectPlugins } from './plugin-selection.ts';
import { validateArchiveEntry } from './entry-validation.ts';
import { checkFileCount, resolveLimits } from './policy/limits-policy.ts';
import { sanitizeMode } from './policy/permission-policy.ts';
import { detectPlatform, validatePath } from './writer/path-security.ts';

/**
 * List the entries of an archive without writing anything to disk.
 *
 * Plugin records are structurally validated before projection so the
 * returned entries always carry typed fields. Path-policy violations are
 * reported through `onWarning` rather than thrown, since listing returns
 * archive facts, including unsafe ones, and is not extraction approval.
 */
export async function listArchive(input: ArchiveInput, options?: ListOptions): Promise<Entry[]> {
  const opts = options ?? {};
  if (opts.signal?.aborted) throw new AbortError(opts.signal.reason);
  const limits = resolveListLimits(opts);
  const resolved = await resolveInput(input, {
    maxArchiveSize: limits.maxArchiveSize,
    signal: opts.signal,
  });

  try {
    let format = detectFormat(resolved.peek);
    if (format === null && isEmptyTar(resolved.peek, resolved.size)) format = 'tar';
    const plugins = selectPlugins({
      plugins: opts.plugins,
      legacyPluginUnsafe: opts.legacyPluginUnsafe,
      format,
      peek: resolved.peek,
    });
    if (plugins.length === 0) throw new UnknownFormatError('could not detect archive format');
    const plugin = plugins[0]!;
    const warnings: Warning[] = [];
    const warn = (warning: Warning) => {
      warnings.push(warning);
      opts.onWarning?.(warning);
    };
    const parseCtx: ParseContext = {
      warn: (code, message, details) => warn({ code, message, details }),
    };
    const pluginInput: PluginArchiveInput = {
      stream: resolved.stream,
      buffer: resolved.buffer,
      filePath: resolved.filePath,
      size: resolved.size,
      hints: format ? [format] : [plugin.name],
      signal: opts.signal ?? new AbortController().signal,
    };
    const pathCtx: PathCtx = {
      platform: detectPlatform(),
      caseInsensitive: false,
      limits,
    };
    const umask = process.umask();
    const output: Entry[] = [];
    let count = 0;

    for await (const raw of plugin.parse(pluginInput, parseCtx)) {
      if (opts.signal?.aborted) throw new AbortError(opts.signal.reason);

      validateArchiveEntry(raw, { pluginName: plugin.name, entryIndex: count });

      count++;
      checkFileCount(count, limits);
      try {
        validatePath(raw.path, pathCtx, raw.path);
      } catch (error) {
        warn({
          code: 'unsafe_path',
          message: (error as Error).message,
          entryPath: raw.path,
          rawPath: raw.path,
        });
      }
      output.push({
        path: raw.path,
        type: raw.type,
        mode: sanitizeMode(raw.mode, raw.type, { preservePermissions: false, umask }),
        mtime: raw.mtime ?? null,
        linkTarget: raw.linkTarget ?? null,
        size: raw.size ?? 0,
        sourceFormat: raw.sourceFormat,
        rawPath: raw.path,
        rawMode: raw.mode ?? 0,
        disposition: 'extracted',
      });
    }
    return output;
  } finally {
    await resolved.cleanup();
  }
}

function resolveListLimits(opts: ListOptions): Limits {
  return resolveLimits({
    maxFiles: opts.maxFiles,
    maxArchiveSize: opts.maxArchiveSize,
  });
}
