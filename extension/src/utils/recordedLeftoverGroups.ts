import { focusEditorGroupCommand } from './focusEditorGroupCommand'

/** One empty group at a recorded column, with the command that gives it the keyboard; see {@link recordedLeftoverGroups}. */
export type RecordedLeftoverGroup = {
  column: number
  focusCommand: NonNullable<ReturnType<typeof focusEditorGroupCommand>>
}

/**
 * Lists the empty groups a cold Study open finds at the columns an earlier window's record names, in the order {@link StudyWorkspace} retires them; it asks before any native effect, and proves each group against the main grid only afterwards.
 * The last column comes first: removing a group renumbers only the columns after it, so every column still to retire keeps its number.
 * @param columns - The columns the record names.
 * @param groups - The editor's groups now, as `vscode.window.tabGroups.all` lists them.
 * @returns
 * - The empty groups at the recorded columns, from the last column to the first, each with its focus command
 * - An empty list when no recorded column holds an empty group, or when the editor has no command that focuses one of them (nothing is then retired)
 * @example
 * recordedLeftoverGroups([1, 3], [{ viewColumn: 1, tabs: [] }, { viewColumn: 2, tabs: [readmeTab] }, { viewColumn: 3, tabs: [] }])
 * // => [{ column: 3, focusCommand: 'workbench.action.focusThirdEditorGroup' }, { column: 1, focusCommand: 'workbench.action.focusFirstEditorGroup' }]
 * recordedLeftoverGroups([1], [{ viewColumn: 1, tabs: [readmeTab] }]) // => []
 */
export function recordedLeftoverGroups(
  columns: readonly number[],
  groups: readonly { viewColumn: number; tabs: readonly unknown[] }[],
): RecordedLeftoverGroup[] {
  const emptyColumns = groups
    .filter((group) => !group.tabs.length && columns.includes(group.viewColumn))
    .map((group) => group.viewColumn)
    .toSorted((left, right) => right - left)
  const leftovers = emptyColumns.flatMap((column) => {
    const focusCommand = focusEditorGroupCommand(column)
    return focusCommand ? [{ column, focusCommand }] : []
  })
  // A group the editor cannot focus cannot be proved, and a part of the record proves nothing.
  return leftovers.length === emptyColumns.length ? leftovers : []
}
