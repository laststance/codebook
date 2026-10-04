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

test('a Wiki update ends as published when the publish token changes and the new manifest is readable', async () => {
  // Arrange
  const clock = manualClock()
  const tokens = [undefined, 'old@1', 'new@2']
  const reads: Array<string | undefined> = []

  // Act
  const result = await waitForWikiPublish({
    startToken: 'old@1',
    readToken: async () => {
      const token = tokens.shift()
      reads.push(token)
      return token
    },
    readPublished: async () => 'a1b2c3d4e5f6+0f9e8d7c',
    signal: new AbortController().signal,
    timeoutMs: 900_000,
    pollMs: 2_000,
    ...clock,
  })

  // Assert
  assert.deepEqual(result, {
    outcome: 'published',
    token: 'new@2',
    published: 'a1b2c3d4e5f6+0f9e8d7c',
  })
  assert.equal(reads.length, 3)
})

test('a publish that keeps the same displayed identity is still seen, because the publish token changed', async () => {
  // Arrange
  const clock = manualClock()

  // Act
  const result = await waitForWikiPublish({
    startToken: 'dc9d3160@18',
    readToken: async () => 'ef714554@27',
    // The identity the page shows is the same before and after this publish.
    readPublished: async () => 'no-revision+0e819f59',
    signal: new AbortController().signal,
    timeoutMs: 900_000,
    pollMs: 2_000,
    ...clock,
  })

  // Assert
  assert.deepEqual(result, {
    outcome: 'published',
    token: 'ef714554@27',
    published: 'no-revision+0e819f59',
  })
  assert.equal(clock.now(), 0)
})

test('a changed manifest that cannot be read yet keeps the watch going until it can', async () => {
  // Arrange
  const clock = manualClock()
  const manifests = [undefined, undefined, 'a1b2c3d4e5f6+0f9e8d7c']

  // Act
  const result = await waitForWikiPublish({
    startToken: 'old@1',
    readToken: async () => 'new@2',
    readPublished: async () => manifests.shift(),
    signal: new AbortController().signal,
    timeoutMs: 900_000,
    pollMs: 2_000,
    ...clock,
  })

  // Assert
  assert.deepEqual(result, {
    outcome: 'published',
    token: 'new@2',
    published: 'a1b2c3d4e5f6+0f9e8d7c',
  })
  assert.equal(clock.now(), 4_000)
})

test('a Wiki update with no publish ends as timed out at the bound, not before', async () => {
  // Arrange
  const clock = manualClock()
  let looks = 0

  // Act
  const result = await waitForWikiPublish({
    startToken: 'old@1',
    readToken: async () => {
      looks += 1
      return 'old@1'
    },
    readPublished: async () => 'a1b2c3d4e5f6+0f9e8d7c',
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
    startToken: 'old@1',
    readToken: async () => {
      looks += 1
      return 'new@2'
    },
    readPublished: async () => 'a1b2c3d4e5f6+0f9e8d7c',
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
    startToken: undefined,
    readToken: async () => 'first@1',
    readPublished: async () => 'no-revision+0e819f59',
    signal: new AbortController().signal,
    timeoutMs: 900_000,
    pollMs: 2_000,
    ...clock,
  })

  // Assert
  assert.deepEqual(result, {
    outcome: 'published',
    token: 'first@1',
    published: 'no-revision+0e819f59',
  })
})

test(
  'cancelling while the watch is between two looks ends it at once instead of after the poll delay',
  { timeout: 5_000 },
  async () => {
    // Arrange
    const controller = new AbortController()

    // Act
    const result = await waitForWikiPublish({
      startToken: 'old@1',
      readToken: async () => {
        controller.abort()
        return 'old@1'
      },
      readPublished: async () => 'a1b2c3d4e5f6+0f9e8d7c',
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
    startToken: 'old@1',
    readToken: async () => 'old@1',
    readPublished: async () => 'a1b2c3d4e5f6+0f9e8d7c',
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

test('a publish that lands while the conflict probe runs ends the watch as published, not as a conflict over its new pages', async () => {
  // Arrange
  const clock = manualClock()
  // The first look reads the old site; the swap happens before the probe has listed the folder.
  const tokens = ['old@1', 'new@2', 'new@2']

  // Act
  const result = await waitForWikiPublish({
    startToken: 'old@1',
    readToken: async () => tokens.shift(),
    readPublished: async () => 'a1b2c3d4e5f6+0f9e8d7c',
    findBlockingFiles: async () => ['pages/new.html'],
    signal: new AbortController().signal,
    timeoutMs: 900_000,
    pollMs: 2_000,
    ...clock,
  })

  // Assert
  assert.deepEqual(result, {
    outcome: 'published',
    token: 'new@2',
    published: 'a1b2c3d4e5f6+0f9e8d7c',
  })
})

test('a conflict probe that fails because a folder vanished does not end the watch', async () => {
  // Arrange
  const clock = manualClock()
  const tokens = ['old@1', 'old@1', 'new@2']
  let probes = 0

  // Act
  const result = await waitForWikiPublish({
    startToken: 'old@1',
    readToken: async () => tokens.shift(),
    readPublished: async () => 'a1b2c3d4e5f6+0f9e8d7c',
    findBlockingFiles: async () => {
      probes += 1
      throw Object.assign(
        new Error("ENOENT: no such file or directory, scandir '/repo/wiki'"),
        { code: 'ENOENT' },
      )
    },
    signal: new AbortController().signal,
    timeoutMs: 900_000,
    pollMs: 2_000,
    ...clock,
  })

  // Assert
  assert.deepEqual(result, {
    outcome: 'published',
    token: 'new@2',
    published: 'a1b2c3d4e5f6+0f9e8d7c',
  })
  assert.equal(probes, 2)
  assert.equal(clock.now(), 4_000)
})

test('ten looks at a Wiki folder nobody wrote to read the manifest once and walk the folder once', async () => {
  // Arrange
  const clock = manualClock()
  const counts = { stamps: 0, manifestReads: 0, folderWalks: 0 }

  // Act
  const result = await waitForWikiPublish({
    startToken: 'old@1',
    readStamp: async () => {
      counts.stamps += 1
      return 'wiki=18:1790000000000:20481'
    },
    readToken: async () => {
      counts.manifestReads += 1
      return 'old@1'
    },
    readPublished: async () => 'a1b2c3d4e5f6+0f9e8d7c',
    findBlockingFiles: async () => {
      counts.folderWalks += 1
      return []
    },
    signal: new AbortController().signal,
    timeoutMs: 18_000,
    pollMs: 2_000,
    ...clock,
  })

  // Assert
  assert.deepEqual(result, { outcome: 'timed-out' })
  assert.deepEqual(counts, { stamps: 10, manifestReads: 1, folderWalks: 1 })
})

test('the watch looks again as soon as something was written, and sees the publish at that look', async () => {
  // Arrange
  const clock = manualClock()
  const stamps = [
    'wiki=18:1790000000000:20481',
    'wiki=18:1790000000000:20481',
    'wiki=27:1790000004000:20990',
  ]
  const tokens = ['old@1', 'new@2']

  // Act
  const result = await waitForWikiPublish({
    startToken: 'old@1',
    readStamp: async () => stamps.shift() ?? 'wiki=27:1790000004000:20990',
    readToken: async () => tokens.shift(),
    readPublished: async () => 'a1b2c3d4e5f6+0f9e8d7c',
    signal: new AbortController().signal,
    timeoutMs: 900_000,
    pollMs: 2_000,
    ...clock,
  })

  // Assert
  assert.deepEqual(result, {
    outcome: 'published',
    token: 'new@2',
    published: 'a1b2c3d4e5f6+0f9e8d7c',
  })
  assert.equal(clock.now(), 4_000)
  assert.deepEqual(tokens, [])
})

test('a new manifest that is not readable yet is looked at again although nothing more was written', async () => {
  // Arrange
  const clock = manualClock()
  const manifests = [undefined, 'a1b2c3d4e5f6+0f9e8d7c']

  // Act
  const result = await waitForWikiPublish({
    startToken: 'old@1',
    readStamp: async () => 'wiki=27:1790000004000:20990',
    readToken: async () => 'new@2',
    readPublished: async () => manifests.shift(),
    signal: new AbortController().signal,
    timeoutMs: 900_000,
    pollMs: 2_000,
    ...clock,
  })

  // Assert
  assert.deepEqual(result, {
    outcome: 'published',
    token: 'new@2',
    published: 'a1b2c3d4e5f6+0f9e8d7c',
  })
  assert.equal(clock.now(), 2_000)
})
