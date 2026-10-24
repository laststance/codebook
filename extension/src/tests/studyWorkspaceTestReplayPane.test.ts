import assert from 'node:assert/strict'
import { test } from 'node:test'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import * as summaryTexts from '../utils/stripNodeHistorySummaryTexts'

import { workspaceHarness } from './studyWorkspaceHarness'
import { READER_RESULT_BOUND_MS } from './utils/readerResultBound'
import { lastView, saveTwoStopNodeHistory } from './utils/twoStopNodeHistory'

/**
 * Opens a saved test replay, closes its Application pane by hand and presses Show recorded output, for the two tests of F137.
 * @param options - `emptyGroupsClose`: whether the fake editor removes the group the closed pane left empty, as `workbench.editor.closeEmptyGroups` (on by default in VS Code) does.
 * @returns The group tabs and the editor layout's shape (the nesting of its leaves, without sizes) before the close, after it and after the press.
 */
async function pressShowRecordedOutputAfterClosingApplication(options: {
  emptyGroupsClose: boolean
}) {
  const harness = await workspaceHarness()
  try {
    if (options.emptyGroupsClose) harness.closeDisposedPanelTabsLater()
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
    const snapshot = () => ({
      groups: harness.groups.map((group) => ({
        column: group.viewColumn,
        tabs: group.tabs.map(
          (tab) =>
            (tab.input as { viewType?: string }).viewType?.split('-').at(-1) ??
            tab.label,
        ),
      })),
      layout: shapeOf(harness.editorLayout()),
    })
    const before = snapshot()
    const closedPane = harness
      .nativePanels()
      .find((panel) => panel.kind === 'codebook.scopedBrowser')
    harness.closeTabByHand(closedPane!.nativeTab)
    await waitUntil(
      () => lastView(harness)?.nodeHistorySection?.applicationClosed === true,
      'the section says the Application pane is closed',
      READER_RESULT_BOUND_MS,
    )
    // The fake editor removes the emptied group a moment after the pane's tab closed, as VS Code does.
    await waitUntil(
      () => !options.emptyGroupsClose || harness.groups.length === 2,
      'the editor removed the group the closed pane left empty',
      READER_RESULT_BOUND_MS,
    )
    const closed = snapshot()

    harness.receiveContext({
      type: 'action',
      revision: lastView(harness)!.revision,
      action: 'focus-app',
    })
    await waitUntil(
      () => lastView(harness)?.nodeHistorySection?.applicationClosed === false,
      'the section says the Application pane is back',
      READER_RESULT_BOUND_MS,
    )
    await waitUntil(
      () =>
        harness
          .nativePanels()
          .some((panel) => panel.kind === 'codebook.scopedBrowser'),
      'the Application pane exists again',
      READER_RESULT_BOUND_MS,
    )
    return { before, closed, after: snapshot() }
  } finally {
    await harness.close()
  }
}

/** Reduces an editor layout to its nesting of groups, without sizes. @example shapeOf({ orientation: 0, groups: [{ size: 1 }] }) // => [0, [null]] */
function shapeOf(layout: unknown): unknown {
  const node = layout as { orientation?: number; groups?: unknown[] }
  return node.groups
    ? [node.orientation, node.groups.map((child) => shapeOf(child))]
    : null
}

// Value: protects=Show recorded output brings a closed Application pane back above the recorded source in a group of its own when the editor removed the emptied group (workbench.editor.closeEmptyGroups, on by default), with the composition's other groups where they were (the Study pane's before Cycle 0051; moves with D8, F123); fails_when=open() rebuilds the pane as a tab of the source's group and the arrangement moves the other groups (the defect VS Code 1.142.0 showed); why_new=F137: the first fix (D21) only asserted that arrange ran, and a native check falsified it; seam=the workspace harness's group model with closeDisposedPanelTabsLater (the editor removes the emptied group), closeTabByHand and the Study pane's focus-app action; no_claim=the native placement itself, which the driving agent checks in VS Code and Cursor
test('Show recorded output puts a closed Application pane back above the recorded source in its own group when the editor removed the emptied group', async () => {
  // Arrange & Act
  const { before, closed, after } =
    await pressShowRecordedOutputAfterClosingApplication({
      emptyGroupsClose: true,
    })

  // Assert: the summary composition (Cycle 0051, DS-A) has no Study pane; its third group stands where it was, as in a browser replay's composition.
  assert.deepEqual(before.groups, [
    { column: 1, tabs: ['codebook.scopedBrowser'] },
    { column: 3, tabs: [] },
    { column: 2, tabs: ['Captured-theme.ts'] },
  ])
  assert.deepEqual(closed.groups, [
    { column: 2, tabs: [] },
    { column: 1, tabs: ['Captured-theme.ts'] },
  ])
  assert.deepEqual(after.groups, before.groups)
  // The Application group and the source's share the left column, and the Study pane's group stays the right column.
  assert.deepEqual(after.layout, before.layout)
})

// Value: protects=Show recorded output puts a closed Application pane back into the group the editor kept empty (workbench.editor.closeEmptyGroups off), so no extra group stands beside it; fails_when=the pane gets a second new group and the kept empty group stays, or the source's tabs are split; why_new=F137: the group-of-its-own fix must not add a group where the emptied one still exists; seam=the workspace harness's group model without group removal, closeTabByHand and the Study pane's focus-app action; no_claim=the native placement itself, which the driving agent checks in VS Code and Cursor
test('Show recorded output reuses the emptied group of the closed Application pane when the editor kept it', async () => {
  // Arrange & Act
  const { before, closed, after } =
    await pressShowRecordedOutputAfterClosingApplication({
      emptyGroupsClose: false,
    })

  // Assert: the summary composition (Cycle 0051, DS-A) has no Study pane.
  assert.deepEqual(closed.groups, [
    { column: 1, tabs: [] },
    { column: 3, tabs: [] },
    { column: 2, tabs: ['Captured-theme.ts'] },
  ])
  assert.deepEqual(after.groups, before.groups)
  assert.deepEqual(after.layout, before.layout)
})

// Value: protects=the test names of Saved studies' catalog reach the Study message without bidirectional or terminal controls, so a U+202E in a recorded test title cannot reorder what the reader prints about a saved test replay; fails_when=the catalog entry keeps the title's U+202E; why_new=F131 (P2A hand-off): the strip applied to the selected replay only, and the catalog rows were left out; seam=none; no_claim=the Application and Study views of the selected replay (sanitizeNodeTestHistory's tests)
test('a U+202E in a recorded test title does not reach the Saved studies catalog the Study message carries', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await saveTwoStopNodeHistory(
      harness.service.nodeHistoryStore!,
      ['theme', 'applies \u202Edark\u202C mode'],
    )

    // Act
    await harness.reader.action('retry')
    await harness.reader.openLearningReplay(history.studyId)
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistoryPosition?.sequence === 2 &&
        !lastView(harness)?.loading,
      'the test replay lands on its first stop',
      READER_RESULT_BOUND_MS,
    )
    const entry = lastView(harness)?.nodeHistoryCatalog?.[0]

    // Assert
    assert.equal(entry?.testFile, 'src/theme.test.ts')
    assert.deepEqual(entry?.testTitles, ['theme', 'applies dark mode'])
  } finally {
    await harness.close()
  }
})

// Value: protects=the cost of each Study message: the Saved studies catalog's test files and titles are stripped once when the catalog is listed, not again for every Study message (built at each publish, four a second while a replay plays or the reader refreshes); fails_when=each Study message strips every saved replay's test file and titles again; why_new=F326 (PR-2 /ship Step 9 pass 2 performance): message() mapped the whole catalog through the strip at every call; seam=the strip module's export, counted; no_claim=the strip's own result (the test above)
test('building the Study message again does not strip the Saved studies catalog again', async (context) => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await saveTwoStopNodeHistory(
      harness.service.nodeHistoryStore!,
      ['theme', 'applies dark mode'],
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
    const strip = context.mock.method(
      summaryTexts,
      'stripNodeHistorySummaryTexts',
    )

    // Act: five Study messages, as five publishes build them.
    const messages = Array.from({ length: 5 }, () =>
      harness.reader['message'](),
    )

    // Assert
    assert.equal(strip.mock.callCount(), 0)
    assert.deepEqual(messages.at(-1)?.nodeHistoryCatalog?.[0]?.testTitles, [
      'theme',
      'applies dark mode',
    ])
  } finally {
    await harness.close()
  }
})

// Value: protects=Saved studies keeps the test replays it listed when a later refresh cannot list them, and the archive line says why; fails_when=a refresh whose listing fails empties the list, so every saved test replay's row goes until a later refresh succeeds, or the failure is silent; why_new=F331 (PR-2 /ship Step 7 re-entry): only a failure of the first listing was tested, and F326 moved both listings into one helper; seam=the reader's history store, whose listing the refresh is refused; no_claim=the archive line's wording
test('a refresh that cannot list the test replays keeps the ones Saved studies showed and reports it', async (context) => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await saveTwoStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.open()
    await harness.reader.action('retry')
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistoryCatalog?.some(
          (entry) => entry.studyId === history.studyId,
        ) === true,
      'the test replay is listed',
      READER_RESULT_BOUND_MS,
    )
    context.mock.method(harness.reader['nodeHistoryStore']!, 'list', () =>
      Promise.reject(
        Object.assign(new Error('EIO: i/o error, scandir'), { code: 'EIO' }),
      ),
    )

    // Act
    await harness.reader['refresh']()

    // Assert
    assert.deepEqual(
      harness.reader['message']().nodeHistoryCatalog?.map(
        (entry) => entry.studyId,
      ),
      [history.studyId],
    )
    assert.equal(
      harness.reader.inspect().view?.errors.some((error) => /EIO/.test(error)),
      true,
    )
  } finally {
    await harness.close()
  }
})
