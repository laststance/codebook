import assert from 'node:assert/strict'
import { test } from 'node:test'

import type {
  NodeTestHistoryEntry,
  NodeTestHistoryIndex,
  NodeTestLearningMaterialContent,
} from '../nodeTestHistorySchemas'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { describeNodeLearningPart } from '../utils/describeNodeLearningPart'
import { listMissingNodeExplanations } from '../utils/listMissingNodeExplanations'
import { listMissingNodeLearning } from '../utils/listMissingNodeLearning'

const SOURCE_TEXT = 'export const nextRun = schedule(job, 5_000)\n'

/** A sealed stop whose captured source verifies (frame 0 holds the stop's source text, hash and line). */
function verifiedStop(
  sequence: number,
  index: number,
): Extract<NodeTestHistoryEntry, { type: 'stop' }> {
  const hash = sha256(SOURCE_TEXT)
  return {
    type: 'stop',
    sequence,
    elapsedMs: sequence * 10,
    index,
    source: { path: 'src/scheduler.ts', hash, line: 1, column: 1 },
    frame: { name: 'schedule', line: 1, column: 1 },
    facts: [],
    debuggerSnapshot: {
      version: 1,
      frames: [
        {
          name: 'schedule',
          line: 1,
          column: 1,
          source: {
            name: 'src/scheduler.ts',
            text: SOURCE_TEXT,
            hash,
            line: 1,
          },
          scopes: [],
        },
      ],
      variables: [],
      limitations: [],
    },
  }
}

const output = (sequence: number): NodeTestHistoryEntry => ({
  type: 'output',
  sequence,
  elapsedMs: sequence * 10,
  outputSequence: sequence,
  channel: 'stdout',
  text: 'RUN v4.1.11\n',
})

const result = (sequence: number, exitCode: number): NodeTestHistoryEntry => ({
  type: 'result',
  sequence,
  elapsedMs: sequence * 10,
  exitCode,
  signal: null,
  outputTail: '',
})

/** A sealed history of the job scheduler's test: an output, two stops and the result. */
function sealedHistory(
  status: NodeTestHistoryIndex['status'] = 'complete',
  entries: NodeTestHistoryEntry[] = [
    output(1),
    verifiedStop(2, 0),
    verifiedStop(3, 1),
    result(4, 0),
  ],
): Pick<NodeTestHistoryIndex, 'entries' | 'status'> {
  return { status, entries }
}

/** Learning material whose steps cite the given journal sequences (stop or result). */
function materialCiting(
  references: NonNullable<
    NodeTestLearningMaterialContent['steps'][number]['reference']
  >[],
): NodeTestLearningMaterialContent {
  return {
    question: 'When does a delayed job run?',
    title: 'Delayed job',
    summary: 'The scheduler arms a timer, then runs the job.',
    participants: [
      { id: 'test', label: 'Test' },
      { id: 'scheduler', label: 'Scheduler' },
    ],
    steps: references.map((reference, index) => ({
      id: `step-${index + 1}`,
      from: 'test',
      to: 'scheduler',
      label: `Step ${index + 1}`,
      explanation: 'Observed at this stop.',
      evidence: 'observed' as const,
      reference,
    })),
  }
}

// Value: protects=nodeTest.learningMissing and learningCoverage before any material is saved; fails_when=a history without material reads partial or complete, or misses the summary, a stop or the result; why_new=Save and the agent had no structured list of missing explanations (X3, Design 1); seam=none; no_claim=the wording of the parts (describeNodeLearningPart)
test('a sealed test replay without learning material lacks its summary, every stop and the result', () => {
  // Arrange
  const history = sealedHistory()

  // Act
  const missing = listMissingNodeLearning(history, undefined)

  // Assert
  assert.deepEqual(missing.explanations, [
    { kind: 'summary' },
    { kind: 'stop', stop: 1 },
    { kind: 'stop', stop: 2 },
    { kind: 'result' },
  ])
  assert.deepEqual(missing.capture, [])
  assert.equal(missing.coverage, 'none')
})

// Value: protects=coverage that grows with the saved material until nothing is missing; fails_when=a stop the material cites is still listed, one it does not cite is not, or coverage stays partial once every stop and the result are cited; why_new=AC1's none → partial → complete; seam=none; no_claim=the store's reference checks
test('learning material that cites more stops leaves fewer explanations missing until coverage is complete', () => {
  // Arrange
  const history = sealedHistory()
  const firstStopOnly = materialCiting([
    { type: 'stop', sequence: 2, sourceHash: sha256(SOURCE_TEXT) },
  ])
  const everything = materialCiting([
    { type: 'stop', sequence: 2, sourceHash: sha256(SOURCE_TEXT) },
    { type: 'stop', sequence: 3, sourceHash: sha256(SOURCE_TEXT) },
    { type: 'result', sequence: 4 },
  ])

  // Act
  const partly = listMissingNodeLearning(history, firstStopOnly)
  const fully = listMissingNodeLearning(history, everything)

  // Assert
  assert.deepEqual(partly.explanations, [
    { kind: 'stop', stop: 2 },
    { kind: 'result' },
  ])
  assert.equal(partly.coverage, 'partial')
  assert.deepEqual(fully.explanations, [])
  assert.equal(fully.coverage, 'complete')
})

// Value: protects=capture gaps that no explanation can close: a stop without frames, a stop whose captured source was edited, and a history that ended before its result; fails_when=a capture gap is listed as an explanation, or a sealed failing run with its result is said to lack execution evidence; why_new=Save named capture and explanation gaps in one list (DS9, X3); seam=none; no_claim=how the replay shows those stops
test('stops whose recorded state is missing or unverified and a history cut before its result are capture gaps', () => {
  // Arrange
  const withoutFrames = {
    ...verifiedStop(2, 0),
    debuggerSnapshot: {
      ...verifiedStop(2, 0).debuggerSnapshot,
      frames: [],
    },
  }
  const edited = verifiedStop(3, 1)
  const editedFrame = edited.debuggerSnapshot.frames[0]!
  const editedSource = {
    ...edited,
    debuggerSnapshot: {
      ...edited.debuggerSnapshot,
      frames: [
        {
          ...editedFrame,
          source: {
            ...editedFrame.source!,
            text: 'export const nextRun = 0\n',
          },
        },
      ],
    },
  }
  const cutBeforeResult = sealedHistory('partial', [
    output(1),
    withoutFrames,
    editedSource,
  ])
  const failingRun = sealedHistory('partial', [
    output(1),
    verifiedStop(2, 0),
    verifiedStop(3, 1),
    result(4, 1),
  ])

  // Act
  const cut = listMissingNodeLearning(cutBeforeResult, undefined)
  const failing = listMissingNodeLearning(failingRun, undefined)

  // Assert
  assert.deepEqual(cut.capture, [
    { kind: 'stop-state', stop: 1 },
    { kind: 'stop-state', stop: 2 },
    { kind: 'execution' },
  ])
  assert.deepEqual(failing.capture, [])
})

// Value: protects=the coverage the run record caches at the seal from the stop and result sequences alone; fails_when=the needs-only projection disagrees with the history projection; why_new=state() must not read the store (EN2); seam=none; no_claim=when the service updates its cache
test('the explanation check over stop and result sequences agrees with the check over the read history', () => {
  // Arrange
  const material = materialCiting([
    { type: 'stop', sequence: 3, sourceHash: sha256(SOURCE_TEXT) },
  ])

  // Act
  const fromNeeds = listMissingNodeExplanations(
    { stopSequences: [2, 3], resultSequence: 4 },
    material,
  )
  const fromHistory = listMissingNodeLearning(sealedHistory(), material)

  // Assert
  assert.deepEqual(fromNeeds.missing, fromHistory.explanations)
  assert.equal(fromNeeds.coverage, fromHistory.coverage)
})

// Value: protects=the words every surface uses for a missing part; fails_when=a part reads otherwise than the String catalog; why_new=the parts are structured and worded in one place (Design 1, String catalog); seam=none; no_claim=which surface shows them
test('each missing part reads as the String catalog words it', () => {
  // Arrange / Act / Assert
  assert.equal(
    describeNodeLearningPart({ kind: 'summary' }),
    'learning summary and sequence',
  )
  assert.equal(
    describeNodeLearningPart({ kind: 'stop', stop: 2 }),
    'an explanation step for stop 2',
  )
  assert.equal(
    describeNodeLearningPart({ kind: 'result' }),
    'an explanation step for the result',
  )
  assert.equal(
    describeNodeLearningPart({ kind: 'stop-state', stop: 1 }),
    'recorded debugger state of stop 1',
  )
  assert.equal(
    describeNodeLearningPart({ kind: 'execution' }),
    'complete execution evidence',
  )
})
