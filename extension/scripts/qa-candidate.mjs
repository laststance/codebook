// Builds a QA candidate VSIX from a clean commit and starts a background `codex review` of it (Cycle 0068, Implementation 2).
//
//   node extension/scripts/qa-candidate.mjs [--no-review]
//   node extension/scripts/qa-candidate.mjs --status [<short>]
//   node extension/scripts/qa-candidate.mjs --clean
//
// See HELP_TEXT (`--help`) for prerequisites, exit codes and error codes.
import { execFile, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs, promisify } from 'node:util'

import { buildPackage } from './utils/buildPackage.mjs'
import {
  CommandRefusal,
  EXIT,
  redactSecrets,
  runCommandLine,
} from './utils/commandContract.mjs'
import { isRunAsScript } from './utils/isRunAsScript.mjs'
import { listCheckoutChanges } from './utils/listCheckoutChanges.mjs'
import { packageGitOptions } from './utils/packageGitOptions.mjs'
import {
  CANDIDATE_ATTEMPT_PATTERN,
  CANDIDATE_REVIEW_LIMIT_MS,
  cleanReviewAttempt,
  reviewNames,
} from './utils/runCandidateReview.mjs'

const execFileAsync = promisify(execFile)

/** The repository this script belongs to (two folders above `extension/scripts`). */
const REPOSITORY = fileURLToPath(new URL('../../', import.meta.url))

/** `git fetch origin main` may take this long before the review counts as not started. */
const FETCH_TIMEOUT_MS = 30 * 1000

/** Other git calls (rev-parse, worktree add) may take this long. */
const GIT_TIMEOUT_MS = 60 * 1000

/** A log older than the review limit plus this margin cannot belong to a live review: the age bound keeps a recycled pid from passing for one. */
const RUNNING_AGE_MARGIN_MS = 5 * 60 * 1000

/** How many changed paths a dirty refusal names. */
const DIRTY_PATHS_SHOWN = 5

/** The `--help` text: usage, prerequisites, example, exit codes and error codes. */
export const HELP_TEXT = `Usage:
  node extension/scripts/qa-candidate.mjs [--no-review]
  node extension/scripts/qa-candidate.mjs --status [<short>]
  node extension/scripts/qa-candidate.mjs --clean

Builds artifacts/qa/codebook-<short>.vsix (<short> = first 8 hex characters of HEAD)
from a clean commit, writes the receipt artifacts/qa/codebook-<short>.json and starts
"codex review --base qa-base-<short>-<attempt>" in the background on a detached worktree
of that commit. The review log stays private under artifacts/qa/.

Options:
  --no-review      build and write the receipt only; the review is recorded as skipped
  --status [<s>]   print the receipt and the review state (running, exited <code> <time>,
                   timeout <time>, error <message> <time>, interrupted, not-started
                   <reason>, skipped) of candidate <s> (default: HEAD); builds nothing
  --clean          remove the worktree and branch of each review attempt whose log has an
                   exit line and whose runner and codex processes are gone; list the rest
  --help           print this text

Prerequisites: the pinned Node and pnpm on PATH; a checkout with no changes; no test, gate,
health or other package run using this checkout while the build runs; git with an "origin"
remote; "codex" on PATH for the review.

Example:
  node extension/scripts/qa-candidate.mjs

Exit codes: 0 done; 1 refused before any side effect; 2 failed before the receipt was
written; 3 candidate built but the review did not start (last line: "codex review NOT
STARTED: <reason>"); 4 outcome unknown, check before retrying; 64 usage.

Error codes: E_USAGE, E_DIRTY, E_BUILD, E_CANDIDATE_DIRTY, E_NO_CANDIDATE, E_INTERNAL.
`

/**
 * Reads a log's text into the facts a review's state is judged from.
 *
 * Why: a review is "running", "exited" or "interrupted" only by what its log says plus whether its runner is alive; `--status`, the next candidate run and `--clean` must judge it the same way.
 * Called by {@link judgeReview}.
 *
 * @param {string} text - The attempt's log (BOM and CRLF tolerated; may be empty).
 * @returns {{ runnerPid?: number, codexPid?: number, exit?: { kind: 'exited' | 'timeout' | 'error', text: string }, cleaned: boolean }} The pids and the exit line; `exit.text` is the state text without its leading word.
 * @example
 * parseReviewLog('CODEX_REVIEW_PID 12\nCODEX_REVIEW_EXIT 0 2026-11-01T10:00:00.000Z\n').exit // => { kind: 'exited', text: '0 2026-11-01T10:00:00.000Z' }
 */
export function parseReviewLog(text) {
  const facts = { cleaned: false }
  for (const line of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const pid = /^CODEX_REVIEW_PID (\d+)$/.exec(line)
    if (pid) facts.runnerPid = Number(pid[1])
    const child = /^CODEX_REVIEW_CHILD (\d+)$/.exec(line)
    if (child) facts.codexPid = Number(child[1])
    const exit = /^CODEX_REVIEW_EXIT (.+) (\S+)$/.exec(line)
    if (exit && facts.exit === undefined) {
      const [, body, time] = exit
      if (body === 'timeout') facts.exit = { kind: 'timeout', text: time }
      else if (body.startsWith('error '))
        facts.exit = { kind: 'error', text: `${body.slice(6)} ${time}` }
      else facts.exit = { kind: 'exited', text: `${body} ${time}` }
    }
    if (line === 'CODEX_REVIEW_CLEANED') facts.cleaned = true
  }
  return facts
}

/**
 * Judges one attempt's review state from its log, the log's age and a pid probe.
 *
 * Why: no lock file exists, so "a review is running" must come from a live pid, no exit line and a recently written log; an empty or PID-only log is judged the same way (the runner may not have written yet).
 * Called by the review start, `--status` and `--clean`.
 *
 * @param {{ text: string, mtimeMs: number, nowMs: number, isPidAlive: (pid: number) => boolean, fallbackPid?: number }} input - `fallbackPid` is the pid the receipt recorded, used while the log holds none.
 * @returns {{ state: 'running' | 'exited' | 'timeout' | 'error' | 'interrupted', text: string, facts: ReturnType<typeof parseReviewLog> }} `text` is the printed state (`running`, `exited 0 <time>`, `timeout <time>`, `error <message> <time>`, `interrupted`).
 * @example
 * judgeReview({ text: '', mtimeMs: 0, nowMs: 1000, isPidAlive: () => false }).state // => 'interrupted'
 */
export function judgeReview({ text, mtimeMs, nowMs, isPidAlive, fallbackPid }) {
  const facts = parseReviewLog(text)
  if (facts.exit)
    return {
      state: facts.exit.kind,
      text: `${facts.exit.kind} ${facts.exit.text}`,
      facts,
    }
  const pid = facts.runnerPid ?? fallbackPid
  const recent =
    nowMs - mtimeMs < CANDIDATE_REVIEW_LIMIT_MS + RUNNING_AGE_MARGIN_MS
  // A live pid with no exit line counts only while the log is fresh: an old log with a live pid is a recycled pid.
  if (pid !== undefined && recent && isPidAlive(pid))
    return { state: 'running', text: 'running', facts }
  return { state: 'interrupted', text: 'interrupted', facts }
}

/** Tells whether a process with this id exists (`EPERM` means it exists but is not ours). @example isPidAliveOnThisMachine(process.pid) // => true */
export function isPidAliveOnThisMachine(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

/** One-line message of a thrown value. @example oneLine(new Error('a\nb')) // => 'a b' */
function oneLine(error) {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/\s+/g, ' ').trim()
}

/** Formats a Date as `YYYYMMDDTHHMMSSZ` in UTC. @example compactUtc(new Date('2026-11-01T12:00:00Z')) // => '20261101T120000Z' */
function compactUtc(date) {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z')
}

/** The production seams: real build, git, file system, spawner, clock and pid probe. @example const seams = productionSeams(REPOSITORY) */
export function productionSeams(repository) {
  return {
    repository,
    print: (line) => console.log(line),
    printError: (line) => console.error(line),
    now: () => Date.now(),
    randomSuffix: () => randomBytes(3).toString('hex'),
    isPidAlive: isPidAliveOnThisMachine,
    listChanges: (root) => listCheckoutChanges(root),
    build: (root, output) => buildPackage(root, output),
    git: async (args, { timeoutMs = GIT_TIMEOUT_MS } = {}) => {
      try {
        const { stdout } = await execFileAsync('git', args, {
          ...packageGitOptions(repository),
          timeout: timeoutMs,
        })
        return stdout
      } catch (error) {
        throw new Error(
          redactSecrets(`git ${args.join(' ')} failed: ${oneLine(error)}`),
        )
      }
    },
    probeCodex: async () => {
      try {
        await execFileAsync('codex', ['--version'], { timeout: GIT_TIMEOUT_MS })
        return true
      } catch {
        return false
      }
    },
    spawnRunner: (runnerArguments) => {
      // Detached and unref'd: the review outlives this command.
      const child = spawn(
        process.execPath,
        [
          join(
            dirname(fileURLToPath(import.meta.url)),
            'utils/runCandidateReview.mjs',
          ),
          ...runnerArguments,
        ],
        { detached: true, stdio: 'ignore', cwd: repository },
      )
      child.unref()
      return child
    },
  }
}

/** Reads a file's text, or `undefined` when it is missing. @example await readIfExists('/a/b.txt') */
async function readIfExists(path) {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return undefined
  }
}

/** Lists the attempt ids that have a log for one candidate (or `undefined` short: for every candidate), oldest first. @example await listAttempts('/r/artifacts/qa', '0123abcd') // => ['20261101T120000Z-a1b2c3'] */
async function listAttempts(qaDirectory, short) {
  let names
  try {
    names = await readdir(qaDirectory)
  } catch {
    return []
  }
  const attempts = []
  for (const name of names) {
    const match = /^codebook-([0-9a-f]{8})-(.+)-codex-review\.txt$/.exec(name)
    if (!match || !CANDIDATE_ATTEMPT_PATTERN.test(match[2])) continue
    if (short === undefined || match[1] === short)
      attempts.push({ short: match[1], attempt: match[2] })
  }
  // The attempt id starts with its UTC time, so sorting orders the attempts in time.
  return attempts.sort((left, right) =>
    left.attempt.localeCompare(right.attempt),
  )
}

/** Judges the review of one attempt by reading its log; a missing log reads as empty and as written at `fallbackMtimeMs`. @example await judgeAttempt(seams, names.log, receipt.builtAt, pid) */
async function judgeAttempt(seams, logPath, fallbackMtimeMs, fallbackPid) {
  let text = ''
  let mtimeMs = fallbackMtimeMs
  try {
    text = (await readFile(logPath, 'utf8')) ?? ''
    mtimeMs = (await stat(logPath)).mtimeMs
  } catch {
    // No log yet: the runner may not have started writing.
  }
  return judgeReview({
    text,
    mtimeMs,
    nowMs: seams.now(),
    isPidAlive: seams.isPidAlive,
    fallbackPid,
  })
}

/** The refusal for a usage mistake (exit 64). @example throw usageRefusal('--status takes no other option') */
function usageRefusal(message) {
  return new CommandRefusal('E_USAGE', message, {
    fix: 'node extension/scripts/qa-candidate.mjs --help',
    exitCode: EXIT.USAGE,
  })
}

/** Parses the command line into one mode. @example parseQaCandidateArguments(['--status', '0123abcd']) // => { mode: 'status', short: '0123abcd' } */
export function parseQaCandidateArguments(argv) {
  let values
  let positionals
  try {
    ;({ values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        'no-review': { type: 'boolean' },
        status: { type: 'boolean' },
        clean: { type: 'boolean' },
        help: { type: 'boolean' },
      },
    }))
  } catch (error) {
    throw usageRefusal(oneLine(error))
  }
  if (values.help) return { mode: 'help' }
  const modes = [values.status, values.clean].filter(Boolean).length
  if (modes > 1) throw usageRefusal('--status and --clean cannot be combined')
  if (values.status || values.clean) {
    if (values['no-review'])
      throw usageRefusal('--no-review applies to a build only')
    if (values.clean && positionals.length > 0)
      throw usageRefusal('--clean takes no argument')
    if (positionals.length > 1)
      throw usageRefusal('--status takes at most one <short>')
    const short = positionals[0]
    if (short !== undefined && !/^[0-9a-f]{8}$/.test(short))
      throw usageRefusal('<short> is the first 8 hex characters of a commit')
    return values.status ? { mode: 'status', short } : { mode: 'clean' }
  }
  if (positionals.length > 0)
    throw usageRefusal(`unexpected argument ${positionals[0]}`)
  return { mode: 'build', review: !values['no-review'] }
}

/**
 * Builds the candidate and starts its review (the default mode).
 *
 * Why: a native trial needs a VSIX that provably comes from one clean commit, plus a review of that commit running while the trial is prepared.
 * Called by {@link runQaCandidate}.
 *
 * @param {{ review: boolean }} options - `review: false` for `--no-review`.
 * @param {ReturnType<typeof productionSeams>} seams - Injected effects.
 * @param {import('./utils/commandContract.mjs').CommandProgress} progress - Stage tracker.
 * @returns {Promise<number>} The exit code.
 * @example
 * await buildCandidate({ review: true }, productionSeams(REPOSITORY), progress)
 */
async function buildCandidate({ review }, seams, progress) {
  const { repository } = seams
  progress.enter('check the checkout')
  const changes = await seams.listChanges(repository)
  if (changes.length > 0)
    throw new CommandRefusal(
      'E_DIRTY',
      `the checkout has changes: ${changes
        .slice(0, DIRTY_PATHS_SHOWN)
        .map((entry) => entry.slice(3))
        .join(
          ', ',
        )}${changes.length > DIRTY_PATHS_SHOWN ? `, and ${changes.length - DIRTY_PATHS_SHOWN} more` : ''}`,
      { fix: 'commit or move the changes, then rerun' },
    )
  progress.enter('read HEAD')
  const head = (await seams.git(['rev-parse', 'HEAD'])).trim()
  const short = head.slice(0, 8)
  const qaDirectory = join(repository, 'artifacts/qa')
  const vsixPath = join(qaDirectory, `codebook-${short}.vsix`)
  const receiptPath = join(qaDirectory, `codebook-${short}.json`)

  // The old receipt's recorded runner pid is kept: a review it started may still run after the receipt is gone.
  const previousReceipt = await readIfExists(receiptPath)
  let previousReview
  try {
    previousReview = JSON.parse(previousReceipt ?? 'null')?.review
  } catch {
    previousReview = undefined
  }
  progress.enter('remove the old receipt', { sideEffect: true })
  await mkdir(qaDirectory, { recursive: true })
  await rm(receiptPath, { force: true })

  progress.enter('build the package', { sideEffect: true })
  let built
  try {
    built = await seams.build(repository, vsixPath)
  } catch (error) {
    const stack =
      error instanceof Error && error.stack
        ? error.stack.split('\n').slice(1)
        : []
    throw new CommandRefusal('E_BUILD', oneLine(error), {
      fix: 'fix the build error above, then rerun',
      exitCode: EXIT.FAILED,
      details: stack.map((line) => redactSecrets(line)),
    })
  }
  // A build is a candidate only when it says it came from this commit with no changes.
  if (built.build?.dirty !== false || built.build?.revision !== head) {
    await rm(vsixPath, { force: true })
    throw new CommandRefusal(
      'E_CANDIDATE_DIRTY',
      `the build of ${short} reports dirty=${String(built.build?.dirty)} at revision ${String(built.build?.revision).slice(0, 8)}, not a clean ${short}`,
      { fix: 'commit the change, then rerun', exitCode: EXIT.FAILED },
    )
  }

  const version = (await readFile(join(repository, 'VERSION'), 'utf8')).trim()
  const receipt = {
    head,
    version,
    sha256: built.sha256,
    entries: built.entries,
    builtAt: new Date(seams.now()).toISOString(),
    review: { state: 'skipped' },
  }
  let notStartedReason
  if (review) {
    progress.enter('start the review', { sideEffect: true })
    const started = await startReview({
      seams,
      head,
      short,
      qaDirectory,
      previousReview,
      builtAtMs: seams.now(),
    })
    receipt.review = started.review
    notStartedReason = started.reason
  }
  progress.enter('write the receipt', { sideEffect: true })
  const temporary = `${receiptPath}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(receipt, null, 2)}\n`)
  await rename(temporary, receiptPath)

  seams.print(`VSIX: ${vsixPath}`)
  seams.print(`SHA-256: ${built.sha256}`)
  if (!review) seams.print('Review: skipped (--no-review)')
  else if (receipt.review.state === 'running')
    seams.print(
      `Review: already running (pid ${receipt.review.pid}); log ${receipt.review.log}`,
    )
  else if (receipt.review.state === 'started')
    seams.print(`Review log: ${receipt.review.log}`)
  if (notStartedReason !== undefined) {
    seams.print(
      'Fix: rerun once the cause is fixed, or name the missing coverage in the post',
    )
    seams.print(`codex review NOT STARTED: ${notStartedReason}`)
    return EXIT.FOLLOW_UP
  }
  return EXIT.DONE
}

/**
 * Starts a review unless one already runs; never throws for a review that cannot start.
 *
 * Why: the candidate stands even when `codex` is missing or the network is down; the reason goes into the receipt and the exit code is 3.
 * Called by {@link buildCandidate}.
 *
 * @param {object} input - `seams`; `head`; `short`; `qaDirectory`; `previousReview` (the old receipt's review, if any); `builtAtMs`.
 * @returns {Promise<{ review: object, reason?: string }>} The receipt's `review` object, and the not-started reason when the review did not start.
 * @example
 * const { review, reason } = await startReview({ seams, head, short, qaDirectory, previousReview, builtAtMs })
 */
async function startReview({
  seams,
  head,
  short,
  qaDirectory,
  previousReview,
  builtAtMs,
}) {
  const { repository } = seams
  const attempts = await listAttempts(qaDirectory, short)
  const latest = attempts.at(-1)
  if (latest) {
    const names = reviewNames(repository, short, latest.attempt)
    const previousPid =
      previousReview?.attempt === latest.attempt
        ? previousReview.pid
        : undefined
    const judged = await judgeAttempt(seams, names.log, builtAtMs, previousPid)
    // A live review is left alone: no second review for the same commit.
    if (judged.state === 'running') {
      const review = {
        state: 'running',
        attempt: latest.attempt,
        pid: judged.facts.runnerPid ?? previousPid,
        log: names.log,
        worktree: names.worktree,
      }
      let base =
        previousReview?.attempt === latest.attempt
          ? previousReview.base
          : undefined
      if (base === undefined) {
        try {
          base = (await seams.git(['rev-parse', names.branch])).trim()
        } catch {
          base = undefined
        }
      }
      if (base !== undefined) review.base = base
      return { review }
    }
  }
  const notStarted = (reason) => ({
    review: { state: 'not-started', reason },
    reason,
  })
  if (!(await seams.probeCodex()))
    return notStarted('codex is not installed or not on PATH')
  let base
  try {
    await seams.git(['fetch', 'origin', 'main'], {
      timeoutMs: FETCH_TIMEOUT_MS,
    })
    base = (await seams.git(['rev-parse', 'origin/main'])).trim()
  } catch (error) {
    return notStarted(`could not fetch origin/main: ${oneLine(error)}`)
  }
  const attempt = `${compactUtc(new Date(seams.now()))}-${seams.randomSuffix()}`
  const names = reviewNames(repository, short, attempt)
  try {
    await seams.git(['worktree', 'add', '--detach', names.worktree, head])
  } catch (error) {
    return notStarted(`could not create the review worktree: ${oneLine(error)}`)
  }
  let runner
  try {
    runner = seams.spawnRunner([
      '--repository',
      repository,
      '--short',
      short,
      '--attempt',
      attempt,
      '--base',
      base,
    ])
    if (runner?.pid === undefined) throw new Error('the runner has no pid')
  } catch (error) {
    // The worktree made for this attempt would otherwise stay behind.
    await cleanReviewAttempt(names, {
      git: (args) => seams.git(args),
      pathExists: async (path) =>
        await stat(path).then(
          () => true,
          () => false,
        ),
    })
    return notStarted(`could not start the review runner: ${oneLine(error)}`)
  }
  return {
    review: {
      state: 'started',
      attempt,
      base,
      pid: runner.pid,
      log: names.log,
      worktree: names.worktree,
    },
  }
}

/**
 * Prints a candidate's receipt and its review state (`--status`); builds and spawns nothing.
 *
 * Why: the driving agent checks whether the review has finished before recording a trial.
 * Called by {@link runQaCandidate}.
 *
 * @param {{ short?: string }} options - The candidate; default HEAD.
 * @param {ReturnType<typeof productionSeams>} seams - Injected effects.
 * @returns {Promise<number>} 0, or refuses with `E_NO_CANDIDATE`.
 * @example
 * await printStatus({ short: '0123abcd' }, productionSeams(REPOSITORY))
 */
async function printStatus({ short }, seams) {
  const { repository } = seams
  const wanted =
    short ?? (await seams.git(['rev-parse', 'HEAD'])).trim().slice(0, 8)
  const receiptPath = join(
    repository,
    'artifacts/qa',
    `codebook-${wanted}.json`,
  )
  const text = await readIfExists(receiptPath)
  if (text === undefined)
    throw new CommandRefusal('E_NO_CANDIDATE', `no receipt for ${wanted}`, {
      fix: 'node extension/scripts/qa-candidate.mjs',
    })
  const receipt = JSON.parse(text)
  seams.print(`Candidate: ${wanted} (${receipt.head})`)
  seams.print(`Version: ${receipt.version}`)
  seams.print(
    `VSIX: ${join(repository, 'artifacts/qa', `codebook-${wanted}.vsix`)}`,
  )
  seams.print(`SHA-256: ${receipt.sha256}`)
  seams.print(`Built: ${receipt.builtAt}`)
  const { review } = receipt
  if (review.state === 'skipped') seams.print('Review: skipped')
  else if (review.state === 'not-started')
    seams.print(`Review: not-started ${review.reason}`)
  else {
    const judged = await judgeAttempt(
      seams,
      review.log,
      Date.parse(receipt.builtAt),
      review.pid,
    )
    seams.print(`Review: ${judged.text}`)
    seams.print(`Review log: ${review.log}`)
    if (review.base) seams.print(`Review base: ${review.base}`)
  }
  return EXIT.DONE
}

/**
 * Removes the worktree and branch of every finished review attempt, and lists the others as kept (`--clean`).
 *
 * Why: a finished or interrupted review can leave a worktree under `artifacts/qa`; only attempts whose log has an exit line and whose runner and codex are both gone are safe to remove.
 * Called by {@link runQaCandidate}.
 *
 * @param {ReturnType<typeof productionSeams>} seams - Injected effects.
 * @returns {Promise<number>} 0.
 * @example
 * await cleanAttempts(productionSeams(REPOSITORY))
 */
async function cleanAttempts(seams) {
  const { repository } = seams
  const qaDirectory = join(repository, 'artifacts/qa')
  for (const { short, attempt } of await listAttempts(qaDirectory, undefined)) {
    const names = reviewNames(repository, short, attempt)
    const label = `${short} ${attempt}`
    const text = (await readIfExists(names.log)) ?? ''
    const facts = parseReviewLog(text)
    const alive = [
      ['runner', facts.runnerPid],
      ['codex', facts.codexPid],
    ].find(([, pid]) => pid !== undefined && seams.isPidAlive(pid))
    let reason
    if (!facts.exit)
      reason = `no exit line in the log (interrupted or still running); remove ${names.worktree} and branch ${names.branch} by hand if it is stale`
    else if (alive) reason = `${alive[0]} pid ${alive[1]} is still running`
    if (reason !== undefined) {
      seams.print(`kept ${label}: ${reason}`)
      continue
    }
    const failures = await cleanReviewAttempt(names, {
      git: (args) => seams.git(args),
      pathExists: (path) =>
        stat(path).then(
          () => true,
          () => false,
        ),
    })
    if (failures.length > 0) {
      seams.print(`kept ${label}: ${failures.join('; ')}`)
      continue
    }
    if (!facts.cleaned) {
      await writeFile(names.log, 'CODEX_REVIEW_CLEANED\n', { flag: 'a' })
    }
    seams.print(`removed ${label}`)
  }
  return EXIT.DONE
}

/**
 * Runs the command for one argument list under injected effects.
 *
 * Why: tests drive the whole command with fakes; production wires {@link productionSeams}.
 * Called by {@link main} and by `qaCandidate.test.mjs`.
 *
 * @param {string[]} argv - Arguments after the script name.
 * @param {ReturnType<typeof productionSeams>} seams - Injected effects.
 * @param {import('./utils/commandContract.mjs').CommandProgress} progress - Stage tracker.
 * @returns {Promise<number>} The exit code (a value of {@link EXIT}).
 * @example
 * process.exitCode = await runQaCandidate(['--no-review'], productionSeams(REPOSITORY), progress)
 */
export async function runQaCandidate(argv, seams, progress) {
  const parsed = parseQaCandidateArguments(argv)
  if (parsed.mode === 'help') {
    seams.print(HELP_TEXT.trimEnd())
    return EXIT.DONE
  }
  if (parsed.mode === 'status') return printStatus(parsed, seams)
  if (parsed.mode === 'clean') return cleanAttempts(seams)
  return buildCandidate(parsed, seams, progress)
}

/** Entry point body: wires production seams. @example process.exitCode = await runCommandLine(main) */
async function main(progress) {
  return runQaCandidate(
    process.argv.slice(2),
    productionSeams(REPOSITORY),
    progress,
  )
}

if (isRunAsScript(import.meta.url))
  process.exitCode = await runCommandLine(main)
