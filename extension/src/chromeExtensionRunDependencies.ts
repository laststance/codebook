import * as vscode from 'vscode'

import { createChromeExtensionActionExecutor } from './chromeExtensionActionExecutor'
import { CHROME_EXTENSION_SESSION_NAME_PREFIX } from './constants'
import type { ChromeExtensionRunDependencies } from './ownedChromeExtensionRun'
import { resolveChromeExtensionRun } from './resolveChromeExtensionRun'
import { launchOwnedExtensionBrowser } from './runtimeSupport/ownedExtensionBrowser'
import { createExtensionSourceCheck } from './utils/createExtensionSourceCheck'
import { currentStorageOwner } from './utils/currentStorageOwner'
import { REAL_DEADLINE_TIMERS } from './utils/slotDeadline'
import { createVscodeChromeExtensionDebugger } from './vscodeChromeExtensionDebugger'

/**
 * Assembles the product's dependencies of a chrome-extension run: the pre-launch checks, the real owned Chrome launch, the editor-backed debugger, the action executor, the source check over the editor's open documents and the watch on the run's root debug session.
 * Called by the environment's `createChromeExtensionRun` hook for each run; tests of the run pass fakes to {@link createOwnedChromeExtensionRun} instead.
 * @param input - The opened repository's folder, the resolved Chrome executable and the folder that holds the run's profile.
 * @returns The dependencies for {@link createOwnedChromeExtensionRun}.
 * @example
 * createOwnedChromeExtensionRun({ ...runInput, workspace, dependencies: createProductChromeExtensionRunDependencies({ workspace, chromeExecutable, profileRoot }) })
 */
export function createProductChromeExtensionRunDependencies(input: {
  workspace: string
  chromeExecutable: string
  profileRoot: string
}): ChromeExtensionRunDependencies {
  return {
    clock: { now: () => performance.now(), set: REAL_DEADLINE_TIMERS.set },
    resolveRun: resolveChromeExtensionRun,
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
