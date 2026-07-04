import type { ArchivePlugin } from '../types.ts';
import { zipPlugin } from '../formats/zip.ts';
import { tarPlugin } from '../formats/tar.ts';
import { targzPlugin } from '../formats/targz.ts';
import { tarbz2Plugin } from '../formats/tarbz2.ts';

export const BUILTIN_PLUGINS: ArchivePlugin[] = [zipPlugin, tarPlugin, targzPlugin, tarbz2Plugin];

export function getBuiltinPlugins(): ArchivePlugin[] {
  return [...BUILTIN_PLUGINS];
}
