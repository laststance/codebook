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
  /** Whether the agent may still be working after the run ended: true only for a VS Code watch that was cancelled or timed out, since stopping the watch does not stop the chat. */
  mayAgentStillWork: z.boolean(),
})

/** The record {@link wikiLastRunSchema} describes. */
export type WikiLastRun = z.infer<typeof wikiLastRunSchema>

/**
 * Picks the candidate that shows someone is still updating this Wiki: another editor window, an earlier chat, or the chat this window stopped watching.
 *
 * Why: each window holds its own run state, so a second window (or a retry after "Stopped watching") would start a second agent beside one that is still working; the candidate that agent staged is the only trace this window can see. A candidate's owner is told from the last run's record alone: it is this window's own only when it was written while that run of this output lasted.
 * Trigger: the extension calls it when an update starts, after the checks of the folder and before the run begins.
 *
 * @param candidates - Candidates bound to this Wiki ({@link listWikiCandidates}).
 * @param options.nowMs - Current time in epoch milliseconds.
 * @param options.activeWithinMs - How recently a candidate must have been written to count as work in progress (the watch bound).
 * @param options.lastRun - How this window's last run of this output ended; undefined when it has had none (the caller passes none for a record of another output).
 * @returns The most recently written candidate that blocks the start, or undefined when the start may go ahead:
 * - A candidate older than `activeWithinMs` never blocks
 * - A candidate written while the last run lasted is this window's own leftover and does not block, unless the agent may still work (a cancelled or timed-out VS Code watch): then it blocks, like one written after the watch stopped
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
  options: {
    nowMs: number
    activeWithinMs: number
    lastRun: WikiLastRun | undefined
  },
): WikiCandidate | undefined {
  const { lastRun } = options
  let latest: WikiCandidate | undefined
  for (const candidate of candidates) {
    const isRecent =
      candidate.writtenAtMs >= options.nowMs - options.activeWithinMs
    // Only a candidate written while this window's run lasted, by an agent that has stopped, is known to be nobody's work in progress.
    const isOwnLeftover =
      lastRun !== undefined &&
      !lastRun.mayAgentStillWork &&
      candidate.writtenAtMs >= lastRun.startedAtMs &&
      candidate.writtenAtMs <= lastRun.endedAtMs
    if (
      isRecent &&
      !isOwnLeftover &&
      (!latest || candidate.writtenAtMs > latest.writtenAtMs)
    )
      latest = candidate
  }
  return latest
}
