import { readdir, realpath } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

import { StudyError } from '../errors'

import { isInsideFolder } from './isInsideFolder'

/** True when a real path is the repository or lies inside it. */
function isInRepository(repositoryRoot: string, realPath: string): boolean {
  return realPath === repositoryRoot || isInsideFolder(repositoryRoot, realPath)
}

/**
 * Walks the extension folder without following links and refuses the start when a link's real path leaves the repository (ER6).
 * Called by {@link resolveChromeExtensionRun} before the manifest is read, so Chrome never loads files from outside the repository.
 * A link that stays inside the repository, and a link whose target cannot be resolved, are judged by the same rule: a dangling link counts as outside because its target cannot be shown to be inside.
 * @param repositoryRoot - The repository's canonical path.
 * @param extensionRoot - The extension root's canonical path.
 * @throws `EXTENSION_LINK_OUTSIDE` naming the first offending link relative to the repository.
 * @example
 * await assertExtensionLinksInside('/repo', '/repo/ext') // resolves, or throws "The extension folder holds a link outside the repository: ext/vendor."
 */
export async function assertExtensionLinksInside(
  repositoryRoot: string,
  extensionRoot: string,
): Promise<void> {
  const pending = [extensionRoot]
  for (let folder = pending.shift(); folder; folder = pending.shift()) {
    const entries = await readdir(folder, { withFileTypes: true })
    // Sorted so the first offending link is the same on every file system.
    entries.sort((first, second) => first.name.localeCompare(second.name))
    for (const entry of entries) {
      const entryPath = join(folder, entry.name)
      if (entry.isDirectory()) pending.push(entryPath)
      else if (entry.isSymbolicLink()) {
        const target = await realpath(entryPath).catch(() => undefined)
        if (target !== undefined && isInRepository(repositoryRoot, target))
          continue
        const link = relative(repositoryRoot, entryPath).split(sep).join('/')
        throw new StudyError(
          'EXTENSION_LINK_OUTSIDE',
          `The extension folder holds a link outside the repository: ${link}.`,
        )
      }
    }
  }
}
