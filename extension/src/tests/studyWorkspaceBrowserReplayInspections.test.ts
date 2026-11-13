import assert from 'node:assert/strict'
import { test } from 'node:test'

import { recordedInspectionsOfObservation } from '../utils/recordedInspectionsOfObservation'

import { recordedReaderHarness } from './studyWorkspaceHarness'

/**
 * Opens the harness's browser recording, whose stop declared the inspection `nextTheme`, and lists what its replay handed the native debugger for that stop.
 * @returns The harness, for further moves, and a reader of the presentations that carry the recorded stop's snapshot.
 * @example const { harness, recordedStops } = await openRecordedStop()
 */
async function openRecordedStop() {
  const harness = await recordedReaderHarness(false, true)
  await harness.reader.openRecording(harness.studyId)
  await harness.controller.settle()
  // The recording opens before its stop (paused from 100 ms to 1,000 ms); the seek lands inside it.
  harness.controller.command({
    action: 'seek',
    studyId: harness.studyId,
    expectedRevision: harness.controller.state().revision,
    positionMs: 300,
  })
  await harness.controller.settle()
  const recordedStops = (): typeof harness.historicalDebugPresentations =>
    harness.historicalDebugPresentations.filter(
      (presented) => presented.snapshot !== undefined,
    )
  return { harness, recordedStops }
}

// Value: protects=a browser learning replay's native debugger receives the stop's recorded inspections, so a declared value outside the captured scopes (timeApi.reducerPath) stays inspectable in "Recorded inspections"; fails_when=the replay passes no inspections to the historical debugger, so the value the chat cited is unreadable after the original debugger exits; no_claim=the native scope's drawing (replayDebug.test.ts) and a real editor
test('a browser replay presents the recorded inspections of its stop to the native debugger', async () => {
  // Arrange
  const { harness, recordedStops } = await openRecordedStop()
  try {
    // Act
    const presentation = recordedStops().at(-1)

    // Assert
    assert.deepEqual(presentation?.inspections, [
      { path: 'nextTheme', mode: 'value', display: '"dark"', type: 'string' },
      { path: 'setTheme', mode: 'type', display: 'function' },
      { path: 'enabled', mode: 'value', display: 'false', type: 'boolean' },
      { path: 'selection', mode: 'value', display: 'null', type: 'null' },
    ])
  } finally {
    await harness.close()
  }
})

// Value: protects=presenting the same browser stop again is no new native selection; fails_when=each presentation derives a new inspections array, so the debugger re-selects the shown stop; no_claim=the rows themselves
test('presenting the same browser stop twice hands the debugger the same inspections array', async () => {
  // Arrange
  const { harness, recordedStops } = await openRecordedStop()
  try {
    const first = recordedStops().at(-1)?.inspections

    // Act: a seek inside the same stop presents it again.
    harness.controller.command({
      action: 'seek',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
      positionMs: 500,
    })
    await harness.controller.settle()

    // Assert
    assert.equal(first?.length, 4)
    assert.equal(recordedStops().at(-1)?.inspections, first)
  } finally {
    await harness.close()
  }
})

// Value: protects=each kind of recorded fact reaching the native Recorded inspections scope as what was recorded and nothing more; fails_when=a type-only fact shows a value, an object marker shows members, or a masked secret shows its text; no_claim=the capture that records the facts
test('recorded browser facts become native inspection rows without inventing values', () => {
  // Arrange
  const snapshot = {
    version: 1 as const,
    frames: [],
    variables: [],
    limitations: [],
  }
  const observation = {
    debugger: snapshot,
    values: {
      'type:store': 'object',
      'value:flag': false,
      'value:nothing': null,
      'value:missing': { type: 'undefined' as const },
      'value:store': { type: 'object' as const },
      'value:cookie': 'sid=abc123; theme=dark',
    },
  }

  // Act
  const inspections = recordedInspectionsOfObservation(observation)

  // Assert
  assert.deepEqual(inspections, [
    { path: 'store', mode: 'type', display: 'object' },
    { path: 'flag', mode: 'value', display: 'false', type: 'boolean' },
    { path: 'nothing', mode: 'value', display: 'null', type: 'null' },
    { path: 'missing', mode: 'value', display: 'undefined', type: 'undefined' },
    { path: 'store', mode: 'type', display: 'object' },
    { path: 'cookie', mode: 'value', display: '"[masked]"', type: 'string' },
  ])
  assert.equal(recordedInspectionsOfObservation(observation), inspections)
  assert.equal(
    recordedInspectionsOfObservation({ debugger: snapshot, values: {} }),
    undefined,
  )
  assert.equal(
    recordedInspectionsOfObservation({ values: observation.values }),
    undefined,
  )
  assert.equal(recordedInspectionsOfObservation(undefined), undefined)
})
