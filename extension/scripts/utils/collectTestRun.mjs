import { basename } from 'node:path'
import { run } from 'node:test'

/** Reads one finished top-level test from a runner event; a nested test belongs to its top-level test, which is the unit a name pattern can select. `timedOut` is true for a test the runner failed for its time limit. @example finishedTest(event) // => { file: 'service.test.js', name: 'opens', ms: 12.4, failed: false, timedOut: false } */
function finishedTest(event) {
  if (event.type !== 'test:pass' && event.type !== 'test:fail') return undefined
  if (event.data.nesting !== 0) return undefined
  return {
    file: basename(event.data.file),
    name: event.data.name,
    ms: event.data.details.duration_ms,
    failed: event.type === 'test:fail',
    timedOut: event.data.details.error?.failureType === 'testTimeoutFailure',
  }
}

/**
 * Runs test files with Node's `run()` and collects every finished top-level test; a test that does not end within `testTimeoutMs` fails with the runner's timeout, and the run is aborted at once, because the hung test's file process would otherwise keep the run open.
 *
 * Called by `scripts/test-shard.mjs --record`, which gives the recording the same bound as the shard calls.
 * @param options.files - Absolute paths of the test files.
 * @param options.concurrency - How many files run at the same time.
 * @param options.testTimeoutMs - How long one test may take before it is failed.
 * @returns `{ results, timedOutTests }`: one `{ file, name, ms, failed, timedOut }` per finished top-level test, and the `{ file, name }` of each test that was ended for its time. The files that were still running at an abort end as failed results of the runner's own.
 * @example
 * const { results } = await collectTestRun({ files: ['/repo/dist/tests/a.test.js'], concurrency: 4, testTimeoutMs: 120_000 })
 */
export async function collectTestRun({ files, concurrency, testTimeoutMs }) {
  const abort = new AbortController()
  const results = []
  const timedOutTests = []
  const events = run({
    files,
    concurrency,
    timeout: testTimeoutMs,
    signal: abort.signal,
  })
  for await (const event of events) {
    const finished = finishedTest(event)
    if (!finished) continue
    results.push(finished)
    if (finished.timedOut) {
      timedOutTests.push({ file: finished.file, name: finished.name })
      // A recording with a failed test writes nothing, so nothing is gained by waiting for the other files.
      abort.abort()
    }
  }
  return { results, timedOutTests }
}
