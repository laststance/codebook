// Runs compiled test files many times at once, to find tests that fail only under load (Issue #386, task 3).
//
//   node extension/scripts/stress-tests.mjs [--runs 4] [--concurrency 24] [--name <pattern>] <test-file>...
//
// A fixer or the driving agent runs it after `pnpm --dir extension build` on the files it suspects. Every file is run
// --runs times, with at most --concurrency `node --test` processes alive at once, so the tests meet the processor
// contention of the gate's measured-health run. --name passes a `--test-name-pattern` to every run.
//
// It prints one line per file (`<file>: <runs> runs, <failed> failed`), under it one line per test that failed
// (`  ✖ <test name>: <n> of <runs>`), and last `STRESS: files=<n> runs=<n> failed_runs=<n>`. A run that fails without
// naming a test (a crash, a time limit) is counted under `(no test named)`.
//
// It is a development tool: CI, `/gstack-ship` and the gate never run it, and its result is no suite verdict.
//
// Exit 0: every run passed. Exit 1: at least one run failed. Exit 2: a bad option or no test file, named on stderr.
import { spawn } from 'node:child_process'
import { parseArgs } from 'node:util'

import { isRunAsScript } from './utils/isRunAsScript.mjs'
import { plainOutputEnvironment } from './utils/plainOutputEnvironment.mjs'

/** How often each file runs when `--runs` is not given. */
const DEFAULT_RUNS = 4
/** How many `node --test` processes run at once when `--concurrency` is not given: above the 16 cores, like the load of the measured-health run. */
const DEFAULT_CONCURRENCY = 24
/** The name a failed run is counted under when its output names no failed test. */
export const NO_TEST_NAMED = '(no test named)'

/**
 * Reads the names of the failed tests from the output of one `node --test --test-reporter=spec` run.
 *
 * Why: the stress report counts failures per test, and the spec reporter lists every failed test once more under its `✖ failing tests:` heading. Called by {@link stressTests} for each failed run.
 *
 * @param output - The run's standard output.
 * @returns The failed tests' names in the order of the list, without the duration; empty when the output has no such list.
 *
 * @example
 * ```js
 * failedTestNames('✖ failing tests:\n\ntest at a.js:1:1\n✖ saves the study (12.5ms)\n') // => ['saves the study']
 * ```
 */
export function failedTestNames(output) {
  const heading = output.lastIndexOf('✖ failing tests:')
  if (heading === -1) return []
  const names = []
  // Only the lines after the heading count: the same test is also printed where it ran.
  for (const line of output.slice(heading).split('\n').slice(1)) {
    const match = /^✖ (.+?)(?: \(\d[\d.]*ms\))?$/.exec(line)
    if (match) names.push(match[1])
  }
  return names
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

/** Runs one test file once and resolves with its exit code and standard output; a run that cannot start counts as failed. @example await runTestFile('dist/tests/a.test.js') // => { code: 0, output: '✔ …' } */
function runTestFile(file, namePattern) {
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
    let output = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      output += chunk
    })
    child.on('error', () => resolveRun({ code: 1, output }))
    child.on('close', (code) => resolveRun({ code: code ?? 1, output }))
  })
}

/**
 * Runs every file `runs` times under load and counts the failed runs per file and per test.
 *
 * Why: a test that fails once in thirty runs under load is found only by many runs at once. Called by this script's `main` and by its tests (with their own `run`).
 *
 * @param files - The compiled test files.
 * @param options - `runs` per file, `concurrency` of the pool, an optional `namePattern`, and `run` (how one file is run once; the real `node --test` unless a test replaces it).
 * @returns Per file its failed-run count and, per failed test name, how many runs failed it; plus the totals.
 *
 * @example
 * ```js
 * await stressTests(['a.test.js'], { runs: 4, concurrency: 24 })
 * // => { files: [{ file: 'a.test.js', runs: 4, failedRuns: 1, failures: { 'saves the study': 1 } }], runs: 4, failedRuns: 1 }
 * ```
 */
export async function stressTests(
  files,
  { runs, concurrency, namePattern, run = runTestFile },
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
    for (const result of results)
      jobs.push(async () => {
        const { code, output } = await run(result.file, namePattern)
        if (code === 0) return
        result.failedRuns++
        const names = failedTestNames(output)
        for (const name of names.length ? names : [NO_TEST_NAMED])
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

/** Reads a whole positive number from an option, or ends the script with exit 2. @example positiveOption('24', '--concurrency') // => 24 */
function positiveOption(value, name) {
  const number = Number(value)
  if (!Number.isInteger(number) || number < 1) {
    process.stderr.write(`${name} takes a whole number of at least 1.\n`)
    process.exit(2)
  }
  return number
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
        name: { type: 'string' },
      },
    })
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`)
    process.exit(2)
  }
  if (parsed.positionals.length === 0) {
    process.stderr.write(
      'Name at least one compiled test file, e.g. extension/dist/tests/learningSummary.test.js.\n',
    )
    process.exit(2)
  }
  const result = await stressTests(parsed.positionals, {
    runs: positiveOption(parsed.values.runs, '--runs'),
    concurrency: positiveOption(parsed.values.concurrency, '--concurrency'),
    namePattern: parsed.values.name,
  })
  process.stdout.write(`${renderStress(result).join('\n')}\n`)
  process.exitCode = result.failedRuns === 0 ? 0 : 1
}

if (isRunAsScript(import.meta.url)) await main()
