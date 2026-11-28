import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { devinSetupLockOverStalledStorage } from './utils/devinSetupLockOverStalledStorage'
import { within } from './utils/within'

// Value: protects=a Devin Desktop setup or removal whose setup lock was refused by another window's lock and whose next taking storage never hands over answers 15 s after the call that another Codebook window was changing the setup and that storage has not answered since, and runs no step; fails_when=the answer says that another window is changing the setup although that window may have released the lock while the next taking waited on storage (Cycle 0146 /ship pass 1, Codex structured review P2 on withDevinSetupLock.ts:104), or a wait that saw another window's lock is answered as a storage that does not answer with no other window seen (Cycle 0146 task 27), or the call waits for the stalled taking for ever; why_new=Cycle 0146 task 27, and that P2 (expected answer changed from the held-lock sentence); seam=a stand-in of the storage lock that refuses the first taking with the held-lock error and holds the next until the test lets it go; no_claim=a real other window, whose held lock devinChatOnboarding.test.ts covers with a separate process, and whether the other window still holds the lock, which nothing here reads
test('a Devin Desktop setup refused once by another window lock whose next taking storage never hands over answers 15 seconds after the call that the other window was changing the setup and storage has not answered since', async () => {
  // Arrange
  const storage = await devinSetupLockOverStalledStorage({
    acquisition: true,
    heldRefusals: 1,
  })
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
        'Another Codebook window was changing the Devin Desktop setup, and storage has not answered since Codebook tried to take the setup lock again. Try again in a moment, or reload the window.',
      stepRuns: 0,
      storageLockEvents: ['lock refused', 'lock taken', 'lock released'],
    },
  )
  assert.ok(
    answeredAfterMs >= 14_900 && answeredAfterMs < 17_000,
    `the refusal came ${Math.round(answeredAfterMs)} ms after the call, not at the 15-second acquisition budget`,
  )
})

// Value: protects=a Devin Desktop setup or removal whose every taking of the setup lock another window's lock refuses, with a wait longer than the acquisition budget, answers 15 s after the call that another Codebook window is changing the setup, and takes no further taking after that answer; fails_when=the wait the caller gave up on goes on taking the lock between the held-lock refusals for its remaining attempts, so the window may take the lock after the learner was told to try again, or the answer between two refusals names a storage that does not answer; why_new=Cycle 0146 /ship pass 1, batched specialist finding 4 (no test reached the guard of an abandoned wait between held-lock refusals); seam=a stand-in of the storage lock that refuses every taking with the held-lock error, and a wait of 1,000 attempts 100 ms apart; no_claim=a real other window, whose held lock devinChatOnboarding.test.ts covers with a separate process, and the production wait of 70 attempts, which ends before the budget
test('a Devin Desktop setup whose every setup lock taking another window refuses answers 15 seconds after the call that another window is changing the setup and takes the lock no more', async () => {
  // Arrange
  const storage = await devinSetupLockOverStalledStorage({
    heldRefusals: Number.POSITIVE_INFINITY,
  })
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
        { attempts: 1_000, delayMs: 100 },
      )
      .then(
        () => 'ran',
        (error: Error) => error.message,
      ),
    17_000,
  )
  const answeredAfterMs = performance.now() - calledAtMs
  const takingsAtTheAnswer = storage.takingsStarted()
  // gstack-timing-ok: that no further taking starts can only be shown over elapsed time; three of the retry's longest pauses (200 ms each)
  await delay(600)
  const takingsAfterThreePauses = storage.takingsStarted()

  // Assert
  assert.deepEqual(
    {
      answer,
      stepRuns,
      takingsAfterTheAnswer: takingsAfterThreePauses - takingsAtTheAnswer,
    },
    {
      answer:
        'Another Codebook window is changing the Devin Desktop setup. Try again in a moment.',
      stepRuns: 0,
      takingsAfterTheAnswer: 0,
    },
  )
  assert.ok(
    answeredAfterMs >= 14_900 && answeredAfterMs < 17_000,
    `the refusal came ${Math.round(answeredAfterMs)} ms after the call, not at the 15-second acquisition budget`,
  )
})
