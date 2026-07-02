# @umar0x/decompress

Native secure archive extraction for Node.js 20+. Supports ZIP, TAR, TAR.GZ, and TAR.BZ2 with
streamed file bodies, atomic output, resource ceilings, typed errors, audit/list APIs, ESM, and
CommonJS.

```ts
import { extract, auditArchive } from '@umar0x/decompress';

const report = await auditArchive('upload.zip');
const result = await extract('upload.zip', 'output', {
  maxFiles: 10_000,
  maxTotalSize: '2gb',
  allowSymlinks: false,
  allowHardlinks: false,
});
```

Symlinks/hardlinks are refused by default. Existing non-empty outputs are rejected unless
`overwrite: true`, which replaces the complete directory. Inputs may be paths, buffers, Node/Web
streams, or async iterables. One-shot streams are spooled to a private file under
`maxArchiveSize`; extracted bodies remain streamed.

Third-party plugins are not sandboxed. Their emitted entries are revalidated, but plugin packages
run with the caller process's authority.

Project documentation: https://github.com/umar0x/decompress
