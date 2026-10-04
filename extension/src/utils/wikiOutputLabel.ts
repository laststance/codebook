import { isAbsolute, relative, sep } from 'node:path'

/**
 * Says whether a path from the project to a folder stays inside the project; called by {@link wikiOutputLabel} with the relative path of the Wiki folder.
 * @param fromProject - The path from the project root to the folder, as `relative` gives it.
 * @returns `true` for a path that leads down from the root; `false` for the root itself (an empty path), another drive (an absolute path) and a path that leaves the project (`..` or one that begins with it).
 * @example
 * isInsideProject('.codebook/wiki') // => true
 * isInsideProject('../wiki')        // => false
 * isInsideProject('')               // => false
 */
function isInsideProject(fromProject: string): boolean {
  return (
    fromProject !== '' &&
    !isAbsolute(fromProject) &&
    fromProject !== '..' &&
    !fromProject.startsWith('..' + sep)
  )
}

/**
 * Names the Wiki output folder the way the learner reads it: relative to the project when it lies inside, absolute otherwise.
 * Called by the update command before it records a state for the reader.
 * @param projectRoot - Canonical opened repository.
 * @param outputDirectory - Absolute resolved Wiki output.
 * @returns
 * - Inside the project: the project-relative path with forward slashes
 * - The project root itself or a folder outside it: the absolute path
 * @example
 * wikiOutputLabel('/repo', '/repo/.codebook/wiki') // => '.codebook/wiki'
 * wikiOutputLabel('/repo', '/srv/wiki')            // => '/srv/wiki'
 */
export function wikiOutputLabel(
  projectRoot: string,
  outputDirectory: string,
): string {
  const fromProject = relative(projectRoot, outputDirectory)
  return isInsideProject(fromProject)
    ? fromProject.split(sep).join('/')
    : outputDirectory
}
