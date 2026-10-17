import { LEARNER_SELECTION_KINDS } from '../constants'

/**
 * Says whether a selection change is the learner's own in the active text editor: made with the keyboard or the mouse, in the same document and column as that editor; asked by {@link RepositoryReader.retainNativeFocus} on every selection event while a navigation's focus is retained, where such a selection always retires the navigation, also when it happens to match the requested range.
 * @param change - The editor's selection change, `undefined` for another notification.
 * @param activeEditor - The active text editor, `undefined` when none is active.
 * @returns
 * - `true` for a keyboard or mouse selection in the active text editor
 * - `false` for a command's selection (the editor's own jump, an extension's), another editor's, and when either is missing
 * @example
 * isLearnersSelectionIn({ textEditor: editor, kind: 2 }, editor) // => true for the learner's click into the active editor
 * isLearnersSelectionIn({ textEditor: editor, kind: 3 }, editor) // => false for a selection a command made
 */
export function isLearnersSelectionIn(
  change:
    | {
        textEditor: {
          document: { uri: { toString(): string } }
          viewColumn?: number
        }
        kind?: number
      }
    | undefined,
  activeEditor:
    | { document: { uri: { toString(): string } }; viewColumn?: number }
    | undefined,
): boolean {
  // Only a selection made by the learner's own hand in the editor that is active now counts.
  return (
    change !== undefined &&
    activeEditor !== undefined &&
    change.textEditor.document.uri.toString() ===
      activeEditor.document.uri.toString() &&
    change.textEditor.viewColumn === activeEditor.viewColumn &&
    LEARNER_SELECTION_KINDS.has(change.kind)
  )
}
