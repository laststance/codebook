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
      path: '/earlier-study/repository%2Finterface%2Ftheme/hash/app/Captured-actions.ts',
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
