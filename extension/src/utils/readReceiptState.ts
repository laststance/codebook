import {
  readPrivateJsonState,
  type PrivateJsonRemovedReason,
} from './readPrivateJsonState'

/** Why a receipt counts as removed: a reason of {@link PrivateJsonRemovedReason}, or `uninstalled` for a receipt that does not say `installed: true` (a removal leaves the skill's receipt with `installed: false`; a JSON value that is no object counts as `unparsable`). */
export type ReceiptRemovedReason = PrivateJsonRemovedReason | 'uninstalled'

/**
 * What one receipt says, as {@link readReceiptState} answers:
 * - `installed`: the receipt says `installed: true`; `receipt` holds its fields.
 * - `removed`: an observed absence or invalid state, with its `reason` and the `receiptPath`.
 * - `no-answer`: the read itself failed (descriptor exhaustion, `EIO` and the like), so nothing is known about the receipt.
 */
export type ReceiptState =
  | { state: 'installed'; receipt: Record<string, unknown> }
  | { state: 'removed'; reason: ReceiptRemovedReason; receiptPath: string }
  | { state: 'no-answer'; receiptPath: string }

/**
 * Looks at one of the Devin setup's receipts and says whether it stands, was removed (with the reason) or cannot be told; called by {@link readInstalledReceipt} and by `checkDevinBridgeReceipts`, so the bridge, the setup and the refresh judge a receipt the same way.
 * @param receiptPath - A `receipt.json` of the global storage (`devin-skill` or `devin-mcp`).
 * @param platform - The platform whose file modes are judged; defaults to this process's platform.
 * @returns A {@link ReceiptState}; never throws.
 * @example
 * await readReceiptState('/storage/devin-mcp/receipt.json') // => { state: 'installed', receipt: { installed: true, installationId: '…' } }
 * await readReceiptState('/storage/devin-skill/receipt.json') // => { state: 'removed', reason: 'missing', receiptPath: '/storage/devin-skill/receipt.json' }
 */
export async function readReceiptState(
  receiptPath: string,
  platform?: NodeJS.Platform,
): Promise<ReceiptState> {
  const read = await readPrivateJsonState(receiptPath, platform)
  if (read.state === 'no-answer') return { state: 'no-answer', receiptPath }
  if (read.state === 'removed')
    return { state: 'removed', reason: read.reason, receiptPath }
  const { value } = read
  // Only an object counts; any other JSON value is an invalid receipt.
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return { state: 'removed', reason: 'unparsable', receiptPath }
  // Only a receipt that says `installed: true` stands.
  if ('installed' in value && value.installed === true)
    return {
      state: 'installed',
      receipt: Object.fromEntries(Object.entries(value)),
    }
  return { state: 'removed', reason: 'uninstalled', receiptPath }
}
