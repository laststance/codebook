import * as path from 'node:path'

import {
  MANAGED_PROFILE_ROOT,
  MANAGED_PROFILE_ROOT_UNDER_LOCAL_APP_DATA,
} from '../../constants'

/** What {@link managedProfileRoot} reads on Windows; each is the real one unless a test names its own. */
export type ManagedProfileRootInputs = {
  /** Where `LOCALAPPDATA` is read: `process.env` in the product. */
  environment: { LOCALAPPDATA?: string }
  /** Gives this user's home folder: `os.homedir` in the product. */
  homeDirectory: () => string
  /** The path functions of the system the editor runs on; `path.win32` in a test of the Windows rows on another system. */
  paths?: Pick<typeof path, 'join' | 'isAbsolute'>
}

/**
 * Names the directory that holds this user's managed browser profiles, where a managed run creates its profile folder and where the sweep of abandoned folders looks; called by {@link HostBrowser} for its default profile root, so its launch and its sweep use the same directory.
 * Why: on macOS and Linux the shared `/tmp` ({@link MANAGED_PROFILE_ROOT}) is short and fixed, and the sweep judges only the folders of the user it runs as ({@link removeAbandonedProfiles} compares the owner's user id). Windows has no such user id, so the root must be a folder no other user can write: not `/tmp` (`<drive>:\tmp`, at a drive root every user may change), and not `TEMP`, which an administrator may point at a folder several users share. The user's local application data folder (`%LOCALAPPDATA%`, `<home>\AppData\Local` by default) is this user's alone by Windows' default rights and is not moved by a `TEMP` setting. The path stays short enough for Chrome: about 80 characters to a profile folder, beside the 260 a Windows path may have.
 * @param platform - The system the editor runs on.
 * @param inputs - Where `LOCALAPPDATA` and the home folder are read ({@link ManagedProfileRootInputs}).
 * @returns
 * - On Windows: `<LOCALAPPDATA>\Codebook\browser-profiles` when `LOCALAPPDATA` is an absolute path, else `<home>\AppData\Local\Codebook\browser-profiles`; the caller creates it as needed
 * - On every other system: {@link MANAGED_PROFILE_ROOT}
 * @example
 * managedProfileRoot('win32', { environment: process.env, homeDirectory: homedir }) // => 'C:\\Users\\learner\\AppData\\Local\\Codebook\\browser-profiles'
 * managedProfileRoot('darwin', { environment: process.env, homeDirectory: homedir }) // => '/tmp'
 */
export function managedProfileRoot(
  platform: NodeJS.Platform,
  inputs: ManagedProfileRootInputs,
): string {
  if (platform !== 'win32') return MANAGED_PROFILE_ROOT
  const paths = inputs.paths ?? path
  const localAppData = inputs.environment.LOCALAPPDATA
  // A missing or relative LOCALAPPDATA names no folder of this user's own: the default place under the home folder is used.
  const userData =
    localAppData !== undefined && paths.isAbsolute(localAppData)
      ? localAppData
      : paths.join(inputs.homeDirectory(), 'AppData', 'Local')
  return paths.join(userData, ...MANAGED_PROFILE_ROOT_UNDER_LOCAL_APP_DATA)
}
