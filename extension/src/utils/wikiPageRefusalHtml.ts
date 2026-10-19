import { WIKI_ENTRY_FILE } from '../constants'

import { escapeHtml } from './escapeHtml'

/** Why the Wiki reader did not serve a page: its preparation passed the deadline, the worker that prepared it failed, it is too large (its file is larger than the reader prepares, {@link WIKI_PAGE_FILE_LIMIT_BYTES}, or its preparation needs more heap than a page worker may use, {@link WIKI_PAGE_WORKER_HEAP_LIMIT_MB}), or the reader held as many pages as its page workers prepare and let wait ({@link WIKI_PAGE_WAITING_LIMIT}). */
export type WikiPageRefusalReason = 'deadline' | 'failed' | 'too-large' | 'busy'

/** The sentence of each reason a page is not served, given the deadline in seconds, which only the deadline's sentence names; a record, so every reason has a sentence of its own and a new reason cannot fall into another's. */
const REFUSAL_SENTENCES: Record<
  WikiPageRefusalReason,
  (deadlineSeconds: number) => string
> = {
  deadline: (deadlineSeconds) =>
    `Codebook stopped preparing this page after ${deadlineSeconds} seconds. No page of a Wiki needs that long, so its file may have been changed by hand. Restore the page or move your change aside, then press Update LLM Wiki.`,
  'too-large': () =>
    'This page is too large for Codebook to prepare for reading. No page of a Wiki is that large, so its file may have been changed by hand. Restore the page or move your change aside, then press Update LLM Wiki.',
  failed: () =>
    'Codebook could not prepare this page for reading. Reload the page; if it is still not shown, press Update LLM Wiki.',
  busy: () =>
    'Codebook is preparing as many pages as it can at once, so it did not prepare this one. Reload the page in a moment.',
}

/**
 * Prints the page the Wiki reader answers instead of a page it could not prepare, with one plain sentence for the learner: what happened and how to get the page back, and a link to the Wiki's overview, so reading goes on as it does after a page the Wiki no longer has. The overview's own refusal page has no such link, which would only open the same refusal again; its sentence names the next step. It names no path and no error, so it shows nothing of the project.
 * A page refused as `busy` waits for nothing but a free place, so its sentence advises a reload in a moment. A worker fails also for a cause outside the page (its file did not load, it exited), so the sentence for `failed` does not blame the page: it advises a reload first, and Update LLM Wiki only when the page is still not shown. A page that passed the deadline is one built to make the parser slow, and a page file too large to prepare is far larger than any generated page, so its file may have been changed by hand; the update refuses to replace a page changed by hand, so these two sentences advise restoring the page or moving the change aside before Update LLM Wiki. Every next step names Update LLM Wiki, as the editor's other Wiki messages do.
 * Called by the Wiki reader when {@link servedWikiPageOffThread} answers without a page (a worker past its heap limit is answered as too large), and for a page file larger than {@link WIKI_PAGE_FILE_LIMIT_BYTES}; the reader serves it with status 503 and the policy of every served page, which it needs no exception from (no script, no style).
 * @param reason - Why the page is not served.
 * @param deadlineMs - The deadline the preparation had, written in the sentence in seconds.
 * @param readerPrefix - The path under which the reader serves this Wiki (`/w/<token>/`), where its overview is; printed escaped ({@link escapeHtml}).
 * @param pagePath - The refused page's path in the Wiki folder; for the overview ({@link WIKI_ENTRY_FILE}) the link to the overview is left out.
 * @returns A whole HTML document.
 * @example
 * wikiPageRefusalHtml('deadline', 10_000, '/w/0f/', 'guide.html') // => '<!doctype html>…<p>Codebook stopped preparing this page after 10 seconds. …</p><p><a href="/w/0f/index.html">Open the Wiki’s overview</a></p>…'
 * wikiPageRefusalHtml('deadline', 10_000, '/w/0f/', 'index.html') // => '<!doctype html>…<p>Codebook stopped preparing this page after 10 seconds. …</p></body></html>'
 */
export function wikiPageRefusalHtml(
  reason: WikiPageRefusalReason,
  deadlineMs: number,
  readerPrefix: string,
  pagePath: string,
): string {
  const sentence = REFUSAL_SENTENCES[reason](deadlineMs / 1_000)
  // The overview's own refusal page would link to itself.
  const overviewLink =
    pagePath === WIKI_ENTRY_FILE
      ? ''
      : `<p><a href="${escapeHtml(readerPrefix)}${WIKI_ENTRY_FILE}">Open the Wiki’s overview</a></p>`
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Page not shown</title></head><body><p>${sentence}</p>${overviewLink}</body></html>`
}
