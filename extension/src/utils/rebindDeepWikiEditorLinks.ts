import { WIKI_OPEN_TARGET_ELEMENT_ID } from '../constants'

import { addressAsBrowserReads } from './addressAsBrowserReads'
import { browserAttributeText } from './browserAttributeText'
import { escapeHtml } from './escapeHtml'
import { readHtmlStartTags } from './readHtmlStartTags'
import { withServedAddresses } from './withServedAddresses'

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

/**
 * Reads the query of the address a published link opens, out of the link's attributes, as a browser reads its first `href` ({@link readHtmlStartTags}, {@link addressAsBrowserReads}): in any case of the name, quoted or bare, with its references read; called by {@link openTargetOf}.
 *
 * The link is read as the reader serves it ({@link withServedAddresses}), so a link whose address the reader takes away names no target.
 *
 * @param linkAttributes - The attributes of the link as the page carries them, with the escaped `href`.
 * @param editorScheme - The scheme registered by the editor serving this request.
 * @returns The address's query; empty when the attributes hold no `href` the reader keeps or the address has no query.
 * @example
 * publishedQueryOf('HREF=vscode://laststance.codebook/source?root=%2Frepo&amp;path=src%2Fa.ts&amp;line=12', 'cursor').get('path') // => 'src/a.ts'
 */
function publishedQueryOf(
  linkAttributes: string,
  editorScheme: 'vscode' | 'cursor',
): URLSearchParams {
  const href = readHtmlStartTags(
    withServedAddresses(`<a ${linkAttributes}>`, editorScheme),
  )[0]?.attributes.find((attribute) => attribute.name === 'href')
  const address = addressAsBrowserReads(href?.written ?? '')
  const queryStart = address.indexOf('?')
  // What follows the first question mark is the query; an address without one names no parameter this entry reads.
  return new URLSearchParams(
    queryStart === -1 ? '' : address.slice(queryStart + 1),
  )
}

/**
 * Reads the file and line a published source link opens; called by {@link rebindDeepWikiEditorLinks} for an entry published without a target beside its link.
 * @param linkAttributes - The attributes of the entry's link as the page carries them, with the escaped `href`.
 * @param editorScheme - The scheme registered by the editor serving this request.
 * @returns
 * - The path and the line number the address names, as text
 * - `undefined` when the address names no path or no line number, or the reader takes the address away
 * @example
 * openTargetOf('href="vscode://laststance.codebook/source?root=%2Frepo&amp;path=src%2Fa.ts&amp;line=12&amp;sha256=…"', 'vscode')
 * // => { path: 'src/a.ts', line: '12' }
 */
function openTargetOf(
  linkAttributes: string,
  editorScheme: 'vscode' | 'cursor',
): OpenTarget | undefined {
  const query = publishedQueryOf(linkAttributes, editorScheme)
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
 * Chooses the id of the description the reader adds to a rail entry: the publisher's id, or that id with a number when an element of the page already carries it; called by {@link rebindDeepWikiEditorLinks} once for the page.
 *
 * A page published before the publisher kept the ids of a page's content apart from the reader's may carry the id on a heading of its article. The entry's link names its description by id, and an id that stands twice names the first element, which would be that heading. The page's ids are read once, as a browser reads them ({@link readHtmlStartTags}), so a page that carries many numbered ids takes no more than one reading.
 *
 * @param html - The page with the rail's label named after the serving editor, its entries without the target the reader adds.
 * @returns
 * - `codebook-open-target` when no element of the page carries it
 * - otherwise `codebook-open-target-2`, or the first higher number that is free
 * @example
 * freeOpenTargetIdIn('<h2 id="codebook-open-target">Targets</h2>') // => 'codebook-open-target-2'
 */
function freeOpenTargetIdIn(html: string): string {
  const carried = new Set(
    readHtmlStartTags(html).flatMap(({ attributes }) =>
      attributes
        .filter((attribute) => attribute.name === 'id')
        .map((attribute) => browserAttributeText(attribute.written ?? '')),
    ),
  )
  let id = WIKI_OPEN_TARGET_ELEMENT_ID
  // The publisher's id first, then the same with 2, 3, …
  for (let count = 2; carried.has(id); count += 1)
    id = `${WIKI_OPEN_TARGET_ELEMENT_ID}-${count}`
  return id
}

/**
 * Binds Wiki actions to the host serving each reader response so one published site works in both editors, and names the file and line the rail's entry opens on every served page.
 *
 * Called by {@link servedWikiPageHtml} for every HTML page the Wiki reader serves. The entry's link holds the label alone, so the pattern of 0.2.29.0 names the serving editor in it on a page of any age. A page published by 0.2.29.0, whose entry ends with its link, gets the target the publisher prints today beside the link, read from the link's own address ({@link openTargetHtml}): the shown file and line, and the same as written as the link's description; it names the target without being published again. A page published by a build of Cycle 0046 before finding 600, whose link is described by the shown target with its wrap points, is first put back into the shape of 0.2.29.0 and gets the same. The added description takes an id no element of that page carries ({@link freeOpenTargetIdIn}).
 *
 * Last, in one pass over the page those edits made, every address the publisher refuses today loses its link, a refresh its effect, and every Codebook address gets the serving editor's scheme, in the addresses of the page's tags and never in its text ({@link withServedAddresses}). The edits above match raw text, and a match can start or end inside a quoted value, so they may change how a browser pairs the page's quotes; the filter reads the page they leave, so the page served is always the filter's output.
 *
 * @param html - The published page with its static editor fallback.
 * @param editorScheme - The scheme registered by the editor serving this request.
 * @returns The page with no link but those the publisher accepts today, Codebook action links bound to the active editor, the rail's "Open in …" link named after it, and the file and line beside that link. An entry whose address names no path or line keeps its link alone.
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
  const relabeledPage = html
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
  // The id of the added description is chosen once for the page, in one reading of its ids.
  const targetId = freeOpenTargetIdIn(relabeledPage)
  // A site published by 0.2.29.0 carries the link alone; it gets the target the publisher prints today.
  const editedPage = relabeledPage.replace(
    OPEN_ENTRY_WITHOUT_TARGET,
    (
      entry: string,
      opening: string,
      linkAttributes: string,
      link: string,
      closing: string,
    ) => {
      const target = openTargetOf(linkAttributes, editorScheme)
      if (target === undefined) return entry
      return `${opening}${linkAttributes} aria-describedby="${targetId}"${link} ${openTargetHtml(target, targetId)}${closing}`
    },
  )
  // The filter reads the page as the edits above left it, so no tag or attribute they make reaches the learner unjudged.
  return withServedAddresses(editedPage, editorScheme)
}
