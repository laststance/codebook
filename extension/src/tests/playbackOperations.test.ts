import assert from 'node:assert/strict'
import { test } from 'node:test'

import { PlaybackController, type PlaybackData } from '../playbackController'
import type { RecordingContext, RecordingIndex } from '../recordingSchemas'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { buildRecordingContext } from '../utils/buildRecordingContext'

import {
  createOperationsStudy,
  OPERATION_TIMES_MS,
} from './utils/createOperationsStudy'

/**
 * Builds a playback controller over the recorded data of a four-operation run, with frames before and between the operations.
 * @param how - Which saved run to replay.
 * @returns The controller with its study id and the means to open and seek it.
 * @example const player = operationsPlayer(); player.open()
 */
function operationsPlayer(how: 'complete' | 'failed-at-3' = 'complete') {
  const study = createOperationsStudy(how)
  const context: RecordingContext = buildRecordingContext(study, [], 1)
  const index: RecordingIndex = {
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
        sourceHash: sha256('source'),
      },
      createdAt: study.createdAt,
      startedMs: 0,
      clock: 'runtime-receipt-ms',
      sampleIntervalMs: 50,
      owner: {
        pid: process.pid,
        hostname: 'test',
        sessionId: study.instanceId,
      },
    },
    entries: [200, 1200, 3000].map((elapsedMs, position) => ({
      type: 'frame' as const,
      sequence: position + 1,
      elapsedMs,
      hash: sha256(`frame-${elapsedMs}`),
      byteLength: 10,
      width: 1,
      height: 1,
      kind: 'stream' as const,
    })),
    status: 'finalized',
    endMs: 7000,
    lastVerifiedMs: 7000,
  }
  const data: PlaybackData = {
    index,
    context,
    contextHash: sha256(JSON.stringify(context)),
  }
  const controller = new PlaybackController({
    load: async () => data,
    frame: async (_study, hash) => Buffer.from(hash),
    present: async () => {},
    invalidate: () => {},
    changed() {},
    save: async () => {},
    now: () => 0,
    manualTicks: true,
  })
  const send = (action: 'open' | 'seek', positionMs = 0) => {
    const expectedRevision = controller.state().revision
    return action === 'seek'
      ? controller.command({
          studyId: study.id,
          action,
          expectedRevision,
          positionMs,
        })
      : controller.command({ studyId: study.id, action, expectedRevision })
  }
  return { controller, send }
}

// protects=an opened version 3 replay reports one mark per operation with its state and sent time for the Study page's operation row; fails_when=the state omits the marks, or a stopped run's marks read done; no_claim=the page's drawing (Reader DOM check)
test('an opened four-operation replay reports four marks and a partial run reports done, done, failed, pending', async () => {
  // Arrange
  const complete = operationsPlayer()
  const partial = operationsPlayer('failed-at-3')
  // Act
  complete.send('open')
  await complete.controller.settle()
  partial.send('open')
  await partial.controller.settle()
  // Assert
  assert.deepEqual(
    complete.controller
      .state()
      .operations.map((mark) => [mark.index, mark.state, mark.atMs]),
    [
      [1, 'done', 1000],
      [2, 'done', 1500],
      [3, 'done', 3500],
      [4, 'done', 3800],
    ],
  )
  assert.deepEqual(
    partial.controller.state().operations.map((mark) => mark.state),
    ['done', 'done', 'failed', 'pending'],
  )
  await complete.controller.dispose()
  await partial.controller.dispose()
})

// protects=seeking to each operation's mark presents exactly the moment it was sent, and seeking back to the first returns the same presented state; fails_when=a seek lands on another time or the second visit differs; no_claim=the frames' pixels
test('seeking to each operation mark presents its moment and returns to the same state on the way back', async () => {
  // Arrange
  const player = operationsPlayer()
  player.send('open')
  await player.controller.settle()
  const marks = player.controller.state().operations
  const visit = async (positionMs: number) => {
    player.send('seek', positionMs)
    await player.controller.settle()
    const state = player.controller.state()
    return {
      presentedMs: state.presentedMs,
      frame: state.frame?.sequence,
      observationId: state.observationId,
    }
  }
  // Act
  const firstVisits = []
  for (const mark of marks) firstVisits.push(await visit(mark.atMs!))
  const backToFirst = await visit(marks[0]!.atMs!)
  // Assert
  assert.deepEqual(
    firstVisits.map((state) => state.presentedMs),
    [...OPERATION_TIMES_MS],
  )
  assert.deepEqual(
    firstVisits.map((state) => state.frame),
    [1, 2, 3, 3],
  )
  assert.deepEqual(backToFirst, firstVisits[0])
  await player.controller.dispose()
})
