import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { StorageLockHeldError } from '../utils/storageLockHeldError'

import { devinSetupLockOverStalledStorage } from './utils/devinSetupLockOverStalledStorage'
import { within } from './utils/within'

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

// Value: protects=a Devin Desktop setup or removal whose steps throw at their call while the setup lock's release never finishes answers with that error 3 s after the call and reports the stalled release once, while the release goes on; fails_when=the call waits for the stalled release for ever, because the thrown error never reached the steps' result and only the lock's run, which waits for the release, could end the wait (Cycle 0146 task 25); why_new=Cycle 0146 review round, CodeRabbit passes 2 to 4 on withDevinSetupLock.ts:74; seam=a stand-in of the storage lock whose release waits until the test lets it go, and steps that throw at their call; no_claim=steps written as an async function, which never throw at their call (the window's setup and removal are such), and a real stalled disk
test('a Devin Desktop setup whose steps throw at their call while the lock release never finishes answers with that error 3 seconds after the call and reports the stalled release once', async () => {
  // Arrange
  const storage = await devinSetupLockOverStalledStorage({ release: true })
  let releaseStalledReports = 0
  const calledAtMs = performance.now()

  // Act
  const answer = await within(
    storage
      .withDevinSetupLock(
        '/storage/devin-setup',
        (): never => {
          throw new Error('The setup steps could not start.')
        },
        undefined,
        {
          onReleaseStalled: () => {
            releaseStalledReports += 1
          },
        },
      )
      .then(
        () => 'ran',
        (error: Error) => error.message,
      ),
    5_000,
  )
  const answeredAfterMs = performance.now() - calledAtMs
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
      answer: 'The setup steps could not start.',
      releaseStalledReports: 1,
      storageLockEventsAtTheAnswer: ['lock taken'],
      storageLockEvents: ['lock taken', 'lock released'],
    },
  )
  assert.ok(
    answeredAfterMs >= 2_900 && answeredAfterMs < 4_500,
    `the error came ${Math.round(answeredAfterMs)} ms after the call, not at the 3-second release bound`,
  )
})

// Value: protects=steps that throw a held-lock refusal at their call (a lock they take themselves) run once, and the call answers with that refusal as it is; fails_when=the setup lock's retry takes that refusal for a refusal of its own lock and runs the steps again, up to 70 times; why_new=Cycle 0146 review round, CodeRabbit pass 2 on withDevinSetupLock.ts:74 (only the taking of the lock is retried); seam=a stand-in of the storage lock that hands the lock over at once, and steps that throw the held-lock error at their call; no_claim=a held-lock refusal of steps that already started, which devinChatOnboarding.test.ts covers
test('a Devin Desktop setup whose steps throw a held-lock refusal at their call runs them once and answers with that refusal', async () => {
  // Arrange
  const storage = await devinSetupLockOverStalledStorage({})
  let stepRuns = 0

  // Act
  const answer = await within(
    storage
      .withDevinSetupLock('/storage/devin-setup', (): never => {
        stepRuns += 1
        throw new StorageLockHeldError('Learning storage is locked: config')
      })
      .then(
        () => 'ran',
        (error: Error) => error.message,
      ),
    2_000,
  )

  // Assert
  assert.deepEqual(
    { answer, stepRuns, storageLockEvents: storage.storageLockEvents },
    {
      answer: 'Learning storage is locked: config',
      stepRuns: 1,
      storageLockEvents: ['lock taken', 'lock released'],
    },
  )
})
