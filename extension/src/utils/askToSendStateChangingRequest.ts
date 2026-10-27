/** The label of the modal's one button; the editor adds Cancel itself. */
const SEND_LABEL = 'Send'

/** The editor's modal question: the caller shows `message` with `detail` as a modal (`{ modal: true }`) offering `items`, and resolves with the chosen item, or `undefined` for Cancel or a dismissal. */
export type ShowModalQuestion = (
  message: string,
  detail: string,
  ...items: string[]
) => PromiseLike<string | undefined>

/**
 * Makes the question the environment asks before a state-changing request of a node-server run is sent: a native modal that names the method and path and says the server uses the repository's own configured database. The chat AI cannot answer it (TD-6).
 * The editor offers no way to close a modal, so one whose caller gave up (no answer within the bound, a cancelled run) stays on screen. A retry for the same request therefore joins that modal instead of opening a second one, and the learner's single answer belongs to the retry; a click on Send with no retry waiting changes nothing.
 * Called once by the environment; the service awaits the result before it sends the request (D6).
 * @param show - The editor's modal question ({@link ShowModalQuestion}).
 * @returns The asker: `(request, signal)` resolves `true` only when the learner chose Send; `false` for Cancel, a dismissal, an abort (also one that came first, which shows no modal). Its abort listener is removed once it settles.
 * @example
 * const ask = createStateChangingRequestAsker(show)
 * await ask({ method: 'POST', path: '/api/items' }, signal) // => true after Send
 */
export function createStateChangingRequestAsker(show: ShowModalQuestion) {
  // The modal still showing, by the request it asks about.
  let open: { key: string; choice: Promise<string | undefined> } | undefined
  return async (
    request: { method: string; path: string },
    signal: AbortSignal,
  ): Promise<boolean> => {
    if (signal.aborted) return false
    const key = `${request.method} ${request.path}`
    if (open?.key !== key) {
      const choice = Promise.resolve(
        show(
          `Send ${request.method} ${request.path} to the repository's server?`,
          `Codebook will send this ${request.method} request once, to the server it started for this run, and nothing else. The server uses the repository's own configured database, so the request may change its data. Use a local or test database. If this question stays after Codebook gave up waiting, Cancel it: a new request asks again.`,
          SEND_LABEL,
        ),
      )
      const shown = { key, choice }
      open = shown
      void choice.finally(() => {
        if (open === shown) open = undefined
      })
    }
    const joined = open?.choice
    let onAbort = (): void => {}
    const aborted = new Promise<undefined>((resolve) => {
      onAbort = (): void => resolve(undefined)
      signal.addEventListener('abort', onAbort, { once: true })
    })
    try {
      return (await Promise.race([joined, aborted])) === SEND_LABEL
    } finally {
      signal.removeEventListener('abort', onAbort)
    }
  }
}
