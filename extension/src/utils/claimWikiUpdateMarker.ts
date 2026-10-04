import { rm, writeFile } from 'node:fs/promises'

import { WIKI_UPDATE_RUN_MARKER_SUFFIX } from '../constants'

import {
  readLiveWikiUpdateMarker,
  type WikiUpdateMarker,
} from './readLiveWikiUpdateMarker'
import { systemErrorCode } from './systemErrorCode'

/** The claimed marker of this window's run (`release` removes it when the run ends), or the marker of the other window's run that holds the Wiki. */
export type WikiUpdateMarkerClaim =
  { release: () => Promise<void> } | { heldBy: WikiUpdateMarker }

/**
 * Writes this window's marker beside the Wiki when a run begins, exclusively, so that of two windows that start at the same moment only one runs.
 *
 * Why: a look at the marker and the start of a run are two steps; only an exclusive write decides a race between two windows. A marker in the way that no live window owns (a killed editor's, or this window's own from a run that already ended) is removed and the write is tried once more.
 * Trigger: the extension calls it right before a run begins and calls `release` when the run has ended.
 *
 * @param outputDirectory - Resolved Wiki output folder; the marker is `<output>.update-run.json`.
 * @param marker - This window's process id, window id, host and the run's start.
 * @returns
 * - The marker was written: `release`, which removes it
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
  // One retry: after a stale marker was removed the exclusive write decides again.
  for (const isLastAttempt of [false, true]) {
    try {
      await writeFile(markerPath, JSON.stringify(marker), { flag: 'wx' })
      return { release: (): Promise<void> => rm(markerPath, { force: true }) }
    } catch (error) {
      if (systemErrorCode(error) !== 'EEXIST') throw error
      const heldBy = await readLiveWikiUpdateMarker(
        outputDirectory,
        marker.windowId,
      )
      if (heldBy) return { heldBy }
      if (isLastAttempt) throw error
      await rm(markerPath, { force: true })
    }
  }
  throw new Error('The Wiki update marker could not be written.')
}
