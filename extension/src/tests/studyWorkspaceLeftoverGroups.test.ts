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

// Value: protects=the refusal a Restore gets while a control (Click, Continue, Stop) or a Live Return runs, also when the captured source stands in a learner group: the same "Wait for the current control…" sentence as before, with nothing moved; fails_when=the return's predicate skips the admission conditions, so show and close run beside the control and the source leaves the learner's group; why_new=Cycle 0072 task 1 second CodeRabbit CLI round (Major); seam=the workspace harness with a fourth editor group, the reader's busy marker and changePresentation; no_claim=the busy marker is set by hand, not by a real control
test('a Restore while a control runs is refused with the wait sentence and leaves the captured source in the learner’s group', async () => {
  // Arrange: the captured source stands in the learner's fourth group and a control is running.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await openRetainedStudy(harness)
    harness.moveSource((await addLearnerGroup(harness)).viewColumn)
    const before = harness.reader.presentationState()
    harness.reader['busy'] = Symbol('control')
    // Act
    const refusal = assert.rejects(
      async () =>
        harness.reader.changePresentation({
          presentationId: before.presentationId,
          expectedRevision: before.presentationControlRevision,
          mode: 'study-workspace',
          action: 'restore',
        }),
      {
        code: 'PRESENTATION_UNAVAILABLE',
        message: /Wait for the current control, source or navigation/,
      },
    )
    await refusal
    harness.reader['busy'] = undefined
    // Assert
    assert.equal(harness.sourceColumn(), 4)
  } finally {
    harness.reader['busy'] = undefined
    await harness.close()
  }
})

// Value: protects=the learner's click into another tab right after Arrange: the return stops, the learner's tab keeps the keyboard and the source is not shown over it; fails_when=the return shows the captured source with the keyboard after the learner's click, so the learner's choice is taken back; why_new=Cycle 0072 task 1 second review round (OCR M1); seam=the workspace harness with a fourth editor group, holdNextSource on the captured source and focusMutableDraft as the learner's click; no_claim=the click is the harness's focus of a draft, not a real pointer event
test('a learner’s click into another tab while Arrange returns the captured source keeps that tab focused and does not show the source over it', async () => {
  // Arrange: the captured source stands in the learner's fourth group and its document open is held.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  let release = (): void => {}
  try {
    await openRetainedStudy(harness)
    harness.moveSource((await addLearnerGroup(harness)).viewColumn)
    const held = harness.holdNextSource({
      uri: harness.reader.inspect().sourceUri!,
    })
    release = held.release
    const arranging = harness.reader.action('arrange')
    await held.started
    // Act: the learner clicks data.ts in their group, then the open finishes.
    harness.focusMutableDraft('data.ts', 4)
    held.release()
    await arranging
    // Assert
    assert.deepEqual(
      {
        activeFile: harness.editor.window.activeTextEditor?.document.uri.fsPath
          .split('/')
          .pop(),
        sourceColumn: harness.sourceColumn(),
        layoutConfirmed: harness.reader.presentationState().layoutConfirmed,
      },
      { activeFile: 'data.ts', sourceColumn: 4, layoutConfirmed: false },
    )
  } finally {
    release()
    await harness.close()
  }
})

// Value: protects=the recovery of a learner who added a fourth group, whose status was read by the chat (which retires the Study's confirmation because the grid changed), and who then moved the captured source into it: Arrange confirms the layout and keeps the group; fails_when=the return decides its short confirmation from the retired confirmation flag, so Restore falls to the full placement and answers "The Study panes changed during Restore"; why_new=Cycle 0072 task 1 CodeRabbit CLI pass 3 (Major); seam=the workspace harness, readPresentationState as the chat's status read, a fourth editor group and moveSource; no_claim=the status read is the reader's own, not a real chat tool call
test('Arrange confirms the layout after a status read retired the confirmation of a grid that gained a learner group and the captured source moved into it', async () => {
  // Arrange: a confirmed Study, a fourth learner group, a status read that retires the confirmation, then the captured source moved into that group.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await openRetainedStudy(harness)
    const learnerGroup = await addLearnerGroup(harness)
    const read = await harness.reader.readPresentationState()
    harness.moveSource(learnerGroup.viewColumn)
    // Act
    await harness.reader.action('arrange')
    // Assert
    const state = harness.reader.presentationState()
    assert.deepEqual(
      {
        readConfirmed: read.layoutConfirmed,
        layoutConfirmed: state.layoutConfirmed,
        reason: state.reason,
        sourceColumn: harness.sourceColumn(),
        learnerGroup: learnerGroupAfter(harness, learnerGroup),
      },
      {
        readConfirmed: false,
        layoutConfirmed: true,
        reason: undefined,
        sourceColumn: 2,
        learnerGroup: {
          open: true,
          column: 4,
          files: ['data.ts', 'search.tsx'],
        },
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the revision rule after the captured source's return: a second control that still holds the revision of the request that was answered is refused as stale; fails_when=the confirmed answer of the return keeps the old control revision, so a stale control is admitted; why_new=Cycle 0072 task 1 second review round (OCR M2); seam=the workspace harness with a fourth editor group, the reader's arrange action and changePresentation; no_claim=none beyond protects
test('a control holding the revision from before Arrange is refused as stale after the captured source returned', async () => {
  // Arrange: the captured source stands in the learner's fourth group.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await openRetainedStudy(harness)
    harness.moveSource((await addLearnerGroup(harness)).viewColumn)
    const before = harness.reader.presentationState()
    // Act
    await harness.reader.action('arrange')
    // Assert
    assert.equal(harness.reader.presentationState().layoutConfirmed, true)
    await assert.rejects(
      async () =>
        harness.reader.changePresentation({
          presentationId: before.presentationId,
          expectedRevision: before.presentationControlRevision,
          mode: 'study-workspace',
          action: 'restore',
        }),
      { code: 'STALE_PRESENTATION' },
    )
  } finally {
    await harness.close()
  }
})

for (const [window, following] of [
  ['a fourth learner group beside the Study', false],
  ['a third learner group beside a following run', true],
] as const)
  // Value: protects=a second Arrange or Restore after the first one returned the captured source from a learner group: it keeps the confirmed layout and the learner group; fails_when=the second request falls to the full placement, which refuses "More than three editor groups are open" and unconfirms the layout, so every later Restore fails; why_new=Cycle 0072 task 1 candidate Codex review P2 (1); seam=the workspace harness, moveSource and two arrange actions; no_claim=none beyond protects
  test(`a second Arrange after the first returned the captured source keeps the layout confirmed with ${window}`, async () => {
    // Arrange: the first Arrange returned the source from the learner's group.
    const harness = await workspaceHarness(following)
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    let live: { close(): void } | undefined
    try {
      if (following) {
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
      } else await openRetainedStudy(harness)
      const learnerGroup = await addLearnerGroup(harness)
      harness.moveSource(learnerGroup.viewColumn)
      await harness.reader.action('arrange')
      // Act
      await harness.reader.action('arrange')
      // Assert
      const state = harness.reader.presentationState()
      assert.deepEqual(
        {
          layoutConfirmed: state.layoutConfirmed,
          reason: state.reason,
          learnerGroup: learnerGroupAfter(harness, learnerGroup),
        },
        {
          layoutConfirmed: true,
          reason: undefined,
          learnerGroup: {
            open: true,
            column: following ? 3 : 4,
            files: ['data.ts', 'search.tsx'],
          },
        },
      )
    } finally {
      live?.close()
      await harness.close()
    }
  })

// Value: protects=a learner's click into data.ts while the editor's show of the captured source is still pending: the learner keeps the keyboard, the return shows the source without taking it and stops; fails_when=the show takes the keyboard (preserveFocus false) and the learner's file loses it; why_new=Cycle 0072 task 1 candidate Codex review P2 (2); seam=the workspace harness's holdNextTextDocumentShow and focusMutableDraft as the learner's click; no_claim=the click is the harness's focus of a draft
test('a learner’s click into their file while the show of the captured source is pending keeps the keyboard in that file', async () => {
  // Arrange: the captured source stands in the learner's fourth group and the editor's show of it is held.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  let release = (): void => {}
  try {
    await openRetainedStudy(harness)
    harness.moveSource((await addLearnerGroup(harness)).viewColumn)
    const held = harness.holdNextTextDocumentShow({
      uri: harness.reader.inspect().sourceUri!,
    })
    release = held.release
    const arranging = harness.reader.action('arrange')
    await held.started
    // Act
    harness.focusMutableDraft('data.ts', 4)
    held.release()
    await arranging
    // Assert
    assert.equal(
      harness.editor.window.activeTextEditor?.document.uri.fsPath
        .split('/')
        .pop(),
      'data.ts',
    )
  } finally {
    release()
    await harness.close()
  }
})

// Value: protects=the pane sizes of a following run after Arrange returned a captured source the learner moved into the Application's group and resized the panes: the layout reads confirmed only with the sizes of the arrangement back; fails_when=the return answers confirmed from the old confirmation flag and the resized 80:20 panes stay; why_new=Cycle 0072 task 1 candidate Codex review of 81c749f1 (P2); seam=the workspace harness with a started run, moveSource into column 1 and setEditorLayout; no_claim=the native sizes of the editor, only the fake layout
test('Arrange after the captured source moved into the Application’s group and the panes were resized confirms only with the arranged sizes back', async () => {
  // Arrange: a following run, its captured source moved into column 1, the two panes resized.
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
    const arranged = harness.editorLayout()
    harness.moveSource(1)
    await harness.editor.commands.executeCommand('vscode.setEditorLayout', {
      orientation: 0,
      groups: [{ size: 0.8 }, { size: 0.2 }],
    })
    // Act
    await harness.reader.action('arrange')
    // Assert
    assert.deepEqual(
      {
        layoutConfirmed: harness.reader.presentationState().layoutConfirmed,
        layout: harness.editorLayout(),
        sourceColumn: harness.sourceColumn(),
      },
      { layoutConfirmed: true, layout: arranged, sourceColumn: 2 },
    )
  } finally {
    live?.close()
    await harness.close()
  }
})

// Value: protects=the stopped line of a captured source that Arrange returned from a learner group: the returned editor's caret stands on the stopped line, so a long file shows it; fails_when=the return opens the editor without a selection and the file shows its top; why_new=Cycle 0072 task 1 CodeRabbit CLI pass 5 (minor 1); seam=the workspace harness's source editor selections; no_claim=the native scroll position, only the selection that reveals it
test('Arrange puts the caret of the returned captured source on the stopped line', async () => {
  // Arrange: the captured source stands in the learner's fourth group.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await openRetainedStudy(harness)
    harness.moveSource((await addLearnerGroup(harness)).viewColumn)
    const stoppedLine = harness.reader.inspect().view!.model.source.line - 1
    // Act
    await harness.reader.action('arrange')
    // Assert
    const returned = harness.editor.window.visibleTextEditors.find(
      (editor) =>
        editor.viewColumn === 2 &&
        editor.document.uri.toString() === harness.reader.inspect().sourceUri,
    )
    assert.deepEqual(
      {
        stoppedLineIsTheCaret:
          returned?.selections[0]?.active.line === stoppedLine,
        stoppedLine,
      },
      { stoppedLineIsTheCaret: true, stoppedLine },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the revision rule while the preference of a confirmed return is being saved: a second control during the save is refused with the pending sentence; fails_when=the return releases its transition before the save, so a control reading the new revision is admitted mid-save; why_new=Cycle 0072 task 1 CodeRabbit CLI pass 5 (minor 2); seam=the workspace harness's holdPresentationPreference and changePresentation; no_claim=none beyond protects
test('a second control during the preference save of a returned captured source is refused with the pending sentence', async () => {
  // Arrange: the captured source stands in the learner's fourth group and the preference write is held.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  let release = (): void => {}
  try {
    await openRetainedStudy(harness)
    harness.moveSource((await addLearnerGroup(harness)).viewColumn)
    const held = harness.holdPresentationPreference()
    release = held.release
    const arranging = harness.reader.action('arrange')
    await held.started
    const during = harness.reader.presentationState()
    // Act
    await assert.rejects(
      async () =>
        harness.reader.changePresentation({
          presentationId: during.presentationId,
          expectedRevision: during.presentationControlRevision,
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
    assert.equal(harness.reader.presentationState().layoutConfirmed, true)
  } finally {
    release()
    await harness.close()
  }
})

// Value: protects=Close Study Workspace while Arrange is returning the captured source: Close waits for the return, so no Codebook-owned captured-source tab is left or reopened after the cleanup; fails_when=the return is not registered as the presentation operation, Close cleans up at once and the late show opens the captured source again; why_new=Cycle 0072 task 1 CodeRabbit CLI pass 4 (A); seam=the workspace harness's holdNextTextDocumentShow, the reader's arrange and close; no_claim=none beyond protects
test('Close Study Workspace during the captured source’s return leaves no captured-source tab open once both have finished', async () => {
  // Arrange: the captured source stands in the learner's fourth group and the editor's show of it is held.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  let release = (): void => {}
  try {
    await openRetainedStudy(harness)
    harness.moveSource((await addLearnerGroup(harness)).viewColumn)
    const held = harness.holdNextTextDocumentShow({
      uri: harness.reader.inspect().sourceUri!,
    })
    release = held.release
    const arranging = harness.reader.action('arrange').catch(() => undefined)
    await held.started
    // Act: the learner closes the Study workspace, then the held show finishes.
    const closing = harness.reader.close()
    held.release()
    await arranging
    await closing
    // Assert
    assert.deepEqual(
      harness.groups
        .flatMap((group) => group.tabs.map((tab) => tab.label))
        .filter((label) => label.startsWith('Captured-')),
      [],
    )
  } finally {
    release()
    await harness.close()
  }
})

// Value: protects=the returned source's stopped line and annotation: the editor the return opens in the Study source column is decorated like the ordinary placement decorates it; fails_when=the new editor gets no decoration, so the stopped line is not marked after Arrange; why_new=Cycle 0072 task 1 candidate Codex review P2 (3); seam=the workspace harness's decoratedColumns of the source highlight; no_claim=the Recorded annotation of a live source view is not asserted here
test('Arrange marks the stopped line in the editor it returns the captured source to', async () => {
  // Arrange: the captured source stands in the learner's fourth group; earlier decoration calls are forgotten.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await openRetainedStudy(harness)
    harness.moveSource((await addLearnerGroup(harness)).viewColumn)
    harness.clearDecorations()
    // Act
    await harness.reader.action('arrange')
    // Assert
    assert.equal(harness.decoratedColumns().includes(2), true)
  } finally {
    await harness.close()
  }
})

// Value: protects=the keyboard of the request: Arrange gave the Study pane the keyboard and it is still there after the captured source returned; fails_when=the return takes the keyboard into the Captured source in column 2; why_new=Cycle 0072 task 1 candidate Codex review P2 (4); seam=the workspace harness's active tab group; no_claim=a chat holding the keyboard is not modelled
test('Arrange leaves the keyboard in the Study pane after the captured source returned', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await openRetainedStudy(harness)
    harness.moveSource((await addLearnerGroup(harness)).viewColumn)
    // Act
    await harness.reader.action('arrange')
    // Assert
    assert.equal(harness.editor.window.tabGroups.activeTabGroup.viewColumn, 3)
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's group when it holds nothing but the moved copy of the captured source: Arrange leaves the group open and the layout confirmed; fails_when=Arrange closes the last tab, the editor closes the emptied group and the learner's group is gone; why_new=Cycle 0072 task 1 candidate Codex review P2 (5); seam=the workspace harness with a fourth group that holds only the moved copy and the editor closing emptied groups; no_claim=none beyond protects
test('Arrange keeps the learner’s group open when it holds only the moved copy of the captured source', async () => {
  // Arrange: a fourth group holds only the moved copy.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.closeDisposedPanelTabsLater()
  try {
    await openRetainedStudy(harness)
    await harness.editor.commands.executeCommand('vscode.setEditorLayout', {
      orientation: 0,
      groups: [{}, {}, {}, {}],
    })
    const learnerGroup = harness.groups.find((group) => group.viewColumn === 4)!
    harness.moveSource(4)
    // Act
    await harness.reader.action('arrange')
    // Assert
    const state = harness.reader.presentationState()
    assert.deepEqual(
      {
        groupOpen: harness.groups.includes(learnerGroup),
        layoutConfirmed: state.layoutConfirmed,
      },
      { groupOpen: true, layoutConfirmed: true },
    )
  } finally {
    await harness.close()
  }
})
