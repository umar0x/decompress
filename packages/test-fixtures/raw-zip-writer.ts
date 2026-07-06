// Minimal ZIP writer that preserves unsafe names for security fixtures.

import { writeFile } from 'node:fs/promises';
import nodePath from 'node:path';

// ZIP format constants
const LOCAL_FILE_HEADER_SIG = 0x04034b50;
const CENTRAL_DIR_SIG = 0x02014b50;
const END_OF_CENTRAL_DIR_SIG = 0x06054b50;

type ZipEntry = {
  name: string; // arbitrary entry name (may contain ../, /, :, etc.)
  content: Buffer;
  mode?: number; // external file attributes (Unix mode in high 16 bits)
  isDir?: boolean;
};

/**
 * Build a ZIP archive buffer from entries with arbitrary names.
 * Entry names are stored verbatim without path sanitization.
 */
export function buildZipRaw(entries: ZipEntry[]): Buffer {
  const chunks: Buffer[] = [];
  const centralDir: Buffer[] = [];
  let offset = 0;

  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const content = e.content ?? Buffer.alloc(0);
    const crc = crc32(content);
    const mode = e.mode ?? (e.isDir ? 0o040755 : 0o100644);
    const externalAttrs = ((mode << 16) | 0) >>> 0; // Unix mode in high 16 bits (unsigned)
    // Set UTF-8 flag (bit 11) if the name contains non-ASCII characters.
    const isUtf8 = [...e.name].some((character) => character.codePointAt(0)! > 0x7f);
    const gpFlag = isUtf8 ? 0x0800 : 0;

    // Local file header (30 bytes + name)
    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(LOCAL_FILE_HEADER_SIG, 0);
    lfh.writeUInt16LE(20, 4); // version needed (2.0)
    lfh.writeUInt16LE(gpFlag, 6); // flags (UTF-8 if non-ASCII)
    lfh.writeUInt16LE(0, 8); // compression (0 = stored)
    lfh.writeUInt16LE(0, 10); // mod time
    lfh.writeUInt16LE(0, 12); // mod date
    lfh.writeUInt32LE(crc, 14); // crc32
    lfh.writeUInt32LE(content.length, 18); // compressed size
    lfh.writeUInt32LE(content.length, 22); // uncompressed size
    lfh.writeUInt16LE(nameBuf.length, 26); // name length
    lfh.writeUInt16LE(0, 28); // extra length

    const localHeaderOffset = offset;
    chunks.push(lfh, nameBuf, content);
    offset += lfh.length + nameBuf.length + content.length;

    // Central directory entry (46 bytes + name)
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(CENTRAL_DIR_SIG, 0);
    cd.writeUInt16LE(20, 4); // version made by
    cd.writeUInt16LE(20, 6); // version needed
    cd.writeUInt16LE(gpFlag, 8); // flags (UTF-8 if non-ASCII)
    cd.writeUInt16LE(0, 10); // compression
    cd.writeUInt16LE(0, 12); // mod time
    cd.writeUInt16LE(0, 14); // mod date
    cd.writeUInt32LE(crc, 16); // crc32
    cd.writeUInt32LE(content.length, 20); // compressed size
    cd.writeUInt32LE(content.length, 24); // uncompressed size
    cd.writeUInt16LE(nameBuf.length, 28); // name length
    cd.writeUInt16LE(0, 30); // extra length
    cd.writeUInt16LE(0, 32); // comment length
    cd.writeUInt16LE(0, 34); // disk number
    cd.writeUInt16LE(0, 36); // internal attrs
    cd.writeUInt32LE(externalAttrs, 38); // external attrs
    cd.writeUInt32LE(localHeaderOffset, 42); // local header offset
    centralDir.push(cd, nameBuf);
  }

  const cdOffset = offset;
  let cdSize = 0;
  for (const b of centralDir) cdSize += b.length;

  // End of central directory (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(END_OF_CENTRAL_DIR_SIG, 0);
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // disk with CD
  eocd.writeUInt16LE(entries.length, 8); // entries on this disk
  eocd.writeUInt16LE(entries.length, 10); // total entries
  eocd.writeUInt32LE(cdSize, 12); // CD size
  eocd.writeUInt32LE(cdOffset, 16); // CD offset
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...chunks, ...centralDir, eocd]);
}

// CRC32 lookup table
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? (0xedb88320 ^ (c >>> 1)) >>> 0 : c >>> 1;
    }
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = (CRC_TABLE[(crc ^ buf[i]!) & 0xff]! ^ (crc >>> 8)) >>> 0;
  }
  return ((crc ^ 0xffffffff) >>> 0) >>> 0;
}

/**
 * Build malicious ZIP fixtures without path sanitization.
 */
export async function buildMaliciousZipFixtures(outDir: string): Promise<void> {
  const fixtures: Array<{ file: string; entries: ZipEntry[] }> = [
    {
      file: 'zip-slip-basic.zip',
      entries: [{ name: '../evil.txt', content: Buffer.from('evil') }],
    },
    {
      file: 'zip-slip-nested.zip',
      entries: [{ name: 'a/../../b.txt', content: Buffer.from('evil') }],
    },
    {
      file: 'absolute-posix.zip',
      entries: [{ name: '/etc/passwd', content: Buffer.from('evil') }],
    },
    {
      file: 'absolute-windows-drive.zip',
      entries: [{ name: 'C:\\Windows\\evil.dll', content: Buffer.from('evil') }],
    },
    {
      file: 'windows-unc.zip',
      entries: [{ name: '\\\\server\\share\\evil', content: Buffer.from('evil') }],
    },
    {
      file: 'windows-ads.zip',
      entries: [{ name: 'file.txt:Zone.Identifier', content: Buffer.from('evil') }],
    },
    {
      file: 'windows-device-name.zip',
      entries: [{ name: 'CON.txt', content: Buffer.from('evil') }],
    },
    {
      file: 'windows-trailing-dots.zip',
      entries: [{ name: 'file.txt.', content: Buffer.from('evil') }],
    },
    {
      file: 'duplicate-path.zip',
      entries: [
        { name: 'foo', content: Buffer.from('first') },
        { name: 'foo', content: Buffer.from('second') },
      ],
    },
    {
      file: 'case-collision.zip',
      entries: [
        { name: 'Foo.txt', content: Buffer.from('first') },
        { name: 'foo.txt', content: Buffer.from('second') },
      ],
    },
    {
      file: 'unicode-normalization-collision.zip',
      entries: [
        { name: 'café.txt', content: Buffer.from('nfc') }, // NFC (é = U+00E9)
        { name: 'cafe\u0301.txt', content: Buffer.from('nfd') }, // NFD (e + combining acute)
      ],
    },
    {
      file: 'url-encoded-traversal.zip',
      entries: [{ name: '.%2e/.%2e/etc/passwd', content: Buffer.from('evil') }],
    },
  ];

  for (const f of fixtures) {
    const buf = buildZipRaw(f.entries);
    await writeFile(nodePath.join(outDir, f.file), buf);
    console.log(`  wrote ${f.file} (${buf.length} bytes, ${f.entries.length} entries)`);
  }
}
