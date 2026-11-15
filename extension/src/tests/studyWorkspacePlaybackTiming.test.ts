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
