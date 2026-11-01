import assert from 'node:assert/strict'
import { test } from 'node:test'

import { nodeHistoryLearningMaterialContentSchema } from '../nodeHistoryLearningSchemas'
import { nodeTestHistoryReaderPositionSchema } from '../nodeTestHistorySchemas'
import { sha256 } from '../runtimeSupport/utils/sha256'

const STUDY_ID =
  '00000000-0000-4000-8000-000000000000_11111111-1111-4111-8111-111111111111'

/** A material citing one entry, to ask whether the shared schema lets that entry's sequence through. */
function materialCiting(reference: Record<string, unknown>): unknown {
  return {
    question: 'Why does Save fail?',
    title: 'Saving a note',
    summary: 'The popup asks the worker to save.',
    participants: [{ id: 'extension', label: 'Extension' }],
    steps: [
      {
        id: 'cited',
        from: 'extension',
        to: 'extension',
        label: 'Cited step',
        explanation: 'Explains the cited entry.',
        evidence: 'observed',
        reference,
      },
    ],
  }
}

// protects=learning material citing a stop or the result late in a long Extension replay (sequence 13,100) passes the shared MCP and Study input schema; fails_when=the shared citation schema caps at the node-server limit of 10,000 and refuses a later extension entry; no_claim=the per-profile check that the cited entry exists
test('learning material may cite an Extension stop and the result up to sequence 13,100', () => {
  // Arrange
  const stop = materialCiting({
    type: 'stop',
    sequence: 13_100,
    sourceHash: sha256('source'),
    context: 'page',
  })
  const result = materialCiting({ type: 'result', sequence: 13_100 })

  // Act
  const stopParsed = nodeHistoryLearningMaterialContentSchema.safeParse(stop)
  const resultParsed =
    nodeHistoryLearningMaterialContentSchema.safeParse(result)

  // Assert
  assert.equal(stopParsed.success, true)
  assert.equal(resultParsed.success, true)
})

// protects=a citation past the largest history of any profile (13,101) is still refused by the shared schema; fails_when=the shared bound is lifted without limit; no_claim=the wording of the refusal
test('learning material citing sequence 13,101 is refused', () => {
  // Arrange
  const result = materialCiting({ type: 'result', sequence: 13_101 })

  // Act
  const parsed = nodeHistoryLearningMaterialContentSchema.safeParse(result)

  // Assert
  assert.equal(parsed.success, false)
})

// protects=a playhead moved past sequence 10,000 of an Extension replay is saved and reopens there; fails_when=the shared reader-position schema caps at the node-test limit of 10,000 and refuses to save the position; no_claim=that the sequence exists in the history (the store checks it)
test('the saved reader position accepts sequence 13,100 and refuses 13,101', () => {
  // Arrange
  const position = (sequence: number): unknown => ({
    version: 1,
    studyId: STUDY_ID,
    sequence,
    updatedAt: '2026-11-01T00:00:00.000Z',
  })

  // Act
  const atLimit = nodeTestHistoryReaderPositionSchema.safeParse(
    position(13_100),
  )
  const pastLimit = nodeTestHistoryReaderPositionSchema.safeParse(
    position(13_101),
  )

  // Assert
  assert.equal(atLimit.success, true)
  assert.equal(pastLimit.success, false)
})
