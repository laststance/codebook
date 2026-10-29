import { readdir, readlink, realpath, stat } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'

import { EXTENSION_LINK_WALK_ENTRY_LIMIT } from '../constants'
import { StudyError } from '../errors'

import { isInsideFolder } from './isInsideFolder'

/** True when a real path is the repository or lies inside it. */
function isInRepository(repositoryRoot: string, realPath: string): boolean {
  return realPath === repositoryRoot || isInsideFolder(repositoryRoot, realPath)
}

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
 * @returns The link's real path when it resolves inside the repository to a folder (to be walked), else `undefined`.
 * @throws `EXTENSION_LINK_OUTSIDE` naming the link.
 */
async function assertLinkInside(
  repositoryRoot: string,
  linkPath: string,
): Promise<string | undefined> {
  const target = await realpath(linkPath).catch(() => undefined)
  const leaves =
    target === undefined
      ? await danglingLinkLeavesRepository(repositoryRoot, linkPath)
      : !isInRepository(repositoryRoot, target)
  if (leaves)
    throw new StudyError(
      'EXTENSION_LINK_OUTSIDE',
      `The extension folder holds a link outside the repository: ${repositoryRelative(repositoryRoot, linkPath)}.`,
    )
  if (target === undefined) return undefined
  const isFolder = await stat(target)
    .then((info) => info.isDirectory())
    .catch(() => false)
  return isFolder ? target : undefined
}

/**
 * Walks the whole extension folder and refuses the start when a link's real path leaves the repository (ER6).
 * Called by {@link resolveChromeExtensionRun} before the manifest is read, so Chrome never serves files from outside the repository.
 * Every folder is entered, `node_modules` and `.git` included, because Chrome serves every file under the extension root to extension pages. A link to a folder inside the repository is walked too (each real folder once, so cycles end). A dangling link is judged by its written target resolved lexically. The walk is bounded by {@link EXTENSION_LINK_WALK_ENTRY_LIMIT}.
 * @param repositoryRoot - The repository's canonical path.
 * @param extensionRoot - The extension root's canonical path.
 * @throws `EXTENSION_LINK_OUTSIDE` naming the first offending link relative to the repository; `INVALID_CONFIGURATION` when a folder cannot be listed or the walk passes the entry limit.
 * @example
 * await assertExtensionLinksInside('/repo', '/repo/ext') // resolves, or throws "The extension folder holds a link outside the repository: ext/vendor."
 */
export async function assertExtensionLinksInside(
  repositoryRoot: string,
  extensionRoot: string,
): Promise<void> {
  const pending = [extensionRoot]
  // Real paths of the linked folders already queued, so a cycle or a second link to one folder is walked once.
  const queued = new Set<string>([extensionRoot])
  let entryCount = 0
  for (let folder = pending.shift(); folder; folder = pending.shift()) {
    for (const entry of await listFolder(repositoryRoot, folder)) {
      entryCount += 1
      if (entryCount > EXTENSION_LINK_WALK_ENTRY_LIMIT)
        throw new StudyError(
          'INVALID_CONFIGURATION',
          `The extension folder holds more than ${EXTENSION_LINK_WALK_ENTRY_LIMIT.toLocaleString('en-US')} entries; point extensionRoot at the folder that holds manifest.json.`,
        )
      const entryPath = join(folder, entry.name)
      if (entry.isDirectory()) {
        pending.push(entryPath)
        queued.add(entryPath)
      } else if (entry.isSymbolicLink()) {
        const linkedFolder = await assertLinkInside(repositoryRoot, entryPath)
        // A linked folder inside the repository is walked once, by its real path.
        if (linkedFolder !== undefined && !queued.has(linkedFolder)) {
          queued.add(linkedFolder)
          pending.push(entryPath)
        }
      }
    }
  }
}
