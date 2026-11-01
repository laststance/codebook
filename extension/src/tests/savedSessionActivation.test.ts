import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { test } from 'node:test'

import type * as ExtensionModule from '../extension'
import { SavedSessionStore } from '../runtimeSupport/signInProfile'
import { startServer } from '../server'
import type { StudyService } from '../service'

import { createHarness } from './helpers'
import { loadModule } from './utils/loadModule'

// Value: protects=Cycle 0070 pt2 I1 (the real saved-session store reaches the commands and codebook_status); fails_when=activate leaves the commands answering "not available in this build", or the service gets no store so codebook_status omits savedSession; no_claim=real editor, Chrome or runs
test('activation wires the real saved-session store: the commands do not answer "not available" and codebook_status reports the saved session', async () => {
  // Arrange
  const harness = await createHarness()
  const base = await realpath(await mkdtemp(join(tmpdir(), 'codebook-wired-')))
  const globalStorage = join(base, 'Application Support', 'globalStorage')
  await mkdir(globalStorage, { recursive: true })
  const repositoryName = basename(await realpath(harness.directory))
  // A setup of an earlier window ended with Done.
  const earlier = new SavedSessionStore({
    globalStorage,
    windowSession: 'earlier-window',
    listProcesses: async () => [],
  })
  const lease = await earlier.acquireForSetup(harness.directory)
  await lease.writeRecord({
    confirmed: true,
    setupAt: '2026-11-02T12:10:00.000Z',
    signInPaths: ['/login'],
    chromeMajor: 154,
    appCookies: 'persistent',
  })
  await lease.release()
  const commands = new Map<string, () => Promise<unknown>>()
  const warnings: string[] = []
  const notices: string[] = []
  const services: StudyService[] = []
  const boundary = await loadModule<typeof ExtensionModule>(
    resolve(__dirname, '../extension.js'),
    {
      vscode: {
        commands: {
          registerCommand(name: string, action: () => Promise<unknown>) {
            commands.set(name, action)
            return { dispose(): void {} }
          },
        },
        workspace: {
          onDidChangeWorkspaceFolders: () => ({ dispose(): void {} }),
        },
        window: {
          createOutputChannel: () => ({
            info(): void {},
            error(): void {},
            show(): void {},
            dispose(): void {},
          }),
          showInformationMessage: async (message: string) => {
            notices.push(message)
          },
          showWarningMessage: async (message: string) => {
            warnings.push(message)
          },
          createStatusBarItem: () => ({
            show(): void {},
            hide(): void {},
            dispose(): void {},
          }),
        },
        StatusBarAlignment: { Right: 2 },
        env: { appName: 'Visual Studio Code', sessionId: 'this-window' },
        version: '1.143.0',
      },
      './repositoryReader': {
        RepositoryReader: class {
          async storage() {
            return undefined
          }
          async dispose(): Promise<void> {}
        },
      },
      './studyWorkspace': {
        StudyWorkspace: class {
          presentation = undefined
          async attach(): Promise<void> {}
          async retire(): Promise<void> {}
          async dispose(): Promise<void> {}
        },
      },
      './environment': {
        requireWorkspace: () => harness.directory,
        createEnvironment: async () => ({
          ...harness.service.environment,
          dispose(): void {},
        }),
      },
      './server': {
        startServer: async (service: StudyService) => {
          service.repository = harness.service.repository
          services.push(service)
          return startServer(service)
        },
      },
    },
  )
  boundary.activate({
    extensionPath: resolve(__dirname, '../..'),
    globalStorageUri: { fsPath: globalStorage },
    subscriptions: [],
    workspaceState: { get: () => undefined, update: async () => {} },
  })
  try {
    // Act
    await commands.get('codebook.startAgentServer')!()
    const status = await services[0]!.status()
    await commands.get('codebook.removeSavedSession')!()

    // Assert
    assert.deepEqual(status.savedSession, {
      available: true,
      state: 'saved',
      setupAt: '2026-11-02T12:10:00.000Z',
    })
    assert.deepEqual(warnings, [
      `Remove the saved session for ${repositoryName}?`,
    ])
    assert.deepEqual(notices, [])
  } finally {
    await boundary.deactivate()
    await rm(base, { recursive: true, force: true })
  }
})
