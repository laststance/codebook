import { join } from 'node:path'

import type { RetainedRepositoryConfiguration } from '../repositoryConfigSchemas'

import { canonicalFsPath } from './canonicalFsPath'
import { configuredStops } from './configuredStops'

/**
 * Lists the files of every stop that the given runs declared, as canonical paths under the workspace root.
 *
 * Why it exists: a run's native debugger opens the file of each stop it reaches as a preview tab, which must not block the next Study placement as a learner's foreign preview; additional stops of a version 2 configuration can sit in other files than the first stop. Called by {@link StudyWorkspace} before it measures the main editor.
 *
 * @param configurations - The configurations of the window's runs.
 * @param workspaceRoot - The workspace folder the stop paths are relative to.
 * @returns The canonical path of each declared stop file, once each.
 * @example
 * runStopFilePaths([configuration], '/repo') // => Set { '/repo/app/ui/form.tsx', '/repo/app/lib/actions.ts' }
 */
export function runStopFilePaths(
  configurations: readonly RetainedRepositoryConfiguration[],
  workspaceRoot: string,
): ReadonlySet<string> {
  return new Set(
    configurations.flatMap((configuration) =>
      configuredStops(configuration).map((stop) =>
        canonicalFsPath(join(workspaceRoot, stop.source.path)),
      ),
    ),
  )
}
