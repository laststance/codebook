import { isDiffTabOfDocument } from './isDiffTabOfDocument'

/**
 * Names the view column of a text editor, also for a side of a diff editor, which both editors report with no view column; called by {@link StudyWorkspace} for the proof and the give-back of a layout read and by {@link RepositoryReader} for the file an agent's cold Wiki may cover (Cycle 0046 row 709).
 * VS Code 1.140.0 and Cursor 3.23.12 report the diff's modified side as the active text editor and both sides as visible text editors, each with `viewColumn` undefined, while the diff's group is the active tab group (C61 c61-688-diffprobe). The diff's own tab, a `TabInputTextDiff` with its `original` and `modified` documents, still stands in front of its group, so a side's column is the one group among the counted columns that shows the side's document in a diff in front; with none, or with several such groups, nothing places the editor.
 * @param editor - The text editor, if any.
 * @param groups - The editor's tab groups.
 * @param textDiffKind - The host's `TabInputTextDiff` class as `vscode` exports it; `undefined` in a host without it.
 * @param groupCount - The highest column counted: the main editor's measured groups for a layout read; every column when left out.
 * @returns
 * - The editor's own view column, when the editor reports one.
 * - Otherwise the column of the one group within `groupCount` whose front tab is a diff of the editor's document.
 * - `undefined` without an editor, without such a group, and when several groups show that diff in front.
 * @example
 * textEditorColumn(vscode.window.activeTextEditor, vscode.window.tabGroups.all, Reflect.get(vscode, 'TabInputTextDiff')) // => 2 while the diff of auth.ts in front of the second group has the keyboard
 * textEditorColumn(loginFormEditor, vscode.window.tabGroups.all, Reflect.get(vscode, 'TabInputTextDiff')) // => 1, the editor's own column
 */
export function textEditorColumn(
  editor:
    | { viewColumn?: number; document: { uri: { toString(): string } } }
    | undefined,
  groups: readonly {
    viewColumn: number
    activeTab?: { input: unknown } | undefined
  }[],
  textDiffKind: unknown,
  groupCount = Number.POSITIVE_INFINITY,
): number | undefined {
  if (!editor) return undefined
  if (editor.viewColumn !== undefined) return editor.viewColumn
  const uri = editor.document.uri.toString()
  const columns = groups
    .filter(
      (group) =>
        group.viewColumn <= groupCount &&
        isDiffTabOfDocument(group.activeTab?.input, uri, textDiffKind),
    )
    .map((group) => group.viewColumn)
  // Only one diff in front places the side; two would leave its column unknown.
  return columns.length === 1 ? columns[0] : undefined
}
