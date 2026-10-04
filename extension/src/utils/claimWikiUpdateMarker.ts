import { rm, writeFile } from 'node:fs/promises'

import { WIKI_UPDATE_RUN_MARKER_SUFFIX } from '../constants'

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
 * Reads the marker of another window's live run; called by {@link makeWayForWikiUpdateMarker} when the exclusive write found a marker in the way.
 * @param outputDirectory - Resolved Wiki output folder.
 * @param ownWindowId - This window's id; its own marker never holds the Wiki against itself.
 * @returns
 * - Another window's run is live: its marker
 * - No live marker, or the reservation of a stopped watch (the start check let this start pass it: its bound is over, or the learner chose to go on): `undefined`
 * @example
 * await readLiveRunMarker('/repo/.codebook/wiki', windowId) // => { pid: 4242, windowId: '3f6c…', host: 'vscode', startedAtMs: 1790000000000 }
 */
async function readLiveRunMarker(
  outputDirectory: string,
  ownWindowId: string,
): Promise<WikiUpdateMarker | undefined> {
  const heldBy = await readLiveWikiUpdateMarker(outputDirectory, ownWindowId)
  if (!heldBy) return undefined
  return heldBy.watchEndedAtMs === undefined ? heldBy : undefined
}

/**
 * Decides what a failed exclusive write means and removes a marker no live run owns; called by {@link claimWikiUpdateMarker} with the error of each failed attempt.
 * @param error - What the exclusive write threw.
 * @param outputDirectory - Resolved Wiki output folder.
 * @param ownWindowId - This window's id.
 * @param isLastAttempt - Whether the write was already tried again after a removal; a marker still in the way then is not removed a second time.
 * @returns
 * - Another window's live run holds the Wiki: its marker, and the marker file stays
 * - A stale marker was removed, so the write can be tried once more: `undefined`
 * @throws The given error when it is not `EEXIST`, and when the marker is in the way again on the last attempt.
 * @example
 * await makeWayForWikiUpdateMarker(error, '/repo/.codebook/wiki', windowId, false) // => undefined after a killed editor's marker was removed
 */
async function makeWayForWikiUpdateMarker(
  error: unknown,
  outputDirectory: string,
  ownWindowId: string,
  isLastAttempt: boolean,
): Promise<WikiUpdateMarker | undefined> {
  if (systemErrorCode(error) !== 'EEXIST') throw error
  // A live run holds the Wiki. A stopped watch's reservation does not: the start check let this start pass it (its bound is over, or the learner chose to go on).
  const heldBy = await readLiveRunMarker(outputDirectory, ownWindowId)
  if (heldBy) return heldBy
  if (isLastAttempt) throw error
  await rm(outputDirectory + WIKI_UPDATE_RUN_MARKER_SUFFIX, { force: true })
  return undefined
}

/**
 * Writes this window's marker beside the Wiki when a run begins, exclusively, so that of two windows that start at the same moment only one runs.
 *
 * Why: a look at the marker and the start of a run are two steps; only an exclusive write decides a race between two windows. A marker in the way that no live window's run owns (a killed editor's, this window's own from a run that already ended, or the reservation of a stopped watch, which the start check has let pass) is removed and the write is tried once more.
 * Trigger: the extension calls it right before a run begins and calls `release` when the run has ended.
 *
 * @param outputDirectory - Resolved Wiki output folder; the marker is `<output>.update-run.json`.
 * @param marker - This window's process id, window id, host and the run's start.
 * @returns
 * - The marker was written: `release`, which removes it unless another window has written its own since, and `reserve`, which rewrites it as a stopped watch's reservation
 * - Another window's live run holds the Wiki: `heldBy` with its marker
 * @throws The file system's error when the marker cannot be written for another reason (for example a read-only folder).
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
          // Another window may have taken a stopped watch's reservation over; its marker is not this claim's to remove.
          const onDisk = await readWikiRegularFile(markerPath)
          if (onDisk?.bytes.toString('utf8') === written)
            await rm(markerPath, { force: true })
        },
        async reserve(watchEndedAtMs: number): Promise<void> {
          written = JSON.stringify({ ...marker, watchEndedAtMs })
          await writeFile(markerPath, written)
        },
      }
    } catch (error) {
      const heldBy = await makeWayForWikiUpdateMarker(
        error,
        outputDirectory,
        marker.windowId,
        isLastAttempt,
      )
      if (heldBy) return { heldBy }
    }
  }
  throw new Error('The Wiki update marker could not be written.')
}
