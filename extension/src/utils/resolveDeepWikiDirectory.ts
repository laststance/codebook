import { isAbsolute, relative, resolve, sep } from 'node:path'

/** Keeps a relative DeepWiki setting inside the opened project when the browser command resolves its output. @param projectRoot - Exact opened local folder. @param configuredDirectory - Resource-scoped output setting. @returns The local Wiki directory. @example resolveDeepWikiDirectory('/project', '.codebook/wiki') // => '/project/.codebook/wiki' */
export function resolveDeepWikiDirectory(
  projectRoot: string,
  configuredDirectory: string,
): string {
  const trimmedDirectory = configuredDirectory.trim()
  if (!trimmedDirectory || trimmedDirectory.includes('\0'))
    throw new Error('Choose a nonempty local DeepWiki output directory.')
  const resolvedDirectory = resolve(projectRoot, trimmedDirectory)
  if (!isAbsolute(trimmedDirectory)) {
    const projectRelativeDirectory = relative(projectRoot, resolvedDirectory)
    // Explicit absolute settings may live elsewhere; relative settings remain within this project.
    if (
      !projectRelativeDirectory ||
      projectRelativeDirectory === '..' ||
      projectRelativeDirectory.startsWith(`..${sep}`)
    )
      throw new Error(
        'A relative DeepWiki output directory must be inside the opened project.',
      )
  }
  return resolvedDirectory
}
