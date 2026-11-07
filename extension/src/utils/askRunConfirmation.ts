import type { ShowModalQuestion } from './askToSendStateChangingRequest'

/** What one run-confirmation modal says. */
export type RunConfirmationModal = {
  /** The modal's message line. */
  title: string
  /** The modal's detail text. */
  detail: string
  /** The label of the modal's one button; the editor adds Cancel itself. */
  label: string
  /** The run's short id, named in the late-answer notice. */
  shortRunId: string
}

/**
 * Shows one native modal question for a run and answers `true` only when the learner chose the button while the run still waited.
 *
 * Why it exists: the `node-script` run and the Vite library run ask the learner the same kind of question before anything runs (the build and the run's code do real effects), and both need the same race: an abort answers `false` at once, and the editor offers no way to close a modal, so one whose run stopped waiting stays on screen and its late answer only shows a notice.
 * Called by {@link createNodeScriptRunAsker} and {@link createViteLibraryRunAsker}.
 *
 * @param show - The editor's modal question.
 * @param notifyEnded - Shows the notice for a late answer; receives the run's short id.
 * @param modal - The words of the modal.
 * @param signal - Aborts the wait (a stop, a limit, a timeout).
 * @returns `true` only when the learner chose the button while the run still waited; `false` for Cancel, a dismissal, or an abort (also one that came first, which shows no modal).
 * @example
 * await askRunConfirmation(show, notify, { title: 'Run it?', detail: 'It does things.', label: 'Run once', shortRunId: 'r1' }, signal)
 */
export async function askRunConfirmation(
  show: ShowModalQuestion,
  notifyEnded: (shortRunId: string) => void,
  modal: RunConfirmationModal,
  signal: AbortSignal,
): Promise<boolean> {
  if (signal.aborted) return false
  let waiting = true
  const answered = Promise.resolve(
    show(modal.title, modal.detail, modal.label),
  ).then((choice) => {
    const accepted = choice === modal.label
    // A dialog whose run stopped waiting still gets its answer; it only says the run is over.
    if (!waiting && accepted) notifyEnded(modal.shortRunId)
    return accepted && waiting
  })
  let onAbort = (): void => undefined
  const aborted = new Promise<false>((resolve) => {
    onAbort = (): void => {
      waiting = false
      resolve(false)
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    return await Promise.race([answered, aborted])
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}
