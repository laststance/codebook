import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import {
  recordedReaderHarness,
  workspaceHarness,
} from './studyWorkspaceHarness'
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
    2_000,
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

// Value: protects=a background render that is still running when the learner moves to another event of the selected test replay does not take the pane back: once it ends, the Application pane and the Study section show the later moment; fails_when=the render's end writes the moment it started with, or a loading view; why_new=F139: only a render that settles on its own was tested; seam=the learning library's list, held until the move is shown; no_claim=the order of two renders (the workspace tests of the library)
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
      () => lastView(harness)?.nodeHistoryPosition?.sequence === 4,
      'Next stop reaches the second stop',
      2_000,
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

// Value: protects=a background render that settles while another test replay opens does not end that open's loading line early or leave a placeholder: the pane ends on the opened replay's first moment; fails_when=the render's end reads as the open's end, so the pane says "No test output recorded up to this moment." for the replay that is still opening; why_new=F147: only the first open of a replay was tested; seam=the workspace harness's held historical debug presentation; no_claim=the Study pane's loading line
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
    held.release()
    await opening
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistory?.header.studyId === other.studyId &&
        !lastView(harness)?.loading,
      'the other test replay is shown',
      2_000,
    )

    // Assert
    const posted = harness.applicationOutputs().slice(outputsBefore)
    assert.ok(
      posted.some(
        (update) => update.view.placeholder === 'Loading recorded test output…',
      ),
      'the open tells its loading line',
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
      2_000,
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
      2_000,
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

// Value: protects=a saved browser study chosen in Saved studies while a test replay is selected retires the replay once the study is read and shows the study, and the replay stays selected, with its Application output, while the read is pending; fails_when=the replay is retired before the study is read (a failed read then leaves nothing), or stays selected beside the study; why_new=F125: a browser study opened or pending while a test replay is selected had no test; seam=the reader's read of a saved study, held until released; no_claim=the browser study's own display
test('a browser study chosen over a selected test replay replaces it only once it is read', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  try {
    const history = await openReplayBesideBrowserStudy(harness)
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
      2_000,
    )
    gate.restore()

    // Assert
    assert.equal(whilePending.replay, history.studyId)
    assert.equal(whilePending.time, 'Recorded test output · 0.20 s')
    assert.equal(lastView(harness)?.nodeHistoryPosition, undefined)
    assert.equal(lastView(harness)?.nodeHistorySection, undefined)
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
      2_000,
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
      2_000,
    )
    gate.release()
    await waitUntil(
      () => gate.finishedReads() >= 1,
      'the overtaken study’s read ends',
      2_000,
    )
    await new Promise<void>((resolve) => setImmediate(resolve))
    await harness.controller.settle()
    gate.restore()

    // Assert
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

// Value: protects=with a live run's viewport lease present, the Application pane of a test replay behaves as without one: another replay writes its own document, the same moment is written as it was, with no loading view, a pane the learner closed gets nothing posted and a pane moved to another column keeps receiving the later moments in place; fails_when=another replay's moments are posted into the first replay's document, a refresh of the same moment rewrites the page or posts a view, a move posts into a pane that is gone, or a moved pane gets a new document; why_new=F125: a test replay's other history, same moment, closed pane and moved pane with a viewport lease present were untested cells; seam=the recorded-reader harness (its live run holds the viewport lease), closeTabByHand and movePanel; no_claim=the native placement of the moved pane
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
      () => lastView(harness)?.nodeHistoryPosition?.sequence === 4,
      'Next stop reaches the second stop',
      2_000,
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
      2_000,
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
      () => lastView(harness)?.nodeHistoryPosition?.sequence === 2,
      'Previous stop returns to the first stop',
      2_000,
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
    assert.deepEqual(afterMove.panels, ['codebook.scopedBrowser'])
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
      2_000,
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
      2_000,
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
