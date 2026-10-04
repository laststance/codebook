import type { WikiCandidate } from './listWikiCandidates'

/**
 * Picks the candidate that shows someone else is updating this Wiki right now: another editor window, or a chat this window stopped watching.
 *
 * Why: each window holds its own run state, so a second window (or a retry after "Stopped watching") would start a second agent beside one that is still working; the candidate that agent staged is the only trace this window can see.
 * Trigger: the extension calls it when an update starts, after the preflight and before the run begins.
 *
 * @param candidates - Candidates bound to this Wiki ({@link listWikiCandidates}).
 * @param options.nowMs - Current time in epoch milliseconds.
 * @param options.activeWithinMs - How recently a candidate must have been written to count as work in progress (the watch bound).
 * @param options.lastRunEndedAtMs - When this window's last run ended; undefined when it has had none. A candidate written before that is this window's own leftover and does not block a retry.
 * @returns The most recently written candidate that counts, or undefined when the start may go ahead.
 *
 * @example
 * ```ts
 * selectActiveWikiCandidate(
 *   [{ name: 'wiki.stage-1', writtenAtMs: 1_000_000, ownedPaths: [] }],
 *   { nowMs: 1_060_000, activeWithinMs: 900_000, lastRunEndedAtMs: undefined },
 * ) // => { name: 'wiki.stage-1', writtenAtMs: 1_000_000, ownedPaths: [] }
 * ```
 */
export function selectActiveWikiCandidate(
  candidates: WikiCandidate[],
  options: {
    nowMs: number
    activeWithinMs: number
    lastRunEndedAtMs: number | undefined
  },
): WikiCandidate | undefined {
  let latest: WikiCandidate | undefined
  for (const candidate of candidates) {
    const isRecent =
      candidate.writtenAtMs >= options.nowMs - options.activeWithinMs
    const isAfterOwnRun =
      options.lastRunEndedAtMs === undefined ||
      candidate.writtenAtMs > options.lastRunEndedAtMs
    if (
      isRecent &&
      isAfterOwnRun &&
      (!latest || candidate.writtenAtMs > latest.writtenAtMs)
    )
      latest = candidate
  }
  return latest
}
