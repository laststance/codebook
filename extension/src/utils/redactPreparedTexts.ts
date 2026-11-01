import { PREPARED_TEXT_PENDING_MARK, REDACTION_MASK } from '../constants'

/** Where a prepared text stands: not yet resolved, resolved as secret, or resolved as plain. */
export type PreparedTextState = 'pending' | 'secret' | 'plain'

/**
 * Replaces the text of each prepared input by what a form may show: the plain text, the secret mask, or the pending mark.
 *
 * Why it exists: prepared text is typed into the page once, but Codebook stores, serves and hashes the declaration. The canonical form fails closed (only a text resolved as plain survives); the view form shows `[pending]` for a text not yet resolved. Called by {@link redactPreparedConfiguration} and {@link redactExtensionInputs}.
 * @param inputs - The declared inputs, in order.
 * @param states - The state of each input by index; a missing state counts as pending.
 * @param form - `canonical` for stored and hashed forms, `view` for the run resource.
 * @returns A new array with each text replaced; the other fields are kept.
 * @example
 * redactPreparedTexts([{ selector: '#p', text: 'x' }], ['secret'], 'canonical') // => [{ selector: '#p', text: '[masked]' }]
 */
export function redactPreparedTexts<T extends { text: string }>(
  inputs: readonly T[],
  states: readonly (PreparedTextState | undefined)[],
  form: 'canonical' | 'view',
): T[] {
  return inputs.map((input, index) => {
    const state = states[index] ?? 'pending'
    if (state === 'plain') return input
    // [pending] is never stored or hashed: the canonical form masks every text that is not known plain.
    if (state === 'pending' && form === 'view')
      return { ...input, text: PREPARED_TEXT_PENDING_MARK }
    return { ...input, text: REDACTION_MASK }
  })
}
