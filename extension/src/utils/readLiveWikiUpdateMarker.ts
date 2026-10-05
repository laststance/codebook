import { z } from 'zod'

import {
  WIKI_CHAT_OPEN_TIMEOUT_MS,
  WIKI_CURSOR_UPDATE_TIMEOUT_MS,
  WIKI_UPDATE_MARKER_EXPIRY_GRACE_MS,
  WIKI_UPDATE_RUN_MARKER_SUFFIX,
  WIKI_UPDATE_WATCH_TIMEOUT_MS,
} from '../constants'

import { isProcessGone } from './isProcessGone'
import { readWikiRegularFile } from './readWikiRegularFile'

/** What a running Wiki update writes beside the output folder: who runs it and since when. */
const wikiUpdateMarkerSchema = z.object({
  /** Process id of the extension host that runs the update. */
  pid: z.number().int().positive(),
  /** Random id of the editor window's activation; two windows of one test process share a pid, never this. */
  windowId: z.string().min(1),
  host: z.enum(['vscode', 'cursor']),
  /** When the run started (epoch milliseconds). */
  startedAtMs: z.number(),
  /** Set on the reservation a stopped VS Code watch leaves in place of its run's marker: when the watch ended (epoch milliseconds). The chat may still publish until the watch bound after it; absent while the run lasts. */
  watchEndedAtMs: z.number().optional(),
})

/** The marker of a Wiki update that is running in some editor window, or the reservation its stopped watch left. */
export type WikiUpdateMarker = z.infer<typeof wikiUpdateMarkerSchema>

/**
 * Parses the bytes of a marker file; called by {@link readLiveWikiUpdateMarker} for the file it found.
 * @param bytes - The bytes of `<output>.update-run.json`.
 * @returns The marker, or `undefined` for bytes that are no JSON or do not have the marker's shape.
 * @example
 * parseWikiUpdateMarker(Buffer.from('{"pid":4242,"windowId":"3f6c","host":"vscode","startedAtMs":1790000000000}'))
 * // => { pid: 4242, windowId: '3f6c', host: 'vscode', startedAtMs: 1790000000000 }
 */
function parseWikiUpdateMarker(bytes: Buffer): WikiUpdateMarker | undefined {
  let content: unknown
  try {
    content = JSON.parse(bytes.toString('utf8'))
  } catch {
    return undefined
  }
  const marker = wikiUpdateMarkerSchema.safeParse(content)
  return marker.success ? marker.data : undefined
}

/**
 * Says whether a run's marker is older than any run can be; called by {@link isLiveMarkerOfAnotherWindow}, so a marker a killed editor left stops counting even when its process id belongs to another process by now.
 * @param marker - The marker beside the Wiki.
 * @param nowMs - The present (epoch milliseconds).
 * @returns `true` for a marker of a run (no `watchEndedAtMs`) that started longer ago than the host's longest run plus {@link WIKI_UPDATE_MARKER_EXPIRY_GRACE_MS}: the Cursor agent's bound, or the chat's opening and the watch's bound in VS Code. `false` otherwise, also for every reservation of a stopped watch, which the caller weighs against the watch bound.
 * @example
 * isRunMarkerExpired({ pid: 4242, windowId: '3f6c', host: 'cursor', startedAtMs: 0 }, 961_000) // => true
 * isRunMarkerExpired({ pid: 4242, windowId: '3f6c', host: 'cursor', startedAtMs: 0 }, 600_000) // => false
 */
function isRunMarkerExpired(marker: WikiUpdateMarker, nowMs: number): boolean {
  const longestRunMs =
    marker.host === 'cursor'
      ? WIKI_CURSOR_UPDATE_TIMEOUT_MS
      : WIKI_CHAT_OPEN_TIMEOUT_MS + WIKI_UPDATE_WATCH_TIMEOUT_MS
  return (
    marker.watchEndedAtMs === undefined &&
    nowMs >
      marker.startedAtMs + longestRunMs + WIKI_UPDATE_MARKER_EXPIRY_GRACE_MS
  )
}

/**
 * Says whether a marker stands for an update that still counts against the asking window; called by {@link readLiveWikiUpdateMarker} for a readable marker.
 * @param marker - The marker beside the Wiki.
 * @param ownWindowId - The asking window's own id.
 * @returns `false` for this window's own marker (a leftover of a run that already ended; its process is not asked for), for a marker whose process is gone and for a run's marker that is older than any run can be ({@link isRunMarkerExpired}); `true` for another window's marker whose process still runs.
 * @example
 * isLiveMarkerOfAnotherWindow({ pid: process.pid, windowId: 'other', host: 'vscode', startedAtMs: Date.now() }, 'own') // => true
 */
function isLiveMarkerOfAnotherWindow(
  marker: WikiUpdateMarker,
  ownWindowId: string,
): boolean {
  return (
    marker.windowId !== ownWindowId &&
    !isProcessGone(marker.pid) &&
    // A process id is given to another process after a restart: a run that would have ended by now is nobody's.
    !isRunMarkerExpired(marker, Date.now())
  )
}

/**
 * Reads the marker another editor window's running update left beside the Wiki, so a second window does not start a second update of the same Wiki.
 *
 * Why: each window holds its own run state, and until the first window's agent stages a candidate nothing else on disk shows its run. A marker whose process is gone was left by a killed editor and counts for nothing, and so does a run's marker that is older than any run can be.
 * Trigger: the extension reads it when an update starts, before the candidate rule, and {@link claimWikiUpdateMarker} when its exclusive write finds a marker in the way.
 *
 * @param outputDirectory - Resolved Wiki output folder; the marker is `<output>.update-run.json`.
 * @param ownWindowId - The asking window's own id; its own marker is a leftover of a run that already ended and is not reported.
 * @returns
 * - A marker of another window whose process still runs: that marker (with `watchEndedAtMs` when it is the reservation of a stopped watch, which the caller weighs against the watch bound)
 * - No marker, one that cannot be read, one of a process that is gone, a run's marker older than any run can be, or this window's own: undefined
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
  const marker = parseWikiUpdateMarker(markerFile.bytes)
  if (!marker) return undefined
  return isLiveMarkerOfAnotherWindow(marker, ownWindowId) ? marker : undefined
}
