import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import type { ConfiguredStudy } from '../configuredStudySchemas'
import { LearningLibrary } from '../learningLibrary'
import type { RecordingIndex } from '../recordingSchemas'
import type { RecordedEvent } from '../runtimeSupport/evidence'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { assertOperationRecordsAdvance } from '../utils/assertOperationRecordsAdvance'
import { assertStudyCheckpoint } from '../utils/assertStudyCheckpoint'
import { buildRecordingContext } from '../utils/buildRecordingContext'
import { decodeConfiguredStudy } from '../utils/decodeConfiguredStudy'
import { projectLearningSummary } from '../utils/projectLearningSummary'
import { projectRecording } from '../utils/projectRecording'
import { projectReplayOperations } from '../utils/projectReplayOperations'
import { projectSavedOperations } from '../utils/projectSavedOperations'
import { validateRecordingContext } from '../utils/validateRecordingContext'

import { createConfiguredStudy } from './utils/createConfiguredStudy'
import {
  createOperationsStudy,
  OPERATION_TIMES_MS,
} from './utils/createOperationsStudy'

/** Reads the `operations` records of a decoded study as `<index>:<state>` words. @example statesOf(study) // => ['1:done', '2:done'] */
function statesOf(study: ConfiguredStudy): string[] {
  return (study.operations ?? []).map(
    (record) => `${record.index}:${record.state}`,
  )
}

/**
 * Builds the recording journal of {@link createOperationsStudy} with stream frames at fixed times.
 * @param study - The study the recording belongs to.
 * @param frameTimesMs - When a frame was received.
 * @returns A finalized recording index of version 3 (the cross-runtime recording version).
 * @example recordingOf(study, [1200]).entries.length // => 1
 */
function recordingOf(
  study: ConfiguredStudy,
  frameTimesMs: readonly number[],
): RecordingIndex {
  return {
    header: {
      version: 3,
      workspaceKey: study.workspaceKey,
      studyId: study.id,
      instanceId: study.instanceId,
      runId: study.runId,
      runtimeId: study.runId,
      profile: study.profile,
      sourceBuild: {
        revision: 'test',
        dirty: false,
        sourceHash: sha256('test source'),
      },
      createdAt: study.createdAt,
      startedMs: 0,
      clock: 'runtime-receipt-ms',
      sampleIntervalMs: 50,
      owner: { pid: 1, hostname: 'test', sessionId: study.instanceId },
    },
    entries: frameTimesMs.map((elapsedMs, position) => ({
      type: 'frame' as const,
      sequence: position + 1,
      elapsedMs,
      hash: sha256(`frame ${elapsedMs}`),
      byteLength: 10,
      width: 10,
      height: 10,
      kind: 'stream' as const,
    })),
    status: 'finalized',
    endMs: 7000,
    lastVerifiedMs: 7000,
  }
}

// protects=a finished four-operation run is saved and decodes with every operation, its sent time and its final effect; fails_when=the decoder drops operations[] or the time, or demands the single-operation shape; no_claim=a real run produced it (the fixture stands in for one)
test('a saved four-operation study decodes with each operation, its sent time and its final effect', () => {
  // Arrange
  const study = createOperationsStudy()
  // Act
  const decoded = decodeConfiguredStudy(study, study.workspaceKey)
  // Assert
  assert.equal(decoded.version, 7)
  assert.deepEqual(statesOf(decoded), ['1:done', '2:done', '3:done', '4:done'])
  assert.deepEqual(
    decoded.operations?.map((record) => record.atMs),
    [1000, 1500, 3500, 3800],
  )
  assert.equal(decoded.operations?.[3]?.effect, 'after-verified')
})

// protects=a stopped run is saved as a partial replay whose operations read done, done, failed, not run; fails_when=a failed or not-run operation makes the study undecodable, or the failed operation reads done; no_claim=the run that stopped (a fixture stands in)
test('a run that stopped at operation 3 is saved as a partial replay with the states done, done, failed, not-run', () => {
  // Arrange
  const study = createOperationsStudy('failed-at-3')
  // Act
  const decoded = decodeConfiguredStudy(study, study.workspaceKey)
  // Assert
  assert.deepEqual(statesOf(decoded), [
    '1:done',
    '2:done',
    '3:failed',
    '4:not-run',
  ])
  assert.equal(decoded.operations?.[3]?.atMs, undefined)
  assert.equal(decoded.finalOutcome, 'not-demonstrated')
})

// protects=a replay saved by 0.2.70.0 (format 6, one operation) still opens, with no operation row to draw; fails_when=the new format breaks the older shape, or gives it operations; no_claim=the bytes of a real 0.2.70.0 file (a fixture in its shape stands in)
test('a study saved by 0.2.70.0 with one operation opens and has no operations', () => {
  // Arrange
  const study: ConfiguredStudy = { ...createConfiguredStudy(), version: 6 }
  // Act
  const decoded = decodeConfiguredStudy(study, study.workspaceKey)
  const context = validateRecordingContext(
    buildRecordingContext(decoded, [], 1),
    study.workspaceKey,
  )
  // Assert
  assert.equal(decoded.operations, undefined)
  assert.deepEqual(
    projectReplayOperations(context, { startMs: 0, endMs: 7000 }),
    [],
  )
})

// protects=a version 3 study is only valid in its own format and a version 1 study never carries operations; fails_when=a version 3 configuration is accepted as format 6, or a version 1 study accepts operation records; no_claim=nothing about the files on disk
test('a version 3 study saved as format 6 and a version 1 study with operations are both refused', () => {
  // Arrange
  const operationsAsOldFormat = {
    ...createOperationsStudy(),
    version: 6 as const,
  }
  const oldWithOperations = {
    ...createConfiguredStudy(),
    version: 6 as const,
    operations: createOperationsStudy().operations,
  }
  // Act
  const decodeOperationsAsOld = (): unknown =>
    decodeConfiguredStudy(
      operationsAsOldFormat,
      operationsAsOldFormat.workspaceKey,
    )
  const decodeOldWithOperations = (): unknown =>
    decodeConfiguredStudy(oldWithOperations, oldWithOperations.workspaceKey)
  // Assert
  assert.throws(decodeOperationsAsOld, {
    message: 'Configured archive and intent versions disagree.',
  })
  assert.throws(decodeOldWithOperations, {
    message: 'Only a version 3 study keeps operations.',
  })
})

// protects=operation records that contradict the run (a later operation finished after an earlier one failed, a pause before its input, a done operation whose pauses were not continued, a result verified before every operation) are refused; fails_when=any of the four is accepted; no_claim=every other tampering
test('operation records that contradict the run are refused with the reason', () => {
  // Arrange
  const complete = createOperationsStudy()
  const failedThenDone: ConfiguredStudy = {
    ...complete,
    operations: complete.operations!.map((record) =>
      record.index === 2 ? { ...record, state: 'failed' as const } : record,
    ),
  }
  const pauseBeforeInput: ConfiguredStudy = {
    ...complete,
    observations: complete.observations.map((observation, position) =>
      position === 0 ? { ...observation, elapsedMs: 1200 } : observation,
    ),
  }
  const failed = createOperationsStudy('failed-at-3')
  const doneWithoutPauses: ConfiguredStudy = {
    ...failed,
    operations: failed.operations!.map((record) =>
      record.index === 3
        ? { ...record, state: 'done' as const, effect: 'dispatched' as const }
        : record.index === 4
          ? {
              ...record,
              state: 'done' as const,
              atMs: 3800,
              effect: 'dispatched' as const,
            }
          : record,
    ),
  }
  const verifiedEarly: ConfiguredStudy = {
    ...failed,
    operation: { ...failed.operation!, afterVerified: true },
  }
  // Act
  const messages = [
    failedThenDone,
    pauseBeforeInput,
    doneWithoutPauses,
    verifiedEarly,
  ].map((study) => {
    try {
      decodeConfiguredStudy(study, study.workspaceKey)
      return 'accepted'
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
  })
  // Assert
  assert.deepEqual(messages, [
    'Operation 3 progressed although an earlier operation did not finish.',
    'Configured observation precedes the input of its operation.',
    'Operation 4 is done without its declared pauses continued.',
    'Configured result is verified before every operation.',
  ])
})

// protects=operation records only move forward between checkpoints and a finished operation stays as it ended; fails_when=a failed operation can be rewritten as done, a sent time moved, or a not-run operation reached ahead of its turn is accepted as a step back; no_claim=the checkpoint writer's lock
test('a later checkpoint may advance operation records but never rewrite a finished one or a sent time', () => {
  // Arrange
  const failed = createOperationsStudy('failed-at-3').operations!
  const complete = createOperationsStudy().operations!
  const sending = complete.map((record, position) =>
    position === 1
      ? {
          ...record,
          state: 'sending' as const,
          ack: 'pending' as const,
          valueCheck: 'pending' as const,
          effect: 'pending' as const,
        }
      : position > 1
        ? {
            ...record,
            state: 'not-run' as const,
            atMs: undefined,
            ack: 'pending' as const,
            effect: 'pending' as const,
          }
        : record,
  )
  const movedTime = complete.map((record) =>
    record.index === 1 ? { ...record, atMs: 1001 } : record,
  )
  // Act
  const forward = (): void => assertOperationRecordsAdvance(sending, complete)
  const failedToDone = (): void =>
    assertOperationRecordsAdvance(failed, complete)
  const timeRewritten = (): void =>
    assertOperationRecordsAdvance(complete, movedTime)
  // Assert
  assert.doesNotThrow(forward)
  assert.throws(failedToDone, {
    message: 'Operation 3 moved backwards or changed after it was accepted.',
  })
  assert.throws(timeRewritten, {
    message: 'Operation 1 moved backwards or changed after it was accepted.',
  })
})

// protects=a checkpoint of a saved study cannot erase or step back operation records; fails_when=assertStudyCheckpoint stops comparing operations; no_claim=the library's file writes
test('a checkpoint that steps an operation back from its accepted effect is refused', () => {
  // Arrange
  const prior = createOperationsStudy()
  const next: ConfiguredStudy = {
    ...prior,
    operations: prior.operations!.map((record) =>
      record.index === 4
        ? { ...record, effect: 'dispatched' as const }
        : record,
    ),
  }
  // Act
  const checkpoint = (): void => assertStudyCheckpoint(prior, next)
  // Assert
  assert.throws(checkpoint, {
    message: 'Operation 4 moved backwards or changed after it was accepted.',
  })
})

// protects=the run's operation progress and the journal's dispatch receipts become the study's records with the time on the recording clock, an unsent operation without one; fails_when=the time comes from anything but the dispatch receipt, or an unsent operation gets a time; no_claim=the real journal (a hand-written one stands in)
test('the saved operation records take their time from the dispatch receipt of the journal', () => {
  // Arrange
  const journal = (
    sequence: number,
    type: string,
    elapsedMs: number,
    operationIndex: number,
  ): RecordedEvent => ({
    sequence,
    type,
    elapsedMs,
    wallTime: '2026-09-20T00:00:00.000Z',
    detail: { operationIndex },
  })
  const events = [
    journal(1, 'input.dispatched', 250.5, 1),
    journal(2, 'input.dispatched', 900, 2),
    journal(3, 'input.accepted', 100, 3),
  ]
  const records = createOperationsStudy().operations!.map((record) => ({
    index: record.index,
    kind: record.kind,
    title: record.title,
    state: record.index < 3 ? ('done' as const) : ('not-run' as const),
    ack: record.ack,
    valueCheck: record.valueCheck,
    effect: record.effect,
  }))
  // Act
  const saved = projectSavedOperations(records, events)
  // Assert
  assert.deepEqual(
    saved.map((record) => record.atMs),
    [250.5, 900, undefined, undefined],
  )
})

// protects=the library writes a four-operation study to its own format 7 file and reopens it with every mark; fails_when=the study is written as format 6, or the reopened records differ; no_claim=another window's lock
test('a four-operation study is saved as .study.v7.json and reopens with four operations', async (context) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-operations-study-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const study = createOperationsStudy()
  const library = new LearningLibrary(directory, study.workspaceKey)
  // Act
  await library.saveStudy(study)
  const reopened = await library.readStudy(study.id)
  const listed = await library.list()
  // Assert
  const archive: { version: number } = JSON.parse(
    await readFile(join(directory, `${study.id}.study.v7.json`), 'utf8'),
  )
  assert.equal(archive.version, 7)
  assert.deepEqual(reopened.operations, study.operations)
  assert.deepEqual(
    listed.map((entry) => entry.format),
    ['v7'],
  )
})

// protects=an older Codebook (reads up to 7 here, as 0.2.70.0 reads up to 6) lists a study of a format one above, refuses to open it with its reason and keeps its bytes; fails_when=the listing skips the file, the read ends in a schema error, or the file changes; no_claim=the 0.2.70.0 binary itself (this code stands in for it with a format one above)
test('a study saved in a format one above the readable one is listed, refused with its reason and kept untouched', async (context) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-future-study-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const study = createOperationsStudy()
  const library = new LearningLibrary(directory, study.workspaceKey)
  const futurePath = join(directory, `${study.id}.study.v8.json`)
  const futureBytes = JSON.stringify({ ...study, version: 8 })
  await writeFile(futurePath, futureBytes)
  // Act
  const listed = await library.list()
  const read = library.readStudy(study.id)
  // Assert
  assert.equal(listed.length, 1)
  assert.equal(listed[0]?.format, 'newer')
  assert.equal(
    listed[0]?.reason,
    'This study was saved in format 8 by a newer Codebook; this Codebook reads formats up to 7. Update the extension to open it. The study is kept as it is.',
  )
  await assert.rejects(read, {
    message:
      'This study was saved in format 8 by a newer Codebook; this Codebook reads formats up to 7. Update the extension to open it. The study is kept as it is.',
  })
  assert.equal(await readFile(futurePath, 'utf8'), futureBytes)
})

// protects=a replay whose operation record carries a field this Codebook does not know is refused with a reason when decoded or opened, and listing it does not throw; fails_when=the unknown field is dropped silently, the decode crashes with a non-error, or the listing rejects; no_claim=which future version wrote the field
test('a saved study whose operation carries an unknown future field is refused with a reason and does not break the listing', async (context) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-unknown-field-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const study = createOperationsStudy()
  const library = new LearningLibrary(directory, study.workspaceKey)
  await library.saveStudy(study)
  const path = join(directory, `${study.id}.study.v7.json`)
  const archive = JSON.parse(await readFile(path, 'utf8'))
  archive.operations[1].futureField = 'x'
  await writeFile(path, JSON.stringify(archive))
  // Act
  const decode = (): unknown =>
    decodeConfiguredStudy(archive, study.workspaceKey)
  const listed = await library.list()
  const read = library.readStudy(study.id)
  // Assert
  assert.throws(decode, /futureField|Unrecognized key/)
  assert.equal(listed.length, 1)
  assert.notEqual(listed[0]?.outcome, 'validated')
  assert.ok((listed[0]?.reason ?? '').length > 0)
  await assert.rejects(read)
})

// protects=the recording context lists the operations with their sent time and their final effect, and a context that disagrees with its study is refused; fails_when=the outcome is the dispatch receipt rather than the final effect, or a tampered context validates; no_claim=the recording journal
test('the recording context lists four operations with time and final effect, and a context that differs from its study is refused', () => {
  // Arrange
  const study = createOperationsStudy()
  const decoded = decodeConfiguredStudy(study, study.workspaceKey)
  // Act
  const context = validateRecordingContext(
    buildRecordingContext(decoded, [], 1),
    study.workspaceKey,
  )
  const tampered = {
    ...buildRecordingContext(decoded, [], 1),
    operations: [
      {
        index: 1,
        kind: 'choose',
        title: 'Customer',
        atMs: 1,
        outcome: 'dispatched',
      },
    ],
  }
  // Assert
  assert.deepEqual('operations' in context ? context.operations : undefined, [
    {
      index: 1,
      kind: 'choose',
      title: 'Customer',
      atMs: 1000,
      outcome: 'dispatched',
    },
    {
      index: 2,
      kind: 'text',
      title: 'Amount',
      atMs: 1500,
      outcome: 'dispatched',
    },
    {
      index: 3,
      kind: 'click',
      title: 'Pending',
      atMs: 3500,
      outcome: 'dispatched',
    },
    {
      index: 4,
      kind: 'click',
      title: 'Create Invoice',
      atMs: 3800,
      outcome: 'after-verified',
    },
  ])
  assert.throws(() => validateRecordingContext(tampered, study.workspaceKey), {
    message: 'Recording context operations differ from the study.',
  })
})

// protects=the replay row has one mark per operation with done, failed or pending drawn from the saved state, the times clamped into the recording, and none for a replay without operations; fails_when=a stopped run's marks read done, a time outside the recording is kept, or a v1 replay gets marks; no_claim=how the Study page draws a mark (Reader DOM check)
test('the replay projects one mark per operation with its state and a time inside the recording', () => {
  // Arrange
  const study = createOperationsStudy('failed-at-3')
  const context = validateRecordingContext(
    buildRecordingContext(
      decodeConfiguredStudy(study, study.workspaceKey),
      [],
      1,
    ),
    study.workspaceKey,
  )
  // Act
  const marks = projectReplayOperations(context, { startMs: 1200, endMs: 3000 })
  // Assert
  assert.deepEqual(
    marks.map((mark) => [mark.index, mark.total, mark.state, mark.atMs]),
    [
      [1, 4, 'done', 1200],
      [2, 4, 'done', 1500],
      [3, 4, 'failed', 3000],
      [4, 4, 'pending', undefined],
    ],
  )
})

// protects=seeking to each operation's moment shows the last frame at or before it and the stop that begins exactly there, and seeking away and back returns the same frame, stop and values; fails_when=the moment shows a later frame, misses a pause starting at the moment, or a repeated seek differs; no_claim=the player's presentation of the frame (workspace tests)
test('seeking to each of four operations and back returns the identical frame, stop and values', () => {
  // Arrange
  const base = createOperationsStudy()
  // The first stop begins exactly when operation 2 was sent.
  const study: ConfiguredStudy = {
    ...base,
    observations: base.observations.map((observation, position) =>
      position === 0
        ? { ...observation, elapsedMs: OPERATION_TIMES_MS[1] }
        : observation,
    ),
  }
  const decoded = decodeConfiguredStudy(study, study.workspaceKey)
  const context = validateRecordingContext(
    buildRecordingContext(decoded, [], 1),
    study.workspaceKey,
  )
  const index = recordingOf(study, [1200, 1400, 3000])
  const stateAt = (positionMs: number) => {
    const projection = projectRecording(index, context, positionMs)
    return {
      frame: projection.frame?.sequence,
      stop: projection.observation?.id,
      values: projection.observation?.values,
      missing: projection.missing,
    }
  }
  // Act
  const firstPass = OPERATION_TIMES_MS.map(stateAt)
  const secondPass = OPERATION_TIMES_MS.map(stateAt)
  // Assert
  assert.deepEqual(
    firstPass.map((state) => [state.frame, state.stop]),
    [
      [undefined, undefined],
      [2, 'browser-session:1'],
      [3, undefined],
      [3, undefined],
    ],
  )
  assert.equal(
    firstPass[0]?.missing,
    'No application frame was received at this position.',
  )
  assert.deepEqual(secondPass, firstPass)
})

// protects=a learning step names an operation by number and the Study page links it to that mark only when the replay has that operation; fails_when=a number with no operation becomes a link, or a valid one is dropped; no_claim=the rendered link (Reader DOM check)
test('a learning step links to its operation mark and a number with no operation stays unlinked', () => {
  // Arrange
  const study = createOperationsStudy()
  const withSummary: ConfiguredStudy = {
    ...study,
    learningSummary: {
      explanationId: study.observations[0]!.interpretations[0]!.id,
      createdAt: study.observations[0]!.interpretations[0]!.createdAt,
      content: {
        question: 'How is an invoice created?',
        title: 'Create invoice',
        summary: 'The form posts.',
        participants: [{ id: 'ui', label: 'UI' }],
        steps: [
          {
            id: 'amount',
            from: 'ui',
            to: 'ui',
            label: 'Amount',
            explanation: 'The amount is typed.',
            evidence: 'unknown',
            operationIndex: 2,
          },
          {
            id: 'ghost',
            from: 'ui',
            to: 'ui',
            label: 'Ghost',
            explanation: 'No such operation.',
            evidence: 'unknown',
            operationIndex: 9,
          },
          {
            id: 'plain',
            from: 'ui',
            to: 'ui',
            label: 'Plain',
            explanation: 'No operation named.',
            evidence: 'unknown',
          },
        ],
      },
    },
  }
  // Act
  const projected = projectLearningSummary(withSummary, [])
  // Assert
  assert.deepEqual(projected?.operationLinks, [
    { stepId: 'amount', operationIndex: 2 },
  ])
})
