# Benchmark methodology

These documents record the measurements behind the performance and security claims in the
README. Raw sample data (every individual run, not just medians) is kept as JSON in the
benchmark workspace and summarized here in markdown.

## Environment

Node v24.19.0, Linux x64, 2 vCPU, 4.1 GiB RAM. All libraries under test ran back to back in the
same session against the same corpus files.

## Libraries

| Label         | Package                       | Version                                           |
| ------------- | ----------------------------- | ------------------------------------------------- |
| umar0x-native | @umar0x/decompress            | 1.0.2 (baseline phase: the pre-upgrade workspace) |
| umar0x-compat | @umar0x/decompress-compatible | 1.0.2 (baseline phase: the pre-upgrade workspace) |
| decompress    | decompress                    | 4.2.1                                             |
| @xhmikosr     | @xhmikosr/decompress          | 11.1.4                                            |

## Corpus

15 scenarios: 100-file and 5,000-file archives in all four formats, 128 MiB single-file ZIP and
TAR.GZ, 60-level nesting, 200 unicode-named files, mixed permission bits, a synthesized
350-file dependency-tree-shaped tarball, and the genuine `@xhmikosr/decompress` npm registry
tarball. Content is generated from a seeded PRNG; the corpus is frozen and its SHA-256 checksums
were verified identical between the baseline and post-upgrade phases.

## Timing

Five independent child processes per (scenario, library) cell. Each child performs one cold call
(first call after module import) and two warm calls. Reported numbers are medians across the five
runs; mean, median, stdev, min, and max for every cell are in the raw JSON output. No runs were
dropped.

Memory is `process.resourceUsage().maxRSS` sampled after import (baseline) and after extraction,
reported as the delta. File descriptor usage is the `/proc/self/fd` count before and after with a
150 ms settle delay.

## Security matrix

Every adversarial fixture runs in a per-run sandbox with a planted outside-sentinel directory
(seeded secret files). Detection covers write escapes (before/after snapshot diff of the sandbox
outside the output), symlink escapes (resolving every produced link against the output root),
hardlink escapes (inode identity with the sentinel files), partial outputs after rejection, and
per-fixture timeouts (20 s default, 60 to 90 s for decompression bombs). Opt-in link runs verify
that enabled links remain containment-checked.

Benign fixtures are extracted by Python `tarfile` and `zipfile` as ground truth; each library's
output tree (path, type, size, sha256) is compared byte-for-byte against it.

The fixture set is 61 archives per library: 24 crafted independently for this comparison (zip
slip, deep traversal, three-hop symlink chains, hardlinks to outside targets, 256 MiB
decompression bombs, NUL-byte and device-name paths, encrypted ZIP, duplicates, 200-level
nesting, truncations, empty archives, garbage) plus the 37 regression fixtures kept in
`packages/test-fixtures/malicious`.

## Interrupt test

SIGKILL at 400, 800, 1600, and 2400 ms during extraction of a 5,000-file TAR.GZ, followed by
sandbox inspection for committed output and staging leftovers.

## What was not tested

- Disk-full behavior: the benchmark container does not permit mounting a size-limited
  filesystem, so ENOSPC paths were not simulated.
- Node 22 and 26 execution: only Node 24.19.0 was available. Support statements for those
  versions come from the `engines` field and the CI matrix, not local execution.
