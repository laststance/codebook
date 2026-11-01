import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'

import type * as SavedSessionCommands from '../savedSessionCommands'

import { loadModule } from './utils/loadModule'

const MODULE = join(__dirname, '..', 'savedSessionCommands.js')

/** Loads the commands against a stub editor whose status item and quick pick are recorded, and a review state the test flips. */
async function load(pickAnswer: string | undefined, describeFails = false) {
  const executed: { command: string; args: unknown[] }[] = []
  const picks: string[][] = []
  const item = {
    name: '',
    text: '',
    tooltip: '',
    command: undefined as string | undefined,
    show(): void {},
    hide(): void {},
    dispose(): void {},
  }
  const handlers = new Map<
    string,
    (...commandArguments: unknown[]) => unknown
  >()
  const state: { awaiting?: { runId: string; repository: string } } = {}
  const module = await loadModule<typeof SavedSessionCommands>(MODULE, {})
  const installed = module.installSavedSessions({
    editor: {
      StatusBarAlignment: { Right: 2 },
      window: {
        createStatusBarItem: () => item,
        onDidChangeWindowState: () => ({ dispose(): void {} }),
        showQuickPick: async (items: readonly unknown[]) => {
          picks.push(Array.from(items, String))
          return pickAnswer as never
        },
        showInputBox: async () => undefined,
        showWarningMessage: async () => undefined,
      },
      commands: {
        executeCommand: async (command: string, ...args: unknown[]) => {
          executed.push({ command, args: Array.from(args) })
        },
      },
    },
    store: {
      describeForUi: async () => {
        if (describeFails) throw new Error('workspace folder is gone')
        return {
          available: true,
          state: 'saved',
          setupAt: '2026-11-02T12:10:00.000Z',
          repositoryName: 'shop',
          setupOpenHere: false,
        }
      },
      list: async () => [],
      remove: async () => ({ outcome: 'removed' }),
      whenReleased: async () => undefined,
      lastSignInPaths: async () => [],
      onDidChange: () => () => undefined,
      describe: async () => ({ available: true, state: 'saved' }),
      acquireForRun: async () => {
        throw new Error('not used')
      },
      acquireForSetup: async () => {
        throw new Error('not used')
      },
      rememberSignInPaths: async () => undefined,
    },
    register: (command, handler) => {
      handlers.set(command, handler)
      return { dispose(): void {} }
    },
    showNotice: async () => undefined,
    output: undefined,
    ensureEnvironment: async () => {
      throw new Error('not used')
    },
    stopRun: async () => undefined,
    workspaceRoot: () => '/work/shop',
    awaitingReview: () => state.awaiting,
  })
  return { executed, picks, handlers, installed, state, item }
}

// protects=DES-4 / cross-check 16 (the status item names a run that waits for confirmation and offers Review operations again first); fails_when=the item keeps the setup-time text while a run waits, the menu lacks the first item, or it runs the command without the run id; no_claim=the item's rendering in the editor
test('the status item offers Review operations again first while a run awaits confirmation', async () => {
  // Arrange
  const { executed, picks, handlers, installed, state } = await load(
    'Review operations again',
  )
  state.awaiting = { runId: 'run-7', repository: 'shop' }
  // Act
  installed.refresh()
  await new Promise((resolve) => setImmediate(resolve))
  await handlers.get('codebook.savedSession.actions')?.()
  // Assert
  assert.deepEqual(picks, [
    [
      'Review operations again',
      'Set Up Saved Session…',
      'Remove Saved Session…',
    ],
  ])
  assert.deepEqual(executed, [
    { command: 'codebook.reviewSavedSessionOperations', args: ['run-7'] },
  ])
})

// protects=DES-4 (the item text); fails_when=the item does not read "operations not confirmed" while a run waits, or does not return to the setup time after; no_claim=colors or icons rendering
test('the status item reads operations not confirmed while a run waits and returns to the setup time after', async () => {
  // Arrange
  const { installed, state, item } = await load(undefined)
  const settle = (): Promise<void> =>
    new Promise((resolve) => setImmediate(resolve))
  // Act
  state.awaiting = { runId: 'run-7', repository: 'shop' }
  installed.refresh()
  await settle()
  const whileWaiting = item.text
  state.awaiting = undefined
  installed.refresh()
  await settle()
  // Assert
  assert.equal(whileWaiting, '$(key) Saved session · operations not confirmed')
  assert.match(item.text, /^\$\(key\) Saved session · set up /)
})

// protects=the status item never claims "unusable" for a store that merely could not answer; fails_when=a store that rejects makes the item appear; no_claim=a folder the store proves unusable (store tests)
test('the status item stays hidden when the store cannot describe the workspace', async () => {
  // Arrange
  const { installed, item } = await load(undefined, true)
  // Act
  installed.refresh()
  await new Promise((resolve) => setImmediate(resolve))
  // Assert
  assert.equal(item.text, '')
})
