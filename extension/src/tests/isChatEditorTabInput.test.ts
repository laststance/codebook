import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isChatEditorTabInput } from '../utils/isChatEditorTabInput'

/** VS Code's `TabInputChat` as the extension host exports it: a class without properties. */
class TabInputChat {}
/** VS Code's `TabInputWebview`, another input kind. */
class TabInputWebview {
  constructor(readonly viewType: string) {}
}

// Value: protects=the keyboard of VS Code's chat opened as an editor tab, which an agent's Application preparation gives back only to a tab it can prove a chat; fails_when=the chat editor tab's input is not recognized, so the preparation leaves the keyboard in the new Application group; why_new=Cycle 0046 row 625; seam=none
test('a tab whose input is of the host’s TabInputChat class is VS Code’s chat editor tab', () => {
  // Arrange
  const input = new TabInputChat()
  // Act
  const isChat = isChatEditorTabInput(input, TabInputChat)
  // Assert
  assert.equal(isChat, true)
})

// Value: protects=a page that cannot be proven a chat (Settings and Cursor's composer tab have no input, a webview has its own class) from being given a keyboard row 612 withholds; fails_when=another input, no input, or a host without the class is taken for a chat; why_new=Cycle 0046 row 625; seam=none
test('no input, another input kind, and a host without TabInputChat are no chat editor tab', () => {
  // Arrange
  const cases = [
    { input: undefined, chatInputKind: TabInputChat },
    {
      input: new TabInputWebview('codebook.studyContext'),
      chatInputKind: TabInputChat,
    },
    { input: new TabInputChat(), chatInputKind: undefined },
  ]
  // Act
  const answers = cases.map(({ input, chatInputKind }) =>
    isChatEditorTabInput(input, chatInputKind),
  )
  // Assert
  assert.deepEqual(answers, [false, false, false])
})
