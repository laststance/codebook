import type { TextEditor } from 'vscode'

import { editorInputState } from './editorInputState'

/**
 * Captures which text editor has the keyboard: its document's URI, version and selections ({@link editorInputState}) and its view column; {@link StudyWorkspace.retainPresentationPlacement} records it with every presentation receipt, so a receipt that adopts the editor's own return to the Repository Wiki's group ({@link adoptWikiGroupReturn}) does so only beside the identical text editor.
 * @param editor - The active text editor, or undefined when none is active.
 * @returns A comparable signature: an edit, a selection, another document or the same document in another group gives another one.
 * @example
 * textEditorFocusState(editor) === textEditorFocusState(vscode.window.activeTextEditor) // => true while that editor keeps the keyboard unchanged
 * textEditorFocusState(sourceInColumnOne) === textEditorFocusState(sameSourceInColumnTwo) // => false
 */
export function textEditorFocusState(editor: TextEditor | undefined): string {
  return JSON.stringify({
    input: editorInputState(editor),
    viewColumn: editor?.viewColumn,
  })
}
