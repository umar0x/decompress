---
'@umar0x/decompress': major
'@umar0x/decompress-compatible': major
'@umar0x/decompress-cli': major
---

First stable release. The native structured API is the recommended product surface and
`@umar0x/decompress-compatible` remains a bounded migration bridge.

Breaking changes:

- Node support floor raised to Node 22. Node 20 is end of life.
- Malformed plugin records fail closed in all three public APIs. `extract`, `listArchive`, and
  `auditArchive` share one structural validator. A plugin emitting `{ path: 42, type: 'file' }`
  now produces a typed `PluginInvalidEntryError` instead of returning a non-string path or
  crashing with a raw `TypeError`.
- Audit numeric fields are always finite safe integers. `totalSize`, `compressionRatio`, and
  `entryCount` are guarded so JSON serialization cannot produce `null`.
- Raw archive paths are validated before `strip`. Previously strip ran first; now the raw archive
  path is validated, then stripped, then revalidated after `map`.
- Removed `PluginCalledFsError` and `UnicodeCollisionError`.
- Compatibility adapter caps in memory content at 256 MiB by default via the new `maxInMemorySize`
  option.

Security:

- `listArchive` rejects structurally invalid plugin records.
- `auditArchive` no longer crashes on malformed records; numeric report fields are finite.
- Documentation accurately describes the `${dest}.old.${uuid}` backup naming.
- Plugin selection centralized; `detect` invoked at most once per plugin.
- Audit loop checks `signal.aborted` inside the parse loop, not only at entry.
