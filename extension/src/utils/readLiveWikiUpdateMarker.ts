import { z } from 'zod'

import { WIKI_UPDATE_RUN_MARKER_SUFFIX } from '../constants'

import { isProcessGone } from './isProcessGone'
import { readWikiRegularFile } from './readWikiRegularFile'

/** What a running Wiki update writes beside the output folder: who runs it and since when. */
export const wikiUpdateMarkerSchema = z.object({
  /** Process id of the extension host that runs the update. */
  pid: z.number().int().positive(),
  /** Random id of the editor window's activation; two windows of one test process share a pid, never this. */
  windowId: z.string().min(1),
  host: z.enum(['vscode', 'cursor']),
  /** When the run started (epoch milliseconds). */
  startedAtMs: z.number(),
})

/** The marker of a Wiki update that is running in some editor window. */
export type WikiUpdateMarker = z.infer<typeof wikiUpdateMarkerSchema>

/**
 * Reads the marker another editor window's running update left beside the Wiki, so a second window does not start a second update of the same Wiki.
 *
 * Why: each window holds its own run state, and until the first window's agent stages a candidate nothing else on disk shows its run. A marker whose process is gone was left by a killed editor and counts for nothing.
 * Trigger: the extension reads it when an update starts, before the candidate rule, and {@link claimWikiUpdateMarker} when its exclusive write finds a marker in the way.
 *
 * @param outputDirectory - Resolved Wiki output folder; the marker is `<output>.update-run.json`.
 * @param ownWindowId - The asking window's own id; its own marker is a leftover of a run that already ended and is not reported.
 * @returns
 * - A marker of another window whose process still runs: that marker
 * - No marker, one that cannot be read, one of a process that is gone, or this window's own: undefined
 *
 * @example
 * ```ts
 * await readLiveWikiUpdateMarker('/repo/.codebook/wiki', windowId)
 * // => { pid: 4242, windowId: '3f6c…', host: 'vscode', startedAtMs: 1790000000000 }
 * ```
 */
export async function readLiveWikiUpdateMarker(
  outputDirectory: string,
  ownWindowId: string,
): Promise<WikiUpdateMarker | undefined> {
  const markerFile = await readWikiRegularFile(
    outputDirectory + WIKI_UPDATE_RUN_MARKER_SUFFIX,
  )
  if (!markerFile) return undefined
  let content: unknown
  try {
    content = JSON.parse(markerFile.bytes.toString('utf8'))
  } catch {
    return undefined
  }
  const marker = wikiUpdateMarkerSchema.safeParse(content)
  if (!marker.success) return undefined
  return marker.data.windowId === ownWindowId || isProcessGone(marker.data.pid)
    ? undefined
    : marker.data
}
