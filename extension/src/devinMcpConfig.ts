import { createHash, randomUUID } from 'node:crypto'
import { linkSync, lstatSync } from 'node:fs'
import {
  link,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  unlink,
} from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import { z } from 'zod'

import {
  DEVIN_MCP_CONFIG_LIMIT_BYTES,
  DEVIN_MCP_RECORD_LIMIT_BYTES,
  PRIVATE_FILE_MODE,
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
export type DevinMcpTestSeam = {
  afterRead?: () => Promise<void> | void
  /** Called right after the identity check and before the config is linked aside, renamed or created, so a test can land a save in the window the check cannot see. */
  afterCheck?: () => void
}

const receiptSchema = z.object({
  schemaVersion: z.literal(1),
  targetPath: z.string(),
  entrySha256: z.string(),
  createdFile: z.boolean(),
  installed: z.boolean(),
  /** Random id of the write that made this entry, so a rollback never removes a newer setup's entry. */
  generation: z.string(),
  /** The file numbers of the config Codebook last wrote; the file counts as Codebook's own only while they still match. */
  config: z.object({ dev: z.number(), ino: z.number() }),
})
const pendingSchema = z.object({
  targetPath: z.string(),
  entrySha256: z.string(),
  createdFile: z.boolean(),
  generation: z.string().optional(),
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
      /** The text that was read, to tell a save made meanwhile from the file that was read. */
      text: string
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

/** The refusal for a config that another writer changed while Codebook worked on it. */
function changedWhileWorking(path: string): Error {
  return refusal(
    'a file that changed while Codebook was working on it',
    path,
    `look at the file, ${SET_UP_AGAIN}`,
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
  let hasLossyNumber = false
  try {
    // A number whose shortest form differs from its source text would change when written back (`9007199254740993`, `1.0`).
    // The reviver's third argument (Node 22+) is not in TypeScript's lib yet, so it is declared optional here.
    parsed = JSON.parse(
      text,
      (_key: string, value: unknown, context?: { source?: string }) => {
        // A host whose JavaScript engine passes no source text cannot be checked here.
        if (
          typeof value === 'number' &&
          context?.source !== undefined &&
          String(value) !== context.source
        )
          hasLossyNumber = true
        return value
      },
    )
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
    return {
      kind: 'present',
      root: parsed,
      servers: undefined,
      identity,
      text,
      hasLossyNumber,
    }
  if (!isJsonObject(rawServers))
    throw refusal(
      'an "mcpServers" value that is no object',
      path,
      `fix that value, ${SET_UP_AGAIN}`,
    )
  return {
    kind: 'present',
    root: parsed,
    servers: rawServers,
    identity,
    text,
    hasLossyNumber,
  }
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
  if (didChange) throw changedWhileWorking(path)
}

/** The file numbers a receipt records for the config Codebook wrote. */
type ConfigNumbers = Receipt['config']

/** A private name beside the config for a file that is set aside while the config is replaced or removed. */
function displacedPathOf(path: string): string {
  return `${path}.${randomUUID()}.codebook-displaced`
}

/**
 * Reads the text of a retained copy of the config; undefined when it cannot be read, which counts as a change.
 * @param path - The retained copy.
 * @returns Its text, or undefined.
 */
function textOrUndefined(path: string): Promise<string | undefined> {
  return readFile(path, 'utf8').catch(() => undefined)
}

/**
 * Refuses a rewrite that would change a number the learner wrote (an integer beyond 2^53, a long decimal, `1.0`); called before every rewrite of an existing config.
 * @param path - The config file.
 * @param look - What the config looked like.
 * @throws A {@link refusal}; the file is untouched.
 * @example
 * assertRewritable(path, look)
 */
function assertRewritable(path: string, look: ConfigLook): void {
  if (look.kind === 'present' && look.hasLossyNumber)
    throw refusal(
      'a number Codebook cannot write back unchanged (such as 1.0 or an integer beyond 9007199254740991)',
      path,
      `write that number in its shortest form, ${SET_UP_AGAIN}`,
    )
}

/**
 * Creates the config without replacing a file that appeared since the read: the new bytes go to a private name and are hard-linked to the config name, which never replaces.
 * @param path - The config file; its folders are created.
 * @param text - The complete new content.
 * @param seam - Test hook.
 * @throws A {@link refusal} when a file stands at `path` by then; it is left as it is.
 */
async function createConfig(
  path: string,
  text: string,
  seam: DevinMcpTestSeam | undefined,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  const handle = await open(temporary, 'wx', PRIVATE_FILE_MODE)
  try {
    try {
      await handle.writeFile(text)
      await handle.sync()
    } finally {
      await handle.close()
    }
    seam?.afterCheck?.()
    await link(temporary, path).catch((error: unknown) => {
      // A file that appeared meanwhile is the learner's: never replaced.
      if (codeOf(error) === 'EEXIST') throw changedWhileWorking(path)
      throw error
    })
  } finally {
    await unlink(temporary).catch(() => undefined)
  }
}

/**
 * Replaces an existing config atomically with two-space JSON and a final newline, keeping a save that landed after the identity check.
 * The displaced file is retained as a hard link right before the rename and compared with the text that was read afterwards; a difference means the learner (or Devin) saved in between, so the retained file goes back and the run refuses.
 * An absent config is created without replacing anything ({@link createConfig}).
 * Remaining limit: a program that atomically replaces the config in the microseconds between the link and the rename is not noticed, because the link then holds the old inode.
 * @param path - The config file.
 * @param root - The complete new top-level object.
 * @param look - What was read; its mode is kept by the replacement, its text is the snapshot a retained file is compared with.
 * @param seam - Test hook, see {@link DevinMcpTestSeam}.
 * @returns The file numbers of the config that now stands.
 * @throws A {@link refusal} when the file changed since the read or a save landed meanwhile; the newer file is left in place.
 * @example
 * await publishRoot(path, { mcpServers: {} }, { kind: 'absent' }, undefined)
 */
async function publishRoot(
  path: string,
  root: JsonObject,
  look: ConfigLook,
  seam: DevinMcpTestSeam | undefined,
): Promise<ConfigNumbers> {
  const text = `${JSON.stringify(root, null, 2)}\n`
  if (look.kind === 'absent') {
    await createConfig(path, text, seam)
  } else {
    const retainedPath = displacedPathOf(path)
    try {
      // An existing config keeps the permission bits it had; only a file Codebook creates is private.
      await atomicPrivateBytes(
        path,
        text,
        () => {
          assertConfigUnchanged(path, look.identity)
          seam?.afterCheck?.()
          linkSync(path, retainedPath)
        },
        undefined,
        look.identity.mode,
      )
    } catch (error) {
      await unlink(retainedPath).catch(() => undefined)
      throw error
    }
    const retained = await textOrUndefined(retainedPath)
    if (retained === look.text) {
      await unlink(retainedPath)
    } else {
      // A save landed between the check and the rename: put it back unless the config holds something else by now.
      if ((await textOrUndefined(path)) === text)
        await rename(retainedPath, path)
      throw changedWhileWorking(path)
    }
  }
  const { dev, ino } = await stat(path)
  return { dev, ino }
}

/**
 * Deletes the config Codebook created, keeping a save that landed after the identity check: the file is renamed aside, compared with the text that was read, and only then deleted; a different text goes back and the run refuses.
 * Remaining limit: for an instant the config name holds nothing, and a file created there then makes the older save stay under its private `.codebook-displaced` name.
 * @param path - The config file.
 * @param look - What was read; must be present.
 * @param seam - Test hook.
 * @throws A {@link refusal} when the file changed; nothing is deleted.
 */
async function deleteConfig(
  path: string,
  look: Extract<ConfigLook, { kind: 'present' }>,
  seam: DevinMcpTestSeam | undefined,
): Promise<void> {
  assertConfigUnchanged(path, look.identity)
  seam?.afterCheck?.()
  const displacedPath = displacedPathOf(path)
  await rename(path, displacedPath)
  if ((await textOrUndefined(displacedPath)) === look.text) {
    await unlink(displacedPath)
    return
  }
  // The file is not the one that was read: link it back (never replacing a newer file) and refuse.
  await link(displacedPath, path)
    .then(() => unlink(displacedPath))
    .catch(() => undefined)
  throw changedWhileWorking(path)
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
      generation: pending.generation ?? randomUUID(),
      // The config that stands now holds the adopted entry.
      config: await configNumbersOf(context.path),
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
 * Reads the file numbers of the config that stands.
 * @param path - The config file.
 * @returns Its device and inode numbers.
 */
async function configNumbersOf(path: string): Promise<ConfigNumbers> {
  const { dev, ino } = await stat(path)
  return { dev, ino }
}

/**
 * Tells whether the config file is the one Codebook created: an absent file is created now; an existing one counts only while the receipt says Codebook created it and its file numbers are those Codebook last wrote.
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
    receipt?.createdFile &&
    receipt.config.dev === look.identity.dev &&
    receipt.config.ino === look.identity.ino,
  )
}

/**
 * Publishes the config with Codebook's entry: pending record first, receipt after the rename.
 * @param context - The run; its entry must be set.
 * @param look - What the config looked like.
 * @param receipt - The receipt that stands, if any; decides whether the file is still Codebook's own ({@link createdFileFor}).
 * @returns The generation recorded in the receipt, a fresh random id; undefined when the run has no entry.
 * @throws A {@link refusal} when the file changed before the rename or holds a number that would not survive; the pending record is removed.
 * @example
 * const generation = await publishEntry(context, look, receipt)
 */
async function publishEntry(
  context: Context,
  look: ConfigLook,
  receipt: Receipt | undefined,
): Promise<string | undefined> {
  const { entry, entryHash } = context
  if (!entry || !entryHash) return undefined
  assertRewritable(context.path, look)
  const createdFile = createdFileFor(look, receipt)
  const generation = randomUUID()
  const base = look.kind === 'present' ? look.root : {}
  const servers = look.kind === 'present' ? (look.servers ?? {}) : {}
  await writeRecord(context.pendingPath, {
    targetPath: context.path,
    entrySha256: entryHash,
    createdFile,
    generation,
  })
  let config: ConfigNumbers
  try {
    await context.seam?.afterRead?.()
    config = await publishRoot(
      context.path,
      { ...base, mcpServers: { ...servers, [SERVER_NAME]: entry } },
      look,
      context.seam,
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
    generation,
    config,
  } satisfies Receipt)
  await rm(context.pendingPath, { force: true })
  return generation
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
 * @returns `installed` for a new entry, `updated` for a replaced receipted one, `current` when nothing had to change; the config path; and the generation of the entry now recorded, which {@link removeManagedDevinMcpEntry} takes to roll back only this write.
 * @throws A one-sentence refusal naming "Devin Desktop", the path and the way out, for invalid JSON, a non-object top level or `mcpServers`, a number that would not survive a rewrite, an unreceipted or changed `codebook` entry, a file that changed during the run (a save that landed meanwhile stays in place) or a pending record of another entry.
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
}> {
  return inLockedFolder(storageRoot, homeRoot, entry, seam, async (context) => {
    const { path, entryHash } = context
    const { look, current, receipt } = await inspect(context)
    if (current === undefined) {
      const generation = await publishEntry(context, look, receipt)
      return { status: 'installed', path, generation: generation ?? '' }
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
    if (receipt.entrySha256 === entryHash)
      return { status: 'current', path, generation: receipt.generation }
    const generation = await publishEntry(context, look, receipt)
    return { status: 'updated', path, generation: generation ?? '' }
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
    await publishEntry(context, look, receipt)
    return { status: 'refreshed', path }
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
 * - `changed`: the entry differs from the receipt
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
  if (hashOf(current) !== receipt.entrySha256) return { status: 'changed' }
  return { look, receipt }
}

/**
 * Takes Codebook's entry out of a config whose entry it owns: deletes the file when Codebook made it and nothing else is in it, else writes the file back without the entry; called by {@link removeManagedDevinMcpEntry}.
 * @param path - The config.
 * @param owned - The present config and the receipt that owns its entry ({@link removalOwnership}).
 * @param seam - Test hook, see {@link DevinMcpTestSeam}.
 * @returns `file-removed` when the file went, `removed` when only the entry went.
 * @throws The refusals of {@link deleteConfig}, {@link assertRewritable} and {@link publishRoot}.
 * @example
 * await takeEntryOut(path, owned, undefined) // => 'removed'
 */
async function takeEntryOut(
  path: string,
  { look, receipt }: Extract<RemovalOwnership, { receipt: Receipt }>,
  seam: DevinMcpTestSeam | undefined,
): Promise<'file-removed' | 'removed'> {
  const otherServers = Object.fromEntries(
    Object.entries(look.servers ?? {}).filter(([name]) => name !== SERVER_NAME),
  )
  await seam?.afterRead?.()
  // The file goes only when Codebook made it, it is still that file and nothing else is in it.
  if (
    createdFileFor(look, receipt) &&
    Object.keys(otherServers).length === 0 &&
    Object.keys(look.root).length === 1
  ) {
    await deleteConfig(path, look, seam)
    return 'file-removed'
  }
  assertRewritable(path, look)
  await publishRoot(
    path,
    { ...look.root, mcpServers: otherServers },
    look,
    seam,
  )
  return 'removed'
}

/**
 * Drops the receipt of an entry the removal has taken out; called by {@link removeManagedDevinMcpEntry}. The config has already changed, so a receipt that cannot be deleted is reported beside the result instead of thrown.
 * @param receiptPath - Codebook's receipt of the entry.
 * @param status - How the removal changed the config.
 * @param path - The config.
 * @returns The removal's result, with `cleanupFailure` when the receipt stays.
 * @example
 * await dropReceiptAfterRemoval('/private/devin-mcp/receipt.json', 'removed', path) // => { status: 'removed', path }
 */
async function dropReceiptAfterRemoval(
  receiptPath: string,
  status: 'file-removed' | 'removed',
  path: string,
): Promise<DevinMcpRemovalResult> {
  try {
    await rm(receiptPath, { force: true })
  } catch {
    return {
      status,
      path,
      cleanupFailure: `Codebook could not delete its own record of that entry at ${receiptPath}; delete that record by hand.`,
    }
  }
  return { status, path }
}

/** What a removal reports: the config change that was made, apart from a failure to delete Codebook's own record afterwards. */
export type DevinMcpRemovalResult =
  | {
      status: 'removed' | 'file-removed'
      path: string
      /** One sentence (no raw error text) when the entry is gone but Codebook's receipt could not be deleted; the caller still reports the removal. */
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
 * Deletes the file only when Codebook created it (the receipt says so and the file numbers are those Codebook wrote) and nothing else is left in it. An entry that changed since the receipt is left alone and the receipt is dropped, because Codebook no longer owns it.
 * @param storageRoot - Codebook's global storage folder.
 * @param homeRoot - The home folder; the real one unless a test names its own.
 * @param seam - Test hook, see {@link DevinMcpTestSeam}.
 * @param options - See {@link DevinMcpRemovalOptions}.
 * @returns `removed`, `file-removed`, `not-managed` (no receipt, or the entry is already gone), `changed` or `superseded` (a newer setup's receipt; nothing touched); and the config path. A failure to delete the receipt after the config changed is returned as `cleanupFailure`, not thrown.
 * @throws The refusals of {@link writeManagedDevinMcpEntry} for an unreadable config or a file that changed during the removal.
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
      const status = await takeEntryOut(context.path, ownership, seam)
      return dropReceiptAfterRemoval(context.receiptPath, status, context.path)
    },
  )
}
