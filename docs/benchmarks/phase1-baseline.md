# Phase 1 Baseline — @umar0x/decompress (pre-upgrade) vs decompress vs @xhmikosr/decompress

Run date: 2026-09-03. Node v24.19.0, Linux x64, Intel Xeon, 2 vCPU, 4.1 GiB RAM.
All three libraries were exercised in the same session, back to back, from identical
corpus files (frozen, SHA-256 manifest verified identical between phases).

Libraries under test:

| Label         | Package                       | Version                                                       | Input                                |
| ------------- | ----------------------------- | ------------------------------------------------------------- | ------------------------------------ |
| umar0x-native | @umar0x/decompress            | 1.0.0 (workspace, pre-upgrade; published npm latest is 0.0.1) | local clone, dist build              |
| umar0x-compat | @umar0x/decompress-compatible | 1.0.0 (workspace)                                             | local clone, dist build              |
| decompress    | decompress                    | 4.2.1                                                         | local clone (equals registry 4.2.1)  |
| xhmikosr      | @xhmikosr/decompress          | 11.1.4                                                        | local clone (equals registry 11.1.4) |

Weekly downloads at run time (npm API, week 2026-08-23..29): decompress 3,701,224;
@xhmikosr/decompress 4,837,211; @umar0x/decompress 10.

## Methodology

- Performance: 5 independent child processes per (scenario, library) cell. Each child
  performs 1 cold call (first call after module import) + 2 warm calls. Statistics are
  reported across the 5 runs: mean, median, stdev, min, max (raw.json contains every
  individual sample; no runs were dropped).
- Memory: `process.resourceUsage().maxRSS` sampled after import (baseline) and after
  extraction (final). Reported value is the delta. maxRSS is a high-water mark.
- FD usage: `/proc/self/fd` count before and after, after a 150 ms settle delay.
- Security: every fixture runs in a per-run sandbox with an outside-sentinel directory
  (planted secret files), write-escape detection via before/after snapshot diff,
  symlink-escape detection by resolving every produced link against the output root,
  hardlink-escape detection via inode identity with sentinel files, partial-output
  detection, and per-fixture timeouts (20 s default, 60-90 s for bombs/slow fixtures).
- Integrity: benign fixtures are extracted by Python `tarfile`/`zipfile` as ground
  truth; each library's tree (path + type + size + sha256) is compared to it.
- Interruption: SIGKILL at 400/800/1600/2400 ms during extraction of targz-many,
  followed by sandbox inspection.
- Disk-full simulation: not performed (the benchmark container does not permit mounting
  a size-limited filesystem). Recorded honestly as untested rather than approximated.
- Node version matrix: only Node 24.19.0 was available in the benchmark environment.
  Claims about Node 22/26 support below come from each package's `engines` field and CI
  configuration, not from local execution.

## Performance (medians across 5 runs; full stats in perf/raw.json)

### Cold first-call latency (ms)

| Scenario                    | umar0x-native | umar0x-compat | decompress | @xhmikosr |
| --------------------------- | ------------: | ------------: | ---------: | --------: |
| zip-small (100x1KB)         |         136.2 |         223.9 |      145.3 |      92.9 |
| zip-many (5000x512B)        |        3683.9 |        6853.2 |     5413.7 |    2922.6 |
| zip-large-single (1x128MB)  |         594.5 |         743.6 |      712.7 |     735.8 |
| tar-small                   |          74.2 |         146.3 |      103.7 |      45.4 |
| tar-many                    |        2455.4 |        5462.5 |     4492.8 |    1874.6 |
| targz-small                 |          85.0 |         156.5 |      124.8 |      64.9 |
| targz-many                  |        2511.1 |        5372.9 |     4548.0 |    1969.0 |
| targz-large-single          |         648.4 |         774.9 |      752.7 |     832.4 |
| targz-deep (60 levels)      |         811.2 |        1739.5 |     5987.5 |    1380.6 |
| targz-unicode (200 files)   |         157.8 |         294.4 |      173.5 |      80.6 |
| tar-perms                   |          61.7 |         136.9 |       75.4 |      42.7 |
| tarbz2-small                |         120.8 |         206.8 |      163.6 |      82.7 |
| tarbz2-many                 |        2724.6 |        5992.0 |     4832.3 |    2252.8 |
| targz-realworld (350 files) |         198.9 |         343.4 |      364.4 |     111.2 |
| targz-realregistry          |          23.6 |          34.1 |       20.4 |      23.0 |

### Warm latency (ms)

| Scenario           | umar0x-native | umar0x-compat | decompress | @xhmikosr |
| ------------------ | ------------: | ------------: | ---------: | --------: |
| zip-small          |         126.8 |         188.5 |      124.8 |      83.5 |
| zip-many           |        3191.1 |        6242.4 |     5344.8 |    2711.3 |
| zip-large-single   |         541.0 |         664.8 |      652.7 |     711.1 |
| tar-small          |          72.9 |         143.4 |      104.1 |      38.6 |
| tar-many           |        2056.7 |        5216.6 |     4442.4 |    1414.1 |
| targz-small        |          72.0 |         143.6 |      101.6 |      46.6 |
| targz-many         |        2140.3 |        5153.7 |     4406.8 |    1736.9 |
| targz-large-single |         585.1 |         713.1 |      709.1 |     736.4 |
| targz-deep         |         748.2 |        1497.0 |     6091.8 |    1240.6 |
| targz-unicode      |         140.5 |         256.6 |      154.4 |      74.3 |
| tar-perms          |          55.8 |         131.8 |       69.6 |      40.9 |
| tarbz2-small       |         109.3 |         187.0 |      139.7 |      58.3 |
| tarbz2-many        |        2270.5 |        5313.3 |     4762.9 |    2164.7 |
| targz-realworld    |         191.8 |         298.0 |      278.0 |     100.7 |
| targz-realregistry |           7.8 |          12.1 |        7.8 |       6.5 |

### Peak RSS delta (MiB)

| Scenario           | umar0x-native | umar0x-compat | decompress | @xhmikosr |
| ------------------ | ------------: | ------------: | ---------: | --------: |
| zip-small          |            21 |            21 |         21 |        34 |
| zip-many           |           150 |           144 |        284 |       292 |
| zip-large-single   |            19 |           146 |        517 |       204 |
| tar-many           |           107 |           141 |        276 |       210 |
| targz-many         |           119 |           152 |        263 |       204 |
| targz-large-single |            22 |           149 |        530 |       327 |
| targz-deep         |            27 |            26 |        124 |        80 |
| tarbz2-many        |           172 |           183 |        305 |       229 |
| targz-realworld    |            19 |            18 |         39 |        23 |

### Concurrency (8 parallel extractions of targz-many)

| Library       | Total wall (ms, median) | Successful runs |
| ------------- | ----------------------: | --------------- |
| umar0x-native |                13,428.7 | 5/5             |
| umar0x-compat |                29,996.5 | 5/5             |
| decompress    |                40,239.0 | 5/5             |
| @xhmikosr     |                17,263.4 | 5/5             |

### Input shapes (umar0x-native only)

targz-many via Buffer: 2,097.5 ms warm; via Web ReadableStream (spooled): 2,056.2 ms.
targz-large-single via Buffer: 565.3 ms warm, 79 MiB RSS; via stream: 640.3 ms, 66 MiB RSS.

### Reading of the perf baseline

- @xhmikosr is the latency leader on small and many-file scenarios (roughly 1.5-2x
  faster than umar0x-native on zip-small/tar-small/targz-small; ~1.2-1.5x on the
  5000-file scenarios). decompress (kevva) is slowest on nearly everything.
- umar0x-native wins the CPU-bound large-single-file scenarios in both time and
  memory: 541/585 ms warm at 19-22 MiB RSS vs 653-736 ms at 204-530 MiB. The streaming
  writer and file-backed input avoid the competitors' whole-archive buffering.
- umar0x-native wins deep nesting by ~1.7x over @xhmikosr and ~8x over decompress
  (748 ms vs 1241 ms vs 6092 ms warm). The competitors' per-file recursive
  realpath chains dominate at depth.
- umar0x-native wins the 8-way concurrency scenario (13.4 s vs 17.3 s vs 40.2 s).
- umar0x-compat is the slowest in every scenario by design (documented: it performs a
  full secure extraction pass, a read-back, and a replay pass).
- FD leak: umar0x-native and umar0x-compat show a consistent +1 fd delta across runs;
  decompress shows +1 in some runs; @xhmikosr shows 0. This is worth a code-level
  investigation (Phase 2) to determine whether it is a real handle leak or an
  artifact of the measurement (the +1 also appears for kevva in some runs, and both
  umar0x libraries share the input peek/spool path).

## Security matrix (61 adversarial fixtures + 37 repo malicious fixtures)

Full data in sec/raw.json (256 results) and sec/matrix.md. Summary:

| Metric (default policy)                                  |          umar0x-native |       umar0x-compat |          decompress |           @xhmikosr |
| -------------------------------------------------------- | ---------------------: | ------------------: | ------------------: | ------------------: |
| Escapes (write)                                          |                      0 |                   0 |                   0 |                   0 |
| Escapes (symlink, created links pointing outside output) |                      0 |                   0 |                   7 |                   0 |
| Escapes (hardlink to outside file, incl. /etc/passwd)    |                      0 |                   0 |                   1 |                   0 |
| Partial output left after rejection                      |                      0 |                   0 |                   4 |                  10 |
| Zip bombs (256 MiB): outcome                             | REJECTED (ratio limit) | EXTRACTED @ 327 MiB | EXTRACTED @ 584 MiB | EXTRACTED @ 365 MiB |
| Depth-200 archive                                        |    REJECTED (maxDepth) |            REJECTED |           EXTRACTED |           EXTRACTED |
| 10,002-file archive                                      |    REJECTED (maxFiles) |            REJECTED |           EXTRACTED |           EXTRACTED |
| Encrypted ZIP                                            |        REJECTED, typed |     REJECTED, typed |            REJECTED |            REJECTED |
| Truncated archives                                       |        REJECTED, typed |     REJECTED, typed |            REJECTED |            REJECTED |

Concrete verified attacks against decompress 4.2.1 in this run:

1. `tar-hardlink-outside.tar` / `hardlink-to-absolute.tar`: decompress created a
   hardlink to /etc/passwd inside the output (verified: nlink=2, root-owned inode,
   /etc/passwd content readable through the extracted path). Same class as
   GHSA-jwp9-9v96-94mx.
2. `zip-symlink-escape.zip`, `tar-symlink-abs.tar`, `slip.zip`, `link_via_trap.tar.gz`,
   `symlink-chain-escape.tar`, `symlink-to-parent.tar`, `symlink_escape.tar.gz`:
   decompress created symlinks whose targets resolve outside the output directory
   (including to /etc/passwd and to sandbox sentinel files). Same class as
   GHSA-mp2f-45pm-3cg9 / CVE-2026-53486 (CRITICAL).
3. Path traversal (`../../`) is blocked by all three libraries (the 2020 kevva fix
   and its descendants work), matching GHSA-qgfr-5hqp-vrw9 being historical.

umar0x-native with `allowSymlinks`/`allowHardlinks` opted in still rejected every
escaping link fixture (containment validation), with zero escapes in all 14 opt-in
runs.

Advisory history (npm audit + OSV, verified 2026-09-03):

- decompress 4.2.1: 4 advisories, all open/unfixed: GHSA-qgfr-5hqp-vrw9 (CVE-2020-12265,
  CRITICAL), GHSA-mp2f-45pm-3cg9 (CVE-2026-53486, CRITICAL), GHSA-h39j-r5qq-r9mm
  (CVE-2026-10732, MODERATE, zip-slip), GHSA-jwp9-9v96-94mx (CVE-2026-39243, MODERATE,
  hardlink).
- @xhmikosr/decompress: GHSA-mp2f-45pm-3cg9 affected < 10.2.1 and 11.0.0-< 11.1.3;
  fixed in 10.2.1 / 11.1.3. 11.1.4 currently clean (0 vulnerabilities).
- @umar0x/decompress: 0 advisories.

## Integrity

All four libraries produced byte-identical trees (path + type + size + sha256) to the
Python ground truth for every benign fixture they extracted. No content corruption was
observed anywhere in this phase.

Compatibility notes from the benign set:

- `leading_dots.tar.gz` (entries like `./file`): umar0x rejects ('.' segment policy);
  decompress and @xhmikosr extract. This is the shape produced by `tar czf x.tgz .`,
  a common real-world command, and is a compatibility gap for umar0x.
- `symlink.tar` / `link.tar`: umar0x refuses links by default (documented posture);
  competitors extract them.
- `tar-mixed-sep.tar` (`folder\file.txt`): umar0x rejects (backslash in POSIX path);
  competitors create literal filenames containing backslashes.
- `tar-win-device.tar` (CON, NUL.txt): umar0x rejects on all platforms; @xhmikosr
  rejects only on Windows; decompress extracts.

## Interruption (SIGKILL mid-extraction)

| Library       | Output state after kill (pre-completion)                                                                                 | Staging leftovers                            |
| ------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| umar0x-native | output absent until commit; complete or nothing                                                                          | `.decompress-tmp-*.tmp` sibling (documented) |
| umar0x-compat | output absent until commit                                                                                               | same staging behavior                        |
| decompress    | partial tree committed directly in output (supplementary probe: 26 entries at 2.4 s, 50 at 2.8 s of a ~4.4 s extraction) | none (writes in place)                       |
| @xhmikosr     | partial tree committed directly in output (50 dirs observed at 0.8 s kill)                                               | none                                         |

## Developer experience and ecosystem

| Parameter             | @umar0x/decompress                                                                      | decompress                                            | @xhmikosr                                               |
| --------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------- |
| Tarball size          | 133 KB (383 KB of source maps dominate)                                                 | 3.3 KB                                                | 5.6 KB                                                  |
| Unpacked size         | 598 KB / 33 files                                                                       | 8.1 KB / 4 files                                      | 15 KB / 4 files                                         |
| Runtime deps (direct) | 3                                                                                       | 8                                                     | 6                                                       |
| Installed prod tree   | 6.7 MB / 34 packages (bzip2 chain: bare-url 3.7 MB, bare-fs 1.3 MB)                     | 1.5 MB / 139 packages                                 | 1.26 MB / 56 packages                                   |
| TypeScript types      | bundled d.ts (8.5+ KB)                                                                  | none                                                  | none                                                    |
| ESM + CJS             | both, verified                                                                          | CJS only                                              | ESM only (CJS require fails: ERR_REQUIRE_ESM by design) |
| Node engines          | >= 22                                                                                   | none declared (works on 24)                           | >= 20                                                   |
| Coverage (own suite)  | 89.01% stmts / 84.49% branch / 94.32% funcs                                             | suite cannot run on Node 24 (esm loader incompatible) | 96.81% / 94.73% / 100% (index.js)                       |
| Lint                  | eslint + prettier clean                                                                 | xo (cannot run)                                       | xo clean                                                |
| API shape             | promise, typed errors, limits, abort, progress                                          | promise, plugin opts                                  | promise, plugin opts                                    |
| Docs                  | README, MIGRATION, threat model, architecture, plugin guide, security policy, changelog | README                                                | README                                                  |
| License               | MIT                                                                                     | MIT                                                   | MIT                                                     |

## Where the baseline leaves us (Phase 2 input)

1. Latency on small/many-file scenarios is the main performance gap to @xhmikosr.
   Suspects (to be proven by profiling, not assumed): per-entry lstat/realpath walks in
   the secure writer, the atomic staging + rename + directory-mtime passes, and the
   per-entry warning/progress machinery.
2. The consistent +1 fd delta needs a root-cause investigation.
3. The published tarball carries 383 KB of source maps; packaging should drop them.
4. The install footprint (6.7 MB) is dominated by unbzip2-stream's transitive
   bare-* chain; check for a leaner version or document the cost explicitly.
5. `leading_dots.tar.gz` compatibility (rejecting `./`-prefixed entries) hurts real
   users of `tar czf archive.tgz .` and should be normalized rather than rejected.
6. Coverage floors for secure-writer.ts (70.17%) and legacy-adapter.ts (31.76%) are
   the weakest spots in the security-critical code.
7. npm audit fails in the dev tree (brace-expansion 5.0.8 is inside the vulnerable
   range 4.0.0-5.0.8; js-yaml 3.x/4.0.0-4.3.0), which blocks `npm run release:check`.
