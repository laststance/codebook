import {
  WIKI_CONTEXT_HEAD_MIN_LINES,
  WIKI_CONTEXT_KEPT_ANCHOR_COUNT,
  WIKI_CONTEXT_LINE_LIMIT,
} from '../constants'

import { codeUnitOfLine, longDeclarationHeadOfLine } from './codeUnitOfLine'
import { declaresPriorityTerm } from './declaresPriorityTerm'

/**
 * Keeps matching source and nearby control flow when Wiki Q&A builds bounded excerpts.
 * In a long file each ranked anchor first brings the code unit it documents or opens (a declaration with its brace block, {@link codeUnitOfLine}) while the budget allows; then a function too long for a whole unit brings its first lines ({@link longDeclarationHeadOfLine}, Cycle 0123); lines around the anchors fill what is left.
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
  const matches = indices
    .map((index) => ({
      index,
      score: scoreLine(lines[index]!, terms, priorityTerms),
    }))
    .filter((match) => match.score > 0)
    .sort(
      (first, second) =>
        second.score - first.score || first.index - second.index,
    )
  if (!matches.length) return indices.slice(0, WIKI_CONTEXT_LINE_LIMIT)
  const anchors = matches
    .slice(0, WIKI_CONTEXT_LINE_LIMIT)
    .map((match) => match.index)
  const selected = codeUnitsOfAnchors(
    lines,
    anchors,
    keptAnchorsOf(lines, anchors, priorityTerms),
    priorityTerms,
  )
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
 * Scores a line of a long file against the question's words and the identifiers a route reply named.
 * One priority match outweighs every ordinary term together, so the lines a route reply named come first; a line that declares one of the identifiers outweighs every line that only mentions them (Cycle 0123 F3, Issue #316: the declaration of `pasteItem` ranked below call sites of other identifiers). A dotted identifier and its own last part, both in the list, count once on a line that holds the dotted one.
 * Called by {@link selectWikiSourceLines} for every line.
 * @param line - One source line.
 * @param terms - Normalized words from the repository question.
 * @param priorityTerms - The identifiers the route reply named, lowercased.
 * @returns The line's score; 0 when nothing matches.
 * @example
 * scoreLine('function pasteItem() {', ['paste'], ['pasteitem']) // => 7
 * scoreLine('chrome.bookmarks.create(x)', [], ['chrome.bookmarks.create', 'create']) // => 2
 */
function scoreLine(
  line: string,
  terms: readonly string[],
  priorityTerms: readonly string[],
): number {
  const lower = line.toLowerCase()
  const priorityWeight = terms.length + 1
  const matched = priorityTerms.filter((term) => lower.includes(term))
  // A member that is the last part of a matched dotted identifier is the same match.
  const distinct = matched.filter(
    (term) =>
      !matched.some((other) => other !== term && other.endsWith(`.${term}`)),
  )
  const declarationBonus = declaresPriorityTerm(line, priorityTerms)
    ? (priorityTerms.length + 1) * priorityWeight
    : 0
  return (
    declarationBonus +
    distinct.length * priorityWeight +
    terms.filter((term) => lower.includes(term)).length
  )
}

/**
 * Gives each ranked anchor, in rank order, the code unit it documents or opens ({@link codeUnitOfLine}) while the excerpt budget allows, and its own line otherwise; an anchor that is not a kept line is left out once the budget left is reserved for kept lines.
 * Why: Cycle 0122 (F3) — when 80 or more lines of a long file matched, the excerpt was 80 single lines, and a matching doc comment reached the model without the function it documents.
 * A unit is admitted only while a place stays for every kept line not yet selected ({@link keptAnchorsOf}: the best-ranked matches and each route identifier's first line), so whole functions never push those out (Cycle 0122 review round).
 * Called by {@link selectWikiSourceLines} before it fills the rest of the budget with lines around the anchors.
 * @param lines - Complete verified source, indexed from zero.
 * @param anchors - Matching zero-based lines, best first.
 * @param keptAnchors - The anchors whose own lines keep their places ({@link keptAnchorsOf}).
 * @param priorityTerms - The identifiers the route reply named, lowercased; an anchor that declares one of them and begins a function too long for a whole unit brings that function's head in rank order, with the whole units (Cycle 0123 F3).
 * @returns The selected zero-based lines, at most {@link WIKI_CONTEXT_LINE_LIMIT}; lines already selected cost nothing again.
 * @example
 * codeUnitsOfAnchors(['// Adds one.', 'function add(value) {', '  return value + 1', '}'], [0], [], []) // => Set { 0, 1, 2, 3 }
 */
function codeUnitsOfAnchors(
  lines: readonly string[],
  anchors: readonly number[],
  keptAnchors: readonly number[],
  priorityTerms: readonly string[],
): Set<number> {
  const selected = new Set<number>()
  for (const anchor of anchors) {
    // Once the budget is spent, the remaining anchors are left out.
    if (selected.size >= WIKI_CONTEXT_LINE_LIMIT) break
    if (selected.has(anchor)) continue
    const wholeUnit = codeUnitOfLine(lines, anchor)
    // A route identifier's declaration too long for a whole unit brings its head here, before single lines of other anchors take the places.
    if (
      !wholeUnit &&
      declaresPriorityTerm(lines[anchor]!, priorityTerms) &&
      admitHead(longDeclarationHeadOfLine(lines, anchor), keptAnchors, selected)
    )
      continue
    admitUnitOrLine(anchor, wholeUnit ?? [anchor], keptAnchors, selected)
  }
  admitLongDeclarationHeads(lines, anchors, keptAnchors, selected)
  return selected
}

/**
 * Adds an anchor's code unit while the budget allows, and its own line otherwise: always for a kept line, and for another only while the kept lines keep their places.
 * Called by {@link codeUnitsOfAnchors} for each ranked anchor.
 * @param anchor - The anchor line.
 * @param unit - The anchor's code unit; the anchor line alone when it has none.
 * @param keptAnchors - The anchors whose own lines keep their places ({@link keptAnchorsOf}).
 * @param selected - The lines selected so far; the admitted lines are added to it.
 * @example
 * admitUnitOrLine(1, [0, 1, 2], [], selected) // adds lines 0, 1 and 2 while they fit
 */
function admitUnitOrLine(
  anchor: number,
  unit: readonly number[],
  keptAnchors: readonly number[],
  selected: Set<number>,
): void {
  // How many kept lines still wait for a place, leaving out the given lines.
  const waitingKept = (excluded: readonly number[]): number =>
    keptAnchors.filter(
      (keptAnchor) =>
        !selected.has(keptAnchor) && !excluded.includes(keptAnchor),
    ).length
  const unitLines = unit.filter((index) => !selected.has(index))
  // A unit is admitted while every kept line not yet selected keeps a place.
  if (
    selected.size + unitLines.length + waitingKept(unitLines) <=
    WIKI_CONTEXT_LINE_LIMIT
  ) {
    for (const index of unitLines) selected.add(index)
    return
  }
  // Otherwise the anchor's own line comes.
  if (
    keptAnchors.includes(anchor) ||
    selected.size + 1 + waitingKept([anchor]) <= WIKI_CONTEXT_LINE_LIMIT
  )
    selected.add(anchor)
}

/**
 * Gives each ranked anchor that begins a function too long for a whole unit the head of that function ({@link longDeclarationHeadOfLine}), after every whole unit is placed, so a whole unit is never displaced by a head.
 * Why: Cycle 0123 (F3, Issue #316) — P06's 44-line `pasteItem` was just over the unit limit, so the excerpt held 2 to 6 of the lines that create the bookmark and the folder.
 * A head follows the unit budget rule: a place stays for every kept line not yet selected, selected lines cost nothing, and the excerpt never passes {@link WIKI_CONTEXT_LINE_LIMIT}. A head that does not fit whole is cut to the space left, declaration line first, when that holds at least {@link WIKI_CONTEXT_HEAD_MIN_LINES} lines; otherwise the anchor stays alone.
 * Called by {@link codeUnitsOfAnchors} after its whole-unit pass.
 * @param lines - Complete verified source, indexed from zero.
 * @param anchors - Matching zero-based lines, best first.
 * @param keptAnchors - The anchors whose own lines keep their places ({@link keptAnchorsOf}).
 * @param selected - The lines selected so far; the admitted head lines are added to it.
 * @example
 * admitLongDeclarationHeads(lines, [0], [], selected) // adds lines 0 to 39 of a 44-line function that begins on line 0
 */
function admitLongDeclarationHeads(
  lines: readonly string[],
  anchors: readonly number[],
  keptAnchors: readonly number[],
  selected: Set<number>,
): void {
  for (const anchor of anchors) {
    if (selected.size >= WIKI_CONTEXT_LINE_LIMIT) return
    admitHead(longDeclarationHeadOfLine(lines, anchor), keptAnchors, selected)
  }
}

/**
 * Adds a head to the selection under the unit budget rule.
 * Called by {@link codeUnitsOfAnchors} for a route identifier's declaration, and by {@link admitLongDeclarationHeads} for every other anchor.
 * @param head - A head's zero-based lines ({@link longDeclarationHeadOfLine}); `undefined` for an anchor with no head.
 * @param keptAnchors - The anchors whose own lines keep their places ({@link keptAnchorsOf}).
 * @param selected - The lines selected so far; the admitted head lines are added to it.
 * @returns `true` when the head, whole or cut to the places left, was added; `false` when there is no head or fewer than {@link WIKI_CONTEXT_HEAD_MIN_LINES} of its lines fit.
 * @example
 * admitHead(undefined, [], new Set()) // => false
 */
function admitHead(
  head: readonly number[] | undefined,
  keptAnchors: readonly number[],
  selected: Set<number>,
): boolean {
  if (!head) return false
  // A kept line waiting for its place keeps it: the head's own kept lines use theirs.
  const waitingKept = keptAnchors.filter((kept) => !selected.has(kept))
  const prefix = headPrefixWithin(
    head,
    new Set([...selected, ...waitingKept]),
    WIKI_CONTEXT_LINE_LIMIT - selected.size - waitingKept.length,
  )
  // A head cut shorter than the minimum is not worth its places.
  if (prefix.length < Math.min(head.length, WIKI_CONTEXT_HEAD_MIN_LINES))
    return false
  for (const index of prefix) selected.add(index)
  return true
}

/**
 * Cuts a head to the places left: its first lines in order, as many as the room allows.
 * Called by {@link admitLongDeclarationHeads} for each head, before it checks the head against {@link WIKI_CONTEXT_HEAD_MIN_LINES}.
 * @param head - A head's zero-based lines in order, the declaration line first.
 * @param freeLines - Lines that cost no new place: the lines selected already and the kept lines whose places are reserved.
 * @param room - How many new places the head may take.
 * @returns The longest prefix of the head whose lines outside `freeLines` number at most `room`.
 * @example
 * headPrefixWithin([0, 1, 2, 3], new Set([0]), 2) // => [0, 1, 2]
 */
function headPrefixWithin(
  head: readonly number[],
  freeLines: ReadonlySet<number>,
  room: number,
): number[] {
  const newPlaces = head.filter((index) => !freeLines.has(index))
  // The first line past the room that costs a place ends the prefix.
  const cutAt = newPlaces[Math.max(room, 0)]
  const end = cutAt === undefined ? head.length : head.indexOf(cutAt)
  return head.slice(0, end)
}

/**
 * Lists the anchors whose own lines a code unit must never push out of a long file's excerpt: the {@link WIKI_CONTEXT_KEPT_ANCHOR_COUNT} best-ranked matches, and the first-ranked line of each route identifier.
 * One line per identifier, not every line it matches: an identifier such as `dispatch` matches dozens of lines, and keeping them all would leave no room for the unit that answers (F3 again).
 * Why: Cycle 0122 review round — two 40-line units could fill the 80-line budget and drop the third-best match or the lines of the other identifiers the route reply named (Cycle 0119's priority rule).
 * Called by {@link selectWikiSourceLines} before {@link codeUnitsOfAnchors} admits units.
 * @param lines - Complete verified source, indexed from zero.
 * @param anchors - Matching zero-based lines, best first.
 * @param priorityTerms - The identifiers the route reply named, lowercased.
 * @returns The kept zero-based lines, each once.
 * @example
 * keptAnchorsOf(['run()', 'dispatch(a)', 'dispatch(b)', 'save()'], [1, 2, 3, 0], ['dispatch']) // => [1, 2, 3]
 */
function keptAnchorsOf(
  lines: readonly string[],
  anchors: readonly number[],
  priorityTerms: readonly string[],
): number[] {
  const identifierAnchors = priorityTerms.flatMap((term) => {
    const anchor = anchors.find((index) =>
      lines[index]!.toLowerCase().includes(term),
    )
    return anchor === undefined ? [] : [anchor]
  })
  return [
    ...new Set([
      ...anchors.slice(0, WIKI_CONTEXT_KEPT_ANCHOR_COUNT),
      ...identifierAnchors,
    ]),
  ]
}
