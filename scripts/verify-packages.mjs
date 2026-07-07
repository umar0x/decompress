import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import nodePath from 'node:path';
import process from 'node:process';

const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('package smoke test must be launched through npm');
const root = mkdtempSync(nodePath.join(tmpdir(), 'decompress-package-smoke-'));
const packs = nodePath.join(root, 'packs');
const consumer = nodePath.join(root, 'consumer');
mkdirSync(packs);
mkdirSync(consumer);

try {
  const tarballs = [
    pack('@umar0x/decompress', ['dist/index.js', 'dist/index.cjs', 'dist/index.d.ts']),
    pack('@umar0x/decompress-compatible', ['dist/index.js', 'dist/index.cjs', 'dist/index.d.ts']),
    pack('@umar0x/decompress-cli', [
      'dist/cli.js',
      'dist/index.js',
      'dist/index.cjs',
      'dist/index.d.ts',
    ]),
  ];
  run(process.execPath, [
    npmCli,
    'install',
    '--prefix',
    consumer,
    '--ignore-scripts',
    '--no-save',
    '--package-lock=false',
    ...tarballs,
  ]);

  const cli = nodePath.join(
    consumer,
    'node_modules',
    '@umar0x',
    'decompress-cli',
    'dist',
    'cli.js',
  );
  if (!existsSync(cli)) throw new Error('packed CLI is missing dist/cli.js');

  run(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "import('@umar0x/decompress').then((m) => { if (typeof m.extract !== 'function') process.exit(1); })",
    ],
    consumer,
  );
  run(
    process.execPath,
    [
      '-e',
      "const m = require('@umar0x/decompress'); if (typeof m.auditArchive !== 'function') process.exit(1)",
    ],
    consumer,
  );
  run(process.execPath, [cli, '--version'], consumer);

  process.stdout.write('Packed package smoke tests passed.\n');
} finally {
  rmSync(root, { recursive: true, force: true });
}

function pack(workspace, requiredFiles) {
  const output = execFileSync(
    process.execPath,
    [
      npmCli,
      'pack',
      '--workspace',
      workspace,
      '--pack-destination',
      packs,
      '--ignore-scripts',
      '--json',
    ],
    { encoding: 'utf8', cwd: process.cwd() },
  );
  const result = JSON.parse(output)[0];
  if (!result?.filename) throw new Error(`npm pack produced no tarball for ${workspace}`);
  const fileNames = new Set(result.files.map((file) => file.path));
  for (const required of ['LICENSE', 'README.md', 'package.json', ...requiredFiles]) {
    if (!fileNames.has(required)) throw new Error(`${workspace} is missing ${required}`);
  }
  const unexpected = [...fileNames].filter(
    (file) =>
      file !== 'LICENSE' &&
      file !== 'README.md' &&
      file !== 'package.json' &&
      !file.startsWith('dist/'),
  );
  if (unexpected.length > 0) {
    throw new Error(`${workspace} includes unexpected files: ${unexpected.join(', ')}`);
  }
  return nodePath.join(packs, result.filename);
}

function run(command, args, cwd = process.cwd()) {
  execFileSync(command, args, { cwd, stdio: 'inherit' });
}
