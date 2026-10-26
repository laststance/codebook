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
 * Inside the project the watcher stands on the project root, so a delete or move of any folder from the root down to the output (the folder holding the Wiki included) is reported; the editor reports nothing for the watched folder itself. For an output outside the project it stands only on the output's own parent when that exists, so deleting that parent is not seen there: its ancestor could be the home folder or a root, which are never watched. When the project root is the home folder or a root, the nearest existing folder at or below it is used instead.
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
  /** Whether a folder is a file-system root or the home folder, which are never watched. */
  const isTooBroad = (folder: string): boolean =>
    pathApi.dirname(folder) === folder ||
    (homeDirectory !== '' && pathApi.relative(homeDirectory, folder) === '')
  // Inside the project the watcher stands on the project root, so deleting the folder the Wiki lies in (.codebook, or any folder down to the output) is an event below the watched folder; a watcher on that folder itself hears nothing when it is deleted.
  if (
    isInsideProject &&
    isAtOrBelow(projectRoot, nearestExistingFolder) &&
    !isTooBroad(projectRoot)
  )
    return projectRoot
  // Otherwise the nearest folder is the project root at the highest inside the project; outside, only the output's own parent counts.
  const isAcceptable = isInsideProject
    ? isAtOrBelow(projectRoot, nearestExistingFolder)
    : nearestExistingFolder === pathApi.dirname(outputDirectory)
  return isAcceptable && !isTooBroad(nearestExistingFolder)
    ? nearestExistingFolder
    : undefined
}
