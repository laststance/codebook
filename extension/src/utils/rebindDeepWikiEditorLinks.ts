import { WIKI_OPEN_TARGET_ELEMENT_ID } from '../constants'

import { escapeHtml } from './escapeHtml'
import { unescapeHtml } from './unescapeHtml'

/** The label of the rail's entry inside its link, the pattern of 0.2.29.0: every page since carries "Open in VS Code" as the link's whole text, so each reader can name its own editor there. */
const OPEN_ENTRY_LABEL =
  /(<p class="open-in-editor"><a [^>]*>)Open in (?:VS Code|Cursor)(<\/a>)/g
/** A rail entry that ends with its link, as a site published by 0.2.29.0 carries it: no element beside the link names the target. The second group is the link's attributes. */
const OPEN_ENTRY_WITHOUT_TARGET =
  /(<p class="open-in-editor"><a )([^>]*)(>[^<]*<\/a>)(<\/p>)/g
/** A rail entry as the builds of Cycle 0046 before finding 600 published it: the link is described by the target shown beside it, whose `<wbr>` Chrome reads as spaces ("src/ utils/ a.ts :12"). The groups are the entry up to the link's description, the end of the link and the end of the entry. */
const OPEN_ENTRY_DESCRIBED_BY_ITS_SHOWN_TARGET =
  /(<p class="open-in-editor"><a [^>]*?) aria-describedby="[^"]*"(>[^<]*<\/a>) <span class="open-target"[^>]*>(?:[^<]|<wbr>)*<\/span>(<\/p>)/g

/** The file and the line number a rail entry opens, as its address names them. */
type OpenTarget = { path: string; line: string }

/** A comment or a start tag of a page: what {@link withEditorSchemeInLinks} tells apart from the page's text. A comment is passed over whole, up to what a browser takes for its end (`-->`, `--!>`, or at once for `<!-->` and `<!--->`); a start tag is where the address of a link stands, read up to the `>` that ends it as a browser reads it: a quoted attribute value in it may hold a `>`, and a `<` inside the tag is a character of it (a bare attribute value `<!--` starts no comment). An escaped code example holds no `<` before a letter, so it is text. */
const COMMENT_OR_START_TAG =
  /<!--(?:-?>|[\s\S]*?(?:--!?>|$))|<[A-Za-z][^>"']*(?:(?:"[^"]*"|'[^']*')[^>"']*)*>/g
/** The start of a Codebook address in the `href` of a start tag, with the scheme of either editor; the third group is the action the address names. The attribute stands after one of the five characters a browser separates attributes at (tab, line feed, form feed, carriage return, space): another white space of JavaScript, a no-break space for example, is a letter of the tag for a browser. */
const CODEBOOK_ADDRESS_START =
  /([\t\n\f\r ])href=(["'])(?:vscode|cursor):\/\/laststance\.codebook\/(source|update|settings)\?/g

/**
 * Gives every Codebook address a link of the page opens the scheme of the editor that serves the page; called by {@link rebindDeepWikiEditorLinks} first.
 *
 * Only the start tags of the page are read. The page's text is served as published: an escaped code example that shows a Codebook address keeps the scheme its author wrote. (The reader of 0.2.29.0 rewrote the whole page, text included.)
 *
 * @param html - The published page.
 * @param editorScheme - The scheme registered by the editor serving this request.
 * @returns The page with the scheme rewritten in the `href` of its start tags, and its text and comments unchanged.
 * @example
 * withEditorSchemeInLinks('<a href="vscode://laststance.codebook/update?root=%2Frepo">Update</a><code>&lt;a href="vscode://laststance.codebook/update?root=%2Frepo"&gt;</code>', 'cursor')
 * // => '<a href="cursor://laststance.codebook/update?root=%2Frepo">Update</a><code>&lt;a href="vscode://laststance.codebook/update?root=%2Frepo"&gt;</code>'
 */
function withEditorSchemeInLinks(
  html: string,
  editorScheme: 'vscode' | 'cursor',
): string {
  return html.replace(COMMENT_OR_START_TAG, (markup) =>
    // A comment opens nothing, so it is served as published.
    markup.startsWith('<!--')
      ? markup
      : markup.replace(
          CODEBOOK_ADDRESS_START,
          (_match, whitespace: string, quote: string, route: string) =>
            `${whitespace}href=${quote}${editorScheme}://laststance.codebook/${route}?`,
        ),
  )
}

/**
 * Reads the query of the address a published link opens, out of the link's attributes; called by {@link openTargetOf}.
 * @param linkAttributes - The attributes of the link as the page carries them, with the escaped `href`.
 * @returns The address's query; empty when the attributes hold no `href` or the address has no query.
 * @example
 * publishedQueryOf('href="vscode://laststance.codebook/source?root=%2Frepo&amp;path=src%2Fa.ts&amp;line=12"').get('path') // => 'src/a.ts'
 */
function publishedQueryOf(linkAttributes: string): URLSearchParams {
  const address = unescapeHtml(
    /(?:^|[\t\n\f\r ])href=(["'])(.*?)\1/.exec(linkAttributes)?.[2] ?? '',
  )
  const queryStart = address.indexOf('?')
  // What follows the first question mark is the query; an address without one names no parameter this entry reads.
  return new URLSearchParams(
    queryStart === -1 ? '' : address.slice(queryStart + 1),
  )
}

/**
 * Reads the file and line a published source link opens; called by {@link rebindDeepWikiEditorLinks} for an entry published without a target beside its link.
 * @param linkAttributes - The attributes of the entry's link as the page carries them, with the escaped `href`.
 * @returns
 * - The path and the line number the address names, as text
 * - `undefined` when the address names no path or no line number
 * @example
 * openTargetOf('href="vscode://laststance.codebook/source?root=%2Frepo&amp;path=src%2Fa.ts&amp;line=12&amp;sha256=…"')
 * // => { path: 'src/a.ts', line: '12' }
 */
function openTargetOf(linkAttributes: string): OpenTarget | undefined {
  const query = publishedQueryOf(linkAttributes)
  const path = query.get('path')
  // A missing line reads as the text "null", which is no line number either.
  const line = String(query.get('line'))
  // An address without a readable target gets no target line: the entry never names a file it cannot tell.
  if (!path || !/^\d+$/.test(line)) return undefined
  return { path, line }
}

/**
 * Prints the file and line beside the link of a rail entry as the publisher prints them; called by {@link rebindDeepWikiEditorLinks} for an entry that gets its target from the reader.
 *
 * The shown target has a `<wbr>` after each slash of the path and before the colon, so a long path wraps there and the line number stays whole. Chrome reads each `<wbr>` as a space in the text of an element, so the shown target is hidden from assistive technology (`aria-hidden`), and a visually hidden copy of the file and line as written (`sr-only`, a rule of every reader shell) is the link's description.
 *
 * @param target - The path and the line number the entry's address names, as {@link openTargetOf} read them.
 * @param targetId - The id of the description, which the link's `aria-describedby` names.
 * @returns The shown target and the description as HTML, the path escaped in both.
 * @example
 * openTargetHtml({ path: 'src/a.ts', line: '12' }, 'codebook-open-target')
 * // => '<span class="open-target" aria-hidden="true">src/<wbr>a.ts<wbr>:12</span><span class="sr-only" id="codebook-open-target">src/a.ts:12</span>'
 */
function openTargetHtml(target: OpenTarget, targetId: string): string {
  const path = escapeHtml(target.path)
  return `<span class="open-target" aria-hidden="true">${path.replaceAll('/', '/<wbr>')}<wbr>:${target.line}</span><span class="sr-only" id="${targetId}">${path}:${target.line}</span>`
}

/**
 * Chooses the id of the description the reader adds to a rail entry: the publisher's id, or that id with a number when an element of the page already carries it; called by {@link rebindDeepWikiEditorLinks}.
 *
 * A page published before the publisher kept the ids of a page's content apart from the reader's may carry the id on a heading of its article. The entry's link names its description by id, and an id that stands twice names the first element, which would be that heading.
 *
 * @param html - The page as the reader serves it, its entries without the target the reader adds.
 * @returns
 * - `codebook-open-target` when no element of the page carries it
 * - otherwise `codebook-open-target-2`, or the first higher number that is free
 * @example
 * freeOpenTargetIdIn('<h2 id="codebook-open-target">Targets</h2>') // => 'codebook-open-target-2'
 */
function freeOpenTargetIdIn(html: string): string {
  /** Whether a start tag of the page carries the id, quoted or bare. */
  const isCarried = (id: string): boolean =>
    new RegExp(`\\s[iI][dD]\\s*=\\s*["']?${id}(?=["'\\s>])`).test(html)
  let id = WIKI_OPEN_TARGET_ELEMENT_ID
  // The publisher's id first, then the same with 2, 3, …
  for (let count = 2; isCarried(id); count += 1)
    id = `${WIKI_OPEN_TARGET_ELEMENT_ID}-${count}`
  return id
}

/**
 * Binds Wiki actions to the host serving each reader response so one published site works in both editors, and names the file and line the rail's entry opens on every served page.
 *
 * Called by {@link servedWikiPageHtml} for every HTML page the Wiki reader serves. The scheme is rewritten in the addresses of the page's links, never in its text ({@link withEditorSchemeInLinks}). The entry's link holds the label alone, so the pattern of 0.2.29.0 names the serving editor in it on a page of any age. A page published by 0.2.29.0, whose entry ends with its link, gets the target the publisher prints today beside the link, read from the link's own address ({@link openTargetHtml}): the shown file and line, and the same as written as the link's description; it names the target without being published again. A page published by a build of Cycle 0046 before finding 600, whose link is described by the shown target with its wrap points, is first put back into the shape of 0.2.29.0 and gets the same. The added description takes an id no element of that page carries ({@link freeOpenTargetIdIn}).
 *
 * @param html - The published page with its static editor fallback.
 * @param editorScheme - The scheme registered by the editor serving this request.
 * @returns The page with Codebook action links bound to the active editor, the rail's "Open in …" link named after it, and the file and line beside that link. An entry whose address names no path or line keeps its link alone.
 * @example
 * rebindDeepWikiEditorLinks('<a href="vscode://laststance.codebook/settings?root=%2Frepo">Settings</a>', 'cursor')
 * // => '<a href="cursor://laststance.codebook/settings?root=%2Frepo">Settings</a>'
 * rebindDeepWikiEditorLinks('<p class="open-in-editor"><a href="vscode://laststance.codebook/source?root=%2Frepo&amp;path=src%2Fa.ts&amp;line=12&amp;sha256=…">Open in VS Code</a></p>', 'cursor')
 * // => '<p class="open-in-editor"><a href="cursor://laststance.codebook/source?root=%2Frepo&amp;path=src%2Fa.ts&amp;line=12&amp;sha256=…" aria-describedby="codebook-open-target">Open in Cursor</a> <span class="open-target" aria-hidden="true">src/<wbr>a.ts<wbr>:12</span><span class="sr-only" id="codebook-open-target">src/a.ts:12</span></p>'
 */
export function rebindDeepWikiEditorLinks(
  html: string,
  editorScheme: 'vscode' | 'cursor',
): string {
  // The published page says VS Code, its fallback; the served one names the editor that opens the source.
  const openLabel = `Open in ${editorScheme === 'cursor' ? 'Cursor' : 'VS Code'}`
  const servedPage = withEditorSchemeInLinks(html, editorScheme)
    .replace(
      OPEN_ENTRY_LABEL,
      (_match, opening: string, closing: string) =>
        `${opening}${openLabel}${closing}`,
    )
    // An entry of a build before finding 600 loses its description and its shown target, so it gets the target the publisher prints today, as an entry of 0.2.29.0 does.
    .replace(
      OPEN_ENTRY_DESCRIBED_BY_ITS_SHOWN_TARGET,
      (_entry, opening: string, linkEnd: string, closing: string) =>
        `${opening}${linkEnd}${closing}`,
    )
  // A site published by 0.2.29.0 carries the link alone; it gets the target the publisher prints today.
  return servedPage.replace(
    OPEN_ENTRY_WITHOUT_TARGET,
    (
      entry: string,
      opening: string,
      linkAttributes: string,
      link: string,
      closing: string,
    ) => {
      const target = openTargetOf(linkAttributes)
      if (target === undefined) return entry
      const targetId = freeOpenTargetIdIn(servedPage)
      return `${opening}${linkAttributes} aria-describedby="${targetId}"${link} ${openTargetHtml(target, targetId)}${closing}`
    },
  )
}
