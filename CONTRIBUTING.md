# Contributing

This is security-sensitive filesystem code. Changes should be small, reviewable, and accompanied by
tests that demonstrate both success and fail-closed behavior.

## Setup

Requirements: Node 20+ and npm 10+.

```sh
npm install
npm run build
npm test
npm run coverage
npm run lint
npm run format:check
npm run test:pack
```

The monorepo contains the native package in `packages/core`, the migration adapter in
`packages/decompress-compatible`, the CLI in `packages/cli`, fixtures in
`packages/test-fixtures`, benchmarks in `packages/benchmarks`, and deterministic fuzz tests in
`packages/fuzz`.

## Engineering rules

- Preserve strict TypeScript settings and avoid `any`; validate values crossing plugin/parser
  boundaries.
- Keep all filesystem mutations in the secure writer/atomic extraction layer.
- Never trust header sizes alone. Enforce limits against actual streamed bytes.
- Keep paths relative and apply policy again after user transforms.
- Use `apply_patch`-sized, focused changes; do not mix refactors with security fixes unnecessarily.
- Do not add a new dependency when a small Node built-in implementation is sufficient.
- Do not weaken atomicity with cross-device copy fallback.
- Treat plugins as trusted process code and their emitted records as untrusted data.

## Testing requirements

Every change must keep the global coverage gates at 85% lines/statements, 90% functions, and 80%
branches. New behavior needs a focused unit/integration test. Security fixes need a malicious fixture
or deterministic reproduction that fails before the fix. Link behavior must be tested on a platform
that permits symlink creation; Windows tests may capability-skip under restricted accounts.

Run the relevant focused suite while developing, then the full commands above. Package-facing
changes must pass the tarball smoke test, which validates clean ESM, CommonJS, and CLI consumers.

## Adding a format or plugin

Implement `ArchivePlugin`, stream bodies where possible, honor abort, reject unsupported/encrypted
features, register built-ins explicitly, and add detection plus malformed/truncated fixtures. Read
[the plugin author guide](./docs/plugin-author-guide.md). Plugins must not write output directly;
this is an architectural rule, not a sandbox restriction.

## Security reports

Use the private process in [SECURITY.md](./SECURITY.md), not a public issue.
