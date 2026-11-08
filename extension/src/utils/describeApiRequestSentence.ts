import type { ApiRequestWatched } from '../configuredStudySchemas'

/** What {@link describeApiRequestSentence} words: one API pause's attribution outcome. */
export type ApiRequestSentenceInput =
  | {
      state: 'attributed'
      method: string
      path: string
      operation: number
      title: string
      /** The declared prefix the page's request was sent under; present only for the dev-server proxy route. */
      proxyPath?: string
    }
  | {
      state: 'unattributed'
      reason: 'none' | 'several'
      count: number
      /** What a proxy-aware run watched; the `none` sentence names it. */
      watched?: ApiRequestWatched
    }

/**
 * Words what a proxy-aware run watched, from ports and declared prefixes only.
 *
 * Why it exists: the `none` sentence of a `vite-dev` run must say which requests it could have seen, so "no request" is not read as "no request anywhere". Called by {@link describeApiRequestSentence}.
 * @param watched - The structured `watched` of an unattributed fact.
 * @returns For example `the API on port 4000 and the dev server on port 3010 under /api`.
 * @example
 * ```ts
 * describeWatched({ apiPort: 4000, devServerPort: 3010, proxyPaths: ['/api'] })
 * // => 'the API on port 4000 and the dev server on port 3010 under /api'
 * ```
 */
function describeWatched(watched: ApiRequestWatched): string {
  const api = `the API on port ${watched.apiPort}`
  // No declared prefix: only the API origin is watched.
  if (watched.proxyPaths.length === 0) return api
  const server =
    watched.devServerPort === undefined
      ? 'the dev server'
      : `the dev server on port ${watched.devServerPort}`
  return `${api} and ${server} under ${watched.proxyPaths.join(', ')}`
}

/**
 * Words the sentence a server (API) pause carries about the page request that waited for it.
 *
 * Why it exists: the chat relays this sentence instead of wording a time-window match itself (DX-5, with the OV-2 amendment that `none` claims no cause). Called by {@link apiRequestFactOf} and by anything that must render the same sentence again.
 * @param input - The outcome; `path` must already be masked by the caller.
 * @returns The ready sentence.
 * @example
 * ```ts
 * describeApiRequestSentence({ state: 'unattributed', reason: 'several', count: 2 })
 * // => '2 requests from the page were waiting when the API paused here, so Codebook does not say which one reached this line.'
 * ```
 */
export function describeApiRequestSentence(
  input: ApiRequestSentenceInput,
): string {
  // Attributed: matched by time only; never claim the API read the request.
  if (input.state === 'attributed') {
    // Proxied: the forward is a declared relation, never an observed one.
    if (input.proxyPath !== undefined)
      return `While the API paused here, the page's ${input.method} ${input.path}, sent to the dev server after operation ${input.operation} "${input.title}" under ${input.proxyPath}, which apiServer.proxyPaths declares as forwarded to the API, was the only request waiting for it; Codebook matched it by time and did not observe the forward or read the request inside the API.`
    return `While the API paused here, the page's ${input.method} ${input.path}, sent after operation ${input.operation} "${input.title}", was the only request waiting for it; Codebook matched it by time and did not read it inside the API.`
  }
  // None: no cause is claimed, because a request from before the window may be the cause (OV-2).
  if (input.reason === 'none') {
    if (input.watched)
      return `Among the requests it watches (${describeWatched(input.watched)}), Codebook observed none from the page that started in this operation's window and was still open when the API paused, so it cannot say what made the API reach this line.`
    return "Codebook observed no request from the page that started in this operation's window and was still open when the API paused, so it cannot say what made the API reach this line."
  }
  return `${input.count} requests from the page were waiting when the API paused here, so Codebook does not say which one reached this line.`
}
