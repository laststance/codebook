import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  PRESENTATION_READY_TIMEOUT_MS,
  PRESENTATION_SETTLE_CEILING_MS,
} from '../constants'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import {
  workspaceHarness,
  openRetainedStudy,
  recordedReaderHarness,
  articleRecordingLayoutHarness,
  readerSeams,
} from './studyWorkspaceHarness'
import { createConfiguredStudy } from './utils/createConfiguredStudy'
import {
  advanceClock,
  advanceClockUntilSettled,
  enableFakeClock,
  resetFakeClock,
} from './utils/fakeClock'
for (const recording of [false, true])
  test(`Wiki ${recording ? 'recording' : 'observation'} reentry restores Study after an empty chat wrapper refresh following actual Return`, async () => {
    // Arrange
    const harness = await articleRecordingLayoutHarness()
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
          ? { orientation: 0, groups: [{ size: 1 }, { size: 1 }, { size: 1 }] }
          : {
              orientation: 0,
              groups: [
                { size: 0.55, groups: [{ size: 0.5 }, { size: 0.5 }] },
                { size: 0.45 },
              ],
            },
      )
      // The existing third main group belongs to the learner; the sidebar does not authorize removing it.
      assert.equal(
        harness.reader.presentationState().layoutConfirmed,
        !recording,
      )
      if (recording) {
        assert.equal(harness.controller.state().readiness, 'ready')
        assert.equal(harness.controller.state().mode, 'paused')
      }
      assert.deepEqual(harness.groups.at(-1)!.tabs, [])
      assert.deepEqual(chat.layout(), {
        orientation: 1,
        groups: [{ size: 743 }],
      })
      assert.equal(draft.document.getText(), 'Original learner draft.\n')
      assert.equal(
        harness.groups[0]!.tabs.some(
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
    const harness = await articleRecordingLayoutHarness()
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
      assert.deepEqual(harness.editorLayout(), {
        orientation: 0,
        groups: [{ size: 1 }, { size: 1 }, { size: 1 }],
      })
      assert.equal(
        harness.commands.filter(
          (command) => command === 'vscode.setEditorLayout',
        ).length,
        mutations,
      )
      assert.equal(harness.reader.presentationState().layoutConfirmed, false)
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
      const harness = await articleRecordingLayoutHarness()
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
        // Assert
        assert.deepEqual(
          harness.editorLayout(),
          recording
            ? mainGroups === 2
              ? { orientation: 1, groups: [{ size: 0.5 }, { size: 0.5 }] }
              : { orientation: 0, groups: [{}, {}, {}] }
            : {
                orientation: 0,
                groups: [
                  { size: 0.55, groups: [{ size: 0.5 }, { size: 0.5 }] },
                  { size: 0.45 },
                ],
              },
        )
        assert.equal(
          harness.reader.presentationState().layoutConfirmed,
          !recording || mainGroups === 2,
        )
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
              (group) => group.viewColumn === (recording ? mainGroups + 1 : 4),
            )!
            .tabs.includes(chat.tab),
          true,
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
      const harness = await articleRecordingLayoutHarness(),
        chat = harness.addSeparateEditorPart()
      if (cursor) harness.useCursorGroupWrappers(true)
      const draft = harness.focusMutableDraft()
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
        await harness.reader.openRepositoryEvidence(
          harness.binding,
          true,
          undefined,
          harness.origin,
        )
        await harness.controller.settle()
        assert.equal(harness.controller.state().readiness, 'ready')
        assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
        assert.equal(harness.sourceColumn(), 2)
        assert.equal(harness.panelColumn('codebook.studyContext'), undefined)
        assert.equal(harness.summary.visible, true)
        assert.equal(harness.groups.length, 3)
        assert.equal(
          harness.groups
            .find((group) => group.viewColumn === 3)!
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

for (const next of ['Return', 'retry', 'Close'] as const)
  test(`${next} after interrupted main-part reservation preserves the original article, chat and draft`, async () => {
    // Arrange
    const harness = await articleRecordingLayoutHarness(),
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
        layout = harness.holdNextCommand('vscode.setEditorLayout')
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
      // Act: the main grid is accepted, but its restoration receipt is still pending.
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
      }
      assert.equal(harness.groups.at(-1)!.tabs.includes(chat.tab), true)
      assert.deepEqual(chat.layout(), {
        orientation: 1,
        groups: [{ size: 743 }],
      })
      assert.equal(harness.groups[0]!.tabs.includes(draft.tab), true)
      assert.equal(draft.document.getText(), 'Original learner draft.\n')
    } finally {
      releaseLayout()
      releaseReceipt()
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

for (const change of [
  'resize',
  'source move',
  'application move',
  'foreign tab',
  'foreign group',
  'replaced group',
])
  test(`actual article Return preserves a learner's ${change} after opening recording evidence`, async () => {
    // Arrange
    const harness = await articleRecordingLayoutHarness()
    try {
      await harness.reader.openRepositoryEvidence(
        harness.binding,
        true,
        undefined,
        harness.origin,
      )
      await harness.controller.settle()
      if (change === 'resize')
        harness.changeEditorLayout({
          orientation: 1,
          groups: [{ size: 0.7 }, { size: 0.3 }],
        })
      if (change === 'source move') harness.moveSource(1)
      if (change === 'application move')
        harness.movePanel('codebook.scopedBrowser', 2)
      // A new learner group is never a Codebook-owned destination.
      if (change === 'foreign tab') {
        harness.groups.push({ viewColumn: 3, tabs: [] })
        harness.changeEditorLayout({
          orientation: 1,
          groups: [{ size: 0.4 }, { size: 0.4 }, { size: 0.2 }],
        })
      }
      const draft = harness.addForeignDraft(change === 'foreign tab' ? 3 : 1)
      if (change === 'foreign group')
        harness.groups.push({ viewColumn: 3, tabs: [] })
      if (change === 'replaced group')
        harness.groups[0] = { ...harness.groups[0]! }
      const layout = harness.editorLayout(),
        groups = [...harness.groups],
        mutations = harness.commands.filter(
          (command) => command === 'vscode.setEditorLayout',
        ).length
      // Act
      await harness.reader.action('return-wiki')
      // Assert
      assert.deepEqual(harness.editorLayout(), layout)
      assert.deepEqual(harness.groups, groups)
      assert.equal(
        harness.commands.filter(
          (command) => command === 'vscode.setEditorLayout',
        ).length,
        mutations,
      )
      assert.equal(
        harness.groups.some((group) => group.tabs.includes(draft)),
        true,
      )
      assert.equal(draft.isDirty, true)
    } finally {
      await harness.close()
    }
  })

for (const move of ['source', 'application'])
  test(`the next evidence visit preserves a manual ${move} move made after actual article Return`, async () => {
    // Arrange
    const harness = await articleRecordingLayoutHarness()
    try {
      await harness.reader.openRepositoryEvidence(
        harness.binding,
        true,
        undefined,
        harness.origin,
      )
      await harness.controller.settle()
      await harness.reader.action('return-wiki')
      if (move === 'source') harness.moveSource(1)
      else harness.movePanel('codebook.scopedBrowser', 2)
      const mutations = harness.commands.filter(
        (command) => command === 'vscode.setEditorLayout',
      ).length
      // Act
      await harness.reader.openRepositoryEvidence(
        harness.binding,
        true,
        undefined,
        harness.origin,
      )
      await harness.controller.settle()
      // Assert
      assert.equal(harness.controller.state().readiness, 'ready')
      assert.deepEqual(harness.editorLayout(), {
        orientation: 1,
        groups: [{ size: 161 }, { size: 162 }],
      })
      assert.equal(
        move === 'source'
          ? harness.sourceColumn()
          : harness.panelColumn('codebook.scopedBrowser'),
        move === 'source' ? 1 : 2,
      )
      assert.equal(
        harness.commands.filter(
          (command) => command === 'vscode.setEditorLayout',
        ).length,
        mutations,
      )
    } finally {
      await harness.close()
    }
  })

test('actual Return cannot consume another article origin when its native layout is still owned', async () => {
  // Arrange
  const harness = await articleRecordingLayoutHarness()
  try {
    await harness.reader.openRepositoryEvidence(
      harness.binding,
      true,
      undefined,
      harness.origin,
    )
    await harness.controller.settle()
    // Act
    await harness.reader.arrangeRepository(new AbortController().signal, {
      ...harness.origin,
      nodeId: 'another-article',
    })
    // Assert
    assert.deepEqual(harness.editorLayout(), {
      orientation: 1,
      groups: [{ size: 0.5 }, { size: 0.5 }],
    })
    await harness.reader.action('return-wiki')
    assert.deepEqual(harness.editorLayout(), {
      orientation: 1,
      groups: [{ size: 161 }, { size: 162 }],
    })
  } finally {
    await harness.close()
  }
})

test('a queued actual article Return preserves a later learner draft focus without changing the Study layout', async () => {
  // Arrange
  const harness = await articleRecordingLayoutHarness(),
    cancellation = new AbortController()
  let release = (): void => {}
  try {
    await harness.reader.openRepositoryEvidence(
      harness.binding,
      false,
      undefined,
      harness.origin,
    )
    const original = harness.editorLayout(),
      mutations = harness.commands.filter(
        (command) => command === 'vscode.setEditorLayout',
      ).length
    const held = harness.holdNextCommand('vscode.getEditorLayout')
    release = held.release
    const earlier = harness.reader.arrangeRepository(
        cancellation.signal,
        harness.origin,
      ),
      earlierRejected = assert.rejects(earlier, /abort/i)
    await held.started
    const originalFocus = harness.focusedPanel()
    const returning = harness.reader.arrangeRepository(
      new AbortController().signal,
      harness.origin,
      {
        begin() {
          if (harness.focusedPanel() !== originalFocus)
            throw new Error('Original learner focus changed.')
        },
      },
    )
    const rejected = assert.rejects(returning, /Original learner focus changed/)

    // Act
    const draft = harness.focusMutableDraft()
    cancellation.abort()
    held.release()
    await earlierRejected
    await rejected

    // Assert
    assert.deepEqual(harness.editorLayout(), original)
    assert.equal(
      harness.commands.filter((command) => command === 'vscode.setEditorLayout')
        .length,
      mutations,
    )
    assert.equal(harness.groups[0]!.activeTab, draft.tab)
    assert.equal(draft.document.getText(), 'Original learner draft.\n')
  } finally {
    release()
    await harness.close()
  }
})

test('cancelling actual Return during its ownership read preserves Study and permits a later explicit Return', async () => {
  // Arrange
  const harness = await articleRecordingLayoutHarness(),
    cancellation = new AbortController()
  let release = (): void => {}
  try {
    await harness.reader.openRepositoryEvidence(
      harness.binding,
      true,
      undefined,
      harness.origin,
    )
    await harness.controller.settle()
    const held = harness.holdNextCommand('vscode.getEditorLayout')
    release = held.release
    // Act
    const returning = harness.reader.arrangeRepository(
        cancellation.signal,
        harness.origin,
      ),
      rejected = assert.rejects(returning, /abort/i)
    await held.started
    cancellation.abort()
    held.release()
    await rejected
    // Assert
    assert.deepEqual(harness.editorLayout(), {
      orientation: 1,
      groups: [{ size: 0.5 }, { size: 0.5 }],
    })
    await harness.reader.action('return-wiki')
    assert.deepEqual(harness.editorLayout(), {
      orientation: 1,
      groups: [{ size: 161 }, { size: 162 }],
    })
  } finally {
    release()
    await harness.close()
  }
})

test('a new evidence visit drains a cancelled Return layout before restoring its two main replay panes', async () => {
  // Arrange
  const harness = await articleRecordingLayoutHarness(),
    cancellation = new AbortController()
  let release = (): void => {}
  try {
    await harness.reader.openRepositoryEvidence(
      harness.binding,
      true,
      undefined,
      harness.origin,
    )
    await harness.controller.settle()
    const held = harness.holdNextCommand('vscode.setEditorLayout')
    release = held.release
    // Act
    const returning = harness.reader.arrangeRepository(
        cancellation.signal,
        harness.origin,
      ),
      rejected = assert.rejects(returning, /abort/i)
    await held.started
    cancellation.abort()
    const opening = harness.reader.openRepositoryEvidence(
      harness.binding,
      true,
      undefined,
      harness.origin,
    )
    held.release()
    await rejected
    await opening
    await harness.controller.settle()
    // Assert
    assert.equal(harness.controller.state().readiness, 'ready')
    assert.deepEqual(harness.editorLayout(), {
      orientation: 1,
      groups: [{ size: 0.5 }, { size: 0.5 }],
    })
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
    assert.equal(harness.sourceColumn(), 2)
    assert.equal(harness.panelColumn('codebook.studyContext'), undefined)
    assert.equal(harness.summary.visible, true)
  } finally {
    release()
    await harness.close()
  }
})

test('Close drains an accepted article Return without retaining a layout origin or reopening owned panes', async () => {
  // Arrange
  const harness = await articleRecordingLayoutHarness()
  let release = (): void => {}
  try {
    await harness.reader.openRepositoryEvidence(
      harness.binding,
      true,
      undefined,
      harness.origin,
    )
    await harness.controller.settle()
    const draft = harness.addForeignDraft(),
      held = harness.holdNextCommand('vscode.setEditorLayout')
    release = held.release
    // Act
    const returning = harness.reader.action('return-wiki'),
      rejected = assert.rejects(returning, /closed/)
    await held.started
    const closing = harness.reader.close()
    held.release()
    await rejected
    await closing
    // Assert
    assert.equal(harness.reader.inspect().opened, false)
    assert.equal(harness.counts().panels, 0)
    assert.equal(harness.reader['repositoryLayoutOrigin'], undefined)
    assert.equal(harness.reader['repositoryLayoutRestored'], undefined)
    assert.equal(
      harness.groups.some((group) => group.tabs.includes(draft)),
      true,
    )
    assert.equal(draft.isDirty, true)
  } finally {
    release()
    await harness.close()
  }
})

test('a manual application move during the restored-layout receipt remains authoritative on the next evidence visit', async () => {
  // Arrange
  const harness = await articleRecordingLayoutHarness()
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
    const layout = harness.holdNextCommand('vscode.setEditorLayout')
    releaseLayout = layout.release
    // Act
    const returning = harness.reader.action('return-wiki')
    await layout.started
    const receipt = harness.holdNextCommand('vscode.getEditorLayout')
    releaseReceipt = receipt.release
    layout.release()
    await receipt.started
    harness.movePanel('codebook.scopedBrowser', 2)
    receipt.release()
    await returning
    await harness.reader.openRepositoryEvidence(
      harness.binding,
      true,
      undefined,
      harness.origin,
    )
    await harness.controller.settle()
    // Assert
    assert.equal(harness.controller.state().readiness, 'ready')
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 2)
    assert.deepEqual(harness.editorLayout(), {
      orientation: 1,
      groups: [{ size: 161 }, { size: 162 }],
    })
  } finally {
    releaseLayout()
    releaseReceipt()
    await harness.close()
  }
})

test('cancelling a later article evidence visit keeps the previous actual Return layout and reading origin', async () => {
  // Arrange
  const harness = await articleRecordingLayoutHarness(),
    cancellation = new AbortController()
  let release = (): void => {}
  try {
    await harness.reader.openRepositoryEvidence(
      harness.binding,
      true,
      undefined,
      harness.origin,
    )
    await harness.controller.settle()
    const source = harness.holdNextSource()
    release = source.release
    // Act
    const opening = harness.reader.openRepositoryEvidence(
        harness.binding,
        true,
        cancellation.signal,
        { ...harness.origin, nodeId: 'later-article' },
      ),
      rejected = assert.rejects(opening, /abort/i)
    await source.started
    cancellation.abort()
    source.release()
    await rejected
    await harness.controller.settle()
    await harness.reader.action('return-wiki')
    // Assert
    assert.deepEqual(harness.editorLayout(), {
      orientation: 1,
      groups: [{ size: 161 }, { size: 162 }],
    })
    assert.deepEqual(
      (await harness.library.readProgress()).repositoryReturn?.selection,
      {
        bookId: 'architecture',
        revision: 1,
        nodeId: 'module',
        anchorIndex: 0,
        location: {
          sectionIndex: 1,
          fraction: 0.65,
          focusId: 'evidence-0-recording',
        },
      },
    )
  } finally {
    release()
    await harness.close()
  }
})

test('a manual resize while the next evidence source loads is preserved after actual article Return', async () => {
  // Arrange
  const harness = await articleRecordingLayoutHarness(),
    manual = { orientation: 1, groups: [{ size: 1 }, { size: 3 }, { size: 1 }] }
  let release = (): void => {}
  try {
    await harness.reader.openRepositoryEvidence(
      harness.binding,
      true,
      undefined,
      harness.origin,
    )
    await harness.controller.settle()
    await harness.reader.action('return-wiki')
    const source = harness.holdNextSource()
    release = source.release
    // Act
    const opening = harness.reader.openRepositoryEvidence(
      harness.binding,
      true,
      undefined,
      harness.origin,
    )
    await source.started
    harness.changeEditorLayout(manual)
    source.release()
    await opening
    await harness.controller.settle()
    // Assert
    assert.equal(harness.controller.state().readiness, 'ready')
    assert.deepEqual(harness.editorLayout(), {
      orientation: 1,
      groups: [{ size: 1 }, { size: 3 }, { size: 1 }],
    })
  } finally {
    release()
    await harness.close()
  }
})

for (const region of ['application', 'context', 'source'])
  test(`a manual ${region} move while a returning article observation loads preserves the learner layout`, async () => {
    // Arrange
    const harness = await articleRecordingLayoutHarness()
    let release = (): void => {}
    try {
      await harness.reader.openRepositoryEvidence(
        harness.binding,
        true,
        undefined,
        harness.origin,
      )
      await harness.controller.settle()
      await harness.reader.action('return-wiki')
      const source = harness.holdNextSource()
      release = source.release
      // Act
      const opening = harness.reader.openRepositoryEvidence(
        harness.binding,
        false,
        undefined,
        harness.origin,
      )
      await source.started
      if (region === 'source') harness.moveSource(1)
      else
        harness.movePanel(
          region === 'application'
            ? 'codebook.scopedBrowser'
            : 'codebook.studyContext',
          region === 'application' ? 2 : 1,
        )
      const layout = harness.editorLayout(),
        mutations = harness.commands.filter(
          (command) => command === 'vscode.setEditorLayout',
        ).length
      source.release()
      await opening
      // Assert
      assert.equal(
        region === 'source'
          ? harness.sourceColumn()
          : harness.panelColumn(
              region === 'application'
                ? 'codebook.scopedBrowser'
                : 'codebook.studyContext',
            ),
        region === 'application' ? 2 : 1,
      )
      assert.equal(
        harness.reader.inspect().view?.model.observation?.id,
        harness.binding.observationId,
      )
      assert.deepEqual(harness.editorLayout(), layout)
      assert.equal(
        harness.commands.filter(
          (command) => command === 'vscode.setEditorLayout',
        ).length,
        mutations,
      )
    } finally {
      release()
      await harness.close()
    }
  })

test('cancelling observation reentry after actual Return preserves the original article layout for another Return', async () => {
  // Arrange
  const harness = await articleRecordingLayoutHarness(),
    cancellation = new AbortController()
  let release = (): void => {}
  try {
    await harness.reader.openRepositoryEvidence(
      harness.binding,
      true,
      undefined,
      harness.origin,
    )
    await harness.controller.settle()
    await harness.reader.action('return-wiki')
    const source = harness.holdNextSource()
    release = source.release
    // Act
    const opening = harness.reader.openRepositoryEvidence(
        harness.binding,
        false,
        cancellation.signal,
        harness.origin,
      ),
      rejected = assert.rejects(opening, /abort/i)
    await source.started
    assert.equal(harness.panelColumn('codebook.studyContext'), 3)
    cancellation.abort()
    source.release()
    await rejected
    await harness.reader.action('return-wiki')
    // Assert
    assert.deepEqual(harness.editorLayout(), {
      orientation: 1,
      groups: [{ size: 161 }, { size: 162 }],
    })
    assert.equal(harness.groups.length, 2)
    assert.equal(harness.panelColumn('codebook.studyContext'), 2)
    assert.deepEqual(
      (await harness.library.readProgress()).repositoryReturn?.selection,
      harness.origin,
    )
  } finally {
    release()
    await harness.close()
  }
})

test('retrying a cancelled observation reentry retains the article layout from before Codebook expanded its groups', async () => {
  // Arrange
  const harness = await articleRecordingLayoutHarness(),
    cancellation = new AbortController()
  let release = (): void => {}
  try {
    await harness.reader.openRepositoryEvidence(
      harness.binding,
      true,
      undefined,
      harness.origin,
    )
    await harness.controller.settle()
    await harness.reader.action('return-wiki')
    const source = harness.holdNextSource()
    release = source.release
    const opening = harness.reader.openRepositoryEvidence(
        harness.binding,
        false,
        cancellation.signal,
        harness.origin,
      ),
      rejected = assert.rejects(opening, /abort/i)
    await source.started
    cancellation.abort()
    source.release()
    await rejected
    // Act
    await harness.reader.openRepositoryEvidence(
      harness.binding,
      false,
      undefined,
      harness.origin,
    )
    await harness.reader.action('return-wiki')
    // Assert
    assert.deepEqual(harness.editorLayout(), {
      orientation: 1,
      groups: [{ size: 161 }, { size: 162 }],
    })
    assert.equal(harness.groups.length, 2)
    assert.equal(harness.panelColumn('codebook.studyContext'), 2)
  } finally {
    release()
    await harness.close()
  }
})

for (const cursor of [false, true])
  test(`${cursor ? 'Cursor: ' : ''}observation reentry can restore the source column accepted by Study before the article Return contracted its group`, async () => {
    // Arrange
    const harness = await articleRecordingLayoutHarness()
    if (cursor) harness.useCursorGroupWrappers()
    let release = (): void => {}
    try {
      const layout = harness.holdNextCommand('runCommands')
      release = layout.release
      const opening = harness.reader.openRepositoryEvidence(
        harness.binding,
        false,
        undefined,
        harness.origin,
      )
      await layout.started
      harness.moveSource(3)
      layout.release()
      await opening
      await harness.controller.settle()
      assert.equal(harness.sourceColumn(), 3)
      await harness.reader.action('return-wiki')
      assert.equal(harness.groups.length, 2)
      // Act
      await harness.reader.openRepositoryEvidence(
        harness.binding,
        false,
        undefined,
        harness.origin,
      )
      // Assert
      assert.equal(harness.sourceColumn(), 3)
      assert.equal(harness.groups.length, 3)
      assert.deepEqual(harness.editorLayout(), {
        orientation: 0,
        groups: [
          { size: 0.55, groups: [{ size: 0.5 }, { size: 0.5 }] },
          { size: 0.45 },
        ],
      })
    } finally {
      release()
      await harness.close()
    }
  })

test('a normal Wiki open after cancelled reentry does not consume the previous article Return layout', async () => {
  // Arrange
  const harness = await articleRecordingLayoutHarness(),
    cancellation = new AbortController()
  let release = (): void => {}
  try {
    await harness.reader.openRepositoryEvidence(
      harness.binding,
      true,
      undefined,
      harness.origin,
    )
    await harness.controller.settle()
    await harness.reader.action('return-wiki')
    const source = harness.holdNextSource()
    release = source.release
    const opening = harness.reader.openRepositoryEvidence(
        harness.binding,
        false,
        cancellation.signal,
        harness.origin,
      ),
      rejected = assert.rejects(opening, /abort/i)
    await source.started
    cancellation.abort()
    source.release()
    await rejected
    // Act
    await harness.reader.arrangeRepository(new AbortController().signal)
    await harness.reader.action('return-wiki')
    // Assert
    assert.deepEqual(harness.editorLayout(), {
      orientation: 0,
      groups: [{}, {}, {}],
    })
    assert.equal(harness.groups.length, 3)
    assert.equal(harness.panelColumn('codebook.studyContext'), 3)
  } finally {
    release()
    await harness.close()
  }
})

test('actual Return after cancelled reentry preserves a foreign draft added to the expanded group', async () => {
  // Arrange
  const harness = await articleRecordingLayoutHarness(),
    cancellation = new AbortController()
  let release = (): void => {}
  try {
    await harness.reader.openRepositoryEvidence(
      harness.binding,
      true,
      undefined,
      harness.origin,
    )
    await harness.controller.settle()
    await harness.reader.action('return-wiki')
    const source = harness.holdNextSource()
    release = source.release
    const opening = harness.reader.openRepositoryEvidence(
        harness.binding,
        false,
        cancellation.signal,
        harness.origin,
      ),
      rejected = assert.rejects(opening, /abort/i)
    await source.started
    cancellation.abort()
    source.release()
    await rejected
    const draft = harness.addForeignDraft(3),
      mutations = harness.commands.filter(
        (command) => command === 'vscode.setEditorLayout',
      ).length
    // Act
    await harness.reader.action('return-wiki')
    // Assert
    assert.equal(harness.groups.length, 3)
    assert.equal(
      harness.groups
        .find((group) => group.viewColumn === 3)
        ?.tabs.includes(draft),
      true,
    )
    assert.equal(draft.isDirty, true)
    assert.equal(
      harness.commands.filter((command) => command === 'vscode.setEditorLayout')
        .length,
      mutations,
    )
  } finally {
    release()
    await harness.close()
  }
})

test('cancelling during the accepted reentry layout read still lets actual Return restore the article groups', async () => {
  // Arrange
  const harness = await articleRecordingLayoutHarness(),
    cancellation = new AbortController()
  let releaseBefore = (): void => {},
    releasePrepared = (): void => {}
  try {
    await harness.reader.openRepositoryEvidence(
      harness.binding,
      true,
      undefined,
      harness.origin,
    )
    await harness.controller.settle()
    await harness.reader.action('return-wiki')
    const before = harness.holdNextCommand('vscode.getEditorLayout')
    releaseBefore = before.release
    // Act
    const opening = harness.reader.openRepositoryEvidence(
        harness.binding,
        false,
        cancellation.signal,
        harness.origin,
      ),
      rejected = assert.rejects(opening, /abort/i)
    await before.started
    const prepared = harness.holdNextCommand('vscode.getEditorLayout')
    releasePrepared = prepared.release
    before.release()
    await prepared.started
    assert.equal(harness.panelColumn('codebook.studyContext'), undefined)
    cancellation.abort()
    prepared.release()
    await rejected
    await harness.reader.action('return-wiki')
    // Assert
    assert.deepEqual(harness.editorLayout(), {
      orientation: 1,
      groups: [{ size: 161 }, { size: 162 }],
    })
    assert.equal(harness.groups.length, 2)
    assert.equal(harness.panelColumn('codebook.studyContext'), undefined)
  } finally {
    releaseBefore()
    releasePrepared()
    await harness.close()
  }
})

test('observation a source move during reentry loading overrides the previously planned source restoration', async () => {
  // Arrange
  const harness = await articleRecordingLayoutHarness()
  let releaseLayout = (): void => {},
    releaseSource = (): void => {}
  try {
    const layout = harness.holdNextCommand('runCommands')
    releaseLayout = layout.release
    const initial = harness.reader.openRepositoryEvidence(
      harness.binding,
      false,
      undefined,
      harness.origin,
    )
    await layout.started
    harness.moveSource(3)
    layout.release()
    await initial
    await harness.controller.settle()
    await harness.reader.action('return-wiki')
    assert.equal(harness.sourceColumn(), 2)
    const source = harness.holdNextSource()
    releaseSource = source.release
    // Act
    const opening = harness.reader.openRepositoryEvidence(
      harness.binding,
      false,
      undefined,
      harness.origin,
    )
    await source.started
    harness.moveSource(1)
    const mutations = harness.commands.filter(
      (command) => command === 'vscode.setEditorLayout',
    ).length
    source.release()
    await opening
    // Assert
    assert.equal(harness.sourceColumn(), 1)
    assert.equal(
      harness.reader.inspect().view?.model.observation?.id,
      harness.binding.observationId,
    )
    assert.equal(
      harness.commands.filter((command) => command === 'vscode.setEditorLayout')
        .length,
      mutations,
    )
  } finally {
    releaseLayout()
    releaseSource()
    await harness.close()
  }
})

for (const cursor of [false, true])
  test(`${cursor ? 'Cursor: ' : ''}Close during the accepted reentry layout read cannot acquire a new receipt or reopen owned panes`, async () => {
    // Arrange
    const harness = await articleRecordingLayoutHarness()
    if (cursor) harness.useCursorGroupWrappers()
    let releaseBefore = (): void => {},
      releasePrepared = (): void => {}
    try {
      await harness.reader.openRepositoryEvidence(
        harness.binding,
        true,
        undefined,
        harness.origin,
      )
      await harness.controller.settle()
      await harness.reader.action('return-wiki')
      const draft = harness.addForeignDraft()
      const before = harness.holdNextCommand('vscode.getEditorLayout')
      releaseBefore = before.release
      // Act
      const opening = harness.reader.openRepositoryEvidence(
          harness.binding,
          false,
          undefined,
          harness.origin,
        ),
        rejected = assert.rejects(opening, /closed/)
      await before.started
      const prepared = harness.holdNextCommand('vscode.getEditorLayout')
      releasePrepared = prepared.release
      before.release()
      await prepared.started
      const closing = harness.reader.close()
      prepared.release()
      await rejected
      await closing
      // Assert
      assert.equal(harness.reader.inspect().opened, false)
      assert.equal(harness.counts().panels, 0)
      assert.equal(harness.reader['layoutReceipt'], undefined)
      assert.equal(harness.reader['repositoryLayoutOrigin'], undefined)
      assert.equal(
        harness.groups.some((group) => group.tabs.includes(draft)),
        true,
      )
      assert.equal(draft.isDirty, true)
    } finally {
      releaseBefore()
      releasePrepared()
      await harness.close()
    }
  })

test('a manual pane move during a cancelled reentry layout read never becomes a Codebook-owned effect', async () => {
  // Arrange
  const harness = await articleRecordingLayoutHarness(),
    cancellation = new AbortController()
  let releaseBefore = (): void => {},
    releasePrepared = (): void => {}
  try {
    await harness.reader.openRepositoryEvidence(
      harness.binding,
      true,
      undefined,
      harness.origin,
    )
    await harness.controller.settle()
    await harness.reader.action('return-wiki')
    const before = harness.holdNextCommand('vscode.getEditorLayout')
    releaseBefore = before.release
    // Act
    const opening = harness.reader.openRepositoryEvidence(
        harness.binding,
        false,
        cancellation.signal,
        harness.origin,
      ),
      rejected = assert.rejects(opening, /abort/i)
    await before.started
    const prepared = harness.holdNextCommand('vscode.getEditorLayout')
    releasePrepared = prepared.release
    before.release()
    await prepared.started
    harness.movePanel('codebook.scopedBrowser', 2)
    cancellation.abort()
    prepared.release()
    await rejected
    const mutations = harness.commands.filter(
      (command) => command === 'vscode.setEditorLayout',
    ).length
    await harness.reader.action('return-wiki')
    // Assert
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 2)
    assert.equal(harness.groups.length, 2)
    assert.equal(
      harness.commands.filter((command) => command === 'vscode.setEditorLayout')
        .length,
      mutations,
    )
  } finally {
    releaseBefore()
    releasePrepared()
    await harness.close()
  }
})

for (const cursor of [false, true])
  test(`${cursor ? 'Cursor: ' : ''}a newer article visit drains accepted reentry effects without adopting the temporary grid as its return origin`, async () => {
    // Arrange
    const harness = await articleRecordingLayoutHarness(),
      latestOrigin = {
        bookId: 'architecture',
        revision: 1,
        nodeId: 'latest-article',
        anchorIndex: 0,
      }
    if (cursor) harness.useCursorGroupWrappers()
    let releaseBefore = (): void => {},
      releasePrepared = (): void => {}
    try {
      await harness.reader.openRepositoryEvidence(
        harness.binding,
        true,
        undefined,
        harness.origin,
      )
      await harness.controller.settle()
      await harness.reader.action('return-wiki')
      const before = harness.holdNextCommand('vscode.getEditorLayout')
      releaseBefore = before.release
      const opening = harness.reader.openRepositoryEvidence(
          harness.binding,
          false,
          undefined,
          harness.origin,
        ),
        rejected = assert.rejects(opening, /superseded/)
      await before.started
      const prepared = harness.holdNextCommand('vscode.getEditorLayout')
      releasePrepared = prepared.release
      before.release()
      // Act
      await prepared.started
      const latest = harness.reader.openRepositoryEvidence(
        harness.binding,
        false,
        undefined,
        latestOrigin,
      )
      await waitUntil(
        () =>
          harness.reader['repositoryOrigin']?.selection.nodeId ===
          'latest-article',
        'newer article intent',
        1_000,
      )
      prepared.release()
      await rejected
      await latest
      await harness.reader.action('return-wiki')
      // Assert
      assert.deepEqual(harness.editorLayout(), {
        orientation: 1,
        groups: [{ size: 161 }, { size: 162 }],
      })
      assert.equal(harness.groups.length, 2)
      assert.deepEqual(
        (await harness.library.readProgress()).repositoryReturn?.selection,
        latestOrigin,
      )
    } finally {
      releaseBefore()
      releasePrepared()
      await harness.close()
    }
  })

test('a manual grid change during reentry certification is never adopted as a Codebook arrangement', async () => {
  // Arrange
  const harness = await articleRecordingLayoutHarness()
  let releaseBefore = (): void => {},
    releasePrepared = (): void => {}
  try {
    await harness.reader.openRepositoryEvidence(
      harness.binding,
      true,
      undefined,
      harness.origin,
    )
    await harness.controller.settle()
    await harness.reader.action('return-wiki')
    const before = harness.holdNextCommand('vscode.getEditorLayout')
    releaseBefore = before.release
    // Act
    const opening = harness.reader.openRepositoryEvidence(
      harness.binding,
      false,
      undefined,
      harness.origin,
    )
    const rejected = assert.rejects(opening, /learner layout changed/)
    await before.started
    const prepared = harness.holdNextCommand('vscode.getEditorLayout')
    releasePrepared = prepared.release
    before.release()
    await prepared.started
    harness.changeEditorLayout({
      orientation: 1,
      groups: [{ size: 111 }, { size: 222 }],
    })
    const mutations = harness.commands.filter(
      (command) => command === 'vscode.setEditorLayout',
    ).length
    prepared.release()
    await rejected
    // Assert
    assert.deepEqual(harness.editorLayout(), {
      orientation: 1,
      groups: [{ size: 111 }, { size: 222 }],
    })
    assert.equal(
      harness.commands.filter((command) => command === 'vscode.setEditorLayout')
        .length,
      mutations,
    )
  } finally {
    releaseBefore()
    releasePrepared()
    await harness.close()
  }
})

test('observation source placement accepted before cancellation survives Return and the next evidence visit', async () => {
  // Arrange
  const harness = await articleRecordingLayoutHarness(),
    cancellation = new AbortController()
  let release = (): void => {}
  try {
    const layout = harness.holdNextCommand('runCommands')
    release = layout.release
    const initial = harness.reader.openRepositoryEvidence(
      harness.binding,
      false,
      undefined,
      harness.origin,
    )
    await layout.started
    harness.moveSource(3)
    layout.release()
    await initial
    await harness.controller.settle()
    await harness.reader.action('return-wiki')
    assert.equal(harness.sourceColumn(), 2)
    harness.abortAfterNextSourceDisplay(cancellation)
    // Act
    await assert.rejects(
      harness.reader.openRepositoryEvidence(
        harness.binding,
        false,
        cancellation.signal,
        harness.origin,
      ),
      /abort/i,
    )
    assert.equal(harness.sourceColumn(), 3)
    await harness.reader.action('return-wiki')
    await harness.reader.openRepositoryEvidence(
      harness.binding,
      false,
      undefined,
      harness.origin,
    )
    // Assert
    assert.equal(harness.sourceColumn(), 3)
    assert.equal(harness.panelColumn('codebook.studyContext'), 3)
    assert.equal(
      harness.reader.inspect().view?.model.observation?.id,
      harness.binding.observationId,
    )
  } finally {
    release()
    await harness.close()
  }
})

for (const cursor of [false, true])
  test(`${cursor ? 'Cursor: ' : ''}cancelling an accepted known Study grid restoration retains the original pane locations for Return and retry`, async () => {
    // Arrange
    const harness = await articleRecordingLayoutHarness(),
      cancellation = new AbortController()
    if (cursor) harness.useCursorGroupWrappers()
    let release = (): void => {}
    try {
      await harness.reader.openRepositoryEvidence(
        harness.binding,
        true,
        undefined,
        harness.origin,
      )
      await harness.controller.settle()
      await harness.reader.action('return-wiki')
      const layout = harness.holdNextCommand('vscode.setEditorLayout')
      release = layout.release
      // Act
      const opening = harness.reader.openRepositoryEvidence(
          harness.binding,
          false,
          cancellation.signal,
          harness.origin,
        ),
        rejected = assert.rejects(opening, /abort/i)
      await layout.started
      assert.equal(harness.panelColumn('codebook.studyContext'), undefined)
      cancellation.abort()
      layout.release()
      await rejected
      await harness.reader.action('return-wiki')
      assert.equal(harness.groups.length, 2)
      await harness.reader.openRepositoryEvidence(
        harness.binding,
        false,
        undefined,
        harness.origin,
      )
      // Assert
      assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
      assert.equal(harness.sourceColumn(), 2)
      assert.equal(harness.panelColumn('codebook.studyContext'), 3)
      assert.equal(
        harness.reader.inspect().view?.model.observation?.id,
        harness.binding.observationId,
      )
    } finally {
      release()
      await harness.close()
    }
  })

test('reentry restores the verified Study grid once without evening its saved split sizes', async () => {
  // Arrange
  const harness = await articleRecordingLayoutHarness()
  try {
    await harness.reader.openRepositoryEvidence(
      harness.binding,
      true,
      undefined,
      harness.origin,
    )
    await harness.controller.settle()
    await harness.reader.action('return-wiki')
    const mutations = harness.commands.filter(
        (command) => command === 'vscode.setEditorLayout',
      ).length,
      equalizations = harness.commands.filter(
        (command) => command === 'workbench.action.evenEditorWidths',
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
      orientation: 0,
      groups: [
        { size: 0.55, groups: [{ size: 0.5 }, { size: 0.5 }] },
        { size: 0.45 },
      ],
    })
    assert.equal(
      harness.commands.filter((command) => command === 'vscode.setEditorLayout')
        .length - mutations,
      1,
    )
    assert.equal(
      harness.commands.filter(
        (command) => command === 'workbench.action.evenEditorWidths',
      ).length,
      equalizations,
    )
  } finally {
    await harness.close()
  }
})

test('Cursor group creation preserves the article origin so actual Return restores its two stacked rows', async () => {
  // Arrange
  const harness = await articleRecordingLayoutHarness()
  harness.useCursorGroupWrappers()
  try {
    const originalGroups = [...harness.groups]
    // Observation entry creates the third main pane whose contraction this test exercises.
    await harness.reader.openRepositoryEvidence(
      harness.binding,
      false,
      undefined,
      harness.origin,
    )
    assert.equal(harness.groups.length, 3)
    assert.equal(harness.groups[0] === originalGroups[0], false)
    // Act
    await harness.reader.action('return-wiki')
    // Assert
    assert.deepEqual(harness.editorLayout(), {
      orientation: 1,
      groups: [{ size: 161 }, { size: 162 }],
    })
    assert.equal(harness.groups.length, 2)
    assert.equal(harness.panelColumn('codebook.studyContext'), 2)
    assert.deepEqual(
      (await harness.library.readProgress()).repositoryReturn?.selection,
      harness.origin,
    )
  } finally {
    await harness.close()
  }
})

test('Cursor group contraction preserves pre-merge identities so the next evidence visit restores all three pane columns', async () => {
  // Arrange
  const harness = await articleRecordingLayoutHarness()
  try {
    // Observation entry creates the third main pane whose contraction this test exercises.
    await harness.reader.openRepositoryEvidence(
      harness.binding,
      false,
      undefined,
      harness.origin,
    )
    const previous = harness.groups[1]!,
      previousTabs = [...previous.tabs]
    harness.useCursorGroupWrappers()
    // Act
    await harness.reader.action('return-wiki')
    assert.deepEqual(previous.tabs, previousTabs)
    assert.equal(harness.groups[1] === previous, false)
    assert.equal(harness.groups[1]!.tabs.length, previousTabs.length + 1)
    await harness.reader.openRepositoryEvidence(
      harness.binding,
      false,
      undefined,
      harness.origin,
    )
    // Assert
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
    assert.equal(harness.sourceColumn(), 2)
    assert.equal(harness.panelColumn('codebook.studyContext'), 3)
    assert.deepEqual(harness.editorLayout(), {
      orientation: 0,
      groups: [
        { size: 0.55, groups: [{ size: 0.5 }, { size: 0.5 }] },
        { size: 0.45 },
      ],
    })
    assert.equal(harness.reader.inspect().view?.errors.length, 0)
  } finally {
    await harness.close()
  }
})

for (const recording of [false, true])
  test(`Cursor two-event contraction preserves error-free Return and correct main panes and summary on ${recording ? 'recording' : 'observation'} reentry`, async () => {
    // Arrange
    const harness = await articleRecordingLayoutHarness()
    harness.useCursorGroupWrappers(true)
    try {
      // Observation entry creates the third main pane whose contraction this test exercises.
      await harness.reader.openRepositoryEvidence(
        harness.binding,
        false,
        undefined,
        harness.origin,
      )
      const previousGroups = [...harness.groups],
        previousTabs = previousGroups.map((group) => [...group.tabs])
      // Act
      await harness.reader.action('return-wiki')
      const returnErrorCount = harness.reader.inspect().view!.errors.length
      assert.deepEqual(harness.editorLayout(), {
        orientation: 1,
        groups: [{ size: 161 }, { size: 162 }],
      })
      assert.deepEqual(
        previousGroups.map((group) => group.tabs),
        previousTabs,
      )
      await harness.reader.openRepositoryEvidence(
        harness.binding,
        recording,
        undefined,
        harness.origin,
      )
      await harness.controller.settle()
      // Assert
      assert.deepEqual(
        {
          returnErrorCount,
          appColumn: harness.panelColumn('codebook.scopedBrowser'),
          sourceColumn: harness.sourceColumn(),
          contextColumn: harness.panelColumn('codebook.studyContext'),
        },
        {
          returnErrorCount: 0,
          appColumn: 1,
          sourceColumn: 2,
          contextColumn: recording ? undefined : 3,
        },
      )
      assert.deepEqual(
        harness.editorLayout(),
        recording
          ? { orientation: 1, groups: [{ size: 0.5 }, { size: 0.5 }] }
          : {
              orientation: 0,
              groups: [
                { size: 0.55, groups: [{ size: 0.5 }, { size: 0.5 }] },
                { size: 0.45 },
              ],
            },
      )
      assert.equal(harness.reader.inspect().view!.errors.length, 0)
      const application = harness.groups.find(
          (group) => group.viewColumn === 1,
        )!.activeTab?.input,
        source = harness.groups.find((group) => group.viewColumn === 2)!
          .activeTab?.input,
        context = harness.groups.find((group) => group.viewColumn === 3)
          ?.activeTab?.input
      assert.ok(application && 'viewType' in application)
      assert.equal(application.viewType, 'codebook.scopedBrowser')
      assert.ok(source && 'uri' in source)
      assert.equal(source.uri.toString(), harness.reader.inspect().sourceUri)
      if (recording) {
        assert.equal(context, undefined)
        assert.equal(harness.summary.visible, true)
      } else {
        assert.ok(context && 'viewType' in context)
        assert.equal(context.viewType, 'codebook.studyContext')
      }
    } finally {
      await harness.close()
    }
  })

test('Cursor preserves a uniquely added learner text tab while returning to the saved article grid', async () => {
  // Arrange
  const harness = await articleRecordingLayoutHarness()
  try {
    await harness.reader.openRepositoryEvidence(
      harness.binding,
      true,
      undefined,
      harness.origin,
    )
    await harness.controller.settle()
    const previous = harness.groups[0]!,
      previousTabs = [...previous.tabs]
    // Act
    harness.resyncEditorGroups('append')
    await harness.reader.action('return-wiki')
    // Assert
    assert.deepEqual(previous.tabs, previousTabs)
    assert.deepEqual(harness.editorLayout(), {
      orientation: 1,
      groups: [{ size: 161 }, { size: 162 }],
    })
    assert.equal(
      harness.groups[0]!.tabs.some(
        (tab) =>
          'uri' in tab.input &&
          tab.input.uri.path === '/learner-added-notes.txt',
      ),
      true,
    )
  } finally {
    await harness.close()
  }
})

test('Cursor group creation cannot make a fourth learner group eligible for article Return contraction', async () => {
  // Arrange
  const harness = await articleRecordingLayoutHarness()
  harness.useCursorGroupWrappers()
  try {
    // Observation entry creates the third main pane whose contraction this test exercises.
    await harness.reader.openRepositoryEvidence(
      harness.binding,
      false,
      undefined,
      harness.origin,
    )
    harness.groups.push({ viewColumn: 4, tabs: [] })
    const draft = harness.addForeignDraft(4)
    harness.resyncEditorGroups()
    const layout = harness.editorLayout(),
      mutations = harness.commands.filter(
        (command) => command === 'vscode.setEditorLayout',
      ).length
    // Act
    await harness.reader.action('return-wiki')
    // Assert
    assert.equal(harness.groups.length, 4)
    assert.equal(draft.isDirty, true)
    assert.equal(
      harness.groups[3]!.tabs.some(
        (tab) =>
          'uri' in tab.input &&
          tab.input.uri.toString() === draft.input.uri.toString(),
      ),
      true,
    )
    assert.deepEqual(harness.editorLayout(), layout)
    assert.equal(
      harness.commands.filter((command) => command === 'vscode.setEditorLayout')
        .length,
      mutations,
    )
  } finally {
    await harness.close()
  }
})

for (const cursor of [false, true])
  test(`${cursor ? 'Cursor' : 'VS Code'} explicit observation reentry reveals its captured application over the retained article tab`, async () => {
    // Arrange
    const harness = await articleRecordingLayoutHarness(true)
    if (cursor) harness.useCursorGroupWrappers()
    try {
      const draft = harness.addForeignDraft()
      await harness.reader.openRepositoryEvidence(
        harness.binding,
        true,
        undefined,
        harness.origin,
      )
      await harness.controller.settle()
      await harness.reader.action('return-wiki')
      const readingGroup = harness.groups.find(
        (group) => group.viewColumn === 1,
      )!
      readingGroup.activeTab = readingGroup.tabs.find(
        (tab) =>
          'uri' in tab.input &&
          tab.input.uri.path.endsWith('/article-source.ts'),
      )
      const reveals = harness.panelReveals().length
      // Act
      await harness.reader.openRepositoryEvidence(
        harness.binding,
        false,
        undefined,
        harness.origin,
      )
      // Assert
      const image = harness.reader.inspect().view?.model.image
      assert.equal(image?.status, 'captured')
      assert.equal(image?.base64, harness.png.toString('base64'))
      const application = harness.groups.find(
        (group) => group.viewColumn === 1,
      )!.activeTab?.input
      assert.ok(application && 'viewType' in application)
      assert.equal(application.viewType, 'codebook.scopedBrowser')
      assert.deepEqual(
        harness
          .panelReveals()
          .slice(reveals)
          .filter((reveal) => reveal.kind === 'codebook.scopedBrowser'),
        [
          {
            kind: 'codebook.scopedBrowser',
            column: undefined,
            preserveFocus: true,
          },
        ],
      )
      assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
      assert.equal(harness.sourceColumn(), 2)
      assert.equal(harness.panelColumn('codebook.studyContext'), 3)
      assert.equal(
        harness.groups.some((group) => group.tabs.includes(draft)),
        true,
      )
      assert.equal(draft.isDirty, true)
      assert.equal(harness.runtimes[0]!.dispatches, 1)
    } finally {
      await harness.close()
    }
  })

for (const sharedContext of [false, true])
  test(`explicit observation entry preserves a manually moved application${sharedContext ? ' sharing the context group with Return visible' : ' in its current column'}`, async () => {
    // Arrange
    const harness = await articleRecordingLayoutHarness(true),
      manual = {
        orientation: 1,
        groups: [{ size: 111 }, { size: 222 }, { size: 333 }],
      }
    try {
      await harness.reader.openRepositoryEvidence(
        harness.binding,
        false,
        undefined,
        harness.origin,
      )
      harness.movePanel('codebook.scopedBrowser', 3)
      harness.movePanel('codebook.studyContext', sharedContext ? 3 : 1)
      harness.changeEditorLayout(manual)
      const draft = harness.addForeignDraft(3)
      harness.groups.find((group) => group.viewColumn === 3)!.activeTab = draft
      const mutations = harness.commands.filter(
          (command) => command === 'vscode.setEditorLayout',
        ).length,
        reveals = harness.panelReveals().length
      // Act
      await harness.reader.openRepositoryEvidence(
        harness.binding,
        false,
        undefined,
        harness.origin,
      )
      // Assert
      const visible = harness.groups.find((group) => group.viewColumn === 3)!
        .activeTab?.input
      assert.ok(visible && 'viewType' in visible)
      assert.equal(
        visible.viewType,
        sharedContext ? 'codebook.studyContext' : 'codebook.scopedBrowser',
      )
      assert.equal(harness.panelColumn('codebook.scopedBrowser'), 3)
      assert.equal(
        harness.panelColumn('codebook.studyContext'),
        sharedContext ? 3 : 1,
      )
      assert.equal(harness.sourceColumn(), 2)
      assert.deepEqual(harness.editorLayout(), manual)
      assert.equal(
        harness.commands.filter(
          (command) => command === 'vscode.setEditorLayout',
        ).length,
        mutations,
      )
      assert.deepEqual(harness.panelReveals().slice(reveals), [
        {
          kind: 'codebook.scopedBrowser',
          column: undefined,
          preserveFocus: true,
        },
        {
          kind: 'codebook.studyContext',
          column: undefined,
          preserveFocus: false,
        },
      ])
      assert.equal(
        harness.groups
          .find((group) => group.viewColumn === 3)!
          .tabs.includes(draft),
        true,
      )
      assert.equal(draft.isDirty, true)
    } finally {
      await harness.close()
    }
  })

test('periodic study refresh preserves a learner text tab selected over the captured application', async () => {
  // Arrange
  const harness = await articleRecordingLayoutHarness(true)
  try {
    await harness.reader.openRepositoryEvidence(
      harness.binding,
      false,
      undefined,
      harness.origin,
    )
    const draft = harness.addForeignDraft(1)
    harness.groups.find((group) => group.viewColumn === 1)!.activeTab = draft
    const reveals = harness
      .panelReveals()
      .filter((reveal) => reveal.kind === 'codebook.scopedBrowser').length
    // Act
    await harness.reader['refresh']()
    // Assert
    assert.equal(harness.reader.inspect().view?.model.image?.status, 'captured')
    assert.equal(
      harness.groups.find((group) => group.viewColumn === 1)!.activeTab,
      draft,
    )
    assert.equal(
      harness
        .panelReveals()
        .filter((reveal) => reveal.kind === 'codebook.scopedBrowser').length,
      reveals,
    )
  } finally {
    await harness.close()
  }
})

for (const retirement of ['cancel', 'Close'] as const)
  test(`${retirement} during observation source loading prevents a late application reveal over the article`, async () => {
    // Arrange
    const harness = await articleRecordingLayoutHarness(true),
      cancellation = new AbortController()
    let release = (): void => {}
    try {
      await harness.reader.openRepositoryEvidence(
        harness.binding,
        false,
        undefined,
        harness.origin,
      )
      await harness.reader.action('return-wiki')
      const readingGroup = harness.groups.find(
        (group) => group.viewColumn === 1,
      )!
      readingGroup.activeTab = readingGroup.tabs.find(
        (tab) =>
          'uri' in tab.input &&
          tab.input.uri.path.endsWith('/article-source.ts'),
      )
      const source = harness.holdNextSource()
      release = source.release
      const reveals = harness
        .panelReveals()
        .filter((reveal) => reveal.kind === 'codebook.scopedBrowser').length
      const opening = harness.reader.openRepositoryEvidence(
          harness.binding,
          false,
          cancellation.signal,
          harness.origin,
        ),
        rejected = assert.rejects(
          opening,
          retirement === 'cancel' ? /abort/i : /closed/,
        )
      // Act
      await source.started
      const closing =
        retirement === 'Close' ? harness.reader.close() : undefined
      if (retirement === 'cancel') cancellation.abort()
      source.release()
      await rejected
      await closing
      // Assert
      assert.equal(
        harness
          .panelReveals()
          .filter((reveal) => reveal.kind === 'codebook.scopedBrowser').length,
        reveals,
      )
      const visible = harness.groups.find((group) => group.viewColumn === 1)!
        .activeTab?.input
      assert.ok(visible && 'uri' in visible)
      assert.equal(visible.uri.path.endsWith('/article-source.ts'), true)
      if (retirement === 'Close') assert.equal(harness.counts().panels, 0)
    } finally {
      release()
      await harness.close()
    }
  })

for (const separatePart of [false, true])
  for (const primaryContent of ['application only', 'unrelated draft'] as const)
    test(`mode transfers retain native destination groups with ${primaryContent} and ${separatePart ? 'a separate chat part' : 'one editor part'}`, async () => {
      // Arrange
      const harness = await workspaceHarness(false)
      harness.useNativeLayout({ orientation: 0, groups: [{}] })
      const chat = separatePart ? harness.addSeparateEditorPart() : undefined
      try {
        await openRetainedStudy(harness)
        await harness.reader.understand(true)
        const primary = harness.groups.find((group) => group.viewColumn === 1)!
        primary.tabs = primary.tabs.filter((tab) => 'viewType' in tab.input)
        const draft =
          primaryContent === 'unrelated draft'
            ? harness.addForeignDraft(1)
            : undefined
        const source = harness.reader.inspect().sourceUri,
          decisions = await (
            await harness.reader.learningStorage()
          ).readProgress(),
          chatLayout = chat?.layout()
        harness.closeEmptyGroupsAfterPanelMove()
        // Act
        for (const mode of [
          'living-book',
          'guided-walkthrough',
          'study-workspace',
          'living-book',
        ] as const) {
          const state = harness.reader.presentationState()
          await harness.reader.changePresentation({
            presentationId: state.presentationId,
            expectedRevision: state.presentationControlRevision,
            mode,
            action: 'select',
          })
          // Assert: each destination remains in the original main part throughout the transfer.
          assert.equal(harness.reader.presentationState().layoutConfirmed, true)
          assert.deepEqual(
            { ...harness.reader.presentationState().panes },
            mode === 'living-book'
              ? { appColumn: 2, sourceColumn: 3, contextColumn: 1 }
              : { appColumn: 1, sourceColumn: 2, contextColumn: 3 },
          )
          assert.deepEqual(harness.automaticallyClosedColumns(), [])
          assert.equal(harness.groups.length, separatePart ? 4 : 3)
          assert.equal(harness.reader.inspect().sourceUri, source)
          if (draft) {
            assert.equal(primary.tabs.includes(draft), true)
            assert.equal(draft.isDirty, true)
          }
          if (chat) {
            assert.deepEqual(
              harness.groups.find((group) => group.viewColumn === 4)!.tabs,
              [chat.tab],
            )
            assert.deepEqual(chat.layout(), chatLayout)
            assert.equal(chat.focused(), false)
          }
        }
        assert.deepEqual(
          await (await harness.reader.learningStorage()).readProgress(),
          decisions,
        )
        assert.equal(harness.runtimes.length, 0)
      } finally {
        await harness.close()
      }
    })

for (const mode of [
  'study-workspace',
  'living-book',
  'guided-walkthrough',
] as const)
  test(`replay reentry after ${mode} request confirms only the current layout when its source becomes ready`, async () => {
    // Arrange
    const harness = await recordedReaderHarness(true)
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    let releaseSource = (): void => {}
    try {
      await harness.reader.openRecording(harness.studyId)
      await harness.controller.settle()
      const state = harness.reader.presentationState()
      if (mode === 'study-workspace')
        await harness.reader.changePresentation({
          presentationId: state.presentationId,
          expectedRevision: state.presentationControlRevision,
          mode,
          action: 'select',
        })
      else
        assert.throws(
          () =>
            harness.reader.changePresentation({
              presentationId: state.presentationId,
              expectedRevision: state.presentationControlRevision,
              mode,
              action: 'select',
            }),
          { code: 'PRESENTATION_UNAVAILABLE' },
        )
      const source = harness.reader.inspect().sourceUri,
        bundle = harness.controller.bundle(),
        progress = await (await harness.reader.learningStorage()).readProgress()
      const pendingSource = harness.holdNextSource()
      releaseSource = pendingSource.release
      // Act: native app visibility rehydrates the same replay while its source remains pending.
      harness.controller.hide()
      harness.controller.reveal()
      await pendingSource.started
      await harness.reader.open()
      // Assert: a verified grid never certifies a source that is still loading.
      assert.equal(harness.reader.presentationState().layoutConfirmed, false)
      pendingSource.release()
      await harness.controller.settle()
      assert.equal(
        (await harness.reader.readPresentationState()).layoutConfirmed,
        true,
      )
      assert.equal(harness.reader.presentationState().mode, 'study-workspace')
      assert.deepEqual(
        { ...harness.reader.presentationState().panes },
        { appColumn: 1, sourceColumn: 2, contextColumn: undefined },
      )
      assert.equal(harness.reader.inspect().sourceUri, source)
      assert.equal(harness.controller.bundle(), bundle)
      assert.equal(harness.controller.state().readiness, 'ready')
      assert.equal(harness.controller.state().mode, 'paused')
      assert.deepEqual(
        await (await harness.reader.learningStorage()).readProgress(),
        progress,
      )
      assert.equal(harness.runtimes.length, 1)
      assert.equal(harness.runtimes[0]!.dispatches, 1)
    } finally {
      releaseSource()
      await harness.close()
    }
  })

for (const change of ['layout', 'groups'] as const)
  test(`replay readiness after explicit reentry cannot confirm later learner ${change}`, async () => {
    // Arrange
    const harness = await recordedReaderHarness(true)
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    let releaseSource = (): void => {}
    try {
      await harness.reader.openRecording(harness.studyId)
      await harness.controller.settle()
      const state = harness.reader.presentationState()
      await harness.reader.changePresentation({
        presentationId: state.presentationId,
        expectedRevision: state.presentationControlRevision,
        mode: 'study-workspace',
        action: 'restore',
      })
      const draft = harness.addForeignDraft(1)
      const pendingSource = harness.holdNextSource()
      releaseSource = pendingSource.release
      harness.controller.hide()
      harness.controller.reveal()
      await pendingSource.started
      await harness.reader.open()
      // Act: later learner ownership must outrank the retained placement when replay finishes.
      if (change === 'layout')
        harness.changeEditorLayout({
          orientation: 1,
          groups: [{ size: 8 }, { size: 2 }],
        })
      else harness.resyncEditorGroups('replace')
      const manualLayout = harness.editorLayout()
      pendingSource.release()
      await harness.controller.settle()
      // Assert
      assert.equal(
        (await harness.reader.readPresentationState()).layoutConfirmed,
        false,
      )
      assert.deepEqual(harness.editorLayout(), manualLayout)
      assert.equal(
        harness.groups.some((group) =>
          group.tabs.some(
            (tab) =>
              tab.isDirty &&
              'uri' in tab.input &&
              tab.input.uri.toString() === draft.input.uri.toString(),
          ),
        ),
        true,
      )
      assert.equal(harness.controller.state().readiness, 'ready')
      assert.equal(harness.runtimes[0]!.dispatches, 1)
    } finally {
      releaseSource()
      await harness.close()
    }
  })

test('all three presentation modes preserve source, learning item and learner decisions across pane handoffs', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await openRetainedStudy(harness)
    await harness.reader.understand(true)
    const initial = harness.reader.inspect(),
      library = await harness.reader.learningStorage(),
      progress = await library.readProgress()
    const app = harness.reader['app'],
      context = harness.reader['contextPanel']
    const draft = harness.addForeignDraft(1)
    // Act
    let state = harness.reader.presentationState()
    await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'living-book',
      action: 'select',
    })
    // Assert
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 2)
    assert.equal(harness.panelColumn('codebook.studyContext'), 1)
    assert.equal(harness.sourceColumn(), 3)
    assert.deepEqual(harness.editorLayout(), {
      orientation: 0,
      groups: [
        { size: 0.6 },
        { size: 0.4, groups: [{ size: 0.5 }, { size: 0.5 }] },
      ],
    })
    state = harness.reader.presentationState()
    await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'guided-walkthrough',
      action: 'select',
    })
    assert.deepEqual(harness.editorLayout(), {
      orientation: 1,
      groups: [
        { size: 0.55, groups: [{ size: 0.5 }, { size: 0.5 }] },
        { size: 0.45 },
      ],
    })
    state = harness.reader.presentationState()
    await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })
    assert.notEqual(harness.reader['app'], app)
    assert.notEqual(harness.reader['contextPanel'], context)
    assert.equal(harness.counts().panels, 2)
    assert.equal(harness.peakPanels(), 4)
    assert.equal(harness.reader.inspect().sourceUri, initial.sourceUri)
    assert.deepEqual(
      harness.reader.inspect().view!.model.selection,
      initial.view!.model.selection,
    )
    assert.deepEqual(await library.readProgress(), progress)
    assert.equal(harness.runtimes.length, 0)
    assert.equal(
      harness.groups.some((group) => group.tabs.includes(draft)),
      true,
    )
    assert.equal(draft.isDirty, true)
    assert.equal(
      harness.reader.presentationState().presentationControlRevision,
      3,
    )
    assert.equal(harness.reader.presentationState().layoutConfirmed, true)
    assert.deepEqual(
      harness.presentationPreferences.get('codebook.presentation.v1'),
      { version: 1, mode: 'study-workspace' },
    )
  } finally {
    await harness.close()
  }
})

test('enlarging a recorded application targets its owned pane and retains the paused evidence', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  let release = (): void => {}
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    harness.controller.command({
      action: 'seek',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
      positionMs: 100,
    })
    await harness.controller.settle()
    await harness.reader.action('focus-context')
    const source = harness.reader.inspect().sourceUri,
      bundle = harness.controller.bundle()
    const decisions = await (
      await harness.reader.learningStorage()
    ).readProgress()
    const maximize = harness.holdNextCommand(
      'workbench.action.toggleMaximizeEditorGroup',
    )
    release = maximize.release
    // Act
    const enlarging = harness.reader.action('enlarge-app')
    await maximize.started
    // Assert
    assert.equal(harness.focusedPanel(), 'codebook.scopedBrowser')
    assert.equal(harness.innerFocusedPanel(), 'codebook.scopedBrowser')
    maximize.release()
    await enlarging
    assert.equal(
      harness.commands.filter(
        (command) => command === 'workbench.action.toggleMaximizeEditorGroup',
      ).length,
      1,
    )
    assert.equal(harness.controller.state().mode, 'paused')
    assert.equal(harness.controller.state().presentedMs, 100)
    assert.equal(harness.controller.bundle(), bundle)
    assert.equal(harness.reader.inspect().sourceUri, source)
    assert.deepEqual(
      await (await harness.reader.learningStorage()).readProgress(),
      decisions,
    )
    assert.equal(harness.runtimes[0]!.dispatches, 1)
  } finally {
    release()
    await harness.close()
  }
})

test('replay refuses retired explanation enlargement without changing native layout or evidence', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    const commands = harness.commands.length,
      playback = harness.controller.state(),
      panels = harness.nativePanels()
    // Act / Assert
    await assert.rejects(
      harness.reader.action('enlarge-context'),
      /Open a study explanation/,
    )
    assert.equal(harness.commands.length, commands)
    assert.deepEqual(harness.controller.state(), playback)
    assert.deepEqual(harness.nativePanels(), panels)
    assert.equal(harness.summary.visible, true)
    assert.equal(harness.runtimes[0]!.dispatches, 1)
  } finally {
    await harness.close()
  }
})

test('Restore layout after enlarging the app waits for Study focus without losing recorded evidence', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    harness.controller.command({
      action: 'seek',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
      positionMs: 100,
    })
    await harness.controller.settle()
    const source = harness.reader.inspect().sourceUri,
      bundle = harness.controller.bundle()
    await harness.reader.action('enlarge-app')
    harness.deferPanelFocus('codebook.studyContext', 1)
    await harness.reader.action('focus-context')

    // Act: Cursor delivers the Study click before its native focus notification.
    await harness.reader.action('arrange')

    // Assert
    assert.equal(
      harness.reader.presentationState().layoutConfirmed,
      true,
      harness.reader.inspect().view!.errors.join('\n'),
    )
    assert.deepEqual([...harness.reader.inspect().view!.errors], [])
    assert.equal(harness.controller.state().presentedMs, 100)
    assert.equal(harness.controller.bundle(), bundle)
    assert.equal(harness.reader.inspect().sourceUri, source)
    assert.equal(harness.runtimes[0]!.dispatches, 1)
  } finally {
    await harness.close()
  }
})

test('Restore layout keeps the original Study panes when Cursor focuses Application during its layout read', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  let release = (): void => {}
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    harness.controller.command({
      action: 'seek',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
      positionMs: 100,
    })
    await harness.controller.settle()
    const panels = harness.nativePanels(),
      bundle = harness.controller.bundle()
    const layoutMutations = harness.commands.filter(
      (command) => command === 'vscode.setEditorLayout',
    ).length
    await harness.reader.action('enlarge-app')
    const reading = harness.holdNextCommand('vscode.getEditorLayout')
    release = reading.release
    // Act: a late native focus notification selects the owned Application while the main grid is read.
    const restoring = harness.reader.action('arrange')
    await reading.started
    const application = harness
      .nativePanels()
      .find((panel) => panel.kind === 'codebook.scopedBrowser')
    assert.ok(application)
    harness.focusExistingWebviewTab(application.nativeTab)
    reading.release()
    await restoring
    // Assert
    assert.equal(
      harness.reader.presentationState().layoutConfirmed,
      true,
      harness.reader.inspect().view!.errors.join('\n'),
    )
    assert.deepEqual([...harness.reader.inspect().view!.errors], [])
    assert.deepEqual(harness.nativePanels(), panels)
    assert.equal(harness.maximizedEditorGroup(), false)
    assert.equal(
      harness.commands.filter((command) => command === 'vscode.setEditorLayout')
        .length,
      layoutMutations + 1,
    )
    assert.equal(harness.controller.bundle(), bundle)
    assert.equal(harness.controller.state().presentedMs, 100)
    assert.equal(harness.runtimes[0]!.dispatches, 1)
  } finally {
    release()
    await harness.close()
  }
})

test('reopening an enlarged Study does not claim its three-pane layout was confirmed', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.open()
    await harness.reader.action('enlarge-app')
    assert.equal(harness.reader.presentationState().layoutConfirmed, false)
    // Act
    await harness.reader.open()
    // Assert
    assert.equal(harness.reader.presentationState().layoutConfirmed, false)
  } finally {
    await harness.close()
  }
})

test('Restore waits for an active layout transaction before confirming an enlarged Study', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  let release = (): void => {},
    entered = (): void => {}
  const started = new Promise<void>((resolve) => {
    entered = resolve
  })
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    await harness.reader.action('enlarge-app')
    const activeLayout = harness.reader['withLayout'](undefined, async () => {
      entered()
      await held
    })
    await started
    const mutationsBeforeRestore = harness.commands.filter(
      (command) => command === 'vscode.setEditorLayout',
    ).length
    const state = harness.reader.presentationState()
    // Act
    const restoring = harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: state.mode,
      action: 'restore',
    })
    await new Promise<void>((resolve) => setImmediate(resolve))
    const mutationsWhileHeld = harness.commands.filter(
      (command) => command === 'vscode.setEditorLayout',
    ).length
    release()
    await activeLayout
    await restoring
    // Assert
    assert.equal(mutationsWhileHeld, mutationsBeforeRestore)
    assert.equal(harness.reader.presentationState().layoutConfirmed, true)
    assert.equal(harness.maximizedEditorGroup(), false)
  } finally {
    release()
    await harness.close()
  }
})

test('the Study header Restore exits a maximized pane while keeping the settled recording in its original panes', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    harness.controller.command({
      action: 'seek',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
      positionMs: 100,
    })
    await harness.controller.settle()
    const panels = harness.nativePanels(),
      bundle = harness.controller.bundle()
    const mutations = harness.commands.filter(
      (command) => command === 'vscode.setEditorLayout',
    ).length
    await harness.reader.action('enlarge-app')
    assert.equal(harness.maximizedEditorGroup(), true)
    const state = harness.reader.presentationState()
    // Act: this is the header's direct presentation intent, not the lower Arrange action.
    await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: state.mode,
      action: 'restore',
    })
    // Assert
    assert.equal(harness.reader.presentationState().layoutConfirmed, true)
    assert.equal(harness.maximizedEditorGroup(), false)
    assert.equal(
      harness.reader.presentationState().presentationControlRevision,
      state.presentationControlRevision + 1,
    )
    assert.deepEqual(harness.nativePanels(), panels)
    assert.equal(
      harness.commands.filter((command) => command === 'vscode.setEditorLayout')
        .length,
      mutations + 1,
    )
    assert.equal(harness.controller.bundle(), bundle)
    assert.equal(harness.controller.state().presentedMs, 100)
  } finally {
    await harness.close()
  }
})

// Value: protects=the Study pane leaving its loading line after the editor failed to show a captured source, and showing the source by itself once the editor can; fails_when=a failed render keeps the loading state, so the pane reads "Loading the selected observation…" beside the error for good, or keeps the failed selection as already shown, so no refresh ever shows it; why_new=Cycle 0045 NF-8 with DR-8 and PC-1.3 (each of the two fixes alone leaves the other half); seam=the harness's editor refuses to open captured-source documents until it is restored
test("the Study pane leaves 'Loading the selected observation…' at the next refresh after showing the captured source failed once", async () => {
  // Arrange: an open reader, and an editor that cannot open captured-source documents for now.
  const harness = await workspaceHarness()
  try {
    await harness.reader.open()
    harness.failCurrentSourceOpen()

    // Act: the learner selects another item, whose captured source fails to show; then the editor recovers and the reader's timer runs once.
    await harness.reader.select('repository/workspace/overview')
    const afterFailure = harness.postedMessages().at(-1)!
    harness.restoreCurrentSourceOpen()
    await readerSeams(harness).refresh()
    const afterRefresh = harness.postedMessages().at(-1)!

    // Assert: first the reason with Retry (the line is one Retry storage / refresh answers) and no loading line, then the selected source without either.
    assert.deepEqual(
      {
        loading: afterFailure.loading,
        errors: [...afterFailure.errors],
        unretryableErrorCount: afterFailure.unretryableErrorCount,
      },
      {
        loading: false,
        errors: ['Error: Injected current source open failure'],
        unretryableErrorCount: 0,
      },
    )
    assert.deepEqual(
      {
        loading: afterRefresh.loading,
        errors: [...afterRefresh.errors],
        selectedItem: afterRefresh.model.selection.itemId,
        sourceShown: readerSeams(harness).isSourceShown(),
      },
      {
        loading: false,
        errors: [],
        selectedItem: 'repository/workspace/overview',
        sourceShown: true,
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's tabs while a captured source keeps failing to show; fails_when=every failed render forgets its selection, so the reader's timer renders the same source again four times a second and each attempt brings its tab to the front of the learner's group; why_new=Cycle 0045 NF-8 with PC-1.3 (the failed render now forgets its selection once, which needs this bound); seam=the harness's editor refuses to open captured-source documents until it is restored
test('a captured source that failed to show twice in a row is left to Retry storage / refresh instead of being tried again at every refresh', async () => {
  // Arrange: the selected item's captured source failed to show, and failed again at the reader's next refresh.
  const harness = await workspaceHarness()
  try {
    await harness.reader.open()
    harness.failCurrentSourceOpen()
    await harness.reader.select('repository/workspace/overview')
    await readerSeams(harness).refresh()
    const afterSecondFailure = harness.postedMessages().at(-1)!
    harness.restoreCurrentSourceOpen()

    // Act: further refreshes of the reader's timer, then the learner presses Retry storage / refresh.
    await readerSeams(harness).refresh()
    await readerSeams(harness).refresh()
    const sourceShownByTheTimer = readerSeams(harness).isSourceShown()
    const afterTimerRefreshes = harness.postedMessages().at(-1)!
    await harness.reader.action('retry')
    const afterRetry = harness.postedMessages().at(-1)!

    // Assert
    assert.deepEqual(
      {
        loading: afterSecondFailure.loading,
        errors: [...afterSecondFailure.errors],
      },
      {
        loading: false,
        errors: ['Error: Injected current source open failure'],
      },
    )
    assert.equal(sourceShownByTheTimer, false)
    assert.deepEqual(
      [...afterTimerRefreshes.errors],
      ['Error: Injected current source open failure'],
    )
    assert.deepEqual(
      {
        loading: afterRetry.loading,
        errors: [...afterRetry.errors],
        sourceShown: readerSeams(harness).isSourceShown(),
      },
      { loading: false, errors: [], sourceShown: true },
    )
  } finally {
    await harness.close()
  }
})

test('reading the sidebar beside an enlarged application preserves replay and restores the same source', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    harness.controller.command({
      action: 'seek',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
      positionMs: 100,
    })
    await harness.controller.settle()
    const panels = harness.nativePanels(),
      bundle = harness.controller.bundle()
    await harness.reader.action('enlarge-app')
    assert.equal(harness.maximizedEditorGroup(), true)
    await harness.reader.action('read-context')
    assert.equal(harness.summary.visible, true)
    assert.equal(harness.maximizedEditorGroup(), true)
    await harness.reader.action('enlarge-app')
    assert.equal(harness.focusedPanel(), 'codebook.scopedBrowser')
    assert.equal(harness.maximizedEditorGroup(), true)
    // Restore must not need to reopen source after Enlarge changes only geometry.
    harness.failCurrentSourceOpen()
    const state = harness.reader.presentationState()
    // Act
    await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: state.mode,
      action: 'restore',
    })
    // Assert
    assert.equal(harness.reader.presentationState().layoutConfirmed, true)
    assert.equal(harness.maximizedEditorGroup(), false)
    assert.deepEqual(harness.nativePanels(), panels)
    assert.equal(harness.controller.bundle(), bundle)
    assert.equal(harness.controller.state().presentedMs, 100)
  } finally {
    await harness.close()
  }
})

test('Restore layout repairs changed native proportions instead of certifying the enlarged receipt', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    await harness.reader.action('enlarge-app')
    const mutations = harness.commands.filter(
      (command) => command === 'vscode.setEditorLayout',
    ).length
    harness.changeEditorLayout({
      orientation: 0,
      groups: [{ size: 0.7 }, { size: 0.3 }],
    })
    // Act
    await harness.reader.action('arrange')
    // Assert
    assert.equal(
      harness.reader.presentationState().layoutConfirmed,
      true,
      harness.reader.inspect().view!.errors.join('\n'),
    )
    assert.ok(
      harness.commands.filter((command) => command === 'vscode.setEditorLayout')
        .length > mutations,
    )
    assert.equal(harness.runtimes[0]!.dispatches, 1)
  } finally {
    await harness.close()
  }
})

test('restoring a settled recording retains its application pane and confirmed playhead', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    const before = harness.controller.bundle(),
      playback = harness.controller.state(),
      panels = harness.nativePanels()
    let replacementCreated = false
    harness.onNextPanel('codebook.scopedBrowser', () => {
      replacementCreated = true
    })
    const state = harness.reader.presentationState()

    // Act
    await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: state.mode,
      action: 'restore',
    })

    // Assert
    assert.equal(replacementCreated, false)
    assert.deepEqual(harness.nativePanels(), panels)
    assert.equal(harness.controller.state().revision, playback.revision)
    assert.equal(harness.reader.presentationState().layoutConfirmed, true)
    assert.equal(harness.controller.bundle(), before)
    assert.equal(harness.controller.state().presentedMs, playback.presentedMs)
    assert.equal(harness.runtimes[0]!.dispatches, 1)
  } finally {
    await harness.close()
  }
})

for (const focus of ['application', 'source'] as const)
  for (const reading of ['selected statement', 'scrolled context'] as const)
    test(`${focus}-focused mode transfers keep the ${reading} visible without repeated upward drift`, async () => {
      // Arrange
      const harness = await workspaceHarness(false)
      harness.useNativeLayout({ orientation: 0, groups: [{}] })
      try {
        await harness.reader.open()
        await harness.reader.action(
          focus === 'application' ? 'focus-app' : 'source',
        )
        harness.retainReadingRange(
          reading === 'selected statement' ? 16 : 40,
          reading === 'selected statement' ? 27 : 52,
        )
        // Act
        for (const mode of [
          'living-book',
          'guided-walkthrough',
          'study-workspace',
        ] as const) {
          const state = harness.reader.presentationState()
          await harness.reader.changePresentation({
            presentationId: state.presentationId,
            expectedRevision: state.presentationControlRevision,
            mode,
            action: 'select',
          })
        }
        // Assert
        assert.equal(
          harness.isReadingLineVisible(
            reading === 'selected statement' ? 22 : 46,
          ),
          true,
        )
        assert.equal(harness.reader.presentationState().layoutConfirmed, true)
        assert.equal(harness.runtimes.length, 0)
      } finally {
        await harness.close()
      }
    })

for (const focus of ['application', 'source', 'summary'] as const)
  test(`paused replay preserves manually scrolled source context through repeated ${focus}-focused layout restoration`, async () => {
    // Arrange
    const harness = await recordedReaderHarness(true)
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    try {
      await harness.reader.openRecording(harness.studyId)
      await harness.controller.settle()
      harness.controller.command({
        action: 'seek',
        studyId: harness.studyId,
        expectedRevision: harness.controller.state().revision,
        positionMs: 100,
      })
      await harness.controller.settle()
      await harness.reader.action(
        focus === 'application'
          ? 'focus-app'
          : focus === 'source'
            ? 'source'
            : 'focus-context',
      )
      harness.retainReadingRange(40, 52)
      const bundle = harness.controller.bundle(),
        source = harness.reader.inspect().sourceUri
      // Act
      for (const attempt of [1, 2, 3]) {
        const state = harness.reader.presentationState()
        await harness.reader.changePresentation({
          presentationId: state.presentationId,
          expectedRevision: state.presentationControlRevision,
          mode: 'study-workspace',
          action: 'restore',
        })
        // Assert: every restoration keeps the learner-selected reading context.
        assert.equal(
          harness.isReadingLineVisible(46),
          true,
          `Restoration ${attempt} preserves the reading position.`,
        )
        assert.equal(harness.reader.presentationState().layoutConfirmed, true)
        assert.equal(harness.controller.state().mode, 'paused')
        assert.equal(harness.controller.state().presentedMs, 100)
        assert.equal(harness.controller.bundle(), bundle)
        assert.equal(harness.reader.inspect().sourceUri, source)
        assert.equal(harness.runtimes.length, 1)
        assert.equal(harness.runtimes[0]!.dispatches, 1)
      }
    } finally {
      await harness.close()
    }
  })

test('Living book to Guided walkthrough retains evidence and focus when native moves emit a late focus echo', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await openRetainedStudy(harness)
    await harness.reader.understand(true)
    const initial = harness.reader.presentationState()
    await harness.reader.changePresentation({
      presentationId: initial.presentationId,
      expectedRevision: initial.presentationControlRevision,
      mode: 'living-book',
      action: 'select',
    })
    await harness.reader.action('focus-context')
    const before = harness.reader.inspect(),
      decisions = await (await harness.reader.learningStorage()).readProgress(),
      draft = harness.addForeignDraft()
    harness.deferMovedFocusEcho()
    const state = harness.reader.presentationState()
    // Act
    await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'guided-walkthrough',
      action: 'select',
    })
    // Assert
    assert.equal(harness.reader.presentationState().mode, 'guided-walkthrough')
    assert.equal(harness.reader.presentationState().layoutConfirmed, true)
    assert.equal(harness.focusedPanel(), 'codebook.studyContext')
    assert.equal(harness.reader.inspect().sourceUri, before.sourceUri)
    assert.deepEqual(
      await (await harness.reader.learningStorage()).readProgress(),
      decisions,
    )
    assert.equal(
      harness.groups.some((group) => group.tabs.includes(draft)),
      true,
    )
    assert.equal(draft.isDirty, true)
    assert.equal(harness.runtimes.length, 0)
  } finally {
    await harness.close()
  }
})

for (const [pane, kind] of [
  ['app', 'codebook.scopedBrowser'],
  ['contextPanel', 'codebook.studyContext'],
] as const)
  test(`mode transfer waits for delayed ${pane} activity after its own native tab and document receive focus`, async () => {
    // Arrange
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    let release = (): void => {},
      transfer: Promise<unknown> | undefined
    try {
      await openRetainedStudy(harness)
      await harness.reader.understand(true)
      const initial = harness.reader.presentationState()
      await harness.reader.changePresentation({
        presentationId: initial.presentationId,
        expectedRevision: initial.presentationControlRevision,
        mode: 'living-book',
        action: 'select',
      })
      await harness.reader.action(
        kind === 'codebook.scopedBrowser' ? 'focus-app' : 'focus-context',
      )
      const before = harness.reader.inspect(),
        decisions = await (
          await harness.reader.learningStorage()
        ).readProgress(),
        draft = harness.addForeignDraft()
      const held = harness.holdPanelActivity(kind)
      release = held.release
      const state = harness.reader.presentationState()
      let completed = false
      // Act
      transfer = harness.reader.changePresentation({
        presentationId: state.presentationId,
        expectedRevision: state.presentationControlRevision,
        mode: 'guided-walkthrough',
        action: 'select',
      })
      void transfer.then(
        () => {
          completed = true
        },
        () => {
          completed = true
        },
      )
      await held.started
      await new Promise<void>((resolve) => setImmediate(resolve))
      // Assert: partial native/document acknowledgement neither fails nor confirms the transfer.
      assert.equal(harness.focusedPanel(), kind)
      assert.equal(harness.innerFocusedPanel(), kind)
      assert.equal(harness.reader[pane]?.active, false)
      assert.equal(completed, false)
      assert.equal(harness.reader.presentationState().layoutConfirmed, false)
      assert.deepEqual(
        harness.presentationPreferences.get('codebook.presentation.v1'),
        { version: 1, mode: 'living-book' },
      )
      held.release()
      await transfer
      assert.equal(
        harness.reader.presentationState().mode,
        'guided-walkthrough',
      )
      assert.equal(harness.reader.presentationState().layoutConfirmed, true)
      assert.equal(harness.focusedPanel(), kind)
      assert.equal(harness.reader.inspect().sourceUri, before.sourceUri)
      assert.deepEqual(
        await (await harness.reader.learningStorage()).readProgress(),
        decisions,
      )
      assert.equal(
        harness.groups.some((group) => group.tabs.includes(draft)),
        true,
      )
      assert.equal(draft.isDirty, true)
      assert.equal(harness.runtimes.length, 0)
    } finally {
      release()
      await transfer?.catch(() => undefined)
      await harness.close()
    }
  })

/** Settles a navigation to a short label so a regression that waits forever fails the test instead of hanging it; its timer never outlives the navigation. @example await settleWithin(opening, 6_500) */
async function settleWithin(
  operation: Promise<unknown>,
  limitMs: number,
): Promise<string> {
  let limit: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    operation.then(
      () => 'completed',
      (error: unknown) =>
        error instanceof Error && 'code' in error
          ? String(error.code)
          : String(error),
    ),
    new Promise<string>((resolve) => {
      limit = setTimeout(() => resolve('still waiting'), limitMs)
    }),
  ]).finally(() => clearTimeout(limit))
}

// Value: protects=repository evidence navigation while the recorded application cannot paint (for example a hidden replay panel); fails_when=the navigation waits for the frame forever, so the reader stays busy and the next recording never presents; why_new=Cycle 0032 B1/D2/D5 at the repository evidence site; seam=node:test setTimeout mock (the 5 s bound passes without real waiting)
test('repository evidence whose recorded frame never paints fails within its bound and the next recording open presents its frame', async (context) => {
  // Arrange
  const harness = await articleRecordingLayoutHarness(true)
  let release = (): void => {}
  try {
    const neverPainted = harness.holdNextImage()
    release = neverPainted.release
    enableFakeClock(context)

    // Act
    const navigation = settleWithin(
      harness.reader.openRepositoryEvidence(
        harness.binding,
        true,
        undefined,
        harness.origin,
      ),
      PRESENTATION_SETTLE_CEILING_MS,
    )
    await advanceClockUntilSettled(context, neverPainted.started, 2_000)
    let outcomeBeforeBound = 'still painting'
    void navigation.then((label) => {
      outcomeBeforeBound = label
    })
    await advanceClock(context, PRESENTATION_READY_TIMEOUT_MS - 100)
    const beforeBound = outcomeBeforeBound
    // The navigation must have failed 6,000 ms after its paint began (the bound Cycle 0034 T2 decided); the helper fails the test otherwise.
    await advanceClockUntilSettled(context, navigation, 1_100)
    const outcome = await navigation
    resetFakeClock(context)
    // A navigation that still waits leaves playback busy; stop here instead of hanging the recovery open.
    assert.equal(outcome, 'PRESENTATION_UNAVAILABLE')
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()

    // Assert: the bound is measured from the paint phase (Cycle 0033 AC4): still painting 100 ms before it, failed by 6,000 ms.
    assert.equal(beforeBound, 'still painting')
    assert.equal(harness.controller.state().readiness, 'ready')
    assert.equal(harness.controller.bundle()?.studyId, harness.studyId)
    assert.equal(
      harness.controller.state().presentedMs,
      harness.controller.state().requestedMs,
    )
  } finally {
    resetFakeClock(context)
    release()
    await harness.close()
  }
})

// Value: protects=a learner seek made while an evidence navigation waits on a frame that never paints; fails_when=the navigation's expired bound hides playback although the learner's seek now owns it, so the seek never presents; why_new=Cycle 0032 D4 (outside voice); seam=node:test setTimeout mock
test('an evidence navigation that gives up never cancels a newer learner seek', async (context) => {
  // Arrange
  const harness = await articleRecordingLayoutHarness(true)
  const releases: Array<() => void> = []
  try {
    const stuckPaint = harness.holdNextImage()
    releases.push(stuckPaint.release)
    enableFakeClock(context)
    const navigation = settleWithin(
      harness.reader.openRepositoryEvidence(
        harness.binding,
        true,
        undefined,
        harness.origin,
      ),
      PRESENTATION_SETTLE_CEILING_MS,
    )
    await advanceClockUntilSettled(context, stuckPaint.started, 2_000)
    const seekPaint = harness.holdNextImage()
    releases.push(seekPaint.release)

    // Act
    harness.controller.command({
      action: 'seek',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
      positionMs: 150,
    })
    await advanceClockUntilSettled(context, seekPaint.started, 2_000)
    await advanceClockUntilSettled(
      context,
      navigation,
      PRESENTATION_READY_TIMEOUT_MS + 1_500,
    )
    const navigationOutcome = await navigation
    resetFakeClock(context)
    seekPaint.release()
    await harness.controller.settle()

    // Assert
    assert.equal(navigationOutcome, 'PRESENTATION_UNAVAILABLE')
    assert.equal(harness.controller.state().presentedMs, 150)
    assert.equal(harness.controller.state().readiness, 'ready')
  } finally {
    resetFakeClock(context)
    for (const release of releases) release()
    await harness.close()
  }
})

// Value: protects=a healthy cold presentation whose native debugger needs 4 s before a 2 s paint; fails_when=the 5 s bound again covers the native debugger wait instead of painting only; why_new=Cycle 0033 B2 (Red Team/Claude adversarial in Cycle 0032); seam=node:test setTimeout mock
test('a cold evidence navigation whose native debugger takes 4 s and whose frame paints in 2 s still presents', async (context) => {
  // Arrange
  const harness = await articleRecordingLayoutHarness(true, true)
  const releases: Array<() => void> = []
  try {
    // The opening gap frame has no image; hold the recorded stop so its debugger wait and its paint share one settle.
    const slowDebugger = harness.holdHistoricalDebugPresentation(true)
    releases.push(slowDebugger.release)
    const slowPaint = harness.holdNextImage()
    releases.push(slowPaint.release)
    enableFakeClock(context)

    // Act
    const navigation = settleWithin(
      harness.reader.openRepositoryEvidence(
        harness.binding,
        true,
        undefined,
        harness.origin,
      ),
      PRESENTATION_SETTLE_CEILING_MS + 1_500,
    )
    await advanceClockUntilSettled(context, slowDebugger.started, 2_000)
    await advanceClock(context, 4_000)
    slowDebugger.release()
    await advanceClockUntilSettled(context, slowPaint.started, 2_000)
    await advanceClock(context, 2_000)
    slowPaint.release()
    await advanceClockUntilSettled(context, navigation, 2_000)
    const outcome = await navigation
    resetFakeClock(context)

    // Assert
    assert.equal(outcome, 'completed')
    assert.equal(harness.controller.state().readiness, 'ready')
    assert.equal(
      harness.controller.state().presentedMs,
      harness.binding.elapsedMs,
    )
  } finally {
    resetFakeClock(context)
    for (const release of releases) release()
    await harness.close()
  }
})

// Value: protects=the slowest healthy replay sequence still presenting; fails_when=the settle ceiling leaves out the pending startup a retirement waits for or the inspection grace, so a healthy 15.7 s native debugger wait reports PRESENTATION_UNAVAILABLE and hides the frame; why_new=Cycle 0044 (0033-F2e3 / 0034-PL5); seam=node:test setTimeout mock
test('an evidence navigation whose native debugger needs a pending startup, a retirement, the next startup and the inspection grace (15.7 s) before a 4.9 s paint still presents', async (context) => {
  // Arrange
  const harness = await articleRecordingLayoutHarness(true, true)
  const releases: Array<() => void> = []
  try {
    // The opening gap frame has no image; hold the recorded stop so its debugger wait and its paint share one settle.
    const slowDebugger = harness.holdHistoricalDebugPresentation(true)
    releases.push(slowDebugger.release)
    const slowPaint = harness.holdNextImage()
    releases.push(slowPaint.release)
    enableFakeClock(context)

    // Act: each native step stays just inside its own bound (3 × 4.9 s, then the 1 s grace).
    const navigation = settleWithin(
      harness.reader.openRepositoryEvidence(
        harness.binding,
        true,
        undefined,
        harness.origin,
      ),
      30_000,
    )
    await advanceClockUntilSettled(context, slowDebugger.started, 2_000)
    await advanceClock(context, 15_700)
    slowDebugger.release()
    await advanceClockUntilSettled(context, slowPaint.started, 2_000)
    await advanceClock(context, 4_900)
    slowPaint.release()
    await advanceClockUntilSettled(context, navigation, 2_000)
    const outcome = await navigation
    resetFakeClock(context)

    // Assert
    assert.equal(outcome, 'completed')
    assert.equal(harness.controller.state().readiness, 'ready')
    assert.equal(
      harness.controller.state().presentedMs,
      harness.binding.elapsedMs,
    )
  } finally {
    resetFakeClock(context)
    for (const release of releases) release()
    await harness.close()
  }
})

// Value: protects=an evidence navigation whose presentation never reaches painting still ending; fails_when=the settle has no ceiling once the paint bound covers painting only; why_new=Cycle 0033 B2 ceiling; seam=node:test setTimeout mock
test('an evidence navigation stuck before painting fails at the settle ceiling and the next recording open presents', async (context) => {
  // Arrange
  const harness = await articleRecordingLayoutHarness(true, true)
  const stuckDebugger = harness.holdHistoricalDebugPresentation()
  try {
    enableFakeClock(context)

    // Act
    const navigation = settleWithin(
      harness.reader.openRepositoryEvidence(
        harness.binding,
        true,
        undefined,
        harness.origin,
      ),
      PRESENTATION_SETTLE_CEILING_MS + 5_000,
    )
    let outcomeBeforeCeiling = 'still waiting for the debugger'
    void navigation.then((label) => {
      outcomeBeforeCeiling = label
    })
    await advanceClock(context, PRESENTATION_SETTLE_CEILING_MS - 250)
    const beforeCeiling = outcomeBeforeCeiling
    await advanceClockUntilSettled(context, navigation, 4_000)
    const outcome = await navigation
    resetFakeClock(context)
    stuckDebugger.reject(new Error('Playback presentation superseded'))
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()

    // Assert
    assert.equal(outcome, 'PRESENTATION_UNAVAILABLE')
    assert.equal(PRESENTATION_SETTLE_CEILING_MS, 23_000)
    assert.equal(beforeCeiling, 'still waiting for the debugger')
    assert.equal(harness.controller.state().readiness, 'ready')
  } finally {
    resetFakeClock(context)
    stuckDebugger.release()
    await harness.close()
  }
})

// Value: protects=a navigation whose first frame is superseded by a learner seek giving the newer frame its own full paint bound; fails_when=the paint bound is armed once per settle instead of per paint phase; why_new=Cycle 0033 A3 (eng review); seam=node:test setTimeout mock
test('a newer frame painted during an evidence navigation gets its own paint bound', async (context) => {
  // Arrange
  const harness = await articleRecordingLayoutHarness(true)
  const releases: Array<() => void> = []
  try {
    const firstPaint = harness.holdNextImage()
    releases.push(firstPaint.release)
    enableFakeClock(context)
    const navigation = settleWithin(
      harness.reader.openRepositoryEvidence(
        harness.binding,
        true,
        undefined,
        harness.origin,
      ),
      PRESENTATION_SETTLE_CEILING_MS + 1_500,
    )
    await advanceClockUntilSettled(context, firstPaint.started, 2_000)
    await advanceClock(context, 3_000)
    const seekPaint = harness.holdNextImage()
    releases.push(seekPaint.release)

    // Act
    harness.controller.command({
      action: 'seek',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
      positionMs: 150,
    })
    await advanceClockUntilSettled(context, seekPaint.started, 2_000)
    await advanceClock(context, 3_000)
    seekPaint.release()
    await advanceClockUntilSettled(context, navigation, 2_000)
    const outcome = await navigation
    resetFakeClock(context)
    await harness.controller.settle()

    // Assert: 6 s after the first paint began, the newer frame had painted for only 3 s, so no bound expired.
    assert.notEqual(outcome, 'PRESENTATION_UNAVAILABLE')
    assert.equal(harness.controller.state().presentedMs, 150)
    assert.equal(harness.controller.state().readiness, 'ready')
  } finally {
    resetFakeClock(context)
    for (const release of releases) release()
    await harness.close()
  }
})

// Value: protects=leaving an evidence navigation the learner cancelled while its frame paints, without reporting an unavailable presentation; fails_when=settleOwnedPlayback converts the caller's abort into PRESENTATION_UNAVAILABLE or keeps waiting; why_new=Cycle 0033 S7 (abort branch untested); seam=none
test('an evidence navigation cancelled while its frame paints ends with the cancellation, and the next recording open presents', async () => {
  // Arrange
  const harness = await articleRecordingLayoutHarness(true)
  const neverPainted = harness.holdNextImage()
  const cancellation = new AbortController()
  try {
    const navigation = settleWithin(
      harness.reader.openRepositoryEvidence(
        harness.binding,
        true,
        cancellation.signal,
        harness.origin,
      ),
      PRESENTATION_READY_TIMEOUT_MS,
    )
    await neverPainted.started

    // Act
    cancellation.abort(new Error('The learner left this evidence'))
    const outcome = await navigation
    neverPainted.release()
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()

    // Assert
    assert.notEqual(outcome, 'PRESENTATION_UNAVAILABLE')
    assert.notEqual(outcome, 'still waiting')
    assert.equal(harness.controller.state().readiness, 'ready')
  } finally {
    neverPainted.release()
    await harness.close()
  }
})

/**
 * Opens the Study layout on one saved study and saves a second one, so a test can choose it in Saved studies.
 * @returns The reader harness with the first study shown and the second study, which the Saved studies list holds.
 * @example const { harness, second } = await studyLayoutWithSecondSavedStudy()
 */
async function studyLayoutWithSecondSavedStudy() {
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  await openRetainedStudy(harness)
  const library = await harness.reader.learningStorage(),
    second = createConfiguredStudy(),
    runId = randomUUID()
  for (const observation of second.observations)
    observation.snapshotUri = observation.snapshotUri.replace(
      second.runId,
      runId,
    )
  second.workspaceKey = library.workspaceKey
  second.runId = runId
  second.id = `${second.instanceId}_${runId}`
  second.savedAt = '2026-09-20T00:00:01.000Z'
  await library.saveStudy(second)
  // Retry storage / refresh reloads the catalog the reader shows.
  await harness.reader.action('retry')
  return { harness, second }
}

// Value: protects=the maximized bottom panel of a learner who works through Saved studies (0038-N7-e); fails_when=a choice shows the study's source at once, which brings the hidden editor area back and takes the panel out of its maximized state, so the Saved studies section leaves the view; why_new=native run of 2026-10-04 (two choices, c05-chosen-7s.png, c08-chosen2.png); seam=workspace harness with a maximized bottom panel
test('choosing another saved study while the bottom panel is maximized leaves the panel maximized and shows the chosen study in it', async () => {
  // Arrange
  const { harness, second } = await studyLayoutWithSecondSavedStudy()
  try {
    harness.maximizePanel()

    // Act: the learner chooses the other entry in the panel's Saved studies list, and the reader's timer runs once.
    await readerSeams(harness).receive(
      {
        type: 'history',
        revision: harness.reader.inspect().view!.revision,
        studyId: second.id,
      },
      'moments',
    )
    await readerSeams(harness).refresh()

    // Assert
    const view = harness.reader.inspect().view!
    assert.equal(harness.isPanelMaximized(), true)
    assert.equal(view.model.selection.studyId, second.id)
    assert.equal(view.loading, false)
    assert.equal(view.errors.join(' | '), '')
  } finally {
    await harness.close()
  }
})

// Value: protects=the Application group's height and the confirmed layout after a Saved studies choice made with the bottom panel maximized (0039-N8-b / 0040-N9-img); fails_when=the choice reveals the source into the hidden editor area, where the editor expands the source group: the Application group stays a 70 px strip and the layout is unconfirmed after the panel is restored; why_new=native run of 2026-10-04 (c08-chosen2.png, c09-crop.png: strip, layoutConfirmed false); seam=workspace harness with a maximized bottom panel
test('after a saved study was chosen with the bottom panel maximized, restoring the panel shows that study with the Application group at its normal height and the layout confirmed', async () => {
  // Arrange
  const { harness, second } = await studyLayoutWithSecondSavedStudy()
  try {
    const applicationHeightBefore = harness.groupHeightPx(1)
    harness.maximizePanel()
    await readerSeams(harness).receive(
      {
        type: 'history',
        revision: harness.reader.inspect().view!.revision,
        studyId: second.id,
      },
      'moments',
    )
    const confirmedWhileMaximized = (
      await harness.reader.readPresentationState()
    ).layoutConfirmed

    // Act: the learner restores the panel, and the reader's timer runs once.
    harness.restorePanel()
    await readerSeams(harness).refresh()

    // Assert
    const state = await harness.reader.readPresentationState()
    assert.equal(applicationHeightBefore, 420)
    assert.equal(confirmedWhileMaximized, true)
    assert.equal(harness.groupHeightPx(1), 420)
    assert.equal(state.layoutConfirmed, true)
    assert.equal(state.reason, undefined)
    assert.equal(harness.reader.inspect().sourceUri!.includes(second.id), true)
    assert.equal(harness.reader.inspect().view!.loading, false)
  } finally {
    await harness.close()
  }
})

// Value: protects=the editor being asked for its layout once at a time while a saved study waits for the hidden editor area; fails_when=every 250 ms refresh sends another layout request while the one before it is still unanswered; why_new=Cycle 0045 SP-6 (read from code: `showStudyAwaitingEditorArea` asked on every tick, with no guard against a request in flight); seam=the workspace harness holding one editor command, the reader's refresh
test('while a saved study waits for the hidden editor area, a refresh that finds a layout request unanswered sends no second one', async (context) => {
  // Arrange: a saved study was chosen with the bottom panel maximized; the editor does not answer the next layout request.
  const { harness, second } = await studyLayoutWithSecondSavedStudy()
  try {
    harness.maximizePanel()
    await readerSeams(harness).receive(
      {
        type: 'history',
        revision: harness.reader.inspect().view!.revision,
        studyId: second.id,
      },
      'moments',
    )
    const layoutRequestsBefore = harness.commands.filter(
      (command) => command === 'vscode.getEditorLayout',
    ).length
    const unanswered = harness.holdNextCommand('vscode.getEditorLayout')

    // Act: the reader's timer runs again two seconds later, and the editor still has not answered the first request.
    const startedAtMs = performance.now()
    let waitedMs = 0
    context.mock.method(performance, 'now', () => startedAtMs + waitedMs)
    const firstTick = readerSeams(harness).refresh()
    await unanswered.started
    waitedMs = 2_000
    await readerSeams(harness).refresh()
    const layoutRequestsWhileUnanswered =
      harness.commands.filter((command) => command === 'vscode.getEditorLayout')
        .length - layoutRequestsBefore
    unanswered.release()
    await firstTick

    // Assert
    assert.equal(layoutRequestsWhileUnanswered, 1)
    assert.equal(harness.isPanelMaximized(), true)
    assert.equal(harness.reader.inspect().view!.errors.join(' | '), '')
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=a saved study chosen with the bottom panel maximized being shown whenever the learner brings the editor area back, however late, while the editor is asked for its layout at most once a second meanwhile; fails_when=the wait gets an end bound and the learner has to choose the study again, or every 250 ms refresh asks the editor; why_new=Cycle 0045 SP-6 as DR-10 (the wait has no end bound, only the polling is bounded); seam=the workspace harness, the reader's refresh, and performance.now() moved by the test
test('a saved study chosen with the bottom panel maximized is shown when the panel is restored ten minutes later', async (context) => {
  // Arrange
  const { harness, second } = await studyLayoutWithSecondSavedStudy()
  try {
    harness.maximizePanel()
    await readerSeams(harness).receive(
      {
        type: 'history',
        revision: harness.reader.inspect().view!.revision,
        studyId: second.id,
      },
      'moments',
    )
    const startedAtMs = performance.now()
    let waitedMs = 0
    context.mock.method(performance, 'now', () => startedAtMs + waitedMs)
    /** Runs the reader's timer once at a moment of the wait and counts the layout requests it sent. */
    const layoutRequestsOfTickAt = async (atMs: number): Promise<number> => {
      waitedMs = atMs
      const before = harness.commands.filter(
        (command) => command === 'vscode.getEditorLayout',
      ).length
      await readerSeams(harness).refresh()
      return (
        harness.commands.filter(
          (command) => command === 'vscode.getEditorLayout',
        ).length - before
      )
    }

    // Act: four ticks of the first second, one a second later, and one ten minutes after the choice, when the learner has restored the panel.
    const requestsInTheFirstSecond = [
      await layoutRequestsOfTickAt(0),
      await layoutRequestsOfTickAt(250),
      await layoutRequestsOfTickAt(500),
      await layoutRequestsOfTickAt(750),
    ]
    const requestsAfterOneSecond = await layoutRequestsOfTickAt(1_000)
    const shownWhileMaximized = harness.reader
      .inspect()
      .sourceUri?.includes(second.id)
    harness.restorePanel()
    waitedMs = 600_000
    await readerSeams(harness).refresh()

    // Assert
    assert.deepEqual(requestsInTheFirstSecond, [1, 0, 0, 0])
    assert.equal(requestsAfterOneSecond, 1)
    assert.equal(shownWhileMaximized, false)
    assert.equal(harness.reader.inspect().sourceUri!.includes(second.id), true)
    assert.equal(harness.reader.inspect().view!.loading, false)
    assert.equal(harness.reader.inspect().view!.errors.join(' | '), '')
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=the Application group's height after a recorded seek made with the bottom panel maximized (0039-N8-b / 0040-N9-img, second occurrence); fails_when=the seek reveals its source into the hidden editor area, the editor expands the source group and brings the area back, and nothing gives the Application group its height back: it stays a 70 px strip with the layout unconfirmed until Restore; why_new=native run of 2026-10-04 (u18-max-seek.png, repaired only by Restore, u25-restored.png); seam=workspace harness with a maximized bottom panel
test('a recorded seek made while the bottom panel is maximized leaves the Application group at its normal height and the layout confirmed', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    const applicationHeightBefore = harness.groupHeightPx(1),
      confirmedBefore = (await harness.reader.readPresentationState())
        .layoutConfirmed
    harness.maximizePanel()

    // Act
    harness.controller.command({
      action: 'seek',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
      positionMs: 100,
    })
    await harness.controller.settle()

    // Assert
    const state = await harness.reader.readPresentationState()
    assert.equal(applicationHeightBefore, 420)
    assert.equal(confirmedBefore, true)
    assert.equal(harness.controller.state().readiness, 'ready')
    // The editor itself brings the hidden editor area back for the recorded source.
    assert.equal(harness.isPanelMaximized(), false)
    assert.equal(harness.groupHeightPx(1), 420)
    assert.equal(state.layoutConfirmed, true)
  } finally {
    await harness.close()
  }
})

/**
 * Opens a fake editor whose editor area holds two stacked groups, the window in which VS Code 1.140.0 was observed bringing a hidden editor area back; the tests of the fake editor's own triggers start here.
 * @returns The harness with a reader that is not open: the first group shows `article-source.ts`, the second group lies below it, and each is 420 px high.
 * @example const harness = await twoStackedGroupsEditor(); harness.maximizePanel()
 */
async function twoStackedGroupsEditor() {
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({
    orientation: 1,
    groups: [{ size: 0.5 }, { size: 0.5 }],
  })
  return harness
}

// Value: protects=reader tests with a maximized bottom panel meeting the editor as it is when a pane is created behind the panel; fails_when=the fake editor keeps the editor area hidden for a new webview panel, so a product change that creates a pane while the panel is maximized passes although VS Code takes the panel out of its maximized state; why_new=Cycle 0045 D-M2 (VS Code 1.140.0 on 2026-10-04: the area returned for a panel created without focus, rows 70 px and the rest); seam=the workspace harness's fake editor
test('the fake editor brings the editor area back for every trigger VS Code brings it back for: a webview panel created without the keyboard focus', async () => {
  // Arrange
  const harness = await twoStackedGroupsEditor()
  try {
    harness.maximizePanel()

    // Act
    harness.editor.window.createWebviewPanel('qa.probe', 'QA probe', {
      viewColumn: 2,
      preserveFocus: true,
    })

    // Assert
    assert.equal(harness.isPanelMaximized(), false)
    assert.equal(harness.groupHeightPx(1), 70)
    assert.equal(harness.groupHeightPx(2), 770)
  } finally {
    await harness.close()
  }
})

// Value: protects=reader tests with a maximized bottom panel meeting the editor as it is when a pane is created with the focus; fails_when=the fake editor keeps the editor area hidden for a new webview panel that takes the focus; why_new=Cycle 0045 D-M2 (VS Code 1.140.0 on 2026-10-04: the area returned for a panel created with focus, rows 70 px and the rest); seam=the workspace harness's fake editor
test('the fake editor brings the editor area back for every trigger VS Code brings it back for: a webview panel created with the keyboard focus', async () => {
  // Arrange
  const harness = await twoStackedGroupsEditor()
  try {
    harness.maximizePanel()

    // Act
    harness.editor.window.createWebviewPanel('qa.probe', 'QA probe', {
      viewColumn: 2,
      preserveFocus: false,
    })

    // Assert
    assert.equal(harness.isPanelMaximized(), false)
    assert.equal(harness.groupHeightPx(1), 70)
    assert.equal(harness.groupHeightPx(2), 770)
  } finally {
    await harness.close()
  }
})

// Value: protects=reader tests with a maximized bottom panel meeting the editor as it is when the reader focuses the first group; fails_when=the fake editor keeps the editor area hidden for the focus-first-group command, so a focus hand-off behind a maximized panel passes although VS Code brings the area back with the first group as a 70 px strip; why_new=Cycle 0045 D-M2 (VS Code 1.140.0 on 2026-10-04: the area returned, the focused first row 70 px and the second 617 px); seam=the workspace harness's fake editor
test('the fake editor brings the editor area back for every trigger VS Code brings it back for: the command that focuses the first editor group', async () => {
  // Arrange
  const harness = await twoStackedGroupsEditor()
  try {
    harness.maximizePanel()

    // Act
    await harness.editor.commands.executeCommand(
      'workbench.action.focusFirstEditorGroup',
    )

    // Assert
    assert.equal(harness.isPanelMaximized(), false)
    assert.equal(harness.groupHeightPx(1), 70)
    assert.equal(harness.groupHeightPx(2), 770)
  } finally {
    await harness.close()
  }
})

// Value: protects=reader tests with a maximized bottom panel meeting the editor as it is when the reader focuses the group that is already the active one; fails_when=the fake editor keeps the area hidden for that command, or brings it back with the first group as a 70 px strip as it does for a command that activates another group, so a focus hand-off that leaves the rows as they were looks like a collapse; why_new=Cycle 0045 D-M2, open again after the second native round (VS Code 1.140.0 on 2026-10-04, owed check 5: the area returned with the rows at 344 and 343 px, the sizes they had before the panel was maximized); seam=the workspace harness's fake editor
test('the fake editor brings the editor area back for every trigger VS Code brings it back for: the command that focuses the active editor group', async () => {
  // Arrange
  const harness = await twoStackedGroupsEditor()
  try {
    harness.maximizePanel()

    // Act
    await harness.editor.commands.executeCommand(
      'workbench.action.focusActiveEditorGroup',
    )

    // Assert: the rows have the heights they had before the panel was maximized.
    assert.equal(harness.isPanelMaximized(), false)
    assert.equal(harness.groupHeightPx(1), 420)
    assert.equal(harness.groupHeightPx(2), 420)
  } finally {
    await harness.close()
  }
})

// Value: protects=reader tests with a maximized bottom panel meeting the editor as it is when the reader applies a layout; fails_when=the fake editor keeps the editor area hidden for vscode.setEditorLayout, so an arrangement made behind a maximized panel passes although VS Code brings the area back; why_new=Cycle 0045 D-M2 (VS Code 1.140.0 on 2026-10-04: the area returned for a layout of the same shape, with the sizes of that layout); seam=the workspace harness's fake editor
test('the fake editor brings the editor area back for every trigger VS Code brings it back for: an editor layout of the same shape', async () => {
  // Arrange
  const harness = await twoStackedGroupsEditor()
  try {
    harness.maximizePanel()

    // Act
    await harness.editor.commands.executeCommand('vscode.setEditorLayout', {
      orientation: 1,
      groups: [{ size: 0.5 }, { size: 0.5 }],
    })

    // Assert
    assert.equal(harness.isPanelMaximized(), false)
    assert.equal(harness.groupHeightPx(1), 420)
    assert.equal(harness.groupHeightPx(2), 420)
  } finally {
    await harness.close()
  }
})

// Value: protects=reader tests with a maximized bottom panel meeting the editor as it is when the reader applies another layout; fails_when=the fake editor keeps the editor area hidden for a vscode.setEditorLayout that changes the shape of the grid; why_new=Cycle 0045 D-M2 (VS Code 1.140.0 on 2026-10-04: the area returned for two columns in place of two rows, both columns at the full height); seam=the workspace harness's fake editor
test('the fake editor brings the editor area back for every trigger VS Code brings it back for: an editor layout of another shape', async () => {
  // Arrange
  const harness = await twoStackedGroupsEditor()
  try {
    harness.maximizePanel()

    // Act
    await harness.editor.commands.executeCommand('vscode.setEditorLayout', {
      orientation: 0,
      groups: [{ size: 0.5 }, { size: 0.5 }],
    })

    // Assert
    assert.equal(harness.isPanelMaximized(), false)
    assert.equal(harness.groupHeightPx(1), 840)
    assert.equal(harness.groupHeightPx(2), 840)
  } finally {
    await harness.close()
  }
})

// Value: protects=reader tests with a maximized bottom panel meeting the editor as it is when the reader closes the tab a group shows; fails_when=the fake editor keeps the editor area hidden for a close of a group's active tab, so a tab the reader closes behind a maximized panel passes although VS Code brings the area back; why_new=Cycle 0045 D-M2 (VS Code 1.140.0 on 2026-10-04: the area returned when the API closed the active tab of the first group, rows 70 px and the rest); seam=the workspace harness's fake editor
test('the fake editor brings the editor area back for every trigger VS Code brings it back for: a close request for the tab a group shows', async () => {
  // Arrange: the first group holds a second tab behind the one it shows.
  const harness = await twoStackedGroupsEditor()
  try {
    const shownTab = harness.groups.find(
      (group) => group.viewColumn === 1,
    )!.activeTab!
    harness.addTextPreview(join(harness.directory, 'second-source.ts'), 1)
    harness.maximizePanel()

    // Act
    const closed = await harness.editor.window.tabGroups.close([shownTab])

    // Assert
    assert.equal(closed, true)
    assert.equal(harness.isPanelMaximized(), false)
    assert.equal(harness.groupHeightPx(1), 70)
    assert.equal(harness.groupHeightPx(2), 770)
  } finally {
    await harness.close()
  }
})

// Value: protects=reader tests with a maximized bottom panel meeting the editor as it is when the learner closes the editor in front; fails_when=the fake editor has no Close Editor command or keeps the editor area hidden for it; why_new=Cycle 0045 D-M2 (VS Code 1.140.0 on 2026-10-04: the area returned for workbench.action.closeActiveEditor in the first group, rows 70 px and the rest); seam=the workspace harness's fake editor
test('the fake editor brings the editor area back for every trigger VS Code brings it back for: the Close Editor command', async () => {
  // Arrange: the focused first group holds a second tab behind the one it shows.
  const harness = await twoStackedGroupsEditor()
  try {
    const firstGroup = harness.groups.find((group) => group.viewColumn === 1)!,
      shownTab = firstGroup.activeTab!
    harness.addTextPreview(join(harness.directory, 'second-source.ts'), 1)
    harness.maximizePanel()

    // Act
    await harness.editor.commands.executeCommand(
      'workbench.action.closeActiveEditor',
    )

    // Assert
    assert.equal(firstGroup.tabs.includes(shownTab), false)
    assert.equal(harness.isPanelMaximized(), false)
    assert.equal(harness.groupHeightPx(1), 70)
    assert.equal(harness.groupHeightPx(2), 770)
  } finally {
    await harness.close()
  }
})

// Value: protects=the trigger the fake editor already had, kept with the sizes VS Code gives the returned area; fails_when=a revealed pane no longer brings the hidden editor area back; why_new=Cycle 0045 D-M2 (the case of the revealed pane beside the new triggers, so the whole set is pinned); seam=the workspace harness's fake editor
test('the fake editor brings the editor area back for every trigger VS Code brings it back for: a webview panel revealed with the keyboard focus', async () => {
  // Arrange
  const harness = await twoStackedGroupsEditor()
  try {
    const probe = harness.editor.window.createWebviewPanel(
      'qa.probe',
      'QA probe',
      { viewColumn: 2, preserveFocus: true },
    )
    harness.maximizePanel()

    // Act
    probe.reveal(2, false)

    // Assert
    assert.equal(harness.isPanelMaximized(), false)
    assert.equal(harness.groupHeightPx(1), 70)
    assert.equal(harness.groupHeightPx(2), 770)
  } finally {
    await harness.close()
  }
})

// Value: protects=the trigger the fake editor already had, kept with the sizes VS Code gives the returned area; fails_when=a text document shown in a group no longer brings the hidden editor area back; why_new=Cycle 0045 D-M2 (the case of the shown document beside the new triggers, so the whole set is pinned); seam=the workspace harness's fake editor
test('the fake editor brings the editor area back for every trigger VS Code brings it back for: a text document shown in a group', async () => {
  // Arrange
  const harness = await twoStackedGroupsEditor()
  try {
    harness.maximizePanel()

    // Act
    await harness.editor.window.showTextDocument(
      {
        uri: harness.editor.Uri.file(join(harness.directory, 'shown.ts')),
        getText: () => '',
      },
      { viewColumn: 2, preserveFocus: true },
    )

    // Assert
    assert.equal(harness.isPanelMaximized(), false)
    assert.equal(harness.groupHeightPx(1), 70)
    assert.equal(harness.groupHeightPx(2), 770)
  } finally {
    await harness.close()
  }
})

/**
 * Opens a fake editor with one group in the first row and two groups side by side in the second, the last of them empty; the tests of an emptied group's removal start here.
 * @returns The harness with a reader that is not open and three native groups: column 1 above columns 2 and 3.
 * @example const harness = await twoRowEditorWithSplitSecondRow()
 */
async function twoRowEditorWithSplitSecondRow() {
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({
    orientation: 1,
    groups: [
      { size: 0.5 },
      { size: 0.5, groups: [{ size: 0.5 }, { size: 0.5 }] },
    ],
  })
  return harness
}

// Value: protects=reader tests after a closed dead pane seeing the grid the editor leaves; fails_when=the fake editor rebuilds the grid as columns when a tab close empties a group, so two rows become two columns in one path and stay rows in another; why_new=Cycle 0045 D-M4 (three copies of the removal of an emptied group gave different layouts); seam=the workspace harness's fake editor
test('a group emptied by a tab close in a two-row layout leaves the same layout as one emptied by a disposed pane', async () => {
  // Arrange: in each editor the third group, beside the second in the lower row, holds one pane.
  const closedByRequest = await twoRowEditorWithSplitSecondRow(),
    closedByDisposal = await twoRowEditorWithSplitSecondRow()
  try {
    const deadPane = closedByRequest.leaveDeadCodebookPane(
      'codebook.studyContext',
      3,
    )
    closedByDisposal.closeDisposedPanelTabsLater()
    const disposedPane = closedByDisposal.editor.window.createWebviewPanel(
      'qa.probe',
      'QA probe',
      { viewColumn: 3, preserveFocus: true },
    )

    // Act: one pane's tab is closed by request; the other pane is disposed and the editor closes its tab after the next layout read.
    await closedByRequest.editor.window.tabGroups.close([deadPane])
    disposedPane.dispose()
    await closedByDisposal.editor.commands.executeCommand(
      'vscode.getEditorLayout',
    )
    await new Promise<void>((resolve) => setImmediate(resolve))

    // Assert
    assert.equal(closedByRequest.groups.length, 2)
    assert.equal(closedByDisposal.groups.length, 2)
    assert.deepEqual(closedByRequest.editorLayout(), {
      orientation: 1,
      groups: [{ size: 0.5 }, { size: 0.5 }],
    })
    assert.deepEqual(closedByDisposal.editorLayout(), {
      orientation: 1,
      groups: [{ size: 0.5 }, { size: 0.5 }],
    })
  } finally {
    await closedByRequest.close()
    await closedByDisposal.close()
  }
})

// Value: protects=reader tests in Cursor after an extension-host restart that left dead panes in two groups: the fake editor ends with the groups the editor ends with; fails_when=the fake Cursor removes the first emptied group, answers that removal with new group objects and then no longer finds the second emptied group, which stays as an empty group no editor would keep; why_new=local CodeRabbit review of Cycle 0045 (the loop held the group objects of before the first removal); seam=none
test('the fake Cursor removes every group that dead panes leave empty in one close, although each removal gives the remaining groups new objects', async () => {
  // Arrange: four native groups side by side; the third and the fourth hold one dead pane each, and the editor answers tab changes as Cursor does.
  const harness = await workspaceHarness(false)
  try {
    harness.useNativeLayout({
      orientation: 0,
      groups: [{ size: 0.25 }, { size: 0.25 }, { size: 0.25 }, { size: 0.25 }],
    })
    const deadApplication = harness.leaveDeadCodebookPane(
        'codebook.scopedBrowser',
        3,
      ),
      deadStudy = harness.leaveDeadCodebookPane('codebook.studyContext', 4)
    harness.replaceGroupObjectsOnTabChanges()
    const groupsBefore = harness.groups.map((group) => ({
      column: group.viewColumn,
      tabs: group.tabs.length,
    }))

    // Act: one request closes both dead panes.
    await harness.editor.window.tabGroups.close([deadApplication, deadStudy])

    // Assert: both emptied groups are gone, and the two groups that stay keep their columns.
    assert.deepEqual(
      groupsBefore.map((group) => group.column),
      [1, 2, 3, 4],
    )
    assert.deepEqual(
      harness.groups.map((group) => group.viewColumn),
      [1, 2],
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=reader tests after a moved pane seeing the grid the editor leaves; fails_when=the fake editor rebuilds the grid as columns when a pane's move empties its group, so two rows become two columns; why_new=Cycle 0045 D-M4 (the pane-move copy of the removal of an emptied group flattened the layout too); seam=the workspace harness's fake editor
test('a group emptied by a moved pane in a two-row layout leaves the same layout as one emptied by a disposed pane', async () => {
  // Arrange: the third group, beside the second in the lower row, holds one pane.
  const harness = await twoRowEditorWithSplitSecondRow()
  try {
    harness.closeEmptyGroupsAfterPanelMove()
    const movedPane = harness.editor.window.createWebviewPanel(
      'qa.probe',
      'QA probe',
      { viewColumn: 3, preserveFocus: true },
    )

    // Act
    movedPane.reveal(1, true)

    // Assert
    assert.deepEqual(harness.automaticallyClosedColumns(), [3])
    assert.equal(harness.groups.length, 2)
    assert.deepEqual(harness.editorLayout(), {
      orientation: 1,
      groups: [{ size: 0.5 }, { size: 0.5 }],
    })
  } finally {
    await harness.close()
  }
})

/**
 * Opens a recording in an editor that behaves like Cursor 3.23.12: the Agent chat is a tab of its own editor part, and every tab that opens, closes or comes to the front gives all editor groups new objects.
 * @returns The recorded reader harness with the recording at its first position and the chat part.
 * @example const { harness, chat } = await recordingInCursor()
 */
async function recordingInCursor() {
  const harness = await recordedReaderHarness(true)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  const chat = harness.addSeparateEditorPart()
  harness.replaceGroupObjectsOnTabChanges()
  await harness.reader.openRecording(harness.studyId)
  await harness.controller.settle()
  return { harness, chat }
}

// Value: protects=the confirmed layout of a recording in Cursor across a seek that shows another source tab; fails_when=the group objects Cursor replaces with that tab change count as other groups (the Agent chat's group holds no tab Codebook knows), so the next status read answers layoutConfirmed false with "The Study arrangement is not confirmed. …" although no pixel of the grid changed; why_new=Cycle 0045 NF-5, normal panel height (observed on candidate 13: 2 of 2 seeks that changed the source tab); seam=workspace harness with a separate editor part and the fake editor's group object replacement
test('a recorded seek in Cursor that shows another source tab leaves the layout confirmed', async () => {
  // Arrange
  const { harness, chat } = await recordingInCursor()
  try {
    const before = await harness.reader.readPresentationState(),
      sourceBefore = harness.reader.inspect().sourceUri,
      groupsBefore = [...harness.groups],
      layoutBefore = harness.editorLayout()

    // Act
    harness.controller.command({
      action: 'seek',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
      positionMs: 100,
    })
    await harness.controller.settle()

    // Assert
    const state = await harness.reader.readPresentationState()
    assert.equal(before.layoutConfirmed, true)
    assert.equal(harness.controller.state().readiness, 'ready')
    // The seek showed another source tab, and the editor answered it with new group objects in the same columns and the same grid.
    assert.notEqual(harness.reader.inspect().sourceUri, sourceBefore)
    assert.equal(
      harness.groups.some((group) => groupsBefore.includes(group)),
      false,
    )
    assert.deepEqual(harness.editorLayout(), layoutBefore)
    assert.equal(state.layoutConfirmed, true)
    assert.equal(state.reason, undefined)
    assert.equal(
      harness.groups.find((group) => group.tabs.includes(chat.tab))?.viewColumn,
      3,
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the Application group's height after a recorded seek made in Cursor with the bottom panel maximized; fails_when=the seek brings the hidden editor area back with the Application group at its 70 px minimum and the confirmed grid is not applied again, because the group objects Cursor replaced no longer count as the confirmed groups: a strip and layoutConfirmed false until Restore; why_new=Cycle 0045 NF-5, maximized panel (observed on candidate 13: 70 / 587 after 2 of 2 seeks); seam=workspace harness with a maximized bottom panel, a separate editor part and the fake editor's group object replacement
test('a recorded seek made in Cursor while the bottom panel is maximized leaves the Application group at its normal height and the layout confirmed', async () => {
  // Arrange
  const { harness } = await recordingInCursor()
  try {
    const applicationHeightBefore = harness.groupHeightPx(1),
      confirmedBefore = (await harness.reader.readPresentationState())
        .layoutConfirmed
    harness.maximizePanel()

    // Act
    harness.controller.command({
      action: 'seek',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
      positionMs: 100,
    })
    await harness.controller.settle()

    // Assert
    const state = await harness.reader.readPresentationState()
    assert.equal(applicationHeightBefore, 420)
    assert.equal(confirmedBefore, true)
    assert.equal(harness.controller.state().readiness, 'ready')
    assert.equal(harness.isPanelMaximized(), false)
    assert.equal(harness.groupHeightPx(1), 420)
    assert.equal(state.layoutConfirmed, true)
    assert.equal(state.reason, undefined)
  } finally {
    await harness.close()
  }
})

// Value: protects=Restore of a recording's layout in Cursor ending confirmed although the editor names the Application group as the active group for one event while Codebook measures the main editor; fails_when=that announced detour of the focus is read as the learner choosing another tab, and Restore ends with "The learner changed native tab focus while the Study layout command was pending. The newer choice was preserved."; why_new=Cycle 0045 NF-7 (Cycle 0044 saw 2 of 5 presses fail; on candidate 13 six of six presses were confirmed, each with the Application group active for 25 to 46 ms before the source group); seam=workspace harness with a separate editor part, the fake editor's group object replacement and its split focus notifications
test('Restore in Recording is confirmed when Cursor reports another active group for one event while the layout is applied', async () => {
  // Arrange: the recorded source has the keyboard focus; the editor reports a group's activation before the text editor that goes with it.
  const { harness } = await recordingInCursor()
  try {
    harness.usePrimaryFocusNotificationOrder('group first')
    await harness.reader.action('source')
    const state = harness.reader.presentationState(),
      focusedBefore = harness.editor.window.tabGroups.activeTabGroup.viewColumn,
      commandsBefore = harness.commands.length

    // Act
    const restored = await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'restore',
    })

    // Assert
    assert.equal(focusedBefore, 2)
    // The measurement focused the first group, where the Application pane is, and gave the focus back to the source.
    assert.equal(
      harness.commands
        .slice(commandsBefore)
        .includes('workbench.action.focusFirstEditorGroup'),
      true,
    )
    assert.equal(harness.editor.window.tabGroups.activeTabGroup.viewColumn, 2)
    assert.equal(restored.layoutConfirmed, true)
    assert.equal(restored.reason, undefined)
    assert.equal(harness.reader.inspect().view!.errors.join(' | '), '')
  } finally {
    await harness.close()
  }
})

for (const [change, changedPart] of [
  [
    'the grid changed',
    'the editor grid no longer has the sizes of the confirmed layout',
  ],
  [
    'an editor group was replaced',
    'an editor group was opened, closed, moved or replaced since the layout was confirmed',
  ],
] as const)
  // Value: protects=a learner or an agent reading, after a status read unconfirmed the Study layout, which comparison failed; fails_when=the reason is the same sentence for a resized grid and for a replaced editor group, so a report of an unconfirmed layout does not say what changed; why_new=Cycle 0045 NF-5 (in Cursor nobody could tell from "The Study arrangement is not confirmed. …" that no pixel of the grid had changed); seam=workspace harness with the fake editor
  test(`a status read after ${change} says which part of the confirmed layout differs`, async () => {
    // Arrange
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    try {
      await harness.reader.open()
      const before = await harness.reader.readPresentationState()
      if (change === 'the grid changed')
        harness.changeEditorLayout({
          orientation: 0,
          groups: [
            { size: 0.3, groups: [{ size: 0.5 }, { size: 0.5 }] },
            { size: 0.7 },
          ],
        })
      else harness.replaceEditorGroup('opened', 1)

      // Act
      const state = await harness.reader.readPresentationState()

      // Assert
      assert.equal(before.layoutConfirmed, true)
      assert.equal(before.reason, undefined)
      assert.equal(state.layoutConfirmed, false)
      assert.equal(
        state.reason,
        `The Study arrangement is not confirmed: ${changedPart}. Focus the existing Study or Application pane, then restore its layout. Opening Repository Wiki does not repair Study.`,
      )
    } finally {
      await harness.close()
    }
  })

for (const keyboard of ['in the chat input', "on the chat's tab"] as const) {
  // Value: protects=an agent that reads the presentation state after its own select, from the chat, being told the layout it just got confirmed still stands; fails_when=the read answers layoutConfirmed false with "Main editor layout could not be checked without changing focus. …" although no tab or group changed since the arrangement, so the agent reports the layout as unconfirmed or restores it again; why_new=Cycle 0045 finding S1a-F1 (first part of package S1); seam=workspace harness with a separate editor part that has the keyboard
  test(`a status read made while the chat has the focus answers the confirmation of the last arrangement when nothing changed since (keyboard ${keyboard})`, async () => {
    // Arrange: the Study layout is confirmed; then the keyboard is in Cursor's chat part, where a layout read is answered for that part.
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    const chat = harness.addSeparateEditorPart()
    try {
      await harness.reader.open()
      const arranged = await harness.reader.readPresentationState()
      if (keyboard === 'in the chat input') chat.focus()
      else chat.focusTab()
      const commandsBefore = harness.commands.length

      // Act
      const state = await harness.reader.readPresentationState()

      // Assert
      assert.equal(arranged.layoutConfirmed, true)
      assert.equal(arranged.layoutMeasured, undefined)
      assert.equal(state.layoutConfirmed, true)
      assert.equal(state.layoutMeasured, false)
      assert.equal(state.reason, undefined)
      // The read took no focus: it sent the one layout request, and the chat still has the keyboard.
      assert.deepEqual(harness.commands.slice(commandsBefore), [
        'vscode.getEditorLayout',
      ])
      assert.equal(chat.focused(), true)
    } finally {
      await harness.close()
    }
  })

  // Value: protects=the same read not certifying a layout that changed while it could not be measured; fails_when=a group that opened since the arrangement is answered with the old confirmation; why_new=Cycle 0045 finding S1a-F1, the counterpart of the case above; seam=workspace harness with a separate editor part that has the keyboard, replaceEditorGroup
  test(`a status read made while the chat has the focus answers that the layout is not confirmed after a group changed since the last arrangement (keyboard ${keyboard})`, async () => {
    // Arrange
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    const chat = harness.addSeparateEditorPart()
    try {
      await harness.reader.open()
      const arranged = await harness.reader.readPresentationState()
      if (keyboard === 'in the chat input') chat.focus()
      else chat.focusTab()
      harness.replaceEditorGroup('opened', 1)

      // Act
      const state = await harness.reader.readPresentationState()

      // Assert
      assert.equal(arranged.layoutConfirmed, true)
      assert.equal(state.layoutConfirmed, false)
      assert.equal(state.layoutMeasured, undefined)
      assert.equal(
        state.reason,
        'Main editor layout could not be checked without changing focus. Focus a Codebook pane or main text editor and read again.',
      )
    } finally {
      await harness.close()
    }
  })
}

// Value: protects=the Application group's height after a recorded seek made with the bottom panel maximized while the layout was no longer confirmed; fails_when=only a confirmed layout is given its grid back, so the returned editor area leaves the Application group a 70 px strip above the source until Restore; why_new=Cycle 0045 NF-5 with PC-1.1 (the second maximized seek of the observation: the first had left the layout unconfirmed); seam=workspace harness with a maximized bottom panel
test('a recorded seek made while the bottom panel is maximized gives a collapsed Application group its height back also when the layout was no longer confirmed', async () => {
  // Arrange: a status read found the grid resized, so the recording's layout is unconfirmed; then the learner maximizes the bottom panel.
  const harness = await recordedReaderHarness(true)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    harness.changeEditorLayout({
      orientation: 1,
      groups: [{ size: 0.4 }, { size: 0.6 }],
    })
    const unconfirmed = await harness.reader.readPresentationState(),
      applicationHeightBefore = harness.groupHeightPx(1)
    harness.maximizePanel()

    // Act
    harness.controller.command({
      action: 'seek',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
      positionMs: 100,
    })
    await harness.controller.settle()

    // Assert
    assert.equal(unconfirmed.layoutConfirmed, false)
    assert.equal(applicationHeightBefore, 336)
    assert.equal(harness.controller.state().readiness, 'ready')
    assert.equal(harness.isPanelMaximized(), false)
    // The last confirmed grid is applied again: the Application group is no strip of 70 px.
    assert.equal(harness.groupHeightPx(1), 420)
  } finally {
    await harness.close()
  }
})

for (const command of [
  'Arrange Study Workspace',
  'Open Study Workspace',
] as const)
  for (const layout of ['a recording', 'the Study layout'] as const)
    // Value: protects=the two commands a learner reaches for when the Application pane is a strip giving that pane its height back; fails_when=Arrange restores without applying a grid, or Open returns because a layout receipt of the same mode exists, so the Application group stays at the 70 px of its tab row above a tall source; why_new=Cycle 0045 NF-10 with PC-1.1 (Cursor: neither command repaired the collapse a maximized seek left; the collapse is that of the Application group alone, the source group is tall); seam=workspace harness with a native layout whose rows the test sets in pixels
    test(`${command} gives a collapsed Application group its normal height, in ${layout}`, async () => {
      // Arrange: the editor area is visible; the Application group sits at the height of its tab row above a tall source group, as a maximized bottom panel leaves it when it is restored.
      const harness = await recordedReaderHarness(true)
      harness.useNativeLayout({ orientation: 0, groups: [{}] })
      try {
        if (layout === 'a recording') {
          await harness.reader.openRecording(harness.studyId)
          await harness.controller.settle()
        } else await harness.reader.open()
        const arranged = await harness.reader.readPresentationState(),
          applicationHeightArranged = harness.groupHeightPx(1)
        harness.maximizePanel()
        await harness.editor.commands.executeCommand(
          'workbench.action.focusFirstEditorGroup',
        )
        const collapsed = {
          application: harness.groupHeightPx(1),
          source: harness.groupHeightPx(2),
        }

        // Act
        if (command === 'Arrange Study Workspace')
          await harness.reader.action('arrange')
        else await harness.reader.open()

        // Assert
        const state = await harness.reader.readPresentationState()
        assert.equal(arranged.layoutConfirmed, true)
        assert.equal(applicationHeightArranged, 420)
        assert.deepEqual(collapsed, { application: 70, source: 770 })
        assert.equal(harness.reader.inspect().view!.errors.join(' | '), '')
        assert.equal(harness.groupHeightPx(1), 420)
        assert.equal(harness.groupHeightPx(2), 420)
        assert.equal(state.layoutConfirmed, true)
        assert.equal(state.reason, undefined)
      } finally {
        await harness.close()
      }
    })

// Value: protects=the line a learner reads when the editor did not keep the Study layout naming the command that applies it again, and that command clearing the line; fails_when=the pane reads "The editor did not retain the requested Codebook layout. Use the focus commands or arrange the Codebook panes manually.", which names no step that repairs it; why_new=Cycle 0045 finding OBS-2 (native observation round: the line stood in red in the Study pane after Restore Panel Size in Cursor); seam=workspace harness whose editor refuses one layout command
test('a Study layout the editor did not keep is reported with the command that applies it again, and that command clears the report', async () => {
  // Arrange: the editor refuses the layout of the first arrangement once.
  const harness = await workspaceHarness(false)
  harness.showTransientNativeSizes()
  harness.failNextCommand('vscode.setEditorLayout')
  try {
    await harness.reader.open()
    const reported = harness.reader.inspect().view!.errors.join(' | ')

    // Act: the learner runs the command the line names.
    await harness.reader.action('arrange')

    // Assert
    assert.equal(
      reported,
      'Error: The Codebook panes were not arranged: the editor did not keep the layout Codebook applied. Run "Codebook: Arrange Study Workspace" to apply it again.',
    )
    assert.equal(harness.reader.inspect().view!.errors.join(' | '), '')
    assert.equal(
      (await harness.reader.readPresentationState()).layoutConfirmed,
      true,
    )
  } finally {
    await harness.close()
  }
})
