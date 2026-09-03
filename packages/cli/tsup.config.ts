import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    cli: 'src/bin.ts',
  },
  format: ['esm', 'cjs'],
  dts: false,
  clean: true,
  // Source maps are intentionally excluded from published builds; the
  // repository ships the TypeScript source for debugging.
  sourcemap: false,
  target: 'es2023',
  outDir: 'dist',
  tsconfig: 'tsconfig.build.json',
});
