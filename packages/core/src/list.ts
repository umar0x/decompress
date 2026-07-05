import type {
  ArchiveInput,
  ArchivePlugin,
  Entry,
  ListOptions,
  ParseContext,
  PluginArchiveInput,
  Warning,
} from './types.ts';
import { detectFormat, isEmptyTar } from './detect-format.ts';
import { AbortError, LegacyPluginNotEnabledError, UnknownFormatError } from './errors.ts';
import { resolveInput } from './input-utils.ts';
import { getBuiltinPlugins } from './plugins/registry.ts';
import { wrapLegacyPlugin } from './plugins/legacy-adapter.ts';
import { checkFileCount, resolveLimits } from './policy/limits-policy.ts';
import { sanitizeMode } from './policy/permission-policy.ts';
import { detectPlatform, validatePath } from './writer/path-security.ts';

export async function listArchive(input: ArchiveInput, options?: ListOptions): Promise<Entry[]> {
  const opts = options ?? {};
  if (opts.signal?.aborted) throw new AbortError(opts.signal.reason);
  const limits = resolveLimits({
    maxFiles: opts.maxFiles,
    maxArchiveSize: opts.maxArchiveSize,
  });
  const resolved = await resolveInput(input, {
    maxArchiveSize: limits.maxArchiveSize,
    signal: opts.signal,
  });

  try {
    let format = detectFormat(resolved.peek);
    if (format === null && isEmptyTar(resolved.peek, resolved.size)) format = 'tar';
    const plugins = selectPlugins(opts, format, resolved.peek);
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
    const pathCtx = {
      platform: detectPlatform(),
      caseInsensitive: false,
      limits,
    };
    const umask = process.umask();
    const output: Entry[] = [];
    let count = 0;

    for await (const raw of plugin.parse(pluginInput, parseCtx)) {
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

const formatMap: Record<string, string> = {
  zip: 'zip',
  tar: 'tar',
  gz: 'tar.gz',
  bz2: 'tar.bz2',
};

function selectPlugins(opts: ListOptions, format: string | null, peek: Buffer): ArchivePlugin[] {
  if (opts.plugins && opts.plugins.length > 0) {
    const plugins = opts.plugins.map((plugin, index) => {
      if (typeof plugin === 'function' || !('parse' in plugin)) {
        if (!opts.legacyPluginUnsafe) {
          throw new LegacyPluginNotEnabledError('legacy plugins require legacyPluginUnsafe: true');
        }
        return wrapLegacyPlugin(
          `legacy-${index}`,
          plugin as unknown as Parameters<typeof wrapLegacyPlugin>[1],
        );
      }
      return plugin;
    });
    return plugins.filter((plugin) => plugin.detect?.(peek) === true).length > 0
      ? plugins.filter((plugin) => plugin.detect?.(peek) === true)
      : plugins.length === 1
        ? plugins
        : [];
  }
  if (format === null) return [];
  return getBuiltinPlugins().filter((plugin) => plugin.name === formatMap[format]);
}
