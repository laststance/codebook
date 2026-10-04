import type { Stats } from 'node:fs'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'

import { WIKI_MANIFEST_FILE } from '../constants'

/**
 * Says whether a Wiki folder's move into place was the last thing that happened to it; called by {@link readWikiPublishedAt} for a folder that is there.
 * @param folderStat - The status of the Wiki folder.
 * @param manifestStat - The status of its manifest.
 * @returns Whether the folder's status changed after its content last did and after the manifest was written: a rename changes the folder's status time and not its modification time, creating a file in it changes both.
 * @example
 * wasFolderMovedIntoPlaceLast(folderStat, manifestStat) // => true right after a publish
 */
function wasFolderMovedIntoPlaceLast(
  folderStat: Stats,
  manifestStat: Stats,
): boolean {
  return (
    folderStat.ctimeMs > folderStat.mtimeMs &&
    folderStat.ctimeMs > manifestStat.mtimeMs
  )
}

/**
 * Reads when the Wiki on disk was published: the moment the publisher moved the new folder into place when the folder still shows it, else the time its manifest was written.
 *
 * Why: a page that shows a run which ended without success must tell "the chat published after all" apart from "the source went back to what the Wiki describes"; only a publish later than the run's end is the first. The publisher writes the manifest before its last checks and the swap, so the manifest's time alone can lie before the end of a watch that was cancelled while the publish was still under way.
 * Trigger: the Wiki reader adds it to every `api/update-status` answer.
 *
 * @param outputDirectory - Resolved Wiki output folder.
 * @returns
 * - The folder's status changed after its content last did (its move into place was the last thing that happened to it): that status change time, as an ISO timestamp
 * - Otherwise (a file was created or removed in the folder since, or it was never moved): the manifest's modification time
 * - Manifest missing (also while the publisher swaps the folder): undefined
 *
 * @example
 * ```ts
 * await readWikiPublishedAt('/repo/.codebook/wiki') // => '2026-10-03T12:20:00.000Z'
 * await readWikiPublishedAt('/repo/no-wiki')        // => undefined
 * ```
 */
export async function readWikiPublishedAt(
  outputDirectory: string,
): Promise<string | undefined> {
  const manifestStat = await stat(
    join(outputDirectory, WIKI_MANIFEST_FILE),
  ).catch(() => undefined)
  if (!manifestStat) return undefined
  const folderStat = await stat(outputDirectory).catch(() => undefined)
  // A rename changes the folder's status time and not its modification time; creating a file in it changes both.
  return folderStat && wasFolderMovedIntoPlaceLast(folderStat, manifestStat)
    ? folderStat.ctime.toISOString()
    : manifestStat.mtime.toISOString()
}
