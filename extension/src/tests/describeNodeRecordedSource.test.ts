import assert from 'node:assert/strict'
import { test } from 'node:test'

import ts from 'typescript'

import type { NodeTestHistoryEntry } from '../nodeTestHistorySchemas'
import { sha256 } from '../runtimeSupport/utils/sha256'
import {
  describeNodeRecordedSource,
  NODE_RECORDED_SOURCE_TEXT,
} from '../utils/describeNodeRecordedSource'
import { formatEventSeconds } from '../utils/formatEventSeconds'
import { isNodeSourceSlotPath } from '../utils/isNodeSourceSlotPath'
import { nodeSourceSlotName } from '../utils/nodeSourceSlotName'
import { nodeSourceSlotPath } from '../utils/nodeSourceSlotPath'

import { nodeTestHistoryHeader } from './utils/nodeTestHistoryFixture'

/**
 * Builds a saved test stop in `src/scheduler.ts` whose captured source verifies, or, with `edited`, whose captured text no longer hashes to its sealed hash.
 * @param sequence - The stop's journal sequence.
 * @param edited - Whether the captured text was changed after the seal.
 * @returns The stop entry.
 * @example schedulerStop(2) // a verified stop at sequence 2
 */
function schedulerStop(
  sequence: number,
  edited = false,
): Extract<NodeTestHistoryEntry, { type: 'stop' }> {
  const text = 'export const delay = 250;\n'
  return {
    type: 'stop',
    sequence,
    elapsedMs: 200,
    index: 0,
    source: {
      path: 'src/scheduler.ts',
      hash: sha256(text),
      line: 1,
      column: 1,
    },
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
            name: 'src/scheduler.ts',
            text: edited ? 'export const delay = 0;\n' : text,
            hash: sha256(text),
            line: 1,
          },
          scopes: [],
        },
      ],
      variables: [],
      limitations: [],
    },
  }
}

// Value: protects=the String catalog's recorded-source words: the slot's label at a verified stop, the debugger thread, the slot's open failure with and without a stop, and the slot's tab title; fails_when=any of them is worded otherwise than the catalog, names the stop 0-based, or says "Node" in the thread (DS14); why_new=PR-B2's recorded-source slot (Design 4, DS5, DS18); seam=none; no_claim=where each surface draws the words (the slot tests)
test('the recorded-source slot and its debugger thread are worded as the String catalog writes them', () => {
  // Arrange / Act / Assert
  assert.equal(
    describeNodeRecordedSource({
      kind: 'label',
      path: 'src/scheduler.ts',
      line: 12,
      elapsedMs: 1234,
    }),
    'Recorded: src/scheduler.ts:12 · 1.23 s',
  )
  assert.equal(
    describeNodeRecordedSource({
      kind: 'thread',
      stop: 2,
      path: 'src/scheduler.ts',
      line: 12,
    }),
    'Recorded test stop 2 · src/scheduler.ts:12',
  )
  assert.equal(
    describeNodeRecordedSource({
      kind: 'open-failed',
      stop: 2,
      cause: 'EACCES: permission denied',
    }),
    'Codebook could not open the recorded source of stop 2: EACCES: permission denied. Details: Output › Codebook.',
  )
  assert.equal(
    describeNodeRecordedSource({
      kind: 'open-failed',
      cause: 'EACCES: permission denied',
    }),
    'Codebook could not open the recorded source: EACCES: permission denied. Details: Output › Codebook.',
  )
  assert.equal(
    describeNodeRecordedSource({
      kind: 'tab-title',
      path: 'src/jobs/scheduler.ts',
    }),
    'Captured-scheduler.ts',
  )
  assert.equal(
    NODE_RECORDED_SOURCE_TEXT.placeholder,
    '// Recorded source · Not recorded at this moment\n// The test journal holds no source state for this moment.\n',
  )
  assert.equal(
    NODE_RECORDED_SOURCE_TEXT.loading,
    '// Loading recorded source…\n',
  )
})

// Value: protects=an event's time on every test replay surface: seconds since the run started with two decimals; fails_when=the time is rounded otherwise or carries its unit; why_new=the formatter moved out of describeNodeTestReplay so the slot's label shares it; seam=none; no_claim=none beyond protects
test('a recorded event’s time reads as seconds with two decimals', () => {
  // Arrange / Act / Assert
  assert.equal(formatEventSeconds(1234), '1.23')
  assert.equal(formatEventSeconds(0), '0.00')
  assert.equal(formatEventSeconds(60_005), '60.01')
})

// Value: protects=the slot's document name: one path per replay and file, its last segment the tab title; fails_when=two replays or two files share a slot path, or the path keeps the file's folders; why_new=DS5's one slot per history, renamed per file; seam=none; no_claim=the URI's scheme and authority, which the workspace adds
test('a recorded-source slot is named after its replay and the file of the stop it shows', () => {
  // Arrange / Act / Assert
  assert.equal(
    nodeSourceSlotPath('instance_run', 'src/jobs/scheduler.ts'),
    '/node-history-slot/instance_run/Captured-scheduler.ts',
  )
  assert.equal(
    nodeSourceSlotPath('instance_run', 'src/jobs/queue.ts'),
    '/node-history-slot/instance_run/Captured-queue.ts',
  )
})

// Value: protects=which captured-source documents count as recorded-source slots, so the workspace closes every slot tab but the shown one and serves a restored slot the placeholder; fails_when=a slot of another replay or file is not recognized (an orphan slot tab stays), or a stop preview or a live source view is taken for a slot (a learner's other captured tab closes); why_new=PR-B2 /ship Step 9 state-machines review (orphan slot tabs); seam=none; no_claim=the URI's scheme and authority, which the workspace checks
test('only paths under the slot root count as recorded-source slots', () => {
  // Arrange / Act / Assert
  assert.equal(
    isNodeSourceSlotPath(
      '/node-history-slot/instance_run/Captured-scheduler.ts',
    ),
    true,
  )
  assert.equal(
    isNodeSourceSlotPath('/node-history-slot/other_run/Captured-queue.ts'),
    true,
  )
  assert.equal(isNodeSourceSlotPath('/node-history/instance_run/2/abc'), false)
  assert.equal(isNodeSourceSlotPath('/views/node-history-slot.ts'), false)
})

// Value: protects=the name of a slot that opens on a placeholder: the file of the replay's first verified stop, so landing on that stop later does not rename the slot, else the test file; fails_when=an unverified stop names the slot, or a replay with a verified stop is named after its test file; why_new=Design 4's opening on an output or the result; seam=none; no_claim=renames at later stops (the slot tests)
test('a slot that opens on a placeholder is named after the first verified stop’s file, else the test file', () => {
  // Arrange
  const header = nodeTestHistoryHeader('workspace')
  const output: NodeTestHistoryEntry = {
    type: 'output',
    sequence: 1,
    elapsedMs: 100,
    outputSequence: 1,
    channel: 'stdout',
    text: 'RUN src/scheduler.test.ts\n',
  }

  // Act
  const withVerifiedStop = nodeSourceSlotName({
    header,
    entries: [output, schedulerStop(2)],
  })
  const withEditedStop = nodeSourceSlotName({
    header,
    entries: [output, schedulerStop(2, true)],
  })

  // Assert
  assert.equal(withVerifiedStop, 'src/scheduler.ts')
  assert.equal(withEditedStop, 'src/theme.test.ts')
})

// Value: protects=the slot's placeholder and loading text read as comments in every JavaScript or TypeScript file kind a slot is named after, so the editor's language service reports no problem for them in the learner's workspace; fails_when=a line of either text is plain words, which a TypeScript or JavaScript parser reports as syntax errors (the source-slot spike in VS Code showed 19 problems for the placeholder of a `.ts` slot); why_new=PR-B2's source-slot spike, VS Code 1.142.0 in the macOS Space; seam=the TypeScript compiler's parser stands in for the editor's language service; no_claim=other languages, which no test stop records
test('the slot’s placeholder and loading text parse without a syntax error as TypeScript and JavaScript', () => {
  // Arrange
  const fileNames = [
    'slot.ts',
    'slot.tsx',
    'slot.mts',
    'slot.cts',
    'slot.js',
    'slot.mjs',
    'slot.cjs',
    'slot.jsx',
  ]

  // Act
  const errors = fileNames.flatMap((fileName) =>
    [
      NODE_RECORDED_SOURCE_TEXT.placeholder,
      NODE_RECORDED_SOURCE_TEXT.loading,
    ].flatMap((text) => {
      const parsed = ts.createSourceFile(
        fileName,
        text,
        ts.ScriptTarget.Latest,
        false,
      )
      // parseDiagnostics holds what the parser reported for this text.
      const diagnostics = (
        parsed as unknown as { parseDiagnostics: readonly ts.Diagnostic[] }
      ).parseDiagnostics
      return diagnostics.map(
        (diagnostic) =>
          `${fileName}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`,
      )
    }),
  )

  // Assert
  assert.deepEqual(errors, [])
})

// Value: protects=the recorded-source slot's label, tab title and the replay debugger's thread name show a recorded path in its logical order: a right-to-left override in a file name does not reorder the text around it; fails_when=a name is built from the raw path, so the label, the title and the thread keep U+202E; why_new=F286: the Study section showed the stripped path while the slot and the debugger used the raw one; seam=none; no_claim=the slot's URI hash, which keeps the real path
test('a bidirectional control in a recorded path is left out of the slot label, the tab title and the debugger thread', () => {
  // Arrange
  const path = 'src/‮gnp.ts'

  // Act
  const label = describeNodeRecordedSource({
    kind: 'label',
    path,
    line: 3,
    elapsedMs: 1234,
  })
  const thread = describeNodeRecordedSource({
    kind: 'thread',
    stop: 2,
    path,
    line: 3,
  })
  const title = describeNodeRecordedSource({ kind: 'tab-title', path })

  // Assert
  assert.equal(label, 'Recorded: src/gnp.ts:3 · 1.23 s')
  assert.equal(thread, 'Recorded test stop 2 · src/gnp.ts:3')
  assert.equal(title, 'Captured-gnp.ts')
})
