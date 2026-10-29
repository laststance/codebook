import { redactSecretText } from './redactSecretText'

/**
 * Reads a text field of a run's event: masked first, then cut, so a secret split by the cut can never survive.
 * @param value - The raw field.
 * @param limit - The most characters kept.
 * @returns The masked, cut text; `null` for a field that is no text.
 * @example boundedText('Bearer abcdefgh12345 more', 12) // => 'Bearer [mask'
 */
export function boundedText(value: unknown, limit: number): string | null {
  return typeof value === 'string'
    ? redactSecretText(value).slice(0, limit)
    : null
}

/**
 * Reads a whole-number field of a run's event.
 * @param value - The raw field.
 * @returns The integer; `null` for anything else.
 * @example integerField(200) // => 200
 */
export function integerField(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null
}

/**
 * Applies the private-root sanitizer to every text field of a run event's raw detail, before any field is masked or cut, so a path at a cut can never survive as a fragment.
 * Called by {@link nodeServerEventDetail} and {@link chromeExtensionEventDetail} before they pick their whitelisted fields.
 * @param detail - What the run recorded with the event; anything that is no object reads as no fields.
 * @param sanitize - Replaces the private roots of a text.
 * @returns The detail's own fields with each text sanitized.
 * @example
 * sanitizedEventFields({ path: '/Users/ada/a.js', line: 3 }, (text) => text.replace('/Users/ada', '~')) // => { path: '~/a.js', line: 3 }
 */
export function sanitizedEventFields(
  detail: unknown,
  sanitize: (text: string) => string,
): Record<string, unknown> {
  const entries =
    detail && typeof detail === 'object' ? Object.entries(detail) : []
  return Object.fromEntries(
    entries.map(([name, value]) => [
      name,
      typeof value === 'string' ? sanitize(value) : value,
    ]),
  )
}
