/**
 * Says whether a tab's input is VS Code's chat editor input (Chat: Open Chat in Editor): the extension host gives such a tab an input of the class it exports as `vscode.TabInputChat`, which the API's typings do not name (VS Code 1.140.0 `extensionHostProcess.js` 173:38462, 163:116170, 295:178349). {@link StudyWorkspace.captureApplicationPreparationReturn} asks it, so that an agent's Application preparation gives such a chat tab of a main editor group its keyboard back (Cycle 0046 row 625).
 * @param input - The input of the tab the editor names as active.
 * @param chatInputKind - The host's `TabInputChat` class as `vscode` exports it; `undefined` in a host without it. Cursor gives its composer tab no input at all (3.23.12 `workbench.desktop.main.js` 17269:27859), like a Settings page, so no Cursor tab is one.
 * @returns
 * - `true` for an input of that class.
 * - `false` for any other input, no input, and a host without the class.
 * @example
 * isChatEditorTabInput(tab.input, Reflect.get(vscode, 'TabInputChat')) // => true for VS Code's chat editor tab
 * isChatEditorTabInput(undefined, Reflect.get(vscode, 'TabInputChat')) // => false for Cursor's composer tab or a Settings page
 */
export function isChatEditorTabInput(
  input: unknown,
  chatInputKind: unknown,
): boolean {
  return typeof chatInputKind === 'function' && input instanceof chatInputKind
}
