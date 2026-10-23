import assert from 'node:assert/strict'
import { test } from 'node:test'

import { historyExclusionState } from '../utils/historyExclusionState'

// Value: protects=every check of a run's history exclusion reads the three states the same way; fails_when=a run awaiting its admission is treated as ended (its slot evicted, its history action hidden) or as kept (checkpointed before the library answered); why_new=the predicate replaces three idioms in the service (0038-CQ5); seam=none
test('a run without an exclusion keeps its history, one awaiting admission waits, and a refused or removed run has ended', () => {
  // Arrange / Act / Assert
  assert.equal(historyExclusionState(undefined), 'kept')
  assert.equal(historyExclusionState('awaiting-admission'), 'awaiting')
  assert.equal(historyExclusionState('refused-at-admission'), 'ended')
  assert.equal(historyExclusionState('removed-by-learner'), 'ended')
})

// Value: protects=a node-test run refused during its preparation or stopped before its history began reads ended, so its slot is evicted first and its history is not offered; fails_when=either exclusion reads kept or awaiting (the run keeps a retained-run slot and read-history); why_new=the state's doc and test named only the admission and removal exclusions (F55); seam=none; no_claim=the start key (a refused run frees it, a stopped one keeps it: the lifecycle tests)
test('a test run refused during its preparation or stopped before its history began has ended', () => {
  // Arrange / Act / Assert
  assert.equal(historyExclusionState('refused-at-preparation'), 'ended')
  assert.equal(historyExclusionState('stopped-before-history'), 'ended')
})
