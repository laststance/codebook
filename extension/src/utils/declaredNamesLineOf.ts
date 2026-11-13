import {
  WIKI_CONTEXT_LINE_LIMIT,
  WIKI_ROUTE_DECLARED_NAMES_LIMIT_BYTES,
} from '../constants'

import { declaredNamesOf } from './declaredNamesOf'

/** Start of the line {@link declaredNamesLineOf} writes; the byte limit counts from here to the closing brace. */
const DECLARED_NAMES_LINE_PREFIX = 'Declared in long sources: '

/**
 * Writes the route request's line of the names each long offered source declares, whole sources in offered order within {@link WIKI_ROUTE_DECLARED_NAMES_LIMIT_BYTES}.
 * Why: the editor model has no tools, so a function no Wiki page names can be routed to only when the request lists it (Cycle 0125 F3b, Issue #320).
 * Called by `routePromptOf` with the sources its request offers.
 * A source of {@link WIKI_CONTEXT_LINE_LIMIT} lines or fewer, or with no declared name, is skipped. The first source that does not fit ends the list.
 * @param offeredSources - The sources the request lists, in the order it lists them, each path once.
 * @returns The line without its newline, or undefined when no name is to be listed.
 * @example
 * declaredNamesLineOf([{ path: 'a.js', lines: longLinesWithPasteItem }]) // => 'Declared in long sources: {"a.js":["pasteItem"]}'
 */
export function declaredNamesLineOf(
  offeredSources: readonly { path: string; lines: readonly string[] }[],
): string | undefined {
  const entries: string[] = []
  for (const source of offeredSources) {
    if (source.lines.length <= WIKI_CONTEXT_LINE_LIMIT) continue
    const names = declaredNamesOf(source.lines)
    if (!names.length) continue
    const entry = `${JSON.stringify(source.path)}:${JSON.stringify(names)}`
    const withEntry = lineOf([...entries, entry])
    // Sources are added whole; the first one past the limit ends the list.
    if (
      Buffer.byteLength(withEntry, 'utf8') >
      WIKI_ROUTE_DECLARED_NAMES_LIMIT_BYTES
    )
      break
    entries.push(entry)
  }
  return entries.length ? lineOf(entries) : undefined
}

/** Joins entries into the names line. @param entries - `"path":[names]` texts. @returns The line, e.g. `Declared in long sources: {"a.js":["f"]}`. */
function lineOf(entries: readonly string[]): string {
  return `${DECLARED_NAMES_LINE_PREFIX}{${entries.join(',')}}`
}
