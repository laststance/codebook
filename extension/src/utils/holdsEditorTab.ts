/**
 * Says whether an editor group holds a tab of an editor, a text editor, a diff, a webview, a custom editor, a notebook or a terminal, as opposed to a chat's tab, which Cursor gives no input (3.23.12 `workbench.desktop.main.js` 17269:27859) and VS Code a `TabInputChat` it does not type; {@link StudyWorkspace.holdsOnlyChatsBeyond} asks it of every group after the columns a layout read measured (Cycle 0046 row 689), {@link StudyWorkspace.namesAnotherEditorPartsTab} of the front tab of the group the editor names after a borrow or an arrangement beside Cursor's chat part (row 727), and {@link RepositoryReader.isOwnQuietCopyShowPlace} of the front tab of the group the editor names during the reader's own quiet copy show (row 714).
 * A part beside the main editor that holds editors can be the part a layout read answered for, VS Code's floating window of text editors, whose groups the extension API counts after the main editor's; a chat part cannot hold the keyboard in a text editor.
 * @param group - The group, with its tabs' inputs.
 * @param editorInputKinds - The host's tab input classes of editors (`vscode.TabInputText`, `vscode.TabInputWebview`, and those the host exports of `TabInputTextDiff`, `TabInputCustom`, `TabInputNotebook`, `TabInputNotebookDiff`, `TabInputTerminal`); an entry that is no class is skipped.
 * @returns
 * - `true` when a tab's input is an instance of one of those classes.
 * - `false` for a group of chat tabs or of tabs without input, and for an empty group.
 * @example
 * holdsEditorTab(floatingGroup, [vscode.TabInputText, vscode.TabInputWebview]) // => true for VS Code's floating window that shows readme.md
 * holdsEditorTab(cursorChatGroup, [vscode.TabInputText, vscode.TabInputWebview]) // => false for Cursor's Agent chat part
 */
export function holdsEditorTab(
  group: { readonly tabs: readonly { readonly input: unknown }[] },
  editorInputKinds: readonly unknown[],
): boolean {
  return group.tabs.some(({ input }) =>
    editorInputKinds.some(
      (kind) => typeof kind === 'function' && input instanceof kind,
    ),
  )
}
