import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'

import { workspaceHarness, openRetainedStudy } from './studyWorkspaceHarness'

type Harness = Awaited<ReturnType<typeof workspaceHarness>>

/**
 * Adds a group of the learner's to the right of the Study panes, with two unrelated editors in it.
 * @param harness - The reader and the fake editor.
 * @returns The new group itself, so a test can tell it from every other group after the recovery.
 * @example const group = await addLearnerGroup(harness) // => group.viewColumn 4 beside three Study groups
 */
async function addLearnerGroup(
  harness: Harness,
): Promise<Harness['groups'][number]> {
  const column = harness.groups.length + 1
  await harness.editor.commands.executeCommand('vscode.setEditorLayout', {
    orientation: 0,
    groups: Array.from({ length: column }, () => ({})),
  })
  harness.focusMutableDraft('data.ts', column)
  harness.focusMutableDraft('search.tsx', column)
  return harness.groups.find((group) => group.viewColumn === column)!
}

/**
 * Describes where the learner's two files stand after a recovery: whether the learner's own group is still open, and which learner files it holds.
 * @param harness - The reader and the fake editor.
 * @param group - The learner group recorded before the recovery.
 * @returns The group's open state, column and its learner file labels.
 * @example learnerGroupAfter(harness, group) // => { open: true, column: 4, files: ['data.ts', 'search.tsx'] }
 */
function learnerGroupAfter(
  harness: Harness,
  group: Harness['groups'][number],
): { open: boolean; column: number; files: string[] } {
  return {
    open: harness.groups.includes(group),
    column: group.viewColumn,
    files: group.tabs
      .map((tab) => tab.label)
      .filter((label) => label === 'data.ts' || label === 'search.tsx'),
  }
}

const recoveries: readonly (readonly [
  string,
  (harness: Harness) => Promise<void>,
])[] = [
  [
    'one Arrange Study Workspace',
    async (harness): Promise<void> => {
      await harness.reader.action('arrange')
    },
  ],
  [
    'the Study pane’s Restore Study workspace layout alone',
    async (harness): Promise<void> => {
      // The Study pane's button runs the same action as the pane (fromPane true), without the command's focus step.
      await harness.reader.action('arrange', true)
    },
  ],
  [
    'Codebook: Focus Application followed by Arrange Study Workspace',
    async (harness): Promise<void> => {
      await harness.reader.action('focus-app')
      await harness.reader.action('arrange')
    },
  ],
]

for (const [recovery, run] of recoveries)
  // Value: protects=a learner whose captured source tab stands in a leftover editor group beside two of their own files gets the Study layout confirmed by the public recovery, with both files still open; fails_when=Arrange refuses with "More than three editor groups are open" or the Study pane keeps "The application or source pane is no longer in its Study destination", and the source tab never returns to the Study source column; why_new=Cycle 0072 task 1 (N71 VS Code attempts 1-2, N70b); seam=the workspace harness with a fourth editor group, moveSource and the reader's arrange and focus-app actions; no_claim=the failed run itself is not run: the retained Study stands in for the window it leaves, and native VS Code behaviour is C72-1's
  test(`${recovery} confirms the Study layout and keeps the learner's files when the captured source stands in a fourth editor group`, async () => {
    // Arrange: Study panes in columns 1-3, data.ts and search.tsx in a fourth group, the captured source tab moved into that group.
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    try {
      await openRetainedStudy(harness)
      const learnerGroup = await addLearnerGroup(harness)
      harness.moveSource(learnerGroup.viewColumn)
      assert.equal(
        harness.reader.presentationState().layoutConfirmed,
        false,
        'the setup must start from the refused state',
      )
      // Act
      await run(harness)
      // Assert
      const state = harness.reader.presentationState()
      assert.deepEqual(
        { layoutConfirmed: state.layoutConfirmed, reason: state.reason },
        { layoutConfirmed: true, reason: undefined },
      )
      assert.deepEqual(learnerGroupAfter(harness, learnerGroup), {
        open: true,
        column: 4,
        files: ['data.ts', 'search.tsx'],
      })
      assert.equal(harness.sourceColumn(), 2)
    } finally {
      await harness.close()
    }
  })

for (const [recovery, run] of recoveries)
  // Value: protects=the native C72-1 state: a run that follows the current run shows the Application and the captured source in two groups, the learner moved the run's Captured source tab into their own third group beside data.ts and search.tsx, and the public recovery shows the source in its Study column again, confirms the layout and keeps every learner tab; fails_when=Arrange answers with no error and moves nothing, so the Study pane keeps "The application or source pane is no longer in its Study destination" (panes {appColumn 1, sourceColumn 3}); why_new=Cycle 0072 task 1 after native C72-1 on 0.2.73.0 falsified the four-group model; seam=the workspace harness with a started run and its viewport (the following composition, no Study pane in the editor), a learner group, moveSource and the reader's actions; no_claim=the run's failure (RUNTIME_FAILED) is not run, and the old captured tab of the saved study is not modelled; native VS Code is C72-1's
  test(`${recovery} confirms the layout of a following run and keeps the learner's files when its captured source stands in the learner's third group`, async () => {
    // Arrange: a started run follows in two groups, the learner's group holds data.ts and search.tsx, and the run's captured source tab was moved into it.
    const harness = await workspaceHarness()
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    let live: { close(): void } | undefined
    try {
      const receipt = harness.service.start({
        instanceId: harness.service.instanceId,
        profile: 'repository-browser',
        configuration: harness.configuration,
        key: randomUUID(),
      })
      await harness.service.record(receipt).preparation
      await harness.reader.open()
      live = await harness.reader.presentation.createViewport(
        receipt.runId,
        () => {},
        () => {},
        'normal',
      )
      const learnerGroup = await addLearnerGroup(harness)
      harness.moveSource(learnerGroup.viewColumn)
      assert.deepEqual(
        {
          layoutConfirmed: harness.reader.presentationState().layoutConfirmed,
          groups: harness.groups.length,
        },
        { layoutConfirmed: false, groups: 3 },
      )
      // Act
      await run(harness)
      // Assert
      const state = harness.reader.presentationState()
      assert.deepEqual(
        { layoutConfirmed: state.layoutConfirmed, reason: state.reason },
        { layoutConfirmed: true, reason: undefined },
      )
      assert.deepEqual(learnerGroupAfter(harness, learnerGroup), {
        open: true,
        column: 3,
        files: ['data.ts', 'search.tsx'],
      })
      assert.equal(harness.sourceColumn(), 2)
    } finally {
      live?.close()
      await harness.close()
    }
  })

// Value: protects=the learner's newer Study request while Arrange is bringing the captured source back from a learner group: the second request is refused at once with the pending-change sentence and never places panes over the first; fails_when=the return starts no presentation transition, so a second Restore starts during the first one's document open and both place the source and move the keyboard; why_new=Cycle 0072 task 1 CodeRabbit CLI Major (the return awaited a document open without owning the transition); seam=the workspace harness with a fourth editor group, holdNextSource on the captured source and the reader's changePresentation; no_claim=the harness holds the document open, not the editor's real latency
test('a second Restore during the captured source’s return is refused with the pending-change sentence and the first Arrange still confirms the layout', async () => {
  // Arrange: the captured source stands in the learner's fourth group and its document open is held.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  let release = (): void => {}
  try {
    await openRetainedStudy(harness)
    harness.moveSource((await addLearnerGroup(harness)).viewColumn)
    const before = harness.reader.presentationState()
    const held = harness.holdNextSource({
      uri: harness.reader.inspect().sourceUri!,
    })
    release = held.release
    // Act: Arrange starts and waits in the document open; a second Restore of the same revision arrives.
    const arranging = harness.reader.action('arrange')
    await held.started
    await assert.rejects(
      async () =>
        harness.reader.changePresentation({
          presentationId: before.presentationId,
          expectedRevision: before.presentationControlRevision,
          mode: 'study-workspace',
          action: 'restore',
        }),
      {
        code: 'PRESENTATION_UNAVAILABLE',
        message: /presentation change or reader close is pending/,
      },
    )
    held.release()
    await arranging
    // Assert
    const state = harness.reader.presentationState()
    assert.deepEqual(
      { layoutConfirmed: state.layoutConfirmed, reason: state.reason },
      { layoutConfirmed: true, reason: undefined },
    )
  } finally {
    release()
    await harness.close()
  }
})

// Value: protects=a learner's pinned copy of the captured source in their own group: Arrange shows the source in its Study column, confirms the layout and leaves the pinned copy open and pinned; fails_when=Arrange closes the pinned tab (the learner loses the tab and its pin); why_new=Cycle 0072 task 1 CodeRabbit CLI Major (the close ignored isPinned, as retireMovedSourceCopies does not); seam=the workspace harness with a fourth editor group, moveSource and a pinned moved tab; no_claim=an unpinned copy's close is covered by the recovery tests above
test('Arrange Study Workspace keeps the learner’s pinned copy of the captured source open in their group and confirms the layout', async () => {
  // Arrange: the captured source stands pinned in the learner's fourth group.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await openRetainedStudy(harness)
    const learnerGroup = await addLearnerGroup(harness)
    harness.moveSource(learnerGroup.viewColumn)
    const sourceUri = harness.reader.inspect().sourceUri
    const pinned = learnerGroup.tabs.find(
      (tab) =>
        tab.input !== undefined &&
        'uri' in tab.input &&
        tab.input.uri.toString() === sourceUri,
    )!
    pinned.isPinned = true
    // Act
    await harness.reader.action('arrange')
    // Assert
    const state = harness.reader.presentationState()
    assert.deepEqual(
      {
        layoutConfirmed: state.layoutConfirmed,
        reason: state.reason,
        pinnedStillOpen: learnerGroup.tabs.includes(pinned),
        pinned: pinned.isPinned,
        sourceColumn: harness.sourceColumn(),
      },
      {
        layoutConfirmed: true,
        reason: undefined,
        pinnedStillOpen: true,
        pinned: true,
        sourceColumn: 2,
      },
    )
  } finally {
    await harness.close()
  }
})
