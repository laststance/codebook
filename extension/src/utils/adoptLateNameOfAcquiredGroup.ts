/**
 * Moves a retained native focus onto the group the editor names late for an acquired navigation target, once, when the receipt took the target under the editor's stale name of another group; called by {@link RepositoryReader.retainNativeFocus} on every native notification after its focus is established (Cycle 0046 row 660).
 * Cursor goes on naming its chat part's group after the first group's focus beside it, until its tab model is rebuilt (Cursor 3.23.12 `workbench.desktop.main.js` 17269:31013): a receipt that accepted the target under that stale name sees the target's own group named later, which is no newer input of the learner's. Only that one change is followed: the text editor must be the same, both of the target's matchers must still hold, and the target must no longer hold through the stale name.
 * @param retained - The focus the navigation retains, recorded as a serialized editor and group; undefined while the target is not established yet.
 * @param current - The focus the editor reports now, recorded the same way.
 * @param target - The navigation's target, or undefined for a navigation without one.
 * @param staleNameAccepted - Whether the receipt took the target under the editor's stale name and has not followed the late name yet.
 * @returns
 * - `{ retained: <retained with the current group>, staleNameAccepted: false }` for that one late naming
 * - `{ retained, staleNameAccepted }` unchanged otherwise
 * @example
 * const source = { editor: '["codebook-repository-source://w/a",1,1]', group: '[3,"New Agent"]' }
 * adoptLateNameOfAcquiredGroup(source, { ...source, group: '[1,"module.ts"]' }, target, true) // => { retained: { editor: '["codebook-repository-source://w/a",1,1]', group: '[1,"module.ts"]' }, staleNameAccepted: false }
 */
export function adoptLateNameOfAcquiredGroup<
  Focus extends { editor: string; group: string },
>(
  retained: Focus | undefined,
  current: Focus,
  target:
    | {
        matchesEditor(): boolean
        matchesGroup(): boolean
        namesStaleGroup?: () => boolean
      }
    | undefined,
  staleNameAccepted: boolean,
): { retained: Focus | undefined; staleNameAccepted: boolean } {
  // Only the group may change, to the target's own one, with the same text editor and no stale name left.
  const followsLateName =
    retained !== undefined &&
    target !== undefined &&
    staleNameAccepted &&
    current.editor === retained.editor &&
    current.group !== retained.group &&
    target.matchesEditor() &&
    target.matchesGroup() &&
    !target.namesStaleGroup?.()
  if (!followsLateName) return { retained, staleNameAccepted }
  return {
    retained: { ...retained, group: current.group },
    staleNameAccepted: false,
  }
}
