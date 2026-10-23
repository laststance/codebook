import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { NodeTestHistoryEntry } from '../nodeTestHistorySchemas'
import { accumulateNodeTestOutput } from '../utils/accumulateNodeTestOutput'
import * as tailCut from '../utils/cutTextToTail'
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

// Value: protects=a color sequence and a window-title string that the launcher's 4,096-character entry limit split across entries leave no tail or forged title in the lines, and the entries of the other channel between them do not break the string; fails_when=`2m` or `forged title` shows as output, or a line is lost; why_new=F109 and F148 (controls were removed per entry); seam=none; no_claim=the bounds of a stray introducer, which stripTerminalControls's tests pin
test('terminal strings split across output entries leave no text in the lines', () => {
  // Arrange
  const index = indexNodeTestOutput([
    printed(1, 'stdout', 'green \u001b[3'),
    printed(2, 'stderr', 'warn\n'),
    printed(3, 'stdout', '2mtext\n\u001b]0;forged '),
    printed(4, 'stdout', 'title\u0007next\n'),
  ])

  // Act
  const shown = accumulateNodeTestOutput(index, 4)

  // Assert
  assert.deepEqual(shown.lines, [
    { channel: 'stdout', text: 'green ', number: 0 },
    { channel: 'stderr', text: 'warn', number: 1 },
    { channel: 'stdout', text: 'text', number: 2 },
    { channel: 'stdout', text: 'next', number: 3 },
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

// Value: protects=the characters left out are counted from the text the pane keeps: a standard-error line whose text fits the room left but whose `[stderr] ` mark does not is kept without its mark, and the left-out count includes the mark; fails_when=the cut line is counted as the room it was offered (9 characters and a line feed) although it keeps 8, so the count undercounts by one; why_new=F114 (limit 15 over `first line`, stderr `warn one` and `last` said 19 left out for 20); seam=none; no_claim=the wording of the muted line
test('the characters left out count the kept text of a cut standard-error line', () => {
  // Arrange
  const index = indexNodeTestOutput([
    printed(1, 'stdout', 'first line\n'),
    printed(2, 'stderr', 'warn one\n'),
    printed(3, 'stdout', 'last\n'),
  ])

  // Act
  const shown = accumulateNodeTestOutput(index, 3, 15)

  // Assert
  assert.deepEqual(shown, {
    lines: [
      { channel: 'stderr', text: 'warn one', number: 1, cut: true },
      { channel: 'stdout', text: 'last', number: 2 },
    ],
    omittedCharacters: 20,
    startsMidLine: true,
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

/** How many distinct objects (arrays included) a value holds at any depth, so a test can bound what an index keeps per line. */
const heldObjects = (value: unknown, seen = new Set<unknown>()): number => {
  if (typeof value !== 'object' || value === null || seen.has(value)) return 0
  seen.add(value)
  return Object.values(value).reduce<number>(
    (count, member) => count + heldObjects(member, seen),
    1,
  )
}

// Value: protects=the output index keeps its lines as numbers (offsets into the recorded text), not as one object per line, so a history of millions of short lines is not millions of objects while the replay is selected, and the kept tail's lines are made only when a moment is shown; fails_when=the index holds an object for each complete line (262,144 lines held 262,144 objects), or a line read from offsets differs from the line printed; why_new=F149 (the index turned every complete line into a `{ channel, text }` object before the 65,536-character view applied); seam=none; no_claim=the heap itself, which this bound on held objects stands in for
test('the output index keeps no object per line and still shows the right lines', () => {
  // Arrange
  const entries = Array.from({ length: 64 }, (_, index) =>
    printed(
      index + 1,
      index % 2 === 0 ? 'stdout' : 'stderr',
      'x\n'.repeat(4_096),
    ),
  )

  // Act
  const index = indexNodeTestOutput(entries)
  const shown = accumulateNodeTestOutput(index, 64, 33)

  // Assert
  const held = heldObjects(index)
  assert.ok(held < 1_000, `the index holds ${held} objects for 262,144 lines`)
  assert.deepEqual(
    shown.lines.map((line) => [line.channel, line.text, line.number]),
    [
      ['stderr', 'x', 262_141],
      ['stderr', 'x', 262_142],
      ['stderr', 'x', 262_143],
    ],
  )
})

// Value: protects=showing the output up to a moment costs about its kept tail, however many lines it holds and however long its last line is: 262,144 one-character lines and one unfinished line of 8 MiB are each assembled in well under a second; fails_when=the kept lines are put first one by one (quadratic in the kept lines: about 4 s for 262,144) or a whole line is handed to the cut, which spreads it into characters (its whole length per selection); why_new=/ship Step 11's Codex adversarial review and the carried F107 and F108: about 0.5 s per selection for 65,536 short lines, recomputed at every 250 ms refresh (F111); why_changed=F325 (PR-2 /ship Step 9 pass 2 testing): one timed run could fail on a runner pause, so the short lines' time is the fastest of three, and the long line's 200 ms bound could not catch the whole-line spread it named (about 20 ms), so it is now the length the cut reads; seam=none; no_claim=the Application document's own update, which the Reader DOM check times
test('showing the output up to a moment costs about its tail for many short lines and one very long line', (context) => {
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

  // Act: each is timed three times and its fastest run kept, so a pause of the runner (a garbage collection, a busy shard) cannot fail it, while a regression slows every run.
  const fastestOf = <Result>(run: () => Result) => {
    let result = run(),
      fastestMs = Number.POSITIVE_INFINITY
    for (let attempt = 0; attempt < 3; attempt++) {
      const started = performance.now()
      result = run()
      fastestMs = Math.min(fastestMs, performance.now() - started)
    }
    return { result, fastestMs }
  }
  const { result: manyLines, fastestMs: shortMs } = fastestOf(() =>
    accumulateNodeTestOutput(shortLines, 64, 524_288),
  )
  const cuts = context.mock.method(tailCut, 'cutTextToTail')
  const oneLine = accumulateNodeTestOutput(longLine, 2_048)
  const longestCutInput = Math.max(
    ...cuts.mock.calls.map((call) => call.arguments[0].length),
  )

  // Assert
  assert.equal(manyLines.lines.length, 262_144)
  assert.equal(manyLines.lines[0]?.number, 0)
  assert.equal(oneLine.lines[0]?.text.length, 65_536)
  // gstack-timing-ok: the quadratic assembly takes about 4 s even as the fastest of three runs on the Mac (forced probe, F325); the linear one takes a few milliseconds, so the bound leaves a wide margin under load
  assert.ok(shortMs < 1_000, `262,144 lines took ${shortMs.toFixed(0)} ms`)
  // One 8 MiB line costs its 65,536-character tail: the cut reads at most two units per kept character, never the whole line (a whole-line spread costs about 20 ms here, which no wall-clock bound can tell from load).
  assert.ok(
    longestCutInput <= 131_072,
    `the cut read ${longestCutInput} characters of an 8 MiB line`,
  )
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

// Value: protects=a surrogate pair split across two output entries counts as one character, so `omittedCharacters` and the 65,536-character limit do not drift by one per split; fails_when=the line `😀ab` split inside the emoji costs 5 characters instead of 4 and a 4-character limit cuts it; why_new=F291 (each entry's part was counted alone); seam=none; no_claim=that the launcher ever splits a pair (it does not; a forged history may)
test('a surrogate pair split across two output entries is one character in the tail', () => {
  // Arrange
  const emoji = '😀'
  const index = indexNodeTestOutput([
    printed(1, 'stdout', emoji.slice(0, 1)),
    printed(2, 'stdout', `${emoji.slice(1)}ab\n`),
  ])

  // Act
  const tail = accumulateNodeTestOutput(index, 2, 4)
  const beforeLineFeed = accumulateNodeTestOutput(
    indexNodeTestOutput([
      printed(1, 'stdout', emoji.slice(0, 1)),
      printed(2, 'stdout', `${emoji.slice(1)}ab`),
    ]),
    2,
    3,
  )

  // Assert
  assert.deepEqual(tail.lines, [{ channel: 'stdout', text: '😀ab', number: 0 }])
  assert.equal(tail.omittedCharacters, 0)
  assert.deepEqual(beforeLineFeed.lines, [
    { channel: 'stdout', text: '😀ab', number: 0 },
  ])
  assert.equal(beforeLineFeed.omittedCharacters, 0)
})

// Value: protects=a high surrogate that ends one channel's line and a low surrogate that starts the other channel's next line are two lines, so no character is taken off the second; fails_when=the new line counts one code point less because the previous entry ended with a high surrogate; why_new=F291 (the fix must join a pair only inside one line); seam=none; no_claim=how a lone surrogate is drawn
test('a lone high surrogate at the end of one channel does not shorten the next channel’s line', () => {
  // Arrange
  const index = indexNodeTestOutput([
    printed(1, 'stdout', '\ud83d'),
    printed(2, 'stderr', '\ude00x\n'),
  ])

  // Act
  const tail = accumulateNodeTestOutput(index, 2)

  // Assert
  assert.deepEqual(
    tail.lines.map((line) => line.text),
    ['\ud83d', '\ude00x'],
  )
  assert.equal(tail.omittedCharacters, 0)
  assert.equal(index.lineTotals[2], 1 + 1 + 9 + 2 + 1)
})
