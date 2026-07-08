# Architecture

## Native extraction pipeline

```text
path / Buffer / Node stream / Web stream / async iterable
  -> bounded input resolver (stream inputs spool to a private temporary file)
  -> magic-byte detection
  -> ZIP or TAR-family parser
  -> untrusted ArchiveEntry stream
  -> strip/filter/map and post-transform validation
  -> duplicate, collision, permission, link, and resource policies
  -> sequential secure writer in a private sibling staging directory
  -> directory metadata finalization
  -> atomic rename commit
  -> ExtractResult
```

`listArchive()` and `auditArchive()` share input resolution, detection, parsers, plugin selection,
and cleanup. They drain bodies without writing. Extraction alone invokes the secure writer.

## Why the pipeline is sequential

Entry bodies from TAR-family formats are inherently ordered streams. The writer consumes one body
before the parser advances, which keeps memory bounded and preserves deterministic duplicate and
hardlink behavior. ZIP input is random-access, but it uses the same sequential writer so policy
behavior is format-independent. Job-level concurrency belongs to the calling service, where disk,
memory, and tenant quotas can be enforced explicitly.

## Input ownership

- File paths stay file-backed and are opened by parser stream factories.
- Caller-owned `Buffer` values remain in memory and are never copied wholesale by the resolver.
- One-shot streams are spooled to a mode-restricted temporary file while enforcing
  `maxArchiveSize` per chunk. This allows parser retries and ZIP central-directory access without an
  unbounded heap buffer.
- Resolver-owned temporary files are removed in `finally` blocks.

## Parser contract

Parsers emit `ArchiveEntry` records. File entries expose a stream factory when possible. TAR body
streams are drained automatically if a consumer skips an entry. ZIP uses `yauzl` lazy entry reads.
Parser errors are normalized to typed corruption or unsupported-feature errors.

Plugin records are treated exactly like built-in parser records: types, paths, declared sizes,
links, modes, transforms, and actual streamed bytes are validated before commit. Plugins are not a
sandbox; they are ordinary code loaded into the caller's process.

## Policy and writer boundary

Pre-write policy performs normalization, traversal/absolute/Windows checks, depth checks,
duplicate and case-collision checks, option transforms, declared-size limits, and permission
sanitization. The writer then enforces containment against the staging root, refuses writes through
symlink ancestors, uses no-follow/exclusive file creation, loops on partial writes, and applies
rolling actual-byte limits.

The staging directory is created as a private sibling of the destination. Keeping it on the same
filesystem allows rename to be the commit primitive. An `EXDEV` error is returned instead of
falling back to a non-atomic copy.

## Atomic replacement

For a new destination, staging is renamed into place only after extraction succeeds. For
`overwrite: true`, an existing destination is first renamed to a random backup, staging is renamed
to the destination, and the backup is removed. If the second rename fails, restoration is
attempted. A hard crash can leave a staging or backup directory; callers may remove only known
`.decompress-tmp-*` or `.decompress-backup-*` siblings after verifying no extraction is active.

## Hardlink ordering and directory metadata

Hardlinks are deferred until regular files and directories exist. Forward hardlink chains are
resolved in repeated passes; unresolved or cyclic chains fail. Directory mtimes are applied after
all child writes, deepest directory first, because child creation mutates parent mtimes.

## Package boundaries

```text
@umar0x/decompress-cli ------------> @umar0x/decompress
@umar0x/decompress-compatible -----> @umar0x/decompress
                                          |
                       formats -> policies -> secure writer
```

The compatibility package intentionally performs an additional extract/read/transform/replay
cycle so callbacks receive `data` buffers while final writes still pass through native policy. It
is not on the performance-critical product path.

## Verification gates

- Strict TypeScript build and ESLint/Prettier checks.
- Unit, integration, security regression, compatibility, CLI, and deterministic fuzz suites.
- Global coverage thresholds: 85% lines/statements, 90% functions, 80% branches.
- Node 20, 22, and 24 CI across Linux, macOS, and Windows.
- Tarball smoke installation covering ESM, CommonJS, and the published CLI binary.
- `npm audit`, secret scanning, and provenance-enabled publish workflow.
