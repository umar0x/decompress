// Generates malicious archives used by the security regression suite.

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { createGzip } from 'node:zlib';
import nodePath from 'node:path';
import tar from 'tar-stream';

import { buildMaliciousZipFixtures, buildZipRaw } from './raw-zip-writer.ts';

const outDir = nodePath.join(import.meta.dirname, 'malicious');
const fixtureTime = new Date('2026-01-01T00:00:00.000Z');

type TarFixtureEntry = {
  name: string;
  type?: tar.Headers['type'];
  mode?: number;
  linkname?: string;
  content?: Buffer | string;
};

async function buildTar(entries: TarFixtureEntry[]): Promise<Buffer> {
  const pack = tar.pack();
  const drain = (async () => {
    const chunks: Buffer[] = [];
    for await (const chunk of pack) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  })();

  for (const entry of entries) {
    const content = Buffer.isBuffer(entry.content)
      ? entry.content
      : Buffer.from(entry.content ?? '');
    await new Promise<void>((resolve, reject) => {
      pack.entry(
        {
          name: entry.name,
          type: entry.type ?? 'file',
          mode: entry.mode ?? 0o644,
          mtime: fixtureTime,
          linkname: entry.linkname,
          size:
            entry.type === 'directory' || entry.type === 'symlink' || entry.type === 'link'
              ? 0
              : content.length,
        },
        content,
        (error) => (error ? reject(error) : resolve()),
      );
    });
  }

  pack.finalize();
  return drain;
}

async function gzip(buffer: Buffer): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of Readable.from([buffer]).pipe(createGzip())) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function writeTar(
  file: string,
  entries: TarFixtureEntry[],
  compressed = false,
): Promise<void> {
  const archive = await buildTar(entries);
  await writeFile(nodePath.join(outDir, file), compressed ? await gzip(archive) : archive);
}

function buildHugeDeclaredSizeTar(): Buffer {
  const header = Buffer.alloc(512, 0);
  header.write('big.bin', 0, 'ascii');
  header.write('0000644\0', 100, 'ascii');
  header.write('0000000\0', 108, 'ascii');
  header.write('0000000\0', 116, 'ascii');
  header.write('20000000000 ', 124, 'ascii');
  header.write('00000000000\0', 136, 'ascii');
  header.fill(0x20, 148, 156);
  header[156] = 0x30;
  header.write('ustar\0', 257, 'ascii');
  header.write('00', 263, 'ascii');

  let checksum = 0;
  for (const byte of header) checksum += byte;
  header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii');
  return Buffer.concat([header, Buffer.from([0]), Buffer.alloc(511), Buffer.alloc(1024)]);
}

async function main(): Promise<void> {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  await writeTar('symlink-to-parent.tar', [{ name: 'link', type: 'symlink', linkname: '..' }]);
  await writeTar('symlink-to-absolute.tar', [
    { name: 'passwd', type: 'symlink', linkname: '/etc/passwd' },
  ]);
  await writeTar('symlink-chain-escape.tar', [
    { name: 'a', type: 'symlink', linkname: 'b' },
    { name: 'b', type: 'symlink', linkname: '/etc' },
  ]);
  await writeTar('hardlink-to-parent.tar', [
    { name: 'real.txt', content: 'x' },
    { name: 'leak', type: 'link', linkname: '../secret.txt' },
  ]);
  await writeTar('hardlink-to-absolute.tar', [
    { name: 'leak', type: 'link', linkname: '/etc/passwd' },
  ]);
  await writeTar('setuid-file.tar', [{ name: 'suid.txt', mode: 0o4755, content: 'fixture' }]);
  await writeTar('setgid-file.tar', [{ name: 'sgid.txt', mode: 0o2755, content: 'fixture' }]);
  await writeTar('sticky-dir.tar', [{ name: 'sticky/', type: 'directory', mode: 0o1777 }]);
  await writeTar('too-deep.tar', [
    {
      name: `${Array.from({ length: 129 }, (_, index) => `d${index}`).join('/')}/file.txt`,
      content: 'deep',
    },
  ]);
  await writeTar('partial-failure.tar', [
    { name: 'good.txt', content: 'ok' },
    { name: '../evil.txt', content: 'blocked' },
  ]);
  await writeTar('zip-slip-nested.tar', [{ name: 'a/../../b.txt', content: 'blocked' }]);
  await writeTar('windows-trailing-dots.tar', [{ name: 'file.txt.', content: 'blocked' }]);
  await writeTar('unicode-normalization-collision.tar', [
    { name: 'caf\u00e9.txt', content: 'nfc' },
    { name: 'cafe\u0301.txt', content: 'nfd' },
  ]);
  await writeTar(
    'sibling_prefix.tar.gz',
    [{ name: '../output-evil/file.txt', content: 'blocked' }],
    true,
  );
  await writeTar('slipping.tar.gz', [{ name: '../../outside.txt', content: 'blocked' }], true);
  await writeTar(
    'link_escape.tar.gz',
    [{ name: 'leak', type: 'link', linkname: '../outside.txt' }],
    true,
  );
  await writeTar(
    'link_via_trap.tar.gz',
    [
      { name: 'trap', type: 'symlink', linkname: '/etc' },
      { name: 'leak', type: 'link', linkname: 'trap/passwd' },
    ],
    true,
  );
  await writeTar(
    'symlink_escape.tar.gz',
    [{ name: 'leak', type: 'symlink', linkname: '../../outside.txt' }],
    true,
  );
  await writeTar(
    'high-compression-ratio.tar.gz',
    [{ name: 'zeros.bin', content: Buffer.alloc(1024 * 1024) }],
    true,
  );
  await writeTar(
    'high-total-size.tar.gz',
    Array.from({ length: 2_000 }, (_, index) => ({
      name: `files/${index}.bin`,
      content: Buffer.alloc(1024, index % 251),
    })),
    true,
  );
  await writeFile(nodePath.join(outDir, 'huge-declared-size.tar'), buildHugeDeclaredSizeTar());

  await buildMaliciousZipFixtures(outDir);
  await writeFile(
    nodePath.join(outDir, 'too-many-files.zip'),
    buildZipRaw(
      Array.from({ length: 10_001 }, (_, index) => ({
        name: `files/${index}.txt`,
        content: Buffer.alloc(0),
      })),
    ),
  );
  await writeFile(
    nodePath.join(outDir, 'slip.zip'),
    buildZipRaw([
      {
        name: 'nested/link',
        content: Buffer.from('../../outside.txt'),
        mode: 0o120777,
      },
    ]),
  );
  await writeFile(
    nodePath.join(outDir, 'slip2.zip'),
    buildZipRaw([{ name: 'a/../../outside.txt', content: Buffer.from('blocked') }]),
  );
  await writeFile(
    nodePath.join(outDir, 'slip3.zip'),
    buildZipRaw([{ name: '../../../outside.txt', content: Buffer.from('blocked') }]),
  );
}

await main();
