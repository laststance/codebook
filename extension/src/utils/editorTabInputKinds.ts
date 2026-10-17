import { EDITOR_TAB_INPUT_KINDS } from '../constants'

/**
 * Lists the host's tab input classes of editors (a text editor, a webview and those of {@link EDITOR_TAB_INPUT_KINDS} the host exports), for {@link holdsEditorTab}; called by {@link StudyWorkspace.holdsOnlyChatsBeyond} for the groups beyond a layout read's columns (Cycle 0046 row 689) and by {@link RepositoryReader.isOwnQuietCopyShowPlace} for the group the editor names during the reader's own quiet copy show (row 714).
 * A chat's tab is none of them: Cursor gives its composer tab no input (3.23.12 `workbench.desktop.main.js` 17269:27859) and VS Code a `TabInputChat` it does not type.
 * @param host - The editor's extension API module, `vscode`.
 * @returns The classes in that order; an entry the host does not export is `undefined`, which {@link holdsEditorTab} skips.
 * @example
 * editorTabInputKinds(vscode) // => [TabInputText, TabInputWebview, TabInputTextDiff, TabInputCustom, TabInputNotebook, TabInputNotebookDiff, TabInputTerminal]
 */
export function editorTabInputKinds(host: object): unknown[] {
  return ['TabInputText', 'TabInputWebview', ...EDITOR_TAB_INPUT_KINDS].map(
    (kind) => Reflect.get(host, kind),
  )
}
