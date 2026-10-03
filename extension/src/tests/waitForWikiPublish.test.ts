import assert from 'node:assert/strict'
import { test } from 'node:test'

import { waitForWikiPublish } from '../utils/waitForWikiPublish'

/** A clock the test advances only through the watcher's own sleeps. */
function manualClock() {
  let nowMs = 0
  return {
    now: () => nowMs,
    sleep: async (delayMs: number): Promise<void> => {
      nowMs += delayMs
    },
  }
}

test('a Wiki update ends as published when the manifest identity changes and the site is current', async () => {
  // Arrange
  const clock = manualClock()
  const identities = [undefined, 'old+1', 'new+2']
  const reads: Array<string | undefined> = []

  // Act
  const result = await waitForWikiPublish({
    startIdentity: 'old+1',
    readIdentity: async () => {
      const identity = identities.shift()
      reads.push(identity)
      return identity
    },
    isCurrent: async () => true,
    signal: new AbortController().signal,
    timeoutMs: 900_000,
    pollMs: 2_000,
    ...clock,
  })

  // Assert
  assert.deepEqual(result, { outcome: 'published', identity: 'new+2' })
  assert.equal(reads.length, 3)
})

test('a publish whose sources still differ from the project is reported as not current', async () => {
  // Arrange
  const clock = manualClock()

  // Act
  const result = await waitForWikiPublish({
    startIdentity: 'old+1',
    readIdentity: async () => 'new+2',
    isCurrent: async () => false,
    signal: new AbortController().signal,
    timeoutMs: 900_000,
    pollMs: 2_000,
    ...clock,
  })

  // Assert
  assert.deepEqual(result, { outcome: 'not-current', identity: 'new+2' })
})

test('a Wiki update with no publish ends as timed out at the bound, not before', async () => {
  // Arrange
  const clock = manualClock()
  let looks = 0

  // Act
  const result = await waitForWikiPublish({
    startIdentity: 'old+1',
    readIdentity: async () => {
      looks += 1
      return 'old+1'
    },
    isCurrent: async () => true,
    signal: new AbortController().signal,
    timeoutMs: 10_000,
    pollMs: 2_000,
    ...clock,
  })

  // Assert
  assert.deepEqual(result, { outcome: 'timed-out' })
  assert.equal(clock.now(), 10_000)
  assert.equal(looks, 6)
})

test('cancelling the watch ends it as cancelled without another look at the manifest', async () => {
  // Arrange
  const controller = new AbortController()
  controller.abort()
  let looks = 0

  // Act
  const result = await waitForWikiPublish({
    startIdentity: 'old+1',
    readIdentity: async () => {
      looks += 1
      return 'new+2'
    },
    isCurrent: async () => true,
    signal: controller.signal,
    timeoutMs: 900_000,
    pollMs: 2_000,
  })

  // Assert
  assert.deepEqual(result, { outcome: 'cancelled' })
  assert.equal(looks, 0)
})

test('a manifest that was unreadable when the update began counts any readable one as the publish', async () => {
  // Arrange
  const clock = manualClock()

  // Act
  const result = await waitForWikiPublish({
    startIdentity: undefined,
    readIdentity: async () => 'first+1',
    isCurrent: async () => true,
    signal: new AbortController().signal,
    timeoutMs: 900_000,
    pollMs: 2_000,
    ...clock,
  })

  // Assert
  assert.deepEqual(result, { outcome: 'published', identity: 'first+1' })
})

test(
  'cancelling while the watch is between two looks ends it at once instead of after the poll delay',
  { timeout: 5_000 },
  async () => {
    // Arrange
    const controller = new AbortController()

    // Act
    const result = await waitForWikiPublish({
      startIdentity: 'old+1',
      readIdentity: async () => {
        controller.abort()
        return 'old+1'
      },
      isCurrent: async () => true,
      signal: controller.signal,
      timeoutMs: 900_000,
      pollMs: 600_000,
    })

    // Assert
    assert.deepEqual(result, { outcome: 'cancelled' })
  },
)

test('a learner file that blocks the publisher ends the watch as blocked with its path before the bound', async () => {
  // Arrange
  const clock = manualClock()

  // Act
  const result = await waitForWikiPublish({
    startIdentity: 'old+1',
    readIdentity: async () => 'old+1',
    isCurrent: async () => true,
    findBlockingFiles: async () => ['pages/overview.html'],
    signal: new AbortController().signal,
    timeoutMs: 900_000,
    pollMs: 2_000,
    ...clock,
  })

  // Assert
  assert.deepEqual(result, {
    outcome: 'blocked',
    paths: ['pages/overview.html'],
  })
  assert.equal(clock.now(), 0)
})
