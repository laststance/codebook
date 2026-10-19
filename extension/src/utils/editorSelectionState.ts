import type { TextEditor } from 'vscode'

/**
 * Captures immutable version/selection state for {@link StudyWorkspace}'s preparation and Return input guards.
 * @param editor - The exact native editor, or undefined when no text editor owns input.
 * @returns A comparable snapshot; callers retain their own source URI, group and focus policies.
 * @example const unchanged = editorSelectionState(editor) === before
 */
export function editorSelectionState(editor: TextEditor | undefined): string {
  return JSON.stringify({
    version: editor?.document.version,
    selections: editor?.selections,
  })
}
