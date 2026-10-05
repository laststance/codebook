/** The entity of each character that changes the meaning of HTML text or of a quoted attribute. */
const HTML_ENTITIES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/**
 * Makes a text safe to print into HTML, the way the Wiki publisher escapes what it prints; called by {@link rebindDeepWikiEditorLinks} when it prints a source path into a served page.
 * @param text - The plain text.
 * @returns The text with `&`, `<`, `>`, `"` and `'` replaced by their entities; any other character unchanged.
 * @example
 * escapeHtml('src/a&b.ts') // => 'src/a&amp;b.ts'
 * escapeHtml('<name>')     // => '&lt;name&gt;'
 */
export function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (character) => HTML_ENTITIES[character] ?? character,
  )
}
