import {
  NEXT_SERVER_STARTUP_SCAN_CHARS,
  REPOSITORY_DISCOVERY_CANDIDATE_LIMIT,
} from '../constants'

/** The call webpack's `require` chunk loading ends a server entry with: `__webpack_require__.X(0, ["vendor-chunks/next", "chunks/shared"], () => …)`. */
const STARTUP_CALL = '__webpack_require__.X('

/**
 * Lists the server chunks a Pages page's server compile requires before it runs, from the startup call at the end of the compile.
 *
 * Why it exists: a module the page imports from the workspace (an API client, a formatter) may sit in a shared server chunk beside the compile rather than in it, so the Pages server reader ({@link readPagesServerBundle}) must know which chunk files the compile loads. Called by {@link readNextChunkModules} for every chunk it decodes; a chunk with no startup call (a browser chunk, a shared chunk) gives none.
 * The text is untrusted build output: only the last {@link NEXT_SERVER_STARTUP_SCAN_CHARS} characters are searched, the scan is linear, and an id is kept only when it is a relative path that stays under the server folder. A call in any other form (numeric ids, a computed list) gives no ids, so a module such a chunk holds is not sealed rather than sealed wrongly.
 * @param compileText - The built server compile's text.
 * @returns The distinct chunk ids in the order the call lists them, at most {@link REPOSITORY_DISCOVERY_CANDIDATE_LIMIT}; each is the chunk file's path under the server folder without `.js`.
 * @example
 * serverChunkIdsRequiredBy('…\nvar __webpack_exports__ = __webpack_require__.X(0, ["vendor-chunks/next","chunks/shared"], () => (__webpack_exec__("./src/pages/index.tsx")));\n')
 * // => ['vendor-chunks/next', 'chunks/shared']
 * serverChunkIdsRequiredBy('self.webpackChunk_N_E.push([[1],{}])') // => []
 */
export function serverChunkIdsRequiredBy(compileText: string): string[] {
  const tail = compileText.slice(-NEXT_SERVER_STARTUP_SCAN_CHARS)
  const call = tail.lastIndexOf(STARTUP_CALL)
  if (call === -1) return []
  const listStart = tail.indexOf('[', call + STARTUP_CALL.length)
  if (listStart === -1) return []
  const ids = new Set<string>()
  let cursor = listStart + 1
  for (;;) {
    cursor = skipSeparators(tail, cursor)
    // The list ends at `]`; anything else but a string literal is a form this reader does not know.
    if (tail[cursor] === ']') return [...ids]
    const literalEnd = stringLiteralEnd(tail, cursor)
    if (literalEnd === -1) return []
    const id = parsedString(tail.slice(cursor, literalEnd))
    // A literal that is not valid JSON is a form this reader does not know.
    if (id === undefined) return []
    if (isServerChunkId(id)) ids.add(id)
    if (ids.size > REPOSITORY_DISCOVERY_CANDIDATE_LIMIT) return []
    cursor = literalEnd
  }
}

/**
 * Parses one double-quoted string literal; called by {@link serverChunkIdsRequiredBy}.
 * @param literal - A literal found by {@link stringLiteralEnd}.
 * @returns The string, or `undefined` when the literal is not valid JSON.
 * @example
 * parsedString('"chunks/shared"') // => 'chunks/shared'
 * parsedString('"\\q"') // => undefined
 */
function parsedString(literal: string): string | undefined {
  try {
    const value: unknown = JSON.parse(literal)
    return typeof value === 'string' ? value : undefined
  } catch {
    return undefined
  }
}

/**
 * Moves past the whitespace and commas between two list items; called by {@link serverChunkIdsRequiredBy}.
 * @param text - The searched text.
 * @param start - Where to start.
 * @returns The position of the first character that is neither.
 * @example
 * skipSeparators('a ,  "b"', 1) // => 5
 */
function skipSeparators(text: string, start: number): number {
  let cursor = start
  while (cursor < text.length && /[\s,]/.test(text[cursor]!)) cursor += 1
  return cursor
}

/**
 * Finds where a double-quoted JSON string literal ends; called by {@link serverChunkIdsRequiredBy}.
 * @param text - The searched text.
 * @param start - The position expected to hold the opening quote.
 * @returns The position after the closing quote, or `-1` when no literal starts at `start` or it never closes.
 * @example
 * stringLiteralEnd('["a\\"b"]', 1) // => 7
 */
function stringLiteralEnd(text: string, start: number): number {
  if (text[start] !== '"') return -1
  for (let cursor = start + 1; cursor < text.length; cursor += 1) {
    if (text[cursor] === '\\') cursor += 1
    else if (text[cursor] === '"') return cursor + 1
  }
  return -1
}

/**
 * Says whether a chunk id is a relative path that stays under the server folder; called by {@link serverChunkIdsRequiredBy} for every listed id.
 * @param id - A chunk id of the startup call.
 * @returns `false` for an empty id, a backslash, a control character, a leading slash or a `.`/`..` segment.
 * @example
 * isServerChunkId('vendor-chunks/next') // => true
 * isServerChunkId('../../outside') // => false
 */
function isServerChunkId(id: string): boolean {
  return (
    id.length > 0 &&
    !id.startsWith('/') &&
    ![...id].some(
      (character) => character === '\\' || character.charCodeAt(0) < 32,
    ) &&
    id.split('/').every((segment) => !['', '.', '..'].includes(segment))
  )
}
