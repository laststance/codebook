import assert from 'node:assert/strict'
import { test } from 'node:test'

import { describeMinutes } from '../utils/describeMinutes'

// Value: protects=the bound every LLM Wiki run names to the learner and the agent; fails_when=a bound of one minute reads "1 minutes", a generation's reads other than "55 minutes", or a duration between whole minutes is cut instead of rounded; no_claim=the sentences around it (their own tests); seam=none
test('a run’s bound is named in whole minutes, singular for one minute', () => {
  // Act
  const named = [3_300_000, 900_000, 60_000, 89_000, 0].map(describeMinutes)

  // Assert
  assert.deepEqual(named, [
    '55 minutes',
    '15 minutes',
    '1 minute',
    '1 minute',
    '0 minutes',
  ])
})
