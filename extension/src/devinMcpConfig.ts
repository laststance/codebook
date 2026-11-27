import { createHash, randomUUID } from 'node:crypto'
import { lstatSync, type BigIntStats } from 'node:fs'
import {
  link,
  lstat,
  mkdir,
  open,
  rename,
  rm,
  unlink,
  type FileHandle,
} from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'

import { z } from 'zod'

import {
  DEVIN_MCP_CONFIG_LIMIT_BYTES,
  DEVIN_MCP_RECORD_LIMIT_BYTES,
  DEVIN_RECEIPT_PUT_BACK_ATTEMPTS,
  FIRST_SETUP_HASH_PREFIX,
  PRIVATE_FILE_MODE,
} from './constants'
import { atomicPrivateWrite } from './utils/atomicPrivateWrite'
import { canonicalJson } from './utils/canonicalJson'
import { hasDuplicateJsonMember } from './utils/hasDuplicateJsonMember'
import { hasPrefixWithSha256 } from './utils/hasPrefixWithSha256'
import { isSameFileId } from './utils/isSameFileId'
import { openWithoutFollowing } from './utils/openWithoutFollowing'
import { plainEntryHashOf } from './utils/plainEntryHashOf'
import { readUpToLimit } from './utils/readUpToLimit'
import { recordedFileId, type RecordedFileId } from './utils/recordedFileId'
import { withStorageLock } from './utils/withStorageLock'

/** The one MCP server Codebook adds to Devin Desktop's user config. */
const SERVER_NAME = 'codebook'

/** The way out that ends every refusal of a setup or an activation refresh. */
const SET_UP_AGAIN = 'then run Codebook: Set Up AI Chat again'

/** The way out that ends every refusal of the removal. */
const REMOVE_AGAIN = 'then run Codebook: Remove Devin Desktop Setup again'

/** The stdio server Devin Local launches for Codebook: an absolute Node, the bridge and the agent folder; it never holds a token. */
export type DevinMcpEntry = {
  command: string
  args: string[]
  env: Record<string, string>
}

/** What a test can hook into: called after the config was read and before it is replaced, so a test can change the file in between ({@link assertConfigUnchanged}). */
export type DevinMcpTestSeam = {
  afterRead?: () => Promise<void> | void
  /** Called right after the identity check and before the config is linked aside, renamed or created, so a test can land a save in the window the check cannot see. */
  afterCheck?: () => void
  /** Called right after the new config was linked in (a removal: right after the comparison) and before the displaced and staged names are cleaned up, with the displaced path (undefined for a create), so a test can make that cleanup fail or write into the old file the way a writer that kept it open would. */
  afterPublish?: (displacedPath: string | undefined) => void
  /** Called right after the config was moved to its private name and opened, and before that file is compared, so a test can land a save at the config name, write into the moved file or look at its permissions. */
  afterMoveAside?: (displacedPath: string) => void
  /** Called after the comparison succeeded and before the new file is linked in, so a test can land a save in that window. */
  afterCompare?: () => void
  /** Called right after a file's size was checked and before its bytes are read, with that file's path, so a test can make the file grow in between. */
  afterStat?: (path: string) => void
  /** Called right before recovery looks again at a leftover's name ({@link isLeftoverStill}) with that name, so a test can swap the file there between the first look and the link, unlink or rename. */
  beforeLeftoverCheck?: (path: string) => void
  /** Called right after that second look passed and before the link, unlink or rename it guards, so a test can swap the file in the gap the second look cannot close. */
  afterLeftoverCheck?: (path: string) => void
  /** Called for every write of a receipt or pending record ({@link writeRecord}, {@link writeReceipt}), with the record's path and the value about to be written, after its bytes were flushed to a temporary file and before the rename (a tracked record's rewrite: its move to the dropping name and the link) publishes them, or for a claim of a rollback journal's or the receipt's empty name before the link publishes them ({@link claimJournal}, {@link claimReceiptName}); for the receipt, before the look at its name that decides between them; a throw cancels that write and leaves the previous record byte for byte, as a full disk at the temporary file does. */
  beforeRecordWrite?: (write: { path: string; record: unknown }) => void
}

/** A file number as a record holds it: a number up to 2^53 and its digits as text above ({@link recordedFileId}). */
const fileIdSchema = z.union([z.number(), z.string()])

const receiptSchema = z.object({
  schemaVersion: z.literal(1),
  targetPath: z.string(),
  /** Hash of the entry Codebook wrote, without the keys Devin manages ({@link coreHashOf}); a receipt of an older build holds the hash of the whole entry, which still counts ({@link ownsEntry}). */
  entrySha256: z.string(),
  createdFile: z.boolean(),
  installed: z.boolean(),
  /** Random id of the write that made this entry, so a rollback never removes a newer setup's entry. */
  generation: z.string(),
  /** Random id of this setup's installation: made where no receipt stands, carried over by every managed rewrite (an update changes the generation, never this id) and gone with the receipt, so a bridge can tell a removed setup from an updated one ({@link installationIdOf}). A receipt of an older build has none until the next activation refresh ({@link withInstallationId}). */
  installationId: z.string().optional(),
  /** The inode of the config Codebook last wrote; the file counts as Codebook's own only while it still matches. An older receipt also holds a device number, which is ignored. */
  config: z.object({ ino: fileIdSchema }),
  /** Set by an adoption ({@link adoptPending}): the receipt rests on the entry's hash alone, not on its setup's own word, so it never keeps its generation's entry from a take-back that a record of that setup asks for ({@link isTakeBackCovered}), also when the adoption could not take it back out ({@link withdrawAdoptedReceipt}); every rewrite of the receipt keeps it, and a new setup's receipt has none. Released builds read past it and drop it when they rewrite the receipt. */
  adopted: z.literal(true).optional(),
})
/** What a first setup's publish record of this build holds about the old receipt it moves aside ({@link Pending.retiresReceipt}); an object, which 0.2.142.0, 0.2.143.0 and 0.2.144.0 all refuse as unreadable before they look at the old receipt's private name. */
const retiredReceiptSchema = z.object({
  /** SHA-256 of the old receipt's bytes as the setup read them through one handle right before its first record ({@link readRetiringReceipt}): only a file with these bytes at the private name is put back or deleted ({@link isMovedFile}). Absent in a record this build rewrote from an older build's, which names no bytes ({@link foreignKeptRecordOf}). */
  sha256: z.string().optional(),
  /** Set right before a put-back's link or rename into an empty `receipt.json`, naming the bytes that put-back puts there ({@link noteBeforePutBack}), so a run that stops right after it leaves the note; gone again when nothing reached that name ({@link withdrawPutBackNote}), and kept once the look after the link or rename found a file there that Codebook did not verify as that record ({@link refuseUnverifiedLink}, {@link confirmRenamedRecord}): until `receipt.json` holds those very bytes again or is empty, no run takes that file for its record ({@link assertReceiptVerified}), and the bridge's receipt reader treats it as removed. */
  receiptUnverified: z.literal(true).optional(),
})
const pendingSchema = z.object({
  targetPath: z.string(),
  /** Hash of the entry a write was about to publish; absent for a removal. A first setup's carries the {@link FIRST_SETUP_HASH_PREFIX} before it, so an older build, which adopts only an entry whose hash equals this one, never adopts it; {@link plainEntryHashOf} strips it. */
  entrySha256: z.string().optional(),
  createdFile: z.boolean(),
  /** The id of the write or removal; every private name beside the config holds it ({@link journalNameOf}), and recovery accepts no other name. */
  generation: z.string().optional(),
  /** The installation id the publish chose for its receipt ({@link publishEntry}), so a run that adopts the entry after a crash writes the same id; absent for a removal and for a record of an older build. */
  installationId: z.string().optional(),
  /** The inode of the staged file before it was published; the config is Codebook's own only if it still has it. The probe link has this inode too. */
  stagedIno: fileIdSchema.optional(),
  /** The bare name of the staged file, and the hash of the bytes it must hold; a crash leaves it. */
  stagedName: z.string().optional(),
  stagedSha256: z.string().optional(),
  /** The bare name of the hard-link probe, written here before the probe is created. */
  probeName: z.string().optional(),
  /** The bare name the config is moved to during the step, the inode it had and the hash of the bytes it must hold. */
  keptName: z.string().optional(),
  keptIno: fileIdSchema.optional(),
  keptSha256: z.string().optional(),
  /** Absent while a write or removal is in progress (a displaced config goes back when the config name is empty); `completed` once the config was published or removed (a copy that stays is a leftover, never put back); `handed` once a copy was named to the learner (a refusal or `cleanupFailure`), which later runs never delete, whatever its bytes. */
  phase: z.enum(['completed', 'handed']).optional(),
  /** Set once a cut-short rollback of this publish was settled ({@link settleRollbackJournal}): the entry it published must be taken back ({@link finishCutShortSetup}), never adopted ({@link settlePending}). It lives here, not in the rollback's journal, because the take-back writes (and may delete) its own journal at that path. Gone once the take-back ended; an older build drops it. */
  takeBack: z.boolean().optional(),
  /** Only in a rollback's own journal ({@link rollbackContextOf}): the generation of the publish whose entry that rollback was taking out. {@link settleRollbackJournal} marks a publish record for take-back only when it carries this generation, so a journal left by one installation never marks another's pending publish. */
  publishGeneration: z.string().optional(),
  /** Set by a first setup (no receipt owned an entry that stood, {@link isFirstSetup}) in its publish record before anything is published: its entry may be adopted only once its own receipt exists, so a run that finds the record without a same-generation receipt takes the entry back ({@link isTakeBackOwed}). Absent for an update, a removal and a record of an older build. */
  firstSetup: z.boolean().optional(),
  /** Set by a first setup whose stale receipt stood ({@link isFirstSetup}), before anything is published: right before its link that receipt moves to its private name ({@link retiredReceiptPathOf}), and it goes back to `receipt.json` when the link fails, never over a newer receipt ({@link putBackRetiredReceipt}). A run that finds the private name settles it the same way ({@link settleRetiredReceipt}). This build writes the object form from the first record on, which names the bytes of the receipt that moves ({@link retiredReceiptSchema}), so only that file is ever put back or deleted ({@link movedIdentityOf}). `true` (0.2.142.0 to 0.2.144.0) and `foreign` (0.2.144.0, once a run kept a file there it did not verify) name no bytes: this build never puts back or deletes the file such a record leads to. Where it would put that file back, it keeps it, names it and rewrites that record as an object without bytes ({@link foreignKeptRecordOf}); one file at both names keeps both names and rewrites that record with the note that `receipt.json` is unverified ({@link keptRecordOf}), for `true` as for `foreign` and this build's record without bytes, because the correct stopped put-back of such a version and another installation's record swapped into the private name inside that put-back's link leave the same state when the record names no bytes the file could be verified against; where it would delete it (that setup's own receipt stands, {@link isPublishReceipted}, its link is proven, {@link isProvenLink}, or the config holds its publish, {@link retiredReceiptFateOf}), it leaves that file at its private name without naming it, and the publish record then ends, so nothing leads there any more ({@link dropRetiredReceipt}). 0.2.142.0, 0.2.143.0 and 0.2.144.0 refuse the object form as unreadable before they look at that name, also when a later write of the record fails and leaves the first one; builds before them drop the field. Absent for every other publish. */
  retiresReceipt: z
    .union([z.boolean(), z.literal('foreign'), retiredReceiptSchema])
    .optional(),
  /** Set by a first setup whose link failed or never ran while its old receipt could not go back ({@link linkWithoutStaleReceipt}): nothing of that publish was linked, so a later run puts that receipt back whatever inode the config shows and takes nothing back ({@link settleRetiredReceipt}, {@link finishCutShortSetup}). Written after the failed put-back, best effort: a record without it is undecided when the config holds that receipt's entry ({@link retiredReceiptFateOf}). An older build drops it. */
  notLinked: z.literal(true).optional(),
  /** Set, with `phase: 'handed'`, right before the link of a put-back that only the displaced file's bytes prove ({@link putBackDisplaced}): a run that stops before the check leaves a record that older builds read as handed and never delete from, while this build reads it as in progress ({@link leftoverPhaseOf}) and checks the shared bytes before it deletes the private name ({@link assertSharedPutBackBytes}). It stays while that name is a second name of the config that no check cleared ({@link recordAfterRecovery}); gone once the check passed and the name is gone, when the put-back failed before such a second name stood ({@link restoreUnlessSecondName}), or when the copy was handed over ({@link handedRecordOf}); an older build drops it. */
  bytesUnverified: z.boolean().optional(),
})
type Receipt = z.infer<typeof receiptSchema>
type Pending = z.infer<typeof pendingSchema>
/** One version of a tracked record as its dropping note names it ({@link droppingNoteSchema}): the inode as decimal digits and the SHA-256 of the bytes. */
const noteVersionSchema = z.object({
  ino: z.string().regex(/^\d+$/),
  sha256: z.string(),
})
/** The note a rewrite or delete of a tracked record writes beside it (`<record>.codebook-dropping-note`, {@link noteDroppingMove}) before its last looks and the move to its dropping name: the version that move takes there, and for a rewrite the version it publishes at the record's name, so the next run puts back only that file, or deletes it only beside that new record ({@link settleDroppedRecord}). 0.2.144.0 and earlier never read or write it. */
const droppingNoteSchema = z.object({
  /** The version the last looks found at the record's name: its inode and the hash of its bytes. */
  moved: noteVersionSchema,
  /** A rewrite's staged file, which it publishes at the record's name once the old version moved: its inode and the hash of its bytes. Absent for a delete. */
  published: noteVersionSchema.optional(),
})
type DroppingNote = z.infer<typeof droppingNoteSchema>
/** What a run knows about a pending record before the file is staged. */
type PendingHead = Pick<
  Pending,
  'entrySha256' | 'createdFile' | 'generation' | 'installationId' | 'firstSetup'
>
/** A parsed JSON object; its own keys, `__proto__` included, are kept as parsed. */
type JsonObject = Record<string, unknown>

/** Size, times and the inode that tell whether a file is still the one that was read; the inode alone names the file, because a volume can get another device number after a restart. */
type FileIdentity = {
  ino: bigint
  size: bigint
  /** The modification and change times in nanoseconds, so a write within the same millisecond is seen as well ({@link assertConfigUnchanged}). */
  mtimeNs: bigint
  ctimeNs: bigint
  /** The permission bits (`mode & 0o777`) the file had when it was read; a replacement keeps only the owner's of them. */
  mode: number
  /** How many names the inode had when it was read; more than one means another path reaches the same file ({@link assertSingleLink}). */
  nlink: bigint
}

/** The part of a config file's identity that proves it is still the file one read: its inode, size and modification and change times in nanoseconds. */
type ConfigContinuity = Pick<
  FileIdentity,
  'ino' | 'size' | 'mtimeNs' | 'ctimeNs'
>

type ConfigLook =
  | { kind: 'absent' }
  | {
      kind: 'present'
      root: JsonObject
      servers: JsonObject | undefined
      identity: FileIdentity
      /** SHA-256 of the bytes that were read, to tell a save made meanwhile from the file that was read. */
      sha256: string
      /** Digest of the same JSON bytes before any extra trailing line breaks, used only by legacy take-back. */
      sha256BeforeExtraLineBreaks: string | undefined
      /** Whether a number of the file would change when written back ({@link parseConfig}). */
      hasLossyNumber: boolean
    }

/** Everything one locked run needs about the target and the records. */
type Context = {
  path: string
  receiptPath: string
  pendingPath: string
  entry: DevinMcpEntry | undefined
  entryHash: string | undefined
  seam: DevinMcpTestSeam | undefined
  /** The command a refusal asks the learner to run again: the setup's or the removal's. */
  retry: string
  /** Set only on a rollback's context ({@link rollbackContextOf}): the generation of the publish being rolled back, recorded in every journal that context writes ({@link Pending.publishGeneration}). */
  rollbackOf?: string
  /** Set only on a take-back's context ({@link rollbackContextOf} with a generation) whose run tracks the `pending.json` it read ({@link trackedPublishContext}), or, for a first setup's take-back, the mark it wrote there or, when that mark could not be written, the version it last wrote there ({@link markBeforeTakeBack}): that run, so the take-back moves the config aside or away only while that record, which proves the entry is the failed setup's, still stands as the run read or last wrote it ({@link assertTakeBackRecordStill}). */
  takeBackRecordRun?: Context
  /** Set on the context {@link settleRollbackJournal} settles a journal with and on every take-back's context ({@link rollbackContextOf} with a generation), which makes their pending path a tracked journal, and for the rest of {@link inspect} on every run that read a `pending.json`, which tracks that record the same way: a run that holds a legacy journal the version that journal's decision read ({@link heldPublishContext}), any other the version its own read saw ({@link trackedPublishContext}): the version of the record that run read (none for a take-back, whose first write claims the name), replaced by each version it writes at its pending path ({@link writeRecord}) and cleared once it deleted that record itself ({@link dropTrackedJournal}). After {@link inspect}, the setup's and the refresh's publish, the removal and the removal retry track their own `pending.json` the same way, from the version inspect left there ({@link ownRecordContext}, {@link ownRecordContext}). Every write and delete there looks at the name first and once more right before its rename or unlink, and goes on only while the name shows this version, or is empty; otherwise it throws a {@link JournalConflictError} and leaves the name as it is ({@link lookAtTrackedJournal}, {@link assertTrackedJournalStill}). A write while no version is known claims the name, never replacing what stands there ({@link claimJournal}), and so does a write at a rollback journal's or a removal's own record's name found empty; a publish record's name found empty, also a setup's or refresh's own record's, is refused instead (`refusesEmptyName`). */
  journalVersion?: {
    current: RecordVersion | undefined
    /** Set when the tracked record is the publish record a decision read ({@link heldPublishContext}, {@link markTakeBackOwed}), `pending.json` as a run read it ({@link trackedPublishContext}) or a run's own record as its publish or removal read or wrote it ({@link ownRecordContext}): while a version is known, an empty name means that record disappeared after the read or the write, so a write there throws a `gone` {@link JournalConflictError} instead of writing the record back ({@link writeTrackedJournal}). A rollback journal's tracker leaves it unset: that journal is this run's own record of what it still tracks, so a write claims its empty name again. */
    refusesEmptyName?: true
  }
  /** The version of `receipt.json` the run's decisions rest on: the inode and bytes' hash its one read in {@link settleAfterRecovery} saw there (none for an empty name), replaced by each receipt this run publishes ({@link writeReceipt}), and cleared once this run deleted that receipt ({@link dropReceipt}) or moved it aside before a first setup's link ({@link retireStaleReceipt}). Every write there replaces only this version, or claims the name while none is known, and refuses an empty name while one is known (another program moved that record away, {@link writeReceipt}); every delete removes only this version, so a record a backup or sync tool puts at that name after the read stays. One object per locked run ({@link inLockedFolder}), shared by every context derived from it. */
  receiptVersion: {
    current: RecordVersion | undefined
    /** Set by {@link settleAfterRecovery} when its read found at `receipt.json` a valid record of the entry in another config (the config path that record names, as when Codebook's storage folder was copied from another home folder): that name is occupied, never empty, so no write or delete of this run replaces or removes that record ({@link writeReceipt}, {@link dropReceipt}), a setup refuses before it publishes ({@link publishEntry}) and a removal that changed nothing refuses, both naming that record ({@link otherConfigReceiptRefusal}). */
    otherConfigPath?: string
    /** Set by {@link assertReceiptVerified} while the publish record as read notes that a put-back left a file Codebook did not verify at `receipt.json`, and cleared by {@link settleAfterRecovery} once its read of that name passed it: every read of that name the run decides on until then passes only an empty name or the very bytes the note names ({@link assertNotedReceipt}). */
    unverifiedNote?: UnverifiedReceiptNote
  }
}

/** A publish record's note that a put-back left a file Codebook did not verify at `receipt.json` (`receiptUnverified`, {@link retiredReceiptSchema}) as a run holds it ({@link Context.receiptVersion}): the hash of the old record's bytes the note names (none for a record that names no bytes) and that old record's private name, which the refusal names. */
type UnverifiedReceiptNote = { sha256: string | undefined; retiredPath: string }

/** A copy of the config that Codebook keeps for a moment, and what it must hold. */
type KeptCopy = { path: string; sha256: string; ino: bigint }

/** The numbers a receipt records for the config Codebook wrote. */
type ConfigNumbers = Receipt['config']

/**
 * Names where Devin Desktop reads its user-level MCP servers; called by the setup, the activation refresh and the removal of Devin Desktop, which refuse Windows before they ask.
 * @param homeRoot - The home folder; the real one unless a test names its own.
 * @returns `<home>/.config/devin/mcp_config.json` (macOS and Linux).
 * @example
 * devinMcpConfigPath('/home/lume') // => '/home/lume/.config/devin/mcp_config.json'
 */
export function devinMcpConfigPath(homeRoot = homedir()): string {
  return join(homeRoot, '.config', 'devin', 'mcp_config.json')
}

/** SHA-256 of a value's canonical JSON, so a reordering of keys keeps ownership. */
function hashOf(value: unknown): string {
  return createHash('sha256')
    .update(canonicalJson(value) ?? '')
    .digest('hex')
}

/** SHA-256 of raw bytes. */
function bytesSha256(bytes: string | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** The keys Devin Desktop itself sets on a server entry (its Customize toggles); a rewrite keeps them and they never change ownership. */
const DEVIN_MANAGED_KEYS: ReadonlySet<string> = new Set([
  'disabled',
  'disabledTools',
])

/**
 * Hashes the entry without the keys Devin manages itself, so a toggle in Customize never changes ownership while any other key added to the entry does.
 * @param value - The `codebook` entry as parsed.
 * @returns The canonical hash of the entry without `disabled` and `disabledTools`; undefined when the entry is no object.
 * @example
 * coreHashOf({ command: 'node', args: [], env: {}, disabled: true }) === coreHashOf({ command: 'node', args: [], env: {} }) // => true
 * coreHashOf({ command: 'node', args: [], env: {}, timeout: 30 }) === coreHashOf({ command: 'node', args: [], env: {} }) // => false
 */
function coreHashOf(value: unknown): string | undefined {
  if (!isJsonObject(value)) return undefined
  return hashOf(
    Object.fromEntries(
      Object.entries(value).filter(([key]) => !DEVIN_MANAGED_KEYS.has(key)),
    ),
  )
}

/**
 * Tells whether a receipt covers the entry that stands in the config.
 * @param current - The `codebook` entry as parsed.
 * @param receipt - The receipt that stands.
 * @returns `true` when the entry without `disabled` and `disabledTools` matches, or the hash of the whole entry matches (a receipt of an older build); any other added key is an edit.
 * @example
 * ownsEntry({ command: 'node', args: [], env: {}, disabled: true }, receiptOfThatEntry) // => true
 */
function ownsEntry(current: unknown, receipt: Receipt): boolean {
  return (
    receipt.entrySha256 === coreHashOf(current) ||
    receipt.entrySha256 === hashOf(current)
  )
}

/**
 * Builds the one-sentence refusal every unsafe state ends in.
 * @param found - What Codebook found.
 * @param path - The config file.
 * @param fix - What the learner does.
 * @param retry - The command to run afterwards ({@link SET_UP_AGAIN} or {@link REMOVE_AGAIN}).
 * @param cause - The failure behind the refusal, kept for diagnosis and never put into the sentence.
 * @returns The error, not thrown yet.
 * @example
 * throw refusal('text that is not valid JSON', path, 'fix it', SET_UP_AGAIN)
 */
function refusal(
  found: string,
  path: string,
  fix: string,
  retry: string,
  cause?: unknown,
): Error {
  return new Error(
    `Codebook found ${found} in Devin Desktop's MCP config at ${path} and left that file untouched; ${fix}, ${retry}.`,
    cause === undefined ? undefined : { cause },
  )
}

/** The refusal for a config that another writer changed while Codebook worked on it. */
function changedWhileWorking({ path, retry }: Context): Error {
  return refusal(
    'a file that changed while Codebook was working on it',
    path,
    'look at the file',
    retry,
  )
}

/** What a refusal that names a private file beside a config that may stand asks the learner ({@link leftCopyRefusal}, {@link otherInodeRefusal}): a config there may hold settings that file never had, so the file goes back only to an empty config path; otherwise the learner moves only the settings they need, never that file over the config. */
const LEFT_COPY_ADVICE =
  'look at both files before you use either: if no file stands at the config path, move that copy back there; otherwise compare the two, move only the settings you need from that copy into the config, never that copy over the config, and afterwards delete that copy or move it elsewhere'

/** The refusal for a copy of the config that Codebook kept and cannot settle: it stays where it is, named here. A config may stand at the config path meanwhile (an editor's save, or a file another program put there) and hold settings the copy never had, so the copy goes back only to an empty config path; otherwise the learner moves only the settings they need, never the copy over the config ({@link LEFT_COPY_ADVICE}). */
function leftCopyRefusal(
  { path, retry }: Context,
  copyPath: string,
  cause?: unknown,
): Error {
  return refusal(
    `a copy of your config that Codebook kept at ${copyPath} and could not settle`,
    path,
    LEFT_COPY_ADVICE,
    retry,
    cause,
  )
}

/** The refusal for a removal that found a config at the config name again after it moved the old one aside (an editor saved meanwhile): that config stays untouched and the receipt stays. */
function savedAgainRefusal({ path, retry }: Context): Error {
  return refusal(
    'a config that was saved again while Codebook removed its entry',
    path,
    'look at the file',
    retry,
  )
}

/** The refusal for a step that could not write Codebook's own record: nothing was removed, and the receipt stays. */
function recordFailureRefusal({ path, retry }: Context, cause: unknown): Error {
  return refusal(
    'that Codebook could not write its own record of the change, so it changed nothing',
    path,
    'make room for that record',
    retry,
    cause,
  )
}

/** A file that stays beside the config, and what it holds: `previous` is the config as it was before the write or removal, `new` the staged config that was published. */
type KeptFile = {
  path: string
  holds: 'previous' | 'new'
  /** Set for a copy of the previous config that stays under a name a record on disk still holds ({@link discardDisplaced}, {@link keepFromRecovery}, {@link publishEntry}): a later run deletes it while it still holds exactly the bytes Codebook moved aside, and the sentence that names it says so ({@link LEFTOVER_CLAUSE}). */
  isLeftover?: true
  /** Set for a copy of the previous config whose record Codebook could not read back after another program changed, moved away or made unreadable that record ({@link recordedCopyFateOf}): a later run may still delete it, and the sentence that names it says so ({@link UNCONFIRMED_CLAUSE}). */
  isUnconfirmed?: true
  /** Set for the private name of a copy of the previous config where another program put another file before Codebook could move the copy out of recovery's reach ({@link keepFromRecovery}), or for the name the move linked such a file to ({@link moveWithoutReplacing}): the sentence that names it says that the file there is no longer that copy ({@link replacedCopySentence}). */
  isReplaced?: true
  /** Set for the staged name of a config Codebook published that the config name no longer reaches (another file, or none, stands there) and that holds bytes written into that config after the link ({@link dropPublishedStage}): it may hold the only copy of those changes, and the sentence that names it says so ({@link editedApartSentence}). */
  isEditedApart?: true
}

/** The words that name a kept copy of the previous config, for a refusal and for {@link cleanupFailureOf}. */
function keptCopyPhrase(copyPath: string): string {
  return `a private copy of your previous Devin MCP config at ${copyPath} (it holds the settings of your other servers)`
}

/** What happens next to a kept copy that a record on disk still holds ({@link KeptFile.isLeftover}), said wherever such a copy is named instead of the advice to delete it. */
const LEFTOVER_CLAUSE =
  'but Codebook still tracks that copy, so a later run of Codebook deletes it while it still holds exactly your previous config; copy it elsewhere to keep it'

/** What may happen next to a kept copy of the previous config whose record could not be read back as one of this config that names it and still lets a later run delete it ({@link unrecordedRemovalRefusal}, {@link unsettledRefusal}): another program may have replaced, removed or restored that record, so the sentence promises neither the delete nor that the copy stays. */
const UNCONFIRMED_CLAUSE =
  'but Codebook could not confirm that its record still tracks that copy, so a later run of Codebook may delete it while it still holds exactly your previous config; copy it elsewhere to keep it'

/**
 * The refusal for a config that appeared while Codebook was replacing yours: that config stays, and so does the displaced copy, because a writer may still hold the old file open; called by {@link linkInStaged} and by recovery for a copy it handed over.
 * @param context - The run; gives the config path and the command to run again.
 * @param copyPath - The displaced copy's private name.
 * @param isHanded - Whether the handed record was written or the record dropped ({@link handOver}); `false` when the record written before the move-aside stays, so a later run that finds the config name empty puts the copy back there ({@link putBackDisplaced}).
 * @returns The error, not thrown yet.
 * @example
 * newConfigRefusal(context, copyPath, false) // => '… Codebook kept … but it could not record that it leaves that copy to you, so a later run of Codebook moves that copy back to … if no file stands there by then, then run Codebook: Set Up AI Chat again.'
 */
function newConfigRefusal(
  { path, retry }: Context,
  copyPath: string,
  isHanded = true,
): Error {
  const fate = isHanded
    ? 'so delete that copy when you no longer need it'
    : `but it could not record that it leaves that copy to you, so a later run of Codebook moves that copy back to ${path} if no file stands there by then`
  return refusal(
    'a file that changed while Codebook was working on it',
    path,
    `look at the file; Codebook kept ${keptCopyPhrase(copyPath)}, ${fate}`,
    retry,
  )
}

/**
 * Tells whether a folder stands where a refusal is about to name a private file; called by {@link completedLeftRefusal} and {@link bothFilesRefusal} at the refusal's construction, so the sentence is worded for what stands there then: another program or the learner may have put a folder where Codebook's private file stood, and the advice to delete that file, followed recursively on a folder, can destroy the learner's files.
 * The look is synchronous and runs in the same uninterrupted step as the refusal's construction, as at a record's name ({@link receiptConflictSentence}); a look that fails proves nothing, so the file sentence stays.
 * @param path - The private name the refusal names.
 * @returns `true` only when a folder stands there; `false` when nothing or a non-folder stands there or the look throws.
 * @example
 * isFolderAt('/h/.config/devin/mcp_config.json.<generation>.tmp') // => true when a folder stands at that name
 */
function isFolderAt(path: string): boolean {
  try {
    return lstatSync(path, { throwIfNoEntry: false })?.isDirectory() === true
  } catch {
    return false
  }
}

/**
 * The refusal, said once, for a leftover of a publish or removal that already finished and that Codebook cannot prove unchanged or cannot delete. When a folder stands where the leftover's file stood ({@link isFolderAt}), the sentence names a private folder instead and its way out moves that folder to another folder, never delete it, because it may hold files of yours — the way out a folder at a record's name already gets ({@link receiptConflictSentence}): Codebook never wrote a folder there, so the sentence never claims it holds a copy of the config, and deleting it recursively could destroy the learner's files.
 */
function completedLeftRefusal(
  { path, retry }: Context,
  copyPath: string,
  cause?: unknown,
): Error {
  // A folder where the leftover's file stood is never Codebook's: it is moved aside intact, never deleted.
  if (isFolderAt(copyPath))
    return refusal(
      `a private folder at ${copyPath} that Codebook left after its last change and could not delete`,
      path,
      'move that folder to another folder, never delete it, because it may hold files of yours',
      retry,
      cause,
    )
  return refusal(
    `a private file at ${copyPath} that Codebook left after its last change and could not delete (it holds a copy of your Devin MCP config, including the settings of your other servers)`,
    path,
    'delete that file when you no longer need it',
    retry,
    cause,
  )
}

/** The refusal for a pending record that names a file Codebook did not make beside the config; nothing it names is touched. */
function journalRefusal({ path, pendingPath, retry }: Context): Error {
  return new Error(
    `Codebook's Devin Desktop MCP record at ${pendingPath} names a file that Codebook did not make beside the config at ${path}, so nothing was moved, linked or deleted; remove that record, ${retry}.`,
  )
}

/**
 * Says that the private name of a copy of the previous config shows another program's file now ({@link KeptFile.isReplaced}), instead of naming that file the previous config; used by {@link keptFileSentence}, {@link alsoKeptSentence} and, for a copy recovery handed over ({@link Unsettled.isReplaced}), {@link unsettledRefusal}.
 * @param path - The private name.
 * @returns One sentence that names the path and asks the learner to look at the file before using or deleting it.
 * @example
 * replacedCopySentence('/h/.config/devin/mcp_config.json.<generation>.codebook-displaced') // => 'Another program replaced the private copy … so look at it before you use or delete it.'
 */
function replacedCopySentence(path: string): string {
  return `Another program replaced the private copy of your previous Devin MCP config that Codebook kept at ${path}, so the file at that path is no longer that copy; Codebook left that file untouched, so look at it before you use or delete it.`
}

/**
 * Says that the staged name of the config Codebook just published stays because it holds changes written into that config after the link while another file, or none, stands at the config path ({@link KeptFile.isEditedApart}), so it may hold the only copy of those changes; used by {@link keptFileSentence}, {@link alsoKeptSentence} and {@link unrecordedRemovalRefusal}.
 * @param path - The staged name.
 * @returns One sentence that names the path and asks the learner to look at the file before deleting it, moving only the settings they need into the config.
 * @example
 * editedApartSentence('/h/.config/devin/mcp_config.json.<generation>.tmp') // => 'Codebook kept the Devin MCP config it just wrote at …: changes were written into that config after Codebook put it in place, …'
 */
function editedApartSentence(path: string): string {
  return `Codebook kept the Devin MCP config it just wrote at ${path}: changes were written into that config after Codebook put it in place, and another file, or none, stands at the config path now, so that file may hold the only copy of those changes and of the settings of your other servers; look at it before you delete it, and move only the settings you need from it into the config.`
}

/** One sentence for a kept file that could not be deleted; the work itself is done. A copy a record on disk still holds says that a later run deletes it ({@link LEFTOVER_CLAUSE}), one whose record could not be read back that a later run may ({@link UNCONFIRMED_CLAUSE}), instead of leaving it to the learner; a name another program put another file at says so ({@link replacedCopySentence}), and a published config's staged name that holds changes the config name no longer reaches says that ({@link editedApartSentence}). */
function keptFileSentence(kept: KeptFile): string {
  const { path, holds, isReplaced } = kept
  if (isReplaced) return replacedCopySentence(path)
  if (kept.isEditedApart) return editedApartSentence(path)
  const what =
    holds === 'previous'
      ? keptCopyPhrase(path)
      : `a private copy of the Devin MCP config it just wrote at ${path} (it holds the settings of your other servers)`
  const next = copyFateClause(kept, '; delete it when you no longer need it')
  return `Codebook kept ${what} because it could not delete that file safely${next}.`
}

/**
 * Words what happens next to a kept copy of the previous config, as the record on disk leaves it; the shared end of {@link keptFileSentence} and {@link alsoKeptSentence}.
 * @param kept - The copy, with what the record on disk still does with it.
 * @param otherwise - The ending for a copy no record lets a later run delete.
 * @returns
 * - `, ` and the {@link LEFTOVER_CLAUSE} for a copy a record on disk still holds ({@link KeptFile.isLeftover})
 * - `, ` and the {@link UNCONFIRMED_CLAUSE} for a copy whose record could not be read back ({@link KeptFile.isUnconfirmed})
 * - `otherwise` for every other copy
 * @example
 * copyFateClause({ path, holds: 'previous', isUnconfirmed: true }, '; delete it when you no longer need it') // => ', but Codebook could not confirm that its record still tracks that copy, …'
 */
function copyFateClause(
  { isLeftover, isUnconfirmed }: KeptFile,
  otherwise: string,
): string {
  if (isLeftover) return `, ${LEFTOVER_CLAUSE}`
  return isUnconfirmed ? `, ${UNCONFIRMED_CLAUSE}` : otherwise
}

/**
 * Words the files a finished write or removal left behind for the learner, shown verbatim by the caller.
 * @param keptLeft - The files that stay.
 * @returns One sentence per file, each naming the file and what it holds; undefined when nothing stays.
 * @example
 * cleanupFailureOf([]) // => undefined
 */
function cleanupFailureOf(keptLeft: KeptFile[]): string | undefined {
  if (keptLeft.length === 0) return undefined
  return keptLeft.map(keptFileSentence).join(' ')
}

/**
 * Tells a parsed JSON object from every other JSON value without copying it, so own keys such as `__proto__` stay as parsed.
 * @param value - A `JSON.parse` result.
 * @returns Whether it is a non-null, non-array object.
 * @example
 * isJsonObject(JSON.parse('{"__proto__":{}}')) // => true
 */
function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The error code of a failed file system call, if it has one. */
function codeOf(error: unknown): unknown {
  return error instanceof Error && 'code' in error ? error.code : undefined
}

/** Picks the identity of a file from a `stat` answer read with `{ bigint: true }`; the mode is cut to its permission bits. */
function identityOf(status: {
  ino: bigint
  size: bigint
  mtimeNs: bigint
  ctimeNs: bigint
  mode: bigint
  nlink: bigint
}): FileIdentity {
  const { ino, size, mtimeNs, ctimeNs, mode, nlink } = status
  return { ino, size, mtimeNs, ctimeNs, mode: Number(mode) & 0o777, nlink }
}

/**
 * Reads the config without following a link and checks its shape; every run starts here.
 * @param context - The run.
 * @returns `absent` for a missing file, else the parsed object with the identity of the file that was read.
 * @throws A {@link refusal} for a link, a non-regular file, a file that cannot be read, a file larger than {@link DEVIN_MCP_CONFIG_LIMIT_BYTES}, invalid JSON, a member name that appears twice in one object, a top level that is no object or an `mcpServers` that is no object.
 * @example
 * await lookAtConfig(context) // => { kind: 'absent' }
 */
async function lookAtConfig(context: Context): Promise<ConfigLook> {
  const { path, retry } = context
  let file
  try {
    file = await openWithoutFollowing(path)
  } catch (error) {
    // A missing file is the create case; a link is refused rather than followed.
    if (codeOf(error) === 'ENOENT') return { kind: 'absent' }
    if (codeOf(error) === 'ELOOP')
      throw refusal(
        'a link at that path',
        path,
        'replace the link with the file itself',
        retry,
      )
    // EACCES, ENOTDIR, EIO and the rest: one sentence instead of a raw error.
    throw unreadableRefusal(context, error)
  }
  try {
    const status = await file.stat({ bigint: true }).catch((error) => {
      throw unreadableRefusal(context, error)
    })
    if (!status.isFile())
      throw refusal(
        'something that is no regular file',
        path,
        'remove it',
        retry,
      )
    // A huge file is refused before it is read into memory.
    if (status.size > BigInt(DEVIN_MCP_CONFIG_LIMIT_BYTES))
      throw tooLargeRefusal(context)
    const bytes = await readWithinLimit(
      file,
      status.size,
      DEVIN_MCP_CONFIG_LIMIT_BYTES,
      () => context.seam?.afterStat?.(path),
    ).catch((error) => {
      throw unreadableRefusal(context, error)
    })
    // A file that grew after its size was checked is refused like one that was too large to begin with.
    if (!bytes) throw tooLargeRefusal(context)
    return parseConfig(context, bytes, identityOf(status))
  } finally {
    await file.close()
  }
}

/** The refusal for a config larger than {@link DEVIN_MCP_CONFIG_LIMIT_BYTES}, by its size at the stat or by the bytes that arrived past the limit. */
function tooLargeRefusal({ path, retry }: Context): Error {
  return refusal(
    `a file larger than ${DEVIN_MCP_CONFIG_LIMIT_BYTES} bytes`,
    path,
    'shrink or move it',
    retry,
  )
}

/**
 * Reads an open file through that very handle, never more than one byte past the limit; every read of the config, a displaced copy and Codebook's records goes through it, so a file that grew after its stat is never read unbounded.
 * @param handle - The open file.
 * @param sizeAtStat - Its size when it was looked at; the first read asks for that and one byte more.
 * @param limitBytes - The largest size accepted.
 * @param afterStat - Test hook, called before the first read.
 * @returns The file's bytes, at most `limitBytes` of them; `undefined` when more than that arrived.
 * @throws What a read throws.
 * @example
 * await readWithinLimit(handle, 12n, DEVIN_MCP_CONFIG_LIMIT_BYTES) // => <Buffer of 12 bytes>
 */
async function readWithinLimit(
  handle: FileHandle,
  sizeAtStat: bigint | number,
  limitBytes: number,
  afterStat?: () => void,
): Promise<Buffer | undefined> {
  afterStat?.()
  return readUpToLimit(handle, Number(sizeAtStat), limitBytes)
}

/** The refusal for a config that could not be opened or read (permissions, a parent that is a file, a failing disk); the cause is kept, not echoed. */
function unreadableRefusal({ path, retry }: Context, cause: unknown): Error {
  return refusal(
    'a file it could not read',
    path,
    'make it readable by you',
    retry,
    cause,
  )
}

/**
 * Parses the bytes of the config and checks its shape; called by {@link lookAtConfig}.
 * @param context - The run, for the refusals.
 * @param bytes - The file's bytes.
 * @param identity - The identity of the file that was read.
 * @returns The parsed top-level object and its servers.
 * @throws A {@link refusal} for invalid JSON, a duplicate member name, a top level that is no object or an `mcpServers` that is no object.
 * @example
 * parseConfig(context, Buffer.from('{}'), identity) // => { kind: 'present', root: {}, servers: undefined, ... }
 */
function parseConfig(
  context: Context,
  bytes: Buffer,
  identity: FileIdentity,
): ConfigLook {
  const { path, retry } = context
  const invalidContent = () =>
    refusal('text that is not valid JSON', path, 'fix or move that file', retry)
  let text: string
  try {
    // Invalid UTF-8 would become U+FFFD and a rewrite would save that; `ignoreBOM` keeps a BOM in the text, so the JSON parse refuses it as before.
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
      bytes,
    )
  } catch {
    throw invalidContent()
  }
  let parsed: unknown
  let hasLossyNumber = false
  try {
    // A number whose shortest form differs from its source text would change when written back (`9007199254740993`, `1.0`).
    // The reviver's third argument (Node 22+) is not in TypeScript's lib yet, so it is declared optional here.
    parsed = JSON.parse(
      text,
      (_key: string, value: unknown, valueContext?: { source?: string }) => {
        // A host whose JavaScript engine passes no source text cannot be checked here.
        if (
          typeof value === 'number' &&
          valueContext?.source !== undefined &&
          String(value) !== valueContext.source
        )
          hasLossyNumber = true
        return value
      },
    )
  } catch {
    throw invalidContent()
  }
  if (!isJsonObject(parsed))
    throw refusal(
      'a top-level value that is no object',
      path,
      'fix or move that file',
      retry,
    )
  // JSON.parse keeps only the last of two equal names, so a rewrite would silently drop the earlier value.
  if (hasDuplicateJsonMember(text))
    throw refusal(
      'an object that names the same member twice',
      path,
      'remove the duplicate member',
      retry,
    )
  const rawServers = parsed.mcpServers
  if (rawServers !== undefined && !isJsonObject(rawServers))
    throw refusal(
      'an "mcpServers" value that is no object',
      path,
      'fix that value',
      retry,
    )
  return {
    kind: 'present',
    root: parsed,
    servers: rawServers,
    identity,
    sha256: bytesSha256(bytes),
    sha256BeforeExtraLineBreaks: hashBeforeExtraLineBreaks(bytes),
    hasLossyNumber,
  }
}

/**
 * Identifies an older setup's staged JSON when only line breaks were appended.
 * The validated root is an object, and the writer ended its closing brace with one LF.
 * @example
 * hashBeforeExtraLineBreaks(Buffer.from('{}\n\r\n')) // hashes '{}\n'
 */
function hashBeforeExtraLineBreaks(bytes: Buffer): string | undefined {
  const firstBreak = bytes.lastIndexOf('}') + 1
  // Hash an additional prefix only when the entire suffix consists of extra line breaks.
  if (
    bytes[firstBreak] === 10 &&
    firstBreak + 1 < bytes.length &&
    bytes.subarray(firstBreak + 1).every((byte) => byte === 10 || byte === 13)
  )
    return bytesSha256(bytes.subarray(0, firstBreak + 1))
  return undefined
}

/**
 * Throws when the config is no longer the file that was read: another inode, size or modification or change time in nanoseconds, so a same-size write within the same millisecond is seen too; runs just before the rename ({@link publishRoot}), before a removal and right before a first setup's old record is deleted ({@link dropRetiredReceipt}).
 * @param context - The run.
 * @param expected - The identity read earlier; undefined when the file was absent.
 * @throws A {@link refusal} naming the change; nothing was written.
 * @example
 * assertConfigUnchanged(context, look.identity)
 */
function assertConfigUnchanged(
  context: Context,
  expected: ConfigContinuity | undefined,
): void {
  if (!isConfigUnchanged(context, expected)) throw changedWhileWorking(context)
}

/**
 * Tells, by one synchronous look, whether the config name still shows the file that was read: the same inode, size and modification and change times in nanoseconds; called by {@link assertConfigUnchanged} and by {@link stillnessOf}, for a drop of a first setup's old record that the config decided ({@link ownerOfConfigEntry}).
 * @param context - The run.
 * @param expected - The identity read earlier; undefined when the file was absent.
 * @returns `true` when the name shows that file (for an absent file: still nothing); `false` otherwise.
 * @throws What the look throws other than for a missing name.
 * @example
 * isConfigUnchanged(context, look.identity) // => false after a sync tool saved the config again
 */
function isConfigUnchanged(
  context: Context,
  expected: ConfigContinuity | undefined,
): boolean {
  const now = lstatSync(context.path, { bigint: true, throwIfNoEntry: false })
  if (!expected) return !now
  return (
    now !== undefined &&
    now.ino === expected.ino &&
    now.size === expected.size &&
    now.mtimeNs === expected.mtimeNs &&
    now.ctimeNs === expected.ctimeNs
  )
}

/** What a private file beside the config is for: the config moved aside, the staged new config, or the probe link of the hard-link check. */
type JournalRole = 'kept' | 'staged' | 'probe'

/** The end of each private name; the whole name is `<config file>.<generation>.<end>`. */
const JOURNAL_SUFFIX = {
  kept: 'codebook-displaced',
  staged: 'tmp',
  probe: 'probe',
} as const satisfies Record<JournalRole, string>

/** What a generation id looks like (a UUID); a record that holds anything else cannot name one of Codebook's files. */
const GENERATION_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/**
 * Builds the one private name Codebook gives a file beside the config; the pending record keeps it, and recovery accepts only a name that equals it again.
 * @param configPath - The config file.
 * @param generation - The id of the write or removal that makes the file.
 * @param role - What the file is for.
 * @returns A bare file name.
 * @example
 * journalNameOf('/home/a/.config/devin/mcp_config.json', 'c0ffee00-0000-4000-8000-000000000001', 'probe') // => 'mcp_config.json.c0ffee00-0000-4000-8000-000000000001.probe'
 */
function journalNameOf(
  configPath: string,
  generation: string,
  role: JournalRole,
): string {
  return `${basename(configPath)}.${generation}.${JOURNAL_SUFFIX[role]}`
}

/** The private path beside the config for a file of one write or removal ({@link journalNameOf}). */
function journalPathOf(
  configPath: string,
  generation: string,
  role: JournalRole,
): string {
  return join(dirname(configPath), journalNameOf(configPath, generation, role))
}

/**
 * Refuses a rewrite that would change a number the learner wrote (an integer beyond 2^53, a long decimal, `1.0`); called before every rewrite of an existing config.
 * @param context - The run.
 * @param look - What the config looked like.
 * @throws A {@link refusal}; the file is untouched.
 * @example
 * assertRewritable(context, look)
 */
function assertRewritable(context: Context, look: ConfigLook): void {
  if (look.kind === 'present' && look.hasLossyNumber)
    throw refusal(
      'a number Codebook cannot write back unchanged (such as 1.0 or an integer beyond 9007199254740991)',
      context.path,
      'write that number in its shortest form',
      context.retry,
    )
}

/**
 * Refuses a config that other paths reach too, before anything is moved: replacing or removing the name would leave the other names on a file Codebook no longer keeps current.
 * @param context - The run.
 * @param look - What the config looked like.
 * @throws A {@link refusal} when the inode had more than one name at the read; the file is untouched. Codebook's own staged link is no concern: this runs on the config before the move-aside, after recovery removed any leftover name.
 * @example
 * assertSingleLink(context, look)
 */
function assertSingleLink(context: Context, look: ConfigLook): void {
  if (look.kind === 'present' && look.identity.nlink > 1n)
    throw linkedElsewhereRefusal(context)
}

/** The refusal for a config that another path reaches too, at the read or when the moved-aside file was opened. */
function linkedElsewhereRefusal({ path, retry }: Context): Error {
  return refusal(
    'a file that is linked from another path',
    path,
    'give it one name',
    retry,
  )
}

/**
 * Removes the pending record; a failure leaves a record that the next run finds stale. A tracked journal ({@link Context.journalVersion}) goes only while its name shows the version this run settled or wrote ({@link removeRecord}).
 * @param context - The run; its pending path is the record.
 * @param options - `assertStill` is a synchronous look at other names that must still hold right before the delete ({@link removeRecord}); its failure is thrown again after the delete is abandoned, so the caller can run the failure handling that needs the record it kept. `onConflict: 'throw'` passes a tracked journal's conflict to the caller instead. Any other failure still leaves a stale record and is swallowed, as before.
 * @throws What `assertStill` threw; nothing is deleted then. With `onConflict: 'throw'`, the {@link JournalConflictError} of the tracked record's conflict.
 * @example
 * await dropPending(context, { assertStill: assertReceiptLeft }) // throws the receipt conflict, keeping pending.json, once receipt.json moved away before the delete
 * await dropPending(run, { onConflict: 'throw' }) // throws the record conflict, keeping receipt.json, once a backup restored another pending record
 */
async function dropPending(
  context: Context,
  options: {
    assertStill?: StillLook
    onConflict?: 'ignore' | 'throw'
  } = {},
): Promise<void> {
  let stillFailure: unknown
  let stillFailed = false
  const guardedStill: StillLook | undefined = options.assertStill && {
    names: options.assertStill.names,
    assert: (): void => {
      try {
        options.assertStill!.assert()
      } catch (error) {
        // Remember why the guarded delete stopped before swallowing it as an ordinary cleanup failure.
        stillFailure = error
        stillFailed = true
        throw error
      }
    },
  }
  await removeRecord(context, guardedStill).catch((error: unknown) => {
    if (options.onConflict === 'throw' && error instanceof JournalConflictError)
      throw error
  })
  if (stillFailed) throw stillFailure
}

/**
 * Removes the record of a removal or take-back that took the entry out, as the last step before it reports success; called by {@link takeEntryOut}, {@link settleMovedAside} and {@link finishRemoval}.
 * Any failure leaves a record the next run finds stale, as {@link dropPending} does, except another file at a take-back's rollback record's name, or a name that cannot be read again ({@link JournalConflictError}): what stands there stays, and the run must not go on as if the take-back were settled, so the conflict is thrown as a {@link TakenOutConflictError}, which says that the entry is out already and keeps the conflict's kind ({@link rollBackPublishedEntry}). A removal's own record ({@link ownRecordContext}) that another program replaced stays for the next run as such a stale record does, and the removal, whose entry is out, reports success.
 * @param context - The run; its pending path is the record.
 * @throws A {@link TakenOutConflictError}, with the conflict's kind, when a take-back's tracked record's name shows another file or cannot be read again; nothing is deleted then.
 * @example
 * await dropFinishedRecord(rollbackContext) // pending.json.rollback is gone, or the call throws once a backup put another journal there
 */
async function dropFinishedRecord(context: Context): Promise<void> {
  await removeRecord(context).catch((error: unknown) => {
    // Another file at a take-back's record's name: the entry is out, and the run goes no further.
    if (
      error instanceof JournalConflictError &&
      context.rollbackOf !== undefined
    )
      throw new TakenOutConflictError(error)
  })
}

/** A synchronous look at other names that must still hold right before a record's rename, link or unlink ({@link writeRecord}, {@link removeRecord}), with the names it looks at, so the step first awaits a look at each of them ({@link lookAheadAt}): a storage that already stalls holds that step in the thread pool, where the step's budget answers, instead of the extension host's thread. */
type StillLook = {
  /** The names `assert` looks at, in its order. */
  readonly names: readonly string[]
  /** Throws when a name no longer shows what an earlier look found; nothing is awaited between it and the rename, link or unlink. */
  readonly assert: () => void
}

/**
 * Deletes a run's pending record: a tracked rollback journal ({@link Context.journalVersion}) only while its name still shows the version this run settled or wrote ({@link dropTrackedJournal}), any other record whatever stands at its name; called by {@link dropPending}, {@link retirePending} and {@link handOver}.
 * Limit: a stall of storage that starts between the awaited look at `assertStill`'s names and its synchronous look holds the extension host's thread.
 * @param context - The run; its pending path is deleted.
 * @param assertStill - A synchronous look at other names that must still hold, called right before the delete (for a tracked journal after its last look), after an awaited look at its names; throwing keeps the record. Undefined when nothing else must hold ({@link retirePending}).
 * @throws A {@link JournalConflictError} when a tracked journal's name shows another file or cannot be read again (nothing is deleted then); what `assertStill` throws; what the delete throws other than for a name that is gone.
 * @example
 * await removeRecord(context) // pending.json is gone
 */
async function removeRecord(
  context: Context,
  assertStill?: StillLook,
): Promise<void> {
  if (context.journalVersion) return dropTrackedJournal(context, assertStill)
  if (assertStill) {
    await lookAheadAt(assertStill.names)
    assertStill.assert()
  }
  await rm(context.pendingPath, { force: true })
}

/** How a run's completed record went ({@link markCompleted}): `recorded`; `unrecorded` when its write failed (a full disk), so the record written before the first move stays byte for byte; or the {@link JournalConflictError} itself when that record's name showed another file, nothing or a name that could not be read again (its kind `changed`, `gone`, `unread`), so what stands there is not provably this run's record and stays as it is, or when Codebook's own step at that record's dropping name refused ({@link DroppingNameConflictError}), whose sentence says where the record stands. */
type Completion = 'recorded' | 'unrecorded' | JournalConflictError

/**
 * Rewrites the pending record as completed: the config was already published or removed, so a copy that stays is a leftover and never goes back to the config name ({@link recoverLeftovers}); called by {@link createConfig} and {@link discardDisplaced}.
 * @param context - The run.
 * @param journal - The record as it was written before the first move.
 * @returns The {@link Completion}: `recorded` when the record says completed; otherwise the caller must not rely on that record, and a conflict says what stood at its name (nothing was written there, unless Codebook's own step at the dropping name refused after the new record stood, {@link dropAsideRecord}).
 * @example
 * await markCompleted(context, journal) // => a `changed` JournalConflictError once a backup renamed another record over pending.json after the config was linked in
 * await markCompleted(publishRun, journal) // => a `gone` JournalConflictError once a backup moved pending.json away after the config was linked in ({@link ownRecordContext})
 */
async function markCompleted(
  context: Context,
  journal: Pending,
): Promise<Completion> {
  try {
    await writeRecord(context, context.pendingPath, {
      ...journal,
      phase: 'completed',
    } satisfies Pending)
    return 'recorded'
  } catch (error) {
    // Another program's record, an emptied name, a failed read or Codebook's own dropping-name refusal is told apart from a full disk, which leaves this run's own record.
    return error instanceof JournalConflictError ? error : 'unrecorded'
  }
}

/**
 * Gives the {@link Published.recordConflict} a {@link Completion} carries; called by {@link createConfig} and {@link discardDisplaced}.
 * @param completion - How the completed record went.
 * @returns `{ recordConflict }` for a conflict; an empty object for `recorded` and `unrecorded`.
 * @example
 * recordConflictOf(journalConflictError(context, 'unread')) // => { recordConflict: that error }
 * recordConflictOf('unrecorded') // => {}
 */
function recordConflictOf(
  completion: Completion,
): Pick<Published, 'recordConflict'> {
  return completion === 'recorded' || completion === 'unrecorded'
    ? {}
    : { recordConflict: completion }
}

/**
 * Records that a copy was named to the learner (in a refusal or in `cleanupFailure`), so no later run deletes it, whatever its bytes; the next run reports it once and stops tracking it ({@link recoverLeftovers}).
 * @param context - The run.
 * @param journal - The record as it was written before the first move.
 * @returns
 * - `true` when no record lets a later run delete the copy: the handed record was written, or, when that write failed (a full disk), the record was dropped, so the copy is no longer tracked and stays for good; a tracked rollback journal ({@link Context.journalVersion}) is dropped only while its name still shows the version this run settled or wrote ({@link removeRecord})
 * - `false` when the record stays as it is on disk: a first setup's record or one marked for take-back whose handed write failed (it holds the intent that the entry is taken back unless its receipt gets written ({@link isTakeBackOwed}), and a failed write leaves the previous record byte for byte), a tracked rollback journal whose name shows another file or cannot be read again ({@link JournalConflictError}: nothing is written or dropped there), or another record that could not be dropped either; a caller whose record on disk is completed keeps the copy out of a later run's reach ({@link keepFromRecovery})
 * @example
 * await handOver(context, journal) // => true; pending.json now says handed
 */
async function handOver(context: Context, journal: Pending): Promise<boolean> {
  try {
    await writeRecord(context, context.pendingPath, {
      ...journal,
      phase: 'handed',
    } satisfies Pending)
    return true
  } catch (error) {
    // Another file at a tracked journal's name is not this run's: nothing was written there, and nothing is dropped.
    if (error instanceof JournalConflictError) return false
    // Dropping this record would let a stop before the receipt leave an entry that no record owns: it stays, and the caller says what becomes of the copy.
    if (isFirstSetupRecord(journal) || journal.takeBack) return false
    return removeRecord(context).then(
      () => true,
      () => false,
    )
  }
}

/**
 * Looks at a name without following a link and without holding the extension host's thread; called where a look only decides what a record says, which way a step goes or what a notice names ({@link isUnverifiedSecondName}, {@link settleRetiredReceipt}, {@link handOverCopy}), never right before a link or unlink it guards; {@link dropStagedRecord} looks at a staged name only this run made.
 * @param path - The name to look at.
 * @returns Its status with bigint numbers; undefined when nothing stands there.
 * @throws Any other failure of the look.
 * @example
 * await lstatOrAbsent('/home/me/.config/devin/mcp_config.json') // => undefined when the config is gone
 */
async function lstatOrAbsent(path: string): Promise<BigIntStats | undefined> {
  try {
    return await lstat(path, { bigint: true })
  } catch (error) {
    if (codeOf(error) === 'ENOENT') return undefined
    throw error
  }
}

/** Whether a name is gone: deleted now, or already gone (ENOENT) because another program removed it first, so no notice names a path where nothing stands; any other failure is an answer here, because the caller names the file that stays. */
function didUnlink(path: string): Promise<boolean> {
  return unlink(path).then(
    () => true,
    (error: unknown) => codeOf(error) === 'ENOENT',
  )
}

/** A kept copy as {@link inspectCopy} read it: the bytes' hash, the inode, and the size and times (nanoseconds) a later look must still see; an in-place write that keeps inode and size changes the times. `nlink` is how many names the inode had at that read, an early filter of {@link dropCheckedName}; the drop decides on the last look ({@link isStillSecondName}). */
type InspectedCopy = {
  sha256: string
  ino: bigint
  size: bigint
  mtimeNs: bigint
  ctimeNs: bigint
  nlink: bigint
}

/** One version of a record file: its inode and the SHA-256 of its bytes, as one read ({@link readVersionedRecord}) or one write ({@link writeRecord}) of it saw them. */
type RecordVersion = Pick<InspectedCopy, 'ino' | 'sha256'>

/** The file a staged write made ({@link stageConfigFile}, {@link stageRecord}): the inode and the bytes' hash that every later publish or cleanup must prove again; status alone never stands for those bytes. */
type StagedVersion = RecordVersion

/**
 * Reads a file Codebook keeps a copy in, without following a link.
 * @param path - The copy.
 * @returns Its bytes' hash and inode; undefined when the copy is gone.
 * @param seam - Test hook, see {@link DevinMcpTestSeam}.
 * @throws When the copy is a link, no regular file, larger than {@link DEVIN_MCP_CONFIG_LIMIT_BYTES} (also when it grew past that after its stat) or cannot be read.
 */
async function inspectCopy(
  path: string,
  seam?: DevinMcpTestSeam,
): Promise<InspectedCopy | undefined> {
  let file
  try {
    file = await openWithoutFollowing(path)
  } catch (error) {
    if (codeOf(error) === 'ENOENT') return undefined
    throw error
  }
  try {
    const status = await file.stat({ bigint: true })
    if (!status.isFile() || status.size > BigInt(DEVIN_MCP_CONFIG_LIMIT_BYTES))
      throw unsaneCopyError()
    const bytes = await readWithinLimit(
      file,
      status.size,
      DEVIN_MCP_CONFIG_LIMIT_BYTES,
      () => seam?.afterStat?.(path),
    )
    if (!bytes) throw unsaneCopyError()
    return {
      sha256: bytesSha256(bytes),
      ino: status.ino,
      size: status.size,
      mtimeNs: status.mtimeNs,
      ctimeNs: status.ctimeNs,
      nlink: status.nlink,
    }
  } finally {
    await file.close()
  }
}

/** A kept copy, or a tracked record, that is no regular file or is larger than the config limit ({@link unsaneCopyError}); its own class, so {@link lookAtTrackedJournal} tells another file at a tracked name from a read that failed. */
class UnsaneCopyError extends Error {}

/** The error for a kept copy that is no regular file or is larger than the config limit. */
function unsaneCopyError(): Error {
  return new UnsaneCopyError('The kept copy is no regular file of a sane size.')
}

/** Whether a kept copy still is the file and the bytes Codebook expected in it. */
function isExpectedCopy(
  copy: { sha256: string; ino: bigint },
  expected: KeptCopy,
): boolean {
  return copy.sha256 === expected.sha256 && copy.ino === expected.ino
}

/** The displaced copy as it was read through its open handle: the bytes' hash, the inode, and the size and times (nanoseconds) that a later write to the same file changes; the last look at its name before the delete compares them too ({@link lookAtComparedName}), so an in-place write that keeps the inode and the size is seen there. */
export type HeldCopy = {
  handle: FileHandle
  sha256: string
  ino: bigint
  size: bigint
  mtimeNs: bigint
  ctimeNs: bigint
}

/** The open displaced copy and the permission bits that very file had before Codebook made it private; only that inode ever gets them back. `isShared` is set when another name reached the file by the time it was opened: its mode was then left alone. */
type DisplacedHandle = {
  handle: FileHandle
  originalMode: number
  isShared: boolean
}

/**
 * Opens the displaced copy without following a link and makes it private through that handle, so the copy of the learner's other servers is readable by the owner only while it exists; called right after the move-aside.
 * @param path - The private name the config was moved to.
 * @returns The open handle with the file's own permission bits, read before they were narrowed; undefined when the name holds nothing. A file with more than one name (another link appeared since the config was read) keeps its mode and is marked `isShared`: the caller puts it back and refuses.
 * @throws When the name holds a link or no readable file, or the mode cannot be set; the handle is closed then.
 */
async function holdDisplaced(
  path: string,
): Promise<DisplacedHandle | undefined> {
  let handle: FileHandle
  try {
    handle = await openWithoutFollowing(path)
  } catch (error) {
    if (codeOf(error) === 'ENOENT') return undefined
    throw error
  }
  try {
    // The mode of this very file, read before it is narrowed, is the only mode a put-back may give back, and only to this inode.
    const { mode: originalMode, nlink } = identityOf(
      await handle.stat({ bigint: true }),
    )
    // Another name for the file appeared since the read: its mode is left alone, the caller puts it back.
    if (nlink > 1n) return { handle, originalMode, isShared: true }
    await handle.chmod(PRIVATE_FILE_MODE)
    return { handle, originalMode, isShared: false }
  } catch (error) {
    await handle.close()
    throw error
  }
}

/**
 * Reads the displaced copy through its handle: the status first, then the bytes, so a write between the two shows at the later {@link didCopyChange}.
 * @param handle - The handle {@link holdDisplaced} opened.
 * @returns The hash, inode, size and times.
 * @throws When the file is no regular file, is larger than {@link DEVIN_MCP_CONFIG_LIMIT_BYTES} (also when it grew past that after its status) or cannot be read.
 */
export async function readHeld(handle: FileHandle): Promise<HeldCopy> {
  const status = await handle.stat({ bigint: true })
  if (!status.isFile() || status.size > BigInt(DEVIN_MCP_CONFIG_LIMIT_BYTES))
    throw unsaneCopyError()
  const bytes = await readWithinLimit(
    handle,
    status.size,
    DEVIN_MCP_CONFIG_LIMIT_BYTES,
  )
  if (!bytes) throw unsaneCopyError()
  const { ino, size, mtimeNs, ctimeNs } = status
  return { handle, sha256: bytesSha256(bytes), ino, size, mtimeNs, ctimeNs }
}

/**
 * Tells whether a writer that kept the old file open wrote into it after the comparison: the size and times of the same open file, and then a hash of its bytes read again through that handle, which catches a same-size write inside one timestamp tick.
 * Documented limit: a write that lands between this check and the unlink that follows it is not seen; no Node primitive closes that gap, and advisory locks are not honored by editors.
 * @param held - The copy as it was read.
 * @returns `true` when size, times or bytes differ, or the file cannot be looked at or read: such a copy is kept, never deleted.
 */
export async function didCopyChange(held: HeldCopy): Promise<boolean> {
  try {
    const now = await held.handle.stat({ bigint: true })
    if (
      now.size !== held.size ||
      now.mtimeNs !== held.mtimeNs ||
      now.ctimeNs !== held.ctimeNs
    )
      return true
    // Size and times can be equal after a same-size write within one tick: only the bytes tell.
    const bytes = Buffer.alloc(Number(now.size))
    const { bytesRead } = await held.handle.read(bytes, 0, bytes.length, 0)
    return bytesRead !== bytes.length || bytesSha256(bytes) !== held.sha256
  } catch {
    return true
  }
}

/**
 * Reads the config once through one open file as the byte proof that the publish this run confirmed still stands at the config name: the file this run wrote, with the bytes it wrote; called by {@link discardDisplaced} before the copy of the previous config may be deleted.
 * A copy whose publish no longer stands may be the only one of the learner's previous config: another file, or none, stands at the config name, and the staged name goes with its own cleanup while it holds exactly the bytes this run wrote ({@link dropPublishedStage}), so a copy deleted then survives nowhere. The read is also the awaited look at the config name that the synchronous look right before the delete re-proves ({@link isPublishedReadStill}), so a storage that already stalls holds this step in the thread pool, where the step's budget answers.
 * @param context - The run; its config path is read.
 * @param published - The inode and the bytes' hash of the file this run wrote at the staged name, which the link made the config ({@link Replacement.stagedVersion}).
 * @returns The read, whose size and times the last look re-proves, when the config still is that file with those bytes; undefined when the name shows another file, other bytes, nothing or a file that cannot be read — none of which proves the publish stands, so the copy stays.
 * @example
 * await readStandingPublished(context, stagedVersion) // => undefined once a backup put another config at the config path after the link
 */
async function readStandingPublished(
  context: Context,
  published: RecordVersion,
): Promise<InspectedCopy | undefined> {
  // A read that failed proves nothing about the file there, exactly as other bytes or another file do: the copy stays.
  const read = await inspectCopy(context.path).catch(() => undefined)
  if (
    read === undefined ||
    read.ino !== published.ino ||
    read.sha256 !== published.sha256
  )
    return undefined
  return read
}

/**
 * Tells, by one synchronous look, whether the config name still shows the file a read of it just found (inode, size and times), so the bytes that read verified are still there right before the displaced copy's delete; called by {@link discardDisplaced} after {@link readStandingPublished}, the same re-proof {@link unlinkStagedWhileStill} gives its read before its unlink.
 * Limit: a swap or a write between this look and the unlink is not seen; no Node primitive unlinks by inode.
 * @param context - The run; its config path is looked at.
 * @param read - The config as {@link readStandingPublished} read it.
 * @returns `true` when the name still shows that read; `false` when it shows another file, other size or times, nothing, or the look failed, which proves nothing.
 * @example
 * isPublishedReadStill(context, standing) // => false once a sync tool put another config at the config path after the read
 */
function isPublishedReadStill(context: Context, read: InspectedCopy): boolean {
  try {
    return showsChecked(
      lstatSync(context.path, { bigint: true, throwIfNoEntry: false }),
      read,
    )
  } catch {
    // A look that failed proves nothing: the copy stays.
    return false
  }
}

/**
 * Reads a displaced copy once through one open file as the byte proof that its name still shows the file the replacement compared; called by {@link restoreDisplaced} before an empty-config put-back links that name.
 * The compared file is the one whose handle the replacement read ({@link readHeld}), not whatever the displaced name happens to reach after a sync tool's swap: inode and bytes both have to match. The read is also the awaited look at that name that the synchronous look right before the link re-proves.
 * @param context - The run; its seam is called inside the read.
 * @param displacedPath - The private name of the displaced copy.
 * @param held - The copy as the replacement compared it.
 * @returns The read, whose size and times the last look before the link re-proves, when the name still shows the compared file with the compared bytes; undefined when it shows another file, other bytes, nothing or a file that cannot be read.
 * @example
 * await readComparedDisplaced(context, displacedPath, held) // => undefined once a sync tool renamed its own file over the displaced name
 */
async function readComparedDisplaced(
  context: Context,
  displacedPath: string,
  held: HeldCopy,
): Promise<InspectedCopy | undefined> {
  // A read that failed proves nothing about the file there, exactly as other bytes or another file do: nothing is linked.
  const read = await inspectCopy(displacedPath, context.seam).catch(
    () => undefined,
  )
  if (
    read === undefined ||
    read.ino !== held.ino ||
    read.sha256 !== held.sha256
  )
    return undefined
  return read
}

/**
 * Tells, by one synchronous look, whether a name still shows the file a read of it just found (inode, size and times); called by {@link restoreDisplaced} immediately before the put-back link and again for the config the link made, the same re-proof {@link isPublishedReadStill} gives the published config.
 * Limit: a swap or a write between this look and the link, or after this look at the linked config, is not seen; no Node primitive links or unlinks by inode.
 * @param context - The run; its seam is called around the look ({@link nameStateNow}).
 * @param path - The name to look at.
 * @param read - The file as it was just read.
 * @returns `true` when the name still shows that read; `false` when it shows another file, other size or times, nothing, or the look failed, which proves nothing.
 * @example
 * isInspectedReadStill(context, displacedPath, compared) // => false once a sync tool put another file at the displaced name after the read
 */
function isInspectedReadStill(
  context: Context,
  path: string,
  read: InspectedCopy,
): boolean {
  return nameStateNow(context, path, read) === 'still'
}

/**
 * The refusal for an empty-config put-back whose displaced name no longer proves the file the replacement compared; called by {@link restoreDisplaced}, which keeps both that file and the publish record and never words this as a restoration.
 * @param context - The run; gives the config path, the record's path and the command to run again.
 * @param copyPath - The displaced name that could not be proven.
 * @returns The error, not thrown yet.
 * @example
 * unverifiedRestoreRefusal(context, displacedPath) // => 'Codebook did not put your previous config back at …, because the private copy at … was no longer the file it had compared …'
 */
function unverifiedRestoreRefusal(
  { path, pendingPath, retry }: Context,
  copyPath: string,
): Error {
  return new Error(
    `Codebook did not put your previous config back at ${path}, because the private copy at ${copyPath} was no longer the file it had compared (another program may have replaced or changed it), so Codebook left that file untouched and did not record that change as finished; its record of that change at ${pendingPath} stays, and the next run reads it first; look at that file before you use or delete it, ${retry}.`,
  )
}

/** What {@link discardDisplaced} did with the displaced copy: `deleted` (also when a copy that changed is gone from its private name by the time it would be kept, so nothing stays to name); `kept` (it changed or could not be deleted, so it stays and is reported); `unrecorded` (the completed record could not be written, so nothing was deleted). */
type DiscardOutcome = 'deleted' | 'kept' | 'unrecorded'

/** The outcome of {@link discardDisplaced} and the displaced copy as it stays: its path (another one when it was moved out of recovery's reach, {@link keepFromRecovery}) and what it holds; the copy is ignored for `deleted`. With `unrecorded`, `recordConflict` says what stood at the record's name when that came from another program, not from a full disk ({@link Completion}). */
type Discarded = { outcome: DiscardOutcome; copy: KeptFile } & Pick<
  Published,
  'recordConflict'
>

/** The end of the name a changed displaced copy moves to when its handover cannot be recorded ({@link keepFromRecovery}); no record names it, so no recovery of any build deletes it. */
const KEPT_COPY_SUFFIX = 'codebook-kept'

/**
 * Deletes the displaced copy after the config was published or removed, unless a writer changed it since the comparison; called by {@link settlePublished} and by the removal.
 * Each synchronous look here comes right after an awaited look at the same name ({@link lookAheadAt}), so a storage that already stalls holds this step in the thread pool, where the step's budget answers; a stall that starts between the two looks still holds the extension host's thread.
 * The record turns to completed first, so a copy that stays is a leftover that never goes back to the config name; a copy that changed is handed to the learner ({@link handOver}) or moved out of recovery's reach ({@link keepFromRecovery}); any other copy that stays, also an unchanged one whose last look or delete failed, is reported as one a later run deletes ({@link KeptFile.isLeftover}). When the completed record cannot be written nothing is deleted.
 * A publish's copy goes only while the config this run published still stands at the config name with the bytes this run wrote: once a backup or sync tool puts another config there, or writes into it, the copy may be the only one of the learner's previous config — the staged name, unedited, goes with its own cleanup ({@link dropPublishedStage}) and the config name shows the other file — so a copy deleted then survives nowhere. One read through one open file proves those bytes ({@link readStandingPublished}), and one synchronous look at the config name, then the one at the displaced name, right before the delete re-proves that read ({@link isPublishedReadStill}); a read or look that proves nothing keeps the copy, exactly as a legitimate edit of Devin Desktop's in that window does — the copy is named, and the learner loses nothing.
 * @param context - The run.
 * @param journal - The record as it was written before the first move.
 * @param displacedPath - The private name of the displaced copy.
 * @param held - The copy as it was compared.
 * @param published - The inode and the bytes' hash of the config this run published ({@link Replacement.stagedVersion}); undefined for a removal, which has no published config to prove.
 * @returns The {@link Discarded} outcome with the copy as it stays.
 */
async function discardDisplaced(
  context: Context,
  journal: Pending,
  displacedPath: string,
  held: HeldCopy,
  published?: RecordVersion,
): Promise<Discarded> {
  const copy: KeptFile = { path: displacedPath, holds: 'previous' }
  const completion = await markCompleted(context, journal)
  if (completion !== 'recorded')
    return { outcome: 'unrecorded', copy, ...recordConflictOf(completion) }
  // A copy a writer changed since the comparison, or a name that shows another file now, is handed to the learner.
  const isChanged = await didCopyChange(held)
  // The byte proof that the publish still stands, read only for a copy that could go: a changed copy stays either way, and a removal has no publish to prove.
  const standing =
    published === undefined || isChanged
      ? undefined
      : await readStandingPublished(context, published)
  // A storage that already stalls holds this step here, not at the synchronous looks below, which come in the same order: the config name, then the displaced name.
  await lookAheadAt(
    published === undefined ? [displacedPath] : [context.path, displacedPath],
  )
  // The publish must still stand for the copy to go; a read or look that proved nothing keeps it, exactly as a failing delete does.
  const isStanding =
    published === undefined ||
    (standing !== undefined && isPublishedReadStill(context, standing))
  const look = isChanged
    ? 'changed'
    : lookAtComparedName(context, displacedPath, held)
  if (look === 'changed') {
    const kept = await handOverCopy(context, journal, displacedPath, held)
    // A copy gone from its name is not named: nothing stays, as after a delete.
    return kept ? { outcome: 'kept', copy: kept } : { outcome: 'deleted', copy }
  }
  // The completed record still names this unchanged copy, so the next run deletes it while it holds the recorded bytes: its sentence says so.
  if (look === 'unknown' || !isStanding || !(await didUnlink(displacedPath)))
    return { outcome: 'kept', copy: { ...copy, isLeftover: true } }
  return { outcome: 'deleted', copy }
}

/**
 * Hands a displaced copy that stays to the learner ({@link handOver}); when that cannot be recorded and the completed record stays on disk, keeps the copy out of a later run's reach ({@link keepFromRecovery}); called by {@link discardDisplaced} for a copy that changed after the comparison or whose name shows another file.
 * @param context - The run.
 * @param journal - The record as it was written before the first move.
 * @param displacedPath - The private name of the displaced copy.
 * @param held - The copy as it was compared.
 * @returns The copy as it stays:
 * - at its private name once the handed record is written or the record was dropped, also when that name cannot be looked at;
 * - at its private name marked {@link KeptFile.isReplaced} when that name shows another inode than the one moved aside: another program's file, never called the previous config;
 * - undefined when nothing stands at its private name any more, so no notice names a path where nothing stands;
 * - as {@link keepFromRecovery} leaves it when the handover could not be recorded.
 * @example
 * await handOverCopy(context, journal, displacedPath, held) // => { path: displacedPath, holds: 'previous' } once the handed record is written
 */
async function handOverCopy(
  context: Context,
  journal: Pending,
  displacedPath: string,
  held: HeldCopy,
): Promise<KeptFile | undefined> {
  if (!(await handOver(context, journal)))
    return keepFromRecovery(context, journal, displacedPath, held)
  const shownIno = await lstatOrAbsent(displacedPath).then(
    (status) => status?.ino,
    // A look that fails proves nothing: the copy is named as handed.
    () => held.ino,
  )
  // Nothing at the name: no copy stays to name.
  if (shownIno === undefined) return undefined
  const copy: KeptFile = { path: displacedPath, holds: 'previous' }
  return shownIno === held.ino ? copy : { ...copy, isReplaced: true }
}

/**
 * Keeps a changed displaced copy out of a later run's reach when its handed record could not be written and the completed record stays on disk; called by {@link handOverCopy}.
 * Recovery deletes a completed record's copy only while it still is the recorded file with the recorded bytes ({@link tidyLeftover}), so only such a copy moves to `<config file>.<generation>.codebook-kept` ({@link KEPT_COPY_SUFFIX}), a name no record holds, without replacing a file another program put there ({@link moveWithoutReplacing}). That move reaches whatever stands at the private name, not the file the read saw through its handle, so it runs only while a last look still shows that file with the size and times of the read ({@link lookBeforeMove}). Any other copy stays where it is and is worded by what its name shows ({@link copyAsItStands}): one that cannot be read or looked at, holds other bytes, changed after the read or cannot move (also because a file stands at the new name) stays tracked ({@link KeptFile.isLeftover}), and its sentence says that a later run deletes it while it still holds the recorded bytes; a name that shows another file is said to be no longer that copy ({@link KeptFile.isReplaced}), and a name that shows nothing names no copy.
 * A swap between the last look and the move links another program's file to the new name; no Node primitive links by inode, so a look at the new name right after the link tells it from the copy ({@link moveWithoutReplacing}), and that name is then said to be no longer the copy.
 * @param context - The run; its seam is called when the copy is read and around the last look.
 * @param journal - The record as it was written before the first move; its kept hash is the bytes recovery deletes.
 * @param displacedPath - The private name of the displaced copy.
 * @param held - The copy as it was compared; its inode is the one the record holds.
 * @returns The copy as it stays:
 * - at its new name once it moved;
 * - at its private name marked {@link KeptFile.isLeftover} when it could not be read or looked at, the name shows the recorded file with other bytes, size or times, or the move failed (a file at the new name stays as it is);
 * - at its private name marked {@link KeptFile.isReplaced} when the name shows another file;
 * - at its new name marked {@link KeptFile.isReplaced} when the move linked a file another program put at the private name after the last look;
 * - undefined when nothing stands there: no copy stays to name.
 * @example
 * await keepFromRecovery(context, journal, displacedPath, held) // => { path: '…/mcp_config.json.<generation>.codebook-kept', holds: 'previous' }
 */
async function keepFromRecovery(
  context: Context,
  journal: Pending,
  displacedPath: string,
  held: HeldCopy,
): Promise<KeptFile | undefined> {
  const copy: KeptFile = { path: displacedPath, holds: 'previous' }
  let now: InspectedCopy | undefined
  try {
    now = await inspectCopy(displacedPath, context.seam)
  } catch {
    // A copy that cannot be read now may still be the recorded file with the recorded bytes at the next run.
    return copyAsItStands(copy, 'unknown', held.ino)
  }
  // Only the recorded file with the recorded bytes moves; a writer that still holds the recorded file can write those bytes back before the next run, which then deletes it.
  if (now?.ino !== held.ino || now.sha256 !== journal.keptSha256)
    return copyAsItStands(copy, now?.ino, held.ino)
  const shown = lookBeforeMove(context, displacedPath, now)
  // The name changed since the read: whatever stands there now stays.
  if (shown !== 'held') return copyAsItStands(copy, shown, held.ino)
  const keptPath = `${displacedPath.slice(0, -JOURNAL_SUFFIX.kept.length)}${KEPT_COPY_SUFFIX}`
  const move = await moveWithoutReplacing(displacedPath, keptPath, now.ino)
  if (move === 'stayed') return copyAsItStands(copy, 'unknown', held.ino)
  const kept: KeptFile = { path: keptPath, holds: 'previous' }
  return move === 'moved' ? kept : { ...kept, isReplaced: true }
}

/** What {@link moveWithoutReplacing} did: `moved` once the copy stands at the new name; `replaced` when the new name shows another file, which another program put at the private name after the last look (or at the new name after the link); `stayed` when the link or a look after it failed, so the copy is worded at its private name. */
type KeptMove = 'moved' | 'replaced' | 'stayed'

/**
 * Moves a displaced copy to the name no record holds without replacing anything there; called by {@link keepFromRecovery}, because a rename replaces whatever stands at its destination. A link claims the new name and fails when any file stands at it; only then is the private name unlinked, while the new name shows the copy's inode and the private name still shows the linked file.
 * Limit: a swap at the private name between the look right before the unlink and the unlink is not seen; no Node primitive unlinks by inode.
 * @param displacedPath - The private name of the displaced copy.
 * @param keptPath - The name no record holds ({@link KEPT_COPY_SUFFIX}).
 * @param ino - The inode the last look showed at the private name.
 * @returns
 * - `moved` once the copy stands at `keptPath`, also when its private name could not be unlinked: both names then reach it, and a later run that deletes the private name leaves `keptPath`;
 * - `replaced` when `keptPath` shows another inode: the link reached a file another program put at the private name after the last look (or another program replaced `keptPath` after the link), and both names stay;
 * - `stayed` when the link failed, for example because another file stands at `keptPath`, which stays as it is, or when a look after the link failed, which proves nothing, so both names stay.
 * @example
 * await moveWithoutReplacing(displacedPath, keptPath, 42n) // => 'stayed' when another program put a file at keptPath
 */
async function moveWithoutReplacing(
  displacedPath: string,
  keptPath: string,
  ino: bigint,
): Promise<KeptMove> {
  try {
    await link(displacedPath, keptPath)
  } catch {
    return 'stayed'
  }
  try {
    // The link reaches whatever stood at the private name, so another inode at the new name is a file swapped in after the last look, never the copy.
    if (lstatSync(keptPath, { bigint: true }).ino !== ino) return 'replaced'
    const shown = lstatSync(displacedPath, {
      bigint: true,
      throwIfNoEntry: false,
    })
    // The private name goes only while it still shows the file the new name reaches: a file swapped in meanwhile stays.
    if (shown?.ino === ino) await unlink(displacedPath).catch(() => undefined)
    return 'moved'
  } catch {
    // A failed look proves nothing: both names stay, and the copy is worded at its private name.
    return 'stayed'
  }
}

/**
 * Looks at a displaced name right before {@link keepFromRecovery} moves it ({@link moveWithoutReplacing}): the read's open handle proves the file it read, not what stands at the name, and the move reaches whatever stands there.
 * Limit: a swap between this look and the move is not seen here; no Node primitive links by inode, so the move looks at the name it linked ({@link moveWithoutReplacing}).
 * @param context - The run; its seam is called around the look ({@link isLeftoverStill}).
 * @param displacedPath - The private name of the displaced copy.
 * @param read - The copy as {@link inspectCopy} read it: its inode, size and times.
 * @returns
 * - `held` when the name shows the read's inode with its size and times;
 * - the inode the name shows otherwise, undefined when nothing stands there;
 * - `unknown` when the look throws (EIO, EACCES), which proves nothing.
 * @example
 * lookBeforeMove(context, displacedPath, read) // => 'held'
 */
function lookBeforeMove(
  context: Context,
  displacedPath: string,
  read: InspectedCopy,
): 'held' | 'unknown' | bigint | undefined {
  try {
    if (isLeftoverStill(context, displacedPath, read)) return 'held'
    // A second look, only for the words of the copy that stays.
    return lstatSync(displacedPath, { bigint: true, throwIfNoEntry: false })
      ?.ino
  } catch {
    return 'unknown'
  }
}

/**
 * Words a displaced copy that {@link keepFromRecovery} leaves at its private name, by what that name shows.
 * @param copy - The copy at its private name.
 * @param shown - The inode the name shows; undefined when nothing stands there; `unknown` when the copy could not be read, looked at or moved.
 * @param recordedIno - The inode the completed record holds for the copy.
 * @returns
 * - the copy marked {@link KeptFile.isLeftover} for the recorded inode or an unknown one: the completed record still lets a later run delete it while it holds the recorded bytes
 * - the copy marked {@link KeptFile.isReplaced} for another inode: another program's file, which no later run deletes ({@link otherInodeRefusal})
 * - undefined when nothing stands there, so no notice names a path where nothing stands
 * @example
 * copyAsItStands(copy, 42n, 42n)       // => { ...copy, isLeftover: true }
 * copyAsItStands(copy, 43n, 42n)       // => { ...copy, isReplaced: true }
 * copyAsItStands(copy, undefined, 42n) // => undefined
 */
function copyAsItStands(
  copy: KeptFile,
  shown: bigint | 'unknown' | undefined,
  recordedIno: bigint,
): KeptFile | undefined {
  if (shown === 'unknown' || shown === recordedIno)
    return { ...copy, isLeftover: true }
  return shown === undefined ? undefined : { ...copy, isReplaced: true }
}

/**
 * Looks at the displaced name right before {@link discardDisplaced} deletes it: the held handle proves the compared file, not the name, and the size and times of the comparison's read show an in-place write since then.
 * Limit: a swap or a write between this look and the unlink is not seen; no Node primitive unlinks by inode.
 * @param context - The run; its seam is called around the look ({@link isLeftoverStill}).
 * @param displacedPath - The private name of the displaced copy.
 * @param held - The copy as it was compared.
 * @returns
 * - `held` when the name shows the compared inode with its size and times;
 * - `changed` when it is gone or shows another file, size or times;
 * - `unknown` when the look throws (EIO, EACCES), which proves nothing.
 * @example
 * lookAtComparedName(context, displacedPath, held) // => 'held'
 */
function lookAtComparedName(
  context: Context,
  displacedPath: string,
  held: HeldCopy,
): 'held' | 'changed' | 'unknown' {
  try {
    return isLeftoverStill(context, displacedPath, held) ? 'held' : 'changed'
  } catch {
    return 'unknown'
  }
}

/**
 * Gives the config name its file back when a write is abandoned before its publish completes (the comparison found another file than the one read, or nothing stood at the config name right after the link): a link never replaces a config that appeared meanwhile, only then does the file get its own permissions back through its handle, and the displaced name is unlinked. A copy that cannot go back stays private.
 * An empty-config put-back after a successful comparison passes `compared`: the displaced name is then read again, and the name is linked only while the read and a synchronous look immediately before the link still show the compared inode with the compared bytes; the config the link made is read and looked at again before its mode or the displaced name is touched. When either proof fails the file at the displaced name and the recovery record stay, no restoration is reported, and a config name the link itself gave another file goes again only while both names still show that same unverified file.
 * Limits: those of the synchronous looks ({@link isInspectedReadStill}); a swap in the syscall gap can put another file at the config name for an instant, which the post-link read then refuses.
 * @param context - The run.
 * @param displacedPath - The private name of the displaced file.
 * @param opened - The handle of that file with the mode it had before it was made private; undefined when it could not be opened.
 * @param dropsRecord - Whether the pending record goes once the file is back; `false` while that record still has the rest of an abandoned publish to settle, or names a stale receipt that could not go back ({@link UnrestoredReceiptError}), so the next run settles those first.
 * @param compared - The displaced file as the replacement compared it, passed by the empty-config put-back after a successful comparison; undefined for a put-back of a file whose own change or sharing already ended the publish, which is restored as it stands.
 * @throws A {@link leftCopyRefusal} naming the displaced file when it cannot go back (a new config stands there, or the link failed); an {@link extraNameRefusal} when the file is back but its displaced name could not be deleted (the record stays, so the next run deletes that name); the {@link unverifiedRestoreRefusal} when the displaced name or the linked config no longer proves the compared file, in which case the recovery record stays.
 */
/**
 * Requires the displaced name to still show the compared file with the compared bytes immediately before its put-back link.
 * @param context - The run; its seam is called inside the read and look.
 * @param displacedPath - The private name of the displaced file.
 * @param compared - The displaced file as the replacement compared it.
 * @throws The {@link unverifiedRestoreRefusal} when the name no longer proves that compared file.
 */
async function assertComparedRestoreStill(
  context: Context,
  displacedPath: string,
  compared: HeldCopy,
): Promise<void> {
  const comparedRead = await readComparedDisplaced(
    context,
    displacedPath,
    compared,
  )
  // Nothing is linked unless the displaced name still is the compared file with the compared bytes right before the link.
  if (
    comparedRead === undefined ||
    !isInspectedReadStill(context, displacedPath, comparedRead)
  )
    throw unverifiedRestoreRefusal(context, displacedPath)
}

/**
 * Reads both names of a put-back link without letting a failed look prove anything about either one.
 * @param configPath - The config name.
 * @param displacedPath - The private name the link came from.
 * @returns Both stats, or two undefined entries when either look throws.
 */
function linkedNamesStats(
  configPath: string,
  displacedPath: string,
): [BigIntStats | undefined, BigIntStats | undefined] {
  try {
    return [
      lstatSync(configPath, { bigint: true, throwIfNoEntry: false }),
      lstatSync(displacedPath, { bigint: true, throwIfNoEntry: false }),
    ]
  } catch {
    return [undefined, undefined]
  }
}

/**
 * Tells whether both names still show the one wrong file whose link this run made.
 * @param context - The run.
 * @param shownConfig - The config stat from the last successful look.
 * @param shownDisplaced - The displaced-name stat from the same look.
 * @returns True only while both names share one inode that is still the file this run tracks.
 */
function isWrongLinkedFile(
  context: Context,
  shownConfig: BigIntStats | undefined,
  shownDisplaced: BigIntStats | undefined,
): boolean {
  if (shownConfig === undefined || shownDisplaced === undefined) return false
  return (
    shownConfig.ino === shownDisplaced.ino &&
    isLeftoverStill(context, context.path, { ino: shownConfig.ino })
  )
}

/**
 * Removes the config name of a link this run made when both names still show the same unverified file; anything unproven stays.
 * @param context - The run.
 * @param displacedPath - The private name the link came from.
 */
async function unlinkUnverifiedLinkedConfig(
  context: Context,
  displacedPath: string,
): Promise<void> {
  const [shownConfig, shownDisplaced] = linkedNamesStats(
    context.path,
    displacedPath,
  )
  // Both names showing one wrong file prove the link this run made: take the config name away again, best effort, so the substituted file does not stand there; anything else stays for the learner and the record.
  if (isWrongLinkedFile(context, shownConfig, shownDisplaced))
    await unlink(context.path).catch(() => undefined)
}

/**
 * Requires the config made by a compared put-back link to still be the compared file before permissions or the displaced name are touched.
 * @param context - The run.
 * @param displacedPath - The private name the link came from.
 * @param compared - The displaced file as the replacement compared it.
 * @throws The {@link unverifiedRestoreRefusal} when the linked config no longer proves the compared file.
 */
async function assertLinkedConfigCompared(
  context: Context,
  displacedPath: string,
  compared: HeldCopy,
): Promise<void> {
  // The link reaches whatever stood at the displaced name in the syscall gap: the config must still be the compared file with its bytes before anything else happens.
  const linkedRead = await readComparedDisplaced(
    context,
    context.path,
    compared,
  )
  if (
    linkedRead !== undefined &&
    isInspectedReadStill(context, context.path, linkedRead)
  )
    return
  await unlinkUnverifiedLinkedConfig(context, displacedPath)
  throw unverifiedRestoreRefusal(context, displacedPath)
}

/**
 * The refusal for a restored config whose private name no longer proves the same file before that name is deleted; called by {@link dropRestoredPrivateName}, which leaves whatever stands there and keeps the publish record.
 * @param context - The run; gives the config path, the record's path and the command to run again.
 * @param copyPath - The private name that could not be proven.
 * @returns The error, not thrown yet.
 * @example
 * unprovenRestoredNameRefusal(context, displacedPath) // => 'Codebook put your previous config back at …, but could not prove that the private name at … still reached that file …'
 */
function unprovenRestoredNameRefusal(
  { path, pendingPath, retry }: Context,
  copyPath: string,
): Error {
  return new Error(
    `Codebook put your previous config back at ${path}, but could not prove that the private name at ${copyPath} still reached that file before deleting it (another program may have replaced it or the config changed), so Codebook left whatever stands there untouched and did not record that change as finished; its record of that change at ${pendingPath} stays, and the next run reads it first; look at that file before you use or delete it, ${retry}.`,
  )
}

/**
 * Deletes the private name of a file after it was linked back as the config, only while both names still reach that same file; called by {@link restoreDisplaced}.
 * The linked-config check proves the config, not what later stands at the private name: a sync tool can replace only that name after the check. One look at the config gives the inode the private name must still show, with another name reaching it, right before the unlink. A name already gone is as deleted; anything unproven stays untouched and the record remains.
 * Limit: a swap between the last synchronous look and the unlink is not seen; no Node primitive unlinks by inode.
 * @param context - The run; its seam is called around the private name's last look ({@link nameStateNow}).
 * @param displacedPath - The private name to delete.
 * @returns `true` when the name is gone or was deleted; `false` when its unlink failed.
 * @throws The {@link unprovenRestoredNameRefusal} when the config or the private name no longer proves the restored file.
 * @example
 * await dropRestoredPrivateName(context, displacedPath) // => true once that second name is gone
 */
async function dropRestoredPrivateName(
  context: Context,
  displacedPath: string,
): Promise<boolean> {
  let config: BigIntStats | undefined
  try {
    config = lstatSync(context.path, {
      bigint: true,
      throwIfNoEntry: false,
    })
  } catch {
    config = undefined
  }
  if (!config) throw unprovenRestoredNameRefusal(context, displacedPath)
  const state = nameStateNow(context, displacedPath, {
    ino: config.ino,
    isShared: true,
  })
  if (state === 'gone') return true
  if (state !== 'still')
    throw unprovenRestoredNameRefusal(context, displacedPath)
  return didUnlink(displacedPath)
}

async function restoreDisplaced(
  context: Context,
  displacedPath: string,
  opened: DisplacedHandle | undefined,
  dropsRecord = true,
  compared?: HeldCopy,
): Promise<void> {
  if (compared !== undefined)
    await assertComparedRestoreStill(context, displacedPath, compared)
  try {
    await link(displacedPath, context.path)
  } catch (error) {
    throw leftCopyRefusal(context, displacedPath, error)
  }
  if (compared !== undefined)
    await assertLinkedConfigCompared(context, displacedPath, compared)
  // The name is back: the same inode gets the mode it had, never another file; a shared file never had its mode changed.
  if (opened && !opened.isShared)
    await opened.handle.chmod(opened.originalMode).catch(() => undefined)
  // Two names reach the file now: one that cannot be deleted stays in the record, so the next run drops it ({@link tidyLeftover}) and the config never keeps an unexplained second link.
  if (!(await dropRestoredPrivateName(context, displacedPath)))
    throw extraNameRefusal(context, displacedPath)
  if (dropsRecord) await dropPending(context)
}

/** The refusal for a removal whose moved-aside file could not be compared with what was read (it grew past the limit or could not be read) and went back to the config name: the config is as it was and the receipt stays. */
function unreadableCopyRefusal(
  { path, retry }: Context,
  cause: unknown,
): Error {
  return refusal(
    'a file that could not be read back while Codebook removed its entry (larger than the limit or unreadable; Codebook put it back unchanged)',
    path,
    'look at the file',
    retry,
    cause,
  )
}

/** The refusal for a put-back whose displaced name could not be deleted afterwards: the config is back, and a second name for it stays, named here; the record stays, and the next run deletes that name. */
function extraNameRefusal({ path, retry }: Context, copyPath: string): Error {
  return refusal(
    `a second name for your config that Codebook made at ${copyPath} and could not delete (both names reach the same file)`,
    path,
    'delete that second name',
    retry,
  )
}

/**
 * Writes the new config bytes to a private temporary file beside the config and reads the new file's inode from the open handle, so nothing after the rename needs to look at the file again; called by {@link publishRoot}, and by {@link stageRecord} for a tracked record's bytes beside that record.
 * @param temporary - The staged name ({@link journalPathOf}, or a record's own staged name); its folders are created.
 * @param serialized - The complete new content.
 * @param mode - The permission bits of the new file; the owner's bits only ({@link publishRoot}).
 * @returns The temporary path and the inode the config will have once the file is published, read from the same handle.
 * @throws What the create, write, flush, look or close throws; a failed write's temporary name goes only while it still shows the file this call created there ({@link dropFailedStage}).
 */
async function stageConfigFile(
  temporary: string,
  serialized: string,
  mode: number,
): Promise<{ temporary: string; ino: bigint }> {
  await mkdir(dirname(temporary), { recursive: true })
  const handle = await open(temporary, 'wx', PRIVATE_FILE_MODE)
  // The inode the exclusive create made, read from its handle before anything is written, so a failed write deletes only that file.
  let createdIno: bigint | undefined
  try {
    try {
      createdIno = (await handle.stat({ bigint: true })).ino
      // fchmod, so the umask does not narrow it; never wider than the owner's bits.
      await handle.chmod(mode)
      await handle.writeFile(serialized)
      await handle.sync()
      return { temporary, ino: createdIno }
    } finally {
      await handle.close()
    }
  } catch (error) {
    await dropFailedStage(temporary, createdIno, serialized)
    throw error
  }
}

/**
 * Deletes the temporary name of a staged write that failed while it still shows the file that write created there, holding no more than a start of the bytes it was writing; called by {@link stageConfigFile} when its write, flush or close fails, so a file another program put at that name meanwhile (a sync tool's), or bytes it wrote into that file in place, stay.
 * Limits: those of {@link unlinkStagedWhileStill}.
 * @param temporary - The temporary name.
 * @param createdIno - The inode of the file the exclusive create made, read from its handle; undefined when that read failed, and nothing is deleted then.
 * @param serialized - The complete bytes the write was to hold.
 * @returns Nothing; best effort: a name that shows another file, other bytes or nothing, or that cannot be read or deleted, stays, and no build reads it.
 * @example
 * await dropFailedStage('…/mcp_config.json.<generation>.tmp', 42n, serialized) // gone while it holds the file this write created and a start of its bytes
 */
async function dropFailedStage(
  temporary: string,
  createdIno: bigint | undefined,
  serialized: string,
): Promise<void> {
  const now = await inspectCopy(temporary).catch(() => undefined)
  const written = Buffer.from(serialized)
  // Another program's file, bytes this write never wrote, nothing, or a read that failed: nothing is deleted.
  if (
    createdIno === undefined ||
    now?.ino !== createdIno ||
    now.size > BigInt(written.length) ||
    bytesSha256(written.subarray(0, Number(now.size))) !== now.sha256
  )
    return
  await unlinkStagedWhileStill(temporary, now)
}

/** What a publish reports: the inode of the config now standing, the files that stay beside it (empty when everything was deleted; the pending record stays otherwise), whether the record says completed (`false`: the completed record could not be written, so no copy of the previous config was deleted; the staged name, only a second name of the config, goes all the same, {@link dropPublishedStage}) and whether a first setup's old record's private name stayed after the link because it no longer showed the record that setup moved there ({@link dropMovedAfterLink}; the pending record stays then too). */
type Published = {
  config: ConfigNumbers
  /** Digest of the complete bytes written to the staging file, before Devin could edit the published config. */
  stagedSha256: string
  keptLeft: KeptFile[]
  isRecorded: boolean
  isRetiredKept: boolean
  /** Set, to the conflict itself, when the completed record was not written because its name showed another file (`changed`), nothing (`gone`) or could not be read again (`unread`), or when Codebook's own step at that record's dropping name refused ({@link DroppingNameConflictError}) ({@link Completion}): what stands there is not provably this run's record, so {@link publishEntry} records its entry only while the config is still the file it published ({@link settleRecordConflict}). Absent for a full disk, whose record stays this run's own. */
  recordConflict?: JournalConflictError
}

/** Everything a replacement of an existing config works with: the staged file with the inode and bytes this run wrote there (every cleanup before the link deletes that name only while it still shows them, {@link dropStagedRecord}; the one after it, only while it is a second name of the config or holds just those bytes, {@link dropPublishedStage}), the probe name, the displaced copy, the identity of the config that was read, the record that names them, and the stale receipt a first setup retires right before its link ({@link linkWithoutStaleReceipt}). */
type Replacement = {
  temporary: string
  stagedVersion: StagedVersion
  probePath: string
  displaced: KeptCopy
  identity: FileIdentity
  journal: Pending
  staleReceipt: Receipt | undefined
}

/**
 * Links the staged file in at the config name, the step that exposes a publish; called by {@link createConfig} and {@link linkInStaged}.
 * A first setup's stale receipt ({@link isFirstSetup}) moves to its private name right before the link ({@link retireStaleReceipt}), so it goes only once this setup's own publish record, which names that move, is written, and no reader takes the new entry for that receipt's. When the link fails nothing of this setup stands, so that receipt goes back ({@link putBackRetiredReceipt}): a config that came back meanwhile is still owned by it, and an unrecorded removal's retry still answers `removed`. That put-back needs no free space, never replaces a newer receipt and puts back only a record of this config that it read at the private name; a private name it finds empty, or holding another program's file, keeps the publish record, which is then marked, so the next run looks there again. Once the link stands the private name stays until the caller's read right after the link confirms the publish ({@link linkedConfigState}); only then is it deleted, and only while it still shows the record this setup moved there and verified ({@link dropMovedAfterConfirm}).
 * @param context - The run.
 * @param staged - The staged file and the inode and bytes this run wrote there, which the last looks before the link must still show ({@link assertStagedConfigStill}).
 * @param staleReceipt - The receipt of an entry that is gone, which a first setup retires; undefined for an update, a removal, a rollback and a first setup without a receipt.
 * @param journal - The publish record as written; its generation names the receipt's private name ({@link retiredReceiptPathOf}).
 * @returns The move whose private name the caller deletes once its read right after the link confirms the publish ({@link dropMovedAfterConfirm}); undefined when no receipt moved, so nothing is left to delete. Until that confirmation the private name stays as the move left it, so a refusal of an unconfirmed publish (a backup restored the old config) leaves it and the publish record for the next run ({@link settleRetiredReceipt}).
 * @throws A {@link staleReceiptRefusal} when that receipt cannot be moved aside, a {@link changedRecordRefusal} when another receipt stood at its name by then (nothing was linked); a {@link stagedConfigRefusal} when the staged name no longer showed the file this run wrote there right before the link, and what the link throws, each once the receipt is back. An {@link UnrestoredReceiptError} carrying that failure when the receipt could not go back; the publish record is then marked {@link Pending.notLinked}, best effort, so the next run puts the receipt back whatever inode the config shows. When that mark cannot be written, the error promises no put-back: the next run cannot tell that nothing was linked and decides again ({@link retiredReceiptFateOf}).
 * @example
 * await linkWithoutStaleReceipt(context, staged, staleReceipt, journal) // => { retiredPath, look }: the config stands and the old record waits at its private name for the confirmed publish
 */
async function linkWithoutStaleReceipt(
  context: Context,
  staged: StagedRecord,
  staleReceipt: Receipt | undefined,
  journal: Pending,
): Promise<RetiredMove | undefined> {
  try {
    return await linkRetiringStaleReceipt(
      context,
      staged,
      staleReceipt,
      journal,
    )
  } catch (error) {
    if (!(error instanceof UnrestoredReceiptError)) throw error
    // Nothing of this setup was linked and the old record waits under its private name: the record says so, so the next run puts it back whatever inode the config shows.
    const isMarked = await writeRecord(
      context,
      context.pendingPath,
      notLinkedRecordOf(journal, error),
    ).then(
      () => true,
      () => false,
    )
    if (isMarked) throw error
    // Without that mark the next run cannot tell, so the sentence promises no put-back; a note that receipt.json is unverified counts only while the record on disk carries it (the put-back may have written it before its link).
    throw await withNoteState(context, error.withoutMark(context))
  }
}

/**
 * Gives the publish record a first setup writes once its old record could not go back: marked {@link Pending.notLinked}, naming the bytes of the file that waits at the private name when the setup's undo of a move that took another receipt proved that file ({@link UndoneMoveError}), and, while the file kept at the private name is one Codebook did not verify as its record of this config ({@link UnrestoredReceiptError.isForeignKept}), in the shape older builds refuse ({@link foreignKeptRecordOf}); called by {@link linkWithoutStaleReceipt} and {@link linkInStaged}.
 * @param journal - The publish record as the setup wrote it.
 * @param error - Why the old record could not go back.
 * @returns The record to write.
 * @example
 * notLinkedRecordOf(journal, linkFailed)  // => { ...journal, notLinked: true }
 * notLinkedRecordOf(journal, undoFailed)  // => { ...journal, notLinked: true, retiresReceipt: { sha256: undoFailed.movedSha256 } }
 */
function notLinkedRecordOf(
  journal: Pending,
  error: UnrestoredReceiptError,
): Pending {
  const marked: Pending = {
    ...journal,
    notLinked: true,
    // The undo's own file waits there, not the receipt the run read: the next run puts that file back.
    ...(error instanceof UndoneMoveError && {
      retiresReceipt: { sha256: error.movedSha256 },
    }),
  }
  return keptRecordOf(marked, error) ?? marked
}

/**
 * Gives the publish record that leads to an old record's private name as it must stand once a put-back kept a file there or at `receipt.json` ({@link UnrestoredReceiptError}); called by {@link notLinkedRecordOf} and {@link markForeignKept}.
 * @param record - The publish record.
 * @param error - Why the put-back kept what it kept.
 * @returns
 * - This build's record ({@link retiredReceiptSchema}) with `receiptUnverified` once the put-back's link or rename left a file Codebook did not verify at `receipt.json` ({@link UNVERIFIED_RECEIPT_STANDINGS}), so no later run takes that file for its record ({@link assertReceiptVerified})
 * - An older build's record (`true`, or 0.2.144.0's `foreign`) that found that file at `receipt.json` too (one of {@link UNVERIFIED_RECEIPT_STANDINGS}, for example one file at both names, {@link compareStandingReceipt}) in this build's form without bytes and with that note, which 0.2.142.0, 0.2.143.0 and 0.2.144.0 refuse and which passes no file at `receipt.json`
 * - An older build's record that leads to a file Codebook did not verify ({@link UnrestoredReceiptError.isForeignKept}) otherwise in the shape 0.2.142.0, 0.2.143.0 and 0.2.144.0 refuse ({@link foreignKeptRecordOf})
 * - undefined when the record stays as it is
 * @example
 * keptRecordOf({ ...journal, retiresReceipt: { sha256 } }, linkedUnverified) // => { ...journal, retiresReceipt: { sha256, receiptUnverified: true } }
 * keptRecordOf({ ...journal, retiresReceipt: 'foreign' }, linkedUnverified)   // => { ...journal, retiresReceipt: { receiptUnverified: true } }
 * keptRecordOf({ ...journal, retiresReceipt: 'foreign' }, movedUnverified)    // => { ...journal, retiresReceipt: {} }
 */
function keptRecordOf(
  record: Pending,
  error: UnrestoredReceiptError,
): Pending | undefined {
  const { retiresReceipt } = record
  // This build's record keeps older builds away already: it only notes a file its link or rename left unverified at receipt.json.
  if (typeof retiresReceipt === 'object')
    return UNVERIFIED_RECEIPT_STANDINGS.has(error.standing) &&
      retiresReceipt.receiptUnverified !== true
      ? {
          ...record,
          retiresReceipt: { ...retiresReceipt, receiptUnverified: true },
        }
      : undefined
  // Only an older build's record, which those builds would follow to that file, is rewritten below.
  if (retiresReceipt !== true && retiresReceipt !== 'foreign') return undefined
  // That file stands at receipt.json too: the record notes it, so no later run and no window takes it for Codebook's record.
  if (UNVERIFIED_RECEIPT_STANDINGS.has(error.standing))
    return { ...record, retiresReceipt: { receiptUnverified: true } }
  return error.isForeignKept ? foreignKeptRecordOf(record) : undefined
}

/**
 * Gives a publish record that leads to an old record's private name that holds a file Codebook did not verify as its record of this config (no such record, or a file that replaced the record Codebook read there: {@link UnrestoredReceiptError.isForeignKept}, {@link dropMovedAfterLink}), in the shape 0.2.142.0, 0.2.143.0 and 0.2.144.0 all refuse as unreadable before they look at that name: those builds put back what stands there on that record's word, so they would put that file at `receipt.json` and delete its private name ({@link Pending.retiresReceipt}); called by {@link keptRecordOf} for an older build's record (`true`, or 0.2.144.0's `foreign`) and by {@link dropMovedAfterConfirm}.
 * @param record - The publish record.
 * @returns The same record with `retiresReceipt: {}` (the object form without bytes, which names no file to this build either, {@link movedIdentityOf}); this build's record ({@link retiredReceiptSchema}) as it is, since its form already keeps those builds away.
 * @example
 * foreignKeptRecordOf({ ...journal, retiresReceipt: true })        // => { ...journal, retiresReceipt: {} }
 * foreignKeptRecordOf({ ...journal, retiresReceipt: { sha256 } }) // => the same record
 */
function foreignKeptRecordOf(record: Pending): Pending {
  // This build's form already keeps older builds away and names the moved bytes: it stays as it is.
  if (typeof record.retiresReceipt === 'object') return record
  return { ...record, retiresReceipt: {} }
}

/**
 * Gives the identity of the old receipt a first setup moves aside: the bytes' hash its publish record names ({@link movedIdentityOf}) and the inode of the version its run read at `receipt.json` ({@link Context.receiptVersion}), which {@link readRetiringReceipt} checked right before that record was written, so the check right after the move ({@link retireStaleReceipt}) and the put-back after a failed link take only that very file, never a copy with the same bytes at another inode; called only by {@link linkRetiringStaleReceipt}.
 * @param journal - The publish record as written.
 * @param read - The version the run read at `receipt.json`; undefined when it read none.
 * @returns The record's identity with that inode; without the inode when the run read no version; undefined when the record names no bytes, so nothing moves.
 * @example
 * retiringIdentityOf({ ...journal, retiresReceipt: { sha256: '9f86…' } }, { ino: 42n, sha256: '9f86…' }) // => { sha256: '9f86…', ino: 42n }
 * retiringIdentityOf({ ...journal, retiresReceipt: true }, { ino: 42n, sha256: '9f86…' })                 // => undefined
 */
function retiringIdentityOf(
  journal: Pending,
  read: RecordVersion | undefined,
): MovedIdentity | undefined {
  const named = movedIdentityOf(journal)
  // A record that names no bytes moves nothing; the inode comes only from the run's own read.
  if (named === undefined || read === undefined) return named
  return { ...named, ino: read.ino }
}

/**
 * Moves the stale receipt aside and links the staged file in; the steps of {@link linkWithoutStaleReceipt}, which marks the record when the receipt could not go back. The receipt's private name is settled only later, once the caller's read right after the link confirms the publish ({@link linkedConfigState}, {@link dropMovedAfterConfirm}).
 * The staged name is read once more right before the link and looked at synchronously right after that read ({@link assertStagedConfigStill}), after every awaited step of the receipt's move, so nothing is awaited between that last look and the link.
 * @param context - The run.
 * @param staged - The staged file and the inode and bytes this run wrote there.
 * @param staleReceipt - The receipt a first setup retires; undefined otherwise.
 * @param journal - The publish record as written.
 * @returns What {@link linkWithoutStaleReceipt} returns.
 * @throws What {@link linkWithoutStaleReceipt} throws.
 * @example
 * await linkRetiringStaleReceipt(context, staged, staleReceipt, journal) // => { retiredPath, look }: the config stands and the old record waits at its private name for the confirmed publish
 */
async function linkRetiringStaleReceipt(
  context: Context,
  staged: StagedRecord,
  staleReceipt: Receipt | undefined,
  journal: Pending,
): Promise<RetiredMove | undefined> {
  // The publish record names the bytes of the receipt that moves, the run's read its inode; a record without the bytes moves nothing.
  const identity = retiringIdentityOf(journal, context.receiptVersion.current)
  const moved =
    staleReceipt && identity && journal.generation
      ? await retireStaleReceipt(context, identity, journal.generation)
      : undefined
  try {
    // A file another program swapped in at the staged name since this run wrote it is never linked in as the config.
    await assertStagedConfigStill(context, staged)
    await link(staged.staged, context.path)
  } catch (error) {
    // Nothing of this setup stands at the config name: the old receipt stands again, or the failure says where it is.
    if (moved)
      await putBackRetiredReceipt(context, moved.retiredPath, error, {
        identity,
      })
    throw error
  }
  // The link stands, but nothing confirms it yet: the private name stays until the caller's read right after the link finds the file this run wrote at the config name ({@link linkedConfigState}), so a config another program put back in that window (a backup that restored the old config) never loses the receipt that owns its entry before the run refuses.
  return moved
}

/**
 * Reads the config's staged name once more right before the link that puts it in place, through one open file ({@link lookAtStagedRecord}: inode and bytes), and looks at it synchronously right after that read ({@link isStagedNameStill}: inode, size and times), so a file another program swapped in at that name, or bytes it wrote into this run's file, while the setup compared the moved-aside config or moved an old record aside, are never linked in as the config; called only by {@link linkRetiringStaleReceipt}, right before its link, with nothing awaited between this synchronous look and that link.
 * The read is the awaited look at that name, so a storage that already stalls holds this step in the thread pool, where the step's budget answers. Limits: a file swapped in between the synchronous look and the link is linked (no Node primitive links by inode), and the read of the config right after the link answers that ({@link linkedConfigState}); a stall that starts between the read and the synchronous look holds the extension host's thread.
 * @param context - The run; its config path and the command to run again are named in the refusal.
 * @param staged - The staged name and the version this run wrote there.
 * @throws When the name shows another file, other bytes, size or times, nothing, or cannot be read or looked at (nothing is linked then, and the caller's cleanup deletes that name only while it still shows the file and bytes this run wrote there, {@link dropStagedRecord}): a {@link stagedConfigRefusal} while nothing stands at the config name; the {@link configNameTakenError} once a file stands there too, or that name cannot be looked at, so the caller answers as for the link that a file which appeared meanwhile refuses (that file is kept, and a replacement's moved-aside copy is handed over, {@link linkInStaged}).
 * @example
 * await assertStagedConfigStill(context, staged) // throws once a sync tool swapped its file in at '…/mcp_config.json.<generation>.tmp' during the comparison
 */
async function assertStagedConfigStill(
  context: Context,
  staged: StagedRecord,
): Promise<void> {
  const source = await lookAtStagedRecord(staged).catch(() => undefined)
  // A read or a look that fails proves nothing: nothing is linked.
  if (source && isStagedNameStill(staged.staged, source)) return
  const isConfigNameEmpty = await lstatOrAbsent(context.path).then(
    (status) => status === undefined,
    () => false,
  )
  // A file at the config name too: the link would have refused it as one that appeared meanwhile, which the caller already answers.
  throw isConfigNameEmpty
    ? stagedConfigRefusal(context, staged.staged)
    : configNameTakenError()
}

/** The error a link at a taken config name throws (`EEXIST`), for a staged config whose last look failed while a file stands at the config name or that name cannot be looked at ({@link assertStagedConfigStill}): {@link createConfig} and {@link linkInStaged} answer it as the link's own, keeping that file. */
function configNameTakenError(): Error {
  return Object.assign(
    new Error('A file stands at the config name, so nothing was linked.'),
    { code: 'EEXIST' },
  )
}

/**
 * The refusal for a publish whose staged config no longer showed, right before the link that puts it in place, the file this run wrote there ({@link assertStagedConfigStill}): nothing was linked, so the config is as it was (a replacement's moved-aside config went back first, {@link linkInStaged}), and a file another program put at the staged name, or wrote into it, stays.
 * @param context - The run; gives the config path and the command to run again.
 * @param stagedPath - The staged name.
 * @returns The error, not thrown yet.
 * @example
 * stagedConfigRefusal(context, stagedPath) // => 'Codebook did not put its new version of Devin Desktop's MCP config in place at …, because right before that step the file it had written for it at … was no longer the file it wrote …'
 */
function stagedConfigRefusal(
  { path, retry }: Context,
  stagedPath: string,
): Error {
  return new Error(
    `Codebook did not put its new version of Devin Desktop's MCP config in place at ${path}, because right before that step the file it had written for it at ${stagedPath} was no longer the file it wrote (another program replaced or changed it, or Codebook could not read it again); Codebook changed nothing at ${path} and did not delete a file another program put at or wrote to ${stagedPath}, so look at that file, if one stands there, before you delete it, ${retry}.`,
  )
}

/** What the read of the config right after the link found ({@link linkedConfigState}): `linked` the file this run wrote with its bytes, carrying the identity that confirmed it; `other` another file or other bytes; `empty` nothing there; `unread` a read that failed twice (no file handle left, a read error), which proves neither. */
type LinkedConfigState =
  | { state: 'linked'; published: ConfigContinuity }
  | { state: 'other' | 'unread' | 'empty' }

/**
 * Reads the config right after the link that put the staged file in place, through one open file, and tells whether it is the file this run wrote there with the bytes it wrote; called by {@link createConfig} and {@link replaceConfig} before anything rests on that publish: the completed record, the delete of the moved-aside original, the staged name's cleanup and the receipt.
 * The last look before the link ({@link assertStagedConfigStill}) leaves a file another program swapped in at the staged name between that look and the link; the link then published that file, and this read sees it at the config name. It equally refuses bytes another program wrote into the config in place right after the link, which nothing can tell from such a swap. A read that fails (for lack of file handles, for example) proves nothing about the file there: it is tried once more, and a second failure is answered apart, so a publish that went through is never taken for another program's file.
 * @param context - The run; its config path is read.
 * @param staged - The inode and bytes this run wrote at the staged name.
 * @returns The {@link LinkedConfigState}: nothing at the config name counts as `empty`; a link, no regular file or one over the size limit there counts as `other` ({@link isOtherFileCause}).
 * @example
 * await linkedConfigState(context, stagedVersion) // => 'other' once a sync tool swapped its file in at the staged name right before the link
 * await linkedConfigState(context, stagedVersion) // => 'empty' once a sync tool moved the new config away right after the link
 * await linkedConfigState(context, stagedVersion) // => 'unread' while no file handle is left for two reads
 */
async function linkedConfigState(
  context: Context,
  staged: RecordVersion,
): Promise<LinkedConfigState> {
  let published: InspectedCopy | undefined
  try {
    // A failed read proves nothing about the file there: it is tried once more.
    published = await inspectCopy(context.path).catch((cause: unknown) => {
      if (isOtherFileCause(cause)) throw cause
      return inspectCopy(context.path)
    })
  } catch (cause) {
    return isOtherFileCause(cause)
      ? { state: 'other' as const }
      : { state: 'unread' as const }
  }
  if (published === undefined) return { state: 'empty' }
  return published.ino === staged.ino && published.sha256 === staged.sha256
    ? { state: 'linked', published }
    : { state: 'other' }
}

/**
 * The refusal for a replacement whose config name was empty right after its link ({@link linkedConfigState}): the moved-aside previous config is already back there, nothing of the publish is recorded as finished, and the record written before the link stays so the next run settles the staged file and any retired receipt; called by {@link replaceConfig}.
 * @param context - The run; gives the config path, the record's path and the command to run again.
 * @returns The error, not thrown yet.
 * @example
 * emptyAfterLinkRefusal(context) // => 'Codebook put its new version of Devin Desktop's MCP config in place at …, but nothing stood at that path right afterwards …'
 */
function emptyAfterLinkRefusal({ path, pendingPath, retry }: Context): Error {
  return new Error(
    `Codebook put its new version of Devin Desktop's MCP config in place at ${path}, but nothing stood at that path right afterwards (another program may have moved or deleted it), so Codebook put your previous config back there and did not record that change as finished; its record of that change at ${pendingPath} stays, and the next run reads it first; look at the file, ${retry}.`,
  )
}

/**
 * The refusal for a publish whose config Codebook could not read again right after its link, twice ({@link linkedConfigState}): nothing rests on that publish, nothing is handed over, and the record written before the link stays, so the next run settles that change as after a stop right after the link; called by {@link createConfig} and {@link replaceConfig}.
 * @param context - The run; gives the config path, the record's path and the command to run again.
 * @param copyPath - A replacement's moved-aside copy of the previous config, which that record still tracks; undefined for a create.
 * @returns The error, not thrown yet.
 * @example
 * unreadAfterLinkRefusal(context, displacedPath) // => 'Codebook put its new version of Devin Desktop's MCP config in place at … but could not read that file again right afterwards … Codebook kept a private copy of your previous Devin MCP config at …'
 */
function unreadAfterLinkRefusal(
  { path, pendingPath, retry }: Context,
  copyPath?: string,
): Error {
  const copy =
    copyPath === undefined
      ? ''
      : ` Codebook kept ${keptCopyPhrase(copyPath)}, ${LEFTOVER_CLAUSE}.`
  return new Error(
    `Codebook put its new version of Devin Desktop's MCP config in place at ${path} but could not read that file again right afterwards (for example for lack of file handles), so it did not record that change as finished and went no further; its record of that change at ${pendingPath} stays, and the next run reads it first; make that config readable by you if it is not, ${retry}.${copy}`,
  )
}

/** What a first setup's link left at its old record's private name ({@link dropMovedAfterLink}): `gone` once nothing of the old record is left there, `kept` when that name stays while it may still show the record the setup moved there and verified (the look or the delete failed), `replaced` when it stays because it showed another file, which Codebook never read. */
type RetiredNameEnd = 'gone' | 'kept' | 'replaced'

/** What a first setup's confirmed publish leaves for its publish record ({@link dropMovedAfterConfirm}): the record the caller writes from then on (the one written before the link, or its shape older builds refuse once the old record's private name showed another file, {@link foreignKeptRecordOf}), and whether that name stayed ({@link Published.isRetiredKept}), so the caller keeps that record. */
type LinkedRecord = { journal: Pending; isRetiredKept: boolean }

/**
 * Deletes a first setup's old record from its private name once that setup's config stands, only while a synchronous look right before the delete still shows the file the setup moved there and verified ({@link retireStaleReceipt}), so a file another program put there while the config was linked in is never deleted unread; called only by {@link dropMovedAfterConfirm}, once the read right after the link confirms the publish.
 * A look through the thread pool comes first ({@link lookAheadAt}), so a storage that already stalls stalls there, where the setup's budget answers. Limits: a file put there between the synchronous look and the delete is not seen (no Node primitive unlinks by inode), and a stall that starts between the two looks still holds the extension host's thread.
 * @param context - The run; its seam is called around the synchronous look ({@link nameStateNow}).
 * @param moved - The private name and the look at it before the setup's read of the record it moved there ({@link RetiredMove}).
 * @returns
 * - `gone` once that name is gone: deleted now, or already empty, so nothing of the old record is left to settle
 * - `replaced` when it stays because it shows another file, which is never read: the caller keeps the publish record in the shape older builds refuse ({@link foreignKeptRecordOf}), so the next run settles that name ({@link settleRetiredReceipt})
 * - `kept` when it stays because the look or the delete failed: the caller keeps the publish record, so the next run settles that name
 * @example
 * await dropMovedAfterLink(context, moved) // => 'replaced' after a sync tool put another file at the private name during the config's link
 */
async function dropMovedAfterLink(
  context: Context,
  { retiredPath, look }: RetiredMove,
  confirmed: ConfigContinuity,
): Promise<RetiredNameEnd> {
  await lookAheadAt([retiredPath, context.path])
  const state = nameStateNow(context, retiredPath, look)
  // Nothing stands there any more: nothing of the old record is left to delete.
  if (state === 'gone') return 'gone'
  // Another file there: it is never deleted unread, and the publish record that leads the next run there keeps older builds from putting it back.
  if (state === 'changed') return 'replaced'
  // A look that failed: the name stays, and the publish record leads the next run there.
  if (state !== 'still') return 'kept'
  // The confirmed publish alone makes the old record safe to delete, so the config must still be the very file that confirmed it, checked last before the unlink.
  let isConfirmedStill: boolean
  try {
    isConfirmedStill = isConfigUnchanged(context, confirmed)
  } catch {
    // A look that fails proves nothing: the name stays, and the publish record leads the next run there.
    isConfirmedStill = false
  }
  if (!isConfirmedStill) return 'kept'
  return unlink(retiredPath).then(
    (): RetiredNameEnd => 'gone',
    // A name already gone is what the delete was for; another failure keeps the name and the record that leads there.
    (cause: unknown): RetiredNameEnd =>
      codeOf(cause) === 'ENOENT' ? 'gone' : 'kept',
  )
}

/**
 * Deletes a first setup's old record from its private name once the read right after the publish link confirms the config as the file this run wrote ({@link linkedConfigState}), and gives the publish record the caller writes from then on; called by {@link createConfig} and {@link replaceConfig} only after that confirmation, never before it: a config another program put back in the window between the link and that read (a backup that restored the old config) makes the run refuse with the record written before the link, and the private name then stays with it, so the next run settles the restored entry's receipt with its own checks ({@link settleRetiredReceipt}) instead of leaving that entry without the receipt that owns it.
 * @param context - The run.
 * @param journal - The publish record as written before the link.
 * @param moved - The private name and the look at it before the setup's read of the record it moved there ({@link RetiredMove}), as the link left it; undefined when no receipt moved, so nothing is deleted.
 * @returns The {@link LinkedRecord}: the record the caller writes from then on and whether the private name stayed.
 * @example
 * await dropMovedAfterConfirm(context, journal, moved) // => { journal, isRetiredKept: false }: receipt.json's old record is gone once the config is confirmed
 */
async function dropMovedAfterConfirm(
  context: Context,
  journal: Pending,
  moved: RetiredMove | undefined,
  confirmed: ConfigContinuity,
): Promise<LinkedRecord> {
  // The confirmed publish stands: the old receipt covers nothing only while that same config still stands, and its private name goes only while it still shows that receipt.
  const retiredEnd = moved
    ? await dropMovedAfterLink(context, moved, confirmed)
    : 'gone'
  return {
    // Another file at that name, which Codebook never read: from the next write on, older builds refuse the record that leads there.
    journal: retiredEnd === 'replaced' ? foreignKeptRecordOf(journal) : journal,
    isRetiredKept: retiredEnd !== 'gone',
  }
}

/** Why a first setup's moved record was kept under its private name: what a put-back that found `receipt.json` taken saw there ({@link standingReceiptOf}), `other` when it is provably not Codebook's record of that entry, `foreign` when a record of this config stands there and the moved file is no record of this config, `unread` when Codebook could not tell; `moved-unread` when the moved record itself could not be read, or `moved-changed` when its private name showed another file after the read; `superseded` when the record at `receipt.json` owns the entry the config holds and the moved record does not, or `config-unread` when the config could not be read to tell which owns it or changed after the read that told; `undeleted` when the moved record was to be deleted beside a record that covers it and the delete failed, or when its private name after a put-back's link that stood could not go, because the looks no longer showed the linked record at `receipt.json` and at that name as a second name of it or the delete failed ({@link dropLinkedPrivateName}); `linked-unverified` when after such a link `receipt.json` shows another file than the record that was read, which nothing proves the link's own ({@link refuseUnverifiedLink}), or the file it put there no longer holds that record ({@link dropLinkedPrivateName}); `moved-gone` when the setup that moved the record found its private name empty as it went to put it back ({@link endOnEmptyName}), `moved-gone-beside` when it found that name empty as it settled the record beside something that stands at `receipt.json` ({@link settleTakenName}); `moved-foreign` when the file at the private name is no record of this config while nothing stands at `receipt.json` ({@link settleForeignMoved}), `moved-foreign-other` when something that is not Codebook's record of that entry stands there instead, and `moved-foreign-unread` when Codebook could not tell what stands there. */
type UnrestoredStanding =
  | 'other'
  | 'foreign'
  | 'unread'
  | 'moved-unread'
  | 'moved-changed'
  | 'superseded'
  | 'config-unread'
  | 'undeleted'
  | 'undeleted-replaced'
  | UnverifiedReceiptStanding
  | 'moved-gone'
  | 'moved-gone-beside'
  | 'moved-foreign'
  | 'moved-foreign-other'
  | 'moved-foreign-unread'
  | UnverifiedForeignStanding
  | 'receipt-unverified'

/** The answers for a receipt of this config at the private name that is not the one the publish record names ({@link isMovedFile}): another installation's record, say, or any record an older build's publish record leads to, which names no bytes. Each keeps that file as its `foreign` counterpart keeps a file that is no record ({@link UNVERIFIED_FOREIGN_ANSWERS}), worded with the lead that Codebook cannot tell that file is the record it moved there ({@link foreignMovedSentence}). */
type UnverifiedForeignStanding =
  | 'foreign-unverified'
  | 'moved-unverified'
  | 'moved-unverified-other'
  | 'moved-unverified-unread'

/** The answers of a put-back that left a file at `receipt.json` Codebook did not verify as the old record it read (criterion 17's residual, {@link refuseUnverifiedLink}, {@link confirmRenamedRecord}): `linked-…` after the link, `renamed-…` after the rename of the route without links, which leaves no private name; `…-unverified` while the publish record on disk notes that `receipt.json` is unverified, `…-unnoted` when no write of that note went through ({@link withNoteState}), so the sentence says that a window may take that file for Codebook's record until it is moved ({@link unverifiedPutBackSentence}). */
type UnverifiedReceiptStanding =
  | 'linked-unverified'
  | 'linked-unnoted'
  | 'renamed-unverified'
  | 'renamed-unnoted'

/** Every {@link UnverifiedReceiptStanding}: the answers whose publish record must note that `receipt.json` is unverified ({@link keptRecordOf}) and whose sentence {@link unverifiedPutBackSentence} words. */
const UNVERIFIED_RECEIPT_STANDINGS: ReadonlySet<
  UnrestoredStanding | undefined
> = new Set<UnrestoredStanding>([
  'linked-unverified',
  'linked-unnoted',
  'renamed-unverified',
  'renamed-unnoted',
])

/** The `…-unnoted` counterpart of each noted {@link UnverifiedReceiptStanding}, which {@link UnrestoredReceiptError.withoutNote} takes once no write of the note went through. */
const UNNOTED_STANDINGS: ReadonlyMap<
  UnrestoredStanding | undefined,
  UnverifiedReceiptStanding
> = new Map<UnrestoredStanding, UnverifiedReceiptStanding>([
  ['linked-unverified', 'linked-unnoted'],
  ['renamed-unverified', 'renamed-unnoted'],
])

/** What a put-back found at the old record's private name when it settles that file beside what stands at `receipt.json` ({@link settleForeignMoved}): `no-record` for a file that is no record of this config, `unverified-record` for a record of this config that is not the one the publish record names ({@link UnverifiedForeignStanding}). */
type MovedFileKind = 'no-record' | 'unverified-record'

/** The `foreign` answer each {@link UnverifiedForeignStanding} keeps its file as; the sentence differs only in its lead ({@link foreignMovedSentence}). */
const UNVERIFIED_FOREIGN_ANSWERS: ReadonlyMap<
  UnrestoredStanding | undefined,
  UnrestoredStanding
> = new Map([
  ['foreign-unverified', 'foreign'],
  ['moved-unverified', 'moved-foreign'],
  ['moved-unverified-other', 'moved-foreign-other'],
  ['moved-unverified-unread', 'moved-foreign-unread'],
])

/** The answers that keep a file at the private name that Codebook did not verify as its record of this config ({@link UnrestoredReceiptError.isForeignKept}). */
const FOREIGN_KEPT_STANDINGS: ReadonlySet<UnrestoredStanding | undefined> =
  new Set<UnrestoredStanding>([
    'foreign',
    'moved-foreign',
    'moved-foreign-other',
    'moved-foreign-unread',
    'moved-changed',
    'linked-unverified',
    'linked-unnoted',
    'renamed-unverified',
    'renamed-unnoted',
    'undeleted-replaced',
    'foreign-unverified',
    'moved-unverified',
    'moved-unverified-other',
    'moved-unverified-unread',
  ])

/** What the publish record tells about a first setup's link when that setup's moved record could not go back ({@link Pending.notLinked}): `marked` when it says that nothing of the setup was linked; `unwritten` when the setup itself could not write that mark ({@link UnrestoredReceiptError.withoutMark}); `unmarked` when a later run settles a record without that mark ({@link PutBackOptions.mark}), which also a setup that linked its config leaves, so the records that remain cannot tell whether the old record may go back. */
type PublishMark = 'marked' | 'unwritten' | 'unmarked'

/**
 * Thrown by {@link putBackRetiredReceipt} when a receipt a first setup moved aside could not go back to `receipt.json`, and by {@link retiredReceiptFateOf} when that receipt could not be read: its text names the private file and the way out, and it carries what made the put-back necessary (`failure`: the link's failure or a {@link changedRecordRefusal}), which the caller words as before and puts in front ({@link withUnrestoredNote}). The callers keep the publish record that names the private file ({@link Pending.retiresReceipt}), so the next run puts the receipt back ({@link settleRetiredReceipt}), or decides again when the record could not be marked {@link Pending.notLinked} ({@link UnrestoredReceiptError.withoutMark}).
 */
class UnrestoredReceiptError extends Error {
  constructor(
    context: Context,
    readonly retiredPath: string,
    readonly failure: unknown,
    cause: unknown,
    readonly standing?: UnrestoredStanding,
    readonly mark: PublishMark = 'marked',
  ) {
    super(unrestoredSentence(context, retiredPath, standing, mark), {
      cause,
    })
  }

  /**
   * Gives the same error worded for a put-back whose note that `receipt.json` is unverified could not be written ({@link UNNOTED_STANDINGS}); called by {@link withNoteState} once the publish record on disk carries no such note.
   * @param context - The run; gives the paths and the command to run again.
   * @returns An error with the same private file, failure, cause and mark whose sentence says that the note could not be written; this error itself for any other answer.
   * @example
   * throw error.withoutNote(context) // '… is unverified, and Codebook could not note that in its publish record at …/pending.json (for example on a full disk), …'
   */
  withoutNote(context: Context): UnrestoredReceiptError {
    const unnoted = UNNOTED_STANDINGS.get(this.standing)
    if (unnoted === undefined) return this
    return new UnrestoredReceiptError(
      context,
      this.retiredPath,
      this.failure,
      this.cause,
      unnoted,
      this.mark,
    )
  }

  /**
   * Gives the same error worded for a publish record that could not be marked {@link Pending.notLinked}; called by {@link linkWithoutStaleReceipt} when that write failed.
   * @param context - The run; gives the paths and the command to run again.
   * @returns An error with the same private file, failure, cause and standing, whose sentence promises no put-back.
   * @example
   * throw error.withoutMark(context) // '… and it could not note in its publish record at …/pending.json that nothing of this setup was linked, so it kept both files and the next run decides again whether that record goes back; …'
   */
  withoutMark(context: Context): UnrestoredReceiptError {
    return new UnrestoredReceiptError(
      context,
      this.retiredPath,
      this.failure,
      this.cause,
      this.standing,
      'unwritten',
    )
  }

  /** Whether the file this error keeps at the private name is one Codebook did not verify as its record of this config: no record of this config, or a record of this config other than the one the publish record names ({@link UnverifiedForeignStanding}), beside a record of this config at `receipt.json` (`foreign`, {@link compareStandingReceipt}) or beside anything else there ({@link settleForeignMoved}), or a file that replaced the record Codebook read there (`moved-changed` and `linked-unverified`), so an older build's publish record that leads there is written in the shape older builds refuse ({@link foreignKeptRecordOf}). */
  get isForeignKept(): boolean {
    return FOREIGN_KEPT_STANDINGS.has(this.standing)
  }
}

/** The {@link UnrestoredReceiptError} of a first setup's undo of a move that took another receipt than the one its run read ({@link retireStaleReceipt}), once the file the move took is proven (its inode and the bytes read right after the move, {@link undoIdentityOf}): it names those bytes, so the publish record marked {@link Pending.notLinked} names the file that waits at the private name and the next run puts that file back as the sentence promises, never comparing it with the receipt the run had read ({@link notLinkedRecordOf}). */
class UndoneMoveError extends UnrestoredReceiptError {
  constructor(
    context: Context,
    error: UnrestoredReceiptError,
    readonly movedSha256: string,
  ) {
    super(
      context,
      error.retiredPath,
      error.failure,
      error.cause,
      error.standing,
    )
  }
}

/**
 * Words why a receipt a first setup moved aside could not go back, with the way out that fits what stood at its name; called only by {@link UnrestoredReceiptError}.
 * @param context - The run; gives the config's, the receipt's and the publish record's paths and the command to run again.
 * @param retiredPath - The private name that holds the old record.
 * @param standing - What stood at `receipt.json` when the link found it taken ({@link standingReceiptOf}), or `moved-unread` when the old record could not be read; undefined when the link failed otherwise.
 * @param mark - What the publish record tells about the setup's link ({@link PublishMark}); unless `marked`, no sentence promises that a later run puts the record back, because that run cannot tell and decides again, and the sentence says why from what this run knows: `unwritten` that the setup could not note that nothing was linked, `unmarked` that the records that remain cannot tell whether the old record may go back.
 * @returns
 * - Without `standing`: the sentence that the next run puts the record back; unless marked, that it decides again whether it goes back
 * - `other`: the sentence that asks the learner to move what stands there to another folder, after which that run puts the old record back (unless marked: decides again)
 * - `unread`: the sentence that Codebook kept the old record and its publish record, changed nothing at `receipt.json` and looks again, which advises no removal
 * - `moved-unread`: the sentence that names the private file Codebook could not read and asks to delete neither record
 * - `moved-changed`: the sentence that the file at the private name changed while Codebook read it, so it kept both and looks again, which advises no removal
 * - `superseded`: the sentence that Codebook's record of the entry the config holds stands at `receipt.json` again and asks to move the old record, never that record, to another folder
 * - `config-unread`: the sentence that Codebook could not read the config to tell whether the record at `receipt.json` belongs to its entry, or that config changed after that read, so it kept both and looks again, which names no record to move
 * - `undeleted`, `linked-unverified`, `moved-gone`, `moved-gone-beside`, and the answers for a file at the private name that is no record of this config (`foreign`, `moved-foreign`, `moved-foreign-other`, `moved-foreign-unread`): what {@link keptNameSentence} words
 * @example
 * unrestoredSentence(context, retiredPath, 'other', 'marked')   // => 'Codebook moved its own old record … because something that is not Codebook's record of that entry stands at …/receipt.json; move it to another folder, then run Codebook: Set Up AI Chat again, and that run puts the old record back.'
 * unrestoredSentence(context, retiredPath, 'other', 'unmarked') // => '… stands at …/receipt.json, and it cannot tell from the remaining records whether the old record may go back; move what stands there to another folder, then run Codebook: Set Up AI Chat again, and that run decides again whether the old record goes back.'
 */
function unrestoredSentence(
  context: Context,
  retiredPath: string,
  standing: UnrestoredStanding | undefined,
  mark: PublishMark,
): string {
  const { path, receiptPath, pendingPath, retry } = context
  // Only the setup itself knows that its mark failed; a later run sees a record without the mark, which a setup that linked its config leaves too.
  const undecided =
    mark === 'unwritten'
      ? `it could not note in its publish record at ${pendingPath} that nothing of this setup was linked`
      : 'it cannot tell from the remaining records whether the old record may go back'
  // The old record's private file itself decided the end: its own sentence names that file.
  const keptName = keptNameSentence(
    context,
    retiredPath,
    standing,
    mark,
    undecided,
  )
  if (keptName !== undefined) return keptName
  // The record that stands owns the entry the config holds and the moved one owns nothing there: only the moved one is to be moved.
  if (standing === 'superseded')
    return `Codebook moved its own old record of a setup whose entry is gone from ${receiptPath} to ${retiredPath} and kept it there, because its record of the "${SERVER_NAME}" entry that Devin Desktop's MCP config at ${path} holds stands at ${receiptPath} again; move that old record to another folder, ${retry}.`
  // The private file failed, not receipt.json: a failed read says nothing about the record, so both records stay and none is to be deleted.
  if (standing === 'moved-unread')
    return `Codebook could not read its own old record of a setup whose entry is gone, which it had moved from ${receiptPath} to ${retiredPath}, so it kept that file and the publish record at ${pendingPath} and the next run reads it again; delete neither, make that file readable by you if it is not, ${retry}.`
  const lead = `Codebook moved its own old record of a setup whose entry is gone from ${receiptPath} to ${retiredPath} and could not put it back`
  // Another file stood at the private name by the end of the read: nothing the read compared may be deleted, so both stay.
  if (standing === 'moved-changed')
    return `${lead}, because the file at ${retiredPath} changed while Codebook read it. Codebook kept both files, so the next run looks again; ${retry}.`
  // Without the config, or with a config that changed after the read that told, nothing tells which record owns its entry, so neither is to be moved.
  if (standing === 'config-unread')
    return `${lead}, because it could not read Devin Desktop's MCP config at ${path} to tell whether the record at ${receiptPath} belongs to its "${SERVER_NAME}" entry, or that config changed after Codebook read it to tell. Codebook kept both files, so the next run looks again; look at that config, ${retry}.`
  // A folder, another file or a record of an entry the config does not hold: moving it away frees the name without deleting anything.
  if (standing === 'other')
    return mark === 'marked'
      ? `${lead}, because something that is not Codebook's record of that entry stands at ${receiptPath}; move it to another folder, ${retry}, and that run puts the old record back.`
      : `${lead}, because something that is not Codebook's record of that entry stands at ${receiptPath}, and ${undecided}; move what stands there to another folder, ${retry}, and that run decides again whether the old record goes back.`
  // Nothing is known about what stands there, so nothing is to be moved or removed; the sentence names the files Codebook kept, since receipt.json may hold nothing by then.
  if (standing === 'unread')
    return `${lead}, because it could not tell what stands at ${receiptPath} (it could not look at that name, or what stood there kept changing). Codebook kept that old record and its publish record at ${pendingPath} and changed nothing at ${receiptPath}, so the next run looks again; make what stands at ${receiptPath} readable by you if it is not, ${retry}.`
  return mark === 'marked'
    ? `${lead}, so the next run puts it back; if that fails too, move that file back by hand, ${retry}.`
    : `${lead}, and ${undecided}, so it kept both files and the next run decides again whether that record goes back; ${retry}.`
}

/**
 * Words the ends of a put-back that the old record's private file itself decided, apart from what stands at `receipt.json`; called only by {@link unrestoredSentence}, which keeps its own branches for the other answers.
 * @param context - The run; gives the paths and the command to run again.
 * @param retiredPath - The private name that holds the old record.
 * @param standing - Why the old record was kept ({@link UnrestoredStanding}); undefined when the link failed otherwise.
 * @param mark - What the publish record tells about the setup's link ({@link PublishMark}).
 * @param undecided - The clause that says why the remaining records cannot tell whether the old record may go back, for a `mark` other than `marked`.
 * @returns
 * - `undeleted`: the {@link retiredDropRefusal} sentence, which names that file and the publish record that stay, and that the next run looks at that file again
 * - `undeleted-replaced`: the sentence that the old record went back to `receipt.json` and another file took its private name right after, which Codebook did not verify, so that file and the publish record stay and that file is to be moved to another folder
 * - each {@link UnverifiedReceiptStanding}: what {@link unverifiedPutBackSentence} words
 * - `moved-gone`, `moved-gone-beside`: what {@link goneNameSentence} words
 * - `receipt-unverified`: the sentence that the publish record notes a file a put-back left at `receipt.json` unverified, which still stands there, so Codebook did not take it for its record, deleted nothing, and asks to move it to another folder
 * - `foreign`, `moved-foreign`, `moved-foreign-other`, `moved-foreign-unread` and their unverified counterparts ({@link UnverifiedForeignStanding}): what {@link foreignMovedSentence} words
 * - undefined for every other answer
 * @example
 * keptNameSentence(context, retiredPath, 'undeleted', 'marked', undecided)  // => 'Codebook could not delete …/receipt.json.<generation>.retired, its own old record of a setup whose entry is gone (…), so it kept that file and the publish record at …/pending.json, and the next run looks at that file again; …'
 * keptNameSentence(context, retiredPath, 'moved-gone', 'marked', undecided) // => 'Codebook moved its own old record … and nothing stood at … when it went to put that record back (another program moved or deleted it), so it kept its publish record at …/pending.json, …'
 * keptNameSentence(context, retiredPath, 'other', 'marked', undecided)      // => undefined
 */
function keptNameSentence(
  context: Context,
  retiredPath: string,
  standing: UnrestoredStanding | undefined,
  mark: PublishMark,
  undecided: string,
): string | undefined {
  const { path, receiptPath, pendingPath, retry } = context
  // The delete beside a record that covers the old one failed: that file and the publish record that leads to it stay.
  if (standing === 'undeleted')
    return retiredDropRefusal(context, retiredPath).message
  // The old record went back, and another file took its private name right after: that file is never called Codebook's old record.
  if (standing === 'undeleted-replaced')
    return `Codebook put its own old record of a setup whose entry is gone back at ${receiptPath}, but right after that another file took ${retiredPath}, which Codebook did not verify as its record of Devin Desktop's MCP config at ${path} (another program may have put it there); Codebook kept that file and its publish record at ${pendingPath}, so move that file to another folder, ${retry}.`
  // The put-back's link or rename put a file Codebook never read at receipt.json and could not take it back: that file stays, and receipt.json is called unverified.
  if (UNVERIFIED_RECEIPT_STANDINGS.has(standing))
    return unverifiedPutBackSentence(context, retiredPath, standing)
  // A put-back's link left a file Codebook did not verify at receipt.json, and that file still stands there: it is never taken for Codebook's record.
  if (standing === 'receipt-unverified')
    return `Codebook's publish record at ${pendingPath} notes that a put-back for a setup left a file at ${receiptPath} that Codebook did not verify as its record of Devin Desktop's MCP config at ${path} (another program may have replaced the record Codebook read at ${retiredPath}), and that file still stands there, so Codebook did not take it for its record, deleted nothing and kept that publish record; move the file at ${receiptPath} to another folder, ${retry}.`
  // A file at the private name that is no record of this config, or not the record that moved there, is never called Codebook's old record, and no put-back is promised for it.
  const foreign = foreignMovedSentence(context, retiredPath, standing)
  if (foreign !== undefined) return foreign
  // An empty name proves nothing in the setup that moved the record there: the publish record stays, and the next run looks there again.
  if (standing === 'moved-gone' || standing === 'moved-gone-beside')
    return goneNameSentence(
      context,
      retiredPath,
      standing === 'moved-gone-beside',
      mark,
      undecided,
    )
  return undefined
}

/**
 * Words a put-back that left a file at `receipt.json` that Codebook did not verify as the old record it had read at the private name, and could not take that put-back back ({@link UnverifiedReceiptStanding}); called only by {@link keptNameSentence}.
 * The sentence says whether the publish record notes that `receipt.json` is unverified, because only that note keeps a window from marking itself for the installation that file names: with the note, the next run looks again; without it, the file is to be moved.
 * @param context - The run; gives the paths and the command to run again.
 * @param retiredPath - The old record's private name.
 * @param standing - Which put-back it was and whether its note stands ({@link UnverifiedReceiptStanding}).
 * @returns
 * - `linked-unverified`: the sentence that the link put another file at `receipt.json`, that Codebook kept both files and noted that in its publish record, and that the next run looks at both names again
 * - `renamed-unverified`: the same for the rename of the route without links, which kept that file and names only `receipt.json` to look at again
 * - `linked-unnoted`, `renamed-unnoted`: the sentence that Codebook could not note that in its publish record (for example on a full disk), so a window may take that file for Codebook's record until it is moved, and that the file at `receipt.json` is to be moved to another folder
 * @example
 * unverifiedPutBackSentence(context, retiredPath, 'linked-unverified') // => 'Codebook put the file at … back at …/receipt.json for a setup, …, so what stands at …/receipt.json is unverified; Codebook kept both files and noted that in its publish record at …/pending.json, and the next run looks at both names again; …'
 * unverifiedPutBackSentence(context, retiredPath, 'renamed-unnoted')   // => 'Codebook moved the file at … back to …/receipt.json for a setup, …, and Codebook could not note that in its publish record at …/pending.json (for example on a full disk), …'
 */
function unverifiedPutBackSentence(
  { path, receiptPath, pendingPath, retry }: Context,
  retiredPath: string,
  standing: UnrestoredStanding | undefined,
): string {
  const isRenamed =
    standing === 'renamed-unverified' || standing === 'renamed-unnoted'
  const step = isRenamed
    ? `moved the file at ${retiredPath} back to ${receiptPath}`
    : `put the file at ${retiredPath} back at ${receiptPath}`
  const lead = `Codebook ${step} for a setup, but by then that file was no longer the record of Devin Desktop's MCP config at ${path} that Codebook had read there (another program may have replaced it), and Codebook could not take that put-back back, so what stands at ${receiptPath} is unverified`
  // The rename leaves no private name: only the file at receipt.json is kept.
  const kept = isRenamed ? 'kept that file' : 'kept both files'
  // Without the note a window may take that file for Codebook's record: it is to be moved.
  if (standing === 'linked-unnoted' || standing === 'renamed-unnoted')
    return `${lead}, and Codebook could not note that in its publish record at ${pendingPath} (for example on a full disk), so a window may take that file for Codebook's record until you move it; Codebook ${kept}, so move the file at ${receiptPath} to another folder, ${retry}.`
  const names = isRenamed ? receiptPath : 'both names'
  return `${lead}; Codebook ${kept} and noted that in its publish record at ${pendingPath}, and the next run looks at ${names} again; ${retry}.`
}

/**
 * Words a setup's put-back that found the old record's private name empty ({@link endOnEmptyName}); called only by {@link keptNameSentence}.
 * @param context - The run; gives the paths and the command to run again.
 * @param retiredPath - The private name that was found empty.
 * @param isBesideStanding - Whether the setup found that name empty as it settled the record beside something at `receipt.json` (`moved-gone-beside`): the next run then compares a record that stands at the private name by then with what stands there, so the sentence promises a put-back only while nothing stands at `receipt.json`.
 * @param mark - What the publish record tells about the setup's link ({@link PublishMark}).
 * @param undecided - The clause that says why the remaining records cannot tell whether the old record may go back, for a `mark` other than `marked`.
 * @returns
 * - marked: the sentence that nothing stood at the private name, so the setup kept its publish record and the next run looks there again and puts that old record back if it stands there by then, beside something at `receipt.json` only after comparing the two and only while nothing stands there
 * - otherwise: the sentence that the next run decides again whether that record goes back
 * @example
 * goneNameSentence(context, retiredPath, true, 'marked', undecided) // => '… when it went to settle that record beside what stands at …/receipt.json (another program moved or deleted it), so it kept its publish record at …/pending.json, and the next run looks at … again and compares …'
 */
function goneNameSentence(
  { receiptPath, pendingPath, retry }: Context,
  retiredPath: string,
  isBesideStanding: boolean,
  mark: PublishMark,
  undecided: string,
): string {
  const step = isBesideStanding
    ? `settle that record beside what stands at ${receiptPath}`
    : 'put that record back'
  const gone = `Codebook moved its own old record of a setup whose entry is gone from ${receiptPath} to ${retiredPath}, and nothing stood at ${retiredPath} when it went to ${step} (another program moved or deleted it)`
  if (mark !== 'marked')
    return `${gone}, and ${undecided}, so the next run decides again whether that record goes back if it stands at ${retiredPath} by then; ${retry}.`
  // Beside something at receipt.json the next run compares the two: a record of the same entry there wins, and the private one goes back only to an empty name. Only the old record itself goes back, never another file put there meanwhile.
  const next = isBesideStanding
    ? `compares that record, if it stands there by then, with what stands at ${receiptPath}, and puts it back only while nothing stands there`
    : 'puts that record back if it stands there by then'
  return `${gone}, so it kept its publish record at ${pendingPath}, and the next run looks at ${retiredPath} again and ${next}; ${retry}.`
}

/**
 * Words a put-back that found a file at the old record's private name that is no record of this config, or a record of this config other than the one its publish record names ({@link UnverifiedForeignStanding}), by what stands at `receipt.json`; called only by {@link keptNameSentence}.
 * That file is never called Codebook's old record and no put-back is promised for it: the setup that moved the record there may have moved a record another program replaced since, or a file another program had put at `receipt.json`, so the sentence says only that another program may have put it there. Unless Codebook's record of this config stands at `receipt.json`, the sentence also says what the run after the move does: with no record of Codebook's there, that run takes a `codebook` entry the config holds for one of the learner's own, because no record proves it Codebook's.
 * @param context - The run; gives the paths and the command to run again.
 * @param retiredPath - The private name that holds that file.
 * @param standing - Why the file was kept ({@link UnrestoredStanding}); undefined when the link failed otherwise.
 * @returns
 * - `foreign`: the sentence that Codebook's record of this config stands at `receipt.json` again, so only that file is to be moved to another folder
 * - `moved-foreign`: the sentence that asks to move that file to another folder
 * - `moved-foreign-other`: the sentence that something that is not Codebook's record of that entry stands at `receipt.json`, so that file and what stands there are to be moved to another folder
 * - `moved-foreign-unread`: the sentence that Codebook could not tell what stands at `receipt.json`, so that file is to be moved and what stands there made readable
 * - each {@link UnverifiedForeignStanding}: the sentence of its counterpart, led by the clause that Codebook cannot tell that file is the record it moved there
 * - undefined for every other answer
 * @example
 * foreignMovedSentence(context, retiredPath, 'moved-foreign') // => 'Codebook did not put back the file at …, where it had moved what stood at …/receipt.json for a setup, because that file is no record of Devin Desktop's MCP config at … (another program may have put it there); it kept that file and its publish record at …/pending.json, so move that file to another folder, then run Codebook: Set Up AI Chat again. Unless a record of Codebook's stands at …/receipt.json by then, that run takes a "codebook" entry that the config holds for one of your own and leaves it as it is.'
 * foreignMovedSentence(context, retiredPath, 'other')         // => undefined
 */
function foreignMovedSentence(
  context: Context,
  retiredPath: string,
  standing: UnrestoredStanding | undefined,
): string | undefined {
  const { path, receiptPath, pendingPath, retry } = context
  // A record of this config that is not the one that moved there keeps the same way out, with the lead that Codebook cannot tell it is that record.
  const unverifiedAs = UNVERIFIED_FOREIGN_ANSWERS.get(standing)
  const answer = unverifiedAs ?? standing
  const why =
    unverifiedAs === undefined
      ? `that file is no record of Devin Desktop's MCP config at ${path}`
      : `Codebook cannot tell that file is the record of Devin Desktop's MCP config at ${path} that it moved there`
  const lead = `Codebook did not put back the file at ${retiredPath}, where it had moved what stood at ${receiptPath} for a setup, because ${why} (another program may have put it there)`
  const kept = `it kept that file and its publish record at ${pendingPath}`
  // Codebook's record of this config stands at receipt.json: only that file is to be moved, and that record stays where it is.
  if (answer === 'foreign')
    return `${lead}, and its record of that config stands at ${receiptPath} again; ${kept}, so move that file to another folder, ${retry}.`
  // No record proves the entry Codebook's once that file is moved: the run after the move says so instead of finding it current.
  const unowned = ` Unless a record of Codebook's stands at ${receiptPath} by then, that run takes a "${SERVER_NAME}" entry that the config holds for one of your own and leaves it as it is.`
  if (answer === 'moved-foreign')
    return `${lead}; ${kept}, so move that file to another folder, ${retry}.${unowned}`
  if (answer === 'moved-foreign-other')
    return `${lead}, and something that is not Codebook's record of its "${SERVER_NAME}" entry stands at ${receiptPath}; ${kept}, so move that file and what stands at ${receiptPath} to another folder, ${retry}.${unowned}`
  if (answer === 'moved-foreign-unread')
    return `${lead}, and it could not tell what stands at ${receiptPath} (it could not look at that name, or what stood there kept changing); ${kept}, so move that file to another folder, make what stands at ${receiptPath} readable by you if it is not, ${retry}.${unowned}`
  return undefined
}

/**
 * Gives what a link-in step failed with, past an {@link UnrestoredReceiptError} that carries it; called by {@link createConfig} and {@link linkInStaged}, which word that failure as before.
 * @param error - What {@link linkWithoutStaleReceipt} threw.
 * @returns The failure the error carries; the error itself for every other error.
 * @example
 * failureOf(new UnrestoredReceiptError(context, retiredPath, eexist, eio)) // => eexist
 * failureOf(eexist)                                                        // => eexist
 */
function failureOf(error: unknown): unknown {
  return error instanceof UnrestoredReceiptError ? error.failure : error
}

/**
 * Appends the sentence of an {@link UnrestoredReceiptError} to the refusal a caller worded from its failure, so the learner reads both in one message; called by {@link createConfig} and {@link linkInStaged}.
 * @param refusal - The refusal the caller worded ({@link failureOf}).
 * @param error - What {@link linkWithoutStaleReceipt} threw.
 * @returns
 * - `refusal` itself when `error` is no {@link UnrestoredReceiptError}
 * - One error whose message is the refusal's followed by the private file's sentence otherwise
 * @example
 * throw withUnrestoredNote(changedWhileWorking(context), error) // => 'Codebook found a file that changed … Codebook moved its own old record … and could not put it back, …'
 */
function withUnrestoredNote(refusal: unknown, error: unknown): unknown {
  if (!(error instanceof UnrestoredReceiptError)) return refusal
  const lead = refusal instanceof Error ? `${refusal.message} ` : ''
  return new Error(`${lead}${error.message}`, { cause: error })
}

/**
 * Creates the config from the staged file without replacing anything: a hard link never replaces a file that appeared meanwhile; called by {@link publishRoot} when there was no config.
 * @param context - The run.
 * @param temporary - The staged file.
 * @param stagedVersion - The inode and the bytes' hash of the file this run wrote at the staged name: when nothing was linked, that name goes only while it still shows them ({@link dropStagedRecord}); once the config stands, only while it is a second name of the config or holds just those bytes ({@link dropPublishedStage}), so a file another program put there stays.
 * @param config - The inode the config will have.
 * @param journal - The record as it was written before the link-in; turns to completed once the config stands, in the shape older builds refuse when the old record's private name showed another file by then ({@link LinkedRecord}).
 * @param staleReceipt - The receipt a first setup moves aside right before the link and puts back when the link fails ({@link linkWithoutStaleReceipt}); undefined otherwise.
 * @returns The inode, the staged name when it may still show the published config and could not be looked at or unlinked afterwards (its pending record stays then; recovery unlinks that name, which is another link to the config); that name is dropped whether or not the completed record was written, because a record another program put at the record's name, or none, never names it, so no later run would unlink it and every later update or removal would refuse a config with two names ({@link assertSingleLink}), and after a full disk the record written before the link then has nothing left to settle; whether the old record's private name stayed ({@link Published.isRetiredKept}; the pending record stays then too), and what stood at the record's name when another program kept the completed record from being written ({@link Published.recordConflict}).
 * @throws A {@link refusal} when a file stands at the config name by then (it is left as it is); a {@link staleReceiptRefusal} or {@link changedRecordRefusal} when the stale receipt cannot be moved aside; a {@link stagedConfigRefusal} when the staged name no longer showed the file and bytes this run wrote there right before the link; nothing was published then. Each with the {@link UnrestoredReceiptError}'s sentence appended when that receipt could not go back; the pending record then stays, so the next run puts it back. {@link changedWhileWorking} when the config right after the link is not the file this run wrote with its bytes, and the {@link unreadAfterLinkRefusal} when it could not be read again, twice ({@link linkedConfigState}): nothing rests on it (no completed record, no cleanup of the staged name, no receipt), and the record written before the link stays, so the next run settles that change as after a stop right after the link.
 */
async function createConfig(
  context: Context,
  temporary: string,
  stagedVersion: StagedVersion,
  config: ConfigNumbers,
  journal: Pending,
  staleReceipt: Receipt | undefined,
): Promise<Published> {
  const staged: StagedRecord = { staged: temporary, version: stagedVersion }
  let retiredMove: RetiredMove | undefined
  try {
    context.seam?.afterCheck?.()
    retiredMove = await linkWithoutStaleReceipt(
      context,
      staged,
      staleReceipt,
      journal,
    )
  } catch (error) {
    // Nothing was linked: the staged name goes only while it still shows the file and bytes this run wrote there.
    const stagedNote = await dropStagedConfig(staged)
    const failure = failureOf(error)
    // A receipt that could not go back keeps the record that names its private name.
    if (failure === error) await dropPending(context)
    // A file that appeared meanwhile is the learner's: never replaced.
    throw withKeptStagedConfigNote(
      withUnrestoredNote(
        codeOf(failure) === 'EEXIST' ? changedWhileWorking(context) : failure,
        error,
      ),
      stagedNote,
    )
  }
  // The config is not the file this run wrote (a file swapped in at the staged name right before the link), or cannot be read again: nothing rests on it, and the record stays as written before the link, so the next run settles that change as after a stop right there.
  const linkedState = await linkedConfigState(context, stagedVersion)
  if (linkedState.state === 'unread') throw unreadAfterLinkRefusal(context)
  // A create has no displaced config to put back, so an empty path after its link keeps the answer every state other than the publish already had.
  if (linkedState.state !== 'linked') throw changedWhileWorking(context)
  // Only now, the publish confirmed, does the old record's private name go, and only while the config still is the file that confirmed it: a config another program put back after that read keeps the receipt that owns its entry, with the record that leads there.
  const linked = await dropMovedAfterConfirm(
    context,
    journal,
    retiredMove,
    linkedState.published,
  )
  context.seam?.afterPublish?.(undefined)
  // The config stands: the record says so, in the shape the link left it, and the staged name is only another name of it.
  const completion = await markCompleted(context, linked.journal)
  const isRecorded = completion === 'recorded'
  // That second name goes whatever became of the completed record, as after a replacement: a record another program put at pending.json, or none, never names it, so no later run would drop it and every later update or removal would refuse a config with two names; after a full disk this run's own record still names it, and then leaves nothing to settle.
  const stagedKept = await dropPublishedStage(context, temporary, stagedVersion)
  return {
    config,
    stagedSha256: stagedVersion.sha256,
    keptLeft: stagedKept ? [stagedKept] : [],
    isRecorded,
    isRetiredKept: linked.isRetiredKept,
    ...recordConflictOf(completion),
  }
}

/**
 * Moves the config aside to its private name as the first step of a replacement: whatever file stands at the config name at that instant is the file that moves, so it is the one that gets compared; called by {@link replaceConfig}.
 * The hard-link probe runs first, so the last looks (a take-back's at its records, {@link assertTakeBackRecordStill}, then the config's) come after every awaited step and only synchronous looks stand between the last await and the rename.
 * @param context - The run.
 * @param replacement - The staged file with the inode and bytes this run wrote there, the probe name, the private name and the identity the config had when it was read.
 * @throws A {@link refusal} when the config changed since the read or is gone; or the hard link error of a file system that cannot link; what {@link assertTakeBackRecordStill} throws for a take-back whose publish record or own rollback record no longer stands as its run read or wrote it. The pending record is removed then, because nothing moved, and so is the staged name while it still shows the file and bytes this run wrote there ({@link dropStagedRecord}).
 */
async function moveConfigAside(
  context: Context,
  { temporary, stagedVersion, probePath, displaced, identity }: Replacement,
): Promise<void> {
  try {
    // The config name is empty until the link-in, so a file system that cannot link is found before anything moves; the probe's name is in the record.
    await link(temporary, probePath)
    await unlink(probePath)
    // The last looks come after the probe's awaited link and unlink, so a record or config moved or replaced meanwhile is seen before the config moves.
    await assertTakeBackRecordStill(context)
    assertConfigUnchanged(context, identity)
    context.seam?.afterCheck?.()
    await rename(context.path, displaced.path).catch((error: unknown) => {
      throw codeOf(error) === 'ENOENT' ? changedWhileWorking(context) : error
    })
  } catch (error) {
    // Nothing moved: the staged name goes only while it still shows the file and bytes this run wrote there.
    const stagedNote = await dropStagedConfig({
      staged: temporary,
      version: stagedVersion,
    })
    await dropPending(context)
    throw withKeptStagedConfigNote(error, stagedNote)
  }
}

/**
 * Puts a displaced file back at the config name after the comparison found it is not the file that was read, and refuses; called by {@link replaceConfig}.
 * @param context - The run.
 * @param replacement - The staged file (deleted here while it still shows the file and bytes this run wrote there, {@link dropStagedRecord}) and the private name.
 * @param opened - The displaced file's handle and own mode; undefined when it could not be opened.
 * @throws Always: {@link changedWhileWorking} (or {@link linkedElsewhereRefusal} for a file another name reached, whose mode was never changed) after the file went back with its own permissions (a link never replaces, and the displaced name is unlinked), or a {@link leftCopyRefusal} naming the displaced file, which stays private, when a new config stands at the config name (it is kept) or the link failed.
 */
async function putDisplacedBack(
  context: Context,
  { temporary, stagedVersion, displaced }: Replacement,
  opened: DisplacedHandle | undefined,
): Promise<never> {
  const stagedNote = await dropStagedConfig({
    staged: temporary,
    version: stagedVersion,
  })
  await restoreDisplaced(context, displaced.path, opened).catch(
    (error: unknown) => {
      throw withKeptStagedConfigNote(error, stagedNote)
    },
  )
  throw withKeptStagedConfigNote(mismatchRefusal(context, opened), stagedNote)
}

/** The refusal after a displaced file went back because it was not the file that was read: it had another name by then, or it changed. */
function mismatchRefusal(
  context: Context,
  opened: DisplacedHandle | undefined,
): Error {
  return opened?.isShared
    ? linkedElsewhereRefusal(context)
    : changedWhileWorking(context)
}

/**
 * Links the staged file in as the config after a successful comparison; called by {@link replaceConfig}. A link never replaces: a file that a save created after the move-aside stays. A first setup's stale receipt is moved aside right before the link and put back when it fails ({@link linkWithoutStaleReceipt}).
 * @param context - The run.
 * @param replacement - The staged file with the inode and bytes this run wrote there, the displaced file (whose bytes equal what was read), the record and the stale receipt.
 * @param opened - The displaced copy's handle and own mode.
 * @returns The move whose private name the caller deletes once its read right after the link confirms the publish ({@link dropMovedAfterConfirm}); undefined when no receipt moved. Until that confirmation the private name stays as the move left it, so a refusal of an unconfirmed publish leaves it and the publish record for the next run.
 * @throws Whatever failed, the staged name goes first, only while it still shows the file and bytes this run wrote there ({@link dropStagedRecord}). {@link newConfigRefusal} when a config appeared: the displaced copy is kept (a writer may still hold it open) and named, and the record turns to handed, so no later run deletes that copy; when that cannot be recorded, the refusal says that a later run puts the copy back once the config name is empty. Any other link failure, a {@link staleReceiptRefusal}, a {@link changedRecordRefusal} and a {@link stagedConfigRefusal} (the staged name no longer showed the file this run wrote right before the link) put the displaced file back with its own permissions and rethrow it, or throw a {@link leftCopyRefusal} naming the displaced file when it cannot go back. Each with the {@link UnrestoredReceiptError}'s sentence appended when the stale receipt could not go back; the record then stays, so the next run puts it back.
 */
async function linkInStaged(
  context: Context,
  { temporary, stagedVersion, displaced, journal, staleReceipt }: Replacement,
  opened: DisplacedHandle | undefined,
): Promise<RetiredMove | undefined> {
  const staged: StagedRecord = { staged: temporary, version: stagedVersion }
  try {
    return await linkWithoutStaleReceipt(context, staged, staleReceipt, journal)
  } catch (error) {
    // Nothing was linked: the staged name goes only while it still shows the file and bytes this run wrote there.
    const stagedNote = await dropStagedConfig(staged)
    const failure = failureOf(error)
    if (codeOf(failure) === 'EEXIST') {
      // A save created the config after the move-aside: it is kept, and the displaced copy is handed to the learner, never deleted by a later run. A receipt that could not go back keeps its mark that nothing was linked.
      const isHanded = await handOver(
        context,
        error instanceof UnrestoredReceiptError
          ? notLinkedRecordOf(journal, error)
          : journal,
      ).catch((handOverError: unknown) => {
        throw withKeptStagedConfigNote(handOverError, stagedNote)
      })
      // An unrecorded handover leaves the record that puts the copy back once the config name is empty: the refusal says so.
      throw withKeptStagedConfigNote(
        withUnrestoredNote(
          newConfigRefusal(context, displaced.path, isHanded),
          error,
        ),
        stagedNote,
      )
    }
    // The config name is empty: the displaced file goes back, else it is named; a receipt that could not go back keeps the record.
    await restoreDisplaced(
      context,
      displaced.path,
      opened,
      failure === error,
    ).catch((refusal: unknown) => {
      throw withKeptStagedConfigNote(
        withUnrestoredNote(refusal, error),
        stagedNote,
      )
    })
    throw withKeptStagedConfigNote(
      withUnrestoredNote(failure, error),
      stagedNote,
    )
  }
}

/**
 * Cleans up after the config was published: the record turns to completed, the displaced copy is deleted unless a writer changed it since the comparison or the published config no longer stands at the config name with the bytes this run wrote ({@link discardDisplaced}), and the staged name is unlinked while it is only a second name of the published config or holds just the bytes this run wrote ({@link dropPublishedStage}); called by {@link replaceConfig}.
 * @param context - The run.
 * @param replacement - The staged file with the inode this run wrote there, the displaced copy and the record.
 * @param held - The displaced copy as it was compared.
 * @returns The files that stay, each with what it holds (empty when everything was deleted; another program's file at the staged name stays untouched and is not named), whether the completed record was written (`false` means the displaced copy was not deleted, and a caller that must not report success without that record, {@link takeEntryOut}, refuses), and what stood at that record's name when another program kept it from being written ({@link Published.recordConflict}).
 */
async function settlePublished(
  context: Context,
  { temporary, stagedVersion, displaced, journal }: Replacement,
  held: HeldCopy,
): Promise<Pick<Published, 'keptLeft' | 'isRecorded' | 'recordConflict'>> {
  const { outcome, copy, recordConflict } = await discardDisplaced(
    context,
    journal,
    displaced.path,
    held,
    stagedVersion,
  )
  const stagedKept = await dropPublishedStage(context, temporary, stagedVersion)
  return {
    keptLeft: [
      ...(stagedKept ? [stagedKept] : []),
      ...(outcome === 'deleted' ? [] : [copy]),
    ],
    isRecorded: outcome !== 'unrecorded',
    ...(recordConflict && { recordConflict }),
  }
}

/**
 * Deletes the staged name of the config this run published while it is only a second name of the config, or holds nothing but the bytes this run wrote; called by {@link createConfig} and {@link settlePublished} once the config stands, and by {@link replaceConfig} when the config right after the link is not the file this run wrote, because the handover that follows may drop the only record that names the staged name.
 * From the link on that name is a second name of the config, whose bytes Devin Desktop or the learner may already have changed in place. While one synchronous look at the config name, then one at the staged name, after an awaited look at both ({@link lookAheadAt}), show the published inode at both, and the look at the staged name still counts another name of that file, the staged name goes whatever was written into that file, because the config name keeps it; the inode alone tells it from a file another program put there (a sync tool's), which stays untouched. Once the config name shows another file or nothing (a backup or sync tool put another config there, for example), or the look at the staged name counts no other name of the published file (another config was put at the config path between the two looks), the staged name may be the published file's last name ({@link dropLastPublishedName}): it goes only while it holds exactly the bytes this run wrote, and bytes written into it since stay with it and are named. Before the link the bytes are checked too ({@link dropStagedRecord}).
 * Limits: a file put at the staged name, or another config put at the config name, between the last synchronous look and the unlink is not seen (no Node primitive unlinks by inode); a stall that starts between the awaited looks and the synchronous ones holds the extension host's thread.
 * @param context - The run; its config path is looked at.
 * @param temporary - The staged name.
 * @param published - The inode of the published config, read from the staged file's handle ({@link stageConfigFile}), and the SHA-256 of the bytes this run wrote there.
 * @returns
 * - undefined when no name of the published file stays there that holds anything of the learner's: deleted now, already gone, or showing another program's file, which stays untouched and is no copy of Codebook's to name
 * - the staged name as a kept file (`holds: 'new'`) when it may still show the published file (a look, the read or the unlink failed): the caller names it, and the pending record stays
 * - the same marked {@link KeptFile.isEditedApart} when the config name no longer reaches the published file and that file holds bytes written into it after the link
 * @example
 * await dropPublishedStage(context, '…/mcp_config.json.<generation>.tmp', stagedVersion) // => undefined once that second name of the config is gone
 */
async function dropPublishedStage(
  context: Context,
  temporary: string,
  published: RecordVersion,
): Promise<KeptFile | undefined> {
  const kept: KeptFile = { path: temporary, holds: 'new' }
  // A storage that already stalls holds this step here, not at the synchronous looks below, which come in the same order: the config name, then the staged name.
  await lookAheadAt([context.path, temporary])
  let configIno: bigint | undefined
  try {
    configIno = lstatSync(context.path, {
      bigint: true,
      throwIfNoEntry: false,
    })?.ino
  } catch {
    // A look that failed proves nothing: the name stays and is named.
    return kept
  }
  // The config name no longer reaches the published file: the staged name may be its last name.
  if (configIno !== published.ino)
    return dropLastPublishedName(temporary, published, kept)
  let now: BigIntStats | undefined
  try {
    now = lstatSync(temporary, { bigint: true, throwIfNoEntry: false })
  } catch {
    // A look that failed proves nothing: the name stays and is named.
    return kept
  }
  // Nothing there, or another program's file: nothing of the published config is left at that name, and that file stays untouched.
  if (now?.ino !== published.ino) return undefined
  // No other name reaches the published file any more (another config was put at the config path right after the look at it): the staged name may be its last name.
  if (now.nlink < 2n) return dropLastPublishedName(temporary, published, kept)
  return (await didUnlink(temporary)) ? undefined : kept
}

/**
 * Deletes the staged name of a published config that the config name no longer reaches, only while a read through one open file finds exactly the bytes this run wrote there and one synchronous look still shows that read ({@link unlinkStagedWhileStill}); called only by {@link dropPublishedStage}, once its look at the config name showed another file or nothing, or its look at the staged name counted no other name of the published file.
 * That name may then be the published file's last name: bytes Devin Desktop or the learner wrote into the config in place after the link, before another config was put at the config path, live only there, so they stay and are named.
 * @param temporary - The staged name.
 * @param published - The inode and bytes this run wrote there.
 * @param kept - The staged name as a kept file, returned when it may still hold the published file.
 * @returns
 * - undefined when nothing of the published file stays there: deleted now, already gone, or another program's file, which stays untouched
 * - `kept` when the read, the look or the unlink failed, or the look found other size or times than the read
 * - `kept` marked {@link KeptFile.isEditedApart} when the file holds other bytes than this run wrote
 * @example
 * await dropLastPublishedName(stagedPath, stagedVersion, kept) // => { ...kept, isEditedApart: true } once an edit lands in the new config before a backup puts an older one back
 */
async function dropLastPublishedName(
  temporary: string,
  published: RecordVersion,
  kept: KeptFile,
): Promise<KeptFile | undefined> {
  let now: InspectedCopy | undefined
  try {
    now = await inspectCopy(temporary)
  } catch {
    // A read that failed proves nothing: the name stays and is named.
    return kept
  }
  // Nothing there, or another program's file: that file stays untouched.
  if (now?.ino !== published.ino) return undefined
  // Bytes written into the published file after the link, which no config name reaches now: maybe the only copy of those changes.
  if (now.sha256 !== published.sha256) return { ...kept, isEditedApart: true }
  return (await unlinkStagedWhileStill(temporary, now)) ? undefined : kept
}

/**
 * Replaces an existing config without ever replacing a file that was not compared: the staged file is complete and flushed, the pending record names it, the probe and the private name, the config is moved aside, the displaced file is opened without following a link and made private, its inode and bytes are compared with what was read through that handle, and only then is the staged file linked in (a link never replaces).
 * A difference puts the displaced file back with its original permissions and refuses, and so does an empty config name right after the link. A config that appeared at the name meanwhile is kept, together with the displaced copy, and the refusal names that copy. After a successful publish the displaced copy is deleted only while the same open file still has the size, times and bytes (hash read through the same handle) it had at the comparison and the published config still stands at the config name with the bytes this run wrote ({@link discardDisplaced}); a copy that changed or was named in a refusal is handed to the learner and never deleted by a later run.
 * Limit of the delete: a write that lands between the final check and the unlink is not seen ({@link didCopyChange}), exactly as a write between the move-aside and the open is not.
 * Documented limit: between the move-aside and the link-in the config name holds nothing, so a Devin Desktop window that loads its MCP config in that instant starts without MCP servers until its next reload.
 * @param context - The run.
 * @param replacement - The staged file, the probe name, the private name, the identity the config had when it was read and the record.
 * @param config - The inode the config will have.
 * @returns The inode, the files that stay afterwards, if any (the pending record stays then), and whether the completed record was written.
 * @throws The refusals of {@link moveConfigAside}, {@link putDisplacedBack} and {@link linkInStaged}; the {@link emptyAfterLinkRefusal} when nothing stands at the config name right after the link ({@link linkedConfigState}): the displaced copy goes back there without replacing anything, and the record written before the link stays so the next run settles the rest of that publish; what {@link restoreDisplaced} throws when that copy cannot go back, with the same record kept; a {@link newConfigRefusal} naming the displaced copy when another file or other bytes stand at the config name right after the link: that copy is handed to the learner ({@link handOver}), the config is left as it is, and neither that copy's delete nor a receipt follows, but the staged name goes first as after a confirmed publish ({@link dropPublishedStage}), because a handover whose handed record cannot be written drops an update's record, and no record left would ever name that second name of the config for a later run to unlink (every later update or removal would refuse the config for it, {@link assertSingleLink}); a staged name that stays is named in the refusal; the {@link unreadAfterLinkRefusal} naming that copy when the config could not be read again, twice: nothing is handed over or deleted, and the record written before the link keeps tracking that copy, so the next run settles both as after a stop right after the link.
 */
async function replaceConfig(
  context: Context,
  replacement: Replacement,
  config: ConfigNumbers,
): Promise<Published> {
  const { displaced } = replacement
  await moveConfigAside(context, replacement)
  const opened = await holdDisplaced(displaced.path).catch(() => undefined)
  try {
    context.seam?.afterMoveAside?.(displaced.path)
    // Compared by bytes and by inode through the open file: the file that moved is the one that was read, or it is put back.
    const held =
      opened &&
      !opened.isShared &&
      (await readHeld(opened.handle).catch(() => undefined))
    if (!held || !isExpectedCopy(held, displaced))
      return await putDisplacedBack(context, replacement, opened)
    context.seam?.afterCompare?.()
    const retiredMove = await linkInStaged(context, replacement, opened)
    const linkedState = await linkedConfigState(
      context,
      replacement.stagedVersion,
    )
    // A config that cannot be read again proves nothing: the record written before the link keeps tracking the moved-aside original, and the next run settles both on its own checks.
    if (linkedState.state === 'unread')
      throw unreadAfterLinkRefusal(context, displaced.path)
    // Nothing stands at the config name: the moved-aside original goes back there without replacing anything. The record written before the link stays either way, so the next run settles the staged file and any retired receipt when this put-back cannot finish.
    if (linkedState.state === 'empty') {
      await restoreDisplaced(context, displaced.path, opened, false, held)
      throw emptyAfterLinkRefusal(context)
    }
    // The config is not the file this run wrote (a file swapped in at the staged name right before the link): the moved-aside original, maybe the only copy of the other servers' settings, is handed to the learner, and no receipt follows. The old record's private name stays as the link left it: nothing confirmed this publish.
    if (linkedState.state === 'other') {
      // The staged name goes first, as after a confirmed publish: a handover whose handed record cannot be written drops an update's record, and no record left would ever name that second name of the config, so no later run would unlink it and every later update or removal would refuse the config for it.
      const stagedKept = await dropPublishedStage(
        context,
        replacement.temporary,
        replacement.stagedVersion,
      )
      const isHanded = await handOver(context, replacement.journal)
      const refusal = newConfigRefusal(context, displaced.path, isHanded)
      // A staged name that stays is named as after a confirmed publish: it may hold the only copy of changes written into the config after the link.
      if (stagedKept)
        refusal.message = `${refusal.message} ${keptFileSentence(stagedKept)}`
      throw refusal
    }
    if (linkedState.state !== 'linked') throw changedWhileWorking(context)
    // Only now, the publish confirmed, does the old record's private name go, and only while the config still is the file that confirmed it: a config another program put back after that read keeps the receipt that owns its entry, with the record that leads there.
    const linked = await dropMovedAfterConfirm(
      context,
      replacement.journal,
      retiredMove,
      linkedState.published,
    )
    context.seam?.afterPublish?.(displaced.path)
    // From here the config is published; cleanup failures are reported and leave the pending record, written in the shape the link left it.
    return {
      config,
      stagedSha256: replacement.stagedVersion.sha256,
      isRetiredKept: linked.isRetiredKept,
      ...(await settlePublished(
        context,
        { ...replacement, journal: linked.journal },
        held,
      )),
    }
  } finally {
    await opened?.handle.close()
  }
}

/** What the pending record says about a write once its generation is fixed. */
type FullHead = PendingHead & { generation: string }

/** The displaced copy of a replacement: the private name and the bytes and inode the config had when it was read; undefined for a create. */
function displacedCopyOf(
  context: Context,
  look: ConfigLook,
  generation: string,
): KeptCopy | undefined {
  if (look.kind !== 'present') return undefined
  return {
    path: journalPathOf(context.path, generation, 'kept'),
    sha256: look.sha256,
    ino: look.identity.ino,
  }
}

/**
 * Builds the pending record of a write: the staged file with its inode and hash, and for a replacement the displaced copy and the probe name, so a crash leaves nothing unnamed.
 * @param context - The run.
 * @param head - What the record says about this write, with its generation.
 * @param staged - The staged file and its inode.
 * @param serialized - The new content, whose hash the staged file must have.
 * @param displaced - The displaced copy; undefined for a create.
 * @param retiredSha256 - The bytes' hash of the stale receipt a first setup moves aside right before its link ({@link readRetiringReceipt}); undefined when no receipt moves.
 * @returns The record, not written yet; a first setup that moves its stale receipt names that receipt's bytes in it from this first write on ({@link Pending.retiresReceipt}).
 */
function journalOf(
  context: Context,
  head: FullHead,
  staged: { temporary: string; ino: bigint },
  serialized: string,
  displaced: KeptCopy | undefined,
  retiredSha256: string | undefined,
): Pending {
  return {
    ...head,
    ...(context.rollbackOf !== undefined && {
      publishGeneration: context.rollbackOf,
    }),
    ...(retiredSha256 !== undefined && {
      retiresReceipt: { sha256: retiredSha256 },
    }),
    targetPath: context.path,
    stagedIno: recordedFileId(staged.ino),
    stagedName: basename(staged.temporary),
    stagedSha256: bytesSha256(serialized),
    ...(displaced && {
      keptName: basename(displaced.path),
      keptIno: recordedFileId(displaced.ino),
      keptSha256: displaced.sha256,
      probeName: journalNameOf(context.path, head.generation, 'probe'),
    }),
  }
}

/**
 * Encodes the bytes {@link publishRoot} writes, also used by recovery to recognize the result of removing Codebook's entry.
 * @example
 * serializedConfig({ mcpServers: {} }) // => '{\n  "mcpServers": {}\n}\n'
 */
function serializedConfig(root: JsonObject): string {
  return `${JSON.stringify(root, null, 2)}\n`
}

/**
 * Publishes the config. The new bytes are staged first and their inode read from the open handle; the pending record then names the staged file, its inode, the probe name and the private name for the displaced file before anything is moved; the record stays from the first move on, because only the next run can tell how far a crash got.
 * A create links the staged file in ({@link createConfig}). A replacement moves the config aside, compares it and links the new file in ({@link replaceConfig}), so no file is replaced without being compared. Either link goes only while the staged name still shows the file and bytes this run wrote there ({@link assertStagedConfigStill}), and nothing rests on it until a read right after it finds that file with those bytes at the config name ({@link linkedConfigState}). The new file keeps the owner's permission bits only (`mode & 0o600`), so a rewrite never widens access.
 * Documented limit: between the move-aside and the link-in the config name holds nothing, so a Devin Desktop window that loads its MCP config in that instant starts without MCP servers until its next reload.
 * Every cleanup of the staged name in this run deletes it only while it still shows the file this run wrote there: before the link its inode and bytes ({@link dropStagedRecord}), after the link its inode while the config name still shows that inode, whatever was written into the published config in place since, and otherwise its inode and bytes, so changes written into the published config that only that name still reaches stay and are named ({@link dropPublishedStage}); a file another program put there stays untouched.
 * Other limits: a writer that still holds the old file open may write into the displaced file after the comparison, which is then kept and reported, never deleted; a crash leaves the staged, probe and displaced names, which the next run settles only when each is a name Codebook made with the inode it recorded ({@link recoverLeftovers}).
 * @param context - The run.
 * @param root - The complete new top-level object.
 * @param look - What was read; its owner bits are kept, its hash and inode are what the displaced file is compared with.
 * @param head - What the pending record says about this write; a removal has no generation, so one is made.
 * @param staleReceipt - The receipt of an entry that is gone, which a first setup moves aside only once this record (which names that move) is written, right before the link that exposes the publish, and which stands again when that link fails ({@link linkWithoutStaleReceipt}); undefined for every other publish. A refusal before that link leaves it as it was.
 * @returns The inode of the config that now stands, and the files that stay, if any (the pending record stays then).
 * @throws A {@link refusal} when the result is larger than {@link DEVIN_MCP_CONFIG_LIMIT_BYTES}, the file changed since the read or a save landed meanwhile (the newer file is left in place), or a leftover copy cannot be settled; a {@link staleReceiptRefusal} when the stale receipt cannot be deleted (nothing is published then).
 * @example
 * await publishRoot(context, { mcpServers: {} }, { kind: 'absent' }, { createdFile: true })
 */
async function publishRoot(
  context: Context,
  root: JsonObject,
  look: ConfigLook,
  head: PendingHead,
  staleReceipt?: Receipt,
): Promise<Published> {
  const serialized = serializedConfig(root)
  assertWithinSizeLimit(context, serialized)
  const mode =
    look.kind === 'present'
      ? look.identity.mode & PRIVATE_FILE_MODE
      : PRIVATE_FILE_MODE
  const generation = head.generation ?? randomUUID()
  // The stale receipt is read once more right before the record that names its bytes: it moves aside only while it still holds them.
  const retiredSha256 = staleReceipt
    ? await readRetiringReceipt(context, staleReceipt)
    : undefined
  const retiring = retiredSha256 === undefined ? undefined : staleReceipt
  const staged = await stageConfigFile(
    journalPathOf(context.path, generation, 'staged'),
    serialized,
    mode,
  )
  // The file this run wrote at the staged name: every cleanup of that name checks it is still that file.
  const stagedVersion: StagedVersion = {
    ino: staged.ino,
    sha256: bytesSha256(serialized),
  }
  const displaced = displacedCopyOf(context, look, generation)
  const journal = journalOf(
    context,
    { ...head, generation },
    staged,
    serialized,
    displaced,
    retiredSha256,
  )
  try {
    await writeRecord(context, context.pendingPath, journal satisfies Pending)
  } catch (error) {
    // Nothing moved yet: the staged name goes only while it still shows the file and bytes this run wrote there.
    const stagedNote = await dropStagedConfig({
      staged: staged.temporary,
      version: stagedVersion,
    })
    throw withKeptStagedConfigNote(error, stagedNote)
  }
  const config = { ino: recordedFileId(staged.ino) }
  return look.kind === 'present' && displaced
    ? replaceConfig(
        context,
        {
          temporary: staged.temporary,
          stagedVersion,
          probePath: journalPathOf(context.path, generation, 'probe'),
          displaced,
          identity: look.identity,
          journal,
          staleReceipt: retiring,
        },
        config,
      )
    : createConfig(
        context,
        staged.temporary,
        stagedVersion,
        config,
        journal,
        retiring,
      )
}

/**
 * Refuses a rewrite whose bytes the reader would refuse; the bytes are measured, not the characters. Called by {@link publishRoot} before anything is staged.
 * @param context - The run.
 * @param serialized - The complete new content.
 * @throws A {@link refusal} when the content is larger than {@link DEVIN_MCP_CONFIG_LIMIT_BYTES}; the file is untouched.
 */
function assertWithinSizeLimit(context: Context, serialized: string): void {
  if (Buffer.byteLength(serialized) > DEVIN_MCP_CONFIG_LIMIT_BYTES)
    throw refusal(
      `a result that would be larger than ${DEVIN_MCP_CONFIG_LIMIT_BYTES} bytes`,
      context.path,
      'shrink or move it',
      context.retry,
    )
}

/**
 * Deletes the config Codebook created, keeping a save that landed after the identity check: the file is renamed to a private name recorded in the pending record, opened without following a link, compared (bytes and inode) with what was read, and only then deleted; anything else goes back without replacing a newer file, and the run refuses.
 * Documented limit: for an instant the config name holds nothing; a file created there then makes the older copy stay under its private `.codebook-displaced` name, which the refusal names.
 * @param context - The run.
 * @param look - What was read; must be present.
 * @returns The private copy that stays when it could not be deleted or changed since the comparison.
 * @throws A {@link refusal} when the file changed or the copy cannot go back; what {@link assertTakeBackRecordStill} throws for a take-back whose publish record or own rollback record no longer stands as its run read or wrote it; nothing is deleted.
 */
async function deleteConfig(
  context: Context,
  look: Extract<ConfigLook, { kind: 'present' }>,
): Promise<{ keptLeft: KeptFile[] }> {
  const generation = randomUUID()
  const moved: KeptCopy = {
    path: journalPathOf(context.path, generation, 'kept'),
    sha256: look.sha256,
    ino: look.identity.ino,
  }
  const journal: Pending = {
    targetPath: context.path,
    createdFile: false,
    generation,
    ...(context.rollbackOf !== undefined && {
      publishGeneration: context.rollbackOf,
    }),
    keptName: basename(moved.path),
    keptIno: recordedFileId(moved.ino),
    keptSha256: moved.sha256,
  }
  await writeRecord(context, context.pendingPath, journal)
  try {
    await assertTakeBackRecordStill(context)
    assertConfigUnchanged(context, look.identity)
    context.seam?.afterCheck?.()
    await rename(context.path, moved.path)
  } catch (error) {
    await dropPending(context)
    throw error
  }
  return settleMovedAside(context, moved, journal)
}

/**
 * Opens the file that was renamed aside and settles it; called by {@link deleteConfig}.
 * @param context - The run.
 * @param moved - The private name and the bytes and inode the file must have.
 * @param journal - The record as it was written before the rename.
 * @returns The copy that stays when it could not be deleted.
 * @throws A {@link refusal} after a different file was put back, or naming the copy when it cannot go back; what {@link finishRemoval} throws, and a {@link TakenOutConflictError} when the renamed file is gone and a take-back's tracked record could not be deleted ({@link dropFinishedRecord}).
 */
async function settleMovedAside(
  context: Context,
  moved: KeptCopy,
  journal: Pending,
): Promise<{ keptLeft: KeptFile[] }> {
  let opened: DisplacedHandle | undefined
  try {
    opened = await holdDisplaced(moved.path)
  } catch (error) {
    throw leftCopyRefusal(context, moved.path, error)
  }
  try {
    context.seam?.afterMoveAside?.(moved.path)
    // The renamed file is gone: nothing is left to settle.
    if (!opened) {
      await dropFinishedRecord(context)
      return { keptLeft: [] }
    }
    return await settleHeldRemoval(context, { moved, journal }, opened)
  } finally {
    await opened?.handle.close()
  }
}

/**
 * Compares the held file with what was read and either deletes it or puts it back; called by {@link settleMovedAside}.
 * @param context - The run.
 * @param removal - The private name and expected bytes and inode, and the record.
 * @param opened - The open file with the mode it had before it was made private.
 * @returns The copy that stays when it changed since the comparison or could not be deleted.
 * @throws A {@link refusal} after a different file was put back, or naming the copy when it cannot be read or go back; a {@link recordFailureRefusal} (the config went back) when the completed record cannot be written, so a later recovery never puts a removed config back without its receipt; a {@link savedAgainRefusal} when a config stands at the config name again.
 */
async function settleHeldRemoval(
  context: Context,
  removal: { moved: KeptCopy; journal: Pending },
  opened: DisplacedHandle,
): Promise<{ keptLeft: KeptFile[] }> {
  const { moved, journal } = removal
  let held: HeldCopy
  try {
    held = await readHeld(opened.handle)
  } catch (error) {
    // The comparison cannot be made (the file grew past the limit or cannot be read): it goes back as on a mismatch, so the config is never left missing; a config saved meanwhile stays, and the refusal names the displaced path.
    await restoreDisplaced(context, moved.path, opened)
    throw unreadableCopyRefusal(context, error)
  }
  if (opened.isShared || !isExpectedCopy(held, moved)) {
    // The file is not the one that was read, whatever its bytes, or it has another name now: link it back (never replacing a newer file) and refuse.
    await restoreDisplaced(context, moved.path, opened)
    throw mismatchRefusal(context, opened)
  }
  context.seam?.afterPublish?.(moved.path)
  const discarded = await discardDisplaced(context, journal, moved.path, held)
  if (discarded.outcome === 'unrecorded') {
    // Without the completed record a later recovery would put the removed config back after the receipt was dropped: put it back now and keep the receipt.
    await restoreDisplaced(context, moved.path, opened)
    throw recordFailureRefusal(context, undefined)
  }
  return finishRemoval(context, discarded)
}

/**
 * Ends a removal whose old file was compared: a config at the config name again means an editor saved meanwhile, so nothing is reported as removed; called by {@link settleHeldRemoval}.
 * @param context - The run.
 * @param discarded - What became of the old file and where it stays ({@link Discarded}); `unrecorded` never reaches here.
 * @returns The copy that stays, if any.
 * @throws A {@link savedAgainRefusal} when a file stands at the config name; the receipt and that file stay as they are. A {@link TakenOutConflictError} when the old file was deleted and a take-back's tracked record could not be deleted because its name shows another file ({@link dropFinishedRecord}).
 */
async function finishRemoval(
  context: Context,
  { outcome, copy }: Discarded,
): Promise<{ keptLeft: KeptFile[] }> {
  const isDeleted = outcome === 'deleted'
  if (lstatSync(context.path, { throwIfNoEntry: false })) {
    if (isDeleted) await dropPending(context)
    throw savedAgainRefusal(context)
  }
  if (!isDeleted) return { keptLeft: [copy] }
  await dropFinishedRecord(context)
  return { keptLeft: [] }
}

/**
 * Reads one of Codebook's own records without following a link.
 * @param path - The record file.
 * @param schema - The shape it must have.
 * @param retry - The command a refusal asks the learner to run again.
 * @param seam - Test hook, see {@link DevinMcpTestSeam}.
 * @returns The record; undefined when absent.
 * @throws When the record is a link, no regular file, larger than {@link DEVIN_MCP_RECORD_LIMIT_BYTES} (also when it grew past that after its stat), unreadable or of another shape; the config is not touched.
 * @example
 * await readRecord(receiptPath, receiptSchema, SET_UP_AGAIN)
 */
async function readRecord<Schema extends z.ZodType>(
  path: string,
  schema: Schema,
  retry: string,
  seam?: DevinMcpTestSeam,
): Promise<z.infer<Schema> | undefined> {
  return (await readVersionedRecord(path, schema, retry, seam))?.record
}

/**
 * Reads one of Codebook's own records like {@link readRecord}, together with the version it read: the inode and the bytes' hash from the same open handle ({@link readRecordFile}); called by {@link readRecord}, by {@link settleRollbackJournal}, which retires a held journal only as the version it settled, and for the publish record by {@link markTakeBackOwed} and {@link inspect}, which mark, adopt or end only the version a decision read ({@link heldPublishContext}).
 * @param path - The record file.
 * @param schema - The shape it must have.
 * @param retry - The command a refusal asks the learner to run again.
 * @param seam - Test hook, see {@link DevinMcpTestSeam}.
 * @returns The record and its {@link RecordVersion}; undefined when absent.
 * @throws What {@link readRecord} throws.
 * @example
 * await readVersionedRecord(journalPath, pendingSchema, SET_UP_AGAIN) // => { record: { targetPath, ... }, version: { ino: 42n, sha256: 'ab…' } }
 */
async function readVersionedRecord<Schema extends z.ZodType>(
  path: string,
  schema: Schema,
  retry: string,
  seam?: DevinMcpTestSeam,
): Promise<{ record: z.infer<Schema>; version: RecordVersion } | undefined> {
  const read = await readRecordFile(path, retry, seam)
  if (read === undefined) return undefined
  return {
    record: parseRecord(path, schema, retry, read.bytes),
    version: { ino: read.ino, sha256: bytesSha256(read.bytes) },
  }
}

/** The look at one of Codebook's records that a later look at its name compares ({@link LeftoverLookback}): the inode, size and times of the open file the bytes came from ({@link readRecordFile}). */
type RecordLook = Required<
  Pick<LeftoverLookback, 'ino' | 'size' | 'mtimeNs' | 'ctimeNs'>
>

/** The bytes of one of Codebook's records, the inode of the open file they were read from, and that open file's look ({@link readRecordFile}). */
type RecordFileRead = { bytes: Buffer; ino: bigint; look: RecordLook }

/** What {@link readRecordFile} throws when the open file it read through is no regular file, holds more than {@link DEVIN_MCP_RECORD_LIMIT_BYTES} or grew past that after its stat: no failed system call, so {@link isFailedRead} answers `false`, and it carries that open file's look, so {@link readLookedRecord} names what stands there by the file it opened, never by an earlier look at the name. */
class RefusedRecordError extends Error {
  constructor(
    message: string,
    readonly look: RecordLook,
  ) {
    super(message)
  }
}

/**
 * Gives the look of an open file a later look at its name compares; called by {@link readRecordFile}.
 * @param status - The open file's status.
 * @returns Its inode, size and modification and change times in nanoseconds.
 * @example
 * recordLookOf(await file.stat({ bigint: true })) // => { ino: 42n, size: 310n, mtimeNs, ctimeNs }
 */
function recordLookOf({
  ino,
  size,
  mtimeNs,
  ctimeNs,
}: BigIntStats): RecordLook {
  return { ino, size, mtimeNs, ctimeNs }
}

/**
 * Reads the bytes of one of Codebook's own records through one handle opened without following a link; called by {@link readVersionedRecord}, {@link readRetiredRecord} and {@link readLookedRecord}, which parse them with {@link parseRecord}.
 * @param path - The record file.
 * @param retry - The command a refusal asks the learner to run again.
 * @param seam - Test hook, see {@link DevinMcpTestSeam}.
 * @returns The bytes, the inode of the file they came from and that open file's look ({@link RecordFileRead}); undefined when the name is empty.
 * @throws A {@link RefusedRecordError} with the open file's look when that file is no regular file or larger than {@link DEVIN_MCP_RECORD_LIMIT_BYTES} (also when it grew past that after its stat); when the record is a link or unreadable, an error whose cause is the failed system call ({@link isFailedRead}).
 * @example
 * await readRecordFile(receiptPath, SET_UP_AGAIN) // => { bytes: <Buffer 7b 22 ...>, ino: 42n, look: { ino: 42n, size: 310n, mtimeNs, ctimeNs } }
 */
async function readRecordFile(
  path: string,
  retry: string,
  seam?: DevinMcpTestSeam,
): Promise<RecordFileRead | undefined> {
  const sentence = `Codebook's Devin Desktop MCP record at ${path} is a link, no regular file, larger than ${DEVIN_MCP_RECORD_LIMIT_BYTES} bytes or not readable, so the config was left untouched; remove that record, ${retry}.`
  const unsafe = (cause: unknown) => new Error(sentence, { cause })
  let file
  try {
    file = await openWithoutFollowing(path)
  } catch (error) {
    if (codeOf(error) === 'ENOENT') return undefined
    throw unsafe(error)
  }
  try {
    const status = await file.stat({ bigint: true }).catch((error) => {
      throw unsafe(error)
    })
    const look = recordLookOf(status)
    // The open file itself holds no record: its look names what stands there.
    if (!status.isFile() || status.size > BigInt(DEVIN_MCP_RECORD_LIMIT_BYTES))
      throw new RefusedRecordError(sentence, look)
    const bytes = await readWithinLimit(
      file,
      status.size,
      DEVIN_MCP_RECORD_LIMIT_BYTES,
      () => seam?.afterStat?.(path),
    ).catch((error) => {
      throw unsafe(error)
    })
    if (!bytes) throw new RefusedRecordError(sentence, look)
    return { bytes, ino: status.ino, look }
  } finally {
    await file.close()
  }
}

/**
 * Parses the bytes of one of Codebook's records and checks their shape; called by {@link readVersionedRecord} and {@link readRetiredRecord} after {@link readRecordFile}.
 * @param path - The record file, for the refusal.
 * @param schema - The shape it must have.
 * @param retry - The command a refusal asks the learner to run again.
 * @param bytes - The bytes that were read.
 * @returns The record.
 * @throws When the bytes are no JSON or of another shape; the config is not touched.
 * @example
 * parseRecord(receiptPath, receiptSchema, SET_UP_AGAIN, Buffer.from('{}')) // throws: '… is unreadable and the config was left untouched; …'
 */
function parseRecord<Schema extends z.ZodType>(
  path: string,
  schema: Schema,
  retry: string,
  bytes: Buffer,
): z.infer<Schema> {
  let parsed: unknown
  try {
    parsed = JSON.parse(bytes.toString('utf8'))
  } catch {
    parsed = undefined
  }
  const record = schema.safeParse(parsed)
  if (!record.success)
    throw new Error(
      `Codebook's Devin Desktop MCP record at ${path} is unreadable and the config was left untouched; remove that record, ${retry}.`,
    )
  return record.data
}

/**
 * Writes one of Codebook's own records (`pending.json` or a rollback's journal) atomically; every write of those records goes through here, and every write of the receipt through {@link writeReceipt}, so a test sees each one at {@link DevinMcpTestSeam.beforeRecordWrite}.
 * A write at the pending path of a context that tracks its journal's version ({@link Context.journalVersion}) goes on only while that name shows the version this run settled or last wrote, or nothing ({@link writeTrackedJournal}), and then replaces that version with the one of the file it wrote itself ({@link stageRecord}), never with what stands at the name afterwards.
 * @param context - The run; its seam is called with the path and the value after the bytes were flushed and before the rename (for a tracked journal also before the last look at its name).
 * @param path - The record file.
 * @param value - The complete record.
 * @param assertStill - A synchronous look at other names that must still hold, called after the seam (and a tracked journal's last look) right before the rename or link, so nothing that the caller's earlier look found can change while the bytes are flushed; throwing cancels the write. A tracked journal's write awaits a look at its names right before its last looks ({@link writeTrackedJournal}); any other write awaits it before it stages its bytes, since its synchronous looks run inside {@link atomicPrivateWrite} (limit: a stall that starts while those bytes are flushed holds the extension host's thread at that look). Undefined when nothing else must hold ({@link retirePending}).
 * @throws When the record is larger than {@link DEVIN_MCP_RECORD_LIMIT_BYTES}, the temporary file cannot be written or renamed, or the seam or `assertStill` throws; a {@link JournalConflictError} when a tracked journal's name shows another file or cannot be read again. The previous record then stays byte for byte, and so does a tracked version.
 * @example
 * await writeRecord(context, context.pendingPath, { ...journal, phase: 'completed' })
 */
async function writeRecord(
  context: Context,
  path: string,
  value: unknown,
  assertStill?: StillLook,
): Promise<void> {
  const tracked =
    path === context.pendingPath ? context.journalVersion : undefined
  // Every record but a tracked journal is replaced whatever stands at its name.
  if (!tracked) {
    if (assertStill) await lookAheadAt(assertStill.names)
    await atomicPrivateWrite(path, value, DEVIN_MCP_RECORD_LIMIT_BYTES, () => {
      context.seam?.beforeRecordWrite?.({ path, record: value })
      assertStill?.assert()
    })
    return
  }
  // Only a write that went through moves the version: after a refused one the next guarded step on that name finds the conflict again.
  tracked.current = await writeTrackedJournal(context, value, assertStill)
}

/**
 * Writes a tracked rollback journal ({@link Context.journalVersion}) only while its name shows the version this run settled or last wrote, or nothing; called only by {@link writeRecord}.
 * A name with no known version, or a journal's name found empty, is claimed ({@link claimJournal}); a publish record's name found empty while a version is known is refused, because that record disappeared after the read a decision rests on, or after a publish wrote it (a backup may have put an older config back at the same moment), and writing it back would undo that move. Otherwise the bytes are staged and flushed under a fresh private name first ({@link stageRecord}); right before the record moves, its name is looked at once more, synchronously ({@link assertTrackedJournalStill}), then the caller's names, then the staged name ({@link lookAtStagedRecord}). The record is then moved to its dropping name ({@link replaceThroughDroppingName}), so a file another program puts at its name after that last look moves with it, goes back to that name and is never replaced; the new bytes are published there without replacing anything, and after that cleanup the name must still show the file this call wrote ({@link confirmPublished}). Before those last looks the version they must find is noted beside the record ({@link withDroppingNote}), so a run that stops with the record at its dropping name leaves the next run the proof of which file it moved there.
 * Each synchronous look comes right after an awaited look at the same name, so a storage that already stalls holds this step in the thread pool, where the step's budget answers, instead of the extension host's thread; a stall that starts between the two looks still holds that thread.
 * Limits: those of {@link replaceThroughDroppingName}.
 * @param context - The run; its pending path is the journal, its seam is called right before the last look.
 * @param value - The complete journal.
 * @param assertStill - What else must still hold, looked at right after the last look, after an awaited look at its names together with the record's own ({@link writeRecord}), and once more after the record moved, right before the new bytes are published.
 * @returns The version this write published: the inode of the file at the record's name and the hash of its bytes.
 * @throws A {@link JournalConflictError} when the name shows another file or cannot be read again, before the move, at the move (what moved goes back to the name) or right after the publication, or (`gone`) when a publish record's name is found empty ({@link Context.journalVersion}); the refusal naming both names when a file stands at the dropping name or comes to the emptied name ({@link bothRecordNamesError}), or the one naming the dropping name when the record could not go back there ({@link recordNotBackError}); what the write, the look at the staged name ({@link leftoverReplacedError}) or `assertStill` throws. The record then stands at its name as it was, unless one of those two refusals names where it stands.
 * @example
 * await writeTrackedJournal(rollbackContext, retained) // => { ino: 43n, sha256: 'cd…' }; pending.json.rollback holds `retained` while it held this run's version
 * await writeTrackedJournal(heldRun, retained) // throws a `gone` JournalConflictError once a sync tool moved pending.json away after the run read it
 */
async function writeTrackedJournal(
  context: Context,
  value: unknown,
  assertStill?: StillLook,
): Promise<RecordVersion> {
  // No version of this run stands at the name: the write claims it, never replacing what stands there.
  if (context.journalVersion?.current === undefined)
    return claimJournal(context, value, assertStill)
  const look = await lookAtTrackedJournal(context)
  // The name went empty since this run's version: a publish record a decision read or a publish wrote is gone and stays gone, a journal of this run's rollback or a removal's own record is claimed again.
  if (!look) {
    if (context.journalVersion.refusesEmptyName)
      throw journalConflictError(context, 'gone')
    return claimJournal(context, value, assertStill)
  }
  const path = context.pendingPath
  const staged = await stageRecord(path, value)
  let version: RecordVersion
  try {
    // Should the run stop with the record at its dropping name, the next run puts back only the file the note names.
    version = await withDroppingNote(
      context,
      { moved: look, published: staged.version },
      async () => {
        context.seam?.beforeRecordWrite?.({ path, record: value })
        // A storage that already stalls holds this step here, in the thread pool, not at the synchronous looks below, which come in the same order: the record's name, `assertStill`'s names, the staged name, the dropping name.
        await lookAheadAt([
          path,
          ...(assertStill?.names ?? []),
          staged.staged,
          droppingPathOf(context),
        ])
        const source = await lookAtStagedRecord(staged)
        assertTrackedJournalStill(context, look)
        assertStill?.assert()
        assertStagedRecordStill(staged, source)
        return replaceThroughDroppingName(context, look, {
          staged,
          assertStill,
        })
      },
    )
  } finally {
    // A linked staged file is only another name of the record; one that published nothing goes while it shows the file this call wrote.
    await dropStagedRecord(staged)
  }
  return confirmPublished(context, version)
}

/** What a rewrite of a tracked record publishes ({@link replaceThroughDroppingName}): its staged bytes ({@link stageRecord}) and the caller's look that must still hold right before they are published. */
type TrackedWrite = {
  staged: StagedRecord
  assertStill: StillLook | undefined
}

/**
 * Replaces a tracked record that the last looks showed as this run's version by moving it to its dropping name first ({@link moveTrackedAside}) and publishing the new bytes at the emptied name without replacing anything; called by {@link writeTrackedJournal} right after those looks.
 * After the move the staged name, the caller's names and the dropping name are looked at again ({@link assertAfterMove}), so nothing that changed while the record moved is published; any refusal puts the record back first ({@link putTrackedBack}). The new bytes go in with a link, which never replaces a file; where the storage gives no file a second name ({@link NO_LINK_CODES}), the complete staged file is renamed into the emptied name right after a synchronous look finds it empty ({@link publishMovedRecord}), so that name shows nothing or the whole record at every instant. The moved record goes last, while its dropping name still shows it ({@link dropAsideRecord}).
 * Limits: on storage without hard links, a file put at the dropping name between its synchronous look and the move is replaced ({@link moveToDroppingName}); a stop between the publication and the dropping name's delete leaves both names holding a record, which the next run settles as this step would have, deleting the old version while the dropping note proves both ({@link settleDroppedRecord}); on storage without hard links a file another program puts at the emptied name between that last look and the rename is replaced ({@link claimWithoutLinks}).
 * @param context - The run; its pending path is the record.
 * @param look - The record as the last look saw it: this run's version.
 * @param write - The staged bytes and the caller's look ({@link TrackedWrite}).
 * @returns The version published at the record's name.
 * @throws What {@link moveTrackedAside}, {@link assertAfterMove}, {@link publishMovedRecord} and {@link dropAsideRecord} throw; a `gone` {@link JournalConflictError} when a publish record's name was empty at the move.
 * @example
 * await replaceThroughDroppingName(rollbackContext, look, { staged, assertStill: undefined }) // => { ino: 43n, sha256: 'cd…' }
 */
async function replaceThroughDroppingName(
  context: Context,
  look: InspectedCopy,
  write: TrackedWrite,
): Promise<RecordVersion> {
  const aside = await moveTrackedAside(context, look)
  // The name went empty right after the last look: a publish record a decision read stays gone, a rollback journal is claimed again at that name.
  if (!aside) {
    if (context.journalVersion?.refusesEmptyName)
      throw journalConflictError(context, 'gone')
    return publishAtEmptyName(context, write.staged, write.assertStill)
  }
  await renewOrPutBack(context, aside, () =>
    assertAfterMove(context, aside, write.assertStill, write.staged),
  )
  const version = await publishMovedRecord(context, aside, write)
  await dropAsideRecord(context, aside, version)
  return version
}

/**
 * Publishes a tracked record's staged bytes at its name once the record moved to its dropping name ({@link replaceThroughDroppingName}), as at any name that holds nothing of this run ({@link publishAtEmptyName}): a link, which never replaces a file, or, where the storage gives no file a second name ({@link NO_LINK_CODES}), a rename of the complete staged file right after a synchronous look finds that name empty ({@link claimWithoutLinks}), never an exclusive create in place, which would leave part of the bytes at that name for the time of one write.
 * @param context - The run; its pending path is the record.
 * @param aside - The record at its dropping name ({@link moveTrackedAside}).
 * @param write - The staged bytes and the caller's look, looked at again on the route without links ({@link TrackedWrite}).
 * @returns The version published: the staged file's.
 * @throws What {@link refuseMovedPublish} throws: the refusal naming both names when a file came to the emptied name, otherwise what the link or the rename route threw, once the record went back.
 * @example
 * await publishMovedRecord(rollbackContext, aside, write) // => { ino: 43n, sha256: 'cd…' }
 */
function publishMovedRecord(
  context: Context,
  aside: AsideRecord,
  { staged, assertStill }: TrackedWrite,
): Promise<RecordVersion> {
  return publishAtEmptyName(context, staged, assertStill).catch(
    (error: unknown) => refuseMovedPublish(context, aside, error),
  )
}

/**
 * Ends a rewrite whose publication failed after its record moved to the dropping name; called by {@link publishMovedRecord}.
 * @param context - The run; its pending path is the record.
 * @param aside - The record at its dropping name.
 * @param error - What the link or the rename route ({@link claimWithoutLinks}) threw.
 * @returns Never.
 * @throws The refusal naming both names ({@link bothRecordNamesError}) when a file came to the emptied name (the link's `EEXIST`, or a file a synchronous look finds there now): that file stays, and so does the record at the dropping name. Otherwise `error`, once the version this run moved went back to its name ({@link putTrackedBack}), or what that put-back throws.
 * @example
 * await refuseMovedPublish(rollbackContext, aside, linkError) // throws EIO once pending.json.rollback stands again
 */
async function refuseMovedPublish(
  context: Context,
  aside: AsideRecord,
  error: unknown,
): Promise<never> {
  // A file came to the emptied name: it stays, and so does the record at the dropping name.
  if (codeOf(error) === 'EEXIST' || !isNameEmptyNow(context.pendingPath))
    throw bothRecordNamesError(context)
  // Nothing was published: the record goes back to its name.
  await putTrackedBack(context, aside.droppingPath, aside.moved)
  throw error
}

/**
 * Publishes a tracked rollback journal at a name that holds nothing of this run with a link, which never replaces a file, or, where the storage's file system gives no file a second name, by renaming the complete flushed bytes there once a last look found that name empty ({@link claimWithoutLinks}); called by {@link writeTrackedJournal} when no version is known or the name was found empty.
 * The bytes are first written and flushed under a fresh private name beside the journal ({@link stageRecord}); that name is looked at right before the link, so only the file this call wrote is linked ({@link lookAtStagedRecord}), the journal's name must show that file right after the link ({@link assertPublishedRecord}), and the staged name goes afterwards only while it still shows that file ({@link dropStagedRecord}). That look after the link reads the journal through its open handle, and the cleanup awaits the file system after it, so the journal is read again after the cleanup and its name looked at once more, synchronously, as the last step ({@link confirmPublished}): the version goes back to the caller, whose next step may move the config to the private name that journal names ({@link deleteConfig}, {@link publishRoot}), only while the name still shows that file.
 * Limit: a file put at the staged name between its last look and the link is linked; the look after the link then refuses before anything that rests on the journal moves. A file put at the journal's name, or a move of the journal, after the last look is not seen here; a take-back looks at that name once more right before it moves the config ({@link assertTakeBackRecordStill}). A stall of storage that starts between the awaited looks and the synchronous ones holds the extension host's thread. On storage without hard links, see {@link claimWithoutLinks}.
 * @param context - The run; its pending path is the journal, its seam is called right before the link.
 * @param value - The complete journal.
 * @param assertStill - What else must still hold, looked at right after the seam and before the link, after an awaited look at its names ({@link writeRecord}).
 * @returns The version the link or the rename published: the inode of the file at the journal's name and the hash of its bytes.
 * @throws A {@link JournalConflictError} (`changed`) when something already stands at the journal's name, which stays as it is, or when that name shows another file than this call's right after the publication or at the last look, and (`gone`) when it shows nothing then; what the write, the look at the staged name ({@link leftoverReplacedError}) or `assertStill` throws, and what a link that failed for another reason than a file at that name or storage without hard links threw (nothing is published then).
 * @example
 * await claimJournal(rollbackContext, journal) // => { ino: 44n, sha256: 'ef…' }; pending.json.rollback holds `journal`, or the call throws and the name stays as it was
 * await claimJournal(rollbackContext, journal) // throws a `changed` JournalConflictError once a sync tool renamed another journal over pending.json.rollback while the staged name was deleted
 */
async function claimJournal(
  context: Context,
  value: unknown,
  assertStill?: StillLook,
): Promise<RecordVersion> {
  const path = context.pendingPath
  const staged = await stageRecord(path, value)
  let version: RecordVersion
  try {
    context.seam?.beforeRecordWrite?.({ path, record: value })
    // A storage that already stalls holds this step here, in the thread pool, not at the synchronous looks below, which come in the same order.
    await lookAheadAt(assertStill?.names ?? [])
    const source = await lookAtStagedRecord(staged)
    assertStill?.assert()
    assertStagedRecordStill(staged, source)
    version = await publishAtEmptyName(context, staged, assertStill)
    await assertPublishedRecord(context, version)
  } finally {
    // Once linked the journal keeps its bytes under its own name; the staged name goes whatever happened, while it shows the file this call wrote.
    await dropStagedRecord(staged)
  }
  return confirmPublished(context, version)
}

/**
 * Publishes a tracked record's staged bytes at a name that holds nothing of this run: a link, which never replaces a file, or, where the storage gives no file a second name, {@link claimWithoutLinks}; called by {@link claimJournal}, by {@link replaceThroughDroppingName} when the name went empty right before its move, and by {@link publishMovedRecord} at the name its move emptied.
 * @param context - The run; its pending path is the record.
 * @param staged - The staged bytes ({@link stageRecord}).
 * @param assertStill - The caller's look, looked at again on the route without links.
 * @returns The version published: the staged file's.
 * @throws What {@link claimWithoutLinks} throws for a failed link.
 * @example
 * await publishAtEmptyName(rollbackContext, staged, undefined) // => staged.version
 */
function publishAtEmptyName(
  context: Context,
  staged: StagedRecord,
  assertStill: StillLook | undefined,
): Promise<RecordVersion> {
  return link(staged.staged, context.pendingPath).then(
    () => staged.version,
    (error: unknown) => claimWithoutLinks(context, staged, error, assertStill),
  )
}

/**
 * Reads a tracked record's name again after the cleanup that followed its publication and looks at it once more, synchronously, as the last step of the write; called by {@link claimJournal} and {@link writeTrackedJournal}, because the look right after the publication read the record through its open handle and the cleanup awaited the file system since, so a record another program moved away or replaced meanwhile never lets the caller act on it.
 * The read comes after the cleanup's unlinks, which change the file's change time. A storage that already stalls holds this step at the awaited looks, not at the synchronous one.
 * @param context - The run; its pending path is the record.
 * @param version - The version this write published.
 * @returns That version.
 * @throws What {@link assertPublishedRecord} and {@link assertTrackedJournalStill} throw.
 * @example
 * await confirmPublished(rollbackContext, version) // => version, once pending.json.rollback still shows it
 */
async function confirmPublished(
  context: Context,
  version: RecordVersion,
): Promise<RecordVersion> {
  const published = await assertPublishedRecord(context, version)
  await lookAheadAt([context.pendingPath])
  assertTrackedJournalStill(context, published)
  return version
}

/** The codes of a link refused because the storage's file system gives no file a second name: `EPERM` on Linux (vfat), `ENOTSUP` (or its alias `EOPNOTSUPP`) on macOS (exFAT) and `ENOSYS` where the file system has no such call, the codes the Cursor skill's refused link names as well ({@link describeRefusedSkillLink}). The one set for Codebook's tracked records and its record of the entry alike: only these start a write's route without links ({@link claimWithoutLinks}, {@link publishMovedRecord}, {@link claimReceiptName}) and a put-back's ({@link putTrackedBack}); every other failure of a link is thrown as it is, so a failing disk never gets a record published by another route. */
const NO_LINK_CODES: ReadonlySet<unknown> = new Set([
  'EPERM',
  'ENOTSUP',
  'EOPNOTSUPP',
  'ENOSYS',
])

/**
 * Claims a tracked record's empty name where the storage's file system gives no file a second name: the complete bytes {@link stageRecord} flushed are renamed there ({@link renameIntoEmptyName}), so the name shows nothing or the whole record at every instant and a stop never leaves an empty or partial record that every run would refuse; called by {@link publishAtEmptyName} when its link failed, for a first write and for a rewrite whose record moved to its dropping name alike.
 * The link was awaited, so the staged name is read again, and the caller's names, the staged name and the record's name are looked at through the thread pool and then synchronously right before the rename ({@link renameIntoEmptyName}): the staged name must still show the file this call wrote ({@link assertStagedRecordStill}), the caller's look must hold, and the record's name must be empty.
 * Limit: those of {@link renameIntoEmptyName}.
 * @param context - The run; its pending path is the record.
 * @param staged - The staged bytes ({@link stageRecord}).
 * @param linkError - Why the link failed.
 * @param assertStill - The caller's look, looked at again right before the rename.
 * @returns The version the rename published: the staged file's.
 * @throws A {@link JournalConflictError} (`changed`) when something stands at the record's name (it stays as it is); `linkError` itself for any other failure than storage without hard links ({@link NO_LINK_CODES}), so nothing is published by another route; a {@link leftoverReplacedError} naming the staged name when it no longer shows the file this call wrote; what `assertStill` or the rename throws.
 * @example
 * await claimWithoutLinks(rollbackContext, staged, linkError, undefined) // => staged.version once a link in an exFAT storage folder answered ENOTSUP
 */
async function claimWithoutLinks(
  context: Context,
  staged: StagedRecord,
  linkError: unknown,
  assertStill: StillLook | undefined,
): Promise<RecordVersion> {
  const path = context.pendingPath
  // Something stands at the name already: it is never replaced.
  if (codeOf(linkError) === 'EEXIST')
    throw journalConflictError(context, 'changed', linkError)
  if (!NO_LINK_CODES.has(codeOf(linkError))) throw linkError
  return renameIntoEmptyName(path, staged, assertStill, () =>
    journalConflictError(context, 'changed'),
  )
}

/**
 * Publishes a record's flushed staged bytes at its empty name where the storage's file system gives no file a second name: a rename, so the name shows nothing or the whole record at every instant and a stop never leaves an empty or partial record that every run would refuse; the shared end of {@link claimWithoutLinks} (tracked records) and {@link claimReceiptName} (`receipt.json`) once their link was refused for lack of support.
 * The refused link was awaited, so the staged name is read again, and the caller's names, the staged name and the record's name are looked at through the thread pool and then synchronously right before the rename, nothing awaited in between: the caller's look must hold, the staged name must still show the file the caller wrote ({@link assertStagedRecordStill}), and the record's name must be empty ({@link isNameEmptyNow}).
 * Limit: a file another program puts at the record's name between that last look and the rename is replaced; no Node primitive publishes complete bytes without replacing where links fail, and an exclusive create in place would leave the name with part of the bytes for the time of one write.
 * @param path - The record's name.
 * @param staged - The staged bytes ({@link stageRecord}).
 * @param assertStill - The caller's look, looked at again right before the rename.
 * @param conflict - Builds the caller's refusal for a name that is no longer empty.
 * @returns The version the rename published: the staged file's.
 * @throws What `conflict` builds when something stands at the record's name (it stays as it is); a {@link leftoverReplacedError} naming the staged name when it no longer shows the file the caller wrote; what `assertStill` or the rename throws. Nothing is published then.
 * @example
 * await renameIntoEmptyName(receiptPath, staged, assertStill, () => receiptConflictError(context, 'changed')) // => staged.version once a link in an exFAT storage folder answered ENOTSUP
 */
async function renameIntoEmptyName(
  path: string,
  staged: StagedRecord,
  assertStill: StillLook | undefined,
  conflict: () => Error,
): Promise<RecordVersion> {
  // The refused link was awaited: the staged file, the caller's names and the record's empty name are looked at again right before the rename.
  const source = await lookAtStagedRecord(staged)
  await lookAheadAt([...(assertStill?.names ?? []), staged.staged, path])
  assertStill?.assert()
  assertStagedRecordStill(staged, source)
  if (!isNameEmptyNow(path)) throw conflict()
  await rename(staged.staged, path)
  return staged.version
}

/** A tracked record moved to its dropping name ({@link moveTrackedAside}), and that file as the read right after the move found it: this run's version, whose inode, size and times the dropping name must still show before the record is published anew or deleted. */
type AsideRecord = { droppingPath: string; moved: InspectedCopy }

/**
 * Gives the dropping name of a tracked record ({@link DROPPING_SUFFIX}): the private name a rewrite or delete moves the record to first ({@link moveTrackedAside}), and that the run start looks at before anything reads the record ({@link settleDroppedRecord}).
 * @param context - The run; its pending path is the record.
 * @returns `<record>.codebook-dropping`.
 * @example
 * droppingPathOf(rollbackContext) // => '…/devin-mcp/pending.json.rollback.codebook-dropping'
 */
function droppingPathOf(context: Context): string {
  return `${context.pendingPath}.${DROPPING_SUFFIX}`
}

/** The suffix of a tracked record's dropping note ({@link droppingNotePathOf}), a name only Codebook uses. */
const DROPPING_NOTE_SUFFIX = 'codebook-dropping-note'

/**
 * Gives the name of a tracked record's dropping note ({@link droppingNoteSchema}): where a rewrite or delete notes which file it moves to the dropping name ({@link noteDroppingMove}), and where the run start reads that proof ({@link provenDroppedRecord}).
 * @param context - The run; its pending path is the record.
 * @returns `<record>.codebook-dropping-note`.
 * @example
 * droppingNotePathOf(rollbackContext) // => '…/devin-mcp/pending.json.rollback.codebook-dropping-note'
 */
function droppingNotePathOf(context: Context): string {
  return `${context.pendingPath}.${DROPPING_NOTE_SUFFIX}`
}

/** What a dropping note names ({@link droppingNoteSchema}): the version a rewrite or delete moves to the dropping name, and for a rewrite the staged version it publishes at the record's name. */
type NotedMove = { moved: RecordVersion; published?: RecordVersion }

/**
 * Runs the last looks, the move to the dropping name and what follows of a tracked record's rewrite or delete with a dropping note beside the record that names the version those looks must find ({@link noteDroppingMove}), written before them; called by {@link writeTrackedJournal} and {@link dropTrackedJournal}, by {@link writeReceipt} and {@link dropReceipt} for Codebook's record of the entry ({@link receiptTrackedContextOf}), and by {@link whileJournalHeld} for a rollback journal's hold, so a run that stops with the record at its dropping name leaves the next run the proof that the file there is that record ({@link provenDroppedRecord}), and a file another program puts at the dropping name never matches it.
 * However the step ends in this run, the note goes once nothing stands at the dropping name ({@link dropNoteUnlessDropping}); while something stands there (the record a refusal left there, or another program's file), it stays for the next run.
 * @param context - The run; its pending path is the record.
 * @param noted - The version the last looks must find at the record's name, and a rewrite's staged version ({@link NotedMove}).
 * @param step - The last looks, the move and the publication or delete.
 * @returns What `step` returns.
 * @throws What `step` throws.
 * @example
 * const isDeleted = await withDroppingNote(rollbackContext, { moved: look }, () => deleteThroughDroppingName(rollbackContext, look, undefined)) // => true; neither the record nor its note stands
 */
async function withDroppingNote<Result>(
  context: Context,
  noted: NotedMove,
  step: () => Promise<Result>,
): Promise<Result> {
  await noteDroppingMove(context, noted)
  try {
    return await step()
  } finally {
    await dropNoteUnlessDropping(context)
  }
}

/**
 * Writes the dropping note of a tracked record's rewrite or delete ({@link droppingNoteSchema}); called only by {@link withDroppingNote}, before the last looks.
 * The note's complete bytes are flushed under a temporary name and renamed over the note's name ({@link atomicPrivateWrite}), so a stop leaves the old note or the new one, never part of one.
 * Limit: best effort. A note that cannot be written (a full disk) leaves the previous note, which names an older version, or none: the move still runs, and a stop in it leaves a record the next run cannot prove and keeps, names and goes no further over ({@link unprovenDroppingError}). A file another program puts at the note's name is replaced.
 * @param context - The run; its pending path is the record.
 * @param noted - What the note names ({@link NotedMove}).
 * @returns Resolves once the note is written or could not be.
 * @example
 * await noteDroppingMove(rollbackContext, { moved: look, published: staged.version }) // '…/pending.json.rollback.codebook-dropping-note' holds {"moved":{"ino":"43","sha256":"cd…"},"published":{"ino":"44","sha256":"ef…"}}
 */
async function noteDroppingMove(
  context: Context,
  { moved, published }: NotedMove,
): Promise<void> {
  const note: DroppingNote = {
    moved: { ino: moved.ino.toString(), sha256: moved.sha256 },
    ...(published && {
      published: { ino: published.ino.toString(), sha256: published.sha256 },
    }),
  }
  await atomicPrivateWrite(
    droppingNotePathOf(context),
    note,
    DEVIN_MCP_RECORD_LIMIT_BYTES,
  ).catch(() => undefined)
}

/**
 * Deletes a tracked record's dropping note once a look finds nothing at the dropping name, so the note names a moved record only while one may stand there; called by {@link withDroppingNote} however its step ended, and by {@link putNotedRecordBack} once the record stands at its name again, because a dropping name the put-back could not delete still holds the record's second name, which only the note proves once the record's own name is lost.
 * @param context - The run; its pending path is the record.
 * @returns Resolves once the note is gone, stays because something stands at the dropping name or the look failed, or could not be deleted.
 * @example
 * await dropNoteUnlessDropping(rollbackContext) // the note is gone after the record went back to its name
 */
async function dropNoteUnlessDropping(context: Context): Promise<void> {
  const isDroppingEmpty = await lstat(droppingPathOf(context)).then(
    () => false,
    (error: unknown) => codeOf(error) === 'ENOENT',
  )
  if (isDroppingEmpty) await dropDroppingNote(context)
}

/**
 * Deletes a tracked record's dropping note once nothing of the move it names stands at the dropping name any more; called by {@link dropNoteUnlessDropping}, and by {@link settleDroppedRecord} once the run start found that name empty or dropped it as a second name of the record's file.
 * @param context - The run; its pending path is the record.
 * @returns Resolves once the note is gone or could not be deleted: best effort, because a note beside an empty dropping name proves nothing and the next run start deletes it.
 * @example
 * await dropDroppingNote(rollbackContext) // '…/pending.json.rollback.codebook-dropping-note' is gone
 */
async function dropDroppingNote(context: Context): Promise<void> {
  await unlink(droppingNotePathOf(context)).catch(() => undefined)
}

/**
 * Reads a tracked record's dropping note through one handle ({@link readRecordFile}) and checks its shape; called only by {@link provenDroppedRecord}.
 * @param context - The run; its pending path is the record.
 * @returns The note; undefined when none stands there, or when it is a link, no regular file, too large, unreadable, no JSON or of another shape, since such a note proves nothing.
 * @example
 * await readDroppingNote(rollbackContext) // => { moved: { ino: '43', sha256: 'cd…' } }
 */
async function readDroppingNote(
  context: Context,
): Promise<DroppingNote | undefined> {
  const path = droppingNotePathOf(context)
  try {
    const read = await readRecordFile(path, context.retry)
    return (
      read && parseRecord(path, droppingNoteSchema, context.retry, read.bytes)
    )
  } catch {
    // A note that cannot be read or is no note proves nothing.
    return undefined
  }
}

/** A file at a tracked record's dropping name that the dropping note proves ({@link provenDroppedRecord}): that file as the read found it, and the version a stopped rewrite published at the record's name (none for a delete). */
type DroppedProof = {
  moved: InspectedCopy
  published: RecordVersion | undefined
}

/**
 * Reads the file at a tracked record's dropping name through one open file and gives it only while it is the version the dropping note names, its inode and the hash of its bytes: the record a run that stopped inside its move left there; called by {@link settleDroppedRecord} before that file goes back to the record's empty name or, beside the new record a stopped rewrite published, is deleted.
 * @param context - The run; its pending path is the record.
 * @returns
 * - That file as the read found it (inode, hash, size and times), which the put-back's or the delete's look must still find ({@link putTrackedBack}, {@link dropAsideRecord}), with the version a rewrite's note names as published
 * - undefined when no note proves it: no note, a note that proves nothing ({@link readDroppingNote}), a file that cannot be read, or another inode or other bytes than the note names
 * @example
 * await provenDroppedRecord(rollbackContext) // => { moved: { ino: 43n, sha256: 'cd…', size: 310n, … }, published: { ino: 44n, sha256: 'ef…' } } after a stop right after a rewrite's publication
 * await provenDroppedRecord(rollbackContext) // => undefined once a backup replaced the file at the dropping name
 */
async function provenDroppedRecord(
  context: Context,
): Promise<DroppedProof | undefined> {
  const note = await readDroppingNote(context)
  if (!note) return undefined
  const dropped = await inspectCopy(droppingPathOf(context)).catch(
    () => undefined,
  )
  // Only the file with the inode and the bytes the note names is the record the stopped run moved there.
  const isNoted =
    dropped !== undefined &&
    isSameFileId(note.moved.ino, dropped.ino) &&
    dropped.sha256 === note.moved.sha256
  if (!isNoted) return undefined
  // The note's digits are checked by its schema, so they make an inode as they stand.
  const published = note.published && {
    ino: BigInt(note.published.ino),
    sha256: note.published.sha256,
  }
  return { moved: dropped, published }
}

/**
 * Moves a tracked record to its dropping name right after the last looks found this run's version at its name, and proves there that it is that version; called by {@link replaceThroughDroppingName} and {@link deleteThroughDroppingName} before they publish new bytes at that name or delete the record.
 * The move never replaces a file at the dropping name ({@link moveToDroppingName}) and takes exactly what stands at the record's name, so a file another program renamed over the record after the last look moves instead, is read at the dropping name, goes back to the record's name as the very file that read found and only while the dropping name still shows it ({@link putTrackedBack}), and the run stops; it is never replaced or deleted, and a file a sync tool swaps in at the dropping name after that read never goes back in its place.
 * Limits: those of {@link moveToDroppingName}; a stop inside the move leaves the record at the dropping name, or at both names, for the next run, which puts it back or drops that second name first ({@link settleDroppedRecord}).
 * @param context - The run; its pending path is the record.
 * @param version - The version the last looks found: this run's.
 * @returns The record at its dropping name ({@link AsideRecord}); undefined when the record's name was empty at the move (another program removed it after the last look), and nothing moved.
 * @throws What {@link moveToDroppingName} throws: the refusal naming both names ({@link bothRecordNamesError}) when a file stands at the dropping name (nothing moved then) or comes to the record's name during the move. A `changed` {@link JournalConflictError} once the moved file, not this run's version, went back to its name as the file the move read; a `gone` one when the dropping name stands empty then, nothing left to put back; the {@link droppingChangedError} when the dropping name holds anything the move's read did not prove, which stays there, named, whether it is another file or one that cannot be read as a record; what {@link putTrackedBack} throws.
 * @example
 * await moveTrackedAside(rollbackContext, look) // => { droppingPath: '…/pending.json.rollback.codebook-dropping', moved: { ino: 43n, … } }
 */
async function moveTrackedAside(
  context: Context,
  version: RecordVersion,
): Promise<AsideRecord | undefined> {
  const droppingPath = droppingPathOf(context)
  if (!(await moveToDroppingName(context, droppingPath))) return undefined
  const moved = await inspectCopy(droppingPath).catch(() => undefined)
  if (moved?.ino === version.ino && moved.sha256 === version.sha256)
    return { droppingPath, moved }
  if (moved) {
    // What moved is not this run's version (a file a backup renamed over the record after the last look): only the file the move read goes back, never another file swapped there since and never replacing a file, and the run stops.
    await putTrackedBack(context, droppingPath, moved)
    throw journalConflictError(context, 'changed')
  }
  // The read proved nothing (the moved file cannot be read as a record, or is gone already): nothing unverified ever goes back. A dropping name found empty leaves nothing to put back; anything still there stays, named, and the next run puts it back only while the dropping note proves it.
  await lookAheadAt([droppingPath])
  if (isNameEmptyNow(droppingPath)) throw journalConflictError(context, 'gone')
  throw droppingChangedError(context)
}

/**
 * Moves the file at a tracked record's name to its dropping name without replacing anything there; called only by {@link moveTrackedAside}, right after the last looks found this run's version at the record's name.
 * Where the storage gives a file a second name, a link claims the dropping name, which never replaces a file (a file put there right before the link stays, and the run stops), and the record's own name is then emptied without an unlink at that name ({@link vacateRecordName}); where it gives none ({@link NO_LINK_CODES}), a rename moves the record right after a synchronous look finds the dropping name empty ({@link renameToDroppingName}).
 * Limits: on storage without hard links, a file put at the dropping name between that look and the rename is replaced (no Node primitive renames without replacing). A file another program swaps in at the record's name between the last look and the link gets the dropping name instead, and the move proves it is not this run's version ({@link moveTrackedAside}); when it is a symbolic link, the link gives its target that second name (the system's link follows symbolic links), which the next run settles or names.
 * @param context - The run; its pending path is the record.
 * @param droppingPath - The dropping name ({@link droppingPathOf}).
 * @returns `true` once the file that stood at the record's name stands at the dropping name and the record's name is empty; `false` when the record's name was empty at the link or the rename, and nothing moved.
 * @throws The refusal naming both names ({@link bothRecordNamesError}) when a file stands at the dropping name (nothing moved then); what {@link vacateRecordName} throws; what the link throws for another reason than storage without hard links, and what the rename throws.
 * @example
 * await moveToDroppingName(rollbackContext, droppingPath) // => true; '…/pending.json.rollback.codebook-dropping' holds the record, its own name is empty
 */
async function moveToDroppingName(
  context: Context,
  droppingPath: string,
): Promise<boolean> {
  const route = await link(context.pendingPath, droppingPath).then(
    () => 'linked' as const,
    (error: unknown) => routeOfRefusedLink(context, error),
  )
  if (route === 'empty') return false
  if (route === 'no-link') return renameToDroppingName(context, droppingPath)
  await vacateRecordName(context, droppingPath)
  return true
}

/**
 * Tells how a tracked record's move goes on after its link to the dropping name was refused; called only by {@link moveToDroppingName}.
 * @param context - The run; its pending path is the record.
 * @param error - What the link threw.
 * @returns
 * - `empty` when the record's name was empty (another program removed the record after the last look): nothing moved
 * - `no-link` when the storage gives no file a second name ({@link NO_LINK_CODES}): the record moves by a rename
 * @throws The refusal naming both names ({@link bothRecordNamesError}) when a file stands at the dropping name; `error` itself for any other failure. Nothing moved then.
 * @example
 * routeOfRefusedLink(rollbackContext, Object.assign(new Error('not supported'), { code: 'ENOTSUP' })) // => 'no-link'
 */
function routeOfRefusedLink(
  context: Context,
  error: unknown,
): 'empty' | 'no-link' {
  const code = codeOf(error)
  // A file at the dropping name already: the link never replaces it, so nothing moved and both stay.
  if (code === 'EEXIST') throw bothRecordNamesError(context)
  if (code === 'ENOENT') return 'empty'
  if (NO_LINK_CODES.has(code)) return 'no-link'
  throw error
}

/**
 * Moves a tracked record to its dropping name with a rename where the storage gives no file a second name ({@link NO_LINK_CODES}); called only by {@link moveToDroppingName} once its link was refused for that reason.
 * The refused link was awaited, so the dropping name is looked at through the thread pool and then synchronously right before the rename, nothing awaited in between: it must be empty, because a rename replaces what stands at its destination.
 * Limit: a file put at the dropping name between that look and the rename is replaced; no Node primitive renames without replacing where links fail.
 * @param context - The run; its pending path is the record.
 * @param droppingPath - The dropping name ({@link droppingPathOf}).
 * @returns `true` once the record moved; `false` when its name was empty at the rename, and nothing moved.
 * @throws The refusal naming both names ({@link bothRecordNamesError}) when a file stands at the dropping name; nothing moved then. What the rename throws otherwise.
 * @example
 * await renameToDroppingName(rollbackContext, droppingPath) // => true on an exFAT storage folder
 */
async function renameToDroppingName(
  context: Context,
  droppingPath: string,
): Promise<boolean> {
  // A storage that already stalls holds this step here, not at the synchronous look below.
  await lookAheadAt([droppingPath])
  // A file at the dropping name already: the rename would replace it, so nothing moves and both stay.
  if (!isNameEmptyNow(droppingPath)) throw bothRecordNamesError(context)
  return rename(context.pendingPath, droppingPath).then(
    () => true,
    (error: unknown) => {
      // Another program emptied the name after the last look: nothing moved.
      if (codeOf(error) === 'ENOENT') return false
      throw error
    },
  )
}

/**
 * Empties a tracked record's name once a link gave the file that stood there its dropping name as well, without ever unlinking at the record's name; called only by {@link moveToDroppingName}.
 * After an awaited look at both names, synchronous looks right before the rename find the dropping name and the record's name showing one file; the record's name is then renamed to a fresh private name beside it (`<record>.<uuid>.tmp`, as a staged file's), which no other program uses, so that rename replaces nothing and moves exactly what stands at the record's name ({@link settleVacatedName}).
 * Limit: a file another program renames over the record in the instant between those looks and the rename moves to the fresh name; it goes back to the record's name with a link, which never replaces a file, and the run stops naming both names.
 * @param context - The run; its pending path is the record.
 * @param droppingPath - The dropping name, which the link gave the record's file.
 * @throws The refusal naming both names ({@link bothRecordNamesError}) when the record's name no longer shows the linked file at that look (another file came there after the link: it stays, and so does the linked one at the dropping name); what {@link settleVacatedName} throws; what the rename throws for another reason than an empty name, once the dropping name, then only a second name of the record's file, went again ({@link dropTrackedSecondName}).
 * @example
 * await vacateRecordName(rollbackContext, droppingPath) // pending.json.rollback is empty, its file stands at '…/pending.json.rollback.codebook-dropping' alone
 */
async function vacateRecordName(
  context: Context,
  droppingPath: string,
): Promise<void> {
  const path = context.pendingPath
  // A storage that already stalls holds this step here, not at the synchronous looks below, which come in the same order.
  await lookAheadAt([droppingPath, path])
  const linkedIno = inodeNow(droppingPath)
  // Another file came to the record's name after the link: it stays, and so does the linked one at the dropping name.
  if (linkedIno === undefined || !isStagedNameStill(path, { ino: linkedIno }))
    throw bothRecordNamesError(context)
  const vacatedPath = `${path}.${randomUUID()}.tmp`
  try {
    await rename(path, vacatedPath)
  } catch (error) {
    // Another program emptied the record's name right after the look: the dropping name holds the file the link reached.
    if (codeOf(error) === 'ENOENT') return
    // Nothing moved: the dropping name, only a second name of the record's file, goes again.
    await dropTrackedSecondName(context, linkedIno)
    throw error
  }
  await settleVacatedName(context, vacatedPath, linkedIno)
}

/**
 * Gives the inode a name shows by one synchronous look, without following a link; called by {@link vacateRecordName} for the dropping name right before its look at the record's name.
 * @param path - The name to look at.
 * @returns The inode; undefined when nothing stands there or the look failed.
 * @example
 * inodeNow(droppingPath) // => 43n
 */
function inodeNow(path: string): bigint | undefined {
  try {
    return lstatSync(path, { bigint: true, throwIfNoEntry: false })?.ino
  } catch {
    return undefined
  }
}

/**
 * Settles the fresh private name a tracked record's name was renamed to ({@link vacateRecordName}): when it is only another name of the file the dropping name holds, it goes, but only while a synchronous look right before its unlink still finds that file at the dropping name, so dropping the fresh name never loses the record's last one; any other file there (one another program renamed over the record in the instant before that rename) goes back to the record's name with a link, which never replaces a file, and the run stops.
 * @param context - The run; its pending path is the record.
 * @param vacatedPath - The fresh private name.
 * @param linkedIno - The inode of the file the link gave the dropping name.
 * @returns Nothing once that name went, or holds nothing; a failed unlink of that second name is no failure (no build reads such a name).
 * @throws The {@link vacatedRecordKeptError} naming the fresh name when the dropping name no longer shows the moved file at that last look (a backup or sync tool may have moved or replaced it: the fresh name may be the record's last one, so it stays); the refusal naming both names ({@link bothRecordNamesError}) once another file went back to the record's name; the {@link vacatedFileKeptError} naming the fresh name when the record's name no longer shows that file right after its link back (the fresh name may be that file's last one, so it stays); a {@link leftoverReplacedError} naming the fresh name when that file was replaced before its unlink, is no regular file or could not go back (it stays there); what the look at the fresh name throws other than for a missing name (the record stays at the dropping name, which the next run puts back).
 * @example
 * await settleVacatedName(rollbackContext, vacatedPath, 43n) // '…/pending.json.rollback.<uuid>.tmp' is gone
 */
async function settleVacatedName(
  context: Context,
  vacatedPath: string,
  linkedIno: bigint,
): Promise<void> {
  const vacated = await lstatOrAbsent(vacatedPath)
  if (!vacated) return
  if (vacated.ino === linkedIno) {
    const droppingPath = droppingPathOf(context)
    // A storage that already stalls holds this step here, not at the synchronous look below.
    await lookAheadAt([droppingPath])
    // Only another name of the file the dropping name still holds goes: dropping it loses nothing. Once the dropping name no longer shows that file, this name may be the record's last one: it stays, named.
    if (!isStagedNameStill(droppingPath, { ino: linkedIno }))
      throw vacatedRecordKeptError(context, vacatedPath)
    // The awaited look may have given a sync tool time to replace this second name; never unlink that file.
    if (inodeNow(vacatedPath) !== linkedIno)
      throw leftoverReplacedError(vacatedPath)
    await unlink(vacatedPath).catch(() => undefined)
    return
  }
  // Another program's file moved off the record's name goes back there, never replacing what stands there by now; a link would follow a symbolic link, so anything but a regular file stays where it is, named.
  if (!vacated.isFile()) throw leftoverReplacedError(vacatedPath)
  await link(vacatedPath, context.pendingPath).catch(() => {
    throw leftoverReplacedError(vacatedPath)
  })
  // The awaited link may have given a sync tool time to empty the record's name or put another file there: this second name may then be the moved file's last one, so it stays, named. A look that failed proves nothing either, since it cannot tell that the file still has another name.
  if (inodeNow(context.pendingPath) !== vacated.ino)
    throw vacatedFileKeptError(context, vacatedPath)
  // The last looks at this second name, closest to its unlink: a replacement is never unlinked, and the same file whose other name went in the instant between these looks counts no other name any more (a look at its link count tells), so it stays, named, as the moved file's possible last one.
  if (!isStagedNameStill(vacatedPath, { ino: vacated.ino }))
    throw leftoverReplacedError(vacatedPath)
  if (!isStagedNameStill(vacatedPath, { ino: vacated.ino, isShared: true }))
    throw vacatedFileKeptError(context, vacatedPath)
  await unlink(vacatedPath).catch(() => undefined)
  throw bothRecordNamesError(context)
}

/**
 * Deletes a tracked record's dropping name while it is only a second name of the file at the record's name, so a step that leaves the record at its name leaves no second name that the next move would refuse; called by {@link vacateRecordName} when its rename failed after the link, and by {@link whileJournalHeld} and {@link holdJournal} for a rollback journal's hold.
 * After an awaited look at both names, synchronous looks right before the unlink find the record's name showing that inode and the dropping name showing it with another name.
 * Limits: a swap at the dropping name between those looks and the unlink is not seen (no Node primitive unlinks by inode). A stall that starts between the awaited looks and the synchronous ones holds the extension host's thread.
 * @param context - The run; its pending path is the record.
 * @param ino - The inode both names must show.
 * @returns Nothing; best effort: a dropping name that shows another file, stands beside a record name that no longer shows that inode, or cannot be deleted stays, and the next run settles it ({@link settleDroppedRecord}).
 * @example
 * await dropTrackedSecondName(rollbackContext, 43n) // '…/pending.json.rollback.codebook-dropping' is gone; pending.json.rollback still shows inode 43
 */
async function dropTrackedSecondName(
  context: Context,
  ino: bigint,
): Promise<void> {
  const droppingPath = droppingPathOf(context)
  // A storage that already stalls holds this step here, not at the synchronous looks below, which come in the same order.
  await lookAheadAt([context.pendingPath, droppingPath])
  if (
    !isStagedNameStill(context.pendingPath, { ino }) ||
    !isStagedNameStill(droppingPath, { ino, isShared: true })
  )
    return
  await unlink(droppingPath).catch(() => undefined)
}

/**
 * Looks again, right before a moved record is published anew or deleted, at what must still hold since the last looks before the move; called by {@link replaceThroughDroppingName} and {@link deleteThroughDroppingName} through {@link renewOrPutBack}, so the record goes back to its name when anything changed while it moved.
 * The staged name is read again through the thread pool, then the caller's names, the staged name and the dropping name are looked at through it, and then synchronously in that order, with nothing awaited between those looks and the step they guard.
 * @param context - The run; its pending path is the record.
 * @param aside - The record at its dropping name ({@link moveTrackedAside}).
 * @param assertStill - The caller's look; undefined when nothing else must hold.
 * @param staged - The staged bytes of a rewrite ({@link stageRecord}); undefined for a delete.
 * @throws What `assertStill` throws; a {@link leftoverReplacedError} naming the staged name when it no longer shows the file this call wrote; the {@link droppingChangedError} (`changed`) when the dropping name no longer shows the moved file's inode, size and times.
 * @example
 * await assertAfterMove(rollbackContext, aside, assertStill, staged) // throws once a backup put the setup record back without its mark while the record moved
 */
async function assertAfterMove(
  context: Context,
  aside: AsideRecord,
  assertStill: StillLook | undefined,
  staged?: StagedRecord,
): Promise<void> {
  const source = staged && (await lookAtStagedRecord(staged))
  await lookAheadAt([
    ...(assertStill?.names ?? []),
    ...(staged ? [staged.staged] : []),
    aside.droppingPath,
  ])
  assertStill?.assert()
  if (staged && source) assertStagedRecordStill(staged, source)
  // Another file, or none, at the dropping name: it is not this run's record, so the refusal names that name.
  if (!isStagedNameStill(aside.droppingPath, aside.moved))
    throw droppingChangedError(context)
}

/**
 * Runs a look that must hold after a tracked record moved to its dropping name, and puts the version this run moved there back first when it fails ({@link putTrackedBack}), never another file found at that name; called by {@link replaceThroughDroppingName} and {@link deleteThroughDroppingName}.
 * The look's own refusal is what the run throws even when the put-back fails as well, so a caller that tells a rollback record that came back apart from any other failure ({@link adoptPending}) still does; the put-back's failure becomes that refusal's cause, for diagnosis only.
 * @param context - The run; its pending path is the record.
 * @param aside - The record at its dropping name.
 * @param renew - The look ({@link assertAfterMove}).
 * @throws What `renew` throws, once the record stands at its name again, or with the put-back's failure as its cause when it could not.
 * @example
 * await renewOrPutBack(rollbackContext, aside, () => assertAfterMove(rollbackContext, aside, assertStill))
 */
async function renewOrPutBack(
  context: Context,
  aside: AsideRecord,
  renew: () => Promise<void>,
): Promise<void> {
  try {
    await renew()
  } catch (renewError) {
    await putTrackedBack(context, aside.droppingPath, aside.moved).catch(
      (putBackError: unknown) => {
        // The look's refusal stays what the run says; the failed put-back is kept beside it.
        if (renewError instanceof Error) renewError.cause = putBackError
      },
    )
    throw renewError
  }
}

/**
 * Deletes the record a rewrite moved to its dropping name once the new one stands at the record's name, only while a read of the record's name through one open file finds the version just published there, its inode and the hash of its bytes, and synchronous looks right before the unlink find the record's name still showing the file that read found (its inode, size and times) and the dropping name still showing the moved file; called by {@link replaceThroughDroppingName}, so a new record another program moves away, replaces or rewrites in place right after its publication never takes the old one with it: the old one stays at the dropping name, which the next run puts back or names ({@link settleDroppedRecord}); and by {@link settleDroppedRecord} for a rewrite that stopped right after its publication, with what its dropping note names.
 * The read waits for the file system without holding the extension host's thread, and an awaited look at both names comes right before their synchronous looks, so a storage that already stalls holds this step in the thread pool; a stall that starts between those awaited looks and the synchronous ones still holds that thread.
 * Limit: a swap at either name, or a write into the new record, between these looks and the unlink is not seen (no Node primitive unlinks by inode or content); the read after the cleanup checks the record's bytes once more ({@link confirmPublished}).
 * @param context - The run; its pending path is the record.
 * @param aside - The record at its dropping name ({@link moveTrackedAside}).
 * @param published - The version just published at the record's name ({@link publishMovedRecord}).
 * @throws A `gone` {@link JournalConflictError} when the record's name is empty; the refusal naming both names ({@link bothRecordNamesError}) when it shows another file or other bytes or cannot be read or looked at, or when the dropping name shows another file or cannot be deleted: both stay, and the next run names them again. A dropping name another program emptied is no failure.
 * @example
 * await dropAsideRecord(rollbackContext, aside, version) // '…/pending.json.rollback.codebook-dropping' is gone
 * await dropAsideRecord(rollbackContext, aside, version) // throws the refusal naming both names once a sync tool rewrote pending.json.rollback in place right after its link; the old version stays at its dropping name
 */
async function dropAsideRecord(
  context: Context,
  { droppingPath, moved }: AsideRecord,
  published: RecordVersion,
): Promise<void> {
  // The new record's bytes, read through one open file: another file there, other bytes in the same file, or a read that fails keeps the old version at the dropping name.
  const standing = await lookAtTrackedJournal(context, published).catch(() => {
    throw bothRecordNamesError(context)
  })
  if (!standing) throw journalConflictError(context, 'gone')
  // A storage that already stalls holds this step here, not at the synchronous looks below, which come in the same order: the record's name, then the dropping name.
  await lookAheadAt([context.pendingPath, droppingPath])
  // The new version moved away, replaced or written into right after that read: the old one stays at the dropping name.
  if (!isStagedNameStill(context.pendingPath, standing))
    throw isNameEmptyNow(context.pendingPath)
      ? journalConflictError(context, 'gone')
      : bothRecordNamesError(context)
  await unlinkMovedRecord(context, { droppingPath, moved })
}

/**
 * Deletes the record a step moved to its dropping name right after a synchronous look still finds there the moved file (its inode, size and times); the shared end of {@link dropAsideRecord} and of {@link finishProvenStep}'s delete, each of which awaits a look at that name right before, so a storage that already stalls holds that step in the thread pool.
 * Limit: a swap at the dropping name between this look and the unlink is not seen (a name only Codebook uses; no Node primitive unlinks by inode); a stall that starts between the awaited look and this one holds the extension host's thread.
 * @param context - The run; its pending path is the record.
 * @param aside - The dropping name and the moved file ({@link AsideRecord}).
 * @param assertBefore - A synchronous last assertion the delete rests on, run with nothing awaited between it, the look at the dropping name and the unlink ({@link finishProvenStep}'s interrupted receipt delete); undefined for a delete that rests on no other file.
 * @throws What `assertBefore` throws; the refusal naming both names ({@link bothRecordNamesError}) when the dropping name shows another file or none, or the unlink fails other than for a missing name: what stands at both names stays. A dropping name another program emptied first is no failure.
 * @example
 * await unlinkMovedRecord(rollbackContext, aside) // '…/pending.json.rollback.codebook-dropping' is gone
 */
async function unlinkMovedRecord(
  context: Context,
  { droppingPath, moved }: AsideRecord,
  assertBefore?: () => void,
): Promise<void> {
  // The delete's other premises, then the moved file itself, are checked with nothing awaited between them and the unlink.
  assertBefore?.()
  // Only the moved file, unchanged since it was read, goes.
  if (!isStagedNameStill(droppingPath, moved))
    throw bothRecordNamesError(context)
  await unlink(droppingPath).catch((error: unknown) => {
    // A record another program removed first is gone, as the step wanted.
    if (codeOf(error) !== 'ENOENT') throw bothRecordNamesError(context)
  })
}

/**
 * Puts a file at a tracked record's dropping name back at the record's empty name with a link, which never replaces a file that appeared there, and deletes the dropping name only once both names show that file; where the storage gives no file a second name ({@link NO_LINK_CODES}), by a rename right after a synchronous look finds the record's name empty ({@link renameTrackedBack}). Called by {@link renewOrPutBack}, {@link refuseMovedPublish} and {@link deleteThroughDroppingName} for the version this run moved there, which alone goes back, by {@link moveTrackedAside} for what its move took from the record's name, and by {@link settleDroppedRecord} for the record a stopped run left there, once the dropping note proved it ({@link provenDroppedRecord}).
 * The looks wait for the file system without holding the extension host's thread ({@link isNameStill}), the record's name first and the dropping name last.
 * Limits: a file swapped in at the dropping name between its first look and the link or rename goes back in its place; on storage without hard links a file another program puts at the record's name between the rename's last look and the rename is replaced, the residual {@link claimWithoutLinks} accepts (no Node primitive moves a name there without replacing what stands at the other).
 * @param context - The run; its pending path is the record.
 * @param droppingPath - The dropping name ({@link droppingPathOf}).
 * @param moved - The version this run moved there ({@link AsideRecord}), the one the dropping note proved at the run start, or what {@link moveTrackedAside} read at the dropping name after its move took it from the record's name: the dropping name must show its inode, size and times, so a file swapped in there since that read never goes back in its place.
 * @throws A `gone` {@link JournalConflictError} when nothing stands at the dropping name; the {@link droppingChangedError} when it shows another file than `moved`, which stays there; the refusal naming both names ({@link bothRecordNamesError}) when a file stands at the record's name or a look after the link finds either name changed; the {@link recordNotBackError} when the link failed for another reason than storage without hard links, or the dropping name holds no regular file (a folder), which never takes the record's name; what {@link renameTrackedBack} throws; what a look throws other than for a missing name. Nothing is deleted then. A failed unlink of the dropping name after the link is no failure: it is only another name of that file, which the next run drops; the dropping note of the move is dropped only once that name is empty ({@link dropNoteUnlessDropping}), so the copy a failed unlink leaves there stays provable.
 * @example
 * await putTrackedBack(rollbackContext, aside.droppingPath, aside.moved) // pending.json.rollback stands again, also on an exFAT storage folder
 */
async function putTrackedBack(
  context: Context,
  droppingPath: string,
  moved: InspectedCopy,
): Promise<void> {
  const dropping = await lstatOrAbsent(droppingPath)
  // The moved file is gone from the dropping name too: another program took it, and nothing is left to put back.
  if (!dropping) throw journalConflictError(context, 'gone')
  // Only the version this run moved goes back: another file at the dropping name stays there, named.
  if (!showsChecked(dropping, moved)) throw droppingChangedError(context)
  try {
    await link(droppingPath, context.pendingPath)
  } catch (linkError) {
    // Storage that gives no file a second name: the moved file goes back by a rename once a last look finds the record's name empty; a folder there (whose link fails the same way) never takes the record's name.
    if (NO_LINK_CODES.has(codeOf(linkError)) && dropping.isFile())
      return renameTrackedBack(context, droppingPath, dropping)
    // A file at the record's name stays, and so does the moved one; a link that failed otherwise leaves the moved file at the dropping name.
    throw isNameEmptyNow(context.pendingPath)
      ? recordNotBackError(context)
      : bothRecordNamesError(context)
  }
  // Both names must show the moved file before the dropping name goes.
  const { ino } = dropping
  if (
    !(await isNameStill(context, context.pendingPath, { ino })) ||
    !(await isNameStill(context, droppingPath, { ino, isShared: true }))
  )
    throw bothRecordNamesError(context)
  await unlink(droppingPath).catch(() => undefined)
}

/**
 * Puts a tracked record back at its empty name with a rename where the storage gives no file a second name ({@link NO_LINK_CODES}), so a record a rewrite or delete moved to its dropping name never stays there for good and every later run refuses; called only by {@link putTrackedBack} once its link was refused for that reason.
 * The refused link was awaited, so both names are looked at again through the thread pool and then synchronously, the record's name first: it must be empty, and the dropping name must still show the file the put-back's first look found there; nothing is awaited between those looks and the rename.
 * Limit: a file another program puts at the record's name between that last look and the rename is replaced, and one swapped in at the dropping name then moves to the record's name (no Node primitive moves a name without replacing what stands at the other where links fail; {@link claimWithoutLinks} accepts the same).
 * @param context - The run; its pending path is the record, its seam is called around the dropping name's look ({@link nameStateNow}).
 * @param droppingPath - The dropping name ({@link droppingPathOf}).
 * @param moved - The dropping name as the put-back's first look saw it: its inode, size and times must still show.
 * @throws The refusal naming both names ({@link bothRecordNamesError}) when a file stands at the record's name, which stays, and so does the moved one; the {@link droppingChangedError} when the dropping name no longer shows that file or cannot be looked at, which stays; what the rename throws.
 * @example
 * await renameTrackedBack(rollbackContext, droppingPath, moved) // pending.json.rollback stands again on an exFAT storage folder; its dropping name is gone
 */
async function renameTrackedBack(
  context: Context,
  droppingPath: string,
  moved: LeftoverLookback,
): Promise<void> {
  // A storage that already stalls holds this step here, not at the synchronous looks below, which come in the same order.
  await lookAheadAt([context.pendingPath, droppingPath])
  // A file came to the record's name: it is never replaced, and the moved one stays where it is.
  if (!isNameEmptyNow(context.pendingPath)) throw bothRecordNamesError(context)
  // Only the file the first look found at the dropping name goes back.
  if (nameStateNow(context, droppingPath, moved) !== 'still')
    throw droppingChangedError(context)
  await rename(droppingPath, context.pendingPath)
}

/**
 * Settles the dropping names of the tracked records at the start of every locked run, before anything reads any of them: the rollback record's, then the setup record's, then that of Codebook's record of the entry, which its rewrite and delete move aside too ({@link replaceReceipt}, {@link dropReceipt}) ({@link settleDroppedRecord}); called by {@link inLockedFolder}, so a rollback record's settlement never reads or marks a setup record that a stopped move left at its dropping name ({@link settleRollbackJournal}), the inspection's read finds the record it decides on where it stands ({@link inspect}), and no read of `receipt.json` takes a record a stopped move left aside for a missing one.
 * @param context - The locked run; its pending path is the setup record.
 * @throws What {@link settleDroppedRecord} throws; the run goes no further then.
 * @example
 * await settleDroppedRecords(context) // pending.json stands again after a stop inside its move
 * await settleDroppedRecords(context) // receipt.json stands again after a stop inside a removal's move of it
 */
async function settleDroppedRecords(context: Context): Promise<void> {
  await settleDroppedRecord(rollbackContextOf(context))
  await settleDroppedRecord(context)
  await settleDroppedRecord(receiptTrackedContextOf(context))
}

/**
 * Settles what a rewrite or delete of a tracked record left at its dropping name ({@link moveTrackedAside}) when the run stopped inside that step: beside an empty record name the file goes back there only while it is the record the dropping note names ({@link putNotedRecordBack}), and any other file stays there, named; when it is only another name of the file at the record's name, that name goes; when the note proves it to be the old version of a rewrite that stopped right after it published the new record the note names, it goes while a read of the record's name finds that new record, its inode and bytes ({@link dropAsideRecord}), as that rewrite would have deleted it, and when it proves it to be Codebook's record of the entry that a delete moved there, it goes only while that delete cannot leave the config's entry without a record that owns it ({@link finishProvenStep}); beside any other file, even one with the same bytes on another inode, both stay and the run refuses, naming both, so neither is ever deleted. A dropping note beside an empty dropping name names nothing and goes. Called by {@link settleDroppedRecords}.
 * The looks wait for the file system without holding the extension host's thread ({@link isNameStill}), the record's name first and the dropping name last, right before its unlink.
 * Limit: a swap at either name between the last look and the unlink is not seen; no Node primitive unlinks by inode.
 * @param context - The run; its pending path is the record.
 * @throws The refusal naming both names ({@link bothRecordNamesError}) when another file stands at the record's name; what {@link putNotedRecordBack} and {@link finishProvenStep} throw; what a look or the unlink throws other than for a missing name.
 * @example
 * await settleDroppedRecord(rollbackContextOf(context)) // pending.json.rollback stands again after a stop right after its move
 * await settleDroppedRecord(rollbackContextOf(context)) // pending.json.rollback.codebook-dropping is gone after a stop right after a rewrite published its new record
 */
async function settleDroppedRecord(context: Context): Promise<void> {
  const droppingPath = droppingPathOf(context)
  const dropping = await lstatOrAbsent(droppingPath)
  // Nothing at the dropping name: a note a run left beside it names no file any more.
  if (!dropping) return dropDroppingNote(context)
  const record = await lstatOrAbsent(context.pendingPath)
  // Nothing at the record's name: only the record the note names goes back there.
  if (!record) return putNotedRecordBack(context)
  // Another name of the record's own file, as a put-back that stopped before its unlink leaves it: only that name goes.
  const { ino } = dropping
  if (
    record.ino === ino &&
    (await isNameStill(context, context.pendingPath, { ino })) &&
    (await isNameStill(context, droppingPath, { ino, isShared: true }))
  ) {
    await unlink(droppingPath).catch((error: unknown) => {
      // A second name another program removed first is gone as this step wanted.
      if (codeOf(error) !== 'ENOENT') throw error
    })
    return dropDroppingNote(context)
  }
  // A step the dropping note proves is finished as that step would have ended; any other file beside the record keeps both.
  if (await finishProvenStep(context, droppingPath))
    return dropDroppingNote(context)
  throw bothRecordNamesError(context)
}

/** A receipt read through one open file ({@link readReceiptAt}): the parsed record, the open file's look a last synchronous look compares, and the SHA-256 of the very bytes that were parsed. */
type ReadReceipt = {
  receipt: Receipt
  look: RecordLook
  sha256: string
}

/**
 * Reads a receipt at one record name through one open file, so the bytes that decide ownership and the look that later proves the same file still stands there come from that one read; called by {@link finishProvenReceiptDelete} for the moved record and for the record standing at `receipt.json`.
 * @param context - The run.
 * @param path - The record file to read.
 * @returns The parsed receipt, its open file's look and those bytes' hash; undefined when nothing stands there, the file cannot be read or its bytes are no receipt. Every caller treats that as no proof, never as a file to delete.
 * @example
 * await readReceiptAt(context, context.receiptPath) // => { receipt, look: { ino: 42n, … }, sha256: '9f86…' }
 */
async function readReceiptAt(
  context: Context,
  path: string,
): Promise<ReadReceipt | undefined> {
  const looked = await readLookedRecord(context, path)
  if (
    looked === undefined ||
    looked === 'unread' ||
    looked.read === 'other' ||
    looked.sha256 === undefined
  )
    return undefined
  return { receipt: looked.read, look: looked.look, sha256: looked.sha256 }
}

/**
 * Reads the moved record at its dropping name and accepts it only as the very file the dropping note proved: same inode and same bytes, now parsed as a receipt; called only by {@link finishProvenReceiptDelete}, because ownership must be taken from the file whose delete is being decided, never assumed from the note alone.
 * @param context - The run.
 * @param droppingPath - The dropping name ({@link droppingPathOf}).
 * @param moved - The dropping name as {@link provenDroppedRecord} inspected it.
 * @returns The parsed receipt and the look of the file the note names; undefined when that file cannot be read as a receipt or no longer is the file the note names. The interrupted delete then keeps both files instead of guessing.
 * @example
 * await readProvenDroppedReceipt(context, droppingPath, proof.moved) // => { receipt, look, sha256 }
 */
async function readProvenDroppedReceipt(
  context: Context,
  droppingPath: string,
  moved: InspectedCopy,
): Promise<ReadReceipt | undefined> {
  const read = await readReceiptAt(context, droppingPath)
  // The note proved bytes, not ownership: only the parsed bytes of that same file can tell which entry the delete is about.
  if (
    read === undefined ||
    read.sha256 !== moved.sha256 ||
    read.look.ino !== moved.ino
  )
    return undefined
  return read
}

/**
 * Deletes the moved receipt whose interrupted delete is proven safe, while the config whose entry decided that safety is still the same file right before the unlink; called only by {@link finishProvenReceiptDelete}.
 * When the standing receipt is part of the proof (it owns the entry the moved receipt also owns), its name is bound too and rechecked synchronously after the config and before the dropping name, with nothing awaited between those looks and the unlink. The residual syscall gap is the one this module accepts throughout: no Node primitive unlinks by inode.
 * @param context - The run; its pending path is `receipt.json` here.
 * @param aside - The moved receipt at its dropping name.
 * @param boundConfig - The config identity whose entry decided the delete ({@link BoundConfig}); `absent` when no config stood.
 * @param standing - The standing receipt that owns the entry, when the delete rests on it; undefined when the entry the moved receipt owns is out of the config.
 * @throws The {@link unfinishedReceiptDeleteError} when either bound name no longer shows what decided the delete; what {@link unlinkMovedRecord} throws.
 * @example
 * await unlinkProvenReceiptDelete(context, aside, look.identity, standing) // the dropping name goes while the config and receipt.json still stand as read
 */
async function unlinkProvenReceiptDelete(
  context: Context,
  aside: AsideRecord,
  boundConfig: BoundConfig,
  standing?: ReadReceipt,
): Promise<void> {
  const names = standing
    ? [context.path, context.receiptPath, aside.droppingPath]
    : [context.path, aside.droppingPath]
  // A storage that already stalls holds this step here, not at the synchronous looks below, which come in the same order.
  await lookAheadAt(names)
  await unlinkMovedRecord(context, aside, () => {
    // The entry was read from this exact config file; another config decides anew on the next run.
    if (!isConfigStill(context, boundConfig))
      throw unfinishedReceiptDeleteError(context)
    // When the standing receipt is the remaining proof of ownership, only that very file may cover the delete.
    if (
      standing &&
      nameStateNow(context, context.receiptPath, standing.look) !== 'still'
    )
      throw unfinishedReceiptDeleteError(context)
  })
}

/**
 * Finishes the interrupted delete of Codebook's record of the entry only when deleting the moved receipt cannot orphan the entry it owns; called only by {@link finishProvenStep} for the receipt's dropping name.
 * The moved bytes themselves are parsed as receipt A. The delete is safe exactly when A is bound to this config ({@link receiptTargetsConfig}) and either A does not own the config's current `codebook` entry, or the receipt B standing at `receipt.json` is bound to this config and owns that same entry; unreadable or unparsable bytes, an unreadable config, a moved or standing receipt of another config, and a config or standing receipt that changes before the unlink all keep both files and refuse, because they prove neither half of that disjunction.
 * @param context - The run; its pending path is `receipt.json` here.
 * @param aside - The moved receipt at its dropping name.
 * @throws The {@link unfinishedReceiptDeleteError} when ownership cannot be proven safe; what {@link unlinkProvenReceiptDelete} throws.
 * @example
 * await finishProvenReceiptDelete(receiptTrackedContextOf(context), aside) // the interrupted removal's record goes because the standing receipt owns the restored entry
 */
async function finishProvenReceiptDelete(
  context: Context,
  aside: AsideRecord,
): Promise<void> {
  const moved = await readProvenDroppedReceipt(
    context,
    aside.droppingPath,
    aside.moved,
  )
  // Without the moved record's own bytes there is no ownership proof; deleting on the note alone could orphan the entry.
  if (!moved) throw unfinishedReceiptDeleteError(context)
  // A copied storage folder may hold another config's interrupted delete: only this config's own moved record can be finished here.
  if (!receiptTargetsConfig(context, moved.receipt))
    throw unfinishedReceiptDeleteError(context)
  let look: ConfigLook
  try {
    look = await lookAtConfig(context)
  } catch {
    // A config that cannot be read proves neither that the entry is out nor which record owns it.
    throw unfinishedReceiptDeleteError(context)
  }
  const entry = currentEntryOf(look)
  const boundConfig = look.kind === 'present' ? look.identity : 'absent'
  // The entry the moved receipt owns is not the one the config holds: deleting its old record cannot orphan that entry.
  if (!ownsEntry(entry, moved.receipt))
    return unlinkProvenReceiptDelete(context, aside, boundConfig)
  const standing = await readReceiptAt(context, context.receiptPath)
  // Only this config's own standing receipt that owns the same entry is the remaining proof that entry is Codebook's; the same entry bytes under another config's record prove nothing here.
  if (
    !standing ||
    !receiptTargetsConfig(context, standing.receipt) ||
    !ownsEntry(entry, standing.receipt)
  )
    throw unfinishedReceiptDeleteError(context)
  await unlinkProvenReceiptDelete(context, aside, boundConfig, standing)
}

/**
 * Finishes at the run start the step that the dropping note proves stopped with its record at the dropping name beside a file at the record's name; called only by {@link settleDroppedRecord}, once that file is no second name of the moved one.
 * A rewrite that stopped right after it published the new record the note names deletes its old version while a read of the record's name finds that new record, its inode and bytes ({@link dropAsideRecord}), as that rewrite would have. A delete of Codebook's record of the entry ({@link dropReceipt}), whose note names no published record, deletes the moved record only after its own bytes prove which entry that record owns and only while deleting it cannot leave that entry without a record that owns it ({@link finishProvenReceiptDelete}); a standing record that owns the same entry (for example one an older Codebook version, which knows no dropping name, wrote at the emptied name) still lets the interrupted delete finish. Any other step is not finished: the deletes of the rollback record and of the setup record, and a rollback record's hold ({@link whileJournalHeld}), keep the moved file, which may be the only proof of a take-back.
 * @param context - The run; its pending path is the record.
 * @param droppingPath - The dropping name ({@link droppingPathOf}).
 * @returns `true` once that step is finished and nothing of it stands at the dropping name; `false` when the note proves no such step, so both files stay.
 * @throws What {@link dropAsideRecord}, {@link finishProvenReceiptDelete} and {@link unlinkMovedRecord} throw.
 * @example
 * await finishProvenStep(rollbackContextOf(context), droppingPath) // => true; the old version a rewrite moved there is gone beside the new record it published
 * await finishProvenStep(receiptTrackedContextOf(context), droppingPath) // => true; the record a removal's delete moved there is gone, the receipt an older window wrote at receipt.json stays
 */
async function finishProvenStep(
  context: Context,
  droppingPath: string,
): Promise<boolean> {
  const proof = await provenDroppedRecord(context)
  if (!proof) return false
  const aside: AsideRecord = { droppingPath, moved: proof.moved }
  // The old version a rewrite moved there, beside the new record it names: a rewrite that stopped right after its publication, whose old version now goes, while the record's name still shows that new record.
  if (proof.published) {
    await dropAsideRecord(context, aside, proof.published)
    return true
  }
  // Only Codebook's record of the entry has such a delete; any other moved record stays.
  if (context.pendingPath !== context.receiptPath) return false
  await finishProvenReceiptDelete(context, aside)
  return true
}

/**
 * Puts the file at a tracked record's dropping name back at the record's empty name at the run start only while that file, read through one open file, is the version the dropping note names ({@link provenDroppedRecord}): the record a run that stopped inside its move left there; called only by {@link settleDroppedRecord}, so a file a backup or sync tool put at the dropping name after that stop, or after a run that refused over it, never becomes Codebook's record.
 * Once the record stands at its name again the note goes only while nothing stands at the dropping name any more ({@link dropNoteUnlessDropping}): a put-back whose unlink of that name failed leaves the record's second name there, and only the note proves that copy once the record's own name is lost, so the next run never refuses Codebook's own record as a file it cannot prove.
 * Limit: those of {@link putTrackedBack}, whose look must still find the file that read found.
 * @param context - The run; its pending path is the record.
 * @throws The {@link unprovenDroppingError} when no note proves that file: it stays where it is, and nothing is changed; what {@link putTrackedBack} throws.
 * @example
 * await putNotedRecordBack(rollbackContext) // pending.json.rollback stands again after a stop right after its move
 * await putNotedRecordBack(rollbackContext) // throws the refusal naming the dropping name once a backup replaced the record there
 */
async function putNotedRecordBack(context: Context): Promise<void> {
  const proof = await provenDroppedRecord(context)
  // A file no note proves (another program's, or the record with another inode or other bytes) never goes back as the record: it stays, named.
  if (!proof) throw unprovenDroppingError(context)
  await putTrackedBack(context, droppingPathOf(context), proof.moved)
  // The record stands at its name again: the note of its move names nothing any more, unless the dropping name still holds the record's second name (its unlink failed), which only the note proves once the record's own name is lost.
  await dropNoteUnlessDropping(context)
}

/**
 * The refusal of a run start that finds a file at a tracked record's dropping name beside an empty record name and cannot prove by the dropping note that it is the record Codebook moved there ({@link putNotedRecordBack}): that file stays where it is, never goes back as the record, and the run goes no further. Its way out moves that file away, after which the next run finds neither name holding a record.
 * @param context - The run; its pending path is the record, its retry ends the sentence.
 * @returns The `changed` {@link JournalConflictError}, not thrown yet.
 * @example
 * throw unprovenDroppingError(rollbackContext) // 'Codebook found a file at …/pending.json.rollback.codebook-dropping, …'
 */
function unprovenDroppingError(context: Context): JournalConflictError {
  const { pendingPath, retry } = context
  const droppingPath = droppingPathOf(context)
  return new DroppingNameConflictError(
    `Codebook found a file at ${droppingPath}, the private name it moves its record at ${pendingPath} to while it rewrites or deletes it, and nothing at ${pendingPath}, but cannot tell that this file is the record it moved there (a backup or sync tool may have replaced it), so it did not put it back at ${pendingPath}, left it as it is and went no further; look at ${droppingPath} before you use it, move it to another folder and keep it, ${retry}.`,
    'changed',
  )
}

/**
 * The refusal of a tracked record whose name and dropping name both hold a file ({@link moveTrackedAside}, {@link settleDroppedRecord}): Codebook cannot tell which holds its record, so both stay and the run goes no further. Its way out moves the file at the dropping name away when the file at the record's name is the record to keep using, and the file at the record's name away otherwise, after which the next run puts the file at the dropping name back only while the dropping note proves it is the record Codebook moved there ({@link putNotedRecordBack}); a file another program put there stays, named ({@link unprovenDroppingError}).
 * @param context - The run; its pending path is the record, its retry ends the sentence.
 * @returns The `changed` {@link JournalConflictError}, not thrown yet.
 * @example
 * throw bothRecordNamesError(rollbackContext) // 'Codebook found its record at …/pending.json.rollback and another file at …/pending.json.rollback.codebook-dropping, …'
 */
function bothRecordNamesError(context: Context): JournalConflictError {
  const { pendingPath, retry } = context
  const droppingPath = droppingPathOf(context)
  return new DroppingNameConflictError(
    `Codebook found its record at ${pendingPath} and another file at ${droppingPath}, the private name it moves that record to while it rewrites or deletes it (a run of Codebook that stopped in that moment, or a backup or sync tool, may have left one of them), and cannot tell which of the two holds its record, so it left both as they are and went no further; look at both before you use either; if the file at ${pendingPath} is Codebook's record you want to keep using, move the file at ${droppingPath} to another folder and keep it, ${retry}; otherwise move the file at ${pendingPath} to another folder and keep it, ${retry}, and that run puts the file at ${droppingPath} back at ${pendingPath} only if it is the record Codebook moved there.`,
    'changed',
  )
}

/**
 * The refusal of an interrupted delete of Codebook's record of the entry whose completion cannot be proven safe ({@link finishProvenReceiptDelete}): the moved record and the file at `receipt.json` both stay, because deleting the moved one without an ownership proof could leave the config's entry without the one file that proves it Codebook's.
 * Its way out moves the file at `receipt.json` aside: the next run then finds that name empty and puts the proven moved record back there ({@link putNotedRecordBack}), so the entry is managed again and a removal can decide afresh.
 * @param context - The run; its pending path is `receipt.json`, its retry ends the way out.
 * @returns The `changed` {@link JournalConflictError}, not thrown yet.
 * @example
 * throw unfinishedReceiptDeleteError(receiptTrackedContextOf(context)) // 'Codebook found at …/receipt.json.codebook-dropping its record of the "codebook" entry …'
 */
function unfinishedReceiptDeleteError(context: Context): JournalConflictError {
  const { path, receiptPath, retry } = context
  const droppingPath = droppingPathOf(context)
  return new DroppingNameConflictError(
    `Codebook found at ${droppingPath} its record of the "${SERVER_NAME}" entry in Devin Desktop's MCP config at ${path}, the private name it moves that record to while it deletes it, beside a file at ${receiptPath}, but it cannot confirm either that the entry that record owns is not the one the config holds, or that the file at ${receiptPath} owns that entry, so deleting the moved record could leave the entry without the one file that proves it Codebook's; Codebook left both files as they are and went no further; move the file at ${receiptPath} to another folder, ${retry}; that run puts the file at ${droppingPath} back at ${receiptPath}, so the entry is managed again and the removal can be retried.`,
    'changed',
  )
}

/**
 * The refusal of a tracked record that stands at its dropping name and could not go back to its empty name ({@link putTrackedBack}) because the link failed for another reason than storage without hard links (which a rename puts back, {@link renameTrackedBack}): it stays there, named, and the run goes no further.
 * @param context - The run; its pending path is the record, its retry ends the sentence.
 * @returns The `gone` {@link JournalConflictError}, not thrown yet.
 * @example
 * throw recordNotBackError(rollbackContext) // 'Codebook moved its record at …/pending.json.rollback to …/pending.json.rollback.codebook-dropping, …'
 */
function recordNotBackError(context: Context): JournalConflictError {
  const { pendingPath, retry } = context
  const droppingPath = droppingPathOf(context)
  return new DroppingNameConflictError(
    `Codebook moved its record at ${pendingPath} to ${droppingPath}, the private name it moves that record to while it rewrites or deletes it, and could not move it back (the file system refused to give it that name again), so it left it at ${droppingPath} and went no further; move the file at ${droppingPath} back to ${pendingPath} if nothing stands there, ${retry}.`,
    'gone',
  )
}

/**
 * The refusal of a tracked record whose dropping name no longer shows the version this run moved there ({@link assertAfterMove}, {@link putTrackedBack}): another program replaced or moved that file, so what stands there is never put back at the record's name as Codebook's record; it stays, named, and the run goes no further. The next run's start puts it back only while the dropping note proves it is still that record, and names it otherwise ({@link putNotedRecordBack}).
 * @param context - The run; its pending path is the record, its retry ends the sentence.
 * @returns The `changed` {@link JournalConflictError}, not thrown yet.
 * @example
 * throw droppingChangedError(rollbackContext) // 'Codebook moved its record at …/pending.json.rollback to …/pending.json.rollback.codebook-dropping, …, and then found another file there or none …'
 */
function droppingChangedError(context: Context): JournalConflictError {
  const { pendingPath, retry } = context
  const droppingPath = droppingPathOf(context)
  return new JournalConflictError(
    `Codebook moved its record at ${pendingPath} to ${droppingPath}, the private name it moves that record to while it rewrites or deletes it, and then found another file there or none (a backup or sync tool may have replaced or moved it), so it did not move what stands there back and went no further; look at ${droppingPath} before you use it, ${retry}, and that run puts the file at ${droppingPath} back at ${pendingPath} only if it is still the record Codebook moved there and nothing stands there.`,
    'changed',
  )
}

/**
 * The refusal of a tracked record's move whose fresh private name is about to go while the dropping name no longer shows the file the link gave it ({@link settleVacatedName}): that name may then be the record's last one (a backup or sync tool may have moved or replaced the dropping name in that moment), and no run reads such a name, so it stays where it is, the record's own name stays empty and the run goes no further. Its way out moves the file at that name back to the record's empty name, after which the next run reads the record there as it was.
 * @param context - The run; its pending path is the record, its retry ends the sentence.
 * @param vacatedPath - The fresh private name the record's own name was renamed to.
 * @returns The `changed` {@link DroppingNameConflictError}, not thrown yet.
 * @example
 * throw vacatedRecordKeptError(rollbackContext, vacatedPath) // 'Codebook moved its record at …/pending.json.rollback to …/pending.json.rollback.codebook-dropping, …, so it left the record at …/pending.json.rollback.<uuid>.tmp and went no further; …'
 */
function vacatedRecordKeptError(
  context: Context,
  vacatedPath: string,
): DroppingNameConflictError {
  const { pendingPath, retry } = context
  const droppingPath = droppingPathOf(context)
  return new DroppingNameConflictError(
    `Codebook moved its record at ${pendingPath} to ${droppingPath}, the private name it moves that record to while it rewrites or deletes it, and then could not tell that the file at ${droppingPath} is still that record (a backup or sync tool may have moved or replaced it), so it left the record at ${vacatedPath} and went no further; move the file at ${vacatedPath} back to ${pendingPath} if nothing stands there, ${retry}.`,
    'changed',
  )
}

/**
 * The refusal of a tracked record's move whose fresh private name is about to go while the record's name no longer shows the file that name was just linked back to ({@link settleVacatedName}'s foreign-file branch): the file the record's name held when the move started was put back there, but that name shows it no more (a backup or sync tool may have moved or replaced it in that instant), so the fresh private name may be that file's last one, no run reads such a name, and it stays where it is, named; the run goes no further.
 * Its way out moves that file to another folder the learner keeps, after which the next run settles the record at its dropping name.
 * @param context - The run; its pending path is the record, its retry ends the sentence.
 * @param vacatedPath - The fresh private name the file at the record's name was renamed to.
 * @returns The `changed` {@link DroppingNameConflictError}, not thrown yet.
 * @example
 * throw vacatedFileKeptError(rollbackContext, vacatedPath) // 'Codebook found another file at …/pending.json.rollback while it rewrote or deleted its record there, moved it aside to …/pending.json.rollback.<uuid>.tmp and put it back at …/pending.json.rollback, but that name no longer shows it now …'
 */
function vacatedFileKeptError(
  context: Context,
  vacatedPath: string,
): DroppingNameConflictError {
  const { pendingPath, retry } = context
  return new DroppingNameConflictError(
    `Codebook found another file at ${pendingPath} while it rewrote or deleted its record there, moved it aside to ${vacatedPath} and put it back at ${pendingPath}, but that name no longer shows it now (a backup or sync tool may have moved or replaced it just now), so the file at ${vacatedPath} may be its only copy; Codebook left it there and went no further; move the file at ${vacatedPath} to another folder and keep it, ${retry}.`,
    'changed',
  )
}

/** A tracked record's bytes staged under a fresh private name beside it, and the version they publish there ({@link stageRecord}); the config's staged file has the same shape ({@link publishRoot}). */
type StagedRecord = { staged: string; version: StagedVersion }

/**
 * Writes a tracked record's complete bytes to a fresh private name beside it and reads that file's inode from its open handle; called by {@link writeTrackedJournal}, {@link claimJournal} and, for the receipt, {@link writeReceipt}, so the version this run tracks after its rename or link is the file it wrote itself, never a file another program renames in at that name afterwards, or the empty name it leaves.
 * @param path - The record's path; the staged name is `${path}.<uuid>.tmp`.
 * @param value - The complete record, written as its JSON.
 * @returns The staged name and the version it publishes: that file's inode and the SHA-256 of the bytes written.
 * @throws When the record is larger than {@link DEVIN_MCP_RECORD_LIMIT_BYTES} or the file cannot be written; the staged name then goes while it still shows the file this call created there ({@link dropFailedStage}), and another program's file there stays.
 * @example
 * await stageRecord(journalPath, journal) // => { staged: '…/pending.json.rollback.<uuid>.tmp', version: { ino: 43n, sha256: 'cd…' } }
 */
async function stageRecord(
  path: string,
  value: unknown,
): Promise<StagedRecord> {
  const bytes = JSON.stringify(value)
  if (Buffer.byteLength(bytes) > DEVIN_MCP_RECORD_LIMIT_BYTES)
    throw new Error(
      `Storage limit exceeded (${DEVIN_MCP_RECORD_LIMIT_BYTES} bytes); existing data was retained.`,
    )
  const { temporary, ...written } = await stageConfigFile(
    `${path}.${randomUUID()}.tmp`,
    bytes,
    PRIVATE_FILE_MODE,
  )
  return {
    staged: temporary,
    version: { ...written, sha256: bytesSha256(bytes) },
  }
}

/**
 * Reads a tracked record's staged name again right before the rename or link that publishes it, without holding the extension host's thread; called by {@link writeTrackedJournal}, {@link claimJournal} and {@link writeReceipt}, which then look at that name synchronously ({@link assertStagedRecordStill}), because another program may put a file at that name after the bytes were flushed.
 * @param staged - The staged name and the version this run wrote there ({@link stageRecord}).
 * @returns That file as this read saw it: inode, hash, size and times.
 * @throws A {@link leftoverReplacedError} naming the staged name when it is gone, shows another inode or other bytes, or cannot be read; nothing is published then, and the file there stays.
 * @example
 * await lookAtStagedRecord(staged) // throws once a sync tool swapped another file in at '…/pending.json.rollback.<uuid>.tmp'
 */
async function lookAtStagedRecord({
  staged,
  version,
}: StagedRecord): Promise<InspectedCopy> {
  const source = await inspectCopy(staged).catch(() => undefined)
  if (source?.ino !== version.ino || source.sha256 !== version.sha256)
    throw leftoverReplacedError(staged)
  return source
}

/**
 * Looks synchronously, once more, at a tracked record's staged name right before the rename or link that publishes it; called by {@link writeTrackedJournal}, {@link claimJournal} and {@link writeReceipt} right after their other last looks, with what {@link lookAtStagedRecord} read.
 * Limit: a file put at the staged name between this look and the rename or link is published; the check after it ({@link assertPublishedRecord}) refuses before anything that rests on the record moves.
 * @param staged - The staged name ({@link stageRecord}).
 * @param source - That file as {@link lookAtStagedRecord} read it: its inode, size and times must still show.
 * @throws A {@link leftoverReplacedError} naming the staged name when it is gone, shows another file, size or times, or cannot be looked at; nothing is published then.
 * @example
 * assertStagedRecordStill(staged, source) // throws once a sync tool swapped another file in at the staged name after its read
 */
function assertStagedRecordStill(
  { staged }: StagedRecord,
  source: InspectedCopy,
): void {
  // A look that fails proves nothing: nothing is published.
  if (!isStagedNameStill(staged, source)) throw leftoverReplacedError(staged)
}

/**
 * Checks right after a tracked record's link or rename that its name shows the file this run wrote, inode and bytes; called by {@link claimJournal} right after its publication and by {@link confirmPublished} after the cleanup that follows a write, before the version goes back, so nothing that rests on the record (a move of the config, a delete of a copy) follows a file another program put at either name meanwhile.
 * @param context - The run; its pending path is the record.
 * @param version - The version this run wrote ({@link stageRecord}).
 * @returns The record as this read saw it through its open handle (inode, hash, size and times), which {@link claimJournal}'s last synchronous look at the name compares with after its cleanup.
 * @throws A {@link JournalConflictError}: `gone` when the name is empty (another program moved the record away right after it was published), `changed` when it shows another file or other bytes, `unread` when it cannot be read; the run's tracked version does not move then ({@link writeRecord}).
 * @example
 * await assertPublishedRecord(rollbackContext, staged.version) // throws once a sync tool's file was linked in place of the staged record
 */
async function assertPublishedRecord(
  context: Context,
  version: RecordVersion,
): Promise<InspectedCopy> {
  const published = await lookAtTrackedJournal(context, version)
  // An empty name right after this run published there: another program moved that record away.
  if (!published) throw journalConflictError(context, 'gone')
  return published
}

/** What {@link dropStagedRecord} answers about the staged name it was asked to drop: `kept-unverified` only when a file may stand there but its bytes could not be read again, so nothing proves whether they are the bytes this run wrote. */
type StagedDrop = 'settled' | 'kept-unverified'

/**
 * Deletes a tracked record's staged name while it still shows the file this run wrote there with the bytes it wrote; called by {@link writeTrackedJournal} and {@link claimJournal} once their write published its bytes or failed, and by {@link writeReceipt} after its link or rename, and for the config's staged name before its link by {@link publishRoot} (its publish record refused), {@link createConfig}, {@link moveConfigAside}, {@link putDisplacedBack} and {@link linkInStaged}, so a file another program put at that name, or bytes it wrote into this run's file in place, stay.
 * The name is read through the thread pool first (inode and hash, {@link inspectCopy}), then looked at once more synchronously right before the unlink, after an awaited look at it ({@link lookAheadAt}), so an in-place write after that read is seen by its size and times. When that read fails (no file handle left, often the very failure that ended the step, or a read error), the name stays even when its status shows the inode, size and modification time this run's write left: another program can write same-size bytes into that file and set that modification time back, so only the bytes prove whose file it is.
 * Limits: a file put there, or a write into it, between the last look and the unlink is deleted; no Node primitive unlinks by inode or content. A stall that starts between the awaited look and the synchronous one holds the extension host's thread.
 * @param staged - The staged name and the version written there ({@link stageRecord}).
 * @returns `kept-unverified` when the byte read failed and the name may still hold a file; otherwise `settled` (the name is gone, deleted, or shows a file or bytes this run did not write). Best effort: a staged name that cannot be looked at or deleted after a successful read also stays, and no build reads it.
 * @example
 * await dropStagedRecord(staged) // => 'settled': '…/pending.json.rollback.<uuid>.tmp' is gone while it held this run's file and bytes
 */
async function dropStagedRecord({
  staged,
  version,
}: StagedRecord): Promise<StagedDrop> {
  let now: InspectedCopy | undefined
  try {
    const copy = await inspectCopy(staged)
    now =
      copy?.ino === version.ino && copy.sha256 === version.sha256
        ? copy
        : undefined
  } catch {
    // A read that failed proves nothing: the name stays even when its status still matches this run's write.
    return 'kept-unverified'
  }
  // Another program's file or bytes at the staged name, none, or a file this run cannot prove its own: nothing is deleted.
  if (!now) return 'settled'
  await unlinkStagedWhileStill(staged, now)
  return 'settled'
}

/**
 * Words where the staged file of a config stayed when its bytes could not be read again ({@link dropStagedRecord}); used by the pre-link cleanups of a publish, because that file may still hold the learner's servers and other servers' credentials, but its bytes are unverified, so the sentence never calls it the config and never tells the learner to drop it unseen.
 * @param staged - The staged name that stays.
 * @returns One sentence for the refusal the publish already throws.
 * @example
 * unverifiedStagedConfigSentence('/h/.config/devin/mcp_config.json.<generation>.tmp') // => 'Codebook left the file at /h/.config/devin/mcp_config.json.<generation>.tmp as it is, …'
 */
function unverifiedStagedConfigSentence(staged: string): string {
  return `Codebook left the file at ${staged} as it is, because it could not confirm that it was still the copy of Devin Desktop's MCP config Codebook had written there (it could not read that file again); look at it before you use or delete it.`
}

/**
 * Deletes the staged file of a config that was never linked while it still proves to be this run's file and bytes, and words the one case that needs the learner: a file may stand there but its bytes could not be read again, so inode, size and times alone never decide their owner ({@link dropStagedRecord}); called by the pre-link cleanups of {@link publishRoot}, {@link createConfig}, {@link moveConfigAside}, {@link putDisplacedBack} and {@link linkInStaged}.
 * @param staged - The staged name and the version written there.
 * @returns The sentence naming the file when it stayed unverified; undefined otherwise.
 * @example
 * await dropStagedConfig(staged) // => 'Codebook left the file at …/mcp_config.json.<generation>.tmp as it is, …' after EMFILE
 */
async function dropStagedConfig(
  staged: StagedRecord,
): Promise<string | undefined> {
  return (await dropStagedRecord(staged)) === 'kept-unverified'
    ? unverifiedStagedConfigSentence(staged.staged)
    : undefined
}

/**
 * Adds the sentence of a staged config file that stayed unverified to the refusal its publish already throws; the sentence goes onto that error itself, so a conflict keeps its class for the caller that words it ({@link asRecordConflict}), as {@link withKeptAdoptedReceipt} does for a receipt.
 * @param error - What the publish step throws.
 * @param note - What {@link dropStagedConfig} answered; undefined when no unverified file stayed.
 * @returns `error` with the note after its own message; `error` itself when there is no note or it is no `Error`.
 * @example
 * throw withKeptStagedConfigNote(error, note) // 'no space left on device Codebook left the file at …/mcp_config.json.<generation>.tmp as it is, …'
 */
function withKeptStagedConfigNote(
  error: unknown,
  note: string | undefined,
): unknown {
  if (note === undefined || !(error instanceof Error)) return error
  error.message = `${error.message} ${note}`
  return error
}

/**
 * Deletes a staged name only while one synchronous look still shows the file a read of it found, after an awaited look at that name ({@link lookAheadAt}); the shared end of {@link dropStagedRecord}, {@link dropFailedStage} and {@link dropLastPublishedName}, once their read found the file and bytes this run wrote there.
 * Limits: a file put there, or a write into it, between that look and the unlink is deleted; no Node primitive unlinks by inode or content. A stall that starts between the awaited look and the synchronous one holds the extension host's thread.
 * @param staged - The staged name.
 * @param read - That file as {@link inspectCopy} read it.
 * @returns Best effort, never throwing:
 * - `true` once the name no longer shows that file: deleted now, already gone, or showing another inode, which stays untouched
 * - `false` when it may still show it: the look failed, it shows that inode with other size or times, or the unlink failed; the name stays
 * @example
 * await unlinkStagedWhileStill(staged, read) // => true: the name is gone, since no sync tool wrote into that file after the read
 */
async function unlinkStagedWhileStill(
  staged: string,
  read: LeftoverLookback,
): Promise<boolean> {
  // A storage that already stalls holds this step here, not at the synchronous look below.
  await lookAheadAt([staged])
  let now: BigIntStats | undefined
  try {
    now = lstatSync(staged, { bigint: true, throwIfNoEntry: false })
  } catch {
    // A look that failed proves nothing: the name stays.
    return false
  }
  // Nothing there, or another file: nothing of that read is left at the name.
  if (now?.ino !== read.ino) return true
  // That file with other size or times (written into since the read): it stays.
  if (!showsChecked(now, read)) return false
  return didUnlink(staged)
}

/**
 * Tells, by one synchronous look, whether a staged name still shows the file as a read of it found it (inode, size and times); called by {@link assertStagedRecordStill} right before a rename or link publishes that file, and by {@link unlinkStagedWhileStill} right before its unlink, each after an awaited look at that name, the same way for `receipt.json` by {@link writeReceipt} and {@link dropReceipt} right before the rename or unlink of the receipt they read, by the look {@link coveringReceiptCheck} gives right before a first setup's old record is deleted beside it, and by {@link dropAsideRecord} for a tracked record's name and its dropping name right before that dropping name's unlink.
 * @param staged - The staged name (or `receipt.json`, or a tracked record's name).
 * @param read - That file as {@link inspectCopy} read it, or only the inode a write just published there.
 * @returns `true` when the name shows that file; `false` when it shows another file, size or times, nothing, or the look failed.
 * @example
 * isStagedNameStill(stagedPath, read) // => false once a sync tool wrote into the staged file after the read
 * isStagedNameStill(rollbackContext.pendingPath, { ino: 43n }) // => false once a sync tool moved the record just linked there away
 */
function isStagedNameStill(staged: string, read: LeftoverLookback): boolean {
  try {
    return showsChecked(
      lstatSync(staged, { bigint: true, throwIfNoEntry: false }),
      read,
    )
  } catch {
    return false
  }
}

/**
 * Tells whether a receipt is bound to this run's config, the same binding the normal receipt read applies; called by {@link readReceiptWithVersion} and by {@link finishProvenReceiptDelete}, whose recovery must never accept another config's receipt as ownership proof for this config.
 * @param context - The run.
 * @param receipt - The receipt whose target is compared.
 * @returns `true` only when the receipt names this run's config path exactly.
 * @example
 * receiptTargetsConfig(context, receipt) // => false for a receipt copied from another home folder
 */
function receiptTargetsConfig(context: Context, receipt: Receipt): boolean {
  return receipt.targetPath === context.path
}

/**
 * Reads `receipt.json` through one handle, as {@link readVersionedRecord} does, and gives the receipt together with the version of the file that read saw; called by {@link settleAfterRecovery}, whose read is the one the run's decisions rest on, so it keeps that version, and the config path a record of another config names, as {@link Context.receiptVersion}.
 * @param context - The run.
 * @returns The receipt when it covers this run's config path (undefined otherwise), the inode and bytes' hash of the file read there whatever config it covers (undefined when the name is empty), and, for a valid record of another config, the config path it names (`otherConfigPath`), so that occupied name is never taken for an empty one.
 * @throws What {@link readRecord} throws for a record that is a link, no regular file, too large, unreadable or of another shape.
 * @example
 * await readReceiptWithVersion(context) // => { receipt: { schemaVersion: 1, … }, version: { ino: 42n, sha256: 'ab…' } }
 * await readReceiptWithVersion(context) // => { version: { ino: 42n, sha256: 'ab…' }, otherConfigPath: '/Users/old/.config/devin/mcp_config.json' } after the storage folder was copied from another home folder
 */
async function readReceiptWithVersion(context: Context): Promise<{
  receipt?: Receipt
  version?: RecordVersion
  otherConfigPath?: string
}> {
  const read = await readVersionedRecord(
    context.receiptPath,
    receiptSchema,
    context.retry,
    context.seam,
  )
  if (!read) return {}
  const { record, version } = read
  return receiptTargetsConfig(context, record)
    ? { receipt: record, version }
    : { version, otherConfigPath: record.targetPath }
}

/** Why `receipt.json` may hold Codebook's record of the entry in another config; named by {@link otherConfigReceiptRefusal} and {@link keptReceiptSentence}. */
const OTHER_HOME_CAUSE =
  "Codebook's storage folder may have been copied from another home folder"

/**
 * Stops a write of `receipt.json`, or a removal that changed nothing, while that name holds a valid record of the entry in another config ({@link Context.receiptVersion}'s `otherConfigPath`); called by {@link publishEntry} before anything is published, by {@link writeReceipt} before it stages anything, and by {@link answerRemovalWithoutTakeOut}, so that record is never written over or deleted.
 * @param context - The run; its paths and retry are named.
 * @throws The {@link otherConfigReceiptRefusal} while such a record stands there; nothing is changed then.
 * @example
 * assertNoOtherConfigReceipt(context) // throws once the storage folder holds a record of the entry in another home folder's config
 */
function assertNoOtherConfigReceipt(context: Context): void {
  const { otherConfigPath } = context.receiptVersion
  if (otherConfigPath !== undefined)
    throw otherConfigReceiptRefusal(context, otherConfigPath)
}

/**
 * Builds the refusal of a setup or removal that found at `receipt.json` Codebook's valid record of the entry in another config (as when Codebook's storage folder was copied from another home folder); thrown by {@link assertNoOtherConfigReceipt}. It is a {@link ReceiptConflictError}: its own sentence names that record, says Codebook left it as it is and gives the way out.
 * @param context - The run; its paths and retry are named.
 * @param otherConfigPath - The config path that record names.
 * @returns The error, not thrown yet.
 * @example
 * throw otherConfigReceiptRefusal(context, '/Users/old/.config/devin/mcp_config.json') // 'Codebook found at …/receipt.json, where it keeps its record of the "codebook" entry in Devin Desktop's MCP config at …, its record of that entry in the MCP config at /Users/old/.config/devin/mcp_config.json instead …'
 */
function otherConfigReceiptRefusal(
  { path, receiptPath, retry }: Context,
  otherConfigPath: string,
): ReceiptConflictError {
  return new ReceiptConflictError(
    `Codebook found at ${receiptPath}, where it keeps its record of the "${SERVER_NAME}" entry in Devin Desktop's MCP config at ${path}, its record of that entry in the MCP config at ${otherConfigPath} instead (${OTHER_HOME_CAUSE}), so it did not write over or delete that record, left it as it is and went no further; if you no longer use ${otherConfigPath}, move that record to another folder, ${retry}.`,
  )
}

/**
 * Writes Codebook's record of the entry (`receipt.json`) without ever replacing a file this run did not read there; called by {@link recordPublishedEntry}, {@link adoptPending} and {@link withInstallationId}, every write of that record.
 * A valid record of the entry in another config that the run's read found there is never written over: the write refuses before it stages anything ({@link assertNoOtherConfigReceipt}).
 * The bytes are staged and flushed under a fresh private name beside it first ({@link stageRecord}); after the seam the name is read through the thread pool ({@link receiptNameState}). While it shows the version this run read or last wrote ({@link Context.receiptVersion}), that version is noted beside it together with the version this write publishes ({@link withDroppingNote}) and then replaced through its dropping name right after the last looks still find that file ({@link publishReceipt}, {@link replaceReceipt}): it moves aside first and the new record is linked in at the emptied name, so a record another program renames over that name after the look moves instead and stays, and a run that stops with the record at its dropping name leaves the next run the proof that the file there is that version, which it puts back, or deletes beside the new record the note names once that record was published ({@link settleDroppedRecord}); while it shows nothing and no version is known (none was read there, or this run deleted it or moved it aside itself), the name is claimed ({@link claimReceiptName}), which never replaces a file; an empty name where a version is known (another program moved that record away) and anything else there stay as they are and the write is refused. The staged name goes afterwards while it shows the file this call wrote ({@link dropStagedRecord}).
 * Limits: those of {@link replaceReceipt} and {@link claimReceiptName}; a file put at the name right after the link, or while the staged name is cleaned up, is not looked at again here: a caller whose next step deletes the record of that setup reads the name again first and goes on only while it still shows the version this write published ({@link publishedReceiptCheck}: {@link recordPublishedEntry}, {@link adoptPending}), and otherwise the next write or delete of this run finds it.
 * @param context - The run; its seam is called after the bytes were flushed and before the look at the name.
 * @param value - The complete receipt.
 * @param assertStill - What else must still hold, looked at right before the move or link, after an awaited look at its names, and again after the move ({@link replaceReceipt}) or before the rename that publishes where links fail ({@link claimReceiptName}).
 * @throws The {@link otherConfigReceiptRefusal} while the run's read found a record of another config's entry there; the {@link receiptConflictError}: `changed` when the name shows another file or other bytes than the version this run read (also when that is what the move took, which then goes back), or any file while no version is known; `gone` when it shows nothing while a version is known; `unread` when it cannot be read again; the refusals of Codebook's own step at the receipt's dropping name ({@link replaceReceipt}); what the write, the seam, the look at the staged name ({@link leftoverReplacedError}), `assertStill` or the claim throws. Nothing is published then, and what stands at the name stays.
 * @example
 * await writeReceipt(context, written) // receipt.json holds `written`, or the call throws once a backup put another record there after the run read it
 */
async function writeReceipt(
  context: Context,
  value: Receipt,
  assertStill?: StillLook,
): Promise<void> {
  assertNoOtherConfigReceipt(context)
  const path = context.receiptPath
  const staged = await stageRecord(path, value)
  try {
    context.seam?.beforeRecordWrite?.({ path, record: value })
    const standing = await receiptNameState(context)
    // The record this run read, and neither deleted nor moved aside itself, is gone: its empty name is never claimed, since another program may put that record back.
    if (!standing && context.receiptVersion.current !== undefined)
      throw receiptConflictError(context, 'gone')
    const write: TrackedWrite = { staged, assertStill }
    // The version this run read is replaced through its dropping name, noted beside it first with the version this write publishes, so a run that stops with it there leaves the next run the proof of which file it moved, and of the new record beside which it goes; an empty name is claimed, and nothing moves.
    context.receiptVersion.current = standing
      ? await withDroppingNote(
          receiptTrackedContextOf(context),
          { moved: standing, published: staged.version },
          () => publishReceipt(context, standing, write),
        )
      : await publishReceipt(context, undefined, write)
  } finally {
    // After a rename the staged name is gone; after a link it is a second name of the receipt, which goes while it shows this call's file.
    await dropStagedRecord(staged)
  }
}

/**
 * Runs the last looks of a write of Codebook's record of the entry and publishes it: the version the run read is replaced through its dropping name ({@link replaceReceipt}), an empty name is claimed ({@link claimReceiptName}); called only by {@link writeReceipt}, inside the dropping note of a replacement ({@link withDroppingNote}), so that note is written before these looks and nothing is awaited between the synchronous looks and the move or link they guard.
 * The receipt's name, the caller's names and, for a replacement, the dropping name its move looks at are looked at through the thread pool and the staged name is read again, then the receipt's name, the caller's look and the staged name are looked at synchronously in that order, so a storage that already stalls holds this step in the thread pool, where the step's budget answers; a stall that starts between the two looks still holds the extension host's thread.
 * @param context - The run.
 * @param standing - `receipt.json` as {@link receiptNameState} read it: the version this run read or last wrote; undefined for an empty name that no known version stands behind.
 * @param write - The staged bytes and the caller's look ({@link TrackedWrite}).
 * @returns The version published: the staged file's.
 * @throws The `changed` {@link receiptConflictError} when the receipt's name no longer shows `standing`; what `assertStill`, the look at the staged name ({@link leftoverReplacedError}), {@link replaceReceipt} and {@link claimReceiptName} throw.
 * @example
 * await publishReceipt(context, standing, { staged, assertStill }) // => { ino: 44n, sha256: 'ef…' }; receipt.json holds the new record
 */
async function publishReceipt(
  context: Context,
  standing: InspectedCopy | undefined,
  { staged, assertStill }: TrackedWrite,
): Promise<RecordVersion> {
  const path = context.receiptPath
  // A storage that already stalls holds this step here, in the thread pool, not at the synchronous looks below, which come in the same order: the receipt's name, `assertStill`'s names, the staged name, and the dropping name a replacement's move looks at.
  await lookAheadAt([
    path,
    ...(assertStill?.names ?? []),
    ...(standing ? [receiptDroppingPathOf(context)] : []),
  ])
  const source = await lookAtStagedRecord(staged)
  if (standing && !isStagedNameStill(path, standing))
    throw receiptConflictError(context, 'changed')
  assertStill?.assert()
  assertStagedRecordStill(staged, source)
  // The version this run read is replaced through its dropping name; an empty name is claimed, never replacing what lands there meanwhile.
  return standing
    ? replaceReceipt(context, standing, { staged, assertStill })
    : claimReceiptName(context, staged, assertStill)
}

/**
 * Gives the run's context with `receipt.json` as its tracked record, so a rewrite or delete of Codebook's record of the entry moves it to its dropping name first, as a tracked record's does ({@link replaceThroughDroppingName}, {@link deleteThroughDroppingName}), and the run's start puts back what a stopped one left there ({@link settleDroppedRecord}); called by {@link writeReceipt}, {@link replaceReceipt}, {@link dropReceipt}, {@link receiptDroppingPathOf} and {@link settleDroppedRecords}.
 * Its tracker holds the version of `receipt.json` the run read or last wrote ({@link Context.receiptVersion}) and refuses an empty name while that version is known, as {@link writeReceipt} does; the conflicts the tracked record's steps meet at that name come as a {@link TrackedReceiptConflictError}, worded as the receipt's own ({@link journalConflictError}).
 * @param context - The run.
 * @returns A context whose pending path is `receipt.json`.
 * @example
 * receiptTrackedContextOf(context).pendingPath // => '…/devin-mcp/receipt.json'
 */
function receiptTrackedContextOf(context: Context): Context {
  return {
    ...context,
    pendingPath: context.receiptPath,
    journalVersion: {
      current: context.receiptVersion.current,
      refusesEmptyName: true,
    },
  }
}

/**
 * Gives the dropping name of `receipt.json` ({@link droppingPathOf}), where a rewrite or delete of Codebook's record of the entry moves it first; called by {@link writeReceipt} and {@link dropReceipt}, whose awaited looks take that name in before the move's synchronous look at it.
 * @param context - The run.
 * @returns `<storage>/devin-mcp/receipt.json.codebook-dropping`.
 * @example
 * receiptDroppingPathOf(context) // => '…/devin-mcp/receipt.json.codebook-dropping'
 */
function receiptDroppingPathOf(context: Context): string {
  return droppingPathOf(receiptTrackedContextOf(context))
}

/**
 * Replaces Codebook's record of the entry that the last looks showed as the version this run read or last wrote, through its dropping name ({@link replaceThroughDroppingName}): that record moves to `receipt.json.codebook-dropping` first and must prove there to be that version (inode and bytes), the caller's names and the staged name are looked at again, and the new record is linked in at the emptied name, which never replaces a file; the moved one goes last, while its dropping name still shows it. Called only by {@link writeReceipt}.
 * So a record a backup or sync tool renames over `receipt.json` after the last look moves instead, goes back to that name ({@link putTrackedBack}) and stays, and the write refuses; a stop between the move and the end leaves the record at its dropping name, which the next run puts back first while the dropping note {@link writeReceipt} wrote before the last looks names it, or deletes while `receipt.json` shows the new record that note names, as after a stop right after the publication ({@link settleDroppedRecords}).
 * Limits: those of {@link replaceThroughDroppingName} (a file put at the dropping name between its synchronous look and the move is replaced, a name only Codebook uses; on storage without hard links a file put at the emptied name between its last look and the rename is replaced, {@link claimWithoutLinks}).
 * @param context - The run.
 * @param standing - `receipt.json` as the last looks saw it: the version this run read or last wrote.
 * @param write - The staged bytes and the caller's look ({@link TrackedWrite}).
 * @returns The version published: the staged file's.
 * @throws The {@link receiptConflictError} (`changed`, `gone`, `unread`) for a conflict the move or the publication met at `receipt.json` ({@link TrackedReceiptConflictError}), once what moved went back; the refusals of Codebook's own step at the dropping name, which name both names ({@link bothRecordNamesError}, {@link recordNotBackError}, {@link droppingChangedError}); what `assertStill`, the look at the staged name and the link throw.
 * @example
 * await replaceReceipt(context, standing, { staged, assertStill }) // => { ino: 44n, sha256: 'ef…' }; receipt.json holds the new record
 */
async function replaceReceipt(
  context: Context,
  standing: InspectedCopy,
  write: TrackedWrite,
): Promise<RecordVersion> {
  try {
    return await replaceThroughDroppingName(
      receiptTrackedContextOf(context),
      standing,
      write,
    )
  } catch (error) {
    // A conflict at receipt.json is the receipt's own refusal; Codebook's own step at the dropping name keeps its sentence, which names both names.
    if (error instanceof TrackedReceiptConflictError)
      throw receiptConflictError(context, error.kind, error)
    throw error
  }
}

/**
 * Reads `receipt.json` through the thread pool before a write or delete of it and checks that it shows the version this run read or last wrote there ({@link Context.receiptVersion}); called by {@link writeReceipt} and {@link dropReceipt}, which look at that name once more, synchronously, right before their rename or unlink ({@link isStagedNameStill}).
 * @param context - The run.
 * @returns Undefined when nothing stands there; the file as this read saw it (inode, hash, size and times) while it shows that version.
 * @throws The {@link receiptConflictError}: `changed` when the name shows another file or other bytes (any file while no version is known), or something that is no record at all ({@link isOtherFileCause}); `unread` when reading the name fails.
 * @example
 * await receiptNameState(context) // => undefined once the receipt's name is empty
 */
async function receiptNameState(
  context: Context,
): Promise<InspectedCopy | undefined> {
  const expected = context.receiptVersion.current
  const now = await inspectCopy(context.receiptPath).catch((cause: unknown) => {
    throw receiptConflictError(
      context,
      isOtherFileCause(cause) ? 'changed' : 'unread',
      cause,
    )
  })
  // Only the version this run read or wrote is written over or deleted: whatever else stands at the name stays.
  if (now && (now.ino !== expected?.ino || now.sha256 !== expected.sha256))
    throw receiptConflictError(context, 'changed')
  return now
}

/**
 * Publishes a receipt at an empty `receipt.json` without replacing what stands there: with a link of the staged file, or, where the storage's file system gives no file a second name ({@link NO_LINK_CODES}), with a rename of the flushed staged file right after a synchronous look still finds that name empty ({@link renameIntoEmptyName}), so the name shows nothing or the whole receipt at every instant and a stop never leaves a partial receipt that every run refuses; called only by {@link writeReceipt}.
 * Limit: on such storage a file another program puts at the name between that last look and the rename is replaced (no Node primitive publishes complete bytes without replacing where links fail).
 * @param context - The run; its receipt path is the name.
 * @param staged - The flushed staged receipt and its version ({@link stageRecord}).
 * @param assertStill - What else must still hold, looked at again after a link that failed for lack of support, right before the rename.
 * @returns The version published: the staged file's.
 * @throws The {@link receiptConflictError} (`changed`) when something stands at the name, which stays as it is; what {@link renameIntoEmptyName} throws; any other failure of the link.
 * @example
 * await claimReceiptName(context, staged) // => { ino: 44n, sha256: 'ef…' }; receipt.json is a second name of the staged file
 */
async function claimReceiptName(
  context: Context,
  staged: StagedRecord,
  assertStill?: StillLook,
): Promise<RecordVersion> {
  const path = context.receiptPath
  try {
    await link(staged.staged, path)
    return staged.version
  } catch (error) {
    // Something stands at the name: it is never replaced.
    if (codeOf(error) === 'EEXIST')
      throw receiptConflictError(context, 'changed', error)
    // Only storage that gives no file a second name takes the rename; any other failure is the write's.
    if (!NO_LINK_CODES.has(codeOf(error))) throw error
  }
  return renameIntoEmptyName(path, staged, assertStill, () =>
    receiptConflictError(context, 'changed'),
  )
}

/**
 * Builds the refusal for a write of Codebook's record of the entry that found `receipt.json` no longer showing the record the run read there, or could not read it again; thrown by {@link writeReceipt}, {@link receiptNameState} and {@link claimReceiptName}, so nothing is written at that name and the run goes no further, and by the look {@link publishedReceiptCheck} gives a setup ({@link recordPublishedEntry}) once that name no longer shows the record its write published, so the setup's own record stays. A first setup takes its entry out instead of naming it ({@link takeOutUnrecordedEntry}); an update, an adoption ({@link adoptPending}) and an installation-id backfill ({@link withInstallationId}) reject with it.
 * @param context - The run; its paths and retry are named, and whether it knows a version there ({@link Context.receiptVersion}) picks the sentence for another file.
 * @param kind - `changed` for another file or other bytes there, `gone` for an empty name where the run read its record, `unread` for a read that failed.
 * @param cause - The failure behind it, kept for diagnosis and never put into the sentence.
 * @returns The error, not thrown yet.
 * @example
 * throw receiptConflictError(context, 'changed') // 'Codebook found a file at …/receipt.json, where it keeps its record of the "codebook" entry …'
 */
function receiptConflictError(
  context: Context,
  kind: JournalConflictError['kind'],
  cause?: unknown,
): Error {
  return new ReceiptConflictError(
    receiptConflictSentence(context, kind),
    cause === undefined ? undefined : { cause },
  )
}

/** The refusal {@link receiptConflictError} builds: its own sentence names `receipt.json`, says Codebook left what stands there as it is and gives the way out, so a first setup that takes its entry out keeps that sentence instead of asking the learner to make room ({@link receiptFailureEnding}). */
class ReceiptConflictError extends Error {}

/**
 * Gives the safe recovery steps when first setup or a subsequent receipt read finds a directory.
 * Only a fresh look at the receipt name can distinguish a folder holding the learner's files.
 * @example
 * const refusal = receiptFolderRefusal(context, cause)
 */
function receiptFolderRefusal(
  context: Context,
  cause: unknown,
): Error | undefined {
  if (!isFolderAt(context.receiptPath)) return undefined
  return new Error(
    `Codebook found a folder at ${context.receiptPath}, where it keeps its receipt for Devin Desktop's MCP config at ${context.path}. To keep its contents, move that folder to another folder, never delete it. Restore the matching receipt from the moved folder or a backup if you have one, or ${KEEP_ENTRY_ADVICE} in ${context.path} if that entry exists, ${context.retry}.`,
    { cause },
  )
}

/**
 * Words the refusal of a write of Codebook's record of the entry ({@link receiptConflictError}): what the run found at `receipt.json` against what it knew of that name.
 * @param context - The run; its paths and retry are named, and its known version there ({@link Context.receiptVersion}) tells a record it read from a name it found or left empty.
 * @param kind - What the run found ({@link receiptConflictError}).
 * @returns
 * - `unread`: the sentence that Codebook could not read that file again, and asks to make it readable
 * - `gone`: the sentence that nothing stands where Codebook had read its record, so it wrote no record there
 * - `changed` with no version known (none was read there, or this run deleted or moved its record away itself): the sentence that a file stands where Codebook expected none
 * - `changed` otherwise: the sentence that the file there is not the record Codebook had read
 * - either `changed` sentence when a folder stands there instead: the folder is named as one, with the way out that moves it aside intact and puts back a record it or a backup holds
 * @example
 * receiptConflictSentence(context, 'gone') // => 'Codebook found nothing at …/receipt.json, where it keeps its record of the "codebook" entry …, although it had read its record there …'
 */
function receiptConflictSentence(
  { path, receiptPath, retry, receiptVersion }: Context,
  kind: JournalConflictError['kind'],
): string {
  const where = `${receiptPath}, where it keeps its record of the "${SERVER_NAME}" entry in Devin Desktop's MCP config at ${path},`
  if (kind === 'unread')
    return `Codebook could not read ${where} again to check that it still holds the record it had read there, so it did not write over that file, left it as it is and went no further; make that file readable by you if it is not, ${retry}, and that run reads that file first.`
  // The record the run read is gone: nothing is written in its place.
  if (kind === 'gone')
    return `Codebook found nothing at ${where} although it had read its record there (a backup or sync tool may have moved it away), so it wrote no record there and went no further; wait until that tool is done, ${retry}, and that run reads that name first.`
  // This synchronous look runs in the same uninterrupted step as the last look that refused the write; a failed look cannot prove a folder, so the regular-file sentence stays.
  let folder = false
  try {
    folder =
      lstatSync(receiptPath, { throwIfNoEntry: false })?.isDirectory() === true
  } catch {
    folder = false
  }
  if (folder) {
    const mismatch =
      receiptVersion.current === undefined
        ? 'although it expected none there'
        : 'that is not the record it had read there'
    return `Codebook found a folder at ${where} ${mismatch} (a backup or sync tool may have put it there), so it did not write over that folder, left it as it is and went no further; move that folder to another folder, never delete it, because it may hold files of yours; if it or a backup holds the record that stood at ${receiptPath}, put that record back there; ${retry}, and that run reads ${receiptPath} first.`
  }
  // No record the run read stands behind that name: the file found there is none Codebook ever read.
  if (receiptVersion.current === undefined)
    return `Codebook found a file at ${where} although it expected none there (a backup or sync tool may have put an older record back), so it did not write over that file, left it as it is and went no further; wait until that tool is done, ${retry}, and that run reads that file first.`
  return `Codebook found a file at ${where} that is not the record it had read there (a backup or sync tool may have put an older one back), so it did not write over that file, left it as it is and went no further; wait until that tool is done, ${retry}, and that run reads that file first.`
}

/**
 * Runs a caller's continuity look for a path that returns before {@link deleteThroughDroppingName} would run it, and for one whose conflict exit put what the move took back without ever running it there; called by {@link dropReceipt} when the receipt cannot be read again, when nothing stands there, when its pre-move name check fails, and when the move met another file at the receipt's name and went no further ({@link TrackedReceiptConflictError}). The awaited look at the look's names comes first, as {@link StillLook} asks.
 * @param assertStill - The caller's continuity look, if any.
 * @throws What `assertStill` throws; the non-delete answer is never returned then.
 * @example
 * await lookAndAssertStill(assertStill) // throws once a backup restored the config with the entry
 */
async function lookAndAssertStill(
  assertStill: StillLook | undefined,
): Promise<void> {
  if (!assertStill) return
  await lookAheadAt(assertStill.names)
  assertStill.assert()
}

/**
 * Deletes `receipt.json` only while it shows the version the run's own read found there or its own last write published ({@link Context.receiptVersion}): the read that let a removal take its entry out or decide that nothing is Codebook's, or the adoption's receipt that goes back out; called by {@link dropReceiptAfterRemoval}, {@link answerRemovalWithoutTakeOut} and {@link withdrawAdoptedReceipt}.
 * The name is read through the thread pool ({@link receiptNameState}), the version it shows is noted beside it ({@link withDroppingNote}), and the name is then looked at once more synchronously, after an awaited look at it and at its dropping name ({@link lookAheadAt}); the record is never unlinked at its own name: it moves to its dropping name first and is deleted there only once it proves to be that version ({@link deleteThroughDroppingName}), so a record a backup or sync tool renames over `receipt.json` after the last look moves instead, goes back to that name and stays, and a stop in that moment leaves it at the dropping name, where the next run puts it back first while that note names it ({@link settleDroppedRecords}).
 * Limits: those of {@link deleteThroughDroppingName} (a file put at the dropping name between its synchronous look and the move is replaced, and a swap there between its last look and the unlink is not seen: a name only Codebook uses).
 * @param context - The run.
 * @param assertStill - What else must still hold, checked before a non-delete `kept` or `gone` answer too ({@link lookAndAssertStill}), looked at right before the move, after an awaited look at its names, and again after the move and before the unlink ({@link deleteThroughDroppingName}).
 * @returns
 * - `gone` when nothing of the receipt stands there any more: this call deleted it, or nothing stood there (also when the run read no receipt, and when another program emptied the name right before the move)
 * - `kept` when the name shows another file or other bytes, any file while the run read none, or cannot be read again, also when that is what the move took, which went back to `receipt.json`; and while the run's read found a record of another config's entry there ({@link Context.receiptVersion}'s `otherConfigPath`): what stands there stays
 * @throws What `assertStill` throws, before any answer when it no longer holds; the refusals of Codebook's own step at the dropping name, which name both names ({@link bothRecordNamesError}, {@link recordNotBackError}, {@link droppingChangedError}); what the move or the unlink throws other than for a name that is gone, once the record went back.
 * @example
 * await dropReceipt(context) // => 'kept' once a backup put a record back at receipt.json after the removal read it
 */
async function dropReceipt(
  context: Context,
  assertStill?: StillLook,
): Promise<'gone' | 'kept'> {
  // A record of another config's entry is never Codebook's to delete for this config.
  if (context.receiptVersion.otherConfigPath !== undefined) return 'kept'
  const path = context.receiptPath
  let standing: InspectedCopy | undefined
  try {
    standing = await receiptNameState(context)
  } catch {
    // Another file, other bytes or a name that cannot be read: it stays as it is, but the caller's end state must still hold before that answer.
    await lookAndAssertStill(assertStill)
    return 'kept'
  }
  if (!standing) {
    // An empty receipt name is a non-delete answer too: the caller's end state must still hold before it is reported.
    await lookAndAssertStill(assertStill)
    return 'gone'
  }
  // Should the run stop with the record at its dropping name, the next run puts back only the file the note names.
  return withDroppingNote<'gone' | 'kept'>(
    receiptTrackedContextOf(context),
    { moved: standing },
    async () => {
      // A storage that already stalls holds this step here, not at the synchronous looks below, which come in the same order: the receipt's name, the caller's names, then the dropping name the move looks at.
      await lookAheadAt([
        path,
        ...(assertStill?.names ?? []),
        receiptDroppingPathOf(context),
      ])
      // The awaited look above is this check's look-ahead; a mismatch is still no success unless the caller's end state holds.
      if (!isStagedNameStill(path, standing)) {
        assertStill?.assert()
        return 'kept'
      }
      assertStill?.assert()
      try {
        // Moved aside first and deleted there only as the version the run read, with the caller's look still holding after the move and before the unlink; a name another program emptied first is gone, as the delete wanted.
        await deleteThroughDroppingName(
          receiptTrackedContextOf(context),
          standing,
          assertStill,
        )
      } catch (error) {
        // What moved was not that version (it went back to receipt.json), or that name could not be read: what stands there stays, but the caller's end state must still hold before that answer, as before every other non-delete answer of this delete — the awaited looks inside the move are no look-ahead of this check.
        if (error instanceof TrackedReceiptConflictError) {
          await lookAndAssertStill(assertStill)
          return 'kept'
        }
        throw error
      }
      context.receiptVersion.current = undefined
      return 'gone'
    },
  )
}

/** A private file the pending record names that passed the name check, with what recovery may do to it. */
type Leftover = {
  role: JournalRole
  path: string
  /** The inode the record says the file has; a file under that name with another inode is not Codebook's. */
  ino: RecordedFileId
  /** The hash of the bytes the file must hold to be deleted; the probe holds none. */
  sha256: string | undefined
}

/** What the pending record claims about one private name before it is checked. */
type LeftoverClaim = {
  role: JournalRole
  name: string
  ino: RecordedFileId | undefined
  sha256: string | undefined
}

/**
 * Accepts one name from the pending record only when it is Codebook's own: the exact name {@link journalNameOf} builds for this config and this generation, with an inode recorded, and for the staged and displaced files the hash of their bytes.
 * @param context - The run.
 * @param generation - The generation id the record holds.
 * @param claim - The name and what the record says about it.
 * @returns The leftover with its path in the config's folder.
 * @throws A {@link journalRefusal} for a name with a path, another config's name, another generation or a missing inode or hash; nothing is touched.
 */
function acceptedLeftover(
  context: Context,
  generation: string | undefined,
  { role, name, ino, sha256 }: LeftoverClaim,
): Leftover {
  const isOwnName =
    generation !== undefined &&
    GENERATION_PATTERN.test(generation) &&
    name === journalNameOf(context.path, generation, role)
  if (!isOwnName || ino === undefined) throw journalRefusal(context)
  if (role !== 'probe' && sha256 === undefined) throw journalRefusal(context)
  return { role, path: join(dirname(context.path), name), ino, sha256 }
}

/**
 * Checks every private name the pending record holds before recovery touches any of them.
 * @param context - The run.
 * @param pending - The pending record of the interrupted run.
 * @returns The accepted leftovers: the displaced config first, then the staged file and the probe.
 * @throws A {@link journalRefusal} when one name is not Codebook's own.
 */
function journalLeftovers(context: Context, pending: Pending): Leftover[] {
  const { generation } = pending
  const claims: Array<Omit<LeftoverClaim, 'name'> & { name?: string }> = [
    {
      role: 'kept',
      name: pending.keptName,
      ino: pending.keptIno,
      sha256: pending.keptSha256,
    },
    {
      role: 'staged',
      name: pending.stagedName,
      ino: pending.stagedIno,
      sha256: pending.stagedSha256,
    },
    {
      role: 'probe',
      name: pending.probeName,
      ino: pending.stagedIno,
      sha256: undefined,
    },
  ]
  return claims.flatMap(({ name, ...rest }) =>
    name === undefined
      ? []
      : [acceptedLeftover(context, generation, { ...rest, name })],
  )
}

/** What {@link lookAtLeftover} found: nothing (the file is gone), the file, or a failure to read it. */
type LeftoverLook =
  | { kind: 'gone' }
  | { kind: 'found'; copy: InspectedCopy }
  | { kind: 'unreadable'; cause: unknown }

/** A leftover recovery could not settle, with what stopped it; it stays where it is and is named. */
type Unsettled = {
  leftover: Leftover
  cause: unknown
  /** Set when the published config that alone makes a completed change's displaced copy redundant could not be verified ({@link PublishedConfigUnprovenError}): unlike an ordinary leftover of a finished change, this copy stays tracked in the record, because it may be the last copy of the learner's other servers. */
  staysTracked?: true
  /** Set when the copy was just handed to the learner ({@link HandedCopyError}): the record turns to handed and the refusal names the copy as kept. */
  isHandedOver?: boolean
  /** The inode the handed copy's name shows when the copy is handed over ({@link unsettledOf}); the handed record names it ({@link handedRecordOf}), because a copy that only its bytes proved, or a name a sync tool swapped meanwhile, has another inode than the recorded one. */
  handedIno?: bigint
  /** Set when the handed copy's name shows another inode than recovery's first look at it ({@link unsettledOf}): a sync tool swapped another file in at the name while recovery handed the copy over, so the refusal says that the file there is no longer that copy ({@link replacedCopySentence}) instead of calling it the previous config. */
  isReplaced?: true
  /** Set by {@link inspect} when the handed record could not be written: the refusal then says that a later run may check the copy again ({@link bothFilesRefusal}) instead of promising that both paths stay. */
  isHandoverUnrecorded?: boolean
  /** Set for a copy of the previous config whose recovery a record conflict stopped ({@link JournalConflictError}): what the record that stands at that name, read back right after ({@link recordedCopyFateOf}), does with the copy, so the refusal leaves the copy to the learner only when that record no longer leads a later run to it ({@link unsettledRefusal}). */
  copyFate?: RecordedCopyFate
}

/**
 * Looks at one accepted leftover without following a link and checks its inode against the record.
 * @param context - The run.
 * @param leftover - The accepted leftover.
 * @returns What was found; a file that cannot be read is an answer, so the other leftovers still settle.
 * @param phase - The phase recovery reads the pending record in ({@link leftoverPhaseOf}): an unverified put-back's handed record counts as in progress.
 * @throws A {@link journalRefusal} when the file has another inode than the record says; an {@link otherInodeRefusal} for the displaced file while a config stands. The displaced file of a change in progress with an empty config name is accepted whatever its inode: it goes back.
 */
async function lookAtLeftover(
  context: Context,
  leftover: Leftover,
  phase: Pending['phase'],
): Promise<LeftoverLook> {
  let copy
  try {
    copy = await inspectCopy(leftover.path, context.seam)
  } catch (cause) {
    return { kind: 'unreadable', cause }
  }
  if (!copy) return { kind: 'gone' }
  if (isSameFileId(leftover.ino, copy.ino)) return { kind: 'found', copy }
  // A change still in progress whose config name is empty (the file may go back) or is another name of this very file (an interrupted put-back: the extra name is dropped); both are settled by {@link tidyLeftover}, which puts a file back only while it is still the recorded one.
  if (
    leftover.role === 'kept' &&
    phase === undefined &&
    isEmptyOrSameFile(context.path, copy.ino)
  )
    return { kind: 'found', copy }
  // A file under a Codebook name that is not the inode Codebook recorded is somebody else's; the displaced one is named with {@link LEFT_COPY_ADVICE}, which never moves it over the config that stands.
  throw leftover.role === 'kept'
    ? otherInodeRefusal(context, leftover.path)
    : journalRefusal(context)
}

/**
 * Tells whether the config name holds nothing or another name of the file with the given inode; called by {@link lookAtLeftover} for the displaced file of a change in progress.
 * @param configPath - The config name.
 * @param copyIno - The inode of the displaced file.
 * @returns `true` when nothing stands at the config name or the config has that inode; `false` when a different file stands there.
 * @example
 * isEmptyOrSameFile('/home/me/.config/devin/mcp_config.json', 42n) // => true when the name is empty
 */
function isEmptyOrSameFile(configPath: string, copyIno: bigint): boolean {
  const config = lstatSync(configPath, { bigint: true, throwIfNoEntry: false })
  return !config || config.ino === copyIno
}

/** What a later synchronous look must still see at a name: the inode, and when given the size and the times of the last read, so an in-place write that keeps the inode is seen ({@link isLeftoverStill}). */
type LeftoverLookback = {
  ino: bigint
  size?: bigint
  mtimeNs?: bigint
  ctimeNs?: bigint
  /** Set when the name must not be the file's only name at the look: the last look before a second name of a shared file is unlinked ({@link isStillSecondName}). */
  isShared?: true
}

/**
 * Tells whether a leftover's name still shows the file that was checked; called right before each link and unlink of a leftover ({@link tidyLeftover}, {@link putBackDisplaced}, {@link discardDisplaced}) and before the move that keeps a copy out of recovery's reach ({@link lookBeforeMove}), because a sync tool may swap another file in between the first look and the call.
 * Limit: a swap between this look and the syscall that follows is not seen; no Node primitive links or unlinks by inode. Every caller awaits a look at the same name right before ({@link lookAheadAt}, or a read of that name as {@link keepFromRecovery} makes), so a storage that already stalls holds that step in the thread pool; a stall that starts between the two looks still holds the extension host's thread.
 * @param context - The run; its seam is called around the look.
 * @param path - The leftover's name.
 * @param checked - The inode that was checked and, when the call deletes bytes, the size (and times) that were read; a put-back passes no size, because it accepts a recorded file whatever its bytes.
 * @returns `true` when the name shows that inode (and size); `false` when it is gone or shows another file.
 * @example
 * if (!isLeftoverStill(context, keptPath, { ino: 42n })) return 'kept'
 */
function isLeftoverStill(
  context: Context,
  path: string,
  checked: LeftoverLookback,
): boolean {
  context.seam?.beforeLeftoverCheck?.(path)
  const now = lstatSync(path, { bigint: true, throwIfNoEntry: false })
  const isStill = showsChecked(now, checked)
  if (isStill) context.seam?.afterLeftoverCheck?.(path)
  return isStill
}

/**
 * Tells whether a name still shows the file that was checked, like {@link isLeftoverStill}, without holding the extension host's thread; called by {@link assertSharedPutBackBytes} and {@link dropPutBackName}, whose name then goes only through {@link dropCheckedName}, which moves it aside and checks the moved file again, so no synchronous look right before that step is needed, by {@link settleDroppingName}, whose dropping name holds only a file the private name also reaches once its looks passed, and by {@link dropDroppingSecondName}.
 * @param context - The run; its seam is called around the look as for {@link isLeftoverStill}.
 * @param path - The name to look at.
 * @param checked - What the name must still show ({@link LeftoverLookback}).
 * @returns `true` when the name shows that inode (and size and times when given); `false` when it is gone or shows another file.
 * @throws What the look throws other than for a missing name.
 * @example
 * if (!(await isNameStill(context, keptPath, privateLook))) throw sharedBytesError(context, keptPath)
 */
async function isNameStill(
  context: Context,
  path: string,
  checked: LeftoverLookback,
): Promise<boolean> {
  return (await nameStateOf(context, path, checked)) === 'still'
}

/**
 * Looks at a name as {@link isNameStill} does, and tells a name found empty from one that shows another file; called by {@link isNameStill} and by {@link readMovedForPutBack}, whose look right before a put-back's link tells an empty private name from another file there.
 * @param context - The run; its seam is called around the look as for {@link isLeftoverStill}.
 * @param path - The name to look at.
 * @param checked - What the name must still show ({@link LeftoverLookback}).
 * @returns
 * - `still` when the name shows that inode (and size and times when given)
 * - `gone` when nothing stands at the name
 * - `changed` when it shows another file
 * @throws What the look throws other than for a missing name.
 * @example
 * await nameStateOf(context, retiredPath, movedLook) // => 'gone' after another program deleted the old record
 */
async function nameStateOf(
  context: Context,
  path: string,
  checked: LeftoverLookback,
): Promise<'still' | 'gone' | 'changed'> {
  context.seam?.beforeLeftoverCheck?.(path)
  const now = await lstat(path, { bigint: true }).catch((error: unknown) => {
    if (codeOf(error) === 'ENOENT') return undefined
    throw error
  })
  return nameStateFrom(context, path, now, checked)
}

/**
 * Looks at a name as {@link nameStateOf} does, synchronously, so nothing is awaited between this look and the step it guards; called by {@link stillnessOf}, {@link dropLinkedPrivateName}, {@link dropMovedAfterLink} and {@link lookBeforeRetiredDrop}, whose last looks come right before a first setup's old record or its private name is deleted, and by {@link lookBeforePutBackLink}, whose last look comes right before a put-back's link.
 * @param context - The run; its seam is called around the look as for {@link isLeftoverStill}.
 * @param path - The name to look at.
 * @param checked - What the name must still show ({@link LeftoverLookback}).
 * @returns
 * - `still`, `gone` or `changed` as {@link nameStateOf} answers
 * - `unread` when the look failed
 * @example
 * nameStateNow(context, retiredPath, movedLook) // => 'changed' after a sync tool put another file at the private name
 */
function nameStateNow(
  context: Context,
  path: string,
  checked: LeftoverLookback,
): 'still' | 'gone' | 'changed' | 'unread' {
  context.seam?.beforeLeftoverCheck?.(path)
  let now: BigIntStats | undefined
  try {
    now = lstatSync(path, { bigint: true, throwIfNoEntry: false })
  } catch {
    return 'unread'
  }
  return nameStateFrom(context, path, now, checked)
}

/**
 * Looks at names one after another through the thread pool and drops the answers, right before the synchronous last looks at those names decide a delete or the end of a record ({@link nameStateNow}, {@link isConfigUnchanged}, {@link isNameEmptyNow}), so a storage that already stalls stalls here, where the step's 10-second budget still answers, instead of on the extension host's thread; called by {@link standingReceiptOf}, {@link dropLinkedPrivateName}, {@link dropMovedAfterLink}, {@link lookBeforeRetiredDrop}, {@link lookBeforePutBackLink}, {@link retiredNameCheck} and {@link writeTrackedJournal} (before its last look at a tracked record, {@link assertTrackedJournalStill}).
 * The synchronous looks still decide: only they leave nothing awaited between them and the step they guard. Limit: a stall that starts between these looks and the synchronous ones still holds the thread.
 * @param paths - The names, in the order of the synchronous looks that follow.
 * @returns Resolves once every look answered, whatever it answered.
 * @example
 * await lookAheadAt([retiredPath, context.receiptPath]) // then stillnessOf(context, retiredPath, standingLook, movedLook)
 */
async function lookAheadAt(paths: readonly string[]): Promise<void> {
  // One name at a time, in the order of the synchronous looks that follow.
  for (const path of paths) await lstat(path).catch(() => undefined)
}

/**
 * Words what one look at a name found against what was checked; the shared end of {@link nameStateOf} and {@link nameStateNow}, which calls the seam after a look that passed.
 * @param context - The run; its seam is called once the name still shows the checked file.
 * @param path - The name that was looked at.
 * @param now - What the look found; undefined when nothing stands there.
 * @param checked - What the name must still show ({@link LeftoverLookback}).
 * @returns `still` when the name shows the checked file, `gone` when nothing stands there, `changed` otherwise.
 * @example
 * nameStateFrom(context, retiredPath, undefined, movedLook) // => 'gone'
 */
function nameStateFrom(
  context: Context,
  path: string,
  now: BigIntStats | undefined,
  checked: LeftoverLookback,
): 'still' | 'gone' | 'changed' {
  if (now === undefined) return 'gone'
  if (!showsChecked(now, checked)) return 'changed'
  context.seam?.afterLeftoverCheck?.(path)
  return 'still'
}

/**
 * Compares what a look at a name found with what was checked; used by {@link isLeftoverStill} and {@link isNameStill}.
 * @param now - The name's status, undefined when nothing stands there.
 * @param checked - The inode that was checked and, when given, the size and times of the last read, and whether another name must still reach the file.
 * @returns `true` when the name shows that inode with those size and times, with more than one name when `checked.isShared` is set.
 * @example
 * showsChecked(undefined, { ino: 42n }) // => false
 */
function showsChecked(
  now:
    | Pick<BigIntStats, 'ino' | 'size' | 'mtimeNs' | 'ctimeNs' | 'nlink'>
    | undefined,
  checked: LeftoverLookback,
): boolean {
  return (
    now !== undefined &&
    checked.ino === now.ino &&
    (checked.size === undefined || checked.size === now.size) &&
    (checked.mtimeNs === undefined || checked.mtimeNs === now.mtimeNs) &&
    (checked.ctimeNs === undefined || checked.ctimeNs === now.ctimeNs) &&
    (checked.isShared !== true || now.nlink > 1n)
  )
}

/** Throws the error for a leftover whose name shows another file than the one checked; the file stays untouched and {@link recoverLeftovers} names it. */
function assertLeftoverStill(
  context: Context,
  path: string,
  checked: LeftoverLookback,
): void {
  if (!isLeftoverStill(context, path, checked))
    throw leftoverReplacedError(path)
}

/** The error for a leftover whose name shows another file than the one checked ({@link assertLeftoverStill}, {@link dropPutBackName}); the file stays untouched and {@link recoverLeftovers} names it. */
function leftoverReplacedError(path: string): Error {
  return new Error(
    `The private file at ${path} is no longer the file Codebook checked (another program replaced it just now), so Codebook left it untouched.`,
  )
}

/**
 * Throws when the config name no longer shows the given inode; called right before a leftover name is unlinked while the config name is what makes that safe ({@link dropSecondName}, {@link assertConfigStillPublished}).
 * Limit: a swap between this look and the unlink is not seen.
 * @param context - The run.
 * @param ino - The inode the config name must show.
 * @param leftoverPath - The name about to be unlinked; kept and named when the check fails.
 * @throws An error naming `leftoverPath` when the config name changed.
 * @example
 * assertConfigStill(context, 42n, keptPath)
 */
function assertConfigStill(
  context: Context,
  ino: bigint,
  leftoverPath: string,
): void {
  if (!isLeftoverStill(context, context.path, { ino }))
    throw configChangedError(context, leftoverPath)
}

/**
 * Thrown by {@link configChangedError} when the config name changed while recovery read a private copy or was about to unlink it; its own text names both files and says never to copy the copy over the config, so {@link unsettledRefusal} shows it as it is instead of {@link leftCopyRefusal}'s general advice, which cannot say that the config changed during this run.
 */
class ConfigChangedError extends Error {}

/** Thrown when recovery cannot verify that the config path still holds the published inode and bytes of a completed replacement ({@link deleteRecordedLeftover}): the displaced copy may then be the last copy of the learner's other servers, so it stays tracked instead of being reported once and left to the learner. */
class PublishedConfigUnprovenError extends Error {}

/**
 * The refusal of a completed replacement's copy cleanup when the published config cannot be verified; called by {@link deleteRecordedLeftover}. Its own text already says that the copy stays tracked, so {@link unsettledRefusal} shows it as it is.
 * @param context - The run; its config path and retry are named.
 * @param copyPath - The displaced copy that stays tracked.
 * @returns The error, not thrown yet.
 * @example
 * throw publishedConfigUnprovenError(context, keptPath) // => 'Codebook could not verify that the config at … is still the file Codebook published …'
 */
function publishedConfigUnprovenError(
  { path, retry }: Context,
  copyPath: string,
): PublishedConfigUnprovenError {
  return new PublishedConfigUnprovenError(
    `Codebook could not verify that the config at ${path} is still the file Codebook published in the change its record covers, so it kept the private copy of your previous Devin MCP config at ${copyPath} (it holds the settings of your other servers) and still tracks that copy. To keep the saved settings, move the private copy to a new, unused private filename of your choice. If the active config is missing, restore the other servers and any top-level settings you want from the saved copy into a new config at ${path}. If the active config exists, preserve its edits. Finish saving or repair it until it is readable and contains valid JSON, then merge any settings you want from the saved copy. Leave Codebook’s record in place, ${retry}.`,
  )
}

/**
 * Builds the refusal for a config name that changed while a leftover was read or about to be unlinked; called by {@link assertConfigStill}, {@link assertConfigStillPublished}, {@link assertConfigUnchangedSince} and {@link dropPutBackName}, which keep the leftover.
 * @param context - The run; its config path and retry are named.
 * @param leftoverPath - The private copy that stays.
 * @returns The {@link ConfigChangedError}, not thrown yet: both files stay untouched, and the learner is asked to look at both and never to copy the private file over the config.
 * @example
 * throw configChangedError(context, keptPath) // => 'The config at … changed just now while Codebook read the private copy at …; …'
 */
function configChangedError(
  context: Context,
  leftoverPath: string,
): ConfigChangedError {
  return new ConfigChangedError(
    `The config at ${context.path} changed just now while Codebook read the private copy at ${leftoverPath}; Codebook left both files untouched. Look at both files before you use either, and never copy the private file over the config; ${context.retry}.`,
  )
}

/**
 * Throws unless the config name still shows the published staged file (inode and bytes); called by {@link tidyLeftover} after the last read of a displaced original and before it is unlinked.
 * Each synchronous look here comes right after an awaited look at the same name ({@link lookAheadAt}), so a storage that already stalls holds this step in the thread pool, where the step's budget answers; a stall that starts between the two looks still holds the extension host's thread.
 * The bytes are read again because an editor can rewrite the published file in place and keep its inode.
 * Limit: the read is async, so {@link tidyLeftover} hashes the displaced copy again after it and checks only synchronously from there; a change between that last hash and the unlink syscalls is not seen (no Node primitive unlinks by inode or content).
 * @param context - The run.
 * @param pending - The pending record; its staged hash names the published bytes.
 * @param ino - The published inode.
 * @param leftoverPath - The displaced name about to be unlinked; kept and named when the check fails.
 * @returns The config as it was read, so the caller can require its size and times unchanged right before the unlink (an in-place rewrite keeps the inode).
 * @throws An error naming `leftoverPath` when the config name shows another inode or other bytes, or is gone.
 * @example
 * await assertConfigStillPublished(context, pending, 42n, keptPath)
 */
async function assertConfigStillPublished(
  context: Context,
  pending: Pending,
  ino: bigint,
  leftoverPath: string,
): Promise<InspectedCopy> {
  // A storage that already stalls holds this step here, not at the synchronous look below.
  await lookAheadAt([context.path])
  assertConfigStill(context, ino, leftoverPath)
  const config = await inspectCopy(context.path, context.seam)
  if (!config || config.ino !== ino || config.sha256 !== pending.stagedSha256)
    throw configChangedError(context, leftoverPath)
  return config
}

/** The error for a put-back whose link produced another inode than the checked one and whose names Codebook cannot attribute: both names stay as they are. */
function unprovenLinkError(context: Context, leftoverPath: string): Error {
  return new Error(
    `After Codebook linked ${leftoverPath} to ${context.path}, the config shows another file than the one it checked and ${leftoverPath} changed again, so it cannot tell which of the two names it made and left both untouched.`,
  )
}

/** Thrown by {@link tidyLeftover} after it handed a displaced copy to the learner ({@link handOver}) because another config stands at the config name. */
class HandedCopyError extends Error {}

/** A completed replacement's original is being handed over because its settings already stand in the exact format written by withdrawal. */
class WithdrawnConfigCopyError extends HandedCopyError {}

/** Thrown by a write or delete of a tracked rollback journal ({@link Context.journalVersion}) whose name no longer shows the version this run settled or wrote (`changed`), or cannot be read again (`unread`), and by a write of a tracked publish record whose name was found empty (`gone`, {@link writeTrackedJournal}); nothing was written or deleted at that name ({@link journalConflictError}), and {@link settleRollbackJournal} ends the run with it, or {@link publishRecordConflict} words it as the publish record's. */
class JournalConflictError extends Error {
  constructor(
    message: string,
    readonly kind: 'changed' | 'unread' | 'gone',
    options?: ErrorOptions,
  ) {
    super(message, options)
  }
}

/** The {@link JournalConflictError} of Codebook's own step at a tracked record's dropping name ({@link bothRecordNamesError}, {@link recordNotBackError}), not of another program's change: its own sentence names where the record stands and the way out, so {@link settleRecordConflict} and {@link takeOutUnrecordedEntry} say it as it is instead of blaming another program's record. */
class DroppingNameConflictError extends JournalConflictError {}

/** The {@link JournalConflictError} a tracked record's step met at `receipt.json` while Codebook's record of the entry moves through its dropping name ({@link receiptTrackedContextOf}): what moved was not the version the run read, or that name was empty or could not be read again; its sentence is the receipt's own ({@link receiptConflictSentence}), so {@link writeReceipt} rethrows it as a {@link receiptConflictError} and {@link dropReceipt} answers `kept`, never as another conflict of the run's records. */
class TrackedReceiptConflictError extends JournalConflictError {}

/** Thrown by {@link dropFinishedRecord} when a removal or take-back that took the entry out finds another file at its tracked rollback record's name as it deletes that record, or cannot read that name again: the entry is out already, what stands there stays ({@link JournalConflictError}, its cause, whose `kind` it keeps), and {@link rollBackPublishedEntry} answers `took-out-record-unread` for a name it could not read and `took-out-record-taken` otherwise, so the run goes no further. */
class TakenOutConflictError extends Error {
  readonly kind: JournalConflictError['kind']

  constructor(conflict: JournalConflictError) {
    super(conflict.message, { cause: conflict })
    this.kind = conflict.kind
  }
}

/** The `record-reread` and `record-gone` refusals ({@link unmatchedJournalRefusal}): the publish record a decision read changed or disappeared before the run was done with it, so the record the run read no longer leads to the private files it names; {@link mergeWithLeftover} and {@link settleRollbackJournal} name a leftover after it, and {@link takeOutUnrecordedEntry} stops before its take-back changes the config and leaves what stands at that name ({@link assertTakeBackRecordStill}). */
class RecordConflictError extends Error {}

/**
 * Thrown by {@link assertLinkedBytes} when the put-back check failed; its own text names both paths and the state, so {@link unsettledRefusal} shows it as it is instead of {@link leftCopyRefusal}'s general advice.
 * `isHanded` is set when the config name may hold a file Codebook did not verify: the record then turns to handed, so no later run deletes the displaced name on the strength of a shared inode.
 */
class PutBackCheckError extends Error {
  constructor(
    message: string,
    readonly isHanded: boolean,
  ) {
    super(message)
  }
}

/**
 * Tells whether a recovery failure's own text names both files and what stays ({@link PutBackCheckError}, {@link ConfigChangedError}, or {@link PublishedConfigUnprovenError}), so a later refusal cannot hide the recovery paths. Called by {@link unsettledRefusal} and {@link mergeWithLeftover}.
 * @param cause - What stopped the leftover's recovery.
 * @returns Whether the learner needs the error's own two-file recovery directions.
 * @example
 * namesBothFiles(configChangedError(context, keptPath)) // => true
 * namesBothFiles(new Error('busy'))                     // => false
 */
function namesBothFiles(cause: unknown) {
  return (
    cause instanceof PutBackCheckError ||
    cause instanceof ConfigChangedError ||
    cause instanceof PublishedConfigUnprovenError
  )
}

/** Tells whether a recovery failure hands the copy to the learner ({@link HandedCopyError}, or a {@link PutBackCheckError} that left an unverified file at the config name). */
function isHandedCause(cause: unknown): boolean {
  return (
    cause instanceof HandedCopyError ||
    (cause instanceof PutBackCheckError && cause.isHanded)
  )
}

/** The refusal for a displaced file that has another inode than the record says while a config stands at the config name: it may be a newer save of the learner's, so nothing is moved or deleted and the record stays. The config that stands may hold settings that file never had, so the advice is {@link leftCopyRefusal}'s ({@link LEFT_COPY_ADVICE}), never to move that file over the config. */
function otherInodeRefusal(
  { path, pendingPath, retry }: Context,
  copyPath: string,
): Error {
  return new Error(
    `Codebook's Devin Desktop MCP record at ${pendingPath} names a private file at ${copyPath} that is not the config Codebook moved aside (it may be a newer save of yours) while another config stands at ${path}, so nothing was moved or deleted; ${LEFT_COPY_ADVICE}, then remove that record, ${retry}.`,
  )
}

/**
 * Recovers what an interrupted run left under the private names its pending record holds; called by {@link inspect} before the config is read.
 * Every name must be a bare name Codebook made beside the config with the inode the record holds, checked for all of them before any is moved, linked or deleted. Each leftover is then settled on its own: one that cannot be settled stays and is returned, and the others are still settled, unless a look at the record itself stopped it (a {@link JournalConflictError}: the record changed, disappeared or could not be read again, {@link recordStillCheck}): no leftover after that one is settled on that record's word, and the caller ends the run ({@link recoveryConflictOf}).
 * - A displaced config of a write or removal that was still in progress, while the config name is empty: it goes back with a link, which never replaces anything, only while it still has the recorded inode or the recorded bytes; a file with both different (a sync or backup tool replaced it) stays private, the config name stays empty and the refusal names it. When the config name is another name of the same file (a put-back interrupted after its link), the extra displaced name is unlinked; when only the bytes ever proved that file (another inode than the recorded one), only after the shared bytes were checked against the record ({@link assertSharedPutBackBytes}).
 * - A displaced or staged file that holds exactly the bytes the record names: it is Codebook's own leftover and is deleted. After a finished publish or removal (a completed record) it is never put back.
 * - A staged or displaced name that is another link to the config itself: unlinked, whatever the config holds now; the config keeps the inode.
 * - The probe link of the hard-link check: deleted.
 * - A copy handed to the learner (a handed record): never touched. A record handed only because a put-back by bytes was cut short ({@link Pending.bytesUnverified}) is read as in progress ({@link leftoverPhaseOf}).
 * - A displaced name of a change in progress that is gone while its dropping name stands (a drop cut short right after its rename, {@link dropCheckedName}): the file goes back to the displaced name and is settled from there ({@link lookPastCutShortDrop}). One that is another name of the config and stands beside a dropping name of that same file (that return cut short right after its link) has the dropping name dropped first ({@link dropDroppingSecondName}); a dropping name that holds another file is never moved onto or deleted, and the drop that would need it refuses naming it ({@link droppingNameTakenError}).
 * - Anything else stays and is returned.
 * @param context - The run.
 * @param pending - The pending record of the interrupted run.
 * @returns The leftovers that stay, in the order of the record.
 * @throws A {@link journalRefusal} for a name that is not Codebook's own; nothing was touched. What {@link lookPastCutShortDrop} throws, before the displaced file and the leftovers after it are settled; the record stays.
 */
async function recoverLeftovers(
  context: Context,
  pending: Pending,
): Promise<Unsettled[]> {
  const looked: Array<{ leftover: Leftover; look: LeftoverLook }> = []
  // Looking first means a bad name or inode stops the run before anything moved.
  for (const leftover of journalLeftovers(context, pending))
    looked.push({
      leftover,
      look: await lookAtLeftover(context, leftover, leftoverPhaseOf(pending)),
    })
  const unsettled: Unsettled[] = []
  for (const { leftover, look: firstLook } of looked) {
    const look = await lookPastCutShortDrop(
      context,
      leftover,
      firstLook,
      leftoverPhaseOf(pending),
    )
    if (look.kind === 'gone') continue
    try {
      if (look.kind === 'unreadable') throw look.cause
      await tidyLeftover(context, leftover, look.copy, pending)
    } catch (cause) {
      unsettled.push(await unsettledOf(context, leftover, look, cause))
      // A record that changed, disappeared or could not be read again ends the recovery: nothing after it is settled on that record's word.
      if (cause instanceof JournalConflictError) break
    }
  }
  return unsettled
}

/**
 * Finds the leftover whose recovery a record check stopped ({@link JournalConflictError}: the record changed, disappeared or could not be read again, {@link recordStillCheck}); called by {@link inspect} and {@link settleRollbackJournal} right after {@link recoverLeftovers}, which settles nothing after that leftover, so the run ends there instead of settling, rewriting or deleting that record on a later read.
 * @param unsettled - The leftovers recovery could not settle.
 * @returns The first entry whose cause is a {@link JournalConflictError}; undefined when no record check failed.
 * @example
 * recoveryConflictOf([{ leftover, cause: journalConflictError(context, 'unread') }]) // => that entry
 * recoveryConflictOf([{ leftover, cause: new Error('busy') }])                       // => undefined
 */
function recoveryConflictOf(unsettled: Unsettled[]): Unsettled | undefined {
  return unsettled.find(({ cause }) => cause instanceof JournalConflictError)
}

/**
 * Gives the look recovery settles a leftover from, after a drop of its displaced name that stopped right after its rename ({@link dropCheckedName}); called by {@link recoverLeftovers} once every leftover was looked at, so a bad name or inode still stops the run before anything moved.
 * Only a displaced name of a change in progress is ever dropped that way, so only such a name that is gone has its dropping name put back ({@link settleDroppingName}) and is looked at again; every other look is returned as it is.
 * @param context - The run.
 * @param leftover - The accepted leftover.
 * @param look - What the first {@link lookAtLeftover} found at its name.
 * @param phase - The phase recovery reads the record in ({@link leftoverPhaseOf}).
 * @returns The look at the displaced name once its file stands there again; `look` otherwise.
 * @throws What {@link settleDroppingName} and {@link lookAtLeftover} throw.
 * @example
 * await lookPastCutShortDrop(context, keptLeftover, { kind: 'gone' }, undefined) // => { kind: 'found', copy } after a stop right after the drop's rename
 */
async function lookPastCutShortDrop(
  context: Context,
  leftover: Leftover,
  look: LeftoverLook,
  phase: Pending['phase'],
): Promise<LeftoverLook> {
  if (look.kind !== 'gone' || leftover.role !== 'kept' || phase !== undefined)
    return look
  // The file stands at the displaced name again: recovery looks at it there, with every check it makes before a name goes.
  return (await settleDroppingName(context, leftover.path))
    ? lookAtLeftover(context, leftover, phase)
    : look
}

/**
 * Builds the {@link Unsettled} entry of a leftover whose recovery threw; called by {@link recoverLeftovers}.
 * @param context - The run; its pending path is the record recovery acted on, read back for a copy of the previous config whose recovery a record conflict stopped.
 * @param leftover - The accepted leftover.
 * @param look - What {@link lookAtLeftover} found at its name.
 * @param cause - What stopped its recovery.
 * @returns The entry; a copy handed to the learner ({@link isHandedCause}) also carries the inode its name shows now, which its handed record names ({@link handedRecordOf}): a sync tool may have swapped another file in at the name while recovery checked it, and a record naming the inode of the first look would refuse that file at every later run ({@link otherInodeRefusal}). That inode differing from the first look's marks the entry {@link Unsettled.isReplaced}, so the refusal never calls that file the previous config. When the name cannot be looked at (it is gone, for example), the first look's inode stays and nothing is marked. A copy of the previous config whose recovery a record conflict stopped ({@link JournalConflictError}: the record changed, disappeared or could not be read again) carries what the record that stands now does with it ({@link Unsettled.copyFate}), because a record a backup or sync tool put back may still lead a later run to delete that copy.
 * @example
 * await unsettledOf(context, leftover, { kind: 'found', copy }, sharedBytesError(context, keptPath))         // => { leftover, cause, isHandedOver: true, handedIno: 42n } (the name still shows the first look's inode 42n)
 * await unsettledOf(context, leftover, { kind: 'found', copy }, handedCopyError)                             // => { leftover, cause, isHandedOver: true, handedIno: 43n, isReplaced: true } (a sync tool swapped 43n in for 42n)
 * await unsettledOf(context, keptLeftover, { kind: 'found', copy }, journalConflictError(context, 'changed')) // => { leftover, cause, copyFate: 'tracked' } (the same record stands at a new inode)
 * await unsettledOf(context, leftover, { kind: 'found', copy }, new Error('busy'))                           // => { leftover, cause }
 */
async function unsettledOf(
  context: Context,
  leftover: Leftover,
  look: LeftoverLook,
  cause: unknown,
): Promise<Unsettled> {
  // A record conflict stopped a copy of the previous config: the record that stands now tells whether a later run may still delete that copy.
  if (cause instanceof JournalConflictError && leftover.role === 'kept')
    return {
      leftover,
      cause,
      copyFate: await recordedCopyFateOf(context, leftover.path),
    }
  if (cause instanceof PublishedConfigUnprovenError)
    return { leftover, cause, staysTracked: true }
  if (!isHandedCause(cause)) return { leftover, cause }
  // Only a found copy is ever handed over ({@link tidyLeftover}).
  const firstIno = look.kind === 'found' ? look.copy.ino : undefined
  // A look that fails proves nothing: the first look's inode stays.
  const shownIno = await lstat(leftover.path, { bigint: true }).then(
    ({ ino }) => ino,
    () => undefined,
  )
  const handedIno = shownIno ?? firstIno
  // Another inode than the first look's: a file a sync tool swapped in while recovery handed the copy over.
  const isReplaced =
    shownIno !== undefined && firstIno !== undefined && shownIno !== firstIno
  return {
    leftover,
    cause,
    isHandedOver: true,
    ...(handedIno !== undefined && { handedIno }),
    ...(isReplaced && { isReplaced }),
  }
}

/**
 * Words the one leftover a run reports: a leftover of a finished or handed change is said once ({@link completedLeftRefusal}) and then no longer tracked; one of a change in progress stays named. A copy handed over in this run whose name a sync tool swapped meanwhile ({@link Unsettled.isReplaced}) is said to be no longer that copy ({@link replacedCopySentence}), never the previous config to delete. A copy of the previous config whose recovery a record conflict stopped is worded as the record that stands leaves it ({@link Unsettled.copyFate}): while that record still names it, Codebook still tracks it and a later run deletes it ({@link LEFTOVER_CLAUSE}); when that record could not be read back, a later run may ({@link UNCONFIRMED_CLAUSE}); only a record that no longer leads a later run to it leaves it to the learner.
 * @param context - The run.
 * @param phase - The phase recovery read the pending record in ({@link leftoverPhaseOf}).
 * @param reported - The unsettled leftover to name.
 * @returns The refusal, not thrown yet.
 * @example
 * unsettledRefusal(context, 'completed', { leftover, cause: conflict, copyFate: 'tracked' })   // => 'Codebook kept a private copy … but Codebook still tracks that copy, so a later run of Codebook deletes it …'
 * unsettledRefusal(context, 'completed', { leftover, cause: conflict, copyFate: 'untracked' }) // => 'Codebook found a private file at … delete that file when you no longer need it, …'
 */
function unsettledRefusal(
  context: Context,
  phase: Pending['phase'],
  {
    leftover,
    cause,
    isHandedOver,
    isReplaced,
    isHandoverUnrecorded,
    copyFate,
  }: Unsettled,
): Error {
  // The unproven published config's own text already says that the copy stays tracked; the finished-change wording would wrongly leave it to the learner.
  if (cause instanceof PublishedConfigUnprovenError) return cause
  // The put-back check's and the changed config's own texts name both paths and the state; the move-back advice would lose a new save.
  if (namesBothFiles(cause))
    return bothFilesRefusal(cause, leftover.path, phase, isHandoverUnrecorded)
  // Another program's file stands at the handed copy's name: it is never called the previous config or advised for deletion.
  if (isReplaced)
    return new Error(
      `${changedWhileWorking(context).message} ${replacedCopySentence(leftover.path)}`,
    )
  if (cause instanceof WithdrawnConfigCopyError)
    return new Error(
      isHandoverUnrecorded
        ? `Codebook kept ${keptCopyPhrase(leftover.path)}, ${UNCONFIRMED_CLAUSE}; ${context.retry}.`
        : `When Codebook checked ${context.path}, it contained your settings in the format Codebook writes after taking out its entry. Codebook kept the original formatting in ${leftover.path} for you. Restore the settings you need from the copy if the active file is missing, or merge them with any newer edits, ${context.retry}.`,
    )
  if (isHandedOver) return newConfigRefusal(context, leftover.path)
  // A record that stands and still names the copy, or one that could not be read back, may still let a later run delete that copy: it is never left to the learner.
  if (copyFate === 'tracked' || copyFate === 'unconfirmed')
    return new Error(
      `Codebook kept ${keptCopyPhrase(leftover.path)}, ${copyFate === 'tracked' ? LEFTOVER_CLAUSE : UNCONFIRMED_CLAUSE}.`,
      { cause },
    )
  return phase
    ? completedLeftRefusal(context, leftover.path, cause)
    : leftCopyRefusal(context, leftover.path, cause)
}

/**
 * Words a leftover whose own failure text names both files and what stays ({@link namesBothFiles}); called by {@link unsettledRefusal}.
 * That text says what this run did. One sentence follows when what happens to the copy next differs from what it implies: a handover whose record could not be written (a later run may check the copy again), or a leftover of a finished or handed change, which recovery reports once and never puts back, so the learner may delete it — unless a folder stands where its file stood ({@link isFolderAt}), which the sentence asks to move to another folder, never delete it, because it may hold files of yours.
 * @param cause - The failure's own error ({@link PutBackCheckError} or {@link ConfigChangedError}).
 * @param copyPath - The private copy it names.
 * @param phase - The phase recovery read the record in ({@link leftoverPhaseOf}).
 * @param isHandoverUnrecorded - Whether the handed record of this copy could not be written ({@link Unsettled.isHandoverUnrecorded}).
 * @returns
 * - `cause` itself for a change in progress whose handover, if any, is recorded
 * - A new error of `cause`'s text and the sentence otherwise
 * @example
 * bothFilesRefusal(configChangedError(context, keptPath), keptPath, 'completed', undefined) // => '… never copy the private file over the config; … Codebook left … from a change that had already finished, so delete that file when you no longer need it.'
 */
function bothFilesRefusal(
  cause: PutBackCheckError | ConfigChangedError,
  copyPath: string,
  phase: Pending['phase'],
  isHandoverUnrecorded: boolean | undefined,
): Error {
  // No record says the copy is left to the learner, so a later run may still check it and put it back or drop it.
  if (isHandoverUnrecorded)
    return new Error(
      `${cause.message} Codebook could not record that it leaves both paths to you, so a later run may check them again and removes ${copyPath} only while the config holds the bytes Codebook kept.`,
      { cause },
    )
  // A finished or handed change's leftover is reported once and never put back; a folder where its file stood is moved aside intact, never deleted ({@link isFolderAt}).
  if (phase)
    return new Error(
      `${cause.message} Codebook left ${copyPath} from a change that had already finished, so ${
        isFolderAt(copyPath)
          ? 'move that folder to another folder, never delete it, because it may hold files of yours'
          : 'delete that file when you no longer need it'
      }.`,
      { cause },
    )
  return cause
}

/**
 * Builds the record that stays after a recovery: only the unsettled leftovers' names, inodes and hashes, so the next run retries just those.
 * @param pending - The record recovery keeps ({@link recordAfterRecovery}); its phase, and its unverified mark ({@link Pending.bytesUnverified}) while the displaced file stays tracked, carry over.
 * @param unsettled - All leftovers recovery could not settle, in the order it reports them.
 * @param phase - The phase the run read, before any handover. A finished or handed record releases the reported leftover unless its original still needs proof ({@link Unsettled.staysTracked}).
 * @returns The reduced record; undefined when nothing stays tracked.
 */
function retainedRecord(
  pending: Pending,
  unsettled: Unsettled[],
  phase: Pending['phase'],
): Pending | undefined {
  const tracked = phase
    ? unsettled.filter((entry, index) => index > 0 || entry.staysTracked)
    : unsettled
  if (tracked.length === 0) return undefined
  const roles = new Set(tracked.map(({ leftover }) => leftover.role))
  return {
    targetPath: pending.targetPath,
    createdFile: false,
    generation: pending.generation,
    phase: pending.phase,
    // The mark belongs to the displaced file of an unchecked put-back by bytes, so it stays only with that file.
    ...(roles.has('kept') &&
      pending.bytesUnverified === true && { bytesUnverified: true }),
    ...(pending.publishGeneration !== undefined && {
      publishGeneration: pending.publishGeneration,
    }),
    ...(roles.has('kept') && {
      keptName: pending.keptName,
      keptIno: pending.keptIno,
      keptSha256: pending.keptSha256,
    }),
    // The probe's inode is the staged file's; a displaced original that stays needs it too, because the next recovery tells a published staged file from an editor's newer save by it.
    ...((roles.has('staged') || roles.has('probe') || roles.has('kept')) && {
      stagedIno: pending.stagedIno,
    }),
    // A displaced original that stays needs the staged hash too: without it the next recovery cannot tell the published file from an in-place edit that kept the inode ({@link keepOriginalUnlessPublished}).
    ...((roles.has('staged') || roles.has('kept')) && {
      stagedSha256: pending.stagedSha256,
    }),
    ...(roles.has('staged') && { stagedName: pending.stagedName }),
    ...(roles.has('probe') && { probeName: pending.probeName }),
  }
}

/**
 * Ends the pending record of a settled run: it is deleted, or rewritten with only the leftovers that stay; called by {@link settleRollbackJournal} for a rollback's journal, and for `pending.json` by {@link settlePending}, {@link adoptPending} and {@link finishCutShortSetup}.
 * A settled rollback journal ({@link Context.journalVersion}) is ended only while its name still shows the version this run settled ({@link writeRecord}, {@link removeRecord}); another journal a backup restored there stays for the next run, and the call rejects. A publish record whose old record's private name this run's put-back found empty ({@link settleRetiredReceipt}) is the only pointer to that name, so it ends only while one synchronous look right before the rename or unlink still finds that name empty ({@link retiredNameCheck}), after the bytes of what stays were flushed and after a tracked record's own last look.
 * So is the publish record of a run that holds a legacy journal ({@link heldPublishContext}): it is ended only as the version that journal's decision read, what stays of it is never written back at a name found empty (a sync tool moved it away), and a rejection there is worded as that record's ({@link publishRecordConflict}).
 * @param context - The run; its pending path is the record.
 * @param retained - What stays of the record; undefined when nothing does.
 * @param assertStill - A synchronous look at other names that must still hold right before the rename or unlink ({@link retiredNameCheck}), after an awaited look at its names ({@link StillLook}); undefined when nothing else must hold.
 * @throws A {@link JournalConflictError} when a tracked journal's name shows another file or cannot be read again (the name stays as it is); what `assertStill` throws, such as the {@link retiredBackRefusal} (the record stays byte for byte and the run goes no further); what the write or delete throws.
 * @example
 * await retirePending(rollbackContext, undefined) // pending.json.rollback is gone while it held the version this run settled
 * await retirePending(context, retained, await retiredNameCheck(context, emptiedRetiredPath)) // throws, keeping pending.json, once a backup put the old record back at that name
 */
async function retirePending(
  context: Context,
  retained: Pending | undefined,
  assertStill?: StillLook,
): Promise<void> {
  if (retained)
    await writeRecord(context, context.pendingPath, retained, assertStill)
  else await removeRecord(context, assertStill)
}

/**
 * Gives the synchronous look that must still find the old record's private name empty right before a publish record that leads there ends ({@link retirePending}), once one look at that name through the thread pool answered ({@link lookAheadAt}), so a storage that already stalls stalls there, where the step's budget answers; the record's rename or unlink looks at that name through the thread pool once more right before its synchronous looks ({@link StillLook}); called by {@link settlePending} and {@link finishCutShortSetup} with what {@link settleRetiredReceipt} found, right before they call {@link retirePending}.
 * Limit: a stall that starts between that look and the synchronous one still holds the extension host's thread.
 * @param context - The run; gives the refusal's publish record path and the command to run again.
 * @param emptiedRetiredPath - The old record's private name this run's put-back found empty; undefined otherwise.
 * @returns
 * - undefined when no private name was found empty
 * - a look at that name that throws the {@link retiredBackRefusal} when a file stands there again or the look fails, otherwise
 * @example
 * await retiredNameCheck(context, undefined) // => undefined
 * (await retiredNameCheck(context, retiredPath))?.assert() // throws once a backup put the old record back at retiredPath
 */
async function retiredNameCheck(
  context: Context,
  emptiedRetiredPath: string | undefined,
): Promise<StillLook | undefined> {
  if (emptiedRetiredPath === undefined) return undefined
  // A storage that already stalls stalls in the thread pool first, where the step's budget answers.
  await lookAheadAt([emptiedRetiredPath])
  return {
    names: [emptiedRetiredPath],
    assert: (): void => {
      // A file back at the private name found empty (or a look that failed): the record that leads there stays.
      if (!isNameEmptyNow(emptiedRetiredPath))
        throw retiredBackRefusal(context, emptiedRetiredPath)
    },
  }
}

/**
 * Tells, by one synchronous look, whether nothing stands at a name; called by the look {@link retiredNameCheck} gives, after its look at that name through the thread pool ({@link lookAheadAt}), right before a publish record whose old record's private name this run found empty ends.
 * @param path - The name to look at.
 * @returns `true` when nothing stands there; `false` when anything stands there or the look failed.
 * @example
 * isNameEmptyNow('/storage/devin-mcp/receipt.json.<generation>.retired') // => false after a backup put the old record back there
 */
function isNameEmptyNow(path: string): boolean {
  try {
    return lstatSync(path, { throwIfNoEntry: false }) === undefined
  } catch {
    return false
  }
}

/**
 * Puts back or deletes one leftover; called by {@link recoverLeftovers}.
 * Each synchronous look here comes right after an awaited look at the same name ({@link lookAheadAt}), so a storage that already stalls holds this step in the thread pool, where the step's budget answers; a stall that starts between the two looks still holds the extension host's thread.
 * @param context - The run.
 * @param leftover - The accepted leftover.
 * Right before each link and unlink the name is looked at again ({@link isLeftoverStill}); a file swapped in since the first look is neither linked nor deleted. A displaced original of an unfinished change whose config name holds another file (not the published staged one) is handed to the learner ({@link handOver}) and never deleted.
 * @param copy - What {@link lookAtLeftover} found.
 * @param pending - The pending record of the interrupted run; its phase is absent while the change was in progress (also for an unverified put-back's handed record, {@link leftoverPhaseOf}).
 * @throws When the file differs from what Codebook expected, was handed to the learner, was swapped meanwhile, or the move or delete fails.
 */
async function tidyLeftover(
  context: Context,
  leftover: Leftover,
  copy: InspectedCopy,
  pending: Pending,
): Promise<void> {
  const { role, path, ino: expectedIno, sha256: expectedSha256 } = leftover
  const phase = leftoverPhaseOf(pending)
  // The probe is a link to the staged file; its inode was checked.
  if (role === 'probe') {
    // A storage that already stalls holds this step here, not at the synchronous look below.
    await lookAheadAt([path])
    assertLeftoverStill(context, path, { ino: copy.ino })
    return unlink(path)
  }
  // A copy handed to the learner is never touched, not even when the learner linked it back to the config (checked before the same-inode branch).
  if (role === 'kept' && phase === 'handed')
    throw new Error('The copy was handed to the learner.')
  await lookAheadAt([context.path])
  const config = lstatSync(context.path, {
    bigint: true,
    throwIfNoEntry: false,
  })
  // The staged or displaced name of a config that has the same inode is only another name of it (a put-back whose unlink failed, or a published staged file): drop the name, the config keeps the inode and whatever the learner wrote since.
  if (config?.ino === copy.ino)
    return dropSecondName(context, leftover, copy, phase)
  // A displaced original of an unfinished change while another config stands at the config name (an editor saved after the move-aside): it may be the only copy of the learner's other servers, so it is handed over and named, never deleted. The published staged file's inode means the change did finish, so that copy is Codebook's own leftover.
  // When the check returns, the config is the published staged file: its inode is checked again right before the unlink. A completed replacement carries that inode and those bytes in its record, so the copy is redundant only while that very file still stands; a removal that deleted the config without publishing a replacement has no staged proof in its record and keeps the old deletion rule.
  const recordedPublishedIno =
    role === 'kept' &&
    phase === 'completed' &&
    pending.stagedIno !== undefined &&
    pending.stagedSha256 !== undefined
      ? BigInt(String(pending.stagedIno))
      : undefined
  const publishedIno =
    role === 'kept' && phase === undefined && config
      ? config.ino
      : recordedPublishedIno
  if (phase === undefined && publishedIno !== undefined)
    await keepOriginalUnlessPublished(context, pending, publishedIno)
  if (
    role === 'kept' &&
    (await putBackDisplaced(
      context,
      leftover,
      pending,
      !config,
      proofOfRecordedCopy(expectedIno, copy, expectedSha256),
      copy,
    ))
  )
    return
  return deleteRecordedLeftover(context, leftover, copy, pending, publishedIno)
}

/**
 * Verifies the published config of a completed replacement before its displaced copy is deleted.
 * @param context - The run.
 * @param pending - The pending record of the interrupted run.
 * @param publishedIno - The published config's inode.
 * @param leftoverPath - The displaced copy that stays tracked when proof fails.
 * @returns The config as it was read.
 * @throws A {@link WithdrawnConfigCopyError} to preserve the original formatting, or the {@link publishedConfigUnprovenError} when recovery cannot verify either outcome.
 */
async function assertCompletedPublishStill(
  context: Context,
  pending: Pending,
  publishedIno: bigint,
  leftoverPath: string,
): Promise<InspectedCopy> {
  try {
    return await assertConfigStillPublished(
      context,
      pending,
      publishedIno,
      leftoverPath,
    )
  } catch {
    // A byte-exact restored original is redundant. Withdrawal can instead have preserved the settings but changed their formatting: keep the original bytes for the learner in that case.
    const current = await inspectCopy(context.path, context.seam).catch(
      () => undefined,
    )
    if (current && current.sha256 === pending.keptSha256) return current
    if (
      current &&
      (await showsWithdrawnSettings(
        context,
        pending,
        leftoverPath,
        current,
      ).catch(() => false))
    )
      throw new WithdrawnConfigCopyError()
    throw publishedConfigUnprovenError(context, leftoverPath)
  }
}

/**
 * Recognizes the exact config {@link takeEntryOut} writes from the recorded original, before {@link assertCompletedPublishStill} hands that original to the learner.
 * The original must still be the same readable file, with its recorded bytes and round-trippable settings. Both names are checked once more after the read.
 * @example
 * await showsWithdrawnSettings(context, pending, copyPath, current) // true for withdrawal's formatted settings
 */
async function showsWithdrawnSettings(
  context: Context,
  pending: Pending,
  copyPath: string,
  current: InspectedCopy,
): Promise<boolean> {
  const original = await lookAtConfig({ ...context, path: copyPath })
  if (
    original.kind === 'absent' ||
    original.hasLossyNumber ||
    original.sha256 !== pending.keptSha256 ||
    pending.keptIno === undefined ||
    !isSameFileId(pending.keptIno, original.identity.ino) ||
    original.servers?.[SERVER_NAME] !== undefined
  )
    return false
  // A first setup creates the servers object if missing; its withdrawal writes that empty object back. All other keys are preserved.
  const withdrawn = serializedConfig({
    ...original.root,
    mcpServers: original.servers ?? {},
  })
  if (current.sha256 !== bytesSha256(withdrawn)) return false
  await lookAheadAt([context.path, copyPath])
  return (
    isLeftoverStill(context, context.path, current) &&
    isLeftoverStill(context, copyPath, original.identity)
  )
}

/**
 * Reads a leftover again and requires the read to hold the inode and bytes recovery checked.
 * @param context - The run; its seam is called inside the read.
 * @param path - The leftover's private name.
 * @param ino - The inode recovery checked.
 * @param expectedSha256 - The bytes its record names.
 * @returns The last read, or undefined when the file went away while it was read.
 * @throws When the leftover shows another inode or other bytes.
 */
async function inspectCheckedLeftover(
  context: Context,
  path: string,
  ino: bigint,
  expectedSha256: string,
): Promise<InspectedCopy | undefined> {
  const lastLook = await inspectCopy(path, context.seam)
  if (!lastLook) return undefined
  assertLeftoverHoldsChecked(path, lastLook, ino, expectedSha256)
  return lastLook
}

/**
 * Proves the published-config conditions of recovery's copy delete and leaves the copy's last read after the last asynchronous config read.
 * @param context - The run.
 * @param leftover - The accepted leftover.
 * @param copy - What recovery first found at the leftover's name.
 * @param pending - The pending record of the interrupted run.
 * @param publishedIno - The published config's inode; undefined when no published config decides the delete.
 * @returns The published-config look when one was needed, with the copy's last read; undefined when the copy went away while it was read.
 * @throws When the published config or the copy no longer proves what recovery checked.
 */
async function verifyPublishedCopyDeletion(
  context: Context,
  leftover: Leftover,
  copy: InspectedCopy,
  pending: Pending,
  publishedIno: bigint | undefined,
): Promise<
  | {
      publishedLook: InspectedCopy | undefined
      lastLook: InspectedCopy
    }
  | undefined
> {
  const { role, path } = leftover
  // The caller proved the first read holds the record's bytes, so its hash is the checked expectation here.
  const expectedSha256 = copy.sha256
  const isCompletedPublish =
    publishedIno !== undefined &&
    leftoverPhaseOf(pending) === 'completed' &&
    role === 'kept'
  let publishedLook = isCompletedPublish
    ? await assertCompletedPublishStill(context, pending, publishedIno, path)
    : undefined
  let lastLook = await inspectCheckedLeftover(
    context,
    path,
    copy.ino,
    expectedSha256,
  )
  if (!lastLook) return undefined
  if (publishedIno !== undefined && !isCompletedPublish) {
    // A save by rename or in place may have changed the published config since the first look. Its read is async, so another writer can change the displaced copy meanwhile: the copy is hashed again after it.
    publishedLook = await assertConfigStillPublished(
      context,
      pending,
      publishedIno,
      path,
    )
    lastLook = await inspectCheckedLeftover(
      context,
      path,
      copy.ino,
      expectedSha256,
    )
    if (!lastLook) return undefined
  }
  return { publishedLook, lastLook }
}

/**
 * Deletes a leftover that holds exactly the bytes its record names, once its name, a fresh hash of it and, for a displaced original of a change that published, the published config still show what recovery checked; called by {@link tidyLeftover}.
 * Same-size overwrites keep inode and size, so the file is hashed again right before; a copy of the previous config goes only on the word of the record as recovery read it ({@link recordStillCheck}). Each synchronous look comes right after an awaited look at the same name ({@link lookAheadAt}), so a storage that already stalls holds this step in the thread pool, where the step's budget answers.
 * Limits: a swap or a write between the last synchronous look and the unlink is not seen (no Node primitive unlinks by inode or content); a stall that starts between the awaited looks and the synchronous ones holds the extension host's thread.
 * @param context - The run.
 * @param leftover - The accepted leftover; its hash is the one its record holds.
 * @param copy - What {@link lookAtLeftover} found.
 * @param pending - The pending record of the interrupted run; its staged hash names the published bytes.
 * @param publishedIno - The published config's inode for a displaced original of a change that published ({@link keepOriginalUnlessPublished}); undefined otherwise.
 * @throws When the leftover's bytes are not the ones its record names, a name no longer shows what was checked, the bytes changed, the config is no longer the published file, the record changed, or the unlink fails; the leftover stays then.
 * @example
 * await deleteRecordedLeftover(context, stagedLeftover, copy, pending, undefined) // the staged name is gone
 */
async function deleteRecordedLeftover(
  context: Context,
  leftover: Leftover,
  copy: InspectedCopy,
  pending: Pending,
  publishedIno: bigint | undefined,
): Promise<void> {
  const { role, path, sha256: expectedSha256 } = leftover
  if (copy.sha256 !== expectedSha256)
    throw new Error('The leftover file differs from what Codebook expected.')
  // A storage that already stalls holds this step here, not at the synchronous look below.
  await lookAheadAt([path])
  assertLeftoverStill(context, path, { ino: copy.ino, size: copy.size })
  const verified = await verifyPublishedCopyDeletion(
    context,
    leftover,
    copy,
    pending,
    publishedIno,
  )
  if (!verified) return
  const { publishedLook, lastLook } = verified
  // A copy of the previous config goes only on the word of the record as recovery read it: a record a sync tool put back meanwhile may hand that copy to the learner.
  const recordStill =
    role === 'kept' ? await recordStillCheck(context) : undefined
  // The awaited looks come in the order of the synchronous ones below.
  await lookAheadAt([
    ...(publishedLook ? [context.path] : []),
    ...(recordStill?.names ?? []),
    path,
  ])
  // Only synchronous looks follow: the config name first (it must also show the size and times it had at its hash: an in-place rewrite during the copy's read keeps the inode), the record, the displaced name last.
  if (publishedLook)
    assertConfigUnchangedSince(
      context,
      publishedLook,
      path,
      leftoverPhaseOf(pending) === 'completed',
    )
  recordStill?.assert()
  // The hash came from the open handle; the unlink acts on the name, which must still show that same file with the size and times it had at its last hash.
  assertLeftoverStill(context, path, lastLook)
  await unlink(path)
}

/**
 * Looks at the record recovery acts on (`pending.json` or a rollback journal, {@link Context.journalVersion}) right before recovery deletes a copy of the previous config on that record's word, drops a private name of it, or puts it back, and gives the synchronous look that must still find it right before the unlink or link; called by {@link deleteRecordedLeftover}, {@link dropSecondName}, {@link putBackDisplaced} and {@link isStillSecondName} (a drop through the dropping name, {@link dropCheckedName}), because a backup or sync tool may put back a record of the same change that hands that copy to the learner (`handed`) after recovery read it as finished or in progress, and by {@link lookBeforePutBackLink}, {@link standingReceiptOf}, {@link dropLinkedPrivateName} and {@link lookBeforeRetiredDrop} right before a later run links a first setup's old record into `receipt.json` or deletes it or its private name on the word of the publish record it read.
 * @param context - The run; its pending path is the record it tracks.
 * @returns The synchronous look at the record's name ({@link assertTrackedJournalStill}), whose name the caller looks at through the thread pool right before ({@link StillLook}); undefined when the run tracks no version of its record.
 * @throws A {@link JournalConflictError}: `changed` when the record's name shows another file or other bytes than the version recovery read or last wrote, `gone` when it shows nothing, `unread` when it cannot be read; the copy stays then, and the run goes no further once it settles that record.
 * @example
 * const recordStill = await recordStillCheck(run) // throws once a sync tool put a handed record back at pending.json
 */
async function recordStillCheck(
  context: Context,
): Promise<StillLook | undefined> {
  if (context.journalVersion?.current === undefined) return undefined
  const look = await lookAtTrackedJournal(context)
  // The record went away after recovery read it: nothing shows that the copy may go.
  if (!look) throw journalConflictError(context, 'gone')
  return {
    names: [context.pendingPath],
    assert: (): void => assertTrackedJournalStill(context, look),
  }
}

/**
 * Gives the phase recovery reads a pending record in; called by {@link recoverLeftovers}, {@link tidyLeftover}, {@link putBackDisplaced}, {@link recordAfterRecovery}, {@link settleRollbackJournal} and {@link inspect}.
 * A record that says {@link Pending.bytesUnverified} was written as handed only so that older builds never delete from it while a put-back by bytes is unchecked; this build reads it as the change in progress it is, so it checks the shared bytes and finishes the put-back.
 * @param pending - The pending record as read.
 * @returns `undefined` for an unverified put-back's record; the recorded phase otherwise.
 * @example
 * leftoverPhaseOf({ ...pending, phase: 'handed', bytesUnverified: true }) // => undefined
 * leftoverPhaseOf({ ...pending, phase: 'completed' })                     // => 'completed'
 */
function leftoverPhaseOf(pending: Pending): Pending['phase'] {
  return pending.bytesUnverified ? undefined : pending.phase
}

/**
 * Drops a staged or displaced name that is only another name of the config (the same inode): a put-back whose unlink failed, a published staged file, or a put-back that only the bytes proved and that stopped after its link, whose shared bytes are checked first; called by {@link tidyLeftover}.
 * Each synchronous look here comes right after an awaited look at the same name ({@link lookAheadAt}), so a storage that already stalls holds this step in the thread pool, where the step's budget answers; a stall that starts between the two looks still holds the extension host's thread.
 * The displaced name of a change in progress first has a dropping name beside it dropped when that is a third name of the same file ({@link dropDroppingSecondName}), as a return of a cut-short drop leaves it when it stops right after its link: otherwise that name would stay a second name of the config that no record holds.
 * The config name is checked first and the leftover name last, right before the unlink: only the syscall gap after that last look remains, and no check after the leftover's own can let a swap of that name pass. A displaced name goes only on the word of the record as recovery read it, which is looked at between the two ({@link recordStillCheck}); one that only the bytes proved goes through {@link dropCheckedName}, which looks at that record right before its own unlink.
 * @param context - The run.
 * @param leftover - The accepted leftover.
 * @param copy - What {@link lookAtLeftover} found at its name.
 * @param phase - The phase recovery reads the record in ({@link leftoverPhaseOf}).
 * @throws When either name changed since it was looked at, the shared bytes cannot be verified ({@link assertSharedPutBackBytes}) or the unlink fails; both names stay then. What {@link dropDroppingSecondName} throws; for a displaced name, a {@link JournalConflictError} when the record changed, disappeared or cannot be read ({@link recordStillCheck}), and both names stay then.
 * @example
 * if (config?.ino === copy.ino) return dropSecondName(context, leftover, copy, phase)
 */
async function dropSecondName(
  context: Context,
  leftover: Leftover,
  copy: InspectedCopy,
  phase: Pending['phase'],
): Promise<void> {
  const { role, path, ino: expectedIno, sha256: expectedSha256 } = leftover
  // Only a displaced name of a change in progress is ever dropped through a dropping name.
  if (role === 'kept' && phase === undefined)
    await dropDroppingSecondName(context, path, copy.ino)
  // Only the bytes ever proved this file: the config may hold bytes nobody checked, so the private name goes only once they are verified.
  if (isSharedBytesPutBack(role, phase, expectedIno, copy))
    return assertSharedPutBackBytes(context, path, copy, expectedSha256)
  // A copy of the previous config goes only on the word of the record as recovery read it: a record a sync tool put back meanwhile may hand that copy to the learner, even as a second name of the config.
  const recordStill =
    role === 'kept' ? await recordStillCheck(context) : undefined
  // A storage that already stalls holds this step here, not at the synchronous looks below, which come in the same order.
  await lookAheadAt([context.path, ...(recordStill?.names ?? []), path])
  assertConfigStill(context, copy.ino, path)
  recordStill?.assert()
  assertLeftoverStill(context, path, { ino: copy.ino })
  return unlink(path)
}

/**
 * Tells whether a private name that shares the config's inode is what a put-back by bytes alone leaves when it stops after its link and before its check: the displaced file of a change in progress, with another inode than the recorded one; called by {@link dropSecondName}.
 * @param role - The leftover's role.
 * @param phase - The phase recovery reads the record in ({@link leftoverPhaseOf}).
 * @param expectedIno - The inode the record holds.
 * @param copy - What {@link lookAtLeftover} found.
 * @returns `true` for that case; `false` for a staged name, a finished change, and the recorded inode (a put-back by inode, whose bytes may be the learner's later edit).
 * @example
 * isSharedBytesPutBack('kept', undefined, recordedIno, copy) // => true when copy.ino is not recordedIno
 */
function isSharedBytesPutBack(
  role: JournalRole,
  phase: Pending['phase'],
  expectedIno: RecordedFileId,
  copy: InspectedCopy,
): boolean {
  return (
    role === 'kept' &&
    phase === undefined &&
    !isSameFileId(expectedIno, copy.ino)
  )
}

/**
 * Checks, before it deletes the private name, the bytes of a put-back by bytes alone that stopped after its link; called by {@link dropSecondName}.
 * Both names show one inode, so the unlink loses no data; what must never happen is that the config keeps bytes Codebook did not verify while the private name, the only sign of that, goes. The first look's hash must be the recorded one, a read of the config name and then of the private name must both show that inode and hash, and looks at both names, the config name first and the private name last, must still see the size and times of those reads. The looks wait for the file system without holding the extension host's thread ({@link isNameStill}); the private name then goes only through {@link dropCheckedName}, which moves it aside, checks the moved file again and drops it only while the record recovery read still stands.
 * Limit: a write into the shared file after the drop's last read is not seen; no Node primitive unlinks by inode or content.
 * @param context - The run.
 * @param path - The private name.
 * @param copy - What {@link lookAtLeftover} found at it.
 * @param expectedSha256 - The recorded hash.
 * @throws A {@link PutBackCheckError} (handed) naming both names when a hash differs from the record, a read fails or shows another inode, or a name changed after its read; both names stay. What {@link dropCheckedName} throws.
 * @example
 * await assertSharedPutBackBytes(context, keptPath, copy, pending.keptSha256)
 */
async function assertSharedPutBackBytes(
  context: Context,
  path: string,
  copy: InspectedCopy,
  expectedSha256: string | undefined,
): Promise<void> {
  if (copy.sha256 !== expectedSha256) throw sharedBytesError(context, path)
  // Any failure of these reads (an I/O error, the size limit) is as unverified as a hash mismatch.
  const configLook = await inspectCopy(context.path, context.seam).catch(
    () => undefined,
  )
  const privateLook = await inspectCopy(path, context.seam).catch(
    () => undefined,
  )
  if (
    configLook?.ino !== copy.ino ||
    configLook.sha256 !== expectedSha256 ||
    privateLook?.ino !== copy.ino ||
    privateLook.sha256 !== expectedSha256
  )
    throw sharedBytesError(context, path)
  // Looks at both names again, the config name first and the private name last, right before that name is dropped; the drop checks the moved file once more.
  if (
    !(await isNameStill(context, context.path, configLook)) ||
    !(await isNameStill(context, path, privateLook))
  )
    throw sharedBytesError(context, path)
  await dropCheckedName(context, path, privateLook, () =>
    sharedBytesError(context, path),
  )
}

/** The end Codebook gives a private name while it drops that name ({@link dropCheckedName}), and a tracked record while it rewrites or deletes it ({@link droppingPathOf}): the name is renamed to `<name>.codebook-dropping` first, a name no other program uses. */
const DROPPING_SUFFIX = 'codebook-dropping'

/**
 * Deletes a private name that is a second name of the config only while it still names the file Codebook checked and the record recovery acts on still stands; called by {@link assertSharedPutBackBytes} and {@link dropPutBackName} right after their last looks, only for the displaced copy of the previous config, which goes only on that record's word.
 * The name is renamed first to `<private name>.codebook-dropping` ({@link DROPPING_SUFFIX}), so a file another program swaps in at the private name after the last look moves with the rename instead of being deleted. The rename runs only while nothing stands at the dropping name: a rename would replace a file there, or do nothing when that is another name of the same file and leave the private name standing. The moved file is read again and deleted only while it has the checked inode, the checked bytes when they are given and another name; then the record is read once more and the config name, the record's name and, last, the dropping name are looked at synchronously right before the unlink ({@link isStillSecondName}), so a record of that change that a backup puts back handing the copy to the learner at any step of the drop keeps the name. Anything else is linked back to the private name, which a link never replaces, and the run refuses.
 * Limits: a file that appears at the dropping name between its look and the rename is replaced (no Node primitive renames without replacing). A save at the config name, a write into the file or a record put at its name after the last looks, and before the unlink takes effect, is not seen (no Node primitive unlinks by inode, link count or content). A stop between the rename and the unlink leaves the moved name, a second name of the config that no record holds; the record still holds the private name, so the next run puts the file back there and settles it again ({@link settleDroppingName}).
 * @param context - The run; its seam is called when the moved file is read and around the last looks, and its pending path is the record the drop rests on ({@link recordStillCheck}).
 * @param path - The private name to drop.
 * @param checked - The inode the moved file must have, and the hash of the bytes it must hold when a check read them (a put-back by inode accepts any bytes).
 * @param refuse - Builds the error thrown once the moved file stands at the private name again.
 * @throws The {@link droppingNameTakenError} when a file already stands at the dropping name, and what that look throws; nothing moved then. `refuse()` when the moved file is not the checked one, holds other bytes, cannot be read or is the only name of its file, or when a last look finds a name changed or fails; a {@link JournalConflictError} when the record changed, disappeared or cannot be read again, once the moved file stands at the private name again; a {@link PutBackCheckError} naming the moved name when that file cannot go back; what the rename throws (nothing moved then) and what the unlink throws (the file went back first).
 * @example
 * await dropCheckedName(context, keptPath, { ino: copy.ino, sha256: pending.keptSha256 }, () => sharedBytesError(context, keptPath))
 */
async function dropCheckedName(
  context: Context,
  path: string,
  checked: { ino: bigint; sha256?: string },
  refuse: () => Error,
): Promise<void> {
  const droppingPath = `${path}.${DROPPING_SUFFIX}`
  // A file at the dropping name is not the one being dropped, or is another name of it that a rename would leave: both stay.
  if (await lstatOrAbsent(droppingPath))
    throw droppingNameTakenError(context, path, droppingPath)
  await rename(path, droppingPath)
  const moved = await inspectCopy(droppingPath, context.seam).catch(
    () => undefined,
  )
  let isChecked: boolean
  try {
    // The checked file with the checked bytes and another name at its read, which the config name, the record and, last, the dropping name still show: dropping this name loses nothing. Nothing async runs between the last look and the unlink.
    isChecked =
      moved?.ino === checked.ino &&
      (checked.sha256 === undefined || moved.sha256 === checked.sha256) &&
      moved.nlink > 1n &&
      (await isStillSecondName(
        context,
        droppingPath,
        moved,
        checked.sha256 !== undefined,
      ))
  } catch (conflict) {
    // The record changed, disappeared or could not be read again: the copy goes back to its private name, and the run goes no further.
    await moveBackFromDropping(context, path, droppingPath)
    throw conflict
  }
  if (!isChecked) {
    await moveBackFromDropping(context, path, droppingPath)
    throw refuse()
  }
  try {
    await unlink(droppingPath)
  } catch (error) {
    await moveBackFromDropping(context, path, droppingPath)
    throw error
  }
}

/**
 * Reads the record recovery acts on once more ({@link recordStillCheck}), then looks synchronously at the config name, that record's name and, last, the dropping name right before {@link dropCheckedName} unlinks the dropping name, after one awaited look at each ({@link lookAheadAt}), so nothing is awaited between those looks and the unlink: the config name must still show the moved file, the record's name the version recovery read or last wrote, so a record of that change that a backup puts back handing the copy to the learner keeps the name, and the dropping name must show the moved file with another name still reaching it at that very look, so a save by rename at the config name is seen; for a drop whose bytes were checked it must also show the size and times of the moved file's read, so an in-place write after that read is seen.
 * Limits: a save at the config name, a write into the file or a record put at its name after these looks and before the unlink takes effect is not seen, also while the unlink request waits for the file system; no Node primitive unlinks by inode, link count or content. A stall that starts between the awaited looks and the synchronous ones holds the extension host's thread.
 * @param context - The run; its seam is called around the looks, and its pending path is the record.
 * @param droppingPath - The dropping name about to be unlinked.
 * @param moved - The moved file as {@link inspectCopy} read it after the rename.
 * @param isByBytes - Whether the drop checked the moved file's bytes.
 * @returns `true` only when every look passed; `false` when the config name or the dropping name changed, or a look at either failed.
 * @throws A {@link JournalConflictError} when the record's name shows another file or nothing, or cannot be read again ({@link recordStillCheck}).
 * @example
 * await isStillSecondName(context, `${keptPath}.codebook-dropping`, moved, false) // => false once a save replaced the config
 */
async function isStillSecondName(
  context: Context,
  droppingPath: string,
  moved: InspectedCopy,
  isByBytes: boolean,
): Promise<boolean> {
  const { ino, size, mtimeNs, ctimeNs } = moved
  // A copy of the previous config goes only on the word of the record as recovery read it or last wrote it: a record a backup put back meanwhile may hand that copy to the learner.
  const recordStill = await recordStillCheck(context)
  // A storage that already stalls holds this step here, not at the synchronous looks below, which come in the same order.
  await lookAheadAt([context.path, ...(recordStill?.names ?? []), droppingPath])
  if (!isNameStillNow(context, context.path, { ino })) return false
  recordStill?.assert()
  return isNameStillNow(context, droppingPath, {
    ino,
    isShared: true,
    ...(isByBytes && { size, mtimeNs, ctimeNs }),
  })
}

/**
 * Tells, by one synchronous look, whether a name still shows the checked file ({@link isLeftoverStill}), answering `false` when the look itself fails; called by {@link isStillSecondName} for its looks at the config name and the dropping name, because a look that fails proves nothing and the drop then puts the file back.
 * @param context - The run; its seam is called around the look.
 * @param path - The name to look at.
 * @param checked - What the name must still show ({@link LeftoverLookback}).
 * @returns `true` when the name shows the checked file; `false` when it is gone, shows another file or the look failed.
 * @example
 * isNameStillNow(context, droppingPath, { ino: 42n, isShared: true }) // => false once a save by rename left the file with one name
 */
function isNameStillNow(
  context: Context,
  path: string,
  checked: LeftoverLookback,
): boolean {
  try {
    return isLeftoverStill(context, path, checked)
  } catch {
    // A look that fails proves nothing: the file goes back to its private name and the run refuses.
    return false
  }
}

/**
 * Puts a file that {@link dropCheckedName} moved to its dropping name back at the private name: a link, which never replaces a file that appeared there meanwhile, then the dropping name goes; called by {@link dropCheckedName}.
 * @param context - The run; its config path and retry are named when the file cannot go back.
 * @param path - The private name.
 * @param droppingPath - The dropping name that holds the moved file.
 * @throws A {@link PutBackCheckError} (handed) naming the config, the private name and the dropping name when the link fails; the file stays at the dropping name then. A failed unlink of the dropping name after the link is no failure: both names reach the file that stands at the private name.
 * @example
 * await moveBackFromDropping(context, keptPath, `${keptPath}.codebook-dropping`)
 */
async function moveBackFromDropping(
  context: Context,
  path: string,
  droppingPath: string,
): Promise<void> {
  try {
    await link(droppingPath, path)
  } catch {
    throw notMovedBackError(context, path, droppingPath)
  }
  await unlink(droppingPath).catch(() => undefined)
}

/** The refusal for a file that stands at a dropping name ({@link DROPPING_SUFFIX}) and could not go back to its private name ({@link moveBackFromDropping}, {@link settleDroppingName}): the config, the private name and the dropping name stay as they are; handed, so no later run deletes any of them. */
function notMovedBackError(
  context: Context,
  path: string,
  droppingPath: string,
): PutBackCheckError {
  return new PutBackCheckError(
    `Codebook moved the private file at ${path} to ${droppingPath} to delete that name and could not move it back, because a file stands at ${path} again or the link failed; Codebook left the config at ${context.path}, ${path} and ${droppingPath} as they are, so look at all of them before you use any, and never copy one over the config; ${context.retry}.`,
    true,
  )
}

/**
 * Puts back the displaced file that a run which stopped inside {@link dropCheckedName} left under its dropping name (`<private name>.codebook-dropping`, {@link DROPPING_SUFFIX}), a name no record holds; called by {@link lookPastCutShortDrop} when the record still holds the private name and nothing stands there.
 * A stop right after the drop's rename leaves the file only at the dropping name, a second name of the config that would make every later setup and removal refuse the config as linked from another path ({@link assertSingleLink}). The file goes back with a link, which never replaces a file that stands at the private name, and the dropping name goes only while both names show the inode the dropping name showed at the first look, so recovery checks the file under its private name as it did before the drop began. The looks wait for the file system without holding the extension host's thread ({@link isNameStill}), the private name first and the dropping name last, right before its unlink. The name is Codebook's alone, so no record format changes.
 * Limit: a swap at either name between the last look and the unlink is not seen; no Node primitive unlinks by inode.
 * @param context - The run.
 * @param path - The private name the record holds.
 * @returns `true` once the file stands at the private name again and the dropping name is gone; `false` when nothing stands at the dropping name.
 * @throws The {@link notMovedBackError} when another file stands at the private name, the link failed or either name changed; every name stays, and so does the record. What a look or the unlink throws.
 * @example
 * await settleDroppingName(context, keptPath) // => true after a stop right after the drop's rename: keptPath stands again
 */
async function settleDroppingName(
  context: Context,
  path: string,
): Promise<boolean> {
  const droppingPath = `${path}.${DROPPING_SUFFIX}`
  const moved = await lstatOrAbsent(droppingPath)
  if (!moved) return false
  // A failed link is no answer yet: the looks below decide whether the private name shows the moved file.
  await link(droppingPath, path).catch(() => undefined)
  // Both names must show the moved inode right before the dropping name goes, the private name first.
  if (
    !(await isNameStill(context, path, { ino: moved.ino })) ||
    !(await isNameStill(context, droppingPath, { ino: moved.ino }))
  )
    throw notMovedBackError(context, path, droppingPath)
  await unlink(droppingPath)
  return true
}

/**
 * Drops a dropping name ({@link DROPPING_SUFFIX}) that is only another name of the file the displaced name and the config show, as a return of a cut-short drop leaves it when it stops, or its unlink fails, right after its link ({@link settleDroppingName}); called by {@link dropSecondName} for the displaced name of a change in progress, before that name goes.
 * Without this the next run drops the displaced name and the dropping name stays a second name of the config that no record holds, so every later setup and removal refuses the config as linked from another path ({@link assertSingleLink}); a drop by rename onto it would do nothing, because both names reach one file. A dropping name that is absent or shows another file stays untouched: {@link dropCheckedName} never moves a name onto it and names it.
 * The looks wait for the file system without holding the extension host's thread ({@link isNameStill}): the config first, then the displaced name, and the dropping name last, right before its unlink.
 * Limit: a swap at the dropping name between its last look and the unlink is not seen; no Node primitive unlinks by inode.
 * @param context - The run; its config path is looked at.
 * @param path - The displaced name the record holds.
 * @param ino - The inode the displaced name showed at its look.
 * @returns Nothing; a dropping name that is absent, shows another inode, or stands beside a config or displaced name that no longer shows that inode stays as it is.
 * @throws What a look other than a missing name, or the unlink, throws.
 * @example
 * await dropDroppingSecondName(context, keptPath, copy.ino) // `${keptPath}.codebook-dropping` is gone when it was another name of the config's file
 */
async function dropDroppingSecondName(
  context: Context,
  path: string,
  ino: bigint,
): Promise<void> {
  const droppingPath = `${path}.${DROPPING_SUFFIX}`
  const dropping = await lstatOrAbsent(droppingPath)
  if (dropping?.ino !== ino) return
  // The config, the displaced name and the dropping name must show that one file right before the dropping name goes.
  if (
    !(await isNameStill(context, context.path, { ino })) ||
    !(await isNameStill(context, path, { ino })) ||
    !(await isNameStill(context, droppingPath, { ino }))
  )
    return
  await unlink(droppingPath)
}

/** The refusal of {@link dropCheckedName} when a file already stands at the dropping name ({@link DROPPING_SUFFIX}): a rename would replace that file, or do nothing when it is another name of the same file, so nothing moves and the config, the private name and that file stay; the record stays as well, so the next run looks again ({@link dropDroppingSecondName}). */
function droppingNameTakenError(
  context: Context,
  path: string,
  droppingPath: string,
): PutBackCheckError {
  return new PutBackCheckError(
    `A file stands at ${droppingPath}, the name Codebook moves the private file at ${path} to before it deletes that name, so Codebook deleted nothing and left the config at ${context.path}, ${path} and ${droppingPath} as they are; look at all of them before you use any, and never copy one over the config; if the file at ${droppingPath} is yours, move it elsewhere, ${context.retry}.`,
    false,
  )
}

/** The refusal of {@link assertSharedPutBackBytes}: both paths stay, and the learner is asked to look at both and never to copy one over the other; handed, so no later run deletes either name. It claims no shared file, because it also fires when a name is gone or another file was saved at the config name. */
function sharedBytesError(
  context: Context,
  copyPath: string,
): PutBackCheckError {
  return new PutBackCheckError(
    `Codebook could not verify that the config at ${context.path} and the private file at ${copyPath} are still two names of one file holding the bytes Codebook kept (one of them changed, is gone or could not be read); Codebook left both paths as they are, so look at both before you use either, and never copy one over the other; ${context.retry}.`,
    true,
  )
}

/**
 * Tells what shows that a displaced file is the one the record names; called by {@link tidyLeftover} before a put-back.
 * @param recordedIno - The inode the record holds.
 * @param copy - What {@link lookAtLeftover} found.
 * @param recordedSha256 - The hash the record holds.
 * @returns `inode` for the recorded inode, `bytes` for another inode with the recorded bytes, undefined for neither.
 * @example
 * proofOfRecordedCopy(recordedIno, copy, recordedSha256) // => 'bytes' after a sync tool replaced the file with the same bytes
 */
function proofOfRecordedCopy(
  recordedIno: RecordedFileId,
  copy: InspectedCopy,
  recordedSha256: string | undefined,
): 'inode' | 'bytes' | undefined {
  if (isSameFileId(recordedIno, copy.ino)) return 'inode'
  return copy.sha256 === recordedSha256 ? 'bytes' : undefined
}

/**
 * Throws when the config name no longer shows the inode, size and times it had when it was read; called by {@link tidyLeftover} as a synchronous look right before the displaced name is unlinked, because an in-place rewrite keeps the inode.
 * Limit: a write after this look is not seen.
 * @param context - The run.
 * @param look - The config as {@link assertConfigStillPublished} read it.
 * @param leftoverPath - The displaced name about to be unlinked; kept and named when the check fails.
 * @param isCompleted - A completed replacement keeps the original tracked if its final proof changes or cannot be read.
 * @throws An error naming `leftoverPath` when the config changed or the final proof failed.
 */
function assertConfigUnchangedSince(
  context: Context,
  look: InspectedCopy,
  leftoverPath: string,
  isCompleted: boolean,
): void {
  try {
    if (isLeftoverStill(context, context.path, look)) return
  } catch (cause) {
    // A failed last look also leaves a completed publish unproven. An in-progress change keeps its existing read failure.
    if (!isCompleted) throw cause
  }
  throw isCompleted
    ? publishedConfigUnprovenError(context, leftoverPath)
    : configChangedError(context, leftoverPath)
}

/** Throws when a displaced copy's last read shows other bytes or another inode than the ones Codebook checked; the copy stays untouched. */
function assertLeftoverHoldsChecked(
  path: string,
  look: InspectedCopy,
  ino: bigint,
  expectedSha256: string,
): void {
  if (look.sha256 !== expectedSha256 || look.ino !== ino)
    throw new Error(
      `The private file at ${path} no longer holds the bytes Codebook checked (another program wrote to it just now), so Codebook left it untouched.`,
    )
}

/**
 * Keeps a displaced original of an unfinished change when another config stands at the config name; called by {@link tidyLeftover}.
 * @param context - The run.
 * @param pending - The pending record of the interrupted run.
 * @param configIno - The inode of the config that stands.
 * @throws A {@link HandedCopyError} after the original was handed over (the config is not the published staged file); a plain error without handing over when the record holds no staged inode or no staged hash, so nobody can say which file was published. Returns when the config has the staged inode and the staged bytes.
 * @example
 * await keepOriginalUnlessPublished(context, pending, config.ino)
 */
async function keepOriginalUnlessPublished(
  context: Context,
  pending: Pending,
  configIno: bigint,
): Promise<void> {
  // Without a recorded staged inode the original is kept untouched and named (not handed over: the record stays as it is).
  if (pending.stagedIno === undefined)
    throw new Error(
      'Codebook cannot tell which config was published, so it kept the displaced copy.',
    )
  // Same inode and same bytes: the published file. Another editor may rewrite the published file in place and keep its inode, so the inode alone proves nothing; without a recorded hash the file cannot be told from such an edit.
  if (isSameFileId(pending.stagedIno, configIno)) {
    if (pending.stagedSha256 === undefined)
      throw new Error(
        'Codebook cannot tell which config was published, so it kept the displaced copy.',
      )
    const config = await inspectCopy(context.path, context.seam)
    if (
      config &&
      isSameFileId(pending.stagedIno, config.ino) &&
      config.sha256 === pending.stagedSha256
    )
      return
  }
  await handOver(context, pending)
  throw new HandedCopyError(
    'Another config stands at the config name, so the displaced copy was handed to the learner.',
  )
}

/**
 * Puts the displaced config of an interrupted move-aside back at the config name, even if it is not the bytes that were read; called by {@link tidyLeftover}.
 * Each synchronous look here comes right after an awaited look at the same name ({@link lookAheadAt}), so a storage that already stalls holds this step in the thread pool, where the step's budget answers; a stall that starts between the two looks still holds the extension host's thread.
 * The name is looked at again right before the link and before it goes ({@link isLeftoverStill}); after the link the config name must show the checked inode. When it shows another one and the leftover name shows that same inode, the link itself made this name, so the config name is unlinked again and the leftover is refused; when the leftover name changed again too, Codebook cannot prove which name it made, so both stay and the refusal says so. The displaced name goes only through {@link dropPutBackName}, which moves it aside and checks the moved file again, so a file swapped in after the last look is never deleted. The put-back links only while the record still shows the version recovery read, or for a put-back by bytes the unchecked record it just wrote, looked at right before the name's last look ({@link recordStillCheck}), and the displaced name goes only while that version still stands at a look right before its unlink ({@link dropCheckedName}).
 * Limits: a swap between the look before the link and the link is not seen; a record a sync tool puts back after the link keeps the displaced name, which then stays a second name of the config that stands.
 * A put-back that only the bytes prove first rewrites the record as handed and unverified ({@link Pending.bytesUnverified}), after the second hash and before the link: a run that stops between the link and the check then leaves a record that older builds never delete from and that this build checks at its next run ({@link assertSharedPutBackBytes}). When that write fails nothing is linked; once the check passed and the private name is gone, the record goes back to what it said, best effort. A step after that write that throws writes the record back as it was read, best effort, unless the displaced name stays an unverified second name of the config ({@link restoreUnlessSecondName}) or the step found that the record changed, disappeared or could not be read again ({@link JournalConflictError}): nothing is written then, so the record that stands, or the unverified one this run wrote, stays as it is.
 * @param context - The run.
 * @param leftover - The displaced name and the hash the record holds for it.
 * @param pending - The pending record of the interrupted run; its phase as recovery reads it ({@link leftoverPhaseOf}) must be absent.
 * @param isConfigAbsent - Whether nothing stands at the config name.
 * @param proof - What shows the displaced file is the recorded one: `inode` (the recorded inode) or `bytes` (another inode whose bytes equal the recorded hash); undefined when neither, and such a file is never published. When only the bytes prove it, the file is hashed again right before the link, its name is looked at synchronously with the size and times of that hash, and the file at the config name is hashed once more after the link: an in-place write in between is refused and nothing stays published from it.
 * @param copy - What {@link lookAtLeftover} found; its inode is the one that may be linked.
 * @returns `true` when the file went back (a link never replaces, and the displaced name is unlinked); `false` when the change was finished, the config name is taken or the file is not the recorded one.
 * @throws When the unverified record cannot be written, the link or unlink fails, the name no longer shows the checked file, or the link produced another file; a {@link JournalConflictError} when the record changed, disappeared or cannot be read again before the link ({@link recordStillCheck}), when nothing is linked, or before the displaced name goes ({@link dropCheckedName}), when that name stays.
 */
async function putBackDisplaced(
  context: Context,
  leftover: Leftover,
  pending: Pending,
  isConfigAbsent: boolean,
  proof: 'inode' | 'bytes' | undefined,
  copy: InspectedCopy,
): Promise<boolean> {
  const { path, sha256: expectedSha256 } = leftover
  if (
    leftoverPhaseOf(pending) !== undefined ||
    !isConfigAbsent ||
    proof === undefined
  )
    return false
  // The bytes were the only proof: hash again, so the sync look right before the link ties the name to what this read saw.
  const lastLook =
    proof === 'bytes'
      ? await rehashBeforeLink(context, path, copy.ino, expectedSha256)
      : { ino: copy.ino }
  // Before the link, the record says the put-back is unchecked: a stop after the link never lets any build drop the private name unverified. A failed write throws here, before anything is linked.
  if (proof === 'bytes')
    await writeRecord(context, context.pendingPath, {
      ...pending,
      phase: 'handed',
      bytesUnverified: true,
    } satisfies Pending)
  try {
    // A copy goes back only on the word of the record as recovery read it, or as a put-back by bytes just wrote it: a record a sync tool put back meanwhile may hand that copy to the learner.
    const recordStill = await recordStillCheck(context)
    // A storage that already stalls holds this step here, not at the synchronous looks below, which come in the same order.
    await lookAheadAt([...(recordStill?.names ?? []), path])
    recordStill?.assert()
    assertLeftoverStill(context, path, lastLook)
    await link(path, context.path)
    await lookAheadAt([context.path])
    const linked = lstatSync(context.path, {
      bigint: true,
      throwIfNoEntry: false,
    })
    if (!linked || copy.ino !== linked.ino)
      await undoForeignLink(context, path, linked?.ino)
    // A put-back by bytes drops the private name only with the size, times and bytes its check read; a put-back by inode accepts any bytes.
    const published =
      proof === 'bytes'
        ? await assertLinkedBytes(context, path, copy.ino, expectedSha256)
        : undefined
    await dropPutBackName(context, path, published ?? { ino: copy.ino })
  } catch (cause) {
    // The unverified record must not outlive the state it describes: also where the run keeps pending.json as it finds it (an unrecorded removal). A record that changed, disappeared or could not be read again is never written over: it stays as it is, and the next run reads that name first.
    if (proof === 'bytes' && !(cause instanceof JournalConflictError))
      await restoreUnlessSecondName(context, leftover, pending)
    throw cause
  }
  // Checked and done: the record says what it said before the put-back; a failed write leaves an unverified record whose private name is gone, which the next run settles as gone.
  if (proof === 'bytes')
    await writeRecord(context, context.pendingPath, {
      ...pending,
      phase: undefined,
      bytesUnverified: undefined,
    } satisfies Pending).catch(() => undefined)
  return true
}

/**
 * Drops the displaced name of a put-back once the file went back to the config name; called by {@link putBackDisplaced}.
 * Looks come first, the config name before the displaced name, each against what the put-back last read: for a put-back by bytes the inode, size and times of its check's read, because an in-place write after that read keeps the inode; for a put-back by inode the inode alone. They wait for the file system without holding the extension host's thread ({@link isNameStill}): the name then goes only through {@link dropCheckedName}, which moves it aside and checks the moved file again, also the bytes of a put-back by bytes, so no synchronous look right before that step is needed.
 * @param context - The run.
 * @param path - The displaced name; it stays whenever a check fails.
 * @param checked - What the put-back last read: the config as {@link assertLinkedBytes} read it, or only the linked inode.
 * @throws A {@link ConfigChangedError} naming both files when the config name changed; a {@link leftoverReplacedError} when the displaced name changed; what {@link dropCheckedName} throws, with a {@link sharedBytesError} once the moved file went back.
 * @example
 * await dropPutBackName(context, keptPath, { ino: copy.ino })
 */
async function dropPutBackName(
  context: Context,
  path: string,
  checked: LeftoverLookback & { sha256?: string },
): Promise<void> {
  if (!(await isNameStill(context, context.path, checked)))
    throw configChangedError(context, path)
  if (!(await isNameStill(context, path, checked)))
    throw leftoverReplacedError(path)
  await dropCheckedName(context, path, checked, () =>
    sharedBytesError(context, path),
  )
}

/**
 * Writes a pending record back as it was read after a step of a put-back by bytes threw past its unverified write; called by {@link putBackDisplaced}.
 * A put-back that never linked, or whose link was taken away again or replaced, leaves no second name of the config that an older build could delete by the shared inode, so the unverified mark ({@link Pending.bytesUnverified}) would only make older builds read an empty config name as handed: the record says again what it said. A displaced name that stays an unverified second name of the config ({@link isUnverifiedSecondName}) keeps the mark.
 * @param context - The run; its pending path is written.
 * @param leftover - The displaced name and the inode the record holds for it.
 * @param pending - The record as it was read.
 * @returns Nothing; best effort: a failed write leaves the unverified record, which this build reads as in progress ({@link leftoverPhaseOf}).
 * @example
 * await restoreUnlessSecondName(context, leftover, pending) // pending.json says again what it said when the look before the link failed
 */
async function restoreUnlessSecondName(
  context: Context,
  leftover: Leftover,
  pending: Pending,
): Promise<void> {
  if (await isUnverifiedSecondName(context, leftover)) return
  await writeRecord(context, context.pendingPath, pending).catch(
    () => undefined,
  )
}

/**
 * Tells whether a displaced name is a second name of the config that no check cleared: both names show one inode, and it is not the inode the record holds, as a put-back by bytes leaves it after its link; called by {@link restoreUnlessSecondName} and {@link recordAfterRecovery}.
 * Only such a name needs the unverified mark ({@link Pending.bytesUnverified}): it keeps an older build from deleting the name on the strength of the shared inode alone. The looks are asynchronous: they only decide what the record says, never guard a link or unlink, so a stalled file system holds this run, not the extension host's thread.
 * @param context - The run; its config path is looked at.
 * @param leftover - The displaced name and the inode the record holds for it.
 * @returns `true` for a second name with another inode than the recorded one, and when a look fails (the mark deletes nothing); `false` when either name is gone, they show two files, or the inode is the recorded one.
 * @example
 * await isUnverifiedSecondName(context, leftover) // => true after a put-back by bytes whose unlink of the private name failed
 */
async function isUnverifiedSecondName(
  context: Context,
  { path, ino: recordedIno }: Pick<Leftover, 'path' | 'ino'>,
): Promise<boolean> {
  try {
    const displaced = await lstatOrAbsent(path)
    const config = await lstatOrAbsent(context.path)
    return (
      displaced !== undefined &&
      displaced.ino === config?.ino &&
      !isSameFileId(recordedIno, displaced.ino)
    )
  } catch {
    // A name that cannot be looked at may still be a second name: the mark is the side that deletes nothing.
    return true
  }
}

/**
 * Hashes a displaced file again right before a put-back that rests on its bytes alone; called by {@link putBackDisplaced}.
 * @param context - The run.
 * @param path - The displaced name.
 * @param ino - The inode the first look found.
 * @param expectedSha256 - The recorded hash.
 * @returns The inode, size and times of this read, which the synchronous look before the link must still see.
 * @throws When the file is gone, has another inode or no longer holds the recorded bytes (a writer changed it in place after the first hash); nothing is linked.
 */
async function rehashBeforeLink(
  context: Context,
  path: string,
  ino: bigint,
  expectedSha256: string | undefined,
): Promise<LeftoverLookback> {
  const again = await inspectCopy(path, context.seam)
  if (!again || again.ino !== ino || again.sha256 !== expectedSha256)
    throw new Error(
      `The private file at ${path} no longer holds the bytes Codebook checked (another program wrote to it just now), so Codebook did not put it back.`,
    )
  return {
    ino: again.ino,
    size: again.size,
    mtimeNs: again.mtimeNs,
    ctimeNs: again.ctimeNs,
  }
}

/**
 * Checks the file that a put-back just linked to the config name: its inode and bytes must still be the checked ones before the private name is retired; called by {@link putBackDisplaced}.
 * Each synchronous look here comes right after an awaited look at the same name ({@link lookAheadAt}), so a storage that already stalls holds this step in the thread pool, where the step's budget answers; a stall that starts between the two looks still holds the extension host's thread.
 * A file that changed in the gap between the last look and the link stays at the private name only: the config name is unlinked again, while it still shows that inode.
 * Limit: a write after this read is not seen here; the caller's last looks compare the size and times this read returns ({@link dropPutBackName}).
 * @param context - The run.
 * @param path - The displaced name; it stays.
 * @param ino - The linked inode.
 * @param expectedSha256 - The recorded hash.
 * @returns The config as this read saw it: the linked inode with the recorded bytes, and the size and times the last looks before the displaced name goes must still see.
 * @throws When the read fails (an I/O error, the size limit) or the config name shows other bytes or another inode; it names `path`. The config name is taken away only while both names still show the linked inode; otherwise both stay and the error says so.
 * @example
 * const published = await assertLinkedBytes(context, keptPath, copy.ino, pending.keptSha256)
 */
async function assertLinkedBytes(
  context: Context,
  path: string,
  ino: bigint,
  expectedSha256: string | undefined,
): Promise<InspectedCopy> {
  // Any failure of this read (an I/O error, a file past the size limit) is as unverified as a hash mismatch and takes the same undo.
  const published = await inspectCopy(context.path, context.seam).catch(
    () => undefined,
  )
  if (published?.ino === ino && published.sha256 === expectedSha256)
    return published
  // A storage that already stalls holds this step here, not at the synchronous looks below, which come in the same order.
  await lookAheadAt([path, context.path])
  // The undo runs only while both names still are the link pair Codebook made; otherwise nothing is removed and the refusal says so. The displaced name is looked at first and the config name last, synchronously right before the unlink: only the syscall gap after that last look remains.
  if (
    !isLeftoverStill(context, path, { ino }) ||
    !isLeftoverStill(context, context.path, { ino })
  )
    throw new PutBackCheckError(
      `The private file at ${path} could not be checked after Codebook put it back, and the names no longer show the file Codebook linked, so Codebook could not take the config name ${context.path} away again and left both names as they are; ${context.path} may hold a file Codebook did not verify, so look at both files before you use either.`,
      true,
    )
  try {
    await unlink(context.path)
  } catch {
    throw new PutBackCheckError(
      `The private file at ${path} changed or could not be read while Codebook put it back, and Codebook could not take the config name ${context.path} away again, so ${context.path} may hold a file Codebook did not verify; ${path} stays as it is, so look at both files before you use either.`,
      true,
    )
  }
  throw new PutBackCheckError(
    `The private file at ${path} changed or could not be read while Codebook put it back (another program wrote to it just now), so Codebook took the config name ${context.path} away again and left the file at ${path} untouched.`,
    false,
  )
}

/**
 * Tells whether a pending record is that of a removal of this config that took the entry out and never recorded its completion; called by {@link settlePending} and by {@link inspect}, whose judgment the removal retry ends and reports.
 * The phase is the one recovery reads ({@link leftoverPhaseOf}): a removal's record that a put-back by bytes marked handed and unverified ({@link Pending.bytesUnverified}) is still that removal in progress, so both readers answer for it as for the record without the mark.
 * @param context - The run.
 * @param pending - The pending record.
 * @returns `true` for a record of this config with no entry hash (a removal) whose phase, as recovery reads it, is absent; `false` for a write, a finished or handed record, and a record of another config.
 * @example
 * isUnrecordedRemoval(context, { targetPath: context.path, createdFile: false, phase: 'handed', bytesUnverified: true }) // => true
 * isUnrecordedRemoval(context, { targetPath: context.path, createdFile: false, phase: 'completed' })                     // => false
 */
function isUnrecordedRemoval(context: Context, pending: Pending): boolean {
  return (
    pending.targetPath === context.path &&
    pending.entrySha256 === undefined &&
    leftoverPhaseOf(pending) === undefined
  )
}

/**
 * Settles a put-back whose link produced another file than the checked one; called by {@link putBackDisplaced}.
 * Each synchronous look here comes right after an awaited look at the same name ({@link lookAheadAt}), so a storage that already stalls holds this step in the thread pool, where the step's budget answers; a stall that starts between the two looks still holds the extension host's thread.
 * The config name is looked at again right before it is unlinked ({@link isLeftoverStill}); one that shows another inode now is somebody else's, so both names stay. Limit: a swap between that look and the unlink is not seen; no Node primitive unlinks by inode.
 * @param context - The run.
 * @param leftoverPath - The displaced name that was linked.
 * @param configIno - The inode the config name shows now; undefined when it shows nothing.
 * @throws Always: the swapped file's error after the config name was unlinked again (both names showed that inode), or the {@link unprovenLinkError} with both names left as they are.
 */
async function undoForeignLink(
  context: Context,
  leftoverPath: string,
  configIno: bigint | undefined,
): Promise<never> {
  // A storage that already stalls holds this step here, not at the synchronous looks below, which come in the same order.
  await lookAheadAt([leftoverPath, context.path])
  const leftover = lstatSync(leftoverPath, {
    bigint: true,
    throwIfNoEntry: false,
  })
  if (configIno === undefined || !leftover || leftover.ino !== configIno)
    throw unprovenLinkError(context, leftoverPath)
  // Both names show the swapped-in file: the link made the config name. Look at the config name once more right before the unlink; limit: a swap between this look and the unlink is not seen.
  if (!isLeftoverStill(context, context.path, { ino: configIno }))
    throw unprovenLinkError(context, leftoverPath)
  await unlink(context.path)
  throw new Error(
    `The private file at ${leftoverPath} is no longer the file Codebook checked (another program replaced it just now), so Codebook linked it back out and left it untouched.`,
  )
}

/**
 * Settles a `pending.json` left by a run that ended before it wrote its receipt.
 * An entry whose `{ command, args, env }` equal the pending hash is adopted (receipt written, pending removed or reduced to the leftovers that stay), with `createdFile` kept only when the config still is the staged file; a state that shows the rename never happened (no entry, a removal, the receipted entry) drops the pending record, except the record of an unrecorded removal whose entry is gone, which stays for {@link removeManagedDevinMcpEntry}; anything else is refused.
 * @param context - The run.
 * @param current - The `codebook` entry in the config, if any.
 * @param receipt - The receipt read before.
 * @param pending - The pending record read before; undefined when there is none.
 * @param look - What the config looked like.
 * @param retained - What stays of the record after recovery ({@link retainedRecord}); undefined when nothing stays.
 * @param emptiedRetiredPath - The old record's private name that this run's put-back found empty ({@link settleRetiredReceipt}); the record ends only while that name is still empty ({@link retirePending}). Undefined otherwise.
 * @param assertHeldStill - Beside a held legacy journal, the synchronous look that must still find that journal as the run held it right after that name's look and before the record's rename or unlink ({@link HeldJournal.lookStill}); undefined otherwise.
 * @param otherJournalVersion - The version of another config's rollback journal that settlement left at that name ({@link SettledJournal.otherVersion}); undefined when it left that name empty or holds the journal. An adoption rests on that name still showing what settlement left there ({@link journalLeftCheck}).
 * @returns The receipt that now stands.
 * @throws A {@link refusal} when the entry is neither the pending one nor the receipted one; what {@link retirePending} throws, such as the {@link HeldJournalConflictError} of a held journal's look (the record then stays as it is); what {@link adoptPending} throws, such as the {@link JournalBackConflictError} of a rollback record that appeared at its name.
 * @example
 * const receipt = await settlePending(context, current, (await readReceiptWithVersion(context)).receipt, pending, look, undefined)
 */
async function settlePending(
  context: Context,
  current: unknown,
  receipt: Receipt | undefined,
  pending: Pending | undefined,
  look: ConfigLook,
  retained: Pending | undefined,
  emptiedRetiredPath?: string,
  assertHeldStill?: StillLook,
  otherJournalVersion?: RecordVersion,
): Promise<Receipt | undefined> {
  if (!pending) return receipt
  // Only synchronous steps follow before the record ends, so the private name's look through the thread pool here still comes right before its last look.
  const assertRetiredStill = await retiredNameCheck(context, emptiedRetiredPath)
  const assertEndStill = bothLooks(assertRetiredStill, assertHeldStill)
  // A publish whose take-back is owed is never adopted, whatever the config holds now: the record ends without a receipt (the take-back, if it stood, already ran or refused before this point).
  if (isTakeBackOwed(pending, receipt)) {
    await retirePending(context, retained, assertEndStill)
    return receipt
  }
  // The record of a removal that took the entry out (a receipt stands, the entry is gone) is what a removal retry reads to answer `removed`: another window's inspection leaves it in place, and the retry or a new setup's own record replaces it.
  if (
    receipt !== undefined &&
    current === undefined &&
    isUnrecordedRemoval(context, pending)
  )
    return receipt
  const isReceipted =
    receipt !== undefined && receipt.generation === pending.generation
  // The hash is compared as recorded: a first setup's prefixed hash never equals an entry's, so such a record is never adopted here.
  if (
    look.kind === 'present' &&
    pending.targetPath === context.path &&
    !isReceipted &&
    pending.entrySha256 !== undefined &&
    coreHashOf(current) === pending.entrySha256
  )
    return adoptPending(
      context,
      pending,
      pending.entrySha256,
      look.identity,
      receipt,
      retained,
      // The receipt is published, and the record ends, only while every other name the adoption rests on still shows what this run left there: the old record's private name, and the held journal or else the rollback journal's name as settlement left it.
      bothLooks(
        assertRetiredStill,
        await journalLeftCheck(context, otherJournalVersion, assertHeldStill),
      ),
    )
  if (isPendingStale(context, pending, current, receipt)) {
    // The rename never happened (or this was a removal): the pending record is stale; the leftovers that stay remain tracked.
    await retirePending(context, retained, assertEndStill)
    return receipt
  }
  throw refusal(
    `a "${SERVER_NAME}" entry that differs from the one an interrupted Codebook run was writing`,
    context.path,
    'rename or remove that entry',
    context.retry,
  )
}

/**
 * Tells whether a pending record no longer concerns the config: another target, a removal, a write whose receipt exists, an entry that is gone or the one the receipt owns; called by {@link settlePending}.
 * @param context - The run.
 * @param pending - The pending record.
 * @param current - The `codebook` entry in the config, if any.
 * @param receipt - The receipt that stands, if any.
 * @returns `true` when the record can be dropped.
 */
function isPendingStale(
  context: Context,
  pending: Pending,
  current: unknown,
  receipt: Receipt | undefined,
): boolean {
  // A receipt of the same generation means the write finished and only the deletion of its record failed.
  if (receipt && receipt.generation === pending.generation) return true
  if (pending.targetPath !== context.path || !pending.entrySha256) return true
  return (
    current === undefined ||
    (receipt !== undefined && ownsEntry(current, receipt))
  )
}

/**
 * Writes the receipt for an entry an interrupted run published; called by {@link settlePending}.
 * The receipt is published only while `pending.json` still shows the record that allowed the adoption, the version this run read or last wrote ({@link adoptedRecordCheck}), and while the rollback journal's name still shows what settlement left there (`assertLeft`), so a record a backup or sync tool restores there meanwhile (one that marks the same setup's take-back, say), or a rollback record of that setup it puts back, never gains the receipt that would make the next run skip that take-back ({@link finishCutShortSetup}).
 * The record then ends only while that look still holds too, and only while the config still is the very file this run read when it decided the adoption (the same look the receipt's publish rests on, joined into the record's last looks): a backup or sync tool that puts another config back after the receipt's rename (the pre-update one, say) never keeps this receipt beside it, because that config's entry may be the one the replaced receipt still records. Once the record ended, `pending.json` is read again through the thread pool and looked at once more synchronously ({@link adoptedRecordCheck}): it must show what the record's end left there (nothing, or what stays of it), so a record a backup or sync tool puts there while the adopted one stands at its dropping name ({@link deleteThroughDroppingName}) is never left beside this receipt. When a record it rests on changed by then (it came back or changed after the receipt's rename): a rollback record at its name, or another file, nothing or a name that cannot be read again at `pending.json` (a same-generation record with the take-back mark, say), anywhere in the cause chain of what the record's end or that last look threw ({@link hasRecordConflictCause}), or when the config changed ({@link AdoptionConfigChangedError}), the record that stands stays and the receipt this call published goes back out ({@link withdrawAdoptedReceipt}), so the next run settles those records first and takes the setup back when they say so.
 * The record ends only while `receipt.json` still shows the receipt this call published, too: once the receipt's write (and its cleanup of the staged name) returned, that name is read again through the thread pool, and its synchronous look joins the record's last looks ({@link publishedReceiptCheck}), so a receipt another program moved away, replaced or made unreadable meanwhile keeps the record, and the next run decides that setup again; nothing goes back out then, since that receipt is no longer this call's file.
 * Limit: a record put at `pending.json` after that last look, or after the run, is decided without this run, like one restored after the run; so is a receipt moved away after the record's last look, and a config restored after the record end's last synchronous look at it.
 * @param context - The run; it tracks its publish record ({@link trackedPublishContext}).
 * @param pending - The pending record.
 * @param entrySha256 - The pending hash.
 * @param identity - The identity of the config that stands.
 * @param replacedReceipt - The receipt read together with the version tracked in context.receiptVersion.current; it is the only receipt this adoption may replace, and the value a withdrawal puts back.
 * @param retained - What stays of the record after recovery; undefined when nothing stays.
 * @param assertLeft - The synchronous look at the other names the adoption rests on (the old record's private name, the rollback journal's name: {@link retiredNameCheck}, {@link journalLeftCheck}), run right before the receipt's rename after the publish record's own look, and right before the record's rename or unlink; undefined when nothing else must hold.
 * @returns The receipt that was written.
 * @throws The {@link adoptedReceiptConflictError} when `receipt.json` no longer shows the receipt this call published before the record ends; the record stays. A {@link JournalConflictError} from {@link adoptedRecordCheck} or its look when `pending.json` no longer shows that record, and what `assertLeft` throws, such as a {@link JournalBackConflictError} for a rollback record at its name; no receipt is written then, or the one written goes back out when such a conflict stops the record's end or the look after it (`changed` for a file at `pending.json` after its delete). The {@link AdoptionConfigChangedError} when the config is no longer the file this run read: no receipt is written then, or the one written goes back out when the change meets the record's end. The {@link receiptConflictError} when `receipt.json` no longer shows the record this run read there ({@link writeReceipt}): that file stays and no receipt is written. What the receipt's write and {@link retirePending} throw otherwise.
 * @example
 * await adoptPending(run, pending, pending.entrySha256, look.identity, receipt, undefined, await journalLeftCheck(run, undefined)) // => the adopted receipt; it rejects, leaving no receipt and both records, once a backup put the rollback record of that setup back
 */
async function adoptPending(
  context: Context,
  pending: Pending,
  entrySha256: string,
  identity: FileIdentity,
  replacedReceipt: Receipt | undefined,
  retained: Pending | undefined,
  assertLeft?: StillLook,
): Promise<Receipt> {
  const adopted: Receipt = {
    schemaVersion: 1,
    targetPath: context.path,
    entrySha256,
    // Only a config that still is the staged file counts as created by Codebook; an unrecorded or other inode means unknown, which is safe.
    createdFile:
      pending.createdFile &&
      pending.stagedIno !== undefined &&
      isSameFileId(pending.stagedIno, identity.ino),
    installed: true,
    generation: pending.generation ?? randomUUID(),
    // The id the publish recorded before its rename; a record of an older build has none, so the receipt that still stands decides, as it did before.
    installationId: pending.installationId ?? installationIdOf(replacedReceipt),
    config: { ino: recordedFileId(identity.ino) },
    // The receipt rests on the entry's hash alone: a record of this setup that asks for its take-back still gets it ({@link isTakeBackCovered}).
    adopted: true,
  }
  // The config must still be the very file this run read when it decided the adoption: a backup or sync tool that puts another config back meanwhile (the pre-update one, say) never gains this receipt, which would replace a record that file's entry still rests on; the look runs closest to the receipt's rename, after the publish record's and the other names', and again closest to the record's own end, where its failure takes the receipt that was published back out (the catch below).
  const configStill: StillLook = {
    names: [context.path],
    assert: (): void => {
      if (!isConfigStill(context, identity))
        throw adoptionConfigChangedError(context)
    },
  }
  await writeReceipt(
    context,
    adopted,
    bothLooks(
      bothLooks(await adoptedRecordCheck(context), assertLeft),
      configStill,
    ),
  )
  try {
    // The receipt must still stand as its write published it once that write's awaited cleanup of its staged name ended, also right before the record ends: a receipt another program moved away or replaced meanwhile never lets the only record of this setup go.
    const assertReceiptLeft = await publishedReceiptCheck(
      context,
      adoptedReceiptConflictError,
    )
    // The record ends only while the config still is the file the adoption was decided on, too: a config a backup or sync tool put back after the receipt's rename (the pre-update one, whose entry the replaced receipt records, say) never stands beside a receipt that replaced that record.
    await retirePending(
      context,
      retained,
      bothLooks(bothLooks(assertLeft, assertReceiptLeft), configStill),
    )
    // The record's own name must still show what its retirement left there (nothing, or what stays of it): a record a backup put there while the adopted one stood at its dropping name, one that marks the same setup's take-back, say, never stays beside this receipt.
    const assertRecordLeft = await adoptedRecordCheck(context)
    assertRecordLeft.assert()
  } catch (error) {
    // A record the adoption rests on changed after the receipt's rename (a rollback record back at its name, or another setup record at pending.json, which may mark that setup's take-back), or the config is no longer the file the adoption was decided on: that receipt goes back out while it still is the version this call wrote, and a receipt that may still stand is named.
    if (
      (error instanceof AdoptionConfigChangedError ||
        hasRecordConflictCause(error)) &&
      !(await withdrawAdoptedReceipt(context, replacedReceipt))
    )
      throw withKeptAdoptedReceipt(context, error)
    throw error
  }
  return adopted
}

/**
 * Adds to the refusal of an adoption that a changed record stopped the sentence that the receipt it had just published may still stand at `receipt.json` ({@link withdrawAdoptedReceipt} could not take it back out), and that the next run still takes that setup back when a record of it asks, because an adopted receipt never covers such a take-back ({@link isTakeBackCovered}); called only by {@link adoptPending}.
 * The sentence goes onto the refusal itself, so the conflict keeps its class and is worded as the record's own by the run's caller ({@link asRecordConflict}).
 * @param context - The run; its receipt path is named.
 * @param error - What the record's end or the look after it threw.
 * @returns `error` with that sentence after its own; `error` itself when it is no `Error`.
 * @example
 * throw withKeptAdoptedReceipt(run, conflict) // 'While Codebook settled its rollback record at … Codebook also could not delete its record of the "codebook" entry at …/receipt.json, which it had just written for that setup, …'
 */
function withKeptAdoptedReceipt(context: Context, error: unknown): unknown {
  if (!(error instanceof Error)) return error
  error.message = `${error.message} Codebook also could not delete its record of the "${SERVER_NAME}" entry at ${context.receiptPath}, which it had just written for that setup, so that file stays there; the next run still takes that setup back when a record of that setup asks for it.`
  return error
}

/** Thrown when the config an adoption rests on is no longer the very file the run read when it decided the adoption, once the adoption's receipt is published and before its record has ended ({@link adoptPending}): that receipt goes back out ({@link withdrawAdoptedReceipt}), because the config that stands may be one whose entry the replaced receipt still records (the pre-update one a backup put back, say), and no receipt of this adoption may replace that record. A plain {@link Error}, never a {@link JournalConflictError}: the conflict is the config's, not a record's, so it is worded as the changed-file refusal and never takes part in a record conflict's rewording ({@link asRecordConflict}). */
class AdoptionConfigChangedError extends Error {}

/**
 * Words an {@link AdoptionConfigChangedError} as the changed-file refusal every config that changed under a run ends in ({@link changedWhileWorking}); thrown by the look at the config an adoption rests on, which {@link adoptPending} joins into the receipt write's guards and into the adopted record's end.
 * @param context - The run; its config path and retry are named.
 * @returns The error, not thrown yet.
 * @example
 * throw adoptionConfigChangedError(context) // 'Codebook found a file that changed while Codebook was working on it in Devin Desktop's MCP config at … and left that file untouched; look at the file, then run Codebook: Set Up AI Chat again.'
 */
function adoptionConfigChangedError(
  context: Context,
): AdoptionConfigChangedError {
  return new AdoptionConfigChangedError(changedWhileWorking(context).message)
}

/** What the read of `receipt.json` after a write of Codebook's record of the entry found ({@link publishedReceiptCheck}): the file there (none for an empty name), or the failure of that read. */
type PublishedReceiptRead =
  { standing: InspectedCopy | undefined } | { cause: unknown }

/**
 * Reads `receipt.json` through the thread pool once a write of Codebook's record of the entry returned ({@link writeReceipt}), and gives the synchronous look that must still find there the version that write published ({@link Context.receiptVersion}) before the record of that setup goes; called by {@link adoptPending}, which joins it after the other looks the adopted record's end rests on ({@link retirePending}), and by {@link recordPublishedEntry}, which runs it right away, before a setup's own record goes ({@link dropPending}), so a receipt another program moved away, replaced or made unreadable during that write's awaited cleanup of its staged name ({@link dropStagedRecord}), or after it, never lets the only other record of that entry go.
 * The read decides nothing by itself: its verdict comes at the synchronous look ({@link publishedReceiptVerdict}), for an adoption after the looks at the records it rests on, so a rollback record or setup record that changed meanwhile is what the run says first, and the adoption then takes back out a receipt that may still be its own ({@link withdrawAdoptedReceipt}).
 * Limit: a receipt moved away or replaced after that look (for an adoption, the record's last look before its rename or unlink), or after the run, is decided without this run, like one moved after the run.
 * @param context - The run; its receipt version is the one the write published.
 * @param conflictOf - Builds the refusal the look throws: the {@link adoptedReceiptConflictError} for an adoption, the {@link receiptConflictError} for a setup.
 * @returns The look at `receipt.json` ({@link StillLook}); it throws what `conflictOf` builds for the kind {@link publishedReceiptVerdict} tells when that name does not show the receipt the write published. Nothing is written or deleted then.
 * @example
 * await retirePending(run, retained, bothLooks(assertLeft, await publishedReceiptCheck(run, adoptedReceiptConflictError))) // throws, keeping pending.json, once a sync tool moved receipt.json away after the adoption published it
 */
async function publishedReceiptCheck(
  context: Context,
  conflictOf: typeof receiptConflictError,
): Promise<StillLook> {
  const path = context.receiptPath
  const written = context.receiptVersion.current
  const read: PublishedReceiptRead = await inspectCopy(path).then(
    (standing) => ({ standing }),
    (cause: unknown) => ({ cause }),
  )
  return {
    names: [path],
    assert: (): void => {
      const kind = publishedReceiptVerdict(path, written, read)
      if (kind === undefined) return
      throw conflictOf(context, kind, 'cause' in read ? read.cause : undefined)
    },
  }
}

/**
 * Tells, from the read after a write of Codebook's record of the entry and one synchronous look right after it, whether `receipt.json` still shows the receipt that write published; called only by the look {@link publishedReceiptCheck} gives.
 * @param path - `receipt.json`.
 * @param written - The version the write published ({@link Context.receiptVersion}).
 * @param read - What the read through the thread pool found ({@link PublishedReceiptRead}).
 * @returns
 * - undefined while the read found that inode and those bytes and the name still shows that file (its inode, size and times: {@link isStagedNameStill})
 * - `gone` when the read found the name empty, or the look finds it empty now
 * - `changed` when either found another file or other bytes, or the read found something that is no record at all ({@link isOtherFileCause})
 * - `unread` when the read failed otherwise
 * @example
 * publishedReceiptVerdict(receiptPath, written, { standing: undefined }) // => 'gone'
 */
function publishedReceiptVerdict(
  path: string,
  written: RecordVersion | undefined,
  read: PublishedReceiptRead,
): JournalConflictError['kind'] | undefined {
  if ('cause' in read)
    return isOtherFileCause(read.cause) ? 'changed' : 'unread'
  const { standing } = read
  if (!standing) return 'gone'
  // Only the very file and bytes the write published let the record end.
  if (standing.ino !== written?.ino || standing.sha256 !== written.sha256)
    return 'changed'
  if (isStagedNameStill(path, standing)) return undefined
  return isNameEmptyNow(path) ? 'gone' : 'changed'
}

/**
 * Builds the refusal of an adoption whose receipt no longer stands at `receipt.json` as its write published it ({@link publishedReceiptCheck}): the record of that setup stays, and so does what stands at `receipt.json`, and the next run decides that setup again (it adopts it again while the config still holds that entry); a {@link ReceiptConflictError}, so it names its own file and way out and never takes the adoption's receipt back out ({@link hasRecordConflictCause}).
 * @param context - The run; its paths and retry are named.
 * @param kind - `gone` for an empty name, `changed` for another file or other bytes, `unread` for a read that failed.
 * @param cause - The failure behind it, kept for diagnosis and never put into the sentence.
 * @returns The error, not thrown yet.
 * @example
 * throw adoptedReceiptConflictError(run, 'gone') // 'Codebook wrote its record of the "codebook" entry in Devin Desktop's MCP config at … to …/receipt.json while it adopted a setup that ended early, and then found nothing there …'
 */
function adoptedReceiptConflictError(
  { path, receiptPath, pendingPath, retry }: Context,
  kind: JournalConflictError['kind'],
  cause?: unknown,
): ReceiptConflictError {
  const found = {
    gone: 'found nothing there (a backup or sync tool may have moved that record away)',
    changed:
      'found another file or other bytes there (a backup or sync tool may have put another one there)',
    unread: 'could not read that name again',
  }[kind]
  // A name that could not be read asks for a readable file, one another program changed for that program to finish.
  const wayOut =
    kind === 'unread'
      ? 'make that file readable by you if it is not'
      : 'wait until that tool is done'
  return new ReceiptConflictError(
    `Codebook wrote its record of the "${SERVER_NAME}" entry in Devin Desktop's MCP config at ${path} to ${receiptPath} while it adopted a setup that ended early, and then ${found}, so it kept its record of that setup at ${pendingPath}, left ${receiptPath} as it is and went no further; ${wayOut}, ${retry}, and that run decides that setup again.`,
    cause === undefined ? undefined : { cause },
  )
}

/**
 * Tells whether a failure to end the record an adoption rests on came from a conflict at a record's name ({@link JournalConflictError}), the failure itself or any cause it carries: the setup record at `pending.json` or its dropping name, the rollback journal's name ({@link JournalBackConflictError}) or a held legacy journal's ({@link HeldJournalConflictError}); called only by {@link adoptPending}, which then takes the receipt it published back out ({@link withdrawAdoptedReceipt}).
 * The cause chain counts because a refusal that ends the run may carry the conflict that stopped the step as its cause, as a put-back that failed after a rollback record came back does ({@link renewOrPutBack}).
 * @param error - What the record's retirement threw ({@link retirePending}).
 * @returns
 * - `true` when the failure or a cause in its chain is a {@link JournalConflictError}: a record the adoption rests on changed, disappeared or could not be read again after the receipt's rename
 * - `false` for any other failure (a full disk, an I/O error, the old record's private name filled again), which leaves the adopted record as it was
 * @example
 * hasRecordConflictCause(journalConflictError(run, 'changed')) // => true
 * hasRecordConflictCause(new Error('wrapped', { cause: asJournalBackConflict(conflict) })) // => true
 * hasRecordConflictCause(Object.assign(new Error('no space'), { code: 'ENOSPC' })) // => false
 */
function hasRecordConflictCause(error: unknown): boolean {
  const seenErrors = new Set<Error>()
  let chainError: unknown = error
  // Each error in the chain is looked at once, so a chain whose causes loop back still ends.
  while (chainError instanceof Error && !seenErrors.has(chainError)) {
    if (chainError instanceof JournalConflictError) return true
    seenErrors.add(chainError)
    chainError = chainError.cause
  }
  return false
}

/**
 * Takes the receipt an adoption just published back out once a record that adoption rests on changed after the receipt's rename, so the adoption could not end its record ({@link hasRecordConflictCause}: a rollback record at its name again, another setup record at `pending.json`), only while `receipt.json` still shows the very version that adoption's write published there ({@link Context.receiptVersion}, which {@link writeReceipt} moved to it), so the next run, which settles those records first, takes the failed setup back when they say so instead of finding its receipt ({@link finishCutShortSetup}); called only by {@link adoptPending}.
 * The delete is {@link dropReceipt}'s: the name is read through the thread pool and must show that inode and those bytes, then it is looked at once more synchronously, and the receipt moves to its dropping name and is deleted there only while it proves to be that version, so a file a backup or sync tool put there since, even one with the same bytes on another inode, stays, also one renamed over that name after the last look.
 * When the delete fails, or the name cannot be read, the receipt stays and the caller names it ({@link withKeptAdoptedReceipt}); it never keeps the next run from the take-back a record of that setup asks for, because it carries the adoption's mark ({@link Receipt.adopted}, {@link isTakeBackCovered}), and neither does a receipt that stays because the run ended before this step.
 * Limit: those of {@link dropReceipt}; a receipt that another program replaced stays and is not named (it is no longer the file this adoption wrote; a copy of its bytes carries the same mark).
 * @param context - The run; its receipt version is the one the adoption's write published.
 * @param replaced - The receipt the adoption replaced, which this withdrawal puts back; undefined when none stood there, in which case the adopted receipt is deleted instead ({@link dropReceipt}).
 * @returns
 * - `true` once nothing of this adoption's receipt stands at `receipt.json`: this call put the replaced receipt back over it or deleted it, or the name shows nothing, another file or other bytes
 * - `false` when it may still stand there: the write-back or delete failed, or the name could not be read, by the step's own look or by one more look after it
 * @example
 * await withdrawAdoptedReceipt(run, replaced) // => true; receipt.json holds the replaced receipt again, written only over the version the adoption published
 * await withdrawAdoptedReceipt(run, undefined) // => false once the disk answered that unlink with EIO
 */
async function withdrawAdoptedReceipt(
  context: Context,
  replaced: Receipt | undefined,
): Promise<boolean> {
  const written = context.receiptVersion.current
  // The adoption replaced a receipt: it goes back through the same write, which publishes it only over the very version this adoption's write left at the name, so a file another program put there since is never written over, and the entry that receipt records keeps its record once the adoption's answer is no. A write that fails or meets such a file leaves the name as it is; the look below then tells what stands.
  if (replaced !== undefined) {
    await writeReceipt(context, replaced).catch(() => undefined)
    const standingAfter = await inspectCopy(context.receiptPath).catch(
      () => written,
    )
    return (
      standingAfter?.ino !== written?.ino ||
      standingAfter?.sha256 !== written?.sha256
    )
  }
  const answer = await dropReceipt(context).catch(() => undefined)
  if (answer === 'gone') return true
  // The delete failed: the receipt stays where it was.
  if (answer === undefined) return false
  // Kept: the name showed another file or other bytes, or could not be read; one more look tells them apart, and a look that fails again proves nothing, so it counts as the receipt still there.
  const standing = await inspectCopy(context.receiptPath).catch(() => written)
  return standing?.ino !== written?.ino || standing?.sha256 !== written?.sha256
}

/** A {@link JournalConflictError} at the rollback journal's name met by the look an adoption rests on ({@link journalLeftCheck}): a rollback record stands there where settlement left none, another file stands there than the one it left, or that name could not be read again; {@link adoptPending} takes back the receipt it published when this ends its record's retirement, as it does for a held journal's ({@link HeldJournalConflictError}). */
class JournalBackConflictError extends JournalConflictError {}

/**
 * Looks at the rollback journal's name through the thread pool and gives the synchronous look that must still find there what {@link settleRollbackJournal} left (nothing, or another config's journal it read), right before an adoption publishes its receipt and right before the record it adopted ends; called by {@link settlePending} for the adoption ({@link adoptPending}), so a rollback record of that setup that a backup restores meanwhile stops the adoption and the next run settles that record first.
 * A run that holds a legacy journal gets that journal's own look instead ({@link HeldJournal.lookStill}).
 * Limit: a rollback record put at that name after the last synchronous look before the record's rename or unlink, or after the run, is decided without that record, like one restored after the run.
 * @param context - The run; the journal's name is beside its pending path ({@link rollbackContextOf}).
 * @param otherVersion - The version of another config's journal settlement read and left there ({@link SettledJournal.otherVersion}); undefined when it left that name empty.
 * @param assertHeldStill - Beside a held legacy journal, the look it gave ({@link HeldJournal.lookStill}); undefined otherwise.
 * @returns
 * - `assertHeldStill` itself when it is given
 * - otherwise the look at the journal's name, which throws as below right before the rename or unlink ({@link assertNameLeft})
 * @throws A {@link JournalBackConflictError} with the rollback record's sentence ({@link journalConflictError}): `changed` when the name shows a file where settlement left none, or another file or other bytes than the journal it left; `unread` when it cannot be read; nothing is written then.
 * @example
 * await writeReceipt(run, adopted, bothLooks(await adoptedRecordCheck(run), await journalLeftCheck(run, undefined))) // throws, writing no receipt, once a backup put a rollback record back at pending.json.rollback
 */
async function journalLeftCheck(
  context: Context,
  otherVersion: RecordVersion | undefined,
  assertHeldStill?: StillLook,
): Promise<StillLook> {
  if (assertHeldStill) return assertHeldStill
  // The name is tracked as settlement left it: empty, or the other config's journal as read.
  const journalRun: Context = {
    ...rollbackContextOf(context),
    journalVersion: { current: otherVersion },
  }
  const left = await lookAtTrackedJournal(journalRun).catch(
    (error: unknown) => {
      throw asJournalBackConflict(error)
    },
  )
  return {
    names: [journalRun.pendingPath],
    assert: (): void => {
      try {
        assertNameLeft(journalRun, left)
      } catch (error) {
        throw asJournalBackConflict(error)
      }
    },
  }
}

/**
 * Words a conflict met at the rollback journal's name by the look an adoption rests on as a {@link JournalBackConflictError}, keeping its sentence and kind; called by {@link journalLeftCheck} and the look it gives.
 * @param error - What the look threw.
 * @returns
 * - a {@link JournalBackConflictError} with the same message and kind, the conflict as its cause, for a {@link JournalConflictError}
 * - `error` itself otherwise
 * @example
 * throw asJournalBackConflict(journalConflictError(journalRun, 'changed')) // 'While Codebook settled its rollback record at …/pending.json.rollback (a rollback that ended early), another program changed, removed or replaced it …'
 */
function asJournalBackConflict(error: unknown): unknown {
  if (!(error instanceof JournalConflictError)) return error
  return new JournalBackConflictError(error.message, error.kind, {
    cause: error,
  })
}

/**
 * Gives the synchronous look that must still find the publish record an adoption rests on at `pending.json`, as this run read or last wrote it ({@link Context.journalVersion}), right before the rename that publishes the adoption's receipt, once a read through the thread pool found it there; called only by {@link adoptPending}, which joins it with the look at the rollback journal's name ({@link journalLeftCheck}) and whose receipt write awaits a look at those names once more before its synchronous looks ({@link writeReceipt}), and which calls it again once the record ended and runs its look at once, so `pending.json` must still show what that end left there (nothing, or what stays of the record).
 * Limit: a record put there after that synchronous look, also after the receipt's rename, is seen only by the record's retirement right after ({@link retirePending}) or by that look after it, which keep that record, refuse and take that receipt back out ({@link withdrawAdoptedReceipt}), as they do for a rollback record put back at its name; no Node primitive renames only while another name shows a given inode.
 * @param context - The run; it tracks its publish record ({@link trackedPublishContext}).
 * @returns The look at the publish record's name ({@link StillLook}).
 * @throws A {@link JournalConflictError}: `changed` when the name shows another file or other bytes, `unread` when it cannot be read again, `gone` when it is empty while this run knows a version of it; the look it gives throws the same right before the rename ({@link assertNameLeft}). Nothing is written then.
 * @example
 * await writeReceipt(context, adopted, await adoptedRecordCheck(context)) // throws, writing no receipt, once a backup put another record at pending.json
 */
async function adoptedRecordCheck(context: Context): Promise<StillLook> {
  const left = await lookAtTrackedJournal(context)
  // An empty name while a version is known: another program moved the record away after this run read it.
  if (!left && isEmptiedByAnother(context))
    throw journalConflictError(context, 'gone')
  return {
    names: [context.pendingPath],
    assert: (): void => assertNameLeft(context, left),
  }
}

/**
 * Tells whether a publish is a first setup: no receipt stands, or the receipt's entry no longer stands in the config (only `mcp_config.json` was deleted, or a removal took the entry out and left its receipt behind); called once by {@link publishEntry}.
 * A first setup moves that stale receipt aside once its own publish record is written, right before the link that exposes its entry, and puts it back when that link fails ({@link linkWithoutStaleReceipt}); it starts a new installation id (so descriptors marked before a removal stay refused) and marks its publish record, so a run that stops before its receipt is taken back ({@link isTakeBackOwed}). Every other publish that a receipt stands for is an update of the entry it owns: a changed or foreign entry is refused before any publish.
 * @param look - What the config looked like.
 * @param receipt - The receipt that stands, if any.
 * @returns
 * - `true` when no receipt owns the `codebook` entry that stands now (none stands, or the receipt is gone)
 * - `false` for an update of the receipted entry
 * @example
 * isFirstSetup({ kind: 'absent' }, undefined)         // => true
 * isFirstSetup({ kind: 'absent' }, staleReceipt)      // => true
 * isFirstSetup(lookWithReceiptedEntry, receipt)       // => false
 */
function isFirstSetup(look: ConfigLook, receipt: Receipt | undefined): boolean {
  return receipt === undefined || !ownsEntry(currentEntryOf(look), receipt)
}

/**
 * Builds the refusal for a stale receipt that could not be moved aside before a first setup links its config in; called by {@link retireStaleReceipt}.
 * @param context - The run; gives the receipt's path and the command to run again.
 * @param cause - The failure of the move, kept for diagnosis and never put into the sentence.
 * @returns The error, not thrown yet.
 * @example
 * throw staleReceiptRefusal(context, error) // 'Codebook could not delete its own old record of a setup whose entry is gone, at …/receipt.json, so it changed nothing; delete that record by hand, then run Codebook: Set Up AI Chat again.'
 */
function staleReceiptRefusal(
  { receiptPath, retry }: Context,
  cause: unknown,
): Error {
  // A folder where the record stood is never Codebook's: it is moved aside intact, never deleted.
  if (isFolderAt(receiptPath))
    return new Error(
      `Codebook could not delete its own old record of a setup whose entry is gone, because a folder stands at ${receiptPath} where that record stood, so it changed nothing; move that folder to another folder, never delete it, because it may hold files of yours, ${retry}.`,
      { cause },
    )
  return new Error(
    `Codebook could not delete its own old record of a setup whose entry is gone, at ${receiptPath}, so it changed nothing; delete that record by hand, ${retry}.`,
    { cause },
  )
}

/**
 * Builds the refusal for a stale receipt that another program saved again between this run's read and its move aside (a sync or backup tool restoring one); called by {@link retireStaleReceipt}, which throws it once that receipt went back to its name and hands the other wording to the put-back, whose error carries it when the receipt could not go back ({@link UnrestoredReceiptError}).
 * @param context - The run; gives the receipt's path, the config path and the command to run again.
 * @param isPutBack - Whether the changed receipt stands at its name again; `false` words the refusal without that claim, and the put-back's own sentence then says where the receipt is.
 * @returns The error, not thrown yet.
 * @example
 * throw changedRecordRefusal(context, true) // 'Codebook found that its own old record at …/receipt.json changed while it was setting up, so it put that record back and changed nothing in Devin Desktop's MCP config at …; then run Codebook: Set Up AI Chat again.'
 * changedRecordRefusal(context, false)       // 'Codebook found that its own old record at …/receipt.json changed while it was setting up, so it changed nothing in Devin Desktop's MCP config at …; then run Codebook: Set Up AI Chat again.'
 */
function changedRecordRefusal(
  { receiptPath, path, retry }: Context,
  isPutBack: boolean,
): Error {
  const outcome = isPutBack ? 'put that record back and changed' : 'changed'
  return new Error(
    `Codebook found that its own old record at ${receiptPath} changed while it was setting up, so it ${outcome} nothing in Devin Desktop's MCP config at ${path}; ${retry}.`,
  )
}

/**
 * Builds the refusal for a first setup's old record that waits under its private name while the config holds the entry that record covers, which that setup may have published too ({@link retiredReceiptFateOf}); called by {@link settleRetiredReceipt} before anything is changed.
 * @param context - The run; gives the config and publish record paths and the command to run again.
 * @param retiredPath - The private name that holds the old record.
 * @returns The error, not thrown yet.
 * @example
 * throw undecidedReceiptRefusal(context, retiredPath) // 'Codebook found a "codebook" entry in Devin Desktop's MCP config at … that a setup which ended early may have written, … remove that entry by hand, delete both records, then run Codebook: Set Up AI Chat again.'
 */
function undecidedReceiptRefusal(
  { path, pendingPath, retry }: Context,
  retiredPath: string,
): Error {
  return new Error(
    `Codebook found a "${SERVER_NAME}" entry in Devin Desktop's MCP config at ${path} that a setup which ended early may have written, and its own old record at ${retiredPath} covers that same entry, so it cannot tell which setup the entry belongs to. Codebook changed nothing and kept both records (${pendingPath}, ${retiredPath}); remove that entry by hand, delete both records, ${retry}.`,
  )
}

/**
 * Builds the private name a first setup moves a stale receipt to right before its link ({@link retireStaleReceipt}): beside `receipt.json` in Codebook's records folder and named by the publish's generation, so only that publish's record ({@link Pending.retiresReceipt}) leads a later run to it ({@link settleRetiredReceipt}).
 * @param context - The run; its receipt path names the folder.
 * @param generation - The generation of the publish that moves the receipt.
 * @returns The private path.
 * @example
 * retiredReceiptPathOf(context, 'c0ffee00-0000-4000-8000-000000000001') // => '/storage/devin-mcp/receipt.json.c0ffee00-0000-4000-8000-000000000001.retired'
 */
function retiredReceiptPathOf(context: Context, generation: string): string {
  return `${context.receiptPath}.${generation}.retired`
}

/** What names the file a first setup moved to its old record's private name: the SHA-256 of its bytes, and, in the setup itself, the inode its run read at `receipt.json` ({@link retiringIdentityOf}) or, for its undo of a move that found another receipt ({@link retireStaleReceipt}), the inode the look before the move found there; at a later run a byte-identical copy on another inode still matches a record's identity, which names no inode. */
type MovedIdentity = { sha256: string; ino?: bigint }

/**
 * Gives the identity a publish record names for the file its first setup moved to the old record's private name; called by {@link settleRetiredReceipt}, {@link retiredReceiptFateOf} and {@link retiringIdentityOf}.
 * @param pending - The publish record as read or written.
 * @returns The bytes' hash of this build's record ({@link retiredReceiptSchema}); undefined for `true`, `foreign` and a record without a hash, which name no file, so no file there is put back or deleted on their word.
 * @example
 * movedIdentityOf({ ...pending, retiresReceipt: { sha256: '9f86…' } }) // => { sha256: '9f86…' }
 * movedIdentityOf({ ...pending, retiresReceipt: true })                // => undefined
 */
function movedIdentityOf(pending: Pending): MovedIdentity | undefined {
  const { retiresReceipt } = pending
  // Only this build's form names the bytes of the receipt that moved.
  return typeof retiresReceipt === 'object' &&
    retiresReceipt.sha256 !== undefined
    ? { sha256: retiresReceipt.sha256 }
    : undefined
}

/**
 * Tells whether a file read at the old record's private name is the one a publish record names ({@link MovedIdentity}); called before every put-back, comparison and delete of that file ({@link readMovedForPutBack}, {@link compareStandingReceipt}, {@link dropRetiredReceipt}, {@link retiredReceiptFateOf}) and by {@link retireStaleReceipt} right after the move.
 * @param identity - What names the moved file; undefined when nothing does.
 * @param file - The bytes' hash and the inode of the file that was read; no hash for a file that holds no receipt.
 * @returns `true` when the bytes match, and the inode too when the identity names one; `false` otherwise, also without an identity.
 * @example
 * isMovedFile({ sha256: '9f86…' }, { sha256: '9f86…', ino: 43n })       // => true
 * isMovedFile({ sha256: '9f86…', ino: 42n }, { sha256: '9f86…', ino: 43n }) // => false
 * isMovedFile(undefined, { sha256: '9f86…', ino: 42n })                // => false
 */
function isMovedFile(
  identity: MovedIdentity | undefined,
  file: { sha256?: string; ino: bigint },
): boolean {
  return (
    identity !== undefined &&
    file.sha256 === identity.sha256 &&
    (identity.ino === undefined || file.ino === identity.ino)
  )
}

/**
 * Gives the identity of the file a first setup's move took to the private name when that file was not the receipt this run read, so the undo puts back only that file ({@link retireStaleReceipt}): the file read right after the move, while its inode is the one the look before the move found at `receipt.json`.
 * @param moved - What the read right after the move found at the private name.
 * @param movedIno - The inode the look right before the move found at `receipt.json`.
 * @returns That file's bytes' hash and inode; undefined when the read found no receipt or another inode, so nothing names the file the move took and the undo links nothing.
 * @example
 * undoIdentityOf({ read: changedReceipt, look, sha256: 'ab…' }, look.ino) // => { sha256: 'ab…', ino: look.ino }
 */
function undoIdentityOf(
  moved: LookedRecord | undefined | 'unread',
  movedIno: bigint,
): MovedIdentity | undefined {
  // Only a receipt in the file the move took there: another inode may be a file put at the private name after the move.
  if (typeof moved !== 'object' || moved.sha256 === undefined) return undefined
  return moved.look.ino === movedIno
    ? { sha256: moved.sha256, ino: movedIno }
    : undefined
}

/**
 * Reads the old receipt a first setup is about to move aside once more, through one handle, right before the publish record that names its bytes is written, so the move goes on only with those bytes ({@link Pending.retiresReceipt}) and only while `receipt.json` still shows the version the run's own read found there ({@link Context.receiptVersion}: the inode and the raw bytes' hash), which the check right after the move compares again ({@link linkRetiringStaleReceipt}); called only by {@link publishRoot}, before anything is staged.
 * @param context - The run.
 * @param staleReceipt - The receipt the run's inspection read.
 * @returns The SHA-256 of the bytes read, which parse to that receipt; undefined when the run read no version there and nothing stands there now, so nothing is moved aside.
 * @throws A {@link staleReceiptRefusal} when the name holds a link, no regular file, too many bytes, or cannot be read; a {@link changedRecordRefusal} (no put-back claimed) when the name no longer shows the version the run read (another inode, other bytes, or nothing: a sync tool may have put a copy there or moved that record away) or the bytes no longer parse to that receipt. Nothing is written or moved then.
 * @example
 * await readRetiringReceipt(context, staleReceipt) // => '9f86…'
 */
async function readRetiringReceipt(
  context: Context,
  staleReceipt: Receipt,
): Promise<string | undefined> {
  let read: RecordFileRead | undefined
  try {
    read = await readRecordFile(
      context.receiptPath,
      context.retry,
      context.seam,
    )
  } catch (cause) {
    // A name the move could not take safely: nothing moves, as when the move itself fails.
    throw staleReceiptRefusal(context, cause)
  }
  const expected = context.receiptVersion.current
  // Nothing was read there and nothing stands there: nothing to move aside.
  if (read === undefined && expected === undefined) return undefined
  // Only the version the run read moves aside: a name emptied since, or a file put there since (even a copy with the same bytes at another inode), stays as it is.
  if (
    read === undefined ||
    expected === undefined ||
    read.ino !== expected.ino ||
    bytesSha256(read.bytes) !== expected.sha256
  )
    throw changedRecordRefusal(context, false)
  let receipt: Receipt
  try {
    receipt = parseRecord(
      context.receiptPath,
      receiptSchema,
      context.retry,
      read.bytes,
    )
  } catch {
    throw changedRecordRefusal(context, false)
  }
  // Saved again since the inspection: nothing moves, and the next run reads that record.
  if (canonicalJson(receipt) !== canonicalJson(staleReceipt))
    throw changedRecordRefusal(context, false)
  return bytesSha256(read.bytes)
}

/**
 * Moves the receipt of an entry that is gone to its private name ({@link retiredReceiptPathOf}) right before a first setup links its config in, so no reader takes the new entry for that receipt's, and a run that stops before the new receipt leaves an entry that is taken back; called by {@link linkWithoutStaleReceipt} when {@link isFirstSetup} held and a receipt stood, once the setup's own publish record, which names that move ({@link Pending.retiresReceipt}), is written.
 * Safe because the entry that receipt owned no longer stands, so it covers nothing. A move instead of a delete: putting the receipt back after a failed link needs no free space ({@link putBackRetiredReceipt}). Only a regular file moves, and the file that moved must hold the bytes this run's publish record names ({@link isMovedFile}): another one, saved at that name since, goes back and the setup refuses, but only while the file at the private name is provably the one the move took there (the inode the look before the move found, and the bytes read right after it, {@link undoIdentityOf}); without that proof nothing goes to `receipt.json`, and that file is kept and named.
 * @param context - The run.
 * @param identity - The bytes of the receipt this run read, as its publish record names them, and the inode its run read them from ({@link retiringIdentityOf}), so a copy with the same bytes that a sync tool swapped in at another inode right before the move goes back.
 * @param generation - The generation of the publish; names the private path.
 * @returns The private path that holds the receipt now, with the look at that name before the read that found the receipt there ({@link RetiredMove}), so the delete after the link acts only on that file ({@link dropMovedAfterLink}); undefined when nothing stood at the receipt's name any more, so nothing is to put back.
 * @throws A {@link staleReceiptRefusal} when the name holds no regular file or the move fails, and a {@link changedRecordRefusal} once another receipt that moved went back; nothing is linked then. An {@link UnrestoredReceiptError} carrying that refusal, worded without the put-back, when the other receipt could not go back.
 * @example
 * await retireStaleReceipt(context, receipt, generation) // => { retiredPath: '/storage/devin-mcp/receipt.json.<generation>.retired', look: { ino: 42n, size: 310n, mtimeNs, ctimeNs } }
 */
async function retireStaleReceipt(
  context: Context,
  identity: MovedIdentity,
  generation: string,
): Promise<RetiredMove | undefined> {
  const retiredPath = retiredReceiptPathOf(context, generation)
  let movedIno: bigint
  try {
    const status = await lstatOrAbsent(context.receiptPath)
    if (!status) return undefined
    if (!status.isFile()) throw new Error('The record is no regular file.')
    movedIno = status.ino
    await rename(context.receiptPath, retiredPath)
    // This run emptied that name itself: its own receipt claims it, never replacing what a backup puts back there.
    context.receiptVersion.current = undefined
  } catch (cause) {
    // Gone between the look and the move: nothing stands to put back.
    if (codeOf(cause) === 'ENOENT') return undefined
    throw staleReceiptRefusal(context, cause)
  }
  const moved = await readLookedRecord(context, retiredPath)
  // The bytes the publish record names: the receipt this run read moved.
  if (
    typeof moved === 'object' &&
    isMovedFile(identity, { sha256: moved.sha256, ino: moved.look.ino })
  )
    return { retiredPath, look: moved.look }
  // Another receipt was saved at that name since the read: it goes back only as the file the move took there, and nothing is published. A put-back that fails carries the refusal that claims no put-back, and its own sentence says where the receipt is.
  const undoIdentity = undoIdentityOf(moved, movedIno)
  await putBackRetiredReceipt(
    context,
    retiredPath,
    changedRecordRefusal(context, false),
    { identity: undoIdentity },
  ).catch((error: unknown) => {
    // The proven file the move took waits at the private name: the record that leads the next run there names its bytes, not the receipt this run read.
    throw error instanceof UnrestoredReceiptError && undoIdentity !== undefined
      ? new UndoneMoveError(context, error, undoIdentity.sha256)
      : error
  })
  throw changedRecordRefusal(context, true)
}

/** A first setup's old record at its private name as {@link retireStaleReceipt} verified it there: that name and the look of the open file whose bytes are the ones its publish record names ({@link LeftoverLookback}). */
type RetiredMove = { retiredPath: string; look: LeftoverLookback }

/**
 * Puts a receipt that a first setup moved aside back at `receipt.json`; called by {@link linkWithoutStaleReceipt} when the link failed, by {@link retireStaleReceipt} when the file that moved was not the receipt it read, and by {@link settleRetiredReceipt} at a later run.
 * A hard link: it needs no free space and never replaces what stands at that name by then; where the storage gives no file a second name ({@link NO_LINK_CODES}), a rename into that empty name right after a last look finds it empty, checked at `receipt.json` afterwards ({@link renameMovedRecord}). Right before either, while `receipt.json` is empty, the publish record notes that `receipt.json` is unverified unless it holds the bytes that were read ({@link noteBeforePutBack}), so a run that stops right after the link leaves that note, and the note goes again when nothing reached that name ({@link withdrawPutBackNote}); that write needs free space, so on a full disk the put-back still links without it. Only a regular file that parses as a record of this config, read at the private name, which a look right before the link still shows, is linked ({@link readMovedForPutBack}), and only while synchronous looks run in the same continuation as the link, after every awaited step, still show at a later run the publish record that run read at `pending.json`, and last that file at the private name ({@link lookBeforePutBackLink}); a file there that is no record of this config is never linked and is named as the one to move. When the name is taken, the moved record goes only while it and a record that stands there are both records of this config with the same entry (a newer one, which wins, {@link standingReceiptOf}); a name found empty again is linked again, with at most {@link DEVIN_RECEIPT_PUT_BACK_ATTEMPTS} links in all. A put-back chosen only because something stood at `receipt.json` (`options.isBesideStanding`) never links: it only compares with what stands there ({@link settleTakenName}). After a link that stood, the private name is unlinked only while a read at `receipt.json` still finds the record that was read and looks still show the file of that read at `receipt.json` and at the private name as a second name of it ({@link dropLinkedPrivateName}); otherwise that file and the publish record stay, also beside another file at `receipt.json`, which the link may have put there (the private name was replaced right before it) or another program after it, so neither name goes ({@link refuseUnverifiedLink}). A private name that the link or a look found empty is never unlinked, and it never ends the publish record that leads there by itself ({@link endOnEmptyName}): in the setup that moved the record there, Codebook put a verified file there moments earlier, so the setup keeps that record and says so; a later run ends that record only while a look right before that end still finds the name empty ({@link retirePending}).
 * @param context - The run.
 * @param retiredPath - The private name that holds the receipt.
 * @param failure - What made the put-back necessary, carried by the error below so the caller still words it; undefined at a later run.
 * @param options - How this put-back runs ({@link PutBackOptions}); a setup passes none.
 * @returns
 * - `settled` once the receipt stands at `receipt.json` again, or was dropped beside a record that covers it
 * - `empty` at a later run whose link or look found the private name empty: the caller ends the publish record that leads there only after one more look ({@link settleRetiredReceipt})
 * @throws An {@link UnrestoredReceiptError} naming the private file when the receipt could not go back: with `other` when something that is not Codebook's record of that entry stands at `receipt.json`, with `foreign` when a record of this config stands there and the moved file is no record of this config, with `superseded` when the record that stands there owns the entry the config holds and the moved one does not, with `config-unread` when the config could not be read to tell or changed by the last looks after it told, with `receipt-unverified` when the publish record notes that receipt.json is unverified and the record the comparison read there is not the very bytes that note names ({@link readStandingReceipt}), with `unread` when the look there failed or the name kept changing, with `moved-unread` when the moved record could not be read, with `moved-changed` when its private name showed another file after the read, with `undeleted` when the moved record was to be deleted beside a record that covers it, or its private name after a link that stood, and that name showed another file or was that record's only name, `receipt.json` no longer showed that record, or the delete failed, with `undeleted-replaced` when after a link that stood `receipt.json` still holds that record and the private name shows another file, which is named apart from it, with `linked-unverified` when `receipt.json` shows another file than the record that was read after the link, which nothing proves the link's own ({@link refuseUnverifiedLink}), or the file the link put there no longer holds that record, with `renamed-unverified` when `receipt.json` holds another file than that record after the rename of the route without links ({@link confirmRenamedRecord}), with `moved-gone` when a setup's own put-back (one with a `failure`) found the private name empty, or `moved-gone-beside` when it found that name empty beside something at `receipt.json`, by a look or by the delete beside a record that covers it, with `moved-foreign` when the file at the private name is no record of this config and nothing stands at `receipt.json`, with `moved-foreign-other` or `moved-foreign-unread` when something that is not Codebook's record of that entry stands there instead or Codebook could not tell what stands there, without any of them for any other link failure; worded without a promised put-back when `options.mark` is `unmarked`. That file stays, and so does the publish record that names it. The {@link undecidedReceiptRefusal} when a put-back chosen only beside what stood at `receipt.json` finds that name empty; nothing is linked, and both records stay. A {@link JournalConflictError} at a later run whose publish record changed, disappeared or could not be read right before the link ({@link lookBeforePutBackLink}); nothing is linked, and both receipt names stay as they are.
 * @example
 * await putBackRetiredReceipt(context, retiredPath, linkError) // => 'settled' once receipt.json stands again
 * await putBackRetiredReceipt(context, retiredPath, undefined, { mark: 'unmarked' }) // => 'empty' when a later run finds the private name empty
 */
async function putBackRetiredReceipt(
  context: Context,
  retiredPath: string,
  failure?: unknown,
  options: PutBackOptions = {},
): Promise<PutBackEnd> {
  // Chosen only because something stood at receipt.json: compare with what stands there, and never link into that name, which may be empty by now.
  if (options.isBesideStanding)
    return settleTakenName(context, retiredPath, failure, undefined, options)
  // Only a record of this config that the private name still shows right before the link goes to receipt.json.
  const linked = await readMovedForPutBack(
    context,
    retiredPath,
    failure,
    options,
  )
  if (typeof linked === 'string') return linked
  // Before anything can reach receipt.json, the publish record names the bytes that may stand there, so a run that stops right after the link leaves that note.
  const note = await noteBeforePutBack(context, retiredPath, linked.sha256)
  const putBack: LinkedPutBack = { retiredPath, failure, linked, options, note }
  const attempt = await linkMovedRecord(context, putBack).catch(
    async (error: unknown) => {
      // Nothing was linked: the note goes again.
      await withdrawPutBackNote(context, putBack)
      throw error
    },
  )
  // The last looks found the private name empty: nothing was linked.
  if (typeof attempt === 'string') {
    await withdrawPutBackNote(context, putBack)
    return attempt
  }
  return settleLinkAttempt(context, putBack, attempt.cause)
}

/** One put-back of a first setup's old record past its read ({@link putBackRetiredReceipt}): the private name, what made it necessary (undefined at a later run), the record of this config that was read there ({@link MovedRecord}), how it runs ({@link PutBackOptions}) and the note this put-back wrote right before its link ({@link PutBackNote}). */
type LinkedPutBack = {
  retiredPath: string
  failure: unknown
  linked: MovedRecord
  options: PutBackOptions
  note: PutBackNote
}

/** The note that `receipt.json` is unverified as one put-back wrote it into the publish record right before its link ({@link noteBeforePutBack}): the bytes it names and the publish record's `retiresReceipt` as it stood before, which {@link withdrawPutBackNote} writes back when nothing reached `receipt.json`; undefined when this put-back wrote no note (one stood already, `receipt.json` was not empty, or the write failed). */
type PutBackNote =
  { sha256: string; before: Pending['retiresReceipt'] } | undefined

/**
 * Notes in the publish record that `receipt.json` is unverified unless it holds the bytes a put-back is about to link there, right before that link, so a run that stops right after the link, or a full disk at the write after it, never leaves a file another program swapped in at the private name (criterion 17's residual) at `receipt.json` without that note; called only by {@link putBackRetiredReceipt}, once the old record was read ({@link readMovedForPutBack}).
 * The note passes those very bytes, so the record that goes back stands for every reader ({@link assertNotedReceipt}, the bridge's receipt reader); it is written only while `receipt.json` is empty at an awaited look, because a name that holds something takes no link. Best effort: a write that fails (a full disk, say) leaves the record as it was, and the put-back still links, as it does without free space; the run's answer then says whether the note stands ({@link withNoteState}). Limit: a file put at `receipt.json` between that look and the link meets a note that names other bytes until {@link withdrawPutBackNote} takes it back.
 * @param context - The run; its pending path is the publish record, rewritten through its tracked guard ({@link rewriteLeadingRecord}).
 * @param retiredPath - The old record's private name; only the publish record that leads there is noted.
 * @param sha256 - The SHA-256 of the bytes the put-back read at the private name and links.
 * @returns The note this call wrote ({@link PutBackNote}); undefined when it wrote none.
 * @example
 * await noteBeforePutBack(context, retiredPath, linked.sha256) // => { sha256: '9f86…', before: { sha256: '9f86…' } }; pending.json now carries receiptUnverified
 */
async function noteBeforePutBack(
  context: Context,
  retiredPath: string,
  sha256: string,
): Promise<PutBackNote> {
  // A name that holds something, or that cannot be looked at, takes no link that this note would cover.
  const standing = await lstatOrAbsent(context.receiptPath).catch(() => null)
  if (standing !== undefined) return undefined
  const rewrite = await rewriteLeadingRecord(context, retiredPath, (record) =>
    notedRecordOf(record, sha256),
  )
  return rewrite.outcome === 'written'
    ? { sha256, before: rewrite.record?.retiresReceipt }
    : undefined
}

/**
 * Gives a publish record that notes `receipt.json` unverified unless it holds the given bytes; called by {@link noteBeforePutBack} through {@link rewriteLeadingRecord}.
 * @param record - The publish record as read.
 * @param sha256 - The bytes the note passes.
 * @returns The record with `retiresReceipt.receiptUnverified` naming those bytes; undefined when it notes them already, or when it is an older build's record, whose put-back never links ({@link movedIdentityOf}).
 * @example
 * notedRecordOf({ ...pending, retiresReceipt: { sha256: '9f86…' } }, '9f86…') // => { ...pending, retiresReceipt: { sha256: '9f86…', receiptUnverified: true } }
 */
function notedRecordOf(record: Pending, sha256: string): Pending | undefined {
  const { retiresReceipt } = record
  // Only this build's record leads a put-back to its link, and one that notes those bytes already stays as it is.
  if (typeof retiresReceipt !== 'object' || isNotedBy(record, sha256))
    return undefined
  return {
    ...record,
    retiresReceipt: { ...retiresReceipt, sha256, receiptUnverified: true },
  }
}

/**
 * Tells whether a publish record notes `receipt.json` unverified unless it holds the given bytes; called by {@link notedRecordOf} and {@link withdrawPutBackNote}.
 * @param record - The publish record as read.
 * @param sha256 - The bytes the note must pass.
 * @returns `true` when `retiresReceipt` carries `receiptUnverified` with those bytes; `false` otherwise.
 * @example
 * isNotedBy({ ...pending, retiresReceipt: { sha256: '9f86…', receiptUnverified: true } }, '9f86…') // => true
 */
function isNotedBy(record: Pending, sha256: string): boolean {
  const { retiresReceipt } = record
  return (
    typeof retiresReceipt === 'object' &&
    retiresReceipt.receiptUnverified === true &&
    retiresReceipt.sha256 === sha256
  )
}

/**
 * Takes back the note a put-back wrote right before its link ({@link noteBeforePutBack}) once nothing of that put-back reached `receipt.json` (its last looks ended or threw, or its link or rename failed), so a later run never holds a record that comes to stand there meanwhile (a newer one of the same entry, say) against the bytes of an old record that never went back; called by {@link putBackRetiredReceipt}, {@link settleLinkAttempt} and {@link renameMovedRecord}.
 * Best effort and only while the publish record still carries that very note: the record goes back to the `retiresReceipt` it had before, through its tracked guard ({@link rewriteLeadingRecord}), so a record another program put there meanwhile stays. Limit: a stop or a failed write here leaves the note, and the next run then refuses any other bytes at `receipt.json` until they are moved ({@link assertReceiptVerified}).
 * @param context - The run.
 * @param putBack - The put-back ({@link LinkedPutBack}); nothing happens when it wrote no note.
 * @returns Resolves once the note is gone, or was left as it was.
 * @example
 * await withdrawPutBackNote(context, putBack) // pending.json carries retiresReceipt as it did before the note
 */
async function withdrawPutBackNote(
  context: Context,
  { retiredPath, note }: LinkedPutBack,
): Promise<void> {
  if (note === undefined) return
  await rewriteLeadingRecord(context, retiredPath, (record) =>
    isNotedBy(record, note.sha256)
      ? { ...record, retiresReceipt: note.before }
      : undefined,
  )
}

/**
 * Runs the last looks before a put-back's link and the link itself, with nothing awaited between the synchronous looks and the link ({@link lookBeforePutBackLink}); called only by {@link putBackRetiredReceipt}.
 * @param context - The run.
 * @param putBack - The put-back ({@link LinkedPutBack}).
 * @returns What {@link endOnEmptyName} answers when the last looks found the private name empty; otherwise the link's failure, undefined once the link stood.
 * @throws What {@link lookBeforePutBackLink} and its synchronous looks throw; nothing is linked then.
 * @example
 * await linkMovedRecord(context, putBack) // => { cause: undefined } once receipt.json is a second name of the old record
 */
async function linkMovedRecord(
  context: Context,
  { retiredPath, failure, linked, options }: LinkedPutBack,
): Promise<PutBackEnd | { cause: unknown }> {
  // The awaited steps come first: a later run reads its publish record, and every name is looked at through the thread pool.
  const lastLooks = await lookBeforePutBackLink(
    context,
    retiredPath,
    failure,
    options.mark,
  )
  // From the synchronous last looks to the link nothing is awaited: a record a backup put at pending.json, or a file at the private name, since those awaited steps keeps both receipt names as they are.
  const end = lastLooks(linked)
  if (end !== undefined) return end
  return link(retiredPath, context.receiptPath).then(
    () => ({ cause: undefined }),
    (cause: unknown) => ({ cause }),
  )
}

/**
 * Ends a put-back by what its link answered: a link that stood is checked before the private name goes ({@link dropLinkedPrivateName}), storage without hard links takes the rename into the empty name ({@link renameMovedRecord}), and any other failure takes back the note the put-back wrote before it ({@link withdrawPutBackNote}) and settles as before; called only by {@link putBackRetiredReceipt}.
 * @param context - The run.
 * @param putBack - The put-back ({@link LinkedPutBack}).
 * @param cause - The link's failure; undefined once the link stood.
 * @returns What {@link putBackRetiredReceipt} returns.
 * @throws What {@link putBackRetiredReceipt} throws.
 * @example
 * await settleLinkAttempt(context, putBack, undefined) // => 'settled' once the private name, a second name of the record at receipt.json, is gone
 */
async function settleLinkAttempt(
  context: Context,
  putBack: LinkedPutBack,
  cause: unknown,
): Promise<PutBackEnd> {
  const { retiredPath, failure, linked, options } = putBack
  if (cause === undefined)
    return dropLinkedPrivateName(
      context,
      retiredPath,
      failure,
      linked,
      options.mark,
    )
  // Storage that gives no file a second name: the record goes back by a rename into the empty name, checked like the link.
  if (NO_LINK_CODES.has(codeOf(cause)))
    return renameMovedRecord(context, putBack)
  // Nothing was linked: the note goes again.
  await withdrawPutBackNote(context, putBack)
  // ENOENT: the private name is gone already, and nothing is unlinked there, so a file put at that name after the link is never deleted unchecked.
  if (codeOf(cause) === 'ENOENT')
    return endOnEmptyName(context, retiredPath, failure, cause, options.mark)
  if (codeOf(cause) === 'EEXIST')
    return settleTakenName(context, retiredPath, failure, cause, options)
  throw new UnrestoredReceiptError(
    context,
    retiredPath,
    failure,
    cause,
    undefined,
    options.mark,
  )
}

/**
 * Puts a first setup's old record back at an empty `receipt.json` where the storage gives no file a second name, so that record goes back instead of every later run retrying a link the storage refuses; called by {@link settleLinkAttempt} once the put-back's link failed for that reason ({@link NO_LINK_CODES}).
 * The rename into the empty name the tracked records use ({@link renameIntoEmptyName}): the private name is read again through the thread pool (the inode and the bytes that were read, {@link lookAtStagedRecord}), then, with nothing awaited in between, a later run's publish record ({@link recordStillCheck}), the private name and the empty `receipt.json` are looked at synchronously right before the rename, which moves the file there; the note the put-back wrote before its link stays through it ({@link noteBeforePutBack}). Afterwards `receipt.json` must show that inode with those bytes ({@link confirmRenamedRecord}). Limits: those of {@link renameIntoEmptyName}; a file swapped in at the private name between the last look and the rename lands at `receipt.json` and is kept there as unverified (criterion 17's residual), while the private name is empty then.
 * @param context - The run.
 * @param putBack - The put-back ({@link LinkedPutBack}).
 * @returns `settled` once the old record stands at `receipt.json`; what {@link settleTakenName} answers when that name was taken at the last look, and what {@link endOnEmptyName} answers when the private name was empty.
 * @throws A {@link JournalConflictError} at a later run whose publish record changed, disappeared or could not be read right before the rename; an {@link UnrestoredReceiptError} with `renamed-unverified` from {@link confirmRenamedRecord}, with `moved-changed` or `moved-unread` when the private name no longer showed that record, or without a standing when the rename failed otherwise. Every refusal before the rename takes back the put-back's note ({@link withdrawPutBackNote}).
 * @example
 * await renameMovedRecord(context, putBack) // => 'settled' once a link in an exFAT storage folder answered ENOTSUP and the rename put the old record back
 */
async function renameMovedRecord(
  context: Context,
  putBack: LinkedPutBack,
): Promise<PutBackEnd> {
  const { retiredPath, failure, options } = putBack
  const refusal = await renameRecordBack(context, putBack).then(
    () => undefined,
    (error: unknown) => error,
  )
  if (refusal === undefined) return confirmRenamedRecord(context, putBack)
  // Nothing was renamed: the note goes again.
  await withdrawPutBackNote(context, putBack)
  if (refusal instanceof JournalConflictError) throw refusal
  // receipt.json was taken at the last look: as when the link finds that name taken.
  if (codeOf(refusal) === 'EEXIST')
    return settleTakenName(context, retiredPath, failure, refusal, options)
  return endRefusedRename(context, putBack, refusal)
}

/**
 * Renames a first setup's old record from its private name into the empty `receipt.json` while the private name still shows the file that was read and, at a later run, the publish record still stands as that run read it; the steps of {@link renameMovedRecord}.
 * @param context - The run.
 * @param putBack - The put-back ({@link LinkedPutBack}).
 * @returns Resolves once the rename moved the file there.
 * @throws An error with code `EEXIST` when `receipt.json` was taken at the last look; what {@link recordStillCheck} and {@link renameIntoEmptyName} throw.
 * @example
 * await renameRecordBack(context, putBack) // receipt.json now holds the old record, and its private name is empty
 */
async function renameRecordBack(
  context: Context,
  { retiredPath, failure, linked }: LinkedPutBack,
): Promise<void> {
  // A later run renames only on the word of its publish record as it read it; a setup's own put-back follows the record it wrote moments earlier.
  const recordStill =
    failure === undefined ? await recordStillCheck(context) : undefined
  await renameIntoEmptyName(
    context.receiptPath,
    {
      staged: retiredPath,
      version: {
        ino: linked.look.ino,
        sha256: linked.sha256,
      },
    },
    recordStill,
    () =>
      Object.assign(new Error(`${context.receiptPath} is not empty.`), {
        code: 'EEXIST',
      }),
  )
}

/**
 * Checks right after the rename of the route without links that `receipt.json` shows the old record that was read at the private name, its inode and its bytes, as the link route checks after its link ({@link dropLinkedPrivateName}); called only by {@link renameMovedRecord}.
 * @param context - The run.
 * @param putBack - The put-back ({@link LinkedPutBack}).
 * @returns `settled` once `receipt.json` shows that record.
 * @throws An {@link UnrestoredReceiptError} with `renamed-unverified` when `receipt.json` shows another file, other bytes or nothing, or cannot be read: the rename moved what stood at the private name right then, which nothing proves the record that was read, so that file stays and the publish record keeps noting `receipt.json` unverified ({@link noteBeforePutBack}, {@link keptRecordOf}).
 * @example
 * await confirmRenamedRecord(context, putBack) // => 'settled'
 */
async function confirmRenamedRecord(
  context: Context,
  { retiredPath, failure, linked, options }: LinkedPutBack,
): Promise<'settled'> {
  const moved = await readLookedRecord(context, context.receiptPath)
  // The very file that was read, with the bytes that were read: the old record stands at receipt.json again.
  if (
    typeof moved === 'object' &&
    moved.look.ino === linked.look.ino &&
    moved.sha256 === linked.sha256
  )
    return 'settled'
  throw new UnrestoredReceiptError(
    context,
    retiredPath,
    failure,
    undefined,
    'renamed-unverified',
    options.mark,
  )
}

/**
 * Ends a put-back whose rename into the empty `receipt.json` was refused before it moved anything, by what the private name shows now; called only by {@link renameMovedRecord}.
 * @param context - The run.
 * @param putBack - The put-back ({@link LinkedPutBack}).
 * @param cause - What the rename route threw.
 * @returns What {@link endOnEmptyName} answers when the private name is empty.
 * @throws An {@link UnrestoredReceiptError} with `moved-changed` when the private name shows another file, `moved-unread` when it cannot be looked at, and without a standing while it still shows the record that was read (the next run puts it back); that file and the publish record stay.
 * @example
 * await endRefusedRename(context, putBack, renameError) // throws '… could not put it back, so the next run puts it back; …'
 */
async function endRefusedRename(
  context: Context,
  { retiredPath, failure, linked, options }: LinkedPutBack,
  cause: unknown,
): Promise<PutBackEnd> {
  const state = await nameStateOf(context, retiredPath, linked.look).catch(
    (): 'unread' => 'unread',
  )
  // Nothing stands there: as when the link finds the name empty.
  if (state === 'gone')
    return endOnEmptyName(context, retiredPath, failure, cause, options.mark)
  throw new UnrestoredReceiptError(
    context,
    retiredPath,
    failure,
    cause,
    REFUSED_RENAME_STANDINGS[state],
    options.mark,
  )
}

/** The answer of a refused rename by what the private name showed afterwards ({@link endRefusedRename}): none while it still shows the record that was read, so the next run puts it back. */
const REFUSED_RENAME_STANDINGS: Readonly<
  Record<'still' | 'changed' | 'unread', UnrestoredStanding | undefined>
> = {
  still: undefined,
  changed: 'moved-changed',
  unread: 'moved-unread',
}

/**
 * Prepares the last looks before a put-back links a first setup's old record into `receipt.json`: awaits the read of the publish record a later run read ({@link recordStillCheck}) and a look at each name through the thread pool ({@link lookAheadAt}), and gives the synchronous looks that {@link putBackRetiredReceipt} runs in the same continuation as its link, so nothing is awaited between them and the link; called only by {@link putBackRetiredReceipt}, also for each later link of its bounded attempts, because a backup or sync tool may put another record of that setup at `pending.json` (one without the {@link Pending.notLinked} mark, say), or another file at the private name, while those awaited steps run.
 * The synchronous looks: the publish record's name first (later runs only; a setup's own put-back follows the record it wrote moments earlier), the private name last, which must still show the file of the read the caller links ({@link MovedRecord}). Limit: a file put at either name between those looks and the link is not seen; no Node primitive links by inode, and the look after the link ({@link dropLinkedPrivateName}) then keeps both names (criterion 17's residual).
 * @param context - The run; its pending path is the publish record it tracks.
 * @param retiredPath - The private name that holds the old record.
 * @param failure - What made the setup's put-back necessary; undefined at a later run.
 * @param mark - What the publish record tells about the setup's link ({@link PutBackOptions.mark}).
 * @returns The synchronous last looks: they answer undefined while both names still show what was read, or what {@link endOnEmptyName} answers when the private name is empty by then.
 * @throws A {@link JournalConflictError} when the publish record changed, disappeared or cannot be read ({@link recordStillCheck}), at the read or at the synchronous look; an {@link UnrestoredReceiptError} with `moved-changed` when the private name shows another file at the synchronous look, `moved-unread` when that look failed, and what {@link endOnEmptyName} throws. Nothing is linked then, and both receipt names stay as they are.
 * @example
 * const lastLooks = await lookBeforePutBackLink(context, retiredPath, undefined, 'marked')
 * lastLooks(linked) // throws once a backup put that setup's record back without its mark
 */
async function lookBeforePutBackLink(
  context: Context,
  retiredPath: string,
  failure: unknown,
  mark: PutBackOptions['mark'],
): Promise<(linked: MovedRecord) => PutBackEnd | undefined> {
  // The setup's own put-back follows the record it wrote moments earlier.
  const recordStill =
    failure === undefined ? await recordStillCheck(context) : undefined
  // A storage that already stalls holds this step here, not at the synchronous looks below.
  await lookAheadAt([...(recordStill?.names ?? []), retiredPath])
  return (linked: MovedRecord): PutBackEnd | undefined => {
    recordStill?.assert()
    // Last before the link: the private name must still show the file whose bytes were read.
    const state = nameStateNow(context, retiredPath, linked.look)
    if (state === 'still') return undefined
    if (state === 'gone')
      return endOnEmptyName(context, retiredPath, failure, undefined, mark)
    throw new UnrestoredReceiptError(
      context,
      retiredPath,
      failure,
      undefined,
      state === 'changed' ? 'moved-changed' : 'moved-unread',
      mark,
    )
  }
}

/** How a put-back that did not throw ended ({@link putBackRetiredReceipt}): `settled` once the old record stands at `receipt.json` again or went beside a record that covers it, `empty` when a later run found its private name empty, which the caller looks at once more before it ends the publish record that leads there ({@link retirePending}). */
type PutBackEnd = 'settled' | 'empty'

/**
 * Ends a put-back that found the old record's private name empty, by its link, by a look or by the delete beside a record that covers it; called by {@link putBackRetiredReceipt}, {@link readMovedForPutBack} and {@link settleTakenName}.
 * An empty name never ends the publish record that leads there by itself: in the setup that moved the record there (one with a `failure`), Codebook put a verified file there moments earlier, so its absence means another program acts on that folder now, and the setup keeps that record; a later run answers `empty`, and its caller ends that record only while a look right before that end still finds the name empty ({@link retirePending}). Nothing is unlinked at that name either way.
 * @param context - The run.
 * @param retiredPath - The private name that was found empty.
 * @param failure - What made the setup's put-back necessary; undefined at a later run.
 * @param cause - What the link, the look or the delete answered.
 * @param mark - What the publish record tells about the setup's link ({@link PutBackOptions.mark}).
 * @param isBesideStanding - Set by {@link settleTakenName}, whose put-back found something at `receipt.json`: the next run compares a record that stands at the private name by then with what stands there, and the sentence says so (`moved-gone-beside`).
 * @returns `empty` at a later run.
 * @throws An {@link UnrestoredReceiptError} with `moved-gone` (or `moved-gone-beside`) carrying `failure` in the setup, whose callers keep the publish record and mark it {@link Pending.notLinked}.
 * @example
 * endOnEmptyName(context, retiredPath, undefined, enoent, 'marked')       // => 'empty'
 * endOnEmptyName(context, retiredPath, linkError, enoent, 'marked')       // throws: '… and nothing stood at … when it went to put that record back …'
 * endOnEmptyName(context, retiredPath, linkError, enoent, 'marked', true) // throws: '… when it went to settle that record beside what stands at …/receipt.json …'
 */
function endOnEmptyName(
  context: Context,
  retiredPath: string,
  failure: unknown,
  cause: unknown,
  mark: PutBackOptions['mark'],
  isBesideStanding = false,
): 'empty' {
  // The setup put a verified file there moments earlier: the record that leads there stays, and the next run settles it.
  if (failure !== undefined)
    throw new UnrestoredReceiptError(
      context,
      retiredPath,
      failure,
      cause,
      isBesideStanding ? 'moved-gone-beside' : 'moved-gone',
      mark,
    )
  return 'empty'
}

/**
 * Identifies what stands at the old record's private name right before a put-back links it into `receipt.json`, so only the file the publish record names ({@link PutBackOptions.identity}), which a look right before the link still shows, goes back; called only by {@link putBackRetiredReceipt}.
 * Its look is awaited; the synchronous last looks follow in the caller, right before the link ({@link lookBeforePutBackLink}). Limit: a swap at the private name between those last looks and the link is not seen; no Node primitive links by inode, and the look after the link ({@link dropLinkedPrivateName}) then keeps the private name.
 * @param context - The run.
 * @param retiredPath - The private name that holds the old record.
 * @param failure - What made the setup's put-back necessary; undefined at a later run.
 * @param options - How the put-back runs ({@link PutBackOptions}).
 * @returns
 * - The record of this config that was read there and the look at the private name right before that read ({@link MovedRecord}), once the name still shows it: the caller links it
 * - What {@link endOnEmptyName} answers when the name is empty, at the first look or at the last
 * - What {@link settleForeignMoved} answers for a file that is no record of this config, or a record of this config other than the one the publish record names (also any record when nothing names one)
 * @throws An {@link UnrestoredReceiptError} with `moved-unread` when the look or the read failed, with `moved-changed` when the name showed another file at the last look, and what {@link endOnEmptyName} and {@link settleForeignMoved} throw.
 * @example
 * await readMovedForPutBack(context, retiredPath, linkError, {}) // => { read: oldReceipt, look: { ino: 42n, size: 310n, mtimeNs, ctimeNs } } for the old record
 */
async function readMovedForPutBack(
  context: Context,
  retiredPath: string,
  failure: unknown,
  options: PutBackOptions,
): Promise<MovedRecord | PutBackEnd> {
  const { mark } = options
  const moved = await readLookedRecord(context, retiredPath)
  // Nothing stands there: as when the link finds the name empty.
  if (moved === undefined)
    return endOnEmptyName(context, retiredPath, failure, undefined, mark)
  const unrestored = (standing: UnrestoredStanding): UnrestoredReceiptError =>
    new UnrestoredReceiptError(
      context,
      retiredPath,
      failure,
      undefined,
      standing,
      mark,
    )
  if (moved === 'unread') throw unrestored('moved-unread')
  // A file that is no record of this config never goes to receipt.json.
  if (moved.read === 'other' || moved.read.targetPath !== context.path)
    return settleForeignMoved(
      context,
      retiredPath,
      failure,
      options,
      'no-record',
    )
  const { read, look, sha256 } = moved
  // Only the record the publish record names goes back: another record of this config there, or one an older build's record cannot name, stays where it is.
  if (
    sha256 === undefined ||
    !isMovedFile(options.identity, { sha256, ino: look.ino })
  )
    return settleForeignMoved(
      context,
      retiredPath,
      failure,
      options,
      'unverified-record',
    )
  // The record that was read must still stand there after the read; the synchronous last look comes right before the link ({@link lookBeforePutBackLink}).
  const state = await nameStateOf(context, retiredPath, moved.look).catch(
    (): 'unread' => 'unread',
  )
  if (state === 'gone')
    return endOnEmptyName(context, retiredPath, failure, undefined, mark)
  if (state === 'changed') throw unrestored('moved-changed')
  if (state === 'unread') throw unrestored('moved-unread')
  return { read, look, sha256 }
}

/**
 * Settles a put-back whose private name holds a file that is no record of this config, or a record of this config other than the one the publish record names, without linking it; called only by {@link readMovedForPutBack}.
 * @param context - The run.
 * @param retiredPath - The private name that holds that file.
 * @param failure - What made the setup's put-back necessary; undefined at a later run.
 * @param options - How the put-back runs ({@link PutBackOptions}).
 * @param movedKind - What the file at the private name is ({@link MovedFileKind}): no record of this config, or a record of this config other than the one the publish record names, whose sentences carry the lead that Codebook cannot tell it is that record.
 * @returns What {@link settleTakenName} answers while something stands at `receipt.json`: its comparison names that file (`foreign`, `foreign-unverified`), or what stands there together with that file (`moved-foreign-other`, `moved-unverified-other`), never that file as Codebook's old record.
 * @throws An {@link UnrestoredReceiptError} with `moved-foreign` (or `moved-unverified`) while nothing stands at `receipt.json`, with `moved-foreign-unread` (or `moved-unverified-unread`) when that look failed, and what {@link settleTakenName} throws; that file and the publish record stay.
 * @example
 * await settleForeignMoved(context, retiredPath, undefined, {}, 'no-record') // throws '… because that file is no record of Devin Desktop's MCP config at … (another program may have put it there); …'
 */
async function settleForeignMoved(
  context: Context,
  retiredPath: string,
  failure: unknown,
  options: PutBackOptions,
  movedKind: MovedFileKind,
): Promise<PutBackEnd> {
  const isUnverified = movedKind === 'unverified-record'
  const standing = await lstatOrAbsent(context.receiptPath).catch(
    (cause: unknown) => {
      throw new UnrestoredReceiptError(
        context,
        retiredPath,
        failure,
        cause,
        isUnverified ? 'moved-unverified-unread' : 'moved-foreign-unread',
        options.mark,
      )
    },
  )
  // Nothing stands at receipt.json: only that file is to be moved, and it never goes there.
  if (standing === undefined)
    throw new UnrestoredReceiptError(
      context,
      retiredPath,
      failure,
      undefined,
      isUnverified ? 'moved-unverified' : 'moved-foreign',
      options.mark,
    )
  // The comparison words its answers for that file, never as Codebook's old record.
  return settleTakenName(
    context,
    retiredPath,
    failure,
    undefined,
    options,
    movedKind,
  )
}

/**
 * Ends a put-back whose link stood: the private name goes only while `receipt.json`, read again after the link, still holds the record that was read at the private name before the link, and synchronous looks still show the file of that second read, first at `receipt.json` and last at the private name as a second name of that file, so a file put at the private name right after the link is never deleted unread, the old record never loses its last name when another program replaced or deleted `receipt.json` after the link, and bytes another program wrote into that file since the read before the link never stay at `receipt.json` while the private name, the only sign of them, goes; called only by {@link putBackRetiredReceipt}.
 * The link changed the file's change time, so the look right before that second read gives the change time the synchronous looks compare: a write or a change of times through either name after that read moves it, also a write that keeps the size and puts the modification time back. Those looks come right after one look at each name through the thread pool ({@link lookAheadAt}), so a storage that already stalls stalls there, where the setup's budget answers. Limits: a file put at either name between the synchronous looks and the unlink is not seen; no Node primitive unlinks by inode. A stall that starts between the two looks at a name still holds the extension host's thread.
 * @param context - The run.
 * @param retiredPath - The private name that holds a second name of the record now at `receipt.json`.
 * @param failure - What made the setup's put-back necessary; undefined at a later run.
 * @param linked - The record of this config that was read at the private name before the link, and the look before that read ({@link MovedRecord}); that look's change time is left out, because the link changed it.
 * @param mark - What the publish record tells about the setup's link ({@link PutBackOptions.mark}).
 * @returns `settled` once the private name is gone, or was gone already while `receipt.json` showed the linked record.
 * @throws A {@link JournalConflictError} at a later run whose publish record changed, disappeared or cannot be read by the last looks ({@link recordStillCheck}); both names stay then. An {@link UnrestoredReceiptError} with `undeleted-replaced` when the private name shows another file at the last look, while `receipt.json` still holds the record that went back: that file is named apart from that record, never as Codebook's old record; with `undeleted`, worded by the {@link retiredDropRefusal}, when `receipt.json` is empty or cannot be looked at or read again, the private name is that record's only name, a look failed or the delete failed; with `linked-unverified` when `receipt.json` still shows the file that was linked but no longer holds the record that was read, so neither name goes; what {@link refuseUnverifiedLink} throws when `receipt.json` shows another file than the linked record. That file and the publish record stay.
 * @example
 * await dropLinkedPrivateName(context, retiredPath, linkError, moved, 'marked') // => 'settled'
 */
async function dropLinkedPrivateName(
  context: Context,
  retiredPath: string,
  failure: unknown,
  { look: { ino, size, mtimeNs }, sha256 }: MovedRecord,
  mark: PutBackOptions['mark'],
): Promise<'settled'> {
  const undeleted = (cause: unknown): UnrestoredReceiptError =>
    new UnrestoredReceiptError(
      context,
      retiredPath,
      failure,
      cause,
      'undeleted',
      mark,
    )
  const linkedFile = { ino, size, mtimeNs }
  // Only while receipt.json still holds the bytes that were read, in the file that was linked, does the look of this read's open file, change time included, stand for the bytes that went back.
  const reread = await readLookedRecord(context, context.receiptPath)
  const verifiedLook =
    typeof reread === 'object' &&
    reread.look.ino === ino &&
    reread.sha256 === sha256
      ? reread.look
      : undefined
  const linkedLook = verifiedLook ?? linkedFile
  // A later run deletes the private name only on the word of its publish record as it read it; a setup's own put-back follows the record it wrote moments earlier.
  const recordStill =
    failure === undefined ? await recordStillCheck(context) : undefined
  // A storage that already stalls stalls in the thread pool first, where the setup's budget answers.
  await lookAheadAt([
    context.receiptPath,
    ...(recordStill?.names ?? []),
    retiredPath,
  ])
  const standing = nameStateNow(context, context.receiptPath, linkedLook)
  // Another file at receipt.json: the link itself may have put an unverified file there, or another program put one there after it, so neither name goes.
  if (standing === 'changed')
    return refuseUnverifiedLink(context, retiredPath, failure, linkedLook, mark)
  // The put-back stands only while receipt.json still shows the record that was linked: an empty name there, or a read there that failed, leaves the private name as the way to that record.
  if (standing !== 'still' || reread === 'unread') throw undeleted(undefined)
  // receipt.json still shows the file that was linked, but its bytes are no longer the record that was read: a write kept its size and modification time, so neither name goes.
  if (verifiedLook === undefined)
    throw new UnrestoredReceiptError(
      context,
      retiredPath,
      failure,
      undefined,
      'linked-unverified',
      mark,
    )
  // The publish record a later run read must still stand there, right before the look at the private name.
  recordStill?.assert()
  // Last, right before the unlink: the private name goes only as a second name of that record, never as its only name.
  const state = nameStateNow(context, retiredPath, {
    ...verifiedLook,
    isShared: true,
  })
  // Another program removed that name already: nothing is left there to delete.
  if (state === 'gone') return 'settled'
  // The record's own inode, now its only name or changed in place (receipt.json going moves its change time), stays as that record's last name; another file there, which Codebook never verified, stays with the publish record and is named apart from the record at receipt.json.
  if (state === 'changed')
    throw nameStateNow(context, retiredPath, { ino: verifiedLook.ino }) ===
      'still'
      ? undeleted(undefined)
      : new UnrestoredReceiptError(
          context,
          retiredPath,
          failure,
          undefined,
          'undeleted-replaced',
          mark,
        )
  // A look that failed: that name and the publish record stay.
  if (state !== 'still') throw undeleted(undefined)
  await unlink(retiredPath).catch((cause: unknown) => {
    // A name already gone is what the delete was for.
    if (codeOf(cause) !== 'ENOENT') throw undeleted(cause)
  })
  return 'settled'
}

/**
 * Ends a put-back whose link stood while `receipt.json` shows another file than the record that was read at the private name, without deleting either name, because nothing proves that file the link's own; called only by {@link dropLinkedPrivateName}, right after its looks.
 * While the private name still shows the record that was read, the link put that record at `receipt.json` and another program replaced `receipt.json` after it: the private name is that record's last name. Otherwise one file at both names other than the one that was read may be what the link put at `receipt.json` (no Node primitive links by inode, so another program may have replaced the file at the private name between the last look and the link), or what a backup put at both names after the link, and the file that was read, changed in place since (its bytes or only its times), is what the link put there: no look tells these apart, so both names stay, and `receipt.json`, the only name the bridge reads, never goes on a file another program put there. The look comes right after {@link dropLinkedPrivateName}'s look through the thread pool and only chooses the refusal.
 * @param context - The run; its seam is called around the look ({@link nameStateNow}).
 * @param retiredPath - The private name of the old record.
 * @param failure - What made the setup's put-back necessary; undefined at a later run.
 * @param linkedFile - The record that was read at the private name before the link: its inode, size and modification time, and the change time of the look before {@link dropLinkedPrivateName}'s read after the link when that read found that record in that file at `receipt.json`.
 * @param mark - What the publish record tells about the setup's link ({@link PutBackOptions.mark}).
 * @returns Never: the put-back did not put that record back.
 * @throws An {@link UnrestoredReceiptError}, which keeps both names and the publish record: with `undeleted` while the private name still shows the record that was read; with `linked-unverified` otherwise, so the file at `receipt.json` is unverified.
 * @example
 * refuseUnverifiedLink(context, retiredPath, linkError, linkedFile, 'marked') // throws '… so what stands at …/receipt.json is unverified; …' once a backup put one file at both names
 */
function refuseUnverifiedLink(
  context: Context,
  retiredPath: string,
  failure: unknown,
  linkedFile: LeftoverLookback,
  mark: PutBackOptions['mark'],
): never {
  const unrestored = (standing: UnrestoredStanding): UnrestoredReceiptError =>
    new UnrestoredReceiptError(
      context,
      retiredPath,
      failure,
      undefined,
      standing,
      mark,
    )
  // The record that was read still stands at its private name: receipt.json was replaced after the link, and that name is the record's last one.
  if (nameStateNow(context, retiredPath, linkedFile) === 'still')
    throw unrestored('undeleted')
  // Nothing proves that the link put what stands at receipt.json there: a backup may have put one file at both names after it, so receipt.json, the name the bridge reads, stays beside the private name.
  throw unrestored('linked-unverified')
}

/** How {@link putBackRetiredReceipt} runs; every field is optional. */
type PutBackOptions = {
  /** Which link this is, from 1; only the put-back itself passes more. */
  attempt?: number
  /** What the publish record tells about the setup's link ({@link PublishMark}): `marked` for a setup's own put-back and a later run's put-back of a marked record; `unmarked` from a later run that settles a record without that mark ({@link settleRetiredReceipt}), whose refusal then promises no put-back, because the run after it decides again ({@link retiredReceiptFateOf}). Defaults to `marked`. */
  mark?: Exclude<PublishMark, 'unwritten'>
  /** Set by a later run whose decision to put the record back rested only on something standing at `receipt.json` while the config holds the entry the old record covers ({@link retiredReceiptFateOf}'s `compare`): the put-back compares with what stands there and never links the old record into that name, so an empty name is the undecided case again. */
  isBesideStanding?: boolean
  /** What names the file the setup moved to the private name ({@link MovedIdentity}): the bytes the publish record names ({@link movedIdentityOf}), or for the setup's undo of a move that found another receipt the file that move took there ({@link undoIdentityOf}). Only that file is linked or dropped; undefined names no file, so none is (an older build's record, or an undo without proof), and one file at both names is then unverified at `receipt.json` too, never an older version's put-back that stopped after its link, because that correct stop and another installation's record swapped into the private name inside its link leave the same state. */
  identity?: MovedIdentity
}

/**
 * Settles a put-back whose link found `receipt.json` taken, or one chosen only beside what stands there, by what the look at that name finds ({@link standingReceiptOf}); called only by {@link putBackRetiredReceipt}.
 * @param context - The run.
 * @param retiredPath - The private name that holds the receipt.
 * @param failure - What made the put-back necessary; undefined at a later run.
 * @param cause - The link's EEXIST; undefined when no link was made (`options.isBesideStanding`).
 * @param options - How the put-back runs ({@link PutBackOptions}).
 * @param movedKind - Set by {@link settleForeignMoved}, whose look found the file at the private name to be no record of this config or not the record the publish record names ({@link MovedFileKind}): what stands at `receipt.json` is then worded beside that file (`moved-foreign-other`, `moved-foreign-unread` and their unverified counterparts), never as keeping Codebook's old record.
 * @returns What {@link putBackRetiredReceipt} returns: `settled` once the moved record was dropped beside a record that covers it or put back by a later link, `empty` when a later run found its private name empty, by its first look, by the last or by the delete beside a record that covers it (nothing is unlinked there).
 * @throws What {@link putBackRetiredReceipt} throws.
 * @example
 * await settleTakenName(context, retiredPath, linkError, eexist, {}) // => 'settled' once the moved record went beside a newer record of the same entry
 */
async function settleTakenName(
  context: Context,
  retiredPath: string,
  failure: unknown,
  cause: unknown,
  options: PutBackOptions,
  movedKind?: MovedFileKind,
): Promise<PutBackEnd> {
  const { attempt = 1, mark, isBesideStanding = false } = options
  const standing = await standingReceiptOf(
    context,
    retiredPath,
    options.identity,
    failure,
  )
  // The private name was found empty before any comparison could prove what owns the entry: that never ends the record that leads there by itself, and nothing is unlinked there.
  if (standing === 'gone')
    return endOnEmptyName(context, retiredPath, failure, cause, mark, true)
  // Only a record of this config's same entry makes the moved one a spare copy.
  if (standing === 'covers') {
    const unlinkError = await unlink(retiredPath).then(
      () => undefined,
      (error: unknown) => error,
    )
    if (unlinkError === undefined) return 'settled'
    // A name found empty by the delete is as empty as one a look found: another program may put the record back right after, so the record that leads there stays.
    if (codeOf(unlinkError) === 'ENOENT')
      return endOnEmptyName(
        context,
        retiredPath,
        failure,
        unlinkError,
        mark,
        true,
      )
    // A delete that failed leaves the old record there: the publish record that leads to it stays, so the next run settles it.
    throw new UnrestoredReceiptError(
      context,
      retiredPath,
      failure,
      unlinkError,
      'undeleted',
      mark,
    )
  }
  if (standing === 'absent') {
    // Chosen only beside what stood there: an empty name is the undecided case, and nothing is linked into it.
    if (isBesideStanding) throw undecidedReceiptRefusal(context, retiredPath)
    // The name was empty again by the look: link again, a bounded number of times.
    if (attempt < DEVIN_RECEIPT_PUT_BACK_ATTEMPTS)
      return putBackRetiredReceipt(context, retiredPath, failure, {
        ...options,
        attempt: attempt + 1,
      })
  }
  throw new UnrestoredReceiptError(
    context,
    retiredPath,
    failure,
    cause,
    unrestoredStandingOf(standing, movedKind),
    mark,
  )
}

/** What {@link standingReceiptOf} found at `receipt.json` after a put-back's link found that name taken: `covers`, `gone` and `absent` decide the put-back, every other answer keeps the moved record ({@link UnrestoredStanding}). */
type StandingReceipt = 'covers' | 'gone' | 'absent' | UnrestoredStanding

/**
 * Words a look that kept the moved record for its {@link UnrestoredReceiptError}; called only by {@link settleTakenName}.
 * @param standing - What the look found.
 * @param movedKind - What the put-back found the file at the private name to be ({@link settleForeignMoved}); undefined for the record the publish record names.
 * @returns
 * - `unread` for `absent` past the last attempt (the name kept changing)
 * - `moved-foreign-other` for `other` and `moved-foreign-unread` for `unread` (or `absent` past the last attempt) for a file that is no record of this config, and `moved-unverified-other` and `moved-unverified-unread` for a record of this config that is not the one that moved there, so that file is never called Codebook's old record
 * - every other answer as it is
 * @example
 * unrestoredStandingOf('absent', undefined)                 // => 'unread'
 * unrestoredStandingOf('other', 'no-record')                // => 'moved-foreign-other'
 * unrestoredStandingOf('unread', 'unverified-record')       // => 'moved-unverified-unread'
 */
function unrestoredStandingOf(
  standing: Exclude<StandingReceipt, 'covers' | 'gone'>,
  movedKind: MovedFileKind | undefined,
): UnrestoredStanding {
  const kept = standing === 'absent' ? 'unread' : standing
  if (movedKind === undefined) return kept
  const isUnverified = movedKind === 'unverified-record'
  // A file at the private name that is not the record that moved there is worded beside what stands at receipt.json.
  if (kept === 'other')
    return isUnverified ? 'moved-unverified-other' : 'moved-foreign-other'
  if (kept === 'unread')
    return isUnverified ? 'moved-unverified-unread' : 'moved-foreign-unread'
  return kept
}

/**
 * Tells what stands at `receipt.json` when a put-back's link found that name taken, or the put-back was chosen only beside what stands there, so the moved record is dropped only beside a record that covers the same entry of the same config; called only by {@link settleTakenName}.
 * Both names, and the config when it decided the comparison, are looked at again only after the comparison ({@link stillnessOf}), whose read of the config ({@link ownerOfConfigEntry}) takes time: synchronously, the private name first and `receipt.json` last, right before the unlink that follows a `covers`, so that unlink deletes only the file that was read and only while the record that covers it still stands; at a later run a `covers` also holds only while its publish record still stands as that run read it, at a synchronous look right before those ({@link recordStillCheck}).
 * @param context - The run.
 * @param retiredPath - The private name that holds the moved record.
 * @param identity - What names the file the setup moved there ({@link PutBackOptions.identity}); a moved file it does not name is never dropped.
 * @param failure - What made the setup's put-back necessary; undefined at a later run, whose `covers` holds only while the publish record it read still stands at a synchronous look beside the looks at both names ({@link recordStillCheck}).
 * @returns
 * - `covers` when the moved record, the file the publish record names, and a record that stands there are both records of this config with the same entry hash, or both own the entry the config holds ({@link ownerOfConfigEntry}), and both names (and that config, when it decided) still show what was read
 * - `foreign-unverified` when a record of this config stands there and the moved file is a record of this config other than the one the publish record names; `linked-unverified` when that file is the one at `receipt.json` too (one file at both names, as an unverified put-back's link or a backup leaves it), also beside an older version's original publish record, whose correct stopped put-back and a swapped-in file leave the same state because that record names no bytes
 * - `gone` when the moved record's private name is empty, by its first look or by the last: nothing is left there to keep, and nothing there is unlinked
 * - `superseded` when only the record that stands there owns the entry the config holds: the moved one is the one to move
 * - `config-unread` when two records of this config with different entry hashes stand and the config could not be read to tell which owns its entry, or the config that told which owns it changed by the last looks
 * - `absent` when the name is empty, or changed between the look and the check
 * - `foreign` when a record of this config stands there and the moved file, read in full, is no record (no regular file, too many bytes or bytes of another shape) or a record of another config: neither goes, and the moved one never replaces it
 * - `other` for a folder, a link or another kind of file, bytes that are no record, a record of another config, or a record of another entry that owns nothing the config holds
 * - `unread` when a look at `receipt.json` or the read of what stands there failed
 * - `moved-unread` when the look at the moved record's private name or its read failed (an I/O failure, never bytes of another shape)
 * - `moved-changed` when the private name shows another file than the one that was read there: what the read compared is not what an unlink would delete
 * @throws A {@link JournalConflictError} when a later run's `covers` meets a publish record that changed, disappeared or cannot be read; nothing is deleted then.
 * @example
 * await standingReceiptOf(context, retiredPath, identity, undefined) // => 'other' while a folder stands at receipt.json
 */
async function standingReceiptOf(
  context: Context,
  retiredPath: string,
  identity: MovedIdentity | undefined,
  failure: unknown,
): Promise<StandingReceipt> {
  const records = await readStandingReceipt(context, retiredPath)
  if (typeof records === 'string') return records
  const { answer, boundConfig } = await compareStandingReceipt(
    context,
    records,
    identity,
  )
  // A later run drops the old record only on the word of its publish record as it read it; a setup's own put-back follows the record it wrote moments earlier.
  const recordStill =
    answer === 'covers' && failure === undefined
      ? await recordStillCheck(context)
      : undefined
  // A storage that already stalls stalls in the thread pool first, where the setup's budget answers.
  await lookAheadAt([
    ...(recordStill?.names ?? []),
    retiredPath,
    ...(boundConfig ? [context.path] : []),
    context.receiptPath,
  ])
  recordStill?.assert()
  // The looks come last and run synchronously: a file put at either name, or a config saved, during the comparison's config read is never what the put-back acts on, and only promise returns separate them from the unlink.
  const stillness = stillnessOf(
    context,
    retiredPath,
    records.standingLook,
    records.moved.look,
    boundConfig,
  )
  return stillness === 'still' ? answer : stillness
}

/** What {@link compareStandingReceipt} answers: the comparison, and, when the config decided it ({@link ownerOfConfigEntry}), the identity of the config that was read (`absent` when none stood), which the last looks must still find ({@link stillnessOf}). */
type StandingComparison = {
  answer:
    | 'covers'
    | 'superseded'
    | 'other'
    | 'foreign'
    | 'foreign-unverified'
    | 'linked-unverified'
    | 'config-unread'
  boundConfig?: BoundConfig
}

/** The config a comparison's answer rests on ({@link ownerOfConfigEntry}): the identity of the file that was read, or `absent` when no config stood. */
type BoundConfig = FileIdentity | 'absent'

/**
 * Compares the record that stands at `receipt.json` with the moved one; called only by {@link standingReceiptOf}, which then looks at both names again before the put-back acts on the answer.
 * @param context - The run.
 * @param records - Both records as read ({@link StandingRecords}).
 * @param identity - What names the file the setup moved there; undefined when nothing does (an older version's original publish record, which names no bytes, 0.2.144.0's `foreign` record, this build's record without bytes and a setup's own undo without proof): nothing ever drops or links a name on that word, so one file at both names beside such a record is unverified at `receipt.json` too, never that version's put-back that stopped after its link, because the correct stopped put-back and another installation's record swapped into the private name inside its link leave the same state.
 * @returns The answer ({@link StandingComparison}):
 * - `other` when the record at `receipt.json` is a record of another config
 * - `foreign` when the moved file holds no record, or a record of another config
 * - `linked-unverified` when the moved file is a record of this config other than the one the publish record names and the very file at `receipt.json` (both names one file), `foreign-unverified` when it is another file: neither ever drops or names a record of Codebook's to move
 * - `covers` when both hold the same entry hash, bound to no config
 * - what {@link ownerOfConfigEntry} answers for two records of this config with different entry hashes
 * @example
 * await compareStandingReceipt(context, { standing: newerReceipt, standingLook, moved }, identity) // => { answer: 'covers' } while both hold the same entry hash
 */
async function compareStandingReceipt(
  context: Context,
  { standing, standingLook, moved }: StandingRecords,
  identity: MovedIdentity | undefined,
): Promise<StandingComparison> {
  const { read, look, sha256 } = moved
  // Only what stands there decides while it is no record of this config: moving it away lets the moved file go back.
  if (standing.targetPath !== context.path) return { answer: 'other' }
  // A moved file read as bytes that are no record, or as a record of another config: that file is the one to move.
  if (read === 'other' || read.targetPath !== context.path)
    return { answer: 'foreign' }
  // A record of this config that is not the one the setup moved there decides nothing: one file at both names is unverified at receipt.json too, also where a record that names no bytes says that file is one Codebook did not verify, and also beside an older version's original record, whose correct stopped put-back and a swapped-in file leave that same state, so inode equality alone never makes it the verified old record here.
  if (!isMovedFile(identity, { sha256, ino: look.ino }))
    return {
      answer:
        look.ino === standingLook.ino
          ? 'linked-unverified'
          : 'foreign-unverified',
    }
  if (standing.entrySha256 === read.entrySha256) return { answer: 'covers' }
  return ownerOfConfigEntry(context, standing, read)
}

/**
 * Compares two records of this config whose entry hashes differ against the entry the config holds, so the put-back never names a record that owns that entry as the one to move; called only by {@link compareStandingReceipt}.
 * Two hashes may name one entry: a record of an older build hashes the whole entry, `disabled` included, a newer one its core ({@link ownsEntry}). Every answer this read decides depends on the config, so it carries the config that was read: a `covers` drops the moved record, and a `superseded` or `other` names a record to move, each only while the config is still that file, or still absent, at the last looks ({@link stillnessOf}); otherwise the answer is `config-unread`, which names no record to move.
 * @param context - The run.
 * @param standing - The record of this config at `receipt.json`.
 * @param moved - The moved record of this config.
 * @returns The answer ({@link StandingComparison}), each but `config-unread` with the config that was read ({@link BoundConfig}):
 * - `covers` when both own the entry the config holds: the moved one is a spare copy
 * - `superseded` when only the record at `receipt.json` owns it: the moved one, which owns nothing the config holds, is the one to move
 * - `other` when the record at `receipt.json` owns nothing the config holds, also when no config or no entry stands: that record is the one to move
 * - `config-unread` when the config could not be read ({@link lookAtConfig} refused): neither is named
 * @example
 * await ownerOfConfigEntry(context, liveReceipt, oldReceipt) // => { answer: 'superseded', boundConfig: look.identity } while the config holds the entry only liveReceipt owns
 */
async function ownerOfConfigEntry(
  context: Context,
  standing: Receipt,
  moved: Receipt,
): Promise<StandingComparison> {
  const look = await lookAtConfig(context).catch(() => undefined)
  if (look === undefined) return { answer: 'config-unread' }
  // No config stands: the record at receipt.json owns nothing it holds, while no config appears by the last looks.
  if (look.kind !== 'present') return { answer: 'other', boundConfig: 'absent' }
  const current = currentEntryOf(look)
  const boundConfig = look.identity
  // Only a record that owns nothing the config holds is ever named as the one to move, and only while the config is still this file.
  if (!ownsEntry(current, standing)) return { answer: 'other', boundConfig }
  if (!ownsEntry(current, moved)) return { answer: 'superseded', boundConfig }
  // This look decided that both own the entry: the drop holds only while the config is still this file.
  return { answer: 'covers', boundConfig }
}

/** The two records {@link readStandingReceipt} read, each with the look of the open file it was read from, so {@link stillnessOf} can tell after the comparison whether both names still show those files; the moved one as {@link readLookedRecord} read it, with its bytes' hash when it is a receipt. */
type StandingRecords = {
  standing: Receipt
  standingLook: LeftoverLookback
  moved: LookedRecord
}

/**
 * Reads the record that stands at `receipt.json` and the moved one, each right after a look at its name; called only by {@link standingReceiptOf}, which compares the two and then looks at both names again ({@link stillnessOf}).
 * @param context - The run.
 * @param retiredPath - The private name that holds the moved record.
 * @returns Both records with their looks ({@link StandingRecords}); otherwise the answer these looks and reads already give ({@link StandingReceipt}).
 * @throws The `receipt-unverified` {@link UnrestoredReceiptError} of {@link assertNotedReceipt} when the record at `receipt.json` is not the very bytes the publish record's note that receipt.json is unverified names: it is never compared as a record of Codebook's, so the moved record is never dropped beside it; nothing is changed then.
 * @example
 * await readStandingReceipt(context, retiredPath) // => { standing: newerReceipt, standingLook, moved: { read: oldReceipt, look, sha256 } }
 */
async function readStandingReceipt(
  context: Context,
  retiredPath: string,
): Promise<StandingReceipt | StandingRecords> {
  const standing = await readLookedRecord(context, context.receiptPath)
  // A name that is empty, or empty again by the read, counts as empty.
  if (standing === undefined) return 'absent'
  if (standing === 'unread') return 'unread'
  if (standing.read === 'other') return 'other'
  // This read decides whether the moved record is a spare copy: under a note that receipt.json is unverified, only the bytes it names count as a record.
  assertNotedReceipt(context, standing)
  const moved = await readLookedRecord(context, retiredPath)
  // Nothing is left under the private name to keep, and a file put there after this look is not the record.
  if (moved === undefined) return 'gone'
  // The private file could not be read, not receipt.json: its own sentence names that file. One that was read and holds no record goes on, so the comparison can name it.
  if (moved === 'unread') return 'moved-unread'
  return {
    standing: standing.read,
    standingLook: standing.look,
    moved,
  }
}

/** A record file as {@link readLookedRecord} read it: the receipt, or `other` for a file that holds none, the inode, size and times of the open file the bytes came from (the name's own look only for what was never opened), and for a receipt the SHA-256 of those bytes, which tells the record a first setup moved aside from any other ({@link isMovedFile}). */
type LookedRecord = {
  read: Receipt | 'other'
  look: RecordLook
  sha256?: string
}

/** The old record of this config as {@link readMovedForPutBack} read it at its private name right before a put-back's link, the very file its publish record names ({@link isMovedFile}), which {@link dropLinkedPrivateName} reads again at `receipt.json` after the link. */
type MovedRecord = LookedRecord & { read: Receipt; sha256: string }

/**
 * Looks at a record's name, then reads the file through one open handle, whose own look comes with the bytes, so a later look ({@link stillnessOf}) tells whether the name still shows the very file whose bytes were read, also after another file stood there between the look and the open and the record came back (a records folder swapped away and back keeps every file's times); called by {@link readStandingReceipt} for `receipt.json` and for the moved record's private name, and by {@link readMovedForPutBack} for that private name right before a put-back's link, by {@link dropLinkedPrivateName} for `receipt.json` right after that link, and by {@link heldReceiptLook} for that private name right after a first setup moved its old record there.
 * @param context - The run.
 * @param path - The record file.
 * @returns
 * - The receipt, or `other` for no regular file, too many bytes or bytes that are no receipt, each with the look of the file the open found ({@link LookedRecord}); the name's own look only for what is never opened (a folder, a link or another kind of file at the look, or a link the open found there instead)
 * - undefined when the name is empty, or empty again by the read
 * - `unread` when the look or the read failed (a failed system call, {@link isFailedRead})
 * @example
 * await readLookedRecord(context, retiredPath) // => { read: oldReceipt, look: { ino: 42n, size: 310n, mtimeNs, ctimeNs } }
 */
async function readLookedRecord(
  context: Context,
  path: string,
): Promise<LookedRecord | undefined | 'unread'> {
  let before: BigIntStats | undefined
  try {
    before = await lstatOrAbsent(path)
  } catch {
    return 'unread'
  }
  if (!before) return undefined
  // A folder, a link or another kind of file holds no record and is not read.
  if (!before.isFile()) return { read: 'other', look: recordLookOf(before) }
  let file: RecordFileRead | undefined
  try {
    file = await readRecordFile(path, context.retry, context.seam)
  } catch (error) {
    // The open file holds no record: its own look names it.
    if (error instanceof RefusedRecordError)
      return { read: 'other', look: error.look }
    if (isFailedRead(error)) return 'unread'
    // A link the open found in place of the regular file the look saw: nothing was opened, so the look names it.
    return { read: 'other', look: recordLookOf(before) }
  }
  if (file === undefined) return undefined
  try {
    const read = parseRecord(path, receiptSchema, context.retry, file.bytes)
    return { read, look: file.look, sha256: bytesSha256(file.bytes) }
  } catch {
    // Bytes that are no receipt, read through that same open file.
    return { read: 'other', look: file.look }
  }
}

/**
 * Tells whether the moved record's private name, then the config when it decided the comparison, and last `receipt.json` still show what was read, after the comparison and right before the put-back acts on it; called only by {@link standingReceiptOf}.
 * The looks are synchronous, so nothing is awaited between them and the unlink that follows a `covers`, and `receipt.json`, whose record decides that drop, is looked at last; its caller looks at the same names through the thread pool right before ({@link lookAheadAt}), so a storage that already stalls stalls there, where the setup's budget answers. Limits: a file put at either name, or a config saved, between these looks and the unlink is not seen; no Node primitive unlinks by inode. A stall that starts between the caller's looks and these still holds the extension host's thread.
 * @param context - The run; its seam is called around each name's look ({@link nameStateNow}).
 * @param retiredPath - The private name that holds the moved record.
 * @param standingLook - `receipt.json`'s look before its read.
 * @param movedLook - The private name's look before its read.
 * @param boundConfig - The config that decided the answer ({@link ownerOfConfigEntry}): a `covers` drop, or a `superseded` or `other` advice to move a record; undefined when the config decided nothing.
 * @returns
 * - `still` when every name shows what was read
 * - `moved-changed` when the private name shows another file; `moved-unread` when that look failed
 * - `gone` when nothing stands at the private name any more, as when its first look found it empty ({@link readStandingReceipt})
 * - `config-unread` when the config that decided is no longer the file that was read, or that look failed
 * - `absent` when `receipt.json` changed, so the put-back links again; `unread` when that look failed
 * @example
 * stillnessOf(context, retiredPath, standingLook, movedLook) // => 'absent' after a sync tool replaced receipt.json during the look at the private name
 */
function stillnessOf(
  context: Context,
  retiredPath: string,
  standingLook: LeftoverLookback,
  movedLook: LeftoverLookback,
  boundConfig?: BoundConfig,
):
  | 'still'
  | 'absent'
  | 'unread'
  | 'gone'
  | 'moved-changed'
  | 'moved-unread'
  | 'config-unread' {
  const movedState = nameStateNow(context, retiredPath, movedLook)
  if (movedState === 'unread') return 'moved-unread'
  // The private name is empty by now: no file is left there to keep, to name or to unlink.
  if (movedState === 'gone') return 'gone'
  // Another file at the private name since the look: what the read compared is not what an unlink would delete.
  if (movedState === 'changed') return 'moved-changed'
  // The config decided the answer: it holds only while the config is still the file that was read, or still absent.
  if (boundConfig && !isConfigStill(context, boundConfig))
    return 'config-unread'
  // receipt.json last: the record that covers the moved one must still stand there right before the delete.
  const standingState = nameStateNow(context, context.receiptPath, standingLook)
  if (standingState === 'unread') return 'unread'
  return standingState === 'still' ? 'still' : 'absent'
}

/**
 * Tells whether the config is still the file whose look decided a drop or a move advice, or still absent, with a failed look as a change; called by {@link stillnessOf}, and by the look {@link settleRecordConflict} gives right before a receipt's rename.
 * @param context - The run.
 * @param boundConfig - The config that decided ({@link BoundConfig}).
 * @returns `true` when {@link isConfigUnchanged} finds that file, or still no file for `absent`; `false` when it changed or the look failed.
 * @example
 * isConfigStill(context, look.identity) // => false after a sync tool saved the config again
 * isConfigStill(context, 'absent')      // => false once a config stands
 */
function isConfigStill(context: Context, boundConfig: BoundConfig): boolean {
  try {
    return isConfigUnchanged(
      context,
      boundConfig === 'absent' ? undefined : boundConfig,
    )
  } catch {
    return false
  }
}

/**
 * Tells a record that could not be read from one whose bytes are no record, by the error {@link readRecord}, {@link readRecordFile} or {@link readRetiredRecord} threw; called by {@link readLookedRecord}, {@link publishReceiptVersionOf}, {@link dropRetiredReceipt}, {@link retiredReceiptFateOf} and {@link readPublishRecord}, which keep every record after a failed read and advise deleting none.
 * @param error - What {@link readRecord}, {@link readRecordFile} or {@link readRetiredRecord} threw.
 * @returns `true` when opening, looking at or reading the file failed (the error carries that failure's system code as its cause); `false` for a link (whose open without following it fails with `ELOOP`), no regular file, too many bytes or bytes that are no record.
 * @example
 * isFailedRead(new Error('…', { cause: Object.assign(new Error('i/o error'), { code: 'EIO' }) }))       // => true
 * isFailedRead(new Error('…', { cause: Object.assign(new Error('too many links'), { code: 'ELOOP' }) })) // => false
 * isFailedRead(new Error('… is unreadable …'))                                                         // => false
 */
function isFailedRead(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const code = codeOf(error.cause)
  // A link at the name fails the open that follows no link (ELOOP): it holds no record, which the learner can move away, so it is no failed read.
  return code !== undefined && code !== 'ELOOP'
}

/**
 * Settles the private name of a stale receipt that a first setup moved aside and did not settle itself (it stopped between the move and the link, or right after the link, or the put-back failed); called by {@link settleAfterRecovery} before the receipt is read.
 * Every put-back and delete below acts only on the file the publish record names by its bytes ({@link movedIdentityOf}), and nothing goes on while that record notes a file a put-back left unverified at `receipt.json` that still stands there ({@link assertReceiptVerified}). A setup whose own receipt stands (the same generation, in bytes that note lets pass, {@link publishReceiptVersionOf}) finished: its link stood, so the old record is deleted before any look, whatever the config shows, but only while that receipt still stands at `receipt.json` as this run read it; every such delete acts only on that file while the private name still shows it as read ({@link dropRetiredReceipt}). A record marked {@link Pending.notLinked} linked nothing: the receipt goes back ({@link putBackRetiredReceipt}), never over a newer one, whatever inode the config shows (a freed staged inode may come back as the restored config's). Otherwise, while the config that was read shows the inode the setup staged, holds the bytes that setup published and its link is proven ({@link isProvenLink}), its link stood: the old receipt covers nothing and must not come back beside that entry, which the take-back removes ({@link finishCutShortSetup}), so the private name is deleted, but only while fresh reads still find those published bytes in that file and the config still is that file right before the delete. That inode alone proves nothing: a setup whose link failed unlinks its staged file, a restored config may take that freed number, and once recovery dropped the staged second name a backup may rewrite that restored config in place in the published file, so without those bytes the one look below decides. The config is read once for both, and that one look decides ({@link retiredReceiptFateOf}): when it holds the setup's own entry and the old receipt does not own it (another bridge path), that entry is the setup's publish saved again, so the private name is deleted as when the link stood, but only while the config still holds the bytes of that look (a backup may restore the config the old receipt covers meanwhile, and the run then stops); when it holds the entry the old receipt covers, which the setup may have published before it stopped and a sync tool saved again, the run refuses and keeps both records; else nothing of that setup stands, and the receipt goes back. A config name that cannot be looked at, a config that cannot be read and a record that cannot be read decide nothing: the run stops, because a read that works a moment later could settle the publish record and leave the private name for good; the private name and the record stay, so the next run settles them again.
 * @param context - The run.
 * @param pending - The publish record as read; only one of this config that names the move ({@link Pending.retiresReceipt}) with a valid generation leads to a private name.
 * @param isStagedLinked - Whether the setup's staged name and the config name showed its staged inode before recovery dropped that staged name ({@link isStagedNameLinked}).
 * @returns Resolves once the private name is settled; the caller reads the config afterwards, so a config restored while the old receipt went back is the one its run goes on with. With the private name when a put-back found it empty (`empty`, {@link putBackRetiredReceipt}): the caller ends the publish record only while a look right before that end still finds that name empty ({@link retirePending}); undefined otherwise, also after a drop ({@link dropRetiredReceipt}), whose decision is to delete that record.
 * @throws The `receipt-unverified` {@link UnrestoredReceiptError} from {@link assertReceiptVerified} and {@link publishReceiptVersionOf}, the {@link unreadableRefusal} when the config name cannot be looked at, what {@link publishReceiptVersionOf}, {@link lookAtConfig}, {@link retiredReceiptFateOf} and {@link dropRetiredReceipt} throw, the {@link undecidedReceiptRefusal} when the config holds the entry the old receipt covers, the {@link UnrestoredReceiptError} when the receipt could not go back, and a {@link JournalConflictError} when the publish record changed, disappeared or could not be read right before a put-back's link ({@link lookBeforePutBackLink}), so nothing was linked; the record stays as it was read, except that a put-back that keeps a file at the private name that Codebook did not verify as its record of this config first rewrites it in the shape older builds refuse ({@link putBackLater}).
 * @example
 * await settleRetiredReceipt(context, pending, false) // => undefined once receipt.json stands again after a setup whose link failed and whose put-back failed too
 * await settleRetiredReceipt(context, pending, false) // => '…/receipt.json.<generation>.retired' when another program had emptied that name
 */
async function settleRetiredReceipt(
  context: Context,
  pending: Pending | undefined,
  isStagedLinked: boolean,
): Promise<string | undefined> {
  const generation = pending?.generation
  if (
    !pending?.retiresReceipt ||
    pending.targetPath !== context.path ||
    generation === undefined ||
    !GENERATION_PATTERN.test(generation)
  )
    return
  const retiredPath = retiredReceiptPathOf(context, generation)
  // Only the file the publish record names by its bytes is ever put back or deleted; an older build's record names none.
  const identity = movedIdentityOf(pending)
  // A put-back left a file Codebook did not verify at receipt.json: no step below takes that file for Codebook's record.
  await assertReceiptVerified(context, retiredPath, pending)
  // That setup wrote its own receipt, so its link stood: the old receipt covers nothing, whatever the config shows now, while that receipt still stands as read.
  const covering = await publishReceiptVersionOf(
    context,
    retiredPath,
    generation,
  )
  if (covering) {
    await dropRetiredReceipt(
      context,
      retiredPath,
      identity,
      undefined,
      covering,
    )
    return
  }
  // A failed look decides nothing: the run stops here, so the private name and the record wait for the next run.
  await lstatOrAbsent(context.path).catch((cause: unknown) => {
    throw unreadableRefusal(context, cause)
  })
  // Nothing of that publish was linked: the old receipt goes back whatever inode the config shows.
  if (pending.notLinked) {
    const end = await putBackLater(context, retiredPath, {
      identity,
    })
    // An empty private name ends the publish record only after one more look right before that end.
    return end === 'empty' ? retiredPath : undefined
  }
  // One look decides both proofs: the inode must still hold the bytes this setup published, and the same look decides the put-back when it does not.
  const look = await lookAtConfig(context)
  // The setup's link stood and the config still is its publish byte for byte: the old receipt is deleted, never put back beside that entry, only while fresh reads still find those published bytes in that file.
  const provenConfig =
    look.kind === 'present' &&
    pending.stagedSha256 !== undefined &&
    look.sha256 === pending.stagedSha256 &&
    isProvenLink(pending, look.identity, isStagedLinked)
      ? look
      : undefined
  if (provenConfig) {
    await dropRetiredReceipt(
      context,
      retiredPath,
      identity,
      undefined,
      undefined,
      provenConfig,
    )
    return undefined
  }
  const fate = await retiredReceiptFateOf(context, pending, retiredPath, look)
  if (fate === 'undecided') throw undecidedReceiptRefusal(context, retiredPath)
  // The config holds that setup's publish, which the old receipt does not own: it goes, as when the link stood.
  if (typeof fate === 'object') {
    await dropRetiredReceipt(context, retiredPath, identity, fate)
    return undefined
  }
  const end = await putBackLater(context, retiredPath, {
    // A marked record went back above: this one lacks the mark, which also a setup that linked its config leaves.
    mark: 'unmarked',
    isBesideStanding: fate === 'compare',
    identity,
  })
  return end === 'empty' ? retiredPath : undefined
}

/**
 * Keeps every step of a later run away from a file a put-back's link left at `receipt.json` without Codebook verifying it as the record that moved ({@link refuseUnverifiedLink}), which the publish record notes (`receiptUnverified`, {@link keptRecordOf}), so that file is never taken for Codebook's record, compared as one, deleted or read as the receipt after a restart; called first by {@link settleRetiredReceipt}.
 * The run holds that note from here on ({@link Context.receiptVersion}): this look is only the first, and each later read of `receipt.json` the run decides on, the one whose generation authorizes the old record's delete ({@link publishReceiptVersionOf}), the one a put-back compares with ({@link readStandingReceipt}) and the one the run's decisions rest on ({@link settleAfterRecovery}), passes the same rule itself, so a file put there after this look found the name empty is never taken for that record either.
 * @param context - The run.
 * @param retiredPath - The old record's private name, which the refusal names.
 * @param pending - The publish record as read.
 * @throws An {@link UnrestoredReceiptError} with `receipt-unverified` while the record carries that note and something stands at `receipt.json` that is not the very bytes the record names (also when it cannot be read); nothing is changed then.
 * @example
 * await assertReceiptVerified(context, retiredPath, pending) // throws while another installation's record that an unverified link put there stands at receipt.json
 */
async function assertReceiptVerified(
  context: Context,
  retiredPath: string,
  pending: Pending,
): Promise<void> {
  const { retiresReceipt } = pending
  if (typeof retiresReceipt !== 'object' || !retiresReceipt.receiptUnverified)
    return
  // Every later read of receipt.json this run decides on is held against the same note.
  context.receiptVersion.unverifiedNote = {
    sha256: retiresReceipt.sha256,
    retiredPath,
  }
  const standing = await readLookedRecord(context, context.receiptPath)
  // A look that failed names no bytes, so it never passes as the record the note names.
  assertNotedReceipt(context, standing === 'unread' ? {} : standing)
}

/**
 * Refuses what a read of `receipt.json` found while the run holds its publish record's note that a put-back left a file there Codebook did not verify ({@link Context.receiptVersion}'s `unverifiedNote`), so that file is never taken for Codebook's record, compared as one or read as the receipt: only an empty name or the very bytes the note names pass; called by {@link assertReceiptVerified} for its look, by {@link publishReceiptVersionOf} for the read whose generation authorizes the old record's delete, by {@link readStandingReceipt} for the record a put-back compares with, and by {@link settleAfterRecovery} for the read the run's decisions rest on, so a look that found the name empty grants nothing to a file put there after it.
 * @param context - The run.
 * @param found - What the read found there: undefined for an empty name; otherwise the hash of the bytes it read, none for a file that holds no receipt or could not be read.
 * @throws An {@link UnrestoredReceiptError} with `receipt-unverified` while the note stands and the read found anything but an empty name or those bytes; nothing is changed then.
 * @example
 * assertNotedReceipt(context, { sha256: 'ab…' }) // throws while the note names other bytes
 * assertNotedReceipt(context, undefined)         // passes: nothing stands there
 */
function assertNotedReceipt(
  context: Context,
  found: { sha256?: string } | undefined,
): void {
  const note = context.receiptVersion.unverifiedNote
  // No note, an empty name, or the very bytes the note names: nothing there is the unverified file.
  if (
    note === undefined ||
    found === undefined ||
    (found.sha256 !== undefined && found.sha256 === note.sha256)
  )
    return
  throw new UnrestoredReceiptError(
    context,
    note.retiredPath,
    undefined,
    undefined,
    'receipt-unverified',
  )
}

/**
 * Runs a later run's put-back of a first setup's old record ({@link putBackRetiredReceipt}); when that put-back keeps a file Codebook did not verify at the private name ({@link UnrestoredReceiptError.isForeignKept}) or at `receipt.json` ({@link UnverifiedReceiptStanding}), the publish record that leads there is rewritten first ({@link markForeignKept}, {@link keptRecordOf}): an older build's record in the shape older builds refuse, so a window of 0.2.142.0 or 0.2.143.0 never puts that file at `receipt.json`, and this build's record with the note that `receipt.json` is unverified, so no later run takes that file for its record ({@link assertReceiptVerified}); the refusal then says whether that note stands ({@link withNoteState}); called only by {@link settleRetiredReceipt}.
 * @param context - The run.
 * @param retiredPath - The private name that holds the old record.
 * @param options - How the put-back runs ({@link PutBackOptions}).
 * @returns What {@link putBackRetiredReceipt} returns.
 * @throws What {@link putBackRetiredReceipt} throws, once that rewrite was tried.
 * @example
 * await putBackLater(context, retiredPath) // throws '… because that file is no record of Devin Desktop's MCP config at … (another program may have put it there); …' and pending.json carries retiresReceipt 'foreign'
 */
async function putBackLater(
  context: Context,
  retiredPath: string,
  options?: PutBackOptions,
): Promise<PutBackEnd> {
  try {
    return await putBackRetiredReceipt(context, retiredPath, undefined, options)
  } catch (error) {
    if (!(error instanceof UnrestoredReceiptError)) throw error
    // A file Codebook did not verify stays at the private name or receipt.json: the record that leads there notes it, and older builds never reach it through that record.
    await markForeignKept(context, retiredPath, error)
    // The answer claims the note that receipt.json is unverified only while the record on disk carries it.
    throw await withNoteState(context, error)
  }
}

/**
 * Rewrites the publish record that leads to an old record's private name as a put-back that kept a file there or at `receipt.json` leaves it ({@link keptRecordOf}), as it stands now, since recovery may have rewritten it in this run (a handover); best effort, because the run refuses anyway; called only by {@link putBackLater}, through {@link rewriteLeadingRecord}.
 * Such a record may still lead 0.2.142.0 and 0.2.143.0 to that file (retiresReceipt `true`): it is another program's, so it is never written over unread, and the next run of this build, which reads it, rewrites it here; until then, as after any later restore of such a record, an older window may put that file back.
 * @param context - The run; its pending path is the record.
 * @param retiredPath - The private name that keeps a file Codebook did not verify as its record of this config, or the file a put-back's link or rename left at `receipt.json`.
 * @param error - Why the put-back kept what it kept.
 * @returns Resolves once the record was rewritten, or when it was left as it was: it already has that shape, needs no rewrite for that error, leads to another private name, could not be read or written, or another record or an empty name stood there by the write.
 * @example
 * await markForeignKept(context, retiredPath, error) // pending.json now carries retiresReceipt 'foreign' (an older build's record) or receiptUnverified (this build's, after linked-unverified)
 */
async function markForeignKept(
  context: Context,
  retiredPath: string,
  error: UnrestoredReceiptError,
): Promise<void> {
  // Another record or an empty name by then: it stays as the other program left it, and the run refuses anyway.
  await rewriteLeadingRecord(context, retiredPath, (record) =>
    keptRecordOf(record, error),
  )
}

/** How {@link rewriteLeadingRecord} ended: `written` once the rewrite stands, `unchanged` when the rewrite asked for none, `unwritten` when the record could not be read, leads to another private name, is another version than the run tracks, or the write was refused or failed; with the record as it was read, when one was. */
type LeadingRecordRewrite = {
  outcome: 'written' | 'unchanged' | 'unwritten'
  record?: Pending
}

/**
 * Rewrites the publish record that leads to an old record's private name as it stands now, so a put-back's notes and marks never write back a record recovery rewrote earlier in the run (a handover); called by {@link markForeignKept}, {@link noteBeforePutBack} and {@link withdrawPutBackNote}.
 * The rewrite replaces only the version of the record this call read ({@link readVersionedRecord}), through the tracked-record guard ({@link Context.journalVersion}; a held run's own tracking when it holds a legacy journal, any other run's tracking of this read). A run that tracks a version rewrites only when this read shows that version (inode and bytes' hash), so a rewrite built from another version (an older copy of the same setup's record a backup shows there for the read, without the take-back mark, say) never replaces the tracked one once it is back before the write's looks. The bytes are staged first, and the synchronous last look right before the rename refuses when the name no longer shows that version, so a record a backup or sync tool put there meanwhile stays as that program left it; an emptied name is never claimed (`refusesEmptyName`). Limit: a record put there between that last look and the rename is replaced; no Node primitive renames over a name only while it shows an inode.
 * @param context - The run; its pending path is the record.
 * @param retiredPath - The old record's private name; only the record of this config whose generation names it is rewritten.
 * @param rewrite - Gives the record to write from the record as read; undefined when it stays as it is.
 * @returns How the rewrite ended ({@link LeadingRecordRewrite}); never throws.
 * @example
 * await rewriteLeadingRecord(context, retiredPath, (record) => notedRecordOf(record, sha256)) // => { outcome: 'written', record }
 */
async function rewriteLeadingRecord(
  context: Context,
  retiredPath: string,
  rewrite: (record: Pending) => Pending | undefined,
): Promise<LeadingRecordRewrite> {
  const read = await readVersionedRecord(
    context.pendingPath,
    pendingSchema,
    context.retry,
    context.seam,
  ).catch(() => undefined)
  if (read === undefined) return { outcome: 'unwritten' }
  const { record, version } = read
  // Only the record that leads to that private name.
  if (!isRecordLeadingTo(context, record, retiredPath))
    return { outcome: 'unwritten', record }
  const tracked = context.journalVersion?.current
  // Another version than the run tracks (an older copy a backup shows there) builds no rewrite, even once the tracked one is back before the write's looks.
  if (
    tracked !== undefined &&
    (version.ino !== tracked.ino || version.sha256 !== tracked.sha256)
  )
    return { outcome: 'unwritten', record }
  const rewritten = rewrite(record)
  if (rewritten === undefined) return { outcome: 'unchanged', record }
  // Only the version this call read is replaced: a held run keeps its own tracking, any other run tracks this read.
  const rewriting: Context = {
    ...context,
    journalVersion: context.journalVersion ?? {
      current: version,
      refusesEmptyName: true,
    },
  }
  const isWritten = await writeRecord(
    rewriting,
    context.pendingPath,
    rewritten,
  ).then(
    () => true,
    () => false,
  )
  return { outcome: isWritten ? 'written' : 'unwritten', record }
}

/**
 * Tells whether a publish record is the one of this config that leads to an old record's private name; called by {@link rewriteLeadingRecord} and {@link withNoteState}.
 * @param context - The run.
 * @param record - The publish record as read.
 * @param retiredPath - The old record's private name.
 * @returns `true` when the record covers this config and its generation names that private name.
 * @example
 * isRecordLeadingTo(context, pending, retiredReceiptPathOf(context, pending.generation)) // => true
 */
function isRecordLeadingTo(
  context: Context,
  record: Pending,
  retiredPath: string,
): boolean {
  return (
    record.targetPath === context.path &&
    record.generation !== undefined &&
    retiredReceiptPathOf(context, record.generation) === retiredPath
  )
}

/**
 * Words a put-back's refusal by whether the publish record on disk notes that `receipt.json` is unverified, right before the run answers, so the answer never claims a note that no write put there; called by {@link linkWithoutStaleReceipt} once its mark could not be written and by {@link putBackLater} after its rewrite, for every refusal that left an unverified file at `receipt.json` ({@link UnverifiedReceiptStanding}).
 * @param context - The run.
 * @param error - The put-back's refusal.
 * @returns `error` itself for any other answer, or while the publish record that leads to its private name carries `receiptUnverified` (written before the link, {@link noteBeforePutBack}, or after it, {@link keptRecordOf}); otherwise the same refusal worded without the note ({@link UnrestoredReceiptError.withoutNote}), also when that record cannot be read.
 * @example
 * throw await withNoteState(context, error) // '… is unverified, and Codebook could not note that in its publish record at …/pending.json (for example on a full disk), …' after a full disk at every write
 */
async function withNoteState(
  context: Context,
  error: UnrestoredReceiptError,
): Promise<UnrestoredReceiptError> {
  if (!UNNOTED_STANDINGS.has(error.standing)) return error
  const read = await readVersionedRecord(
    context.pendingPath,
    pendingSchema,
    context.retry,
    context.seam,
  ).catch(() => undefined)
  const retiresReceipt = read?.record.retiresReceipt
  const isNoted =
    read !== undefined &&
    isRecordLeadingTo(context, read.record, error.retiredPath) &&
    typeof retiresReceipt === 'object' &&
    retiresReceipt.receiptUnverified === true
  return isNoted ? error : error.withoutNote(context)
}

/**
 * Tells whether the config that was read shows the inode a first setup staged and that setup's link is proven; called only by {@link settleRetiredReceipt}, which binds this answer to the published bytes before anything rests on it.
 * The inode alone proves nothing once the staged file is gone: a setup whose link failed unlinks it, and a restored config may then take that freed number. The completed publish record ({@link markCompleted}), written only once the link stood, or the staged name and the config name that both showed that inode at the start of this run ({@link isStagedNameLinked}) prove the link; only the config's bytes prove that the file still is that publish.
 * @param pending - The publish record as read.
 * @param config - The identity of the config that was read; undefined when nothing stands there.
 * @param isStagedLinked - What {@link isStagedNameLinked} found before recovery.
 * @returns `true` when the config shows the staged inode and the record or the staged name proves the link; `false` otherwise.
 * @example
 * isProvenLink({ ...pending, phase: 'completed' }, config, false) // => true while the config shows the staged inode
 * isProvenLink(pending, config, false)                            // => false: that inode may be a freed number used again
 */
function isProvenLink(
  pending: Pending,
  config: Pick<FileIdentity, 'ino'> | undefined,
  isStagedLinked: boolean,
): boolean {
  const { stagedIno } = pending
  if (
    !config ||
    stagedIno === undefined ||
    !isSameFileId(stagedIno, config.ino)
  )
    return false
  return pending.phase === 'completed' || isStagedLinked
}

/**
 * Tells whether a first setup's staged name and the config name both show the inode that setup staged, looked at before recovery drops that staged name as a second name of the config ({@link recoverLeftovers}); called by {@link inspect}, whose answer {@link settleRetiredReceipt} takes as proof that the setup's link stood ({@link isProvenLink}).
 * While the staged file still has a name, no other file can have its inode, so a config name that shows it is that file linked in; the config name is looked at only while the staged file has a second name, which it then must.
 * @param context - The run.
 * @param pending - The publish record as read; only one that names a moved-aside receipt ({@link Pending.retiresReceipt}) with a valid generation and a staged inode is looked at.
 * @returns `true` when both names show the staged inode; `false` otherwise, also when either look fails.
 * @example
 * await isStagedNameLinked(context, pending) // => true after a first setup that stopped right after its link
 */
async function isStagedNameLinked(
  context: Context,
  pending: Pending | undefined,
): Promise<boolean> {
  const generation = pending?.generation
  const stagedIno = pending?.stagedIno
  if (
    !pending?.retiresReceipt ||
    stagedIno === undefined ||
    generation === undefined ||
    !GENERATION_PATTERN.test(generation)
  )
    return false
  const staged = await lstatOrAbsent(
    journalPathOf(context.path, generation, 'staged'),
  ).catch(() => undefined)
  // Only a staged file that has a second name can be the config linked in: the config is looked at only then.
  if (!staged || staged.nlink < 2n || !isSameFileId(stagedIno, staged.ino))
    return false
  const config = await lstatOrAbsent(context.path).catch(() => undefined)
  return config !== undefined && isSameFileId(stagedIno, config.ino)
}

/**
 * Tells whether the publish a first setup's record names wrote its own receipt, which it does only once its link stood ({@link publishEntry}), and gives the version of that receipt this read saw, so the drop of the old record that rests on it deletes only while that very receipt still stands ({@link coveringReceiptCheck}); called only by {@link settleRetiredReceipt}, before any look at the config.
 * @param context - The run.
 * @param retiredPath - The private name that holds the old record; the error below names it.
 * @param generation - The publish record's generation.
 * @returns The inode and bytes' hash of the file read at `receipt.json` when it holds a receipt of this config with that generation; undefined when nothing, a link, another config's receipt, another generation's or bytes that are no receipt stand there (the put-back's own look then settles what stands there, {@link standingReceiptOf}).
 * @throws An {@link UnrestoredReceiptError} marked `unread` when `receipt.json` could not be read: that receipt may be this setup's own, so both records stay and no sentence asks to move one; the `receipt-unverified` refusal of {@link assertNotedReceipt} when the publish record notes that receipt.json is unverified and this read found a receipt of that generation with other bytes than the note names (a sync tool may have put it there after {@link assertReceiptVerified} found the name empty), so it never authorizes the delete. Nothing is changed then.
 * @example
 * await publishReceiptVersionOf(context, retiredPath, pending.generation) // => { ino: 44n, sha256: 'ef…' } after a first setup that wrote its receipt and could not delete its publish record
 */
async function publishReceiptVersionOf(
  context: Context,
  retiredPath: string,
  generation: string,
): Promise<RecordVersion | undefined> {
  const read: Awaited<ReturnType<typeof readReceiptWithVersion>> =
    await readReceiptWithVersion(context).catch((error: unknown) => {
      // A failed read says nothing about the receipt, which may be this setup's own: the run stops, keeping both records.
      if (isFailedRead(error))
        throw new UnrestoredReceiptError(
          context,
          retiredPath,
          undefined,
          error,
          'unread',
        )
      return {}
    })
  if (read.receipt?.generation !== generation) return undefined
  // This very read authorizes the delete: under a note that receipt.json is unverified, only the bytes it names pass, whatever an earlier look found there.
  assertNotedReceipt(context, read.version)
  return read.version
}

/**
 * Builds the refusal for a first setup's old record that a later run was to delete beside the record that setup wrote of its entry, when that record no longer stood at `receipt.json` as the run read it (another program changed or moved it away, or it could not be read again) right before the delete; called only by {@link coveringReceiptCheck}, so the old record and the publish record that names it stay and the next run decides again.
 * @param context - The run; gives the receipt's and publish record's paths and the command to run again.
 * @param retiredPath - The private name that holds the old record.
 * @returns The error, not thrown yet.
 * @example
 * throw coveringReceiptRefusal(context, retiredPath) // 'Codebook kept …/receipt.json.<generation>.retired, its own old record of a setup whose entry is gone, and the publish record at …/pending.json, because its record of that setup's entry at …/receipt.json … changed, moved away or could not be read again …'
 */
function coveringReceiptRefusal(
  { receiptPath, pendingPath, retry }: Context,
  retiredPath: string,
): Error {
  return new Error(
    `Codebook kept ${retiredPath}, its own old record of a setup whose entry is gone, and the publish record at ${pendingPath}, because its record of that setup's entry at ${receiptPath}, which showed that this setup had put its config in place, changed, moved away or could not be read again before Codebook would delete the old record (a backup or sync tool may have put an older one back), so it deleted nothing and went no further; ${retry}, and that run looks at both records again.`,
  )
}

/**
 * Reads `receipt.json` through the thread pool right before a later run deletes a first setup's old record on the word of the record that setup wrote of its entry ({@link publishReceiptVersionOf}), and gives the synchronous look the caller runs right before the unlink, so a backup or sync tool that moves that record away or puts another file there meanwhile (as a restore of the old config may) never takes the last record of the old setup with it; called only by {@link lookBeforeRetiredDrop}.
 * @param context - The run.
 * @param retiredPath - The private name that holds the old record; the refusal names it.
 * @param covering - The version of that setup's record the run read at `receipt.json`; undefined when another proof decided the drop.
 * @returns The synchronous look at `receipt.json` ({@link StillLook}), which throws once that name no longer shows the file of this read with its size and times; undefined without `covering`.
 * @throws The {@link coveringReceiptRefusal} when `receipt.json` shows nothing, another inode or other bytes than `covering`, or cannot be read, here or at the synchronous look; nothing is deleted then.
 * @example
 * const receiptStill = await coveringReceiptCheck(context, retiredPath, covering) // throws once a sync tool moved that setup's record away
 */
async function coveringReceiptCheck(
  context: Context,
  retiredPath: string,
  covering: RecordVersion | undefined,
): Promise<StillLook | undefined> {
  if (covering === undefined) return undefined
  const path = context.receiptPath
  const now = await inspectCopy(path).catch(() => undefined)
  // Gone, another file or other bytes, or a read that failed: the record the drop rests on no longer stands as read.
  if (now?.ino !== covering.ino || now.sha256 !== covering.sha256)
    throw coveringReceiptRefusal(context, retiredPath)
  return {
    names: [path],
    assert: (): void => {
      if (!isStagedNameStill(path, now))
        throw coveringReceiptRefusal(context, retiredPath)
    },
  }
}

/**
 * Builds the refusal for a first setup's old record that Codebook was to delete and did not: the delete failed, or the private name no longer showed the file Codebook read there or no longer held the record the drop was decided on; called by {@link dropRetiredReceipt} and {@link assertDecisionStill}, which keep that file and the publish record that names it, so the next run looks at it again, and by {@link keptNameSentence} for a put-back whose delete beside a record that covers the old one failed.
 * @param context - The run; gives the publish record's path and the command to run again.
 * @param retiredPath - The private name that holds the old record.
 * @param cause - What the delete threw; undefined when the name showed another file, held another record or could not be looked at.
 * @returns The error, not thrown yet.
 * @example
 * throw retiredDropRefusal(context, retiredPath, eio) // 'Codebook could not delete …/receipt.json.<generation>.retired, its own old record of a setup whose entry is gone (…), so it kept that file and the publish record at …/pending.json, and the next run looks at that file again; …'
 */
function retiredDropRefusal(
  { pendingPath, retry }: Context,
  retiredPath: string,
  cause?: unknown,
): Error {
  return new Error(
    `Codebook could not delete ${retiredPath}, its own old record of a setup whose entry is gone (the delete failed, or Codebook could not tell that this file is still the record it read), so it kept that file and the publish record at ${pendingPath}, and the next run looks at that file again; make the folder that holds them writable by you if it is not, ${retry}.`,
    cause === undefined ? undefined : { cause },
  )
}

/**
 * Builds the refusal for a later run that found a first setup's old record's private name empty ({@link endOnEmptyName}) and, at its look right before it ended the publish record that leads there, found a file there again or could not look; called only by the look {@link retiredNameCheck} gives {@link retirePending}, which then keeps that publish record byte for byte, and the run goes no further.
 * @param context - The run; gives the publish record's path and the command to run again.
 * @param retiredPath - The private name that was found empty.
 * @returns The error, not thrown yet.
 * @example
 * throw retiredBackRefusal(context, retiredPath) // 'Codebook found nothing at …/receipt.json.<generation>.retired, where it had moved its own old record of a setup whose entry is gone, but right before it ended its publish record at …/pending.json a file stood there again (…), so it kept that publish record and went no further; …'
 */
function retiredBackRefusal(
  { pendingPath, retry }: Context,
  retiredPath: string,
): Error {
  return new Error(
    `Codebook found nothing at ${retiredPath}, where it had moved its own old record of a setup whose entry is gone, but right before it ended its publish record at ${pendingPath} a file stood there again (a backup or sync tool may have put that record back) or it could not look at that name, so it kept that publish record and went no further; ${retry}, and that run looks at ${retiredPath} again.`,
  )
}

/**
 * Deletes a first setup's old record from its private name once that setup put its config in place, only while that name still shows the very file the publish record names by its bytes ({@link isMovedFile}), as it was read there; called by {@link settleRetiredReceipt} wherever it drops that record.
 * Every route deletes only while the publish record that led there still stands as this run read it, at a synchronous look right before the unlink ({@link lookBeforeRetiredDrop}). What proves the setup's link (its own receipt, the inode it published, its entry) identifies nothing at the private name, which a backup may have filled again: a file there that is no record of this config is never deleted and no longer looked at, and the delete acts only on the file that was read. A drop decided on a look at the config ({@link DecidedDrop}) deletes only the record that decision read, the same inode with the same bytes: another record put at the private name since may own the entry that stands, so it stays and the next run decides on it. It holds only while the config still holds that look's bytes and, right before the delete, its identity: a backup may restore the config the old record covers while that record is read. A drop the published inode and bytes proved ({@link isProvenLink}) likewise holds only while a fresh read still finds those published bytes in that file and the config still is that exact file right before the delete.
 * @param context - The run.
 * @param retiredPath - The private name that holds the old record.
 * @param identity - What names the file the setup moved there ({@link movedIdentityOf}); undefined names none, so nothing is deleted.
 * @param decided - The look at the config and the record the drop was decided on ({@link retiredReceiptFateOf}); undefined when the setup's own receipt or its published inode decided it.
 * @param covering - The version of the record the setup wrote of its entry that the run read at `receipt.json` when that record decided the drop ({@link publishReceiptVersionOf}): the delete goes on only while that record still stands as read ({@link coveringReceiptCheck}); undefined when the published inode or a look at the config decided it.
 * @param provenConfig - The look at the config whose staged inode and published bytes proved the setup's link ({@link isProvenLink}): the delete goes on only while a fresh read still finds those bytes in that file and the config still is that exact file right before the unlink; undefined when another proof decided the drop.
 * @returns Resolves once the old record is gone, or once the name holds nothing of Codebook's to delete (also any file the publish record does not name).
 * @throws An {@link UnrestoredReceiptError} marked `moved-unread` when the private name could not be looked at or read, the {@link changedWhileWorking} refusal and what {@link lookAtConfig} throws when the config is no longer what `decided` read or no longer is `provenConfig`, the {@link retiredDropRefusal} when the name no longer shows the file that was read or holds another record than `decided` read, or the delete failed for another reason than a name already gone, the {@link coveringReceiptRefusal} when `receipt.json` no longer shows `covering`, and a {@link JournalConflictError} when the publish record changed, disappeared or could not be read by the last looks ({@link lookBeforeRetiredDrop}); that file and the publish record stay then.
 * @example
 * await dropRetiredReceipt(context, retiredPath, identity, undefined, covering) // the old record is gone after a setup whose own record stands
 * await dropRetiredReceipt(context, retiredPath, identity, fate)                // rejects when a backup restored the old config meanwhile
 */
async function dropRetiredReceipt(
  context: Context,
  retiredPath: string,
  identity: MovedIdentity | undefined,
  decided?: DecidedDrop,
  covering?: RecordVersion,
  provenConfig?: Extract<ConfigLook, { kind: 'present' }>,
): Promise<void> {
  const movedUnread = (cause: unknown): UnrestoredReceiptError =>
    new UnrestoredReceiptError(
      context,
      retiredPath,
      undefined,
      cause,
      'moved-unread',
    )
  const read = await lstatOrAbsent(retiredPath).catch((cause: unknown) => {
    throw movedUnread(cause)
  })
  // Nothing, or no regular file, stands there: nothing of Codebook's old record is left to delete.
  if (!read?.isFile()) return
  const retired = await readRetiredRecord(context, retiredPath).catch(
    (error: unknown) => {
      if (isFailedRead(error)) throw movedUnread(error)
      // Bytes that are no record are not Codebook's old record.
      return undefined
    },
  )
  // Gone meanwhile, or a file that is no record of this config: it is never deleted.
  if (retired?.receipt.targetPath !== context.path) return
  // The private name must still hold the record the drop was decided on, and the config the bytes of that look.
  if (decided)
    await assertDecisionStill(context, retiredPath, decided, read.ino, retired)
  // Only the record the setup moved there goes: another installation's record there, or any file an older build's record leads to, stays and is no longer looked at.
  if (!isMovedFile(identity, retired)) return
  // The inode proof holds only while a fresh read still finds the published bytes in that same file.
  if (provenConfig) await assertProvenConfigStill(context, provenConfig)
  // The awaited steps first; the last looks run synchronously right before the delete, nothing awaited in between.
  const lastLooks = await lookBeforeRetiredDrop(
    context,
    retiredPath,
    retired.look,
    decided,
    covering,
    provenConfig,
  )
  lastLooks()
  await unlink(retiredPath).catch((cause: unknown) => {
    // A name already gone is what the delete was for.
    if (codeOf(cause) !== 'ENOENT')
      throw retiredDropRefusal(context, retiredPath, cause)
  })
}

/**
 * Prepares the last looks before a later run deletes a first setup's old record on the word of its publish record ({@link dropRetiredReceipt}): awaits the read of that record ({@link recordStillCheck}) and a look at each name through the thread pool ({@link lookAheadAt}), and gives the synchronous looks the caller runs right before the unlink, so a publish record a backup or sync tool puts back meanwhile (that setup's record marked {@link Pending.notLinked}, which leads to putting the old record back) never loses the old record; called only by {@link dropRetiredReceipt}.
 * The synchronous looks: the publish record's name first, then the private name, which must still show the open file whose bytes were read, then, for a drop the record the setup wrote of its entry decided, `receipt.json`, which must still show that record as read ({@link coveringReceiptCheck}), and last the config name (its nanosecond times included) when a look at it decided the drop or its inode and published bytes proved the setup's link. Limit: a file put at any of those names between those looks and the unlink is not seen; no Node primitive unlinks by inode.
 * @param context - The run; its pending path is the publish record it tracks.
 * @param retiredPath - The private name that holds the old record.
 * @param look - The look of the open file the old record was read from ({@link RetiredRecordRead}).
 * @param decided - The look at the config and the record the drop was decided on; undefined when the setup's own receipt or its published inode decided it.
 * @param covering - The version of the record the setup wrote of its entry that decided the drop ({@link publishReceiptVersionOf}); undefined when the published inode or a look at the config decided it.
 * @param provenConfig - The look at the config whose staged inode and published bytes proved the setup's link; undefined when another proof decided the drop.
 * @returns The synchronous last looks, which return once every name still shows what was read.
 * @throws A {@link JournalConflictError} when the publish record changed, disappeared or cannot be read, at the read or at the synchronous look; the {@link retiredDropRefusal} when the private name shows another file, nothing, or cannot be looked at; the {@link coveringReceiptRefusal} when `receipt.json` no longer shows `covering`, at the read or at the synchronous look; the {@link changedWhileWorking} refusal when the config is no longer the file the drop was decided on or the file whose look proved the link. Nothing is deleted then.
 * @example
 * const lastLooks = await lookBeforeRetiredDrop(context, retiredPath, retired.look, undefined, covering)
 * lastLooks() // throws once a backup put that setup's marked record back at pending.json
 */
async function lookBeforeRetiredDrop(
  context: Context,
  retiredPath: string,
  look: RecordLook,
  decided: DecidedDrop | undefined,
  covering: RecordVersion | undefined,
  provenConfig?: Extract<ConfigLook, { kind: 'present' }>,
): Promise<() => void> {
  const recordStill = await recordStillCheck(context)
  const receiptStill = await coveringReceiptCheck(
    context,
    retiredPath,
    covering,
  )
  // A storage that already stalls holds this step here, in the order of the synchronous looks below.
  await lookAheadAt([
    ...(recordStill?.names ?? []),
    retiredPath,
    ...(receiptStill?.names ?? []),
    ...(decided || provenConfig ? [context.path] : []),
  ])
  return (): void => {
    recordStill?.assert()
    // The delete acts on the name, which must still show the very file whose bytes were read (the open file's look, never the name's earlier one).
    if (nameStateNow(context, retiredPath, look) !== 'still')
      throw retiredDropRefusal(context, retiredPath)
    // The record the setup wrote of its entry, which decided the drop, must still stand as read.
    receiptStill?.assert()
    // A drop decided on the config's entry keeps that whole look's byte comparison; a drop decided on the inode keeps the exact file identity that proved the link.
    if (decided)
      assertConfigUnchanged(
        context,
        decided.config.kind === 'present' ? decided.config.identity : undefined,
      )
    // And the config name must still show the file whose inode and published bytes proved the link, right before the delete.
    if (provenConfig) assertConfigUnchanged(context, provenConfig.identity)
  }
}

/**
 * Stops the drop of a first setup's old record when the config no longer is the file whose inode and published bytes proved the setup's link, or no longer holds those bytes; called only by {@link dropRetiredReceipt}, before its last looks.
 * The inode proof is captured only with the bytes' hash ({@link settleRetiredReceipt}), because once recovery dropped the staged second name, a backup or sync tool can rewrite a restored config in place in that same file. This fresh read binds the proof to the published bytes again after the old record was read; the synchronous look right before the unlink then keeps the file's identity, size and times ({@link lookBeforeRetiredDrop}).
 * @param context - The run.
 * @param provenConfig - The config look whose inode and bytes' hash proved the publish.
 * @throws The {@link changedWhileWorking} refusal when the config is absent, another inode or holds other bytes now, and what {@link lookAtConfig} throws; nothing is deleted then.
 * @example
 * await assertProvenConfigStill(context, provenConfig) // rejects after a backup rewrote the restored old config into the published file
 */
async function assertProvenConfigStill(
  context: Context,
  provenConfig: Extract<ConfigLook, { kind: 'present' }>,
): Promise<void> {
  const now = await lookAtConfig(context)
  if (
    now.kind !== 'present' ||
    now.identity.ino !== provenConfig.identity.ino ||
    now.sha256 !== provenConfig.sha256
  )
    throw changedWhileWorking(context)
}

/**
 * Stops the drop of a first setup's old record when the private name no longer holds the record the drop was decided on, as after a backup put another record there that may own the entry that stands, or the config no longer holds the bytes the drop was decided on, as after a backup restored the config that record covers while Codebook read the record; called only by {@link dropRetiredReceipt}, before its last looks.
 * @param context - The run.
 * @param retiredPath - The private name that holds the old record.
 * @param decided - The look at the config and the record the drop was decided on.
 * @param nameIno - The inode the private name showed right before the record was read again.
 * @param retired - The record as it was read again.
 * @throws The {@link retiredDropRefusal} when the name or the file read again shows another inode than the decided record or its bytes differ, the {@link changedWhileWorking} refusal when the config is gone or holds other bytes now, and what {@link lookAtConfig} throws; nothing is changed then.
 * @example
 * await assertDecisionStill(context, retiredPath, fate, read.ino, retired) // rejects after a backup put the old config back
 */
async function assertDecisionStill(
  context: Context,
  retiredPath: string,
  decided: DecidedDrop,
  nameIno: bigint,
  retired: RetiredRecordRead,
): Promise<void> {
  const { record } = decided
  // Another record at the private name since the decision stays: the next run decides on it.
  if (
    nameIno !== record.ino ||
    retired.ino !== record.ino ||
    retired.sha256 !== record.sha256
  )
    throw retiredDropRefusal(context, retiredPath)
  const now = await lookAtConfig(context)
  // An absent config has no bytes, so it matches only a look that found none.
  const bytesOf = (look: ConfigLook): string | undefined =>
    look.kind === 'present' ? look.sha256 : undefined
  if (bytesOf(now) !== bytesOf(decided.config))
    throw changedWhileWorking(context)
}

/** A first setup's old record as one read of its private name found it ({@link readRetiredRecord}): the receipt, the inode of the file that was read, the SHA-256 of its bytes and that open file's look, which the delete compares ({@link dropRetiredReceipt}). */
type RetiredRecordRead = {
  receipt: Receipt
  ino: bigint
  sha256: string
  look: RecordLook
}

/** A drop of a first setup's old record decided on one look at the config ({@link retiredReceiptFateOf}): that look and the record it read, which the delete must find again ({@link assertDecisionStill}). */
type DecidedDrop = { config: ConfigLook; record: RetiredRecordRead }

/** What a later run does with a first setup's old record that waits under its private name ({@link retiredReceiptFateOf}); `compare` is a put-back that never links ({@link PutBackOptions.isBesideStanding}), and a {@link DecidedDrop} deletes the record it read. */
type RetiredReceiptFate = 'put-back' | 'compare' | 'undecided' | DecidedDrop

/**
 * Reads a first setup's old record from its private name with the inode, the hash of the bytes read and the open file's look; called by {@link retiredReceiptFateOf}, whose drop carries them, and by {@link dropRetiredReceipt}, which deletes only the record they name.
 * @param context - The run.
 * @param retiredPath - The private name that holds the old record.
 * @returns The record with its inode, bytes hash and look ({@link RetiredRecordRead}); undefined when the name is empty.
 * @throws What {@link readRecordFile} and {@link parseRecord} throw.
 * @example
 * await readRetiredRecord(context, retiredPath) // => { receipt: oldReceipt, ino: 42n, sha256: '9f86…', look: { ino: 42n, size: 310n, mtimeNs, ctimeNs } }
 */
async function readRetiredRecord(
  context: Context,
  retiredPath: string,
): Promise<RetiredRecordRead | undefined> {
  const read = await readRecordFile(retiredPath, context.retry, context.seam)
  if (read === undefined) return undefined
  return {
    receipt: parseRecord(retiredPath, receiptSchema, context.retry, read.bytes),
    ino: read.ino,
    sha256: bytesSha256(read.bytes),
    look: read.look,
  }
}

/**
 * Decides what becomes of a first setup's old record that waits under its private name, on the one look at the config that a later run decides on; called only by {@link settleRetiredReceipt}.
 * A first setup publishes only where no `codebook` entry stands ({@link writeManagedDevinMcpEntry}), so an entry that hashes like that setup's own and that the old record does not own is that setup's publish, saved again since (its inode tells nothing then): the old record owns nothing that stands and goes, as when the link stood. An entry the old record owns too may be either setup's: a record marked {@link Pending.notLinked} never reaches here, and one without the mark may be a publish whose link stood or one whose mark was never written, so neither record is touched.
 * @param context - The run.
 * @param pending - The publish record as read.
 * @param retiredPath - The private name that holds the old record.
 * @param look - The look at the config the run decides on.
 * @returns
 * - a {@link DecidedDrop} (that look and the record read) when the config holds the setup's own entry and the old record is a receipt of this config that does not own it (another bridge path, as after an update moved Codebook's folder)
 * - `undecided` when the config holds the setup's own entry, the old record owns it too and nothing stands at `receipt.json`
 * - `compare` in that same case while something stands at `receipt.json`: the put-back's own look settles it ({@link standingReceiptOf}) and never links the old record, so a name found empty by then is undecided again
 * - `put-back` otherwise: the config holds no entry of that setup, or the old record is gone or not the file the publish record names ({@link isMovedFile})
 * @throws An {@link UnrestoredReceiptError} marked `moved-unread` when the old record could not be read (it names that file and asks to delete neither record), what {@link readRecordFile} and {@link parseRecord} throw when its name holds a link or bytes that are no record, and an {@link UnrestoredReceiptError} marked `unread` when `receipt.json` cannot be looked at; nothing is changed then.
 * @example
 * await retiredReceiptFateOf(context, pending, retiredPath, look) // => 'undecided' after a setup that stopped after its link and a config saved again with the same entry
 * await retiredReceiptFateOf(context, pending, retiredPath, look) // => { config: look, record: { receipt: oldReceipt, ino: 42n, sha256: '9f86…' } } when that setup wrote another bridge path than the old record covers
 */
async function retiredReceiptFateOf(
  context: Context,
  pending: Pending,
  retiredPath: string,
  look: ConfigLook,
): Promise<RetiredReceiptFate> {
  const current = currentEntryOf(look)
  const entrySha256 = plainEntryHashOf(pending.entrySha256)
  // Only the entry the setup itself was about to publish leaves the question open.
  if (entrySha256 === undefined || coreHashOf(current) !== entrySha256)
    return 'put-back'
  const retired = await readRetiredRecord(context, retiredPath).catch(
    (error: unknown) => {
      // A failed read says nothing about the record: both records stay, and no sentence asks to delete one. A link or bytes that are no record keep their own sentence.
      if (isFailedRead(error))
        throw new UnrestoredReceiptError(
          context,
          retiredPath,
          undefined,
          error,
          'moved-unread',
        )
      throw error
    },
  )
  // Gone, or not the record the publish record names (no record of this config, another one, or any record an older build's record leads to): the put-back settles it, which names that file.
  if (retired === undefined || !isMovedFile(movedIdentityOf(pending), retired))
    return 'put-back'
  // That setup's publish stands and the old record owns none of it: the drop deletes only the record read here.
  if (!ownsEntry(current, retired.receipt))
    return { config: look, record: retired }
  const standing = await lstatOrAbsent(context.receiptPath).catch(
    (cause: unknown) => {
      throw new UnrestoredReceiptError(
        context,
        retiredPath,
        undefined,
        cause,
        'unread',
      )
    },
  )
  return standing ? 'compare' : 'undecided'
}

/**
 * Gives the id a receipt written now carries; called by every receipt write ({@link publishEntry}, {@link adoptPending}).
 * @param receipt - The receipt that stands, if any.
 * @returns The receipt's installation id, or a new random one where no receipt stands or the receipt has none.
 * @example
 * installationIdOf(undefined) // => 'f3b1c0de-...'
 */
function installationIdOf(receipt: Receipt | undefined): string {
  return receipt?.installationId ?? randomUUID()
}

/**
 * Gives a receipt of an older build its installation id, rewriting only the receipt; called by {@link refreshManagedDevinMcpEntry} and {@link writeManagedDevinMcpEntry} when the entry is already current.
 * @param context - The run.
 * @param receipt - The receipt that stands.
 * @returns Resolves once the receipt holds an id; nothing is written when it already does.
 * @throws The failure of the receipt write, among them the {@link receiptConflictError} when `receipt.json` no longer shows the record the run read there ({@link writeReceipt}), which then stays; the entry and the config stay as they were.
 * @example
 * await withInstallationId(context, receipt)
 */
async function withInstallationId(
  context: Context,
  receipt: Receipt,
): Promise<void> {
  if (receipt.installationId) return
  await writeReceipt(context, { ...receipt, installationId: randomUUID() })
}

/**
 * Tells whether the config file is the one Codebook created: an absent file is created now; an existing one counts only while the receipt says Codebook created it and its inode is the one Codebook last wrote.
 * @param look - What the config looked like.
 * @param receipt - The receipt that stands, if any.
 * @returns Whether `createdFile` is true for the next receipt.
 * @example
 * createdFileFor({ kind: 'absent' }, undefined) // => true
 */
function createdFileFor(
  look: ConfigLook,
  receipt: Receipt | undefined,
): boolean {
  if (look.kind === 'absent') return true
  return Boolean(
    receipt?.createdFile && isSameFileId(receipt.config.ino, look.identity.ino),
  )
}

/**
 * Builds the complete new top-level object: the config as it was read with the `codebook` entry set; called by {@link publishEntry}.
 * @param look - What the config looked like.
 * @param entry - The server entry to keep.
 * @returns The new root. The three keys Codebook owns are replaced; the keys Devin manages (`disabled`, `disabledTools`) of an existing entry stay.
 * @example
 * rootWithEntry({ kind: 'absent' }, entry) // => { mcpServers: { codebook: entry } }
 */
function rootWithEntry(look: ConfigLook, entry: DevinMcpEntry): JsonObject {
  const base = look.kind === 'present' ? look.root : {}
  const servers = look.kind === 'present' ? (look.servers ?? {}) : {}
  const existing = servers[SERVER_NAME]
  const written = isJsonObject(existing) ? { ...existing, ...entry } : entry
  return { ...base, mcpServers: { ...servers, [SERVER_NAME]: written } }
}

/**
 * Tells the caller that Devin's Customize switched the `codebook` entry off, so it can say the server is disabled.
 * @param entry - The `codebook` entry as parsed.
 * @returns `{ disabled: true }` when the entry has `"disabled": true`; an empty object otherwise.
 * @example
 * disabledFlagOf({ command: 'node', disabled: true }) // => { disabled: true }
 * disabledFlagOf({ command: 'node' }) // => {}
 */
function disabledFlagOf(entry: unknown): { disabled?: true } {
  return isJsonObject(entry) && entry.disabled === true
    ? { disabled: true }
    : {}
}

/** What a write reports about the entry it published. */
type PublishedEntry = { generation: string; cleanupFailure?: string }

/** How a first setup's rollback ended: `took-out` (the entry is gone), `replaced-config` (another file stands at the config path, so it was left alone), `not-ours` (the file is gone, or its `codebook` entry is no longer the one this setup wrote, so nothing was touched and nothing may be removed by hand on Codebook's word) `unreadable` (the file could not be read again, so Codebook never confirmed the entry as its own and touched nothing), `not-taken-out` (Codebook's own entry, confirmed as its own, could not be taken out) `journal-taken` (something already stood at the name of the rollback's own journal, which its first write never replaces, or another file or nothing stood there at the last look right before the config would move, so nothing moved and the config was left unchanged), `took-out-record-taken` (the entry is gone, but another file stood at the rollback journal's name as the rollback was about to delete its journal, so that file stays and the run goes no further, {@link dropFinishedRecord}) or `took-out-record-unread` (the entry is gone, but that name could not be read again then, so what stands there stays and the run goes no further); `keptLeft` holds the copies the rollback itself left. */
type RollbackResult = {
  outcome:
    | 'took-out'
    | 'replaced-config'
    | 'edited-config'
    | 'unverified-config'
    | 'not-ours'
    | 'unreadable'
    | 'not-taken-out'
    | 'journal-taken'
    | 'took-out-record-taken'
    | 'took-out-record-unread'
    /** Set only by {@link takeOutUnrecordedEntry}: the setup's record changed, moved away or could not be read again before the take-back changed the config. */
    | 'record-changed'
  keptLeft: KeptFile[]
  /** Set with `took-out`: whether the whole file went or only the entry. */
  removal?: 'file-removed' | 'removed'
}

/** What {@link confirmPublishedConfig} found: the config while it is the file a setup published, with that setup's entry, or why it is not. */
type PublishedConfigLook =
  | { look: Extract<ConfigLook, { kind: 'present' }> }
  | {
      outcome: Extract<
        RollbackResult['outcome'],
        'unreadable' | 'not-ours' | 'replaced-config'
      >
    }

/**
 * Reads the config again and tells whether it is still the file a setup published with that setup's entry; called by {@link rollBackPublishedEntry} before it takes that entry out and by {@link settleRecordConflict} before a setup whose completed record met another program's record writes its receipt.
 * @param context - The run.
 * @param written - The receipt of that setup; its `config.ino` is the file it published, its entry hash the entry it wrote.
 * @returns
 * - the config as read while it is present, holds that entry ({@link ownsEntry}) and has the published inode
 * - `unreadable` when the read failed (a link swapped in, no permission), so the entry was never confirmed
 * - `not-ours` when the file is gone or its entry is no longer the one that setup wrote
 * - `replaced-config` when another file (another inode) stands there, even with the same entry
 * @example
 * await confirmPublishedConfig(context, written) // => { outcome: 'replaced-config' } once a backup put the old config back
 */
async function confirmPublishedConfig(
  context: Context,
  written: Receipt,
): Promise<PublishedConfigLook> {
  let look: ConfigLook
  try {
    look = await lookAtConfig(context)
  } catch {
    // The re-read failed (a link swapped in, no permission): the entry was never confirmed as Codebook's.
    return { outcome: 'unreadable' }
  }
  // The file is gone or its entry is no longer the one this setup wrote (an editor saved another one): the learner's entry is never Codebook's.
  if (
    look.kind !== 'present' ||
    !ownsEntry(look.servers?.[SERVER_NAME], written)
  )
    return { outcome: 'not-ours' }
  // An editor saved a new file (a new inode) with the same entry: that file is not the one Codebook published.
  if (!isSameFileId(written.config.ino, look.identity.ino))
    return { outcome: 'replaced-config' }
  return { look }
}

/**
 * Takes the entry out of the config file a first setup published, never of another file; called by {@link takeOutUnrecordedEntry}.
 * The rollback writes its own journal beside the setup's pending record ({@link rollbackContextOf}), so a crash or failure during it leaves the setup's record, the proof that the entry is Codebook's, intact.
 * @param context - The run.
 * @param written - The receipt that could not be written; its `config.ino` is the file the setup published.
 * @param stagedSha256 - The hash of the bytes staged for publication, when the setup record supplies it.
 * @param configStill - During the current setup, the additional identity check from receipt settlement.
 * @returns The {@link RollbackResult}; a config that cannot be read again is `unreadable` and left unchanged; a config that was saved again meanwhile (another inode) is `replaced-config` even when it holds the same entry, and is left unchanged; a missing file or an entry that no longer hashes like this setup's is `not-ours`; something that already stands at the rollback journal's name, or another file or nothing there at the take-back's last look before the config moves ({@link assertTakeBackRecordStill}), is `journal-taken`, and nothing moved; another file at that name once the entry is out, as the journal was to be deleted, is `took-out-record-taken`, and a name that could not be read again then is `took-out-record-unread`; what stands there stays.
 * @throws The refusals of {@link takeEntryOut}, after the entry was confirmed as Codebook's own; the caller turns them into `not-taken-out`, except the {@link RecordConflictError} of a take-back whose publish record no longer stands as its run read or wrote it ({@link assertTakeBackRecordStill}), which {@link finishCutShortSetup} rethrows and {@link takeOutUnrecordedEntry} answers as `record-changed`, because nothing moved.
 */
async function rollBackPublishedEntry(
  context: Context,
  written: Receipt,
  stagedSha256: string | undefined,
  configStill?: StillLook,
): Promise<RollbackResult> {
  const confirmed = await confirmPublishedConfig(context, written)
  // Not the file this setup published with its entry, or one that cannot be read again: nothing is touched.
  if (!('look' in confirmed))
    return { outcome: confirmed.outcome, keptLeft: [] }
  const { look } = confirmed
  // The same snapshot that proves the original config also guards its move during rollback.
  const conflict = rollbackConfigConflict(look, stagedSha256, configStill)
  if (conflict) return { outcome: conflict, keptLeft: [] }
  try {
    const { keptLeft, status } = await takeEntryOut(
      rollbackContextOf(context, written.generation),
      { look, receipt: written },
    )
    return { outcome: 'took-out', keptLeft, removal: status }
  } catch (error) {
    // The entry is out, but another file stood where the take-back's journal was to be deleted, or that name could not be read again: what stands there stays, and the run goes no further.
    if (error instanceof TakenOutConflictError)
      return {
        outcome:
          error.kind === 'unread'
            ? 'took-out-record-unread'
            : 'took-out-record-taken',
        keptLeft: [],
      }
    // Only the journal's first write, a claim, and the last look at that journal right before the config moves let this escape otherwise (every later journal write of the take-back swallows its failure), so nothing moved.
    if (error instanceof JournalConflictError)
      return { outcome: 'journal-taken', keptLeft: [] }
    throw error
  }
}

/**
 * Checks the snapshot used by {@link rollBackPublishedEntry} against the bytes staged for publication and, during the same setup, the identity found before writing the receipt.
 * Older records without that evidence keep their existing entry and inode checks.
 * @example
 * rollbackConfigConflict(look, pending.stagedSha256) // 'edited-config' after an in-place change
 */
function rollbackConfigConflict(
  look: Extract<ConfigLook, { kind: 'present' }>,
  stagedSha256: string | undefined,
  configStill?: StillLook,
): 'edited-config' | 'unverified-config' | undefined {
  // Only a mismatch of verified bytes establishes a content edit.
  if (stagedSha256 !== undefined && look.sha256 !== stagedSha256)
    return 'edited-config'
  try {
    configStill?.assert()
    return undefined
  } catch {
    return 'unverified-config'
  }
}

/** Keeps the learner's edited or unowned server entry available when they run setup again. */
const KEEP_ENTRY_ADVICE = `rename the "${SERVER_NAME}" entry to an unused name to keep its settings`

/** The end of a rollback journal's name beside `pending.json` ({@link rollbackContextOf}); {@link journalConflictError} words a conflict at a name with it as a rollback record's. */
const ROLLBACK_JOURNAL_SUFFIX = '.rollback'

/**
 * The run with a pending record of its own for a rollback, so the setup's record is never overwritten; its name differs from the one {@link recoverLeftovers} reads.
 * @param context - The run.
 * @param publishGeneration - The generation of the publish being rolled back; every journal of the rollback records it. Omit it to only read or settle a journal. With it, the context tracks its journal from its first write ({@link Context.journalVersion}), which claims the name and never replaces what stands there ({@link claimJournal}).
 * @returns The rollback's context.
 * @example
 * rollbackContextOf(context, generation).pendingPath // => '…/devin-mcp/pending.json.rollback'
 */
function rollbackContextOf(
  context: Context,
  publishGeneration?: string,
): Context {
  return {
    ...context,
    pendingPath: `${context.pendingPath}${ROLLBACK_JOURNAL_SUFFIX}`,
    // A caller's tracked version is of its own pending path ({@link heldPublishContext}), never of this journal; a take-back's own tracker below replaces it.
    journalVersion: undefined,
    ...(publishGeneration !== undefined && {
      rollbackOf: publishGeneration,
      journalVersion: { current: undefined },
      // A run that read its publish record takes the entry back only while that record still stands as read.
      ...(context.journalVersion?.refusesEmptyName && {
        takeBackRecordRun: context,
      }),
    }),
  }
}

/**
 * Stops a take-back right before its first change to the config unless the records it rests on still stand: the publish record its run read at `pending.json` as that run read or last wrote it ({@link Context.takeBackRecordRun}), which proves the entry is the failed setup's, and the take-back's own rollback record as its claim linked it ({@link claimJournal}), which names the private name the config moves to; so a record a backup or sync tool moved away, replaced or made unreadable after that read or that claim never has the entry or the config Codebook created moved on its word; called by {@link deleteConfig} and {@link moveConfigAside} after every awaited step of theirs and right before their last look at the config.
 * Both names are read through the thread pool first, the publish record's, then the take-back's own ({@link lookAtTrackedJournal}), so a storage that already stalls stalls there; the synchronous looks follow in that order ({@link assertTrackedJournalStill}), and the config's own last look after them, with nothing awaited between them.
 * Limit: a record moved or replaced after its synchronous look, while the config is renamed or moved aside, is seen only when the run ends that record ({@link retirePending}, {@link dropFinishedRecord}), after the config changed; no Node primitive renames one name only while another shows a given inode.
 * @param context - The run that is about to move the config; only a take-back's context ({@link rollbackContextOf} with a generation) looks at anything, at the publish record only when its run tracks one.
 * @throws A {@link RecordConflictError} with the publish record's own sentence ({@link journalConflictError}) when its name shows nothing (`gone`), another file or other bytes (`changed`), or cannot be read again (`unread`); a {@link JournalConflictError} for the take-back's own record in the same three cases, which {@link rollBackPublishedEntry} answers as it answers its claim's (`journal-taken`); nothing moved then.
 * @example
 * await assertTakeBackRecordStill(rollbackContext) // throws a RecordConflictError once a sync tool moved pending.json away after the run read it
 * await assertTakeBackRecordStill(rollbackContext) // throws a JournalConflictError once a sync tool renamed another file over pending.json.rollback after the claim
 */
async function assertTakeBackRecordStill(context: Context): Promise<void> {
  // Only a take-back's context tracks its own rollback record, from its claim on.
  if (context.rollbackOf === undefined) return
  const assertRecordStill = await takeBackRecordLook(context.takeBackRecordRun)
  const ownRecord = await lookAtTrackedJournal(context)
  // An empty name: the record that names the private name the config moves to disappeared after the claim.
  if (!ownRecord) throw journalConflictError(context, 'gone')
  assertRecordStill?.()
  assertTrackedJournalStill(context, ownRecord)
}

/**
 * Reads the publish record a take-back rests on through the thread pool and gives back its synchronous last look; called by {@link assertTakeBackRecordStill}, which runs that look only after its awaited look at the take-back's own record, so nothing awaited stands between the synchronous looks and the move of the config.
 * @param run - The run that tracks the `pending.json` it read ({@link Context.takeBackRecordRun}); undefined when it tracks none.
 * @returns
 * - undefined without a run
 * - otherwise the synchronous look at that name ({@link assertTrackedJournalStill}), which throws as below
 * @throws A {@link RecordConflictError} with that record's own sentence ({@link journalConflictError}) when its name shows nothing (`gone`), another file or other bytes (`changed`), or cannot be read again (`unread`), from the read or from the look it gives back; nothing moved then.
 * @example
 * const assertRecordStill = await takeBackRecordLook(rollbackContext.takeBackRecordRun)
 * assertRecordStill?.() // throws once a sync tool moved pending.json away after that read
 */
async function takeBackRecordLook(
  run: Context | undefined,
): Promise<StillLook['assert'] | undefined> {
  if (!run) return undefined
  const recordLook = await lookAtTrackedJournal(run).catch((error: unknown) => {
    throw asRecordConflict(error)
  })
  // An empty name: the record the take-back rests on disappeared after the run read it.
  if (!recordLook) throw asRecordConflict(journalConflictError(run, 'gone'))
  return (): void => {
    try {
      assertTrackedJournalStill(run, recordLook)
    } catch (error) {
      throw asRecordConflict(error)
    }
  }
}

/**
 * Builds the sentence about the copies of the learner's previous config that stay after a failed first setup, and about a published config's staged name that holds changes the config name no longer reaches ({@link KeptFile.isEditedApart}).
 * @param keptLeft - The files the publish left, with what they hold.
 * @returns An empty string when nothing stays, else a sentence naming each copy.
 * @example
 * keptCopiesSentence([]) // => ''
 */
function keptCopiesSentence(keptLeft: KeptFile[]): string {
  return keptLeft
    .filter(
      ({ holds, isEditedApart }) =>
        holds === 'previous' || isEditedApart === true,
    )
    .map((kept) => ` ${alsoKeptSentence(kept)}`)
    .join('')
}

/**
 * Words one copy of the previous config that a failed first setup left; called by {@link keptCopiesSentence}.
 * @param kept - The copy, with what the record on disk still does with it.
 * @returns
 * - the {@link replacedCopySentence} when another program put another file at its name ({@link KeptFile.isReplaced})
 * - the {@link editedApartSentence} for a published config's staged name that holds changes the config name no longer reaches ({@link KeptFile.isEditedApart})
 * - a sentence with the {@link LEFTOVER_CLAUSE} for a copy a record still lets a later run delete ({@link KeptFile.isLeftover})
 * - a sentence with the {@link UNCONFIRMED_CLAUSE} for a copy whose record could not be read back ({@link KeptFile.isUnconfirmed})
 * - a sentence that leaves the copy to the learner otherwise
 * @example
 * alsoKeptSentence({ path, holds: 'previous' }) // => 'Codebook also kept a private copy of your previous Devin MCP config at … ; delete that copy when you no longer need it.'
 */
function alsoKeptSentence(kept: KeptFile): string {
  if (kept.isReplaced) return replacedCopySentence(kept.path)
  if (kept.isEditedApart) return editedApartSentence(kept.path)
  const next = copyFateClause(
    kept,
    '; delete that copy when you no longer need it',
  )
  return `Codebook also kept ${keptCopyPhrase(kept.path)}${next}.`
}

/**
 * Words how a failed first setup's rollback ended as one clause; used by {@link takeOutUnrecordedEntry} and {@link finishCutShortSetup}.
 * A by-hand removal is asked for only when the entry was confirmed as Codebook's own and could not be taken out.
 * @param outcome - The {@link RollbackResult} outcome.
 * @param context - The run; its config path and the rollback journal's path beside its record ({@link rollbackContextOf}) are named for `journal-taken`.
 * @returns A clause that follows a comma and states what Codebook did with the file and what the learner should check.
 * @example
 * rollbackOutcomeClause('took-out', context) // => 'so it took that entry out again and changed nothing else'
 */
function rollbackOutcomeClause(
  outcome: RollbackResult['outcome'],
  context: Context,
): string {
  const { path } = context
  const journal = rollbackContextOf(context).pendingPath
  return {
    'took-out': 'so it took that entry out again and changed nothing else',
    'unverified-config':
      'and could not verify that the config stayed unchanged, so it kept the file and its recovery record',
    'edited-config': `but the file at that path was edited in place, so it left that file unchanged; ${KEEP_ENTRY_ADVICE}`,
    'replaced-config': `but the file at that path was saved again since, so it left that file unchanged; check that the "${SERVER_NAME}" entry in it is what you want`,
    'not-ours': `and that file is gone or its "${SERVER_NAME}" entry is no longer the one Codebook wrote, so it left that file unchanged; check that entry yourself before you remove it`,
    unreadable: `and could not read that file again, so it left it unchanged; check that its "${SERVER_NAME}" entry is what you want before you change it`,
    'not-taken-out': `and could not take that entry out again, so remove the "${SERVER_NAME}" entry from that file by hand if it is still there`,
    'journal-taken': `but something already stands at ${journal}, the name Codebook's take-back writes first (a backup or sync tool may have put an older file there), and Codebook never writes over it, so it left ${path} unchanged; the next run reads ${journal} before it takes the entry out (if what stands there is not Codebook's for ${path}, move it to another folder first)`,
    'took-out-record-taken': `so it took that entry out again and changed nothing else, but then found another file at ${journal}, where it keeps the record of that take-back (a backup or sync tool may have put an older file there), so it left that file as it is and went no further; the next run reads ${journal} first (if what stands there is not Codebook's for ${path}, move it to another folder first)`,
    'took-out-record-unread': `so it took that entry out again and changed nothing else, but then could not read ${journal} again, where it keeps the record of that take-back, to check that it still holds that record, so it left that name as it is and went no further; make that file readable by you if it is not, and the next run reads ${journal} first`,
    'record-changed': `and then found its record of this setup at ${context.pendingPath} changed or moved away, or could not read it again (a backup or sync tool may have put an older one back or be moving it), so it left ${path} unchanged and that name as it is and went no further; check that the "${SERVER_NAME}" entry in ${path} is what you want before you change it, and the next run reads ${context.pendingPath} first`,
  }[outcome]
}

/**
 * Takes out the entry a first setup just published when its receipt could not be written, so no entry stays that no record owns; called by {@link publishEntry}.
 * Only the file of this write is edited: the config is read again, its inode must still be the one published, and the entry must still hash like the receipt that was about to be written ({@link ownsEntry}); every other server and key stays. The setup's pending record stays until the rollback is complete and no copy remains, because it is the only proof that the entry is Codebook's and the only record of a displaced copy, and for good while the old record's private name stayed after the link (`isRetiredKept`), because it is the only way to that name; it then goes only as the take-back mark this call wrote, while its name still shows that mark ({@link MarkedTakeBack.markVersion}); the setup's own record stays when its mark could not be written (the next run takes that setup back, {@link isTakeBackOwed}).
 * The take-back rests on the setup's record exactly as this run last wrote it ({@link markBeforeTakeBack}): when another program changed, moved away or made unreadable that record before the mark read it or while the mark was written, or changed or moved away the mark (or, after a mark that could not be written, that record) before the take-back's last look right before the config moves ({@link assertTakeBackRecordStill}), the config stays as it is, and so does what stands at that name (`record-changed`); a record put back as this run wrote it after the mark found it gone or changed does not undo that. Limit: a record moved or replaced after that last look, while the config moves, is not seen before the config changed (the stated limit of {@link assertTakeBackRecordStill}); it stays, since the mark goes only while its name still shows it.
 * A copy of the previous config is worded as one a later run deletes ({@link KeptFile.isLeftover}) whenever the record on disk still lets the next run delete it: always once {@link publishEntry} marked it so, except after a rollback that took the entry out (also one that then found another file at its own record's name, `took-out-record-taken`, or could not read that name again, `took-out-record-unread`), which replaced the published file, so the next run hands that copy over instead ({@link keepOriginalUnlessPublished}). Another config found at the config path proves no such thing: the published file may still have another name, and a sync tool that puts it back before the next run lets that run delete the copy.
 * @param context - The run.
 * @param written - The receipt that could not be written, of this write's generation.
 * @param cause - The failure of the receipt write, kept for diagnosis.
 * @param copies - The copies the publish left, as reported and as the record on disk still tracks them ({@link LeftCopies}); one that stays is named in the error.
 * @param published - The staged digest and whether the old record's private name stayed after the link ({@link Published.isRetiredKept}): the record is then the only way to that name, so it stays after the rollback too, as after a publish whose receipt was written, and the next run settles that name ({@link settleRetiredReceipt}); when that name showed another file, the publish's completed record already carries the shape older builds refuse ({@link LinkedRecord}), and the take-back mark keeps it ({@link writeTakeBackMark}). Limit: when that completed record could not be written either, the record on disk is the one written before the link.
 * @param publishedLook - The original config check, including when the receipt write itself failed.
 * @returns The error to reject with: whether the entry was taken out again, and the way out that fits why the receipt could not be written ({@link receiptFailureEnding}), followed by the refusal of Codebook's own step at the setup record's dropping name when the take-back mark stopped there ({@link unrecordedEntrySentences}).
 */
async function takeOutUnrecordedEntry(
  context: Context,
  written: Receipt,
  cause: unknown,
  { asLeft, asTracked }: LeftCopies,
  { isRetiredKept, stagedSha256 }: Published,
  publishedLook?: StillLook,
): Promise<Error> {
  const recordChanged: RollbackResult = {
    outcome: 'record-changed',
    keptLeft: [],
  }
  // The intent comes first: a failure inside the rollback (a full disk fails its journal too) must never let a later run adopt this entry.
  const { run, markVersion, droppingConflict } =
    await markBeforeTakeBack(context)
  let result = recordChanged
  // No run: the setup's record changed, moved away or could not be read again as the mark read or wrote it, so the config is never changed on this run's word alone.
  if (run)
    result = await rollBackPublishedEntry(
      run,
      written,
      stagedSha256,
      publishedLook,
    ).catch((error: unknown): RollbackResult =>
      // The setup's record no longer stood right before the config would move, so nothing moved; any other failure leaves the rejection below saying the entry may still stand.
      error instanceof RecordConflictError
        ? recordChanged
        : { outcome: 'not-taken-out', keptLeft: [] },
    )
  const { outcome } = result
  // The rollback replaced the published file, so the next run hands an untracked copy over instead of deleting it, also when it then found another file at its own record's name or could not read that name again; another file found at the config path may still give way to the published one before then.
  const isHandedNext =
    outcome === 'took-out' ||
    outcome === 'took-out-record-taken' ||
    outcome === 'took-out-record-unread'
  const keptCopies = [
    ...(isHandedNext ? asLeft : asTracked),
    ...result.keptLeft,
  ]
  // Nothing stays that the setup's record must prove: after a complete rollback with no copy left and no old record's private name it leads to, only the mark this call wrote goes, while that name still shows it ({@link dropTrackedJournal}); a record another program put there meanwhile stays.
  if (
    outcome === 'took-out' &&
    keptCopies.length === 0 &&
    !isRetiredKept &&
    markVersion !== undefined
  )
    await dropPending({
      ...context,
      journalVersion: { current: markVersion, refusesEmptyName: true },
    })
  return new Error(
    `${unrecordedEntrySentences(context, outcome, cause, droppingConflict)}${keptCopiesSentence(keptCopies)}`,
    { cause },
  )
}

/**
 * Words a failed first setup's refusal once its take-back went as far as it could; called by {@link takeOutUnrecordedEntry}.
 * What happened to the entry comes first ({@link rollbackOutcomeClause}), then the way out that fits why the receipt could not be written ({@link receiptFailureEnding}); a take-back mark that stopped at Codebook's own step at the setup record's dropping name changed nothing, and that refusal's own sentence, which names where the record stands, follows last.
 * @param context - The run; its paths and retry are named.
 * @param outcome - How the take-back went ({@link RollbackResult}); `record-changed` when the mark stopped it.
 * @param cause - Why the receipt could not be written.
 * @param droppingConflict - The refusal the take-back mark stopped at ({@link MarkedTakeBack.droppingConflict}); undefined otherwise.
 * @returns The refusal's sentences, without the sentence that names the copies that stay.
 * @example
 * unrecordedEntrySentences(context, 'took-out', noSpaceLeft, undefined) // => 'Codebook added its entry … but could not write its own record of it, so it took that entry out again and changed nothing else; make room for that record, then run Codebook: Set Up AI Chat again.'
 */
function unrecordedEntrySentences(
  context: Context,
  outcome: RollbackResult['outcome'],
  cause: unknown,
  droppingConflict: DroppingNameConflictError | undefined,
): string {
  const { path, pendingPath } = context
  // The mark stopped at Codebook's own dropping-name step: the config stays, and that refusal says where the record stands.
  const sentence = droppingConflict
    ? `and then could not finish marking its record of this setup at ${pendingPath} for its take-back, so it left ${path} unchanged and went no further; check that the "${SERVER_NAME}" entry in ${path} is what you want before you change it`
    : rollbackOutcomeClause(outcome, context)
  const droppingSentence = droppingConflict
    ? ` ${droppingConflict.message}`
    : ''
  return `Codebook added its entry to Devin Desktop's MCP config at ${path} but could not write its own record of it, ${sentence}${receiptFailureEnding(context, cause)}${droppingSentence}`
}

/** The codes of a write refused because the storage has no room left: a full disk (`ENOSPC`) or a full quota (`EDQUOT`), the only failures {@link receiptFailureEnding} asks the learner to make room for. */
const FULL_DISK_CODES: ReadonlySet<unknown> = new Set(['ENOSPC', 'EDQUOT'])

/**
 * Ends a failed first setup's refusal with the way out that fits why its receipt could not be written; called by {@link unrecordedEntrySentences}.
 * @param context - The run; its retry ends the sentence.
 * @param cause - Why the receipt write failed.
 * @returns
 * - `; make room for that record, <retry>.` for a full disk or quota ({@link FULL_DISK_CODES})
 * - `. ` and the receipt conflict's own sentence ({@link ReceiptConflictError}), which names `receipt.json`, says that what stands there stays, and gives its own way out
 * - `; <retry>.` for any other failure, a clause of its own so the retry never reads as part of what Codebook did
 * @example
 * receiptFailureEnding(context, noSpaceLeft) // => '; make room for that record, then run Codebook: Set Up AI Chat again.'
 * receiptFailureEnding(context, receiptConflictError(context, 'changed')) // => '. Codebook found a file at …/receipt.json, … and that run reads that file first.'
 */
function receiptFailureEnding({ retry }: Context, cause: unknown): string {
  if (FULL_DISK_CODES.has(codeOf(cause)))
    return `; make room for that record, ${retry}.`
  // A file at receipt.json, or a name that could not be read again: that refusal names the file it left and its own way out.
  if (cause instanceof ReceiptConflictError) return `. ${cause.message}`
  return `; ${retry}.`
}

/** How a failed first setup's take-back goes on after its mark ({@link markBeforeTakeBack}): the run its rollback takes the entry out with, none when the take-back stops before it changes the config, the version of the mark this call wrote, the only record {@link takeOutUnrecordedEntry} may delete after a complete rollback, and, when the mark stopped at Codebook's own step at the record's dropping name, that refusal, whose own sentence the notice keeps. */
type MarkedTakeBack = {
  run?: Context
  markVersion?: RecordVersion
  droppingConflict?: DroppingNameConflictError
}

/**
 * Writes a failed first setup's take-back mark over the setup record exactly as this run last wrote it ({@link writeTakeBackMark}) and decides what its take-back rests on; called by {@link takeOutUnrecordedEntry} before its rollback, so the entry is never taken out on the run's word alone once the setup record that proves it is this setup's changed, moved away or could not be read again.
 * The read decides at once: a name found empty, another inode or other bytes (an older copy of this setup's record, another setup's record, a record that carries the mark already, which this run never wrote) or a read that fails is a change another program made, so nothing is marked and the take-back stops, even when that record is back as this run wrote it before a later look. Only a mark that could not be written over the record this read verified (a full disk) lets the take-back go on unmarked, guarded by the take-back's last look.
 * @param context - The run; it tracks the version of `pending.json` it last wrote ({@link ownRecordContext}).
 * @returns
 * - the run tracking the mark, refusing an empty name, and the version of that mark once this call wrote it, so the take-back moves the config only while that mark still stands ({@link Context.takeBackRecordRun}, {@link assertTakeBackRecordStill})
 * - no run when the read found the record gone, changed or unreadable, or the mark's write found it so ({@link JournalConflictError}): the take-back stops before it changes the config, and that name stays as it is; with that refusal as `droppingConflict` when the mark's write stopped at Codebook's own step at the record's dropping name ({@link DroppingNameConflictError}), whose sentence names where the record stands
 * - otherwise, after a mark's write that failed (for example on a full disk), the run tracking the record this run last wrote, refusing an empty name, so the take-back moves the config only while that record still stands
 * @example
 * await markBeforeTakeBack(context) // => { run: { ...context, journalVersion: { current: { ino: 43n, sha256: 'cd…' }, refusesEmptyName: true } }, markVersion: { ino: 43n, sha256: 'cd…' } }; pending.json now holds takeBack: true
 * await markBeforeTakeBack(context) // => {} once a sync tool moved pending.json away before the mark read it, also when it brings that record back later
 */
async function markBeforeTakeBack(context: Context): Promise<MarkedTakeBack> {
  const lastWritten = context.journalVersion?.current
  const read = await readVersionedRecord(
    context.pendingPath,
    pendingSchema,
    context.retry,
    context.seam,
  ).catch(() => undefined)
  // An empty name, a read that failed (even once) or another inode or other bytes than this run last wrote there: another program changed that record, so nothing rests on it, whatever a later read finds.
  if (
    !read ||
    read.version.ino !== lastWritten?.ino ||
    read.version.sha256 !== lastWritten.sha256
  )
    return {}
  const runTracking = (current: RecordVersion): Context => ({
    ...context,
    journalVersion: { current, refusesEmptyName: true },
  })
  try {
    const markVersion = await writeTakeBackMark(context, read)
    return { run: runTracking(markVersion), markVersion }
  } catch (error) {
    // Codebook's own step at the record's dropping name refused: nothing is taken out, and the notice keeps that refusal's own sentence.
    if (error instanceof DroppingNameConflictError)
      return { droppingConflict: error }
    // The record changed, moved away or could not be read again under the mark's write: nothing is taken out on its word.
    if (error instanceof JournalConflictError) return {}
    // The mark could not be written over the record this read verified: the take-back still runs, but moves the config only while that record still stands.
    return { run: runTracking(read.version) }
  }
}

/**
 * Publishes the config with Codebook's entry: the pending record is written by {@link publishRoot} before the rename, the receipt after it.
 * A first setup ({@link isFirstSetup}) records its entry hash with the {@link FIRST_SETUP_HASH_PREFIX} and `firstSetup`, so no Codebook version adopts its entry before its receipt exists and this one takes it back ({@link isTakeBackOwed}); the receipt holds the plain hash.
 * An existing `codebook` entry keeps the keys Devin manages itself (`disabled`, which Customize sets when the server is toggled off, and `disabledTools`); any other added key makes the entry an edit that is never replaced.
 * @param context - The run; its entry must be set, and it tracks its own record from the version {@link inspect} left there and refuses that name once another program emptied it ({@link ownRecordContext}), so a record another program puts at `pending.json` meanwhile is neither written over nor deleted, and a record moved away is never written back unseen, up to the limit of the last look before a rename or unlink ({@link writeTrackedJournal}, {@link dropTrackedJournal}).
 * @param look - What the config looked like.
 * @param receipt - The receipt that stands, if any; decides whether the file is still Codebook's own ({@link createdFileFor}).
 * @returns The generation recorded in the receipt, a fresh random id, and the sentence for a kept copy that could not be deleted (and, when another program kept the completed record from being written, the sentence that says so); an empty generation when the run has no entry.
 * @throws The {@link otherConfigReceiptRefusal} before anything is published while `receipt.json` holds Codebook's record of the entry in another config ({@link assertNoOtherConfigReceipt}). A {@link refusal} when the file changed before the rename or holds a number that would not survive; no record stays when nothing was published. A {@link staleReceiptRefusal} or {@link changedRecordRefusal} when a first setup cannot move the receipt of an entry that is gone aside right before its link; nothing is published then. A refusal before that link leaves that receipt as it was, and a link that fails puts it back; when it cannot go back, the refusal names where it is and the publish record stays, so the next run puts it back ({@link settleRetiredReceipt}). When the receipt of a first setup cannot be written after the entry was published, the entry is taken out again ({@link takeOutUnrecordedEntry}) and the call rejects. A {@link JournalConflictError} when the first write of its own record finds another file at `pending.json`, or not the version {@link inspect} left there ({@link writeRecord}): that file stays and nothing is published. A {@link PublishUncoveredError} when the config is no longer the file this setup published with its entry before its receipt can be written ({@link settlePublishedConfig}, {@link settleRecordConflict}): no receipt is written, and that record, the config and the copies stay.
 * @example
 * const published = await publishEntry(context, look, receipt)
 */
async function publishEntry(
  context: Context,
  look: ConfigLook,
  receipt: Receipt | undefined,
): Promise<PublishedEntry> {
  const { entry, entryHash } = context
  if (!entry || !entryHash) return { generation: '' }
  // A record of another config's entry at receipt.json is never written over: nothing is published.
  assertNoOtherConfigReceipt(context)
  assertRewritable(context, look)
  assertSingleLink(context, look)
  const isFirst = isFirstSetup(look, receipt)
  const createdFile = createdFileFor(look, receipt)
  const generation = randomUUID()
  // A first setup starts a new installation, an update carries the receipt's over.
  const installationId = installationIdOf(isFirst ? undefined : receipt)
  const root = rootWithEntry(look, entry)
  await context.seam?.afterRead?.()
  const published = await publishRoot(
    context,
    root,
    look,
    {
      // A first setup's record carries the prefix so no older build adopts its entry; its receipt below keeps the plain hash.
      entrySha256: isFirst
        ? `${FIRST_SETUP_HASH_PREFIX}${entryHash}`
        : entryHash,
      createdFile,
      generation,
      installationId,
      // A first setup is adoptable only once its receipt is written ({@link isTakeBackOwed}).
      ...(isFirst && { firstSetup: true }),
    },
    // The receipt of an entry that is gone goes right before the link, so no reader can take this publish for that receipt's, and it stays when the publish refuses before then.
    isFirst ? receipt : undefined,
  )
  const written: Receipt = {
    schemaVersion: 1,
    targetPath: context.path,
    entrySha256: entryHash,
    createdFile,
    installed: true,
    generation,
    installationId,
    config: published.config,
  }
  return recordPublishedEntry(context, written, published, isFirst)
}

/**
 * Writes the receipt of a publish and words what the publish left; the last steps of {@link publishEntry}, once the config stands.
 * A first setup never leaves an entry without a receipt: when that receipt cannot be written, or `receipt.json` no longer shows it once its write's awaited cleanup of the staged name ended ({@link publishedReceiptCheck}), its entry is taken out again ({@link takeOutUnrecordedEntry}); an update keeps its own record of the change and what stands at `receipt.json` (the old receipt while nothing was written there), and rejects. When another program kept the completed record from being written ({@link Published.recordConflict}), the receipt is written only while the config is still the file this setup published with its entry, and the copies are worded as the record that stands leaves them ({@link settleRecordConflict}). Once the receipt stands, a delete of the setup's own record that Codebook's own step at the record's dropping name refuses ({@link DroppingNameConflictError}) is no failure of that receipt: the entry stays, and the success says where the record stands in that refusal's own words, because both names stay and the next run stops at them; any other conflict of that delete leaves a stale record the next run reads first, as before.
 * A first setup checks the config and receipt again after retiring its setup record. A change then refuses success and leaves the current files alone. When retirement itself met a dropping-name conflict, its recovery directions accompany the refusal.
 * @param context - The run.
 * @param written - The receipt this publish writes.
 * @param published - What the publish reported ({@link Published}).
 * @param isFirst - Whether the publish is a first setup ({@link isFirstSetup}).
 * @returns The generation recorded in the receipt and, when something stays, the sentences that name it.
 * @throws The {@link PublishUncoveredError} of {@link settlePublishedConfig} or {@link settleRecordConflict}; the take-out's refusal for a first setup whose receipt could not be written or no longer stands; for an update, the receipt write's failure, or the {@link receiptConflictError} when `receipt.json` no longer shows the receipt that write published once its cleanup ended (the file there and the update's own record stay).
 * @example
 * await recordPublishedEntry(context, written, published, true) // => { generation: written.generation }
 * await recordPublishedEntry(context, written, published, false) // throws the `changed` receipt conflict, keeping pending.json, once a backup put another record at receipt.json while the write deleted its staged name
 */
async function recordPublishedEntry(
  context: Context,
  written: Receipt,
  published: Published,
  isFirst: boolean,
): Promise<PublishedEntry> {
  const { keptLeft, isRetiredKept, recordConflict } = published
  // Success is recorded only on the config's own word. Another program's file at the record's name, an emptied name or a failed read also decides the copies as the record that stands leaves them.
  const settled: ReceiptWriteSettlement = recordConflict
    ? await settleRecordConflict(context, written, keptLeft, recordConflict)
    : await settlePublishedConfig(context, written, published)
  // Codebook's own step at the record's dropping name can refuse the delete of this setup's record after the receipt stands: both names then stay and the next run stops at them, so the success names them in that refusal's own words instead of reporting nothing.
  let droppingConflict: DroppingNameConflictError | undefined
  let receiptWasWritten = false
  try {
    await writeReceipt(context, written, settled.configStill)
    receiptWasWritten = true
    // A first setup can report installation only while the config still holds the entry it published and the receipt still records it.
    const assertPublished = bothLooks(
      await publishedReceiptCheck(context, receiptConflictError),
      isFirst ? settled.configStill : undefined,
    )
    await lookAndAssertStill(assertPublished)
    // Keep records that name retained copies; otherwise check the same evidence throughout retirement.
    if (keptLeft.length === 0 && !isRetiredKept) {
      droppingConflict = await dropPublishedSetupRecord(
        context,
        assertPublished,
      )
      // Dropping even a successfully retired record awaits note cleanup. Both published files must still stand after it.
      if (isFirst) await lookAndAssertStill(assertPublished)
    }
  } catch (cause) {
    // An update keeps its own record of the change. Only a first setup considers taking its entry back.
    if (!isFirst) throw cause
    const refusal = receiptWasWritten
      ? firstSetupProofFailure(
          context,
          cause,
          settled.copies.asTracked,
          droppingConflict ?? recordConflict,
        )
      : undefined
    if (refusal) throw refusal
    throw await takeOutUnrecordedEntry(
      context,
      written,
      cause,
      settled.copies,
      published,
      settled.configStill,
    )
  }
  return publishedEntryResult(written.generation, settled, droppingConflict)
}

/**
 * Builds the installed result and names any recovery files that survived publication.
 * @example
 * publishedEntryResult(generation, settled, undefined)
 */
function publishedEntryResult(
  generation: string,
  settled: ReceiptWriteSettlement,
  droppingConflict: DroppingNameConflictError | undefined,
): PublishedEntry {
  const cleanupFailure = [
    cleanupFailureOf(settled.copies.asTracked),
    settled.sentence,
    droppingConflict &&
      `Codebook wrote its record of the entry but could not finish deleting its record of this setup. ${droppingConflict.message}`,
  ]
    .filter(Boolean)
    .join(' ')
  return cleanupFailure ? { generation, cleanupFailure } : { generation }
}

/**
 * Retires the setup record once the receipt stands. A conflict at its two recovery names carries directions the final notice needs.
 * @example
 * const conflict = await dropPublishedSetupRecord(context, assertPublished)
 */
async function dropPublishedSetupRecord(
  context: Context,
  assertPublished: StillLook | undefined,
): Promise<DroppingNameConflictError | undefined> {
  try {
    await dropPending(context, {
      assertStill: assertPublished,
      onConflict: 'throw',
    })
  } catch (error) {
    if (error instanceof DroppingNameConflictError) return error
    // Ordinary journal conflicts leave a stale record for the next run. A failed config or receipt proof still refuses setup.
    if (!(error instanceof JournalConflictError)) throw error
  }
  return undefined
}

/**
 * Describes a failed first setup whose receipt was published but whose final evidence changed.
 * Called by {@link recordPublishedEntry} before considering a rollback on a surviving setup record.
 * @param copies - Recovery copies still named by the publication.
 * @param recordConflict - Any earlier conflict during retirement or publication of the recovery record.
 * @returns The refusal when the files must be left alone; otherwise the setup's existing take-back handles the failure.
 * @example
 * firstSetupProofFailure(context, receiptConflictError(context, 'gone'), [], undefined)
 */
function firstSetupProofFailure(
  context: Context,
  cause: unknown,
  copies: KeptFile[],
  recordConflict: JournalConflictError | undefined,
): Error | undefined {
  // A failed put-back carries the two recovery names on the proof error itself.
  const conflict = [recordConflict, cause instanceof Error && cause.cause].find(
    (error): error is DroppingNameConflictError =>
      error instanceof DroppingNameConflictError,
  )
  if (cause instanceof PublishUncoveredError)
    return new Error(
      changedWhileWorking(context).message +
        keptCopiesSentence(copies) +
        (conflict ? ` ${conflict.message}` : ''),
      { cause },
    )
  if (!(cause instanceof ReceiptConflictError)) return undefined
  // A stranded journal cannot authorize a take-back. Both failures have independent recovery steps.
  if (conflict)
    return new Error(
      `${cause.message}${keptCopiesSentence(copies)} ${conflict.message}`,
      { cause },
    )
  if (context.journalVersion?.current) return undefined
  const folder = receiptFolderRefusal(context, cause)
  if (folder) return folder
  return new Error(
    `Codebook could no longer verify its receipt at ${context.receiptPath} for the entry it wrote in Devin Desktop's MCP config at ${context.path}. It left the current files untouched. Check both locations and keep any different receipt separately. Restore the matching receipt from backup or, if you have no backup, ${KEEP_ENTRY_ADVICE} in ${context.path}, ${context.retry}.`,
    { cause },
  )
}

/**
 * Words the copies a publish left when its completed record was either written or kept from being written by a full disk; called by {@link recordPublishedEntry}.
 * @param published - What the publish reported.
 * @returns The {@link LeftCopies}: without the completed record, the record written before the move-aside still lets the next run delete a copy of the previous config ({@link stillTracked}).
 * @example
 * leftCopiesOf({ ...published, isRecorded: false }).asTracked // => [{ path, holds: 'previous', isLeftover: true }]
 */
function leftCopiesOf({ keptLeft, isRecorded }: Published): LeftCopies {
  return {
    asLeft: keptLeft,
    asTracked: isRecorded ? keptLeft : keptLeft.map(stillTracked),
  }
}

/** Thrown when the config is no longer the file a setup published with its entry before that entry's receipt can be written: the setup writes no receipt and takes nothing out of that file. An update rejects with it as it is; a first setup answers through its take-back ({@link takeOutUnrecordedEntry}). */
class PublishUncoveredError extends Error {}

/** What a publish goes on with once its config is confirmed as the file it wrote: the copies as the record that stands leaves them, the sentence that says what happened to that record, and the look at the config the receipt's write must still pass right before its rename. */
type ReceiptWriteSettlement = {
  copies: LeftCopies
  sentence?: string
  configStill?: StillLook
}

/** Words a {@link PublishUncoveredError} for the state the published config was found in. */
type UncoveredWording = (configState: string) => PublishUncoveredError

/**
 * Confirms that the config still is the file a setup published with its entry, and gives the synchronous look the receipt's write passes right before its rename; called by {@link settlePublishedConfig} and {@link settleRecordConflict}.
 * @param context - The run.
 * @param written - The receipt this setup writes; its `config.ino` is the file it published, its entry hash the entry it wrote.
 * @param uncovered - Words the refusal for the state the config is found in, or for a change before the receipt's rename.
 * @returns The look at the config ({@link StillLook}).
 * @throws The {@link PublishUncoveredError} `uncovered` words when the config is gone, no longer holds this setup's entry, has another inode or cannot be read again; the returned look throws it too once the config name changes before the receipt's rename.
 * @example
 * await publishedConfigStill(context, written, uncovered) // => { names: [configPath], assert }
 */
async function publishedConfigStill(
  context: Context,
  written: Receipt,
  uncovered: UncoveredWording,
): Promise<StillLook> {
  const notWritten = 'that config is no longer the file it wrote'
  const confirmed = await confirmPublishedConfig(context, written)
  // A config that could not be read again is never said to be another file.
  if (!('look' in confirmed))
    throw uncovered(
      confirmed.outcome === 'unreadable'
        ? 'it could not read that config again'
        : notWritten,
    )
  const { identity } = confirmed.look
  return {
    names: [context.path],
    assert: (): void => {
      // A look that fails proves nothing: the config counts as changed.
      if (!isConfigStill(context, identity)) throw uncovered(notWritten)
    },
  }
}

/**
 * Confirms a publish whose completed record was written before its entry is recorded, so a backup that put another config back after the publish never receives an installed receipt; called by {@link recordPublishedEntry} when the completed record met no conflict.
 * The record stays: it is the proof of how far this setup went, as after a stop between the publish and the receipt write, and the next run reads it first. A copy the publish left is named in the refusal as that record tracks it.
 * @param context - The run.
 * @param written - The receipt this setup writes.
 * @param published - What the publish reported.
 * @returns The copies and the look at the config ({@link ReceiptWriteSettlement}); when the config already fails the confirmation, that look throws the {@link PublishUncoveredError} inside the receipt write, so a conflict at `receipt.json` is still read first and a first setup takes its entry back as for every receipt-write failure.
 * @example
 * await settlePublishedConfig(context, written, published) // => { copies, configStill }
 */
async function settlePublishedConfig(
  context: Context,
  written: Receipt,
  published: Published,
): Promise<ReceiptWriteSettlement> {
  const { path, pendingPath, retry } = context
  const copies = leftCopiesOf(published)
  const uncovered = (configState: string): PublishUncoveredError =>
    new PublishUncoveredError(
      `Codebook put its entry in Devin Desktop's MCP config at ${path}, but before it could write its own record of that entry, ${configState}, so it wrote no record of that entry, left that config and that record as they are and went no further; check that the "${SERVER_NAME}" entry in ${path} is what you want before you change it, ${retry}, and that run reads ${pendingPath} first.${keptCopiesSentence(copies.asTracked)}`,
    )
  const confirmed = await publishedConfigStill(
    context,
    written,
    uncovered,
  ).catch((error: unknown) => {
    // A config that already fails the confirmation fails the receipt write's synchronous look instead, so a conflict at receipt.json is still read and worded first and a first setup's take-back runs as for every receipt-write failure.
    if (!(error instanceof PublishUncoveredError)) throw error
    return {
      names: [path],
      assert: (): void => {
        throw error
      },
    }
  })
  return { copies, configStill: confirmed }
}

/**
 * Decides whether a setup whose completed record another program kept from being written ({@link Published.recordConflict}) may still record its entry, and words its copies as the record that stands leaves them; called by {@link recordPublishedEntry} before the receipt is written.
 * The config is read again ({@link confirmPublishedConfig}): only while it is the file this setup published with its entry is the receipt written, and the config name is looked at once more, synchronously, right before the receipt's rename. Otherwise nothing is recorded: a backup that put an older config back together with an older record leaves both as they are, and the run says so. The record that stands is read once more ({@link recordedCopyFateOf}), so a copy is left to the learner only when that record's contents show it does not lead a later run to the copy.
 * @param context - The run.
 * @param written - The receipt this setup writes.
 * @param keptLeft - The files the publish left.
 * @param conflict - What stood at the record's name; Codebook's own dropping-name refusal ({@link DroppingNameConflictError}) is said in its own sentence, which names where the record stands, never as another program's change.
 * @returns The copies, the sentence for the notice and the look at the config ({@link ReceiptWriteSettlement}).
 * @throws A {@link PublishUncoveredError} naming the record, the config and the copies when the config is gone, no longer holds this setup's entry, has another inode or cannot be read again (said as such); the returned look throws it too once the config name changes before the receipt's rename.
 * @example
 * await settleRecordConflict(context, written, keptLeft, journalConflictError(context, 'changed')) // => { copies, sentence: 'Codebook wrote its record of the entry but could not record that this setup finished, …', configStill }
 * await settleRecordConflict(context, written, keptLeft, bothRecordNamesError(context))           // => { copies, sentence: 'Codebook wrote its record of the entry but could not finish rewriting its record of this setup. Codebook found its record at …', configStill }
 */
async function settleRecordConflict(
  context: Context,
  written: Receipt,
  keptLeft: KeptFile[],
  conflict: JournalConflictError,
): Promise<ReceiptWriteSettlement> {
  const { path, pendingPath, retry } = context
  // Codebook's own step at the record's dropping name says where that record stands and its way out in its own sentence; another program's change is a cause.
  const isOwnDrop = conflict instanceof DroppingNameConflictError
  const happened = isOwnDrop
    ? 'could not finish rewriting its record of this setup'
    : `could not record that this setup finished, because ${recordConflictCause(context, conflict.kind)}`
  const recordEnd = isOwnDrop
    ? `. ${conflict.message}`
    : `, ${retry}, and that run reads ${pendingPath} first.`
  const copies = await copiesBesideRecord(context, keptLeft)
  const uncovered = (configState: string): PublishUncoveredError =>
    new PublishUncoveredError(
      `Codebook put its entry in Devin Desktop's MCP config at ${path}, but ${happened}, and ${configState}, so it wrote no record of that entry, left that config and that record as they are and went no further; check that the "${SERVER_NAME}" entry in ${path} is what you want before you change it${recordEnd}${keptCopiesSentence(copies.asTracked)}`,
    )
  return {
    copies,
    sentence: isOwnDrop
      ? `Codebook wrote its record of the entry but ${happened}. ${conflict.message}`
      : `Codebook wrote its record of the entry but ${happened}, so it left that name as it is; the next run reads that name first.`,
    configStill: await publishedConfigStill(context, written, uncovered),
  }
}

/**
 * Words what another program did to a setup's or a removal's record of its change as it was to be recorded as completed ({@link Published.recordConflict}); used by {@link settleRecordConflict} and, for a removal, by {@link unrecordedRemovalWording}.
 * @param context - The run; its pending path is named.
 * @param conflict - What stood at the record's name.
 * @param record - How the clause names that record: a setup's own words by default, `that record` after a removal's sentence that already named it.
 * @returns A clause that follows "because".
 * @example
 * recordConflictCause(context, 'unread') // => 'it could not read its record of this setup at …/pending.json again'
 * recordConflictCause(context, 'changed', 'that record') // => 'another program changed or replaced that record at …/pending.json (…)'
 */
function recordConflictCause(
  { pendingPath }: Context,
  conflict: JournalConflictError['kind'],
  record = 'its record of this setup',
): string {
  return {
    changed: `another program changed or replaced ${record} at ${pendingPath} (a backup or sync tool may have put an older one back)`,
    gone: `another program moved ${record} at ${pendingPath} away (a backup or sync tool may be moving it)`,
    unread: `it could not read ${record} at ${pendingPath} again`,
  }[conflict]
}

/**
 * Words the copies a publish left as the record that stands at `pending.json` leaves them, once another program kept the completed record from being written; called by {@link settleRecordConflict}.
 * @param context - The run.
 * @param keptLeft - The files the publish left.
 * @returns The {@link LeftCopies}: `asTracked` marks a copy of the previous config {@link KeptFile.isLeftover} while that record still names it and {@link KeptFile.isUnconfirmed} while that record cannot be read back ({@link recordedCopyFateOf}); `asLeft`, for the notice after a rollback that took the entry out (the next run then hands a named copy over, {@link keepOriginalUnlessPublished}), keeps only the second mark.
 * @example
 * await copiesBesideRecord(context, [{ path: copyPath, holds: 'previous' }]) // => { asLeft: [{ path: copyPath, holds: 'previous' }], asTracked: [{ path: copyPath, holds: 'previous', isLeftover: true }] } while the record names that copy
 */
async function copiesBesideRecord(
  context: Context,
  keptLeft: KeptFile[],
): Promise<LeftCopies> {
  const previous = keptLeft.find(({ holds }) => holds === 'previous')
  const fate = previous
    ? await recordedCopyFateOf(context, previous.path)
    : 'untracked'
  const asTracked = keptLeft.map((kept): KeptFile => {
    // Only a copy of the previous config has a fate; the staged copy of the new config is named as it is.
    if (kept.holds !== 'previous' || fate === 'untracked') return kept
    return fate === 'tracked'
      ? stillTracked(kept)
      : { ...kept, isUnconfirmed: true }
  })
  // After a rollback that took the entry out, the next run hands a copy the record names over instead of deleting it; one whose record could not be read back stays unconfirmed.
  return { asLeft: fate === 'tracked' ? keptLeft : asTracked, asTracked }
}

/** What the record that stands does with a kept copy of the previous config ({@link recordedCopyFateOf}): `tracked` while it lets a later run delete the copy, `untracked` once it no longer leads a later run there, `unconfirmed` when it could not be read back. */
type RecordedCopyFate = 'tracked' | 'untracked' | 'unconfirmed'

/**
 * Tells what the record that stands at `pending.json` (or, for a rollback's recovery, at its journal's name, {@link rollbackContextOf}) does with a kept copy of the previous config, read back after Codebook's own write of it failed or was refused, or after a look at it stopped recovery; called by {@link copiesBesideRecord}, {@link unrecordedRemovalRefusal} and {@link unsettledOf}, because another program may have replaced, removed or restored that record, and only a record of this config that recovery deletes from ({@link recoverOwnLeftovers}, {@link tidyLeftover}) and that names the copy lets a later run delete it.
 * @param context - The run; gives the pending record's path and the config path.
 * @param copyPath - The copy's private name.
 * @returns
 * - `tracked` when the record reads back as one of this config that names that copy by the name of its own generation, as recovery accepts it ({@link acceptedLeftover}), and is not handed over as recovery reads it ({@link leftoverPhaseOf})
 * - `untracked` when it reads back as a record that does not lead a later run to the copy: one of another config, one that hands the copy over, one that names another copy or none, or one that names the copy while it holds another generation or none, which recovery refuses without touching the copy
 * - `unconfirmed` when nothing stands there or it cannot be read as a record (a folder, a link, a read that failed), so the record may still come back and lead there
 * @example
 * await recordedCopyFateOf(context, copyPath) // => 'unconfirmed' once another program put a folder where pending.json was
 * await recordedCopyFateOf(context, copyPath) // => 'untracked' once a backup put back a handed record that names the same copy
 */
async function recordedCopyFateOf(
  context: Context,
  copyPath: string,
): Promise<RecordedCopyFate> {
  const pending = await readRecord(
    context.pendingPath,
    pendingSchema,
    context.retry,
  ).catch(() => undefined)
  if (!pending) return 'unconfirmed'
  // Recovery settles only a record of this config, never deletes a copy its handed record holds, and refuses a record whose copy's name is not the one of its own generation ({@link acceptedLeftover}).
  return pending.targetPath === context.path &&
    leftoverPhaseOf(pending) !== 'handed' &&
    pending.keptName === basename(copyPath) &&
    pending.generation !== undefined &&
    pending.keptName === journalNameOf(context.path, pending.generation, 'kept')
    ? 'tracked'
    : 'untracked'
}

/** The copies a publish left, worded two ways ({@link publishEntry}): `asLeft` as the publish reported them, `asTracked` with every copy of the previous config that the record on disk still lets a later run delete marked {@link KeptFile.isLeftover} (or, when that record could not be read back, {@link KeptFile.isUnconfirmed}); the two differ only when the completed record could not be written. */
type LeftCopies = { asLeft: KeptFile[]; asTracked: KeptFile[] }

/**
 * Marks a kept copy of the previous config as one a record on disk still holds ({@link KeptFile.isLeftover}); used by {@link publishEntry} when the completed record could not be written, so the record written before the move-aside still names the copy and the next run deletes it while the config is the published file.
 * @param kept - A file the publish left.
 * @returns The same file, marked {@link KeptFile.isLeftover} when it holds the previous config; a staged copy of the new config is returned as it is.
 * @example
 * stillTracked({ path, holds: 'previous' }) // => { path, holds: 'previous', isLeftover: true }
 * stillTracked({ path, holds: 'new' }) // => { path, holds: 'new' }
 */
function stillTracked(kept: KeptFile): KeptFile {
  return kept.holds === 'previous' ? { ...kept, isLeftover: true } : kept
}

/** The leftovers of a pending record of this config that recovery could not settle; none for no record or a record of another config. */
async function recoverOwnLeftovers(
  context: Context,
  pending: Pending | undefined,
): Promise<Unsettled[]> {
  if (pending?.targetPath !== context.path) return []
  return recoverLeftovers(context, pending)
}

/** The `codebook` entry as parsed; undefined for an absent config or an absent entry. */
function currentEntryOf(look: ConfigLook): unknown {
  return look.kind === 'present' ? look.servers?.[SERVER_NAME] : undefined
}

/**
 * Settles the leftovers of a failed first setup's rollback before anything else reads the config; called by {@link inspect}.
 * The rollback keeps its own journal ({@link rollbackContextOf}). A process that ends after the rollback moved the config aside leaves the config name empty and the learner's other servers only under the rollback's private name, so that journal is settled first, the same way as `pending.json`'s ({@link recoverLeftovers}): the recorded original goes back to an empty config name, extra names are dropped, and anything that cannot be settled stays and is named. The journal is retired (or reduced to what stays) before `pending.json` is read, only while its name still shows the version this run settled ({@link retirePending}).
 * A recovery that a look at the journal itself stopped (the journal changed, disappeared or could not be read again, {@link recoveryConflictOf}) settles no copy after that one; the journal as recovery read it still decides the take-back mark below, because it alone may prove that an older build's unmarked setup record owes its take-back, and then the run ends, naming the copy first and the journal's conflict after it, with no journal rewritten, held or deleted.
 * A settled journal marks the setup's publish record `takeBack` ({@link markTakeBackOwed}) first, so {@link inspect} finishes the take-back instead of adopting that record, in this run or a later one; the journal then ends only while that record's name still shows the mark ({@link markLeftCheck}), so a setup record a backup puts back without it keeps the journal; a journal that marks nothing (another setup's record, or none at that name) ends only while that name still shows the record the decision read, or nothing, so the setup record a backup restores there meanwhile is decided together with the journal instead of being adopted without it. A journal of an older build names no publish, so the config its recovery put back is read for {@link legacyBelonging}; one that cannot be matched, or not yet because that config could not be read or is no valid JSON config yet, is refused before the journal is retired, and both records then stay. One decided as another publish's on that one read (`another-config`) is never deleted here: it is held ({@link holdLegacyJournal}) until the run's own look shows the same bytes and the publish record can no longer adopt ({@link settleAfterRecovery}).
 * @param context - The run.
 * @returns What it left at the journal's name ({@link SettledJournal}):
 * - `held`: the held journal of an older build that this read decided as another publish's
 * - `otherVersion`: the version of another config's journal it read and left as it is
 * - neither when it found the name empty or retired the journal here (a journal reduced to what stays always ends the run with its leftover's refusal)
 * @throws A refusal naming the first leftover that could not be settled, or what {@link recoverLeftovers} throws for a name that is not Codebook's own; nothing is created then. The {@link unmatchedJournalRefusal} for an older build's journal whose file has the published inode but other bytes, while the config holds the setup's entry and does not start with the published bytes, cannot be read or is no valid JSON config yet: no record is written or retired then. Its `record-reread`, `record-gone` or `record-unread` sentence when the publish record's name no longer shows the version the mark read, the take-back mark this run wrote or found, or what the decision read when nothing was marked, or cannot be read again then ({@link markLeftCheck}): both records stay. A {@link JournalConflictError} when the journal's name no longer shows the version this run settled or cannot be read again as recovery acts on a copy on its word (after the take-back mark), or as the journal is held or retired: that name stays as it is and the run goes no further. Either comes after the first leftover's refusal when one stays and the refusal does not name it already ({@link withJournalLeftover}).
 * @example
 * await settleRollbackJournal(context) // => { held: undefined }; the original config is back at its path when a rollback was cut short, and its journal is gone
 */
async function settleRollbackJournal(
  context: Context,
): Promise<SettledJournal> {
  const read = await readVersionedRecord(
    rollbackContextOf(context).pendingPath,
    pendingSchema,
    context.retry,
    context.seam,
  )
  // No rollback was cut short, or the journal belongs to another config, which this run does not settle: an adoption later rests on that name still showing what was read here.
  if (read?.record.targetPath !== context.path)
    return { otherVersion: read?.version }
  const { record: pending, version } = read
  // The journal this run settles is the version it read; only a journal this run writes from here on replaces it ({@link writeRecord}).
  const rollbackContext: Context = {
    ...rollbackContextOf(context),
    journalVersion: { current: version },
  }
  const unsettled = await recoverLeftovers(rollbackContext, pending)
  const isHandedNow = unsettled.some(({ isHandedOver }) => isHandedOver)
  // An unverified put-back's handed journal is read as the change in progress it is, so its displaced file stays tracked.
  const phase = leftoverPhaseOf(pending)
  // A journal of an older build names no publish: the config its recovery just put back helps tell whether it is this publish's.
  const legacy =
    pending.publishGeneration === undefined
      ? {
          journal: pending,
          restoredBytes: await restoredConfigBytes(context),
          reported: unsettled[0],
        }
      : undefined
  const [reported] = unsettled
  const decision = await markTakeBackOwed(
    context,
    rollbackContext,
    pending.publishGeneration,
    legacy,
  ).catch((error: unknown) => {
    // A mark refused for a publish record that changed meanwhile names the leftover this recovery could not settle too.
    throw withJournalLeftover(error, rollbackContext, phase, reported, legacy)
  })
  // A journal its recovery could no longer confirm ends the run once the take-back it proves as read is marked: no copy, no journal and no hold changes after that, and the next run reads that name first.
  const conflict = recoveryConflictOf(unsettled)
  if (conflict)
    throw withJournalLeftover(
      conflict.cause,
      rollbackContext,
      phase,
      conflict,
      legacy,
    )
  const retained = retainedRecord(
    await recordAfterRecovery(rollbackContext, pending, unsettled, isHandedNow),
    unsettled,
    phase,
  )
  let held: HeldJournal | undefined
  try {
    // A legacy journal decided as another publish's on one read of the config is never deleted here: the publish record must lose its ability to adopt first.
    held =
      decision?.belonging === 'another-config' && legacy?.restoredBytes
        ? await holdLegacyJournal(
            rollbackContext,
            heldJournalOf(pending, retained),
            legacy,
            legacy.restoredBytes,
            reported !== undefined,
            decision.publishVersion,
          )
        : undefined
    // A journal ends only while the publish record's name still shows what the decision left there (the mark, the record it read, or nothing), at a look right before the journal's rename or unlink.
    if (!held)
      await retirePending(
        rollbackContext,
        retained,
        await markLeftCheck(context, decision, legacy),
      )
  } catch (error) {
    // Another file at the journal's name, or a publish record that changed, ends the run here, named after the leftover this recovery could not settle.
    throw withJournalLeftover(error, rollbackContext, phase, reported, legacy)
  }
  if (reported) throw unsettledRefusal(rollbackContext, phase, reported)
  return { held }
}

/** What {@link settleRollbackJournal} left at the rollback journal's name, which the rest of {@link inspect} rests on: the legacy journal it held ({@link HeldJournal}), or the version of another config's journal it read and left there; neither when it found that name empty or retired the journal itself. An adoption publishes its receipt and ends its record only while that name still shows this ({@link journalLeftCheck}, {@link HeldJournal.lookStill}). */
type SettledJournal = {
  held?: HeldJournal
  /** The version of another config's journal settlement read and left at that name; undefined when it found the name empty, retired the journal or holds it. */
  otherVersion?: RecordVersion
}

/** A rollback journal of an older build that {@link settleRollbackJournal} decided as another publish's on one read of the restored config and of the publish record, and kept: {@link inspect} goes on only with that version of the publish record ({@link heldPublishContext}), {@link settleAfterRecovery} checks that its own look shows those config bytes ({@link assertHeldJournalStill}) and retires the journal once the publish record can no longer adopt and its name shows what the run left there, also at a look right before the journal's unlink ({@link retireHeldJournal}). */
type HeldJournal = {
  /** SHA-256 of the restored config's bytes that decided the journal. */
  restoredSha256: string
  /** The version of the publish record that decided the journal ({@link markTakeBackOwed}); a run adopts or ends only that version. */
  publishVersion: RecordVersion
  /** The journal's evidence, which the refusal of a changed config names. */
  legacy: LegacyJournalEvidence
  /** Deletes the journal, only while its name still shows the version this run settled or last wrote ({@link dropTrackedJournal}) and the given synchronous look at the publish record's name, made right after that name's last look and before the unlink, passes ({@link publishLeftCheck}); rejects with a {@link JournalConflictError} or what that look throws, and leaves the journal as it is otherwise. */
  retire: (assertPublishStill: StillLook) => Promise<void>
  /** Looks at the journal's name without holding the extension host's thread ({@link lookAtTrackedJournal}) and gives the synchronous look that must still find what it found there right before the publish record this journal rests on is deleted or rewritten ({@link settlePending}), so a journal a backup restores at that name meanwhile keeps the record it may need to take its setup back ({@link assertHeldJournalLeft}); the record's delete or rewrite looks at the journal's name through the thread pool once more right before ({@link StillLook}); rejects with a {@link JournalConflictError} when the name shows another file or cannot be read, and with a `gone` one when it is empty (another program moved the journal away, which may bring it back), before the publish record changes. */
  lookStill: () => Promise<StillLook>
}

/** A {@link JournalConflictError} at a held legacy journal's own name, met by the look right before the publish record that journal rests on ends ({@link assertHeldJournalLeft}); {@link publishRecordConflict} leaves it as the journal's own refusal instead of wording it as that record's. */
class HeldJournalConflictError extends JournalConflictError {}

/**
 * Keeps a legacy rollback journal that one read decided as another publish's, so the publish record cannot adopt on a later read once the journal is gone; called only by {@link settleRollbackJournal}.
 * When a leftover is refused in this run, the journal is rewritten to what stays with the evidence that decided it ({@link heldJournalOf}), so the next run still decides on its inode and hash; otherwise it stays as recovery left it. That rewrite and the retirement act only on the version this run settled ({@link Context.journalVersion}): the one its recovery read, or the last one this run wrote itself, never what its name shows by now, so a journal a backup restores at its name after that read stays for the next run ({@link writeRecord}, {@link dropTrackedJournal}).
 * @param rollbackContext - The rollback's context ({@link rollbackContextOf}); its pending path is the journal, and it tracks the journal's version.
 * @param kept - The journal to write when a leftover is refused.
 * @param legacy - The journal's evidence.
 * @param restoredBytes - The restored config's bytes that decided it.
 * @param isRefused - Whether a leftover of the journal is refused in this run.
 * @param publishVersion - The version of the publish record that decided it ({@link markTakeBackOwed}).
 * @returns The held journal ({@link HeldJournal}).
 * @throws What writing the journal throws, a {@link JournalConflictError} when its name no longer shows the version this run settled; the journal on disk then stays byte for byte.
 * @example
 * const held = await holdLegacyJournal(rollbackContext, legacyEvidenceOf(journal), legacy, restoredBytes, true, decision.publishVersion)
 */
async function holdLegacyJournal(
  rollbackContext: Context,
  kept: Pending,
  legacy: LegacyJournalEvidence,
  restoredBytes: Buffer,
  isRefused: boolean,
  publishVersion: RecordVersion,
): Promise<HeldJournal> {
  // A refused leftover ends this run: the journal keeps what the next run needs to decide again.
  if (isRefused)
    await writeRecord(rollbackContext, rollbackContext.pendingPath, kept)
  return {
    restoredSha256: bytesSha256(restoredBytes),
    publishVersion,
    legacy,
    // Nothing writes through this context between the hold and the retirement: the version it tracks is the one this run settled or last wrote.
    retire: (assertPublishStill): Promise<void> =>
      dropTrackedJournal(rollbackContext, assertPublishStill),
    lookStill: async (): Promise<StillLook> => {
      const look = await lookAtTrackedJournal(rollbackContext)
      // Another program moved the held journal away: the publish record it rests on stays for the run that finds the journal back.
      if (!look) throw journalConflictError(rollbackContext, 'gone')
      return {
        names: [rollbackContext.pendingPath],
        assert: (): void => assertHeldJournalLeft(rollbackContext, look),
      }
    },
  }
}

/**
 * Looks once more, synchronously, at a held legacy journal's name right before the publish record it rests on is deleted or rewritten; the look {@link HeldJournal.lookStill} gives, which {@link settleAfterRecovery} passes to {@link settlePending}.
 * Limit: a journal put at that name between this look and the record's unlink or rename, or after it, is decided without that record, like one restored after the run; a storage stall that starts between the asynchronous look and this one holds the extension host's thread until it ends.
 * @param rollbackContext - The rollback's context ({@link rollbackContextOf}); its pending path is the journal, its seam is called around the look ({@link isLeftoverStill}).
 * @param look - What the asynchronous look found there: the journal this run held (a name found empty there already ended the run, {@link HeldJournal.lookStill}).
 * @throws A {@link HeldJournalConflictError} when the name no longer shows that journal, is empty or cannot be looked at ({@link assertTrackedJournalStill}); the publish record then stays as it is.
 * @example
 * assertHeldJournalLeft(rollbackContext, look) // throws once a backup renamed another journal over pending.json.rollback
 */
function assertHeldJournalLeft(
  rollbackContext: Context,
  look: InspectedCopy,
): void {
  try {
    assertTrackedJournalStill(rollbackContext, look)
  } catch (error) {
    // A conflict here is the journal's own, never the publish record's.
    if (!(error instanceof JournalConflictError)) throw error
    throw new HeldJournalConflictError(error.message, error.kind, {
      cause: error,
    })
  }
}

/**
 * Joins two synchronous looks that must both still hold right before a record's rename or unlink ({@link retirePending}); called by {@link settlePending}, which ends the publish record only while the old receipt's private name it found empty is still empty ({@link retiredNameCheck}) and, beside a held legacy journal, while that journal's name still shows what the run held ({@link HeldJournal.lookStill}).
 * @param first - The look that runs first; undefined when there is none.
 * @param second - The look that runs right after it, closest to the rename or unlink; undefined when there is none.
 * @returns
 * - undefined when neither look is given
 * - the one look given
 * - one look that runs both in that order otherwise, with the names of both in that order, which the rename or unlink looks at through the thread pool first ({@link StillLook})
 * @example
 * bothLooks(undefined, undefined) // => undefined
 * bothLooks(await retiredNameCheck(context, retiredPath), assertHeldStill)?.assert() // throws when either name changed
 */
function bothLooks(
  first: StillLook | undefined,
  second: StillLook | undefined,
): StillLook | undefined {
  if (!first || !second) return first ?? second
  return {
    names: [...first.names, ...second.names],
    assert: (): void => {
      first.assert()
      second.assert()
    },
  }
}

/**
 * Looks at a tracked rollback journal's name ({@link Context.journalVersion}) before this run writes or deletes it, without holding the extension host's thread; called by {@link writeTrackedJournal} and {@link dropTrackedJournal}, which look once more synchronously right before their rename or unlink ({@link assertTrackedJournalStill}), by {@link assertPublishedRecord} right after a rename or link with the version it wrote, and by {@link publishLeftCheck} and {@link adoptedRecordCheck} for a tracked publish record.
 * @param context - The run; its pending path is the journal.
 * @param expected - The version the name must show; the one this run settled or last wrote unless given.
 * @returns
 * - undefined when nothing stands at the name
 * - the journal as this read saw it (inode, hash, size and times) while it shows the expected version
 * @throws A {@link JournalConflictError}: `changed` when the name shows another inode or other bytes, any file while no version is expected, or something that is no record at all (a link, a folder, a file too large: {@link isOtherFileCause}); `unread` when reading the name fails. Nothing is written or deleted then.
 * @example
 * await lookAtTrackedJournal(rollbackContext) // => undefined once the journal's name is empty
 */
async function lookAtTrackedJournal(
  context: Context,
  expected = context.journalVersion?.current,
): Promise<InspectedCopy | undefined> {
  let now: InspectedCopy | undefined
  try {
    now = await inspectCopy(context.pendingPath)
  } catch (cause) {
    // Another program's link, folder or oversized file stands there: moving it away clears it, making it readable does not.
    throw journalConflictError(
      context,
      isOtherFileCause(cause) ? 'changed' : 'unread',
      cause,
    )
  }
  if (!now) return undefined
  // Only this run's own version is written over or deleted; whatever else stands at the name stays for the next run.
  if (now.ino !== expected?.ino || now.sha256 !== expected.sha256)
    throw journalConflictError(context, 'changed')
  return now
}

/**
 * Looks synchronously, once more, at a tracked rollback journal's name right before the move to its dropping name that starts its rewrite or delete ({@link moveTrackedAside}); called by {@link writeTrackedJournal} and {@link dropTrackedJournal} before that move, and by {@link confirmPublished} as the last step of a write, right before it hands the version it published back.
 * Limit: a file put at the name between this look and the syscall that follows is not seen.
 * @param context - The run; its pending path is the journal, its seam is called around the look ({@link isLeftoverStill}).
 * @param look - The journal as {@link lookAtTrackedJournal} read it: its inode, size and times must still show.
 * @throws A {@link JournalConflictError}: `changed` when the name shows another file, size or times; `gone` when it shows nothing, so a publish record that disappeared at this last look is never said to stand still ({@link publishRecordConflict}); `unread` when the look itself fails (a folder that cannot be searched, an I/O error).
 * @example
 * assertTrackedJournalStill(rollbackContext, look) // throws once a backup renamed another journal over the name
 */
function assertTrackedJournalStill(
  context: Context,
  look: InspectedCopy,
): void {
  let isStill: boolean
  try {
    isStill = isLeftoverStill(context, context.pendingPath, look)
  } catch (cause) {
    // A look that fails proves nothing: the name stays as it is, worded as one Codebook could not read again.
    throw journalConflictError(context, 'unread', cause)
  }
  if (isStill) return
  // An empty name is a disappearance, told apart from another file there.
  throw journalConflictError(
    context,
    isNameEmptyNow(context.pendingPath) ? 'gone' : 'changed',
  )
}

/** The codes of an open that refuses to follow a link or finds no regular file ({@link openWithoutFollowing}): something other than a record stands at the name. */
const OTHER_FILE_CODES: ReadonlySet<unknown> = new Set([
  'ELOOP',
  'ENOTREG',
  'EREPLACED',
])

/**
 * Tells whether a failed read of a tracked record's name found something that is no record (a link, a folder, a file too large, or a file swapped in at the open) rather than failing to read it; called by {@link lookAtTrackedJournal}, which words the first as another file at that name and only the second as a name it could not read.
 * @param cause - What {@link inspectCopy} threw.
 * @returns `true` for an {@link UnsaneCopyError} or an open refused for a link, no regular file or a swapped file; `false` for any other failure (a permission, an I/O error).
 * @example
 * isOtherFileCause(Object.assign(new Error('too many links'), { code: 'ELOOP' })) // => true
 * isOtherFileCause(Object.assign(new Error('permission denied'), { code: 'EACCES' })) // => false
 */
function isOtherFileCause(cause: unknown): boolean {
  return cause instanceof UnsaneCopyError || OTHER_FILE_CODES.has(codeOf(cause))
}

/**
 * Deletes a tracked rollback journal ({@link Context.journalVersion}) only while its name shows the version this run settled or last wrote; called by {@link removeRecord} and by a held legacy journal's retirement ({@link HeldJournal}), once the publish record can no longer adopt.
 * A backup or sync tool may put another journal at that name after this run read or wrote its own; that journal may hold a rollback this run never settled, so it stays, and the call rejects.
 * Once its own unlink went through, the run knows no version at that name any more, so a later look passes only an empty name ({@link publishLeftCheck}); a name found empty, by the first look or by an unlink that answers it is gone, keeps the version, because this run did not empty it. For a publish record a decision read (`refusesEmptyName`) such a name ends the run at once with a `gone` conflict: another program moved that record away, and the same record put back before a later look must not pass as one this run settled ({@link isEmptiedByAnother}). Any other name the first look finds empty gets a last synchronous look that it is still empty ({@link assertNameLeft}), and then `assertStill`, after an awaited look at its own name and at `assertStill`'s names: the caller goes on as after a delete, so a journal a sync tool puts back at that name during those awaited looks stays and ends the run, and a setup record a backup puts back without its take-back mark while it moves the journal away is seen before {@link inspect} reads it.
 * The journal is never unlinked at its own name: after the last looks it moves to its dropping name and is deleted there only once it proves to be this run's version and `assertStill` still holds ({@link deleteThroughDroppingName}), so a journal a backup renames over it after the last look goes back to its name instead of being deleted, and a stop in that moment leaves it at the dropping name, where the next run puts it back first, only while it is the file the dropping note written before the last looks names ({@link withDroppingNote}, {@link settleDroppedRecord}).
 * The journal's own synchronous look comes right after its awaited one ({@link lookAtTrackedJournal}), and `assertStill`'s right after an awaited look at its names, so a storage that already stalls holds this step in the thread pool; a stall that starts between those awaited looks and the synchronous ones still holds the extension host's thread.
 * Limits: those of {@link deleteThroughDroppingName}.
 * @param context - The run; its pending path is the journal, its seam is called around the last look ({@link isLeftoverStill}).
 * @param assertStill - A synchronous look at other names that must still hold, called right after the last look and again right before the delete, or right after the first look when that look finds the name empty ({@link removeRecord}); throwing keeps the journal.
 * @throws A {@link JournalConflictError} when the name shows another file or cannot be read again (nothing is deleted then; a file that moved goes back first), also (`changed`) when a name found empty shows a file at the last look, or (`gone`) when a publish record's name is found empty while this run knows a version of it; the refusals naming the dropping name ({@link bothRecordNamesError}, {@link recordNotBackError}); what `assertStill` throws, also for a name found empty; what the delete throws other than for a name that is gone, once the journal went back.
 * @example
 * await dropTrackedJournal(rollbackContext) // pending.json.rollback is gone while it held the version this run settled
 * await dropTrackedJournal(heldRun) // throws a `gone` JournalConflictError once a sync tool moved pending.json away right before the unlink
 * await dropTrackedJournal(rollbackContext, await markLeftCheck(context, decision, legacy)) // throws the `record-reread` refusal once a backup moved pending.json.rollback away and put the unmarked setup record back at pending.json
 */
async function dropTrackedJournal(
  context: Context,
  assertStill?: StillLook,
): Promise<void> {
  const look = await lookAtTrackedJournal(context)
  // Nothing stands at the name: nothing is deleted, and a publish record that disappeared ends the run.
  if (!look) {
    if (isEmptiedByAnother(context)) throw journalConflictError(context, 'gone')
    return assertLeftEmpty(context, assertStill)
  }
  // Should the run stop with the journal at its dropping name, the next run puts back only the file the note names.
  const isDeleted = await withDroppingNote(
    context,
    { moved: look },
    async () => {
      // A storage that already stalls holds this step here, not at the synchronous looks below, which come in the same order: the journal's name, `assertStill`'s names, the dropping name.
      await lookAheadAt([
        context.pendingPath,
        ...(assertStill?.names ?? []),
        droppingPathOf(context),
      ])
      assertTrackedJournalStill(context, look)
      assertStill?.assert()
      return deleteThroughDroppingName(context, look, assertStill)
    },
  )
  // Only this run's own delete clears the version: nothing of it stands there any more.
  if (isDeleted && context.journalVersion)
    context.journalVersion.current = undefined
  // Moved away right before the move: a publish record that may come back right after ends the run here.
  if (!isDeleted && isEmptiedByAnother(context))
    throw journalConflictError(context, 'gone')
}

/**
 * Deletes a tracked record that the last looks showed as this run's version by moving it to its dropping name first ({@link moveTrackedAside}) and deleting it there; called by {@link dropTrackedJournal} right after those looks.
 * After the move the caller's names and the dropping name are looked at again ({@link assertAfterMove}), right before the delete, and the record goes back to its name when anything changed ({@link renewOrPutBack}), so a record whose companion record changed while it moved is never deleted on the earlier look. A file another program puts at the record's own name after the move is not looked at here: it stays, and a caller that must not end beside such a file looks at that name once the delete is done ({@link adoptPending}).
 * Limits: on storage without hard links, a file put at the dropping name between its synchronous look and the move is replaced ({@link moveToDroppingName}), and a swap there between its last look and the unlink is not seen (a name only Codebook uses; no Node primitive unlinks by inode); a stop between the move and the unlink leaves the record at the dropping name, where the next run puts it back, while the dropping note proves it ({@link dropTrackedJournal}), and settles it again ({@link settleDroppedRecord}).
 * @param context - The run; its pending path is the record.
 * @param look - The record as the last look saw it: this run's version.
 * @param assertStill - The caller's look; undefined when nothing else must hold.
 * @returns `true` once this run deleted the record; `false` when its name was empty at the move or the moved file was gone at the delete (another program removed it first), so this run did not empty it.
 * @throws What {@link moveTrackedAside} and {@link assertAfterMove} throw (the record stands at its name again then, unless a refusal names where it stands); for a name the move found empty, what {@link assertLeftEmpty} throws, unless the caller ends the run as `gone` itself ({@link isEmptiedByAnother}); what the unlink throws other than for a missing name, once the record went back.
 * @example
 * await deleteThroughDroppingName(rollbackContext, look, undefined) // => true; pending.json.rollback is gone
 */
async function deleteThroughDroppingName(
  context: Context,
  look: InspectedCopy,
  assertStill: StillLook | undefined,
): Promise<boolean> {
  const aside = await moveTrackedAside(context, look)
  // Another program removed the record first: the name is empty, as the delete wanted, but this run did not empty it.
  if (!aside) {
    // A publish record a decision read ends the run as gone at the caller; for any other record the caller goes on as after a delete, so the same last looks as for a name found empty first hold here.
    if (!isEmptiedByAnother(context))
      await assertLeftEmpty(context, assertStill)
    return false
  }
  await renewOrPutBack(context, aside, () =>
    assertAfterMove(context, aside, assertStill),
  )
  return unlink(aside.droppingPath).then(
    () => true,
    async (error: unknown) => {
      // Another program took the moved record first: this run did not delete it.
      if (codeOf(error) === 'ENOENT') return false
      // The delete failed: the record goes back to its name, as before the move.
      await putTrackedBack(context, aside.droppingPath, aside.moved)
      throw error
    },
  )
}

/**
 * Stops unless a tracked record's name that a delete found empty is still empty at a last synchronous look, and the caller's names still hold, after an awaited look at them; called by {@link dropTrackedJournal} when its first look finds the name empty and by {@link deleteThroughDroppingName} when its move does, because the caller goes on as after a delete on both routes.
 * Limit: a record put back between these looks and the caller's next step is not seen here.
 * @param context - The run; its pending path is the record.
 * @param assertStill - The caller's look; undefined when nothing else must hold.
 * @throws A `changed` {@link JournalConflictError} when a file stands at the record's name again, an `unread` one when that look fails ({@link assertNameLeft}); what `assertStill` throws.
 * @example
 * await assertLeftEmpty(rollbackContext, undefined) // throws once a sync tool put pending.json.rollback back right after it moved it away
 */
async function assertLeftEmpty(
  context: Context,
  assertStill: StillLook | undefined,
): Promise<void> {
  // A storage that already stalls holds this step here, not at the synchronous looks below, which come in the same order: the record's name, then `assertStill`'s names.
  await lookAheadAt([context.pendingPath, ...(assertStill?.names ?? [])])
  // The name must still be empty at this last look: a record a sync tool put back during the awaited looks stays and ends the run.
  assertNameLeft(context, undefined)
  // So must the names it rests on: a setup record a backup put back without its mark while it moved this record away is never adopted.
  assertStill?.assert()
}

/**
 * Tells whether an empty tracked name is a publish record another program moved away, not one this run deleted itself; called by {@link dropTrackedJournal} when its look or its unlink finds the name empty, and by {@link adoptedRecordCheck} when its look does.
 * @param context - The run; its tracker says whether the record is a publish record a decision read (`refusesEmptyName`) and whether this run still knows a version of it.
 * @returns `true` for such a record while a version is known; `false` for a rollback journal, and once this run deleted the record itself.
 * @example
 * isEmptiedByAnother({ ...context, journalVersion: { current: version, refusesEmptyName: true } }) // => true
 * isEmptiedByAnother(rollbackContext) // => false
 */
function isEmptiedByAnother(context: Context): boolean {
  return (
    context.journalVersion?.refusesEmptyName === true &&
    context.journalVersion.current !== undefined
  )
}

/**
 * Gives the journal that a legacy rollback journal held as another publish's is rewritten to when a leftover is refused ({@link holdLegacyJournal}): what stays tracked ({@link retainedRecord}) together with the inode and hash that decided it ({@link legacyEvidenceOf}), so the next run decides on the same evidence ({@link legacyBelonging}) instead of reading a journal without them as the setup's own; called only by {@link settleRollbackJournal}.
 * A displaced copy that stays tracked under the journal's own inode keeps its name, inode and hash, which its next look checks. A copy handed over in this run under another inode (a handed record names the inode its name shows now, {@link handedRecordOf}: a file a sync tool swapped in during the hand-over, or one only its bytes proved) is left to the learner untracked instead, because one `keptIno` cannot name both that file and the inode that decided the journal. Otherwise the evidence comes without a name too, so a copy dropped from tracking (the one reported once) never comes back as a leftover.
 * @param journal - The journal as read.
 * @param retained - What stays tracked after recovery; undefined when nothing does.
 * @returns
 * - `retained` itself while it still names the displaced copy under the journal's `keptIno`
 * - Otherwise what stays tracked, if anything, with the journal's `keptIno` and `keptSha256` and no displaced name
 * @example
 * heldJournalOf(journal, { targetPath, createdFile: false, generation, phase: 'handed', stagedName, stagedIno: 7, stagedSha256: 'c' }) // => { targetPath, createdFile: false, generation, phase: 'handed', stagedName, stagedIno: 7, stagedSha256: 'c', keptIno: 5, keptSha256: 'b' }
 * heldJournalOf(journal, { targetPath, createdFile: false, generation, phase: 'handed', keptName, keptIno: 9, keptSha256: 'b', stagedIno: 7, stagedSha256: 'c' }) // => { targetPath, createdFile: false, generation, phase: 'handed', stagedIno: 7, stagedSha256: 'c', keptIno: 5, keptSha256: 'b' }
 * heldJournalOf(journal, undefined) // => { targetPath, createdFile: false, generation, keptIno: 5, keptSha256: 'b' }
 */
function heldJournalOf(
  journal: Pending,
  retained: Pending | undefined,
): Pending {
  // A displaced copy that stays tracked under the inode that decided the journal names the inode and hash its next look checks.
  if (
    retained?.keptName !== undefined &&
    String(retained.keptIno) === String(journal.keptIno)
  )
    return retained
  // A copy handed over under another inode is no longer named, so that inode never becomes the evidence that decides the journal.
  return { ...retained, keptName: undefined, ...legacyEvidenceOf(journal) }
}

/**
 * Reduces a legacy rollback journal to the evidence that tells whether it belongs to the publish record ({@link legacyBelonging}): its displaced file's inode and hash, without names, so no later recovery acts on a leftover from it; called by {@link heldJournalOf}.
 * @param journal - The journal as read.
 * @returns A journal of the same config and generation with only `keptIno` and `keptSha256`.
 * @example
 * legacyEvidenceOf({ targetPath, createdFile: false, generation, keptName, keptIno: 5, keptSha256: 'b', stagedIno: 5 }) // => { targetPath, createdFile: false, generation, keptIno: 5, keptSha256: 'b' }
 */
function legacyEvidenceOf({
  targetPath,
  generation,
  keptIno,
  keptSha256,
}: Pending): Pending {
  return { targetPath, createdFile: false, generation, keptIno, keptSha256 }
}

/**
 * Stops a run whose look at the config no longer shows the bytes on which a legacy rollback journal was decided as another publish's ({@link HeldJournal}); called by {@link settleAfterRecovery} right after its look, before anything is adopted.
 * @param context - The run.
 * @param held - The held journal; undefined when none is held.
 * @param look - The run's look at the config.
 * @throws The {@link unmatchedJournalRefusal} for a changed read when the config is gone or holds other bytes; nothing is written or retired then, so the next run decides again.
 * @example
 * assertHeldJournalStill(context, held, look) // throws when the config was saved again between the two reads
 */
function assertHeldJournalStill(
  context: Context,
  held: HeldJournal | undefined,
  look: ConfigLook,
): void {
  if (!held) return
  if (look.kind === 'present' && look.sha256 === held.restoredSha256) return
  throw unmatchedJournalRefusal(context, 'reread', held.legacy)
}

/**
 * Binds the rest of a run that holds a legacy rollback journal ({@link HeldJournal}) to the publish record that journal's decision read; called by {@link inspect} right after its own read of `pending.json`, before anything is recovered, adopted or ended from it.
 * A backup or sync tool may put another record at that name, or move it away, after the decision read it: the run then stops instead of adopting or ending a record the journal was never decided on, and the held journal stays for the next run. From here on the run tracks the version it read ({@link Context.journalVersion}), so every later write or delete of that record goes on only while its name still shows what this run read or last wrote ({@link writeRecord}, {@link removeRecord}), and a write never puts that record back at a name found empty (`refusesEmptyName`).
 * @param context - The run.
 * @param held - The held journal; undefined when none is held.
 * @param version - The version of `pending.json` that {@link inspect}'s read saw, which {@link readPublishRecord} found to be the one the decision read; undefined when the name was empty.
 * @returns
 * - `context` itself when no journal is held
 * - the run tracking that version as its publish record's ({@link Context.journalVersion}) otherwise
 * @throws The `record-gone` {@link unmatchedJournalRefusal} when the record is gone; nothing is written or retired then, so the next run decides on both records again.
 * @example
 * const run = heldPublishContext(context, held, read?.version) // throws once a sync tool moved pending.json away after the journal was decided
 */
function heldPublishContext(
  context: Context,
  held: HeldJournal | undefined,
  version: RecordVersion | undefined,
): Context {
  if (!held) return context
  if (!version)
    throw unmatchedJournalRefusal(context, 'record-gone', held.legacy)
  // An empty name later means this record disappeared: it is never written back there.
  return {
    ...context,
    journalVersion: { current: version, refusesEmptyName: true },
  }
}

/**
 * Reads the publish record for {@link inspect}. Beside a held legacy rollback journal ({@link HeldJournal}) the bytes and the inode at that name are compared with the version that journal's decision read before they are parsed, so another file a backup or sync tool put there meanwhile, whatever it holds, ends the run with the refusal that keeps both records as they stand, never with advice to remove that file.
 * @param context - The run; its seam is called as for every record read ({@link readRecordFile}).
 * @param held - The held journal; undefined when none is held.
 * @returns The record and its version ({@link readVersionedRecord}); undefined when the name is empty, which {@link heldPublishContext} words beside a held journal.
 * @throws What {@link readVersionedRecord} throws when no journal is held. Beside a held journal the `record-reread` {@link unmatchedJournalRefusal} when the name shows another inode or other bytes than the decision read, or something that is no record now (a link, a folder or a file too large), and the `record-unread` one when the read itself fails ({@link isFailedRead}): nothing is parsed, written or retired then, so the next run decides on both records again.
 * @example
 * const read = await readPublishRecord(context, held) // throws the record-reread refusal once a backup put a file that is no record at pending.json
 */
async function readPublishRecord(
  context: Context,
  held: HeldJournal | undefined,
): Promise<{ record: Pending; version: RecordVersion } | undefined> {
  const { pendingPath, retry, seam } = context
  if (!held) return readVersionedRecord(pendingPath, pendingSchema, retry, seam)
  const read = await readRecordFile(pendingPath, retry, seam).catch(
    (error: unknown) => {
      // The decision read a record at this name: a read that failed is said as one, anything else that is no record now is another file, and both records stay as they stand.
      throw unmatchedJournalRefusal(
        context,
        isFailedRead(error) ? 'record-unread' : 'record-reread',
        held.legacy,
      )
    },
  )
  if (!read) return undefined
  const version = { ino: read.ino, sha256: bytesSha256(read.bytes) }
  const decided = held.publishVersion
  // Another inode or other bytes: not the record the journal was decided on, whatever they hold.
  if (version.ino !== decided.ino || version.sha256 !== decided.sha256)
    throw unmatchedJournalRefusal(context, 'record-reread', held.legacy)
  return {
    record: parseRecord(pendingPath, pendingSchema, retry, read.bytes),
    version,
  }
}

/**
 * Retires a held legacy rollback journal ({@link HeldJournal}) once the publish record can no longer adopt, only while that record's name shows what this run left there, at a look before the journal is read again and once more right before its unlink ({@link publishLeftCheck}); called by {@link settleAfterRecovery} after the publish record was settled.
 * @param context - The run ({@link heldPublishContext}); its pending path is the publish record.
 * @param held - The held journal; undefined when none is held, and nothing is looked at or deleted.
 * @throws What {@link publishLeftCheck} and its synchronous look throw, and what the journal's retirement throws; the journal stays then.
 * @example
 * await retireHeldJournal(run, held) // pending.json.rollback is gone, or the call throws and both records stay
 */
async function retireHeldJournal(
  context: Context,
  held: HeldJournal | undefined,
): Promise<void> {
  if (!held) return
  await held.retire(await publishLeftCheck(context, held.legacy))
}

/**
 * Stops a run unless the publish record's name shows what this run left there (the version it read or last wrote, or nothing once this run deleted that record itself or found that name empty), and gives the synchronous look that must still find the same right before the unlink of the rollback journal that rests on that record; called by {@link retireHeldJournal} before a held legacy journal goes, so that journal goes only after the record it was decided on was settled as read, and by {@link markLeftCheck} before a settled journal goes.
 * This look reads the bytes without holding the extension host's thread; the one it gives compares the inode, size and times of what it read, or an empty name, after the journal's own last look ({@link dropTrackedJournal}), so a record a backup puts at that name while the journal is read again is seen.
 * The journal's delete looks at the publish record's name through the thread pool once more right before that synchronous look ({@link StillLook}, {@link dropTrackedJournal}), so a storage that already stalls holds that step there, not the extension host's thread.
 * Limit: a record put at that name between that last look and the unlink, or after it, is decided without the journal, like one restored after the run; a stall that starts between that awaited look and the synchronous one holds the extension host's thread.
 * @param context - The run; its pending path is the publish record, which it tracks ({@link Context.journalVersion}), and its seam is called around each synchronous look ({@link isLeftoverStill}).
 * @param legacy - The journal's evidence, which the refusal names; undefined for a journal of this build.
 * @returns The synchronous look at the publish record's name ({@link assertPublishStillLeft}).
 * @throws The `record-gone` {@link unmatchedJournalRefusal} when the name is empty while this run left a record there; the `record-reread` one when it shows another file or cannot be read again. Nothing is retired then.
 * @example
 * const assertPublishStill = await publishLeftCheck(run, held.legacy) // throws once a sync tool moved pending.json away while the run settled it
 */
async function publishLeftCheck(
  context: Context,
  legacy: LegacyJournalEvidence | undefined,
): Promise<StillLook> {
  let left: InspectedCopy | undefined
  try {
    left = await lookAtTrackedJournal(context)
    // The hash came from an open handle: the name must still show that same file.
    if (left) assertTrackedJournalStill(context, left)
  } catch (error) {
    throw publishRecordConflict(context, legacy, error)
  }
  // An empty name passes only once this run deleted the record itself.
  if (!left && context.journalVersion?.current !== undefined)
    throw unmatchedJournalRefusal(context, 'record-gone', legacy)
  return {
    names: [context.pendingPath],
    assert: (): void => assertPublishStillLeft(context, legacy, left),
  }
}

/**
 * Looks once more, synchronously, at the publish record's name right before the unlink of a rollback journal that rests on it; the look {@link publishLeftCheck} gives.
 * @param context - The run; its pending path is the publish record, its seam is called around the look ({@link isLeftoverStill}).
 * @param legacy - The journal's evidence, which the refusal names; undefined for a journal of this build.
 * @param left - What {@link publishLeftCheck} found there: the record this run left, or undefined for a name this run emptied.
 * @throws The `record-reread` {@link unmatchedJournalRefusal} when the name no longer shows that file (or shows a file where it was empty) or cannot be looked at; nothing is deleted then.
 * @example
 * assertPublishStillLeft(run, legacy, undefined) // throws once a backup put a record back at pending.json after the run deleted it
 */
function assertPublishStillLeft(
  context: Context,
  legacy: LegacyJournalEvidence | undefined,
  left: InspectedCopy | undefined,
): void {
  try {
    assertNameLeft(context, left)
  } catch (error) {
    throw publishRecordConflict(context, legacy, error)
  }
}

/**
 * Looks synchronously at a tracked record's name ({@link Context.journalVersion}) and stops unless it still shows what an earlier look found there; called by {@link assertPublishStillLeft} for the publish record, which words what it throws as that record's own refusal, by the looks {@link adoptedRecordCheck} and {@link journalLeftCheck} give right before an adoption's receipt is published and its record ends, and by {@link assertLeftEmpty} for a name a delete found empty.
 * @param context - The run; its pending path is the name, its seam is called around the look ({@link isLeftoverStill}).
 * @param left - What the earlier look found: a file (its inode, size and times must still show), or undefined for a name that must still be empty.
 * @throws A {@link JournalConflictError}: `changed` when the name no longer shows that file or shows a file where it was empty, `unread` when the look itself fails.
 * @example
 * assertNameLeft(run, undefined) // throws once a backup put a record back at a name this run emptied
 */
function assertNameLeft(
  context: Context,
  left: InspectedCopy | undefined,
): void {
  if (left) assertTrackedJournalStill(context, left)
  // A name found empty must still be empty.
  else if (!isNameEmptyNow(context.pendingPath))
    throw journalConflictError(context, 'changed')
}

/**
 * Words a conflict at the publish record's name as that record's own refusal beside the rollback record: a write or delete that tracked the version this run read of `pending.json` ({@link Context.journalVersion}) found another file there, could not read it again or found the name empty; called by {@link markTakeBackOwed}, {@link settleAfterRecovery} for a held run, {@link publishLeftCheck} and {@link assertPublishStillLeft}.
 * @param context - The run; its pending path is the publish record.
 * @param legacy - The legacy journal's evidence, which the refusal names; undefined for a journal of this build.
 * @param error - What the write, delete or look threw.
 * @returns
 * - the `record-gone` {@link unmatchedJournalRefusal} for a `gone` {@link JournalConflictError} (the name was found empty)
 * - the `record-unread` one for an `unread` one (the name could not be read again)
 * - the `record-reread` one for a `changed` one
 * - `error` itself otherwise, also for a {@link HeldJournalConflictError}, which a held legacy journal's own name threw
 * @example
 * throw publishRecordConflict(context, legacy, conflict) // 'Codebook found a record of a setup that ended early and a record of its rollback, but the record of that setup at …/pending.json changed while Codebook was settling it …'
 * throw publishRecordConflict(context, legacy, goneConflict) // '… but the record of that setup at …/pending.json disappeared while Codebook was settling it …'
 */
function publishRecordConflict(
  context: Context,
  legacy: LegacyJournalEvidence | undefined,
  error: unknown,
): unknown {
  // A conflict at the held journal's own name keeps that journal's sentence.
  if (
    !(error instanceof JournalConflictError) ||
    error instanceof HeldJournalConflictError
  )
    return error
  // A disappearance, a failed read and another file there are each said as what they are.
  const reason: Record<JournalConflictError['kind'], UnmatchedReason> = {
    gone: 'record-gone',
    unread: 'record-unread',
    changed: 'record-reread',
  }
  return unmatchedJournalRefusal(context, reason[error.kind], legacy)
}

/**
 * Turns a conflict at the name of a run's own `pending.json` into a refusal about that record ({@link RecordConflictError}) with the conflict's own sentence ({@link journalConflictError}), so the private file recovery could not settle is named after it ({@link mergeWithLeftover}): the record that named that file changed or disappeared under the run; called by {@link settleAfterRecovery} for a run that holds no legacy journal, and by {@link takeBackRecordLook} before a take-back moves the config.
 * @param error - What settling the record threw.
 * @returns
 * - a {@link RecordConflictError} with the same message, the conflict as its cause, for a {@link JournalConflictError}
 * - `error` itself otherwise
 * @example
 * throw asRecordConflict(conflict) // 'While Codebook settled its record of an earlier change at …/pending.json, another program changed or replaced it …'
 */
function asRecordConflict(error: unknown): unknown {
  if (!(error instanceof JournalConflictError)) return error
  return new RecordConflictError(error.message, { cause: error })
}

/** How a rollback journal relates to the publish record ({@link markTakeBackOwed}): `belongs` marks the take-back, `another` leaves the record as it is; only for an older build's journal ({@link legacyBelonging}), `another-config` leaves it too but was decided on one read of a restored config that is valid and lacks the setup's entry, so the journal is held until the run's own look shows those bytes ({@link settleRollbackJournal}), and `unmatched` (the evidence contradicts itself), `unread` (the config that decides could not be read) and `invalid` (it was read but is no valid JSON config, as while an editor saves it) refuse and keep both records ({@link unmatchedJournalRefusal}), so the next run decides again. */
type JournalBelonging =
  'belongs' | 'another' | 'another-config' | 'unmatched' | 'unread' | 'invalid'

/** Why a rollback journal is refused and kept with the publish record ({@link unmatchedJournalRefusal}): one of {@link legacyBelonging}'s refusing answers, `reread` when the config changed between the read that decided an older build's journal and the run's own look ({@link assertHeldJournalStill}), `record-reread` when the publish record a decision read changed before the run adopted, marked or ended it ({@link markTakeBackOwed}, {@link readPublishRecord}, {@link publishRecordConflict}), `record-gone` when it disappeared before a held journal could go ({@link heldPublishContext}, {@link publishLeftCheck}), or `record-unread` when it could not be read again then ({@link publishRecordConflict}, {@link readPublishRecord}). */
type UnmatchedReason =
  | Extract<JournalBelonging, 'unmatched' | 'unread' | 'invalid'>
  | 'reread'
  | 'record-reread'
  | 'record-gone'
  | 'record-unread'

/** What a rollback journal of an older build (no publish generation) offers {@link legacyBelonging}: the journal (its displaced file's inode and hash), the config its recovery put back, and what that recovery could not settle. */
type LegacyJournalEvidence = {
  journal: Pending
  /** The config's bytes ({@link restoredConfigBytes}); undefined when it could not be read, which decides nothing ({@link legacyBelonging}). */
  restoredBytes: Buffer | undefined
  /** The first leftover the journal's recovery could not settle; the {@link unmatchedJournalRefusal} names it too, because that refusal keeps the journal as it is and comes before the leftover's own refusal. */
  reported: Unsettled | undefined
}

/**
 * Reads the bytes of the config a recovery just put back, without following a link and never past {@link DEVIN_MCP_CONFIG_LIMIT_BYTES}; called by {@link settleRollbackJournal} for a journal of an older build, so {@link legacyBelonging} can look at them before anything is refused on that config.
 * @param context - The run; its seam is called before the bytes are read ({@link DevinMcpTestSeam.afterStat}), so a test can make the read fail.
 * @returns The bytes; undefined when the config is absent, a link, no regular file or larger than the limit, or cannot be read.
 * @example
 * await restoredConfigBytes(context) // => <Buffer 7b 0a ...> once the original config is back
 */
async function restoredConfigBytes(
  context: Context,
): Promise<Buffer | undefined> {
  const file = await openWithoutFollowing(context.path).catch(() => undefined)
  // Absent, a link or not openable: nothing to decide on.
  if (!file) return undefined
  try {
    const status = await file.stat()
    if (!status.isFile()) return undefined
    return await readWithinLimit(
      file,
      status.size,
      DEVIN_MCP_CONFIG_LIMIT_BYTES,
      () => context.seam?.afterStat?.(context.path),
    )
  } catch {
    return undefined
  } finally {
    await file.close()
  }
}

/** What {@link configEntryHashOf} read in a config's bytes: no valid JSON config (`invalid`), or a valid one with the core hash of its `codebook` entry, undefined when it holds none. */
type ConfigEntryHash =
  { kind: 'invalid' } | { kind: 'valid'; hash: string | undefined }

/**
 * Gives the core hash ({@link coreHashOf}) of the `codebook` entry in a config's bytes; used by {@link legacyBelonging} on the config a recovery put back.
 * Bytes that are no valid JSON config are told apart from a config without the entry: a file an editor is still saving proves nothing, while a config that holds no entry or another one is another publish's.
 * @param bytes - The config's bytes.
 * @returns
 * - `invalid` for bytes that are not valid UTF-8 or no JSON, an object that names one member twice, a top level that is no object, or an `mcpServers` that is no object (what {@link parseConfig} refuses as well)
 * - `valid` with the hash; the hash is undefined for a config without `mcpServers` or without an entry, or an entry that is no object
 * @example
 * configEntryHashOf(Buffer.from('{"mcpServers":{}}'))                     // => { kind: 'valid', hash: undefined }
 * configEntryHashOf(Buffer.from('{"mcpServ'))                             // => { kind: 'invalid' }
 * configEntryHashOf(Buffer.from('{"mcpServers":{"codebook":{}},"mcpServers":{}}')) // => { kind: 'invalid' }
 * configEntryHashOf(Buffer.from([0x7b, 0x22, 0xff, 0x22, 0x3a, 0x31, 0x7d])) // => { kind: 'invalid' } ('{"\xff":1}')
 */
function configEntryHashOf(bytes: Buffer): ConfigEntryHash {
  let text: string
  let root: unknown
  try {
    // Decoded as strictly as {@link parseConfig} decodes: a byte that is not valid UTF-8 would become U+FFFD and could hide the "mcpServers" key; `ignoreBOM` keeps a BOM in the text, so the parse refuses it.
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
      bytes,
    )
    root = JSON.parse(text)
  } catch {
    return { kind: 'invalid' }
  }
  // JSON.parse keeps only the last of two equal names, so an earlier "mcpServers" that holds the entry would read as none.
  if (hasDuplicateJsonMember(text) || !isJsonObject(root))
    return { kind: 'invalid' }
  const servers = root.mcpServers
  // No servers at all is a valid config without the entry; servers that are no object are no valid config.
  if (servers === undefined) return { kind: 'valid', hash: undefined }
  if (!isJsonObject(servers)) return { kind: 'invalid' }
  return { kind: 'valid', hash: coreHashOf(servers[SERVER_NAME]) }
}

/**
 * Tells whether a rollback journal of an older build (no publish generation) belongs to the publish record; used by {@link markTakeBackOwed}.
 * The journal's `keptSha256` hashes the published file as the rollback found it, so the same inode with another hash is either the published file with text appended in place or the inode reused for another file: the config the recovery put back decides.
 * @param journal - The journal's displaced file (`keptIno`, `keptSha256`); undefined when there is none.
 * @param publish - The publish record.
 * @param restoredBytes - The config the recovery put back ({@link restoredConfigBytes}); undefined when it could not be read.
 * @returns
 * - `belongs` when an inode or a hash is missing (nothing proves another publish, so take-back is marked as the previous release did), when inode and hash both match, or when the inode matches and the restored config holds the setup's entry and starts with the published bytes ({@link hasPrefixWithSha256})
 * - `another` for another inode
 * - `another-config` for the same inode with another hash when the restored config is valid and holds no entry or another one; decided on that one read, so the journal is held until the run's own look shows the same bytes ({@link settleRollbackJournal})
 * - `unmatched` for the same inode with another hash when the restored config holds the setup's entry but does not start with the published bytes
 * - `unread` for the same inode with another hash when the restored config could not be read (gone, a link, no regular file, too large or a failed read): a transient failure proves no other publish, and a later read may find the published file
 * - `invalid` for the same inode with another hash when the restored config was read but is no valid JSON config ({@link configEntryHashOf}), as while an editor saves it: half-saved bytes prove no other publish either
 * @example
 * legacyBelonging({ keptIno: 5, keptSha256: 'a' }, { ...publish, stagedIno: 6, stagedSha256: 'a' }, bytes) // => 'another'
 * legacyBelonging({ keptIno: 5, keptSha256: 'b' }, { ...publish, stagedIno: 5, stagedSha256: 'a' }, publishedBytesWithALineAppended) // => 'belongs'
 * legacyBelonging({ keptIno: 5, keptSha256: 'b' }, { ...publish, stagedIno: 5, stagedSha256: 'a' }, sameEntryAmongOtherServers) // => 'unmatched'
 * legacyBelonging({ keptIno: 5, keptSha256: 'b' }, { ...publish, stagedIno: 5, stagedSha256: 'a' }, undefined) // => 'unread'
 * legacyBelonging({ keptIno: 5, keptSha256: 'b' }, { ...publish, stagedIno: 5, stagedSha256: 'a' }, Buffer.from('{"mcpServ')) // => 'invalid'
 */
function legacyBelonging(
  journal: Pick<Pending, 'keptIno' | 'keptSha256'> | undefined,
  publish: Pending,
  restoredBytes: Buffer | undefined,
): JournalBelonging {
  const { stagedIno, stagedSha256 } = publish
  // An inode or a hash missing on either side proves no other publish.
  if (
    journal?.keptIno === undefined ||
    journal.keptSha256 === undefined ||
    stagedIno === undefined ||
    stagedSha256 === undefined
  )
    return 'belongs'
  if (String(journal.keptIno) !== String(stagedIno)) return 'another'
  if (journal.keptSha256 === stagedSha256) return 'belongs'
  // The same inode with other bytes: only a restored config that still holds the setup's entry can be the published file, and one that could not be read, or is no valid config yet, decides nothing yet.
  if (restoredBytes === undefined) return 'unread'
  const restored = configEntryHashOf(restoredBytes)
  if (restored.kind === 'invalid') return 'invalid'
  // A valid config without the setup's entry, on this one read: the caller holds the journal until its own look agrees.
  if (
    restored.hash === undefined ||
    restored.hash !== plainEntryHashOf(publish.entrySha256)
  )
    return 'another-config'
  // Text appended in place keeps the published bytes at the start; a reused inode with the same entry among other settings does not.
  return hasPrefixWithSha256(restoredBytes, stagedSha256)
    ? 'belongs'
    : 'unmatched'
}

/**
 * Builds the refusal for a rollback journal of an older build that {@link legacyBelonging} cannot match to the publish record (`unmatched`), or cannot match yet because the config that decides could not be read (`unread`), is no valid JSON config yet (`invalid`) or changed between the read that decided the journal and the run's own look (`reread`); thrown by {@link markTakeBackOwed} and {@link assertHeldJournalStill} before any record is written or retired, so both records stay: the learner decides about the entry, or the next run reads the config again.
 * It also refuses a run whose publish record changed (`record-reread`) or disappeared (`record-gone`) after a decision on a journal read it, before that record was adopted, marked or ended and before the journal is deleted ({@link markTakeBackOwed}, {@link readPublishRecord}, {@link heldPublishContext}, {@link publishLeftCheck}, {@link assertPublishStillLeft}); the journal may be of either build then.
 * The journal's recovery already ran (a displaced file may be back at the config name), so the sentence claims only what stays: the entry or the file's bytes, both records, and a leftover that recovery could not settle, which is named here because this refusal comes before its own ({@link unmatchedLeftoverSentence}).
 * @param context - The run; its config path, publish record path and retry are named, and the journal path beside the record ({@link rollbackContextOf}).
 * @param belonging - Which of the three answers {@link legacyBelonging} gave, `reread`, `record-reread` or `record-gone`.
 * @param legacy - The journal and the first leftover its recovery could not settle, if any ({@link LegacyJournalEvidence}); undefined for a journal of this build.
 * @returns The error, not thrown yet; a {@link RecordConflictError} for `record-reread` and `record-gone`.
 * @example
 * throw unmatchedJournalRefusal(context, 'unread', legacy) // 'Codebook found a record of a setup that ended early and a record of its rollback that it cannot match yet: …'
 * throw unmatchedJournalRefusal(context, 'record-gone', held.legacy) // 'Codebook found a record of a setup that ended early and a record of its rollback, but the record of that setup at …/pending.json disappeared while Codebook was settling it …'
 */
function unmatchedJournalRefusal(
  context: Context,
  belonging: UnmatchedReason,
  legacy: LegacyJournalEvidence | undefined,
): Error {
  const message = unmatchedJournalSentence(context, belonging, legacy)
  // A refusal about the publish record itself is told apart: the record that names this run's leftovers no longer stands as read.
  return belonging.startsWith('record-')
    ? new RecordConflictError(message)
    : new Error(message)
}

/**
 * Words an {@link unmatchedJournalRefusal}: the reason's sentence, then the journal's leftover ({@link unmatchedLeftoverSentence}); called only by that refusal.
 * @param context - The run; its config path, publish record path and retry are named, and the journal path beside the record ({@link rollbackContextOf}).
 * @param belonging - The reason ({@link UnmatchedReason}).
 * @param legacy - The journal and the first leftover its recovery could not settle, if any; undefined for a journal of this build.
 * @returns The whole message.
 * @example
 * unmatchedJournalSentence(context, 'record-gone', undefined) // => 'Codebook found a record of a setup that ended early and a record of its rollback, but the record of that setup at …/pending.json disappeared while Codebook was settling it …'
 */
function unmatchedJournalSentence(
  context: Context,
  belonging: UnmatchedReason,
  legacy: LegacyJournalEvidence | undefined,
): string {
  const { path, pendingPath, retry } = context
  const journalPath = rollbackContextOf(context).pendingPath
  const records = `${pendingPath}, ${journalPath}`
  const notYet = `Codebook found a record of a setup that ended early and a record of its rollback that it cannot match yet: the rollback's file has the inode the setup published but other bytes`
  const settling = `Codebook found a record of a setup that ended early and a record of its rollback, but the record of that setup at ${pendingPath}`
  // A config that could not be read, or that is no valid config yet, decides nothing: the next run reads it again.
  const sentence = {
    'record-reread': `${settling} changed while Codebook was settling it (a backup or sync tool may have put another one there), so Codebook stopped before it adopted that setup or deleted the record of its rollback. Codebook kept both records as they stand now (${records}), so the next run decides on them again; wait until that tool is done, ${retry}.`,
    'record-gone': `${settling} disappeared while Codebook was settling it (a backup or sync tool may be moving it), so Codebook stopped before it deleted the record of its rollback and kept that record at ${journalPath}; the next run decides on it again, so wait until that tool is done, ${retry}.`,
    'record-unread': `${settling} could not be read again while Codebook was settling it, so Codebook stopped before it adopted that setup or deleted the record of its rollback. Codebook kept both records as they stand (${records}), so the next run decides on them again; make that file readable by you if it is not, ${retry}.`,
    unread: `${notYet}, and Codebook could not read ${path} again (it is gone, a link, no regular file, larger than ${DEVIN_MCP_CONFIG_LIMIT_BYTES} bytes or unreadable) to see whether it holds the "${SERVER_NAME}" entry the setup wrote. Codebook changed nothing in that file and kept both records (${records}), so the next run looks again; make that file readable, or delete both records if it is gone, ${retry}.`,
    invalid: `${notYet}, and ${path} is no valid JSON config right now (an editor may still be saving it), so Codebook cannot see whether it holds the "${SERVER_NAME}" entry the setup wrote. Codebook changed nothing in that file and kept both records (${records}), so the next run looks again; fix that file or wait until it is saved, ${retry}.`,
    reread: `${notYet}, and ${path} changed between two of Codebook's reads of it, so Codebook cannot see yet whether it holds the "${SERVER_NAME}" entry the setup wrote. Codebook changed nothing in that file and kept both records (${records}), so the next run looks again; wait until it is saved, ${retry}.`,
    unmatched: `Codebook found a record of a setup that ended early and a record of its rollback that it cannot match: the rollback's file has the inode the setup published but other bytes, and the "${SERVER_NAME}" entry in ${path} is the one the setup wrote. Codebook left that entry in place and kept both records (${records}); if you did not write that entry, remove it by hand, delete both records, ${retry}.`,
  }[belonging]
  // A leftover that stays with the kept journal is named once more, so the advice to delete both records never hides it.
  return `${sentence}${unmatchedLeftoverSentence(context, legacy)}`
}

/**
 * Builds the refusal for a tracked rollback journal ({@link Context.journalVersion}) whose name no longer shows the version this run settled or wrote (`changed`), shows nothing (`gone`), or cannot be read again (`unread`); thrown by {@link lookAtTrackedJournal}, {@link assertTrackedJournalStill}, {@link claimJournal}, {@link writeTrackedJournal} and {@link dropTrackedJournal}, so nothing is written or deleted at that name and the run goes no further ({@link settleRollbackJournal}).
 * A tracked `pending.json` (the record a decision read, `refusesEmptyName`: {@link heldPublishContext}, {@link trackedPublishContext}, {@link markTakeBackOwed}; or the run's own record after {@link inspect}, {@link ownRecordContext}) is named as Codebook's record of an earlier change, never as a rollback record, wherever its conflict surfaces; a held run's caller words it with both records instead ({@link publishRecordConflict}). A tracked `receipt.json` ({@link receiptTrackedContextOf}) is named as Codebook's record of the entry ({@link receiptConflictSentence}), in a {@link TrackedReceiptConflictError}, which {@link writeReceipt} and {@link dropReceipt} tell apart from any other conflict.
 * @param context - The run whose pending path is tracked: the rollback's context ({@link rollbackContextOf}), a run tracking `pending.json`, or one tracking `receipt.json`; its retry ends the sentence.
 * @param kind - What the look found.
 * @param cause - The failure behind it, kept for diagnosis and never put into the sentence.
 * @returns The error, not thrown yet.
 * @example
 * throw journalConflictError(rollbackContext, 'changed') // 'While Codebook settled its rollback record at …/pending.json.rollback (a rollback that ended early), another program changed, removed or replaced it …'
 * throw journalConflictError(run, 'gone') // 'While Codebook settled its record of an earlier change at …/pending.json, another program moved it away or deleted it …'
 * throw journalConflictError(receiptTrackedContextOf(run), 'changed') // a TrackedReceiptConflictError: 'Codebook found a file at …/receipt.json, where it keeps its record of the "codebook" entry …, that is not the record it had read there …'
 */
function journalConflictError(
  context: Context,
  kind: JournalConflictError['kind'],
  cause?: unknown,
): JournalConflictError {
  const options = cause === undefined ? undefined : { cause }
  // Codebook's record of the entry, tracked while it moves through its dropping name, is worded as that record's own conflict.
  if (context.pendingPath === context.receiptPath)
    return new TrackedReceiptConflictError(
      receiptConflictSentence(context, kind),
      kind,
      options,
    )
  // The name decides the wording, whichever tracker reached it: a rollback journal is that record, `pending.json` Codebook's record of an earlier change.
  const sentence = context.pendingPath.endsWith(ROLLBACK_JOURNAL_SUFFIX)
    ? rollbackRecordSentence(context, kind)
    : earlierRecordSentence(context, kind)
  return new JournalConflictError(sentence, kind, options)
}

/**
 * Words a conflict at a rollback journal's name ({@link journalConflictError}); a name found empty is worded as a removal too.
 * @param context - The rollback's context; its pending path is the journal, its retry ends the sentence.
 * @param kind - What the look found.
 * @returns The sentence.
 * @example
 * rollbackRecordSentence(rollbackContext, 'unread') // => 'While Codebook settled its rollback record at …/pending.json.rollback (a rollback that ended early), it could not read that name again …'
 */
function rollbackRecordSentence(
  { pendingPath: journal, retry }: Context,
  kind: JournalConflictError['kind'],
): string {
  const settling = `While Codebook settled its rollback record at ${journal} (a rollback that ended early)`
  const replaced = `${settling}, another program changed, removed or replaced it (a backup or sync tool may have put an older one back), so Codebook left that name as it is and went no further; wait until that tool is done, ${retry}, and that run reads that name first.`
  return {
    changed: replaced,
    gone: replaced,
    unread: `${settling}, it could not read that name again to check that it still holds that record, so Codebook left that name as it is and went no further; make that file readable by you if it is not, ${retry}, and that run reads that name first.`,
  }[kind]
}

/**
 * Words a conflict at the name of a run's own `pending.json` ({@link journalConflictError}): the record of an earlier write or removal this run settles, which another program changed, moved away or made unreadable after the run read it.
 * @param context - The run; its pending path is the record, its retry ends the sentence.
 * @param kind - What the look found.
 * @returns The sentence.
 * @example
 * earlierRecordSentence(run, 'changed') // => 'While Codebook settled its record of an earlier change at …/pending.json, another program changed or replaced it …'
 */
function earlierRecordSentence(
  { pendingPath, retry }: Context,
  kind: JournalConflictError['kind'],
): string {
  const settling = `While Codebook settled its record of an earlier change at ${pendingPath}`
  return {
    changed: `${settling}, another program changed or replaced it (a backup or sync tool may have put an older one back), so Codebook left that name as it is and went no further; wait until that tool is done, ${retry}, and that run reads that name first.`,
    gone: `${settling}, another program moved it away or deleted it (a backup or sync tool may be moving it), so Codebook did not write it back and went no further; wait until that tool is done, ${retry}, and that run reads that name first.`,
    unread: `${settling}, it could not read that name again to check that it still holds that record, so Codebook left that name as it is and went no further; make that file readable by you if it is not, ${retry}, and that run reads that name first.`,
  }[kind]
}

/**
 * Joins the refusal of a leftover recovery could not settle with the conflict that ended the run, at the journal's name or at the publish record's, so the learner reads both in one message; called by {@link withJournalLeftover}.
 * @param leftoverRefusal - The leftover's refusal ({@link unsettledRefusal}).
 * @param conflict - The {@link JournalConflictError} the journal's write or delete threw, or the {@link RecordConflictError} about the publish record.
 * @returns One error: the leftover's sentence, a space, then the conflict's.
 * @example
 * refusalWithConflict(unsettledRefusal(rollbackContext, phase, reported), conflict) // => 'Codebook found a private file at … While Codebook settled its rollback record at …'
 */
function refusalWithConflict(
  leftoverRefusal: Error,
  conflict: JournalConflictError | RecordConflictError,
): Error {
  return new Error(`${leftoverRefusal.message} ${conflict.message}`, {
    cause: conflict,
  })
}

/**
 * Names the leftover a rollback journal's recovery could not settle before the conflict that ended the run, so a refusal about a name never hides that private file; called by {@link settleRollbackJournal} for the take-back mark and for the journal's hold or retirement.
 * @param error - What the mark, the hold or the retirement threw.
 * @param rollbackContext - The rollback's context ({@link rollbackContextOf}); it words the leftover.
 * @param phase - The phase recovery read the journal in ({@link leftoverPhaseOf}).
 * @param reported - The first leftover that stays; undefined when none does.
 * @param legacy - The journal's evidence for a journal of an older build, whose refusals about the publish record name that leftover themselves ({@link unmatchedLeftoverSentence}); undefined for a journal of this build.
 * @returns
 * - The leftover's refusal followed by `error` ({@link refusalWithConflict}) for a {@link JournalConflictError}, and for a {@link RecordConflictError} about a journal of this build
 * - `error` itself otherwise, or when no leftover stays
 * @example
 * throw withJournalLeftover(recordReread, rollbackContext, undefined, reported, undefined) // 'Codebook found a private file at … Codebook found a record of a setup that ended early and a record of its rollback, but the record of that setup … changed …'
 */
function withJournalLeftover(
  error: unknown,
  rollbackContext: Context,
  phase: Pending['phase'],
  reported: Unsettled | undefined,
  legacy: LegacyJournalEvidence | undefined,
): unknown {
  if (!reported) return error
  if (
    error instanceof JournalConflictError ||
    (error instanceof RecordConflictError && !legacy)
  )
    return refusalWithConflict(
      unsettledRefusal(rollbackContext, phase, reported),
      error,
    )
  return error
}

/**
 * Words the leftover that an {@link unmatchedJournalRefusal} names beside both records; called only by that refusal.
 * The leftover's own sentence is kept when it advises no move: its text names both files ({@link namesBothFiles}), the copy was handed over, or its change had finished. A leftover of a change in progress gets its own sentence instead of {@link leftCopyRefusal}'s general advice, which also covers an empty config path: the config that stands may hold settings that file never had (the published inode reused for another config), so copying the file over the config would lose them.
 * @param context - The run; its config path is named, and the rollback's journal context words the leftover's own sentence ({@link rollbackContextOf}).
 * @param legacy - The journal and the first leftover its recovery could not settle, if any.
 * @returns The sentence with a leading space; empty when no leftover stays.
 * @example
 * unmatchedLeftoverSentence(context, legacy) // => ' Codebook also kept a private file at …/mcp_config.json.<generation>.tmp that it could not settle; look at both that file and …/mcp_config.json before you use either, and never copy that file over the config.'
 * unmatchedLeftoverSentence(context, undefined) // => ''
 */
function unmatchedLeftoverSentence(
  context: Context,
  legacy: LegacyJournalEvidence | undefined,
): string {
  if (!legacy?.reported) return ''
  const { journal, reported } = legacy
  const phase = leftoverPhaseOf(journal)
  // These sentences advise no move: what stays is said as it is.
  if (namesBothFiles(reported.cause) || reported.isHandedOver || phase)
    return ` ${unsettledRefusal(rollbackContextOf(context), phase, reported).message}`
  return ` Codebook also kept a private file at ${reported.leftover.path} that it could not settle; look at both that file and ${context.path} before you use either, and never copy that file over the config.`
}

/**
 * Records in this config's publish record that its entry must be taken back; called by {@link settleRollbackJournal} before it retires the journal that proves the rollback was cut short, so a run that fails later still finds the intent (a first setup's own take-back marks through {@link markBeforeTakeBack}, which rests on the version that run wrote instead).
 * Only the publish of the given generation is marked: another installation's pending publish stays as it is. The mark replaces only the version of the record this call read ({@link writeTakeBackMark}): a record a backup or sync tool put at that name meanwhile stays, one it moved away is not written back at the empty name, and the run stops.
 * That write empties the record's name for a moment ({@link replaceThroughDroppingName}), and Codebook 0.2.142.0, 0.2.143.0 and 0.2.144.0 retire a rollback journal of this config that stands beside an empty `pending.json` without marking anything; so the journal keeps a second name at its dropping name, named by its dropping note, while the mark is written ({@link whileJournalHeld}), and a stop inside that write followed by such a version's run leaves the journal there, which the next run of this build proves and puts back before it reads either record ({@link settleDroppedRecord}), so it marks the setup record and takes the failed setup back instead of adopting it.
 * Limit: where the storage gives no file a second name the journal has none, and such a version's run in that moment retires it.
 * @param context - The run.
 * @param journal - The rollback journal's context as {@link settleRollbackJournal} settles it, tracking the version it read ({@link Context.journalVersion}).
 * @param publishGeneration - The generation of the publish being rolled back. A journal of an older build names none: it marks only when {@link legacyBelonging} finds that it belongs to the publish record.
 * @param legacy - Only for a journal of an older build: the journal (its displaced file's inode and hash), the config its recovery put back and the first leftover it could not settle.
 * @returns
 * - The decision ({@link PublishDecision}): the belonging it decided ({@link JournalBelonging}), `belongs` once the mark is written, with the version of that mark, `another` or `another-config` when nothing is marked ({@link settleRollbackJournal} holds the journal on `another-config`), with the version of the record it was decided on; `another` also for a record of another config
 * - `belongs` with the version this call read as the mark's ({@link PublishDecision.markVersion}) when the record carries the mark already (an earlier run wrote it and stopped before its journal went), so that journal too ends only while the record's name still shows that mark; nothing is written then
 * - undefined when the publish record's name is empty
 * @throws The {@link unmatchedJournalRefusal} when an older build's journal cannot be matched to the publish record, or cannot be matched yet because the restored config could not be read or is no valid JSON config yet, its `record-reread` sentence when the record's name no longer shows the version this call read as the mark is written, and its `record-gone` sentence when that name is found empty then ({@link publishRecordConflict}); nothing is written then. What reading or writing the record throws otherwise.
 * @example
 * await markTakeBackOwed(context, rollbackContext, generation) // => { belonging: 'belongs', publishVersion: { ino: 42n, sha256: 'ab…' }, markVersion: { ino: 43n, sha256: 'cd…' } }; pending.json now holds takeBack: true
 */
async function markTakeBackOwed(
  context: Context,
  journal: Context,
  publishGeneration: string | undefined,
  legacy?: LegacyJournalEvidence,
): Promise<PublishDecision | undefined> {
  const read = await readVersionedRecord(
    context.pendingPath,
    pendingSchema,
    context.retry,
    context.seam,
  )
  // No publish record: nothing to mark, and the journal ends only while that name is still empty ({@link markLeftCheck}).
  if (!read) return undefined
  const { record: publish, version } = read
  // A record of another config is another publish's: nothing to mark, and the journal ends only while that name still shows it.
  if (publish.targetPath !== context.path)
    return { belonging: 'another', publishVersion: version }
  // An earlier run wrote the mark and stopped before its journal went: that mark stands as read, so the journal ends only while the record's name still shows this version ({@link markLeftCheck}).
  if (publish.takeBack)
    return {
      belonging: 'belongs',
      publishVersion: version,
      markVersion: version,
    }
  // A journal of this build names the publish it rolled back (another generation is another installation's publish); one of an older build names none, so its displaced file and the restored config decide.
  const belonging: JournalBelonging =
    publishGeneration === undefined
      ? legacyBelonging(legacy?.journal, publish, legacy?.restoredBytes)
      : publish.generation === publishGeneration
        ? 'belongs'
        : 'another'
  const decision: PublishDecision = { belonging, publishVersion: version }
  if (belonging === 'another' || belonging === 'another-config') return decision
  // Contradicting, unread or half-saved evidence keeps both records: the learner or the next run decides.
  if (belonging !== 'belongs')
    throw unmatchedJournalRefusal(context, belonging, legacy)
  // The mark replaces only the version this decision read: a record another program put at that name meanwhile stays, one it moved away is not written back, and the run stops. The journal keeps a second name while that write runs.
  const markVersion = await whileJournalHeld(journal, () =>
    writeTakeBackMark(context, read),
  ).catch((error: unknown) => {
    throw publishRecordConflict(context, legacy, error)
  })
  return { ...decision, markVersion }
}

/**
 * Runs a step while a rollback journal also stands at its dropping name ({@link holdJournal}), and drops that second name again once the step ended, while it is still only a second name of the journal ({@link dropTrackedSecondName}); called by {@link markTakeBackOwed} around the take-back mark's write, whose move empties the setup record's name for a moment.
 * The journal's dropping note names the version this run settled before the hold links it, and goes once the dropping name is empty again ({@link withDroppingNote}). Codebook 0.2.142.0, 0.2.143.0 and 0.2.144.0 know neither name: a run of theirs after a stop inside that step retires the journal at its own name and leaves the hold and the note, so the next run of this build proves the held file and puts it back at the journal's empty name before it reads either record ({@link putNotedRecordBack}); after a stop without such a run the hold is only a second name of the journal, which that run drops ({@link settleDroppedRecord}).
 * Limit: where the storage gives no file a second name no hold stands, and such a run retires the journal.
 * @param journal - The rollback journal's context, tracking the version this run settled ({@link Context.journalVersion}).
 * @param step - The step that runs while the journal is held.
 * @returns What `step` returns.
 * @throws What `step` throws, once the hold went (or stayed, when it is no longer a second name of the journal; the journal's retirement then names both names).
 * @example
 * await whileJournalHeld(rollbackContext, () => writeTakeBackMark(context, read)) // => { ino: 43n, sha256: 'cd…' }; '…/pending.json.rollback.codebook-dropping' and its note are gone again
 */
async function whileJournalHeld<Result>(
  journal: Context,
  step: () => Promise<Result>,
): Promise<Result> {
  const settled = journal.journalVersion?.current
  // No version is tracked: there is nothing to hold.
  if (settled === undefined) return step()
  return withDroppingNote(journal, { moved: settled }, async () => {
    const heldIno = await holdJournal(journal, settled)
    try {
      return await step()
    } finally {
      // The hold goes only while it is still a second name of the journal's file.
      if (heldIno !== undefined) await dropTrackedSecondName(journal, heldIno)
    }
  })
}

/**
 * Gives a rollback journal a second name at its dropping name with a link, which never replaces a file, so the file that proves a take-back survives a run of an older version that deletes the journal at its own name; called only by {@link whileJournalHeld}, once the journal's dropping note names that version.
 * @param journal - The rollback journal's context.
 * @param settled - The version this run settled ({@link Context.journalVersion}), which the note names.
 * @returns The journal's inode once its dropping name shows that version; undefined when no hold stands: the link failed (storage without hard links, a file at the dropping name, an empty journal name, or another failure), or it reached another file than that version, whose second name goes again ({@link dropTrackedSecondName}).
 * @example
 * await holdJournal(rollbackContext, { ino: 43n, sha256: 'cd…' }) // => 43n; '…/pending.json.rollback.codebook-dropping' is another name of the journal's file
 */
async function holdJournal(
  journal: Context,
  settled: RecordVersion,
): Promise<bigint | undefined> {
  const droppingPath = droppingPathOf(journal)
  const isLinked = await link(journal.pendingPath, droppingPath).then(
    () => true,
    () => false,
  )
  if (!isLinked) return undefined
  const held = await lstatOrAbsent(droppingPath).catch(() => undefined)
  if (held?.ino === settled.ino) return settled.ino
  // The link reached another file than the version this run settled: that second name holds nothing of this run, and goes again.
  if (held) await dropTrackedSecondName(journal, held.ino)
  return undefined
}

/**
 * Writes the take-back mark over the one version of the publish record a caller read, and over nothing else; called by {@link markTakeBackOwed} and {@link markBeforeTakeBack}, so neither writes a mark over a record a backup or sync tool put at `pending.json` after that read, nor back at a name it emptied.
 * The write tracks that version and refuses an empty name ({@link Context.journalVersion}, `refusesEmptyName`), so it goes through only while the name still shows that version ({@link writeTrackedJournal}). The mark is that record with `takeBack: true` and every other field as read, so a shape older builds refuse stays in it ({@link LinkedRecord}).
 * @param context - The run; its pending path is the publish record.
 * @param read - The record and the version of it the caller read ({@link readVersionedRecord}).
 * @returns The version of the mark this call wrote: the inode of the file it wrote and the hash of its bytes ({@link stageRecord}).
 * @throws A {@link JournalConflictError} when the name no longer shows that version (`changed`), shows nothing (`gone`) or cannot be read again (`unread`), before the rename or right after it; what staging or renaming the mark throws otherwise (a full disk). Nothing is written then, unless another program changed the name right after the rename.
 * @example
 * await writeTakeBackMark(context, { record: publish, version: { ino: 42n, sha256: 'ab…' } }) // => { ino: 43n, sha256: 'cd…' }; pending.json now holds { ...publish, takeBack: true }
 */
async function writeTakeBackMark(
  context: Context,
  { record, version }: { record: Pending; version: RecordVersion },
): Promise<RecordVersion> {
  const markTracker: { current: RecordVersion; refusesEmptyName: true } = {
    current: version,
    refusesEmptyName: true,
  }
  const mark: Pending = { ...record, takeBack: true }
  // The write moves the tracked version to the mark it published ({@link writeRecord}).
  await writeRecord(
    { ...context, journalVersion: markTracker },
    context.pendingPath,
    mark,
  )
  return markTracker.current
}

/** What {@link markTakeBackOwed} decided on one read of the publish record: how the rollback journal relates to it, and the version of the record it read ({@link RecordVersion}), which a held journal binds the rest of its run to ({@link heldPublishContext}) and a journal retired on this decision must still find at that name when nothing is marked ({@link markLeftCheck}). */
type PublishDecision = {
  belonging: JournalBelonging
  publishVersion: RecordVersion
  /** The version of the take-back mark that stands: the one this call wrote ({@link writeTakeBackMark}), or the one it read when the record carried the mark already (an earlier run wrote it and stopped before its journal went); undefined when nothing is marked. The journal that proves that take-back is ended only while the record's name still shows it ({@link markLeftCheck}). */
  markVersion?: RecordVersion
}

/**
 * Gives the synchronous look that must still find at the publish record's name what the decision on the rollback journal left there, right before that journal is ended: the take-back mark this run wrote, or found as an earlier run left it ({@link PublishDecision.markVersion}), else the record the decision read, or the empty name it found; called by {@link settleRollbackJournal}, so a setup record a backup puts back without that mark, or where the decision found another setup's record or none, keeps the journal, and the next run decides on both again instead of adopting that record.
 * @param context - The run; its pending path is the publish record.
 * @param decision - What {@link markTakeBackOwed} decided; undefined when it found the name empty.
 * @param legacy - The journal's evidence, which the refusal names; undefined for a journal of this build.
 * @returns The look {@link publishLeftCheck} gives once its own look found the mark ({@link PublishDecision.markVersion}), the record the decision read when nothing was marked ({@link PublishDecision.publishVersion}), or an empty name when the decision found none.
 * @throws What {@link publishLeftCheck} throws: the `record-reread`, `record-gone` or `record-unread` {@link unmatchedJournalRefusal} when the name no longer shows that or cannot be read again; nothing is retired then.
 * @example
 * await retirePending(rollbackContext, retained, await markLeftCheck(context, decision, legacy)) // throws, keeping both records, once a backup put the unmarked record back
 */
async function markLeftCheck(
  context: Context,
  decision: PublishDecision | undefined,
  legacy: LegacyJournalEvidence | undefined,
): Promise<StillLook> {
  return publishLeftCheck(
    {
      ...context,
      journalVersion: {
        current: decision?.markVersion ?? decision?.publishVersion,
        refusesEmptyName: true,
      },
    },
    legacy,
  )
}

/**
 * Tells whether a publish record is a first setup's: it carries the `firstSetup` flag, or an entry hash with the {@link FIRST_SETUP_HASH_PREFIX}, which an older build's rewrite of the record keeps when it drops the flag; called by {@link isTakeBackOwed}.
 * @param pending - The publish record.
 * @returns `true` for either mark; `false` for an update's, a removal's or an older build's record.
 * @example
 * isFirstSetupRecord({ ...pending, firstSetup: true })                 // => true
 * isFirstSetupRecord({ ...pending, entrySha256: 'first-setup:9f86d081' }) // => true
 * isFirstSetupRecord({ ...pending, entrySha256: '9f86d081' })             // => false
 */
function isFirstSetupRecord(pending: Pending): boolean {
  return (
    pending.firstSetup === true ||
    pending.entrySha256?.startsWith(FIRST_SETUP_HASH_PREFIX) === true
  )
}

/**
 * Tells whether the entry a publish record covers must be taken back instead of adopted; called by {@link inspect} and {@link settlePending}.
 * @param pending - The publish record.
 * @param receipt - The receipt that stands, if any.
 * @returns `true` when the record is marked `takeBack`, or is a first setup's ({@link isFirstSetupRecord}) whose own receipt (same generation) was never written.
 * @example
 * isTakeBackOwed({ ...pending, firstSetup: true }, undefined) // => true
 */
function isTakeBackOwed(
  pending: Pending,
  receipt: Receipt | undefined,
): boolean {
  if (pending.takeBack) return true
  return (
    isFirstSetupRecord(pending) &&
    (receipt === undefined || receipt.generation !== pending.generation)
  )
}

/**
 * Tells whether the receipt that stands is the one a publish record's own setup wrote, so the take-back that record asks for is not owed ({@link finishCutShortSetup}); an adoption's receipt ({@link Receipt.adopted}) never is, because it rests on the entry's hash alone, so a record of that setup that asks for its take-back, also one that came back after the adoption or beside a receipt the adoption could not take back out ({@link withdrawAdoptedReceipt}), still gets it.
 * @param pending - The publish record.
 * @param receipt - The receipt that stands, if any.
 * @returns `true` for a receipt of the record's generation without the adoption's mark (also, as before, no receipt beside a record that names no generation); `false` for another generation's receipt, no receipt beside a record with a generation, and an adopted receipt.
 * @example
 * isTakeBackCovered({ ...pending, generation: 'g1' }, { ...receipt, generation: 'g1' })                // => true
 * isTakeBackCovered({ ...pending, generation: 'g1' }, { ...receipt, generation: 'g1', adopted: true }) // => false
 */
function isTakeBackCovered(
  pending: Pending,
  receipt: Receipt | undefined,
): boolean {
  return receipt?.generation === pending.generation && receipt?.adopted !== true
}

/**
 * Deletes an adopted receipt of the setup whose entry a take-back just took out ({@link finishCutShortSetup}), only while `receipt.json` still shows the version this run read and the entry is still out of the config ({@link removalConfigStill}, {@link dropReceipt}), so no receipt of that setup stays beside no entry and no restored entry is left unmanaged; any other receipt stays as read.
 * @param context - The run; its receipt version is the one its decisions rest on ({@link settleAfterRecovery}).
 * @param pending - The setup's publish record.
 * @param receipt - The receipt that stood; of the record's generation only when an adoption wrote it ({@link isTakeBackCovered}).
 * @returns
 * - undefined once that adopted receipt is gone
 * - `receipt` itself otherwise: another generation's receipt, none, or an adopted one that stays (another file at its name, or a delete that failed)
 * @throws The {@link RemovalEntryBackError} when the entry the take-back removed is back, or the config changed again, before the receipt's delete; the setup's record is not retired then.
 * @example
 * await dropAdoptedReceiptOf(run, pending, adoptedReceipt) // => undefined; receipt.json is gone
 */
async function dropAdoptedReceiptOf(
  context: Context,
  pending: Pending,
  receipt: Receipt | undefined,
): Promise<Receipt | undefined> {
  // Only a receipt of the setup taken back goes.
  if (receipt === undefined || receipt.generation !== pending.generation)
    return receipt
  // The entry must still be out when the receipt is deleted; a backup restore otherwise leaves that entry unmanaged once the setup's record ends.
  const configStill = await removalConfigStill(context, receipt)
  const answer = await dropReceipt(context, configStill).catch(
    (error: unknown) => {
      // Entry-back and config-continuity failures are proof failures of the withdrawal itself: they stop the setup record's retirement.
      if (error instanceof RemovalEntryBackError) throw error
      return 'kept' as const
    },
  )
  return answer === 'gone' ? undefined : receipt
}

/**
 * Returns the config digest a recovering take-back must see again. A plain-hash
 * legacy record accepts appended line breaks only on the exact bytes it staged.
 * @example
 * takeBackConfigHash(pending, look) // the full current digest after a verified legacy append
 */
function takeBackConfigHash(
  pending: Pending,
  look: Extract<ConfigLook, { kind: 'present' }>,
): string | undefined {
  const { stagedSha256 } = pending
  if (
    stagedSha256 !== undefined &&
    stagedSha256 === look.sha256BeforeExtraLineBreaks &&
    !isFirstSetupRecord(pending)
  )
    return look.sha256
  return stagedSha256
}

/**
 * Finishes the take-back of a first setup whose rollback was cut short; called by {@link inspect} after {@link settleRollbackJournal} put the published config back.
 * That config holds the entry the failed setup published, and its receipt was never written, so the publish record is not adopted: the entry is taken out again with the rollback's own steps and checks ({@link rollBackPublishedEntry}) and the setup's record is retired. A config with no matching publish record, one a receipt of the same generation that setup wrote itself covers ({@link isTakeBackCovered}), or a record marked {@link Pending.notLinked} (that publish linked nothing), is not concerned. A receipt of the same generation that an adoption wrote ({@link Receipt.adopted}) covers nothing: the entry is taken back all the same, and that receipt goes with it, before the record ends, while `receipt.json` still shows the version this run read and the entry is still out of the config ({@link dropAdoptedReceiptOf}).
 * Limit: an adopted receipt that cannot go then (another file at its name, a delete that fails) stays beside no entry, as a removal's receipt that it left does, and the next setup or removal settles it.
 * @param context - The run.
 * @param pending - The setup's pending record.
 * @param receipt - The receipt that stands, if any.
 * @param retained - What stays of the setup's record after recovery ({@link retainedRecord}).
 * @param look - The config as it stands.
 * @param emptiedRetiredPath - The old record's private name that this run's put-back found empty ({@link settleRetiredReceipt}); the record ends only while that name is still empty ({@link retirePending}). Undefined otherwise.
 * @returns The config as it looks after the entry was taken out, what the take-back removed (`removal`: the file or only the entry) and the receipt that stands after it (`receipt`: undefined once an adopted receipt of that setup went); undefined when nothing was taken back (the record is then settled as before).
 * @throws A refusal when the entry could not be taken out again; nothing else is changed then. A {@link RecordConflictError} when the setup's record no longer stands at its name as this run read it right before the take-back would move the config ({@link assertTakeBackRecordStill}); the config is unchanged then. The {@link RemovalEntryBackError} when the entry is back, or the config changed again, before the adopted receipt's delete; the receipt and the setup's record stay then. What {@link retirePending} throws after the take-back.
 * @example
 * const afterTakeBack = await finishCutShortSetup(context, pending, receipt, retained, look)
 */
async function finishCutShortSetup(
  context: Context,
  pending: Pending,
  receipt: Receipt | undefined,
  retained: Pending | undefined,
  look: ConfigLook,
  emptiedRetiredPath?: string,
): Promise<
  | {
      look: ConfigLook
      removal?: 'file-removed' | 'removed'
      receipt: Receipt | undefined
    }
  | undefined
> {
  const { stagedIno } = pending
  // A first setup's record carries the prefix; the entry and the receipt the rollback checks against hash plainly.
  const entrySha256 = plainEntryHashOf(pending.entrySha256)
  // A publish that linked nothing published no entry: the one that stands is never taken out, whatever inode the config shows.
  if (
    pending.notLinked === true ||
    look.kind !== 'present' ||
    pending.targetPath !== context.path ||
    entrySha256 === undefined ||
    stagedIno === undefined ||
    isTakeBackCovered(pending, receipt) ||
    coreHashOf(currentEntryOf(look)) !== entrySha256
  )
    return undefined
  const written: Receipt = {
    schemaVersion: 1,
    targetPath: context.path,
    entrySha256,
    createdFile: pending.createdFile,
    installed: true,
    generation: pending.generation ?? randomUUID(),
    installationId: pending.installationId ?? randomUUID(),
    config: { ino: stagedIno },
  }
  let result: RollbackResult = { outcome: 'not-taken-out', keptLeft: [] }
  try {
    result = await rollBackPublishedEntry(
      context,
      written,
      takeBackConfigHash(pending, look),
    )
  } catch (error) {
    // The record this take-back rests on changed or disappeared before the config moved: nothing changed, and the run goes no further.
    if (error instanceof RecordConflictError) throw error
    // A refusal after the entry was confirmed as Codebook's own: the message below says it may still stand.
  }
  const { outcome, keptLeft } = result
  // The config was saved again or is not Codebook's to touch: the record is settled as before.
  if (outcome === 'replaced-config' || outcome === 'not-ours') return undefined
  if (outcome !== 'took-out')
    throw new Error(
      `A setup of Codebook that ended early left its "${SERVER_NAME}" entry in ${context.path}, ${rollbackOutcomeClause(outcome, context)}; ${context.retry}.${keptCopiesSentence(keptLeft)}`,
    )
  // An adopted receipt of this setup goes with its entry only while the entry stays out, and before any kept copy is reported: a backup or sync tool that put the entry back meanwhile refuses here, so the take-back never says the entry is out when it is not.
  const receiptLeft = await dropAdoptedReceiptOf(context, pending, receipt)
  if (keptLeft.length > 0)
    throw new Error(
      `A setup of Codebook that ended early left its "${SERVER_NAME}" entry in ${context.path}, ${rollbackOutcomeClause(outcome, context)}; ${context.retry}.${keptCopiesSentence(keptLeft)}`,
    )
  await retirePending(
    context,
    retained,
    await retiredNameCheck(context, emptiedRetiredPath),
  )
  return {
    look: await lookAtConfig(context),
    removal: result.removal,
    receipt: receiptLeft,
  }
}

/**
 * Makes the rest of a run track the version of `pending.json` it read ({@link Context.journalVersion}), so recovery, the take-back and the record's settlement rewrite or delete only that version, never a record a backup or sync tool put at that name meanwhile, and never write it back at a name such a tool emptied; called by {@link inspect} right after its read, on what {@link heldPublishContext} gives.
 * @param context - The run, as {@link heldPublishContext} gave it.
 * @param version - The version of `pending.json` that {@link inspect}'s read saw; undefined when the name was empty.
 * @returns
 * - `context` itself when it tracks that record already (a held run) or no record was read
 * - the run tracking that version, refusing an empty name (`refusesEmptyName`), otherwise
 * @example
 * trackedPublishContext(context, read?.version).journalVersion // => { current: { ino: 42n, sha256: 'ab…' }, refusesEmptyName: true }
 */
function trackedPublishContext(
  context: Context,
  version: RecordVersion | undefined,
): Context {
  if (context.journalVersion || !version) return context
  return {
    ...context,
    journalVersion: { current: version, refusesEmptyName: true },
  }
}

/** What a run decides on after {@link inspect}: the look at the config, its `codebook` entry and the receipt that stands. */
type Inspection = {
  look: ConfigLook
  current: unknown
  receipt: Receipt | undefined
  /** Set when this run's take-back of an interrupted first setup removed the entry (or the file Codebook created): the removal answers it instead of `not-managed`. */
  tookBack?: 'file-removed' | 'removed'
  /** The version of `pending.json` this run read or last wrote and left standing ({@link Context.journalVersion}); undefined when the run found that name empty or emptied it itself. The rest of the run writes and deletes its own record only from that version on ({@link ownRecordContext}). */
  pendingVersion?: RecordVersion
  /** Set when the record this run read and left standing is that of a removal of this config that took the entry out and never recorded its completion ({@link isUnrecordedRemoval}): the removal retry ends it and reports the entry removed. Judged on the record this inspection itself processed, never on an earlier separate read, so a record a backup or sync tool put at that name after the run started is the one the retry answers for. */
  unrecordedRemoval?: boolean
  /** The unrecorded removal's record as this inspection read it, kept so the retry can put its proof back when the removal outcome is refused before the point of no return ({@link removeManagedDevinMcpEntry}). */
  unrecordedRemovalRecord?: Pending
}

/**
 * Settles a kept copy and a pending record, reads the config and returns what a run decides on.
 * Every leftover is settled on its own; an entry an interrupted run published is adopted even when a leftover cannot be settled, and the record keeps only the leftovers that stay. A leftover that stays is named in a refusal after that; a refusal of the steps after recovery names it too when it was handed over in this run or its own text names both files ({@link mergeWithLeftover}). A record that recovery could no longer confirm as it acted on a copy on its word ({@link recoveryConflictOf}) ends the run right after recovery, with that record's sentence and then the copy's, before anything is written, adopted or taken back.
 * @param context - The run.
 * @returns The {@link Inspection}.
 * @throws What {@link recoverLeftovers} and {@link settleAfterRecovery} throw, a refusal naming the first leftover that could not be settled, and what {@link readPublishRecord} and {@link heldPublishContext} throw for a publish record that is gone or is no longer the one a held legacy journal was decided on.
 * @example
 * const { look, current, receipt } = await inspect(context)
 */
async function inspect(context: Context): Promise<Inspection> {
  // A rollback cut short comes first: its original may be the only copy of the learner's other servers. A legacy journal decided as another publish's is held until the publish record is settled; an adoption rests on what settlement left at the journal's name.
  const { held, otherVersion } = await settleRollbackJournal(context)
  const read = await readPublishRecord(context, held)
  // A held journal was decided on one read of the publish record: the run goes on only with that version, and every later write or delete of it checks its name; so does every other run that read a record.
  const run = trackedPublishContext(
    heldPublishContext(context, held, read?.version),
    read?.version,
  )
  const pending = read?.record
  // Looked at before recovery drops a staged name that is a second name of the config: both names showing the staged inode prove a first setup's link.
  const isStagedLinked = await isStagedNameLinked(run, pending)
  // A copy an interrupted run kept comes back, or is deleted, or stays and is named, before the config is read.
  const unsettled = await recoverOwnLeftovers(run, pending)
  // An unverified put-back's handed record is read as the change in progress it is.
  const phase = pending && leftoverPhaseOf(pending)
  // A record recovery could no longer confirm ends the run before anything is written, adopted or taken back: that name and the copy stay as they are, and the next run reads that name first.
  const conflict = recoveryConflictOf(unsettled)
  if (conflict)
    throw mergeWithLeftover(
      run,
      recordRefusalOf(run, held, conflict.cause),
      phase,
      conflict,
      false,
    )
  // A finished or handed change names its leftover once: the one reported is no longer tracked, unless its published config could not be proven and the copy may be the learner's last one ({@link Unsettled.staysTracked}). A copy handed over in this run keeps the record, now handed, so no later run deletes it.
  const isHandedNow = unsettled.some(({ isHandedOver }) => isHandedOver)
  // Written at once, before the config is read: a refusal of the steps below must not leave the handed copy deletable. A write that failed is said in the refusal, which then promises no handover.
  const isHandoverUnrecorded = Boolean(
    pending && isHandedNow && !(await persistHandover(run, pending, unsettled)),
  )
  const [first] = unsettled
  const reported = first && {
    ...first,
    ...(isHandoverUnrecorded && { isHandoverUnrecorded }),
  }
  const retained =
    pending &&
    retainedRecord(
      await recordAfterRecovery(run, pending, unsettled, isHandedNow),
      unsettled,
      phase,
    )
  const inspection = await settleAfterRecovery(
    run,
    pending,
    retained,
    held,
    isStagedLinked,
    otherVersion,
  ).catch((cause: unknown) => {
    throw mergeWithLeftover(run, cause, phase, reported, isHandedNow)
  })
  if (pending && reported) throw unsettledRefusal(run, phase, reported)
  // Judged on the record this inspection itself read, only while that record still stands (a record this run retired itself answers for nothing): the removal retry ends exactly the unrecorded removal this inspection left for it, never one an earlier separate read found where a backup or sync tool put another record meanwhile.
  const isRemovalUnrecorded =
    pending !== undefined &&
    run.journalVersion?.current !== undefined &&
    isUnrecordedRemoval(run, pending)
  // The rest of the run writes and deletes its own record only from the version this run left at that name ({@link ownRecordContext}).
  return {
    ...inspection,
    pendingVersion: run.journalVersion?.current,
    unrecordedRemoval: isRemovalUnrecorded,
    unrecordedRemovalRecord: isRemovalUnrecorded ? pending : undefined,
  }
}

/**
 * Makes the rest of a locked run track its own `pending.json` from the version {@link inspect} left at that name ({@link Inspection.pendingVersion}), so the setup's publish, the removal and the removal retry write that record only while its name shows the version this run read or last wrote, claim a name only while no version is known there ({@link claimJournal}) instead of writing over what another program put there, and delete it only as the version they last wrote ({@link dropTrackedJournal}); a record a backup or sync tool puts at that name meanwhile stays for the next run. Called by {@link writeManagedDevinMcpEntry}, {@link refreshManagedDevinMcpEntry} and {@link removeManagedDevinMcpEntry} right after {@link inspect}.
 * As for the record a decision read ({@link trackedPublishContext}), a name found empty while this run knows a version there (the one inspect left, or the one it last wrote) is another program's move and is refused (`refusesEmptyName`): a backup that moves the record away may put an older config back at the same moment, so writing that record again there would let a removal report its entry removed and delete its receipt while the config holds that entry again. The completed record's write then answers a `gone` conflict ({@link markCompleted}): a setup or refresh writes its receipt only while the config is still the file it published with its entry ({@link settleRecordConflict}), and the removal keeps its receipt and names that record ({@link unrecordedRemovalRefusal}).
 * @param context - The locked run.
 * @param inspection - What {@link inspect} returned; only its {@link Inspection.pendingVersion} is used.
 * @returns The run tracking its own record and refusing an emptied name.
 * @example
 * ownRecordContext(context, await inspect(context)).journalVersion // => { current: undefined, refusesEmptyName: true } once inspect retired the record it read
 */
function ownRecordContext(
  context: Context,
  { pendingVersion }: Pick<Inspection, 'pendingVersion'>,
): Context {
  return {
    ...context,
    journalVersion: { current: pendingVersion, refusesEmptyName: true },
  }
}

/**
 * Gives the record a recovery keeps, before {@link retainedRecord} cuts it to the leftovers that stay; called by {@link inspect} for `pending.json` and by {@link settleRollbackJournal} for a rollback's journal.
 * @param context - The run whose config the record covers.
 * @param pending - The record as read.
 * @param unsettled - The leftovers recovery could not settle.
 * @param isHandedNow - Whether a copy was handed to the learner in this run.
 * @returns
 * - The handed record ({@link handedRecordOf}) when a copy was handed over in this run
 * - The record handed and unverified ({@link Pending.bytesUnverified}) while its displaced name stays a second name of the config that no check cleared ({@link isUnverifiedSecondName}), also when this run's put-back wrote that mark: an older build then never deletes that name by the shared inode alone, and this build checks the bytes again
 * - Otherwise the record in the phase recovery reads it ({@link leftoverPhaseOf}), without the mark: a displaced file that is no second name of the config leaves an older build nothing to delete by its inode, and an older build would read an empty config name under a handed record as handed over
 * @example
 * retainedRecord(await recordAfterRecovery(context, pending, unsettled, false), unsettled, leftoverPhaseOf(pending))
 */
async function recordAfterRecovery(
  context: Context,
  pending: Pending,
  unsettled: Unsettled[],
  isHandedNow: boolean,
): Promise<Pending> {
  if (isHandedNow) return handedRecordOf(pending, unsettled)
  const phase = leftoverPhaseOf(pending)
  // A record names at most one displaced file ({@link journalLeftovers}).
  const kept = unsettled.find(({ leftover }) => leftover.role === 'kept')
  const isUnverified =
    phase === undefined &&
    kept !== undefined &&
    (await isUnverifiedSecondName(context, kept.leftover))
  return isUnverified
    ? { ...pending, phase: 'handed', bytesUnverified: true }
    : { ...pending, phase, bytesUnverified: undefined }
}

/**
 * Gives the record a copy handed to the learner in this run leaves: the whole record as read, now handed and no longer unverified ({@link Pending.bytesUnverified}), so no later run of any build deletes the copy; used by {@link recordAfterRecovery} and {@link persistHandover}.
 * The kept inode becomes the one the handed copy's name showed ({@link Unsettled.handedIno}): a copy that only its bytes proved has another inode than the recorded one, and a handed record with the recorded inode would make every later run refuse it as somebody else's file ({@link otherInodeRefusal}).
 * @param pending - The pending record as read.
 * @param unsettled - The leftovers recovery could not settle; the handed one names its copy's inode.
 * @returns The same record with `phase: 'handed'`, without `bytesUnverified`, and with the handed copy's inode as `keptIno`.
 * @example
 * handedRecordOf({ ...pending, keptIno: 41, bytesUnverified: true }, [{ leftover, cause, isHandedOver: true, handedIno: 42n }]) // => { ...pending, keptIno: 42, phase: 'handed', bytesUnverified: undefined }
 */
function handedRecordOf(pending: Pending, unsettled: Unsettled[]): Pending {
  const handedIno = unsettled.find(
    ({ handedIno }) => handedIno !== undefined,
  )?.handedIno
  return {
    ...pending,
    phase: 'handed',
    bytesUnverified: undefined,
    ...(handedIno !== undefined && { keptIno: recordedFileId(handedIno) }),
  }
}

/**
 * Writes the handed record ({@link handedRecordOf}) right after recovery handed a copy to the learner and before the config is read; called by {@link inspect}, so a refusal of a later step (a config that is no valid JSON, another entry) still leaves the copy recorded as handed.
 * @param context - The run.
 * @param pending - The pending record as read; the whole record is kept, only its phase (and the kept inode of a copy that only its bytes proved) changes.
 * @param unsettled - The leftovers recovery could not settle; the handed one names its copy's inode.
 * @returns `true` once the record is written; `false` when the write failed: the record then stays as it was, {@link settlePending} tries the record that stays again, and the refusal says that no record holds the handover ({@link Unsettled.isHandoverUnrecorded}).
 * @example
 * const isRecorded = await persistHandover(context, pending, unsettled)
 */
function persistHandover(
  context: Context,
  pending: Pending,
  unsettled: Unsettled[],
): Promise<boolean> {
  return writeRecord(
    context,
    context.pendingPath,
    handedRecordOf(pending, unsettled),
  ).then(
    () => true,
    () => false,
  )
}

/**
 * Words a conflict at the publish record's name as that record's refusal, never a rollback record's, unless the held journal's own name threw it: a held run's says so with both records ({@link publishRecordConflict}), any other run's as its own record's ({@link asRecordConflict}); called by {@link settleAfterRecovery} for its steps on that record, and by {@link inspect} when recovery's look at that record stopped it ({@link recoveryConflictOf}).
 * @param context - The run; its pending path is the publish record.
 * @param held - The legacy rollback journal {@link settleRollbackJournal} held; undefined when none is held.
 * @param error - What the step threw.
 * @returns The refusal to throw; `error` itself when it is no conflict at that record's name.
 * @example
 * throw recordRefusalOf(run, undefined, conflict) // 'While Codebook settled its record of an earlier change at …/pending.json, another program changed or replaced it …'
 */
function recordRefusalOf(
  context: Context,
  held: HeldJournal | undefined,
  error: unknown,
): unknown {
  return held
    ? publishRecordConflict(context, held.legacy, error)
    : asRecordConflict(error)
}

/**
 * Reads the config and the receipt once recovery settled the leftovers, finishes the take-back of a cut-short first setup and settles the pending record; called by {@link inspect}, which merges a refusal from here with a leftover that stays ({@link mergeWithLeftover}).
 * A stale receipt that a first setup moved aside is settled first ({@link settleRetiredReceipt}), so the receipt read here is the one that stands; the config is read after that settlement, so a config that a backup restored while the old receipt went back is the one this run decides on, with the receipt that stands by then. When that settlement found the old record's private name empty, the publish record that leads there ends only while that name is still empty right before ({@link retirePending}). A legacy rollback journal held as another publish's ({@link HeldJournal}) stands only while that look shows the bytes that decided it; the publish record is ended or rewritten only while the journal's name still shows the journal this run held, at a look right before that record's unlink or rename ({@link HeldJournal.lookStill}), so a journal a backup restores there meanwhile keeps the record it rests on (a run that holds no journal adopts that record only while the journal's name still shows what settlement left there, {@link journalLeftCheck}); and the journal is retired once the publish record is settled and that record's name shows what this run left there, also right before the journal's unlink ({@link retireHeldJournal}), so a refusal or failure before then leaves both records for the next run.
 * @param context - The run; it tracks its publish record while a journal is held ({@link heldPublishContext}).
 * @param pending - The pending record as it was read; undefined when there is none.
 * @param retained - What stays of that record after recovery ({@link retainedRecord}); undefined when nothing stays.
 * @param held - The legacy rollback journal {@link settleRollbackJournal} held; undefined when none is held.
 * @param isStagedLinked - What {@link isStagedNameLinked} found before recovery; it proves a first setup's link to {@link settleRetiredReceipt}.
 * @param otherJournalVersion - The version of another config's rollback journal that {@link settleRollbackJournal} read and left at that name ({@link SettledJournal.otherVersion}); undefined when it left that name empty or holds the journal. An adoption without a held journal rests on that name still showing it ({@link settlePending}).
 * @returns The {@link Inspection}.
 * @throws What {@link settleRetiredReceipt}, {@link lookAtConfig}, {@link assertHeldJournalStill}, {@link readReceiptWithVersion}, {@link finishCutShortSetup}, the held journal's look ({@link HeldJournal.lookStill}), {@link settlePending} and {@link retireHeldJournal} throw; the `receipt-unverified` refusal of {@link assertNotedReceipt} when the publish record notes that receipt.json is unverified and its read of that name found other bytes than the ones the note names, before anything is decided on that read; a conflict at a held run's publish record is worded as that record's ({@link publishRecordConflict}), one at the held journal's name as that journal's.
 * @example
 * const { look, current, receipt } = await settleAfterRecovery(context, pending, retained, held, false, undefined)
 */
async function settleAfterRecovery(
  context: Context,
  pending: Pending | undefined,
  retained: Pending | undefined,
  held: HeldJournal | undefined,
  isStagedLinked: boolean,
  otherJournalVersion: RecordVersion | undefined,
): Promise<Inspection> {
  const asPublishRefusal = (error: unknown): never => {
    throw recordRefusalOf(context, held, error)
  }
  // A later run's put-back of the old record looks at the publish record right before its link ({@link lookBeforePutBackLink}).
  const emptiedRetiredPath = await settleRetiredReceipt(
    context,
    pending,
    isStagedLinked,
  ).catch(asPublishRefusal)
  let look = await lookAtConfig(context)
  assertHeldJournalStill(context, held, look)
  // The receipt the run decides on: its later writes and deletes of that name act only on the version this read saw.
  const {
    receipt: stored,
    version: storedVersion,
    otherConfigPath,
  } = await readReceiptWithVersion(context).catch((cause: unknown) => {
    // A folder at the receipt name may hold the learner's files on an immediate retry.
    throw receiptFolderRefusal(context, cause) ?? cause
  })
  // This read itself passes the note that receipt.json is unverified: a look before it that found the name empty grants nothing to a file put there since.
  assertNotedReceipt(context, storedVersion)
  // The note is the publish record's as read, which this read settles: the run's own later writes and put-backs answer to the records they write.
  context.receiptVersion.unverifiedNote = undefined
  context.receiptVersion.current = storedVersion
  // A record of another config's entry occupies that name: no write or delete of this run touches it.
  context.receiptVersion.otherConfigPath = otherConfigPath
  // A setup whose rollback was cut short is taken back, never adopted (its receipt was never written).
  const afterTakeBack =
    pending && isTakeBackOwed(pending, stored)
      ? await finishCutShortSetup(
          context,
          pending,
          stored,
          retained,
          look,
          emptiedRetiredPath,
        )
      : undefined
  if (afterTakeBack) look = afterTakeBack.look
  const current = currentEntryOf(look)
  // A held journal must still stand as this run held it while the publish record it rests on ends: a journal a backup restores at that name meanwhile may need that record to take its setup back.
  const assertHeldStill = await held?.lookStill()
  // A held run takes nothing back (its look holds the decided bytes, which lack that record's entry), so the take-back above never writes that record.
  // After a take-back the run decides on the receipt that stands then: an adopted receipt of that setup went with its entry.
  const receipt = await settlePending(
    context,
    current,
    afterTakeBack ? afterTakeBack.receipt : stored,
    afterTakeBack ? undefined : pending,
    look,
    retained,
    emptiedRetiredPath,
    assertHeldStill,
    otherJournalVersion,
  ).catch(asPublishRefusal)
  // The publish record can no longer adopt: a held legacy journal goes now, while that record's name shows what this run left there.
  await retireHeldJournal(context, held)
  return {
    look,
    current,
    receipt,
    ...(afterTakeBack?.removal && { tookBack: afterTakeBack.removal }),
  }
}

/**
 * Joins a refusal of the steps after recovery with the leftover recovery could not settle, so the learner reads both in one message; called by {@link inspect} when {@link settleAfterRecovery} throws.
 * It applies to a copy handed over in this run and to a leftover whose own text names both files ({@link namesBothFiles}): a refusal about the config or its entry must not hide where that copy is or that the config changed while it was read. It also applies to a refusal about the publish record itself ({@link RecordConflictError}): the record that names the leftover changed or disappeared, so no later run may find that leftover through it; and to another file at a held legacy journal's name ({@link JournalConflictError}), which ends the run before the leftover's own refusal, as it does in {@link withJournalLeftover}.
 * @param context - The run.
 * @param cause - What {@link settleAfterRecovery} threw.
 * @param phase - The phase of the pending record.
 * @param reported - The first leftover that stays, if any.
 * @param isHandedNow - Whether a copy was handed to the learner in this run.
 * @returns
 * - One error whose message is the refusal's followed by the leftover's ({@link unsettledRefusal}), when such a leftover stays
 * - `cause` itself otherwise, or when it is no `Error`
 * @example
 * throw mergeWithLeftover(context, entryDiffers, undefined, reported, false) // => 'Codebook found a "codebook" entry that differs … The config at … changed just now …'
 */
function mergeWithLeftover(
  context: Context,
  cause: unknown,
  phase: Pending['phase'],
  reported: Unsettled | undefined,
  isHandedNow: boolean,
): unknown {
  if (!reported || !(cause instanceof Error)) return cause
  // Any other leftover stays in the record, which the failed step did not retire, and a later run names it; a record that changed or disappeared under the run may never lead there again, and a run stopped by another file at a rollback record's name (a held legacy journal's) names it now, as {@link withJournalLeftover} does.
  if (
    !isHandedNow &&
    !namesBothFiles(reported.cause) &&
    !(cause instanceof RecordConflictError) &&
    !(cause instanceof JournalConflictError)
  )
    return cause
  return new Error(
    `${cause.message} ${unsettledRefusal(context, phase, reported).message}`,
    { cause },
  )
}

/**
 * Runs one operation under the storage lock of the `devin-mcp` folder that every Codebook window of one Devin Desktop install shares, after the dropping names of its two tracked records are settled ({@link settleDroppedRecords}).
 * @param storageRoot - Codebook's global storage folder.
 * @param homeRoot - The home folder.
 * @param entry - The entry the run keeps; undefined for a removal.
 * @param seam - Test hook.
 * @param run - The operation.
 * @returns What `run` returns.
 * @example
 * await inLockedFolder(storageRoot, home, entry, undefined, (context) => inspect(context))
 */
function inLockedFolder<Result>(
  storageRoot: string,
  homeRoot: string,
  entry: DevinMcpEntry | undefined,
  seam: DevinMcpTestSeam | undefined,
  run: (context: Context) => Promise<Result>,
): Promise<Result> {
  const folder = join(storageRoot, 'devin-mcp')
  const context: Context = {
    path: devinMcpConfigPath(homeRoot),
    receiptPath: join(folder, 'receipt.json'),
    pendingPath: join(folder, 'pending.json'),
    entry,
    entryHash: coreHashOf(entry),
    seam,
    // A removal has no entry; its refusals name the removal command.
    retry: entry ? SET_UP_AGAIN : REMOVE_AGAIN,
    // Set by the run's read of the receipt; every context the run derives shares this one object.
    receiptVersion: { current: undefined },
  }
  return withStorageLock(folder, async () => {
    // A record a stopped rewrite or delete left at its dropping name goes back, or the run stops, before anything reads either record.
    await settleDroppedRecords(context)
    return run(context)
  })
}

/**
 * Adds or updates the one `codebook` entry in Devin Desktop's MCP config and keeps a receipt of it; called by Codebook: Set Up AI Chat in Devin Desktop.
 * Every other key and server stays as it is, and so does every key Devin manages in the codebook entry (`disabled`, `disabledTools`). An entry that the receipt does not cover, or that was edited since (any key but those two added or changed), is never replaced.
 * @param storageRoot - Codebook's global storage folder; holds `devin-mcp/receipt.json`.
 * @param entry - The server entry to keep.
 * @param homeRoot - The home folder; the real one unless a test names its own.
 * @param seam - Test hook, see {@link DevinMcpTestSeam}.
 * @returns `installed` for a new entry, `updated` for a replaced receipted one, `current` when nothing had to change; the config path; the generation of the entry now recorded, which {@link removeManagedDevinMcpEntry} takes to roll back only this write; `cleanupFailure` (plain sentences, one per file) naming each private copy that stays, that it holds the settings of the learner's other servers and that it can be deleted when no longer needed; and `disabled: true` when the entry left in the config has `"disabled": true`.
 * @throws A one-sentence refusal naming "Devin Desktop", the path and the way out, for invalid JSON, a member name that appears twice, a non-object top level or `mcpServers`, a number that would not survive a rewrite, a result beyond the size limit, an unreceipted or changed `codebook` entry, a file that changed during the run (a save that landed meanwhile stays in place), a kept copy that cannot be settled or a pending record of another entry; and, for a first setup whose receipt cannot be written, a sentence saying the entry it published was taken out again.
 * @example
 * await writeManagedDevinMcpEntry(storageRoot, { command: '/usr/bin/node', args: [bridge, agentFolder], env: {} })
 */
export async function writeManagedDevinMcpEntry(
  storageRoot: string,
  entry: DevinMcpEntry,
  homeRoot = homedir(),
  seam?: DevinMcpTestSeam,
): Promise<{
  status: 'installed' | 'updated' | 'current'
  path: string
  generation: string
  cleanupFailure?: string
  /** `true` when the `codebook` entry left in the config has `"disabled": true` (Devin's Customize switched it off); absent otherwise. */
  disabled?: true
}> {
  return inLockedFolder(storageRoot, homeRoot, entry, seam, async (context) => {
    const { path, entryHash, retry } = context
    const inspection = await inspect(context)
    const { look, current, receipt } = inspection
    // The publish writes and deletes its own record only from the version inspect left there, and never writes it again at a name another program emptied.
    const run = ownRecordContext(context, inspection)
    if (current === undefined) {
      const published = await publishEntry(run, look, receipt)
      return { status: 'installed', path, ...published }
    }
    if (!receipt)
      throw refusal(
        `a "${SERVER_NAME}" entry of your own`,
        path,
        'rename or remove that entry',
        retry,
      )
    if (!ownsEntry(current, receipt))
      throw refusal(
        `a "${SERVER_NAME}" entry that changed after Codebook wrote it`,
        path,
        'rename or remove that entry',
        retry,
      )
    const disabled = disabledFlagOf(current)
    if (receipt.entrySha256 === entryHash) {
      await withInstallationId(context, receipt)
      return {
        status: 'current',
        path,
        generation: receipt.generation,
        ...disabled,
      }
    }
    const published = await publishEntry(run, look, receipt)
    return { status: 'updated', path, ...published, ...disabled }
  })
}

/**
 * Brings a receipted entry up to date after the Node, bridge or agent folder changed; called on activation in Devin Desktop when setup is recorded.
 * Writes only when a receipt covers the current entry and it differs from `entry`; never creates a file or an entry; keeps every key Devin added to the entry.
 * @param storageRoot - Codebook's global storage folder.
 * @param entry - The server entry the entry should be.
 * @param homeRoot - The home folder; the real one unless a test names its own.
 * @param seam - Test hook, see {@link DevinMcpTestSeam}.
 * @returns `refreshed`, `current`, `not-managed` (no receipt, no file or no entry) or `changed` (the entry differs from the receipt; left alone); the config path; `cleanupFailure` when a private copy could not be deleted; and `disabled: true` when the entry left in the config has `"disabled": true` (not for `not-managed`).
 * @throws The refusals of {@link writeManagedDevinMcpEntry} for an unreadable config.
 * @example
 * await refreshManagedDevinMcpEntry(storageRoot, entry) // => { status: 'current', path }
 */
export async function refreshManagedDevinMcpEntry(
  storageRoot: string,
  entry: DevinMcpEntry,
  homeRoot = homedir(),
  seam?: DevinMcpTestSeam,
): Promise<{
  status: 'refreshed' | 'current' | 'not-managed' | 'changed'
  path: string
  cleanupFailure?: string
  /** `true` when the `codebook` entry left in the config has `"disabled": true` (Devin's Customize switched it off); absent otherwise. */
  disabled?: true
}> {
  return inLockedFolder(storageRoot, homeRoot, entry, seam, async (context) => {
    const { path, entryHash } = context
    const inspection = await inspect(context)
    const { look, current, receipt } = inspection
    if (!receipt || current === undefined)
      return { status: 'not-managed', path }
    const disabled = disabledFlagOf(current)
    if (!ownsEntry(current, receipt)) {
      // An edited entry stays as it is, but a receipt of an older build still gains its installation id (receipt-only rewrite).
      await withInstallationId(context, receipt)
      return { status: 'changed', path, ...disabled }
    }
    if (receipt.entrySha256 === entryHash) {
      // A receipt of an older build gains its installation id here; only the receipt is rewritten.
      await withInstallationId(context, receipt)
      return { status: 'current', path, ...disabled }
    }
    // The publish writes and deletes its own record only from the version inspect left there, and never writes it again at a name another program emptied.
    const published = await publishEntry(
      ownRecordContext(context, inspection),
      look,
      receipt,
    )
    return {
      status: 'refreshed',
      path,
      ...disabled,
      ...(published.cleanupFailure && {
        cleanupFailure: published.cleanupFailure,
      }),
    }
  })
}

/** What the removal decides before it changes anything ({@link removalOwnership}): a status that ends it, or the present config and the receipt that owns its `codebook` entry. */
type RemovalOwnership =
  | { status: 'superseded' | 'not-managed' | 'changed' }
  | { look: Extract<ConfigLook, { kind: 'present' }>; receipt: Receipt }

/**
 * Decides whether the removal may take the `codebook` entry out, before it changes anything; called by {@link removeManagedDevinMcpEntry}.
 * @param inspected - What {@link inspect} found under the lock.
 * @param expectedGeneration - The generation a setup that rolls back its own write got from {@link writeManagedDevinMcpEntry}; undefined for the removal command.
 * @returns
 * - `superseded`: a newer setup's receipt stands, so a rollback of an older write touches nothing
 * - `not-managed`: there is no receipt, no file or no entry
 * - `changed`: the entry's `command`, `args` or `env` differ from the receipt
 * - otherwise the present config and the receipt that owns its entry
 * @example
 * removalOwnership({ look: { kind: 'absent' }, current: undefined, receipt: undefined }, undefined) // => { status: 'not-managed' }
 */
function removalOwnership(
  { look, current, receipt }: Awaited<ReturnType<typeof inspect>>,
  expectedGeneration: string | undefined,
): RemovalOwnership {
  // A newer setup wrote this receipt: its entry is not ours to remove.
  if (
    receipt &&
    expectedGeneration !== undefined &&
    receipt.generation !== expectedGeneration
  )
    return { status: 'superseded' }
  if (look.kind === 'absent' || !receipt || current === undefined)
    return { status: 'not-managed' }
  if (!ownsEntry(current, receipt)) return { status: 'changed' }
  return { look, receipt }
}

/**
 * Takes Codebook's entry out of a config whose entry it owns: deletes the file when Codebook made it and nothing else is in it, else writes the file back without the entry; called by {@link removeManagedDevinMcpEntry}.
 * @param context - The run.
 * @param owned - The present config and the receipt that owns its entry ({@link removalOwnership}).
 * @returns `file-removed` when the file went, `removed` when only the entry went, and the private files that could not be deleted (empty when none).
 * @throws The refusals of {@link deleteConfig}, {@link assertRewritable} and {@link publishRoot} (a removal's own record that cannot be written first, because another file stands at its name, among them: {@link ownRecordContext}), and an {@link unrecordedRemovalRefusal} when the reduced config stands but the completed record could not be written (the receipt stays); a {@link TakenOutConflictError} when the entry is out but a take-back's tracked rollback record could not be deleted because its name shows another file ({@link dropFinishedRecord}).
 * @example
 * await takeEntryOut(context, owned) // => { status: 'removed' }
 */
async function takeEntryOut(
  context: Context,
  { look, receipt }: Extract<RemovalOwnership, { receipt: Receipt }>,
): Promise<{ status: 'file-removed' | 'removed'; keptLeft: KeptFile[] }> {
  const otherServers = Object.fromEntries(
    Object.entries(look.servers ?? {}).filter(([name]) => name !== SERVER_NAME),
  )
  assertSingleLink(context, look)
  await context.seam?.afterRead?.()
  // The file goes only when Codebook made it, it is still that file and nothing else is in it.
  if (
    createdFileFor(look, receipt) &&
    Object.keys(otherServers).length === 0 &&
    Object.keys(look.root).length === 1
  )
    return { status: 'file-removed', ...(await deleteConfig(context, look)) }
  assertRewritable(context, look)
  const { keptLeft, isRecorded, recordConflict } = await publishRoot(
    context,
    { ...look.root, mcpServers: otherServers },
    look,
    { createdFile: false },
  )
  // Without the completed record the receipt stays: success is reported only once the removal is recorded, and the refusal says what kept that record from being written.
  if (!isRecorded)
    throw await unrecordedRemovalRefusal(context, keptLeft, recordConflict)
  if (keptLeft.length === 0) await dropFinishedRecord(context)
  return { status: 'removed', keptLeft }
}

/**
 * The refusal of a removal whose reduced config stands but whose completed record could not be written: the receipt stays and the previous config's private copy is named; the next run settles the copy and drops the receipt.
 * Its own class so the removal command can tell that the config changed (the loaded Codebook bridge keeps running until a reload) from a refusal that touched nothing; thrown by {@link takeEntryOut}, read by {@link devinEntryRemovalOf}.
 */
export class DevinMcpUnrecordedRemovalError extends Error {}

/**
 * Words {@link DevinMcpUnrecordedRemovalError}: the config change, the record failure and the next step in separate clauses; called by {@link takeEntryOut}.
 * The record written before the move-aside names the previous config's copy, so the retry deletes it while it holds exactly that config: its phrase carries the {@link LEFTOVER_CLAUSE} while that record reads back as one of this config that names the copy and is not handed over ({@link recordedCopyFateOf} answers `tracked`), and the {@link UNCONFIRMED_CLAUSE} when another program replaced, removed or restored the record. What kept the completed record from being written picks the rest ({@link unrecordedRemovalWording}): a full disk asks for room, another program's change at that record's name names that record and asks for no room. A staged name kept because it holds changes the config name no longer reaches ({@link KeptFile.isEditedApart}) gets its {@link editedApartSentence} after that ending.
 * @param context - The run; gives the paths and the command to run again.
 * @param keptLeft - The files the publish left.
 * @param recordConflict - What stood at the record's name when another program kept the completed record from being written, or Codebook's own step at its dropping name refused ({@link Published.recordConflict}); undefined for a write that failed (a full disk).
 * @returns The error, not thrown yet.
 * @example
 * throw await unrecordedRemovalRefusal(context, keptLeft, undefined) // 'Codebook took its entry out of … but could not write its own record of that step, so it kept its receipt and …; make room for that record, …'
 * throw await unrecordedRemovalRefusal(context, keptLeft, journalConflictError(context, 'changed')) // '… could not write its own record of that step, because another program changed or replaced that record at …/pending.json (…), so it kept its receipt …'
 */
async function unrecordedRemovalRefusal(
  context: Context,
  keptLeft: KeptFile[],
  recordConflict: JournalConflictError | undefined,
): Promise<DevinMcpUnrecordedRemovalError> {
  const { path } = context
  const previous = keptLeft.find(({ holds }) => holds === 'previous')
  // Only a record that still names the copy lets a later run delete it.
  const fate =
    previous && (await recordedCopyFateOf(context, previous.path)) === 'tracked'
      ? LEFTOVER_CLAUSE
      : UNCONFIRMED_CLAUSE
  const copy = previous ? ` and ${keptCopyPhrase(previous.path)}, ${fate}` : ''
  const { because, ending } = await unrecordedRemovalWording(
    context,
    recordConflict,
  )
  // The staged name of the config without the entry that holds changes no config name reaches any more may hold the only copy of them: it is named after the way out.
  const editedApart = keptLeft
    .filter(({ isEditedApart }) => isEditedApart === true)
    .map((kept) => ` ${editedApartSentence(kept.path)}`)
    .join('')
  return new DevinMcpUnrecordedRemovalError(
    `Codebook took its entry out of Devin Desktop's MCP config at ${path} but could not write its own record of that step${because}, so it kept its receipt${copy}${ending}${editedApart}`,
  )
}

/**
 * Words why a removal's completed record was not written and the way out, by what kept it from being written; called only by {@link unrecordedRemovalRefusal}.
 * @param context - The run; its pending path and retry are named.
 * @param recordConflict - The conflict at the record's name ({@link Published.recordConflict}); undefined for a write that failed (a full disk, the only failure that leaves the removal's own record as it wrote it, {@link Completion}).
 * @returns
 * - without a conflict: no cause, and `; make room for that record, <retry>.`
 * - for Codebook's own step at the record's dropping name ({@link DroppingNameConflictError}): no cause, and that refusal's own sentence, which names where the record stands and its way out
 * - when a folder stands at the record's name: the cause that names it, and the way out that moves that folder to another folder without deleting what it holds and puts the record back when the folder or a backup holds it, because a retry while it stands fails the same way instead of reading a record first
 * - for another program's change: the cause that names that record at `pending.json` ({@link recordConflictCause}), and `; <retry>, and that run reads <pending.json> first.`
 * @example
 * await unrecordedRemovalWording(context, journalConflictError(context, 'gone')) // => { because: ', because another program moved that record at …/pending.json away (…)', ending: '; then run Codebook: Remove Devin Desktop Setup again, and that run reads …/pending.json first.' }
 */
async function unrecordedRemovalWording(
  context: Context,
  recordConflict: JournalConflictError | undefined,
): Promise<{ because: string; ending: string }> {
  const { pendingPath, retry } = context
  // A full disk: room for the record is the way out.
  if (!recordConflict)
    return { because: '', ending: `; make room for that record, ${retry}.` }
  // Codebook's own step at the record's dropping name says where that record stands and its way out in its own sentence.
  if (recordConflict instanceof DroppingNameConflictError)
    return { because: '', ending: `. ${recordConflict.message}` }
  // The way out is worded for what stands at the record's name now; a look that fails decides nothing, as for any notice ({@link lstatOrAbsent}).
  const isFolder =
    recordConflict.kind === 'changed' &&
    (await lstatOrAbsent(pendingPath).then(
      (standing) => standing?.isDirectory() === true,
      () => false,
    ))
  // A folder at that name blocks every retry the same way, so the way out moves it aside without deleting what it may hold and says how the record it or a backup may hold goes back; any record there instead the retry reads first.
  if (isFolder)
    return {
      because: `, because a folder stands at ${pendingPath}, where that record stood (a backup or sync tool may have put it there)`,
      ending: `; move that folder to another folder, never delete it, because it may hold files of yours; if it or a backup holds the record that stood at ${pendingPath}, put that record back there; ${retry}, and that run reads ${pendingPath} first.`,
    }
  return {
    because: `, because ${recordConflictCause(context, recordConflict.kind, 'that record')}`,
    ending: `; ${retry}, and that run reads ${pendingPath} first.`,
  }
}

/** Thrown when the config a removal just took its entry out of holds that entry again, or changed so that this cannot be confirmed, before the entry's record is deleted: the record stays and the removal refuses, because deleting the record would leave the entry without the one file that proves it Codebook's. */
class RemovalEntryBackError extends Error {}

/**
 * Words a {@link RemovalEntryBackError} for the config a backup or sync tool put back while a removal finished; thrown by {@link removalConfigStill}.
 * @param context - The run; its config path and retry are named.
 * @returns The error, not thrown yet.
 * @example
 * throw removalEntryBackError(context) // 'Codebook took the "codebook" entry out of Devin Desktop's MCP config at …, but before it could delete its own record of that entry, that config changed again …'
 */
function removalEntryBackError({
  path,
  retry,
}: Context): RemovalEntryBackError {
  return new RemovalEntryBackError(
    `Codebook took the "${SERVER_NAME}" entry out of Devin Desktop's MCP config at ${path}, but before it could delete its own record of that entry, that config changed again (a backup or sync tool may have put an earlier config, with the entry, back), so it could not confirm the entry stayed out, left that record and that config as they are and went no further; ${retry}.`,
  )
}

/**
 * Confirms that the entry a removal just took out is still out of the config, and gives the synchronous look the record's delete passes right before its move and again before its unlink; called by {@link dropReceiptAfterRemoval} before the receipt is dropped, and by {@link answerRemovalWithoutTakeOut} for the entry the earlier removal a retry reports took out.
 * The config is read again through the thread pool: while it holds the entry the receipt owns, the removal's end state is already undone (a backup or sync tool put an earlier config back), so the record stays and the removal refuses instead of reporting a removal that did not last; the look at the config is then bound and rechecked synchronously, so a restore in the wide window between the take-out's publish and the record's unlink is never answered with a deleted record and an unmanaged entry.
 * @param context - The run.
 * @param receipt - The receipt that owns the entry the removal took out ({@link removalOwnership}).
 * @returns The look at the config ({@link StillLook}).
 * @throws The {@link RemovalEntryBackError} when the config already holds the entry the receipt owns again, or cannot be read; the returned look throws it too once the config changes before the record's unlink.
 * @example
 * await removalConfigStill(context, receipt) // => { names: [configPath], assert }
 */
async function removalConfigStill(
  context: Context,
  receipt: Receipt,
): Promise<StillLook> {
  let look: ConfigLook
  try {
    look = await lookAtConfig(context)
  } catch {
    // A config that cannot be read again proves nothing: the removal counts as undone.
    throw removalEntryBackError(context)
  }
  // The entry the receipt owns is back: the removal's end state is undone, and the record is the only proof that entry is Codebook's.
  if (
    look.kind === 'present' &&
    ownsEntry(look.servers?.[SERVER_NAME], receipt)
  )
    throw removalEntryBackError(context)
  const bound = look.kind === 'present' ? look.identity : 'absent'
  return {
    names: [context.path],
    assert: (): void => {
      // A look that fails proves nothing: the config counts as changed.
      if (!isConfigStill(context, bound)) throw removalEntryBackError(context)
    },
  }
}

/**
 * Drops the receipt of an entry the removal has taken out; called by {@link removeManagedDevinMcpEntry}. The config has already changed, so a receipt or a private copy that cannot be deleted is reported beside the result instead of thrown.
 * The receipt goes only while `receipt.json` still shows the record the removal's own read found there ({@link dropReceipt}), the read its take-out rests on, so a record a backup or sync tool put back there meanwhile stays and the notice says so; when Codebook's own step at that record's dropping name refuses, the notice gives that refusal's sentence, which names both names.
 * @param context - The run; gives the receipt's path, the config path and the version the run read.
 * @param receipt - The receipt that owns the entry the removal took out.
 * @param status - How the removal changed the config.
 * @param keptLeft - The private files that could not be deleted, if any.
 * @returns The removal's result, with `cleanupFailure` when something stays.
 * @throws The {@link RemovalEntryBackError} when the entry is back in the config, or the config changed again, before the record's delete: the record stays and nothing is reported.
 * @example
 * await dropReceiptAfterRemoval(context, receipt, 'removed', []) // => { status: 'removed', path }
 */
async function dropReceiptAfterRemoval(
  context: Context,
  receipt: Receipt,
  status: 'file-removed' | 'removed',
  keptLeft: KeptFile[],
): Promise<DevinMcpRemovalResult> {
  const { path, receiptPath } = context
  const failures = [cleanupFailureOf(keptLeft)]
  try {
    // The receipt goes only while the entry the removal took out is still out of the config: a backup or sync tool that put an earlier config back meanwhile undoes the removal, and the record is the only proof the entry is Codebook's, so the removal refuses instead of reporting a success that did not last.
    const configStill = await removalConfigStill(context, receipt)
    // Another file there, other bytes, or a name that cannot be read again: what stands there stays, and the notice says so.
    if ((await dropReceipt(context, configStill)) === 'kept')
      failures.push(keptReceiptSentence(context))
  } catch (error) {
    // The entry is back or the config changed again: the removal did not last, so it refuses rather than reporting a removal beside a managed entry.
    if (error instanceof RemovalEntryBackError) throw error
    // Codebook's own step at the record's dropping name names both names and its way out in its own sentence.
    failures.push(
      error instanceof JournalConflictError
        ? error.message
        : `Codebook could not delete its own record of that entry at ${receiptPath}; delete that record by hand.`,
    )
  }
  const cleanupFailure = failures.filter(Boolean).join(' ')
  return cleanupFailure ? { status, path, cleanupFailure } : { status, path }
}

/**
 * Says that a removal whose entry went left the file at `receipt.json` as it is, because that name no longer showed the record the run read there, or showed one where the run read none, or held Codebook's record of the entry in another config ({@link dropReceipt} answered `kept`); used by {@link dropReceiptAfterRemoval} and, for a retry of an unrecorded removal and a removal whose run took a cut-short first setup back, by {@link answerRemovalWithoutTakeOut}.
 * @param context - The run; its receipt path is named, and the config path a record of another config names ({@link Context.receiptVersion}'s `otherConfigPath`) picks the sentence; whether the run knows a version there ({@link Context.receiptVersion}'s `current`) tells a record it read from one that appeared where it read none.
 * @returns One sentence for the removal's `cleanupFailure`:
 * - for a record of another config: that the file holds Codebook's record of the entry in that config, not in this one, and is to be moved to another folder once that config is no longer used
 * - when the run read no record at that name: that the file appeared where no record stood when Codebook read that name, and the next run reads it again
 * - otherwise: that Codebook could not confirm it was still the record it had read there, and the next run reads it again
 * @example
 * keptReceiptSentence(context) // => 'Codebook left the file at …/receipt.json as it is, because it could not confirm that it was still the record of that entry Codebook had read there (…); the next run reads it again.'
 */
function keptReceiptSentence({
  receiptPath,
  receiptVersion: { otherConfigPath, current },
}: Context): string {
  // A record of another config's entry is named with that config, never as a record Codebook could not confirm.
  if (otherConfigPath !== undefined)
    return `Codebook left the file at ${receiptPath} as it is, because it holds its record of the "${SERVER_NAME}" entry in the MCP config at ${otherConfigPath}, not in this one (${OTHER_HOME_CAUSE}); if you no longer use ${otherConfigPath}, move that file to another folder.`
  // The run read no record at that name, so the file there is none Codebook had read; naming one as read would be false.
  if (current === undefined)
    return `Codebook left the file at ${receiptPath} as it is, because it appeared where no record stood when Codebook read that name (a backup or sync tool may have put a record back there); the next run reads it again.`
  return `Codebook left the file at ${receiptPath} as it is, because it could not confirm that it was still the record of that entry Codebook had read there (a backup or sync tool may have put a record back there); the next run reads it again.`
}

/** What a removal reports: the config change that was made, apart from a failure to delete Codebook's own record afterwards. */
export type DevinMcpRemovalResult =
  | {
      status: 'removed' | 'file-removed'
      path: string
      /** Plain sentences (no raw error text) when the entry is gone but Codebook's receipt or a private copy could not be deleted; each names the file; the caller still reports the removal. */
      cleanupFailure?: string
    }
  | {
      status: 'not-managed' | 'changed' | 'superseded'
      path: string
      /** Set with `not-managed` when no receipt is left but the config still holds a `codebook` entry (an orphan), as opposed to no entry at all. */
      entryStays?: true
      /** Plain sentences (no raw error text) when the receipt of an entry that is gone or changed could not be deleted; each names the file. Never with `superseded`: a newer setup's receipt is never dropped. */
      cleanupFailure?: string
    }

/** Options of {@link removeManagedDevinMcpEntry}. */
export type DevinMcpRemovalOptions = {
  /** The generation a setup got from {@link writeManagedDevinMcpEntry}; the removal does nothing when the receipt holds another one. */
  expectedGeneration?: string
}

/**
 * Removes the receipted `codebook` entry; called by Codebook: Remove Devin Desktop Setup and by a setup that rolls back its own write.
 * Deletes the file only when Codebook created it (the receipt says so and the inode is the one Codebook wrote) and nothing else is left in it. An entry that was edited since the receipt (any key but `disabled` and `disabledTools` added or changed) is left alone and the receipt is dropped, because Codebook no longer owns it; those two keys, which Devin sets, do not change ownership.
 * @param storageRoot - Codebook's global storage folder.
 * @param homeRoot - The home folder; the real one unless a test names its own.
 * @param seam - Test hook, see {@link DevinMcpTestSeam}.
 * @param options - See {@link DevinMcpRemovalOptions}.
 * @returns `removed`, `file-removed`, `not-managed` (no receipt, or the entry is already gone), `changed` or `superseded` (a newer setup's receipt; nothing touched); and the config path. A failure to delete the receipt or a private copy after the config changed is returned as `cleanupFailure`, not thrown.
 * @throws The refusals of {@link writeManagedDevinMcpEntry} for an unreadable config or a file that changed during the removal; they end with the removal command. A retry of an unrecorded removal throws the record's {@link JournalConflictError} when another program changed, moved away or made that record unreadable; for a retry whose entry is already out, that proof is written back when a refusal before them leaves the removal unconfirmed, so the next run can still answer for it.
 * @example
 * await removeManagedDevinMcpEntry(storageRoot) // => { status: 'removed', path }
 */
export async function removeManagedDevinMcpEntry(
  storageRoot: string,
  homeRoot = homedir(),
  seam?: DevinMcpTestSeam,
  options: DevinMcpRemovalOptions = {},
): Promise<DevinMcpRemovalResult> {
  return inLockedFolder(
    storageRoot,
    homeRoot,
    undefined,
    seam,
    async (context) => {
      const inspected = await inspect(context)
      // From here the removal writes and deletes its own record only from the version inspect left there.
      const run = ownRecordContext(context, inspected)
      // The retry ends the unrecorded removal's record before it acts on it, only as the version inspect read ({@link inspect} leaves that record for this end, and judges it on the record it read itself, so a record a backup or sync tool put at that name after the run started is the one ended here). A conflict can mean a backup restored the entry too, so this retry stops before touching the receipt.
      if (inspected.unrecordedRemoval)
        await dropPending(run, { onConflict: 'throw' })
      const ownership = removalOwnership(inspected, options.expectedGeneration)
      // Not Codebook's entry to take out (gone, changed, or a newer setup's): answer without touching the config.
      if ('status' in ownership) {
        try {
          return await answerRemovalWithoutTakeOut(
            context,
            ownership.status,
            inspected,
            inspected.unrecordedRemoval === true,
          )
        } catch (error) {
          // A refusal before the removal's point of no return must not lose the only proof that its entry ever went out. The tracked write never replaces a record another program put there meanwhile; when even that proof cannot be written back, the original refusal is the one the learner needs.
          if (inspected.unrecordedRemovalRecord)
            await writeRecord(
              run,
              run.pendingPath,
              inspected.unrecordedRemovalRecord,
            ).catch(() => undefined)
          throw error
        }
      }
      const { status, keptLeft } = await takeEntryOut(run, ownership)
      return dropReceiptAfterRemoval(
        context,
        ownership.receipt,
        status,
        keptLeft,
      )
    },
  )
}

/**
 * Answers a removal whose entry is not Codebook's to take out (gone, changed, or a newer setup's) without touching the config; called by {@link removeManagedDevinMcpEntry} under its lock.
 * The receipt of an entry that is gone or changed goes only while `receipt.json` still shows the record the run's own read found there ({@link dropReceipt}) and, when a receipt stands, only while that entry is still out of the config ({@link removalConfigStill}), as after a removal that took its entry out ({@link dropReceiptAfterRemoval}): a backup or sync tool that put an earlier config, with the entry, back meanwhile undoes the removal a retry reports, and the record is the only proof that entry is Codebook's. A record a backup or sync tool put at that name after that read, also after a read that found the name empty, stays for the next run, and when the entry went (this run's take-back, or the earlier removal a retry reports) the notice says so ({@link keptReceiptSentence}). A record of the entry in another config that the run's read found there always stays: a removal that changed nothing refuses, naming it ({@link assertNoOtherConfigReceipt}), and one whose take-back took the entry out names it in its notice.
 * @param context - The locked removal's paths and the version of the receipt it read.
 * @param status - What {@link removalOwnership} decided.
 * @param inspected - What {@link inspect} found under the lock.
 * @param wasUnrecorded - Whether an earlier removal took the entry out and left its record unwritten.
 * @returns
 * - `removed` when an earlier unrecorded removal already took the entry out (the retry reports it, so the window is still offered its reload), or this run's take-back's answer; either with the kept-record sentence as `cleanupFailure` when a record stays at `receipt.json`
 * - otherwise `status` itself, with `entryStays` when `not-managed` finds the entry still in the config without its receipt.
 * @throws The {@link otherConfigReceiptRefusal} when no take-back of this run took the entry out and `receipt.json` holds Codebook's record of the entry in another config; the {@link RemovalEntryBackError} when the entry is back in the config, or the config changed again, before the record's delete: the record stays and nothing is reported. What {@link dropReceipt} throws otherwise is reported as `cleanupFailure` once the entry is out.
 * @example
 * await answerRemovalWithoutTakeOut(context, 'changed', inspected, false) // => { status: 'changed', path }
 * await answerRemovalWithoutTakeOut(context, 'not-managed', inspected, true) // => { status: 'removed', path, cleanupFailure: 'Codebook left the file at …/receipt.json as it is, …' } once a backup put a record back there
 */
/**
 * Drops the receipt of a removal whose entry needed no take-out and converts a failed drop into the cleanup sentence the removal result carries.
 * @param context - The locked removal's paths and the version of the receipt it read.
 * @param status - What {@link removalOwnership} decided.
 * @param inspected - What {@link inspect} found under the lock.
 * @returns The kept-record or cleanup-failure sentence; undefined when the receipt went or never had to go.
 * @throws The {@link RemovalEntryBackError} when the entry is back in the config, or the config changed again, before the record's delete.
 */
async function dropReceiptWithoutTakeOut(
  context: Context,
  status: Extract<RemovalOwnership, { status: string }>['status'],
  inspected: Awaited<ReturnType<typeof inspect>>,
): Promise<string | undefined> {
  try {
    // The receipt goes only while the entry that went out is still out of the config: a backup or sync tool that put an earlier config, with the entry, back meanwhile undoes the removal the retry reports, and the record is the only proof that entry is Codebook's, so the retry refuses instead of reporting a removal that did not last.
    const configStill =
      status !== 'superseded' && inspected.receipt
        ? await removalConfigStill(context, inspected.receipt)
        : undefined
    const receiptFate =
      status === 'superseded'
        ? undefined
        : await dropReceipt(context, configStill)
    // After the entry went, a record a backup or sync tool put at receipt.json meanwhile stays, and the notice says so.
    if (receiptFate === 'kept') return keptReceiptSentence(context)
    return undefined
  } catch (error) {
    // The entry is back or the config changed again: the removal did not last, so it refuses rather than reporting a removal beside a managed entry.
    if (error instanceof RemovalEntryBackError) throw error
    // The entry is already out, so its result is still reported; the receipt that could not be dropped is named for manual cleanup.
    return error instanceof JournalConflictError
      ? error.message
      : `Codebook could not delete its own record of that entry at ${context.receiptPath}; delete that record by hand.`
  }
}

async function answerRemovalWithoutTakeOut(
  context: Context,
  status: Extract<RemovalOwnership, { status: string }>['status'],
  inspected: Awaited<ReturnType<typeof inspect>>,
  wasUnrecorded: boolean,
): Promise<DevinMcpRemovalResult> {
  // A record of another config's entry stays, and a removal that changed nothing says so and goes no further.
  if (!inspected.tookBack) assertNoOtherConfigReceipt(context)
  // A newer setup's receipt stays; the receipt of an entry that is gone or changed is dropped, because Codebook no longer owns that entry, and only as the run read it.
  const cleanupFailure = await dropReceiptWithoutTakeOut(
    context,
    status,
    inspected,
  )
  const keptReceipt = cleanupFailure ? { cleanupFailure } : {}
  // The entry is gone because this run's take-back of an interrupted first setup took it out: the removal reports that, so the window is offered its reload.
  if (status === 'not-managed' && inspected.tookBack)
    return { status: inspected.tookBack, path: context.path, ...keptReceipt }
  // The entry is gone because an earlier removal took it out: the retry reports that removal, so the window is still offered its reload.
  if (status === 'not-managed' && wasUnrecorded && inspected.receipt)
    return { status: 'removed', path: context.path, ...keptReceipt }
  // An entry that stays without its receipt is no absent entry: the caller must not count the take-back complete.
  const entryStays =
    status === 'not-managed' &&
    !inspected.receipt &&
    inspected.current !== undefined
  return {
    status,
    path: context.path,
    ...(entryStays && { entryStays: true as const }),
    ...keptReceipt,
  }
}
