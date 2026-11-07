import { realpath } from 'node:fs/promises'
import { isAbsolute, normalize, relative, resolve, sep } from 'node:path'

import { isInsideFolder } from './isInsideFolder'
import type { LibraryPackage } from './libraryBuildStop'

/** The folder name that keeps a published copy out of the checked-out library's source. */
const NODE_MODULES_SEGMENT = 'node_modules'

/**
 * Tells whether a declared stop file lies in the checked-out source of the library a Vite run declares with `library`, and gives the library when it does.
 *
 * Why it exists: a stop in that source pauses on the run's packed copy of the library, whose served maps are rewritten to the checked-out files, so it is sealed through the library stop route with the packed folder as the walk folder. Called by the run for each stop outside the nested Vite app before anything starts; `node_modules` inside the library, a file whose real path differs from its declared spelling, and files outside the declared folder stay `outside-package`.
 * @param repositoryRoot - The opened repository's root.
 * @param declaredPackageRoot - The declared `library.packageRoot`, repository-relative.
 * @param stopPath - The declared stop file, repository-relative.
 * @param signal - The run's cancellation.
 * @throws The signal's abort reason when `signal` is already aborted.
 * @returns The library with the declared folder and its real path; the name is the declared folder until the route knows the package name. `undefined` when the file is not in the library's own source.
 * @example
 * await detectPackedLibraryStop('/repo', 'packages/toolkit', 'packages/toolkit/src/createSlice.ts') // => { name: 'packages/toolkit', folder: 'packages/toolkit', realFolder: '/repo/packages/toolkit' }
 */
export async function detectPackedLibraryStop(
  repositoryRoot: string,
  declaredPackageRoot: string,
  stopPath: string,
  signal?: AbortSignal,
): Promise<LibraryPackage | undefined> {
  // A path that is absolute or climbs is no repository path.
  if (isAbsolute(stopPath) || normalize(stopPath).split(sep)[0] === '..')
    return undefined
  // An abort propagates: swallowing it would send the run down the workspace-library path.
  signal?.throwIfAborted()
  try {
    const root = await realpath(repositoryRoot)
    const realLibrary = await realpath(resolve(root, declaredPackageRoot))
    const realFile = await realpath(resolve(root, stopPath))
    // The declared spelling must be the real path: a link into the library is not its source.
    if (relative(root, realFile) !== normalize(stopPath)) return undefined
    if (!isInsideFolder(realLibrary, realFile)) return undefined
    // A published copy below the library's own node_modules is not the checked-out source.
    if (
      relative(realLibrary, realFile).split(sep).includes(NODE_MODULES_SEGMENT)
    )
      return undefined
    const folder = relative(root, realLibrary).split(sep).join('/')
    return { name: folder, folder, realFolder: realLibrary }
  } catch {
    return undefined
  }
}
