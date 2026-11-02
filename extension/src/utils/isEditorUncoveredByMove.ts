/**
 * Says whether the active text editor is the learner's file that Codebook's own move of the Application pane uncovered in the group the pane left; asked by the move watch of {@link StudyWorkspace} at every reported change of the active text editor until the group's uncovered file is accepted.
 *
 * Why it exists: the editor reports the file in front of the pane's old group as the active text editor once the pane has left, and Cursor 3.27.22 can have reported another editor, or none, while the pane covered it; that report is a consequence of the move, not a choice of the learner. Only the one file that stood in front of the group when the pane left counts, so another file of that group that the learner picks, a file the learner opens, or a file elsewhere still wins.
 *
 * Caller contract: this answers only for the first acceptance. Once the watch accepted the group's uncovered file it keeps that file with its document version and dirty state itself, accepts a later report of the same unedited file, and refuses another file of the group or an edit of the file; it does not ask this function again for that group.
 *
 * @param input - What the watch noted: the editor's file and the file in front of its group now; whether the group's front was the relocated pane at arming and the file in front of it once the pane had left (`undefined` while none is noted); whether no text editor was active at arming (read once at arming, not as the watch later updates its baseline); and whether the group had a learner file in front at arming.
 * @returns `true` when the active editor's file is the group's front file now and either the group's front was the pane and that file is the one in front of it since the pane left, or the group's front was not the pane, no text editor was active at arming and the group had no learner file in front; `false` otherwise.
 * @example
 * isEditorUncoveredByMove({ editorFile: 'file:///a/cards.tsx', frontNow: 'file:///a/cards.tsx', wasCoveredByPane: true, uncoveredFile: 'file:///a/cards.tsx', wasNoEditorAtArming: false, hadLearnerFrontAtArming: false }) // => true
 */
export function isEditorUncoveredByMove(input: {
  editorFile: string
  frontNow: string | undefined
  wasCoveredByPane: boolean
  uncoveredFile: string | undefined
  wasNoEditorAtArming: boolean
  hadLearnerFrontAtArming: boolean
}): boolean {
  // The editor is in front of its group and is the group's front file.
  if (input.frontNow !== input.editorFile) return false
  // The pane stood in front: only the file in front of the group since the pane left was uncovered by the move, not any other file held behind it.
  if (input.wasCoveredByPane) return input.uncoveredFile === input.editorFile
  // No text editor was active and the group showed no learner file: the file in front now can only come from the move.
  return input.wasNoEditorAtArming && !input.hadLearnerFrontAtArming
}
