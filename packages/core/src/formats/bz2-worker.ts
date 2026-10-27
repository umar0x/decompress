// Worker thread entry for the parallel bzip2 decoder. Built as a standalone
// CJS bundle (dist/bz2-worker.cjs) so it can be spawned directly by
// worker_threads from both the ESM and CJS library builds. The decode logic
// lives in bz2-block.ts, shared with the test suite.
//
// Protocol (jobs processed in message order):
//   parent -> worker: { jobId, kind: 'file', filePath, byteStart, byteEnd,
//                       bitOffsetInBuffer }
//                    | { jobId, kind: 'buffer', payload: ArrayBuffer (header +
//                       block bytes, transferred), bitOffsetInBuffer }
//   worker -> parent: { jobId, ok: true, data: ArrayBuffer, crc: number }
//                    | { jobId, ok: false, message: string, errorCode?: number }

import { parentPort } from 'node:worker_threads';
import { runBlockJob, type BlockJob } from './bz2-block.ts';

parentPort?.on('message', (job: BlockJob) => {
  runBlockJob(job)
    .then((result) => {
      parentPort?.postMessage({ jobId: job.jobId, ok: true, data: result.data, crc: result.crc }, [
        result.data,
      ]);
    })
    .catch((error: unknown) => {
      const err = error as { message?: string; errorCode?: number };
      parentPort?.postMessage({
        jobId: job.jobId,
        ok: false,
        message: err?.message ? String(err.message) : String(error),
        errorCode: typeof err?.errorCode === 'number' ? err.errorCode : undefined,
      });
    });
});
