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
      if (systemErrorCode(error) !== 'EEXIST') throw error
      const heldBy = await readLiveWikiUpdateMarker(
        outputDirectory,
        marker.windowId,
      )
      // A live run holds the Wiki. A stopped watch's reservation does not: the start check let this start pass it (its bound is over, or the learner chose to go on).
      if (heldBy && heldBy.watchEndedAtMs === undefined) return { heldBy }
      if (isLastAttempt) throw error
      await rm(markerPath, { force: true })
    }
  }
  throw new Error('The Wiki update marker could not be written.')
}
