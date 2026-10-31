import assert from 'node:assert/strict'
import { before, test } from 'node:test'

import {
  buildExtensionReplayModel,
  openingExtensionEvent,
  restoreExtensionPlayhead,
} from '../utils/buildExtensionReplayModel'

import {
  EXTENSION_WORKSPACE_KEY,
  openExtensionStore,
} from './utils/chromeExtensionHistoryFixture'
import { realProcessStart } from './utils/realProcessStart'
import {
  writeExtensionHistory,
  type ExtensionScriptStep,
} from './utils/sealedExtensionHistory'

before(async () => {
  await realProcessStart(process.pid)
})

/**
 * Writes a script and reads it back into a replay model through the store's verified read.
 * @param context - The test whose end removes the directory.
 * @param script - The scripted run.
 * @returns The model and the journal sequence of each step.
 * @example const { model } = await modelOf(context, script)
 */
async function modelOf(
  context: Parameters<typeof openExtensionStore>[0],
  script: readonly ExtensionScriptStep[],
) {
  const { store, learningDirectory } = await openExtensionStore(context)
  const written = await writeExtensionHistory(
    learningDirectory,
    EXTENSION_WORKSPACE_KEY,
    script,
  )
  const model = buildExtensionReplayModel(await store.read(written.studyId))
  return { model, written }
}

/** The moment shown at a journal sequence. */
function momentAt(
  model: ReturnType<typeof buildExtensionReplayModel>,
  sequence: number,
) {
  return model.moments[model.indexBySequence.get(sequence)!]!
}

// protects=a frame received before a pause opened but appended after it stands before the pause on the timeline, and the stop's preceding frame is the one received before it; fails_when=frames are placed by their append time, so the stop labels a frame received after it; no_claim=the writer's own ordering rules
test('a frame appended after a pause but received before it is placed before the stop and is the stop frame', async (context) => {
  // Arrange
  const { model, written } = await modelOf(context, [
    { at: 10, type: 'frame', kind: 'stream', salt: 'early' },
    { at: 100, type: 'open', pauseId: 'p1', stopIndex: 1, context: 'page' },
    // Appended at 105 but received at 60.
    { at: 105, type: 'frame', kind: 'stream', salt: 'late', capturedAtMs: 60 },
    { at: 200, type: 'close', pauseId: 'p1' },
  ])
  const [early, open, late] = written.sequences

  // Act
  const order = model.events.map((event) => event.sequence)
  const atStop = momentAt(model, open!)

  // Assert
  assert.deepEqual(order, [early, late, open, written.sequences[3]])
  assert.equal(atStop.frame.state, 'stream')
  assert.equal(
    atStop.frame.state === 'stream' && atStop.frame.frame.sequence,
    late,
  )
  assert.equal(atStop.frame.state === 'stream' && atStop.frame.beforeStopMs, 40)
})

// protects=a stop with a pinned frame shows that frame even when a later stream frame exists, and a stop with neither shows the no-frame state; fails_when=a pin is ignored for the last stream frame, or another moment's frame is passed off as the stop's; no_claim=the pixels of either frame
test('a stop shows its pinned frame, else the stream frame before it, else no frame', async (context) => {
  // Arrange
  const { model, written } = await modelOf(context, [
    { at: 100, type: 'open', pauseId: 'p1', stopIndex: 1, context: 'page' },
    { at: 110, type: 'frame', kind: 'pin', pauseId: 'p1', salt: 'pin' },
    { at: 120, type: 'frame', kind: 'stream', salt: 'stream' },
    { at: 200, type: 'close', pauseId: 'p1' },
    {
      at: 300,
      type: 'open',
      pauseId: 'p2',
      stopIndex: 2,
      context: 'service-worker',
    },
  ])
  const [first, , , , second] = written.sequences

  // Act
  const pinned = momentAt(model, first!)
  const unframed = momentAt(model, second!)

  // Assert
  assert.equal(pinned.frame.state, 'pinned')
  assert.equal(
    pinned.frame.state === 'pinned' && pinned.frame.frame.sequence,
    written.sequences[1],
  )
  // The stream frame arrived after p1 opened and before p2 did, so p2 shows it, labeled with its distance.
  assert.equal(unframed.frame.state, 'stream')
  assert.equal(
    unframed.frame.state === 'stream' && unframed.frame.beforeStopMs,
    180,
  )
})

// protects=a moment before any frame has the no-frame state and a moment between a close and the next open has no stop while frames keep playing; fails_when=a no-stop interval keeps the closed stop, or an empty start shows a frame; no_claim=the debugger presentation
test('between a close and the next open there is no stop and the stream frames still advance', async (context) => {
  // Arrange
  const { model, written } = await modelOf(context, [
    { at: 10, type: 'open', pauseId: 'p1', stopIndex: 1, context: 'page' },
    { at: 50, type: 'close', pauseId: 'p1' },
    { at: 60, type: 'frame', kind: 'stream', salt: 'a' },
    { at: 70, type: 'frame', kind: 'stream', salt: 'b' },
    {
      at: 90,
      type: 'open',
      pauseId: 'p2',
      stopIndex: 2,
      context: 'service-worker',
    },
  ])
  const [open, , frameA, frameB] = written.sequences

  // Act
  const first = momentAt(model, open!)
  const inGap = momentAt(model, frameA!)
  const laterInGap = momentAt(model, frameB!)

  // Assert
  assert.equal(first.frame.state, 'none')
  assert.equal(inGap.stop, undefined)
  assert.equal(laterInGap.stop, undefined)
  assert.equal(
    laterInGap.frame.state === 'stream' && laterInGap.frame.frame.sequence,
    frameB,
  )
})

// protects=a pause opened inside another shows from its open to its close and the outer pause shows again after it, whichever order the pauses close in; fails_when=the inner pause never ends the outer stop, or the outer stop does not return; no_claim=the live run's pause set
test('overlapping pauses select the most recently opened open pause and the outer one returns after the inner closes', async (context) => {
  // Arrange
  const { model, written } = await modelOf(context, [
    { at: 10, type: 'open', pauseId: 'outer', stopIndex: 1, context: 'page' },
    {
      at: 20,
      type: 'open',
      pauseId: 'inner',
      stopIndex: 2,
      context: 'service-worker',
    },
    { at: 30, type: 'close', pauseId: 'inner' },
    { at: 40, type: 'close', pauseId: 'outer' },
    { at: 50, type: 'open', pauseId: 'a', stopIndex: 1, context: 'page' },
    {
      at: 60,
      type: 'open',
      pauseId: 'b',
      stopIndex: 2,
      context: 'service-worker',
    },
    // The outer pause closes first: the inner one stays selected.
    { at: 70, type: 'close', pauseId: 'a' },
    { at: 80, type: 'close', pauseId: 'b' },
  ])
  const stops = written.sequences.map(
    (sequence) => momentAt(model, sequence).stop?.pauseId,
  )

  // Act and Assert
  assert.deepEqual(stops, [
    'outer',
    'inner',
    'outer',
    undefined,
    'a',
    'b',
    'b',
    undefined,
  ])
})

// protects=a stop with a capture whose source matches is complete, one whose text differs lacks its source, and one with no capture lacks its snapshot; fails_when=a stop with unproven source reads as verified or as a moment without a stop; no_claim=the debugger's drawing
test('a stop records what of it is missing apart from being a stop', async (context) => {
  // Arrange
  const { model, written } = await modelOf(context, [
    { at: 10, type: 'open', pauseId: 'whole', stopIndex: 1, context: 'page' },
    {
      at: 11,
      type: 'capture',
      pauseId: 'whole',
      stopIndex: 1,
      context: 'page',
    },
    {
      at: 20,
      type: 'open',
      pauseId: 'edited',
      stopIndex: 2,
      context: 'service-worker',
    },
    // The capture names a source hash the frame's text does not have.
    {
      at: 21,
      type: 'capture',
      pauseId: 'edited',
      stopIndex: 2,
      context: 'service-worker',
      staleSource: true,
    },
    { at: 30, type: 'open', pauseId: 'bare', stopIndex: 1, context: 'page' },
  ])

  // Act
  const flags = ['whole', 'edited', 'bare'].map((pauseId) => {
    const pause = model.pauses.get(pauseId)!
    return [pause.hasSnapshot, pause.hasSource]
  })

  // Assert
  assert.deepEqual(flags, [
    [true, true],
    [true, false],
    [false, false],
  ])
  assert.equal(written.sequences.length, 5)
})

// protects=a saved playhead that names a capture restores the nearest earlier event, and a history opens on its first stop; fails_when=a restart lands on a missing event or on the first frame; no_claim=the saved file
test('a saved sequence that is no event restores the nearest earlier event and the opening moment is the first stop', async (context) => {
  // Arrange
  const { model, written } = await modelOf(context, [
    { at: 5, type: 'frame', kind: 'stream', salt: 'a' },
    { at: 10, type: 'open', pauseId: 'p1', stopIndex: 1, context: 'page' },
    { at: 11, type: 'capture', pauseId: 'p1', stopIndex: 1, context: 'page' },
    { at: 20, type: 'close', pauseId: 'p1' },
  ])
  const [frame, open, capture, close] = written.sequences

  // Act
  const restoredCapture = restoreExtensionPlayhead(model, capture!)
  const restoredExact = restoreExtensionPlayhead(model, close!)
  const opening = openingExtensionEvent(model)

  // Assert
  assert.equal(restoredCapture?.sequence, open)
  assert.equal(restoredExact?.sequence, close)
  assert.equal(opening?.sequence, open)
  assert.notEqual(opening?.sequence, frame)
})
