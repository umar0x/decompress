# Phase 4 — Upgraded @umar0x/decompress 1.0.0 vs baseline vs competitors

Run date: 2026-09-03. Node v24.19.0, Linux x64, 2 vCPU, 4.1 GiB RAM.
Identical corpus (SHA-256 verified against the frozen manifest), identical methodology
(5 independent runs per cell, 1 cold + 2 warm calls, medians reported, raw samples
preserved in `phase4/perf/raw.json`). All libraries ran back to back in the same
session.

## Measurement honesty notes

- Phase 1 and Phase 4 ran ~1.5 hours apart on the same shared host. Host load drifted
  between sessions: in the Phase 4 session the competitors were also re-measured, and
  both got slower (decompress 4.2.1: zip-many 5345 -> 5579 ms warm; @xhmikosr:
  zip-many 2711 -> 3332 ms warm). Because the drift penalizes everyone measured in
  the Phase 4 session, our before/after improvements are understated, not overstated.
  The ours-vs-competitors tables are same-session and unaffected.
- The +1 fd delta observed for our library (and sometimes kevva) was root-caused
  during Phase 2 as a Node 24 runtime artifact: a bare `createReadStream.pipe(gunzip)`
  control script leaves a `/dev/null` fd behind as well (io_uring/eventfd/pipe trio).
  It is not a library handle leak.

## Before / after for @umar0x/decompress (native, warm medians)

| Scenario               |  Before |   After |                                                         Change |
| ---------------------- | ------: | ------: | -------------------------------------------------------------: |
| zip-small              |   127ms |  63.5ms |                                                           -50% |
| zip-many               |  3191ms |  2608ms |                                                           -18% |
| tar-small              |  72.9ms |  23.3ms |                                                           -68% |
| tar-many               |  2057ms |  1918ms |                                                            -7% |
| targz-small            |  72.0ms |  22.2ms |                                                           -69% |
| targz-many             |  2140ms |  1895ms |                                                           -11% |
| targz-deep (60 levels) |   748ms |   152ms |                                                           -80% |
| targz-unicode          |   141ms |  55.0ms |                                                           -61% |
| tar-perms              |  55.8ms |  19.0ms |                                                           -66% |
| tarbz2-small           |   109ms |  58.2ms |                                                           -47% |
| tarbz2-many            |  2271ms |  2142ms |                                                            -6% |
| targz-realworld        |   192ms |  54.4ms |                                                           -72% |
| targz-realregistry     |   7.8ms |   5.3ms |                                                           -33% |
| zip-large-single       |   541ms |   567ms | +5% (within run variance; both sessions beat both competitors) |
| targz-large-single     |   585ms |   587ms |                                                             0% |
| concurrent-8x          | 13429ms | 11323ms |                                                           -16% |

What changed to produce this: redundant per-file lstat walks removed (10,052 -> 2
syscalls on zip-many), per-file utimes deferred into bounded parallel batches, and
ZIP writes scheduled through a bounded worker pool (default 8). TAR-family formats
remain sequential by format constraint. Full detail in [detailed-comparison.md](./detailed-comparison.md).

## Ours vs competitors, phase 4 same-session (warm medians)

| Scenario           | umar0x-native | decompress | @xhmikosr | Winner                     |
| ------------------ | ------------: | ---------: | --------: | -------------------------- |
| zip-small          |        63.5ms |     90.8ms |    54.4ms | @xhmikosr (+9ms)           |
| zip-many           |        2608ms |     5579ms |    3332ms | umar0x                     |
| tar-small          |        23.3ms |     79.5ms |    18.1ms | @xhmikosr (+5ms)           |
| tar-many           |        1918ms |     4988ms |    2290ms | umar0x                     |
| targz-small        |        22.2ms |     80.9ms |    32.2ms | umar0x                     |
| targz-many         |        1895ms |     5448ms |    2351ms | umar0x                     |
| targz-deep         |         152ms |     6039ms |    1343ms | umar0x (8.8x vs @xhmikosr) |
| targz-unicode      |        55.0ms |      148ms |    47.1ms | @xhmikosr (+8ms)           |
| tar-perms          |        19.0ms |     51.1ms |    15.7ms | @xhmikosr (+3ms)           |
| tarbz2-small       |        58.2ms |      104ms |    43.3ms | @xhmikosr (+15ms)          |
| tarbz2-many        |        2142ms |     5516ms |    2697ms | umar0x                     |
| targz-realworld    |        54.4ms |      291ms |    78.6ms | umar0x                     |
| targz-realregistry |         5.3ms |      6.3ms |     5.5ms | umar0x                     |
| zip-large-single   |         567ms |      782ms |     767ms | umar0x                     |
| targz-large-single |         587ms |      767ms |     705ms | umar0x                     |
| concurrent-8x      |       11323ms |    42133ms |   17773ms | umar0x                     |

Score: umar0x 10, @xhmikosr 6, decompress 0. The scenarios @xhmikosr wins are all
small archives (<= 100 files) with absolute margins of 3-15ms; the scenarios umar0x
wins are every throughput, memory, and concurrency-heavy case, often by 15-40%.
decompress (kevva) wins nothing in either session.

## Peak RSS (medians, phase 4)

| Scenario           | umar0x-native | decompress | @xhmikosr |
| ------------------ | ------------: | ---------: | --------: |
| zip-large-single   |       19.0MiB |     479MiB |    204MiB |
| targz-large-single |       21.9MiB |     504MiB |    327MiB |
| zip-many           |        140MiB |     286MiB |    277MiB |
| targz-deep         |       27.0MiB |     124MiB |   84.5MiB |
| targz-realworld    |       19.4MiB |    39.2MiB |   24.3MiB |

Large single files: 10-25x less memory than the buffered competitors, because the
streaming writer never holds archive or file content in the heap.

## Security matrix (phase 4, re-verification after the upgrade)

61 adversarial fixtures per library (24 independently crafted + 37 repository
regression fixtures), default policy:

| Metric                              | umar0x (phase 1) | umar0x (phase 4) | decompress | @xhmikosr |
| ----------------------------------- | ---------------: | ---------------: | ---------: | --------: |
| Escapes (write/symlink/hardlink)    |                0 |                0 |          9 |         0 |
| Partial outputs after rejection     |                0 |                0 |          4 |        10 |
| Crashes / hangs / no-report         |                0 |                0 |          0 |         0 |
| Opted-in link containment (12 runs) |        0 escapes |        0 escapes |        n/a |       n/a |

Integrity: 68 extraction trees compared byte-for-byte against Python tarfile/zipfile
ground truth across all libraries: zero mismatches in either phase. No content
corruption anywhere, before or after the upgrade.

Advisory status (verified via npm audit + OSV on 2026-09-03): decompress 4.2.1 has
4 open advisories (2 critical, 2 moderate) with no fix; @xhmikosr/decompress 11.1.4
is clean (its one critical advisory was fixed in 11.1.3); @umar0x/decompress has 0
advisories.

## Interrupt behavior (phase 4)

SIGKILL at 400/800/1600/2400ms mid-extraction of targz-many: umar0x leaves the
output absent until commit (staging siblings only, documented naming), while
decompress and @xhmikosr leave partially-populated output trees directly on disk
(from the phase 1 probe and the phase 4 runs; see the interrupt test records in the benchmark workspace).

## Developer experience and packaging (phase 4)

| Parameter           | @umar0x/decompress 1.0.0                   | decompress 4.2.1                  | @xhmikosr 11.1.4                |
| ------------------- | ------------------------------------------ | --------------------------------- | ------------------------------- |
| Tarball size        | 51 KB (was 133 KB)                         | 3.3 KB                            | 5.6 KB                          |
| Unpacked size       | ~250 KB (was 598 KB)                       | 8.1 KB                            | 15 KB                           |
| Direct runtime deps | 3                                          | 8                                 | 6                               |
| Installed prod tree | 6.7 MB / 34 packages (bzip2 chain)         | 1.5 MB / 139 packages             | 1.26 MB / 56 packages           |
| TypeScript types    | bundled                                    | none                              | none                            |
| ESM + CJS           | both verified                              | CJS only                          | ESM only                        |
| Node engines        | >= 22                                      | none declared                     | >= 20                           |
| Own-suite coverage  | 92.5% lines / 84.5% branches / 96.6% funcs | suite cannot run on Node 24       | 96.8% / 94.7% / 100% (index.js) |
| Lint                | eslint + prettier clean                    | toolchain cannot run              | xo clean                        |
| Test result         | 299/299                                    | harness incompatible with Node 24 | 40 pass / 1 skipped             |

Compatibility gained: archives with `./`-prefixed paths (the `tar czf x.tgz .`
shape) now extract; previously rejected. Sibling names like `..foo` are no longer
misjudged as traversal. Traversal, absolute, UNC, ADS, device-name, and
duplicate-path rejection behavior is unchanged and covered by regression tests.

## Where 1.0.0 still loses, honestly

- Small-archive latency (<= 100 files): @xhmikosr finishes 3-15ms faster per call.
  Their path is a single direct write loop; ours pays for atomic staging, per-entry
  policy validation, and commit rename. That is a deliberate structural trade for
  atomic output and pre-write policy enforcement, not an unoptimized hot path.
- Install footprint: the bzip2 decoder chain (bare-*) costs ~6.7 MB installed.
  Documented; the direct dependency surface is still the smallest of the three.
- Node < 22 unsupported by design (Node 20 is EOL).
