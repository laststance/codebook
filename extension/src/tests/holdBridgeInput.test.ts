import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { test } from 'node:test'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { holdBridgeInput } from '../utils/holdBridgeInput'
import type { RunClock } from '../utils/runningTimeLimit'

import { createManualClock } from './utils/createManualClock'

/** A stand-in for a bridge's stdin whose chunks the test pushes. */
function standInInput(): Readable {
  return new Readable({ read: () => undefined })
}

/**
 * A clock the test moves by hand for the wait at a held input's limit.
 * @returns The clock to hand to {@link holdBridgeInput}; `advance`, which moves it and runs every wait that falls due by then ({@link createManualClock}); `readLaterBy`, which moves only what the clock reads, as a busy event loop that has not run a due timer yet; and `readEarlierBy`, which moves what the clock reads back, as Node running a timer a little before the monotonic clock reads its end.
 * @example
 * const time = handMovedClock()
 * time.readLaterBy(5_000) // now() reads 5_000, no wait has run
 * time.readEarlierBy(2) // now() reads 4_998; a wait due at 5_000 runs when advance reaches 5_000
 */
function handMovedClock(): {
  clock: RunClock
  advance: (milliseconds: number) => void
  readLaterBy: (milliseconds: number) => void
  readEarlierBy: (milliseconds: number) => void
} {
  const manual = createManualClock()
  let readAheadMs = 0
  return {
    clock: {
      now: () => manual.now() + readAheadMs,
      set: (callback, delayMs) => {
        const id = manual.setTimeout(callback, delayMs)
        return (): void => manual.clearTimeout(id)
      },
    },
    advance: (milliseconds): void => manual.advance(milliseconds),
    readLaterBy: (milliseconds): void => {
      readAheadMs += milliseconds
    },
    readEarlierBy: (milliseconds): void => {
      readAheadMs -= milliseconds
    },
  }
}

/** Reads `stream` from now on, as the bridge's next reader does, and returns the chunks it emits as text, one entry per chunk. */
function readChunks(stream: Readable): string[] {
  const chunks: string[] = []
  stream.on('data', (chunk: Buffer) => chunks.push(chunk.toString('utf8')))
  // A stream left paused on purpose does not start again for a new data listener alone.
  stream.resume()
  return chunks
}

// Value: protects=the bridge's next reader (its stdio transport, or the Devin bridge's next attempt) getting every chunk its startup hold read, each whole and in the order it came, ahead of what came after (Cycle 0146 /ship pass 1, Codex review of the FB design); fails_when=putBack joins the chunks into one, drops one or puts them back in reverse; no_claim=process.stdin's own pause (the bridge child-process tests)
test('a held bridge input gives every chunk it read back whole and in order, ahead of the input that came after', async () => {
  // Arrange
  const input = standInInput()
  const hold = holdBridgeInput(input, () => undefined)
  input.push(Buffer.from('first'))
  input.push(Buffer.from('second'))
  await waitUntil(
    () => input.readableLength === 0,
    'the hold reading both chunks',
    2_000,
    undefined,
    5,
  )
  // Act
  hold.putBack()
  input.push(Buffer.from('third'))
  const chunks = readChunks(input)
  await waitUntil(
    () => chunks.length === 3,
    'the next reader getting the three chunks',
    2_000,
    undefined,
    5,
  )
  // Assert
  assert.deepEqual(chunks, ['first', 'second', 'third'])
})

// Value: protects=a bound on what the bridge keeps from its client before it serves: it stops reading once it holds its limit, keeps the chunk that reached the limit whole, and loses nothing it did not read (Cycle 0146 /ship pass 1, Codex review of the FB design); fails_when=the hold reads on past the limit (memory without bound while the first handshake waits), or splits or drops a chunk at the limit; no_claim=the limit's size (BRIDGE_STARTUP_INPUT_LIMIT_BYTES)
test('a held bridge input stops reading at its limit and loses no chunk', async () => {
  // Arrange
  const input = standInInput()
  const hold = holdBridgeInput(input, () => undefined, 4)
  input.push(Buffer.from('abc'))
  input.push(Buffer.from('de'))
  await waitUntil(
    () => input.isPaused(),
    'the hold stopping at its limit',
    2_000,
    undefined,
    5,
  )
  // Act
  input.push(Buffer.from('fg'))
  const unreadAtLimit = input.readableLength
  hold.putBack()
  const chunks = readChunks(input)
  await waitUntil(
    () => chunks.length === 3,
    'the next reader getting the three chunks',
    2_000,
    undefined,
    5,
  )
  // Assert
  assert.equal(unreadAtLimit, 2)
  assert.deepEqual(chunks, ['abc', 'de', 'fg'])
})

// Value: protects=a stop that began before the hold (an input that already ended) being reported at once, so the bridge starts no first handshake for a client that has gone (Cycle 0146 /ship pass 1, Codex review of the FB design, Q2); fails_when=the hold waits for an end event that was already emitted, so the stop is never seen; no_claim=an end or an error that comes while held (the bridge child-process tests)
test('holding a bridge input that already ended reports its end at once', async () => {
  // Arrange
  const input = standInInput()
  readChunks(input)
  input.push(null)
  await waitUntil(
    () => input.readableEnded,
    'the input ending',
    2_000,
    undefined,
    5,
  )
  let ends = 0
  // Act
  holdBridgeInput(input, () => {
    ends += 1
  })
  // Assert
  assert.equal(ends, 1)
})

// Value: protects=a held input past its limit ending the first handshake 5 s after it reached the limit, also with the client still connected, once (Cycle 0147 task 8); fails_when=the hold pauses at the limit and waits for an end it cannot see (process.stdin emits none while paused with unread input), or reports at the limit itself, or twice; no_claim=process.stdin's own pause and the bridge's exit (the bridge child-process tests)
test('a held bridge input that stays at its limit while its client is still connected reports its input over 5 seconds after it reached the limit, and not before', async () => {
  // Arrange
  const input = standInInput()
  const time = handMovedClock()
  let overs = 0
  holdBridgeInput(
    input,
    () => {
      overs += 1
    },
    4,
    time.clock,
  )
  input.push(Buffer.from('abcd'))
  await waitUntil(
    () => input.isPaused(),
    'the hold stopping at its limit',
    2_000,
    undefined,
    5,
  )
  // Stays unread: the hold no longer reads.
  input.push(Buffer.from('e'))
  // Act
  time.advance(4_999)
  const oversAt4999Ms = overs
  time.advance(1)
  const oversAt5000Ms = overs
  time.advance(60_000)
  // Assert
  assert.equal(input.isPaused(), true)
  assert.equal(oversAt4999Ms, 0)
  assert.equal(oversAt5000Ms, 1)
  assert.equal(overs, 1)
})

// Value: protects=the promised 5 s after the input reached its limit holding when Node runs the wait's timer before the monotonic clock reads its end (measured with the production clock: 57 of 64 holds reported early, the earliest at 4,998.29 ms), so a first handshake that completes within those 5 s is not stopped (Cycle 0147 ship pass 1, Codex structured review holdBridgeInput.ts:132, outside-voice#9); fails_when=the timer's callback reports the input over without reading the clock again; no_claim=how early Node's real timer runs (the clock here is moved by hand)
test('a held bridge input whose limit wait timer runs before the clock reads 5 seconds reports its input over only once the clock reads 5 seconds', async () => {
  // Arrange
  const input = standInInput()
  const time = handMovedClock()
  let overs = 0
  holdBridgeInput(
    input,
    () => {
      overs += 1
    },
    4,
    time.clock,
  )
  input.push(Buffer.from('abcd'))
  await waitUntil(
    () => input.isPaused(),
    'the hold stopping at its limit',
    2_000,
    undefined,
    5,
  )
  // The wait's timer, due at 5,000 ms, runs while the clock reads 4,998 ms.
  time.readEarlierBy(2)
  // Act
  time.advance(5_000)
  const oversWhenTimerRanAt4998Ms = overs
  time.advance(1)
  const oversAt4999Ms = overs
  time.advance(1)
  const oversAt5000Ms = overs
  time.advance(60_000)
  // Assert
  assert.equal(oversWhenTimerRanAt4998Ms, 0)
  assert.equal(oversAt4999Ms, 0)
  assert.equal(oversAt5000Ms, 1)
  assert.equal(overs, 1)
})

// Value: protects=the Devin bridge's wait at the limit counted from the first attempt that reached it: its next attempt holds the same stream again and re-reads what was put back (Cycle 0147 task 8, Codex review F8.2); fails_when=each hold starts a fresh 5 s, so busy answers every few seconds postpone the stop to the end of the startup window; no_claim=Devin's attempt loop itself (the Devin bridge child-process test)
test('a bridge input held again after a put-back reports its input over 5 seconds after the first hold reached the limit, not 5 seconds after the second hold did', async () => {
  // Arrange
  const input = standInInput()
  const time = handMovedClock()
  let overs = 0
  const countOver = (): void => {
    overs += 1
  }
  const firstHold = holdBridgeInput(input, countOver, 4, time.clock)
  input.push(Buffer.from('abcd'))
  await waitUntil(
    () => input.isPaused(),
    'the first hold stopping at its limit',
    2_000,
    undefined,
    5,
  )
  time.advance(3_000)
  firstHold.putBack()
  // Act
  holdBridgeInput(input, countOver, 4, time.clock)
  await waitUntil(
    () => input.isPaused() && input.readableLength === 0,
    'the second hold reading the put-back input to its limit',
    2_000,
    undefined,
    5,
  )
  time.advance(1_999)
  const oversBeforeFirstLimitWaitEnds = overs
  time.advance(1)
  // Assert
  assert.equal(oversBeforeFirstLimitWaitEnds, 0)
  assert.equal(overs, 1)
})

// Value: protects=an attempt that starts after the wait at the limit passed being stopped before it sends any request, with no timer running between attempts, and a read error that comes before its release still handled (Cycle 0147 task 8, Codex review D14); fails_when=the next attempt waits another 5 s, a wait fires while nothing holds the input, or the hold reports the stop without an error listener so a read error crashes the bridge; no_claim=that no request is sent (runUnderAbortSignal refuses a step once its signal fired)
test('a bridge input whose limit wait passed between two holds reports its input over at once when held again, stays paused, and handles a read error that follows', async () => {
  // Arrange
  const input = standInInput()
  const time = handMovedClock()
  let overs = 0
  const countOver = (): void => {
    overs += 1
  }
  const firstHold = holdBridgeInput(input, countOver, 4, time.clock)
  input.push(Buffer.from('abcd'))
  await waitUntil(
    () => input.isPaused(),
    'the first hold stopping at its limit',
    2_000,
    undefined,
    5,
  )
  time.advance(4_000)
  firstHold.putBack()
  time.advance(2_000)
  const oversBetweenHolds = overs
  // Act
  holdBridgeInput(input, countOver, 4, time.clock)
  const oversAtSecondHold = overs
  const isPausedAtSecondHold = input.isPaused()
  // Listens to the close alone: events.once would add an error listener of its own, which the hold must provide.
  const closed = new Promise((resolve) => input.once('close', resolve))
  input.destroy(Object.assign(new Error('read EIO'), { code: 'EIO' }))
  // The error is emitted before the close.
  await closed
  // Assert
  assert.equal(oversBetweenHolds, 0)
  assert.equal(oversAtSecondHold, 1)
  assert.equal(isPausedAtSecondHold, true)
  assert.equal(overs, 1)
})

// Value: protects=a first handshake that fails within the wait handing the held input to the next reader as before, with no later stop (Cycle 0147 task 8, Codex review F8.3); fails_when=the wait survives the put-back and stops the bridge later, or the chunks come back reordered; no_claim=the stdio transport's own reading (the bridge child-process tests)
test('a held bridge input put back within 5 seconds of its limit gives its chunks back in order and never reports its input over', async () => {
  // Arrange
  const input = standInInput()
  const time = handMovedClock()
  let overs = 0
  const hold = holdBridgeInput(
    input,
    () => {
      overs += 1
    },
    4,
    time.clock,
  )
  input.push(Buffer.from('abc'))
  input.push(Buffer.from('de'))
  await waitUntil(
    () => input.isPaused(),
    'the hold stopping at its limit',
    2_000,
    undefined,
    5,
  )
  time.advance(4_999)
  // Act
  hold.putBack()
  input.push(Buffer.from('fg'))
  const chunks = readChunks(input)
  await waitUntil(
    () => chunks.length === 3,
    'the next reader getting the three chunks',
    2_000,
    undefined,
    5,
  )
  time.advance(60_000)
  // Assert
  assert.deepEqual(chunks, ['abc', 'de', 'fg'])
  assert.equal(overs, 0)
})

// Value: protects=a stop leaving no wait behind (Cycle 0147 task 8, Codex review F8.3); fails_when=the wait outlives the release and reports a second stop; no_claim=the process's exit (the bridge child-process tests)
test('a released bridge input never reports its input over after its limit wait would have passed', async () => {
  // Arrange
  const input = standInInput()
  const time = handMovedClock()
  let overs = 0
  const hold = holdBridgeInput(
    input,
    () => {
      overs += 1
    },
    4,
    time.clock,
  )
  input.push(Buffer.from('abcd'))
  await waitUntil(
    () => input.isPaused(),
    'the hold stopping at its limit',
    2_000,
    undefined,
    5,
  )
  time.advance(1_000)
  // Act
  hold.release()
  time.advance(60_000)
  // Assert
  assert.equal(overs, 0)
})

// Value: protects=a first handshake that settles only after the wait at the limit ended, while that wait's timer has not run yet (a busy event loop), counting as stopped at its settlement, so a late success is cut and released and a late failure ends as a stop (Cycle 0147 task 8, Codex review D14); fails_when=the settlement just stops the wait, so the handshake that came after the deadline wins; no_claim=that the bridge settles its handshake before its cleanup (the Cursor bridge child-process test)
test('a held bridge input whose first handshake settles after its limit wait ended, before that wait ran, counts as over at the settlement and reports it once', async () => {
  // Arrange
  const input = standInInput()
  const time = handMovedClock()
  let overs = 0
  const hold = holdBridgeInput(
    input,
    () => {
      overs += 1
    },
    4,
    time.clock,
  )
  input.push(Buffer.from('abcd'))
  await waitUntil(
    () => input.isPaused(),
    'the hold stopping at its limit',
    2_000,
    undefined,
    5,
  )
  time.readLaterBy(5_000)
  // Act
  const isOverAtSettlement = hold.settleHandshake()
  time.advance(60_000)
  // Assert
  assert.equal(isOverAtSettlement, true)
  assert.equal(overs, 1)
})

// Value: protects=a first handshake that settled within the wait (a refusal, a 5xx, a timeout) keeping its own outcome while its cleanup runs past the wait's end (Cycle 0147 task 8, Codex review F8.1); fails_when=the settlement leaves the wait armed, or judges a handshake by the end of its own time limit instead of the moment it settled, so a failure becomes a silent stop; no_claim=that the bridge settles its handshake before its cleanup (the Cursor bridge child-process test)
test('a held bridge input whose first handshake settled before its limit wait ended never reports that wait', async () => {
  // Arrange
  const input = standInInput()
  const time = handMovedClock()
  let overs = 0
  const hold = holdBridgeInput(
    input,
    () => {
      overs += 1
    },
    4,
    time.clock,
  )
  input.push(Buffer.from('abcd'))
  await waitUntil(
    () => input.isPaused(),
    'the hold stopping at its limit',
    2_000,
    undefined,
    5,
  )
  time.advance(4_000)
  // Act
  const isOverAtSettlement = hold.settleHandshake(15_000)
  time.advance(60_000)
  // Assert
  assert.equal(isOverAtSettlement, false)
  assert.equal(overs, 0)
})

// Value: protects=the Devin bridge's attempt time limit keeping its outcome (a dropped descriptor, then the end of the wait with exit code 1) when it ended before the wait at the limit, also when both have passed by the time its continuation runs (Cycle 0147 task 8, Codex review D14); fails_when=the settlement compares the wait's end with the moment the continuation ran, so the later wait wins over the earlier time limit; no_claim=Devin's outcome for that attempt (the Devin bridge child-process test)
test('a held bridge input whose first handshake ran to its own time limit before its limit wait ended keeps that outcome, also when both have passed by the settlement', async () => {
  // Arrange
  const input = standInInput()
  const time = handMovedClock()
  let overs = 0
  const hold = holdBridgeInput(
    input,
    () => {
      overs += 1
    },
    4,
    time.clock,
  )
  time.advance(1_000)
  input.push(Buffer.from('abcd'))
  await waitUntil(
    () => input.isPaused(),
    'the hold stopping at its limit',
    2_000,
    undefined,
    5,
  )
  // The handshake's own time limit ended at 4 s, the wait at the limit at 6 s; the clock reads 7 s and the wait has not run.
  time.readLaterBy(6_000)
  // Act
  const isOverAtSettlement = hold.settleHandshake(4_000)
  time.advance(60_000)
  // Assert
  assert.equal(isOverAtSettlement, false)
  assert.equal(overs, 0)
})

// Value: protects=a real end of the input during a failed first handshake's cleanup still ending the bridge as a stop: the end and error listeners stay until the release (Cycle 0147 task 8, Codex review F8.1); fails_when=settling the handshake stops watching the input; no_claim=signals (the bridge's existing SIGTERM tests)
test('a held bridge input whose first handshake settled still reports an end of its input', async () => {
  // Arrange
  const input = standInInput()
  const time = handMovedClock()
  let overs = 0
  const hold = holdBridgeInput(
    input,
    () => {
      overs += 1
    },
    4,
    time.clock,
  )
  input.push(Buffer.from('ab'))
  await waitUntil(
    () => input.readableLength === 0,
    'the hold reading the input',
    2_000,
    undefined,
    5,
  )
  hold.settleHandshake()
  // Act
  input.push(null)
  await waitUntil(
    () => input.readableEnded,
    'the input ending',
    2_000,
    undefined,
    5,
  )
  // Assert
  assert.equal(overs, 1)
})

// Value: protects=a later bridge invocation on the same live input starting its own count after the first connection took the held input over, and itself reading and keeping what comes after for its own next reader (Cycle 0147 task 8, Codex review D14; Cycle 0147 ship pass 1, Codex structured review holdBridgeInput.test.ts:493); fails_when=the hold remembers the limit's moment after the hand-over, so a later hold below the limit stops at once with no full input, or the later hold never reads (or drops) what comes after; no_claim=a second bridge in one process (the bridge holds its stdin until its first connection is up, once)
test('a bridge input handed over after it reached its limit lets a later hold of the same stream start below its limit without a wait', async () => {
  // Arrange
  const input = standInInput()
  const time = handMovedClock()
  let overs = 0
  const countOver = (): void => {
    overs += 1
  }
  const firstHold = holdBridgeInput(input, countOver, 4, time.clock)
  input.push(Buffer.from('abcd'))
  await waitUntil(
    () => input.isPaused(),
    'the first hold stopping at its limit',
    2_000,
    undefined,
    5,
  )
  time.advance(1_000)
  firstHold.settleHandshake()
  firstHold.handOver()
  const handedOverChunks: string[] = []
  const readHandedOver = (chunk: Buffer): void => {
    handedOverChunks.push(chunk.toString('utf8'))
  }
  input.on('data', readHandedOver)
  input.resume()
  await waitUntil(
    () => handedOverChunks.length === 1,
    'the next reader getting the handed-over chunk',
    2_000,
    undefined,
    5,
  )
  // That reader goes, as a stdio transport that closed, and leaves the input paused: from here on only the later hold can read it.
  input.off('data', readHandedOver)
  input.pause()
  time.advance(10_000)
  // Act
  const laterHold = holdBridgeInput(input, countOver, 4, time.clock)
  const oversAtLaterHold = overs
  input.push(Buffer.from('x'))
  // A hold that never reads leaves the chunk unread: the wait ends at its bound and the assertion below names it.
  await waitUntil(
    () => input.readableLength === 0,
    'the later hold reading the input',
    2_000,
    undefined,
    5,
  ).catch(() => undefined)
  const unreadAfterLaterHold = input.readableLength
  time.advance(60_000)
  laterHold.putBack()
  const laterChunks = readChunks(input)
  // A dropped chunk never comes: the wait ends at its bound and the assertion below names what the reader got.
  await waitUntil(
    () => laterChunks.length > 0,
    'the next reader getting the chunk the later hold read',
    2_000,
    undefined,
    5,
  ).catch(() => undefined)
  // Assert
  assert.deepEqual(handedOverChunks, ['abcd'])
  assert.equal(unreadAfterLaterHold, 0)
  assert.deepEqual(laterChunks, ['x'])
  assert.equal(oversAtLaterHold, 0)
  assert.equal(overs, 0)
})

// Value: protects=a later bridge invocation on the same live input starting its own count after a stop dropped what the earlier hold read, and keeping what it read for its next reader (Cycle 0147 task 8, Codex review D14; Cycle 0147 review round, CodeRabbit holdBridgeInput.test.ts:532-533); fails_when=the hold remembers the limit's moment after the release, so a later hold below the limit stops at once with no full input, or the later hold drops the chunk it read; no_claim=a second bridge in one process (a stopped bridge ends its process)
test('a bridge input released after it reached its limit lets a later hold of the same stream start below its limit without a wait', async () => {
  // Arrange
  const input = standInInput()
  const time = handMovedClock()
  let overs = 0
  const countOver = (): void => {
    overs += 1
  }
  const firstHold = holdBridgeInput(input, countOver, 4, time.clock)
  input.push(Buffer.from('abcd'))
  await waitUntil(
    () => input.isPaused(),
    'the first hold stopping at its limit',
    2_000,
    undefined,
    5,
  )
  // Act
  firstHold.release()
  time.advance(10_000)
  const laterHold = holdBridgeInput(input, countOver, 4, time.clock)
  const oversAtLaterHold = overs
  input.push(Buffer.from('x'))
  // A hold that reported its input over at once reads nothing, so either outcome ends the wait.
  await waitUntil(
    () => input.readableLength === 0 || overs > 0,
    'the later hold reading the input',
    2_000,
    undefined,
    5,
  )
  time.advance(60_000)
  laterHold.putBack()
  const chunks = readChunks(input)
  // A dropped chunk never comes: the wait ends at its bound and the assertion below names what the reader got.
  await waitUntil(
    () => chunks.length > 0,
    'the next reader getting the chunk the later hold read',
    2_000,
    undefined,
    5,
  ).catch(() => undefined)
  // Assert
  assert.equal(oversAtLaterHold, 0)
  assert.equal(overs, 0)
  assert.deepEqual(chunks, ['x'])
})

// Value: protects=a later hold of the same stream (the Devin bridge's next attempt) keeping the moment its stream reached the limit when an earlier hold that already handed its input over is handed over, released or put back again, so its wait still ends 5 s after that moment (Cycle 0147 review round, CodeRabbit holdBridgeInput.ts:193-195 and 200); fails_when=a repeated hand-over or release of an ended hold forgets the later hold's moment, so that hold's handshake settling past its wait wins (or its put-back lets the next attempt start a fresh 5 s wait); no_claim=that the bridge ends a hold twice (it ends each hold once)
test('a held bridge input keeps its limit wait when an earlier hold of the same stream that already handed its input over is ended again', async () => {
  // Arrange
  const input = standInInput()
  const time = handMovedClock()
  let overs = 0
  const countOver = (): void => {
    overs += 1
  }
  const firstHold = holdBridgeInput(input, countOver, 4, time.clock)
  input.push(Buffer.from('abcd'))
  await waitUntil(
    () => input.isPaused(),
    'the first hold stopping at its limit',
    2_000,
    undefined,
    5,
  )
  firstHold.settleHandshake()
  firstHold.handOver()
  time.advance(10_000)
  const laterHold = holdBridgeInput(input, countOver, 4, time.clock)
  // The later hold reads the handed-over chunk again and reaches the limit itself at 10 s, so its wait ends at 15 s.
  await waitUntil(
    () => input.isPaused() && input.readableLength === 0,
    'the later hold reading the handed-over input to its limit',
    2_000,
    undefined,
    5,
  )
  // Act
  firstHold.handOver()
  firstHold.release()
  firstHold.putBack()
  // The later hold's wait has ended and its timer has not run yet, as on a busy event loop.
  time.readLaterBy(5_000)
  const isOverAtSettlement = laterHold.settleHandshake()
  // Assert
  assert.equal(isOverAtSettlement, true)
  assert.equal(overs, 1)
})

// Value: protects=a bridge input released below its limit (a stop during the first handshake before 1 MiB came) starting no read after its release, once its error listener is gone, so a read error then cannot crash the bridge (Cycle 0147 review round, OCR lens 4 holdBridgeInput.ts:152); fails_when=the release resumes and pauses the stream although the hold never stopped at its limit, which sets process.stdin reading for one more tick with no error listener; no_claim=process.stdin's read stop after a hold that stopped at its limit (the Cursor bridge child-process tests that end with Cursor's stdin still open)
test('a bridge input released below its limit is not resumed after its release', async () => {
  // Arrange
  const input = standInInput()
  const hold = holdBridgeInput(input, () => undefined, 4)
  input.push(Buffer.from('ab'))
  await waitUntil(
    () => input.readableLength === 0,
    'the hold reading the input',
    2_000,
    undefined,
    5,
  )
  let resumesAfterRelease = 0
  input.on('resume', () => {
    resumesAfterRelease += 1
  })
  // Act
  hold.release()
  // A resume emits on the next tick, which runs before setImmediate.
  await new Promise((resolve) => setImmediate(resolve))
  // Assert
  assert.equal(resumesAfterRelease, 0)
  assert.equal(input.isPaused(), true)
})

// Value: protects=a bridge input put back below its limit (the Devin bridge's attempt that failed before 1 MiB came, before its next attempt holds the input again) starting no read after its put-back, once its error listener is gone, so a read error then cannot crash the bridge, while its chunk stays for the next reader (Cycle 0147 ship pass 1, adversarial-native#4 holdBridgeInput.ts:164); fails_when=the put-back resumes and pauses the stream although the hold never stopped at its limit, which sets process.stdin reading for one more tick with no error listener; no_claim=process.stdin's read stop after a put-back (the Cursor bridge child-process tests of a failed first handshake with Cursor's stdin still open)
test('a bridge input put back below its limit is not resumed after its put-back and keeps its chunk for the next reader', async () => {
  // Arrange
  const input = standInInput()
  const hold = holdBridgeInput(input, () => undefined, 4)
  input.push(Buffer.from('ab'))
  await waitUntil(
    () => input.readableLength === 0,
    'the hold reading the input',
    2_000,
    undefined,
    5,
  )
  let resumesAfterPutBack = 0
  input.on('resume', () => {
    resumesAfterPutBack += 1
  })
  // Act
  hold.putBack()
  // A resume emits on the next tick, which runs before setImmediate.
  await new Promise((resolve) => setImmediate(resolve))
  // Assert
  assert.equal(resumesAfterPutBack, 0)
  assert.equal(input.isPaused(), true)
  assert.equal(input.readableLength, 2)
})
