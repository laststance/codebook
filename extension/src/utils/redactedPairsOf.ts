import { NEXT_REDACTED_VALUE } from '../constants'

/**
 * Replaces each value of `name=value` pairs with {@link NEXT_REDACTED_VALUE}, keeping the names; a part without `=` is a value itself and is replaced whole.
 *
 * Why it exists: a query or fragment may carry a token either as a value (`?token=…`) or as the whole part (`?3f9ac0…`), and every Next message hides both the same way. Called by {@link redactNextEntryPath} for a quoted path's query and fragment, and by {@link maskNextServerOutput} for the query of a URL the development server logged.
 * @param pairs - The text after `?` or `#`.
 * @returns The pairs with their values redacted; an empty part (`a&&b`, an empty query) stays empty.
 * @example
 * redactedPairsOf('token=SECRET&next=%2F') // => 'token=<redacted>&next=<redacted>'
 * redactedPairsOf('SECRET')                // => '<redacted>'
 * redactedPairsOf('')                      // => ''
 */
export function redactedPairsOf(pairs: string): string {
  return pairs
    .split('&')
    .map((pair) => {
      const separator = pair.indexOf('=')
      // A bare part may be a token itself, so nothing of it is kept.
      if (separator <= 0) return pair ? NEXT_REDACTED_VALUE : pair
      return `${pair.slice(0, separator)}=${NEXT_REDACTED_VALUE}`
    })
    .join('&')
}
