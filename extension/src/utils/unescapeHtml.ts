/** The character of each entity the Wiki publisher writes when it escapes a text. */
const HTML_ENTITY_CHARACTERS: Readonly<Record<string, string>> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
}

/**
 * Reads a text back out of HTML the Wiki publisher escaped, the inverse of {@link escapeHtml}; called by {@link rebindDeepWikiEditorLinks} to read the address in an `href` of a published page.
 * @param html - The escaped text, for example the value of an attribute.
 * @returns The text with `&amp;`, `&lt;`, `&gt;`, `&quot;` and `&#39;` replaced by their characters, each entity read once; anything else unchanged.
 * @example
 * unescapeHtml('root=%2Frepo&amp;path=src%2Fa.ts') // => 'root=%2Frepo&path=src%2Fa.ts'
 * unescapeHtml('&amp;lt;')                         // => '&lt;'
 */
export function unescapeHtml(html: string): string {
  return html.replace(
    /&(?:amp|lt|gt|quot|#39);/g,
    (entity) => HTML_ENTITY_CHARACTERS[entity] ?? entity,
  )
}
