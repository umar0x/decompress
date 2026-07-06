// CLI tests spawn the executable in a child process.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import nodePath from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const execFileAsync = promisify(execFile);
const here = nodePath.dirname(fileURLToPath(import.meta.url));
const cliPath = nodePath.join(here, '..', 'src', 'bin.ts');
const fixtures = nodePath.join(here, '..', '..', 'test-fixtures', 'benign');
const maliciousFixtures = nodePath.join(here, '..', '..', 'test-fixtures', 'malicious');

async function runCli(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      ['--import', 'tsx', cliPath, ...args],
      {
        maxBuffer: 10 * 1024 * 1024,
      },
    );
    return { stdout, stderr, code: 0 };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; code?: number };
    return { stdout: err.stdout ?? '', stderr: err.stderr ?? '', code: err.code ?? 1 };
  }
}

async function tmpOutput(): Promise<string> {
  return mkdtemp(nodePath.join(tmpdir(), 'decompress-cli-test-'));
}

test('cli: --help prints usage and exits 0', async () => {
  const { stdout, code } = await runCli(['--help']);
  assert.equal(code, 0);
  assert.ok(stdout.includes('Usage:'));
  assert.ok(stdout.includes('extract'));
  assert.ok(stdout.includes('list'));
  assert.ok(stdout.includes('audit'));
});

test('cli: extract file.zip → success, files written', async () => {
  const out = await tmpOutput();
  const target = nodePath.join(out, 'result');
  try {
    const { stderr, code } = await runCli(['extract', nodePath.join(fixtures, 'file.zip'), target]);
    assert.equal(code, 0);
    assert.ok(stderr.includes('extracted'));
    const st = await stat(nodePath.join(target, 'test.jpg'));
    assert.equal(st.size, 2248);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('cli: extract slip.zip → exits 1 (policy violation)', async () => {
  const out = await tmpOutput();
  const target = nodePath.join(out, 'result');
  try {
    const { code, stderr } = await runCli([
      'extract',
      nodePath.join(maliciousFixtures, 'slip.zip'),
      target,
    ]);
    assert.equal(code, 1);
    assert.ok(stderr.includes('error:'));
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('cli: list file.zip → JSON to stdout', async () => {
  const { stdout, code } = await runCli(['list', nodePath.join(fixtures, 'file.zip')]);
  assert.equal(code, 0);
  const entries = JSON.parse(stdout);
  assert.ok(Array.isArray(entries));
  assert.ok(entries.length >= 1);
});

test('cli: audit file.zip → JSON, exit 0 (benign)', async () => {
  const { stdout, code } = await runCli(['audit', nodePath.join(fixtures, 'file.zip')]);
  assert.equal(code, 0);
  const report = JSON.parse(stdout);
  assert.equal(report.riskLevel, 'low');
});

test('cli: audit slip.zip → exit 1 (critical risk)', async () => {
  const { stdout, code } = await runCli(['audit', nodePath.join(maliciousFixtures, 'slip.zip')]);
  assert.equal(code, 1);
  const report = JSON.parse(stdout);
  assert.equal(report.riskLevel, 'critical');
});

test('cli: extract with --strip', async () => {
  const out = await tmpOutput();
  const target = nodePath.join(out, 'result');
  try {
    const { code } = await runCli([
      'extract',
      nodePath.join(fixtures, 'nested.tar.gz'),
      target,
      '--strip',
      '1',
    ]);
    assert.equal(code, 0);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('cli: extract with --max-files 1 → exits 1 on multiple.zip', async () => {
  const out = await tmpOutput();
  const target = nodePath.join(out, 'result');
  try {
    const { code } = await runCli([
      'extract',
      nodePath.join(fixtures, 'multiple.zip'),
      target,
      '--max-files',
      '1',
    ]);
    assert.equal(code, 1);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('cli: no args → exits 2 (usage error)', async () => {
  const { code } = await runCli([]);
  assert.equal(code, 2);
});

test('cli: unknown command → exits 2', async () => {
  const { code } = await runCli(['frobnicate', 'foo.zip']);
  assert.equal(code, 2);
});

test('cli: size-string parsing (--max-total-size 100kb)', async () => {
  const out = await tmpOutput();
  const target = nodePath.join(out, 'result');
  try {
    // file.zip is 2248 bytes; 100kb limit should pass.
    const { code } = await runCli([
      'extract',
      nodePath.join(fixtures, 'file.zip'),
      target,
      '--max-total-size',
      '100kb',
    ]);
    assert.equal(code, 0);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});
