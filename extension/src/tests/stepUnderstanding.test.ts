import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { StepUnderstandingDecision } from '../stepUnderstandingSchemas'
import {
  applyStepDecision,
  hashSteps,
  normalizeStepDecisions,
  serializeStepUnderstanding,
  stepHash,
  stepUnderstandingState,
} from '../utils/stepUnderstanding'

const studyId =
  '11111111-1111-1111-1111-111111111111_22222222-2222-2222-2222-222222222222'
const HASH_A1 = 'a'.repeat(64)
const HASH_A2 = 'b'.repeat(64)
const HASH_B1 = 'c'.repeat(64)

function decision(
  stepId: string,
  stepHash: string,
  understood: boolean,
  at: string,
): StepUnderstandingDecision {
  return { stepId, stepHash, understood, at }
}

const step = {
  id: 'submit',
  from: 'ui',
  to: 'api',
  label: 'Submit',
  explanation: 'The form posts.',
  evidence: 'observed',
}

// Value: protects=a changed step being noticed; fails_when=editing any field of one step leaves its hash, or editing another step changes it; no_claim=the hash algorithm's strength
test('changes a step hash when any field of that step changes and keeps it when another step changes', () => {
  // Arrange
  const other = { ...step, id: 'other' }
  const original = stepHash(step)

  // Act
  const hashes = [
    stepHash({ ...step, label: 'Send' }),
    stepHash({ ...step, explanation: 'The form posts twice.' }),
    stepHash({ ...step, evidence: 'unknown' }),
    stepHash({ ...step, operationIndex: 2 }),
  ]
  const withOtherChanged = hashSteps([step, { ...other, label: 'Changed' }])
  const withOtherOriginal = hashSteps([step, other])

  // Assert
  assert.match(original, /^[a-f0-9]{64}$/)
  assert.equal(new Set([original, ...hashes]).size, 5)
  assert.equal(withOtherChanged[0]!.stepHash, withOtherOriginal[0]!.stepHash)
  assert.notEqual(withOtherChanged[1]!.stepHash, withOtherOriginal[1]!.stepHash)
})

// Value: protects=an unmarked replay showing no understood step; fails_when=a missing file reports a step understood or in review; no_claim=the file system
test('reports every step unchecked and without review when no file exists', () => {
  // Arrange
  const steps = [{ stepId: 'a', stepHash: HASH_A1 }]

  // Act
  const states = stepUnderstandingState(undefined, steps)

  // Assert
  assert.deepEqual(states, [{ understood: false, reviewNeeded: false }])
})

// Value: protects=the learner's mark and unmark on the step's current content; fails_when=a checked decision shows unchecked, or an unchecked one shows checked or in review; no_claim=none beyond protects
test('reads a checked and an unchecked decision of the current hash', () => {
  // Arrange
  const steps = [
    { stepId: 'a', stepHash: HASH_A1 },
    { stepId: 'b', stepHash: HASH_B1 },
  ]
  const file = {
    decisions: [
      decision('a', HASH_A1, true, '2026-11-10T01:00:00.000Z'),
      decision('b', HASH_B1, false, '2026-11-10T02:00:00.000Z'),
    ],
  }

  // Act
  const states = stepUnderstandingState(file, steps)

  // Assert
  assert.deepEqual(states, [
    { understood: true, at: '2026-11-10T01:00:00.000Z', reviewNeeded: false },
    { understood: false, at: '2026-11-10T02:00:00.000Z', reviewNeeded: false },
  ])
})

// Value: protects=review of a step that changed after it was marked; fails_when=a changed step carries the old check forward or review names an older time than the latest checked version; no_claim=how the pane words it
test('flags review with the latest checked time of other versions of the step', () => {
  // Arrange
  const steps = [{ stepId: 'a', stepHash: HASH_A2 }]
  const file = {
    decisions: [
      decision('a', 'd'.repeat(64), true, '2026-11-10T01:00:00.000Z'),
      decision('a', 'e'.repeat(64), true, '2026-11-10T03:00:00.000Z'),
      decision('a', 'f'.repeat(64), false, '2026-11-10T05:00:00.000Z'),
    ],
  }

  // Act
  const [state] = stepUnderstandingState(file, steps)

  // Assert
  assert.deepEqual(state, {
    understood: false,
    reviewNeeded: true,
    reviewAt: '2026-11-10T03:00:00.000Z',
  })
})

// Value: protects=the learner's decision on the new version ending the review; fails_when=review stays after the learner unchecked the current version; no_claim=none beyond protects
test('ends review when the current version has an unchecked decision after a checked older one', () => {
  // Arrange
  const steps = [{ stepId: 'a', stepHash: HASH_A2 }]
  const file = {
    decisions: [
      decision('a', HASH_A1, true, '2026-11-10T01:00:00.000Z'),
      decision('a', HASH_A2, false, '2026-11-10T02:00:00.000Z'),
    ],
  }

  // Act
  const [state] = stepUnderstandingState(file, steps)

  // Assert
  assert.equal(state?.reviewNeeded, false)
  assert.equal(state?.understood, false)
})

// Value: protects=decisions of removed steps being kept but not shown; fails_when=a removed step appears in the states or is dropped by a write; no_claim=the cap
test('shows no state for a removed step and keeps its decision on the next write', () => {
  // Arrange
  const removed = decision('gone', HASH_A1, true, '2026-11-10T01:00:00.000Z')
  const steps = [{ stepId: 'a', stepHash: HASH_B1 }]
  const change = decision('a', HASH_B1, true, '2026-11-10T02:00:00.000Z')

  // Act
  const states = stepUnderstandingState({ decisions: [removed] }, steps)
  const written = applyStepDecision([removed], change, steps)

  // Assert
  assert.equal(states.length, 1)
  assert.deepEqual(written, [removed, change])
})

// Value: protects=duplicate pairs resolving to the learner's latest choice; fails_when=an older entry wins, or the earlier of two equal-time entries wins; no_claim=none beyond protects
test('keeps the latest decision of a duplicate pair and the later entry on equal times', () => {
  // Arrange
  const decisions = [
    decision('a', HASH_A1, true, '2026-11-10T03:00:00.000Z'),
    decision('a', HASH_A1, false, '2026-11-10T01:00:00.000Z'),
    decision('b', HASH_B1, true, '2026-11-10T02:00:00.000Z'),
    decision('b', HASH_B1, false, '2026-11-10T02:00:00.000Z'),
  ]

  // Act
  const normalized = normalizeStepDecisions(decisions)

  // Assert
  assert.deepEqual(normalized, [decisions[0], decisions[3]])
})

// Value: protects=a write replacing only its own pair; fails_when=another step's or version's decision is lost or the same pair is duplicated; no_claim=the lock around the write
test('replaces every entry of the written pair and keeps the others', () => {
  // Arrange
  const keepA2 = decision('a', HASH_A2, true, '2026-11-10T01:00:00.000Z')
  const keepB = decision('b', HASH_B1, true, '2026-11-10T01:30:00.000Z')
  const old = decision('a', HASH_A1, true, '2026-11-10T00:00:00.000Z')
  const change = decision('a', HASH_A1, false, '2026-11-10T02:00:00.000Z')
  const steps = [
    { stepId: 'a', stepHash: HASH_A1 },
    { stepId: 'b', stepHash: HASH_B1 },
  ]

  // Act
  const written = applyStepDecision([old, keepA2, keepB], change, steps)

  // Assert
  assert.deepEqual(written, [keepA2, keepB, change])
})

// Value: protects=the 1000-decision cap dropping what the learner can no longer see before what they can; fails_when=a current step's decision is dropped while a removed or changed one is kept, the oldest overall is not dropped when all are current, or equal times drop the later entry; no_claim=file size
test('drops a removed or changed decision first at the cap, then the oldest overall, earlier entry first on equal times', () => {
  // Arrange
  const current = [
    { stepId: 's1', stepHash: HASH_A1 },
    { stepId: 's2', stepHash: HASH_B1 },
    { stepId: 's3', stepHash: HASH_A2 },
  ]
  const oldestCurrent = decision(
    's1',
    HASH_A1,
    true,
    '2026-11-10T00:00:00.000Z',
  )
  const newerChanged = decision(
    's2',
    'd'.repeat(64),
    true,
    '2026-11-10T05:00:00.000Z',
  )
  const middleCurrent = decision(
    's2',
    HASH_B1,
    true,
    '2026-11-10T01:00:00.000Z',
  )
  const change = decision('s3', HASH_A2, true, '2026-11-10T09:00:00.000Z')

  // Act
  const dropsStaleFirst = applyStepDecision(
    [oldestCurrent, newerChanged, middleCurrent],
    change,
    current,
    3,
  )
  const dropsOldestWhenAllCurrent = applyStepDecision(
    [middleCurrent, oldestCurrent],
    change,
    current,
    2,
  )
  const tieA = decision('s1', HASH_A1, true, '2026-11-10T02:00:00.000Z')
  const tieB = decision('s2', HASH_B1, true, '2026-11-10T02:00:00.000Z')
  const dropsEarlierOnTie = applyStepDecision([tieA, tieB], change, current, 2)

  // Assert
  assert.deepEqual(dropsStaleFirst, [oldestCurrent, middleCurrent, change])
  assert.deepEqual(dropsOldestWhenAllCurrent, [middleCurrent, change])
  assert.deepEqual(dropsEarlierOnTie, [tieB, change])
})

// Value: protects=a file over its byte limit never replacing the previous bytes; fails_when=the serializer returns text past the limit, or accepts a file the schema rejects; no_claim=the atomic write
test('refuses to serialize a file over the given byte limit and returns it under the limit', () => {
  // Arrange
  const file = {
    version: 1 as const,
    studyId,
    decisions: [decision('a', HASH_A1, true, '2026-11-10T01:00:00.000Z')],
  }

  // Act
  const bytes = serializeStepUnderstanding(file, 4096)

  // Assert
  assert.equal(JSON.parse(bytes).decisions.length, 1)
  assert.throws(
    () => serializeStepUnderstanding(file, 50),
    /Storage limit exceeded \(50 bytes\)/,
  )
  assert.throws(() =>
    serializeStepUnderstanding({ ...file, studyId: 'not-a-study' }),
  )
})

// Value: protects=a hand-edited file with mixed fractional seconds still resolving a duplicate pair to the later time; fails_when=the text order of the times (Z after a dot) picks the older decision; no_claim=times without a valid ISO form
test('keeps the later decision of a duplicate pair whose times differ in fractional precision', () => {
  // Arrange
  const later = decision('a', HASH_A1, true, '2026-11-10T01:00:03.500Z')
  const earlier = decision('a', HASH_A1, false, '2026-11-10T01:00:03Z')

  // Act
  const normalized = normalizeStepDecisions([later, earlier])

  // Assert
  assert.deepEqual(normalized, [later])
})

// Value: protects=review naming the latest checked time when times differ in fractional precision; fails_when=reviewAt is the text-greatest time instead of the latest one; no_claim=how the pane words it
test('names the latest checked time of other versions when times differ in fractional precision', () => {
  // Arrange
  const steps = [{ stepId: 'a', stepHash: HASH_A2 }]
  const file = {
    decisions: [
      decision('a', 'd'.repeat(64), true, '2026-11-10T01:00:03.500Z'),
      decision('a', 'e'.repeat(64), true, '2026-11-10T01:00:03Z'),
    ],
  }

  // Act
  const [state] = stepUnderstandingState(file, steps)

  // Assert
  assert.deepEqual(state, {
    understood: false,
    reviewNeeded: true,
    reviewAt: '2026-11-10T01:00:03.500Z',
  })
})

// Value: protects=the cap dropping the truly oldest decision when times differ in fractional precision; fails_when=text order drops the newer decision; no_claim=file size
test('drops the truly oldest decision at the cap when times differ in fractional precision', () => {
  // Arrange
  const current = [
    { stepId: 's1', stepHash: HASH_A1 },
    { stepId: 's2', stepHash: HASH_B1 },
    { stepId: 's3', stepHash: HASH_A2 },
  ]
  const newer = decision('s1', HASH_A1, true, '2026-11-10T01:00:03.500Z')
  const older = decision('s2', HASH_B1, true, '2026-11-10T01:00:03Z')
  const change = decision('s3', HASH_A2, true, '2026-11-10T02:00:00.000Z')

  // Act
  const next = applyStepDecision([newer, older], change, current, 2)

  // Assert
  assert.deepEqual(next, [newer, change])
})

// Value: protects=review needing a checked decision of another version; fails_when=unchecked decisions of other versions flag review; no_claim=none beyond protects
test('does not flag review when other versions of the step have only unchecked decisions', () => {
  // Arrange
  const steps = [{ stepId: 'a', stepHash: HASH_A2 }]
  const file = {
    decisions: [
      decision('a', 'd'.repeat(64), false, '2026-11-10T01:00:00.000Z'),
      decision('a', 'e'.repeat(64), false, '2026-11-10T02:00:00.000Z'),
    ],
  }

  // Act
  const states = stepUnderstandingState(file, steps)

  // Assert
  assert.deepEqual(states, [{ understood: false, reviewNeeded: false }])
})

// Value: protects=the Study pane reading the learner's latest choice from a file with duplicate pairs; fails_when=the state reads the first stored entry instead of the latest; no_claim=how the file got duplicates
test('reads the latest decision of a duplicate pair when computing step state', () => {
  // Arrange
  const steps = [{ stepId: 'a', stepHash: HASH_A1 }]
  const file = {
    decisions: [
      decision('a', HASH_A1, false, '2026-11-10T01:00:00.000Z'),
      decision('a', HASH_A1, true, '2026-11-10T03:00:00.000Z'),
    ],
  }

  // Act
  const states = stepUnderstandingState(file, steps)

  // Assert
  assert.deepEqual(states, [
    { understood: true, at: '2026-11-10T03:00:00.000Z', reviewNeeded: false },
  ])
})
