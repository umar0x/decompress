# Plugin author guide

The native plugin contract converts an archive into an async stream of untrusted entries. The core
library retains ownership of policy and filesystem writes.

```ts
import type { ArchivePlugin } from '@umar0x/decompress';

export const plugin: ArchivePlugin = {
  name: 'my-format',
  formats: ['my-format'],
  detect: (peek) => peek.subarray(0, 4).equals(Buffer.from('MYF1')),
  parse: async function* (input, ctx) {
    if (input.signal.aborted) throw input.signal.reason;
    yield {
      path: 'hello.txt',
      type: 'file',
      size: 5,
      mode: 0o644,
      sourceFormat: 'my-format',
      buffer: async () => Buffer.from('hello'),
    };
    ctx.warn('format_notice', 'optional parser warning');
  },
};
```

`PluginArchiveInput` provides a reusable Node stream factory, an optional caller-owned buffer, an
optional file path for random access, total size, format hints, and the caller's abort signal. A
plugin should prefer streaming bodies. `buffer` may be undefined for path and stream inputs; do not
assume every archive is resident in memory.

Each file entry must provide either `stream()` or `buffer()` and should declare an accurate size
when known. Supported types are `file`, `directory`, `symlink`, and `hardlink`. Symlink targets are
relative to the link's parent; TAR-style hardlink targets are relative to the archive root.

The core revalidates emitted paths, modes, links, types, declared sizes, transforms, and actual body
bytes. A plugin never receives the destination or secure writer. This API design reduces accidental
bypasses, but it does not sandbox plugin code: the package can still import Node built-ins or use
ambient process authority. Applications must trust and review every plugin dependency.

## Parser requirements

- Parse lazily and honor backpressure; do not accumulate the full archive or all entries.
- Check `input.signal.aborted` between expensive operations and destroy active streams on abort.
- Normalize parser failures into useful `Error` objects; the core may map them to public errors.
- Reject encryption and unsupported entry types explicitly.
- Do not trust header sizes or CRC values as resource controls; the writer verifies actual bytes.
- Ensure a skipped entry body is drained before requesting the next sequential archive entry.
- Keep detection deterministic and based only on the bounded prefix.

Pass a plugin through `extract`, `listArchive`, or `auditArchive` with `plugins: [plugin]`. Multiple
plugins should implement `detect`; a single plugin may be selected as an explicit override.

Legacy `decompress`-shape plugins require `legacyPluginUnsafe: true`. They buffer input/entries and
exist only for migration. New plugins should implement `ArchivePlugin`.

Tests should cover valid input, truncation, malformed headers, unsupported types, body streams that
exceed declared sizes, abort, empty archives, and every path/link attack relevant to the format.
