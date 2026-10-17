import { MANAGED_PROFILE_ROOT } from '../../constants'

/**
 * Names the directory that holds this user's managed browser profiles, where a managed run creates its profile folder and where the sweep of abandoned folders looks; called by {@link HostBrowser} for its default profile root, so its launch and its sweep use the same directory.
 * Why: on macOS and Linux the shared `/tmp` ({@link MANAGED_PROFILE_ROOT}) is short and fixed, and the sweep judges only the folders of the user it runs as ({@link removeAbandonedProfiles} compares the owner's user id). Windows has no such user id, and `/tmp` there is `<drive>:\tmp`, a folder at a drive root that every user may change: another user could plant folders there, and the process listing shows another user's command lines as empty, so this window could remove a profile another user's Chrome still uses. The user's own temp folder lies inside the user's profile, which other users cannot open.
 * @param platform - The system the editor runs on.
 * @param userTemporaryDirectory - Gives this user's temp folder; `os.tmpdir` in the product, which reads `TEMP` on Windows.
 * @returns
 * - On Windows: this user's temp folder, for example `C:\Users\a b\AppData\Local\Temp`
 * - On every other system: {@link MANAGED_PROFILE_ROOT}
 * @example
 * managedProfileRoot('win32', tmpdir) // => 'C:\\Users\\learner\\AppData\\Local\\Temp'
 * managedProfileRoot('darwin', tmpdir) // => '/tmp'
 */
export function managedProfileRoot(
  platform: NodeJS.Platform,
  userTemporaryDirectory: () => string,
): string {
  return platform === 'win32' ? userTemporaryDirectory() : MANAGED_PROFILE_ROOT
}
