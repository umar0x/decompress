import type { ArchiveEntry, EntryType } from './types.ts';
import { PluginInvalidEntryError } from './errors.ts';

const SUPPORTED_ENTRY_TYPES: ReadonlySet<EntryType> = new Set<EntryType>([
  'file',
  'directory',
  'symlink',
  'hardlink',
]);

export type ValidateEntryContext = {
  pluginName: string;
  entryIndex: number;
};

/**
 * Validate an unknown record emitted by a plugin and narrow it to an
 * {@link ArchiveEntry}. Throws {@link PluginInvalidEntryError} on any
 * structural violation. Does not mutate the input.
 */
export function validateArchiveEntry(
  raw: unknown,
  ctx: ValidateEntryContext,
): asserts raw is ArchiveEntry {
  const { pluginName, entryIndex } = ctx;

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new PluginInvalidEntryError(
      `plugin ${pluginName} emitted a non-object entry at index ${entryIndex}`,
      { pluginName, entryIndex },
    );
  }

  const entry = raw as Record<string, unknown>;

  if (typeof entry.path !== 'string' || entry.path.length === 0) {
    throw new PluginInvalidEntryError(
      `plugin ${pluginName} emitted an entry with invalid path at index ${entryIndex} (expected non-empty string, got ${describe(entry.path)})`,
      { pluginName, entryIndex },
    );
  }

  if (typeof entry.sourceFormat !== 'string' || entry.sourceFormat.length === 0) {
    throw new PluginInvalidEntryError(
      `plugin ${pluginName} emitted an entry with invalid sourceFormat at index ${entryIndex} (expected non-empty string, got ${describe(entry.sourceFormat)})`,
      { pluginName, entryIndex, entryPath: entry.path },
    );
  }

  if (!SUPPORTED_ENTRY_TYPES.has(entry.type as EntryType)) {
    throw new PluginInvalidEntryError(
      `plugin ${pluginName} emitted an entry with unsupported type ${describe(entry.type)} at index ${entryIndex} (path: ${entry.path})`,
      { pluginName, entryIndex, entryPath: entry.path },
    );
  }

  if (entry.size !== undefined) {
    if (
      typeof entry.size !== 'number' ||
      !Number.isFinite(entry.size) ||
      entry.size < 0 ||
      !Number.isSafeInteger(entry.size)
    ) {
      throw new PluginInvalidEntryError(
        `plugin ${pluginName} emitted an entry with invalid size ${describe(entry.size)} at index ${entryIndex} (path: ${entry.path})`,
        { pluginName, entryIndex, entryPath: entry.path },
      );
    }
  }

  if (entry.mode !== undefined) {
    if (
      typeof entry.mode !== 'number' ||
      !Number.isFinite(entry.mode) ||
      !Number.isInteger(entry.mode) ||
      entry.mode < 0 ||
      entry.mode > 0o17777
    ) {
      throw new PluginInvalidEntryError(
        `plugin ${pluginName} emitted an entry with invalid mode ${describe(entry.mode)} at index ${entryIndex} (path: ${entry.path})`,
        { pluginName, entryIndex, entryPath: entry.path },
      );
    }
  }

  if (entry.mtime !== undefined) {
    if (!(entry.mtime instanceof Date) || !Number.isFinite(entry.mtime.getTime())) {
      throw new PluginInvalidEntryError(
        `plugin ${pluginName} emitted an entry with invalid mtime at index ${entryIndex} (path: ${entry.path})`,
        { pluginName, entryIndex, entryPath: entry.path },
      );
    }
  }

  if (entry.linkTarget !== undefined && typeof entry.linkTarget !== 'string') {
    throw new PluginInvalidEntryError(
      `plugin ${pluginName} emitted an entry with non-string linkTarget at index ${entryIndex} (path: ${entry.path})`,
      { pluginName, entryIndex, entryPath: entry.path },
    );
  }

  const type = entry.type as EntryType;
  if (type === 'symlink' || type === 'hardlink') {
    if (typeof entry.linkTarget !== 'string' || entry.linkTarget.length === 0) {
      throw new PluginInvalidEntryError(
        `plugin ${pluginName} emitted a ${type} entry without a linkTarget at index ${entryIndex} (path: ${entry.path})`,
        { pluginName, entryIndex, entryPath: entry.path },
      );
    }
  }

  if (entry.stream !== undefined && typeof entry.stream !== 'function') {
    throw new PluginInvalidEntryError(
      `plugin ${pluginName} emitted an entry with non-callable stream at index ${entryIndex} (path: ${entry.path})`,
      { pluginName, entryIndex, entryPath: entry.path },
    );
  }

  if (entry.buffer !== undefined && typeof entry.buffer !== 'function') {
    throw new PluginInvalidEntryError(
      `plugin ${pluginName} emitted an entry with non-callable buffer at index ${entryIndex} (path: ${entry.path})`,
      { pluginName, entryIndex, entryPath: entry.path },
    );
  }

  if (entry.metadata !== undefined) {
    if (
      typeof entry.metadata !== 'object' ||
      entry.metadata === null ||
      Array.isArray(entry.metadata)
    ) {
      throw new PluginInvalidEntryError(
        `plugin ${pluginName} emitted an entry with non-object metadata at index ${entryIndex} (path: ${entry.path})`,
        { pluginName, entryIndex, entryPath: entry.path },
      );
    }
  }
}

/**
 * Validate the result of a user supplied `map()` callback. Accepts the
 * `Entry` shape, where `linkTarget` and `mtime` may be `null`.
 */
export function validateMappedEntry(entry: unknown): asserts entry is ArchiveEntry {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new PluginInvalidEntryError('map must return a valid Entry object');
  }
  const e = entry as Record<string, unknown>;
  if (typeof e.path !== 'string' || e.path.length === 0) {
    throw new PluginInvalidEntryError(
      `map returned an entry with invalid path (expected non-empty string, got ${describe(e.path)})`,
    );
  }
  if (!SUPPORTED_ENTRY_TYPES.has(e.type as EntryType)) {
    throw new PluginInvalidEntryError(
      `map returned an entry with unsupported type ${describe(e.type)} (path: ${e.path})`,
    );
  }
  if (e.size !== undefined) {
    if (
      typeof e.size !== 'number' ||
      !Number.isFinite(e.size) ||
      e.size < 0 ||
      !Number.isSafeInteger(e.size)
    ) {
      throw new PluginInvalidEntryError(
        `map returned an entry with invalid size ${describe(e.size)} (path: ${e.path})`,
      );
    }
  }
  if (e.mode !== undefined) {
    if (
      typeof e.mode !== 'number' ||
      !Number.isFinite(e.mode) ||
      !Number.isInteger(e.mode) ||
      e.mode < 0 ||
      e.mode > 0o17777
    ) {
      throw new PluginInvalidEntryError(
        `map returned an entry with invalid mode ${describe(e.mode)} (path: ${e.path})`,
      );
    }
  }
  if (e.linkTarget !== undefined && e.linkTarget !== null && typeof e.linkTarget !== 'string') {
    throw new PluginInvalidEntryError(
      `map returned an entry with non-string linkTarget (path: ${e.path})`,
    );
  }
  if (
    e.mtime !== undefined &&
    e.mtime !== null &&
    (!(e.mtime instanceof Date) || !Number.isFinite((e.mtime as Date).getTime()))
  ) {
    throw new PluginInvalidEntryError(`map returned an entry with invalid mtime (path: ${e.path})`);
  }
}

export function asValidatedEntry(raw: unknown, ctx: ValidateEntryContext): ArchiveEntry {
  validateArchiveEntry(raw, ctx);
  return raw as ArchiveEntry;
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (value === undefined) return 'undefined';
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return 'NaN';
    if (!Number.isFinite(value)) return 'Infinity';
  }
  return typeof value;
}
