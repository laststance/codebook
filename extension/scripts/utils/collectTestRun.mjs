import { basename } from 'node:path'
import { run } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'

import { createResettingTimer } from './createResettingTimer.mjs'
import { endChildrenOnSignal } from './endChildrenOnSignal.mjs'
import { killProcessIds } from './killProcessIds.mjs'
import { listProcessIdsUnder } from './listProcessIdsUnder.mjs'
import {
  CALL_KILL_GRACE_MS,
  RECORD_STALL_MARGIN_MS,
} from './testShardConstants.mjs'

/** How often the recording looks for file processes that are still running after an abort. */
const FILE_PROCESS_POLL_MS = 100

/** Tells whether the cause of a failed hook is the runner's time limit. Node 24.21 sends a hook that did not end as a `test:fail` of each test of its file with `failureType: 'hookFailed'` and `cause: 'test timed out after 1000ms'`, a string; a hook that threw has an `Error` as its cause. @example failedForTime({ failureType: 'hookFailed', cause: 'test timed out after 1000ms' }) // => true */
function failedForTime(error) {
  const cause = error?.cause
  const text = typeof cause === 'string' ? cause : cause?.message
  return (
    error?.failureType === 'hookFailed' &&
    /^test timed out after \d+ms$/.test(text ?? '')
  )
}

/** Reads one finished top-level test from a runner event; a nested test belongs to its top-level test, which is the unit a name pattern can select. `timedOut` is true for a test the runner failed for its time limit, `hookTimedOut` for a test the runner failed because a hook did not end within it. @example finishedTest(event) // => { file: 'service.test.js', name: 'opens', ms: 12.4, failed: false, timedOut: false, hookTimedOut: false } */
function finishedTest(event) {
  if (event.type !== 'test:pass' && event.type !== 'test:fail') return undefined
  if (event.data.nesting !== 0) return undefined
  return {
    file: basename(event.data.file),
    name: event.data.name,
    ms: event.data.details.duration_ms,
    failed: event.type === 'test:fail',
    timedOut: event.data.details.error?.failureType === 'testTimeoutFailure',
    hookTimedOut: failedForTime(event.data.details.error),
  }
}

/** Keeps the set of files whose process started and has not ended: a file starts at its `test:dequeue` (its name is its own path), and ends at its own summary or its own completion. @example followFile(event, running) */
function followFile(event, running) {
  const { file, name, nesting } = event.data ?? {}
  if (file === undefined) return
  if (event.type === 'test:dequeue' && nesting === 0 && name === file)
    running.add(basename(file))
  else if (event.type === 'test:summary') running.delete(basename(file))
  else if (event.type === 'test:complete' && nesting === 0 && name === file)
    running.delete(basename(file))
}

/** Ends every process that runs under this one with SIGKILL; the recording starts nothing but the runner's file processes. @example endProcessesUnderThisOne() */
function endProcessesUnderThisOne() {
  killProcessIds(listProcessIdsUnder(process.pid))
}

/**
 * Runs test files with Node's `run()` and collects every finished top-level test. The run is aborted, and its file processes ended, as soon as a test does not end within `testTimeoutMs` (the runner fails it with its timeout), a hook does not end within it (the runner fails the hook's tests as `hookFailed` for its time), or the run sends no event for the limit (plus {@link RECORD_STALL_MARGIN_MS}, so the runner's own timeout event comes first), as a file whose process does not exit after its tests ends.
 *
 * An abort makes the runner send SIGTERM to its file processes, which a test file may ignore; the recording therefore waits for them within `killGraceMs` and then ends every process that still runs under this one with SIGKILL (it starts nothing else), so nothing of the run outlives it. A SIGINT, SIGTERM or SIGHUP to this process ends them the same way ({@link endChildrenOnSignal}).
 *
 * Called by `scripts/test-shard.mjs --record`, which gives the recording the same bound as the shard calls.
 * @param options.files - Absolute paths of the test files.
 * @param options.concurrency - How many files run at the same time.
 * @param options.testTimeoutMs - How long one test, or a hook, may take before it is failed, and the base of the silence bound of the whole run.
 * @param options.killGraceMs - How long the file processes get to end after an abort before they are killed ({@link CALL_KILL_GRACE_MS} by default).
 * @param options.stallMarginMs - The time added to `testTimeoutMs` for the run's silence bound ({@link RECORD_STALL_MARGIN_MS} by default).
 * @returns `{ results, timedOutTests, hookTimedOutTests, stall }`: one `{ file, name, ms, failed, timedOut, hookTimedOut }` per finished top-level test, the `{ file, name }` of each test that was ended for its time, the `{ file, name }` of each test whose hook did not end, and `{ files }` (the names of the files that started and did not end) when the run sent nothing for the limit, `undefined` otherwise. The files that were still running at an abort end as failed results of the runner's own.
 * @example
 * const { results } = await collectTestRun({ files: ['/repo/dist/tests/a.test.js'], concurrency: 4, testTimeoutMs: 120_000 })
 */
export async function collectTestRun({
  files,
  concurrency,
  testTimeoutMs,
  killGraceMs = CALL_KILL_GRACE_MS,
  stallMarginMs = RECORD_STALL_MARGIN_MS,
}) {
  const abort = new AbortController()
  const results = []
  const timedOutTests = []
  const hookTimedOutTests = []
  const runningFiles = new Set()
  let stall
  let abortedAt
  let forceTimer
  const abortRun = () => {
    if (abort.signal.aborted) return
    abort.abort()
    abortedAt = performance.now()
    // The abort ends the stream even when a file process ignores SIGTERM; this timer kills such a process when the grace has passed.
    forceTimer = setTimeout(endProcessesUnderThisOne, killGraceMs)
  }
  const stallTimer = createResettingTimer(testTimeoutMs + stallMarginMs, () => {
    stall = { files: [...runningFiles] }
    abortRun()
  })
  const releaseSignalEnd = endChildrenOnSignal(endProcessesUnderThisOne)
  const events = run({
    files,
    concurrency,
    timeout: testTimeoutMs,
    signal: abort.signal,
  })
  try {
    for await (const event of events) {
      stallTimer.reset()
      followFile(event, runningFiles)
      const finished = finishedTest(event)
      if (!finished) continue
      results.push(finished)
      const named = { file: finished.file, name: finished.name }
      if (finished.timedOut) timedOutTests.push(named)
      if (finished.hookTimedOut) hookTimedOutTests.push(named)
      // A recording with a failed test writes nothing, so nothing is gained by waiting for the other files.
      if (finished.timedOut || finished.hookTimedOut) abortRun()
    }
  } catch (error) {
    // A run that failed in an unexpected way leaves no file process behind either.
    endProcessesUnderThisOne()
    throw error
  } finally {
    stallTimer.stop()
    releaseSignalEnd()
  }
  if (abort.signal.aborted)
    await endFileProcessesAfterAbort(abortedAt, killGraceMs)
  clearTimeout(forceTimer)
  return { results, timedOutTests, hookTimedOutTests, stall }
}

/** Waits for the file processes of an aborted run to end within what is left of the grace, then ends the ones that still run with SIGKILL. @example await endFileProcessesAfterAbort(performance.now(), 5_000) */
async function endFileProcessesAfterAbort(abortedAt, killGraceMs) {
  const deadline = abortedAt + killGraceMs
  while (
    listProcessIdsUnder(process.pid).length > 0 &&
    performance.now() < deadline
  )
    await delay(FILE_PROCESS_POLL_MS)
  endProcessesUnderThisOne()
}
