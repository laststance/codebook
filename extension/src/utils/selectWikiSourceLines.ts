import { WIKI_CONTEXT_LINE_LIMIT } from '../constants'

import { codeUnitOfLine } from './codeUnitOfLine'

/**
 * Keeps matching source and nearby control flow when Wiki Q&A builds bounded excerpts.
 * In a long file each ranked anchor first brings the code unit it documents or opens (a declaration with its brace block, {@link codeUnitOfLine}) while the budget allows; lines around the anchors fill what is left.
 * Called by {@link answerDeepWikiQuestionWithPrompt} before optional model routing, and by its route step for a routed file, with the code identifiers the route reply named as priority terms.
 * @param lines - Complete verified source, indexed from zero.
 * @param terms - Normalized words from the repository question.
 * @param priorityTerms - Terms whose lines come before any line that matches only `terms`: the identifiers a route reply names to mark the answering lines (Cycle 0119 hosted review: lines matching a common question word filled the excerpt first).
 * @returns Sorted zero-based lines within the Wiki context budget.
 * @example selectWikiSourceLines(['export const value = 1;'], ['value']) // => [0]
 */
export function selectWikiSourceLines(
  lines: string[],
  terms: string[],
  priorityTerms: string[] = [],
): number[] {
  const indices = lines.map((_, index) => index)
  if (lines.length <= WIKI_CONTEXT_LINE_LIMIT) return indices
  // One priority match outweighs every ordinary term together, so the lines a route reply named come first.
  const priorityWeight = terms.length + 1
  const matches = indices
    .map((index) => {
      const line = lines[index]!.toLowerCase()
      return {
        index,
        score:
          priorityTerms.filter((term) => line.includes(term)).length *
            priorityWeight +
          terms.filter((term) => line.includes(term)).length,
      }
    })
    .filter((match) => match.score > 0)
    .sort(
      (first, second) =>
        second.score - first.score || first.index - second.index,
    )
  if (!matches.length) return indices.slice(0, WIKI_CONTEXT_LINE_LIMIT)
  const anchors = matches
    .slice(0, WIKI_CONTEXT_LINE_LIMIT)
    .map((match) => match.index)
  const selected = codeUnitsOfAnchors(lines, anchors)
  // Expand all matching regions together so an early function cannot consume every surrounding line.
  for (
    let distance = 1;
    selected.size < WIKI_CONTEXT_LINE_LIMIT && distance < lines.length;
    distance++
  ) {
    for (const anchor of anchors) {
      for (const index of [anchor - distance, anchor + distance]) {
        if (
          index >= 0 &&
          index < lines.length &&
          selected.size < WIKI_CONTEXT_LINE_LIMIT
        )
          selected.add(index)
      }
    }
  }
  return [...selected].sort((first, second) => first - second)
}

/**
 * Gives each ranked anchor, in rank order, the code unit it documents or opens ({@link codeUnitOfLine}) while the excerpt budget allows, and its own line otherwise.
 * Why: Cycle 0122 (F3) — when 80 or more lines of a long file matched, the excerpt was 80 single lines, and a matching doc comment reached the model without the function it documents.
 * Called by {@link selectWikiSourceLines} before it fills the rest of the budget with lines around the anchors.
 * @param lines - Complete verified source, indexed from zero.
 * @param anchors - Matching zero-based lines, best first.
 * @returns The selected zero-based lines, at most {@link WIKI_CONTEXT_LINE_LIMIT}; lines already selected cost nothing again.
 * @example
 * codeUnitsOfAnchors(['// Adds one.', 'function add(value) {', '  return value + 1', '}'], [0]) // => Set { 0, 1, 2, 3 }
 */
function codeUnitsOfAnchors(
  lines: readonly string[],
  anchors: readonly number[],
): Set<number> {
  const selected = new Set<number>()
  for (const anchor of anchors) {
    // Once the budget is spent, the remaining anchors are left out.
    if (selected.size >= WIKI_CONTEXT_LINE_LIMIT) break
    if (selected.has(anchor)) continue
    const unitLines = (codeUnitOfLine(lines, anchor) ?? [anchor]).filter(
      (index) => !selected.has(index),
    )
    // A unit that does not fit the budget left gives way to its anchor line.
    const admitted =
      selected.size + unitLines.length <= WIKI_CONTEXT_LINE_LIMIT
        ? unitLines
        : [anchor]
    for (const index of admitted) selected.add(index)
  }
  return selected
}
