import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setImmediate } from 'node:timers/promises'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { devinSetupLockOverStalledStorage } from './utils/devinSetupLockOverStalledStorage'
import { within } from './utils/within'

// Value: protects=a Devin Desktop setup or removal whose setup lock storage never hands over, with no other window's lock seen, answers 15 s after the call that storage does not answer or this window is still finishing, and a lock taken after that answer runs no setup step and is released; fails_when=the call waits for the stalled taking of the lock for ever, so Set Up AI Chat or Remove Devin Desktop Setup never answers (Cycle 0146 task 1a), or the answer names another Codebook window that does not exist (Cycle 0146 task 27), or a lock taken late runs the steps after the learner was told to try again, or keeps the lock; why_new=Cycle 0145 CodeRabbit H7 to H9 (the setup lock has no deadline), and the Cycle 0146 review round's ocr-lens4 P2 and ocr-lens1 P3 (the held-lock sentence for a lock no window holds); seam=a stand-in of the storage lock whose taking waits until the test lets it go; no_claim=a real stalled disk, this window's own earlier hold that the queue of withStorageLock keeps the lock for, and another window's held lock, whose bounded wait devinChatOnboarding.test.ts covers
test('a Devin Desktop setup whose setup lock storage never hands over answers 15 seconds after the call that storage does not answer, and a lock taken after that runs no step and is released', async () => {
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
        'Codebook could not take its Devin Desktop setup lock because storage does not answer or this window is still finishing an earlier setup or removal. Try again in a moment, or reload the window.',
      stepRuns: 0,
      storageLockEvents: ['lock taken', 'lock released'],
    },
  )
  assert.ok(
    answeredAfterMs >= 14_900 && answeredAfterMs < 17_000,
    `the refusal came ${Math.round(answeredAfterMs)} ms after the call, not at the 15-second acquisition budget`,
  )
})

// Value: protects=the activation refresh's shorter acquisition budget bounds a setup lock taking that storage never hands over (or that this window's own earlier taking still holds), so the refresh refuses at that budget and the window's server still starts while the Devin bridge waits (Cycle 0146 /ship pass 2, red-team 2); fails_when=the budget the caller passes is ignored and the refresh waits the setup's 15 seconds; no_claim=another window's held lock (devinChatOnboarding covers the refresh's shorter wait for it); seam=a stand-in of the storage lock whose taking waits until the test lets it go
test('a Devin Desktop setup lock taking that storage never hands over answers at the shorter budget its caller passes', async () => {
  // Arrange
  const storage = await devinSetupLockOverStalledStorage({ acquisition: true })
  let stepRuns = 0
  const calledAtMs = performance.now()

  // Act
  const answer = await within(
    storage
      .withDevinSetupLock(
        '/storage/devin-setup',
        async () => {
          stepRuns += 1
        },
        undefined,
        { acquireBudgetMs: 5_000 },
      )
      .then(
        () => 'ran',
        (error: Error) => error.message,
      ),
    7_000,
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
    { answer, stepRuns },
    {
      answer:
        'Codebook could not take its Devin Desktop setup lock because storage does not answer or this window is still finishing an earlier setup or removal. Try again in a moment, or reload the window.',
      stepRuns: 0,
    },
  )
  assert.ok(
    answeredAfterMs >= 4_900 && answeredAfterMs < 7_000,
    `the refusal came ${Math.round(answeredAfterMs)} ms after the call, not at the 5-second budget the caller passed`,
  )
})

// Value: protects=a Devin Desktop setup or removal run again after the 15-second answer of a setup lock taking that still waits on storage starts no second taking while the first one waits, and once storage answers it takes the lock after the first taking was released and runs its steps once; fails_when=each try of the command starts another taking on the stalled disk (each creates the folder and reads its real path before the lock's own queue), so four tries hold the four threads of Node's file pool and every other file read of the window stops (Cycle 0146 /ship pass 1, Codex structured review P1 on withDevinSetupLock.ts:74); why_new=that finding; seam=a stand-in of the storage lock whose taking waits until the test lets it go and that counts the takings started; no_claim=a real stalled disk and Node's file pool itself, another window's takings, which its own process starts, and two lock folders, which never wait for each other
test('a Devin Desktop setup run again while the first setup lock taking still waits on storage starts no second taking and runs its steps once storage answers', async () => {
  // Arrange
  const storage = await devinSetupLockOverStalledStorage({ acquisition: true })
  const firstAnswer = await within(
    storage
      .withDevinSetupLock('/storage/devin-setup', async () => 'first ran')
      .catch((error: Error) => error.message),
    17_000,
  )
  let secondStepRuns = 0

  // Act
  const second = storage
    .withDevinSetupLock('/storage/devin-setup', async () => {
      secondStepRuns += 1
      return 'second ran'
    })
    .catch((error: Error) => error.message)
  // One turn of the event loop: a second taking would have started by now.
  await setImmediate()
  const takingsWhileTheFirstWaits = storage.takingsStarted()
  storage.letAcquisitionGo()
  const secondAnswer = await within(second, 2_000)

  // Assert
  assert.deepEqual(
    {
      firstAnswer,
      takingsWhileTheFirstWaits,
      secondAnswer,
      secondStepRuns,
      storageLockEvents: storage.storageLockEvents,
    },
    {
      firstAnswer:
        'Codebook could not take its Devin Desktop setup lock because storage does not answer or this window is still finishing an earlier setup or removal. Try again in a moment, or reload the window.',
      takingsWhileTheFirstWaits: 1,
      secondAnswer: 'second ran',
      secondStepRuns: 1,
      storageLockEvents: [
        'lock taken',
        'lock released',
        'lock taken',
        'lock released',
      ],
    },
  )
})
