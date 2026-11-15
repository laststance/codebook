import assert from 'node:assert/strict'
import { test } from 'node:test'

import { recordedReaderHarness } from './studyWorkspaceHarness'

/** The prefix of the playback timing journal's lines in Output › Codebook. */
const TIMING_PREFIX = 'playback.presentation-timing '

// protects=Cycle 0137 C1-E: a seek that lands on a recorded stop writes exactly one playback timing line to Output › Codebook, naming the seek as a command and every step of the replay presentation in the order they ran, so a native run can say which step holds the playhead; fails_when=no line is written, a second line repeats the commit, or a presentation step is missing from the line; no_claim=the steps' real durations (the harness's editor, debugger and viewport answer at once) and the native Codebook log file
test('a seek to a recorded stop writes one playback timing line that names every presentation step', async () => {
  // Arrange
  const harness = await recordedReaderHarness(false, true)
  const lines: string[] = []
  harness.reader.diagnostics = {
    log(): void {},
    show(): void {},
    info: (line): void => {
      lines.push(line)
    },
  }
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    lines.length = 0

    // Act: the recording opens before its stop (paused from 100 ms to 1,000 ms); the seek lands inside it.
    harness.controller.command({
      action: 'seek',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
      positionMs: 300,
    })
    await harness.controller.settle()

    // Assert
    const timings = lines
      .filter((line) => line.startsWith(TIMING_PREFIX))
      .map((line) => JSON.parse(line.slice(TIMING_PREFIX.length)))
    assert.equal(timings.length, 1)
    assert.equal(timings[0].trigger, 'command')
    assert.equal(timings[0].positionMs, 300)
    assert.equal(timings[0].stopChanged, true)
    assert.deepEqual(Object.keys(timings[0].steps), [
      'retire',
      'viewport',
      'source',
      'debuggerOwner',
      'debugger',
      'paint',
      'studyRender',
    ])
  } finally {
    await harness.close()
  }
})

/** The reader's private pieces that the timing tests drive directly. */
interface TimingInternals {
  replayDebuggers: { current?: { selectionTimes: () => unknown } }
  journalPresentation: (timing: {
    trigger: 'command'
    positionMs: number
    stopChanged: boolean
    totalMs: number
    frameMs: number
    presentMs: number
  }) => void
  replayOpening: {
    presentPlayback: (bundle: unknown, signal: AbortSignal) => Promise<void>
  }
}

// protects=Cycle 0137 C1-E review: a debugger that cannot report its times still lets the seek present its stop and journal its steps, only without the debugger split; fails_when=the presentation rejects, playback is marked failed, or the line is missing its steps; no_claim=how a real adapter fails or what the split holds when it works
test('a seek still presents and journals its steps when the debugger cannot report its times', async () => {
  // Arrange
  const harness = await recordedReaderHarness(false, true)
  const lines: string[] = []
  harness.reader.diagnostics = {
    log(): void {},
    show(): void {},
    info: (line): void => {
      lines.push(line)
    },
  }
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    lines.length = 0
    const internals = harness.reader as unknown as TimingInternals
    const current = internals.replayDebuggers.current
    assert.ok(current)
    current.selectionTimes = (): never => {
      throw new Error('adapter went away')
    }

    // Act
    harness.controller.command({
      action: 'seek',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
      positionMs: 300,
    })
    await harness.controller.settle()

    // Assert
    const timings = lines
      .filter((line) => line.startsWith(TIMING_PREFIX))
      .map((line) => JSON.parse(line.slice(TIMING_PREFIX.length)))
    assert.equal(harness.controller.state().readiness, 'ready')
    assert.equal(timings.length, 1)
    assert.equal(timings[0].steps.studyRender >= 0, true)
    assert.equal('debugger' in timings[0], false)
  } finally {
    await harness.close()
  }
})

// protects=Cycle 0137 C1-E review: a presentation that finished but was superseded before its commit never lends its steps to the next commit, which ran no presentation; fails_when=the next command's line carries the stale presentation's steps; no_claim=that a real supersede reaches this order natively (the harness cannot reach it: every command presents anew, so the commit is driven directly)
test('a commit that ran no presentation is journaled without the steps of a presentation that finished earlier', async () => {
  // Arrange
  const harness = await recordedReaderHarness(false, true)
  const lines: string[] = []
  harness.reader.diagnostics = {
    log(): void {},
    show(): void {},
    info: (line): void => {
      lines.push(line)
    },
  }
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    const internals = harness.reader as unknown as TimingInternals
    const shown = harness.controller.bundle()
    assert.ok(shown)
    // A presentation of another bundle ran to its end, but the controller committed `shown`, not it.
    await internals.replayOpening.presentPlayback(
      { ...shown },
      new AbortController().signal,
    )
    lines.length = 0

    // Act: the controller reports the commit of `shown`, which ran no presentation.
    internals.journalPresentation({
      trigger: 'command',
      positionMs: 300,
      stopChanged: true,
      totalMs: 5,
      frameMs: 1,
      presentMs: 0,
    })

    // Assert
    const timings = lines
      .filter((line) => line.startsWith(TIMING_PREFIX))
      .map((line) => JSON.parse(line.slice(TIMING_PREFIX.length)))
    assert.equal(timings.length, 1)
    assert.equal(timings[0].presentMs, 0)
    assert.equal('steps' in timings[0], false)
  } finally {
    await harness.close()
  }
})
