# @umar0x/decompress

[![npm version](https://img.shields.io/npm/v/@umar0x/decompress.svg?style=flat-square)](https://www.npmjs.com/package/@umar0x/decompress)
[![npm downloads](https://img.shields.io/npm/dm/@umar0x/decompress.svg?style=flat-square)](https://www.npmjs.com/package/@umar0x/decompress)
[![CI](https://img.shields.io/github/actions/workflow/status/umar0x/decompress/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/umar0x/decompress/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A522-green.svg?style=flat-square)](https://nodejs.org/en/about/previous-releases)

Secure, fast archive extraction for Node.js 22+. ZIP, TAR, TAR.GZ, TAR.BZ2, and TAR.ZST,
with parallel bzip2 decoding, ESM and CommonJS builds, and a zero-runtime-dependency install:
one package, no transitive tree.

I built this because the two packages most of the ecosystem still relies on for archive
extraction are either unmaintained or carry a lineage of extraction vulnerabilities, and I wanted
a default that survives hostile input. Every default here is chosen for that case: untrusted
archives, safe by construction, with limits you can tune.

`decompress` (the original) has no fix available for CVE-2026-53486 (path traversal via link
targets, CVSS 9.1); `@xhmikosr/decompress` patched it in 11.1.3. Neither caps archive size, entry
count, or expansion ratio, and both report success with zero extracted files on formats they do
not recognize. This library treats those shapes as typed errors.

The native `@umar0x/decompress` API is the product. `@umar0x/decompress-compatible` exists as a
migration bridge for code that cannot change its call shape yet.

## Install

```sh
npm install @umar0x/decompress

# Optional migration adapter
npm install @umar0x/decompress-compatible

# Optional CLI
npm install --global @umar0x/decompress-cli
```

## Native API

```ts
import { extract } from '@umar0x/decompress';

const controller = new AbortController();
const result = await extract('archive.zip', 'dist', {
  strip: 1,
  overwrite: false,
  allowSymlinks: false,
  allowHardlinks: false,
  concurrency: 8,
  maxFiles: 10_000,
  maxTotalSize: '2gb',
  signal: controller.signal,
  onEntry(entry) {
    console.log(entry.path, entry.size);
  },
  onWarning(warning) {
    console.warn(warning.code, warning.message);
  },
});

console.log(result.output, result.entries.length, result.totalBytes, result.warnings);
```

`extract()` accepts a path, `Buffer`, Node readable stream, Web `ReadableStream`, or async
iterable. Path inputs stay file-backed. One-shot stream inputs are copied to a private,
size-bounded temporary file so ZIP random access is safe and input is never buffered without a
limit. File bodies are streamed to the secure writer.

`concurrency` (1 to 32, default 8) bounds how many entries are written in parallel. It applies to
ZIP; TAR-family formats are sequential because their entry bodies are ordered streams. All policy
validation happens before any write, and the output commit stays atomic, so it only changes
write scheduling.

### Other APIs

```ts
import { auditArchive, listArchive } from '@umar0x/decompress';

const entries = await listArchive('archive.tar.gz', {
  onWarning: (warning) => console.warn(warning),
});

const report = await auditArchive('archive.zip', {
  maxFiles: 5_000,
  maxTotalSize: '1gb',
});
```

- `listArchive()` returns metadata and drains file bodies without writing them. Unsafe paths are
  returned as archive facts and reported through `onWarning`; listing is not extraction approval.
- `auditArchive()` returns findings and a risk level without writing output. Audit reduces risk
  but cannot prove an archive harmless.

## Security model

Every entry, including entries emitted by plugins and transformed by `map`, passes through the
same structural validator and the same policy and writer pipeline. The enforced properties:

| Area        | Enforced behavior                                                                                                                                                                                                                                                                                |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Paths       | Reject empty/NUL, absolute, drive/UNC, traversal, NTFS ADS, device names, trailing dots/spaces, invalid Windows characters, excessive depth. `./` and `/./` segments are semantically neutral and normalized away. Raw archive paths are validated before `strip` and again after `strip`/`map`. |
| Identity    | NFC normalization, duplicate detection, case-collision detection on case-insensitive systems, post-map validation                                                                                                                                                                                |
| Links       | Symlinks and hardlinks refused by default; opted-in targets are containment checked; hardlinks are dependency ordered                                                                                                                                                                            |
| Writes      | Private staging directory, no-follow/exclusive file creation, ancestor checks, partial-write loops, safe default modes                                                                                                                                                                           |
| Permissions | Setuid, setgid, and sticky bits are always stripped; archive modes are optional                                                                                                                                                                                                                  |
| Resources   | Maximum archive bytes, entries, total output bytes, entry bytes, path depth, and compression ratio                                                                                                                                                                                               |
| Failure     | Abort-aware cleanup and commit-time rename; a new output is absent on extraction failure                                                                                                                                                                                                         |
| Formats     | Unsupported entry types, encrypted ZIP entries, and corrupt input fail with typed errors                                                                                                                                                                                                         |
| Plugins     | Plugin records are structurally validated before all public API processing. Legacy plugins require `legacyPluginUnsafe: true`.                                                                                                                                                                   |
| Audit       | Numeric report fields are always finite, JSON-serializable safe integers.                                                                                                                                                                                                                        |

Default limits are 512 MiB archive input, 10,000 entries, 2 GiB total output, 512 MiB per entry,
128 path segments, and a 100:1 compression ratio. The compatibility adapter caps in-memory
buffered content at 256 MiB by default (`maxInMemorySize`). Choose lower, workload-specific
limits when processing untrusted uploads.

Third-party plugins are normal JavaScript running in your process. The plugin interface does not
hand them an output path or writer, but it is not a sandbox and cannot prevent a malicious package
from importing `node:fs` or using the network. Treat plugins as trusted code; their emitted
records are untrusted data and are revalidated uniformly across all public APIs.

See [the threat model](./docs/threat-model.md), [architecture](./docs/architecture.md), and
[security policy](./SECURITY.md).

## Atomic output semantics

Extraction happens in a private sibling staging directory and commits by rename only after all
entries and directory metadata succeed. With the default `overwrite: false`, an existing non-empty
output is rejected. With `overwrite: true`, the whole output directory is replaced, not merged.
Cross-device commit fallback is intentionally rejected because it would weaken atomicity.

## Compatibility adapter

```diff
- const decompress = require('decompress');
+ const decompress = require('@umar0x/decompress-compatible');
```

The adapter preserves the common `decompress(input, output?, options?)` call shape and returns
entries with `data` buffers. It deliberately keeps compatibility processing in memory and will use
more memory than the native API. Legacy plugins require an explicit unsafe opt-in. New code should
use the native API. See [MIGRATION.md](./MIGRATION.md) for differences.

## CLI

```sh
decompress extract archive.zip dist --strip 1 --max-files 10000 --concurrency 8
decompress list archive.zip --pretty
decompress audit archive.zip --pretty
```

Exit codes are `0` for success, `1` for an extraction/policy error or a high/critical audit,
`2` for usage errors, and `130` for SIGINT.

## Performance

Measured on a 2-vCPU Linux host, Node 24, one corpus built once and shared by all three
libraries, five timed runs per scenario per library in one clean session, all three libraries
executed back to back (warm medians below; per-run raw data with medians, standard deviation,
min, and max is preserved alongside each release):

| Scenario (warm median)              | this library | decompress 4.2.1 | @xhmikosr/decompress 11.1.4 |
| ----------------------------------- | -----------: | ---------------: | --------------------------: |
| ZIP, 10,000 small files             |       2.92 s |          11.06 s |                      4.59 s |
| TAR.GZ, 10,000 small files          |       2.23 s |          12.24 s |                      3.73 s |
| TAR.BZ2, 10,000 small files         |       3.15 s |          12.68 s |                      4.23 s |
| ZIP, 1 x 64 MiB (deflate)           |       183 ms |           222 ms |                      279 ms |
| TAR.BZ2, 1 x 64 MiB                 |       2.59 s |           2.96 s |                      3.06 s |
| 64-level nested tree                |        24 ms |           859 ms |                      232 ms |
| Unicode names, 200 files            |        73 ms |           161 ms |                       80 ms |
| npm-package-shaped TAR (1054 files) |       230 ms |          1017 ms |                      246 ms |
| TAR, 1 x 64 MiB (uncompressed)      |        69 ms |           183 ms |                       91 ms |
| Peak RSS, 64 MiB single-file TAR    |       81 MiB |          183 MiB |                      91 MiB |
| Peak RSS, 10,000-file TAR.GZ        |      136 MiB |          397 MiB |                     286 MiB |

Versus 1.0.5 itself: single-large-file bzip2 drops 41 percent (the new parallel block decoder),
deep-tree extraction drops 26 percent, and peak memory on many-small-file bzip2 drops 32 percent;
other scenarios are within this host's run-to-run noise. Install weight drops from 7256 KB across
20 packages to 732 KB in one package.

`decompress` and `@xhmikosr/decompress` report success with zero extracted files on formats they
do not support (XZ, Zstandard): every plugin declines the magic bytes and the concatenated
result is an empty success. This library reports a typed `UnknownFormatError` instead. Under a
3 GiB zip bomb both competitors die on an out-of-memory heap; this library rejects the archive by
the default total-size limit. `decompress` 4.2.1 remains unpatched for CVE-2026-53486 (path
traversal via link targets); during this release's adversarial testing its prefix-based
containment was defeated live by a symlink planted next to a sibling directory, writing a file
outside the output. `@xhmikosr/decompress` patched that class in 11.1.3.

A 60-level tree of 0644-mode directories is worth calling out because it is a 1.0.4 fix: on
1.0.3 that archive never finished extracting at all. A 1.0.5 fix in the same family: a
truncated gzip, zstd, or bzip2 TAR now settles `extract()` with a typed
`TruncatedArchiveError` where 1.0.4 could leave the promise unsettled forever. A 1.0.6 fix in
the same family: an archive rejected for exceeding `maxDepth` no longer leaves its staging
directory behind (the cleanup walk previously stopped at 64 levels while the tree could be 128
deep).

## Formats and dependencies

| Format  | Detection                   | Parser                                                                                |
| ------- | --------------------------- | ------------------------------------------------------------------------------------- |
| ZIP     | `PK` signatures             | `yauzl`                                                                               |
| TAR     | `ustar` header              | `tar-stream`                                                                          |
| TAR.GZ  | gzip signature              | `node:zlib` + `tar-stream`                                                            |
| TAR.BZ2 | `BZh` signature             | parallel block decode (`seek-bzip` workers) with sequential `unbzip2-stream` fallback |
| TAR.ZST | Zstd frame magic (RFC 8478) | `node:zlib` (`createZstdDecompress`) + `tar-stream`                                   |

The parsers are bundled into the published artifact: installing `@umar0x/decompress` adds one
package and no transitive dependencies (732 KB installed, versus 2.4 MB across 38 packages for
`@xhmikosr/decompress` and 3.9 MB across 77 packages for `decompress`). TAR.ZST relies on
`node:zlib.createZstdDecompress`, which is Stable as of Node 22.15; on older runtimes the
format reports as unknown and surfaces a typed runtime error if a caller bypasses detection.
Encrypted archives, RAR, 7z, and XZ/LZMA are not supported.

## Development and release readiness

```sh
npm install
npm run build
npm test
npm run coverage
npm run test:pack
npm audit
```

The CI matrix targets Node 22, 24, and 26 on Linux, macOS, and Windows. Coverage gates are 85
percent lines/statements, 90 percent functions, and 80 percent branches, with per-critical-file
floors enforced from lcov output. Packaging verification installs the generated tarballs in a
clean temporary project and exercises ESM, CommonJS, and the CLI.

Maintainers cut releases by pushing a `v*.*.*` tag. The Release workflow runs the full release
check, publishes the packages, and attaches the generated SBOM to the GitHub release.

## License

MIT © @umar0x
