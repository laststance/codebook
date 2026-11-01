import assert from 'node:assert/strict'
import { test } from 'node:test'

import { StudyError } from '../errors'
import type { SignInRecordFields } from '../runtimeSupport/savedSessionSetupTypes'
import type { SignInBrowserCloseResult } from '../runtimeSupport/signInBrowser'
import { SignInBrowserStopUnconfirmedError } from '../runtimeSupport/utils/signInBrowserStopUnconfirmedError'
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
    /** One failure per release call, in order; a release with none left succeeds. */
    releaseErrors?: Error[]
    /** The folder is handed over only once this settles. */
    acquireGate?: Promise<void>
    /** The server never answers; it rejects once the start is cancelled. */
    serverWaitsForAbort?: boolean
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
  // Every Done notice stays answerable, as VS Code keeps notices with buttons in its notification center.
  const offers: ((choice: 'Done' | 'Close setup' | undefined) => void)[] = []
  const noticeAnswers: {
    message: string
    answer: (action: string | undefined) => void
  }[] = []
  let warn: (choice: 'Done' | undefined) => void = () => undefined
  let serverCloses = 0
  let releases = 0
  const releaseErrors = [...(options.releaseErrors ?? [])]
  const setup = new SavedSessionSetup({
    store: {
      acquireForSetup: async () => {
        calls.push('acquire')
        await options.acquireGate
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
            const releaseError = releaseErrors.shift()
            if (releaseError) throw releaseError
          },
        }
      },
    },
    startServer: async (_adapter, _path, signal) => {
      calls.push('startServer')
      if (options.serverWaitsForAbort)
        await new Promise<never>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason))
        })
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
          offers.push(resolve)
        }),
      warnClosingSoon: () =>
        new Promise((resolve) => {
          warn = resolve
          logs.push('warned')
        }),
      notify: (severity, message, ...actions) => {
        notices.push({ severity, message, actions })
        return new Promise((answer) => {
          noticeAnswers.push({ message, answer })
        })
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
    /** Answers a Done notice: the latest one unless `which` names an earlier one. */
    chooseInOffer: (
      choice: 'Done' | 'Close setup',
      which = offers.length - 1,
    ): void => offers[which]?.(choice),
    /** Presses a button of the earliest notice with this message. */
    pressInNotice: (message: string, action: string): void =>
      noticeAnswers
        .find((notice) => notice.message === message)
        ?.answer(action),
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

// protects=E7, CEO-S35, OCR 35 (the refusal says what to do next); fails_when=a second Chrome opens although the store refused, or the notice gives no next step; no_claim=real windows
test('setup refused by the store because another setup is open starts no server and no browser, and says to finish that setup first', async () => {
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
    'A saved-session setup is open in another window. Finish that setup with Done or close it with Close setup, then try again.',
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

const STUCK_NOTICE =
  'Setup could not confirm that the Codebook browser exited, so the saved session stays locked. Quit that browser, then retry.'
const DONE_NOTICE_FOR_SHOP =
  'Saved session for shop. Runs can now start with it; a run still checks the page before it acts.'

// protects=OCR 28 (a window closing while setup takes the folder starts nothing and frees the folder before the window goes); fails_when=the server or browser starts after the window closed, or dispose returns before the lock is released; no_claim=the agent server's own stop guard
test('closing the window while setup is still taking the folder starts no server or browser and frees the folder before the window goes', async () => {
  // Arrange
  let handOverFolder: () => void = () => undefined
  const test = harness({
    acquireGate: new Promise((resolve) => {
      handOverFolder = resolve
    }),
  })
  const starting = test.setup.start(INPUT)
  // Act
  const disposing = test.setup.dispose()
  handOverFolder()
  await disposing
  const releasesWhenDisposed = test.releases()
  await starting
  // Assert
  assert.equal(releasesWhenDisposed, 1)
  assert.deepEqual(test.calls, ['acquire', 'release'])
  assert.deepEqual(test.records, [])
  assert.deepEqual(test.notices, [])
  assert.equal(test.setup.phase?.phase, 'ended')
})

// protects=OCR 28 (dispose waits for a cancelled start's cleanup); fails_when=dispose returns before the folder is released, or a browser opens after the window closed; no_claim=the real dev server's own stop
test('closing the window while the app starts waits until setup freed the folder, and opens no browser', async () => {
  // Arrange
  const test = harness({ serverWaitsForAbort: true })
  void test.setup.start(INPUT)
  await flush()
  // Act
  await test.setup.dispose()
  // Assert
  assert.equal(test.releases(), 1)
  assert.deepEqual(test.calls, ['acquire', 'startServer', 'release'])
  assert.deepEqual(test.notices, [])
  assert.equal(test.setup.phase?.phase, 'ended')
})

// protects=OCR 29, E11 (Close setup while starting closes both and keeps the previous saved session); fails_when=Close setup is ignored while the app starts, a browser opens afterwards, or a record is written; no_claim=the status item's menu wording
test('Close setup while the app is still starting cancels the setup: no browser opens, no record is written and the folder is freed', async () => {
  // Arrange
  const test = harness({ serverWaitsForAbort: true })
  void test.setup.start(INPUT)
  await flush()
  // Act
  await test.setup.closeSetup('closed')
  // Assert
  assert.deepEqual(test.calls, ['acquire', 'startServer', 'release'])
  assert.deepEqual(test.records, [])
  assert.equal(test.setup.phase?.phase, 'ended')
  assert.deepEqual(
    test.notices.map((notice) => notice.message),
    [
      'Setup closed while it was starting, so the saved session was not changed.',
    ],
  )
  assert.ok(
    test.logs.includes('info: Saved session setup: cancelled for shop.'),
  )
})

// protects=OCR 27, OCR 38, Codex 4 (a launch failure whose browser stop is unconfirmed keeps the lock); fails_when=the folder is released while the browser may still run, a record is written, or Retry cannot free it; no_claim=real process listings
test('a setup whose browser fails to start and cannot be confirmed stopped keeps the folder locked, and Retry frees it once the browser is stopped', async () => {
  // Arrange
  let isBrowserStopped = false
  const test = harness({
    launchError: new SignInBrowserStopUnconfirmedError(
      new Error('Chrome did not answer within 20 s'),
      async () => isBrowserStopped,
    ),
  })
  // Act
  await test.setup.start(INPUT)
  const phaseAfterStart = test.setup.phase?.phase
  const releasesAfterStart = test.releases()
  test.pressInNotice(STUCK_NOTICE, 'Retry')
  await flush()
  const phaseAfterFirstRetry = test.setup.phase?.phase
  isBrowserStopped = true
  await test.setup.closeSetup('closed')
  // Assert
  assert.equal(phaseAfterStart, 'stuck')
  assert.equal(releasesAfterStart, 0)
  assert.equal(phaseAfterFirstRetry, 'stuck')
  assert.equal(test.serverCloses(), 1)
  assert.equal(test.releases(), 1)
  assert.deepEqual(test.records, [])
  assert.equal(test.setup.phase?.phase, 'ended')
  assert.deepEqual(
    test.notices.map((notice) => notice.message),
    [
      'Setup could not start: Chrome did not answer within 20 s. See Output › Codebook.',
      STUCK_NOTICE,
      STUCK_NOTICE,
      'The Codebook browser of the setup has stopped, so the saved session is free again. Set it up again when you are ready.',
    ],
  )
})

// protects=OCR 31 (a retry after a stuck Done keeps the learner's Done); fails_when=the retry writes confirmed false or drops the cookie kind read at Done; no_claim=real processes
test('a Done whose browser exit was first unconfirmed still saves a confirmed session when the retry then confirms the exit', async () => {
  // Arrange
  const test = harness({ closeResults: ['unconfirmed', 'graceful'] })
  await test.setup.start(INPUT)
  await test.setup.done()
  // Act
  await test.setup.closeSetup('closed')
  // Assert
  assert.deepEqual(test.records, [
    {
      confirmed: true,
      setupAt: '2026-11-02T12:10:00.000Z',
      signInPaths: ['/login', '/signin'],
      chromeMajor: 154,
      appCookies: 'persistent',
    },
  ])
  assert.equal(test.notices.at(-1)?.message, DONE_NOTICE_FOR_SHOP)
})

// protects=OCR 32 (notice answers are tied to their setup); fails_when=a late Close setup on an earlier setup's notice ends the setup open now and writes confirmed false; no_claim=VS Code's notification center
test('an answer to the Done notice of an earlier setup never ends the setup that is open now', async () => {
  // Arrange
  const test = harness()
  await test.setup.start(INPUT)
  await test.setup.done()
  await test.setup.start(INPUT)
  // Act
  test.chooseInOffer('Close setup', 0)
  await flush()
  // Assert
  assert.equal(test.setup.phase?.phase, 'open')
  assert.equal(test.records.length, 1)
})

// protects=OCR 32 (Retry is tied to the stuck setup that offered it); fails_when=an old Retry ends a later setup before sign-in and overwrites the saved session; no_claim=VS Code's notification center
test('Retry on the notice of an earlier stuck setup never ends the setup that is open now', async () => {
  // Arrange
  const test = harness({ closeResults: ['unconfirmed', 'graceful'] })
  await test.setup.start(INPUT)
  await test.setup.done()
  await test.setup.closeSetup('closed')
  await test.setup.start(INPUT)
  // Act
  test.pressInNotice(STUCK_NOTICE, 'Retry')
  await flush()
  // Assert
  assert.equal(test.setup.phase?.phase, 'open')
  assert.equal(test.records.length, 1)
})

const LOCK_STUCK_NOTICE_FOR_SHOP =
  'Setup could not unlock the saved session for shop, so it stays locked. See Output › Codebook, then retry.'

// protects=outside voice 4, Codex structured P2, OCR 33 (a failed lock release keeps the lease and offers Retry, never leaves the setup finishing, and says the session was saved only after the release); fails_when=the setup ends while the store still holds the lock, Done says runs can start before the lock is released, Retry does not release again, the record is written twice, or the cause names the folder; no_claim=the store's own release (signInProfile tests)
test('a lock release that fails after Done keeps the setup stuck with Retry, and says the session was saved only once Retry released the lock', async () => {
  // Arrange
  const test = harness({
    releaseErrors: [
      new Error(`EACCES: permission denied, unlink '${PROFILE}.lock'`),
    ],
  })
  await test.setup.start(INPUT)
  // Act
  await test.setup.done()
  const phaseAfterDone = test.setup.phase
  const noticesAfterDone = test.notices.map((notice) => notice.message)
  test.pressInNotice(LOCK_STUCK_NOTICE_FOR_SHOP, 'Retry')
  await flush()
  // Assert
  assert.deepEqual(phaseAfterDone, {
    phase: 'stuck',
    repositoryName: 'shop',
    stuckOn: 'lock-release',
  })
  assert.deepEqual(noticesAfterDone, [LOCK_STUCK_NOTICE_FOR_SHOP])
  assert.equal(test.releases(), 2)
  assert.equal(test.records.length, 1)
  assert.equal(test.setup.phase?.phase, 'ended')
  assert.deepEqual(
    test.notices.map((notice) => notice.message),
    [LOCK_STUCK_NOTICE_FOR_SHOP, DONE_NOTICE_FOR_SHOP],
  )
  assert.ok(
    test.logs.includes(
      "error: Saved session setup: the lock was not released: EACCES: permission denied, unlink '<saved-session>.lock'",
    ),
  )
})

// protects=outside voice 4 (the window closing releases a kept lock again); fails_when=the window closes while this window still holds a lock its setup could not release; no_claim=the store's hold bookkeeping
test('closing the window while a setup keeps a lock it could not release releases that lock again before the window goes', async () => {
  // Arrange
  const test = harness({
    releaseErrors: [new Error('EBUSY: resource busy or locked')],
  })
  await test.setup.start(INPUT)
  await test.setup.closeSetup('closed')
  const phaseAfterClose = test.setup.phase?.phase
  // Act
  await test.setup.dispose()
  // Assert
  assert.equal(phaseAfterClose, 'stuck')
  assert.equal(test.releases(), 2)
  assert.equal(test.setup.isActive, false)
  assert.deepEqual(
    test.records.map((record) => record.confirmed),
    [false],
  )
  assert.deepEqual(
    test.notices.map((notice) => notice.message),
    [LOCK_STUCK_NOTICE_FOR_SHOP],
  )
})

// protects=outside voice 4 on the start path; fails_when=a failed start whose lock release fails ends the setup while the lock is held, Retry cannot free it, or a record is written; no_claim=real processes
test('a start that fails and cannot release its lock stays locked with Retry, and Retry frees it without writing a record', async () => {
  // Arrange
  const test = harness({
    launchError: new Error('Chrome exited at once'),
    releaseErrors: [new Error('EPERM: operation not permitted')],
  })
  // Act
  await test.setup.start(INPUT)
  const phaseAfterStart = test.setup.phase?.phase
  test.pressInNotice(LOCK_STUCK_NOTICE_FOR_SHOP, 'Retry')
  await flush()
  // Assert
  assert.equal(phaseAfterStart, 'stuck')
  assert.equal(test.releases(), 2)
  assert.deepEqual(test.records, [])
  assert.equal(test.setup.phase?.phase, 'ended')
  assert.deepEqual(
    test.notices.map((notice) => notice.message),
    [
      'Setup could not start: Chrome exited at once. See Output › Codebook.',
      LOCK_STUCK_NOTICE_FOR_SHOP,
      'Setup unlocked the saved session and left it as it was. Set it up again when you are ready.',
    ],
  )
})

// protects=outside voice 5 (an answer is bound to the setup that showed its notice); fails_when=a Done answered on an earlier setup's warning ends the setup open now and saves a session the learner never confirmed; no_claim=VS Code's notification center
test('Done on the closing-soon warning of an earlier setup never ends the setup that is open now', async () => {
  // Arrange
  const test = harness()
  await test.setup.start(INPUT)
  test.clock.advance(480_000)
  await test.setup.closeSetup('closed')
  await test.setup.start(INPUT)
  // Act
  test.answerWarning()
  await flush()
  // Assert
  assert.equal(test.setup.phase?.phase, 'open')
  assert.deepEqual(
    test.records.map((record) => record.confirmed),
    [false],
  )
})

// protects=OCR 30, CEO-R7 (no folder path in a start failure, also before a lease is held); fails_when=the notice or the Output line names the home folder, the store or the repository hash; no_claim=every error text of Node
test('a setup that cannot prepare its folder names the failure without the folder path, also before the folder was handed over', async () => {
  // Arrange
  const storeFile =
    '/Users/learner/Library/Application Support/Code/User/globalStorage/laststance.codebook/sign-in-profiles/abc123/Default/Preferences.tmp'
  const test = harness({
    acquireError: Object.assign(
      new Error(`ENOSPC: no space left on device, open '${storeFile}'`),
      { code: 'ENOSPC', path: storeFile },
    ),
  })
  // Act
  await test.setup.start(INPUT)
  // Assert
  assert.deepEqual(test.notices, [
    {
      severity: 'error',
      message:
        "Setup could not start: ENOSPC: no space left on device, open '<saved-session>'. See Output › Codebook.",
      actions: ['Show log'],
    },
  ])
  assert.ok(
    test.logs.includes(
      "error: Saved session setup: could not start for shop: ENOSPC: no space left on device, open '<saved-session>'",
    ),
  )
  assert.equal(
    JSON.stringify([test.logs, test.notices]).includes('Application Support'),
    false,
  )
})

// protects=OCR 35 (a coded refusal at setup start gives the learner's next step); fails_when=an unusable saved session blocks every setup without saying to remove it first; no_claim=the chat's recovery text
test('a setup refused because the saved session is unusable tells the learner to remove it first', async () => {
  // Arrange
  const test = harness({
    acquireError: new StudyError(
      'SIGN_IN_PROFILE_UNUSABLE',
      'Codebook cannot use the saved session of shop (unreadable-record).',
    ),
  })
  // Act
  await test.setup.start(INPUT)
  // Assert
  assert.deepEqual(test.notices, [
    {
      severity: 'error',
      message:
        'Codebook cannot use the saved session of shop (unreadable-record). Run Codebook: Remove Saved Session…, then set it up again.',
      actions: [],
    },
  ])
})
