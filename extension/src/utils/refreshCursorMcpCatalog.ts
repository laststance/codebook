import { createHash, randomUUID } from 'node:crypto'
import { constants as fileFlags, type BigIntStats } from 'node:fs'
import {
  link,
  lstat,
  open,
  rename,
  unlink,
  type FileHandle,
} from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

import {
  CURSOR_MCP_CATALOG_LOCK_RETRIES,
  CURSOR_MCP_CATALOG_LOCK_RETRY_DELAY_MS,
  CURSOR_MCP_CATALOG_RECEIPT_LIMIT_BYTES,
  CURSOR_MCP_CATALOG_REFRESH_STEP_MS,
  PRIVATE_FILE_MODE,
} from '../constants'

import { atomicPrivateWrite } from './atomicPrivateWrite'
import { isRecordedFileId } from './isRecordedFileId'
import { isSameFileId } from './isSameFileId'
import { openWithoutFollowing } from './openWithoutFollowing'
import { recordedFileId, type RecordedFileId } from './recordedFileId'
import { systemErrorCode } from './systemErrorCode'
import { withStorageLock } from './withStorageLock'

const EMPTY_MCP_CONFIG = '{"mcpServers":{}}\n'
const EMPTY_MCP_CONFIG_SHA256 = createHash('sha256')
  .update(EMPTY_MCP_CONFIG)
  .digest('hex')

type CatalogReceipt = {
  schemaVersion: 1
  targetPath: string
  sha256: string
  device: RecordedFileId
  inode: RecordedFileId
  installed: boolean
  retiredPath?: string
  refreshId?: string
}
type PendingCreation = {
  schemaVersion: 1
  owner: CatalogReceipt
  stagedPath: string
}
type PendingRemoval = {
  schemaVersion: 1
  owner: CatalogReceipt
  retiredPath: string
}
export type CursorCatalogCleanup = 'removed' | 'preserved' | 'not-owned'

/** Recognizes an absent path during catalog reads without hiding access failures. @example isMissing(error) */
function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

/** Rejects a redirected Cursor settings parent before setup or cleanup touches its config. @example await regularDirectory('/home/user/.cursor') */
async function regularDirectory(path: string): Promise<void> {
  const status = await lstat(path)
  if (!status.isDirectory() || status.isSymbolicLink())
    throw new Error(
      'Cursor MCP directory is not a regular directory; Codebook left its settings unchanged.',
    )
}

/** What the learner reads for an ownership record that is no regular file of bounded size. */
const RECORD_INVALID_SENTENCE =
  'Cursor MCP catalog ownership record is invalid.'

/** What the learner reads for a record path that {@link openWithoutFollowing} did not open, by the code of its refusal; each sentence names the path, which lies in Codebook's own storage. A pipe, a device or a folder reads as it does where the open lets it through and its status refuses it. */
const RECORD_REFUSAL_SENTENCES: ReadonlyMap<string, (path: string) => string> =
  new Map([
    [
      'ELOOP',
      (path: string) =>
        `Codebook will not read a Cursor MCP catalog ownership record through a link: ${path}. Remove the link, then run Codebook: Set Up AI Chat again.`,
    ],
    ['ENOTREG', () => RECORD_INVALID_SENTENCE],
    [
      'EREPLACED',
      (path: string) =>
        `A Cursor MCP catalog ownership record was replaced while Codebook opened it, so it was not read: ${path}. Run Codebook: Set Up AI Chat again.`,
    ],
  ])

/**
 * Turns a refusal to open an ownership record into the sentence that fits it, for {@link privateJson}.
 * @param error - What {@link openWithoutFollowing} threw.
 * @param path - The record's path.
 * @returns An error with the sentence of a link, of what is no regular file or of a replaced file ({@link RECORD_REFUSAL_SENTENCES}), with the refusal as its cause; every other failure itself.
 * @example throw refusalOfRecordOpen(error, '/private/cursor-mcp-catalog/receipt.json')
 */
function refusalOfRecordOpen(error: unknown, path: string): unknown {
  const sentence = RECORD_REFUSAL_SENTENCES.get(systemErrorCode(error))
  return sentence ? new Error(sentence(path), { cause: error }) : error
}

/** Reads a bounded private journal without following a replaced record path ({@link openWithoutFollowing}: a link is refused on every system, also where the open has no flag for it). @returns The parsed record, or undefined when the path holds nothing. @throws With the sentence that fits a link, a path that is no regular file or a file that was replaced while it was opened ({@link refusalOfRecordOpen}). @example await privateJson('/private/receipt.json') */
async function privateJson(path: string): Promise<unknown | undefined> {
  let handle
  try {
    handle = await openWithoutFollowing(path)
  } catch (error) {
    if (isMissing(error)) return undefined
    throw refusalOfRecordOpen(error, path)
  }
  try {
    const status = await handle.stat()
    if (
      !status.isFile() ||
      status.size > CURSOR_MCP_CATALOG_RECEIPT_LIMIT_BYTES
    )
      throw new Error(RECORD_INVALID_SENTENCE)
    return JSON.parse(await handle.readFile('utf8'))
  } finally {
    await handle.close()
  }
}

/** Validates the exact config identity before {@link removeOwnedCursorMcpCatalog} can retire it. @example parseReceipt(record, '/home/user/.cursor/mcp.json') */
function parseReceipt(value: unknown, targetPath: string): CatalogReceipt {
  const retiredPath =
    typeof value === 'object' && value !== null && 'retiredPath' in value
      ? value.retiredPath
      : undefined
  const refreshId =
    typeof value === 'object' && value !== null && 'refreshId' in value
      ? value.refreshId
      : undefined
  if (
    typeof value !== 'object' ||
    value === null ||
    !('schemaVersion' in value) ||
    value.schemaVersion !== 1 ||
    !('targetPath' in value) ||
    value.targetPath !== targetPath ||
    !('sha256' in value) ||
    value.sha256 !== EMPTY_MCP_CONFIG_SHA256 ||
    !('device' in value) ||
    !isRecordedFileId(value.device) ||
    !('inode' in value) ||
    !isRecordedFileId(value.inode) ||
    !('installed' in value) ||
    typeof value.installed !== 'boolean' ||
    (retiredPath !== undefined && typeof retiredPath !== 'string') ||
    (refreshId !== undefined &&
      (typeof refreshId !== 'string' || !/^[a-f0-9-]{36}$/.test(refreshId)))
  )
    throw new Error(
      'Cursor MCP catalog ownership record is invalid; Codebook preserved the config.',
    )
  return {
    schemaVersion: 1,
    targetPath,
    sha256: value.sha256,
    device: value.device,
    inode: value.inode,
    installed: value.installed,
    ...(retiredPath !== undefined ? { retiredPath } : {}),
    ...(refreshId !== undefined ? { refreshId } : {}),
  }
}

/** The error codes of a path that holds no file a receipt can own: nothing (`ENOENT`), a link (`ELOOP`), and, where the system has no flag for a link and {@link openWithoutFollowing} looks at the path first, a pipe, a device or a folder (`ENOTREG`) or another file that took the path between the look and the open (`EREPLACED`). */
const NOT_AN_OWNED_FILE_CODES: ReadonlySet<string> = new Set([
  'ENOENT',
  'ELOOP',
  'ENOTREG',
  'EREPLACED',
])

/**
 * Says whether an open file still holds the bytes a receipt recorded and was not replaced while they were read; called by {@link isOwnedOpenFile} once the file is known to be the receipt's.
 * @param handle - The open regular file.
 * @param before - Its status before the read, with exact numbers.
 * @param owner - The receipt, for its recorded digest.
 * @returns `true` when device and inode number are the same before and after the read and the bytes have the recorded SHA-256; otherwise `false`.
 * @example await holdsOwnedBytes(handle, await handle.stat({ bigint: true }), receipt) // => true for Codebook's unchanged empty config
 */
async function holdsOwnedBytes(
  handle: FileHandle,
  before: BigIntStats,
  owner: CatalogReceipt,
): Promise<boolean> {
  const bytes = await handle.readFile()
  const after = await handle.stat({ bigint: true })
  return (
    after.dev === before.dev &&
    after.ino === before.ino &&
    createHash('sha256').update(bytes).digest('hex') === owner.sha256
  )
}

/**
 * Says whether an open file is the regular file a receipt names, with its bytes; called by {@link ownedFile} for the file it opened without following a link.
 * The inode number is read and compared exactly ({@link isSameFileId}): a file id on NTFS can be more than a number holds, and a number would round two such ids to one value. The device number is not compared: a volume can get another one after a restart.
 * @param handle - The open file.
 * @param owner - The receipt, for its recorded inode number and digest.
 * @returns `true` for a regular file with the recorded inode number and bytes; `false` for a pipe, a device or a folder, for another file, and for other bytes.
 * @example await isOwnedOpenFile(handle, receipt) // => false for a copy with the same bytes
 */
async function isOwnedOpenFile(
  handle: FileHandle,
  owner: CatalogReceipt,
): Promise<boolean> {
  const before = await handle.stat({ bigint: true })
  if (!before.isFile() || !isSameFileId(owner.inode, before.ino)) return false
  return holdsOwnedBytes(handle, before, owner)
}

/** Matches the inode number and the bytes through one no-follow handle ({@link openWithoutFollowing}, {@link isOwnedOpenFile}) before recovery or removal, tolerating volume device renumbering. @returns `true` for the file the receipt names; `false` for a path that holds nothing, a link or no regular file, and for another or a changed file, also one that took the path while it was opened. @example await ownedFile('/home/user/.cursor/mcp.json', receipt) */
async function ownedFile(
  path: string,
  owner: CatalogReceipt,
): Promise<boolean> {
  let handle
  try {
    handle = await openWithoutFollowing(path)
  } catch (error) {
    if (NOT_AN_OWNED_FILE_CODES.has(systemErrorCode(error))) return false
    throw error
  }
  try {
    return await isOwnedOpenFile(handle, owner)
  } finally {
    await handle.close()
  }
}

/** The error codes with which a system refuses a change to a file this user may not write: Windows sets a file's times only through a handle that was opened with write access and answers `EPERM` for another, and an open for writing of a read-only file is refused with `EPERM` there and with `EACCES` elsewhere. */
const WRITE_REFUSED_CODES: ReadonlySet<string> = new Set(['EPERM', 'EACCES'])

/** The error codes of a config path that no longer holds the regular file the refresh opened: nothing, a link, a pipe, a device or a folder, or another file that took the path ({@link openWithoutFollowing}). */
const CONFIG_GONE_CODES: ReadonlySet<string> = new Set([
  'ENOENT',
  'ELOOP',
  'ENOTREG',
  'EISDIR',
  'EREPLACED',
])

/** What the learner reads when the config's time cannot be set because this user may not write the file. */
const CONFIG_NOT_WRITABLE_SENTENCE =
  'Cursor MCP config cannot be refreshed because this user may not change it (the file may be read-only or belong to another user); Codebook left it unchanged. Allow writing to this file, then run Codebook: Set Up AI Chat again.'

/** What the learner reads when the config path came to hold another entry while the refresh opened the config, or between its read and the setting of its time. */
const CONFIG_CHANGED_SENTENCE =
  'Cursor MCP config changed while Codebook refreshed it; Codebook left it unchanged. Run Codebook: Set Up AI Chat again.'

/** What the learner reads for a config path that holds a pipe, a device or a folder. */
const CONFIG_NOT_REGULAR_SENTENCE =
  'Cursor MCP config is not a regular file; Codebook left its settings unchanged.'

/** What the learner reads for a config path that holds a link, or that cannot be opened for another reason than a missing file. */
const CONFIG_REDIRECTED_SENTENCE =
  'Cursor MCP config cannot be refreshed without following a redirected or inaccessible file.'

/** The sentence for a config that {@link openWithoutFollowing} refused where it looks at the path first, by the code of its refusal; every other failure of the open reads {@link CONFIG_REDIRECTED_SENTENCE}. */
const CONFIG_OPEN_SENTENCES: ReadonlyMap<string, string> = new Map([
  ['ENOTREG', CONFIG_NOT_REGULAR_SENTENCE],
  ['EREPLACED', CONFIG_CHANGED_SENTENCE],
])

/**
 * Opens the Cursor MCP config for a refresh without following a link, and turns a refusal into the sentence that fits it; called by {@link refreshCursorMcpCatalog} for each of its three opens of the config.
 * @param targetPath - The config's path.
 * @returns The open file; with `O_NOFOLLOW` it can still be a pipe, a device or a folder, which the refresh refuses by its status with {@link CONFIG_NOT_REGULAR_SENTENCE}.
 * @throws The file system's error for a path that holds nothing (`ENOENT`: the refresh creates the config then); otherwise an error with the sentence of a pipe, a device or a folder, of a config another file replaced while it was opened, or of a link or an inaccessible file, with the failure as its cause.
 * @example const handle = await openConfigForRefresh('/home/user/.cursor/mcp.json')
 */
async function openConfigForRefresh(targetPath: string): Promise<FileHandle> {
  try {
    return await openWithoutFollowing(targetPath)
  } catch (error) {
    if (isMissing(error)) throw error
    throw new Error(
      CONFIG_OPEN_SENTENCES.get(systemErrorCode(error)) ??
        CONFIG_REDIRECTED_SENTENCE,
      { cause: error },
    )
  }
}

/**
 * Opens the config right after Codebook published it, or after another writer's file took its path, for {@link refreshCursorMcpCatalog}; a config that is gone by then changed while it was refreshed.
 * @param targetPath - The config's path.
 * @returns The open file ({@link openConfigForRefresh}).
 * @throws With {@link CONFIG_CHANGED_SENTENCE} when the path holds nothing any more, and with the sentence {@link openConfigForRefresh} gives for a link, a path that is no regular file or a replaced file.
 * @example const handle = await openPublishedConfig('/home/user/.cursor/mcp.json')
 */
async function openPublishedConfig(targetPath: string): Promise<FileHandle> {
  return openConfigForRefresh(targetPath).catch((error: unknown) => {
    throw isMissing(error)
      ? new Error(CONFIG_CHANGED_SENTENCE, { cause: error })
      : error
  })
}

/**
 * Turns a failure to link Codebook's new config into place into a sentence, for {@link refreshCursorMcpCatalog} when the link fails for another reason than a file that is already there: no config changed then, the file system refused the new name (a folder that allows no new files, a file system without hard links, a staged file that is gone).
 * @param error - What `link` threw.
 * @param targetPath - The config's path.
 * @returns An error that names the path and the file system's code, with the failure as its cause; a failure without a code itself.
 * @example throw refusalOfConfigLink(Object.assign(new Error('EPERM'), { code: 'EPERM' }), '/home/user/.cursor/mcp.json')
 */
function refusalOfConfigLink(error: unknown, targetPath: string): unknown {
  const code = systemErrorCode(error)
  return code
    ? new Error(
        `Cursor MCP config could not be created: the file system refused to put Codebook's new file in place as ${targetPath} (${code}). No existing file was changed. Check that this folder allows new files and hard links, then run Codebook: Set Up AI Chat again.`,
        { cause: error },
      )
    : error
}

/**
 * Turns a failure to open or change the config for its times into the sentence that fits it, for {@link openConfigForItsTimes} and {@link setTimesThroughWritableFile}.
 * @param error - What the open or the change threw.
 * @returns An error with {@link CONFIG_NOT_WRITABLE_SENTENCE} for a file this user may not write, one with {@link CONFIG_CHANGED_SENTENCE} for a path that no longer holds the file, each with the failure as its cause; every other failure itself.
 * @example throw refusalOfConfigTimes(Object.assign(new Error('EPERM'), { code: 'EPERM' }))
 */
function refusalOfConfigTimes(error: unknown): unknown {
  const code = systemErrorCode(error)
  if (WRITE_REFUSED_CODES.has(code))
    return new Error(CONFIG_NOT_WRITABLE_SENTENCE, { cause: error })
  return CONFIG_GONE_CODES.has(code)
    ? new Error(CONFIG_CHANGED_SENTENCE, { cause: error })
    : error
}

/**
 * Opens the config a second time, with write access and without following a link, for {@link setTimesThroughWritableFile}. The open neither creates nor truncates a file.
 * @param targetPath - The config's path.
 * @returns The open file.
 * @throws With the sentence that fits ({@link refusalOfConfigTimes}) when this user may not write the file or the path no longer holds it.
 * @example const writable = await openConfigForItsTimes('/home/user/.cursor/mcp.json')
 */
async function openConfigForItsTimes(targetPath: string): Promise<FileHandle> {
  try {
    return await openWithoutFollowing(targetPath, undefined, 'read-write')
  } catch (error) {
    throw refusalOfConfigTimes(error)
  }
}

/**
 * Sets the config's times through a second file opened with write access, and only when that file is the one the refresh opened and read; called by {@link setTimesOfOpenConfig} where the system refuses the times through the file opened for reading (Windows).
 * @param opened - The status, with exact numbers, of the file the refresh opened for reading.
 * @param targetPath - The config's path.
 * @param accessedAt - The access time to keep.
 * @param modifiedAt - The new modification time.
 * @throws With {@link CONFIG_CHANGED_SENTENCE} when the second file is not the first by device and inode number, and with the sentence that fits when the file cannot be opened or changed ({@link refusalOfConfigTimes}). Nothing is created, truncated or written.
 * @example await setTimesThroughWritableFile(await handle.stat({ bigint: true }), targetPath, status.atime, new Date())
 */
async function setTimesThroughWritableFile(
  opened: BigIntStats,
  targetPath: string,
  accessedAt: Date,
  modifiedAt: Date,
): Promise<void> {
  const writable = await openConfigForItsTimes(targetPath)
  try {
    const reopened = await writable.stat({ bigint: true })
    // The time is set only on the file that was looked at and read.
    if (reopened.dev !== opened.dev || reopened.ino !== opened.ino)
      throw new Error(CONFIG_CHANGED_SENTENCE)
    await writable.utimes(accessedAt, modifiedAt).catch((error: unknown) => {
      throw refusalOfConfigTimes(error)
    })
  } finally {
    await writable.close()
  }
}

/**
 * Sets the times of the config the refresh has open, so that Cursor's file watcher fires; called by {@link refreshCursorMcpCatalog} after it read the config's status.
 * The times are set through the file that is open for reading where the system allows that (Linux and macOS, also for a read-only file of this user). Where it refuses (Windows sets times only through a file opened with write access), they are set through a second file opened with write access that must be the same file ({@link setTimesThroughWritableFile}). Which way is taken depends on the refusal alone, never on the system's name.
 * @param handle - The config, open for reading.
 * @param targetPath - The config's path.
 * @param accessedAt - The access time to keep.
 * @param modifiedAt - The new modification time.
 * @throws With a sentence when this user may not change the file or the path came to hold another entry ({@link refusalOfConfigTimes}); the config's bytes are never changed.
 * @example await setTimesOfOpenConfig(handle, '/home/user/.cursor/mcp.json', status.atime, new Date())
 */
async function setTimesOfOpenConfig(
  handle: FileHandle,
  targetPath: string,
  accessedAt: Date,
  modifiedAt: Date,
): Promise<void> {
  try {
    await handle.utimes(accessedAt, modifiedAt)
  } catch (error) {
    if (!WRITE_REFUSED_CODES.has(systemErrorCode(error))) throw error
    await setTimesThroughWritableFile(
      await handle.stat({ bigint: true }),
      targetPath,
      accessedAt,
      modifiedAt,
    )
  }
}

/** Advances a verified empty config's private generation so a later cleanup cannot retire a newer window's refresh. @example await advanceOwnedRefreshId(receiptPath, targetPath) */
async function advanceOwnedRefreshId(
  receiptPath: string,
  targetPath: string,
): Promise<string | undefined> {
  const rawOwner = await privateJson(receiptPath)
  if (rawOwner === undefined) return undefined
  const owner = parseReceipt(rawOwner, targetPath)
  if (!owner.installed || !(await ownedFile(targetPath, owner)))
    return undefined
  const refreshId = randomUUID()
  await atomicPrivateWrite(
    receiptPath,
    { ...owner, refreshId },
    CURSOR_MCP_CATALOG_RECEIPT_LIMIT_BYTES,
  )
  return refreshId
}

/** Completes ownership after an atomic config publication, or discards only its verified unpublished staging file. @example await recoverCreation(pending, receipt, target, cursorDirectory) */
async function recoverCreation(
  pendingPath: string,
  receiptPath: string,
  targetPath: string,
  cursorDirectory: string,
): Promise<void> {
  const record = await privateJson(pendingPath)
  if (record === undefined) return
  if (
    typeof record !== 'object' ||
    record === null ||
    !('schemaVersion' in record) ||
    record.schemaVersion !== 1 ||
    !('owner' in record) ||
    !('stagedPath' in record) ||
    typeof record.stagedPath !== 'string' ||
    dirname(record.stagedPath) !== cursorDirectory ||
    !/^\.codebook-[a-f0-9-]+\.mcp\.json$/.test(basename(record.stagedPath))
  )
    throw new Error(
      'Cursor MCP catalog creation record is invalid; Codebook preserved the config.',
    )
  const owner = parseReceipt(record.owner, targetPath)
  if (!owner.installed || owner.retiredPath !== undefined)
    throw new Error(
      'Cursor MCP catalog creation record is invalid; Codebook preserved the config.',
    )
  const published = await ownedFile(targetPath, owner),
    staged = await ownedFile(record.stagedPath, owner)
  if (published)
    await atomicPrivateWrite(
      receiptPath,
      owner,
      CURSOR_MCP_CATALOG_RECEIPT_LIMIT_BYTES,
    )
  if (staged) await unlink(record.stagedPath)
  // A changed target remains user-owned; only the exact staged inode is discarded.
  await unlink(pendingPath)
}

/** Completes a journaled retirement before {@link refreshCursorMcpCatalog} can create another config. @example await recoverRemoval(pending, receipt, target, storage) */
async function recoverRemoval(
  pendingPath: string,
  receiptPath: string,
  targetPath: string,
  storageDirectory: string,
): Promise<CursorCatalogCleanup | undefined> {
  const record = await privateJson(pendingPath)
  if (record === undefined) return undefined
  if (
    typeof record !== 'object' ||
    record === null ||
    !('schemaVersion' in record) ||
    record.schemaVersion !== 1 ||
    !('owner' in record) ||
    !('retiredPath' in record) ||
    typeof record.retiredPath !== 'string' ||
    dirname(record.retiredPath) !== storageDirectory ||
    !/^retired-[a-f0-9-]+\.mcp\.json$/.test(basename(record.retiredPath))
  )
    throw new Error(
      'Cursor MCP catalog removal record is invalid; Codebook preserved the config.',
    )
  const owner = parseReceipt(record.owner, targetPath)
  if (await ownedFile(record.retiredPath, owner)) {
    await atomicPrivateWrite(
      receiptPath,
      { ...owner, installed: false, retiredPath: record.retiredPath },
      CURSOR_MCP_CATALOG_RECEIPT_LIMIT_BYTES,
    )
    await unlink(pendingPath)
    return 'removed'
  }
  if (!(await ownedFile(targetPath, owner)))
    throw new Error(
      'Cursor MCP catalog changed during interrupted cleanup; Codebook preserved the config and recovery record.',
    )
  await unlink(pendingPath)
  return undefined
}

/** Waits briefly for another active Cursor window's catalog writer, also one that is taking a stale lock over; the retries displace no lock themselves. {@link withStorageLock} takes over a lock whose writer process is gone from this machine, and any other lock that stays through the retries is reported. @example await withCatalogLockRetry(() => withStorageLock('/private', update)) */
async function withCatalogLockRetry<Result>(
  operation: () => Promise<Result>,
): Promise<Result> {
  for (let retry = 0; ; retry += 1) {
    try {
      return await operation()
    } catch (error) {
      const cause = error instanceof Error ? error.cause : undefined
      if (
        !(
          cause instanceof Error &&
          'code' in cause &&
          cause.code === 'EEXIST'
        ) ||
        retry >= CURSOR_MCP_CATALOG_LOCK_RETRIES
      )
        throw error
      await delay(CURSOR_MCP_CATALOG_LOCK_RETRY_DELAY_MS)
    }
  }
}

/** Wakes Cursor's MCP catalog and returns the generation of an unchanged Codebook-owned empty file. @example await refreshCursorMcpCatalog('/private', '/home/user/.cursor') */
export async function refreshCursorMcpCatalog(
  storageRoot: string,
  cursorDirectory = join(homedir(), '.cursor'),
): Promise<string | undefined> {
  const storageDirectory = join(storageRoot, 'cursor-mcp-catalog')
  return withCatalogLockRetry(() =>
    withStorageLock(storageDirectory, async () => {
      await regularDirectory(cursorDirectory)
      const targetPath = join(cursorDirectory, 'mcp.json'),
        receiptPath = join(storageDirectory, 'receipt.json')
      const pendingCreationPath = join(
        storageDirectory,
        'pending-creation.json',
      )
      await recoverCreation(
        pendingCreationPath,
        receiptPath,
        targetPath,
        cursorDirectory,
      )
      await recoverRemoval(
        join(storageDirectory, 'pending-removal.json'),
        receiptPath,
        targetPath,
        storageDirectory,
      )
      const previous = await privateJson(receiptPath)
      if (previous !== undefined) parseReceipt(previous, targetPath)
      let handle
      try {
        handle = await openConfigForRefresh(targetPath)
      } catch (error) {
        // Only a path that holds nothing is filled; every refusal already carries its sentence.
        if (!isMissing(error)) throw error
        const stagedPath = join(
          cursorDirectory,
          `.codebook-${randomUUID()}.mcp.json`,
        )
        const stagedHandle = await open(
          stagedPath,
          fileFlags.O_CREAT |
            fileFlags.O_EXCL |
            fileFlags.O_NOFOLLOW |
            fileFlags.O_RDWR,
          PRIVATE_FILE_MODE,
        )
        let staged
        try {
          await stagedHandle.writeFile(EMPTY_MCP_CONFIG)
          await stagedHandle.sync()
          staged = await stagedHandle.stat({ bigint: true })
        } finally {
          await stagedHandle.close()
        }
        const owner: CatalogReceipt = {
          schemaVersion: 1,
          targetPath,
          sha256: EMPTY_MCP_CONFIG_SHA256,
          device: recordedFileId(staged.dev),
          inode: recordedFileId(staged.ino),
          installed: true,
        }
        const pending: PendingCreation = { schemaVersion: 1, owner, stagedPath }
        await atomicPrivateWrite(
          pendingCreationPath,
          pending,
          CURSOR_MCP_CATALOG_RECEIPT_LIMIT_BYTES,
        )
        try {
          await link(stagedPath, targetPath)
        } catch (createError) {
          // Only a file that is already there is another writer's publication; every other refusal gets its sentence.
          if (systemErrorCode(createError) !== 'EEXIST')
            throw refusalOfConfigLink(createError, targetPath)
          await recoverCreation(
            pendingCreationPath,
            receiptPath,
            targetPath,
            cursorDirectory,
          )
          handle = await openPublishedConfig(targetPath)
        }
        if (!handle) {
          if (!(await ownedFile(targetPath, owner)))
            throw new Error(
              'Cursor MCP config changed during publication; Codebook preserved it and its recovery record.',
            )
          await atomicPrivateWrite(
            receiptPath,
            owner,
            CURSOR_MCP_CATALOG_RECEIPT_LIMIT_BYTES,
          )
          await unlink(stagedPath)
          await unlink(pendingCreationPath)
          handle = await openPublishedConfig(targetPath)
        }
      }
      try {
        const status = await handle.stat()
        if (!status.isFile()) throw new Error(CONFIG_NOT_REGULAR_SENTENCE)
        if (status.size === 0)
          throw new Error(
            'Cursor MCP config is empty; Codebook preserved it. Inspect this file before retrying setup.',
          )
        // Cursor 3.21.16 may connect an extension server without publishing it to Agent until this file watcher fires.
        await setTimesOfOpenConfig(
          handle,
          targetPath,
          status.atime,
          new Date(
            Math.max(
              Date.now(),
              status.mtimeMs + CURSOR_MCP_CATALOG_REFRESH_STEP_MS,
            ),
          ),
        )
        return advanceOwnedRefreshId(receiptPath, targetPath)
      } finally {
        await handle.close()
      }
    }),
  )
}

/** Reserves the current owned catalog generation before explicit skill removal without creating or touching a user config. @example await captureOwnedCursorMcpCatalogGeneration('/private') */
export async function captureOwnedCursorMcpCatalogGeneration(
  storageRoot: string,
  cursorDirectory = join(homedir(), '.cursor'),
): Promise<string | undefined> {
  const storageDirectory = join(storageRoot, 'cursor-mcp-catalog')
  return withCatalogLockRetry(() =>
    withStorageLock(storageDirectory, async () => {
      await regularDirectory(cursorDirectory)
      const targetPath = join(cursorDirectory, 'mcp.json'),
        receiptPath = join(storageDirectory, 'receipt.json')
      await recoverCreation(
        join(storageDirectory, 'pending-creation.json'),
        receiptPath,
        targetPath,
        cursorDirectory,
      )
      await recoverRemoval(
        join(storageDirectory, 'pending-removal.json'),
        receiptPath,
        targetPath,
        storageDirectory,
      )
      return advanceOwnedRefreshId(receiptPath, targetPath)
    }),
  )
}

/** Retires only Codebook's unchanged empty Cursor catalog, optionally limited to one refresh generation. @example await removeOwnedCursorMcpCatalog('/private', '/home/user/.cursor') */
export async function removeOwnedCursorMcpCatalog(
  storageRoot: string,
  cursorDirectory = join(homedir(), '.cursor'),
  expectedRefreshId?: string,
): Promise<CursorCatalogCleanup> {
  const storageDirectory = join(storageRoot, 'cursor-mcp-catalog')
  return withCatalogLockRetry(() =>
    withStorageLock(storageDirectory, async () => {
      await regularDirectory(cursorDirectory)
      const targetPath = join(cursorDirectory, 'mcp.json'),
        receiptPath = join(storageDirectory, 'receipt.json')
      const pendingPath = join(storageDirectory, 'pending-removal.json')
      await recoverCreation(
        join(storageDirectory, 'pending-creation.json'),
        receiptPath,
        targetPath,
        cursorDirectory,
      )
      const recovered = await recoverRemoval(
        pendingPath,
        receiptPath,
        targetPath,
        storageDirectory,
      )
      if (recovered) return recovered
      const rawReceipt = await privateJson(receiptPath)
      if (rawReceipt === undefined) return 'not-owned'
      const owner = parseReceipt(rawReceipt, targetPath)
      if (
        expectedRefreshId !== undefined &&
        owner.refreshId !== expectedRefreshId
      )
        return 'preserved'
      if (!owner.installed || !(await ownedFile(targetPath, owner)))
        return 'preserved'
      // Retain the actual file privately; a concurrent edit or replacement must never be unlinked after a stale check.
      if (
        (await lstat(cursorDirectory, { bigint: true })).dev !==
        (await lstat(storageDirectory, { bigint: true })).dev
      )
        return 'preserved'
      const retiredPath = join(
        storageDirectory,
        `retired-${randomUUID()}.mcp.json`,
      )
      const pending: PendingRemoval = { schemaVersion: 1, owner, retiredPath }
      await atomicPrivateWrite(
        pendingPath,
        pending,
        CURSOR_MCP_CATALOG_RECEIPT_LIMIT_BYTES,
      )
      await rename(targetPath, retiredPath)
      if (!(await ownedFile(retiredPath, owner))) {
        await link(retiredPath, targetPath).catch(() => undefined)
        throw new Error(
          'Cursor MCP catalog changed during cleanup; Codebook retained the actual file and recovery record.',
        )
      }
      await atomicPrivateWrite(
        receiptPath,
        { ...owner, installed: false, retiredPath },
        CURSOR_MCP_CATALOG_RECEIPT_LIMIT_BYTES,
      )
      await unlink(pendingPath)
      return 'removed'
    }),
  )
}
