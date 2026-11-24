import { createHash } from 'node:crypto'

import {
  DESCRIPTOR_NOT_PRIVATE_CODE,
  DESCRIPTOR_NOT_REGULAR_CODE,
  DESCRIPTOR_TOO_LARGE_CODE,
  readDescriptorBytes,
} from './readDescriptorText'

/** Why a private JSON file counts as removed or invalid: nothing is there (`missing`), it is a link or another non-regular file (`not-regular`), it is readable by others off Windows (`not-private`), this user may not read it (`permission`), it is larger than the limit (`oversized`) or its text is no JSON (`unparsable`). */
export type PrivateJsonRemovedReason =
  | 'missing'
  | 'not-regular'
  | 'not-private'
  | 'permission'
  | 'oversized'
  | 'unparsable'

/** What looking at one private JSON file found: its parsed value and the SHA-256 of the bytes it was parsed from (`read`), an observed absence or invalid state with the reason (`removed`), or no answer because the read itself failed (`no-answer`, for example descriptor exhaustion or `EIO`). The hash is that of the file's own bytes as read, before they are decoded, as the config module hashes a record's bytes, so a caller can tell one record's bytes from another's also where they are no valid UTF-8 and two files decode to the same text ({@link readReceiptState}). */
export type PrivateJsonState =
  | { state: 'read'; value: unknown; sha256: string }
  | { state: 'removed'; reason: PrivateJsonRemovedReason }
  | { state: 'no-answer' }

/**
 * Maps the error of a failed read to the reason the file counts as removed, or `undefined` when the read only failed to look; called by {@link readPrivateJsonState}.
 * @param error - What {@link readDescriptorBytes} threw.
 * @param platform - The platform the read judged; on Windows `EACCES` and `EPERM` also occur while a file is replaced or scanned, so they prove no permission problem there.
 * @returns The reason for an observed absence (`ENOENT`, `ENOTDIR`), a refusal of {@link readDescriptorBytes} (by its code, never its words) or a permission refusal (`EACCES`, `EPERM`, off Windows only); `undefined` for any other failure, `EREPLACED` and the Windows permission codes included.
 * @example
 * removedReasonOf(Object.assign(new Error('x'), { code: 'ENOENT' })) // => 'missing'
 * removedReasonOf(Object.assign(new Error('x'), { code: 'EMFILE' })) // => undefined
 */
function removedReasonOf(
  error: unknown,
  platform: NodeJS.Platform,
): PrivateJsonRemovedReason | undefined {
  // Not `instanceof Error`: an error from another realm fails that check.
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? error.code
      : undefined
  if (code === 'ENOENT' || code === 'ENOTDIR') return 'missing'
  if (code === DESCRIPTOR_NOT_REGULAR_CODE) return 'not-regular'
  if (code === DESCRIPTOR_NOT_PRIVATE_CODE) return 'not-private'
  if (code === DESCRIPTOR_TOO_LARGE_CODE) return 'oversized'
  // On Windows these codes also come from a file that is being replaced or scanned: a race, no answer.
  if ((code === 'EACCES' || code === 'EPERM') && platform !== 'win32')
    return 'permission'
  return undefined
}

/**
 * Reads one private JSON file with the bounded read and says what it found, so a caller can tell a file that is gone or invalid from a read that merely failed; called by {@link readReceiptState} (for a receipt and the MCP receipt's publish record) and by the Devin bridge's receipts check for the connection descriptor.
 * @param path - The file; a `receipt.json` of the global storage, the `pending.json` beside the MCP receipt, or a connection descriptor.
 * @param platform - The platform whose file modes are judged; defaults to this process's platform.
 * @returns `read` with the parsed value and the SHA-256 of the file's bytes, hashed before they are decoded as UTF-8; `removed` with the reason for an observed absence or invalid state; `no-answer` for every other failure (descriptor exhaustion, `EIO`, `EAGAIN`, `EBUSY`, `EINTR`, an unknown code), which proves nothing about the file.
 * @example
 * await readPrivateJsonState('/storage/devin-mcp/receipt.json') // => { state: 'read', value: { installed: true }, sha256: '…' }
 */
export async function readPrivateJsonState(
  path: string,
  platform: NodeJS.Platform = process.platform,
): Promise<PrivateJsonState> {
  let bytes: Buffer
  try {
    bytes = await readDescriptorBytes(path, platform)
  } catch (error) {
    const reason = removedReasonOf(error, platform)
    return reason === undefined
      ? { state: 'no-answer' }
      : { state: 'removed', reason }
  }
  try {
    return {
      state: 'read',
      value: JSON.parse(bytes.toString('utf8')),
      // The bytes themselves, not their decoded text: a byte that is no UTF-8 decodes to U+FFFD, which another file can hold as it is.
      sha256: createHash('sha256').update(bytes).digest('hex'),
    }
  } catch {
    return { state: 'removed', reason: 'unparsable' }
  }
}
