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

// Value: protects=a chunk of only terminal controls, written on the other stream while a line is still being printed (a reporter's erase or cursor move on standard error in the middle of a standard-output line), changes no line and no channel: the unfinished line stays one line of its own channel and the lines after it keep their numbers; fails_when=the controls-only chunk ends the unfinished line (the line shows in two halves and every later line number moves by one) or is read as an empty line of its own channel; why_new=indexNodeTestOutput skips a chunk that holds only controls so a terminal's cursor moves cannot cut a line (EN10), and the test above puts its controls-only chunk where no line is unfinished, so removing that skip changes nothing it asserts; seam=none; no_claim=how the controls are removed (stripTerminalControls's tests)
test('a chunk of only terminal controls on the other stream leaves an unfinished line whole', () => {
  // Arrange
  const index = indexNodeTestOutput([
    printed(1, 'stdout', 'job 1 sch'),
    printed(2, 'stderr', '\u001b[2K\u001b[?25l'),
    printed(3, 'stdout', 'eduled\n'),
    printed(4, 'stdout', 'job 2 scheduled\n'),
  ])

  // Act
  const whileControlsArrive = accumulateNodeTestOutput(index, 2)
  const afterLineEnds = accumulateNodeTestOutput(index, 3)
  const afterNextLine = accumulateNodeTestOutput(index, 4)

  // Assert
  assert.deepEqual(whileControlsArrive.lines, [
    { channel: 'stdout', text: 'job 1 sch', number: 0 },
  ])
  assert.deepEqual(afterLineEnds.lines, [
    { channel: 'stdout', text: 'job 1 scheduled', number: 0 },
  ])
  assert.deepEqual(afterNextLine.lines, [
    { channel: 'stdout', text: 'job 1 scheduled', number: 0 },
    { channel: 'stdout', text: 'job 2 scheduled', number: 1 },
  ])
})

// Value: protects=each standard-error line's `[stderr] ` mark counts toward the kept tail and toward the characters left out, so the pane never shows more than its limit of shown text and says exactly how much it left out; fails_when=the mark is left out of a line's cost, so a tail of standard-error lines keeps more than the limit and the left-out count is too small; why_new=Step 9's testing review found every limit test written with standard-output lines only; seam=none; no_claim=the cut of a standard-error line whose mark does not fit (F114)
test('standard-error marks count toward the kept tail and the characters left out', () => {
  // Arrange
  const index = indexNodeTestOutput([
    printed(1, 'stderr', 'warn one\n'),
    printed(2, 'stderr', 'warn two\n'),
  ])

  // Act
  const shown = accumulateNodeTestOutput(index, 2, 18)

  // Assert
  assert.deepEqual(shown, {
    lines: [{ channel: 'stderr', text: 'warn two', number: 1 }],
    omittedCharacters: 18,
    startsMidLine: false,
    inspectorLines: 0,
    hasOutput: true,
  })
})

// Value: protects=an unfinished last line longer than the tail, such as a progress line a reporter redraws with carriage returns and never ends, keeps its end, is marked cut and counts no line feed; fails_when=the cut of an unfinished line loses a character or counts a line feed it does not have, so its kept end or the left-out count is off by one; why_new=Step 9's testing review found only lines ending with a line feed cut in the tests; seam=none; no_claim=how the pane renders the cut line
test('an unfinished last line longer than the tail keeps its end and counts no line feed', () => {
  // Arrange
  const index = indexNodeTestOutput([
    printed(1, 'stdout', 'done\nprogress 1 2 3'),
  ])

  // Act
  const shown = accumulateNodeTestOutput(index, 1, 5)

  // Assert
  assert.deepEqual(shown, {
    lines: [{ channel: 'stdout', text: '1 2 3', number: 1, cut: true }],
    omittedCharacters: 14,
    startsMidLine: true,
    inspectorLines: 0,
    hasOutput: true,
  })
})

/** Every string an object holds, at any depth, so a test can bound what an index keeps per entry. */
const heldStrings = (value: unknown, seen = new Set<unknown>()): string[] => {
  if (typeof value === 'string') return [value]
  if (typeof value !== 'object' || value === null || seen.has(value)) return []
  seen.add(value)
  return Object.values(value).flatMap((member) => heldStrings(member, seen))
}

// Value: protects=output printed without line feeds across many entries (a large object printed on one line, split into 4,096-character entries) keeps one copy of its unfinished line, not one copy per entry, so stepping or playing through it cannot exhaust the extension host's memory; fails_when=each entry's record keeps the unfinished line as printed so far (800 entries of 1,000 characters kept 800 growing copies, which a selection flattens: the heap grew from 25 to 331 MiB); why_new=/ship Step 11's Codex structured review (P1, measured) and Step 9's red team (F134, with F108); seam=none; no_claim=the heap itself, which this bound on what the index keeps per entry stands in for
test('an unfinished line printed across many entries is kept once, not once per entry', () => {
  // Arrange
  const entries = Array.from({ length: 800 }, (_, index) =>
    printed(index + 1, 'stdout', 'x'.repeat(1_000)),
  )

  // Act
  const index = indexNodeTestOutput(entries)

  // Assert
  const longest = index.after.reduce(
    (most, after) =>
      heldStrings(after).reduce(
        (longestHere, text) => Math.max(longestHere, text.length),
        most,
      ),
    0,
  )
  assert.ok(longest <= 1_000, `an entry's record holds ${longest} characters`)
  assert.equal(
    accumulateNodeTestOutput(index, 800, 2_500).lines[0]?.text,
    'x'.repeat(2_500),
  )
})

// Value: protects=showing the output up to a moment costs about its kept tail, however many lines it holds and however long its last line is: 262,144 one-character lines and one unfinished line of 8 MiB are each assembled in well under a second; fails_when=the kept lines are put first one by one (quadratic in the kept lines: about 8 s for 262,144) or a whole line is spread into characters to count or cut it (its whole length per selection); why_new=/ship Step 11's Codex adversarial review and the carried F107 and F108: about 0.5 s per selection for 65,536 short lines, recomputed at every 250 ms refresh (F111); seam=none; no_claim=the Application document's own update, which the Reader DOM check times
test('showing the output up to a moment costs about its tail for many short lines and one very long line', () => {
  // Arrange
  const shortLines = indexNodeTestOutput(
    Array.from({ length: 64 }, (_, index) =>
      printed(index + 1, 'stdout', 'x\n'.repeat(4_096)),
    ),
  )
  const longLine = indexNodeTestOutput(
    Array.from({ length: 2_048 }, (_, index) =>
      printed(index + 1, 'stdout', 'y'.repeat(4_096)),
    ),
  )

  // Act
  const startedShort = performance.now()
  const manyLines = accumulateNodeTestOutput(shortLines, 64, 524_288)
  const shortMs = performance.now() - startedShort
  const startedLong = performance.now()
  const oneLine = accumulateNodeTestOutput(longLine, 2_048)
  const longMs = performance.now() - startedLong

  // Assert
  assert.equal(manyLines.lines.length, 262_144)
  assert.equal(manyLines.lines[0]?.number, 0)
  assert.equal(oneLine.lines[0]?.text.length, 65_536)
  // gstack-timing-ok: the quadratic assembly took about 8 s and the whole-line spread about 1 s on the Mac; the linear ones take a few milliseconds, so the bounds leave a wide margin under load
  assert.ok(shortMs < 1_000, `262,144 lines took ${shortMs.toFixed(0)} ms`)
  // gstack-timing-ok: see above; one 8 MiB line costs its 65,536-character tail
  assert.ok(longMs < 200, `an 8 MiB line took ${longMs.toFixed(0)} ms`)
})

// Value: protects=the Node inspector's own lines of current Node versions fold into the muted count too: Node 24's help line (`For help, see: https://nodejs.org/learn/getting-started/debugging`) and its `Debugger ending on …` line are counted, not shown; fails_when=only the older help address is recognized, so every replay recorded on Node 24 shows `[stderr] For help, see: …` and its count is one short (the README says the inspector's lines fold); why_new=/ship Step 11's Claude adversarial review, which read the line from the installed Node v24.21.0; seam=none; no_claim=inspector wordings of later Node versions
test('the inspector lines of Node 24 are counted, not shown', () => {
  // Arrange
  const index = indexNodeTestOutput([
    printed(
      1,
      'stderr',
      'Debugger listening on ws://127.0.0.1:9229/5f0c\nFor help, see: https://nodejs.org/learn/getting-started/debugging\n',
    ),
    printed(2, 'stdout', 'RUN src/jobs.test.ts\n'),
    printed(3, 'stderr', 'Debugger ending on ws://127.0.0.1:9229/5f0c\n'),
  ])

  // Act
  const tail = accumulateNodeTestOutput(index, 3)

  // Assert
  assert.deepEqual(
    tail.lines.map((line) => line.text),
    ['RUN src/jobs.test.ts'],
  )
  assert.equal(tail.inspectorLines, 3)
})
