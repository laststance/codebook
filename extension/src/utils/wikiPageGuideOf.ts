import {
  WIKI_PAGE_GUIDE_SCAN_CHARS,
  WIKI_PAGE_GUIDE_SUMMARY_CHARS,
  WIKI_PAGE_GUIDE_TITLE_CHARS,
} from '../constants'

import { textWithoutTags } from './textWithoutTags'

/** One page of a published Wiki as a reader question's route request sees it: what the page is called, what its first paragraph says and the source paths it cites. */
export type WikiPageGuide = {
  title: string
  summary: string
  sources: string[]
}

/** The text each character reference of a first paragraph stands for, for the references a generated article uses. */
const CHARACTER_REFERENCES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
}

/**
 * The plain text of an article's first paragraph, cut to {@link WIKI_PAGE_GUIDE_SUMMARY_CHARS}: tags removed ({@link textWithoutTags}), the common character references decoded and whitespace collapsed.
 * Only {@link WIKI_PAGE_GUIDE_SCAN_CHARS} characters after the opening tag are read, and every step moves forward, so a paragraph that never closes or holds unfinished tags costs the same bounded scan as any other.
 * Called by {@link wikiPageGuideOf} for each page.
 * @param contentHtml - The page's article as published.
 * @returns The summary, or an empty string for an article without a paragraph.
 * @example firstParagraphOf('<h2>Flow</h2><p>Fetches &amp; caches.</p><p>More.</p>') // => 'Fetches & caches.'
 */
function firstParagraphOf(contentHtml: string): string {
  const opening = /<p[\s>]/i.exec(contentHtml)
  if (!opening) return ''
  const tagEnd = contentHtml.indexOf('>', opening.index)
  // An opening tag that never closes holds no paragraph text.
  if (tagEnd < 0) return ''
  const scanned = contentHtml.slice(
    tagEnd + 1,
    tagEnd + 1 + WIKI_PAGE_GUIDE_SCAN_CHARS,
  )
  const closing = /<\/p\s*>/i.exec(scanned)
  return textWithoutTags(closing ? scanned.slice(0, closing.index) : scanned)
    .replace(
      /&(?:amp|lt|gt|quot|#39|nbsp);/g,
      (reference) => CHARACTER_REFERENCES[reference] ?? reference,
    )
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, WIKI_PAGE_GUIDE_SUMMARY_CHARS)
}

/**
 * The `path` of each reference object in a manifest list that has a string one; anything else in the list is skipped.
 * Called by {@link wikiPageGuideOf} for a page's source list and for each diagram node's and edge's sources.
 * @param references - A list from the manifest, as published.
 * @returns The paths, in list order.
 * @example pathsOf([{ path: 'src/a.ts', line: 1 }, 7]) // => ['src/a.ts']
 */
function pathsOf(references: unknown): string[] {
  if (!Array.isArray(references)) return []
  return references.flatMap((reference: unknown) =>
    typeof reference === 'object' &&
    reference !== null &&
    'path' in reference &&
    typeof reference.path === 'string'
      ? [reference.path]
      : [],
  )
}

/**
 * The source paths a page's diagrams cite, from every node's and edge's `sources`.
 * Called by {@link wikiPageGuideOf} after the page's own source list.
 * @param diagrams - The page's `diagrams`, as published.
 * @returns The paths, in diagram order, repeats included.
 * @example diagramSourcesOf([{ nodes: [{ sources: [{ path: 'src/a.ts', line: 1 }] }], edges: [] }]) // => ['src/a.ts']
 */
function diagramSourcesOf(diagrams: unknown): string[] {
  if (!Array.isArray(diagrams)) return []
  return diagrams.flatMap((diagram: unknown) => {
    if (typeof diagram !== 'object' || diagram === null) return []
    const nodes =
      'nodes' in diagram && Array.isArray(diagram.nodes) ? diagram.nodes : []
    const edges =
      'edges' in diagram && Array.isArray(diagram.edges) ? diagram.edges : []
    return [...nodes, ...edges].flatMap((element: unknown) =>
      typeof element === 'object' && element !== null && 'sources' in element
        ? pathsOf(element.sources)
        : [],
    )
  })
}

/**
 * Builds the guide of a published Wiki's pages that a reader question routes through: each page's title (its first {@link WIKI_PAGE_GUIDE_TITLE_CHARS} characters), the start of its first paragraph and the source paths it cites (its source list, then its diagrams' node and edge sources), each path once.
 *
 * Why: a question whose words match no path or line, such as a Japanese question about English code, ranks every source alike, so on a large repository the route request listed sources in path order and ended before the implementation (Cycle 0119, F1: 298 of TanStack/query's 2,483 sources, none of them its core). The Wiki's own pages say which files explain what.
 * Called by the reader's question route in `deepWikiReader.ts` for each question, from the manifest it read for that question; other reader requests never build it. A page that is no object with a string `title`, or that cites no source, is left out; values that are not strings are skipped.
 * @param pages - The manifest's `pages` array, as published.
 * @returns One guide entry per page that has a title and cites a source, in page order.
 * @example wikiPageGuideOf([{ title: 'Query', contentHtml: '<p>Fetches &amp; caches.</p>', sources: [{ path: 'src/query.ts', line: 1 }] }]) // => [{ title: 'Query', summary: 'Fetches & caches.', sources: ['src/query.ts'] }]
 */
export function wikiPageGuideOf(pages: unknown[]): WikiPageGuide[] {
  return pages.flatMap((page: unknown) => {
    if (
      typeof page !== 'object' ||
      page === null ||
      !('title' in page) ||
      typeof page.title !== 'string'
    )
      return []
    const sources = [
      ...new Set([
        ...pathsOf('sources' in page ? page.sources : undefined),
        ...diagramSourcesOf('diagrams' in page ? page.diagrams : undefined),
      ]),
    ]
    // A page that cites no source cannot route a question to one.
    if (!sources.length) return []
    const contentHtml =
      'contentHtml' in page && typeof page.contentHtml === 'string'
        ? page.contentHtml
        : ''
    return [
      {
        title: page.title.slice(0, WIKI_PAGE_GUIDE_TITLE_CHARS),
        summary: firstParagraphOf(contentHtml),
        sources,
      },
    ]
  })
}
