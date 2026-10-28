import { defineConfig } from 'tsup';

// The published artifact bundles the runtime dependencies (yauzl, tar-stream,
// unbzip2-stream, seek-bzip). tar-stream's manifest pulls bare-fs ->
// bare-path/bare-url, which ship prebuilt native binaries for platforms this
// pure-JS library never touches (~5.8 MB of dead install weight); none of
// tar-stream's code we execute even requires bare-fs. Bundling gives
// consumers a zero-runtime-dependency install.
//
// The ESM bundle needs the createRequire banner: the bundled CommonJS
// dependencies call require() for node builtins through esbuild's interop
// shim, which resolves against the real require this banner provides.
// The bzip2 worker is a standalone CJS entry so worker_threads can spawn it
// from both the ESM and CJS builds.
export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm'],
    dts: false,
    clean: true,
    // Source maps are intentionally excluded from published builds; the
    // repository ships the TypeScript source for debugging.
    sourcemap: false,
    target: 'es2023',
    outDir: 'dist',
    tsconfig: 'tsconfig.build.json',
    noExternal: ['tar-stream', 'yauzl', 'unbzip2-stream', 'seek-bzip'],
    banner: {
      js: "import { createRequire } from 'node:module';\nconst require = createRequire(import.meta.url);",
    },
  },
  {
    entry: ['src/index.ts'],
    format: ['cjs'],
    dts: false,
    clean: false,
    sourcemap: false,
    target: 'es2023',
    outDir: 'dist',
    tsconfig: 'tsconfig.build.json',
    noExternal: ['tar-stream', 'yauzl', 'unbzip2-stream', 'seek-bzip'],
  },
  {
    entry: ['src/formats/bz2-worker.ts'],
    format: ['cjs'],
    dts: false,
    clean: false,
    sourcemap: false,
    target: 'es2023',
    outDir: 'dist',
    tsconfig: 'tsconfig.build.json',
    noExternal: ['seek-bzip'],
  },
]);
