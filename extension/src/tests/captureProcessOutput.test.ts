import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { test } from 'node:test'

import {
  captureProcessOutput,
  type ProcessOutputEvent,
} from '../utils/captureProcessOutput'
import { maskLearnerSecretText } from '../utils/maskLearnerSecretText'

/**
 * Builds the two output streams of a child process, as {@link captureProcessOutput} reads them.
 * @returns The streams, typed as the capture's input.
 * @example const child = fakeChild()
 */
function fakeChild(): {
  stdout: PassThrough
  stderr: PassThrough
} {
  return { stdout: new PassThrough(), stderr: new PassThrough() }
}

/**
 * Lets every queued stream callback run, so written chunks reach the capture before the next assertion.
 * @example await flushStreams()
 */
async function flushStreams(): Promise<void> {
  for (let round = 0; round < 3; round++)
    await new Promise<void>((resolve) => setImmediate(resolve))
}

// Value: protects=a capture whose delivery stalls or throws fails with the caller's own words instead of buffering without bound or losing the cause; fails_when=output past pendingLimitBytes is queued anyway, or a rejected onOutput leaves failure() empty; why_new=no test drives captureProcessOutput's failure paths, launchNodeTest/launchNodeServer only run it healthy; seam=none; no_claim=the owners' reaction to the failure (mocked streams; unit only)
test('output that outpaces a stalled delivery or whose delivery throws fails the capture with the caller wording', async () => {
  // Arrange
  const stalledChild = fakeChild()
  const stalledEvents: ProcessOutputEvent[] = []
  const stalled = captureProcessOutput(stalledChild, {
    startedAt: process.hrtime.bigint(),
    // A delivery that never settles keeps its bytes pending.
    onOutput: (event) => {
      stalledEvents.push(event)
      return new Promise<void>(() => {})
    },
    pendingLimitBytes: 10,
    overflowMessage: 'test capture failed: output outpaced its delivery.',
    failurePrefix: 'test capture failed',
  })
  const throwingChild = fakeChild()
  const throwing = captureProcessOutput(throwingChild, {
    startedAt: process.hrtime.bigint(),
    onOutput: () => {
      throw new Error('disk full')
    },
    pendingLimitBytes: 1_024,
    overflowMessage: 'unused',
    failurePrefix: 'test capture failed',
  })
  // Act
  stalledChild.stdout.write('aaaaaaa\n')
  await flushStreams()
  stalledChild.stdout.write('bbbbbbb\n')
  await flushStreams()
  throwingChild.stdout.write('hello\n')
  await flushStreams()
  await throwing.settled()
  // Assert
  assert.equal(
    stalled.failure()?.message,
    'test capture failed: output outpaced its delivery.',
  )
  assert.deepEqual(
    stalledEvents.map((event) => event.text),
    ['aaaaaaa\n'],
  )
  assert.equal(
    throwing.failure()?.message,
    'test capture failed: Error: disk full',
  )
})

// Value: protects=output events are cut by characters, never inside a surrogate pair, in order and stamped with the channel; fails_when=an emoji at the 4,096-character cut is split into lone surrogates or the sequence repeats/skips; why_new=no test feeds a chunk longer than one event; seam=none; no_claim=byte-exact tail truncation (not covered here; mocked streams; unit only)
test('an output chunk longer than one event is cut before an emoji that would straddle the limit', async () => {
  // Arrange
  const child = fakeChild()
  const events: ProcessOutputEvent[] = []
  const capture = captureProcessOutput(child, {
    startedAt: process.hrtime.bigint(),
    onOutput: (event) => {
      events.push(event)
    },
    pendingLimitBytes: 1_048_576,
    overflowMessage: 'unused',
    failurePrefix: 'test capture failed',
  })
  // Act
  child.stderr.write(`${'a'.repeat(4_095)}😀bbb\n`)
  await flushStreams()
  await capture.settled()
  // Assert
  assert.deepEqual(
    events.map((event) => ({
      sequence: event.sequence,
      channel: event.channel,
      text: event.text,
    })),
    [
      { sequence: 1, channel: 'stderr', text: 'a'.repeat(4_095) },
      { sequence: 2, channel: 'stderr', text: '😀bbb\n' },
    ],
  )
  assert.equal(capture.failure(), undefined)
})

// Value: protects=the capture keeps only the first 32 KiB raw (for the inspector announcement) and the last 32 KiB redacted (for causes), whatever the process prints; fails_when=a cap is removed, or the tail keeps the head instead of the end; why_new=no test prints more than 32 KiB through the shared capture; seam=none; no_claim=multibyte characters at the cut (mocked streams; unit only)
test('a process that prints more than 32 KiB keeps its first 32 KiB for the announcement and its last 32 KiB as the tail', async () => {
  // Arrange
  const child = fakeChild()
  const capture = captureProcessOutput(child, {
    startedAt: process.hrtime.bigint(),
    pendingLimitBytes: 1_048_576,
    overflowMessage: 'unused',
    failurePrefix: 'test capture failed',
  })
  // Act
  child.stdout.write(`HEAD\n${'x\n'.repeat(20_000)}TAIL\n`)
  await flushStreams()
  // Assert
  assert.equal(Buffer.byteLength(capture.announcement()), 32_768)
  assert.equal(capture.announcement().startsWith('HEAD\n'), true)
  assert.equal(capture.announcement().includes('TAIL'), false)
  assert.equal(Buffer.byteLength(capture.tail()), 32_768)
  assert.equal(capture.tail().endsWith('x\nTAIL\n'), true)
  assert.equal(capture.tail().includes('HEAD'), false)
})

// Value: protects=output keeps its arrival order across channels (pt1 Step 11 Codex structured finding: a partial line held by the redactor was delivered after later output, moving it past a debugger stop), for one word, for several, for a prompt that ends in a letter that begins no label and for a question; fails_when=a plain partial line, one word or several, a prompt ending in the letter `X`, or `Ready?`, is delivered after the other channel's later line; why_new=no test interleaved channels around a partial line; seam=none; no_claim=a partial line ending in the first letters of a Cookie or Authorization label (also the one letter c, a, s or p), or one word that may be a scheme or a secret cookie name, which still wait
for (const partialLine of ['before', 'before the stop', 'Type X', 'Ready?']) {
  test(`a partial plain line "${partialLine}" on stdout is delivered before a later stderr line`, async () => {
    // Arrange
    const child = fakeChild()
    const events: ProcessOutputEvent[] = []
    captureProcessOutput(child, {
      startedAt: process.hrtime.bigint(),
      onOutput: (event) => {
        events.push(event)
      },
      pendingLimitBytes: 1_048_576,
      overflowMessage: 'unused',
      failurePrefix: 'test capture failed',
    })
    // Act
    child.stdout.write(partialLine)
    await flushStreams()
    child.stderr.write('later\n')
    await flushStreams()
    child.stdout.write('\n')
    await flushStreams()
    // Assert
    assert.deepEqual(
      events.map((event) => [event.channel, event.text]),
      [
        ['stdout', partialLine],
        ['stderr', 'later\n'],
        ['stdout', '\n'],
      ],
    )
  })
}

/** The private roots the held-tail tests hide: the home directory only. */
const ADA_ROOTS = { storage: [], home: ['/Users/ada'] }

// Value: protects=a quiet channel's held start of a private root is released by the timer exactly once, hidden as the root's placeholder, and the stream's end then delivers nothing twice; fails_when=the timed release is never wired to the delivery, delivers raw '/Users/ad', or the end flushes the same text again; why_new=createRootHidingStage's timer is tested alone, nothing drives it through captureProcessOutput's delivery; seam=none; no_claim=the real timer's delay (injected by hand)
test('a held start of a private root on a quiet channel is released once as its placeholder and the stream end repeats nothing', async () => {
  // Arrange
  const child = fakeChild()
  const events: ProcessOutputEvent[] = []
  const releases: Array<() => void> = []
  captureProcessOutput(child, {
    startedAt: process.hrtime.bigint(),
    onOutput: (event) => {
      events.push(event)
    },
    pendingLimitBytes: 1_048_576,
    overflowMessage: 'unused',
    failurePrefix: 'test capture failed',
    privateRoots: ADA_ROOTS,
    scheduleRootRelease: (callback) => {
      releases.push(callback)
      return () => undefined
    },
  })
  child.stdout.write('listening at /Users/ad')
  await flushStreams()
  const beforeRelease = events.map((event) => event.text)
  // Act
  releases.at(-1)?.()
  await flushStreams()
  child.stdout.end()
  await flushStreams()
  // Assert
  assert.deepEqual(beforeRelease, ['listening at '])
  assert.deepEqual(
    events.map((event) => [event.channel, event.text]),
    [
      ['stdout', 'listening at '],
      ['stdout', '~'],
    ],
  )
})

// Value: protects=a complete private root held at the very end of the output is delivered hidden when the stream ends, on each channel; fails_when=the end drops the held tail or delivers it unhidden; why_new=no capture test ends a stream with a held tail; seam=none; no_claim=timed release (own test)
test('a private root still held when a stream ends is delivered hidden on that channel', async () => {
  // Arrange
  const child = fakeChild()
  const events: ProcessOutputEvent[] = []
  const capture = captureProcessOutput(child, {
    startedAt: process.hrtime.bigint(),
    onOutput: (event) => {
      events.push(event)
    },
    pendingLimitBytes: 1_048_576,
    overflowMessage: 'unused',
    failurePrefix: 'test capture failed',
    privateRoots: ADA_ROOTS,
    scheduleRootRelease: () => () => undefined,
  })
  // Act
  child.stdout.write('out /Users/ada')
  child.stderr.write('err /Users/ada')
  await flushStreams()
  child.stdout.end()
  child.stderr.end()
  await flushStreams()
  await capture.settled()
  // Assert
  assert.deepEqual(events.map((event) => [event.channel, event.text]).sort(), [
    ['stderr', 'err '],
    ['stderr', '~'],
    ['stdout', 'out '],
    ['stdout', '~'],
  ])
  assert.equal(capture.tail().includes('/Users/ada'), false)
})

// protects=a channel destroyed without an end event still delivers its held start of a private root once, hidden, and a timer that fires afterwards delivers nothing more; fails_when=the held start is dropped (or stays unhidden) because only end flushes it, or a stale timer delivers after the capture settled; no_claim=the real timer's cancellation (injected by hand) and a stream that errors
test('a channel that closes without ending releases its held private root start once, hidden', async () => {
  // Arrange
  const child = fakeChild()
  const events: ProcessOutputEvent[] = []
  const releases: Array<() => void> = []
  const capture = captureProcessOutput(child, {
    startedAt: process.hrtime.bigint(),
    onOutput: (event) => {
      events.push(event)
    },
    pendingLimitBytes: 1_048_576,
    overflowMessage: 'unused',
    failurePrefix: 'test capture failed',
    privateRoots: ADA_ROOTS,
    scheduleRootRelease: (callback) => {
      releases.push(callback)
      return () => undefined
    },
  })
  child.stdout.write('listening at /Users/ad')
  await flushStreams()

  // Act
  child.stdout.destroy()
  await flushStreams()
  await capture.settled()
  const afterClose = events.map((event) => event.text)
  releases.at(-1)?.()
  await flushStreams()
  await capture.settled()

  // Assert
  assert.deepEqual(afterClose, ['listening at ', '~'])
  assert.deepEqual(
    events.map((event) => event.text),
    ['listening at ', '~'],
  )
  assert.equal(capture.tail(), 'listening at ~')
})

/**
 * Starts a capture whose channels mask a run's known secrets, with a hand-driven release timer.
 * @param secrets - The run's secret set; a test may add to it while the capture runs.
 * @param holdback - The holdback the run reports, read at call time.
 * @param options.identity - Whether the mask changes nothing (a run holding no secret).
 * @returns The child, the events and withheld byte counts seen so far, the pending timer callbacks and the capture.
 * @example const run = maskedCapture(new Set(['hunter2']), () => 40)
 */
function maskedCapture(
  secrets: Set<string>,
  holdback: () => number,
  options: { identity?: boolean } = {},
) {
  const child = fakeChild()
  const events: ProcessOutputEvent[] = []
  const withheld: number[] = []
  const releases: Array<() => void> = []
  const capture = captureProcessOutput(child, {
    startedAt: process.hrtime.bigint(),
    onOutput: (event) => {
      events.push(event)
    },
    pendingLimitBytes: 1_048_576,
    overflowMessage: 'unused',
    failurePrefix: 'test capture failed',
    scheduleRootRelease: (callback) => {
      releases.push(callback)
      return () => undefined
    },
    knownValues: {
      mask: (text) =>
        options.identity ? text : maskLearnerSecretText(text, secrets),
      holdback,
      onWithheld: (bytes) => withheld.push(bytes),
    },
  })
  return { child, events, withheld, releases, capture }
}

/** The text of every event, joined in order. */
function joined(events: ProcessOutputEvent[]): string {
  return events.map((event) => event.text).join('')
}

// protects=a run secret split over two output chunks is masked whole, and no event carries a fragment of it; fails_when=each chunk is masked alone, so the first half 'hunter2-' reaches an event; no_claim=real server pipes (fake streams) and secrets longer than the holdback the caller reports
test('a secret the server prints across two chunks reaches no output event, only its mask', async () => {
  // Arrange
  const run = maskedCapture(new Set(['hunter2-secret']), () => 40)
  // Act
  run.child.stdout.write('login hunter2-')
  await flushStreams()
  run.child.stdout.write('secret ok\n')
  await flushStreams()
  run.child.stdout.end()
  await flushStreams()
  await run.capture.settled()
  // Assert
  assert.equal(joined(run.events), 'login [masked] ok\n')
  assert.equal(
    run.events.some((event) => event.text.includes('hunter')),
    false,
  )
  assert.equal(run.capture.tail(), 'login [masked] ok\n')
})

// protects=a secret the server prints inside a JSON string, escaped, is masked when the run's mask handles escaped forms; fails_when=the stage masks only the raw secret and the backslash form survives; no_claim=every escaped form (only the JSON quote escape is driven)
test('a secret printed as a JSON-escaped string reaches no output event', async () => {
  // Arrange
  const run = maskedCapture(new Set(['p"w-secret!']), () => 40)
  // Act
  run.child.stdout.write(`${JSON.stringify({ password: 'p"w-secret!' })}\n`)
  await flushStreams()
  run.child.stdout.end()
  await flushStreams()
  await run.capture.settled()
  // Assert
  assert.equal(joined(run.events), '{"password":"[masked]"}\n')
})

// protects=text held for a possible secret is released masked once its channel stays quiet for the hold; fails_when=a quiet server's last line stays stuck, or is released unmasked; no_claim=the real timer's delay (injected by hand)
test('a quiet channel releases its held output masked after the hold', async () => {
  // Arrange
  const run = maskedCapture(new Set(['hunter2-secret']), () => 40)
  run.child.stdout.write('ready hunter2-secret')
  await flushStreams()
  const beforeRelease = joined(run.events)
  // Act
  run.releases.at(-1)?.()
  await flushStreams()
  // Assert
  assert.equal(beforeRelease, '')
  assert.deepEqual(
    run.events.map((event) => event.text),
    ['ready [masked]'],
  )
})

// protects=under an infinite holdback nothing is published until releaseHeld, which masks the held text with values added meanwhile; fails_when=the quiet timer or the stage releases early, or the late-learned cookie value is published; no_claim=the sign-in exchange itself (the caller drives the holdback)
test('output held during a sign-in exchange is published masked with values learned meanwhile after releaseHeld', async () => {
  // Arrange
  const secrets = new Set<string>()
  let holdback = Number.POSITIVE_INFINITY
  const run = maskedCapture(secrets, () => holdback)
  run.child.stdout.write('seen abc12345XYZ ok\nmore text')
  await flushStreams()
  run.releases.at(-1)?.()
  await flushStreams()
  const duringExchange = joined(run.events)
  // The cookie value is learned when the sign-in response's headers are read.
  secrets.add('abc12345XYZ')
  holdback = 5
  // Act
  run.capture.releaseHeld()
  await flushStreams()
  const afterRelease = joined(run.events)
  run.child.stdout.end()
  await flushStreams()
  await run.capture.settled()
  // Assert
  assert.equal(duringExchange, '')
  assert.equal(afterRelease.startsWith('seen [masked] ok\n'), true)
  assert.equal(afterRelease.includes('abc12345'), false)
  assert.equal(joined(run.events), 'seen [masked] ok\nmore text')
  assert.deepEqual(run.withheld, [])
})

// protects=held output is dropped, with its byte count reported, when the exchange ends without headers (dropHeld) or the channel ends under an infinite holdback; fails_when=the held text reaches an event, or the withheld size is missing or wrong; no_claim=the journal entry the caller writes from the report
test('dropHeld and a channel end under an infinite holdback drop held output and report its bytes', async () => {
  // Arrange
  const dropped = maskedCapture(new Set(), () => Number.POSITIVE_INFINITY)
  const ended = maskedCapture(new Set(), () => Number.POSITIVE_INFINITY)
  dropped.child.stdout.write('sid=abc ok\n')
  ended.child.stdout.write('sid=abc ok\n')
  await flushStreams()
  // Act
  dropped.capture.dropHeld()
  dropped.child.stdout.end()
  ended.child.stdout.end()
  await flushStreams()
  await dropped.capture.settled()
  await ended.capture.settled()
  // Assert
  assert.deepEqual(dropped.events, [])
  assert.deepEqual(dropped.withheld, [11])
  assert.deepEqual(ended.events, [])
  assert.deepEqual(ended.withheld, [11])
})

// protects=a capture with no known values, or with holdback 0 and an identity mask, delivers exactly the events it did before the stage existed; fails_when=the stage reorders, delays or splits output of a run that holds no secret; no_claim=timing (events are compared by text and channel)
test('a run holding no secret gets the same output events with and without the mask stage', async () => {
  // Arrange
  const plain = fakeChild()
  const plainEvents: ProcessOutputEvent[] = []
  captureProcessOutput(plain, {
    startedAt: process.hrtime.bigint(),
    onOutput: (event) => {
      plainEvents.push(event)
    },
    pendingLimitBytes: 1_048_576,
    overflowMessage: 'unused',
    failurePrefix: 'test capture failed',
  })
  const masked = maskedCapture(new Set(), () => 0, { identity: true })
  // Act
  for (const child of [plain, masked.child]) {
    child.stdout.write('hello ')
    await flushStreams()
    child.stdout.write('world\n')
    await flushStreams()
    child.stderr.write('warn\n')
    await flushStreams()
    child.stdout.end()
    child.stderr.end()
    await flushStreams()
  }
  await masked.capture.settled()
  // Assert
  const expected = [
    ['stdout', 'hello '],
    ['stdout', 'world\n'],
    ['stderr', 'warn\n'],
  ]
  assert.deepEqual(
    plainEvents.map((event) => [event.channel, event.text]),
    expected,
  )
  assert.deepEqual(
    masked.events.map((event) => [event.channel, event.text]),
    expected,
  )
})
