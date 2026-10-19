import type { TextEditor } from 'vscode'

import { editorSelectionState } from './editorSelectionState'

/**
 * Captures source identity with {@link editorSelectionState} when {@link StudyWorkspace} retains article Return input.
 * @param editor - The current native text input; undefined remains distinct from an existing source.
 * @returns An immutable signature of its URI, document version and selections, independent of editor-wrapper identity.
 * @example const unchanged = editorInputState(currentEditor) === before
 */
export function editorInputState(editor: TextEditor | undefined): string {
  return JSON.stringify({
    uri: editor?.document.uri.toString(),
    selection: editorSelectionState(editor),
  })
}
