import {
  ArchiveSizeExceededError,
  CompressionRatioExceededError,
  DepthExceededError,
  EntrySizeExceededError,
  FileCountExceededError,
  InvalidInputError,
  TotalSizeExceededError,
} from '../errors.ts';
import type { Limits, SizeInput } from '../types.ts';
import { DEFAULT_LIMITS } from '../types.ts';

const SIZE_UNITS: Record<string, number> = {
  b: 1,
  kb: 1_000,
  kib: 1 << 10,
  mb: 1_000_000,
  mib: 1 << 20,
  gb: 1_000_000_000,
  gib: 1 << 30,
  tb: 1_000_000_000_000,
  tib: 1 << 40,
};

/**
 * Parse a size string or number into bytes.
 * Accepts: 2147483648, "512mb", "512MiB", "2gb", "2GiB", "1.5 kib", "0".
 * Rejects: "abc", "", "-1", unknown units.
 */
export function parseSize(input: SizeInput): number {
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input < 0 || !Number.isInteger(input)) {
      throw new InvalidInputError(`size must be a non-negative finite integer, got ${input}`);
    }
    return input;
  }
  const match = /^\s*(\d+(?:\.\d+)?)\s*([a-z]*)\s*$/i.exec(input);
  if (!match) {
    throw new InvalidInputError(`unrecognized size string: ${JSON.stringify(input)}`);
  }
  if (match[1] === undefined) {
    throw new InvalidInputError(`unrecognized size string: ${JSON.stringify(input)}`);
  }
  const value = Number(match[1]);
  const unit = (match[2] ?? '').toLowerCase() || 'b';
  const multiplier = SIZE_UNITS[unit];
  if (multiplier === undefined) {
    throw new InvalidInputError(`unknown size unit: ${JSON.stringify(match[2])}`);
  }
  const bytes = Math.floor(value * multiplier);
  if (!Number.isSafeInteger(bytes)) {
    throw new InvalidInputError(`size out of safe-integer range: ${input}`);
  }
  return bytes;
}

export function resolveLimits(opts: {
  maxArchiveSize?: SizeInput;
  maxFiles?: number;
  maxTotalSize?: SizeInput;
  maxEntrySize?: SizeInput;
  maxDepth?: number;
  maxCompressionRatio?: number;
}): Limits {
  validateCount('maxFiles', opts.maxFiles, 0);
  validateCount('maxDepth', opts.maxDepth, 0);
  if (
    opts.maxCompressionRatio !== undefined &&
    (!Number.isFinite(opts.maxCompressionRatio) || opts.maxCompressionRatio <= 0)
  ) {
    throw new InvalidInputError('maxCompressionRatio must be a positive finite number');
  }
  return {
    maxArchiveSize:
      opts.maxArchiveSize !== undefined
        ? parseSize(opts.maxArchiveSize)
        : DEFAULT_LIMITS.maxArchiveSize,
    maxFiles: opts.maxFiles ?? DEFAULT_LIMITS.maxFiles,
    maxTotalSize:
      opts.maxTotalSize !== undefined ? parseSize(opts.maxTotalSize) : DEFAULT_LIMITS.maxTotalSize,
    maxEntrySize:
      opts.maxEntrySize !== undefined ? parseSize(opts.maxEntrySize) : DEFAULT_LIMITS.maxEntrySize,
    maxDepth: opts.maxDepth ?? DEFAULT_LIMITS.maxDepth,
    maxCompressionRatio: opts.maxCompressionRatio ?? DEFAULT_LIMITS.maxCompressionRatio,
  };
}

function validateCount(name: string, value: number | undefined, minimum: number): void {
  if (value === undefined) return;
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new InvalidInputError(
      `${name} must be a safe integer greater than or equal to ${minimum}`,
    );
  }
}

export function checkArchiveSize(size: number, limits: Limits): void {
  if (size > limits.maxArchiveSize) {
    throw new ArchiveSizeExceededError(size, limits.maxArchiveSize);
  }
}

export function checkFileCount(count: number, limits: Limits): void {
  if (count > limits.maxFiles) {
    throw new FileCountExceededError(count, limits.maxFiles);
  }
}

export function checkTotalSize(total: number, limits: Limits): void {
  if (total > limits.maxTotalSize) {
    throw new TotalSizeExceededError(total, limits.maxTotalSize);
  }
}

export function checkEntrySize(entryPath: string, size: number, limits: Limits): void {
  if (size > limits.maxEntrySize) {
    throw new EntrySizeExceededError(entryPath, size, limits.maxEntrySize);
  }
}

export function checkDepth(entryPath: string, depth: number, limits: Limits): void {
  if (depth > limits.maxDepth) {
    throw new DepthExceededError(entryPath, depth, limits.maxDepth);
  }
}

export function checkCompressionRatio(
  totalExtracted: number,
  archiveSize: number,
  limits: Limits,
): void {
  if (archiveSize <= 0) return;
  const ratio = totalExtracted / archiveSize;
  if (ratio > limits.maxCompressionRatio) {
    throw new CompressionRatioExceededError(ratio, limits.maxCompressionRatio);
  }
}
