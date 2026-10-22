import type { NodeTestHistorySummary } from '../nodeTestHistoryStore'

/** What a test replay shows the learner outside its Save, keyed by surface (the String catalog of plan version 7). */
export type NodeTestReplayMessage =
  | {
      kind: 'saved-row'
      summary: Pick<
        NodeTestHistorySummary,
        | 'status'
        | 'verification'
        | 'verdict'
        | 'stopCount'
        | 'explainedStopCount'
      >
    }
  | { kind: 'application-interim' }

/** The capture word of a sealed or interrupted history in its Saved studies row. */
const CAPTURE_WORDS = {
  complete: 'complete',
  partial: 'partial',
  interrupted: 'interrupted',
} as const

/**
 * Words what a test replay shows the learner outside its Save, so Saved studies and the Application pane read as the String catalog writes them; called by the Study workspace for each Saved studies row and by {@link capturedAppHtml} for a selected test replay.
 * A history this window still writes reads `recording`; one that fails verification reads `unavailable` beside its reason; a sealed or interrupted one names its verdict, its capture and how many of its stops the learning material explains.
 * @param message - The surface and what it shows.
 * @returns The words.
 * @example
 * describeNodeTestReplay({ kind: 'saved-row', summary: { status: 'complete', verification: 'verified', verdict: 'Test passed · exit code 0', stopCount: 2, explainedStopCount: 1 } })
 * // => 'Test replay · Test passed · exit code 0 · capture complete · 1 of 2 stops explained'
 */
export function describeNodeTestReplay(message: NodeTestReplayMessage): string {
  if (message.kind === 'application-interim')
    return 'Recorded test output for this test replay is in the Study pane.'
  const { summary } = message
  if (summary.verification === 'unavailable') return 'Test replay · unavailable'
  if (summary.status === 'recording') return 'Test replay · recording'
  return `Test replay · ${summary.verdict} · capture ${CAPTURE_WORDS[summary.status]} · ${summary.explainedStopCount} of ${summary.stopCount} stops explained`
}
