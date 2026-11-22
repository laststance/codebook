import { createHash, randomUUID } from 'node:crypto'
import { lstatSync } from 'node:fs'
import {
  link,
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
  PRIVATE_FILE_MODE,
} from './constants'
import { atomicPrivateWrite } from './utils/atomicPrivateWrite'
import { canonicalJson } from './utils/canonicalJson'
import { hasDuplicateJsonMember } from './utils/hasDuplicateJsonMember'
import { isSameFileId } from './utils/isSameFileId'
import { openWithoutFollowing } from './utils/openWithoutFollowing'
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
  /** The inode of the config Codebook last wrote; the file counts as Codebook's own only while it still matches. An older receipt also holds a device number, which is ignored. */
  config: z.object({ ino: fileIdSchema }),
})
const pendingSchema = z.object({
  targetPath: z.string(),
  /** Hash of the entry a write was about to publish; absent for a removal. */
  entrySha256: z.string().optional(),
  createdFile: z.boolean(),
  /** The id of the write or removal; every private name beside the config holds it ({@link journalNameOf}), and recovery accepts no other name. */
  generation: z.string().optional(),
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
  /** Absent while a write or removal is in progress (a displaced config goes back when the config name is empty); `completed` once the config was published or removed (a copy that stays is a leftover, never put back). */
  phase: z.literal('completed').optional(),
})
type Receipt = z.infer<typeof receiptSchema>
type Pending = z.infer<typeof pendingSchema>
/** What a run knows about a pending record before the file is staged. */
type PendingHead = Pick<Pending, 'entrySha256' | 'createdFile' | 'generation'>
/** A parsed JSON object; its own keys, `__proto__` included, are kept as parsed. */
type JsonObject = Record<string, unknown>

/** Size, times and the inode that tell whether a file is still the one that was read; the inode alone names the file, because a volume can get another device number after a restart. */
type FileIdentity = {
  ino: bigint
  size: bigint
  mtimeMs: bigint
  /** The permission bits (`mode & 0o777`) the file had when it was read; a replacement keeps only the owner's of them. */
  mode: number
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

/** A file that stays beside the config, and what it holds: `previous` is the config as it was before the write or removal, `new` the staged config that was published. */
type KeptFile = { path: string; holds: 'previous' | 'new' }

/** The words that name a kept copy of the previous config, for a refusal and for {@link cleanupFailureOf}. */
function keptCopyPhrase(copyPath: string): string {
  return `a private copy of your previous Devin MCP config at ${copyPath} (it holds the settings of your other servers)`
}

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

/** One sentence for a kept file that could not be deleted; the work itself is done. */
function keptFileSentence({ path, holds }: KeptFile): string {
  const what =
    holds === 'previous'
      ? keptCopyPhrase(path)
      : `a private copy of the Devin MCP config it just wrote at ${path} (it holds the settings of your other servers)`
  return `Codebook kept ${what} because it could not delete that file safely; delete it when you no longer need it.`
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
}): FileIdentity {
  const { ino, size, mtimeMs, mode } = status
  return { ino, size, mtimeMs, mode: Number(mode) & 0o777 }
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
      throw refusal(
        `a file larger than ${DEVIN_MCP_CONFIG_LIMIT_BYTES} bytes`,
        path,
        'shrink or move it',
        retry,
      )
    const bytes = await file.readFile().catch((error) => {
      throw unreadableRefusal(context, error)
    })
    return parseConfig(context, bytes, identityOf(status))
  } finally {
    await file.close()
  }
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
  const text = bytes.toString('utf8')
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
    throw refusal(
      'text that is not valid JSON',
      path,
      'fix or move that file',
      retry,
    )
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

/** Removes the pending record; a failure leaves a record that the next run finds stale. */
function dropPending(context: Context): Promise<void> {
  return rm(context.pendingPath, { force: true }).catch(() => undefined)
}

/**
 * Rewrites the pending record as completed: the config was already published or removed, so a copy that stays is a leftover and never goes back to the config name ({@link recoverLeftovers}).
 * @param context - The run.
 * @param journal - The record as it was written before the first move.
 * @returns Nothing; a failure to write keeps the record as it was.
 */
function markCompleted(context: Context, journal: Pending): Promise<void> {
  return atomicPrivateWrite(
    context.pendingPath,
    { ...journal, phase: 'completed' } satisfies Pending,
    DEVIN_MCP_RECORD_LIMIT_BYTES,
  ).catch(() => undefined)
}

/** Whether a file was deleted; a failure is an answer here, because the caller names the file that stays. */
function didUnlink(path: string): Promise<boolean> {
  return unlink(path).then(
    () => true,
    () => false,
  )
}

/**
 * Reads a file Codebook keeps a copy in, without following a link.
 * @param path - The copy.
 * @returns Its bytes' hash and inode; undefined when the copy is gone.
 * @throws When the copy is a link, no regular file, larger than {@link DEVIN_MCP_CONFIG_LIMIT_BYTES} or cannot be read.
 */
async function inspectCopy(
  path: string,
): Promise<{ sha256: string; ino: bigint } | undefined> {
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
      throw new Error('The kept copy is no regular file of a sane size.')
    return { sha256: bytesSha256(await file.readFile()), ino: status.ino }
  } finally {
    await file.close()
  }
}

/** Whether a kept copy still is the file and the bytes Codebook expected in it. */
function isExpectedCopy(
  copy: { sha256: string; ino: bigint },
  expected: KeptCopy,
): boolean {
  return copy.sha256 === expected.sha256 && copy.ino === expected.ino
}

/** The displaced copy as it was read through its open handle: the bytes' hash, the inode, and the size and times that a later write to the same file changes. */
type HeldCopy = {
  handle: FileHandle
  sha256: string
  ino: bigint
  size: bigint
  mtimeMs: bigint
  ctimeMs: bigint
}

/**
 * Opens the displaced copy without following a link and makes it private through that handle, so the copy of the learner's other servers is readable by the owner only while it exists; called right after the move-aside.
 * @param path - The private name the config was moved to.
 * @returns The open handle; undefined when the name holds nothing.
 * @throws When the name holds a link or no readable file, or the mode cannot be set; the handle is closed then.
 */
async function holdDisplaced(path: string): Promise<FileHandle | undefined> {
  let handle: FileHandle
  try {
    handle = await openWithoutFollowing(path)
  } catch (error) {
    if (codeOf(error) === 'ENOENT') return undefined
    throw error
  }
  try {
    await handle.chmod(PRIVATE_FILE_MODE)
    return handle
  } catch (error) {
    await handle.close()
    throw error
  }
}

/**
 * Reads the displaced copy through its handle: the status first, then the bytes, so a write between the two shows at the later {@link didCopyChange}.
 * @param handle - The handle {@link holdDisplaced} opened.
 * @returns The hash, inode, size and times.
 * @throws When the file is no regular file, is larger than {@link DEVIN_MCP_CONFIG_LIMIT_BYTES} or cannot be read.
 */
async function readHeld(handle: FileHandle): Promise<HeldCopy> {
  const status = await handle.stat({ bigint: true })
  if (!status.isFile() || status.size > BigInt(DEVIN_MCP_CONFIG_LIMIT_BYTES))
    throw new Error('The kept copy is no regular file of a sane size.')
  const bytes = await handle.readFile()
  const { ino, size, mtimeMs, ctimeMs } = status
  return { handle, sha256: bytesSha256(bytes), ino, size, mtimeMs, ctimeMs }
}

/**
 * Tells whether a writer that kept the old file open wrote into it after the comparison, by the size and times of the same open file.
 * @param held - The copy as it was read.
 * @returns `true` when size, modification time or change time differ, or the file cannot be looked at: such a copy is kept, never deleted.
 */
async function didCopyChange(held: HeldCopy): Promise<boolean> {
  try {
    const now = await held.handle.stat({ bigint: true })
    return (
      now.size !== held.size ||
      now.mtimeMs !== held.mtimeMs ||
      now.ctimeMs !== held.ctimeMs
    )
  } catch {
    return true
  }
}

/**
 * Deletes the displaced copy after the config was published or removed, unless a writer changed it since the comparison; called by {@link settlePublished} and by the removal.
 * The record turns to completed first, so a copy that stays is a leftover that never goes back to the config name.
 * @param context - The run.
 * @param journal - The record as it was written before the first move.
 * @param displacedPath - The private name of the displaced copy.
 * @param held - The copy as it was compared.
 * @returns `true` when the copy is gone; `false` when it changed or could not be deleted, so it stays.
 */
async function discardDisplaced(
  context: Context,
  journal: Pending,
  displacedPath: string,
  held: HeldCopy,
): Promise<boolean> {
  await markCompleted(context, journal)
  if (await didCopyChange(held)) return false
  return didUnlink(displacedPath)
}

/**
 * Gives the config name its file back after the comparison found it is not the file that was read: the original permissions return through the handle, a link never replaces a config that appeared meanwhile, and the displaced name is unlinked.
 * @param context - The run.
 * @param displacedPath - The private name of the displaced file.
 * @param handle - The handle of that file; undefined when it could not be opened.
 * @param mode - The permission bits the config had when it was read.
 * @throws A {@link leftCopyRefusal} naming the displaced file when it cannot go back (a new config stands there, or the link failed).
 */
async function restoreDisplaced(
  context: Context,
  displacedPath: string,
  handle: FileHandle | undefined,
  mode: number,
): Promise<void> {
  try {
    await handle?.chmod(mode).catch(() => undefined)
    await link(displacedPath, context.path)
  } catch (error) {
    throw leftCopyRefusal(context, displacedPath, error)
  }
  await unlink(displacedPath).catch(() => undefined)
  await dropPending(context)
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

/** What a publish reports: the inode of the config now standing, and the files that stay beside it (empty when everything was deleted; the pending record stays otherwise). */
type Published = { config: ConfigNumbers; keptLeft: KeptFile[] }

/** Everything a replacement of an existing config works with: the staged file, the probe name, the displaced copy, the identity of the config that was read, and the record that names them. */
type Replacement = {
  temporary: string
  probePath: string
  displaced: KeptCopy
  identity: FileIdentity
  journal: Pending
}

/**
 * Creates the config from the staged file without replacing anything: a hard link never replaces a file that appeared meanwhile; called by {@link publishRoot} when there was no config.
 * @param context - The run.
 * @param temporary - The staged file.
 * @param config - The inode the config will have.
 * @returns The inode, and the staged name when it could not be unlinked afterwards (its pending record stays then).
 * @throws A {@link refusal} when a file stands at the config name by then (it is left as it is); nothing was published.
 */
async function createConfig(
  context: Context,
  temporary: string,
  config: ConfigNumbers,
): Promise<Published> {
  try {
    context.seam?.afterCheck?.()
    await link(temporary, context.path)
  } catch (error) {
    await unlink(temporary).catch(() => undefined)
    await dropPending(context)
    // A file that appeared meanwhile is the learner's: never replaced.
    throw codeOf(error) === 'EEXIST' ? changedWhileWorking(context) : error
  }
  context.seam?.afterPublish?.(undefined)
  const isStagedGone = await didUnlink(temporary)
  return {
    config,
    keptLeft: isStagedGone ? [] : [{ path: temporary, holds: 'new' }],
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
 * @param replacement - The staged file (unlinked here), the private name and the identity the config had when it was read.
 * @param handle - The handle of the displaced file; undefined when it could not be opened.
 * @throws Always: {@link changedWhileWorking} after the file went back with its original permissions (a link never replaces, and the displaced name is unlinked), or a {@link leftCopyRefusal} naming the displaced file when a new config stands at the config name (it is kept) or the link failed.
 */
async function putDisplacedBack(
  context: Context,
  { temporary, displaced, identity }: Replacement,
  handle: FileHandle | undefined,
): Promise<never> {
  await unlink(temporary).catch(() => undefined)
  await restoreDisplaced(context, displaced.path, handle, identity.mode)
  throw changedWhileWorking(context)
}

/**
 * Links the staged file in as the config after a successful comparison; called by {@link replaceConfig}. A link never replaces: a file that a save created after the move-aside stays.
 * @param context - The run.
 * @param replacement - The staged file, the displaced file (whose bytes equal what was read) and the record.
 * @param held - The displaced copy as it was compared.
 * @throws {@link newConfigRefusal} when a config appeared: the staged file is unlinked, the displaced copy is kept (a writer may still hold it open) and named, and the record turns to completed. Any other link failure puts the displaced file back with its original permissions and rethrows it, or throws a {@link leftCopyRefusal} naming the displaced file when it cannot go back.
 */
async function linkInStaged(
  context: Context,
  { temporary, displaced, identity, journal }: Replacement,
  held: HeldCopy,
): Promise<void> {
  try {
    await link(temporary, context.path)
    return
  } catch (error) {
    await unlink(temporary).catch(() => undefined)
    if (codeOf(error) === 'EEXIST') {
      // A save created the config after the move-aside: it is kept, and the displaced copy is never deleted here.
      await markCompleted(context, journal)
      throw newConfigRefusal(context, displaced.path)
    }
    // The config name is empty: the displaced file goes back, else it is named.
    await restoreDisplaced(context, displaced.path, held.handle, identity.mode)
    throw error
  }
}

/**
 * Cleans up after the config was published: the record turns to completed, the displaced copy is deleted unless a writer changed it since the comparison, and the staged name is unlinked; called by {@link replaceConfig}.
 * @param context - The run.
 * @param replacement - The staged file, the displaced copy and the record.
 * @param held - The displaced copy as it was compared.
 * @returns The files that stay, each with what it holds; empty when everything was deleted.
 */
async function settlePublished(
  context: Context,
  { temporary, displaced, journal }: Replacement,
  held: HeldCopy,
): Promise<KeptFile[]> {
  const isDisplacedGone = await discardDisplaced(
    context,
    journal,
    displaced.path,
    held,
  )
  const isStagedGone = await didUnlink(temporary)
  return [
    ...(isStagedGone ? [] : [{ path: temporary, holds: 'new' as const }]),
    ...(isDisplacedGone
      ? []
      : [{ path: displaced.path, holds: 'previous' as const }]),
  ]
}

/**
 * Replaces an existing config without ever replacing a file that was not compared: the staged file is complete and flushed, the pending record names it, the probe and the private name, the config is moved aside, the displaced file is opened without following a link and made private, its inode and bytes are compared with what was read through that handle, and only then is the staged file linked in (a link never replaces).
 * A difference puts the displaced file back with its original permissions and refuses. A config that appeared at the name meanwhile is kept, together with the displaced copy, and the refusal names that copy. After a successful publish the displaced copy is deleted only while the same open file still has the size and times it had at the comparison.
 * Documented limit: between the move-aside and the link-in the config name holds nothing, so a Devin Desktop window that loads its MCP config in that instant starts without MCP servers until its next reload.
 * @param context - The run.
 * @param replacement - The staged file, the probe name, the private name, the identity the config had when it was read and the record.
 * @param config - The inode the config will have.
 * @returns The inode, and the files that stay afterwards, if any (the pending record stays then).
 * @throws The refusals of {@link moveConfigAside}, {@link putDisplacedBack} and {@link linkInStaged}.
 */
async function replaceConfig(
  context: Context,
  replacement: Replacement,
  config: ConfigNumbers,
): Promise<Published> {
  const { displaced } = replacement
  await moveConfigAside(context, replacement)
  const handle = await holdDisplaced(displaced.path).catch(() => undefined)
  try {
    context.seam?.afterMoveAside?.(displaced.path)
    // Compared by bytes and by inode through the open file: the file that moved is the one that was read, or it is put back.
    const held = handle && (await readHeld(handle).catch(() => undefined))
    if (!held || !isExpectedCopy(held, displaced))
      return await putDisplacedBack(context, replacement, handle)
    context.seam?.afterCompare?.()
    await linkInStaged(context, replacement, held)
    context.seam?.afterPublish?.(displaced.path)
    // From here the config is published; cleanup failures are reported and leave the pending record.
    return {
      config,
      keptLeft: await settlePublished(context, replacement, held),
    }
  } finally {
    await handle?.close()
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
 * @returns The record, not written yet.
 */
function journalOf(
  context: Context,
  head: FullHead,
  staged: { temporary: string; ino: bigint },
  serialized: string,
  displaced: KeptCopy | undefined,
): Pending {
  return {
    ...head,
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
 * @returns The inode of the config that now stands, and the files that stay, if any (the pending record stays then).
 * @throws A {@link refusal} when the result is larger than {@link DEVIN_MCP_CONFIG_LIMIT_BYTES}, the file changed since the read or a save landed meanwhile (the newer file is left in place), or a leftover copy cannot be settled.
 * @example
 * await publishRoot(context, { mcpServers: {} }, { kind: 'absent' }, { createdFile: true })
 */
async function publishRoot(
  context: Context,
  root: JsonObject,
  look: ConfigLook,
  head: PendingHead,
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
  )
  try {
    await atomicPrivateWrite(
      context.pendingPath,
      journal satisfies Pending,
      DEVIN_MCP_RECORD_LIMIT_BYTES,
    )
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
        },
        config,
      )
    : createConfig(context, staged.temporary, config)
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
    keptName: basename(moved.path),
    keptIno: recordedFileId(moved.ino),
    keptSha256: moved.sha256,
  }
  await atomicPrivateWrite(
    context.pendingPath,
    journal,
    DEVIN_MCP_RECORD_LIMIT_BYTES,
  )
  try {
    assertConfigUnchanged(context, look.identity)
    context.seam?.afterCheck?.()
    await rename(context.path, moved.path)
  } catch (error) {
    await dropPending(context)
    throw error
  }
  return settleMovedAside(context, moved, journal, look.identity.mode)
}

/**
 * Opens the file that was renamed aside and settles it; called by {@link deleteConfig}.
 * @param context - The run.
 * @param moved - The private name and the bytes and inode the file must have.
 * @param journal - The record as it was written before the rename.
 * @param mode - The permission bits the config had when it was read.
 * @returns The copy that stays when it could not be deleted.
 * @throws A {@link refusal} after a different file was put back, or naming the copy when it cannot go back.
 */
async function settleMovedAside(
  context: Context,
  moved: KeptCopy,
  journal: Pending,
  mode: number,
): Promise<{ keptLeft: KeptFile[] }> {
  let handle: FileHandle | undefined
  try {
    handle = await holdDisplaced(moved.path)
  } catch (error) {
    throw leftCopyRefusal(context, moved.path, error)
  }
  try {
    context.seam?.afterMoveAside?.(moved.path)
    // The renamed file is gone: nothing is left to settle.
    if (!handle) {
      await dropPending(context)
      return { keptLeft: [] }
    }
    return await settleHeldRemoval(context, { moved, journal, mode }, handle)
  } finally {
    await handle?.close()
  }
}

/**
 * Compares the held file with what was read and either deletes it or puts it back; called by {@link settleMovedAside}.
 * @param context - The run.
 * @param removal - The private name and expected bytes and inode, the record and the original permission bits.
 * @param handle - The open file.
 * @returns The copy that stays when it changed since the comparison or could not be deleted.
 * @throws A {@link refusal} after a different file was put back, or naming the copy when it cannot be read or go back.
 */
async function settleHeldRemoval(
  context: Context,
  removal: { moved: KeptCopy; journal: Pending; mode: number },
  handle: FileHandle,
): Promise<{ keptLeft: KeptFile[] }> {
  const { moved, journal, mode } = removal
  let held: HeldCopy
  try {
    held = await readHeld(handle)
  } catch (error) {
    throw leftCopyRefusal(context, moved.path, error)
  }
  if (!isExpectedCopy(held, moved)) {
    // The file is not the one that was read, whatever its bytes: link it back (never replacing a newer file) and refuse.
    await restoreDisplaced(context, moved.path, handle, mode)
    throw changedWhileWorking(context)
  }
  context.seam?.afterPublish?.(moved.path)
  if (await discardDisplaced(context, journal, moved.path, held)) {
    await dropPending(context)
    return { keptLeft: [] }
  }
  return { keptLeft: [{ path: moved.path, holds: 'previous' }] }
}

/**
 * Reads one of Codebook's own records without following a link.
 * @param path - The record file.
 * @param schema - The shape it must have.
 * @param retry - The command a refusal asks the learner to run again.
 * @returns The record; undefined when absent.
 * @throws When the record is a link, no regular file, larger than {@link DEVIN_MCP_RECORD_LIMIT_BYTES}, unreadable or of another shape; the config is not touched.
 * @example
 * await readRecord(receiptPath, receiptSchema, SET_UP_AGAIN)
 */
async function readRecord<Schema extends z.ZodType>(
  path: string,
  schema: Schema,
  retry: string,
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
    text = await file.readFile('utf8').catch((error) => {
      throw unsafe(error)
    })
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

/** Writes one of Codebook's own records atomically. */
function writeRecord(path: string, value: unknown): Promise<void> {
  return atomicPrivateWrite(path, value, DEVIN_MCP_RECORD_LIMIT_BYTES)
}

/** The receipt, when it covers this run's config path. */
async function readReceipt(context: Context): Promise<Receipt | undefined> {
  const receipt = await readRecord(
    context.receiptPath,
    receiptSchema,
    context.retry,
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

/**
 * Looks at one accepted leftover without following a link and checks its inode against the record.
 * @param context - The run.
 * @param leftover - The accepted leftover.
 * @returns The hash and inode of the file; undefined when it is gone.
 * @throws A {@link leftCopyRefusal} when the file cannot be read; a {@link journalRefusal} when the file has another inode than the record says.
 */
async function lookAtLeftover(
  context: Context,
  leftover: Leftover,
): Promise<{ sha256: string; ino: bigint } | undefined> {
  let copy
  try {
    copy = await inspectCopy(leftover.path)
  } catch (error) {
    throw leftCopyRefusal(context, leftover.path, error)
  }
  // A file under a Codebook name that is not the inode Codebook recorded is somebody else's.
  if (copy && !isSameFileId(leftover.ino, copy.ino))
    throw journalRefusal(context)
  return copy
}

/**
 * Recovers what an interrupted run left under the private names its pending record holds; called by {@link inspect} before the config is read.
 * Every name must be a bare name Codebook made beside the config with the inode the record holds, checked for all of them before any is moved, linked or deleted.
 * - A displaced config of a write or removal that was still in progress, while the config name is empty: it goes back with a link, which never replaces anything.
 * - A displaced or staged file that holds exactly the bytes the record names: it is Codebook's own leftover and is deleted. After a finished publish or removal (a completed record) it is never put back.
 * - The probe link of the hard-link check: deleted.
 * - Anything else stays, and the refusal names it; for a completed record it is said once and the record is dropped.
 * @param context - The run.
 * @param pending - The pending record of the interrupted run.
 * @throws A {@link journalRefusal} for a name that is not Codebook's own; a {@link leftCopyRefusal} for a file that cannot be resolved.
 */
async function recoverLeftovers(
  context: Context,
  pending: Pending,
): Promise<void> {
  const leftovers = journalLeftovers(context, pending)
  const found: Array<{
    leftover: Leftover
    copy: { sha256: string; ino: bigint }
  }> = []
  // Looking first means a bad name or inode stops the run before anything moved.
  for (const leftover of leftovers) {
    const copy = await lookAtLeftover(context, leftover)
    if (copy) found.push({ leftover, copy })
  }
  for (const { leftover, copy } of found)
    await settleLeftover(context, pending, leftover, copy)
}

/**
 * Settles one leftover of an interrupted run; called by {@link recoverLeftovers}.
 * @param context - The run.
 * @param pending - The pending record.
 * @param leftover - The accepted leftover.
 * @param copy - What {@link lookAtLeftover} found.
 * @throws A {@link leftCopyRefusal} when the file differs from what Codebook expected or cannot be moved or deleted; it stays. For a completed record the refusal is {@link completedLeftRefusal} and the record is dropped first, so it is said once.
 */
async function settleLeftover(
  context: Context,
  pending: Pending,
  leftover: Leftover,
  copy: { sha256: string; ino: bigint },
): Promise<void> {
  const isCompleted = pending.phase === 'completed'
  try {
    await tidyLeftover(context, leftover, copy.sha256, isCompleted)
  } catch (error) {
    if (!isCompleted) throw leftCopyRefusal(context, leftover.path, error)
    // A leftover of a finished change is reported once; the next run does not track it.
    await dropPending(context)
    throw completedLeftRefusal(context, leftover.path, error)
  }
}

/**
 * Puts back or deletes one leftover.
 * @param context - The run.
 * @param leftover - The accepted leftover.
 * @param sha256 - The hash of the bytes the file holds now.
 * @param isCompleted - Whether the publish or removal that made the leftover had finished.
 * @throws When the file differs from what Codebook expected or the move or delete fails.
 */
async function tidyLeftover(
  context: Context,
  { role, path, sha256: expectedSha256 }: Leftover,
  sha256: string,
  isCompleted: boolean,
): Promise<void> {
  // The probe is a link to the staged file; its inode was checked.
  if (role === 'probe') return unlink(path)
  const isConfigAbsent = !lstatSync(context.path, { throwIfNoEntry: false })
  if (role === 'kept' && !isCompleted && isConfigAbsent) {
    // An interrupted move-aside: put the file back, even if it is not the bytes that were read.
    await link(path, context.path)
    await unlink(path)
    return
  }
  if (sha256 !== expectedSha256)
    throw new Error('The leftover file differs from what Codebook expected.')
  await unlink(path)
}

/**
 * Settles a `pending.json` left by a run that ended before it wrote its receipt.
 * An entry whose `{ command, args, env }` equal the pending hash is adopted (receipt written, pending removed), with `createdFile` kept only when the config still is the staged file; a state that shows the rename never happened (no entry, a removal, the receipted entry) drops the pending record; anything else is refused.
 * @param context - The run.
 * @param current - The `codebook` entry in the config, if any.
 * @param receipt - The receipt read before.
 * @param pending - The pending record read before; undefined when there is none.
 * @param look - What the config looked like.
 * @returns The receipt that now stands.
 * @throws A {@link refusal} when the entry is neither the pending one nor the receipted one.
 * @example
 * const receipt = await settlePending(context, current, await readReceipt(context), pending, look)
 */
async function settlePending(
  context: Context,
  current: unknown,
  receipt: Receipt | undefined,
  pending: Pending | undefined,
  look: ConfigLook,
): Promise<Receipt | undefined> {
  if (!pending) return receipt
  const isReceipted =
    receipt !== undefined && receipt.generation === pending.generation
  if (
    look.kind === 'present' &&
    pending.targetPath === context.path &&
    !isReceipted &&
    pending.entrySha256 !== undefined &&
    coreHashOf(current) === pending.entrySha256
  )
    return adoptPending(context, pending, pending.entrySha256, look.identity)
  if (isPendingStale(context, pending, current, receipt)) {
    // The rename never happened (or this was a removal): the pending record is stale.
    await rm(context.pendingPath, { force: true })
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
 * @returns The receipt that was written.
 */
async function adoptPending(
  context: Context,
  pending: Pending,
  entrySha256: string,
  identity: FileIdentity,
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
    config: { ino: recordedFileId(identity.ino) },
  }
  await writeRecord(context.receiptPath, adopted)
  await rm(context.pendingPath, { force: true })
  return adopted
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

/** What a write reports about the entry it published. */
type PublishedEntry = { generation: string; cleanupFailure?: string }

/**
 * Publishes the config with Codebook's entry: the pending record is written by {@link publishRoot} before the rename, the receipt after it.
 * An existing `codebook` entry keeps the keys Devin manages itself (`disabled`, which Customize sets when the server is toggled off, and `disabledTools`); any other added key makes the entry an edit that is never replaced.
 * @param context - The run; its entry must be set.
 * @param look - What the config looked like.
 * @param receipt - The receipt that stands, if any; decides whether the file is still Codebook's own ({@link createdFileFor}).
 * @returns The generation recorded in the receipt, a fresh random id, and the sentence for a kept copy that could not be deleted; an empty generation when the run has no entry.
 * @throws A {@link refusal} when the file changed before the rename or holds a number that would not survive; no record stays when nothing was published.
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
  const createdFile = createdFileFor(look, receipt)
  const generation = randomUUID()
  const root = rootWithEntry(look, entry)
  await context.seam?.afterRead?.()
  const { config, keptLeft } = await publishRoot(context, root, look, {
    entrySha256: entryHash,
    createdFile,
    generation,
  })
  await writeRecord(context.receiptPath, {
    schemaVersion: 1,
    targetPath: context.path,
    entrySha256: entryHash,
    createdFile,
    installed: true,
    generation,
    config,
  } satisfies Receipt)
  // A record that names a copy that stays is kept, so the next run settles that copy.
  if (keptLeft.length === 0) await dropPending(context)
  const cleanupFailure = cleanupFailureOf(keptLeft)
  return cleanupFailure ? { generation, cleanupFailure } : { generation }
}

/**
 * Settles a kept copy and a pending record, reads the config and returns what a run decides on.
 * @param context - The run.
 * @returns The look at the config, its `codebook` entry and the receipt that stands.
 * @throws What {@link recoverLeftovers}, {@link lookAtConfig} and {@link settlePending} throw.
 * @example
 * const { look, current, receipt } = await inspect(context)
 */
async function inspect(context: Context): Promise<{
  look: ConfigLook
  current: unknown
  receipt: Receipt | undefined
}> {
  const pending = await readRecord(
    context.pendingPath,
    pendingSchema,
    context.retry,
  )
  // A copy an interrupted run kept comes back, or is deleted, or is named in the refusal, before the config is read.
  if (pending?.targetPath === context.path)
    await recoverLeftovers(context, pending)
  const look = await lookAtConfig(context)
  const current =
    look.kind === 'present' ? look.servers?.[SERVER_NAME] : undefined
  const receipt = await settlePending(
    context,
    current,
    await readReceipt(context),
    pending,
    look,
  )
  return { look, current, receipt }
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
 * @returns `installed` for a new entry, `updated` for a replaced receipted one, `current` when nothing had to change; the config path; the generation of the entry now recorded, which {@link removeManagedDevinMcpEntry} takes to roll back only this write; and `cleanupFailure` (plain sentences, one per file) naming each private copy that stays, that it holds the settings of the learner's other servers and that it can be deleted when no longer needed.
 * @throws A one-sentence refusal naming "Devin Desktop", the path and the way out, for invalid JSON, a member name that appears twice, a non-object top level or `mcpServers`, a number that would not survive a rewrite, a result beyond the size limit, an unreceipted or changed `codebook` entry, a file that changed during the run (a save that landed meanwhile stays in place), a kept copy that cannot be settled or a pending record of another entry.
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
    if (receipt.entrySha256 === entryHash)
      return { status: 'current', path, generation: receipt.generation }
    const published = await publishEntry(context, look, receipt)
    return { status: 'updated', path, ...published }
  })
}

/**
 * Brings a receipted entry up to date after the Node, bridge or agent folder changed; called on activation in Devin Desktop when setup is recorded.
 * Writes only when a receipt covers the current entry and it differs from `entry`; never creates a file or an entry; keeps every key Devin added to the entry.
 * @param storageRoot - Codebook's global storage folder.
 * @param entry - The server entry the entry should be.
 * @param homeRoot - The home folder; the real one unless a test names its own.
 * @param seam - Test hook, see {@link DevinMcpTestSeam}.
 * @returns `refreshed`, `current`, `not-managed` (no receipt, no file or no entry) or `changed` (the entry differs from the receipt; left alone); the config path; and `cleanupFailure` when a private copy could not be deleted.
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
}> {
  return inLockedFolder(storageRoot, homeRoot, entry, seam, async (context) => {
    const { path, entryHash } = context
    const { look, current, receipt } = await inspect(context)
    if (!receipt || current === undefined)
      return { status: 'not-managed', path }
    if (!ownsEntry(current, receipt)) return { status: 'changed', path }
    if (receipt.entrySha256 === entryHash) return { status: 'current', path }
    const published = await publishEntry(context, look, receipt)
    return {
      status: 'refreshed',
      path,
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
 * @throws The refusals of {@link deleteConfig}, {@link assertRewritable} and {@link publishRoot}.
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
  await context.seam?.afterRead?.()
  // The file goes only when Codebook made it, it is still that file and nothing else is in it.
  if (
    createdFileFor(look, receipt) &&
    Object.keys(otherServers).length === 0 &&
    Object.keys(look.root).length === 1
  )
    return { status: 'file-removed', ...(await deleteConfig(context, look)) }
  assertRewritable(context, look)
  const { keptLeft } = await publishRoot(
    context,
    { ...look.root, mcpServers: otherServers },
    look,
    { createdFile: false },
  )
  if (keptLeft.length === 0) await dropPending(context)
  return { status: 'removed', keptLeft }
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
  | { status: 'not-managed' | 'changed' | 'superseded'; path: string }

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
      const ownership = removalOwnership(
        await inspect(context),
        options.expectedGeneration,
      )
      if ('status' in ownership) {
        // A newer setup's receipt stays; the receipt of an entry that is gone or changed is dropped, because Codebook no longer owns that entry.
        if (ownership.status !== 'superseded')
          await rm(context.receiptPath, { force: true })
        return { status: ownership.status, path: context.path }
      }
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
