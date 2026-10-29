import { readdir, readlink, realpath } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'

import { StudyError } from '../errors'

import { isInsideFolder } from './isInsideFolder'

/** True when a real path is the repository or lies inside it. */
function isInRepository(repositoryRoot: string, realPath: string): boolean {
  return realPath === repositoryRoot || isInsideFolder(repositoryRoot, realPath)
}

/** Folders the walk does not enter: they are huge, and files Chrome is shown to load are confined by the realpath rule of {@link discoverStaticLoads}. */
const SKIPPED_FOLDER_NAMES: ReadonlySet<string> = new Set([
  '.git',
  'node_modules',
])

/** True when a link that cannot be resolved still points, lexically, outside the repository. */
async function danglingLinkLeavesRepository(
  repositoryRoot: string,
  linkPath: string,
): Promise<boolean> {
  const written = await readlink(linkPath).catch(() => undefined)
  // An unreadable link cannot be shown to stay inside.
  if (written === undefined) return true
  return !isInRepository(repositoryRoot, resolve(dirname(linkPath), written))
}

/** A path relative to the repository with forward slashes; `.` for the repository itself. */
function repositoryRelative(repositoryRoot: string, path: string): string {
  const hidden = relative(repositoryRoot, path).split(sep).join('/')
  return hidden === '' ? '.' : hidden
}

/**
 * Lists a folder's entries sorted by name, wording a failure as a configuration refusal.
 * @throws `INVALID_CONFIGURATION` when the folder cannot be listed.
 */
async function listFolder(repositoryRoot: string, folder: string) {
  const entries = await readdir(folder, { withFileTypes: true }).catch(() => {
    throw new StudyError(
      'INVALID_CONFIGURATION',
      `The extension folder cannot be listed: ${repositoryRelative(repositoryRoot, folder)}.`,
    )
  })
  // Sorted so the first offending link is the same on every file system.
  return entries.sort((first, second) => first.name.localeCompare(second.name))
}

/**
 * Refuses one symbolic link whose target leaves the repository; a dangling link is judged by its written target.
 * @throws `EXTENSION_LINK_OUTSIDE` naming the link.
 */
async function assertLinkInside(
  repositoryRoot: string,
  linkPath: string,
): Promise<void> {
  const target = await realpath(linkPath).catch(() => undefined)
  const leaves =
    target === undefined
      ? await danglingLinkLeavesRepository(repositoryRoot, linkPath)
      : !isInRepository(repositoryRoot, target)
  if (!leaves) return
  throw new StudyError(
    'EXTENSION_LINK_OUTSIDE',
    `The extension folder holds a link outside the repository: ${repositoryRelative(repositoryRoot, linkPath)}.`,
  )
}

/**
 * Walks the extension folder without following links and refuses the start when a link's real path leaves the repository (ER6).
 * Called by {@link resolveChromeExtensionRun} before the manifest is read, so Chrome never loads files from outside the repository.
 * `.git` and `node_modules` folders are not entered. A link that stays inside the repository is accepted; a dangling link is judged by its written target resolved lexically (Chrome cannot load it, so it only matters when it points outside).
 * @param repositoryRoot - The repository's canonical path.
 * @param extensionRoot - The extension root's canonical path.
 * @throws `EXTENSION_LINK_OUTSIDE` naming the first offending link relative to the repository; `INVALID_CONFIGURATION` when a folder cannot be listed.
 * @example
 * await assertExtensionLinksInside('/repo', '/repo/ext') // resolves, or throws "The extension folder holds a link outside the repository: ext/vendor."
 */
export async function assertExtensionLinksInside(
  repositoryRoot: string,
  extensionRoot: string,
): Promise<void> {
  const pending = [extensionRoot]
  for (let folder = pending.shift(); folder; folder = pending.shift()) {
    for (const entry of await listFolder(repositoryRoot, folder)) {
      const entryPath = join(folder, entry.name)
      if (entry.isDirectory()) {
        if (!SKIPPED_FOLDER_NAMES.has(entry.name)) pending.push(entryPath)
      } else if (entry.isSymbolicLink())
        await assertLinkInside(repositoryRoot, entryPath)
    }
  }
}
