import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test, type TestContext } from 'node:test'

import type * as EnvironmentModule from '../environment'

import { loadModule } from './utils/loadModule'

type InspectedSetting = { globalValue?: boolean; workspaceValue?: boolean }

/** Creates the real environment over a fake editor whose `codebook.confirmSavedSessionOperations` inspection and window calls the test controls. */
async function environmentOver(
  context: TestContext,
  inspected: InspectedSetting | undefined,
) {
  const directory = await mkdtemp(join(tmpdir(), 'codebook-confirm-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  await writeFile(
    join(directory, 'product.json'),
    JSON.stringify({ version: '1.140.0', commit: 'fixture' }),
  )
  await mkdir(join(directory, 'dist'))
  await writeFile(
    join(directory, 'dist/build.json'),
    JSON.stringify({
      revision: 'fixture',
      dirty: false,
      sourceHash: 'fixture',
    }),
  )
  const calls: { method: string; args: unknown[] }[] = []
  const disposable = { dispose(): void {} }
  const boundary = await loadModule<typeof EnvironmentModule>(
    resolve(__dirname, '../environment.js'),
    {
      './configuredBrowserRun': {},
      vscode: {
        window: {
          showWarningMessage: async (...args: unknown[]) => {
            calls.push({ method: 'showWarningMessage', args })
            return args.at(-1)
          },
          showInformationMessage: async (...args: unknown[]) => {
            calls.push({ method: 'showInformationMessage', args })
            return undefined
          },
        },
        workspace: {
          isTrusted: true,
          workspaceFolders: [{ uri: { scheme: 'file', fsPath: directory } }],
          getConfiguration: () => ({
            get: (_key: string, fallback: unknown) => fallback,
            inspect: () => inspected,
          }),
        },
        env: { appRoot: directory, appName: 'Visual Studio Code' },
        version: '1.140.0',
        extensions: { getExtension: () => ({}) },
        debug: {
          registerDebugAdapterTrackerFactory: () => disposable,
          onDidTerminateDebugSession: () => disposable,
          onDidChangeActiveDebugSession: () => disposable,
        },
      },
    },
  )
  const environment = await boundary.createEnvironment({
    extensionPath: directory,
  })
  context.after(() => environment.dispose())
  return { environment, calls }
}

// protects=DX-10 learner-only: only the user setting turns the confirmation off and a workspace value is ignored; fails_when=a .vscode/settings.json value turns the dialog off; no_claim=the host's own enforcement of scope application (the manifest test checks the scope)
test('only the learner user setting turns the confirmation off; a workspace value is ignored', async (context) => {
  // Arrange
  const workspaceOnly = await environmentOver(context, {
    workspaceValue: false,
  })
  const userOff = await environmentOver(context, { globalValue: false })
  const unset = await environmentOver(context, undefined)
  // Act
  const results = [
    workspaceOnly.environment.savedSessionConfirmationEnabled?.(),
    userOff.environment.savedSessionConfirmationEnabled?.(),
    unset.environment.savedSessionConfirmationEnabled?.(),
  ]
  // Assert
  assert.deepEqual(results, [true, false, true])
})

// protects=the editor wiring: the confirmation is a native modal warning with the detail and the primary label, and the notice goes through the plain notice helper; fails_when=the modal is non-modal or the notice is a raw call; no_claim=pixels
test('the environment shows the confirmation as a modal warning and the notice as a plain notification', async (context) => {
  // Arrange
  const { environment, calls } = await environmentOver(context, undefined)
  const question = {
    runId: 'r1',
    repository: 'shop',
    entryPath: '/cart',
    operations: [{ index: 1, kind: 'click' as const, title: 'Pay' }],
  }
  // Act
  const confirmed = await environment.confirmSavedSessionOperations?.(
    question,
    new AbortController().signal,
  )
  const review = await environment.noticeOperationsConfirmation?.({
    runId: 'r1',
    repository: 'shop',
    kind: 'declined',
  })
  // Assert
  assert.equal(confirmed, true)
  assert.equal(calls[0]?.method, 'showWarningMessage')
  assert.equal(
    calls[0]?.args[0],
    'Run 1 operation in shop as your saved session?',
  )
  assert.equal((calls[0]?.args[1] as { modal: boolean }).modal, true)
  assert.deepEqual(calls[0]?.args.slice(2), ['Run 1 operation'])
  assert.equal(calls[1]?.method, 'showWarningMessage')
  assert.equal(review, 'review-again')
})

// protects=DX-10: the manifest declares the setting as an application-scope boolean defaulting to true and hides the review command from the palette; fails_when=a workspace can set it, the default is off, or the command shows in the palette; no_claim=the settings UI
test('the manifest declares the setting at application scope and hides the review command from the palette', async () => {
  // Arrange
  const manifest = JSON.parse(
    await readFile(resolve(__dirname, '../../package.json'), 'utf8'),
  )
  // Act
  const setting =
    manifest.contributes.configuration.properties[
      'codebook.confirmSavedSessionOperations'
    ]
  const hidden = manifest.contributes.menus.commandPalette.find(
    (entry: { command: string }) =>
      entry.command === 'codebook.reviewSavedSessionOperations',
  )
  // Assert
  assert.equal(setting.type, 'boolean')
  assert.equal(setting.default, true)
  assert.equal(setting.scope, 'application')
  assert.equal(hidden.when, 'false')
})
