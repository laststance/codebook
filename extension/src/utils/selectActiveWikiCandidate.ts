import { z } from 'zod'

import type { WikiCandidate } from './listWikiCandidates'

/** How this window's last Wiki update of one output ended, as much as the next start needs to know. It is kept in the workspace state, so a reloaded window still has it; the schema reads it back. */
export const wikiLastRunSchema = z.object({
  /** Canonical Wiki output folder the run updated; the record says nothing about any other output. */
  outputDirectory: z.string(),
  /** When the run started (epoch milliseconds); a candidate written before it is not this run's. */
  startedAtMs: z.number(),
  /** When the run ended (epoch milliseconds). */
  endedAtMs: z.number(),
  /** Whether the agent may still be working after the run ended: true only for a VS Code watch that stopped before its chat did ({@link mayWikiChatStillPublish}: cancelled, timed out, ended on a learner's file, or broke off), since stopping the watch does not stop the chat. */
  mayAgentStillWork: z.boolean(),
  /** Folder names of the candidates the run's looks saw that were written since its start; the next start tells the chat's own publish by them ({@link hasWikiPublishEndedWait}). Absent in a record an earlier version kept, which then counts as a run that saw none. */
  candidateNames: z.array(z.string()).optional(),
})

/** The record {@link wikiLastRunSchema} describes. */
export type WikiLastRun = z.infer<typeof wikiLastRunSchema>

/** What {@link selectActiveWikiCandidate} is told besides the candidates: the clock, the bound of "recent" and this window's last run. */
type ActiveCandidateOptions = {
  nowMs: number
  activeWithinMs: number
  lastRun: WikiLastRun | undefined
}

/**
 * Says whether a candidate is what this window's own finished run left behind; called by {@link blocksStart} for a recent candidate.
 * @param candidate - A candidate bound to this Wiki.
 * @param lastRun - How this window's last run of this output ended; undefined when it has had none.
 * @returns `true` only for a candidate written while that run lasted, by an agent that has stopped; `false` without a run, when the agent may still work, and for a candidate written before the run began or after it ended.
 * @example
 * isOwnLeftover({ name: 'wiki.stage-1', writtenAtMs: 1_500, ownedPaths: [] }, { outputDirectory: '/repo/.codebook/wiki', startedAtMs: 1_000, endedAtMs: 2_000, mayAgentStillWork: false }) // => true
 */
function isOwnLeftover(
  candidate: WikiCandidate,
  lastRun: WikiLastRun | undefined,
): boolean {
  // Only a candidate written while this window's run lasted, by an agent that has stopped, is known to be nobody's work in progress.
  return (
    lastRun !== undefined &&
    !lastRun.mayAgentStillWork &&
    candidate.writtenAtMs >= lastRun.startedAtMs &&
    candidate.writtenAtMs <= lastRun.endedAtMs
  )
}

/**
 * Says whether a candidate shows work in progress that is not this window's own; called by {@link selectActiveWikiCandidate} for each candidate.
 * @param candidate - A candidate bound to this Wiki.
 * @param options - The clock, the bound of "recent" and this window's last run.
 * @returns `true` for a candidate written less than `activeWithinMs` ago that is no leftover of this window's finished run ({@link isOwnLeftover}).
 * @example
 * blocksStart({ name: 'wiki.stage-1', writtenAtMs: 1_000_000, ownedPaths: [] }, { nowMs: 1_060_000, activeWithinMs: 900_000, lastRun: undefined }) // => true
 */
function blocksStart(
  candidate: WikiCandidate,
  options: ActiveCandidateOptions,
): boolean {
  // The wait for a candidate is over at its writing plus the bound, as the wait for a stopped watch is at its end plus the bound: a press at that moment is not refused.
  const isRecent =
    options.nowMs < candidate.writtenAtMs + options.activeWithinMs
  return isRecent && !isOwnLeftover(candidate, options.lastRun)
}

/**
 * Says whether a candidate was written after the latest one found so far; called by {@link selectActiveWikiCandidate} for each candidate that blocks the start.
 * @param candidate - A candidate that blocks the start.
 * @param latest - The latest blocking candidate found so far; undefined before the first.
 * @returns `true` for the first blocking candidate and for one written later than `latest`; a candidate written at the same time does not replace it.
 * @example
 * isWrittenAfter({ name: 'wiki.stage-2', writtenAtMs: 2_000, ownedPaths: [] }, { name: 'wiki.stage-1', writtenAtMs: 1_000, ownedPaths: [] }) // => true
 */
function isWrittenAfter(
  candidate: WikiCandidate,
  latest: WikiCandidate | undefined,
): boolean {
  return !latest || candidate.writtenAtMs > latest.writtenAtMs
}

/**
 * Picks the candidate that shows someone is still updating this Wiki: another editor window, an earlier chat, or the chat this window stopped watching.
 *
 * Why: each window holds its own run state, so a second window (or a retry after "Stopped watching") would start a second agent beside one that is still working; the candidate that agent staged is the only trace this window can see. A candidate's owner is told from the last run's record alone: it is this window's own only when it was written while that run of this output lasted.
 * Trigger: the extension calls it when an update starts, after the checks of the folder and before the run begins.
 *
 * @param candidates - Candidates bound to this Wiki ({@link listWikiCandidates}).
 * @param options.nowMs - Current time in epoch milliseconds.
 * @param options.activeWithinMs - How recently a candidate must have been written to count as work in progress (the watch bound); one written exactly that long ago no longer counts.
 * @param options.lastRun - How this window's last run of this output ended; undefined when it has had none (the caller passes none for a record of another output).
 * @returns The most recently written candidate that blocks the start, or undefined when the start may go ahead:
 * - A candidate written `activeWithinMs` ago or longer never blocks
 * - A candidate written while the last run lasted is this window's own leftover and does not block, unless the agent may still work (a VS Code watch that stopped before its chat did): then it blocks, like one written after the watch stopped
 * - Any other recent candidate (written before the last run began, after it ended, or without any run of this window) is somebody else's and blocks
 *
 * @example
 * ```ts
 * selectActiveWikiCandidate(
 *   [{ name: 'wiki.stage-1', writtenAtMs: 1_000_000, ownedPaths: [] }],
 *   { nowMs: 1_060_000, activeWithinMs: 900_000, lastRun: undefined },
 * ) // => { name: 'wiki.stage-1', writtenAtMs: 1_000_000, ownedPaths: [] }
 * ```
 */
export function selectActiveWikiCandidate(
  candidates: WikiCandidate[],
  options: ActiveCandidateOptions,
): WikiCandidate | undefined {
  let latest: WikiCandidate | undefined
  for (const candidate of candidates)
    if (blocksStart(candidate, options) && isWrittenAfter(candidate, latest))
      latest = candidate
  return latest
}
