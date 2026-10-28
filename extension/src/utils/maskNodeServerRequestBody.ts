import { REDACTION_MASK } from '../constants'

import { isSecretName } from './isSecretName'
import { redactSecretText } from './redactSecretText'

/** Masks every secret-named property of parsed JSON, at any depth, and secret-shaped strings. */
function maskJsonValue(value: unknown): unknown {
  if (typeof value === 'string') return redactSecretText(value)
  if (Array.isArray(value)) return value.map(maskJsonValue)
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([name, entry]) => [
        name,
        isSecretName(name) ? REDACTION_MASK : maskJsonValue(entry),
      ]),
    )
  return value
}

/**
 * Masks the secret-named fields of a declared request body for the history header: JSON properties at any depth, form fields by name, and secret-shaped text in a plain body.
 * Called by {@link maskNodeServerConfiguration}; the header's `configurationHash` still hashes the original, so identity survives and the secret never does.
 * @param body - The declared body.
 * @param contentType - The declared content type; absent for a request with no body.
 * @returns The body with secret values masked; a body that does not parse as its content type is masked as plain text.
 * @example maskNodeServerRequestBody('{"password":"x","name":"a"}', 'application/json') // => '{"password":"[masked]","name":"a"}'
 */
export function maskNodeServerRequestBody(
  body: string,
  contentType: string | undefined,
): string {
  if (contentType === 'application/json') {
    try {
      return JSON.stringify(maskJsonValue(JSON.parse(body)))
    } catch {
      return redactSecretText(body)
    }
  }
  if (contentType === 'application/x-www-form-urlencoded')
    return redactSecretText(
      body
        .split('&')
        .map((pair) => {
          const separator = pair.indexOf('=')
          if (separator < 0) return pair
          const name = pair.slice(0, separator)
          let decodedName = name
          try {
            decodedName = decodeURIComponent(name.replace(/\+/g, ' '))
          } catch {
            return `${name}=${REDACTION_MASK}`
          }
          return isSecretName(decodedName) ? `${name}=${REDACTION_MASK}` : pair
        })
        .join('&'),
    )
  return redactSecretText(body)
}
