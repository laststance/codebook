import { spawn } from 'node:child_process'
import { join } from 'node:path'

import {
  CALL_KILL_GRACE_MS,
  CALL_SILENCE_TIMEOUT_MS,
} from './testShardConstants.mjs'
import { watchCallSilence } from './watchCallSilence.mjs'

/**
 * Runs one planned `node --test` call and keeps its output together, so two lanes of a shard never interleave their reports; called by `scripts/test-shard.mjs` for every invocation of {@link planTestShards}.
 * @param invocation - `{ files, namePattern?, skipPattern? }` from the plan; a pattern applies to every file of the call.
 * @param testDirectory - Directory of the compiled test files.
 * @param options.silenceTimeoutMs - How long the call may print nothing before it is ended as hung; the reporter prints each test when it ends, so a quiet call is one test that does not end.
 * @param options.killGraceMs - How long a call ended for silence may take to stop on SIGTERM before it is killed; {@link CALL_KILL_GRACE_MS} by default, so a test of the kill does not wait 5 s.
 * @param options.runnerArguments - The arguments that start the runner, before the call's own flags; `['--test']` (Node's test runner) by default. A test passes the path of a stand-in script, because the real runner exits within milliseconds of SIGTERM and cannot show how a slow or stubborn runner is treated.
 * @returns `{ code, signal, output, elapsedMs, timedOut }` once the process and its streams have closed. `code` is the runner's exit code when it exits by itself and `null` when a signal ended it (`signal` then names it); a runner that winds down after the SIGTERM of a silence end exits with its own code, 0 or not, so a caller reads `timedOut`, never `code`, to know that the call was ended for its silence. Coverage is collected through the inherited `NODE_V8_COVERAGE`.
 * @example
 * await runTestInvocation({ files: ['service.test.js'] }, 'dist/tests')
 * // => { code: 0, signal: null, output: '✔ …', elapsedMs: 412, timedOut: false }
 */
export function runTestInvocation(
  invocation,
  testDirectory,
  {
    silenceTimeoutMs = CALL_SILENCE_TIMEOUT_MS,
    killGraceMs = CALL_KILL_GRACE_MS,
    runnerArguments = ['--test'],
  } = {},
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
        ...runnerArguments,
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
    // A call that prints nothing for the silence limit is ended by {@link watchCallSilence}: on POSIX the runner gets SIGTERM, ends the
    // test-file processes it started and prints what it was running, and SIGKILL follows only for a runner that ignores it; on Windows the
    // runner's whole process tree is ended at once, because `child.kill()` there ends the runner alone.
    const watch = watchCallSilence(child, { silenceTimeoutMs, killGraceMs })
    const chunks = []
    const keep = (chunk) => {
      chunks.push(chunk)
      watch.keepAlive()
    }
    child.stdout.on('data', keep)
    child.stderr.on('data', keep)
    child.on('error', (error) => {
      // A call that cannot run has nothing to wait for: its timers must not outlive the rejection.
      watch.stop()
      reject(error)
    })
    child.on('close', (code, signal) => {
      watch.stop()
      resolve({
        code,
        signal,
        output: Buffer.concat(chunks).toString('utf8'),
        elapsedMs: performance.now() - startedAt,
        timedOut: watch.timedOut,
      })
    })
  })
}
