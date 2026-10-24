import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import {
  readerSeams,
  recordedReaderHarness,
  workspaceHarness,
} from './studyWorkspaceHarness'
import { createConfiguredStudy } from './utils/createConfiguredStudy'
import { READER_RESULT_BOUND_MS } from './utils/readerResultBound'
import { lastView, saveTwoStopNodeHistory } from './utils/twoStopNodeHistory'

type Harness = Awaited<ReturnType<typeof workspaceHarness>>

/**
 * Opens a saved two-stop test replay and waits until it shows its first stop.
 * @param harness - The workspace harness.
 * @param studyId - The replay's study id.
 * @example await openAtFirstStop(harness, history.studyId)
 */
async function openAtFirstStop(
  harness: Harness,
  studyId: string,
): Promise<void> {
  await harness.reader.openLearningReplay(studyId)
  await waitUntil(
    () =>
      lastView(harness)?.nodeHistory?.header.studyId === studyId &&
      lastView(harness)?.nodeHistoryPosition?.sequence === 2 &&
      !lastView(harness)?.loading,
    'the test replay lands on its first stop',
    READER_RESULT_BOUND_MS,
  )
}

/**
 * Reads the Application pane's document and the last recorded time it was told.
 * @param harness - The workspace harness.
 * @returns The pane's html and the time line of the last view posted into it.
 * @example applicationReading(harness).time // => 'Recorded test output · 0.20 s'
 */
function applicationReading(harness: Harness) {
  const html =
    harness
      .nativePanels()
      .find((panel) => panel.kind === 'codebook.scopedBrowser')?.webview.html ??
    ''
  return {
    html,
    time:
      harness.applicationOutputs().at(-1)?.view.time ??
      /<p id="test-output-time" class="status">([^<]*)<\/p>/.exec(html)?.[1],
  }
}

// Value: protects=a background render (Retry storage / refresh) that fails while a test replay is selected leaves the replay's Application output, the moment and the Study section as they were; fails_when=the render's failure clears the shown replay, posts a loading view into the Application pane or moves the selected moment; why_new=F139: only a render that settles was tested; seam=the learning library's list, made to throw once; no_claim=the wording of the failure
test('a background render that fails keeps the selected test replay and its Application output', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await saveTwoStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.action('retry')
    await openAtFirstStop(harness, history.studyId)
    const library = harness.reader['library']!
    const list = library.list.bind(library)
    library.list = (): ReturnType<typeof list> =>
      Promise.reject(new Error('The library could not be listed.'))
    const outputsBefore = harness.applicationOutputs().length

    // Act
    await harness.reader.action('retry').catch(() => undefined)
    library.list = list

    // Assert
    const reading = applicationReading(harness)
    assert.equal(
      lastView(harness)?.nodeHistory?.header.studyId,
      history.studyId,
    )
    assert.equal(lastView(harness)?.nodeHistoryPosition?.sequence, 2)
    assert.equal(reading.time, 'Recorded test output · 0.20 s')
    assert.match(
      reading.html,
      /<p id="test-output-time" class="status">Recorded test output · 0\.20 s<\/p>/,
    )
    assert.doesNotMatch(reading.html, /Loading recorded test output…<\/p>/)
    assert.ok(
      harness
        .applicationOutputs()
        .slice(outputsBefore)
        .every(
          (update) =>
            update.view.placeholder !== 'Loading recorded test output…',
        ),
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a background render that is still running when the learner moves to another event of the selected test replay does not take the pane back: once it ends, the Application pane and the Study section show the later moment; fails_when=the render's end writes the moment it started with, or a loading view; why_new=F139: only a render that settles on its own was tested; seam=the learning library's list, held until the move is shown; no_claim=the order of two renders (the workspace tests of the library); why_changed=a move leaves the earlier moment for 300 ms before it commits (F385, F387), so the wait also requires the position not to be pending
test('a background render overtaken by a move keeps the later moment in the Application pane', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await saveTwoStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.action('retry')
    await openAtFirstStop(harness, history.studyId)
    const library = harness.reader['library']!
    const list = library.list.bind(library)
    let releaseList = (): void => {}
    const listHeld = new Promise<void>((resolve) => {
      releaseList = resolve
    })
    let listEntered = (): void => {}
    const listStarted = new Promise<void>((resolve) => {
      listEntered = resolve
    })
    library.list = async (): ReturnType<typeof list> => {
      listEntered()
      await listHeld
      return list()
    }
    const rendering = harness.reader.action('retry')
    await listStarted

    // Act: the learner moves to the second stop while the render waits, then the render ends.
    harness.receiveContext({
      type: 'node-history-step',
      revision: lastView(harness)!.revision,
      studyId: history.studyId,
      direction: 'next',
      unit: 'stop',
    })
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistoryPosition?.sequence === 4 &&
        !lastView(harness)?.nodeHistoryPosition?.pending,
      'Next stop reaches the second stop',
      READER_RESULT_BOUND_MS,
    )
    releaseList()
    await rendering
    library.list = list

    // Assert
    assert.equal(lastView(harness)?.nodeHistoryPosition?.sequence, 4)
    assert.equal(
      applicationReading(harness).time,
      'Recorded test output · 0.30 s',
    )
    assert.doesNotMatch(
      applicationReading(harness).html,
      /Loading recorded test output…<\/p>/,
    )
    assert.match(
      applicationReading(harness).html,
      /<p id="test-output-time" class="status">Recorded test output · 0\.30 s<\/p>/,
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a background render that settles while another test replay opens does not end that open's loading line early or leave a placeholder: the opening replay's document still reads its loading line after the render, and the pane ends on the opened replay's first moment; fails_when=the render's end reads as the open's end, so the pane says "No test output recorded up to this moment." for the replay that is still opening, or loses its loading line before the open ends; why_new=F147: only the first open of a replay was tested; why_changed=F280: another replay's loading line is written into its own document (F150, D22), never posted into the shown one, so the case reads the document while the open is held; seam=the workspace harness's held historical debug presentation; no_claim=the Study pane's loading line
test('a render that settles while another test replay opens ends on that replay’s first moment', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const store = harness.service.nodeHistoryStore!
    const shown = await saveTwoStopNodeHistory(store)
    const other = await saveTwoStopNodeHistory(store)
    await harness.reader.action('retry')
    await openAtFirstStop(harness, shown.studyId)
    const held = harness.holdHistoricalDebugPresentation(true)
    const outputsBefore = harness.applicationOutputs().length
    const opening = harness.reader.openLearningReplay(other.studyId)
    await held.started

    // Act
    await harness.reader.action('retry')
    const afterRender = {
      html: applicationReading(harness).html,
      placeholder: harness.applicationOutputs().at(-1)?.view.placeholder,
    }
    held.release()
    await opening
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistory?.header.studyId === other.studyId &&
        !lastView(harness)?.loading,
      'the other test replay is shown',
      READER_RESULT_BOUND_MS,
    )

    // Assert
    const posted = harness.applicationOutputs().slice(outputsBefore)
    assert.match(
      afterRender.html,
      /Loading recorded test output…<\/p>/,
      'the opening replay still tells its loading line after the render',
    )
    assert.notEqual(
      afterRender.placeholder,
      'No test output recorded up to this moment.',
    )
    assert.ok(
      posted.every(
        (update) =>
          update.view.placeholder !==
          'No test output recorded up to this moment.',
      ),
    )
    assert.equal(
      applicationReading(harness).time,
      'Recorded test output · 0.20 s',
    )
    assert.equal(lastView(harness)?.nodeHistoryPosition?.sequence, 2)
  } finally {
    await harness.close()
  }
})

// Value: protects=opening the test replay that is already shown keeps its Application document, tells the loading line while it opens and ends on the saved moment, not the first one; fails_when=the document is written again (the learner's scroll and selection are lost), the loading line never shows, or the replay returns to its first stop; why_new=F147: the shown replay opened again had no test; seam=the workspace harness's held historical debug presentation; no_claim=the learner's scroll position in a real webview
test('opening the test replay that is shown keeps its document, shows loading and returns to the saved moment', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await saveTwoStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.action('retry')
    await openAtFirstStop(harness, history.studyId)
    harness.receiveContext({
      type: 'node-history-step',
      revision: lastView(harness)!.revision,
      studyId: history.studyId,
      direction: 'next',
      unit: 'stop',
    })
    await waitUntil(
      async () =>
        lastView(harness)?.nodeHistoryPosition?.sequence === 4 &&
        (await harness.service.nodeHistoryStore!.readReaderPosition(
          history.studyId,
        )) === 4,
      'the second stop is shown and saved',
      READER_RESULT_BOUND_MS,
    )
    const documentBefore = applicationReading(harness).html
    const held = harness.holdHistoricalDebugPresentation(true)

    // Act
    const opening = harness.reader.openLearningReplay(history.studyId)
    await held.started
    const whileOpening = {
      html: applicationReading(harness).html,
      placeholder: harness.applicationOutputs().at(-1)?.view.placeholder,
    }
    held.release()
    await opening
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistoryPosition?.sequence === 4 &&
        !lastView(harness)?.loading,
      'the replay returns to its saved moment',
      READER_RESULT_BOUND_MS,
    )

    // Assert
    assert.equal(whileOpening.html, documentBefore)
    assert.equal(whileOpening.placeholder, 'Loading recorded test output…')
    assert.equal(applicationReading(harness).html, documentBefore)
    assert.equal(
      applicationReading(harness).time,
      'Recorded test output · 0.30 s',
    )
  } finally {
    await harness.close()
  }
})

/**
 * Makes the reader's reads of saved browser studies wait for the test, fail, or pass through, so a browser study chosen while a test replay is selected can be pending, failed or overtaken.
 * @param harness - The workspace harness.
 * @returns The gate: `hold()` makes the next read wait, `release()` lets it go on, `failNext(error)` makes the next read fail, `started()` resolves when a read begins, and `restore()` puts the reader's own read back.
 * @example const gate = gateArchiveReads(harness); gate.hold()
 */
function gateArchiveReads(harness: Harness) {
  const reader = harness.reader as unknown as {
    readSavedArchive: (id: string) => Promise<unknown>
  }
  const read = reader.readSavedArchive.bind(reader)
  let waiting: Promise<void> | undefined
  let release = (): void => {}
  let entered = (): void => {}
  let started = new Promise<void>((resolve) => {
    entered = resolve
  })
  let failure: Error | undefined
  let finishedReads = 0
  reader.readSavedArchive = async (id: string): Promise<unknown> => {
    entered()
    if (failure) {
      const error = failure
      failure = undefined
      throw error
    }
    await waiting
    try {
      return await read(id)
    } finally {
      finishedReads++
    }
  }
  return {
    hold(): void {
      waiting = new Promise<void>((resolve) => {
        release = resolve
      })
      started = new Promise<void>((resolve) => {
        entered = resolve
      })
    },
    release: (): void => release(),
    finishedReads: (): number => finishedReads,
    started: (): Promise<void> => started,
    failNext(error: Error): void {
      failure = error
    },
    restore(): void {
      reader.readSavedArchive = read
    },
  }
}

/**
 * Opens a test replay in a harness that also holds a saved browser study.
 * @param harness - The recorded-reader harness.
 * @returns The replay's header.
 * @example const history = await openReplayBesideBrowserStudy(harness)
 */
async function openReplayBesideBrowserStudy(
  harness: Awaited<ReturnType<typeof recordedReaderHarness>>,
) {
  const history = await saveTwoStopNodeHistory(
    harness.service.nodeHistoryStore!,
  )
  await harness.reader.action('retry')
  await openAtFirstStop(harness, history.studyId)
  return history
}

// Value: protects=a saved browser study chosen in Saved studies while a test replay is selected retires the replay once the study is read and shows the study in the Study composition with the Learning summary withdrawn, and the replay stays selected, with its Application output, while the read is pending; fails_when=the replay is retired before the study is read (a failed read then leaves nothing), stays selected beside the study, or the summary keeps the replay's document with controls that answer nothing; why_new=F125: a browser study opened or pending while a test replay is selected had no test; the composition and summary it leaves, Cycle 0051 /ship review (state-machines cell, Codex structured pass 2); seam=the reader's read of a saved study, held until released; no_claim=the browser study's own display
test('a browser study chosen over a selected test replay replaces it only once it is read', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  try {
    const history = await openReplayBesideBrowserStudy(harness)
    const familyBefore = lastView(harness)?.replayFamily
    const gate = gateArchiveReads(harness)
    gate.hold()

    // Act
    harness.receiveContext({
      type: 'history',
      revision: lastView(harness)!.revision,
      studyId: harness.studyId,
    })
    await gate.started()
    const whilePending = {
      replay: lastView(harness)?.nodeHistory?.header.studyId,
      time: applicationReading(harness).time,
    }
    gate.release()
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistory === undefined &&
        lastView(harness)?.model.selection.studyId === harness.studyId &&
        !lastView(harness)?.loading,
      'the browser study replaces the test replay',
      READER_RESULT_BOUND_MS,
    )
    gate.restore()

    // Assert
    assert.equal(whilePending.replay, history.studyId)
    assert.equal(whilePending.time, 'Recorded test output · 0.20 s')
    assert.equal(lastView(harness)?.nodeHistoryPosition, undefined)
    assert.equal(lastView(harness)?.nodeHistorySection, undefined)
    // The browser study is read in the Study composition, and the summary composition's document is withdrawn (Cycle 0051, DS-A).
    assert.equal(familyBefore, 'test')
    assert.equal(lastView(harness)?.replayFamily, undefined)
    assert.notEqual(harness.panelColumn('codebook.studyContext'), undefined)
    assert.equal(
      harness.summary.webview.html.includes(
        'Open saved learning from Codebook to view its summary.',
      ),
      true,
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a browser study whose read fails leaves the selected test replay shown with its Application output and tells the failure; fails_when=the replay is retired although the study never showed, or the pane keeps loading; why_new=F125: a browser study that failed while a test replay is selected had no test; seam=the reader's read of a saved study, made to fail once; no_claim=the failure's wording
test('a browser study that fails to read leaves the selected test replay shown', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  try {
    const history = await openReplayBesideBrowserStudy(harness)
    const gate = gateArchiveReads(harness)
    gate.failNext(new Error('The saved study could not be read.'))

    // Act
    harness.receiveContext({
      type: 'history',
      revision: lastView(harness)!.revision,
      studyId: harness.studyId,
    })
    await waitUntil(
      () =>
        (lastView(harness)?.errors ?? []).some((error) =>
          /could not be read/.test(error),
        ) && !lastView(harness)?.loading,
      'the failed read is told and loading ends',
      READER_RESULT_BOUND_MS,
    )
    gate.restore()

    // Assert
    assert.equal(
      lastView(harness)?.nodeHistory?.header.studyId,
      history.studyId,
    )
    assert.equal(lastView(harness)?.nodeHistoryPosition?.sequence, 2)
    assert.equal(
      applicationReading(harness).time,
      'Recorded test output · 0.20 s',
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a browser study whose read is overtaken by choosing the test replay again shows nothing when its read ends: the replay stays selected; fails_when=the overtaken study's read retires the replay or shows the study after the learner chose the replay; why_new=F125: a browser study superseded while a test replay is selected had no test; seam=the reader's read of a saved study, held until released; no_claim=the order of two reads of different studies
test('a browser study overtaken by choosing the test replay again leaves the replay selected', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  try {
    const history = await openReplayBesideBrowserStudy(harness)
    const gate = gateArchiveReads(harness)
    gate.hold()
    harness.receiveContext({
      type: 'history',
      revision: lastView(harness)!.revision,
      studyId: harness.studyId,
    })
    await gate.started()

    // Act: the learner chooses the replay again while the study is read, then the read ends.
    harness.receiveContext({
      type: 'node-history',
      revision: lastView(harness)!.revision,
      studyId: history.studyId,
    })
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistory?.header.studyId === history.studyId &&
        !lastView(harness)?.loading,
      'the replay is chosen again',
      READER_RESULT_BOUND_MS,
    )
    gate.release()
    await waitUntil(
      () => gate.finishedReads() >= 1,
      'the overtaken study’s read ends',
      READER_RESULT_BOUND_MS,
    )
    await new Promise<void>((resolve) => setImmediate(resolve))
    await harness.controller.settle()
    gate.restore()

    // Assert
    // The reader's own state is read as well as the last posted view: a read that retires the replay without publishing leaves the posted view looking right.
    const reading = harness.reader.inspect().view
    assert.equal(reading?.nodeHistory?.header.studyId, history.studyId)
    assert.equal(reading?.nodeHistoryPosition?.sequence, 2)
    assert.equal(
      lastView(harness)?.nodeHistory?.header.studyId,
      history.studyId,
    )
    assert.equal(lastView(harness)?.nodeHistoryPosition?.sequence, 2)
  } finally {
    await harness.close()
  }
})

// Value: protects=an open of a test replay whose journal cannot be read fails by name and leaves the replay that was shown selected; an open overtaken by a newer open ends as superseded and shows the newer replay; fails_when=a failed open retires the shown replay or an overtaken open takes the pane back; why_new=F125: an open whose journal cannot be read, and one that failed or was superseded, had no test; seam=the replay's journal file overwritten, and the held historical debug presentation; no_claim=the notification the host raises for a failed open
test('an open that fails or is overtaken leaves the shown test replay or the newer one in place', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const store = harness.service.nodeHistoryStore!
    const shown = await saveTwoStopNodeHistory(store)
    const broken = await saveTwoStopNodeHistory(store)
    const overtaken = await saveTwoStopNodeHistory(store)
    await harness.reader.action('retry')
    await openAtFirstStop(harness, shown.studyId)
    await writeFile(
      join(
        harness.directory,
        'storage',
        'learning',
        store.workspaceKey,
        'node-tests.v1',
        broken.studyId,
        'events.jsonl',
      ),
      'not a journal\n',
    )
    const reader = harness.reader as unknown as {
      openNodeHistory: (
        studyId: string,
        revision: number,
      ) => Promise<{ status: string }>
      revision: number
    }

    // Act: the broken journal fails; then a slow open is overtaken by a newer open of the shown replay.
    const failedOutcome = await reader.openNodeHistory(
      broken.studyId,
      reader.revision,
    )
    const afterFailure = lastView(harness)?.nodeHistory?.header.studyId
    const held = harness.holdHistoricalDebugPresentation(true)
    const slowOpen = reader.openNodeHistory(overtaken.studyId, reader.revision)
    await held.started
    const newerOpen = await reader.openNodeHistory(
      shown.studyId,
      reader.revision,
    )
    held.release()
    const slowOutcome = await slowOpen

    // Assert
    assert.equal(failedOutcome.status, 'failed')
    assert.equal(afterFailure, shown.studyId)
    assert.equal(newerOpen.status, 'opened')
    assert.equal(slowOutcome.status, 'superseded')
    assert.equal(lastView(harness)?.nodeHistory?.header.studyId, shown.studyId)
  } finally {
    await harness.close()
  }
})

// Value: protects=with a live run's viewport lease present, the Application pane of a test replay behaves as without one: another replay writes its own document, the same moment is written as it was, with no loading view, a pane the learner closed gets nothing posted and a pane moved to another column keeps receiving the later moments in place; fails_when=another replay's moments are posted into the first replay's document, a refresh of the same moment rewrites the page or posts a view, a move posts into a pane that is gone, or a moved pane gets a new document; why_new=F125: a test replay's other history, same moment, closed pane and moved pane with a viewport lease present were untested cells; seam=the recorded-reader harness (its live run holds the viewport lease), closeTabByHand and movePanel; no_claim=the native placement of the moved pane; why_changed=a move leaves the earlier moment for 300 ms before it commits (F385, F387), so the wait also requires the position not to be pending
test('with a live run’s viewport lease the Application pane writes another replay anew, the same moment as it was, and follows a moved pane but not a closed one', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  try {
    const store = harness.service.nodeHistoryStore!
    const first = await saveTwoStopNodeHistory(store)
    const second = await saveTwoStopNodeHistory(store)
    await harness.reader.action('retry')
    await openAtFirstStop(harness, first.studyId)
    const firstDocument = applicationReading(harness).html

    // Act: the other replay, the same moment again, a move of the pane, then a close of the pane.
    await openAtFirstStop(harness, second.studyId)
    const secondDocument = applicationReading(harness).html
    const outputsAtSecond = harness.applicationOutputs().length
    await harness.reader.action('retry')
    const afterRefresh = {
      html: applicationReading(harness).html,
      outputs: harness.applicationOutputs().length,
    }
    harness.movePanel('codebook.scopedBrowser', 3)
    harness.receiveContext({
      type: 'node-history-step',
      revision: lastView(harness)!.revision,
      studyId: second.studyId,
      direction: 'next',
      unit: 'stop',
    })
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistoryPosition?.sequence === 4 &&
        !lastView(harness)?.nodeHistoryPosition?.pending,
      'Next stop reaches the second stop',
      READER_RESULT_BOUND_MS,
    )
    const afterMove = {
      html: applicationReading(harness).html,
      panels: harness
        .applicationOutputs()
        .slice(outputsAtSecond)
        .map((update) => update.panel),
    }
    const pane = harness
      .nativePanels()
      .find((panel) => panel.kind === 'codebook.scopedBrowser')
    harness.closeTabByHand(pane!.nativeTab)
    await waitUntil(
      () => lastView(harness)?.nodeHistorySection?.applicationClosed === true,
      'the section says the Application pane is closed',
      READER_RESULT_BOUND_MS,
    )
    const outputsAtClose = harness.applicationOutputs().length
    harness.receiveContext({
      type: 'node-history-step',
      revision: lastView(harness)!.revision,
      studyId: second.studyId,
      direction: 'previous',
      unit: 'stop',
    })
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistoryPosition?.sequence === 2 &&
        !lastView(harness)?.nodeHistoryPosition?.pending,
      'Previous stop returns to the first stop',
      READER_RESULT_BOUND_MS,
    )

    // Assert
    assert.match(firstDocument, new RegExp(first.studyId))
    assert.match(secondDocument, new RegExp(second.studyId))
    assert.doesNotMatch(secondDocument, new RegExp(first.studyId))
    assert.match(afterRefresh.html, /Recorded test output · 0\.20 s/)
    assert.doesNotMatch(afterRefresh.html, /Loading recorded test output…<\/p>/)
    assert.equal(afterRefresh.outputs, outputsAtSecond)
    assert.ok(
      afterMove.html === afterRefresh.html,
      'a moved pane gets no new document',
    )
    // The move posts the header that waits for the commit and then the moment (D29, F203).
    assert.deepEqual(afterMove.panels, [
      'codebook.scopedBrowser',
      'codebook.scopedBrowser',
    ])
    assert.equal(harness.applicationOutputs().length, outputsAtClose)
    assert.equal(lastView(harness)?.errors.length, 0)
  } finally {
    await harness.close()
  }
})

// Value: protects=a background render that settles while the shown test replay opens again does not end the open's loading line early or leave a placeholder: the pane ends on the saved moment; fails_when=the render's end reads as the open's end, so the pane says "No test output recorded up to this moment." for the replay that is still opening; why_new=F147: a render that settles while the same test replay opens had no test; seam=the workspace harness's held historical debug presentation; no_claim=the Study pane's loading line
test('a render that settles while the shown test replay opens again ends on its saved moment', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await saveTwoStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.action('retry')
    await openAtFirstStop(harness, history.studyId)
    harness.receiveContext({
      type: 'node-history-step',
      revision: lastView(harness)!.revision,
      studyId: history.studyId,
      direction: 'next',
      unit: 'stop',
    })
    await waitUntil(
      async () =>
        lastView(harness)?.nodeHistoryPosition?.sequence === 4 &&
        (await harness.service.nodeHistoryStore!.readReaderPosition(
          history.studyId,
        )) === 4,
      'the second stop is shown and saved',
      READER_RESULT_BOUND_MS,
    )
    const held = harness.holdHistoricalDebugPresentation(true)
    const outputsBefore = harness.applicationOutputs().length
    const opening = harness.reader.openLearningReplay(history.studyId)
    await held.started

    // Act
    await harness.reader.action('retry')
    held.release()
    await opening
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistoryPosition?.sequence === 4 &&
        !lastView(harness)?.loading,
      'the replay returns to its saved moment',
      READER_RESULT_BOUND_MS,
    )

    // Assert
    assert.ok(
      harness
        .applicationOutputs()
        .slice(outputsBefore)
        .every(
          (update) =>
            update.view.placeholder !==
            'No test output recorded up to this moment.',
        ),
    )
    assert.equal(
      applicationReading(harness).time,
      'Recorded test output · 0.30 s',
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=closing the Study reader waits for the reader-position write of a test replay that is still running, so a window that closes (or storage removed after a close) never has the position file created under it; fails_when=close reports closed while a position write is still pending, so the write then lands in storage that is gone (ENOTEMPTY when a test removes its folder); why_new=F234: "stop moves skip outputs…" failed about half the time on 571d1bd because close did not wait for the write made after the commit; seam=the history store's read, held, which the position write awaits when it is not given a verified history; no_claim=the bound on a write that never returns (READER_CLOSE_STORAGE_TIMEOUT_MS, shared with the close's other storage waits)
test('closing the reader waits for a reader-position write that is still running', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const store = harness.service.nodeHistoryStore!
    const history = await saveTwoStopNodeHistory(store)
    await harness.reader.action('retry')
    await openAtFirstStop(harness, history.studyId)
    const read = store.read.bind(store)
    let releaseRead = (): void => {}
    const readHeld = new Promise<void>((resolve) => {
      releaseRead = resolve
    })
    let readEntered = (): void => {}
    const readStarted = new Promise<void>((resolve) => {
      readEntered = resolve
    })
    store.read = async (studyId): ReturnType<typeof read> => {
      readEntered()
      await readHeld
      return read(studyId)
    }
    const write = store.saveReaderPosition(history.studyId, 4)
    await readStarted

    // Act
    const closing = harness.reader.close()
    const closedWhileWriting = await Promise.race([
      closing.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 300)),
    ])
    releaseRead()
    await closing
    await write
    store.read = read

    // Assert
    assert.equal(closedWhileWriting, false)
    assert.equal(await store.readReaderPosition(history.studyId), 4)
  } finally {
    await harness.close()
  }
})

// Value: protects=a saved browser study chosen in the bottom panel's Saved studies while a test replay is shown and the bottom panel is maximized waits for the editor area, as a choice from the Study pane does: the panel stays maximized and the chosen study is selected in it; fails_when=leaving the summary composition opens the Study pane at once, which brings the hidden editor area back and takes the panel out of its maximized state (Cycle 0051 /ship review); why_new=Cycle 0052 task 15: showChosenStudy left the summary composition past the studyAwaitingEditorArea deferral; seam=recordedReaderHarness with a maximized bottom panel, the bottom panel's history message; no_claim=the native editor's own restore of the area
test('a browser study chosen from a test replay with the bottom panel maximized keeps the panel maximized', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  try {
    await openReplayBesideBrowserStudy(harness)
    harness.maximizePanel()

    // Act
    harness.receivePlaybackPanel({
      type: 'history',
      revision: lastView(harness)!.revision,
      studyId: harness.studyId,
    })
    await waitUntil(
      () =>
        harness.reader.inspect().view?.nodeHistory === undefined &&
        harness.reader.inspect().view?.model.selection.studyId ===
          harness.studyId &&
        !harness.reader.inspect().view?.loading,
      'the browser study is chosen',
      READER_RESULT_BOUND_MS,
    )

    // Assert
    assert.deepEqual(
      {
        panelMaximized: harness.isPanelMaximized(),
        studyPaneShown:
          harness.panelColumn('codebook.studyContext') !== undefined,
      },
      { panelMaximized: true, studyPaneShown: false },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=once the learner restores the maximized bottom panel, the browser study chosen over a test replay shows in the Study composition and the retired replay's recorded-source tab closes; fails_when=the deferred arrangement never runs, or the slot tab stays open beside the study; why_new=Cycle 0052 task 15: the slot's close waits for the editor area with the chosen study; seam=recordedReaderHarness, restorePanel and the reader's refresh; no_claim=the native editor's own restore of the area
test('restoring the panel after a browser study was chosen from a maximized test replay shows the Study pane and closes the slot tab', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  try {
    await openReplayBesideBrowserStudy(harness)
    harness.maximizePanel()
    harness.receivePlaybackPanel({
      type: 'history',
      revision: lastView(harness)!.revision,
      studyId: harness.studyId,
    })
    await waitUntil(
      () =>
        harness.reader.inspect().view?.nodeHistory === undefined &&
        harness.reader.inspect().view?.model.selection.studyId ===
          harness.studyId &&
        !harness.reader.inspect().view?.loading,
      'the browser study is chosen',
      READER_RESULT_BOUND_MS,
    )

    const slotTabCount = (): number =>
      harness.groups
        .flatMap((group) => group.tabs)
        .filter((tab) =>
          JSON.stringify(tab.input).includes('/node-history-slot/'),
        ).length
    const slotTabsWhileMaximized = slotTabCount()

    // Act
    harness.restorePanel()
    await readerSeams(harness).refresh()
    await waitUntil(
      () =>
        harness.panelColumn('codebook.studyContext') !== undefined &&
        slotTabCount() === 0,
      'the Study pane shows and the slot tab closes',
      READER_RESULT_BOUND_MS,
    )

    // Assert
    assert.equal(slotTabsWhileMaximized, 1)
  } finally {
    await harness.close()
  }
})

// Value: protects=a test replay opened after a browser study was chosen with the bottom panel maximized keeps its own recorded-source tab when the wait for the editor area ends; fails_when=the end of the wait closes every slot tab, the new replay's among them (OCR self-review of b37912f4); why_new=Cycle 0052 task 15's deferred slot close; seam=recordedReaderHarness with a maximized bottom panel, restorePanel and the reader's refresh; no_claim=the native editor's own restore of the area
test('a test replay opened while a chosen browser study waits for the editor area keeps its slot tab when the wait ends', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  try {
    const second = await saveTwoStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await openReplayBesideBrowserStudy(harness)
    harness.maximizePanel()
    harness.receivePlaybackPanel({
      type: 'history',
      revision: lastView(harness)!.revision,
      studyId: harness.studyId,
    })
    await waitUntil(
      () =>
        harness.reader.inspect().view?.nodeHistory === undefined &&
        harness.reader.inspect().view?.model.selection.studyId ===
          harness.studyId &&
        !harness.reader.inspect().view?.loading,
      'the browser study is chosen',
      READER_RESULT_BOUND_MS,
    )

    // Act
    await harness.reader.openLearningReplay(second.studyId)
    await waitUntil(
      () =>
        harness.reader.inspect().view?.nodeHistoryPosition?.sequence === 2 &&
        !harness.reader.inspect().view?.loading,
      'the second test replay lands on its first stop',
      READER_RESULT_BOUND_MS,
    )
    harness.restorePanel()
    await readerSeams(harness).refresh()
    await readerSeams(harness).refresh()

    // Assert
    assert.equal(
      harness.groups
        .flatMap((group) => group.tabs)
        .filter((tab) =>
          JSON.stringify(tab.input).includes('/node-history-slot/'),
        ).length,
      1,
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a second Saved studies choice made while the first still waits for the hidden editor area keeps the retired replay's slot tabs waiting too, so the maximized bottom panel stays maximized; fails_when=the second choice's retirement closes the waiting slot tabs, which brings the editor area back (local CodeRabbit round 2, minor); why_new=Cycle 0052 task 15; seam=recordedReaderHarness with a maximized bottom panel, two history messages from the bottom panel; no_claim=the native editor's own restore of the area
test('a second Saved studies choice while the first waits for the editor area keeps the panel maximized', async () => {
  // Arrange: a second saved browser study stands in Saved studies beside the first.
  const harness = await recordedReaderHarness(true)
  try {
    const library = await harness.reader.learningStorage(),
      second = createConfiguredStudy(),
      runId = randomUUID()
    for (const observation of second.observations)
      observation.snapshotUri = observation.snapshotUri.replace(
        second.runId,
        runId,
      )
    second.workspaceKey = library.workspaceKey
    second.runId = runId
    second.id = `${second.instanceId}_${runId}`
    second.savedAt = '2026-09-20T00:00:01.000Z'
    await library.saveStudy(second)
    await openReplayBesideBrowserStudy(harness)
    harness.maximizePanel()
    const chooseSavedStudy = async (studyId: string): Promise<void> => {
      harness.receivePlaybackPanel({
        type: 'history',
        revision: harness.reader.inspect().view!.revision,
        studyId,
      })
      await waitUntil(
        () =>
          harness.reader.inspect().view?.nodeHistory === undefined &&
          harness.reader.inspect().view?.model.selection.studyId === studyId &&
          !harness.reader.inspect().view?.loading,
        'the saved study is chosen',
        READER_RESULT_BOUND_MS,
      )
    }
    await chooseSavedStudy(harness.studyId)

    // Act
    await chooseSavedStudy(second.id)

    // Assert
    assert.equal(harness.isPanelMaximized(), true)
  } finally {
    await harness.close()
  }
})

/**
 * Opens a saved test replay beside a saved browser study, maximizes the bottom panel and chooses the browser study there, so the study waits for the hidden editor area with the replay's slot tab; the round-3 tests of Cycle 0052 task 15 start from it.
 * @param harness - The recorded reader harness.
 * @returns The test replay's header.
 * @example const history = await chooseBrowserStudyWithPanelMaximized(harness)
 */
async function chooseBrowserStudyWithPanelMaximized(
  harness: Awaited<ReturnType<typeof recordedReaderHarness>>,
) {
  const history = await openReplayBesideBrowserStudy(harness)
  harness.maximizePanel()
  harness.receivePlaybackPanel({
    type: 'history',
    revision: lastView(harness)!.revision,
    studyId: harness.studyId,
  })
  await waitUntil(
    () =>
      harness.reader.inspect().view?.nodeHistory === undefined &&
      harness.reader.inspect().view?.model.selection.studyId ===
        harness.studyId &&
      !harness.reader.inspect().view?.loading,
    'the browser study is chosen',
    READER_RESULT_BOUND_MS,
  )
  return history
}

/**
 * Counts the recorded-source slot tabs in every group.
 * @param harness - The recorded reader harness.
 * @returns How many slot tabs stand open.
 * @example slotTabCount(harness) // => 1
 */
function slotTabCount(
  harness: Awaited<ReturnType<typeof recordedReaderHarness>>,
): number {
  return harness.groups
    .flatMap((group) => group.tabs)
    .filter((tab) => JSON.stringify(tab.input).includes('/node-history-slot/'))
    .length
}

// Value: protects=the same test replay opened again while a chosen browser study waits for the editor area keeps its reused slot tab when the panel is restored; fails_when=the end of the wait closes the reused tab as the earlier wait's (local CodeRabbit round 3, minor); why_new=Cycle 0052 task 15; seam=recordedReaderHarness with a maximized bottom panel, restorePanel and the reader's refresh; no_claim=the native editor's own restore of the area
test('the same test replay opened again while a chosen browser study waits keeps its slot tab when the panel is restored', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  try {
    const history = await chooseBrowserStudyWithPanelMaximized(harness)

    // Act
    await harness.reader.openLearningReplay(history.studyId)
    await waitUntil(
      () =>
        harness.reader.inspect().view?.nodeHistory?.header.studyId ===
          history.studyId && !harness.reader.inspect().view?.loading,
      'the test replay is shown again',
      READER_RESULT_BOUND_MS,
    )
    harness.restorePanel()
    await readerSeams(harness).refresh()
    await readerSeams(harness).refresh()

    // Assert
    assert.equal(slotTabCount(harness), 1)
  } finally {
    await harness.close()
  }
})

// Value: protects=the retired replay's waiting slot tab closes when the panel is restored also after Cursor rebuilt the tab objects meanwhile; fails_when=the record holds only the old tab objects, so nothing matches and the slot tab stays beside the chosen study (local CodeRabbit round 3, minor); why_new=Cycle 0052 task 15; seam=rebuildTabObjectsNow (Cursor's whole new tab model), restorePanel and the reader's refresh; no_claim=Cursor's own timing of the rebuild
test('a waiting slot tab closes on the panel’s restore also after Cursor rebuilt the tab objects', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  try {
    harness.useHostAppName('Cursor')
    await chooseBrowserStudyWithPanelMaximized(harness)
    const slotTabsWhileWaiting = slotTabCount(harness)
    harness.rebuildTabObjectsNow()

    // Act
    harness.restorePanel()
    await readerSeams(harness).refresh()
    await waitUntil(
      () => harness.panelColumn('codebook.studyContext') !== undefined,
      'the Study pane shows',
      READER_RESULT_BOUND_MS,
    )

    // Assert
    assert.deepEqual(
      { slotTabsWhileWaiting, slotTabsAfter: slotTabCount(harness) },
      { slotTabsWhileWaiting: 1, slotTabsAfter: 0 },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a Saved studies choice that a newer test replay entry overtakes while it reads whether the editor area is hidden retires nothing: the newer replay and its debugger stay; fails_when=the old choice retires the replay the learner opened during its read (local CodeRabbit round 3, minor); why_new=Cycle 0052 task 15's area read before the retirement; seam=holdNextCommand on vscode.getEditorLayout; no_claim=the native editor's answer time
test('a Saved studies choice overtaken during its editor-area read retires nothing', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  let release = (): void => {}
  try {
    await openReplayBesideBrowserStudy(harness)
    const second = await saveTwoStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.action('retry')
    const held = harness.holdNextCommand('vscode.getEditorLayout')
    release = held.release
    harness.receivePlaybackPanel({
      type: 'history',
      revision: lastView(harness)!.revision,
      studyId: harness.studyId,
    })
    await held.started

    // Act: the learner opens another test replay while the choice reads the layout.
    const entry = harness.reader.openLearningReplay(second.studyId)
    await waitUntil(
      () =>
        harness.reader.inspect().view?.nodeHistory?.header.studyId ===
          second.studyId && !harness.reader.inspect().view?.loading,
      'the second test replay is shown',
      READER_RESULT_BOUND_MS,
    )
    held.release()
    await entry
    await readerSeams(harness).refresh()

    // Assert
    assert.equal(
      harness.reader.inspect().view?.nodeHistory?.header.studyId,
      second.studyId,
    )
  } finally {
    release()
    await harness.close()
  }
})

// Value: protects=a test replay entry made while a chosen browser study waits for the hidden editor area closes the slot tabs that waited with it, also when the new replay's own slot never shows; fails_when=the entry drops the record of the waiting tabs, so a failed open leaves the earlier replay's slot tab open for good (local CodeRabbit round 4, minor); why_new=Cycle 0052 task 15; seam=failCurrentSourceOpen (the new replay's slot cannot open); no_claim=the native failure's cause
test('a test replay entry whose slot fails to show still closes the slot tab that waited for the editor area', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  try {
    const second = await saveTwoStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await chooseBrowserStudyWithPanelMaximized(harness)
    const slotTabsWhileWaiting = slotTabCount(harness)
    harness.failCurrentSourceOpen()

    // Act
    await harness.reader.openLearningReplay(second.studyId)
    await waitUntil(
      () =>
        harness.reader.inspect().view?.nodeHistory?.header.studyId ===
          second.studyId && !harness.reader.inspect().view?.loading,
      'the second test replay is selected',
      READER_RESULT_BOUND_MS,
    )
    harness.restoreCurrentSourceOpen()

    // Assert
    assert.deepEqual(
      { slotTabsWhileWaiting, slotTabsAfter: slotTabCount(harness) },
      { slotTabsWhileWaiting: 1, slotTabsAfter: 0 },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=an explicit display (Focus source) that ends a chosen browser study's wait for the hidden editor area closes the slot tabs that waited with it; fails_when=renderSelection ends the wait and the waiting slot tab stays open beside the shown study (local CodeRabbit round 4, minor); why_new=Cycle 0052 task 15; seam=the reader's source action; no_claim=the native editor's own restore of the area
test('an explicit display that ends the wait for the editor area closes the slot tab that waited', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  try {
    await chooseBrowserStudyWithPanelMaximized(harness)
    const slotTabsWhileWaiting = slotTabCount(harness)

    // Act
    await harness.reader.action('source')

    // Assert
    assert.deepEqual(
      { slotTabsWhileWaiting, slotTabsAfter: slotTabCount(harness) },
      { slotTabsWhileWaiting: 1, slotTabsAfter: 0 },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a slot tab the learner closes by hand after Cursor rebuilt the tab objects, and opens again at its address, survives the end of the wait for the editor area; fails_when=the record keeps the closed tab's address and the end of the wait closes the tab the learner opened (local CodeRabbit round 4, minor); why_new=Cycle 0052 task 15; seam=rebuildTabObjectsNow, closeTabByHand, restoreLeftoverCapturedSource at the slot's path, restorePanel and the reader's refresh; no_claim=the native tab strip
test('a waiting slot tab the learner closes after Cursor rebuilt the tabs and opens again survives the end of the wait', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  try {
    harness.useHostAppName('Cursor')
    await chooseBrowserStudyWithPanelMaximized(harness)
    harness.rebuildTabObjectsNow()
    const rebuiltSlotTab = harness.groups
      .flatMap((group) => group.tabs)
      .find((tab) => JSON.stringify(tab.input).includes('/node-history-slot/'))
    assert.ok(rebuiltSlotTab)
    const slotPath = (rebuiltSlotTab.input as { uri: { path: string } }).uri
      .path
    harness.closeTabByHand(rebuiltSlotTab)
    const reopenedTab = harness.restoreLeftoverCapturedSource({
      active: false,
      path: slotPath,
    })

    // Act
    harness.restorePanel()
    await readerSeams(harness).refresh()
    await waitUntil(
      () => harness.panelColumn('codebook.studyContext') !== undefined,
      'the Study pane shows',
      READER_RESULT_BOUND_MS,
    )

    // Assert
    assert.equal(
      harness.groups.flatMap((group) => group.tabs).includes(reopenedTab),
      true,
    )
  } finally {
    await harness.close()
  }
})
