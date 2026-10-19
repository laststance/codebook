import assert from 'node:assert/strict'
import { test } from 'node:test'

import { holdsEditorTab } from '../utils/holdsEditorTab'

/** A text editor's tab input, as the editor API's `TabInputText`. */
class TextInput {
  constructor(readonly uri: string) {}
}
/** A webview's tab input, as the editor API's `TabInputWebview`. */
class WebviewInput {
  constructor(readonly viewType: string) {}
}
/** VS Code's chat editor input, as its extension host's `TabInputChat`. */
class ChatInput {}

// Value: protects=the main editor's proof by a text editor beyond the first column beside VS Code's floating window of text editors: a group that shows a text editor or a webview is a group of a part with editors; fails_when=such a group is read as a chat's, so a proof by its neighbour's column measures the floating window as the main editor; why_new=Cycle 0046 row 689; seam=none
test('a group that shows a text editor or a webview holds an editor tab', () => {
  // Arrange
  const kinds = [TextInput, WebviewInput]
  const textGroup = { tabs: [{ input: new TextInput('file:///readme.md') }] }
  const webviewGroup = {
    tabs: [{ input: new WebviewInput('mainThreadWebview-markdown.preview') }],
  }

  // Act
  const answers = {
    textGroup: holdsEditorTab(textGroup, kinds),
    webviewGroup: holdsEditorTab(webviewGroup, kinds),
  }

  // Assert
  assert.deepEqual(answers, { textGroup: true, webviewGroup: true })
})

// Value: protects=row 663's proof beside Cursor's Agent chat part and VS Code's chat moved into a floating window: their groups hold a chat's tab, no editor's, so a learner's file in a main column beyond the first still proves the main editor; fails_when=a chat's tab, a tab without input or an empty group counts as an editor's, so every such layout read borrows the first group again; why_new=Cycle 0046 row 689 (its bound); seam=none
test("a group of chat tabs, of tabs without input, or without tabs holds no editor tab, and a host's missing class is skipped", () => {
  // Arrange
  const kinds = [TextInput, WebviewInput, undefined]
  const groups = {
    cursorChat: { tabs: [{ input: undefined }] },
    vsCodeChat: { tabs: [{ input: new ChatInput() }] },
    empty: { tabs: [] },
  }

  // Act
  const answers = {
    cursorChat: holdsEditorTab(groups.cursorChat, kinds),
    vsCodeChat: holdsEditorTab(groups.vsCodeChat, kinds),
    empty: holdsEditorTab(groups.empty, kinds),
  }

  // Assert
  assert.deepEqual(answers, {
    cursorChat: false,
    vsCodeChat: false,
    empty: false,
  })
})
