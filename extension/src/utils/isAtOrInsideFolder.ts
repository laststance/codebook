import * as path from 'node:path'

import { isInsideFolder } from './isInsideFolder'

/**
 * Says whether a real path is the folder itself or lies below it.
 *
 * Why it exists: library detection walks from a stop file up to the repository root, and the root itself is a valid place for a `package.json`, which {@link isInsideFolder} excludes. Called by {@link detectLibraryPackage}, its ancestor walk and {@link appReachesLibrary}.
 * @param folder - The folder's real path.
 * @param realPath - The real path to test.
 * @param paths - The path functions of the system the editor runs on; `path.win32` in a test of a Windows path on another system.
 * @returns `true` for the folder itself and for every path below it; `false` for every path outside it.
 * @example
 * isAtOrInsideFolder('/repo', '/repo')               // => true
 * isAtOrInsideFolder('/repo', '/repo/packages/core') // => true
 * isAtOrInsideFolder('/repo', '/other')              // => false
 */
export function isAtOrInsideFolder(
  folder: string,
  realPath: string,
  paths: Pick<typeof path, 'isAbsolute' | 'relative' | 'sep'> = path,
): boolean {
  return (
    paths.relative(folder, realPath) === '' ||
    isInsideFolder(folder, realPath, paths)
  )
}
