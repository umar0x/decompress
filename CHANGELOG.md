# Changelog

All notable changes are documented here. The project follows Keep a Changelog and Semantic
Versioning.

## [1.0.0] - 2026-07-23

First stable release. The native structured API is the recommended product surface and
`@umar0x/decompress-compatible` remains a bounded migration bridge. The major bump reflects a
deliberate contract and runtime policy change, not a rewrite.

### Breaking changes

- Node support floor raised to Node 22. Node 20 is end of life and is no longer tested or
  supported. CI runs Node 22, 24, and 26 across Linux, macOS, and Windows.
- Malformed plugin records fail closed in all three public APIs. `extract`, `listArchive`, and
  `auditArchive` share one structural validator that runs before any API specific work. A plugin
  that emits a record like `{ path: 42, type: 'file' }` now produces a typed
  `PluginInvalidEntryError` instead of returning a non-string path or crashing with a raw
  `TypeError`.
- Audit numeric fields are always finite safe integers. `totalSize`, `compressionRatio`, and
  `entryCount` are guarded against `Infinity` and `NaN` so JSON serialization cannot produce
  `null`. Overflow produces a typed critical finding (`total_size_overflow`) instead.
- Raw archive paths are validated before `strip`. Previously strip ran first; now the raw archive
  path is validated, then stripped, then revalidated after `map`. This makes the security claim
  that raw archive paths are rejected literally true and rejects archives that hide traversal
  behind stripped components.
- Removed `PluginCalledFsError` and `UnicodeCollisionError`. The former could not be enforced in
  normal Node JavaScript; the latter was never thrown. The corresponding error codes
  (`PLUGIN_FS_ACCESS`, `UNICODE_COLLISION`) are removed from `ErrorCode`.
- Compatibility adapter caps in memory content at 256 MiB by default. A new `maxInMemorySize`
  option bounds the buffered bytes cost of the legacy `data`, `filter`, and `map` callbacks.
  Exceeding it fails closed with `LimitExceededError` and removes the adapter temporary state.

### Added

- `validateArchiveEntry` and `selectPlugins` are now exported as part of the public API so callers
  building higher level extraction tooling can pre validate custom plugin output with the same
  boundary the library uses.
- `PluginInvalidEntryError` now carries `pluginName` and `entryIndex` for precise diagnostics.
- Audit captures parser warnings as low severity findings instead of silently discarding them.
- A dedicated plugin record contract regression suite and a CI job that runs it as a required
  check.
- Benchmark harness now covers zip, tar, and tar.gz across three sizes with peak RSS measurement
  and machine readable JSON output.
- POSIX symlink capability is asserted on the Linux CI runner so link tests cannot silently skip.

### Security

- `listArchive` no longer returns structurally invalid plugin records as typed entries.
- `auditArchive` no longer crashes on malformed plugin records and never emits non finite numeric
  report fields.
- Plugin selection is centralized; `detect` is invoked at most once per plugin.
- Documentation now accurately describes the `${dest}.old.${uuid}` backup naming and the
  `.decompress-tmp-*` staging directory prefix.
- Audit loop checks `signal.aborted` inside the parse loop, not only at entry.

### Changed

- `extract`, `listArchive`, and `auditArchive` share `selectPlugins`, `validateArchiveEntry`, and
  `resolveLimits` to eliminate semantic drift across the three public APIs.
- Audit numeric fields are always finite safe integers, with overflow producing a typed critical
  finding instead of `Infinity` or `NaN`.
- The CI matrix moved from `20, 22, 24` to `22, 24, 26`; release readiness pins Node 24 and adds
  `npm audit signatures` and a symlink capability assertion.
- `docs/architecture.md`, `README.md`, and `MIGRATION.md` updated to match the 1.0.0 contract.

## [0.0.1] - 2026-07-11

### Added

- Native `extract`, `listArchive`, and `auditArchive` APIs for ZIP, TAR, TAR.GZ, and TAR.BZ2.
- Bounded path, buffer, Node stream, Web stream, and async-iterable input support.
- Lazy parser entry/body streams and a streaming secure writer.
- Typed errors, warnings, progress callbacks, cancellation, custom native plugins, and explicit
  legacy-plugin opt-in.
- Six resource ceilings covering input bytes, file count, total output, entry output, depth, and
  compression ratio.
- Atomic whole-directory output and replacement semantics.
- Migration adapter and `extract`, `list`, and `audit` CLI commands.
- Cross-platform CI matrix, coverage gates, dependency audit, CodeQL, provenance publishing, SBOM,
  and clean-tarball consumer smoke tests.

### Security

- Rejects path traversal, absolute/drive/UNC paths, NTFS ADS/device names, invalid Windows names,
  control characters, excessive depth, duplicate normalized paths, and platform case collisions.
- Refuses links by default; validates opted-in link containment and hardlink dependencies.
- Revalidates mapped and plugin-produced records through the central policy/writer pipeline.
- Strips setuid, setgid, and sticky bits and applies safe default modes.
- Uses private staging, symlink-ancestor checks, no-follow/exclusive file creation, complete
  partial-write loops, and cleanup on handled failure/abort.
- Enforces declared-size checks and rolling actual-byte checks while streaming bodies.

### Changed

- The native structured API is the recommended product surface.
- `@umar0x/decompress-compatible` is documented as a transitional adapter rather than universal
  behavioral parity; its content-buffering and replay cost is explicit.
- Runtime dependencies reduced to `yauzl`, `tar-stream`, and `unbzip2-stream`.
