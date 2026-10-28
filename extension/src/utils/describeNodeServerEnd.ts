import type { NodeServerEndInput } from '../nodeServerHistoryWriter'

/** What {@link describeNodeServerEnd} reads of a run that ended. */
export type NodeServerEndFacts = {
  /** The run's own failure code (`SERVER_EXITED`, `PAUSE_HOLD_EXPIRED`, `RUNTIME_FAILED`, `PORT_IN_USE`, …), if the run ended with one. */
  failureCode?: string
  /** The exit the launcher journaled when the server's process ended, if it did. */
  exit?: { exitCode?: number | null; signal?: string | null }
  /** Milliseconds since launch at which the run ended. */
  elapsedMs: number
}

/**
 * Says how a node-server run ended for its history's `end` entry: stopped by Codebook (the learner, the chat or Save), closed on its own with its exit, or failed with a code.
 * Called by {@link StudyService} when it seals the history at the run's stop.
 * @param facts - The failure code, the journaled exit and the time.
 * @returns The `end` input: `closed` for a server that exited by itself, `failed` for any other failure code, `stopped` otherwise.
 * @example describeNodeServerEnd({ failureCode: 'SERVER_EXITED', exit: { exitCode: 1 }, elapsedMs: 800 }) // => { reason: 'closed', exitCode: 1, elapsedMs: 800 }
 */
export function describeNodeServerEnd(
  facts: NodeServerEndFacts,
): NodeServerEndInput {
  if (facts.failureCode === 'SERVER_EXITED')
    return {
      elapsedMs: facts.elapsedMs,
      reason: 'closed',
      ...(facts.exit?.exitCode === undefined
        ? {}
        : { exitCode: facts.exit.exitCode }),
      ...(facts.exit?.signal ? { signal: facts.exit.signal } : {}),
    }
  if (facts.failureCode)
    return {
      elapsedMs: facts.elapsedMs,
      reason: 'failed',
      code: facts.failureCode.slice(0, 128),
    }
  return { elapsedMs: facts.elapsedMs, reason: 'stopped' }
}
