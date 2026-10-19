import assert from 'node:assert/strict'
import { test } from 'node:test'

import { retryWhileBusy } from '../utils/retryWhileBusy'

// Value: protects=the removal of a managed run's own profile folder on Windows, where the system still holds a file of the ended browser for a moment: the removal is tried again after 100, 200 and 300 ms, as the recursive rm of Node.js did with maxRetries 3 and retryDelay 100, while any other answer (a file this user may not remove) ends it at once (R6, /ship third review); fails_when=a busy answer ends the removal at the first try, so a folder Windows releases a moment later stays, or the step is tried again after an answer no wait changes, or without end; why_new=the close's removal moved from rm to removeWithoutFollowing, which has no retries of its own; seam=the pause the function is given, which notes each wait
test('a step the system answers as busy is tried again after growing pauses until it succeeds or the retries are used up, and any other answer ends it at once', async () => {
  // Arrange
  const busy = (): Error =>
    Object.assign(new Error('EBUSY: resource busy or locked'), {
      code: 'EBUSY',
    })
  const refused = Object.assign(new Error('EACCES: permission denied'), {
    code: 'EACCES',
  })
  /** Runs a step that answers busy a given number of times, then succeeds, and notes the pauses before its retries. */
  const run = async (busyAnswers: number, otherAnswer?: Error) => {
    const pauses: number[] = []
    let tries = 0
    const outcome = await retryWhileBusy(
      async () => {
        tries += 1
        if (otherAnswer) throw otherAnswer
        if (tries <= busyAnswers) throw busy()
        return 'removed'
      },
      3,
      100,
      async (delayMs) => {
        pauses.push(delayMs)
      },
    ).catch((error: NodeJS.ErrnoException) => error.code)
    return { outcome, tries, pauses }
  }

  // Act
  const outcomes = {
    busyTwice: await run(2),
    busyThroughout: await run(9),
    refused: await run(0, refused),
  }

  // Assert
  assert.deepEqual(outcomes, {
    busyTwice: { outcome: 'removed', tries: 3, pauses: [100, 200] },
    busyThroughout: { outcome: 'EBUSY', tries: 4, pauses: [100, 200, 300] },
    refused: { outcome: 'EACCES', tries: 1, pauses: [] },
  })
})
