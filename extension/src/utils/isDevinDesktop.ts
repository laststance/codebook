/**
 * Tells Devin Desktop apart from VS Code by the URI scheme it registers, `devin` (Cycle 0142, observation O2: its `appName` is "Devin" and its base is VS Code's); called once by {@link activate}, whose Set Up AI Chat, reconnect and Remove Devin Desktop Setup are the only paths that treat Devin Desktop on its own (Cycle 0143, decision D3).
 * @param env - The editor's `vscode.env`; a test's stand-in editor may have none.
 * @returns
 * - `true` in Devin Desktop
 * - `false` in VS Code, Cursor, or an editor without `env`
 * @example
 * isDevinDesktop({ uriScheme: 'devin' })  // => true
 * isDevinDesktop({ uriScheme: 'cursor' }) // => false
 */
export function isDevinDesktop(
  env: { uriScheme?: string } | undefined,
): boolean {
  return env?.uriScheme === 'devin'
}
