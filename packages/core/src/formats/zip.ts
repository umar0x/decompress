// First-party ZIP parser using yauzl with lazy, file-backed entry streams.

import { Readable } from 'node:stream';
import yauzl from 'yauzl';
import { AbortError, CorruptArchiveError, EntrySizeExceededError } from '../errors.ts';
import type {
  ArchiveEntry,
  ArchivePlugin,
  EntryType,
  ParseContext,
  PluginArchiveInput,
} from '../types.ts';

const MAX_LINK_TARGET_BYTES = 16 * 1024;

function getEntryType(fileName: string, externalFileAttributes: number): EntryType {
  const unixMode = (externalFileAttributes >> 16) & 0xffff;
  if (unixMode !== 0) {
    const typeBits = unixMode & 0o170000;
    if (typeBits === 0o120000) return 'symlink';
    if (typeBits === 0o100000) return 'file';
    if (typeBits === 0o040000) return 'directory';
    if (typeBits !== 0) {
      throw new CorruptArchiveError(`unsupported ZIP Unix entry type for ${fileName}`);
    }
  }
  return fileName.endsWith('/') ? 'directory' : 'file';
}

function getMode(fileName: string, externalFileAttributes: number): number {
  const unixMode = (externalFileAttributes >> 16) & 0xffff;
  if (unixMode !== 0) return unixMode & 0o7777;
  return fileName.endsWith('/') ? 0o755 : 0o644;
}

async function* parseZip(
  input: PluginArchiveInput,
  _ctx: ParseContext,
): AsyncIterable<ArchiveEntry> {
  if (!input.buffer && !input.filePath) {
    throw new CorruptArchiveError('ZIP input requires a Buffer or file-backed input');
  }

  const options = {
    lazyEntries: true,
    autoClose: false,
    decodeStrings: false,
    validateEntrySizes: true,
    strictFileNames: false,
  };
  const yauzlModern = yauzl as typeof yauzl & {
    fromBufferPromise(buffer: Buffer, opts: typeof options): Promise<yauzl.ZipFile>;
    openPromise(path: string, opts: typeof options): Promise<yauzl.ZipFile>;
    getFileNameLowLevel(
      flag: number,
      name: Buffer,
      extraFields: yauzl.ExtraField[],
      strict: boolean,
    ): string;
  };
  let zipfile: yauzl.ZipFile | undefined;
  // The archive handle stays open until the pipeline tears down: concurrent
  // writers open lazy entry streams while other workers are still pulling
  // metadata, so closing when this generator completes would race them. The
  // API entry point runs the registered teardown after extraction finishes
  // (success, failure, or abort).
  let closeScheduled = false;
  const closeArchive = () => {
    if (zipfile && !closeScheduled) {
      closeScheduled = true;
      zipfile.close();
    }
  };
  input.teardown?.push(closeArchive);
  let entriesDrained = false;
  try {
    zipfile = input.buffer
      ? await yauzlModern.fromBufferPromise(input.buffer, options)
      : await yauzlModern.openPromise(input.filePath!, options);
    const archive = zipfile;

    for await (const entry of archive.eachEntry()) {
      if (input.signal.aborted) throw new AbortError(input.signal.reason);
      if (!entry.canDecodeFileData()) {
        throw new CorruptArchiveError(`unsupported or encrypted ZIP entry: ${entry.fileName}`);
      }

      const fileName = yauzlModern.getFileNameLowLevel(
        entry.generalPurposeBitFlag,
        entry.fileNameRaw,
        entry.extraFields,
        false,
      );
      const type = getEntryType(fileName, entry.externalFileAttributes);
      const path = fileName.endsWith('/') ? fileName.slice(0, -1) : fileName;
      const common = {
        path,
        type,
        size: type === 'directory' ? 0 : entry.uncompressedSize,
        mode: getMode(fileName, entry.externalFileAttributes),
        mtime: entry.getLastModDate(),
        sourceFormat: 'zip',
        metadata: { compressedSize: entry.compressedSize },
      } satisfies ArchiveEntry;

      if (type === 'directory') {
        yield common;
        continue;
      }

      if (type === 'symlink') {
        const body = await archive.openReadStreamPromise(entry);
        const target = await readSmallBuffer(body, MAX_LINK_TARGET_BYTES, path);
        yield { ...common, linkTarget: target.toString('utf8') };
        continue;
      }

      let consumed = false;
      yield {
        ...common,
        stream: () => {
          if (consumed)
            throw new CorruptArchiveError(`entry stream consumed more than once: ${path}`);
          consumed = true;
          return Readable.from(
            (async function* () {
              const body = await archive.openReadStreamPromise(entry);
              for await (const chunk of body) yield chunk;
            })(),
          );
        },
      };
    }
    entriesDrained = true;
  } catch (error) {
    closeArchive();
    if (error instanceof AbortError || error instanceof CorruptArchiveError) throw error;
    throw new CorruptArchiveError(`invalid ZIP archive: ${(error as Error).message}`, {
      cause: error,
    });
  } finally {
    // If the generator is abandoned before draining (consumer error), close
    // here as well; success and normal-drain paths rely on pipeline teardown.
    if (!entriesDrained) closeArchive();
  }
}

async function readSmallBuffer(
  stream: NodeJS.ReadableStream,
  limit: number,
  entryPath: string,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const value of stream) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value as unknown as Uint8Array);
    size += chunk.length;
    if (size > limit) throw new EntrySizeExceededError(entryPath, size, limit);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

export const zipPlugin: ArchivePlugin = {
  name: 'zip',
  formats: ['zip'],
  detect: (buffer: Buffer) =>
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07),
  parse: parseZip,
};
