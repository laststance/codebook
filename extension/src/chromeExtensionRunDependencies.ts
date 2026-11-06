import { mkdir, mkdtemp, realpath } from 'node:fs/promises'
import { join } from 'node:path'

import * as vscode from 'vscode'

import { createChromeExtensionActionExecutor } from './chromeExtensionActionExecutor'
import {
  CHROME_EXTENSION_SESSION_NAME_PREFIX,
  EXTENSION_BUILD_FOLDER_PREFIX,
} from './constants'
import { prepareExtensionSource } from './extensionSource'
import type { ChromeExtensionRunDependencies } from './ownedChromeExtensionRun'
import { resolveChromeExtensionRun } from './resolveChromeExtensionRun'
import { launchOwnedExtensionBrowser } from './runtimeSupport/ownedExtensionBrowser'
import { createExtensionSourceCheck } from './utils/createExtensionSourceCheck'
import { currentStorageOwner } from './utils/currentStorageOwner'
import { removeWithoutFollowing } from './utils/removeWithoutFollowing'
import { REAL_DEADLINE_TIMERS } from './utils/slotDeadline'
import type { WxtBuildNode } from './utils/wxtBuildTypes'
import { createVscodeChromeExtensionDebugger } from './vscodeChromeExtensionDebugger'

/**
 * Assembles the product's dependencies of a chrome-extension run: the pre-launch checks, the real owned Chrome launch, the editor-backed debugger, the action executor, the source check over the editor's open documents and the watch on the run's root debug session.
 * Called by the environment's `createChromeExtensionRun` hook for each run; tests of the run pass fakes to {@link createOwnedChromeExtensionRun} instead.
 * @param input - The opened repository's folder, the resolved Chrome executable, the folder that holds the run's profile and, for the `wxt-build` adapter, how to find the external Node the build runs with.
 * @returns The dependencies for {@link createOwnedChromeExtensionRun}.
 * @example
 * createOwnedChromeExtensionRun({ ...runInput, workspace, dependencies: createProductChromeExtensionRunDependencies({ workspace, chromeExecutable, profileRoot }) })
 */
export function createProductChromeExtensionRunDependencies(input: {
  workspace: string
  chromeExecutable: string
  profileRoot: string
  /** Finds the external Node the WXT build runs with; `undefined` when none resolves (the build then refuses by name). */
  resolveBuildNode?: () => Promise<WxtBuildNode>
}): ChromeExtensionRunDependencies {
  return {
    clock: { now: () => performance.now(), set: REAL_DEADLINE_TIMERS.set },
    resolveRun: resolveChromeExtensionRun,
    prepareSource: async (request) => {
      // The folder is made owner-only beside the test profiles and reached by its real path, which the build's source maps are relative to.
      await mkdir(input.profileRoot, { recursive: true, mode: 0o700 })
      const folder = await realpath(
        await mkdtemp(join(input.profileRoot, EXTENSION_BUILD_FOLDER_PREFIX)),
      )
      const dispose = (): Promise<void> => removeWithoutFollowing(folder)
      try {
        const source = await prepareExtensionSource({
          repositoryRoot: request.repositoryRoot,
          configuration: request.configuration,
          privateFolder: folder,
          node: await input.resolveBuildNode?.(),
          signal: request.signal,
          onBuilding: request.onBuilding,
        })
        return { source, dispose }
      } catch (error) {
        await dispose().catch(() => undefined)
        throw error
      }
    },
    launchBrowser: (options) => launchOwnedExtensionBrowser(options),
    createDebugger: createVscodeChromeExtensionDebugger,
    createExecutor: createChromeExtensionActionExecutor,
    createSourceCheck: (run) =>
      createExtensionSourceCheck({
        pinnedHashes: run.pinnedHashes,
        workspace: input.workspace,
        documents: () => vscode.workspace.textDocuments,
      }),
    watchDebugSessionEnd: (runId, listener) =>
      vscode.debug.onDidTerminateDebugSession((session) => {
        // Only the run's root attach session counts; its children end with it.
        if (
          session.parentSession === undefined &&
          session.configuration.name ===
            `${CHROME_EXTENSION_SESSION_NAME_PREFIX}${runId}`
        )
          listener()
      }),
    chromeExecutable: input.chromeExecutable,
    profileRoot: input.profileRoot,
    readOwner: () => currentStorageOwner(),
  }
}
