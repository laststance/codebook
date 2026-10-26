import * as nodePath from 'node:path'

/** What {@link chooseWikiWatchFolder} weighs. */
type WikiWatchChoice = {
  /** The opened project's folder. */
  projectRoot: string
  /** The resolved Wiki folder. */
  outputDirectory: string
  /** The nearest folder at or above the output's parent that exists ({@link findNearestExistingAncestor}). */
  nearestExistingFolder: string
  /** The learner's home folder, which is never watched. */
  homeDirectory: string
  /** The path module of the system the paths belong to; tests pass `path.win32`. */
  pathApi?: Pick<typeof nodePath, 'relative' | 'isAbsolute' | 'sep' | 'dirname'>
}

/**
 * Chooses the folder the LLM Wiki view's watcher stands on, or none when every candidate would be too broad.
 *
 * Why: walking up from a Wiki output whose parents do not exist yet could end at the home folder or the file-system root, and a recursive watch there costs the editor far more than the view is worth.
 * Trigger: {@link createLlmWikiView} at each read that shows a ready state.
 *
 * Inside the project the watcher never stands above the project root; for an output outside it, only on the output's own parent when that exists. The home folder and a file-system root are never watched.
 *
 * @param choice - The project, the output, the nearest existing folder and the home folder.
 * @returns The folder to watch; `undefined` for the no-watcher fallback (the view then refreshes on visibility and its Refresh action only).
 * @example
 * chooseWikiWatchFolder({ projectRoot: '/repo', outputDirectory: '/repo/.codebook/wiki', nearestExistingFolder: '/repo', homeDirectory: '/Users/ada' }) // => '/repo'
 * chooseWikiWatchFolder({ projectRoot: '/repo', outputDirectory: '/Users/ada/x/y/wiki', nearestExistingFolder: '/Users/ada', homeDirectory: '/Users/ada' }) // => undefined
 */
export function chooseWikiWatchFolder(
  choice: WikiWatchChoice,
): string | undefined {
  const { projectRoot, outputDirectory, nearestExistingFolder, homeDirectory } =
    choice
  const pathApi = choice.pathApi ?? nodePath
  /** Whether a path is the folder itself or lies below it. */
  const isAtOrBelow = (folder: string, path: string): boolean => {
    const fromFolder = pathApi.relative(folder, path)
    return (
      !pathApi.isAbsolute(fromFolder) &&
      fromFolder !== '..' &&
      !fromFolder.startsWith(`..${pathApi.sep}`)
    )
  }
  const isInsideProject = isAtOrBelow(projectRoot, outputDirectory)
  // Inside the project the nearest folder is the project root at the highest; outside, only the output's own parent counts.
  const isAcceptable = isInsideProject
    ? isAtOrBelow(projectRoot, nearestExistingFolder)
    : nearestExistingFolder === pathApi.dirname(outputDirectory)
  const isRoot =
    pathApi.dirname(nearestExistingFolder) === nearestExistingFolder
  const isHome =
    homeDirectory !== '' &&
    pathApi.relative(homeDirectory, nearestExistingFolder) === ''
  return isAcceptable && !isRoot && !isHome ? nearestExistingFolder : undefined
}
