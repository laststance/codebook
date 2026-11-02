import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ENTRY_LOAD_OPERATION_KEY } from '../constants'
import { hasObservedOperationResult } from '../utils/hasObservedOperationResult'

/** The continued pause an entry-load record stands on; its shape does not matter to the rule. */
const CONTINUED_PAUSE = { sessionId: 'server', generation: 1 }

// protects=a completed run of no operation gives a result its learning summary may cite; fails_when=the synthetic entry-load record (no input dispatched, continued pause) is not taken as an observed result; no_claim=the run that creates the record (serverRenderEntryOnly.test.ts covers it)
test('the entry-load record of a run of no operation is an observed result once its after conditions held', () => {
  // Arrange
  const record = {
    key: ENTRY_LOAD_OPERATION_KEY,
    inputDispatched: false,
    inputAcknowledged: false,
    afterVerified: true,
    continuedPause: CONTINUED_PAUSE,
  }
  // Act
  const observed = hasObservedOperationResult(record)
  // Assert
  assert.equal(observed, true)
})

// protects=OCR medium on the fix round: a real operation's result needs its acknowledged input, also when the caller keyed the operation "entry-load"; fails_when=a dispatched but unacknowledged operation keyed "entry-load" counts as an observed result; no_claim=how a key is chosen (the runtime only deduplicates keys)
test('an operation keyed entry-load whose input was dispatched but not acknowledged is not an observed result', () => {
  // Arrange
  const record = {
    key: ENTRY_LOAD_OPERATION_KEY,
    inputDispatched: true,
    inputAcknowledged: false,
    afterVerified: true,
    continuedPause: CONTINUED_PAUSE,
  }
  // Act
  const observed = hasObservedOperationResult(record)
  // Assert
  assert.equal(observed, false)
})
