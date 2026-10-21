// Runs the tests the gstack pre-gate selected, as `node --test` runs them in this repository.
//
//   node extension/scripts/run-pregate-tests.mjs [--silence-seconds 120] [--build-seconds 300] <repository-relative test files…>
//
// The pre-gate calls it through `runner` in `.gstack/pregate.json` from the repository root. It writes dist with
// `build-fast` first, so the TypeScript tests run as the JavaScript of the current tree, then runs the product tests
// and, after them, the other tests four at a time (the package tests rebuild dist), and prints one summary of both.
// A run that prints nothing for the silence limit (120 s by default, as in test-shard.mjs; 300 s for a run that holds package.test.mjs, whose
// `before` hook builds the package without output; --silence-seconds sets one limit for every run) is ended, named, and fails the lane.
// The build is ended with everything it started, and the lane fails, when it takes longer than the build limit (300 s by default).
// The build and the runs stay in this runner's process group (no session of their own), so whoever ends the group ends them, with one exception: the package commands that `package.test.mjs` starts inside a run (`runPackageCommand`: `detached: true`, and pnpm moves its lifecycle scripts into groups of their own too) run in process groups of their own, which a kill of the lane's group does not reach (no handler runs at SIGKILL); they end at their own limit and at a SIGINT, SIGTERM, SIGHUP or SIGQUIT to the package test. The build starts no process (`build-fast.mjs` emits the files in its own process), so the sentence holds for it without exception. A SIGINT, SIGTERM or SIGHUP to the runner alone ends every live child's whole tree and exits with 128 plus the signal's number.
// Each run's output is written as it comes and only its end is kept (for the combined summary), so a test that prints without end does not fill the runner's memory.
import { spawn } from 'node:child_process'
import { relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { createBoundedOutput } from './utils/createBoundedOutput.mjs'
import { createRunLineForwarder } from './utils/createRunLineForwarder.mjs'
import { isEndingForSignal } from './utils/endChildrenOnSignal.mjs'
import { mapPregateTests } from './utils/mapPregateTests.mjs'
import { parseSecondsOption } from './utils/parseSecondsOption.mjs'
import { parseSilenceSeconds } from './utils/parseSilenceSeconds.mjs'
import { plainOutputEnvironment } from './utils/plainOutputEnvironment.mjs'
import { combinedSummary, planPregateRuns } from './utils/planPregateRuns.mjs'
import { runBuildWithLimit } from './utils/runBuildWithLimit.mjs'
import { silenceLimitOfRun } from './utils/silenceLimitOfRun.mjs'
import {
  CALL_KILL_GRACE_MS,
  PREGATE_BUILD_TIMEOUT_MS,
} from './utils/testShardConstants.mjs'
import { watchCallSilence } from './utils/watchCallSilence.mjs'

const extension = fileURLToPath(new URL('../', import.meta.url))
const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url))

/** Reads the command line: the optional silence limit, the optional build limit and the selected files. A mistake of the caller stops the runner with code 2 before it builds. @example readCommandLine(['--silence-seconds', '60', 'a.test.mjs']) // => { silenceSeconds: 60 (undefined when not given), buildSeconds: 300, selected: ['a.test.mjs'] } */
function readCommandLine(argv) {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        // No default here: a run chooses its own limit unless the caller gave one ({@link silenceLimitOfRun}).
        'silence-seconds': { type: 'string' },
        'build-seconds': {
          type: 'string',
          default: String(PREGATE_BUILD_TIMEOUT_MS / 1000),
        },
      },
    })
    return {
      silenceSeconds:
        values['silence-seconds'] === undefined
          ? undefined
          : parseSilenceSeconds(values['silence-seconds']),
      buildSeconds: parseSecondsOption(
        '--build-seconds',
        values['build-seconds'],
      ),
      selected: positionals,
    }
  } catch (error) {
    console.error(`run-pregate-tests: ${error.message}`)
    process.exit(2)
  }
}

const { silenceSeconds, buildSeconds, selected } = readCommandLine(
  process.argv.slice(2),
)
// No selection is a mistake of the caller, never a pass of "0 tests".
if (selected.length === 0) {
  console.error('run-pregate-tests: no test file was given.')
  process.exit(2)
}
const runs = planPregateRuns(mapPregateTests(repositoryRoot, selected))

/** Says in one line why a build that did not run to its end failed: it was ended at its limit, it could not start, or a signal this runner did not send ended it (an out-of-memory kill, a kill from outside), which leaves the build no word of its own. A build that exited with a failure code has printed its own reasons. @example reportBuildFailure({ timedOut: true }, 300) // prints 'run-pregate-tests: the build did not end within 300 s and was ended.' */
function reportBuildFailure(build, limitSeconds) {
  if (build.timedOut)
    console.error(
      `run-pregate-tests: the build did not end within ${limitSeconds} s and was ended.`,
    )
  else if (build.error)
    console.error(
      `run-pregate-tests: the build could not start: ${build.error.message}`,
    )
  else if (build.signal)
    console.error(`run-pregate-tests: the build was ended by ${build.signal}.`)
}

// A hung build must not hold the pre-gate: at its limit the build is ended with everything it started (its tree: read from the process table on POSIX, `taskkill /T /F` on Windows).
const build = await runBuildWithLimit({
  command: process.execPath,
  args: ['scripts/build-fast.mjs'],
  cwd: extension,
  timeoutMs: buildSeconds * 1000,
})
// A failed build leaves no current dist to test.
if (build.status !== 0) {
  reportBuildFailure(build, buildSeconds)
  process.exit(build.status ?? 1)
}

/** Runs one planned `node --test` call, prints its output with its summary lines marked as the run's own, names a run ended for its silence or by a signal, and answers its exit code, output and whether it was ended for its silence. @example await runTests({ files: ['/repo/extension/dist/tests/a.test.js'], args: [] }) // => { code: 0, output: '✔ …', timedOut: false } */
function runTests({ files, args }) {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, ['--test', ...args, ...files], {
      cwd: extension,
      stdio: ['ignore', 'pipe', 'pipe'],
      // The summary lines are read as text (`ℹ tests 12`); FORCE_COLOR would put colour codes around them.
      env: plainOutputEnvironment(process.env),
    })
    const silenceTimeoutMs = silenceLimitOfRun(
      files,
      silenceSeconds === undefined ? undefined : silenceSeconds * 1000,
    )
    const watch = watchCallSilence(child, {
      silenceTimeoutMs,
      killGraceMs: CALL_KILL_GRACE_MS,
    })
    // The output is written as it comes; only its end is kept, for the combined summary. A test that keeps printing keeps the silence watch alive, and must not fill the memory.
    const output = createBoundedOutput()
    const forwarder = createRunLineForwarder((text) =>
      process.stdout.write(text),
    )
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      // Output on either stream shows that the run is alive.
      watch.keepAlive()
      output.append(chunk)
      forwarder.push(chunk)
    })
    child.stderr.on('data', (chunk) => {
      // Output on either stream shows that the run is alive.
      watch.keepAlive()
      process.stderr.write(chunk)
    })
    child.on('error', (error) => {
      watch.stop()
      // A runner that cannot start closes with a failure code; this line says why.
      console.error(
        `run-pregate-tests: ${files.map((file) => relative(repositoryRoot, file)).join(', ')} could not start: ${error.message}`,
      )
    })
    child.on('close', (code, signal) => {
      watch.stop()
      // A run that closes while a signal ends this runner answers nothing, as the build does: on Windows it closes with its exit while the signal's handler still waits for its `taskkill`, and an answer would start the next run, which nothing would end before the exit ({@link isEndingForSignal}).
      if (isEndingForSignal()) return
      forwarder.end()
      if (watch.timedOut)
        console.error(
          `✖ ${files.map((file) => relative(repositoryRoot, file)).join(', ')} printed nothing for ${silenceTimeoutMs / 1000} s and was ended; the test after the last one printed above did not end.`,
        )
      // A signal this runner did not send (an out-of-memory kill, a kill from outside) leaves the run no word of its own.
      else if (signal)
        console.error(
          `✖ ${files.map((file) => relative(repositoryRoot, file)).join(', ')} was ended by ${signal}.`,
        )
      resolveRun({
        code: code ?? 1,
        output: output.text(),
        timedOut: watch.timedOut,
      })
    })
  })
}

const results = []
// The runs go one after the other: the product tests must end before the package tests rebuild dist.
for (const run of runs) results.push(await runTests(run))
for (const line of combinedSummary(results.map(({ output }) => output)))
  process.stdout.write(line + '\n')
// A run ended for its silence fails the lane whatever the runner exited with after the SIGTERM.
// The exit code is set, not passed to process.exit(): Node ends the process once its output is flushed, so a pipe that reads slowly still gets the combined summary the pre-gate counts from.
process.exitCode = results.some(({ code, timedOut }) => timedOut || code !== 0)
  ? 1
  : 0
