import assert from 'node:assert/strict'
import { test } from 'node:test'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import type { CodebookDiagnostic } from '../utils/formatCodebookDiagnostic'

import { readerSeams, recordedReaderHarness } from './studyWorkspaceHarness'
import { READER_RESULT_BOUND_MS } from './utils/readerResultBound'
import { saveOtherBrowserStudy } from './utils/saveOtherBrowserStudy'
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
      READER_RESULT_BOUND_MS,
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
      READER_RESULT_BOUND_MS,
    )

    // Assert
    assert.equal(shown(), 4)
  } finally {
    await harness.close()
  }
})

// Value: protects=a browser recording opened while a test replay's open still reads its history leaving only the recording selected: the late open is superseded, so no Study message carries both the recording and the test replay, and the pane keeps the recording's own article lines; fails_when=the pending open commits its history after the recording loaded, so a message carries `recording` and `nodeHistory` and the pane hides the recording's observation and source lines; why_new=F566 (hosted CodeRabbit on #121, to verify); seam=the history store's read, held for the test replay's open; no_claim=the browser replay's own pages
test('a browser recording opened while a test replay is still being read leaves only the recording selected', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  try {
    const store = harness.service.nodeHistoryStore!
    const history = await saveTwoStopNodeHistory(store)
    await harness.reader.action('retry')
    const read = store.read.bind(store)
    let readStarted = (): void => {}
    const started = new Promise<void>((resolve) => {
      readStarted = resolve
    })
    let releaseRead = (): void => {}
    const released = new Promise<void>((resolve) => {
      releaseRead = resolve
    })
    let holdNextRead = true
    store.read = async (studyId) => {
      // Only the test replay open's first read of its history is held.
      if (holdNextRead && studyId === history.studyId) {
        holdNextRead = false
        readStarted()
        await released
      }
      return read(studyId)
    }
    const opening = harness.reader.openLearningReplay(history.studyId)
    await started

    // Act
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    releaseRead()
    await opening
    await harness.controller.settle()

    // Assert
    const view = harness.reader['message']()
    assert.equal(view.nodeHistory, undefined)
    assert.equal(view.contentTab, 'recording')
    assert.notEqual(view.recording, undefined)
    assert.equal(
      harness
        .postedMessages()
        .filter((message) => message.recording && message.nodeHistory).length,
      0,
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a browser recording that replaces a selected test replay also ends the replay's recorded-source slot: its tab closes and its document reads the placeholder, not the last stop; fails_when=the load keeps the slot while the browser replay owns the surfaces, so a pinned or restored slot tab keeps the last stop's bytes; why_new=F184 (nothing tested that a browser recording ends the slot); seam=none; no_claim=the browser replay's own panes
test('a browser recording opened over a selected test replay ends its recorded-source slot', async () => {
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
    const slotTabs = () =>
      harness.groups
        .flatMap((group) => group.tabs)
        .flatMap((tab) => {
          const uri = (tab.input as { uri?: { toString(): string } }).uri
          return uri?.toString().includes('/node-history-slot/')
            ? [uri.toString()]
            : []
        })
    const slot = slotTabs()[0]!

    // Act
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()

    // Assert
    assert.deepEqual(slotTabs(), [])
    assert.match(
      await harness.readCapturedSource(slot),
      /^\/\/ Recorded source · Not recorded at this moment\n/,
    )
  } finally {
    await harness.close()
  }
})

/** The two requests of the second stop besides Next stop that a browser recording's admission can cut off. */
const SECOND_STOP_REQUESTS = [
  { request: 'Select event', type: 'node-history-event' },
  { request: 'Inspect', type: 'node-history-stop' },
] as const

for (const { request, type } of SECOND_STOP_REQUESTS)
  // Value: protects=a browser recording opened during a slow Select event or Inspect leaves no requested moment behind: after the learner reopens the test replay, one Next stop lands on the stop after the shown one; fails_when=the cut-off request's target (the second stop) outlives the admission and the reopened replay's Next stop is refused; why_new=F335 (PR-2 /ship Step 9 pass 3 state-machines): only a cut-off Next stop was tested (F283); seam=the workspace harness's held historical debug presentation, then openRecording and openLearningReplay; no_claim=returning to the same replay without reopening, which the admission does not allow (D20)
  test(`Next stop in a test replay reopened after a browser recording cut off a slow ${request} moves on from the shown stop`, async () => {
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
      const held = harness.holdHistoricalDebugPresentation(true)
      harness.receiveContext({
        type,
        revision: lastView(harness)!.revision,
        studyId: history.studyId,
        sequence: 4,
      })
      await held.started
      await harness.reader.openRecording(harness.studyId)
      await harness.controller.settle()
      held.reject(new Error('Historical debugger presentation was superseded.'))
      await harness.reader.action('return-current')
      await harness.reader.openLearningReplay(history.studyId)
      const shown = () =>
        harness.reader['message']().nodeHistoryPosition?.sequence
      await waitUntil(
        () => shown() === 2,
        'the reopened test replay shows its first stop',
        READER_RESULT_BOUND_MS,
      )

      // Act
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
        READER_RESULT_BOUND_MS,
      )

      // Assert
      assert.equal(shown(), 4)
    } finally {
      await harness.close()
    }
  })

/**
 * Lists the URIs of every captured-source tab that is not a test replay's recorded-source slot, in every group.
 * @param harness - The workspace harness.
 * @returns The URIs of the browser replay's captured-source tabs.
 * @example browserSourceTabs(harness) // => ['codebook-source://…/Captured-actions.ts']
 */
function browserSourceTabs(
  harness: Awaited<ReturnType<typeof recordedReaderHarness>>,
): string[] {
  return harness.groups.flatMap((group) =>
    group.tabs.flatMap((tab) => {
      const uri = (tab.input as { uri?: { toString(): string } }).uri
      const text = uri?.toString() ?? ''
      return text.startsWith('codebook-source:') &&
        !text.includes('/node-history-slot/')
        ? [text]
        : []
    }),
  )
}

// Value: protects=a test replay opened over a browser replay closes the browser replay's captured-source tabs, so no two tabs of one title show different recordings' source, while a learner's own file tab stays; fails_when=the slot's show leaves the retired browser replay's Captured-<file> tab beside the slot, or closes the learner's file; why_new=F459 (the browser replay's captured-source tabs stayed open beside the test replay's slot); seam=the workspace harness's tab model and a restored captured-source tab of the browser replay; no_claim=the native tab strip
test('a test replay opened over a browser replay closes the browser replay’s captured-source tab and keeps the learner’s file tab', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  try {
    const history = await saveTwoStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.action('retry')
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    const browserTab = harness.restoreLeftoverCapturedSource({
      active: false,
      path: `/${harness.studyId}/repository%2Finterface%2Ftheme/hash/app/Captured-actions.ts`,
    })
    harness.openFileWithoutKeyboard('learner-notes.ts', 1)
    const learnerTabs = (): string[] =>
      harness.groups.flatMap((group) =>
        group.tabs.flatMap((tab) => {
          const uri = (tab.input as { uri?: { toString(): string } }).uri
          return uri?.toString().includes('learner-notes.ts')
            ? [uri.toString()]
            : []
        }),
      )
    const learnerBefore = learnerTabs()

    // Act
    await harness.reader['returnCurrentSelection']('learner')
    await harness.reader.openLearningReplay(history.studyId)
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistoryPosition?.sequence === 2 &&
        !lastView(harness)?.loading,
      'the test replay lands on its first stop',
      READER_RESULT_BOUND_MS,
    )
    await waitUntil(
      () =>
        !browserSourceTabs(harness).some((uri) =>
          uri.includes('app/Captured-actions.ts'),
        ),
      'the browser replay’s captured-source tab closes',
      READER_RESULT_BOUND_MS,
    )

    // Assert
    assert.equal(learnerBefore.length, 1)
    assert.deepEqual(learnerTabs(), learnerBefore)
    assert.equal(
      harness.groups
        .flatMap((group) => group.tabs)
        .some((tab) => tab === browserTab),
      false,
    )
    assert.equal(
      harness.groups
        .flatMap((group) => group.tabs)
        .filter((tab) =>
          String((tab.input as { uri?: unknown }).uri).includes(
            '/node-history-slot/',
          ),
        ).length,
      1,
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=only the retired browser replay's own captured-source tabs close, once, when a test replay opens over it: a captured-source tab of another study survives that open, and one the learner opens from the Study reader during the test replay survives Next stop; fails_when=every slot show closes any captured-source tab of the workspace, so a tab of another study or one the learner just opened vanishes at the next move; why_new=F466 (OCR low/medium and CodeRabbit CLI minor of the review of 6bc9eab2..ef03b741: F459's close ran at every slot show and matched any captured source); seam=the workspace harness's tab model, restoreLeftoverCapturedSource for the browser replay's tab, another study's tab and a tab the learner opens later, and the Next stop message; no_claim=the native tab strip
test('a test replay closes only the retired browser replay’s captured-source tab once and keeps another study’s tab and a tab the learner opens later', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  try {
    const history = await saveTwoStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.action('retry')
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    const browserTab = harness.restoreLeftoverCapturedSource({
      active: false,
      path: `/${harness.studyId}/repository%2Finterface%2Ftheme/hash/app/Captured-actions.ts`,
    })
    const otherStudyTab = harness.restoreLeftoverCapturedSource({
      active: false,
      path: '/another-study/repository%2Finterface%2Ftheme/hash/app/Captured-other.ts',
    })
    await harness.reader['returnCurrentSelection']('learner')
    await harness.reader.openLearningReplay(history.studyId)
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistoryPosition?.sequence === 2 &&
        !lastView(harness)?.loading,
      'the test replay lands on its first stop',
      READER_RESULT_BOUND_MS,
    )
    const tabs = (): unknown[] => harness.groups.flatMap((group) => group.tabs)
    await waitUntil(
      () => !tabs().includes(browserTab),
      'the retired browser replay’s captured-source tab closes',
      READER_RESULT_BOUND_MS,
    )
    const learnerTab = harness.restoreLeftoverCapturedSource({
      active: false,
      path: `/${harness.studyId}/repository%2Finterface%2Ftheme/hash/app/Captured-opened-later.ts`,
    })

    // Act
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
      () => harness.reader['message']().nodeHistoryPosition?.sequence === 4,
      'the Next stop lands on the second stop',
      READER_RESULT_BOUND_MS,
    )
    await harness.controller.settle()

    // Assert
    assert.equal(tabs().includes(browserTab), false)
    assert.equal(tabs().includes(otherStudyTab), true)
    assert.equal(tabs().includes(learnerTab), true)
  } finally {
    await harness.close()
  }
})

// Value: protects=a captured-source tab of the same study that the learner opens after leaving a browser replay surviving the test replay that opens next; fails_when=the close at the test replay's first slot show picks every tab named after the retired replay's study, so a tab opened between leaving the browser replay and opening the test replay is closed; why_new=F474 (OCR medium and CodeRabbit CLI minor of the review of ef03b741..ccfe301d: F466's record holds the study id and view address, not the tabs); seam=the workspace harness's tab model, restoreLeftoverCapturedSource for the replay's tab and for the tab opened between, and returnCurrentSelection and openLearningReplay; no_claim=the native tab strip
test('a same-study captured-source tab opened between leaving a browser replay and opening a test replay survives the test replay', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  try {
    const history = await saveTwoStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.action('retry')
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    const browserTab = harness.restoreLeftoverCapturedSource({
      active: false,
      path: `/${harness.studyId}/repository%2Finterface%2Ftheme/hash/app/Captured-actions.ts`,
    })
    await harness.reader['returnCurrentSelection']('learner')
    const openedBetweenTab = harness.restoreLeftoverCapturedSource({
      active: false,
      path: `/${harness.studyId}/repository%2Finterface%2Ftheme/hash/app/Captured-opened-between.ts`,
    })

    // Act
    await harness.reader.openLearningReplay(history.studyId)
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistoryPosition?.sequence === 2 &&
        !lastView(harness)?.loading,
      'the test replay lands on its first stop',
      READER_RESULT_BOUND_MS,
    )
    const tabs = (): unknown[] => harness.groups.flatMap((group) => group.tabs)
    await waitUntil(
      () => !tabs().includes(browserTab),
      'the retired browser replay’s captured-source tab closes',
      READER_RESULT_BOUND_MS,
    )
    await harness.controller.settle()

    // Assert
    assert.equal(tabs().includes(browserTab), false)
    assert.equal(tabs().includes(openedBetweenTab), true)
  } finally {
    await harness.close()
  }
})

// Value: protects=a captured-source tab that the learner closed and reopened at the same address between leaving a browser replay and opening a test replay surviving that test replay (F485); fails_when=the record holds addresses, so the first slot show closes the tab the learner reopened; why_new=F485 (CodeRabbit CLI minor of the review of ccfe301d..c9664ea3: the record held addresses, not tabs); seam=the workspace harness's tab model, restoreLeftoverCapturedSource, closeTabByHand, returnCurrentSelection and openLearningReplay; no_claim=the native tab strip
test('a captured-source tab the learner reopens at the replay’s own address after leaving a browser replay survives the test replay', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  try {
    const history = await saveTwoStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.action('retry')
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    const path = `/${harness.studyId}/repository%2Finterface%2Ftheme/hash/app/Captured-actions.ts`
    const browserTab = harness.restoreLeftoverCapturedSource({
      active: false,
      path,
    })
    await harness.reader['returnCurrentSelection']('learner')
    harness.closeTabByHand(browserTab)
    const reopenedTab = harness.restoreLeftoverCapturedSource({
      active: false,
      path,
    })

    // Act
    await harness.reader.openLearningReplay(history.studyId)
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistoryPosition?.sequence === 2 &&
        !lastView(harness)?.loading,
      'the test replay lands on its first stop',
      READER_RESULT_BOUND_MS,
    )
    await harness.controller.settle()

    // Assert
    const tabs = harness.groups.flatMap((group) => group.tabs)
    assert.equal(tabs.includes(reopenedTab), true)
  } finally {
    await harness.close()
  }
})

// Value: protects=a browser replay's captured-source tab that the editor refused to close at the test replay's first slot show staying on the record, so the next slot show closes it once the editor lets go, and the refusal is told with the slot's history-source row (F484); fails_when=the record is forgotten before the close is answered, so the leftover tab stays beside the test replay for good and nothing is told; why_new=F484 (CodeRabbit CLI minor of the review of ccfe301d..c9664ea3); seam=the workspace harness's restoreLeftoverCapturedSource with refuseClose, acceptLeftoverClose and the Next stop message; no_claim=the wording of the warning
test('a browser replay’s captured-source tab the editor refused to close is told and closed at the next stop', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  try {
    const history = await saveTwoStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.action('retry')
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    const browserTab = harness.restoreLeftoverCapturedSource({
      active: false,
      path: `/${harness.studyId}/repository%2Finterface%2Ftheme/hash/app/Captured-actions.ts`,
      refuseClose: true,
    })
    await harness.reader['returnCurrentSelection']('learner')
    await harness.reader.openLearningReplay(history.studyId)
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistoryPosition?.sequence === 2 &&
        !lastView(harness)?.loading,
      'the test replay lands on its first stop',
      READER_RESULT_BOUND_MS,
    )
    await harness.controller.settle()
    const tabs = (): unknown[] => harness.groups.flatMap((group) => group.tabs)
    const keptAtFirstStop = tabs().includes(browserTab)
    const toldAtFirstStop = harness.reader['errors'].has('history-source')
    harness.acceptLeftoverClose()

    // Act
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
      () => harness.reader['message']().nodeHistoryPosition?.sequence === 4,
      'the Next stop lands on the second stop',
      READER_RESULT_BOUND_MS,
    )
    await waitUntil(
      () => !tabs().includes(browserTab),
      'the retired browser replay’s captured-source tab closes once the editor lets go',
      READER_RESULT_BOUND_MS,
    )

    // Assert
    assert.equal(keptAtFirstStop, true)
    assert.equal(toldAtFirstStop, true)
    assert.equal(tabs().includes(browserTab), false)
  } finally {
    await harness.close()
  }
})

// Value: protects=the record of a left browser replay's tabs ending when the reader closes, so a test replay opened much later has nothing of it to close (F482); fails_when=the record outlives the reader's close; why_new=F482 (CodeRabbit CLI/OCR of the review of ccfe301d..c9664ea3: the record was cleared only at a browser replay's start or the first slot show); seam=the workspace harness's tab model, restoreLeftoverCapturedSource, returnCurrentSelection and the reader's close; no_claim=which tab a later test replay closes (the reader's open closes restored captured-source tabs itself, so only the record is read, through the workspace's private field)
test('closing the reader ends the record of the left browser replay’s tabs', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  try {
    await harness.reader.action('retry')
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    harness.restoreLeftoverCapturedSource({
      active: false,
      path: `/${harness.studyId}/repository%2Finterface%2Ftheme/hash/app/Captured-kept.ts`,
    })
    await harness.reader['returnCurrentSelection']('learner')
    const recordedBefore = harness.reader['retiredBrowserReplayTabs']?.size

    // Act
    await harness.reader.close()

    // Assert
    assert.equal(recordedBefore, 2)
    assert.equal(harness.reader['retiredBrowserReplayTabs'], undefined)
  } finally {
    await harness.close()
  }
})

// Value: protects=a record that a later leave of a browser replay made while the close of an earlier record was held keeping its other tabs when that close finishes, so the next test replay stop still closes them (F493); fails_when=the finished close clears the whole record, so the tab of the newer leave stays beside the test replay for good; why_new=F493 (OCR of the review of c9664ea3..673b2923: F484's fix clears the whole record after its awaited close); seam=the workspace harness's tab model, restoreLeftoverCapturedSource, holdNextTabCloseEffect, returnCurrentSelection, openRecording, and the workspace's private close of the retired record and its private field; no_claim=the deadline that abandons a slot's wait for the close (the close is called directly)
test('a browser replay left while an earlier close is held keeps its tab on the record when that close finishes', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  try {
    await harness.reader.action('retry')
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    const first = harness.restoreLeftoverCapturedSource({
      active: false,
      path: `/${harness.studyId}/repository%2Finterface%2Ftheme/hash/app/Captured-first.ts`,
    })
    await harness.reader['returnCurrentSelection']('learner')
    const held = harness.holdNextTabCloseEffect()
    const closing = harness.reader['closeRetiredBrowserReplaySourceTabs']()
    await held.started
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    const second = harness.restoreLeftoverCapturedSource({
      active: false,
      path: `/${harness.studyId}/repository%2Finterface%2Ftheme/hash/app/Captured-second.ts`,
    })
    await harness.reader['returnCurrentSelection']('learner')

    // Act
    held.release()
    await closing

    // Assert
    const tabs = harness.groups.flatMap((group) => group.tabs)
    assert.equal(tabs.includes(first), false)
    assert.equal(tabs.includes(second), true)
    assert.equal(
      harness.reader['retiredBrowserReplayTabs']?.has(second as never),
      true,
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a browser replay left while an earlier close is held, whose tab Cursor then rebuilds as a new object, still being closed at the next slot show (F498); fails_when=the finished close excludes the newer record's entry by the replaced address of the older record, so the entry is dropped and its open tab stays beside the test replay; why_new=F498 (CodeRabbit CLI minor of the review of 673b2923..7fc7c8fb: F493's fix applies the closed record's address exclusions to the current record); seam=the workspace harness's tab model and Cursor rebuild (rebuildTabObjectsNow), restoreLeftoverCapturedSource, holdNextTabCloseEffect, returnCurrentSelection, openRecording, and the workspace's private close of the retired record; no_claim=the native tab strip
test('a browser replay left during a held close keeps its tab for the next close after Cursor rebuilt the tab objects', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  try {
    await harness.reader.action('retry')
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    const path = `/${harness.studyId}/repository%2Finterface%2Ftheme/hash/app/Captured-actions.ts`
    harness.restoreLeftoverCapturedSource({ active: false, path })
    await harness.reader['returnCurrentSelection']('learner')
    // Cursor builds every tab object anew: the record holds the old one, whose address stands for it.
    harness.rebuildTabObjectsNow()
    const held = harness.holdNextTabCloseResponse()
    const closing = harness.reader['closeRetiredBrowserReplaySourceTabs']()
    await held.started
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    // The learner opens the same captured file again, leaves the replay again, and Cursor rebuilds the tab objects again while the first close's answer is held.
    harness.restoreLeftoverCapturedSource({ active: false, path })
    await harness.reader['returnCurrentSelection']('learner')
    harness.rebuildTabObjectsNow()
    const countOpenAt = () =>
      harness.groups
        .flatMap((group) => group.tabs)
        .filter(
          (tab) => (tab.input as { uri?: { path: string } }).uri?.path === path,
        ).length
    const openBeforeAnswer = countOpenAt()

    // Act
    held.release()
    await closing
    const recordedAfterClose = [
      ...(harness.reader['retiredBrowserReplayTabs']?.values() ?? []),
    ].some((address) => address.endsWith('/Captured-actions.ts'))
    await harness.reader['closeRetiredBrowserReplaySourceTabs']()

    // Assert
    assert.equal(openBeforeAnswer, 1)
    assert.equal(recordedAfterClose, true)
    assert.equal(countOpenAt(), 0)
  } finally {
    await harness.close()
  }
})

// Value: protects=a captured-source tab that the learner closes by hand after Cursor rebuilt the tab objects, and reopens at the same address, surviving the test replay (F494); fails_when=the close of a rebuilt tab matches no entry, so the entry stays and the next slot show closes the tab the learner reopened by its address; why_new=F494 (OCR low, CodeRabbit CLI major, of the review of c9664ea3..673b2923: F485's fallback by address keeps entries nothing can end); seam=the workspace harness's Cursor model (rebuildTabObjectsAtGroupRemoval and rebuildTabObjectsNow), restoreLeftoverCapturedSource, closeTabByHand, returnCurrentSelection and openLearningReplay; no_claim=the native tab strip
test('a captured-source tab the learner closes after Cursor rebuilt the tab objects and reopens at that address survives the test replay', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  try {
    harness.rebuildTabObjectsAtGroupRemoval()
    const history = await saveTwoStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.action('retry')
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    const path = `/${harness.studyId}/repository%2Finterface%2Ftheme/hash/app/Captured-actions.ts`
    const browserTab = harness.restoreLeftoverCapturedSource({
      active: false,
      path,
    })
    await harness.reader['returnCurrentSelection']('learner')
    // Cursor builds every tab object anew; the record holds the old one.
    harness.rebuildTabObjectsNow()
    const rebuiltTab = harness.groups
      .flatMap((group) => group.tabs)
      .find(
        (tab) =>
          tab !== browserTab &&
          (tab.input as { uri?: { path: string } }).uri?.path === path,
      )
    assert.ok(rebuiltTab)
    harness.closeTabByHand(rebuiltTab)
    const reopenedTab = harness.restoreLeftoverCapturedSource({
      active: false,
      path,
    })

    // Act
    await harness.reader.openLearningReplay(history.studyId)
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistoryPosition?.sequence === 2 &&
        !lastView(harness)?.loading,
      'the test replay lands on its first stop',
      READER_RESULT_BOUND_MS,
    )
    await harness.controller.settle()

    // Assert
    const tabs = harness.groups.flatMap((group) => group.tabs)
    assert.equal(tabs.includes(reopenedTab), true)
  } finally {
    await harness.close()
  }
})

// Value: protects=a captured-source tab that the learner moves to another group after leaving a browser replay (the editor reports a close and an open) staying beside the test replay as the learner's own, the rule the README states (F495); fails_when=the moved tab's entry is not forgotten at the close half of the move, so the next slot show closes the tab the learner placed; why_new=F495 (OCR low, to verify, of the review of c9664ea3..673b2923: a move may arrive as a close and an open); seam=the workspace harness's two native groups, restoreLeftoverCapturedSource in each, closeTabByHand for the close half of the move, returnCurrentSelection and openLearningReplay; no_claim=that an editor reports a move as a close and an open (VS Code documents the tab objects as replaced when a tab changes group; no native receipt of Cursor)
test('a captured-source tab the learner moved to another group after leaving a browser replay stays beside the test replay', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  try {
    harness.useNativeLayout({
      orientation: 0,
      groups: [{ size: 490 }, { size: 490 }],
    })
    const history = await saveTwoStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.action('retry')
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    const path = `/${harness.studyId}/repository%2Finterface%2Ftheme/hash/app/Captured-actions.ts`
    const browserTab = harness.restoreLeftoverCapturedSource({
      active: false,
      column: 1,
      path,
    })
    await harness.reader['returnCurrentSelection']('learner')
    // The move: the old tab object closes in its group and a new one opens in the other.
    harness.closeTabByHand(browserTab)
    const movedTab = harness.restoreLeftoverCapturedSource({
      active: false,
      column: 2,
      path,
    })

    // Act
    await harness.reader.openLearningReplay(history.studyId)
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistoryPosition?.sequence === 2 &&
        !lastView(harness)?.loading,
      'the test replay lands on its first stop',
      READER_RESULT_BOUND_MS,
    )
    await harness.controller.settle()

    // Assert
    const tabs = harness.groups.flatMap((group) => group.tabs)
    assert.equal(tabs.includes(movedTab), true)
    assert.equal(harness.groups.length >= 2, true)
  } finally {
    await harness.close()
  }
})

// Value: protects=the record of the browser replay left last being the only record a test replay's first slot show closes from, after an earlier browser replay was left and a newer one loaded (F474); fails_when=the newer replay's start keeps the earlier record while its leave keeps that record instead of replacing it (the two back each other up), so the newer replay's tab is never closed, or a tab the learner opens after the last leave is closed; why_new=F536 (review finding: the clear at a browser replay's start decided no tested outcome), F542 (the earlier tab, closed by hand, is no assertion); seam=the workspace harness's tab model, restoreLeftoverCapturedSource, returnCurrentSelection, openRecording and openLearningReplay; no_claim=that either half alone is observable, or what happens to an earlier replay's tab the learner leaves open (the newer leave records it as its own)
test('only the tabs of the browser replay left last close at a test replay, not an earlier one or one opened after', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  try {
    const history = await saveTwoStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.action('retry')
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    const earlierTab = harness.restoreLeftoverCapturedSource({
      active: false,
      path: `/${harness.studyId}/repository%2Finterface%2Ftheme/hash/app/Captured-earlier.ts`,
    })
    await harness.reader['returnCurrentSelection']('learner')
    // The earlier browser replay's tab is gone before the newer one is left.
    harness.closeTabByHand(earlierTab)
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    const newerTab = harness.restoreLeftoverCapturedSource({
      active: false,
      path: `/${harness.studyId}/repository%2Finterface%2Ftheme/hash/app/Captured-newer.ts`,
    })
    await harness.reader['returnCurrentSelection']('learner')
    const openedAfterTab = harness.restoreLeftoverCapturedSource({
      active: false,
      path: `/${harness.studyId}/repository%2Finterface%2Ftheme/hash/app/Captured-after.ts`,
    })

    // Act
    await harness.reader.openLearningReplay(history.studyId)
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistoryPosition?.sequence === 2 &&
        !lastView(harness)?.loading,
      'the test replay lands on its first stop',
      READER_RESULT_BOUND_MS,
    )
    const tabs = (): unknown[] => harness.groups.flatMap((group) => group.tabs)
    await waitUntil(
      () => !tabs().includes(newerTab),
      'the newer browser replay’s captured-source tab closes',
      READER_RESULT_BOUND_MS,
    )
    await harness.controller.settle()

    // Assert
    assert.equal(tabs().includes(newerTab), false)
    assert.equal(tabs().includes(openedAfterTab), true)
  } finally {
    await harness.close()
  }
})

// Value: protects=Return to Live from a test replay ending the record of the left browser replay's tabs, so a test replay opened afterwards does not close a tab the editor refused to close at the first open (F482); fails_when=the retirement of the selected test replay keeps the record, so the second test replay's first slot show closes the tab the learner has kept; why_new=F537 (review finding: only the reader-close half of F482 was tested); seam=the workspace harness's restoreLeftoverCapturedSource with refuseClose, acceptLeftoverClose, returnCurrentSelection and openLearningReplay; no_claim=the wording of the refusal's warning
test('a browser replay tab that survived a refused close stays beside a test replay opened again after Return to Live', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  try {
    const history = await saveTwoStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.action('retry')
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    const browserTab = harness.restoreLeftoverCapturedSource({
      active: false,
      path: `/${harness.studyId}/repository%2Finterface%2Ftheme/hash/app/Captured-actions.ts`,
      refuseClose: true,
    })
    await harness.reader['returnCurrentSelection']('learner')
    await harness.reader.openLearningReplay(history.studyId)
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistoryPosition?.sequence === 2 &&
        !lastView(harness)?.loading,
      'the test replay lands on its first stop',
      READER_RESULT_BOUND_MS,
    )
    await harness.controller.settle()
    const tabs = (): unknown[] => harness.groups.flatMap((group) => group.tabs)
    const keptAtFirstOpen = tabs().includes(browserTab)
    // The editor lets go of the tab only after the learner returned to live.
    await harness.reader['returnCurrentSelection']('learner')
    harness.acceptLeftoverClose()

    // Act
    await harness.reader.openLearningReplay(history.studyId)
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistoryPosition?.sequence === 2 &&
        !lastView(harness)?.loading,
      'the test replay lands on its first stop again',
      READER_RESULT_BOUND_MS,
    )
    await harness.controller.settle()

    // Assert
    assert.equal(keptAtFirstOpen, true)
    assert.equal(tabs().includes(browserTab), true)
  } finally {
    await harness.close()
  }
})

// Value: protects=a browser replay's captured-source tab that Cursor rebuilt as a new object, matched by its address, and that the editor refused to close at the first slot show staying on the record, so the next slot show closes it once the editor lets go (F484, F498); fails_when=an entry matched by address is dropped whatever the close answered, so the tab stays beside the test replay for good; why_new=F538 (review finding: the refused close was tested with live tab objects only); seam=the workspace harness's Cursor model (rebuildTabObjectsNow), restoreLeftoverCapturedSource, refuseCloseOfTabsShowing, returnCurrentSelection, openLearningReplay and the Next stop message; no_claim=the native tab strip
test('a rebuilt captured-source tab the editor refused to close at the first stop is closed at the next stop', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  try {
    const history = await saveTwoStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.action('retry')
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    const path = `/${harness.studyId}/repository%2Finterface%2Ftheme/hash/app/Captured-actions.ts`
    harness.restoreLeftoverCapturedSource({ active: false, path })
    await harness.reader['returnCurrentSelection']('learner')
    // Cursor builds every tab object anew: the record holds the old one, whose address stands for it.
    harness.rebuildTabObjectsNow()
    const acceptClose = harness.refuseCloseOfTabsShowing('Captured-actions.ts')
    const countOpenAt = (): number =>
      harness.groups
        .flatMap((group) => group.tabs)
        .filter(
          (tab) => (tab.input as { uri?: { path: string } }).uri?.path === path,
        ).length
    await harness.reader.openLearningReplay(history.studyId)
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistoryPosition?.sequence === 2 &&
        !lastView(harness)?.loading,
      'the test replay lands on its first stop',
      READER_RESULT_BOUND_MS,
    )
    await harness.controller.settle()
    const openAtFirstStop = countOpenAt()
    acceptClose()

    // Act
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
      () => harness.reader['message']().nodeHistoryPosition?.sequence === 4,
      'the Next stop lands on the second stop',
      READER_RESULT_BOUND_MS,
    )
    await waitUntil(
      () => countOpenAt() === 0,
      'the rebuilt captured-source tab closes once the editor lets go',
      READER_RESULT_BOUND_MS,
    )

    // Assert
    assert.equal(openAtFirstStop, 1)
    assert.equal(countOpenAt(), 0)
  } finally {
    await harness.close()
  }
})

// Value: protects=after a browser replay, the Application pane's tab names what it shows: a test replay opened afterwards titles it codebook · Application, not the recording's title; fails_when=the tab keeps codebook · Recorded application over the test output (N51-V4); why_new=Cycle 0052 task 4: only the recording and a live lease retitled the pane; seam=recordedReaderHarness, the native panel's title; no_claim=the native tab's look
test('a test replay opened after a browser replay titles the Application pane codebook · Application', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  try {
    const history = await saveTwoStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    const titleDuringRecording = harness
      .nativePanels()
      .find((panel) => panel.kind === 'codebook.scopedBrowser')?.title

    // Act: the one-replay-at-a-time notice is answered by closing the browser replay.
    harness.answerWarningDialogs(async () => 'Close browser replay')
    await harness.reader.action('retry')
    await harness.reader.openLearningReplay(history.studyId)
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistoryPosition?.sequence === 2 &&
        !lastView(harness)?.loading,
      'the test replay lands on its first stop',
      READER_RESULT_BOUND_MS,
    )

    // Assert
    assert.deepEqual(
      {
        titleDuringRecording,
        titleDuringTestReplay: harness
          .nativePanels()
          .find((panel) => panel.kind === 'codebook.scopedBrowser')?.title,
      },
      {
        titleDuringRecording: 'codebook · Recorded application',
        titleDuringTestReplay: 'codebook · Application',
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=Return to Live from a browser replay gives the Application pane its own title back; fails_when=the Live composition's pane keeps codebook · Recorded application (N51-V4); why_new=Cycle 0052 task 4; seam=recordedReaderHarness, the native panel's title; no_claim=the native tab's look
test('Return to Live from a browser replay titles the Application pane codebook · Application', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()

    // Act
    await harness.reader.action('return-current')

    // Assert
    assert.equal(
      harness
        .nativePanels()
        .find((panel) => panel.kind === 'codebook.scopedBrowser')?.title,
      'codebook · Application',
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=Return to Live from a browser replay releases the recorded viewport before the playback controller leaves, so the Application pane never paints the recording's "Loading recorded position…" line while it leaves the replay; fails_when=the controller's leave clears the still-open recorded viewport first (N52 Cursor take 742da665: two frames of "Loading recorded position…" under codebook · Recorded application before the Live pane, Cycle 0052 task 38); why_new=no test read the order of the viewport's clear and its release on a departure; seam=recordedReaderHarness, the recording viewport's clearRecorded and close; no_claim=the webview's paint timing, which N52 observes
test('Return to Live from a browser replay releases the recorded viewport without clearing it to its loading line', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    const viewport = harness.viewportInstances.find(
      (instance) => instance.mode === 'recording',
    )!
    const viewportCalls: string[] = []
    const clearRecorded = viewport.clearRecorded.bind(viewport),
      close = viewport.close.bind(viewport)
    viewport.clearRecorded = (): void => {
      viewportCalls.push('clear')
      clearRecorded()
    }
    viewport.close = (): void => {
      viewportCalls.push('close')
      close()
    }

    // Act
    await harness.reader.action('return-current')

    // Assert
    assert.deepEqual(viewportCalls, ['close'])
  } finally {
    await harness.close()
  }
})

// Value: protects=another saved study chosen in Saved studies during a browser replay retires the shown replay and shows the chosen study in its own composition: the chosen recording plays in the summary composition, with the Study pane closed and the browser family's transport; fails_when=the choice leaves the first recording shown, or brings the Study composition back over a replay (Cycle 0052 task 22, the state cell browser replay × another saved study); why_new=the cell had no test; seam=recordedReaderHarness, a second saved browser study and the bottom panel's history message; no_claim=the chosen study's recording content, which the saved configured study does not carry
test('another saved study chosen during a browser replay retires it and shows the chosen study in its own composition', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  try {
    const other = await saveOtherBrowserStudy(
      await harness.reader.learningStorage(),
    )
    // Retry storage reloads the catalog the reader shows.
    await harness.reader.action('retry')
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()

    // Act
    harness.receivePlaybackPanel({
      type: 'history',
      revision: harness.reader.inspect().view!.revision,
      studyId: other.id,
    })
    await waitUntil(
      () => harness.controller.state().studyId === other.id,
      'the chosen study is opened',
      READER_RESULT_BOUND_MS,
    )
    await harness.controller.settle()

    // Assert
    assert.deepEqual(
      {
        recording: harness.controller.state().studyId,
        studyPane: harness.panelColumn('codebook.studyContext') !== undefined,
        application:
          harness.panelColumn('codebook.scopedBrowser') !== undefined,
        summary: harness.summary.visible,
        family: lastView(harness)?.replayFamily,
      },
      {
        recording: other.id,
        studyPane: false,
        application: true,
        summary: true,
        family: 'browser',
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a browser replay whose open fails is told with the load-failure notification and one Output › Codebook entry, keeps the reader's earlier state and leaves no empty summary composition; fails_when=the failure is not told, the Output entry is missing or repeated (the cell's test found it missing: Cycle 0052 task 59), or the reader stays in a summary composition with no replay (Cycle 0052 task 22, the state cell browser replay × a failed open); why_new=the cell had no test; seam=recordedReaderHarness, the reader's debugger replacement failing the next load, the reader's diagnostics; no_claim=Show details, which the notification's button runs
test('a browser replay whose open fails is told once, keeps the Study composition and leaves no empty summary composition', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  const logged: CodebookDiagnostic[] = []
  harness.reader.diagnostics = {
    log: (entry) => logged.push(entry),
    show: () => undefined,
  }
  try {
    await harness.reader.open()
    // The next recording load fails as a replay debugger that does not start.
    const seams = readerSeams(harness)
    const replace = seams.debuggerReplacement
    seams.debuggerReplacement = async (): Promise<void> => {
      seams.debuggerReplacement = replace
      throw new Error('The historical debugger did not start.')
    }

    // Act
    await harness.reader.openLearningReplay(harness.studyId)

    // Assert
    assert.deepEqual(
      {
        notices: [...harness.errorMessages],
        outputEntries: logged.map((entry) => entry.surface),
        studyPane: harness.panelColumn('codebook.studyContext') !== undefined,
        family: lastView(harness)?.replayFamily,
      },
      {
        notices: [
          'Codebook could not open the learning replay: The historical debugger did not start.',
        ],
        outputEntries: ['open:recording'],
        studyPane: true,
        family: undefined,
      },
    )
  } finally {
    await harness.close()
  }
})
