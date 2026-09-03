# Changelog

All notable changes are documented here. The project follows Keep a Changelog and Semantic
Versioning.

## [1.0.2] - 2026-09-03

First stable public release. The native structured API is the recommended product surface and
`@umar0x/decompress-compatible` remains a bounded migration bridge.

Note on version numbers: 1.0.0 and 1.0.1 were published on 2026-07-11 during initial bring-up and
superseded the same day by 0.0.1, the intended baseline. The npm registry does not allow
republishing those slots, so the first stable release is 1.0.2.

### Performance

- ZIP file writes are scheduled through a bounded worker pool. The new `concurrency` option
  (1 to 32, default 8) controls it. TAR-family formats stay sequential because their entry
  bodies are ordered streams. Policy validation still runs on every entry before any write
  begins, and the atomic commit is unchanged.
- Per-file lstat ancestor walks were removed in favor of a cached directory authority plus
  kernel-level O_NOFOLLOW and O_EXCL enforcement. On a 5,000-file ZIP this cut the writer's
  lstat count from 10,052 to 2.
- File and symlink mtimes are applied in bounded parallel batches after content lands, inside
  the private staging tree, so the deferral is not observable before the atomic rename.
- Measured effect on the benchmark corpus (5-run medians, warm): small archives 47 to 72
  percent faster, 60-level deep nesting 80 percent faster, 5,000-file archives 6 to 18 percent
  faster, 8-way concurrent extraction 16 percent faster. Peak RSS is unchanged and stays 10 to
  25 times below the buffered competitors on large single files.

### Compatibility

- Archives containing `./`-prefixed or interior `/./` path segments, the shape produced by
  `tar czf archive.tgz .`, now extract instead of being rejected. Dot segments are stripped
  before validation because they are semantically neutral. Parent traversal, absolute, drive,
  UNC, NTFS ADS, device-name, and duplicate-path rejection behavior is unchanged and covered by
  regression tests.
- File and directory names that merely start with dots (`..foo`) are no longer misjudged as
  parent traversal during ancestor checks.

### Fixed

- A race between the TAR parser's body auto-drain and concurrent writers could produce empty
  files. Writers now claim entry body streams synchronously on receipt. Regression tests
  compare full output trees across concurrency levels.
- The ZIP archive handle could close before a lazily opened entry stream was read. Parser-owned
  handles now close through a pipeline teardown hook that runs after extraction finishes.
- Hardlink overwrite handling and the `..foo` ancestor check described above.

### Dependencies

- Runtime: yauzl ^3.4.0, tar-stream ^3.2.0, unbzip2-stream ^1.4.3.
- Development tree updated to eslint 10.9, typescript-eslint 8.69, @changesets/cli 3, tsx 4.23,
  @types/node 26.4. TypeScript stays on 5.9: the 7.0 line is the native compiler build without
  the JavaScript API that typescript-eslint requires.
- tar-stream 3.2.1 is pinned out of this repository's dev install (root override to 3.2.0)
  because it ships a malformed index.d.ts. Consumers are unaffected; runtime compatibility
  with 3.2.1 is fine.
- `npm audit` is clean (was 3 high findings in the dev tree: brace-expansion and js-yaml
  chains).

### Packaging

- Source maps are no longer published. The package tarball dropped from 133 KB to 51 KB and the
  unpacked size from 598 KB to about 250 KB.

### Testing and quality

- 299 tests (was 278): new concurrency suite (output tree identity across concurrency levels,
  ordered callbacks, atomic failure, mtime correctness), dot-segment compatibility suite, and
  legacy adapter unit tests.
- Coverage 92.5 percent lines, 84.5 percent branches, 96.6 percent functions (was 89.0, 84.5,
  94.3). secure-writer.ts coverage rose from 70.2 to 87.3 percent lines, the legacy adapter
  from 31.8 to 97.6 percent.
- Per-critical-file coverage floors are now enforced from lcov output by
  `scripts/check-coverage-floors.mjs` during `npm run coverage`.
- CLI gained `--concurrency`.

### Security

- No behavior was relaxed for speed. The full adversarial regression matrix (61 crafted and
  repository fixtures including path traversal, symlink chains, hardlink escapes, zip bombs,
  encrypted and malformed archives) passes with zero escapes, zero partial outputs, and zero
  crashes, both before and after the performance work. Opt-in symlink and hardlink extraction
  remains containment-checked.

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
