import { WIKI_UPDATE_UNNAMED_BLOCK_REASON } from '../constants'

/** Editor host that runs a Wiki update. */
export type WikiUpdateHost = 'vscode' | 'cursor'

/** Whether the published site was the same when a run ended (`kept`), was replaced during it (`replaced`), or was not there to be called either (`missing`: a publish that was stopped inside its swap, a start refused because the folder holds no Wiki, or a run whose end could not be read from the disk, {@link unreadWikiUpdateEnd}); a reader says nothing of the site for `missing`. */
export type WikiUpdateSite = 'kept' | 'replaced' | 'missing'

/** Why an update would overwrite or cannot replace something: a learner's own file, a generated page edited by hand, a generated page that is gone, a link or special file in the Wiki folder, a Wiki folder that is itself a link or a file, the manifest changed after its publish, a manifest that cannot be read, or an earlier publish that did not finish. */
export type WikiUpdateConflictCause =
  | 'learner-file'
  | 'edited-page'
  | 'missing-page'
  | 'special-file'
  | 'not-a-folder'
  | 'edited-manifest'
  | 'unreadable-manifest'
  | 'unfinished-publish'

/** Where the Wiki lives: the absolute resolved folder, and the text the learner reads for it (project-relative when inside the project). */
export type WikiUpdateOutput = { outputDirectory: string; outputLabel: string }

/** What a published Wiki is called: the display text, and the two values it is joined from. */
export type WikiPublishedIdentity = {
  /** `<first 12 characters of the revision, or no-revision>+<index>`, for display only. */
  identity: string
  /** First 12 characters of the Git revision the Wiki was checked against; absent when none was (a project without a Git repository). */
  revision?: string
  /** Short digest of the indexed sources. */
  index: string
}

/**
 * Where a Wiki update run is, as `GET <reader>/api/update-status` answers it (JSON, `Cache-Control: no-store`, GET only).
 *
 * One value per editor window, held in memory: a window reload or a new reader starts again at `idle`.
 * `running` is the only non-terminal state. Timestamps are ISO 8601 in UTC. `outputDirectory` is the absolute resolved Wiki folder and `outputLabel` the text shown for it.
 * `isOutputOutsideProject` is set on a run whose Wiki folder lies outside the opened project, where VS Code's chat asks to approve each step.
 * `site` says whether the published site was the same when the run ended (`kept`), was replaced during it (`replaced`) or was gone (`missing`).
 * `identity` is the display text `<revision or no-revision>+<index>`; `revision` (absent when no Git revision was checked) and `index` carry the same two values as data, so no reader parses the text.
 * `addedFilesUnchecked` is set on `already-current` when the project has no Git repository: every indexed source matches, and added files were not looked for.
 * `isCodebookSentence` marks a failure `reason` that Codebook wrote itself with its next step; a reader shows it whole and shortens only a reason an agent, the CLI or a thrown error supplied.
 * `mayBeReplacedLater` marks a failure with a kept site after which somebody Codebook did not stop can still publish (a VS Code chat that may still hold its request or that lost its watch, another window's update, an earlier chat the start waits for); a reader then says what held at that time, not that the site is kept.
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
      isOutputOutsideProject?: true
    } & WikiUpdateOutput)
  | ({
      state: 'succeeded'
      host: WikiUpdateHost
      finishedAt: string
    } & WikiPublishedIdentity &
      WikiUpdateOutput)
  | ({
      state: 'already-current'
      finishedAt: string
      addedFilesUnchecked?: true
    } & Partial<WikiPublishedIdentity> &
      WikiUpdateOutput)
  | ({
      state: 'failed'
      host: WikiUpdateHost
      finishedAt: string
      reason: string
      isCodebookSentence?: true
      mayBeReplacedLater?: true
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

/** A start that was refused before any agent ran: nothing was replaced. A `failed` refusal marks a sentence Codebook wrote itself with `isCodebookSentence`, a folder that holds no Wiki with `site: 'missing'`, so nothing claims a site was kept, and a refusal because somebody else is still updating the Wiki with `mayBeReplacedLater`, so nothing claims the site is kept for good. */
export type WikiUpdateRefusal =
  | { kind: 'conflict'; paths: string[]; cause: WikiUpdateConflictCause }
  | {
      kind: 'failed'
      reason: string
      isCodebookSentence?: true
      mayBeReplacedLater?: true
      site?: Extract<WikiUpdateSite, 'missing'>
    }

/** How a run ended, without the fields the run itself knows (host, time, output, bound); {@link classifyWikiUpdateEnd} builds it and {@link WikiUpdateRun.end} records it. */
export type WikiUpdateEnd =
  | (Pick<Extract<WikiUpdateStatus, { state: 'succeeded' }>, 'state'> &
      WikiPublishedIdentity)
  | Pick<
      Extract<WikiUpdateStatus, { state: 'failed' }>,
      'state' | 'reason' | 'isCodebookSentence' | 'mayBeReplacedLater' | 'site'
    >
  | Pick<Extract<WikiUpdateStatus, { state: 'cancelled' }>, 'state' | 'site'>
  | Pick<Extract<WikiUpdateStatus, { state: 'timed-out' }>, 'state' | 'site'>
  | Pick<
      Extract<WikiUpdateStatus, { state: 'conflict' }>,
      'state' | 'paths' | 'cause' | 'site'
    >

/**
 * Builds the state a run ends in from its result and what the run itself knows; called by {@link WikiUpdateRun.end} for the active run.
 * @param running - The state of the run that ends: its host, its output and its bound.
 * @param finishedAt - When the run ended, as an ISO timestamp.
 * @param result - How the run ended.
 * @returns
 * - A conflict that names no path: `failed` with a sentence Codebook wrote, since a conflict without a path could not tell the learner what to move
 * - `timed-out`: the result with host, time, output and the bound
 * - Any other result: the result with host, time and output
 * @example
 * endedStatus(running, '2026-10-03T12:10:00.000Z', { state: 'cancelled', site: 'kept' })
 * // => { host: 'cursor', finishedAt: '2026-10-03T12:10:00.000Z', outputDirectory: '/repo/.codebook/wiki', outputLabel: '.codebook/wiki', state: 'cancelled', site: 'kept' }
 */
function endedStatus(
  running: Extract<WikiUpdateStatus, { state: 'running' }>,
  finishedAt: string,
  result: WikiUpdateEnd,
): WikiUpdateStatus {
  const ended = {
    host: running.host,
    finishedAt,
    outputDirectory: running.outputDirectory,
    outputLabel: running.outputLabel,
  }
  // A conflict without a path could not tell the learner what to move.
  if (result.state === 'conflict' && result.paths.length === 0)
    return {
      ...ended,
      state: 'failed',
      reason: WIKI_UPDATE_UNNAMED_BLOCK_REASON,
      isCodebookSentence: true,
      site: result.site,
    }
  return result.state === 'timed-out'
    ? { ...ended, ...result, timeoutMs: running.timeoutMs }
    : { ...ended, ...result }
}

/**
 * Copies the two marks of a `failed` refusal into the state it is recorded as; called by {@link refusalReason}.
 * @param refusal - The refusal, of which only the marks are read.
 * @returns `isCodebookSentence` and `mayBeReplacedLater`, each present only when the refusal carries it.
 * @example
 * marksOfRefusal({ isCodebookSentence: true, mayBeReplacedLater: true }) // => { isCodebookSentence: true, mayBeReplacedLater: true }
 * marksOfRefusal({})                                                     // => {}
 */
function marksOfRefusal(refusal: {
  isCodebookSentence?: true
  mayBeReplacedLater?: true
}): { isCodebookSentence?: true; mayBeReplacedLater?: true } {
  return {
    ...(refusal.isCodebookSentence ? { isCodebookSentence: true } : {}),
    ...(refusal.mayBeReplacedLater ? { mayBeReplacedLater: true } : {}),
  }
}

/**
 * Words why a start was refused that names no blocking path, and what became of the site; called by {@link WikiUpdateRun.refuseStart} for the `failed` state it records.
 * @param refusal - The block found before the start.
 * @returns
 * - A `failed` refusal: its reason, marked as a Codebook sentence only when the refusal is and as one the site may be replaced after only when the refusal is, and the site `missing` when the folder held no Wiki, `kept` otherwise
 * - A conflict (one that names no path reaches here): a sentence Codebook wrote, since a conflict without a path could not tell the learner what to move, and the site `kept`
 * @example
 * refusalReason({ kind: 'failed', reason: 'No LLM Wiki exists yet.', isCodebookSentence: true, site: 'missing' }) // => { reason: 'No LLM Wiki exists yet.', isCodebookSentence: true, site: 'missing' }
 * refusalReason({ kind: 'conflict', paths: [], cause: 'edited-page' })                                            // => { reason: 'The update was blocked, but no blocking file was named.', isCodebookSentence: true, site: 'kept' }
 */
function refusalReason(
  refusal: WikiUpdateRefusal,
): Pick<
  Extract<WikiUpdateStatus, { state: 'failed' }>,
  'reason' | 'isCodebookSentence' | 'mayBeReplacedLater' | 'site'
> {
  if (refusal.kind === 'failed')
    return {
      reason: refusal.reason,
      ...marksOfRefusal(refusal),
      site: refusal.site ?? 'kept',
    }
  return {
    reason: WIKI_UPDATE_UNNAMED_BLOCK_REASON,
    isCodebookSentence: true,
    site: 'kept',
  }
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
 * const output = { outputDirectory: '/repo/.codebook/wiki', outputLabel: '.codebook/wiki' }
 * run.begin('vscode', output, 900_000, false) // => true
 * run.begin('vscode', output, 900_000, false) // => false while running
 * run.end({ state: 'succeeded', identity: 'a1b2c3d4e5f6+0f9e8d7c', revision: 'a1b2c3d4e5f6', index: '0f9e8d7c' })
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

  /** Starts a run unless one is active. @param host - Editor host that runs it. @param output - Resolved Wiki folder and its label. @param timeoutMs - Bound after which the run ends as timed out; shown to the learner. @param isOutputOutsideProject - Whether the Wiki folder lies outside the opened project; the running line of a VS Code update then says that the chat asks to approve each step. @returns False when a run is already active. @example run.begin('cursor', { outputDirectory: '/repo/.codebook/wiki', outputLabel: '.codebook/wiki' }, 900_000, false) */
  begin(
    host: WikiUpdateHost,
    output: WikiUpdateOutput,
    timeoutMs: number,
    isOutputOutsideProject: boolean,
  ): boolean {
    if (this.isRunning()) return false
    this.#status = {
      state: 'running',
      host,
      startedAt: this.#now().toISOString(),
      timeoutMs,
      candidateStaged: false,
      ...(isOutputOutsideProject ? { isOutputOutsideProject: true } : {}),
      ...output,
    }
    return true
  }

  /** Notes that the agent has staged a candidate site, so the page can say work is under way. Ignored when no run is active. @example run.markCandidateStaged() */
  markCandidateStaged(): void {
    if (this.#status.state !== 'running') return
    this.#status = { ...this.#status, candidateStaged: true }
  }

  /**
   * Ends the active run with the result {@link classifyWikiUpdateEnd} decided and adds what the run itself knows: host, time, output and, for a timeout, the bound.
   *
   * A result for no active run is ignored, so a late callback cannot overwrite a newer state. A conflict that names no path is recorded as a failure, since a conflict must name a path.
   *
   * @param result - How the run ended.
   * @example
   * ```ts
   * run.end({ state: 'cancelled', site: 'kept' })
   * run.end({ state: 'conflict', paths: ['notes/mine.md'], cause: 'learner-file', site: 'kept' })
   * ```
   */
  end(result: WikiUpdateEnd): void {
    if (this.#status.state !== 'running') return
    this.#status = endedStatus(this.#status, this.#now().toISOString(), result)
  }

  /** Records that nothing needed updating; no run starts. @param output - Resolved Wiki folder and its label. @param published - What the current site is called. @param areAddedFilesUnchecked - Whether the project has no Git repository, so "current" covers the indexed sources only; the state then says so. @example run.alreadyCurrent({ outputDirectory: '/repo/.codebook/wiki', outputLabel: '.codebook/wiki' }, { identity: 'a1b2c3d4e5f6+0f9e8d7c', revision: 'a1b2c3d4e5f6', index: '0f9e8d7c' }, false) */
  alreadyCurrent(
    output: WikiUpdateOutput,
    published: WikiPublishedIdentity,
    areAddedFilesUnchecked: boolean,
  ): void {
    if (this.isRunning()) return
    this.#status = {
      state: 'already-current',
      finishedAt: this.#now().toISOString(),
      ...(areAddedFilesUnchecked ? { addedFilesUnchecked: true } : {}),
      ...published,
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
            ...refusalReason(refusal),
            ...output,
          }
  }
}
