import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'

import { PRESENTATION_READY_TIMEOUT_MS } from '../constants'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import type { CodebookDiagnostic } from '../utils/formatCodebookDiagnostic'

import {
  openRetainedStudy,
  recordedReaderHarness,
  workspaceHarness,
} from './studyWorkspaceHarness'
import { createConfiguredStudy } from './utils/createConfiguredStudy'
import {
  advanceClockUntil,
  advanceClockUntilSettled,
  enableFakeClock,
  resetFakeClock,
} from './utils/fakeClock'

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
 * Opens a saved study whose stop is on line 3 of a four-line captured source, so a caret or highlight on the stopped line is told from the first line.
 * @param harness - The reader and the fake editor.
 * @returns The zero-based stopped line, 2.
 * @example const stoppedLine = await openRetainedStudyStoppedAtLineThree(harness)
 */
async function openRetainedStudyStoppedAtLineThree(
  harness: Harness,
): Promise<number> {
  const library = await harness.reader.learningStorage()
  const base = createConfiguredStudy('first\nsecond\nthird\nfourth\n', 4)
  // The stop is declared on line 3 and observed there, so the study stays sealed.
  const configuration = {
    ...base.configuration,
    source: { ...base.configuration.source, line: 3 },
  }
  const study = {
    ...base,
    workspaceKey: library.workspaceKey,
    configuration,
    configurationHash: sha256(JSON.stringify(configuration)),
  }
  study.observations[0]!.source.line = 3
  await library.saveStudy(study)
  await harness.reader.open()
  harness.receive({
    type: 'history',
    revision: harness.reader.inspect().view!.revision,
    studyId: study.id,
  })
  await waitUntil(
    () =>
      harness.reader.inspect().view!.model.selection.studyId === study.id &&
      !harness.reader.inspect().view!.loading,
    'retained repository source stopped on line 3',
    1_000,
  )
  return harness.reader.inspect().view!.model.source.line - 1
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

// Value: protects=the pane sizes of a later Restore after a captured source return: a resized grid is measured again and not confirmed from the return's receipt; fails_when=the later Restore answers confirmed from the receipt marker and the resized 80:20 panes stay; why_new=Cycle 0072 task 1 candidate Codex review of c6bd53f0 (P2 1); seam=the workspace harness with a started run, two arrange actions, moveSource into column 1 and setEditorLayout; no_claim=the native sizes of the editor
test('a later Arrange measures the grid again and restores resized panes instead of confirming from the return’s receipt', async () => {
  // Arrange: a following run whose captured source was returned by one Arrange, then the learner resized the panes.
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
    await harness.reader.action('arrange')
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
      },
      { layoutConfirmed: true, layout: arranged },
    )
  } finally {
    live?.close()
    await harness.close()
  }
})

// Value: protects=the transition of a repeated Restore after a captured source return: it owns the transition through its preference save, so a second control is refused; fails_when=the repeated Restore, with no moved copy left, runs without the transition and a control is admitted mid-save; why_new=Cycle 0072 task 1 candidate Codex review of c6bd53f0 (P2 2); seam=the workspace harness's holdPresentationPreference and changePresentation; no_claim=none beyond protects
test('a repeated Arrange after the captured source returned refuses a second control during its preference save', async () => {
  // Arrange: the first Arrange returned the source from the learner's fourth group.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  let release = (): void => {}
  try {
    await openRetainedStudy(harness)
    harness.moveSource((await addLearnerGroup(harness)).viewColumn)
    await harness.reader.action('arrange')
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

// Value: protects=a learner's click into another group while the editor closes the moved copy that had the keyboard: the learner's choice is kept and the source is not shown over it; fails_when=the return shows the source with the keyboard after the close whatever the learner did meanwhile; why_new=Cycle 0072 task 1 candidate Codex review of c6bd53f0 (P2 3); seam=the workspace harness's holdNextTabCloseResponse and focusMutableDraft as the learner's click; no_claim=the click is the harness's focus of a draft
test('a learner’s click into another group while the moved copy closes keeps that file focused', async () => {
  // Arrange: the moved copy has the keyboard in the learner's fourth group and the editor's answer to its close is held.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  let release = (): void => {}
  try {
    await openRetainedStudy(harness)
    harness.moveSource((await addLearnerGroup(harness)).viewColumn)
    const before = harness.reader.presentationState()
    const held = harness.holdNextTabCloseResponse()
    release = held.release
    const restoring = harness.reader
      .changePresentation(
        {
          presentationId: before.presentationId,
          expectedRevision: before.presentationControlRevision,
          mode: 'study-workspace',
          action: 'restore',
        },
        'agent',
      )
      .catch(() => undefined)
    await held.started
    // Act: the learner clicks into data.ts of the first group, then the close answers.
    harness.focusMutableDraft('data.ts', 1)
    held.release()
    await restoring
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

// Value: protects=the layout receipt after a return that confirmed a grid with a learner group: a later status read still reads the layout confirmed; fails_when=the receipt keeps the earlier grid, so the next status read calls the learner group a changed grid and retires the confirmation; why_new=Cycle 0072 task 1 candidate Codex review of c6bd53f0 (P2 4); seam=the workspace harness, readPresentationState after Arrange; no_claim=none beyond protects
test('a status read after the captured source returned beside a learner group still reads the layout confirmed', async () => {
  // Arrange: the captured source stands in the learner's fourth group.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await openRetainedStudy(harness)
    harness.moveSource((await addLearnerGroup(harness)).viewColumn)
    await harness.reader.action('arrange')
    // Act
    const read = await harness.reader.readPresentationState()
    // Assert
    assert.deepEqual(
      { layoutConfirmed: read.layoutConfirmed, reason: read.reason },
      { layoutConfirmed: true, reason: undefined },
    )
  } finally {
    await harness.close()
  }
})

for (const [recovery, run] of [
  [
    'Arrange Study Workspace',
    async (harness: Harness): Promise<void> => {
      await harness.reader.action('arrange')
    },
  ],
  [
    'the presentation restore the chat calls',
    async (harness: Harness): Promise<void> => {
      const state = harness.reader.presentationState()
      await harness.reader.changePresentation(
        {
          presentationId: state.presentationId,
          expectedRevision: state.presentationControlRevision,
          mode: 'study-workspace',
          action: 'restore',
        },
        'agent',
      )
    },
  ],
] as const)
  for (const statusRead of [false, true])
    // Value: protects=the plain form of N71's defect: the Study's three panes stand in their columns, the learner opened data.ts and search.tsx in a new fourth group (so the grid has other sizes), and the public recovery confirms the layout, keeps that group in place and a second recovery keeps it, also when a status read retired the confirmation in between; fails_when=Restore answers "The Study panes changed during Restore" or "More than three editor groups are open" and nothing recovers short of closing the learner's group; why_new=Cycle 0072 task 1, native C72-1 on c6bd53f0 (no displaced source at all); seam=the workspace harness, a fourth editor group, readPresentationState as the chat's status read and the reader's arrange and changePresentation; no_claim=the native sizes of the editor
    test(`${recovery} confirms the Study beside a fourth learner group${statusRead ? ' after a status read' : ''} and a second one keeps it`, async () => {
      // Arrange: a confirmed Study, then the learner's fourth group with two files.
      const harness = await workspaceHarness(false)
      harness.useNativeLayout({ orientation: 0, groups: [{}] })
      try {
        await openRetainedStudy(harness)
        const learnerGroup = await addLearnerGroup(harness)
        if (statusRead) await harness.reader.readPresentationState()
        // Act
        await run(harness)
        const afterFirst = harness.reader.presentationState()
        await run(harness)
        // Assert
        const afterSecond = harness.reader.presentationState()
        assert.deepEqual(
          {
            first: [afterFirst.layoutConfirmed, afterFirst.reason],
            second: [afterSecond.layoutConfirmed, afterSecond.reason],
            learnerGroup: learnerGroupAfter(harness, learnerGroup),
          },
          {
            first: [true, undefined],
            second: [true, undefined],
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

// Value: protects=a learner's click into another file while the second show (the one that hands the moved copy's keyboard to the source) is pending: the learner's file keeps the keyboard, the copy stays open and the Restore is not confirmed; fails_when=the late show takes the keyboard and the return adopts that as its baseline, closes the copy and confirms; why_new=Cycle 0072 task 1 candidate Codex review of 2dea5111 (P2 1); seam=the workspace harness's holdNextTextDocumentShow held twice in a row and focusMutableDraft as the learner's click; no_claim=the click is the harness's focus of a draft
test('a learner’s click while the show that hands the copy’s keyboard to the source is pending keeps that file and the copy', async () => {
  // Arrange: the moved copy has the keyboard in the fourth group; the first show runs, the second one is held.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  let release = (): void => {}
  try {
    await openRetainedStudy(harness)
    const learnerGroup = await addLearnerGroup(harness)
    harness.moveSource(learnerGroup.viewColumn)
    const before = harness.reader.presentationState()
    const sourceUri = harness.reader.inspect().sourceUri!
    const first = harness.holdNextTextDocumentShow({ uri: sourceUri })
    const restoring = harness.reader
      .changePresentation(
        {
          presentationId: before.presentationId,
          expectedRevision: before.presentationControlRevision,
          mode: 'study-workspace',
          action: 'restore',
        },
        'agent',
      )
      .then(
        () => 'answered',
        (error: unknown) => String(error),
      )
    await first.started
    first.release()
    // The second show starts right after the first one resolves; its hold is set in the same turn.
    const second = harness.holdNextTextDocumentShow({ uri: sourceUri })
    release = second.release
    await second.started
    // Act: the learner clicks data.ts while the second show is pending, then it finishes.
    harness.focusMutableDraft('data.ts', 4)
    second.release()
    const answer = await restoring
    // Assert
    assert.deepEqual(
      {
        answer,
        activeFile: harness.editor.window.activeTextEditor?.document.uri.fsPath
          .split('/')
          .pop(),
        copyStillOpen: learnerGroup.tabs.some(
          (tab) => tab.label === 'Captured-theme.ts',
        ),
      },
      {
        answer:
          'Error: The editor focus changed while the captured source was returned; your choice was kept. Choose Restore Study workspace layout again.',
        activeFile: 'data.ts',
        copyStillOpen: true,
      },
    )
  } finally {
    release()
    await harness.close()
  }
})

// Value: protects=a learner's switch to a tab that is no text file (a Settings page, here the harness's chat tab) in the copy's group while the second show is pending: that group keeps the keyboard, the copy stays open and the Restore is not answered as confirmed; fails_when=only text-editor changes are watched, the late show takes the keyboard back and the Restore answers success with the captured source active; why_new=Cycle 0072 task 1 candidate Codex review of f46f65c4 (P2 1); seam=the workspace harness's holdNextTextDocumentShow held twice and focusChatEditorTab as the learner's switch; no_claim=the harness's chat tab stands for any non-text tab
test('a learner’s switch to a non-text tab while the show that hands the copy’s keyboard to the source is pending keeps that group focused', async () => {
  // Arrange: the moved copy has the keyboard in the fourth group; the first show runs, the second one is held.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  let release = (): void => {}
  try {
    await openRetainedStudy(harness)
    const learnerGroup = await addLearnerGroup(harness)
    harness.moveSource(learnerGroup.viewColumn)
    const before = harness.reader.presentationState()
    const sourceUri = harness.reader.inspect().sourceUri!
    const first = harness.holdNextTextDocumentShow({ uri: sourceUri })
    const restoring = harness.reader
      .changePresentation(
        {
          presentationId: before.presentationId,
          expectedRevision: before.presentationControlRevision,
          mode: 'study-workspace',
          action: 'restore',
        },
        'agent',
      )
      .then(
        () => 'answered',
        (error: unknown) => String(error),
      )
    await first.started
    first.release()
    const second = harness.holdNextTextDocumentShow({ uri: sourceUri })
    release = second.release
    await second.started
    // Act: the learner switches to a tab that is no text file, then the second show finishes.
    harness.focusChatEditorTab(learnerGroup.viewColumn)
    second.release()
    const answer = await restoring
    // Assert
    assert.deepEqual(
      {
        answer,
        activeColumn: harness.editor.window.tabGroups.activeTabGroup.viewColumn,
        copyStillOpen: learnerGroup.tabs.some(
          (tab) => tab.label === 'Captured-theme.ts',
        ),
      },
      {
        answer:
          'Error: The editor focus changed while the captured source was returned; your choice was kept. Choose Restore Study workspace layout again.',
        activeColumn: 4,
        copyStillOpen: true,
      },
    )
  } finally {
    release()
    await harness.close()
  }
})

/**
 * Runs an agent's Restore of the Study whose captured source stands in the learner's fourth group with the keyboard, holds its second show and lets the test act while that show is pending.
 * @param harness - The reader and the fake editor.
 * @param whileSecondShowPends - The learner's action.
 * @param afterSecondShowReleased - A step run in the same turn as the release of that show, before the return goes on (to hold the next show, for example); it gets the Restore's answer, which settles when the return ends.
 * @returns The Restore's outcome text.
 * @example const answer = await restoreWithLearnerDuringSecondShow(harness, () => harness.focusChatEditorTab(2))
 */
async function restoreWithLearnerDuringSecondShow(
  harness: Harness,
  whileSecondShowPends: () => void,
  afterSecondShowReleased?: (answer: Promise<string>) => Promise<void>,
): Promise<string> {
  const before = harness.reader.presentationState()
  const sourceUri = harness.reader.inspect().sourceUri!
  const first = harness.holdNextTextDocumentShow({ uri: sourceUri })
  const restoring = harness.reader
    .changePresentation(
      {
        presentationId: before.presentationId,
        expectedRevision: before.presentationControlRevision,
        mode: 'study-workspace',
        action: 'restore',
      },
      'agent',
    )
    .then(
      () => 'answered',
      (error: unknown) => String(error),
    )
  await first.started
  first.release()
  const second = harness.holdNextTextDocumentShow({ uri: sourceUri })
  await second.started
  whileSecondShowPends()
  second.release()
  await afterSecondShowReleased?.(restoring)
  return restoring
}

const FOCUS_KEPT_ANSWER =
  'Error: The editor focus changed while the captured source was returned; your choice was kept. Choose Restore Study workspace layout again.'

const LATEST_CHOICE_NOT_BACK_ANSWER =
  'Error: The editor focus changed while the captured source was returned, and Codebook could not bring your latest choice back to the front. Choose it again, then choose Restore Study workspace layout.'

// Value: protects=a learner's move to a group that already shows a tab that is no text file, made while the second show is pending and seen as a group event alone: that group keeps the keyboard; fails_when=only tab events and text-editor changes are watched, so the late show takes the keyboard back and the Restore answers success; why_new=Cycle 0072 task 1 candidate Codex review of d3204739 (P2 1); seam=restoreWithLearnerDuringSecondShow and activatePaneGroupByGroupEventOnly on the Study pane's group; no_claim=the Study pane's tab stands for any existing non-text tab
test('a learner’s move to an existing non-text group while the second show is pending keeps that group focused', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await openRetainedStudy(harness)
    harness.moveSource((await addLearnerGroup(harness)).viewColumn)
    // Act
    const answer = await restoreWithLearnerDuringSecondShow(harness, () =>
      harness.activatePaneGroupByGroupEventOnly('codebook.studyContext'),
    )
    // Assert
    assert.deepEqual(
      {
        answer,
        activeColumn: harness.editor.window.tabGroups.activeTabGroup.viewColumn,
      },
      { answer: FOCUS_KEPT_ANSWER, activeColumn: 3 },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a non-text tab the learner picks in the source's own column while the second show is pending: the late show covers it, so the return brings that tab to the front of its group again; fails_when=only the group is focused and Captured source stays in front of the learner's tab although the answer says the choice was kept; why_new=Cycle 0072 task 1 candidate Codex review of d3204739 (P2 2); seam=restoreWithLearnerDuringSecondShow, focusChatEditorTab in column 2 and the harness's numbered tab command; no_claim=the chat tab stands for any non-text tab
test('a learner’s non-text tab in the source column is in front of its group again after the late show', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await openRetainedStudy(harness)
    harness.moveSource((await addLearnerGroup(harness)).viewColumn)
    // Act
    const answer = await restoreWithLearnerDuringSecondShow(harness, () =>
      harness.focusChatEditorTab(2),
    )
    // Assert
    assert.deepEqual(
      {
        answer,
        frontOfSourceColumn: harness.groups.find(
          (group) => group.viewColumn === 2,
        )?.activeTab?.label,
      },
      { answer: FOCUS_KEPT_ANSWER, frontOfSourceColumn: 'Chat' },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a file the learner picks while the returned editor's reading position is restored: it keeps the keyboard and the return stops; fails_when=only ownership is checked after that wait, so the second show takes the keyboard and the baseline adopts it; why_new=Cycle 0072 task 1 candidate Codex review of d3204739 (P2 3); seam=the harness's changeAfterNextReadingReveal with focusMutableDraft; no_claim=the click is the harness's focus of a draft
test('a file the learner picks while the reading position is restored keeps the keyboard', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await openRetainedStudy(harness)
    harness.moveSource((await addLearnerGroup(harness)).viewColumn)
    const before = harness.reader.presentationState()
    harness.changeAfterNextReadingReveal(() => {
      harness.focusMutableDraft('data.ts', 4)
    })
    // Act
    const answer = await harness.reader
      .changePresentation(
        {
          presentationId: before.presentationId,
          expectedRevision: before.presentationControlRevision,
          mode: 'study-workspace',
          action: 'restore',
        },
        'agent',
      )
      .then(
        () => 'answered',
        (error: unknown) => String(error),
      )
    // Assert
    assert.deepEqual(
      {
        answer,
        activeFile: harness.editor.window.activeTextEditor?.document.uri.fsPath
          .split('/')
          .pop(),
      },
      { answer: FOCUS_KEPT_ANSWER, activeFile: 'data.ts' },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a selection the learner changes in the moved copy while the first show is pending: the new selection travels to the returned editor; fails_when=the selections are read before the waits, so the stale ones are applied and the copy closes with the learner's change lost; why_new=Cycle 0072 task 1 candidate Codex review of f46f65c4 (P2 2); seam=the workspace harness's holdNextTextDocumentShow and the moved editor's selections; no_claim=the visible range
test('a selection the learner changes in the moved copy while the first show is pending travels to the returned editor', async () => {
  // Arrange: the first show of the source is held while the moved copy has its selection at line 22.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  let release = (): void => {}
  try {
    await openRetainedStudy(harness)
    const learnerGroup = await addLearnerGroup(harness)
    harness.moveSource(learnerGroup.viewColumn)
    const sourceUri = harness.reader.inspect().sourceUri
    const copyEditor = harness.editor.window.visibleTextEditors.find(
      (editor) =>
        editor.viewColumn === learnerGroup.viewColumn &&
        editor.document.uri.toString() === sourceUri,
    )!
    const held = harness.holdNextTextDocumentShow({ uri: sourceUri! })
    release = held.release
    const arranging = harness.reader.action('arrange')
    await held.started
    // Act: the learner moves the selection of the copy to line 7, then the show finishes.
    const at = new harness.editor.Position(7, 0)
    Reflect.set(copyEditor, 'selections', [{ anchor: at, active: at }])
    held.release()
    await arranging
    // Assert
    const returned = harness.editor.window.visibleTextEditors.find(
      (editor) =>
        editor.viewColumn === 2 && editor.document.uri.toString() === sourceUri,
    )
    assert.deepEqual(
      returned?.selections.map((selection) => selection.active.line),
      [7],
    )
  } finally {
    release()
    await harness.close()
  }
})

// Value: protects=the reading state of the moved copy: two selections the learner made in it travel to the editor the return opens in the Study source column; fails_when=the return opens the new editor at the stopped line only, so the learner's selections are lost when the copy closes; why_new=Cycle 0072 task 1 candidate Codex review of 2dea5111 (P2 2); seam=the workspace harness's source editors and their selections; no_claim=the visible range, which the harness reports as one fixed range
test('Arrange keeps two selections the learner made in the moved copy of the captured source', async () => {
  // Arrange: the moved copy in the fourth group carries two selections.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await openRetainedStudy(harness)
    const learnerGroup = await addLearnerGroup(harness)
    harness.moveSource(learnerGroup.viewColumn)
    const sourceUri = harness.reader.inspect().sourceUri
    const copyEditor = harness.editor.window.visibleTextEditors.find(
      (editor) =>
        editor.viewColumn === learnerGroup.viewColumn &&
        editor.document.uri.toString() === sourceUri,
    )!
    const at = (line: number) => ({
      anchor: new harness.editor.Position(line, 0),
      active: new harness.editor.Position(line, 0),
    })
    Reflect.set(copyEditor, 'selections', [at(3), at(7)])
    // Act
    await harness.reader.action('arrange')
    // Assert
    const returned = harness.editor.window.visibleTextEditors.find(
      (editor) =>
        editor.viewColumn === 2 && editor.document.uri.toString() === sourceUri,
    )
    assert.deepEqual(
      returned?.selections.map((selection) => selection.active.line),
      [3, 7],
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a learner's switch between two files of the same name in different folders, in one column, while the return waits for the source document: the return notices the switch and shows nothing over the learner's file; fails_when=the return compares front tabs by label, misses the switch and shows the captured source; why_new=Cycle 0072 task 1 candidate Codex review of ddc14faa (P2); seam=the workspace harness's holdNextSource, focusMutableDraft with two files named index.ts and textDocumentShows; no_claim=the switch is the harness's focus of a draft
test('a learner’s switch to a same-named file in another folder while the return opens the source keeps that file and shows nothing', async () => {
  // Arrange: left/index.ts has the keyboard in the fourth group beside the moved copy; the open of the source is held.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  let release = (): void => {}
  try {
    await openRetainedStudy(harness)
    harness.moveSource((await addLearnerGroup(harness)).viewColumn)
    harness.focusMutableDraft('left/index.ts', 4)
    const before = harness.reader.presentationState()
    const held = harness.holdNextSource({
      uri: harness.reader.inspect().sourceUri!,
    })
    release = held.release
    const showsBefore = harness.textDocumentShows().length
    const restoring = harness.reader
      .changePresentation(
        {
          presentationId: before.presentationId,
          expectedRevision: before.presentationControlRevision,
          mode: 'study-workspace',
          action: 'restore',
        },
        'agent',
      )
      .catch(() => undefined)
    await held.started
    // Act: the learner switches to right/index.ts in the same column, then the open finishes.
    harness.focusMutableDraft('right/index.ts', 4)
    held.release()
    await restoring
    // Assert
    assert.equal(harness.textDocumentShows().length, showsBefore)
  } finally {
    release()
    await harness.close()
  }
})

// Value: protects=a learner's selection of another tab inside the group of the moved copy while the editor closes that copy: the learner's tab stays focused and the source is not shown over it; fails_when=only a change of group is noticed, so the front-tab change inside the same group is lost to the return's re-show; why_new=Cycle 0072 task 1 candidate Codex review of 787050d4 (P2 1); seam=the workspace harness's holdNextTabCloseResponse and focusMutableDraft in the copy's own group; no_claim=the click is the harness's focus of a draft
test('a learner’s selection of another tab in the moved copy’s own group while it closes keeps that file focused', async () => {
  // Arrange: the moved copy has the keyboard in the learner's fourth group and the editor's answer to its close is held.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  let release = (): void => {}
  try {
    await openRetainedStudy(harness)
    harness.moveSource((await addLearnerGroup(harness)).viewColumn)
    const before = harness.reader.presentationState()
    const held = harness.holdNextTabCloseResponse()
    release = held.release
    const restoring = harness.reader
      .changePresentation(
        {
          presentationId: before.presentationId,
          expectedRevision: before.presentationControlRevision,
          mode: 'study-workspace',
          action: 'restore',
        },
        'agent',
      )
      .catch(() => undefined)
    await held.started
    // Act: the learner selects data.ts in the same group, then the close answers.
    harness.focusMutableDraft('data.ts', 4)
    held.release()
    await restoring
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

// Value: protects=the answer of a Restore whose workspace closed during the preference save: it answers the closed result and not a confirmed state; fails_when=the confirmed answer is built after the save without looking at the reader's lifetime; why_new=Cycle 0072 task 1 candidate Codex review of 787050d4 (P2 3); seam=the workspace harness's holdPresentationPreference, the reader's arrange and close; no_claim=none beyond protects
test('an Arrange whose workspace closed during the preference save answers the closed result', async () => {
  // Arrange: the captured source stands in the learner's fourth group and the preference write is held.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  let release = (): void => {}
  try {
    await openRetainedStudy(harness)
    harness.moveSource((await addLearnerGroup(harness)).viewColumn)
    const held = harness.holdPresentationPreference()
    release = held.release
    const outcome = harness.reader.action('arrange').then(
      () => 'answered',
      (error: unknown) => String(error),
    )
    await held.started
    // Act: the workspace closes while the save is pending, then the save finishes.
    const closing = harness.reader.close()
    held.release()
    // Assert
    assert.match(await outcome, /The study workspace was closed/)
    await closing
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

// Value: protects=the returned source's stopped line and annotation: the editor the return opens in the Study source column is decorated like the ordinary placement decorates it, on the stopped line (line 3 here, not the first); fails_when=the new editor gets no decoration, or one on another line, so the stopped line is not marked after Arrange; why_new=Cycle 0072 task 1 candidate Codex review P2 (3), line check added after the review round's test-gap finding; seam=the workspace harness's decoratedColumns and decoratedStartLines of the source highlight; no_claim=the Recorded annotation of a live source view is not asserted here
test('Arrange marks the stopped line in the editor it returns the captured source to', async () => {
  // Arrange: the captured source, stopped on line 3, stands in the learner's fourth group; earlier decoration calls are forgotten.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await openRetainedStudyStoppedAtLineThree(harness)
    harness.moveSource((await addLearnerGroup(harness)).viewColumn)
    harness.clearDecorations()
    // Act
    await harness.reader.action('arrange')
    // Assert
    const lastInSourceColumn = harness.decoratedColumns().lastIndexOf(2)
    assert.deepEqual(harness.decoratedStartLines()[lastInSourceColumn], [2])
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

// Value: protects=the stopped line of a returned captured source whose moved copy is not a visible editor (a learner file stands in front of it): the new editor's caret stands on the stopped line, line 3 here; fails_when=the return passes no stopped line as the selection when the copy has no editor of its own, so the caret stays on the first line and the stop is off screen in a long file; why_new=Cycle 0072 task 1 review round, test gap (the fallback of the selection was never reached: every moved copy was a visible editor on the first line); seam=the workspace harness with a learner file in front of the moved copy; no_claim=the native scroll position, only the selection that reveals it
test('Arrange puts the caret on the stopped line when the moved copy has no visible editor of its own', async () => {
  // Arrange: the source, stopped on line 3, was moved to the fourth group, and the learner's data.ts is in front of it.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    const stoppedLine = await openRetainedStudyStoppedAtLineThree(harness)
    const learnerGroup = await addLearnerGroup(harness)
    harness.moveSource(learnerGroup.viewColumn)
    harness.focusMutableDraft('data.ts', learnerGroup.viewColumn)
    const sourceUri = harness.reader.inspect().sourceUri
    const copyIsVisible = harness.editor.window.visibleTextEditors.some(
      (editor) =>
        editor.viewColumn === learnerGroup.viewColumn &&
        editor.document.uri.toString() === sourceUri,
    )
    // Act
    await harness.reader.action('arrange')
    // Assert
    const returned = harness.editor.window.visibleTextEditors.find(
      (editor) =>
        editor.viewColumn === 2 && editor.document.uri.toString() === sourceUri,
    )
    assert.deepEqual(
      {
        copyIsVisible,
        stoppedLine,
        caretLine: returned?.selections[0]?.active.line,
      },
      { copyIsVisible: false, stoppedLine: 2, caretLine: 2 },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the decoration of the label at the end of a CRLF source's stopped line: the annotation stands at the real line end and not after the carriage return; fails_when=the line length counts the \r, so the label is one column too far on every line of a CRLF source (F201, here for the live source view's annotation); why_new=Cycle 0072 task 1 review round (CodeRabbit, CRLF); seam=the reader's sourceIdentityDecoration called directly with a CRLF source; no_claim=how the editor lays out the label
test('the annotation of a CRLF source stands at the end of its line, not after the carriage return', async () => {
  // Arrange: a saved study is open; the annotation is built for a two-line CRLF source.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await openRetainedStudy(harness)
    const model = harness.reader.inspect().view!.model
    // Act
    // The harness's Position is a light stand-in for the editor's, so the private method is applied without its parameter types.
    const decoration: {
      range: { start: { line: number; character: number } }
    } = Reflect.apply(
      harness.reader['sourceIdentityDecoration'],
      harness.reader,
      [
        model,
        { ...model.source, text: 'const a = 1;\r\nconst b = 22;\r\n', line: 2 },
        undefined,
        new harness.editor.Position(1, 0),
      ],
    )
    // Assert
    assert.deepEqual(
      {
        line: decoration.range.start.line,
        column: decoration.range.start.character,
      },
      { line: 1, column: 13 },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a group the editor has no focus command for (a ninth group): when the learner's tab there is not in front and the return could not bring it back, the numbered tab command is not run on whatever group is active, and the answer does not say the choice was kept; fails_when=the return runs openEditorAtIndexN on the active group and still claims the choice was kept; why_new=Cycle 0072 task 1 review round (OCR lens C L1, lens A L2); seam=restoreWithLearnerDuringSecondShow, nine groups, a chat tab in the ninth group that a silent change put behind a file, and the harness's command log; no_claim=the chat tab stands for any non-text tab
test('a learner’s tab in a group the editor cannot focus is not touched by a numbered tab command and the answer does not claim it was kept', async () => {
  // Arrange: nine groups; the moved copy has the keyboard in the fourth; the ninth holds a file and a chat tab.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await openRetainedStudy(harness)
    await addLearnerGroup(harness)
    await harness.editor.commands.executeCommand('vscode.setEditorLayout', {
      orientation: 0,
      groups: Array.from({ length: 9 }, () => ({})),
    })
    harness.moveSource(4)
    const commandsBefore = harness.commands.length
    // Act: the learner opens the chat tab in the ninth group, and a change without an event puts the file in front of it again.
    const answer = await restoreWithLearnerDuringSecondShow(harness, () => {
      harness.focusMutableDraft('late.ts', 9)
      harness.focusChatEditorTab(9)
      const ninth = harness.groups.find((group) => group.viewColumn === 9)!
      ninth.activeTab = ninth.tabs[0]
    })
    // Assert
    assert.deepEqual(
      {
        answer,
        numberedTabCommands: harness.commands
          .slice(commandsBefore)
          .filter((command) => /openEditorAtIndex/.test(command)),
      },
      {
        answer: LATEST_CHOICE_NOT_BACK_ANSWER,
        numberedTabCommands: [],
      },
    )
  } finally {
    await harness.close()
  }
})

/** What every not-kept answer of the return begins with, whichever sentence follows (the focus changed, and the learner's tab could not be brought back). */
const FOCUS_CHANGED_NOT_KEPT_PATTERN =
  /The editor focus changed while the captured source was returned, and /

// Value: protects=the learner's own diff when another diff of the same label stands in the same group: the late show of the source covered the second diff the learner picked, and the return brings that one back and not the first with the same label; fails_when=the return looks the tab up by kind of input and label alone and finds the first diff of index.ts, then answers that the choice was kept; why_new=Cycle 0072 /ship pass 1 (Codex structured P2, outside 3); seam=restoreWithLearnerDuringSecondShow, focusDiffEditor on two files named index.ts of different folders in the source column and the late show covering them; no_claim=the diffs stand for any two non-text tabs of one label
test('a learner’s second diff of the same label that the late show covered is brought back, not the first', async () => {
  // Arrange: the moved copy has the keyboard in the fourth group.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await openRetainedStudy(harness)
    await addLearnerGroup(harness)
    harness.moveSource(4)
    // Act: the learner opens the diff of app/index.ts and then the diff of lib/index.ts in the source column while the second show is pending; the show then covers both.
    let appDiffTab: unknown, libDiffTab: unknown
    const answer = await restoreWithLearnerDuringSecondShow(harness, () => {
      appDiffTab = harness.focusDiffEditor('app/index.ts', 2).tab
      libDiffTab = harness.focusDiffEditor('lib/index.ts', 2).tab
    })
    // Assert
    const front = harness.groups.find(
      (group) => group.viewColumn === 2,
    )!.activeTab
    assert.deepEqual(
      {
        answer,
        bothDiffsCarryOneLabel:
          front?.label === 'index.ts (Working Tree)' &&
          harness.groups
            .find((group) => group.viewColumn === 2)!
            .tabs.filter((tab) => tab.label === 'index.ts (Working Tree)')
            .length === 2,
        frontIsTheSecondDiff: front === libDiffTab,
        frontIsTheFirstDiff: front === appDiffTab,
      },
      {
        answer: FOCUS_KEPT_ANSWER,
        bothDiffsCarryOneLabel: true,
        frontIsTheSecondDiff: true,
        frontIsTheFirstDiff: false,
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the front tab of the active group when the editor's focus command for the learner's group did not take effect: the numbered tab command is not run, so it cannot switch the tab of whatever group is active, possibly another learner's; the answer does not say the choice was kept; fails_when=the numbered command runs after a focus command whose group is not the active one; why_new=Cycle 0072 /ship pass 1 (native adversarial 6); seam=restoreWithLearnerDuringSecondShow, ignoreNumberedGroupFocusCommands, a chat tab in the learner's fourth group that a silent change put behind a file, and the harness's command log; no_claim=the chat tab stands for any non-text tab
test('a learner’s tab whose group the focus command did not make active is not revealed by a numbered tab command', async () => {
  // Arrange: the moved copy has the keyboard in the fourth group; the editor's numbered focus commands leave the active group where it is.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await openRetainedStudy(harness)
    const learnerGroup = await addLearnerGroup(harness)
    harness.moveSource(4)
    harness.ignoreNumberedGroupFocusCommands()
    const commandsBefore = harness.commands.length
    // Act: the learner opens the chat tab in the fourth group, and a change without an event puts a file in front of it again; the late show of the source takes the keyboard to the source column.
    const answer = await restoreWithLearnerDuringSecondShow(harness, () => {
      harness.focusChatEditorTab(learnerGroup.viewColumn)
      const group = harness.groups.find(
        (candidate) => candidate.viewColumn === learnerGroup.viewColumn,
      )!
      group.activeTab = group.tabs[0]
    })
    // Assert
    assert.deepEqual(
      {
        answerSaysTheTabCouldNotBeBroughtBack:
          FOCUS_CHANGED_NOT_KEPT_PATTERN.test(answer) &&
          !answer.includes('your choice was kept'),
        numberedTabCommands: harness.commands
          .slice(commandsBefore)
          .filter((command) => /openEditorAtIndex/.test(command)),
      },
      {
        answerSaysTheTabCouldNotBeBroughtBack: true,
        numberedTabCommands: [],
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=Restore Study workspace layout pressed in the Study pane after the learner moved the Captured source into a group of their own (the moved copy has the keyboard): the press puts the keyboard into the Study pane, the editor reports that after the request began, and the return takes it as the press's own focus, so the source is back in its column, the copy closes and the layout is confirmed; fails_when=the return reads the press's own focus on the Study pane as the learner's change and stops with "your choice was kept", leaving the copy open (native C72-1r on 008dac90, VS Code 1.144.0); why_new=Cycle 0072 native recheck C72-1r step 2; seam=moveSource (the copy in front of the learner's fourth group with the keyboard), changePresentation as the learner's press, activatePaneByHand on the Study pane after the request began; no_claim=the native order of the webview's message and its group activation (the native trial shows it)
test('a Restore pressed in the Study pane while the moved copy has the keyboard returns the source and closes the copy', async () => {
  // Arrange: the moved Captured source copy is in front of the learner's fourth group with the keyboard.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await openRetainedStudy(harness)
    const learnerGroup = await addLearnerGroup(harness)
    harness.moveSource(learnerGroup.viewColumn)
    const before = harness.reader.presentationState()
    // Act: the learner presses Restore in the Study pane; the editor reports the press's focus on the Study pane after the request began.
    const restoring = harness.reader
      .changePresentation(
        {
          presentationId: before.presentationId,
          expectedRevision: before.presentationControlRevision,
          mode: 'study-workspace',
          action: 'restore',
        },
        'learner',
      )
      .then(
        () => 'answered',
        (error: unknown) => String(error),
      )
    harness.activatePaneByHand('codebook.studyContext')
    const answer = await restoring
    // Assert
    const learnerGroupNow = harness.groups.find(
      (group) => group.viewColumn === learnerGroup.viewColumn,
    )
    assert.deepEqual(
      {
        answer,
        layoutConfirmed: harness.reader.presentationState().layoutConfirmed,
        copiesInLearnerGroup:
          learnerGroupNow?.tabs.filter((tab) =>
            tab.label.startsWith('Captured-'),
          ).length ?? 0,
      },
      { answer: 'answered', layoutConfirmed: true, copiesInLearnerGroup: 0 },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's switch between two diffs of one label in the source column while the return opens the captured source: the switch is the learner's change of focus, so the return stops, keeps the newer diff in front and answers that the choice was kept; fails_when=the keyboard's place names a tab that is no text file by its label alone, so the switch reads as no change and the Restore answers success with the source over the diff the learner just picked; why_new=Cycle 0072 candidate fe103b13 Codex review (P2 3); seam=focusDiffEditor on app/index.ts and lib/index.ts in the source column, the learner's switch made before the return's first await ends (the open of the captured source); no_claim=the diffs stand for any two non-text tabs of one label
test('a learner’s switch to another diff of the same label while the return opens the source stops the Restore and keeps that diff', async () => {
  // Arrange: the captured source stands in the learner's fourth group; the diff of app/index.ts has the keyboard in the source column.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await openRetainedStudy(harness)
    await addLearnerGroup(harness)
    harness.moveSource(4)
    harness.focusDiffEditor('app/index.ts', 2)
    const before = harness.reader.presentationState()
    // Act: the Restore starts and the learner picks the diff of lib/index.ts in the same column while the source is still being opened.
    const restoring = harness.reader
      .changePresentation(
        {
          presentationId: before.presentationId,
          expectedRevision: before.presentationControlRevision,
          mode: 'study-workspace',
          action: 'restore',
        },
        'agent',
      )
      .then(
        () => 'answered',
        (error: unknown) => String(error),
      )
    const libDiffTab = harness.focusDiffEditor('lib/index.ts', 2).tab
    const answer = await restoring
    // Assert
    assert.deepEqual(
      {
        answer,
        frontIsTheLibDiff:
          harness.groups.find((group) => group.viewColumn === 2)!.activeTab ===
          libDiffTab,
      },
      { answer: FOCUS_KEPT_ANSWER, frontIsTheLibDiff: true },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the presentation transition when the editor never answers the layout read that confirms the returned arrangement: after the presentation deadline the Restore answers an error naming that step and the transition is released; fails_when=the layout read after the return is awaited with no deadline, so every later control answers that a presentation change is pending and Close waits for good; why_new=Cycle 0072 candidate fe103b13 Codex review (P2 1); seam=holdNextCommand on vscode.getEditorLayout armed once the second show is released, the fake clock, the reader's presentationTransition; no_claim=which native layout command a host uses beyond the harness's
test('a layout read after the return that the editor never answers ends the Restore with an error at the presentation deadline', async (context) => {
  // Arrange: the moved copy has the keyboard in the fourth group, so the return shows the source twice and then reads the layout.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  let releaseLayout = (): void => {}
  try {
    await openRetainedStudy(harness)
    harness.moveSource((await addLearnerGroup(harness)).viewColumn)
    // Act
    const answer = await restoreWithLearnerDuringSecondShow(
      harness,
      () => {},
      async (answering) => {
        // Armed after the second show, so the held command is the return's own layout read; faked before its deadline is armed.
        const heldLayout = harness.holdNextCommand('vscode.getEditorLayout')
        releaseLayout = heldLayout.release
        enableFakeClock(context)
        await advanceClockUntilSettled(context, heldLayout.started, 2_000)
        await advanceClockUntilSettled(
          context,
          answering,
          PRESENTATION_READY_TIMEOUT_MS + 1_000,
        )
        resetFakeClock(context)
      },
    )
    // Assert
    assert.deepEqual(
      {
        answer,
        transitionReleased:
          harness.reader['presentationTransition'] === undefined,
      },
      {
        answer:
          'Error: The editor gave no answer to the layout read after the return within 5 seconds, so Codebook stopped returning the captured source; the editor may still finish that step. Choose Restore Study workspace layout again.',
        transitionReleased: true,
      },
    )
  } finally {
    resetFakeClock(context)
    releaseLayout()
    await harness.close()
  }
})

// Value: protects=the learner's editor after the return gave up on a step: the editor's answer to the focus command of the learner's group arrives after the step deadline, the Restore has already answered its timeout, and the late answer sends no numbered tab command that would switch a front tab under the learner, a Close or the next Restore; fails_when=the abandoned reactivation goes on with its next editor command once the late answer arrives; why_new=Cycle 0072 /ship pass 2 (native adversarial rerun 2, Red Team 1); seam=restoreWithLearnerDuringSecondShow, holdNextCommand on the fourth group's focus command released after the deadline, the fake clock, the harness's command log; no_claim=the late completion of the editor's own command (the focus still moves; the editor may finish it)
test('a learner’s tab whose group focus the editor answers after the return gave up gets no numbered tab command', async (context) => {
  // Arrange: the moved copy has the keyboard in the fourth group; the editor holds its answer to the fourth group's focus command.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  const heldFocus = harness.holdNextCommand(
    'workbench.action.focusFourthEditorGroup',
  )
  try {
    await openRetainedStudy(harness)
    const learnerGroup = await addLearnerGroup(harness)
    harness.moveSource(4)
    const commandsBefore = harness.commands.length
    // Act: the learner opens the chat tab in the fourth group and a change without an event puts a file in front of it; after the second show the return waits for the held focus command past its step deadline, and the editor answers only then.
    const answer = await restoreWithLearnerDuringSecondShow(
      harness,
      () => {
        harness.focusChatEditorTab(learnerGroup.viewColumn)
        const group = harness.groups.find(
          (candidate) => candidate.viewColumn === learnerGroup.viewColumn,
        )!
        group.activeTab = group.tabs[0]
      },
      async (answering) => {
        // Faked before the return's next step arms its deadline.
        enableFakeClock(context)
        await advanceClockUntilSettled(context, heldFocus.started, 2_000)
        await advanceClockUntilSettled(
          context,
          answering,
          PRESENTATION_READY_TIMEOUT_MS + 1_000,
        )
        resetFakeClock(context)
        heldFocus.release()
        // The abandoned reactivation resumes on the next turns once the editor answered.
        for (let turn = 0; turn < 5; turn++)
          await new Promise((resolve) => setImmediate(resolve))
      },
    )
    // Assert
    assert.deepEqual(
      {
        answer,
        numberedTabCommands: harness.commands
          .slice(commandsBefore)
          .filter((command) => /openEditorAtIndex/.test(command)),
      },
      {
        answer:
          'Error: The editor gave no answer to the focus command that brings your choice back within 5 seconds, so Codebook stopped returning the captured source; the editor may still finish that step. Choose Restore Study workspace layout again.',
        numberedTabCommands: [],
      },
    )
  } finally {
    resetFakeClock(context)
    heldFocus.release()
    await harness.close()
  }
})

// Value: protects=the Study grid when the learner's pick stands in a group of another editor part (Cursor's Agent chat group beyond the main editor's groups): the return runs neither the numbered focus command of its column, which Cursor answers with a new empty group in the main editor, nor a numbered tab command; fails_when=the return runs the focus command of any column the main editor does not have, so the Study grid gains an empty group; why_new=Cycle 0072 /ship pass 1 (Red Team, same function); seam=restoreWithLearnerDuringSecondShow, addSeparateEditorPart with the chat's focusTab as the learner's pick, and the harness's command log and groups; no_claim=Cursor's chat stands for any group the main editor does not count
test('a learner’s pick of Cursor’s chat group beyond the main editor is not focused by a numbered group command that would open a new group', async () => {
  // Arrange: the moved copy has the keyboard in the fourth group; Cursor's Agent chat part stands behind the main editor's four groups.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await openRetainedStudy(harness)
    await addLearnerGroup(harness)
    harness.moveSource(4)
    const chat = harness.addSeparateEditorPart()
    const groupCountBefore = harness.groups.length
    const commandsBefore = harness.commands.length
    // Act: the learner clicks into the chat while the second show is pending.
    const answer = await restoreWithLearnerDuringSecondShow(harness, () => {
      chat.focusTab()
    })
    // Assert
    assert.deepEqual(
      {
        answerSaysTheTabCouldNotBeBroughtBack:
          FOCUS_CHANGED_NOT_KEPT_PATTERN.test(answer) &&
          !answer.includes('your choice was kept'),
        groupCount: harness.groups.length,
        commandsOfTheChatColumn: harness.commands
          .slice(commandsBefore)
          .filter((command) =>
            /focusFifthEditorGroup|openEditorAtIndex/.test(command),
          ),
      },
      {
        answerSaysTheTabCouldNotBeBroughtBack: true,
        groupCount: groupCountBefore,
        commandsOfTheChatColumn: [],
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the presentation transition when a helper of the return throws right after the transition was taken: the transition is released, so the next control is not refused as pending for good; fails_when=the try block starts later than the transition, a throw in the keyboard-place read leaves the transition owned and every later control is refused; why_new=Cycle 0072 task 1 review round (OCR lens A L4); seam=the reader's tab groups getter made to throw while the transition is owned; no_claim=which production helper throws
test('a throw right after the return took the presentation transition releases it', async () => {
  // Arrange: the captured source stands in the learner's fourth group; reading the active group throws once the transition is owned.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  const tabGroups = harness.editor.window.tabGroups
  const original = Object.getOwnPropertyDescriptor(tabGroups, 'activeTabGroup')
  try {
    await openRetainedStudy(harness)
    harness.moveSource((await addLearnerGroup(harness)).viewColumn)
    const before = harness.reader.presentationState()
    Object.defineProperty(tabGroups, 'activeTabGroup', {
      configurable: true,
      get() {
        if (harness.reader['presentationTransition'])
          throw new Error('the editor failed while the return was starting')
        return original?.get?.call(tabGroups)
      },
    })
    // Act
    const answer = await harness.reader
      .changePresentation({
        presentationId: before.presentationId,
        expectedRevision: before.presentationControlRevision,
        mode: 'study-workspace',
        action: 'restore',
      })
      .then(
        () => 'answered',
        (error: unknown) => String(error),
      )
    // Assert
    assert.deepEqual(
      {
        answer,
        transitionOwned: harness.reader['presentationTransition'] !== undefined,
      },
      {
        answer: 'Error: the editor failed while the return was starting',
        transitionOwned: false,
      },
    )
  } finally {
    if (original) Object.defineProperty(tabGroups, 'activeTabGroup', original)
    await harness.close()
  }
})

// Value: protects=a diff editor the learner activates while the second show is pending: it reports no view column, so the return does not show its file again in the source column (that would duplicate it there); its group keeps the keyboard; fails_when=the missing column falls back to the source column and the file is shown there with the keyboard, while the answer says the choice was kept; why_new=Cycle 0072 task 1 review round (OCR lens A L1); seam=restoreWithLearnerDuringSecondShow, focusDiffEditor and the harness's text document shows; no_claim=the diff is the harness's, not the Source Control view's
test('a diff editor the learner activates while the second show is pending is not shown again in the source column', async () => {
  // Arrange: the moved copy has the keyboard in the fourth group.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await openRetainedStudy(harness)
    harness.moveSource((await addLearnerGroup(harness)).viewColumn)
    const showsBefore = harness.textDocumentShows().length
    // Act: the learner opens a diff of diff.ts in the fourth group while the second show is pending.
    const answer = await restoreWithLearnerDuringSecondShow(harness, () => {
      harness.focusDiffEditor('diff.ts', 4)
    })
    // Assert
    assert.deepEqual(
      {
        answer,
        diffShownAgain: harness
          .textDocumentShows()
          .slice(showsBefore)
          .some((shown) => shown.name === 'diff.ts'),
        activeColumn: harness.editor.window.tabGroups.activeTabGroup.viewColumn,
      },
      { answer: FOCUS_KEPT_ANSWER, diffShownAgain: false, activeColumn: 4 },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a learner's second pick while the return shows their first pick again: the watch goes on until that re-show is done, and the newer pick wins; fails_when=the listeners are disposed before the corrective re-show, so a pick made while it waits is pulled back to the first file and the answer still says the choice was kept; why_new=Cycle 0072 task 1 candidate Codex review of f97da11b (P2-1); seam=restoreWithLearnerDuringSecondShow, holdNextTextDocumentShow held for the corrective re-show and focusMutableDraft as the learner's picks; no_claim=the picks are the harness's focus of drafts
test('a learner’s newer pick while the return shows their first pick again keeps the newer file', async () => {
  // Arrange: the moved copy has the keyboard in the fourth group, which also holds data.ts and search.tsx.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await openRetainedStudy(harness)
    harness.moveSource((await addLearnerGroup(harness)).viewColumn)
    // Act: the learner picks data.ts while the second show is pending; the return shows data.ts again, and the learner picks search.tsx while that waits.
    const answer = await restoreWithLearnerDuringSecondShow(
      harness,
      () => {
        harness.focusMutableDraft('data.ts', 4)
      },
      async () => {
        const reshow = harness.holdNextTextDocumentShow()
        await reshow.started
        harness.focusMutableDraft('search.tsx', 4)
        reshow.release()
      },
    )
    // Assert
    assert.deepEqual(
      {
        answer,
        activeFile: harness.editor.window.activeTextEditor?.document.uri.fsPath
          .split('/')
          .pop(),
      },
      { answer: FOCUS_KEPT_ANSWER, activeFile: 'search.tsx' },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the latest caret of the moved copy: a caret the learner moves in the original tab while the keyboard hand-off is pending travels to the returned editor before the original closes (the README promises the commands show the source again with the learner's selections and reading position in it); fails_when=the selections are copied once, before the hand-off, so the original closes with the new caret lost and the restored copy keeps the old one; why_new=Cycle 0072 task 1 candidate Codex review of f97da11b (P2-2); seam=restoreWithLearnerDuringSecondShow and the moved editor's selections; no_claim=the visible range, which the harness reports as one fixed range
test('a caret the learner moves in the original tab while the keyboard hand-off is pending travels to the returned editor', async () => {
  // Arrange: the moved copy has the keyboard in the fourth group.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await openRetainedStudy(harness)
    const learnerGroup = await addLearnerGroup(harness)
    harness.moveSource(learnerGroup.viewColumn)
    const sourceUri = harness.reader.inspect().sourceUri
    const copyEditor = harness.editor.window.visibleTextEditors.find(
      (editor) =>
        editor.viewColumn === learnerGroup.viewColumn &&
        editor.document.uri.toString() === sourceUri,
    )!
    // Act: the learner moves the caret of the original tab to line 9, column 1 while the second show is pending.
    const answer = await restoreWithLearnerDuringSecondShow(harness, () => {
      const at = new harness.editor.Position(9, 1)
      Reflect.set(copyEditor, 'selections', [{ anchor: at, active: at }])
    })
    // Assert
    const returned = harness.editor.window.visibleTextEditors.find(
      (editor) =>
        editor.viewColumn === 2 && editor.document.uri.toString() === sourceUri,
    )
    assert.deepEqual(
      {
        answer,
        caret: {
          line: returned?.selections[0]?.active.line,
          character: returned?.selections[0]?.active.character,
        },
      },
      { answer: 'answered', caret: { line: 9, character: 1 } },
    )
  } finally {
    await harness.close()
  }
})

for (const comesBack of [false, true])
  // Value: protects=a switch to another window while the keyboard hand-off is pending, also when the learner comes back before it ends: the return stops with the focus-change sentence and leaves the original tab open; fails_when=no window-state listener is active during the hand-off, so the left-window state becomes the new baseline, the original tab closes and the answer is success; why_new=Cycle 0072 task 1 candidate Codex review of f97da11b (P2-3); seam=restoreWithLearnerDuringSecondShow and changeWindowFocus; no_claim=the window switch is the harness's window state
  test(`a switch to another window while the keyboard hand-off is pending${comesBack ? ' (the learner comes back)' : ''} stops the return and keeps the original tab`, async () => {
    // Arrange: the moved copy has the keyboard in the fourth group.
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    try {
      await openRetainedStudy(harness)
      const learnerGroup = await addLearnerGroup(harness)
      harness.moveSource(learnerGroup.viewColumn)
      // Act
      const answer = await restoreWithLearnerDuringSecondShow(harness, () => {
        harness.changeWindowFocus(false)
        if (comesBack) harness.changeWindowFocus(true)
      })
      // Assert
      assert.deepEqual(
        {
          answer,
          originalStillOpen: learnerGroup.tabs.some(
            (tab) => tab.label === 'Captured-theme.ts',
          ),
        },
        { answer: FOCUS_KEPT_ANSWER, originalStillOpen: true },
      )
    } finally {
      harness.changeWindowFocus(true)
      await harness.close()
    }
  })

/**
 * Asks an agent's Restore of the Study workspace, as the chat's presentation control does, and reports how it ended.
 * @param harness - The reader and the fake editor.
 * @returns `'answered'` for a Restore the reader answered, otherwise the refusal's text.
 * @example const answer = await agentRestoreOutcome(harness) // => 'answered'
 */
function agentRestoreOutcome(harness: Harness): Promise<string> {
  const before = harness.reader.presentationState()
  return harness.reader
    .changePresentation(
      {
        presentationId: before.presentationId,
        expectedRevision: before.presentationControlRevision,
        mode: 'study-workspace',
        action: 'restore',
      },
      'agent',
    )
    .then(
      () => 'answered',
      (error: unknown) => String(error),
    )
}

// Value: protects=an agent's Restore of a learner who has their own file in front of the Study source column with the keyboard while the Captured source tab stands in their fourth group: the return shows the source in its column, confirms the layout and keeps the file open behind it; fails_when=the return reads its own switch of that column's front tab as the learner's input and refuses "your choice was kept" with the layout unconfirmed and the source still in the fourth group; why_new=Cycle 0072 task 1 candidate Codex review of af968024 (P2 1); seam=the workspace harness with a fourth editor group, moveSource, focusMutableDraft in the source column and the reader's changePresentation as an agent; no_claim=the fake editor's show with preserveFocus, not the native one
test('an agent’s Restore shows the captured source over the learner’s file in the source column and confirms the layout instead of reading its own tab switch as the learner’s input', async () => {
  // Arrange: the captured source stands in the learner's fourth group; notes.ts is in front of the Study source column and has the keyboard.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await openRetainedStudy(harness)
    const learnerGroup = await addLearnerGroup(harness)
    harness.moveSource(learnerGroup.viewColumn)
    harness.focusMutableDraft('notes.ts', 2)
    const revisionBefore =
      harness.reader.presentationState().presentationControlRevision
    // Act
    const answer = await agentRestoreOutcome(harness)
    // Assert
    const sourceColumnGroup = harness.groups.find(
      (group) => group.viewColumn === 2,
    )
    assert.deepEqual(
      {
        answer,
        layoutConfirmed: harness.reader.presentationState().layoutConfirmed,
        revisionAdvanced:
          harness.reader.presentationState().presentationControlRevision >
          revisionBefore,
        sourceColumn: harness.sourceColumn(),
        frontOfSourceColumn: sourceColumnGroup?.activeTab?.label,
        learnerFileStillOpen: sourceColumnGroup?.tabs.some(
          (tab) => tab.label === 'notes.ts',
        ),
        learnerGroup: learnerGroupAfter(harness, learnerGroup),
      },
      {
        answer: 'answered',
        layoutConfirmed: true,
        revisionAdvanced: true,
        sourceColumn: 2,
        frontOfSourceColumn: 'Captured-theme.ts',
        learnerFileStillOpen: true,
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

// Value: protects=a learner's click into a file of another group while the show of the captured source over their file in the Study source column is pending: the click is the learner's input, so the return stops with the choice kept and the Restore is not confirmed; fails_when=the return expects the source in front of the source column and accepts every change of the keyboard's place, so the learner's click is overwritten and the Restore answers success; why_new=Cycle 0072 task 1 candidate Codex review of af968024 (P2 1); seam=the workspace harness's holdNextTextDocumentShow on the captured source, focusMutableDraft in the source column and in the fourth group; no_claim=the click is the harness's focus of a draft
test('a learner’s click into another group while the captured source is shown over their file in the source column keeps that click and refuses the Restore', async () => {
  // Arrange: notes.ts is in front of the source column with the keyboard, and the editor's show of the captured source is held.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  let release = (): void => {}
  try {
    await openRetainedStudy(harness)
    harness.moveSource((await addLearnerGroup(harness)).viewColumn)
    harness.focusMutableDraft('notes.ts', 2)
    const revisionBefore =
      harness.reader.presentationState().presentationControlRevision
    const held = harness.holdNextTextDocumentShow({
      uri: harness.reader.inspect().sourceUri!,
    })
    release = held.release
    const restoring = agentRestoreOutcome(harness)
    await held.started
    // Act: the learner clicks data.ts in their fourth group, then the show finishes.
    harness.focusMutableDraft('data.ts', 4)
    held.release()
    const answer = await restoring
    // Assert
    assert.deepEqual(
      {
        answer,
        activeFile: harness.editor.window.activeTextEditor?.document.uri.fsPath
          .split('/')
          .pop(),
        activeColumn: harness.editor.window.tabGroups.activeTabGroup.viewColumn,
        revisionAdvanced:
          harness.reader.presentationState().presentationControlRevision >
          revisionBefore,
      },
      {
        answer: FOCUS_KEPT_ANSWER,
        activeFile: 'data.ts',
        activeColumn: 4,
        revisionAdvanced: false,
      },
    )
  } finally {
    release()
    await harness.close()
  }
})

// Value: protects=a learner who has one file open in two groups and picks it in the second group while the return shows their first pick (the same file in the first group) again: the pick in the second group is recorded as theirs and ends with the keyboard there; fails_when=picks are matched by document alone, so the pick in the second group is dropped as the return's own re-show, the late re-show returns the keyboard to the first group and the answer still says the choice was kept; why_new=Cycle 0072 task 1 candidate Codex review of af968024 (P2 2); seam=restoreWithLearnerDuringSecondShow, holdNextTextDocumentShow held for the corrective re-show and focusMutableDraft of data.ts in the fourth and fifth group; no_claim=the picks are the harness's focus of drafts
test('a learner’s pick of the same file in another group while the return shows their first pick again keeps the keyboard in that other group', async () => {
  // Arrange: data.ts is open in the fourth and the fifth group; the moved copy has the keyboard in the fourth group.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await openRetainedStudy(harness)
    const copyGroup = await addLearnerGroup(harness)
    await addLearnerGroup(harness)
    harness.moveSource(copyGroup.viewColumn)
    // Act: the learner picks data.ts in the fourth group while the second show is pending; the return shows it again, and the learner picks data.ts in the fifth group while that waits.
    const answer = await restoreWithLearnerDuringSecondShow(
      harness,
      () => {
        harness.focusMutableDraft('data.ts', 4)
      },
      async () => {
        const reshow = harness.holdNextTextDocumentShow()
        await reshow.started
        harness.focusMutableDraft('data.ts', 5)
        reshow.release()
      },
    )
    // Assert
    assert.deepEqual(
      {
        answer,
        activeFile: harness.editor.window.activeTextEditor?.document.uri.fsPath
          .split('/')
          .pop(),
        activeColumn: harness.editor.window.tabGroups.activeTabGroup.viewColumn,
      },
      { answer: FOCUS_KEPT_ANSWER, activeFile: 'data.ts', activeColumn: 5 },
    )
  } finally {
    await harness.close()
  }
})

for (const [positionMs, moment, expectedLabel, expectedStopLines] of [
  [
    100,
    'an observed moment',
    '  Recorded: src/theme.ts:1 · 0.10 s · declared 1',
    [0],
  ],
  [20, 'a gap', '  Recorded source · Not recorded at this moment', []],
] as const)
  // Value: protects=the source label and stopped line of a recording's returned source: the editor the return opens in the Study source column gets the label and the stop of the selected moment like the ordinary placement draws them (the observed moment's "Recorded:" label and stopped line, a gap's "Not recorded" label and no stop), since decorations belong to one editor and the moved copy kept the earlier ones; fails_when=the return decorates nothing on the live source view, or draws a stop in a gap, so the returned source shows no label or another moment's stop after Arrange; why_new=Cycle 0072 task 1, test gap (the stopped-line test uses a repository source, which has no label, and the CRLF test calls the label builder alone); seam=recordedReaderHarness with an open recording and a seek, a learner group, moveSource, the reader's arrange action, sourceIdentityDecorations and decoratedStartLines; no_claim=how the editor lays out the label
  test(`Arrange draws the label and the stop of ${moment} on the recording’s source it returns to the Study column from the learner’s group`, async () => {
    // Arrange: a saved recording is open at the moment and its source tab was moved into the learner's group.
    const harness = await recordedReaderHarness(true, true)
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    try {
      await harness.reader.openRecording(harness.studyId)
      await harness.controller.settle()
      harness.controller.command({
        action: 'seek',
        studyId: harness.studyId,
        expectedRevision: harness.controller.state().revision,
        positionMs,
      })
      await harness.controller.settle()
      harness.moveSource((await addLearnerGroup(harness)).viewColumn)
      const sourceUri = harness.reader.inspect().sourceUri
      assert.equal(
        harness.reader.presentationState().layoutConfirmed,
        false,
        'the setup must start from the refused state',
      )
      const labelsBefore = harness.sourceIdentityDecorations().length
      harness.clearDecorations()
      // Act
      await harness.reader.action('arrange')
      // Assert
      const labelled = harness
        .sourceIdentityDecorations()
        .slice(labelsBefore)
        .at(-1)
      assert.deepEqual(
        {
          uri: labelled?.uri,
          labels: JSON.parse(JSON.stringify(labelled?.ranges ?? [])).map(
            (decoration: {
              renderOptions: { after: { contentText: string } }
            }) => decoration.renderOptions.after.contentText,
          ),
          stopLines:
            harness.decoratedStartLines()[
              harness.decoratedColumns().lastIndexOf(2)
            ],
        },
        {
          uri: sourceUri,
          labels: [expectedLabel],
          stopLines: expectedStopLines,
        },
      )
    } finally {
      await harness.close()
    }
  })

for (const [position, revealedByNumber] of [
  [9, true],
  [10, false],
] as const)
  // Value: protects=the editor's numbered tab command (it has openEditorAtIndex1 to 9 only): a learner's chat tab that the late show of the source covered is brought back by its number up to the ninth tab of its group, and the tenth is left alone with no command run on a number the editor does not have; fails_when=the limit is dropped or off by one, so the tenth tab runs openEditorAtIndex10 on the active group, or the ninth is given up and the answer claims the choice was kept; why_new=Cycle 0072 task 1, test gap (EDITOR_NUMBERED_TAB_COMMAND_LIMIT was never reached: the other cases stand at the first positions or in the ninth group, which has no focus command at all); seam=restoreWithLearnerDuringSecondShow, a source column filled with files, focusChatEditorTab, the late show covering the chat tab and the harness's command log; no_claim=the chat tab stands for any non-text tab
  test(`a learner’s chat tab at position ${position} of the source column that the late show covered ${revealedByNumber ? 'is brought to the front by its number' : 'is not revealed by a numbered command the editor does not have'}`, async () => {
    // Arrange: the moved copy has the keyboard in the fourth group; the Study source column holds files, and the first show adds the source tab before the chat tab.
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    try {
      await openRetainedStudy(harness)
      await addLearnerGroup(harness)
      // The first show puts the source tab in this column before the learner's chat tab: the chat tab stands at the given position.
      for (let index = 1; index < position - 1; index++)
        harness.focusMutableDraft(`late${index}.ts`, 2)
      harness.moveSource(4)
      const commandsBefore = harness.commands.length
      // Act: the learner opens the chat tab in the source column while the second show is pending; the show then covers it.
      const answer = await restoreWithLearnerDuringSecondShow(harness, () => {
        harness.focusChatEditorTab(2)
      })
      // Assert
      const sourceColumn = harness.groups.find(
        (group) => group.viewColumn === 2,
      )!
      assert.deepEqual(
        {
          answer,
          chatPosition:
            sourceColumn.tabs.findIndex((tab) => tab.label === 'Chat') + 1,
          frontOfSourceColumn: sourceColumn.activeTab?.label,
          numberedTabCommands: harness.commands
            .slice(commandsBefore)
            .filter((command) => /openEditorAtIndex/.test(command)),
        },
        revealedByNumber
          ? {
              answer: FOCUS_KEPT_ANSWER,
              chatPosition: 9,
              frontOfSourceColumn: 'Chat',
              numberedTabCommands: ['workbench.action.openEditorAtIndex9'],
            }
          : {
              answer: LATEST_CHOICE_NOT_BACK_ANSWER,
              chatPosition: 10,
              frontOfSourceColumn: 'Captured-theme.ts',
              numberedTabCommands: [],
            },
      )
    } finally {
      await harness.close()
    }
  })

// Value: protects=the bound of the return's corrective re-shows (LEARNER_CHOICE_RESHOW_LIMIT, 3): a learner who picks another file at every re-show is shown their pick again three times and no more, so the return ends instead of following the learner for good, and the answer says Codebook could not bring the latest choice back (the third re-show covered it) instead of claiming it was kept; fails_when=the loop has no bound or a larger one, so a fourth re-show of the learner's latest pick follows, or a smaller one stops the learner's picks before the third (the answer then arrives before the re-show starts), or the bound ends with the "your choice was kept" sentence over a newer pick; why_new=Cycle 0072 task 1, test gap (the newer-pick test ends after two re-shows and never reaches the bound), then Cycle 0072 /ship pass 1 (Codex outside voice 5 and the core review: the bound answered kept over a newer pick; the 1 s timer as give-up); seam=restoreWithLearnerDuringSecondShow, holdNextTextDocumentShow held for each re-show, focusMutableDraft as the learner's picks and the harness's list of shown documents; no_claim=the picks are the harness's focus of drafts
test('a learner who picks another file at every corrective re-show is shown their pick again three times and the return then ends', async () => {
  // Arrange: the moved copy has the keyboard in the fourth group, which also holds data.ts and search.tsx.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await openRetainedStudy(harness)
    harness.moveSource((await addLearnerGroup(harness)).viewColumn)
    const showsBefore = harness.textDocumentShows().length
    // Act: the learner picks data.ts while the second show is pending, and a different file of the group at each of the three re-shows that wait.
    const answer = await restoreWithLearnerDuringSecondShow(
      harness,
      () => {
        harness.focusMutableDraft('data.ts', 4)
      },
      async (returnEnded) => {
        for (const file of ['search.tsx', 'data.ts', 'search.tsx']) {
          const reshow = harness.holdNextTextDocumentShow()
          // A bound lower than three ends the return before this re-show starts: the answer arrives first and the test fails, with no timer to wait for.
          const started = await Promise.race([
            reshow.started.then(() => true),
            returnEnded.then(() => false),
          ])
          assert.ok(
            started,
            `the re-show before the pick of ${file} never began`,
          )
          harness.focusMutableDraft(file, 4)
          reshow.release()
        }
      },
    )
    // Assert
    assert.deepEqual(
      {
        answer,
        reshownPicks: harness
          .textDocumentShows()
          .slice(showsBefore)
          .map((shown) => shown.name)
          .filter((name) => name === 'data.ts' || name === 'search.tsx'),
        frontOfFourthGroup: harness.groups.find(
          (group) => group.viewColumn === 4,
        )?.activeTab?.label,
        activeColumn: harness.editor.window.tabGroups.activeTabGroup.viewColumn,
      },
      {
        answer: LATEST_CHOICE_NOT_BACK_ANSWER,
        reshownPicks: ['data.ts', 'search.tsx', 'data.ts'],
        frontOfFourthGroup: 'data.ts',
        activeColumn: 4,
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a learner's pick of the moved Captured source copy in their own group, made after another pick while the second show is pending: the copy is a pick like any file, so the return shows it again and its group keeps the keyboard with the copy in front; fails_when=every report of the captured source's document is dropped, so the corrective re-show brings the earlier pick (data.ts) back over the copy while the answer says the choice was kept; why_new=Cycle 0072 /ship pass 1 (Codex structured review P2, outside voice 2); seam=restoreWithLearnerDuringSecondShow, focusMutableDraft for the first pick and clickMovedSourceTab for the second; no_claim=the harness's click stands for any way a learner activates the copy's tab
test('a learner who picks data.ts and then the moved Captured source copy in their group while the second show is pending keeps the copy in front', async () => {
  // Arrange: the moved copy has the keyboard in the fourth group, which also holds data.ts and search.tsx.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await openRetainedStudy(harness)
    harness.moveSource((await addLearnerGroup(harness)).viewColumn)
    // Act: the learner picks data.ts and then the copy, both in the fourth group, while the second show is pending.
    const answer = await restoreWithLearnerDuringSecondShow(harness, () => {
      harness.focusMutableDraft('data.ts', 4)
      harness.clickMovedSourceTab(4)
    })
    // Assert
    assert.deepEqual(
      {
        answer,
        frontOfFourthGroup: harness.groups.find(
          (group) => group.viewColumn === 4,
        )?.activeTab?.label,
        activeColumn: harness.editor.window.tabGroups.activeTabGroup.viewColumn,
      },
      {
        answer: FOCUS_KEPT_ANSWER,
        frontOfFourthGroup: 'Captured-theme.ts',
        activeColumn: 4,
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the editor's report of the active editor again while the second show is pending (Cursor re-reports it): the copy that already had the keyboard is no pick of the learner's, so the hand-off completes and the copy closes; fails_when=the copy's document in its own group counts as a pick without a different pick before it, so the return stops with "your choice was kept" over a learner who did nothing; why_new=Cycle 0072 /ship pass 1 (Codex structured review P2, outside voice 2: the guard of the re-pick fix); seam=restoreWithLearnerDuringSecondShow and clickMovedSourceTab as the editor's report of the copy that has the keyboard; no_claim=Cursor's own report is not reproduced, only its shape
test('the editor reporting the copy that has the keyboard again while the second show is pending is no pick and the hand-off completes', async () => {
  // Arrange: the moved copy has the keyboard in the fourth group.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await openRetainedStudy(harness)
    const learnerGroup = await addLearnerGroup(harness)
    harness.moveSource(learnerGroup.viewColumn)
    // Act: the editor reports the copy as the active editor again while the second show is pending.
    const answer = await restoreWithLearnerDuringSecondShow(harness, () => {
      harness.clickMovedSourceTab(learnerGroup.viewColumn)
    })
    // Assert
    assert.deepEqual(
      {
        answer,
        copyStillOpen: learnerGroup.tabs.some(
          (tab) => tab.label === 'Captured-theme.ts',
        ),
      },
      { answer: 'answered', copyStillOpen: false },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the Study pane in front of the active group when a Restore starts the return of the captured source: the editor reports that group again while the first show is pending (a tab or group event as the source's tab opens), and the tab in front at the start is no pick of the learner's, so the return completes and the copy closes; fails_when=the tab in front when the first show starts counts as a pick, so the return refuses with "your choice was kept" over a learner who did nothing; why_new=Cycle 0072 /ship pass 1 (Codex outside voice 1: the first show is watched, a Restore from the Study pane must not abort); seam=holdNextTextDocumentShow on the captured source, activatePaneGroupByGroupEventOnly on the Study pane's group before and during the show, and agentRestoreOutcome; no_claim=Cursor's own reports are not reproduced, only their shape
test('a group event that names the Study pane again while the first show is pending is no pick and the Restore completes', async () => {
  // Arrange: the captured source stands in the learner's fourth group; the Study pane is in front of the active group, and the editor's first show of the source is held.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  let release = (): void => {}
  try {
    await openRetainedStudy(harness)
    const learnerGroup = await addLearnerGroup(harness)
    harness.moveSource(learnerGroup.viewColumn)
    harness.activatePaneGroupByGroupEventOnly('codebook.studyContext')
    const held = harness.holdNextTextDocumentShow({
      uri: harness.reader.inspect().sourceUri!,
    })
    release = held.release
    const restoring = agentRestoreOutcome(harness)
    await held.started
    // Act: the editor reports the Study pane's group as the active one again, then the show finishes.
    harness.activatePaneGroupByGroupEventOnly('codebook.studyContext')
    held.release()
    const answer = await restoring
    // Assert
    assert.deepEqual(
      {
        answer,
        copyStillOpen: learnerGroup.tabs.some(
          (tab) => tab.label === 'Captured-theme.ts',
        ),
        frontOfSourceColumn: harness.groups.find(
          (group) => group.viewColumn === 2,
        )?.activeTab?.label,
      },
      {
        answer: 'answered',
        copyStillOpen: false,
        frontOfSourceColumn: 'Captured-theme.ts',
      },
    )
  } finally {
    release()
    await harness.close()
  }
})

// Value: protects=a file the learner picks in the Study source column while the first show of the captured source is pending: the show puts the source in front of that column and covers the pick, so the return shows the pick again and stops with the choice kept; fails_when=the first show runs unwatched and the place after it equals the place expected for the source in front, so the Restore answers success over the learner's pick; why_new=Cycle 0072 /ship pass 1 (Codex outside voice 1); seam=the workspace harness's holdNextTextDocumentShow on the captured source, focusMutableDraft of notes.ts and other.ts in the source column and agentRestoreOutcome; no_claim=the pick is the harness's focus of a draft
test('a file the learner picks in the source column while the first show is pending is shown again over the source and refuses the Restore', async () => {
  // Arrange: notes.ts is in front of the source column with the keyboard, and the editor's first show of the captured source is held.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  let release = (): void => {}
  try {
    await openRetainedStudy(harness)
    harness.moveSource((await addLearnerGroup(harness)).viewColumn)
    harness.focusMutableDraft('notes.ts', 2)
    const revisionBefore =
      harness.reader.presentationState().presentationControlRevision
    const held = harness.holdNextTextDocumentShow({
      uri: harness.reader.inspect().sourceUri!,
    })
    release = held.release
    const restoring = agentRestoreOutcome(harness)
    await held.started
    // Act: the learner picks other.ts in the same column, then the show finishes.
    harness.focusMutableDraft('other.ts', 2)
    held.release()
    const answer = await restoring
    // Assert
    assert.deepEqual(
      {
        answer,
        frontOfSourceColumn: harness.groups.find(
          (group) => group.viewColumn === 2,
        )?.activeTab?.label,
        activeColumn: harness.editor.window.tabGroups.activeTabGroup.viewColumn,
        revisionAdvanced:
          harness.reader.presentationState().presentationControlRevision >
          revisionBefore,
      },
      {
        answer: FOCUS_KEPT_ANSWER,
        frontOfSourceColumn: 'other.ts',
        activeColumn: 2,
        revisionAdvanced: false,
      },
    )
  } finally {
    release()
    await harness.close()
  }
})

// Value: protects=the presentation transition when the editor never answers the first show of the captured source: after the presentation deadline the Restore answers an error that names the step, the transition is released and a following Arrange is admitted, so no control stays refused as pending for good and Close is not left waiting; fails_when=the show is awaited with no deadline, so the Restore never settles, the transition stays owned and every later control answers "A presentation change or reader close is pending."; why_new=Cycle 0072 /ship pass 1 (native adversarial review: the return awaited its native calls with no deadline); seam=holdNextTextDocumentShow on the captured source and never released, the fake clock, agentRestoreOutcome, the reader's presentationTransition and the diagnostics log; no_claim=the other four bounded steps (the open, the hand-off show, the corrective shows and the close) go through the same helper and are not each timed here
test('a first show of the captured source that the editor never answers ends the Restore with an error at the presentation deadline and a following Arrange is admitted', async (context) => {
  // Arrange: the captured source stands in the learner's fourth group and the editor's first show of it is held for good.
  const harness = await workspaceHarness(false)
  const logged: CodebookDiagnostic[] = []
  harness.reader.diagnostics = {
    log: (entry) => logged.push(entry),
    show: () => undefined,
  }
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  let release = (): void => {}
  try {
    await openRetainedStudy(harness)
    harness.moveSource((await addLearnerGroup(harness)).viewColumn)
    const held = harness.holdNextTextDocumentShow({
      uri: harness.reader.inspect().sourceUri!,
    })
    release = held.release
    enableFakeClock(context)
    const restoring = agentRestoreOutcome(harness)
    // Throws when the held show never starts, so a regression fails here and does not hang.
    await advanceClockUntilSettled(context, held.started, 2_000)
    const whileWaiting = await harness.reader.action('arrange').then(
      () => 'answered',
      (error: unknown) => String(error),
    )
    // Act: the presentation deadline passes.
    const releasedAfterMs = await advanceClockUntil(
      context,
      () => harness.reader['presentationTransition'] === undefined,
      PRESENTATION_READY_TIMEOUT_MS + 1_000,
    )
    // `advanceClockUntil` answers undefined at its limit: a transition still owned after the deadline fails here and does not hang.
    assert.notEqual(
      releasedAfterMs,
      undefined,
      'the transition stayed owned past the presentation deadline',
    )
    const answer = await restoring
    resetFakeClock(context)
    const followingArrange = await harness.reader.action('arrange').then(
      () => 'answered',
      (error: unknown) => String(error),
    )
    // Assert
    assert.deepEqual(
      {
        whileWaiting,
        answer,
        followingArrange,
        timeoutLogged: logged.some(
          (entry) => entry.surface === 'presentation:source-return-timed-out',
        ),
      },
      {
        whileWaiting:
          'Error: A presentation change or reader close is pending. Read its state before another control.',
        answer:
          'Error: The editor gave no answer to the show of the captured source within 5 seconds, so Codebook stopped returning the captured source; the editor may still finish that step. Choose Restore Study workspace layout again.',
        followingArrange: 'answered',
        timeoutLogged: true,
      },
    )
  } finally {
    resetFakeClock(context)
    release()
    await harness.close()
  }
})
