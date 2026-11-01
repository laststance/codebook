/**
 * Adds the editor members the saved-session commands touch at activation to a test's `vscode` stand-in, without replacing anything the test supplied.
 *
 * Why it exists: {@link activate} now builds the real saved-session store and installs its status item for every window, so each activation test needs `window.onDidChangeWindowState` although most of them test something else. {@link loadModule} calls it for `extension.js`.
 * It adds no `createStatusBarItem`: the Wiki status line decides by that member whether the editor has a status bar, and a window with no saved session never creates the item.
 * @param vscode - The stand-in a test passes for the `vscode` module; mutated in place so a test keeps its reference.
 * @returns The same object.
 * @example
 * withSavedSessionEditorStubs({ commands: { registerCommand } })
 */
export function withSavedSessionEditorStubs(vscode: unknown): unknown {
  if (typeof vscode !== 'object' || vscode === null) return vscode
  const editor = vscode as Record<string, unknown>
  const window = (editor.window ??= {}) as Record<string, unknown>
  window.onDidChangeWindowState ??= () => ({ dispose(): void {} })
  return editor
}
