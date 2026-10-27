import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { test } from 'node:test'

import {
  captureProcessOutput,
  type ProcessOutputEvent,
} from '../utils/captureProcessOutput'

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

// Value: protects=output keeps its arrival order across channels (pt1 Step 11 Codex structured finding: a partial line held by the redactor was delivered after later output, moving it past a debugger stop); fails_when=a plain partial line is delivered after the other channel's later line; why_new=no test interleaved channels around a partial line; seam=none; no_claim=a partial line ending in a possible secret prefix, which still waits
test('a partial plain line on stdout is delivered before a later stderr line', async () => {
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
  child.stdout.write('before')
  await flushStreams()
  child.stderr.write('later\n')
  await flushStreams()
  child.stdout.write('\n')
  await flushStreams()
  // Assert
  assert.deepEqual(
    events.map((event) => [event.channel, event.text]),
    [
      ['stdout', 'before'],
      ['stderr', 'later\n'],
      ['stdout', '\n'],
    ],
  )
})
