import { CODEBOOK_PANE_VIEW_TYPES } from '../constants'

/**
 * Tells whether a webview tab's view type is one of Codebook's two editor panes, for the Study workspace when it looks for panes an earlier extension host left behind.
 * The view type alone cannot tell a live pane from a dead one; the caller decides that from the panels it owns.
 * @param viewType - The `viewType` of a webview tab as the editor's tab model reports it.
 * @returns `true` for the Application or Study pane, in the registered or the main-thread-prefixed form.
 * @example
 * isCodebookPaneViewType('mainThreadWebview-codebook.scopedBrowser') // => true
 * isCodebookPaneViewType('codebook.repositoryWiki') // => false
 */
export function isCodebookPaneViewType(viewType: string): boolean {
  return CODEBOOK_PANE_VIEW_TYPES.includes(viewType)
}
