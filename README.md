# @umar0x/decompress

Secure, bounded archive extraction for Node.js 22+. ZIP, TAR, TAR.GZ, and TAR.BZ2, with ESM and
CommonJS builds.

I built this because the two packages most of the ecosystem still relies on for archive
extraction are either unmaintained or carry a lineage of extraction vulnerabilities, and I wanted
a default that survives hostile input. Every default here is chosen for that case: untrusted
archives, safe by construction, with limits you can tune.

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

On a 2-vCPU Linux host with a corpus spanning 100 to 5,000-file archives, 128 MiB single files,
60-level nesting, unicode names, and mixed permissions (5-run medians): this library leads both
`decompress` 4.2.1 and `@xhmikosr/decompress` 11.1.4 on every throughput-heavy and concurrent
scenario, with 10 to 25 times lower peak memory on large single files (streaming writer against
whole-archive buffering). `@xhmikosr/decompress` keeps a 3 to 15 ms edge on tiny archives, the
price this library pays for atomic staging and per-entry policy validation.

## Formats and dependencies

| Format  | Detection       | Parser                          |
| ------- | --------------- | ------------------------------- |
| ZIP     | `PK` signatures | `yauzl`                         |
| TAR     | `ustar` header  | `tar-stream`                    |
| TAR.GZ  | gzip signature  | `node:zlib` + `tar-stream`      |
| TAR.BZ2 | `BZh` signature | `unbzip2-stream` + `tar-stream` |

Runtime dependencies: `yauzl`, `tar-stream`, and `unbzip2-stream`. Encrypted archives, RAR, and
7z are not supported.

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
