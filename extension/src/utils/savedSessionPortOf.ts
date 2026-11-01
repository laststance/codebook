import { basename } from 'node:path'

import type {
  SavedSessionRunPort,
  SavedSessionStorePort,
} from '../runtimeSupport/savedSessionTypes'

/**
 * Binds the saved-session store to one repository, the form a version 3 run receives it in.
 *
 * Why it exists: the store serves every repository, but a run knows only its own workspace, so the environment hands it a port that already carries the repository root. The port exposes the folder's name for messages and never its path. Called by {@link createEnvironment} for each run it creates.
 * @param store - The store; absent in tests and in editors that never set one up.
 * @param repositoryRoot - The workspace folder the run belongs to.
 * @returns The bound port, or `undefined` without a store (the run then starts with a fresh profile).
 * @example
 * savedSessionPortOf(store, '/work/shop')?.repositoryName // => 'shop'
 */
export function savedSessionPortOf(
  store: SavedSessionStorePort | undefined,
  repositoryRoot: string,
): SavedSessionRunPort | undefined {
  if (!store) return undefined
  return {
    repositoryName: basename(repositoryRoot),
    acquire: (runId, session, chromeVersion, signal) =>
      store.acquireForRun({
        repositoryRoot,
        runId,
        session,
        chromeVersion,
        signal,
      }),
    rememberSignInPaths: (paths): Promise<void> =>
      store.rememberSignInPaths(repositoryRoot, paths),
  }
}
