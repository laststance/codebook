import { createHash, randomInt, randomUUID } from 'node:crypto'
import { constants as fileFlags, type BigIntStats } from 'node:fs'
import {
  link,
  lstat,
  open,
  readdir,
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
  CURSOR_MCP_CATALOG_LOCK_RETRY_JITTER_MS,
  CURSOR_MCP_CATALOG_RECEIPT_LIMIT_BYTES,
  CURSOR_MCP_CATALOG_REFRESH_STEP_MS,
  CURSOR_MCP_STAGED_CONFIG_GRACE_MS,
  PRIVATE_FILE_MODE,
} from '../constants'

import { atomicPrivateWrite } from './atomicPrivateWrite'
import { describeRefusedLinkBack } from './describeRefusedLinkBack'
import { describeUnopenedFile } from './describeUnopenedFile'
import { describeUnopenedMovedFile } from './describeUnopenedMovedFile'
import {
  dropSecondNameOfMovedFile,
  type MovedFileUndoing,
} from './dropSecondNameOfMovedFile'
import {
  dropSecondNameOfOneFile,
  type SecondNameDrop,
} from './dropSecondNameOfOneFile'
import { isRecordedFileId } from './isRecordedFileId'
import { isSameFileId } from './isSameFileId'
import { openWithoutFollowing } from './openWithoutFollowing'
import { passIfMissing } from './passIfMissing'
import { recordedFileId, type RecordedFileId } from './recordedFileId'
import { SET_UP_AI_CHAT_COMMAND, startOverBy } from './startOverBy'
import {
  PUT_FOLDER_IN_PLACE_OR_REMOVE_LINK,
  stepPastNoRealFolder,
} from './stepPastNoRealFolder'
import { StorageLockHeldError } from './storageLockHeldError'
import { systemErrorCode } from './systemErrorCode'
import { unopenedFileCode } from './unopenedFileCode'
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
/**
 * What became of the Cursor MCP config at a removal ({@link removeOwnedCursorMcpCatalog}).
 * - `removed`: the empty config Codebook created was retired
 * - `preserved`: a config stands at the path that is not that unchanged file (it was changed or replaced, a newer setup of another window refreshed it, or it cannot be retired into Codebook's storage); it stays
 * - `already-retired`: an earlier removal retired the config Codebook created; nothing was left to do
 * - `not-owned`: Codebook owns no config: it never created one here (a config that existed before stays as it is), or the one it created is gone from its path
 */
export type CursorCatalogCleanup =
  'removed' | 'preserved' | 'already-retired' | 'not-owned'

/** Why a removal retires no config, as {@link captureOwnedCursorMcpCatalogGeneration} and {@link removeOwnedCursorMcpCatalog} answer it. */
type UnretiredCatalogCleanup = Exclude<CursorCatalogCleanup, 'removed'>

/**
 * What a removal learns of the Cursor MCP config before it takes the skill away ({@link captureOwnedCursorMcpCatalogGeneration}).
 * - `ownedGeneration`: the config is the unchanged file Codebook created; the generation is handed to {@link removeOwnedCursorMcpCatalog}, which retires the config only while no newer setup refreshed it
 * - `unowned`: nothing is there to retire, and why; the removal's notice says so
 */
export type CursorCatalogCapture =
  { ownedGeneration: string } | { unowned: UnretiredCatalogCleanup }

/** Recognizes an absent path during catalog reads without hiding access failures. @example isMissing(error) */
function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

/**
 * Rejects a Cursor settings folder that is no real folder before a setup or a cleanup touches the config in it; called by {@link refreshCursorMcpCatalog}, {@link captureOwnedCursorMcpCatalogGeneration} and {@link removeOwnedCursorMcpCatalog} under the storage lock.
 * @param path - Cursor's settings folder, `~/.cursor`.
 * @param commandToRunAgain - The command the learner ran, which the refusal names as the one to run again.
 * @throws For a link, for anything that is no folder and for a path that holds nothing: the sentence names the path, what stands there and the step after which the command finishes ({@link stepPastNoRealFolder}). Every other failure of the look: itself.
 * @example await regularDirectory('/home/user/.cursor', 'Codebook: Set Up AI Chat')
 */
async function regularDirectory(
  path: string,
  commandToRunAgain: string,
): Promise<void> {
  // A path that holds nothing is an answer, which the refusal words, and not the file system's own text.
  const step = stepPastNoRealFolder(
    await lstat(path).catch(passIfMissing),
    PUT_FOLDER_IN_PLACE_OR_REMOVE_LINK,
    commandToRunAgain,
  )
  if (step)
    throw new Error(
      `Cursor MCP directory is not a regular directory: ${path}. Codebook left its settings unchanged. ${step}`,
    )
}

/**
 * Builds the refusal for a record of the Cursor MCP catalog that cannot be trusted (edited by hand, damaged, no regular file, or written in a form this version does not read); every check of a receipt, a creation record or a removal record refuses through it, so each names the record and the same way out.
 * Codebook deletes nothing on such a record: it proves no ownership. Deleting the record is enough for a setup to finish: without it Codebook treats the config as the learner's and only refreshes it.
 * @param subject - What is invalid, as the sentence begins: "Cursor MCP catalog ownership record", for example.
 * @param recordPath - The file that holds the invalid record.
 * @param commandToRunAgain - The command the learner ran, which the sentence names as the one to run again ({@link startOverBy}).
 * @returns The error, not thrown yet.
 * @example throw invalidCatalogRecord('Cursor MCP catalog ownership record', '/private/cursor-mcp-catalog/receipt.json', 'Codebook: Set Up AI Chat')
 */
function invalidCatalogRecord(
  subject: string,
  recordPath: string,
  commandToRunAgain: string,
): Error {
  return new Error(
    `${subject} is invalid; Codebook preserved the config.${startOverBy(recordPath, commandToRunAgain)}`,
  )
}

/** What the learner reads for a record path that {@link openWithoutFollowing} did not open, by the code of its refusal; each sentence names the path, which lies in Codebook's own storage, and the command the learner ran as the one to run again. A pipe, a device or a folder reads as it does where the open lets it through and its status refuses it. */
const RECORD_REFUSAL_SENTENCES: ReadonlyMap<
  string,
  (path: string, commandToRunAgain: string) => string
> = new Map([
  [
    'ELOOP',
    (path: string, commandToRunAgain: string) =>
      `Codebook will not read a Cursor MCP catalog ownership record through a link: ${path}. Remove the link, then run ${commandToRunAgain} again.`,
  ],
  [
    'ENOTREG',
    (path: string, commandToRunAgain: string) =>
      invalidCatalogRecord(
        'Cursor MCP catalog ownership record',
        path,
        commandToRunAgain,
      ).message,
  ],
  [
    'EREPLACED',
    (path: string, commandToRunAgain: string) =>
      `A Cursor MCP catalog ownership record was replaced while Codebook opened it, so it was not read: ${path}. Run ${commandToRunAgain} again.`,
  ],
])

/**
 * Turns a failed open of a file of the catalog (a record, the config, or the config under a staged or retired name) into the refusal of a file this user could not open at that moment, for every place of the catalog that opens such a file: {@link refusalOfRecordOpen}, {@link ownedFile}, {@link refusalOfConfigOpen} and {@link openConfigForItsTimes}. Nothing is known of such a file: it is neither an invalid record nor a config that is not Codebook's.
 * @param error - What the open threw.
 * @param subject - What the file is, as the sentence begins.
 * @param path - The file's path.
 * @param commandToRunAgain - The command the learner ran, which the sentence names as the one to run again.
 * @returns An error with the sentence ({@link describeUnopenedFile}) and the failure as its cause, for the three codes of {@link unopenedFileCode}; every other failure itself, which is the system's own text.
 * @example throw refusalOfUnopenedFile(error, 'The Cursor MCP config', '/home/user/.cursor/mcp.json', 'Codebook: Set Up AI Chat')
 */
function refusalOfUnopenedFile(
  error: unknown,
  subject: string,
  path: string,
  commandToRunAgain: string,
): unknown {
  const code = unopenedFileCode(error)
  return code
    ? new Error(describeUnopenedFile(subject, path, code, commandToRunAgain), {
        cause: error,
      })
    : error
}

/**
 * Turns a refusal to open an ownership record into the sentence that fits it, for {@link privateJson}.
 * @param error - What {@link openWithoutFollowing} threw.
 * @param path - The record's path.
 * @param commandToRunAgain - The command the learner ran, which the sentence names as the one to run again.
 * @returns An error with the sentence of a link, of what is no regular file or of a replaced file ({@link RECORD_REFUSAL_SENTENCES}), or of a record this user could not open at that moment ({@link refusalOfUnopenedFile}), with the refusal as its cause; every other failure itself.
 * @example throw refusalOfRecordOpen(error, '/private/cursor-mcp-catalog/receipt.json', 'Codebook: Set Up AI Chat')
 */
function refusalOfRecordOpen(
  error: unknown,
  path: string,
  commandToRunAgain: string,
): unknown {
  const sentence = RECORD_REFUSAL_SENTENCES.get(systemErrorCode(error))
  return sentence
    ? new Error(sentence(path, commandToRunAgain), { cause: error })
    : refusalOfUnopenedFile(
        error,
        'A record of the Cursor MCP catalog',
        path,
        commandToRunAgain,
      )
}

/**
 * Parses the text of a catalog record, for {@link privateJson}; text that is no JSON is an invalid record like one with a wrong field.
 * @param text - The record file's text.
 * @param recordPath - The record file.
 * @param commandToRunAgain - The command the learner ran, which the refusal names as the one to run again.
 * @returns The parsed value, not validated yet.
 * @throws With the sentence of an invalid record ({@link invalidCatalogRecord}) when the text is no JSON.
 * @example parseRecordText('{"schemaVersion":1}', '/private/cursor-mcp-catalog/receipt.json', 'Codebook: Set Up AI Chat') // => { schemaVersion: 1 }
 */
function parseRecordText(
  text: string,
  recordPath: string,
  commandToRunAgain: string,
): unknown {
  try {
    return JSON.parse(text)
  } catch {
    throw invalidCatalogRecord(
      'Cursor MCP catalog ownership record',
      recordPath,
      commandToRunAgain,
    )
  }
}

/** Reads a bounded private journal without following a replaced record path ({@link openWithoutFollowing}: a link is refused on every system, also where the open has no flag for it). @returns The parsed record, or undefined when the path holds nothing. @param commandToRunAgain - The command the learner ran, which a refusal names as the one to run again. @throws With the sentence that fits a link, a path that is no regular file or a file that was replaced while it was opened ({@link refusalOfRecordOpen}). @example await privateJson('/private/receipt.json', 'Codebook: Set Up AI Chat') */
async function privateJson(
  path: string,
  commandToRunAgain: string,
): Promise<unknown | undefined> {
  let handle
  try {
    handle = await openWithoutFollowing(path)
  } catch (error) {
    if (isMissing(error)) return undefined
    throw refusalOfRecordOpen(error, path, commandToRunAgain)
  }
  try {
    const status = await handle.stat()
    if (
      !status.isFile() ||
      status.size > CURSOR_MCP_CATALOG_RECEIPT_LIMIT_BYTES
    )
      throw invalidCatalogRecord(
        'Cursor MCP catalog ownership record',
        path,
        commandToRunAgain,
      )
    return parseRecordText(
      await handle.readFile('utf8'),
      path,
      commandToRunAgain,
    )
  } finally {
    await handle.close()
  }
}

/** Validates the exact config identity before {@link removeOwnedCursorMcpCatalog} can retire it. @param recordPath - The file the value was read from (the receipt, or the creation or removal record that holds it as its owner), which the refusal names ({@link invalidCatalogRecord}). @param commandToRunAgain - The command the learner ran, which the refusal names as the one to run again. @example parseReceipt(record, '/home/user/.cursor/mcp.json', '/private/cursor-mcp-catalog/receipt.json', 'Codebook: Set Up AI Chat') */
function parseReceipt(
  value: unknown,
  targetPath: string,
  recordPath: string,
  commandToRunAgain: string,
): CatalogReceipt {
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
    throw invalidCatalogRecord(
      'Cursor MCP catalog ownership record',
      recordPath,
      commandToRunAgain,
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

/** Matches the inode number and the bytes through one no-follow handle ({@link openWithoutFollowing}, {@link isOwnedOpenFile}) before recovery or removal, tolerating volume device renumbering. @param commandToRunAgain - The command the learner ran, which the refusal of a file that could not be opened names as the one to run again. @returns `true` for the file the receipt names; `false` for a path that holds nothing, a link or no regular file, and for another or a changed file, also one that took the path while it was opened. @throws With the sentence of a file this user could not open at that moment ({@link refusalOfUnopenedFile}): such a file is never answered as not the owned one; every other failure of the open itself. @example await ownedFile('/home/user/.cursor/mcp.json', receipt, 'Codebook: Set Up AI Chat') */
async function ownedFile(
  path: string,
  owner: CatalogReceipt,
  commandToRunAgain: string,
): Promise<boolean> {
  let handle
  try {
    handle = await openWithoutFollowing(path)
  } catch (error) {
    if (NOT_AN_OWNED_FILE_CODES.has(systemErrorCode(error))) return false
    // A file that could not be opened is not "another file": nothing is known of it, and the command stops with the step that opens it.
    throw refusalOfUnopenedFile(
      error,
      'The Cursor MCP config',
      path,
      commandToRunAgain,
    )
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

/**
 * Words what the learner reads when the config's time cannot be set because this user may not write the file; for {@link refusalOfConfigTimes}.
 * @param targetPath - The config's path, which the sentence names.
 * @returns The sentence, with the step after which a setup's refresh finishes.
 * @example configNotWritableSentence('/home/user/.cursor/mcp.json')
 */
function configNotWritableSentence(targetPath: string): string {
  return `Cursor MCP config cannot be refreshed because this user may not change it (the file may be read-only or belong to another user): ${targetPath}. Codebook left it unchanged. Allow writing to this file, then run ${SET_UP_AI_CHAT_COMMAND} again.`
}

/**
 * Words what the learner reads when the config path came to hold another entry while the refresh opened the config, or between its read and the setting of its time; for {@link refusalOfConfigOpen}, {@link openPublishedConfig}, {@link refusalOfConfigTimes} and {@link setTimesThroughWritableFile}.
 * @param targetPath - The config's path, which the sentence names.
 * @returns The sentence; the setup run again refreshes the config as it stands then.
 * @example configChangedSentence('/home/user/.cursor/mcp.json')
 */
function configChangedSentence(targetPath: string): string {
  return `Cursor MCP config changed while Codebook refreshed it: ${targetPath}. Codebook left it unchanged. Run ${SET_UP_AI_CHAT_COMMAND} again.`
}

/**
 * Words what the learner reads for a config path that holds a pipe, a device or a folder; for {@link refusalOfConfigOpen} where the opener looks at the path first, and for {@link refreshCursorMcpCatalog} where the open lets such a path through and its status tells it.
 * What stands there is not Codebook's: the sentence says that it stays and how the path is freed, after which a setup creates the config.
 * @param targetPath - The config's path.
 * @returns The sentence, which names the path and the setup as the command to run again (only a setup's refresh opens the config this way; a removal answers such a path as a preserved config).
 * @example configNotRegularSentence('/home/user/.cursor/mcp.json')
 */
function configNotRegularSentence(targetPath: string): string {
  return `Cursor MCP config is not a regular file: ${targetPath}. Codebook left its settings unchanged. What stands at that path is yours to keep: rename it or move it elsewhere, then run ${SET_UP_AI_CHAT_COMMAND} again.`
}

/**
 * Words what the learner reads for a config path that holds a link, for {@link refusalOfConfigOpen}: Codebook sets no time through a link, and both the link and the file it points to are the learner's.
 * @param targetPath - The config's path.
 * @returns The sentence, with both ways after which a setup finishes: the file in the link's place is refreshed as it is, and where only the link is removed a setup creates an empty config.
 * @example configLinkSentence('/home/user/.cursor/mcp.json')
 */
function configLinkSentence(targetPath: string): string {
  return `Cursor MCP config cannot be refreshed without following a link: ${targetPath}. Codebook left the link and the file it points to as they are; both are yours. Put that file in the link's place, or remove the link (Codebook then creates an empty config there), then run ${SET_UP_AI_CHAT_COMMAND} again.`
}

/**
 * Words what the learner reads for a config that holds no byte, for {@link refreshCursorMcpCatalog}: Cursor reads no servers from such a file, and Codebook writes nothing into a file it did not create.
 * @param targetPath - The config's path.
 * @returns The sentence, with both ways after which a setup finishes: a config the learner wrote is refreshed as it is, and where the file is deleted a setup creates the config.
 * @example configEmptySentence('/home/user/.cursor/mcp.json')
 */
function configEmptySentence(targetPath: string): string {
  return `Cursor MCP config is empty: ${targetPath}. Codebook preserved it; the file is yours. Write your MCP servers into it (a config without servers is {"mcpServers":{}}), or delete it so that Codebook creates the config, then run ${SET_UP_AI_CHAT_COMMAND} again.`
}

/** The sentence for a config that {@link openWithoutFollowing} refused, by the code of its refusal: a link (`ELOOP`, from the open's own flag or from the look that comes first where the system has none), and, from that look alone, a path that is no regular file and a file that was replaced; a file that could not be opened at that moment reads {@link refusalOfUnopenedFile}, and every other code is the system's own text. */
const CONFIG_OPEN_SENTENCES: ReadonlyMap<
  string,
  (targetPath: string) => string
> = new Map([
  ['ELOOP', configLinkSentence],
  ['ENOTREG', configNotRegularSentence],
  ['EREPLACED', configChangedSentence],
])

/**
 * Turns a refused open of the Cursor MCP config into the sentence that fits it, for {@link openConfigForRefresh}.
 * @param error - What {@link openWithoutFollowing} threw; never a missing file.
 * @param targetPath - The config's path, which every sentence names.
 * @returns An error with the sentence of a link, of a path that is no regular file or of a replaced config ({@link CONFIG_OPEN_SENTENCES}), or of a config this user could not open at that moment ({@link refusalOfUnopenedFile}), with the failure as its cause; every other failure itself, which is the system's own text.
 * @example throw refusalOfConfigOpen(Object.assign(new Error('ELOOP'), { code: 'ELOOP' }), '/home/user/.cursor/mcp.json')
 */
function refusalOfConfigOpen(error: unknown, targetPath: string): unknown {
  const sentence = CONFIG_OPEN_SENTENCES.get(systemErrorCode(error))
  return sentence
    ? new Error(sentence(targetPath), { cause: error })
    : refusalOfUnopenedFile(
        error,
        'The Cursor MCP config',
        targetPath,
        SET_UP_AI_CHAT_COMMAND,
      )
}

/**
 * Opens the Cursor MCP config for a refresh without following a link, and turns a refusal into the sentence that fits it; called by {@link refreshCursorMcpCatalog} for each of its three opens of the config.
 * @param targetPath - The config's path.
 * @returns The open file; with `O_NOFOLLOW` it can still be a pipe, a device or a folder, which the refresh refuses by its status with {@link configNotRegularSentence}.
 * @throws The file system's error for a path that holds nothing (`ENOENT`: the refresh creates the config then); an error with the sentence of a link, of a pipe, a device or a folder, of a config another file replaced while it was opened, or of a config this user could not open at that moment ({@link refusalOfConfigOpen}), with the failure as its cause; every other failure of the open as it is.
 * @example const handle = await openConfigForRefresh('/home/user/.cursor/mcp.json')
 */
async function openConfigForRefresh(targetPath: string): Promise<FileHandle> {
  try {
    return await openWithoutFollowing(targetPath)
  } catch (error) {
    if (isMissing(error)) throw error
    throw refusalOfConfigOpen(error, targetPath)
  }
}

/**
 * Opens the config right after Codebook published it, or after another writer's file took its path, for {@link refreshCursorMcpCatalog}; a config that is gone by then changed while it was refreshed.
 * @param targetPath - The config's path.
 * @returns The open file ({@link openConfigForRefresh}).
 * @throws With {@link configChangedSentence} when the path holds nothing any more, and with the sentence {@link openConfigForRefresh} gives for a link, a path that is no regular file or a replaced file.
 * @example const handle = await openPublishedConfig('/home/user/.cursor/mcp.json')
 */
async function openPublishedConfig(targetPath: string): Promise<FileHandle> {
  return openConfigForRefresh(targetPath).catch((error: unknown) => {
    throw isMissing(error)
      ? new Error(configChangedSentence(targetPath), { cause: error })
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
        `Cursor MCP config could not be created: the file system refused to put Codebook's new file in place as ${targetPath} (${code}). No existing file was changed. Check that this folder allows new files and hard links, then run ${SET_UP_AI_CHAT_COMMAND} again.`,
        { cause: error },
      )
    : error
}

/**
 * Turns a failure to open or change the config for its times into the sentence that fits it, for {@link openConfigForItsTimes} and {@link setTimesThroughWritableFile}.
 * @param error - What the open or the change threw.
 * @param targetPath - The config's path, which both sentences name.
 * @returns An error with {@link configNotWritableSentence} for a file this user may not write, one with {@link configChangedSentence} for a path that no longer holds the file, each with the failure as its cause; every other failure itself.
 * @example throw refusalOfConfigTimes(Object.assign(new Error('EPERM'), { code: 'EPERM' }), '/home/user/.cursor/mcp.json')
 */
function refusalOfConfigTimes(error: unknown, targetPath: string): unknown {
  const code = systemErrorCode(error)
  if (WRITE_REFUSED_CODES.has(code))
    return new Error(configNotWritableSentence(targetPath), { cause: error })
  return CONFIG_GONE_CODES.has(code)
    ? new Error(configChangedSentence(targetPath), { cause: error })
    : error
}

/**
 * Opens the config a second time, with write access and without following a link, for {@link setTimesThroughWritableFile}. The open neither creates nor truncates a file.
 * @param targetPath - The config's path.
 * @returns The open file.
 * @throws With the sentence that fits when this user may not write the file or the path no longer holds it ({@link refusalOfConfigTimes}), or when a program holds the file for itself ({@link refusalOfUnopenedFile}).
 * @example const writable = await openConfigForItsTimes('/home/user/.cursor/mcp.json')
 */
async function openConfigForItsTimes(targetPath: string): Promise<FileHandle> {
  try {
    return await openWithoutFollowing(targetPath, undefined, 'read-write')
  } catch (error) {
    const refusal = refusalOfConfigTimes(error, targetPath)
    // A config this user may not write has its own sentence; one a program holds for itself is a file that could not be opened.
    throw refusal === error
      ? refusalOfUnopenedFile(
          error,
          'The Cursor MCP config',
          targetPath,
          SET_UP_AI_CHAT_COMMAND,
        )
      : refusal
  }
}

/**
 * Sets the config's times through a second file opened with write access, and only when that file is the one the refresh opened and read; called by {@link setTimesOfOpenConfig} where the system refuses the times through the file opened for reading (Windows).
 * @param opened - The status, with exact numbers, of the file the refresh opened for reading.
 * @param targetPath - The config's path.
 * @param accessedAt - The access time to keep.
 * @param modifiedAt - The new modification time.
 * @throws With {@link configChangedSentence} when the second file is not the first by device and inode number, and with the sentence that fits when the file cannot be opened or changed ({@link refusalOfConfigTimes}). Nothing is created, truncated or written.
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
      throw new Error(configChangedSentence(targetPath))
    await writable.utimes(accessedAt, modifiedAt).catch((error: unknown) => {
      throw refusalOfConfigTimes(error, targetPath)
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

/**
 * Says why a removal retires nothing for a receipt whose config is not the unchanged file Codebook created at its path, for {@link whyNoConfigIsOwned} and {@link removeOwnedCursorMcpCatalog}; the removal's notice words the answer ({@link cursorRemovalNotice}).
 * @param owner - The catalog's receipt.
 * @param targetPath - The config's path.
 * @returns
 * - `already-retired`: the receipt says an earlier removal retired the config
 * - `not-owned`: the config Codebook created is gone from its path, which holds nothing
 * - `preserved`: the path holds something that is not the unchanged file Codebook created
 * @example await whyNothingIsRetired({ ...receipt, installed: false }, '/home/user/.cursor/mcp.json') // => 'already-retired'
 */
async function whyNothingIsRetired(
  owner: CatalogReceipt,
  targetPath: string,
): Promise<UnretiredCatalogCleanup> {
  if (!owner.installed) return 'already-retired'
  // Looked at without following a link: any entry at the path is preserved.
  return (await lstat(targetPath).catch(passIfMissing))
    ? 'preserved'
    : 'not-owned'
}

/**
 * Says why {@link captureOwnedCursorMcpCatalogGeneration} found no config to reserve, so that the removal's notice does not call a config preserved where none is.
 * @param receiptPath - The catalog's receipt.
 * @param targetPath - The config's path.
 * @param commandToRunAgain - The command the learner ran, which a refusal of the receipt names as the one to run again.
 * @returns `not-owned` without a receipt; otherwise what {@link whyNothingIsRetired} says.
 * @example await whyNoConfigIsOwned(receiptPath, targetPath, 'Codebook: Remove Managed Cursor Skill') // => 'not-owned' for a learner who never set Cursor chat up
 */
async function whyNoConfigIsOwned(
  receiptPath: string,
  targetPath: string,
  commandToRunAgain: string,
): Promise<UnretiredCatalogCleanup> {
  const rawOwner = await privateJson(receiptPath, commandToRunAgain)
  if (rawOwner === undefined) return 'not-owned'
  return whyNothingIsRetired(
    parseReceipt(rawOwner, targetPath, receiptPath, commandToRunAgain),
    targetPath,
  )
}

/** Advances a verified empty config's private generation so a later cleanup cannot retire a newer window's refresh. @param commandToRunAgain - The command the learner ran, which a refusal of the receipt names as the one to run again. @example await advanceOwnedRefreshId(receiptPath, targetPath, 'Codebook: Set Up AI Chat') */
async function advanceOwnedRefreshId(
  receiptPath: string,
  targetPath: string,
  commandToRunAgain: string,
): Promise<string | undefined> {
  const rawOwner = await privateJson(receiptPath, commandToRunAgain)
  if (rawOwner === undefined) return undefined
  const owner = parseReceipt(
    rawOwner,
    targetPath,
    receiptPath,
    commandToRunAgain,
  )
  if (
    !owner.installed ||
    !(await ownedFile(targetPath, owner, commandToRunAgain))
  )
    return undefined
  const refreshId = randomUUID()
  await atomicPrivateWrite(
    receiptPath,
    { ...owner, refreshId },
    CURSOR_MCP_CATALOG_RECEIPT_LIMIT_BYTES,
  )
  return refreshId
}

/** Completes ownership after an atomic config publication, or discards only its verified unpublished staging file. @param commandToRunAgain - The command the learner ran, which a refusal of the creation record names as the one to run again. @example await recoverCreation(pending, receipt, target, cursorDirectory, 'Codebook: Set Up AI Chat') */
async function recoverCreation(
  pendingPath: string,
  receiptPath: string,
  targetPath: string,
  cursorDirectory: string,
  commandToRunAgain: string,
): Promise<void> {
  const record = await privateJson(pendingPath, commandToRunAgain)
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
    throw invalidCatalogRecord(
      'Cursor MCP catalog creation record',
      pendingPath,
      commandToRunAgain,
    )
  const owner = parseReceipt(
    record.owner,
    targetPath,
    pendingPath,
    commandToRunAgain,
  )
  if (!owner.installed || owner.retiredPath !== undefined)
    throw invalidCatalogRecord(
      'Cursor MCP catalog creation record',
      pendingPath,
      commandToRunAgain,
    )
  const published = await ownedFile(targetPath, owner, commandToRunAgain),
    staged = await ownedFile(record.stagedPath, owner, commandToRunAgain)
  if (published)
    await atomicPrivateWrite(
      receiptPath,
      owner,
      CURSOR_MCP_CATALOG_RECEIPT_LIMIT_BYTES,
    )
  // Codebook's own unpublished file goes; a config that was edited in place right after its publication still has the staged name as a second name: that name goes, the file stays at its path.
  if (staged) await unlink(record.stagedPath)
  else
    refuseUnopenedConfig(
      await dropSecondNameOfOneFile(targetPath, record.stagedPath),
      targetPath,
      record.stagedPath,
      commandToRunAgain,
    )
  // A changed target remains user-owned; only the exact staged inode is discarded.
  await unlink(pendingPath)
}

/**
 * Refuses when Codebook could not open the config to tell whether a name it had given the file is a second name of it, for {@link recoverCreation} (the staged name of a published config) and {@link leaveChangedConfigInPlace} (the retired name of a config a removal moved): nothing is known of the two names then, so both stay with the caller's record, and the same command settles them once the file opens.
 * @param answer - What became of the second name ({@link dropSecondNameOfOneFile}, {@link dropSecondNameOfMovedFile}).
 * @param targetPath - The config's path.
 * @param secondPath - The name Codebook had given the file.
 * @param commandToRunAgain - The command the learner ran, which the sentence names as the one to run again.
 * @throws For `unopened`, with the sentence that says to free the file ({@link describeUnopenedMovedFile}).
 * @example refuseUnopenedConfig('unopened', targetPath, retiredPath, 'Codebook: Remove Managed Cursor Skill') // throws
 */
function refuseUnopenedConfig(
  answer: MovedFileUndoing | SecondNameDrop,
  targetPath: string,
  secondPath: string,
  commandToRunAgain: string,
): void {
  if (answer === 'unopened')
    throw new Error(
      describeUnopenedMovedFile(
        'The Cursor MCP config',
        targetPath,
        secondPath,
        commandToRunAgain,
      ),
    )
}

/**
 * Leaves a config that is not the one Codebook created at its own path and takes away what a removal's move left of it, for {@link recoverRemoval} and for {@link removeOwnedCursorMcpCatalog} when the config changed between its ownership check and its move ({@link dropSecondNameOfMovedFile}: the config is linked back where its path holds nothing, and its second name in Codebook's storage is removed once it stands at its path).
 * @param targetPath - The config's path.
 * @param retiredPath - The name in Codebook's storage that the removal moved the config to.
 * @param pendingPath - The removal's recovery record, which the caller removes afterwards.
 * @param commandToRunAgain - The command the learner ran, which the sentence names as the one to run again.
 * @throws When the config's path holds another file than the one that was moved away: both files and the record stay, and the sentence names the kept file and what the learner does next. Also when the file system refuses to put the config back ({@link describeRefusedLinkBack}): the config stays under its retired name with the record. And when the config could not be opened ({@link refuseUnopenedConfig}): both names and the record stay.
 * @example await leaveChangedConfigInPlace(targetPath, retiredPath, pendingPath, 'Codebook: Remove Managed Cursor Skill')
 */
async function leaveChangedConfigInPlace(
  targetPath: string,
  retiredPath: string,
  pendingPath: string,
  commandToRunAgain: string,
): Promise<void> {
  const describeRefusal = (code: string): string =>
    describeRefusedLinkBack(
      'The Cursor MCP config',
      targetPath,
      code,
      retiredPath,
      commandToRunAgain,
    )
  const undoing = await dropSecondNameOfMovedFile(
    targetPath,
    retiredPath,
    describeRefusal,
  )
  refuseUnopenedConfig(undoing, targetPath, retiredPath, commandToRunAgain)
  if (undoing === 'kept')
    throw new Error(
      `Cursor MCP catalog changed during interrupted cleanup: ${targetPath}. Codebook preserved the config and recovery record. The file Codebook had moved away is kept as ${retiredPath}.${startOverBy(pendingPath, commandToRunAgain)}`,
    )
}

/**
 * Completes a journaled retirement before {@link refreshCursorMcpCatalog} can create another config, and ends one whose config turned out not to be Codebook's.
 * @returns
 * - `removed`: the config Codebook created stands under its retired name; the receipt now says so
 * - undefined: nothing to finish (no record), or the record is dropped: the config Codebook created is still at its path, or the config changed under the removal and stays in place as the learner's ({@link leaveChangedConfigInPlace})
 * @param commandToRunAgain - The command the learner ran, which a refusal names as the one to run again.
 * @throws For an invalid record, and when the config's path and the retired name hold two different files of which neither is the config Codebook created.
 * @example await recoverRemoval(pending, receipt, target, storage, 'Codebook: Remove Managed Cursor Skill')
 */
async function recoverRemoval(
  pendingPath: string,
  receiptPath: string,
  targetPath: string,
  storageDirectory: string,
  commandToRunAgain: string,
): Promise<CursorCatalogCleanup | undefined> {
  const record = await privateJson(pendingPath, commandToRunAgain)
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
    throw invalidCatalogRecord(
      'Cursor MCP catalog removal record',
      pendingPath,
      commandToRunAgain,
    )
  const owner = parseReceipt(
    record.owner,
    targetPath,
    pendingPath,
    commandToRunAgain,
  )
  if (await ownedFile(record.retiredPath, owner, commandToRunAgain)) {
    await atomicPrivateWrite(
      receiptPath,
      { ...owner, installed: false, retiredPath: record.retiredPath },
      CURSOR_MCP_CATALOG_RECEIPT_LIMIT_BYTES,
    )
    await unlink(pendingPath)
    return 'removed'
  }
  // Neither name holds the config Codebook created: it changed under the removal and stays the learner's.
  if (!(await ownedFile(targetPath, owner, commandToRunAgain)))
    await leaveChangedConfigInPlace(
      targetPath,
      record.retiredPath,
      pendingPath,
      commandToRunAgain,
    )
  await unlink(pendingPath)
  return undefined
}

/**
 * Waits for other active Cursor windows' catalog writers, also one that is taking a stale lock over; called by {@link refreshCursorMcpCatalog}, {@link captureOwnedCursorMcpCatalogGeneration} and {@link removeOwnedCursorMcpCatalog} around their hold of the catalog's storage lock. The retries displace no lock themselves: {@link withStorageLock} takes over a lock whose writer process is gone from this machine, and any other lock that stays through the retries is reported. Only the lock's own refusal ({@link StorageLockHeldError}) is waited for, never any failure with an `EEXIST` under it.
 * Cursor windows that restart together all refresh the catalog at once. Each pause is {@link CURSOR_MCP_CATALOG_LOCK_RETRY_DELAY_MS} plus a random draw below {@link CURSOR_MCP_CATALOG_LOCK_RETRY_JITTER_MS}, so the windows do not ask again in step, and {@link CURSOR_MCP_CATALOG_LOCK_RETRIES} tries leave room for dozens of them.
 * The tries share one cache of process starts: the start of a live window that holds the lock is read once for all of them (a PowerShell of up to {@link PROCESS_START_QUERY_TIMEOUT_MS} on Windows, a `/bin/ps` on macOS), not at each try, so the retries take the pauses' one to three seconds and one read for each holder. A kept start only confirms its holder alive ({@link readProcessStart}): a holder whose process ended is still taken over at the next try.
 * @param operation - One try: the hold of the lock and the write under it, given the starts the tries share to hand on to {@link withStorageLock}.
 * @returns What the first try that got the lock returned.
 * @throws The lock's refusal after the last retry, and every other failure at once.
 * @example await withCatalogLockRetry((holderStarts) => withStorageLock('/private', update, undefined, holderStarts))
 */
async function withCatalogLockRetry<Result>(
  operation: (
    holderStarts: Map<number, Promise<string | undefined>>,
  ) => Promise<Result>,
): Promise<Result> {
  const holderStarts = new Map<number, Promise<string | undefined>>()
  for (let retry = 0; ; retry += 1) {
    try {
      return await operation(holderStarts)
    } catch (error) {
      if (
        !(error instanceof StorageLockHeldError) ||
        retry >= CURSOR_MCP_CATALOG_LOCK_RETRIES
      )
        throw error
      // A pause of its own length for each window: windows that asked together ask again apart.
      await delay(
        CURSOR_MCP_CATALOG_LOCK_RETRY_DELAY_MS +
          randomInt(CURSOR_MCP_CATALOG_LOCK_RETRY_JITTER_MS),
      )
    }
  }
}

/**
 * Writes Codebook's empty config into the staged file and records it for recovery, for {@link refreshCursorMcpCatalog} right after it created the file and before it links the file into place as the config.
 * The caller removes the staged file when this fails: no record names the file then, and nothing else would remove it.
 * @param stagedHandle - The staged file, just created; it is closed here.
 * @param stagedPath - The staged file's path in Cursor's settings folder, which the record names.
 * @param targetPath - The config's path, which the receipt names.
 * @param pendingCreationPath - The creation record ({@link recoverCreation}).
 * @returns The receipt the published config gets, with the staged file's device and inode numbers.
 * @throws What the write, the flush, the look at the file, its close or the record's write threw.
 * @example const owner = await recordStagedConfig(stagedHandle, stagedPath, '/home/user/.cursor/mcp.json', '/private/cursor-mcp-catalog/pending-creation.json')
 */
async function recordStagedConfig(
  stagedHandle: FileHandle,
  stagedPath: string,
  targetPath: string,
  pendingCreationPath: string,
): Promise<CatalogReceipt> {
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
  return owner
}

/** The name {@link refreshCursorMcpCatalog} gives Codebook's new config in Cursor's settings folder until the file is linked into place: `.codebook-<uuid>.mcp.json`, with a random UUID as {@link randomUUID} writes it. */
const STAGED_CONFIG_NAME =
  /^\.codebook-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.mcp\.json$/

/**
 * Says whether an entry of Cursor's settings folder is a staged config that a window left when it was killed after it created the file and before it recorded it; for {@link removeLeftStagedConfigs}.
 * The entry is looked at without following a link and is not opened: what Codebook stages is known by its name and its size, and a running window stages its file for an instant.
 * @param cursorDirectory - Cursor's settings folder.
 * @param name - The entry's name.
 * @returns `true` for a regular file of Codebook's staged name ({@link STAGED_CONFIG_NAME}) that holds no more bytes than Codebook's empty config and was last changed longer ago than {@link CURSOR_MCP_STAGED_CONFIG_GRACE_MS}; `false` for every other entry, for a younger file (a running window may be staging it), for a larger one (it holds more than Codebook stages) and for a path that cannot be looked at.
 * @example await isLeftStagedConfig('/home/user/.cursor', '.codebook-123e4567-e89b-12d3-a456-426614174000.mcp.json') // => true for an empty file a killed window created two minutes ago
 */
async function isLeftStagedConfig(
  cursorDirectory: string,
  name: string,
): Promise<boolean> {
  if (!STAGED_CONFIG_NAME.test(name)) return false
  const entry = await lstat(join(cursorDirectory, name)).catch(() => undefined)
  return (
    entry !== undefined &&
    entry.isFile() &&
    entry.size <= Buffer.byteLength(EMPTY_MCP_CONFIG) &&
    Date.now() - entry.mtimeMs > CURSOR_MCP_STAGED_CONFIG_GRACE_MS
  )
}

/**
 * Removes the staged configs that windows left in Cursor's settings folder when they were killed after they created the file and before they recorded it, so that no such file stays there for good; called by {@link refreshCursorMcpCatalog} and {@link removeOwnedCursorMcpCatalog} under the catalog's storage lock, after {@link recoverCreation} has settled the staged file that a record names.
 * Only a file that {@link isLeftStagedConfig} judges left goes: a window whose catalog has a storage folder and a lock of its own may be staging a file at this moment, and a file with more bytes than Codebook stages is not Codebook's. A name that cannot be removed stays for the next sweep; the sweep never fails the command.
 * @param cursorDirectory - Cursor's settings folder, `~/.cursor`.
 * @example await removeLeftStagedConfigs('/home/user/.cursor')
 */
async function removeLeftStagedConfigs(cursorDirectory: string): Promise<void> {
  for (const name of await readdir(cursorDirectory).catch(() => []))
    if (await isLeftStagedConfig(cursorDirectory, name))
      await unlink(join(cursorDirectory, name)).catch(() => undefined)
}

/** Wakes Cursor's MCP catalog and returns the generation of an unchanged Codebook-owned empty file. @example await refreshCursorMcpCatalog('/private', '/home/user/.cursor') */
export async function refreshCursorMcpCatalog(
  storageRoot: string,
  cursorDirectory = join(homedir(), '.cursor'),
): Promise<string | undefined> {
  const storageDirectory = join(storageRoot, 'cursor-mcp-catalog')
  return withCatalogLockRetry((holderStarts) =>
    withStorageLock(
      storageDirectory,
      async () => {
        await regularDirectory(cursorDirectory, SET_UP_AI_CHAT_COMMAND)
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
          SET_UP_AI_CHAT_COMMAND,
        )
        await removeLeftStagedConfigs(cursorDirectory)
        await recoverRemoval(
          join(storageDirectory, 'pending-removal.json'),
          receiptPath,
          targetPath,
          storageDirectory,
          SET_UP_AI_CHAT_COMMAND,
        )
        const previous = await privateJson(receiptPath, SET_UP_AI_CHAT_COMMAND)
        if (previous !== undefined)
          parseReceipt(
            previous,
            targetPath,
            receiptPath,
            SET_UP_AI_CHAT_COMMAND,
          )
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
          let owner: CatalogReceipt
          try {
            owner = await recordStagedConfig(
              stagedHandle,
              stagedPath,
              targetPath,
              pendingCreationPath,
            )
          } catch (stagingError) {
            // The record was not written, so nothing names the staged file: it is Codebook's own and goes before the failure is reported.
            await unlink(stagedPath).catch(() => undefined)
            throw stagingError
          }
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
              SET_UP_AI_CHAT_COMMAND,
            )
            handle = await openPublishedConfig(targetPath)
          }
          if (!handle) {
            if (!(await ownedFile(targetPath, owner, SET_UP_AI_CHAT_COMMAND)))
              throw new Error(
                `Cursor MCP config changed during publication: ${targetPath}. Codebook preserved it and its recovery record. Run ${SET_UP_AI_CHAT_COMMAND} again.`,
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
          if (!status.isFile())
            throw new Error(configNotRegularSentence(targetPath))
          if (status.size === 0)
            throw new Error(configEmptySentence(targetPath))
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
          return advanceOwnedRefreshId(
            receiptPath,
            targetPath,
            SET_UP_AI_CHAT_COMMAND,
          )
        } finally {
          await handle.close()
        }
      },
      undefined,
      holderStarts,
    ),
  )
}

/** Reserves the current owned catalog generation before explicit skill removal without creating or touching a user config, or says why there is no config to retire ({@link CursorCatalogCapture}). @param commandToRunAgain - The command the learner ran, which a refusal of one of the catalog's records names as the one to run again: the removal command hands in its own title, so that its warning leaves one next step. @example await captureOwnedCursorMcpCatalogGeneration('/private') */
export async function captureOwnedCursorMcpCatalogGeneration(
  storageRoot: string,
  cursorDirectory = join(homedir(), '.cursor'),
  commandToRunAgain: string = SET_UP_AI_CHAT_COMMAND,
): Promise<CursorCatalogCapture> {
  const storageDirectory = join(storageRoot, 'cursor-mcp-catalog')
  return withCatalogLockRetry((holderStarts) =>
    withStorageLock(
      storageDirectory,
      async () => {
        const targetPath = join(cursorDirectory, 'mcp.json'),
          receiptPath = join(storageDirectory, 'receipt.json')
        // Without Cursor's settings folder no config stands in it: nothing is recovered or reserved, and that is no refusal.
        if (!(await lstat(cursorDirectory).catch(passIfMissing)))
          return {
            unowned: await whyNoConfigIsOwned(
              receiptPath,
              targetPath,
              commandToRunAgain,
            ),
          }
        await regularDirectory(cursorDirectory, commandToRunAgain)
        await recoverCreation(
          join(storageDirectory, 'pending-creation.json'),
          receiptPath,
          targetPath,
          cursorDirectory,
          commandToRunAgain,
        )
        await recoverRemoval(
          join(storageDirectory, 'pending-removal.json'),
          receiptPath,
          targetPath,
          storageDirectory,
          commandToRunAgain,
        )
        const ownedGeneration = await advanceOwnedRefreshId(
          receiptPath,
          targetPath,
          commandToRunAgain,
        )
        // Without a generation nothing is retired later; the removal's notice says why.
        return ownedGeneration === undefined
          ? {
              unowned: await whyNoConfigIsOwned(
                receiptPath,
                targetPath,
                commandToRunAgain,
              ),
            }
          : { ownedGeneration }
      },
      undefined,
      holderStarts,
    ),
  )
}

/** Retires only Codebook's unchanged empty Cursor catalog, optionally limited to one refresh generation. @param commandToRunAgain - The command the learner ran, which a refusal of one of the catalog's records names as the one to run again: the removal command hands in its own title, so that its warning leaves one next step. @example await removeOwnedCursorMcpCatalog('/private', '/home/user/.cursor') */
export async function removeOwnedCursorMcpCatalog(
  storageRoot: string,
  cursorDirectory = join(homedir(), '.cursor'),
  expectedRefreshId?: string,
  commandToRunAgain: string = SET_UP_AI_CHAT_COMMAND,
): Promise<CursorCatalogCleanup> {
  const storageDirectory = join(storageRoot, 'cursor-mcp-catalog')
  return withCatalogLockRetry((holderStarts) =>
    withStorageLock(
      storageDirectory,
      async () => {
        await regularDirectory(cursorDirectory, commandToRunAgain)
        const targetPath = join(cursorDirectory, 'mcp.json'),
          receiptPath = join(storageDirectory, 'receipt.json')
        const pendingPath = join(storageDirectory, 'pending-removal.json')
        await recoverCreation(
          join(storageDirectory, 'pending-creation.json'),
          receiptPath,
          targetPath,
          cursorDirectory,
          commandToRunAgain,
        )
        await removeLeftStagedConfigs(cursorDirectory)
        const recovered = await recoverRemoval(
          pendingPath,
          receiptPath,
          targetPath,
          storageDirectory,
          commandToRunAgain,
        )
        if (recovered) return recovered
        const rawReceipt = await privateJson(receiptPath, commandToRunAgain)
        if (rawReceipt === undefined) return 'not-owned'
        const owner = parseReceipt(
          rawReceipt,
          targetPath,
          receiptPath,
          commandToRunAgain,
        )
        if (
          expectedRefreshId !== undefined &&
          owner.refreshId !== expectedRefreshId
        )
          return 'preserved'
        if (
          !owner.installed ||
          !(await ownedFile(targetPath, owner, commandToRunAgain))
        )
          return whyNothingIsRetired(owner, targetPath)
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
        if (!(await ownedFile(retiredPath, owner, commandToRunAgain))) {
          // The config changed between the check and the move: it goes back to its place and stays the learner's.
          await leaveChangedConfigInPlace(
            targetPath,
            retiredPath,
            pendingPath,
            commandToRunAgain,
          )
          await unlink(pendingPath)
          return 'preserved'
        }
        await atomicPrivateWrite(
          receiptPath,
          { ...owner, installed: false, retiredPath },
          CURSOR_MCP_CATALOG_RECEIPT_LIMIT_BYTES,
        )
        await unlink(pendingPath)
        return 'removed'
      },
      undefined,
      holderStarts,
    ),
  )
}
