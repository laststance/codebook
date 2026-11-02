/**
 * Says whether the active text editor is the learner's file that Codebook's own move of the Application pane uncovered in the group the pane left; asked by the move watch of {@link StudyWorkspace} at every reported change of the active text editor.
 *
 * Why it exists: the editor reports the file in front of the pane's old group as the active text editor once the pane has left, and Cursor 3.27.22 can have reported another editor, or none, while the pane covered it; that report is a consequence of the move, not a choice of the learner. Only a file the group held behind the pane when the watch began counts, so a file the learner opens or picks from elsewhere still wins.
 *
 * @param input - What the watch noted: the editor's file and the file in front of its group now, the files the group held behind the pane at arming (`undefined` for a group whose front was no relocated pane), whether no text editor was active at arming, and whether the group had a learner file in front at arming.
 * @returns `true` when the active editor's file is the group's front file now and either the group's front was the pane with the file behind it, or no text editor was active at arming and the group had no learner file in front; `false` otherwise.
 * @example
 * isEditorUncoveredByMove({ editorFile: 'file:///a/cards.tsx', frontNow: 'file:///a/cards.tsx', heldBehindPane: ['file:///a/data.ts', 'file:///a/cards.tsx'], wasNoEditorAtArming: false, hadLearnerFrontAtArming: false }) // => true
 */
export function isEditorUncoveredByMove(input: {
  editorFile: string
  frontNow: string | undefined
  heldBehindPane: readonly string[] | undefined
  wasNoEditorAtArming: boolean
  hadLearnerFrontAtArming: boolean
}): boolean {
  // The editor is in front of its group and is the group's front file.
  if (input.frontNow !== input.editorFile) return false
  // The pane stood in front and this file was behind it: the move uncovered it, whatever the editor reported before.
  if (input.heldBehindPane?.includes(input.editorFile)) return true
  // No text editor was active and the group showed no learner file: the file in front now can only come from the move.
  return input.wasNoEditorAtArming && !input.hadLearnerFrontAtArming
}
