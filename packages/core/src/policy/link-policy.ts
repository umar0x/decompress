import nodePath from 'node:path';
import { realpath } from 'node:fs/promises';
import { isInsideOutput } from '../writer/path-security.ts';
import {
  HardlinkRefusedError,
  HardlinkTargetMissingError,
  LinkEscapeError,
  SymlinkRefusedError,
} from '../errors.ts';

export type LinkPolicyOptions = {
  allowSymlinks: boolean;
  allowHardlinks: boolean;
  realOutputPath: string;
};

/**
 * Validate a symlink target. The target is resolved relative to the link's OWN
 * directory (POSIX symlink semantics). If the target exists, its realpath is
 * also checked to detect multi-level symlink chains.
 *
 * Returns the resolved target string. Throws LinkEscapeError if the target
 * escapes the output directory.
 */
export async function validateSymlinkTarget(
  linkname: string,
  linkBase: string,
  opts: LinkPolicyOptions,
): Promise<string> {
  if (!opts.allowSymlinks) {
    throw new SymlinkRefusedError(
      `symlink entry refused (allowSymlinks is false; set allowSymlinks: true to opt in)`,
    );
  }

  const target = nodePath.resolve(linkBase, linkname);
  if (!isInsideOutput(target, opts.realOutputPath)) {
    throw new LinkEscapeError(linkname, 'symlink', linkname, target);
  }

  // If the target exists, realpath it to catch symlink chains (a → b → /etc).
  let realTarget: string;
  try {
    realTarget = await realpath(target);
  } catch {
    // A dangling target is accepted after lexical containment succeeds.
    return target;
  }

  if (!isInsideOutput(realTarget, opts.realOutputPath)) {
    throw new LinkEscapeError(linkname, 'symlink', linkname, realTarget);
  }

  return target;
}

/**
 * Validate a hardlink target. The target is resolved relative to the OUTPUT ROOT
 * using archive-relative TAR hardlink semantics.
 *
 * Hardlinks must point to an existing in-output file (hardlinks cannot dangle).
 */
export async function validateHardlinkTarget(
  linkname: string,
  opts: LinkPolicyOptions,
): Promise<string> {
  if (!opts.allowHardlinks) {
    throw new HardlinkRefusedError(
      `hardlink entry refused (allowHardlinks is false; set allowHardlinks: true to opt in)`,
    );
  }

  const target = nodePath.resolve(opts.realOutputPath, linkname);
  if (!isInsideOutput(target, opts.realOutputPath)) {
    throw new LinkEscapeError(linkname, 'hardlink', linkname, target);
  }

  let realTarget: string;
  try {
    realTarget = await realpath(target);
  } catch {
    throw new HardlinkTargetMissingError(
      `hardlink target does not exist: ${linkname} -> ${target}`,
    );
  }

  if (!isInsideOutput(realTarget, opts.realOutputPath)) {
    throw new LinkEscapeError(linkname, 'hardlink', linkname, realTarget);
  }

  return target;
}
