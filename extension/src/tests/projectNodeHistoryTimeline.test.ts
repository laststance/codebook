import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { NodeTestHistoryEntry } from '../nodeTestHistorySchemas'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { NODE_TEST_REPLAY_TEXT } from '../utils/describeNodeTestReplay'
import { projectHistoricalTimeline } from '../utils/projectHistoricalTimeline'
import { projectNodeHistoryTimeline } from '../utils/projectNodeHistoryTimeline'
import { projectNodeTestSection } from '../utils/projectNodeTestSection'

type StopEntry = Extract<NodeTestHistoryEntry, { type: 'stop' }>

const SOURCE_TEXT = 'export const delay = schedule(job, 5_000)\n'
const SOURCE_HASH = sha256(SOURCE_TEXT)

const output = (sequence: number, elapsedMs: number): NodeTestHistoryEntry => ({
  type: 'output',
  sequence,
  elapsedMs,
  outputSequence: sequence,
  channel: 'stdout',
  text: 'RUN src/jobs.test.ts\n',
})

/** A stop whose captured source verifies: the frame's text hashes to the sealed hash at the stopped line. */
const verifiedStop = (sequence: number, elapsedMs: number): StopEntry => ({
  type: 'stop',
  sequence,
  elapsedMs,
  index: 0,
  source: { path: 'src/jobs.ts', hash: SOURCE_HASH, line: 1, column: 1 },
  frame: { name: 'schedule', line: 1, column: 1 },
  facts: [],
  debuggerSnapshot: {
    version: 1,
    frames: [
      {
        name: 'schedule',
        line: 1,
        column: 1,
        source: {
          name: 'src/jobs.ts',
          text: SOURCE_TEXT,
          hash: SOURCE_HASH,
          line: 1,
        },
        scopes: [],
      },
    ],
    variables: [],
    limitations: [],
  },
})

/** A stop whose snapshot holds no frame, so its source cannot verify. */
const unverifiedStop = (sequence: number, elapsedMs: number): StopEntry => ({
  ...verifiedStop(sequence, elapsedMs),
  debuggerSnapshot: { version: 1, frames: [], variables: [], limitations: [] },
})

const result = (sequence: number, elapsedMs: number): NodeTestHistoryEntry => ({
  type: 'result',
  sequence,
  elapsedMs,
  exitCode: 0,
  signal: null,
  outputTail: '',
})

// Value: protects=the shared timeline adapter's contract that a test journal records no resume time; fails_when=the adapter drops `pausedIntervals: []` (an undefined list answers unknown, so no mark is drawn) or marks a paused interval as recorded; why_new=Cycle 0049 E1; seam=none; no_claim=how the pane draws the span
test('a test replay maps its whole range to one unrecorded span with a tick at each verified stop', () => {
  // Arrange
  const history = {
    entries: [
      output(1, 100),
      verifiedStop(2, 420),
      output(3, 600),
      verifiedStop(4, 700),
      result(5, 900),
    ],
  }

  // Act
  const timeline = projectNodeHistoryTimeline(history)

  // Assert
  assert.deepEqual(timeline, {
    startMs: 100,
    endMs: 900,
    gaps: [{ startMs: 100, endMs: 900 }],
    recordedPoints: [420, 700],
  })
})

// Value: protects=no tick for a stop whose captured source does not verify (the pane says "Recorded source unavailable" there); fails_when=every stop becomes a tick regardless of nodeStopSourceMatches; why_new=Cycle 0049 E1; seam=none; no_claim=the verification rules themselves (nodeStopSourceMatches tests)
test('a stop whose captured source does not verify gets no tick while a verified stop keeps its tick', () => {
  // Arrange
  const history = {
    entries: [
      output(1, 0),
      unverifiedStop(2, 300),
      verifiedStop(3, 600),
      result(4, 1_000),
    ],
  }

  // Act
  const timeline = projectNodeHistoryTimeline(history)

  // Assert
  assert.deepEqual(timeline?.recordedPoints, [600])
})

// Value: protects=no marks on a history with nothing to span, as the browser transport draws none; fails_when=a one-event history or events at one time draw a zero-width or full-width gap; why_new=Cycle 0049 E1; seam=none; no_claim=none
test('a history of one event, or of events at one time, has no timeline marks', () => {
  // Arrange
  const single = { entries: [result(1, 500)] }
  const sameTime = { entries: [output(1, 500), verifiedStop(2, 500)] }
  const empty = { entries: [] }

  // Act
  const marks = [single, sameTime, empty].map(projectNodeHistoryTimeline)

  // Assert
  assert.deepEqual(marks, [undefined, undefined, undefined])
})

// Value: protects=the adapter's reason to pass an empty paused list: the existing projection answers unknown for an undefined list; fails_when=projectHistoricalTimeline starts mapping a context without pausedIntervals, which would let the adapter drop the argument unnoticed; why_new=Cycle 0049 E1 pins `pausedIntervals: []`; seam=none; no_claim=old archive coverage
test('the historical timeline answers unknown without a paused-interval list and maps one span with an empty list', () => {
  // Arrange
  const study = { observations: [{ id: 'a', elapsedMs: 10, debugger: {} }] }
  const range = { startMs: 0, endMs: 100 }

  // Act
  const withoutList = projectHistoricalTimeline({ study }, range)
  const withEmptyList = projectHistoricalTimeline(
    { pausedIntervals: [], study },
    range,
  )

  // Assert
  assert.deepEqual(withoutList, { status: 'unknown' })
  assert.deepEqual(withEmptyList, {
    status: 'mapped',
    gaps: [{ startMs: 0, endMs: 100 }],
    recordedPoints: [10],
  })
})

// Value: protects=the Study section carrying the slider's marks and the catalog legend to the pane; fails_when=the section drops its timeline or the legend string changes; why_new=Cycle 0049 E1/X13; seam=none; no_claim=the pane's drawing (Reader DOM case)
test('the test replay section carries the slider marks and states the recorded-stops legend', () => {
  // Arrange
  const entries = [output(1, 0), verifiedStop(2, 400), result(3, 900)]

  // Act
  const view = projectNodeTestSection({
    history: { entries, status: 'complete' },
    selected: entries[1],
    selectedStopVerified: true,
    applicationClosed: false,
  })

  // Assert
  assert.deepEqual(view.timeline, {
    startMs: 0,
    endMs: 900,
    gaps: [{ startMs: 0, endMs: 900 }],
    recordedPoints: [400],
  })
  assert.equal(
    NODE_TEST_REPLAY_TEXT.timelineLegend,
    'Ticks mark recorded stops; source and debugger are not recorded between them.',
  )
})

// Value: protects=a one-event replay showing no marks in the section; fails_when=the section invents a timeline for one event; why_new=Cycle 0049 E1; seam=none; no_claim=none
test('the test replay section of a one-event history has no timeline', () => {
  // Arrange
  const entries = [result(1, 500)]

  // Act
  const view = projectNodeTestSection({
    history: { entries, status: 'complete' },
    selected: entries[0],
    selectedStopVerified: false,
    applicationClosed: false,
  })

  // Assert
  assert.equal('timeline' in view, false)
})
