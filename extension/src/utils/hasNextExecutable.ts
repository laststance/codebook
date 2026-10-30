import { access } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Tells whether `node_modules/next/dist/bin/next` exists in a workspace.
 *
 * Called by the Next readiness, by {@link refuseViteMisroute} and by {@link readViteWorkspaceGaps} so one definition of "Next is installed" serves status and the start.
 *
 * @param workspace - The package root.
 * @returns `true` when the Next executable exists.
 * @example
 * await hasNextExecutable('/repo') // => true for an installed Next app
 */
export async function hasNextExecutable(workspace: string): Promise<boolean> {
  return access(join(workspace, 'node_modules/next/dist/bin/next')).then(
    () => true,
    () => false,
  )
}
