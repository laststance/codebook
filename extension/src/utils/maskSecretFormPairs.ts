import { REDACTION_MASK } from '../constants'

import { isSecretName } from './isSecretName'

/**
 * Masks the values of secret-named pairs in an `a=b&c=d` string, the shape of both a URL query and a form body; a name that cannot be decoded is masked whole, as it cannot be told from a secret.
 * Called by {@link maskSecretQueryValues} for request paths and {@link maskNodeServerRequestBody} for form bodies.
 * @param pairs - The text after `?`, or a form body.
 * @param isSecretParameter - Says whether a decoded parameter name hides its value; {@link isSecretName} unless a caller widens it (the saved-snapshot rule also hides an OAuth `code`, {@link maskShapedLiterals}).
 * @param mask - What replaces a secret value; {@link REDACTION_MASK} unless the caller keeps another marker ({@link maskNextServerOutput}).
 * @returns The pairs with each secret-named value replaced by the mask; pairs without `=` unchanged.
 * @example
 * maskSecretFormPairs('id=3&api_key=k') // => 'id=3&api_key=[masked]'
 * maskSecretFormPairs('id=3&api_key=k', undefined, '<redacted>') // => 'id=3&api_key=<redacted>'
 */
export function maskSecretFormPairs(
  pairs: string,
  isSecretParameter: (name: string) => boolean = isSecretName,
  mask: string = REDACTION_MASK,
): string {
  return pairs
    .split('&')
    .map((pair) => {
      const separator = pair.indexOf('=')
      if (separator < 0) return pair
      const name = pair.slice(0, separator)
      try {
        return isSecretParameter(decodeURIComponent(name.replace(/\+/g, ' ')))
          ? `${name}=${mask}`
          : pair
      } catch {
        return `${name}=${mask}`
      }
    })
    .join('&')
}
