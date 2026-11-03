import { realpath } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Says whether `<base>/node_modules/<name>` resolves by real path to the folder, as Node's resolution from `<base>` would reach it.
 *
 * Why it exists: a workspace library counts only when a reached package links to it. Called by {@link libraryOfFile} for the repository root and by {@link appReachesLibrary} for each reached package folder.
 * @param base - The folder whose `node_modules` is looked in.
 * @param name - The package name, scoped names included.
 * @param realFolder - The library folder's real path.
 * @returns `true` when the link resolves to that folder; `false` for a missing link, another target or an unreadable path.
 * @example
 * await linksToRealFolder('/repo/packages/react-lib', '@s/core', '/repo/packages/core') // => true
 */
export async function linksToRealFolder(
  base: string,
  name: string,
  realFolder: string,
): Promise<boolean> {
  try {
    return (await realpath(join(base, 'node_modules', name))) === realFolder
  } catch {
    return false
  }
}
