import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'

import type * as SavedSessionCommands from '../savedSessionCommands'

import { defer } from './utils/defer'
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

const SAVED_VIEW = {
  available: true,
  state: 'saved' as const,
  setupAt: '2026-11-02T12:10:00.000Z',
  repositoryName: 'shop',
  setupOpenHere: false,
}
const NEXT_READY = { ready: true, missing: [] }
const VITE_NOT_INSTALLED = {
  ready: false,
  installed: false,
  supportedMajor: 8,
  yarnPnp: false,
  missing: ['Install Vite in the workspace before using vite-dev.'],
}

/**
 * Loads the commands with a store, an agent environment and a setup browser the test drives, so a setup runs through the real {@link SavedSessionSetup}.
 * Every notice lands in `notices` and `answer` picks its button (a promise answers it later); the status item, the quick picks and the store's effects are recorded.
 */
async function loadWithSetup(options: {
  answer?: (message: string) => string | undefined | Promise<string | undefined>
  adapters?: { 'next-dev-webpack': unknown; 'vite-dev': unknown }
  ensureEnvironment?: () => Promise<never>
  startServer?: (signal: AbortSignal) => Promise<unknown>
  closeBrowser?: () => Promise<'graceful'>
}) {
  const calls: string[] = []
  const notices: { severity: string; message: string; actions: string[] }[] = []
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
  const stored = { view: SAVED_VIEW }
  let storeChanged: (hash: string) => void = () => undefined
  let windowStateChanged: (state: { focused: boolean }) => void = () =>
    undefined
  const module = await loadModule<typeof SavedSessionCommands>(MODULE, {
    './runtimeSupport/signInBrowser': {
      launchSignInBrowser: async () => ({
        chromeVersion: 'Chrome/154.0.1.2',
        onClosedByLearner: () => () => undefined,
        readAppCookieKind: async () => 'persistent',
        close: async () => {
          calls.push('browserClose')
          return options.closeBrowser?.() ?? 'graceful'
        },
      }),
    },
  })
  const environment = {
    savedSessionSetupInputs: async () => ({
      ready: true,
      node: '/node',
      chrome: { binary: '/chrome', version: 'Chrome/154.0.1.2' },
      adapters: options.adapters ?? {
        'next-dev-webpack': NEXT_READY,
        'vite-dev': VITE_NOT_INSTALLED,
      },
    }),
    startSavedSessionServer: async (
      _adapter: string,
      _signInPath: string,
      signal: AbortSignal,
    ) => {
      calls.push('startServer')
      if (options.startServer) return options.startServer(signal)
      return {
        origin: 'http://localhost:3165',
        port: 3165,
        close: async (): Promise<void> => {
          calls.push('serverClose')
        },
      }
    },
  }
  const installed = module.installSavedSessions({
    editor: {
      StatusBarAlignment: { Right: 2 },
      window: {
        createStatusBarItem: () => item,
        onDidChangeWindowState: (listener) => {
          windowStateChanged = listener
          return { dispose(): void {} }
        },
        showQuickPick: async (items: readonly unknown[]) => {
          picks.push(
            items.map((entry) =>
              typeof entry === 'string' ? entry : String(entry),
            ),
          )
          // The sign-in path pick takes the path of the last run.
          return '/login' as never
        },
        showInputBox: async () => undefined,
        showWarningMessage: async () => undefined,
      },
      commands: {
        // As the editor does, a command runs its registered handler and rejects with its failure.
        executeCommand: async (command: string) => handlers.get(command)?.(),
      },
    },
    store: {
      describeForUi: async () => stored.view,
      list: async () => [],
      remove: async () => ({ outcome: 'removed' }),
      whenReleased: async () => undefined,
      lastSignInPaths: async () => ['/login'],
      onDidChange: (listener) => {
        storeChanged = listener
        return () => undefined
      },
      describe: async () => ({ available: true, state: 'saved' }),
      acquireForRun: async () => {
        throw new Error('not used')
      },
      acquireForSetup: async () => {
        calls.push('acquire')
        return {
          profile: '/store/sign-in-profiles/abc123',
          recordBrowser: async () => undefined,
          writeRecord: async (): Promise<void> => {
            calls.push('writeRecord')
          },
          release: async (): Promise<void> => {
            calls.push('release')
          },
        }
      },
      rememberSignInPaths: async () => undefined,
    },
    register: (command, handler) => {
      handlers.set(command, handler)
      return { dispose(): void {} }
    },
    showNotice: async (severity, message, ...actions) => {
      notices.push({ severity, message, actions })
      return options.answer?.(message) as never
    },
    output: undefined,
    ensureEnvironment:
      options.ensureEnvironment ?? (async () => environment as never),
    stopRun: async () => undefined,
    workspaceRoot: () => '/work/shop',
  })
  return {
    calls,
    notices,
    picks,
    item,
    handlers,
    installed,
    stored,
    emitStoreChange: (hash: string): void => storeChanged(hash),
    focusWindow: (): void => windowStateChanged({ focused: true }),
  }
}

const settle = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve))

// protects=DES-2 starting state, E11 (closing setup before the browser opened keeps the saved session as it was); fails_when=the status item offers Done or asks to sign in before a browser is open, or Close setup leaves the start running, writes a record or keeps the lock; no_claim=the wording of the stopped start's own notice (savedSessionSetup)
test('Close setup chosen from the status item while the app is still starting stops the start, offers no Done and keeps the saved session as it was', async () => {
  // Arrange
  const started = defer<AbortSignal>()
  const { calls, notices, handlers } = await loadWithSetup({
    answer: (message) =>
      message.startsWith('Codebook is starting') ? 'Close setup' : undefined,
    startServer: (signal) => {
      started.resolve(signal)
      // A cold sign-in page compiles until the start is stopped.
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () =>
          reject(new Error('the start was stopped')),
        )
      })
    },
  })
  const setUp = handlers.get('codebook.setUpSavedSession')!()
  const signal = await started.promise

  // Act
  await handlers.get('codebook.savedSession.actions')!()
  await settle()

  // Assert
  assert.equal(signal.aborted, true)
  await setUp
  assert.deepEqual(notices[0], {
    severity: 'information',
    message: 'Codebook is starting shop to open its sign-in page.',
    actions: ['Close setup'],
  })
  assert.equal(
    notices.some((notice) => notice.actions.includes('Done')),
    false,
  )
  assert.deepEqual(calls, ['acquire', 'startServer', 'release'])
})

// protects=DES-2 finishing state; fails_when=Set Up during the close re-offers Done and Close setup, whose answers would only wait for the same close; no_claim=the browser's real exit
test('Set Up while a setup is ending says that Codebook is closing its browser and offers neither Done nor Close setup', async () => {
  // Arrange
  const closing = defer<'graceful'>()
  const closeAsked = defer<void>()
  const { notices, handlers } = await loadWithSetup({
    answer: (message) =>
      message.startsWith('Sign in to') ? 'Done' : undefined,
    closeBrowser: () => {
      closeAsked.resolve()
      return closing.promise
    },
  })
  await handlers.get('codebook.setUpSavedSession')!()
  await closeAsked.promise

  // Act
  const again = handlers.get('codebook.setUpSavedSession')!()
  await settle()
  const noticesWhileEnding = notices.slice(0, 2)
  closing.resolve('graceful')
  await again
  await settle()

  // Assert
  assert.deepEqual(noticesWhileEnding, [
    {
      severity: 'information',
      message:
        'Sign in to shop in the Codebook browser window. This window is not recorded, and Codebook never sees what you type there. When you are signed in, choose Done.',
      actions: ['Done', 'Close setup'],
    },
    {
      severity: 'information',
      message: 'Setup for shop is ending: Codebook is closing its browser.',
      actions: [],
    },
  ])
})

// protects=outside voice 5 (a re-offered Done notice is bound to the setup that showed it); fails_when=Done answered late on an earlier setup's re-offered notice ends the setup open now and saves a session the learner never confirmed; no_claim=VS Code's notification center
test('Done on a re-offered notice of an earlier setup never ends the setup that is open now', async (context) => {
  // Arrange
  const lateAnswer = defer<string | undefined>()
  let signInNotices = 0
  const { calls, item, handlers, installed } = await loadWithSetup({
    answer: (message) => {
      if (!message.startsWith('Sign in to')) return undefined
      signInNotices += 1
      // The second sign-in notice is the first setup's re-offer, answered only after a second setup opened.
      return signInNotices === 2 ? lateAnswer.promise : undefined
    },
  })
  // The setup left open is closed after the test, so its 10-minute timer does not hold the process.
  context.after(() => installed.dispose())
  await handlers.get('codebook.setUpSavedSession')!()
  const reoffered = handlers.get('codebook.savedSession.actions')!()
  await settle()
  await installed.dispose()
  await handlers.get('codebook.setUpSavedSession')!()

  // Act
  lateAnswer.resolve('Done')
  await reoffered
  await settle()

  // Assert
  assert.equal(signInNotices, 3)
  assert.equal(item.text, '$(key) Saved session · setup open')
  assert.deepEqual(
    calls.filter((call) => call === 'browserClose' || call === 'writeRecord'),
    ['browserClose', 'writeRecord'],
  )
})

// protects=outside voice 5 (the starting notice's Close setup is bound to the setup that showed it); fails_when=Close setup answered late on an earlier start's notice closes the setup open now; no_claim=VS Code's notification center
test('Close setup on the starting notice of an earlier setup never closes the setup that is open now', async (context) => {
  // Arrange
  const lateAnswer = defer<string | undefined>()
  const firstStart = defer<void>()
  let serverStarts = 0
  const { calls, item, handlers, installed } = await loadWithSetup({
    answer: (message) =>
      message.startsWith('Codebook is starting')
        ? lateAnswer.promise
        : undefined,
    startServer: (signal) => {
      serverStarts += 1
      // The second setup's app answers at once.
      if (serverStarts === 2)
        return Promise.resolve({
          origin: 'http://localhost:3165',
          port: 3165,
          close: async (): Promise<void> => undefined,
        })
      // The first setup's sign-in page compiles until its start is stopped.
      firstStart.resolve()
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () =>
          reject(new Error('the start was stopped')),
        )
      })
    },
  })
  // The setup left open is closed after the test, so its 10-minute timer does not hold the process.
  context.after(() => installed.dispose())
  const firstSetUp = handlers.get('codebook.setUpSavedSession')!()
  await firstStart.promise
  const reoffered = handlers.get('codebook.savedSession.actions')!()
  await settle()
  await installed.dispose()
  await firstSetUp
  await handlers.get('codebook.setUpSavedSession')!()

  // Act
  lateAnswer.resolve('Close setup')
  await reoffered
  await settle()

  // Assert
  assert.equal(serverStarts, 2)
  assert.equal(item.text, '$(key) Saved session · setup open')
  assert.equal(calls.includes('browserClose'), false)
})

// protects=setup start without a ready development server; fails_when=the learner is asked to pick a server that cannot start, or the folder's lock is taken before the start fails; no_claim=the readiness sentences themselves (readRepositoryAdapterReadiness)
test('Set Up with no ready development server says what each one misses and takes no lock', async () => {
  // Arrange
  const { calls, notices, picks, handlers } = await loadWithSetup({
    adapters: {
      'next-dev-webpack': {
        ready: false,
        missing: [
          'Install the selected workspace dependencies, including Next, before using next-dev-webpack.',
        ],
      },
      'vite-dev': VITE_NOT_INSTALLED,
    },
  })

  // Act
  await handlers.get('codebook.setUpSavedSession')!()

  // Assert
  assert.deepEqual(notices, [
    {
      severity: 'error',
      message:
        'Saved session setup cannot start: no development server is ready. Install the selected workspace dependencies, including Next, before using next-dev-webpack. Install Vite in the workspace before using vite-dev.',
      actions: [],
    },
  ])
  assert.deepEqual(picks, [])
  assert.deepEqual(calls, [])
})

// protects=DES-3 notice button; fails_when=a setup started from the notice fails silently (an unhandled rejection) instead of telling the learner why; no_claim=the editor's own notification of a failed palette command
test('a setup started from the sign-in notice that cannot start tells the learner why', async () => {
  // Arrange
  const { notices, installed } = await loadWithSetup({
    answer: (message) =>
      message.startsWith('This run needs')
        ? 'Set Up Saved Session…'
        : undefined,
    ensureEnvironment: async () => {
      throw new Error(
        'Codebook server is stopping; wait for cleanup before starting.',
      )
    },
  })

  // Act
  installed.showSignInRequired('no-saved-session')
  await settle()

  // Assert
  assert.deepEqual(notices, [
    {
      severity: 'information',
      message: 'This run needs a saved session for shop.',
      actions: ['Set Up Saved Session…'],
    },
    {
      severity: 'error',
      message: 'Codebook server is stopping; wait for cleanup before starting.',
      actions: [],
    },
  ])
})

// protects=DES-3 needed state of the status item; fails_when=the item drops the need at the refused run's own release, or keeps "Saved session needed" after a later run took the saved session; no_claim=the store's real hold events (signInProfile tests)
test('the Saved session needed item lasts through the refused run and gives way to the stored session once a later run takes it', async () => {
  // Arrange
  const { item, installed, emitStoreChange } = await loadWithSetup({})
  await settle()

  // Act
  installed.showSignInRequired('redirected-to-sign-in')
  await settle()
  const afterRefusal = item.text
  // The refused run's cleanup releases the saved session.
  emitStoreChange('abc123')
  await settle()
  const afterItsRelease = item.text
  // A later run of this window takes the saved session.
  emitStoreChange('abc123')
  await settle()

  // Assert
  assert.equal(afterRefusal, '$(key) Saved session needed')
  assert.equal(afterItsRelease, '$(key) Saved session needed')
  assert.match(item.text, /^\$\(key\) Saved session · set up /)
})

// protects=DES-3 needed state across windows; fails_when=a setup finished in another window leaves this window's item on "may have expired", or an unchanged session drops the need; no_claim=how the other window wrote its record
test('the Saved session needed item gives way to the stored session when a setup in another window changed it', async () => {
  // Arrange
  const { item, installed, stored, focusWindow } = await loadWithSetup({})
  await settle()
  installed.showSignInRequired('redirected-to-sign-in')
  await settle()

  // Act
  focusWindow()
  await settle()
  const whileUnchanged = item.text
  stored.view = { ...SAVED_VIEW, setupAt: '2026-11-03T09:00:00.000Z' }
  focusWindow()
  await settle()

  // Assert
  assert.equal(whileUnchanged, '$(key) Saved session needed')
  assert.match(item.text, /^\$\(key\) Saved session · set up /)
  assert.equal(
    item.tooltip,
    'Saved session for shop. Codebook does not check whether the app still has you signed in.',
  )
})
