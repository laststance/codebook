import { mkdir, mkdtemp, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { LIBRARY_RUN_FOLDER_PREFIX } from './constants'
import { prepareLibraryPackage } from './libraryPackage'
import type { NodeScriptRunDependencies } from './ownedNodeScriptRun'
import { describeLibraryBuild } from './utils/describeLibraryBuild'
import { forgetNodeServerProcess } from './utils/forgetNodeServerProcess'
import { isProcessGone } from './utils/isProcessGone'
import { isProcessGroupGone } from './utils/isProcessGroupGone'
import { launchNodeServer } from './utils/launchNodeServer'
import { listRepositoryPackageCopies } from './utils/listRepositoryPackageCopies'
import type { NodeServerOrphanStore } from './utils/nodeServerOrphanRecords'
import { readProcessCwd } from './utils/readProcessCwd'
import { readProcessStart } from './utils/readProcessStart'
import { readRepositoryOrigin } from './utils/readRepositoryOrigin'
import { rememberNodeServerProcess } from './utils/rememberNodeServerProcess'
import { removeWithoutFollowing } from './utils/removeWithoutFollowing'
import { resolveNodeServerLaunch } from './utils/resolveNodeServerLaunch'
import { resolveNodeServerStops } from './utils/resolveNodeServerStops'
import { signalProcessGroup } from './utils/signalProcessGroup'
import { REAL_DEADLINE_TIMERS } from './utils/slotDeadline'
import { createVscodeNodeServerDebugger } from './vscodeNodeServerDebugger'

/**
 * Assembles the product's dependencies of a node-script run: the editor-backed debugger, the real launcher and clock, the shared resolvers, the orphan records of the owned process and the learner's confirmation.
 * Called by the environment's `createNodeScriptRun` hook for each run; tests of the run pass fakes to {@link createOwnedNodeScriptRun} instead.
 * @param input - The opened repository's root, the external Node, the workspace store the running script's record is kept in, and the editor's confirmation.
 * @returns The dependencies for {@link createOwnedNodeScriptRun}; no listener tool is needed.
 * @example
 * createOwnedNodeScriptRun({ workspace, configuration, record, citedSources, runId, dependencies: createProductNodeScriptRunDependencies({ node, orphanStore, confirmRun }) })
 */
export function createProductNodeScriptRunDependencies(input: {
  workspace: string
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
    prepareLibrary: async (request) => {
      // The private folder lies in the system's temporary folder, outside the repository, so the untracked snapshot never sees the pack output.
      await mkdir(tmpdir(), { recursive: true })
      const privateFolder = await realpath(
        await mkdtemp(join(tmpdir(), LIBRARY_RUN_FOLDER_PREFIX)),
      )
      try {
        return await prepareLibraryPackage(
          request.configuration,
          {
            repositoryRoot: await realpath(input.workspace),
            examplePackageRoot: request.examplePackageRoot,
            privateFolder,
          },
          { node: input.node, signal: request.signal },
        )
      } catch (error) {
        // A refusal before anything was made, or a failure whose own removal is pending, leaves the folder to this last removal.
        await removeWithoutFollowing(privateFolder).catch(() => undefined)
        throw error
      }
    },
    describeLibrary: (declaredPackageRoot) =>
      describeLibraryBuild(
        input.workspace,
        declaredPackageRoot,
        input.node.executable,
      ),
    listPackageCopies: async (examplePackageRoot) =>
      listRepositoryPackageCopies(
        examplePackageRoot,
        input.workspace,
        await readRepositoryOrigin(input.workspace),
      ),
  }
}
