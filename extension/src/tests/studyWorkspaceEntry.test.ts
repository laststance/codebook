import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import {
  readerSeams,
  recordedReaderHarness,
  saveOneStopNodeHistory,
  workspaceHarness,
} from './studyWorkspaceHarness'

for (const replaceWrappers of [false, true])
  test(`MCP-first App preparation reserves its own locked group and preserves both learner groups${replaceWrappers ? ' across native wrapper replacement' : ''}`, async () => {
    // Arrange
    const harness = await workspaceHarness(false)
    await harness.reader.attach(harness.service)
    readerSeams(harness).stopOwnTimer()
    harness.useNativeLayout({
      orientation: 0,
      groups: [{ size: 3 }, { size: 2 }],
    })
    const first = harness.focusMutableDraft('first-notes.txt', 1),
      second = harness.focusMutableDraft('second-notes.txt', 2),
      firstInputs = harness.groups[0]!.tabs.map((tab) => tab.input),
      secondInputs = harness.groups[1]!.tabs.map((tab) => tab.input)
    if (replaceWrappers) harness.replaceGroupObjectsOnTabChanges()
    try {
      // Act
      const viewport = await harness.reader.presentation.createViewport(
        'owned-first',
        () => {},
        () => {},
        'normal',
      )

      // Assert
      assert.equal(harness.groups.length, 3)
      assert.equal(harness.groups[0]!.locked, true)
      assert.equal(harness.groups[0]!.tabs.length, 1)
      assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
      assert.deepEqual(
        harness.groups[1]!.tabs.map((tab) => tab.input),
        firstInputs,
      )
      assert.deepEqual(
        harness.groups[2]!.tabs.map((tab) => tab.input),
        secondInputs,
      )
      assert.equal(first.document.getText(), 'Original learner draft.\n')
      assert.equal(second.document.getText(), 'Original learner draft.\n')
      assert.equal(
        harness.groups[1]!.tabs.some((tab) => tab.isDirty),
        true,
      )
      assert.equal(
        harness.groups[2]!.tabs.some((tab) => tab.isDirty),
        true,
      )
      const commandsBeforeReuse = harness.commands.length
      await harness.reader.presentation.createViewport(
        'owned-second',
        () => {},
        () => {},
        'normal',
      )
      assert.equal(harness.groups.length, 3)
      assert.deepEqual(
        harness.commands
          .slice(commandsBeforeReuse)
          .filter(
            (command) =>
              command === 'workbench.action.newGroupAbove' ||
              command === 'workbench.action.lockEditorGroup',
          ),
        [],
      )
      // A superseded runtime cannot retire its successor's pane or group.
      viewport.close()
      assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
      await harness.reader.close()
      assert.equal(harness.groups.length, 2)
      assert.deepEqual(
        harness.groups[0]!.tabs.map((tab) => tab.input),
        firstInputs,
      )
      assert.deepEqual(
        harness.groups[1]!.tabs.map((tab) => tab.input),
        secondInputs,
      )
      assert.deepEqual(harness.editorLayout(), {
        orientation: 0,
        groups: [{ size: 3 }, { size: 2 }],
      })
    } finally {
      await harness.close()
    }
  })

for (const gesture of ['navigation-command', 'click'] as const)
  test(`a native Call Stack ${gesture} keeps its input and source visible beside the prepared App`, async () => {
    // Arrange
    const harness = await workspaceHarness(false)
    await harness.reader.attach(harness.service)
    readerSeams(harness).stopOwnTimer()
    harness.useNativeLayout({ orientation: 1, groups: [{}] })
    harness.focusMutableDraft('learner-notes.txt', 1)
    try {
      await harness.reader.presentation.createViewport(
        'native-frame',
        () => {},
        () => {},
        'normal',
      )
      harness.pauseDebugger({ focusesEditorOnBreak: false })
      if (gesture === 'click') harness.focusView()

      // Act
      const source = harness.selectStackFrame('framework.ts', 1, gesture)
      assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
      assert.equal(
        harness.groups[0]!.activeTab?.input instanceof
          harness.editor.TabInputWebview,
        true,
      )
      await harness.revealApplicationPaneOverPausedFile()

      // Assert
      assert.equal(
        harness.groups[1]!.activeTab?.input instanceof
          harness.editor.TabInputText,
        true,
      )
      assert.equal(source.getText(), 'Original learner draft.\n')
      assert.equal(harness.keyboardOnBody(), false)
      assert.equal(harness.keyboardInView(), gesture === 'click')
      assert.equal(harness.groups[0]!.tabs.length, 1)
    } finally {
      await harness.close()
    }
  })

test('an existing App lease is reusable while an unrelated native layout read remains pending', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  await harness.reader.attach(harness.service)
  readerSeams(harness).stopOwnTimer()
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  harness.focusMutableDraft('source.txt', 1)
  let arranging: Promise<unknown> | undefined,
    successor: Promise<unknown> | undefined,
    release = (): void => {}
  try {
    await harness.reader.presentation.createViewport(
      'first',
      () => {},
      () => {},
      'normal',
    )
    const held = harness.holdNextCommand('vscode.getEditorLayout')
    release = held.release
    arranging = harness.reader.arrangeRepository(new AbortController().signal)
    await held.started
    const commandsBeforeReuse = [...harness.commands]
    let acquired = false

    // Act
    successor = Promise.resolve(
      harness.reader.presentation.createViewport(
        'second',
        () => {},
        () => {},
        'normal',
      ),
    ).then(() => {
      acquired = true
    })
    await waitUntil(
      () => acquired,
      'existing App acquisition without joining layout',
      1_000,
    )

    // Assert
    assert.equal(acquired, true)
    assert.deepEqual(harness.commands, commandsBeforeReuse)
    assert.equal(harness.groups.length, 3)
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
  } finally {
    release()
    await Promise.allSettled([arranging, successor])
    await harness.close()
  }
})

test('Close releases the owned App while its preparation waits for native chat command discovery', async (context) => {
  // Arrange
  const harness = await workspaceHarness(false)
  await harness.reader.attach(harness.service)
  readerSeams(harness).stopOwnTimer()
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  const source = harness.focusMutableDraft('original.txt', 1),
    chat = harness.addSeparateEditorPart()
  chat.focusTab()
  let releaseCatalog = (): void => {},
    enterCatalog = (): void => {},
    preparing: Promise<unknown> | undefined
  const catalog = new Promise<void>((resolve) => {
      releaseCatalog = resolve
    }),
    entered = new Promise<void>((resolve) => {
      enterCatalog = resolve
    }),
    getCommands = harness.editor.commands.getCommands
  context.mock.method(harness.editor.commands, 'getCommands', async () => {
    enterCatalog()
    await catalog
    return getCommands()
  })
  try {
    preparing = Promise.resolve(
      harness.reader.presentation.createViewport(
        'catalog-wait',
        () => {},
        () => {},
        'normal',
      ),
    )
    const refused = assert.rejects(preparing, /study workspace was closed/)
    await entered
    const commandsBeforeClose = harness.commands.length
    let closed = false

    // Act: discovery has issued no keyboard command and cannot hold the layout queue against Close.
    const closing = harness.reader.close().then(() => {
      closed = true
    })
    await waitUntil(
      () => closed,
      'Close before chat discovery returns',
      1_000,
    ).catch(() => undefined)
    const closedBeforeDiscovery = closed
    releaseCatalog()
    await Promise.all([closing, refused])

    // Assert
    assert.equal(closedBeforeDiscovery, true)
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), undefined)
    assert.equal(harness.groups.length, 3)
    assert.equal(source.document.getText(), 'Original learner draft.\n')
    assert.equal(source.tab.isDirty, true)
    assert.deepEqual(
      harness.commands
        .slice(commandsBeforeClose)
        .filter((command) => command === 'composer.focusComposer'),
      [],
    )
  } finally {
    releaseCatalog()
    await preparing?.catch(() => undefined)
    context.mock.restoreAll()
    await harness.close()
  }
})

for (const cancellation of ['before reservation', 'after allocation'] as const)
  test(`cancelling App preparation ${cancellation} leaves original groups and creates no viewport`, async () => {
    // Arrange
    const harness = await workspaceHarness(false)
    await harness.reader.attach(harness.service)
    readerSeams(harness).stopOwnTimer()
    harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
    const first = harness.focusMutableDraft('first.txt', 1),
      second = harness.focusMutableDraft('second.txt', 2),
      abort = new AbortController(),
      held =
        cancellation === 'after allocation'
          ? harness.holdNextCommand('workbench.action.lockEditorGroup')
          : undefined
    try {
      if (!held) abort.abort(new Error('Preparation cancelled.'))

      // Act
      const preparing = Promise.resolve(
          harness.reader.presentation.createViewport(
            'cancelled',
            () => {},
            () => {},
            'normal',
            abort.signal,
          ),
        ),
        refused = assert.rejects(preparing, /Preparation cancelled\./)
      if (held) {
        await held.started
        assert.equal(harness.groups.length, 3)
        abort.abort(new Error('Preparation cancelled.'))
        held.release()
      }
      await refused

      // Assert
      assert.equal(harness.groups.length, 2)
      assert.equal(harness.panelColumn('codebook.scopedBrowser'), undefined)
      assert.equal(first.document.getText(), 'Original learner draft.\n')
      assert.equal(second.document.getText(), 'Original learner draft.\n')
      assert.deepEqual(
        harness.groups.map((group) => group.locked ?? false),
        [false, false],
      )
    } finally {
      held?.release()
      await harness.close()
    }
  })

test('a learner-adopted App group keeps its document and layout when background reveal is refused and the reader closes', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  await harness.reader.attach(harness.service)
  readerSeams(harness).stopOwnTimer()
  harness.useNativeLayout({
    orientation: 0,
    groups: [{ size: 3 }, { size: 2 }],
  })
  harness.focusMutableDraft('original.txt', 1)
  try {
    await harness.reader.presentation.createViewport(
      'adopted',
      () => {},
      () => {},
      'normal',
    )
    const adopted = harness.focusMutableDraft('adopted.txt', 1),
      retainedLayout = harness.editorLayout()

    // Act
    await assert.rejects(
      harness.revealApplicationPaneOverPausedFile(),
      /Application ownership changed/,
    )
    assert.equal(harness.keyboardOnBody(), false)
    assert.equal(
      harness.editor.window.activeTextEditor?.document.uri.toString(),
      adopted.document.uri.toString(),
    )
    await harness.reader.close()

    // Assert
    assert.equal(harness.groups.length, 3)
    assert.equal(
      harness.groups[0]!.activeTab?.input instanceof
        harness.editor.TabInputText,
      true,
    )
    assert.equal(adopted.document.getText(), 'Original learner draft.\n')
    assert.equal(adopted.tab.isDirty, true)
    assert.deepEqual(harness.editorLayout(), retainedLayout)
  } finally {
    await harness.close()
  }
})

test('an ambiguous duplicate App tab stays visible and receives no background reveal of the earlier panel', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  await harness.reader.attach(harness.service)
  readerSeams(harness).stopOwnTimer()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.focusMutableDraft('original.txt', 1)
  try {
    await harness.reader.presentation.createViewport(
      'duplicate-app',
      () => {},
      () => {},
      'normal',
    )
    const replacement = harness.editor.window.createWebviewPanel(
      'codebook.scopedBrowser',
      'Other Application',
      { viewColumn: 1, preserveFocus: false },
    )
    replacement.reveal(1, false)
    const revealsBefore = harness.panelReveals()

    // Act
    await assert.rejects(
      harness.revealApplicationPaneOverPausedFile(),
      /Application ownership changed/,
    )

    // Assert
    assert.deepEqual(harness.panelReveals(), revealsBefore)
    assert.equal(replacement.visible, true)
    assert.equal(replacement.active, true)
    assert.equal(harness.keyboardOnBody(), false)
  } finally {
    await harness.close()
  }
})

test('failed App focus grants no cleanup authority over a newly reported group without an observed identity', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  await harness.reader.attach(harness.service)
  readerSeams(harness).stopOwnTimer()
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  const source = harness.focusMutableDraft('original.txt', 1)
  // The learner's notes in the second group are the active editor, so the preparation focuses the first group before it allocates (row 612: an active first group is not focused at all).
  harness.focusMutableDraft('learner-notes.txt', 2)
  const held = harness.holdNextCommand('workbench.action.focusFirstEditorGroup')
  let preparing: Promise<unknown> | undefined
  try {
    preparing = Promise.resolve(
      harness.reader.presentation.createViewport(
        'failed-focus',
        () => {},
        () => {},
        'normal',
      ),
    )
    const refused = assert.rejects(preparing, /Native layout command failed/)
    await held.started
    // An SDK group that the ownership observer has not seen remains foreign, even when it is empty.
    const foreign = { viewColumn: 3, tabs: [] }
    harness.groups.push(foreign)
    harness.failNextCommand('workbench.action.focusFirstEditorGroup')

    // Act
    held.release()
    await refused

    // Assert
    assert.equal(harness.groups.includes(foreign), true)
    assert.equal(harness.groups.length, 3)
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), undefined)
    assert.equal(source.document.getText(), 'Original learner draft.\n')
    assert.equal(harness.keyboardOnBody(), false)
  } finally {
    held.release()
    await preparing?.catch(() => undefined)
    await harness.close()
  }
})

for (const entry of ['idle Live selection', 'cold Live reopening'])
  test(`starting a run after ${entry} preserves the separate chat keyboard without rearranging its prepared panes`, async () => {
    // Arrange
    const harness = await workspaceHarness(false)
    await harness.reader.attach(harness.service)
    readerSeams(harness).stopOwnTimer()
    harness.useNativeLayout({ orientation: 1, groups: [{}, {}] })
    harness.groups.at(-1)!.tabs = []
    harness.groups.at(-1)!.activeTab = undefined
    const chat = harness.addSeparateEditorPart()
    harness.replaceGroupObjectsOnTabChanges()
    try {
      harness.focusMutableDraft('actions.ts', 1)
      await harness.reader.open()
      const overview = harness.reader.presentationState()
      assert.equal(overview.reader.contentTab, 'overview')
      assert.equal(overview.panes.contextColumn, 3)
      chat.focusTab()
      await harness.reader.returnToCurrent({
        presentationId: overview.presentationId,
        expectedRevision: overview.reader.contentRevision,
      })
      assert.equal(chat.focused(), true)
      // Reopening the explicitly selected Live screen must prepare it before any run exists too.
      if (entry === 'cold Live reopening') {
        await harness.reader.close()
        await harness.reader.open()
      }
      const prepared = harness.reader.presentationState()
      chat.focusTab()
      const commandsBeforeStart = harness.commands.length,
        sourcesBeforeStart = harness.textDocumentShows().length

      // Act
      harness.service.start({
        instanceId: harness.service.instanceId,
        profile: 'repository-browser',
        configuration: harness.configuration,
        key: randomUUID(),
      })
      await [...harness.service.records.values()][0]!.preparation
      await readerSeams(harness).refresh()

      // Assert
      assert.equal(prepared.reader.contentTab, 'live')
      assert.equal(prepared.reader.followingCurrentRun, true)
      assert.equal(prepared.layoutConfirmed, true)
      assert.equal(prepared.panes.appColumn, 1)
      assert.equal(prepared.panes.sourceColumn, 2)
      assert.equal(prepared.panes.contextColumn, undefined)
      assert.equal(harness.panelColumn('codebook.studyContext'), undefined)
      assert.equal(harness.reader.presentationState().layoutConfirmed, true)
      assert.equal(chat.focused(), true)
      assert.deepEqual(
        harness
          .textDocumentShows()
          .slice(sourcesBeforeStart)
          .filter((shown) => !shown.preserveFocus),
        [],
      )
      assert.deepEqual(
        harness.commands
          .slice(commandsBeforeStart)
          .filter(
            (command) =>
              command === 'vscode.setEditorLayout' ||
              command === 'workbench.action.focusFirstEditorGroup',
          ),
        [],
      )
    } finally {
      await harness.close()
    }
  })

test('Close during Live preparation keeps its keyboard settlement without an obsolete return to the separate chat', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  await harness.reader.attach(harness.service)
  readerSeams(harness).stopOwnTimer()
  harness.useNativeLayout({ orientation: 1, groups: [{}, {}] })
  harness.groups.at(-1)!.tabs = []
  harness.groups.at(-1)!.activeTab = undefined
  const chat = harness.addSeparateEditorPart()
  let releaseArrangement = (): void => {}
  try {
    harness.focusMutableDraft('actions.ts', 1)
    await harness.reader.open()
    chat.focusTab()
    const state = harness.reader.presentationState(),
      arrangement = harness.holdNextLayoutResponse()
    releaseArrangement = arrangement.release
    const returning = harness.reader.returnToCurrent({
        presentationId: state.presentationId,
        expectedRevision: state.reader.contentRevision,
      }),
      refused = assert.rejects(returning, /workspace was closed/)
    await arrangement.started
    const commandsBeforeClose = harness.commands.length

    // Act
    const closing = harness.reader.close()
    arrangement.release()
    await refused
    await closing

    // Assert
    assert.equal(harness.reader.presentationState().state, 'closed')
    assert.deepEqual(
      harness.commands
        .slice(commandsBeforeClose)
        .filter((command) => command === 'composer.focusComposer'),
      [],
    )
  } finally {
    releaseArrangement()
    await harness.close()
  }
})

test('Close while Live return waits for a Node preview leaves the closed reader revision unchanged', async () => {
  // Arrange
  const harness = await workspaceHarness()
  readerSeams(harness).stopOwnTimer()
  let releasePreview = (): void => {}
  try {
    const history = await saveOneStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.open()
    harness.receiveContext({
      type: 'node-history',
      revision: harness.postedMessages().at(-1)!.revision,
      studyId: history.studyId,
    })
    await waitUntil(
      () =>
        harness.reader.inspect().view?.nodeHistory?.header.studyId ===
          history.studyId && !harness.reader.inspect().view?.loading,
      'the selected Node history is ready',
      1_000,
    )
    harness.addNodeHistoryPreview(history.studyId, 2)
    const preview = harness.holdNextTabCloseResponse(),
      state = harness.reader.presentationState()
    releasePreview = preview.release
    const returning = harness.reader
      .returnToCurrent({
        presentationId: state.presentationId,
        expectedRevision: state.reader.contentRevision,
      })
      .then(
        () => 'completed',
        () => 'cancelled',
      )
    await preview.started

    // Act
    await harness.reader.close()
    const closedRevision =
      harness.reader.presentationState().reader.contentRevision
    preview.release()
    const outcome = await returning

    // Assert
    assert.equal(outcome, 'cancelled')
    assert.equal(harness.reader.presentationState().state, 'closed')
    assert.equal(
      harness.reader.presentationState().reader.contentRevision -
        closedRevision,
      0,
    )
  } finally {
    releasePreview()
    await harness.close()
  }
})

for (const newerAction of [
  'Close',
  'a new source choice',
  'a same-source selection',
  'another window',
])
  test(`Live return waiting for the native command catalog preserves ${newerAction}`, async (context) => {
    // Arrange
    const harness = await workspaceHarness(false)
    await harness.reader.attach(harness.service)
    readerSeams(harness).stopOwnTimer()
    harness.useNativeLayout({ orientation: 1, groups: [{}, {}] })
    harness.groups.at(-1)!.tabs = []
    harness.groups.at(-1)!.activeTab = undefined
    const chat = harness.addSeparateEditorPart()
    let releaseCatalog = (): void => {},
      enteredCatalog = (): void => {}
    const catalogEntered = new Promise<void>((resolve) => {
        enteredCatalog = resolve
      }),
      catalog = new Promise<void>((resolve) => {
        releaseCatalog = resolve
      })
    try {
      harness.focusMutableDraft('actions.ts', 1)
      await harness.reader.open()
      chat.focusTab()
      const originalCommands = harness.editor.commands.getCommands
      context.mock.method(harness.editor.commands, 'getCommands', async () => {
        enteredCatalog()
        await catalog
        return originalCommands()
      })
      const state = harness.reader.presentationState(),
        returning = harness.reader
          .returnToCurrent({
            presentationId: state.presentationId,
            expectedRevision: state.reader.contentRevision,
          })
          .then(
            () => 'completed',
            () => 'cancelled',
          )
      await catalogEntered
      const commandsBeforeChoice = harness.commands.length

      // Act
      if (newerAction === 'Close') await harness.reader.close()
      else if (newerAction === 'a new source choice')
        harness.focusMutableDraft('newer-choice.ts', 1)
      else if (newerAction === 'a same-source selection') {
        // Dedicated App preparation can finish on App; genuine source input must select the retained visible source first.
        const source = harness.editor.window.visibleTextEditors.find(
          (editor) =>
            editor.document.uri.toString() ===
              harness.reader.inspect().sourceUri &&
            editor.viewColumn ===
              harness.reader.presentationState().panes.sourceColumn,
        )
        assert.ok(source)
        harness.focusExistingSource(source)
        harness.changeFocusedSourceSelection(46)
      } else harness.changeWindowFocus(false)
      releaseCatalog()
      const outcome = await returning

      // Assert
      assert.equal(outcome, newerAction === 'Close' ? 'cancelled' : 'completed')
      assert.deepEqual(
        harness.commands
          .slice(commandsBeforeChoice)
          .filter((command) => command === 'composer.focusComposer'),
        [],
      )
      if (newerAction === 'Close')
        assert.equal(harness.reader.presentationState().state, 'closed')
      else if (newerAction === 'a new source choice') {
        assert.equal(chat.focused(), false)
        assert.equal(
          harness
            .focusedSource()
            ?.document.uri.path.endsWith('/newer-choice.ts'),
          true,
        )
      } else if (newerAction === 'a same-source selection')
        assert.equal(harness.focusedSource()?.selections[0]?.active.line, 46)
    } finally {
      releaseCatalog()
      context.mock.restoreAll()
      await harness.close()
    }
  })

test('first Study entry from one editor group keeps empty Context separate from the application', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  const draft = harness.addForeignDraft(1)
  try {
    // Act
    await harness.reader.open()

    // Assert
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
    assert.equal(harness.panelColumn('codebook.studyContext'), 3)
    assert.deepEqual(harness.editorLayout(), {
      orientation: 0,
      groups: [
        { size: 0.55, groups: [{ size: 0.5 }, { size: 0.5 }] },
        { size: 0.45 },
      ],
    })
    assert.equal(harness.groups[0]!.tabs.includes(draft), true)
    assert.equal(draft.isDirty, true)
    assert.equal(harness.reader.inspect().view!.errors.length, 0)
    assert.equal(harness.runtimes.length, 0)
  } finally {
    await harness.close()
  }
})

test('cold Wiki entry reserves a second main pane without treating the separate chat part as its destination', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] })
  const chat = harness.addSeparateEditorPart(),
    draft = harness.focusMutableDraft()
  try {
    // Act
    await harness.reader.arrangeRepository(new AbortController().signal)

    // Assert
    assert.equal(harness.groups.length, 3)
    assert.deepEqual(harness.groups[1]!.tabs, [])
    assert.equal(harness.groups[2]!.tabs.includes(chat.tab), true)
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] })
    assert.equal(harness.groups[0]!.tabs.includes(draft.tab), true)
    assert.equal(draft.document.getText(), 'Original learner draft.\n')
    assert.equal(harness.runtimes.length, 0)
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's file in front of the first group while a cold Wiki layout borrows that group's focus beside another editor part to measure the main editor: a newer selection or edit there during the borrow refuses the layout through the reader's focus receipt and stays as the learner made it, with the keyboard, and an unchanged borrow leaves that file the keyboard; fails_when=the borrow takes the learner's newer selection or edit for its own and restores the old reading position over it; why_new=Cycle 0046 row 663 (rework: the chat part has the keyboard now, so the measurement still borrows the first group; from original-notes.txt in front of the second group, the origin these tests had, the measurement borrows nothing, so their unchanged case no longer gives that file its keyboard back after a borrow: it never left it, see studyWorkspaceFocus's tests from the learner's file in the second group); seam=workspaceHarness with addSeparateEditorPart and its focus, focusMutableDraft in columns 1 and 2, holdNextPrimaryFocusResponse and holdNextCommand on the layout read
for (const boundary of [
  'layout measurement',
  'primary focus response',
] as const)
  for (const interaction of ['selection', 'edit', 'none'] as const)
    test(
      interaction === 'none'
        ? `cold Wiki scope from the chat leaves the borrowed first group's file the keyboard after unchanged ${boundary}`
        : `cold Wiki scope preserves a newer primary ${interaction} during ${boundary}`,
      async () => {
        // Arrange: the chat part has the keyboard; primary-notes.txt is in front of the first group and original-notes.txt of the second.
        const harness = await workspaceHarness(false)
        harness.useNativeLayout({
          orientation: 0,
          groups: [{ size: 490 }, { size: 490 }],
        })
        const chat = harness.addSeparateEditorPart()
        const primary = harness.focusMutableDraft('primary-notes.txt', 1),
          original = harness.focusMutableDraft('original-notes.txt', 2)
        chat.focus()
        // The reader's own focus receipts, as RepositoryReader.open hands them over: a refusal they show as the learner's change leaves the keyboard where the learner has it.
        const receipts: ReturnType<typeof harness.retainRepositoryFocus>[] = []
        const focus = {
          begin(): void {},
          retainCurrentFocus(
            acquire?: Parameters<typeof harness.retainRepositoryFocus>[0],
          ) {
            const receipt = harness.retainRepositoryFocus(acquire)
            receipts.push(receipt)
            return receipt
          },
        }
        const firstRead =
          boundary === 'primary focus response'
            ? harness.holdNextPrimaryFocusResponse()
            : harness.holdNextCommand('vscode.getEditorLayout')
        const opening = harness.reader.arrangeRepository(
          new AbortController().signal,
          undefined,
          focus,
        )
        void opening.catch(() => undefined)
        let releaseMeasured = (): void => {}
        try {
          await firstRead.started
          const measured =
            boundary === 'primary focus response'
              ? firstRead
              : harness.holdNextCommand('vscode.getEditorLayout')
          releaseMeasured = measured.release
          if (boundary === 'layout measurement') {
            firstRead.release()
            await measured.started
          }
          assert.equal(
            harness.focusedSource()?.document.uri.toString(),
            primary.document.uri.toString(),
          )

          // Act
          if (interaction === 'selection')
            primary.editor.selections = [
              {
                anchor: primary.editor.selections[0]!.active.with(27, 0),
                active: primary.editor.selections[0]!.active.with(27, 0),
              },
            ]
          if (interaction === 'edit')
            primary.replaceContent('New learner text.\n')
          measured.release()

          // Assert
          if (interaction === 'none') {
            await opening
            assert.equal(
              harness.focusedSource()?.document.uri.toString(),
              primary.document.uri.toString(),
            )
          } else {
            // The reader's receipt sees the learner's newer selection or edit first, as in RepositoryReader.open.
            await assert.rejects(opening, {
              message:
                'Native focus changed during repository navigation; the newer learner focus was preserved.',
            })
            assert.equal(
              harness.focusedSource()?.document.uri.toString(),
              primary.document.uri.toString(),
            )
            assert.equal(
              primary.editor.selections[0]!.active.line,
              interaction === 'selection' ? 27 : 22,
            )
            assert.equal(
              primary.document.getText(),
              interaction === 'edit'
                ? 'New learner text.\n'
                : 'Original learner draft.\n',
            )
          }
          assert.equal(
            harness.commands.includes('vscode.setEditorLayout'),
            false,
          )
          assert.deepEqual(chat.layout(), {
            orientation: 1,
            groups: [{ size: 743 }],
          })
          assert.equal(original.document.getText(), 'Original learner draft.\n')
          assert.equal(harness.runtimes.length, 0)
        } finally {
          firstRead.release()
          releaseMeasured()
          await opening.catch(() => undefined)
          for (const receipt of receipts) receipt.dispose()
          await harness.close()
        }
      },
    )

test('first Study entry reserves all three main panes when a separate chat part already occupies a global column', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] })
  const chat = harness.addSeparateEditorPart(),
    draft = harness.focusMutableDraft()
  try {
    // Act
    await harness.reader.open()

    // Assert
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
    assert.equal(harness.panelColumn('codebook.studyContext'), 3)
    assert.equal(harness.groups.length, 4)
    assert.equal(harness.groups[3]!.tabs.includes(chat.tab), true)
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] })
    assert.equal(harness.groups[0]!.tabs.includes(draft.tab), true)
    assert.equal(draft.tab.isDirty, true)
    assert.equal(harness.reader.inspect().view!.errors.length, 0)
    assert.equal(harness.runtimes.length, 0)
  } finally {
    await harness.close()
  }
})

test('a second cold Open Study reports busy without creating Context before the first native reservation completes', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  const chat = harness.addSeparateEditorPart(),
    draft = harness.focusMutableDraft()
  const held = harness.holdNextCommand('vscode.getEditorLayout'),
    first = harness.reader.open()
  let second: Promise<unknown> | undefined
  const refreshProgress = harness.reader['refreshProgress'].bind(harness.reader)
  try {
    await held.started
    let prepared = (): void => {}
    const preparation = new Promise<void>((resolve) => {
      prepared = resolve
    })
    harness.reader['refreshProgress'] = async (): Promise<void> => {
      await refreshProgress()
      prepared()
    }

    // Act
    second = harness.reader.open().catch((error) => error)
    await Promise.race([preparation, second])
    await new Promise<void>((resolve) => setImmediate(resolve))

    // Assert
    assert.equal(harness.panelColumn('codebook.studyContext'), undefined)
    assert.equal(harness.reader.inspect().sourceUri, undefined)
    assert.deepEqual(harness.editorLayout(), {
      orientation: 0,
      groups: [{}, {}],
    })
    assert.equal(harness.groups.length, 3)
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] })
    const duplicate = await second
    assert.ok(duplicate instanceof Error && 'code' in duplicate)
    assert.equal(duplicate.code, 'BUSY')
    held.release()
    await first
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
    assert.equal(harness.panelColumn('codebook.studyContext'), 3)
    assert.equal(harness.reader.presentationState().layoutConfirmed, true)
    assert.equal(harness.groups[0]!.tabs.includes(draft.tab), true)
    assert.equal(draft.document.getText(), 'Original learner draft.\n')
    assert.equal(harness.groups[3]!.tabs.includes(chat.tab), true)
    assert.equal(harness.runtimes.length, 0)
  } finally {
    held.release()
    await Promise.allSettled([first, second])
    harness.reader['refreshProgress'] = refreshProgress
    await harness.close()
  }
})

test('a duplicate Open Study during initialization reports busy while the first entry remains usable', async () => {
  // Arrange
  const harness = await workspaceHarness(false),
    initialize = harness.reader['initialize'].bind(harness.reader)
  let release = (): void => {},
    initializeCalls = 0
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  harness.reader['initialize'] = async (): Promise<void> => {
    initializeCalls++
    await held
    await initialize()
  }
  const first = harness.reader.open()
  let second: Promise<unknown> | undefined
  try {
    // Act
    second = harness.reader.open().catch((error) => error)
    await new Promise<void>((resolve) => setImmediate(resolve))

    // Assert
    assert.equal(initializeCalls, 1)
    assert.equal(harness.panelColumn('codebook.studyContext'), undefined)
    const duplicate = await second
    assert.ok(duplicate instanceof Error && 'code' in duplicate)
    assert.equal(duplicate.code, 'BUSY')
    release()
    await first
    assert.equal(harness.reader.inspect().opened, true)
    assert.equal(harness.reader.presentationState().layoutConfirmed, true)
    assert.equal(harness.runtimes.length, 0)
  } finally {
    release()
    await Promise.allSettled([first, second])
    harness.reader['initialize'] = initialize
    await harness.close()
  }
})

// Value: protects=a cancelled Open Study reporting its own cancellation while it waits for an abandoned first entry; fails_when=the wait reports busy for a waiter whose own request was cancelled; why_new=Cycle 0034 O2 tests cover the release and the bound, not a cancelled waiter; seam=none
test('an Open Study cancelled while it waits for an abandoned first entry leaves with its own cancellation instead of reporting busy', async () => {
  // Arrange: the first entry was abandoned inside a native layout call that ignores cancellation, and a second entry waits for it.
  const harness = await workspaceHarness(false)
  const entry = harness.holdNextCommand('vscode.getEditorLayout'),
    abandonedEntry = new AbortController(),
    waitingEntry = new AbortController()
  const first = harness.reader
    .open(abandonedEntry.signal)
    .catch((error: unknown) => error)
  let second: Promise<unknown> | undefined
  try {
    await entry.started
    abandonedEntry.abort(new Error('First entry abandoned'))
    second = harness.reader
      .open(waitingEntry.signal)
      .catch((error: unknown) => error)
    await new Promise<void>((resolve) => setImmediate(resolve))

    // Act: the abandoned entry stays held, so only the waiter's own cancellation can settle it before the next macrotask.
    waitingEntry.abort(new Error('Second entry cancelled'))
    const outcome = await Promise.race([
      second,
      new Promise<string>((resolve) =>
        setImmediate(() => resolve('still waiting for the abandoned entry')),
      ),
    ])

    // Assert
    // The waiter leaves on its own cancellation, not when the five-second wait for the abandoned entry runs out.
    assert.equal(String(outcome), 'Error: Second entry cancelled')
  } finally {
    entry.release()
    await Promise.allSettled([first, second])
    await harness.close()
  }
})

// Value: protects=Open Study refusing to run beside a presentation change that began while it waited for an abandoned first entry; fails_when=open() checks idleness only before that wait; why_new=Cycle 0044 (0034-C5); seam=returningCurrent set as a presentation change would set it
test('an Open Study waiting for an abandoned first entry is refused when a presentation change starts during the wait', async () => {
  // Arrange: the first entry was abandoned inside a native layout call that ignores cancellation, and a second entry waits for it.
  const harness = await workspaceHarness(false)
  const entry = harness.holdNextCommand('vscode.getEditorLayout'),
    abandonedEntry = new AbortController()
  const first = harness.reader
    .open(abandonedEntry.signal)
    .catch((error: unknown) => error)
  let second: Promise<unknown> | undefined
  try {
    await entry.started
    abandonedEntry.abort(new Error('First entry abandoned'))
    second = harness.reader.open().catch((error: unknown) => error)
    await new Promise<void>((resolve) => setImmediate(resolve))

    // Act: a presentation change starts while the second entry waits, then the abandoned entry finishes.
    harness.reader['returningCurrent'] = 'learner'
    entry.release()
    const outcome = await second

    // Assert
    assert.ok(outcome instanceof Error && 'code' in outcome)
    assert.equal(outcome.code, 'PRESENTATION_UNAVAILABLE')
  } finally {
    harness.reader['returningCurrent'] = undefined
    entry.release()
    await Promise.allSettled([first, second])
    await harness.close()
  }
})

test('a failed cold initialization allows the next explicit Open Study to retry', async () => {
  // Arrange
  const harness = await workspaceHarness(false),
    initialize = harness.reader['initialize'].bind(harness.reader)
  harness.reader['initialize'] = async () => {
    throw new Error('Learning storage is temporarily unavailable.')
  }
  try {
    // Act
    await assert.rejects(
      harness.reader.open(),
      /Learning storage is temporarily unavailable/,
    )
    harness.reader['initialize'] = initialize
    await harness.reader.open()

    // Assert
    assert.equal(harness.reader.inspect().opened, true)
    assert.equal(harness.reader.presentationState().layoutConfirmed, true)
    assert.equal(harness.runtimes.length, 0)
  } finally {
    harness.reader['initialize'] = initialize
    await harness.close()
  }
})

test('background refresh cannot open captured source into Application before cold Study reserves its panes', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] })
  const chat = harness.addSeparateEditorPart(),
    draft = harness.focusMutableDraft()
  const arrange = harness.reader['arrange'].bind(harness.reader)
  let refreshed = false
  harness.reader['arrange'] = async (
    ...arguments_: Parameters<typeof arrange>
  ): Promise<void> => {
    // Run the ordinary polling callback after admission but before the initial native reservation.
    if (!refreshed) {
      refreshed = true
      await harness.reader['refresh']()
    }
    return arrange(...arguments_)
  }
  try {
    // Act
    await harness.reader.open()
    // Assert
    assert.deepEqual(
      { ...harness.reader.presentationState().panes },
      { appColumn: 1, sourceColumn: 2, contextColumn: 3 },
    )
    assert.equal(harness.reader.presentationState().layoutConfirmed, true)
    assert.equal(harness.groups[0]!.tabs.includes(draft.tab), true)
    assert.equal(draft.document.getText(), 'Original learner draft.\n')
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] })
    assert.equal(harness.runtimes.length, 0)
  } finally {
    harness.reader['arrange'] = arrange
    await harness.close()
  }
})

test('first Study cannot confirm a learner source move that covers Application during final arrangement', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  const arrange = harness.reader['arrange'].bind(harness.reader)
  harness.reader['arrange'] = async (
    ...arguments_: Parameters<typeof arrange>
  ): Promise<void> => {
    // The source is rendered before the final grid receipt; a learner move must not become successful placement.
    harness.moveSource(1)
    return arrange(...arguments_)
  }
  try {
    // Act
    await harness.reader.open()
    // Assert
    assert.deepEqual(
      { ...harness.reader.presentationState().panes },
      { appColumn: 1, sourceColumn: 1, contextColumn: 3 },
    )
    assert.equal(harness.reader.presentationState().layoutConfirmed, false)
    assert.equal(harness.runtimes.length, 0)
  } finally {
    harness.reader['arrange'] = arrange
    await harness.close()
  }
})

test('first Study entry waits for its explanation focus before confirming the final native layout', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] })
  const chat = harness.addSeparateEditorPart(),
    draft = harness.focusMutableDraft()
  harness.deferPanelFocus('codebook.studyContext', 1)
  try {
    // Act
    await harness.reader.open()
    // Assert
    assert.equal(harness.focusedPanel(), 'codebook.studyContext')
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
    assert.equal(harness.panelColumn('codebook.studyContext'), 3)
    assert.equal(harness.groups[0]!.tabs.includes(draft.tab), true)
    assert.equal(draft.document.getText(), 'Original learner draft.\n')
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] })
    assert.equal(harness.reader.inspect().view!.errors.length, 0)
  } finally {
    await harness.close()
  }
})

test('first Study entry confirms a visible explanation in the only editor part without a Context focus acknowledgement', async () => {
  // Arrange: another tab keeps native focus even after the Context tab becomes visible.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] })
  const draft = harness.focusMutableDraft()
  harness.onNextPanel('codebook.studyContext', (panel) => {
    const reveal = panel.reveal.bind(panel)
    panel.reveal = (column, preserveFocus): void => {
      reveal(column, preserveFocus)
      draft.focus()
    }
  })
  try {
    // Act
    await harness.reader.open()
    // Assert: the owned three-pane layout is measured without adopting an unconfirmed focus receipt.
    assert.equal(harness.panelColumn('codebook.studyContext'), 3)
    assert.equal(harness.reader.presentationState().layoutConfirmed, true)
    assert.notEqual(harness.focusedPanel(), 'codebook.studyContext')
    assert.equal(draft.document.getText(), 'Original learner draft.\n')
  } finally {
    await harness.close()
  }
})

test('first Study entry refuses an unfocused explanation when a second editor part makes scope ambiguous', async () => {
  // Arrange: a separate chat editor part makes tab visibility insufficient to identify the main grid.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] })
  harness.addSeparateEditorPart()
  const draft = harness.focusMutableDraft()
  harness.onNextPanel('codebook.studyContext', (panel) => {
    const reveal = panel.reveal.bind(panel)
    panel.reveal = (column, preserveFocus): void => {
      reveal(column, preserveFocus)
      draft.focus()
    }
  })
  try {
    // Act / Assert: no layout proof is granted after the requested native focus fails.
    await assert.rejects(
      harness.reader.open(),
      /Study explanation native focus/,
    )
    assert.equal(harness.reader.presentationState().layoutConfirmed, false)
    assert.equal(draft.document.getText(), 'Original learner draft.\n')
  } finally {
    await harness.close()
  }
})

test('first Study entry accepts its application tab registering during the initial native layout read', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] })
  const chat = harness.addSeparateEditorPart(),
    draft = harness.focusMutableDraft()
  harness.delayPanelRegistration('codebook.scopedBrowser', true)
  try {
    // Act
    await harness.reader.open()
    // Assert
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
    assert.equal(harness.panelColumn('codebook.studyContext'), 3)
    assert.equal(harness.groups.length, 4)
    assert.equal(harness.groups[0]!.tabs.includes(draft.tab), true)
    assert.equal(draft.document.getText(), 'Original learner draft.\n')
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] })
    assert.equal(harness.reader.inspect().view!.errors.length, 0)
    assert.equal(harness.runtimes.length, 0)
  } finally {
    await harness.close()
  }
})

for (const textReceipt of [
  'retained',
  'cleared',
  'cleared before registration',
  'cleared during layout',
] as const)
  test(`cold Study opens from Wiki when the covered background text receipt is ${textReceipt}`, async () => {
    // Arrange: ordinary VS Code keeps the most recent text editor while Wiki owns another group.
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] })
    const draft = harness.focusMutableDraft(),
      held = harness.holdTextFocusClear('codebook.repositoryWiki')
    const wiki = harness.openWiki(),
      registerPanel = harness.delayPanelRegistration('codebook.scopedBrowser')
    const layout =
      textReceipt === 'cleared during layout'
        ? harness.holdNextCommand('vscode.getEditorLayout')
        : undefined
    const opening = harness.reader.open()
    void opening.catch(() => undefined)
    try {
      await waitUntil(
        () => harness.panelColumn('codebook.scopedBrowser') !== undefined,
        'pending native application',
        1_000,
      )
      assert.equal(harness.groups[1]!.activeTab, wiki.nativeTab)
      assert.equal(harness.focusedSource(), draft.editor)
      // Act: creation covers that background editor without changing the native Wiki tab.
      if (textReceipt === 'cleared before registration') {
        held.release()
        await waitUntil(
          () => harness.focusedSource() === undefined,
          'early background text clear',
          1_000,
        )
      }
      registerPanel()
      if (textReceipt === 'cleared') {
        held.release()
        await Promise.resolve()
      }
      if (layout) {
        await layout.started
        held.release()
        await waitUntil(
          () => harness.focusedSource() === undefined,
          'late background text clear',
          1_000,
        )
        layout.release()
      }
      await opening
      // Assert
      assert.equal(harness.reader.presentationState().state, 'open')
      assert.equal(harness.reader.presentationState().layoutConfirmed, true)
      assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
      assert.equal(harness.panelColumn('codebook.studyContext'), 3)
      assert.equal(
        harness.groups.some((group) => group.tabs.includes(wiki.nativeTab)),
        true,
      )
      assert.equal(harness.groups[0]!.tabs.includes(draft.tab), true)
      assert.equal(draft.document.getText(), 'Original learner draft.\n')
      assert.equal(harness.reader.inspect().view!.errors.length, 0)
      assert.equal(harness.runtimes.length, 0)
    } finally {
      held.release()
      registerPanel()
      layout?.release()
      await opening.catch(() => undefined)
      await harness.close()
    }
  })

for (const clearAt of ['before registration', 'during layout'] as const)
  for (const departure of [
    'different webview',
    'webview roundtrip',
    'different text',
    'text roundtrip',
  ] as const)
    test(`cold Wiki-to-Study layout preserves ${departure} when background text clears ${clearAt}`, async () => {
      // Arrange
      const harness = await workspaceHarness(false)
      harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
      const draft = harness.focusMutableDraft(),
        otherWiki = harness.openWiki()
      draft.focus()
      const held = harness.holdTextFocusClear('codebook.repositoryWiki'),
        wiki = harness.openWiki()
      const registerPanel = harness.delayPanelRegistration(
          'codebook.scopedBrowser',
        ),
        layout = harness.holdNextCommand('vscode.getEditorLayout')
      const opening = harness.reader.open(),
        rejected = assert.rejects(
          opening,
          /Native pane, group or focus changed/,
        )
      try {
        await waitUntil(
          () => harness.panelColumn('codebook.scopedBrowser') !== undefined,
          'pending native application',
          1_000,
        )
        if (clearAt === 'before registration') {
          held.release()
          await waitUntil(
            () => harness.focusedSource() === undefined,
            'early background text clear',
            1_000,
          )
        }
        registerPanel()
        await layout.started
        // Act: the clear belongs to background coverage, but the native Wiki tab no longer belongs to this Open.
        held.release()
        await waitUntil(
          () => harness.focusedSource() === undefined,
          'late background text clear',
          1_000,
        )
        if (departure.includes('text')) draft.focus()
        else harness.focusExistingWebviewTab(otherWiki.nativeTab)
        if (departure.endsWith('roundtrip'))
          harness.focusExistingWebviewTab(wiki.nativeTab)
        layout.release()
        await rejected
        // Assert
        assert.equal(
          harness.groups[1]!.activeTab,
          departure === 'different webview'
            ? otherWiki.nativeTab
            : wiki.nativeTab,
        )
        assert.equal(harness.groups[1]!.tabs.includes(wiki.nativeTab), true)
        assert.equal(harness.commands.includes('vscode.setEditorLayout'), false)
        assert.equal(harness.panelColumn('codebook.studyContext'), undefined)
        assert.equal(harness.reader.presentationState().state, 'closed')
        assert.equal(draft.document.getText(), 'Original learner draft.\n')
        assert.equal(harness.runtimes.length, 0)
      } finally {
        held.release()
        registerPanel()
        layout.release()
        await opening.catch(() => undefined)
        await harness.close()
      }
    })

for (const replaceAt of ['registration', 'layout'] as const)
  test(`cold Study rejects closing Wiki and opening a lookalike during ${replaceAt}`, async () => {
    // Arrange
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
    const draft = harness.focusMutableDraft(),
      held = harness.holdTextFocusClear('codebook.repositoryWiki'),
      wiki = harness.openWiki()
    const registerPanel = harness.delayPanelRegistration(
      'codebook.scopedBrowser',
    )
    const layout =
      replaceAt === 'layout'
        ? harness.holdNextCommand('vscode.getEditorLayout')
        : undefined
    const opening = harness.reader.open(),
      rejected = assert.rejects(opening, /Native pane|Native panes/)
    try {
      await waitUntil(
        () => harness.panelColumn('codebook.scopedBrowser') !== undefined,
        'pending native application',
        1_000,
      )
      held.release()
      await waitUntil(
        () => harness.focusedSource() === undefined,
        'background text clear',
        1_000,
      )
      if (layout) {
        registerPanel()
        await layout.started
      }
      // Act: identical type/title/content cannot confer the closed tab's focus ownership on a new tab.
      const replacement = harness.replaceActiveWebviewTab()
      registerPanel()
      layout?.release()
      await rejected
      // Assert
      assert.equal(harness.groups[1]!.activeTab, replacement)
      assert.equal(harness.groups[1]!.tabs.includes(wiki.nativeTab), false)
      assert.equal(harness.commands.includes('vscode.setEditorLayout'), false)
      assert.equal(harness.panelColumn('codebook.studyContext'), undefined)
      assert.equal(harness.reader.presentationState().state, 'closed')
      assert.equal(draft.document.getText(), 'Original learner draft.\n')
      assert.equal(harness.runtimes.length, 0)
    } finally {
      held.release()
      registerPanel()
      layout?.release()
      await opening.catch(() => undefined)
      await harness.close()
    }
  })

test('failed cold application creation releases temporary native listeners and preserves learner panes', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  const draft = harness.focusMutableDraft(),
    listeners = harness.focusListenerCount()
  harness.failNextPanelCreation('codebook.scopedBrowser')
  try {
    // Act
    await assert.rejects(
      harness.reader.open(),
      /Injected native panel creation failure/,
    )
    // Assert
    assert.equal(harness.focusListenerCount(), listeners)
    assert.equal(harness.groups[0]!.activeTab, draft.tab)
    assert.equal(draft.document.getText(), 'Original learner draft.\n')
    assert.equal(harness.counts().panels, 0)
    assert.equal(harness.runtimes.length, 0)
    assert.equal(harness.reader.presentationState().state, 'closed')
  } finally {
    await harness.close()
  }
})

test('presentation preserves a replacement Wiki while its prior background source receipt remains visible', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  let releaseCapture = (): void => {},
    releaseText = (): void => {},
    changing: Promise<unknown> | undefined
  try {
    await harness.reader.open()
    const draft = harness.focusMutableDraft('background-notes.txt', 1)
    const held = harness.holdTextFocusClear('codebook.repositoryWiki')
    releaseText = held.release
    harness.openWiki()
    const panel = harness.reader['contextPanel']
    assert.ok(panel)
    const originalPost = panel.webview.postMessage.bind(panel.webview),
      state = harness.reader.presentationState()
    let observed!: () => void
    const captureStarted = new Promise<void>((resolve) => {
      observed = resolve
    })
    panel.webview.postMessage = (message) => {
      if (message.type !== 'capture-presentation-pose')
        return originalPost(message)
      releaseCapture = (): void => {
        void originalPost(message)
      }
      observed()
      return Promise.resolve(true)
    }
    changing = harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'living-book',
      action: 'select',
    })
    const rejected = assert.rejects(changing, {
      code: 'PRESENTATION_UNAVAILABLE',
      causeDetail: /Native pane, group or focus changed/,
    })
    await captureStarted
    const commandsBeforeDeparture = [...harness.commands]
    // Act: a group wrapper can legitimately refresh after a learner closes the old Wiki and opens a new one.
    const replacement = harness.replaceActiveWebviewTab()
    harness.replaceEditorGroup('wrapper', 2)
    releaseCapture()
    await rejected
    // Assert
    assert.equal(harness.groups[1]!.activeTab, replacement)
    assert.equal(harness.reader.presentationState().mode, 'study-workspace')
    assert.equal(harness.presentationPreferences.size, 0)
    assert.equal(harness.runtimes.length, 0)
    assert.equal(draft.document.getText(), 'Original learner draft.\n')
    assert.deepEqual(harness.commands, commandsBeforeDeparture)
  } finally {
    releaseCapture()
    releaseText()
    await changing?.catch(() => undefined)
    await harness.close()
  }
})

for (const refreshAt of ['registration', 'layout'] as const)
  test(`cold Study accepts a verified Wiki group and tab wrapper refresh during ${refreshAt}`, async () => {
    // Arrange
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    const draft = harness.focusMutableDraft(),
      held = harness.holdTextFocusClear('codebook.repositoryWiki')
    const wiki = harness.openWiki()
    const registerPanel = harness.delayPanelRegistration(
      'codebook.scopedBrowser',
    )
    const layout =
      refreshAt === 'layout'
        ? harness.holdNextCommand('vscode.getEditorLayout')
        : undefined
    const opening = harness.reader.open()
    void opening.catch(() => undefined)
    try {
      await waitUntil(
        () => harness.panelColumn('codebook.scopedBrowser') !== undefined,
        'pending native application',
        1_000,
      )
      held.release()
      await waitUntil(
        () => harness.focusedSource() === undefined,
        'background text clear',
        1_000,
      )
      if (layout) {
        registerPanel()
        await layout.started
      }
      // Act: the host reports changed wrappers without closing or opening the underlying Wiki tab.
      wiki.refreshTabWrapper()
      harness.replaceEditorGroup('wrapper', 2)
      registerPanel()
      layout?.release()
      await opening
      // Assert
      assert.equal(harness.reader.presentationState().state, 'open')
      assert.equal(harness.reader.presentationState().layoutConfirmed, true)
      assert.equal(draft.document.getText(), 'Original learner draft.\n')
      assert.equal(harness.reader.inspect().view!.errors.length, 0)
      assert.equal(harness.runtimes.length, 0)
    } finally {
      held.release()
      registerPanel()
      layout?.release()
      await opening.catch(() => undefined)
      await harness.close()
    }
  })

test('cold Wiki-to-Study registration rejects clearing text in a group the new application does not cover', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  const draft = harness.focusMutableDraft('third-group-notes.txt', 3),
    held = harness.holdTextFocusClear('codebook.repositoryWiki')
  const wiki = harness.openWiki(),
    registerPanel = harness.delayPanelRegistration('codebook.scopedBrowser')
  const opening = harness.reader.open(),
    rejected = assert.rejects(opening, /Native panes or learner focus changed/)
  try {
    await waitUntil(
      () => harness.panelColumn('codebook.scopedBrowser') !== undefined,
      'pending native application',
      1_000,
    )
    // Act: this clear cannot be explained by the requested first-column application.
    registerPanel()
    held.release()
    await rejected
    // Assert
    assert.equal(harness.groups[1]!.activeTab, wiki.nativeTab)
    assert.equal(harness.groups[2]!.activeTab, draft.tab)
    assert.equal(harness.commands.includes('vscode.setEditorLayout'), false)
    assert.equal(harness.panelColumn('codebook.studyContext'), undefined)
    assert.equal(harness.reader.presentationState().state, 'closed')
    assert.equal(draft.document.getText(), 'Original learner draft.\n')
    assert.equal(harness.runtimes.length, 0)
  } finally {
    held.release()
    registerPanel()
    await opening.catch(() => undefined)
    await harness.close()
  }
})

for (const departure of [
  'different webview',
  'webview roundtrip',
  'different text',
  'text roundtrip',
] as const)
  test(`${departure} during cold Wiki-to-Study registration preserves the newer learner choice`, async () => {
    // Arrange: both webviews already exist, so switching them does not change tab contents or group count.
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
    const otherDraft = harness.focusMutableDraft('other-notes.txt', 2),
      source = harness.focusMutableDraft()
    const otherWiki = harness.openWiki()
    source.focus()
    const held = harness.holdTextFocusClear('codebook.repositoryWiki'),
      wiki = harness.openWiki()
    const registerPanel = harness.delayPanelRegistration(
      'codebook.scopedBrowser',
    )
    const opening = harness.reader.open()
    const rejected = assert.rejects(
      opening,
      /Native panes or learner focus changed/,
    )
    try {
      await waitUntil(
        () => harness.panelColumn('codebook.scopedBrowser') !== undefined,
        'pending native application',
        1_000,
      )
      // Act: deliver an actual tab-only event; unchanged background text cannot hide a newer webview choice.
      if (departure.includes('text')) otherDraft.focus()
      else harness.focusExistingWebviewTab(otherWiki.nativeTab)
      if (departure.endsWith('roundtrip'))
        harness.focusExistingWebviewTab(wiki.nativeTab)
      registerPanel()
      await rejected
      // Assert
      assert.equal(harness.commands.includes('vscode.setEditorLayout'), false)
      assert.equal(harness.panelColumn('codebook.studyContext'), undefined)
      assert.equal(harness.reader.presentationState().state, 'closed')
      assert.equal(source.document.getText(), 'Original learner draft.\n')
      assert.equal(otherDraft.document.getText(), 'Original learner draft.\n')
      assert.equal(harness.groups[1]!.tabs.includes(otherDraft.tab), true)
      assert.equal(harness.runtimes.length, 0)
    } finally {
      held.release()
      registerPanel()
      await opening.catch(() => undefined)
      await harness.close()
    }
  })

test('first Study entry does not resize chat while a new application panel only reports optimistic focus', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] })
  const chat = harness.addSeparateEditorPart(),
    draft = harness.focusMutableDraft()
  const registerPanel = harness.delayPanelRegistration('codebook.scopedBrowser')
  chat.focus()
  const opening = harness.reader.open()
  void opening.catch(() => undefined)
  try {
    // Act
    await waitUntil(
      () => harness.panelColumn('codebook.scopedBrowser') !== undefined,
      'pending native application',
      1_000,
    )
    // Assert: the main editor was measured before the pane existed, with the one focus hand-over to the learner's file (Cycle 0045 S1-F3; the hand-over followed the pane's registration before). The pane's provisional wrapper flags authorize no layout command against the chat part.
    const focusHandOvers = (): number =>
      harness.commands.filter(
        (command) => command === 'workbench.action.focusFirstEditorGroup',
      ).length
    assert.equal(focusHandOvers(), 1)
    assert.equal(harness.commands.includes('vscode.setEditorLayout'), false)
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] })
    registerPanel()
    await opening
    assert.equal(focusHandOvers(), 1)
    assert.equal(harness.panelColumn('codebook.studyContext'), 3)
    assert.equal(harness.groups[3]!.tabs.includes(chat.tab), true)
    assert.equal(harness.groups[0]!.tabs.includes(draft.tab), true)
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] })
    // The chat, which held the keyboard when the entry began, has it again.
    assert.equal(chat.focused(), true)
  } finally {
    registerPanel()
    await opening.catch(() => undefined)
    await harness.close()
  }
})

test('chat focus acquired during application registration prevents first Study from arranging either editor part', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] })
  const chat = harness.addSeparateEditorPart(),
    draft = harness.focusMutableDraft()
  const registerPanel = harness.delayPanelRegistration('codebook.scopedBrowser')
  const opening = harness.reader.open()
  const rejected = assert.rejects(
    opening,
    /learner focus changed while the new application registered/,
  )
  try {
    // Act
    await waitUntil(
      () => harness.panelColumn('codebook.scopedBrowser') !== undefined,
      'pending native application',
      1_000,
    )
    chat.focus()
    registerPanel()
    await rejected
    // Assert
    assert.equal(chat.focused(), true)
    assert.equal(harness.commands.includes('vscode.setEditorLayout'), false)
    assert.equal(
      harness.commands.includes('workbench.action.focusFirstEditorGroup'),
      false,
    )
    assert.equal(harness.panelColumn('codebook.studyContext'), undefined)
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] })
    assert.equal(draft.document.getText(), 'Original learner draft.\n')
    assert.equal(harness.groups[0]!.tabs.includes(draft.tab), true)
  } finally {
    registerPanel()
    await opening.catch(() => undefined)
    await harness.close()
  }
})

for (const change of ['foreign tab', 'replacement group'] as const)
  test(`a ${change} during application registration prevents first Study from adopting the changed layout`, async () => {
    // Arrange
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] })
    const chat = harness.addSeparateEditorPart(),
      draft = harness.focusMutableDraft()
    const registerPanel = harness.delayPanelRegistration(
      'codebook.scopedBrowser',
    )
    const opening = harness.reader.open()
    const rejected = assert.rejects(
      opening,
      /Native panes or learner focus changed/,
    )
    try {
      // Act
      await waitUntil(
        () => harness.panelColumn('codebook.scopedBrowser') !== undefined,
        'pending native application',
        1_000,
      )
      if (change === 'foreign tab') harness.addForeignDraft(1)
      else harness.resyncEditorGroups('replace')
      registerPanel()
      await rejected
      // Assert
      assert.equal(harness.commands.includes('vscode.setEditorLayout'), false)
      assert.equal(harness.panelColumn('codebook.studyContext'), undefined)
      assert.deepEqual(chat.layout(), {
        orientation: 1,
        groups: [{ size: 743 }],
      })
      assert.equal(draft.document.getText(), 'Original learner draft.\n')
      assert.equal(harness.runtimes.length, 0)
    } finally {
      registerPanel()
      await opening.catch(() => undefined)
      await harness.close()
    }
  })

for (const retirement of ['cancel', 'Close'] as const)
  test(`${retirement} during application registration cannot reserve panes after the late native tab appears`, async () => {
    // Arrange
    const harness = await workspaceHarness(false),
      cancellation = new AbortController()
    harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] })
    const chat = harness.addSeparateEditorPart(),
      draft = harness.focusMutableDraft()
    const registerPanel = harness.delayPanelRegistration(
      'codebook.scopedBrowser',
    )
    const opening = harness.reader.open(cancellation.signal)
    const rejected = assert.rejects(
      opening,
      retirement === 'cancel' ? /abort/i : /closed/i,
    )
    try {
      // Act
      await waitUntil(
        () => harness.panelColumn('codebook.scopedBrowser') !== undefined,
        'pending native application',
        1_000,
      )
      if (retirement === 'cancel') cancellation.abort()
      const closing =
        retirement === 'Close' ? harness.reader.close() : Promise.resolve()
      registerPanel()
      await rejected
      await closing
      // Assert
      assert.equal(harness.commands.includes('vscode.setEditorLayout'), false)
      assert.equal(harness.panelColumn('codebook.studyContext'), undefined)
      assert.deepEqual(chat.layout(), {
        orientation: 1,
        groups: [{ size: 743 }],
      })
      assert.equal(harness.groups[0]!.tabs.includes(draft.tab), true)
      assert.equal(draft.document.getText(), 'Original learner draft.\n')
    } finally {
      await opening.catch(() => undefined)
      await harness.close()
    }
  })

test('an existing three-pane Study can restore its presentation while preserving a separate chat part', async () => {
  // Arrange
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  const chat = harness.addSeparateEditorPart()
  try {
    await harness.reader.open()
    const presentation = harness.reader.presentationState()

    // Act
    const result = await harness.reader.changePresentation({
      presentationId: presentation.presentationId,
      expectedRevision: presentation.presentationControlRevision,
      mode: 'living-book',
      action: 'restore',
    })

    // Assert
    assert.equal(result.mode, 'living-book')
    assert.equal(result.layoutConfirmed, true)
    assert.equal(harness.groups.length, 4)
    assert.equal(harness.groups[3]!.tabs.includes(chat.tab), true)
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] })
    assert.equal(harness.runtimes.length, 0)
  } finally {
    await harness.close()
  }
})

test('Wiki entry from a retained Study keeps Context focus when the native primary webview emits a late focus event', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  const chat = harness.addSeparateEditorPart(),
    draft = harness.focusMutableDraft()
  await harness.reader.open()
  harness.deferPrimaryFocusEcho()
  try {
    // Act
    await harness.reader.arrangeRepository(new AbortController().signal)
    // Assert
    assert.deepEqual(harness.editorLayout(), {
      orientation: 0,
      groups: [{}, {}, {}],
    })
    assert.equal(harness.focusedPanel(), 'codebook.studyContext')
    assert.equal(harness.groups.length, 4)
    assert.equal(harness.groups[3]!.tabs.includes(chat.tab), true)
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] })
    assert.equal(harness.groups[0]!.tabs.includes(draft.tab), true)
    assert.equal(draft.document.getText(), 'Original learner draft.\n')
    assert.equal(harness.runtimes.length, 0)
  } finally {
    await harness.close()
  }
})

test('Wiki entry from focused chat preserves its separate pane when its layout read reports a stale matching main grid', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  const chat = harness.addSeparateEditorPart()
  const draft = harness.focusMutableDraft()
  await harness.reader.open()
  chat.focus()
  // Fault injection changes only the API report; the separate part still contains exactly one real native group.
  harness.reportSeparatePartLayout({
    orientation: 0,
    groups: [
      { size: 0.55, groups: [{ size: 0.5 }, { size: 0.5 }] },
      { size: 0.45 },
    ],
  })
  try {
    // Act
    await harness.reader.arrangeRepository(new AbortController().signal)
    // Assert
    assert.deepEqual(harness.editorLayout(), {
      orientation: 0,
      groups: [{}, {}, {}],
    })
    // Explicit Wiki navigation establishes main focus; foreign chat contents and geometry remain untouched.
    assert.equal(chat.focused(), false)
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] })
    assert.equal(harness.groups.length, 4)
    assert.equal(harness.groups[3]!.tabs.includes(chat.tab), true)
    assert.equal(harness.groups[0]!.tabs.includes(draft.tab), true)
    assert.equal(draft.document.getText(), 'Original learner draft.\n')
    assert.equal(harness.runtimes.length, 0)
  } finally {
    await harness.close()
  }
})

test('a real fourth main pane remains learner-owned even when its tab list is empty and a separate chat part exists', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({
    orientation: 0,
    groups: [{ size: 220 }, { size: 220 }, { size: 220 }, { size: 220 }],
  })
  const chat = harness.addSeparateEditorPart(),
    draft = harness.focusMutableDraft(),
    originalLayout = harness.editorLayout()
  try {
    // Act
    await harness.reader.open()

    // Assert
    assert.deepEqual(harness.editorLayout(), originalLayout)
    assert.equal(harness.groups.length, 5)
    assert.deepEqual(harness.groups[3]!.tabs, [])
    assert.equal(harness.groups[4]!.tabs.includes(chat.tab), true)
    assert.equal(harness.groups[0]!.tabs.includes(draft.tab), true)
    assert.equal(draft.document.getText(), 'Original learner draft.\n')
    assert.equal(harness.commands.includes('vscode.setEditorLayout'), false)
    assert.equal(
      harness.reader
        .inspect()
        .view!.errors.some((error) =>
          error.includes('Existing editor groups were preserved'),
        ),
      true,
    )
  } finally {
    await harness.close()
  }
})

test('cold Wiki entry from the focused chat measures and reserves only the main editor grid', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] })
  const chat = harness.addSeparateEditorPart(),
    draft = harness.focusMutableDraft()
  const receipts: ReturnType<typeof harness.retainRepositoryFocus>[] = []
  chat.focus()
  try {
    // Act
    await harness.reader.arrangeRepository(
      new AbortController().signal,
      undefined,
      {
        begin() {},
        retainCurrentFocus(acquire) {
          const receipt = harness.retainRepositoryFocus(acquire)
          receipts.push(receipt)
          return receipt
        },
      },
    )
    // Assert
    assert.equal(harness.groups.length, 3)
    assert.equal(harness.groups[2]!.tabs.includes(chat.tab), true)
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] })
    assert.equal(
      harness.commands.filter(
        (command) => command === 'workbench.action.focusFirstEditorGroup',
      ).length,
      1,
    )
    assert.equal(harness.groups[0]!.tabs.includes(draft.tab), true)
    assert.equal(draft.document.getText(), 'Original learner draft.\n')
    assert.equal(harness.runtimes.length, 0)
  } finally {
    for (const receipt of receipts) receipt.dispose()
    await harness.close()
  }
})

for (const primary of ['blank', 'settings'] as const)
  test(`cold Wiki resolves ${primary} primary focus through its real citation while retaining the draft and chat part`, async () => {
    // Arrange
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({
      orientation: 1,
      groups: [{ size: 330 }, { size: 330 }],
    })
    const original = harness.groups[0]!,
      opaqueTab = harness.useOpaquePrimary(primary),
      draft = harness.addForeignDraft(2)
    const chat = harness.addSeparateEditorPart()
    chat.focus()
    let acquisitions = 0
    try {
      // Act
      await harness.reader.arrangeRepository(
        new AbortController().signal,
        undefined,
        {
          begin() {},
          acquireSourceFocus: async () => {
            acquisitions++
            harness.focusMutableDraft()
            return (): void => {
              assert.equal(chat.focused(), false)
            }
          },
          retainCurrentFocus() {
            const focused = chat.focused()
            let disposed = false
            return {
              dispose(): void {
                disposed = true
              },
              assertRetained(): void {
                assert.equal(disposed, false)
                assert.equal(chat.focused(), focused)
              },
            }
          },
        },
      )
      // Assert
      assert.equal(acquisitions, 1)
      assert.equal(harness.groups[0], original)
      if (opaqueTab) assert.equal(original.tabs.includes(opaqueTab), true)
      assert.equal(harness.groups[1]!.tabs.includes(draft), true)
      assert.equal(draft.isDirty, true)
      assert.equal(harness.groups[2]!.tabs.includes(chat.tab), true)
      assert.deepEqual(chat.layout(), {
        orientation: 1,
        groups: [{ size: 743 }],
      })
      assert.equal(harness.commands.includes('vscode.setEditorLayout'), false)
      assert.equal(harness.runtimes.length, 0)
    } finally {
      await harness.close()
    }
  })

test('opening Wiki after Study acquires its citation from a Settings-focused main pane without changing chat or drafts', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] })
  const chat = harness.addSeparateEditorPart(),
    draft = harness.focusMutableDraft()
  await harness.reader.open()
  const retainedTabs = [...harness.groups[0]!.tabs],
    settings = harness.useOpaquePrimary('settings')
  harness.groups[0]!.tabs.push(...retainedTabs)
  chat.focus()
  let acquisitions = 0
  try {
    // Act
    await harness.reader.arrangeRepository(
      new AbortController().signal,
      undefined,
      {
        begin() {},
        acquireSourceFocus: async () => {
          acquisitions++
          harness.focusMutableDraft()
          return (): void => {
            assert.equal(chat.focused(), false)
          }
        },
      },
    )
    // Assert
    assert.equal(acquisitions, 1)
    assert.equal(harness.groups.length, 4)
    assert.equal(harness.groups[0]!.tabs.includes(settings!), true)
    assert.equal(harness.groups[0]!.tabs.includes(draft.tab), true)
    assert.equal(draft.document.getText(), 'Original learner draft.\n')
    assert.equal(harness.groups[3]!.tabs.includes(chat.tab), true)
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] })
    assert.deepEqual(harness.editorLayout(), {
      orientation: 0,
      groups: [{}, {}, {}],
    })
    assert.equal(harness.runtimes.length, 0)
  } finally {
    await harness.close()
  }
})

for (const primary of ['application', 'text'])
  test(`a learner tab selected while borrowing ${primary} primary focus prevents a late Wiki arrangement or focus restoration`, async () => {
    // Arrange
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
    const chat = harness.addSeparateEditorPart(),
      draft = harness.focusMutableDraft()
    await harness.reader.open()
    if (primary === 'text') harness.focusMutableDraft('primary.ts')
    harness.movePanel('codebook.studyContext', 3)
    // A manual geometry change invalidates the retained scope proof and requires an observable primary-focus measurement.
    harness.changeEditorLayout({
      orientation: 1,
      groups: [{ size: 200 }, { size: 300 }, { size: 400 }],
    })
    const original = harness.editorLayout(),
      mutations = harness.commands.filter(
        (command) => command === 'vscode.setEditorLayout',
      ).length
    const held = harness.holdNextCommand(
      'workbench.action.focusFirstEditorGroup',
    )
    const arranging = harness.reader.arrangeRepository(
        new AbortController().signal,
      ),
      rejected = assert.rejects(arranging, /primary editor selection changed/i)
    try {
      // Act
      await held.started
      draft.focus()
      held.release()
      await rejected
      // Assert
      assert.equal(harness.groups[0]!.activeTab, draft.tab)
      assert.equal(harness.focusedPanel(), undefined)
      assert.deepEqual(harness.editorLayout(), original)
      assert.equal(
        harness.commands.filter(
          (command) => command === 'vscode.setEditorLayout',
        ).length,
        mutations,
      )
      assert.equal(draft.document.getText(), 'Original learner draft.\n')
      assert.deepEqual(chat.layout(), {
        orientation: 1,
        groups: [{ size: 743 }],
      })
      assert.equal(harness.runtimes.length, 0)
    } finally {
      held.release()
      await arranging.catch(() => {})
      await harness.close()
    }
  })

test('a queued Wiki after Study preserves later learner focus before measuring an owned layout', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] })
  const draft = harness.focusMutableDraft(),
    chat = harness.addSeparateEditorPart()
  await harness.reader.open()
  const original = harness.editorLayout(),
    mutations = harness.commands.filter(
      (command) => command === 'vscode.setEditorLayout',
    ).length
  const held = harness.holdNextCommand('vscode.getEditorLayout')
  const earlier = harness.reader.arrangeRepository(
      new AbortController().signal,
    ),
    earlierRejected = assert.rejects(earlier, /changed/)
  await held.started
  let retained = true,
    starts = 0
  const queued = harness.reader.arrangeRepository(
    new AbortController().signal,
    undefined,
    {
      begin() {
        starts++
        if (!retained) throw new Error('Original learner focus changed.')
      },
    },
  )
  const queuedRejected = assert.rejects(
    queued,
    /Original learner focus changed/,
  )
  try {
    // Act
    retained = false
    chat.focus()
    held.release()
    await earlierRejected
    await queuedRejected
    // Assert
    assert.equal(starts, 1)
    assert.equal(chat.focused(), true)
    assert.deepEqual(harness.editorLayout(), original)
    assert.equal(
      harness.commands.filter((command) => command === 'vscode.setEditorLayout')
        .length,
      mutations,
    )
    assert.equal(harness.groups[0]!.tabs.includes(draft.tab), true)
    assert.equal(draft.document.getText(), 'Original learner draft.\n')
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] })
    assert.equal(harness.runtimes.length, 0)
  } finally {
    held.release()
    await Promise.allSettled([earlier, queued])
    await harness.close()
  }
})

test('cold Wiki retains ordinary text focus without invoking the optional cited-source acquisition', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] })
  harness.focusMutableDraft()
  const chat = harness.addSeparateEditorPart()
  let acquisitions = 0
  try {
    // Act
    await harness.reader.arrangeRepository(
      new AbortController().signal,
      undefined,
      {
        begin() {},
        acquireSourceFocus: async () => {
          acquisitions++
          return (): void => {}
        },
      },
    )
    // Assert
    assert.equal(acquisitions, 0)
    assert.equal(harness.groups.length, 3)
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] })
  } finally {
    await harness.close()
  }
})

/** Counts the tabs of one Codebook pane kind, in the registered or the main-thread form, for the dead-pane entry tests. @example codebookPaneTabs(harness, 'codebook.scopedBrowser') // 1 */
const codebookPaneTabs = (
  harness: Awaited<ReturnType<typeof workspaceHarness>>,
  kind: 'codebook.scopedBrowser' | 'codebook.studyContext',
): number =>
  harness.groups
    .flatMap((group) => group.tabs)
    .filter(
      (tab) =>
        'viewType' in tab.input &&
        [kind, `mainThreadWebview-${kind}`].includes(tab.input.viewType),
    ).length

test('a Learning Outline click after an extension-host restart closes the old host’s dead panes and opens one Application and one Study pane', async () => {
  // Arrange: the old host's Application pane is the visible tab of column 1, its Study pane sits in column 3 behind the focused learner draft, and the new Application panel registers a moment after it is created.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  try {
    const articleSource = harness.groups[0]!.tabs[0]!,
      wiki = harness.groups[1]!.tabs[0]!
    const deadApplication = harness.leaveDeadCodebookPane(
        'codebook.scopedBrowser',
        1,
      ),
      deadStudy = harness.leaveDeadCodebookPane('codebook.studyContext', 3)
    const draft = harness.focusMutableDraft('mutable-notes.txt', 3)
    harness.delayPanelRegistration('codebook.scopedBrowser', true)
    // Act
    await harness.reader.select('repository/workspace/overview')
    // Assert
    const tabs = harness.groups.flatMap((group) => group.tabs)
    assert.equal(harness.reader.presentationState().state, 'open')
    assert.equal(harness.reader.presentationState().layoutConfirmed, true)
    assert.equal(tabs.includes(deadApplication), false)
    assert.equal(tabs.includes(deadStudy), false)
    assert.equal(codebookPaneTabs(harness, 'codebook.scopedBrowser'), 1)
    assert.equal(codebookPaneTabs(harness, 'codebook.studyContext'), 1)
    assert.equal(tabs.includes(draft.tab), true)
    assert.equal(tabs.includes(articleSource), true)
    assert.equal(tabs.includes(wiki), true)
    assert.equal(harness.reader.inspect().view!.errors.length, 0)
  } finally {
    await harness.close()
  }
})

test('opening a recording after an extension-host restart closes the old host’s dead Application pane and presents the recording in one Application pane', async () => {
  // Arrange: the old host's Application pane is the visible tab of column 1 and a captured source it left has focus in column 2; the new Application panel registers a moment after it is created.
  const harness = await recordedReaderHarness(true)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  try {
    const articleSource = harness.groups[0]!.tabs[0]!,
      wiki = harness.groups[1]!.tabs[0]!
    const deadApplication = harness.leaveDeadCodebookPane(
      'codebook.scopedBrowser',
      1,
    )
    harness.restoreLeftoverCapturedSource({ column: 2 })
    harness.delayPanelRegistration('codebook.scopedBrowser', true)
    // Act
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    // Assert: a recording uses the summary sidebar, so the editor area holds the Application pane and no Study pane.
    const tabs = harness.groups.flatMap((group) => group.tabs)
    assert.equal(harness.reader.presentationState().state, 'open')
    assert.equal(harness.reader.presentationState().layoutConfirmed, true)
    assert.equal(tabs.includes(deadApplication), false)
    assert.equal(codebookPaneTabs(harness, 'codebook.scopedBrowser'), 1)
    assert.equal(codebookPaneTabs(harness, 'codebook.studyContext'), 0)
    assert.equal(tabs.includes(articleSource), true)
    assert.equal(tabs.includes(wiki), true)
    assert.equal(harness.reader.inspect().view!.errors.length, 0)
  } finally {
    await harness.close()
  }
})

// Value: protects=a cold open asks the editor to close the dead panes and goes on when the editor keeps one; fails_when=the cold open no longer sends the close request, or stops over the refusal; why_new=Cycle 0044 0037-D8: the earlier assertions held without the close step and with a fake editor that closed all tabs or none; seam=leaveDeadCodebookPane refuseClose, tabCloseRequests
test('a dead Codebook pane the editor refuses to close does not stop the Study workspace from opening', async () => {
  // Arrange: the editor keeps the dead Application pane of column 1, as it may for a tab it cannot release, and lets the dead Study pane of column 3 close.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  try {
    const deadApplication = harness.leaveDeadCodebookPane(
        'codebook.scopedBrowser',
        1,
        { refuseClose: true },
      ),
      deadStudy = harness.leaveDeadCodebookPane('codebook.studyContext', 3)
    const draft = harness.focusMutableDraft('mutable-notes.txt', 3)
    // Act
    await harness.reader.open()
    // Assert: the reader opens beside the pane that stayed.
    const tabs = harness.groups.flatMap((group) => group.tabs)
    assert.deepEqual(harness.tabCloseRequests()[0], [
      deadApplication,
      deadStudy,
    ])
    assert.equal(harness.reader.presentationState().state, 'open')
    assert.equal(tabs.includes(deadApplication), true)
    assert.equal(tabs.includes(deadStudy), false)
    assert.equal(tabs.includes(draft.tab), true)
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
    assert.equal(harness.panelColumn('codebook.studyContext'), 3)
  } finally {
    await harness.close()
  }
})

// Value: protects=a cold open goes on when the editor rejects its close request; fails_when=the rejection of the close request ends the open; why_new=Cycle 0044 0037-D8: the fake editor could refuse a close but never reject the request; seam=rejectNextTabClose
test('a close request the editor rejects does not stop the Study workspace from opening', async () => {
  // Arrange: the editor rejects the close request, as it does when the request is cancelled.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  try {
    const deadStudy = harness.leaveDeadCodebookPane('codebook.studyContext', 3)
    harness.focusMutableDraft('mutable-notes.txt', 3)
    harness.rejectNextTabClose()
    // Act
    await harness.reader.open()
    // Assert
    assert.deepEqual(harness.tabCloseRequests()[0], [deadStudy])
    assert.equal(harness.reader.presentationState().state, 'open')
    assert.equal(
      harness.groups.flatMap((group) => group.tabs).includes(deadStudy),
      true,
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a cold open that is not a selection closes the captured-source tabs an earlier session left, and keeps another workspace's; fails_when=only the dead panes are closed at a cold open; why_new=Cycle 0044 0037-I2: the leftover captured-source tab was closed by a selection only; seam=restoreLeftoverCapturedSource
test('a Learning Outline click after an extension-host restart closes the leftover captured-source tab of an earlier session', async () => {
  // Arrange: column 2 holds a leftover captured source of this workspace and one of another workspace, both inactive; the learner's draft has focus in column 3.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  try {
    const leftover = harness.restoreLeftoverCapturedSource({
        active: false,
        column: 2,
      }),
      foreign = harness.restoreLeftoverCapturedSource({
        active: false,
        authority: 'f'.repeat(64),
        column: 2,
      })
    const draft = harness.focusMutableDraft('mutable-notes.txt', 3)
    // Act
    await harness.reader.select('repository/workspace/overview')
    // Assert
    const tabs = harness.groups.flatMap((group) => group.tabs)
    assert.equal(harness.reader.presentationState().state, 'open')
    assert.equal(tabs.includes(leftover), false)
    assert.equal(tabs.includes(foreign), true)
    assert.equal(tabs.includes(draft.tab), true)
  } finally {
    await harness.close()
  }
})

// Value: protects=keyboard focus is in the new Study pane after a cold open closed the dead pane that had focus; fails_when=the cold open ends with focus on no Codebook pane after the close; why_new=Cycle 0044 0037-F6, 0037-D8: no cold open started with the dead pane focused; seam=leaveDeadCodebookPane focused, focusedPanel
test('a Learning Outline click with the old host’s dead Study pane focused ends with keyboard focus in the new Study pane', async () => {
  // Arrange: the old host's Study pane has focus as the only tab of column 3.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  try {
    const deadStudy = harness.leaveDeadCodebookPane(
      'codebook.studyContext',
      3,
      {
        focused: true,
      },
    )
    // Act
    await harness.reader.select('repository/workspace/overview')
    // Assert
    assert.equal(harness.reader.presentationState().state, 'open')
    assert.equal(harness.reader.presentationState().layoutConfirmed, true)
    assert.equal(
      harness.groups.flatMap((group) => group.tabs).includes(deadStudy),
      false,
    )
    assert.equal(harness.focusedPanel(), 'codebook.studyContext')
  } finally {
    await harness.close()
  }
})

// Value: protects=keyboard focus is moved to the learning summary after a recording's cold open closed the dead pane that had focus; fails_when=the recording entry no longer focuses its summary view after the close, so focus stays where the closed pane was; why_new=Cycle 0044 0037-F6: no recording was opened with the dead pane focused; seam=leaveDeadCodebookPane focused, commands
test('opening a recording with the old host’s dead Application pane focused ends with keyboard focus moved to the learning summary', async () => {
  // Arrange: the old host's Application pane has focus in column 1.
  const harness = await recordedReaderHarness(true)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  try {
    const deadApplication = harness.leaveDeadCodebookPane(
      'codebook.scopedBrowser',
      1,
      { focused: true },
    )
    // Act
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    // Assert: the summary view was focused after the dead pane's close request.
    assert.equal(
      harness.groups.flatMap((group) => group.tabs).includes(deadApplication),
      false,
    )
    assert.deepEqual(harness.tabCloseRequests()[0], [deadApplication])
    assert.equal(
      harness.commands.includes('codebook.learningSummary.focus'),
      true,
    )
    assert.equal(harness.summary.visible, true)
    assert.equal(harness.reader.inspect().view!.errors.length, 0)
  } finally {
    await harness.close()
  }
})

// Value: protects=a cold open closes the old host's dead Repository Wiki pane; fails_when=only the Application and Study view types count as Codebook panes; why_new=Cycle 0044 0037-N6b: no test left a dead Wiki pane; seam=leaveDeadCodebookPane 'codebook.repositoryWiki'
test('a Learning Outline click after an extension-host restart closes the old host’s dead Repository Wiki pane', async () => {
  // Arrange: the old host's Repository Wiki pane has focus in the only group; this host's Wiki reader has no panel.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    const deadWiki = harness.leaveDeadCodebookPane(
      'codebook.repositoryWiki',
      1,
      { focused: true },
    )
    // Act
    await harness.reader.select('repository/workspace/overview')
    // Assert
    assert.equal(harness.reader.presentationState().state, 'open')
    assert.equal(
      harness.groups.flatMap((group) => group.tabs).includes(deadWiki),
      false,
    )
    assert.deepEqual(harness.tabCloseRequests()[0], [deadWiki])
  } finally {
    await harness.close()
  }
})

// Value: protects=a cold open places its panes in columns 1 and 3 after the dead pane's close removed the first editor group and renumbered the others; fails_when=the cold open keeps column numbers it read before the close; why_new=Cycle 0044 0037-PR4: the cold-open tests kept every group; seam=leaveDeadCodebookPane, useOpaquePrimary
test('a Learning Outline click places the panes after closing the dead Application pane removed the first editor group', async () => {
  // Arrange: the old host's Application pane is the only tab of column 1; the learner's draft has focus in column 2 and column 3 is empty.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  try {
    harness.useOpaquePrimary('blank')
    const deadApplication = harness.leaveDeadCodebookPane(
      'codebook.scopedBrowser',
      1,
    )
    const draft = harness.focusMutableDraft('mutable-notes.txt', 2)
    // Act
    await harness.reader.select('repository/workspace/overview')
    // Assert
    const tabs = harness.groups.flatMap((group) => group.tabs)
    assert.equal(harness.reader.presentationState().state, 'open')
    assert.equal(harness.reader.presentationState().layoutConfirmed, true)
    assert.equal(tabs.includes(deadApplication), false)
    assert.equal(tabs.includes(draft.tab), true)
    assert.equal(harness.groups.length, 3)
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
    assert.equal(harness.panelColumn('codebook.studyContext'), 3)
    assert.equal(harness.reader.inspect().view!.errors.length, 0)
  } finally {
    await harness.close()
  }
})

// Value: protects=a live entry from the Study layout in a window the learner has not split; fails_when=the arrangement counts the Study pane's group while the editor has not yet closed the disposed pane's tab, and reports "Existing editor groups were preserved" with the layout left unconfirmed; why_new=native run of 2026-10-04 (live entry of run 92c27590, a16-panel-scroll.png); seam=workspace harness closing a disposed panel's tab one task later
test('a live entry from the Study layout arranges the application above the source when the editor closes the retired Study pane a moment after its disposal', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] })
    await harness.reader.open()
    const groupsOfStudyLayout = harness.groups.length
    harness.closeDisposedPanelTabsLater()
    harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    await [...harness.service.records.values()][0]!.preparation

    // Act
    await harness.reader.open()

    // Assert
    assert.equal(groupsOfStudyLayout, 3)
    assert.equal(harness.reader.inspect().view!.errors.join(' | '), '')
    assert.equal(harness.panelColumn('codebook.studyContext'), undefined)
    assert.equal(harness.groups.length, 2)
    assert.equal(harness.reader.inspect().presentation.layoutConfirmed, true)
  } finally {
    await harness.close()
  }
})

for (const besideChat of [false, true])
  // Value: protects=retirement before native measurement and one final arrangement measurement; fails_when=a disposed Context tab is measured or arrange repeats its initial read; why_new=Cycle 0045 SP-5 with PC-3.8, reconciled with dedicated App preparation; seam=passthrough native-command and arrange observers
  test(`live entry waits for retired Study tabs before measurement and measures its final arrangement once${besideChat ? ', returning the keyboard to chat' : ''}`, async () => {
    // Arrange: native tab retirement is delayed, and App preparation has its own separate measurements.
    const harness = await workspaceHarness()
    const executeCommand = harness.editor.commands.executeCommand,
      arrange = harness.reader['arrange'],
      readsWithRetiredTab: boolean[] = [],
      arrangements: string[][] = []
    try {
      harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] })
      const chat = besideChat ? harness.addSeparateEditorPart() : undefined
      await harness.reader.open()
      harness.closeDisposedPanelTabsLater()
      harness.service.start({
        instanceId: harness.service.instanceId,
        profile: 'repository-browser',
        configuration: harness.configuration,
        key: randomUUID(),
      })
      await [...harness.service.records.values()][0]!.preparation
      // Name the actual chat tab so this entry owns its final focus return.
      chat?.focusTab()
      const commandsBefore = harness.commands.length
      // Observe actual native effects without changing their arguments, responses or timing.
      harness.editor.commands.executeCommand = async (...args) => {
        if (args[0] === 'vscode.getEditorLayout')
          readsWithRetiredTab.push(
            harness.groups.some((group) =>
              group.tabs.some(
                (tab) =>
                  tab.input instanceof harness.editor.TabInputWebview &&
                  tab.input.viewType === 'codebook.studyContext',
              ),
            ),
          )
        return executeCommand.call(harness.editor.commands, ...args)
      }
      harness.reader['arrange'] = async (...args): Promise<void> => {
        const start = harness.commands.length
        try {
          await arrange.apply(harness.reader, args)
        } finally {
          arrangements.push(harness.commands.slice(start))
        }
      }

      // Act
      await harness.reader.open()

      // Assert: preparation owns its extra reads; the final arrangement measures only once after retirement.
      assert.equal(harness.reader.inspect().view!.errors.join(' | '), '')
      assert.equal(harness.reader.inspect().presentation.layoutConfirmed, true)
      assert.equal(harness.panelColumn('codebook.studyContext'), undefined)
      assert.equal(readsWithRetiredTab.length > 0, true)
      assert.equal(readsWithRetiredTab.includes(true), false)
      assert.deepEqual(
        arrangements.map((commands) => {
          const batch = commands.indexOf('runCommands')
          assert.notEqual(batch, -1)
          return commands
            .slice(0, batch)
            .filter((command) => command === 'vscode.getEditorLayout').length
        }),
        [1],
      )
      if (chat) {
        assert.equal(chat.focused(), true)
        assert.deepEqual(
          harness.commands
            .slice(commandsBefore)
            .filter((command) => command === 'composer.focusComposer'),
          ['composer.focusComposer'],
        )
      }
    } finally {
      harness.editor.commands.executeCommand = executeCommand
      harness.reader['arrange'] = arrange
      await harness.close()
    }
  })

// Value: protects=the layout confirmation of a live run surviving Cursor's habit of giving every editor group a new object with each tab change; fails_when=a replaced group object without a known tab (the Agent chat's group) or without any tab counts as another group, so the receipt the entry took no longer matches and the run reaches ready with "The native editor layout receipt no longer matches the Study panes."; why_new=Cycle 0045 NF-6 (observed on candidate 13 in Cursor 3.23.12: five such events during one entry, no receipt at ready); seam=workspace harness with a separate editor part and the fake editor's group object replacement
test('a live entry in Cursor stays confirmed when the editor rebuilds the source group as its placeholder source tab closes', async () => {
  // Arrange: Cursor: the Agent chat is a tab of its own editor part, and every tab that opens, closes or comes to the front gives all editor groups new objects. The reader shows the confirmed Study layout.
  const harness = await workspaceHarness()
  try {
    harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] })
    const chat = harness.addSeparateEditorPart()
    harness.replaceGroupObjectsOnTabChanges()
    await harness.reader.open()
    const before = harness.reader.inspect().presentation,
      sourceGroupBefore = harness.groups.find((group) => group.viewColumn === 2)
    harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    await [...harness.service.records.values()][0]!.preparation

    // Act
    await harness.reader.open()

    // Assert
    const ready = harness.reader.inspect().presentation,
      sourceGroup = harness.groups.find((group) => group.viewColumn === 2)
    assert.equal(before.layoutConfirmed, true)
    assert.equal(harness.reader.inspect().view!.errors.join(' | '), '')
    assert.equal(ready.layoutConfirmed, true)
    assert.equal(ready.reason, undefined)
    assert.equal(ready.panes.appColumn, 1)
    assert.equal(ready.panes.sourceColumn, 2)
    assert.equal(harness.panelColumn('codebook.studyContext'), undefined)
    // The editor rebuilt the source group: it is another object in the same column, and the chat keeps its tab in the group behind the two panes.
    assert.notEqual(sourceGroup, sourceGroupBefore)
    assert.equal(
      harness.groups.find((group) => group.tabs.includes(chat.tab))?.viewColumn,
      3,
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the layout confirmation of a live run that starts from the three-pane Study layout an agent's selection arranged in Cursor; fails_when=the entry closes the context pane and its group, the editor replaces every group object with each of those tab changes, and the run reaches ready with "The native editor layout receipt no longer matches the Study panes." and no layout receipt; why_new=Cycle 0045 NF-6, open again after the second native round (owed check 2, take o2b: confirmed before the start, no receipt at ready; the first part's test entered from a reader the test opened itself, with the Application pane in front); seam=workspace harness with a separate editor part, the fake editor's group object replacement and the reader's refresh
test("a live entry from the three-pane Study layout stays confirmed when the context pane's group closes and the editor replaces every group object", async () => {
  // Arrange: as the editor API reported it in Cursor before the start: a selection made with the learner's file focused arranged the three panes, the Application pane shares the first group with that file, the captured source is in the second, the Study pane in the third and the Agent chat's group is the fourth.
  const harness = await workspaceHarness()
  // The test enters the run with its own refresh: a tick of the reader's timer just before it would enter the run first, and the assertions would read a layout that is still being arranged.
  readerSeams(harness).stopOwnTimer()
  harness.useNativeLayout({ orientation: 1, groups: [{}, {}] })
  harness.groups.at(-1)!.tabs = []
  harness.groups.at(-1)!.activeTab = undefined
  const chat = harness.addSeparateEditorPart()
  harness.replaceGroupObjectsOnTabChanges()
  try {
    const learnerFile = harness.focusMutableDraft('actions.ts', 1)
    const closed = harness.reader.presentationState()
    const selected = await harness.reader.changePresentation({
      presentationId: closed.presentationId,
      expectedRevision: closed.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })
    const firstGroupBefore = harness.groups.find(
      (group) => group.viewColumn === 1,
    )
    // Cursor closes the context pane's tab, and then its group, a moment after the entry disposed the pane: while the entry measures the main editor.
    harness.closeDisposedPanelTabsDuringLayoutRead()
    harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    await [...harness.service.records.values()][0]!.preparation

    // Act: the reader's own refresh enters the run, as it does after an agent's start.
    await readerSeams(harness)
      .refresh()
      .catch(() => undefined)

    // Assert
    const ready = harness.reader.inspect().presentation
    assert.equal(selected.layoutConfirmed, true)
    assert.equal(selected.panes.contextColumn, 3)
    assert.equal(firstGroupBefore?.tabs.includes(learnerFile.tab), true)
    assert.equal(readerSeams(harness).isLiveArrangement(), true)
    assert.deepEqual(readerSeams(harness).errorLines(), [])
    assert.equal(ready.layoutConfirmed, true)
    assert.equal(ready.reason, undefined)
    assert.equal(ready.panes.appColumn, 1)
    assert.equal(ready.panes.sourceColumn, 2)
    assert.equal(ready.panes.contextColumn, undefined)
    assert.equal(harness.panelColumn('codebook.studyContext'), undefined)
    assert.equal(harness.groups.length, 4)
    assert.equal(
      harness.groups
        .find((group) => group.viewColumn === 2)!
        .tabs.includes(learnerFile.tab),
      true,
    )
    assert.equal(learnerFile.document.getText(), 'Original learner draft.\n')
    assert.equal(learnerFile.tab.isDirty, true)
    // Only the created Context group retires; the dedicated App and both original main groups remain before chat.
    assert.equal(
      harness.groups.find((group) => group.tabs.includes(chat.tab))?.viewColumn,
      4,
    )
  } finally {
    await harness.close()
  }
})
