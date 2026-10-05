import {
  isGeneratedPositionBefore,
  type GeneratedPosition,
} from './isGeneratedPositionBefore'

/** One break location the debugger listed for a module: where it lies in the generated module, and the one-based place the sealed map gives it in the stop's original. */
export interface MappedBreakLocation {
  line: number
  column: number
  generated: GeneratedPosition
}

/** The break locations a debugger passed on its way to a binding: their source lines, and the generated place the binding was taken at. */
export interface BreakLocationsOnTheWay {
  /** The source lines, ascending and each once, of the break locations from the requested generated place up to, and without, the binding's. */
  lines: number[]
  /** The generated place the breakpoint was requested at, which the lines were counted from. */
  requestedAt: GeneratedPosition
  /** The generated place of the binding the lines were counted up to. */
  boundAt: GeneratedPosition
}

/**
 * Finds the generated place of a binding for {@link breakLocationLinesOnTheWay}: the paused frame's when the stop is judged at its pause, otherwise the first listed break location from the requested place on that the sealed map puts at the bound line and column.
 * @param locations - The module's break locations, in generated order.
 * @param requestedAt - The generated place the breakpoint was requested at.
 * @param bound - The one-based source line and column of the binding.
 * @param pausedAt - The generated place of the paused top frame, when the stop is judged at a pause on the bound line.
 * @returns The binding's generated place, or `undefined` when no pause is given and no listed break location from the requested place on maps to the bound place.
 * @example
 * boundGeneratedPlace([{ line: 4, column: 3, generated: { lineNumber: 3, columnNumber: 2 } }], { lineNumber: 0, columnNumber: 0 }, { line: 4, column: 3 }) // => { lineNumber: 3, columnNumber: 2 }
 */
function boundGeneratedPlace(
  locations: readonly MappedBreakLocation[],
  requestedAt: GeneratedPosition,
  bound: { line: number; column: number },
  pausedAt: GeneratedPosition | undefined,
): GeneratedPosition | undefined {
  if (pausedAt) return pausedAt
  return locations.find(
    (location) =>
      location.line === bound.line &&
      location.column === bound.column &&
      !isGeneratedPositionBefore(location.generated, requestedAt),
  )?.generated
}

/**
 * Lists the source lines on which the debugger could have paused on its way from the place a stop's breakpoint was requested at to the place it bound it at, both taken in the generated module, so {@link ConfiguredBrowserRun} counts only those lines as lying between the requested and the bound line.
 * A generated module does not keep the order of its source: a build can append a statement at the module's end and map it to a line near the top (a server action's registration call is mapped to its function's name). The debugger moves a breakpoint it cannot set to the first place it can pause at after the requested generated position, so only a break location between the two generated places was passed over; one elsewhere in the module says nothing about the binding, whatever source line the map gives it.
 * @param locations - Every break location the debugger listed for the module, mapped back to the stop's original; their order does not matter.
 * @param requestedAt - The generated place the breakpoint was requested at: the first generated position the sealed map puts on the requested line. `undefined` when the map could not say.
 * @param bound - The one-based source line and column of the binding.
 * @param pausedAt - The generated place of the paused top frame, when the stop is judged at its pause and that frame is on the bound line: it is the binding's generated place. Without it, the first listed break location from the requested place on that the map puts at `bound` is taken.
 * @returns
 * - The lines of the break locations from `requestedAt` (included) to the binding's generated place (excluded), with both places
 * - `undefined` when either generated place cannot be known: no requested place, no listed break location at the bound place from there on, or a binding that lies before the requested place in the generated module. The caller then counts every line with a break location, as before the generated places were compared
 * @example
 * // The module's last statement is mapped to line 2; the stop requested on line 1 is bound on line 5.
 * breakLocationLinesOnTheWay(
 *   [
 *     { line: 5, column: 3, generated: { lineNumber: 4, columnNumber: 2 } },
 *     { line: 2, column: 23, generated: { lineNumber: 6, columnNumber: 0 } },
 *   ],
 *   { lineNumber: 0, columnNumber: 0 },
 *   { line: 5, column: 3 },
 * ) // => { lines: [], requestedAt: { lineNumber: 0, columnNumber: 0 }, boundAt: { lineNumber: 4, columnNumber: 2 } }
 * breakLocationLinesOnTheWay([], undefined, { line: 5, column: 3 }) // => undefined
 */
export function breakLocationLinesOnTheWay(
  locations: readonly MappedBreakLocation[],
  requestedAt: GeneratedPosition | undefined,
  bound: { line: number; column: number },
  pausedAt?: GeneratedPosition,
): BreakLocationsOnTheWay | undefined {
  if (!requestedAt) return undefined
  const ordered = locations.toSorted((left, right) =>
      isGeneratedPositionBefore(left.generated, right.generated) ? -1 : 1,
    ),
    boundAt = boundGeneratedPlace(ordered, requestedAt, bound, pausedAt)
  // A binding before the requested place was not reached by moving on from it: the generated order says nothing about what lies between.
  if (!boundAt || isGeneratedPositionBefore(boundAt, requestedAt))
    return undefined
  const lines = ordered
    .filter(
      (location) =>
        !isGeneratedPositionBefore(location.generated, requestedAt) &&
        isGeneratedPositionBefore(location.generated, boundAt),
    )
    .map((location) => location.line)
  return {
    lines: [...new Set(lines)].sort((left, right) => left - right),
    requestedAt,
    boundAt,
  }
}
