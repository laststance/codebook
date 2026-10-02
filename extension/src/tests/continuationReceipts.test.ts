import assert from 'node:assert/strict'
import { test } from 'node:test'

import { continuationReceipts } from '../utils/continuationReceipts'

// Value: protects=the journal entry being a copy of the receipts at that moment, not the live continuation that later receipts change; fails_when=the live object is returned or a receipt is dropped; why_new=the utility is new; seam=none
test('the receipts of a continuation in flight are copied as they are at that moment', () => {
  // Arrange
  const continuation = {
    participant: 'server',
    response: true,
    dap: true,
    cdp: false,
    afterStarted: false,
  }
  // Act
  const receipts = continuationReceipts(continuation)
  continuation.cdp = true
  // Assert
  assert.deepEqual(receipts, { response: true, dap: true, cdp: false })
})

// Value: protects=a pause with no continuation in flight being told apart from one whose receipts are all missing; fails_when=no continuation is journaled as three false receipts or left out; why_new=the utility is new; seam=none
test('no continuation in flight is reported as null', () => {
  // Arrange
  const continuation = undefined
  // Act
  const receipts = continuationReceipts(continuation)
  // Assert
  assert.equal(receipts, null)
})
