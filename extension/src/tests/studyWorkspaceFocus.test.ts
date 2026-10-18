import assert from 'node:assert/strict'
import { test } from 'node:test'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import {
  workspaceHarness,
  configuredWorkspaceHarness,
  readerSeams,
} from './studyWorkspaceHarness'
// The chat part has the keyboard, so no text editor proves the main editor the active part and the measurement borrows the first group; a learner's file in front of the second group proves it, and the tests after these show that it borrows nothing then (Cycle 0046 row 663).
for (const boundary of ['primary response', 'main measurement'] as const)
  for (const interaction of [
    'tab roundtrip',
    'selection roundtrip',
    'none',
  ] as const)
    test(`cold Wiki from chat ${interaction === 'none' ? 'keeps its intentional focus handoff' : `remembers learner ${interaction}`} during ${boundary}`, async () => {
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
      chat.focus()
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
          primary.document.uri.toString(),
        )
        assert.equal(harness.commands.includes('vscode.setEditorLayout'), false)
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

// Value: protects=the learner's file in front of the second group, which has the keyboard, at a cold Wiki layout beside another editor part (Cursor's chat part): that file as the active text editor proves the main editor the active part, so the layout is measured without borrowing the first group, the file keeps the keyboard and is not shown again, and a learner's move away during the measurement is still refused; fails_when=the measurement borrows the first group (workbench.action.focusFirstEditorGroup), which gives primary.txt the keyboard, and then shows original.txt again with the keyboard (showTextDocument, preserveFocus false); why_new=Cycle 0046 row 663 (rework of the six "cold Wiki from secondary text" tests, which encoded that borrow: their "primary response" boundary no longer exists, their "main measurement" is the only measurement now, a tab roundtrip through primary.txt and a selection roundtrip in original.txt are still refused, the first by the measurement's own watch and the second by the reader's focus receipt, and the handoff keeps original.txt's keyboard without the borrow's give-back); seam=workspaceHarness with addSeparateEditorPart (not focused), focusMutableDraft in columns 1 and 2, holdNextCommand on the layout read, the reader's own focus receipts, the native commands and textDocumentShows
for (const interaction of [
  'tab roundtrip',
  'selection roundtrip',
  'none',
] as const)
  test(`cold Wiki from the learner's file in the second group beside another editor part ${interaction === 'none' ? 'measures without borrowing the first group' : `remembers a learner ${interaction} during its only measurement`}, and that file keeps the keyboard without being shown again`, async () => {
    // Arrange: original.txt, in front of the second group, is the active text editor; Cursor's chat part stands beside the main editor without the keyboard.
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
    const showsBefore = harness.textDocumentShows().length,
      commandsBefore = harness.commands.length
    const measured = harness.holdNextCommand('vscode.getEditorLayout')
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
      await measured.started
      // Act
      if (interaction === 'tab roundtrip') {
        primary.focus()
        original.focus()
      }
      if (interaction === 'selection roundtrip') {
        const selections = original.editor.selections
        original.editor.selections = [
          {
            anchor: selections[0]!.anchor.with(7, 0),
            active: selections[0]!.active.with(7, 0),
          },
        ]
        original.editor.selections = selections
      }
      measured.release()
      await outcome

      // Assert: original.txt has the keyboard; no focus command ran and no file was shown with the keyboard.
      assert.deepEqual(
        {
          focusedFile: harness.focusedSource()?.document.uri.toString(),
          focusCommands: harness.commands
            .slice(commandsBefore)
            .filter((command) =>
              /^workbench\.action\.focus\w+EditorGroup$/.test(command),
            ),
          showsWithKeyboard: harness
            .textDocumentShows()
            .slice(showsBefore)
            .filter((shown) => !shown.preserveFocus)
            .map((shown) => shown.name),
          layoutApplied: harness.commands.includes('vscode.setEditorLayout'),
        },
        {
          focusedFile: original.document.uri.toString(),
          focusCommands: [],
          showsWithKeyboard: [],
          layoutApplied: false,
        },
      )
      assert.equal(harness.runtimes.length, 0)
      assert.equal(primary.document.getText(), 'Original learner draft.\n')
      assert.equal(original.document.getText(), 'Original learner draft.\n')
      assert.deepEqual(chat.layout(), {
        orientation: 1,
        groups: [{ size: 743 }],
      })
    } finally {
      measured.release()
      await opening.catch(() => undefined)
      for (const receipt of receipts) receipt.dispose()
      assert.equal(harness.focusListenerCount(), listenerCount)
      await harness.close()
    }
  })

// Value: protects=a cold Wiki layout whose measurement borrows the first group beside another editor part taking its own primary transition for no learner's change, in either order of the editor's notifications; fails_when=the group's activation reported before its text editor, or after it, is read as the learner's move and the layout is refused; why_new=Cycle 0046 row 663 (rework: the chat part has the keyboard now, so the measurement still borrows the first group and leaves primary.txt the keyboard, which the reader gives back to the chat later; from original.txt in the second group, as before, the measurement borrows nothing, see the tests above); seam=workspaceHarness with addSeparateEditorPart and its focus, usePrimaryFocusNotificationOrder, the reader's own focus receipts, the native commands
for (const order of ['editor first', 'group first'] as const)
  test(`cold Wiki accepts the intended primary transition when native notifications arrive ${order}`, async () => {
    // Arrange: the chat part has the keyboard; primary.txt is in front of the first group and original.txt of the second.
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({
      orientation: 0,
      groups: [{ size: 490 }, { size: 490 }],
    })
    const chat = harness.addSeparateEditorPart(),
      primary = harness.focusMutableDraft('primary.txt', 1),
      original = harness.focusMutableDraft('original.txt', 2)
    chat.focus()
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
      // Assert: the measurement borrowed the first group once and left primary.txt the keyboard.
      assert.equal(
        harness.focusedSource()?.document.uri.toString(),
        primary.document.uri.toString(),
      )
      assert.equal(
        harness.commands.filter(
          (command) => command === 'workbench.action.focusFirstEditorGroup',
        ).length,
        1,
      )
      assert.equal(harness.commands.includes('vscode.setEditorLayout'), false)
      assert.equal(primary.document.getText(), 'Original learner draft.\n')
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

// Value: protects=Cursor's chat tab keyboard after a cold Wiki layout an agent asked for (codebook_open_book): the measurement focuses the first editor group to measure the main editor beside Cursor's chat editor part and leaves the keyboard on the learner's file there, and the arrangement's keyboard return, asked by RepositoryReader.open once the Wiki is shown, gives it back through Cursor's chat command; fails_when=arrangeRepository answers no keyboard return or one that leaves the keyboard in the first group; why_new=Cycle 0046 row 620; seam=workspaceHarness with addSeparateEditorPart and focusTab (Cursor's chat tab with the keyboard), focusMutableDraft in column 1, the reader's own focus receipts, the native commands
test("a cold Wiki layout that borrowed the keyboard of Cursor's chat tab gives it back to the chat when the reader asks", async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({
    orientation: 0,
    groups: [{ size: 490 }, { size: 490 }],
  })
  const chat = harness.addSeparateEditorPart(),
    primary = harness.focusMutableDraft('primary.txt', 1)
  chat.focusTab()
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
  try {
    // Act
    const keyboardReturn = await harness.reader.arrangeRepository(
      new AbortController().signal,
      undefined,
      focus,
    )
    const focusedAfterLayout = harness.focusedSource()?.document.uri.toString()
    for (const receipt of receipts) receipt.dispose()
    const returned = await keyboardReturn?.()

    // Assert: the measurement left the keyboard on the learner's file of the first group, and the return gave it to the chat through Cursor's chat command.
    assert.equal(focusedAfterLayout, primary.document.uri.toString())
    assert.equal(returned, true)
    assert.equal(chat.focused(), true)
    assert.equal(harness.focusedSource(), undefined)
    assert.deepEqual(
      harness.commands.filter(
        (command) => command === 'composer.focusComposer',
      ),
      ['composer.focusComposer'],
    )
  } finally {
    for (const receipt of receipts) receipt.dispose()
    await harness.close()
  }
})

// Value: protects=an agent's cold Wiki open from Cursor's chat (codebook_open_book, and the openRepositoryWiki command, which share this layout): the measurement focuses the first editor group beside Cursor's chat part, Cursor then reports the first group's file as the active text editor while it still names the chat's group (finding 588), and the reader's own focus receipt takes that borrow as the measurement's and not as a learner's change; the layout answers and its keyboard return gives the chat its keyboard back; fails_when=the receipt waits for the first group to be named, which Cursor does not do, so the open is refused with "Native focus changed during repository navigation; the newer learner focus was preserved." and the keyboard stays in the learner's login-form.tsx with nothing given back (C58 c58-cu-2c, c58-cu-567, c58-cu-567-probe); why_new=Cycle 0046 row 660; seam=workspaceHarness with addSeparateEditorPart and focusTab, leavePaneFocusUnreportedBesideChat (Cursor's stale group name), focusMutableDraft in column 1, the reader's own focus receipts (retainRepositoryFocus), the native commands
test("an agent's cold Wiki layout beside Cursor's chat part, which keeps naming the chat's group after the first group's focus, answers and gives the chat its keyboard back", async () => {
  // Arrange: Cursor with the Agent chat as a tab of another editor part holding the keyboard; the learner's login-form.tsx is in front of the first of two groups.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({
    orientation: 0,
    groups: [{ size: 490 }, { size: 490 }],
  })
  const chat = harness.addSeparateEditorPart()
  harness.leavePaneFocusUnreportedBesideChat()
  harness.focusMutableDraft('login-form.tsx', 1)
  chat.focusTab()
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
  try {
    // Act
    const arranged = await harness.reader
      .arrangeRepository(new AbortController().signal, undefined, focus)
      .then(
        (keyboardReturn) => ({ keyboardReturn, refusal: undefined }),
        (error: unknown) => ({
          keyboardReturn: undefined,
          refusal: String(error),
        }),
      )
    for (const receipt of receipts) receipt.dispose()
    const returned = await arranged.keyboardReturn?.()

    // Assert: the layout answered, and the chat has its keyboard again through Cursor's chat command; no text editor keeps it.
    assert.deepEqual(
      {
        refusal: arranged.refusal,
        returned,
        chatHasKeyboard: chat.focused(),
        focusedFile: harness.focusedSource()?.document.uri.toString(),
        chatCommands: harness.commands.filter(
          (command) => command === 'composer.focusComposer',
        ),
      },
      {
        refusal: undefined,
        returned: true,
        chatHasKeyboard: true,
        focusedFile: undefined,
        chatCommands: ['composer.focusComposer'],
      },
    )
  } finally {
    for (const receipt of receipts) receipt.dispose()
    await harness.close()
  }
})

// Value: protects=an agent's cold Wiki open from Cursor's chat in a window with one main editor group: the measurement focuses that group under the chat's stale group name, and the split the Wiki needs makes Cursor rebuild its tab model, which names the first group from then on; the reader's focus receipt takes that late name of the measured group for no learner's change; fails_when=the receipt keeps the stale name as its baseline and refuses the open with "Native focus changed during repository navigation; the newer learner focus was preserved." once the editor names the first group; why_new=Cycle 0046 row 660 (the late name after the editor's own rebuild); seam=workspaceHarness with one main group, addSeparateEditorPart and focusTab, leavePaneFocusUnreportedBesideChat (its stale name ends with the next group change), the reader's own focus receipts, the native commands
test("an agent's cold Wiki layout beside Cursor's chat part that splits the only main group follows the editor's late name of the measured group and gives the chat its keyboard back", async () => {
  // Arrange: Cursor with the Agent chat holding the keyboard and one main editor group with the learner's login-form.tsx.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] })
  const chat = harness.addSeparateEditorPart()
  harness.leavePaneFocusUnreportedBesideChat()
  harness.focusMutableDraft('login-form.tsx', 1)
  chat.focusTab()
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
  try {
    // Act
    const arranged = await harness.reader
      .arrangeRepository(new AbortController().signal, undefined, focus)
      .then(
        (keyboardReturn) => ({ keyboardReturn, refusal: undefined }),
        (error: unknown) => ({
          keyboardReturn: undefined,
          refusal: String(error),
        }),
      )
    for (const receipt of receipts) receipt.dispose()
    const returned = await arranged.keyboardReturn?.()

    // Assert: the split was made, the layout answered, and the chat has its keyboard again.
    assert.deepEqual(
      {
        refusal: arranged.refusal,
        split: harness.commands.includes('vscode.setEditorLayout'),
        returned,
        chatHasKeyboard: chat.focused(),
      },
      {
        refusal: undefined,
        split: true,
        returned: true,
        chatHasKeyboard: true,
      },
    )
  } finally {
    for (const receipt of receipts) receipt.dispose()
    await harness.close()
  }
})

// Value: protects=Cursor's chat keyboard when an agent's cold Wiki layout is refused after its measurement borrowed the main editor: the refusal gives the chat its keyboard back before it is reported, so the learner's file does not keep it; fails_when=a refused layout leaves the keyboard in the learner's login-form.tsx with nothing given back, as C58 c58-cu-2c showed for the refusal of row 660; why_new=Cycle 0046 row 660 (the refusal's keyboard); seam=workspaceHarness with one main group, addSeparateEditorPart and focusTab, leavePaneFocusUnreportedBesideChat, failNextCommand('vscode.setEditorLayout'), the reader's own focus receipts, the native commands
test("an agent's cold Wiki layout beside Cursor's chat part that is refused after its measurement gives the chat its keyboard back", async () => {
  // Arrange: one main editor group with the learner's login-form.tsx, the chat holding the keyboard, and an editor that refuses the split the Wiki needs.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] })
  const chat = harness.addSeparateEditorPart()
  harness.leavePaneFocusUnreportedBesideChat()
  harness.focusMutableDraft('login-form.tsx', 1)
  chat.focusTab()
  harness.failNextCommand('vscode.setEditorLayout')
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
  try {
    // Act
    const refusal = await harness.reader
      .arrangeRepository(new AbortController().signal, undefined, focus)
      .then(
        () => undefined,
        (error: unknown) => String(error),
      )

    // Assert: the split's refusal is reported, and the chat has its keyboard again; no text editor keeps it.
    assert.deepEqual(
      {
        refusal,
        chatHasKeyboard: chat.focused(),
        focusedFile: harness.focusedSource()?.document.uri.toString(),
        chatCommands: harness.commands.filter(
          (command) => command === 'composer.focusComposer',
        ),
      },
      {
        refusal: 'Error: Native layout command failed',
        chatHasKeyboard: true,
        focusedFile: undefined,
        chatCommands: ['composer.focusComposer'],
      },
    )
  } finally {
    for (const receipt of receipts) receipt.dispose()
    await harness.close()
  }
})

// Value: protects=the truth of what the learner is told when an agent's cold Wiki layout beside Cursor's chat part is refused after its measurement borrowed the main editor: the chat gets its keyboard back, and the one sentence says that Codebook could not finish arranging its panes; fails_when=the refused layout's give-back (arrangeRepositoryLayout's keyboardReturn) passes no cause, so the return's own rule after a borrow tells "Codebook placed its panes and gave the keyboard back to the chat. …" for a Wiki that was never arranged; why_new=Cycle 0046 row 736 (the same gap as open's refusal, found by its check of every foreign-focus return after a borrow); seam=workspaceHarness with one main group, addSeparateEditorPart and focusTab, leavePaneFocusUnreportedBesideChat, failNextCommand('vscode.setEditorLayout'), the reader's own focus receipts, the native commands and the information messages
test("an agent's cold Wiki layout beside Cursor's chat part refused after its measurement gives the chat its keyboard back and says that nothing was arranged", async () => {
  // Arrange: as in row 660's refusal test; the editor refuses the split the Wiki needs.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] })
  const chat = harness.addSeparateEditorPart()
  harness.leavePaneFocusUnreportedBesideChat()
  harness.focusMutableDraft('login-form.tsx', 1)
  chat.focusTab()
  harness.failNextCommand('vscode.setEditorLayout')
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
  const messagesBefore = harness.informationMessages.length
  try {
    // Act
    const refusal = await harness.reader
      .arrangeRepository(new AbortController().signal, undefined, focus)
      .then(
        () => undefined,
        (error: unknown) => String(error),
      )

    // Assert: the split's refusal is reported, the chat has its keyboard again, and the one sentence says that nothing was arranged.
    assert.deepEqual(
      {
        refusal,
        chatHasKeyboard: chat.focused(),
        messages: harness.informationMessages
          .slice(messagesBefore)
          .map((message) => message.message),
      },
      {
        refusal: 'Error: Native layout command failed',
        chatHasKeyboard: true,
        messages: [
          'Codebook could not finish arranging its panes and gave the keyboard back to the chat. Beside the chat the editor reads and changes the layout of its groups only while one of them has the focus, so a file or pane of the main editor had the keyboard for a moment. The editor does not tell Codebook whether you were typing in that chat or in the terminal or another view: if you were typing elsewhere, click there to type again.',
        ],
      },
    )
  } finally {
    for (const receipt of receipts) receipt.dispose()
    await harness.close()
  }
})

// Value: protects=the keyboard of a newer Wiki entry when an older agent's cold Wiki layout beside Cursor's chat part is superseded after its measurement borrowed the main editor: the superseded layout gives nothing back, so the older entry runs no Focus Agent and tells no sentence; fails_when=the refused layout's give-back runs for every failure that is no learner's change, also a cancelled entry's, so the older entry moves the keyboard into the chat while the newer entry holds it (Cycle 0046 CR4-4); why_new=Cycle 0046 CR4-4; seam=workspaceHarness with one main group, addSeparateEditorPart and focusTab, leavePaneFocusUnreportedBesideChat, holdNextCommand('vscode.setEditorLayout'), the entry's AbortController, the reader's own focus receipts, the native commands and the information messages
test("an agent's cold Wiki layout beside Cursor's chat part that is cancelled after its measurement gives the chat nothing back and tells nothing", async () => {
  // Arrange: one main editor group with the learner's login-form.tsx and the chat holding the keyboard; the editor holds its answer to the split the Wiki needs.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] })
  const chat = harness.addSeparateEditorPart()
  harness.leavePaneFocusUnreportedBesideChat()
  harness.focusMutableDraft('login-form.tsx', 1)
  chat.focusTab()
  const split = harness.holdNextCommand('vscode.setEditorLayout')
  const entry = new AbortController()
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
  const messagesBefore = harness.informationMessages.length
  try {
    // Act: a newer navigation cancels the entry while the split waits.
    const arranging = harness.reader
      .arrangeRepository(entry.signal, undefined, focus)
      .then(
        () => 'arranged',
        (error: unknown) => String(error),
      )
    await split.started
    const commandsBefore = harness.commands.length
    entry.abort(new Error('Evidence navigation was superseded.'))
    split.release()
    const refusal = await arranging

    // Assert: the cancellation is reported, and the cancelled entry ran no focus command and told nothing.
    assert.deepEqual(
      {
        refusal,
        keyboardCommands: harness.commands
          .slice(commandsBefore)
          .filter(
            (command) =>
              command === 'composer.focusComposer' ||
              command.startsWith('workbench.action.focus'),
          ),
        messages: harness.informationMessages
          .slice(messagesBefore)
          .map((message) => message.message),
      },
      {
        refusal: 'Error: Evidence navigation was superseded.',
        keyboardCommands: [],
        messages: [],
      },
    )
  } finally {
    split.release()
    for (const receipt of receipts) receipt.dispose()
    await harness.close()
  }
})

// Value: protects=the window after the learner closed the Study workspace while an agent's cold Wiki layout beside Cursor's chat part waited after its measurement: the closed reader's layout gives nothing back, so no focus command runs after the Close; fails_when=the refused layout's give-back runs for the lifetime the Close ended, and the closed reader runs Focus Agent and tells its sentence (Cycle 0046 CR4-4); why_new=Cycle 0046 CR4-4; seam=workspaceHarness with one main group, addSeparateEditorPart and focusTab, leavePaneFocusUnreportedBesideChat, holdNextCommand('vscode.setEditorLayout'), the reader's close, the reader's own focus receipts, the native commands and the information messages
test("an agent's cold Wiki layout beside Cursor's chat part whose reader closes after its measurement runs no focus command after the Close", async () => {
  // Arrange: one main editor group with the learner's login-form.tsx and the chat holding the keyboard; the editor holds its answer to the split the Wiki needs.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] })
  const chat = harness.addSeparateEditorPart()
  harness.leavePaneFocusUnreportedBesideChat()
  harness.focusMutableDraft('login-form.tsx', 1)
  chat.focusTab()
  const split = harness.holdNextCommand('vscode.setEditorLayout')
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
  const messagesBefore = harness.informationMessages.length
  try {
    // Act: the learner closes the reader while the split waits.
    const arranging = harness.reader
      .arrangeRepository(new AbortController().signal, undefined, focus)
      .then(
        () => 'arranged',
        (error: unknown) => String(error),
      )
    await split.started
    const closing = harness.reader.close()
    const commandsAfterClose = harness.commands.length
    split.release()
    const refusal = await arranging
    await closing

    // Assert: the layout reports the Close, and the closed reader ran no Focus Agent and told nothing.
    assert.deepEqual(
      {
        refusal,
        chatCommands: harness.commands
          .slice(commandsAfterClose)
          .filter((command) => command === 'composer.focusComposer'),
        messages: harness.informationMessages
          .slice(messagesBefore)
          .map((message) => message.message),
      },
      {
        refusal:
          'Error: The study workspace was closed; repeat the action explicitly if needed.',
        chatCommands: [],
        messages: [],
      },
    )
  } finally {
    split.release()
    for (const receipt of receipts) receipt.dispose()
    await harness.close()
  }
})

// Value: protects=the learner's newer choice during an agent's cold Wiki layout beside Cursor's chat part: once the measurement focused the first group, a click into the learner's file of the second group is a learner's change, which the reader's receipt still refuses, so the Wiki takes nothing from that file; fails_when=the acceptance of Cursor's stale group name (row 660) also takes a later learner change for the measurement's own focus; why_new=Cycle 0046 row 660 (its bound); seam=workspaceHarness with addSeparateEditorPart, leavePaneFocusUnreportedBesideChat, holdNextPrimaryFocusResponse (the learner's click between the focus command's effect and its answer), focusMutableDraft and focusExistingSource (the learner's click, reported as a group activation), the reader's own focus receipts
test("a learner's click into another file while an agent's cold Wiki layout beside Cursor's chat part measures is still refused as the learner's newer focus", async () => {
  // Arrange: as above, with the learner's notes.ts in the second group; the focus command's answer is held so the learner can click in between.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({
    orientation: 0,
    groups: [{ size: 490 }, { size: 490 }],
  })
  const chat = harness.addSeparateEditorPart()
  harness.leavePaneFocusUnreportedBesideChat()
  const notes = harness.focusMutableDraft('notes.ts', 2)
  harness.focusMutableDraft('login-form.tsx', 1)
  chat.focusTab()
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
  const held = harness.holdNextPrimaryFocusResponse()
  try {
    const arranging = harness.reader
      .arrangeRepository(new AbortController().signal, undefined, focus)
      .then(
        () => undefined,
        (error: unknown) => String(error),
      )
    await held.started

    // Act: the learner clicks into notes.ts before the focus command answers, which Cursor reports as that group's activation.
    harness.focusExistingSource(notes.editor)
    held.release()
    const refusal = await arranging

    // Assert: the layout is refused with the reader's sentence, and notes.ts keeps the keyboard.
    assert.deepEqual(
      {
        refusal,
        focusedFile: harness.focusedSource()?.document.uri.toString(),
      },
      {
        refusal:
          'Error: Native focus changed during repository navigation; the newer learner focus was preserved.',
        focusedFile: notes.document.uri.toString(),
      },
    )
  } finally {
    held.release()
    for (const receipt of receipts) receipt.dispose()
    await harness.close()
  }
})

// Value: protects=VS Code's chat view keyboard after a cold Wiki layout an agent asked for (codebook_open_book): in the only editor part the measurement focuses nothing, so the arrangement's keyboard return answers that the keyboard is where the learner had it and runs no command; fails_when=arrangeRepository answers no keyboard return, or its return focuses a group or the chat; why_new=Cycle 0046 row 620; seam=workspaceHarness with focusChatInSecondarySideBar, the reader's own focus receipts, the native commands
test("a cold Wiki layout beside VS Code's chat view borrows no keyboard and its return focuses nothing", async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({
    orientation: 0,
    groups: [{ size: 490 }, { size: 490 }],
  })
  harness.focusMutableDraft('primary.txt', 1)
  harness.focusChatInSecondarySideBar()
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
  try {
    // Act
    const keyboardReturn = await harness.reader.arrangeRepository(
      new AbortController().signal,
      undefined,
      focus,
    )
    for (const receipt of receipts) receipt.dispose()
    const commandsBeforeReturn = harness.commands.length
    const returned = await keyboardReturn?.()

    // Assert
    assert.equal(returned, true)
    assert.equal(harness.keyboardInView(), true)
    assert.deepEqual(harness.commands.slice(commandsBeforeReturn), [])
    assert.equal(
      harness.commands.includes('workbench.action.focusFirstEditorGroup'),
      false,
    )
  } finally {
    for (const receipt of receipts) receipt.dispose()
    await harness.close()
  }
})

// Value: protects=the learner's choice of the chat during a cold Wiki layout from their file in front of the second group beside Cursor's chat part: a click into the chat while the layout read waits, and a click there and back into the file, are the learner's changes, which refuse the layout and leave the keyboard where the learner put it; fails_when=the measurement that borrows nothing takes a later return to the same file for no change, or gives the file the keyboard back over the chat; why_new=Cycle 0046 row 663 (rework of "cold Wiki remembers learner chat / chat roundtrip before primary native focus arrives": that boundary, the borrow's focus command, no longer exists from this origin, so the layout read is the boundary now; the tests' selection roundtrip and unchanged cases are the tests from the learner's file in the second group above, and their restoration of original.txt after a borrow cannot happen, since original.txt never loses the keyboard); seam=workspaceHarness with addSeparateEditorPart and its focus, focusMutableDraft in columns 1 and 2, holdNextCommand on the layout read, the reader's own focus receipts
for (const interaction of ['chat', 'chat roundtrip'] as const)
  test(`cold Wiki from the learner's file in the second group remembers learner ${interaction} during its only measurement`, async () => {
    // Arrange: original.txt, in front of the second group, is the active text editor; Cursor's chat part stands beside the main editor.
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
    const measured = harness.holdNextCommand('vscode.getEditorLayout')
    const opening = harness.reader.arrangeRepository(
      new AbortController().signal,
      undefined,
      focus,
    )
    const outcome = assert.rejects(opening, /focus changed/)
    try {
      await measured.started
      // Act
      chat.focus()
      if (interaction === 'chat roundtrip') original.focus()
      measured.release()
      await outcome

      // Assert: the keyboard is where the learner put it, and no focus command ran.
      assert.deepEqual(
        {
          chatHasKeyboard: chat.focused(),
          focusedFile: harness.focusedSource()?.document.uri.toString(),
          focusCommand: harness.commands.includes(
            'workbench.action.focusFirstEditorGroup',
          ),
          layoutApplied: harness.commands.includes('vscode.setEditorLayout'),
        },
        {
          chatHasKeyboard: interaction === 'chat',
          focusedFile:
            interaction === 'chat'
              ? undefined
              : original.document.uri.toString(),
          focusCommand: false,
          layoutApplied: false,
        },
      )
      assert.equal(primary.document.getText(), 'Original learner draft.\n')
      assert.equal(original.document.getText(), 'Original learner draft.\n')
      assert.deepEqual(chat.layout(), {
        orientation: 1,
        groups: [{ size: 743 }],
      })
    } finally {
      measured.release()
      await opening.catch(() => undefined)
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
    // Arrange: identical webview types share one native group, so a later tab roundtrip cannot be inferred from the final type alone. For the phases of the focus command's response the learner's notes in a second group are the active editor, so the preparation focuses the first group before it allocates; at the caller's admission that group is the only and active one, which is not focused at all (row 612).
    const harness = await workspaceHarness(false),
      focusesFirstGroup = phase !== 'caller admission'
    harness.useNativeLayout({
      orientation: 0,
      groups: focusesFirstGroup ? [{}, {}] : [{}],
    })
    const other = harness.openWiki(1),
      original = harness.openWiki(1)
    if (focusesFirstGroup) harness.focusMutableDraft('learner-notes.txt', 2)
    const reader = harness.createReader(),
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
      assert.equal(harness.groups.length, focusesFirstGroup ? 2 : 1)
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

// Value: protects=reader tests of a close of a whole group that holds a webview pane: the fake editor disposes that pane's panel as both editors do when its tab closes, so onDidDispose, counts().panels and panelColumn answer as the hosts would; fails_when=the fake tabGroups.close disposes the panels only for its tab overload, so a panel whose tab left with its group stays among the harness's panels and never tells its onDidDispose, and an ownership or cleanup defect of a group close goes unseen; why_new=Cycle 0046 second /ship CodeRabbit review CR5-5; seam=the fake editor's createWebviewPanel, its tabGroups.close with a group, the panel's onDidDispose, counts() and panelColumn
test('the fake editor disposes the panel of a webview tab when a whole group that holds it is closed, as both editors do: its onDidDispose fires and the harness holds one panel less', async () => {
  // Arrange: the learner's file is in the first group; a webview panel stands alone in a second group.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    harness.focusMutableDraft('actions.ts', 1)
    const pane = harness.editor.window.createWebviewPanel(
      'markdown.preview',
      'Preview',
      { viewColumn: 2, preserveFocus: true },
    )
    let disposals = 0
    pane.onDidDispose(() => {
      disposals++
    })
    const panelsBefore = harness.counts().panels
    const paneGroup = harness.groups.find((group) => group.viewColumn === 2)
    assert.ok(paneGroup)

    // Act
    const closed = await harness.editor.window.tabGroups.close(paneGroup, true)

    // Assert
    assert.deepEqual(
      {
        closed,
        disposals,
        panelsBefore,
        panelsAfter: harness.counts().panels,
        paneColumn: harness.panelColumn('markdown.preview'),
        columns: harness.groups.map((group) => group.viewColumn),
      },
      {
        closed: true,
        disposals: 1,
        panelsBefore: 1,
        panelsAfter: 0,
        paneColumn: undefined,
        columns: [1],
      },
    )
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

// Value: protects=a finished reader test leaving nothing behind in its fake Cursor when it ended while the chat input still owed the keyboard of a Focus Agent the editor answered early: the owed change is among the fake editor's pending timers, and the chat does not take the keyboard after the harness's close; fails_when=the timer that gives the chat input that keyboard is a raw setTimeout outside the fake editor's pending timers, so pendingEditorTimerCount misses it and it changes the fake editor's keyboard after the test ended; why_new=Cycle 0046 second /ship OCR review OCR4-1; seam=the fake editor's pending timers, addSeparateEditorPart, focusAgentLater, focusMutableDraft, Cursor's Focus Agent command and the chat's keyboard
test("the fake Cursor counts the chat input's late keyboard after Focus Agent among its pending timers, and a closed harness drops it: the chat does not take the keyboard after the harness's close", async () => {
  // Arrange: Cursor's Agent chat is a tab of another editor part; Focus Agent answers before the chat input has the keyboard, which the chat takes at the next turn of the event loop when no further command comes; the learner's file has the keyboard.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.useHostAppName('Cursor')
  const chat = harness.addSeparateEditorPart()
  harness.focusAgentLater(2)
  harness.focusMutableDraft('actions.ts', 1)

  // Act: Focus Agent answers, and the harness closes while the chat input still owes the keyboard; longer than that turn then passes.
  await harness.editor.commands.executeCommand('composer.focusComposer')
  const owedAfterCommand = harness.pendingEditorTimerCount()
  await harness.close()
  const owedAfterClose = harness.pendingEditorTimerCount()
  await new Promise((resolve) => setTimeout(resolve, 30))

  // Assert
  assert.deepEqual(
    {
      owedAfterCommand,
      owedAfterClose,
      chatHasKeyboard: chat.focused(),
    },
    {
      owedAfterCommand: 1,
      owedAfterClose: 0,
      chatHasKeyboard: false,
    },
  )
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

// Value: protects=reader tests beside Cursor's Agent chat part: Cursor makes the editor part that took the focus last its active part among the parts of one window (Cursor 3.23.12 workbench.desktop.main.js 17501:84373, 17501:88693), so after a click from the chat into the terminal or a view the chat part is still the active part: a layout read answers for it (17501:90249), no text editor is active, and the active group's focus command focuses the chat's group (17388:4895); fails_when=the fake answers layout reads for the main editor once the terminal or a view has the keyboard, so a reader that reads the chat part's layout natively passes in the tests (row 638's pin of a press in a Study view did); why_new=Cycle 0046 row 647 (harness fidelity); seam=the fake editor's addSeparateEditorPart and its focusTab, focusTerminalInBottomPanel, focusView, vscode.getEditorLayout, the active text editor and workbench.action.focusActiveEditorGroup
test("the fake Cursor keeps its chat part the active editor part after a click into the terminal or a view: layout reads answer for the chat part, no text editor is active, and the active group's focus gives the chat input the keyboard", async () => {
  // Arrange: actions.ts is in the first group; the learner typed in Cursor's chat tab, then clicked into the terminal.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  const chat = harness.addSeparateEditorPart()
  try {
    harness.focusMutableDraft('actions.ts', 1)
    chat.focusTab()
    harness.focusTerminalInBottomPanel()
    const afterTerminal = {
      layoutRead: await harness.editor.commands.executeCommand(
        'vscode.getEditorLayout',
      ),
      activeTextEditor: harness.editor.window.activeTextEditor,
      chatHasKeyboard: chat.focused(),
    }
    harness.focusView()
    const afterView = {
      layoutRead: await harness.editor.commands.executeCommand(
        'vscode.getEditorLayout',
      ),
      activeTextEditor: harness.editor.window.activeTextEditor,
      chatHasKeyboard: chat.focused(),
    }

    // Act
    await harness.editor.commands.executeCommand(
      'workbench.action.focusActiveEditorGroup',
    )

    // Assert: both clicks leave the chat part the active part, and the active group's focus gives the chat input the keyboard.
    assert.deepEqual(
      {
        afterTerminal,
        afterView,
        chatHasKeyboardAfterGroupFocus: chat.focused(),
      },
      {
        afterTerminal: {
          layoutRead: { orientation: 1, groups: [{ size: 743 }] },
          activeTextEditor: undefined,
          chatHasKeyboard: false,
        },
        afterView: {
          layoutRead: { orientation: 1, groups: [{ size: 743 }] },
          activeTextEditor: undefined,
          chatHasKeyboard: false,
        },
        chatHasKeyboardAfterGroupFocus: true,
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=reader tests beside VS Code's chat editor tab in a floating window: VS Code counts the part of the focused window as the active one (1.140.0 workbench.desktop.main.js 993:31655), so a click into the main window's terminal makes the main editor the active part again and a layout read answers for it; fails_when=row 647's model of Cursor's chat part is applied to VS Code's floating window too, so the main editor's layout could not be read after a click into the terminal; why_new=Cycle 0046 row 647 (the bound of the harness change); seam=the fake editor's addSeparateEditorPart('vscode-floating-chat') and its focusTab, focusTerminalInBottomPanel and vscode.getEditorLayout
test('the fake VS Code makes its main editor the active part again after a click from the floating chat window into the terminal: layout reads answer for the main editor', async () => {
  // Arrange: actions.ts is in the first group; the learner typed in VS Code's chat editor tab in a floating window, then clicked into the main window's terminal.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  const chat = harness.addSeparateEditorPart('vscode-floating-chat')
  try {
    harness.focusMutableDraft('actions.ts', 1)
    chat.focusTab()
    harness.focusTerminalInBottomPanel()

    // Act
    const layoutRead = await harness.editor.commands.executeCommand(
      'vscode.getEditorLayout',
    )

    // Assert: the main editor's two groups answer.
    assert.deepEqual(layoutRead, {
      orientation: 0,
      groups: [{ size: 1 }, { size: 1 }],
    })
  } finally {
    await harness.close()
  }
})

// Value: protects=reader tests meeting the side bars' focus commands as both editors run them: the command shows the bar and focuses its active view container (VS Code 1.140.0 workbench.desktop.main.js 1113:33119 and 859:17926; Cursor 3.23.12 18340:23013 and 17376:10969), so the terminal or a view that had the keyboard has it no longer; fails_when=the fake gives the bar the keyboard and leaves it in the terminal or the view too, so a reader that shows a bar and gives nothing back passes in the tests as if the learner's terminal kept its keyboard; why_new=Cycle 0046 row 633 (harness fidelity); seam=the fake editor's modelSideBars, sideBars, focusTerminalInBottomPanel, focusView, keyboardInView and keyboardOnBody
test("the fake editor's side bar focus commands take the keyboard from the terminal and from a view that had it and give it to the bar, as both editors do", async () => {
  // Arrange: both side bars are hidden; the learner types in the terminal of the bottom panel.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.modelSideBars({ primary: false, auxiliary: false })
  try {
    harness.focusMutableDraft('actions.ts', 1)
    harness.focusTerminalInBottomPanel()
    const keyboardPlace = () => ({
      viewHasKeyboard: harness.keyboardInView(),
      keyboardOnBody: harness.keyboardOnBody(),
      bars: harness.sideBars(),
    })

    // Act: the primary bar's focus command beside the terminal, then the secondary bar's beside the Call Stack view the learner clicked into.
    await harness.editor.commands.executeCommand(
      'workbench.action.focusSideBar',
    )
    const afterPrimary = keyboardPlace()
    harness.focusView()
    await harness.editor.commands.executeCommand(
      'workbench.action.focusAuxiliaryBar',
    )
    const afterSecondary = keyboardPlace()

    // Assert: each bar is shown and has the keyboard; neither the terminal nor the view keeps it.
    assert.deepEqual(
      { afterPrimary, afterSecondary },
      {
        afterPrimary: {
          viewHasKeyboard: false,
          keyboardOnBody: false,
          bars: { primary: true, auxiliary: false, hasKeyboard: true },
        },
        afterSecondary: {
          viewHasKeyboard: false,
          keyboardOnBody: false,
          bars: { primary: true, auxiliary: true, hasKeyboard: true },
        },
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=reader tests beside VS Code's chat view in front of the secondary side bar: that bar's focus command focuses its active view container, the chat, so the chat keeps the keyboard; fails_when=the fake takes the chat view's keyboard for the bar's own command, so a reader that shows the secondary bar would be blamed for a keyboard the editor gives back to the chat itself; why_new=Cycle 0046 row 633 (harness fidelity, the counterpart of the test above); seam=the fake editor's modelSideBars, sideBars, focusChatInSecondarySideBar and keyboardInView
test("the fake editor's secondary side bar focus command keeps the keyboard in VS Code's chat view in front of that bar", async () => {
  // Arrange: the learner types in VS Code's chat view in front of the secondary side bar.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.modelSideBars({ primary: true, auxiliary: true })
  try {
    harness.focusMutableDraft('actions.ts', 1)
    harness.focusChatInSecondarySideBar()

    // Act
    await harness.editor.commands.executeCommand(
      'workbench.action.focusAuxiliaryBar',
    )

    // Assert: the chat view still has the keyboard, and no other bar took it.
    assert.deepEqual(
      { viewHasKeyboard: harness.keyboardInView(), bars: harness.sideBars() },
      {
        viewHasKeyboard: true,
        bars: { primary: true, auxiliary: true, hasKeyboard: false },
      },
    )
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

// Value: protects=the Repository Wiki opened right after a completed Study Close beside Cursor's chat, whose cold arrangement gives the first group's text editor the keyboard to measure the main grid; fails_when=the editor's own late return to the recreated Wiki's group (only the active group changes, to the Wiki's column, while the borrowed text editor stays the active text editor and no learner input arrives) is refused by that measurement as a learner's change; why_new=Cycle 0046 finding 606, the row 444 follow-up (C24 capture 223 met this transition after the reader's own source acquisition, which adoptWikiGroupReturn accepts; the same transition can land while the arrangement measures the grid); seam=the workspace harness's addSeparateEditorPart, closeDisposedPanelTabsLater, removeEmptiedGroupsLater, holdNextCommand and reportGroupWithRetainedEditor
test("opening the Repository Wiki right after Study Close beside Cursor's chat arranges without a refusal when the editor returns to the Wiki's group beside the unchanged text editor while the main grid is measured", async () => {
  // Arrange: Cursor's chat is an editor part of its own beside the learner's file (column 1) and the Repository Wiki (column 2); the editor closes a disposed pane's tab and its emptied group a moment after the disposal.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  harness.closeDisposedPanelTabsLater()
  harness.removeEmptiedGroupsLater()
  const chat = harness.addSeparateEditorPart(),
    draft = harness.focusMutableDraft('actions.ts', 1),
    wiki = harness.openWiki(2)
  let firstMeasurement: ReturnType<typeof harness.holdNextCommand> | undefined,
    borrowedMeasurement: ReturnType<typeof harness.holdNextCommand> | undefined,
    arranging: Promise<unknown> | undefined,
    releaseRetainedEditor = (): void => {}
  try {
    // The Study workspace is opened over the Wiki and closed with the keyboard in its Study pane; longer than the fake editor takes to remove an emptied group.
    await harness.reader.open()
    await harness.reader.close()
    await new Promise((resolve) => setTimeout(resolve, 120))
    // Close left the Wiki tab selected in the active group and gave that group the keyboard last.
    assert.equal(
      harness.editor.window.tabGroups.activeTabGroup.activeTab,
      wiki.nativeTab,
    )
    assert.equal(
      harness.commands.at(-1),
      'workbench.action.focusActiveEditorGroup',
    )
    const commandsBeforeArrangement = harness.commands.length
    firstMeasurement = harness.holdNextCommand('vscode.getEditorLayout')
    // The Wiki command's arrangement of a closed Study reader; the reader's own focus receipt accepts this return since adoptWikiGroupReturn, so only the arrangement's guards are under test.
    arranging = harness.reader.arrangeRepository(
      new AbortController().signal,
      undefined,
      { begin(): void {} },
    )
    const result = arranging.then(
      () => ({ arranged: true, error: '' }),
      (error: unknown) => ({ arranged: false, error: String(error) }),
    )
    await firstMeasurement.started
    borrowedMeasurement = harness.holdNextCommand('vscode.getEditorLayout')
    firstMeasurement.release()
    await borrowedMeasurement.started
    // The measurement gave the first group's text editor the keyboard and waits for the layout it reads there.
    assert.equal(harness.editor.window.tabGroups.activeTabGroup.viewColumn, 1)
    assert.equal(
      harness.focusedSource()?.document.uri.toString(),
      draft.document.uri.toString(),
    )

    // Act: the editor names the Wiki's group as the active group while the active text editor stays the borrowed one; no learner input arrives.
    releaseRetainedEditor = harness.reportGroupWithRetainedEditor(2)
    borrowedMeasurement.release()

    // Assert
    assert.deepEqual(await result, { arranged: true, error: '' })
    assert.equal(
      harness.commands
        .slice(commandsBeforeArrangement)
        .includes('vscode.setEditorLayout'),
      false,
    )
    assert.deepEqual(
      harness.groups.map((group) => group.viewColumn),
      [1, 2, 3],
    )
    assert.equal(harness.groups[0]!.tabs.includes(draft.tab), true)
    assert.equal(harness.groups[1]!.tabs.includes(wiki.nativeTab), true)
    assert.equal(draft.document.getText(), 'Original learner draft.\n')
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] })
  } finally {
    releaseRetainedEditor()
    firstMeasurement?.release()
    borrowedMeasurement?.release()
    await arranging?.catch(() => undefined)
    await harness.close()
  }
})

// Value: protects=an agent's selection of the Study workspace right after a completed Study Close beside Cursor's chat, whose Open gives the first group's text editor the keyboard to measure the main grid before any pane exists; fails_when=the editor's own late return to the recreated Wiki's group beside that borrowed text editor refuses the selection with "The presentation was not confirmed." (its cause: "Native pane, group or focus changed while presentation waited; the learner arrangement was preserved."); why_new=Cycle 0046 finding 606 (the select variant has the same root: the borrow receipt of readMainEditorGrid, reached from StudyWorkspace.open); seam=the workspace harness's addSeparateEditorPart, closeDisposedPanelTabsLater, removeEmptiedGroupsLater, holdNextCommand and reportGroupWithRetainedEditor
test("selecting the Study workspace right after Study Close beside Cursor's chat opens it when the editor returns to the Wiki's group beside the unchanged text editor while the main grid is measured", async () => {
  // Arrange: Cursor's chat is an editor part of its own beside the learner's file (column 1) and the Repository Wiki (column 2); the editor closes a disposed pane's tab and its emptied group a moment after the disposal.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  harness.closeDisposedPanelTabsLater()
  harness.removeEmptiedGroupsLater()
  const chat = harness.addSeparateEditorPart(),
    draft = harness.focusMutableDraft('actions.ts', 1),
    wiki = harness.openWiki(2)
  let firstMeasurement: ReturnType<typeof harness.holdNextCommand> | undefined,
    borrowedMeasurement: ReturnType<typeof harness.holdNextCommand> | undefined,
    selecting: Promise<unknown> | undefined,
    releaseRetainedEditor = (): void => {}
  try {
    // The Study workspace is opened over the Wiki and closed with the keyboard in its Study pane; longer than the fake editor takes to remove an emptied group.
    await harness.reader.open()
    await harness.reader.close()
    await new Promise((resolve) => setTimeout(resolve, 120))
    assert.equal(
      harness.editor.window.tabGroups.activeTabGroup.activeTab,
      wiki.nativeTab,
    )
    const state = harness.reader.presentationState()
    firstMeasurement = harness.holdNextCommand('vscode.getEditorLayout')
    const selection = harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })
    selecting = selection
    const result = selection.then(
      (presentation) => ({
        state: presentation.state,
        mode: presentation.mode,
        layoutConfirmed: presentation.layoutConfirmed,
        error: '',
      }),
      (error: unknown) => ({
        state: 'refused',
        mode: '',
        layoutConfirmed: false,
        error: String(error),
      }),
    )
    await firstMeasurement.started
    borrowedMeasurement = harness.holdNextCommand('vscode.getEditorLayout')
    firstMeasurement.release()
    await borrowedMeasurement.started
    // Before any pane exists, the Open's measurement gave the first group's text editor the keyboard and waits for the layout it reads there.
    assert.equal(harness.editor.window.tabGroups.activeTabGroup.viewColumn, 1)
    assert.equal(
      harness.focusedSource()?.document.uri.toString(),
      draft.document.uri.toString(),
    )

    // Act: the editor names the Wiki's group as the active group while the active text editor stays the borrowed one; no learner input arrives.
    releaseRetainedEditor = harness.reportGroupWithRetainedEditor(2)
    borrowedMeasurement.release()

    // Assert
    assert.deepEqual(await result, {
      state: 'open',
      mode: 'study-workspace',
      layoutConfirmed: true,
      error: '',
    })
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
    assert.equal(harness.panelColumn('codebook.studyContext'), 3)
    assert.deepEqual([...harness.reader.inspect().view!.errors], [])
    assert.equal(harness.groups[0]!.tabs.includes(draft.tab), true)
    assert.equal(harness.groups[1]!.tabs.includes(wiki.nativeTab), true)
    assert.equal(draft.document.getText(), 'Original learner draft.\n')
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] })
  } finally {
    releaseRetainedEditor()
    firstMeasurement?.release()
    borrowedMeasurement?.release()
    await selecting?.catch(() => undefined)
    await harness.close()
  }
})

for (const input of [
  'keyboard moved into the Wiki',
  'a source selection after the Wiki-group return',
  'a source edit after the Wiki-group return',
  'another editor before the Wiki-group return',
  "the chat's group beside the unchanged text editor",
  "another webview selected in the Wiki's group beside the unchanged text editor",
] as const)
  // Value: protects=newer learner input while the Repository Wiki's cold arrangement measures the main grid right after Study Close beside Cursor's chat; fails_when=the accepted return to the Wiki's group also forgives the learner's click into the Wiki, a selection or an edit in the borrowed text editor, another editor, the chat's group or a group that selects another webview than the Wiki; why_new=Cycle 0046 finding 606 (the bound of the accepted return, as row 444 bounds the reader's); seam=the workspace harness's addSeparateEditorPart, closeDisposedPanelTabsLater, removeEmptiedGroupsLater, holdNextCommand, reportGroupWithRetainedEditor, focusExistingWebviewTab, focusMutableDraft and the fake editor's createWebviewPanel
  test(`${input} still refuses the Repository Wiki's arrangement right after Study Close beside Cursor's chat`, async () => {
    // Arrange: the Study workspace is opened over the Wiki in column 2 and closed with the keyboard in its Study pane; the Wiki command's arrangement has given the first group's text editor the keyboard and waits for the layout it reads there.
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
    harness.closeDisposedPanelTabsLater()
    harness.removeEmptiedGroupsLater()
    const chat = harness.addSeparateEditorPart(),
      draft = harness.focusMutableDraft('actions.ts', 1),
      wiki = harness.openWiki(2)
    let firstMeasurement:
        ReturnType<typeof harness.holdNextCommand> | undefined,
      borrowedMeasurement:
        ReturnType<typeof harness.holdNextCommand> | undefined,
      arranging: Promise<unknown> | undefined,
      releaseRetainedEditor = (): void => {}
    try {
      await harness.reader.open()
      await harness.reader.close()
      await new Promise((resolve) => setTimeout(resolve, 120))
      const commandsBeforeArrangement = harness.commands.length
      firstMeasurement = harness.holdNextCommand('vscode.getEditorLayout')
      arranging = harness.reader.arrangeRepository(
        new AbortController().signal,
        undefined,
        { begin(): void {} },
      )
      const result = arranging.then(
        () => ({ arranged: true, error: '' }),
        (error: unknown) => ({ arranged: false, error: String(error) }),
      )
      await firstMeasurement.started
      borrowedMeasurement = harness.holdNextCommand('vscode.getEditorLayout')
      firstMeasurement.release()
      await borrowedMeasurement.started

      // Act
      if (input === 'keyboard moved into the Wiki')
        harness.focusExistingWebviewTab(wiki.nativeTab)
      if (input === 'another editor before the Wiki-group return')
        harness.focusMutableDraft('notes.ts', 1)
      if (input.endsWith('after the Wiki-group return'))
        releaseRetainedEditor = harness.reportGroupWithRetainedEditor(2)
      if (input === "the chat's group beside the unchanged text editor")
        releaseRetainedEditor = harness.reportGroupWithRetainedEditor(3)
      if (
        input ===
        "another webview selected in the Wiki's group beside the unchanged text editor"
      ) {
        harness.editor.window.createWebviewPanel(
          'markdown.preview',
          'Preview README.md',
          { viewColumn: 2, preserveFocus: true },
        )
        releaseRetainedEditor = harness.reportGroupWithRetainedEditor(2)
      }
      if (input === 'a source selection after the Wiki-group return')
        draft.editor.selections = draft.editor.selections.map((selection) => ({
          anchor: selection.anchor.with(6, 0),
          active: selection.active.with(6, 0),
        }))
      if (input === 'a source edit after the Wiki-group return')
        draft.replaceContent('My newer unsaved text.\n')
      borrowedMeasurement.release()

      // Assert
      assert.deepEqual(await result, {
        arranged: false,
        error:
          'Error: Native pane, group or focus changed while presentation waited; the learner arrangement was preserved.',
      })
      assert.equal(
        harness.commands
          .slice(commandsBeforeArrangement)
          .includes('vscode.setEditorLayout'),
        false,
      )
      assert.equal(harness.groups[0]!.tabs.includes(draft.tab), true)
      assert.equal(harness.groups[1]!.tabs.includes(wiki.nativeTab), true)
      assert.equal(
        draft.document.getText(),
        input === 'a source edit after the Wiki-group return'
          ? 'My newer unsaved text.\n'
          : 'Original learner draft.\n',
      )
      assert.deepEqual(chat.layout(), {
        orientation: 1,
        groups: [{ size: 743 }],
      })
    } finally {
      releaseRetainedEditor()
      firstMeasurement?.release()
      borrowedMeasurement?.release()
      await arranging?.catch(() => undefined)
      await harness.close()
    }
  })

// Value: protects=the arrangement's guard against a Repository Wiki pane an earlier extension host left behind; fails_when=the accepted return to the Wiki's group also takes the selection of such a leftover pane, which no Wiki reader of this host owns (repositoryWikiOpen() is false), as the editor's own return; why_new=Cycle 0046 finding 606 (only this host's live Wiki pane bounds the accepted return); seam=the workspace harness's closeTabByHand, leaveDeadCodebookPane, addSeparateEditorPart, holdNextCommand and reportGroupWithRetainedEditor
test("a leftover Repository Wiki pane of an earlier extension host selected beside the unchanged text editor still refuses the Wiki's arrangement beside Cursor's chat", async () => {
  // Arrange: an earlier extension host left a Repository Wiki pane in column 2, and no Wiki reader of this host owns a pane; Cursor's chat is an editor part of its own and the leftover pane's group is the active one.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  harness.closeTabByHand(harness.groups[1]!.tabs[0]!)
  const chat = harness.addSeparateEditorPart(),
    draft = harness.focusMutableDraft('actions.ts', 1),
    leftoverWiki = harness.leaveDeadCodebookPane('codebook.repositoryWiki', 2, {
      focused: true,
    })
  let firstMeasurement: ReturnType<typeof harness.holdNextCommand> | undefined,
    borrowedMeasurement: ReturnType<typeof harness.holdNextCommand> | undefined,
    arranging: Promise<unknown> | undefined,
    releaseRetainedEditor = (): void => {}
  try {
    const commandsBeforeArrangement = harness.commands.length
    firstMeasurement = harness.holdNextCommand('vscode.getEditorLayout')
    arranging = harness.reader.arrangeRepository(
      new AbortController().signal,
      undefined,
      { begin(): void {} },
    )
    const result = arranging.then(
      () => ({ arranged: true, error: '' }),
      (error: unknown) => ({ arranged: false, error: String(error) }),
    )
    await firstMeasurement.started
    borrowedMeasurement = harness.holdNextCommand('vscode.getEditorLayout')
    firstMeasurement.release()
    await borrowedMeasurement.started
    // The measurement gave the first group's text editor the keyboard and waits for the layout it reads there.
    assert.equal(
      harness.focusedSource()?.document.uri.toString(),
      draft.document.uri.toString(),
    )

    // Act: the editor names the leftover pane's group as the active group while the active text editor stays the borrowed one.
    releaseRetainedEditor = harness.reportGroupWithRetainedEditor(2)
    borrowedMeasurement.release()

    // Assert
    assert.deepEqual(await result, {
      arranged: false,
      error:
        'Error: Native pane, group or focus changed while presentation waited; the learner arrangement was preserved.',
    })
    assert.equal(
      harness.commands
        .slice(commandsBeforeArrangement)
        .includes('vscode.setEditorLayout'),
      false,
    )
    assert.equal(harness.groups[1]!.tabs.includes(leftoverWiki), true)
    assert.equal(draft.document.getText(), 'Original learner draft.\n')
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] })
  } finally {
    releaseRetainedEditor()
    firstMeasurement?.release()
    borrowedMeasurement?.release()
    await arranging?.catch(() => undefined)
    await harness.close()
  }
})

// Value: protects=reader tests that know a tab by its label, as the chat's give-back does for a remembered tab (Cycle 0046 row 648): every tab of the fake editor has the label its editor input names it with, a string in both editors (VS Code 1.140.0 `workbench.desktop.main.js` 725:2597, Cursor 3.23.12 17269:26483 `label:t.getName()`); fails_when=the fake's tabs have no label, so any two of its text tabs compare equal by label and the give-back's check of an empty group's missing front tab reads its input, which throws: reading every group's front tab there instead of the shifted column's alone turned three Cursor verdicts of the chat's keyboard return (row 664); why_new=Cycle 0046 row 664; seam=the workspace harness's tab model: focusMutableDraft, addOpaqueTab, the reader's panes and the chat part
test("every tab of the fake editor has the label its editor names it with, as both editors' tab models give one to every tab", async () => {
  // Arrange: the learner's file and Cursor's settings page in the first group beside the harness's own file, its Wiki in the second, Cursor's chat part beside the main editor.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  const chat = harness.addSeparateEditorPart()
  harness.addOpaqueTab('Cursor Settings', 1)
  harness.focusMutableDraft('login-form.tsx', 1)
  try {
    // Act
    await harness.reader.open()
    const labels = harness.editor.window.tabGroups.all.map((group) => ({
      column: group.viewColumn,
      labels: group.tabs.map((tab) => tab.label),
    }))

    // Assert
    assert.deepEqual(labels, [
      {
        column: 1,
        labels: [
          'Cursor Settings',
          'article-source.ts',
          'login-form.tsx',
          'codebook · Application',
        ],
      },
      {
        column: 2,
        labels: ['codebook · Repository Wiki', 'Captured-overview.mts'],
      },
      { column: 3, labels: ['codebook · Study'] },
      { column: 4, labels: [chat.tab.label] },
    ])
    assert.equal(chat.tab.label, 'New Agent')
  } finally {
    await harness.close()
  }
})

// Value: protects=reader tests whose product reads the front tab of every group, as the chat's give-back may: in the fake editor, as in both editors, reading a group's front tab, its label and its input is a read only; fails_when=a read of the fake's tab model changes a group, a tab, the active group or the keyboard, or runs a command, so a product that reads more of it gets other verdicts than one that reads less (row 664: the three Cursor verdicts an eager read changed came from a label the fake's tabs lacked, not from a read); why_new=Cycle 0046 row 664; seam=the workspace harness's tab model read through the editor API the product uses
test("reading every group's front tab, its label and its input in the fake editor changes no group, no tab, no focus and runs no command", async () => {
  // Arrange: an open Study workspace beside Cursor's chat, which has the keyboard, in the model that replaces every tab group object with each tab change.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  const chat = harness.addSeparateEditorPart()
  harness.replaceGroupObjectsOnTabChanges()
  harness.focusMutableDraft('login-form.tsx', 1)
  try {
    await harness.reader.open()
    chat.focusTab()
    const tabGroups = harness.editor.window.tabGroups
    const modelOf = () => ({
      groups: [...tabGroups.all],
      tabs: tabGroups.all.map((group) => [...group.tabs]),
      activeGroup: tabGroups.activeTabGroup,
      activeTextEditor: harness.editor.window.activeTextEditor,
      chatHasKeyboard: chat.focused(),
      commands: harness.commands.length,
    })
    const before = modelOf()

    // Act
    const read = tabGroups.all.map((group) => ({
      label: group.activeTab?.label,
      hasInput: group.activeTab?.input !== undefined,
    }))

    // Assert
    const after = modelOf()
    assert.equal(read.length, 4)
    assert.equal(
      after.groups.every((group, index) => group === before.groups[index]),
      true,
    )
    assert.equal(
      after.tabs.every((tabs, index) =>
        tabs.every((tab, position) => tab === before.tabs[index]![position]),
      ),
      true,
    )
    assert.equal(after.activeGroup, before.activeGroup)
    assert.equal(after.activeTextEditor, before.activeTextEditor)
    assert.equal(after.chatHasKeyboard, true)
    assert.equal(after.commands, before.commands)
  } finally {
    await harness.close()
  }
})

// Value: protects=reader tests beside Cursor's chat part meeting the stale group name as Cursor keeps it: after the first editor group took the keyboard the editor goes on naming the chat's group through a tab notification that is a tab operation (the learner's typing made the file dirty: Cursor 3.23.12 `workbench.desktop.main.js` 17269:29781 sends it as a tab operation, which leaves the named group as it is, `extensionHostProcess.js` 131:34068), and a whole tab-model rebuild (17269:31013, 131:33177), as for a group's lock, names the active group again; fails_when=the fake clears the stale name at any tab notification, and only while a listener is subscribed, so a product told of a tab change reads the first group as the named one where Cursor still names the chat's; why_new=Cycle 0046 row 673; seam=the workspace harness's Cursor model: addSeparateEditorPart, leavePaneFocusUnreportedBesideChat, the first-group focus command, reportActiveTextTab and the group lock command
test("the fake editor goes on naming Cursor's chat group after the first group took the keyboard when the learner's file there turns dirty, and names the first group after a whole tab-model rebuild", async () => {
  // Arrange: the learner's file in the first group, Cursor's chat part with the keyboard; the first-group focus command leaves the chat's group named.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  const chat = harness.addSeparateEditorPart()
  const draft = harness.focusMutableDraft('login-form.tsx', 1)
  harness.leavePaneFocusUnreportedBesideChat()
  chat.focusTab()
  const tabGroups = harness.editor.window.tabGroups
  const changedTabs: string[] = []
  const subscription = tabGroups.onDidChangeTabs((event) => {
    changedTabs.push(...event.changed.map((tab) => tab.label))
  })
  try {
    await harness.editor.commands.executeCommand(
      'workbench.action.focusFirstEditorGroup',
    )
    const afterFocus = {
      namedColumn: tabGroups.activeTabGroup.viewColumn,
      activeTextEditor:
        harness.editor.window.activeTextEditor?.document.uri.toString(),
    }

    // Act
    harness.reportActiveTextTab({ isPreview: false, isDirty: true })
    const namedAfterTabOperation = tabGroups.activeTabGroup.viewColumn
    await harness.editor.commands.executeCommand(
      'workbench.action.lockEditorGroup',
    )
    const namedAfterRebuild = tabGroups.activeTabGroup.viewColumn

    // Assert
    assert.deepEqual(afterFocus, {
      namedColumn: 3,
      activeTextEditor: draft.document.uri.toString(),
    })
    assert.deepEqual(changedTabs, ['login-form.tsx'])
    assert.equal(namedAfterTabOperation, 3)
    assert.equal(namedAfterRebuild, 1)
  } finally {
    subscription.dispose()
    await harness.close()
  }
})

// Value: protects=reader tests beside Cursor's chat part meeting Cursor's group names as the native probe of row 690 read them step by step (private c59-cu-690probe, Cursor 3.23.12 beside the Agent chat part, groups G1 login-form.tsx and G2 auth.ts), with its Focus Agent read again on C61 (c61-702-probe step 2, row 702): with the chat input focused the editor names the main group it named last (G2), not the chat's; the first-group focus gives G1's file the keyboard and leaves that earlier name (stale); a lock of the focused group names the locked group, as row 673's rebuild does, and the unlock keeps it; Focus Agent from G1's file keeps G1 named and leaves no active text editor (C61; c59's step 4 had read the file still reported, which C61 does not show); the first-group focus then gives G1's file the keyboard again, as Cycle 0045 obs15 P1 saw in the same state the extension API reads (G1 named, no active text editor, the chat input focused; c59's step 5 read no move after its step 4, which is not observed on C61); a new group of the main editor is named; fails_when=the fake follows another rule at one of these steps: the lock keeps the stale name as row 674's new-tab rebuild does, Focus Agent keeps the file reported, or a new group leaves the old name; why_new=Cycle 0046 rows 690 and 702; seam=the workspace harness's Cursor model: addSeparateEditorPart, leavePaneFocusUnreportedBesideChat, chat.focus (step 0), the first-group focus, lock, unlock, Focus Agent and newGroupAbove commands (step 6 used splitEditorDown; the reader's own new group is newGroupAbove's)
test("the fake editor names Cursor's groups beside its chat part as the native probe read them through a borrow, a lock, Focus Agent, a first-group focus and a new group", async () => {
  // Arrange: G1 shows login-form.tsx and G2 auth.ts, which the learner focused last; then the learner clicked into Cursor's chat input.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  const chat = harness.addSeparateEditorPart()
  harness.focusMutableDraft('login-form.tsx', 1)
  harness.focusMutableDraft('auth.ts', 2)
  harness.leavePaneFocusUnreportedBesideChat()
  chat.focus()
  const tabGroups = harness.editor.window.tabGroups
  /** Reads what the probe read at each step: the named group's column, the active text editor's file and whether the chat input has the keyboard. */
  const read = () => ({
    named: tabGroups.activeTabGroup.viewColumn,
    activeTextEditor: harness.editor.window.activeTextEditor?.document.uri.path
      .split('/')
      .at(-1),
    chatHasKeyboard: chat.focused(),
  })
  const steps: Record<string, ReturnType<typeof read>> = { chat: read() }
  try {
    // Act: the probe's steps 1 to 6.
    await harness.editor.commands.executeCommand(
      'workbench.action.focusFirstEditorGroup',
    )
    steps.borrow = read()
    await harness.editor.commands.executeCommand(
      'workbench.action.lockEditorGroup',
    )
    steps.lock = read()
    await harness.editor.commands.executeCommand(
      'workbench.action.unlockEditorGroup',
    )
    steps.unlock = read()
    await harness.editor.commands.executeCommand('composer.focusComposer')
    steps.focusAgent = read()
    await harness.editor.commands.executeCommand(
      'workbench.action.focusFirstEditorGroup',
    )
    steps.borrowAgain = read()
    await harness.editor.commands.executeCommand(
      'workbench.action.newGroupAbove',
    )
    steps.newGroup = read()

    // Assert
    assert.deepEqual(steps, {
      chat: { named: 2, activeTextEditor: undefined, chatHasKeyboard: true },
      borrow: {
        named: 2,
        activeTextEditor: 'login-form.tsx',
        chatHasKeyboard: false,
      },
      lock: {
        named: 1,
        activeTextEditor: 'login-form.tsx',
        chatHasKeyboard: false,
      },
      unlock: {
        named: 1,
        activeTextEditor: 'login-form.tsx',
        chatHasKeyboard: false,
      },
      focusAgent: {
        named: 1,
        activeTextEditor: undefined,
        chatHasKeyboard: true,
      },
      borrowAgain: {
        named: 1,
        activeTextEditor: 'login-form.tsx',
        chatHasKeyboard: false,
      },
      newGroup: {
        named: 1,
        activeTextEditor: undefined,
        chatHasKeyboard: false,
      },
    })
    assert.equal(tabGroups.activeTabGroup.tabs.length, 0)
  } finally {
    await harness.close()
  }
})

// Value: protects=reader tests beside Cursor's chat part meeting what Cursor 3.23.12 answered on C61 after Focus Agent and after a tab close (private c61-702-probe, groups 1 login-form.tsx, 2 auth.ts behind next.config.js, 3 the chat part): after a click into login-form.tsx the file is the active text editor in column 1, group 1 is named and a layout read answers the main editor's rows; Focus Agent from that file leaves no active text editor, keeps group 1 named (a stale name) and makes layout reads answer the chat part's grid; a click into the chat input and Focus Agent from the chat rename no group; a tab of group 2 closed while the chat input has the keyboard makes Cursor name the chat part's group; fails_when=the fake answers another way at one of these steps: Focus Agent keeps the file reported or the main editor's layout, a click into the chat or Focus Agent renames a group, or the close's rebuild names a main group; why_new=Cycle 0046 row 702; seam=the workspace harness's Cursor model: addSeparateEditorPart, leavePaneFocusUnreportedBesideChat, reportSeparatePartLayout (the probe's chat-part grid), focusMutableDraft (the click into a file), chat.focus (the click into the chat input), composer.focusComposer, vscode.getEditorLayout and tabGroups.close
test("the fake editor answers Focus Agent from a file and from the chat and a tab close beside Cursor's chat part as Cursor did on C61", async () => {
  // Arrange: group 1 shows login-form.tsx, group 2 next.config.js in front of auth.ts; the learner clicked into login-form.tsx last.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({
    orientation: 1,
    groups: [{ size: 328 }, { size: 329 }],
  })
  const chat = harness.addSeparateEditorPart()
  harness.reportSeparatePartLayout({ orientation: 1, groups: [{ size: 963 }] })
  harness.focusMutableDraft('auth.ts', 2)
  const nextConfig = harness.focusMutableDraft('next.config.js', 2)
  harness.focusMutableDraft('login-form.tsx', 1)
  harness.leavePaneFocusUnreportedBesideChat()
  const tabGroups = harness.editor.window.tabGroups
  /** Reads what the probe read at each step: the named group's column, the active text editor's file, whether the chat input has the keyboard and the layout a read answers. */
  const read = async () => ({
    named: tabGroups.activeTabGroup.viewColumn,
    activeTextEditor: harness.editor.window.activeTextEditor?.document.uri.path
      .split('/')
      .at(-1),
    chatHasKeyboard: chat.focused(),
    layout: await harness.editor.commands.executeCommand(
      'vscode.getEditorLayout',
    ),
  })
  const steps: Record<string, Awaited<ReturnType<typeof read>>> = {
    file: await read(),
  }
  try {
    // Act: the probe's steps 2, 4, 5 and 6.
    await harness.editor.commands.executeCommand('composer.focusComposer')
    steps.focusAgentFromFile = await read()
    chat.focus()
    steps.chatClick = await read()
    await harness.editor.commands.executeCommand('composer.focusComposer')
    steps.focusAgentFromChat = await read()
    await tabGroups.close([nextConfig.tab], true)
    steps.tabClosed = await read()

    // Assert
    const chatPartGrid = { orientation: 1, groups: [{ size: 963 }] }
    assert.deepEqual(steps, {
      file: {
        named: 1,
        activeTextEditor: 'login-form.tsx',
        chatHasKeyboard: false,
        layout: { orientation: 1, groups: [{ size: 328 }, { size: 329 }] },
      },
      focusAgentFromFile: {
        named: 1,
        activeTextEditor: undefined,
        chatHasKeyboard: true,
        layout: chatPartGrid,
      },
      chatClick: {
        named: 1,
        activeTextEditor: undefined,
        chatHasKeyboard: true,
        layout: chatPartGrid,
      },
      focusAgentFromChat: {
        named: 1,
        activeTextEditor: undefined,
        chatHasKeyboard: true,
        layout: chatPartGrid,
      },
      tabClosed: {
        named: 3,
        activeTextEditor: undefined,
        chatHasKeyboard: true,
        layout: chatPartGrid,
      },
    })
  } finally {
    await harness.close()
  }
})

// Value: protects=reader tests in Cursor's model that give a learner's file the keyboard again after Cursor replaced every tab group object (a lock, a tab change): the learner's click names the group that holds the file now, the object the editor lists in tabGroups.all, as Cursor 3.23.12's group event does (131:33431 makes a new object for every group, and activeTabGroup is one of them); fails_when=focusMutableDraft's focus names the group object the file was opened in, which the rebuild retired, so activeTabGroup is an object tabGroups.all no longer lists and a reader that finds the named group by identity among the groups finds none; why_new=Cycle 0046 row 703 (the rows 686 to 701 fixer's finding); seam=the workspace harness's Cursor model (replaceGroupObjectsOnTabChanges), focusMutableDraft and its focus, and the group lock command, which rebuilds every group
test("a learner's file given the keyboard again after Cursor replaced every tab group object names the group object the editor lists now", async () => {
  // Arrange: a.ts in group 1 and b.ts in group 2, which has the keyboard; a lock of group 2 makes Cursor replace every group object.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  harness.replaceGroupObjectsOnTabChanges()
  const draft = harness.focusMutableDraft('a.ts', 1)
  harness.focusMutableDraft('b.ts', 2)
  await harness.editor.commands.executeCommand(
    'workbench.action.lockEditorGroup',
  )
  const tabGroups = harness.editor.window.tabGroups
  try {
    // Act: the learner clicks into a.ts again.
    draft.focus()

    // Assert
    assert.deepEqual(
      {
        namedIsListed: tabGroups.all.includes(tabGroups.activeTabGroup),
        named: tabGroups.activeTabGroup.viewColumn,
        namedFront: tabGroups.activeTabGroup.activeTab?.label,
        activeTextEditor:
          harness.editor.window.activeTextEditor?.document.uri.path
            .split('/')
            .at(-1),
      },
      {
        namedIsListed: true,
        named: 1,
        namedFront: 'a.ts',
        activeTextEditor: 'a.ts',
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=reader tests beside Cursor's chat part meeting the group name Cursor gives after a tab opened in the main editor without the keyboard while Focus Agent left its chat input the keyboard: the rebuild names the group Cursor's editor groups service holds active, the chat part's, also when the extension host named a main group (C60 c60-cu-7d2: the reader's copy shown at 149 ms with preserveFocus moved the name from group 1 to the chat part's group 3 at 153 ms); a tab opened with the keyboard keeps the stale name as row 674 has it; fails_when=the fake keeps naming the main group after that rebuild, so a reader test passes where Cursor refused the agent's second citation open (row 696); why_new=Cycle 0046 row 696; seam=the workspace harness's Cursor model: addSeparateEditorPart, leavePaneFocusUnreportedBesideChat, Focus Agent and showTextDocument with preserveFocus
test("the fake editor names Cursor's chat part's group after a tab opened without the keyboard in the main editor while Focus Agent left the chat input the keyboard", async () => {
  // Arrange: G1 shows login-form.tsx and G2 the learner's notes.md, which had the keyboard last; then Focus Agent gave the chat input the keyboard.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  const chat = harness.addSeparateEditorPart()
  harness.focusMutableDraft('login-form.tsx', 1)
  const notes = harness.focusMutableDraft('notes.md', 2)
  harness.leavePaneFocusUnreportedBesideChat()
  await harness.editor.commands.executeCommand('composer.focusComposer')
  const tabGroups = harness.editor.window.tabGroups
  const namedBefore = tabGroups.activeTabGroup.viewColumn
  try {
    // Act: a tab of notes.md opens in front of the first group without the keyboard.
    await harness.editor.window.showTextDocument(notes.document, {
      viewColumn: 1,
      preserveFocus: true,
    })

    // Assert
    assert.deepEqual(
      {
        namedBefore,
        namedAfter: tabGroups.activeTabGroup.viewColumn,
        chatHasKeyboard: chat.focused(),
        activeTextEditor: harness.editor.window.activeTextEditor,
      },
      {
        namedBefore: 2,
        namedAfter: 3,
        chatHasKeyboard: true,
        activeTextEditor: undefined,
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=reader tests that hold a tab group object across a whole tab-model event meeting each editor as it is: VS Code 1.140.0 keeps the API object of every group that is still there and updates it (`extensionHostProcess.js` 173:41428 `let u=l.get(c.groupId);if(u)return u.acceptModelUpdate(c)`, the object cached at 173:38735), while Cursor 3.23.12 makes a new object for every group (131:33431 `const d=new rIe(c,…)`); fails_when=the VS Code model replaces its group objects at such an event, so a test passes on identities VS Code keeps, or the Cursor model keeps them; why_new=Cycle 0046 row 669 (evidence: VS Code keeps the objects, so the row's premise does not hold; this test holds the model to it); seam=the workspace harness's group lock command, which both editors answer with a whole new tab model, in the model that keeps group objects and in the one that replaces them
for (const host of ['VS Code', 'Cursor'] as const)
  test(`the fake editor of ${host} ${host === 'VS Code' ? 'keeps' : 'replaces'} every tab group object at a whole tab-model event, as ${host} does`, async () => {
    // Arrange
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
    if (host === 'Cursor') harness.replaceGroupObjectsOnTabChanges()
    harness.focusMutableDraft('login-form.tsx', 1)
    const tabGroups = harness.editor.window.tabGroups
    const before = [...tabGroups.all]
    try {
      // Act
      await harness.editor.commands.executeCommand(
        'workbench.action.lockEditorGroup',
      )

      // Assert
      assert.deepEqual(
        tabGroups.all.map((group, index) => group === before[index]),
        host === 'VS Code' ? [true, true] : [false, false],
      )
    } finally {
      await harness.close()
    }
  })

// Value: protects=the Study's and the Wiki's arrangement beside VS Code's floating window of text editors: while a text editor of a floating window with two groups has the keyboard, the layout read answers that window's grid, so the learner's file in its first group, column 2, is no proof that the main editor answered (row 663's proof read it as one: two measured groups, and column 2 is in front of one of them); the measurement borrows the main editor's first group and measures the main editor's one group; fails_when=StudyWorkspace.readMainEditorGrid takes any measured column's text editor for the main editor's while another part holds text editors, measures the floating window's two groups as the main editor's columns 1 and 2, and the arrangement puts its panes into the floating window's group; why_new=Cycle 0046 row 689; seam=useNativeLayout with one main group, addFloatingEditorWindow (VS Code's floating window of two groups) and its focus, the first-group focus command, readerSeams' measureMainEditorGrid and the native commands
test("a layout read while a text editor of VS Code's floating window with two groups has the keyboard borrows the main editor's first group and measures the main editor's one group", async () => {
  // Arrange: the main editor shows login-form.tsx; the learner works in notes.ts, in the first group of a floating window of two groups (columns 2 and 3).
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.focusMutableDraft('login-form.tsx', 1)
  const floating = harness.addFloatingEditorWindow(['notes.ts', 'readme.md'])
  floating.focus(0)
  const keyboardBefore = harness
    .focusedSource()
    ?.document.uri.path.split('/')
    .at(-1)
  const commandsBefore = harness.commands.length
  try {
    // Act
    const measured = await readerSeams(harness).measureMainEditorGrid()

    // Assert: the main editor's one group was measured after the borrow, and the floating window's notes.ts got the keyboard back through its group's focus (row 708).
    assert.deepEqual(
      {
        keyboardBefore,
        measured,
        focusCommands: harness.commands
          .slice(commandsBefore)
          .filter((command) =>
            /^workbench\.action\.focus\w+EditorGroup$/.test(command),
          ),
        keyboardAfter: harness
          .focusedSource()
          ?.document.uri.path.split('/')
          .at(-1),
      },
      {
        keyboardBefore: 'notes.ts',
        measured: [1],
        focusCommands: [
          'workbench.action.focusFirstEditorGroup',
          'workbench.action.focusSecondEditorGroup',
        ],
        keyboardAfter: 'notes.ts',
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's keyboard in VS Code's floating window of text editors when a layout read borrows the main editor's first group (row 689: no text editor of that window proves the main editor): VS Code's numbered focus command of the floating group's column raises that window and focuses that group (1.140.0 `workbench.desktop.main.js` 987:4284), so the read gives the borrowed keyboard back to the floating window's text editor that had it, and the floating window is the focused one again; fails_when=the read gives nothing back to an editor beyond the measured columns, so the learner who typed in the floating window finds the keyboard in the main editor's first group with nothing told; why_new=Cycle 0046 row 708; seam=useNativeLayout with one main group, addFloatingEditorWindow (two groups) and its focus of the second group, readerSeams' measureMainEditorGrid, the native commands, focusedSource and a layout read after the measurement
test("a layout read that borrows the main editor's first group gives the keyboard back to the text editor of VS Code's floating window that had it", async () => {
  // Arrange: the main editor shows login-form.tsx; the learner works in readme.md, in the second group of a floating window of two groups (columns 2 and 3).
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.focusMutableDraft('login-form.tsx', 1)
  const floating = harness.addFloatingEditorWindow(['notes.ts', 'readme.md'])
  floating.focus(1)
  const commandsBefore = harness.commands.length
  try {
    // Act
    const measured = await readerSeams(harness).measureMainEditorGrid()
    const layoutAfter = await harness.editor.commands.executeCommand(
      'vscode.getEditorLayout',
    )

    // Assert: the borrow measured the main editor; the third group's focus gave readme.md the keyboard back, and a layout read answers the floating window again.
    assert.deepEqual(
      {
        measured,
        focusCommands: harness.commands
          .slice(commandsBefore)
          .filter((command) =>
            /^workbench\.action\.focus\w+EditorGroup$/.test(command),
          ),
        keyboardAfter: harness
          .focusedSource()
          ?.document.uri.path.split('/')
          .at(-1),
        activeTabGroup:
          harness.editor.window.tabGroups.activeTabGroup.viewColumn,
        layoutAfter,
      },
      {
        measured: [1],
        focusCommands: [
          'workbench.action.focusFirstEditorGroup',
          'workbench.action.focusThirdEditorGroup',
        ],
        keyboardAfter: 'readme.md',
        activeTabGroup: 3,
        layoutAfter: { orientation: 0, groups: [{ size: 1 }, { size: 1 }] },
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's keyboard in a diff editor of VS Code's floating window when a layout read borrows the main editor's first group: both editors report a diff's text editors with no view column (row 709), and the diff's group, beyond the measured main editor, is placed by the one group that shows the diff in front, so the read gives the keyboard back through that group's numbered focus (row 708's path), the diff stays in front with the keyboard and the floating window is the focused one again; fails_when=a diff's side is placed only among the measured columns, so no give-back reaches the floating window's diff and the keyboard stays in the main editor's first group with nothing told; why_new=Cycle 0046 row 720 (the fixer's proposal after rows 708 and 709); seam=useNativeLayout with one main group, addFloatingEditorWindow (two groups), focusDiffEditor in the floating window's second group, readerSeams' measureMainEditorGrid, the native commands, focusedSource and a layout read after the measurement
test("a layout read that borrows the main editor's first group gives the keyboard back to the learner's diff editor in VS Code's floating window through its group's focus", async () => {
  // Arrange: the main editor shows login-form.tsx; the learner works in the diff of auth.ts in front of the second group of a floating window of two groups (columns 2 and 3).
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.focusMutableDraft('login-form.tsx', 1)
  harness.addFloatingEditorWindow(['notes.ts', 'readme.md'])
  harness.focusDiffEditor('auth.ts', 3)
  const commandsBefore = harness.commands.length
  try {
    // Act
    const measured = await readerSeams(harness).measureMainEditorGrid()
    const layoutAfter = await harness.editor.commands.executeCommand(
      'vscode.getEditorLayout',
    )

    // Assert: the borrow measured the main editor; the third group's focus gave the diff the keyboard back, the diff is still in front, and a layout read answers the floating window again.
    assert.deepEqual(
      {
        measured,
        focusCommands: harness.commands
          .slice(commandsBefore)
          .filter((command) =>
            /^workbench\.action\.focus\w+EditorGroup$/.test(command),
          ),
        keyboardAfter: harness
          .focusedSource()
          ?.document.uri.path.split('/')
          .at(-1),
        thirdGroupFront: harness.groups.find((group) => group.viewColumn === 3)
          ?.activeTab?.label,
        layoutAfter,
      },
      {
        measured: [1],
        focusCommands: [
          'workbench.action.focusFirstEditorGroup',
          'workbench.action.focusThirdEditorGroup',
        ],
        keyboardAfter: 'auth.ts',
        thirdGroupFront: 'auth.ts (Working Tree)',
        layoutAfter: { orientation: 0, groups: [{ size: 1 }, { size: 1 }] },
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the presentation state's confirmation beside VS Code's floating window of text editors: a passive layout read while that window's text editor has the keyboard answers the floating window's grid, and the reader does not take it for the main editor's, so it reads the scope as unknown; fails_when=StudyWorkspace.hasMainEditorFocus takes the text editor of any column within the read's count for the main editor's focus and readPassivePresentationLayout answers the floating window's two groups as the main editor's layout; why_new=Cycle 0046 row 689 (the passive reads' half); seam=useNativeLayout with one main group, addFloatingEditorWindow and its focus, readerSeams' readPassiveLayout
test("a passive layout read while a text editor of VS Code's floating window with two groups has the keyboard reads no main editor's layout", async () => {
  // Arrange: as above; the learner works in notes.ts in the floating window's first group.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.focusMutableDraft('login-form.tsx', 1)
  const floating = harness.addFloatingEditorWindow(['notes.ts', 'readme.md'])
  floating.focus(0)
  try {
    // Act
    const layout = await readerSeams(harness).readPassiveLayout()

    // Assert
    assert.equal(layout, undefined)
  } finally {
    await harness.close()
  }
})

// Value: protects=the presentation state's confirmation beside Cursor's chat part when the main editor has more groups than the Study's three (a Live composition made from the learner's three groups: four main groups, the chat part's group the fifth): while the learner's file in the second group has the keyboard, the passive layout read answers the main editor's four groups, and the reader takes them for the main editor's layout, so a resize the learner makes is still measured; fails_when=the read's check before it asks row 689's other-part rule of the Study's three columns, which counts the main editor's own fourth group, with its file, as another part's editors, so the read answers nothing and the confirmation is never measured again; why_new=Cycle 0046 row 716 (the open-code-review delegate's finding F2 of the C61 delta, a regression of row 689's 4a93f090); seam=useNativeLayout with four main groups, addSeparateEditorPart (Cursor's chat part), leavePaneFocusUnreportedBesideChat, focusMutableDraft in each main group and readerSeams' readPassiveLayout
test("a passive layout read beside Cursor's chat part while the learner's file in the second of four main groups has the keyboard reads the main editor's four groups", async () => {
  // Arrange: four main groups with a learner's file each and Cursor's chat part as the fifth group; auth.ts in the second group has the keyboard.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({
    orientation: 0,
    groups: [{ size: 245 }, { size: 245 }, { size: 245 }, { size: 245 }],
  })
  harness.addSeparateEditorPart()
  harness.leavePaneFocusUnreportedBesideChat()
  harness.focusMutableDraft('login-form.tsx', 1)
  harness.focusMutableDraft('notes.ts', 3)
  harness.focusMutableDraft('readme.md', 4)
  harness.focusMutableDraft('auth.ts', 2)
  try {
    // Act
    const layout = await readerSeams(harness).readPassiveLayout()

    // Assert
    assert.deepEqual(layout, {
      orientation: 0,
      groups: [{ size: 245 }, { size: 245 }, { size: 245 }, { size: 245 }],
    })
  } finally {
    await harness.close()
  }
})

// Value: protects=reader tests of a learner's diff editor meeting what both editors report for it (C61 c61-688-diffprobe, VS Code 1.140.0 and Cursor 3.23.12, a diff focused in column 2): the active text editor is the diff's modified side with no view column, the visible text editors list both of the diff's sides with no view column beside a plain text editor's column, and the diff's group is the active tab group; fails_when=the fake gives a diff's text editors their group's column, so a reader test proves or gives back by a column neither editor reports (row 688's fix passed in the fake and not natively: c61-cu-688 borrowed the first group and could not give the keyboard back); why_new=Cycle 0046 row 709; seam=the workspace harness's focusDiffEditor, activeTextEditor, visibleTextEditors and tabGroups
test('the fake editor reports a learner diff editor’s text editors without a view column, as both editors do', async () => {
  // Arrange: login-form.tsx in the first group; the learner's diff of auth.ts is opened in front of the second group and has the keyboard.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  harness.focusMutableDraft('login-form.tsx', 1)
  try {
    // Act
    harness.focusDiffEditor('auth.ts', 2)

    // Assert
    const window = harness.editor.window
    assert.deepEqual(
      {
        active: {
          file: window.activeTextEditor?.document.uri.path.split('/').at(-1),
          scheme: window.activeTextEditor?.document.uri.scheme,
          viewColumn: window.activeTextEditor?.viewColumn,
        },
        visible: window.visibleTextEditors.map((editor) => ({
          file: editor.document.uri.path.split('/').at(-1),
          scheme: editor.document.uri.scheme,
          viewColumn: editor.viewColumn,
        })),
        activeTabGroup: window.tabGroups.activeTabGroup.viewColumn,
      },
      {
        active: { file: 'auth.ts', scheme: 'file', viewColumn: undefined },
        visible: [
          { file: 'login-form.tsx', scheme: 'file', viewColumn: 1 },
          { file: 'auth.ts', scheme: 'file', viewColumn: undefined },
          { file: 'auth.ts', scheme: 'git', viewColumn: undefined },
        ],
        activeTabGroup: 2,
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a learner's diff editor beside Cursor's chat part: the diff of auth.ts in front of the second group has the keyboard, and its modified side is the active text editor, reported with no view column as both editors do (row 709), which proves the main editor the active part as the learner's file does (row 663), so a layout read borrows nothing and shows nothing; fails_when=the proof asks for a plain text tab in front of the editor's column, or for the editor's own view column, which a diff's side does not have, so the read borrows the first group and cannot give the keyboard back (C61 c61-cu-688); why_new=Cycle 0046 rows 688 and 709; seam=the workspace harness's Cursor model (addSeparateEditorPart, leavePaneFocusUnreportedBesideChat), focusDiffEditor, readerSeams' measureMainEditorGrid, textDocumentShows and the native commands
test("a layout read beside Cursor's chat part while a learner's diff editor in front of the second group has the keyboard borrows nothing and leaves the diff in front", async () => {
  // Arrange: login-form.tsx in the first group; the learner's diff of auth.ts in front of the second group has the keyboard.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  harness.addSeparateEditorPart()
  harness.leavePaneFocusUnreportedBesideChat()
  harness.focusMutableDraft('login-form.tsx', 1)
  harness.focusDiffEditor('auth.ts', 2)
  const commandsBefore = harness.commands.length
  try {
    // Act
    const measured = await readerSeams(harness).measureMainEditorGrid()

    // Assert
    assert.deepEqual(
      {
        measured,
        focusCommands: harness.commands
          .slice(commandsBefore)
          .filter((command) =>
            /^workbench\.action\.focus\w+EditorGroup$/.test(command),
          ),
        shows: harness.textDocumentShows(),
        secondGroupFront: harness.groups.find((group) => group.viewColumn === 2)
          ?.activeTab?.label,
        keyboard: harness.focusedSource()?.document.uri.path.split('/').at(-1),
      },
      {
        measured: [1, 2],
        focusCommands: [],
        shows: [],
        secondGroupFront: 'auth.ts (Working Tree)',
        keyboard: 'auth.ts',
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a learner's diff editor when a layout read has to borrow the main editor's first group (VS Code with a floating window of text editors beside the main editor, where no text editor of a measured column beyond the first proves the main editor, row 689): the borrow gives the keyboard back to the diff through its group's focus, the diff's side placed in its diff's group since both editors report it with no view column (row 709), so the diff stays in front of its group with the keyboard; fails_when=the give-back shows auth.ts with showTextDocument, which opens a plain text tab of it in front of the learner's diff, or asks for the side's own view column and gives nothing back; why_new=Cycle 0046 rows 688 and 709; seam=useNativeLayout with two main groups, focusDiffEditor, addFloatingEditorWindow (not focused), readerSeams' measureMainEditorGrid, textDocumentShows and the native commands
test("a layout read that borrows the first group while a learner's diff editor in front of the second group has the keyboard gives the keyboard back to the diff through its group's focus", async () => {
  // Arrange: VS Code's floating window shows notes.ts; in the main editor the learner's diff of auth.ts in front of the second group has the keyboard.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  harness.focusMutableDraft('login-form.tsx', 1)
  harness.addFloatingEditorWindow(['notes.ts'])
  harness.focusDiffEditor('auth.ts', 2)
  const commandsBefore = harness.commands.length
  try {
    // Act
    const measured = await readerSeams(harness).measureMainEditorGrid()

    // Assert
    assert.deepEqual(
      {
        measured,
        focusCommands: harness.commands
          .slice(commandsBefore)
          .filter((command) =>
            /^workbench\.action\.focus\w+EditorGroup$/.test(command),
          ),
        shows: harness.textDocumentShows(),
        secondGroupFront: harness.groups.find((group) => group.viewColumn === 2)
          ?.activeTab?.label,
        keyboard: harness.focusedSource()?.document.uri.path.split('/').at(-1),
      },
      {
        measured: [1, 2],
        focusCommands: [
          'workbench.action.focusFirstEditorGroup',
          'workbench.action.focusSecondEditorGroup',
        ],
        shows: [],
        secondGroupFront: 'auth.ts (Working Tree)',
        keyboard: 'auth.ts',
      },
    )
  } finally {
    await harness.close()
  }
})
