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
    unreadableGraceMs: 10_000,
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
    unreadableGraceMs: 10_000,
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
    unreadableGraceMs: 10_000,
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
    unreadableGraceMs: 10_000,
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
    unreadableGraceMs: 10_000,
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
    unreadableGraceMs: 10_000,
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
      unreadableGraceMs: 10_000,
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
    unreadableGraceMs: 10_000,
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
    unreadableGraceMs: 10_000,
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
    unreadableGraceMs: 10_000,
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
    unreadableGraceMs: 10_000,
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
    unreadableGraceMs: 10_000,
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
    unreadableGraceMs: 10_000,
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

test(
  'a watch cancelled between two looks ends at once, without waiting for the next look',
  { timeout: 5_000 },
  async () => {
    // Arrange
    const controller = new AbortController()
    // The cancel arrives while the watch sleeps between two looks: its timer has started.
    setTimeout(() => controller.abort(), 50)

    // Act
    const result = await Promise.race([
      waitForWikiPublish({
        startToken: 'old@1',
        readToken: async () => 'old@1',
        readPublished: async () => 'a1b2c3d4e5f6+0f9e8d7c',
        signal: controller.signal,
        unreadableGraceMs: 10_000,
        timeoutMs: 900_000,
        pollMs: 600_000,
      }),
      new Promise((resolveWait) =>
        setTimeout(() => resolveWait('still waiting for the next look'), 1_000),
      ),
    ])

    // Assert
    assert.deepEqual(result, { outcome: 'cancelled' })
  },
)

test('a cancel that arrives while the new manifest is being read ends the watch as cancelled, not as published', async () => {
  // Arrange
  const clock = manualClock()
  const controller = new AbortController()

  // Act
  const result = await waitForWikiPublish({
    startToken: 'old@1',
    readToken: async () => 'new@2',
    readPublished: async () => {
      // Reading the manifest hashes every source; the learner cancels meanwhile.
      controller.abort()
      return 'a1b2c3d4e5f6+0f9e8d7c'
    },
    signal: controller.signal,
    unreadableGraceMs: 10_000,
    timeoutMs: 900_000,
    pollMs: 2_000,
    ...clock,
  })

  // Assert
  assert.deepEqual(result, { outcome: 'cancelled' })
})

test('a new manifest that stays unreadable ends the watch after its grace, not at the 15 minute bound', async () => {
  // Arrange
  const clock = manualClock()
  let reads = 0

  // Act
  const result = await waitForWikiPublish({
    startToken: 'old@1',
    readToken: async () => 'new@2',
    readPublished: async () => {
      reads += 1
      return undefined
    },
    signal: new AbortController().signal,
    unreadableGraceMs: 10_000,
    timeoutMs: 900_000,
    pollMs: 2_000,
    ...clock,
  })

  // Assert
  assert.deepEqual(result, { outcome: 'unreadable', token: 'new@2' })
  // Looks at 0, 2, 4, 6, 8 and 10 seconds: the sixth one is past the grace.
  assert.equal(reads, 6)
  assert.equal(clock.now(), 10_000)
})

// Value: protects=the learner whose chat took up the update and then finished its reply without publishing; fails_when=the watch waits out its 15 minutes although the chat has said its last word; why_new=Cycle 0046 row 196; seam=the watch's sleep, during which the test ends the reply
test('a reply that ends while the watch waits ends the watch as reply-ended after one more look, 4 seconds into a 15 minute bound', async () => {
  // Arrange: the chat's reply ends during the second sleep of the watch.
  const replyEnded = new AbortController()
  let nowMs = 0
  let looks = 0
  const looksWhenTheReplyEnded: number[] = []

  // Act
  const result = await waitForWikiPublish({
    startToken: 'old@1',
    readToken: async () => {
      looks += 1
      return 'old@1'
    },
    readPublished: async () => 'a1b2c3d4e5f6+0f9e8d7c',
    replyEnded: replyEnded.signal,
    signal: new AbortController().signal,
    unreadableGraceMs: 10_000,
    timeoutMs: 900_000,
    pollMs: 2_000,
    now: () => nowMs,
    sleep: async (delayMs) => {
      nowMs += delayMs
      if (nowMs === 4_000) {
        looksWhenTheReplyEnded.push(looks)
        replyEnded.abort()
      }
    },
  })

  // Assert
  assert.deepEqual(result, { outcome: 'reply-ended' })
  assert.equal(nowMs, 4_000)
  assert.deepEqual(looksWhenTheReplyEnded, [2])
  assert.equal(looks, 3)
})

// Value: protects=a publish that lands in the same moment as the chat's complete reply; fails_when=the watch ends at the reply's end without a look after it, so the run is reported by what an earlier look saw; why_new=Cycle 0046 row 196; seam=the watch's sleep, during which the test publishes and ends the reply
test('a publish that lands in the same moment as the reply’s end is found by the look after it and ends the watch as published', async () => {
  // Arrange: during the first sleep the site is published and the reply ends.
  const replyEnded = new AbortController()
  let token = 'old@1'

  // Act
  const result = await waitForWikiPublish({
    startToken: 'old@1',
    readToken: async () => token,
    readPublished: async () => 'a1b2c3d4e5f6+0f9e8d7c',
    replyEnded: replyEnded.signal,
    signal: new AbortController().signal,
    unreadableGraceMs: 10_000,
    timeoutMs: 900_000,
    pollMs: 2_000,
    sleep: async () => {
      token = 'new@2'
      replyEnded.abort()
    },
  })

  // Assert
  assert.deepEqual(result, {
    outcome: 'published',
    token: 'new@2',
    published: 'a1b2c3d4e5f6+0f9e8d7c',
  })
})

// Value: protects=the time between the reply's end and the run's end; fails_when=the sleep between two looks does not end at the reply's end, so the learner waits up to two more seconds, or the sleep is given a signal that has already aborted and the watch spins; why_new=Cycle 0046 row 196; seam=the watch's sleep, whose signals the test records
test('the sleep between two looks ends at the reply’s end, and a manifest that is still being written after it is waited for at the usual pace', async () => {
  // Arrange: the reply has ended before the watch starts; the new manifest becomes readable at the third look.
  const replyEnded = new AbortController()
  replyEnded.abort()
  const sleepSignalsAborted: boolean[] = []
  let reads = 0

  // Act
  const result = await waitForWikiPublish({
    startToken: 'old@1',
    readToken: async () => 'new@2',
    readPublished: async () => {
      reads += 1
      return reads < 3 ? undefined : 'a1b2c3d4e5f6+0f9e8d7c'
    },
    replyEnded: replyEnded.signal,
    signal: new AbortController().signal,
    unreadableGraceMs: 10_000,
    timeoutMs: 900_000,
    pollMs: 2_000,
    now: () => 0,
    sleep: async (_delayMs, signal) => {
      sleepSignalsAborted.push(signal.aborted)
    },
  })

  // Assert
  assert.deepEqual(result, {
    outcome: 'published',
    token: 'new@2',
    published: 'a1b2c3d4e5f6+0f9e8d7c',
  })
  assert.deepEqual(sleepSignalsAborted, [false, false])
})

// Value: protects=a watched update while the chat's reply is still open; fails_when=the sleep is no longer ended by the reply's end, because it is given the watch's own signal only; why_new=Cycle 0046 row 196; seam=the watch's sleep, whose signal the test aborts through the reply's end
test('while the reply is open the sleep between two looks is given a signal that the reply’s end aborts', async () => {
  // Arrange
  const replyEnded = new AbortController()
  const abortedByTheReplysEnd: boolean[] = []

  // Act
  await waitForWikiPublish({
    startToken: 'old@1',
    readToken: async () => 'old@1',
    readPublished: async () => 'a1b2c3d4e5f6+0f9e8d7c',
    replyEnded: replyEnded.signal,
    signal: new AbortController().signal,
    unreadableGraceMs: 10_000,
    timeoutMs: 900_000,
    pollMs: 2_000,
    sleep: async (_delayMs, signal) => {
      replyEnded.abort()
      abortedByTheReplysEnd.push(signal.aborted)
    },
  })

  // Assert
  assert.deepEqual(abortedByTheReplysEnd, [true])
})
