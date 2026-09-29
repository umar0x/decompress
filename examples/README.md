# Examples

Runnable against the built packages. From the repository root:

```sh
npm install
npm run build
npx tsx examples/basic-extract.ts
```

- `basic-extract.ts` - the smallest useful case, with the default limits and atomic output.
- `untrusted-upload-limits.ts` - tight resource ceilings, abort signal, and warnings for
  archives that come from strangers.
- `audit-before-extract.ts` - inspect first, extract only what passed review, typed error
  handling by code.
- `streaming-input.ts` - paths, Node streams, Web streams, and async iterables as input.

Every example runs against the same published API the packages ship. None of them enable
symlinks or hardlinks; when an archive genuinely needs links, see the `allowSymlinks` and
`allowHardlinks` options in the README and the threat model first.
