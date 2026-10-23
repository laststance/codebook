import assert from 'node:assert/strict'
import { test } from 'node:test'

import { describeCitedStopMismatch } from '../utils/describeCitedStopMismatch'

// Value: protects=the chat reading a node-test stop's anchorIndex refusal for an article node with one citation: the sentence counts it as one source range, so the chat sends anchorIndex 0; fails_when=one citation is worded "1 source ranges (anchorIndex 0 to 0)"; why_new=Cycle 0050 F242 (PR-1 CodeRabbit round 3); seam=none; no_claim=the wording for none or several citations, which prepareNodeTestStudy.test.ts pins
test('an anchorIndex refusal of an article node with one citation names one source range', () => {
  // Arrange
  const descriptor = {
    anchors: [
      {
        path: 'src/theme.ts',
        hash: 'a'.repeat(64),
        startLine: 1,
        endLine: 3,
      },
    ],
    sources: [],
  }

  // Act
  const refusal = describeCitedStopMismatch(
    'source',
    'anchor',
    { path: 'src/theme.ts', hash: 'a'.repeat(64), line: 2, column: 1 },
    1,
    descriptor,
  )

  // Assert
  assert.equal(
    refusal,
    'node-test preparation refused: source uses anchorIndex 1, but the article node cites one source range (anchorIndex 0). Send the anchorIndex of the citation that covers the stop.',
  )
})
