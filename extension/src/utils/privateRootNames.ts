import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'

/** The names of each folder whose real path was resolved, by the path as the extension knows it ({@link privateRootNames}). */
const resolvedRootNames = new Map<string, string[]>()

/**
 * Gives the names a private folder can appear under in a failure's cause: the path as reported and, when it differs, its real path, so a symlinked workspace or home directory stays hidden in a message that names the real one; called by {@link StudyService}'s `causeRoots` for the opened repository and by {@link homeRootNames}.
 * A path that cannot be resolved (removed since, no permission) keeps only its reported name. A resolved path is remembered for the life of the extension host, so the real path is read once per folder (F262).
 * @param path - The folder as the extension knows it.
 * @returns The reported path first, then its real path when it differs.
 * @example privateRootNames('/Users/ada/link-to-repo') // => ['/Users/ada/link-to-repo', '/Volumes/work/repo']
 */
export function privateRootNames(path: string): string[] {
  // A folder's real path is resolved once: every cause a window words asks for it, and the call blocks the extension host (F262).
  const resolved = resolvedRootNames.get(path)
  if (resolved) return [...resolved]
  try {
    const real = realpathSync.native(path)
    const names = real === path ? [path] : [path, real]
    resolvedRootNames.set(path, names)
    return [...names]
  } catch {
    // An unresolved path is not remembered, so a folder that appears later is resolved then.
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
