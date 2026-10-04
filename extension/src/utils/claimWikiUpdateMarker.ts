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
  // A live run holds the Wiki. A stopped watch's reservation does not: the start check let this start pass it (its bound is over, or the learner chose to go on).
  if (heldBy && heldBy.watchEndedAtMs === undefined) return { heldBy }
  if (isLastAttempt) throw error
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
      rethrowUnlessMarkerExists(error)
      const heldBy = await readLiveWikiUpdateMarker(
        outputDirectory,
        marker.windowId,
      )
      // Another window's live run ends the claim; a marker that is nobody's live run is removed for the one retry.
      const liveHolder = claimOfLiveHolder(heldBy, isLastAttempt, error)
      if (liveHolder) return liveHolder
      await rm(markerPath, { force: true })
    }
  }
  throw new Error('The Wiki update marker could not be written.')
}
