/**
 * Moves a retained native focus onto the Repository Wiki's group when the editor selected only that group and left the retained text editor untouched; called by {@link RepositoryReader.retainNativeFocus} on every native notification after its focus is established, and by {@link StudyWorkspace.retainPresentationPlacement} on every check of a presentation receipt (only its borrow receipt in {@link StudyWorkspace.readMainEditorGrid} ever passes `true`, through {@link isWikiGroupBesideTextEditor}).
 * The editor can select the Wiki's group by itself while the keyboard stays in the text editor (Cycle 0046 row 444: right after Study Close, the group went back to the Wiki while activeTextEditor still named the cited source the navigation had opened; finding 606: the same return landed while the cold arrangement measured the main grid beside the text editor it had given the keyboard), and that carries no newer learner input. A learner who chooses the Wiki moves the keyboard into it, which the editor reports as the loss of the text editor, so that choice, a selection, another editor and another group still differ from the returned focus.
 * @param retained - The focus the navigation or the receipt retains: a serialized editor receipt and a group receipt (the reader's serialized group, the Study workspace's group identity); undefined while a cited source is not established yet.
 * @param current - The focus the editor reports now, recorded the same way.
 * @param wikiSelectedBesideTextEditor - Whether the now active group's selected tab is the reader's own Wiki pane while a text editor is still active.
 * @returns
 * - The retained focus with the Wiki's group, when the Wiki is selected beside the same text editor and only the group changed
 * - The retained focus unchanged otherwise, including undefined
 * @example
 * const source = { editor: '["codebook-repository-source://w/a",1,1]', group: '[1,"module.ts"]' }
 * adoptWikiGroupReturn(source, { ...source, group: '[2,"Wiki"]' }, true) // => { editor: '["codebook-repository-source://w/a",1,1]', group: '[2,"Wiki"]' }
 * adoptWikiGroupReturn(source, { editor: '[null,null,null]', group: '[2,"Wiki"]' }, false) // => source, unchanged
 */
export function adoptWikiGroupReturn<
  Focus extends { editor: string; group: unknown },
>(retained: Focus, current: Focus, wikiSelectedBesideTextEditor: boolean): Focus
export function adoptWikiGroupReturn<
  Focus extends { editor: string; group: unknown },
>(
  retained: Focus | undefined,
  current: Focus,
  wikiSelectedBesideTextEditor: boolean,
): Focus | undefined
export function adoptWikiGroupReturn<
  Focus extends { editor: string; group: unknown },
>(
  retained: Focus | undefined,
  current: Focus,
  wikiSelectedBesideTextEditor: boolean,
): Focus | undefined {
  // Only the selected group may change, to the Wiki, while the identical text editor keeps the keyboard.
  if (
    !retained ||
    !wikiSelectedBesideTextEditor ||
    current.editor !== retained.editor ||
    current.group === retained.group
  )
    return retained
  return { ...retained, group: current.group }
}
