import assert from 'node:assert/strict'
import { test } from 'node:test'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { recordedReaderHarness } from './studyWorkspaceHarness'
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
      2_000,
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
      2_000,
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
      2_000,
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
