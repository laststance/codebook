/** What Codebook saw after it closed an earlier window's leftover Application group: the removal and its delay, or no removal within the bound. */
export type LeftoverRemovalOutcome =
  { seenAfterMs: number } | { boundMs: number; groupsNow: number }

/**
 * Words the Output › Codebook line written after Codebook closed an earlier window's leftover Application group, so a first Open after a window reload that waits or times out tells what the editor did; called by {@link StudyWorkspace.closeLeftoverAsIssuedRemoval} (Cycle 0111, change 0).
 * The line holds only numbers: the leftover's column, the group count before the close, and the removal's delay or the bound and the count at its end; no path or tab label.
 * @param column - The leftover group's editor column (1-based).
 * @param groupsBefore - How many groups the editor named before the close.
 * @param outcome - The removal's delay, or the bound that passed with the group count then.
 * @returns The line.
 * @example
 * leftoverRemovalLine(2, 3, { seenAfterMs: 140 }) // => 'Leftover Application group: closed column 2 of 3 groups; removal seen after 140 ms'
 * leftoverRemovalLine(2, 3, { boundMs: 5000, groupsNow: 3 }) // => 'Leftover Application group: closed column 2 of 3 groups; removal not seen within 5000 ms (groups now 3)'
 */
export function leftoverRemovalLine(
  column: number,
  groupsBefore: number,
  outcome: LeftoverRemovalOutcome,
): string {
  const closed = `Leftover Application group: closed column ${column} of ${groupsBefore} groups`
  // A seen removal names its delay; a missed one names the bound and what the editor showed when it passed.
  return 'seenAfterMs' in outcome
    ? `${closed}; removal seen after ${outcome.seenAfterMs} ms`
    : `${closed}; removal not seen within ${outcome.boundMs} ms (groups now ${outcome.groupsNow})`
}
