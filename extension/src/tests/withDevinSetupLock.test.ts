import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { setTimeout as delay, setImmediate } from 'node:timers/promises'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { StorageLockHeldError } from '../utils/storageLockHeldError'
import type * as lockModule from '../utils/withDevinSetupLock'

import { defer } from './utils/defer'
import { loadModule } from './utils/loadModule'
import { within } from './utils/within'

/**
 * Loads {@link lockModule.withDevinSetupLock} over a stand-in of the storage lock it takes (the module `./withStorageLock`), whose taking of the lock and whose release wait while the test holds them, as on a disk that stops answering.
 * Called by the tests of the setup lock's bounds below; each test loads its own copy, so no hold of one test reaches another.
 * @param holds - Which step of the storage lock waits for the test: `acquisition` before the lock is taken, `release` after the locked steps ended; a step left out goes on at once. `heldRefusals`: how many takings refuse first with a {@link StorageLockHeldError}, as while another window holds the lock (`Infinity` for every taking); none when left out.
 * @returns The loaded lock; `storageLockEvents`, what the storage lock did in order (`lock refused`, `lock taken`, `lock released`); `takingsStarted`, how many takings of the storage lock were started so far, also those still waiting; and `letAcquisitionGo` and `letReleaseGo`, which let the held step go on.
 * @example
 * const storage = await devinSetupLockOverStalledStorage({ acquisition: true })
 * storage.letAcquisitionGo() // the lock is taken now
 * await devinSetupLockOverStalledStorage({ acquisition: true, heldRefusals: 1 }) // one refusal, then a taking that waits
 * storage.takingsStarted() // => 1 while the first taking waits
 */
async function devinSetupLockOverStalledStorage(holds: {
  acquisition?: boolean
  release?: boolean
  heldRefusals?: number
}) {
  const acquisition = defer<void>()
  const release = defer<void>()
  // A step the test does not hold goes on at once.
  if (!holds.acquisition) acquisition.resolve()
  if (!holds.release) release.resolve()
  let heldRefusalsLeft = holds.heldRefusals ?? 0
  const storageLockEvents: string[] = []
  let takingsStarted = 0
  const loaded = await loadModule<typeof lockModule>(
    resolve(__dirname, '../utils/withDevinSetupLock.js'),
    {
      './withStorageLock': {
        withStorageLock: async <Value>(
          _directory: string,
          locked: () => Promise<Value>,
        ): Promise<Value> => {
          takingsStarted += 1
          // Another window's lock refuses the first takings, as the real storage lock does while it is held.
          if (heldRefusalsLeft > 0) {
            heldRefusalsLeft -= 1
            storageLockEvents.push('lock refused')
            throw new StorageLockHeldError(
              'Learning storage is locked by another writer',
            )
          }
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
    takingsStarted: (): number => takingsStarted,
    letAcquisitionGo: (): void => acquisition.resolve(),
    letReleaseGo: (): void => release.resolve(),
  }
}

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
