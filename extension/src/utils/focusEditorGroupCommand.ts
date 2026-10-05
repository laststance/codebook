/** The editor's commands that give one of its first eight editor groups the keyboard focus, by view column. */
const FOCUS_EDITOR_GROUP_COMMANDS = [
  'workbench.action.focusFirstEditorGroup',
  'workbench.action.focusSecondEditorGroup',
  'workbench.action.focusThirdEditorGroup',
  'workbench.action.focusFourthEditorGroup',
  'workbench.action.focusFifthEditorGroup',
  'workbench.action.focusSixthEditorGroup',
  'workbench.action.focusSeventhEditorGroup',
  'workbench.action.focusEighthEditorGroup',
] as const

/**
 * Names the editor command that gives the group of one view column the keyboard focus, so {@link StudyWorkspace} can hand the focus back to a group whose tab it cannot show through the editor API (a tab that is neither a text editor nor a Codebook pane, such as Cursor's Agent chat).
 * The focused group keeps the tab it shows. The editor has such a command for its first eight groups only.
 * @param viewColumn - The group's view column, counted from 1.
 * @returns
 * - The command id for the columns 1 to 8
 * - `undefined` for any other column: the editor has no command that focuses it
 * @example
 * focusEditorGroupCommand(3) // => 'workbench.action.focusThirdEditorGroup'
 * focusEditorGroupCommand(9) // => undefined
 */
export function focusEditorGroupCommand(
  viewColumn: number,
): (typeof FOCUS_EDITOR_GROUP_COMMANDS)[number] | undefined {
  return FOCUS_EDITOR_GROUP_COMMANDS[viewColumn - 1]
}
