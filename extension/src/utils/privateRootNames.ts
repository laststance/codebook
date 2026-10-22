import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'

/**
 * Gives the names a private folder can appear under in a failure's cause: the path as reported and, when it differs, its real path, so a symlinked workspace or home directory stays hidden in a message that names the real one; called by {@link StudyService}'s `causeRoots` for the opened repository and by {@link homeRootNames}.
 * A path that cannot be resolved (removed since, no permission) keeps only its reported name.
 * @param path - The folder as the extension knows it.
 * @returns The reported path first, then its real path when it differs.
 * @example privateRootNames('/Users/ada/link-to-repo') // => ['/Users/ada/link-to-repo', '/Volumes/work/repo']
 */
export function privateRootNames(path: string): string[] {
  try {
    const real = realpathSync.native(path)
    return real === path ? [path] : [path, real]
  } catch {
    return [path]
  }
}

/**
 * Gives the names of the user's home directory for {@link sanitizeCause}, without throwing: `os.homedir()` can throw inside the catch block that reports a failure (no passwd entry, an unset home in a sandbox), and a cause must still be worded then; called by {@link StudyService}'s `causeRoots`.
 * @param readHome - Reads the home directory; the test replaces it.
 * @returns The home directory's names ({@link privateRootNames}), or none when it cannot be read.
 * @example homeRootNames(() => { throw new Error('ENOENT') }) // => []
 */
export function homeRootNames(readHome: () => string = homedir): string[] {
  try {
    return privateRootNames(readHome())
  } catch {
    return []
  }
}
