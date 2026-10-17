/**
 * Moves a retained native focus onto the group the editor names while the Repository Wiki reader shows a citation's copy without the keyboard for an agent's read of the open Wiki, when only the named group changed and the text editor did not; called by {@link RepositoryReader.retainNativeFocus} on every native notification after its focus is established (Cycle 0046 row 696).
 * The copy comes to the front of the first group, and Cursor 3.23.12 answers the tab it opened with a rebuild of its tab model, which names the group its editor groups service holds active (`workbench.desktop.main.js` 17269:31013): beside its chat part, after Focus Agent, that is the chat part's group, also when the extension host still named a main group (C60 c60-cu-7d2: the show at 149 ms moved the name from the stale group 1 to the chat part's group 3 at 153 ms, while the chat input kept the keyboard). Neither change is the learner's; the reader says which states its own show explains ({@link RepositoryReader.isOwnQuietCopyShowPlace}). A learner's choice of a file, a selection, or another pane changes the text editor or names a group the show does not explain, and stays a change.
 * @param retained - The focus the navigation retains, recorded as a serialized editor and group; undefined while none is established.
 * @param current - The focus the editor reports now, recorded the same way.
 * @param explainedByOwnShow - Whether the reader's own quiet copy show explains the group the editor names now.
 * @returns
 * - The retained focus with the current group, when only the group changed and the reader's show explains it
 * - The retained focus unchanged otherwise, including undefined
 * @example
 * const chat = { editor: '[null,null,null,null]', group: '[1,"module.ts",{"uri":"…/module.ts"}]' }
 * adoptOwnQuietCopyShow(chat, { ...chat, group: '[3,"New Agent",null]' }, true) // => { editor: '[null,null,null,null]', group: '[3,"New Agent",null]' }
 * adoptOwnQuietCopyShow(chat, { editor: '["file:///auth.ts",1,2,[]]', group: '[2,"auth.ts",{}]' }, true) // => chat, unchanged
 */
export function adoptOwnQuietCopyShow<
  Focus extends { editor: string; group: string },
>(
  retained: Focus | undefined,
  current: Focus,
  explainedByOwnShow: boolean,
): Focus | undefined {
  // Only the named group may change, to one the reader's own show explains, while the text editor stays as it was.
  if (
    !retained ||
    !explainedByOwnShow ||
    current.editor !== retained.editor ||
    current.group === retained.group
  )
    return retained
  return { ...retained, group: current.group }
}
