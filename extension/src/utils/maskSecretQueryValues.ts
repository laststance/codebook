import { REDACTION_MASK } from '../constants'

import { isSecretName } from './isSecretName'
import { redactSecretText } from './redactSecretText'

/**
 * Masks the values of secret-named query parameters of a request path, and secret-shaped text anywhere in it, so a history never stores a token the declaration carried in its URL.
 * Called by {@link maskNodeServerConfiguration} for the header and by the writer for each `request` entry.
 * @param path - A request path such as `/api/users?id=3&access_token=abc`.
 * @returns The path with each secret-named parameter's value replaced by the redaction mask.
 * @example maskSecretQueryValues('/api?id=3&access_token=abc') // => '/api?id=3&access_token=[masked]'
 */
export function maskSecretQueryValues(path: string): string {
  const queryStart = path.indexOf('?')
  if (queryStart < 0) return redactSecretText(path)
  const query = path
    .slice(queryStart + 1)
    .split('&')
    .map((pair) => {
      const separator = pair.indexOf('=')
      if (separator < 0) return pair
      const name = pair.slice(0, separator)
      // A name that cannot be decoded is masked whole: it is not told apart from a secret.
      let decodedName = name
      try {
        decodedName = decodeURIComponent(name)
      } catch {
        return `${name}=${REDACTION_MASK}`
      }
      return isSecretName(decodedName) ? `${name}=${REDACTION_MASK}` : pair
    })
    .join('&')
  return redactSecretText(`${path.slice(0, queryStart)}?${query}`)
}
