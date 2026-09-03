# Performance benchmark summary (phase1)

- Date: 2026-09-03T03:31:58.216Z
- Node v24.19.0, linux/x64, CPU: Intel(R) Xeon(R) Processor
- 5 independent runs per cell, 1 cold + 3 warm calls per run

## Cold first-call latency (median ms across runs)

| Scenario           | umar0x-native | umar0x-compat | decompress | @xhmikosr |
| ------------------ | ------------: | ------------: | ---------: | --------: |
| zip-small          |         136.2 |         223.9 |      145.3 |      92.9 |
| zip-many           |        3683.9 |        6853.2 |     5413.7 |    2922.6 |
| tar-small          |          74.2 |         146.3 |      103.7 |      45.4 |
| tar-many           |        2455.4 |        5462.5 |     4492.8 |    1874.6 |
| targz-small        |          85.0 |         156.5 |      124.8 |      64.9 |
| targz-many         |        2511.1 |        5372.9 |     4548.0 |    1969.0 |
| targz-deep         |         811.2 |        1739.5 |     5987.5 |    1380.6 |
| targz-unicode      |         157.8 |         294.4 |      173.5 |      80.6 |
| tar-perms          |          61.7 |         136.9 |       75.4 |      42.7 |
| tarbz2-small       |         120.8 |         206.8 |      163.6 |      82.7 |
| tarbz2-many        |        2724.6 |        5992.0 |     4832.3 |    2252.8 |
| targz-realregistry |          23.6 |          34.1 |       20.4 |      23.0 |
| targz-realworld    |         198.9 |         343.4 |      364.4 |     111.2 |
| zip-large-single   |         594.5 |         743.6 |      712.7 |     735.8 |
| targz-large-single |         648.4 |         774.9 |      752.7 |     832.4 |

## Warm steady-state latency (median of per-run mean, ms)

| Scenario           | umar0x-native | umar0x-compat | decompress | @xhmikosr |
| ------------------ | ------------: | ------------: | ---------: | --------: |
| zip-small          |         126.8 |         188.5 |      124.8 |      83.5 |
| zip-many           |        3191.1 |        6242.4 |     5344.8 |    2711.3 |
| tar-small          |          72.9 |         143.4 |      104.1 |      38.6 |
| tar-many           |        2056.7 |        5216.6 |     4442.4 |    1414.1 |
| targz-small        |          72.0 |         143.6 |      101.6 |      46.6 |
| targz-many         |        2140.3 |        5153.7 |     4406.8 |    1736.9 |
| targz-deep         |         748.2 |        1497.0 |     6091.8 |    1240.6 |
| targz-unicode      |         140.5 |         256.6 |      154.4 |      74.3 |
| tar-perms          |          55.8 |         131.8 |       69.6 |      40.9 |
| tarbz2-small       |         109.3 |         187.0 |      139.7 |      58.3 |
| tarbz2-many        |        2270.5 |        5313.3 |     4762.9 |    2164.7 |
| targz-realregistry |           7.8 |          12.1 |        7.8 |       6.5 |
| targz-realworld    |         191.8 |         298.0 |      278.0 |     100.7 |
| zip-large-single   |         541.0 |         664.8 |      652.7 |     711.1 |
| targz-large-single |         585.1 |         713.1 |      709.1 |     736.4 |

## Peak RSS delta (median MiB, final maxRSS minus post-import baseline)

| Scenario           | umar0x-native | umar0x-compat | decompress | @xhmikosr |
| ------------------ | ------------: | ------------: | ---------: | --------: |
| zip-small          |          21.3 |          20.6 |       20.9 |      33.9 |
| zip-many           |         149.7 |         143.8 |      283.8 |     291.9 |
| tar-small          |          15.7 |          15.2 |       13.3 |       7.7 |
| tar-many           |         107.5 |         140.9 |      276.3 |     209.7 |
| targz-small        |          15.7 |          15.5 |       12.0 |       9.9 |
| targz-many         |         119.2 |         152.3 |      262.8 |     204.4 |
| targz-deep         |          27.0 |          26.2 |      124.5 |      79.5 |
| targz-unicode      |          18.2 |          17.6 |       20.2 |      14.4 |
| tar-perms          |          12.9 |          15.5 |       10.7 |       6.2 |
| tarbz2-small       |          27.7 |          27.7 |       16.6 |      11.8 |
| tarbz2-many        |         172.3 |         183.0 |      304.8 |     228.8 |
| targz-realregistry |           7.9 |           8.6 |        3.2 |       2.3 |
| targz-realworld    |          18.7 |          18.2 |       38.8 |      22.9 |
| zip-large-single   |          18.5 |         146.3 |      516.6 |     203.6 |
| targz-large-single |          21.6 |         148.8 |      530.2 |     327.4 |

## Concurrency (8 parallel extractions of targz-many, total wall ms)

| Library       | Median total ms | OK runs / 5 |
| ------------- | --------------: | ----------- |
| umar0x-native |           13429 | 5/5         |
| umar0x-compat |           29997 | 5/5         |
| kevva         |           40239 | 5/5         |
| xhmikosr      |           17263 | 5/5         |
