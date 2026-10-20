import * as path from 'node:path'

/**
 * Says whether a real path lies inside a folder, below its real path: not the folder itself, not above it or beside it, and not on another drive or a network share, for which Windows' `relative` answers the path itself, an absolute path.
 * Called by the Wiki reader for every file the manifest lists, once it resolved the file's real path, so a file that is a link out of the Wiki folder (to a folder beside it or, on Windows, to another drive or a share) is not served.
 * @param folder - The folder's real path.
 * @param realPath - The real path of the entry.
 * @param paths - The path functions of the system the editor runs on; `path.win32` in a test of a Windows path on another system.
 * @returns `true` for a path below the folder; `false` for the folder itself and for every path outside it.
 * @example
 * isInsideFolder('/repo/.codebook/wiki', '/repo/.codebook/wiki/wiki.css')             // => true
 * isInsideFolder('/repo/.codebook/wiki', '/repo/secret.css')                          // => false
 * isInsideFolder('C:\\repo\\.codebook\\wiki', 'D:\\secret\\wiki.css', path.win32)      // => false
 */
export function isInsideFolder(
  folder: string,
  realPath: string,
  paths: Pick<typeof path, 'isAbsolute' | 'relative' | 'sep'> = path,
): boolean {
  const fromFolder = paths.relative(folder, realPath)
  return (
    fromFolder !== '' &&
    // Windows answers a path on another drive or a share as itself: no way down from the folder leads there.
    !paths.isAbsolute(fromFolder) &&
    fromFolder !== '..' &&
    !fromFolder.startsWith(`..${paths.sep}`)
  )
}
