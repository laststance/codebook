import { SAVED_SESSION_CONFIRMATION_VALUE_LIMIT_CHARS } from '../constants'
import type { SavedSessionOperationsQuestion } from '../operationsConfirmationTypes'

import { cutTextToLength } from './cutTextToLength'

/**
 * Puts a title or value on one line and bounds it, so a multi-line or huge declared text cannot fill the modal.
 * @param text - The declared title or the resolved value.
 * @returns The text with whitespace runs collapsed to one space, trimmed, and cut with an ellipsis past the limit.
 * @example oneLine('a\n  b') // => 'a b'
 */
function oneLine(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  return collapsed.length > SAVED_SESSION_CONFIRMATION_VALUE_LIMIT_CHARS
    ? `${cutTextToLength(collapsed, SAVED_SESSION_CONFIRMATION_VALUE_LIMIT_CHARS)}…`
    : collapsed
}

/**
 * Words the native modal that asks the learner to confirm the operations of a run that uses the saved session (DES-4).
 * Called by {@link createSavedSessionOperationsAsker} right before the editor shows the modal; pure so the text is testable.
 * @param question - The run's repository, entry page and one resolved line per operation.
 * @returns The modal `message`, its `detail` (page, the two data sentences, one numbered line per operation) and the primary button's `confirmLabel`.
 * @example
 * describeSavedSessionOperations({ runId: 'r1', repository: 'shop', entryPath: '/cart', operations: [{ index: 1, kind: 'click', title: 'Pay' }] })
 * // => { message: 'Run 1 operation in shop as your saved session?', detail: 'Page: /cart\n…\n1. click Pay', confirmLabel: 'Run 1 operation' }
 */
export function describeSavedSessionOperations(
  question: SavedSessionOperationsQuestion,
): { message: string; detail: string; confirmLabel: string } {
  const count = question.operations.length
  const noun = `${count} operation${count === 1 ? '' : 's'}`
  const lines = question.operations.map((line) => {
    const value = line.value === undefined ? '' : `: ${oneLine(line.value)}`
    return `${line.index}. ${line.kind} ${oneLine(line.title)}${value}`
  })
  return {
    message: `Run ${noun} in ${question.repository} as your saved session?`,
    detail: [
      `Page: ${question.entryPath}`,
      "Changes this run makes to the app's data are real; the replay does not undo them.",
      'The app keeps the data it already had.',
      ...lines,
    ].join('\n'),
    confirmLabel: `Run ${noun}`,
  }
}
