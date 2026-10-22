import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { NodeTestHistoryEntry } from '../nodeTestHistorySchemas'
import { accumulateNodeTestOutput } from '../utils/accumulateNodeTestOutput'
import { indexNodeTestOutput } from '../utils/indexNodeTestOutput'

/** An output entry of a test replay, printed at `sequence` ms. */
const printed = (
  sequence: number,
  channel: 'stdout' | 'stderr',
  text: string,
): NodeTestHistoryEntry => ({
  type: 'output',
  sequence,
  elapsedMs: sequence,
  outputSequence: sequence,
  channel,
  text,
})

/** A result entry of a passing test at `sequence` ms. */
const passed = (sequence: number): NodeTestHistoryEntry => ({
  type: 'result',
  sequence,
  elapsedMs: sequence,
  exitCode: 0,
  signal: null,
  outputTail: '',
})

// Value: protects=the Application pane shows exactly what the test had printed by the selected event and nothing printed later; fails_when=output printed after the selected event appears, or an event before any output shows text; why_new=PR-B1 shows the recorded output at the playhead in the Application pane (Design 3, AC5); seam=none; no_claim=how the pane lays the lines out
test('the recorded output up to an event holds what was printed by then and nothing later', () => {
  // Arrange
  const index = indexNodeTestOutput([
    printed(2, 'stdout', 'RUN src/jobs.test.ts\n'),
    printed(4, 'stdout', 'between stops\n'),
    passed(6),
  ])

  // Act
  const beforeOutput = accumulateNodeTestOutput(index, 1)
  const atFirstOutput = accumulateNodeTestOutput(index, 3)
  const atResult = accumulateNodeTestOutput(index, 6)

  // Assert
  assert.deepEqual(beforeOutput, {
    lines: [],
    omittedCharacters: 0,
    startsMidLine: false,
    inspectorLines: 0,
    hasOutput: false,
  })
  assert.deepEqual(atFirstOutput.lines, [
    { channel: 'stdout', text: 'RUN src/jobs.test.ts', number: 0 },
  ])
  assert.deepEqual(
    atResult.lines.map((line) => line.text),
    ['RUN src/jobs.test.ts', 'between stops'],
  )
})

// Value: protects=standard-error lines are told apart without color: a stderr chunk that continues its line joins it, and a chunk of the other channel ends an unfinished line first, so no line mixes the two channels; fails_when=a continued stderr line splits in two, or stdout text joins a stderr line; why_new=the line-state machine of EN10 replaces the Study pane's raw chunks; seam=none; no_claim=the `[stderr] ` mark's rendering, which the document adds
test('standard-error chunks join their own line and a channel change ends the line first', () => {
  // Arrange
  const index = indexNodeTestOutput([
    printed(1, 'stderr', 'warn: '),
    printed(2, 'stderr', 'slow test\n'),
    printed(3, 'stdout', 'partial'),
    printed(4, 'stderr', 'err\n'),
    printed(5, 'stdout', ' rest\n'),
  ])

  // Act
  const shown = accumulateNodeTestOutput(index, 5)

  // Assert
  assert.deepEqual(shown.lines, [
    { channel: 'stderr', text: 'warn: slow test', number: 0 },
    { channel: 'stdout', text: 'partial', number: 1 },
    { channel: 'stderr', text: 'err', number: 2 },
    { channel: 'stdout', text: ' rest', number: 3 },
  ])
})

// Value: protects=a line the test is still printing at the selected event shows as printed so far and keeps its number when it is finished later, so the pane updates that line in place; fails_when=the unfinished text is dropped or the finished line gets another number; why_new=EN3 matches lines by number for in-place updates; seam=none; no_claim=the document's node reuse, which the Reader DOM check covers
test('an unfinished line shows as printed so far and keeps its number once finished', () => {
  // Arrange
  const index = indexNodeTestOutput([
    printed(1, 'stdout', 'RUN'),
    printed(2, 'stdout', ' done\n'),
  ])

  // Act
  const unfinished = accumulateNodeTestOutput(index, 1)
  const finished = accumulateNodeTestOutput(index, 2)

  // Assert
  assert.deepEqual(unfinished.lines, [
    { channel: 'stdout', text: 'RUN', number: 0 },
  ])
  assert.deepEqual(finished.lines, [
    { channel: 'stdout', text: 'RUN done', number: 0 },
  ])
})

// Value: protects=a long output keeps its end: whole lines that fit, then the end of the line that does not, with the exact count of earlier characters left out and a mark that the first line is cut; fails_when=the head is kept instead, the omitted count is wrong, or a cut line claims to start at its beginning; why_new=EN10 keeps the last NODE_TEST_OUTPUT_TAIL_CHARS code points through cutTextToTail; seam=the limit parameter in place of 65,536; no_claim=the limit's value
test('a long recorded output keeps its end and counts the characters left out', () => {
  // Arrange
  const index = indexNodeTestOutput([
    printed(1, 'stdout', 'first line\nsecond line\n'),
  ])

  // Act
  const wholeLineFits = accumulateNodeTestOutput(index, 1, 12)
  const lineIsCut = accumulateNodeTestOutput(index, 1, 15)

  // Assert
  assert.deepEqual(wholeLineFits, {
    lines: [{ channel: 'stdout', text: 'second line', number: 1 }],
    omittedCharacters: 11,
    startsMidLine: false,
    inspectorLines: 0,
    hasOutput: true,
  })
  assert.deepEqual(lineIsCut, {
    lines: [
      { channel: 'stdout', text: 'ne', number: 0, cut: true },
      { channel: 'stdout', text: 'second line', number: 1 },
    ],
    omittedCharacters: 8,
    startsMidLine: true,
    inspectorLines: 0,
    hasOutput: true,
  })
})

// Value: protects=the Node inspector's own standard-error lines are counted for one muted line instead of shown or dropped silently, and output of only such lines or of terminal controls reads as nothing printed; fails_when=an inspector line shows as test output, the count is wrong, or a controls-only chunk makes the pane claim output; why_new=EN10's disclosed inspector line and DS7's empty state; seam=none; no_claim=inspector lines of other Node versions' wording
test('Node inspector lines are counted, not shown, and controls alone are no output', () => {
  // Arrange
  const index = indexNodeTestOutput([
    printed(
      1,
      'stderr',
      'Debugger listening on ws://127.0.0.1:9229/5f0c\nFor help, see: https://nodejs.org/en/docs/inspector\n',
    ),
    printed(2, 'stdout', '\u001b[2K'),
    printed(3, 'stdout', 'RUN src/jobs.test.ts\n'),
    printed(4, 'stderr', 'Debugger attached.\n'),
  ])

  // Act
  const onlyInspector = accumulateNodeTestOutput(index, 2)
  const withOutput = accumulateNodeTestOutput(index, 4)

  // Assert
  assert.equal(onlyInspector.hasOutput, false)
  assert.equal(onlyInspector.inspectorLines, 2)
  assert.deepEqual(onlyInspector.lines, [])
  assert.equal(withOutput.inspectorLines, 3)
  assert.deepEqual(withOutput.lines, [
    { channel: 'stdout', text: 'RUN src/jobs.test.ts', number: 0 },
  ])
})
