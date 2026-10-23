import assert from 'node:assert/strict'
import { test } from 'node:test'

import { NODE_TEST_HISTORY_VERSION } from '../constants'
import type {
  NodeTestHistoryEntry,
  NodeTestHistoryIndex,
} from '../nodeTestHistorySchemas'
import { sanitizeNodeTestHistory } from '../utils/sanitizeNodeTestHistory'

import { nodeTestHistoryHeader } from './utils/nodeTestHistoryFixture'

const baseHeader = nodeTestHistoryHeader('workspace')

/** A sealed history whose recorded texts carry a right-to-left override (U+202E) and a color sequence split across two output entries. */
function forgedHistory(): NodeTestHistoryIndex {
  const entries: NodeTestHistoryEntry[] = [
    {
      type: 'output',
      sequence: 1,
      elapsedMs: 10,
      outputSequence: 1,
      channel: 'stdout',
      text: 'pass‮ed \u001b[3',
    },
    {
      type: 'output',
      sequence: 2,
      elapsedMs: 20,
      outputSequence: 2,
      channel: 'stdout',
      text: '2mgreen\n',
    },
    {
      type: 'stop',
      sequence: 3,
      elapsedMs: 30,
      index: 0,
      source: { path: 'src/a.ts', hash: 'a'.repeat(64), line: 1, column: 1 },
      frame: { name: 'run', line: 1, column: 1 },
      facts: [
        { path: 'name', mode: 'value', display: 'ev‮il', type: 'string' },
      ],
      debuggerSnapshot: {
        version: 1,
        frames: [],
        variables: [],
        limitations: [],
      },
    },
    {
      type: 'result',
      sequence: 4,
      elapsedMs: 40,
      exitCode: 0,
      signal: null,
      outputTail: 'tail ‮reversed\u001b[0m',
    },
  ]
  return {
    header: {
      version: NODE_TEST_HISTORY_VERSION,
      ...baseHeader,
      configuration: {
        ...baseHeader.configuration,
        testTitles: ['suite ‮title', 'works'],
      },
    },
    entries,
    status: 'complete',
  }
}

// Value: protects=every recorded text a replay surface prints (output entries, the result's output tail, a stop's fact display and the cited test's titles) loses bidirectional and terminal controls in one host-side pass, with a color sequence split across two output entries removed whole; fails_when=a U+202E or a sequence tail such as `2m` survives in any of those fields, or the stop's source or the entry count changes; why_new=F131 (only the Application output region was stripped); seam=none; no_claim=how each surface lays the text out
test('a replay’s recorded texts come without bidirectional and terminal controls and its identity is unchanged', () => {
  // Arrange
  const history = forgedHistory()

  // Act
  const shown = sanitizeNodeTestHistory(history)

  // Assert
  assert.deepEqual(shown.header.configuration.testTitles, [
    'suite title',
    'works',
  ])
  assert.deepEqual(
    shown.entries.map((entry) =>
      entry.type === 'output'
        ? entry.text
        : entry.type === 'result'
          ? entry.outputTail
          : entry.facts.map((fact) => fact.display).join(),
    ),
    ['passed ', 'green\n', 'evil', 'tail reversed'],
  )
  assert.equal(shown.entries.length, 4)
  const stop = shown.entries[2]
  assert.deepEqual(stop?.type === 'stop' ? stop.source : undefined, {
    path: 'src/a.ts',
    hash: 'a'.repeat(64),
    line: 1,
    column: 1,
  })
  // The input history is not changed.
  const first = history.entries[0]
  assert.equal(
    first?.type === 'output' ? first.text : undefined,
    'pass‮ed \u001b[3',
  )
})

/** A history whose only stop carries a right-to-left override (U+202E) in the field under test. */
function historyWithStop(
  field: 'source.path' | 'frame.name' | 'fact.path',
): NodeTestHistoryIndex {
  const history = forgedHistory()
  const entries = history.entries.map((entry) =>
    entry.type !== 'stop'
      ? entry
      : {
          ...entry,
          source: {
            ...entry.source,
            path: field === 'source.path' ? 'src/‮a.ts' : entry.source.path,
          },
          frame: {
            ...entry.frame,
            name: field === 'frame.name' ? 'ru‮n' : entry.frame.name,
          },
          facts: entry.facts.map((fact) => ({
            ...fact,
            path: field === 'fact.path' ? 'na‮me' : fact.path,
          })),
        },
  )
  return { ...history, entries }
}

// Value: protects=the Study section's event rows print source.path, frame.name and facts[].path, so each loses a bidirectional control like facts[].display does; fails_when=a U+202E survives in the stop's source path, frame name or fact path; why_new=F287 (only fact displays were stripped); seam=none; no_claim=the stop still verifies (the host verifies the stored history)
for (const [field, expected] of [
  ['source.path', 'src/a.ts'],
  ['frame.name', 'run'],
  ['fact.path', 'name'],
] as const) {
  test(`a stop's ${field} comes without bidirectional controls`, () => {
    // Arrange
    const history = historyWithStop(field)

    // Act
    const stop = sanitizeNodeTestHistory(history).entries[2]

    // Assert
    assert.equal(stop?.type, 'stop')
    const shown =
      stop?.type !== 'stop'
        ? undefined
        : field === 'source.path'
          ? stop.source.path
          : field === 'frame.name'
            ? stop.frame.name
            : stop.facts[0]?.path
    assert.equal(shown, expected)
  })
}
