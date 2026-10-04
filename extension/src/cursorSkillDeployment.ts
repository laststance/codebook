import { createHash, randomUUID } from 'node:crypto'
import {
  link,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rmdir,
  unlink,
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
import { atomicPrivateWrite } from './utils/atomicPrivateWrite'
import { isNewerExtensionVersion } from './utils/isNewerExtensionVersion'
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

type SkillReceipt = {
  schemaVersion: 1
  targetPath: string
  skillSha256: string
  skillVersion: string
  extensionVersion: string
  installed: boolean
  device: number
  inode: number
}

type PendingSkill = {
  schemaVersion: 1
  targetPath: string
  stagedPath: string
  skillSha256: string
  skillVersion: string
  extensionVersion: string
  device: number
  inode: number
  previous?: SkillReceipt
  displacedPath?: string
  retiredPath?: string
}

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
  status: 'installed' | 'updated' | 'restored' | 'current' | 'removed'
  path: string
  sha256: string
  version: string
}

/** Classifies absent-file reads during {@link deployCursorSkill} without masking other I/O failures. @param error - File operation failure. @returns True only for `ENOENT`. @example isMissing(Object.assign(new Error('missing'), { code: 'ENOENT' })) // => true */
function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

/** Identifies skill bytes for {@link deployCursorSkill} receipts and ownership checks. @param bytes - Exact skill body. @returns Its lowercase SHA-256 digest. @example sha256(Buffer.from('a')) // => 'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb' */
function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** Inspects a skill path before {@link deployCursorSkill} changes it, treating only absence as empty. @param path - Exact file or directory path. @returns Its status, or undefined when absent. @example await inspectedPath('/missing/codebook') // => undefined */
async function inspectedPath(
  path: string,
): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
  try {
    return await lstat(path)
  } catch (error) {
    if (isMissing(error)) return undefined
    throw error
  }
}

/** Reads a regular skill file for {@link deployCursorSkill} without accepting symlink targets. @param path - Exact file path. @returns Its bytes, or undefined when absent. @example await regularFile('/missing/SKILL.md') // => undefined */
async function regularFile(path: string): Promise<Buffer | undefined> {
  const status = await inspectedPath(path)
  if (!status) return undefined
  if (!status.isFile() || status.isSymbolicLink())
    throw new Error(
      `Codebook will not change a non-regular skill file: ${path}`,
    )
  return readFile(path)
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

/** Validates a private owner receipt before {@link deployCursorSkill} trusts prior installation. @param value - Parsed journal data. @param targetPath - Expected managed skill path. @returns A validated receipt. @example parseReceipt(record, '/home/user/.cursor/skills/codebook/SKILL.md') // => SkillReceipt */
function parseReceipt(value: unknown, targetPath: string): SkillReceipt {
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
    typeof value.device !== 'number' ||
    !Number.isSafeInteger(value.device) ||
    !('inode' in value) ||
    typeof value.inode !== 'number' ||
    !Number.isSafeInteger(value.inode)
  ) {
    throw new Error(
      'Cursor skill ownership receipt is invalid; no skill file was changed.',
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
  }
}

/** Loads an optional private receipt for {@link deployCursorSkill} without treating missing as corruption. @param path - Receipt path. @param targetPath - Expected skill path. @returns A validated receipt, or undefined. @example await readReceipt('/private/receipt.json', '/home/user/.cursor/skills/codebook/SKILL.md') // => undefined when absent */
async function readReceipt(
  path: string,
  targetPath: string,
): Promise<SkillReceipt | undefined> {
  const bytes = await regularFile(path)
  return bytes
    ? parseReceipt(JSON.parse(bytes.toString('utf8')), targetPath)
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
  const bytes = await regularFile(path)
  if (!bytes) return undefined
  const value: unknown = JSON.parse(bytes.toString('utf8'))
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
    typeof value.device !== 'number' ||
    !Number.isSafeInteger(value.device) ||
    !('inode' in value) ||
    typeof value.inode !== 'number' ||
    !Number.isSafeInteger(value.inode)
  ) {
    throw new Error(
      'Cursor skill pending ownership record is invalid; no skill file was changed.',
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
    throw new Error(
      'Cursor skill pending displacement path is invalid; no skill file was changed.',
    )
  }
  if (
    'retiredPath' in value &&
    !isRetiredPath(value.retiredPath, path, targetPath)
  ) {
    throw new Error(
      'Cursor skill pending private retention path is invalid; no skill file was changed.',
    )
  }
  if ('previous' in value && value.previous !== undefined)
    parseReceipt(value.previous, targetPath)
  return value as PendingSkill
}

/** Validates interrupted removal coordinates before {@link deployCursorSkill} or cleanup recovers. @param path - Pending removal journal. @param targetPath - Expected skill path. @returns A validated pending removal, or undefined. @example await readPendingRemoval('/private/removal.json', '/home/user/.cursor/skills/codebook/SKILL.md') // => undefined when absent */
async function readPendingRemoval(
  path: string,
  targetPath: string,
): Promise<PendingRemoval | undefined> {
  const bytes = await regularFile(path)
  if (!bytes) return undefined
  const value: unknown = JSON.parse(bytes.toString('utf8'))
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
    throw new Error(
      'Cursor skill pending removal record is invalid; no skill file was changed.',
    )
  parseReceipt(value.owner, targetPath)
  return value as PendingRemoval
}

/** Rechecks a receipted skill during setup or recovery without trusting a volume device number that can change after restart. @param path - Exact managed skill path. @param owner - Recorded inode and bytes. @returns Whether the same regular file still has its recorded identity and content. @example await matchesOwnedFile('/home/.cursor/skills/codebook/SKILL.md', receipt) */
async function matchesOwnedFile(
  path: string,
  owner: Pick<SkillReceipt, 'skillSha256' | 'inode'>,
): Promise<boolean> {
  const status = await inspectedPath(path)
  if (
    !status?.isFile() ||
    status.isSymbolicLink() ||
    status.ino !== owner.inode
  )
    return false
  const bytes = await readFile(path)
  return (
    sha256(bytes) === owner.skillSha256 &&
    (await lstat(path)).ino === status.ino
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

/** Retains the actual displaced skill during {@link deployCursorSkill} recovery, then checks its bytes. @param path - Displaced live path. @param retiredPath - Private retention path. @param owner - Prior owner receipt. @returns After the displacement is safely retained. @example await retireDisplaced('/home/user/.cursor/skills/codebook/.codebook-displaced-id.tmp', '/private/retired-id.SKILL.md', receipt) // => resolves */
async function retireDisplaced(
  path: string,
  retiredPath: string,
  owner: SkillReceipt,
): Promise<void> {
  const displaced = await inspectedPath(path),
    retired = await inspectedPath(retiredPath)
  if (displaced && retired)
    throw new Error(
      'Cursor skill displacement and private retention both exist; Codebook preserved both for inspection.',
    )
  // Moving the actual file preserves a concurrent edit or replacement instead of unlinking it after an earlier check.
  if (displaced) await rename(path, retiredPath)
  if (
    (await inspectedPath(retiredPath)) &&
    !(await matchesOwnedFile(retiredPath, owner))
  )
    throw new Error(
      'The displaced Cursor skill changed; Codebook retained its actual bytes privately for recovery.',
    )
}

/** Completes a pending displacement before {@link deployCursorSkill} publishes another body. @param pending - Validated setup journal. @returns After prior bytes are retained. @example await removeOwnedDisplacement(pending) // => resolves */
async function removeOwnedDisplacement(pending: PendingSkill): Promise<void> {
  if (!pending.displacedPath) return
  if (!pending.previous || !pending.retiredPath)
    throw new Error(
      'Cursor skill displacement has no complete recovery record.',
    )
  await retireDisplaced(
    pending.displacedPath,
    pending.retiredPath,
    pending.previous,
  )
}

/** Finishes or rejects an interrupted skill removal before {@link deployCursorSkill} reuses its receipt. @param path - Removal journal. @param receiptPath - Owner receipt path. @param targetPath - Managed skill path. @returns The recovered owner and completion flag, or undefined. @example await recoverRemoval('/private/removal.json', '/private/receipt.json', '/home/user/.cursor/skills/codebook/SKILL.md') // => undefined when absent */
async function recoverRemoval(
  path: string,
  receiptPath: string,
  targetPath: string,
): Promise<{ owner: SkillReceipt; completed: boolean } | undefined> {
  const pending = await readPendingRemoval(path, targetPath)
  if (!pending) return undefined
  const target = await inspectedPath(targetPath),
    displaced = await inspectedPath(pending.displacedPath)
  if (target && !(await matchesOwnedFile(targetPath, pending.owner)))
    throw new Error(
      'Cursor skill changed during interrupted removal; Codebook preserved it and the displaced file.',
    )
  if (
    displaced &&
    !(await matchesOwnedFile(pending.displacedPath, pending.owner))
  )
    throw new Error(
      'The displaced Cursor skill changed during removal; Codebook preserved it and its recovery record.',
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
    )
  } else if (!target && !displaced) {
    const receipt = await readReceipt(receiptPath, targetPath)
    if (receipt?.installed)
      throw new Error(
        'Removed Cursor skill is missing before its receipt was updated; Codebook preserved the recovery record.',
      )
    await retireDisplaced(
      pending.displacedPath,
      pending.retiredPath,
      pending.owner,
    )
  } else if (displaced)
    await retireDisplaced(
      pending.displacedPath,
      pending.retiredPath,
      pending.owner,
    )
  await unlink(path)
  return { owner: pending.owner, completed: !target }
}

/** Binds the installed publisher path into Cursor's owned skill when {@link deployCursorSkill} starts setup. @param extensionPath - Installed VSIX root. @returns Deployable bytes, version and digest. @example await packageSkill('/extensions/laststance.codebook-0.2.3') // => { bytes, version, sha256 } */
async function packageSkill(
  extensionPath: string,
): Promise<{ bytes: Buffer; version: string; sha256: string }> {
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
  return { bytes, version, sha256: sha256(bytes) }
}

/**
 * Reads the receipt and the deployed skill once and says how they stand to this installation, for {@link verifyManagedCursorSkill}: first without the lock, then again under it inside {@link deploySkill}.
 *
 * @param receiptPath - The private owner receipt.
 * @param targetPath - The managed skill file in Cursor's user skills.
 * @param packagedSha256 - Digest of the skill this installation packages.
 * @returns
 * - `changed`: no installed receipt, or the file is missing, replaced (another inode) or edited (other bytes)
 * - `current`: the receipted, unedited file holds this installation's bytes
 * - `newer`: the receipted, unedited file was deployed by a later extension version than the running one
 * - `outdated`: the receipted, unedited file was deployed by this or an earlier version and holds other bytes
 * @throws When the skill path is no regular file, or a read fails for another reason than a missing file.
 * @example await inspectManagedSkill('/private/cursor-skill/receipt.json', '/home/user/.cursor/skills/codebook/SKILL.md', packaged.sha256) // => { kind: 'current', receipt }
 */
async function inspectManagedSkill(
  receiptPath: string,
  targetPath: string,
  packagedSha256: string,
): Promise<ManagedSkillState> {
  const receipt = await readReceipt(receiptPath, targetPath)
  // A file another window replaces right now can vanish between two reads; that is a missing file, not a failed read.
  const current = await regularFile(targetPath).catch((error: unknown) => {
    if (isMissing(error)) return undefined
    throw error
  })
  const currentStatus = current ? await inspectedPath(targetPath) : undefined
  if (
    !receipt?.installed ||
    !current ||
    !currentStatus ||
    currentStatus.ino !== receipt.inode ||
    sha256(current) !== receipt.skillSha256
  )
    return { kind: 'changed' }
  if (receipt.skillSha256 === packagedSha256)
    return { kind: 'current', receipt }
  return {
    kind: isNewerExtensionVersion(receipt.extensionVersion, EXTENSION_VERSION)
      ? 'newer'
      : 'outdated',
    receipt,
  }
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
 * @param entry - `setup` installs, updates or restores as the learner asked; `reconnect` only updates the receipted, unedited skill of this or an earlier extension version.
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
    await recoverRemoval(removalPath, receiptPath, targetPath)
    let receipt = await readReceipt(receiptPath, targetPath)
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
        }
        await atomicPrivateWrite(
          receiptPath,
          receipt,
          CURSOR_SKILL_RECEIPT_LIMIT_BYTES,
        )
        await removeOwnedDisplacement(pending)
      } else if (
        (pending.previous &&
          (await matchesOwnedFile(targetPath, pending.previous))) ||
        (receipt?.installed && (await matchesOwnedFile(targetPath, receipt)))
      ) {
        // Publication never happened; retain the previous exact owner or the absent first-install target.
        await removeOwnedDisplacement(pending)
      } else if (
        !(await inspectedPath(targetPath)) &&
        pending.previous &&
        pending.displacedPath &&
        (await matchesOwnedFile(pending.displacedPath, pending.previous))
      ) {
        // A crash after displacement left the owned prior body intact; restore it without overwriting new content.
        await link(pending.displacedPath, targetPath)
        await removeOwnedDisplacement(pending)
      } else if (
        !receipt?.installed &&
        !(await inspectedPath(targetPath)) &&
        !pending.displacedPath
      ) {
        // The first-install target was never published.
      } else
        throw new Error(
          'Cursor skill changed during an interrupted setup; Codebook preserved it and its recovery record.',
        )
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
    const current = await regularFile(targetPath)
    if (!receipt && current)
      throw new Error(
        'An existing codebook skill is not owned by this installation; no file was changed.',
      )
    if (receipt && current) {
      const status = await lstat(targetPath)
      if (status.ino !== receipt.inode)
        throw new Error(
          'The managed Cursor skill was replaced after setup; Codebook preserved it.',
        )
    }
    if (receipt && current && sha256(current) !== receipt.skillSha256)
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
        const stagedBackup = await writeStagedBytes(receiptDirectory, current)
        try {
          await link(stagedBackup, backupPath)
        } finally {
          await unlink(stagedBackup)
        }
      }
      if (
        sha256((await regularFile(targetPath)) ?? Buffer.alloc(0)) !==
        receipt.skillSha256
      )
        throw new Error(
          'The Cursor skill changed during setup; no replacement was made.',
        )
    }
    await ensureDirectory(targetDirectory)
    const retiredDirectory =
      (await lstat(receiptDirectory)).dev === (await lstat(targetDirectory)).dev
        ? receiptDirectory
        : targetDirectory
    const stagedPath = await writeStagedBytes(skillParent, packaged.bytes),
      stagedStatus = await lstat(stagedPath)
    const next: PendingSkill = {
      schemaVersion: 1,
      targetPath,
      stagedPath,
      skillSha256: packaged.sha256,
      skillVersion: packaged.version,
      extensionVersion: EXTENSION_VERSION,
      device: stagedStatus.dev,
      inode: stagedStatus.ino,
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
    if (current && receipt && !(await matchesOwnedFile(targetPath, receipt)))
      throw new Error(
        'The Cursor skill changed during setup; Codebook preserved it.',
      )
    if (current && receipt && next.displacedPath) {
      await rename(targetPath, next.displacedPath)
      if (!(await matchesOwnedFile(next.displacedPath, receipt))) {
        await link(next.displacedPath, targetPath).catch(() => undefined)
        throw new Error(
          'The Cursor skill changed during setup; Codebook preserved the displaced file and recovery record.',
        )
      }
    }
    await link(stagedPath, targetPath)
    if (!(await matchesOwnedFile(targetPath, next)))
      throw new Error(
        'The published Cursor skill changed during setup; Codebook preserved its recovery record.',
      )
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
      },
      CURSOR_SKILL_RECEIPT_LIMIT_BYTES,
    )
    await removeOwnedStage(next)
    await removeOwnedDisplacement(next)
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
 * Checks a prior Cursor setup before reconnecting on editor restart. A skill that is missing, replaced or edited is never repaired implicitly; the receipted, unedited skill of this or an earlier extension version is updated to this installation's bytes through {@link deploySkill}, and the skill a newer window deployed is left as it is.
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
    try {
      // An outdated skill is updated and a mismatch is confirmed under the lock, where no other window's update is half done.
      return await deploySkill(
        extensionPath,
        storageRoot,
        homeRoot,
        'reconnect',
      )
    } catch (error) {
      // The cause is read by its shape: the lock's refusal carries the `EEXIST` of the lock file.
      const isLockHeldElsewhere =
        typeof error === 'object' &&
        error !== null &&
        'cause' in error &&
        systemErrorCode(error.cause) === 'EEXIST'
      if (!isLockHeldElsewhere || attempt >= CURSOR_SKILL_RECONNECT_ATTEMPTS)
        throw error
      // The other window's update leaves the receipt current; the next look then needs no lock.
      await delay(CURSOR_SKILL_RECONNECT_RETRY_DELAY_MS)
    }
  }
}

/** Removes only the exact receipted Cursor skill after an explicit user command; setup can restore it later. @example await removeManagedCursorSkill('/private', '/home') */
export async function removeManagedCursorSkill(
  storageRoot: string,
  homeRoot = homedir(),
): Promise<CursorSkillResult> {
  const targetPath = join(homeRoot, '.cursor', 'skills', 'codebook', 'SKILL.md')
  const receiptDirectory = join(storageRoot, 'cursor-skill'),
    receiptPath = join(receiptDirectory, 'receipt.json'),
    removalPath = join(receiptDirectory, 'removal.json')
  return withStorageLock(receiptDirectory, async () => {
    const directory = join(homeRoot, '.cursor', 'skills', 'codebook')
    for (const path of [
      join(homeRoot, '.cursor'),
      join(homeRoot, '.cursor', 'skills'),
    ]) {
      const status = await inspectedPath(path)
      if (!status?.isDirectory() || status.isSymbolicLink())
        throw new Error(
          `Codebook will not follow a missing or redirected skill directory: ${path}`,
        )
    }
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
    const recovered = await recoverRemoval(removalPath, receiptPath, targetPath)
    if (recovered?.completed)
      return {
        status: 'removed',
        path: targetPath,
        sha256: recovered.owner.skillSha256,
        version: recovered.owner.skillVersion,
      }
    await assertSkillParents(homeRoot)
    const receipt = await readReceipt(receiptPath, targetPath),
      current = await regularFile(targetPath)
    if (!receipt?.installed || !current)
      throw new Error(
        'No installed Codebook-owned Cursor skill was found; no file was changed.',
      )
    const status = await lstat(targetPath)
    if (status.ino !== receipt.inode)
      throw new Error(
        'The Cursor skill was replaced after setup; Codebook preserved it.',
      )
    if (sha256(current) !== receipt.skillSha256)
      throw new Error(
        'The Cursor skill was edited after setup; Codebook preserved it.',
      )
    const retiredDirectory =
      (await lstat(receiptDirectory)).dev === (await lstat(directory)).dev
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
      await link(displacedPath, targetPath).catch(() => undefined)
      throw new Error(
        'The Cursor skill changed during removal; Codebook preserved the displaced file and recovery record.',
      )
    }
    await atomicPrivateWrite(
      receiptPath,
      { ...receipt, installed: false },
      CURSOR_SKILL_RECEIPT_LIMIT_BYTES,
    )
    await retireDisplaced(displacedPath, retiredPath, receipt)
    // Remove only an empty Codebook directory; leave any user-added files in place.
    await rmdir(directory).catch((error) => {
      if (!['ENOTEMPTY', 'EEXIST', 'ENOENT'].includes(error.code)) throw error
    })
    await unlink(removalPath)
    return {
      status: 'removed',
      path: targetPath,
      sha256: receipt.skillSha256,
      version: receipt.skillVersion,
    }
  })
}
