export { extract } from './extract.ts';
export { listArchive } from './list.ts';
export { auditArchive } from './audit.ts';

export * from './types.ts';
export * from './errors.ts';

export {
  isInsideOutput,
  validatePath,
  normalizePath,
  stripDotSegments,
  checkDuplicate,
  checkCaseCollision,
  WINDOWS_DEVICE_NAME_REGEX,
  NTFS_ADS_REGEX,
  detectPlatform,
} from './writer/path-security.ts';

export { sanitizeMode } from './policy/permission-policy.ts';
export { parseSize, resolveLimits } from './policy/limits-policy.ts';
export { DEFAULT_LIMITS } from './types.ts';
export { validateSymlinkTarget, validateHardlinkTarget } from './policy/link-policy.ts';

export { validateArchiveEntry, validateMappedEntry } from './entry-validation.ts';
