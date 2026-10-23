import assert from 'node:assert/strict'
import { test } from 'node:test'

import { describeNodeTestReplay } from '../utils/describeNodeTestReplay'
import { formatCodebookDiagnostic } from '../utils/formatCodebookDiagnostic'

// Value: protects=the Saved studies rows of test replays: complete, partial and interrupted name their verdict, capture and explained stops, a recording history reads recording, and one that fails verification reads unavailable; fails_when=a row reads otherwise than the String catalog or calls a sealed history's replay unavailable; why_new=the rows said "application video and synchronized replay unavailable" (the test replay row's wording in the Study workspace, DS14, AC8); seam=none; no_claim=the row's place in the list
test('Saved studies rows of test replays name their verdict, capture and explained stops', () => {
  // Arrange
  const sealed = {
    verification: 'verified' as const,
    verdict: 'Test passed · exit code 0' as const,
    stopCount: 2,
    explainedStopCount: 1,
  }

  // Act
  const rows = [
    describeNodeTestReplay({
      kind: 'saved-row',
      summary: { ...sealed, status: 'complete' },
    }),
    describeNodeTestReplay({
      kind: 'saved-row',
      summary: {
        ...sealed,
        status: 'partial',
        verdict: 'Test failed · exit code 1',
      },
    }),
    describeNodeTestReplay({
      kind: 'saved-row',
      summary: {
        ...sealed,
        status: 'interrupted',
        verdict: 'No result recorded',
      },
    }),
    describeNodeTestReplay({
      kind: 'saved-row',
      summary: { ...sealed, status: 'recording' },
    }),
    describeNodeTestReplay({
      kind: 'saved-row',
      summary: { ...sealed, status: 'partial', verification: 'unavailable' },
    }),
  ]

  // Assert
  assert.deepEqual(rows, [
    'Test replay · Test passed · exit code 0 · capture complete · 1 of 2 stops explained',
    'Test replay · Test failed · exit code 1 · capture partial · 1 of 2 stops explained',
    'Test replay · No result recorded · capture interrupted · 1 of 2 stops explained',
    'Test replay · recording',
    'Test replay · unavailable',
  ])
})

// Value: protects=the Application pane's header, accessible names and muted lines for a test replay: the selected event's time, the cited test with and without its titles, the cut and the hidden inspector lines; fails_when=a line reads otherwise than the String catalog, the time loses its two decimals, or a retired header without titles prints a separator; why_new=PR-B1 moves the recorded output into the Application pane (Design 3, DS4, E2, EN10); seam=none; no_claim=the document's layout or its in-place updates
test('the Application pane names the recorded time, the cited test and the parts it leaves out', () => {
  // Arrange
  const test = {
    testFile: 'src/jobs.test.ts',
    testTitles: ['job scheduler', 'runs a delayed job'],
  }

  // Act
  const words = [
    describeNodeTestReplay({ kind: 'application-time', elapsedMs: 1234 }),
    describeNodeTestReplay({ kind: 'application-test', test }),
    describeNodeTestReplay({
      kind: 'application-test',
      test: { testFile: 'src/jobs.test.ts' },
    }),
    describeNodeTestReplay({ kind: 'application-name', test, elapsedMs: 1234 }),
    describeNodeTestReplay({ kind: 'application-name', test }),
    describeNodeTestReplay({ kind: 'application-region', elapsedMs: 1234 }),
    describeNodeTestReplay({
      kind: 'application-cut',
      characters: 120,
      startsMidLine: false,
    }),
    describeNodeTestReplay({
      kind: 'application-cut',
      characters: 120,
      startsMidLine: true,
    }),
    describeNodeTestReplay({ kind: 'application-inspector', lines: 3 }),
  ]

  // Assert
  assert.deepEqual(words, [
    'Recorded test output · 1.23 s',
    'src/jobs.test.ts › job scheduler › runs a delayed job',
    'src/jobs.test.ts',
    'Recorded test output · src/jobs.test.ts › job scheduler › runs a delayed job · 1.23 s',
    'Recorded test output · src/jobs.test.ts › job scheduler › runs a delayed job',
    'Recorded test output up to 1.23 s',
    '… 120 earlier characters not shown',
    '… 120 earlier characters not shown; the first line below is cut',
    '3 Node inspector lines hidden',
  ])
})

// Value: protects=the Application pane's muted lines read in the singular for one character and one inspector line; fails_when=a count of one reads `1 earlier characters` or `1 Node inspector lines`; why_new=F105 (the plural forms printed for one); seam=none; no_claim=the wording of other counts, which the test above pins
test('the Application pane’s muted lines use the singular for a count of one', () => {
  // Arrange
  const cut = { kind: 'application-cut', characters: 1 } as const

  // Act
  const words = [
    describeNodeTestReplay({ ...cut, startsMidLine: false }),
    describeNodeTestReplay({ ...cut, startsMidLine: true }),
    describeNodeTestReplay({ kind: 'application-inspector', lines: 1 }),
  ]

  // Assert
  assert.deepEqual(words, [
    '… 1 earlier character not shown',
    '… 1 earlier character not shown; the first line below is cut',
    '1 Node inspector line hidden',
  ])
})

// Value: protects=the Study section's status, position lines, step actions and event-list summary for a test replay; fails_when=a stop's number is not 1-based, the result's line does not lead with its verdict, or a line reads otherwise than the String catalog; why_new=PR-B1 replaces the Study pane's metadata-first position text and raw event counts (DS3, DS14, DS16, DS21); seam=none; no_claim=which event or step the section selects
test('the Study section locates the selected stop, output and result and names each step’s event', () => {
  // Arrange
  const verdict = 'Test passed · exit code 0'

  // Act
  const words = [
    describeNodeTestReplay({
      kind: 'study-status',
      summary: {
        status: 'complete',
        verdict,
        stopCount: 2,
        explainedStopCount: 1,
      },
    }),
    describeNodeTestReplay({
      kind: 'position',
      event: { type: 'stop', index: 0, stopCount: 2 },
      elapsedMs: 420,
    }),
    describeNodeTestReplay({
      kind: 'position',
      event: { type: 'output' },
      elapsedMs: 50,
    }),
    describeNodeTestReplay({
      kind: 'position',
      event: { type: 'result', verdict },
      elapsedMs: 900,
    }),
    describeNodeTestReplay({
      kind: 'step-action',
      event: { type: 'stop', index: 1 },
      elapsedMs: 700,
    }),
    describeNodeTestReplay({
      kind: 'step-action',
      event: { type: 'result' },
      elapsedMs: 900,
    }),
    describeNodeTestReplay({ kind: 'events', count: 7 }),
  ]

  // Assert
  assert.deepEqual(words, [
    'Test passed · exit code 0 · capture complete · 1 of 2 stops explained',
    'Stop 1 of 2 · 0.42 s',
    'Output · 0.05 s',
    'Result · Test passed · exit code 0 · 0.90 s',
    'Inspect stop 2 · 0.70 s',
    'Inspect result · 0.90 s',
    'Events (7)',
  ])
})

// Value: protects=the Output › Codebook entry of an unexpected failure: the code or surface, the study, the profile, the versions and the host, the sanitized cause and the stack; fails_when=a field is missing or the entry mixes fields on one line; why_new=failures on these paths had no channel (X5, AC17); seam=none; no_claim=the host's log levels
test('an Output entry names the surface, the study, the profile, the versions, the host, the cause and the stack', () => {
  // Arrange
  const entry = {
    surface: 'HISTORY_SEAL_FAILED',
    studyId: 'a_b',
    profile: 'node-test',
    cause: 'ENOSPC: no space left on device, write',
    stack:
      'at NodeTestHistoryWriter.finish (~/dist/nodeTestHistoryStore.js:812:13)',
  }

  // Act
  const text = formatCodebookDiagnostic(entry, {
    extensionVersion: '0.2.33',
    apiVersion: '1.8',
    hostName: 'Visual Studio Code',
    hostVersion: '1.143.0',
  })

  // Assert
  assert.equal(
    text,
    'HISTORY_SEAL_FAILED · study a_b · profile node-test\nCodebook 0.2.33 (API 1.8) · Visual Studio Code 1.143.0\nCause: ENOSPC: no space left on device, write\nat NodeTestHistoryWriter.finish (~/dist/nodeTestHistoryStore.js:812:13)',
  )
})

// Value: protects=the Study section's status line names a test replay that is still recording, and the capture of a partial or interrupted one, as Saved studies does; fails_when=a recording replay reads a verdict and a capture it does not have yet, or a partial or interrupted capture reads another word; why_new=Step 9's testing review found only a complete replay's status line pinned; seam=none; no_claim=which history the section shows
test('the Study section status names a recording, partial or interrupted test replay', () => {
  // Arrange
  const summary = {
    verdict: 'Test failed · exit code 1' as const,
    stopCount: 1,
    explainedStopCount: 0,
  }

  // Act
  const words = [
    describeNodeTestReplay({
      kind: 'study-status',
      summary: {
        ...summary,
        status: 'recording',
        verdict: 'No result recorded',
      },
    }),
    describeNodeTestReplay({
      kind: 'study-status',
      summary: { ...summary, status: 'partial' },
    }),
    describeNodeTestReplay({
      kind: 'study-status',
      summary: { ...summary, status: 'interrupted' },
    }),
  ]

  // Assert
  assert.deepEqual(words, [
    'Test replay · recording',
    'Test failed · exit code 1 · capture partial · 0 of 1 stops explained',
    'Test failed · exit code 1 · capture interrupted · 0 of 1 stops explained',
  ])
})
