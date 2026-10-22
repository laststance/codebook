import assert from 'node:assert/strict'
import { test } from 'node:test'

import { describeNodeTestReplay } from '../utils/describeNodeTestReplay'
import { formatCodebookDiagnostic } from '../utils/formatCodebookDiagnostic'

// Value: protects=the Saved studies rows of test replays: complete, partial and interrupted name their verdict, capture and explained stops, a recording history reads recording, and one that fails verification reads unavailable; fails_when=a row reads otherwise than the String catalog or calls a sealed history's replay unavailable; why_new=the rows said "application video and synchronized replay unavailable" (studyWorkspace.ts:11862, DS14, AC8); seam=none; no_claim=the row's place in the list
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

// Value: protects=the Application pane's interim sentence for a test replay until PR-B1 shows the output there; fails_when=the pane says the test history has no replay; why_new=the pane read "Node test history · application video unavailable" (capturedAppHtml.ts:17, EN18); seam=none; no_claim=the output rendering of PR-B1
test('the Application pane points to the Study pane for a test replay’s recorded output', () => {
  // Arrange / Act / Assert
  assert.equal(
    describeNodeTestReplay({ kind: 'application-interim' }),
    'Recorded test output for this test replay is in the Study pane.',
  )
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
