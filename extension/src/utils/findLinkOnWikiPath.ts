import { lstat, realpath } from 'node:fs/promises'
import { isAbsolute, join, parse, relative, sep } from 'node:path'

import { systemErrorCode } from './systemErrorCode'

/**
 * Says whether a real path is the project's real root itself or lies below it; called by {@link findLinkOnWikiPath} for each folder on the way to the Wiki folder.
 * @param realRoot - The project's real path.
 * @param realPath - The real path of a folder on the way.
 * @returns `true` for the root and for a path below it; `false` for a path beside or above it and for one on another drive.
 * @example
 * isInProject('/repo', '/repo/.codebook') // => true
 * isInProject('/repo', '/elsewhere')      // => false
 */
function isInProject(realRoot: string, realPath: string): boolean {
  const fromRoot = relative(realRoot, realPath)
  return (
    fromRoot === '' ||
    (!isAbsolute(fromRoot) &&
      fromRoot !== '..' &&
      !fromRoot.startsWith('..' + sep))
  )
}

/**
 * Finds the first entry on a path inside the project that is a link, or no folder of the project's own, as the publisher refuses it: every folder from where the path enters the project up to and including `folder`; called by {@link findWikiUpdateStartBlock} for the Wiki folder's parent before an update starts, and by {@link assertNoLinkOnWikiPath} for the Wiki folder itself before the reader or the open command reads the Wiki.
 *
 * Why: the publisher writes its stage, journal and backup beside the Wiki folder, so a cloned repository that carries `.codebook`, or another folder on that path, as a link would have it write outside the project, and a Wiki folder that is itself such a link would have Codebook read and serve a Wiki from outside the project. The publisher (`skills/codebook/publish-wiki.mjs`) refuses such a path before it writes anything, and Codebook reads no Wiki through it either.
 * The path is walked the way the publisher walks it: from the file system's root to `folder`. The folders before the path enters the project (a folder whose real path is the project or lies in it) are followed, and so is every folder of a path outside the project: they are the learner's choice. From there on, each entry must be a folder (no link, no file) whose real path stays in the project, which also refuses a junction on Windows that a look without following calls a directory.
 *
 * @param projectRoot - The opened project.
 * @param folder - The last folder of the path to look at: the Wiki folder's parent, or the Wiki folder itself.
 * @returns
 * - The path, as `folder` writes it, of the first entry after the path entered the project that is a link, a file or a folder whose real path leaves the project
 * - `undefined` when there is none, when the path lies outside the project, and from the first entry on the path that is missing (the publisher creates it as a folder of its own)
 * @throws What the file system throws for an entry on the path that cannot be looked at, other than a missing one.
 * @example
 * await findLinkOnWikiPath('/repo', '/repo/.codebook')      // => '/repo/.codebook' while the repository carries `.codebook` as a link
 * await findLinkOnWikiPath('/repo', '/repo/.codebook/wiki') // => '/repo/.codebook/wiki' while the Wiki folder itself is a link
 * await findLinkOnWikiPath('/repo', '/srv')                 // => undefined
 */
export async function findLinkOnWikiPath(
  projectRoot: string,
  folder: string,
): Promise<string | undefined> {
  const realRoot = await realpath(projectRoot)
  let path = parse(folder).root
  let hasEnteredProject = false
  for (const part of relative(path, folder).split(sep).filter(Boolean)) {
    path = join(path, part)
    const entry = await lstat(path).catch((error: unknown) => {
      if (['ENOENT', 'ENOTDIR'].includes(systemErrorCode(error)))
        return undefined
      throw error
    })
    // Nothing below a missing folder exists yet.
    if (!entry) return undefined
    // Inside the project only a folder of its own may follow; before it, the real path says whether the project begins here.
    if (
      hasEnteredProject &&
      (!entry.isDirectory() ||
        entry.isSymbolicLink() ||
        !isInProject(realRoot, await realpath(path)))
    )
      return path
    hasEnteredProject ||= isInProject(realRoot, await realpath(path))
  }
  return undefined
}
