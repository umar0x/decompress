import type { ArchivePlugin } from './types.ts';
import { getBuiltinPlugins } from './plugins/registry.ts';
import { wrapLegacyPlugin } from './plugins/legacy-adapter.ts';
import { LegacyPluginNotEnabledError } from './errors.ts';

export type SelectPluginsOptions = {
  plugins?: ArchivePlugin[];
  legacyPluginUnsafe?: boolean;
  format: string | null;
  peek: Buffer;
};

/**
 * Resolve the list of plugins applicable to the current archive. User
 * plugins take precedence over the built in registry. A plugin's `detect()`
 * is invoked at most once per selection.
 */
export function selectPlugins(opts: SelectPluginsOptions): ArchivePlugin[] {
  const { plugins, legacyPluginUnsafe, format, peek } = opts;

  if (plugins && plugins.length > 0) {
    const resolved = plugins.map((plugin, index) =>
      resolvePlugin(plugin, index, legacyPluginUnsafe),
    );
    const detected = resolved.filter((plugin) => {
      try {
        return plugin.detect?.(peek) === true;
      } catch {
        return false;
      }
    });
    if (detected.length > 0) return detected;
    if (format !== null) {
      const byFormat = resolved.filter((plugin) => plugin.formats.includes(format));
      if (byFormat.length > 0) return byFormat;
    }
    return resolved.length === 1 ? resolved : [];
  }

  if (format === null) return [];
  const pluginName = BUILTIN_FORMAT_MAP[format];
  if (!pluginName) return [];
  return getBuiltinPlugins().filter((plugin) => plugin.name === pluginName);
}

const BUILTIN_FORMAT_MAP: Readonly<Record<string, string>> = Object.freeze({
  zip: 'zip',
  tar: 'tar',
  gz: 'tar.gz',
  bz2: 'tar.bz2',
});

function resolvePlugin(
  plugin: ArchivePlugin | unknown,
  index: number,
  legacyPluginUnsafe?: boolean,
): ArchivePlugin {
  if (
    plugin &&
    typeof plugin === 'object' &&
    'parse' in plugin &&
    typeof (plugin as ArchivePlugin).parse === 'function'
  ) {
    return plugin as ArchivePlugin;
  }

  if (!legacyPluginUnsafe) {
    throw new LegacyPluginNotEnabledError(
      `legacy plugin at index ${index} requires legacyPluginUnsafe: true`,
    );
  }
  return wrapLegacyPlugin(
    `legacy-${index}`,
    plugin as unknown as Parameters<typeof wrapLegacyPlugin>[1],
  );
}
