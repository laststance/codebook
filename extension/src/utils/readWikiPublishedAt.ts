import { stat } from 'node:fs/promises'
import { join } from 'node:path'

import { WIKI_MANIFEST_FILE } from '../constants'

/**
 * Reads when the Wiki on disk was published: the publisher writes a new manifest file at every publish, so its modification time is that moment.
 *
 * Why: a page that shows a run which ended without success must tell "the chat published after all" apart from "the source went back to what the Wiki describes"; only a publish later than the run's end is the first.
 * Trigger: the Wiki reader adds it to every `api/update-status` answer.
 *
 * @param outputDirectory - Resolved Wiki output folder.
 * @returns
 * - Manifest present: its modification time as an ISO timestamp
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
  return manifestStat?.mtime.toISOString()
}
