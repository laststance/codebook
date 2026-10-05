import { randomUUID } from 'node:crypto'
import { lstat, readdir, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

import {
  WIKI_UPDATE_MARKER_CLAIM_ATTEMPTS,
  WIKI_UPDATE_MARKER_CLAIM_EXPIRY_MS,
  WIKI_UPDATE_MARKER_CLAIM_RETRY_DELAY_MS,
  WIKI_UPDATE_RUN_MARKER_SUFFIX,
} from '../constants'

import { claimStorageLockTakeover } from './claimStorageLockTakeover'
import { currentStorageOwner } from './currentStorageOwner'
import {
  readLiveWikiUpdateMarker,
  type WikiUpdateMarker,
} from './readLiveWikiUpdateMarker'
import { readWikiRegularFile } from './readWikiRegularFile'
import { systemErrorCode } from './systemErrorCode'

/** The claimed marker of this window's run (`release` removes it when the run ends; `reserve` turns it into the reservation of a stopped watch, which other windows read until the watch bound), or the marker of the other window's run that holds the Wiki. */
export type WikiUpdateMarkerClaim =
  | {
      release: () => Promise<void>
      reserve: (watchEndedAtMs: number) => Promise<void>
    }
  | { heldBy: WikiUpdateMarker }

/**
 * Lets only the failure "a marker file is already there" pass; called by {@link claimWikiUpdateMarker} with what its exclusive write threw, before it reads the marker in the way.
 * @param error - What the exclusive write threw.
 * @throws The given error itself when its code is not `EEXIST` (for example a read-only folder).
 * @example
 * rethrowUnlessMarkerExists(Object.assign(new Error('file already exists'), { code: 'EEXIST' })) // returns, the marker in the way is looked at next
 */
function rethrowUnlessMarkerExists(error: unknown): void {
  if (systemErrorCode(error) !== 'EEXIST') throw error
}

/**
 * Says whether a look at the marker found another window's run that holds the Wiki; called by {@link claimOfLiveHolder} for the look before a removal and by {@link removeUnownedMarker} for the look under the claim.
 * @param heldBy - What {@link readLiveWikiUpdateMarker} answered.
 * @returns `true` for a live marker of a run; `false` for no live marker and for a stopped watch's reservation, which the start check has let this start pass (its bound is over, or the learner chose to go on).
 * @example
 * isRunOfAnotherWindow({ pid: 4242, windowId: '3f6c', host: 'vscode', startedAtMs: 1790000000000 })                                // => true
 * isRunOfAnotherWindow({ pid: 4242, windowId: '3f6c', host: 'vscode', startedAtMs: 1790000000000, watchEndedAtMs: 1790000060000 }) // => false
 */
function isRunOfAnotherWindow(heldBy: WikiUpdateMarker | undefined): boolean {
  return heldBy !== undefined && heldBy.watchEndedAtMs === undefined
}

/**
 * Decides what the marker in the way means for this claim; called by {@link claimWikiUpdateMarker} with what {@link readLiveWikiUpdateMarker} has just read, before it removes a stale marker.
 * @param heldBy - Another window's live marker, or `undefined` when the marker in the way is nobody's live run.
 * @param isLastAttempt - Whether the write was already tried again after a removal; a marker still in the way then is not removed a second time.
 * @param error - What the exclusive write threw.
 * @returns
 * - Another window's run is live: the claim that names it, and the marker file stays
 * - A stale marker, or the reservation of a stopped watch, with one attempt left: `undefined`, so the caller removes it and writes once more
 * @throws The given error itself when the marker is in the way again on the last attempt.
 * @example
 * claimOfLiveHolder({ pid: 4242, windowId: '3f6c', host: 'vscode', startedAtMs: 1790000000000 }, false, error)
 * // => { heldBy: { pid: 4242, windowId: '3f6c', host: 'vscode', startedAtMs: 1790000000000 } }
 * claimOfLiveHolder(undefined, false, error) // => undefined
 */
function claimOfLiveHolder(
  heldBy: WikiUpdateMarker | undefined,
  isLastAttempt: boolean,
  error: unknown,
): Extract<WikiUpdateMarkerClaim, { heldBy: WikiUpdateMarker }> | undefined {
  // A live run holds the Wiki. A stopped watch's reservation does not.
  if (heldBy && isRunOfAnotherWindow(heldBy)) return { heldBy }
  if (isLastAttempt) throw error
  return undefined
}

/**
 * Reads what the marker file holds right now; called by {@link changeOwnMarker} under the claim, before this window's marker is removed or replaced.
 * @param markerPath - `<output>.update-run.json`.
 * @returns The file's text, or `undefined` when no regular file is there.
 * @example
 * await readMarkerText('/repo/.codebook/wiki.update-run.json') // => '{"pid":4242,"windowId":"3f6c","host":"vscode","startedAtMs":1790000000000}'
 */
async function readMarkerText(markerPath: string): Promise<string | undefined> {
  return (await readWikiRegularFile(markerPath))?.bytes.toString('utf8')
}

/**
 * Says whether an entry beside the marker was last written longer ago than a claim on the marker can last; called by {@link removeExpiredMarkerClaims} for each claim it finds.
 * @param path - A claim's owner file, or a claim folder that was prepared and never put into place.
 * @returns `true` for an entry older than {@link WIKI_UPDATE_MARKER_CLAIM_EXPIRY_MS}; `false` for a younger one and for a path that cannot be inspected.
 * @example
 * await isExpiredMarkerClaim('/repo/.codebook/wiki.update-run.json.takeover/4f2c…') // => true for a claim a killed window left two minutes ago
 */
async function isExpiredMarkerClaim(path: string): Promise<boolean> {
  const entry = await lstat(path).catch(() => undefined)
  return (
    entry !== undefined &&
    Date.now() - entry.mtimeMs > WIKI_UPDATE_MARKER_CLAIM_EXPIRY_MS
  )
}

/**
 * Removes the claim folders that were prepared beside the marker and never put into place, once they are older than any claim can last; called by {@link removeExpiredMarkerClaims}.
 * @param parentDirectory - The folder the marker file is in.
 * @param claimDirectoryName - The claim folder's name, `<marker file>.takeover`; a prepared claim is a folder `<that name>-<name>`.
 * @returns Nothing; a folder that cannot be removed stays for the next caller.
 * @example
 * await removeExpiredPreparedClaims('/repo/.codebook', 'wiki.update-run.json.takeover')
 */
async function removeExpiredPreparedClaims(
  parentDirectory: string,
  claimDirectoryName: string,
): Promise<void> {
  const preparedNames = (await readdir(parentDirectory).catch(() => [])).filter(
    (name) => name.startsWith(`${claimDirectoryName}-`),
  )
  for (const preparedName of preparedNames) {
    const preparedPath = join(parentDirectory, preparedName)
    if (await isExpiredMarkerClaim(preparedPath))
      await rm(preparedPath, { recursive: true, force: true }).catch(
        () => undefined,
      )
  }
}

/**
 * Removes the claims on the marker that are older than any claim can last, each by its own unique name; called by {@link tryMarkerClaim} before it asks for the claim.
 *
 * Why: {@link claimStorageLockTakeover} removes a claim whose process is gone or was recorded before the last restart. A window that was killed while it held the claim, whose process id went to another process since, would keep the claim for good, and every later start on a stale marker would fail. A claim is held for the time of one read and one removal, so one that is older than {@link WIKI_UPDATE_MARKER_CLAIM_EXPIRY_MS} is nobody's.
 *
 * @param markerPath - `<output>.update-run.json`; the claim is the folder `<marker>.takeover`, and a claim that was prepared and never put into place is a folder `<marker>.takeover-<name>` beside it.
 * @returns Nothing; an entry that cannot be removed stays for the next caller.
 * @example
 * await removeExpiredMarkerClaims('/repo/.codebook/wiki.update-run.json')
 */
async function removeExpiredMarkerClaims(markerPath: string): Promise<void> {
  const claimDirectory = `${markerPath}.takeover`
  // A placed claim is one owner file inside the claim folder.
  for (const claimName of await readdir(claimDirectory).catch(() => [])) {
    const claimPath = join(claimDirectory, claimName)
    if (await isExpiredMarkerClaim(claimPath))
      await unlink(claimPath).catch(() => undefined)
  }
  await removeExpiredPreparedClaims(
    dirname(markerPath),
    basename(claimDirectory),
  )
}

/**
 * Asks once for the exclusive right to remove or replace the marker file; called by {@link claimMarkerChange} for each of its attempts.
 * @param markerPath - `<output>.update-run.json`.
 * @returns The function that releases the claim, or `undefined` while another window holds it and when the claim cannot be made at all (for example a folder that cannot be written).
 * @example
 * const releaseClaim = await tryMarkerClaim('/repo/.codebook/wiki.update-run.json')
 */
async function tryMarkerClaim(
  markerPath: string,
): Promise<(() => Promise<void>) | undefined> {
  try {
    await removeExpiredMarkerClaims(markerPath)
    // The storage lock's takeover claim, on the marker's path: one uniquely named owner file in `<marker>.takeover`, put there by a rename that succeeds for one window only.
    return await claimStorageLockTakeover(
      markerPath,
      await currentStorageOwner(),
    )
  } catch {
    return undefined
  }
}

/**
 * Claims the exclusive right to remove or replace the marker file, so that only one window at a time changes a marker that is there; called by {@link removeUnownedMarker} with one attempt, since a start never waits, and by {@link changeOwnMarker} with a few, since a run's end should not leave its marker behind.
 *
 * Why: a marker file that exists is removed or replaced only under this claim, and a new marker is written only where no file is. A window that holds the claim and has looked at the marker therefore removes exactly the marker it looked at, never one another window wrote since.
 *
 * @param markerPath - `<output>.update-run.json`.
 * @param attempts - How often the claim is asked for; between two attempts the caller waits {@link WIKI_UPDATE_MARKER_CLAIM_RETRY_DELAY_MS}.
 * @returns The function that releases the claim, or `undefined` when another window held it at every attempt.
 * @example
 * const releaseClaim = await claimMarkerChange('/repo/.codebook/wiki.update-run.json', 1)
 */
async function claimMarkerChange(
  markerPath: string,
  attempts: number,
): Promise<(() => Promise<void>) | undefined> {
  for (let attemptsLeft = attempts; attemptsLeft > 0; attemptsLeft -= 1) {
    const releaseClaim = await tryMarkerClaim(markerPath)
    if (releaseClaim) return releaseClaim
    // Another window is changing the marker right now, which takes it a moment.
    if (attemptsLeft > 1) await delay(WIKI_UPDATE_MARKER_CLAIM_RETRY_DELAY_MS)
  }
  return undefined
}

/**
 * Removes the marker in the way when it is nobody's live run, under the exclusive claim and after a look made while the claim is held; called by {@link claimWikiUpdateMarker} before its second exclusive write.
 *
 * Why: between a window's look at a stale marker and its removal another window can have removed that marker and written its own. Under the claim no other window removes or replaces the marker, and none can write one while a file is there, so the marker that is looked at here is the marker that is removed.
 *
 * @param outputDirectory - Resolved Wiki output folder.
 * @param markerPath - `<output>.update-run.json`.
 * @param ownWindowId - The asking window's own id.
 * @returns Nothing. The marker stays when another window holds the claim (it is removing the marker itself) and when the look under the claim finds another window's run; the exclusive write that follows decides either way.
 * @example
 * await removeUnownedMarker('/repo/.codebook/wiki', '/repo/.codebook/wiki.update-run.json', windowId)
 */
async function removeUnownedMarker(
  outputDirectory: string,
  markerPath: string,
  ownWindowId: string,
): Promise<void> {
  const releaseClaim = await claimMarkerChange(markerPath, 1)
  if (!releaseClaim) return
  try {
    // Another window may have taken the marker over since the look that brought this call; only a marker that is still nobody's run is removed.
    const heldBy = await readLiveWikiUpdateMarker(outputDirectory, ownWindowId)
    if (!isRunOfAnotherWindow(heldBy)) await rm(markerPath, { force: true })
  } finally {
    await releaseClaim()
  }
}

/**
 * Removes or replaces this window's own marker under the exclusive claim, and only while the file still holds what this window wrote; called by `release` and `reserve` of {@link claimWikiUpdateMarker}.
 *
 * Why: another window may have taken the marker over (a stopped watch's reservation, or a run's marker that outlasted its bound). A check and a removal without the claim are two steps, between which that window's marker could arrive and be removed.
 *
 * @param markerPath - `<output>.update-run.json`.
 * @param ownText - What this window last wrote into the marker file.
 * @param change - The removal or the replacement; it runs while the claim is held.
 * @returns `true` when the change was made; `false` when the file no longer holds this window's text, or another window held the claim at each of {@link WIKI_UPDATE_MARKER_CLAIM_ATTEMPTS} attempts (the marker then stays as it is).
 * @throws What `change` throws; the claim is released first.
 * @example
 * await changeOwnMarker(markerPath, written, () => rm(markerPath, { force: true })) // => true
 */
async function changeOwnMarker(
  markerPath: string,
  ownText: string,
  change: () => Promise<void>,
): Promise<boolean> {
  const releaseClaim = await claimMarkerChange(
    markerPath,
    WIKI_UPDATE_MARKER_CLAIM_ATTEMPTS,
  )
  if (!releaseClaim) return false
  try {
    if ((await readMarkerText(markerPath)) !== ownText) return false
    await change()
    return true
  } finally {
    await releaseClaim()
  }
}

/**
 * Puts a text into the marker file as one new file; called by `reserve` of {@link claimWikiUpdateMarker}.
 *
 * Why: a write in place empties the file first, so another window that reads at that moment finds no marker, and a write that fails half-way leaves neither the run's marker nor the reservation. The text is written beside the marker and moved over it; {@link changeOwnMarker} runs it under the claim.
 *
 * @param markerPath - `<output>.update-run.json`.
 * @param text - The marker's new content.
 * @throws The file system's error when the text cannot be written or moved; the marker file then still holds what it held.
 * @example
 * await replaceMarker('/repo/.codebook/wiki.update-run.json', '{"pid":4242,…,"watchEndedAtMs":1790000900000}')
 */
async function replaceMarker(markerPath: string, text: string): Promise<void> {
  const besidePath = `${markerPath}.${randomUUID()}.tmp`
  try {
    await writeFile(besidePath, text, { flag: 'wx' })
    await rename(besidePath, markerPath)
  } catch (error) {
    await rm(besidePath, { force: true }).catch(() => undefined)
    throw error
  }
}

/**
 * Writes this window's marker beside the Wiki when a run begins, exclusively, so that of the windows that start at the same moment only one runs.
 *
 * Why: a look at the marker and the start of a run are two steps; only an exclusive write decides a race between windows. A marker in the way that no live window's run owns (a killed editor's, this window's own from a run that already ended, or the reservation of a stopped watch, which the start check has let pass) is removed and the write is tried once more. A marker file that exists is removed or replaced only under an exclusive claim ({@link claimMarkerChange}, the storage lock's takeover claim on the marker's path) and after a look made under it, so no window removes a marker another window wrote since its look.
 * Trigger: the extension calls it right before a run begins and calls `release` when the run has ended.
 *
 * @param outputDirectory - Resolved Wiki output folder; the marker is `<output>.update-run.json`.
 * @param marker - This window's process id, window id, host and the run's start.
 * @returns
 * - The marker was written: `release`, which removes it, and `reserve`, which replaces it by a stopped watch's reservation; both leave a marker another window has written since, and a reservation that cannot be written leaves the run's marker, which `release` still removes
 * - Another window's live run holds the Wiki: `heldBy` with its marker
 * @throws The file system's error when the marker cannot be written for another reason (for example a read-only folder), and the exclusive write's `EEXIST` when a marker is still in the way at the second attempt, also because another window was removing or releasing it at that moment.
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
): Promise<WikiUpdateMarkerClaim> {
  const markerPath = outputDirectory + WIKI_UPDATE_RUN_MARKER_SUFFIX
  /** What this claim last wrote into the marker file; only a file that still holds it is this claim's to remove. */
  let written = JSON.stringify(marker)
  // One retry: after a stale marker was removed the exclusive write decides again.
  for (const isLastAttempt of [false, true]) {
    try {
      await writeFile(markerPath, written, { flag: 'wx' })
      return {
        async release(): Promise<void> {
          await changeOwnMarker(markerPath, written, () =>
            rm(markerPath, { force: true }),
          )
        },
        async reserve(watchEndedAtMs: number): Promise<void> {
          const reservation = JSON.stringify({ ...marker, watchEndedAtMs })
          await changeOwnMarker(markerPath, written, async () => {
            await replaceMarker(markerPath, reservation)
            // Only a reservation that is on disk is this claim's text; after a failed write the run's marker still is.
            written = reservation
          })
        },
      }
    } catch (error) {
      rethrowUnlessMarkerExists(error)
      const heldBy = await readLiveWikiUpdateMarker(
        outputDirectory,
        marker.windowId,
      )
      // Another window's live run ends the claim; a marker that is nobody's live run is removed for the one retry.
      const liveHolder = claimOfLiveHolder(heldBy, isLastAttempt, error)
      if (liveHolder) return liveHolder
      await removeUnownedMarker(outputDirectory, markerPath, marker.windowId)
    }
  }
  throw new Error('The Wiki update marker could not be written.')
}
