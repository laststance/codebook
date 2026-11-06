import { REDACTION_MASK } from '../constants'

import type { StartedSecretForm } from './maskPartialSecretTail'

/**
 * Masks the continuation of a secret whose start was already published masked, so a value written in pieces more than the hold time apart is never rebuilt from raw pieces.
 *
 * Called by {@link createKnownValueMaskStage} for the next text of a channel whose released ending started one or more secret forms ({@link maskPartialSecretTail}).
 * If the text begins with a started form's whole rest, that rest is replaced by one {@link REDACTION_MASK} and the remainder is returned for normal handling. If the text is only a part of a form's rest, all of it is masked and the form stays remembered. Any other text clears the state.
 *
 * @param text - The channel's next non-empty text.
 * @param pending - The forms started by the previous release, with matched lengths.
 * @returns `masked`: the mask to publish first (empty when nothing continued); `rest`: the text left for normal masking and holdback; `pending`: the forms still started after this text.
 * @example
 * continueSecretForms('ter2-secret ok', [{ form: 'hunter2-secret', matched: 3 }])
 * // => { masked: '[masked]', rest: ' ok', pending: [] }
 * continueSecretForms('ter2', [{ form: 'hunter2-secret', matched: 3 }])
 * // => { masked: '[masked]', rest: '', pending: [{ form: 'hunter2-secret', matched: 7 }] }
 */
export function continueSecretForms(
  text: string,
  pending: readonly StartedSecretForm[],
): { masked: string; rest: string; pending: StartedSecretForm[] } {
  // The longest whole rest the text begins with wins.
  let wholeRestLength = 0
  for (const { form, matched } of pending) {
    const rest = form.slice(matched)
    if (text.startsWith(rest))
      wholeRestLength = Math.max(wholeRestLength, rest.length)
  }
  if (wholeRestLength > 0)
    return {
      masked: REDACTION_MASK,
      rest: text.slice(wholeRestLength),
      pending: [],
    }
  // The text lies inside the rests of some forms: all of it is secret, and those forms stay started.
  const inside = pending
    .filter(({ form, matched }) => form.slice(matched).startsWith(text))
    .map(({ form, matched }) => ({ form, matched: matched + text.length }))
  if (inside.length > 0)
    return { masked: REDACTION_MASK, rest: '', pending: inside }
  // Not a continuation: the state is cleared and the text is handled as usual.
  return { masked: '', rest: text, pending: [] }
}
