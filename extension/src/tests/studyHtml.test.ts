import assert from 'node:assert/strict'
import { test } from 'node:test'

import { studyHtml } from '../ui/studyHtml'

// Value: protects=the Run and Debug hint working in Cursor, where expanding a collapsed Variables lists scopes without loading values; fails_when=the reader's hint stops naming the first scope; why_new=Cycle 0033 C1 / AC5 (the hint text had only the DOM harness case); seam=none
test('the Run and Debug hint tells the learner to expand the first Variables scope when it stays closed', () => {
  // Arrange
  const expectedHint =
    'Recorded values for this moment load in Run and Debug: open it, expand Variables, then expand its first scope if it stays closed. If Call Stack lists several sessions, select “Codebook · Recorded learning” first.'

  // Act
  const readerHtml = studyHtml('context')

  // Assert
  assert.equal(readerHtml.includes(expectedHint), true)
})
