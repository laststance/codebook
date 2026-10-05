import { escapeHtml } from './escapeHtml'
import { unescapeHtml } from './unescapeHtml'

/** The rail's entry as a site published by 0.2.29.0 carries it: one link whose whole text is "Open in VS Code". The second group is the link's attributes. */
const ONE_LINE_OPEN_ENTRY =
  /(<p class="open-in-editor"><a ([^>]*)>)Open in (?:VS Code|Cursor)(<\/a>)/g
/** The label of the rail's entry as the publisher prints it since the entry names its target. */
const OPEN_ENTRY_LABEL =
  /(<p class="open-in-editor"><a [^>]*><span class="open-label">)Open in (?:VS Code|Cursor)(<\/span>)/g

/**
 * Reads the query of the address a published link opens, out of the link's attributes; called by {@link openTargetOf}.
 * @param linkAttributes - The attributes of the link as the page carries them, with the escaped `href`.
 * @returns The address's query; empty when the attributes hold no `href` or the address has no query.
 * @example
 * publishedQueryOf('href="vscode://laststance.codebook/source?root=%2Frepo&amp;path=src%2Fa.ts&amp;line=12"').get('path') // => 'src/a.ts'
 */
function publishedQueryOf(linkAttributes: string): URLSearchParams {
  const address = unescapeHtml(
    /(?:^|\s)href=(["'])(.*?)\1/.exec(linkAttributes)?.[2] ?? '',
  )
  // What follows the first question mark is the query; an address without one names no parameter this entry reads.
  return new URLSearchParams(address.slice(address.indexOf('?') + 1))
}

/**
 * Reads the file and line a published source link opens and prints them as the rail's entry shows its target; called by {@link rebindDeepWikiEditorLinks} for an entry published without one.
 * @param linkAttributes - The attributes of the entry's link as the page carries them, with the escaped `href`.
 * @returns
 * - The target as HTML, a `<wbr>` after each slash of the path: `src/<wbr>utils/<wbr>a.ts:12`
 * - `undefined` when the address names no path or no line number
 * @example
 * openTargetOf('href="vscode://laststance.codebook/source?root=%2Frepo&amp;path=src%2Fa.ts&amp;line=12&amp;sha256=…"')
 * // => 'src/<wbr>a.ts:12'
 */
function openTargetOf(linkAttributes: string): string | undefined {
  const query = publishedQueryOf(linkAttributes)
  const path = query.get('path')
  // A missing line reads as the text "null", which is no line number either.
  const line = String(query.get('line'))
  // An address without a readable target gets no target line: the entry never names a file it cannot tell.
  if (!path || !/^\d+$/.test(line)) return undefined
  return `${escapeHtml(path).replaceAll('/', '/<wbr>')}:${line}`
}

/**
 * Binds Wiki actions to the host serving each reader response so one published site works in both editors, and names the file and line the rail's entry opens on every served page.
 *
 * Called by the Wiki reader for every HTML page it serves. A page published since the entry names its target keeps its two spans and gets the editor's name; a page published by 0.2.29.0 (one link, "Open in VS Code") gets the same two spans, the target read from the link's own address, so it names the target without being published again.
 *
 * @param html - The published page with its static editor fallback.
 * @param editorScheme - The scheme registered by the editor serving this request.
 * @returns The page with Codebook action links bound to the active editor, and the rail's "Open in …" entry named after it and followed by its target. An entry whose address names no path or line keeps its one line.
 * @example
 * rebindDeepWikiEditorLinks('<a href="vscode://laststance.codebook/settings?root=%2Frepo">Settings</a>', 'cursor')
 * // => '<a href="cursor://laststance.codebook/settings?root=%2Frepo">Settings</a>'
 * rebindDeepWikiEditorLinks('<p class="open-in-editor"><a href="vscode://laststance.codebook/source?root=%2Frepo&amp;path=src%2Fa.ts&amp;line=12&amp;sha256=…">Open in VS Code</a></p>', 'cursor')
 * // => '<p class="open-in-editor"><a href="cursor://laststance.codebook/source?root=%2Frepo&amp;path=src%2Fa.ts&amp;line=12&amp;sha256=…"><span class="open-label">Open in Cursor</span> <span class="open-target">src/<wbr>a.ts:12</span></a></p>'
 */
export function rebindDeepWikiEditorLinks(
  html: string,
  editorScheme: 'vscode' | 'cursor',
): string {
  // The published page says VS Code, its fallback; the served one names the editor that opens the source.
  const openLabel = `Open in ${editorScheme === 'cursor' ? 'Cursor' : 'VS Code'}`
  return (
    html
      .replace(
        /(\s)href=(["'])(?:vscode|cursor):\/\/laststance\.codebook\/(source|update|settings)\?/g,
        (_match, whitespace: string, quote: string, route: string) =>
          `${whitespace}href=${quote}${editorScheme}://laststance.codebook/${route}?`,
      )
      .replace(
        OPEN_ENTRY_LABEL,
        (_match, opening: string, closing: string) =>
          `${opening}${openLabel}${closing}`,
      )
      // A site published by 0.2.29.0 carries the one-line entry; it gets the label and the target the publisher prints today.
      .replace(
        ONE_LINE_OPEN_ENTRY,
        (_match, opening: string, linkAttributes: string, closing: string) => {
          const target = openTargetOf(linkAttributes)
          return target === undefined
            ? `${opening}${openLabel}${closing}`
            : `${opening}<span class="open-label">${openLabel}</span> <span class="open-target">${target}</span>${closing}`
        },
      )
  )
}
