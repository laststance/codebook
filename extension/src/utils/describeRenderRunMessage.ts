/** What the run knows about a render in progress, for {@link describeRenderRunMessage}. */
export type RenderRunMessageInput = {
  /** An entry-render pause is held now. */
  isEntryRenderPaused: boolean
  /** The run waits for the next stop of a set after a continue: the place of the awaited stop among the set's stops and the set's size. */
  waitingForNext?: { position: number; total: number }
  /** A Pages pause is held that Codebook could not prove to be inside the entry page's data function: the journal reason (`no-async-chain`, `no-renderer-frame`, `route-unreadable`, `chain-incomplete`, `verdict-error`). */
  unconfirmedReason?: string
}

/**
 * Words the run resource's message for a server render in progress (task 3a).
 * Called by {@link ConfiguredBrowserRun.view} so that the run resource, read by status, tells the chat what the render waits for.
 * @param input - The render's state.
 * @returns
 * - `The server render of the entry page is paused; the page finishes loading after you continue. Stop it with codebook_stop if you do not continue.` while an entry-render pause is held
 * - `Waiting for the next stop of this render (<n> of <m>).` after a continue inside a set of render stops
 * - for a held Pages pause that is unconfirmed, a sentence that says Codebook could not establish that the pause is inside the entry page's data function, with the reason, before the sentence above when both apply
 * - `undefined` otherwise
 * @example
 * describeRenderRunMessage({ isEntryRenderPaused: false, waitingForNext: { position: 2, total: 3 } }) // => 'Waiting for the next stop of this render (2 of 3).'
 */
export function describeRenderRunMessage(
  input: RenderRunMessageInput,
): string | undefined {
  if (input.unconfirmedReason !== undefined) {
    const note = `This pause is unconfirmed (${input.unconfirmedReason}): Codebook could not establish that it is inside the entry page's data function, so explain the values as unconfirmed and never as proof.`
    return input.isEntryRenderPaused
      ? `${note} The server render of the entry page is paused; the page finishes loading after you continue. Stop it with codebook_stop if you do not continue.`
      : note
  }
  if (input.isEntryRenderPaused)
    return 'The server render of the entry page is paused; the page finishes loading after you continue. Stop it with codebook_stop if you do not continue.'
  if (input.waitingForNext)
    return `Waiting for the next stop of this render (${input.waitingForNext.position} of ${input.waitingForNext.total}).`
  return undefined
}
