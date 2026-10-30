import { REDACTION_MASK, VITE_MASKED_VALUE_MIN_CHARS } from '../constants'

import { redactSecretText } from './redactSecretText'

/**
 * Masks every occurrence of values the launcher passed or loaded (script assignments, `.env` files), then the secret shapes {@link redactSecretText} knows.
 *
 * Why it exists: a plain secret has no recognizable shape, so a diagnostic can only hide it by its value. Called by {@link launchViteDevelopmentServer} on every published output tail and every launcher error line.
 * Values shorter than {@link VITE_MASKED_VALUE_MIN_CHARS} are left alone so a short word is not blanked everywhere. Longer values are masked first so one value inside another cannot leave a fragment.
 *
 * @param text - Output, error text or a refusal sentence.
 * @param values - The values to mask; the array is read at call time.
 * @returns The text with each value and secret shape replaced by the mask.
 * @example
 * maskKnownValues('failed with hunter2hunter2', ['hunter2hunter2']) // => 'failed with [masked]'
 */
export function maskKnownValues(
  text: string,
  values: readonly string[],
): string {
  let masked = text
  const candidates = values
    .filter((value) => value.length >= VITE_MASKED_VALUE_MIN_CHARS)
    .sort((left, right) => right.length - left.length)
  for (const value of candidates)
    masked = masked.split(value).join(REDACTION_MASK)
  return redactSecretText(masked)
}
