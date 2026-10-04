/** The part of a confirmed Study layout that a status read found changed. */
export type ChangedLayoutPart = 'grid' | 'groups'

const CHANGED_LAYOUT_PARTS: Record<ChangedLayoutPart, string> = {
  grid: 'the editor grid no longer has the sizes of the confirmed layout',
  groups:
    'an editor group was opened, closed, moved or replaced since the layout was confirmed',
}

/**
 * Words the reason of a Study arrangement that is not confirmed, for the presentation state {@link StudyWorkspace} gives a learner and an agent.
 * A status read that found the confirmed grid or its editor groups changed names the comparison that failed; every other unconfirmed state gets the sentence without it (a moved pane has its own reasons).
 * @param changedPart - The comparison of the confirmed layout that failed, or `undefined` when no status read named one.
 * @returns What Codebook observed, and what the reader does next.
 * @example
 * unconfirmedLayoutReason('grid')
 * // => 'The Study arrangement is not confirmed: the editor grid no longer has the sizes of the confirmed layout. Focus the existing Study or Application pane, then restore its layout. Opening Repository Wiki does not repair Study.'
 * unconfirmedLayoutReason(undefined)
 * // => 'The Study arrangement is not confirmed. Focus the existing Study or Application pane, then restore its layout. Opening Repository Wiki does not repair Study.'
 */
export function unconfirmedLayoutReason(
  changedPart: ChangedLayoutPart | undefined,
): string {
  return `The Study arrangement is not confirmed${changedPart ? `: ${CHANGED_LAYOUT_PARTS[changedPart]}` : ''}. Focus the existing Study or Application pane, then restore its layout. Opening Repository Wiki does not repair Study.`
}
