# Changelog

All notable changes are documented here. The project follows Keep a Changelog and Semantic
Versioning.

## [1.0.4] - 2026-09-29

A correctness and reliability release. Two real defects are fixed, both found the same week by
adversarial corpus testing and both reproduced with permanent regression tests before the fix
landed. No public type signatures changed.

### Fixed

- Directory entries carrying a mode without execute bits (0644, 0444, 0000 and friends) broke
  extraction. The writer created the directory with the declared mode immediately, so every
  following write below it failed with EACCES, and a directory with no children was left
  silently unusable. Directories are now created 0700 while content is being written and set to
  their sanitized declared mode at the end, after file mtimes and directory mtimes, deepest
  first. This is the same ordering GNU tar has used for decades. Extracting a 60-level tree of
  0644 directories, which hung forever on 1.0.3, now completes in about 94 ms.
- A write that failed mid-entry could deadlock the whole extraction. The TAR parser cannot move
  past an entry whose claimed body was never drained, and the worker pool blocked on it forever:
  the promise never settled and the staging directory leaked. The same shape triggered on real
  write errors such as EFBIG with a small `ulimit -f`. Now every failure after a body claim
  destroys the claimed body, the parser treats a premature body close as a failure instead of
  waiting forever, and the pool settles, cleans up staging, and rethrows the failure that
  actually started the unwind. Environmental errors (EFBIG, EACCES, ENOSPC) keep their errno and
  are never reclassified as archive corruption.
- Truncated archives now surface typed errors. `TRUNCATED_ARCHIVE` existed as a code since 1.0.0
  but nothing threw it; a TAR cut inside an entry body leaked tar-stream's raw
  "Unexpected end of data" as a plain Error. Parser and writer failures are now classified:
  truncation shapes throw `TruncatedArchiveError`, other body failures throw
  `CorruptArchiveError` with the original as `cause`. One nuance is left open on purpose: a TAR
  cut at exactly 50 percent can surface streamx's own `StreamError` (code `STREAM_DESTROYED`)
  depending on which entry the cut lands in. It still fails closed with no output and no staging
  leftover; chasing it further means intercepting streamx internals.
- ZIP archive handles now close through pipeline teardown only, after the write pool settles.
  Closing them when the parser unwound let yauzl destroy lazy entry streams that in-flight
  workers were still reading, which turned unrelated failures into spurious "closed" errors.

### Changed

- Directory modes in the result entries are unchanged; the on-disk result of a successful
  extraction is byte-for-byte what 1.0.3 produced when 1.0.3 succeeded. What changed is that
  non-executable declared modes now produce that result instead of EACCES or a hang, and the
  declared mode is applied after all content exists rather than at creation.
- `gzip` content that decompresses to fewer bytes than a TAR header block is now
  `TruncatedArchiveError` instead of `CorruptArchiveError`. The stream ended before a complete
  header, so truncation is the honest classification.

### Dependencies

- Dev tree updated: `@types/node` 26.6.3, `@types/tar-stream` 3.1.5, `eslint` 10.11.0,
  `prettier` 3.9.9, `tsx` 4.23.15, `typescript-eslint` 8.71.0, root overrides
  `brace-expansion` 5.0.12 and `esbuild` 0.28.2. No runtime dependency changes.
- The `tar-stream` override pinning the dev install to 3.2.0 stays. I re-verified against the
  latest registry state that 3.2.1 still ships a `index.d.ts` that does not compile (it breaks
  the default export), so the pin remains justified. Runtime compatibility with 3.2.1 is
  unaffected.
- TypeScript stays on 5.9. `typescript-eslint` 8.71.0 declares `typescript >=4.8.4 <6.1.0`,
  which excludes the 7.0 line. That is the same situation as 1.0.2.

### Testing and quality

- 334 tests (was 323). New file `regressions-1.0.4.test.ts` pins every fix above, including a
  hand-built TAR header builder for mode-0000 directories (tar-stream's packer normalizes a
  falsy mode to 0755, so 0000 cannot travel through it) and a watchdog-raced pool test that
  fails loudly if a regression ever makes extraction hang again.
- Coverage 92.77 percent lines, 85.14 percent branches, 97.5 percent functions. Per-critical-file
  floors unchanged and passing.
- The internal benchmark runner gained a working tar.bz2 path (bzip2 binary, skipped with a note
  when unavailable) and lost its dead imports.

### Performance

- Hot-path performance is unchanged; the fixes live on failure paths and post-write metadata
  phases. Measured with the same 27-scenario corpus, 5 runs, round-robin, before and after:
  every scenario is within the 10-30 percent run-to-run noise of this 2-vCPU host. The one
  scenario that changed is the tree of 0644 directories, which went from never settling to
  94 ms. Raw data for both runs ships with the release notes.

## [1.0.3] - 2026-09-15

A maintenance and capability release. The big additions are tar.zst (Zstandard-compressed TAR)
support and a consistency fix for `detectedFormats` across the three public APIs. No public
type signatures changed and no security guarantees were relaxed.

### Added

- TAR.ZST (`.tar.zst`, `.tzst`) format support. Zstandard decompression is built into
  `node:zlib` as of Node 22.15 (Stable), so the new `tarzst` plugin reuses the existing
  `tar-common` parser pipeline with no new runtime dependencies. The plugin feature-detects
  at module load: on a Node version without `createZstdDecompress`, the format reports as
  unknown and `parse()` throws a typed error if a caller bypasses detection. The same
  path-policy, link-policy, limits, and atomic-commit guarantees apply unchanged.
- Zstd frame magic (`0x28 0xB5 0x2F 0xFD`, RFC 8478) is now recognized by `detectFormat()`,
  which returns the new `'zst'` value. The builtin format map routes `'zst'` to the
  `tar.zst` plugin.
- Seven integration tests for tar.zst: extract, listArchive, auditArchive, corrupted-zstd
  handling, path-policy traversal rejection, and directory entry semantics.
- Eight regression tests pinning the behaviors fixed in this release (see Fixed).
- Eight limit and cleanup tests exercising every resource ceiling (maxFiles, maxTotalSize,
  maxEntrySize, maxCompressionRatio), parser-failure, abort, and successful-extraction paths.
  Each asserts the staging directory is removed and the output is absent or fully replaced.

### Changed

- `extract()`, `listArchive()`, and `auditArchive()` now report the selected plugin's name
  in `detectedFormats` instead of the raw compression-layer magic. Concretely, a gzip-magic
  archive now reports `'tar.gz'` and a bzip2-magic archive reports `'tar.bz2'`, matching the
  parser's `sourceFormat` field. The previous `'gz'` / `'bz2'` values were inconsistent with
  `sourceFormat` and with the values returned by `auditArchive` and `listArchive` for plugin
  inputs. Consumers that branched on the literal `'gz'` / `'bz2'` value should update to
  `'tar.gz'` / `'tar.bz2'`. No type signature changed.
- `parseArchiveInput` hints now receive `[plugin.name]` consistently across all three public
  APIs. The previous `extract()` path sometimes passed the raw compression magic.

### Fixed

- `atomicExtract` wrapped every `rename` failure in `CrossDeviceRenameError`, including
  `EACCES`, `EIO`, and `ENOTEMPTY`. Only `EXDEV` actually means a filesystem boundary was
  crossed. `EXDEV` continues to surface as `CrossDeviceRenameError` (`ATOMIC_EXDEV`); a
  concurrent-writer `ENOTEMPTY` / `EEXIST` surfaces as `OutputExistsError`
  (`ATOMIC_OUTPUT_EXISTS`); every other rename failure rethrows with its underlying `errno`
  intact instead of being misclassified as a cross-device rename.

### Dependencies

- Dev tooling bumped to latest patch: `@changesets/cli` 3.0.1 → 3.0.3, `@types/node`
  26.4.1 → 26.6.0, `eslint` 10.9.1 → 10.10.0, `typescript-eslint` 8.69.0 → 8.70.0. No
  runtime dependency changes. `npm audit` remains clean.
- The root override pinning `tar-stream` to 3.2.0 is retained because 3.2.1 still ships a
  malformed `index.d.ts` (the `entry` event tuple is missing its opening bracket: `entry:
eader: Header, ...]`). Runtime compatibility with 3.2.1 is unaffected; consumers are
  not constrained by this dev-only override.

### Testing and quality

- 323 tests (was 300). Two new test files: `limits-cleanup.test.ts` (resource-limit and
  staging-cleanup coverage) and `regressions-1.0.3.test.ts` (release-candidate audit). The
  tar.zst integration suite adds 7 more.
- Coverage 92.74 percent lines (was 92.52), 85.67 percent branches (was 84.6), 96.62 percent
  functions (was 96.58). The biggest gains are in `extract.ts` (78.6 → 83.9 percent branches)
  and `secure-writer.ts` (69.7 → 76.2 percent branches), driven by the new limit and
  cleanup tests. Per-critical-file floors are unchanged; `audit.ts` rose from 88.6 to 90.2
  percent lines.
- `npm run test:pack` (clean-tarball ESM/CJS/CLI smoke) still passes; the new tarzst module
  ships in the published `dist/` and is exercised by the smoke installer.

### Performance

- No perf-critical code paths changed in 1.0.3. The same private benchmark suite was rerun
  on identical hardware (2-vCPU Linux, Node 24.19.0, 5-run medians). Measured before/after:

  | Scenario                       | Format | Files | 1.0.2 (ms) | 1.0.3 (ms) |  Delta |
  | ------------------------------ | ------ | ----: | ---------: | ---------: | -----: |
  | tiny zip (1 × 100 B)           | zip    |     1 |        1.2 |        1.6 | +25.4% |
  | small zip (10 × 1 KiB)         | zip    |    10 |        2.7 |        3.1 | +14.3% |
  | medium zip (500 × 4 KiB)       | zip    |   500 |      256.5 |       93.2 | -63.7% |
  | large zip (5000 × 1 KiB)       | zip    |  5000 |     1246.8 |      905.3 | -27.4% |
  | large-file zip (1 × 64 MiB)    | zip    |     1 |       49.8 |       52.7 |  +6.0% |
  | tiny tar (1 × 100 B)           | tar    |     1 |        1.1 |        1.3 | +15.5% |
  | small tar.gz (50 × 1 KiB)      | tar.gz |    50 |        7.5 |        8.1 |  +8.0% |
  | medium tar.gz (500 × 4 KiB)    | tar.gz |   500 |      213.7 |       84.1 | -60.6% |
  | large tar.gz (5000 × 1 KiB)    | tar.gz |  5000 |     1165.6 |      836.1 | -28.3% |
  | large-file tar.gz (1 × 64 MiB) | tar.gz |     1 |      196.7 |      202.9 |  +3.2% |
  | deep-tree tar.gz (depth 40)    | tar.gz |    40 |       39.8 |       13.3 | -66.5% |
  | unicode zip (50 × NFD names)   | zip    |    50 |       23.3 |        7.4 | -68.4% |

  The 2-vCPU runner has 10-30% noise on the small scenarios. No code-level change should
  affect throughput, so the large deltas on medium/large scenarios are dominated by system
  load variance, not by the 1.0.3 code. The point of including the table is honesty: this
  is what was measured. Do not interpret the -60% numbers as a real perf improvement.

### Security

- No behavior was relaxed for the new format. The tar.zst plugin runs through the same
  path-policy, link-policy, resource-limit, and atomic-commit pipeline as tar, tar.gz, and
  tar.bz2. The full adversarial regression matrix (61 crafted and repository fixtures
  including path traversal, symlink chains, hardlink escapes, zip bombs, encrypted and
  malformed archives) passes with zero escapes, zero partial outputs, and zero crashes.
- `npm audit` is clean. No new runtime dependencies were introduced.

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

- 300 tests (was 278): new concurrency suite (output tree identity across concurrency levels,
  ordered callbacks, atomic failure, mtime correctness), dot-segment compatibility suite, and
  legacy adapter unit tests.
- Direct-writer tests now canonicalize the output root with realpath the same way the extractor
  does. macOS and Windows hand out non-canonical temp paths (/var vs /private/var, RUNNER~1 vs
  runneradmin), which made the link policy's realpath comparison reject legitimate in-root link
  targets on those platforms. The canonical-root requirement is now documented on
  WriteContext.realOutputPath and pinned by a regression test that derives the root through a
  symlink alias on every platform.
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
