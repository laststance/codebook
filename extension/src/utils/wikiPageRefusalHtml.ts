import { WIKI_ENTRY_FILE } from '../constants'

import { escapeHtml } from './escapeHtml'

/** Why the Wiki reader did not serve a page: its preparation passed the deadline, or the worker that prepared it failed. */
export type WikiPageRefusalReason = 'deadline' | 'failed'

/**
 * Prints the page the Wiki reader answers instead of a page it could not prepare, with one plain sentence for the learner: what happened and how to get the page back, and a link to the Wiki's overview, so reading goes on as it does after a page the Wiki no longer has. It names no path and no error, so it shows nothing of the project.
 * A worker fails also for a cause outside the page (its file did not load, it exited), so the sentence for `failed` does not blame the page: it advises a reload first, and generating the Wiki again only when the page is still not shown. A page that passed the deadline is one built to make the parser slow, which no generated page is, so that sentence advises generating the Wiki again.
 * Called by the Wiki reader when {@link servedWikiPageOffThread} answers without a page; the reader serves it with status 503 and the policy of every served page, which it needs no exception from (no script, no style).
 * @param reason - Why the page is not served.
 * @param deadlineMs - The deadline the preparation had, written in the sentence in seconds.
 * @param readerPrefix - The path under which the reader serves this Wiki (`/w/<token>/`), where its overview is; printed escaped ({@link escapeHtml}).
 * @returns A whole HTML document.
 * @example
 * wikiPageRefusalHtml('deadline', 10_000, '/w/0f/') // => '<!doctype html>…<p>Codebook stopped preparing this page after 10 seconds. …</p><p><a href="/w/0f/index.html">Open the Wiki’s overview</a></p>…'
 */
export function wikiPageRefusalHtml(
  reason: WikiPageRefusalReason,
  deadlineMs: number,
  readerPrefix: string,
): string {
  const sentence =
    reason === 'deadline'
      ? `Codebook stopped preparing this page after ${deadlineMs / 1_000} seconds. No page of a Wiki needs that long, so its file may have been changed by hand. Generate the Wiki again to replace the page.`
      : 'Codebook could not prepare this page for reading. Reload the page; if it is still not shown, generate the Wiki again.'
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Page not shown</title></head><body><p>${sentence}</p><p><a href="${escapeHtml(readerPrefix)}${WIKI_ENTRY_FILE}">Open the Wiki’s overview</a></p></body></html>`
}
