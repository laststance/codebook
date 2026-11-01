import assert from 'node:assert/strict'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { mock, test } from 'node:test'

import { ExtensionHistoryFrameWriter } from '../chromeExtensionHistoryFrames'
import type { ChromeExtensionHistoryWriter } from '../chromeExtensionHistoryWriter'

import {
  EXTENSION_WORKSPACE_KEY,
  extensionHistoryHeader,
  openExtensionStore,
  pngOf,
} from './utils/chromeExtensionHistoryFixture'

/** Opens a store with a controllable clock and starts a history on it. */
async function framesOver(context: Parameters<typeof openExtensionStore>[0]) {
  const clock = { nowMs: 0 }
  const { store } = await openExtensionStore(context, () => clock.nowMs)
  const header = extensionHistoryHeader(EXTENSION_WORKSPACE_KEY)
  const writer: ChromeExtensionHistoryWriter = await store.start(header)
  return { writer, store, header, clock }
}

/** The frame entries of a history, read back after its writer settled. */
async function frameEntries(
  store: Awaited<ReturnType<typeof framesOver>>['store'],
  studyId: string,
) {
  const history = await store.read(studyId)
  return history.entries.filter((entry) => entry.type === 'frame')
}

/** A stream frame of a given salt received at a given run-clock time. */
function streamOf(salt: string, capturedAtMs: number) {
  return {
    data: pngOf(720, 640, salt).toString('base64'),
    kind: 'stream' as const,
    capturedAtMs,
  }
}

/** Opens the pause a pin names, as the recorder does before its pin. */
function openPause(writer: ChromeExtensionHistoryWriter): Promise<void> {
  return writer.appendPauseOpen({
    pauseId: 'run:1:page:1',
    generation: 1,
    context: 'page',
    stopIndex: 1,
    targetUrl: 'chrome-extension://abc/popup.html',
    workerGeneration: 0,
  })
}

// protects=smoke finding 1: the last frame of a burst, skipped by the sampling interval, is recorded when the history finalizes, so the final painted state is recorded; fails_when=the last frame inside the interval is lost; no_claim=the interval timer (next test)
test('the last frame of a burst that falls inside the sampling interval is recorded when the history finalizes', async (context) => {
  // Arrange
  const { writer, store, header, clock } = await framesOver(context)
  const frames = new ExtensionHistoryFrameWriter(writer)
  clock.nowMs = 500

  // Act
  const first = frames.offer(streamOf('before', 100))
  const last = frames.offer(streamOf('folder list painted', 120))
  await frames.drain(2_000)
  const entries = await frameEntries(store, header.studyId)

  // Assert
  assert.deepEqual([first, last], ['queued', 'sampled-away'])
  assert.deepEqual(
    entries.map((entry) => entry.capturedAtMs),
    [100, 120],
  )
  assert.equal(frames.isIncomplete, false)
})

// protects=a skipped frame is recorded when its interval elapses, not only at the end, so a quiet period after a burst still holds the last painted state; fails_when=the pending frame waits for a later frame or the finalize; no_claim=real timer precision (mock timers)
test('a frame skipped by the sampling interval is recorded when its interval elapses', async (context) => {
  // Arrange
  const { writer, store, header, clock } = await framesOver(context)
  const frames = new ExtensionHistoryFrameWriter(writer)
  clock.nowMs = 500
  mock.timers.enable({ apis: ['setTimeout'] })
  context.after(() => mock.timers.reset())
  frames.offer(streamOf('before', 100))
  frames.offer(streamOf('after', 120))

  // Act
  mock.timers.tick(30)
  await frames.drain(2_000)
  const entries = await frameEntries(store, header.studyId)

  // Assert
  assert.deepEqual(
    entries.map((entry) => entry.capturedAtMs),
    [100, 120],
  )
})

// protects=only the newest skipped frame is kept: frames inside one interval do not all pile up and a newer admitted frame supersedes the pending one; fails_when=every skipped frame is stored or an older pending frame is recorded after a newer one; no_claim=20 fps under load
test('a newer frame supersedes the pending skipped frame and the journal keeps capture order', async (context) => {
  // Arrange
  const { writer, store, header, clock } = await framesOver(context)
  const frames = new ExtensionHistoryFrameWriter(writer)
  clock.nowMs = 500

  // Act
  frames.offer(streamOf('a', 100))
  frames.offer(streamOf('b', 110))
  frames.offer(streamOf('c', 130))
  frames.offer(streamOf('d', 160))
  await frames.drain(2_000)
  const entries = await frameEntries(store, header.studyId)

  // Assert
  assert.deepEqual(
    entries.map((entry) => entry.capturedAtMs),
    [100, 160],
  )
})

// protects=E-B: a pin follows the pending stream frame captured before it, and a second pin for one pause is ignored without storing its blob; fails_when=the pin is written before the earlier frame (the journal refuses it), or the second pin stores a blob or entry; no_claim=pin screenshots from Chrome
test('a pin is recorded after the pending frame captured before it and a second pin for the pause is ignored', async (context) => {
  // Arrange
  const { writer, store, header, clock } = await framesOver(context)
  const frames = new ExtensionHistoryFrameWriter(writer)
  clock.nowMs = 90
  await openPause(writer)
  clock.nowMs = 500
  const pin = (salt: string, capturedAtMs: number) => ({
    data: pngOf(720, 640, salt).toString('base64'),
    kind: 'pin' as const,
    pauseId: 'run:1:page:1',
    capturedAtMs,
  })

  // Act
  frames.offer(streamOf('a', 100))
  frames.offer(streamOf('b', 120))
  const firstPin = frames.offer(pin('first pin', 130))
  const secondPin = frames.offer(pin('second pin', 140))
  await frames.drain(2_000)
  const entries = await frameEntries(store, header.studyId)

  // Assert
  assert.deepEqual([firstPin, secondPin], ['queued', 'ignored'])
  assert.deepEqual(
    entries.map((entry) => [entry.kind, entry.capturedAtMs]),
    [
      ['stream', 100],
      ['stream', 120],
      ['pin', 130],
    ],
  )
  assert.equal(
    (await readdir(join(writer.historyDirectory, 'frames'))).length,
    3,
  )
})

// protects=E-D: the frame budget keeps room for pins, so a busy surface ends only its stream frames and the stop frames still record; fails_when=a stream frame uses the pin reserve, the filmstrip is not named incomplete, or the pin is refused; no_claim=the production sizes (the budget is injected small)
test('exhausting the stream frame budget ends the stream frames and keeps the room for pins', async (context) => {
  // Arrange
  const { writer, store, header, clock } = await framesOver(context)
  const frames = new ExtensionHistoryFrameWriter(writer, {
    frames: 4,
    pngBytes: 1_000_000,
    pinReserveFrames: 1,
    pinReserveBytes: 0,
  })
  clock.nowMs = 90
  await openPause(writer)
  clock.nowMs = 2_000

  // Act
  const streams = [0, 1, 2, 3, 4].map((index) =>
    frames.offer(streamOf(`s${index}`, 100 * (index + 1))),
  )
  const pin = frames.offer({
    data: pngOf(720, 640, 'pin').toString('base64'),
    kind: 'pin',
    pauseId: 'run:1:page:1',
    capturedAtMs: 700,
  })
  await frames.drain(2_000)
  const entries = await frameEntries(store, header.studyId)

  // Assert
  assert.deepEqual(streams, [
    'queued',
    'queued',
    'queued',
    'dropped',
    'dropped',
  ])
  assert.equal(pin, 'queued')
  assert.equal(frames.isIncomplete, true)
  assert.deepEqual(
    entries.map((entry) => entry.kind),
    ['stream', 'stream', 'stream', 'pin'],
  )
})

// protects=E-D: the blob byte budget also keeps its reserve for pins, and a frame whose hash is already stored costs no new bytes; fails_when=a repeated frame is refused by the byte budget or a stream frame takes the pin bytes; no_claim=the production size
test('the blob byte budget keeps a reserve for pins and counts a repeated frame once', async (context) => {
  // Arrange
  const { writer, clock } = await framesOver(context)
  const frameBytes = pngOf(720, 640, 'a').byteLength
  const frames = new ExtensionHistoryFrameWriter(writer, {
    frames: 100,
    pngBytes: frameBytes * 3,
    pinReserveFrames: 0,
    pinReserveBytes: frameBytes,
  })
  clock.nowMs = 2_000

  // Act
  const results = [
    frames.offer(streamOf('a', 100)),
    frames.offer(streamOf('a', 200)),
    frames.offer(streamOf('b', 300)),
    frames.offer(streamOf('c', 400)),
  ]
  await frames.drain(2_000)

  // Assert
  assert.deepEqual(results, ['queued', 'queued', 'queued', 'dropped'])
  assert.equal(frames.isIncomplete, true)
})

// protects=E-D/E-J: frames of changing size at a high rate against a stalled disk stay within the pending byte bound, offer never waits, and the rest is dropped and remembered; fails_when=memory grows with the burst or offer returns a promise; no_claim=real disk speed
test('resized frames offered at a high rate against stalled storage stay within the pending bound', async (context) => {
  // Arrange
  const { writer, clock } = await framesOver(context)
  const frames = new ExtensionHistoryFrameWriter(writer)
  clock.nowMs = 100_000
  writer.appendFrame = (): Promise<void> => new Promise<void>(() => undefined)
  const salt = 'x'.repeat(1024 * 1024)

  // Act
  const results = Array.from({ length: 30 }, (_unused, index) =>
    frames.offer({
      data: pngOf(300 + index, 200 + index, salt).toString('base64'),
      kind: 'stream',
      capturedAtMs: 60 * (index + 1),
    }),
  )

  // Assert
  assert.equal(results.filter((result) => result === 'queued').length, 7)
  assert.equal(results.filter((result) => result === 'dropped').length, 23)
  assert.equal(frames.isIncomplete, true)
})

// protects=E-B: a drain whose queue never finishes returns at its deadline and names the filmstrip incomplete, so a stalled disk cannot hold the seal; fails_when=drain waits forever or the filmstrip reads complete; no_claim=the 2 s production value
test('a drain against a queue that never finishes returns at its deadline and reads incomplete', async (context) => {
  // Arrange
  const { writer, clock } = await framesOver(context)
  const frames = new ExtensionHistoryFrameWriter(writer)
  clock.nowMs = 1_000
  writer.appendFrame = (): Promise<void> => new Promise<void>(() => undefined)
  frames.offer(streamOf('stalled', 100))
  mock.timers.enable({ apis: ['setTimeout'] })
  context.after(() => mock.timers.reset())

  // Act
  const draining = frames.drain(2_000)
  mock.timers.tick(2_000)
  await draining

  // Assert
  assert.equal(frames.isIncomplete, true)
})
