import assert from 'node:assert/strict'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { before, test } from 'node:test'

import type { ChromeExtensionLearningMaterialContent } from '../chromeExtensionLearningSchemas'
import { CHROME_EXTENSION_PROFILE } from '../constants'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { workspaceHarness } from './studyWorkspaceHarness'
import {
  POPUP_SOURCE_TEXT,
  WORKER_SOURCE_TEXT,
} from './utils/chromeExtensionHistoryFixture'
import {
  openExtensionReplay,
  selectExtensionEvent,
  shownExtensionMoment,
  writeExtensionHistoryFor,
} from './utils/extensionWorkspaceHarness'
import { FakeChromeExtensionRuntime } from './utils/fakeChromeExtensionRuntime'
import { READER_RESULT_BOUND_MS } from './utils/readerResultBound'
import { realProcessStart } from './utils/realProcessStart'
import type { ExtensionScriptStep } from './utils/sealedExtensionHistory'
import { repositoryOf } from './utils/serverWorkspaceHarness'
import { shownApplicationView } from './utils/shownTestOutput'
import { chromeExtensionConfigurationOf } from './utils/startFakeChromeExtensionRun'
import { lastView } from './utils/twoStopNodeHistory'

before(async () => {
  await realProcessStart(process.pid)
})

/**
 * A run of one page stop with a pinned frame, a gap with two stream frames of different sizes, then a service-worker stop with no pin: sequences 1 to 11 in script order.
 * The worker stop opens 1.2 s after the last stream frame was received.
 */
const RUN: ExtensionScriptStep[] = [
  { at: 10, type: 'frame', kind: 'stream', salt: 'a' },
  { at: 100, type: 'open', pauseId: 'p1', stopIndex: 1, context: 'page' },
  { at: 101, type: 'capture', pauseId: 'p1', stopIndex: 1, context: 'page' },
  { at: 110, type: 'frame', kind: 'pin', pauseId: 'p1', salt: 'pin' },
  { at: 200, type: 'close', pauseId: 'p1' },
  {
    at: 300,
    type: 'frame',
    kind: 'stream',
    salt: 'b',
    width: 400,
    height: 300,
  },
  {
    at: 350,
    type: 'frame',
    kind: 'stream',
    salt: 'c',
    width: 800,
    height: 500,
  },
  {
    at: 1550,
    type: 'open',
    pauseId: 'p2',
    stopIndex: 2,
    context: 'service-worker',
  },
  {
    at: 1551,
    type: 'capture',
    pauseId: 'p2',
    stopIndex: 2,
    context: 'service-worker',
  },
  { at: 1700, type: 'close', pauseId: 'p2' },
  { at: 1800, type: 'result' },
]
const [OPEN1, CLOSE1, B, C, OPEN2, CLOSE2] = [2, 5, 6, 7, 8, 10]

// protects=Saved studies lists a saved extension run as an Extension replay with its question, the extension's name and version, the surface and the capture state; fails_when=the row reads as a test or server replay, or omits the extension, surface or capture state; no_claim=the webview's drawing of the row
test('Saved studies lists a sealed extension run as an Extension replay with its extension, surface and capture state', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await writeExtensionHistoryFor(harness, RUN, {
      question: 'Why does Save fail?',
    })

    // A run whose editor closed mid-way leaves a journal with no seal.
    const interrupted = await writeExtensionHistoryFor(
      harness,
      RUN.slice(0, 3),
      {
        seal: false,
        question: 'Why did the worker stop?',
      },
    )

    // Act
    await harness.reader.action('retry')
    const view = harness.reader.inspect().view
    const interruptedRow = view?.studies.find(
      (study) => study.id === interrupted.studyId,
    )
    const entry = view?.nodeExtensionHistoryCatalog?.find(
      (summary) => summary.studyId === history.studyId,
    )
    const listed = view?.studies.find((study) => study.id === history.studyId)

    // Assert
    assert.equal(entry?.extensionName, 'Bookmark Notes')
    assert.equal(entry?.surfaceKind, 'popup')
    assert.equal(
      listed?.outcome,
      'Why does Save fail? · Extension replay · Bookmark Notes 1.2.0 · popup · capture complete',
    )
    assert.equal(listed?.profile, 'chrome-extension')
    assert.equal(
      interruptedRow?.outcome,
      'Why did the worker stop? · Extension replay · Bookmark Notes 1.2.0 · popup · capture interrupted',
    )
  } finally {
    await harness.close()
  }
})

// protects=opening an Extension replay lands on its first recorded stop with the stop's pinned frame in the Application pane, the executed source in the slot and the thread "Recorded page stop 1"; fails_when=the replay opens on a frame, shows another frame, drops the Application pane or names a test stop; no_claim=the native editor's drawing of the slot
test('Open replay of an extension run lands on its first page stop with the pinned frame, the recorded source and the page thread', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await writeExtensionHistoryFor(harness, RUN)

    // Act
    await openExtensionReplay(harness, history.studyId)
    const shown = shownExtensionMoment(harness)
    const presented = harness.historicalDebugPresentations.at(-1)

    // Assert
    assert.equal(lastView(harness)?.nodeReplayProfile, 'chrome-extension')
    assert.equal(lastView(harness)?.nodeHistoryPosition?.sequence, OPEN1)
    assert.equal(shown.position, 'Page stop 1 · 0.10 s')
    assert.equal(shown.frameLabel, 'Recorded frame captured at this stop')
    assert.equal(shown.hasFrameImage, true)
    assert.equal(shown.lastThread, 'Recorded page stop 1 · popup.js:2')
    assert.equal(
      harness.documentTextOf(presented!.sourceDocument!.uri),
      POPUP_SOURCE_TEXT,
    )
  } finally {
    await harness.close()
  }
})

// protects=seeking to the service-worker stop presents it under its own thread with its frame labeled by its distance, and seeking into a no-stop interval shows the "Not recorded at this moment" thread with no frames while the stream frame still advances; fails_when=the worker stop keeps the page thread, a no-stop moment keeps a stop or its line, or the frame stops advancing; no_claim=native frame correspondence
test('seeking to a service-worker stop and then into a gap shows the worker stop with a labeled frame and then no stop while frames advance', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await writeExtensionHistoryFor(harness, RUN)
    await openExtensionReplay(harness, history.studyId)

    // Act
    await selectExtensionEvent(harness, history.studyId, OPEN2)
    const atWorker = shownExtensionMoment(harness)
    const workerSource = harness.documentTextOf(
      harness.historicalDebugPresentations.at(-1)!.sourceDocument!.uri,
    )
    await selectExtensionEvent(harness, history.studyId, CLOSE2)
    const inGap = shownExtensionMoment(harness)
    await selectExtensionEvent(harness, history.studyId, B)
    await selectExtensionEvent(harness, history.studyId, C)
    const laterInGap = shownExtensionMoment(harness)

    // Assert
    assert.equal(
      atWorker.lastThread,
      'Recorded service worker stop 2 · worker.js:2',
    )
    assert.equal(
      atWorker.frameLabel,
      'Recorded frame from 1.2 s before this stop',
    )
    assert.equal(workerSource, WORKER_SOURCE_TEXT)
    // The gap empties the debugger on the "Not recorded" thread and presents no stop, line or source.
    assert.equal(inGap.emptiedAs, 'Not recorded at this moment')
    assert.equal(inGap.emptyings, atWorker.emptyings + 1)
    assert.equal(inGap.presentations, atWorker.presentations)
    assert.equal(laterInGap.emptyings, inGap.emptyings)
    assert.equal(laterInGap.frameLabel, 'Recorded frame')
    assert.equal(
      lastView(harness)?.nodeHistorySection?.notRecorded,
      'Source and debugger not recorded at this moment.',
    )
  } finally {
    await harness.close()
  }
})

// protects=moments inside one stop or one no-stop stretch repaint nothing natively (only the Application frame changes), and moving through the same events again in any order shows identical state and starts no new debugger; fails_when=a frame event re-presents the debugger or a repeated interval differs from the first visit; no_claim=that no Chrome is started (the replay holds no launcher; the code path has no Chrome import)
test('stepping across a gap and back shows identical moments and presents the debugger only when the stop changes', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await writeExtensionHistoryFor(harness, RUN)
    await openExtensionReplay(harness, history.studyId)
    await selectExtensionEvent(harness, history.studyId, CLOSE1)
    const afterClose = shownExtensionMoment(harness)

    // Act
    await selectExtensionEvent(harness, history.studyId, B)
    await selectExtensionEvent(harness, history.studyId, C)
    const insideGap = shownExtensionMoment(harness)
    await selectExtensionEvent(harness, history.studyId, B)
    const backInGap = shownExtensionMoment(harness)
    await selectExtensionEvent(harness, history.studyId, CLOSE1)
    const againAfterClose = shownExtensionMoment(harness)

    // Assert
    assert.deepEqual(againAfterClose, afterClose)
    assert.equal(insideGap.presentations, afterClose.presentations)
    assert.equal(backInGap.presentations, afterClose.presentations)
    assert.equal(backInGap.frameLabel, 'Recorded frame')
    assert.equal(insideGap.hasFrameImage, true)
  } finally {
    await harness.close()
  }
})

// protects=a stop with neither a pinned frame nor an earlier stream frame shows the labeled no-frame state, and a frame whose blob is damaged shows it for that frame only while the next moment shows its own frame; fails_when=another moment's frame stands in, a damaged blob breaks the replay, or the damage spreads; no_claim=a real disk fault
test('a stop with no frame and a damaged blob show the no-frame state for those moments only', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await writeExtensionHistoryFor(harness, [
      { at: 100, type: 'open', pauseId: 'p1', stopIndex: 1, context: 'page' },
      {
        at: 110,
        type: 'capture',
        pauseId: 'p1',
        stopIndex: 1,
        context: 'page',
      },
      { at: 200, type: 'close', pauseId: 'p1' },
      { at: 300, type: 'frame', kind: 'stream', salt: 'broken' },
      { at: 400, type: 'frame', kind: 'stream', salt: 'fine' },
    ])
    await openExtensionReplay(harness, history.studyId)
    const noFrame = shownExtensionMoment(harness)

    // Act
    await rm(join(history.directory, 'frames', `${history.hashes.get(3)}.png`))
    await selectExtensionEvent(harness, history.studyId, 4)
    const damaged = shownExtensionMoment(harness)
    const damagedFrame = shownApplicationView(harness)?.frame
    await selectExtensionEvent(harness, history.studyId, 5)
    const intact = shownExtensionMoment(harness)

    // Assert
    assert.equal(noFrame.frameLabel, 'No recorded frame at this moment')
    assert.equal(noFrame.hasFrameImage, false)
    assert.equal(damaged.frameLabel, 'No recorded frame at this moment')
    assert.equal(damagedFrame?.reason, 'EXTENSION_HISTORY_FRAME_DAMAGED')
    assert.equal(damaged.hasFrameImage, false)
    assert.equal(intact.frameLabel, 'Recorded frame')
    assert.equal(intact.hasFrameImage, true)
  } finally {
    await harness.close()
  }
})

// protects=frames of changing size replay at their recorded size; fails_when=a frame is drawn at the size of another; no_claim=pixels
test('frames of different sizes are shown at their recorded size', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await writeExtensionHistoryFor(harness, RUN)
    await openExtensionReplay(harness, history.studyId)

    // Act
    await selectExtensionEvent(harness, history.studyId, B)
    const small = shownApplicationView(harness)?.frame
    await selectExtensionEvent(harness, history.studyId, C)
    const large = shownApplicationView(harness)?.frame

    // Assert
    assert.deepEqual([small?.width, small?.height], [400, 300])
    assert.deepEqual([large?.width, large?.height], [800, 500])
  } finally {
    await harness.close()
  }
})

// protects=a pause opened inside another shows its own stop thread from its open to its close and the outer stop returns after it; fails_when=the inner stop never replaces the outer thread or the outer thread does not return; no_claim=the live run's pause set
test('a pause opened inside another shows the inner stop and then the outer stop again', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await writeExtensionHistoryFor(harness, [
      { at: 10, type: 'open', pauseId: 'outer', stopIndex: 1, context: 'page' },
      {
        at: 11,
        type: 'capture',
        pauseId: 'outer',
        stopIndex: 1,
        context: 'page',
      },
      {
        at: 20,
        type: 'open',
        pauseId: 'inner',
        stopIndex: 2,
        context: 'service-worker',
      },
      {
        at: 21,
        type: 'capture',
        pauseId: 'inner',
        stopIndex: 2,
        context: 'service-worker',
      },
      { at: 30, type: 'close', pauseId: 'inner' },
      { at: 40, type: 'close', pauseId: 'outer' },
    ])
    await openExtensionReplay(harness, history.studyId)

    // Act
    await selectExtensionEvent(harness, history.studyId, 3)
    const inner = harness.historicalDebugPresentations.at(-1)?.label
    await selectExtensionEvent(harness, history.studyId, 5)
    const outerAgain = harness.historicalDebugPresentations.at(-1)?.label
    await selectExtensionEvent(harness, history.studyId, 6)
    const none = shownExtensionMoment(harness)

    // Assert
    assert.equal(inner, 'Recorded service worker stop 2 · worker.js:2')
    assert.equal(outerAgain, 'Recorded page stop 1 · popup.js:2')
    assert.equal(none.emptiedAs, 'Not recorded at this moment')
    assert.equal(none.lastThread, 'Recorded page stop 1 · popup.js:2')
  } finally {
    await harness.close()
  }
})

// protects=a stop whose captured source cannot be proven is presented under its thread labeled by what is missing and never as a moment without a stop; fails_when=a partial stop reads "Not recorded at this moment" or hides which part is missing; no_claim=the debugger's drawing
test('a stop whose source is not recorded is labeled by what is missing and is not a moment without a stop', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await writeExtensionHistoryFor(harness, [
      { at: 10, type: 'open', pauseId: 'p1', stopIndex: 1, context: 'page' },
      {
        at: 11,
        type: 'capture',
        pauseId: 'p1',
        stopIndex: 1,
        context: 'page',
        staleSource: true,
      },
      {
        at: 20,
        type: 'open',
        pauseId: 'p2',
        stopIndex: 2,
        context: 'service-worker',
      },
    ])

    // Act
    await openExtensionReplay(harness, history.studyId)
    const sourceMissing = harness.historicalDebugPresentations.at(-1)
    await selectExtensionEvent(harness, history.studyId, 3)
    const nothingCaptured = harness.historicalDebugPresentations.at(-1)

    // Assert
    assert.equal(
      sourceMissing?.label,
      'Recorded page stop 1 · popup.js:2 · source not recorded',
    )
    assert.equal(sourceMissing?.sourceDocument, undefined)
    assert.equal(sourceMissing?.snapshot !== undefined, true)
    assert.equal(
      nothingCaptured?.label,
      'Recorded service worker stop 2 · worker.js:2 · source and values not recorded',
    )
    assert.equal(nothingCaptured?.snapshot, undefined)
  } finally {
    await harness.close()
  }
})

// protects=the playhead is saved as a journal sequence, so a frame inside a no-stop interval reopens exactly there with no stop and its own frame, and a first open without a saved position lands on the first stop; fails_when=a restart lands on the first stop or on another frame of the gap; no_claim=an editor restart (the saved position is written and the replay opened again)
test('a replay reopens at the saved frame inside a no-stop interval', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await writeExtensionHistoryFor(harness, RUN)
    await repositoryOf(harness).extensionHistories.saveReaderPosition(
      history.studyId,
      B,
    )

    // Act
    await openExtensionReplay(harness, history.studyId)
    const reopened = shownExtensionMoment(harness)

    // Assert
    assert.equal(lastView(harness)?.nodeHistoryPosition?.sequence, B)
    assert.equal(reopened.lastThread, 'Not recorded at this moment')
    assert.equal(reopened.position, 'Frame · 0.30 s')
    assert.equal(reopened.frameLabel, 'Recorded frame')
  } finally {
    await harness.close()
  }
})

// protects=selecting a moment writes its journal sequence as the reader position; fails_when=the position stays on the opening stop; no_claim=the file's format
test('moving the playhead saves its journal sequence for the next open', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await writeExtensionHistoryFor(harness, RUN)
    await openExtensionReplay(harness, history.studyId)

    // Act
    await selectExtensionEvent(harness, history.studyId, C)

    // Assert
    await waitUntil(
      async () =>
        (await repositoryOf(harness).extensionHistories.readReaderPosition(
          history.studyId,
        )) === C,
      'the position is saved',
      READER_RESULT_BOUND_MS,
    )
  } finally {
    await harness.close()
  }
})

// protects=rapid selections whose frame loads finish out of order commit only the last selected moment; fails_when=a slow earlier frame overwrites the later moment's frame; no_claim=real disk timing (the first load is held)
test('a slow frame load of an earlier selection never replaces the later moment', async (context) => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await writeExtensionHistoryFor(harness, RUN)
    await openExtensionReplay(harness, history.studyId)
    const cache = harness.reader['extensionFrames']!
    const load = cache.load.bind(cache)
    let releaseFirst = (): void => {}
    const held = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    let heldOne = false
    let heldLoadSettled = false
    context.mock.method(
      cache,
      'load',
      async (frame: Parameters<typeof load>[0]) => {
        // The frame of the first selection below (stream b) is held until the second selection has committed.
        if (!heldOne && frame.hash === history.hashes.get(5)) {
          heldOne = true
          await held
          const loaded = await load(frame)
          heldLoadSettled = true
          return loaded
        }
        return load(frame)
      },
    )

    // Act
    harness.receiveContext({
      type: 'node-history-event',
      revision: lastView(harness)!.revision,
      studyId: history.studyId,
      sequence: B,
    })
    await selectExtensionEvent(harness, history.studyId, C)
    releaseFirst()
    await waitUntil(
      () => heldLoadSettled,
      'the held earlier load to finish',
      READER_RESULT_BOUND_MS,
    )
    // The earlier selection's late frame is applied on the tick after its load returns.
    await new Promise<void>((resolve) => setImmediate(resolve))
    const finalMoment = shownExtensionMoment(harness)
    const finalFrame = shownApplicationView(harness)?.frame

    // Assert
    assert.equal(lastView(harness)?.nodeHistoryPosition?.sequence, C)
    assert.equal(finalMoment.position, 'Frame · 0.35 s')
    assert.deepEqual([finalFrame?.width, finalFrame?.height], [800, 500])
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// protects=Previous event and Next stop move by the timeline, so a frame received before a pause but appended after it is visited before the stop; fails_when=stepping follows journal sequence and visits the frame after the stop; no_claim=Play pacing
test('Next event follows the timeline order when a frame was appended after the pause it was received before', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await writeExtensionHistoryFor(harness, [
      { at: 10, type: 'frame', kind: 'stream', salt: 'first' },
      { at: 100, type: 'open', pauseId: 'p1', stopIndex: 1, context: 'page' },
      {
        at: 105,
        type: 'frame',
        kind: 'stream',
        salt: 'late',
        capturedAtMs: 60,
      },
      { at: 200, type: 'close', pauseId: 'p1' },
    ])
    await openExtensionReplay(harness, history.studyId)
    await selectExtensionEvent(harness, history.studyId, 1)

    // Act
    harness.receiveContext({
      type: 'node-history-step',
      revision: lastView(harness)!.revision,
      studyId: history.studyId,
      direction: 'next',
      unit: 'event',
    })
    await waitUntil(
      () => lastView(harness)?.nodeHistoryPosition?.sequence === 3,
      'the late frame is next',
      READER_RESULT_BOUND_MS,
    )

    // Assert
    assert.equal(lastView(harness)?.nodeHistoryPosition?.sequence, 3)
    assert.equal(lastView(harness)?.nodeHistorySection?.nextStop, true)
  } finally {
    await harness.close()
  }
})

/** The learning material of {@link RUN}: a step citing the page capture, one citing the worker's pause, one citing the result. */
function runMaterial() {
  const step = (
    id: string,
    reference: ChromeExtensionLearningMaterialContent['steps'][number]['reference'],
  ) => ({
    id,
    from: 'extension',
    to: 'extension',
    label: `Step ${id}`,
    explanation: `Explains ${id}.`,
    evidence: 'observed' as const,
    reference,
  })
  return {
    question: 'Why does Save fail?',
    title: 'Saving a note',
    summary: 'The popup asks the worker to save and the page shows the answer.',
    participants: [{ id: 'extension', label: 'Extension' }],
    steps: [
      step('page-stop', {
        type: 'stop' as const,
        sequence: 3,
        sourceHash: sha256(POPUP_SOURCE_TEXT),
        context: 'page',
      }),
      step('worker-pause', {
        type: 'pause' as const,
        sequence: OPEN2,
        context: 'service-worker',
      }),
      step('result', { type: 'result' as const, sequence: 11 }),
    ],
  } satisfies ChromeExtensionLearningMaterialContent
}

/** Sends the control a summary step's action sends: its event and that step, then waits for the playhead to commit there. */
async function chooseStep(
  harness: Awaited<ReturnType<typeof workspaceHarness>>,
  studyId: string,
  stepId: string,
): Promise<number> {
  const sequence = lastView(
    harness,
  )?.nodeHistoryLearningSummary?.positions.find(
    (position) => position.stepId === stepId,
  )?.sequence
  assert.notEqual(sequence, undefined)
  harness.receiveContext({
    type: 'node-history-event',
    revision: lastView(harness)!.revision,
    studyId,
    sequence: sequence!,
    stepId,
  })
  await waitUntil(
    () =>
      lastView(harness)?.nodeHistoryPosition?.sequence === sequence &&
      !lastView(harness)?.nodeHistoryPosition?.pending,
    `the playhead commits at ${sequence}`,
    READER_RESULT_BOUND_MS,
  )
  return sequence!
}

// protects=a saved Extension replay opens with its processing summary, sequence and step explanations in the Learning summary, as a server replay does; fails_when=the open drops the saved material, shows the summary of another history or leaves the stop unexplained; no_claim=the diagram's drawing
test('opening a saved Extension replay shows its summary, sequence and step explanation', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await writeExtensionHistoryFor(harness, RUN)
    await repositoryOf(harness).extensionHistories.saveLearningMaterial(
      history.studyId,
      0,
      runMaterial(),
    )

    // Act
    await openExtensionReplay(harness, history.studyId)
    const summary = lastView(harness)?.nodeHistoryLearningSummary
    const section = lastView(harness)?.nodeHistorySection

    // Assert
    assert.equal(summary?.content.title, 'Saving a note')
    assert.equal(
      summary?.content.summary,
      'The popup asks the worker to save and the page shows the answer.',
    )
    assert.deepEqual(
      summary?.content.steps.map((step) => step.id),
      ['page-stop', 'worker-pause', 'result'],
    )
    assert.equal(section?.explanation, 'Explains page-stop.')
    assert.equal(section?.selectedStepId, 'page-stop')
  } finally {
    await harness.close()
  }
})

// protects=a step citing a page capture moves the playhead to that page stop's open, a step citing a pause to that pause and a step citing the result to the result; fails_when=a capture step leads nowhere (a capture is no timeline event), the result step stays on a stop or a step shows another step's text; no_claim=the diagram's drawing
test('steps citing a page capture, a pause and the result move the playhead to that stop and to the result', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await writeExtensionHistoryFor(harness, RUN)
    await repositoryOf(harness).extensionHistories.saveLearningMaterial(
      history.studyId,
      0,
      runMaterial(),
    )
    await openExtensionReplay(harness, history.studyId)

    // Act
    const atWorker = await chooseStep(harness, history.studyId, 'worker-pause')
    const workerExplanation = lastView(harness)?.nodeHistorySection?.explanation
    const atResult = await chooseStep(harness, history.studyId, 'result')
    const resultExplanation = lastView(harness)?.nodeHistorySection?.explanation
    const resultPosition = lastView(harness)?.nodeHistorySection?.position
    const atPage = await chooseStep(harness, history.studyId, 'page-stop')
    const pagePosition = lastView(harness)?.nodeHistorySection?.position

    // Assert
    assert.equal(atWorker, OPEN2)
    assert.equal(workerExplanation, 'Explains worker-pause.')
    assert.equal(atResult, 11)
    assert.equal(resultExplanation, 'Explains result.')
    assert.equal(resultPosition, 'Result · changed · 1.80 s')
    assert.equal(atPage, OPEN1)
    assert.equal(pagePosition, 'Page stop 1 · 0.10 s')
    assert.deepEqual(lastView(harness)?.nodeHistorySection?.stepActions, {
      'page-stop': 'Inspect page stop 1 · 0.10 s',
      'worker-pause': 'Inspect service worker stop 2 · 1.55 s',
      result: 'Inspect result · 1.80 s',
    })
  } finally {
    await harness.close()
  }
})

// protects=an Extension replay without saved material shows the recording alone: no summary, no explanation line and the plain stop count; fails_when=a missing material invents a summary or an "explained" count; no_claim=the wording of the no-summary line in the webview
test('an Extension replay without saved material shows its recording alone', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await writeExtensionHistoryFor(harness, RUN)

    // Act
    await openExtensionReplay(harness, history.studyId)
    const section = lastView(harness)?.nodeHistorySection

    // Assert
    assert.equal(lastView(harness)?.nodeHistoryLearningSummary, undefined)
    assert.equal(section?.explanation, undefined)
    assert.equal(section?.status, 'Result changed · capture complete · 2 stops')
  } finally {
    await harness.close()
  }
})

// protects=Open replay of an extension run that was just saved, before Saved studies lists it, opens the Extension replay and never the browser recording path; fails_when=the study is treated as an ordinary recording because only the catalog decides; no_claim=that the replay itself renders (the open entry is replaced)
test('Open replay of a just-saved extension run opens the Extension replay before the catalog lists it', async (context) => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const { service } = harness
    const run = new FakeChromeExtensionRuntime()
    service.environment.createChromeExtensionRun = async () => run
    const receipt = service.start({
      instanceId: service.instanceId,
      profile: CHROME_EXTENSION_PROFILE,
      key: 'saved',
      configuration: chromeExtensionConfigurationOf(harness),
    })
    const record = service.record(receipt)
    await record.preparation
    const studyId = `${service.instanceId}_${record.id}`
    const openRecording = context.mock.method(
      harness.reader,
      'openRecording',
      async () => undefined,
    )
    const openHistory = context.mock.method(
      harness.reader,
      'openNodeHistoryFromHost',
      async () => undefined,
    )

    // Act
    await harness.reader.openLearningReplay(studyId)

    // Assert
    assert.equal(openHistory.mock.callCount(), 1)
    assert.equal(openRecording.mock.callCount(), 0)
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// protects=reselecting the stop already shown after the learner ended the replay debugger presents the stop in a fresh debugger; fails_when=the shown stop counts as already presented natively, so the debugger stays stopped and Inspect, Select this stop and the event list do nothing; no_claim=the real debug session or Play and seeks (they report the stopped debugger and never restart it)
test('reselecting the shown extension stop after the learner ends the replay debugger presents it again', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await writeExtensionHistoryFor(harness, RUN)
    await openExtensionReplay(harness, history.studyId)
    const presentationsBefore = harness.historicalDebugPresentations.length

    // Act
    harness.endHistoricalDebugSession()
    await selectExtensionEvent(harness, history.studyId, OPEN1)
    await waitUntil(
      () =>
        harness.historicalDebugPresentations.length > presentationsBefore &&
        lastView(harness)?.nodeHistoryPosition?.debuggerAvailable === true,
      'the stop is presented in a fresh debugger',
      READER_RESULT_BOUND_MS,
    )

    // Assert
    assert.equal(
      lastView(harness)?.nodeHistoryPosition?.debuggerAvailable,
      true,
    )
  } finally {
    await harness.close()
  }
})

// protects=selecting the stop after Retry kept the learner's ended replay debugger stopped still restarts the debugger; fails_when=Retry records the stop as shown natively, so Select this stop skips the presentation and the debugger stays stopped against the guidance; no_claim=the real debug session or the Retry button's drawing
test('selecting a stop after Retry kept the ended replay debugger stopped presents it in a fresh debugger', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await writeExtensionHistoryFor(harness, RUN)
    await openExtensionReplay(harness, history.studyId)
    harness.endHistoricalDebugSession()
    // A source-slot row is on the pane, as after a slot that failed to open; Retry shows the moment again.
    harness.reader['report']('history-source', new Error('slot unavailable'))
    await harness.reader.action('retry')
    const presentationsBefore = harness.historicalDebugPresentations.length

    // Act
    await selectExtensionEvent(harness, history.studyId, OPEN1)
    await waitUntil(
      () =>
        harness.historicalDebugPresentations.length > presentationsBefore &&
        lastView(harness)?.nodeHistoryPosition?.debuggerAvailable === true,
      'the stop is presented in a fresh debugger',
      READER_RESULT_BOUND_MS,
    )

    // Assert
    assert.equal(
      harness.historicalDebugPresentations.length,
      presentationsBefore + 1,
    )
    assert.equal(
      lastView(harness)?.nodeHistoryPosition?.debuggerAvailable,
      true,
    )
  } finally {
    await harness.close()
  }
})

// protects=an Extension replay whose first debugger launch failed presents the same stop again when the learner reselects it; fails_when=the failed launch is remembered as a shown native moment and the reselect repaints nothing, leaving debuggerAvailable false; no_claim=the wording of the launch failure
test('reselecting the stop whose debugger launch failed starts the debugger again', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await writeExtensionHistoryFor(harness, RUN)
    harness.failNextHistoricalDebugPresentation(new Error('launch refused'))
    await openExtensionReplay(harness, history.studyId)
    assert.equal(
      lastView(harness)?.nodeHistoryPosition?.debuggerAvailable,
      false,
    )

    // Act
    await selectExtensionEvent(harness, history.studyId, OPEN1)
    await waitUntil(
      () => lastView(harness)?.nodeHistoryPosition?.debuggerAvailable === true,
      'the reselected stop is presented in the debugger',
      READER_RESULT_BOUND_MS,
    )

    // Assert
    assert.equal(harness.historicalDebugPresentations.length, 1)
    assert.equal(
      lastView(harness)?.nodeHistoryPosition?.debuggerAvailable,
      true,
    )
  } finally {
    await harness.close()
  }
})

// protects=a frame event inside a stop keeps the stop's inspection state (source available, debugger available) and accepts Inspect; fails_when=the frame inside the stop drops sourceAvailable and debuggerAvailable, or node-history-stop rejects the frame's sequence; no_claim=the debugger's drawing
test('a frame inside a stop keeps the stop inspection state and accepts Inspect', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await writeExtensionHistoryFor(harness, [
      { at: 10, type: 'open', pauseId: 'p1', stopIndex: 1, context: 'page' },
      {
        at: 11,
        type: 'capture',
        pauseId: 'p1',
        stopIndex: 1,
        context: 'page',
      },
      { at: 15, type: 'frame', kind: 'stream', salt: 'inside' },
      { at: 30, type: 'close', pauseId: 'p1' },
    ])
    await openExtensionReplay(harness, history.studyId)
    const FRAME_INSIDE_STOP = 3

    // Act
    await selectExtensionEvent(harness, history.studyId, FRAME_INSIDE_STOP)
    const inside = lastView(harness)?.nodeHistoryPosition
    harness.receiveContext({
      type: 'node-history-stop',
      revision: lastView(harness)!.revision,
      studyId: history.studyId,
      sequence: FRAME_INSIDE_STOP,
    })
    await waitUntil(
      () => lastView(harness)?.nodeHistoryPosition?.pending !== true,
      'the Inspect request settles',
      READER_RESULT_BOUND_MS,
    )

    // Assert
    assert.equal(inside?.sequence, FRAME_INSIDE_STOP)
    assert.equal(inside?.sourceAvailable, true)
    assert.equal(inside?.debuggerAvailable, true)
    assert.equal(lastView(harness)?.errors.length, 0)
  } finally {
    await harness.close()
  }
})

/** Material with the given steps, each citing the page capture at sequence 2 of a history that opens with one page stop. */
function pageStopMaterial(stepIds: string[]) {
  return {
    ...runMaterial(),
    steps: stepIds.map((id) => ({
      id,
      from: 'extension',
      to: 'extension',
      label: `Step ${id}`,
      explanation: `Explains ${id}.`,
      evidence: 'observed' as const,
      reference: {
        type: 'stop' as const,
        sequence: 2,
        sourceHash: sha256(POPUP_SOURCE_TEXT),
        context: 'page',
      },
    })),
  } satisfies ChromeExtensionLearningMaterialContent
}

// protects=a frame inside an explained stop keeps the stop's explanation and the learner's chosen step; fails_when=advancing to a frame event resolves the explanation with the frame's own sequence and drops the stop's explanation or the chosen step; no_claim=the webview's drawing
test('a frame inside an explained stop keeps the stop explanation and the chosen step', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await writeExtensionHistoryFor(harness, [
      { at: 10, type: 'open', pauseId: 'p1', stopIndex: 1, context: 'page' },
      {
        at: 11,
        type: 'capture',
        pauseId: 'p1',
        stopIndex: 1,
        context: 'page',
      },
      { at: 15, type: 'frame', kind: 'stream', salt: 'inside' },
      { at: 30, type: 'close', pauseId: 'p1' },
    ])
    await repositoryOf(harness).extensionHistories.saveLearningMaterial(
      history.studyId,
      0,
      pageStopMaterial(['first', 'second']),
    )
    await openExtensionReplay(harness, history.studyId)
    await chooseStep(harness, history.studyId, 'second')

    // Act
    await selectExtensionEvent(harness, history.studyId, 3)
    const section = lastView(harness)?.nodeHistorySection

    // Assert
    assert.equal(section?.explanation, 'Explains second.')
    assert.equal(section?.selectedStepId, 'second')
  } finally {
    await harness.close()
  }
})

// protects=when an inner stop closes while the outer stop continues, the outer stop's explanation shows; fails_when=the close event of the inner stop resolves no explanation for the outer stop; no_claim=the webview's drawing
test('the outer stop explanation returns when an inner stop closes inside it', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await writeExtensionHistoryFor(harness, [
      { at: 10, type: 'open', pauseId: 'outer', stopIndex: 1, context: 'page' },
      {
        at: 11,
        type: 'capture',
        pauseId: 'outer',
        stopIndex: 1,
        context: 'page',
      },
      {
        at: 20,
        type: 'open',
        pauseId: 'inner',
        stopIndex: 2,
        context: 'service-worker',
      },
      {
        at: 21,
        type: 'capture',
        pauseId: 'inner',
        stopIndex: 2,
        context: 'service-worker',
      },
      { at: 30, type: 'close', pauseId: 'inner' },
      { at: 40, type: 'close', pauseId: 'outer' },
    ])
    await repositoryOf(harness).extensionHistories.saveLearningMaterial(
      history.studyId,
      0,
      pageStopMaterial(['outer-stop']),
    )
    await openExtensionReplay(harness, history.studyId)

    // Act
    await selectExtensionEvent(harness, history.studyId, 5)
    const section = lastView(harness)?.nodeHistorySection

    // Assert
    assert.equal(section?.explanation, 'Explains outer-stop.')
    assert.equal(section?.selectedStepId, 'outer-stop')
  } finally {
    await harness.close()
  }
})

// protects=a seek onto a stop whose source is not recorded never starts a debugger the learner ended, so only an explicit reselection restarts it; fails_when=the seek presents the partial stop in a new debugger and debuggerAvailable returns to true; no_claim=the debugger's drawing or Play
test('seeking to a partial stop after the learner ends the replay debugger starts no new debugger', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await writeExtensionHistoryFor(harness, [
      { at: 10, type: 'open', pauseId: 'p1', stopIndex: 1, context: 'page' },
      {
        at: 11,
        type: 'capture',
        pauseId: 'p1',
        stopIndex: 1,
        context: 'page',
      },
      {
        at: 20,
        type: 'open',
        pauseId: 'p2',
        stopIndex: 2,
        context: 'service-worker',
      },
      {
        at: 21,
        type: 'capture',
        pauseId: 'p2',
        stopIndex: 2,
        context: 'service-worker',
        staleSource: true,
      },
    ])
    await openExtensionReplay(harness, history.studyId)
    harness.endHistoricalDebugSession()
    const presentationsBefore = harness.historicalDebugPresentations.length

    // Act
    harness.receiveContext({
      type: 'node-history-playback',
      revision: lastView(harness)!.revision,
      studyId: history.studyId,
      action: 'seek',
      positionMs: 20,
    })
    await waitUntil(
      () =>
        Boolean(
          lastView(harness)?.errors.some((error) =>
            /replay debugger was stopped/.test(error),
          ),
        ),
      'the seek reports why the partial stop was not presented',
      READER_RESULT_BOUND_MS,
    )

    // Assert
    assert.equal(
      harness.historicalDebugPresentations.length,
      presentationsBefore,
    )
    assert.equal(
      lastView(harness)?.nodeHistoryPosition?.debuggerAvailable,
      false,
    )
    assert.equal(lastView(harness)?.nodeHistoryPosition?.sequence, 1)
  } finally {
    await harness.close()
  }
})

// protects=the time slider of an Extension replay marks only the spans outside a recorded pause as unrecorded, and ticks each stop whose source is recorded; fails_when=the whole timeline is one gap although stops show source and values (the node-test projection that knows no pause interval), or the pauses' spans are not taken from pause-open and pause-close; no_claim=the slider's drawing
test('the timeline of an Extension replay marks the spans between recorded pauses as unrecorded and ticks the recorded stops', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await writeExtensionHistoryFor(harness, RUN)

    // Act
    await openExtensionReplay(harness, history.studyId)
    const timeline = lastView(harness)?.nodeHistorySection?.timeline

    // Assert
    assert.deepEqual(timeline, {
      startMs: 10,
      endMs: 1800,
      gaps: [
        { startMs: 10, endMs: 100 },
        { startMs: 200, endMs: 1550 },
        { startMs: 1700, endMs: 1800 },
      ],
      recordedPoints: [100, 1550],
    })
  } finally {
    await harness.close()
  }
})

// protects=an Extension replay that cannot be read is logged in Output › Codebook as open:extension-replay with the chrome-extension profile, and its notice names the saved question, never the raw study id or a test replay; fails_when=the entry names open:test-replay or node-test, or the notice shows the study id; no_claim=the notice's remaining wording
test('an Extension replay whose journal cannot be read is logged as open:extension-replay and named by its question', async (context) => {
  // Arrange
  const harness = await workspaceHarness()
  const logged: { surface?: string; studyId?: string; profile?: string }[] = []
  harness.reader.diagnostics = {
    log: (entry) => logged.push(entry),
    show: () => undefined,
  }
  try {
    const history = await writeExtensionHistoryFor(harness, RUN, {
      question: 'Why does Save fail?',
    })
    await harness.reader.action('retry')
    context.mock.method(
      repositoryOf(harness).extensionHistories,
      'read',
      async () => {
        throw new Error('journal unreadable')
      },
    )

    // Act
    await harness.reader.openLearningReplay(history.studyId)
    await waitUntil(
      () => harness.errorMessages.length > 0,
      'the failure notice is shown',
      READER_RESULT_BOUND_MS,
    )

    // Assert
    assert.deepEqual(
      logged.map((entry) => [entry.surface, entry.studyId, entry.profile]),
      [['open:extension-replay', history.studyId, 'chrome-extension']],
    )
    assert.equal(
      harness.errorMessages[0]?.startsWith(
        'Codebook could not open the Extension replay "Why does Save fail?": journal unreadable.',
      ),
      true,
    )
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})
