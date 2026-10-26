/**
 * Escapes the characters the editor's glob reads as syntax, so a folder name is matched as written.
 *
 * Why: the LLM Wiki view's file watcher builds its glob from the Wiki folder's name, and the setting may name `wiki[1]` or `{draft}`.
 * Trigger: {@link createLlmWikiView} when it makes the watcher's pattern.
 *
 * The editor's glob has no backslash escape; a character in brackets is literal, so `[` becomes `[[]`. A `]` outside brackets is literal already.
 *
 * @param text - A relative path with forward slashes.
 * @returns The text with `[`, `{`, `}`, `*` and `?` each put in brackets.
 * @example
 * escapeGlobCharacters('docs/wiki[1]') // => 'docs/wiki[[]1]'
 * escapeGlobCharacters('wiki')         // => 'wiki'
 */
export function escapeGlobCharacters(text: string): string {
  return text.replaceAll(/[[{}*?]/g, (character) => `[${character}]`)
}
