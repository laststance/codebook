/** One `<script>` element of an extension page. */
export type ExtensionPageScript =
  | { kind: 'src'; src: string }
  | { kind: 'inline'; code: string }
  | { kind: 'importmap' }

/** The scripts of an extension page and its `<base href>`. */
export interface ExtensionPageScripts {
  baseHref?: string
  scripts: readonly ExtensionPageScript[]
}

const HTML_COMMENT = /<!--[\s\S]*?-->/g
const SCRIPT_ELEMENT = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi
const BASE_ELEMENT = /<base\b([^>]*)>/i
/** Script types the browser runs as JavaScript; any other type (a template, JSON data) is not a script. */
const JAVASCRIPT_TYPES = new Set([
  '',
  'module',
  'text/javascript',
  'application/javascript',
])

/** Reads an attribute value (double, single or no quotes) from a tag's attribute text, case-insensitive on the name. */
function attributeValue(attributes: string, name: string): string | undefined {
  const pattern = new RegExp(
    `(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`,
    'i',
  )
  const match = pattern.exec(attributes)
  return match ? (match[1] ?? match[2] ?? match[3]) : undefined
}

/**
 * Lists the `<script>` elements of an extension page's HTML (external, inline and import map) and its `<base href>`.
 * Called by {@link discoverStaticLoads} for the surface page; HTML comments are ignored and non-JavaScript script types are skipped.
 * @param html - The page's text.
 * @returns The scripts in document order and the base href when present.
 * @example
 * findExtensionScriptReferences('<script src="a.js"></script>')
 * // => { scripts: [{ kind: 'src', src: 'a.js' }] }
 */
export function findExtensionScriptReferences(
  html: string,
): ExtensionPageScripts {
  const visible = html.replace(HTML_COMMENT, '')
  const scripts: ExtensionPageScript[] = []
  for (const element of visible.matchAll(SCRIPT_ELEMENT)) {
    const attributes = element[1] ?? ''
    const type = (attributeValue(attributes, 'type') ?? '').trim().toLowerCase()
    if (type === 'importmap') {
      scripts.push({ kind: 'importmap' })
      continue
    }
    if (!JAVASCRIPT_TYPES.has(type)) continue
    const src = attributeValue(attributes, 'src')
    scripts.push(
      src === undefined
        ? { kind: 'inline', code: element[2] ?? '' }
        : { kind: 'src', src },
    )
  }
  const baseHref = attributeValue(BASE_ELEMENT.exec(visible)?.[1] ?? '', 'href')
  return baseHref === undefined ? { scripts } : { baseHref, scripts }
}
