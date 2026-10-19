import { randomUUID } from 'node:crypto'
import { lstat, open, readdir, rename, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

import {
  WIKI_METADATA_FILE_LIMIT_BYTES,
  WIKI_UPDATE_MARKER_CLAIM_ATTEMPTS,
  WIKI_UPDATE_MARKER_CLAIM_DIRECTORY_MODE,
  WIKI_UPDATE_MARKER_CLAIM_EXPIRY_MS,
  WIKI_UPDATE_MARKER_CLAIM_RETRY_DELAY_MS,
  WIKI_UPDATE_MARKER_FILE_MODE,
  WIKI_UPDATE_MARKER_STAMP_STEP_MS,
  WIKI_UPDATE_RUN_MARKER_SUFFIX,
} from '../constants'

import { canJudgeOwnerHere } from './canJudgeOwnerHere'
import {
  claimStorageLockTakeover,
  type StorageLockTakeoverClaim,
} from './claimStorageLockTakeover'
import { currentStorageOwner } from './currentStorageOwner'
import { isFolderOfItsOwn } from './isFolderOfItsOwn'
import { listPlacedClaims } from './listPlacedClaims'
import { placeStorageLock } from './placeStorageLock'
import { PREPARED_LOCK_SUFFIX } from './preparedLockSuffix'
import {
  readLiveWikiUpdateMarker,
  type WikiUpdateMarker,
  type WikiUpdateMarkerBeingWritten,
  type WikiUpdateMarkerJudgement,
  type WikiUpdateMarkerLook,
} from './readLiveWikiUpdateMarker'
import { readProcessStart, type ProcessStartReader } from './readProcessStart'
import {
  readRecordedOwner,
  type RecordedOwner,
  type StorageOwnerIdentity,
} from './readRecordedOwner'
import { readWikiRegularFile } from './readWikiRegularFile'
import { removeWithoutFollowing } from './removeWithoutFollowing'
import { systemErrorCode } from './systemErrorCode'
import { withoutBootTime } from './withoutBootTime'

/** A marker that is in the way at the moment another window removes or replaces it under its claim: it is no run that holds the Wiki, and this window may not remove it either. @example const inChange: WikiUpdateMarkerInChange = { isMarkerInChange: true } */
type WikiUpdateMarkerInChange = { isMarkerInChange: true }

/** What holds the Wiki against a start: another window's running update, a marker another window is writing at this moment or a marker file that cannot be read, or a marker another window is removing or replacing at this moment. */
type WikiUpdateHolder =
  WikiUpdateMarker | WikiUpdateMarkerBeingWritten | WikiUpdateMarkerInChange

/** The claimed marker of this window's run (`release` removes it when the run ends; `reserve` turns it into the reservation of a stopped watch, which other windows read until the watch bound; each answers `false` while this run's marker stayed as it was because the claim on it could not be had or the marker could not be read, and may be asked again), or what holds the Wiki instead: the marker of the other window's run, the time since which another window is writing its marker (with the marker file's path and its last counting moment when that file cannot be read), or the note that another window is changing the marker. */
export type WikiUpdateMarkerClaim =
  | {
      release: () => Promise<boolean>
      reserve: (watchEndedAtMs: number) => Promise<boolean>
    }
  | { heldBy: WikiUpdateHolder }

/** What a claim judges the markers and the claims of other windows by; each is the real one unless a test names its own: this process's identity ({@link currentStorageOwner}), {@link readProcessStart} and the wall clock (epoch milliseconds). */
export type WikiUpdateMarkerClaimInputs = {
  identity?: StorageOwnerIdentity
  readStart?: ProcessStartReader
  now?: () => number
}

/** The inputs of one step of a claim with every default filled in ({@link judgementFrom}). */
type MarkerClaimJudgement = Required<WikiUpdateMarkerClaimInputs>

/** Why the clock of the file system beside the marker could not be read ({@link readFileSystemClockLag}): `no-probe` when no file can be created there at all, `probe-unread` when the file was created but its time could not be read. */
type FileSystemClockUnread = 'no-probe' | 'probe-unread'

/** What one sweep of the entries beside the marker judges their age by: the inputs of the claim and the present by the clock of the file system that holds them, this window's present less how far that clock runs behind, which is measured once for the sweep when an entry needs it ({@link readFileSystemClockLag}), or why that clock could not be read. */
type MarkerSweepJudgement = MarkerClaimJudgement & {
  fileSystemNow: () => Promise<number | FileSystemClockUnread>
}

/**
 * Fills in what a claim was not handed; called by {@link claimWikiUpdateMarker} when the claim begins and again by its `release` and `reserve`, which run minutes later.
 * @param inputs - What the caller or a test named.
 * @returns The identity of this process as it is now, the reader of process starts and the clock.
 * @example
 * await judgementFrom({}) // => { identity: await currentStorageOwner(), readStart: readProcessStart, now: Date.now }
 */
async function judgementFrom(
  inputs: WikiUpdateMarkerClaimInputs,
): Promise<MarkerClaimJudgement> {
  return {
    identity: inputs.identity ?? (await currentStorageOwner()),
    readStart: inputs.readStart ?? readProcessStart,
    now: inputs.now ?? Date.now,
  }
}

/**
 * Gives a look at the marker what the claim judges by, with the clock read now; called by {@link claimWikiUpdateMarker} and {@link removeUnownedMarker} for each of their looks.
 * @param judgement - The identity of this process, the reader of process starts and the clock.
 * @returns The same identity and reader with the present (epoch milliseconds).
 * @example
 * atThisMoment({ identity, readStart: readProcessStart, now: () => 1_790_000_000_000 }) // => { identity, readStart: readProcessStart, nowMs: 1_790_000_000_000 }
 */
function atThisMoment({
  identity,
  readStart,
  now,
}: MarkerClaimJudgement): WikiUpdateMarkerJudgement {
  return { identity, readStart, nowMs: now() }
}

/**
 * Names this process's machine and process as a file in a learner's project folder may: by the two pseudonyms of the machine, the kernel's boot id and the process start, never by the host name or the editor's machine id, which a commit of the folder would publish; called by {@link claimWikiUpdateMarker} for the marker's record and by {@link tryMarkerClaim} for the claim's.
 * @param identity - The identity of this process.
 * @returns `machineKey`, `hostKey`, `boot` only when it is a boot id ({@link withoutBootTime}), and `processStart`.
 * @example
 * machineAndProcessOf({ hostname: 'workstation', machineId: 'machine-a', machineKey: 'f9c8c7ddcf3d5f56', hostKey: 'd195d36bd79da7df', boot: { id: '0c1d…' }, processStart: 'linux:16362446' })
 * // => { machineKey: 'f9c8c7ddcf3d5f56', hostKey: 'd195d36bd79da7df', boot: { id: '0c1d…' }, processStart: 'linux:16362446' }
 */
function machineAndProcessOf(
  identity: StorageOwnerIdentity,
): Pick<RecordedOwner, 'machineKey' | 'hostKey' | 'boot' | 'processStart'> {
  const { machineKey, hostKey, boot, processStart } = withoutBootTime(identity)
  return { machineKey, hostKey, boot, processStart }
}

/**
 * Lets only the failure "a marker file is already there" pass; called by {@link claimWikiUpdateMarker} with what its exclusive creation threw, before it looks at the marker in the way.
 * @param error - What the exclusive creation threw.
 * @throws The given error itself when its code is not `EEXIST` (for example a read-only folder).
 * @example
 * rethrowUnlessMarkerExists(Object.assign(new Error('file already exists'), { code: 'EEXIST' })) // returns, the marker in the way is looked at next
 */
function rethrowUnlessMarkerExists(error: unknown): void {
  if (systemErrorCode(error) !== 'EEXIST') throw error
}

/**
 * Names what a look found that holds the Wiki against this start; called by {@link claimOfHolder} for the look before a removal.
 * @param look - What {@link readLiveWikiUpdateMarker} answered.
 * @returns The live marker of another window's run, or what a `being-written` look holds: a marker another window is writing at this moment, or a marker file that cannot be read, with its path and the last moment it counts once it stayed unreadable past a write's time or is dated ahead of the clock ({@link readLiveWikiUpdateMarker}); `undefined` for no marker, for one that is nobody's and for a stopped watch's reservation, which the start check has let this start pass (its bound is over, a publish since the watch's end ended the wait for its chat, or the learner chose to go on).
 * @example
 * holderIn({ kind: 'live', heldBy: { pid: 4242, windowId: '3f6c', host: 'vscode', startedAtMs: 1790000000000 } })                                // => that marker
 * holderIn({ kind: 'live', heldBy: { pid: 4242, windowId: '3f6c', host: 'vscode', startedAtMs: 1790000000000, watchEndedAtMs: 1790000060000 } }) // => undefined
 */
function holderIn(look: WikiUpdateMarkerLook): WikiUpdateHolder | undefined {
  if (look.kind === 'being-written') return look.heldBy
  return look.kind === 'live' && look.heldBy.watchEndedAtMs === undefined
    ? look.heldBy
    : undefined
}

/**
 * Says whether a look read a marker file that is there and is nobody's run, the only thing a start may remove; called by {@link removeUnownedMarker} for its look under the claim.
 * @param look - What {@link readLiveWikiUpdateMarker} answered.
 * @returns `true` for an unowned marker and for a stopped watch's reservation; `false` for a live run, for a marker being written and for no marker at all: where the look found none, another window may have written its own since.
 * @example
 * isMarkerOfNobodysRun({ kind: 'unowned' }) // => true
 * isMarkerOfNobodysRun({ kind: 'none' })    // => false
 */
function isMarkerOfNobodysRun(look: WikiUpdateMarkerLook): boolean {
  return (
    look.kind === 'unowned' ||
    (look.kind === 'live' && look.heldBy.watchEndedAtMs !== undefined)
  )
}

/**
 * Decides what the marker in the way means for this claim; called by {@link claimWikiUpdateMarker} with what {@link readLiveWikiUpdateMarker} has just found, before it removes a marker that is nobody's.
 * Why the last answer: a marker that nobody's run owns and that is still in the way after this start's one removal was not removed because another window holds the claim on it: it is removing a stale marker for its own start, or removing or replacing its own marker at the end of its run. That is an ordinary moment between two windows, so the start is refused in a sentence and not ended with the file system's error of the creation.
 * @param look - What the look at the marker in the way found.
 * @param isLastAttempt - Whether the creation was already tried again after a removal; a marker still in the way then is not removed a second time.
 * @returns
 * - Another window's run is live, or another window is writing its marker: the claim that names it, and the marker file stays
 * - Anything else, with one attempt left: `undefined`, so the caller removes a marker that is nobody's and creates its own once more
 * - Anything else on the last attempt: the claim that says another window is changing the marker
 * @example
 * claimOfHolder({ kind: 'live', heldBy: { pid: 4242, windowId: '3f6c', host: 'vscode', startedAtMs: 1790000000000 } }, false)
 * // => { heldBy: { pid: 4242, windowId: '3f6c', host: 'vscode', startedAtMs: 1790000000000 } }
 * claimOfHolder({ kind: 'unowned' }, false) // => undefined
 * claimOfHolder({ kind: 'unowned' }, true)  // => { heldBy: { isMarkerInChange: true } }
 */
function claimOfHolder(
  look: WikiUpdateMarkerLook,
  isLastAttempt: boolean,
): Extract<WikiUpdateMarkerClaim, { heldBy: WikiUpdateHolder }> | undefined {
  const heldBy = holderIn(look)
  if (heldBy) return { heldBy }
  return isLastAttempt ? { heldBy: { isMarkerInChange: true } } : undefined
}

/** What one read of the marker file under the claim found: the file's text, `missing` when nothing is at its path, `foreign` when an entry is there that cannot hold what this window wrote, or `unreadable` when a regular file is there that this read could not take as the marker. */
type MarkerTextRead = { text: string } | 'missing' | 'foreign' | 'unreadable'

/**
 * Reads what the marker file holds right now; called by {@link changeOwnMarker} under the claim, before this window's marker is removed or replaced.
 *
 * Why: a marker that is gone or holds another window's text leaves this window nothing to change, but a marker that could not be read at this moment may still be this window's, and its change must be asked for again. {@link readWikiRegularFile} answers `undefined` for a missing file, for an entry that is no regular file within its limit and for a file it could not read (on Windows a scanner or an indexer can hold the file open, so its open fails with `EBUSY` or `EPERM`), so a look at the path that does not follow it tells them apart. This window wrote a regular file far below {@link WIKI_METADATA_FILE_LIMIT_BYTES}, so only such a file can still be its marker: an entry of another kind or size was put there by someone else, and asking again would never change it.
 *
 * @param markerPath - `<output>.update-run.json`.
 * @returns
 * - A regular file that was read: its text
 * - Nothing at the path (`ENOENT`): `missing`
 * - An entry that is no regular file (a link, a folder), or a regular file larger than {@link WIKI_METADATA_FILE_LIMIT_BYTES}: `foreign`
 * - A regular file within the limit whose open, read or close failed, and a look at the path that failed: `unreadable`
 * @example
 * await readMarkerText('/repo/.codebook/wiki.update-run.json')   // => { text: '{"pid":4242,"windowId":"3f6c","host":"vscode","startedAtMs":1790000000000}' }
 * await readMarkerText('/repo/.codebook/gone.update-run.json')   // => 'missing'
 * await readMarkerText('/repo/.codebook/folder.update-run.json') // => 'foreign'
 */
async function readMarkerText(markerPath: string): Promise<MarkerTextRead> {
  const file = await readWikiRegularFile(markerPath)
  if (file) return { text: file.bytes.toString('utf8') }
  try {
    const entry = await lstat(markerPath)
    // Only a regular file within the read's limit can be what this window wrote; anything else at the path is another's.
    return entry.isFile() && entry.size <= WIKI_METADATA_FILE_LIMIT_BYTES
      ? 'unreadable'
      : 'foreign'
  } catch (error) {
    // Only a path with nothing at it is a marker that is gone; any other failure of the look says nothing about the marker.
    return systemErrorCode(error) === 'ENOENT' ? 'missing' : 'unreadable'
  }
}

/**
 * Reads the owner that an entry beside the marker records, without reading through anything that leads elsewhere; called by {@link isExpiredMarkerClaim} after its look at the entry.
 * Why: a link is no claim and no prepared file, whatever it leads to, so its age alone decides and nothing is read through it. An entry that records its owner itself (a claim file, a prepared marker) is read by {@link readRecordedOwner}, which refuses a link at the path it is handed. A prepared claim folder records its owner in a file below it, and that read guards only its last part: the file is read only below a real directory that is its parent's own entry ({@link isFolderOfItsOwn}), so neither a link at the folder's name nor an entry the look calls a directory although it leads elsewhere has a file behind it opened.
 * @param path - The entry: a claim's owner file, a prepared claim folder or a prepared marker file.
 * @param ownerPath - The file that records the owner of that entry: the entry itself, or a file below a prepared claim folder.
 * @returns The recorded owner; `undefined` for a link, for a folder that leads elsewhere, and for a record that is no regular file or cannot be read.
 * @example
 * await readOwnerOfEntry(claimPath, claimPath) // => { pid: 4242, machineKey: 'f9c8c7ddcf3d5f56', hostKey: 'd195d36bd79da7df', processStart: 'linux:16362446' }
 */
async function readOwnerOfEntry(
  path: string,
  ownerPath: string,
): Promise<RecordedOwner | undefined> {
  const mayBeRead =
    ownerPath === path || (await isFolderOfItsOwn(path).catch(() => false))
  return mayBeRead ? readRecordedOwner(ownerPath) : undefined
}

/**
 * Measures how far the clock that stamps the files beside the marker runs behind this machine's wall clock, by the modification time of an empty file created there now and removed at once; called by {@link removeExpiredMarkerClaims} for its sweep, at most once, when {@link isExpiredMarkerClaim} meets an entry that this window's clock calls expired.
 * Why: a file server, or the Windows host under a WSL2 window, stamps a file by its own clock, which this machine's clock can run minutes ahead of (WSL2 after a sleep), and every entry beside the marker then looks older than it is. A stamp less than {@link WIKI_UPDATE_MARKER_STAMP_STEP_MS} behind is the file system's own rounding, not a clock that lags. The file is named like a prepared marker (`<marker>.pending-<uuid>`) and has no owner, so one that a window killed in this instant left is removed by a later sweep by its age ({@link removeExpiredPreparations}).
 * The time is read through the handle that created the file, before it is closed: another window's sweep removes an empty file beside the marker that its own clock calls old ({@link removeStaleStorageClaims}), and a look at the path after that removal would find nothing, while the handle still names the file.
 * @param markerPath - `<output>.update-run.json`.
 * @returns How many milliseconds the new file's stamp lies before the wall clock right before its creation, or 0 when it lies less than {@link WIKI_UPDATE_MARKER_STAMP_STEP_MS} before or after it; `no-probe` when no file can be created there at all (a full disk, a quota, a read-only folder); `probe-unread` when the file was created but its time could not be read.
 * @example
 * await readFileSystemClockLag('/repo/.codebook/wiki.update-run.json') // => 120_000 on a file server whose clock runs 2 minutes behind
 */
async function readFileSystemClockLag(
  markerPath: string,
): Promise<number | FileSystemClockUnread> {
  const probePath = `${markerPath}${PREPARED_LOCK_SUFFIX}${randomUUID()}`
  const createdAtMs = Date.now()
  const probe = await open(probePath, 'wx', WIKI_UPDATE_MARKER_FILE_MODE).catch(
    () => undefined,
  )
  if (!probe) return 'no-probe'
  const probeStamp = await probe.stat().catch(() => undefined)
  await probe.close().catch(() => undefined)
  await removeWithoutFollowing(probePath).catch(() => undefined)
  if (!probeStamp) return 'probe-unread'
  const lagMs = createdAtMs - probeStamp.mtimeMs
  return lagMs < WIKI_UPDATE_MARKER_STAMP_STEP_MS ? 0 : lagMs
}

/**
 * Says whether a claim on the marker, or a file prepared beside it, is nobody's by its age; called by {@link removeIfExpired} for each entry the sweeps find.
 * Why: a claim is held for the time of one read and one removal, and a prepared file exists for the time of one write, so an old one was left by a killed window. Age decides only where the owner cannot be judged by this process ({@link canJudgeOwnerHere}): an entry of another machine, of another system or pid namespace of this computer, of a Linux window whose pid namespace could not be read, of 0.2.29.0, of a window whose process start could not be read, or one whose record cannot be read. An entry whose owner can be judged here is left to that judgement ({@link removeStaleStorageClaims}), so a live window that was suspended while it held the claim keeps it.
 * These paths lie in the learner's project folder, where a cloned repository can put anything: the entry is looked at without following a link, a link is judged by its age alone, and an owner's record is read only as a regular file of bounded size ({@link readRecordedOwner}), so a link to an endless device or to a pipe costs neither time nor memory.
 * The age is the present minus the time the file system stamped on the entry, and the entry must be older than the expiry both by this window's clock and by the clock that stamped it ({@link readFileSystemClockLag}): a file server, or the Windows host under a WSL2 window, stamps by its own clock, and this window's clock may run minutes ahead of it, so a claim placed a moment ago would look expired by the local clock alone. Where a file was created to read that clock and its time could not be read, the entry stays for a later sweep; only where no file can be created beside the marker at all does this window's clock decide alone, so a claim a killed window left on a full disk does not stay for good.
 * @param path - What age is taken from and what would be removed: a claim's owner file, a claim folder that was prepared and never put into place, or a marker file that was prepared and never linked or moved into place.
 * @param ownerPath - The file that records the owner of that entry.
 * @param judgement - The identity of this process, the clock and the file system's present of the sweep.
 * @returns `true` for an entry that cannot be judged here and is older than {@link WIKI_UPDATE_MARKER_CLAIM_EXPIRY_MS} by this window's clock and by the file system's, or by this window's clock alone where no file can be created beside the marker to read the file system's clock, also a link whatever it leads to; `false` for a younger one, for one whose owner can be judged here, for one whose age by the file system's clock cannot be told because the file created to read it could not be read, and for a path that cannot be inspected.
 * @example
 * await isExpiredMarkerClaim(claimPath, claimPath, judgement) // => true for a claim a killed window of another machine left two minutes ago
 */
async function isExpiredMarkerClaim(
  path: string,
  ownerPath: string,
  { identity, now, fileSystemNow }: MarkerSweepJudgement,
): Promise<boolean> {
  const entry = await lstat(path).catch(() => undefined)
  if (!entry) return false
  const owner = await readOwnerOfEntry(path, ownerPath)
  if (owner && canJudgeOwnerHere(owner, identity)) return false
  if (now() - entry.mtimeMs <= WIKI_UPDATE_MARKER_CLAIM_EXPIRY_MS) return false
  // This window's clock may run ahead of the clock that stamped the entry: the entry must be as old by that clock.
  const fileSystemNowMs = await fileSystemNow()
  // No file can be created beside the marker (a full disk, a read-only folder): this window's clock alone decides, so a killed window's claim does not stay for good.
  if (fileSystemNowMs === 'no-probe') return true
  // A file was created but its time could not be read: that clock is unknown, and the entry stays for a later sweep.
  if (fileSystemNowMs === 'probe-unread') return false
  return fileSystemNowMs - entry.mtimeMs > WIKI_UPDATE_MARKER_CLAIM_EXPIRY_MS
}

/**
 * Removes one claim or prepared entry beside the marker when it is nobody's by its age ({@link isExpiredMarkerClaim}), by its own unique name; called by {@link removeExpiredMarkerClaims} and {@link removeExpiredPreparations}.
 * The removal is Codebook's own walk ({@link removeWithoutFollowing}): a link is unlinked as a name, a prepared claim folder is emptied entry by entry, and nothing below a link is listed, whatever the system answers.
 * @param path - The claim's owner file, the prepared claim folder or the prepared marker file.
 * @param ownerPath - The file that records the owner of that entry.
 * @param judgement - The identity of this process, the clock and the file system's present of the sweep.
 * @returns Nothing; an entry that cannot be removed stays for the next caller.
 * @example
 * await removeIfExpired('/repo/.codebook/wiki.update-run.json.takeover-4f2c', '/repo/.codebook/wiki.update-run.json.takeover-4f2c/4f2c', judgement)
 */
async function removeIfExpired(
  path: string,
  ownerPath: string,
  judgement: MarkerSweepJudgement,
): Promise<void> {
  if (await isExpiredMarkerClaim(path, ownerPath, judgement))
    await removeWithoutFollowing(path).catch(() => undefined)
}

/**
 * Removes what killed windows prepared beside the marker and never put into place, once it is nobody's by its age: a claim folder `<marker>.takeover-<name>`, whose owner file is named like the claim, and a marker or reservation file `<marker>.pending-<name>`, which records its owner itself; called by {@link removeExpiredMarkerClaims}.
 * Why: the sweep of {@link removeStaleStorageClaims} removes such an entry only when its owner is gone from this machine, so one of another machine, or of another system of this computer, would stay in the learner's project folder for good. A window whose prepared marker is removed while it is suspended creates its marker in place instead ({@link placeStorageLock}).
 * @param markerPath - `<output>.update-run.json`.
 * @param judgement - The identity of this process, the clock and the file system's present of the sweep.
 * @returns Nothing; an entry that cannot be removed stays for the next caller.
 * @example
 * await removeExpiredPreparations('/repo/.codebook/wiki.update-run.json', judgement)
 */
async function removeExpiredPreparations(
  markerPath: string,
  judgement: MarkerSweepJudgement,
): Promise<void> {
  const parentDirectory = dirname(markerPath),
    preparedClaimPrefix = `${basename(markerPath)}.takeover-`,
    preparedMarkerPrefix = `${basename(markerPath)}${PREPARED_LOCK_SUFFIX}`
  for (const name of await readdir(parentDirectory).catch(() => [])) {
    const path = join(parentDirectory, name)
    if (name.startsWith(preparedClaimPrefix))
      await removeIfExpired(
        path,
        join(path, name.slice(preparedClaimPrefix.length)),
        judgement,
      )
    else if (name.startsWith(preparedMarkerPrefix))
      await removeIfExpired(path, path, judgement)
  }
}

/**
 * Removes the claims on the marker, and what was prepared beside it, that are nobody's by their age, each by its own unique name; called by {@link tryMarkerClaim} before it asks for the claim.
 *
 * Why: {@link claimStorageLockTakeover} removes a claim whose owner is gone, which it can say only of an owner of this machine. A window of another machine, or of 0.2.29.0, that was killed while it held the claim would keep it for good, and every later start on a stale marker would fail. Such a claim is nobody's once it is older than {@link WIKI_UPDATE_MARKER_CLAIM_EXPIRY_MS}, by this window's clock and by the clock that stamped it ({@link isExpiredMarkerClaim}).
 * The claim folder's path lies in the learner's project folder, where a cloned repository can put a link: only a real directory there is listed, and anything else at that path is removed by its own name ({@link listPlacedClaims}), so the sweep never reaches the files a link leads to.
 *
 * @param markerPath - `<output>.update-run.json`; the claim is one owner file in the folder `<marker>.takeover`.
 * @param judgement - The identity of this process and the clock.
 * @returns Nothing; an entry that cannot be removed stays for the next caller.
 * @example
 * await removeExpiredMarkerClaims('/repo/.codebook/wiki.update-run.json', judgement)
 */
async function removeExpiredMarkerClaims(
  markerPath: string,
  judgement: MarkerClaimJudgement,
): Promise<void> {
  let lagRead: Promise<number | FileSystemClockUnread> | undefined
  // The file system's clock is measured at most once a sweep, and only for an entry this window's clock calls expired.
  const sweep: MarkerSweepJudgement = {
    ...judgement,
    fileSystemNow: async () => {
      const lagMs = await (lagRead ??= readFileSystemClockLag(markerPath))
      return typeof lagMs === 'number' ? judgement.now() - lagMs : lagMs
    },
  }
  const claimDirectory = `${markerPath}.takeover`
  // A placed claim is one owner file inside the claim folder; a link or a file at the folder's path is removed there and never listed.
  for (const claimName of await listPlacedClaims(claimDirectory)) {
    const claimPath = join(claimDirectory, claimName)
    await removeIfExpired(claimPath, claimPath, sweep)
  }
  await removeExpiredPreparations(markerPath, sweep)
}

/**
 * Asks once for the exclusive right to remove or replace the marker file; called by {@link claimMarkerChange} for each of its attempts.
 * The claim file lies in the learner's project folder, so it records this process without the host name and the editor's machine id ({@link machineAndProcessOf}), and the claim is created with the modes of the project's own files, as the marker is: a window of another user on a shared project folder can then judge a claim a killed window left, and clear it where the folder lets it write.
 * @param markerPath - `<output>.update-run.json`.
 * @param judgement - The identity of this process, the reader of process starts and the clock.
 * @returns The claim, or `undefined` while another window holds it and when the claim cannot be made at all (for example a folder that cannot be written).
 * @example
 * const claim = await tryMarkerClaim('/repo/.codebook/wiki.update-run.json', judgement)
 */
async function tryMarkerClaim(
  markerPath: string,
  judgement: MarkerClaimJudgement,
): Promise<StorageLockTakeoverClaim | undefined> {
  try {
    await removeExpiredMarkerClaims(markerPath, judgement)
    // The storage lock's takeover claim, on the marker's path: one uniquely named owner file in `<marker>.takeover`, put there by a rename that succeeds for one window only.
    return await claimStorageLockTakeover(
      markerPath,
      judgement.identity,
      judgement.readStart,
      { pid: process.pid, ...machineAndProcessOf(judgement.identity) },
      {
        directoryMode: WIKI_UPDATE_MARKER_CLAIM_DIRECTORY_MODE,
        fileMode: WIKI_UPDATE_MARKER_FILE_MODE,
      },
    )
  } catch {
    return undefined
  }
}

/**
 * Claims the exclusive right to remove or replace the marker file, so that only one window at a time changes a marker that is there; called by {@link removeUnownedMarker} with one attempt, since a start never waits, and by {@link changeOwnMarker} with a few, since a run's end should not leave its marker behind.
 *
 * Why: a marker file that exists is removed or replaced only under this claim, and a new marker is created only where no file is. A window that holds the claim and has looked at the marker therefore removes exactly the marker it looked at, never one another window wrote since.
 * All attempts share one cache of process starts: the window that holds the claim is asked for its start once, however often its claim is met, and a kept start only ever confirms an owner alive ({@link readProcessStart}).
 *
 * @param markerPath - `<output>.update-run.json`.
 * @param attempts - How often the claim is asked for; between two attempts the caller waits {@link WIKI_UPDATE_MARKER_CLAIM_RETRY_DELAY_MS}.
 * @param judgement - The identity of this process, the reader of process starts and the clock.
 * @returns The claim, or `undefined` when another window held it at every attempt.
 * @example
 * const claim = await claimMarkerChange('/repo/.codebook/wiki.update-run.json', 1, judgement)
 */
async function claimMarkerChange(
  markerPath: string,
  attempts: number,
  judgement: MarkerClaimJudgement,
): Promise<StorageLockTakeoverClaim | undefined> {
  const cache = new Map<number, Promise<string | undefined>>()
  const judgedWithOneCache: MarkerClaimJudgement = {
    ...judgement,
    readStart: (pid, inputs) => judgement.readStart(pid, { ...inputs, cache }),
  }
  for (let attemptsLeft = attempts; attemptsLeft > 0; attemptsLeft -= 1) {
    const claim = await tryMarkerClaim(markerPath, judgedWithOneCache)
    if (claim) return claim
    // Another window is changing the marker right now, which takes it a moment.
    if (attemptsLeft > 1) await delay(WIKI_UPDATE_MARKER_CLAIM_RETRY_DELAY_MS)
  }
  return undefined
}

/**
 * Removes the marker in the way when it is nobody's run, under the exclusive claim and after a look made while the claim is held; called by {@link claimWikiUpdateMarker} before its second exclusive creation.
 *
 * Why: between a window's look at a stale marker and its removal another window can have removed that marker and created its own. Under the claim no other window removes or replaces the marker, and none can create one while a file is there, so a marker that this look read is the marker that is removed. Where the look found no marker at all, nothing is removed: another window may have created its own in that instant.
 * The marker's path lies in the learner's project folder, where a cloned repository can put an entry that is no marker file: a link there is removed as the link and its target stays, and a folder is removed with its content, so no such entry refuses every start ({@link removeWithoutFollowing}). An entry the system does not let this window remove ends the start with the file system's error.
 * A window that was suspended under its claim can have lost it to a window that judged the claim by its age, so the claim is asked for once more right before the removal.
 * Limit: a window suspended in the instant between that check and the removal can still remove a marker another window created since.
 *
 * @param outputDirectory - Resolved Wiki output folder.
 * @param markerPath - `<output>.update-run.json`.
 * @param ownWindowId - The asking window's own id.
 * @param judgement - The identity of this process, the reader of process starts and the clock.
 * @returns Nothing. The marker stays when another window holds the claim (it is removing the marker itself), when the look under the claim finds another window's run, a marker being written or no marker, and when the claim was lost meanwhile; the exclusive creation that follows decides either way.
 * @example
 * await removeUnownedMarker('/repo/.codebook/wiki', '/repo/.codebook/wiki.update-run.json', windowId, judgement)
 */
async function removeUnownedMarker(
  outputDirectory: string,
  markerPath: string,
  ownWindowId: string,
  judgement: MarkerClaimJudgement,
): Promise<void> {
  const claim = await claimMarkerChange(markerPath, 1, judgement)
  if (!claim) return
  try {
    // Another window may have taken the marker over since the look that brought this call; only a marker that this look reads as nobody's run is removed.
    const look = await readLiveWikiUpdateMarker(
      outputDirectory,
      ownWindowId,
      atThisMoment(judgement),
    )
    // What the look read as nobody's is removed whatever it is: a file, a link as the link, a folder with its content.
    if (isMarkerOfNobodysRun(look) && (await claim.isStillHeld()))
      await removeWithoutFollowing(markerPath)
  } finally {
    await claim.release()
  }
}

/**
 * Removes or replaces this window's own marker under the exclusive claim, and only while the file still holds what this window wrote; called by `release` and `reserve` of {@link claimWikiUpdateMarker}.
 *
 * Why: another window may have taken the marker over (a stopped watch's reservation, or a run's marker that outlasted its bound). A check and a removal without the claim are two steps, between which that window's marker could arrive and be removed.
 * A window that was suspended under its claim can have lost it to a window that judged the claim by its age and took the marker over, so the claim is asked for once more right before the change.
 * Limit: a window suspended in the instant between that check and the change can still remove or replace a marker another window created since.
 *
 * @param markerPath - `<output>.update-run.json`.
 * @param ownText - What this window last wrote into the marker file.
 * @param change - The removal or the replacement; it runs while the claim is held.
 * @param judgement - The identity of this process, the reader of process starts and the clock.
 * @returns `true` when the change was made, and when the file was read and no longer holds this window's text (another window took the marker over), is gone, or was replaced by an entry that cannot be this window's marker (a folder, a link, a file larger than any marker), which leaves nothing of this window's to change; `false` when a regular file that may be the marker could not be read at this moment ({@link readMarkerText}), when this window's claim was removed meanwhile, or when the claim could not be had at any of {@link WIKI_UPDATE_MARKER_CLAIM_ATTEMPTS} attempts (another window held it, or the system refused it): the marker then stays as it is, and the same change may be asked for again.
 * @throws What `change` throws; the claim is released first.
 * @example
 * await changeOwnMarker(markerPath, written, () => removeWithoutFollowing(markerPath), judgement) // => true
 */
async function changeOwnMarker(
  markerPath: string,
  ownText: string,
  change: () => Promise<void>,
  judgement: MarkerClaimJudgement,
): Promise<boolean> {
  const claim = await claimMarkerChange(
    markerPath,
    WIKI_UPDATE_MARKER_CLAIM_ATTEMPTS,
    judgement,
  )
  if (!claim) return false
  try {
    const markerText = await readMarkerText(markerPath)
    // A marker that could not be read at this moment may still be this window's: the change is asked for again.
    if (markerText === 'unreadable') return false
    // A marker that is gone, an entry that cannot be this window's marker, or a marker that is no longer this window's text leaves this window nothing to change.
    if (
      markerText === 'missing' ||
      markerText === 'foreign' ||
      markerText.text !== ownText
    )
      return true
    // The claim is this window's only while its claim file is in place.
    if (!(await claim.isStillHeld())) return false
    await change()
    return true
  } finally {
    await claim.release()
  }
}

/**
 * Puts a text into the marker file as one new file; called by `reserve` of {@link claimWikiUpdateMarker}.
 *
 * Why: a write in place empties the file first, so another window that reads at that moment finds no marker, and a write that fails half-way leaves neither the run's marker nor the reservation. The text is written beside the marker and moved over it; {@link changeOwnMarker} runs it under the claim.
 * The file beside the marker is named like a prepared marker (`<marker>.pending-<uuid>`), so one that a window killed between the write and the move left is removed by the sweeps of the next claim: with its owner ({@link removeStaleStorageClaims}), or by its age where its owner cannot be judged here ({@link removeExpiredPreparations}).
 *
 * @param markerPath - `<output>.update-run.json`.
 * @param text - The marker's new content.
 * @throws The file system's error when the text cannot be written or moved; the marker file then still holds what it held.
 * @example
 * await replaceMarker('/repo/.codebook/wiki.update-run.json', '{"pid":4242,…,"watchEndedAtMs":1790000900000}')
 */
async function replaceMarker(markerPath: string, text: string): Promise<void> {
  const besidePath = `${markerPath}${PREPARED_LOCK_SUFFIX}${randomUUID()}`
  try {
    await writeFile(besidePath, text, {
      mode: WIKI_UPDATE_MARKER_FILE_MODE,
      flag: 'wx',
    })
    await rename(besidePath, markerPath)
  } catch (error) {
    await removeWithoutFollowing(besidePath).catch(() => undefined)
    throw error
  }
}

/**
 * Creates this window's marker beside the Wiki when a run begins, exclusively, so that of the windows that start at the same moment only one runs.
 *
 * Why: a look at the marker and the start of a run are two steps; only an exclusive creation decides a race between windows. The marker is written beside its path and linked into place ({@link placeStorageLock}), so it never exists without its content, and it records its owner by the machine's pseudonyms, the kernel's boot id and the process start, never by the host name or the editor's machine id. A marker in the way that no live window's run owns (a killed editor's, this window's own from a run that already ended, or the reservation of a stopped watch, which the start check has let pass) is removed and the creation is tried once more. A marker file that exists is removed or replaced only under an exclusive claim ({@link claimMarkerChange}, the storage lock's takeover claim on the marker's path) and after a look made under it, so no window removes a marker another window created since its look.
 * Trigger: the extension calls it right before a run begins and calls `release` when the run has ended.
 * Limits: on a file system that cannot link, the marker is created in place and is empty for the time of one write, which the grace of {@link readLiveWikiUpdateMarker} narrows without closing. A window of 0.2.29.0 on the same project folder creates and judges markers and claims as that build does (a marker created in place, a process id probed alone, a claim removed after {@link WIKI_UPDATE_MARKER_CLAIM_EXPIRY_MS}), so the guarantees beside it are that build's.
 *
 * @param outputDirectory - Resolved Wiki output folder; the marker is `<output>.update-run.json`.
 * @param marker - This window's process id, window id, host and the run's start; the claim adds how this process names its machine and itself ({@link machineAndProcessOf}).
 * @param inputs - What other windows' markers and claims are judged by; the real identity, reader and clock unless a test names its own.
 * @returns
 * - The marker was created: `release`, which removes it, and `reserve`, which replaces it by a stopped watch's reservation; both leave a marker another window has written since, and a reservation that cannot be written leaves the run's marker, which `release` still removes. Each answers `true` once nothing of this run is left to change, and `false` while the claim on the marker could not be had or the marker could not be read, so the caller may ask again ({@link changeOwnMarker})
 * - Another window's live run holds the Wiki, or another window is writing its marker at this moment: `heldBy` with that marker, or with the time since which it is being written
 * - A marker that is nobody's run is still in the way at the second attempt, because another window holds the claim on it (it is removing a stale marker or releasing its own at that moment, or a killed window of another machine left its claim less than {@link WIKI_UPDATE_MARKER_CLAIM_EXPIRY_MS} ago): `heldBy` with `isMarkerInChange`, and the marker file stays
 * @throws The file system's error when the marker cannot be created for another reason than a marker in the way (for example a read-only folder).
 *
 * @example
 * ```ts
 * const claim = await claimWikiUpdateMarker('/repo/.codebook/wiki', { pid: process.pid, windowId, host: 'vscode', startedAtMs: Date.now() })
 * if ('release' in claim) await claim.release()
 * ```
 */
export async function claimWikiUpdateMarker(
  outputDirectory: string,
  marker: WikiUpdateMarker,
  inputs: WikiUpdateMarkerClaimInputs = {},
): Promise<WikiUpdateMarkerClaim> {
  const markerPath = outputDirectory + WIKI_UPDATE_RUN_MARKER_SUFFIX
  const judgement = await judgementFrom(inputs)
  const record = { ...marker, ...machineAndProcessOf(judgement.identity) }
  /** What this claim last wrote into the marker file; only a file that still holds it is this claim's to remove. */
  let written = JSON.stringify(record)
  // One retry: after a marker that was nobody's was removed the exclusive creation decides again.
  for (const isLastAttempt of [false, true]) {
    try {
      await placeStorageLock(markerPath, record, WIKI_UPDATE_MARKER_FILE_MODE)
      return {
        async release(): Promise<boolean> {
          return changeOwnMarker(
            markerPath,
            written,
            () => removeWithoutFollowing(markerPath),
            await judgementFrom(inputs),
          )
        },
        async reserve(watchEndedAtMs: number): Promise<boolean> {
          const reservation = JSON.stringify({ ...record, watchEndedAtMs })
          return changeOwnMarker(
            markerPath,
            written,
            async () => {
              await replaceMarker(markerPath, reservation)
              // Only a reservation that is on disk is this claim's text; after a failed write the run's marker still is.
              written = reservation
            },
            await judgementFrom(inputs),
          )
        },
      }
    } catch (error) {
      rethrowUnlessMarkerExists(error)
      const look = await readLiveWikiUpdateMarker(
        outputDirectory,
        marker.windowId,
        atThisMoment(judgement),
      )
      // What holds the Wiki ends the claim; a marker that is nobody's run is removed for the one retry.
      const holder = claimOfHolder(look, isLastAttempt)
      if (holder) return holder
      await removeUnownedMarker(
        outputDirectory,
        markerPath,
        marker.windowId,
        judgement,
      )
    }
  }
  throw new Error('The Wiki update marker could not be written.')
}
