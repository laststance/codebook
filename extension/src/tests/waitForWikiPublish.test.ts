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

// Value: protects=the reason of a refusal when the chat stopped because a file of the learner is in the way; fails_when=a probe for blocking files that fails at the look after the reply's end is taken for "nothing blocks", so the watch ends as reply-ended and the run says the chat finished without publishing, with no word of the file; why_new=Cycle 0046 row 232; seam=the probe, which throws once
test('after the reply’s end a probe for blocking files that fails once is taken again, and the watch ends with the refusal’s files', async () => {
  // Arrange: the reply has ended; the probe fails at the first look and names the learner's file at the second.
  const replyEnded = new AbortController()
  replyEnded.abort()
  let probes = 0

  // Act
  const result = await waitForWikiPublish({
    startToken: 'old@1',
    readToken: async () => 'old@1',
    readPublished: async () => 'a1b2c3d4e5f6+0f9e8d7c',
    findBlockingFiles: async () => {
      probes += 1
      if (probes === 1) throw new Error('ENOENT: the stage folder vanished')
      return ['pages/notes.html']
    },
    replyEnded: replyEnded.signal,
    signal: new AbortController().signal,
    unreadableGraceMs: 10_000,
    timeoutMs: 900_000,
    pollMs: 2_000,
    now: () => 0,
    sleep: async () => {},
  })

  // Assert
  assert.deepEqual(result, { outcome: 'blocked', paths: ['pages/notes.html'] })
  assert.equal(probes, 2)
})

// Value: protects=a publish whose site is being replaced at the moment the chat's reply ends; fails_when=a publish token that cannot be read at the look after the reply's end is taken for "nothing new", so the watch ends as reply-ended before the new site can be read; why_new=Cycle 0046 row 232; seam=the token reader, which answers nothing once
test('after the reply’s end a publish token that cannot be read once is read again, and the watch ends with the publish', async () => {
  // Arrange: the reply has ended; the site is mid-replacement at the first look and published at the second.
  const replyEnded = new AbortController()
  replyEnded.abort()
  let reads = 0

  // Act
  const result = await waitForWikiPublish({
    startToken: 'old@1',
    readToken: async () => {
      reads += 1
      return reads === 1 ? undefined : 'new@2'
    },
    readPublished: async () => 'a1b2c3d4e5f6+0f9e8d7c',
    replyEnded: replyEnded.signal,
    signal: new AbortController().signal,
    unreadableGraceMs: 10_000,
    timeoutMs: 900_000,
    pollMs: 2_000,
    now: () => 0,
    sleep: async () => {},
  })

  // Assert
  assert.deepEqual(result, {
    outcome: 'published',
    token: 'new@2',
    published: 'a1b2c3d4e5f6+0f9e8d7c',
  })
  assert.equal(reads, 2)
})

// Value: protects=row 196 for a Wiki that has no publication record yet, whose token cannot be read from the start; fails_when=every unreadable token counts as a look that could not finish, so such a watch never ends at the reply's end and goes on to its bound; why_new=Cycle 0046 row 232; seam=none
test('a watch that started without a readable publish token still ends at the reply’s end when the token stays unreadable', async () => {
  // Arrange
  const replyEnded = new AbortController()
  replyEnded.abort()
  let nowMs = 0

  // Act
  const result = await waitForWikiPublish({
    startToken: undefined,
    readToken: async () => undefined,
    readPublished: async () => 'a1b2c3d4e5f6+0f9e8d7c',
    replyEnded: replyEnded.signal,
    signal: new AbortController().signal,
    unreadableGraceMs: 10_000,
    timeoutMs: 10_000,
    pollMs: 2_000,
    now: () => nowMs,
    sleep: async (delayMs) => {
      nowMs += delayMs
    },
  })

  // Assert: at the first look, before any sleep.
  assert.deepEqual(result, { outcome: 'reply-ended' })
  assert.equal(nowMs, 0)
})

// Value: protects=the end of a watch whose looks cannot finish; fails_when=a probe that fails at every look after the reply's end keeps the watch for good, past its bound; why_new=Cycle 0046 row 232; seam=the watch's clock, which its sleeps move
test('after the reply’s end a probe that fails at every look ends the watch at its bound as timed out, not before and not later', async () => {
  // Arrange
  const replyEnded = new AbortController()
  replyEnded.abort()
  let nowMs = 0

  // Act
  const result = await waitForWikiPublish({
    startToken: 'old@1',
    readToken: async () => 'old@1',
    readPublished: async () => 'a1b2c3d4e5f6+0f9e8d7c',
    findBlockingFiles: async () => {
      throw new Error('ENOENT: the stage folder vanished')
    },
    replyEnded: replyEnded.signal,
    signal: new AbortController().signal,
    unreadableGraceMs: 10_000,
    timeoutMs: 10_000,
    pollMs: 2_000,
    now: () => nowMs,
    sleep: async (delayMs) => {
      nowMs += delayMs
    },
  })

  // Assert
  assert.deepEqual(result, { outcome: 'timed-out' })
  assert.equal(nowMs, 10_000)
})

// Value: protects=the learner whose publisher failed between its two renames and left no Wiki folder, after the chat's reply ended; fails_when=a publish token that stays unreadable after the reply's end keeps the watch going to its 15 minute bound, so the page says "Updating LLM Wiki…" for 15 minutes before the run names the missing Wiki; why_new=Cycle 0047 row 30 (P3RT8); seam=the watch's clock, which its sleeps move; no_claim=the sentence the run's end words for the missing Wiki (classifyWikiUpdateEnd)
test('after the reply’s end a publish token that stays unreadable ends the watch as reply-ended once its grace passed, not at the 15 minute bound', async () => {
  // Arrange: the reply has ended, and the Wiki folder is gone, so no look can read the publish token.
  const replyEnded = new AbortController()
  replyEnded.abort()
  let nowMs = 0
  let reads = 0

  // Act
  const result = await waitForWikiPublish({
    startToken: 'old@1',
    readToken: async () => {
      reads += 1
      return undefined
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
    },
  })

  // Assert: looks at 0, 2, 4, 6, 8 and 10 seconds; the sixth one is past the grace.
  assert.deepEqual(result, { outcome: 'reply-ended' })
  assert.equal(nowMs, 10_000)
  assert.equal(reads, 6)
})

// Value: protects=a publish whose site is being replaced while the chat's reply is still open; fails_when=the grace of an unreadable publish token ends the watch, or makes later looks skip a site that came back, before the reply ended, so a publisher that restores the Wiki or publishes after a slow swap is not seen; why_new=Cycle 0047 row 30 (P3RT8), the side of the fix that must not change; seam=the watch's clock, which its sleeps move
test('while the reply is open a publish token that stays unreadable past its grace keeps the watch going, and the publish that follows ends it as published', async () => {
  // Arrange: no look can read the token for the first 20 seconds, and nothing is written meanwhile; the new site is there at 22 seconds.
  let nowMs = 0

  // Act
  const result = await waitForWikiPublish({
    startToken: 'old@1',
    readStamp: async () => (nowMs < 22_000 ? '-' : 'wiki=new'),
    readToken: async () => (nowMs < 22_000 ? undefined : 'new@2'),
    readPublished: async () => 'a1b2c3d4e5f6+0f9e8d7c',
    replyEnded: new AbortController().signal,
    signal: new AbortController().signal,
    unreadableGraceMs: 10_000,
    timeoutMs: 900_000,
    pollMs: 2_000,
    now: () => nowMs,
    sleep: async (delayMs) => {
      nowMs += delayMs
    },
  })

  // Assert
  assert.deepEqual(result, {
    outcome: 'published',
    token: 'new@2',
    published: 'a1b2c3d4e5f6+0f9e8d7c',
  })
  assert.equal(nowMs, 22_000)
})

// Value: protects=a publish whose token could not be read past its grace while nothing the stamp names changed (a read error of the moment, not a missing folder); fails_when=the look after the grace keeps its stamp, so every later look is skipped while the stamp stays the same, and the publish that becomes readable is never read: the watch ends as timed out or reply-ended over a site that was published; why_new=Cycle 0047 row 86 (CX-S1); seam=the watch's clock, which its sleeps move, and the stamp reader, which answers the same stamp at every look; no_claim=the run's end for a watch that timed out
test('while the reply is open a publish token that becomes readable after its grace with the same stamp as before is read, and the watch ends as published', async () => {
  // Arrange: no look can read the token for the first 20 seconds; the new publish can be read from 22 seconds on; the stamp never changes.
  let nowMs = 0

  // Act
  const result = await waitForWikiPublish({
    startToken: 'old@1',
    readStamp: async () => 'wiki=18:1790000000000:20481/3:1790000000000',
    readToken: async () => (nowMs < 22_000 ? undefined : 'new@2'),
    readPublished: async () => 'a1b2c3d4e5f6+0f9e8d7c',
    replyEnded: new AbortController().signal,
    signal: new AbortController().signal,
    unreadableGraceMs: 10_000,
    timeoutMs: 900_000,
    pollMs: 2_000,
    now: () => nowMs,
    sleep: async (delayMs) => {
      nowMs += delayMs
    },
  })

  // Assert
  assert.deepEqual(result, {
    outcome: 'published',
    token: 'new@2',
    published: 'a1b2c3d4e5f6+0f9e8d7c',
  })
  assert.equal(nowMs, 22_000)
})

// Value: protects=a site swap that begins anew after the publish token was readable for one look; fails_when=the grace of an unreadable token is counted from the first time it could not be read, also after a look read it again, so the look after the reply's end takes the second swap for no new publish and the watch ends as reply-ended before that publish lands; why_new=Cycle 0047 row 86 (TEST-7); seam=the watch's clock, which its sleeps move, and the watch's sleep, during which the test ends the reply; no_claim=a stamp reader, which the test leaves out
test('a publish token that cannot be read again after one look read it gets a new grace, so after the reply’s end the watch waits for the second swap and ends as published', async () => {
  // Arrange: the token cannot be read from 0 to 6 seconds, is read at 8 seconds, cannot be read from 10 to 18 seconds, and names the new publish at 20 seconds; the reply ends at 12 seconds.
  const replyEnded = new AbortController()
  let nowMs = 0
  const tokenAt = (moment: number): string | undefined => {
    if (moment === 8_000) return 'old@1'
    return moment < 20_000 ? undefined : 'new@2'
  }

  // Act
  const result = await waitForWikiPublish({
    startToken: 'old@1',
    readToken: async () => tokenAt(nowMs),
    readPublished: async () => 'a1b2c3d4e5f6+0f9e8d7c',
    replyEnded: replyEnded.signal,
    signal: new AbortController().signal,
    unreadableGraceMs: 10_000,
    timeoutMs: 900_000,
    pollMs: 2_000,
    now: () => nowMs,
    sleep: async (delayMs) => {
      nowMs += delayMs
      if (nowMs === 12_000) replyEnded.abort()
    },
  })

  // Assert
  assert.deepEqual(result, {
    outcome: 'published',
    token: 'new@2',
    published: 'a1b2c3d4e5f6+0f9e8d7c',
  })
  assert.equal(nowMs, 20_000)
})
