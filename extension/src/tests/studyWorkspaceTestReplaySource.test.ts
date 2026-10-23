import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { NodeTestHistoryStore } from '../nodeTestHistoryStore'
import type { NodeTestSourceStop } from '../ownedNodeTestRun'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import type { CodebookDiagnostic } from '../utils/formatCodebookDiagnostic'

import {
  saveOneStopNodeHistory,
  workspaceHarness,
} from './studyWorkspaceHarness'
import { nodeTestHistoryHeader } from './utils/nodeTestHistoryFixture'

type Harness = Awaited<ReturnType<typeof workspaceHarness>>

const THEME_TEXT = 'const nextTheme = "dark";\n'
const THEME_NEXT_TEXT = 'export const applied = applyTheme(nextTheme);\n'
const PLACEHOLDER =
  '// Recorded source · Not recorded at this moment\n// The test journal holds no source state for this moment.\n'

/** The last view the reader posted to its panes. */
function lastView(harness: Harness) {
  return harness.postedMessages().slice(-1)[0]
}

/**
 * Lists the URIs of every editor tab that shows a test replay's recorded-source slot, in every group.
 * @param harness - The workspace harness.
 * @returns The slot tabs' URIs.
 * @example slotTabs(harness) // => ['codebook-source://…/node-history-slot/<studyId>/Captured-theme.ts']
 */
function slotTabs(harness: Harness): string[] {
  return harness.groups.flatMap((group) =>
    group.tabs.flatMap((tab) => {
      const input = tab.input as { uri?: { toString(): string } } | undefined
      const uri = input?.uri?.toString()
      return uri?.includes('/node-history-slot/') ? [uri] : []
    }),
  )
}

/**
 * Reads the end-of-line labels the reader last drew on a recorded-source slot; an empty list once it cleared them.
 * @param harness - The workspace harness.
 * @returns The label texts of the slot's last source identity decoration.
 * @example slotLabels(harness) // => ['  Recorded: src/theme.ts:1 · 0.20 s']
 */
function slotLabels(harness: Harness): string[] {
  const decoration = harness
    .sourceIdentityDecorations()
    .filter((call) => call.uri.includes('/node-history-slot/'))
    .at(-1)
  return (decoration?.ranges ?? []).map(
    (range) =>
      (range as { renderOptions?: { after?: { contentText?: string } } })
        .renderOptions?.after?.contentText ?? '',
  )
}

/**
 * Saves a sealed test replay whose two stops stop in two files: output 1, stop 2 in `src/theme.ts`, output 3, stop 4 in `src/theme-next.ts`, result 5.
 * @param store - The workspace's history store.
 * @returns The history's header.
 * @example const history = await saveTwoFileNodeHistory(harness.service.nodeHistoryStore!)
 */
async function saveTwoFileNodeHistory(store: NodeTestHistoryStore) {
  const oneStop = nodeTestHistoryHeader(store.workspaceKey)
  const nextSource = {
    path: 'src/theme-next.ts',
    hash: sha256(THEME_NEXT_TEXT),
    line: 1,
    column: 8,
  }
  const configuration = {
    ...oneStop.configuration,
    additionalStops: [
      {
        ...nextSource,
        anchorIndex: 0,
        inspections: oneStop.configuration.inspections,
      },
    ],
  }
  const history = {
    ...oneStop,
    configuration,
    configurationHash: sha256(JSON.stringify(configuration)),
  }
  const writer = await store.start(history)
  const stopIn = (
    index: number,
    elapsedMs: number,
    source: { path: string; hash: string; line: number; column: number },
    text: string,
  ): NodeTestSourceStop => ({
    index,
    runId: 'test-run',
    sessionId: 'test-session',
    threadId: 1,
    elapsedMs,
    worker: { pid: 1, processGroup: 1, workspace: '/private/test' },
    source,
    frame: { id: index + 1, name: 'applyTheme', line: 1, column: 1 },
    variables: [{ name: 'nextTheme', value: 'dark', variablesReference: 0 }],
    facts: [
      { path: 'nextTheme', mode: 'value', display: 'dark', type: 'string' },
    ],
    debuggerSnapshot: {
      version: 1,
      frames: [
        {
          name: 'applyTheme',
          line: 1,
          column: 1,
          source: { name: source.path, text, hash: sha256(text), line: 1 },
          scopes: [{ name: 'Local', variables: [0] }],
        },
      ],
      variables: [
        { name: 'nextTheme', value: 'dark', type: 'string', children: [] },
      ],
      limitations: [],
    },
  })
  await writer.appendOutput({
    sequence: 1,
    elapsedMs: 100,
    channel: 'stdout',
    text: 'RUN src/theme.test.ts\n',
  })
  await writer.appendStop(
    stopIn(0, 200, history.configuration.source, THEME_TEXT),
  )
  await writer.appendOutput({
    sequence: 2,
    elapsedMs: 250,
    channel: 'stdout',
    text: 'between stops\n',
  })
  await writer.appendStop(stopIn(1, 300, nextSource, THEME_NEXT_TEXT))
  await writer.appendResult(
    { exitCode: 0, signal: null, output: 'Tests 1 passed' },
    400,
  )
  await writer.finish('complete')
  return history
}

/**
 * Opens a saved test replay through Open replay and waits until it shows the given moment.
 * @param harness - The workspace harness.
 * @param studyId - The replay's study id.
 * @param sequence - The moment the open lands on.
 * @example await openReplayAt(harness, history.studyId, 2)
 */
async function openReplayAt(
  harness: Harness,
  studyId: string,
  sequence: number,
): Promise<void> {
  await harness.reader.action('retry')
  await harness.reader.openLearningReplay(studyId)
  await waitUntil(
    () =>
      lastView(harness)?.nodeHistoryPosition?.sequence === sequence &&
      !lastView(harness)?.loading,
    `the test replay shows sequence ${sequence}`,
    2_000,
  )
}

/**
 * Selects one moment of the open test replay as the Study pane's event list does, and waits until the reader shows it.
 * @param harness - The workspace harness.
 * @param studyId - The replay's study id.
 * @param sequence - The moment to select.
 * @example await selectMoment(harness, history.studyId, 3)
 */
async function selectMoment(
  harness: Harness,
  studyId: string,
  sequence: number,
): Promise<void> {
  harness.receiveContext({
    type: 'node-history-event',
    revision: lastView(harness)!.revision,
    studyId,
    sequence,
  })
  await waitUntil(
    () => lastView(harness)?.nodeHistoryPosition?.sequence === sequence,
    `sequence ${sequence} is selected`,
    2_000,
  )
}

// Value: protects=a verified stop of a test replay shows in one Codebook-owned recorded-source slot named after the stop's file, holding the stop's sealed source with its recorded label, and the replay debugger's frames open that slot on the thread `Recorded test stop <n> · <path>:<line>`; fails_when=the stop opens a document per stop, the slot holds other bytes or no label, or the debugger's frames name another document or the old "Recorded Node test stop" thread; why_new=PR-B2's recorded-source slot (Design 4, DS5, DS14, AC6); seam=none; no_claim=how the native editor draws the label or reveals the line (the source-slot spike and N49)
test('a test replay’s verified stop shows its sealed source in one recorded-source slot that the debugger’s frames open', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await saveOneStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )

    // Act
    await openReplayAt(harness, history.studyId, 2)

    // Assert
    const tabs = slotTabs(harness)
    assert.equal(tabs.length, 1)
    assert.match(
      tabs[0]!,
      new RegExp(`/node-history-slot/${history.studyId}/Captured-theme\\.ts$`),
    )
    assert.equal(await harness.readCapturedSource(tabs[0]!), THEME_TEXT)
    assert.deepEqual(slotLabels(harness), [
      '  Recorded: src/theme.ts:1 · 0.20 s',
    ])
    const presentation = harness.historicalDebugPresentations.at(-1)!
    assert.equal(presentation.label, 'Recorded test stop 1 · src/theme.ts:1')
    assert.equal(presentation.sourceDocument?.uri, tabs[0])
    assert.equal(presentation.sourceDocument?.hash, sha256(THEME_TEXT))
  } finally {
    await harness.close()
  }
})

// Value: protects=moving from a stop to an output and on to the result keeps the one slot tab and shows the 4A placeholder there with no stopped line or label, while the debugger reads "Not recorded at this moment"; fails_when=an output or the result keeps the earlier stop's source, line or label in the slot, opens a second tab, or leaves the stop on the debugger; why_new=4A for the recorded source (Design 4, AC6; PRODUCT_GOAL partial history); seam=none; no_claim=the Study pane's 4A line, which PR-B1's section tests cover
test('an output and the result after a stop show the 4A placeholder in the same slot and no stop in the debugger', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await saveOneStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await openReplayAt(harness, history.studyId, 2)
    const slot = slotTabs(harness)[0]!

    // Act
    await selectMoment(harness, history.studyId, 3)

    // Assert
    assert.deepEqual(slotTabs(harness), [slot])
    assert.equal(await harness.readCapturedSource(slot), PLACEHOLDER)
    assert.deepEqual(slotLabels(harness), [])
    assert.equal(
      harness.historicalDebugInvalidationLabels().at(-1),
      'Not recorded at this moment',
    )
    assert.equal(
      lastView(harness)?.nodeHistoryPosition?.debuggerAvailable,
      undefined,
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a stop in another file renames the slot after that file and closes the tab Codebook opened before, so moving across files and back leaves one slot tab, and each stop shows its own file's sealed bytes and label; fails_when=a tab per stop or per file stays open, the renamed slot serves the earlier file's bytes, or the label names the earlier stop; why_new=DS5's rename rule (Design 4, AC6); seam=none; no_claim=a tab the learner pinned or edited, which the rename never closes
test('a stop in another file renames the slot and closes the earlier slot tab', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await saveTwoFileNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await openReplayAt(harness, history.studyId, 2)

    // Act
    await selectMoment(harness, history.studyId, 4)
    const afterRename = slotTabs(harness)
    const labelsAfterRename = slotLabels(harness)
    await selectMoment(harness, history.studyId, 2)

    // Assert
    assert.equal(afterRename.length, 1)
    assert.match(afterRename[0]!, /\/Captured-theme-next\.ts$/)
    assert.equal(await harness.readCapturedSource(afterRename[0]!), PLACEHOLDER)
    assert.deepEqual(labelsAfterRename, [
      '  Recorded: src/theme-next.ts:1 · 0.30 s',
    ])
    const back = slotTabs(harness)
    assert.equal(back.length, 1)
    assert.match(back[0]!, /\/Captured-theme\.ts$/)
    assert.equal(await harness.readCapturedSource(back[0]!), THEME_TEXT)
    assert.deepEqual(slotLabels(harness), [
      '  Recorded: src/theme.ts:1 · 0.20 s',
    ])
  } finally {
    await harness.close()
  }
})

// Value: protects=a test replay that opens on its result (its saved position) shows the 4A placeholder in a slot named after its first verified stop's file and starts the debugger on the "Not recorded at this moment" thread; fails_when=the open shows no slot, names it after the test file although a stop verifies, or starts no debugger; why_new=Design 4's opening on an output or the result; seam=none; no_claim=a replay none of whose stops verifies, named after its test file (nodeSourceSlotName's unit test)
test('a test replay that opens on its result shows the placeholder slot named after its first verified stop’s file', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const store = harness.service.nodeHistoryStore!
    const history = await saveOneStopNodeHistory(store)
    await store.saveReaderPosition(history.studyId, 3)

    // Act
    await openReplayAt(harness, history.studyId, 3)

    // Assert
    const tabs = slotTabs(harness)
    assert.equal(tabs.length, 1)
    assert.match(tabs[0]!, /\/Captured-theme\.ts$/)
    assert.equal(await harness.readCapturedSource(tabs[0]!), PLACEHOLDER)
    assert.deepEqual(
      harness.historicalDebugPresentations.map(({ snapshot, label }) => ({
        snapshot,
        label,
      })),
      [{ snapshot: undefined, label: 'Not recorded at this moment' }],
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the selection order (EN8): while the next stop's debugger presentation still loads, the slot already holds that stop's bytes with no stopped line or label and the Study position stays on the earlier moment; once the debugger shows the stop, the slot's label and the Study position commit together; fails_when=the slot keeps the earlier stop's label beside the next stop's debugger, or the Study position moves before the debugger shows the stop; why_new=Design 4's order (old moment left first, slot text confirmed before the debugger, commit after it; AC6); seam=the workspace harness's held historical debug presentation (a slow debugger); no_claim=the native frames of the transition, which N49 part 7 reviews
test('while the next stop’s debugger still loads, the slot shows no earlier stop’s label and the Study position waits', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await saveTwoFileNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await openReplayAt(harness, history.studyId, 2)
    const held = harness.holdHistoricalDebugPresentation(true)

    // Act
    harness.receiveContext({
      type: 'node-history-event',
      revision: lastView(harness)!.revision,
      studyId: history.studyId,
      sequence: 4,
    })
    await held.started
    const slotDuringLoad = slotTabs(harness)
    const labelsDuringLoad = slotLabels(harness)
    const positionDuringLoad = lastView(harness)?.nodeHistoryPosition?.sequence
    held.release()
    await waitUntil(
      () => lastView(harness)?.nodeHistoryPosition?.sequence === 4,
      'the second stop commits',
      2_000,
    )

    // Assert
    assert.equal(slotDuringLoad.length, 1)
    assert.equal(
      await harness.readCapturedSource(slotDuringLoad[0]!),
      THEME_NEXT_TEXT,
    )
    assert.deepEqual(labelsDuringLoad, [])
    assert.equal(positionDuringLoad, 2)
    assert.deepEqual(slotLabels(harness), [
      '  Recorded: src/theme-next.ts:1 · 0.30 s',
    ])
  } finally {
    await harness.close()
  }
})

// Value: protects=the debugger is presented only once the slot's document shows the stop's bytes, so its frame never points at a line of earlier text; fails_when=the debugger presentation starts while the slot's document still shows the placeholder; why_new=Design 4's order, step 2 before step 3 (slotReady, AC6); seam=the workspace harness's held delivery of a provider result to the open slot document (a delay between the slot's bytes and the frames); no_claim=how long the native editor takes to apply a provider result
test('the debugger is presented at a stop only after the slot’s document shows that stop’s bytes', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const store = harness.service.nodeHistoryStore!
    const history = await saveOneStopNodeHistory(store)
    await store.saveReaderPosition(history.studyId, 1)
    await openReplayAt(harness, history.studyId, 1)
    const presentationsBefore = harness.historicalDebugPresentations.length
    const heldUpdate = harness.holdNextSourceUpdate()

    // Act
    harness.receiveContext({
      type: 'node-history-event',
      revision: lastView(harness)!.revision,
      studyId: history.studyId,
      sequence: 2,
    })
    await heldUpdate.started
    const presentationsWhileHeld = harness.historicalDebugPresentations.length
    heldUpdate.release()
    await waitUntil(
      () => lastView(harness)?.nodeHistoryPosition?.sequence === 2,
      'the stop commits',
      2_000,
    )

    // Assert
    assert.equal(presentationsWhileHeld, presentationsBefore)
    assert.equal(
      harness.historicalDebugPresentations.at(-1)?.label,
      'Recorded test stop 1 · src/theme.ts:1',
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the reader position is written after the commit: a slow position write never holds the shown moment back; fails_when=the Study position waits for the write; why_new=Design 4's order (the position persisted after the commit, never awaited before it; AC6); seam=the history store's position write, held by the test; no_claim=the write's outcome, which the position tests cover
test('a slow reader position write does not hold the selected moment back', async (context) => {
  // Arrange
  const harness = await workspaceHarness()
  let releaseWrite = (): void => {}
  // The held writes, awaited before the harness removes its folders, so no late write lands in a folder being removed.
  const heldWrites: Promise<unknown>[] = []
  try {
    const store = harness.service.nodeHistoryStore!
    const history = await saveOneStopNodeHistory(store)
    await openReplayAt(harness, history.studyId, 2)
    const writeHeld = new Promise<void>((resolve) => {
      releaseWrite = resolve
    })
    const save = store.saveReaderPosition.bind(store)
    context.mock.method(
      store,
      'saveReaderPosition',
      (...args: Parameters<NodeTestHistoryStore['saveReaderPosition']>) => {
        const write = writeHeld.then(() => save(...args))
        heldWrites.push(write)
        return write
      },
    )

    // Act
    harness.receiveContext({
      type: 'node-history-event',
      revision: lastView(harness)!.revision,
      studyId: history.studyId,
      sequence: 3,
    })
    await waitUntil(
      () => lastView(harness)?.nodeHistoryPosition?.sequence === 3,
      'the result commits while its position write is held',
      2_000,
    )

    // Assert
    assert.match(
      lastView(harness)?.nodeHistorySection?.position ?? '',
      /^Result /,
    )
  } finally {
    releaseWrite()
    await Promise.allSettled(heldWrites)
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=two quick selections show only the last one: the first selection, overtaken while its debugger presentation loads, commits nothing, and the slot, its label and the Study position all show the last moment; fails_when=the overtaken stop's label, slot bytes or Study position appear after the later selection; why_new=Design 4's generations (rapid seeks, AC6); seam=the workspace harness's held historical debug presentation; no_claim=Play's own pacing (the timeline and pacing tests)
test('a stop selection overtaken by an output selection leaves only the output on every surface', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await saveTwoFileNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await openReplayAt(harness, history.studyId, 2)
    const held = harness.holdHistoricalDebugPresentation(true)
    harness.receiveContext({
      type: 'node-history-event',
      revision: lastView(harness)!.revision,
      studyId: history.studyId,
      sequence: 4,
    })
    await held.started

    // Act
    harness.receiveContext({
      type: 'node-history-event',
      revision: lastView(harness)!.revision,
      studyId: history.studyId,
      sequence: 3,
    })
    await waitUntil(
      () => lastView(harness)?.nodeHistoryPosition?.sequence === 3,
      'the output commits',
      2_000,
    )
    held.reject(new Error('Historical debugger presentation was superseded.'))
    await new Promise((resolve) => setImmediate(resolve))

    // Assert
    assert.equal(lastView(harness)?.nodeHistoryPosition?.sequence, 3)
    const tabs = slotTabs(harness)
    assert.equal(tabs.length, 1)
    assert.equal(await harness.readCapturedSource(tabs[0]!), PLACEHOLDER)
    assert.deepEqual(slotLabels(harness), [])
    assert.equal(lastView(harness)?.errors.length, 0)
  } finally {
    await harness.close()
  }
})

// Value: protects=a recorded-source slot that cannot open is told in the Study pane with the stop's number and the cause, written once to Output › Codebook, and leaves the moment selected with no stop on the debugger; Retry opens the slot again and retires the row; fails_when=the failure is silent, names no stop, writes no entry, keeps the earlier moment, or Retry leaves the row or renders a saved study's source instead; why_new=S2-1 for the slot (Design 4, the String catalog's open failure, AC17); seam=the workspace harness's injected failure of a non-file document open; no_claim=a slot that opens but whose bytes do not show within the bound (the same row, by NODE_HISTORY_TRANSITION_BOUND_MS)
test('a recorded-source slot that cannot open is told with its stop and cause, and Retry opens it again', async () => {
  // Arrange
  const harness = await workspaceHarness()
  const logged: CodebookDiagnostic[] = []
  harness.reader.diagnostics = {
    log: (entry) => logged.push(entry),
    show: () => undefined,
  }
  try {
    const store = harness.service.nodeHistoryStore!
    const history = await saveOneStopNodeHistory(store)
    await store.saveReaderPosition(history.studyId, 1)
    await openReplayAt(harness, history.studyId, 1)
    harness.failCurrentSourceOpen()

    // Act
    await selectMoment(harness, history.studyId, 2)
    const failedView = lastView(harness)!
    harness.restoreCurrentSourceOpen()
    await harness.reader.action('retry')

    // Assert
    assert.equal(failedView.nodeHistoryPosition?.sequence, 2)
    assert.equal(failedView.nodeHistoryPosition?.debuggerAvailable, false)
    assert.ok(
      failedView.errors.includes(
        'Codebook could not open the recorded source of stop 1: Injected current source open failure. Details: Output › Codebook.',
      ),
    )
    assert.deepEqual(
      logged.map(({ surface, studyId, profile, cause }) => ({
        surface,
        studyId,
        profile,
        cause,
      })),
      [
        {
          surface: 'open:recorded-source',
          studyId: history.studyId,
          profile: 'node-test',
          cause: 'Injected current source open failure',
        },
      ],
    )
    assert.equal(lastView(harness)?.errors.length, 0)
    assert.equal(lastView(harness)?.nodeHistoryPosition?.sequence, 2)
    assert.equal(
      await harness.readCapturedSource(slotTabs(harness)[0]!),
      THEME_TEXT,
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a slot whose document never shows the selected stop's bytes within the bound is told as an open failure with Retry, and the debugger shows no stop of the earlier moment; fails_when=the selection waits forever, presents the debugger at stale text, or commits silently without the history-source row; why_new=the bound path of EN8 step 2 (the open-failure test covers only a failing open); seam=the workspace harness's held delivery of a provider result to the open slot document; no_claim=the real editor's delivery latency
test('a slot that does not show a stop’s bytes within the bound is told as an open failure and presents no stop', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const store = harness.service.nodeHistoryStore!
    const history = await saveOneStopNodeHistory(store)
    await store.saveReaderPosition(history.studyId, 1)
    await openReplayAt(harness, history.studyId, 1)
    const presentationsBefore = harness.historicalDebugPresentations.length
    const heldUpdate = harness.holdNextSourceUpdate()

    // Act
    harness.receiveContext({
      type: 'node-history-event',
      revision: lastView(harness)!.revision,
      studyId: history.studyId,
      sequence: 2,
    })
    await heldUpdate.started
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistoryPosition?.sequence === 2 &&
        (lastView(harness)?.errors.length ?? 0) > 0,
      'the selection reports that the slot did not show its bytes',
      4_000,
    )
    heldUpdate.release()

    // Assert
    assert.equal(
      lastView(harness)?.errors.includes(
        'Codebook could not open the recorded source of stop 1: Timed out waiting for the recorded source of this moment. Details: Output › Codebook.',
      ),
      true,
    )
    assert.equal(
      lastView(harness)?.nodeHistoryPosition?.debuggerAvailable,
      false,
    )
    assert.equal(
      harness.historicalDebugPresentations.length,
      presentationsBefore,
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=leaving a test replay for Live closes the recorded-source slot Codebook opened; fails_when=the slot's tab stays after its replay is retired; why_new=Design 4 (`retireNodeHistorySelection` closes the slot); seam=none; no_claim=a slot tab the learner pinned, which stays
test('returning to Live closes the test replay’s recorded-source slot', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await saveOneStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await openReplayAt(harness, history.studyId, 2)
    const openedSlots = slotTabs(harness)

    // Act
    await harness.reader['retireNodeHistorySelection']()

    // Assert
    assert.equal(openedSlots.length, 1)
    assert.deepEqual(slotTabs(harness), [])
  } finally {
    await harness.close()
  }
})

// Value: protects=a rename the learner overtakes before the renamed slot's document opens still leaves one slot tab, the newer moment's, with that moment's placeholder; fails_when=the earlier file's slot tab stays open beside the newer slot because the overtaken rename never reached its close; why_new=PR-B2 /ship Step 9 state-machines review (critical: an orphan slot tab, cell verified-stop × overtaken during a rename); seam=the workspace harness's held native open of the renamed slot's document; no_claim=a slot tab the learner pinned or edited, which stays
test('a rename overtaken before its slot opens leaves one slot tab, the newer moment’s', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await saveTwoFileNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await openReplayAt(harness, history.studyId, 2)
    const renamedSlot = slotTabs(harness)[0]!.replace(
      /Captured-theme\.ts$/,
      'Captured-theme-next.ts',
    )
    const heldOpen = harness.holdNextSource({ uri: renamedSlot })
    harness.receiveContext({
      type: 'node-history-event',
      revision: lastView(harness)!.revision,
      studyId: history.studyId,
      sequence: 4,
    })
    await heldOpen.started

    // Act
    await selectMoment(harness, history.studyId, 3)
    heldOpen.release()
    await new Promise((resolve) => setImmediate(resolve))

    // Assert
    assert.deepEqual(slotTabs(harness), [renamedSlot])
    assert.equal(await harness.readCapturedSource(renamedSlot), PLACEHOLDER)
    assert.equal(lastView(harness)?.nodeHistoryPosition?.sequence, 3)
  } finally {
    await harness.close()
  }
})

// Value: protects=a rename whose slot cannot open leaves the earlier file's slot tab only until the next moment shows its slot, which closes it, so a failed rename never keeps a second slot tab; fails_when=the earlier slot tab stays beside the renamed slot after the next moment, because the failed rename never closed it and the next moment kept the slot's name; why_new=PR-B2 /ship Step 9 state-machines review (critical: an orphan slot tab, cell failed open × rename); seam=the workspace harness's injected failure of a non-file document open; no_claim=the failure row itself (the open-failure test)
test('a rename whose slot cannot open leaves no earlier slot tab once the next moment shows', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await saveTwoFileNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await openReplayAt(harness, history.studyId, 2)
    const earlierSlot = slotTabs(harness)[0]!
    harness.failCurrentSourceOpen()
    await selectMoment(harness, history.studyId, 4)
    harness.restoreCurrentSourceOpen()

    // Act
    await selectMoment(harness, history.studyId, 3)

    // Assert
    const tabs = slotTabs(harness)
    assert.equal(tabs.length, 1)
    assert.notEqual(tabs[0], earlierSlot)
    assert.match(tabs[0]!, /\/Captured-theme-next\.ts$/)
    assert.equal(await harness.readCapturedSource(tabs[0]!), PLACEHOLDER)
  } finally {
    await harness.close()
  }
})

// Value: protects=returning to Live while a renamed slot's document still opens closes every slot tab of the retired replay, the earlier file's included; fails_when=the retire closes only the renamed slot, which had no tab yet, and the earlier file's slot tab stays open with no replay behind it; why_new=PR-B2 /ship Step 9 state-machines review (critical: an orphan slot tab, retire during a pending rename); seam=the workspace harness's held native open of the renamed slot's document; no_claim=a slot tab the learner pinned or edited, which stays
test('returning to Live while a renamed slot still opens closes every slot tab of the replay', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await saveTwoFileNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await openReplayAt(harness, history.studyId, 2)
    const renamedSlot = slotTabs(harness)[0]!.replace(
      /Captured-theme\.ts$/,
      'Captured-theme-next.ts',
    )
    const heldOpen = harness.holdNextSource({ uri: renamedSlot })
    harness.receiveContext({
      type: 'node-history-event',
      revision: lastView(harness)!.revision,
      studyId: history.studyId,
      sequence: 4,
    })
    await heldOpen.started

    // Act
    await harness.reader['retireNodeHistorySelection']()
    heldOpen.release()
    await new Promise((resolve) => setImmediate(resolve))

    // Assert
    assert.deepEqual(slotTabs(harness), [])
  } finally {
    await harness.close()
  }
})

/**
 * Reads what an editor tab shows: a text document's URI, a webview's view type, or its label.
 * @param tab - A tab of the fake editor.
 * @returns The URI, the view type or the label.
 * @example tabIdentity(tab) // => 'codebook-source://…/node-history-slot/<studyId>/Captured-theme.ts'
 */
function tabIdentity(tab: Harness['groups'][number]['tabs'][number]): string {
  const input = tab.input as
    { uri?: { toString(): string }; viewType?: string } | undefined
  return input?.uri?.toString() ?? input?.viewType ?? tab.label
}

// Value: protects=a slot renamed for a stop in another file opens in the group that held the earlier slot before Codebook closes the earlier tab, so a source group the slot alone filled stays and no other pane's group receives the slot; fails_when=the earlier tab closes first, the editor (with `workbench.editor.closeEmptyGroups` on) removes the emptied group, and the renamed slot opens in another group; why_new=PR-B2's own OCR review (the rename's order); seam=the workspace harness's native layout with its closeEmptyGroups model (useNativeLayout, closeDisposedPanelTabsLater) and the test taking the article's source tab out of the slot's group, so the slot fills it alone; no_claim=a group the learner locked or pinned
test('a slot renamed for another file stays in its own group when it alone filled that group', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] })
    harness.closeDisposedPanelTabsLater()
    const history = await saveTwoFileNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await openReplayAt(harness, history.studyId, 2)
    const slotGroup = harness.groups.find((group) =>
      group.tabs.some((tab) =>
        tabIdentity(tab).includes('/node-history-slot/'),
      ),
    )!
    // The slot alone fills its group: the article's source tab that the Study's open also showed there is taken out.
    const slotTab = slotGroup.tabs.find((tab) =>
      tabIdentity(tab).includes('/node-history-slot/'),
    )!
    slotGroup.tabs.splice(0, slotGroup.tabs.length, slotTab)
    slotGroup.activeTab = slotTab
    const groupsBefore = harness.groups.map((group) =>
      group.tabs.map(tabIdentity),
    )

    // Act
    await selectMoment(harness, history.studyId, 4)

    // Assert
    const groupsAfter = harness.groups.map((group) =>
      group.tabs.map(tabIdentity),
    )
    assert.equal(groupsAfter.length, groupsBefore.length)
    const slotGroupIndex = groupsBefore.findIndex((tabs) =>
      tabs.some((tab) => tab.includes('/node-history-slot/')),
    )
    assert.equal(groupsAfter[slotGroupIndex]!.length, 1)
    assert.match(groupsAfter[slotGroupIndex]![0]!, /\/Captured-theme-next\.ts$/)
  } finally {
    await harness.close()
  }
})

// Value: protects=a slot tab of another replay (one an editor restart restored or an earlier replay left) is closed when the open replay shows its slot, so only the open replay's slot tab stays; fails_when=the close skips slot tabs of other study ids and the stale tab stays beside the slot; why_new=the unit test of isNodeSourceSlotPath covers the path only, no workspace test plants a foreign slot tab; seam=none (the fake editor's showTextDocument as the learner's restored tab); no_claim=a slot tab the learner pinned or edited, which stays
test('a slot tab of another replay is closed once the open replay shows its slot', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await saveTwoFileNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await openReplayAt(harness, history.studyId, 2)
    const openSlot = slotTabs(harness)[0]!
    const foreignSlot = openSlot.replace(
      `/${history.studyId}/Captured-theme.ts`,
      '/other-replay-study/Captured-old.ts',
    )
    const parsed = new URL(foreignSlot)
    await harness.editor.window.showTextDocument(
      new harness.editor.Uri(
        parsed.protocol.slice(0, -1),
        parsed.host,
        parsed.pathname,
      ),
      { viewColumn: 1, preserveFocus: true, preview: false },
    )
    assert.equal(slotTabs(harness).length, 2)

    // Act
    await selectMoment(harness, history.studyId, 3)

    // Assert
    assert.deepEqual(slotTabs(harness), [openSlot])
  } finally {
    await harness.close()
  }
})

// Value: protects=returning to Live after a slot that could not open leaves no slot tab and no recorded-source failure row in the Study pane; fails_when=the retire keeps the failed open's history-source row, which names a replay the learner left and offers a Retry that has nothing to retry; why_new=the open-failure test ends inside the replay, no test retires after a failure; seam=the workspace harness's injected failure of a non-file document open; no_claim=the Retry wording
test('returning to Live after a recorded-source slot failed to open leaves no failure row behind', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const store = harness.service.nodeHistoryStore!
    const history = await saveOneStopNodeHistory(store)
    await store.saveReaderPosition(history.studyId, 1)
    await openReplayAt(harness, history.studyId, 1)
    harness.failCurrentSourceOpen()
    await selectMoment(harness, history.studyId, 2)
    harness.restoreCurrentSourceOpen()
    assert.equal(lastView(harness)?.errors.length, 1)

    // Act
    await harness.reader.action('return-current')

    // Assert
    assert.deepEqual(slotTabs(harness), [])
    assert.equal(lastView(harness)?.errors.length, 0)
  } finally {
    await harness.close()
  }
})

// Value: protects=returning to Live from a moment that shows the placeholder (an output) closes the placeholder's slot tab; fails_when=the retire closes the slot tab only when it held a verified stop; why_new=the retire test starts from a verified stop; seam=none; no_claim=a slot tab the learner pinned or edited, which stays
test('returning to Live closes the recorded-source slot a placeholder moment showed', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const store = harness.service.nodeHistoryStore!
    const history = await saveOneStopNodeHistory(store)
    await store.saveReaderPosition(history.studyId, 1)
    await openReplayAt(harness, history.studyId, 1)
    const openedSlots = slotTabs(harness)

    // Act
    await harness.reader['retireNodeHistorySelection']()

    // Assert
    assert.equal(openedSlots.length, 1)
    assert.deepEqual(slotTabs(harness), [])
  } finally {
    await harness.close()
  }
})

// Value: protects=returning to the shown moment that recorded no stop while a newer selection of a stop is still presenting that stop leaves the native debugger on no stop, so the stop's stack and values never stand beside a moment that recorded none (4A); fails_when=the return skips the leave because its moment is the committed one, and the debugger keeps the overtaken stop's frames; why_new=/ship Step 11 (Codex adversarial P1, Claude adversarial, Codex structured P2: the stale stack after a quick reversal); seam=the workspace harness's held historical debug presentation; no_claim=the native debugger's own drawing
test('returning to the shown output while a stop still presents leaves the debugger on no stop', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const store = harness.service.nodeHistoryStore!
    const history = await saveOneStopNodeHistory(store)
    await store.saveReaderPosition(history.studyId, 1)
    await openReplayAt(harness, history.studyId, 1)
    const held = harness.holdHistoricalDebugPresentation(true)
    harness.receiveContext({
      type: 'node-history-event',
      revision: lastView(harness)!.revision,
      studyId: history.studyId,
      sequence: 2,
    })
    await held.started
    const invalidationsWhileStopPresents =
      harness.historicalDebugInvalidations()

    // Act
    await harness.reader['selectNodeHistoryEvent'](
      harness.reader['selectedNodeHistory']!,
      1,
    )
    held.reject(new Error('Historical debugger presentation was superseded.'))
    await waitUntil(
      () => lastView(harness)?.nodeHistoryPosition?.sequence === 1,
      'the output stays selected',
      2_000,
    )

    // Assert
    assert.equal(
      harness.historicalDebugInvalidations(),
      invalidationsWhileStopPresents + 1,
    )
    assert.equal(
      harness.historicalDebugInvalidationLabels().at(-1),
      'Not recorded at this moment',
    )
    assert.equal(
      await harness.readCapturedSource(slotTabs(harness)[0]!),
      PLACEHOLDER,
    )
  } finally {
    await harness.close()
  }
})
