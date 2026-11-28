// Runs compiled test files many times at once, to find tests that fail only under load (Issue #386, task 3).
//
//   node extension/scripts/stress-tests.mjs [--runs 4] [--concurrency 24] [--name <pattern>] [--timeout 600]
//                                           [--failures <dir>] <test-file>...
//
// A fixer or the driving agent runs it after `pnpm --dir extension build` on the files it suspects. Every file is run
// --runs times, with at most --concurrency `node --test` processes alive at once, so the tests meet the processor
// contention of the gate's measured-health run. --runs takes at most 100000 and --concurrency at most 1000. --name
// passes a `--test-name-pattern` to every run; a run of a file in which no test matched the pattern counts as failed. A
// run that takes longer than --timeout seconds (600 by default, at most 2147483, the longest timer Node keeps) has its
// whole process tree ended and counts as failed. --failures keeps the standard output and standard error of every
// failed run as `<dir>/<n>-<file name>.<k>.log` (the n-th named file, its k-th failed run), so the failure can be read
// afterwards; the folder must be empty or not exist yet, so no log of an earlier call is mistaken for this one's. The
// command claims it before any run by creating `<dir>/stress-run.txt` (its start time and arguments), which stays beside
// the logs; a second command on the same folder is refused.
//
// It prints one line per file (`<file>: <runs> runs, <failed> failed`), under it one line per test that failed
// (`  ✖ <test name>: <n> of <runs>`, a test counted once per run), and last `STRESS: files=<n> runs=<n> failed_runs=<n>`.
// A run that failed without naming a test (a crash) is counted under `(no test named)`, one ended at its time limit
// under `(time limit)`, one in which no test matched --name under `(no test matches --name)`.
//
// It is a development tool: CI, `/gstack-ship` and the gate never run it, and its result is no suite verdict. SIGINT,
// SIGTERM or SIGHUP to it ends every running child's process tree and exits 130, 143 or 129. An error during the runs
// (a failure log that cannot be written) ends every running child's process tree too, then exits 1 naming it.
//
// Exit 0: every run passed. Exit 1: at least one run failed, or the runs stopped at an error named on stderr. Exit 2: a
// bad option, a `--failures` path that is no folder, holds files or is owned by another stress run, or no test file,
// named on stderr; nothing was run (and, apart from that claim, nothing written).
import { spawn } from 'node:child_process'
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
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
/** The name a run is counted under when no test of its file matched `--name`. */
export const NO_NAME_MATCH = '(no test matches --name)'
/** The most runs per file: one job is allocated per file and run before the first run starts. */
const MAX_RUNS = 100_000
/** The most runs alive at once, the bound `test-shard.mjs` puts on its lanes. */
const MAX_CONCURRENCY = 1000
/** The longest `--timeout` (seconds): Node's timers hold at most 2^31 - 1 ms and use 1 ms for anything longer. */
const MAX_TIMEOUT_SECONDS = 2_147_483
/** The marker a command creates in its `--failures` folder to claim it. */
const FAILURES_MARKER = 'stress-run.txt'

/**
 * Tells whether a run's output shows that no test of its file matched the `--test-name-pattern`.
 *
 * Why: Node's runner then reports the file itself as one passed test, so a pattern with a typo would read as a clean stress run. Called by {@link stressTests} for a passed run made with a pattern.
 *
 * @param output - The run's output (spec reporter).
 * @param file - The test file as given to the run; Node prints it relative to the working folder.
 * @returns `true` when the only top-level entry is a passed entry named after the file.
 *
 * @example
 * ```js
 * matchedNoTest('✔ a.test.js (30ms)\nℹ tests 1\n', 'a.test.js') // => true
 * matchedNoTest('✔ saves the study (1ms)\nℹ tests 1\n', 'a.test.js') // => false
 * ```
 */
export function matchedNoTest(output, file) {
  // Top-level entries: passed, failed, skipped tests and suites, not the indented subtests or the `ℹ` summary.
  const entries = output.split('\n').filter((line) => /^[✔✖﹣▶] /.test(line))
  if (entries.length !== 1) return false
  const match = /^✔ (.+?)(?: \(\d[\d.]*ms\))?$/.exec(entries[0])
  return match !== null && resolve(match[1]) === resolve(file)
}

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
 * @returns Resolves once every job's promise has settled; rejects with the first job's rejection, at once, while the other workers' jobs may still run (the caller ends them); after a rejection no worker starts another job.
 *
 * @example
 * ```js
 * await runPool([() => runOnce('a.test.js'), () => runOnce('b.test.js')], 1) // b starts after a ended
 * ```
 */
export async function runPool(jobs, concurrency) {
  let next = 0
  let failed = false
  const stopTaking = (error) => {
    failed = true
    throw error
  }
  const worker = async () => {
    // Each worker takes the next job that no other worker took, until the jobs run out or one of them failed.
    while (!failed && next < jobs.length) await jobs[next++]().catch(stopTaking)
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, jobs.length) }, worker),
  )
}

/**
 * Runs one test file once and resolves with its exit code, the kept end of its standard output and error and whether its time limit ended it; a run that cannot start counts as failed.
 *
 * Why: a test that hangs under load is one of the failures the tool looks for, so a run that does not end is ended with every process it started and reported, and a signal to the tool leaves no child behind. Called by {@link stressTests} for each run.
 *
 * @param file - The compiled test file.
 * @param namePattern - A `--test-name-pattern` for the run, or `undefined`.
 * @param timeoutMs - How long the run may take before its process tree is ended.
 * @param liveEnds - A set the run adds its tree-ending function to while it runs, so the caller can end it when the stress run stops at an error; optional.
 * @returns `{ code, output, timedOut }`; `code` is 1 for a run that could not start or was ended at its limit; `output` holds both streams and a start error's message.
 *
 * @example
 * ```js
 * await runTestFile('dist/tests/a.test.js', undefined, 600_000, new Set()) // => { code: 0, output: '✔ …', timedOut: false }
 * ```
 */
function runTestFile(file, namePattern, timeoutMs, liveEnds) {
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
        stdio: ['ignore', 'pipe', 'pipe'],
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
    liveEnds?.add(endTree)
    let timedOut = false
    const limit = setTimeout(() => {
      timedOut = true
      void endTree()
    }, timeoutMs)
    let output = ''
    const keep = (chunk) => {
      output = (output + chunk).slice(-OUTPUT_KEEP_CHARS)
    }
    // Both streams share one bounded output: a start error (a missing file, an invalid pattern) is printed on stderr.
    for (const stream of [child.stdout, child.stderr]) {
      stream.setEncoding('utf8')
      stream.on('data', keep)
    }
    let settled = false
    const settle = (code) => {
      // `error` and `close` can both come for one child; the first answers.
      if (settled) return
      settled = true
      clearTimeout(limit)
      releaseSignalEnd()
      liveEnds?.delete(endTree)
      resolveRun({ code, output, timedOut })
    }
    child.on('error', (error) => {
      keep(`${error.message}\n`)
      settle(1)
    })
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
 * @param options - `runs` per file, `concurrency` of the pool, `timeoutMs` per run, an optional `namePattern`, `run` (how one file is run once, called with the file, the pattern, the limit and a set to add its tree-ending function to; the real `node --test` unless a test replaces it) and `onFailure` (called with `{ file, fileNumber, failureNumber, output }` of a failed run, awaited before the next job of that worker).
 * @returns Per file its failed-run count and, per failed test name, in how many runs it failed; plus the totals.
 * @throws The first error of a job (an `onFailure` that rejects), after every run still alive has had its process tree ended.
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
  // Counts are kept in a Map, so a test named `constructor` or `__proto__` counts like any other.
  const results = files.map((file) => ({
    file,
    runs,
    failedRuns: 0,
    counts: new Map(),
  }))
  const liveEnds = new Set()
  let stopped = false
  const jobs = []
  // Runs are interleaved by round, so every file meets the others' load in each of its runs.
  for (let round = 0; round < runs; round++)
    for (const [index, result] of results.entries())
      jobs.push(async () => {
        const { code, output, timedOut } = await run(
          result.file,
          namePattern,
          timeoutMs,
          liveEnds,
        )
        // A run ended because the stress run stopped at an error is no finding.
        if (stopped) return
        const unmatched =
          namePattern !== undefined &&
          code === 0 &&
          matchedNoTest(output, result.file)
        if (code === 0 && !unmatched) return
        result.failedRuns++
        await onFailure?.({
          file: result.file,
          fileNumber: index + 1,
          failureNumber: result.failedRuns,
          output,
        })
        // A run ended at its limit names its hang, not the tests the cut-off output happens to list.
        const named = timedOut
          ? [TIME_LIMIT]
          : unmatched
            ? [NO_NAME_MATCH]
            : failedTestNames(output)
        for (const name of named.length ? named : [NO_TEST_NAMED])
          result.counts.set(name, (result.counts.get(name) ?? 0) + 1)
      })
  try {
    await runPool(jobs, concurrency)
  } catch (error) {
    // No run may outlive the error: end every live tree before the error leaves.
    stopped = true
    await Promise.allSettled([...liveEnds].map((end) => end()))
    throw error
  }
  return {
    // `fromEntries` defines own properties, so `__proto__` stays a name and not the object's prototype.
    files: results.map(({ counts, ...result }) => ({
      ...result,
      failures: Object.fromEntries(counts),
    })),
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

/**
 * Reads a whole positive number written in digits from an option, or ends the script with exit 2.
 *
 * Why: every option is checked before anything is written or run. Called by `main` for `--runs`, `--concurrency` and `--timeout`.
 *
 * @param value - The option's text.
 * @param name - The option's name, for the refusal.
 * @param maximum - The largest value accepted.
 * @param unit - Text after the maximum in the refusal (e.g. ` (seconds)`), or empty.
 * @returns The number.
 *
 * @example
 * ```js
 * positiveOption('24', '--concurrency', 1000) // => 24
 * ```
 */
function positiveOption(value, name, maximum, unit = '') {
  // Digits only: `1e3` or `0x10` would be read as numbers the caller did not write.
  if (!/^[1-9]\d*$/.test(value))
    refuse(`${name} takes a whole number of at least 1, written in digits.`)
  const number = Number(value)
  // A bound keeps a mistyped number from allocating millions of jobs or overflowing Node's timer.
  if (number > maximum)
    refuse(`${name} takes a whole number of at most ${maximum}${unit}.`)
  return number
}

/**
 * Makes the folder for the failed runs' outputs and claims it with {@link FAILURES_MARKER}, or ends the script with exit 2.
 *
 * Why: two commands on one folder would overwrite each other's logs, and an earlier call's logs would be mistaken for this one's. Called by `main` once every option was checked, before any run.
 *
 * @param directory - The `--failures` path.
 * @param scriptArguments - The command's arguments, written into the marker.
 * @returns Resolves once the folder exists, was empty and holds this command's marker.
 *
 * @example
 * ```js
 * await claimFailuresFolder('failed-runs', process.argv.slice(2))
 * ```
 */
async function claimFailuresFolder(directory, scriptArguments) {
  const found = await stat(directory).catch((error) => {
    // Only a missing folder is made; any other answer is refused by name.
    if (error?.code === 'ENOENT') return undefined
    refuse(`--failures could not read ${directory}: ${error.message}`)
  })
  if (found && !found.isDirectory())
    refuse(`--failures takes a folder; ${directory} is a file.`)
  if (found) {
    const held = await readdir(directory).catch((error) =>
      refuse(`--failures could not read ${directory}: ${error.message}`),
    )
    if (held.length > 0)
      refuse(
        `--failures takes a folder that is empty or does not exist yet; ${directory} holds ${held.length} entries.`,
      )
  }
  await mkdir(directory, { recursive: true })
  const marker = join(directory, FAILURES_MARKER)
  // `wx` fails when the file exists: of two commands that both found the folder empty, only one claims it.
  await writeFile(
    marker,
    `started ${new Date().toISOString()}\narguments ${JSON.stringify(scriptArguments)}\n`,
    { flag: 'wx' },
  ).catch((error) => {
    if (error?.code === 'EEXIST')
      refuse(
        `--failures names a folder that another stress run owns: ${marker} exists.`,
      )
    throw error
  })
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
  const runs = positiveOption(parsed.values.runs, '--runs', MAX_RUNS)
  const concurrency = positiveOption(
    parsed.values.concurrency,
    '--concurrency',
    MAX_CONCURRENCY,
  )
  const timeoutSeconds = positiveOption(
    parsed.values.timeout,
    '--timeout',
    MAX_TIMEOUT_SECONDS,
    ' (seconds)',
  )
  const failuresDirectory = parsed.values.failures
  if (failuresDirectory)
    await claimFailuresFolder(failuresDirectory, process.argv.slice(2))
  let result
  try {
    result = await stressTests(parsed.positionals, {
      runs,
      concurrency,
      timeoutMs: timeoutSeconds * 1000,
      namePattern: parsed.values.name,
      // A failed run's output is kept only when a folder for it was named; the file's number keeps two files of one base name apart; `wx` never overwrites a file.
      onFailure: failuresDirectory
        ? ({ file, fileNumber, failureNumber, output }) =>
            writeFile(
              join(
                failuresDirectory,
                `${fileNumber}-${basename(file)}.${failureNumber}.log`,
              ),
              output,
              { flag: 'wx' },
            )
        : undefined,
    })
  } catch (error) {
    // Every live run was ended before the error got here.
    process.stderr.write(
      `The stress run stopped: ${error instanceof Error ? error.message : String(error)}\n`,
    )
    process.exitCode = 1
    return
  }
  process.stdout.write(`${renderStress(result).join('\n')}\n`)
  process.exitCode = result.failedRuns === 0 ? 0 : 1
}

if (isRunAsScript(import.meta.url)) await main()
