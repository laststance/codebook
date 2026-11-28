import assert from 'node:assert/strict'
import { test } from 'node:test'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import {
  workspaceHarness,
  openRetainedStudy,
  recordedReaderHarness,
  articleRecordingLayoutHarness,
} from './studyWorkspaceHarness'

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
    const harness = await articleRecordingLayoutHarness(true, true)
    try {
      await harness.reader.openRepositoryEvidence(
        harness.binding,
        true,
        undefined,
        harness.origin,
      )
      await harness.controller.settle()
      await harness.reader.action('return-wiki')
      // Return now parks App2 beside Source1; choose a genuinely different native column before reentry.
      assert.equal(harness.panelColumn('codebook.scopedBrowser'), 2)
      assert.equal(harness.sourceColumn(), 1)
      if (move === 'source') harness.moveSource(2)
      else harness.movePanel('codebook.scopedBrowser', 1)
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
      assert.equal(harness.displayedImage(), harness.png.toString('base64'))
      assert.deepEqual(harness.editorLayout(), {
        orientation: 1,
        groups: [{ size: 161 }, { size: 162 }],
      })
      assert.equal(
        move === 'source'
          ? harness.sourceColumn()
          : harness.panelColumn('codebook.scopedBrowser'),
        move === 'source' ? 2 : 1,
      )
      assert.equal(
        harness.commands.filter(
          (command) => command === 'vscode.setEditorLayout',
        ).length,
        mutations,
      )
      assert.equal(harness.reader.presentationState().layoutConfirmed, false)
      // A successful explicit entry grants no permission for a later background reveal over a learner draft.
      const film = harness.controller.bundle(),
        draft = harness.focusMutableDraft(
          'later-manual-draft.txt',
          harness.panelColumn('codebook.scopedBrowser'),
        ),
        viewport = harness.viewportInstances
          .filter((candidate) => candidate.mode === 'recording')
          .at(-1)!,
        reveals = harness.panelReveals().length
      await assert.rejects(
        viewport.reveal(new AbortController().signal),
        /Application ownership changed/,
      )
      assert.equal(harness.panelReveals().length, reveals)
      assert.equal(harness.editor.window.activeTextEditor, draft.editor)
      assert.equal(draft.document.getText(), 'Original learner draft.\n')
      assert.equal(draft.tab.isDirty, true)
      assert.equal(harness.controller.bundle(), film)
    } finally {
      await harness.close()
    }
  })

test('background acquisition preserves a manual App move made after Wiki Return until explicit Study reentry', async () => {
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
    await harness.reader.action('return-wiki')
    harness.movePanel('codebook.scopedBrowser', 1)
    const application = harness.reader['app'],
      film = harness.controller.bundle(),
      reveals = harness.panelReveals().length,
      commands = harness.commands.length
    // Act
    await assert.rejects(
      Promise.resolve(
        harness.reader.presentation.createViewport(
          'late-manual-acquisition',
          () => {},
          () => {},
          'normal',
        ),
      ),
      /Application group changed|manually placed Application/,
    )
    // Assert
    assert.equal(harness.groups.length, 2)
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
    assert.equal(harness.reader['app'], application)
    assert.equal(harness.controller.bundle(), film)
    assert.equal(harness.panelReveals().length, reveals)
    assert.equal(harness.commands.length, commands)
    await harness.reader.openRepositoryEvidence(
      harness.binding,
      true,
      undefined,
      harness.origin,
    )
    await harness.controller.settle()
    assert.equal(harness.controller.state().readiness, 'ready')
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
    assert.equal(harness.displayedImage(), harness.png.toString('base64'))
    // A second learner move also retires the acknowledged manual registration; factories still cannot borrow focus to repair it.
    harness.movePanel('codebook.scopedBrowser', 2)
    const laterReveals = harness.panelReveals().length,
      laterCommands = harness.commands.length
    await assert.rejects(
      Promise.resolve(
        harness.reader.presentation.createViewport(
          'later-manual-acquisition',
          () => {},
          () => {},
          'normal',
        ),
      ),
      /manually placed Application/,
    )
    assert.equal(harness.panelReveals().length, laterReveals)
    assert.equal(harness.commands.length, laterCommands)
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 2)
    assert.equal(harness.groups.length, 2)
    await harness.reader.openRepositoryEvidence(
      harness.binding,
      true,
      undefined,
      harness.origin,
    )
    await harness.controller.settle()
    assert.equal(harness.controller.state().readiness, 'ready')
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 2)
    assert.equal(harness.displayedImage(), harness.png.toString('base64'))
  } finally {
    await harness.close()
  }
})

test('actual Return cannot consume another article origin when its native layout is still owned', async () => {
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
    // Act
    await harness.reader.arrangeRepository(new AbortController().signal, {
      ...harness.origin,
      nodeId: 'another-article',
    })
    // Assert
    assert.deepEqual(harness.editorLayout(), {
      orientation: 1,
      groups: [{ size: 109 }, { size: 107 }, { size: 107 }],
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
  const harness = await articleRecordingLayoutHarness(true, true),
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
      groups: [{ size: 109 }, { size: 107 }, { size: 107 }],
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
  const harness = await articleRecordingLayoutHarness(true, true),
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
    assert.equal(harness.displayedImage(), harness.png.toString('base64'))
    assert.equal(harness.controller.state().presentedMs, 100)
    assert.deepEqual(harness.editorLayout(), {
      orientation: 1,
      groups: [{ size: 109 }, { size: 107 }, { size: 107 }],
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
    // App owns the new first group; the learner's original first group now stands in column two.
    const draft = harness.addForeignDraft(2),
      held = harness.holdNextCommand('vscode.setEditorLayout')
    release = held.release
    // Act
    const returning = harness.reader.action('return-wiki'),
      rejected = assert.rejects(returning, /closed/)
    await held.started
    assert.equal(harness.reader.inspect().opened, true)
    assert.equal(
      harness.groups.find((group) => group.tabs.includes(draft))?.viewColumn,
      1,
    )
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

test('article Return preserves a dirty draft that adopted the newly allocated App group', async () => {
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
    const draft = harness.focusMutableDraft('adopted-app-notes.txt', 1),
      application = harness.reader['app'],
      film = harness.controller.bundle(),
      layout = harness.editorLayout(),
      reveals = harness.panelReveals().length,
      mutations = harness.commands.filter(
        (command) => command === 'vscode.setEditorLayout',
      ).length

    // Act
    await harness.reader.action('return-wiki')

    // Assert: moving App out would make this learner-owned group eligible for accidental contraction.
    assert.equal(harness.reader['app'], application)
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
    assert.equal(harness.groups.length, 3)
    assert.deepEqual(harness.editorLayout(), layout)
    assert.equal(harness.panelReveals().length, reveals)
    assert.equal(
      harness.commands.filter((command) => command === 'vscode.setEditorLayout')
        .length,
      mutations,
    )
    assert.equal(harness.controller.bundle(), film)
    assert.equal(draft.document.getText(), 'Original learner draft.\n')
    assert.equal(draft.tab.isDirty, true)
    assert.equal(
      harness.focusedSource()?.document.uri.toString(),
      draft.document.uri.toString(),
    )
    assert.equal(harness.keyboardOnBody(), false)
  } finally {
    await harness.close()
  }
})

test('a manual application move during the restored-layout receipt remains authoritative on the next evidence visit', async () => {
  // Arrange
  const harness = await articleRecordingLayoutHarness(true, true)
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
    const returning = harness.reader.action('return-wiki'),
      rejected = assert.rejects(returning, /native input|focus/i)
    await layout.started
    const receipt = harness.holdNextCommand('vscode.getEditorLayout')
    releaseReceipt = receipt.release
    layout.release()
    await receipt.started
    // The accepted Return parked App2; a real learner move to1 revokes the old Return before its receipt is adopted.
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 2)
    harness.movePanel('codebook.scopedBrowser', 1)
    receipt.release()
    await rejected
    await harness.reader.openRepositoryEvidence(
      harness.binding,
      true,
      undefined,
      harness.origin,
    )
    await harness.controller.settle()
    // Assert
    assert.equal(harness.controller.state().readiness, 'ready')
    assert.equal(harness.displayedImage(), harness.png.toString('base64'))
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
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
      if (region === 'source') {
        assert.equal(harness.sourceColumn(), 1)
        harness.moveSource(3)
      } else
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
        region === 'source' ? 3 : region === 'application' ? 2 : 1,
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
    // The native contraction moves the existing text editor along with its tab before another manual move.
    assert.deepEqual(
      harness.editor.window.visibleTextEditors
        .filter(
          (editor) =>
            editor.document.uri.toString() ===
            harness.reader.inspect().sourceUri,
        )
        .map((editor) => editor.viewColumn),
      [2],
    )
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
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
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
    assert.equal(harness.groups.length, 3)
    assert.deepEqual(harness.editorLayout(), {
      orientation: 0,
      groups: [
        { size: 0.55, groups: [{ size: 0.5 }, { size: 0.5 }] },
        { size: 0.45 },
      ],
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
    const harness = await articleRecordingLayoutHarness(true, true),
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
      assert.deepEqual(harness.editorLayout(), {
        orientation: 1,
        groups: [{ size: 161 }, { size: 162 }],
      })
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
      const image = harness.reader.inspect().view?.model.image
      assert.equal(image?.status, 'captured')
      assert.equal(image?.base64, harness.png.toString('base64'))
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
    const harness = await articleRecordingLayoutHarness(true, true)
    const originalDraft = harness.focusMutableDraft('second-original.txt', 2)
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
          ? {
              orientation: 1,
              groups: [{ size: 109 }, { size: 107 }, { size: 107 }],
            }
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
        assert.equal(
          harness.groups
            .find((group) => group.viewColumn === 3)!
            .tabs.includes(originalDraft.tab),
          true,
        )
        assert.equal(
          originalDraft.document.getText(),
          'Original learner draft.\n',
        )
        assert.equal(originalDraft.tab.isDirty, true)
        assert.equal(harness.displayedImage(), harness.png.toString('base64'))
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
    const previous = harness.groups.find((group) => group.viewColumn === 2)!,
      previousTabs = [...previous.tabs]
    // Act
    // Add to the original first group, shifted behind App1; the allocation-adoption negative is tested separately.
    harness.resyncEditorGroups('append', false, false, 2)
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
          // R3 Return parked App2; explicit source-derived entry first restores its owned App1 destination. That reveal fronts the Application, so the entry's own reveal is skipped: a pane that already fronts its group needs none (Cycle 0056 task 17, H2-a).
          {
            kind: 'codebook.scopedBrowser',
            column: 1,
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

for (const cursor of [false, true])
  test(`${cursor ? 'Cursor' : 'VS Code'} recording reentry after a source-derived observation keeps original drafts and reserves its own Application again`, async () => {
    // Arrange
    const harness = await articleRecordingLayoutHarness(true, true),
      first = harness.focusMutableDraft('first-original.txt', 1),
      second = harness.focusMutableDraft('second-original.txt', 2)
    if (cursor) {
      harness.useCursorGroupWrappers(true)
      harness.replaceGroupObjectsOnTabChanges()
    }
    try {
      await harness.reader.openRepositoryEvidence(
        harness.binding,
        true,
        undefined,
        harness.origin,
      )
      await harness.controller.settle()
      const application = harness.reader['app'],
        runtimes = harness.runtimes.length
      await harness.reader.action('return-wiki')
      // Act
      await harness.reader.openRepositoryEvidence(
        harness.binding,
        false,
        undefined,
        harness.origin,
      )
      assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
      assert.equal(harness.sourceColumn(), 2)
      assert.equal(harness.panelColumn('codebook.studyContext'), 3)
      await harness.reader.openRepositoryEvidence(
        harness.binding,
        true,
        undefined,
        harness.origin,
      )
      await harness.controller.settle()
      // Assert
      assert.equal(harness.controller.state().readiness, 'ready')
      assert.equal(harness.reader['app'], application)
      assert.equal(harness.displayedImage(), harness.png.toString('base64'))
      assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
      assert.equal(harness.sourceColumn(), 2)
      assert.equal(harness.panelColumn('codebook.studyContext'), undefined)
      assert.equal(harness.groups.length, 3)
      assert.equal(
        harness.groups.find((group) => group.viewColumn === 1)!.locked,
        true,
      )
      assert.equal(
        harness.groups.find((group) => group.viewColumn === 1)!.tabs.length,
        1,
      )
      for (const draft of [first, second]) {
        assert.equal(draft.document.getText(), 'Original learner draft.\n')
        assert.equal(draft.tab.isDirty, true)
        assert.equal(
          harness.groups.some((group) =>
            group.tabs.some(
              (tab) =>
                'uri' in tab.input &&
                tab.input.uri.toString() === draft.document.uri.toString(),
            ),
          ),
          true,
        )
      }
      assert.equal(harness.runtimes.length, runtimes)
    } finally {
      await harness.close()
    }
  })

for (const later of ['finish', 'newer source', 'queued source', 'Close'])
  test(`source-derived reentry drains its retained live renderer outside the layout queue after ${later}`, async () => {
    // Arrange
    const harness = await articleRecordingLayoutHarness(true, true)
    let releaseHold = (): void => {},
      releaseQueue = (): void => {},
      queuedRead: Promise<void> | undefined,
      viewport:
        | Awaited<ReturnType<typeof harness.reader.presentation.createViewport>>
        | undefined
    try {
      await harness.reader.openRepositoryEvidence(
        harness.binding,
        true,
        undefined,
        harness.origin,
      )
      await harness.controller.settle()
      viewport = await harness.reader.presentation.createViewport(
        'independent-live-renderer',
        () => {},
        () => {},
        'normal',
      )
      await harness.controller.settle()
      await harness.reader.action('return-wiki')
      const application = harness.reader['app'],
        hold = viewport.holdPlacement,
        events = harness.viewportEvents.length,
        commands = harness.commands.filter(
          (command) => command === 'vscode.setEditorLayout',
        ).length
      let entered!: () => void,
        enteredCount = 0
      const started = new Promise<void>((resolve) => {
          entered = resolve
        }),
        waiting = new Promise<void>((resolve) => {
          releaseHold = resolve
        })
      viewport.holdPlacement = async (signal) => {
        const release = await hold.call(viewport, signal)
        enteredCount++
        entered()
        await waiting
        return release
      }
      // Keep an actual native read pending in the existing owner, without changing any source or layout result.
      if (later === 'queued source') {
        const command = harness.holdNextCommand('vscode.getEditorLayout')
        releaseQueue = command.release
        queuedRead = harness.reader['withLayout'](undefined, async () => {
          await harness.editor.commands.executeCommand('vscode.getEditorLayout')
        })
        await command.started
      }
      // Act
      const opening = harness.reader.openRepositoryEvidence(
          harness.binding,
          false,
          undefined,
          harness.origin,
        ),
        outcome = opening.then(
          () => undefined,
          (error: unknown) => error,
        )
      await Promise.race([
        started,
        outcome.then((error) =>
          assert.equal(
            enteredCount,
            1,
            `Entry completed before its renderer drain: ${String(error)}`,
          ),
        ),
      ])
      // This accepted renderer drain cannot own layout: otherwise Close or a queued native effect would deadlock behind it.
      if (later === 'queued source')
        assert.notEqual(harness.reader['arranging'], undefined)
      else assert.equal(harness.reader['arranging'], undefined)
      assert.equal(
        harness.commands.filter(
          (command) => command === 'vscode.setEditorLayout',
        ).length,
        commands,
      )
      let draft: ReturnType<typeof harness.focusMutableDraft> | undefined
      if (later === 'queued source') {
        releaseHold()
        // One task boundary lets the renderer response settle and the next owner wait behind the still-pending native read.
        await new Promise<void>((resolve) => setImmediate(resolve))
        draft = harness.focusMutableDraft('newer-during-layout-queue.txt', 1)
        releaseQueue()
        await queuedRead
      } else if (later === 'newer source')
        draft = harness.focusMutableDraft('newer-during-renderer-drain.txt', 1)
      if (later === 'Close') await harness.reader.close()
      releaseHold()
      const error = await outcome
      // Assert
      if (later === 'finish') {
        assert.equal(error, undefined)
        assert.equal(harness.reader['app'], application)
        assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
        assert.equal(harness.sourceColumn(), 2)
        assert.equal(harness.panelColumn('codebook.studyContext'), 3)
        const image = harness.reader.inspect().view?.model.image
        assert.equal(image?.status, 'captured')
        assert.equal(image?.base64, harness.png.toString('base64'))
      } else {
        assert.match(String(error), /closed|native input|focus|superseded/i)
        if (draft) {
          assert.equal(harness.editor.window.activeTextEditor, draft.editor)
          assert.equal(draft.document.getText(), 'Original learner draft.\n')
          assert.equal(draft.tab.isDirty, true)
          assert.equal(harness.panelColumn('codebook.scopedBrowser'), 2)
          assert.equal(
            harness.commands.filter(
              (command) => command === 'vscode.setEditorLayout',
            ).length,
            commands,
          )
        } else assert.equal(harness.reader.inspect().opened, false)
      }
      // The exact live placement hold must release after success, refusal and Close.
      assert.deepEqual(
        harness.viewportEvents
          .slice(events)
          .filter((event) => event === 'hold:live' || event === 'release:live'),
        ['hold:live', 'release:live'],
      )
      if (later !== 'Close') {
        const releasePlacement = await viewport.holdPlacement(
          new AbortController().signal,
        )
        releasePlacement()
      }
    } finally {
      releaseHold()
      releaseQueue()
      await queuedRead?.catch(() => undefined)
      viewport?.close()
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
