import { StudyError } from '../errors'
import { viteRefusal } from '../viteRefusals'

import { hasNextExecutable } from './hasNextExecutable'
import type { ViteDevScript } from './parseViteDevScript'
import { readNodeVersion } from './readNodeVersion'
import { readViteWorkspaceGaps } from './readViteWorkspaceGaps'
import {
  resolveViteInstallation,
  type ViteInstallation,
} from './resolveViteInstallation'

/** What a workspace that can run on `vite-dev` provides. */
export type ViteWorkspace = {
  installation: ViteInstallation
  script: ViteDevScript
}

/**
 * Refuses a Next adapter start on a workspace that has Vite and no Next, naming the Vite version and the adapter to use.
 *
 * Called by the Next adapter's workspace check when Next is missing, so an agent that picked the wrong adapter reads the right one in the refusal.
 *
 * @param workspace - The package root.
 * @throws `ADAPTER_MISROUTE` when `vite` resolves and `next` does not.
 * @example
 * await refuseViteMisroute('/vite-app') // throws ADAPTER_MISROUTE: vite 8.3.5 is installed, use adapter "vite-dev"
 */
export async function refuseViteMisroute(workspace: string): Promise<void> {
  if (await hasNextExecutable(workspace)) return
  const lookup = await resolveViteInstallation(workspace).catch(() => undefined)
  if (lookup?.found)
    throw viteRefusal(
      'ADAPTER_MISROUTE',
      `next-dev-webpack was chosen, but this workspace has Vite ${lookup.installation.version} and no Next: use adapter "vite-dev".`,
    )
}

/**
 * Checks everything about a workspace that is known before any process starts and refuses with the first gap {@link readViteWorkspaceGaps} finds.
 *
 * Why it exists: these refusals need no launcher, so they leave nothing started. Called by the Vite adapter's `assertWorkspace` at the start of preparation. `codebook_status` reads the same gaps through {@link readRepositoryAdapterReadiness}, so the two cannot disagree.
 *
 * @param workspace - The package root.
 * @param node - The run's Node executable.
 * @param signal - Ends the check when the run is cancelled.
 * @returns The Vite installation and the accepted script.
 * @throws `ADAPTER_MISROUTE` (no Vite, Next present), `PREREQUISITE_MISSING` (no Vite), `VITE_UNSUPPORTED` for the rest (an unreadable `package.json` included); each names the value it refuses.
 * @example
 * const { installation, script } = await assessViteWorkspace('/repo', '/usr/bin/node', signal)
 */
export async function assessViteWorkspace(
  workspace: string,
  node: string,
  signal: AbortSignal,
): Promise<ViteWorkspace> {
  signal.throwIfAborted()
  const reading = await readViteWorkspaceGaps(
    workspace,
    () => readNodeVersion(node, signal),
    true,
  )
  // A blocked reading has a first gap; a ready one carries the installation and the script.
  if (!reading.ready) {
    const [gap] = reading.gaps
    if (gap.code === 'PREREQUISITE_MISSING')
      throw new StudyError(gap.code, gap.message)
    throw viteRefusal(gap.code, gap.message)
  }
  return { installation: reading.installation, script: reading.script }
}
