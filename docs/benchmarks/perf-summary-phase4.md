# Performance benchmark summary (phase4)

- Date: 2026-09-03T05:08:54.272Z
- Node v24.19.0, linux/x64, CPU: Intel(R) Xeon(R) Processor
- 5 independent runs per cell, 1 cold + 3 warm calls per run

## Cold first-call latency (median ms across runs)

| Scenario           | umar0x-native | umar0x-compat | decompress | @xhmikosr |
| ------------------ | ------------: | ------------: | ---------: | --------: |
| zip-small          |          65.6 |         113.1 |       97.9 |      89.0 |
| zip-many           |        3006.1 |        6383.9 |     6043.2 |    3718.0 |
| tar-small          |          37.3 |          62.5 |       88.9 |      32.9 |
| tar-many           |        2224.5 |        4242.8 |     5244.2 |    2619.1 |
| targz-small        |          41.6 |          90.2 |       98.1 |      62.3 |
| targz-many         |        2042.1 |        5073.0 |     5588.4 |    2546.8 |
| targz-deep         |         183.1 |         392.3 |     5752.8 |    1398.0 |
| targz-unicode      |          67.6 |         132.4 |      177.0 |      69.3 |
| tar-perms          |          34.6 |          61.3 |       64.8 |      26.8 |
| tarbz2-small       |          69.1 |         124.3 |      139.0 |      72.2 |
| tarbz2-many        |        2318.7 |        5456.2 |     5369.2 |    2837.3 |
| targz-realworld    |          73.7 |         158.3 |      305.5 |      96.1 |
| targz-realregistry |          16.1 |          24.4 |       17.5 |      21.7 |
| zip-large-single   |         617.1 |         785.4 |      853.7 |     779.7 |
| targz-large-single |         629.1 |         790.8 |      778.2 |     827.3 |

## Warm steady-state latency (median of per-run mean, ms)

| Scenario           | umar0x-native | umar0x-compat | decompress | @xhmikosr |
| ------------------ | ------------: | ------------: | ---------: | --------: |
| zip-small          |          63.5 |         125.5 |       90.8 |      54.4 |
| zip-many           |        2608.2 |        5434.6 |     5578.9 |    3332.4 |
| tar-small          |          23.3 |          58.2 |       79.5 |      18.1 |
| tar-many           |        1917.6 |        4115.4 |     4988.0 |    2289.9 |
| targz-small        |          22.2 |          67.1 |       80.9 |      32.2 |
| targz-many         |        1894.5 |        4466.7 |     5448.3 |    2351.1 |
| targz-deep         |         151.7 |         334.2 |     6039.0 |    1343.4 |
| targz-unicode      |          55.0 |         126.8 |      148.4 |      47.1 |
| tar-perms          |          19.0 |          48.6 |       51.1 |      15.7 |
| tarbz2-small       |          58.2 |         104.1 |      104.4 |      43.3 |
| tarbz2-many        |        2141.9 |        4854.0 |     5515.6 |    2697.4 |
| targz-realworld    |          54.4 |         121.8 |      291.0 |      78.6 |
| targz-realregistry |           5.3 |           6.5 |        6.3 |       5.5 |
| zip-large-single   |         567.4 |         731.0 |      781.8 |     767.2 |
| targz-large-single |         586.7 |         725.0 |      766.7 |     704.8 |

## Peak RSS delta (median MiB, final maxRSS minus post-import baseline)

| Scenario           | umar0x-native | umar0x-compat | decompress | @xhmikosr |
| ------------------ | ------------: | ------------: | ---------: | --------: |
| zip-small          |          25.1 |          25.4 |       18.8 |      34.4 |
| zip-many           |         140.0 |         149.5 |      286.4 |     276.7 |
| tar-small          |          14.7 |          16.1 |       13.0 |       7.5 |
| tar-many           |         134.1 |         144.8 |      251.7 |     212.8 |
| targz-small        |          13.9 |          18.2 |       11.6 |      10.4 |
| targz-many         |         135.6 |         154.6 |      265.6 |     207.8 |
| targz-deep         |          27.0 |          29.4 |      123.8 |      84.5 |
| targz-unicode      |          18.8 |          17.7 |       20.9 |      15.0 |
| tar-perms          |          13.7 |          15.4 |       10.9 |       5.6 |
| tarbz2-small       |          27.2 |          28.1 |       18.3 |      12.0 |
| tarbz2-many        |         179.2 |         193.0 |      303.8 |     230.6 |
| targz-realworld    |          19.4 |          19.4 |       39.2 |      24.3 |
| targz-realregistry |           9.1 |           8.6 |        3.2 |       2.6 |
| zip-large-single   |          19.0 |         146.1 |      478.8 |     203.8 |
| targz-large-single |          21.9 |         149.1 |      504.1 |     326.9 |

## Concurrency (8 parallel extractions of targz-many, total wall ms)

| Library       | Median total ms | OK runs / 5 |
| ------------- | --------------: | ----------- |
| umar0x-native |           11323 | 5/5         |
| umar0x-compat |           27409 | 5/5         |
| kevva         |           42133 | 5/5         |
| xhmikosr      |           17773 | 5/5         |
