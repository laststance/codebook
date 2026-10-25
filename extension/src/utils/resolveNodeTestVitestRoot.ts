import { dirname, join } from 'node:path'

import {
  readVitestConfigEntries,
  type VitestConfigEntries,
} from './readVitestConfigEntries'
import { repositoryPosixPath } from './repositoryPosixPath'

/** Where the Vitest config walk of one cited test stopped. */
export type NodeTestConfigWalk = {
  /** The nearest directory above the test, up to the opened root, that holds a config file; the opened root when none does. */
  directory: string
  /** The config-named entries of {@link NodeTestConfigWalk.directory}. */
  entries: VitestConfigEntries
  /** Config-named entries the walk passed over on its way (folders, links that leave the repository, links nothing can load), as root-relative POSIX paths, never link targets; usually empty. */
  skippedConfigFiles: string[]
}

/**
 * Finds a cited test's nearest Vitest or Vite config the way a package's own `vitest` command would see it: walking from the test file's folder up to the opened root, both included, the first directory that holds a config file is the test's Vitest root, and the opened root is it when no directory does. Nothing above the opened root is consulted.
 * Called by {@link planNodeTestExecution} before the run's history begins and by {@link prepareNodeTestLaunch} to check that the walk still stops there right before the launch.
 * @param root - The opened repository's real root.
 * @param testFile - The cited test's real path inside the root, as {@link checkNodeTestFiles} returns it.
 * @returns Where the walk stopped, that directory's config-named entries, and the entries it passed over.
 * @throws The refusal of a folder on the way that cannot be read; an error when the walk reaches the file system's root without meeting the repository's root.
 * @example
 * await resolveNodeTestVitestRoot('/repo', '/repo/packages/query-core/src/__tests__/query.test.tsx')
 * // => { directory: '/repo/packages/query-core', entries: { configFiles: ['vite.config.ts'], refusedEntries: [], skippedEntries: [] }, skippedConfigFiles: [] }
 */
export async function resolveNodeTestVitestRoot(
  root: string,
  testFile: string,
): Promise<NodeTestConfigWalk> {
  const skippedConfigFiles: string[] = []
  let directory = dirname(testFile)
  for (;;) {
    const entries = await readVitestConfigEntries(root, directory, testFile)
    // The opened root is the Vitest root also when it holds no config: the run then behaves as it does today.
    const stopsHere = entries.configFiles.length > 0 || directory === root
    // Where the walk stops, a folder or an outside link is not passed over: the plan refuses to start Vitest beside it.
    const passedOver = stopsHere
      ? entries.skippedEntries
      : [...entries.refusedEntries, ...entries.skippedEntries]
    skippedConfigFiles.push(
      ...passedOver.map((name) =>
        repositoryPosixPath(root, join(directory, name)),
      ),
    )
    if (stopsHere) return { directory, entries, skippedConfigFiles }
    const parent = dirname(directory)
    // Defensive: the cited test lies inside the canonical root, so the walk meets the root before the file system's.
    if (parent === directory)
      throw new Error(
        'node-test looked for a Vitest config above a test file outside the opened repository.',
      )
    directory = parent
  }
}
