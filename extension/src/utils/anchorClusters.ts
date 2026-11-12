import {
  WIKI_CONTEXT_UNIT_LINE_LIMIT,
  WIKI_CONTEXT_WINDOW_LEAD_LINES,
} from '../constants'

import { enclosingLongDeclarationOf, type LineRange } from './codeUnitOfLine'
import { matchesRouteIdentifier } from './matchesRouteIdentifier'

/** A function too long for a whole unit, the route-identifier anchors inside it, and the lines it brings into a Wiki question's excerpt. */
export interface LongFunctionWindow {
  /** Zero-based line of the function's declaration. */
  declarationLine: number
  /** The anchors grouped to the function by {@link enclosingLongDeclarationOf}, best-ranked first. */
  anchors: number[]
  /** The window's zero-based lines in order, the declaration line first: at most {@link WIKI_CONTEXT_UNIT_LINE_LIMIT}, never past the closing line. */
  window: number[]
  /** How many different route identifiers the anchors name ({@link distinctRouteIdentifierCount}). */
  distinctIdentifiers: number
}

/**
 * Builds the zero-based lines from one line to another, both included.
 * @param first - The first line.
 * @param last - The last line; nothing when it is before `first`.
 * @returns The lines in order.
 * @example
 * linesBetween(3, 5) // => [3, 4, 5]
 */
function linesBetween(first: number, last: number): number[] {
  return Array.from(
    { length: Math.max(0, last - first + 1) },
    (_, offset) => first + offset,
  )
}

/**
 * Picks the lines a long function brings for the anchors inside it: its head when every anchor lies in its first {@link WIKI_CONTEXT_UNIT_LINE_LIMIT} lines; otherwise the declaration line and the span of {@link WIKI_CONTEXT_UNIT_LINE_LIMIT} - 1 lines that holds the most anchors, starting {@link WIKI_CONTEXT_WINDOW_LEAD_LINES} lines before one of them (the earliest such anchor on a tie). The closing line cuts the window short; it never shifts it.
 * Why: Cycle 0124 (F3, Issue #318) — the head of P06's 68-line `handleContextAction` (lines 1230-1269) held none of the copy and paste lines that the route identifiers matched (1270-1277).
 * Called by {@link longFunctionWindowsOf} for each function.
 * @param declaration - The function's declaration line and closing line.
 * @param anchors - The anchors inside the function, in any order.
 * @returns The window's zero-based lines in order, the declaration line first.
 * @example
 * windowOfLongFunction({ first: 0, last: 149 }, [100, 104]) // => [0, 98, 99, ..., 136]
 */
function windowOfLongFunction(
  declaration: LineRange,
  anchors: readonly number[],
): number[] {
  const { first, last } = declaration
  const inside = [...anchors].sort((one, other) => one - other)
  const headLast = Math.min(first + WIKI_CONTEXT_UNIT_LINE_LIMIT - 1, last)
  // Every anchor within the first unit's worth of lines: the head covers them all.
  if (!inside.length || inside.at(-1)! <= headLast)
    return linesBetween(first, headLast)
  const spanLength = WIKI_CONTEXT_UNIT_LINE_LIMIT - 1
  const spanStartOf = (anchor: number): number =>
    Math.max(first + 1, anchor - WIKI_CONTEXT_WINDOW_LEAD_LINES)
  const anchorsInSpanOf = (anchor: number): number =>
    inside.filter(
      (other) =>
        other >= spanStartOf(anchor) &&
        other <= spanStartOf(anchor) + spanLength - 1,
    ).length
  // The span holding the most anchors wins; on a tie the earliest stays.
  const chosen = inside.reduce((best, anchor) =>
    anchorsInSpanOf(anchor) > anchorsInSpanOf(best) ? anchor : best,
  )
  const start = spanStartOf(chosen)
  return [first, ...linesBetween(start, Math.min(start + spanLength - 1, last))]
}

/**
 * Counts how many of the route identifiers a function's anchor lines name, each once. A term that is the last part of another listed dotted identifier (the `get` that `routeTermsOf` adds after `chrome.bookmarks.get`) is that identifier's match, not one of its own, as in the line scores.
 * Why: Cycle 0124 (F3, Issue #318) — the function that holds the most different identifiers the editor model named is the one that answers, not the one with most lines of one short name.
 * Called by {@link longFunctionWindowsOf} to rank functions.
 * @param lines - Complete verified source, indexed from zero.
 * @param anchors - The function's anchors.
 * @param priorityTerms - The identifiers the route reply named, lowercased.
 * @returns The number of distinct identifiers the anchor lines hold.
 * @example
 * distinctRouteIdentifierCount(['save(a)', 'x.load(b)'], [0, 1], ['save', 'x.load', 'load']) // => 2
 */
function distinctRouteIdentifierCount(
  lines: readonly string[],
  anchors: readonly number[],
  priorityTerms: readonly string[],
): number {
  const ownTerms = priorityTerms.filter(
    (term) =>
      !priorityTerms.some(
        (other) => other !== term && other.endsWith(`.${term}`),
      ),
  )
  return ownTerms.filter((term) =>
    anchors.some((anchor) =>
      matchesRouteIdentifier(lines[anchor]!.toLowerCase(), term),
    ),
  ).length
}

/**
 * Groups a long file's route-identifier anchors by the function too long for a whole unit that encloses each of them, and gives each function its window, best function first.
 * Functions rank by the different route identifiers their anchors name ({@link distinctRouteIdentifierCount}), then by how many anchors they hold, then by their best anchor's rank. An anchor that no long function encloses belongs to no group.
 * Why: Cycle 0124 (F3, Issue #318) — when the editor model named identifiers inside a long function rather than the function, the excerpt held 0 to 6 of the 13 lines that answered, scattered among single lines of other matches.
 * Called by {@link selectWikiSourceLines} once per long source, before it places code units.
 * @param lines - Complete verified source, indexed from zero.
 * @param anchors - The anchors that match a route identifier (every anchor when the reply named none), best first.
 * @param priorityTerms - The identifiers the route reply named, lowercased; empty when the question alone ranked the lines.
 * @returns One entry per long function holding at least one anchor, ranked.
 * @example
 * longFunctionWindowsOf(['function load() {', ...fortyOneStatements, '}'], [20, 25], ['step'])
 * // => [{ declarationLine: 0, anchors: [20, 25], window: [0, 1, ..., 39], distinctIdentifiers: 1 }]
 */
export function longFunctionWindowsOf(
  lines: readonly string[],
  anchors: readonly number[],
  priorityTerms: readonly string[],
): LongFunctionWindow[] {
  const groups = new Map<
    number,
    { declaration: LineRange; anchors: number[] }
  >()
  for (const anchor of anchors) {
    const declaration = enclosingLongDeclarationOf(lines, anchor)
    // An anchor outside every long function stays a single line.
    if (!declaration) continue
    const group = groups.get(declaration.first)
    if (group) group.anchors.push(anchor)
    else groups.set(declaration.first, { declaration, anchors: [anchor] })
  }
  return [...groups.values()]
    .map(({ declaration, anchors: inside }) => ({
      declarationLine: declaration.first,
      anchors: inside,
      window: windowOfLongFunction(declaration, inside),
      distinctIdentifiers: distinctRouteIdentifierCount(
        lines,
        inside,
        priorityTerms,
      ),
    }))
    .sort(
      (one, other) =>
        other.distinctIdentifiers - one.distinctIdentifiers ||
        other.anchors.length - one.anchors.length ||
        anchors.indexOf(one.anchors[0]!) - anchors.indexOf(other.anchors[0]!),
    )
}
