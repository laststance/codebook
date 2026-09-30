/** Binds published Codebook links to the editor serving this Wiki, so one static site remains usable in both hosts. @param html - Published article HTML. @param editorScheme - Active editor's registered URI scheme. @returns HTML with Codebook source/update links for that host. @example rebindDeepWikiEditorLinks('<a href="vscode://laststance.codebook/source?x=1">Open</a>', 'cursor') // => '<a href="cursor://laststance.codebook/source?x=1">Open</a>' */
/**
 * Binds Wiki actions to the host serving each reader response so one published site works in both editors.
 * @param html - The published page with its static editor fallback.
 * @param editorScheme - The scheme registered by the editor serving this request.
 * @returns The page with Codebook action links bound to the active editor.
 * @example
 * rebindDeepWikiEditorLinks('<a href="vscode://laststance.codebook/settings?root=%2Frepo">Settings</a>', 'cursor')
 * // => '<a href="cursor://laststance.codebook/settings?root=%2Frepo">Settings</a>'
 */
export function rebindDeepWikiEditorLinks(
  html: string,
  editorScheme: 'vscode' | 'cursor',
): string {
  return html.replace(
    /(\s)href=(["'])(?:vscode|cursor):\/\/laststance\.codebook\/(source|update|settings)\?/g,
    (_match, whitespace: string, quote: string, route: string) =>
      `${whitespace}href=${quote}${editorScheme}://laststance.codebook/${route}?`,
  )
}
