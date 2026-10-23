import assert from 'node:assert/strict'
import { realpath, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
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
import { READER_RESULT_BOUND_MS } from './utils/readerResultBound'

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
 * Counts the times the reader drew or cleared the end-of-line label of a recorded-source slot.
 * @param harness - The workspace harness.
 * @returns The number of source identity decoration calls on a slot document.
 * @example slotLabelDraws(harness) // => 3
 */
function slotLabelDraws(harness: Harness): number {
  return harness
    .sourceIdentityDecorations()
    .filter((call) => call.uri.includes('/node-history-slot/')).length
}

/**
 * Names the slot document the editor shows now as the editor's URI.
 * @param harness - The workspace harness.
 * @returns The slot tab's URI.
 * @example slotUri(harness).path // => '/node-history-slot/<studyId>/Captured-theme.ts'
 */
function slotUri(harness: Harness) {
  const parsed = new URL(slotTabs(harness)[0]!)
  return new harness.editor.Uri(
    parsed.protocol.slice(0, -1),
    parsed.host,
    parsed.pathname,
  )
}

/**
 * Brings a learner's file in front of the group that shows the slot, with the keyboard in another group, so the slot tab stays open but hidden, as when another action of the reader or the learner shows another tab there.
 * @param harness - The workspace harness.
 * @returns The group's view column, for {@link showSlotAgain}.
 * @example const column = await coverSlot(harness)
 */
async function coverSlot(harness: Harness): Promise<number> {
  const column = harness.groups.find((group) =>
    group.tabs.some((tab) =>
      (tab.input as { uri?: { toString(): string } } | undefined)?.uri
        ?.toString()
        .includes('/node-history-slot/'),
    ),
  )!.viewColumn
  // The keyboard stays in another group, so what the cover shows in the slot's group is not the active editor.
  harness.activateEditorGroup(
    harness.groups.find((group) => group.viewColumn !== column)!.viewColumn,
  )
  const cover = join(harness.directory, 'cover.txt')
  await writeFile(cover, 'a learner file\n')
  await harness.editor.window.showTextDocument(harness.editor.Uri.file(cover), {
    viewColumn: column,
    preserveFocus: true,
    preview: false,
  })
  return column
}

/**
 * Brings the slot tab back in front of its group, with or without the keyboard.
 * @param harness - The workspace harness.
 * @param column - The slot group's view column.
 * @param preserveFocus - `false` gives the slot the keyboard as a click on its tab does.
 * @example await showSlotAgain(harness, column, false)
 */
async function showSlotAgain(
  harness: Harness,
  column: number,
  preserveFocus: boolean,
): Promise<void> {
  await harness.editor.window.showTextDocument(slotUri(harness), {
    viewColumn: column,
    preserveFocus,
    preview: false,
  })
}

/**
 * Saves a sealed test replay whose two stops stop in two files: output 1, stop 2 in `src/theme.ts`, output 3, stop 4 in `src/theme-next.ts`, result 5.
 * @param store - The workspace's history store.
 * @param nextPath - The repository path of the second stop's file.
 * @param nextText - The second stop's sealed source.
 * @returns The history's header.
 * @example const history = await saveTwoFileNodeHistory(harness.service.nodeHistoryStore!, 'lib/theme.ts')
 */
async function saveTwoFileNodeHistory(
  store: NodeTestHistoryStore,
  nextPath = 'src/theme-next.ts',
  nextText = THEME_NEXT_TEXT,
) {
  const oneStop = nodeTestHistoryHeader(store.workspaceKey)
  const nextSource = {
    path: nextPath,
    hash: sha256(nextText),
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
  await writer.appendStop(stopIn(1, 300, nextSource, nextText))
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
    READER_RESULT_BOUND_MS,
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
    READER_RESULT_BOUND_MS,
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
      new RegExp(
        `/node-history-slot/${history.studyId}/25a6634263c1/Captured-theme\\.ts$`,
      ),
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
    // The renamed slot serves its stop's sealed source while that stop is shown, and only then.
    const bytesAtRename = await harness.readCapturedSource(afterRename[0]!)
    await selectMoment(harness, history.studyId, 2)

    // Assert
    assert.equal(afterRename.length, 1)
    assert.match(afterRename[0]!, /\/Captured-theme-next\.ts$/)
    assert.equal(bytesAtRename, THEME_NEXT_TEXT)
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
      READER_RESULT_BOUND_MS,
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

// Value: protects=every surface leaves the earlier moment in one step (D29, F203): while the next stop's debugger presentation is held, the debugger has been emptied once, the slot holds the new stop's bytes with no line or label, the Study position names the stop being selected with no explanation, and the Application header has no time; the commit then shows all of them together; fails_when=the Study position, its explanation or the Application header keep the earlier moment beside the new stop's slot, or the debugger keeps the earlier frames; why_new=N49 part 7's 0.1 to 0.6 s of mixed moments; seam=the workspace harness's held historical debug presentation; no_claim=the native frames of the transition, which the driving agent's N49 recheck reads
test('while the next stop’s debugger presentation is held, the Study position and the Application header have left the earlier moment', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await saveTwoFileNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await openReplayAt(harness, history.studyId, 2)
    const shownBefore = lastView(harness)?.nodeHistorySection
    const invalidationsBefore =
      harness.historicalDebugInvalidationLabels().length
    const held = harness.holdHistoricalDebugPresentation(true)

    // Act
    harness.receiveContext({
      type: 'node-history-event',
      revision: lastView(harness)!.revision,
      studyId: history.studyId,
      sequence: 4,
    })
    await held.started
    const duringSection = lastView(harness)?.nodeHistorySection
    const duringApplication = harness.applicationOutputs().at(-1)?.view
    const invalidationsDuring =
      harness.historicalDebugInvalidationLabels().length - invalidationsBefore
    const tabsDuring = slotTabs(harness)
    const labelsDuring = slotLabels(harness)
    held.release()
    await waitUntil(
      () => lastView(harness)?.nodeHistoryPosition?.sequence === 4,
      'the second stop commits',
      READER_RESULT_BOUND_MS,
    )

    // Assert
    assert.equal(shownBefore?.position, 'Stop 1 of 2 · 0.20 s')
    assert.equal(duringSection?.position, 'Stop 2 of 2 · 0.30 s')
    assert.equal(duringSection?.explanation, undefined)
    assert.equal(duringSection?.selectedStepId, undefined)
    assert.equal(duringApplication?.time, 'Recorded test output')
    assert.equal(duringApplication?.region, undefined)
    assert.equal(invalidationsDuring, 1)
    assert.equal(tabsDuring.length, 1)
    assert.deepEqual(labelsDuring, [])
    assert.equal(
      lastView(harness)?.nodeHistorySection?.position,
      'Stop 2 of 2 · 0.30 s',
    )
    assert.equal(
      harness.applicationOutputs().at(-1)?.view.time,
      'Recorded test output · 0.30 s',
    )
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
      READER_RESULT_BOUND_MS,
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
      READER_RESULT_BOUND_MS,
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
    const overtaken = harness.reader['requestNodeHistoryEvent'](
      harness.reader['selectedNodeHistory']!,
      4,
    )
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
      READER_RESULT_BOUND_MS,
    )
    held.reject(new Error('Historical debugger presentation was superseded.'))
    // The overtaken selection has ended, whatever it left behind.
    await overtaken

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

// Value: protects=Retry or Inspect on the moment already shown whose slot fails to open leaves the moment with no stop in the debugger and the slot's document at its loading text, so late bytes of the failed show cannot appear undecorated beside the failure row; fails_when=the failed branch leaves the debugger on the shown stop (no invalidation) or the slot document keeps the stop's bytes; why_new=F170 (the failed branch skipped the leave step because the moment did not change); seam=the workspace harness's injected failure of a non-file document open and its invalidation labels; no_claim=the wording of the failure row
test('a reselect of the shown stop whose slot fails to open empties the debugger and resets the slot to its loading text', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const store = harness.service.nodeHistoryStore!
    const history = await saveOneStopNodeHistory(store)
    await store.saveReaderPosition(history.studyId, 2)
    await openReplayAt(harness, history.studyId, 2)
    const invalidationsBefore =
      harness.historicalDebugInvalidationLabels().length
    harness.failCurrentSourceOpen()

    // Act
    await harness.reader['requestNodeHistoryEvent'](
      harness.reader['selectedNodeHistory']!,
      2,
    )

    // Assert
    assert.equal(
      harness.historicalDebugInvalidationLabels().length - invalidationsBefore,
      1,
    )
    assert.equal(
      lastView(harness)?.nodeHistoryPosition?.debuggerAvailable,
      false,
    )
    assert.equal(
      await harness.readCapturedSource(slotTabs(harness)[0]!),
      '// Loading recorded source…\n',
    )
    assert.deepEqual(slotLabels(harness), [])
  } finally {
    harness.restoreCurrentSourceOpen()
    await harness.close()
  }
})

// Value: protects=Retry answers each failure row with its own remedy while a test replay is shown (D43, F167): the layout, Application and reader rows get the render of the selection and no new selection of the moment, so Play is not paused and no debugger is restarted for them; fails_when=Retry selects the shown moment again for a row that is not the replay's own, so the render of the selection is lost; why_new=F167 (Retry re-selected the moment for every error kind); seam=the reader's error rows set by hand and a spy on the render of the selection; no_claim=what each render repairs
for (const row of ['layout', 'application', 'reader'] as const) {
  test(`Retry with a ${row} row while a test replay is shown renders the selection and does not select its moment again`, async () => {
    // Arrange
    const harness = await workspaceHarness()
    try {
      const history = await saveOneStopNodeHistory(
        harness.service.nodeHistoryStore!,
      )
      await openReplayAt(harness, history.studyId, 2)
      harness.reader['errors'].set(row, 'Injected failure')
      const render = harness.reader['renderSelection'].bind(harness.reader)
      let renders = 0
      harness.reader['renderSelection'] = (...args): Promise<void> => {
        renders++
        return render(...args)
      }
      const requestsBefore = harness.reader['selectedNodeHistoryRequest']

      // Act
      await harness.reader.action('retry')

      // Assert
      assert.equal(harness.reader['selectedNodeHistoryRequest'], requestsBefore)
      assert.ok(renders >= 1, 'the selection is rendered')
    } finally {
      await harness.close()
    }
  })
}

// Value: protects=Retry after a failed recorded-source slot reopens the slot and leaves a replay debugger the learner stopped stopped: no new presentation reaches the debugger, the slot shows the stop again with its line and label, and the failure row is gone; fails_when=Retry restarts the stopped debugger (a new presentation) or pauses Play for a row that is not about them; why_new=F167 (Retry re-selected with publish: true, which restarts a debugger the learner stopped); seam=the harness's injected failure of a non-file document open and its ended historical debugger session; no_claim=the wording of the failure row
test('Retry of a failed recorded-source slot reopens it and does not restart a debugger the learner stopped', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const store = harness.service.nodeHistoryStore!
    const history = await saveOneStopNodeHistory(store)
    await store.saveReaderPosition(history.studyId, 1)
    await openReplayAt(harness, history.studyId, 1)
    harness.failCurrentSourceOpen()
    await selectMoment(harness, history.studyId, 2)
    harness.endHistoricalDebugSession()
    harness.restoreCurrentSourceOpen()
    const presentationsBefore = harness.historicalDebugPresentations.length

    // Act
    await harness.reader.action('retry')

    // Assert
    assert.equal(
      harness.historicalDebugPresentations.length,
      presentationsBefore,
    )
    assert.equal(lastView(harness)?.errors.length, 0)
    assert.equal(
      await harness.readCapturedSource(slotTabs(harness)[0]!),
      THEME_TEXT,
    )
    assert.deepEqual(slotLabels(harness), [
      '  Recorded: src/theme.ts:1 · 0.20 s',
    ])
    assert.equal(
      lastView(harness)?.nodeHistoryPosition?.debuggerAvailable,
      false,
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a failure that comes out of Retry's selection of the shown moment is told on the replay-debugger row and does not fail the Retry; fails_when=the Retry rejects with the failure and the Study pane tells nothing; why_new=F167 (a debugger failure could throw out of the Retry handler); seam=the selection of a moment, made to throw once; no_claim=which failures can reach it
test('a failure from the selection Retry makes is told on the debugger row and does not fail Retry', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await saveOneStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await openReplayAt(harness, history.studyId, 2)
    harness.reader['errors'].set('history-source', 'Injected slot failure')
    harness.reader['requestNodeHistoryEvent'] = (): Promise<void> =>
      Promise.reject(new Error('Injected debugger failure'))

    // Act
    await harness.reader.action('retry')

    // Assert
    assert.deepEqual(
      [...(lastView(harness)?.errors ?? [])],
      ['Injected slot failure', 'Error: Injected debugger failure'],
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the selection of the committed moment after an overtaken selection took the surfaces off it leaves it again (F191): a stop selection withdrawn after its debugger presentation shows no earlier stop beside the Study position while the reselect of the committed stop presents; fails_when=the same-moment test compares with the last committed moment, so the reselect keeps the withdrawn stop's frames on the debugger until its own presentation ends; why_new=F191 (the same-moment test read the committed moment, not what the surfaces show); seam=the workspace harness's held historical debug presentations and the withdrawn caller's isCurrent; no_claim=the debugger's own redraw
test('a reselect of the committed stop after a withdrawn selection presented another stop empties the debugger first', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await saveTwoFileNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await openReplayAt(harness, history.studyId, 2)
    const selected = harness.reader['selectedNodeHistory']!
    let wanted = true
    const withdrawnHold = harness.holdHistoricalDebugPresentation(true)
    const withdrawn = harness.reader['requestNodeHistoryEvent'](selected, 4, {
      publish: false,
      alignPlayback: false,
      isCurrent: () => wanted,
    })
    await withdrawnHold.started
    wanted = false
    withdrawnHold.release()
    await waitUntil(
      () =>
        harness.historicalDebugPresentations.at(-1)?.label ===
        'Recorded test stop 2 · src/theme-next.ts:1',
      'the withdrawn selection presented the second stop',
      READER_RESULT_BOUND_MS,
    )
    const invalidationsBefore =
      harness.historicalDebugInvalidationLabels().length
    const reselectHold = harness.holdHistoricalDebugPresentation(true)

    // Act
    const reselect = harness.reader['requestNodeHistoryEvent'](selected, 2)
    await reselectHold.started
    const invalidationsWhileHeld =
      harness.historicalDebugInvalidationLabels().length - invalidationsBefore
    reselectHold.release()
    await Promise.all([withdrawn, reselect])

    // Assert
    assert.equal(invalidationsWhileHeld, 1)
    assert.equal(
      harness.historicalDebugPresentations.at(-1)?.label,
      'Recorded test stop 1 · src/theme.ts:1',
    )
    assert.deepEqual(slotLabels(harness), [
      '  Recorded: src/theme.ts:1 · 0.20 s',
    ])
  } finally {
    await harness.close()
  }
})

// Value: protects=the slot that shows its moment retires the failure row of the earlier try without a Study message of its own: the row leaves with the commit, so no message shows the moment half committed; fails_when=the show publishes when it clears the row, so the Study pane loses the failure beside a moment still waiting for its debugger; why_new=F191 (showNodeSourceSlot published before the commit); seam=the workspace harness's injected failure of a non-file document open and its held historical debug presentation; no_claim=the wording of the failure row
test('the failure row of a slot stays in the Study message until the retried moment commits', async () => {
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
    const held = harness.holdHistoricalDebugPresentation(true)

    // Act
    const retry = harness.reader['requestNodeHistoryEvent'](
      harness.reader['selectedNodeHistory']!,
      2,
    )
    await held.started
    const errorsWhileHeld = [...(lastView(harness)?.errors ?? [])]
    held.release()
    await retry

    // Assert
    assert.equal(errorsWhileHeld.length, 1)
    assert.match(
      errorsWhileHeld[0]!,
      /could not open the recorded source of stop 1/,
    )
    assert.equal(lastView(harness)?.errors.length, 0)
  } finally {
    await harness.close()
  }
})

// Value: protects=a slot whose document never shows the selected stop's bytes before the slot deadline is told as an open failure with Retry, and the debugger shows no stop of the earlier moment, also when the bytes land late; fails_when=the selection waits forever, presents the debugger at stale text, commits silently without the history-source row, or presents the stop once the late bytes land; why_new=the deadline path of EN8 step 2 (the open-failure test covers only a failing open); seam=the workspace harness's held delivery of a provider result to the open slot document and its hand-driven slot clock; no_claim=the real editor's delivery latency
test('a slot that does not show a stop’s bytes before the deadline is told as an open failure and presents no stop', async () => {
  // Arrange
  const harness = await workspaceHarness()
  let heldUpdate: ReturnType<Harness['holdNextSourceUpdate']> | undefined
  try {
    const store = harness.service.nodeHistoryStore!
    const history = await saveOneStopNodeHistory(store)
    await store.saveReaderPosition(history.studyId, 1)
    await openReplayAt(harness, history.studyId, 1)
    const presentationsBefore = harness.historicalDebugPresentations.length
    const deliveriesBefore = harness.sourceDocumentChanges().length
    const showsBefore = harness.textDocumentShows().length
    harness.useManualSlotClock()
    heldUpdate = harness.holdNextSourceUpdate()

    // Act
    startMomentSelection(harness, history.studyId, 2)
    await heldUpdate.started
    // The deadline passes while the slot waits for its bytes, not before the editor showed the document.
    await waitUntil(
      () => harness.textDocumentShows().length > showsBefore,
      'the editor shows the slot document',
      2_000,
    )
    await new Promise((resolve) => setImmediate(resolve))
    harness.elapseSlotClock(5_000)
    await waitUntil(
      () => lastView(harness)?.nodeHistoryPosition?.sequence === 2,
      'the selection reports that the slot did not show its bytes',
      2_000,
    )
    const errorsAtDeadline = [...(lastView(harness)?.errors ?? [])]
    heldUpdate.release()
    await waitUntil(
      () => harness.sourceDocumentChanges().length > deliveriesBefore,
      'the late bytes land in the slot document',
      2_000,
    )

    // Assert
    assert.deepEqual(errorsAtDeadline, [
      'Codebook could not open the recorded source of stop 1: Timed out waiting for the recorded source of this moment. Details: Output › Codebook.',
    ])
    assert.equal(
      lastView(harness)?.nodeHistoryPosition?.debuggerAvailable,
      false,
    )
    assert.equal(
      harness.historicalDebugPresentations.length,
      presentationsBefore,
    )
  } finally {
    heldUpdate?.release()
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
    const overtaken = harness.reader['requestNodeHistoryEvent'](
      harness.reader['selectedNodeHistory']!,
      4,
    )
    await heldOpen.started

    // Act
    await selectMoment(harness, history.studyId, 3)
    heldOpen.release()
    // The overtaken selection has ended, whatever it left behind.
    await overtaken

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
    const overtaken = harness.reader['requestNodeHistoryEvent'](
      harness.reader['selectedNodeHistory']!,
      4,
    )
    await heldOpen.started

    // Act
    await harness.reader['retireNodeHistorySelection']()
    heldOpen.release()
    // The overtaken selection has ended, whatever it left behind.
    await overtaken

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
      `/${history.studyId}/25a6634263c1/Captured-theme.ts`,
      '/other-replay-study/25a6634263c1/Captured-old.ts',
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
      READER_RESULT_BOUND_MS,
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

// Value: protects=a Play step or seek whose caller withdrew it after its recorded-source slot showed the next stop, with no newer selection to follow, leaves no surface on that stop: the slot shows the committed stop's sealed source again with its stopped line and label, and the replay debugger shows the committed stop, beside the Study position that stayed there; fails_when=the withdrawn selection returns after the slot and the debugger moved, so the slot holds another stop's source (and the debugger its frames) while the Study pane names the committed stop; why_new=F351 (hosted CodeRabbit on #120, Major); seam=the workspace harness's held document open of the next stop's slot, with the caller's isCurrent turned false while the open is held; no_claim=the controller paths that withdraw a step (a seek selects its own moment at once, a close or a browser recording retires the replay)
test('a Play step withdrawn after its slot showed the next stop shows the committed stop again in the slot and the debugger', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await saveTwoFileNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await openReplayAt(harness, history.studyId, 2)
    const selected = harness.reader['selectedNodeHistory']!
    let wanted = true
    const held = harness.holdNextSource()
    const step = harness.reader['requestNodeHistoryEvent'](selected, 4, {
      publish: false,
      alignPlayback: false,
      isCurrent: () => wanted,
    })
    await held.started

    // Act: the caller withdraws the step while the next stop's slot opens; the open then completes.
    wanted = false
    held.release()
    await step
    await waitUntil(
      () =>
        harness.historicalDebugPresentations.at(-1)?.label ===
        'Recorded test stop 1 · src/theme.ts:1',
      'the debugger shows the committed stop again',
      READER_RESULT_BOUND_MS,
    )

    // Assert
    assert.equal(harness.reader['selectedNodeHistorySequence'], 2)
    const tabs = slotTabs(harness)
    assert.equal(tabs.length, 1)
    assert.match(tabs[0]!, /\/Captured-theme\.ts$/)
    assert.equal(await harness.readCapturedSource(tabs[0]!), THEME_TEXT)
    assert.deepEqual(slotLabels(harness), [
      '  Recorded: src/theme.ts:1 · 0.20 s',
    ])
    assert.equal(
      harness.historicalDebugPresentations.at(-1)?.sourceDocument?.uri,
      tabs[0],
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a selection that is refused before it changes anything (an event the replay lacks, a seek at a debugger the learner stopped) supersedes no earlier selection: the Play step it found leaving the committed stop, withdrawn meanwhile, still shows the committed stop again in the slot with its line and label; fails_when=the refused selection takes the request token, so the withdrawn step's return is dropped and the slot keeps its loading text or the withdrawn stop's bytes with no stopped line or label beside the committed stop's Study position; why_new=F165 (D34: the request is taken after the refusal checks); seam=the workspace harness's held document open of the next stop's slot, with the caller's isCurrent turned false while the open is held, and the ended historical debugger session; no_claim=the debugger's own restart
for (const refusal of [
  {
    name: 'an event the replay lacks',
    refuse: (harness: Harness): Promise<void> =>
      harness.reader['requestNodeHistoryEvent'](
        harness.reader['selectedNodeHistory']!,
        99,
        { publish: false, alignPlayback: false },
      ),
    prepare: (_harness: Harness) => undefined,
  },
  {
    name: 'a seek at a debugger the learner stopped',
    refuse: (harness: Harness): Promise<void> =>
      harness.reader['requestNodeHistoryEvent'](
        harness.reader['selectedNodeHistory']!,
        2,
        { publish: false, alignPlayback: false },
      ),
    prepare: (harness: Harness): void => harness.endHistoricalDebugSession(),
  },
]) {
  test(`${refusal.name} refused while a withdrawn Play step is leaving the committed stop leaves that stop in the slot with its line and label`, async () => {
    // Arrange
    const harness = await workspaceHarness()
    try {
      const history = await saveTwoFileNodeHistory(
        harness.service.nodeHistoryStore!,
      )
      await openReplayAt(harness, history.studyId, 2)
      const selected = harness.reader['selectedNodeHistory']!
      let wanted = true
      const held = harness.holdNextSource()
      const step = harness.reader['requestNodeHistoryEvent'](selected, 4, {
        publish: false,
        alignPlayback: false,
        isCurrent: () => wanted,
      })
      await held.started
      refusal.prepare(harness)
      wanted = false

      // Act: the refused selection arrives while the step's slot opens; the open then completes.
      const refused = await refusal.refuse(harness).then(
        () => 'accepted',
        () => 'refused',
      )
      held.release()
      await step
      await waitUntil(
        () => slotLabels(harness).length === 1,
        'the committed stop’s label is drawn again',
        READER_RESULT_BOUND_MS,
      )

      // Assert
      assert.equal(refused, 'refused')
      assert.equal(harness.reader['selectedNodeHistorySequence'], 2)
      const tabs = slotTabs(harness)
      assert.equal(tabs.length, 1)
      assert.equal(await harness.readCapturedSource(tabs[0]!), THEME_TEXT)
      assert.deepEqual(slotLabels(harness), [
        '  Recorded: src/theme.ts:1 · 0.20 s',
      ])
    } finally {
      await harness.close()
    }
  })
}

// Value: protects=a Play step or seek that the learner withdrew (Pause or dispose, with no newer selection) while its recorded-source slot was still failing to open commits nothing: not its moment, not its page, not its reader position; fails_when=the failed-slot branch skips the caller's withdrawal check and the moment (sequence 2) becomes the selected one after the learner paused; why_new=F282: only the debugger branch checked isCurrent; seam=the workspace harness's held and rejected non-file document open, with the caller's isCurrent turned false while the open is held; no_claim=the wording of the slot's failure row
test('a Play step withdrawn while its slot fails to open commits no moment', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const store = harness.service.nodeHistoryStore!
    const history = await saveOneStopNodeHistory(store)
    await store.saveReaderPosition(history.studyId, 1)
    await openReplayAt(harness, history.studyId, 1)
    const selected = harness.reader['selectedNodeHistory']!
    let wanted = true
    const held = harness.holdNextSource()
    const step = harness.reader['requestNodeHistoryEvent'](selected, 2, {
      publish: false,
      alignPlayback: false,
      isCurrent: () => wanted,
    })
    await held.started

    // Act: the learner pauses while the slot's open is held, then the open fails.
    wanted = false
    held.reject(new Error('Injected held slot open failure'))
    await step

    // Assert
    assert.equal(harness.reader['selectedNodeHistorySequence'], 1)
    assert.equal(harness.reader['selectedNodeHistoryPage'], 0)
  } finally {
    await harness.close()
  }
})

// Value: protects=a recorded-source slot that a stop selection drew and another tab then hid gets its stopped line and label again when it comes back in front of its group without the keyboard (another action of the reader showed it); fails_when=the redraw waits for the slot to become the active editor, so the slot comes back with no label; why_new=F161 (the redraw ran only on the active editor); seam=the workspace harness's fake onDidChangeVisibleTextEditors, told when a group shows another tab; no_claim=how the native editor drops decorations of a hidden tab
test('a slot shown again without the keyboard gets its stopped line and label again', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await saveOneStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await openReplayAt(harness, history.studyId, 2)
    const column = await coverSlot(harness)
    const drawsBefore = slotLabelDraws(harness)

    // Act
    await showSlotAgain(harness, column, true)

    // Assert
    assert.equal(slotLabelDraws(harness), drawsBefore + 1)
    assert.deepEqual(slotLabels(harness), [
      '  Recorded: src/theme.ts:1 · 0.20 s',
    ])
  } finally {
    await harness.close()
  }
})

// Value: protects=the stopped line is revealed once, at a selection's commit: returning to the slot tab redraws its line and label but does not scroll the learner back to the stop; fails_when=every redraw reveals the stopped line again, so the learner's scroll in the slot is lost whenever the tab comes back; why_new=F161 (decorateNodeSourceSlot revealed on every redraw); seam=the workspace harness's reveal log of the slot's editor and its fake onDidChangeVisibleTextEditors; no_claim=the native scroll position itself
test('returning to the slot tab redraws the stop but does not scroll back to its line', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await saveOneStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await openReplayAt(harness, history.studyId, 2)
    const revealsAtCommit = harness.slotReveals().length
    const column = await coverSlot(harness)
    const drawsBefore = slotLabelDraws(harness)

    // Act
    await showSlotAgain(harness, column, false)

    // Assert
    assert.ok(revealsAtCommit >= 1)
    assert.deepEqual(harness.slotReveals().at(-1)?.line, 0)
    assert.equal(slotLabelDraws(harness), drawsBefore + 1)
    assert.equal(harness.slotReveals().length, revealsAtCommit)
  } finally {
    await harness.close()
  }
})

// Value: protects=a slot URI that no open replay holds (a tab the editor restored after a restart, or one of a replay already left) is served the three-line placeholder, never an error or another moment's bytes; fails_when=the provider throws for a slot it does not hold or serves the open slot's text; why_new=F180 (no test read a foreign slot URI); seam=the workspace harness's captured-source reader; no_claim=closing that restored tab (the sweep tests)
test('a slot address that no replay holds reads as the placeholder', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await saveOneStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await openReplayAt(harness, history.studyId, 2)
    const foreign = slotTabs(harness)[0]!.replace(
      `/${history.studyId}/`,
      '/restored-study/',
    )

    // Act
    const served = await harness.readCapturedSource(foreign)

    // Assert
    assert.equal(served, PLACEHOLDER)
  } finally {
    await harness.close()
  }
})

// Value: protects=selecting the moment the slot already shows (a step action, Inspect, a reselect) keeps the slot's text, tab, stopped line and label, and clears nothing between; fails_when=the reselect leaves the moment first, so the label is cleared and drawn again; why_new=F180 (no test pinned the reselect of the shown moment); seam=none; no_claim=the debugger's own thread (the debugger tests)
test('selecting the moment already shown keeps the slot’s line and label in place', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await saveOneStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await openReplayAt(harness, history.studyId, 2)
    const tabsBefore = slotTabs(harness)
    const invalidationsBefore = harness.historicalDebugInvalidations()
    const draws = harness
      .sourceIdentityDecorations()
      .filter((call) => call.uri.includes('/node-history-slot/')).length

    // Act
    await harness.reader['selectNodeHistoryEvent'](
      harness.reader['selectedNodeHistory']!,
      2,
    )

    // Assert
    const drawnSince = harness
      .sourceIdentityDecorations()
      .filter((call) => call.uri.includes('/node-history-slot/'))
      .slice(draws)
    assert.deepEqual(
      drawnSince.map((call) => call.ranges.length),
      [1],
    )
    assert.deepEqual(slotTabs(harness), tabsBefore)
    assert.equal(harness.historicalDebugInvalidations(), invalidationsBefore)
    assert.equal(await harness.readCapturedSource(tabsBefore[0]!), THEME_TEXT)
  } finally {
    await harness.close()
  }
})

/**
 * Names the slot URI a stop in `src/theme-next.ts` gives the replay's slot, from the slot a stop in `src/theme.ts` shows now.
 * @param harness - The workspace harness.
 * @returns The renamed slot's URI as text.
 * @example nextFileSlot(harness) // => '…/node-history-slot/<studyId>/Captured-theme-next.ts'
 */
function nextFileSlot(harness: Harness): string {
  return slotTabs(harness)[0]!.replace(
    /Captured-theme\.ts$/,
    'Captured-theme-next.ts',
  )
}

/**
 * Asks the open test replay to select a moment, as the Study pane's event list does, without waiting for it.
 * @param harness - The workspace harness.
 * @param studyId - The replay's study id.
 * @param sequence - The moment to select.
 * @example startMomentSelection(harness, history.studyId, 4)
 */
function startMomentSelection(
  harness: Harness,
  studyId: string,
  sequence: number,
): void {
  harness.receiveContext({
    type: 'node-history-event',
    revision: lastView(harness)!.revision,
    studyId,
    sequence,
  })
}

// Value: protects=a slot whose editor show stalls fails at the one slot deadline of 5,000 ms: the moment reports its history-source row with the stop and the timeout, commits with no debugger stop, and the selection is released; fails_when=a stalled open, show or close holds the selection, Play's pending step and every later seek forever; why_new=F198 (only the slot's text wait was bounded); seam=the workspace harness's held text document show and its hand-driven slot clock; no_claim=how long the real editor takes to show a document
test('a slot whose show stalls reports its row at the slot deadline and releases the selection', async () => {
  // Arrange
  const harness = await workspaceHarness()
  let stalled: ReturnType<Harness['holdNextTextDocumentShow']> | undefined
  try {
    const history = await saveTwoFileNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await openReplayAt(harness, history.studyId, 2)
    harness.useManualSlotClock()
    stalled = harness.holdNextTextDocumentShow({ uri: nextFileSlot(harness) })

    // Act
    startMomentSelection(harness, history.studyId, 4)
    await stalled.started
    harness.elapseSlotClock(5_000)
    await waitUntil(
      () => lastView(harness)?.nodeHistoryPosition?.sequence === 4,
      'the moment commits at the slot deadline',
      2_000,
    )

    // Assert
    assert.deepEqual(
      [...(lastView(harness)?.errors ?? [])],
      [
        'Codebook could not open the recorded source of stop 2: Timed out waiting for the recorded source of this moment. Details: Output › Codebook.',
      ],
    )
    assert.equal(
      lastView(harness)?.nodeHistoryPosition?.debuggerAvailable,
      false,
    )
  } finally {
    stalled?.release()
    await harness.close()
  }
})

// Value: protects=the 1,000 ms transition bound no longer fails a slow slot: the selection waits on until the 5,000 ms slot deadline; fails_when=the slot reports its failure at 1,000 ms while the editor is only slow on a loaded host; why_new=F185 (the 1,000 ms bound can be short on a loaded host); seam=the workspace harness's held text document show and its hand-driven slot clock; no_claim=the loading line of the Application header (the transition tests)
test('a slow slot is not failed at the 1,000 ms bound, only at the slot deadline', async () => {
  // Arrange
  const harness = await workspaceHarness()
  let stalled: ReturnType<Harness['holdNextTextDocumentShow']> | undefined
  try {
    const history = await saveTwoFileNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await openReplayAt(harness, history.studyId, 2)
    harness.useManualSlotClock()
    stalled = harness.holdNextTextDocumentShow({ uri: nextFileSlot(harness) })
    startMomentSelection(harness, history.studyId, 4)
    await stalled.started

    // Act
    harness.elapseSlotClock(1_000)
    await new Promise((resolve) => setImmediate(resolve))
    const viewAtBound = lastView(harness)
    harness.elapseSlotClock(4_000)
    await waitUntil(
      () => lastView(harness)?.nodeHistoryPosition?.sequence === 4,
      'the moment commits at the slot deadline',
      2_000,
    )

    // Assert
    assert.equal(viewAtBound?.nodeHistoryPosition?.sequence, 2)
    assert.deepEqual([...(viewAtBound?.errors ?? [])], [])
    assert.equal(lastView(harness)?.errors.length, 1)
  } finally {
    stalled?.release()
    await harness.close()
  }
})

// Value: protects=a slot show that completes after its deadline and is no longer current is closed, not shown: its tab leaves and no stop is presented; fails_when=a late open leaves a slot tab with bytes no moment owns; why_new=F198 (late completions were not cleaned up); seam=the workspace harness's held text document show and its hand-driven slot clock; no_claim=a learner who pinned the tab (the pinned-tab test)
test('a slot show that completes after the deadline is closed, not shown', async () => {
  // Arrange
  const harness = await workspaceHarness()
  let stalled: ReturnType<Harness['holdNextTextDocumentShow']> | undefined
  try {
    const history = await saveTwoFileNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await openReplayAt(harness, history.studyId, 2)
    const earlierSlot = slotTabs(harness)[0]!
    harness.useManualSlotClock()
    stalled = harness.holdNextTextDocumentShow({ uri: nextFileSlot(harness) })
    startMomentSelection(harness, history.studyId, 4)
    await stalled.started
    harness.elapseSlotClock(5_000)
    await waitUntil(
      () => lastView(harness)?.nodeHistoryPosition?.sequence === 4,
      'the moment commits at the slot deadline',
      2_000,
    )
    const presentationsAtDeadline = harness.historicalDebugPresentations.length

    // Act
    stalled.release()
    await waitUntil(
      () =>
        harness
          .tabCloseRequests()
          .flat()
          .some((tab) =>
            JSON.stringify(tab.input).includes('Captured-theme-next.ts'),
          ),
      'the late tab is closed',
      2_000,
    )

    // Assert
    assert.deepEqual(slotTabs(harness), [earlierSlot])
    assert.equal(
      harness.historicalDebugPresentations.length,
      presentationsAtDeadline,
    )
  } finally {
    stalled?.release()
    await harness.close()
  }
})

// Value: protects=Play pauses at the first slot that cannot be shown and does not retry the same failure at every later event; fails_when=Play goes on after a failed slot, so each later event adds a row and an Output entry; why_new=F185 (a failing slot failed again at every later event); seam=the workspace harness's held text document show and its hand-driven slot clock; no_claim=Play's pacing
test('Play pauses at the first slot that cannot open', async () => {
  // Arrange
  const harness = await workspaceHarness()
  let stalled: ReturnType<Harness['holdNextTextDocumentShow']> | undefined
  try {
    const history = await saveTwoFileNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await openReplayAt(harness, history.studyId, 2)
    harness.useManualSlotClock()
    stalled = harness.holdNextTextDocumentShow({ uri: nextFileSlot(harness) })

    // Act
    harness.receiveContext({
      type: 'node-history-playback',
      revision: lastView(harness)!.revision,
      studyId: history.studyId,
      action: 'play',
    })
    await stalled.started
    harness.elapseSlotClock(5_000)
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistoryPosition?.sequence === 4 &&
        !lastView(harness)?.nodeHistoryPlayback?.loading,
      'the moment commits at the slot deadline',
      2_000,
    )

    // Assert
    assert.equal(lastView(harness)?.nodeHistoryPlayback?.mode, 'paused')
    assert.equal(lastView(harness)?.nodeHistoryPosition?.sequence, 4)
  } finally {
    stalled?.release()
    await harness.close()
  }
})

// Value: protects=a refused close of the earlier file's slot tab does not fail the slot that shows its bytes: the moment commits with its stop, Play goes on, and the Study tells the close failure in its own row with one Output entry; the next selection retries the close; fails_when=the refused close marks the shown slot as failed and presents no stop; why_new=F185 (a refused close was told as a failure to open); seam=the workspace harness's refusal to close a tab; no_claim=the wording of the editor's refusal
test('a refused close of the earlier slot tab commits the moment and is told as a close failure', async () => {
  // Arrange
  const harness = await workspaceHarness()
  const logged: CodebookDiagnostic[] = []
  harness.reader.diagnostics = {
    log: (entry) => logged.push(entry),
    show: () => undefined,
  }
  try {
    const history = await saveTwoFileNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await openReplayAt(harness, history.studyId, 2)
    const acceptClose = harness.refuseCloseOfTabsShowing('Captured-theme.ts')

    // Act
    await selectMoment(harness, history.studyId, 4)
    const viewAfterRefusal = lastView(harness)!
    const tabsAfterRefusal = slotTabs(harness)
    acceptClose()
    await selectMoment(harness, history.studyId, 5)
    await selectMoment(harness, history.studyId, 4)

    // Assert
    assert.equal(viewAfterRefusal.nodeHistoryPosition?.debuggerAvailable, true)
    assert.deepEqual(
      [...viewAfterRefusal.errors],
      [
        'Codebook could not close an earlier recorded-source tab: The editor kept an earlier recorded source tab.',
      ],
    )
    assert.equal(tabsAfterRefusal.length, 2)
    assert.deepEqual(
      logged.map(({ surface, cause }) => ({ surface, cause })),
      [
        {
          surface: 'close:recorded-source',
          cause: 'The editor kept an earlier recorded source tab.',
        },
      ],
    )
    assert.equal(slotTabs(harness).length, 1)
    assert.deepEqual([...(lastView(harness)?.errors ?? [])], [])
  } finally {
    await harness.close()
  }
})

// Value: protects=a close of the earlier slot tab that passes the slot deadline commits the moment normally with the close warning; fails_when=a stalled close holds the selection or fails the slot that shows its bytes; why_new=F198 (the tab close was unbounded); seam=the workspace harness's held tab close and its hand-driven slot clock; no_claim=the editor's own close of the tab once it answers
test('a stalled close of the earlier slot tab commits the moment at the slot deadline with the close warning', async () => {
  // Arrange
  const harness = await workspaceHarness()
  let stalledClose: ReturnType<Harness['holdNextTabCloseEffect']> | undefined
  try {
    const history = await saveTwoFileNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await openReplayAt(harness, history.studyId, 2)
    harness.useManualSlotClock()
    stalledClose = harness.holdNextTabCloseEffect()

    // Act
    startMomentSelection(harness, history.studyId, 4)
    await stalledClose.started
    harness.elapseSlotClock(5_000)
    await waitUntil(
      () => lastView(harness)?.nodeHistoryPosition?.sequence === 4,
      'the moment commits at the slot deadline',
      2_000,
    )

    // Assert
    assert.equal(
      lastView(harness)?.nodeHistoryPosition?.debuggerAvailable,
      true,
    )
    assert.deepEqual(
      [...(lastView(harness)?.errors ?? [])],
      [
        'Codebook could not close an earlier recorded-source tab: Timed out waiting for the earlier recorded-source tab to close.',
      ],
    )
  } finally {
    stalledClose?.release()
    await harness.close()
  }
})

// Value: protects=a close of the earlier slot tab that an older selection issued does not close the slot tab a newer selection reselected: the show waits for the in-flight close of its own address, then shows it again; fails_when=the newer selection finds the closing tab, shows it and the older close then closes the current slot, leaving no slot tab; why_new=F196 (tabGroups.close was not serialized with the next show); seam=the workspace harness's held tab close effect; no_claim=a stalled close, which the slot deadline bounds (the deadline tests)
test('a close the older selection issued does not close the slot tab the newer selection shows again', async () => {
  // Arrange
  const harness = await workspaceHarness()
  let heldClose: ReturnType<Harness['holdNextTabCloseEffect']> | undefined
  try {
    const history = await saveTwoFileNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.service.nodeHistoryStore!.saveReaderPosition(
      history.studyId,
      3,
    )
    await openReplayAt(harness, history.studyId, 3)
    const firstFileSlot = slotTabs(harness)[0]!
    heldClose = harness.holdNextTabCloseEffect()
    startMomentSelection(harness, history.studyId, 4)
    await heldClose.started

    // Act
    startMomentSelection(harness, history.studyId, 2)
    // The newer selection runs as far as it can while the older close is pending.
    for (let turn = 0; turn < 10; turn++)
      await new Promise((resolve) => setImmediate(resolve))
    heldClose.release()
    await waitUntil(
      () => lastView(harness)?.nodeHistoryPosition?.sequence === 2,
      'the newer selection commits',
      2_000,
    )

    // Assert
    assert.deepEqual(slotTabs(harness), [firstFileSlot])
    assert.equal(harness.documentTextOf(firstFileSlot), THEME_TEXT)
  } finally {
    heldClose?.release()
    await harness.close()
  }
})

// Value: protects=a selection overtaken inside the editor's show of its slot issues no close of its own: the newer selection chooses its column and sweeps; fails_when=the overtaken selection sweeps the slot tabs first and can close the only tab of its group before the newer selection chooses a column; why_new=F189 (the sweep ran for an overtaken selection); seam=the workspace harness's held text document show and held document open; no_claim=the final tab set, which the rename tests pin
test('a selection overtaken inside the editor’s show closes no tab before the newer selection takes over', async () => {
  // Arrange
  const harness = await workspaceHarness()
  let heldShow: ReturnType<Harness['holdNextTextDocumentShow']> | undefined
  let heldOpen: ReturnType<Harness['holdNextSource']> | undefined
  try {
    const history = await saveTwoFileNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.service.nodeHistoryStore!.saveReaderPosition(
      history.studyId,
      3,
    )
    await openReplayAt(harness, history.studyId, 3)
    const firstFileSlot = slotTabs(harness)[0]!
    const renamedSlot = nextFileSlot(harness)
    heldShow = harness.holdNextTextDocumentShow({ uri: renamedSlot })
    startMomentSelection(harness, history.studyId, 4)
    await heldShow.started
    heldOpen = harness.holdNextSource({ uri: firstFileSlot })
    startMomentSelection(harness, history.studyId, 2)
    await heldOpen.started
    const closeRequestsBefore = harness.tabCloseRequests().length

    // Act
    heldShow.release()
    await waitUntil(
      () =>
        harness
          .textDocumentShows()
          .some((shown) => shown.name === 'Captured-theme-next.ts'),
      'the overtaken show puts its tab in front',
      2_000,
    )
    for (let turn = 0; turn < 10; turn++)
      await new Promise((resolve) => setImmediate(resolve))
    const closeRequestsBeforeTakeover = harness.tabCloseRequests().length
    heldOpen.release()
    await waitUntil(
      () => lastView(harness)?.nodeHistoryPosition?.sequence === 2,
      'the newer selection commits',
      2_000,
    )

    // Assert
    assert.equal(closeRequestsBeforeTakeover, closeRequestsBefore)
    assert.deepEqual(slotTabs(harness), [firstFileSlot])
  } finally {
    heldShow?.release()
    heldOpen?.release()
    await harness.close()
  }
})

// Value: protects=a slot address that cannot be built (a missing library) is told as the recorded-source row of the stop, like any failure to open the slot, and the moment still commits; fails_when=the TypeError escapes after the earlier moment was left, and the Study position and the row stay silent; why_new=F199 (nodeSourceSlotUri read the library before the slot's try); seam=none; no_claim=how the library goes missing
test('a slot address that cannot be built is told as a failure to open the recorded source', async () => {
  // Arrange
  const harness = await workspaceHarness()
  let originalAddress: Harness['reader']['nodeSourceSlotUri'] | undefined
  try {
    const history = await saveTwoFileNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await openReplayAt(harness, history.studyId, 2)
    // The instance's own method hides the class's, as a missing library does for the real one.
    originalAddress = harness.reader['nodeSourceSlotUri']
    harness.reader['nodeSourceSlotUri'] = () => {
      throw new TypeError('Cannot read properties of undefined')
    }

    // Act
    await harness.reader['selectNodeHistoryEvent'](
      harness.reader['selectedNodeHistory']!,
      4,
    )

    // Assert
    assert.equal(lastView(harness)?.nodeHistoryPosition?.sequence, 4)
    assert.match(
      lastView(harness)?.errors[0] ?? '',
      /^Codebook could not open the recorded source of stop 2: /,
    )
  } finally {
    if (originalAddress) harness.reader['nodeSourceSlotUri'] = originalAddress
    await harness.close()
  }
})

// Value: protects=a debugger presentation that throws leaves every surface on the moment the Study position still names: the slot shows that moment's bytes and label again, the failure is told, and the position does not move; fails_when=the slot and the debugger stay on the moment whose presentation failed while the Study position names the earlier one; why_new=F199 (a presentation that threw moved the slot and the debugger but not the position); seam=the workspace harness's held historical debug presentation; no_claim=the wording of the debugger's failure
test('a debugger presentation that throws puts the slot back on the moment the position names', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await saveTwoFileNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await openReplayAt(harness, history.studyId, 2)
    const firstFileSlot = slotTabs(harness)[0]!
    const held = harness.holdHistoricalDebugPresentation(true)

    // Act
    startMomentSelection(harness, history.studyId, 4)
    await held.started
    held.reject(new Error('Injected presentation failure'))
    await waitUntil(
      () => (lastView(harness)?.errors.length ?? 0) > 0,
      'the failed presentation is told',
      2_000,
    )
    await waitUntil(
      () => slotLabels(harness).includes('  Recorded: src/theme.ts:1 · 0.20 s'),
      'the slot returns to the committed stop',
      2_000,
    )

    // Assert
    assert.equal(lastView(harness)?.nodeHistoryPosition?.sequence, 2)
    assert.ok(lastView(harness)?.errors[0]?.includes('Injected presentation'))
    assert.deepEqual(slotTabs(harness), [firstFileSlot])
    assert.equal(await harness.readCapturedSource(firstFileSlot), THEME_TEXT)
  } finally {
    await harness.close()
  }
})

// Value: protects=a slot tab of an earlier session that no replay holds any more is closed when the Study returns to Live, although no slot object exists; fails_when=the retire closes slot tabs only when a replay's slot object exists; why_new=F192 (the close was guarded by the slot object); seam=none; no_claim=a tab the learner pinned or edited
test('returning to Live closes a restored slot tab although no replay holds a slot', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    await harness.reader.action('retry')
    const restored = new harness.editor.Uri(
      'codebook-source',
      sha256(await realpath(harness.directory)),
      '/node-history-slot/restored-study/25a6634263c1/Captured-old.ts',
    )
    await harness.editor.window.showTextDocument(restored, {
      viewColumn: 1,
      preserveFocus: true,
      preview: false,
    })
    assert.equal(slotTabs(harness).length, 1)

    // Act
    await harness.reader['retireNodeHistorySelection']()

    // Assert
    assert.deepEqual(slotTabs(harness), [])
  } finally {
    await harness.close()
  }
})

// Value: protects=the Study pane drops the recorded-source failure row of a retired replay in the same step as the retire; fails_when=the retire deletes the row and publishes nothing, so the pane keeps showing a Retry for a replay that is gone; why_new=F192 (the retire deleted the row without publishing on every path); seam=the workspace harness's injected failure of a non-file document open; no_claim=the Return to Live path, which publishes later by itself
test('retiring a replay publishes the removal of its slot failure row', async () => {
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
    await harness.reader['retireNodeHistorySelection']()

    // Assert
    assert.equal(lastView(harness)?.errors.length, 0)
  } finally {
    await harness.close()
  }
})

// Value: protects=a slot tab the learner pinned keeps no stop of the retired replay: its label, stopped line and bytes are cleared and the document reads the placeholder; fails_when=the retire skips the pinned tab and leaves the last stop's bytes and label on it with no replay behind; why_new=F168 (the retire neither cleared the decorations nor fired the provider); seam=the workspace harness's open document model (documentTextOf); no_claim=closing the pinned tab, which the learner owns
test('a pinned slot tab of a retired replay shows the placeholder and no stop label', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await saveOneStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await openReplayAt(harness, history.studyId, 2)
    const pinned = slotTabs(harness)[0]!
    for (const group of harness.groups)
      for (const tab of group.tabs)
        if (tabIdentity(tab) === pinned) tab.isPinned = true

    // Act
    await harness.reader['retireNodeHistorySelection']()
    await waitUntil(
      () => harness.documentTextOf(pinned) === PLACEHOLDER,
      'the pinned slot document reads the placeholder',
      2_000,
    )

    // Assert
    assert.deepEqual(slotTabs(harness), [pinned])
    assert.equal(harness.documentTextOf(pinned), PLACEHOLDER)
    assert.deepEqual(slotLabels(harness), [])
  } finally {
    await harness.close()
  }
})

// Value: protects=the retire closes only the recorded-source slot's tabs: a preview of the old per-stop address is not Codebook's to close any more; fails_when=the retire still sweeps /node-history/<studyId>/ previews that nothing opens since the slot replaced them; why_new=F183 (the block described a behavior that no longer exists); seam=the workspace harness's restored captured-source tab with its own path; no_claim=how an earlier version's tab is closed at a cold entry
test('returning to Live leaves a preview at the old per-stop address alone', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await saveOneStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await openReplayAt(harness, history.studyId, 2)
    const oldPreview = harness.restoreLeftoverCapturedSource({
      path: `/node-history/${history.studyId}/2/${sha256(THEME_TEXT)}`,
    })
    oldPreview.isPreview = true

    // Act
    await harness.reader['retireNodeHistorySelection']()

    // Assert
    assert.equal(
      harness
        .tabCloseRequests()
        .flat()
        .some((tab) => tab === oldPreview),
      false,
    )
    assert.deepEqual(slotTabs(harness), [])
  } finally {
    await harness.close()
  }
})

// Value: protects=closing the Study workspace ends the test replay's recorded-source slot: the document reads the placeholder and carries no stop label, not the last stop's bytes; fails_when=a closed reader keeps the slot object with the last stop, so a restored or pinned slot tab shows it; why_new=F184 (the slot was not retired when the reader closed); seam=none; no_claim=reopening the replay, which the open tests cover
test('closing the Study workspace ends the recorded-source slot', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await saveOneStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await openReplayAt(harness, history.studyId, 2)
    const slot = slotTabs(harness)[0]!

    // Act
    await harness.reader.close()

    // Assert
    assert.deepEqual(slotTabs(harness), [])
    assert.equal(await harness.readCapturedSource(slot), PLACEHOLDER)
  } finally {
    await harness.close()
  }
})

// Value: protects=a slot tab of another replay that an editor restart restored before the replay opens is closed when the open replay shows its first slot; fails_when=the sweep runs only at later moments, so the restored tab shows the placeholder beside the open replay's slot; why_new=F169 (the sweep of a restored tab was tested only after the replay had opened); seam=none; no_claim=a restored tab the learner pinned
test('a slot tab restored before the replay opens is closed at the replay’s first slot', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await saveOneStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.action('retry')
    const restored = new harness.editor.Uri(
      'codebook-source',
      sha256(await realpath(harness.directory)),
      '/node-history-slot/restored-study/25a6634263c1/Captured-old.ts',
    )
    await harness.editor.window.showTextDocument(restored, {
      viewColumn: 1,
      preserveFocus: true,
      preview: false,
    })

    // Act
    await openReplayAt(harness, history.studyId, 2)

    // Assert
    const tabs = slotTabs(harness)
    assert.equal(tabs.length, 1)
    assert.match(tabs[0]!, /\/Captured-theme\.ts$/)
  } finally {
    await harness.close()
  }
})

// Value: protects=the slot's hover is Markdown that a recorded path cannot turn into a link or formatting: its text is escaped; fails_when=the hover is a plain string, which VS Code renders as Markdown, so a recorded path with [text](url) draws a link; why_new=F176 (the hover message was a string); seam=the workspace harness's MarkdownString with VS Code's escaping; no_claim=what the native hover draws
test('the slot’s hover escapes Markdown in a recorded path', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await saveTwoFileNodeHistory(
      harness.service.nodeHistoryStore!,
      'src/[docs](example.com)/theme-next.ts',
    )
    await openReplayAt(harness, history.studyId, 2)

    // Act
    await selectMoment(harness, history.studyId, 4)

    // Assert
    const hover = harness
      .sourceIdentityDecorations()
      .filter((call) => call.uri.includes('/node-history-slot/'))
      .at(-1)?.ranges[0] as { hoverMessage?: { value?: string } } | undefined
    assert.equal(
      hover?.hoverMessage?.value,
      `Recorded:&nbsp;src/\\[docs\\]\\(example.com\\)/theme\\-next.ts:1&nbsp;·&nbsp;0.30&nbsp;s&nbsp;·&nbsp;captured&nbsp;SHA\\-256&nbsp;${sha256(THEME_NEXT_TEXT)}`,
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=two files with the same base name in different folders get different slot tabs, so a stop in the other file renames the tab; fails_when=both files share the address Captured-<basename>, so the tab keeps the first file's name while it shows the second file's bytes; why_new=F200 (the slot name was only the base name); seam=none; no_claim=how the editor titles two tabs of the same name
test('a stop in another folder’s file of the same name renames the slot', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await saveTwoFileNodeHistory(
      harness.service.nodeHistoryStore!,
      'lib/theme.ts',
    )
    await openReplayAt(harness, history.studyId, 2)
    const first = slotTabs(harness)

    // Act
    await selectMoment(harness, history.studyId, 4)

    // Assert
    assert.equal(first.length, 1)
    assert.match(first[0]!, /\/25a6634263c1\/Captured-theme\.ts$/)
    const second = slotTabs(harness)
    assert.equal(second.length, 1)
    assert.match(second[0]!, /\/76b5a3573912\/Captured-theme\.ts$/)
  } finally {
    await harness.close()
  }
})

// Value: protects=the label stands at the end of a CRLF source's line without counting the carriage return; fails_when=the label column is one too far for every line of a CRLF source; why_new=F201 (the line length counted the \r); seam=none; no_claim=how the editor lays out the label
test('the label of a CRLF source stands at the end of its line, not after the carriage return', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await saveTwoFileNodeHistory(
      harness.service.nodeHistoryStore!,
      'src/theme-next.ts',
      'const applied = 1;\r\nconst next = 2;\r\n',
    )
    await openReplayAt(harness, history.studyId, 2)

    // Act
    await selectMoment(harness, history.studyId, 4)

    // Assert
    const label = harness
      .sourceIdentityDecorations()
      .filter((call) => call.uri.includes('/node-history-slot/'))
      .at(-1)?.ranges[0] as
      { range?: { start: { line: number; character: number } } } | undefined
    assert.deepEqual(
      { line: label?.range?.start.line, column: label?.range?.start.character },
      { line: 0, column: 18 },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=whenever the slot shows the placeholder (an output, the result, an unverified stop) it is revealed from its first line, so an earlier stop's scroll never leaves the three-line placeholder out of view; fails_when=a moment without a stop reveals nothing and the editor keeps the stop's scroll position over the short text; why_new=F204 (the placeholder was out of view after a stop scrolled the slot); seam=the workspace harness's reveal log of the slot's editor; no_claim=the native scroll and sticky scroll (the native recheck)
test('the placeholder is revealed from its first line when an output follows a stop', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await saveOneStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await openReplayAt(harness, history.studyId, 2)
    const revealsAtStop = harness.slotReveals().length

    // Act
    await selectMoment(harness, history.studyId, 3)

    // Assert
    const revealed = harness.slotReveals().slice(revealsAtStop)
    assert.deepEqual(
      revealed.map((reveal) => reveal.line),
      [0],
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a CodeLens above the stopped line carries the whole label Recorded: <path>:<line> · <t> s at a verified stop and none at the placeholder; fails_when=the label exists only at the end of the line, where the editor group's edge cuts it; why_new=F207 (the end-of-line label was cut at the default layout); seam=the workspace harness's CodeLens provider; no_claim=whether both hosts draw the lens (the native check)
test('a CodeLens above the stopped line carries the whole recorded label', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await saveOneStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await openReplayAt(harness, history.studyId, 2)
    const slot = slotTabs(harness)[0]!

    // Act
    const atStop = harness.codeLensTitles(slot)
    await selectMoment(harness, history.studyId, 3)
    const atOutput = harness.codeLensTitles(slot)

    // Assert
    assert.deepEqual(atStop, ['Recorded: src/theme.ts:1 · 0.20 s'])
    assert.deepEqual(atOutput, [])
  } finally {
    await harness.close()
  }
})
