import { spawn } from 'node:child_process'
import { join } from 'node:path'

import {
  CALL_KILL_GRACE_MS,
  CALL_SILENCE_TIMEOUT_MS,
} from './testShardConstants.mjs'

/** Calls `onElapsed` once when `ms` pass without a `reset()`; the call stays alive until `stop()`. @example const timer = createResettingTimer(1000, () => {}); timer.reset(); timer.stop() */
function createResettingTimer(ms, onElapsed) {
  const handle = setTimeout(onElapsed, ms)
  return {
    reset() {
      handle.refresh()
    },
    stop() {
      clearTimeout(handle)
    },
  }
}

/**
 * Runs one planned `node --test` call and keeps its output together, so two lanes of a shard never interleave their reports; called by `scripts/test-shard.mjs` for every invocation of {@link planTestShards}.
 * @param invocation - `{ files, namePattern?, skipPattern? }` from the plan; a pattern applies to every file of the call.
 * @param testDirectory - Directory of the compiled test files.
 * @param options.silenceTimeoutMs - How long the call may print nothing before it is ended as hung; the reporter prints each test when it ends, so a quiet call is one test that does not end.
 * @returns `{ code, signal, output, elapsedMs, timedOut }` once the process and its streams have closed. `timedOut` is true when the call was ended for its silence (the process then ends with a signal, so `code` is `null`). Coverage is collected through the inherited `NODE_V8_COVERAGE`.
 * @example
 * await runTestInvocation({ files: ['service.test.js'] }, 'dist/tests')
 * // => { code: 0, signal: null, output: '✔ …', elapsedMs: 412 }
 */
export function runTestInvocation(
  invocation,
  testDirectory,
  { silenceTimeoutMs = CALL_SILENCE_TIMEOUT_MS } = {},
) {
  const selection = [
    ...(invocation.namePattern
      ? [`--test-name-pattern=${invocation.namePattern}`]
      : []),
    ...(invocation.skipPattern
      ? [`--test-skip-pattern=${invocation.skipPattern}`]
      : []),
  ]
  // A part ends when its selected tests end. Without this, each part would wait for timers its tests left behind
  // (up to a 20 s product deadline), which the unsplit file absorbs while its later tests run.
  const patterns =
    selection.length > 0 ? ['--test-force-exit', ...selection] : []
  return new Promise((resolve, reject) => {
    const startedAt = performance.now()
    const child = spawn(
      process.execPath,
      [
        '--test',
        // A lane is one sequence: its files run one after another, as each file's own tests do.
        '--test-concurrency=1',
        '--test-reporter=spec',
        ...patterns,
        ...invocation.files.map((file) => join(testDirectory, file)),
      ],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        // A call started from inside a test (the package suite tests this function) must not look like a nested
        // file of that test run, or `node --test` skips its files.
        env: Object.fromEntries(
          Object.entries(process.env).filter(
            ([name]) => name !== 'NODE_TEST_CONTEXT',
          ),
        ),
      },
    )
    const chunks = []
    let timedOut = false
    let killTimer
    // The runner ends its own file processes when it gets SIGTERM and prints what it was running; SIGKILL is only for a runner that ignores it.
    const silenceTimer = createResettingTimer(silenceTimeoutMs, () => {
      timedOut = true
      child.kill('SIGTERM')
      killTimer = setTimeout(() => child.kill('SIGKILL'), CALL_KILL_GRACE_MS)
    })
    const keep = (chunk) => {
      chunks.push(chunk)
      silenceTimer.reset()
    }
    child.stdout.on('data', keep)
    child.stderr.on('data', keep)
    child.on('error', reject)
    child.on('close', (code, signal) => {
      silenceTimer.stop()
      clearTimeout(killTimer)
      resolve({
        code,
        signal,
        output: Buffer.concat(chunks).toString('utf8'),
        elapsedMs: performance.now() - startedAt,
        timedOut,
      })
    })
  })
}
