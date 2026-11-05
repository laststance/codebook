import type { NodeScriptRunDependencies } from './ownedNodeScriptRun'
import { forgetNodeServerProcess } from './utils/forgetNodeServerProcess'
import { isProcessGone } from './utils/isProcessGone'
import { isProcessGroupGone } from './utils/isProcessGroupGone'
import { launchNodeServer } from './utils/launchNodeServer'
import type { NodeServerOrphanStore } from './utils/nodeServerOrphanRecords'
import { readProcessCwd } from './utils/readProcessCwd'
import { readProcessStart } from './utils/readProcessStart'
import { rememberNodeServerProcess } from './utils/rememberNodeServerProcess'
import { resolveNodeServerLaunch } from './utils/resolveNodeServerLaunch'
import { resolveNodeServerStops } from './utils/resolveNodeServerStops'
import { signalProcessGroup } from './utils/signalProcessGroup'
import { REAL_DEADLINE_TIMERS } from './utils/slotDeadline'
import { createVscodeNodeServerDebugger } from './vscodeNodeServerDebugger'

/**
 * Assembles the product's dependencies of a node-script run: the editor-backed debugger, the real launcher and clock, the shared resolvers, the orphan records of the owned process and the learner's confirmation.
 * Called by the environment's `createNodeScriptRun` hook for each run; tests of the run pass fakes to {@link createOwnedNodeScriptRun} instead.
 * @param input - The external Node, the workspace store the running script's record is kept in, and the editor's confirmation.
 * @returns The dependencies for {@link createOwnedNodeScriptRun}; no listener tool is needed.
 * @example
 * createOwnedNodeScriptRun({ workspace, configuration, record, citedSources, runId, dependencies: createProductNodeScriptRunDependencies({ node, orphanStore, confirmRun }) })
 */
export function createProductNodeScriptRunDependencies(input: {
  node: NodeScriptRunDependencies['node']
  orphanStore: NodeServerOrphanStore
  confirmRun: NodeScriptRunDependencies['confirmRun']
}): NodeScriptRunDependencies {
  return {
    clock: {
      now: () => performance.now(),
      set: REAL_DEADLINE_TIMERS.set,
    },
    node: input.node,
    createDebugger: createVscodeNodeServerDebugger,
    resolveLaunch: resolveNodeServerLaunch,
    resolveStops: resolveNodeServerStops,
    launch: launchNodeServer,
    signalGroup: signalProcessGroup,
    isGroupGone: isProcessGroupGone,
    isProcessGone,
    readProcessStart: (pid) => readProcessStart(pid),
    readProcessCwd: (pid) => readProcessCwd(pid),
    // A script listens on nothing Codebook needs to verify.
    readListeningPorts: async () => [],
    rememberProcess: (record): Promise<void> =>
      rememberNodeServerProcess(input.orphanStore, record),
    forgetProcess: (runId): Promise<void> =>
      forgetNodeServerProcess(input.orphanStore, runId),
    confirmRun: input.confirmRun,
  }
}
