import assert from 'node:assert/strict'
import { test } from 'node:test'

import { readNodeTestOutputReport } from '../utils/readNodeTestOutputReport'

// Value: protects=the host takes from an untrusted Application webview only the document's two reports and files a scroll anchor only when it is a non-negative whole line with a finite offset; fails_when=a malformed, extended or foreign message is accepted, or a missing anchor is reported as one; why_new=the workspace tests post one malformed state report; the schema's other refusals were untested; why_changed=F338 (PR-2 /ship Step 9 pass 3 simplification): the parser returns the report as sent and the host alone drops an absent anchor when it files the reading, so the test reads the anchor's value, not the key; seam=none; no_claim=what the host does with a report
test('a message from the Application webview is a report only when it has exactly the shape of the document’s ready or state report', () => {
  // Arrange
  const ready = {
    type: 'node-history-output-ready',
    history: 'study_1',
    generation: 3,
    follow: true,
  }
  const stateWithAnchor = {
    type: 'node-history-output-state',
    history: 'study_1',
    follow: false,
    anchor: { line: 3, offsetPx: 4 },
  }
  const stateWithUndefinedAnchor = {
    type: 'node-history-output-state',
    history: 'study_1',
    follow: true,
    anchor: undefined,
  }

  // Act
  const readReady = readNodeTestOutputReport(ready)
  const readAnchored = readNodeTestOutputReport(stateWithAnchor)
  const readUnanchored = readNodeTestOutputReport(stateWithUndefinedAnchor)

  // Assert
  assert.deepEqual(readReady, ready)
  assert.deepEqual(readAnchored, stateWithAnchor)
  assert.deepEqual(readUnanchored, stateWithUndefinedAnchor)
  assert.equal(
    readUnanchored?.type === 'node-history-output-state' &&
      readUnanchored.anchor,
    undefined,
  )
  const refused = [
    undefined,
    null,
    'node-history-output-ready',
    { type: 'node-history-output' },
    { ...ready, extra: 1 },
    { ...ready, generation: -1 },
    { ...ready, generation: 1.5 },
    { ...ready, follow: 'yes' },
    { ...stateWithAnchor, anchor: { line: -1, offsetPx: 4 } },
    { ...stateWithAnchor, anchor: { line: 1.5, offsetPx: 4 } },
    { ...stateWithAnchor, anchor: { line: 1, offsetPx: Infinity } },
    { ...stateWithAnchor, anchor: { line: 1, offsetPx: 4, extra: true } },
    { type: 'node-history-output-state', follow: true },
  ]
  for (const message of refused)
    assert.equal(
      readNodeTestOutputReport(message),
      undefined,
      JSON.stringify(message),
    )
})
