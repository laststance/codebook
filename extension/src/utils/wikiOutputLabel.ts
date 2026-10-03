import { isAbsolute, relative, sep } from 'node:path'

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
  const isInside =
    fromProject !== '' &&
    !isAbsolute(fromProject) &&
    fromProject !== '..' &&
    !fromProject.startsWith('..' + sep)
  return isInside ? fromProject.split(sep).join('/') : outputDirectory
}
