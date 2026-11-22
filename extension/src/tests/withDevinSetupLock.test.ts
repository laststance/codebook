import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import type * as lockModule from '../utils/withDevinSetupLock'

import { defer } from './utils/defer'
import { loadModule } from './utils/loadModule'
import { within } from './utils/within'

/**
 * Loads {@link lockModule.withDevinSetupLock} over a stand-in of the storage lock it takes (the module `./withStorageLock`), whose taking of the lock and whose release wait while the test holds them, as on a disk that stops answering.
 * Called by the tests of the setup lock's bounds below; each test loads its own copy, so no hold of one test reaches another.
 * @param holds - Which step of the storage lock waits for the test: `acquisition` before the lock is taken, `release` after the locked steps ended; a step left out goes on at once.
 * @returns The loaded lock; `storageLockEvents`, what the storage lock did in order (`lock taken`, `lock released`); and `letAcquisitionGo` and `letReleaseGo`, which let the held step go on.
 * @example
 * const storage = await devinSetupLockOverStalledStorage({ acquisition: true })
 * storage.letAcquisitionGo() // the lock is taken now
 */
async function devinSetupLockOverStalledStorage(holds: {
  acquisition?: boolean
  release?: boolean
}) {
  const acquisition = defer<void>()
  const release = defer<void>()
  // A step the test does not hold goes on at once.
  if (!holds.acquisition) acquisition.resolve()
  if (!holds.release) release.resolve()
  const storageLockEvents: string[] = []
  const loaded = await loadModule<typeof lockModule>(
    resolve(__dirname, '../utils/withDevinSetupLock.js'),
    {
      './withStorageLock': {
        withStorageLock: async <Value>(
          _directory: string,
          locked: () => Promise<Value>,
        ): Promise<Value> => {
          await acquisition.promise
          storageLockEvents.push('lock taken')
          try {
            return await locked()
          } finally {
            await release.promise
            storageLockEvents.push('lock released')
          }
        },
      },
    },
  )
  return {
    withDevinSetupLock: loaded.withDevinSetupLock,
    storageLockEvents,
    letAcquisitionGo: (): void => acquisition.resolve(),
    letReleaseGo: (): void => release.resolve(),
  }
}

// Value: protects=a Devin Desktop setup or removal whose setup lock storage never hands over answers with the try-again sentence 15 s after the call, and a lock taken after that answer runs no setup step and is released; fails_when=the call waits for the stalled taking of the lock for ever, so Set Up AI Chat or Remove Devin Desktop Setup never answers (Cycle 0146 task 1a), or a lock taken late runs the steps after the learner was told to try again, or keeps the lock; why_new=Cycle 0145 CodeRabbit H7 to H9 (the setup lock has no deadline); seam=a stand-in of the storage lock whose taking waits until the test lets it go; no_claim=a real stalled disk, and another window's held lock, whose bounded wait devinChatOnboarding.test.ts covers
test('a Devin Desktop setup whose setup lock storage never hands over refuses with the try-again sentence 15 seconds after the call, and a lock taken after that runs no step and is released', async () => {
  // Arrange
  const storage = await devinSetupLockOverStalledStorage({ acquisition: true })
  let stepRuns = 0
  const calledAtMs = performance.now()

  // Act
  const answer = await within(
    storage
      .withDevinSetupLock('/storage/devin-setup', async () => {
        stepRuns += 1
      })
      .then(
        () => 'ran',
        (error: Error) => error.message,
      ),
    17_000,
  )
  const answeredAfterMs = performance.now() - calledAtMs
  storage.letAcquisitionGo()
  await waitUntil(
    () => storage.storageLockEvents.includes('lock released'),
    'the release of the lock taken after the answer',
    2_000,
  )

  // Assert
  assert.deepEqual(
    { answer, stepRuns, storageLockEvents: storage.storageLockEvents },
    {
      answer:
        'Another Codebook window is changing the Devin Desktop setup. Try again in a moment.',
      stepRuns: 0,
      storageLockEvents: ['lock taken', 'lock released'],
    },
  )
  assert.ok(
    answeredAfterMs >= 14_900 && answeredAfterMs < 17_000,
    `the refusal came ${Math.round(answeredAfterMs)} ms after the call, not at the 15-second acquisition budget`,
  )
})

// Value: protects=a Devin Desktop setup whose own steps take longer than the acquisition budget runs them to their end and answers with their result; fails_when=the acquisition's 15-second timer keeps running once the lock is held, so a slow but healthy setup is cut and answered with the try-again sentence while its steps go on; why_new=Cycle 0146 task 1a (each timer starts at its own barrier, v2 design finding 10); seam=a stand-in of the storage lock that hands the lock over at once, and steps that last 16 s; no_claim=a setup whose steps never end, which stays unbounded here and is bounded by the window's own take-back budget
test('a Devin Desktop setup whose steps last 16 seconds runs them to their end and answers with their result', async () => {
  // Arrange
  const storage = await devinSetupLockOverStalledStorage({})
  let releaseStalledReports = 0

  // Act
  const answer = await within(
    storage
      .withDevinSetupLock(
        '/storage/devin-setup',
        async () => {
          // gstack-timing-ok: the steps must outlast the 15-second acquisition budget, which only elapsed time can show; a second past it
          await delay(16_000)
          return 'set up'
        },
        undefined,
        {
          onReleaseStalled: () => {
            releaseStalledReports += 1
          },
        },
      )
      .catch((error: Error) => error.message),
    18_000,
  )

  // Assert
  assert.deepEqual(
    {
      answer,
      releaseStalledReports,
      storageLockEvents: storage.storageLockEvents,
    },
    {
      answer: 'set up',
      releaseStalledReports: 0,
      storageLockEvents: ['lock taken', 'lock released'],
    },
  )
})

// Value: protects=a Devin Desktop setup whose setup lock release storage never finishes answers with its steps' result 3 s after they ended and reports the stalled release once, while the release goes on; fails_when=the call waits for the release for ever, so the command never answers although its steps are done (Cycle 0146 task 1a), or answers without telling the window that its release stalled; why_new=Cycle 0145 CodeRabbit H7 to H9 and the Codex second-model review 3 (the lock's release has no deadline); seam=a stand-in of the storage lock whose release waits until the test lets it go; no_claim=the Output line the window writes for the report, and the window's next hold, which waits for the release (withStorageLock.test.ts)
test('a Devin Desktop setup whose setup lock release never finishes answers with its result 3 seconds after its steps ended and reports the stalled release once', async () => {
  // Arrange
  const storage = await devinSetupLockOverStalledStorage({ release: true })
  let stepsEndedAtMs = 0
  let releaseStalledReports = 0

  // Act
  const answer = await within(
    storage
      .withDevinSetupLock(
        '/storage/devin-setup',
        async () => {
          stepsEndedAtMs = performance.now()
          return 'set up'
        },
        undefined,
        {
          onReleaseStalled: () => {
            releaseStalledReports += 1
          },
        },
      )
      .catch((error: Error) => error.message),
    5_000,
  )
  const answeredAfterMs = performance.now() - stepsEndedAtMs
  const storageLockEventsAtTheAnswer = [...storage.storageLockEvents]
  storage.letReleaseGo()
  await waitUntil(
    () => storage.storageLockEvents.includes('lock released'),
    'the release that went on after the answer',
    2_000,
  )

  // Assert
  assert.deepEqual(
    {
      answer,
      releaseStalledReports,
      storageLockEventsAtTheAnswer,
      storageLockEvents: storage.storageLockEvents,
    },
    {
      answer: 'set up',
      releaseStalledReports: 1,
      storageLockEventsAtTheAnswer: ['lock taken'],
      storageLockEvents: ['lock taken', 'lock released'],
    },
  )
  assert.ok(
    answeredAfterMs >= 2_900 && answeredAfterMs < 4_500,
    `the result came ${Math.round(answeredAfterMs)} ms after the steps ended, not at the 3-second release bound`,
  )
})

// Value: protects=a Devin Desktop setup or removal whose steps throw before they hand back a promise answers with that error and leaves no lock behind; fails_when=the call waits for a result such steps never give, so the command never answers although the lock was released (Cycle 0146 task 1a: the call waits for the steps' result before the release's bound); why_new=Cycle 0146 task 1a (the call now waits for the steps' result apart from the lock's run); seam=a stand-in of the storage lock that hands the lock over at once, and steps that throw at their call; no_claim=steps written as an async function, which never throw at their call (the setup and the removal of the window are such)
test('a Devin Desktop setup whose steps throw at their call answers with that error and releases the lock', async () => {
  // Arrange
  const storage = await devinSetupLockOverStalledStorage({})

  // Act
  const answer = await within(
    storage
      .withDevinSetupLock('/storage/devin-setup', (): never => {
        throw new Error('The setup steps could not start.')
      })
      .then(
        () => 'ran',
        (error: Error) => error.message,
      ),
    2_000,
  )

  // Assert
  assert.deepEqual(
    { answer, storageLockEvents: storage.storageLockEvents },
    {
      answer: 'The setup steps could not start.',
      storageLockEvents: ['lock taken', 'lock released'],
    },
  )
})
