# Threat model

## Security objective

Given attacker-controlled archive bytes, the library should create only policy-approved objects
inside the selected output, stay within explicit resource ceilings, and avoid exposing a partial
new output after a handled failure.

Protected assets include files outside the destination, existing destination content, process and
disk availability, credentials accessible to the Node process, and permission integrity of created
files.

## Trust boundaries

| Component                                 | Trust assumption                                       |
| ----------------------------------------- | ------------------------------------------------------ |
| Archive bytes, paths, modes, sizes, links | Untrusted                                              |
| `filter` and `map` results                | Untrusted and revalidated                              |
| Built-in parsers and writer               | Trusted library code                                   |
| Third-party and legacy plugins            | Trusted process code; emitted entries remain untrusted |
| Caller options and destination choice     | Trusted application policy                             |
| Output parent and local filesystem        | Must provide normal Node filesystem semantics          |
| Operating system and Node runtime         | Trusted computing base                                 |

The library makes no network requests. It does not authenticate an archive's origin or signature.

## Main attack classes and controls

### Path escape

Absolute paths, parent traversal, mixed separators, Windows drive/UNC paths, NTFS alternate data
streams, reserved device names, control characters, invalid Windows characters, and trailing
dots/spaces are rejected. Paths are NFC-normalized and checked for duplicates/case collisions.
Mapped paths run through the same checks.

### Symlink and hardlink escape

Both entry types are refused by default. When enabled, link targets are resolved with the correct
archive semantics and checked for containment. Writes check every existing ancestor for symlinks;
regular files use no-follow/exclusive creation. Hardlink targets must resolve to objects created in
the staging tree, and dependency ordering prevents forward-reference bypasses.

### Resource exhaustion

Input spooling enforces archive byte limits while reading. Declared sizes are checked before body
consumption and actual file bytes are checked per chunk. Entry count, total output, single-entry
output, depth, and compression ratio are bounded. These controls reduce denial-of-service risk but
cannot guarantee availability against CPU-heavy parser inputs, slow storage, exhausted inode
tables, or limits configured above host capacity.

### Permissions and metadata

Setuid, setgid, and sticky bits are stripped unconditionally. Safe file/directory modes are the
default, with the process umask applied. Preserving archive permissions is opt-in. Hardlink mtimes
are not independently changed because linked names share an inode.

### Partial state

Writes (sequential for TAR-family formats, bounded-concurrent for ZIP) occur in a private
sibling staging directory. A successful rename exposes the completed
tree. Handled failures and aborts remove staging best-effort. `overwrite: true` uses a backup rename
and restoration attempt rather than merging trees.

### Plugin abuse

Malicious entry records cannot bypass the policy/writer path. However, a plugin is JavaScript in
the same process and can import `node:fs`, access the network, read environment variables, or loop
forever. The interface is capability-minimal, not a security sandbox. Do not install or enable
untrusted plugins. Legacy plugins additionally require `legacyPluginUnsafe: true` because they use
an older, buffered contract.

## Residual risk

- An attacker able to mutate the output parent concurrently may exploit filesystem races that
  portable Node APIs cannot eliminate completely. Use a non-attacker-writable parent.
- NFS, SMB, FUSE, overlay, and unusual filesystems may not provide expected rename, no-follow,
  case, or durability semantics. Prefer a local filesystem and test the deployment target.
- Atomic rename is namespace atomicity, not crash-durable transaction logging. Power loss or
  `SIGKILL` can leave staging/backup siblings, and the library does not call directory `fsync`.
- A compromised process, runtime, native dependency, kernel, or privileged caller is out of scope.
- `auditArchive()` is a static risk report, not malware scanning or content validation.
- Encrypted archives, RAR, and 7z are unsupported rather than inspected.
- Archive parsing still consumes CPU. Apply external timeouts, process isolation, quotas, and
  concurrency limits for hostile multi-tenant workloads.

## Deployment hardening

Run extraction as an unprivileged user in a dedicated worker/container, place the output under a
private parent, set limits below host quotas, wire an `AbortSignal`, cap simultaneous jobs, validate
the extracted file types/content before use, and never execute extracted content automatically.
For high-risk uploads, combine this library with OS sandboxing, antivirus/content scanning, and
archive authenticity verification.
