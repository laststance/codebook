// Prints the failing tests of a pull request's or a workflow run's failed CI jobs, also while the run is still going.
//
//   node extension/scripts/ci-failures.mjs <pull request number>
//   node extension/scripts/ci-failures.mjs --run <run id>
//
// For each failed job: its name and URL, then each failing test of the runner's "failing tests" block with the first
// error line under it; a failed job without that block prints its last lines instead. Needs an authenticated `gh`
// (`GH_TOKEN` is passed through). Exit 0 after printing (also when nothing failed), 2 on a bad argument or a `gh` failure.
import { execFileSync } from 'node:child_process'
import { parseArgs } from 'node:util'

import { isRunAsScript } from './utils/isRunAsScript.mjs'

/** A GitHub Actions log line's timestamp prefix, as `gh api …/logs` writes it. */
const TIMESTAMP_PREFIX = /^\d{4}-\d\d-\d\dT[\d:.]+Z /
/** A terminal colour sequence, which the logs keep. */
const COLOUR_SEQUENCE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')
/** How many of a failed job's last lines it prints when the log has no "failing tests" block. */
const TAIL_LINES = 15

/**
 * Reads the failing tests out of one CI job's log: every `✖ <name>` of each `✖ failing tests:` block Node's spec
 * reporter ends a failed run with, with the first error line under it.
 * Why: a sharded job prints thousands of lines, and `gh run view --log-failed` prints nothing while the run is in
 * progress; the names and their first error line are what a fix starts from. Called by {@link main} for each failed job.
 * @param log - The job's log as `gh api …/actions/jobs/<id>/logs` answers it (timestamps and colours included).
 * @returns `{ name, error }` per failing test, in log order, each name once; `error` is `undefined` when no error line follows.
 * @example
 * failedTestsOf('2026-10-28T00:00:00Z ✖ failing tests:\n2026-10-28T00:00:00Z ✖ adds (1.2ms)\n2026-10-28T00:00:00Z   AssertionError [ERR_ASSERTION]: 1 !== 2')
 * // => [{ name: 'adds', error: 'AssertionError [ERR_ASSERTION]: 1 !== 2' }]
 */
export function failedTestsOf(log) {
  const lines = log
    .split('\n')
    .map((line) =>
      line.replace(TIMESTAMP_PREFIX, '').replace(COLOUR_SEQUENCE, ''),
    )
  const failures = new Map()
  let inBlock = false
  let current
  for (const line of lines) {
    if (line.startsWith('✖ failing tests:')) {
      inBlock = true
      current = undefined
      continue
    }
    // The block ends at the next summary or reporter line.
    if (!inBlock || line.startsWith('ℹ ')) {
      inBlock = false
      continue
    }
    if (line.startsWith('✖ ')) {
      const name = line.slice(2).replace(/ \([\d.]+m?s\)$/, '')
      current = failures.get(name) ?? { name, error: undefined }
      failures.set(name, current)
      continue
    }
    // The first line naming an error under a test is its error line.
    if (current && current.error === undefined && /Error\b/.test(line))
      current.error = line.trim()
  }
  return [...failures.values()]
}

/** Runs `gh` and answers its stdout. @example gh(['api', 'user']) // => '{"login":…}' */
function gh(args) {
  return execFileSync('gh', args, {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  })
}

/** Lists the workflow runs of a pull request's head commit. @example runsOfPullRequest(144) // => [7101, 7102] */
function runsOfPullRequest(number) {
  const head = gh([
    'pr',
    'view',
    String(number),
    '--json',
    'headRefOid',
    '-q',
    '.headRefOid',
  ]).trim()
  return JSON.parse(
    gh(['run', 'list', '--commit', head, '--json', 'databaseId']),
  ).map((run) => run.databaseId)
}

/**
 * The command line: finds the failed jobs of the runs named, and prints each job's failing tests.
 * @returns The exit code.
 * @example main() // => 0
 */
function main() {
  let parsed
  try {
    parsed = parseArgs({
      options: { run: { type: 'string' } },
      allowPositionals: true,
    })
  } catch (error) {
    console.error(error.message)
    return 2
  }
  const [pullRequest] = parsed.positionals
  if ((pullRequest === undefined) === (parsed.values.run === undefined)) {
    console.error('Name one pull request number, or one run with --run <id>.')
    return 2
  }
  try {
    const repository = gh([
      'repo',
      'view',
      '--json',
      'nameWithOwner',
      '-q',
      '.nameWithOwner',
    ]).trim()
    const runs =
      parsed.values.run === undefined
        ? runsOfPullRequest(pullRequest)
        : [parsed.values.run]
    let failedJobs = 0
    for (const run of runs) {
      const { jobs } = JSON.parse(
        gh(['run', 'view', String(run), '--json', 'jobs']),
      )
      for (const job of jobs.filter((each) => each.conclusion === 'failure')) {
        failedJobs += 1
        console.log(`\n## ${job.name}\n${job.url}`)
        // The logs keep the runners' colours, which `gh api` prints only when asked to; they are stripped before reading.
        const log = gh([
          'api',
          '--allow-escape-sequences',
          `repos/${repository}/actions/jobs/${job.databaseId}/logs`,
        ])
        const failures = failedTestsOf(log)
        // A job that failed outside the test runner (a refused health run, a build) shows its last lines.
        if (failures.length === 0)
          for (const line of log.split('\n').slice(-TAIL_LINES))
            console.log(
              line.replace(TIMESTAMP_PREFIX, '').replace(COLOUR_SEQUENCE, ''),
            )
        for (const failure of failures)
          console.log(
            `✖ ${failure.name}${failure.error ? `\n    ${failure.error}` : ''}`,
          )
      }
    }
    if (failedJobs === 0) console.log('No failed job.')
    return 0
  } catch (error) {
    console.error(`gh failed: ${error.message}`)
    return 2
  }
}

if (isRunAsScript(import.meta.url)) process.exitCode = main()
