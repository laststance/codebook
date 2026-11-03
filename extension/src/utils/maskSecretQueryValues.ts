import { maskSecretFormPairs } from './maskSecretFormPairs'
import { redactSecretText } from './redactSecretText'
import { maskBareShape } from './secretShapes'

/**
 * Masks the secret query values of a URL-shaped text and of its fragment with the rule of {@link maskBareShape}, which also hides an OAuth `code`.
 * Called by {@link maskSecretQueryValues} after the secret-named pairs were masked.
 * @param text - A path or location, with or without a query and a fragment.
 * @returns The text with each such value replaced by the redaction mask; the fragment is read as a query of its own, since an implicit-flow redirect carries its token there.
 * @example
 * maskUrlShapes('/cb?code=abc&page=2#access_token=t') // => '/cb?code=[masked]&page=2#access_token=[masked]'
 */
function maskUrlShapes(text: string): string {
  const fragmentStart = text.indexOf('#')
  if (fragmentStart < 0) return maskBareShape(text)
  const fragment = maskBareShape(`?${text.slice(fragmentStart + 1)}`)
  return `${maskBareShape(text.slice(0, fragmentStart))}#${fragment.slice(1)}`
}

/**
 * Masks the values of secret query parameters of a request path or a redirect location, the OAuth `code` among them, and secret-shaped text anywhere in it, so a history never stores a token or callback code the declaration or the server's redirect carried in its URL.
 * Called by {@link maskNodeServerConfiguration} for the header, by the writer for each `request` entry's path and each `response` entry's location, by {@link describeRedirectLocation} for a redirect the run shows, and by {@link maskSavedServerEntries} for a history saved before `code` was masked.
 * @param path - A request path such as `/api/users?id=3&access_token=abc`, or a redirect location.
 * @returns The path with each secret-named or `code` parameter's value replaced by the redaction mask, in the query and in the fragment.
 * @example
 * maskSecretQueryValues('/api?id=3&access_token=abc') // => '/api?id=3&access_token=[masked]'
 * maskSecretQueryValues('/login/callback?code=abc&state=xyz') // => '/login/callback?code=[masked]&state=xyz'
 */
export function maskSecretQueryValues(path: string): string {
  const queryStart = path.indexOf('?')
  const namedSecretsMasked =
    queryStart < 0
      ? path
      : `${path.slice(0, queryStart)}?${maskSecretFormPairs(path.slice(queryStart + 1))}`
  return redactSecretText(maskUrlShapes(namedSecretsMasked))
}
