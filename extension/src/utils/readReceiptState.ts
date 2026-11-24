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
 * - `removed`: an observed absence or invalid state, with its `reason` and the `receiptPath`; `recordPath` names the publish record beside the MCP receipt (or its dropping name) when that record's mode keeps the receipt from standing (others can read it, or this user may not), so the setup's repair sentence names that file.
 * - `no-answer`: the read itself failed (descriptor exhaustion, `EIO` and the like), so nothing is known about the receipt.
 */
export type ReceiptState =
  | { state: 'installed'; receipt: Record<string, unknown> }
  | {
      state: 'removed'
      reason: ReceiptRemovedReason
      receiptPath: string
      recordPath?: string
    }
  | { state: 'no-answer'; receiptPath: string }

/** The folder of the Devin MCP entry's receipt in Codebook's global storage: the only receipt with a publish record beside it. */
const MCP_RECEIPT_FOLDER = 'devin-mcp'

/** The publish record beside the MCP entry's receipt, which Codebook's config module writes while a setup, refresh or removal is not settled. */
const PUBLISH_RECORD_FILE = 'pending.json'

/** What the config module appends to the name of that record, and of the MCP entry's receipt, for its dropping name (its `DROPPING_SUFFIX`): every rewrite or delete moves the record there first and only then writes the new record at its name or deletes the moved one, so during each such step, and after a run that stopped inside one until the next run puts it back, the record stands only there; the presence check of the entry's record looks there too (`hasDevinEntryReceipt`). */
export const DROPPING_NAME_SUFFIX = '.codebook-dropping'

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
 * @param recordPath - That name, which a mode problem names.
 * @param receiptPath - The receipt that was read.
 * @param receiptSha256 - The SHA-256 of the receipt's bytes as read.
 * @returns
 * - undefined when nothing there keeps the receipt: the name is empty, or the file there carries no note, or a note that names these very bytes (the old record put back)
 * - `no-answer` when the read failed to look, so nothing is known
 * - removed with `not-private` or `permission` and that `recordPath` when others can read the file there or this user may not: Codebook cannot tell that no note stands, and the learner can repair that mode
 * - removed with `unverified` when the note names other bytes or none, or a file stands there that cannot be read as a record otherwise (a link, too large, no JSON): Codebook cannot tell that no note stands
 * @example
 * verdictOfRecordRead({ state: 'removed', reason: 'missing' }, '/storage/devin-mcp/pending.json', '/storage/devin-mcp/receipt.json', '9f86…') // => undefined
 * verdictOfRecordRead({ state: 'removed', reason: 'not-private' }, '/storage/devin-mcp/pending.json', '/storage/devin-mcp/receipt.json', '9f86…') // => { state: 'removed', reason: 'not-private', receiptPath: '/storage/devin-mcp/receipt.json', recordPath: '/storage/devin-mcp/pending.json' }
 */
function verdictOfRecordRead(
  read: PrivateJsonState,
  recordPath: string,
  receiptPath: string,
  receiptSha256: string,
): KeptReceiptState | undefined {
  if (read.state === 'no-answer') return { state: 'no-answer', receiptPath }
  // An empty name notes nothing; any other file there might.
  if (read.state === 'removed' && read.reason === 'missing') return undefined
  // A mode the learner can repair names that record; any other unreadable file there stays unverified.
  if (read.state === 'removed')
    return read.reason === 'not-private' || read.reason === 'permission'
      ? { state: 'removed', reason: read.reason, receiptPath, recordPath }
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

/** Whether a receipt is the MCP entry's (`devin-mcp/receipt.json`), the only receipt with a publish record beside it and the only one the config module moves through a dropping name. @example isMcpReceipt('/storage/devin-mcp/receipt.json') // => true */
function isMcpReceipt(receiptPath: string): boolean {
  return basename(dirname(receiptPath)) === MCP_RECEIPT_FOLDER
}

/**
 * Reads a receipt with the bounded read, and the MCP entry's receipt found missing also at its dropping name ({@link DROPPING_NAME_SUFFIX}), where Codebook's config module holds that record for a moment while it rewrites or deletes it and leaves it after a run that stopped inside one, until the next run puts it back; called only by {@link readReceiptState}, so a bridge check or a window's mark that lands in that moment reads that record instead of a removal.
 * When both names read empty, a rewrite may have published its new record at the receipt's name between the two reads, so that name is read once more and decides, the rule {@link unverifiedVerdictOf} follows for the publish record.
 * Limit: a record is missed only when it moves between its two names before each of these three reads, that is, a rewrite ends after the first read and the next rewrite or delete of that record begins before the third; the next check reads again. While a delete holds the record at its dropping name, that record still answers for the receipt, as a read right before its unlink would.
 * @param receiptPath - A `receipt.json` of the global storage.
 * @param platform - The platform whose file modes are judged.
 * @returns
 * - the read of the receipt's name, unless it found that name empty or the receipt is no MCP entry's
 * - for the MCP receipt's empty name: the read of its dropping name when it found something to parse there or failed to look; the read of the receipt's name once more when the dropping name is empty too; the first read otherwise (a file there that is no record never stands for the receipt)
 * @example
 * await readReceiptOrDropped('/storage/devin-mcp/receipt.json', 'darwin') // => { state: 'read', value: { installed: true, installationId: '…' }, sha256: '…' } while a rewrite holds the record at receipt.json.codebook-dropping
 */
async function readReceiptOrDropped(
  receiptPath: string,
  platform: NodeJS.Platform | undefined,
): Promise<PrivateJsonState> {
  const read = await readPrivateJsonState(receiptPath, platform)
  // Only an empty name of the MCP receipt may mean that its record stands at the dropping name.
  if (!isEmptyName(read) || !isMcpReceipt(receiptPath)) return read
  const atDropping = await readPrivateJsonState(
    `${receiptPath}${DROPPING_NAME_SUFFIX}`,
    platform,
  )
  // Both names empty: a rewrite may have published its new record after the first read.
  if (isEmptyName(atDropping))
    return readPrivateJsonState(receiptPath, platform)
  // The record held there, or a read that failed to look, answers for the receipt; a file there that is no record leaves it missing.
  return atDropping.state === 'removed' ? read : atDropping
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
 * - the state that keeps it: removed when a read at either name found such a note or a file it cannot read as a record (`unverified`, or that record's mode problem with its `recordPath`), which outranks `no-answer` when a read failed to look
 * @example
 * await unverifiedVerdictOf('/storage/devin-mcp/receipt.json', '9f86…', 'darwin') // => { state: 'removed', reason: 'unverified', receiptPath: '/storage/devin-mcp/receipt.json' } while pending.json, or pending.json.codebook-dropping, notes receipt.json unverified with other bytes
 */
async function unverifiedVerdictOf(
  receiptPath: string,
  receiptSha256: string,
  platform: NodeJS.Platform | undefined,
): Promise<KeptReceiptState | undefined> {
  // Only the MCP entry's receipt has a publish record beside it.
  if (!isMcpReceipt(receiptPath)) return undefined
  const recordPath = join(dirname(receiptPath), PUBLISH_RECORD_FILE)
  const droppingPath = `${recordPath}${DROPPING_NAME_SUFFIX}`
  const atRecord = await readPrivateJsonState(recordPath, platform)
  const atDropping = await readPrivateJsonState(droppingPath, platform)
  // Both names empty: a rewrite may have put its record back at its name after the first read.
  if (isEmptyName(atRecord) && isEmptyName(atDropping))
    return verdictOfRecordRead(
      await readPrivateJsonState(recordPath, platform),
      recordPath,
      receiptPath,
      receiptSha256,
    )
  const verdicts = [
    verdictOfRecordRead(atRecord, recordPath, receiptPath, receiptSha256),
    verdictOfRecordRead(atDropping, droppingPath, receiptPath, receiptSha256),
  ]
  // A name that keeps the receipt from standing outranks a read that failed to look.
  return (
    verdicts.find((verdict) => verdict?.state === 'removed') ??
    verdicts.find((verdict) => verdict !== undefined)
  )
}

/**
 * Looks at one of the Devin setup's receipts and says whether it stands, was removed (with the reason) or cannot be told; called by {@link readDevinInstallationId} and by `checkDevinBridgeReceipts`, so the bridge, the setup and the refresh judge a receipt the same way.
 * The MCP entry's receipt (`devin-mcp/receipt.json`) is read at its dropping name too when its name is empty (`receipt.json.codebook-dropping`, where a rewrite or delete holds it, {@link readReceiptOrDropped}), and stands only while Codebook's publish record beside it, at its name or at its dropping name (`pending.json.codebook-dropping`, where a rewrite or delete holds it), does not note that a put-back left a file there it did not verify, unless that file holds the very bytes the note names, the rule every setup, refresh and removal follows ({@link unverifiedVerdictOf}); that record is read only after the receipt answered installed.
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
  const read = await readReceiptOrDropped(receiptPath, platform)
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
