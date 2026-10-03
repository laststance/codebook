/** Editor host that runs a Wiki update. */
export type WikiUpdateHost = 'vscode' | 'cursor'

/** Whether the published site was the same when a run ended (`kept`) or was replaced during it (`replaced`). */
export type WikiUpdateSite = 'kept' | 'replaced'

/** Why an update would overwrite or cannot replace something: a learner's own file, a generated page edited by hand, or an earlier publish that did not finish. */
export type WikiUpdateConflictCause =
  'learner-file' | 'edited-page' | 'unfinished-publish'

/** Where the Wiki lives: the absolute resolved folder, and the text the learner reads for it (project-relative when inside the project). */
export type WikiUpdateOutput = { outputDirectory: string; outputLabel: string }

/**
 * Where a Wiki update run is, as `GET <reader>/api/update-status` answers it (JSON, `Cache-Control: no-store`, GET only).
 *
 * One value per editor window, held in memory: a window reload or a new reader starts again at `idle`.
 * `running` is the only non-terminal state. Timestamps are ISO 8601 in UTC. `outputDirectory` is the absolute resolved Wiki folder and `outputLabel` the text shown for it.
 * `site` says whether the published site was the same when the run ended (`kept`) or was replaced during it (`replaced`).
 * Additive fields may appear; a reader must ignore fields it does not know and treat an unknown `state` as "status unknown".
 */
export type WikiUpdateStatus =
  | { state: 'idle' }
  | ({
      state: 'running'
      host: WikiUpdateHost
      startedAt: string
      timeoutMs: number
      candidateStaged: boolean
    } & WikiUpdateOutput)
  | ({
      state: 'succeeded'
      host: WikiUpdateHost
      finishedAt: string
      identity: string
    } & WikiUpdateOutput)
  | ({
      state: 'already-current'
      finishedAt: string
      identity?: string
    } & WikiUpdateOutput)
  | ({
      state: 'failed'
      host: WikiUpdateHost
      finishedAt: string
      reason: string
      site: WikiUpdateSite
    } & WikiUpdateOutput)
  | ({
      state: 'cancelled'
      host: WikiUpdateHost
      finishedAt: string
      site: WikiUpdateSite
    } & WikiUpdateOutput)
  | ({
      state: 'timed-out'
      host: WikiUpdateHost
      finishedAt: string
      timeoutMs: number
      site: WikiUpdateSite
    } & WikiUpdateOutput)
  | ({
      state: 'conflict'
      host: WikiUpdateHost
      finishedAt: string
      paths: string[]
      cause: WikiUpdateConflictCause
      site: WikiUpdateSite
    } & WikiUpdateOutput)

/** A start that was refused before any agent ran: nothing was replaced. */
export type WikiUpdateRefusal =
  | { kind: 'conflict'; paths: string[]; cause: WikiUpdateConflictCause }
  | { kind: 'failed'; reason: string }

type RunningStatus = Extract<WikiUpdateStatus, { state: 'running' }>

/**
 * Holds the one Wiki update run of an editor window so the command, the `/update` link and the browser button share it.
 *
 * Why: a second start while a run is active must be refused in all three entries, and the reader needs a snapshot to show running and result states.
 * Trigger: the extension activation creates one instance; its `status` snapshot is what the reader serves.
 *
 * @example
 * ```ts
 * const run = new WikiUpdateRun()
 * const output = { outputDirectory: '/repo/.codebook/wiki', outputLabel: '.codebook/wiki' }
 * run.begin('vscode', output, 900_000) // => true
 * run.begin('vscode', output, 900_000) // => false while running
 * run.succeed('a1b2c3d4e5f6+0f9e8d7c')
 * ```
 */
export class WikiUpdateRun {
  #status: WikiUpdateStatus = { state: 'idle' }
  readonly #now: () => Date

  /** @param now - Clock for result timestamps; tests pass a fixed one. */
  constructor(now: () => Date = () => new Date()) {
    this.#now = now
  }

  /** @returns A copy of the current state, safe to serialize. @example run.status().state // => 'idle' */
  status(): WikiUpdateStatus {
    return structuredClone(this.#status)
  }

  /** @returns Whether a run is active. @example run.isRunning() // => false */
  isRunning(): boolean {
    return this.#status.state === 'running'
  }

  /** Starts a run unless one is active. @param host - Editor host that runs it. @param output - Resolved Wiki folder and its label. @param timeoutMs - Bound after which the run ends as timed out; shown to the learner. @returns False when a run is already active. @example run.begin('cursor', { outputDirectory: '/repo/.codebook/wiki', outputLabel: '.codebook/wiki' }, 900_000) */
  begin(
    host: WikiUpdateHost,
    output: WikiUpdateOutput,
    timeoutMs: number,
  ): boolean {
    if (this.isRunning()) return false
    this.#status = {
      state: 'running',
      host,
      startedAt: this.#now().toISOString(),
      timeoutMs,
      candidateStaged: false,
      ...output,
    }
    return true
  }

  /** Notes that the agent has staged a candidate site, so the page can say work is under way. Ignored when no run is active. @example run.markCandidateStaged() */
  markCandidateStaged(): void {
    if (this.#status.state !== 'running') return
    this.#status = { ...this.#status, candidateStaged: true }
  }

  /** Ends the active run as published and current. @param identity - Manifest identity of the new site. @example run.succeed('a1b2c3d4e5f6+0f9e8d7c') */
  succeed(identity: string): void {
    this.#finish((running, finishedAt) => ({
      state: 'succeeded',
      host: running.host,
      finishedAt,
      identity,
      ...outputOf(running),
    }))
  }

  /** Ends the active run as failed. @param reason - What happened and what to do; the page adds what was kept. @param site - Whether the published site was replaced during the run. @example run.fail('Cursor Agent stopped with exit code 1 before finishing.', 'kept') */
  fail(reason: string, site: WikiUpdateSite): void {
    this.#finish((running, finishedAt) => ({
      state: 'failed',
      host: running.host,
      finishedAt,
      reason,
      site,
      ...outputOf(running),
    }))
  }

  /** Ends the active run because the learner cancelled it (in VS Code only the watch stops). @param site - Whether the published site was replaced during the run. @example run.cancel('kept') */
  cancel(site: WikiUpdateSite): void {
    this.#finish((running, finishedAt) => ({
      state: 'cancelled',
      host: running.host,
      finishedAt,
      site,
      ...outputOf(running),
    }))
  }

  /** Ends the active run because its bound passed without a result. @param site - Whether the published site was replaced during the run. @example run.timeOut('kept') */
  timeOut(site: WikiUpdateSite): void {
    this.#finish((running, finishedAt) => ({
      state: 'timed-out',
      host: running.host,
      finishedAt,
      timeoutMs: running.timeoutMs,
      site,
      ...outputOf(running),
    }))
  }

  /** Ends the active run because something of the learner's blocks the replacement; an empty list is recorded as a failure, since a conflict must name a path. @param paths - Output-relative paths named to the learner. @param cause - What kind of block it is. @param site - Whether the published site was replaced during the run. @example run.conflict(['notes/mine.md'], 'learner-file', 'kept') */
  conflict(
    paths: string[],
    cause: WikiUpdateConflictCause,
    site: WikiUpdateSite,
  ): void {
    if (paths.length === 0) {
      this.fail('The update was blocked, but no blocking file was named.', site)
      return
    }
    this.#finish((running, finishedAt) => ({
      state: 'conflict',
      host: running.host,
      finishedAt,
      paths: [...paths],
      cause,
      site,
      ...outputOf(running),
    }))
  }

  /** Records that nothing needed updating; no run starts. @param output - Resolved Wiki folder and its label. @param identity - Identity of the current site when known. @example run.alreadyCurrent({ outputDirectory: '/repo/.codebook/wiki', outputLabel: '.codebook/wiki' }, 'a1b2c3d4e5f6+0f9e8d7c') */
  alreadyCurrent(output: WikiUpdateOutput, identity?: string): void {
    if (this.isRunning()) return
    this.#status = {
      state: 'already-current',
      finishedAt: this.#now().toISOString(),
      ...(identity === undefined ? {} : { identity }),
      ...output,
    }
  }

  /** Records a start that was refused before any agent ran, so the page shows why; nothing was replaced. Ignored while a run is active. @param host - Editor host that was asked. @param output - Resolved Wiki folder and its label. @param refusal - The block found before the start. @example run.refuseStart('vscode', output, { kind: 'conflict', paths: ['index.html'], cause: 'edited-page' }) */
  refuseStart(
    host: WikiUpdateHost,
    output: WikiUpdateOutput,
    refusal: WikiUpdateRefusal,
  ): void {
    if (this.isRunning()) return
    const finishedAt = this.#now().toISOString()
    this.#status =
      refusal.kind === 'conflict' && refusal.paths.length > 0
        ? {
            state: 'conflict',
            host,
            finishedAt,
            paths: [...refusal.paths],
            cause: refusal.cause,
            site: 'kept',
            ...output,
          }
        : {
            state: 'failed',
            host,
            finishedAt,
            reason:
              refusal.kind === 'failed'
                ? refusal.reason
                : 'The update was blocked, but no blocking file was named.',
            site: 'kept',
            ...output,
          }
  }

  /** Replaces the active run with its result; a result for no active run is ignored so a late callback cannot overwrite a newer state. */
  #finish(
    build: (running: RunningStatus, finishedAt: string) => WikiUpdateStatus,
  ): void {
    if (this.#status.state !== 'running') return
    this.#status = build(this.#status, this.#now().toISOString())
  }
}

/** Copies the output fields of a running state into its result. */
function outputOf(running: RunningStatus): WikiUpdateOutput {
  return {
    outputDirectory: running.outputDirectory,
    outputLabel: running.outputLabel,
  }
}
