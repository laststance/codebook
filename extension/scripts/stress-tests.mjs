// Runs compiled test files many times at once, to find tests that fail only under load (Issue #386, task 3).
//
//   node extension/scripts/stress-tests.mjs [--runs 4] [--concurrency 24] [--name <pattern>] [--timeout 600]
//                                           [--failures <dir>] <test-file>...
//
// A fixer or the driving agent runs it after `pnpm --dir extension build` on the files it suspects. Every file is run
// --runs times, with at most --concurrency `node --test` processes alive at once, so the tests meet the processor
// contention of the gate's measured-health run. --name passes a `--test-name-pattern` to every run. A run that takes
// longer than --timeout seconds (600 by default) has its whole process tree ended and counts as failed. --failures keeps
// the standard output of every failed run as `<dir>/<n>-<file name>.<k>.log` (the n-th named file, its k-th failed run),
// so the failure can be read afterwards; the folder must be empty or not exist yet, so no log of an earlier call is
// mistaken for this one's.
//
// It prints one line per file (`<file>: <runs> runs, <failed> failed`), under it one line per test that failed
// (`  ✖ <test name>: <n> of <runs>`, a test counted once per run), and last `STRESS: files=<n> runs=<n> failed_runs=<n>`.
// A run that failed without naming a test (a crash) is counted under `(no test named)`, one ended at its time limit
// under `(time limit)`.
//
// It is a development tool: CI, `/gstack-ship` and the gate never run it, and its result is no suite verdict. SIGINT,
// SIGTERM or SIGHUP to it ends every running child's process tree and exits 130, 143 or 129.
//
// Exit 0: every run passed. Exit 1: at least one run failed. Exit 2: a bad option, a `--failures` folder that holds
// files, or no test file, named on stderr; nothing was run or written.
import { spawn } from 'node:child_process'
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { parseArgs } from 'node:util'

import { endChildrenOnSignal } from './utils/endChildrenOnSignal.mjs'
import { endProcessTree } from './utils/endProcessTree.mjs'
import { isRunAsScript } from './utils/isRunAsScript.mjs'
import { plainOutputEnvironment } from './utils/plainOutputEnvironment.mjs'

/** How often each file runs when `--runs` is not given. */
const DEFAULT_RUNS = 4
/** How many `node --test` processes run at once when `--concurrency` is not given: above the 16 cores, like the load of the measured-health run. */
const DEFAULT_CONCURRENCY = 24
/** How long one run may take when `--timeout` is not given (seconds): ten times the 60 s a test file may record, so only a run that hangs reaches it. */
const DEFAULT_TIMEOUT_SECONDS = 600
/** How much of a run's output is kept (characters): the failing tests' list is at its end, and 24 verbose runs at once must not hold hundreds of megabytes. */
const OUTPUT_KEEP_CHARS = 4_000_000
/** The name a failed run is counted under when its output names no failed test. */
export const NO_TEST_NAMED = '(no test named)'
/** The name a run is counted under when it was ended at its time limit. */
export const TIME_LIMIT = '(time limit)'

/**
 * Reads the names of the failed tests from the output of one `node --test --test-reporter=spec` run.
 *
 * Why: the stress report counts failures per test, and the spec reporter lists every failed test once more under its `✖ failing tests:` heading. Called by {@link stressTests} for each failed run.
 *
 * @param output - The run's standard output.
 * @returns The failed tests' names in the order of the list, without the duration, each name once; empty when the output has no such list.
 *
 * @example
 * ```js
 * failedTestNames('✖ failing tests:\n\ntest at a.js:1:1\n✖ saves the study (12.5ms)\n') // => ['saves the study']
 * ```
 */
export function failedTestNames(output) {
  const heading = output.lastIndexOf('✖ failing tests:')
  if (heading === -1) return []
  const names = new Set()
  // Only the lines after the heading count: the same test is also printed where it ran.
  for (const line of output.slice(heading).split('\n').slice(1)) {
    const match = /^✖ (.+?)(?: \(\d[\d.]*ms\))?$/.exec(line)
    // Two failed tests of one name (in two suites) are one entry: the report says in how many runs a name failed.
    if (match) names.add(match[1])
  }
  return [...names]
}

/**
 * Runs jobs with a bound on how many run at once, and resolves when all have ended.
 *
 * Why: the stress run needs a fixed number of processes alive, whatever the number of files. Called by {@link stressTests}.
 *
 * @param jobs - The jobs, each started when a slot is free.
 * @param concurrency - The number of jobs that may run at once (at least 1).
 * @returns Resolves once every job's promise has settled; rejects with the first job's rejection.
 *
 * @example
 * ```js
 * await runPool([() => runOnce('a.test.js'), () => runOnce('b.test.js')], 1) // b starts after a ended
 * ```
 */
export async function runPool(jobs, concurrency) {
  let next = 0
  const worker = async () => {
    // Each worker takes the next job that no other worker took.
    while (next < jobs.length) await jobs[next++]()
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, jobs.length) }, worker),
  )
}

/**
 * Runs one test file once and resolves with its exit code, the kept end of its standard output and whether its time limit ended it; a run that cannot start counts as failed.
 *
 * Why: a test that hangs under load is one of the failures the tool looks for, so a run that does not end is ended with every process it started and reported, and a signal to the tool leaves no child behind. Called by {@link stressTests} for each run.
 *
 * @param file - The compiled test file.
 * @param namePattern - A `--test-name-pattern` for the run, or `undefined`.
 * @param timeoutMs - How long the run may take before its process tree is ended.
 * @returns `{ code, output, timedOut }`; `code` is 1 for a run that could not start or was ended at its limit.
 *
 * @example
 * ```js
 * await runTestFile('dist/tests/a.test.js', undefined, 600_000) // => { code: 0, output: '✔ …', timedOut: false }
 * ```
 */
function runTestFile(file, namePattern, timeoutMs) {
  return new Promise((resolveRun) => {
    const child = spawn(
      process.execPath,
      [
        '--test',
        '--test-reporter=spec',
        ...(namePattern ? [`--test-name-pattern=${namePattern}`] : []),
        file,
      ],
      {
        stdio: ['ignore', 'pipe', 'ignore'],
        // A parent test runner's context would make the child report to it instead of printing; colour would hide the summary lines.
        env: Object.fromEntries(
          Object.entries(plainOutputEnvironment(process.env)).filter(
            ([name]) => name !== 'NODE_TEST_CONTEXT',
          ),
        ),
      },
    )
    const endTree = () =>
      endProcessTree(child, {
        platform: process.platform,
        environment: process.env,
      })
    const releaseSignalEnd = endChildrenOnSignal(endTree)
    let timedOut = false
    const limit = setTimeout(() => {
      timedOut = true
      void endTree()
    }, timeoutMs)
    let output = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      output = (output + chunk).slice(-OUTPUT_KEEP_CHARS)
    })
    const settle = (code) => {
      clearTimeout(limit)
      releaseSignalEnd()
      resolveRun({ code, output, timedOut })
    }
    child.on('error', () => settle(1))
    // A run ended at its limit failed, whatever its runner exits with afterwards.
    child.on('close', (code) => settle(timedOut ? 1 : (code ?? 1)))
  })
}

/**
 * Runs every file `runs` times under load and counts the failed runs per file and per test.
 *
 * Why: a test that fails once in thirty runs under load is found only by many runs at once. Called by this script's `main` and by its tests (with their own `run`).
 *
 * @param files - The compiled test files.
 * @param options - `runs` per file, `concurrency` of the pool, `timeoutMs` per run, an optional `namePattern`, `run` (how one file is run once; the real `node --test` unless a test replaces it) and `onFailure` (called with `{ file, fileNumber, failureNumber, output }` of a failed run, awaited before the next job of that worker).
 * @returns Per file its failed-run count and, per failed test name, in how many runs it failed; plus the totals.
 *
 * @example
 * ```js
 * await stressTests(['a.test.js'], { runs: 4, concurrency: 24, timeoutMs: 600_000 })
 * // => { files: [{ file: 'a.test.js', runs: 4, failedRuns: 1, failures: { 'saves the study': 1 } }], runs: 4, failedRuns: 1 }
 * ```
 */
export async function stressTests(
  files,
  { runs, concurrency, timeoutMs, namePattern, run = runTestFile, onFailure },
) {
  const results = files.map((file) => ({
    file,
    runs,
    failedRuns: 0,
    failures: {},
  }))
  const jobs = []
  // Runs are interleaved by round, so every file meets the others' load in each of its runs.
  for (let round = 0; round < runs; round++)
    for (const [index, result] of results.entries())
      jobs.push(async () => {
        const { code, output, timedOut } = await run(
          result.file,
          namePattern,
          timeoutMs,
        )
        if (code === 0) return
        result.failedRuns++
        await onFailure?.({
          file: result.file,
          fileNumber: index + 1,
          failureNumber: result.failedRuns,
          output,
        })
        // A run ended at its limit names its hang, not the tests the cut-off output happens to list.
        const named = timedOut ? [TIME_LIMIT] : failedTestNames(output)
        for (const name of named.length ? named : [NO_TEST_NAMED])
          result.failures[name] = (result.failures[name] ?? 0) + 1
      })
  await runPool(jobs, concurrency)
  return {
    files: results,
    runs: runs * files.length,
    failedRuns: results.reduce((sum, result) => sum + result.failedRuns, 0),
  }
}

/** Renders the report lines of a stress result, the `STRESS:` line last. @example renderStress(result).at(-1) // => 'STRESS: files=1 runs=4 failed_runs=1' */
export function renderStress(result) {
  const lines = []
  for (const file of result.files) {
    lines.push(`${file.file}: ${file.runs} runs, ${file.failedRuns} failed`)
    for (const [name, count] of Object.entries(file.failures))
      lines.push(`  ✖ ${name}: ${count} of ${file.runs}`)
  }
  lines.push(
    `STRESS: files=${result.files.length} runs=${result.runs} failed_runs=${result.failedRuns}`,
  )
  return lines
}

/** Ends the script with exit 2 and one line that says what to change. @example refuse('--runs takes a whole number of at least 1.') */
function refuse(sentence) {
  process.stderr.write(`${sentence}\n`)
  process.exit(2)
}

/** Reads a whole positive number written in digits from an option, or ends the script with exit 2. @example positiveOption('24', '--concurrency') // => 24 */
function positiveOption(value, name) {
  // Digits only: `1e3` or `0x10` would be read as numbers the caller did not write.
  if (!/^[1-9]\d*$/.test(value))
    refuse(`${name} takes a whole number of at least 1, written in digits.`)
  return Number(value)
}

/** Makes the folder for the failed runs' outputs, or ends the script with exit 2 when it already holds files. @example await prepareFailuresFolder('failed-runs') */
async function prepareFailuresFolder(directory) {
  const held = await readdir(directory).catch((error) => {
    if (error?.code === 'ENOENT') return []
    throw error
  })
  if (held.length > 0)
    refuse(
      `--failures takes a folder that is empty or does not exist yet; ${directory} holds ${held.length} entries.`,
    )
  await mkdir(directory, { recursive: true })
}

/** Parses the command line, runs the stress and sets the exit code. @example await main() */
async function main() {
  let parsed
  try {
    parsed = parseArgs({
      allowPositionals: true,
      options: {
        runs: { type: 'string', default: String(DEFAULT_RUNS) },
        concurrency: { type: 'string', default: String(DEFAULT_CONCURRENCY) },
        timeout: { type: 'string', default: String(DEFAULT_TIMEOUT_SECONDS) },
        name: { type: 'string' },
        failures: { type: 'string' },
      },
    })
  } catch (error) {
    refuse(error instanceof Error ? error.message : String(error))
  }
  if (parsed.positionals.length === 0)
    refuse(
      'Name at least one compiled test file, e.g. extension/dist/tests/learningSummary.test.js.',
    )
  // Every option is checked before anything is written or run.
  const runs = positiveOption(parsed.values.runs, '--runs')
  const concurrency = positiveOption(parsed.values.concurrency, '--concurrency')
  const timeoutSeconds = positiveOption(parsed.values.timeout, '--timeout')
  const failuresDirectory = parsed.values.failures
  if (failuresDirectory) await prepareFailuresFolder(failuresDirectory)
  const result = await stressTests(parsed.positionals, {
    runs,
    concurrency,
    timeoutMs: timeoutSeconds * 1000,
    namePattern: parsed.values.name,
    // A failed run's output is kept only when a folder for it was named; the file's number keeps two files of one base name apart.
    onFailure: failuresDirectory
      ? ({ file, fileNumber, failureNumber, output }) =>
          writeFile(
            join(
              failuresDirectory,
              `${fileNumber}-${basename(file)}.${failureNumber}.log`,
            ),
            output,
          )
      : undefined,
  })
  process.stdout.write(`${renderStress(result).join('\n')}\n`)
  process.exitCode = result.failedRuns === 0 ? 0 : 1
}

if (isRunAsScript(import.meta.url)) await main()
