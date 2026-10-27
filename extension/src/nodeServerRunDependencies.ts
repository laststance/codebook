import type { NodeServerRunDependencies } from './ownedNodeServerRun'
import { assertNodeServerPortFree } from './utils/assertNodeServerPortFree'
import { findPortOccupant } from './utils/findPortOccupant'
import { isProcessGroupGone } from './utils/isProcessGroupGone'
import { launchNodeServer } from './utils/launchNodeServer'
import { readProcessCwd } from './utils/readProcessCwd'
import { readProcessStart } from './utils/readProcessStart'
import { resolveNodeServerLaunch } from './utils/resolveNodeServerLaunch'
import { resolveNodeServerStops } from './utils/resolveNodeServerStops'
import { signalProcessGroup } from './utils/signalProcessGroup'
import { REAL_DEADLINE_TIMERS } from './utils/slotDeadline'
import { createVscodeNodeServerDebugger } from './vscodeNodeServerDebugger'

/** The utilities of the request, listener and orphan-record parts that a node-server run takes from outside. */
export type NodeServerRunUtilities = Pick<
  NodeServerRunDependencies,
  | 'waitForReadiness'
  | 'verifyListener'
  | 'readListeningPorts'
  | 'readConnectionServerPid'
  | 'sendRequest'
  | 'rememberProcess'
  | 'forgetProcess'
>

/**
 * Assembles the product's dependencies of a node-server run: the editor-backed debugger, the real launcher, clock and port checks, and the request, listener and orphan-record utilities.
 * Called by the environment's `createNodeServerRun` hook for each run; tests of the run pass fakes to {@link createOwnedNodeServerRun} instead.
 * @param input - The external Node and the utilities the environment supplies.
 * @returns The dependencies for {@link createOwnedNodeServerRun}.
 * @example
 * createOwnedNodeServerRun({ workspace, configuration, record, citedSources, runId, dependencies: createProductNodeServerRunDependencies({ node, utilities }) })
 */
export function createProductNodeServerRunDependencies(input: {
  node: NodeServerRunDependencies['node']
  utilities: NodeServerRunUtilities
}): NodeServerRunDependencies {
  return {
    clock: {
      now: () => performance.now(),
      set: REAL_DEADLINE_TIMERS.set,
    },
    node: input.node,
    createDebugger: createVscodeNodeServerDebugger,
    resolveLaunch: resolveNodeServerLaunch,
    resolveStops: resolveNodeServerStops,
    assertPortFree: ({ port, signal }): Promise<void> =>
      assertNodeServerPortFree({ port, signal, findPortOccupant }),
    launch: launchNodeServer,
    signalGroup: signalProcessGroup,
    isGroupGone: isProcessGroupGone,
    readProcessStart: (pid) => readProcessStart(pid),
    readProcessCwd: (pid) => readProcessCwd(pid),
    findPortOccupant,
    ...input.utilities,
  }
}
