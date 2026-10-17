import type { TabGroup, TextEditor } from 'vscode'

import { isCodebookPaneViewType } from './isCodebookPaneViewType'

/**
 * Tells whether the editor's active group shows this host's live Repository Wiki pane while a text editor still has the keyboard: the state the editor reports when it selects the Wiki's group by itself (Cycle 0046 finding 606: right after Study Close, while the cold arrangement had given the first group's text editor the keyboard), and not when the learner clicks into the Wiki, which takes the text editor away; asked by {@link StudyWorkspace.retainPresentationPlacement} on every check of a receipt, for {@link adoptWikiGroupReturn}.
 * @param accepts - Whether the asking receipt adopts that return at all; only the borrow receipt of {@link StudyWorkspace.readMainEditorGrid} does.
 * @param editor - The active text editor now.
 * @param group - The active tab group now; its selected tab is read as a webview by its view type, which no other Codebook tab input carries.
 * @param wikiOpen - Answers whether the Repository Wiki reader owns a live pane, so a Wiki pane an earlier extension host left behind is not taken for it; asked last, only for a Wiki tab.
 * @returns
 * - `true` when the receipt accepts, a text editor is active, the selected tab is a Repository Wiki pane and the reader owns a live one
 * - `false` otherwise
 * @example
 * isWikiGroupBesideTextEditor(true, sourceEditor, wikiGroup, () => true)  // => true
 * isWikiGroupBesideTextEditor(true, undefined, wikiGroup, () => true)     // => false: the keyboard moved into the Wiki
 * isWikiGroupBesideTextEditor(true, sourceEditor, wikiGroup, () => false) // => false: a leftover Wiki pane
 * isWikiGroupBesideTextEditor(false, sourceEditor, wikiGroup, () => true) // => false: this receipt adopts nothing
 */
export function isWikiGroupBesideTextEditor(
  accepts: boolean,
  editor: TextEditor | undefined,
  group: Pick<TabGroup, 'activeTab'>,
  wikiOpen: () => boolean,
): boolean {
  const input: unknown = group.activeTab?.input
  return (
    accepts &&
    editor !== undefined &&
    typeof input === 'object' &&
    input !== null &&
    'viewType' in input &&
    typeof input.viewType === 'string' &&
    isCodebookPaneViewType(input.viewType, 'codebook.repositoryWiki') &&
    wikiOpen()
  )
}
