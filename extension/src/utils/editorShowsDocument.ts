/**
 * Says whether a text editor shows a given document; {@link StudyWorkspace.isCapturedSourceActiveEditor} asks it of the active text editor and the captured source before the reader tells the learner that the captured source has the keyboard, or notes that Codebook's placement gave it the keyboard (Cycle 0046 row 651).
 * A document that is not there is shown by no editor: without a captured source, and while no text editor is active, the answer is `false`, never the equality of two missing values.
 * @param editor - The text editor asked about, `undefined` when none is active.
 * @param documentUri - The document's URI, `undefined` when there is no such document (no captured source yet, or after a Close).
 * @returns
 * - `true` when the editor shows that document.
 * - `false` for another document, no editor, and no document.
 * @example
 * editorShowsDocument(vscode.window.activeTextEditor, this.sourceUri) // => true while the captured source is the active text editor
 * editorShowsDocument(undefined, undefined) // => false: no captured source and no active text editor
 */
export function editorShowsDocument(
  editor: { document: { uri: { toString(): string } } } | undefined,
  documentUri: { toString(): string } | undefined,
): boolean {
  // No document is shown by any editor, also while no editor is active.
  if (documentUri === undefined || editor === undefined) return false
  return editor.document.uri.toString() === documentUri.toString()
}
