import { NEXT_REDACTED_VALUE } from '../constants'

/** A value that is empty or only `=` characters, as the padding of a bare base64 token leaves after its first `=` (`dG9rZW4=`, `dG9rZW4tc2VjcmV0==`). One quantifier over one character, anchored at both ends, so it runs in linear time. */
const PADDING_ONLY_VALUE = /^=*$/

/**
 * Replaces each value of `name=value` pairs with {@link NEXT_REDACTED_VALUE}, keeping the names; a part that holds no readable name is a value itself and is replaced whole.
 *
 * Why it exists: a query or fragment may carry a token either as a value (`?token=…`) or as the whole part (`?3f9ac0…`, a padded `?dG9rZW4=`, `?SECRET?x=1`), and every Next message hides both the same way. Called by {@link redactNextEntryPath} for a quoted path's query and fragment, and by {@link maskNextServerOutput} for the query of a URL the development server logged.
 * @param pairs - The text after `?` or `#`.
 * @returns The pairs with their values redacted, a bare part whole ({@link keptNameOf}); an empty part (`a&&b`, an empty query) stays empty.
 * @example
 * redactedPairsOf('token=SECRET&next=%2F') // => 'token=<redacted>&next=<redacted>'
 * redactedPairsOf('SECRET')                // => '<redacted>'
 * redactedPairsOf('dG9rZW4=')              // => '<redacted>'
 * redactedPairsOf('SECRET?x=1')            // => '<redacted>'
 * redactedPairsOf('')                      // => ''
 */
export function redactedPairsOf(pairs: string): string {
  return pairs
    .split('&')
    .map((pair) => {
      const name = keptNameOf(pair)
      // A bare part may be a token itself, so nothing of it is kept.
      if (name === undefined) return pair ? NEXT_REDACTED_VALUE : pair
      return `${name}=${NEXT_REDACTED_VALUE}`
    })
    .join('&')
}

/**
 * Reads the name a query or fragment part keeps when its value is redacted; called by {@link redactedPairsOf} for each part.
 * @param pair - One part between `&` separators.
 * @returns
 * - the text before the first `=` for a `name=value` part
 * - `undefined` for a bare part: no `=`, nothing before the first `=`, a name holding `?` (a token followed by a second query), or a value that is empty or only `=` (a token's base64 padding)
 * @example
 * keptNameOf('token=SECRET')       // => 'token'
 * keptNameOf('3f9ac0d1e2b4')       // => undefined
 * keptNameOf('dG9rZW4tc2VjcmV0==') // => undefined
 * keptNameOf('SECRET?x=1')         // => undefined
 * keptNameOf('debug=')             // => undefined
 */
function keptNameOf(pair: string): string | undefined {
  const separator = pair.indexOf('=')
  // No `=`, or nothing before it: the whole part is the value.
  if (separator <= 0) return undefined
  const name = pair.slice(0, separator)
  // A `?` in the name or a value of only `=` puts a token where a name sits, so the name is not kept either.
  if (name.includes('?') || PADDING_ONLY_VALUE.test(pair.slice(separator + 1)))
    return undefined
  return name
}
