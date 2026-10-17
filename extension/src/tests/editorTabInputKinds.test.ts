import assert from 'node:assert/strict'
import { test } from 'node:test'

import { editorTabInputKinds } from '../utils/editorTabInputKinds'
import { holdsEditorTab } from '../utils/holdsEditorTab'

/** A tab input class of the editor API; each is named as `vscode` exports it (`@types/vscode` 1.120.0 `index.d.ts`). */
class TabInputText {}
class TabInputWebview {}
class TabInputTextDiff {}
class TabInputCustom {}
class TabInputNotebook {}
class TabInputNotebookDiff {}
class TabInputTerminal {}
/** VS Code's chat editor input, which its extension host has but does not export as an editor's. */
class TabInputChat {}

/** The editor's extension API module as both editors export its tab input classes. */
const host = {
  TabInputText,
  TabInputWebview,
  TabInputTextDiff,
  TabInputCustom,
  TabInputNotebook,
  TabInputNotebookDiff,
  TabInputTerminal,
  TabInputChat,
}

// Value: protects=a notebook, notebook diff, custom editor, diff or terminal tab in front of a group is the learner's editor, not Cursor's chat (rows 689, 714, 727); fails_when=a class name in EDITOR_TAB_INPUT_KINDS is dropped or misspelled, so that editor's tab reads as the chat's and the chat takes the keyboard; why_new=the workspace harness exports no notebook, notebook diff or custom class, so no reader test reaches those names; seam=none; no_claim=what the reader does with the answer
test('a notebook, a notebook diff, a custom editor, a diff or a terminal in front of a group is an editor tab, never the chat’s tab', () => {
  // Arrange
  const kinds = editorTabInputKinds(host)
  const groupShowing = (input: unknown) => ({ tabs: [{ input }] })

  // Act
  const answers = {
    notebook: holdsEditorTab(groupShowing(new TabInputNotebook()), kinds),
    notebookDiff: holdsEditorTab(
      groupShowing(new TabInputNotebookDiff()),
      kinds,
    ),
    customEditor: holdsEditorTab(groupShowing(new TabInputCustom()), kinds),
    diff: holdsEditorTab(groupShowing(new TabInputTextDiff()), kinds),
    terminal: holdsEditorTab(groupShowing(new TabInputTerminal()), kinds),
    textEditor: holdsEditorTab(groupShowing(new TabInputText()), kinds),
    webview: holdsEditorTab(groupShowing(new TabInputWebview()), kinds),
    cursorChat: holdsEditorTab(groupShowing(undefined), kinds),
    vsCodeChat: holdsEditorTab(groupShowing(new TabInputChat()), kinds),
  }

  // Assert
  assert.deepEqual(answers, {
    notebook: true,
    notebookDiff: true,
    customEditor: true,
    diff: true,
    terminal: true,
    textEditor: true,
    webview: true,
    cursorChat: false,
    vsCodeChat: false,
  })
})
