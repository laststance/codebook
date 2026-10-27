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

/** The most bytes a UTF-8 code point's continuation bytes can take before its lead byte. */
const MAX_CONTINUATION_BYTES = 3

/**
 * Finds where to cut a UTF-8 buffer so that no code point is split.
 * @param bytes - Valid UTF-8 text.
 * @param limit - The most bytes to show.
 * @returns The length to show, at most `limit`, ending on a code point boundary; steps back at most {@link MAX_CONTINUATION_BYTES} bytes.
 * @example codePointCut(Buffer.from('aé'), 2) // => 1
 */
function codePointCut(bytes: Buffer, limit: number): number {
  const wanted = Math.min(bytes.length, limit)
  let cut = wanted
  // A continuation byte (10xxxxxx) at the cut means the character began up to 3 bytes earlier.
  while (
    cut > 0 &&
    cut < bytes.length &&
    wanted - cut < MAX_CONTINUATION_BYTES &&
    ((bytes[cut] ?? 0) & 0xc0) === 0x80
  )
    cut -= 1
  return cut
}

/**
 * Tells whether the bytes are valid UTF-8, allowing a code point cut off at the end (a read cut at 1 MiB).
 * @param bytes - The body read.
 * @returns `false` when a byte sequence inside the body is invalid.
 * @example isValidUtf8(Buffer.from([0x41, 0xff])) // => false
 */
function isValidUtf8(bytes: Buffer): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes, { stream: true })
    return true
  } catch {
    return false
  }
}

/**
 * Shapes a response body for the chat and Output: the first 8,192 bytes as UTF-8 for text bodies, a note for binary ones, always redacted.
 * Why: the response is data the AI relays to the learner; it must be bounded, readable and free of credentials ({@link redactSecretText}). The whole body is redacted before the cut, so a credential straddling the shown limit shows none of its prefix. Called by {@link sendDeclaredRequest} once the body is read.
 * @param bytes - The body bytes that were read (at most 1 MiB).
 * @param contentType - The response's `Content-Type` header.
 * @param readCut - True when the read stopped at 1 MiB, so the remainder is a lower bound.
 * @returns
 * - `''` for an empty body
 * - The redacted text, cut at a code point with ` … <n> more bytes` (`at least <n>` and ` (cut at 1 MiB)` when the read was cut; n counts the original bytes) when longer than 8,192 bytes, and ` (not valid UTF-8)` after U+FFFD replacements, for `text/*`, `application/json` and `*+json`
 * - `(binary, <n> bytes)` (`at least <n> bytes, cut at 1 MiB`) for every other media type
 * @example
 * shapeResponseBody(Buffer.from('{"ok":true}'), 'application/json') // => '{"ok":true}'
 * shapeResponseBody(Buffer.from([0x89, 0x50]), 'image/png')         // => '(binary, 2 bytes)'
 */
export function shapeResponseBody(
  bytes: Buffer,
  contentType: string | undefined,
  readCut = false,
): string {
  if (bytes.length === 0) return ''
  if (!isTextContentType(contentType))
    return readCut
      ? `(binary, at least ${bytes.length} bytes, cut at 1 MiB)`
      : `(binary, ${bytes.length} bytes)`
  // Redact the whole read first, then choose the shown cut on the redacted text.
  const redacted = Buffer.from(redactSecretText(bytes.toString('utf8')))
  const cut = codePointCut(redacted, NODE_SERVER_RESPONSE_SHOWN_BYTES)
  const text = redacted.subarray(0, cut).toString('utf8')
  const more =
    redacted.length > cut
      ? ` … ${readCut ? 'at least ' : ''}${bytes.length - cut} more bytes`
      : ''
  const note = readCut ? ' (cut at 1 MiB)' : ''
  const invalid = isValidUtf8(bytes) ? '' : ' (not valid UTF-8)'
  return `${text}${more}${note}${invalid}`
}
