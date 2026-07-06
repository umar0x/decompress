# @umar0x/decompress-compatible

Migration adapter from the common `decompress(input, output?, options?)` API to the native
`@umar0x/decompress` security pipeline.

```js
const decompress = require('@umar0x/decompress-compatible');
const entries = await decompress('archive.zip', 'output', { strip: 1 });
```

Entries include `data: Buffer` so existing `filter` and `map` callbacks can inspect contents. This
requires an extract/read/replay flow and can use substantially more memory and I/O than the native
API. It intentionally changes unsafe legacy defaults: links are refused, limits are enabled,
transformed paths are revalidated, output is atomic, and plugins require
`legacyPluginUnsafe: true`.

Use `@umar0x/decompress` directly for new code. Full migration notes:
https://github.com/umar0x/decompress/blob/main/MIGRATION.md
