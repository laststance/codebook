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
  /** Called right before recovery looks again at a leftover's name ({@link isLeftoverStill}) with that name, so a test can swap the file there between the first look and the link or unlink. */
  beforeLeftoverCheck?: (path: string) => void
  /** Called right after that second look passed and before the link or unlink it guards, so a test can swap the file in the gap the second look cannot close. */
  afterLeftoverCheck?: (path: string) => void
  /** Called for every write of a receipt or pending record ({@link writeRecord}), with the record's path and the value about to be written, after its bytes were flushed to a temporary file and before the rename publishes them; a throw cancels that write and leaves the previous record byte for byte, as a full disk at the temporary file does. */
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
  /** Set by a first setup whose stale receipt stood ({@link isFirstSetup}), before anything is published: right before its link that receipt moves to its private name ({@link retiredReceiptPathOf}), and it goes back to `receipt.json` when the link fails, never over a newer receipt ({@link putBackRetiredReceipt}). A run that finds the private name settles it the same way ({@link settleRetiredReceipt}). Absent for every other publish; an older build drops it. */
  retiresReceipt: z.boolean().optional(),
  /** Set, with `phase: 'handed'`, right before the link of a put-back that only the displaced file's bytes prove ({@link putBackDisplaced}): a run that stops before the check leaves a record that older builds read as handed and never delete from, while this build reads it as in progress ({@link leftoverPhaseOf}) and checks the shared bytes before it deletes the private name ({@link assertSharedPutBackBytes}). It stays while that name is a second name of the config that no check cleared ({@link recordAfterRecovery}); gone once the check passed and the name is gone, when the put-back failed before such a second name stood ({@link restoreUnlessSecondName}), or when the copy was handed over ({@link handedRecordOf}); an older build drops it. */
  bytesUnverified: z.boolean().optional(),
})
type Receipt = z.infer<typeof receiptSchema>
type Pending = z.infer<typeof pendingSchema>
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
  mtimeMs: bigint
  /** The permission bits (`mode & 0o777`) the file had when it was read; a replacement keeps only the owner's of them. */
  mode: number
  /** How many names the inode had when it was read; more than one means another path reaches the same file ({@link assertSingleLink}). */
  nlink: bigint
}

type ConfigLook =
  | { kind: 'absent' }
  | {
      kind: 'present'
      root: JsonObject
      servers: JsonObject | undefined
      identity: FileIdentity
      /** SHA-256 of the bytes that were read, to tell a save made meanwhile from the file that was read. */
      sha256: string
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
}

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

/** The refusal for a copy of the config that Codebook kept and cannot settle: it stays where it is, named here. */
function leftCopyRefusal(
  { path, retry }: Context,
  copyPath: string,
  cause?: unknown,
): Error {
  return refusal(
    `a copy of your config that Codebook kept at ${copyPath} and could not settle`,
    path,
    `look at that copy, move it back over the config or delete it`,
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
  /** Set for a copy that stays under the name a completed record tracks because neither its handed record nor its move to a name no record tracks succeeded ({@link keepFromRecovery}): a later run deletes it while it still holds exactly the bytes Codebook moved aside, and the sentence that names it says so ({@link LEFTOVER_CLAUSE}). */
  isLeftover?: true
}

/** The words that name a kept copy of the previous config, for a refusal and for {@link cleanupFailureOf}. */
function keptCopyPhrase(copyPath: string): string {
  return `a private copy of your previous Devin MCP config at ${copyPath} (it holds the settings of your other servers)`
}

/** What happens next to a kept copy that a completed record still tracks ({@link KeptFile.isLeftover}), said wherever such a copy is named instead of the advice to delete it. */
const LEFTOVER_CLAUSE =
  'but it could not record that it leaves that copy to you, so a later run of Codebook deletes it while it still holds exactly your previous config; copy it elsewhere to keep it'

/** The refusal for a config that appeared while Codebook was replacing yours: that config stays, and so does the displaced copy, because a writer may still hold the old file open. */
function newConfigRefusal({ path, retry }: Context, copyPath: string): Error {
  return refusal(
    'a file that changed while Codebook was working on it',
    path,
    `look at the file; Codebook kept ${keptCopyPhrase(copyPath)}, so delete that copy when you no longer need it`,
    retry,
  )
}

/** The refusal, said once, for a leftover of a publish or removal that already finished and that Codebook cannot prove unchanged or cannot delete. */
function completedLeftRefusal(
  { path, retry }: Context,
  copyPath: string,
  cause?: unknown,
): Error {
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

/** One sentence for a kept file that could not be deleted; the work itself is done. A copy a completed record still tracks says that a later run deletes it ({@link LEFTOVER_CLAUSE}) instead of leaving it to the learner. */
function keptFileSentence({ path, holds, isLeftover }: KeptFile): string {
  const what =
    holds === 'previous'
      ? keptCopyPhrase(path)
      : `a private copy of the Devin MCP config it just wrote at ${path} (it holds the settings of your other servers)`
  const next = isLeftover
    ? `, ${LEFTOVER_CLAUSE}`
    : '; delete it when you no longer need it'
  return `Codebook kept ${what} because it could not delete that file safely${next}.`
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
  mtimeMs: bigint
  mode: bigint
  nlink: bigint
}): FileIdentity {
  const { ino, size, mtimeMs, mode, nlink } = status
  return { ino, size, mtimeMs, mode: Number(mode) & 0o777, nlink }
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
    hasLossyNumber,
  }
}

/**
 * Throws when the config is no longer the file that was read; runs just before the rename ({@link publishRoot}) and before a removal.
 * @param context - The run.
 * @param expected - The identity read earlier; undefined when the file was absent.
 * @throws A {@link refusal} naming the change; nothing was written.
 * @example
 * assertConfigUnchanged(context, look.identity)
 */
function assertConfigUnchanged(
  context: Context,
  expected: FileIdentity | undefined,
): void {
  const now = lstatSync(context.path, { bigint: true, throwIfNoEntry: false })
  const didChange = expected
    ? !now ||
      now.ino !== expected.ino ||
      now.size !== expected.size ||
      now.mtimeMs !== expected.mtimeMs
    : Boolean(now)
  if (didChange) throw changedWhileWorking(context)
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

/** Removes the pending record; a failure leaves a record that the next run finds stale. */
function dropPending(context: Context): Promise<void> {
  return rm(context.pendingPath, { force: true }).catch(() => undefined)
}

/**
 * Rewrites the pending record as completed: the config was already published or removed, so a copy that stays is a leftover and never goes back to the config name ({@link recoverLeftovers}).
 * @param context - The run.
 * @param journal - The record as it was written before the first move.
 * @returns `true` when the record says completed; `false` when it could not be written (a full disk): the record stays as it was, and the caller must not rely on it.
 */
async function markCompleted(
  context: Context,
  journal: Pending,
): Promise<boolean> {
  try {
    await writeRecord(context, context.pendingPath, {
      ...journal,
      phase: 'completed',
    } satisfies Pending)
    return true
  } catch {
    return false
  }
}

/**
 * Records that a copy was named to the learner (in a refusal or in `cleanupFailure`), so no later run deletes it, whatever its bytes; the next run reports it once and stops tracking it ({@link recoverLeftovers}).
 * @param context - The run.
 * @param journal - The record as it was written before the first move.
 * @returns
 * - `true` when no record lets a later run delete the copy: the handed record was written, or, when that write failed (a full disk), the record was dropped, so the copy is no longer tracked and stays for good
 * - `false` when the record stays as it is on disk: a first setup's record or one marked for take-back whose handed write failed (it holds the intent that the entry is taken back unless its receipt gets written ({@link isTakeBackOwed}), and a failed write leaves the previous record byte for byte), or another record that could not be dropped either; a caller whose record on disk is completed keeps the copy out of a later run's reach ({@link keepFromRecovery})
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
  } catch {
    // Dropping this record would let a stop before the receipt leave an entry that no record owns: it stays, and the caller says what becomes of the copy.
    if (isFirstSetupRecord(journal) || journal.takeBack) return false
    return rm(context.pendingPath, { force: true }).then(
      () => true,
      () => false,
    )
  }
}

/**
 * Looks at a name without following a link and without holding the extension host's thread; called where a look only decides what a record says or which way a step goes ({@link isUnverifiedSecondName}, {@link settleRetiredReceipt}), never right before a link or unlink it guards.
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

/** Whether a file was deleted; a failure is an answer here, because the caller names the file that stays. */
function didUnlink(path: string): Promise<boolean> {
  return unlink(path).then(
    () => true,
    () => false,
  )
}

/** A kept copy as {@link inspectCopy} read it: the bytes' hash, the inode, and the size and times (nanoseconds) a later look must still see; an in-place write that keeps inode and size changes the times. `nlink` is how many names the inode had at that read ({@link dropCheckedName} deletes a name only while another one still reaches the file). */
type InspectedCopy = {
  sha256: string
  ino: bigint
  size: bigint
  mtimeNs: bigint
  ctimeNs: bigint
  nlink: bigint
}

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

/** The error for a kept copy that is no regular file or is larger than the config limit. */
function unsaneCopyError(): Error {
  return new Error('The kept copy is no regular file of a sane size.')
}

/** Whether a kept copy still is the file and the bytes Codebook expected in it. */
function isExpectedCopy(
  copy: { sha256: string; ino: bigint },
  expected: KeptCopy,
): boolean {
  return copy.sha256 === expected.sha256 && copy.ino === expected.ino
}

/** The displaced copy as it was read through its open handle: the bytes' hash, the inode, and the size and times that a later write to the same file changes. */
export type HeldCopy = {
  handle: FileHandle
  sha256: string
  ino: bigint
  size: bigint
  mtimeMs: bigint
  ctimeMs: bigint
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
  const { ino, size, mtimeMs, ctimeMs } = status
  return { handle, sha256: bytesSha256(bytes), ino, size, mtimeMs, ctimeMs }
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
      now.mtimeMs !== held.mtimeMs ||
      now.ctimeMs !== held.ctimeMs
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

/** What {@link discardDisplaced} did with the displaced copy: `deleted`; `kept` (it changed or could not be deleted, so it stays and is reported); `unrecorded` (the completed record could not be written, so nothing was deleted). */
type DiscardOutcome = 'deleted' | 'kept' | 'unrecorded'

/** The outcome of {@link discardDisplaced} and the displaced copy as it stays: its path (another one when it was moved out of recovery's reach, {@link keepFromRecovery}) and what it holds; the copy is ignored for `deleted`. */
type Discarded = { outcome: DiscardOutcome; copy: KeptFile }

/** The end of the name a changed displaced copy moves to when its handover cannot be recorded ({@link keepFromRecovery}); no record names it, so no recovery of any build deletes it. */
const KEPT_COPY_SUFFIX = 'codebook-kept'

/**
 * Deletes the displaced copy after the config was published or removed, unless a writer changed it since the comparison; called by {@link settlePublished} and by the removal.
 * The record turns to completed first, so a copy that stays is a leftover that never goes back to the config name; a copy that changed is handed to the learner ({@link handOver}) and never deleted by a later run, also when the handed record cannot be written ({@link keepFromRecovery}). When the completed record cannot be written nothing is deleted.
 * @param context - The run.
 * @param journal - The record as it was written before the first move.
 * @param displacedPath - The private name of the displaced copy.
 * @param held - The copy as it was compared.
 * @returns The {@link Discarded} outcome with the copy as it stays.
 */
async function discardDisplaced(
  context: Context,
  journal: Pending,
  displacedPath: string,
  held: HeldCopy,
): Promise<Discarded> {
  const copy: KeptFile = { path: displacedPath, holds: 'previous' }
  if (!(await markCompleted(context, journal)))
    return { outcome: 'unrecorded', copy }
  if (await didCopyChange(held)) {
    // The completed record stays on disk when the handed one cannot be written, and the next run would delete a copy that still holds the recorded bytes.
    const isRecorded = await handOver(context, journal)
    return {
      outcome: 'kept',
      copy: isRecorded
        ? copy
        : await keepFromRecovery(context, journal, displacedPath, held),
    }
  }
  // The held handle proves the file that was compared, not the name: a file swapped in at the name since is kept, never deleted. Limit: a swap between this look and the unlink is not seen.
  if (!(await isStillHeldOrUnprovable(context, journal, displacedPath, held)))
    return { outcome: 'kept', copy }
  const isDeleted = await didUnlink(displacedPath)
  return { outcome: isDeleted ? 'deleted' : 'kept', copy }
}

/**
 * Keeps a changed displaced copy out of a later run's reach when its handed record could not be written and the completed record stays on disk; called by {@link discardDisplaced}.
 * Recovery deletes a completed record's copy only while it still is the recorded file with the recorded bytes ({@link tidyLeftover}), so only such a copy moves, by a rename to `<config file>.<generation>.codebook-kept` ({@link KEPT_COPY_SUFFIX}), a name no record holds; any other copy stays where it is, and the next run names it once and never deletes it. A copy that cannot move stays a leftover the next run deletes, and its sentence says so.
 * @param context - The run; its seam is called when the copy is read.
 * @param journal - The record as it was written before the first move; its kept hash is the bytes recovery deletes.
 * @param displacedPath - The private name of the displaced copy.
 * @param held - The copy as it was compared; its inode is the one the record holds.
 * @returns The copy as it stays: at its new name, at its private name, or at its private name marked {@link KeptFile.isLeftover} when the move failed.
 * @example
 * await keepFromRecovery(context, journal, displacedPath, held) // => { path: '…/mcp_config.json.<generation>.codebook-kept', holds: 'previous' }
 */
async function keepFromRecovery(
  context: Context,
  journal: Pending,
  displacedPath: string,
  held: HeldCopy,
): Promise<KeptFile> {
  const copy: KeptFile = { path: displacedPath, holds: 'previous' }
  const now = await inspectCopy(displacedPath, context.seam).catch(
    () => undefined,
  )
  // Another file, other bytes, a copy that is gone or one that cannot be read: the next run never deletes it.
  if (now?.ino !== held.ino || now.sha256 !== journal.keptSha256) return copy
  const keptPath = `${displacedPath.slice(0, -JOURNAL_SUFFIX.kept.length)}${KEPT_COPY_SUFFIX}`
  return rename(displacedPath, keptPath).then(
    (): KeptFile => ({ path: keptPath, holds: 'previous' }),
    (): KeptFile => ({ ...copy, isLeftover: true }),
  )
}

/**
 * Tells whether the displaced name still shows the compared file, for {@link discardDisplaced}; a name that changed is handed to the learner, and a look that throws (EIO, EACCES) cannot prove the delete is safe, so the copy is kept without failing the publish that already happened.
 * @param context - The run.
 * @param journal - The record as it was written before the first move.
 * @param displacedPath - The private name of the displaced copy.
 * @param held - The copy as it was compared.
 * @returns `true` only when the name still shows the compared file.
 * @example
 * if (!(await isStillHeldOrUnprovable(context, journal, path, held))) return 'kept'
 */
async function isStillHeldOrUnprovable(
  context: Context,
  journal: Pending,
  displacedPath: string,
  held: HeldCopy,
): Promise<boolean> {
  let isStill
  try {
    isStill = isLeftoverStill(context, displacedPath, held)
  } catch {
    // Cannot prove it is safe to delete: the copy stays and the cleanup notice names it.
    return false
  }
  if (!isStill) await handOver(context, journal)
  return isStill
}

/**
 * Gives the config name its file back after the comparison found it is not the file that was read: a link never replaces a config that appeared meanwhile, only then does the file get its own permissions back through its handle, and the displaced name is unlinked. A copy that cannot go back stays private.
 * @param context - The run.
 * @param displacedPath - The private name of the displaced file.
 * @param opened - The handle of that file with the mode it had before it was made private; undefined when it could not be opened.
 * @param dropsRecord - Whether the pending record goes once the file is back; `false` while the record still names a stale receipt that could not go back ({@link UnrestoredReceiptError}), so the next run puts that receipt back.
 * @throws A {@link leftCopyRefusal} naming the displaced file when it cannot go back (a new config stands there, or the link failed); an {@link extraNameRefusal} when the file is back but its displaced name could not be deleted (the record stays, so the next run deletes that name).
 */
async function restoreDisplaced(
  context: Context,
  displacedPath: string,
  opened: DisplacedHandle | undefined,
  dropsRecord = true,
): Promise<void> {
  try {
    await link(displacedPath, context.path)
  } catch (error) {
    throw leftCopyRefusal(context, displacedPath, error)
  }
  // The name is back: the same inode gets the mode it had, never another file; a shared file never had its mode changed.
  if (opened && !opened.isShared)
    await opened.handle.chmod(opened.originalMode).catch(() => undefined)
  // Two names reach the file now: one that cannot be deleted stays in the record, so the next run drops it ({@link tidyLeftover}) and the config never keeps an unexplained second link.
  if (!(await didUnlink(displacedPath)))
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
 * Writes the new config bytes to a private temporary file beside the config and reads the new file's inode from the open handle, so nothing after the rename needs to look at the file again.
 * @param temporary - The staged name ({@link journalPathOf}); its folders are created.
 * @param serialized - The complete new content.
 * @param mode - The permission bits of the new file; the owner's bits only ({@link publishRoot}).
 * @returns The temporary path and the inode the config will have once the file is published.
 */
async function stageConfigFile(
  temporary: string,
  serialized: string,
  mode: number,
): Promise<{ temporary: string; ino: bigint }> {
  await mkdir(dirname(temporary), { recursive: true })
  const handle = await open(temporary, 'wx', PRIVATE_FILE_MODE)
  try {
    try {
      // fchmod, so the umask does not narrow it; never wider than the owner's bits.
      await handle.chmod(mode)
      await handle.writeFile(serialized)
      await handle.sync()
      return { temporary, ino: (await handle.stat({ bigint: true })).ino }
    } finally {
      await handle.close()
    }
  } catch (error) {
    await unlink(temporary).catch(() => undefined)
    throw error
  }
}

/** What a publish reports: the inode of the config now standing, the files that stay beside it (empty when everything was deleted; the pending record stays otherwise) and whether the record says completed (`false`: the completed record could not be written, so nothing was deleted). */
type Published = {
  config: ConfigNumbers
  keptLeft: KeptFile[]
  isRecorded: boolean
}

/** Everything a replacement of an existing config works with: the staged file, the probe name, the displaced copy, the identity of the config that was read, the record that names them, and the stale receipt a first setup retires right before its link ({@link linkWithoutStaleReceipt}). */
type Replacement = {
  temporary: string
  probePath: string
  displaced: KeptCopy
  identity: FileIdentity
  journal: Pending
  staleReceipt: Receipt | undefined
}

/**
 * Links the staged file in at the config name, the step that exposes a publish; called by {@link createConfig} and {@link linkInStaged}.
 * A first setup's stale receipt ({@link isFirstSetup}) moves to its private name right before the link ({@link retireStaleReceipt}), so it goes only once this setup's own publish record, which names that move, is written, and no reader takes the new entry for that receipt's. When the link fails nothing of this setup stands, so that receipt goes back ({@link putBackRetiredReceipt}): a config that came back meanwhile is still owned by it, and an unrecorded removal's retry still answers `removed`. That put-back needs no free space and never replaces a newer receipt. Once the link stands the private name is deleted; one that cannot be deleted then is dropped by the next run while the publish record stays ({@link settleRetiredReceipt}), and otherwise stays in Codebook's records folder, where nothing reads it.
 * @param context - The run.
 * @param temporary - The staged file.
 * @param staleReceipt - The receipt of an entry that is gone, which a first setup retires; undefined for an update, a removal, a rollback and a first setup without a receipt.
 * @param journal - The publish record as written; its generation names the receipt's private name ({@link retiredReceiptPathOf}).
 * @throws A {@link staleReceiptRefusal} when that receipt cannot be moved aside, a {@link changedRecordRefusal} when another receipt stood at its name by then (nothing was linked); what the link throws, once the receipt is back. An {@link UnrestoredReceiptError} carrying that failure when the receipt could not go back.
 * @example
 * await linkWithoutStaleReceipt(context, temporary, staleReceipt, journal) // the config stands and receipt.json is gone
 */
async function linkWithoutStaleReceipt(
  context: Context,
  temporary: string,
  staleReceipt: Receipt | undefined,
  journal: Pending,
): Promise<void> {
  const retiredPath =
    staleReceipt && journal.generation
      ? await retireStaleReceipt(context, staleReceipt, journal.generation)
      : undefined
  try {
    await link(temporary, context.path)
  } catch (error) {
    // Nothing of this setup stands at the config name: the old receipt stands again, or the failure says where it is.
    if (retiredPath) await putBackRetiredReceipt(context, retiredPath, error)
    throw error
  }
  // The link stands: the old receipt covers nothing.
  if (retiredPath) await unlink(retiredPath).catch(() => undefined)
}

/**
 * Thrown by {@link putBackRetiredReceipt} when a receipt a first setup moved aside could not go back to `receipt.json`: its text names the private file and the way out, and it carries what made the put-back necessary (`failure`: the link's failure or a {@link changedRecordRefusal}), which the caller words as before and puts in front ({@link withUnrestoredNote}). The callers keep the publish record that names the private file ({@link Pending.retiresReceipt}), so the next run puts the receipt back ({@link settleRetiredReceipt}).
 */
class UnrestoredReceiptError extends Error {
  constructor(
    context: Context,
    retiredPath: string,
    readonly failure: unknown,
    cause: unknown,
  ) {
    super(
      `Codebook moved its own old record of a setup whose entry is gone from ${context.receiptPath} to ${retiredPath} and could not put it back, so the next run puts it back; if that fails too, move that file back by hand, ${context.retry}.`,
      { cause },
    )
  }
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
 * @param config - The inode the config will have.
 * @param journal - The record as it was written before the link-in; turns to completed once the config stands.
 * @param staleReceipt - The receipt a first setup moves aside right before the link and puts back when the link fails ({@link linkWithoutStaleReceipt}); undefined otherwise.
 * @returns The inode, and the staged name when it could not be unlinked afterwards or the completed record could not be written (its pending record stays then; recovery unlinks that name, which is another link to the config).
 * @throws A {@link refusal} when a file stands at the config name by then (it is left as it is); a {@link staleReceiptRefusal} or {@link changedRecordRefusal} when the stale receipt cannot be moved aside; nothing was published then. Each with the {@link UnrestoredReceiptError}'s sentence appended when that receipt could not go back; the pending record then stays, so the next run puts it back.
 */
async function createConfig(
  context: Context,
  temporary: string,
  config: ConfigNumbers,
  journal: Pending,
  staleReceipt: Receipt | undefined,
): Promise<Published> {
  try {
    context.seam?.afterCheck?.()
    await linkWithoutStaleReceipt(context, temporary, staleReceipt, journal)
  } catch (error) {
    await unlink(temporary).catch(() => undefined)
    const failure = failureOf(error)
    // A receipt that could not go back keeps the record that names its private name.
    if (failure === error) await dropPending(context)
    // A file that appeared meanwhile is the learner's: never replaced.
    throw withUnrestoredNote(
      codeOf(failure) === 'EEXIST' ? changedWhileWorking(context) : failure,
      error,
    )
  }
  context.seam?.afterPublish?.(undefined)
  // The config stands: the record says so, and the staged name is only another name of it.
  const didRecord = await markCompleted(context, journal)
  const isStagedGone = didRecord && (await didUnlink(temporary))
  return {
    config,
    keptLeft: isStagedGone ? [] : [{ path: temporary, holds: 'new' }],
    isRecorded: didRecord,
  }
}

/**
 * Moves the config aside to its private name as the first step of a replacement: whatever file stands at the config name at that instant is the file that moves, so it is the one that gets compared; called by {@link replaceConfig}.
 * @param context - The run.
 * @param replacement - The staged file, the probe name, the private name and the identity the config had when it was read.
 * @throws A {@link refusal} when the config changed since the read or is gone; or the hard link error of a file system that cannot link. The staged file and the pending record are removed then, because nothing moved.
 */
async function moveConfigAside(
  context: Context,
  { temporary, probePath, displaced, identity }: Replacement,
): Promise<void> {
  try {
    assertConfigUnchanged(context, identity)
    context.seam?.afterCheck?.()
    // The config name is empty until the link-in, so a file system that cannot link is found before anything moves; the probe's name is in the record.
    await link(temporary, probePath)
    await unlink(probePath)
    await rename(context.path, displaced.path).catch((error: unknown) => {
      throw codeOf(error) === 'ENOENT' ? changedWhileWorking(context) : error
    })
  } catch (error) {
    await unlink(temporary).catch(() => undefined)
    await dropPending(context)
    throw error
  }
}

/**
 * Puts a displaced file back at the config name after the comparison found it is not the file that was read, and refuses; called by {@link replaceConfig}.
 * @param context - The run.
 * @param replacement - The staged file (unlinked here) and the private name.
 * @param opened - The displaced file's handle and own mode; undefined when it could not be opened.
 * @throws Always: {@link changedWhileWorking} (or {@link linkedElsewhereRefusal} for a file another name reached, whose mode was never changed) after the file went back with its own permissions (a link never replaces, and the displaced name is unlinked), or a {@link leftCopyRefusal} naming the displaced file, which stays private, when a new config stands at the config name (it is kept) or the link failed.
 */
async function putDisplacedBack(
  context: Context,
  { temporary, displaced }: Replacement,
  opened: DisplacedHandle | undefined,
): Promise<never> {
  await unlink(temporary).catch(() => undefined)
  await restoreDisplaced(context, displaced.path, opened)
  throw mismatchRefusal(context, opened)
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
 * @param replacement - The staged file, the displaced file (whose bytes equal what was read), the record and the stale receipt.
 * @param opened - The displaced copy's handle and own mode.
 * @throws {@link newConfigRefusal} when a config appeared: the staged file is unlinked, the displaced copy is kept (a writer may still hold it open) and named, and the record turns to handed, so no later run deletes that copy. Any other link failure, a {@link staleReceiptRefusal} and a {@link changedRecordRefusal} put the displaced file back with its own permissions and rethrow it, or throw a {@link leftCopyRefusal} naming the displaced file when it cannot go back. Each with the {@link UnrestoredReceiptError}'s sentence appended when the stale receipt could not go back; the record then stays, so the next run puts it back.
 */
async function linkInStaged(
  context: Context,
  { temporary, displaced, journal, staleReceipt }: Replacement,
  opened: DisplacedHandle | undefined,
): Promise<void> {
  try {
    await linkWithoutStaleReceipt(context, temporary, staleReceipt, journal)
    return
  } catch (error) {
    await unlink(temporary).catch(() => undefined)
    const failure = failureOf(error)
    if (codeOf(failure) === 'EEXIST') {
      // A save created the config after the move-aside: it is kept, and the displaced copy is handed to the learner, never deleted by a later run.
      await handOver(context, journal)
      throw withUnrestoredNote(newConfigRefusal(context, displaced.path), error)
    }
    // The config name is empty: the displaced file goes back, else it is named; a receipt that could not go back keeps the record.
    await restoreDisplaced(
      context,
      displaced.path,
      opened,
      failure === error,
    ).catch((refusal: unknown) => {
      throw withUnrestoredNote(refusal, error)
    })
    throw withUnrestoredNote(failure, error)
  }
}

/**
 * Cleans up after the config was published: the record turns to completed, the displaced copy is deleted unless a writer changed it since the comparison, and the staged name is unlinked; called by {@link replaceConfig}.
 * @param context - The run.
 * @param replacement - The staged file, the displaced copy and the record.
 * @param held - The displaced copy as it was compared.
 * @returns The files that stay, each with what it holds (empty when everything was deleted), and whether the completed record was written; `false` means nothing was deleted, and a caller that must not report success without that record ({@link takeEntryOut}) refuses.
 */
async function settlePublished(
  context: Context,
  { temporary, displaced, journal }: Replacement,
  held: HeldCopy,
): Promise<Pick<Published, 'keptLeft' | 'isRecorded'>> {
  const { outcome, copy } = await discardDisplaced(
    context,
    journal,
    displaced.path,
    held,
  )
  const isStagedGone = await didUnlink(temporary)
  return {
    keptLeft: [
      ...(isStagedGone ? [] : [{ path: temporary, holds: 'new' as const }]),
      ...(outcome === 'deleted' ? [] : [copy]),
    ],
    isRecorded: outcome !== 'unrecorded',
  }
}

/**
 * Replaces an existing config without ever replacing a file that was not compared: the staged file is complete and flushed, the pending record names it, the probe and the private name, the config is moved aside, the displaced file is opened without following a link and made private, its inode and bytes are compared with what was read through that handle, and only then is the staged file linked in (a link never replaces).
 * A difference puts the displaced file back with its original permissions and refuses. A config that appeared at the name meanwhile is kept, together with the displaced copy, and the refusal names that copy. After a successful publish the displaced copy is deleted only while the same open file still has the size, times and bytes (hash read through the same handle) it had at the comparison; a copy that changed or was named in a refusal is handed to the learner and never deleted by a later run.
 * Limit of the delete: a write that lands between the final check and the unlink is not seen ({@link didCopyChange}), exactly as a write between the move-aside and the open is not.
 * Documented limit: between the move-aside and the link-in the config name holds nothing, so a Devin Desktop window that loads its MCP config in that instant starts without MCP servers until its next reload.
 * @param context - The run.
 * @param replacement - The staged file, the probe name, the private name, the identity the config had when it was read and the record.
 * @param config - The inode the config will have.
 * @returns The inode, the files that stay afterwards, if any (the pending record stays then), and whether the completed record was written.
 * @throws The refusals of {@link moveConfigAside}, {@link putDisplacedBack} and {@link linkInStaged}.
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
    await linkInStaged(context, replacement, opened)
    context.seam?.afterPublish?.(displaced.path)
    // From here the config is published; cleanup failures are reported and leave the pending record.
    return { config, ...(await settlePublished(context, replacement, held)) }
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
 * @param retiresReceipt - Whether a first setup moves a stale receipt aside right before its link ({@link Pending.retiresReceipt}).
 * @returns The record, not written yet.
 */
function journalOf(
  context: Context,
  head: FullHead,
  staged: { temporary: string; ino: bigint },
  serialized: string,
  displaced: KeptCopy | undefined,
  retiresReceipt: boolean,
): Pending {
  return {
    ...head,
    ...(context.rollbackOf !== undefined && {
      publishGeneration: context.rollbackOf,
    }),
    ...(retiresReceipt && { retiresReceipt: true }),
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
 * Publishes the config. The new bytes are staged first and their inode read from the open handle; the pending record then names the staged file, its inode, the probe name and the private name for the displaced file before anything is moved; the record stays from the first move on, because only the next run can tell how far a crash got.
 * A create links the staged file in ({@link createConfig}). A replacement moves the config aside, compares it and links the new file in ({@link replaceConfig}), so no file is replaced without being compared. The new file keeps the owner's permission bits only (`mode & 0o600`), so a rewrite never widens access.
 * Documented limit: between the move-aside and the link-in the config name holds nothing, so a Devin Desktop window that loads its MCP config in that instant starts without MCP servers until its next reload.
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
  const serialized = `${JSON.stringify(root, null, 2)}\n`
  assertWithinSizeLimit(context, serialized)
  const mode =
    look.kind === 'present'
      ? look.identity.mode & PRIVATE_FILE_MODE
      : PRIVATE_FILE_MODE
  const generation = head.generation ?? randomUUID()
  const staged = await stageConfigFile(
    journalPathOf(context.path, generation, 'staged'),
    serialized,
    mode,
  )
  const displaced = displacedCopyOf(context, look, generation)
  const journal = journalOf(
    context,
    { ...head, generation },
    staged,
    serialized,
    displaced,
    staleReceipt !== undefined,
  )
  try {
    await writeRecord(context, context.pendingPath, journal satisfies Pending)
  } catch (error) {
    // Nothing moved yet.
    await unlink(staged.temporary).catch(() => undefined)
    throw error
  }
  const config = { ino: recordedFileId(staged.ino) }
  return look.kind === 'present' && displaced
    ? replaceConfig(
        context,
        {
          temporary: staged.temporary,
          probePath: journalPathOf(context.path, generation, 'probe'),
          displaced,
          identity: look.identity,
          journal,
          staleReceipt,
        },
        config,
      )
    : createConfig(context, staged.temporary, config, journal, staleReceipt)
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
 * @throws A {@link refusal} when the file changed or the copy cannot go back; nothing is deleted.
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
 * @throws A {@link refusal} after a different file was put back, or naming the copy when it cannot go back.
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
      await dropPending(context)
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
 * @throws A {@link savedAgainRefusal} when a file stands at the config name; the receipt and that file stay as they are.
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
  await dropPending(context)
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
  const unsafe = (cause?: unknown) =>
    new Error(
      `Codebook's Devin Desktop MCP record at ${path} is a link, no regular file, larger than ${DEVIN_MCP_RECORD_LIMIT_BYTES} bytes or not readable, so the config was left untouched; remove that record, ${retry}.`,
      cause === undefined ? undefined : { cause },
    )
  let file
  try {
    file = await openWithoutFollowing(path)
  } catch (error) {
    if (codeOf(error) === 'ENOENT') return undefined
    throw unsafe(error)
  }
  let text: string
  try {
    const status = await file.stat().catch((error) => {
      throw unsafe(error)
    })
    if (!status.isFile() || status.size > DEVIN_MCP_RECORD_LIMIT_BYTES)
      throw unsafe()
    const bytes = await readWithinLimit(
      file,
      status.size,
      DEVIN_MCP_RECORD_LIMIT_BYTES,
      () => seam?.afterStat?.(path),
    ).catch((error) => {
      throw unsafe(error)
    })
    if (!bytes) throw unsafe()
    text = bytes.toString('utf8')
  } finally {
    await file.close()
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
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
 * Writes one of Codebook's own records (the receipt, `pending.json` or a rollback's journal) atomically; every record write of a run goes through here, so a test sees each one at {@link DevinMcpTestSeam.beforeRecordWrite}.
 * @param context - The run; its seam is called with the path and the value after the bytes were flushed and before the rename.
 * @param path - The record file.
 * @param value - The complete record.
 * @throws When the record is larger than {@link DEVIN_MCP_RECORD_LIMIT_BYTES}, the temporary file cannot be written or renamed, or the seam throws; the previous record then stays byte for byte.
 * @example
 * await writeRecord(context, context.pendingPath, { ...journal, phase: 'completed' })
 */
function writeRecord(
  context: Context,
  path: string,
  value: unknown,
): Promise<void> {
  return atomicPrivateWrite(path, value, DEVIN_MCP_RECORD_LIMIT_BYTES, () =>
    context.seam?.beforeRecordWrite?.({ path, record: value }),
  )
}

/** The receipt, when it covers this run's config path. */
async function readReceipt(context: Context): Promise<Receipt | undefined> {
  const receipt = await readRecord(
    context.receiptPath,
    receiptSchema,
    context.retry,
    context.seam,
  )
  return receipt?.targetPath === context.path ? receipt : undefined
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
  /** Set when the copy was just handed to the learner ({@link HandedCopyError}): the record turns to handed and the refusal names the copy as kept. */
  isHandedOver?: boolean
  /** The inode the handed copy's name shows when the copy is handed over ({@link unsettledOf}); the handed record names it ({@link handedRecordOf}), because a copy that only its bytes proved, or a name a sync tool swapped meanwhile, has another inode than the recorded one. */
  handedIno?: bigint
  /** Set by {@link inspect} when the handed record could not be written: the refusal then says that a later run may check the copy again ({@link bothFilesRefusal}) instead of promising that both paths stay. */
  isHandoverUnrecorded?: boolean
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
  // A file under a Codebook name that is not the inode Codebook recorded is somebody else's; the displaced one is named with the way to get it back.
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
}

/**
 * Tells whether a leftover's name still shows the file that was checked; called right before each link and unlink of a leftover ({@link tidyLeftover}, {@link putBackDisplaced}, {@link discardDisplaced}), because a sync tool may swap another file in between the first look and the call.
 * Limit: a swap between this look and the syscall that follows is not seen; no Node primitive links or unlinks by inode.
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
 * Tells whether a name still shows the file that was checked, like {@link isLeftoverStill}, without holding the extension host's thread; called by {@link assertSharedPutBackBytes} and {@link dropPutBackName}, whose name then goes only through {@link dropCheckedName}, which moves it aside and checks the moved file again, so no synchronous look right before that step is needed.
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
  context.seam?.beforeLeftoverCheck?.(path)
  const now = await lstat(path, { bigint: true }).catch((error: unknown) => {
    if (codeOf(error) === 'ENOENT') return undefined
    throw error
  })
  const isStill = showsChecked(now, checked)
  if (isStill) context.seam?.afterLeftoverCheck?.(path)
  return isStill
}

/**
 * Compares what a look at a name found with what was checked; used by {@link isLeftoverStill} and {@link isNameStill}.
 * @param now - The name's status, undefined when nothing stands there.
 * @param checked - The inode that was checked and, when given, the size and times of the last read.
 * @returns `true` when the name shows that inode with those size and times.
 * @example
 * showsChecked(undefined, { ino: 42n }) // => false
 */
function showsChecked(
  now: Pick<BigIntStats, 'ino' | 'size' | 'mtimeNs' | 'ctimeNs'> | undefined,
  checked: LeftoverLookback,
): boolean {
  return (
    now !== undefined &&
    checked.ino === now.ino &&
    (checked.size === undefined || checked.size === now.size) &&
    (checked.mtimeNs === undefined || checked.mtimeNs === now.mtimeNs) &&
    (checked.ctimeNs === undefined || checked.ctimeNs === now.ctimeNs)
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
 * Thrown by {@link configChangedError} when the config name changed while recovery read a private copy or was about to unlink it; its own text names both files and says never to copy the copy over the config, so {@link unsettledRefusal} shows it as it is instead of the move-it-back advice, which would put an old file over a new save.
 */
class ConfigChangedError extends Error {}

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

/**
 * Thrown by {@link assertLinkedBytes} when the put-back check failed; its own text names both paths and the state, so {@link unsettledRefusal} shows it as it is instead of the move-it-back advice.
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
 * Tells whether a recovery failure's own text names both files and what stays ({@link PutBackCheckError}, {@link ConfigChangedError}), so it is shown as it is; called by {@link unsettledRefusal} and {@link mergeWithLeftover}.
 * @param cause - What stopped the leftover's recovery.
 * @returns `true` for those two errors; `false` for every other failure, which {@link unsettledRefusal} words itself.
 * @example
 * namesBothFiles(configChangedError(context, keptPath)) // => true
 * namesBothFiles(new Error('busy'))                     // => false
 */
function namesBothFiles(cause: unknown) {
  return (
    cause instanceof PutBackCheckError || cause instanceof ConfigChangedError
  )
}

/** Tells whether a recovery failure hands the copy to the learner ({@link HandedCopyError}, or a {@link PutBackCheckError} that left an unverified file at the config name). */
function isHandedCause(cause: unknown): boolean {
  return (
    cause instanceof HandedCopyError ||
    (cause instanceof PutBackCheckError && cause.isHanded)
  )
}

/** The refusal for a displaced file that has another inode than the record says while a config stands at the config name: it may be a newer save of the learner's, so nothing is moved or deleted and the record stays. */
function otherInodeRefusal(
  { path, pendingPath, retry }: Context,
  copyPath: string,
): Error {
  return new Error(
    `Codebook's Devin Desktop MCP record at ${pendingPath} names a private file at ${copyPath} that is not the config Codebook moved aside (it may be a newer save of yours) while another config stands at ${path}, so nothing was moved or deleted; to get that file back move it over the config, or delete it, then remove that record, ${retry}.`,
  )
}

/**
 * Recovers what an interrupted run left under the private names its pending record holds; called by {@link inspect} before the config is read.
 * Every name must be a bare name Codebook made beside the config with the inode the record holds, checked for all of them before any is moved, linked or deleted. Each leftover is then settled on its own: one that cannot be settled stays and is returned, and the others are still settled.
 * - A displaced config of a write or removal that was still in progress, while the config name is empty: it goes back with a link, which never replaces anything, only while it still has the recorded inode or the recorded bytes; a file with both different (a sync or backup tool replaced it) stays private, the config name stays empty and the refusal names it. When the config name is another name of the same file (a put-back interrupted after its link), the extra displaced name is unlinked; when only the bytes ever proved that file (another inode than the recorded one), only after the shared bytes were checked against the record ({@link assertSharedPutBackBytes}).
 * - A displaced or staged file that holds exactly the bytes the record names: it is Codebook's own leftover and is deleted. After a finished publish or removal (a completed record) it is never put back.
 * - A staged or displaced name that is another link to the config itself: unlinked, whatever the config holds now; the config keeps the inode.
 * - The probe link of the hard-link check: deleted.
 * - A copy handed to the learner (a handed record): never touched. A record handed only because a put-back by bytes was cut short ({@link Pending.bytesUnverified}) is read as in progress ({@link leftoverPhaseOf}).
 * - A displaced name of a change in progress that is gone while its dropping name stands (a drop cut short right after its rename, {@link dropCheckedName}): the file goes back to the displaced name and is settled from there ({@link lookPastCutShortDrop}).
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
      unsettled.push(await unsettledOf(leftover, look, cause))
    }
  }
  return unsettled
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
 * @param leftover - The accepted leftover.
 * @param look - What {@link lookAtLeftover} found at its name.
 * @param cause - What stopped its recovery.
 * @returns The entry; a copy handed to the learner ({@link isHandedCause}) also carries the inode its name shows now, which its handed record names ({@link handedRecordOf}): a sync tool may have swapped another file in at the name while recovery checked it, and a record naming the inode of the first look would refuse that file at every later run ({@link otherInodeRefusal}). When the name cannot be looked at (it is gone, for example), the first look's inode stays.
 * @example
 * await unsettledOf(leftover, { kind: 'found', copy }, sharedBytesError(context, keptPath)) // => { leftover, cause, isHandedOver: true, handedIno: 42n } (the inode the name shows now)
 * await unsettledOf(leftover, { kind: 'found', copy }, new Error('busy'))                   // => { leftover, cause }
 */
async function unsettledOf(
  leftover: Leftover,
  look: LeftoverLook,
  cause: unknown,
): Promise<Unsettled> {
  if (!isHandedCause(cause)) return { leftover, cause }
  // Only a found copy is ever handed over ({@link tidyLeftover}).
  const firstIno = look.kind === 'found' ? look.copy.ino : undefined
  const handedIno = await lstat(leftover.path, { bigint: true }).then(
    ({ ino }) => ino,
    () => firstIno,
  )
  return {
    leftover,
    cause,
    isHandedOver: true,
    ...(handedIno !== undefined && { handedIno }),
  }
}

/**
 * Words the one leftover a run reports: a leftover of a finished or handed change is said once ({@link completedLeftRefusal}) and then no longer tracked; one of a change in progress stays named.
 * @param context - The run.
 * @param phase - The phase recovery read the pending record in ({@link leftoverPhaseOf}).
 * @param reported - The unsettled leftover to name.
 * @returns The refusal, not thrown yet.
 */
function unsettledRefusal(
  context: Context,
  phase: Pending['phase'],
  { leftover, cause, isHandedOver, isHandoverUnrecorded }: Unsettled,
): Error {
  // The put-back check's and the changed config's own texts name both paths and the state; the move-back advice would lose a new save.
  if (namesBothFiles(cause))
    return bothFilesRefusal(cause, leftover.path, phase, isHandoverUnrecorded)
  if (isHandedOver) return newConfigRefusal(context, leftover.path)
  return phase
    ? completedLeftRefusal(context, leftover.path, cause)
    : leftCopyRefusal(context, leftover.path, cause)
}

/**
 * Words a leftover whose own failure text names both files and what stays ({@link namesBothFiles}); called by {@link unsettledRefusal}.
 * That text says what this run did. One sentence follows when what happens to the copy next differs from what it implies: a handover whose record could not be written (a later run may check the copy again), or a leftover of a finished or handed change, which recovery reports once and never puts back, so the learner may delete it.
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
  // A finished or handed change's leftover is reported once and never put back.
  if (phase)
    return new Error(
      `${cause.message} Codebook left ${copyPath} from a change that had already finished, so delete that file when you no longer need it.`,
      { cause },
    )
  return cause
}

/**
 * Builds the record that stays after a recovery: only the unsettled leftovers' names, inodes and hashes, so the next run retries just those.
 * @param pending - The record recovery keeps ({@link recordAfterRecovery}); its phase, and its unverified mark ({@link Pending.bytesUnverified}) while the displaced file stays tracked, carry over.
 * @param tracked - The unsettled leftovers that stay tracked; for a finished or handed record the one reported is left out ({@link unsettledRefusal}).
 * @returns The reduced record; undefined when nothing stays tracked.
 */
function retainedRecord(
  pending: Pending,
  tracked: Unsettled[],
): Pending | undefined {
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

/** Ends the pending record of a settled run: it is deleted, or rewritten with only the leftovers that stay. */
async function retirePending(
  context: Context,
  retained: Pending | undefined,
): Promise<void> {
  if (retained) await writeRecord(context, context.pendingPath, retained)
  else await rm(context.pendingPath, { force: true })
}

/**
 * Puts back or deletes one leftover; called by {@link recoverLeftovers}.
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
    assertLeftoverStill(context, path, { ino: copy.ino })
    return unlink(path)
  }
  // A copy handed to the learner is never touched, not even when the learner linked it back to the config (checked before the same-inode branch).
  if (role === 'kept' && phase === 'handed')
    throw new Error('The copy was handed to the learner.')
  const config = lstatSync(context.path, {
    bigint: true,
    throwIfNoEntry: false,
  })
  // The staged or displaced name of a config that has the same inode is only another name of it (a put-back whose unlink failed, or a published staged file): drop the name, the config keeps the inode and whatever the learner wrote since.
  if (config?.ino === copy.ino)
    return dropSecondName(context, leftover, copy, phase)
  // A displaced original of an unfinished change while another config stands at the config name (an editor saved after the move-aside): it may be the only copy of the learner's other servers, so it is handed over and named, never deleted. The published staged file's inode means the change did finish, so that copy is Codebook's own leftover.
  // When the check returns, the config is the published staged file: its inode is checked again right before the unlink.
  const publishedIno =
    role === 'kept' && phase === undefined && config ? config.ino : undefined
  if (publishedIno !== undefined)
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
  if (copy.sha256 !== expectedSha256)
    throw new Error('The leftover file differs from what Codebook expected.')
  assertLeftoverStill(context, path, { ino: copy.ino, size: copy.size })
  // Same-size overwrites keep inode and size: hash the file again right before deleting it.
  let lastLook = await inspectCopy(path, context.seam)
  // The file went away while it was read: whatever stands at the name now was never hashed, so nothing is deleted.
  if (!lastLook) return
  assertLeftoverHoldsChecked(path, lastLook, copy.ino, expectedSha256)
  if (publishedIno !== undefined) {
    // A save by rename or in place may have changed the published config since the first look. Its read is async, so another writer can change the displaced copy meanwhile: the copy is hashed again after it, and that read is the last async step.
    const publishedLook = await assertConfigStillPublished(
      context,
      pending,
      publishedIno,
      path,
    )
    lastLook = await inspectCopy(path, context.seam)
    if (!lastLook) return
    assertLeftoverHoldsChecked(path, lastLook, copy.ino, expectedSha256)
    // Only synchronous looks follow: the config name first, the displaced name last. The config must also show the size and times it had at its hash: an in-place rewrite during the copy's read keeps the inode.
    assertConfigUnchangedSince(context, publishedLook, path)
  }
  // The hash came from the open handle; the unlink acts on the name, which must still show that same file with the size and times it had at its last hash.
  assertLeftoverStill(context, path, lastLook)
  await unlink(path)
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
 * The config name is checked first and the leftover name last, right before the unlink: only the syscall gap after that last look remains, and no check after the leftover's own can let a swap of that name pass.
 * @param context - The run.
 * @param leftover - The accepted leftover.
 * @param copy - What {@link lookAtLeftover} found at its name.
 * @param phase - The phase recovery reads the record in ({@link leftoverPhaseOf}).
 * @throws When either name changed since it was looked at, the shared bytes cannot be verified ({@link assertSharedPutBackBytes}) or the unlink fails; both names stay then.
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
  // Only the bytes ever proved this file: the config may hold bytes nobody checked, so the private name goes only once they are verified.
  if (isSharedBytesPutBack(role, phase, expectedIno, copy))
    return assertSharedPutBackBytes(context, path, copy, expectedSha256)
  assertConfigStill(context, copy.ino, path)
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
 * Both names show one inode, so the unlink loses no data; what must never happen is that the config keeps bytes Codebook did not verify while the private name, the only sign of that, goes. The first look's hash must be the recorded one, a read of the config name and then of the private name must both show that inode and hash, and looks at both names, the config name first and the private name last, must still see the size and times of those reads. The looks wait for the file system without holding the extension host's thread ({@link isNameStill}); the private name then goes only through {@link dropCheckedName}, which moves it aside and checks the moved file again.
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

/** The end Codebook gives a private name while it drops that name ({@link dropCheckedName}): the name is renamed to `<private name>.codebook-dropping` first, a name no other program uses. */
const DROPPING_SUFFIX = 'codebook-dropping'

/**
 * Deletes a private name that is a second name of the config only while it still names the file Codebook checked; called by {@link assertSharedPutBackBytes} and {@link putBackDisplaced} right after their last looks.
 * The name is renamed first to `<private name>.codebook-dropping` ({@link DROPPING_SUFFIX}), so a file another program swaps in at the private name after the last look moves with the rename instead of being deleted. The moved file is read again and deleted only while it has the checked inode, the checked bytes when they are given, and another name (the config's) that still reaches it; anything else is linked back to the private name, which a link never replaces, and the run refuses.
 * Limits: a write into the shared file or a save at the config name after that read is not seen (no Node primitive unlinks by inode or content). A stop between the rename and the unlink leaves the moved name, a second name of the config that no record holds; the record still holds the private name, so the next run puts the file back there and settles it again ({@link settleDroppingName}).
 * @param context - The run; its seam is called when the moved file is read.
 * @param path - The private name to drop.
 * @param checked - The inode the moved file must have, and the hash of the bytes it must hold when a check read them (a put-back by inode accepts any bytes).
 * @param refuse - Builds the error thrown once the moved file stands at the private name again.
 * @throws `refuse()` when the moved file is not the checked one, holds other bytes, cannot be read or is the only name of its file; a {@link PutBackCheckError} naming the moved name when that file cannot go back; what the rename throws (nothing moved then) and what the unlink throws (the file went back first).
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
  await rename(path, droppingPath)
  const moved = await inspectCopy(droppingPath, context.seam).catch(
    () => undefined,
  )
  // The checked file with the checked bytes, which the config name also reaches: dropping this name loses nothing.
  const isChecked =
    moved?.ino === checked.ino &&
    (checked.sha256 === undefined || moved.sha256 === checked.sha256) &&
    moved.nlink > 1n
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
 * A stop right after the drop's rename leaves the file only at the dropping name, a second name of the config that would make every later setup and removal refuse the config as linked from another path ({@link assertSingleLink}). The file goes back with a link, which never replaces a file that stands at the private name, and the dropping name goes only while both names show the inode the dropping name showed at the first look, so recovery checks the file under its private name as it did before the drop began. The name is Codebook's alone, so no record format changes.
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
    !isLeftoverStill(context, path, { ino: moved.ino }) ||
    !isLeftoverStill(context, droppingPath, { ino: moved.ino })
  )
    throw notMovedBackError(context, path, droppingPath)
  await unlink(droppingPath)
  return true
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
 * @throws An error naming `leftoverPath` when the config changed.
 */
function assertConfigUnchangedSince(
  context: Context,
  look: InspectedCopy,
  leftoverPath: string,
): void {
  const { ino, size, mtimeNs, ctimeNs } = look
  if (!isLeftoverStill(context, context.path, { ino, size, mtimeNs, ctimeNs }))
    throw configChangedError(context, leftoverPath)
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
 * The name is looked at again right before the link and before it goes ({@link isLeftoverStill}); after the link the config name must show the checked inode. When it shows another one and the leftover name shows that same inode, the link itself made this name, so the config name is unlinked again and the leftover is refused; when the leftover name changed again too, Codebook cannot prove which name it made, so both stay and the refusal says so. The displaced name goes only through {@link dropPutBackName}, which moves it aside and checks the moved file again, so a file swapped in after the last look is never deleted.
 * Limit: a swap between the look before the link and the link is not seen.
 * A put-back that only the bytes prove first rewrites the record as handed and unverified ({@link Pending.bytesUnverified}), after the second hash and before the link: a run that stops between the link and the check then leaves a record that older builds never delete from and that this build checks at its next run ({@link assertSharedPutBackBytes}). When that write fails nothing is linked; once the check passed and the private name is gone, the record goes back to what it said, best effort. A step after that write that throws writes the record back as it was read, best effort, unless the displaced name stays an unverified second name of the config ({@link restoreUnlessSecondName}).
 * @param context - The run.
 * @param leftover - The displaced name and the hash the record holds for it.
 * @param pending - The pending record of the interrupted run; its phase as recovery reads it ({@link leftoverPhaseOf}) must be absent.
 * @param isConfigAbsent - Whether nothing stands at the config name.
 * @param proof - What shows the displaced file is the recorded one: `inode` (the recorded inode) or `bytes` (another inode whose bytes equal the recorded hash); undefined when neither, and such a file is never published. When only the bytes prove it, the file is hashed again right before the link, its name is looked at synchronously with the size and times of that hash, and the file at the config name is hashed once more after the link: an in-place write in between is refused and nothing stays published from it.
 * @param copy - What {@link lookAtLeftover} found; its inode is the one that may be linked.
 * @returns `true` when the file went back (a link never replaces, and the displaced name is unlinked); `false` when the change was finished, the config name is taken or the file is not the recorded one.
 * @throws When the unverified record cannot be written, the link or unlink fails, the name no longer shows the checked file, or the link produced another file.
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
    assertLeftoverStill(context, path, lastLook)
    await link(path, context.path)
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
    // The unverified record must not outlive the state it describes: also where the run keeps pending.json as it finds it (an unrecorded removal).
    if (proof === 'bytes')
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
 * Tells whether a pending record is that of a removal of this config that took the entry out and never recorded its completion; called by {@link settlePending} and {@link hasUnrecordedRemoval}.
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
 * @returns The receipt that now stands.
 * @throws A {@link refusal} when the entry is neither the pending one nor the receipted one.
 * @example
 * const receipt = await settlePending(context, current, await readReceipt(context), pending, look, undefined)
 */
async function settlePending(
  context: Context,
  current: unknown,
  receipt: Receipt | undefined,
  pending: Pending | undefined,
  look: ConfigLook,
  retained: Pending | undefined,
): Promise<Receipt | undefined> {
  if (!pending) return receipt
  // A publish whose take-back is owed is never adopted, whatever the config holds now: the record ends without a receipt (the take-back, if it stood, already ran or refused before this point).
  if (isTakeBackOwed(pending, receipt)) {
    await retirePending(context, retained)
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
      retained,
    )
  if (isPendingStale(context, pending, current, receipt)) {
    // The rename never happened (or this was a removal): the pending record is stale; the leftovers that stay remain tracked.
    await retirePending(context, retained)
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
 * @param context - The run.
 * @param pending - The pending record.
 * @param entrySha256 - The pending hash.
 * @param identity - The identity of the config that stands.
 * @param retained - What stays of the record after recovery; undefined when nothing stays.
 * @returns The receipt that was written.
 */
async function adoptPending(
  context: Context,
  pending: Pending,
  entrySha256: string,
  identity: FileIdentity,
  retained: Pending | undefined,
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
    installationId:
      pending.installationId ?? installationIdOf(await readReceipt(context)),
    config: { ino: recordedFileId(identity.ino) },
  }
  await writeRecord(context, context.receiptPath, adopted)
  await retirePending(context, retained)
  return adopted
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
  return new Error(
    `Codebook could not delete its own old record of a setup whose entry is gone, at ${receiptPath}, so it changed nothing; delete that record by hand, ${retry}.`,
    { cause },
  )
}

/**
 * Builds the refusal for a stale receipt that another program saved again between this run's read and its move aside (a sync or backup tool restoring one); called by {@link retireStaleReceipt} once that receipt went back to its name.
 * @param context - The run; gives the receipt's path, the config path and the command to run again.
 * @returns The error, not thrown yet.
 * @example
 * throw changedRecordRefusal(context) // 'Codebook found that its own old record at …/receipt.json changed while it was setting up, so it put that record back and changed nothing in Devin Desktop's MCP config at …; then run Codebook: Set Up AI Chat again.'
 */
function changedRecordRefusal({ receiptPath, path, retry }: Context): Error {
  return new Error(
    `Codebook found that its own old record at ${receiptPath} changed while it was setting up, so it put that record back and changed nothing in Devin Desktop's MCP config at ${path}; ${retry}.`,
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

/**
 * Moves the receipt of an entry that is gone to its private name ({@link retiredReceiptPathOf}) right before a first setup links its config in, so no reader takes the new entry for that receipt's, and a run that stops before the new receipt leaves an entry that is taken back; called by {@link linkWithoutStaleReceipt} when {@link isFirstSetup} held and a receipt stood, once the setup's own publish record, which names that move ({@link Pending.retiresReceipt}), is written.
 * Safe because the entry that receipt owned no longer stands, so it covers nothing. A move instead of a delete: putting the receipt back after a failed link needs no free space ({@link putBackRetiredReceipt}). Only a regular file moves, and the file that moved must hold the receipt this run read: another one, saved at that name since, goes back and the setup refuses.
 * @param context - The run.
 * @param staleReceipt - The receipt this run read.
 * @param generation - The generation of the publish; names the private path.
 * @returns The private path that holds the receipt now; undefined when nothing stood at the receipt's name any more, so nothing is to put back.
 * @throws A {@link staleReceiptRefusal} when the name holds no regular file or the move fails, and a {@link changedRecordRefusal} once another receipt that moved went back; nothing is linked then. An {@link UnrestoredReceiptError} carrying that refusal when the other receipt could not go back.
 * @example
 * await retireStaleReceipt(context, receipt, generation) // => '/storage/devin-mcp/receipt.json.<generation>.retired'
 */
async function retireStaleReceipt(
  context: Context,
  staleReceipt: Receipt,
  generation: string,
): Promise<string | undefined> {
  const retiredPath = retiredReceiptPathOf(context, generation)
  try {
    const status = await lstatOrAbsent(context.receiptPath)
    if (!status) return undefined
    if (!status.isFile()) throw new Error('The record is no regular file.')
    await rename(context.receiptPath, retiredPath)
  } catch (cause) {
    // Gone between the look and the move: nothing stands to put back.
    if (codeOf(cause) === 'ENOENT') return undefined
    throw staleReceiptRefusal(context, cause)
  }
  if (await holdsReceipt(context, retiredPath, staleReceipt)) return retiredPath
  // Another receipt was saved at that name since the read: it goes back, and nothing is published.
  const changed = changedRecordRefusal(context)
  await putBackRetiredReceipt(context, retiredPath, changed)
  throw changed
}

/**
 * Tells whether a record file holds the given receipt, read without following a link; called by {@link retireStaleReceipt} on the file it just moved aside.
 * @param context - The run.
 * @param path - The record file.
 * @param expected - The receipt it must hold.
 * @returns `true` when the file parses to the same receipt (compared in canonical form); `false` when it holds another one or cannot be read as a receipt.
 * @example
 * await holdsReceipt(context, retiredPath, receipt) // => true right after the move of the receipt that was read
 */
async function holdsReceipt(
  context: Context,
  path: string,
  expected: Receipt,
): Promise<boolean> {
  const moved = await readRecord(
    path,
    receiptSchema,
    context.retry,
    context.seam,
  ).catch(() => undefined)
  return moved !== undefined && canonicalJson(moved) === canonicalJson(expected)
}

/**
 * Puts a receipt that a first setup moved aside back at `receipt.json`; called by {@link linkWithoutStaleReceipt} when the link failed, by {@link retireStaleReceipt} when the file that moved was not the receipt it read, and by {@link settleRetiredReceipt} at a later run.
 * A hard link: it needs no free space and never replaces a receipt that stands at that name by then (a newer one, which is kept while the moved one goes). The private name is unlinked afterwards; one that cannot be is only a second name of the receipt.
 * @param context - The run.
 * @param retiredPath - The private name that holds the receipt.
 * @param failure - What made the put-back necessary, carried by the error below so the caller still words it; undefined at a later run.
 * @throws An {@link UnrestoredReceiptError} naming the private file when the receipt could not go back; that file stays, and so does the publish record that names it.
 * @example
 * await putBackRetiredReceipt(context, retiredPath, linkError) // receipt.json stands again
 */
async function putBackRetiredReceipt(
  context: Context,
  retiredPath: string,
  failure?: unknown,
): Promise<void> {
  try {
    await link(retiredPath, context.receiptPath)
  } catch (cause) {
    // A newer receipt stands, which wins, or the private name is gone already.
    const code = codeOf(cause)
    if (code !== 'EEXIST' && code !== 'ENOENT')
      throw new UnrestoredReceiptError(context, retiredPath, failure, cause)
  }
  await unlink(retiredPath).catch(() => undefined)
}

/**
 * Settles the private name of a stale receipt that a first setup moved aside and did not settle itself (it stopped between the move and the link, or right after the link, or the put-back failed); called by {@link settleAfterRecovery} before the receipt is read.
 * While the config name shows the inode the setup published, its link stood: the old receipt covers nothing and must not come back beside that entry, which the take-back removes ({@link finishCutShortSetup}), so the private name is deleted. Otherwise nothing of that setup stands, and the receipt goes back ({@link putBackRetiredReceipt}), never over a newer one. A config name that cannot be looked at decides nothing: the run stops before the config is read, because a read that works a moment later could settle the publish record and leave the private name for good; the private name and the record stay, so the next run settles them again.
 * @param context - The run.
 * @param pending - The publish record as read; only one of this config that names the move ({@link Pending.retiresReceipt}) with a valid generation leads to a private name.
 * @throws The {@link unreadableRefusal} when the config name cannot be looked at, and the {@link UnrestoredReceiptError} when the receipt could not go back; the record stays as it was read.
 * @example
 * await settleRetiredReceipt(context, pending) // receipt.json stands again after a setup whose link failed and whose put-back failed too
 */
async function settleRetiredReceipt(
  context: Context,
  pending: Pending | undefined,
): Promise<void> {
  const generation = pending?.generation
  if (
    !pending?.retiresReceipt ||
    pending.targetPath !== context.path ||
    generation === undefined ||
    !GENERATION_PATTERN.test(generation)
  )
    return
  const retiredPath = retiredReceiptPathOf(context, generation)
  // A failed look decides nothing: the run stops here, so the private name and the record wait for the next run.
  const config = await lstatOrAbsent(context.path).catch((cause: unknown) => {
    throw unreadableRefusal(context, cause)
  })
  const { stagedIno } = pending
  // The setup's link stood: the old receipt is deleted, never put back beside that entry.
  if (config && stagedIno !== undefined && isSameFileId(stagedIno, config.ino))
    return unlink(retiredPath).catch(() => undefined)
  await putBackRetiredReceipt(context, retiredPath)
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
 * @throws The failure of the receipt write; the entry and the config stay as they were.
 * @example
 * await withInstallationId(context, receipt)
 */
async function withInstallationId(
  context: Context,
  receipt: Receipt,
): Promise<void> {
  if (receipt.installationId) return
  await writeRecord(context, context.receiptPath, {
    ...receipt,
    installationId: randomUUID(),
  })
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

/** How a first setup's rollback ended: `took-out` (the entry is gone), `replaced-config` (another file stands at the config path, so it was left alone), `not-ours` (the file is gone, or its `codebook` entry is no longer the one this setup wrote, so nothing was touched and nothing may be removed by hand on Codebook's word) `unreadable` (the file could not be read again, so Codebook never confirmed the entry as its own and touched nothing) or `not-taken-out` (Codebook's own entry, confirmed as its own, could not be taken out); `keptLeft` holds the copies the rollback itself left. */
type RollbackResult = {
  outcome:
    'took-out' | 'replaced-config' | 'not-ours' | 'unreadable' | 'not-taken-out'
  keptLeft: KeptFile[]
  /** Set with `took-out`: whether the whole file went or only the entry. */
  removal?: 'file-removed' | 'removed'
}

/**
 * Takes the entry out of the config file a first setup published, never of another file; called by {@link takeOutUnrecordedEntry}.
 * The rollback writes its own journal beside the setup's pending record ({@link rollbackContextOf}), so a crash or failure during it leaves the setup's record, the proof that the entry is Codebook's, intact.
 * @param context - The run.
 * @param written - The receipt that could not be written; its `config.ino` is the file the setup published.
 * @returns The {@link RollbackResult}; a config that cannot be read again is `unreadable` and left unchanged; a config that was saved again meanwhile (another inode) is `replaced-config` even when it holds the same entry, and is left unchanged; a missing file or an entry that no longer hashes like this setup's is `not-ours`.
 * @throws The refusals of {@link takeEntryOut}, after the entry was confirmed as Codebook's own; the caller turns them into `not-taken-out`.
 */
async function rollBackPublishedEntry(
  context: Context,
  written: Receipt,
): Promise<RollbackResult> {
  let look: ConfigLook
  try {
    look = await lookAtConfig(context)
  } catch {
    // The re-read failed (a link swapped in, no permission): the entry was never confirmed as Codebook's, so nothing is touched.
    return { outcome: 'unreadable', keptLeft: [] }
  }
  // The file is gone or its entry is no longer the one this setup wrote (an editor saved another one): the learner's entry is never Codebook's to remove.
  if (
    look.kind !== 'present' ||
    !ownsEntry(look.servers?.[SERVER_NAME], written)
  )
    return { outcome: 'not-ours', keptLeft: [] }
  // An editor saved a new file (a new inode) with the same entry: that file is not the one Codebook published, so it stays untouched.
  if (!isSameFileId(written.config.ino, look.identity.ino))
    return { outcome: 'replaced-config', keptLeft: [] }
  const { keptLeft, status } = await takeEntryOut(
    rollbackContextOf(context, written.generation),
    { look, receipt: written },
  )
  return { outcome: 'took-out', keptLeft, removal: status }
}

/**
 * The run with a pending record of its own for a rollback, so the setup's record is never overwritten; its name differs from the one {@link recoverLeftovers} reads.
 * @param context - The run.
 * @param publishGeneration - The generation of the publish being rolled back; every journal of the rollback records it. Omit it to only read or settle a journal.
 * @returns The rollback's context.
 */
function rollbackContextOf(
  context: Context,
  publishGeneration?: string,
): Context {
  return {
    ...context,
    pendingPath: `${context.pendingPath}.rollback`,
    ...(publishGeneration !== undefined && { rollbackOf: publishGeneration }),
  }
}

/**
 * Builds the sentence about the copies of the learner's previous config that stay after a failed first setup.
 * @param keptLeft - The files the publish left, with what they hold.
 * @returns An empty string when nothing stays, else a sentence naming each copy.
 * @example
 * keptCopiesSentence([]) // => ''
 */
function keptCopiesSentence(keptLeft: KeptFile[]): string {
  return keptLeft
    .filter(({ holds }) => holds === 'previous')
    .map(
      ({ path, isLeftover }) =>
        ` Codebook also kept ${keptCopyPhrase(path)}${isLeftover ? `, ${LEFTOVER_CLAUSE}` : '; delete that copy when you no longer need it'}.`,
    )
    .join('')
}

/**
 * Words how a failed first setup's rollback ended as one clause; used by {@link takeOutUnrecordedEntry} and {@link finishCutShortSetup}.
 * A by-hand removal is asked for only when the entry was confirmed as Codebook's own and could not be taken out.
 * @param outcome - The {@link RollbackResult} outcome.
 * @returns A clause that follows a comma and states what Codebook did with the file and what the learner should check.
 * @example
 * rollbackOutcomeClause('took-out') // => 'so it took that entry out again and changed nothing else'
 */
function rollbackOutcomeClause(outcome: RollbackResult['outcome']): string {
  return {
    'took-out': 'so it took that entry out again and changed nothing else',
    'replaced-config': `but the file at that path was saved again since, so it left that file unchanged; check that the "${SERVER_NAME}" entry in it is what you want`,
    'not-ours': `and that file is gone or its "${SERVER_NAME}" entry is no longer the one Codebook wrote, so it left that file unchanged; check that entry yourself before you remove it`,
    unreadable: `and could not read that file again, so it left it unchanged; check that its "${SERVER_NAME}" entry is what you want before you change it`,
    'not-taken-out': `and could not take that entry out again, so remove the "${SERVER_NAME}" entry from that file by hand if it is still there`,
  }[outcome]
}

/**
 * Takes out the entry a first setup just published when its receipt could not be written, so no entry stays that no record owns; called by {@link publishEntry}.
 * Only the file of this write is edited: the config is read again, its inode must still be the one published, and the entry must still hash like the receipt that was about to be written ({@link ownsEntry}); every other server and key stays. The setup's pending record stays until the rollback is complete and no copy remains, because it is the only proof that the entry is Codebook's and the only record of a displaced copy.
 * @param context - The run.
 * @param written - The receipt that could not be written, of this write's generation.
 * @param cause - The failure of the receipt write, kept for diagnosis.
 * @param keptLeft - The copies the publish left; one that stays is named in the error.
 * @returns The error to reject with: whether the entry was taken out again, and the way out.
 */
async function takeOutUnrecordedEntry(
  context: Context,
  written: Receipt,
  cause: unknown,
  keptLeft: KeptFile[],
): Promise<Error> {
  const { path, retry } = context
  let result: RollbackResult = { outcome: 'not-taken-out', keptLeft: [] }
  // The intent comes first: a failure inside the rollback (a full disk fails its journal too) must never let a later run adopt this entry. A failure to write the intent changes nothing: the run rejects as it does without it.
  await markTakeBackOwed(context, written.generation).catch(() => undefined)
  try {
    result = await rollBackPublishedEntry(context, written)
  } catch {
    // The rejection below says the entry may still stand.
  }
  const { outcome } = result
  const keptCopies = [...keptLeft, ...result.keptLeft]
  // Nothing stays that the setup's record must prove: drop it only after a complete rollback with no copy left.
  if (outcome === 'took-out' && keptCopies.length === 0)
    await dropPending(context)
  const sentence = rollbackOutcomeClause(outcome)
  return new Error(
    `Codebook added its entry to Devin Desktop's MCP config at ${path} but could not write its own record of it, ${sentence}; make room for that record, ${retry}.${keptCopiesSentence(keptCopies)}`,
    { cause },
  )
}

/**
 * Publishes the config with Codebook's entry: the pending record is written by {@link publishRoot} before the rename, the receipt after it.
 * A first setup ({@link isFirstSetup}) records its entry hash with the {@link FIRST_SETUP_HASH_PREFIX} and `firstSetup`, so no Codebook version adopts its entry before its receipt exists and this one takes it back ({@link isTakeBackOwed}); the receipt holds the plain hash.
 * An existing `codebook` entry keeps the keys Devin manages itself (`disabled`, which Customize sets when the server is toggled off, and `disabledTools`); any other added key makes the entry an edit that is never replaced.
 * @param context - The run; its entry must be set.
 * @param look - What the config looked like.
 * @param receipt - The receipt that stands, if any; decides whether the file is still Codebook's own ({@link createdFileFor}).
 * @returns The generation recorded in the receipt, a fresh random id, and the sentence for a kept copy that could not be deleted; an empty generation when the run has no entry.
 * @throws A {@link refusal} when the file changed before the rename or holds a number that would not survive; no record stays when nothing was published. A {@link staleReceiptRefusal} or {@link changedRecordRefusal} when a first setup cannot move the receipt of an entry that is gone aside right before its link; nothing is published then. A refusal before that link leaves that receipt as it was, and a link that fails puts it back; when it cannot go back, the refusal names where it is and the publish record stays, so the next run puts it back ({@link settleRetiredReceipt}). When the receipt of a first setup cannot be written after the entry was published, the entry is taken out again ({@link takeOutUnrecordedEntry}) and the call rejects.
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
  assertRewritable(context, look)
  assertSingleLink(context, look)
  const isFirst = isFirstSetup(look, receipt)
  const createdFile = createdFileFor(look, receipt)
  const generation = randomUUID()
  // A first setup starts a new installation, an update carries the receipt's over.
  const installationId = installationIdOf(isFirst ? undefined : receipt)
  const root = rootWithEntry(look, entry)
  await context.seam?.afterRead?.()
  const { config, keptLeft } = await publishRoot(
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
    config,
  }
  try {
    await writeRecord(context, context.receiptPath, written)
  } catch (cause) {
    // A first setup never leaves an entry without a receipt; an update keeps the old receipt and rejects as before.
    if (!isFirst) throw cause
    throw await takeOutUnrecordedEntry(context, written, cause, keptLeft)
  }
  // A record that names a copy that stays is kept, so the next run settles that copy.
  if (keptLeft.length === 0) await dropPending(context)
  const cleanupFailure = cleanupFailureOf(keptLeft)
  return cleanupFailure ? { generation, cleanupFailure } : { generation }
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
 * The rollback keeps its own journal ({@link rollbackContextOf}). A process that ends after the rollback moved the config aside leaves the config name empty and the learner's other servers only under the rollback's private name, so that journal is settled first, the same way as `pending.json`'s ({@link recoverLeftovers}): the recorded original goes back to an empty config name, extra names are dropped, and anything that cannot be settled stays and is named. The journal is retired (or reduced to what stays) before `pending.json` is read.
 * A settled journal marks the setup's publish record `takeBack` ({@link markTakeBackOwed}) first, so {@link inspect} finishes the take-back instead of adopting that record, in this run or a later one. A journal of an older build names no publish, so the config its recovery put back is read for {@link legacyBelonging}; one that cannot be matched, or not yet because that config could not be read or is no valid JSON config yet, is refused before the journal is retired, and both records then stay.
 * @param context - The run.
 * @throws A refusal naming the first leftover that could not be settled, or what {@link recoverLeftovers} throws for a name that is not Codebook's own; nothing is created then. The {@link unmatchedJournalRefusal} for an older build's journal whose file has the published inode but other bytes, while the config holds the setup's entry and does not start with the published bytes, cannot be read or is no valid JSON config yet: no record is written or retired then.
 * @example
 * await settleRollbackJournal(context) // the original config is back at its path when a rollback was cut short
 */
async function settleRollbackJournal(context: Context): Promise<void> {
  const rollbackContext = rollbackContextOf(context)
  const pending = await readRecord(
    rollbackContext.pendingPath,
    pendingSchema,
    context.retry,
    context.seam,
  )
  // No rollback was cut short, or the journal belongs to another config, which this run does not settle.
  if (pending?.targetPath !== context.path) return
  const unsettled = await recoverLeftovers(rollbackContext, pending)
  const isHandedNow = unsettled.some(({ isHandedOver }) => isHandedOver)
  // An unverified put-back's handed journal is read as the change in progress it is, so its displaced file stays tracked.
  const phase = leftoverPhaseOf(pending)
  const tracked = phase ? unsettled.slice(1) : unsettled
  // A journal of an older build names no publish: the config its recovery just put back helps tell whether it is this publish's.
  const legacy =
    pending.publishGeneration === undefined
      ? {
          journal: pending,
          restoredBytes: await restoredConfigBytes(context),
          reported: unsettled[0],
        }
      : undefined
  await markTakeBackOwed(context, pending.publishGeneration, legacy)
  await retirePending(
    rollbackContext,
    retainedRecord(
      await recordAfterRecovery(
        rollbackContext,
        pending,
        unsettled,
        isHandedNow,
      ),
      tracked,
    ),
  )
  const [reported] = unsettled
  if (reported) throw unsettledRefusal(rollbackContext, phase, reported)
}

/** How a rollback journal relates to the publish record ({@link markTakeBackOwed}): `belongs` marks the take-back, `another` leaves the record as it is; only for an older build's journal ({@link legacyBelonging}), `unmatched` (the evidence contradicts itself), `unread` (the config that decides could not be read) and `invalid` (it was read but is no valid JSON config, as while an editor saves it) refuse and keep both records ({@link unmatchedJournalRefusal}), so the next run decides again. */
type JournalBelonging =
  'belongs' | 'another' | 'unmatched' | 'unread' | 'invalid'

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
 * - `another` for another inode, or for the same inode with another hash when the restored config holds no entry or another one
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
  if (
    restored.hash === undefined ||
    restored.hash !== plainEntryHashOf(publish.entrySha256)
  )
    return 'another'
  // Text appended in place keeps the published bytes at the start; a reused inode with the same entry among other settings does not.
  return hasPrefixWithSha256(restoredBytes, stagedSha256)
    ? 'belongs'
    : 'unmatched'
}

/**
 * Builds the refusal for a rollback journal of an older build that {@link legacyBelonging} cannot match to the publish record (`unmatched`), or cannot match yet because the config that decides could not be read (`unread`) or is no valid JSON config yet (`invalid`); thrown by {@link markTakeBackOwed} before any record is written or retired, so both records stay: the learner decides about the entry, or the next run reads the config again.
 * The journal's recovery already ran (a displaced file may be back at the config name), so the sentence claims only what stays: the entry or the file's bytes, both records, and a leftover that recovery could not settle, which is named here because this refusal comes before its own ({@link unmatchedLeftoverSentence}).
 * @param context - The run; its config path, publish record path and retry are named, and the journal path beside the record ({@link rollbackContextOf}).
 * @param belonging - Which of the three answers {@link legacyBelonging} gave.
 * @param legacy - The journal and the first leftover its recovery could not settle, if any ({@link LegacyJournalEvidence}).
 * @returns The error, not thrown yet.
 * @example
 * throw unmatchedJournalRefusal(context, 'unread', legacy) // 'Codebook found a record of a setup that ended early and a record of its rollback that it cannot match yet: …'
 */
function unmatchedJournalRefusal(
  context: Context,
  belonging: Extract<JournalBelonging, 'unmatched' | 'unread' | 'invalid'>,
  legacy: LegacyJournalEvidence | undefined,
): Error {
  const { path, pendingPath, retry } = context
  const records = `${pendingPath}, ${rollbackContextOf(context).pendingPath}`
  const notYet = `Codebook found a record of a setup that ended early and a record of its rollback that it cannot match yet: the rollback's file has the inode the setup published but other bytes`
  // A config that could not be read, or that is no valid config yet, decides nothing: the next run reads it again.
  const sentence = {
    unread: `${notYet}, and Codebook could not read ${path} again (it is gone, a link, no regular file, larger than ${DEVIN_MCP_CONFIG_LIMIT_BYTES} bytes or unreadable) to see whether it holds the "${SERVER_NAME}" entry the setup wrote. Codebook changed nothing in that file and kept both records (${records}), so the next run looks again; make that file readable, or delete both records if it is gone, ${retry}.`,
    invalid: `${notYet}, and ${path} is no valid JSON config right now (an editor may still be saving it), so Codebook cannot see whether it holds the "${SERVER_NAME}" entry the setup wrote. Codebook changed nothing in that file and kept both records (${records}), so the next run looks again; fix that file or wait until it is saved, ${retry}.`,
    unmatched: `Codebook found a record of a setup that ended early and a record of its rollback that it cannot match: the rollback's file has the inode the setup published but other bytes, and the "${SERVER_NAME}" entry in ${path} is the one the setup wrote. Codebook left that entry in place and kept both records (${records}); if you did not write that entry, remove it by hand, delete both records, ${retry}.`,
  }[belonging]
  // A leftover that stays with the kept journal is named once more, so the advice to delete both records never hides it.
  return new Error(`${sentence}${unmatchedLeftoverSentence(context, legacy)}`)
}

/**
 * Words the leftover that an {@link unmatchedJournalRefusal} names beside both records; called only by that refusal.
 * The leftover's own sentence is kept when it advises no move: its text names both files ({@link namesBothFiles}), the copy was handed over, or its change had finished. A leftover of a change in progress gets its own sentence instead of the move-it-back advice ({@link leftCopyRefusal}): the config that stands may hold settings that file never had (the published inode reused for another config), so copying the file over the config would lose them.
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
 * Records in this config's publish record that its entry must be taken back; called by {@link takeOutUnrecordedEntry} before the rollback's first step, and by {@link settleRollbackJournal} before it retires the journal that proves the rollback was cut short, so a run that fails later still finds the intent.
 * Only the publish of the given generation is marked: another installation's pending publish stays as it is.
 * @param context - The run.
 * @param publishGeneration - The generation of the publish being rolled back. A journal of an older build names none: it marks only when {@link legacyBelonging} finds that it belongs to the publish record.
 * @param legacy - Only for a journal of an older build: the journal (its displaced file's inode and hash), the config its recovery put back and the first leftover it could not settle.
 * @throws The {@link unmatchedJournalRefusal} when an older build's journal cannot be matched to the publish record, or cannot be matched yet because the restored config could not be read or is no valid JSON config yet; nothing is written then. What reading or writing the record throws.
 * @example
 * await markTakeBackOwed(context, generation) // pending.json now holds takeBack: true
 */
async function markTakeBackOwed(
  context: Context,
  publishGeneration: string | undefined,
  legacy?: LegacyJournalEvidence,
): Promise<void> {
  const publish = await readRecord(
    context.pendingPath,
    pendingSchema,
    context.retry,
    context.seam,
  )
  // No publish record, one of another config, or one already marked: nothing to mark.
  if (publish?.targetPath !== context.path || publish.takeBack) return
  // A journal of this build names the publish it rolled back (another generation is another installation's publish); one of an older build names none, so its displaced file and the restored config decide.
  const belonging: JournalBelonging =
    publishGeneration === undefined
      ? legacyBelonging(legacy?.journal, publish, legacy?.restoredBytes)
      : publish.generation === publishGeneration
        ? 'belongs'
        : 'another'
  if (belonging === 'another') return
  // Contradicting, unread or half-saved evidence keeps both records: the learner or the next run decides.
  if (belonging !== 'belongs')
    throw unmatchedJournalRefusal(context, belonging, legacy)
  await writeRecord(context, context.pendingPath, {
    ...publish,
    takeBack: true,
  })
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
 * Finishes the take-back of a first setup whose rollback was cut short; called by {@link inspect} after {@link settleRollbackJournal} put the published config back.
 * That config holds the entry the failed setup published, and its receipt was never written, so the publish record is not adopted: the entry is taken out again with the rollback's own steps and checks ({@link rollBackPublishedEntry}) and the setup's record is retired. A config with no matching publish record, or one a receipt of the same generation covers, is not concerned.
 * @param context - The run.
 * @param pending - The setup's pending record.
 * @param receipt - The receipt that stands, if any.
 * @param retained - What stays of the setup's record after recovery ({@link retainedRecord}).
 * @param look - The config as it stands.
 * @returns The config as it looks after the entry was taken out, and what the take-back removed (`removal`: the file or only the entry); undefined when nothing was taken back (the record is then settled as before).
 * @throws A refusal when the entry could not be taken out again; nothing else is changed then.
 * @example
 * const afterTakeBack = await finishCutShortSetup(context, pending, receipt, retained, look)
 */
async function finishCutShortSetup(
  context: Context,
  pending: Pending,
  receipt: Receipt | undefined,
  retained: Pending | undefined,
  look: ConfigLook,
): Promise<
  { look: ConfigLook; removal?: 'file-removed' | 'removed' } | undefined
> {
  const { stagedIno } = pending
  // A first setup's record carries the prefix; the entry and the receipt the rollback checks against hash plainly.
  const entrySha256 = plainEntryHashOf(pending.entrySha256)
  if (
    look.kind !== 'present' ||
    pending.targetPath !== context.path ||
    entrySha256 === undefined ||
    stagedIno === undefined ||
    receipt?.generation === pending.generation ||
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
    result = await rollBackPublishedEntry(context, written)
  } catch {
    // A refusal after the entry was confirmed as Codebook's own: the message below says it may still stand.
  }
  const { outcome, keptLeft } = result
  // The config was saved again or is not Codebook's to touch: the record is settled as before.
  if (outcome === 'replaced-config' || outcome === 'not-ours') return undefined
  if (outcome !== 'took-out' || keptLeft.length > 0)
    throw new Error(
      `A setup of Codebook that ended early left its "${SERVER_NAME}" entry in ${context.path}, ${rollbackOutcomeClause(outcome)}; ${context.retry}.${keptCopiesSentence(keptLeft)}`,
    )
  await retirePending(context, retained)
  return { look: await lookAtConfig(context), removal: result.removal }
}

/** What a run decides on after {@link inspect}: the look at the config, its `codebook` entry and the receipt that stands. */
type Inspection = {
  look: ConfigLook
  current: unknown
  receipt: Receipt | undefined
  /** Set when this run's take-back of an interrupted first setup removed the entry (or the file Codebook created): the removal answers it instead of `not-managed`. */
  tookBack?: 'file-removed' | 'removed'
}

/**
 * Settles a kept copy and a pending record, reads the config and returns what a run decides on.
 * Every leftover is settled on its own; an entry an interrupted run published is adopted even when a leftover cannot be settled, and the record keeps only the leftovers that stay. A leftover that stays is named in a refusal after that; a refusal of the steps after recovery names it too when it was handed over in this run or its own text names both files ({@link mergeWithLeftover}).
 * @param context - The run.
 * @returns The {@link Inspection}.
 * @throws What {@link recoverLeftovers} and {@link settleAfterRecovery} throw, and a refusal naming the first leftover that could not be settled.
 * @example
 * const { look, current, receipt } = await inspect(context)
 */
async function inspect(context: Context): Promise<Inspection> {
  // A rollback cut short comes first: its original may be the only copy of the learner's other servers.
  await settleRollbackJournal(context)
  const pending = await readRecord(
    context.pendingPath,
    pendingSchema,
    context.retry,
    context.seam,
  )
  // A copy an interrupted run kept comes back, or is deleted, or stays and is named, before the config is read.
  const unsettled = await recoverOwnLeftovers(context, pending)
  // An unverified put-back's handed record is read as the change in progress it is.
  const phase = pending && leftoverPhaseOf(pending)
  // A finished or handed change names its leftover once: the one reported is no longer tracked. A copy handed over in this run keeps the record, now handed, so no later run deletes it.
  const isHandedNow = unsettled.some(({ isHandedOver }) => isHandedOver)
  // Written at once, before the config is read: a refusal of the steps below must not leave the handed copy deletable. A write that failed is said in the refusal, which then promises no handover.
  const isHandoverUnrecorded = Boolean(
    pending &&
    isHandedNow &&
    !(await persistHandover(context, pending, unsettled)),
  )
  const tracked = phase ? unsettled.slice(1) : unsettled
  const [first] = unsettled
  const reported = first && {
    ...first,
    ...(isHandoverUnrecorded && { isHandoverUnrecorded }),
  }
  const retained =
    pending &&
    retainedRecord(
      await recordAfterRecovery(context, pending, unsettled, isHandedNow),
      tracked,
    )
  const inspection = await settleAfterRecovery(
    context,
    pending,
    retained,
  ).catch((cause: unknown) => {
    throw mergeWithLeftover(context, cause, phase, reported, isHandedNow)
  })
  if (pending && reported) throw unsettledRefusal(context, phase, reported)
  return inspection
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
 * retainedRecord(await recordAfterRecovery(context, pending, unsettled, false), tracked)
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
 * Reads the config and the receipt once recovery settled the leftovers, finishes the take-back of a cut-short first setup and settles the pending record; called by {@link inspect}, which merges a refusal from here with a leftover that stays ({@link mergeWithLeftover}).
 * A stale receipt that a first setup moved aside is settled first ({@link settleRetiredReceipt}), so the receipt read here is the one that stands.
 * @param context - The run.
 * @param pending - The pending record as it was read; undefined when there is none.
 * @param retained - What stays of that record after recovery ({@link retainedRecord}); undefined when nothing stays.
 * @returns The {@link Inspection}.
 * @throws What {@link settleRetiredReceipt}, {@link lookAtConfig}, {@link readReceipt}, {@link finishCutShortSetup} and {@link settlePending} throw.
 * @example
 * const { look, current, receipt } = await settleAfterRecovery(context, pending, retained)
 */
async function settleAfterRecovery(
  context: Context,
  pending: Pending | undefined,
  retained: Pending | undefined,
): Promise<Inspection> {
  await settleRetiredReceipt(context, pending)
  let look = await lookAtConfig(context)
  const stored = await readReceipt(context)
  // A setup whose rollback was cut short is taken back, never adopted (its receipt was never written).
  const afterTakeBack =
    pending && isTakeBackOwed(pending, stored)
      ? await finishCutShortSetup(context, pending, stored, retained, look)
      : undefined
  if (afterTakeBack) look = afterTakeBack.look
  const current = currentEntryOf(look)
  const receipt = await settlePending(
    context,
    current,
    stored,
    afterTakeBack ? undefined : pending,
    look,
    retained,
  )
  return {
    look,
    current,
    receipt,
    ...(afterTakeBack?.removal && { tookBack: afterTakeBack.removal }),
  }
}

/**
 * Joins a refusal of the steps after recovery with the leftover recovery could not settle, so the learner reads both in one message; called by {@link inspect} when {@link settleAfterRecovery} throws.
 * It applies to a copy handed over in this run and to a leftover whose own text names both files ({@link namesBothFiles}): a refusal about the config or its entry must not hide where that copy is or that the config changed while it was read.
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
  // Any other leftover stays in the record, which the failed step did not retire, and a later run names it.
  if (!isHandedNow && !namesBothFiles(reported.cause)) return cause
  return new Error(
    `${cause.message} ${unsettledRefusal(context, phase, reported).message}`,
    { cause },
  )
}

/**
 * Runs one operation under the storage lock of the `devin-mcp` folder that every Codebook window of one Devin Desktop install shares.
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
  }
  return withStorageLock(folder, () => run(context))
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
    const { look, current, receipt } = await inspect(context)
    if (current === undefined) {
      const published = await publishEntry(context, look, receipt)
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
    const published = await publishEntry(context, look, receipt)
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
    const { look, current, receipt } = await inspect(context)
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
    const published = await publishEntry(context, look, receipt)
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
 * @throws The refusals of {@link deleteConfig}, {@link assertRewritable} and {@link publishRoot}, and an {@link unrecordedRemovalRefusal} when the reduced config stands but the completed record could not be written (the receipt stays).
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
  const { keptLeft, isRecorded } = await publishRoot(
    context,
    { ...look.root, mcpServers: otherServers },
    look,
    { createdFile: false },
  )
  // Without the completed record the receipt stays: success is reported only once the removal is recorded.
  if (!isRecorded) throw unrecordedRemovalRefusal(context, keptLeft)
  if (keptLeft.length === 0) await dropPending(context)
  return { status: 'removed', keptLeft }
}

/**
 * The refusal of a removal whose reduced config stands but whose completed record could not be written: the receipt stays and the previous config's private copy is named; the next run settles the copy and drops the receipt.
 * Its own class so the removal command can tell that the config changed (the loaded Codebook bridge keeps running until a reload) from a refusal that touched nothing; thrown by {@link takeEntryOut}, read by {@link devinEntryRemovalOf}.
 */
export class DevinMcpUnrecordedRemovalError extends Error {}

/** Words {@link DevinMcpUnrecordedRemovalError}: the config change, the record failure and the next step in separate clauses. */
function unrecordedRemovalRefusal(
  { path, retry }: Context,
  keptLeft: KeptFile[],
): DevinMcpUnrecordedRemovalError {
  const previous = keptLeft.find(({ holds }) => holds === 'previous')
  const copy = previous ? ` and ${keptCopyPhrase(previous.path)}` : ''
  return new DevinMcpUnrecordedRemovalError(
    `Codebook took its entry out of Devin Desktop's MCP config at ${path} but could not write its own record of that step, so it kept its receipt${copy}; make room for that record, ${retry}.`,
  )
}

/**
 * Drops the receipt of an entry the removal has taken out; called by {@link removeManagedDevinMcpEntry}. The config has already changed, so a receipt or a private copy that cannot be deleted is reported beside the result instead of thrown.
 * @param receiptPath - Codebook's receipt of the entry.
 * @param status - How the removal changed the config.
 * @param path - The config.
 * @param keptLeft - The private files that could not be deleted, if any.
 * @returns The removal's result, with `cleanupFailure` when something stays.
 * @example
 * await dropReceiptAfterRemoval('/private/devin-mcp/receipt.json', 'removed', path) // => { status: 'removed', path }
 */
async function dropReceiptAfterRemoval(
  receiptPath: string,
  status: 'file-removed' | 'removed',
  path: string,
  keptLeft: KeptFile[],
): Promise<DevinMcpRemovalResult> {
  const failures = [cleanupFailureOf(keptLeft)]
  try {
    await rm(receiptPath, { force: true })
  } catch {
    failures.push(
      `Codebook could not delete its own record of that entry at ${receiptPath}; delete that record by hand.`,
    )
  }
  const cleanupFailure = failures.filter(Boolean).join(' ')
  return cleanupFailure ? { status, path, cleanupFailure } : { status, path }
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
    }

/** Options of {@link removeManagedDevinMcpEntry}. */
export type DevinMcpRemovalOptions = {
  /** The generation a setup got from {@link writeManagedDevinMcpEntry}; the removal does nothing when the receipt holds another one. */
  expectedGeneration?: string
}

/**
 * Tells whether the pending record is that of a removal that was started and never recorded as completed, which a retry finds after the entry was already taken out ({@link DevinMcpUnrecordedRemovalError}); called by {@link removeManagedDevinMcpEntry} before {@link inspect} retires the record.
 * @param context - The run.
 * @returns `true` for a record of this config that holds no entry hash (a removal) and no phase as recovery reads it (never completed; {@link isUnrecordedRemoval}).
 * @throws The refusal of {@link readRecord} for a record that cannot be read.
 */
async function hasUnrecordedRemoval(context: Context): Promise<boolean> {
  const pending = await readRecord(
    context.pendingPath,
    pendingSchema,
    context.retry,
    context.seam,
  )
  return pending !== undefined && isUnrecordedRemoval(context, pending)
}

/**
 * Removes the receipted `codebook` entry; called by Codebook: Remove Devin Desktop Setup and by a setup that rolls back its own write.
 * Deletes the file only when Codebook created it (the receipt says so and the inode is the one Codebook wrote) and nothing else is left in it. An entry that was edited since the receipt (any key but `disabled` and `disabledTools` added or changed) is left alone and the receipt is dropped, because Codebook no longer owns it; those two keys, which Devin sets, do not change ownership.
 * @param storageRoot - Codebook's global storage folder.
 * @param homeRoot - The home folder; the real one unless a test names its own.
 * @param seam - Test hook, see {@link DevinMcpTestSeam}.
 * @param options - See {@link DevinMcpRemovalOptions}.
 * @returns `removed`, `file-removed`, `not-managed` (no receipt, or the entry is already gone), `changed` or `superseded` (a newer setup's receipt; nothing touched); and the config path. A failure to delete the receipt or a private copy after the config changed is returned as `cleanupFailure`, not thrown.
 * @throws The refusals of {@link writeManagedDevinMcpEntry} for an unreadable config or a file that changed during the removal; they end with the removal command.
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
      // Read before inspect retires it: an earlier removal that took the entry out and left its record unwritten.
      const wasUnrecorded = await hasUnrecordedRemoval(context)
      const inspected = await inspect(context)
      // The retry has read the record; it ends it now ({@link inspect} leaves an unrecorded removal's record for this read).
      if (wasUnrecorded) await dropPending(context)
      const ownership = removalOwnership(inspected, options.expectedGeneration)
      // Not Codebook's entry to take out (gone, changed, or a newer setup's): answer without touching the config.
      if ('status' in ownership)
        return answerRemovalWithoutTakeOut(
          context,
          ownership.status,
          inspected,
          wasUnrecorded,
        )
      const { status, keptLeft } = await takeEntryOut(context, ownership)
      return dropReceiptAfterRemoval(
        context.receiptPath,
        status,
        context.path,
        keptLeft,
      )
    },
  )
}

/**
 * Answers a removal whose entry is not Codebook's to take out (gone, changed, or a newer setup's) without touching the config; called by {@link removeManagedDevinMcpEntry} under its lock.
 * @param context - The locked removal's paths.
 * @param status - What {@link removalOwnership} decided.
 * @param inspected - What {@link inspect} found under the lock.
 * @param wasUnrecorded - Whether an earlier removal took the entry out and left its record unwritten.
 * @returns
 * - `removed` when an earlier unrecorded removal already took the entry out (the retry reports it, so the window is still offered its reload);
 * - otherwise `status` itself, with `entryStays` when `not-managed` finds the entry still in the config without its receipt.
 * @example
 * await answerRemovalWithoutTakeOut(context, 'changed', inspected, false) // => { status: 'changed', path }
 */
async function answerRemovalWithoutTakeOut(
  context: Context,
  status: Extract<RemovalOwnership, { status: string }>['status'],
  inspected: Awaited<ReturnType<typeof inspect>>,
  wasUnrecorded: boolean,
): Promise<DevinMcpRemovalResult> {
  // A newer setup's receipt stays; the receipt of an entry that is gone or changed is dropped, because Codebook no longer owns that entry.
  if (status !== 'superseded') await rm(context.receiptPath, { force: true })
  // The entry is gone because this run's take-back of an interrupted first setup took it out: the removal reports that, so the window is offered its reload.
  if (status === 'not-managed' && inspected.tookBack)
    return { status: inspected.tookBack, path: context.path }
  // The entry is gone because an earlier removal took it out: the retry reports that removal, so the window is still offered its reload.
  if (status === 'not-managed' && wasUnrecorded && inspected.receipt)
    return { status: 'removed', path: context.path }
  // An entry that stays without its receipt is no absent entry: the caller must not count the take-back complete.
  const entryStays =
    status === 'not-managed' &&
    !inspected.receipt &&
    inspected.current !== undefined
  return {
    status,
    path: context.path,
    ...(entryStays && { entryStays: true as const }),
  }
}
