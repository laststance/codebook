/** One editor group as {@link groupCreatedAtColumn} compares it: its column and its identity (`undefined` for a group not yet named). */
type IdentifiedGroup = { viewColumn: number; identity: symbol | undefined }

/**
 * Names the group the editor created at a column for a native effect of Codebook's, so that {@link StudyWorkspace} can track it as its own; called once the captured source was shown at a column beyond the main grid, for which the editor adds a group (finding 597).
 * A group is named only when no group stood at that column before the effect and its identity is new: a group that was there already, a learner's or another one of Codebook's, is never named, also when the editor gave it a new object.
 * @param groupsBefore - The editor's groups just before the effect.
 * @param groupsAfter - The editor's groups just after the effect.
 * @param column - The column the effect targeted.
 * @returns
 * - The identity of the group now at that column, when that column held no group before and no group had that identity
 * - `undefined` otherwise
 * @example
 * groupCreatedAtColumn([{ viewColumn: 1, identity: claimed }, { viewColumn: 2, identity: learner }], [{ viewColumn: 1, identity: claimed }, { viewColumn: 2, identity: learner }, { viewColumn: 3, identity: sourceGroup }], 3) // => sourceGroup
 * groupCreatedAtColumn([{ viewColumn: 1, identity: claimed }, { viewColumn: 2, identity: learner }], [{ viewColumn: 1, identity: claimed }, { viewColumn: 2, identity: learner }], 2) // => undefined
 */
export function groupCreatedAtColumn(
  groupsBefore: readonly IdentifiedGroup[],
  groupsAfter: readonly IdentifiedGroup[],
  column: number,
): symbol | undefined {
  const identity = groupsAfter.find(
    (group) => group.viewColumn === column,
  )?.identity
  return identity &&
    !groupsBefore.some(
      (group) => group.viewColumn === column || group.identity === identity,
    )
    ? identity
    : undefined
}
