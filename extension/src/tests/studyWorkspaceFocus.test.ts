import assert from 'node:assert/strict'
import { test } from 'node:test'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import {
  workspaceHarness,
  configuredWorkspaceHarness,
} from './studyWorkspaceHarness'
for (const origin of ['chat', 'secondary text'] as const)
  for (const boundary of ['primary response', 'main measurement'] as const)
    for (const interaction of [
      'tab roundtrip',
      'selection roundtrip',
      'none',
    ] as const)
      test(`cold Wiki from ${origin} ${interaction === 'none' ? 'keeps its intentional focus handoff' : `remembers learner ${interaction}`} during ${boundary}`, async () => {
        // Arrange
        const harness = await workspaceHarness(false)
        harness.useNativeLayout({
          orientation: 0,
          groups: [{ size: 490 }, { size: 490 }],
        })
        const chat = harness.addSeparateEditorPart(),
          alternate = harness.focusMutableDraft('alternate.txt', 1),
          primary = harness.focusMutableDraft('primary.txt', 1),
          original = harness.focusMutableDraft('original.txt', 2)
        if (origin === 'chat') chat.focus()
        const listenerCount = harness.focusListenerCount(),
          receipts: ReturnType<typeof harness.retainRepositoryFocus>[] = []
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
        const held =
          boundary === 'primary response'
            ? harness.holdNextPrimaryFocusResponse()
            : harness.holdNextCommand('vscode.getEditorLayout')
        let measured: ReturnType<typeof harness.holdNextCommand> | undefined
        const opening = harness.reader.arrangeRepository(
          new AbortController().signal,
          undefined,
          focus,
        )
        const outcome =
          interaction === 'none'
            ? opening
            : assert.rejects(opening, /focus changed/)
        try {
          await held.started
          if (boundary === 'main measurement') {
            measured = harness.holdNextCommand('vscode.getEditorLayout')
            held.release()
            await measured.started
          }
          assert.equal(
            harness.focusedSource()?.document.uri.toString(),
            primary.document.uri.toString(),
          )
          // Act
          if (interaction === 'tab roundtrip') {
            alternate.focus()
            primary.focus()
          }
          if (interaction === 'selection roundtrip') {
            const selections = primary.editor.selections
            primary.editor.selections = [
              {
                anchor: selections[0]!.anchor.with(7, 0),
                active: selections[0]!.active.with(7, 0),
              },
            ]
            primary.editor.selections = selections
          }
          measured?.release()
          held.release()
          await outcome
          // Assert
          assert.equal(
            harness.focusedSource()?.document.uri.toString(),
            interaction === 'none' && origin === 'secondary text'
              ? original.document.uri.toString()
              : primary.document.uri.toString(),
          )
          assert.equal(
            harness.commands.includes('vscode.setEditorLayout'),
            false,
          )
          assert.equal(harness.runtimes.length, 0)
          assert.equal(primary.document.getText(), 'Original learner draft.\n')
          assert.equal(original.document.getText(), 'Original learner draft.\n')
          assert.deepEqual(chat.layout(), {
            orientation: 1,
            groups: [{ size: 743 }],
          })
        } finally {
          measured?.release()
          held.release()
          await opening.catch(() => undefined)
          for (const receipt of receipts) receipt.dispose()
          assert.equal(harness.focusListenerCount(), listenerCount)
          await harness.close()
        }
      })

for (const order of ['editor first', 'group first'] as const)
  test(`cold Wiki accepts the intended primary transition when native notifications arrive ${order}`, async () => {
    // Arrange
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({
      orientation: 0,
      groups: [{ size: 490 }, { size: 490 }],
    })
    const chat = harness.addSeparateEditorPart(),
      primary = harness.focusMutableDraft('primary.txt', 1),
      original = harness.focusMutableDraft('original.txt', 2)
    harness.usePrimaryFocusNotificationOrder(order)
    const listenerCount = harness.focusListenerCount(),
      receipts: ReturnType<typeof harness.retainRepositoryFocus>[] = []
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
    try {
      // Act
      await harness.reader.arrangeRepository(
        new AbortController().signal,
        undefined,
        focus,
      )
      // Assert
      assert.equal(
        harness.focusedSource()?.document.uri.toString(),
        original.document.uri.toString(),
      )
      assert.equal(
        harness.commands.filter(
          (command) => command === 'workbench.action.focusFirstEditorGroup',
        ).length,
        1,
      )
      assert.equal(harness.commands.includes('vscode.setEditorLayout'), false)
      assert.equal(primary.document.getText(), 'Original learner draft.\n')
      assert.deepEqual(chat.layout(), {
        orientation: 1,
        groups: [{ size: 743 }],
      })
    } finally {
      for (const receipt of receipts) receipt.dispose()
      assert.equal(harness.focusListenerCount(), listenerCount)
      await harness.close()
    }
  })

for (const interaction of [
  'chat',
  'chat roundtrip',
  'selection roundtrip',
  'none',
] as const)
  test(`cold Wiki ${interaction === 'none' ? 'accepts unchanged source' : `remembers learner ${interaction}`} before primary native focus arrives`, async () => {
    // Arrange
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({
      orientation: 0,
      groups: [{ size: 490 }, { size: 490 }],
    })
    const chat = harness.addSeparateEditorPart(),
      primary = harness.focusMutableDraft('primary.txt', 1),
      original = harness.focusMutableDraft('original.txt', 2)
    const listenerCount = harness.focusListenerCount(),
      receipts: ReturnType<typeof harness.retainRepositoryFocus>[] = []
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
    const held = harness.holdNextCommand(
      'workbench.action.focusFirstEditorGroup',
    )
    let restored = false
    harness.changeAfterNextSourceDisplay(() => {
      restored = true
    })
    const opening = harness.reader.arrangeRepository(
      new AbortController().signal,
      undefined,
      focus,
    )
    const outcome =
      interaction === 'none'
        ? opening
        : assert.rejects(opening, /focus changed/)
    try {
      await held.started
      // Act
      if (interaction === 'chat' || interaction === 'chat roundtrip')
        chat.focus()
      if (interaction === 'chat roundtrip') original.focus()
      if (interaction === 'selection roundtrip') {
        const selections = original.editor.selections
        original.editor.selections = [
          {
            anchor: selections[0]!.anchor.with(9, 0),
            active: selections[0]!.active.with(9, 0),
          },
        ]
        original.editor.selections = selections
      }
      held.release()
      await outcome
      // Assert: an already issued native command may drain, but no later restoration or allocation may proceed.
      assert.equal(restored, interaction === 'none')
      assert.equal(harness.commands.includes('vscode.setEditorLayout'), false)
      assert.equal(
        harness.focusedSource()?.document.uri.toString(),
        interaction === 'none'
          ? original.document.uri.toString()
          : primary.document.uri.toString(),
      )
      assert.equal(original.document.getText(), 'Original learner draft.\n')
      assert.deepEqual(chat.layout(), {
        orientation: 1,
        groups: [{ size: 743 }],
      })
    } finally {
      held.release()
      await opening.catch(() => undefined)
      for (const receipt of receipts) receipt.dispose()
      assert.equal(harness.focusListenerCount(), listenerCount)
      await harness.close()
    }
  })

for (const interaction of [
  'tab roundtrip',
  'selection roundtrip',
  'none',
] as const)
  test(`cold Wiki restoration ${interaction === 'none' ? 'keeps its captured secondary editor' : `remembers learner ${interaction}`} before the native display response`, async () => {
    // Arrange
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({
      orientation: 0,
      groups: [{ size: 490 }, { size: 490 }],
    })
    const chat = harness.addSeparateEditorPart(),
      primary = harness.focusMutableDraft('primary.txt', 1),
      original = harness.focusMutableDraft('original.txt', 2)
    const listenerCount = harness.focusListenerCount(),
      receipts: ReturnType<typeof harness.retainRepositoryFocus>[] = []
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
    let displayed = false
    harness.changeAfterNextSourceDisplay(() => {
      displayed = true
      if (interaction === 'tab roundtrip') {
        primary.focus()
        original.focus()
      }
      if (interaction === 'selection roundtrip') {
        const editor = harness.focusedSource()!,
          selections = editor.selections
        editor.selections = [
          {
            anchor: selections[0]!.anchor.with(8, 0),
            active: selections[0]!.active.with(8, 0),
          },
        ]
        editor.selections = selections
      }
    })
    try {
      // Act
      const opening = harness.reader.arrangeRepository(
        new AbortController().signal,
        undefined,
        focus,
      )
      if (interaction === 'none') await opening
      else await assert.rejects(opening, /focus changed/)
      // Assert
      assert.equal(displayed, true)
      assert.equal(
        harness.focusedSource()?.document.uri.toString(),
        original.document.uri.toString(),
      )
      assert.equal(harness.focusedSource()?.selections[0]!.active.line, 22)
      assert.equal(harness.commands.includes('vscode.setEditorLayout'), false)
      assert.equal(original.document.getText(), 'Original learner draft.\n')
      assert.deepEqual(chat.layout(), {
        orientation: 1,
        groups: [{ size: 743 }],
      })
    } finally {
      for (const receipt of receipts) receipt.dispose()
      assert.equal(harness.focusListenerCount(), listenerCount)
      await harness.close()
    }
  })

for (const boundary of [
  'first measurement',
  'split response',
  'confirmation read',
] as const)
  for (const interaction of ['selection', 'edit', 'chat', 'none'] as const)
    test(`cold Wiki ${boundary} ${interaction === 'none' ? 'retains ordinary text through accepted allocation' : `preserves newer learner ${interaction}`}`, async () => {
      // Arrange
      const harness = await workspaceHarness(false)
      harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] })
      const draft = harness.focusMutableDraft(),
        chat = harness.addSeparateEditorPart()
      const held =
        boundary === 'first measurement'
          ? harness.holdNextCommand('vscode.getEditorLayout')
          : harness.holdNextLayoutResponse()
      let confirmation: ReturnType<typeof harness.holdNextCommand> | undefined
      const focus = {
        begin(): void {},
        retainCurrentFocus() {
          const editor = harness.focusedSource(),
            version = draft.document.version,
            selections = JSON.stringify(editor?.selections)
          return {
            dispose(): void {},
            assertRetained(): void {
              if (
                editor !== harness.focusedSource() ||
                version !== draft.document.version ||
                selections !== JSON.stringify(editor?.selections)
              )
                throw new Error(
                  'Native focus changed during cold Wiki reservation.',
                )
            },
          }
        },
      }
      const opening = harness.reader.arrangeRepository(
        new AbortController().signal,
        undefined,
        focus,
      )
      const outcome =
        interaction === 'none'
          ? opening
          : assert.rejects(opening, /focus changed/)
      try {
        await held.started
        if (boundary === 'confirmation read') {
          confirmation = harness.holdNextCommand('vscode.getEditorLayout')
          held.release()
          await confirmation.started
        }
        // Act
        if (interaction === 'selection')
          draft.editor.selections = draft.editor.selections.map(
            (selection) => ({
              anchor: selection.anchor.with(6, 0),
              active: selection.active.with(6, 0),
            }),
          )
        if (interaction === 'edit')
          draft.replaceContent('My newer unsaved text.\n')
        if (interaction === 'chat') chat.focus()
        confirmation?.release()
        held.release()
        await outcome
        // Assert
        assert.deepEqual(chat.layout(), {
          orientation: 1,
          groups: [{ size: 743 }],
        })
        assert.equal(chat.focused(), interaction === 'chat')
        assert.equal(harness.runtimes.length, 0)
        assert.equal(
          draft.document.getText(),
          interaction === 'edit'
            ? 'My newer unsaved text.\n'
            : 'Original learner draft.\n',
        )
        if (interaction === 'selection')
          assert.equal(draft.editor.selections[0]!.active.line, 6)
        assert.equal(
          harness.commands.filter(
            (command) => command === 'vscode.setEditorLayout',
          ).length,
          boundary === 'first measurement' && interaction !== 'none' ? 0 : 1,
        )
      } finally {
        confirmation?.release()
        held.release()
        await opening.catch(() => undefined)
        await harness.close()
      }
    })

test('a queued cold Wiki checks its original learner focus before any native scope work', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] })
  harness.focusMutableDraft()
  const chat = harness.addSeparateEditorPart(),
    held = harness.holdNextCommand('vscode.getEditorLayout')
  const earlier = harness.reader.arrangeRepository(
      new AbortController().signal,
    ),
    earlierRejected = assert.rejects(earlier, /changed/)
  await held.started
  let starts = 0,
    retained = true
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
  const rejected = assert.rejects(queued, /Original learner focus changed/)
  try {
    // Act
    await new Promise<void>((resolve) => setImmediate(resolve))
    assert.equal(starts, 0)
    retained = false
    chat.focus()
    held.release()
    await earlierRejected
    await rejected
    // Assert
    assert.equal(starts, 1)
    assert.deepEqual(harness.commands, ['vscode.getEditorLayout'])
    assert.equal(chat.focused(), true)
    assert.equal(harness.groups.length, 2)
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] })
  } finally {
    held.release()
    await Promise.allSettled([earlier, queued])
    await harness.close()
  }
})

test('chat focus after cited-source acquisition prevents cold Wiki from reserving a late native pane', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] })
  harness.useOpaquePrimary('settings')
  const chat = harness.addSeparateEditorPart()
  chat.focus()
  let held: ReturnType<typeof harness.holdNextCommand> | undefined,
    acquired!: () => void
  const started = new Promise<void>((resolve) => {
    acquired = resolve
  })
  const opening = harness.reader.arrangeRepository(
      new AbortController().signal,
      undefined,
      {
        begin() {},
        acquireSourceFocus: async () => {
          harness.focusMutableDraft()
          held = harness.holdNextCommand('vscode.getEditorLayout')
          acquired()
          return (): void => {
            if (chat.focused()) throw new Error('Citation focus changed.')
          }
        },
      },
    ),
    rejected = assert.rejects(opening, /focus changed/)
  try {
    // Act
    await started
    await held!.started
    chat.focus()
    held!.release()
    await rejected
    // Assert
    assert.equal(harness.commands.includes('vscode.setEditorLayout'), false)
    assert.equal(harness.groups.length, 2)
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] })
    assert.equal(chat.focused(), true)
  } finally {
    held?.release()
    await opening.catch(() => undefined)
    await harness.close()
  }
})

test('moving focus to chat during the cold Wiki measurement preserves both parts without a late layout mutation', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] })
  const chat = harness.addSeparateEditorPart(),
    draft = harness.focusMutableDraft(),
    original = harness.editorLayout()
  const held = harness.holdNextCommand('vscode.getEditorLayout')
  try {
    // Act
    const opening = harness.reader.arrangeRepository(
        new AbortController().signal,
      ),
      rejected = assert.rejects(opening, /focus changed/)
    await held.started
    chat.focus()
    held.release()
    await rejected
    // Assert
    assert.deepEqual(harness.editorLayout(), original)
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] })
    assert.equal(chat.focused(), true)
    assert.equal(harness.commands.includes('vscode.setEditorLayout'), false)
    assert.equal(
      harness.commands.includes('workbench.action.focusFirstEditorGroup'),
      false,
    )
    assert.equal(harness.groups[0]!.tabs.includes(draft.tab), true)
    assert.equal(draft.document.getText(), 'Original learner draft.\n')
  } finally {
    held.release()
    await harness.close()
  }
})

for (const retirement of ['cancel', 'Close'] as const)
  test(`${retirement} during cold Wiki scope measurement cannot mutate the main or chat part`, async () => {
    // Arrange
    const harness = await workspaceHarness(false),
      cancellation = new AbortController()
    harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] })
    const chat = harness.addSeparateEditorPart(),
      draft = harness.focusMutableDraft(),
      original = harness.editorLayout()
    const held = harness.holdNextCommand('vscode.getEditorLayout')
    try {
      // Act
      const opening = harness.reader.arrangeRepository(cancellation.signal),
        rejected = assert.rejects(opening, /abort|closed/i)
      await held.started
      if (retirement === 'cancel') cancellation.abort()
      const closing =
        retirement === 'Close' ? harness.reader.close() : undefined
      held.release()
      await rejected
      await closing
      // Assert
      assert.deepEqual(harness.editorLayout(), original)
      assert.deepEqual(chat.layout(), {
        orientation: 1,
        groups: [{ size: 743 }],
      })
      assert.equal(harness.commands.includes('vscode.setEditorLayout'), false)
      assert.equal(harness.counts().panels, 0)
      assert.equal(harness.groups[0]!.tabs.includes(draft.tab), true)
      assert.equal(draft.document.getText(), 'Original learner draft.\n')
      assert.equal(harness.runtimes.length, 0)
    } finally {
      held.release()
      await harness.close()
    }
  })

test('cold Study reservation retains Cursor wrapper replacements without adopting the separate chat pane', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] })
  const chat = harness.addSeparateEditorPart(),
    draft = harness.focusMutableDraft()
  harness.useCursorGroupWrappers()
  try {
    // Act
    await harness.reader.open()
    // Assert
    assert.equal(harness.groups.length, 4)
    assert.equal(harness.groups[3]!.tabs.includes(chat.tab), true)
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
    assert.equal(harness.panelColumn('codebook.studyContext'), 3)
    assert.equal(harness.reader.inspect().view!.errors.length, 0)
    assert.equal(harness.groups[0]!.tabs.includes(draft.tab), true)
    assert.equal(draft.document.getText(), 'Original learner draft.\n')
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] })
  } finally {
    await harness.close()
  }
})

test('cold Study reserves a third main pane before Context can target the existing chat column', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({
    orientation: 1,
    groups: [{ size: 161 }, { size: 162 }],
  })
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
    assert.equal(harness.reader.inspect().view!.errors.length, 0)
    assert.equal(harness.groups[0]!.tabs.includes(draft.tab), true)
    assert.equal(draft.document.getText(), 'Original learner draft.\n')
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] })
  } finally {
    await harness.close()
  }
})

test('a restored Living book preference positions its new application in the reserved main pane rather than the chat column', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] })
  const chat = harness.addSeparateEditorPart(),
    draft = harness.focusMutableDraft()
  harness.presentationPreferences.set('codebook.presentation.v1', {
    version: 1,
    mode: 'living-book',
  })
  const restored = harness.createReader()
  try {
    // Act
    await restored.open()
    // Assert
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 2)
    assert.equal(harness.panelColumn('codebook.studyContext'), 1)
    assert.equal(harness.sourceColumn(), 3)
    assert.equal(restored.presentationState().layoutConfirmed, true)
    assert.equal(harness.groups.length, 4)
    assert.equal(harness.groups[3]!.tabs.includes(chat.tab), true)
    assert.equal(harness.groups[0]!.tabs.includes(draft.tab), true)
    assert.equal(draft.document.getText(), 'Original learner draft.\n')
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] })
  } finally {
    await restored.dispose()
    await harness.close()
  }
})

test('Living book adopts an MCP-first application into its reserved main pane before confirming the initial layout', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] })
  const chat = harness.addSeparateEditorPart(),
    draft = harness.focusMutableDraft()
  harness.presentationPreferences.set('codebook.presentation.v1', {
    version: 1,
    mode: 'living-book',
  })
  const reader = harness.createReader(),
    viewport = await reader.presentation.createViewport(
      'mcp-first-run',
      () => {},
      () => {},
      'normal',
    )
  try {
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
    const application = harness
      .nativePanels()
      .find((panel) => panel.kind === 'codebook.scopedBrowser')
    assert.ok(application)
    // Act
    await reader.open()
    // Assert
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 2)
    assert.equal(harness.panelColumn('codebook.studyContext'), 1)
    assert.equal(harness.sourceColumn(), 3)
    assert.equal(reader.presentationState().layoutConfirmed, true)
    assert.equal(harness.groups.length, 4)
    assert.equal(harness.groups[3]!.tabs.includes(chat.tab), true)
    assert.equal(harness.groups[1]!.tabs.includes(draft.tab), true)
    assert.equal(draft.document.getText(), 'Original learner draft.\n')
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] })
    assert.equal(harness.runtimes.length, 0)
    // The same renderer must also survive the source-derived-to-Live handoff; its former allocation is now Context's created group.
    const state = reader.presentationState()
    await reader.returnToCurrent({
      presentationId: state.presentationId,
      expectedRevision: state.reader.contentRevision,
    })
    assert.equal(harness.nativePanels().includes(application), true)
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
    assert.equal(harness.panelColumn('codebook.studyContext'), undefined)
    assert.equal(harness.sourceColumn(), 2)
    assert.equal(reader.presentationState().layoutConfirmed, true)
    assert.equal(harness.groups.length, 3)
    assert.equal(harness.groups[1]!.tabs.includes(draft.tab), true)
    assert.equal(harness.groups[2]!.tabs.includes(chat.tab), true)
    // End this owned runtime lease before closing its reader; a live lease intentionally keeps its Application available.
    viewport.close()
    await reader.close()
    assert.equal(harness.groups.length, 2)
    assert.equal(harness.groups[0]!.tabs.includes(draft.tab), true)
    assert.equal(harness.groups[1]!.tabs.includes(chat.tab), true)
    assert.equal(draft.document.getText(), 'Original learner draft.\n')
    assert.equal(draft.tab.isDirty, true)
  } finally {
    viewport.close()
    await reader.dispose()
    await harness.close()
  }
})

test('MCP-first Study opens when its application covers the selected chat-like tab in the same editor group', async () => {
  // Arrange: Claude Code keeps an editor tab selected where the MCP-created Application appears.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  const chat = harness.openWiki(1)
  const reader = harness.createReader(),
    viewport = await reader.presentation.createViewport(
      'mcp-chat-run',
      () => {},
      () => {},
      'normal',
    )
  try {
    // Act
    await reader.open()
    // Assert: Codebook's own Application selection can be attributed without changing the chat tab.
    assert.equal(reader.presentationState().state, 'open')
    assert.equal(reader.presentationState().layoutConfirmed, true)
    assert.equal(
      harness.groups.some((group) => group.tabs.includes(chat.nativeTab)),
      true,
    )
    assert.equal(harness.commands.includes('vscode.setEditorLayout'), true)
  } finally {
    viewport.close()
    await reader.dispose()
    await harness.close()
  }
})

test('MCP-first Study preserves a newer chat tab choice during application registration', async () => {
  // Arrange: both tabs already exist, so a focus roundtrip does not change group contents.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  const other = harness.openWiki(1),
    chat = harness.openWiki(1)
  const registerPanel = harness.delayPanelRegistration('codebook.scopedBrowser')
  const reader = harness.createReader(),
    acquiring = reader.presentation.createViewport(
      'mcp-chat-run',
      () => {},
      () => {},
      'normal',
    ),
    refused = assert.rejects(
      Promise.resolve(acquiring),
      /Native panes or learner focus changed/,
    )
  try {
    // The factory now drains actual registration before returning its lease; intervene while that native response is pending.
    await waitUntil(
      () => harness.panelColumn('codebook.scopedBrowser') === 1,
      'the pending native Application registration',
    )
    // Act: the learner visits another existing tab before the Application finishes registering.
    harness.focusExistingWebviewTab(other.nativeTab)
    harness.focusExistingWebviewTab(chat.nativeTab)
    registerPanel()
    // Assert: returning to the original tab cannot make the later Application selection owned.
    await refused
    assert.equal(harness.groups[0]!.tabs.includes(other.nativeTab), true)
    assert.equal(harness.groups[0]!.tabs.includes(chat.nativeTab), true)
    assert.equal(harness.commands.includes('vscode.setEditorLayout'), false)
    assert.equal(harness.counts().panels, 2)
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), undefined)
  } finally {
    registerPanel()
    await refused.catch(() => undefined)
    await reader.dispose()
    await harness.close()
  }
})

for (const phase of [
  'native response',
  'caller admission',
  'window round trip',
  'Close',
] as const)
  test(`MCP-first opaque primary preserves later input at ${phase} without allocating App`, async () => {
    // Arrange: identical webview types share one native group, so a later tab roundtrip cannot be inferred from the final type alone.
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    const other = harness.openWiki(1),
      original = harness.openWiki(1),
      reader = harness.createReader(),
      focus = reader['focusApplicationSourceGroup'],
      focusPrimary = focus.bind(reader),
      commandsBefore = harness.commands.length
    let held:
        ReturnType<typeof harness.holdNextPrimaryFocusResponse> | undefined,
      outcome: Promise<void> | undefined,
      closing: Promise<void> | undefined
    reader['focusApplicationSourceGroup'] = async (...arguments_) => {
      if (phase !== 'caller admission')
        held = harness.holdNextPrimaryFocusResponse()
      const receipt = await focusPrimary(...arguments_)
      if (phase === 'caller admission') {
        harness.focusExistingWebviewTab(other.nativeTab)
        harness.focusExistingWebviewTab(original.nativeTab)
      }
      return receipt
    }
    try {
      // Act: newer native input or Close wins while the issued primary-focus response drains, and also in the caller's await gap.
      outcome = assert.rejects(
        Promise.resolve(
          reader.presentation.createViewport(
            'opaque-input-run',
            () => {},
            () => {},
            'normal',
          ),
        ),
        /closed|primary source changed|Native pane/i,
      )
      if (phase !== 'caller admission') {
        await waitUntil(() => Boolean(held), 'opaque primary focus response')
        assert.ok(held)
        await held.started
        if (phase === 'Close') closing = reader.close()
        else if (phase === 'window round trip') {
          harness.changeWindowFocus(false)
          harness.changeWindowFocus(true)
        } else {
          harness.focusExistingWebviewTab(other.nativeTab)
          harness.focusExistingWebviewTab(original.nativeTab)
        }
        held.release()
      }
      await outcome
      await closing

      // Assert
      assert.equal(
        harness.commands
          .slice(commandsBefore)
          .includes('workbench.action.newGroupAbove'),
        false,
      )
      assert.equal(harness.counts().panels, 2)
      assert.equal(harness.panelColumn('codebook.scopedBrowser'), undefined)
      assert.equal(harness.groups.length, 1)
      assert.equal(harness.groups[0]!.tabs.includes(other.nativeTab), true)
      assert.equal(harness.groups[0]!.tabs.includes(original.nativeTab), true)
      assert.equal(harness.groups[0]!.activeTab, original.nativeTab)
    } finally {
      held?.release()
      await outcome?.catch(() => undefined)
      await closing
      reader['focusApplicationSourceGroup'] = focus
      await reader.dispose()
      await harness.close()
    }
  })

test('Living book preserves a learner move of its MCP-first application before the initial Open', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({
    orientation: 0,
    groups: [{ size: 320 }, { size: 320 }, { size: 340 }],
  })
  const chat = harness.addSeparateEditorPart(),
    draft = harness.focusMutableDraft()
  harness.presentationPreferences.set('codebook.presentation.v1', {
    version: 1,
    mode: 'living-book',
  })
  const reader = harness.createReader(),
    viewport = await reader.presentation.createViewport(
      'mcp-first-run',
      () => {},
      () => {},
      'normal',
    )
  harness.movePanel('codebook.scopedBrowser', 4)
  try {
    // Act
    await reader.open()
    // Assert
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 4)
    assert.equal(harness.panelColumn('codebook.studyContext'), 1)
    assert.equal(harness.sourceColumn(), 3)
    assert.equal(harness.groups.length, 5)
    assert.equal(harness.groups[4]!.tabs.includes(chat.tab), true)
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] })
    assert.equal(harness.groups[1]!.tabs.includes(draft.tab), true)
    assert.equal(draft.document.getText(), 'Original learner draft.\n')
    assert.equal(harness.runtimes.length, 0)
  } finally {
    viewport.close()
    await reader.dispose()
    await harness.close()
  }
})

test('Living book retry after an accepted reservation is cancelled separates its application from the explanation', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] })
  const chat = harness.addSeparateEditorPart(),
    draft = harness.focusMutableDraft()
  harness.presentationPreferences.set('codebook.presentation.v1', {
    version: 1,
    mode: 'living-book',
  })
  const reader = harness.createReader(),
    cancellation = new AbortController(),
    held = harness.holdNextCommand('runCommands')
  const opening = reader.open(cancellation.signal),
    rejected = assert.rejects(opening, /abort/i)
  try {
    // Act
    await held.started
    cancellation.abort()
    held.release()
    await rejected
    assert.equal(reader.inspect().opened, false)
    assert.equal(harness.groups.length, 4)
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
    await reader.open()
    // Assert
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 2)
    assert.equal(harness.panelColumn('codebook.studyContext'), 1)
    assert.equal(harness.sourceColumn(), 3)
    assert.equal(reader.presentationState().layoutConfirmed, true)
    assert.equal(harness.groups[3]!.tabs.includes(chat.tab), true)
    assert.equal(harness.groups[0]!.tabs.includes(draft.tab), true)
    assert.equal(draft.document.getText(), 'Original learner draft.\n')
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] })
    assert.equal(harness.runtimes.length, 0)
  } finally {
    held.release()
    await opening.catch(() => undefined)
    await reader.dispose()
    await harness.close()
  }
})

for (const mode of ['study-workspace', 'living-book'] as const)
  test(`an explicit ${mode} Open retry after a failed passive scope read still reserves separate main Study panes`, async () => {
    // Arrange
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] })
    const chat = harness.addSeparateEditorPart(),
      draft = harness.focusMutableDraft()
    harness.presentationPreferences.set('codebook.presentation.v1', {
      version: 1,
      mode,
    })
    const reader = harness.createReader()
    harness.failNextCommand('vscode.getEditorLayout')
    try {
      // Act
      await assert.rejects(reader.open(), /Native layout command failed/)
      assert.equal(reader.inspect().opened, false)
      await reader.open()
      // Assert
      assert.equal(
        harness.panelColumn('codebook.scopedBrowser'),
        mode === 'living-book' ? 2 : 1,
      )
      assert.equal(
        harness.panelColumn('codebook.studyContext'),
        mode === 'living-book' ? 1 : 3,
      )
      assert.equal(harness.sourceColumn(), mode === 'living-book' ? 3 : 2)
      assert.equal(reader.presentationState().layoutConfirmed, true)
      assert.equal(harness.groups.length, 4)
      assert.equal(harness.groups[3]!.tabs.includes(chat.tab), true)
      assert.equal(harness.groups[0]!.tabs.includes(draft.tab), true)
      assert.equal(draft.document.getText(), 'Original learner draft.\n')
      assert.equal(harness.runtimes.length, 0)
    } finally {
      await reader.dispose()
      await harness.close()
    }
  })

for (const operation of ['read', 'reselect'] as const)
  test(`a presentation ${operation} from chat reports unverified scope without stealing focus or invalidating the retained main grid`, async () => {
    // Arrange
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] })
    const chat = harness.addSeparateEditorPart()
    harness.focusMutableDraft()
    try {
      await harness.reader.open()
      const state = harness.reader.presentationState(),
        layout = harness.editorLayout()
      assert.equal(state.layoutConfirmed, true)
      chat.focus()
      // Act
      const result =
        operation === 'read'
          ? await harness.reader.readPresentationState()
          : await harness.reader.changePresentation({
              presentationId: state.presentationId,
              expectedRevision: state.presentationControlRevision,
              mode: 'study-workspace',
              action: 'select',
            })
      // Assert
      // The main grid cannot be measured from the chat's part: the read repeats the last arrangement's confirmation and marks it as not measured (Cycle 0045 S1a-F1; it answered false with "… without changing focus" before). A selection of that layout is answered the same way (Cycle 0045 cause 12 (g); it was refused with "… its layout cannot be checked from the current editor part." before).
      assert.equal(result.layoutConfirmed, true)
      assert.equal(result.layoutMeasured, false)
      assert.equal(result.reason, undefined)
      assert.equal(result.presentationControlRevision, 0)
      assert.equal(result.presentationId, state.presentationId)
      assert.equal(chat.focused(), true)
      assert.deepEqual(harness.reader.presentationState(), state)
      assert.deepEqual(harness.editorLayout(), layout)
      assert.deepEqual(chat.layout(), {
        orientation: 1,
        groups: [{ size: 743 }],
      })
      assert.equal(harness.runtimes.length, 0)
      assert.equal(harness.groups.length, 4)
      harness.movePanel('codebook.studyContext', 3)
      assert.equal(
        (await harness.reader.readPresentationState()).layoutConfirmed,
        true,
      )
      // Actual main geometry changes still invalidate confirmation after focus returns to the measured part.
      harness.changeEditorLayout({
        orientation: 0,
        groups: [{ size: 0.2 }, { size: 0.2 }, { size: 0.6 }],
      })
      assert.equal(
        (await harness.reader.readPresentationState()).layoutConfirmed,
        false,
      )
      assert.equal(harness.reader.presentationState().layoutConfirmed, false)
    } finally {
      await harness.close()
    }
  })

test('a presentation read preserves changed learner focus and does not certify the returned editor part', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] })
  const chat = harness.addSeparateEditorPart()
  harness.focusMutableDraft()
  let release = (): void => {}
  try {
    await harness.reader.open()
    const state = harness.reader.presentationState()
    const held = harness.holdNextCommand('vscode.getEditorLayout')
    release = held.release
    // Act
    const reading = harness.reader.readPresentationState()
    await held.started
    chat.focus()
    release()
    const result = await reading
    // Assert: the layout the editor returned for another part certifies nothing; the answer is the last arrangement's confirmation, marked as not measured (Cycle 0045 S1a-F1; it answered false before).
    assert.equal(result.layoutConfirmed, true)
    assert.equal(result.layoutMeasured, false)
    assert.equal(chat.focused(), true)
    assert.deepEqual(harness.reader.presentationState(), state)
    assert.equal(harness.runtimes.length, 0)
  } finally {
    release()
    await harness.close()
  }
})

test('an older presentation read cannot suppress original focus recovery after a newer mode change fails', async () => {
  // Arrange: the owned replacement uses the source anchor while its final layout command is pending.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  let releaseRead = (): void => {},
    releaseKeep = (): void => {}
  try {
    await harness.reader.open()
    const state = harness.reader.presentationState()
    const applicationTab = harness.groups
      .flatMap((group) => group.tabs)
      .find(
        (tab) =>
          'viewType' in tab.input &&
          tab.input.viewType === 'codebook.scopedBrowser',
      )
    assert.ok(applicationTab)
    applicationTab.isPreview = true
    const source = harness.reader.inspect().sourceUri,
      draft = harness.addForeignDraft()
    assert.equal(harness.focusedPanel(), 'codebook.studyContext')
    const heldRead = harness.holdNextCommand('vscode.getEditorLayout')
    releaseRead = heldRead.release
    const reading = harness.reader.readPresentationState()
    await heldRead.started
    const heldKeep = harness.holdNextCommand('vscode.setEditorLayout')
    releaseKeep = heldKeep.release
    // Act: the obsolete passive read settles after the newer transition has borrowed native focus.
    const changing = assert.rejects(
      harness.reader.changePresentation({
        presentationId: state.presentationId,
        expectedRevision: state.presentationControlRevision,
        mode: 'living-book',
        action: 'select',
      }),
      {
        code: 'PRESENTATION_UNAVAILABLE',
        causeDetail: 'Error: Native layout command failed',
      },
    )
    await heldKeep.started
    assert.equal(harness.focusedPanel(), undefined)
    releaseRead()
    const result = await reading
    harness.failNextCommand('vscode.setEditorLayout')
    releaseKeep()
    await changing
    // Assert: the failed mode leaves its original focus and evidence intact without saving a new preference.
    assert.equal(result.layoutConfirmed, false)
    assert.equal(harness.focusedPanel(), 'codebook.studyContext')
    assert.equal(harness.reader.presentationState().mode, 'study-workspace')
    assert.equal(harness.presentationPreferences.size, 0)
    assert.equal(harness.reader.inspect().sourceUri, source)
    assert.equal(
      harness.groups.some((group) => group.tabs.includes(draft)),
      true,
    )
    assert.equal(draft.isDirty, true)
    assert.equal(harness.runtimes.length, 0)
  } finally {
    releaseRead()
    releaseKeep()
    await harness.close()
  }
})

for (const loss of [
  'the workbench resized the split',
  'the layout receipt was lost',
] as const)
  // Value: protects=an agent's or learner's Restore after a failed run working from wherever the focus is; fails_when=the live Restore refuses "Focus an owned Study pane before changing its reading layout." until an Application or Study pane is clicked; why_new=Cycle 0044 0036-N05 (the live Restore tests start from a focused Codebook pane or a chat part); seam=workspace harness with the fake editor and a leased live viewport
  test(`Restore after a failed run confirms the app and source layout without a pane click when ${loss}`, async () => {
    // Arrange: a live run whose explanation is in the chat; the learner's own file has the focus, beside the Application pane.
    const harness = await workspaceHarness()
    harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] })
    let live:
      | Awaited<
          ReturnType<
            NonNullable<typeof harness.reader.presentation.createViewport>
          >
        >
      | undefined
    try {
      const receipt = harness.service.start({
        instanceId: harness.service.instanceId,
        profile: 'repository-browser',
        configuration: harness.configuration,
        key: 'failed-run',
      })
      await harness.service.record(receipt).preparation
      await harness.reader.open()
      live = await harness.reader.presentation.createViewport(
        receipt.runId,
        () => {},
        () => {},
        'normal',
      )
      const draft = harness.focusMutableDraft('auth.ts', 1)
      // The run fails and is cleaned up; the editor's own panels then change the split, or the receipt is gone.
      harness.runtimes[0]!.fail('Injected run failure')
      await harness.service.stop({
        instanceId: harness.service.instanceId,
        runId: receipt.runId,
      })
      live.close()
      if (loss === 'the workbench resized the split')
        harness.changeEditorLayout({
          orientation: 1,
          groups: [{ size: 0.8 }, { size: 0.2 }],
        })
      else harness.reader['layoutReceipt'] = undefined
      const failed = await harness.reader.readPresentationState()
      assert.equal(failed.layoutConfirmed, false)
      assert.equal(
        failed.reason,
        loss === 'the workbench resized the split'
          ? 'The Study arrangement is not confirmed: the editor grid no longer has the sizes of the confirmed layout. Focus the existing Study or Application pane, then restore its layout. Opening Repository Wiki does not repair Study.'
          : 'The native editor layout receipt no longer matches the Study panes. Focus the existing Study or Application pane, then restore its layout. Opening Repository Wiki does not repair Study.',
      )
      // Act: no pane is clicked first.
      const restored = await harness.reader.changePresentation({
        presentationId: failed.presentationId,
        expectedRevision: failed.presentationControlRevision,
        mode: 'study-workspace',
        action: 'restore',
      })
      // Assert
      assert.equal(restored.layoutConfirmed, true)
      assert.equal(restored.reason, undefined)
      assert.deepEqual(harness.editorLayout(), {
        orientation: 1,
        groups: [{ size: 0.5 }, { size: 0.5 }],
      })
      assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
      assert.equal(restored.panes.sourceColumn, 2)
      // The learner's file keeps its tab, its text and the focus.
      assert.equal(harness.groups[0]!.activeTab, draft.tab)
      assert.equal(harness.focusedPanel(), undefined)
      assert.equal(draft.document.getText(), 'Original learner draft.\n')
    } finally {
      live?.close()
      await harness.close()
    }
  })

// Value: protects=an agent's Focus after a failed run reaching the Application pane from the learner's own file; fails_when=the focus control needs an Application or Study pane to be clicked first; why_new=Cycle 0044 0036-N05 named Focus beside Restore, and no test started Focus after a failed run; seam=workspace harness with the fake editor and a leased live viewport
test('Focus after a failed run reaches the Application pane without a pane click', async () => {
  // Arrange: a live run whose explanation is in the chat; the learner's own file has the focus, beside the Application pane.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] })
  let live:
    | Awaited<
        ReturnType<
          NonNullable<typeof harness.reader.presentation.createViewport>
        >
      >
    | undefined
  try {
    const receipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: 'failed-run',
    })
    await harness.service.record(receipt).preparation
    await harness.reader.open()
    live = await harness.reader.presentation.createViewport(
      receipt.runId,
      () => {},
      () => {},
      'normal',
    )
    const draft = harness.focusMutableDraft('auth.ts', 1)
    harness.runtimes[0]!.fail('Injected run failure')
    await harness.service.stop({
      instanceId: harness.service.instanceId,
      runId: receipt.runId,
    })
    live.close()
    const failed = await harness.reader.readPresentationState()
    // Act: no pane is clicked first.
    const focused = await harness.reader.changePresentation({
      presentationId: failed.presentationId,
      expectedRevision: failed.presentationControlRevision,
      mode: 'study-workspace',
      action: 'focus',
    })
    // Assert
    assert.equal(focused.state, 'open')
    assert.equal(harness.focusedPanel(), 'codebook.scopedBrowser')
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
    assert.equal(harness.groups[0]!.tabs.includes(draft.tab), true)
    assert.equal(draft.document.getText(), 'Original learner draft.\n')
  } finally {
    live?.close()
    await harness.close()
  }
})

test('first configured Study pause keeps captured source visible beside the application without manual Arrange', async () => {
  // Arrange
  const harness = await configuredWorkspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    // Act
    await harness.start()
    await harness.reader.action('click')

    // Assert
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
    assert.equal(harness.panelColumn('codebook.studyContext'), undefined)
    assert.equal(harness.sourceColumn(), 2)
    const source = harness.groups.find((group) => group.viewColumn === 2)!
      .activeTab?.input
    assert.ok(source && 'uri' in source)
    assert.equal(source.uri.toString(), harness.reader.inspect().sourceUri)
    assert.equal(harness.reader.inspect().view!.errors.length, 0)
    const observation = harness.reader.inspect().view!.model.observation
    assert.ok(observation?.actionId === 'repository-click')
    assert.equal(observation.values['value:enabled'], false)
  } finally {
    await harness.close()
  }
})

test('compact Study opens a readable explanation when native minimum widths prevent the requested split', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.constrainStudyGrid()
  harness.suppressNativeInnerFocus()
  const draft = harness.focusMutableDraft()
  try {
    // Act
    await harness.reader.open()

    // Assert
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
    assert.equal(harness.sourceColumn(), 2)
    assert.equal(harness.panelColumn('codebook.studyContext'), 3)
    assert.equal(harness.focusedPanel(), 'codebook.studyContext')
    assert.equal(harness.maximizedEditorGroup(), true)
    assert.equal(harness.reader.presentationState().layoutConfirmed, false)
    assert.match(
      harness.reader.presentationState().reason ?? '',
      /focused explanation/i,
    )
    assert.equal(
      harness.groups.some((group) => group.tabs.includes(draft.tab)),
      true,
    )
    assert.equal(draft.document.getText(), 'Original learner draft.\n')
  } finally {
    await harness.close()
  }
})

test('compact Study remains open when its optional first explanation read loses window focus', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.constrainStudyGrid()
  const readStudyPane = harness.reader['readStudyPane'].bind(harness.reader)
  harness.reader['readStudyPane'] = (region, signal): Promise<void> => {
    harness.changeWindowFocus(false)
    return readStudyPane(region, signal)
  }
  try {
    // Act
    await harness.reader.open()

    // Assert
    assert.equal(harness.reader.inspect().opened, true)
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
    assert.equal(harness.sourceColumn(), 2)
    assert.equal(harness.panelColumn('codebook.studyContext'), 3)
    assert.equal(harness.reader.presentationState().layoutConfirmed, false)
    assert.equal(
      harness.reader
        .inspect()
        .view!.errors.some((error) =>
          error.includes('Focus the Codebook work window'),
        ),
      true,
    )
  } finally {
    harness.changeWindowFocus(true)
    await harness.close()
  }
})

test('Read Explanation opens Study when the command runs before Open Study Workspace', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    assert.equal(harness.reader.inspect().opened, false)

    // Act
    await harness.reader.action('read-context')

    // Assert
    assert.equal(harness.reader.inspect().opened, true)
    assert.equal(harness.focusedPanel(), 'codebook.studyContext')
    assert.equal(harness.maximizedEditorGroup(), true)
    assert.match(
      harness.reader.presentationState().reason ?? '',
      /Focused explanation/,
    )
  } finally {
    await harness.close()
  }
})

test('Read Explanation stays readable when opening Study first needs a compact-layout focus', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.constrainStudyGrid()
  harness.suppressNativeInnerFocus()
  try {
    // Act
    await harness.reader.action('read-context')

    // Assert
    assert.equal(harness.reader.inspect().opened, true)
    assert.equal(harness.focusedPanel(), 'codebook.studyContext')
    assert.equal(harness.maximizedEditorGroup(), true)
    assert.match(
      harness.reader.presentationState().reason ?? '',
      /Focused explanation/,
    )
  } finally {
    await harness.close()
  }
})

test('Read Explanation does not maximize after the work window leaves and returns during cold Open', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  const openStudy = harness.reader.open.bind(harness.reader)
  harness.reader.open = async (signal, origin): Promise<void> => {
    await openStudy(signal, origin)
    harness.changeWindowFocus(false)
    harness.changeWindowFocus(true)
  }
  try {
    // Act
    await assert.rejects(
      harness.reader.action('read-context'),
      /work window lost focus/i,
    )

    // Assert
    assert.equal(harness.reader.inspect().opened, true)
    assert.equal(
      harness.commands.filter(
        (command) => command === 'workbench.action.maximizeEditorHideSidebar',
      ).length,
      0,
    )
    assert.doesNotMatch(
      harness.reader.presentationState().reason ?? '',
      /Focused explanation/,
    )
  } finally {
    await harness.close()
  }
})

test('Read Explanation leaves a closed Study and foreign window untouched when unfocused', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.changeWindowFocus(false)
  try {
    // Act
    await assert.rejects(
      harness.reader.action('read-context'),
      /Focus the Codebook work window/,
    )

    // Assert
    assert.equal(harness.reader.inspect().opened, false)
    assert.equal(harness.panelColumn('codebook.studyContext'), undefined)
    assert.equal(harness.maximizedEditorGroup(), false)
  } finally {
    harness.changeWindowFocus(true)
    await harness.close()
  }
})

test('Read Application does not maximize after the work window leaves during its webview reveal', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.open()
    const application = harness.reader['app']!
    const reveal = application.reveal.bind(application)
    application.reveal = (column, preserveFocus): void => {
      reveal(column, preserveFocus)
      harness.changeWindowFocus(false)
      harness.changeWindowFocus(true)
    }
    const maximizations = harness.commands.filter(
      (command) => command === 'workbench.action.maximizeEditorHideSidebar',
    ).length

    // Act
    await assert.rejects(
      harness.reader.action('read-app'),
      /work window lost focus/i,
    )

    // Assert
    assert.equal(harness.reader.inspect().opened, true)
    assert.equal(
      harness.commands.filter(
        (command) => command === 'workbench.action.maximizeEditorHideSidebar',
      ).length,
      maximizations,
    )
    assert.doesNotMatch(
      harness.reader.presentationState().reason ?? '',
      /Focused application/,
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=reader tests meeting Cursor as it answers the command that focuses the first editor group while it names the chat's group; fails_when=the fake names the first group as the active tab group, which Cursor does not, so a measurement that waits for that name passes in the tests and is refused in the editor; why_new=Cycle 0045 cause 12 (d) (obs15 P2: only `onDidChangeActiveTextEditor` arrived, the active tab group stayed the chat's); seam=the fake editor with a separate editor part and leavePaneFocusUnreportedBesideChat
test("the fake Cursor reports the first group's text editor as the active text editor and keeps naming the chat's group after the command that focuses the first editor group", async () => {
  // Arrange: the editor names the chat's group, whose input has the keyboard; the first group shows a file.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 1, groups: [{}, {}] })
  harness.groups.at(-1)!.tabs = []
  harness.groups.at(-1)!.activeTab = undefined
  const chat = harness.addSeparateEditorPart()
  harness.leavePaneFocusUnreportedBesideChat()
  try {
    const learnerFile = harness.focusMutableDraft('actions.ts', 1)
    chat.focusTab()
    let groupEvents = 0
    const activeEditors: (string | undefined)[] = []
    harness.editor.window.tabGroups.onDidChangeTabGroups(() => {
      groupEvents++
    })
    harness.editor.window.onDidChangeActiveTextEditor((editor) => {
      activeEditors.push(editor?.document.uri.toString())
    })

    // Act
    await harness.editor.commands.executeCommand(
      'workbench.action.focusFirstEditorGroup',
    )
    const afterCommand = {
      namesChatGroup:
        harness.editor.window.tabGroups.activeTabGroup.tabs.includes(chat.tab),
      activeTextEditor:
        harness.editor.window.activeTextEditor?.document.uri.toString(),
      groupEvents,
      chatHasKeyboard: chat.focused(),
      layoutRead: await harness.editor.commands.executeCommand(
        'vscode.getEditorLayout',
      ),
    }
    // The next change of a tab group rebuilds the tab model, which corrects the name.
    chat.resync('wrapper')

    // Assert
    assert.deepEqual(afterCommand, {
      namesChatGroup: true,
      activeTextEditor: learnerFile.document.uri.toString(),
      groupEvents: 0,
      chatHasKeyboard: false,
      // The main editor's two rows, not the chat part's one group of 743.
      layoutRead: { orientation: 1, groups: [{ size: 1 }, { size: 1 }] },
    })
    assert.deepEqual(activeEditors, [learnerFile.document.uri.toString()])
    assert.equal(harness.editor.window.tabGroups.activeTabGroup.viewColumn, 1)
  } finally {
    await harness.close()
  }
})

// Value: protects=reader tests meeting the editor as it loses the keyboard when a disposed pane's tab closes: a group focus command that runs before that close does not keep the keyboard, one that runs after it does; fails_when=the fake clears the lost keyboard for any focus command after the disposal, so a reader that focuses too early passes in the tests and leaves the keyboard on the page body in the editor; why_new=Cycle 0045 cause 12 (f), second native result (obs15 R: the page body had the keyboard after Close although the focus command ran); seam=the fake editor's closeDisposedPanelTabsLater, its panes and keyboardOnBody
test("the fake editor leaves the keyboard on the page body when a disposed pane's tab closes after a group focus command, until such a command runs after that close", async () => {
  // Arrange: the Application pane is the tab the focused first group shows; the editor closes a disposed pane's tab 20 ms after the disposal.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.closeDisposedPanelTabsLater()
  try {
    await harness.reader.open()
    const application = harness
      .nativePanels()
      .find((panel) => panel.kind === 'codebook.scopedBrowser')
    assert.ok(application)
    application.reveal(undefined, false)

    // Act
    application.dispose()
    await harness.editor.commands.executeCommand(
      'workbench.action.focusActiveEditorGroup',
    )
    const rightAfterTheCommand = harness.keyboardOnBody()
    await new Promise((resolve) => setTimeout(resolve, 60))
    const afterTheTabClosed = harness.keyboardOnBody()
    await harness.editor.commands.executeCommand(
      'workbench.action.focusActiveEditorGroup',
    )

    // Assert
    assert.equal(rightAfterTheCommand, false)
    assert.equal(afterTheTabClosed, true)
    assert.equal(harness.keyboardOnBody(), false)
  } finally {
    await harness.close()
  }
})

for (const regained of [
  'a pane revealed with the focus',
  'a text document shown with the focus',
  "the chat's tab focused",
  "the learner's file focused",
] as const)
  // Value: protects=reader tests judging the keyboard after a close as the editor would: once an editor, a pane or the chat was given the keyboard, it is no longer on the page body; fails_when=the fake keeps "the page body has the keyboard" until a group focus command runs, so a reader that returns the focus by showing a document or revealing a pane fails the keyboard assertions although an editor has the keyboard; why_new=Cycle 0045 local review tests-1 #7 (only the group focus commands and Cursor's Focus Agent cleared the flag); seam=the fake editor's keyboardOnBody after a focused pane was disposed
  test(`the fake editor takes the keyboard from the page body again with ${regained}`, async () => {
    // Arrange: the Application pane had the keyboard and was disposed, so the page body has it.
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    const chat = harness.addSeparateEditorPart()
    try {
      await harness.reader.open()
      const panels = harness.nativePanels(),
        application = panels.find(
          (panel) => panel.kind === 'codebook.scopedBrowser',
        ),
        explanation = panels.find(
          (panel) => panel.kind === 'codebook.studyContext',
        )
      assert.ok(application)
      assert.ok(explanation)
      application.reveal(undefined, false)
      application.dispose()
      const afterDisposal = harness.keyboardOnBody()

      // Act
      if (regained === 'a pane revealed with the focus')
        explanation.reveal(undefined, false)
      if (regained === 'a text document shown with the focus')
        await harness.editor.window.showTextDocument(
          {
            uri: harness.editor.Uri.file('/learner/notes.txt'),
            getText: () => 'Learner notes.\n',
          },
          { viewColumn: 1, preserveFocus: false },
        )
      if (regained === "the chat's tab focused") chat.focusTab()
      if (regained === "the learner's file focused")
        harness.focusMutableDraft('learner-notes.ts', 1)

      // Assert
      assert.equal(afterDisposal, true)
      assert.equal(harness.keyboardOnBody(), false)
    } finally {
      await harness.close()
    }
  })

// Value: protects=a finished reader test leaving nothing behind in its fake editor: a tab close the fake editor still owed at the harness's close never runs; fails_when=the fake editor's timer outlives the harness, so up to 20 ms after a test ended it removes tabs and groups and calls the listeners of that test; why_new=Cycle 0045 local review tests-1 #3 (the timers of closeDisposedPanelTabsLater and revealPanelsLater were never cleared); seam=the fake editor's pending timers and its tab and group events
test("the fake editor of a closed harness runs none of the tab closes it still owed: its tabs stay and no listener is called after the harness's close", async () => {
  // Arrange: the editor closes a disposed pane's tab 20 ms after the disposal; the work window does not have the focus, so the reader's close settles no keyboard and waits for no tab.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.closeDisposedPanelTabsLater()
  let eventsAfterClose = 0,
    closed = false
  const countAfterClose = (): void => {
    if (closed) eventsAfterClose++
  }
  await harness.reader.open()
  harness.focusMutableDraft('learner-notes.ts', 2)
  harness.changeWindowFocus(false)
  harness.editor.window.tabGroups.onDidChangeTabGroups(countAfterClose)
  harness.editor.window.tabGroups.onDidChangeTabs(countAfterClose)

  // Act: the harness closes while the disposed panes' tabs still wait for their close; three times the fake editor's delay then passes.
  await harness.reader.close()
  const owedAtReaderClose = harness.pendingEditorTimerCount()
  await harness.close()
  closed = true
  const tabsAtClose = harness.groups.flatMap((group) => group.tabs).length
  await new Promise((resolve) => setTimeout(resolve, 60))

  // Assert
  assert.equal(owedAtReaderClose, 2)
  assert.equal(harness.pendingEditorTimerCount(), 0)
  assert.equal(eventsAfterClose, 0)
  assert.equal(
    harness.groups.flatMap((group) => group.tabs).length,
    tabsAtClose,
  )
})

// Value: protects=a finished reader test leaving nothing behind in its fake editor when it ended while the editor still named another group for the end of a maximization: the group that had the keyboard is not named again after the harness's close; fails_when=the timer that restores the named group is not among the fake editor's pending timers, so it outlives the harness, renames the active group and calls the listeners of a test that has ended; why_new=Cycle 0046 row 89 (local CodeRabbit review, finding 7: the restoration of nameAnotherGroupWhenMaximizationEnds was the one later change of the fake editor outside pendingEditorTimers); seam=the fake editor's pending timers and its group events
test("the fake editor of a closed harness does not name the focused group again after a maximization ended: no group event arrives after the harness's close", async () => {
  // Arrange: the editor names the Application pane's group for 250 ms when a maximization ends; the learner read the explanation enlarged.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.nameAnotherGroupWhenMaximizationEnds(1, 250)
  let eventsAfterClose = 0,
    closed = false
  await harness.reader.open()
  await harness.reader.action('read-context')
  harness.editor.window.tabGroups.onDidChangeTabGroups(() => {
    if (closed) eventsAfterClose++
  })

  // Act: the maximization ends, and the harness closes while the editor still owes the name of the focused group; longer than that moment then passes.
  await harness.editor.commands.executeCommand(
    'workbench.action.minimizeOtherEditors',
  )
  const owedAfterCommand = harness.pendingEditorTimerCount()
  await harness.close()
  closed = true
  const owedAfterClose = harness.pendingEditorTimerCount()
  await new Promise((resolve) => setTimeout(resolve, 350))

  // Assert
  assert.equal(eventsAfterClose, 0)
  assert.equal(owedAfterCommand, 1)
  assert.equal(owedAfterClose, 0)
})

// Value: protects=a finished reader test leaving nothing behind in its fake editor when it ended while the editor still owed its report of the active text editor after a leftover tab closed: no report arrives after the harness's close; fails_when=that 60 ms timer is not among the fake editor's pending timers, so it outlives the harness and calls the active-editor listeners of a test that has ended; why_new=Cycle 0046 row 89, found beside it: the same later change of the fake editor outside pendingEditorTimers; seam=the fake editor's pending timers, restoreLeftoverCapturedSource with lateTextEditor, its active-editor event
test("the fake editor of a closed harness does not report its active text editor late after a leftover tab closed: no active-editor event arrives after the harness's close", async () => {
  // Arrange: a leftover captured source has the focus; for 60 ms after its close the editor reports no active text editor yet.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  const leftover = harness.restoreLeftoverCapturedSource({
    lateTextEditor: true,
  })
  let reportsAfterClose = 0,
    closed = false
  harness.editor.window.onDidChangeActiveTextEditor(() => {
    if (closed) reportsAfterClose++
  })

  // Act: the leftover closes, and the harness closes while the editor still owes that report; three times its delay then passes.
  await harness.editor.window.tabGroups.close([leftover], true)
  const owedAfterTabClose = harness.pendingEditorTimerCount()
  await harness.close()
  closed = true
  const owedAfterClose = harness.pendingEditorTimerCount()
  await new Promise((resolve) => setTimeout(resolve, 180))

  // Assert
  assert.equal(reportsAfterClose, 0)
  assert.equal(owedAfterTabClose, 1)
  assert.equal(owedAfterClose, 0)
})

for (const [hiding, owed] of [
  [
    'missed-the-stop',
    'the refresh that loads the stop it missed, 400 ms later',
  ],
  ['never-opened', 'the first rows of its tree, 60 ms later'],
] as const)
  // Value: protects=a finished reader test leaving nothing behind in its fake editor when it ended while the Variables view still owed a later step: that step does not run after the harness's close; fails_when=the view's timer is not among the fake editor's pending timers, so after a test ended it changes the view, lists the values and tells that test's historical debuggers; why_new=Cycle 0046 row 89, found beside it: the Variables view's two timers were the last later changes of the fake editor outside pendingEditorTimers; seam=the fake editor's pending timers, hideNativeVariables and the editor's command that shows the Variables view
  test(`the fake editor of a closed harness does not finish showing its Variables view late: ${owed}, is dropped with the harness's close`, async () => {
    // Arrange: the Variables view was hidden in the way the case names; shown again, it owes one later step.
    const harness = await workspaceHarness(false)
    harness.hideNativeVariables(hiding)

    // Act: the view is shown, and the harness closes while that step is still owed.
    await harness.editor.commands.executeCommand(
      'workbench.debug.action.focusVariablesView',
    )
    const owedAfterCommand = harness.pendingEditorTimerCount()
    await harness.close()
    const owedAfterClose = harness.pendingEditorTimerCount()

    // Assert
    assert.equal(owedAfterCommand, 1)
    assert.equal(owedAfterClose, 0)
  })

// Value: protects=reader tests meeting Cursor as it answers the command that focuses the first editor group while the chat input has the keyboard and the editor names a group of the main editor: a pane in the first group is not reported as focused and the named group stays the named one; fails_when=the fake reports the pane's focus in that state, which Cursor does not, so a measurement that waits for that report passes in the tests and ends after five seconds in the editor; why_new=Cycle 0045 cause 12 (e), second native result (obs15 R: a recording opened from the chat input while the editor named the captured source's group was never read; the wait for the first group's focus ran out); seam=the fake editor with a separate editor part, leavePaneFocusUnreportedBesideChat and its panes
test("the fake Cursor reports no focus of a pane in the first group while the chat input has the keyboard and the editor names the captured source's group", async () => {
  // Arrange: the three Study panes are open, the Application pane is the tab the first group shows; the learner clicked into the captured source and then into the chat input.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 1, groups: [{}, {}] })
  harness.groups.at(-1)!.tabs = []
  harness.groups.at(-1)!.activeTab = undefined
  const chat = harness.addSeparateEditorPart()
  harness.leavePaneFocusUnreportedBesideChat()
  try {
    harness.focusMutableDraft('actions.ts', 1)
    await harness.reader.open()
    const source = harness.editor.window.visibleTextEditors.find(
      (editor) => editor.document.uri.scheme === 'codebook-source',
    )
    assert.ok(source)
    await harness.editor.window.showTextDocument(source.document, {
      viewColumn: 2,
      preserveFocus: false,
    })
    chat.focus()
    let groupEvents = 0
    harness.editor.window.tabGroups.onDidChangeTabGroups(() => {
      groupEvents++
    })

    // Act
    await harness.editor.commands.executeCommand(
      'workbench.action.focusFirstEditorGroup',
    )

    // Assert: the pane has the keyboard, and nothing the editor API offers says so.
    const application = harness
      .nativePanels()
      .find((panel) => panel.kind === 'codebook.scopedBrowser')
    assert.deepEqual(
      {
        paneWithKeyboard: harness.focusedPanel(),
        reportedActive: application?.active,
        namedColumn: harness.editor.window.tabGroups.activeTabGroup.viewColumn,
        activeTextEditor: harness.editor.window.activeTextEditor?.viewColumn,
        groupEvents,
        chatHasKeyboard: chat.focused(),
      },
      {
        paneWithKeyboard: 'codebook.scopedBrowser',
        reportedActive: false,
        namedColumn: 2,
        activeTextEditor: undefined,
        groupEvents: 0,
        chatHasKeyboard: false,
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=reader tests meeting Cursor as it answers a text editor that is shown with the keyboard while it names the chat's group: the editor is reported as the active text editor and the chat's group stays the named one; fails_when=the fake names the shown editor's group as the active tab group, which Cursor does only after the next tab or group change, so a measurement that waits for that name passes in the tests and is refused in the editor; why_new=Cycle 0045 cause 12 (e), second native result (the measurement enters the main editor through the captured source's text editor when the first group shows a pane); seam=the fake editor with a separate editor part and leavePaneFocusUnreportedBesideChat
test("the fake Cursor reports a text editor shown with the keyboard beside the chat as the active text editor and keeps naming the chat's group", async () => {
  // Arrange: the editor names the chat's group, whose input has the keyboard; the first group shows a file.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 1, groups: [{}, {}] })
  harness.groups.at(-1)!.tabs = []
  harness.groups.at(-1)!.activeTab = undefined
  const chat = harness.addSeparateEditorPart()
  harness.leavePaneFocusUnreportedBesideChat()
  try {
    const learnerFile = harness.focusMutableDraft('actions.ts', 1)
    chat.focusTab()

    // Act
    await harness.editor.window.showTextDocument(learnerFile.document, {
      viewColumn: 1,
      preserveFocus: false,
    })
    const afterShow = {
      namesChatGroup:
        harness.editor.window.tabGroups.activeTabGroup.tabs.includes(chat.tab),
      activeTextEditor:
        harness.editor.window.activeTextEditor?.document.uri.toString(),
      chatHasKeyboard: chat.focused(),
      layoutRead: await harness.editor.commands.executeCommand(
        'vscode.getEditorLayout',
      ),
    }
    // The next change of a tab group rebuilds the tab model, which corrects the name.
    chat.resync('wrapper')

    // Assert
    assert.deepEqual(afterShow, {
      namesChatGroup: true,
      activeTextEditor: learnerFile.document.uri.toString(),
      chatHasKeyboard: false,
      // The main editor's two rows, not the chat part's one group of 743.
      layoutRead: { orientation: 1, groups: [{ size: 1 }, { size: 1 }] },
    })
    assert.equal(harness.editor.window.tabGroups.activeTabGroup.viewColumn, 1)
  } finally {
    await harness.close()
  }
})

// Value: protects=reader tests meeting the editor's side bars as both editors treat them: the maximize command hides both, the end of the maximization shows neither, the show commands are safe on an open bar, and only the editor area's width tells which bars are open; fails_when=the fake brings the bars back when the maximization ends, so a reader that leaves the window without its side bars passes in the tests; why_new=Cycle 0045 NF-22 (obs15 P4 in Cursor 3.23.12 and VS Code 1.140.0); seam=the fake editor's modelSideBars, sideBars and its layout read in pixels
test('the fake editor hides both side bars for the maximize command, shows neither when the maximization ends, and reads the columns of the editor area in the pixels the bars leave', async () => {
  // Arrange: two columns between a primary side bar of 214 px and a secondary one of 461 px in a window of 1335 px.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  harness.modelSideBars({ primary: true, auxiliary: true })
  try {
    const run = (command: string): Thenable<unknown> =>
        harness.editor.commands.executeCommand(command),
      columns = (): Thenable<unknown> => run('vscode.getEditorLayout')

    // Act
    const betweenBothBars = await columns()
    await run('workbench.action.closeSidebar')
    const withoutPrimary = await columns()
    await run('workbench.action.maximizeEditorHideSidebar')
    await run('workbench.action.minimizeOtherEditors')
    const afterTheMaximization = {
      bars: harness.sideBars(),
      columns: await columns(),
    }
    await run('workbench.action.focusAuxiliaryBar')
    await run('workbench.action.focusAuxiliaryBar')
    const afterShowingTwice = harness.sideBars()
    await run('workbench.action.focusActiveEditorGroup')

    // Assert
    assert.deepEqual(betweenBothBars, {
      orientation: 0,
      groups: [{ size: 330 }, { size: 330 }],
    })
    assert.deepEqual(withoutPrimary, {
      orientation: 0,
      groups: [{ size: 437 }, { size: 437 }],
    })
    assert.deepEqual(afterTheMaximization.bars, {
      primary: false,
      auxiliary: false,
      hasKeyboard: false,
    })
    assert.deepEqual(afterShowingTwice, {
      primary: false,
      auxiliary: true,
      hasKeyboard: true,
    })
    assert.deepEqual(harness.sideBars(), {
      primary: false,
      auxiliary: true,
      hasKeyboard: false,
    })
  } finally {
    await harness.close()
  }
})

// Value: protects=reader tests meeting the editor as it answers a numbered focus command for the column after the main editor's last group, where Cursor's chat group sits; fails_when=the fake focuses the chat's group for that command, which neither editor does: the command opens a new empty group in the main editor, so a reader that returns the focus that way passes in the tests and leaves an empty group in the editor; why_new=Cycle 0045 cause 12 (d) (obs15 P1 and P2: a new empty group at the chat's column, the chat's group one column on, the caret on the empty group); seam=the fake editor's group focus commands and its "Focus Agent" command
test("the fake editor opens a new empty group for the focus command of the column after the main editor's last group, and Cursor's Focus Agent command gives the chat the keyboard without changing a group", async () => {
  // Arrange: two groups of the main editor, and the chat's group at column 3 with the keyboard.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 1, groups: [{}, {}] })
  const chat = harness.addSeparateEditorPart()
  try {
    harness.focusMutableDraft('actions.ts', 1)
    chat.focusTab()

    // Act
    await harness.editor.commands.executeCommand(
      'workbench.action.focusThirdEditorGroup',
    )
    const afterGroupCommand = {
      groups: harness.groups.length,
      emptyGroupColumn: harness.groups.find((group) => !group.tabs.length)
        ?.viewColumn,
      activeColumn: harness.editor.window.tabGroups.activeTabGroup.viewColumn,
      chatColumn: harness.groups.find((group) => group.tabs.includes(chat.tab))
        ?.viewColumn,
      chatHasKeyboard: chat.focused(),
    }
    await harness.editor.commands.executeCommand('composer.focusComposer')

    // Assert
    assert.deepEqual(afterGroupCommand, {
      groups: 4,
      emptyGroupColumn: 3,
      activeColumn: 3,
      chatColumn: 4,
      chatHasKeyboard: false,
    })
    assert.equal(chat.focused(), true)
    assert.equal(harness.groups.length, 4)
    assert.equal(
      (await harness.editor.commands.getCommands()).includes(
        'composer.focusComposer',
      ),
      true,
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner who runs Arrange Study Workspace while the Study pane already has the keyboard after a Read of the explanation: the three-pane layout is restored at once; fails_when=the Arrange reveals that pane once more and waits five seconds for a focus report its document cannot send, because it had the focus already and the editor's second reveal takes it from the document without an event, so the Arrange ends without running any editor command, the Read's layout stays and the pane shows an internal timeout; why_new=Cycle 0046 row 338 (native probe N325 in VS Code 1.140.0: 2 of 8 such Arranges ended after 5,036 ms with "Error: Error: Timed out waiting for owned presentation inner focus"); seam=the workspace harness's dropInnerFocusAtRevealOfFocusedPane, the reader's Read and arrange actions, panel reveals, the fake editor's maximized group and the pane's error lines
test('Arrange Study Workspace after a Read of the explanation restores the three-pane layout at once when the Study pane already has the keyboard, without revealing that pane again or waiting for its focus report', async () => {
  // Arrange: the learner reads the explanation enlarged, so the Study pane is the editor's active pane, and its document reported that it has the keyboard; a second reveal of it would take the keyboard from its document and bring no report.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.open()
    await harness.reader.action('read-context')
    harness.receiveContext({ type: 'pane-focus', focused: true })
    harness.dropInnerFocusAtRevealOfFocusedPane()
    const duringRead = {
      maximized: harness.maximizedEditorGroup(),
      keyboardInStudyPane:
        harness.innerFocusedPanel() === 'codebook.studyContext',
    }
    const revealsBefore = harness.panelReveals().length
    const startedMs = performance.now()

    // Act
    await harness.reader.action('arrange')

    // Assert
    assert.deepEqual(duringRead, { maximized: true, keyboardInStudyPane: true })
    assert.deepEqual(
      {
        endedWithinOneSecond: performance.now() - startedMs < 1_000,
        maximized: harness.maximizedEditorGroup(),
        layoutConfirmed: harness.reader.presentationState().layoutConfirmed,
        errorLines: [...harness.reader.inspect().view!.errors],
        studyPaneReveals: harness
          .panelReveals()
          .slice(revealsBefore)
          .filter((reveal) => reveal.kind === 'codebook.studyContext').length,
        keyboardInStudyPane:
          harness.innerFocusedPanel() === 'codebook.studyContext',
      },
      {
        endedWithinOneSecond: true,
        maximized: false,
        layoutConfirmed: true,
        errorLines: [],
        studyPaneReveals: 0,
        keyboardInStudyPane: true,
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner who runs Arrange Study Workspace after a Read of the explanation while the Study pane is the editor's active pane and its document does not have the keyboard (it reported a blur, as when the keyboard is in the terminal or a view, or when the editor's own focus of the frame around it took it): the pane is given the keyboard with one reveal and the three-pane layout is restored at once; fails_when=the Arrange waits five seconds for a report of the pane's document that does not come, runs no editor command and leaves the Read's layout; why_new=Cycle 0046 row 338 (the other order the native failure can have: the pane lost its document's focus before the Arrange); seam=the workspace harness's suppressNativeInnerFocus (the pane's document never takes the focus), the pane's own focus report, panel reveals, the fake editor's maximized group and the pane's error lines
test('Arrange Study Workspace after a Read of the explanation gives the Study pane the keyboard with one reveal and restores the three-pane layout at once when that pane is the active one and its document reports no keyboard', async () => {
  // Arrange: the learner reads the explanation enlarged; then the pane's document reports that it lost the focus, and it will not report it again.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.open()
    await harness.reader.action('read-context')
    harness.receiveContext({ type: 'pane-focus', focused: false })
    harness.suppressNativeInnerFocus()
    const revealsBefore = harness.panelReveals().length
    const startedMs = performance.now()

    // Act
    await harness.reader.action('arrange')

    // Assert
    assert.deepEqual(
      {
        endedWithinOneSecond: performance.now() - startedMs < 1_000,
        maximized: harness.maximizedEditorGroup(),
        layoutConfirmed: harness.reader.presentationState().layoutConfirmed,
        errorLines: [...harness.reader.inspect().view!.errors],
        studyPaneReveals: harness
          .panelReveals()
          .slice(revealsBefore)
          .filter((reveal) => reveal.kind === 'codebook.studyContext'),
      },
      {
        endedWithinOneSecond: true,
        maximized: false,
        layoutConfirmed: true,
        errorLines: [],
        studyPaneReveals: [
          {
            kind: 'codebook.studyContext',
            column: undefined,
            preserveFocus: false,
          },
        ],
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner who presses Enlarge explanation in the Study pane, which has the keyboard then: the pane is enlarged at once; fails_when=the Enlarge reveals the pane it was pressed in once more and waits five seconds for a focus report that pane's document cannot send, so the button ends in an internal timeout line and nothing is enlarged; why_new=Cycle 0046 row 338 (the other wait of the same kind: an Enlarge needs the editor's focus on the pane, as an Arrange does, and not a report of the pane's document); seam=the workspace harness's dropInnerFocusAtRevealOfFocusedPane, the focus-context and enlarge-context actions, panel reveals and the fake editor's maximized group
test('Enlarge explanation pressed in the Study pane enlarges it at once, without revealing that pane again or waiting for its focus report', async () => {
  // Arrange: the Study pane is the editor's active pane and its document reported that it has the keyboard; a second reveal of it would take the keyboard from its document and bring no report.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.open()
    await harness.reader.action('focus-context')
    harness.receiveContext({ type: 'pane-focus', focused: true })
    harness.dropInnerFocusAtRevealOfFocusedPane()
    const revealsBefore = harness.panelReveals().length
    const startedMs = performance.now()

    // Act
    const outcome = await harness.reader.action('enlarge-context').then(
      () => 'enlarged',
      (error: unknown) => String(error),
    )

    // Assert
    assert.deepEqual(
      {
        outcome,
        endedWithinOneSecond: performance.now() - startedMs < 1_000,
        maximized: harness.maximizedEditorGroup(),
        studyPaneReveals: harness
          .panelReveals()
          .slice(revealsBefore)
          .filter((reveal) => reveal.kind === 'codebook.studyContext').length,
      },
      {
        outcome: 'enlarged',
        endedWithinOneSecond: true,
        maximized: true,
        studyPaneReveals: 0,
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner reading in the Study pane's error line what happened and what to do when Arrange Study Workspace could not give the Study pane the keyboard: one sentence that names the pane, the five seconds and the next step; fails_when=the line shows the wait's internal text behind a doubled prefix ("Error: Error: Timed out waiting for owned presentation inner focus"), which names nothing a learner can act on; why_new=Cycle 0046 row 338 (the sentence of a focus wait that does end without its report); seam=the workspace harness's suppressNativeInnerFocus (the pane's document never takes the focus), the focus-app and arrange actions and the pane's error lines
test('Arrange Study Workspace run from the Application pane says in one sentence that the Explanation pane did not confirm the keyboard within five seconds and what to do, when that pane never reports the focus', async () => {
  // Arrange: the Application pane is the active one, and the Study pane's document never takes the focus.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.open()
    await harness.reader.action('focus-app')
    harness.suppressNativeInnerFocus()

    // Act: the Arrange waits its five seconds for the Study pane's report.
    await harness.reader.action('arrange')

    // Assert
    assert.deepEqual(
      [...harness.reader.inspect().view!.errors],
      [
        'Error: Codebook asked the Explanation pane to take the keyboard, and the pane did not confirm it within 5 seconds. The action was stopped there and nothing else was changed. Click into the Explanation pane and repeat the action.',
      ],
    )
  } finally {
    await harness.close()
  }
})
