import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

import { WIKI_MANIFEST_FILE, WIKI_PUBLICATION_RECEIPT_FILE } from '../constants'

import { listWikiCandidates, type WikiCandidate } from './listWikiCandidates'
import { readWikiOwnedPaths } from './readWikiOwnedPaths'
import { systemErrorCode } from './systemErrorCode'

/** Lists regular files below a directory as `/`-separated relative paths; links and special files are skipped like the publisher does. */
async function listRegularFiles(
  directory: string,
  prefix = '',
): Promise<string[]> {
  const files: string[] = []
  for (const entry of await readdir(join(directory, prefix), {
    withFileTypes: true,
  })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory())
      files.push(...(await listRegularFiles(directory, path)))
    else if (entry.isFile()) files.push(path)
  }
  return files
}

/**
 * Names the learner-owned files in a published Wiki folder that a prepared update candidate would overwrite.
 *
 * Why: the publisher refuses such a candidate and keeps everything, but only the agent sees that refusal; the extension must tell the learner why no update appeared.
 * Trigger: the extension asks on each look while it watches a VS Code update and after a Cursor update ended.
 *
 * @param outputDirectory - Resolved Wiki output folder.
 * @param notBeforeMs - Only candidates whose manifest or receipt was written at or after this time count, so an abandoned candidate of an earlier run with the same baseline is not blamed.
 * @param listedCandidates - Candidates the caller already listed with {@link listWikiCandidates} in the same look; listed here when omitted.
 * @returns Output-relative paths of manual files that collide with a candidate's pages or assets, sorted; empty when none, and when the folder cannot be read this look.
 *
 * @example
 * ```ts
 * await detectWikiPublishConflicts('/repo/.codebook/wiki', Date.parse('2026-10-03T12:00:00Z')) // => ['pages/overview.html']
 * ```
 */
export async function detectWikiPublishConflicts(
  outputDirectory: string,
  notBeforeMs: number,
  listedCandidates?: WikiCandidate[],
): Promise<string[]> {
  const published = await readWikiOwnedPaths(
    join(outputDirectory, WIKI_MANIFEST_FILE),
  )
  if (!published) return []
  const candidates = (
    listedCandidates ?? (await listWikiCandidates(outputDirectory))
  ).filter((candidate) => candidate.writtenAtMs >= notBeforeMs)
  if (!candidates.length) return []
  // An output folder that is being swapped right now cannot be listed; that is no finding this look.
  const outputFiles = await listRegularFiles(outputDirectory).catch(
    (error: unknown) => {
      if (systemErrorCode(error) === 'ENOENT') return undefined
      throw error
    },
  )
  if (!outputFiles) return []
  const manual = outputFiles.filter(
    (path) =>
      path !== WIKI_MANIFEST_FILE &&
      path !== WIKI_PUBLICATION_RECEIPT_FILE &&
      !published.has(path),
  )
  const colliding = new Set<string>()
  // The publisher's own rule: a manual file collides with an owned path that equals it, lies below it or lies above it.
  for (const path of manual)
    for (const candidate of candidates)
      for (const ownedPath of candidate.ownedPaths)
        if (
          ownedPath === path ||
          ownedPath.startsWith(`${path}/`) ||
          path.startsWith(`${ownedPath}/`)
        )
          colliding.add(path)
  return [...colliding].sort()
}
