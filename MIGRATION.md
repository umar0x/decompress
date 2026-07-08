# Migration guide

This guide covers migration from `decompress` or `@xhmikosr/decompress`.

## Recommended: move to the native structured API

```ts
import { extract } from '@umar0x/decompress';

const result = await extract('archive.zip', 'dist', {
  strip: 1,
  maxFiles: 10_000,
  maxTotalSize: '2gb',
  signal: controller.signal,
});

console.log(result.entries, result.totalBytes, result.warnings);
```

The native API is the product direction because it streams file bodies, exposes typed results and
errors, supports audit/list operations, and keeps all writes behind a central policy engine.

Key differences:

- The return value is `ExtractResult`; entries are in `result.entries`.
- Extracted file contents are not retained as `data` buffers. Read selected files from
  `result.output` if the caller needs their contents.
- Inputs may be a path, `Buffer`, Node stream, Web stream, or async iterable.
- Symlinks and hardlinks are refused unless explicitly enabled.
- Conservative resource limits are enabled by default.
- Output creation is transactional. A new output is absent when extraction fails.
- `overwrite: true` replaces the complete output directory; it does not merge into it.
- Errors extend `DecompressError` and expose stable `code` values.
- `filter` and `map` receive metadata, not an in-memory `data` buffer. Mapped entries are
  revalidated.

## Transitional: compatibility adapter

For code that cannot change its call shape immediately:

```diff
- const decompress = require('decompress');
+ const decompress = require('@umar0x/decompress-compatible');
```

The adapter supports the common `decompress(input, output?, options?)` signature, `strip`,
`filter`, `map`, and entries containing `data: Buffer`. It first performs a secure native
extraction, then applies compatibility transforms and securely replays the result to the requested
output. This makes it safer than handing transforms direct write access, but it is intentionally
more memory- and I/O-intensive than the native API.

It is a migration bridge, not a claim of byte-for-byte parity for every undocumented behavior.

### Intentional differences

| Previous behavior                               | Adapter/native behavior                                        | Migration action                                        |
| ----------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------- |
| Symlinks and hardlinks commonly enabled         | Refused by default                                             | Enable only for trusted use cases and audit the archive |
| Partial output on error                         | New output absent on error                                     | Do not rely on partial extraction                       |
| No resource ceilings                            | Six conservative limits                                        | Raise only the specific limit required by the workload  |
| `map()` may create arbitrary paths              | Mapped paths are revalidated                                   | Keep mapped paths relative and contained                |
| Special permission bits may survive in metadata | Setuid/setgid/sticky always stripped                           | Use `rawMode` for inspection only                       |
| Existing output may be merged                   | Non-empty output rejected, or wholly replaced with `overwrite` | Choose a fresh destination or explicit replacement      |
| Legacy plugin accepted implicitly               | Requires `legacyPluginUnsafe: true`                            | Prefer built-in/native plugins                          |
| Very old Node versions                          | Node 20+                                                       | Upgrade the runtime                                     |
| CJS-only package                                | ESM and CJS                                                    | Both import styles are supported                        |
| No cancellation                                 | `AbortSignal`                                                  | Wire request cancellation to `signal`                   |
| Silent platform link fallback                   | Explicit `symlinkFallback`                                     | Select `error`, `hardlink`, or `skip` deliberately      |

### Legacy plugins

```ts
const decompress = require('@umar0x/decompress-compatible');
const decompressTar = require('decompress-tar');

await decompress('archive.tar', 'out', {
  plugins: [decompressTar()],
  legacyPluginUnsafe: true,
});
```

Legacy plugin output is revalidated, but the plugin itself is trusted process code. JavaScript
plugins are not sandboxed and can import filesystem or network modules. Review their source and
dependency chain before enabling them.

## Common migration failures

### `OutputExistsError`

The destination is non-empty. Extract to a new directory or set `overwrite: true` to atomically
replace the entire destination.

### `SymlinkRefusedError` or `HardlinkRefusedError`

Links are disabled by default. If the archive format genuinely requires them, audit first and then
set `allowSymlinks` or `allowHardlinks` for that controlled workflow.

### A limit error

Set workload-specific ceilings instead of disabling protection:

```ts
{
  maxArchiveSize: '1gb',
  maxFiles: 25_000,
  maxTotalSize: '10gb',
  maxEntrySize: '2gb',
  maxDepth: 64,
  maxCompressionRatio: 50,
}
```

### A transformed path is rejected

`map()` output must remain a relative, normalized path inside the destination. Absolute paths,
parent traversal, Windows device/ADS forms, control characters, and platform collisions fail
closed.

### File contents are needed in memory

Prefer extracting with the native API and reading only the required files. Use the compatibility
adapter only when existing callbacks require every entry's `data` buffer.
