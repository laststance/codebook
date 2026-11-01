import { lstat, unlink } from 'node:fs/promises'
import { join } from 'node:path'

import {
  CHROME_SINGLETON_ENTRIES,
  CHROME_WINDOWS_LOCK_FILE,
} from '../../constants'

/**
 * Removes the lock entries a crashed Chrome left at the top of a profile (`SingletonLock`, `SingletonCookie`, `SingletonSocket`; on Windows `lockfile`), so the next launch is not met by "the profile is in use"; called by the store's launch preparation.
 * PRECONDITION, kept by the caller: it holds the saved session's lock and a fresh process listing, made right before, showed no process naming the folder. Without that proof a live Chrome would lose its lock. Each entry is removed as a name (a link is never followed).
 * @param profile - The saved-session folder.
 * @param platform - The system whose entries are removed; this process's own unless a test names one.
 * @returns The names that were removed.
 * @example
 * await removeStaleChromeSingletons('/storage/sign-in-profiles/ab12…') // => ['SingletonLock', 'SingletonSocket']
 */
export async function removeStaleChromeSingletons(
  profile: string,
  platform: NodeJS.Platform = process.platform,
): Promise<string[]> {
  const names: readonly string[] =
    platform === 'win32' ? [CHROME_WINDOWS_LOCK_FILE] : CHROME_SINGLETON_ENTRIES
  const removed: string[] = []
  for (const name of names) {
    const path = join(profile, name)
    // lstat: a dangling link is an entry too.
    const entry = await lstat(path).catch(() => undefined)
    if (entry === undefined) continue
    await unlink(path)
    removed.push(name)
  }
  return removed
}
