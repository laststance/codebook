/** What {@link describeApiRequestSentence} words: one API pause's attribution outcome. */
export type ApiRequestSentenceInput =
  | {
      state: 'attributed'
      method: string
      path: string
      operation: number
      title: string
    }
  | { state: 'unattributed'; reason: 'none' | 'several'; count: number }

/**
 * Words the sentence a server (API) pause carries about the page request that waited for it.
 *
 * Why it exists: the chat relays this sentence instead of wording a time-window match itself (DX-5, with the OV-2 amendment that `none` claims no cause). Called by {@link ApiRequestTracker}'s `attribute` and by anything that must render the same sentence again.
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
  if (input.state === 'attributed')
    return `While the API paused here, the page's ${input.method} ${input.path}, sent after operation ${input.operation} "${input.title}", was the only request waiting for it; Codebook matched it by time and did not read it inside the API.`
  // None: no cause is claimed, because a request from before the window may be the cause (OV-2).
  if (input.reason === 'none')
    return "Codebook observed no request from the page that started in this operation's window and was still open when the API paused, so it cannot say what made the API reach this line."
  return `${input.count} requests from the page were waiting when the API paused here, so Codebook does not say which one reached this line.`
}
