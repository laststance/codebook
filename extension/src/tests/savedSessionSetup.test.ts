import assert from 'node:assert/strict'
import { test } from 'node:test'

import { StudyError } from '../errors'
import type { SignInRecordFields } from '../runtimeSupport/savedSessionSetupTypes'
import type { SignInBrowserCloseResult } from '../runtimeSupport/signInBrowser'
import {
  SavedSessionSetup,
  type SavedSessionSetupInput,
  type SetupPhase,
} from '../savedSessionSetup'

import { createManualClock } from './utils/createManualClock'

const PROFILE = '/store/sign-in-profiles/abc123'
const START_EPOCH_MS = Date.parse('2026-11-02T12:10:00.000Z')
const INPUT: SavedSessionSetupInput = {
  repositoryRoot: '/work/shop',
  repositoryName: 'shop',
  adapter: 'next-dev-webpack',
  signInPath: '/login',
  knownSignInPaths: ['/signin'],
  chromeExecutable: '/chrome',
}

/** Everything the setup acts through, recorded in one call log. */
function harness(
  options: {
    closeResults?: SignInBrowserCloseResult[]
    launchError?: Error
    acquireError?: Error
    writeError?: Error
  } = {},
) {
  const calls: string[] = []
  const records: SignInRecordFields[] = []
  const notices: { severity: string; message: string; actions: string[] }[] = []
  const logs: string[] = []
  const statuses: (SetupPhase | undefined)[] = []
  const clock = createManualClock()
  const closeResults = [...(options.closeResults ?? ['graceful'])]
  let closedByLearner: () => void = () => undefined
  let offer: (choice: 'Done' | 'Close setup' | undefined) => void = () =>
    undefined
  let warn: (choice: 'Done' | undefined) => void = () => undefined
  let serverCloses = 0
  let releases = 0
  const setup = new SavedSessionSetup({
    store: {
      acquireForSetup: async () => {
        calls.push('acquire')
        if (options.acquireError) throw options.acquireError
        return {
          profile: PROFILE,
          recordBrowser: async () => undefined,
          writeRecord: async (fields): Promise<void> => {
            calls.push('writeRecord')
            if (options.writeError) throw options.writeError
            records.push(fields)
          },
          release: async (): Promise<void> => {
            calls.push('release')
            releases += 1
          },
        }
      },
    },
    startServer: async () => {
      calls.push('startServer')
      return {
        origin: 'http://localhost:3165',
        port: 3165,
        close: async (): Promise<void> => {
          calls.push('serverClose')
          serverCloses += 1
        },
      }
    },
    launchBrowser: async (launchOptions) => {
      calls.push(`launch ${launchOptions.url}`)
      if (options.launchError) throw options.launchError
      return {
        chromeVersion: 'Chrome/154.0.1.2',
        onClosedByLearner: (listener) => {
          closedByLearner = listener
          return () => undefined
        },
        readAppCookieKind: async () => 'persistent',
        close: async () => {
          calls.push('browserClose')
          return closeResults.shift() ?? 'graceful'
        },
      }
    },
    ui: {
      showStatus: (phase) => statuses.push(phase),
      offerDoneOrClose: () =>
        new Promise((resolve) => {
          offer = resolve
        }),
      warnClosingSoon: () =>
        new Promise((resolve) => {
          warn = resolve
          logs.push('warned')
        }),
      notify: async (severity, message, ...actions) => {
        notices.push({ severity, message, actions })
        return undefined
      },
      log: (level, line) => logs.push(`${level}: ${line}`),
      showLog: () => logs.push('showLog'),
    },
    clock: {
      now: () => START_EPOCH_MS + clock.now(),
      setTimeout: (callback, delayMs) => clock.setTimeout(callback, delayMs),
      clearTimeout: (handle) => clock.clearTimeout(Number(handle)),
    },
  })
  return {
    setup,
    calls,
    records,
    notices,
    logs,
    statuses,
    clock,
    chooseInOffer: (choice: 'Done' | 'Close setup'): void => offer(choice),
    learnerClosesWindow: (): void => closedByLearner(),
    answerWarning: (): void => warn('Done'),
    serverCloses: () => serverCloses,
    releases: () => releases,
  }
}

const flush = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve))

// protects=DES-2 transitions, X7, ENG-10 order; fails_when=the record is written before the browser closed, confirmed is false after Done, the lock outlives the setup, or the server keeps running; no_claim=real notifications
test('Done closes the browser first, then writes confirmed true with the setup time, then releases the folder', async () => {
  // Arrange
  const test = harness()
  await test.setup.start(INPUT)
  // Act
  await test.setup.done()
  // Assert
  assert.deepEqual(test.calls, [
    'acquire',
    'startServer',
    'launch http://localhost:3165/login',
    'browserClose',
    'writeRecord',
    'release',
    'serverClose',
  ])
  assert.deepEqual(test.records, [
    {
      confirmed: true,
      setupAt: '2026-11-02T12:10:00.000Z',
      signInPaths: ['/login', '/signin'],
      chromeMajor: 154,
      appCookies: 'persistent',
    },
  ])
  assert.deepEqual(
    test.statuses.map((status) => status?.phase),
    ['starting', 'open', 'finishing', undefined],
  )
  assert.equal(
    test.notices.at(-1)?.message,
    'Saved session for shop. Runs can now start with it; a run still checks the page before it acts.',
  )
})

// protects=DES-2 Close setup -> confirmed false, d5; fails_when=the profile is treated as saved, or no record is written; no_claim=lane B's refusal text
test('Close setup writes confirmed false, keeps the folder and says runs will not use it until Done', async () => {
  // Arrange
  const test = harness()
  await test.setup.start(INPUT)
  // Act
  test.chooseInOffer('Close setup')
  await flush()
  await flush()
  // Assert
  assert.equal(test.records[0]?.confirmed, false)
  assert.equal(
    test.notices.at(-1)?.message,
    'Setup closed. Anything the browser saved stays in the saved session, but runs will not use it until you finish setup with Done.',
  )
  assert.equal(test.releases(), 1)
})

// protects=E11/DES-2 closing the browser; fails_when=closing the window does not end the setup as not finished; no_claim=Chrome's own target events
test('the learner closing the Codebook browser window ends the setup as Close setup', async () => {
  // Arrange
  const test = harness()
  await test.setup.start(INPUT)
  // Act
  test.learnerClosesWindow()
  await flush()
  await flush()
  // Assert
  assert.equal(test.records[0]?.confirmed, false)
  assert.equal(test.setup.phase?.phase, 'ended')
})

// protects=DES-2 minute 8 and the 10-minute limit; fails_when=either fires early, late or not at all; no_claim=wall-clock timers
test('after 8 minutes setup warns that it closes in 2 minutes, and after 10 minutes it closes as not finished', async () => {
  // Arrange
  const test = harness()
  await test.setup.start(INPUT)
  // Act / Assert
  test.clock.advance(479_999)
  assert.equal(test.logs.includes('warned'), false)
  test.clock.advance(1)
  assert.equal(test.logs.includes('warned'), true)
  test.clock.advance(120_000)
  await flush()
  await flush()
  assert.equal(test.records[0]?.confirmed, false)
  assert.ok(
    test.logs.includes('info: Saved session setup: timed-out for shop.'),
  )
})

// protects=CEO-R2, Codex 4 (the setup server stops on every exit path); fails_when=a record is written, the server keeps running, the folder stays locked, or the cause carries the folder path; no_claim=real adapter errors
test('a setup whose browser fails to start stops the server, writes no record and shows the cause without the folder path', async () => {
  // Arrange
  const test = harness({
    launchError: new Error(`Chrome ended before it was ready at ${PROFILE}.`),
  })
  // Act
  await test.setup.start(INPUT)
  // Assert
  assert.equal(test.serverCloses(), 1)
  assert.deepEqual(test.records, [])
  assert.equal(test.releases(), 1)
  assert.deepEqual(test.notices, [
    {
      severity: 'error',
      message:
        'Setup could not start: Chrome ended before it was ready at <saved-session>.. See Output › Codebook.',
      actions: ['Show log'],
    },
  ])
})

// protects=E7, CEO-S35; fails_when=a second Chrome opens although the store refused; no_claim=real windows
test('setup refused by the store because another setup is open starts no server and no browser', async () => {
  // Arrange
  const test = harness({
    acquireError: new StudyError(
      'SIGN_IN_IN_PROGRESS',
      'A saved-session setup is open in another window.',
    ),
  })
  // Act
  await test.setup.start(INPUT)
  // Assert
  assert.deepEqual(test.calls, ['acquire'])
  assert.equal(
    test.notices[0]?.message,
    'A saved-session setup is open in another window.',
  )
})

// protects=honest Done (open question 5); fails_when=confirmed true after a forced close; no_claim=cookie loss itself
test('a Done whose browser had to be forced closed writes confirmed false and says the session was not saved', async () => {
  // Arrange
  const test = harness({ closeResults: ['forced'] })
  await test.setup.start(INPUT)
  // Act
  await test.setup.done()
  // Assert
  assert.equal(test.records[0]?.confirmed, false)
  assert.equal(
    test.notices.at(-1)?.message,
    'Setup could not save the session: the Codebook browser did not close in time. Set it up again.',
  )
})

// protects=Codex 4 (an unconfirmed exit keeps the lock and can be retried; the server still stops); fails_when=the folder is released or the record written while the exit is unproven, or a retry is impossible; no_claim=real processes
test('a browser exit that cannot be confirmed keeps the folder locked, stops the server, and a retry then saves', async () => {
  // Arrange
  const test = harness({ closeResults: ['unconfirmed', 'graceful'] })
  await test.setup.start(INPUT)
  // Act
  await test.setup.done()
  const phaseAfterFirst = test.setup.phase?.phase
  const releasesAfterFirst = test.releases()
  const recordsAfterFirst = test.records.length
  await test.setup.closeSetup('closed')
  // Assert
  assert.equal(phaseAfterFirst, 'stuck')
  assert.equal(releasesAfterFirst, 0)
  assert.equal(recordsAfterFirst, 0)
  assert.equal(test.serverCloses(), 1)
  assert.equal(test.releases(), 1)
  assert.equal(test.records.length, 1)
})

// protects=Codex 4 (server stops in its own finally); fails_when=a record write failure leaves the server running or the folder locked; no_claim=real disk errors
test('a record that cannot be written still releases the folder, stops the server and tells the learner to set up again', async () => {
  // Arrange
  const test = harness({ writeError: new Error('disk full') })
  await test.setup.start(INPUT)
  // Act
  await test.setup.done()
  // Assert
  assert.equal(test.serverCloses(), 1)
  assert.equal(test.releases(), 1)
  assert.equal(
    test.notices.at(-1)?.message,
    'Setup could not save the session. Set it up again.',
  )
})

// protects=CEO-R7; fails_when=a log line holds the folder path or the store hash; no_claim=Output channel rendering
test('setup log lines name start, route, Done and failure, and never a folder path', async () => {
  // Arrange
  const test = harness()
  await test.setup.start(INPUT)
  // Act
  await test.setup.done()
  // Assert
  assert.deepEqual(test.logs, [
    'info: Saved session setup: starting for shop.',
    'info: Saved session setup: open at /login.',
    'info: Saved session setup: done for shop.',
  ])
})
