import {
  NODE_SERVER_EVENT_SHORT_TEXT_LIMIT_CHARS,
  NODE_SERVER_MODAL_RUN_ID_CHARS,
} from '../constants'

/** The label of the modal's one button; the editor adds Cancel itself. */
const SEND_LABEL = 'Send'

/** The editor's modal question: the caller shows `message` with `detail` as a modal (`{ modal: true }`) offering `items`, and resolves with the chosen item, or `undefined` for Cancel or a dismissal. */
export type ShowModalQuestion = (
  message: string,
  detail: string,
  ...items: string[]
) => PromiseLike<string | undefined>

/** The request a modal asks about: the run that declared it and its whole declaration, so a shared modal answers exactly this request of this run. */
export type StateChangingRequestQuestion = {
  runId: string
  method: string
  path: string
  contentType?: string
  body?: string
}

/**
 * Describes the body a confirmation asks about by its size and content type, never its content (it may hold secrets).
 * Called by the asker when it words the modal's detail.
 * @param request - The request the modal asks about.
 * @returns
 * - `The request has no body.` when it declares none
 * - `The request body is <n> bytes of <content type>.` otherwise (`unspecified content type` when none is declared)
 * @example describeRequestBody({ runId: 'r', method: 'POST', path: '/x', contentType: 'application/json', body: '{}' }) // => 'The request body is 2 bytes of application/json.'
 */
function describeRequestBody(request: StateChangingRequestQuestion): string {
  if (request.body === undefined) return 'The request has no body.'
  const type = request.contentType?.slice(
    0,
    NODE_SERVER_EVENT_SHORT_TEXT_LIMIT_CHARS,
  )
  return `The request body is ${Buffer.byteLength(request.body)} bytes of ${type || 'unspecified content type'}.`
}

/**
 * Makes the question the environment asks before a state-changing request of a node-server run is sent: a native modal that names the method, path, content type and body size (never the body) and says the server uses the repository's own configured database. The chat AI cannot answer it (TD-6).
 * The editor offers no way to close a modal, so one whose caller gave up (no answer within the bound, a cancelled run) stays on screen. A retry of the same run's same declared request therefore joins that modal instead of opening a second one, also after another run asked, and the learner's single answer belongs to the retry; another run, or another method, path, content type or body, asks in its own modal, which names its run; a click on Send with no retry waiting changes nothing.
 * Called once by the environment; the service awaits the result before it sends the request (D6).
 * @param show - The editor's modal question ({@link ShowModalQuestion}).
 * @returns The asker: `(request, signal)` resolves `true` only when the learner chose Send; `false` for Cancel, a dismissal, an abort (also one that came first, which shows no modal). Its abort listener is removed once it settles.
 * @example
 * const ask = createStateChangingRequestAsker(show)
 * await ask({ runId: 'r1', method: 'POST', path: '/api/items' }, signal) // => true after Send
 */
export function createStateChangingRequestAsker(show: ShowModalQuestion) {
  // The modals still showing, by the run and request each asks about.
  const open = new Map<string, Promise<string | undefined>>()
  return async (
    request: StateChangingRequestQuestion,
    signal: AbortSignal,
  ): Promise<boolean> => {
    if (signal.aborted) return false
    const key = JSON.stringify([
      request.runId,
      request.method,
      request.path,
      request.contentType ?? null,
      request.body ?? null,
    ])
    let choice = open.get(key)
    if (!choice) {
      const shown = Promise.resolve(
        show(
          `Send ${request.method} ${request.path} to the repository's server?`,
          `Codebook will send this ${request.method} request once, to the server it started for run ${request.runId.slice(0, NODE_SERVER_MODAL_RUN_ID_CHARS)}, and nothing else. ${describeRequestBody(request)} The server uses the repository's own configured database, so the request may change its data. Use a local or test database. If this question stays after Codebook gave up waiting, Cancel it: a new request asks again.`,
          SEND_LABEL,
        ),
      )
      choice = shown
      open.set(key, shown)
      void shown.finally(() => {
        if (open.get(key) === shown) open.delete(key)
      })
    }
    let onAbort = (): void => {}
    const aborted = new Promise<undefined>((resolve) => {
      onAbort = (): void => resolve(undefined)
      signal.addEventListener('abort', onAbort, { once: true })
    })
    try {
      return (await Promise.race([choice, aborted])) === SEND_LABEL
    } finally {
      signal.removeEventListener('abort', onAbort)
    }
  }
}
