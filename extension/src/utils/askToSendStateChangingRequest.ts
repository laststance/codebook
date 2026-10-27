/** The label of the modal's one button; the editor adds Cancel itself. */
const SEND_LABEL = 'Send'

/** The editor's modal question: the caller shows `message` with `detail` as a modal (`{ modal: true }`) offering `items`, and resolves with the chosen item, or `undefined` for Cancel or a dismissal. */
export type ShowModalQuestion = (
  message: string,
  detail: string,
  ...items: string[]
) => PromiseLike<string | undefined>

/**
 * Asks the learner in a native modal whether to send a state-changing request (POST, PUT, PATCH or DELETE) of a node-server run: the modal names the method and path and says the server uses the repository's own configured database. The chat AI cannot answer it (TD-6).
 * Called by the environment's `confirmStateChangingRequest`, which the service awaits before it sends the request (D6).
 * @param show - The editor's modal question ({@link ShowModalQuestion}).
 * @param request - The declared method and path.
 * @param signal - Aborts the question when the learner does not answer within the pause-hold bound or the run is cancelled.
 * @returns `true` only when the learner chose Send; `false` for Cancel, a dismissal, an abort (also one that came first, which shows no modal).
 * @example
 * await askToSendStateChangingRequest(vscode.window.showWarningMessage, { method: 'POST', path: '/api/items' }, signal) // => true after Send
 */
export async function askToSendStateChangingRequest(
  show: ShowModalQuestion,
  request: { method: string; path: string },
  signal: AbortSignal,
): Promise<boolean> {
  if (signal.aborted) return false
  const aborted = new Promise<undefined>((resolve) => {
    signal.addEventListener('abort', () => resolve(undefined), { once: true })
  })
  const choice = await Promise.race([
    show(
      `Send ${request.method} ${request.path} to the repository's server?`,
      `Codebook will send this ${request.method} request once, to the server it started for this run, and nothing else. The server uses the repository's own configured database, so the request may change its data. Use a local or test database.`,
      SEND_LABEL,
    ),
    aborted,
  ])
  return choice === SEND_LABEL
}
