import { REDACTION_MASK } from '../constants'

import { isSecretName } from './isSecretName'

/**
 * Masks the values of secret-named pairs in an `a=b&c=d` string, the shape of both a URL query and a form body; a name that cannot be decoded is masked whole, as it cannot be told from a secret.
 * Called by {@link maskSecretQueryValues} for request paths and {@link maskNodeServerRequestBody} for form bodies.
 * @param pairs - The text after `?`, or a form body.
 * @returns The pairs with each secret-named value replaced by the redaction mask; pairs without `=` unchanged.
 * @example maskSecretFormPairs('id=3&api_key=k') // => 'id=3&api_key=[masked]'
 */
export function maskSecretFormPairs(pairs: string): string {
  return pairs
    .split('&')
    .map((pair) => {
      const separator = pair.indexOf('=')
      if (separator < 0) return pair
      const name = pair.slice(0, separator)
      try {
        return isSecretName(decodeURIComponent(name.replace(/\+/g, ' ')))
          ? `${name}=${REDACTION_MASK}`
          : pair
      } catch {
        return `${name}=${REDACTION_MASK}`
      }
    })
    .join('&')
}
