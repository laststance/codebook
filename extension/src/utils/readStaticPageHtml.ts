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
  /** The `href` of each judged `<link>` (a stylesheet, a module preload, or a script or style preload), as written; icons, manifests and hints are left out. */
  linkHrefs: readonly string[]
  /** The specifier keys of the page's import maps (`imports` and every `scopes` entry); a malformed map adds none. */
  importMapKeys: readonly string[]
  /** The string addresses the page's import maps map to (`imports` and every `scopes` entry), as written; a malformed map adds none. */
  importMapTargets: readonly string[]
}>

/** The `type` values of a script element that holds JavaScript a browser runs. */
const JAVASCRIPT_SCRIPT_TYPES: ReadonlySet<string> = new Set([
  '',
  'module',
  'text/javascript',
  'application/javascript',
])

/**
 * Says whether a `<link>` names a file the page needs to load: a stylesheet, a module preload, or a script or style preload.
 * @param element - A `<link>` element.
 * @returns `true` for a link that readiness judges.
 * @example isJudgedLink(linkElement) // => true for rel="stylesheet"
 */
function isJudgedLink(element: PageElement): boolean {
  const relations = (attributeOf(element, 'rel') ?? '')
    .toLowerCase()
    .split(/\s+/)
  if (relations.includes('stylesheet') || relations.includes('modulepreload'))
    return true
  const loads = (attributeOf(element, 'as') ?? '').trim().toLowerCase()
  return (
    relations.includes('preload') && (loads === 'script' || loads === 'style')
  )
}

/**
 * Reads the `href` of a `<link>` that readiness judges.
 * @param element - A `<link>` element.
 * @returns The `href` as written; `undefined` for a link without one or one that readiness does not judge.
 * @example judgedLinkHref(stylesheetLink) // => 'style.css'
 */
function judgedLinkHref(element: PageElement): string | undefined {
  return isJudgedLink(element) ? attributeOf(element, 'href') : undefined
}

/** The specifier keys and target addresses of one import map script. */
type ImportMapEntries = Readonly<{ keys: string[]; targets: string[] }>

/**
 * Reads the specifier keys and the target addresses of an import map script.
 * Called by {@link readStaticPageHtml} for each `<script>`.
 * @param element - A `<script>` element.
 * @returns The keys of `imports` and of every `scopes` entry with their string values; empty for a malformed map or a script that is no import map.
 * @example importMapEntriesOf(element) // => { keys: ['lib'], targets: ['https://unpkg.com/lib@1/a.js'] }
 */
function importMapEntriesOf(element: PageElement): ImportMapEntries {
  const none: ImportMapEntries = { keys: [], targets: [] }
  if ((attributeOf(element, 'type') ?? '').trim().toLowerCase() !== 'importmap')
    return none
  const text = element.childNodes.find((child) => child.nodeName === '#text')
  if (text === undefined || !('value' in text)) return none
  let parsed: unknown
  try {
    parsed = JSON.parse(text.value)
  } catch {
    return none
  }
  const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value)
  if (!isRecord(parsed)) return none
  // The top-level `imports` map and each `scopes` entry are specifier maps.
  const maps = [
    parsed.imports,
    ...(isRecord(parsed.scopes) ? Object.values(parsed.scopes) : []),
  ].filter(isRecord)
  return {
    keys: maps.flatMap((map) => Object.keys(map)),
    // A target that is not a string (null blocks a specifier) names no address.
    targets: maps.flatMap((map) =>
      Object.values(map).filter(
        (value): value is string => typeof value === 'string',
      ),
    ),
  }
}

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
 * @returns The inline scripts with their positions, the external script sources, the judged link hrefs, the import map keys and the import map targets, in document order.
 * @example
 * readStaticPageHtml('<script type="module">\nlet a\n</script>').inlineScripts[0]?.startLine // => 0
 */
export function readStaticPageHtml(html: string): StaticPageHtml {
  const inlineScripts: StaticPageInlineScript[] = []
  const scriptSources: string[] = []
  const linkHrefs: string[] = []
  const importMapKeys: string[] = []
  const importMapTargets: string[] = []
  const visit = (node: PageNode): void => {
    if ('tagName' in node && node.tagName === 'script') {
      const source = attributeOf(node, 'src')
      const inline = source === undefined ? inlineScriptOf(node) : undefined
      if (source !== undefined) scriptSources.push(source)
      if (inline) inlineScripts.push(inline)
      const importMap = importMapEntriesOf(node)
      importMapKeys.push(...importMap.keys)
      importMapTargets.push(...importMap.targets)
    }
    if ('tagName' in node && node.tagName === 'link') {
      const href = judgedLinkHref(node)
      if (href !== undefined) linkHrefs.push(href)
    }
    for (const child of childrenOf(node)) visit(child)
  }
  visit(parse(html, { sourceCodeLocationInfo: true }))
  return {
    inlineScripts,
    scriptSources,
    linkHrefs,
    importMapKeys,
    importMapTargets,
  }
}
