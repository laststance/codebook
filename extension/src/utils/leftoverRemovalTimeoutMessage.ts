/**
 * Words the refusal of an entry whose close of an earlier window's leftover Application group the editor did not answer with the group's removal within the bound; thrown by {@link StudyWorkspace.closeLeftoverAsIssuedRemoval} (Cycle 0111, change 2).
 * Both group counts are named, so a recurrence tells a removal that never came (the count unchanged) from another group change that disturbed the count, and the sentence ends with what the learner can do.
 * @param groupsBefore - How many groups the editor named before Codebook's close.
 * @param groupsNow - How many groups the editor named when the bound passed.
 * @param boundMs - The bound that passed.
 * @returns The refusal.
 * @example
 * leftoverRemovalTimeoutMessage(3, 4, 5000) // => 'Timed out waiting for leftover Application group removal (groups before the close: 3, now: 4, after 5000 ms). Run "Codebook: Open Study Workspace" again.'
 */
export function leftoverRemovalTimeoutMessage(
  groupsBefore: number,
  groupsNow: number,
  boundMs: number,
): string {
  return `Timed out waiting for leftover Application group removal (groups before the close: ${groupsBefore}, now: ${groupsNow}, after ${boundMs} ms). Run "Codebook: Open Study Workspace" again.`
}
