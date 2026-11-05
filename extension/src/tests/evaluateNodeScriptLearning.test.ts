import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { NodeScriptHistoryEntry } from '../nodeScriptHistorySchemas'
import { evaluateNodeScriptLearning } from '../utils/evaluateNodeScriptLearning'

const entries = [
  { type: 'output', sequence: 1 },
  { type: 'stop', sequence: 2, declaredStopIndex: 0, hit: 1 },
  { type: 'stop', sequence: 3, declaredStopIndex: 0, hit: 2 },
  { type: 'stop', sequence: 4, declaredStopIndex: 1, hit: 1 },
  { type: 'end', sequence: 5 },
] as unknown as NodeScriptHistoryEntry[]

// Value: protects=a script's material is complete only when it cites one hit of every reached stop and the end, and what is still owed is listed in journal order; fails_when=output is demanded, the end is not demanded, a second hit of a stop is demanded, or nothing cited reads partial; why_new=only the service-level save tests touch the verdict, never its none/partial/complete edges; seam=none; no_claim=the material schema that produces the cited sequences
test('script learning is none before any citation, partial while the end or a stop is uncited and complete with one hit per stop and the end', () => {
  // Arrange
  const verdicts = [
    undefined,
    new Set<number>(),
    new Set([3, 4]),
    new Set([2, 4]),
    new Set([3, 4, 5]),
  ]

  // Act
  const results = verdicts.map((cited) =>
    evaluateNodeScriptLearning(entries, cited),
  )

  // Assert
  assert.deepEqual(
    results.map((result) => result.coverage),
    ['none', 'none', 'partial', 'partial', 'complete'],
  )
  assert.deepEqual(
    results[0]!.missing.map((part) => part.sequence),
    [2, 4, 5],
  )
  assert.deepEqual(
    results[2]!.missing.map((part) => part.type),
    ['end'],
  )
  assert.deepEqual(results[4]!.missing, [])
})
