// Runs the tests the gstack pre-gate selected, as `node --test` runs them in this repository.
//
//   node extension/scripts/run-pregate-tests.mjs [--silence-seconds 120] [--build-seconds 300] <repository-relative test files…>
//
// The pre-gate calls it through `runner` in `.gstack/pregate.json` from the repository root. It writes dist with
// `build-fast` first, so the TypeScript tests run as the JavaScript of the current tree, then runs the product tests
// and, after them, the other tests four at a time (the package tests rebuild dist), and prints one summary of both.
// A run that prints nothing for the silence limit (120 s by default, as in test-shard.mjs; 300 s for a run that holds package.test.mjs, whose
// `before` hook builds the package without output; --silence-seconds sets one limit for every run) is ended, named, and fails the lane.
// The build is ended, and the lane fails, when it takes longer than the build limit (300 s by default).
import { spawn, spawnSync } from 'node:child_process'
import { relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { mapPregateTests } from './utils/mapPregateTests.mjs'
import { parseSecondsOption } from './utils/parseSecondsOption.mjs'
import { parseSilenceSeconds } from './utils/parseSilenceSeconds.mjs'
import { plainOutputEnvironment } from './utils/plainOutputEnvironment.mjs'
import {
  combinedSummary,
  planPregateRuns,
  runSummaryLine,
} from './utils/planPregateRuns.mjs'
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

/** Says in one line why a build that did not run to its end failed: it was ended at its limit, or it could not start. A build that ran and failed has printed its own reasons. @example reportBuildFailure({ error: { code: 'ETIMEDOUT' } }, 300) // prints 'run-pregate-tests: the build did not end within 300 s and was ended.' */
function reportBuildFailure(build, limitSeconds) {
  if (build.error?.code === 'ETIMEDOUT')
    console.error(
      `run-pregate-tests: the build did not end within ${limitSeconds} s and was ended.`,
    )
  else if (build.error)
    console.error(
      `run-pregate-tests: the build could not start: ${build.error.message}`,
    )
}

const build = spawnSync(process.execPath, ['scripts/build-fast.mjs'], {
  cwd: extension,
  stdio: 'inherit',
  // A hung build must not hold the pre-gate; SIGKILL, because a build that handles SIGTERM could outlive its limit.
  timeout: buildSeconds * 1000,
  killSignal: 'SIGKILL',
})
// A failed build leaves no current dist to test.
if (build.status !== 0) {
  reportBuildFailure(build, buildSeconds)
  process.exit(build.status ?? 1)
}

/** Runs one planned `node --test` call, prints its output with its summary lines marked as the run's own, and answers its exit code, output and whether it was ended for its silence. @example await runTests({ files: ['/repo/extension/dist/tests/a.test.js'], args: [] }) // => { code: 0, output: '✔ …', timedOut: false } */
function runTests({ files, args }) {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, ['--test', ...args, ...files], {
      cwd: extension,
      stdio: ['ignore', 'pipe', 'pipe'],
      // The summary lines are read as text (`ℹ tests 12`); FORCE_COLOR would put colour codes around them.
      env: plainOutputEnvironment(process.env),
    })
    // Output on either stream shows that the run is alive.
    const silenceTimeoutMs = silenceLimitOfRun(
      files,
      silenceSeconds === undefined ? undefined : silenceSeconds * 1000,
    )
    const watch = watchCallSilence(child, {
      silenceTimeoutMs,
      killGraceMs: CALL_KILL_GRACE_MS,
    })
    let output = ''
    let pending = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      watch.keepAlive()
      output += chunk
      const lines = (pending + chunk).split('\n')
      pending = lines.pop() ?? ''
      for (const line of lines)
        process.stdout.write(runSummaryLine(line) + '\n')
    })
    child.stderr.on('data', (chunk) => {
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
    child.on('close', (code) => {
      watch.stop()
      // The last line may come without its line end.
      if (pending) process.stdout.write(runSummaryLine(pending) + '\n')
      if (watch.timedOut)
        console.error(
          `✖ ${files.map((file) => relative(repositoryRoot, file)).join(', ')} printed nothing for ${silenceTimeoutMs / 1000} s and was ended; the test after the last one printed above did not end.`,
        )
      resolveRun({ code: code ?? 1, output, timedOut: watch.timedOut })
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
