import type { Protocol } from 'devtools-protocol'

import { MINIFIED_IDENTIFIER_SCAN_CHARS } from '../constants'
import { DEFAULT_SOURCE_MAP_LIMITS } from '../sourceMapLimits'

import {
  isGeneratedPositionBefore,
  type GeneratedPosition,
} from './isGeneratedPositionBefore'
import { walkSourceMapSegments } from './walkSourceMapSegments'

/** The first name of an inspection path (`currentState` of `currentState.length`). */
const FIRST_NAME = /^[A-Za-z_$][\w$]*/

/**
 * Rewrites a declared inspection path whose first name a minifier renamed into the name the minified build uses for it in the paused frame's scopes.
 *
 * Why: a library stop in a minified build (the checked-out library's own `.min` or browser build) pauses where `currentState` is the closure binding `l`, so evaluating the source name throws `ReferenceError`. The build's source map `names` say which generated identifier stands for a source name. Called by {@link ConfiguredBrowserRun}'s inspection beside {@link webpackImportPathOf}, and used only after the source name proved absent at the pause (a binding of that name always wins).
 * Scopes are read from the innermost outward; the first scope whose range holds mappings of the name decides, and only when all of them read one generated identifier. Two identifiers in one scope are ambiguous and give no rewrite, because a guess could read another variable.
 * @param path - The declared inspection path.
 * @param sourceMapText - The map of the executed script, as the build served it.
 * @param scriptSource - The executed script text the map's generated coordinates point into.
 * @param scopeChain - The paused call frame's scopes, innermost first; a scope without locations (the global one) is skipped.
 * @returns
 * - `{ name, compiledPath }` with the declared first name and the generated identifier plus the rest of the path
 * - `undefined` when the name is not in the map's `names`, no scope holds a mapping of it, or the deciding scope is ambiguous
 * @example
 * minifiedPathOf('currentState.length', mapText, 'function h(){return l}', scopeChain)
 * // => { name: 'currentState', compiledPath: 'l.length' }
 */
export function minifiedPathOf(
  path: string,
  sourceMapText: string,
  scriptSource: string,
  scopeChain: readonly Protocol.Debugger.Scope[],
): { name: string; compiledPath: string } | undefined {
  const name = FIRST_NAME.exec(path)?.[0]
  if (name === undefined) return undefined
  const mapped = mappedGeneratedNames(sourceMapText, scriptSource, name)
  if (mapped.length === 0) return undefined
  for (const scope of scopeChain) {
    const { startLocation, endLocation } = scope
    // The global scope has no range.
    if (!startLocation || !endLocation) continue
    const inside = new Set(
      mapped
        .filter(({ position }) =>
          isInside(position, startLocation, endLocation),
        )
        .map(({ identifier }) => identifier),
    )
    // The innermost scope that holds the name decides, and only when it is not ambiguous.
    if (inside.size === 0) continue
    if (inside.size > 1) return undefined
    return { name, compiledPath: `${[...inside][0]}${path.slice(name.length)}` }
  }
  return undefined
}

/**
 * Lists the generated identifiers a map gives one source name, with their positions; called by {@link minifiedPathOf}.
 * @param sourceMapText - The map's JSON text.
 * @param scriptSource - The executed script text.
 * @param name - The source name.
 * @returns Each mapping whose `names` entry is the name and whose generated text starts an identifier that is not a property access; empty for a map that is not readable.
 * @example mappedGeneratedNames(mapText, 'function h(){return l}', 'currentState') // => [{ position: { lineNumber: 0, columnNumber: 20 }, identifier: 'l' }]
 */
function mappedGeneratedNames(
  sourceMapText: string,
  scriptSource: string,
  name: string,
): { position: GeneratedPosition; identifier: string }[] {
  let names: unknown, mappings: unknown
  try {
    ;({ names, mappings } = JSON.parse(sourceMapText) as Record<
      string,
      unknown
    >)
  } catch {
    return []
  }
  if (
    !Array.isArray(names) ||
    typeof mappings !== 'string' ||
    !names.includes(name)
  )
    return []
  const lineStarts = [0]
  for (let index = 0; index < scriptSource.length; index++)
    if (scriptSource[index] === '\n') lineStarts.push(index + 1)
  const found: { position: GeneratedPosition; identifier: string }[] = []
  try {
    walkSourceMapSegments(
      mappings,
      ({ generatedLine, generatedColumn, original }) => {
        if (original?.nameIndex === undefined) return
        if (names[original.nameIndex] !== name) return
        const offset = (lineStarts[generatedLine] ?? Infinity) + generatedColumn
        const identifier = FIRST_NAME.exec(
          scriptSource.slice(offset, offset + MINIFIED_IDENTIFIER_SCAN_CHARS),
        )?.[0]
        // A property access (`a.currentState`) is not a variable of the frame; a spread's dots are.
        const before = scriptSource.slice(Math.max(0, offset - 3), offset)
        const isProperty = before.endsWith('.') && !before.endsWith('...')
        if (identifier !== undefined && !isProperty)
          found.push({
            position: {
              lineNumber: generatedLine,
              columnNumber: generatedColumn,
            },
            identifier,
          })
      },
      DEFAULT_SOURCE_MAP_LIMITS,
    )
  } catch {
    return []
  }
  return found
}

/**
 * Says whether a generated position lies in a scope's range (start included, end excluded); called by {@link minifiedPathOf}.
 * @param position - The mapping's generated position.
 * @param start - The scope's start in the executed script.
 * @param end - The scope's end in the executed script.
 * @returns `true` inside the range.
 * @example isInside({ lineNumber: 0, columnNumber: 5 }, { scriptId: '1', lineNumber: 0, columnNumber: 0 }, { scriptId: '1', lineNumber: 0, columnNumber: 9 }) // => true
 */
function isInside(
  position: GeneratedPosition,
  start: Protocol.Debugger.Location,
  end: Protocol.Debugger.Location,
): boolean {
  const asPosition = (location: Protocol.Debugger.Location) => ({
    lineNumber: location.lineNumber,
    columnNumber: location.columnNumber ?? 0,
  })
  return (
    !isGeneratedPositionBefore(position, asPosition(start)) &&
    isGeneratedPositionBefore(position, asPosition(end))
  )
}
