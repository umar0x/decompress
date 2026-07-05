// Unit tests for link-policy: validateSymlinkTarget, validateHardlinkTarget.
// Uses real temp directories (realpath requires filesystem). , , .

import { test } from 'node:test';
import assert from 'node:assert/strict';
import nodePath from 'node:path';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import { validateSymlinkTarget, validateHardlinkTarget } from '../../src/policy/link-policy.ts';
import {
  HardlinkRefusedError,
  HardlinkTargetMissingError,
  LinkEscapeError,
  SymlinkRefusedError,
} from '../../src/errors.ts';

async function makeTempOutput(): Promise<string> {
  const dir = await mkdtemp(nodePath.join(tmpdir(), 'decompress-link-test-'));
  await mkdir(nodePath.join(dir, 'sub'), { recursive: true });
  return dir;
}

test('validateSymlinkTarget: refused by default', async () => {
  const out = await makeTempOutput();
  try {
    await assert.rejects(
      () =>
        validateSymlinkTarget('target', out, {
          allowSymlinks: false,
          allowHardlinks: false,
          realOutputPath: out,
        }),
      SymlinkRefusedError,
    );
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('validateSymlinkTarget: in-output target accepted when enabled', async () => {
  const out = await makeTempOutput();
  try {
    // Create a real target file inside output.
    await writeFile(nodePath.join(out, 'real.txt'), 'hello');
    // Symlink pointing at real.txt, resolved relative to out.
    const target = await validateSymlinkTarget('real.txt', out, {
      allowSymlinks: true,
      allowHardlinks: false,
      realOutputPath: out,
    });
    assert.ok(target.startsWith(out));
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('validateSymlinkTarget: rejects absolute targets outside output', async () => {
  const out = await makeTempOutput();
  try {
    await assert.rejects(
      () =>
        validateSymlinkTarget('/etc/passwd', out, {
          allowSymlinks: true,
          allowHardlinks: false,
          realOutputPath: out,
        }),
      LinkEscapeError,
    );
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('validateSymlinkTarget: parent-escape target rejected', async () => {
  const out = await makeTempOutput();
  try {
    await assert.rejects(
      () =>
        validateSymlinkTarget('../evil', out, {
          allowSymlinks: true,
          allowHardlinks: false,
          realOutputPath: out,
        }),
      LinkEscapeError,
    );
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('validateSymlinkTarget: symlink chain escape rejected via realpath', async (t) => {
  const out = await makeTempOutput();
  try {
    // Plant a link that resolves outside the output.
    if (!(await createSymlinkOrSkip(t, nodePath.parse(out).root, nodePath.join(out, 'inner'))))
      return;
    // Realpath validation must detect the escape.
    await assert.rejects(
      () =>
        validateSymlinkTarget('inner/passwd', out, {
          allowSymlinks: true,
          allowHardlinks: false,
          realOutputPath: out,
        }),
      LinkEscapeError,
    );
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('validateSymlinkTarget: dangling symlink inside output accepted (target does not exist)', async () => {
  const out = await makeTempOutput();
  try {
    // A missing target is allowed when its lexical path remains contained.
    const target = await validateSymlinkTarget('sub/nonexistent', out, {
      allowSymlinks: true,
      allowHardlinks: false,
      realOutputPath: out,
    });
    assert.ok(target.startsWith(out));
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('validateHardlinkTarget: refused by default', async () => {
  const out = await makeTempOutput();
  try {
    await assert.rejects(
      () =>
        validateHardlinkTarget('target', {
          allowSymlinks: false,
          allowHardlinks: false,
          realOutputPath: out,
        }),
      HardlinkRefusedError,
    );
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('validateHardlinkTarget: in-output existing target accepted when enabled', async () => {
  const out = await makeTempOutput();
  try {
    await writeFile(nodePath.join(out, 'real.txt'), 'hello');
    const target = await validateHardlinkTarget('real.txt', {
      allowSymlinks: false,
      allowHardlinks: true,
      realOutputPath: out,
    });
    assert.ok(target.startsWith(out));
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('validateHardlinkTarget: rejects absolute targets outside output', async () => {
  const out = await makeTempOutput();
  try {
    await assert.rejects(
      () =>
        validateHardlinkTarget('/etc/passwd', {
          allowSymlinks: false,
          allowHardlinks: true,
          realOutputPath: out,
        }),
      LinkEscapeError,
    );
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('validateHardlinkTarget: parent-escape target rejected', async () => {
  const out = await makeTempOutput();
  try {
    await assert.rejects(
      () =>
        validateHardlinkTarget('../secret', {
          allowSymlinks: false,
          allowHardlinks: true,
          realOutputPath: out,
        }),
      LinkEscapeError,
    );
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('validateHardlinkTarget: non-existent target throws HardlinkTargetMissingError', async () => {
  const out = await makeTempOutput();
  try {
    await assert.rejects(
      () =>
        validateHardlinkTarget('nonexistent.txt', {
          allowSymlinks: false,
          allowHardlinks: true,
          realOutputPath: out,
        }),
      HardlinkTargetMissingError,
    );
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('validateHardlinkTarget: hardlink target that is an escaping symlink rejected via realpath', async (t) => {
  const out = await makeTempOutput();
  try {
    // Plant a symlink inside output pointing to /etc.
    if (!(await createSymlinkOrSkip(t, nodePath.parse(out).root, nodePath.join(out, 'trap'))))
      return;
    // The lexical path is contained, but its real path escapes through the planted link.
    await assert.rejects(
      () =>
        validateHardlinkTarget('trap', {
          allowSymlinks: false,
          allowHardlinks: true,
          realOutputPath: out,
        }),
      LinkEscapeError,
    );
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

async function createSymlinkOrSkip(
  t: { skip(message?: string): void },
  target: string,
  linkPath: string,
): Promise<boolean> {
  try {
    await symlink(target, linkPath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM') {
      t.skip('symlink creation is not permitted in this environment');
      return false;
    }
    throw error;
  }
}
