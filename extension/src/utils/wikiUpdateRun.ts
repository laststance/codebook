/** Where a Wiki update run is, as the browser reader shows it. */
export type WikiUpdateStatus =
  | { state: 'idle' }
  | {
      state: 'running'
      host: 'vscode' | 'cursor'
      startedAt: string
      outputDirectory: string
    }
  | {
      state: 'succeeded'
      finishedAt: string
      identity: string
      outputDirectory: string
    }
  | {
      state: 'already-current'
      finishedAt: string
      identity?: string
      outputDirectory: string
    }
  | {
      state: 'failed'
      finishedAt: string
      reason: string
      outputDirectory: string
    }
  | { state: 'cancelled'; finishedAt: string; outputDirectory: string }
  | { state: 'timed-out'; finishedAt: string; outputDirectory: string }
  | {
      state: 'conflict'
      finishedAt: string
      paths: string[]
      outputDirectory: string
    }

/**
 * Holds the one Wiki update run of an editor window so the command, the `/update` link and the browser button share it.
 *
 * Why: a second start while a run is active must be refused in all three entries, and the reader needs a snapshot to show running and result states.
 * Trigger: the extension activation creates one instance; its `status` snapshot is what the reader serves.
 *
 * @example
 * ```ts
 * const run = new WikiUpdateRun()
 * run.begin('vscode', '/repo/.codebook/wiki') // => true
 * run.begin('vscode', '/repo/.codebook/wiki') // => false while running
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

  /** Starts a run unless one is active. @param host - Editor host that runs it. @param outputDirectory - Resolved Wiki output shown to the learner. @returns False when a run is already active. @example run.begin('cursor', '/repo/.codebook/wiki') */
  begin(host: 'vscode' | 'cursor', outputDirectory: string): boolean {
    if (this.isRunning()) return false
    this.#status = {
      state: 'running',
      host,
      startedAt: this.#now().toISOString(),
      outputDirectory,
    }
    return true
  }

  /** Ends the active run as published. @param identity - Manifest identity of the new site. @example run.succeed('a1b2c3d4e5f6+0f9e8d7c') */
  succeed(identity: string): void {
    this.#finish((outputDirectory, finishedAt) => ({
      state: 'succeeded',
      finishedAt,
      identity,
      outputDirectory,
    }))
  }

  /** Ends the active run as failed. @param reason - Text the learner reads next to the kept site. @example run.fail('Cursor Agent exited with code 1') */
  fail(reason: string): void {
    this.#finish((outputDirectory, finishedAt) => ({
      state: 'failed',
      finishedAt,
      reason,
      outputDirectory,
    }))
  }

  /** Ends the active run because the learner cancelled the watch. @example run.cancel() */
  cancel(): void {
    this.#finish((outputDirectory, finishedAt) => ({
      state: 'cancelled',
      finishedAt,
      outputDirectory,
    }))
  }

  /** Ends the active run because no publish appeared within the bound. @example run.timeOut() */
  timeOut(): void {
    this.#finish((outputDirectory, finishedAt) => ({
      state: 'timed-out',
      finishedAt,
      outputDirectory,
    }))
  }

  /** Ends the active run because a learner-owned file blocks the replacement. @param paths - Output-relative paths named to the learner. @example run.conflict(['notes/mine.md']) */
  conflict(paths: string[]): void {
    this.#finish((outputDirectory, finishedAt) => ({
      state: 'conflict',
      finishedAt,
      paths: [...paths],
      outputDirectory,
    }))
  }

  /** Records that nothing needed updating; no run starts. @param outputDirectory - Resolved Wiki output. @param identity - Identity of the current site when known. @example run.alreadyCurrent('/repo/.codebook/wiki', 'a1b2c3d4e5f6+0f9e8d7c') */
  alreadyCurrent(outputDirectory: string, identity?: string): void {
    if (this.isRunning()) return
    this.#status = {
      state: 'already-current',
      finishedAt: this.#now().toISOString(),
      ...(identity === undefined ? {} : { identity }),
      outputDirectory,
    }
  }

  /** Replaces the active run with its result; a result for no active run is ignored so a late callback cannot overwrite a newer state. */
  #finish(
    build: (outputDirectory: string, finishedAt: string) => WikiUpdateStatus,
  ): void {
    if (this.#status.state !== 'running') return
    this.#status = build(
      this.#status.outputDirectory,
      this.#now().toISOString(),
    )
  }
}
