import { createHash, randomUUID } from 'node:crypto'
import { lstatSync } from 'node:fs'
import { link, mkdir, open, rename, rm, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

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
import { recordedFileId } from './utils/recordedFileId'
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
  /** Called right after the new config was linked in and before the displaced and staged names are cleaned up, with the displaced path (undefined for a create), so a test can make that cleanup fail. */
  afterPublish?: (displacedPath: string | undefined) => void
  /** Called right after the config was moved to its private name and before that file is compared, so a test can land a save at the config name or write into the moved file. */
  afterMoveAside?: (displacedPath: string) => void
  /** Called after the comparison succeeded and before the new file is linked in, so a test can land a save in that window. */
  afterCompare?: () => void
}

/** A file number as a record holds it: a number up to 2^53 and its digits as text above ({@link recordedFileId}). */
const fileIdSchema = z.union([z.number(), z.string()])

const receiptSchema = z.object({
  schemaVersion: z.literal(1),
  targetPath: z.string(),
  /** Hash of the `command`, `args` and `env` Codebook wrote ({@link coreHashOf}); a receipt of an older build holds the hash of the whole entry, which still counts ({@link ownsEntry}). */
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
  generation: z.string().optional(),
  /** The inode of the staged file before it was published; the config is Codebook's own only if it still has it. */
  stagedIno: fileIdSchema.optional(),
  /** The private name of the staged file, and the hash of the bytes it must hold; a crash leaves it. */
  stagedPath: z.string().optional(),
  stagedSha256: z.string().optional(),
  /** The private name the config is moved to during the step, and the hash of the bytes it must hold. */
  keptPath: z.string().optional(),
  keptSha256: z.string().optional(),
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

/**
 * Hashes only what Codebook writes into its entry, so a key Devin adds (such as `disabled`, which its Customize toggle sets) never changes ownership.
 * @param value - The `codebook` entry as parsed.
 * @returns The canonical hash of `{ command, args, env }`; undefined when the entry is no object.
 * @example
 * coreHashOf({ command: 'node', args: [], env: {}, disabled: true }) === coreHashOf({ command: 'node', args: [], env: {} }) // => true
 */
function coreHashOf(value: unknown): string | undefined {
  if (!isJsonObject(value)) return undefined
  return hashOf({ command: value.command, args: value.args, env: value.env })
}

/**
 * Tells whether a receipt covers the entry that stands in the config.
 * @param current - The `codebook` entry as parsed.
 * @param receipt - The receipt that stands.
 * @returns `true` when the hash of `{ command, args, env }` matches, or the hash of the whole entry matches (a receipt of an older build).
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

/** The sentence for a kept copy that could not be deleted; the work itself is done. */
function copyCleanupFailure(copyPath: string): string {
  return `Codebook could not delete its private copy of your config at ${copyPath}; delete that copy by hand.`
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

/** A private name beside the config for a file that is set aside while the config is replaced or removed. */
function displacedPathOf(path: string): string {
  return `${path}.${randomUUID()}.codebook-displaced`
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

/**
 * Writes the new config bytes to a private temporary file beside the config and reads the new file's inode from the open handle, so nothing after the rename needs to look at the file again.
 * @param path - The config file; its folders are created.
 * @param serialized - The complete new content.
 * @param mode - The permission bits of the new file; the owner's bits only ({@link publishRoot}).
 * @returns The temporary path and the inode the config will have once the file is published.
 */
async function stageConfigFile(
  path: string,
  serialized: string,
  mode: number,
): Promise<{ temporary: string; ino: bigint }> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
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
): Promise<{ config: ConfigNumbers; keptLeft?: string }> {
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
  const isStagedGone = await unlink(temporary).then(
    () => true,
    () => false,
  )
  return isStagedGone ? { config } : { config, keptLeft: temporary }
}

/**
 * Moves the config aside to its private name as the first step of a replacement: whatever file stands at the config name at that instant is the file that moves, so it is the one that gets compared; called by {@link replaceConfig}.
 * @param context - The run.
 * @param temporary - The staged file.
 * @param displaced - The private name, and the bytes and inode the config had when it was read.
 * @param identity - The identity the config had when it was read.
 * @throws A {@link refusal} when the config changed since the read or is gone; or the hard link error of a file system that cannot link. The staged file and the pending record are removed then, because nothing moved.
 */
async function moveConfigAside(
  context: Context,
  temporary: string,
  displaced: KeptCopy,
  identity: FileIdentity,
): Promise<void> {
  try {
    assertConfigUnchanged(context, identity)
    context.seam?.afterCheck?.()
    // The config name is empty until the link-in, so a file system that cannot link is found before anything moves.
    const probePath = `${temporary}.probe`
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
 * @param temporary - The staged file, which is unlinked.
 * @param displaced - The private name of the displaced file.
 * @throws Always: {@link changedWhileWorking} after the file went back (a link never replaces, and the displaced name is unlinked), or a {@link leftCopyRefusal} naming the displaced file when a new config stands at the config name (it is kept) or the link failed.
 */
async function putDisplacedBack(
  context: Context,
  temporary: string,
  displaced: KeptCopy,
): Promise<never> {
  await unlink(temporary).catch(() => undefined)
  try {
    await link(displaced.path, context.path)
  } catch (error) {
    throw leftCopyRefusal(context, displaced.path, error)
  }
  await unlink(displaced.path).catch(() => undefined)
  await dropPending(context)
  throw changedWhileWorking(context)
}

/**
 * Links the staged file in as the config after a successful comparison; called by {@link replaceConfig}. A link never replaces: a file that a save created after the move-aside stays.
 * @param context - The run.
 * @param temporary - The staged file.
 * @param displaced - The displaced file, whose bytes equal what was read.
 * @throws {@link changedWhileWorking} when a config appeared (the staged file is unlinked and the displaced file deleted, because its bytes equal what was read), or a {@link leftCopyRefusal} naming the displaced file when it cannot be deleted or put back. Any other link failure puts the displaced file back and rethrows it.
 */
async function linkInStaged(
  context: Context,
  temporary: string,
  displaced: KeptCopy,
): Promise<void> {
  try {
    await link(temporary, context.path)
    return
  } catch (error) {
    await unlink(temporary).catch(() => undefined)
    if (codeOf(error) !== 'EEXIST') {
      // The config name is empty: the displaced file goes back, else it is named.
      await link(displaced.path, context.path).catch((linkError: unknown) => {
        throw leftCopyRefusal(context, displaced.path, linkError)
      })
      await unlink(displaced.path).catch(() => undefined)
      await dropPending(context)
      throw error
    }
  }
  // A save created the config after the move-aside: it is kept. The displaced file holds what was read, so it can go.
  const isDeleted = await unlink(displaced.path).then(
    () => true,
    () => false,
  )
  if (!isDeleted) throw leftCopyRefusal(context, displaced.path)
  await dropPending(context)
  throw changedWhileWorking(context)
}

/**
 * Replaces an existing config without ever replacing a file that was not compared: the staged file is complete and flushed, the pending record names it and the private name, the config is moved aside, the displaced file's inode and bytes are compared with what was read, and only then is the staged file linked in (a link never replaces).
 * A difference puts the displaced file back and refuses. A config that appeared at the name meanwhile is kept, and the refusal names whichever copy stays.
 * For an instant the config name holds nothing; Devin Desktop reads the config only at window load.
 * @param context - The run.
 * @param temporary - The staged file.
 * @param displaced - The private name, and the bytes and inode the config had when it was read.
 * @param identity - The identity the config had when it was read.
 * @param config - The inode the config will have.
 * @returns The inode, and the copy that could not be deleted afterwards, if any (its pending record stays then).
 * @throws The refusals of {@link moveConfigAside}, {@link putDisplacedBack} and {@link linkInStaged}.
 */
async function replaceConfig(
  context: Context,
  temporary: string,
  displaced: KeptCopy,
  identity: FileIdentity,
  config: ConfigNumbers,
): Promise<{ config: ConfigNumbers; keptLeft?: string }> {
  await moveConfigAside(context, temporary, displaced, identity)
  context.seam?.afterMoveAside?.(displaced.path)
  // Compared by bytes and by inode: the file that moved is the one that was read, or it is put back.
  const copy = await inspectCopy(displaced.path).catch(() => undefined)
  if (!copy || !isExpectedCopy(copy, displaced))
    await putDisplacedBack(context, temporary, displaced)
  context.seam?.afterCompare?.()
  await linkInStaged(context, temporary, displaced)
  context.seam?.afterPublish?.(displaced.path)
  // From here the config is published; cleanup failures are reported and leave the pending record.
  const isStagedGone = await unlink(temporary).then(
    () => true,
    () => false,
  )
  const isDisplacedGone = await unlink(displaced.path).then(
    () => true,
    () => false,
  )
  if (isStagedGone && isDisplacedGone) return { config }
  return { config, keptLeft: isDisplacedGone ? temporary : displaced.path }
}

/**
 * Publishes the config. The new bytes are staged first and their inode read from the open handle; the pending record then names the staged file, its inode and the private name for the displaced file before anything is moved; the record stays from the first move on, because only the next run can tell how far a crash got.
 * A create links the staged file in ({@link createConfig}). A replacement moves the config aside, compares it and links the new file in ({@link replaceConfig}), so no file is replaced without being compared. The new file keeps the owner's permission bits only (`mode & 0o600`), so a rewrite never widens access.
 * Remaining limits: a writer that still holds the old file open may write into the displaced file after the comparison, which is then deleted; a crash leaves the staged and displaced names, which the next run settles ({@link recoverLeftovers}).
 * @param context - The run.
 * @param root - The complete new top-level object.
 * @param look - What was read; its owner bits are kept, its hash and inode are what the displaced file is compared with.
 * @param head - What the pending record says about this write.
 * @returns The inode of the config that now stands, and the copy that could not be deleted, if any (its pending record stays then).
 * @throws A {@link refusal} when the result is larger than {@link DEVIN_MCP_CONFIG_LIMIT_BYTES}, the file changed since the read or a save landed meanwhile (the newer file is left in place), or a leftover copy cannot be settled.
 * @example
 * await publishRoot(context, { mcpServers: {} }, { kind: 'absent' }, { createdFile: true })
 */
async function publishRoot(
  context: Context,
  root: JsonObject,
  look: ConfigLook,
  head: PendingHead,
): Promise<{ config: ConfigNumbers; keptLeft?: string }> {
  const serialized = `${JSON.stringify(root, null, 2)}\n`
  assertWithinSizeLimit(context, serialized)
  const mode =
    look.kind === 'present'
      ? look.identity.mode & PRIVATE_FILE_MODE
      : PRIVATE_FILE_MODE
  const staged = await stageConfigFile(context.path, serialized, mode)
  const displaced: KeptCopy | undefined =
    look.kind === 'present'
      ? {
          path: displacedPathOf(context.path),
          sha256: look.sha256,
          ino: look.identity.ino,
        }
      : undefined
  try {
    await atomicPrivateWrite(
      context.pendingPath,
      {
        ...head,
        targetPath: context.path,
        stagedIno: recordedFileId(staged.ino),
        stagedPath: staged.temporary,
        stagedSha256: bytesSha256(serialized),
        ...(displaced && {
          keptPath: displaced.path,
          keptSha256: displaced.sha256,
        }),
      } satisfies Pending,
      DEVIN_MCP_RECORD_LIMIT_BYTES,
    )
  } catch (error) {
    // Nothing moved yet.
    await unlink(staged.temporary).catch(() => undefined)
    throw error
  }
  const config = { ino: recordedFileId(staged.ino) }
  return look.kind === 'present' && displaced
    ? replaceConfig(context, staged.temporary, displaced, look.identity, config)
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
 * Deletes the config Codebook created, keeping a save that landed after the identity check: the file is renamed to a private name recorded in the pending record, compared (bytes and inode) with what was read, and only then deleted; anything else goes back without replacing a newer file, and the run refuses.
 * Remaining limit: for an instant the config name holds nothing; a file created there then makes the older copy stay under its private `.codebook-displaced` name, which the refusal names.
 * @param context - The run.
 * @param look - What was read; must be present.
 * @returns The private copy that could not be deleted, if any.
 * @throws A {@link refusal} when the file changed or the copy cannot go back; nothing is deleted.
 */
async function deleteConfig(
  context: Context,
  look: Extract<ConfigLook, { kind: 'present' }>,
): Promise<{ keptLeft?: string }> {
  const moved: KeptCopy = {
    path: displacedPathOf(context.path),
    sha256: look.sha256,
    ino: look.identity.ino,
  }
  await atomicPrivateWrite(
    context.pendingPath,
    {
      targetPath: context.path,
      createdFile: false,
      keptPath: moved.path,
      keptSha256: moved.sha256,
    } satisfies Pending,
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
  context.seam?.afterMoveAside?.(moved.path)
  return settleMovedAside(context, moved)
}

/**
 * Compares the file that was renamed aside with what was read and either deletes it or puts it back; called by {@link deleteConfig}.
 * @param context - The run.
 * @param moved - The private name and the bytes and inode the file must have.
 * @returns The copy that stays when it could not be deleted.
 * @throws A {@link refusal} after a different file was put back, or naming the copy when it cannot go back.
 */
async function settleMovedAside(
  context: Context,
  moved: KeptCopy,
): Promise<{ keptLeft?: string }> {
  let copy
  try {
    copy = await inspectCopy(moved.path)
  } catch (error) {
    throw leftCopyRefusal(context, moved.path, error)
  }
  if (copy && !isExpectedCopy(copy, moved)) {
    // The file is not the one that was read, whatever its bytes: link it back (never replacing a newer file) and refuse.
    try {
      await link(moved.path, context.path)
    } catch (error) {
      throw leftCopyRefusal(context, moved.path, error)
    }
    await unlink(moved.path).catch(() => undefined)
    await dropPending(context)
    throw changedWhileWorking(context)
  }
  if (copy) {
    const isDeleted = await unlink(moved.path).then(
      () => true,
      () => false,
    )
    if (!isDeleted) return { keptLeft: moved.path }
  }
  await dropPending(context)
  return {}
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

/**
 * Recovers what an interrupted run left under the private names its pending record holds; called by {@link inspect} before the config is read.
 * - The displaced config while the config name is empty: it goes back with a link, which never replaces anything.
 * - A displaced or staged file that holds exactly the bytes the record names: it is Codebook's own leftover and is deleted.
 * - Anything else stays, and the refusal names it.
 * @param context - The run.
 * @param pending - The pending record of the interrupted run.
 * @throws A {@link leftCopyRefusal} for a file that cannot be resolved.
 */
async function recoverLeftovers(
  context: Context,
  pending: Pending,
): Promise<void> {
  if (pending.keptPath !== undefined)
    await recoverCopy(context, pending.keptPath, pending.keptSha256, true)
  if (pending.stagedPath !== undefined)
    await recoverCopy(context, pending.stagedPath, pending.stagedSha256, false)
}

/**
 * Settles one leftover file of an interrupted run; called by {@link recoverLeftovers}.
 * @param context - The run.
 * @param copyPath - The private name from the pending record.
 * @param expectedSha256 - The hash of the bytes the file must hold to be deleted.
 * @param canRestore - Whether the file goes back to the config name when that name is empty.
 * @throws A {@link leftCopyRefusal} when the file differs from what Codebook expected or cannot be read, moved or deleted; it stays.
 */
async function recoverCopy(
  context: Context,
  copyPath: string,
  expectedSha256: string | undefined,
  canRestore: boolean,
): Promise<void> {
  try {
    const copy = await inspectCopy(copyPath)
    if (!copy) return
    if (canRestore && !lstatSync(context.path, { throwIfNoEntry: false })) {
      // An interrupted move-aside: put the file back, even if it is not the bytes that were read.
      await link(copyPath, context.path)
      await unlink(copyPath)
      return
    }
    if (copy.sha256 !== expectedSha256)
      throw new Error('The leftover file differs from what Codebook expected.')
    await unlink(copyPath)
  } catch (error) {
    throw leftCopyRefusal(context, copyPath, error)
  }
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

/** What a write reports about the entry it published. */
type PublishedEntry = { generation: string; cleanupFailure?: string }

/**
 * Publishes the config with Codebook's entry: the pending record is written by {@link publishRoot} before the rename, the receipt after it.
 * An existing `codebook` entry keeps every key that is not `command`, `args` or `env` (Devin adds `disabled` when the server is toggled off in Customize).
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
  const base = look.kind === 'present' ? look.root : {}
  const servers = look.kind === 'present' ? (look.servers ?? {}) : {}
  const existing = servers[SERVER_NAME]
  // The three keys Codebook owns are replaced; every other key of an existing entry stays.
  const written = isJsonObject(existing) ? { ...existing, ...entry } : entry
  await context.seam?.afterRead?.()
  const { config, keptLeft } = await publishRoot(
    context,
    { ...base, mcpServers: { ...servers, [SERVER_NAME]: written } },
    look,
    { entrySha256: entryHash, createdFile, generation },
  )
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
  if (!keptLeft) await dropPending(context)
  return keptLeft
    ? { generation, cleanupFailure: copyCleanupFailure(keptLeft) }
    : { generation }
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
 * Every other key and server stays as it is, and so does every key Devin added to the codebook entry (`disabled`). An entry that the receipt does not cover, or whose `command`, `args` or `env` changed since, is never replaced.
 * @param storageRoot - Codebook's global storage folder; holds `devin-mcp/receipt.json`.
 * @param entry - The server entry to keep.
 * @param homeRoot - The home folder; the real one unless a test names its own.
 * @param seam - Test hook, see {@link DevinMcpTestSeam}.
 * @returns `installed` for a new entry, `updated` for a replaced receipted one, `current` when nothing had to change; the config path; the generation of the entry now recorded, which {@link removeManagedDevinMcpEntry} takes to roll back only this write; and `cleanupFailure` (one sentence) when Codebook's private copy of the old config could not be deleted.
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
 * @returns `file-removed` when the file went, `removed` when only the entry went, and the private copy that could not be deleted, if any.
 * @throws The refusals of {@link deleteConfig}, {@link assertRewritable} and {@link publishRoot}.
 * @example
 * await takeEntryOut(context, owned) // => { status: 'removed' }
 */
async function takeEntryOut(
  context: Context,
  { look, receipt }: Extract<RemovalOwnership, { receipt: Receipt }>,
): Promise<{ status: 'file-removed' | 'removed'; keptLeft?: string }> {
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
  if (!keptLeft) await dropPending(context)
  return { status: 'removed', keptLeft }
}

/**
 * Drops the receipt of an entry the removal has taken out; called by {@link removeManagedDevinMcpEntry}. The config has already changed, so a receipt or a private copy that cannot be deleted is reported beside the result instead of thrown.
 * @param receiptPath - Codebook's receipt of the entry.
 * @param status - How the removal changed the config.
 * @param path - The config.
 * @param keptLeft - The private copy of the config that could not be deleted, if any.
 * @returns The removal's result, with `cleanupFailure` when something stays.
 * @example
 * await dropReceiptAfterRemoval('/private/devin-mcp/receipt.json', 'removed', path) // => { status: 'removed', path }
 */
async function dropReceiptAfterRemoval(
  receiptPath: string,
  status: 'file-removed' | 'removed',
  path: string,
  keptLeft: string | undefined,
): Promise<DevinMcpRemovalResult> {
  let cleanupFailure = keptLeft ? copyCleanupFailure(keptLeft) : undefined
  try {
    await rm(receiptPath, { force: true })
  } catch {
    cleanupFailure ??= `Codebook could not delete its own record of that entry at ${receiptPath}; delete that record by hand.`
  }
  return cleanupFailure ? { status, path, cleanupFailure } : { status, path }
}

/** What a removal reports: the config change that was made, apart from a failure to delete Codebook's own record afterwards. */
export type DevinMcpRemovalResult =
  | {
      status: 'removed' | 'file-removed'
      path: string
      /** One sentence (no raw error text) when the entry is gone but Codebook's receipt or a private copy could not be deleted; the caller still reports the removal. */
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
 * Deletes the file only when Codebook created it (the receipt says so and the inode is the one Codebook wrote) and nothing else is left in it. An entry whose `command`, `args` or `env` changed since the receipt is left alone and the receipt is dropped, because Codebook no longer owns it; keys Devin added (`disabled`) do not change ownership.
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
