import {
  NEXT_MESSAGE_PATH_LIMIT_CHARS,
  NEXT_REDACTED_VALUE,
} from '../constants'

/** Characters a quoted path never carries into a message: C0 controls and DEL. */
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g

/**
 * Replaces each value of `name=value` pairs with {@link NEXT_REDACTED_VALUE}, keeping the names; a part without `=` is a value itself and is replaced whole. Called by {@link redactNextEntryPath} for a query and a fragment.
 * @param pairs - The text after `?` or `#`.
 * @returns The pairs with their values redacted.
 * @example
 * redactedPairsOf('token=SECRET&next=%2F') // => 'token=<redacted>&next=<redacted>'
 * redactedPairsOf('SECRET')                // => '<redacted>'
 */
function redactedPairsOf(pairs: string): string {
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

/**
 * Writes an origin-less path for a Next Pages refusal: the pathname as given, every query and fragment value replaced by {@link NEXT_REDACTED_VALUE} with the names kept, no control character, cut to {@link NEXT_MESSAGE_PATH_LIMIT_CHARS}.
 *
 * Why it exists: the service's sanitizer masks secret shapes (Bearer tokens, JWTs, provider keys) but no query value, and a redirect target such as `/login?token=…` carries one; so a path is redacted where the message is built. Called by {@link describeNextEntryResponse} for a same-origin `Location`, and by the Pages run for the entry path, the page's final path and the router routes it names.
 * @param path - A path with an optional query and fragment, without an origin.
 * @returns The redacted path.
 * @example
 * redactNextEntryPath('/login?token=SECRET&next=%2F#frag') // => '/login?token=<redacted>&next=<redacted>#<redacted>'
 * redactNextEntryPath('/posts/[id]')                       // => '/posts/[id]'
 */
export function redactNextEntryPath(path: string): string {
  const fragmentStart = path.indexOf('#'),
    beforeFragment = fragmentStart < 0 ? path : path.slice(0, fragmentStart),
    queryStart = beforeFragment.indexOf('?')
  let redacted =
    queryStart < 0
      ? beforeFragment
      : `${beforeFragment.slice(0, queryStart)}?${redactedPairsOf(beforeFragment.slice(queryStart + 1))}`
  // A fragment is client-only and may hold a token too (an OAuth implicit grant).
  if (fragmentStart >= 0)
    redacted += `#${redactedPairsOf(path.slice(fragmentStart + 1))}`
  const printable = redacted.replace(CONTROL_CHARACTERS, '')
  return printable.length > NEXT_MESSAGE_PATH_LIMIT_CHARS
    ? `${printable.slice(0, NEXT_MESSAGE_PATH_LIMIT_CHARS)}…`
    : printable
}
