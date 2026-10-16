import { focusEditorGroupCommand } from './focusEditorGroupCommand'

/** One leftover group at a recorded column, with the command that gives it the keyboard; see {@link recordedLeftoverGroups}. */
export type RecordedLeftoverGroup = {
  column: number
  focusCommand: NonNullable<ReturnType<typeof focusEditorGroupCommand>>
}

/**
 * Lists the leftover groups a cold Study open finds at the columns an earlier window's record names, in the order {@link StudyWorkspace} retires them; it asks before any native effect, and proves each group against the main grid only afterwards.
 * A leftover group holds no tab, or only tabs that earlier session left (its restored captured source, a dead Codebook pane), which the cold entry closes anyway and which leave with the group. The last column comes first: removing a group renumbers only the columns after it, so every column still to retire keeps its number.
 * @param columns - The columns the record names.
 * @param groups - The editor's groups now, as `vscode.window.tabGroups.all` lists them.
 * @param leftoverTabs - The tabs an earlier host session left behind, as the reader lists them.
 * @returns
 * - The leftover groups at the recorded columns, from the last column to the first, each with its focus command
 * - An empty list when no recorded column holds a leftover group, or when the editor has no command that focuses one of them (nothing is then retired)
 * @example
 * recordedLeftoverGroups([2, 3], [{ viewColumn: 1, tabs: [readmeTab] }, { viewColumn: 2, tabs: [restoredSourceTab] }, { viewColumn: 3, tabs: [] }], new Set([restoredSourceTab]))
 * // => [{ column: 3, focusCommand: 'workbench.action.focusThirdEditorGroup' }, { column: 2, focusCommand: 'workbench.action.focusSecondEditorGroup' }]
 * recordedLeftoverGroups([1], [{ viewColumn: 1, tabs: [readmeTab] }], new Set()) // => []
 */
export function recordedLeftoverGroups(
  columns: readonly number[],
  groups: readonly { viewColumn: number; tabs: readonly unknown[] }[],
  leftoverTabs: ReadonlySet<unknown>,
): RecordedLeftoverGroup[] {
  const leftoverColumns = groups
    .filter(
      (group) =>
        columns.includes(group.viewColumn) &&
        group.tabs.every((tab) => leftoverTabs.has(tab)),
    )
    .map((group) => group.viewColumn)
    .toSorted((left, right) => right - left)
  const leftovers = leftoverColumns.flatMap((column) => {
    const focusCommand = focusEditorGroupCommand(column)
    return focusCommand ? [{ column, focusCommand }] : []
  })
  // A group the editor cannot focus cannot be proved, and a part of the record proves nothing.
  return leftovers.length === leftoverColumns.length ? leftovers : []
}
