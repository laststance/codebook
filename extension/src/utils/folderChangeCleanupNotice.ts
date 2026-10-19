import { SET_UP_AI_CHAT_COMMAND } from './startOverBy'
import { thrownMessage } from './thrownMessage'
import { withFinalPeriod } from './withFinalPeriod'

/**
 * One step of the extension's handling of changed workspace folders that can fail, in the order the handling runs them.
 * A stop of the agent server that threw is one of two steps: `server-still-owned` when the server's resources could not be released, so that only Stop Agent Server ends it, and `server-stopped` when the server is gone and a later part of its stop failed (its last history save, for example).
 */
export type FolderChangeCleanupStep =
  | 'chat-setup'
  | 'server-still-owned'
  | 'server-stopped'
  | 'repository-reader'
  | 'study-reader'
  | 'new-readers'
  | 'wiki-reader'

/** A step of the handling of changed workspace folders that failed, with what it threw. */
export interface FolderChangeCleanupFailure {
  step: FolderChangeCleanupStep
  thrown: unknown
}

/** What the notice says of each failed step: what could not be done, followed by the cause, and the learner's next step where the failure leaves one. */
const STEP_SENTENCES: Record<
  FolderChangeCleanupStep,
  { whatFailed: string; nextStep?: string }
> = {
  'chat-setup': {
    whatFailed: 'The saved AI chat setup could not be cleared',
    nextStep: `It is still in use; run ${SET_UP_AI_CHAT_COMMAND} to replace it.`,
  },
  'server-still-owned': {
    whatFailed: 'The agent server could not be stopped completely',
    nextStep: 'Run Codebook: Stop Agent Server again before you start it.',
  },
  'server-stopped': {
    whatFailed:
      'The agent server was stopped, but not all of its cleanup was done',
  },
  'repository-reader': {
    whatFailed: 'The Repository Wiki reader could not be closed',
  },
  'study-reader': { whatFailed: 'The Study workspace could not be closed' },
  'new-readers': {
    whatFailed: "Codebook's readers could not be made again",
    nextStep: 'The next Codebook command makes them.',
  },
  'wiki-reader': {
    whatFailed: 'The DeepWiki reader in the browser could not be closed',
  },
}

/** The steps after whose failure a pane of the closed reader may still be open. */
const STEPS_THAT_MAY_LEAVE_A_PANE: ReadonlySet<FolderChangeCleanupStep> =
  new Set(['repository-reader', 'study-reader'])

/**
 * Words the error notice a learner reads when the handling of changed workspace folders could not finish every step; called by {@link activate} once that handling has run all of its steps.
 *
 * Why: one sentence, "Codebook cleanup incomplete: Error: …", used to tell every such failure. It did not say which step failed, that Codebook goes on with new readers, nor what to do with a pane that stayed open, and it was shown for failures after which Codebook did not go on at all. Each failed step now has its own sentence with its cause and, where the failure leaves one, its next step; the closing sentences are added only where they are true.
 *
 * @param failures - The steps that failed, in the order the handling ran them; at least one.
 * @returns The notice: the opening, one sentence a failed step (what could not be done, the cause as its message with one full stop, the next step if any), "Codebook goes on with new readers." unless the readers could not be made again, and the sentence about a pane that stayed open when a reader could not be closed.
 *
 * @example
 * ```ts
 * folderChangeCleanupNotice([{ step: 'study-reader', thrown: new Error('The panes could not be closed.') }])
 * // => "Codebook did not finish its cleanup after the workspace's folders changed. The Study workspace could not be closed: The panes could not be closed. Codebook goes on with new readers. If a Codebook pane stayed open, close it by hand."
 * folderChangeCleanupNotice([{ step: 'server-still-owned', thrown: new Error('Owned shutdown remains incomplete.') }])
 * // => "Codebook did not finish its cleanup after the workspace's folders changed. The agent server could not be stopped completely: Owned shutdown remains incomplete. Run Codebook: Stop Agent Server again before you start it. Codebook goes on with new readers."
 * ```
 */
export function folderChangeCleanupNotice(
  failures: readonly FolderChangeCleanupFailure[],
): string {
  const sentences = [
    "Codebook did not finish its cleanup after the workspace's folders changed.",
    ...failures.map(({ step, thrown }) => {
      const { whatFailed, nextStep } = STEP_SENTENCES[step]
      const failure = `${whatFailed}: ${withFinalPeriod(thrownMessage(thrown))}`
      return nextStep ? `${failure} ${nextStep}` : failure
    }),
  ]
  // Readers that could not be made again are told by their own sentence; every other failure leaves new readers behind.
  if (!failures.some(({ step }) => step === 'new-readers'))
    sentences.push('Codebook goes on with new readers.')
  if (failures.some(({ step }) => STEPS_THAT_MAY_LEAVE_A_PANE.has(step)))
    sentences.push('If a Codebook pane stayed open, close it by hand.')
  return sentences.join(' ')
}
