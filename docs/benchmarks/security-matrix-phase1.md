# Security matrix (phase1)

Sandbox paths inside error messages are reproducible sandbox locations.
Generated: 2026-09-03T03:36:19.223Z

## Adversarial + repo malicious fixtures, default policy

| Fixture                             | Library       | Outcome   | Write escapes | Link escapes | Hardlink escapes | Partial output | RSS (MiB) | Error                                                                            |
| ----------------------------------- | ------------- | --------- | ------------- | ------------ | ---------------- | -------------- | --------- | -------------------------------------------------------------------------------- |
| garbage.bin                         | umar0x-native | REJECTED  | 0             | 0            | 0                | no             | 57        | UnknownFormatError: UNKNOWN_FORMAT: could not detect archive format (first bytes |
| garbage.bin                         | umar0x-compat | REJECTED  | 0             | 0            | 0                | no             | 53        | UnknownFormatError: UNKNOWN_FORMAT: could not detect archive format (first bytes |
| garbage.bin                         | kevva         | EXTRACTED | 0             | 0            | 0                | no             | 62        |                                                                                  |
| garbage.bin                         | xhmikosr      | EXTRACTED | 0             | 0            | 0                | no             | 67        |                                                                                  |
| tar-deep-200.tar.gz                 | umar0x-native | REJECTED  | 0             | 0            | 0                | no             | 57        | DepthExceededError: LIMIT_DEPTH: entry "L0/L1/L2/L3/L4/L5/L6/L7/L8/L9/L10/L11/L1 |
| tar-deep-200.tar.gz                 | umar0x-compat | REJECTED  | 0             | 0            | 0                | no             | 56        | DepthExceededError: LIMIT_DEPTH: entry "L0/L1/L2/L3/L4/L5/L6/L7/L8/L9/L10/L11/L1 |
| tar-deep-200.tar.gz                 | kevva         | EXTRACTED | 0             | 0            | 0                | no             | 70        |                                                                                  |
| tar-deep-200.tar.gz                 | xhmikosr      | EXTRACTED | 0             | 0            | 0                | no             | 70        |                                                                                  |
| tar-duplicate.tar                   | umar0x-native | REJECTED  | 0             | 0            | 0                | no             | 57        | DuplicatePathError: DUPLICATE_PATH: duplicate path: dup.txt                      |
| tar-duplicate.tar                   | umar0x-compat | REJECTED  | 0             | 0            | 0                | no             | 57        | DuplicatePathError: DUPLICATE_PATH: duplicate path: dup.txt                      |
| tar-duplicate.tar                   | kevva         | EXTRACTED | 0             | 0            | 0                | no             | 64        |                                                                                  |
| tar-duplicate.tar                   | xhmikosr      | REJECTED  | 0             | 0            | 0                | no             | 68        | Error: Refusing to extract an archive with a duplicate entry path: dup.txt       |
| tar-empty.tar                       | umar0x-native | EXTRACTED | 0             | 0            | 0                | no             | 57        |                                                                                  |
| tar-empty.tar                       | umar0x-compat | EXTRACTED | 0             | 0            | 0                | no             | 56        |                                                                                  |
| tar-empty.tar                       | kevva         | EXTRACTED | 0             | 0            | 0                | no             | 63        |                                                                                  |
| tar-empty.tar                       | xhmikosr      | EXTRACTED | 0             | 0            | 0                | no             | 67        |                                                                                  |
| tar-hardlink-outside.tar            | umar0x-native | REJECTED  | 0             | 0            | 0                | no             | 57        | HardlinkRefusedError: LINK_HARDLINK_REFUSED: hardlink entry refused: hl          |
| tar-hardlink-outside.tar            | umar0x-compat | REJECTED  | 0             | 0            | 0                | no             | 56        | HardlinkRefusedError: LINK_HARDLINK_REFUSED: hardlink entry refused: hl          |
| tar-hardlink-outside.tar            | kevva         | REJECTED  | 0             | 0            | 0                | no             | 64        | Error: ENOENT: ENOENT: no such file or directory, link '../../outside-sentinel/h |
| tar-hardlink-outside.tar            | xhmikosr      | REJECTED  | 0             | 0            | 0                | no             | 68        | Error: Refusing to create a link pointing outside the output directory: /home/z/ |
| tar-huge-declared.tar               | umar0x-native | REJECTED  | 0             | 0            | 0                | no             | 55        | EntrySizeExceededError: LIMIT_ENTRY_SIZE: entry "big.bin" size 2147483648 exceed |
| tar-huge-declared.tar               | umar0x-compat | REJECTED  | 0             | 0            | 0                | no             | 55        | EntrySizeExceededError: LIMIT_ENTRY_SIZE: entry "big.bin" size 2147483648 exceed |
| tar-huge-declared.tar               | kevva         | REJECTED  | 0             | 0            | 0                | no             | 63        | Error: Unexpected end of data                                                    |
| tar-huge-declared.tar               | xhmikosr      | REJECTED  | 0             | 0            | 0                | no             | 68        | Error: Unexpected end of data                                                    |
| tar-mixed-sep.tar                   | umar0x-native | REJECTED  | 0             | 0            | 0                | no             | 57        | PathPolicyError: PATH_POLICY_VIOLATION: backslash in POSIX path: folder\file.txt |
| tar-mixed-sep.tar                   | umar0x-compat | REJECTED  | 0             | 0            | 0                | no             | 57        | PathPolicyError: PATH_POLICY_VIOLATION: backslash in POSIX path: folder\file.txt |
| tar-mixed-sep.tar                   | kevva         | EXTRACTED | 0             | 0            | 0                | no             | 64        |                                                                                  |
| tar-mixed-sep.tar                   | xhmikosr      | EXTRACTED | 0             | 0            | 0                | no             | 68        |                                                                                  |
| tar-nul-name.tar                    | umar0x-native | EXTRACTED | 0             | 0            | 0                | no             | 57        |                                                                                  |
| tar-nul-name.tar                    | umar0x-compat | EXTRACTED | 0             | 0            | 0                | no             | 55        |                                                                                  |
| tar-nul-name.tar                    | kevva         | EXTRACTED | 0             | 0            | 0                | no             | 63        |                                                                                  |
| tar-nul-name.tar                    | xhmikosr      | EXTRACTED | 0             | 0            | 0                | no             | 67        |                                                                                  |
| tar-slip.tar                        | umar0x-native | REJECTED  | 0             | 0            | 0                | no             | 55        | PathTraversalError: PATH_TRAVERSAL: '..' segment in path: ../../../p1-tar-escape |
| tar-slip.tar                        | umar0x-compat | REJECTED  | 0             | 0            | 0                | no             | 55        | PathTraversalError: PATH_TRAVERSAL: '..' segment in path: ../../../p1-tar-escape |
| tar-slip.tar                        | kevva         | REJECTED  | 0             | 0            | 0                | no             | 63        | Error: Refusing to create a directory outside the output path.                   |
| tar-slip.tar                        | xhmikosr      | REJECTED  | 0             | 0            | 0                | no             | 67        | Error: Refusing to create a directory outside the output path.                   |
| tar-symlink-abs.tar                 | umar0x-native | REJECTED  | 0             | 0            | 0                | no             | 57        | SymlinkRefusedError: LINK_SYMLINK_REFUSED: symlink entry refused: passwd-link    |
| tar-symlink-abs.tar                 | umar0x-compat | REJECTED  | 0             | 0            | 0                | no             | 55        | SymlinkRefusedError: LINK_SYMLINK_REFUSED: symlink entry refused: passwd-link    |
| tar-symlink-abs.tar                 | kevva         | EXTRACTED | 0             | 1            | 0                | no             | 63        |                                                                                  |
| tar-symlink-abs.tar                 | xhmikosr      | REJECTED  | 0             | 0            | 0                | no             | 68        | Error: Refusing to create a link pointing outside the output directory: /etc/pas |
| tar-symlink-chain.tar               | umar0x-native | REJECTED  | 0             | 0            | 0                | no             | 57        | SymlinkRefusedError: LINK_SYMLINK_REFUSED: symlink entry refused: hop1           |
| tar-symlink-chain.tar               | umar0x-compat | REJECTED  | 0             | 0            | 0                | no             | 57        | SymlinkRefusedError: LINK_SYMLINK_REFUSED: symlink entry refused: hop1           |
| tar-symlink-chain.tar               | kevva         | REJECTED  | 0             | 1            | 0                | yes            | 64        | Error: EEXIST: EEXIST: file already exists, mkdir '/home/z/my-project/bench/phas |
| tar-symlink-chain.tar               | xhmikosr      | REJECTED  | 0             | 0            | 0                | yes            | 68        | Error: EEXIST: EEXIST: file already exists, symlink 'hop2' -> 'output/hop1'      |
| tar-win-device.tar                  | umar0x-native | REJECTED  | 0             | 0            | 0                | no             | 57        | WindowsDeviceNameError: PATH_WINDOWS_DEVICE: Windows reserved device name "CON"  |
| tar-win-device.tar                  | umar0x-compat | REJECTED  | 0             | 0            | 0                | no             | 57        | WindowsDeviceNameError: PATH_WINDOWS_DEVICE: Windows reserved device name "CON"  |
| tar-win-device.tar                  | kevva         | EXTRACTED | 0             | 0            | 0                | no             | 63        |                                                                                  |
| tar-win-device.tar                  | xhmikosr      | EXTRACTED | 0             | 0            | 0                | no             | 68        |                                                                                  |
| targz-bomb.tar.gz                   | umar0x-native | REJECTED  | 0             | 0            | 0                | no             | 55        | CompressionRatioExceededError: LIMIT_COMPRESSION_RATIO: compression ratio 1028.4 |
| targz-bomb.tar.gz                   | umar0x-compat | EXTRACTED | 0             | 0            | 0                | no             | 327       |                                                                                  |
| targz-bomb.tar.gz                   | kevva         | EXTRACTED | 0             | 0            | 0                | no             | 585       |                                                                                  |
| targz-bomb.tar.gz                   | xhmikosr      | EXTRACTED | 0             | 0            | 0                | no             | 588       |                                                                                  |
| targz-truncated.tar.gz              | umar0x-native | REJECTED  | 0             | 0            | 0                | no             | 56        | CorruptArchiveError: CORRUPT_ARCHIVE: unexpected end of file                     |
| targz-truncated.tar.gz              | umar0x-compat | REJECTED  | 0             | 0            | 0                | no             | 56        | CorruptArchiveError: CORRUPT_ARCHIVE: unexpected end of file                     |
| targz-truncated.tar.gz              | kevva         | REJECTED  | 0             | 0            | 0                | no             | 63        | Error: Z_BUF_ERROR: unexpected end of file                                       |
| targz-truncated.tar.gz              | xhmikosr      | REJECTED  | 0             | 0            | 0                | no             | 69        | Error: Z_BUF_ERROR: unexpected end of file                                       |
| zip-abs-path.zip                    | umar0x-native | REJECTED  | 0             | 0            | 0                | no             | 57        | AbsolutePathError: PATH_ABSOLUTE: absolute path rejected (posix): /etc/p1-evil.t |
| zip-abs-path.zip                    | umar0x-compat | REJECTED  | 0             | 0            | 0                | no             | 57        | AbsolutePathError: PATH_ABSOLUTE: absolute path rejected (posix): /etc/p1-evil.t |
| zip-abs-path.zip                    | kevva         | REJECTED  | 0             | 0            | 0                | no             | 61        | Error: absolute path: /etc/p1-evil.txt                                           |
| zip-abs-path.zip                    | xhmikosr      | REJECTED  | 0             | 0            | 0                | no             | 68        | Error: absolute path: /etc/p1-evil.txt                                           |
| zip-bomb.zip                        | umar0x-native | REJECTED  | 0             | 0            | 0                | no             | 57        | CompressionRatioExceededError: LIMIT_COMPRESSION_RATIO: compression ratio 1028.3 |
| zip-bomb.zip                        | umar0x-compat | EXTRACTED | 0             | 0            | 0                | no             | 328       |                                                                                  |
| zip-bomb.zip                        | kevva         | EXTRACTED | 0             | 0            | 0                | no             | 584       |                                                                                  |
| zip-bomb.zip                        | xhmikosr      | EXTRACTED | 0             | 0            | 0                | no             | 365       |                                                                                  |
| zip-case-collision.zip              | umar0x-native | EXTRACTED | 0             | 0            | 0                | no             | 58        |                                                                                  |
| zip-case-collision.zip              | umar0x-compat | EXTRACTED | 0             | 0            | 0                | no             | 58        |                                                                                  |
| zip-case-collision.zip              | kevva         | EXTRACTED | 0             | 0            | 0                | no             | 64        |                                                                                  |
| zip-case-collision.zip              | xhmikosr      | EXTRACTED | 0             | 0            | 0                | no             | 68        |                                                                                  |
| zip-duplicate.zip                   | umar0x-native | REJECTED  | 0             | 0            | 0                | no             | 57        | DuplicatePathError: DUPLICATE_PATH: duplicate path: dup.txt                      |
| zip-duplicate.zip                   | umar0x-compat | REJECTED  | 0             | 0            | 0                | no             | 58        | DuplicatePathError: DUPLICATE_PATH: duplicate path: dup.txt                      |
| zip-duplicate.zip                   | kevva         | EXTRACTED | 0             | 0            | 0                | no             | 64        |                                                                                  |
| zip-duplicate.zip                   | xhmikosr      | REJECTED  | 0             | 0            | 0                | no             | 68        | Error: Refusing to extract an archive with a duplicate entry path: dup.txt       |
| zip-empty.zip                       | umar0x-native | EXTRACTED | 0             | 0            | 0                | no             | 57        |                                                                                  |
| zip-empty.zip                       | umar0x-compat | EXTRACTED | 0             | 0            | 0                | no             | 55        |                                                                                  |
| zip-empty.zip                       | kevva         | EXTRACTED | 0             | 0            | 0                | no             | 61        |                                                                                  |
| zip-empty.zip                       | xhmikosr      | EXTRACTED | 0             | 0            | 0                | no             | 68        |                                                                                  |
| zip-encrypted.zip                   | umar0x-native | REJECTED  | 0             | 0            | 0                | no             | 57        | CorruptArchiveError: CORRUPT_ARCHIVE: unsupported or encrypted ZIP entry: secret |
| zip-encrypted.zip                   | umar0x-compat | REJECTED  | 0             | 0            | 0                | no             | 57        | CorruptArchiveError: CORRUPT_ARCHIVE: unsupported or encrypted ZIP entry: secret |
| zip-encrypted.zip                   | kevva         | REJECTED  | 0             | 0            | 0                | no             | 63        | Error: entry is encrypted, and options.decrypt !== false                         |
| zip-encrypted.zip                   | xhmikosr      | REJECTED  | 0             | 0            | 0                | no             | 68        | Error: entry is encrypted, and options.decodeFileData !== false                  |
| zip-slip-deep.zip                   | umar0x-native | REJECTED  | 0             | 0            | 0                | no             | 55        | PathTraversalError: PATH_TRAVERSAL: '..' segment in path: safe/a/b/../../c/../.. |
| zip-slip-deep.zip                   | umar0x-compat | REJECTED  | 0             | 0            | 0                | no             | 55        | PathTraversalError: PATH_TRAVERSAL: '..' segment in path: safe/a/b/../../c/../.. |
| zip-slip-deep.zip                   | kevva         | REJECTED  | 0             | 0            | 0                | no             | 63        | Error: invalid relative path: safe/a/b/../../c/../../../../p1-deep-escape-marker |
| zip-slip-deep.zip                   | xhmikosr      | REJECTED  | 0             | 0            | 0                | no             | 67        | Error: invalid relative path: safe/a/b/../../c/../../../../p1-deep-escape-marker |
| zip-slip.zip                        | umar0x-native | REJECTED  | 0             | 0            | 0                | no             | 55        | PathTraversalError: PATH_TRAVERSAL: '..' segment in path: ../../p1-escape-marker |
| zip-slip.zip                        | umar0x-compat | REJECTED  | 0             | 0            | 0                | no             | 55        | PathTraversalError: PATH_TRAVERSAL: '..' segment in path: ../../p1-escape-marker |
| zip-slip.zip                        | kevva         | REJECTED  | 0             | 0            | 0                | no             | 63        | Error: invalid relative path: ../../p1-escape-marker.txt                         |
| zip-slip.zip                        | xhmikosr      | REJECTED  | 0             | 0            | 0                | no             | 68        | Error: invalid relative path: ../../p1-escape-marker.txt                         |
| zip-symlink-escape.zip              | umar0x-native | REJECTED  | 0             | 0            | 0                | no             | 57        | SymlinkRefusedError: LINK_SYMLINK_REFUSED: symlink entry refused: zlink          |
| zip-symlink-escape.zip              | umar0x-compat | REJECTED  | 0             | 0            | 0                | no             | 56        | SymlinkRefusedError: LINK_SYMLINK_REFUSED: symlink entry refused: zlink          |
| zip-symlink-escape.zip              | kevva         | EXTRACTED | 0             | 1            | 0                | no             | 63        |                                                                                  |
| zip-symlink-escape.zip              | xhmikosr      | REJECTED  | 0             | 0            | 0                | no             | 68        | Error: Refusing to create a link pointing outside the output directory: /home/z/ |
| zip-truncated.zip                   | umar0x-native | REJECTED  | 0             | 0            | 0                | no             | 56        | CorruptArchiveError: CORRUPT_ARCHIVE: invalid ZIP archive: End of central direct |
| zip-truncated.zip                   | umar0x-compat | REJECTED  | 0             | 0            | 0                | no             | 55        | CorruptArchiveError: CORRUPT_ARCHIVE: invalid ZIP archive: End of central direct |
| zip-truncated.zip                   | kevva         | REJECTED  | 0             | 0            | 0                | no             | 63        | Error: end of central directory record signature not found                       |
| zip-truncated.zip                   | xhmikosr      | REJECTED  | 0             | 0            | 0                | no             | 68        | Error: End of central directory record signature not found. Either not a zip fil |
| absolute-posix.zip                  | umar0x-native | REJECTED  | 0             | 0            | 0                | no             | 57        | AbsolutePathError: PATH_ABSOLUTE: absolute path rejected (posix): /etc/passwd    |
| absolute-posix.zip                  | umar0x-compat | REJECTED  | 0             | 0            | 0                | no             | 55        | AbsolutePathError: PATH_ABSOLUTE: absolute path rejected (posix): /etc/passwd    |
| absolute-posix.zip                  | kevva         | REJECTED  | 0             | 0            | 0                | no             | 62        | Error: absolute path: /etc/passwd                                                |
| absolute-posix.zip                  | xhmikosr      | REJECTED  | 0             | 0            | 0                | no             | 67        | Error: absolute path: /etc/passwd                                                |
| absolute-windows-drive.zip          | umar0x-native | REJECTED  | 0             | 0            | 0                | no             | 57        | AbsolutePathError: PATH_ABSOLUTE: absolute path rejected (windows-drive): C:/Win |
| absolute-windows-drive.zip          | umar0x-compat | REJECTED  | 0             | 0            | 0                | no             | 58        | AbsolutePathError: PATH_ABSOLUTE: absolute path rejected (windows-drive): C:/Win |
| absolute-windows-drive.zip          | kevva         | REJECTED  | 0             | 0            | 0                | no             | 63        | Error: absolute path: C:/Windows/evil.dll                                        |
| absolute-windows-drive.zip          | xhmikosr      | REJECTED  | 0             | 0            | 0                | no             | 68        | Error: absolute path: C:/Windows/evil.dll                                        |
| case-collision.zip                  | umar0x-native | EXTRACTED | 0             | 0            | 0                | no             | 56        |                                                                                  |
| case-collision.zip                  | umar0x-compat | EXTRACTED | 0             | 0            | 0                | no             | 57        |                                                                                  |
| case-collision.zip                  | kevva         | EXTRACTED | 0             | 0            | 0                | no             | 63        |                                                                                  |
| case-collision.zip                  | xhmikosr      | EXTRACTED | 0             | 0            | 0                | no             | 68        |                                                                                  |
| duplicate-path.zip                  | umar0x-native | REJECTED  | 0             | 0            | 0                | no             | 57        | DuplicatePathError: DUPLICATE_PATH: duplicate path: foo                          |
| duplicate-path.zip                  | umar0x-compat | REJECTED  | 0             | 0            | 0                | no             | 58        | DuplicatePathError: DUPLICATE_PATH: duplicate path: foo                          |
| duplicate-path.zip                  | kevva         | EXTRACTED | 0             | 0            | 0                | no             | 64        |                                                                                  |
| duplicate-path.zip                  | xhmikosr      | REJECTED  | 0             | 0            | 0                | no             | 68        | Error: Refusing to extract an archive with a duplicate entry path: foo           |
| hardlink-to-absolute.tar            | umar0x-native | REJECTED  | 0             | 0            | 0                | no             | 57        | HardlinkRefusedError: LINK_HARDLINK_REFUSED: hardlink entry refused: leak        |
| hardlink-to-absolute.tar            | umar0x-compat | REJECTED  | 0             | 0            | 0                | no             | 55        | HardlinkRefusedError: LINK_HARDLINK_REFUSED: hardlink entry refused: leak        |
| hardlink-to-absolute.tar            | kevva         | EXTRACTED | 0             | 0            | 0                | no             | 64        |                                                                                  |
| hardlink-to-absolute.tar            | xhmikosr      | REJECTED  | 0             | 0            | 0                | no             | 68        | Error: Refusing to create a link pointing outside the output directory: /etc/pas |
| hardlink-to-parent.tar              | umar0x-native | REJECTED  | 0             | 0            | 0                | no             | 55        | HardlinkRefusedError: LINK_HARDLINK_REFUSED: hardlink entry refused: leak        |
| hardlink-to-parent.tar              | umar0x-compat | REJECTED  | 0             | 0            | 0                | no             | 55        | HardlinkRefusedError: LINK_HARDLINK_REFUSED: hardlink entry refused: leak        |
| hardlink-to-parent.tar              | kevva         | REJECTED  | 0             | 0            | 0                | yes            | 64        | Error: ENOENT: ENOENT: no such file or directory, link '../secret.txt' -> 'outpu |
| hardlink-to-parent.tar              | xhmikosr      | REJECTED  | 0             | 0            | 0                | yes            | 68        | Error: Refusing to create a link pointing outside the output directory: /home/z/ |
| high-compression-ratio.tar.gz       | umar0x-native | REJECTED  | 0             | 0            | 0                | no             | 55        | CompressionRatioExceededError: LIMIT_COMPRESSION_RATIO: compression ratio 936.22 |
| high-compression-ratio.tar.gz       | umar0x-compat | EXTRACTED | 0             | 0            | 0                | no             | 59        |                                                                                  |
| high-compression-ratio.tar.gz       | kevva         | EXTRACTED | 0             | 0            | 0                | no             | 64        |                                                                                  |
| high-compression-ratio.tar.gz       | xhmikosr      | EXTRACTED | 0             | 0            | 0                | no             | 70        |                                                                                  |
| high-total-size.tar.gz              | umar0x-native | EXTRACTED | 0             | 0            | 0                | no             | 82        |                                                                                  |
| high-total-size.tar.gz              | umar0x-compat | EXTRACTED | 0             | 0            | 0                | no             | 90        |                                                                                  |
| high-total-size.tar.gz              | kevva         | EXTRACTED | 0             | 0            | 0                | no             | 212       |                                                                                  |
| high-total-size.tar.gz              | xhmikosr      | EXTRACTED | 0             | 0            | 0                | no             | 116       |                                                                                  |
| huge-declared-size.tar              | umar0x-native | REJECTED  | 0             | 0            | 0                | no             | 57        | EntrySizeExceededError: LIMIT_ENTRY_SIZE: entry "big.bin" size 2147483648 exceed |
| huge-declared-size.tar              | umar0x-compat | REJECTED  | 0             | 0            | 0                | no             | 57        | EntrySizeExceededError: LIMIT_ENTRY_SIZE: entry "big.bin" size 2147483648 exceed |
| huge-declared-size.tar              | kevva         | REJECTED  | 0             | 0            | 0                | no             | 62        | Error: Unexpected end of data                                                    |
| huge-declared-size.tar              | xhmikosr      | REJECTED  | 0             | 0            | 0                | no             | 66        | Error: Unexpected end of data                                                    |
| link_escape.tar.gz                  | umar0x-native | REJECTED  | 0             | 0            | 0                | no             | 57        | HardlinkRefusedError: LINK_HARDLINK_REFUSED: hardlink entry refused: leak        |
| link_escape.tar.gz                  | umar0x-compat | REJECTED  | 0             | 0            | 0                | no             | 56        | HardlinkRefusedError: LINK_HARDLINK_REFUSED: hardlink entry refused: leak        |
| link_escape.tar.gz                  | kevva         | REJECTED  | 0             | 0            | 0                | no             | 63        | Error: ENOENT: ENOENT: no such file or directory, link '../outside.txt' -> 'outp |
| link_escape.tar.gz                  | xhmikosr      | REJECTED  | 0             | 0            | 0                | no             | 68        | Error: Refusing to create a link pointing outside the output directory: /home/z/ |
| link_via_trap.tar.gz                | umar0x-native | REJECTED  | 0             | 0            | 0                | no             | 57        | SymlinkRefusedError: LINK_SYMLINK_REFUSED: symlink entry refused: trap           |
| link_via_trap.tar.gz                | umar0x-compat | REJECTED  | 0             | 0            | 0                | no             | 56        | SymlinkRefusedError: LINK_SYMLINK_REFUSED: symlink entry refused: trap           |
| link_via_trap.tar.gz                | kevva         | REJECTED  | 0             | 1            | 0                | yes            | 62        | Error: ENOENT: ENOENT: no such file or directory, link 'trap/passwd' -> 'output/ |
| link_via_trap.tar.gz                | xhmikosr      | REJECTED  | 0             | 0            | 0                | no             | 68        | Error: Refusing to create a link pointing outside the output directory: /etc     |
| partial-failure.tar                 | umar0x-native | REJECTED  | 0             | 0            | 0                | no             | 57        | PathTraversalError: PATH_TRAVERSAL: '..' segment in path: ../evil.txt            |
| partial-failure.tar                 | umar0x-compat | REJECTED  | 0             | 0            | 0                | no             | 56        | PathTraversalError: PATH_TRAVERSAL: '..' segment in path: ../evil.txt            |
| partial-failure.tar                 | kevva         | REJECTED  | 0             | 0            | 0                | no             | 63        | Error: Refusing to create a directory outside the output path.                   |
| partial-failure.tar                 | xhmikosr      | REJECTED  | 0             | 0            | 0                | yes            | 67        | Error: Refusing to create a directory outside the output path.                   |
| setgid-file.tar                     | umar0x-native | EXTRACTED | 0             | 0            | 0                | no             | 57        |                                                                                  |
| setgid-file.tar                     | umar0x-compat | EXTRACTED | 0             | 0            | 0                | no             | 55        |                                                                                  |
| setgid-file.tar                     | kevva         | EXTRACTED | 0             | 0            | 0                | no             | 64        |                                                                                  |
| setgid-file.tar                     | xhmikosr      | EXTRACTED | 0             | 0            | 0                | no             | 68        |                                                                                  |
| setuid-file.tar                     | umar0x-native | EXTRACTED | 0             | 0            | 0                | no             | 57        |                                                                                  |
| setuid-file.tar                     | umar0x-compat | EXTRACTED | 0             | 0            | 0                | no             | 55        |                                                                                  |
| setuid-file.tar                     | kevva         | EXTRACTED | 0             | 0            | 0                | no             | 63        |                                                                                  |
| setuid-file.tar                     | xhmikosr      | EXTRACTED | 0             | 0            | 0                | no             | 68        |                                                                                  |
| sibling_prefix.tar.gz               | umar0x-native | REJECTED  | 0             | 0            | 0                | no             | 56        | PathTraversalError: PATH_TRAVERSAL: '..' segment in path: ../output-evil/file.tx |
| sibling_prefix.tar.gz               | umar0x-compat | REJECTED  | 0             | 0            | 0                | no             | 57        | PathTraversalError: PATH_TRAVERSAL: '..' segment in path: ../output-evil/file.tx |
| sibling_prefix.tar.gz               | kevva         | REJECTED  | 0             | 0            | 0                | no             | 63        | Error: Refusing to create a directory outside the output path.                   |
| sibling_prefix.tar.gz               | xhmikosr      | REJECTED  | 0             | 0            | 0                | no             | 67        | Error: Refusing to create a directory outside the output path.                   |
| slip.zip                            | umar0x-native | REJECTED  | 0             | 0            | 0                | no             | 57        | SymlinkRefusedError: LINK_SYMLINK_REFUSED: symlink entry refused: nested/link    |
| slip.zip                            | umar0x-compat | REJECTED  | 0             | 0            | 0                | no             | 55        | SymlinkRefusedError: LINK_SYMLINK_REFUSED: symlink entry refused: nested/link    |
| slip.zip                            | kevva         | EXTRACTED | 0             | 1            | 0                | no             | 65        |                                                                                  |
| slip.zip                            | xhmikosr      | REJECTED  | 0             | 0            | 0                | yes            | 67        | Error: Refusing to create a link pointing outside the output directory: /home/z/ |
| slip2.zip                           | umar0x-native | REJECTED  | 0             | 0            | 0                | no             | 57        | PathTraversalError: PATH_TRAVERSAL: '..' segment in path: a/../../outside.txt    |
| slip2.zip                           | umar0x-compat | REJECTED  | 0             | 0            | 0                | no             | 57        | PathTraversalError: PATH_TRAVERSAL: '..' segment in path: a/../../outside.txt    |
| slip2.zip                           | kevva         | REJECTED  | 0             | 0            | 0                | no             | 64        | Error: invalid relative path: a/../../outside.txt                                |
| slip2.zip                           | xhmikosr      | REJECTED  | 0             | 0            | 0                | no             | 68        | Error: invalid relative path: a/../../outside.txt                                |
| slip3.zip                           | umar0x-native | REJECTED  | 0             | 0            | 0                | no             | 55        | PathTraversalError: PATH_TRAVERSAL: '..' segment in path: ../../../outside.txt   |
| slip3.zip                           | umar0x-compat | REJECTED  | 0             | 0            | 0                | no             | 56        | PathTraversalError: PATH_TRAVERSAL: '..' segment in path: ../../../outside.txt   |
| slip3.zip                           | kevva         | REJECTED  | 0             | 0            | 0                | no             | 64        | Error: invalid relative path: ../../../outside.txt                               |
| slip3.zip                           | xhmikosr      | REJECTED  | 0             | 0            | 0                | no             | 68        | Error: invalid relative path: ../../../outside.txt                               |
| slipping.tar.gz                     | umar0x-native | REJECTED  | 0             | 0            | 0                | no             | 57        | PathTraversalError: PATH_TRAVERSAL: '..' segment in path: ../../outside.txt      |
| slipping.tar.gz                     | umar0x-compat | REJECTED  | 0             | 0            | 0                | no             | 57        | PathTraversalError: PATH_TRAVERSAL: '..' segment in path: ../../outside.txt      |
| slipping.tar.gz                     | kevva         | REJECTED  | 0             | 0            | 0                | no             | 63        | Error: Refusing to create a directory outside the output path.                   |
| slipping.tar.gz                     | xhmikosr      | REJECTED  | 0             | 0            | 0                | no             | 68        | Error: Refusing to create a directory outside the output path.                   |
| sticky-dir.tar                      | umar0x-native | EXTRACTED | 0             | 0            | 0                | no             | 57        |                                                                                  |
| sticky-dir.tar                      | umar0x-compat | EXTRACTED | 0             | 0            | 0                | no             | 57        |                                                                                  |
| sticky-dir.tar                      | kevva         | EXTRACTED | 0             | 0            | 0                | no             | 64        |                                                                                  |
| sticky-dir.tar                      | xhmikosr      | EXTRACTED | 0             | 0            | 0                | no             | 68        |                                                                                  |
| symlink-chain-escape.tar            | umar0x-native | REJECTED  | 0             | 0            | 0                | no             | 57        | SymlinkRefusedError: LINK_SYMLINK_REFUSED: symlink entry refused: a              |
| symlink-chain-escape.tar            | umar0x-compat | REJECTED  | 0             | 0            | 0                | no             | 55        | SymlinkRefusedError: LINK_SYMLINK_REFUSED: symlink entry refused: a              |
| symlink-chain-escape.tar            | kevva         | EXTRACTED | 0             | 1            | 0                | no             | 63        |                                                                                  |
| symlink-chain-escape.tar            | xhmikosr      | REJECTED  | 0             | 0            | 0                | yes            | 67        | Error: Refusing to create a link pointing outside the output directory: /etc     |
| symlink-to-absolute.tar             | umar0x-native | REJECTED  | 0             | 0            | 0                | no             | 56        | SymlinkRefusedError: LINK_SYMLINK_REFUSED: symlink entry refused: passwd         |
| symlink-to-absolute.tar             | umar0x-compat | REJECTED  | 0             | 0            | 0                | no             | 55        | SymlinkRefusedError: LINK_SYMLINK_REFUSED: symlink entry refused: passwd         |
| symlink-to-absolute.tar             | kevva         | EXTRACTED | 0             | 1            | 0                | no             | 64        |                                                                                  |
| symlink-to-absolute.tar             | xhmikosr      | REJECTED  | 0             | 0            | 0                | no             | 67        | Error: Refusing to create a link pointing outside the output directory: /etc/pas |
| symlink-to-parent.tar               | umar0x-native | REJECTED  | 0             | 0            | 0                | no             | 57        | SymlinkRefusedError: LINK_SYMLINK_REFUSED: symlink entry refused: link           |
| symlink-to-parent.tar               | umar0x-compat | REJECTED  | 0             | 0            | 0                | no             | 55        | SymlinkRefusedError: LINK_SYMLINK_REFUSED: symlink entry refused: link           |
| symlink-to-parent.tar               | kevva         | EXTRACTED | 0             | 1            | 0                | no             | 63        |                                                                                  |
| symlink-to-parent.tar               | xhmikosr      | REJECTED  | 0             | 0            | 0                | no             | 67        | Error: Refusing to create a link pointing outside the output directory: /home/z/ |
| symlink_escape.tar.gz               | umar0x-native | REJECTED  | 0             | 0            | 0                | no             | 57        | SymlinkRefusedError: LINK_SYMLINK_REFUSED: symlink entry refused: leak           |
| symlink_escape.tar.gz               | umar0x-compat | REJECTED  | 0             | 0            | 0                | no             | 56        | SymlinkRefusedError: LINK_SYMLINK_REFUSED: symlink entry refused: leak           |
| symlink_escape.tar.gz               | kevva         | EXTRACTED | 0             | 1            | 0                | no             | 63        |                                                                                  |
| symlink_escape.tar.gz               | xhmikosr      | REJECTED  | 0             | 0            | 0                | no             | 68        | Error: Refusing to create a link pointing outside the output directory: /home/z/ |
| too-deep.tar                        | umar0x-native | REJECTED  | 0             | 0            | 0                | no             | 56        | DepthExceededError: LIMIT_DEPTH: entry "d0/d1/d2/d3/d4/d5/d6/d7/d8/d9/d10/d11/d1 |
| too-deep.tar                        | umar0x-compat | REJECTED  | 0             | 0            | 0                | no             | 57        | DepthExceededError: LIMIT_DEPTH: entry "d0/d1/d2/d3/d4/d5/d6/d7/d8/d9/d10/d11/d1 |
| too-deep.tar                        | kevva         | EXTRACTED | 0             | 0            | 0                | no             | 67        |                                                                                  |
| too-deep.tar                        | xhmikosr      | EXTRACTED | 0             | 0            | 0                | no             | 69        |                                                                                  |
| too-many-files.zip                  | umar0x-native | REJECTED  | 0             | 0            | 0                | no             | 189       | FileCountExceededError: LIMIT_FILE_COUNT: entry count 10001 exceeds maxFiles 100 |
| too-many-files.zip                  | umar0x-compat | REJECTED  | 0             | 0            | 0                | no             | 168       | FileCountExceededError: LIMIT_FILE_COUNT: entry count 10001 exceeds maxFiles 100 |
| too-many-files.zip                  | kevva         | EXTRACTED | 0             | 0            | 0                | no             | 440       |                                                                                  |
| too-many-files.zip                  | xhmikosr      | EXTRACTED | 0             | 0            | 0                | no             | 319       |                                                                                  |
| unicode-normalization-collision.tar | umar0x-native | REJECTED  | 0             | 0            | 0                | no             | 57        | DuplicatePathError: DUPLICATE_PATH: duplicate path: café.txt                     |
| unicode-normalization-collision.tar | umar0x-compat | REJECTED  | 0             | 0            | 0                | no             | 57        | DuplicatePathError: DUPLICATE_PATH: duplicate path: café.txt                     |
| unicode-normalization-collision.tar | kevva         | EXTRACTED | 0             | 0            | 0                | no             | 62        |                                                                                  |
| unicode-normalization-collision.tar | xhmikosr      | EXTRACTED | 0             | 0            | 0                | no             | 68        |                                                                                  |
| unicode-normalization-collision.zip | umar0x-native | REJECTED  | 0             | 0            | 0                | no             | 57        | DuplicatePathError: DUPLICATE_PATH: duplicate path: café.txt                     |
| unicode-normalization-collision.zip | umar0x-compat | REJECTED  | 0             | 0            | 0                | no             | 57        | DuplicatePathError: DUPLICATE_PATH: duplicate path: café.txt                     |
| unicode-normalization-collision.zip | kevva         | EXTRACTED | 0             | 0            | 0                | no             | 65        |                                                                                  |
| unicode-normalization-collision.zip | xhmikosr      | EXTRACTED | 0             | 0            | 0                | no             | 68        |                                                                                  |
| url-encoded-traversal.zip           | umar0x-native | REJECTED  | 0             | 0            | 0                | no             | 55        | PathPolicyError: PATH_POLICY_VIOLATION: URL-encoded character in path (percent-s |
| url-encoded-traversal.zip           | umar0x-compat | REJECTED  | 0             | 0            | 0                | no             | 57        | PathPolicyError: PATH_POLICY_VIOLATION: URL-encoded character in path (percent-s |
| url-encoded-traversal.zip           | kevva         | EXTRACTED | 0             | 0            | 0                | no             | 65        |                                                                                  |
| url-encoded-traversal.zip           | xhmikosr      | EXTRACTED | 0             | 0            | 0                | no             | 68        |                                                                                  |
| windows-ads.zip                     | umar0x-native | REJECTED  | 0             | 0            | 0                | no             | 56        | WindowsAdsError: PATH_WINDOWS_ADS: NTFS alternate data stream in path: file.txt: |
| windows-ads.zip                     | umar0x-compat | REJECTED  | 0             | 0            | 0                | no             | 55        | WindowsAdsError: PATH_WINDOWS_ADS: NTFS alternate data stream in path: file.txt: |
| windows-ads.zip                     | kevva         | EXTRACTED | 0             | 0            | 0                | no             | 65        |                                                                                  |
| windows-ads.zip                     | xhmikosr      | EXTRACTED | 0             | 0            | 0                | no             | 68        |                                                                                  |
| windows-device-name.zip             | umar0x-native | REJECTED  | 0             | 0            | 0                | no             | 56        | WindowsDeviceNameError: PATH_WINDOWS_DEVICE: Windows reserved device name "CON.t |
| windows-device-name.zip             | umar0x-compat | REJECTED  | 0             | 0            | 0                | no             | 57        | WindowsDeviceNameError: PATH_WINDOWS_DEVICE: Windows reserved device name "CON.t |
| windows-device-name.zip             | kevva         | EXTRACTED | 0             | 0            | 0                | no             | 64        |                                                                                  |
| windows-device-name.zip             | xhmikosr      | EXTRACTED | 0             | 0            | 0                | no             | 69        |                                                                                  |
| windows-trailing-dots.tar           | umar0x-native | REJECTED  | 0             | 0            | 0                | no             | 57        | WindowsTrailingDotsError: PATH_WINDOWS_TRAILING_DOTS: trailing dots/spaces in se |
| windows-trailing-dots.tar           | umar0x-compat | REJECTED  | 0             | 0            | 0                | no             | 56        | WindowsTrailingDotsError: PATH_WINDOWS_TRAILING_DOTS: trailing dots/spaces in se |
| windows-trailing-dots.tar           | kevva         | EXTRACTED | 0             | 0            | 0                | no             | 63        |                                                                                  |
| windows-trailing-dots.tar           | xhmikosr      | EXTRACTED | 0             | 0            | 0                | no             | 68        |                                                                                  |
| windows-trailing-dots.zip           | umar0x-native | REJECTED  | 0             | 0            | 0                | no             | 57        | WindowsTrailingDotsError: PATH_WINDOWS_TRAILING_DOTS: trailing dots/spaces in se |
| windows-trailing-dots.zip           | umar0x-compat | REJECTED  | 0             | 0            | 0                | no             | 55        | WindowsTrailingDotsError: PATH_WINDOWS_TRAILING_DOTS: trailing dots/spaces in se |
| windows-trailing-dots.zip           | kevva         | EXTRACTED | 0             | 0            | 0                | no             | 65        |                                                                                  |
| windows-trailing-dots.zip           | xhmikosr      | EXTRACTED | 0             | 0            | 0                | no             | 69        |                                                                                  |
| windows-unc.zip                     | umar0x-native | REJECTED  | 0             | 0            | 0                | no             | 55        | AbsolutePathError: PATH_ABSOLUTE: absolute path rejected (posix): //server/share |
| windows-unc.zip                     | umar0x-compat | REJECTED  | 0             | 0            | 0                | no             | 55        | AbsolutePathError: PATH_ABSOLUTE: absolute path rejected (posix): //server/share |
| windows-unc.zip                     | kevva         | REJECTED  | 0             | 0            | 0                | no             | 63        | Error: absolute path: //server/share/evil                                        |
| windows-unc.zip                     | xhmikosr      | REJECTED  | 0             | 0            | 0                | no             | 68        | Error: absolute path: //server/share/evil                                        |
| zip-slip-basic.zip                  | umar0x-native | REJECTED  | 0             | 0            | 0                | no             | 57        | PathTraversalError: PATH_TRAVERSAL: '..' segment in path: ../evil.txt            |
| zip-slip-basic.zip                  | umar0x-compat | REJECTED  | 0             | 0            | 0                | no             | 57        | PathTraversalError: PATH_TRAVERSAL: '..' segment in path: ../evil.txt            |
| zip-slip-basic.zip                  | kevva         | REJECTED  | 0             | 0            | 0                | no             | 64        | Error: invalid relative path: ../evil.txt                                        |
| zip-slip-basic.zip                  | xhmikosr      | REJECTED  | 0             | 0            | 0                | no             | 68        | Error: invalid relative path: ../evil.txt                                        |
| zip-slip-nested.tar                 | umar0x-native | REJECTED  | 0             | 0            | 0                | no             | 55        | PathTraversalError: PATH_TRAVERSAL: '..' segment in path: a/../../b.txt          |
| zip-slip-nested.tar                 | umar0x-compat | REJECTED  | 0             | 0            | 0                | no             | 55        | PathTraversalError: PATH_TRAVERSAL: '..' segment in path: a/../../b.txt          |
| zip-slip-nested.tar                 | kevva         | REJECTED  | 0             | 0            | 0                | no             | 63        | Error: Refusing to create a directory outside the output path.                   |
| zip-slip-nested.tar                 | xhmikosr      | REJECTED  | 0             | 0            | 0                | no             | 68        | Error: Refusing to create a directory outside the output path.                   |
| zip-slip-nested.zip                 | umar0x-native | REJECTED  | 0             | 0            | 0                | no             | 56        | PathTraversalError: PATH_TRAVERSAL: '..' segment in path: a/../../b.txt          |
| zip-slip-nested.zip                 | umar0x-compat | REJECTED  | 0             | 0            | 0                | no             | 56        | PathTraversalError: PATH_TRAVERSAL: '..' segment in path: a/../../b.txt          |
| zip-slip-nested.zip                 | kevva         | REJECTED  | 0             | 0            | 0                | no             | 64        | Error: invalid relative path: a/../../b.txt                                      |
| zip-slip-nested.zip                 | xhmikosr      | REJECTED  | 0             | 0            | 0                | no             | 67        | Error: invalid relative path: a/../../b.txt                                      |

## umar0x-native with links opted in (containment proof)

| Fixture                  | Outcome  | Write escapes | Link escapes | Hardlink escapes | Error                                                                            |
| ------------------------ | -------- | ------------- | ------------ | ---------------- | -------------------------------------------------------------------------------- |
| tar-hardlink-outside.tar | REJECTED | 0             | 0            | 0                | LinkEscapeError: LINK_ESCAPE: hardlink target escapes output: "../../outside-sen |
| tar-symlink-abs.tar      | REJECTED | 0             | 0            | 0                | LinkEscapeError: LINK_ESCAPE: symlink target escapes output: "/etc/passwd" -> /e |
| tar-symlink-chain.tar    | REJECTED | 0             | 0            | 0                | LinkEscapeError: LINK_ESCAPE: symlink target escapes output: "../outside-sentine |
| zip-symlink-escape.zip   | REJECTED | 0             | 0            | 0                | LinkEscapeError: LINK_ESCAPE: symlink target escapes output: "../../outside-sent |
| hardlink-to-absolute.tar | REJECTED | 0             | 0            | 0                | LinkEscapeError: LINK_ESCAPE: hardlink target escapes output: "/etc/passwd" -> / |
| hardlink-to-parent.tar   | REJECTED | 0             | 0            | 0                | LinkEscapeError: LINK_ESCAPE: hardlink target escapes output: "../secret.txt" -> |
| link_escape.tar.gz       | REJECTED | 0             | 0            | 0                | LinkEscapeError: LINK_ESCAPE: hardlink target escapes output: "../outside.txt" - |
| link_via_trap.tar.gz     | REJECTED | 0             | 0            | 0                | LinkEscapeError: LINK_ESCAPE: symlink target escapes output: "/etc" -> /etc      |
| symlink-chain-escape.tar | REJECTED | 0             | 0            | 0                | LinkEscapeError: LINK_ESCAPE: symlink target escapes output: "/etc" -> /etc      |
| symlink-to-absolute.tar  | REJECTED | 0             | 0            | 0                | LinkEscapeError: LINK_ESCAPE: symlink target escapes output: "/etc/passwd" -> /e |
| symlink-to-parent.tar    | REJECTED | 0             | 0            | 0                | LinkEscapeError: LINK_ESCAPE: symlink target escapes output: ".." -> /home/z/my- |
| symlink_escape.tar.gz    | REJECTED | 0             | 0            | 0                | LinkEscapeError: LINK_ESCAPE: symlink target escapes output: "../../outside.txt" |

## Benign integrity vs Python ground truth

| Fixture                  | Library       | Outcome   | Content matches ground truth |
| ------------------------ | ------------- | --------- | ---------------------------- |
| contiguous_file.tar      | umar0x-native | EXTRACTED | PASS                         |
| contiguous_file.tar      | umar0x-compat | EXTRACTED | PASS                         |
| contiguous_file.tar      | kevva         | EXTRACTED | PASS                         |
| contiguous_file.tar      | xhmikosr      | EXTRACTED | PASS                         |
| directory.tar            | umar0x-native | EXTRACTED | PASS                         |
| directory.tar            | umar0x-compat | EXTRACTED | PASS                         |
| directory.tar            | kevva         | EXTRACTED | PASS                         |
| directory.tar            | xhmikosr      | EXTRACTED | PASS                         |
| file.tar                 | umar0x-native | EXTRACTED | PASS                         |
| file.tar                 | umar0x-compat | EXTRACTED | PASS                         |
| file.tar                 | kevva         | EXTRACTED | PASS                         |
| file.tar                 | xhmikosr      | EXTRACTED | PASS                         |
| file.tar.bz2             | umar0x-native | EXTRACTED | PASS                         |
| file.tar.bz2             | umar0x-compat | EXTRACTED | PASS                         |
| file.tar.bz2             | kevva         | EXTRACTED | PASS                         |
| file.tar.bz2             | xhmikosr      | EXTRACTED | PASS                         |
| file.tar.gz              | umar0x-native | EXTRACTED | PASS                         |
| file.tar.gz              | umar0x-compat | EXTRACTED | PASS                         |
| file.tar.gz              | kevva         | EXTRACTED | PASS                         |
| file.tar.gz              | xhmikosr      | EXTRACTED | PASS                         |
| file.zip                 | umar0x-native | EXTRACTED | PASS                         |
| file.zip                 | umar0x-compat | EXTRACTED | PASS                         |
| file.zip                 | kevva         | EXTRACTED | PASS                         |
| file.zip                 | xhmikosr      | EXTRACTED | PASS                         |
| leading_dots.tar.gz      | umar0x-native | REJECTED  | n/a                          |
| leading_dots.tar.gz      | umar0x-compat | REJECTED  | n/a                          |
| leading_dots.tar.gz      | kevva         | EXTRACTED | PASS                         |
| leading_dots.tar.gz      | xhmikosr      | EXTRACTED | PASS                         |
| link.tar                 | umar0x-native | REJECTED  | n/a                          |
| link.tar                 | umar0x-compat | REJECTED  | n/a                          |
| link.tar                 | kevva         | REJECTED  | n/a                          |
| link.tar                 | xhmikosr      | EXTRACTED | PASS                         |
| multiple.zip             | umar0x-native | EXTRACTED | PASS                         |
| multiple.zip             | umar0x-compat | EXTRACTED | PASS                         |
| multiple.zip             | kevva         | EXTRACTED | PASS                         |
| multiple.zip             | xhmikosr      | EXTRACTED | PASS                         |
| nested.tar.gz            | umar0x-native | EXTRACTED | PASS                         |
| nested.tar.gz            | umar0x-compat | EXTRACTED | PASS                         |
| nested.tar.gz            | kevva         | EXTRACTED | PASS                         |
| nested.tar.gz            | xhmikosr      | EXTRACTED | PASS                         |
| symlink.tar              | umar0x-native | REJECTED  | n/a                          |
| symlink.tar              | umar0x-compat | REJECTED  | n/a                          |
| symlink.tar              | kevva         | EXTRACTED | PASS                         |
| symlink.tar              | xhmikosr      | EXTRACTED | PASS                         |
| top_level_example.tar.gz | umar0x-native | EXTRACTED | PASS                         |
| top_level_example.tar.gz | umar0x-compat | EXTRACTED | PASS                         |
| top_level_example.tar.gz | kevva         | EXTRACTED | PASS                         |
| top_level_example.tar.gz | xhmikosr      | EXTRACTED | PASS                         |
| targz-small.tar.gz       | umar0x-native | EXTRACTED | PASS                         |
| targz-small.tar.gz       | umar0x-compat | EXTRACTED | PASS                         |
| targz-small.tar.gz       | kevva         | EXTRACTED | PASS                         |
| targz-small.tar.gz       | xhmikosr      | EXTRACTED | PASS                         |
| zip-small.zip            | umar0x-native | EXTRACTED | PASS                         |
| zip-small.zip            | umar0x-compat | EXTRACTED | PASS                         |
| zip-small.zip            | kevva         | EXTRACTED | PASS                         |
| zip-small.zip            | xhmikosr      | EXTRACTED | PASS                         |
| tar-many.tar             | umar0x-native | EXTRACTED | PASS                         |
| tar-many.tar             | umar0x-compat | EXTRACTED | PASS                         |
| tar-many.tar             | kevva         | EXTRACTED | PASS                         |
| tar-many.tar             | xhmikosr      | EXTRACTED | PASS                         |
| targz-unicode.tar.gz     | umar0x-native | EXTRACTED | PASS                         |
| targz-unicode.tar.gz     | umar0x-compat | EXTRACTED | PASS                         |
| targz-unicode.tar.gz     | kevva         | EXTRACTED | PASS                         |
| targz-unicode.tar.gz     | xhmikosr      | EXTRACTED | PASS                         |
| tarbz2-small.tar.bz2     | umar0x-native | EXTRACTED | PASS                         |
| tarbz2-small.tar.bz2     | umar0x-compat | EXTRACTED | PASS                         |
| tarbz2-small.tar.bz2     | kevva         | EXTRACTED | PASS                         |
| tarbz2-small.tar.bz2     | xhmikosr      | EXTRACTED | PASS                         |
