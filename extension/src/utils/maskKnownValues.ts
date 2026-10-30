import { REDACTION_MASK, VITE_MASKED_VALUE_MIN_CHARS } from '../constants'

import { redactSecretText } from './redactSecretText'

/**
 * Lists the texts that stand for each value in published output, longest first.
 *
 * Why it exists: a multi-line value (a PEM key, a JSON document) never matches a single-line message as a whole, and a value in a JSON-encoded log line appears with escapes. Called by {@link maskKnownValues} and {@link longestMaskedLength}.
 * Each value contributes itself, each of its lines and its JSON-escaped form, all at least {@link VITE_MASKED_VALUE_MIN_CHARS} characters long.
 *
 * @param values - The values to mask.
 * @returns The distinct candidates, longest first so one candidate inside another leaves no fragment.
 * @example
 * maskCandidates(['line-one\nline-two']) // => ['line-one\\nline-two', 'line-one\nline-two', 'line-one', 'line-two']
 */
function maskCandidates(values: readonly string[]): string[] {
  const candidates = new Set<string>()
  for (const value of values) {
    // The value itself, every line of a multi-line value, and the form a JSON log line carries.
    const forms = [
      value,
      ...value.split(/\r?\n/),
      JSON.stringify(value).slice(1, -1),
    ]
    for (const form of forms)
      if (form.length >= VITE_MASKED_VALUE_MIN_CHARS) candidates.add(form)
  }
  return [...candidates].sort((left, right) => right.length - left.length)
}

/**
 * Says how many characters the longest masked candidate has, so a stream keeps that much unpublished until the rest of a value can arrive.
 * Called by {@link launchViteDevelopmentServer} for the output holdback of {@link launchDevelopmentServer}.
 * @param values - The values to mask.
 * @returns The longest candidate length; 0 when nothing is masked.
 * @example
 * longestMaskedLength(['hunter2hunter2']) // => 14
 */
export function longestMaskedLength(values: readonly string[]): number {
  return maskCandidates(values)[0]?.length ?? 0
}

/**
 * Masks every occurrence of values the launcher passed or loaded (script assignments, `.env` files), then the secret shapes {@link redactSecretText} knows.
 *
 * Why it exists: a plain secret has no recognizable shape, so a diagnostic can only hide it by its value. Called by {@link launchViteDevelopmentServer} on every published output tail and sentence, by {@link launchDevelopmentServer} before an output tail is cut, and by the Vite launcher (`viteLauncher.ts`) on its error line before the line is cut.
 * Values shorter than {@link VITE_MASKED_VALUE_MIN_CHARS} are left alone so a short word is not blanked everywhere. Each line of a multi-line value and its JSON-escaped form are masked too ({@link maskCandidates}).
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
  for (const candidate of maskCandidates(values))
    masked = masked.split(candidate).join(REDACTION_MASK)
  return redactSecretText(masked)
}
