import assert from 'node:assert/strict'
import { test } from 'node:test'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { workspaceHarness } from './studyWorkspaceHarness'
import { READER_RESULT_BOUND_MS } from './utils/readerResultBound'
import { lastView, saveTwoStopNodeHistory } from './utils/twoStopNodeHistory'

// Value: protects=two quick moves of a test replay add up: while the first move's debugger presentation is still loading, the second move is computed from the moment the first one is going to, not from the moment still shown; fails_when=the second press targets from the shown moment, so Next stop then Next event lands on the output after the first stop (sequence 3) instead of the result after the second stop (sequence 5); why_new=F129: both presses computed their target from selectedNodeHistorySequence, which changes only after the presentation and the position write; seam=the workspace harness's held historical debug presentation; no_claim=Play's own pacing
test('Next stop then Next event pressed while the first move loads moves on from where the first move goes', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await saveTwoStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.action('retry')
    await harness.reader.openLearningReplay(history.studyId)
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistoryPosition?.sequence === 2 &&
        !lastView(harness)?.loading,
      'the test replay lands on its first stop',
      READER_RESULT_BOUND_MS,
    )
    const held = harness.holdHistoricalDebugPresentation(true)
    harness.receiveContext({
      type: 'node-history-step',
      revision: lastView(harness)!.revision,
      studyId: history.studyId,
      direction: 'next',
      unit: 'stop',
    })
    await held.started

    // Act: the second press arrives while the first stop's presentation still loads.
    harness.receiveContext({
      type: 'node-history-step',
      revision: lastView(harness)!.revision,
      studyId: history.studyId,
      direction: 'next',
      unit: 'event',
    })
    await waitUntil(
      () => lastView(harness)?.nodeHistoryPosition?.sequence === 5,
      'the second press lands on the result after the second stop',
      READER_RESULT_BOUND_MS,
    )
    held.reject(new Error('Historical debugger presentation was superseded.'))

    // Assert
    assert.equal(lastView(harness)?.nodeHistoryPosition?.sequence, 5)
    assert.equal(lastView(harness)?.errors.length, 0)
  } finally {
    await harness.close()
  }
})

// Value: protects=a move that is refused or fails gives its requested moment back: after a Next stop whose presentation fails, a Next stop is computed from the moment still shown again; fails_when=the failed move's target stays the base of the next move, so the learner who pressed Next stop again is refused as already at the last stop; why_new=F129: the requested moment must be restored on refusal; seam=the workspace harness's held historical debug presentation, rejected as failed; no_claim=the wording of the failure
test('a Next stop whose presentation failed leaves the next Next stop to move from the shown stop', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await saveTwoStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.action('retry')
    await harness.reader.openLearningReplay(history.studyId)
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistoryPosition?.sequence === 2 &&
        !lastView(harness)?.loading,
      'the test replay lands on its first stop',
      READER_RESULT_BOUND_MS,
    )
    const held = harness.holdHistoricalDebugPresentation(true)
    harness.receiveContext({
      type: 'node-history-step',
      revision: lastView(harness)!.revision,
      studyId: history.studyId,
      direction: 'next',
      unit: 'stop',
    })
    await held.started
    held.reject(new Error('Run and Debug could not load the recorded values.'))
    await waitUntil(
      () => (lastView(harness)?.errors.length ?? 0) > 0,
      'the failed presentation is reported',
      READER_RESULT_BOUND_MS,
    )

    // Act
    harness.receiveContext({
      type: 'node-history-step',
      revision: lastView(harness)!.revision,
      studyId: history.studyId,
      direction: 'next',
      unit: 'stop',
    })
    await waitUntil(
      () => lastView(harness)?.nodeHistoryPosition?.sequence === 4,
      'the second Next stop reaches the second stop',
      READER_RESULT_BOUND_MS,
    )

    // Assert
    assert.equal(lastView(harness)?.nodeHistoryPosition?.sequence, 4)
    assert.equal(lastView(harness)?.errors.length, 0)
  } finally {
    await harness.close()
  }
})
