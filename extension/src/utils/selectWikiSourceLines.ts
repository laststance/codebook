import { WIKI_CONTEXT_LINE_LIMIT } from '../constants'

/**
 * Keeps matching source and nearby control flow when Wiki Q&A builds bounded excerpts.
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
  const selected = new Set(anchors)
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
