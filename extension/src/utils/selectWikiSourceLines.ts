import {
  WIKI_CONTEXT_CLUSTER_MIN_ANCHORS,
  WIKI_CONTEXT_HEAD_MIN_LINES,
  WIKI_CONTEXT_KEPT_ANCHOR_COUNT,
  WIKI_CONTEXT_LINE_LIMIT,
  WIKI_CONTEXT_NAMED_HEAD_IDENTIFIER_COUNT,
} from '../constants'

import {
  longFunctionWindowsOf,
  type LongFunctionWindow,
} from './anchorClusters'
import { codeUnitOfLine, longDeclarationHeadOfLine } from './codeUnitOfLine'
import { declaresPriorityTerm } from './declaresPriorityTerm'
import { matchesRouteIdentifier } from './matchesRouteIdentifier'

/** What one long source's excerpt build shares between its admission steps. */
interface ExcerptBuild {
  /** Complete verified source, indexed from zero. */
  lines: readonly string[]
  /** The anchors whose own lines keep their places ({@link keptAnchorsOf}). */
  keptAnchors: readonly number[]
  /** The identifiers the route reply named, lowercased. */
  priorityTerms: readonly string[]
  /** Each long function holding route-identifier anchors with its window, ranked ({@link longFunctionWindowsOf}). */
  windows: readonly LongFunctionWindow[]
  /** Declaration lines whose window is in (a route-named declaration's or a cluster's), so neither their cluster nor their head is admitted again. */
  windowedDeclarations: Set<number>
  /** The lines selected so far. */
  selected: Set<number>
}

/**
 * Keeps matching source and nearby control flow when Wiki Q&A builds bounded excerpts.
 * In a long file each ranked anchor first brings the code unit it documents or opens (a declaration with its brace block, {@link codeUnitOfLine}) while the budget allows; a route-named function too long for a whole unit that holds route-identifier anchors brings, at its declaration line's rank, its named window; before the first anchor that brings only its own line, the named functions still waiting bring theirs, then each long function holding several route-identifier anchors brings its window ({@link longFunctionWindowsOf}, Cycle 0124), a named function holding no other route identifier bringing its head among them; then any other function too long for a whole unit brings its first lines ({@link longDeclarationHeadOfLine}, Cycle 0123); lines around the anchors fill what is left.
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
 * One priority match outweighs every ordinary term together, so the lines a route reply named come first; a line that declares one of the identifiers outweighs every line that only mentions them (Cycle 0123 F3, Issue #316: the declaration of `pasteItem` ranked below call sites of other identifiers). A dotted identifier and its own last part, both in the list, count once on a line that holds the dotted one. A route identifier matches only as a whole identifier ({@link matchesRouteIdentifier}); question words still match inside longer words.
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
  // A route identifier counts only as a whole identifier, so `get` never matches inside `getElementById` (Cycle 0124 F3).
  const matched = priorityTerms.filter((term) =>
    matchesRouteIdentifier(lower, term),
  )
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
 * A route-named function too long for a whole unit that holds route-identifier anchors brings, in rank order, its named window ({@link admitUnitOrNamedWindow}); just before the first anchor that only brings its own line, the named functions still waiting bring theirs, then each long function holding {@link WIKI_CONTEXT_CLUSTER_MIN_ANCHORS} or more route-identifier anchors brings its window, best first, a named function holding no other route identifier bringing its head among them ({@link admitWindowsBeforeSingleLines}, Cycle 0124 F3).
 * Called by {@link selectWikiSourceLines} before it fills the rest of the budget with lines around the anchors.
 * @param lines - Complete verified source, indexed from zero.
 * @param anchors - Matching zero-based lines, best first.
 * @param keptAnchors - The anchors whose own lines keep their places ({@link keptAnchorsOf}).
 * @param priorityTerms - The identifiers the route reply named, lowercased; their anchors form the long functions' windows (every anchor when the reply named none).
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
  const build: ExcerptBuild = {
    lines,
    keptAnchors,
    priorityTerms,
    windows: longFunctionWindowsOf(
      lines,
      routeAnchorsOf(lines, anchors, priorityTerms),
      priorityTerms,
    ),
    windowedDeclarations: new Set<number>(),
    selected: new Set<number>(),
  }
  const { selected } = build
  let didAdmitWindows = false
  for (const anchor of anchors) {
    // Once the budget is spent, the remaining anchors are left out.
    if (selected.size >= WIKI_CONTEXT_LINE_LIMIT) break
    if (selected.has(anchor)) continue
    if (admitUnitOrNamedWindow(build, anchor)) continue
    // Before the first anchor that brings only its own line, the named long functions still waiting and the clusters bring their windows.
    if (!didAdmitWindows) {
      didAdmitWindows = true
      admitWindowsBeforeSingleLines(build, anchors)
      if (selected.has(anchor)) continue
    }
    admitUnitOrLine(anchor, [anchor], keptAnchors, selected)
  }
  // Every anchor brought a unit or a window, so the clusters still get their turn.
  if (!didAdmitWindows) admitWindowsBeforeSingleLines(build, anchors)
  admitLongDeclarationHeads(build, anchors)
  return selected
}

/**
 * Lists the anchors that may form a long function's window: those holding a route identifier, or every anchor when the reply named none, so a common question word never makes a window when identifiers were named.
 * Called by {@link codeUnitsOfAnchors} before it groups anchors by long function.
 * @param lines - Complete verified source, indexed from zero.
 * @param anchors - Matching zero-based lines, best first.
 * @param priorityTerms - The identifiers the route reply named, lowercased.
 * @returns The anchors in the same order.
 * @example
 * routeAnchorsOf(['save(a)', 'record'], [0, 1], ['save']) // => [0]
 */
function routeAnchorsOf(
  lines: readonly string[],
  anchors: readonly number[],
  priorityTerms: readonly string[],
): number[] {
  if (!priorityTerms.length) return [...anchors]
  return anchors.filter((anchor) =>
    priorityTerms.some((term) =>
      matchesRouteIdentifier(lines[anchor]!.toLowerCase(), term),
    ),
  )
}

/**
 * Places what an anchor brings besides its own line: its whole code unit ({@link admitUnitOrLine}), or, for the declaration of a route identifier too long for a whole unit that holds route-identifier anchors, its named window ({@link admitNamedWindow}).
 * Why: Cycle 0124 (F3, Issue #318) — the head of P06's route-named `handleContextAction` (lines 1230-1269) took 40 places while its copy and paste cases (1270-1277) held the anchors.
 * Called by {@link codeUnitsOfAnchors} for each ranked anchor.
 * @param build - The excerpt build; an admitted window's declaration line joins its `windowedDeclarations`.
 * @param anchor - The anchor line.
 * @returns `true` when the anchor's whole unit or window was admitted; `false` when only its own line remains to place, a unit too big for the places left included.
 * @example
 * admitUnitOrNamedWindow(build, 0) // => false for `const a = 1` with no route identifier
 */
function admitUnitOrNamedWindow(build: ExcerptBuild, anchor: number): boolean {
  const wholeUnit = codeUnitOfLine(build.lines, anchor)
  // A unit that does not fit leaves the anchor a single line, before which the windows come.
  if (wholeUnit)
    return admitWholeUnit(wholeUnit, build.keptAnchors, build.selected)
  return admitNamedWindow(build, anchor)
}

/**
 * Brings the named window ({@link longFunctionWindowsOf}) of a route-named function too long for a whole unit that holds route-identifier anchors, under the head budget rule ({@link admitHead}). A named function holding none brings its head just before the first single line, after the long functions holding more route identifiers ({@link admitNamedHeads}).
 * Why: Cycle 0124 `/ship` native check — the head of a named function holding none of the other identifiers the reply named (P06's `handleContextAction` for a paste question) filled the places that the function holding them needed.
 * Called by {@link admitUnitOrNamedWindow} at the declaration line's rank, and by {@link admitWindowsBeforeSingleLines} for each named function still waiting.
 * @param build - The excerpt build; an admitted window's declaration line joins its `windowedDeclarations`.
 * @param anchor - A ranked anchor line.
 * @returns `true` when the anchor declares a route identifier too long for a whole unit, the function holds route-identifier anchors, and its window was admitted now; `false` otherwise, a window already in or too big for the places left included.
 * @example
 * admitNamedWindow(build, 0) // => false for `const a = 1` with no route identifier
 */
function admitNamedWindow(build: ExcerptBuild, anchor: number): boolean {
  const { lines, keptAnchors, priorityTerms, selected } = build
  if (!declaresPriorityTerm(lines[anchor]!, priorityTerms)) return false
  const head = longDeclarationHeadOfLine(lines, anchor)
  if (!head || build.windowedDeclarations.has(head[0]!)) return false
  const declarationLine = head[0]!
  const holder = build.windows.find(
    (candidate) => candidate.declarationLine === declarationLine,
  )
  // A named function holding no other route identifier brings its head later, among the clusters.
  if (!holder || !admitHead(holder.namedWindow, keptAnchors, selected))
    return false
  build.windowedDeclarations.add(declarationLine)
  return true
}

/**
 * Brings, just before the first anchor that brings only its own line, the windows of the route-named long functions still waiting, in rank order; then the windows of the long functions holding more route identifiers than {@link WIKI_CONTEXT_NAMED_HEAD_IDENTIFIER_COUNT}, the head of each route-named long function holding no other route identifier ({@link admitNamedHeads}), and the windows of the other long functions holding two or more anchors ({@link admitClusterWindows}).
 * Why: Cycle 0124 `/ship` native check — single-line `const currentFolderId = …` declarations tied with the named `pasteItem` and came first by line order; the clusters they let in filled the excerpt before `pasteItem`'s window, and the answer called what a paste creates unknown. Pass 2: the head of a named function holding no other identifier must not wait behind its callers' windows.
 * Called by {@link codeUnitsOfAnchors} once.
 * @param build - The excerpt build; admitted window lines join its `selected`.
 * @param anchors - Matching zero-based lines, best first.
 * @example
 * admitWindowsBeforeSingleLines(build, [12, 40]) // adds the named window of line 40's long function, then the other windows and named heads in turn
 */
function admitWindowsBeforeSingleLines(
  build: ExcerptBuild,
  anchors: readonly number[],
): void {
  // A function the reply names comes before the functions that only hold the identifiers it names.
  for (const anchor of anchors) {
    if (build.selected.size >= WIKI_CONTEXT_LINE_LIMIT) return
    admitNamedWindow(build, anchor)
  }
  // A named function holding no other identifier counts its own name: the functions holding more come first, the rest after its head.
  admitClusterWindows(
    build,
    (candidate) =>
      candidate.distinctIdentifiers > WIKI_CONTEXT_NAMED_HEAD_IDENTIFIER_COUNT,
  )
  admitNamedHeads(build, anchors)
  admitClusterWindows(
    build,
    (candidate) =>
      candidate.distinctIdentifiers <= WIKI_CONTEXT_NAMED_HEAD_IDENTIFIER_COUNT,
  )
}

/**
 * Brings the window of each long function holding {@link WIKI_CONTEXT_CLUSTER_MIN_ANCHORS} or more route-identifier anchors, best first, under the head budget rule ({@link admitHead}); a function whose window a route-named declaration already brought is skipped.
 * Why: Cycle 0124 (F3, Issue #318) — identifiers named inside P06's `pasteItem`, without its name, left 0 to 6 of the 13 lines that create the pasted bookmark and folder.
 * Called by {@link admitWindowsBeforeSingleLines}, twice: once for the long functions holding more route identifiers than a named head, once for the rest.
 * @param build - The excerpt build; admitted window lines join its `selected`.
 * @param isInTurn - Picks the windows of this turn: those of the long functions holding more route identifiers than a named head counts, or the rest.
 * @example
 * admitClusterWindows(build, (candidate) => candidate.distinctIdentifiers > 1) // adds the window of a long function holding two different route identifiers
 */
function admitClusterWindows(
  build: ExcerptBuild,
  isInTurn: (candidate: LongFunctionWindow) => boolean,
): void {
  const { keptAnchors, selected } = build
  for (const candidate of build.windows) {
    if (selected.size >= WIKI_CONTEXT_LINE_LIMIT) return
    // A lone anchor stays a single line, a window already brought is not brought again, and another turn's window waits.
    if (
      candidate.anchors.length < WIKI_CONTEXT_CLUSTER_MIN_ANCHORS ||
      build.windowedDeclarations.has(candidate.declarationLine) ||
      !isInTurn(candidate)
    )
      continue
    if (admitHead(candidate.window, keptAnchors, selected))
      build.windowedDeclarations.add(candidate.declarationLine)
  }
}

/**
 * Brings the head of each route-named function too long for a whole unit that no window brought yet ({@link admitNamedWindow} brings only those holding route-identifier anchors), in rank order, under the head budget rule ({@link admitHead}).
 * Why: Cycle 0124 `/ship` pass 2 — a route naming only the answering function (P06's `pasteItem` alone, or a `transfer` with two callers) kept 0 of its body lines when its head waited until after every caller's window and call-site line.
 * Called by {@link admitWindowsBeforeSingleLines} between the long functions holding more route identifiers than {@link WIKI_CONTEXT_NAMED_HEAD_IDENTIFIER_COUNT} and the rest.
 * @param build - The excerpt build; an admitted head's declaration line joins its `windowedDeclarations`.
 * @param anchors - Matching zero-based lines, best first.
 * @example
 * admitNamedHeads(build, [0]) // adds lines 0 to 39 of a 60-line function the route named that holds no other route identifier
 */
function admitNamedHeads(
  build: ExcerptBuild,
  anchors: readonly number[],
): void {
  const { lines, keptAnchors, priorityTerms, selected } = build
  for (const anchor of anchors) {
    if (selected.size >= WIKI_CONTEXT_LINE_LIMIT) return
    if (!declaresPriorityTerm(lines[anchor]!, priorityTerms)) continue
    const head = longDeclarationHeadOfLine(lines, anchor)
    // A function whose window or head is already in is not brought again.
    if (!head || build.windowedDeclarations.has(head[0]!)) continue
    if (admitHead(head, keptAnchors, selected))
      build.windowedDeclarations.add(head[0]!)
  }
}

/**
 * Adds an anchor's code unit while the budget allows, and its own line otherwise: always for a kept line, and for another only while the kept lines keep their places.
 * Called by {@link codeUnitsOfAnchors} for an anchor that brings only its own line.
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
  if (admitWholeUnit(unit, keptAnchors, selected)) return
  // Otherwise the anchor's own line comes: a kept line always, another while the kept lines keep their places.
  if (
    keptAnchors.includes(anchor) ||
    selected.size + 1 + waitingKeptCount(keptAnchors, selected, [anchor]) <=
      WIKI_CONTEXT_LINE_LIMIT
  )
    selected.add(anchor)
}

/**
 * Adds a whole code unit when it fits while every kept line not yet selected keeps a place; lines already selected cost nothing.
 * Called by {@link admitUnitOrNamedWindow} for an anchor's unit, and by {@link admitUnitOrLine}.
 * @param unit - The unit's zero-based lines.
 * @param keptAnchors - The anchors whose own lines keep their places ({@link keptAnchorsOf}).
 * @param selected - The lines selected so far; the unit's lines are added to it when it fits.
 * @returns `true` when the unit was added; `false` when it does not fit.
 * @example
 * admitWholeUnit([0, 1, 2], [], new Set()) // => true
 */
function admitWholeUnit(
  unit: readonly number[],
  keptAnchors: readonly number[],
  selected: Set<number>,
): boolean {
  const unitLines = unit.filter((index) => !selected.has(index))
  // A unit is admitted while every kept line not yet selected keeps a place.
  if (
    selected.size +
      unitLines.length +
      waitingKeptCount(keptAnchors, selected, unitLines) >
    WIKI_CONTEXT_LINE_LIMIT
  )
    return false
  for (const index of unitLines) selected.add(index)
  return true
}

/**
 * Counts the kept lines that still wait for a place, leaving out the given lines.
 * Called by {@link admitWholeUnit} and {@link admitUnitOrLine} before they spend places.
 * @param keptAnchors - The anchors whose own lines keep their places ({@link keptAnchorsOf}).
 * @param selected - The lines selected so far.
 * @param excluded - Lines about to be added, which take their own places.
 * @returns How many kept lines are neither selected nor excluded.
 * @example
 * waitingKeptCount([1, 2, 3], new Set([1]), [2]) // => 1
 */
function waitingKeptCount(
  keptAnchors: readonly number[],
  selected: ReadonlySet<number>,
  excluded: readonly number[],
): number {
  return keptAnchors.filter(
    (keptAnchor) => !selected.has(keptAnchor) && !excluded.includes(keptAnchor),
  ).length
}

/**
 * Gives each ranked anchor that begins a function too long for a whole unit the head of that function ({@link longDeclarationHeadOfLine}), after every whole unit is placed, so a whole unit is never displaced by a head. A function whose window is already in (a route-named declaration's or a cluster's) brings no head: its lines outside the window would only take places the fill needs (Cycle 0124 review round).
 * Why: Cycle 0123 (F3, Issue #316) — P06's 44-line `pasteItem` was just over the unit limit, so the excerpt held 2 to 6 of the lines that create the bookmark and the folder.
 * A head follows the unit budget rule: a place stays for every kept line not yet selected, selected lines cost nothing, and the excerpt never passes {@link WIKI_CONTEXT_LINE_LIMIT}. A head that does not fit whole is cut to the space left, declaration line first, when that holds at least {@link WIKI_CONTEXT_HEAD_MIN_LINES} lines; otherwise the anchor stays alone.
 * Called by {@link codeUnitsOfAnchors} after its whole-unit pass and its windows.
 * @param build - The excerpt build: its lines, kept lines and windowed declarations, and the selection the admitted head lines join.
 * @param anchors - Matching zero-based lines, best first.
 * @example
 * admitLongDeclarationHeads(build, [0]) // adds lines 0 to 39 of a 44-line function that begins on line 0
 */
function admitLongDeclarationHeads(
  build: ExcerptBuild,
  anchors: readonly number[],
): void {
  const { lines, keptAnchors, selected, windowedDeclarations } = build
  for (const anchor of anchors) {
    if (selected.size >= WIKI_CONTEXT_LINE_LIMIT) return
    const head = longDeclarationHeadOfLine(lines, anchor)
    // A function whose window is in already shows the lines that hold its anchors.
    if (head && !windowedDeclarations.has(head[0]!))
      admitHead(head, keptAnchors, selected)
  }
}

/**
 * Adds a head to the selection under the unit budget rule.
 * Called by {@link admitUnitOrNamedWindow} for a route identifier's declaration, by {@link admitClusterWindows} for a long function's window, and by {@link admitLongDeclarationHeads} for every other anchor.
 * @param head - A head's or window's zero-based lines, the declaration line first ({@link longDeclarationHeadOfLine}, {@link longFunctionWindowsOf}); `undefined` for an anchor with no head.
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
      matchesRouteIdentifier(lines[index]!.toLowerCase(), term),
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
