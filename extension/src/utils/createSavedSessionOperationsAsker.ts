import type { SavedSessionOperationsQuestion } from '../operationsConfirmationTypes'

import type { ShowModalQuestion } from './askToSendStateChangingRequest'
import { describeSavedSessionOperations } from './describeSavedSessionOperations'
import { untilAborted } from './untilAborted'

/**
 * Makes the asker that shows the saved-session operations modal; every ask has its own modal and token, so an answer to a modal Codebook stopped waiting for can never approve a later one (ENG-6).
 * Called once by the environment; the service awaits the result before operation 1 is sent.
 * @param show - The editor's modal question ({@link ShowModalQuestion}).
 * @returns The asker `(question, signal, onLateAnswer)`:
 * - `true` only when the learner chose the primary button before the signal aborted
 * - `false` for Cancel, a dismissal, or an abort (also one that came first, which shows no modal); an answer after the abort goes to `onLateAnswer`
 * - rejects when the modal itself failed without an abort
 * @example
 * const ask = createSavedSessionOperationsAsker(show)
 * await ask(question, signal) // => true after "Run 4 operations"
 */
export function createSavedSessionOperationsAsker(show: ShowModalQuestion) {
  return async (
    question: SavedSessionOperationsQuestion,
    signal: AbortSignal,
    onLateAnswer?: (confirmed: boolean) => void,
  ): Promise<boolean> => {
    if (signal.aborted) return false
    const { message, detail, confirmLabel } =
      describeSavedSessionOperations(question)
    const shown = Promise.resolve(show(message, detail, confirmLabel))
    try {
      return (await untilAborted(shown, signal)) === confirmLabel
    } catch (error) {
      if (!signal.aborted) throw error
      // The editor cannot close the modal; its later answer is reported, never used.
      shown.then(
        (choice) => onLateAnswer?.(choice === confirmLabel),
        () => undefined,
      )
      return false
    }
  }
}
