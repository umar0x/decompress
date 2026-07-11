# Changelog

All notable changes are documented here. The project follows Keep a Changelog and Semantic
Versioning.

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
