/**
 * Says whether a tab's input is a diff editor that shows a given document on one of its sides, so that a diff's text editor counts as the one in front of its group; {@link StudyWorkspace.isActiveTextEditorInFrontOfGroup} asks it of a group's front tab (Cycle 0046 row 688), and {@link textEditorColumn} of every group's front tab.
 * Both editors give a diff editor's tab a `TabInputTextDiff` input with its `original` and `modified` documents, and report the side that has the keyboard as the active text editor, with no view column (C61 c61-688-diffprobe; {@link textEditorColumn} places it in the diff's group, row 709). `showTextDocument` of that document does not give the diff its keyboard back: it opens a plain text tab of the document in front of it.
 * @param input - The input of a group's front tab.
 * @param documentUri - The document's URI, as a string.
 * @param textDiffKind - The host's `TabInputTextDiff` class as `vscode` exports it; `undefined` in a host without it.
 * @returns
 * - `true` for a diff input whose original or modified document is that document.
 * - `false` for any other input, no input, and a host without the class.
 * @example
 * isDiffTabOfDocument(group.activeTab?.input, editor.document.uri.toString(), Reflect.get(vscode, 'TabInputTextDiff')) // => true for the diff of auth.ts whose modified side has the keyboard
 * isDiffTabOfDocument(new vscode.TabInputText(uri), uri.toString(), Reflect.get(vscode, 'TabInputTextDiff')) // => false
 */
export function isDiffTabOfDocument(
  input: unknown,
  documentUri: string,
  textDiffKind: unknown,
): boolean {
  if (typeof textDiffKind !== 'function' || !(input instanceof textDiffKind))
    return false
  // A diff shows its document on either side.
  return [Reflect.get(input, 'original'), Reflect.get(input, 'modified')].some(
    (side: unknown) => String(side) === documentUri,
  )
}
