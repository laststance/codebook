import { RESOURCE_JSON_PAGE_BYTES } from '../constants'
import { StudyError } from '../errors'
import type { ResourceContent } from '../resources'
import { sha256 } from '../runtimeSupport/utils/sha256'

/** Bounds selected evidence for resource readers without losing bytes or mixing revisions; callers supply freshly authorized content. @example readJsonPage('codebook://instance/item/inspection', { state: null }) */
export function readJsonPage(
  baseUri: string,
  value: unknown,
  page?: string,
): ResourceContent {
  const bytes = Buffer.from(JSON.stringify(value), 'utf8'),
    contentHash = sha256(bytes)
  const match =
    page === undefined
      ? undefined
      : /^pages\/([a-f0-9]{64})\/(0|[1-9]\d*)$/.exec(page)
  if (page !== undefined && !match)
    throw new StudyError('INVALID_REFERENCE', 'Use the returned page URI.')
  const offset = match ? Number(match[2]) : 0
  // Reject stale or partial-code-point cursors before exposing any selected content.
  if (match && match[1] !== contentHash)
    throw new StudyError(
      'EVIDENCE_UNAVAILABLE',
      'Evidence changed between pages; rediscover the resource and restart reading.',
    )
  if (
    !Number.isSafeInteger(offset) ||
    offset >= bytes.length ||
    (bytes[offset]! & 0xc0) === 0x80
  )
    throw new StudyError(
      'INVALID_REFERENCE',
      'Page offset is outside the content or splits a UTF-8 character.',
    )
  let end = Math.min(offset + RESOURCE_JSON_PAGE_BYTES, bytes.length)
  // A page boundary must retain complete Unicode characters for lossless concatenation.
  while (end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end--
  return {
    uri: page ? `${baseUri}/${page}` : baseUri,
    mimeType: 'application/json',
    text: JSON.stringify({
      sourceUri: baseUri,
      contentHash,
      encoding: 'utf-8',
      offset,
      end,
      totalBytes: bytes.length,
      content: bytes.subarray(offset, end).toString('utf8'),
      complete: end === bytes.length,
      nextUri:
        end < bytes.length
          ? `${baseUri}/pages/${contentHash}/${end}`
          : undefined,
      reading:
        'Concatenate content from all returned pages in order, then parse JSON. A page alone is not complete evidence.',
    }),
  }
}
