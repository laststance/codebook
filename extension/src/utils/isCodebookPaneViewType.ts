import {
  CODEBOOK_PANE_VIEW_TYPES,
  MAIN_THREAD_WEBVIEW_PREFIX,
} from '../constants'

/**
 * Tells whether a webview tab's view type is a Codebook editor pane, in the registered or the main-thread-prefixed form; the one matcher for the Study workspace and the browser viewport wherever they ask which pane a tab is.
 * The view type alone cannot tell a live pane from one an earlier extension host left behind; the caller decides that from the panels it owns.
 * @param viewType - The `viewType` of a webview tab as the editor's tab model reports it.
 * @param kinds - The registered view types to match; every Codebook pane (Application, Study, Repository Wiki) when none is given.
 * @returns `true` when the tab is a pane of one of `kinds`.
 * @example
 * isCodebookPaneViewType('mainThreadWebview-codebook.repositoryWiki') // => true
 * isCodebookPaneViewType('codebook.studyContext', 'codebook.scopedBrowser') // => false
 * isCodebookPaneViewType('mainThreadWebview-markdown.preview') // => false
 */
export function isCodebookPaneViewType(
  viewType: string,
  ...kinds: string[]
): boolean {
  return (kinds.length ? kinds : CODEBOOK_PANE_VIEW_TYPES).some(
    (kind) =>
      viewType === kind || viewType === `${MAIN_THREAD_WEBVIEW_PREFIX}${kind}`,
  )
}
