import { join, relative, sep } from 'node:path'

import { WIKI_MANIFEST_FILE, WIKI_PUBLICATION_RECEIPT_FILE } from '../constants'

import { listFolderTreeWithoutFollowing } from './listFolderTreeWithoutFollowing'
import { listWikiCandidates, type WikiCandidate } from './listWikiCandidates'
import { readWikiOwnedPaths } from './readWikiOwnedPaths'
import { systemErrorCode } from './systemErrorCode'

/** Lists regular files below a directory as `/`-separated relative paths; links and special files are skipped like the publisher does. `undefined` when the directory's own path holds a link or a file, which is never listed through ({@link listFolderTreeWithoutFollowing}). */
async function listRegularFiles(
  directory: string,
): Promise<string[] | undefined> {
  const entries = await listFolderTreeWithoutFollowing(directory)
  return entries
    ?.filter((entry) => entry.isFile())
    .map((entry) =>
      relative(directory, join(entry.parentPath, entry.name))
        .split(sep)
        .join('/'),
    )
}

/**
 * Applies the publisher's own collision rule to one manual file and one path a candidate owns; called by {@link listCollidingManualFiles} for each pair until one collides.
 * @param ownedPath - An output-relative path a candidate's manifest owns.
 * @param manualPath - An output-relative path of a file the published manifest does not own.
 * @returns `true` when the owned path equals the manual file, lies below it or lies above it.
 * @example
 * isCollidingPath('pages/overview.html', 'pages/overview.html') // => true
 * isCollidingPath('pages/a/b.html', 'pages/a')                  // => true
 * isCollidingPath('pages/a.html', 'notes/mine.md')              // => false
 */
function isCollidingPath(ownedPath: string, manualPath: string): boolean {
  return (
    ownedPath === manualPath ||
    ownedPath.startsWith(`${manualPath}/`) ||
    manualPath.startsWith(`${ownedPath}/`)
  )
}

/**
 * Picks the learner's own files a candidate would overwrite out of one listing of the Wiki folder; called by {@link detectWikiPublishConflicts} once the published manifest, the candidates and the listing were read.
 * @param outputFiles - The regular files of the Wiki folder as `/`-separated relative paths; `undefined` when the folder could not be listed this look.
 * @param published - The paths the published manifest owns; every other file except the manifest and the receipt is the learner's.
 * @param candidates - The candidates that count for this run.
 * @returns The manual files that collide with a path one of the candidates owns, sorted; empty when none, and for a folder that could not be listed.
 * @example
 * listCollidingManualFiles(['index.html', 'pages/notes.html'], new Set(['index.html']), [{ name: 'wiki.stage-1', writtenAtMs: 1, ownedPaths: ['pages/notes.html'] }])
 * // => ['pages/notes.html']
 */
function listCollidingManualFiles(
  outputFiles: string[] | undefined,
  published: Set<string>,
  candidates: WikiCandidate[],
): string[] {
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
    if (
      candidates.some((candidate) =>
        candidate.ownedPaths.some((ownedPath) =>
          isCollidingPath(ownedPath, path),
        ),
      )
    )
      colliding.add(path)
  return [...colliding].sort()
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
  // An output folder that is being swapped right now cannot be listed, and one whose path holds a link is not listed; neither is a finding this look.
  const outputFiles = await listRegularFiles(outputDirectory).catch(
    (error: unknown) => {
      if (systemErrorCode(error) === 'ENOENT') return undefined
      throw error
    },
  )
  return listCollidingManualFiles(outputFiles, published, candidates)
}
