import type * as Parse5 from 'parse5' with { 'resolution-mode': 'import' }

// Node24 can load this ESM package synchronously; the VSIX build bundles it as CJS.
const { parse }: typeof Parse5 = require('parse5')

/** One inline `<script>` of a page, with where its text starts in the file. */
export type StaticPageInlineScript = Readonly<{
  /** The script's text as a browser executes it (line breaks normalized). */
  text: string
  /** The zero-based line of the file where the text starts. */
  startLine: number
  /** The zero-based column of that line where the text starts. */
  startColumn: number
  /** The zero-based line of the file where the text ends. */
  endLine: number
  /** Whether the script is a module (`type="module"`). */
  isModule: boolean
}>

/** What a page names, in document order. */
export type StaticPageHtml = Readonly<{
  inlineScripts: readonly StaticPageInlineScript[]
  /** The `src` of each external script, as written. */
  scriptSources: readonly string[]
  /** The `href` of each `<link>` that names a file (stylesheets, icons, preloads), as written. */
  linkHrefs: readonly string[]
}>

/** The `type` values of a script element that holds JavaScript a browser runs. */
const JAVASCRIPT_SCRIPT_TYPES: ReadonlySet<string> = new Set([
  '',
  'module',
  'text/javascript',
  'application/javascript',
])

/** A node of the parsed page. */
type PageNode = Parse5.DefaultTreeAdapterMap['node']

/** An element of the parsed page. */
type PageElement = Parse5.DefaultTreeAdapterMap['element']

/**
 * Reads one attribute of an element.
 * @param element - The element.
 * @param name - The lower-case attribute name.
 * @returns The value as written; `undefined` when the element has no such attribute.
 * @example attributeOf(scriptElement, 'src') // => 'main.js'
 */
function attributeOf(element: PageElement, name: string): string | undefined {
  return element.attrs.find((candidate) => candidate.name === name)?.value
}

/**
 * Reads the inline script an element holds.
 * Called by {@link readStaticPageHtml} for each `<script>` without a `src`.
 * @param element - A `<script>` element.
 * @returns The script with the position of its text; `undefined` for a script that holds no JavaScript a browser runs (a JSON or import-map block) or no text.
 * @example inlineScriptOf(element)?.startLine // => 5
 */
function inlineScriptOf(
  element: PageElement,
): StaticPageInlineScript | undefined {
  const type = (attributeOf(element, 'type') ?? '').trim().toLowerCase()
  if (!JAVASCRIPT_SCRIPT_TYPES.has(type)) return undefined
  const text = element.childNodes.find((child) => child.nodeName === '#text')
  if (text === undefined || !('value' in text)) return undefined
  const location = text.sourceCodeLocation
  if (!location) return undefined
  return {
    text: text.value,
    startLine: location.startLine - 1,
    startColumn: location.startCol - 1,
    endLine: location.endLine - 1,
    isModule: type === 'module',
  }
}

/**
 * Lists the nodes below a node: its children, and the content of a template.
 * @param node - A node of the parsed page.
 * @returns The child nodes.
 * @example childrenOf(documentNode) // => [doctype, html]
 */
function childrenOf(node: PageNode): PageNode[] {
  return [
    ...('childNodes' in node ? node.childNodes : []),
    ...('content' in node ? [node.content] : []),
  ]
}

/**
 * Reads the scripts and file links of a page the way a browser's parser does.
 *
 * Why it exists: readiness (does the page need a bundler) and the page-script seal (which lines are JavaScript) both need the same reading, with the position of each inline script's text. Called by {@link readStaticPageReadiness} and {@link sealStaticPageScript}.
 * @param html - The page text.
 * @returns The inline scripts with their positions, the external script sources and the link hrefs, in document order.
 * @example
 * readStaticPageHtml('<script type="module">\nlet a\n</script>').inlineScripts[0]?.startLine // => 0
 */
export function readStaticPageHtml(html: string): StaticPageHtml {
  const inlineScripts: StaticPageInlineScript[] = []
  const scriptSources: string[] = []
  const linkHrefs: string[] = []
  const visit = (node: PageNode): void => {
    if ('tagName' in node && node.tagName === 'script') {
      const source = attributeOf(node, 'src')
      const inline = source === undefined ? inlineScriptOf(node) : undefined
      if (source !== undefined) scriptSources.push(source)
      if (inline) inlineScripts.push(inline)
    }
    if ('tagName' in node && node.tagName === 'link') {
      const href = attributeOf(node, 'href')
      if (href !== undefined) linkHrefs.push(href)
    }
    for (const child of childrenOf(node)) visit(child)
  }
  visit(parse(html, { sourceCodeLocationInfo: true }))
  return { inlineScripts, scriptSources, linkHrefs }
}
