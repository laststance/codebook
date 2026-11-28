import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import {
  workspaceHarness,
  articleRecordingLayoutHarness,
} from './studyWorkspaceHarness'
for (const recording of [false, true])
  test(`Wiki ${recording ? 'recording' : 'observation'} reentry restores Study after an empty chat wrapper refresh following actual Return`, async () => {
    // Arrange
    const harness = await articleRecordingLayoutHarness(true, true)
    harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
    const chat = harness.addSeparateEditorPart(),
      draft = harness.focusMutableDraft()
    harness.groups.at(-1)!.tabs = []
    harness.groups.at(-1)!.activeTab = undefined
    try {
      await harness.reader.openRepositoryEvidence(
        harness.binding,
        false,
        undefined,
        harness.origin,
      )
      await harness.reader.action('return-wiki')
      // Act
      harness.resyncEditorGroups('empty')
      await harness.reader.openRepositoryEvidence(
        harness.binding,
        recording,
        undefined,
        harness.origin,
      )
      await harness.controller.settle()
      // Assert
      assert.deepEqual(
        harness.editorLayout(),
        recording
          ? {
              orientation: 0,
              groups: [
                { size: 1, groups: [{ size: 0.5 }, { size: 0.5 }] },
                { size: 1 },
                { size: 1 },
              ],
            }
          : {
              orientation: 0,
              groups: [
                { size: 0.55, groups: [{ size: 0.5 }, { size: 0.5 }] },
                { size: 0.45 },
              ],
            },
      )
      // The dedicated App splits the first main group and preserves the learner's third group.
      assert.equal(harness.reader.presentationState().layoutConfirmed, true)
      if (recording) {
        assert.equal(harness.controller.state().readiness, 'ready')
        assert.equal(harness.controller.state().mode, 'paused')
        assert.equal(harness.displayedImage(), harness.png.toString('base64'))
        assert.equal(harness.groups[0]!.locked, true)
        assert.equal(
          harness.groups.find((group) => group.viewColumn === 4)!.tabs.length,
          0,
        )
      }
      assert.deepEqual(harness.groups.at(-1)!.tabs, [])
      assert.deepEqual(chat.layout(), {
        orientation: 1,
        groups: [{ size: 743 }],
      })
      assert.equal(draft.document.getText(), 'Original learner draft.\n')
      assert.equal(
        harness.groups[recording ? 1 : 0]!.tabs.some(
          (tab) =>
            'uri' in tab.input &&
            tab.input.uri.toString() === draft.document.uri.toString(),
        ),
        true,
      )
    } finally {
      await harness.close()
    }
  })

for (const change of ['replace', 'unannounced', 'move', 'ambiguous'] as const)
  test(`Wiki recording reentry preserves the reading grid after an empty other-part ${change} following actual Return`, async () => {
    // Arrange
    const harness = await articleRecordingLayoutHarness(true, true)
    harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
    const chat = harness.addSeparateEditorPart(),
      draft = harness.focusMutableDraft()
    harness.groups.at(-1)!.tabs = []
    harness.groups.at(-1)!.activeTab = undefined
    try {
      await harness.reader.openRepositoryEvidence(
        harness.binding,
        false,
        undefined,
        harness.origin,
      )
      await harness.reader.action('return-wiki')
      const mutations = harness.commands.filter(
        (command) => command === 'vscode.setEditorLayout',
      ).length
      if (change === 'move') harness.groups.at(-1)!.viewColumn = 5
      if (change === 'ambiguous')
        harness.groups.push({ viewColumn: 5, tabs: [] })
      // Act
      harness.resyncEditorGroups(
        change === 'replace' || change === 'unannounced' ? change : 'empty',
        true,
      )
      const foreignGroups = harness.groups.filter(
        (group) => group.viewColumn > 3,
      )
      assert.equal(foreignGroups.length, change === 'ambiguous' ? 2 : 1)
      const opening = harness.reader.openRepositoryEvidence(
        harness.binding,
        true,
        undefined,
        harness.origin,
      )
      // A missing global column makes the part ambiguous; recording load refuses that scope instead of repairing it.
      if (change === 'move')
        await assert.rejects(opening, /outside the verified recording range/)
      else await opening
      await harness.controller.settle()
      // Assert
      // A main-part layout cannot merge an empty group belonging to another editor part.
      assert.equal(
        foreignGroups.every((group) => harness.groups.includes(group)),
        true,
      )
      assert.deepEqual(
        harness.editorLayout(),
        change === 'move'
          ? { orientation: 0, groups: [{ size: 1 }, { size: 1 }, { size: 1 }] }
          : {
              orientation: 0,
              groups: [
                { size: 1, groups: [{ size: 0.5 }, { size: 0.5 }] },
                { size: 1 },
                { size: 1 },
              ],
            },
      )
      assert.equal(
        harness.commands.filter(
          (command) => command === 'vscode.setEditorLayout',
        ).length,
        mutations + (change === 'move' ? 0 : 1),
      )
      assert.equal(
        harness.reader.presentationState().layoutConfirmed,
        change !== 'move',
      )
      if (change !== 'move') {
        assert.equal(harness.controller.state().readiness, 'ready')
        assert.equal(harness.displayedImage(), harness.png.toString('base64'))
        assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
        assert.equal(harness.sourceColumn(), 2)
        assert.equal(harness.summary.visible, true)
      }
      assert.deepEqual(chat.layout(), {
        orientation: 1,
        groups: [{ size: 743 }],
      })
      assert.equal(draft.document.getText(), 'Original learner draft.\n')
    } finally {
      await harness.close()
    }
  })

for (const recording of [false, true])
  for (const mainGroups of [2, 3])
    test(`explicit Study after actual Wiki Return restores its verified ${mainGroups}-group origin following ${recording ? 'recording' : 'observation'} entry`, async () => {
      // Arrange
      const harness = await articleRecordingLayoutHarness(true, true)
      if (mainGroups === 3)
        harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
      const chat = harness.addSeparateEditorPart(),
        draft = harness.focusMutableDraft()
      try {
        await harness.reader.openRepositoryEvidence(
          harness.binding,
          recording,
          undefined,
          harness.origin,
        )
        await harness.controller.settle()
        await harness.reader.action('return-wiki')
        // Act
        await harness.reader.open()
        await harness.controller.settle()
        // Assert
        assert.deepEqual(
          harness.editorLayout(),
          recording
            ? mainGroups === 2
              ? {
                  orientation: 1,
                  groups: [{ size: 109 }, { size: 107 }, { size: 107 }],
                }
              : {
                  orientation: 0,
                  groups: [
                    { size: 1, groups: [{ size: 0.5 }, { size: 0.5 }] },
                    { size: 1 },
                    { size: 1 },
                  ],
                }
            : {
                orientation: 0,
                groups: [
                  { size: 0.55, groups: [{ size: 0.5 }, { size: 0.5 }] },
                  { size: 0.45 },
                ],
              },
        )
        assert.equal(harness.reader.presentationState().layoutConfirmed, true)
        assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
        assert.equal(harness.sourceColumn(), 2)
        assert.equal(
          harness.panelColumn('codebook.studyContext'),
          recording ? undefined : 3,
        )
        if (recording) assert.equal(harness.summary.visible, true)
        assert.equal(
          harness.groups
            .find(
              (group) => group.viewColumn === (recording ? mainGroups + 2 : 4),
            )!
            .tabs.includes(chat.tab),
          true,
        )
        assert.deepEqual(chat.layout(), {
          orientation: 1,
          groups: [{ size: 743 }],
        })
        assert.equal(draft.document.getText(), 'Original learner draft.\n')
        assert.equal(draft.tab.isDirty, true)
        if (recording) {
          assert.equal(harness.displayedImage(), harness.png.toString('base64'))
          assert.equal(harness.controller.state().readiness, 'ready')
          assert.equal(harness.controller.state().presentedMs, 100)
          assert.equal(harness.controller.state().cleared, false)
          // A later explicit Return retires only the added App group and restores every original split.
          await harness.reader.action('return-wiki')
          assert.deepEqual(
            harness.editorLayout(),
            mainGroups === 2
              ? { orientation: 1, groups: [{ size: 161 }, { size: 162 }] }
              : {
                  orientation: 0,
                  groups: [{ size: 1 }, { size: 1 }, { size: 1 }],
                },
          )
          assert.equal(
            harness.groups
              .find((group) => group.viewColumn === 1)!
              .tabs.includes(draft.tab),
            true,
          )
          assert.equal(
            harness.groups
              .find((group) => group.viewColumn === mainGroups + 1)!
              .tabs.includes(chat.tab),
            true,
          )
        }
      } finally {
        await harness.close()
      }
    })

for (const change of ['shape', 'size'] as const)
  test(`explicit Study after actual Wiki Return preserves a learner's ${change} edit to the reading grid`, async () => {
    // Arrange
    const harness = await articleRecordingLayoutHarness(),
      chat = harness.addSeparateEditorPart(),
      draft = harness.focusMutableDraft()
    const manual =
      change === 'shape'
        ? { orientation: 0, groups: [{ size: 161 }, { size: 162 }] }
        : { orientation: 1, groups: [{ size: 100 }, { size: 223 }] }
    try {
      await harness.reader.openRepositoryEvidence(
        harness.binding,
        true,
        undefined,
        harness.origin,
      )
      await harness.controller.settle()
      await harness.reader.action('return-wiki')
      harness.changeEditorLayout(manual)
      const mutations = harness.commands.filter(
        (command) => command === 'vscode.setEditorLayout',
      ).length
      // Act
      await harness.reader.open()
      // Assert
      assert.deepEqual(harness.editorLayout(), manual)
      assert.equal(harness.reader.presentationState().layoutConfirmed, false)
      assert.equal(
        harness.commands.filter(
          (command) => command === 'vscode.setEditorLayout',
        ).length,
        mutations,
      )
      assert.deepEqual(chat.layout(), {
        orientation: 1,
        groups: [{ size: 743 }],
      })
      assert.equal(draft.document.getText(), 'Original learner draft.\n')
    } finally {
      await harness.close()
    }
  })

for (const cursor of [false, true])
  for (const shuffled of [false, true])
    test(`${cursor ? 'Cursor' : 'VS Code'} Wiki and recording round trips preserve the separate chat part and original two-row article with ${shuffled ? 'reordered' : 'ordered'} API groups`, async () => {
      // Arrange
      const harness = await articleRecordingLayoutHarness(true, true),
        chat = harness.addSeparateEditorPart()
      if (cursor) {
        harness.useCursorGroupWrappers(true)
        harness.replaceGroupObjectsOnTabChanges()
      }
      const draft = harness.focusMutableDraft(),
        notes = harness.focusMutableDraft('article-notes.txt', 2)
      // This lock belongs to the learner before App reservation; Return may never toggle it.
      harness.groups.find((group) => group.viewColumn === 2)!.locked = true
      harness.focusExistingSource(draft.editor)
      if (shuffled) harness.groups.reverse()
      try {
        // Act
        await harness.reader.openRepositoryEvidence(
          harness.binding,
          true,
          undefined,
          harness.origin,
        )
        await harness.controller.settle()
        const viewport = harness.viewportInstances.find(
            (candidate) => candidate.mode === 'recording',
          ),
          film = harness.controller.bundle(),
          runtimesBeforeReturn = harness.runtimes.length
        assert.ok(viewport)
        assert.ok(film)
        const application = viewport.panel
        await harness.reader.action('return-wiki')
        // Assert
        assert.deepEqual(harness.editorLayout(), {
          orientation: 1,
          groups: [{ size: 161 }, { size: 162 }],
        })
        assert.equal(harness.groups.length, 3)
        assert.equal(
          harness.groups
            .find((group) => group.viewColumn === 3)!
            .tabs.includes(chat.tab),
          true,
        )
        assert.equal(
          harness.groups
            .find((group) => group.viewColumn === 1)!
            .tabs.includes(draft.tab),
          true,
        )
        assert.equal(draft.document.getText(), 'Original learner draft.\n')
        assert.equal(notes.document.getText(), 'Original learner draft.\n')
        assert.equal(notes.tab.isDirty, true)
        assert.equal(
          harness.groups
            .find((group) => group.viewColumn === 2)!
            .tabs.some(
              (tab) =>
                'uri' in tab.input &&
                tab.input.uri.toString() === notes.document.uri.toString(),
            ),
          true,
        )
        assert.equal(
          harness.groups.find((group) => group.viewColumn === 2)!.locked,
          true,
        )
        assert.equal(harness.reader['app'], application)
        // A retained viewport must still accept and release its existing placement contract after Return.
        const releaseRetainedViewport = await viewport.holdPlacement()
        releaseRetainedViewport()
        assert.equal(harness.controller.bundle(), film)
        assert.equal(harness.runtimes.length, runtimesBeforeReturn)
        await harness.reader.openRepositoryEvidence(
          harness.binding,
          true,
          undefined,
          harness.origin,
        )
        await harness.controller.settle()
        assert.equal(harness.controller.state().readiness, 'ready')
        assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
        assert.equal(harness.reader['app'], application)
        assert.equal(harness.displayedImage(), harness.png.toString('base64'))
        assert.equal(notes.document.getText(), 'Original learner draft.\n')
        assert.equal(notes.tab.isDirty, true)
        assert.equal(harness.runtimes.length, runtimesBeforeReturn)
        // Reentry adds only the new App group: both original groups and the original learner lock still survive.
        assert.equal(
          harness.groups.find((group) => group.viewColumn === 3)!.locked,
          true,
        )
        assert.equal(harness.sourceColumn(), 2)
        assert.equal(harness.panelColumn('codebook.studyContext'), undefined)
        assert.equal(harness.summary.visible, true)
        assert.equal(harness.groups.length, 4)
        assert.equal(
          harness.groups
            .find((group) => group.viewColumn === 4)!
            .tabs.includes(chat.tab),
          true,
        )
        assert.deepEqual(chat.layout(), {
          orientation: 1,
          groups: [{ size: 743 }],
        })
        assert.equal(harness.reader.inspect().view!.errors.length, 0)
      } finally {
        await harness.close()
      }
    })

for (const stage of ['App move', 'App group close'])
  for (const later of ['cancellation', 'newer source', 'Close'])
    test(`article Return drains its accepted ${stage} after ${later} and preserves the retained renderer or newer input`, async () => {
      // Arrange: the learner's uneven rows, which the Application group's removal does not give back by itself, as the split view keeps distributed rows only (row 703).
      const harness = await articleRecordingLayoutHarness(true, true),
        cancellation = new AbortController()
      let release = (): void => {},
        releaseInitialRead = (): void => {}
      try {
        harness.useNativeLayout({
          orientation: 1,
          groups: [{ size: 250 }, { size: 300 }],
        })
        await harness.reader.openRepositoryEvidence(
          harness.binding,
          true,
          undefined,
          harness.origin,
        )
        await harness.controller.settle()
        const application = harness.reader['app'],
          film = harness.controller.bundle(),
          held =
            stage === 'App move'
              ? harness.holdNextCommand('vscode.getEditorLayout')
              : harness.holdNextTabCloseResponse()
        release = held.release
        // Act
        const returning = harness.reader.arrangeRepository(
            cancellation.signal,
            harness.origin,
          ),
          rejected = assert.rejects(
            returning,
            /abort|closed|native input|focus/i,
          )
        await held.started
        if (stage === 'App move') {
          const moved = harness.holdNextCommand('vscode.getEditorLayout')
          releaseInitialRead = held.release
          release = moved.release
          held.release()
          await moved.started
          // The second read follows the actual same-panel move, before the allocated empty group is retired.
          assert.equal(harness.panelColumn('codebook.scopedBrowser'), 3)
        }
        const mutations = harness.commands.filter(
          (command) => command === 'vscode.setEditorLayout',
        ).length
        const newer =
          later === 'newer source'
            ? harness.focusMutableDraft(
                'newer-return-draft.txt',
                stage === 'App move' ? 2 : 1,
              )
            : undefined
        const closing = later === 'Close' ? harness.reader.close() : undefined
        if (later === 'cancellation') cancellation.abort()
        release()
        await rejected
        await closing
        // Assert
        // Close may restore its own original geometry; a surviving Return must issue no additional layout after revocation.
        if (later !== 'Close')
          assert.equal(
            harness.commands.filter(
              (command) => command === 'vscode.setEditorLayout',
            ).length,
            mutations,
          )
        if (later === 'Close') {
          assert.equal(harness.reader.inspect().opened, false)
          assert.equal(harness.counts().panels, 0)
          assert.equal(harness.reader['repositoryLayoutRestored'], undefined)
        } else {
          assert.equal(harness.reader['app'], application)
          assert.equal(harness.controller.bundle(), film)
          assert.equal(harness.groups.length, stage === 'App move' ? 3 : 2)
          const viewport = harness.viewportInstances.find(
            (candidate) => candidate.mode === 'recording',
          )!
          const releasePlacement = await viewport.holdPlacement()
          releasePlacement()
          if (newer) {
            assert.equal(harness.editor.window.activeTextEditor, newer.editor)
            assert.equal(newer.document.getText(), 'Original learner draft.\n')
            assert.equal(newer.tab.isDirty, true)
            assert.equal(harness.keyboardOnBody(), false)
          }
          await harness.reader.arrangeRepository(
            new AbortController().signal,
            harness.origin,
          )
          assert.deepEqual(harness.editorLayout(), {
            orientation: 1,
            groups: [{ size: 250 }, { size: 300 }],
          })
        }
      } finally {
        releaseInitialRead()
        release()
        await harness.close()
      }
    })

test('article Return in an inactive window refuses before moving its retained Application or closing a group', async () => {
  // Arrange
  const harness = await articleRecordingLayoutHarness(true, true)
  try {
    await harness.reader.openRepositoryEvidence(
      harness.binding,
      true,
      undefined,
      harness.origin,
    )
    await harness.controller.settle()
    const application = harness.reader['app'],
      film = harness.controller.bundle(),
      reveals = harness.panelReveals().length
    harness.changeWindowFocus(false)
    // Act
    await assert.rejects(
      harness.reader.arrangeRepository(
        new AbortController().signal,
        harness.origin,
      ),
      /native input|focus/i,
    )
    // Assert
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
    assert.equal(harness.reader['app'], application)
    assert.equal(harness.controller.bundle(), film)
    assert.equal(harness.groups.length, 3)
    assert.equal(harness.panelReveals().length, reveals)
    const viewport = harness.viewportInstances.find(
      (candidate) => candidate.mode === 'recording',
    )!
    const releasePlacement = await viewport.holdPlacement()
    releasePlacement()
    harness.changeWindowFocus(true)
    await harness.reader.arrangeRepository(
      new AbortController().signal,
      harness.origin,
    )
    assert.deepEqual(harness.editorLayout(), {
      orientation: 1,
      groups: [{ size: 161 }, { size: 162 }],
    })
  } finally {
    harness.changeWindowFocus(true)
    await harness.close()
  }
})

// Value: protects=repeated Return on borrowed groups; fails_when=parking is mistaken for allocation; why_new=shared query must preserve completed retirement; seam=existing viewport port; no_claim=controlled native model only.
test('repeating article Return preserves its borrowed App group without draining the retained renderer again', async (context) => {
  // Arrange
  const harness = await articleRecordingLayoutHarness(true, true),
    draft = harness.focusMutableDraft('retained-return-input.ts', 1)
  try {
    await harness.reader.openRepositoryEvidence(
      harness.binding,
      true,
      undefined,
      harness.origin,
    )
    await harness.controller.settle()
    await harness.reader.action('return-wiki')
    // The fixture does not run the Wiki's final focus handoff; select actual native source input before the repeated Return.
    harness.focusExistingSource(draft.editor)
    assert.equal(harness.keyboardOnBody(), false)
    const viewport = harness.viewportInstances.find(
        (candidate) => candidate.mode === 'recording',
      ),
      application = harness.reader['app'],
      film = harness.controller.bundle(),
      commands = harness.commands.length,
      reveals = harness.panelReveals().length,
      activeGroup = harness.editor.window.tabGroups.activeTabGroup
    assert.ok(viewport)
    context.mock.method(viewport, 'holdPlacement', async () => {
      throw new Error(
        'A borrowed original group must not acquire another renderer drain.',
      )
    })

    // Act
    await assert.doesNotReject(
      harness.reader.arrangeRepository(
        new AbortController().signal,
        harness.origin,
      ),
    )

    // Assert
    assert.deepEqual(harness.editorLayout(), {
      orientation: 1,
      groups: [{ size: 161 }, { size: 162 }],
    })
    assert.equal(harness.groups.length, 2)
    assert.equal(harness.reader['app'], application)
    assert.equal(harness.controller.bundle(), film)
    assert.equal(harness.commands.length, commands)
    assert.equal(harness.panelReveals().length, reveals)
    assert.equal(harness.editor.window.tabGroups.activeTabGroup, activeGroup)
    assert.equal(harness.keyboardOnBody(), false)
    assert.equal(draft.document.getText(), 'Original learner draft.\n')
    assert.equal(draft.tab.isDirty, true)
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=the replay's following of its Application pane after two quick presses of Return to Wiki from a recording: the second press reaches the article Return while the first one's layout work still places the panes, and is queued behind it; once both ended Codebook places nothing, so after the next evidence visit a file the learner opens over the Application pane hides the replay; fails_when=restoreRepositoryLayout reads the placement flag at its entry, outside the layout queue, so the second press reads the first one's own flag and sets it back to set after the first one cleared it: the flag stays set until a later presentation change, publishes are suppressed and the replay goes on behind the learner's file; why_new=Cycle 0046 R4 (the red team review of /ship); seam=articleRecordingLayoutHarness, the reader's openRepositoryEvidence and action('return-wiki'), holdNextCommand on vscode.setEditorLayout (the first Return's restore of the article's layout), focusMutableDraft in the Application pane's group, the pane's notifyViewState and the controller's state; no_claim=the native timing of two presses within one layout restore
// Value: protects=Codebook's account of its own placements when a Return to Wiki and an agent's presentation change overlap: the Return's queued restore of the article's layout ends while the change, admitted after the Return began, still places its panes, and the change's placement is still counted as Codebook's own until the change ends, after which nothing is; fails_when=the placement flag is saved and set back by each owner (the Return's whilePlacing inside the layout queue, performPresentation outside it), so the Return sets back the false it saved over the change's true, and the change places its panes with the flag clear (its own group events and the learner's moves read as nobody's), or, in the mirrored order, the flag stays set after both ended (R4's symptom); why_new=Cycle 0046 AD27 (/ship's adversarial review: an interleaving of a palette Return and an agent presentation; the probe showed the Return's write of false while the change still placed); seam=articleRecordingLayoutHarness with an observation's evidence visit, holdNextCommand on vscode.setEditorLayout (the Return's restore), holdNextSource on the captured source (the change's source open after it set the flag), the reader's changePresentation as an agent's, and the reader's own placingPresentation read; no_claim=the native timing of such an overlap
test('a Return to Wiki that ends while an agent’s presentation change places its panes leaves that placement counted as Codebook’s own until the change ends, and nothing counted after both', async () => {
  // Arrange: an observation's evidence visit; the Return's restore of the article's layout is held; an agent's change to the Living book is admitted and waits for its captured source, after it began placing.
  const harness = await articleRecordingLayoutHarness(true, true)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  try {
    await harness.reader.openRepositoryEvidence(
      harness.binding,
      false,
      undefined,
      harness.origin,
    )
    await harness.controller.settle()
    const restore = harness.holdNextCommand('vscode.setEditorLayout')
    const returning = harness.reader.action('return-wiki')
    await restore.started
    const state = harness.reader.presentationState()
    const sourceOpen = harness.holdNextSource({
      uri: harness.reader.inspect().sourceUri!,
    })
    const change = harness.reader
      .changePresentation(
        {
          presentationId: state.presentationId,
          expectedRevision: state.presentationControlRevision,
          mode: 'living-book',
          action: 'select',
        },
        'agent',
      )
      .then(
        () => 'answered',
        (error: unknown) => String(error),
      )
    await sourceOpen.started

    // Act: the Return's restore ends while the change still waits for its source; then the change goes on and ends.
    restore.release()
    await returning
    const placingWhileTheChangeGoesOn = harness.reader['placingPresentation']
    sourceOpen.release()
    const outcome = await change
    await harness.controller.settle()

    // Assert: the change's placement stayed counted after the Return ended, and nothing is counted after both.
    assert.deepEqual(
      {
        placingWhileTheChangeGoesOn,
        outcome,
        placingAfterBoth: harness.reader['placingPresentation'],
      },
      {
        placingWhileTheChangeGoesOn: true,
        outcome: 'answered',
        placingAfterBoth: false,
      },
    )
  } finally {
    await harness.close()
  }
})

test('two quick Return to Wiki presses from a recording leave Codebook placing nothing, so the next visit’s replay hides behind a file the learner opens over its Application pane', async () => {
  // Arrange: a recording's evidence visit; the first Return's restore of the article's layout is held while the second Return is pressed.
  const harness = await articleRecordingLayoutHarness(true, true)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  try {
    await harness.reader.openRepositoryEvidence(
      harness.binding,
      true,
      undefined,
      harness.origin,
    )
    await harness.controller.settle()
    const restore = harness.holdNextCommand('vscode.setEditorLayout')
    const firstReturn = harness.reader.action('return-wiki')
    await restore.started
    const secondReturn = harness.reader.action('return-wiki')
    await new Promise((resolve) => setTimeout(resolve, 50))
    restore.release()
    await Promise.all([firstReturn, secondReturn])
    await harness.controller.settle()
    await harness.reader.openRepositoryEvidence(
      harness.binding,
      true,
      undefined,
      harness.origin,
    )
    await harness.controller.settle()
    const application = harness.viewportInstances.find(
      (candidate) => candidate.mode === 'recording',
    )!.panel
    const applicationGroup = harness.groups.find(
      (group) => group.activeTab === application.nativeTab,
    )!

    // Act: the learner opens a file over the Application pane.
    harness.focusMutableDraft('cover.ts', applicationGroup.viewColumn)
    application.notifyViewState()

    // Assert: the pane is hidden and the replay followed it.
    assert.deepEqual(
      {
        applicationVisible: application.visible,
        replayCleared: harness.controller.state().cleared,
      },
      { applicationVisible: false, replayCleared: true },
    )
  } finally {
    await harness.close()
  }
})

for (const next of ['Return', 'retry', 'Close'] as const)
  test(`${next} after interrupted main-part reservation preserves the original article, chat and draft`, async () => {
    // Arrange
    const harness = await articleRecordingLayoutHarness(true, true),
      chat = harness.addSeparateEditorPart(),
      draft = harness.focusMutableDraft()
    harness.useCursorGroupWrappers(true)
    let releaseLayout = (): void => {},
      releaseReceipt = (): void => {}
    try {
      await harness.reader.openRepositoryEvidence(
        harness.binding,
        true,
        undefined,
        harness.origin,
      )
      await harness.controller.settle()
      await harness.reader.action('return-wiki')
      const cancellation = new AbortController(),
        layout = harness.holdNextCommand('workbench.action.newGroupAbove')
      releaseLayout = layout.release
      const opening = harness.reader.openRepositoryEvidence(
          harness.binding,
          true,
          cancellation.signal,
          harness.origin,
        ),
        rejected = assert.rejects(opening, /abort|closed/i)
      await layout.started
      const receipt = harness.holdNextCommand('vscode.getEditorLayout')
      releaseReceipt = receipt.release
      layout.release()
      await receipt.started
      // Act: native group creation is accepted, but its preparation receipt is still pending.
      assert.equal(harness.controller.state().readiness, 'loading')
      assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
      assert.equal(harness.groups.length, 4)
      assert.equal(
        harness.groups
          .find((group) => group.viewColumn === 2)!
          .tabs.includes(draft.tab),
        true,
      )
      assert.equal(
        harness.groups
          .find((group) => group.viewColumn === 4)!
          .tabs.includes(chat.tab),
        true,
      )
      if (next !== 'Close') cancellation.abort()
      const closing = next === 'Close' ? harness.reader.close() : undefined
      receipt.release()
      await rejected
      await closing
      // Assert
      if (next === 'Close') {
        assert.equal(harness.counts().panels, 0)
        assert.equal(harness.reader.inspect().opened, false)
      } else {
        assert.equal(harness.panelColumn('codebook.studyContext'), undefined)
        if (next === 'Return') {
          await harness.reader.action('return-wiki')
          assert.deepEqual(harness.editorLayout(), {
            orientation: 1,
            groups: [{ size: 161 }, { size: 162 }],
          })
          assert.equal(harness.groups.length, 3)
        }
        await harness.reader.openRepositoryEvidence(
          harness.binding,
          true,
          undefined,
          harness.origin,
        )
        await harness.controller.settle()
        assert.equal(harness.panelColumn('codebook.studyContext'), undefined)
        assert.equal(harness.summary.visible, true)
        assert.equal(harness.sourceColumn(), 2)
        assert.equal(harness.controller.state().readiness, 'ready')
        assert.equal(harness.reader.inspect().view!.errors.length, 0)
        assert.equal(harness.displayedImage(), harness.png.toString('base64'))
      }
      assert.equal(harness.groups.at(-1)!.tabs.includes(chat.tab), true)
      assert.deepEqual(chat.layout(), {
        orientation: 1,
        groups: [{ size: 743 }],
      })
      assert.equal(
        harness.groups
          .find((group) => group.viewColumn === (next === 'Close' ? 1 : 2))!
          .tabs.includes(draft.tab),
        true,
      )
      assert.equal(draft.document.getText(), 'Original learner draft.\n')
    } finally {
      releaseLayout()
      releaseReceipt()
      await harness.close()
    }
  })

for (const later of ['source', 'window'] as const)
  test(`later ${later} input during the accepted App reservation read prevents obsolete entry effects`, async () => {
    // Arrange: hold the real allocation receipt while the same recording reenters from its article.
    const harness = await articleRecordingLayoutHarness(true, true)
    const chat = harness.addSeparateEditorPart(),
      original = harness.focusMutableDraft()
    harness.useCursorGroupWrappers(true)
    let releaseAllocation = (): void => {},
      releaseReceipt = (): void => {}
    try {
      await harness.reader.openRepositoryEvidence(
        harness.binding,
        true,
        undefined,
        harness.origin,
      )
      await harness.controller.settle()
      await harness.reader.action('return-wiki')
      const allocation = harness.holdNextCommand(
        'workbench.action.newGroupAbove',
      )
      releaseAllocation = allocation.release
      const opening = harness.reader.openRepositoryEvidence(
        harness.binding,
        true,
        undefined,
        harness.origin,
      )
      const rejected = assert.rejects(opening)
      await allocation.started
      const receipt = harness.holdNextCommand('vscode.getEditorLayout')
      releaseReceipt = receipt.release
      allocation.release()
      await receipt.started
      assert.equal(harness.controller.state().readiness, 'loading')
      assert.equal(harness.groups.length, 4)
      const revealsBefore = harness.panelReveals().length,
        layoutsBefore = harness.commands.filter(
          (command) => command === 'vscode.setEditorLayout',
        ).length

      // Act: later native input, without cancellation, independently invalidates the pending entry.
      const newer =
        later === 'source'
          ? harness.focusMutableDraft('newer-during-app-receipt.txt', 2)
          : undefined
      if (later === 'window') harness.changeWindowFocus(false)
      receipt.release()
      await rejected

      // Assert: neither an old reveal nor a layout effect follows the learner's choice.
      assert.equal(harness.panelReveals().length, revealsBefore)
      assert.equal(
        harness.commands.filter(
          (command) => command === 'vscode.setEditorLayout',
        ).length,
        layoutsBefore,
      )
      assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
      assert.equal(
        harness.groups
          .find((group) => group.viewColumn === 2)!
          .tabs.includes(original.tab),
        true,
      )
      assert.equal(original.document.getText(), 'Original learner draft.\n')
      assert.equal(
        harness.groups
          .find((group) => group.viewColumn === 4)!
          .tabs.includes(chat.tab),
        true,
      )
      if (newer) {
        assert.equal(harness.editor.window.activeTextEditor, newer.editor)
        assert.equal(newer.document.getText(), 'Original learner draft.\n')
        assert.equal(newer.tab.isDirty, true)
        assert.equal(harness.keyboardOnBody(), false)
      } else assert.equal(harness.editor.window.state.focused, false)
    } finally {
      releaseAllocation()
      releaseReceipt()
      harness.changeWindowFocus(true)
      await harness.close()
    }
  })

for (const cursor of [false, true])
  test(`${cursor ? 'Cursor' : 'VS Code'} article Return retains input when the Application itself was focused`, async () => {
    // Arrange: the actual replay is visible and its existing explicit App action owns the keyboard.
    const harness = await articleRecordingLayoutHarness(true, true)
    const chat = harness.addSeparateEditorPart(),
      draft = harness.focusMutableDraft()
    if (cursor) harness.useCursorGroupWrappers(true)
    try {
      await harness.reader.openRepositoryEvidence(
        harness.binding,
        true,
        undefined,
        harness.origin,
      )
      await harness.controller.settle()
      await harness.reader.action('focus-app')
      const application = harness.reader['app']
      assert.equal(application?.active, true)

      // Act
      await harness.reader.action('return-wiki')

      // Assert: the same App moves without leaving native input on the page body.
      assert.equal(harness.reader['app'], application)
      assert.equal(harness.keyboardOnBody(), false)
      assert.deepEqual(harness.editorLayout(), {
        orientation: 1,
        groups: [{ size: 161 }, { size: 162 }],
      })
      assert.equal(harness.groups.length, 3)
      assert.equal(
        harness.groups
          .find((group) => group.viewColumn === 1)!
          .tabs.includes(draft.tab),
        true,
      )
      assert.equal(
        harness.groups
          .find((group) => group.viewColumn === 3)!
          .tabs.includes(chat.tab),
        true,
      )
      assert.equal(draft.document.getText(), 'Original learner draft.\n')
      assert.equal(draft.tab.isDirty, true)
      assert.deepEqual(chat.layout(), {
        orientation: 1,
        groups: [{ size: 743 }],
      })
      await harness.reader.openRepositoryEvidence(
        harness.binding,
        true,
        undefined,
        harness.origin,
      )
      await harness.controller.settle()
      assert.equal(harness.displayedImage(), harness.png.toString('base64'))
      assert.equal(harness.controller.state().presentedMs, 100)
      assert.equal(harness.controller.state().readiness, 'ready')
      assert.equal(harness.sourceColumn(), 2)
    } finally {
      await harness.close()
    }
  })

for (const corrupt of [false, true])
  test(`returning from ${corrupt ? 'a failed' : 'a healthy'} recording restores the article's two stacked groups and permits another evidence visit`, async () => {
    // Arrange
    const harness = await articleRecordingLayoutHarness(),
      { library, binding, origin } = harness
    const headerPath = join(harness.store.path(harness.studyId), 'header.json'),
      header = await readFile(headerPath)
    try {
      const draft = harness.addForeignDraft(),
        decisions = (await library.readProgress()).decisions
      await harness.reader.openRepositoryEvidence(
        binding,
        true,
        undefined,
        origin,
      )
      await harness.controller.settle()
      assert.equal(harness.controller.state().readiness, 'ready')
      if (corrupt) {
        await writeFile(headerPath, '{broken')
        await harness.reader.action('reload-recording')
        await harness.controller.settle()
        assert.equal(harness.controller.state().readiness, 'failed')
      }
      const equalizations = harness.commands.filter(
        (command) => command === 'workbench.action.evenEditorWidths',
      ).length
      // Act
      await harness.reader.action('return-wiki')
      // Assert
      assert.deepEqual(harness.editorLayout(), {
        orientation: 1,
        groups: [{ size: 161 }, { size: 162 }],
      })
      assert.equal(harness.groups.length, 2)
      assert.equal(harness.panelColumn('codebook.studyContext'), undefined)
      assert.equal(harness.groups[0]!.tabs.includes(draft), true)
      assert.equal(draft.isDirty, true)
      assert.deepEqual((await library.readProgress()).decisions, decisions)
      assert.equal(
        harness.commands.filter(
          (command) => command === 'workbench.action.evenEditorWidths',
        ).length,
        equalizations,
      )
      await writeFile(headerPath, header)
      await harness.reader.openRepositoryEvidence(
        binding,
        true,
        undefined,
        origin,
      )
      await harness.controller.settle()
      assert.equal(harness.controller.state().readiness, 'ready')
      assert.equal(harness.panelColumn('codebook.studyContext'), undefined)
      assert.equal(harness.summary.visible, true)
      assert.equal(harness.sourceColumn(), 2)
      assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
    } finally {
      await writeFile(headerPath, header)
      await harness.close()
    }
  })

for (const host of ['VS Code', 'Cursor'] as const)
  // Value: protects=what the learner reads in the Learning summary (Cursor shows it in the side bar for as long as the Study stays open) and what an agent reads in codebook_status after a Repository Wiki recording visit and its Return to Wiki, which keeps the Study open behind the article's groups with the parked Application and the captured source (row 567's retention, D2=A): the reason says that the Study is set aside since Return to Wiki and names View recording and Reload saved recording, each of which brings the Study back; fails_when=the reason is the reader's catch-all "The current captured source is not ready in its native pane. Wait for it, or use Return to current…", although nothing is pending and a saved recording has no current pause (C60 c60-cu-567, frames at 30.0 s and 33.0 s); why_new=Cycle 0046 row 695; seam=articleRecordingLayoutHarness (the learner's two stacked groups), addSeparateEditorPart and the chat's focusTab for Cursor's chat part, openRepositoryEvidence with recording (View recording), the controller's settle, the Study's Return to Wiki control, the groups, presentationState and readPresentationState
  test(`after a Wiki recording visit and its Return to Wiki, the Study left open behind the article says it is set aside and names View recording to bring it back, not a wait (${host})`, async () => {
    // Arrange: the learner's article in two stacked groups; in Cursor its chat part has the keyboard.
    const harness = await articleRecordingLayoutHarness(true)
    const chat = host === 'Cursor' ? harness.addSeparateEditorPart() : undefined
    try {
      chat?.focusTab()
      await harness.reader.openRepositoryEvidence(
        harness.binding,
        true,
        undefined,
        harness.origin,
      )
      await harness.controller.settle()
      const afterVisit = harness.reader.presentationState()

      // Act
      await harness.reader.action('return-wiki')
      await harness.controller.settle()

      // Assert: the article's groups hold the retained Study tabs; the Study stays open, unconfirmed, with the reason of the set-aside Study.
      const state = harness.reader.presentationState(),
        read = await harness.reader.readPresentationState()
      assert.deepEqual(
        {
          confirmedAfterVisit: afterVisit.layoutConfirmed,
          groups: harness.groups.map((group) =>
            group.tabs.map((tab) =>
              'uri' in tab.input
                ? tab.input.uri.path.split('/').at(-1)
                : 'viewType' in tab.input
                  ? tab.input.viewType
                  : 'chat',
            ),
          ),
          state: state.state,
          layoutConfirmed: state.layoutConfirmed,
          reason: state.reason,
          readReason: read.reason,
        },
        {
          confirmedAfterVisit: true,
          groups: [
            ['article-source.ts', 'Captured-source.mts'],
            ['codebook.repositoryWiki', 'codebook.scopedBrowser'],
            ...(chat ? [['chat']] : []),
          ],
          state: 'open',
          layoutConfirmed: false,
          reason:
            'The Study is set aside since Return to Wiki, so its captured source is not in front of its native pane. Use View recording in the Repository Wiki, or Reload saved recording, to bring the Study back.',
          readReason:
            'The Study is set aside since Return to Wiki, so its captured source is not in front of its native pane. Use View recording in the Repository Wiki, or Reload saved recording, to bring the Study back.',
        },
      )
    } finally {
      await harness.close()
    }
  })

// Value: protects=the bound of row 695's reason: the action it names brings the set-aside Study back, so View recording in the Wiki after the Return confirms the Study's layout again and the reason goes; fails_when=the named action leaves the Study unconfirmed (as Restore does from this state: "The recording's Study layout could not be confirmed after Restore."), so the sentence would send the learner to a step that does not help; why_new=Cycle 0046 row 695 (its expected result: the action that brings the Study back); seam=articleRecordingLayoutHarness, openRepositoryEvidence with recording, the controller's settle, the Study's Return to Wiki control and presentationState
test('after a Wiki recording visit and its Return to Wiki, View recording in the Wiki brings the set-aside Study back with its layout confirmed', async () => {
  // Arrange: the recording visit and its Return to Wiki.
  const harness = await articleRecordingLayoutHarness(true)
  try {
    await harness.reader.openRepositoryEvidence(
      harness.binding,
      true,
      undefined,
      harness.origin,
    )
    await harness.controller.settle()
    await harness.reader.action('return-wiki')
    await harness.controller.settle()
    const afterReturn = harness.reader.presentationState().layoutConfirmed

    // Act: the learner presses View recording in the Wiki again.
    await harness.reader.openRepositoryEvidence(
      harness.binding,
      true,
      undefined,
      harness.origin,
    )
    await harness.controller.settle()

    // Assert
    const state = harness.reader.presentationState()
    assert.deepEqual(
      {
        afterReturn,
        layoutConfirmed: state.layoutConfirmed,
        reason: state.reason,
      },
      { afterReturn: false, layoutConfirmed: true, reason: undefined },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the reason of the Study an observation visit leaves after Return to Wiki: the Study context pane stands in front of the Wiki's group and the captured source behind it, and the reason says that the Study is set aside and names View observation, which brings it back; fails_when=the reason asks the learner to wait for the captured source or to return to a current pause, which a saved observation does not have; why_new=Cycle 0046 row 695 (the observation visit's Return reaches the same catch-all); seam=articleRecordingLayoutHarness, openRepositoryEvidence without recording (View observation), the Study's Return to Wiki control, presentationState
test('after a Wiki observation visit and its Return to Wiki, the Study left open says it is set aside and names View observation to bring it back', async () => {
  // Arrange: the learner's article in two stacked groups and the observation visit.
  const harness = await articleRecordingLayoutHarness(true)
  try {
    await harness.reader.openRepositoryEvidence(
      harness.binding,
      false,
      undefined,
      harness.origin,
    )
    const afterVisit = harness.reader.presentationState().layoutConfirmed

    // Act
    await harness.reader.action('return-wiki')

    // Assert
    const state = harness.reader.presentationState()
    assert.deepEqual(
      {
        afterVisit,
        layoutConfirmed: state.layoutConfirmed,
        reason: state.reason,
      },
      {
        afterVisit: true,
        layoutConfirmed: false,
        reason:
          'The Study is set aside since Return to Wiki, so its captured source is not in front of its native pane. Use View observation in the Repository Wiki to bring the Study back.',
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=an agent's replay open (codebook_playback open) in VS Code while another extension's webview, a Markdown preview in front of the learner's second group, has the keyboard and VS Code still names the first group's text editor as active (VS Code 1.140.0 workbench.desktop.main.js 705:2664 and 705:1683: the report of a code editor that had the text focus when another group became the active one stays for any editor that is no code editor, not only for the Wiki): the recording opens with its Application in its own group and the preview's group gets its keyboard back; fails_when=the preparation takes that stale text editor for the learner's place and pairs it with the preview's group, so its focus return refuses with "The previously focused source group changed; focus was not guessed.", or gives the stale text editor the keyboard; why_new=Cycle 0046 row 671; seam=articleRecordingLayoutHarness (the learner's two stacked groups), addForeignWebviewTab, focusWebviewTabKeepingTextEditorReport, openRecording, the playback state, the groups, the active tab group and the command log
test('in VS Code, an agent’s replay open while another extension’s webview in the second group has the keyboard and VS Code still names the first group’s text editor as active shows the recording in its own group and gives the webview its keyboard back', async () => {
  // Arrange: the learner's two groups are stacked, article-source.ts in front of the first and a Markdown preview in front of the second, which has the keyboard while VS Code still reports article-source.ts as the active text editor.
  const harness = await articleRecordingLayoutHarness()
  try {
    const preview = harness.addForeignWebviewTab(
      'markdown.preview',
      'Preview README.md',
      2,
    )
    harness.focusWebviewTabKeepingTextEditorReport(preview)
    const before = {
      activeColumn: harness.editor.window.tabGroups.activeTabGroup.viewColumn,
      activeTextEditor: harness
        .focusedSource()
        ?.document.uri.path.split('/')
        .at(-1),
    }
    const commandsBefore = harness.commands.length

    // Act
    const visit = await harness.reader.openRecording(harness.studyId).then(
      () => 'opened',
      (error: unknown) => String(error),
    )
    await harness.controller.settle()

    // Assert: the recording is ready with its Application alone at column 1 and the recorded source at column 2, and the preview's group, now column 3, was focused again by its number.
    const state = harness.controller.state()
    assert.deepEqual(before, {
      activeColumn: 2,
      activeTextEditor: 'article-source.ts',
    })
    assert.deepEqual(
      {
        visit,
        readiness: state.readiness,
        reason: state.reason,
        applicationColumn: harness.panelColumn('codebook.scopedBrowser'),
        sourceColumn: harness.sourceColumn(),
        previewColumn: harness.groups.find((group) =>
          group.tabs.includes(preview),
        )?.viewColumn,
        activeColumn: harness.editor.window.tabGroups.activeTabGroup.viewColumn,
        groupFocusCommands: harness.commands
          .slice(commandsBefore)
          .filter((command) => /^workbench\.action\.focus/.test(command)),
      },
      {
        visit: 'opened',
        readiness: 'ready',
        reason: undefined,
        applicationColumn: 1,
        sourceColumn: 2,
        previewColumn: 3,
        activeColumn: 3,
        groupFocusCommands: [
          'workbench.action.focusFirstEditorGroup',
          'workbench.action.focusThirdEditorGroup',
        ],
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the Repository Wiki's "View recording" in VS Code while the Wiki has the keyboard in the learner's second group and VS Code still names the text editor of the first group as the active one (C58 c58-vs-567d: the cited source's copy reported active while the Wiki's group was the active one; VS Code 1.140.0 workbench.desktop.main.js 705:2664 and 705:1683): the recording opens with its Application in its own group above the learner's groups, the recorded source below it, and the Wiki's group, now the third, gets its keyboard back; fails_when=the preparation takes that stale text editor for the learner's place and pairs it with the Wiki's group, so its focus return refuses with "The previously focused source group changed; focus was not guessed." and the visit fails with an unavailable Application pane left in a new group (3 of 3 natively); why_new=Cycle 0046 row 659; seam=articleRecordingLayoutHarness (the learner's two stacked groups with the Wiki in the second), focusWebviewTabKeepingTextEditorReport, openRepositoryEvidence with the recording, the playback state, the groups, the active tab group and the command log
test('in VS Code, View recording pressed in the Wiki of the second group while VS Code still names the first group’s text editor as active shows the recording in its own group and gives the Wiki its keyboard back', async () => {
  // Arrange: the learner's two groups are stacked, article-source.ts in front of the first and the Repository Wiki in front of the second; the learner pressed View recording in the Wiki, and VS Code still reports article-source.ts as the active text editor.
  const harness = await articleRecordingLayoutHarness()
  try {
    const wiki = harness.groups[1]!.tabs.find(
      (tab) => Reflect.get(tab.input, 'viewType') === 'codebook.repositoryWiki',
    )!
    harness.focusWebviewTabKeepingTextEditorReport(wiki)
    const before = {
      activeColumn: harness.editor.window.tabGroups.activeTabGroup.viewColumn,
      activeTextEditor: harness
        .focusedSource()
        ?.document.uri.path.split('/')
        .at(-1),
    }
    const commandsBefore = harness.commands.length

    // Act
    const visit = await harness.reader
      .openRepositoryEvidence(harness.binding, true, undefined, harness.origin)
      .then(
        () => 'opened',
        (error: unknown) => String(error),
      )
    await harness.controller.settle()

    // Assert: the recording is ready with its Application alone at column 1 and the recorded source at column 2, and the Wiki's group, now column 3, was focused again by its number.
    const state = harness.controller.state()
    assert.deepEqual(before, {
      activeColumn: 2,
      activeTextEditor: 'article-source.ts',
    })
    assert.deepEqual(
      {
        visit,
        readiness: state.readiness,
        reason: state.reason,
        applicationColumn: harness.panelColumn('codebook.scopedBrowser'),
        sourceColumn: harness.sourceColumn(),
        wikiColumn: harness.groups.find((group) => group.tabs.includes(wiki))
          ?.viewColumn,
        activeColumn: harness.editor.window.tabGroups.activeTabGroup.viewColumn,
        groupFocusCommands: harness.commands
          .slice(commandsBefore)
          .filter((command) => /^workbench\.action\.focus/.test(command)),
      },
      {
        visit: 'opened',
        readiness: 'ready',
        reason: undefined,
        applicationColumn: 1,
        sourceColumn: 2,
        wikiColumn: 3,
        activeColumn: 3,
        groupFocusCommands: [
          'workbench.action.focusFirstEditorGroup',
          'workbench.action.focusThirdEditorGroup',
        ],
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the fidelity of the workspace harness's VS Code model of stacked rows, on which row 691's verdict rests: newGroupAbove sizes the rows as VS Code 1.140.0's split view does (an even stack is distributed, an uneven one split with the missing height taken from the last row down to the minimum), and a numbered focus command that activates a row at the minimum height expands it (doRestoreGroup, workbench.desktop.main.js 1106:114938); fails_when=the fake editor halves the first row and never expands a row, so a test of a learner's uneven stack passes on sizes VS Code never gives; why_new=Cycle 0046 row 691 (c59-vs-691probe3 and c59-vs-691probe4 recorded every layout); seam=workspaceHarness, useNativeLayout with stacked pixel rows, modelVsCodeStackedRowSizing, the fake editor's newGroupAbove and numbered focus commands, editorLayout
test('the fake editor sizes and expands a learner’s stacked rows as VS Code 1.140.0 was recorded to', async () => {
  // Arrange: two stacks of the learner's, even and uneven, each with the first row active.
  const even = await workspaceHarness(),
    uneven = await workspaceHarness()
  try {
    even.useNativeLayout({
      orientation: 1,
      groups: [{ size: 343 }, { size: 344 }],
    })
    even.modelVsCodeStackedRowSizing()
    uneven.useNativeLayout({
      orientation: 1,
      groups: [{ size: 524 }, { size: 163 }],
    })
    uneven.modelVsCodeStackedRowSizing()

    // Act: a group above the first row in each; then the third row and the second one activated in the uneven stack.
    await even.editor.commands.executeCommand('workbench.action.newGroupAbove')
    await uneven.editor.commands.executeCommand(
      'workbench.action.newGroupAbove',
    )
    const unevenAfterInsertion = uneven.editorLayout()
    await uneven.editor.commands.executeCommand(
      'workbench.action.focusThirdEditorGroup',
    )
    const unevenAfterThirdRow = uneven.editorLayout()
    await uneven.editor.commands.executeCommand(
      'workbench.action.focusSecondEditorGroup',
    )

    // Assert: the sizes VS Code 1.140.0 answered in c59-vs-691probe3 and c59-vs-691probe4.
    assert.deepEqual(
      {
        evenAfterInsertion: even.editorLayout(),
        unevenAfterInsertion,
        unevenAfterThirdRow,
        unevenAfterSecondRow: uneven.editorLayout(),
      },
      {
        evenAfterInsertion: {
          orientation: 1,
          groups: [{ size: 229 }, { size: 229 }, { size: 229 }],
        },
        unevenAfterInsertion: {
          orientation: 1,
          groups: [{ size: 262 }, { size: 355 }, { size: 70 }],
        },
        unevenAfterThirdRow: {
          orientation: 1,
          groups: [{ size: 70 }, { size: 70 }, { size: 547 }],
        },
        unevenAfterSecondRow: {
          orientation: 1,
          groups: [{ size: 70 }, { size: 547 }, { size: 70 }],
        },
      },
    )
  } finally {
    await even.close()
    await uneven.close()
  }
})

// Value: protects=every reader test that inserts the Application's group above a learner's stack of rows given in pixels, or removes it again, in both editors' models: newGroupAbove gives the grid both editors gave natively without any seam (VS Code 1.140.0: 343/344 to 229/229/229 and 524/163 to 262/355/70, c59-vs-691probe3 and c59-vs-691probe4; Cursor 3.23.12: 328/329 to 219/219/219, c60-cu-567's 3-recording-open.json boxes), the split view's sizing both share, and the emptied group's removal keeps the editor area's height as the split view's removeView does (distributed rows distributed again, otherwise the row after the first takes its height); fails_when=the fake editor halves the first row by default (343/344 to 171.5/171.5/344), or a removal drops the row's height from the editor area, so a test of a stack passes on a grid neither editor gives; why_new=Cycle 0046 row 703 (the rows 686 to 701 fixer's finding); seam=workspaceHarness, useNativeLayout with stacked pixel rows, replaceGroupObjectsOnTabChanges (Cursor's model), the fake editor's newGroupAbove and editorLayout
for (const host of ['VS Code', 'Cursor'] as const)
  test(`the fake editor of ${host} adds a group above a learner's stack of rows in pixels and removes it with the grids ${host} gives natively`, async () => {
    // Arrange: an even and an uneven stack of the learner's, each with the first row active.
    const even = await workspaceHarness(),
      uneven = await workspaceHarness()
    try {
      even.useNativeLayout({
        orientation: 1,
        groups:
          host === 'VS Code'
            ? [{ size: 343 }, { size: 344 }]
            : [{ size: 328 }, { size: 329 }],
      })
      uneven.useNativeLayout({
        orientation: 1,
        groups: [{ size: 524 }, { size: 163 }],
      })
      if (host === 'Cursor') {
        even.replaceGroupObjectsOnTabChanges()
        uneven.replaceGroupObjectsOnTabChanges()
      }

      // Act
      await even.editor.commands.executeCommand(
        'workbench.action.newGroupAbove',
      )
      await uneven.editor.commands.executeCommand(
        'workbench.action.newGroupAbove',
      )
      const evenAfterInsertion = even.editorLayout(),
        unevenAfterInsertion = uneven.editorLayout()
      // The new empty group closes again.
      await even.editor.window.tabGroups.close(
        even.groups.find((group) => group.viewColumn === 1)!,
      )
      await uneven.editor.window.tabGroups.close(
        uneven.groups.find((group) => group.viewColumn === 1)!,
      )

      // Assert
      assert.deepEqual(
        {
          evenAfterInsertion,
          unevenAfterInsertion,
          evenAfterRemoval: even.editorLayout(),
          unevenAfterRemoval: uneven.editorLayout(),
        },
        {
          evenAfterInsertion: {
            orientation: 1,
            groups:
              host === 'VS Code'
                ? [{ size: 229 }, { size: 229 }, { size: 229 }]
                : [{ size: 219 }, { size: 219 }, { size: 219 }],
          },
          unevenAfterInsertion: {
            orientation: 1,
            groups: [{ size: 262 }, { size: 355 }, { size: 70 }],
          },
          evenAfterRemoval: {
            orientation: 1,
            groups:
              host === 'VS Code'
                ? [{ size: 343 }, { size: 344 }]
                : [{ size: 328 }, { size: 329 }],
          },
          unevenAfterRemoval: {
            orientation: 1,
            groups: [{ size: 617 }, { size: 70 }],
          },
        },
      )
    } finally {
      await even.close()
      await uneven.close()
    }
  })

// Value: protects=the learner's uneven stack of two rows through a Repository Wiki recording visit and its article Return in VS Code: the visit's newGroupAbove leaves the Wiki's row at the minimum height, which VS Code expands when the visit gives the Wiki its keyboard back (doRestoreGroup, workbench.desktop.main.js 1106:114938), so the visit stacks its rows at one height first; its arrangement stays confirmed and the Return gives the learner's rows back at 524 and 163 px, with row 681's retained tabs while the Study stays open; fails_when=the visit keeps VS Code's 262/355/70, the focus return expands the Wiki's row to 70/70/547, the Study reports "The Study arrangement is not confirmed: the editor grid no longer has the sizes of the confirmed layout…" and the Return gives nothing back (C59 c59-vs-567, c59-vs-691probe4: the Application's group left at column 1, three rows); why_new=Cycle 0046 row 691; seam=articleRecordingLayoutHarness with a recording with recorded values, as the native rounds' study had (its debugger's model selection activates the captured source's group, row 721), useNativeLayout with the uneven stack, modelVsCodeStackedRowSizing, focusWebviewTabKeepingTextEditorReport (View recording pressed in the Wiki), openRepositoryEvidence with the recording, the presentation state, the return-wiki action, editorLayout and the groups' tabs
test('in VS Code, a Wiki recording visit in the learner’s uneven stack of two rows stays confirmed, and the article Return gives both rows back at their sizes', async () => {
  // Arrange: the learner's rows are 524 and 163 px high, article-source.ts in the first and the Repository Wiki in the second, where the learner pressed View recording of a recording with recorded values.
  const harness = await articleRecordingLayoutHarness(false, true)
  try {
    harness.useNativeLayout({
      orientation: 1,
      groups: [{ size: 524 }, { size: 163 }],
    })
    harness.modelVsCodeStackedRowSizing()
    const wiki = harness.groups[1]!.tabs.find(
      (tab) => Reflect.get(tab.input, 'viewType') === 'codebook.repositoryWiki',
    )!
    harness.focusWebviewTabKeepingTextEditorReport(wiki)
    const tabsOfGroups = (): string[][] =>
      harness.groups
        .toSorted((left, right) => left.viewColumn - right.viewColumn)
        .map((group) =>
          group.tabs.map((tab) =>
            'uri' in tab.input
              ? tab.input.uri.path.split('/').at(-1)!
              : String(Reflect.get(tab.input, 'viewType')),
          ),
        )

    // Act: the visit, then the article Return from the recording.
    await harness.reader.openRepositoryEvidence(
      harness.binding,
      true,
      undefined,
      harness.origin,
    )
    await harness.controller.settle()
    // The arrangement as an agent's codebook_status reads it, from the editor's grid now.
    const presentation = await harness.reader.readPresentationState()
    const visit = {
      layout: harness.editorLayout(),
      layoutConfirmed: presentation.layoutConfirmed,
      reason: presentation.reason,
      readiness: harness.controller.state().readiness,
    }
    await harness.reader.action('return-wiki')

    // Assert: three rows of one height during the visit, confirmed; the learner's two rows at their own sizes after the Return, with the captured source left in the learner's first group and the parked Application behind the Wiki while the Study stays open (row 681's retention, where VS Code parked it in c60-vs-567 and c59-vs-691probe3, row 721).
    assert.deepEqual(
      {
        visit,
        layoutAfterReturn: harness.editorLayout(),
        tabsAfterReturn: tabsOfGroups(),
      },
      {
        visit: {
          layout: {
            orientation: 1,
            groups: [{ size: 229 }, { size: 229 }, { size: 229 }],
          },
          layoutConfirmed: true,
          reason: undefined,
          readiness: 'ready',
        },
        layoutAfterReturn: {
          orientation: 1,
          groups: [{ size: 524 }, { size: 163 }],
        },
        tabsAfterReturn: [
          ['article-source.ts', 'Captured-source.mts'],
          ['codebook.repositoryWiki', 'codebook.scopedBrowser'],
        ],
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the fidelity of the workspace harness's VS Code model of a learner's nested grid, on which row 704's verdict rests: newGroupAbove sizes the stack of rows the first group stands in, also the rows of a first column, as VS Code 1.140.0's split view does (its addView and relayout, workbench.desktop.main.js 540:72177, 540:73529, 540:73732), keeping the other splits as they are; and a numbered focus command that activates a group at its minimum height expands it along every split on its path (doRestoreGroup 1106:114938, the grid's expandView 981:39660, resizeChild to infinity), its row and its column alike; fails_when=the fake editor halves the first group of a nested grid and never expands a nested group, so a test of a learner's nested grid passes on sizes VS Code never gives; why_new=Cycle 0046 row 704 (no native probe of a nested grid; the sizes follow the cited code as row 691's probes confirmed it for stacked rows); seam=workspaceHarness, useNativeLayout with nested pixel layouts, modelVsCodeStackedRowSizing, the fake editor's newGroupAbove and numbered focus commands, editorLayout
test('the fake editor sizes and expands a learner’s nested grid as VS Code 1.140.0’s split view and grid do', async () => {
  // Arrange: a learner's rows of 524 and 163 px whose second row is split into two columns, and a learner's two columns whose first is split into rows of 524 and 163 px; the first group is the active one.
  const rowOfColumns = await workspaceHarness(),
    columnOfRows = await workspaceHarness()
  try {
    rowOfColumns.useNativeLayout({
      orientation: 1,
      groups: [
        { size: 524 },
        { size: 163, groups: [{ size: 550 }, { size: 550 }] },
      ],
    })
    rowOfColumns.modelVsCodeStackedRowSizing()
    columnOfRows.useNativeLayout({
      orientation: 0,
      groups: [
        { size: 550, groups: [{ size: 524 }, { size: 163 }] },
        { size: 550 },
      ],
    })
    columnOfRows.modelVsCodeStackedRowSizing()

    // Act: a group above the first group in each; then the group at the minimum height activated: the second column of the last row, and the last row of the first column.
    await rowOfColumns.editor.commands.executeCommand(
      'workbench.action.newGroupAbove',
    )
    const rowOfColumnsAfterInsertion = rowOfColumns.editorLayout()
    await rowOfColumns.editor.commands.executeCommand(
      'workbench.action.focusFourthEditorGroup',
    )
    await columnOfRows.editor.commands.executeCommand(
      'workbench.action.newGroupAbove',
    )
    const columnOfRowsAfterInsertion = columnOfRows.editorLayout()
    await columnOfRows.editor.commands.executeCommand(
      'workbench.action.focusThirdEditorGroup',
    )

    // Assert
    assert.deepEqual(
      {
        rowOfColumnsAfterInsertion,
        rowOfColumnsAfterActivation: rowOfColumns.editorLayout(),
        columnOfRowsAfterInsertion,
        columnOfRowsAfterActivation: columnOfRows.editorLayout(),
      },
      {
        rowOfColumnsAfterInsertion: {
          orientation: 1,
          groups: [
            { size: 262 },
            { size: 355 },
            { size: 70, groups: [{ size: 550 }, { size: 550 }] },
          ],
        },
        rowOfColumnsAfterActivation: {
          orientation: 1,
          groups: [
            { size: 70 },
            { size: 70 },
            { size: 547, groups: [{ size: 220 }, { size: 880 }] },
          ],
        },
        columnOfRowsAfterInsertion: {
          orientation: 0,
          groups: [
            {
              size: 550,
              groups: [{ size: 262 }, { size: 355 }, { size: 70 }],
            },
            { size: 550 },
          ],
        },
        columnOfRowsAfterActivation: {
          orientation: 0,
          groups: [
            {
              size: 880,
              groups: [{ size: 70 }, { size: 70 }, { size: 547 }],
            },
            { size: 220 },
          ],
        },
      },
    )
  } finally {
    await rowOfColumns.close()
    await columnOfRows.close()
  }
})

for (const grid of [
  'a row split into columns',
  'a column split into rows',
] as const)
  // Value: protects=the learner's nested grid through a Repository Wiki recording visit and its article Return in VS Code: the Wiki's group stands in a stack of rows that the visit's newGroupAbove leaves with a row at the minimum height, the learner's second row split into columns or the learner's first column split into rows, so the visit stacks that stack's rows at one height, keeping the other split as the learner has it, before the focus return activates the Wiki's group; its arrangement stays confirmed and the Return gives the learner's grid back at its sizes; fails_when=the visit leaves the nested row at the minimum height because row 691's stacking takes only a root stack of single groups, the focus return expands the Wiki's group along its row and its column, and the Study reports "The Study arrangement is not confirmed: the editor grid no longer has the sizes of the confirmed layout…" while the Return gives nothing back; why_new=Cycle 0046 row 704; seam=articleRecordingLayoutHarness, useNativeLayout with a nested grid, focusMutableDraft (the learner's file in the third group), modelVsCodeStackedRowSizing, focusWebviewTabKeepingTextEditorReport (View recording pressed in the Wiki), openRepositoryEvidence with the recording, the presentation state, the return-wiki action and editorLayout
  test(`in VS Code, a Wiki recording visit in the learner’s grid with ${grid} stays confirmed, and the article Return gives the grid back at its sizes`, async () => {
    // Arrange: article-source.ts in the first group, the Repository Wiki in the second, where the learner pressed View recording, and the learner's notes.md in the third.
    const learnerGrid =
      grid === 'a row split into columns'
        ? {
            orientation: 1,
            groups: [
              { size: 524 },
              { size: 163, groups: [{ size: 550 }, { size: 550 }] },
            ],
          }
        : {
            orientation: 0,
            groups: [
              { size: 550, groups: [{ size: 524 }, { size: 163 }] },
              { size: 550 },
            ],
          }
    const harness = await articleRecordingLayoutHarness()
    try {
      harness.useNativeLayout(learnerGrid)
      harness.focusMutableDraft('notes.md', 3)
      harness.modelVsCodeStackedRowSizing()
      const wiki = harness.groups[1]!.tabs.find(
        (tab) =>
          Reflect.get(tab.input, 'viewType') === 'codebook.repositoryWiki',
      )!
      harness.focusWebviewTabKeepingTextEditorReport(wiki)

      // Act: the visit, then the article Return from the recording.
      await harness.reader.openRepositoryEvidence(
        harness.binding,
        true,
        undefined,
        harness.origin,
      )
      await harness.controller.settle()
      // The arrangement as an agent's codebook_status reads it, from the editor's grid now.
      const presentation = await harness.reader.readPresentationState()
      const visit = {
        layout: harness.editorLayout(),
        layoutConfirmed: presentation.layoutConfirmed,
        reason: presentation.reason,
      }
      await harness.reader.action('return-wiki')

      // Assert: the stack with the Wiki's group at one height during the visit, confirmed; the learner's grid at its own sizes after the Return.
      assert.deepEqual(
        { visit, layoutAfterReturn: harness.editorLayout() },
        {
          visit: {
            layout:
              grid === 'a row split into columns'
                ? {
                    orientation: 1,
                    groups: [
                      { size: 229 },
                      { size: 229 },
                      { size: 229, groups: [{ size: 550 }, { size: 550 }] },
                    ],
                  }
                : {
                    orientation: 0,
                    groups: [
                      {
                        size: 550,
                        groups: [{ size: 229 }, { size: 229 }, { size: 229 }],
                      },
                      { size: 550 },
                    ],
                  },
            layoutConfirmed: true,
            reason: undefined,
          },
          layoutAfterReturn: learnerGrid,
        },
      )
    } finally {
      await harness.close()
    }
  })

// Value: protects=row 695's reason after the article Return in the learner's uneven stack in VS Code: View recording pressed again in the Wiki (the learner's second visit, with the Study set aside behind the article, row 681's retained Application parked in the Wiki's group and the captured source behind the learner's front tab, as c61-cu-695c's 5-after-return.json reads) brings the Study back: the parked Application moves into its new group, the rows stand at one height before the Wiki's row at the minimum height is activated, the layout is confirmed with no reason, and the second Return gives the learner's 524 and 163 px back; fails_when=the move's watch reads the end of the editor's report of the text editor that was active before the new group (the report the new empty group keeps until the pane stands in front of it) as the learner leaving that file, so the visit is refused with "The recording is not shown: it could not be loaded (Native pane, group or focus changed while presentation waited; the learner arrangement was preserved.)…", before its rows are stacked, and the focus return expands the Wiki's row to 70/70/547 with the Application's re-created group at column 1 (C61 c61-vs-695); why_new=Cycle 0046 row 710; seam=articleRecordingLayoutHarness, useNativeLayout with the uneven stack, modelVsCodeStackedRowSizing, keepTextEditorReportAfterNewGroup, focusWebviewTabKeepingTextEditorReport (View recording pressed in the Wiki), focusExistingSource (the replay's stop in the captured source before Return to Wiki), focusMutableDraft (the learner's front tab of the first group after the Return), openRepositoryEvidence with the recording twice, the return-wiki action, presentationState, editorLayout and the groups' tabs
test('in VS Code, View recording pressed again in the Wiki after the article Return in the learner’s uneven stack brings the set-aside Study back confirmed, and its Return gives both rows back', async () => {
  // Arrange: the learner's rows are 524 and 163 px high; the first visit and its article Return left the Study set aside behind the article, with the Application parked behind the Wiki.
  const harness = await articleRecordingLayoutHarness()
  try {
    harness.useNativeLayout({
      orientation: 1,
      groups: [{ size: 524 }, { size: 163 }],
    })
    harness.modelVsCodeStackedRowSizing()
    harness.keepTextEditorReportAfterNewGroup()
    const wikiTab = () =>
      harness.groups
        .flatMap((group) => group.tabs)
        .find(
          (tab) =>
            Reflect.get(tab.input, 'viewType') === 'codebook.repositoryWiki',
        )!
    harness.focusWebviewTabKeepingTextEditorReport(wikiTab())
    await harness.reader.openRepositoryEvidence(
      harness.binding,
      true,
      undefined,
      harness.origin,
    )
    await harness.controller.settle()
    // The replay's stop gave the captured source the keyboard before the learner pressed Return to Wiki in the Learning summary.
    harness.focusExistingSource(
      harness.editor.window.visibleTextEditors.find((editor) =>
        editor.document.uri.path.endsWith('/Captured-source.mts'),
      )!,
    )
    await harness.reader.action('return-wiki')
    await harness.controller.settle()
    // The learner's file stands in front of the first group again and the Wiki has the keyboard on View recording.
    harness.focusMutableDraft('login-form.tsx', 1)
    harness.focusWebviewTabKeepingTextEditorReport(wikiTab())
    const tabsOfGroups = (): string[][] =>
      harness.groups
        .toSorted((left, right) => left.viewColumn - right.viewColumn)
        .map((group) =>
          group.tabs.map((tab) =>
            'uri' in tab.input
              ? tab.input.uri.path.split('/').at(-1)!
              : String(Reflect.get(tab.input, 'viewType')),
          ),
        )
    const tabsBeforeSecondVisit = tabsOfGroups()

    // Act: the learner presses View recording in the Wiki again, then Return to Wiki.
    const refusal = await harness.reader
      .openRepositoryEvidence(harness.binding, true, undefined, harness.origin)
      .then(
        () => undefined,
        (error: unknown) => String(error),
      )
    await harness.controller.settle()
    const secondVisit = {
      refusal,
      layout: harness.editorLayout(),
      layoutConfirmed: harness.reader.presentationState().layoutConfirmed,
      reason: harness.reader.presentationState().reason,
      tabs: tabsOfGroups(),
    }
    await harness.reader.action('return-wiki')
    await harness.controller.settle()

    // Assert
    assert.deepEqual(
      {
        tabsBeforeSecondVisit,
        secondVisit,
        layoutAfterSecondReturn: harness.editorLayout(),
      },
      {
        tabsBeforeSecondVisit: [
          ['article-source.ts', 'Captured-source.mts', 'login-form.tsx'],
          ['codebook.repositoryWiki', 'codebook.scopedBrowser'],
        ],
        secondVisit: {
          refusal: undefined,
          layout: {
            orientation: 1,
            groups: [{ size: 229 }, { size: 229 }, { size: 229 }],
          },
          layoutConfirmed: true,
          reason: undefined,
          tabs: [
            ['codebook.scopedBrowser'],
            ['article-source.ts', 'Captured-source.mts', 'login-form.tsx'],
            ['codebook.repositoryWiki'],
          ],
        },
        layoutAfterSecondReturn: {
          orientation: 1,
          groups: [{ size: 524 }, { size: 163 }],
        },
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=row 695's reason after the article Return beside Cursor's chat part: View recording pressed again in the Wiki brings the set-aside Study back with its layout confirmed and the captured source in front of the learner's group, as the first visit from a closed Study does; fails_when=the move of the parked Application into its new group is refused because Cursor reports no active text editor only once that pane stands in front of the group, after the first group's focus made the Wiki's cited copy the active text editor (C61 c61-cu-695, 695b and 695c: "The recording is not shown: it could not be loaded (Native pane, group or focus changed while presentation waited; the learner arrangement was preserved.). Open the recording again, then restore the layout.", the re-created Application group at column 1 holding the parked Application); why_new=Cycle 0046 row 710; seam=articleRecordingLayoutHarness, useHostAppName, addSeparateEditorPart, keepTextEditorReportAfterNewGroup, focusExistingWebviewTab (the Wiki's keyboard on View recording), focusExistingSource (the replay's stop in the captured source), focusMutableDraft (the learner's front tab of the first group), openRepositoryEvidence with the recording twice, the return-wiki action, presentationState and the groups' front tabs
test('in Cursor, View recording pressed again in the Wiki after the article Return brings the set-aside Study back confirmed with its captured source in front', async () => {
  // Arrange: the learner's two stacked groups beside Cursor's chat part; the first visit and its article Return left the Study set aside, with the Application parked behind the Wiki.
  const harness = await articleRecordingLayoutHarness()
  harness.useHostAppName('Cursor')
  harness.addSeparateEditorPart()
  harness.keepTextEditorReportAfterNewGroup()
  try {
    const wikiTab = () =>
      harness.groups
        .flatMap((group) => group.tabs)
        .find(
          (tab) =>
            Reflect.get(tab.input, 'viewType') === 'codebook.repositoryWiki',
        )!
    harness.focusExistingWebviewTab(wikiTab())
    await harness.reader.openRepositoryEvidence(
      harness.binding,
      true,
      undefined,
      harness.origin,
    )
    await harness.controller.settle()
    // The replay's stop gave the captured source the keyboard before the learner pressed Return to Wiki in the Learning summary.
    harness.focusExistingSource(
      harness.editor.window.visibleTextEditors.find((editor) =>
        editor.document.uri.path.endsWith('/Captured-source.mts'),
      )!,
    )
    await harness.reader.action('return-wiki')
    await harness.controller.settle()
    // The learner's file stands in front of the first group again and the Wiki has the keyboard on View recording.
    harness.focusMutableDraft('login-form.tsx', 1)
    harness.focusExistingWebviewTab(wikiTab())
    const frontTabs = (): string[] =>
      harness.groups
        .toSorted((left, right) => left.viewColumn - right.viewColumn)
        .map((group) =>
          group.activeTab && 'uri' in group.activeTab.input
            ? group.activeTab.input.uri.path.split('/').at(-1)!
            : String(
                Reflect.get(Object(group.activeTab?.input), 'viewType') ??
                  'chat',
              ),
        )

    // Act: the learner presses View recording in the Wiki again.
    const refusal = await harness.reader
      .openRepositoryEvidence(harness.binding, true, undefined, harness.origin)
      .then(
        () => undefined,
        (error: unknown) => String(error),
      )
    await harness.controller.settle()

    // Assert
    const state = harness.reader.presentationState()
    assert.deepEqual(
      {
        refusal,
        layoutConfirmed: state.layoutConfirmed,
        reason: state.reason,
        frontTabs: frontTabs(),
      },
      {
        refusal: undefined,
        layoutConfirmed: true,
        reason: undefined,
        frontTabs: [
          'codebook.scopedBrowser',
          'Captured-source.mts',
          'codebook.repositoryWiki',
          'chat',
        ],
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the fidelity of the workspace harness's article Return, on which every test of the tabs that Return leaves rests: in Cursor 3.23.12's model the Return to Wiki pressed in the Learning summary after a Repository Wiki recording visit leaves the learner's groups as C60's c60-cu-567 read them natively (2-before-enter.json and 5-after-return.json): the Wiki's cited copy of login-form.tsx in front of the first group again with Captured-source.mts right behind it, and the parked Application right behind the Repository Wiki, which is in front of the active group; the Return runs the real Repository Wiki reader's open as extension.ts does, both editors place a tab they open or move into a group right after the tab it shows (workbench.editor.openPositioning, right), and the Wiki's hidden document loads again when its panel comes back to the front; fails_when=the fake editor appends Captured-source.mts and the Application at the ends of their groups or moves the Wiki's tab to the end at its reveal, the Wiki's document never loads again so the Return is refused with "Timed out waiting for the current Repository Wiki article to render", or the Return only restores the layout so Captured-source.mts stays in front of the first group, the Application in front of the Wiki and the first group active (what the row 710 tests set by hand); why_new=Cycle 0046 row 703; seam=articleRecordingLayoutHarness with openRepositoryWiki (the real RepositoryReader, and the Return through its open), useHostAppName, useNativeLayout with 328/329 px rows, addSeparateEditorPart, replaceGroupObjectsOnTabChanges, keepTextEditorReportAfterNewGroup, leavePaneFocusUnreportedBesideChat, closeTabByHand, focusMutableDraft, addOpaqueTab, openRepositoryEvidence with the recording, the Learning summary's return-wiki action, the groups' tabs and editorLayout
test('in Cursor, the article Return of a Wiki recording visit leaves the Wiki’s cited copy in front of the learner’s first group with the captured source right behind it, and the parked Application right behind the Wiki in front of the active group, as Cursor did natively', async () => {
  // Arrange: c60-cu-567's window before View recording: the learner's two stacked rows beside Cursor's chat part, login-form.tsx's cited copy in front of the first row and the Repository Wiki in front of the second, which is the active group.
  const harness = await articleRecordingLayoutHarness()
  try {
    harness.useHostAppName('Cursor')
    harness.useNativeLayout({
      orientation: 1,
      groups: [{ size: 328 }, { size: 329 }],
    })
    harness.addSeparateEditorPart()
    harness.replaceGroupObjectsOnTabChanges()
    harness.keepTextEditorReportAfterNewGroup()
    harness.leavePaneFocusUnreportedBesideChat()
    // The learner's own files take the place of the fixture's article-source.ts.
    harness.closeTabByHand(
      harness.groups.find((group) => group.viewColumn === 1)!.tabs[0]!,
    )
    const loginForm = harness.focusMutableDraft('login-form.tsx', 1)
    harness.focusMutableDraft('package.json', 1)
    harness.focusMutableDraft('actions.ts', 1)
    harness.focusMutableDraft('auth.ts', 1)
    harness.focusMutableDraft('README.md', 2)
    harness.focusMutableDraft('auth.ts', 2)
    // The settings pages stand last in their groups, as in that window.
    for (const [label, column] of [
      ['Cursor Settings', 1],
      ['VS Code Settings', 1],
      ['Cursor Settings', 2],
    ] as const) {
      const page = harness.addOpaqueTab(label, column),
        group = harness.groups.find(
          (candidate) => candidate.viewColumn === column,
        )!
      group.tabs.splice(group.tabs.indexOf(page), 1)
      group.tabs.push(page)
    }
    loginForm.focus()
    await harness.openRepositoryWiki()
    const groupsOfWindow = () =>
      harness.groups
        .toSorted((left, right) => left.viewColumn - right.viewColumn)
        .map((group) => {
          const name = (tab: (typeof group.tabs)[number]): string =>
            'uri' in tab.input
              ? tab.input.uri.scheme === 'file'
                ? tab.label
                : `${tab.label} (${tab.input.uri.scheme})`
              : String(Reflect.get(tab.input, 'viewType') ?? tab.label)
          return {
            column: group.viewColumn,
            active:
              group.viewColumn ===
              harness.editor.window.tabGroups.activeTabGroup.viewColumn,
            front: group.activeTab && name(group.activeTab),
            tabs: group.tabs.map(name),
          }
        })
    const beforeVisit = groupsOfWindow()

    // Act: View recording in the Wiki, then Return to Wiki pressed in the Learning summary.
    await harness.reader.openRepositoryEvidence(
      harness.binding,
      true,
      undefined,
      harness.origin,
    )
    await harness.controller.settle()
    const returnRefusal = await harness.reader.action('return-wiki', true).then(
      () => undefined,
      (error: unknown) => String(error),
    )
    await harness.controller.settle()

    // Assert: the groups of 2-before-enter.json before the visit, and those of 5-after-return.json after the Return, at the learner's sizes.
    assert.deepEqual(
      {
        beforeVisit,
        returnRefusal,
        afterReturn: groupsOfWindow(),
        layoutAfterReturn: harness.editorLayout(),
      },
      {
        beforeVisit: [
          {
            column: 1,
            active: false,
            front: 'login-form.tsx (codebook-repository-source)',
            tabs: [
              'login-form.tsx',
              'login-form.tsx (codebook-repository-source)',
              'package.json',
              'actions.ts',
              'auth.ts',
              'Cursor Settings',
              'VS Code Settings',
            ],
          },
          {
            column: 2,
            active: true,
            front: 'codebook.repositoryWiki',
            tabs: [
              'README.md',
              'auth.ts',
              'codebook.repositoryWiki',
              'Cursor Settings',
            ],
          },
          { column: 3, active: false, front: 'New Agent', tabs: ['New Agent'] },
        ],
        returnRefusal: undefined,
        afterReturn: [
          {
            column: 1,
            active: false,
            front: 'login-form.tsx (codebook-repository-source)',
            tabs: [
              'login-form.tsx',
              'login-form.tsx (codebook-repository-source)',
              'Captured-source.mts (codebook-source)',
              'package.json',
              'actions.ts',
              'auth.ts',
              'Cursor Settings',
              'VS Code Settings',
            ],
          },
          {
            column: 2,
            active: true,
            front: 'codebook.repositoryWiki',
            tabs: [
              'README.md',
              'auth.ts',
              'codebook.repositoryWiki',
              'codebook.scopedBrowser',
              'Cursor Settings',
            ],
          },
          { column: 3, active: false, front: 'New Agent', tabs: ['New Agent'] },
        ],
        layoutAfterReturn: {
          orientation: 1,
          groups: [{ size: 328 }, { size: 329 }],
        },
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the fidelity of the workspace harness's VS Code model of a Repository Wiki recording visit and its article Return, on which the VS Code tests of the tabs that Return leaves rest (rows 567, 681 and 710): VS Code 1.140.0 read in C60's c60-vs-567 (2-before-enter.json, 3-recording-open.json, 5-after-return.json, ext-observer.json): the visit of a recording with recorded values ends with the learner's first group active, Captured-source.mts in front of it and reported as the active text editor, because the historical debugger's model selection (workbench.action.debug.focusProcess, after the visit's focus return to the Wiki's group) opens the stop's source preserving the focus and so activates its group; the article Return then parks the Application right behind the Repository Wiki in the article's second group, and the Wiki's cited copy stands in front of the learner's first group again with Captured-source.mts right behind it; fails_when=the fake editor answers no focusProcess, so the visit ends with the Wiki's group active and the Return parks the Application in the learner's first group behind Captured-source.mts, which VS Code never did; why_new=Cycle 0046 row 721; seam=articleRecordingLayoutHarness with a recording with recorded values and openRepositoryWiki (the real RepositoryReader, and the Return through its open), useNativeLayout with 343/344 px rows, modelVsCodeStackedRowSizing, keepTextEditorReportAfterNewGroup, closeTabByHand, focusMutableDraft, focusExistingSource and focusWebviewTabKeepingTextEditorReport (the cited copy reported while the Wiki has the keyboard), openRepositoryEvidence with the recording, the Learning summary's return-wiki action, the command log, the groups' tabs, the active text editor and editorLayout
test('in VS Code, a Wiki recording visit with recorded values ends with the learner’s first group active, and the article Return parks the Application right behind the Wiki in the article’s group, as VS Code did natively', async () => {
  // Arrange: c60-vs-567's window before View recording: the learner's two stacked rows, login-form.tsx's cited copy in front of the first row and the Repository Wiki in front of the second, which is the active group with the keyboard while VS Code still reports the cited copy as the active text editor.
  const harness = await articleRecordingLayoutHarness(true, true)
  try {
    harness.useNativeLayout({
      orientation: 1,
      groups: [{ size: 343 }, { size: 344 }],
    })
    harness.modelVsCodeStackedRowSizing()
    harness.keepTextEditorReportAfterNewGroup()
    // The learner's own files take the place of the fixture's article-source.ts.
    harness.closeTabByHand(
      harness.groups.find((group) => group.viewColumn === 1)!.tabs[0]!,
    )
    harness.focusMutableDraft('actions.ts', 1)
    harness.focusMutableDraft('app-page.runtime.dev.js', 1)
    const loginForm = harness.focusMutableDraft('login-form.tsx', 1)
    harness.focusMutableDraft('README.md', 1)
    harness.focusMutableDraft('auth.ts', 1)
    harness.focusMutableDraft('auth.ts', 2)
    loginForm.focus()
    await harness.openRepositoryWiki()
    harness.focusExistingSource(
      harness.editor.window.visibleTextEditors.find(
        (editor) => editor.document.uri.scheme === 'codebook-repository-source',
      )!,
    )
    harness.focusWebviewTabKeepingTextEditorReport(
      harness.groups
        .flatMap((group) => group.tabs)
        .find(
          (tab) =>
            Reflect.get(tab.input, 'viewType') === 'codebook.repositoryWiki',
        )!,
    )
    /** Names a tab as the receipts do: a file by its label, another document with its scheme, a pane by its view type, a preview tab marked. */
    const tabName = (tab: (typeof harness.groups)[number]['tabs'][number]) =>
      ('uri' in tab.input
        ? tab.input.uri.scheme === 'file'
          ? tab.label
          : `${tab.label} (${tab.input.uri.scheme})`
        : String(Reflect.get(tab.input, 'viewType') ?? tab.label)) +
      (tab.isPreview ? ' (preview)' : '')
    const groupsOfWindow = () =>
      harness.groups
        .toSorted((left, right) => left.viewColumn - right.viewColumn)
        .map((group) => ({
          column: group.viewColumn,
          active:
            group.viewColumn ===
            harness.editor.window.tabGroups.activeTabGroup.viewColumn,
          front: group.activeTab && tabName(group.activeTab),
          tabs: group.tabs.map(tabName),
        }))
    /** Names the active text editor's document as `tabName` names its tab. */
    const activeTextEditor = (): string | undefined => {
      const uri = harness.editor.window.activeTextEditor?.document.uri
      return uri && `${uri.path.split('/').at(-1)} (${uri.scheme})`
    }
    const beforeVisit = {
        groups: groupsOfWindow(),
        activeTextEditor: activeTextEditor(),
      },
      commandsBefore = harness.commands.length

    // Act: View recording in the Wiki, then Return to Wiki pressed in the Learning summary.
    await harness.reader.openRepositoryEvidence(
      harness.binding,
      true,
      undefined,
      harness.origin,
    )
    await harness.controller.settle()
    const visit = {
      groups: groupsOfWindow(),
      activeTextEditor: activeTextEditor(),
      layout: harness.editorLayout(),
      focusCommands: harness.commands
        .slice(commandsBefore)
        .filter((command) =>
          /^workbench\.action\.(focus\w+EditorGroup|debug\.focusProcess)$/.test(
            command,
          ),
        ),
    }
    const returnRefusal = await harness.reader.action('return-wiki', true).then(
      () => undefined,
      (error: unknown) => String(error),
    )
    await harness.controller.settle()

    // Assert: the groups of 2-before-enter.json, 3-recording-open.json and 5-after-return.json, the visit's focus commands as ext-observer.json lists them, and the learner's sizes after the Return.
    assert.deepEqual(
      {
        beforeVisit,
        visit,
        returnRefusal,
        afterReturn: groupsOfWindow(),
        layoutAfterReturn: harness.editorLayout(),
      },
      {
        beforeVisit: {
          groups: [
            {
              column: 1,
              active: false,
              front: 'login-form.tsx (codebook-repository-source)',
              tabs: [
                'actions.ts',
                'app-page.runtime.dev.js',
                'login-form.tsx',
                'login-form.tsx (codebook-repository-source)',
                'README.md',
                'auth.ts',
              ],
            },
            {
              column: 2,
              active: true,
              front: 'codebook.repositoryWiki',
              tabs: ['auth.ts', 'codebook.repositoryWiki'],
            },
          ],
          activeTextEditor: 'login-form.tsx (codebook-repository-source)',
        },
        visit: {
          groups: [
            {
              column: 1,
              active: false,
              front: 'codebook.scopedBrowser',
              tabs: ['codebook.scopedBrowser'],
            },
            {
              column: 2,
              active: true,
              front: 'Captured-source.mts (codebook-source)',
              tabs: [
                'actions.ts',
                'app-page.runtime.dev.js',
                'login-form.tsx',
                'login-form.tsx (codebook-repository-source)',
                'Captured-source.mts (codebook-source)',
                'README.md',
                'auth.ts',
              ],
            },
            {
              column: 3,
              active: false,
              front: 'codebook.repositoryWiki',
              tabs: ['auth.ts', 'codebook.repositoryWiki'],
            },
          ],
          activeTextEditor: 'Captured-source.mts (codebook-source)',
          layout: {
            orientation: 1,
            groups: [{ size: 229 }, { size: 229 }, { size: 229 }],
          },
          focusCommands: [
            'workbench.action.focusFirstEditorGroup',
            'workbench.action.focusThirdEditorGroup',
            'workbench.action.debug.focusProcess',
          ],
        },
        returnRefusal: undefined,
        afterReturn: [
          {
            column: 1,
            active: false,
            front: 'login-form.tsx (codebook-repository-source)',
            tabs: [
              'actions.ts',
              'app-page.runtime.dev.js',
              'login-form.tsx',
              'login-form.tsx (codebook-repository-source)',
              'Captured-source.mts (codebook-source)',
              'README.md',
              'auth.ts',
            ],
          },
          {
            column: 2,
            active: true,
            front: 'codebook.repositoryWiki',
            tabs: [
              'auth.ts',
              'codebook.repositoryWiki',
              'codebook.scopedBrowser (preview)',
            ],
          },
        ],
        layoutAfterReturn: {
          orientation: 1,
          groups: [{ size: 343 }, { size: 344 }],
        },
      },
    )
  } finally {
    await harness.close()
  }
})

for (const host of ['VS Code', 'Cursor'] as const)
  // Value: protects=the fidelity of the workspace harness's tab labels for a pane the reader retitles, on which every reader test that knows a tab by its label rests (the chat's give-back finds a remembered tab by its label, row 648): both editors name a webview's tab by its panel's title, also after `WebviewPanel.title` changes, and tell their tab listeners of the changed tab, so the recording's Application, which the reader retitles "codebook · Recorded application", has that label in front of its own group during a Repository Wiki recording visit and parked behind the Wiki after the article Return (C60 c60-vs-567 and c60-cu-567, 3-recording-open.json and 5-after-return.json); fails_when=the fake editor keeps the label the pane was created with, "codebook · Application", and reports no changed tab, so a test that reads tabs by label does not see the retitled pane; why_new=Cycle 0046 row 722; seam=articleRecordingLayoutHarness with a recording with recorded values, useHostAppName and addSeparateEditorPart for Cursor, the editor's onDidChangeTabs, openRepositoryEvidence with the recording, the return-wiki action and the groups' tab labels
  test(`in ${host}, the recording's Application pane retitled by the reader is labelled codebook · Recorded application in front of its group during a Wiki recording visit and parked after the article Return, as ${host} labelled it`, async () => {
    // Arrange: the learner's article in two stacked groups; in Cursor its chat part beside them.
    const harness = await articleRecordingLayoutHarness(true, true)
    if (host === 'Cursor') {
      harness.useHostAppName('Cursor')
      harness.addSeparateEditorPart()
    }
    const changedApplicationLabels: string[] = []
    const subscription = harness.editor.window.tabGroups.onDidChangeTabs(
      (event) => {
        for (const tab of event?.changed ?? [])
          if (Reflect.get(tab.input, 'viewType') === 'codebook.scopedBrowser')
            changedApplicationLabels.push(tab.label)
      },
    )
    /** Lists the labels of the Application's tabs in every group. */
    const applicationLabels = (): string[] =>
      harness.groups
        .flatMap((group) => group.tabs)
        .filter(
          (tab) =>
            Reflect.get(tab.input, 'viewType') === 'codebook.scopedBrowser',
        )
        .map((tab) => tab.label)
    try {
      // Act: View recording in the Wiki, then Return to Wiki.
      await harness.reader.openRepositoryEvidence(
        harness.binding,
        true,
        undefined,
        harness.origin,
      )
      await harness.controller.settle()
      const duringVisit = applicationLabels()
      await harness.reader.action('return-wiki', true)
      await harness.controller.settle()

      // Assert
      assert.deepEqual(
        {
          duringVisit,
          toldChanged: changedApplicationLabels.includes(
            'codebook · Recorded application',
          ),
          afterReturn: applicationLabels(),
        },
        {
          duringVisit: ['codebook · Recorded application'],
          toldChanged: true,
          afterReturn: ['codebook · Recorded application'],
        },
      )
    } finally {
      subscription.dispose()
      await harness.close()
    }
  })

// Value: protects=the learner's window when a Repository Wiki recording visit is refused by a real change of the learner's, made while its Application was being placed: the learner typed in the file that had the keyboard, so the visit's focus return refuses, and the Application pane and the group the visit created go again, leaving the learner's two groups at their columns; fails_when=the refusal of the preparation's focus return, which comes after the Application stands in its own group, leaves that pane alone in a new group at column 1 with the learner's groups shifted (C58 c58-vs-567: "Recorded playback unavailable. …" in a new group); why_new=Cycle 0046 row 659 (a failed visit leaves no Application group behind); seam=articleRecordingLayoutHarness, focusMutableDraft and its replaceContent, holdNextCommand on workbench.action.lockEditorGroup, openRepositoryEvidence with the recording, the playback state's refusal and the groups
test('a Repository Wiki recording visit refused because the learner typed in the focused file during its placement leaves no Application group behind', async () => {
  // Arrange: the learner's two groups are stacked and the learner's notes in the first group have the keyboard; the editor holds its answer to the new Application group's lock.
  const harness = await articleRecordingLayoutHarness()
  try {
    const notes = harness.focusMutableDraft('notes.ts', 1)
    const lock = harness.holdNextCommand('workbench.action.lockEditorGroup')

    // Act: the visit places its Application; while the lock waits, the learner types in the notes.
    const visit = harness.reader
      .openRepositoryEvidence(harness.binding, true, undefined, harness.origin)
      .then(
        () => 'opened',
        (error: unknown) => String(error),
      )
    await lock.started
    notes.replaceContent('The learner typed during the placement.\n')
    lock.release()
    await waitUntil(
      () => harness.controller.state().readiness === 'failed',
      'the refused recording load',
    )
    const refusal = harness.controller.state().reason
    const answer = await visit

    // Assert: the recording's load was refused for the learner's typing, and the window has the learner's two groups again with no Application pane.
    assert.deepEqual(
      {
        answer,
        refusal,
        applicationColumn: harness.panelColumn('codebook.scopedBrowser'),
        groupCount: harness.groups.length,
        notesColumn: harness.groups.find((group) =>
          group.tabs.includes(notes.tab),
        )?.viewColumn,
      },
      {
        answer:
          'Error: The observation is outside the verified recording range.',
        refusal:
          'Error: The previously focused document changed during presentation; its current reading position was preserved.',
        applicationColumn: undefined,
        groupCount: 2,
        notesColumn: 1,
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the answer a Repository Wiki recording visit gives when its Application preparation is refused inside the layout queue after it created the pane: the recording's load is refused with the preparation's own reason, and the window keeps no Application pane or group; fails_when=the failed preparation disposes the pane while it is still the reader's Application, so the pane's close handler takes the disposal for the learner's close, cancels the load and hides the playback, and the load ends cleared with no reason at all (Cycle 0046 OCR1-6); why_new=Cycle 0046 OCR1-6; seam=articleRecordingLayoutHarness, focusMutableDraft, holdNextCommand on workbench.action.lockEditorGroup and on vscode.getEditorLayout (the layout read after the pane was created), failNextCommand('vscode.getEditorLayout'), openRepositoryEvidence with the recording, the playback state and the groups
test('a Repository Wiki recording visit whose Application preparation fails after it created the pane refuses the recording with the preparation’s reason and leaves no Application group behind', async () => {
  // Arrange: the learner's two groups are stacked with the notes in the first; the editor holds the new Application group's lock, and then the layout read that follows the pane's creation.
  const harness = await articleRecordingLayoutHarness()
  try {
    const notes = harness.focusMutableDraft('notes.ts', 1)
    const lock = harness.holdNextCommand('workbench.action.lockEditorGroup')

    // Act: the visit places its Application; the layout read after the pane exists fails.
    const visit = harness.reader
      .openRepositoryEvidence(harness.binding, true, undefined, harness.origin)
      .then(
        () => 'opened',
        (error: unknown) => String(error),
      )
    await lock.started
    const layoutRead = harness.holdNextCommand('vscode.getEditorLayout')
    lock.release()
    await layoutRead.started
    const paneExistedAtTheRead = harness.counts().panels > 0
    harness.failNextCommand('vscode.getEditorLayout')
    layoutRead.release()
    const answer = await visit
    const playback = harness.controller.state()

    // Assert: the load was refused with the preparation's reason, not cleared as by a closed pane; the learner's two groups stand with no Application pane.
    assert.deepEqual(
      {
        paneExistedAtTheRead,
        answer,
        readiness: playback.readiness,
        refusal: playback.reason,
        applicationColumn: harness.panelColumn('codebook.scopedBrowser'),
        groupCount: harness.groups.length,
        notesColumn: harness.groups.find((group) =>
          group.tabs.includes(notes.tab),
        )?.viewColumn,
      },
      {
        paneExistedAtTheRead: true,
        answer:
          'Error: The observation is outside the verified recording range.',
        readiness: 'failed',
        refusal: 'Error: Native layout command failed',
        applicationColumn: undefined,
        groupCount: 2,
        notesColumn: 1,
      },
    )
  } finally {
    await harness.close()
  }
})

test('native minimum-width expansion keeps Wiki Return successful and the next observation in three visible panes', async () => {
  // Arrange
  const harness = await articleRecordingLayoutHarness()
  let releaseLayout = (): void => {},
    releaseReceipt = (): void => {}
  try {
    harness.useNativeLayout({
      orientation: 0,
      groups: [{ size: 326 }, { size: 326 }],
    })
    const draft = harness.addForeignDraft(),
      decisions = (await harness.library.readProgress()).decisions
    await harness.reader.openRepositoryEvidence(
      harness.binding,
      false,
      undefined,
      harness.origin,
    )
    const layout = harness.holdNextCommand('vscode.setEditorLayout')
    releaseLayout = layout.release
    // Act
    const returning = harness.reader.action('return-wiki')
    await layout.started
    const receipt = harness.holdNextCommand('vscode.getEditorLayout')
    releaseReceipt = receipt.release
    layout.release()
    await receipt.started
    harness.changeEditorLayout({
      orientation: 0,
      groups: [{ size: 330 }, { size: 330 }],
    })
    receipt.release()
    await returning
    // Assert
    assert.equal(harness.reader.inspect().view!.errors.length, 0)
    assert.deepEqual(harness.editorLayout(), {
      orientation: 0,
      groups: [{ size: 330 }, { size: 330 }],
    })
    await harness.reader.openRepositoryEvidence(
      harness.binding,
      false,
      undefined,
      harness.origin,
    )
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
    assert.equal(harness.sourceColumn(), 2)
    assert.equal(harness.panelColumn('codebook.studyContext'), 3)
    const source = harness.groups.find((group) => group.viewColumn === 2)
      ?.activeTab?.input
    assert.ok(source && 'uri' in source)
    assert.equal(source.uri.toString(), harness.reader.inspect().sourceUri)
    assert.equal(harness.groups[0]!.tabs.includes(draft), true)
    assert.equal(draft.isDirty, true)
    assert.deepEqual(
      (await harness.library.readProgress()).decisions,
      decisions,
    )
  } finally {
    releaseLayout()
    releaseReceipt()
    await harness.close()
  }
})

test('a proportional learner resize after Wiki Return remains authoritative on the next observation', async () => {
  // Arrange
  const harness = await articleRecordingLayoutHarness()
  try {
    await harness.reader.openRepositoryEvidence(
      harness.binding,
      false,
      undefined,
      harness.origin,
    )
    await harness.reader.action('return-wiki')
    harness.changeEditorLayout({
      orientation: 1,
      groups: [{ size: 322 }, { size: 324 }],
    })
    const mutations = harness.commands.filter(
      (command) => command === 'vscode.setEditorLayout',
    ).length
    // Act
    await harness.reader.openRepositoryEvidence(
      harness.binding,
      false,
      undefined,
      harness.origin,
    )
    // Assert
    assert.deepEqual(harness.editorLayout(), {
      orientation: 1,
      groups: [{ size: 322 }, { size: 324 }],
    })
    assert.equal(
      harness.commands.filter((command) => command === 'vscode.setEditorLayout')
        .length,
      mutations,
    )
    assert.equal(harness.panelColumn('codebook.studyContext'), 2)
  } finally {
    await harness.close()
  }
})
