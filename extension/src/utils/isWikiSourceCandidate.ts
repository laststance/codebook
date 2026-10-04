import {
  WIKI_PUBLISH_BACKUP_INFIX,
  WIKI_PUBLISH_JOURNAL_SUFFIX,
  WIKI_PUBLISH_STAGE_INFIX,
  WIKI_UPDATE_RUN_MARKER_SUFFIX,
} from '../constants'

import { matchesWikiExclusion } from './matchesWikiExclusion'
import { sourceExclusion } from './sourceExclusion'

/**
 * Decides whether a project file that the Wiki does not index is one it would have to index or exclude, so the freshness check and the watch for source changes draw the same line.
 *
 * Why: a file of the Wiki folder itself, of the publisher's backups, candidates, journal and run marker beside it, a generated or unsupported file and a path the manifest excludes can never make the Wiki stale.
 * Called by {@link inspectDeepWikiFreshness} for every path Git reports as added, and by the Wiki reader for every changed file its editor reports.
 *
 * @param path - Project-relative path with `/` separators.
 * @param outputPath - The Wiki output folder, project-relative with `/` separators; empty or starting with `..` when it lies outside the project, where no project path can be inside it.
 * @param excludedPaths - The `excludedPaths` entries of the Wiki manifest.
 * @returns Whether the path counts as source the Wiki does not cover.
 *
 * @example
 * ```ts
 * isWikiSourceCandidate('src/new.ts', '.codebook/wiki', ['examples']) // => true
 * isWikiSourceCandidate('.codebook/wiki.stage-3f6c/index.html', '.codebook/wiki', []) // => false
 * isWikiSourceCandidate('examples/demo.ts', '.codebook/wiki', ['examples']) // => false
 * ```
 */
export function isWikiSourceCandidate(
  path: string,
  outputPath: string,
  excludedPaths: string[],
): boolean {
  // The Wiki folder, the backups the publisher keeps beside it, its candidates, its journal and a running update's marker are generated, never added source.
  const isWikiOutput =
    outputPath !== '' &&
    !outputPath.startsWith('..') &&
    (path === outputPath ||
      path.startsWith(`${outputPath}/`) ||
      path.startsWith(outputPath + WIKI_PUBLISH_BACKUP_INFIX) ||
      path.startsWith(outputPath + WIKI_PUBLISH_STAGE_INFIX) ||
      path === outputPath + WIKI_PUBLISH_JOURNAL_SUFFIX ||
      path === outputPath + WIKI_UPDATE_RUN_MARKER_SUFFIX)
  return (
    !sourceExclusion(path) &&
    !isWikiOutput &&
    !excludedPaths.some((exclusion) => matchesWikiExclusion(path, exclusion))
  )
}
