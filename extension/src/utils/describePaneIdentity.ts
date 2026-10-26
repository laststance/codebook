/**
 * Words a webview pane's type and column for a refusal report's effect note without ever throwing: the editor's `WebviewPanel` throws `Webview is disposed` from its getters once it is disposed, and a pane the editor closed with its tab is disposed again by Codebook's own close.
 * Called by {@link StudyWorkspace}'s `revealPane` and `disposePane` before they act on the pane.
 * @param panel - The pane, live or already disposed.
 * @returns `<viewType> column <column>`, or `disposed pane` when a getter throws.
 * @example describePaneIdentity(livePanel) // => 'codebook.scopedBrowser column 1'
 */
export function describePaneIdentity(panel: {
  readonly viewType: string
  readonly viewColumn: number | undefined
}): string {
  try {
    return `${panel.viewType} column ${panel.viewColumn ?? 'own'}`
  } catch {
    return 'disposed pane'
  }
}
