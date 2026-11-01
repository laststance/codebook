import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'

import type * as SavedSessionCommands from '../savedSessionCommands'

import { loadModule } from './utils/loadModule'

const MODULE = join(__dirname, '..', 'savedSessionCommands.js')
const ENTRY = {
  hash: 'abc123',
  repositoryName: 'shop',
  state: 'saved' as const,
  isCurrent: true,
}

/** Loads the commands module against a stub editor and a fake store; every effect lands in `calls`. */
async function load(warningAnswers: string[], pressFirstButton = false) {
  const calls: string[] = []
  const notices: { severity: string; message: string; actions: string[] }[] = []
  const handlers = new Map<
    string,
    (...commandArguments: unknown[]) => unknown
  >()
  const vscodeStub = {
    StatusBarAlignment: { Right: 2 },
    window: {
      createStatusBarItem: () => ({
        name: '',
        text: '',
        tooltip: '',
        command: undefined,
        show(): void {},
        hide(): void {},
        dispose(): void {},
      }),
      onDidChangeWindowState: () => ({ dispose(): void {} }),
      showQuickPick: async () => undefined,
      showInputBox: async () => undefined,
      showWarningMessage: async (message: string) => {
        calls.push(`modal ${message}`)
        return warningAnswers.shift()
      },
    },
    commands: {
      executeCommand: async (command: string): Promise<void> => {
        calls.push(`execute ${command}`)
      },
    },
  }
  const module = await loadModule<typeof SavedSessionCommands>(MODULE, {})
  let removals = 0
  const installed = module.installSavedSessions({
    editor: vscodeStub,
    store: {
      describeForUi: async () => ({
        available: true,
        state: 'saved',
        setupAt: '2026-11-02T12:10:00.000Z',
        repositoryName: 'shop',
        setupOpenHere: false,
      }),
      list: async () => [ENTRY],
      remove: async () => {
        removals += 1
        calls.push('remove')
        return removals === 1
          ? { outcome: 'run-in-this-window', runId: 'run-1' }
          : { outcome: 'removed' }
      },
      whenReleased: async () => {
        calls.push('whenReleased')
      },
      lastSignInPaths: () => [],
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
    showNotice: async (severity, message, ...actions) => {
      notices.push({ severity, message, actions })
      return pressFirstButton ? actions[0] : undefined
    },
    output: undefined,
    ensureEnvironment: async () => {
      throw new Error('not used')
    },
    stopRun: async (runId) => {
      calls.push(`stopRun ${runId}`)
    },
    workspaceRoot: () => '/work/shop',
  })
  return { calls, notices, handlers, installed }
}

// protects=DX-10 Stop run and remove; fails_when=the run is not stopped, the folder is deleted while the run lives, or no offer is made; no_claim=StudyService.stop internals
test('Remove offers Stop run and remove for a run of this window, stops it, waits for the release, then deletes the session', async () => {
  // Arrange
  const { calls, notices, handlers } = await load([
    'Remove',
    'Stop run and remove',
  ])
  // Act
  await handlers.get('codebook.removeSavedSession')?.()
  // Assert
  assert.deepEqual(calls, [
    'modal Remove the saved session for shop?',
    'remove',
    'modal A Codebook run is using the saved session for shop.',
    'stopRun run-1',
    'whenReleased',
    'remove',
  ])
  assert.deepEqual(notices, [
    {
      severity: 'information',
      message: 'Saved session for shop removed.',
      actions: [],
    },
  ])
})

// protects=Remove asks before deleting; fails_when=the session is deleted without the learner pressing Remove; no_claim=the modal rendering
test('Remove deletes nothing when the learner dismisses the confirmation', async () => {
  // Arrange
  const { calls, handlers } = await load([])
  // Act
  await handlers.get('codebook.removeSavedSession')?.()
  // Assert
  assert.deepEqual(calls, ['modal Remove the saved session for shop?'])
})

// protects=DES-3 one notice per refused run, with a button that runs the setup; fails_when=a reason has the wrong text or the button does not run codebook.setUpSavedSession; no_claim=lane B's detection
test('SIGN_IN_REQUIRED shows one notice with the reason text, and its button runs Set Up Saved Session', async () => {
  // Arrange
  const { calls, notices, installed } = await load([], true)
  // Act
  installed.showSignInRequired('redirected-to-sign-in')
  await new Promise((resolve) => setImmediate(resolve))
  // Assert
  assert.deepEqual(notices, [
    {
      severity: 'information',
      message: 'The saved session for shop may have expired. Set it up again.',
      actions: ['Set Up Saved Session…'],
    },
  ])
  assert.deepEqual(calls, ['execute codebook.setUpSavedSession'])
})
