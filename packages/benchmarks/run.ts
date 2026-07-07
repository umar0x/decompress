// End-to-end comparison with compatible archive extractors.

import { extract as decompressNative } from '@umar0x/decompress';
import decompressCompat from '@umar0x/decompress-compatible';
import { mkdtemp, rm } from 'node:fs/promises';
import nodePath from 'node:path';
import { tmpdir } from 'node:os';
import tar from 'tar-stream';
import { createGzip } from 'node:zlib';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import type { Headers } from 'tar-stream';

async function buildTarAsync(
  entries: Array<{ name: string; content?: Buffer | string; type?: string; mode?: number }>,
) {
  const pack = tar.pack();
  const drain = (async () => {
    const chunks = [];
    for await (const c of pack) chunks.push(c);
    return Buffer.concat(chunks);
  })();
  for (const e of entries) {
    const h: Headers = {
      name: e.name,
      type: (e.type ?? 'file') as Headers['type'],
      mode: e.mode ?? 0o644,
      mtime: new Date(),
    };
    const content = Buffer.isBuffer(e.content) ? e.content : Buffer.from(e.content ?? '');
    h.size = content.length;
    await new Promise<void>((resolve, reject) =>
      pack.entry(h, content, (error) => (error ? reject(error) : resolve())),
    );
  }
  pack.finalize();
  return drain;
}

async function buildGzip(buf: Buffer) {
  const chunks: Buffer[] = [];
  for await (const c of Readable.from([buf]).pipe(createGzip())) chunks.push(c);
  return Buffer.concat(chunks);
}

async function makeSmallTargz() {
  // 100 small files in a tar.gz
  const entries = Array.from({ length: 100 }, (_, i) => ({
    name: `file${i}.txt`,
    content: `file ${i} content ${'x'.repeat(100)}`,
  }));
  const tar = await buildTarAsync(entries);
  return buildGzip(tar);
}

async function makeMediumTargz() {
  // 1000 files, ~1KB each
  const entries = Array.from({ length: 1000 }, (_, i) => ({
    name: `dir/file${i}.txt`,
    content: 'y'.repeat(1024),
  }));
  const tar = await buildTarAsync(entries);
  return buildGzip(tar);
}

async function time(fn: () => Promise<unknown>, runs = 5) {
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    await fn();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)]!;
  const p95 = times[Math.floor(times.length * 0.95)] ?? times[times.length - 1]!;
  return { median, p95 };
}

async function main() {
  console.log('Building benchmark archives...');
  const small = await makeSmallTargz();
  const medium = await makeMediumTargz();
  console.log(`  small tar.gz: ${small.length} bytes (100 files)`);
  console.log(`  medium tar.gz: ${medium.length} bytes (1000 files)`);

  // Competitors are optional development dependencies.
  type DecompressFunction = (input: Buffer, output: string) => Promise<unknown>;
  let kevvaDecompress: DecompressFunction | null = null;
  let xhmikosrDecompress: DecompressFunction | null = null;
  try {
    kevvaDecompress = (await import('decompress')).default;
  } catch {
    console.log('  (decompress not installed; skipping comparison)');
  }
  try {
    xhmikosrDecompress = (await import('@xhmikosr/decompress')).default;
  } catch {
    console.log('  (@xhmikosr/decompress not installed; skipping comparison)');
  }

  const results: string[] = [];
  results.push('# Benchmark Results\n');
  results.push('| Scenario | Library | Median (ms) | p95 (ms) |');
  results.push('|---|---|---|---|');

  // Small tar.gz
  {
    const out1 = await mkdtemp(nodePath.join(tmpdir(), 'decompress-bench-'));
    const t1 = await time(async () => {
      await decompressNative(small, nodePath.join(out1, 'r'), { maxCompressionRatio: 10_000 });
      await rm(nodePath.join(out1, 'r'), { recursive: true, force: true });
    });
    results.push(
      `| small tar.gz (100 files) | @umar0x/decompress | ${t1.median.toFixed(1)} | ${t1.p95.toFixed(1)} |`,
    );
    await rm(out1, { recursive: true, force: true });

    const out2 = await mkdtemp(nodePath.join(tmpdir(), 'decompress-bench-'));
    const t2 = await time(async () => {
      await decompressCompat(small, nodePath.join(out2, 'r'));
      await rm(nodePath.join(out2, 'r'), { recursive: true, force: true });
    });
    results.push(
      `| small tar.gz (100 files) | @umar0x/decompress-compatible | ${t2.median.toFixed(1)} | ${t2.p95.toFixed(1)} |`,
    );
    await rm(out2, { recursive: true, force: true });

    if (kevvaDecompress) {
      const out3 = await mkdtemp(nodePath.join(tmpdir(), 'decompress-bench-'));
      const t3 = await time(async () => {
        await kevvaDecompress(small, nodePath.join(out3, 'r'));
        await rm(nodePath.join(out3, 'r'), { recursive: true, force: true });
      });
      results.push(
        `| small tar.gz (100 files) | decompress (kevva) | ${t3.median.toFixed(1)} | ${t3.p95.toFixed(1)} |`,
      );
      await rm(out3, { recursive: true, force: true });
    }

    if (xhmikosrDecompress) {
      const out4 = await mkdtemp(nodePath.join(tmpdir(), 'decompress-bench-'));
      const t4 = await time(async () => {
        await xhmikosrDecompress(small, nodePath.join(out4, 'r'));
        await rm(nodePath.join(out4, 'r'), { recursive: true, force: true });
      });
      results.push(
        `| small tar.gz (100 files) | @xhmikosr/decompress | ${t4.median.toFixed(1)} | ${t4.p95.toFixed(1)} |`,
      );
      await rm(out4, { recursive: true, force: true });
    }
  }

  // Medium tar.gz
  {
    const out1 = await mkdtemp(nodePath.join(tmpdir(), 'decompress-bench-'));
    const t1 = await time(async () => {
      await decompressNative(medium, nodePath.join(out1, 'r'), { maxCompressionRatio: 10_000 });
      await rm(nodePath.join(out1, 'r'), { recursive: true, force: true });
    });
    results.push(
      `| medium tar.gz (1000 files) | @umar0x/decompress | ${t1.median.toFixed(1)} | ${t1.p95.toFixed(1)} |`,
    );
    await rm(out1, { recursive: true, force: true });

    const out2 = await mkdtemp(nodePath.join(tmpdir(), 'decompress-bench-'));
    const t2 = await time(async () => {
      await decompressCompat(medium, nodePath.join(out2, 'r'));
      await rm(nodePath.join(out2, 'r'), { recursive: true, force: true });
    });
    results.push(
      `| medium tar.gz (1000 files) | @umar0x/decompress-compatible | ${t2.median.toFixed(1)} | ${t2.p95.toFixed(1)} |`,
    );
    await rm(out2, { recursive: true, force: true });

    if (kevvaDecompress) {
      const out3 = await mkdtemp(nodePath.join(tmpdir(), 'decompress-bench-'));
      const t3 = await time(async () => {
        await kevvaDecompress(medium, nodePath.join(out3, 'r'));
        await rm(nodePath.join(out3, 'r'), { recursive: true, force: true });
      });
      results.push(
        `| medium tar.gz (1000 files) | decompress (kevva) | ${t3.median.toFixed(1)} | ${t3.p95.toFixed(1)} |`,
      );
      await rm(out3, { recursive: true, force: true });
    }

    if (xhmikosrDecompress) {
      const out4 = await mkdtemp(nodePath.join(tmpdir(), 'decompress-bench-'));
      const t4 = await time(async () => {
        await xhmikosrDecompress(medium, nodePath.join(out4, 'r'));
        await rm(nodePath.join(out4, 'r'), { recursive: true, force: true });
      });
      results.push(
        `| medium tar.gz (1000 files) | @xhmikosr/decompress | ${t4.median.toFixed(1)} | ${t4.p95.toFixed(1)} |`,
      );
      await rm(out4, { recursive: true, force: true });
    }
  }

  const report = results.join('\n');
  console.log('\n' + report);

  const { writeFile: wf } = await import('node:fs/promises');
  const here = nodePath.dirname(fileURLToPath(import.meta.url));
  await wf(nodePath.join(here, 'results.md'), report + '\n');
  console.log('\nWrote packages/benchmarks/results.md');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
