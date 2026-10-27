import type { NodeServerRunUtilities } from '../nodeServerRunDependencies'

import { forgetNodeServerProcess } from './forgetNodeServerProcess'
import type { NodeServerOrphanStore } from './nodeServerOrphanRecords'
import { readConnectionServerPid } from './readConnectionServerPid'
import { readListeningPortsOfProcess } from './readListeningPortsOfProcess'
import { rememberNodeServerProcess } from './rememberNodeServerProcess'
import { sendDeclaredRequest } from './sendDeclaredRequest'
import { verifyListenerOwnership } from './verifyListenerOwnership'
import { waitForServerReadiness } from './waitForServerReadiness'

/**
 * Binds the node-server run's machine utilities (readiness, listener ownership, the connection's server process, the request sender) and its orphan records to one workspace store.
 * Called by the environment's `createNodeServerRun` for every run, so a run's process record lands in the window's workspace storage that {@link reapNodeServerOrphans} reads at the next activation.
 * @param orphanStore - The workspace storage (`ExtensionContext.workspaceState`) the running server's record is kept in.
 * @returns The seven utilities {@link createProductNodeServerRunDependencies} takes.
 * @example
 * createNodeServerRunUtilities(context.workspaceState).readListeningPorts(4242) // => Promise<[4100]>
 */
export function createNodeServerRunUtilities(
  orphanStore: NodeServerOrphanStore,
): NodeServerRunUtilities {
  return {
    waitForReadiness: waitForServerReadiness,
    verifyListener: verifyListenerOwnership,
    readListeningPorts: (pid) => readListeningPortsOfProcess(pid),
    readConnectionServerPid: (input) => readConnectionServerPid(input),
    sendRequest: sendDeclaredRequest,
    rememberProcess: (record): Promise<void> =>
      rememberNodeServerProcess(orphanStore, record),
    forgetProcess: (runId): Promise<void> =>
      forgetNodeServerProcess(orphanStore, runId),
  }
}
