# @umar0x/decompress-cli

Command-line interface for `@umar0x/decompress` on Node.js 20+.

```sh
npm install --global @umar0x/decompress-cli

decompress extract archive.zip output --max-files 10000
decompress list archive.tar.gz --pretty
decompress audit upload.zip --pretty
```

The audit command returns exit code 1 for high or critical risk. Extraction errors also return 1,
usage errors return 2, and SIGINT returns 130 after best-effort cleanup. Links are refused by
default; all native size/count/depth/ratio limits apply.

Project documentation: https://github.com/umar0x/decompress
