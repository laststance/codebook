import { SAVED_SESSION_CONFIRMATION_VALUE_LIMIT_CHARS } from '../constants'
import type { SavedSessionOperationsQuestion } from '../operationsConfirmationTypes'

import { cutTextToLength } from './cutTextToLength'

/** Format characters (bidirectional overrides and isolates, zero-width characters, the byte order mark, soft hyphens): invisible in the modal, yet able to reorder or hide what the learner reads. */
const FORMAT_CHARACTERS = /\p{Cf}/gu
/** Runs of whitespace and control characters (C0, DEL, C1, the line and paragraph separators): each run reads as one space, so an outside text can neither start a line of its own nor hide behind a control. */
const SPACE_OR_CONTROL_RUNS = /[\s\p{Cc}]+/gu

/**
 * Puts a text that comes from outside Codebook on one plain line, so a repository-authored title, value or entry path, a page's option label or the workspace folder's name cannot fake a line of the modal, reorder it or hide part of what the learner confirms.
 * @param text - A declared title, value or entry path, an option label or the repository name.
 * @returns The text without format characters, with every run of whitespace and control characters as one space, trimmed.
 * @example plainLine('Pay‮evil​\nnow') // => 'Payevil now'
 */
function plainLine(text: string): string {
  return text
    .replace(FORMAT_CHARACTERS, '')
    .replace(SPACE_OR_CONTROL_RUNS, ' ')
    .trim()
}

/**
 * Puts a title or value on one plain line and bounds it, so a multi-line, huge or invisibly formatted declared text cannot fill or spoof the modal.
 * @param text - The declared title or the resolved value.
 * @returns The text as {@link plainLine} gives it, cut with an ellipsis past the limit; removed format characters count toward no limit.
 * @example oneLine('a\n  b') // => 'a b'
 */
function oneLine(text: string): string {
  const plain = plainLine(text)
  return plain.length > SAVED_SESSION_CONFIRMATION_VALUE_LIMIT_CHARS
    ? `${cutTextToLength(plain, SAVED_SESSION_CONFIRMATION_VALUE_LIMIT_CHARS)}…`
    : plain
}

/**
 * Words the native modal that asks the learner to confirm the operations of a run that uses the saved session (DES-4).
 * Called by {@link createSavedSessionOperationsAsker} right before the editor shows the modal; pure so the text is testable.
 * The entry page was already loaded with the saved session when the modal shows, so its line says so instead of implying nothing ran yet.
 * Every interpolated text (repository, entry path, titles, values, option labels) passes through {@link plainLine}; titles and values are also bounded.
 * @param question - The run's repository, entry page and one resolved line per operation.
 * @returns The modal `message`, its `detail` (the opened page, the two data sentences, one numbered line per operation) and the primary button's `confirmLabel`.
 * @example
 * describeSavedSessionOperations({ runId: 'r1', repository: 'shop', entryPath: '/cart', operations: [{ index: 1, kind: 'click', title: 'Pay' }] })
 * // => { message: 'Run 1 operation in shop as your saved session?', detail: 'Page already opened with your saved session: /cart\n…\n1. click Pay', confirmLabel: 'Run 1 operation' }
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
    message: `Run ${noun} in ${plainLine(question.repository)} as your saved session?`,
    detail: [
      `Page already opened with your saved session: ${plainLine(question.entryPath)}`,
      "Changes this run makes to the app's data are real; the replay does not undo them.",
      'The app keeps the data it already had.',
      ...lines,
    ].join('\n'),
    confirmLabel: `Run ${noun}`,
  }
}
