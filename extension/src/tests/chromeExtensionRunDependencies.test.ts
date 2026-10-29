import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { test } from 'node:test'

import type * as RunDependenciesModule from '../chromeExtensionRunDependencies'

import { loadModule } from './utils/loadModule'

/** The members of a debug session the watch reads. */
interface FakeDebugSession {
  parentSession: FakeDebugSession | undefined
  configuration: { name: string }
}

/**
 * Loads the product dependencies over a fake editor whose `onDidTerminateDebugSession` the test fires by hand, and registers a watch for one run.
 * @param runId - The run the watch belongs to.
 * @returns The terminate trigger and how many times the run's listener was called.
 * @example const { terminate, calls } = await watchRun('run-1')
 */
async function watchRun(runId: string): Promise<{
  terminate: (session: FakeDebugSession) => void
  calls: () => number
}> {
  let terminateListener: ((session: FakeDebugSession) => void) | undefined
  const editor = {
    debug: {
      onDidTerminateDebugSession: (
        listener: (session: FakeDebugSession) => void,
      ) => {
        terminateListener = listener
        return { dispose: () => undefined }
      },
    },
    workspace: { textDocuments: [] },
  }
  const module = await loadModule<typeof RunDependenciesModule>(
    resolve(__dirname, '../chromeExtensionRunDependencies.js'),
    {
      vscode: editor,
      './chromeExtensionActionExecutor': {},
      './resolveChromeExtensionRun': {},
      './runtimeSupport/ownedExtensionBrowser': {},
      './utils/createExtensionSourceCheck': {},
      './utils/currentStorageOwner': {},
      './vscodeChromeExtensionDebugger': {},
    },
  )
  const dependencies = module.createProductChromeExtensionRunDependencies({
    workspace: '/repo',
    chromeExecutable: '/chrome',
    profileRoot: '/profiles',
  })
  let callCount = 0
  dependencies.watchDebugSessionEnd(runId, () => {
    callCount++
  })
  return {
    terminate: (session) => terminateListener?.(session),
    calls: () => callCount,
  }
}

// protects=ER22 (Cycle 0062 task 6): the run's end watch fires once for the root attach session named for that run; fails_when=the watch never fires or fires for the wrong session; no_claim=the real editor's event delivery
test('ending the root debug session named for the run tells the run it ended', async () => {
  // Arrange
  const { terminate, calls } = await watchRun('run-1')
  // Act
  terminate({
    parentSession: undefined,
    configuration: { name: 'codebook chrome extension run-1' },
  })
  // Assert
  assert.equal(calls(), 1)
})

// protects=ER22 (Cycle 0062 task 6): a child session of the run, whose parent is the root, never ends the run; fails_when=the root-session condition is dropped so a child's end stops the run early; no_claim=the real editor's event delivery
test('ending a child debug session of the run does not end the run', async () => {
  // Arrange
  const { terminate, calls } = await watchRun('run-1')
  const root: FakeDebugSession = {
    parentSession: undefined,
    configuration: { name: 'codebook chrome extension run-1' },
  }
  // Act
  terminate({
    parentSession: root,
    configuration: { name: 'codebook chrome extension run-1' },
  })
  // Assert
  assert.equal(calls(), 0)
})

// protects=ER22 (Cycle 0062 task 6): another run's root session never ends this run; fails_when=the run-name condition is dropped so any run's end stops this one; no_claim=the real editor's event delivery
test('ending another run’s debug session does not end this run', async () => {
  // Arrange
  const { terminate, calls } = await watchRun('run-1')
  // Act
  terminate({
    parentSession: undefined,
    configuration: { name: 'codebook chrome extension run-2' },
  })
  terminate({
    parentSession: undefined,
    configuration: { name: 'unrelated session' },
  })
  // Assert
  assert.equal(calls(), 0)
})
