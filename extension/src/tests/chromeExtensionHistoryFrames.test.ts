import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import { ExtensionHistoryFrameWriter } from '../chromeExtensionHistoryFrames'
import type { ChromeExtensionHistoryWriter } from '../chromeExtensionHistoryWriter'
import { sha256 } from '../runtimeSupport/utils/sha256'

import {
  EXTENSION_WORKSPACE_KEY,
  extensionHistoryHeader,
  openExtensionStore,
  pngOf,
} from './utils/chromeExtensionHistoryFixture'

/** Opens a store with a controllable clock and starts a history on it. */
async function framesOver(context: Parameters<typeof openExtensionStore>[0]) {
  const clock = { nowMs: 0 }
  const { store, learningDirectory } = await openExtensionStore(
    context,
    () => clock.nowMs,
  )
  const header = extensionHistoryHeader(EXTENSION_WORKSPACE_KEY)
  const writer: ChromeExtensionHistoryWriter = await store.start(header)
  const frames = new ExtensionHistoryFrameWriter(writer)
  return { frames, writer, store, header, clock, learningDirectory }
}

/** The frame entries of a history, read back after its writer settled. */
async function frameEntries(
  store: Awaited<ReturnType<typeof framesOver>>['store'],
  studyId: string,
) {
  const history = await store.read(studyId)
  return history.entries.filter((entry) => entry.type === 'frame')
}

// protects=a stream frame's PNG is durable under frames/<sha256>.png before its frame entry is appended, with no temporary file left; fails_when=the entry is appended before the blob exists, or a .tmp file remains; no_claim=a crash between the blob and the entry (the failure matrix part)
test('a stream frame is stored as frames/<sha256>.png before its frame entry is appended', async (context) => {
  // Arrange
  const { frames, writer, store, header, clock } = await framesOver(context)
  const png = pngOf(720, 640, 'first')
  const hash = sha256(png)
  const blobPath = join(writer.historyDirectory, 'frames', `${hash}.png`)
  const blobExistedWhenAppended: boolean[] = []
  const appendFrame = writer.appendFrame.bind(writer)
  writer.appendFrame = (input): Promise<void> => {
    blobExistedWhenAppended.push(existsSync(blobPath))
    return appendFrame(input)
  }
  clock.nowMs = 100

  // Act
  const offered = frames.offer({
    data: png.toString('base64'),
    kind: 'stream',
    capturedAtMs: 100,
  })
  await frames.drain(2_000)
  const entries = await frameEntries(store, header.studyId)

  // Assert
  assert.equal(offered, 'queued')
  assert.deepEqual(blobExistedWhenAppended, [true])
  assert.deepEqual(
    entries.map((entry) => [
      entry.hash,
      entry.width,
      entry.height,
      entry.capturedAtMs,
    ]),
    [[hash, 720, 640, 100]],
  )
  assert.deepEqual(await readdir(join(writer.historyDirectory, 'frames')), [
    `${hash}.png`,
  ])
})

// protects=two identical frames store one blob and two entries, so a still surface costs bytes once; fails_when=the blob is written twice or the second entry is dropped; no_claim=the byte budget
test('an identical frame is deduplicated by hash: one blob, two frame entries', async (context) => {
  // Arrange
  const { frames, writer, store, header, clock } = await framesOver(context)
  const data = pngOf(720, 640, 'still').toString('base64')
  clock.nowMs = 200

  // Act
  frames.offer({ data, kind: 'stream', capturedAtMs: 100 })
  frames.offer({ data, kind: 'stream', capturedAtMs: 200 })
  await frames.drain(2_000)
  const entries = await frameEntries(store, header.studyId)

  // Assert
  assert.equal(entries.length, 2)
  assert.equal(entries[0]?.hash, entries[1]?.hash)
  assert.equal(
    (await readdir(join(writer.historyDirectory, 'frames'))).length,
    1,
  )
})

// protects=stream frames are sampled at RECORDING_SAMPLE_INTERVAL_MS (50 ms) and a sampled-away frame is no failure; a pin is never sampled; fails_when=a frame inside the interval is queued, the filmstrip reads incomplete, or a pin is skipped; no_claim=20 fps under load
test('a stream frame inside the sampling interval is sampled away without marking the filmstrip incomplete', async (context) => {
  // Arrange
  const { frames, writer, clock } = await framesOver(context)
  clock.nowMs = 90
  await writer.appendPauseOpen({
    pauseId: 'run:1:page:1',
    generation: 1,
    context: 'page',
    stopIndex: 1,
    targetUrl: 'chrome-extension://abc/popup.html',
    workerGeneration: 0,
  })
  clock.nowMs = 500
  const frame = (salt: string, capturedAtMs: number) => ({
    data: pngOf(720, 640, salt).toString('base64'),
    kind: 'stream' as const,
    capturedAtMs,
  })

  // Act
  const first = frames.offer(frame('a', 100))
  const tooSoon = frames.offer(frame('b', 120))
  const next = frames.offer(frame('c', 150))
  const pin = frames.offer({
    data: pngOf(720, 640, 'pin').toString('base64'),
    kind: 'pin',
    pauseId: 'run:1:page:1',
    capturedAtMs: 160,
  })
  await frames.drain(2_000)

  // Assert
  assert.deepEqual(
    [first, tooSoon, next, pin],
    ['queued', 'sampled-away', 'queued', 'queued'],
  )
  assert.equal(frames.isIncomplete, false)
})

// protects=frames of changing size are stored at their own size; fails_when=a resized frame is rejected or scaled; no_claim=decoding the PNG
test('frames of changing size keep their recorded width and height', async (context) => {
  // Arrange
  const { frames, store, header, clock } = await framesOver(context)
  clock.nowMs = 400

  // Act
  frames.offer({
    data: pngOf(300, 200, 'a').toString('base64'),
    kind: 'stream',
    capturedAtMs: 100,
  })
  frames.offer({
    data: pngOf(420, 360, 'b').toString('base64'),
    kind: 'stream',
    capturedAtMs: 200,
  })
  await frames.drain(2_000)
  const entries = await frameEntries(store, header.studyId)

  // Assert
  assert.deepEqual(
    entries.map((entry) => [entry.width, entry.height]),
    [
      [300, 200],
      [420, 360],
    ],
  )
})

// protects=the offer never awaits and never throws: a frame that is no PNG is dropped and the filmstrip reads incomplete; fails_when=offer throws or returns a promise; no_claim=which frame was bad
test('a frame that is not a PNG is dropped synchronously and marks the filmstrip incomplete', async (context) => {
  // Arrange
  const { frames } = await framesOver(context)

  // Act
  const result = frames.offer({
    data: Buffer.from('not a png at all, just text').toString('base64'),
    kind: 'stream',
    capturedAtMs: 100,
  })

  // Assert
  assert.equal(result, 'dropped')
  assert.equal(frames.isIncomplete, true)
})

// protects=the pending queue is bounded at MAX_RECORDING_PENDING_BYTES: a burst against a blocked disk drops the excess, remembers it, and never grows memory without bound; fails_when=every frame is queued or the drop is not remembered; no_claim=the real disk speed
test('a burst of frames against a blocked disk is dropped past the pending byte bound and remembered', async (context) => {
  // Arrange
  const { frames, writer, clock } = await framesOver(context)
  clock.nowMs = 10_000
  writer.appendFrame = (): Promise<void> => new Promise<void>(() => undefined)
  const bigSalt = 'x'.repeat(3 * 1024 * 1024)

  // Act
  const results = [0, 1, 2, 3].map((index) =>
    frames.offer({
      data: pngOf(720, 640, `${index}${bigSalt}`).toString('base64'),
      kind: 'stream',
      capturedAtMs: 100 * (index + 1),
    }),
  )

  // Assert
  assert.deepEqual(results, ['queued', 'queued', 'dropped', 'dropped'])
  assert.equal(frames.isIncomplete, true)
})
