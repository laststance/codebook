import { VITE_ENTRY_MODULE_SCRIPT_LIMIT_COUNT } from '../constants'

const HTML_COMMENT = /<!--[\s\S]*?-->/g
const SCRIPT_OPENING_TAG = /<script\b([^>]*)>/gi
const ATTRIBUTE =
  /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g

/**
 * Reads the attributes of one opening tag into a lower-cased name to value map; a valueless attribute reads as the empty string.
 * @param attributeText - The text between the tag name and `>`.
 * @returns The attributes; the first occurrence of a name wins, as in HTML.
 * @example
 * attributesOf(' type="module" src=/a.js') // => Map { 'type' => 'module', 'src' => '/a.js' }
 */
function attributesOf(attributeText: string): Map<string, string> {
  const attributes = new Map<string, string>()
  for (const match of attributeText.matchAll(ATTRIBUTE)) {
    const name = match[1]!.toLowerCase()
    if (!attributes.has(name))
      attributes.set(name, match[2] ?? match[3] ?? match[4] ?? '')
  }
  return attributes
}

/**
 * Lists the served paths of the `<script type="module" src=…>` elements of an entry page, so Codebook can ask the owned Vite launcher to walk the modules the page loads.
 *
 * Why it exists: a browser stop in a workspace library is tied to the page's module graph, which starts at the module scripts of the `index.html` Vite serves at the entry path (Vite's own `/@vite/client` included). Called by {@link sealViteLibraryStop} once per page generation, with the HTML fetched from the owned origin.
 * An inline module script (no `src`), a classic script, a script inside an HTML comment and a script on another origin are skipped.
 * @param html - The served entry page.
 * @param entryUrl - The absolute address the page was fetched from; relative `src` values resolve against it.
 * @returns The same-origin paths with their query (`/src/main.tsx`, `/@vite/client`), in document order and without repeats, at most {@link VITE_ENTRY_MODULE_SCRIPT_LIMIT_COUNT}.
 * @example
 * extractModuleScriptSources('<script type="module" src="/src/main.tsx"></script>', 'http://127.0.0.1:4321/') // => ['/src/main.tsx']
 * extractModuleScriptSources('<script type="module">import "/x"</script>', 'http://127.0.0.1:4321/') // => []
 */
export function extractModuleScriptSources(
  html: string,
  entryUrl: string,
): string[] {
  const entry = new URL(entryUrl)
  const sources: string[] = []
  for (const tag of html
    .replace(HTML_COMMENT, '')
    .matchAll(SCRIPT_OPENING_TAG)) {
    const attributes = attributesOf(tag[1]!)
    const source = attributes.get('src')
    // Only a module script with a src is an entry module of the graph.
    if (attributes.get('type')?.toLowerCase() !== 'module' || !source) continue
    const resolved = URL.canParse(source, entry)
      ? new URL(source, entry)
      : undefined
    // A script on another origin is never fetched from the owned server.
    if (!resolved || resolved.origin !== entry.origin) continue
    const path = `${resolved.pathname}${resolved.search}`
    if (!sources.includes(path)) sources.push(path)
    if (sources.length >= VITE_ENTRY_MODULE_SCRIPT_LIMIT_COUNT) break
  }
  return sources
}
