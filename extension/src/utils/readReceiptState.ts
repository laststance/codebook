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

/** What the config module appends to the name of the MCP entry's receipt for the dropping note of its move (its `DROPPING_NOTE_SUFFIX`, `droppingNotePathOf`): every rewrite or delete writes that note before it moves the record to its dropping name, and deletes it only once that name is empty again ({@link readNotedDropping}). */
const DROPPING_NOTE_NAME_SUFFIX = '.codebook-dropping-note'

/** One version of a record as a dropping note names it, mirroring the config module's `noteVersionSchema` (`devinMcpConfig.ts`): the inode as decimal digits and the SHA-256 of the bytes. */
const notedVersionSchema = z.object({
  ino: z.string().regex(/^\d+$/),
  sha256: z.string(),
})

/** The dropping note beside the MCP entry's receipt, mirroring the config module's `droppingNoteSchema` (`devinMcpConfig.ts`), so a note that module reads as no note proves nothing here either: `moved` names the version the move took to the dropping name, `published` a rewrite's new record. Only `moved.sha256` is compared ({@link readNotedDropping}); the inode is checked only by that module's run start (`provenDroppedRecord`), since the bounded read gives none. */
const droppingNoteSchema = z.object({
  moved: notedVersionSchema,
  published: notedVersionSchema.optional(),
})

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
 * - removed with `unverified` when the note names other bytes or none, or a file stands there that cannot be read as a record otherwise (a link, too large, no JSON, or a JSON value that is no object, which the config module's parse refuses as unreadable whatever its shape): Codebook cannot tell that no note stands
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
  // A JSON value that is no object is no record, as the config module's parse refuses it whatever its shape: Codebook cannot tell that no note stands.
  if (
    typeof read.value !== 'object' ||
    read.value === null ||
    Array.isArray(read.value)
  )
    return { state: 'removed', reason: 'unverified', receiptPath }
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

/** What the dropping note beside the MCP entry's receipt says of the record read at its dropping name, as {@link readNotedDropping} answers: `noted` when it names those very bytes, `unnoted` when no such note stands, `no-answer` when its read failed to look. */
type DroppingNoteVerdict = 'noted' | 'unnoted' | 'no-answer'

/**
 * Tells whether the record read at the MCP entry's receipt's dropping name is the one Codebook moved there: the dropping note beside it ({@link DROPPING_NOTE_NAME_SUFFIX}), which every rewrite or delete writes before its move, must be a private note of the config module's shape ({@link droppingNoteSchema}) that names the SHA-256 of those very bytes, the proof every setup, refresh and removal asks before it puts that file back (`putNotedRecordBack`, which refuses any other file there as one a backup or sync tool may have put back); called only by {@link readReceiptOrDropped}, once the dropping name held something to parse, so a check of a setup that stands or was removed reads no note.
 * Limit: the inode the note names is not compared, since the bounded read gives none, so a copy of the very bytes it names on another inode stands here, while the config module's run start refuses it.
 * @param receiptPath - The MCP entry's `receipt.json`.
 * @param droppedSha256 - The SHA-256 of the bytes read at its dropping name.
 * @param platform - The platform whose file modes are judged.
 * @returns
 * - `noted` when the note names those bytes as the version its move took there
 * - `unnoted` when no note stands there, the file there is no private note of that shape (a link, too large, readable by others, no JSON), or it names other bytes
 * - `no-answer` when the read of the note failed to look, so nothing is known
 * @example
 * await readNotedDropping('/storage/devin-mcp/receipt.json', 'cd…', 'darwin') // => 'noted' while a rewrite holds the record at receipt.json.codebook-dropping
 * await readNotedDropping('/storage/devin-mcp/receipt.json', 'cd…', 'darwin') // => 'unnoted' once a backup put a record there without its note
 */
async function readNotedDropping(
  receiptPath: string,
  droppedSha256: string,
  platform: NodeJS.Platform | undefined,
): Promise<DroppingNoteVerdict> {
  const read = await readPrivateJsonState(
    `${receiptPath}${DROPPING_NOTE_NAME_SUFFIX}`,
    platform,
  )
  if (read.state === 'no-answer') return 'no-answer'
  // An empty name, or a file there that is no private note, proves nothing.
  if (read.state === 'removed') return 'unnoted'
  const note = droppingNoteSchema.safeParse(read.value)
  // Only a note that names these very bytes proves that Codebook moved them there.
  return note.success && note.data.moved.sha256 === droppedSha256
    ? 'noted'
    : 'unnoted'
}

/**
 * Reads a receipt with the bounded read, and the MCP entry's receipt found missing also at its dropping name ({@link DROPPING_NAME_SUFFIX}), where Codebook's config module holds that record for a moment while it rewrites or deletes it and leaves it after a run that stopped inside one, until the next run puts it back; called only by {@link readReceiptState}, so a bridge check or a window's mark that lands in that moment reads that record instead of a removal.
 * A record there stands for the receipt only while the dropping note beside the receipt names its bytes ({@link readNotedDropping}), the proof every setup, refresh and removal asks before it takes that file back as its record, so a stale or restored file at that private name never marks a window or connects the bridge.
 * When both names read empty, a rewrite may have published its new record at the receipt's name between the two reads, so that name is read once more and decides, the rule {@link unverifiedVerdictOf} follows for the publish record; so does a record at the dropping name that no note names, since a rewrite may have published its new record and dropped that note between those reads.
 * Limits: a record is missed only when it moves between its two names before each of these reads, that is, a rewrite ends after the first read and the next rewrite or delete of that record begins before the last; the next check reads again. While a delete holds the record at its dropping name, that record still answers for the receipt, as a read right before its unlink would. A move whose note could not be written (the config module writes it best effort, for example on a full disk) reads as missing, as every later setup, refresh and removal refuses that file after a stop in it.
 * @param receiptPath - A `receipt.json` of the global storage.
 * @param platform - The platform whose file modes are judged.
 * @returns
 * - the read of the receipt's name, unless it found that name empty or the receipt is no MCP entry's
 * - for the MCP receipt's empty name: the read of its dropping name while it found a record there that the dropping note names, or failed to look; no answer when the note's read failed to look; the read of the receipt's name once more when the dropping name is empty too, or holds a record no note names; the first read otherwise (a file there that is no record never stands for the receipt)
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
  // A read that failed to look answers for the receipt; a file there that is no record leaves it missing.
  if (atDropping.state !== 'read')
    return atDropping.state === 'no-answer' ? atDropping : read
  const verdict = await readNotedDropping(
    receiptPath,
    atDropping.sha256,
    platform,
  )
  // The record the note names answers for the receipt; a note that could not be read leaves it unknown.
  if (verdict === 'noted') return atDropping
  if (verdict === 'no-answer') return { state: 'no-answer' }
  // A record no note names is none Codebook moved there, or its rewrite published the new record and dropped the note after the first read.
  return readPrivateJsonState(receiptPath, platform)
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
 * The MCP entry's receipt (`devin-mcp/receipt.json`) is read at its dropping name too when its name is empty (`receipt.json.codebook-dropping`, where a rewrite or delete holds it, while the dropping note beside it names that file's bytes, {@link readReceiptOrDropped}), and stands only while Codebook's publish record beside it, at its name or at its dropping name (`pending.json.codebook-dropping`, where a rewrite or delete holds it), does not note that a put-back left a file there it did not verify, unless that file holds the very bytes the note names, the rule every setup, refresh and removal follows ({@link unverifiedVerdictOf}); that record is read only after the receipt answered installed.
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
