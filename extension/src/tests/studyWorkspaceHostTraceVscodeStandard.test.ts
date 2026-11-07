/**
 * Replays the five marked windows of the VS Code 1.145.2 standard take (nextjs-dashboard, Codebook 0.2.92, recorded in the macOS Space; Cycle 0094 task 12, R13).
 *
 * The take's marks name the step that starts next: `open-study` (Codebook: Open Study Workspace), `arrange` (Codebook: Arrange Study Workspace from the command palette), `restore` (the Study pane's Restore), `recording` (the Study pane's Recording), `reload-window` (Developer: Reload Window; the only window that spans two segments of the trace).
 * Each test builds the window's start state with harness helpers while the replay is bypassed, asserts it equals the take at the start mark, then replays the window with the `with-operation` delivery. A window the fake cannot follow is a `todo` that keeps its full intended body and names the first divergence.
 *
 * What the take showed (asserted, no product behavior is changed here): after the command-palette Arrange the Study pane showed "Native focus changed while presentation panes moved; the learner focus was preserved."; the Study pane's Restore cleared it. After Reload Window the Study panes do not come back (by design since 0.2.73.1) and the Study's editor groups stay empty.
 *
 * The final-state equality of these tests is not independent evidence for the active group and front tabs: the replay makes the fake follow each delivered event's recorded snapshot (`applyActiveState`), so only the groups, tabs, layout and the two alignment counts are evidence; the active flags are compared as a consistency check.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { sha256 } from '../runtimeSupport/utils/sha256'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { citationContext } from '../utils/citationContext'

import {
  recordedReaderHarness,
  workspaceHarness,
} from './studyWorkspaceHarness'
import { createConfiguredStudy } from './utils/createConfiguredStudy'
import {
  hostTraceWindow,
  parseHostTrace,
  roleNormalize,
  startSnapshot,
  type HostStateRecord,
  type HostTraceWindow,
  type ParsedHostTrace,
} from './utils/hostTraceReplay'

/** The sanitized native take (VS Code 1.145.2, nextjs-dashboard), read from the source tree because the compiled test runs from `dist`. */
const VSCODE_TRACE = join(
  __dirname,
  '..',
  '..',
  'src',
  'tests',
  'fixtures',
  'host-traces',
  'vscode-standard-vscode-1.145.2.jsonl',
)

/** Tabs the harness's fixture adds to the window that the native take did not have: the article source in column 1 and the Repository Wiki tab. Dropped from both sides. */
const FIXTURE_ONLY_TABS = ['article-source.ts', 'codebook · Repository Wiki']

/** The harness a window test drives. */
type Harness = Awaited<ReturnType<typeof workspaceHarness>>

/** The refusal the take's Study pane showed after the command-palette Arrange. */
const ARRANGE_REFUSAL =
  /Native focus changed while presentation panes moved; the learner focus was preserved\./

/** Parses the committed take. */
const takeTrace = (): ParsedHostTrace =>
  parseHostTrace(readFileSync(VSCODE_TRACE, 'utf8'))

/**
 * Parses the committed take for a window over the harness's saved recording, whose source is `src/theme.ts`: the take's captured source `Captured-index.ts` is named `Captured-theme.ts` as the recorded study's slot is. Only that file name changes; the groups, tabs, orders and timing are the take's.
 * @returns The take with the recorded study's captured-source name.
 */
const recordedStudyTakeTrace = (): ParsedHostTrace =>
  parseHostTrace(
    readFileSync(VSCODE_TRACE, 'utf8').replaceAll(
      'Captured-index.ts',
      'Captured-theme.ts',
    ),
  )

/**
 * Builds the configured study with its cited source renamed to the take's `db/index.ts`, so the captured source tab reads `Captured-index.ts` as in the native take.
 * @returns The study; its citation context and configuration hash follow the rename.
 */
function studyCitingIndexTs() {
  const base = createConfiguredStudy()
  const renamed: typeof base = JSON.parse(
    JSON.stringify(base).replaceAll('src/theme.ts', 'db/index.ts'),
  )
  // The citation context is derived from the anchors, whose path just changed.
  renamed.descriptor!.citationContext = citationContext(
    renamed.descriptor!.anchors,
  )
  renamed.configurationHash = sha256(JSON.stringify(renamed.configuration))
  return renamed
}

/**
 * Saves the study that cites `db/index.ts` into the harness's library, without opening it.
 * @param harness - The harness whose library receives the study.
 * @returns The saved study.
 */
async function saveStudy(harness: Harness) {
  const library = await harness.reader.learningStorage()
  const study = { ...studyCitingIndexTs(), workspaceKey: library.workspaceKey }
  await library.saveStudy(study)
  return study
}

/**
 * Opens the Study Workspace and selects the saved study, as the native take's entry did.
 * @param harness - The harness holding the saved study.
 * @param studyId - The saved study's id.
 */
async function openSavedStudy(
  harness: Harness,
  studyId: string,
): Promise<void> {
  await harness.reader.open()
  harness.receive({
    type: 'history',
    revision: harness.reader.inspect().view!.revision,
    studyId,
  })
  // The reader selects the study on the next turns of its own queue.
  await waitUntil(
    () =>
      harness.reader.inspect().view!.model.selection.studyId === studyId &&
      !harness.reader.inspect().view!.loading,
    'the saved study selected in the reader',
    1_000,
  )
}

/**
 * Makes the harness over one window of the take, with the replay in the `with-operation` delivery and bypassed.
 * @param window - The window to replay.
 * @returns The harness, ready for its start state to be built.
 */
async function harnessForWindow(window: HostTraceWindow): Promise<Harness> {
  const harness = await workspaceHarness(false, false, undefined, {
    hostOrder: window.trace,
    hostOrderDelivery: 'with-operation',
  })
  harness.hostOrder!.bypass(true)
  return harness
}

/**
 * Builds the take's Study at the `arrange` mark: the Application shares the learner's `index.ts` group, the captured source stands in its own group and the Study pane in the third, with the Study active.
 * @param harness - A harness whose replay is bypassed.
 * @returns The study id and the learner's `index.ts` tab handle, whose `focus` brings it to the front.
 */
async function buildStudyAtArrange(harness: Harness) {
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  const indexDraft = harness.focusMutableDraft('index.ts', 1)
  const study = await saveStudy(harness)
  await openSavedStudy(harness, study.id)
  return { studyId: study.id, indexDraft }
}

/**
 * Makes the harness over one window of the take with a saved recording (Recorded application and captured source), with the replay in the `with-operation` delivery and bypassed from the start so the recording's own setup consumes no trace event.
 * @param window - The window to replay.
 * @returns The recorded harness, its replay bypassed and its Study not yet open.
 */
async function recordedHarnessForWindow(window: HostTraceWindow) {
  const harness = await recordedReaderHarness(false, false, 1, undefined, {
    hostOrder: window.trace,
    hostOrderDelivery: 'with-operation',
    startBypassed: true,
  })
  // The recording's own setup closed the reader; the take starts with the learner's one group.
  await harness.reader.close()
  return harness
}

/**
 * Builds the take's Study at the `arrange` mark over the saved recording's study.
 * @param harness - A recorded harness whose replay is bypassed.
 * @returns The learner's `index.ts` tab handle, whose `focus` brings it to the front.
 */
async function buildRecordedStudyAtArrange(
  harness: Awaited<ReturnType<typeof recordedHarnessForWindow>>,
) {
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  const indexDraft = harness.focusMutableDraft('index.ts', 1)
  await openSavedStudy(harness, harness.studyId)
  return { indexDraft }
}

/**
 * Asserts the harness's state equals the take's at the window's start.
 * @param harness - The harness with its replay switched on.
 * @param start - The recorded state at the start mark.
 * @param markLabel - The mark's name, for the failure message.
 */
function assertStartState(
  harness: Harness,
  start: HostStateRecord,
  markLabel: string,
): void {
  const options = { dropTabLabels: FIXTURE_ONLY_TABS }
  assert.deepEqual(
    harness.hostOrder!.roleNormalizedState(options),
    roleNormalize(start, options),
    `the harness state at the window start must equal the take at its ${markLabel} mark (fixture drift, not a product failure)`,
  )
}

/** Reads the refusal lines the Study pane shows: its error rows and its status reason. */
function shownRefusals(harness: Harness): string {
  return [
    ...harness.reader.inspect().view!.errors,
    harness.reader.presentationState().reason ?? '',
  ]
    .join('\n')
    .trim()
}

// Value: protects=Open Study Workspace in VS Code 1.145.2 beside an empty first group: the entry closes the empty group and shares the learner's group with the Application, as the native take ended; fails_when=the harness's start state differs from the take's at the open-study mark, the entry is refused or times out, the role-normalized end state differs from the take's (the fake opens the Application in the empty first group, leaves it standing and puts index.ts beside the captured source), or a burst or trace event stays unaligned; why_new=Cycle 0094 task 12 (VS Code take, window 1); seam=workspaceHarness hostOrder (with-operation), the reader's open and the history selection; no_claim=Cursor, the Study pane's own controls, timing beyond the 2 s gap cap
test(
  'Open Study Workspace beside an empty first group ends with the Application in the learner group and the captured source in its own group',
  {
    todo: 'first divergence: seq 18 (groupsChanged closed the empty first group, groupIndex -1) now maps, and the replay then fails at seq 44 (tabsChanged opened Captured-index.ts in the new middle group) with trace-mapping-failed: the fake never had that tab there, because it keeps the empty first group VS Code removed after the focus churn of seq 6 to 16 and opens the Application and the captured source in other groups than the take (seq 24 opened the Application in the learner group)',
  },
  async () => {
    // Arrange
    const window = hostTraceWindow(takeTrace(), 'open-study', 'arrange')
    const harness = await harnessForWindow(window)
    const replay = harness.hostOrder!
    try {
      // The take starts with an empty first group above the learner's index.ts.
      harness.useNativeLayout({ orientation: 1, groups: [{}, {}] })
      harness.leaveEmptyGroup(1)
      harness.focusMutableDraft('index.ts', 2)
      const study = await saveStudy(harness)
      replay.bypass(false)
      assertStartState(harness, startSnapshot(window), 'open-study')

      // Act
      await openSavedStudy(harness, study.id)
      await replay.settled()
      await replay.deliverTrailing()
      const result = replay.windowResult({ dropTabLabels: FIXTURE_ONLY_TABS })

      // Assert
      assert.deepEqual(result.fakeState, result.traceState)
      assert.equal(result.unmatchedModelBursts, 0)
      assert.equal(result.unreachedTraceBursts, 0)
      assert.equal(shownRefusals(harness), '')
    } finally {
      await harness.close()
    }
  },
)

// Value: protects=Arrange Study Workspace from the command palette in VS Code 1.145.2: Codebook's moves are replayed in the order the host reported them and the Study pane shows the refusal the take showed ("Native focus changed while presentation panes moved; the learner focus was preserved."); fails_when=the start state differs from the take's at the arrange mark, the end state (index.ts in front, the captured source's group active) differs, a burst or trace event is unaligned beyond the two counts, or the pane shows no such refusal; why_new=Cycle 0094 task 12 (VS Code take, window 2); seam=workspaceHarness hostOrder (with-operation), buildStudyAtArrange, the reader's arrange action as a command (not from a pane); no_claim=that the fake delivers the focus change that made the host refuse (it reports a selection on the captured source where the take reports the Study group active), Cursor's refusal, timing beyond the 2 s gap cap
test(
  'Arrange Study Workspace from the command palette ends with index.ts in front and shows the focus-changed refusal the native take showed',
  {
    todo: 'first divergence: after 7 matched events, the fake reported a selection on Captured-index.ts where the take has seq 76 groupsChanged (the Study group active, 3 ms before the Application tab opened again): the focus change that made the host refuse never reaches the workspace, so the pane shows no refusal (2 unmatched bursts, 10 unreached events); the final role-normalized state does equal the take',
  },
  async () => {
    // Arrange
    const window = hostTraceWindow(takeTrace(), 'arrange', 'restore')
    const harness = await harnessForWindow(window)
    const replay = harness.hostOrder!
    try {
      await buildStudyAtArrange(harness)
      replay.bypass(false)
      assertStartState(harness, startSnapshot(window), 'arrange')

      // Act
      await harness.reader.action('arrange')
      await replay.settled()
      await replay.deliverTrailing()
      const result = replay.windowResult({ dropTabLabels: FIXTURE_ONLY_TABS })

      // Assert
      assert.deepEqual(result.fakeState, result.traceState)
      assert.equal(result.unmatchedModelBursts, 2)
      assert.equal(result.unreachedTraceBursts, 10)
      assert.match(shownRefusals(harness), ARRANGE_REFUSAL)
    } finally {
      await harness.close()
    }
  },
)

// Value: protects=the Study pane's Restore after Arrange in VS Code 1.145.2: Restore leaves index.ts in front and the Study group active and the pane shows no refusal (the take: Restore cleared the Arrange's error); fails_when=the start state differs from the take's at the restore mark, Restore is refused or times out, the role-normalized end state differs (Study group not active again, the Application in front), or a refusal stays on the pane; why_new=Cycle 0094 task 12 (VS Code take, window 3); seam=workspaceHarness hostOrder (with-operation), the reader's arrange action pressed from the pane, the learner's index.ts tab handle and activateEditorGroup for the start state; no_claim=that the start state carries the Arrange's refusal text (the harness builds the layout, not the earlier refusal), that the fake reports the host's two trailing reports in the take's order (3 model bursts find no covering run and 2 trace events stay unreached, so the end-state equality rests on the take's recorded active state followed at the end), Cursor
test('the Study pane Restore after Arrange leaves index.ts in front and the Study group active with no refusal', async () => {
  // Arrange
  const window = hostTraceWindow(takeTrace(), 'restore', 'recording')
  const harness = await harnessForWindow(window)
  const replay = harness.hostOrder!
  try {
    const { indexDraft } = await buildStudyAtArrange(harness)
    // The state the Arrange left in the take: index.ts in front of its group, the captured source's group holding the keyboard.
    indexDraft.focus()
    harness.activateEditorGroup(2)
    replay.bypass(false)
    assertStartState(harness, startSnapshot(window), 'restore')

    // Act
    await harness.reader.action('arrange', true)
    await replay.settled()
    await replay.deliverTrailing()
    const result = replay.windowResult({ dropTabLabels: FIXTURE_ONLY_TABS })

    // Assert
    assert.deepEqual(result.fakeState, result.traceState)
    assert.equal(result.unmatchedModelBursts, 3)
    assert.equal(result.unreachedTraceBursts, 2)
    assert.equal(shownRefusals(harness), '')
  } finally {
    await harness.close()
  }
})

// Value: protects=the Study pane's Recording in VS Code 1.145.2: the Study pane closes, the Application moves to a group of its own at column 1 and the learner's group keeps index.ts with the captured source slot; fails_when=the start state differs from the take's at the recording mark, the recording is refused or times out, the end state differs from the take's, or a burst or trace event stays unaligned; why_new=Cycle 0094 task 12 (VS Code take, window 4); seam=recordedReaderHarness with hostOrder (with-operation, started bypassed), the reader's openRecording; no_claim=Cursor, the recording's own content, timing beyond the 2 s gap cap
test(
  'the Study pane Recording closes the Study pane, moves the Application to its own group and opens the recorded source slot',
  {
    todo: "first divergence: the start state is built (recordedReaderHarness, bypassed from its creation) and the first burst matches seq 114, but the second burst, the fake's new group for the Application at column 1, delivers seq 116 to 118 while the fake already holds the captured source at column 3: seq 118 (activeTextEditor) names the captured source at column 2, where the take had not yet inserted the Application's group (the host focused the captured source's group and closed the Study group at seq 120 to 122 before it moved the Application), so the replay fails with trace-mapping-failed (the fake never had that editor at that column)",
  },
  async () => {
    // Arrange
    const window = hostTraceWindow(
      recordedStudyTakeTrace(),
      'recording',
      'reload-window',
    )
    const harness = await recordedHarnessForWindow(window)
    const replay = harness.hostOrder!
    try {
      const { indexDraft } = await buildRecordedStudyAtArrange(harness)
      // The state the Restore left in the take: index.ts in front, the Study group holding the keyboard.
      indexDraft.focus()
      harness.activateEditorGroup(3)
      replay.bypass(false)
      assertStartState(harness, startSnapshot(window), 'recording')

      // Act
      await harness.reader.openRecording(harness.studyId)
      // The recording opens its panes on the playback controller's own turns.
      await harness.controller.settle()
      await replay.settled()
      await replay.deliverTrailing()
      const result = replay.windowResult({ dropTabLabels: FIXTURE_ONLY_TABS })

      // Assert
      assert.deepEqual(result.fakeState, result.traceState)
      assert.equal(result.unmatchedModelBursts, 0)
      assert.equal(result.unreachedTraceBursts, 0)
      assert.equal(shownRefusals(harness), '')
    } finally {
      await harness.close()
    }
  },
)

/**
 * Cuts the Reload Window step of the take as a two-segment trace: the events after the `reload-window` mark in its segment, then every event of the segments after the reload.
 * @param trace - The parsed take.
 * @returns A trace of its own whose final state is the take's last one, and the recorded state at the mark.
 */
function reloadWindowTrace(trace: ParsedHostTrace): {
  trace: ParsedHostTrace
  start: HostStateRecord
} {
  const mark = trace.marks.find(
    (candidate) => candidate.label === 'reload-window',
  )!
  const [before, ...after] = trace.segments.slice(mark.segmentIndex)
  return {
    trace: {
      header: trace.header,
      segments: [
        { ...before!, events: before!.events.slice(mark.eventCount) },
        ...after,
      ],
      marks: [],
      finalSnapshot: trace.finalSnapshot,
      finalLayout: trace.finalLayout,
    },
    start: { snapshot: mark.snapshot!, layout: mark.layout },
  }
}

// Value: protects=the harness' model of the window after Developer: Reload Window with the Study open in VS Code 1.145.2: after the reload the Study panes do not come back and the Study's editor groups stay empty beside index.ts (the take ends with an empty first group and index.ts in the second); fails_when=the start state differs from the take's at the reload-window mark, the segment after the reload is matched against the one before, the end state differs from the take's last snapshot, or an event stays unaligned; why_new=Cycle 0094 task 12 (VS Code take, window 5, two segments); seam=recordedReaderHarness hostOrder (started bypassed), openRecording, HostOrderInterposer.runSegments, leaveEmptyGroup and the close of the captured source for what the reload leaves; no_claim=the product's reload path (the state after the reload is built by this test's own harness operations: leaveEmptyGroup and the close of the captured source), the unrecorded 3.7 s of the reload itself, that the host's own post-reload reports (2 events) are produced by the fake, Cursor, that the reader after the reload offers Open Study Workspace again (the take stops there)
test("the window state the harness builds for Reload Window with the Study open equals the take's: Study panes closed, first group empty beside index.ts", async () => {
  // Arrange
  const cut = reloadWindowTrace(recordedStudyTakeTrace())
  const harness = await recordedReaderHarness(false, false, 1, undefined, {
    hostOrder: cut.trace,
    hostOrderDelivery: 'with-operation',
    startBypassed: true,
  })
  const replay = harness.hostOrder!
  try {
    await harness.reader.close()
    // The take's state at the mark: the recording open (Recorded application in column 1, index.ts and the captured source in column 2).
    await buildRecordedStudyAtArrange(harness)
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    // The take left the captured source's group active; the fake's Recording leaves the Application's.
    harness.activateEditorGroup(2)
    replay.bypass(false)
    assertStartState(harness, cut.start, 'reload-window')

    // Act
    await replay.runSegments(
      [async (): Promise<void> => {}, async (): Promise<void> => {}],
      async (): Promise<void> => {
        // The reload empties the Application's group and keeps no pane; the captured source, a virtual document no serializer restores, is not reopened.
        harness.leaveEmptyGroup(1)
        const capturedTabs = harness.groups
          .flatMap((group) => group.tabs)
          .filter((tab) => tab.label.startsWith('Captured-'))
        await harness.editor.window.tabGroups.close(capturedTabs, true)
      },
    )
    // The host's own reports after the reload are unsolicited: the fake delivers those no burst reached.
    await replay.deliverTrailing()
    const result = replay.windowResult({ dropTabLabels: FIXTURE_ONLY_TABS })

    // Assert
    assert.deepEqual(result.fakeState, result.traceState)
    // The reload step runs before the second segment begins, so the one burst of the fake's own emptied groups and closed captured source matches no event of the first segment (which holds none after the mark).
    assert.equal(result.unmatchedModelBursts, 1)
    assert.equal(result.unreachedTraceBursts, 2)
  } finally {
    await harness.close()
  }
})
