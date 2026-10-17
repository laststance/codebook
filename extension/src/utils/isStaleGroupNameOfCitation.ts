/**
 * Says whether the group the editor names as active is still the one it named before a citation took the keyboard in its own group, as Cursor does beside its chat part, so that this stale name stands for the citation's group (Cycle 0046 row 660).
 * Cursor's tab model reports a group's activation only for the active part's active group, and a tab that opens or comes to the front as a tab operation that keeps every group's active flag (Cursor 3.23.12 `workbench.desktop.main.js` 17269:31013, `_updateTabsModel` cases 0, 5 and 8), so after its chat part had the focus the main editor's group the citation is shown in is not named until the tab model is rebuilt. {@link RepositoryReader.openSource} asks it for its citation's focus receipt, and {@link RepositoryReader.open} of the citation it acquired.
 * @param columns - `namedBefore`, the view column of the group the editor named before the citation was shown; `namedNow`, the one it names now; `citation`, the column the citation is shown in.
 * @param citationInFront - Whether the citation is the front tab of its group and the active text editor there.
 * @returns
 * - `true` when the editor named another group than the citation's before, names it still, and the citation is in front with the keyboard.
 * - `false` when the citation's group was named before (it is named again when the citation takes it), when the name changed, and when the citation is not in front.
 * @example
 * isStaleGroupNameOfCitation({ namedBefore: 3, namedNow: 3, citation: 1 }, true) // => true beside Cursor's chat part at column 3
 * isStaleGroupNameOfCitation({ namedBefore: 2, namedNow: 1, citation: 1 }, true) // => false: the editor names the citation's group
 */
export function isStaleGroupNameOfCitation(
  columns: { namedBefore: number; namedNow: number; citation: number },
  citationInFront: boolean,
): boolean {
  // A citation's group named before has its own name to confirm: no stale name stands for it.
  if (columns.namedBefore === columns.citation) return false
  return citationInFront && columns.namedNow === columns.namedBefore
}
