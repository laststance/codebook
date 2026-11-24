import { basename, dirname, join } from 'node:path'

import { z } from 'zod'

import {
  readPrivateJsonState,
  type PrivateJsonRemovedReason,
} from './readPrivateJsonState'

/** Why a receipt counts as removed: a reason of {@link PrivateJsonRemovedReason}, `uninstalled` for a receipt that does not say `installed: true` (a removal leaves the skill's receipt with `installed: false`; a JSON value that is no object counts as `unparsable`), or `unverified` for an MCP receipt that Codebook's publish record beside it notes as a file a put-back left there unverified ({@link unverifiedVerdictOf}). */
export type ReceiptRemovedReason =
  PrivateJsonRemovedReason | 'uninstalled' | 'unverified'

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

/** The folder of the Devin MCP entry's receipt in Codebook's global storage: the only receipt with a publish record beside it. */
const MCP_RECEIPT_FOLDER = 'devin-mcp'

/** The publish record beside the MCP entry's receipt, which Codebook's config module writes while a setup, refresh or removal is not settled. */
const PUBLISH_RECORD_FILE = 'pending.json'

/** The part of that publish record that notes a file a put-back left at `receipt.json` without Codebook verifying it (`retiresReceipt.receiptUnverified`), with the hash of the old record's bytes it names, if any: the config module's record names none after it rewrote an older version's record (`retiresReceipt: {}`), and then no bytes pass ({@link unverifiedVerdictOf}); every other field is the config module's and is not read here. */
const unverifiedNoteSchema = z.object({
  retiresReceipt: z.object({
    // Optional: Zod 4 refuses an object that lacks a key of a plain `z.unknown()`, which would read a note without bytes as no note.
    sha256: z.unknown().optional(),
    receiptUnverified: z.literal(true),
  }),
})

/**
 * Tells whether Codebook's publish record beside the MCP entry's receipt keeps an installed receipt from standing, so the window's descriptor mark and the bridge's check never take the installation of a file a put-back left at `receipt.json` unverified, as every setup, refresh and removal refuses that file too; called only by {@link readReceiptState}, after the receipt read answered installed, so a removal is still answered without this read.
 * @param receiptPath - The receipt that was read.
 * @param receiptSha256 - The SHA-256 of the receipt's text as read.
 * @param platform - The platform whose file modes are judged.
 * @returns
 * - undefined when nothing keeps it: the receipt is no MCP entry's, no publish record stands there, that record carries no such note, or the note names these very bytes (the old record put back)
 * - `no-answer` when the read of that record failed to look, so nothing is known
 * - `unverified` when the note names other bytes or none, or a file stands there that cannot be read as a record (a link, too large, readable by others, no JSON): Codebook cannot tell that no note stands
 * @example
 * await unverifiedVerdictOf('/storage/devin-mcp/receipt.json', '9f86…', 'darwin') // => 'unverified' while pending.json notes receipt.json unverified with other bytes
 */
async function unverifiedVerdictOf(
  receiptPath: string,
  receiptSha256: string,
  platform: NodeJS.Platform | undefined,
): Promise<'unverified' | 'no-answer' | undefined> {
  const folder = dirname(receiptPath)
  // Only the MCP entry's receipt has a publish record beside it.
  if (basename(folder) !== MCP_RECEIPT_FOLDER) return undefined
  const record = await readPrivateJsonState(
    join(folder, PUBLISH_RECORD_FILE),
    platform,
  )
  if (record.state === 'no-answer') return 'no-answer'
  // No publish record stands: nothing notes anything; any other file there might.
  if (record.state === 'removed')
    return record.reason === 'missing' ? undefined : 'unverified'
  const note = unverifiedNoteSchema.safeParse(record.value)
  // A note passes only the very bytes it names.
  if (note.success && note.data.retiresReceipt.sha256 !== receiptSha256)
    return 'unverified'
  return undefined
}

/**
 * Looks at one of the Devin setup's receipts and says whether it stands, was removed (with the reason) or cannot be told; called by {@link readDevinInstallationId} and by `checkDevinBridgeReceipts`, so the bridge, the setup and the refresh judge a receipt the same way.
 * The MCP entry's receipt (`devin-mcp/receipt.json`) stands only while Codebook's publish record beside it does not note that a put-back left a file there it did not verify, unless that file holds the very bytes the note names, the rule every setup, refresh and removal follows ({@link unverifiedVerdictOf}); that record is read only after the receipt answered installed. Limit: a publish record that a stopped rewrite left only at its dropping name (`pending.json.codebook-dropping`) is not read; the next setup, refresh or removal puts it back first.
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
  if (!('installed' in value && value.installed === true))
    return { state: 'removed', reason: 'uninstalled', receiptPath }
  const verdict = await unverifiedVerdictOf(receiptPath, read.sha256, platform)
  if (verdict === 'no-answer') return { state: 'no-answer', receiptPath }
  // A file its publish record notes as unverified is no receipt of the setup.
  if (verdict === 'unverified')
    return { state: 'removed', reason: 'unverified', receiptPath }
  return {
    state: 'installed',
    receipt: Object.fromEntries(Object.entries(value)),
  }
}
