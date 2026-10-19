import { userInfo } from 'node:os'

/**
 * Names the operating-system user this process runs as; called by {@link HostBrowser} for the owner marker of a managed browser profile and by {@link removeAbandonedProfiles}, which leaves a folder whose marker names another user.
 * @param readUser - Reads the user: `os.userInfo` unless a test names its own.
 * @returns
 * - The user's name, as the system's user list holds it
 * - `undefined` where the system names no user (`os.userInfo` throws for a process whose user has no entry in that list)
 * @example
 * currentUserName() // => 'learner'
 */
export function currentUserName(
  readUser: () => { username: string } = userInfo,
): string | undefined {
  try {
    return readUser().username
  } catch {
    // A process without an entry in the system's user list has no name to record.
    return undefined
  }
}
