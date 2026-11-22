import { createHash } from 'node:crypto'
import { lstatSync } from 'node:fs'
import { mkdir, readFile, rm, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import { z } from 'zod'

import {
  DEVIN_MCP_CONFIG_LIMIT_BYTES,
  DEVIN_MCP_RECORD_LIMIT_BYTES,
} from './constants'
import { atomicPrivateBytes } from './utils/atomicPrivateBytes'
import { atomicPrivateWrite } from './utils/atomicPrivateWrite'
import { canonicalJson } from './utils/canonicalJson'
import { openWithoutFollowing } from './utils/openWithoutFollowing'
import { withStorageLock } from './utils/withStorageLock'

/** The one MCP server Codebook adds to Devin Desktop's user config. */
const SERVER_NAME = 'codebook'

/** The sentence ending every refusal that asks the learner to run the setup again. */
const SET_UP_AGAIN = 'then run Codebook: Set Up AI Chat again'

/** The stdio server Devin Local launches for Codebook: an absolute Node, the bridge and the agent folder; it never holds a token. */
export type DevinMcpEntry = {
  command: string
  args: string[]
  env: Record<string, string>
}

/** What a test can hook into: called after the config was read and before it is replaced, so a test can change the file in between ({@link assertConfigUnchanged}). */
export type DevinMcpTestSeam = { afterRead?: () => Promise<void> | void }

const receiptSchema = z.object({
  schemaVersion: z.literal(1),
  targetPath: z.string(),
  entrySha256: z.string(),
  createdFile: z.boolean(),
  installed: z.boolean(),
})
const pendingSchema = z.object({
  targetPath: z.string(),
  entrySha256: z.string(),
  createdFile: z.boolean(),
})
type Receipt = z.infer<typeof receiptSchema>
/** A parsed JSON object; its own keys, `__proto__` included, are kept as parsed. */
type JsonObject = Record<string, unknown>

/** Size, times and file numbers that tell whether a file is still the one that was read. */
type FileIdentity = {
  dev: number
  ino: number
  size: number
  mtimeMs: number
  /** The permission bits (`mode & 0o777`) the file had when it was read, so a replacement keeps them. */
  mode: number
}

type ConfigLook =
  | { kind: 'absent' }
  | {
      kind: 'present'
      root: JsonObject
      servers: JsonObject | undefined
      identity: FileIdentity
    }

/** Everything one locked run needs about the target and the records. */
type Context = {
  path: string
  receiptPath: string
  pendingPath: string
  entry: DevinMcpEntry | undefined
  entryHash: string | undefined
  seam: DevinMcpTestSeam | undefined
}

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

/**
 * Builds the one-sentence refusal every unsafe state ends in.
 * @param found - What Codebook found.
 * @param path - The config file.
 * @param wayOut - What the learner does next.
 * @param cause - The failure behind the refusal, kept for diagnosis and never put into the sentence.
 * @returns The error, not thrown yet.
 * @example
 * throw refusal('text that is not valid JSON', path, `fix it, ${SET_UP_AGAIN}`)
 */
function refusal(
  found: string,
  path: string,
  wayOut: string,
  cause?: unknown,
): Error {
  return new Error(
    `Codebook found ${found} in Devin Desktop's MCP config at ${path} and left that file untouched; ${wayOut}.`,
    cause === undefined ? undefined : { cause },
  )
}

/**
 * Builds the refusal for a config that could not be opened or read (permissions, a parent that is a file, a failing disk); called by {@link lookAtConfig}.
 * @param path - The config file.
 * @param cause - The file system error; kept as `cause`, not echoed.
 * @returns The error, not thrown yet.
 * @example
 * throw unreadableRefusal(path, error)
 */
function unreadableRefusal(path: string, cause: unknown): Error {
  return refusal(
    'a file it could not read',
    path,
    `make it readable by you, ${SET_UP_AGAIN}`,
    cause,
  )
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

/** Picks the numbers that identify a file from a `stat` answer; the mode is cut to its permission bits. */
function identityOf(status: FileIdentity): FileIdentity {
  const { dev, ino, size, mtimeMs, mode } = status
  return { dev, ino, size, mtimeMs, mode: mode & 0o777 }
}

/**
 * Reads the config without following a link and checks its shape; every run starts here.
 * @param path - The config file.
 * @returns `absent` for a missing file, else the parsed object with the identity of the file that was read.
 * @throws A {@link refusal} for a link, a non-regular file, a file that cannot be read, a file larger than {@link DEVIN_MCP_CONFIG_LIMIT_BYTES}, invalid JSON, a top level that is no object or an `mcpServers` that is no object.
 * @example
 * await lookAtConfig('/home/lume/.config/devin/mcp_config.json') // => { kind: 'absent' }
 */
async function lookAtConfig(path: string): Promise<ConfigLook> {
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
        `replace the link with the file itself, ${SET_UP_AGAIN}`,
      )
    // EACCES, ENOTDIR, EIO and the rest: one sentence instead of a raw error.
    throw unreadableRefusal(path, error)
  }
  try {
    const status = await file.stat().catch((error) => {
      throw unreadableRefusal(path, error)
    })
    if (!status.isFile())
      throw refusal(
        'something that is no regular file',
        path,
        `remove it, ${SET_UP_AGAIN}`,
      )
    // A huge file is refused before it is read into memory.
    if (status.size > DEVIN_MCP_CONFIG_LIMIT_BYTES)
      throw refusal(
        `a file larger than ${DEVIN_MCP_CONFIG_LIMIT_BYTES} bytes`,
        path,
        `shrink or move it, ${SET_UP_AGAIN}`,
      )
    const text = await file.readFile('utf8').catch((error) => {
      throw unreadableRefusal(path, error)
    })
    return parseConfig(path, text, identityOf(status))
  } finally {
    await file.close()
  }
}

/**
 * Parses the text of the config and checks its shape; called by {@link lookAtConfig}.
 * @param path - The config file, for the refusals.
 * @param text - The file's text.
 * @param identity - The identity of the file that was read.
 * @returns The parsed top-level object and its servers.
 * @throws A {@link refusal} for invalid JSON, a top level that is no object or an `mcpServers` that is no object.
 * @example
 * parseConfig(path, '{}', identity) // => { kind: 'present', root: {}, servers: undefined, identity }
 */
function parseConfig(
  path: string,
  text: string,
  identity: FileIdentity,
): ConfigLook {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw refusal(
      'text that is not valid JSON',
      path,
      `fix or move that file, ${SET_UP_AGAIN}`,
    )
  }
  if (!isJsonObject(parsed))
    throw refusal(
      'a top-level value that is no object',
      path,
      `fix or move that file, ${SET_UP_AGAIN}`,
    )
  const rawServers = parsed.mcpServers
  if (rawServers === undefined)
    return { kind: 'present', root: parsed, servers: undefined, identity }
  if (!isJsonObject(rawServers))
    throw refusal(
      'an "mcpServers" value that is no object',
      path,
      `fix that value, ${SET_UP_AGAIN}`,
    )
  return { kind: 'present', root: parsed, servers: rawServers, identity }
}

/**
 * Throws when the config is no longer the file that was read; runs just before the rename ({@link publishRoot}) and before a deletion.
 * @param path - The config file.
 * @param expected - The identity read earlier; undefined when the file was absent.
 * @throws A {@link refusal} naming the change; nothing was written.
 * @example
 * assertConfigUnchanged(path, look.identity)
 */
function assertConfigUnchanged(
  path: string,
  expected: FileIdentity | undefined,
): void {
  const now = lstatSync(path, { throwIfNoEntry: false })
  const didChange = expected
    ? !now ||
      now.dev !== expected.dev ||
      now.ino !== expected.ino ||
      now.size !== expected.size ||
      now.mtimeMs !== expected.mtimeMs
    : Boolean(now)
  if (didChange)
    throw refusal(
      'a file that changed while Codebook was working on it',
      path,
      `look at the file, ${SET_UP_AGAIN}`,
    )
}

/**
 * Replaces the config atomically with two-space JSON and a final newline.
 * @param path - The config file.
 * @param root - The complete new top-level object.
 * @param identity - What was read, whose mode the replacement keeps; undefined when the file was absent (its folders are then created, the file is private).
 * @throws A {@link refusal} when the file changed since the read; nothing was written.
 * @example
 * await publishRoot(path, { mcpServers: {} }, undefined)
 */
async function publishRoot(
  path: string,
  root: JsonObject,
  identity: FileIdentity | undefined,
): Promise<void> {
  if (!identity) await mkdir(dirname(path), { recursive: true })
  // An existing config keeps the permission bits it had; only a file Codebook creates is private.
  await atomicPrivateBytes(
    path,
    `${JSON.stringify(root, null, 2)}\n`,
    () => assertConfigUnchanged(path, identity),
    undefined,
    identity?.mode,
  )
}

/**
 * Reads one of Codebook's own records.
 * @param path - The record file.
 * @param schema - The shape it must have.
 * @returns The record; undefined when absent.
 * @throws When the record is unreadable or has another shape; the config is not touched.
 * @example
 * await readRecord(receiptPath, receiptSchema)
 */
async function readRecord<Schema extends z.ZodType>(
  path: string,
  schema: Schema,
): Promise<z.infer<Schema> | undefined> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if (codeOf(error) === 'ENOENT') return undefined
    throw error
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
      `Codebook's Devin Desktop MCP record at ${path} is unreadable and the config was left untouched; remove that record, ${SET_UP_AGAIN}.`,
    )
  return record.data
}

/** Writes one of Codebook's own records atomically. */
function writeRecord(path: string, value: unknown): Promise<void> {
  return atomicPrivateWrite(path, value, DEVIN_MCP_RECORD_LIMIT_BYTES)
}

/** The receipt, when it covers this run's config path. */
async function readReceipt(context: Context): Promise<Receipt | undefined> {
  const receipt = await readRecord(context.receiptPath, receiptSchema)
  return receipt?.targetPath === context.path ? receipt : undefined
}

/**
 * Settles a `pending.json` left by a run that ended before it wrote its receipt.
 * An entry that equals the pending hash is adopted (receipt written, pending removed); a state that shows the rename never happened (no entry, or the receipted one) drops the pending record; anything else is refused.
 * @param context - The run.
 * @param current - The `codebook` entry in the config, if any.
 * @param receipt - The receipt read before.
 * @returns The receipt that now stands.
 * @throws A {@link refusal} when the entry is neither the pending one nor the receipted one.
 * @example
 * const receipt = await settlePending(context, current, await readReceipt(context))
 */
async function settlePending(
  context: Context,
  current: unknown,
  receipt: Receipt | undefined,
): Promise<Receipt | undefined> {
  const pending = await readRecord(context.pendingPath, pendingSchema)
  if (!pending) return receipt
  const currentHash = current === undefined ? undefined : hashOf(current)
  if (
    pending.targetPath === context.path &&
    currentHash === pending.entrySha256
  ) {
    // The rename happened and the receipt was not written: the entry is Codebook's.
    const adopted: Receipt = {
      schemaVersion: 1,
      targetPath: context.path,
      entrySha256: pending.entrySha256,
      createdFile: pending.createdFile,
      installed: true,
    }
    await writeRecord(context.receiptPath, adopted)
    await rm(context.pendingPath, { force: true })
    return adopted
  }
  if (
    pending.targetPath !== context.path ||
    currentHash === undefined ||
    currentHash === receipt?.entrySha256
  ) {
    // The rename never happened: the pending record is stale.
    await rm(context.pendingPath, { force: true })
    return receipt
  }
  throw refusal(
    `a "${SERVER_NAME}" entry that differs from the one an interrupted Codebook run was writing`,
    context.path,
    `rename or remove that entry, ${SET_UP_AGAIN}`,
  )
}

/**
 * Publishes the config with Codebook's entry: pending record first, receipt after the rename.
 * @param context - The run; its entry must be set.
 * @param look - What the config looked like.
 * @param createdFile - Whether Codebook created (or is creating) the file.
 * @throws A {@link refusal} when the file changed before the rename; the pending record is removed.
 * @example
 * await publishEntry(context, look, true)
 */
async function publishEntry(
  context: Context,
  look: ConfigLook,
  createdFile: boolean,
): Promise<void> {
  const { entry, entryHash } = context
  if (!entry || !entryHash) return
  const base = look.kind === 'present' ? look.root : {}
  const servers = look.kind === 'present' ? (look.servers ?? {}) : {}
  await writeRecord(context.pendingPath, {
    targetPath: context.path,
    entrySha256: entryHash,
    createdFile,
  })
  try {
    await context.seam?.afterRead?.()
    await publishRoot(
      context.path,
      { ...base, mcpServers: { ...servers, [SERVER_NAME]: entry } },
      look.kind === 'present' ? look.identity : undefined,
    )
  } catch (error) {
    await rm(context.pendingPath, { force: true })
    throw error
  }
  await writeRecord(context.receiptPath, {
    schemaVersion: 1,
    targetPath: context.path,
    entrySha256: entryHash,
    createdFile,
    installed: true,
  } satisfies Receipt)
  await rm(context.pendingPath, { force: true })
}

/**
 * Reads the config, settles a pending record and returns what a run decides on.
 * @param context - The run.
 * @returns The look at the config, its `codebook` entry and the receipt that stands.
 * @throws What {@link lookAtConfig} and {@link settlePending} throw.
 * @example
 * const { look, current, receipt } = await inspect(context)
 */
async function inspect(context: Context): Promise<{
  look: ConfigLook
  current: unknown
  receipt: Receipt | undefined
}> {
  const look = await lookAtConfig(context.path)
  const current =
    look.kind === 'present' ? look.servers?.[SERVER_NAME] : undefined
  const receipt = await settlePending(
    context,
    current,
    await readReceipt(context),
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
    entryHash: entry && hashOf(entry),
    seam,
  }
  return withStorageLock(folder, () => run(context))
}

/**
 * Adds or updates the one `codebook` entry in Devin Desktop's MCP config and keeps a receipt of it; called by Codebook: Set Up AI Chat in Devin Desktop.
 * Every other key and server stays as it is. An entry that the receipt does not cover, or that changed since, is never replaced.
 * @param storageRoot - Codebook's global storage folder; holds `devin-mcp/receipt.json`.
 * @param entry - The server entry to keep.
 * @param homeRoot - The home folder; the real one unless a test names its own.
 * @param seam - Test hook, see {@link DevinMcpTestSeam}.
 * @returns `installed` for a new entry, `updated` for a replaced receipted one, `current` when nothing had to change; and the config path.
 * @throws A one-sentence refusal naming "Devin Desktop", the path and the way out, with the file untouched, for invalid JSON, a non-object top level or `mcpServers`, an unreceipted or changed `codebook` entry, a file that changed during the run or a pending record of another entry.
 * @example
 * await writeManagedDevinMcpEntry(storageRoot, { command: '/usr/bin/node', args: [bridge, agentFolder], env: {} })
 */
export async function writeManagedDevinMcpEntry(
  storageRoot: string,
  entry: DevinMcpEntry,
  homeRoot = homedir(),
  seam?: DevinMcpTestSeam,
): Promise<{ status: 'installed' | 'updated' | 'current'; path: string }> {
  return inLockedFolder(storageRoot, homeRoot, entry, seam, async (context) => {
    const { path, entryHash } = context
    const { look, current, receipt } = await inspect(context)
    if (current === undefined) {
      const createdFile =
        look.kind === 'absent' || Boolean(receipt?.createdFile)
      await publishEntry(context, look, createdFile)
      return { status: 'installed', path }
    }
    if (!receipt)
      throw refusal(
        `a "${SERVER_NAME}" entry of your own`,
        path,
        `rename or remove that entry, ${SET_UP_AGAIN}`,
      )
    if (hashOf(current) !== receipt.entrySha256)
      throw refusal(
        `a "${SERVER_NAME}" entry that changed after Codebook wrote it`,
        path,
        `rename or remove that entry, ${SET_UP_AGAIN}`,
      )
    if (receipt.entrySha256 === entryHash) return { status: 'current', path }
    await publishEntry(context, look, receipt.createdFile)
    return { status: 'updated', path }
  })
}

/**
 * Brings a receipted entry up to date after the Node, bridge or agent folder changed; called on activation in Devin Desktop when setup is recorded.
 * Writes only when a receipt covers the current entry and it differs from `entry`; never creates a file or an entry.
 * @param storageRoot - Codebook's global storage folder.
 * @param entry - The server entry the entry should be.
 * @param homeRoot - The home folder; the real one unless a test names its own.
 * @param seam - Test hook, see {@link DevinMcpTestSeam}.
 * @returns `refreshed`, `current`, `not-managed` (no receipt, no file or no entry) or `changed` (the entry differs from the receipt; left alone); and the config path.
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
}> {
  return inLockedFolder(storageRoot, homeRoot, entry, seam, async (context) => {
    const { path, entryHash } = context
    const { look, current, receipt } = await inspect(context)
    if (!receipt || current === undefined)
      return { status: 'not-managed', path }
    if (hashOf(current) !== receipt.entrySha256)
      return { status: 'changed', path }
    if (receipt.entrySha256 === entryHash) return { status: 'current', path }
    await publishEntry(context, look, receipt.createdFile)
    return { status: 'refreshed', path }
  })
}

/**
 * Removes the receipted `codebook` entry; called by Codebook: Remove Devin Desktop Setup.
 * Deletes the file only when Codebook created it and nothing else is left in it. An entry that changed since the receipt is left alone and the receipt is dropped, because Codebook no longer owns it.
 * @param storageRoot - Codebook's global storage folder.
 * @param homeRoot - The home folder; the real one unless a test names its own.
 * @param seam - Test hook, see {@link DevinMcpTestSeam}.
 * @returns `removed`, `file-removed`, `not-managed` (no receipt, or the entry is already gone) or `changed`; and the config path.
 * @throws The refusals of {@link writeManagedDevinMcpEntry} for an unreadable config or a file that changed during the removal.
 * @example
 * await removeManagedDevinMcpEntry(storageRoot) // => { status: 'removed', path }
 */
export async function removeManagedDevinMcpEntry(
  storageRoot: string,
  homeRoot = homedir(),
  seam?: DevinMcpTestSeam,
): Promise<{
  status: 'removed' | 'file-removed' | 'not-managed' | 'changed'
  path: string
}> {
  return inLockedFolder(
    storageRoot,
    homeRoot,
    undefined,
    seam,
    async (context) => {
      const { path } = context
      const { look, current, receipt } = await inspect(context)
      if (look.kind === 'absent' || !receipt || current === undefined) {
        await rm(context.receiptPath, { force: true })
        return { status: 'not-managed', path }
      }
      if (hashOf(current) !== receipt.entrySha256) {
        await rm(context.receiptPath, { force: true })
        return { status: 'changed', path }
      }
      const otherServers = Object.fromEntries(
        Object.entries(look.servers ?? {}).filter(
          ([name]) => name !== SERVER_NAME,
        ),
      )
      await seam?.afterRead?.()
      // The file goes only when Codebook made it and nothing else is in it.
      const isLeftEmpty =
        receipt.createdFile &&
        Object.keys(otherServers).length === 0 &&
        Object.keys(look.root).length === 1
      if (isLeftEmpty) {
        assertConfigUnchanged(path, look.identity)
        await unlink(path)
      } else {
        await publishRoot(
          path,
          { ...look.root, mcpServers: otherServers },
          look.identity,
        )
      }
      await rm(context.receiptPath, { force: true })
      return { status: isLeftEmpty ? 'file-removed' : 'removed', path }
    },
  )
}
