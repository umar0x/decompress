# @umar0x/decompress

Secure, bounded archive extraction for Node.js 20+. The native structured API supports ZIP,
TAR, TAR.GZ, and TAR.BZ2, with ESM and CommonJS builds.

This project is an alternative to the unmaintained `decompress` package. Its primary product is
the native `@umar0x/decompress` API. `@umar0x/decompress-compatible` is a migration bridge for
applications that cannot switch APIs immediately; it is intentionally not presented as perfect
behavioral parity.

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
iterable. Path inputs remain file-backed. One-shot stream inputs are copied to a private,
size-bounded temporary file so ZIP random access is safe and input is never buffered without a
limit. File bodies are streamed to the secure writer.

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
- `auditArchive()` returns findings and a risk level without writing output. Audit reduces risk but
  cannot prove an archive harmless.

## Security model

Every entry, including entries emitted by plugins and transformed by `map`, passes through the
same policy and writer. Important enforced properties are:

| Area        | Enforced behavior                                                                                                                           |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Paths       | Reject empty/NUL, absolute, drive/UNC, traversal, NTFS ADS, device names, trailing dots/spaces, invalid Windows characters, excessive depth |
| Identity    | NFC normalization, duplicate detection, case-collision detection on case-insensitive systems, post-map validation                           |
| Links       | Symlinks and hardlinks refused by default; opted-in targets are containment checked; hardlinks are dependency ordered                       |
| Writes      | Private staging directory, no-follow/exclusive file creation, ancestor checks, partial-write loops, safe default modes                      |
| Permissions | Setuid, setgid, and sticky bits are always stripped; archive modes are optional                                                             |
| Resources   | Maximum archive bytes, entries, total output bytes, entry bytes, path depth, and compression ratio                                          |
| Failure     | Abort-aware cleanup and commit-time rename; a new output is absent on extraction failure                                                    |
| Formats     | Unsupported entry types, encrypted ZIP entries, and corrupt input fail with typed errors                                                    |
| Plugins     | Plugin entries are untrusted and revalidated; legacy plugins require `legacyPluginUnsafe: true`                                             |

Default limits are 512 MiB archive input, 10,000 entries, 2 GiB total output, 512 MiB per entry,
128 path segments, and a 100:1 compression ratio. Choose lower, workload-specific limits when
processing untrusted uploads.

Third-party plugins are normal JavaScript running in your process. The plugin interface does not
hand them an output path or writer, but it is not a sandbox and cannot prevent a malicious package
from importing `node:fs` or using the network. Treat plugins as trusted code.

See [the threat model](./docs/threat-model.md), [architecture](./docs/architecture.md), and
[security policy](./SECURITY.md).

## Atomic output semantics

Extraction occurs in a private sibling staging directory and is committed by rename only after all
entries and directory metadata succeed. With the default `overwrite: false`, an existing non-empty
output is rejected. With `overwrite: true`, the whole output directory is replaced, not merged.
Cross-device commit fallback is intentionally rejected because it would weaken atomicity.

## Compatibility adapter

```diff
- const decompress = require('decompress');
+ const decompress = require('@umar0x/decompress-compatible');
```

The adapter preserves the common `decompress(input, output?, options?)` call shape and returns
entries with `data` buffers. It deliberately keeps compatibility processing in memory and may use
more memory than the native API. Legacy plugins require an explicit unsafe opt-in. New code should
use the native API. See [MIGRATION.md](./MIGRATION.md) for differences.

## CLI

```sh
decompress extract archive.zip dist --strip 1 --max-files 10000
decompress list archive.zip --pretty
decompress audit archive.zip --pretty
```

Exit codes are `0` for success, `1` for an extraction/policy error or a high/critical audit,
`2` for usage errors, and `130` for SIGINT.

## Formats and dependencies

| Format  | Detection                             | Parser                          |
| ------- | ------------------------------------- | ------------------------------- |
| ZIP     | `PK` signatures                       | `yauzl`                         |
| TAR     | `ustar` header or canonical empty TAR | `tar-stream`                    |
| TAR.GZ  | gzip signature                        | `node:zlib` + `tar-stream`      |
| TAR.BZ2 | `BZh` signature                       | `unbzip2-stream` + `tar-stream` |

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

The CI matrix targets Node 20, 22, and 24 on Linux, macOS, and Windows. Coverage gates are 85% for
lines/statements, 90% for functions, and 80% for branches. Packaging verification installs the
generated tarballs in a clean temporary project and exercises ESM, CommonJS, and the CLI.

Maintainers should follow the [release guide](./docs/releasing.md) for tag validation, first
publication, trusted publishing, and repository protection settings.

## License

MIT © @umar0x
