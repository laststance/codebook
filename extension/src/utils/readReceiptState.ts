import { basename, dirname, join } from 'node:path'

import { z } from 'zod'

import {
  readPrivateJsonState,
  type PrivateJsonRemovedReason,
  type PrivateJsonState,
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

/** What the config module appends to that record's name for its dropping name (its `DROPPING_SUFFIX`): every rewrite or delete moves the record there first and only then writes the new record at its name or deletes the moved one, so during each such step, and after a run that stopped inside one until the next run puts it back, the record stands only there. */
const DROPPING_NAME_SUFFIX = '.codebook-dropping'

/** The part of that publish record that notes a file a put-back left at `receipt.json` without Codebook verifying it (`retiresReceipt.receiptUnverified`), with the hash of the old record's bytes it names, if any: the config module's record names none after it rewrote an older version's record (`retiresReceipt: {}`), and then no bytes pass ({@link unverifiedVerdictOf}); every other field is the config module's and is not read here. */
const unverifiedNoteSchema = z.object({
  retiresReceipt: z.object({
    // Optional: Zod 4 refuses an object that lacks a key of a plain `z.unknown()`, which would read a note without bytes as no note.
    sha256: z.unknown().optional(),
    receiptUnverified: z.literal(true),
  }),
})

/** The answer that keeps an installed MCP receipt from standing: removed with its reason, or no answer. */
type KeptReceiptState = Exclude<ReceiptState, { state: 'installed' }>

/**
 * Weighs one read of the publish record, or of its dropping name, against an installed MCP receipt by the rule every setup, refresh and removal follows; called by {@link unverifiedVerdictOf} for each name it reads.
 * @param read - What the bounded read found at that name.
 * @param receiptPath - The receipt that was read.
 * @param receiptSha256 - The SHA-256 of the receipt's bytes as read.
 * @returns
 * - undefined when nothing there keeps the receipt: the name is empty, or the file there carries no note, or a note that names these very bytes (the old record put back)
 * - `no-answer` when the read failed to look, so nothing is known
 * - removed with `unverified` when the note names other bytes or none, or a file stands there that cannot be read as a record (a link, too large, readable by others, no JSON): Codebook cannot tell that no note stands
 * @example
 * verdictOfRecordRead({ state: 'removed', reason: 'missing' }, '/storage/devin-mcp/receipt.json', '9f86…') // => undefined
 */
function verdictOfRecordRead(
  read: PrivateJsonState,
  receiptPath: string,
  receiptSha256: string,
): KeptReceiptState | undefined {
  if (read.state === 'no-answer') return { state: 'no-answer', receiptPath }
  // An empty name notes nothing; any other file there might.
  if (read.state === 'removed')
    return read.reason === 'missing'
      ? undefined
      : { state: 'removed', reason: 'unverified', receiptPath }
  const note = unverifiedNoteSchema.safeParse(read.value)
  // A note passes only the very bytes it names.
  return note.success && note.data.retiresReceipt.sha256 !== receiptSha256
    ? { state: 'removed', reason: 'unverified', receiptPath }
    : undefined
}

/** Whether a read found nothing at its name. @example isEmptyName({ state: 'removed', reason: 'missing' }) // => true */
function isEmptyName(read: PrivateJsonState): boolean {
  return read.state === 'removed' && read.reason === 'missing'
}

/**
 * Tells whether Codebook's publish record beside the MCP entry's receipt keeps an installed receipt from standing, so the window's descriptor mark and the bridge's check never take the installation of a file a put-back left at `receipt.json` unverified, as every setup, refresh and removal refuses that file too; called only by {@link readReceiptState}, after the receipt read answered installed, so a removal is still answered without these reads.
 * The record is read at its name, then at its dropping name ({@link DROPPING_NAME_SUFFIX}), where every rewrite or delete holds it for a moment and a run that stopped inside one leaves it: a note at either name counts, also beside another file at the record's name. When both names read empty, a rewrite may have put its record back at its name between the two reads, so that name is read once more and decides.
 * Limit: a note is missed only when the record moves between its two names before each of these three reads, that is, a rewrite ends after the first read and the next rewrite or delete of that record begins before the third; the next check reads again.
 * @param receiptPath - The receipt that was read.
 * @param receiptSha256 - The SHA-256 of the receipt's bytes as read.
 * @param platform - The platform whose file modes are judged.
 * @returns
 * - undefined when nothing keeps it: the receipt is no MCP entry's, or no read found a note that keeps it ({@link verdictOfRecordRead})
 * - the state that keeps it: removed (`unverified`) when a read at either name found such a note or a file it cannot read as a record, which outranks `no-answer` when a read failed to look
 * @example
 * await unverifiedVerdictOf('/storage/devin-mcp/receipt.json', '9f86…', 'darwin') // => { state: 'removed', reason: 'unverified', receiptPath: '/storage/devin-mcp/receipt.json' } while pending.json, or pending.json.codebook-dropping, notes receipt.json unverified with other bytes
 */
async function unverifiedVerdictOf(
  receiptPath: string,
  receiptSha256: string,
  platform: NodeJS.Platform | undefined,
): Promise<KeptReceiptState | undefined> {
  const folder = dirname(receiptPath)
  // Only the MCP entry's receipt has a publish record beside it.
  if (basename(folder) !== MCP_RECEIPT_FOLDER) return undefined
  const recordPath = join(folder, PUBLISH_RECORD_FILE)
  const atRecord = await readPrivateJsonState(recordPath, platform)
  const atDropping = await readPrivateJsonState(
    `${recordPath}${DROPPING_NAME_SUFFIX}`,
    platform,
  )
  // Both names empty: a rewrite may have put its record back at its name after the first read.
  if (isEmptyName(atRecord) && isEmptyName(atDropping))
    return verdictOfRecordRead(
      await readPrivateJsonState(recordPath, platform),
      receiptPath,
      receiptSha256,
    )
  const verdicts = [atRecord, atDropping].map((read) =>
    verdictOfRecordRead(read, receiptPath, receiptSha256),
  )
  // A name that keeps the receipt from standing outranks a read that failed to look.
  return (
    verdicts.find((verdict) => verdict?.state === 'removed') ??
    verdicts.find((verdict) => verdict !== undefined)
  )
}

/**
 * Looks at one of the Devin setup's receipts and says whether it stands, was removed (with the reason) or cannot be told; called by {@link readDevinInstallationId} and by `checkDevinBridgeReceipts`, so the bridge, the setup and the refresh judge a receipt the same way.
 * The MCP entry's receipt (`devin-mcp/receipt.json`) stands only while Codebook's publish record beside it, at its name or at its dropping name (`pending.json.codebook-dropping`, where a rewrite or delete holds it), does not note that a put-back left a file there it did not verify, unless that file holds the very bytes the note names, the rule every setup, refresh and removal follows ({@link unverifiedVerdictOf}); that record is read only after the receipt answered installed.
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
  const kept = await unverifiedVerdictOf(receiptPath, read.sha256, platform)
  // A file its publish record notes as unverified is no receipt of the setup, and a record that could not be read leaves it unknown.
  if (kept) return kept
  return {
    state: 'installed',
    receipt: Object.fromEntries(Object.entries(value)),
  }
}
