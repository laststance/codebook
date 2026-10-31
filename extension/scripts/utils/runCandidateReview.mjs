import { execFile, spawn } from 'node:child_process'
import { appendFile, mkdir, open, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { parseArgs, promisify } from 'node:util'

import { redactSecrets } from './commandContract.mjs'
import { endChildrenOnSignal } from './endChildrenOnSignal.mjs'
import { endProcessTree } from './endProcessTree.mjs'
import { isRunAsScript } from './isRunAsScript.mjs'
import { packageGitOptions } from './packageGitOptions.mjs'

const execFileAsync = promisify(execFile)

/** How long `codex review` may run before the runner ends its whole process tree and records `CODEX_REVIEW_EXIT timeout`: 30 minutes. */
export const CANDIDATE_REVIEW_LIMIT_MS = 30 * 60 * 1000

/** Time a git call of the runner may take (worktree and branch bookkeeping, no network). */
const RUNNER_GIT_TIMEOUT_MS = 60 * 1000

/** Matches the id of one review attempt: UTC time, a dash and a random hex suffix. */
export const CANDIDATE_ATTEMPT_PATTERN = /^\d{8}T\d{6}Z-[0-9a-f]{6}$/

/**
 * Gives the worktree, branch, log and state-file names of one review attempt, so the parent command, the detached runner and `--clean` agree on them.
 *
 * Why: every attempt has its own names (an older attempt's cleanup must never touch a newer attempt's worktree, branch or log). The state file holds only the runner's own state lines; codex and the reviewed code write the log, so a line they print can never pass for state.
 * Called by `qa-candidate.mjs` (to create the worktree and read the log), by {@link runCandidateReview} and by {@link cleanReviewAttempt}.
 *
 * @param {string} repository - The repository's root.
 * @param {string} short - The first 8 hex characters of the candidate's HEAD.
 * @param {string} attempt - The attempt id (matches {@link CANDIDATE_ATTEMPT_PATTERN}).
 * @returns {{ log: string, state: string, worktree: string, branch: string }} Absolute log, state-file and worktree paths, and the branch name `qa-base-<short>-<attempt>`.
 * @example
 * reviewNames('/work/codebook', '0123abcd', '20261101T120000Z-a1b2c3').branch // => 'qa-base-0123abcd-20261101T120000Z-a1b2c3'
 */
export function reviewNames(repository, short, attempt) {
  return {
    log: join(
      repository,
      'artifacts/qa',
      `codebook-${short}-${attempt}-codex-review.txt`,
    ),
    state: join(
      repository,
      'artifacts/qa',
      `codebook-${short}-${attempt}-review-state.txt`,
    ),
    worktree: join(repository, 'artifacts/qa', `review-${short}-${attempt}`),
    branch: `qa-base-${short}-${attempt}`,
  }
}

/**
 * Removes one review attempt's worktree and base branch, and says what failed.
 *
 * Why: the runner cleans up after its review, and `qa-candidate.mjs --clean` removes what an interrupted attempt left; both must do it the same way and survive a path or branch that is already gone.
 * Called by {@link runCandidateReview} after the exit line, and by `qa-candidate.mjs --clean`.
 *
 * @param {{ worktree: string, branch: string }} names - From {@link reviewNames}.
 * @param {{ git: (args: string[]) => Promise<string>, pathExists: (path: string) => Promise<boolean> }} seams - `git` runs in the repository and rejects on a nonzero exit.
 * @returns {Promise<string[]>} One message per step that failed; empty when the attempt's worktree and branch are gone.
 * @example
 * const failures = await cleanReviewAttempt(reviewNames(root, short, attempt), { git, pathExists })
 */
export async function cleanReviewAttempt(
  { worktree, branch },
  { git, pathExists },
) {
  const failures = []
  // A worktree that is already gone needs no removal; a stale registration is pruned below.
  if (await pathExists(worktree)) {
    try {
      await git(['worktree', 'remove', '--force', worktree])
    } catch (error) {
      failures.push(`worktree remove: ${errorMessage(error)}`)
    }
  }
  try {
    await git(['worktree', 'prune'])
  } catch (error) {
    failures.push(`worktree prune: ${errorMessage(error)}`)
  }
  let branchExists = true
  try {
    await git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`])
  } catch {
    // The branch does not exist (never created, or already deleted).
    branchExists = false
  }
  if (branchExists) {
    try {
      await git(['branch', '-D', branch])
    } catch (error) {
      failures.push(`branch delete: ${errorMessage(error)}`)
    }
  }
  return failures
}

/** One-line message of a thrown value, so a log line never breaks. @example errorMessage(new Error('a\nb')) // => 'a b' */
function errorMessage(error) {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/\s+/g, ' ').trim()
}

/**
 * Runs `codex review` for one candidate attempt, bounded in time, and records its life in the attempt's state file (codex's own output goes to the separate review log).
 *
 * Why: a review must read the candidate's exact commit (the detached worktree the parent made), against a pinned base branch, never hang a post (30-minute limit, whole tree ended) and always leave a trace a later run can judge (pid line, exit line with its time, cleanup line).
 * Runs inside the detached runner process that `qa-candidate.mjs` spawns; tests call it with fakes.
 *
 * State-file lines, in order: `CODEX_REVIEW_PID <runner pid>`, `CODEX_REVIEW_CHILD <codex pid>`, `CODEX_REVIEW_EXIT <code|timeout|error <message>> <ISO time>`, `CODEX_REVIEW_CLEANED` (or `CODEX_REVIEW_CLEANUP_FAILED <message>` so `--clean` retries).
 * A runner error after codex started (for example a failed `CODEX_REVIEW_CHILD` write) ends codex's tree first; a failing tree end is named in the error exit line.
 * On SIGTERM, SIGINT or SIGHUP codex's tree is ended first ({@link endChildrenOnSignal}) and an `error` exit line is written; the worktree and branch stay for `--clean`.
 *
 * @param {{ repository: string, short: string, attempt: string, base: string }} options - `base` is the full sha the base branch is reset to.
 * @param {object} seams - `pid`; `now()` returns a Date; `appendState(text)`; `git(args)` runs in the repository and rejects on failure; `pathExists(path)`; `startCodex({ cwd, args })` returns a child with `pid` that emits `close` (and `error`); `endTree(child)`; `registerSignalEnd(end)` returns a release function; `setTimer(fn, ms)` and `clearTimer(handle)`.
 * @returns {Promise<void>} Resolves after the last log line.
 * @example
 * await runCandidateReview({ repository, short, attempt, base }, productionRunnerSeams(repository, short, attempt))
 */
export async function runCandidateReview(
  { repository, short, attempt, base },
  seams,
) {
  const names = reviewNames(repository, short, attempt)
  const stamp = () => seams.now().toISOString()
  let exitWritten = false
  /** Writes the exit line once, whichever of codex, the timer, a signal or an error gets there first. */
  const writeExit = async (body) => {
    if (exitWritten) return
    exitWritten = true
    await seams.appendState(`CODEX_REVIEW_EXIT ${body} ${stamp()}\n`)
  }
  await seams.appendState(`CODEX_REVIEW_PID ${seams.pid}\n`)
  let child
  let release = () => {}
  let timer
  let ended = false
  // Set the moment the limit passes, before the tree end: a `close` the end itself causes must not pass for codex's own exit.
  let timedOut = false
  // True once codex has closed or failed to spawn, so a later runner error has no tree left to end.
  let codexDone = false
  try {
    // Reset a branch an interrupted run left behind; the pinned base keeps the reviewed diff reproducible.
    await seams.git(['branch', '-f', names.branch, base])
    child = seams.startCodex({
      cwd: names.worktree,
      args: ['review', '--base', names.branch],
    })
    // Listeners and the exit promise exist before any await, so an asynchronous spawn failure or an early close is never missed.
    const outcomePromise = new Promise((resolve) => {
      child.once('error', (error) => {
        codexDone = true
        resolve({ error })
      })
      child.once('close', (code, signal) => {
        codexDone = true
        resolve({ code, signal })
      })
      // Past the limit the tree is ended before the exit line, so the line is true when it is read.
      timer = seams.setTimer(async () => {
        timedOut = true
        try {
          await seams.endTree(child)
        } catch {
          // The tree end is best effort; the timeout is recorded either way.
        }
        resolve({ timeout: true })
      }, CANDIDATE_REVIEW_LIMIT_MS)
    })
    // A signal to the runner ends codex's whole tree, then records why the review stopped.
    release = seams.registerSignalEnd(async () => {
      ended = true
      await seams.endTree(child)
      await writeExit('error terminated by a signal')
    })
    await seams.appendState(`CODEX_REVIEW_CHILD ${child.pid}\n`)
    const outcome = await outcomePromise
    if (!ended) {
      if (timedOut || outcome.timeout) await writeExit('timeout')
      else if (outcome.error)
        await writeExit(`error ${errorMessage(outcome.error)}`)
      else
        await writeExit(
          outcome.code === null
            ? `killed-by-${outcome.signal}`
            : String(outcome.code),
        )
    }
  } catch (error) {
    // The runner itself failed (branch reset, spawn, state-file write): record it, still clean up.
    // Codex runs detached; once started and still alive, its tree is ended first so no review outlives the worktree it reads.
    let treeEndFailure = ''
    if (child !== undefined && !codexDone && !timedOut && !ended) {
      try {
        await seams.endTree(child)
      } catch (endError) {
        treeEndFailure = ` (ending codex's process tree failed: ${errorMessage(endError)})`
      }
    }
    await writeExit(`error ${errorMessage(error)}${treeEndFailure}`)
  } finally {
    if (timer !== undefined) seams.clearTimer(timer)
    release()
  }
  // After a signal the process exits at once; the worktree and branch stay for --clean.
  if (ended) return
  const failures = await cleanReviewAttempt(names, seams)
  await seams.appendState(
    failures.length === 0
      ? 'CODEX_REVIEW_CLEANED\n'
      : `CODEX_REVIEW_CLEANUP_FAILED ${failures.join('; ')}\n`,
  )
}

/**
 * Wires the runner to the real log file, git, codex, process-tree end and signals.
 *
 * Why: the production defaults live apart from {@link runCandidateReview} so tests inject fakes.
 * Called by this file's entry point.
 *
 * @param {string} repository - The repository's root.
 * @param {string} short - Candidate short sha.
 * @param {string} attempt - Attempt id.
 * @returns The seams {@link runCandidateReview} takes.
 * @example
 * await runCandidateReview(options, productionRunnerSeams(repository, short, attempt))
 */
export function productionRunnerSeams(repository, short, attempt) {
  const { state } = reviewNames(repository, short, attempt)
  return {
    pid: process.pid,
    now: () => new Date(),
    appendState: (text) => appendFile(state, text),
    git: async (args) => {
      const { stdout } = await execFileAsync('git', args, {
        ...packageGitOptions(repository),
        timeout: RUNNER_GIT_TIMEOUT_MS,
      })
      return stdout
    },
    pathExists: async (path) => {
      try {
        await stat(path)
        return true
      } catch {
        return false
      }
    },
    startCodex: ({ cwd, args }) => {
      // Codex appends to the attempt's log directly, in its own process group so its whole tree can be ended.
      const child = spawn('codex', args, {
        cwd,
        detached: true,
        stdio: ['ignore', logDescriptor.fd, logDescriptor.fd],
      })
      return child
    },
    endTree: (child) => endProcessTree(child),
    registerSignalEnd: (end) => endChildrenOnSignal(end),
    setTimer: (callback, milliseconds) => setTimeout(callback, milliseconds),
    clearTimer: (handle) => clearTimeout(handle),
  }
}

/** The log opened for append before codex starts; set by the entry point. */
let logDescriptor

/** Entry point of the detached runner: `node runCandidateReview.mjs --repository <dir> --short <8 hex> --attempt <id> --base <sha>`. @example spawn(process.execPath, [runnerPath, '--repository', root, …], { detached: true }) */
async function main() {
  const { values } = parseArgs({
    options: {
      repository: { type: 'string' },
      short: { type: 'string' },
      attempt: { type: 'string' },
      base: { type: 'string' },
    },
  })
  const { repository, short, attempt, base } = values
  if (
    !repository ||
    !/^[0-9a-f]{8}$/.test(short ?? '') ||
    !CANDIDATE_ATTEMPT_PATTERN.test(attempt ?? '') ||
    !/^[0-9a-f]{40,64}$/.test(base ?? '')
  )
    throw new Error('runCandidateReview: bad arguments')
  await mkdir(join(repository, 'artifacts/qa'), { recursive: true })
  const { log } = reviewNames(repository, short, attempt)
  logDescriptor = await open(log, 'a')
  try {
    await runCandidateReview(
      { repository, short, attempt, base },
      productionRunnerSeams(repository, short, attempt),
    )
  } finally {
    await logDescriptor.close()
  }
}

if (isRunAsScript(import.meta.url)) {
  try {
    await main()
  } catch (error) {
    console.error(redactSecrets(errorMessage(error)))
    process.exitCode = 1
  }
}
