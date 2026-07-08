# Security policy

## Reporting a vulnerability

Do not open a public issue for an unpatched vulnerability. Use
[GitHub Security Advisories](https://github.com/umar0x/decompress/security/advisories/new) and
include the affected version, impact, smallest reproducible archive/code sample, and any proposed
mitigation.

The project aims to acknowledge reports within seven days, provide an initial assessment within 14
days, and coordinate disclosure after a fix is available. These are response targets rather than a
contractual SLA.

Security fixes target the latest release line. Consumers should review changelogs because security
hardening may occasionally require behavioral changes.

## Scope of the extraction controls

The native implementation is designed to prevent common archive traversal, symlink/hardlink
escape, unsafe-permission, partial-output, and decompression-bomb classes. Controls include path
normalization and containment, Windows-specific filename rejection, post-transform revalidation,
links disabled by default, special permission-bit stripping, exclusive/no-follow writes, private
staging, atomic rename commit, cancellation cleanup, and six resource ceilings.

These properties are covered by unit, integration, malicious-fixture, and fuzz regression tests.
They are not a formal proof and should not be interpreted as a certification or a guarantee against
unknown parser, runtime, operating-system, or filesystem vulnerabilities.

## Out of scope and deployment obligations

- Malware detection, content-type validation, archive authenticity, and signature verification.
- Encrypted archives, RAR, and 7z.
- Malicious JavaScript plugins; plugins execute with the process's full ambient authority.
- A compromised Node process, native dependency, kernel, or privileged operator.
- Concurrent attackers who can modify the output parent, and nonstandard filesystem semantics.
- Availability when callers configure limits above host capacity or run unbounded concurrent jobs.

Extract as an unprivileged user under a private parent, apply host quotas and job timeouts, use an
`AbortSignal`, keep links disabled unless required, and validate extracted content before opening or
executing it. See [the threat model](./docs/threat-model.md).

## Supply-chain controls in this repository

- CI builds, lints, tests, checks coverage, audits dependencies, and validates package tarballs.
- CodeQL analysis is configured.
- Releases are configured to publish with npm provenance.
- A CycloneDX SBOM is generated and uploaded by the release workflow.
- Published packages contain built output, package documentation, and the license only.

Repository protection, npm 2FA, token scoping, reviewer requirements, and organization ownership
are operational controls maintainers must configure in GitHub/npm; source files alone cannot prove
they are enabled.
