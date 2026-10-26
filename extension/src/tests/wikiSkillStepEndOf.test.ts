import assert from 'node:assert/strict'
import { test } from 'node:test'

import { wikiSkillStepEndOf } from '../utils/wikiSkillStepEndOf'

// Value: protects=Cycle 0056 pass 3 M3-D, the end a skill step is worded by; fails_when=a bound during the wait for an earlier step is worded as a plain bound, a bound during the step's own work as the earlier-step sentence, or a Stop as a bound; no_claim=the sentences (describeWikiSkillStepEnd tests) and when the step aborts (host tests); seam=none
test('a skill step ends as the earlier step still running only when its bound fired during the wait for that step', () => {
  // Arrange
  const cases = [
    { reason: 'bound', isWaiting: true },
    { reason: 'bound', isWaiting: false },
    { reason: 'stopped', isWaiting: true },
    { reason: 'stopped', isWaiting: false },
    { reason: new Error('other'), isWaiting: false },
  ]

  // Act
  const ends = cases.map(({ reason, isWaiting }) =>
    wikiSkillStepEndOf(reason, isWaiting),
  )

  // Assert
  assert.deepEqual(ends, [
    'earlier-step-running',
    'bound',
    'stopped',
    'stopped',
    'stopped',
  ])
})
