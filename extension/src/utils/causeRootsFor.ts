import { homeRootNames, privateRootNames } from './privateRootNames'
import type { CauseRoots } from './sanitizeCause'

/**
 * Gives the private roots a cause must not show for a set of storage folders and, when one is known, the opened repository, with the home directory always; the one place that decides what counts as private, so a new root is added once (F262). Called by {@link StudyService}'s `causeRoots`, by the environment for the failure of the node-test readiness search ({@link searchRepositoryVitest}) and by {@link NodeTestHistoryStore} for its summaries' reasons until a service gives its own.
 * @param storage - The extension's storage folders; each reads `<storage>`.
 * @param workspace - The opened repository's root, if any; it and its real path read `<workspace>`.
 * @returns The roots for {@link sanitizeCause}, the workspace and the home directory by every name ({@link privateRootNames}, {@link homeRootNames}).
 * @example causeRootsFor(['/Users/ada/Library/…/globalStorage/x'], '/Users/ada/repo') // => { storage: [...], workspace: ['/Users/ada/repo'], home: ['/Users/ada'] }
 */
export function causeRootsFor(
  storage: readonly string[],
  workspace?: string,
): CauseRoots {
  return {
    storage,
    ...(workspace === undefined
      ? {}
      : { workspace: privateRootNames(workspace) }),
    home: homeRootNames(),
  }
}
