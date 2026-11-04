import { VITE_LIBRARY_WALK_ENTRY_LIMIT_COUNT } from '../constants'

const SCRIPT_TAG_NAME = 'script'
const WORD_CHARACTER = /\w/
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
 * Finds the `>` that ends an opening tag, stepping over quoted attribute values (which may hold a `>`).
 *
 * Why it exists: {@link scriptOpeningTags} needs the end of each script tag without a backtracking pattern, which rescanned the page for every unterminated tag. Called once per script opener.
 * @param html - The page.
 * @param from - The index just after the tag name.
 * @returns The index of the closing `>`, or -1 when the tag is never closed (an unterminated quote counts as never closed).
 * @example
 * tagEnd('<script a="x>y" b>', 7) // => 17
 */
function tagEnd(html: string, from: number): number {
  let index = from
  while (index < html.length) {
    const character = html[index]!
    if (character === '>') return index
    if (character === '"' || character === "'") {
      // Step over the quoted value; a quote that never closes ends the tag scan.
      const closing = html.indexOf(character, index + 1)
      if (closing === -1) return -1
      index = closing + 1
    } else {
      index += 1
    }
  }
  return -1
}

/**
 * Yields the attribute text of each complete `<script …>` opening tag of a page in one linear pass.
 *
 * Why it exists: the former regular-expression scan restarted to the end of the page for every unterminated `<script` or `<!--`, so a malformed 256 KiB page blocked the extension host for seconds. Here a complete comment is skipped, an unterminated comment is plain text (nothing later can close it, which is remembered), and the scan ends at the first script tag that is never closed. Called by {@link extractModuleScriptSources}.
 * @param html - The served entry page.
 * @returns The attribute text of each script opening tag, in document order.
 * @example
 * [...scriptOpeningTags('<!-- <script a> --><script type="module" src="/a.js">')] // => [' type="module" src="/a.js"']
 */
function* scriptOpeningTags(html: string): Generator<string> {
  let index = html.indexOf('<')
  // Once no `-->` follows, no later comment can ever close.
  let commentCanClose = true
  while (index !== -1) {
    if (html.startsWith('<!--', index)) {
      const closing = commentCanClose ? html.indexOf('-->', index + 4) : -1
      if (closing !== -1) {
        // A complete comment hides everything inside it.
        index = html.indexOf('<', closing + 3)
        continue
      }
      commentCanClose = false
    } else if (
      html
        .slice(index + 1, index + 1 + SCRIPT_TAG_NAME.length)
        .toLowerCase() === SCRIPT_TAG_NAME &&
      !WORD_CHARACTER.test(html[index + 1 + SCRIPT_TAG_NAME.length] ?? '')
    ) {
      const attributesStart = index + 1 + SCRIPT_TAG_NAME.length
      const end = tagEnd(html, attributesStart)
      // An unterminated tag swallows the rest of the page, as in a browser.
      if (end === -1) return
      yield html.slice(attributesStart, end)
      index = html.indexOf('<', end + 1)
      continue
    }
    index = html.indexOf('<', index + 1)
  }
}

/**
 * Lists the served paths of the `<script type="module" src=…>` elements of an entry page, so Codebook can ask the owned Vite launcher to walk the modules the page loads.
 *
 * Why it exists: a browser stop in a workspace library is tied to the page's module graph, which starts at the module scripts of the `index.html` Vite serves at the entry path (Vite's own `/@vite/client` included). Called by {@link sealViteLibraryStop} once per page generation, with the HTML fetched from the owned origin.
 * An inline module script (no `src`), a classic script, a script inside a complete HTML comment and a script on another origin are skipped.
 * Vite's dev server rewrites a page's own inline `<script type="module">` into `<script type="module" src="/index.html?html-proxy&index=0.js">` (Vite 8.3.5 `addInlineModule`), so such an entry arrives with a `src`, and is kept with its query; no inline parsing is needed.
 * Limits of the scan: it is a linear tag scan ({@link scriptOpeningTags}), not an HTML parser. Text that merely looks like a script tag inside `<noscript>`, `<textarea>`, `<template>` or an unterminated comment is read as a script; a stray entry only adds a module to the walk and is harmless. A `>` inside a quoted attribute value is handled; a script tag that is never closed ends the scan, so malformed input costs time linear in the page.
 * @param html - The served entry page.
 * @param entryUrl - The absolute address the page was fetched from; relative `src` values resolve against it.
 * @returns The same-origin paths with their query (`/src/main.tsx`, `/@vite/client`), in document order and without repeats, at most one more than {@link VITE_LIBRARY_WALK_ENTRY_LIMIT_COUNT}, so the caller can tell a page over the limit from one exactly at it.
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
  for (const attributeText of scriptOpeningTags(html)) {
    const attributes = attributesOf(attributeText)
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
    if (sources.length > VITE_LIBRARY_WALK_ENTRY_LIMIT_COUNT) break
  }
  return sources
}
