import assert from 'node:assert/strict'
import { test } from 'node:test'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { recordedReaderHarness } from './studyWorkspaceHarness'
import { READER_RESULT_BOUND_MS } from './utils/readerResultBound'
import { lastView, saveTwoStopNodeHistory } from './utils/twoStopNodeHistory'

// Value: protects=a browser recording that loads while a test replay is selected retires the test replay (D20): the Application pane shows the recording's own pages, not the test replay's output, and the Study message carries no test replay; fails_when=loadPlayback leaves the test replay selected, so capturedAppHtml gives it the pane (the recording's loading page or "Recorded playback unavailable" never shows) and the section stays drawn beside the recording; why_new=F132 and F146: only Saved studies' choice of a browser study retired the test replay, and the recordingActive arm of Focus application's guard decided no tested outcome; seam=none; no_claim=the native placement of the pane (stand-ins: the workspace harness's recorded panels, posted messages and closeTabByHand)
test('a browser recording opened over a selected test replay retires the test replay and shows its own pages in the Application pane', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
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
    const outputBefore = harness
      .nativePanels()
      .find((panel) => panel.kind === 'codebook.scopedBrowser')?.webview.html

    // Act
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    const application = harness
      .nativePanels()
      .find((panel) => panel.kind === 'codebook.scopedBrowser')

    // Assert
    assert.match(outputBefore!, /id="test-output"/)
    assert.equal(lastView(harness)?.nodeHistory, undefined)
    assert.equal(lastView(harness)?.nodeHistorySection, undefined)
    assert.equal(lastView(harness)?.nodeHistoryApplication, undefined)
    assert.equal(lastView(harness)?.contentTab, 'recording')
    assert.doesNotMatch(application!.webview.html, /id="test-output"/)
    assert.doesNotMatch(application!.webview.html, /Recorded test output/)
  } finally {
    await harness.close()
  }
})

// Value: protects=Focus application never builds a closed Application pane again once a browser recording replaced the test replay that was selected; fails_when=the retired test replay is still selected and a closed pane is rebuilt with its output; why_new=F146: the guard's recordingActive arm decided no tested outcome because no test covered a recording over a test replay; seam=none; no_claim=a browser replay's own pane lifecycle (stand-ins: closeTabByHand and the harness's native panel list)
test('Focus application after a browser recording replaced a test replay leaves a closed Application pane closed', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
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
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    const closedPane = harness
      .nativePanels()
      .find((panel) => panel.kind === 'codebook.scopedBrowser')
    harness.closeTabByHand(closedPane!.nativeTab)
    await waitUntil(
      () =>
        !harness
          .nativePanels()
          .some((panel) => panel.kind === 'codebook.scopedBrowser'),
      'the Application pane is closed',
      READER_RESULT_BOUND_MS,
    )

    // Act
    await harness.reader.action('focus-app')

    // Assert
    assert.equal(
      harness
        .nativePanels()
        .some((panel) => panel.kind === 'codebook.scopedBrowser'),
      false,
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a browser recording opened during a slow Next stop leaves no requested moment behind: after the learner reopens the test replay, one Next stop lands on the stop after the shown one; fails_when=the cut-off move's target outlives the admission and the reopened replay's Next stop skips a stop; why_new=F283: the browser recording's admission bumps the selection token; the retirement and the reopen also clear the moment, so this test guards the learner's result, not the admission's own clear; seam=the workspace harness's held historical debug presentation, then openRecording and openLearningReplay; no_claim=returning to the same replay without reopening, which the admission does not allow (it retires the test replay, D20)
test('Next stop in a test replay reopened after a browser recording cut off a slow Next stop moves on from the shown stop', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
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
      2_000,
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
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    held.reject(new Error('Historical debugger presentation was superseded.'))
    // The learner leaves the browser recording, which a test replay cannot open beside, and reopens the replay; the Study pane was replaced by the recording, so the reader's own view is read.
    await harness.reader.action('return-current')
    await harness.reader.openLearningReplay(history.studyId)
    const shown = () =>
      harness.reader['message']().nodeHistoryPosition?.sequence
    await waitUntil(
      () => shown() === 2,
      'the reopened test replay shows its first stop',
      2_000,
    )

    // Act
    // Delivered to the reader as the Study pane's step control would, without the pane the recording replaced.
    void harness.reader['receive'](
      {
        type: 'node-history-step',
        revision: harness.reader['message']().revision,
        studyId: history.studyId,
        direction: 'next',
        unit: 'stop',
      },
      'context',
    )
    await waitUntil(
      () => shown() === 4,
      'the Next stop lands on the second stop',
      2_000,
    )

    // Assert
    assert.equal(shown(), 4)
  } finally {
    await harness.close()
  }
})
