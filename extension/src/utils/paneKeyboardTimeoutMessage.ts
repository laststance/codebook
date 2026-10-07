import { MILLISECONDS_PER_SECOND } from '../constants'

/**
 * Words what a learner reads when a Codebook pane did not confirm the keyboard in time, for {@link StudyWorkspace}'s focus of a pane before an Arrange, an Enlarge, a focus request or the return of the keyboard after a presentation change.
 * The wait behind it ends with an internal description ("owned presentation inner focus"), which names nothing a learner can act on; this sentence says which pane was asked, how long Codebook waited, that nothing else was changed, and the next step.
 * @param pane - The pane that was asked, by the name its controls use: the Application pane or the Explanation pane (the `codebook · Study` tab).
 * @param timeoutMs - How long the reader waited for the pane's confirmation.
 * @returns The sentence, without a leading error name.
 * @example
 * paneKeyboardTimeoutMessage('Explanation', 5_000)
 * // => 'Codebook asked the Explanation pane to take the keyboard, and the pane did not confirm it within 5 seconds. The action was stopped there and nothing else was changed. Click into the Explanation pane and repeat the action.'
 */
export function paneKeyboardTimeoutMessage(
  pane: 'Application' | 'Explanation',
  timeoutMs: number,
): string {
  return `Codebook asked the ${pane} pane to take the keyboard, and the pane did not confirm it within ${timeoutMs / MILLISECONDS_PER_SECOND} seconds. The action was stopped there and nothing else was changed. Click into the ${pane} pane and repeat the action.`
}
