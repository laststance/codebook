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

// Value: protects=a Close during a slow Next gives the requested moment back: the Close bumps the selection token, so the cut-off move's own cleanup no longer does; when the learner brings the replay back and presses Next stop once, it lands on the stop after the shown one, not one further; fails_when=the cut-off move's target (the second stop) outlives the Close and the next Next stop starts from it, so there is no stop after it and the press is refused; why_new=F283: only a matching token cleared the requested moment, and Close (and a browser recording's admission) bumps the token without clearing it; why_changed=F303: the case also read the reader's private requested moment right after the view showed the second stop, before the selection's reader position write let it go, so it failed when that write was slow; the learner's result is the claim; seam=the workspace harness's held historical debug presentation, then Close and Focus application; no_claim=the wording of the failure the cut-off move reports, or when the reader lets its requested moment go
test('Next stop after a Close that cut off a slow Next stop moves on from the shown stop', async () => {
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
    await harness.reader.close()
    held.reject(new Error('Historical debugger presentation was superseded.'))
    await harness.reader.action('focus-app')
    await waitUntil(
      () => lastView(harness)?.nodeHistoryPosition !== undefined,
      'the replay is shown again',
      READER_RESULT_BOUND_MS,
    )
    const shown = lastView(harness)?.nodeHistoryPosition?.sequence

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
      'the Next stop lands on the second stop',
      READER_RESULT_BOUND_MS,
    )

    // Assert
    assert.equal(shown, 2)
    assert.equal(lastView(harness)?.nodeHistoryPosition?.sequence, 4)
  } finally {
    await harness.close()
  }
})

/** The two requests besides Next and Previous that select a moment through the requested moment (F129), each aimed at the second stop (sequence 4): an event's own control in the Study section, and Inspect in native debugger. */
const requestsOfTheSecondStop = [
  {
    request: 'Select event',
    message: (studyId: string, revision: number) => ({
      type: 'node-history-event',
      revision,
      studyId,
      sequence: 4,
    }),
  },
  {
    request: 'Inspect',
    message: (studyId: string, revision: number) => ({
      type: 'node-history-stop',
      revision,
      studyId,
      sequence: 4,
    }),
  },
] as const

for (const { request, message } of requestsOfTheSecondStop) {
  // Value: protects=a Select event or Inspect that is still loading counts as where the replay is going: a Next event pressed meanwhile moves on from the requested stop; fails_when=the request bypasses the requested moment, so the Next event is computed from the stop still shown and lands on the output after the first stop (sequence 3) instead of the result after the second stop (sequence 5); why_new=F310 (PR-2 /ship Step 9 state-machines): only Next and Previous moves were tested through the requested moment; seam=the workspace harness's held historical debug presentation; no_claim=the debugger's own presentation
  test(`Next event pressed while ${request} of the second stop loads moves on from that stop`, async () => {
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
      harness.receiveContext(
        message(history.studyId, lastView(harness)!.revision),
      )
      await held.started

      // Act: Next event arrives while the request's presentation still loads.
      harness.receiveContext({
        type: 'node-history-step',
        revision: lastView(harness)!.revision,
        studyId: history.studyId,
        direction: 'next',
        unit: 'event',
      })
      await waitUntil(
        () => lastView(harness)?.nodeHistoryPosition?.sequence === 5,
        'Next event lands on the result after the second stop',
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

  // Value: protects=a Select event or Inspect that fails gives its requested moment back: the next Next stop is computed from the stop still shown; fails_when=the failed request's target (the second stop) stays the base of the next move, so Next stop is refused as already at the last stop; why_new=F310 (PR-2 /ship Step 9 state-machines): only a failed Next stop was tested; seam=the workspace harness's held historical debug presentation, rejected as failed; no_claim=the wording of the failure
  test(`${request} of the second stop whose presentation failed leaves the next Next stop to move from the shown stop`, async () => {
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
      harness.receiveContext(
        message(history.studyId, lastView(harness)!.revision),
      )
      await held.started
      held.reject(
        new Error('Run and Debug could not load the recorded values.'),
      )
      await waitUntil(
        () => (lastView(harness)?.errors.length ?? 0) > 0,
        'the failed presentation is reported',
        READER_RESULT_BOUND_MS,
      )
      const shown = lastView(harness)?.nodeHistoryPosition?.sequence

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
        'Next stop reaches the second stop',
        READER_RESULT_BOUND_MS,
      )

      // Assert
      assert.equal(shown, 2)
      assert.equal(lastView(harness)?.nodeHistoryPosition?.sequence, 4)
      assert.equal(lastView(harness)?.errors.length, 0)
    } finally {
      await harness.close()
    }
  })

  // Value: protects=a Close during a slow Select event or Inspect gives the requested moment back: when the learner brings the replay back and presses Next stop once, it lands on the stop after the shown one; fails_when=the cut-off request's target (the second stop) outlives the Close and the next Next stop starts from it, so the press is refused; why_new=F310 (PR-2 /ship Step 9 state-machines): only a cut-off Next stop was tested (F283); seam=the workspace harness's held historical debug presentation, then Close and Focus application; no_claim=the wording of the failure the cut-off request reports
  test(`Next stop after a Close that cut off a slow ${request} of the second stop moves on from the shown stop`, async () => {
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
      harness.receiveContext(
        message(history.studyId, lastView(harness)!.revision),
      )
      await held.started
      await harness.reader.close()
      held.reject(new Error('Historical debugger presentation was superseded.'))
      await harness.reader.action('focus-app')
      await waitUntil(
        () => lastView(harness)?.nodeHistoryPosition !== undefined,
        'the replay is shown again',
        READER_RESULT_BOUND_MS,
      )
      const shown = lastView(harness)?.nodeHistoryPosition?.sequence

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
        'Next stop lands on the second stop',
        READER_RESULT_BOUND_MS,
      )

      // Assert
      assert.equal(shown, 2)
      assert.equal(lastView(harness)?.nodeHistoryPosition?.sequence, 4)
    } finally {
      await harness.close()
    }
  })
}
