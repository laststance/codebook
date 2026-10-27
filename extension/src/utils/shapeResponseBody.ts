import { NODE_SERVER_RESPONSE_SHOWN_BYTES } from '../constants'

import { redactSecretText } from './redactSecretText'

/** Media types whose body is shown as text: `text/*`, `application/json` and `*+json`. */
const TEXT_MEDIA_TYPE =
  /^(?:text\/[^;\s]+|application\/json|[^;\s/]+\/[^;\s]*\+json)$/i

/**
 * Tells whether a `Content-Type` names a body that is shown as text.
 * @param contentType - The response's `Content-Type` header, parameters included.
 * @returns `true` for `text/*`, `application/json` and `*+json`.
 * @example isTextContentType('application/problem+json; charset=utf-8') // => true
 */
function isTextContentType(contentType: string | undefined): boolean {
  const mediaType = contentType?.split(';')[0]?.trim() ?? ''
  return TEXT_MEDIA_TYPE.test(mediaType)
}

/**
 * Finds where to cut a UTF-8 buffer so that no code point is split.
 * @param bytes - The body read.
 * @param limit - The most bytes to show.
 * @returns The length to show, at most `limit`, ending on a code point boundary.
 * @example codePointCut(Buffer.from('aé'), 2) // => 1
 */
function codePointCut(bytes: Buffer, limit: number): number {
  let cut = Math.min(bytes.length, limit)
  // A continuation byte (10xxxxxx) at the cut means the character began earlier.
  while (cut > 0 && cut < bytes.length && ((bytes[cut] ?? 0) & 0xc0) === 0x80)
    cut -= 1
  return cut
}

/**
 * Shapes a response body for the chat and Output: the first 8,192 bytes as UTF-8 for text bodies, a note for binary ones, always redacted.
 * Why: the response is data the AI relays to the learner; it must be bounded, readable and free of credentials ({@link redactSecretText}). Called by {@link sendDeclaredRequest} once the body is read.
 * @param bytes - The body bytes that were read (at most 1 MiB).
 * @param contentType - The response's `Content-Type` header.
 * @returns
 * - `''` for an empty body
 * - The text, cut at a code point with ` … <n> more bytes` when longer than 8,192 bytes, and ` (not valid UTF-8)` after U+FFFD replacements, for `text/*`, `application/json` and `*+json`
 * - `(binary, <n> bytes)` for every other media type
 * @example
 * shapeResponseBody(Buffer.from('{"ok":true}'), 'application/json') // => '{"ok":true}'
 * shapeResponseBody(Buffer.from([0x89, 0x50]), 'image/png')         // => '(binary, 2 bytes)'
 */
export function shapeResponseBody(
  bytes: Buffer,
  contentType: string | undefined,
): string {
  if (bytes.length === 0) return ''
  if (!isTextContentType(contentType)) return `(binary, ${bytes.length} bytes)`
  const cut = codePointCut(bytes, NODE_SERVER_RESPONSE_SHOWN_BYTES)
  const shown = bytes.subarray(0, cut)
  const text = shown.toString('utf8')
  // A round trip that differs shows the decoder replaced invalid bytes.
  const invalid = !Buffer.from(text, 'utf8').equals(shown)
  const more = bytes.length > cut ? ` … ${bytes.length - cut} more bytes` : ''
  return `${redactSecretText(text)}${more}${invalid ? ' (not valid UTF-8)' : ''}`
}
