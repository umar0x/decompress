# Phase 4 comparison — @umar0x/decompress 1.0.0 vs baseline vs competitors

- Phase 1 (baseline) run: 2026-09-03T03:31:58.216Z, Node v24.19.0
- Phase 4 (upgraded) run: 2026-09-03T05:08:54.272Z, Node v24.19.0
- Same host class (2 vCPU), same corpus (SHA-256 verified identical), same 5-run methodology
- All numbers are medians across 5 independent runs; raw samples are in each phase's raw.json

## Before / after for @umar0x/decompress (native)

| Scenario                 | Warm before (ms) | Warm after (ms) | Change | RSS before (MiB) | RSS after (MiB) |
| ------------------------ | ---------------: | --------------: | -----: | ---------------: | --------------: |
| zip-small                |            127ms |          63.5ms |   -50% |          21.3MiB |         25.1MiB |
| zip-many                 |           3191ms |          2608ms |   -18% |           150MiB |          140MiB |
| tar-small                |           72.9ms |          23.3ms |   -68% |          15.7MiB |         14.7MiB |
| tar-many                 |           2057ms |          1918ms |    -7% |           107MiB |          134MiB |
| targz-small              |           72.0ms |          22.2ms |   -69% |          15.7MiB |         13.9MiB |
| targz-many               |           2140ms |          1895ms |   -11% |           119MiB |          136MiB |
| targz-deep               |            748ms |           152ms |   -80% |          27.0MiB |         27.0MiB |
| targz-unicode            |            141ms |          55.0ms |   -61% |          18.2MiB |         18.8MiB |
| tar-perms                |           55.8ms |          19.0ms |   -66% |          12.9MiB |         13.7MiB |
| tarbz2-small             |            109ms |          58.2ms |   -47% |          27.7MiB |         27.2MiB |
| tarbz2-many              |           2271ms |          2142ms |    -6% |           172MiB |          179MiB |
| targz-realworld          |            192ms |          54.4ms |   -72% |          18.7MiB |         19.4MiB |
| targz-realregistry       |            7.8ms |           5.3ms |   -33% |           7.9MiB |          9.1MiB |
| zip-large-single         |            541ms |           567ms |     5% |          18.5MiB |         19.0MiB |
| targz-large-single       |            585ms |           587ms |     0% |          21.6MiB |         21.9MiB |
| concurrent-8x-targz-many |          13429ms |         11323ms |   -16% |                — |               — |

## Ours vs competitors, phase 4 (same-session, back to back)

| Scenario                 | umar0x-native | umar0x-compat | decompress | @xhmikosr | Winner        |
| ------------------------ | ------------: | ------------: | ---------: | --------: | ------------- |
| zip-small                |        63.5ms |         125ms |     90.8ms |    54.4ms | xhmikosr      |
| zip-many                 |        2608ms |        5435ms |     5579ms |    3332ms | umar0x-native |
| tar-small                |        23.3ms |        58.2ms |     79.5ms |    18.1ms | xhmikosr      |
| tar-many                 |        1918ms |        4115ms |     4988ms |    2290ms | umar0x-native |
| targz-small              |        22.2ms |        67.1ms |     80.9ms |    32.2ms | umar0x-native |
| targz-many               |        1895ms |        4467ms |     5448ms |    2351ms | umar0x-native |
| targz-deep               |         152ms |         334ms |     6039ms |    1343ms | umar0x-native |
| targz-unicode            |        55.0ms |         127ms |      148ms |    47.1ms | xhmikosr      |
| tar-perms                |        19.0ms |        48.6ms |     51.1ms |    15.7ms | xhmikosr      |
| tarbz2-small             |        58.2ms |         104ms |      104ms |    43.3ms | xhmikosr      |
| tarbz2-many              |        2142ms |        4854ms |     5516ms |    2697ms | umar0x-native |
| targz-realworld          |        54.4ms |         122ms |      291ms |    78.6ms | umar0x-native |
| targz-realregistry       |         5.3ms |         6.5ms |      6.3ms |     5.5ms | umar0x-native |
| zip-large-single         |         567ms |         731ms |      782ms |     767ms | umar0x-native |
| targz-large-single       |         587ms |         725ms |      767ms |     705ms | umar0x-native |
| concurrent-8x-targz-many |       11323ms |       27409ms |    42133ms |   17773ms | umar0x-native |

## Peak RSS delta, phase 4 (MiB)

| Scenario           | umar0x-native | umar0x-compat | decompress | @xhmikosr |
| ------------------ | ------------: | ------------: | ---------: | --------: |
| zip-small          |       25.1MiB |       25.4MiB |    18.8MiB |   34.4MiB |
| zip-many           |        140MiB |        150MiB |     286MiB |    277MiB |
| tar-small          |       14.7MiB |       16.1MiB |    13.0MiB |    7.5MiB |
| tar-many           |        134MiB |        145MiB |     252MiB |    213MiB |
| targz-small        |       13.9MiB |       18.2MiB |    11.6MiB |   10.4MiB |
| targz-many         |        136MiB |        155MiB |     266MiB |    208MiB |
| targz-deep         |       27.0MiB |       29.4MiB |     124MiB |   84.5MiB |
| targz-unicode      |       18.8MiB |       17.7MiB |    20.9MiB |   15.0MiB |
| tar-perms          |       13.7MiB |       15.4MiB |    10.9MiB |    5.6MiB |
| tarbz2-small       |       27.2MiB |       28.1MiB |    18.3MiB |   12.0MiB |
| tarbz2-many        |        179MiB |        193MiB |     304MiB |    231MiB |
| targz-realworld    |       19.4MiB |       19.4MiB |    39.2MiB |   24.3MiB |
| targz-realregistry |        9.1MiB |        8.6MiB |     3.2MiB |    2.6MiB |
| zip-large-single   |       19.0MiB |        146MiB |     479MiB |    204MiB |
| targz-large-single |       21.9MiB |        149MiB |     504MiB |    327MiB |

## Cold first-call latency, phase 4 (ms)

| Scenario           | umar0x-native | umar0x-compat | decompress | @xhmikosr |
| ------------------ | ------------: | ------------: | ---------: | --------: |
| zip-small          |        65.6ms |         113ms |     97.9ms |    89.0ms |
| zip-many           |        3006ms |        6384ms |     6043ms |    3718ms |
| tar-small          |        37.3ms |        62.5ms |     88.9ms |    32.9ms |
| tar-many           |        2224ms |        4243ms |     5244ms |    2619ms |
| targz-small        |        41.6ms |        90.2ms |     98.1ms |    62.3ms |
| targz-many         |        2042ms |        5073ms |     5588ms |    2547ms |
| targz-deep         |         183ms |         392ms |     5753ms |    1398ms |
| targz-unicode      |        67.6ms |         132ms |      177ms |    69.3ms |
| tar-perms          |        34.6ms |        61.3ms |     64.8ms |    26.8ms |
| tarbz2-small       |        69.1ms |         124ms |      139ms |    72.2ms |
| tarbz2-many        |        2319ms |        5456ms |     5369ms |    2837ms |
| targz-realworld    |        73.7ms |         158ms |      305ms |    96.1ms |
| targz-realregistry |        16.1ms |        24.4ms |     17.5ms |    21.7ms |
| zip-large-single   |         617ms |         785ms |      854ms |     780ms |
| targz-large-single |         629ms |         791ms |      778ms |     827ms |

## Variance context (warm stdev / warm median, phase 4)

| Scenario           | umar0x-native | decompress | @xhmikosr |
| ------------------ | ------------: | ---------: | --------: |
| zip-small          |            3% |         2% |       33% |
| zip-many           |           13% |         6% |        3% |
| tar-small          |           30% |        10% |       10% |
| tar-many           |            4% |         4% |        5% |
| targz-small        |           14% |         2% |       29% |
| targz-many         |            4% |         5% |       16% |
| targz-deep         |           13% |         9% |        4% |
| targz-unicode      |           12% |         2% |       21% |
| tar-perms          |            8% |        10% |       33% |
| tarbz2-small       |            6% |         6% |        5% |
| tarbz2-many        |            7% |         4% |        3% |
| targz-realworld    |            4% |         8% |        8% |
| targz-realregistry |           17% |         8% |       27% |
| zip-large-single   |            5% |         2% |        2% |
| targz-large-single |            1% |         2% |        2% |

## Security matrix summary (phase 4 run, 61 adversarial fixtures per library)

| Metric (default policy)                   | umar0x (p1) | umar0x (p4) | decompress (p4) | @xhmikosr (p4) |
| ----------------------------------------- | ----------: | ----------: | --------------: | -------------: |
| Escapes / partial outputs / crashes+hangs |   0 / 0 / 0 |   0 / 0 / 0 |       9 / 3 / 0 |      0 / 5 / 0 |

Phase 4 raw outcome detail per fixture is in `phase4/sec/matrix.md`; phase 1 equivalents in `phase1/sec/matrix.md`.
