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
 * Why: a library stop in a minified build (the checked-out library's own `.min` or browser build) pauses where `currentState` is the closure binding `l`, so evaluating the source name throws `ReferenceError`. The build's source map `names` say which generated identifier stands for a source name. Called by {@link ConfiguredBrowserRun}'s inspection beside {@link webpackImportPathOf}; the caller asks for the rewrite before each inspection, and {@link inspectConfiguredValues} uses it only after the source name proved absent at the pause (a binding of that name always wins).
 * Scopes are read from the innermost outward; the first scope whose range holds mappings of the name decides, and only when all of them read one generated identifier. Two identifiers in one scope are ambiguous and give no rewrite, because a guess could read another variable. The same holds when a scope inner to the deciding one maps that identifier to another source name: evaluation would read the inner variable, so the result is unavailable.
 * @param path - The declared inspection path.
 * @param sourceMapText - The map of the executed script, as the build served it.
 * @param scriptSource - The executed script text the map's generated coordinates point into.
 * @param scopeChain - The paused call frame's scopes, innermost first; a scope without locations (the global one) is skipped.
 * @returns
 * - `{ name, compiledPath }` with the declared first name and the generated identifier plus the rest of the path
 * - `undefined` when the name is not in the map's `names`, no scope holds a mapping of it, the deciding scope is ambiguous, an inner scope reuses the identifier for another name, or the map is too large to be read whole (a walk cut short by a size limit proves nothing)
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
  const everyMapping = mappedGeneratedNames(sourceMapText, scriptSource, name)
  const mapped = everyMapping.filter((entry) => entry.sourceName === name)
  if (mapped.length === 0) return undefined
  for (const [scopeIndex, scope] of scopeChain.entries()) {
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
    const identifier = [...inside][0]
    // Evaluation resolves the identifier from the innermost scope, so an inner scope binding it under another name would be read instead.
    const isShadowed = scopeChain.slice(0, scopeIndex).some((inner) => {
      const { startLocation: from, endLocation: to } = inner
      if (!from || !to) return false
      return everyMapping.some(
        (entry) =>
          entry.sourceName !== name &&
          entry.identifier === identifier &&
          isInside(entry.position, from, to),
      )
    })
    if (isShadowed) return undefined
    return { name, compiledPath: `${identifier}${path.slice(name.length)}` }
  }
  return undefined
}

/**
 * Lists the generated identifiers a map gives every source name, with their positions (the asked name's and the others', so shadowing can be seen); called by {@link minifiedPathOf}.
 * @param sourceMapText - The map's JSON text.
 * @param scriptSource - The executed script text.
 * @param name - The source name; the map is read only when its `names` hold it.
 * @returns Each named mapping whose generated text starts an identifier that is not a property access; empty for a map that is not readable or whose walk stopped at a size limit (a partial list would hide the ambiguity or shadowing the unread rest may hold).
 * @example mappedGeneratedNames(mapText, 'function h(){return l}', 'currentState') // => [{ position: { lineNumber: 0, columnNumber: 20 }, identifier: 'l', sourceName: 'currentState' }]
 */
function mappedGeneratedNames(
  sourceMapText: string,
  scriptSource: string,
  name: string,
): { position: GeneratedPosition; identifier: string; sourceName: string }[] {
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
  const found: {
    position: GeneratedPosition
    identifier: string
    sourceName: string
  }[] = []
  let isComplete: boolean
  try {
    isComplete = walkSourceMapSegments(
      mappings,
      ({ generatedLine, generatedColumn, original }) => {
        if (original?.nameIndex === undefined) return
        const sourceName: unknown = names[original.nameIndex]
        if (typeof sourceName !== 'string') return
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
            sourceName,
          })
      },
      DEFAULT_SOURCE_MAP_LIMITS,
    )
  } catch {
    return []
  }
  // A walk a size limit cut short cannot prove a name unambiguous or unshadowed by an inner scope, so nothing is resolved.
  return isComplete ? found : []
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
