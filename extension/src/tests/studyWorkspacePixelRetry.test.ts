import assert from 'node:assert/strict'
import { test } from 'node:test'

import { workspaceHarness } from './studyWorkspaceHarness'

// Value: protects=Cursor's separate chat editor part when the learner chooses it while a mismatching measured main-layout reply waits; fails_when=the pixel retry checks only the old layout's group count and sends the main Study layout to the newly focused chat part; why_new=Cycle 0046 row 366; seam=a test-local command wrapper holds the already measured layout reply after the first arrangement command, with the existing constrained-grid and separate-part models
test('a Study pixel retry leaves Cursor’s chat groups and sizes unchanged when the learner focused that part before the measured main-layout reply arrived', async (context) => {
  // Arrange: an existing separate chat part; the first Open's arrangement cannot obtain the requested proportions.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.useHostAppName('Cursor')
  const chat = harness.addSeparateEditorPart()
  let releaseLayoutReply = (): void => {},
    signalLayoutMeasured = (): void => {}
  const layoutMeasured = new Promise<void>((resolve) => {
    signalLayoutMeasured = resolve
  })
  const replyReleased = new Promise<void>((resolve) => {
    releaseLayoutReply = resolve
  })
  let heldLayout: unknown,
    holdsNextLayoutRead = true,
    isSettlingArrangement = false
  const layoutsAppliedToChat: unknown[] = []
  const rememberLayout = harness.reader['rememberLayout']
  try {
    harness.constrainStudyGrid()
    // Observe entry into settlement without changing its answer; earlier placement reads retain their existing guards.
    harness.reader['rememberLayout'] = async (...argumentsOfSettlement) => {
      isSettlingArrangement = true
      try {
        return await rememberLayout.call(
          harness.reader,
          ...argumentsOfSettlement,
        )
      } finally {
        isSettlingArrangement = false
      }
    }
    const executeCommand = harness.editor.commands.executeCommand
    context.mock.method(
      harness.editor.commands,
      'executeCommand',
      async (command: string, ...argumentsOfCommand: unknown[]) => {
        // Layout commands apply to the part that holds the keyboard at this call, including the chat's independent editor grid.
        if (command === 'vscode.setEditorLayout' && chat.focused())
          layoutsAppliedToChat.push(structuredClone(argumentsOfCommand[0]))
        const answer = await executeCommand.call(
          harness.editor.commands,
          command,
          ...argumentsOfCommand,
        )
        // Keep the main part's measured answer even when another part gains focus before its reply arrives.
        if (
          command === 'vscode.getEditorLayout' &&
          holdsNextLayoutRead &&
          isSettlingArrangement
        ) {
          holdsNextLayoutRead = false
          heldLayout = answer
          signalLayoutMeasured()
          await replyReleased
        }
        return answer
      },
    )
    // A focus change can refuse the Open after its accepted native effects; the chat must stay unchanged either way.
    const opening = harness.reader.open().then(
      () => 'opened',
      (error: unknown) => `refused: ${String(error)}`,
    )
    const heldStage = await Promise.race([
      layoutMeasured.then(() => 'settlement reply held'),
      opening.then((outcome) => `Open ended before settlement: ${outcome}`),
    ])
    assert.equal(heldStage, 'settlement reply held')
    assert.equal(isSettlingArrangement, true)
    const chatGroupsBeforeReply = harness.groups
      .filter((group) => group.tabs.includes(chat.tab))
      .map((group) => ({
        column: group.viewColumn,
        tabs: group.tabs.map((tab) => tab.label),
      }))

    // Act: the learner chooses the existing chat while the measured main-layout reply waits, then the old reply arrives.
    chat.focusTab()
    releaseLayoutReply()
    await opening

    // Assert: the old main reply is measurable and mismatching, but it authorizes no pixel mutation in the chat part.
    assert.deepEqual(heldLayout, {
      orientation: 0,
      groups: [
        { size: 220, groups: [{ size: 70 }, { size: 70 }] },
        { size: 220 },
      ],
    })
    assert.deepEqual(chat.layout(), {
      orientation: 1,
      groups: [{ size: 743 }],
    })
    assert.deepEqual(layoutsAppliedToChat, [])
    assert.deepEqual(
      harness.groups
        .filter((group) => group.tabs.includes(chat.tab))
        .map((group) => ({
          column: group.viewColumn,
          tabs: group.tabs.map((tab) => tab.label),
        })),
      chatGroupsBeforeReply,
    )
  } finally {
    releaseLayoutReply()
    harness.reader['rememberLayout'] = rememberLayout
    context.mock.restoreAll()
    await harness.close()
  }
})
