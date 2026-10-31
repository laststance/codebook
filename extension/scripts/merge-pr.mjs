#!/usr/bin/env node
// Merges one pull request the way AGENTS.md's Delivery section asks (Cycle 0068, Implementation 3): only a PR whose exact
// head has a passing exact-HEAD gate summary and passing CI, merged with `--match-head-commit`, then the local `main`
// fast-forwarded to `origin/main`. Every `gh` and `git` call goes through one injected command runner.

import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { GATE_CHECKS } from './gate.mjs'
import {
  CommandRefusal,
  EXIT,
  redactSecrets,
  runCommandLine,
} from './utils/commandContract.mjs'
import { isRunAsScript } from './utils/isRunAsScript.mjs'

/** The repository whose pull requests this command merges. */
const REPOSITORY_SLUG = 'laststance/codebook'

/** The only base branch a PR may merge into. */
const BASE_BRANCH = 'main'

/** Output limit of one `gh`/`git` call (bytes): a paginated check-run list is large. */
const COMMAND_OUTPUT_LIMIT_BYTES = 64 * 1024 * 1024

/** Conclusions that count as a pass for a workflow run, a check run or a commit status. */
const PASSING_CONCLUSIONS = ['success', 'neutral', 'skipped']

/** The one check name that never gates a merge (AGENTS.md: hosted CodeRabbit is off, D16). */
const NON_GATING_CHECK_NAME = 'CodeRabbit'

/** The command that makes the gate summary this command reads. */
const GATE_COMMAND = 'pnpm --dir extension gate'

/** The repository root, found from this script's own path (`extension/scripts/merge-pr.mjs`). */
const SCRIPT_REPOSITORY_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
)

/** Text printed by `--help`: usage, prerequisites, one example, exit codes and error codes. */
export const HELP_TEXT = `Usage: node extension/scripts/merge-pr.mjs <pr> [--dry-run]

Merges pull request <pr> with "gh pr merge <pr> --squash --match-head-commit <head>" only when
  - the PR is open, not a draft, and targets main;
  - artifacts/gate/<first 8 of head>/summary.txt (this checkout) holds "Checkout: clean",
    "GATE: pass on <head>" and one "<name> exit=0" line per gate check;
  - every workflow run, check run and commit status of that head passed (a check named CodeRabbit is listed, never gating).
Then it fast-forwards the local main to origin/main.
A PR that is already merged resumes at the local main step, so rerunning after exit 3 or 4 is safe.

Prerequisites: the pinned Node, gh signed in as the repository's account (GH_TOKEN is used as given, accounts are never switched), git, and the exact-HEAD gate run in this checkout on the PR head.

Options:
  --dry-run   check everything, print "would merge <pr> at <head>", change nothing
  --help      print this text

Example:
  node extension/scripts/merge-pr.mjs 173

Exit codes:
  0   merged (or already merged) and local main equals origin/main
  1   refused before any merge call
  2   gh pr merge failed and the PR is still open
  3   merged, but local main does not equal origin/main (the last line names the command)
  4   merge outcome unknown: check "gh pr view <pr> --json state,headRefOid,mergeCommit" before retrying
  64  usage error

Error codes:
  E_USAGE E_GH E_PR_STATE E_GATE_MISSING E_GATE_SUMMARY_OLD E_GATE_NOT_PASSED
  E_CHECKS_PENDING E_CHECKS_FAILED E_CHECKS_NONE
  E_MERGE_FAILED E_MERGE_UNKNOWN E_MERGED_OTHER_HEAD E_LOCAL_MAIN E_INTERNAL`

/**
 * @typedef {{ status: number, stdout: string, stderr: string }} CommandResult
 * @typedef {(command: string, args: string[]) => Promise<CommandResult>} CommandRunner
 */

/**
 * Builds the production command runner: runs `gh` or `git` with an argument array (no shell) in the repository, never rejecting.
 *
 * Why: every external call of {@link runMergePr} goes through one seam so tests run with no network and no real refs.
 * Called by {@link main} when no runner is injected.
 *
 * @param {string} cwd - The directory the commands run in (the repository root).
 * @param {NodeJS.ProcessEnv} environment - The caller's environment, passed through unchanged (`GH_TOKEN` as given).
 * @returns {CommandRunner} A runner resolving to `{ status, stdout, stderr }`; a missing program is status 127.
 * @example
 * const run = createCommandRunner('/work/codebook', process.env)
 * await run('git', ['rev-parse', 'main']) // => { status: 0, stdout: '…\n', stderr: '' }
 */
export function createCommandRunner(cwd, environment) {
  return (command, args) =>
    new Promise((resolveResult) => {
      execFile(
        command,
        args,
        { cwd, env: environment, maxBuffer: COMMAND_OUTPUT_LIMIT_BYTES },
        (error, stdout, stderr) => {
          if (error === null) {
            resolveResult({ status: 0, stdout, stderr })
            return
          }
          // A numeric code is the program's exit status; anything else (ENOENT, killed) is a failure to run.
          const status = typeof error.code === 'number' ? error.code : 127
          resolveResult({
            status,
            stdout: stdout ?? '',
            stderr: stderr || error.message,
          })
        },
      )
    })
}

/**
 * The first non-empty line of a child's stderr, with secrets redacted.
 * @param {string} stderr - Raw stderr of a child.
 * @param {NodeJS.ProcessEnv} environment - Secret values to hide.
 * @returns {string} One redacted line (`no output` when empty).
 * @example firstStderrLine('\nHTTP 401\nmore', {}) // => 'HTTP 401'
 */
function firstStderrLine(stderr, environment) {
  const line = stderr.split('\n').find((text) => text.trim() !== '')
  return redactSecrets(line?.trim() ?? 'no output', environment)
}

/**
 * Runs a `gh` call of the read-only steps 1 to 3 and returns its stdout; any failure is `E_GH` (exit 1, nothing changed).
 * @param {CommandRunner} run - The command runner.
 * @param {string[]} args - Arguments after `gh`.
 * @param {NodeJS.ProcessEnv} environment - Secret values to hide.
 * @returns {Promise<string>} The stdout.
 * @throws {CommandRefusal} `E_GH` when `gh` exits nonzero.
 * @example await runGhOrRefuse(run, ['pr', 'view', '173', '--json', 'state'], {})
 */
async function runGhOrRefuse(run, args, environment) {
  const result = await run('gh', args)
  if (result.status !== 0) {
    throw new CommandRefusal(
      'E_GH',
      `gh ${args.slice(0, 2).join(' ')} failed: ${firstStderrLine(result.stderr, environment)}`,
      { fix: 'gh auth status' },
    )
  }
  return result.stdout
}

/**
 * Parses JSON from `gh`, naming the call in the refusal when it is not JSON.
 * @param {string} text - Raw stdout.
 * @param {string} what - Short name of the call, for the refusal.
 * @returns {any} The parsed value.
 * @throws {CommandRefusal} `E_GH` when the text is not JSON.
 * @example parseGhJson('{"a":1}', 'gh pr view') // => { a: 1 }
 */
function parseGhJson(text, what) {
  try {
    return JSON.parse(text)
  } catch {
    throw new CommandRefusal('E_GH', `${what} printed no JSON`, {
      fix: 'gh auth status',
    })
  }
}

/**
 * Reads the PR (step 1): refuses a draft, a base other than `main` and a closed PR.
 *
 * Why: the head read here is the one the gate summary, the CI and the merge call are all bound to.
 * Called by {@link runMergePr}.
 *
 * @param {CommandRunner} run - The command runner.
 * @param {string} pr - PR number (digits).
 * @param {NodeJS.ProcessEnv} environment - Secret values to hide.
 * @returns {Promise<{ head: string, merged: boolean, mergeCommit: string | undefined }>} The head `headRefOid`, whether the PR is already merged and its merge commit when known.
 * @throws {CommandRefusal} `E_PR_STATE` for a closed or draft PR or another base; `E_GH` when `gh` fails.
 * @example await readPr(run, '173', {}) // => { head: '9f2c…', merged: false, mergeCommit: undefined }
 */
export async function readPr(run, pr, environment) {
  const stdout = await runGhOrRefuse(
    run,
    [
      'pr',
      'view',
      pr,
      '--json',
      'headRefOid,state,isDraft,baseRefName,mergeCommit',
    ],
    environment,
  )
  const view = parseGhJson(stdout, 'gh pr view')
  const refuseState = (sentence) =>
    new CommandRefusal('E_PR_STATE', `PR ${pr} ${sentence}`, {
      fix: `gh pr view ${pr}`,
    })
  if (view.baseRefName !== BASE_BRANCH)
    throw refuseState(`targets ${String(view.baseRefName)}, not ${BASE_BRANCH}`)
  if (view.state === 'MERGED')
    return {
      head: view.headRefOid,
      merged: true,
      mergeCommit: view.mergeCommit?.oid ?? undefined,
    }
  if (view.state !== 'OPEN')
    throw refuseState(`is ${String(view.state)}, not open`)
  if (view.isDraft === true) throw refuseState('is a draft')
  return { head: view.headRefOid, merged: false, mergeCommit: undefined }
}

/**
 * Requires the exact-HEAD gate's summary for this head (step 2): a clean checkout, `GATE: pass on <head>` and one `<name> exit=0` line per {@link GATE_CHECKS} entry.
 *
 * Why: nothing else checks that the gate passed on the commit about to be merged; an `--allow-dirty` trial run writes the same folder, hence the `Checkout:` line.
 * Called by {@link runMergePr} with the repository root of this script.
 *
 * @param {string} head - The full head sha from {@link readPr}.
 * @param {string} repositoryRoot - Repository root holding `artifacts/gate/`.
 * @param {(path: string) => Promise<string>} readText - Reads a UTF-8 file (injected).
 * @returns {Promise<void>} Resolves when the summary qualifies.
 * @throws {CommandRefusal} `E_GATE_MISSING`, `E_GATE_SUMMARY_OLD` (no `Checkout:` line) or `E_GATE_NOT_PASSED`; each ends with the gate command as its fix.
 * @example await checkGateSummary('9f2c…', '/work/codebook', readText)
 */
export async function checkGateSummary(head, repositoryRoot, readText) {
  const summaryPath = join(
    repositoryRoot,
    'artifacts',
    'gate',
    head.slice(0, 8),
    'summary.txt',
  )
  let text
  try {
    text = await readText(summaryPath)
  } catch {
    throw new CommandRefusal(
      'E_GATE_MISSING',
      `no gate summary at ${summaryPath}`,
      { fix: GATE_COMMAND },
    )
  }
  const lines = text.split(/\r?\n/)
  const foundLines = lines.filter(
    (line) => line.startsWith('Checkout:') || line.startsWith('GATE:'),
  )
  // A summary written by a gate older than this cycle has no Checkout line at all.
  if (!lines.some((line) => line.startsWith('Checkout:')))
    throw new CommandRefusal(
      'E_GATE_SUMMARY_OLD',
      `${summaryPath} has no "Checkout:" line (written by an older gate)`,
      {
        fix: GATE_COMMAND,
        details: foundLines.map((line) => `found: ${line}`),
      },
    )
  const problems = []
  if (!lines.includes('Checkout: clean'))
    problems.push('the line "Checkout: clean" is missing')
  if (!lines.includes(`GATE: pass on ${head}`))
    problems.push(`the line "GATE: pass on ${head}" is missing`)
  for (const check of GATE_CHECKS) {
    // The gate prints `<name> exit=<code> seconds=<n>`; only exit=0 passes.
    if (!lines.some((line) => line.startsWith(`${check.name} exit=0 `)))
      problems.push(`no passing line for check ${check.name}`)
  }
  if (problems.length > 0)
    throw new CommandRefusal(
      'E_GATE_NOT_PASSED',
      `${summaryPath} does not prove a passing gate on ${head}`,
      {
        fix: GATE_COMMAND,
        details: [...problems, ...foundLines.map((line) => `found: ${line}`)],
      },
    )
}

/**
 * Reads every page of a paginated `gh api` call (`--paginate --slurp`) and returns the pages as an array.
 * @param {CommandRunner} run - The command runner.
 * @param {string} endpoint - API path, with its query when it has one.
 * @param {NodeJS.ProcessEnv} environment - Secret values to hide.
 * @returns {Promise<any[]>} The page objects (a lone object is wrapped).
 * @throws {CommandRefusal} `E_GH` when `gh` fails or prints no JSON.
 * @example await readPages(run, 'repos/laststance/codebook/commits/9f2c/status', {})
 */
async function readPages(run, endpoint, environment) {
  const stdout = await runGhOrRefuse(
    run,
    ['api', endpoint, '--paginate', '--slurp'],
    environment,
  )
  const pages = parseGhJson(stdout, `gh api ${endpoint}`)
  return Array.isArray(pages) ? pages : [pages]
}

/**
 * Sorts a finished-or-not unit of CI into `pass`, `pending` or `fail`.
 * @param {string} status - `completed`, `queued`, `in_progress`, …
 * @param {string | null | undefined} conclusion - `success`, `failure`, … or empty while running.
 * @returns {'pass' | 'pending' | 'fail'} The class: only a completed unit can pass or fail.
 * @example classifyRun('completed', 'skipped') // => 'pass'
 */
function classifyRun(status, conclusion) {
  if (status !== 'completed') return 'pending'
  return PASSING_CONCLUSIONS.includes(conclusion) ? 'pass' : 'fail'
}

/**
 * Requires the CI of the step-1 head to have passed (step 3), read from its workflow runs, check runs and commit statuses.
 *
 * Why: the repository has no branch protection, so "required CI" means every check the head triggered; a workflow that is still starting has a run before it has check runs, so all three sources are read, for the head of step 1 and not whatever the PR points at later.
 * Called by {@link runMergePr}.
 *
 * @param {CommandRunner} run - The command runner.
 * @param {string} head - The full head sha.
 * @param {string} pr - PR number, named in the fix lines.
 * @param {NodeJS.ProcessEnv} environment - Secret values to hide.
 * @param {(line: string) => void} print - Where the non-gating CodeRabbit lines go.
 * @returns {Promise<string>} A one-line summary of what passed.
 * @throws {CommandRefusal} `E_CHECKS_FAILED`, `E_CHECKS_PENDING` or `E_CHECKS_NONE` (no workflow run, no check run, or only `CodeRabbit`); `E_GH` when `gh` fails.
 * @example await checkChecks(run, '9f2c…', '173', {}, console.log)
 */
export async function checkChecks(run, head, pr, environment, print) {
  const base = `repos/${REPOSITORY_SLUG}`
  const workflowPages = await readPages(
    run,
    `${base}/actions/runs?head_sha=${head}`,
    environment,
  )
  const checkRunPages = await readPages(
    run,
    `${base}/commits/${head}/check-runs`,
    environment,
  )
  const statusPages = await readPages(
    run,
    `${base}/commits/${head}/status`,
    environment,
  )
  const workflowRuns = workflowPages.flatMap((page) => page.workflow_runs ?? [])
  const checkRuns = checkRunPages.flatMap((page) => page.check_runs ?? [])
  // An empty statuses list is ignored: the combined state reads pending when no status exists.
  const statuses = statusPages.flatMap((page) => page.statuses ?? [])

  /** @type {{ label: string, verdict: 'pass' | 'pending' | 'fail' }[]} */
  const units = []
  for (const workflowRun of workflowRuns)
    units.push({
      label: `workflow ${workflowRun.name}: ${workflowRun.status}/${workflowRun.conclusion ?? 'none'}`,
      verdict: classifyRun(workflowRun.status, workflowRun.conclusion),
    })
  const gatingCheckRuns = []
  for (const checkRun of checkRuns) {
    const label = `check ${checkRun.name}: ${checkRun.status}/${checkRun.conclusion ?? 'none'}`
    if (checkRun.name === NON_GATING_CHECK_NAME) {
      print(`not gating: ${label}`)
      continue
    }
    gatingCheckRuns.push(checkRun)
    units.push({
      label,
      verdict: classifyRun(checkRun.status, checkRun.conclusion),
    })
  }
  for (const status of statuses) {
    const label = `status ${status.context}: ${status.state}`
    if (status.context === NON_GATING_CHECK_NAME) {
      print(`not gating: ${label}`)
      continue
    }
    units.push({
      label,
      verdict:
        status.state === 'success'
          ? 'pass'
          : status.state === 'pending'
            ? 'pending'
            : 'fail',
    })
  }

  const failed = units.filter((unit) => unit.verdict === 'fail')
  const pending = units.filter((unit) => unit.verdict === 'pending')
  if (failed.length > 0)
    throw new CommandRefusal(
      'E_CHECKS_FAILED',
      `${failed.length} check(s) of ${head} failed`,
      {
        fix: `node extension/scripts/ci-failures.mjs ${pr}`,
        details: failed.map((unit) => unit.label),
      },
    )
  if (pending.length > 0)
    throw new CommandRefusal(
      'E_CHECKS_PENDING',
      `${pending.length} check(s) of ${head} are still running`,
      {
        fix: `gh pr checks ${pr} --watch, then rerun this command`,
        details: pending.map((unit) => unit.label),
      },
    )
  if (workflowRuns.length === 0 || gatingCheckRuns.length === 0)
    throw new CommandRefusal(
      'E_CHECKS_NONE',
      workflowRuns.length === 0
        ? `no workflow run exists for ${head}`
        : `no check run other than ${NON_GATING_CHECK_NAME} exists for ${head}`,
      { fix: `gh pr checks ${pr} --watch, then rerun this command` },
    )
  return `checks pass at ${head} (${workflowRuns.length} workflow runs, ${gatingCheckRuns.length} check runs, ${statuses.length} statuses)`
}

/**
 * Reads state and head of the PR after the merge call.
 * @param {CommandRunner} run - The command runner.
 * @param {string} pr - PR number.
 * @returns {Promise<{ state: string, headRefOid: string } | undefined>} The answer, or `undefined` when `gh` failed or printed no JSON.
 * @example await rereadPr(run, '173') // => { state: 'MERGED', headRefOid: '9f2c…' }
 */
async function rereadPr(run, pr) {
  const result = await run('gh', [
    'pr',
    'view',
    pr,
    '--json',
    'state,headRefOid',
  ])
  if (result.status !== 0) return undefined
  try {
    return JSON.parse(result.stdout)
  } catch {
    return undefined
  }
}

/**
 * Merges the PR (step 4) with `--match-head-commit` and confirms it is `MERGED` at the step-1 head, after a failed call as well as after an exit 0.
 *
 * Why: a failed `gh pr merge` can still have merged (a lost response), and a moved head must never be reported as this script's merge.
 * Called by {@link runMergePr} after the gate summary and the CI qualify.
 *
 * @param {CommandRunner} run - The command runner.
 * @param {string} pr - PR number.
 * @param {string} head - The step-1 head.
 * @param {NodeJS.ProcessEnv} environment - Secret values to hide.
 * @returns {Promise<void>} Resolves when the PR reads `MERGED` at `head`.
 * @throws {CommandRefusal} `E_MERGE_FAILED` (exit 2, still open), `E_MERGE_UNKNOWN` (exit 4, the re-check failed or an exit 0 did not read merged) or `E_MERGED_OTHER_HEAD` (exit 4).
 * @example await mergeAndConfirm(run, '173', '9f2c…', {})
 */
export async function mergeAndConfirm(run, pr, head, environment) {
  const merge = await run('gh', [
    'pr',
    'merge',
    pr,
    '--squash',
    '--match-head-commit',
    head,
  ])
  const after = await rereadPr(run, pr)
  const auditFix = `gh pr view ${pr} --json state,headRefOid,mergeCommit`
  if (after === undefined)
    throw new CommandRefusal(
      'E_MERGE_UNKNOWN',
      `could not read PR ${pr} after the merge call (exit ${merge.status})`,
      {
        fix: `gh pr view ${pr} --json state,mergeCommit, then rerun merge-pr`,
        exitCode: EXIT.UNKNOWN,
      },
    )
  if (after.state === 'MERGED' && after.headRefOid !== head)
    throw new CommandRefusal(
      'E_MERGED_OTHER_HEAD',
      `PR ${pr} is MERGED at ${after.headRefOid}, not at ${head}`,
      { fix: `audit ${auditFix}`, exitCode: EXIT.UNKNOWN },
    )
  if (after.state === 'MERGED') return
  if (merge.status !== 0)
    throw new CommandRefusal(
      'E_MERGE_FAILED',
      `gh pr merge failed and PR ${pr} is still ${after.state}: ${firstStderrLine(merge.stderr, environment)}`,
      { fix: `gh pr view ${pr}`, exitCode: EXIT.FAILED },
    )
  // Exit 0 but not merged: the repository uses no merge queue, so this is unexplained.
  throw new CommandRefusal(
    'E_MERGE_UNKNOWN',
    `gh pr merge exited 0 but PR ${pr} reads ${after.state}`,
    { fix: `audit ${auditFix}`, exitCode: EXIT.UNKNOWN },
  )
}

/**
 * Brings the local `main` to `origin/main` (step 6) and verifies they are equal.
 *
 * Why: the local `main` never moved before, so later diffs against it listed months of files; the merge is complete either way, so a failure here is exit 3 with the command to run.
 * Called by {@link runMergePr} after the merge is confirmed (or found already done).
 *
 * @param {CommandRunner} run - The command runner.
 * @param {NodeJS.ProcessEnv} environment - Secret values to hide.
 * @returns {Promise<string>} The sha both `main` and `origin/main` are at.
 * @throws {CommandRefusal} `E_LOCAL_MAIN` (exit 3) when Git refuses or the two refs differ afterwards.
 * @example await syncLocalMain(run, {}) // => '4b1c…'
 */
export async function syncLocalMain(run, environment) {
  const branch = (await run('git', ['branch', '--show-current'])).stdout.trim()
  // On main a fetch into main is refused by Git, so pull; elsewhere fetch updates main without checking it out.
  const updateArgs =
    branch === BASE_BRANCH
      ? ['pull', '--ff-only', 'origin', BASE_BRANCH]
      : ['fetch', 'origin', `${BASE_BRANCH}:${BASE_BRANCH}`]
  const command = `git ${updateArgs.join(' ')}`
  const refuse = (reason, details) =>
    new CommandRefusal('E_LOCAL_MAIN', reason, {
      fix: command,
      exitCode: EXIT.FOLLOW_UP,
      details: [
        ...details,
        'local main not updated; fix the cause, then run the command above',
      ],
    })
  const update = await run('git', updateArgs)
  if (update.status !== 0)
    throw refuse(`${command} failed`, [
      redactSecrets(update.stderr.trim(), environment),
    ])
  const fetch = await run('git', ['fetch', 'origin', BASE_BRANCH])
  if (fetch.status !== 0)
    throw refuse('git fetch origin main failed', [
      redactSecrets(fetch.stderr.trim(), environment),
    ])
  const local = (await run('git', ['rev-parse', BASE_BRANCH])).stdout.trim()
  const remote = (
    await run('git', ['rev-parse', `origin/${BASE_BRANCH}`])
  ).stdout.trim()
  if (local === '' || local !== remote)
    throw refuse(
      `local main (${local}) differs from origin/main (${remote})`,
      [],
    )
  return local
}

/**
 * Merges one PR end to end: the seven steps of Implementation 3.
 *
 * Why: this is the whole command, separated from argument parsing so tests drive it with an injected runner and summary reader.
 * Called by {@link main}.
 *
 * @param {{ pr: string, dryRun: boolean }} options - The PR number (digits) and whether to stop before the merge.
 * @param {{
 *   run: CommandRunner,
 *   readText: (path: string) => Promise<string>,
 *   repositoryRoot: string,
 *   print: (line: string) => void,
 *   environment: NodeJS.ProcessEnv,
 *   progress: import('./utils/commandContract.mjs').CommandProgress,
 * }} dependencies - The seams: command runner, file reader, repository root, stdout writer, environment, stage tracker.
 * @returns {Promise<number>} The exit code (0 on success).
 * @throws {CommandRefusal} Any refusal listed in `--help`.
 * @example await runMergePr({ pr: '173', dryRun: false }, dependencies) // => 0
 */
export async function runMergePr({ pr, dryRun }, dependencies) {
  const { run, readText, repositoryRoot, print, environment, progress } =
    dependencies
  progress.enter('read the PR')
  const prState = await readPr(run, pr, environment)
  progress.enter('check the gate summary')
  await checkGateSummary(prState.head, repositoryRoot, readText)
  let mergeCommit = prState.mergeCommit
  if (prState.merged) {
    // A rerun after exit 3 or 4: the merge is done, resume at the local sync.
    print(`already merged at ${mergeCommit ?? 'an unknown commit'}`)
  } else {
    progress.enter('check CI')
    print(await checkChecks(run, prState.head, pr, environment, print))
  }
  if (dryRun) {
    if (!prState.merged) print(`would merge ${pr} at ${prState.head}`)
    return EXIT.DONE
  }
  if (!prState.merged) {
    progress.enter('merge', { sideEffect: true })
    await mergeAndConfirm(run, pr, prState.head, environment)
    progress.enter('read the merge commit')
    const result = await run('gh', [
      'pr',
      'view',
      pr,
      '--json',
      'mergeCommit',
      '-q',
      '.mergeCommit.oid',
    ])
    if (result.status === 0 && result.stdout.trim() !== '')
      mergeCommit = result.stdout.trim()
    else
      print(
        `merged; merge commit unknown (${firstStderrLine(result.stderr, environment)})`,
      )
  }
  progress.enter('sync the local main', { sideEffect: true })
  const localMain = await syncLocalMain(run, environment)
  print(`merge commit ${mergeCommit ?? 'unknown'}`)
  print(`local main ${localMain}`)
  return EXIT.DONE
}

/**
 * The command's entry: parses arguments, prints `--help`, and runs {@link runMergePr}.
 *
 * Why: it is what `node extension/scripts/merge-pr.mjs` calls through {@link runCommandLine}; tests call it with their own argv and seams.
 *
 * @param {import('./utils/commandContract.mjs').CommandProgress} progress - Stage tracker from {@link runCommandLine}.
 * @param {string[]} [argv] - Arguments after the script name.
 * @param {Partial<{ run: CommandRunner, readText: (path: string) => Promise<string>, repositoryRoot: string, print: (line: string) => void, environment: NodeJS.ProcessEnv }>} [overrides] - Seams for tests.
 * @returns {Promise<number>} The exit code.
 * @throws {CommandRefusal} `E_USAGE` (exit 64) for a missing or non-digit PR number or an unknown option.
 * @example await main(new CommandProgress(), ['173', '--dry-run'], { run, readText })
 */
export async function main(
  progress,
  argv = process.argv.slice(2),
  overrides = {},
) {
  const environment = overrides.environment ?? process.env
  const print = overrides.print ?? ((line) => console.log(line))
  const usageFix = 'node extension/scripts/merge-pr.mjs --help'
  let parsed
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        'dry-run': { type: 'boolean' },
        help: { type: 'boolean' },
      },
    })
  } catch (error) {
    throw new CommandRefusal('E_USAGE', error.message, {
      fix: usageFix,
      exitCode: EXIT.USAGE,
    })
  }
  if (parsed.values.help === true) {
    print(HELP_TEXT)
    return EXIT.DONE
  }
  const [pr, ...extra] = parsed.positionals
  // Digits only: the number is placed in gh arguments and fix lines.
  if (pr === undefined || extra.length > 0 || !/^\d+$/.test(pr))
    throw new CommandRefusal(
      'E_USAGE',
      'expected exactly one PR number made of digits',
      { fix: usageFix, exitCode: EXIT.USAGE },
    )
  const repositoryRoot = overrides.repositoryRoot ?? SCRIPT_REPOSITORY_ROOT
  return runMergePr(
    { pr, dryRun: parsed.values['dry-run'] === true },
    {
      run: overrides.run ?? createCommandRunner(repositoryRoot, environment),
      readText: overrides.readText ?? ((path) => readFile(path, 'utf8')),
      repositoryRoot,
      print,
      environment,
      progress,
    },
  )
}

if (isRunAsScript(import.meta.url))
  process.exitCode = await runCommandLine(main)
