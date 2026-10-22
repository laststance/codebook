import assert from 'node:assert/strict'
import { test } from 'node:test'

import { NODE_TEST_HISTORY_VERSION } from '../constants'
import type {
  NodeTestHistoryEntry,
  NodeTestHistoryIndex,
} from '../nodeTestHistorySchemas'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { indexNodeTestOutput } from '../utils/indexNodeTestOutput'
import { projectNodeTestApplication } from '../utils/projectNodeTestApplication'

import { nodeTestHistoryHeader } from './utils/nodeTestHistoryFixture'

/** A sealed header as the store reads it back: the fixture's identity with its format version. */
const storedHeader = (
  workspaceKey: string,
): NodeTestHistoryIndex['header'] => ({
  version: NODE_TEST_HISTORY_VERSION,
  ...nodeTestHistoryHeader(workspaceKey),
})

const SOURCE_TEXT = 'const nextTheme = "dark";\n'

/** A test replay's header that cites its test by file and title path. */
const header: NodeTestHistoryIndex['header'] = (() => {
  const retired = storedHeader('workspace')
  return {
    ...retired,
    configuration: {
      ...retired.configuration,
      testTitles: ['theme', 'switches to dark'],
    },
  }
})()

const output = (
  sequence: number,
  elapsedMs: number,
  text: string,
): NodeTestHistoryEntry => ({
  type: 'output',
  sequence,
  elapsedMs,
  outputSequence: sequence,
  channel: 'stdout',
  text,
})

const stop = (sequence: number, elapsedMs: number): NodeTestHistoryEntry => ({
  type: 'stop',
  sequence,
  elapsedMs,
  index: 0,
  source: {
    path: 'src/theme.ts',
    hash: sha256(SOURCE_TEXT),
    line: 1,
    column: 1,
  },
  frame: { name: 'nextTheme', line: 1, column: 1 },
  facts: [],
  debuggerSnapshot: { version: 1, frames: [], variables: [], limitations: [] },
})

const result = (
  sequence: number,
  elapsedMs: number,
  exitCode: number,
): NodeTestHistoryEntry => ({
  type: 'result',
  sequence,
  elapsedMs,
  exitCode,
  signal: null,
  outputTail: '',
})

const entries = [
  output(1, 120, 'RUN src/theme.test.ts\n'),
  stop(2, 420),
  output(3, 700, 'between stops\n'),
  result(4, 900, 0),
]

// Value: protects=the Application pane at a stop names the recorded time and the cited test in its two header lines and accessible names, and shows only the output printed before the stop with no verdict; fails_when=the header leaves out the time or the test's title path, a later line or the verdict appears, or a placeholder claims nothing was printed; why_new=PR-B1 shows the recorded output in the Application pane (Design 3, DS4, E2, AC5); seam=none; no_claim=the document's layout
test('the Application view at a stop names its time and test and shows the output printed before it', () => {
  // Arrange
  const index = indexNodeTestOutput(entries)

  // Act
  const view = projectNodeTestApplication(
    { header, entries },
    index,
    entries[1],
    7,
    false,
  )

  // Assert
  assert.deepEqual(view, {
    generation: 7,
    state: 'event',
    time: 'Recorded test output · 0.42 s',
    test: 'src/theme.test.ts › theme › switches to dark',
    name: 'Recorded test output · src/theme.test.ts › theme › switches to dark · 0.42 s',
    region: 'Recorded test output up to 0.42 s',
    lines: [{ channel: 'stdout', text: 'RUN src/theme.test.ts', number: 0 }],
  })
})

// Value: protects=at the result the recorded output ends with the test's verdict, and at a last event that is no result it ends with the ended-early line; fails_when=the verdict is missing or bare (`Exit code 0`), or a replay cut short claims a result; why_new=DS2's verdict and DS7's ended-early state in the Application pane; seam=none; no_claim=the verdict's wording for other exits, which describeNodeTestResult's tests pin
test('the recorded output ends with the verdict at the result and says when the recording ended before it', () => {
  // Arrange
  const cutShort = entries.slice(0, 3)

  // Act
  const atResult = projectNodeTestApplication(
    { header, entries },
    indexNodeTestOutput(entries),
    entries[3],
    1,
    false,
  )
  const atLastOutput = projectNodeTestApplication(
    { header, entries: cutShort },
    indexNodeTestOutput(cutShort),
    cutShort[2],
    1,
    false,
  )

  // Assert
  assert.equal(atResult.end, 'Test passed · exit code 0')
  assert.deepEqual(
    atResult.lines.map((line) => line.text),
    ['RUN src/theme.test.ts', 'between stops'],
  )
  assert.equal(atLastOutput.end, 'Recording ended before the test result.')
})

// Value: protects=the Application pane's states read as the String catalog writes them: loading while the replay opens, no output yet before the first output, no entries without a time, and a retired header named by its file alone; fails_when=a state shows another's line, an empty replay shows a time, or a retired header prints a title separator; why_new=DS7 and E2 states of the Application pane; seam=none; no_claim=the pane's closed state, which the Study section shows
test('the Application view says loading, nothing printed yet and no entries, and names a retired test by its file', () => {
  // Arrange
  const retiredHeader = storedHeader('workspace')

  // Act
  const loading = projectNodeTestApplication(
    { header, entries },
    indexNodeTestOutput(entries),
    entries[1],
    2,
    true,
  )
  const beforeOutput = projectNodeTestApplication(
    { header, entries: [stop(1, 50), ...entries.slice(2)] },
    indexNodeTestOutput(entries.slice(2)),
    stop(1, 50),
    3,
    false,
  )
  const noEntries = projectNodeTestApplication(
    { header: retiredHeader, entries: [] },
    indexNodeTestOutput([]),
    undefined,
    4,
    false,
  )

  // Assert
  assert.equal(loading.state, 'loading')
  assert.equal(loading.placeholder, 'Loading recorded test output…')
  assert.equal(loading.time, undefined)
  assert.equal(
    beforeOutput.placeholder,
    'No test output recorded up to this moment.',
  )
  assert.equal(beforeOutput.time, 'Recorded test output · 0.05 s')
  assert.deepEqual(noEntries, {
    generation: 4,
    state: 'empty',
    test: 'src/theme.test.ts',
    name: 'Recorded test output · src/theme.test.ts',
    lines: [],
    placeholder: 'No test output recorded.',
  })
})

// Value: protects=the Application pane tells the learner what it leaves out instead of hiding it: a long output keeps its last 65,536 characters with its first kept line cut, and a muted line counts the earlier characters not shown (4,465 here) while the Node inspector's own lines are counted in another; fails_when=a long output shows no cut line or a wrong count, the cut first line is not named, the kept end is longer or shorter than 65,536 characters, or hidden inspector lines are neither shown nor counted; why_new=PR-B1 keeps only the end of the recorded output (EN10) and folds the inspector's lines, and a view that truncates must disclose it (PRODUCT_GOAL: disclose truncated evidence; the README promises the last 65,536 characters); seam=none; no_claim=the wording for other counts or for a count of one, which describeNodeTestReplay's tests and the carried wording task F105 cover (also: the default limit, not a test limit)
test('the Application view of a long output says how many earlier characters it leaves out and how many inspector lines it hides', () => {
  // Arrange
  const noisy: NodeTestHistoryEntry[] = [
    {
      type: 'output',
      sequence: 1,
      elapsedMs: 20,
      outputSequence: 1,
      channel: 'stderr',
      text: 'Debugger listening on ws://127.0.0.1:9229/5f0c\nDebugger attached.\n',
    },
    output(2, 120, `${'x'.repeat(70_000)}\n`),
    stop(3, 420),
    result(4, 900, 0),
  ]

  // Act
  const view = projectNodeTestApplication(
    { header, entries: noisy },
    indexNodeTestOutput(noisy),
    noisy[2],
    5,
    false,
  )

  // Assert
  assert.deepEqual(view, {
    generation: 5,
    state: 'event',
    time: 'Recorded test output · 0.42 s',
    test: 'src/theme.test.ts › theme › switches to dark',
    name: 'Recorded test output · src/theme.test.ts › theme › switches to dark · 0.42 s',
    region: 'Recorded test output up to 0.42 s',
    lines: [
      { channel: 'stdout', text: 'x'.repeat(65_535), number: 0, cut: true },
    ],
    cut: '… 4465 earlier characters not shown; the first line below is cut',
    inspector: '2 Node inspector lines hidden',
  })
})
