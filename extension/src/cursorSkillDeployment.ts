import { createHash, randomUUID } from 'node:crypto'
import type { BigIntStats } from 'node:fs'
import {
  link,
  lstat,
  mkdir,
  open,
  readdir,
  rename,
  rmdir,
  unlink,
  type FileHandle,
} from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

import {
  CURSOR_SKILL_RECEIPT_LIMIT_BYTES,
  CURSOR_SKILL_RECONNECT_ATTEMPTS,
  CURSOR_SKILL_RECONNECT_RETRY_DELAY_MS,
  EXTENSION_VERSION,
  PRIVATE_DIRECTORY_MODE,
  PRIVATE_FILE_MODE,
} from './constants'
import { areNamesOfOneFile } from './utils/areNamesOfOneFile'
import { atomicPrivateWrite } from './utils/atomicPrivateWrite'
import { REMOVE_MANAGED_CURSOR_SKILL_COMMAND } from './utils/cursorCatalogCleanupNotice'
import { describeRefusedLinkBack } from './utils/describeRefusedLinkBack'
import {
  ALLOW_LINKS_THEN_SET_UP_AGAIN,
  describeRefusedSkillLink,
} from './utils/describeRefusedSkillLink'
import { dropSecondNameOfMovedFile } from './utils/dropSecondNameOfMovedFile'
import { isNewerExtensionVersion } from './utils/isNewerExtensionVersion'
import { isRecordedFileId } from './utils/isRecordedFileId'
import { isSameFileId } from './utils/isSameFileId'
import { openWithoutFollowing } from './utils/openWithoutFollowing'
import { recordedFileId, type RecordedFileId } from './utils/recordedFileId'
import { SET_UP_AI_CHAT_COMMAND, startOverBy } from './utils/startOverBy'
import { systemErrorCode } from './utils/systemErrorCode'
import { withStorageLock } from './utils/withStorageLock'

const SKILL_RELATIVE_PATH = join('skills', 'codebook', 'SKILL.md')
const WIKI_PUBLISHER_RELATIVE_PATH = join(
  'skills',
  'codebook',
  'publish-wiki.mjs',
)
const WIKI_PUBLISHER_PATH_MARKER = '{{CODEBOOK_PUBLISHER_PATH}}'
/** What a reconnect answers for a skill it will not touch; {@link verifyManagedCursorSkill} decides it under the storage lock. */
const CHANGED_SKILL_REFUSAL =
  'Cursor skill is missing or was changed. Run Codebook: Set Up AI Chat; Codebook will not overwrite another edit.'

/** The step that lets a setup finish while a file that is not Codebook's stands at the skill's path: setup dropped its record when it refused, so the file is not adopted again, whatever is done to it. On a first install the skill folder must be empty, which is why the sentence says "out of its folder" and not "rename". */
const FREE_THE_SKILL_PATH_THEN_SET_UP_AGAIN =
  "Codebook leaves that file alone as long as it is there. To install Codebook's skill, delete that file or move it out of its folder, then run Codebook: Set Up AI Chat again."

/** What setup answers when a file that is not the installed skill stands at the skill's path while setup runs: a file that took the path in the instant before a first setup's link, or one that replaced the installed skill during an update. The file is the learner's and stays in place. */
const SKILL_CHANGED_DURING_SETUP = `The Cursor skill changed during setup; Codebook preserved it. ${FREE_THE_SKILL_PATH_THEN_SET_UP_AGAIN}`

/** What setup answers when the installed skill was edited in place while an update ran: the receipt still names that file, so the next setup adopts it again once its content is back, and installs anew when the file is gone. */
const SKILL_EDITED_DURING_SETUP =
  'The Cursor skill was edited during setup; Codebook preserved it. Undo that edit in the file, or delete or rename the file, then run Codebook: Set Up AI Chat again.'

/** What setup answers when the installed skill was taken away while an update ran: nothing is left to preserve, and the next setup installs the skill again. */
const SKILL_REMOVED_DURING_SETUP =
  'The Cursor skill was removed while setup ran; Codebook changed no file. Run Codebook: Set Up AI Chat again to install it.'

/** What setup answers when the skill it had just published changed before setup compared it: the receipt does not name that file (none on a first install, the previous skill on an update), so it is not adopted again. */
const PUBLISHED_SKILL_CHANGED_DURING_SETUP = `The published Cursor skill changed during setup; Codebook preserved it. ${FREE_THE_SKILL_PATH_THEN_SET_UP_AGAIN}`

/** How a removal that found a file of the learner at the skill's path ends: Codebook removes no file that is not its own, and once the learner took the file away the removal has nothing left to remove and finishes. */
const FINISH_REMOVAL_WITHOUT_THAT_FILE =
  'To finish the removal, delete or rename that file, then run Codebook: Remove Managed Cursor Skill again.'

/** What removal answers when the skill file changed between its check and its move away: the file is back in place and is the learner's now. */
const SKILL_CHANGED_DURING_REMOVAL = `The Cursor skill changed during removal; Codebook did not remove it and left it in place. ${FINISH_REMOVAL_WITHOUT_THAT_FILE}`

/** What setup answers for a file that took the place of the skill Codebook installed (another inode): setup leaves it alone, and installs its skill again once the path is free. */
const SKILL_REPLACED_AFTER_SETUP =
  "The managed Cursor skill was replaced after setup; Codebook preserved it. Codebook leaves that file alone as long as it is there. To install Codebook's skill again, delete or rename that file, then run Codebook: Set Up AI Chat again."

/** What removal answers for a file that took the place of the skill Codebook installed. */
const SKILL_REPLACED_BEFORE_REMOVAL = `The Cursor skill was replaced after setup; Codebook preserved it. Codebook leaves that file alone as long as it is there. ${FINISH_REMOVAL_WITHOUT_THAT_FILE}`

/** What removal answers for the installed skill file with other bytes than Codebook wrote. */
const SKILL_EDITED_BEFORE_REMOVAL = `The Cursor skill was edited after setup; Codebook preserved it. Codebook leaves that file alone as long as it is there. ${FINISH_REMOVAL_WITHOUT_THAT_FILE}`

/** The publisher a deployed skill names, as its receipt records it: the deploying installation's `publish-wiki.mjs`. Absent for a skill that names no publisher and in a record written before the path was recorded. */
type RecordedPublisher = { publisherPath?: string }

type SkillReceipt = {
  schemaVersion: 1
  targetPath: string
  skillSha256: string
  skillVersion: string
  extensionVersion: string
  installed: boolean
  device: RecordedFileId
  inode: RecordedFileId
} & RecordedPublisher

type PendingSkill = {
  schemaVersion: 1
  targetPath: string
  stagedPath: string
  skillSha256: string
  skillVersion: string
  extensionVersion: string
  device: RecordedFileId
  inode: RecordedFileId
  previous?: SkillReceipt
  displacedPath?: string
  retiredPath?: string
} & RecordedPublisher

type PendingRemoval = {
  schemaVersion: 1
  targetPath: string
  displacedPath: string
  retiredPath: string
  owner: SkillReceipt
}

/** What a reconnect finds when it compares the receipt, the deployed file and this installation's packaged skill. */
type ManagedSkillState =
  | { kind: 'changed' }
  | { kind: 'current' | 'newer' | 'outdated'; receipt: SkillReceipt }

export type CursorSkillResult = {
  /** What the setup or the reconnect did. */
  status: 'installed' | 'updated' | 'restored' | 'current'
  path: string
  sha256: string
  version: string
}

/**
 * How a removal ended for the skill; the removal command's notices word each ({@link cursorRemovalNotice}, {@link cursorCatalogCleanupNotice}).
 * - `removed`: this removal took Codebook's skill away, or found its file or folder already gone and recorded that
 * - `already-removed`: the receipt says an earlier removal took the skill away; nothing was left to do for the skill
 * - `not-installed`: no receipt is there, so Codebook knows no skill as its own (it was never set up here, or the learner deleted the receipt as an invalid record's sentence says); no file was changed
 */
export type CursorSkillRemovalStatus =
  'removed' | 'already-removed' | 'not-installed'

/** What {@link removeManagedCursorSkill} answers: how the removal ended, the managed skill path, and the digest and version of the skill the receipt named (absent without a receipt). */
export type CursorSkillRemoval = {
  status: CursorSkillRemovalStatus
  path: string
  sha256?: string
  version?: string
}

/** Classifies absent-file reads during {@link deployCursorSkill} without masking other I/O failures. @param error - File operation failure. @returns True only for `ENOENT`. @example isMissing(Object.assign(new Error('missing'), { code: 'ENOENT' })) // => true */
function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

/** Identifies skill bytes for {@link deployCursorSkill} receipts and ownership checks. @param bytes - Exact skill body. @returns Its lowercase SHA-256 digest. @example sha256(Buffer.from('a')) // => 'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb' */
function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** Inspects a skill path before {@link deployCursorSkill} changes it, treating only absence as empty. @param path - Exact file or directory path. @returns Its status with exact numbers (an inode number can be more than a number holds), or undefined when absent. @example await inspectedPath('/missing/codebook') // => undefined */
async function inspectedPath(path: string): Promise<BigIntStats | undefined> {
  try {
    return await lstat(path, { bigint: true })
  } catch (error) {
    if (isMissing(error)) return undefined
    throw error
  }
}

/** A file of the skill setup as one open file showed it: its bytes, and its status with exact numbers. Both are of one file, also when the path comes to name another file meanwhile. */
type SkillFileRead = { kind: 'read'; bytes: Buffer; status: BigIntStats }

/** Why a path of the skill setup was not read: it holds nothing, it holds a link, it holds a pipe, a device or a folder, or another file took it between the look at it and its open (only where the system's open cannot refuse a link, as on Windows). */
type UnreadSkillFileKind = 'missing' | 'link' | 'not-regular' | 'replaced'

/** What {@link lookAtSkillFile} found at a path. */
type SkillFileLook = SkillFileRead | { kind: UnreadSkillFileKind }

/** The kind of a path that {@link openWithoutFollowing} did not open, by the code of its error. */
const UNREAD_KIND_BY_OPEN_CODE: ReadonlyMap<string, UnreadSkillFileKind> =
  new Map([
    ['ENOENT', 'missing'],
    ['ELOOP', 'link'],
    ['ENOTREG', 'not-regular'],
    ['EREPLACED', 'replaced'],
  ])

/** The sentences for a path Codebook did not read, by what the path holds. */
type UnreadSkillFileSentences = Record<
  Exclude<UnreadSkillFileKind, 'missing'>,
  (path: string) => string
>

/** What the learner reads for a file of the skill setup that is not the managed skill itself (the bundled skill, the Wiki publisher, the copy of the installed skill) and that Codebook did not read: each sentence names the path. */
const UNREAD_SKILL_FILE_SENTENCES: UnreadSkillFileSentences = {
  link: (path) =>
    `Codebook will not read through a link: ${path}. Put the file itself at that path or remove the link, then run Codebook: Set Up AI Chat again.`,
  'not-regular': (path) =>
    `Codebook will not change a non-regular skill file: ${path}`,
  replaced: (path) =>
    `Another file took the place of ${path} while Codebook opened it, so it was not read. Run Codebook: Set Up AI Chat again.`,
}

/** What a setup or a reconnect answers for the managed skill path when it did not read it: each sentence names the step after which a setup installs the skill again (the receipt is there, so a path that holds nothing is restored). */
const UNREAD_SKILL_SENTENCES_OF_SETUP: UnreadSkillFileSentences = {
  link: (path) =>
    `Codebook will not read through a link: ${path}. Remove the link, then run Codebook: Set Up AI Chat again.`,
  'not-regular': (path) =>
    `Codebook will not change a non-regular skill file: ${path}. Delete or rename what stands at that path, then run Codebook: Set Up AI Chat again.`,
  replaced: UNREAD_SKILL_FILE_SENTENCES.replaced,
}

/** What a removal answers for the managed skill path when it did not read it: each sentence names the step after which the removal finishes, and the removal as the command to run again. */
const UNREAD_SKILL_SENTENCES_OF_REMOVAL: UnreadSkillFileSentences = {
  link: (path) =>
    `Codebook will not read through a link: ${path}. To finish the removal, remove the link, then run Codebook: Remove Managed Cursor Skill again.`,
  'not-regular': (path) =>
    `Codebook will not change a non-regular skill file: ${path}. To finish the removal, delete or rename what stands at that path, then run Codebook: Remove Managed Cursor Skill again.`,
  replaced: (path) =>
    `Another file took the place of ${path} while Codebook opened it, so it was not read. Run Codebook: Remove Managed Cursor Skill again.`,
}

/**
 * Takes the status and the bytes of an open file, for {@link lookAtSkillFile}: both come from the one file that was opened.
 * @param file - The file {@link openWithoutFollowing} opened.
 * @returns The bytes and the status of a regular file; `not-regular` for a pipe, a device or a folder, which the open lets through where the system has `O_NOFOLLOW`.
 * @example await readOpenSkillFile(file) // => { kind: 'read', bytes, status }
 */
async function readOpenSkillFile(file: FileHandle): Promise<SkillFileLook> {
  const status = await file.stat({ bigint: true })
  if (!status.isFile()) return { kind: 'not-regular' }
  return { kind: 'read', bytes: await file.readFile(), status }
}

/**
 * Reads one file of the skill setup (the skill, the bundled skill, a record, a retained file) without following a link, and takes its bytes and its status from the one file it opened; every read of {@link deployCursorSkill}, {@link verifyManagedCursorSkill} and {@link removeManagedCursorSkill} goes through it.
 * A look at the path followed by a read of the path could read another file: a link that took the path in between would be read through. {@link openWithoutFollowing} refuses that on every system.
 * @param path - Exact file path.
 * @returns
 * - `read` with the bytes and the status of the regular file at the path
 * - `missing`, `link`, `not-regular` or `replaced` when nothing was read ({@link UnreadSkillFileKind})
 * @throws Every other failure of the open or the read (no permission, for example).
 * @example await lookAtSkillFile('/home/user/.cursor/skills/codebook/SKILL.md') // => { kind: 'read', bytes, status }
 */
async function lookAtSkillFile(path: string): Promise<SkillFileLook> {
  let file
  try {
    file = await openWithoutFollowing(path)
  } catch (error) {
    const kind = UNREAD_KIND_BY_OPEN_CODE.get(systemErrorCode(error))
    if (kind) return { kind }
    throw error
  }
  try {
    return await readOpenSkillFile(file)
  } finally {
    await file.close()
  }
}

/**
 * Reads a regular file of the skill setup with its status, for the callers that compare the file with a receipt ({@link deploySkill}, {@link removeManagedCursorSkill}) and through {@link regularFile} for those that need the bytes alone.
 * @param path - Exact file path.
 * @param sentences - What the learner reads when the path was not read: {@link UNREAD_SKILL_SENTENCES_OF_SETUP} or {@link UNREAD_SKILL_SENTENCES_OF_REMOVAL} for the managed skill path, by the command that reads it; {@link UNREAD_SKILL_FILE_SENTENCES} for every other file.
 * @param kindsReadAsAbsent - What counts as "no file there" besides a path that holds nothing; a reconnect's look adds `replaced` ({@link inspectManagedSkill}).
 * @returns The bytes and the status of the one file that was opened, or undefined when the path holds nothing (or one of `kindsReadAsAbsent`).
 * @throws With the sentence that fits what the path holds: a link, a pipe, a device or a folder, or a file that was replaced while it was opened.
 * @example await readRegularFile('/missing/SKILL.md', UNREAD_SKILL_FILE_SENTENCES) // => undefined
 */
async function readRegularFile(
  path: string,
  sentences: UnreadSkillFileSentences,
  kindsReadAsAbsent: readonly UnreadSkillFileKind[] = [],
): Promise<SkillFileRead | undefined> {
  const look = await lookAtSkillFile(path)
  if (look.kind === 'read') return look
  if (look.kind === 'missing' || kindsReadAsAbsent.includes(look.kind))
    return undefined
  throw new Error(sentences[look.kind](path))
}

/** Reads the bytes of a regular file of the skill setup for {@link deployCursorSkill} without reading through a link ({@link readRegularFile}). @param path - Exact file path. @returns Its bytes, or undefined when absent. @throws With the sentence that fits a link, a path that is no regular file or a file that was replaced while it was opened. @example await regularFile('/missing/SKILL.md') // => undefined */
async function regularFile(path: string): Promise<Buffer | undefined> {
  return (await readRegularFile(path, UNREAD_SKILL_FILE_SENTENCES))?.bytes
}

/** Creates or verifies a private parent when {@link deployCursorSkill} prepares its owned paths. @param path - Directory to inspect. @returns After a regular directory exists. @example await ensureDirectory('/private/cursor-skill') // => resolves */
async function ensureDirectory(path: string): Promise<void> {
  const existing = await inspectedPath(path)
  if (!existing) await mkdir(path, { mode: PRIVATE_DIRECTORY_MODE })
  const status = await lstat(path)
  if (!status.isDirectory() || status.isSymbolicLink())
    throw new Error(
      `Codebook will not follow a non-directory skill path: ${path}`,
    )
}

/** Rejects redirected skill parents before {@link deployCursorSkill} reads or replaces a body. @param homeRoot - Cursor user home. @returns After all parents are regular directories. @example await assertSkillParents('/home/user') // => resolves */
async function assertSkillParents(homeRoot: string): Promise<void> {
  for (const path of [
    join(homeRoot, '.cursor'),
    join(homeRoot, '.cursor', 'skills'),
    join(homeRoot, '.cursor', 'skills', 'codebook'),
  ]) {
    const status = await inspectedPath(path)
    if (!status?.isDirectory() || status.isSymbolicLink())
      throw new Error(
        `Codebook will not follow a missing or redirected skill directory: ${path}`,
      )
  }
}

/**
 * Builds the refusal for a record of the skill setup that cannot be trusted (edited by hand, damaged, or written in a form this version does not read); every check of a receipt, a setup record or a removal record refuses through it, so each names the record and the same way out.
 * Codebook deletes nothing on such a record: it proves no ownership. The way out names everything that has to go for a setup to finish from any state: the record, and the skill folder (without its record Codebook no longer knows the skill as its own and would refuse the folder as another skill's). Under a removal the same two deletions take the skill away, and the removal that is run again finds nothing of the skill left and goes on to the Cursor MCP config.
 * @param subject - What is invalid, as the sentence begins: "Cursor skill ownership receipt", for example.
 * @param recordPath - The file that holds the invalid record.
 * @param targetPath - The managed skill path, whose folder the sentence names.
 * @param commandToRunAgain - The command the learner ran, which the sentence names as the one to run again.
 * @returns The error, not thrown yet.
 * @example throw invalidSkillRecord('Cursor skill ownership receipt', '/private/cursor-skill/receipt.json', '/home/user/.cursor/skills/codebook/SKILL.md', 'Codebook: Set Up AI Chat')
 */
function invalidSkillRecord(
  subject: string,
  recordPath: string,
  targetPath: string,
  commandToRunAgain: string,
): Error {
  return new Error(
    `${subject} is invalid; no skill file was changed. To start over, delete ${recordPath} and the folder ${dirname(targetPath)} (first copy anything of yours out of that folder), then run ${commandToRunAgain} again.`,
  )
}

/**
 * Reads the bytes of a record of the skill setup (`receipt.json`, `pending.json`, `removal.json`), for {@link readReceipt}, {@link readPending} and {@link readPendingRemoval}.
 * A record path that holds a link, a folder or another non-file, or a file that was replaced while it was opened, is an invalid record like one with a wrong field: the sentences of the skill file ("Codebook will not change a non-regular skill file: …") named the wrong thing there and gave no way out that ends in a finished setup.
 * @param path - The record file.
 * @param subject - What the record is, for the refusal ({@link invalidSkillRecord}).
 * @param targetPath - The managed skill path.
 * @param commandToRunAgain - The command the learner ran, which the refusal names as the one to run again.
 * @returns The bytes of the regular file at the path, or undefined when the path holds nothing.
 * @throws With the sentence of an invalid record for everything else ({@link lookAtSkillFile} read nothing).
 * @example await readRecordBytes('/private/cursor-skill/receipt.json', 'Cursor skill ownership receipt', targetPath, 'Codebook: Set Up AI Chat') // => undefined when absent
 */
async function readRecordBytes(
  path: string,
  subject: string,
  targetPath: string,
  commandToRunAgain: string,
): Promise<Buffer | undefined> {
  const look = await lookAtSkillFile(path)
  if (look.kind === 'read') return look.bytes
  if (look.kind === 'missing') return undefined
  throw invalidSkillRecord(subject, path, targetPath, commandToRunAgain)
}

/**
 * Parses the text of a record of the skill setup, for {@link readReceipt}, {@link readPending} and {@link readPendingRemoval}; text that is no JSON is an invalid record like one with a wrong field.
 * @param bytes - The record file's bytes.
 * @param subject - What the record is, for the refusal ({@link invalidSkillRecord}).
 * @param recordPath - The record file.
 * @param targetPath - The managed skill path.
 * @param commandToRunAgain - The command the learner ran, which the refusal names as the one to run again.
 * @returns The parsed value, not validated yet.
 * @throws With the sentence of an invalid record when the text is no JSON.
 * @example parseRecordText(bytes, 'Cursor skill ownership receipt', receiptPath, targetPath, 'Codebook: Set Up AI Chat')
 */
function parseRecordText(
  bytes: Buffer,
  subject: string,
  recordPath: string,
  targetPath: string,
  commandToRunAgain: string,
): unknown {
  try {
    return JSON.parse(bytes.toString('utf8'))
  } catch {
    throw invalidSkillRecord(subject, recordPath, targetPath, commandToRunAgain)
  }
}

/** Validates a private owner receipt before {@link deployCursorSkill} trusts prior installation. @param value - Parsed journal data. @param targetPath - Expected managed skill path. @param recordPath - The file the value was read from (the receipt, or the setup or removal record that holds it as its previous owner), which the refusal names. @param commandToRunAgain - The command the learner ran, which the refusal names as the one to run again. @returns A validated receipt. @throws With the sentence of an invalid record ({@link invalidSkillRecord}). @example parseReceipt(record, '/home/user/.cursor/skills/codebook/SKILL.md', '/private/cursor-skill/receipt.json', 'Codebook: Set Up AI Chat') // => SkillReceipt */
function parseReceipt(
  value: unknown,
  targetPath: string,
  recordPath: string,
  commandToRunAgain: string,
): SkillReceipt {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('schemaVersion' in value) ||
    value.schemaVersion !== 1 ||
    !('targetPath' in value) ||
    value.targetPath !== targetPath ||
    !('skillSha256' in value) ||
    typeof value.skillSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.skillSha256) ||
    !('skillVersion' in value) ||
    typeof value.skillVersion !== 'string' ||
    !('extensionVersion' in value) ||
    typeof value.extensionVersion !== 'string' ||
    !('installed' in value) ||
    typeof value.installed !== 'boolean' ||
    !('device' in value) ||
    !isRecordedFileId(value.device) ||
    !('inode' in value) ||
    !isRecordedFileId(value.inode)
  ) {
    throw invalidSkillRecord(
      'Cursor skill ownership receipt',
      recordPath,
      targetPath,
      commandToRunAgain,
    )
  }
  return {
    schemaVersion: 1,
    targetPath,
    skillSha256: value.skillSha256,
    skillVersion: value.skillVersion,
    extensionVersion: value.extensionVersion,
    installed: value.installed,
    device: value.device,
    inode: value.inode,
    ...recordedPublisher(value),
  }
}

/**
 * Reads the publisher path a receipt or a pending record holds, for {@link parseReceipt} and for the receipt {@link deploySkill} adopts from an interrupted setup.
 * @param record - The parsed record; one written before the path was recorded has none.
 * @returns `{ publisherPath }` for a record that names the path as text, otherwise `{}`, so the key is absent from every receipt built from it.
 * @example
 * recordedPublisher({ publisherPath: '/extensions/laststance.codebook-0.2.29/skills/codebook/publish-wiki.mjs' }) // => { publisherPath: '/extensions/…/publish-wiki.mjs' }
 * recordedPublisher({ schemaVersion: 1 }) // => {}
 */
function recordedPublisher(record: object): RecordedPublisher {
  return 'publisherPath' in record && typeof record.publisherPath === 'string'
    ? { publisherPath: record.publisherPath }
    : {}
}

/** Loads an optional private receipt for {@link deployCursorSkill} without treating missing as corruption. @param path - Receipt path. @param targetPath - Expected skill path. @param commandToRunAgain - The command the learner ran, which a refusal of the receipt names as the one to run again. @returns A validated receipt, or undefined. @example await readReceipt('/private/receipt.json', '/home/user/.cursor/skills/codebook/SKILL.md', 'Codebook: Set Up AI Chat') // => undefined when absent */
async function readReceipt(
  path: string,
  targetPath: string,
  commandToRunAgain: string,
): Promise<SkillReceipt | undefined> {
  const bytes = await readRecordBytes(
    path,
    'Cursor skill ownership receipt',
    targetPath,
    commandToRunAgain,
  )
  return bytes
    ? parseReceipt(
        parseRecordText(
          bytes,
          'Cursor skill ownership receipt',
          path,
          targetPath,
          commandToRunAgain,
        ),
        targetPath,
        path,
        commandToRunAgain,
      )
    : undefined
}

/** Limits a recovery file to Codebook's private storage or the skill's own volume when profiles span devices. @example isRetiredPath('/home/.cursor/skills/codebook/.codebook-retired-id.tmp', '/private/pending.json', '/home/.cursor/skills/codebook/SKILL.md') */
function isRetiredPath(
  candidate: unknown,
  recordPath: string,
  targetPath: string,
): boolean {
  return (
    typeof candidate === 'string' &&
    ((dirname(candidate) === dirname(recordPath) &&
      /^retired-[a-f0-9-]+\.SKILL\.md$/.test(basename(candidate))) ||
      (dirname(candidate) === dirname(targetPath) &&
        /^\.codebook-retired-[a-f0-9-]+\.tmp$/.test(basename(candidate))))
  )
}

/** Validates interrupted setup coordinates before {@link deployCursorSkill} resumes publication. @param path - Pending setup journal. @param targetPath - Expected skill path. @returns A validated pending setup, or undefined. @example await readPending('/private/pending.json', '/home/user/.cursor/skills/codebook/SKILL.md') // => undefined when absent */
async function readPending(
  path: string,
  targetPath: string,
): Promise<PendingSkill | undefined> {
  const bytes = await readRecordBytes(
    path,
    'Cursor skill pending ownership record',
    targetPath,
    SET_UP_AI_CHAT_COMMAND,
  )
  if (!bytes) return undefined
  const value: unknown = parseRecordText(
    bytes,
    'Cursor skill pending ownership record',
    path,
    targetPath,
    SET_UP_AI_CHAT_COMMAND,
  )
  const stagedDirectory = dirname(dirname(targetPath))
  if (
    typeof value !== 'object' ||
    value === null ||
    !('schemaVersion' in value) ||
    value.schemaVersion !== 1 ||
    !('targetPath' in value) ||
    value.targetPath !== targetPath ||
    !('stagedPath' in value) ||
    typeof value.stagedPath !== 'string' ||
    dirname(value.stagedPath) !== stagedDirectory ||
    !/^\.codebook-stage-[a-f0-9-]+\.tmp$/.test(basename(value.stagedPath)) ||
    !('skillSha256' in value) ||
    typeof value.skillSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.skillSha256) ||
    !('skillVersion' in value) ||
    typeof value.skillVersion !== 'string' ||
    !('extensionVersion' in value) ||
    typeof value.extensionVersion !== 'string' ||
    !('device' in value) ||
    !isRecordedFileId(value.device) ||
    !('inode' in value) ||
    !isRecordedFileId(value.inode)
  ) {
    throw invalidSkillRecord(
      'Cursor skill pending ownership record',
      path,
      targetPath,
      SET_UP_AI_CHAT_COMMAND,
    )
  }
  if (
    'displacedPath' in value &&
    (typeof value.displacedPath !== 'string' ||
      dirname(value.displacedPath) !== dirname(targetPath) ||
      !/^\.codebook-displaced-[a-f0-9-]+\.tmp$/.test(
        basename(value.displacedPath),
      ))
  ) {
    throw invalidSkillRecord(
      'Cursor skill pending displacement path',
      path,
      targetPath,
      SET_UP_AI_CHAT_COMMAND,
    )
  }
  if (
    'retiredPath' in value &&
    !isRetiredPath(value.retiredPath, path, targetPath)
  ) {
    throw invalidSkillRecord(
      'Cursor skill pending private retention path',
      path,
      targetPath,
      SET_UP_AI_CHAT_COMMAND,
    )
  }
  if ('previous' in value && value.previous !== undefined)
    parseReceipt(value.previous, targetPath, path, SET_UP_AI_CHAT_COMMAND)
  return value as PendingSkill
}

/** Validates interrupted removal coordinates before {@link deployCursorSkill} or cleanup recovers. @param path - Pending removal journal. @param targetPath - Expected skill path. @param commandToRunAgain - The command the learner ran (a setup recovers a removal too), which a refusal of the record names as the one to run again. @returns A validated pending removal, or undefined. @example await readPendingRemoval('/private/removal.json', '/home/user/.cursor/skills/codebook/SKILL.md', 'Codebook: Remove Managed Cursor Skill') // => undefined when absent */
async function readPendingRemoval(
  path: string,
  targetPath: string,
  commandToRunAgain: string,
): Promise<PendingRemoval | undefined> {
  const bytes = await readRecordBytes(
    path,
    'Cursor skill pending removal record',
    targetPath,
    commandToRunAgain,
  )
  if (!bytes) return undefined
  const value: unknown = parseRecordText(
    bytes,
    'Cursor skill pending removal record',
    path,
    targetPath,
    commandToRunAgain,
  )
  if (
    typeof value !== 'object' ||
    value === null ||
    !('schemaVersion' in value) ||
    value.schemaVersion !== 1 ||
    !('targetPath' in value) ||
    value.targetPath !== targetPath ||
    !('displacedPath' in value) ||
    typeof value.displacedPath !== 'string' ||
    dirname(value.displacedPath) !== dirname(targetPath) ||
    !/^\.codebook-displaced-[a-f0-9-]+\.tmp$/.test(
      basename(value.displacedPath),
    ) ||
    !('retiredPath' in value) ||
    !isRetiredPath(value.retiredPath, path, targetPath) ||
    !('owner' in value)
  )
    throw invalidSkillRecord(
      'Cursor skill pending removal record',
      path,
      targetPath,
      commandToRunAgain,
    )
  parseReceipt(value.owner, targetPath, path, commandToRunAgain)
  return value as PendingRemoval
}

/** Rechecks a receipted skill during setup or recovery without trusting a volume device number that can change after restart. The inode number and the bytes are of one open file ({@link lookAtSkillFile}), and the path must still name that file afterwards. @param path - Exact managed skill path. @param owner - Recorded inode number and bytes. @returns Whether the same regular file still has its recorded inode number ({@link isSameFileId}: compared exactly) and content; `false` also for a path that holds nothing, a link or no regular file, and for a file that was replaced while it was opened. @example await matchesOwnedFile('/home/.cursor/skills/codebook/SKILL.md', receipt) */
async function matchesOwnedFile(
  path: string,
  owner: Pick<SkillReceipt, 'skillSha256' | 'inode'>,
): Promise<boolean> {
  const look = await lookAtSkillFile(path)
  if (look.kind !== 'read' || !isSameFileId(owner.inode, look.status.ino))
    return false
  return (
    sha256(look.bytes) === owner.skillSha256 &&
    (await inspectedPath(path))?.ino === look.status.ino
  )
}

/** Stages new bytes privately before {@link deployCursorSkill} atomically replaces an owned skill. @param directory - Owned staging directory. @param bytes - Complete skill body. @returns Path to the staged regular file. @example await writeStagedBytes('/private/cursor-skill', Buffer.from('skill')) // => staged path */
async function writeStagedBytes(
  directory: string,
  bytes: Buffer,
): Promise<string> {
  const path = join(directory, `.codebook-stage-${randomUUID()}.tmp`),
    handle = await open(path, 'wx', PRIVATE_FILE_MODE)
  try {
    await handle.writeFile(bytes)
    await handle.sync()
  } catch (error) {
    await handle.close()
    await unlink(path).catch(() => undefined)
    throw error
  }
  await handle.close()
  return path
}

/** Removes only a matching abandoned stage while {@link deployCursorSkill} recovers setup. @param pending - Validated stage receipt. @returns After any owned stage is removed. @example await removeOwnedStage(pending) // => resolves */
async function removeOwnedStage(pending: PendingSkill): Promise<void> {
  if (await matchesOwnedFile(pending.stagedPath, pending))
    await unlink(pending.stagedPath)
}

/** Retains the actual displaced skill during {@link deployCursorSkill} recovery, then checks its bytes. @param path - Displaced live path. @param retiredPath - Private retention path. @param owner - Prior owner receipt. @param recordPath - The recovery record this step belongs to; a refusal names it and says how to start over ({@link startOverBy}). @param commandToRunAgain - The command the learner ran, which a refusal names as the one to run again. @returns After the displacement is safely retained. @throws When both names hold a file, or the retained file is not the owner's: both stay, with the record. @example await retireDisplaced('/home/user/.cursor/skills/codebook/.codebook-displaced-id.tmp', '/private/retired-id.SKILL.md', receipt, '/private/cursor-skill/pending.json', 'Codebook: Set Up AI Chat') // => resolves */
async function retireDisplaced(
  path: string,
  retiredPath: string,
  owner: SkillReceipt,
  recordPath: string,
  commandToRunAgain: string,
): Promise<void> {
  const displaced = await inspectedPath(path),
    retired = await inspectedPath(retiredPath)
  if (displaced && retired)
    throw new Error(
      `Cursor skill displacement and private retention both exist; Codebook preserved both for inspection.${startOverBy(recordPath, commandToRunAgain)}`,
    )
  // Moving the actual file preserves a concurrent edit or replacement instead of unlinking it after an earlier check.
  if (displaced) await rename(path, retiredPath)
  if (
    (await inspectedPath(retiredPath)) &&
    !(await matchesOwnedFile(retiredPath, owner))
  )
    throw new Error(
      `The displaced Cursor skill changed; Codebook retained its actual bytes privately for recovery.${startOverBy(recordPath, commandToRunAgain)}`,
    )
}

/** Completes a pending displacement before {@link deployCursorSkill} publishes another body. @param pending - Validated setup journal. @param pendingPath - That journal's path, which a refusal names ({@link startOverBy}). @returns After prior bytes are retained. @example await removeOwnedDisplacement(pending, '/private/cursor-skill/pending.json') // => resolves */
async function removeOwnedDisplacement(
  pending: PendingSkill,
  pendingPath: string,
): Promise<void> {
  if (!pending.displacedPath) return
  if (!pending.previous || !pending.retiredPath)
    throw new Error(
      `Cursor skill displacement has no complete recovery record.${startOverBy(pendingPath)}`,
    )
  await retireDisplaced(
    pending.displacedPath,
    pending.retiredPath,
    pending.previous,
    pendingPath,
    SET_UP_AI_CHAT_COMMAND,
  )
}

/**
 * Gives {@link dropSecondNameOfMovedFile} the sentence for a refused link back of the skill file, for the setup's and the removal's recoveries: the learner's changed file stays under the displaced name, and the sentence says where and what to do.
 * @param targetPath - The managed skill path.
 * @param displacedPath - The name the move gave the file.
 * @param commandToRunAgain - The command the learner ran.
 * @returns The wording for a code ({@link describeRefusedLinkBack}).
 * @example refusedSkillLinkBack(targetPath, displacedPath, 'Codebook: Set Up AI Chat')('EPERM')
 */
function refusedSkillLinkBack(
  targetPath: string,
  displacedPath: string,
  commandToRunAgain: string,
): (code: string) => string {
  return (code) =>
    describeRefusedLinkBack(
      'The Cursor skill',
      targetPath,
      code,
      displacedPath,
      commandToRunAgain,
    )
}

/**
 * Puts Codebook's previous skill back at the skill's path, for {@link deploySkill} when it recovers an update that stopped after its move (a crash, or a link the file system refused): the previous skill stands under its displaced name and the skill's path holds nothing.
 * The link never replaces a file. A file system that refuses it refuses it at every try, so the refusal is the sentence the first try ended with, which names where the previous skill is kept ({@link describeRefusedSkillLink}).
 * @param pending - The setup's record; its displaced name holds the previous skill.
 * @param displacedPath - That name.
 * @param targetPath - The managed skill path.
 * @param pendingPath - The record's path.
 * @throws
 * - Every code but `EEXIST`: the sentence of a refused link with the kept path, with the refusal as its cause; the previous skill and the record stay
 * - A failure without a code: itself
 * @example await restorePreviousSkill(pending, pending.displacedPath, targetPath, pendingPath)
 */
async function restorePreviousSkill(
  pending: PendingSkill,
  displacedPath: string,
  targetPath: string,
  pendingPath: string,
): Promise<void> {
  try {
    await link(displacedPath, targetPath)
  } catch (error) {
    const code = systemErrorCode(error)
    // A file that took the path in this instant is the learner's: the previous skill is retained as for a changed skill.
    if (code === 'EEXIST')
      return settleChangedSkill(pending, targetPath, pendingPath)
    throw code
      ? new Error(describeRefusedSkillLink(targetPath, code, displacedPath), {
          cause: error,
        })
      : error
  }
  await removeOwnedDisplacement(pending, pendingPath)
}

/**
 * Takes away what a setup's move left of a skill file that is not Codebook's any more, for {@link deploySkill}: at once when the file changed while setup ran, and at the next setup after a refusal or a crash left the setup's record.
 * Codebook's own previous skill, which the setup had moved away, is retained privately as after a finished update. A file that is not that skill is the learner's: it is linked back where the skill's path holds nothing, and its second name is removed once it stands at the skill's path ({@link dropSecondNameOfMovedFile}). A skill that was edited in place right after its publication still has the staged name as a second name, which is removed too.
 * @param pending - The setup's record.
 * @param targetPath - The managed skill path.
 * @param pendingPath - The record's path, which a refusal names.
 * @throws When the displaced name holds a file that is neither Codebook's previous skill nor the file at the skill's path: both files and the record stay, and the sentence names the kept file and how to start over.
 * @example await settleChangedSkill(pending, '/home/user/.cursor/skills/codebook/SKILL.md', '/private/cursor-skill/pending.json')
 */
async function settleChangedSkill(
  pending: PendingSkill,
  targetPath: string,
  pendingPath: string,
): Promise<void> {
  await settleDisplacedName(pending, targetPath, pendingPath)
  // A skill edited in place after its publication is one file with the stage; a stage with the recorded bytes is removed by the caller.
  if (await areNamesOfOneFile(targetPath, pending.stagedPath))
    await unlink(pending.stagedPath)
}

/**
 * Says whether the displaced name of a setup holds Codebook's own previous skill, for {@link settleDisplacedName}.
 * @param pending - The setup's record; one of a first install has no previous owner.
 * @param displacedPath - The displaced name the record holds.
 * @returns `true` for the previous skill with its recorded inode number and bytes; `false` for another file, for nothing, and without a previous owner.
 * @example await holdsPreviousSkill(pending, displacedPath) // => false for a file the learner edited
 */
async function holdsPreviousSkill(
  pending: PendingSkill,
  displacedPath: string,
): Promise<boolean> {
  return (
    pending.previous !== undefined &&
    (await matchesOwnedFile(displacedPath, pending.previous))
  )
}

/**
 * Settles the displaced name of a setup whose skill file is not Codebook's any more, for {@link settleChangedSkill}.
 * @param pending - The setup's record.
 * @param targetPath - The managed skill path.
 * @param pendingPath - The record's path, which a refusal names.
 * @throws When the displaced name holds a file that is neither Codebook's previous skill nor the file at the skill's path.
 * @example await settleDisplacedName(pending, targetPath, pendingPath)
 */
async function settleDisplacedName(
  pending: PendingSkill,
  targetPath: string,
  pendingPath: string,
): Promise<void> {
  const displacedPath = pending.displacedPath
  if (!displacedPath) return
  // Codebook's own previous skill is retained privately, as after a finished update.
  if (await holdsPreviousSkill(pending, displacedPath))
    return removeOwnedDisplacement(pending, pendingPath)
  // Any other file there is the learner's: it goes back to the skill's path, or stays where another file took that path.
  if (
    (await dropSecondNameOfMovedFile(
      targetPath,
      displacedPath,
      refusedSkillLinkBack(targetPath, displacedPath, SET_UP_AI_CHAT_COMMAND),
    )) === 'kept'
  )
    throw new Error(
      `Cursor skill changed during an interrupted setup; Codebook preserved it and its recovery record. The file Codebook had moved away is kept as ${displacedPath}.${startOverBy(pendingPath)}`,
    )
}

/**
 * Words the refusal of an update whose installed skill changed while the setup ran, for {@link deploySkill} after it abandoned that setup: the path is looked at once more, because the step that works depends on what stands there now.
 * @param targetPath - The managed skill path.
 * @param receipt - The receipt of the installed skill, which no step of the abandoned setup changed.
 * @returns
 * - {@link SKILL_EDITED_DURING_SETUP}: the receipted file itself stands there with other bytes; once the edit is undone in that file the next setup adopts it
 * - {@link SKILL_REMOVED_DURING_SETUP}: the path holds nothing
 * - {@link SKILL_CHANGED_DURING_SETUP}: another file (or a link, or no file) stands there, which no setup adopts
 * @example await sentenceOfSkillChangedDuringUpdate('/home/user/.cursor/skills/codebook/SKILL.md', receipt)
 */
async function sentenceOfSkillChangedDuringUpdate(
  targetPath: string,
  receipt: SkillReceipt,
): Promise<string> {
  const look = await lookAtSkillFile(targetPath)
  if (look.kind === 'missing') return SKILL_REMOVED_DURING_SETUP
  return look.kind === 'read' && isSameFileId(receipt.inode, look.status.ino)
    ? SKILL_EDITED_DURING_SETUP
    : SKILL_CHANGED_DURING_SETUP
}

/**
 * Ends a setup whose skill file changed while the setup ran, for {@link deploySkill} right before it refuses: what the move left is settled ({@link settleChangedSkill}), the staged file is removed and the record with it, so the next setup starts clean and answers for the file as it stands.
 * @param pending - The setup's record.
 * @param targetPath - The managed skill path.
 * @param pendingPath - The record's path.
 * @throws What {@link settleChangedSkill} throws; the record then stays.
 * @example await abandonSetupOfChangedSkill(next, targetPath, pendingPath)
 */
async function abandonSetupOfChangedSkill(
  pending: PendingSkill,
  targetPath: string,
  pendingPath: string,
): Promise<void> {
  await settleChangedSkill(pending, targetPath, pendingPath)
  await removeOwnedStage(pending)
  await unlink(pendingPath)
}

/**
 * Turns a failure to keep a copy of the installed skill in Codebook's storage into a sentence, for {@link deploySkill} before it updates the skill: the copy is put under its name with a hard link, which the file system can refuse.
 * @param error - What `link` threw.
 * @param backupPath - The copy's name in Codebook's storage.
 * @returns An error that names the path and the file system's code, with the failure as its cause; a failure without a code itself. Nothing of the skill was changed at that point.
 * @example throw refusalOfBackupLink(Object.assign(new Error('EPERM'), { code: 'EPERM' }), '/private/cursor-skill/3f6c….SKILL.md')
 */
function refusalOfBackupLink(error: unknown, backupPath: string): unknown {
  const code = systemErrorCode(error)
  return code
    ? new Error(
        `Cursor skill could not be updated: the file system refused to keep a copy of the installed skill as ${backupPath} (${code}). No skill file was changed. ${ALLOW_LINKS_THEN_SET_UP_AGAIN}`,
        { cause: error },
      )
    : error
}

/**
 * Words the refusal of the link that puts Codebook's new skill in place, for {@link publishStagedSkill}, and leaves the setup in a state the sentence describes.
 * A first install, or a restore of a skill that was gone, has moved nothing: its staged file and its record are removed, so nothing is left. An update has moved Codebook's previous skill to its displaced name before the link: that file and the record stay, and the sentence says where the previous skill is and how to go on using it (a link back would be refused as well, and a move back could replace a file that took the path).
 * @param code - The file system's code for the refused link; never `EEXIST`.
 * @param pending - The setup's record.
 * @param targetPath - The managed skill path.
 * @param pendingPath - The record's path.
 * @returns The sentence ({@link describeRefusedSkillLink}).
 * @example await sentenceOfRefusedSkillLink('EPERM', next, targetPath, pendingPath)
 */
async function sentenceOfRefusedSkillLink(
  code: string,
  pending: PendingSkill,
  targetPath: string,
  pendingPath: string,
): Promise<string> {
  const displacedPath = pending.displacedPath
  if (displacedPath && (await inspectedPath(displacedPath)))
    return describeRefusedSkillLink(targetPath, code, displacedPath)
  await removeOwnedStage(pending)
  await unlink(pendingPath)
  return describeRefusedSkillLink(targetPath, code)
}

/**
 * Puts the staged skill in place with a hard link, the one call that never replaces a file that stands at the skill's path, and answers its refusal with a sentence; called by {@link deploySkill} after its last check of the path.
 * @param pending - The setup's record, with the staged file.
 * @param targetPath - The managed skill path.
 * @param pendingPath - The record's path.
 * @throws
 * - `EEXIST` (a file took the skill's path in that instant): the setup is settled as for a skill that changed ({@link abandonSetupOfChangedSkill}) and ends with {@link SKILL_CHANGED_DURING_SETUP}
 * - Every other code (`EPERM` on Linux and `ENOTSUP` on macOS for a file system without hard links, `ENOSYS` where the file system has no such call, `EACCES` or `EROFS` for a folder that allows no new files, and whatever else the system answers): the sentence of a refused link, which names the path and the code ({@link sentenceOfRefusedSkillLink}), with the failure as its cause
 * - A failure without a code: itself
 * @example await publishStagedSkill(next, '/home/user/.cursor/skills/codebook/SKILL.md', '/private/cursor-skill/pending.json')
 */
async function publishStagedSkill(
  pending: PendingSkill,
  targetPath: string,
  pendingPath: string,
): Promise<void> {
  try {
    await link(pending.stagedPath, targetPath)
  } catch (error) {
    const code = systemErrorCode(error)
    if (!code) throw error
    if (code === 'EEXIST') {
      await abandonSetupOfChangedSkill(pending, targetPath, pendingPath)
      throw new Error(SKILL_CHANGED_DURING_SETUP, { cause: error })
    }
    throw new Error(
      await sentenceOfRefusedSkillLink(code, pending, targetPath, pendingPath),
      { cause: error },
    )
  }
}

/**
 * Says whether a removal's move was of a skill file that is not Codebook's, and undoes what is left of it, for {@link recoverRemoval} and for {@link removeManagedCursorSkill} when the file changed between its check and its move.
 * @param pending - The removal's record.
 * @param targetPath - The managed skill path.
 * @param commandToRunAgain - The command the learner ran (the setup or the removal), which the refusal of a link back names.
 * @returns
 * - `true`: neither the skill's path nor the displaced name holds Codebook's skill, and no second name is left (the file was linked back where the path held nothing, and its displaced name is removed; or nothing had been moved): the caller drops the record and goes on as for a file that was edited or replaced
 * - `false`: one of the two names holds Codebook's skill, both hold nothing, or they hold two different files: the removal's own recovery decides
 * @example await isRemovalOfChangedSkillUndone(pending, '/home/user/.cursor/skills/codebook/SKILL.md') // => true after an edit during the removal
 */
async function isRemovalOfChangedSkillUndone(
  pending: PendingRemoval,
  targetPath: string,
  commandToRunAgain: string,
): Promise<boolean> {
  if (await holdsSkillOfRemoval(pending, targetPath)) return false
  return (
    (await dropSecondNameOfMovedFile(
      targetPath,
      pending.displacedPath,
      refusedSkillLinkBack(
        targetPath,
        pending.displacedPath,
        commandToRunAgain,
      ),
    )) === 'dropped'
  )
}

/**
 * Says whether a removal's own recovery must decide, for {@link isRemovalOfChangedSkillUndone}: Codebook's skill stands at one of the two names, or neither name holds anything.
 * @param pending - The removal's record.
 * @param targetPath - The managed skill path.
 * @returns `true` then; `false` when a file that is not Codebook's skill stands at the skill's path or at the displaced name, and Codebook's skill at neither.
 * @example await holdsSkillOfRemoval(pending, targetPath) // => true right after a crash that moved Codebook's own skill
 */
async function holdsSkillOfRemoval(
  pending: PendingRemoval,
  targetPath: string,
): Promise<boolean> {
  const target = await inspectedPath(targetPath),
    displaced = await inspectedPath(pending.displacedPath)
  if (!target && !displaced) return true
  return (
    (await matchesOwnedFile(targetPath, pending.owner)) ||
    (await matchesOwnedFile(pending.displacedPath, pending.owner))
  )
}

/** Finishes or rejects an interrupted skill removal before {@link deployCursorSkill} reuses its receipt, and drops the record of a removal whose skill file changed under it ({@link isRemovalOfChangedSkillUndone}). @param path - Removal journal. @param receiptPath - Owner receipt path. @param targetPath - Managed skill path. @param commandToRunAgain - The command the learner ran (the setup or the removal), which every refusal names as the one to run again. @returns The recovered owner and completion flag; undefined without a record, and after the record of a changed file was dropped (the caller goes on as for an edited or replaced skill). @throws When the record must stay; each sentence says how to start over ({@link startOverBy}). @example await recoverRemoval('/private/removal.json', '/private/receipt.json', '/home/user/.cursor/skills/codebook/SKILL.md', 'Codebook: Remove Managed Cursor Skill') // => undefined when absent */
async function recoverRemoval(
  path: string,
  receiptPath: string,
  targetPath: string,
  commandToRunAgain: string,
): Promise<{ owner: SkillReceipt; completed: boolean } | undefined> {
  const pending = await readPendingRemoval(path, targetPath, commandToRunAgain)
  if (!pending) return undefined
  // A skill file that changed under the removal is the learner's: it stays in place, and the record is dropped.
  if (
    await isRemovalOfChangedSkillUndone(pending, targetPath, commandToRunAgain)
  ) {
    await unlink(path)
    return undefined
  }
  const target = await inspectedPath(targetPath),
    displaced = await inspectedPath(pending.displacedPath)
  if (target && !(await matchesOwnedFile(targetPath, pending.owner)))
    throw new Error(
      `Cursor skill changed during interrupted removal; Codebook preserved it and the displaced file (${pending.displacedPath}).${startOverBy(path, commandToRunAgain)}`,
    )
  if (
    displaced &&
    !(await matchesOwnedFile(pending.displacedPath, pending.owner))
  )
    throw new Error(
      `The displaced Cursor skill changed during removal; Codebook preserved it and its recovery record.${startOverBy(path, commandToRunAgain)}`,
    )
  if (!target && displaced) {
    // Removal moved the exact owned body; finish its receipt before deleting that body.
    await atomicPrivateWrite(
      receiptPath,
      { ...pending.owner, installed: false },
      CURSOR_SKILL_RECEIPT_LIMIT_BYTES,
    )
    await retireDisplaced(
      pending.displacedPath,
      pending.retiredPath,
      pending.owner,
      path,
      commandToRunAgain,
    )
  } else if (!target && !displaced) {
    const receipt = await readReceipt(
      receiptPath,
      targetPath,
      commandToRunAgain,
    )
    if (receipt?.installed)
      throw new Error(
        `Removed Cursor skill is missing before its receipt was updated; Codebook preserved the recovery record.${startOverBy(path, commandToRunAgain)}`,
      )
    await retireDisplaced(
      pending.displacedPath,
      pending.retiredPath,
      pending.owner,
      path,
      commandToRunAgain,
    )
  } else if (displaced)
    await retireDisplaced(
      pending.displacedPath,
      pending.retiredPath,
      pending.owner,
      path,
      commandToRunAgain,
    )
  await unlink(path)
  return { owner: pending.owner, completed: !target }
}

/** Binds the installed publisher path into Cursor's owned skill when {@link deployCursorSkill} starts setup. @param extensionPath - Installed VSIX root. @returns Deployable bytes, version and digest, and in `recorded` the publisher path those bytes name (`{}` for a skill that names none), which the receipt keeps. @example await packageSkill('/extensions/laststance.codebook-0.2.3') // => { bytes, version, sha256, recorded: { publisherPath: '/extensions/laststance.codebook-0.2.3/skills/codebook/publish-wiki.mjs' } } */
async function packageSkill(extensionPath: string): Promise<{
  bytes: Buffer
  version: string
  sha256: string
  recorded: RecordedPublisher
}> {
  const path = join(extensionPath, SKILL_RELATIVE_PATH),
    canonicalBytes = await regularFile(path)
  if (!canonicalBytes)
    throw new Error(
      'This Codebook installation is missing its bundled skill. Reinstall the VSIX.',
    )
  const canonicalText = canonicalBytes.toString('utf8')
  const version =
    /^---\nname: codebook\ndescription: [^\n]+\nmetadata:\n  version: "(\d+\.\d+\.\d+)"\n---\n/.exec(
      canonicalText,
    )?.[1]
  if (!version)
    throw new Error(
      'This Codebook installation has an invalid bundled skill. Reinstall the VSIX.',
    )
  const publisherPath = join(extensionPath, WIKI_PUBLISHER_RELATIVE_PATH)
  if (
    canonicalText.includes(WIKI_PUBLISHER_PATH_MARKER) &&
    !(await regularFile(publisherPath))
  )
    throw new Error(
      'This Codebook installation is missing its Wiki publisher. Reinstall the VSIX.',
    )
  const bytes = Buffer.from(
    canonicalText.replaceAll(WIKI_PUBLISHER_PATH_MARKER, publisherPath),
  )
  return {
    bytes,
    version,
    sha256: sha256(bytes),
    recorded: publisherNamedBy(canonicalText, publisherPath),
  }
}

/**
 * Says which publisher path the receipt of a packaged skill records, so a window of another extension version can tell whether the installation that deployed the skill still exists ({@link isRecordedPublisherGone}); called by {@link packageSkill}.
 * @param canonicalText - The bundled skill text, before the publisher path is bound into it.
 * @param publisherPath - This installation's publisher.
 * @returns `{ publisherPath }` for a skill that names the publisher, `{}` for one that does not.
 * @example publisherNamedBy('Publish with node {{CODEBOOK_PUBLISHER_PATH}}.', '/extensions/laststance.codebook-0.2.29/skills/codebook/publish-wiki.mjs') // => { publisherPath: '/extensions/…/publish-wiki.mjs' }
 */
function publisherNamedBy(
  canonicalText: string,
  publisherPath: string,
): RecordedPublisher {
  return canonicalText.includes(WIKI_PUBLISHER_PATH_MARKER)
    ? { publisherPath }
    : {}
}

/**
 * Reads the receipt and the deployed skill once and says how they stand to this installation, for {@link verifyManagedCursorSkill}: first without the lock, then again under it inside {@link deploySkill}.
 *
 * @param receiptPath - The private owner receipt.
 * @param targetPath - The managed skill file in Cursor's user skills.
 * @param packagedSha256 - Digest of the skill this installation packages.
 * @returns
 * - `changed`: no installed receipt, or the file is missing, replaced (another inode, also one that took the path while it was opened) or edited (other bytes)
 * - `current`: the receipted, unedited file holds this installation's bytes
 * - `newer`: the receipted, unedited file was deployed by a later extension version than the running one, and the publisher it names is not known to be gone
 * - `outdated`: the receipted, unedited file holds other bytes and was deployed by this or an earlier version, or by a later one whose publisher no longer exists ({@link isRecordedPublisherGone}: that installation was removed, as after a rollback)
 * @throws When the skill path holds a link or no regular file (with the sentence that fits, {@link readRegularFile}), or a read fails for another reason than a missing file.
 * @example await inspectManagedSkill('/private/cursor-skill/receipt.json', '/home/user/.cursor/skills/codebook/SKILL.md', packaged.sha256) // => { kind: 'current', receipt }
 */
async function inspectManagedSkill(
  receiptPath: string,
  targetPath: string,
  packagedSha256: string,
): Promise<ManagedSkillState> {
  const receipt = await readReceipt(
    receiptPath,
    targetPath,
    SET_UP_AI_CHAT_COMMAND,
  )
  // A file another window replaces right now can be gone, or be another file between the look at its path and its open; neither is a failed read. Both count as changed here and are decided under the lock.
  const current = await readRegularFile(
    targetPath,
    UNREAD_SKILL_SENTENCES_OF_SETUP,
    ['replaced'],
  )
  if (!isReceiptedSkillUnedited(receipt, current)) return { kind: 'changed' }
  return receiptedSkillState(
    receipt,
    packagedSha256,
    await isRecordedPublisherGone(receipt),
  )
}

/**
 * Says whether the publisher a deployed skill names no longer exists, so a skill of a later extension version is left alone only while its installation is still there; called by {@link inspectManagedSkill} for the receipted, unedited file, at each of a reconnect's looks.
 * @param receipt - The installed receipt of the deployed skill.
 * @returns
 * - `true` when the receipt records a publisher path and nothing, or no file, is at that path: the installation that deployed the skill was removed
 * - `false` when the publisher is a file, when the receipt records no path (a skill without a publisher, or a receipt from before the path was recorded), and when the path cannot be inspected: nothing proves that the installation is gone
 * @example await isRecordedPublisherGone({ ...receipt, publisherPath: '/extensions/laststance.codebook-0.2.29/skills/codebook/publish-wiki.mjs' }) // => true after 0.2.29 was uninstalled
 */
async function isRecordedPublisherGone(
  receipt: SkillReceipt,
): Promise<boolean> {
  if (receipt.publisherPath === undefined) return false
  try {
    return !(await lstat(receipt.publisherPath)).isFile()
  } catch (error) {
    // Only a path that is not there proves the removal; another failure decides nothing.
    return isMissing(error)
  }
}

/**
 * Says whether the deployed skill is the installed, unedited file of its receipt, for {@link inspectManagedSkill} right after it read both.
 * @param receipt - The owner receipt, or `undefined` when none is stored.
 * @param current - The bytes and the status of the deployed skill file, both of one open file, or `undefined` when it is missing.
 * @returns `true` for an installed receipt whose file is still there with its inode and bytes ({@link holdsReceiptedBytes}); `false` without an installed receipt and for a missing, replaced or edited file.
 * @example isReceiptedSkillUnedited(undefined, current) // => false
 */
function isReceiptedSkillUnedited(
  receipt: SkillReceipt | undefined,
  current: SkillFileRead | undefined,
): receipt is SkillReceipt {
  if (!receipt?.installed) return false
  return holdsReceiptedBytes(receipt, current)
}

/**
 * Compares the deployed skill file with what its receipt recorded, for {@link isReceiptedSkillUnedited}: the inode first, and the digest only for the same file.
 * @param receipt - The installed owner receipt.
 * @param current - The bytes and the status of the deployed skill file, both of one open file, or `undefined` when it is missing.
 * @returns `true` when the file exists, is the receipted inode and holds the receipted bytes; `false` when it is missing, replaced (another inode) or edited (other bytes).
 * @example holdsReceiptedBytes(receipt, undefined) // => false
 */
function holdsReceiptedBytes(
  receipt: SkillReceipt,
  current: SkillFileRead | undefined,
): boolean {
  if (!current) return false
  return (
    isSameFileId(receipt.inode, current.status.ino) &&
    sha256(current.bytes) === receipt.skillSha256
  )
}

/**
 * Says how a receipted, unedited skill stands to this installation, for {@link inspectManagedSkill} once the file is known to be the receipt's.
 * @param receipt - The installed receipt of the unedited file.
 * @param packagedSha256 - Digest of the skill this installation packages.
 * @param isPublisherGone - Whether the publisher the deployed skill names no longer exists ({@link isRecordedPublisherGone}).
 * @returns
 * - `current`: the file holds this installation's bytes
 * - `newer`: a later extension version than the running one deployed it, and its publisher is not known to be gone
 * - `outdated`: other bytes that this or an earlier version deployed, or a later version whose publisher is gone: a skill that names a removed publisher is updated, not left to a window that no longer exists
 * @example receiptedSkillState(receipt, receipt.skillSha256, false) // => { kind: 'current', receipt }
 */
function receiptedSkillState(
  receipt: SkillReceipt,
  packagedSha256: string,
  isPublisherGone: boolean,
): ManagedSkillState {
  if (receipt.skillSha256 === packagedSha256)
    return { kind: 'current', receipt }
  const isLeftToNewerWindow =
    !isPublisherGone &&
    isNewerExtensionVersion(receipt.extensionVersion, EXTENSION_VERSION)
  return { kind: isLeftToNewerWindow ? 'newer' : 'outdated', receipt }
}

/**
 * Installs or updates only a receipted user skill when Cursor setup is requested; another skill or later edit is preserved. Called by the setup command of {@link activate}; the work is {@link deploySkill} with the `setup` entry.
 *
 * @param extensionPath - The running installation, whose bundled skill is deployed.
 * @param storageRoot - Codebook's private storage, which holds the receipt and the storage lock.
 * @param homeRoot - The home folder whose `.cursor/skills/codebook/SKILL.md` is managed; tests pass a temporary one.
 * @returns
 * - `installed`: no skill was there
 * - `updated`: the receipted, unedited skill held other bytes
 * - `restored`: the receipted skill was missing
 * - `current`: the receipted skill already holds this installation's bytes
 * @throws When a skill Codebook does not own, or a later edit or replacement, is in the way (nothing is changed), and when the storage lock is held by another writer.
 * @example await deployCursorSkill('/ext', '/private', '/home') // => { status: 'installed', path, sha256, version }
 */
export async function deployCursorSkill(
  extensionPath: string,
  storageRoot: string,
  homeRoot = homedir(),
): Promise<CursorSkillResult> {
  return deploySkill(extensionPath, storageRoot, homeRoot, 'setup')
}

/**
 * Runs one skill deployment under the storage lock, for the learner's setup ({@link deployCursorSkill}) and for the implicit update of a reconnect ({@link verifyManagedCursorSkill}).
 *
 * A reconnect decides inside the lock, from the receipt and the file read again there, because another window can update or remove the shared skill between the reconnect's first look and its lock: it repairs nothing, and it never writes this installation's skill over one a newer window deployed.
 *
 * @param entry - `setup` installs, updates or restores as the learner asked; `reconnect` only updates the receipted, unedited skill of this or an earlier extension version, or of a later version whose installation was removed.
 * @returns What was done; for a reconnect that found this installation's or a newer window's skill, `current` with the deployed skill's digest and version.
 * @throws When another skill or a later edit is in the way, when the storage lock is held by another writer (the error's `cause` carries `EEXIST`), and for a reconnect when the skill is missing or was changed.
 * @example await deploySkill('/ext', '/private', '/home', 'reconnect') // => { status: 'updated', path, sha256, version }
 */
async function deploySkill(
  extensionPath: string,
  storageRoot: string,
  homeRoot: string,
  entry: 'setup' | 'reconnect',
): Promise<CursorSkillResult> {
  const targetDirectory = join(homeRoot, '.cursor', 'skills', 'codebook')
  const targetPath = join(targetDirectory, 'SKILL.md')
  const skillParent = dirname(targetDirectory)
  const receiptDirectory = join(storageRoot, 'cursor-skill')
  const receiptPath = join(receiptDirectory, 'receipt.json')
  const pendingPath = join(receiptDirectory, 'pending.json')
  const removalPath = join(receiptDirectory, 'removal.json')
  const packaged = await packageSkill(extensionPath)
  return withStorageLock(receiptDirectory, async () => {
    if (entry === 'reconnect') {
      // What the reconnect saw before the lock may be another window's finished update by now, so it is read again here.
      const held = await inspectManagedSkill(
        receiptPath,
        targetPath,
        packaged.sha256,
      )
      if (held.kind === 'changed') throw new Error(CHANGED_SKILL_REFUSAL)
      // This installation's bytes, or those of a newer window: nothing is written.
      if (held.kind !== 'outdated')
        return {
          status: 'current',
          path: targetPath,
          sha256: held.receipt.skillSha256,
          version: held.receipt.skillVersion,
        }
    }
    await ensureDirectory(join(homeRoot, '.cursor'))
    await ensureDirectory(skillParent)
    const initialDirectory = await inspectedPath(targetDirectory)
    if (
      initialDirectory &&
      (!initialDirectory.isDirectory() || initialDirectory.isSymbolicLink())
    )
      throw new Error(
        `Codebook will not follow a non-directory skill path: ${targetDirectory}`,
      )
    await recoverRemoval(
      removalPath,
      receiptPath,
      targetPath,
      SET_UP_AI_CHAT_COMMAND,
    )
    let receipt = await readReceipt(
      receiptPath,
      targetPath,
      SET_UP_AI_CHAT_COMMAND,
    )
    const pending = await readPending(pendingPath, targetPath)
    if (pending) {
      if (await matchesOwnedFile(targetPath, pending)) {
        // A prior publication succeeded before its receipt; adopt only its recorded bytes and inode.
        receipt = {
          schemaVersion: 1,
          targetPath,
          skillSha256: pending.skillSha256,
          skillVersion: pending.skillVersion,
          extensionVersion: pending.extensionVersion,
          installed: true,
          device: pending.device,
          inode: pending.inode,
          ...recordedPublisher(pending),
        }
        await atomicPrivateWrite(
          receiptPath,
          receipt,
          CURSOR_SKILL_RECEIPT_LIMIT_BYTES,
        )
        await removeOwnedDisplacement(pending, pendingPath)
      } else if (
        (pending.previous &&
          (await matchesOwnedFile(targetPath, pending.previous))) ||
        (receipt?.installed && (await matchesOwnedFile(targetPath, receipt)))
      ) {
        // Publication never happened; retain the previous exact owner or the absent first-install target.
        await removeOwnedDisplacement(pending, pendingPath)
      } else if (
        !(await inspectedPath(targetPath)) &&
        pending.previous &&
        pending.displacedPath &&
        (await matchesOwnedFile(pending.displacedPath, pending.previous))
      ) {
        // A crash after displacement left the owned prior body intact; restore it without overwriting new content.
        await restorePreviousSkill(
          pending,
          pending.displacedPath,
          targetPath,
          pendingPath,
        )
      } else {
        // The skill file is not Codebook's (it changed while a setup ran) or is gone: what the setup's move left is settled, and this setup answers for the file as it stands.
        await settleChangedSkill(pending, targetPath, pendingPath)
      }
      await removeOwnedStage(pending)
      await unlink(pendingPath)
    }
    const existingDirectory = await inspectedPath(targetDirectory)
    if (!receipt && existingDirectory) {
      if (
        !existingDirectory.isDirectory() ||
        existingDirectory.isSymbolicLink() ||
        (await readdir(targetDirectory)).length !== 0
      )
        throw new Error(
          'A codebook skill directory already exists in Cursor. Codebook left it untouched; resolve the name conflict before setup.',
        )
    }
    // The bytes and the inode number that are compared with the receipt are of one open file.
    const current = await readRegularFile(
      targetPath,
      UNREAD_SKILL_SENTENCES_OF_SETUP,
    )
    if (!receipt && current)
      throw new Error(
        'An existing codebook skill is not owned by this installation; no file was changed.',
      )
    if (receipt && current && !isSameFileId(receipt.inode, current.status.ino))
      throw new Error(SKILL_REPLACED_AFTER_SETUP)
    if (receipt && current && sha256(current.bytes) !== receipt.skillSha256)
      throw new Error(
        'The managed Cursor skill was edited after setup; Codebook preserved it. Restore or remove that edit manually before updating.',
      )
    if (receipt && current && !receipt.installed)
      throw new Error(
        'A codebook skill appeared after managed removal; Codebook preserved it.',
      )
    if (receipt && current && receipt.skillSha256 === packaged.sha256)
      return {
        status: 'current',
        path: targetPath,
        sha256: packaged.sha256,
        version: packaged.version,
      }
    // Preserve the old owned bytes for an interrupted upgrade without adopting arbitrary same-name content.
    if (current && receipt) {
      const backupPath = join(
        receiptDirectory,
        `${receipt.skillSha256}.SKILL.md`,
      )
      const backup = await regularFile(backupPath)
      if (backup && sha256(backup) !== receipt.skillSha256)
        throw new Error(
          'The previous managed skill backup differs from its receipt; no replacement was made.',
        )
      if (!backup) {
        const stagedBackup = await writeStagedBytes(
          receiptDirectory,
          current.bytes,
        )
        try {
          await link(stagedBackup, backupPath).catch((error: unknown) => {
            throw refusalOfBackupLink(error, backupPath)
          })
        } finally {
          await unlink(stagedBackup)
        }
      }
    }
    await ensureDirectory(targetDirectory)
    const retiredDirectory =
      (await lstat(receiptDirectory, { bigint: true })).dev ===
      (await lstat(targetDirectory, { bigint: true })).dev
        ? receiptDirectory
        : targetDirectory
    const stagedPath = await writeStagedBytes(skillParent, packaged.bytes),
      stagedStatus = await lstat(stagedPath, { bigint: true })
    const next: PendingSkill = {
      schemaVersion: 1,
      targetPath,
      stagedPath,
      skillSha256: packaged.sha256,
      skillVersion: packaged.version,
      extensionVersion: EXTENSION_VERSION,
      device: recordedFileId(stagedStatus.dev),
      inode: recordedFileId(stagedStatus.ino),
      ...packaged.recorded,
      ...(current && receipt
        ? {
            previous: receipt,
            displacedPath: join(
              targetDirectory,
              `.codebook-displaced-${randomUUID()}.tmp`,
            ),
            retiredPath:
              retiredDirectory === receiptDirectory
                ? join(receiptDirectory, `retired-${randomUUID()}.SKILL.md`)
                : join(
                    targetDirectory,
                    `.codebook-retired-${randomUUID()}.tmp`,
                  ),
          }
        : {}),
    }
    try {
      await atomicPrivateWrite(
        pendingPath,
        next,
        CURSOR_SKILL_RECEIPT_LIMIT_BYTES,
      )
    } catch (error) {
      await unlink(stagedPath)
      throw error
    }
    // Also a change made while the copy above was kept is met here, before anything is moved.
    if (current && receipt && !(await matchesOwnedFile(targetPath, receipt))) {
      await abandonSetupOfChangedSkill(next, targetPath, pendingPath)
      throw new Error(
        await sentenceOfSkillChangedDuringUpdate(targetPath, receipt),
      )
    }
    if (current && receipt && next.displacedPath) {
      await rename(targetPath, next.displacedPath)
      if (!(await matchesOwnedFile(next.displacedPath, receipt))) {
        // The file changed between the check and the move: it goes back to its place and stays the learner's.
        await abandonSetupOfChangedSkill(next, targetPath, pendingPath)
        throw new Error(
          await sentenceOfSkillChangedDuringUpdate(targetPath, receipt),
        )
      }
    }
    await publishStagedSkill(next, targetPath, pendingPath)
    if (!(await matchesOwnedFile(targetPath, next))) {
      await abandonSetupOfChangedSkill(next, targetPath, pendingPath)
      throw new Error(PUBLISHED_SKILL_CHANGED_DURING_SETUP)
    }
    await atomicPrivateWrite(
      receiptPath,
      {
        schemaVersion: 1,
        targetPath,
        skillSha256: packaged.sha256,
        skillVersion: packaged.version,
        extensionVersion: EXTENSION_VERSION,
        installed: true,
        device: next.device,
        inode: next.inode,
        ...packaged.recorded,
      },
      CURSOR_SKILL_RECEIPT_LIMIT_BYTES,
    )
    await removeOwnedStage(next)
    await removeOwnedDisplacement(next, pendingPath)
    await unlink(pendingPath)
    return {
      status: current ? 'updated' : receipt ? 'restored' : 'installed',
      path: targetPath,
      sha256: packaged.sha256,
      version: packaged.version,
    }
  })
}

/**
 * Checks a prior Cursor setup before reconnecting on editor restart. A skill that is missing, replaced or edited is never repaired implicitly; the receipted, unedited skill of this or an earlier extension version is updated to this installation's bytes through {@link deploySkill}, and the skill a newer window deployed is left as it is while the publisher it names exists. After a rollback removed that newer installation the skill names a publisher that is gone, and it is updated like an outdated one.
 *
 * Several windows reconnect at once after an extension update. The file that matches its receipt is accepted without the lock; everything else is decided under the storage lock, and a window that finds the lock held by another window's update waits and checks again, a bounded number of times.
 *
 * @returns `current` for this installation's or a newer window's skill, `updated` after the implicit update.
 * @throws When the skill is missing or was changed, and when the storage lock stays held through every attempt.
 * @example await verifyManagedCursorSkill('/ext', '/private', '/home')
 */
export async function verifyManagedCursorSkill(
  extensionPath: string,
  storageRoot: string,
  homeRoot = homedir(),
): Promise<CursorSkillResult> {
  const targetPath = join(homeRoot, '.cursor', 'skills', 'codebook', 'SKILL.md')
  await assertSkillParents(homeRoot)
  const receiptPath = join(storageRoot, 'cursor-skill', 'receipt.json')
  const packaged = await packageSkill(extensionPath)
  for (let attempt = 1; ; attempt += 1) {
    const seen = await inspectManagedSkill(
      receiptPath,
      targetPath,
      packaged.sha256,
    )
    const accepted = skillAcceptedWithoutLock(seen, targetPath, packaged)
    if (accepted) return accepted
    try {
      // An outdated skill is updated and a mismatch is confirmed under the lock, where no other window's update is half done.
      return await deploySkill(
        extensionPath,
        storageRoot,
        homeRoot,
        'reconnect',
      )
    } catch (error) {
      rethrowUnlessLockHeldElsewhere(error, attempt)
      // The other window's update leaves the receipt current; the next look then needs no lock.
      await delay(CURSOR_SKILL_RECONNECT_RETRY_DELAY_MS)
    }
  }
}

/**
 * Gives the reconnect's answer for a skill that needs no lock and no write, for {@link verifyManagedCursorSkill} after every look at the receipt and the file.
 * @param seen - How the receipt and the deployed file stand to this installation ({@link inspectManagedSkill}).
 * @param targetPath - The managed skill file in Cursor's user skills.
 * @param packaged - Digest and version of the skill this installation packages.
 * @returns
 * - `current` with this installation's digest and version, for the file that holds its bytes
 * - `current` with the receipt's digest and version, for the skill a newer window deployed
 * - `undefined` for an outdated or changed skill, which is decided under the storage lock
 * @example skillAcceptedWithoutLock({ kind: 'changed' }, '/home/user/.cursor/skills/codebook/SKILL.md', packaged) // => undefined
 */
function skillAcceptedWithoutLock(
  seen: ManagedSkillState,
  targetPath: string,
  packaged: { sha256: string; version: string },
): CursorSkillResult | undefined {
  if (seen.kind === 'current')
    return {
      status: 'current',
      path: targetPath,
      sha256: packaged.sha256,
      version: packaged.version,
    }
  // A window still running an earlier extension leaves the newer window's skill and reconnects with it.
  if (seen.kind === 'newer')
    return {
      status: 'current',
      path: targetPath,
      sha256: seen.receipt.skillSha256,
      version: seen.receipt.skillVersion,
    }
  return undefined
}

/**
 * Says whether a failed deployment was refused because another window holds the storage lock, for {@link rethrowUnlessLockHeldElsewhere}.
 * @param error - What {@link deploySkill} threw.
 * @returns `true` when the error's cause is the `EEXIST` of the lock file; `false` for every other failure.
 * @example isLockHeldElsewhere(new Error('changed')) // => false
 */
function isLockHeldElsewhere(error: unknown): boolean {
  // The cause is read by its shape: the lock's refusal carries the `EEXIST` of the lock file.
  return (
    typeof error === 'object' &&
    error !== null &&
    'cause' in error &&
    systemErrorCode(error.cause) === 'EEXIST'
  )
}

/**
 * Ends the reconnect with a deployment's failure unless waiting can help, for {@link verifyManagedCursorSkill} when {@link deploySkill} threw: only a lock another window holds is waited for, and only while attempts are left.
 * @param error - What the deployment threw.
 * @param attempt - The number of this attempt, from 1.
 * @throws `error` itself when it is no held lock, and at the last of {@link CURSOR_SKILL_RECONNECT_ATTEMPTS}.
 * @example rethrowUnlessLockHeldElsewhere(new Error('changed'), 1) // throws that error
 */
function rethrowUnlessLockHeldElsewhere(error: unknown, attempt: number): void {
  if (!isLockHeldElsewhere(error) || attempt >= CURSOR_SKILL_RECONNECT_ATTEMPTS)
    throw error
}

/**
 * Removes Codebook's skill folder when nothing is left in it, for {@link removeManagedCursorSkill}; a folder that still holds a file of the learner stays.
 * @param directory - `~/.cursor/skills/codebook`.
 * @throws Every failure of the removal but a folder that is not empty or not there.
 * @example await removeEmptySkillFolder('/home/user/.cursor/skills/codebook')
 */
async function removeEmptySkillFolder(directory: string): Promise<void> {
  // Remove only an empty Codebook directory; leave any user-added files in place.
  await rmdir(directory).catch((error: unknown) => {
    if (!['ENOTEMPTY', 'EEXIST', 'ENOENT'].includes(systemErrorCode(error)))
      throw error
  })
}

/**
 * Finishes a removal whose skill file, or whole skill folder, is already gone, for {@link removeManagedCursorSkill}: the learner deleted or renamed it (after a refusal told them to, or on their own), so no file is moved; the receipt records the removal and the empty skill folder goes.
 * @param receipt - The installed receipt.
 * @param receiptPath - Its path.
 * @param directory - `~/.cursor/skills/codebook`.
 * @returns `removed`, with the digest and version the receipt held.
 * @example await finishRemovalOfMissingSkill(receipt, '/private/cursor-skill/receipt.json', '/home/user/.cursor/skills/codebook') // => { status: 'removed', … }
 */
async function finishRemovalOfMissingSkill(
  receipt: SkillReceipt,
  receiptPath: string,
  directory: string,
): Promise<CursorSkillRemoval> {
  await atomicPrivateWrite(
    receiptPath,
    { ...receipt, installed: false },
    CURSOR_SKILL_RECEIPT_LIMIT_BYTES,
  )
  await removeEmptySkillFolder(directory)
  return {
    status: 'removed',
    path: receipt.targetPath,
    sha256: receipt.skillSha256,
    version: receipt.skillVersion,
  }
}

/**
 * Refuses a removal whose way to the skill folder is redirected, for {@link removeManagedCursorSkill}; a folder that is not there is no refusal: nothing of the skill can stand under it, as for a learner who never set Cursor chat up.
 * @param homeRoot - The home folder whose `.cursor/skills` holds the skill folder.
 * @throws When `.cursor` or `.cursor/skills` is a link or no folder.
 * @example await assertSkillParentsOfRemoval('/home/user') // resolves, also without /home/user/.cursor/skills
 */
async function assertSkillParentsOfRemoval(homeRoot: string): Promise<void> {
  for (const path of [
    join(homeRoot, '.cursor'),
    join(homeRoot, '.cursor', 'skills'),
  ]) {
    const status = await inspectedPath(path)
    // Nothing is below a folder that is not there.
    if (!status) return
    assertNotRedirected(status, path)
  }
}

/**
 * Refuses a path on the way to the skill folder that is a link or no folder, for {@link assertSkillParentsOfRemoval}.
 * @param status - What stands at the path, looked at without following a link.
 * @param path - The path, which the refusal names.
 * @throws For a link and for anything that is no folder.
 * @example assertNotRedirected(await lstat('/home/user/.cursor', { bigint: true }), '/home/user/.cursor')
 */
function assertNotRedirected(status: BigIntStats, path: string): void {
  if (!status.isDirectory() || status.isSymbolicLink())
    throw new Error(
      `Codebook will not follow a missing or redirected skill directory: ${path}`,
    )
}

/**
 * Removes only the exact receipted Cursor skill after an explicit user command; setup can restore it later. Called by the removal command of {@link activate}, which then goes on to Codebook's empty Cursor MCP config, whatever the answer.
 * Every refusal that names a command to run again names the removal ({@link REMOVE_MANAGED_CURSOR_SKILL_COMMAND}), but the one of an interrupted setup, which the setup recovers.
 * @param storageRoot - Codebook's private storage, which holds the receipt and the storage lock.
 * @param homeRoot - The home folder whose `.cursor/skills/codebook/SKILL.md` is managed; tests pass a temporary one.
 * @returns
 * - `removed`: Codebook's skill was moved away and retained privately, or its file or folder was already gone and the receipt now says so
 * - `already-removed`: the receipt says an earlier removal took the skill away; nothing was changed, and the command goes on to what that removal could not finish
 * - `not-installed`: no receipt exists (Cursor chat was never set up here, or the learner deleted the receipt as an invalid record's sentence says); no file was changed
 * @throws When the file at the skill's path is not the one Codebook installed (it stays, and the sentence says what to do), and when a record of an interrupted setup or removal is in the way.
 * @example await removeManagedCursorSkill('/private', '/home') // => { status: 'removed', path, sha256, version }
 */
export async function removeManagedCursorSkill(
  storageRoot: string,
  homeRoot = homedir(),
): Promise<CursorSkillRemoval> {
  const targetPath = join(homeRoot, '.cursor', 'skills', 'codebook', 'SKILL.md')
  const receiptDirectory = join(storageRoot, 'cursor-skill'),
    receiptPath = join(receiptDirectory, 'receipt.json'),
    removalPath = join(receiptDirectory, 'removal.json')
  return withStorageLock(receiptDirectory, async () => {
    const directory = join(homeRoot, '.cursor', 'skills', 'codebook')
    await assertSkillParentsOfRemoval(homeRoot)
    const targetDirectory = await inspectedPath(directory)
    if (
      targetDirectory &&
      (!targetDirectory.isDirectory() || targetDirectory.isSymbolicLink())
    )
      throw new Error(
        `Codebook will not follow a non-directory skill path: ${directory}`,
      )
    if (await inspectedPath(join(receiptDirectory, 'pending.json')))
      throw new Error(
        'Cursor skill setup is interrupted. Run Codebook: Set Up AI Chat to recover before removal.',
      )
    const recovered = await recoverRemoval(
      removalPath,
      receiptPath,
      targetPath,
      REMOVE_MANAGED_CURSOR_SKILL_COMMAND,
    )
    if (recovered?.completed)
      return {
        status: 'removed',
        path: targetPath,
        sha256: recovered.owner.skillSha256,
        version: recovered.owner.skillVersion,
      }
    const receipt = await readReceipt(
      receiptPath,
      targetPath,
      REMOVE_MANAGED_CURSOR_SKILL_COMMAND,
    )
    // Without a receipt Codebook knows no skill as its own: nothing is changed, and the command goes on to the Cursor MCP config.
    if (!receipt) return { status: 'not-installed', path: targetPath }
    // An earlier removal took the skill away: nothing is left to do for it, and the command goes on to what that removal could not finish.
    if (!receipt.installed)
      return {
        status: 'already-removed',
        path: targetPath,
        sha256: receipt.skillSha256,
        version: receipt.skillVersion,
      }
    // The skill's folder is gone (the learner took it away): nothing is left to remove, and the receipt says so.
    if (!(await inspectedPath(directory)))
      return finishRemovalOfMissingSkill(receipt, receiptPath, directory)
    await assertSkillParents(homeRoot)
    // The bytes and the inode number that are compared with the receipt are of one open file.
    const current = await readRegularFile(
      targetPath,
      UNREAD_SKILL_SENTENCES_OF_REMOVAL,
    )
    // The same for the skill file alone.
    if (!current)
      return finishRemovalOfMissingSkill(receipt, receiptPath, directory)
    if (!isSameFileId(receipt.inode, current.status.ino))
      throw new Error(SKILL_REPLACED_BEFORE_REMOVAL)
    if (sha256(current.bytes) !== receipt.skillSha256)
      throw new Error(SKILL_EDITED_BEFORE_REMOVAL)
    const retiredDirectory =
      (await lstat(receiptDirectory, { bigint: true })).dev ===
      (await lstat(directory, { bigint: true })).dev
        ? receiptDirectory
        : directory
    const displacedPath = join(
      directory,
      `.codebook-displaced-${randomUUID()}.tmp`,
    )
    const retiredPath =
      retiredDirectory === receiptDirectory
        ? join(receiptDirectory, `retired-${randomUUID()}.SKILL.md`)
        : join(directory, `.codebook-retired-${randomUUID()}.tmp`)
    await atomicPrivateWrite(
      removalPath,
      {
        schemaVersion: 1,
        targetPath,
        displacedPath,
        retiredPath,
        owner: receipt,
      },
      CURSOR_SKILL_RECEIPT_LIMIT_BYTES,
    )
    await rename(targetPath, displacedPath)
    if (!(await matchesOwnedFile(displacedPath, receipt))) {
      // The file changed between the check and the move: it goes back to its place and stays the learner's.
      if (
        (await dropSecondNameOfMovedFile(
          targetPath,
          displacedPath,
          refusedSkillLinkBack(
            targetPath,
            displacedPath,
            REMOVE_MANAGED_CURSOR_SKILL_COMMAND,
          ),
        )) === 'kept'
      )
        throw new Error(
          `Cursor skill changed during interrupted removal; Codebook preserved it and the displaced file (${displacedPath}).${startOverBy(removalPath, REMOVE_MANAGED_CURSOR_SKILL_COMMAND)}`,
        )
      await unlink(removalPath)
      throw new Error(SKILL_CHANGED_DURING_REMOVAL)
    }
    await atomicPrivateWrite(
      receiptPath,
      { ...receipt, installed: false },
      CURSOR_SKILL_RECEIPT_LIMIT_BYTES,
    )
    await retireDisplaced(
      displacedPath,
      retiredPath,
      receipt,
      removalPath,
      REMOVE_MANAGED_CURSOR_SKILL_COMMAND,
    )
    await removeEmptySkillFolder(directory)
    await unlink(removalPath)
    return {
      status: 'removed',
      path: targetPath,
      sha256: receipt.skillSha256,
      version: receipt.skillVersion,
    }
  })
}
