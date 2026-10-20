import { WIKI_ENTRY_FILE } from '../constants'

import { escapeHtml } from './escapeHtml'

/** Why the Wiki reader did not serve a page: its preparation passed the deadline, the worker that prepared it failed, its file is larger than the reader prepares ({@link WIKI_PAGE_FILE_LIMIT_BYTES}, `too-large`), its preparation needs more heap than a page worker may use ({@link WIKI_PAGE_WORKER_HEAP_LIMIT_MB}, `memory-limit`), or the reader held as many pages as its page workers prepare and let wait ({@link WIKI_PAGE_WAITING_LIMIT}). */
export type WikiPageRefusalReason =
  'deadline' | 'failed' | 'too-large' | 'memory-limit' | 'busy'

/** The sentence of each reason a page is not served, given the deadline in seconds, which only the deadline's sentence names; a record, so every reason has a sentence of its own and a new reason cannot fall into another's. */
const REFUSAL_SENTENCES: Record<
  WikiPageRefusalReason,
  (deadlineSeconds: number) => string
> = {
  deadline: (deadlineSeconds) =>
    `Codebook stopped preparing this page after ${deadlineSeconds} seconds. No page of a Wiki needs that long, so its file may have been changed by hand. Restore the page or move your change aside, then press Update LLM Wiki.`,
  'too-large': () =>
    'This page is too large for Codebook to prepare for reading. An earlier Codebook may have published a page this large, or its file may have been changed by hand. If you changed it, restore the page or move your change aside, then press Update LLM Wiki; otherwise ask the editor chat to split it into smaller pages and update the Wiki.',
  'memory-limit': () =>
    'This page needs more memory than Codebook gives one page to prepare it for reading. Ask the editor chat to split it into smaller pages and update the Wiki; Update LLM Wiki alone renders the same page again.',
  failed: () =>
    'Codebook could not prepare this page for reading. Reload the page; if it is still not shown, press Update LLM Wiki.',
  busy: () =>
    'Codebook is preparing as many pages as it can at once, so it did not prepare this one. Reload the page in a moment.',
}

/**
 * Prints the page the Wiki reader answers instead of a page it could not prepare, with one plain sentence for the learner: what happened and how to get the page back, and a link to the Wiki's overview, so reading goes on as it does after a page the Wiki no longer has. The overview's own refusal page has no such link, which would only open the same refusal again; its sentence names the next step. It names no path and no error, so it shows nothing of the project.
 * A page refused as `busy` waits for nothing but a free place, so its sentence advises a reload in a moment. A worker fails also for a cause outside the page (its file did not load, it exited), so the sentence for `failed` does not blame the page: it advises a reload first, and Update LLM Wiki only when the page is still not shown. A page that passed the deadline is one built to make the parser slow, so its file may have been changed by hand; the update refuses to replace a page changed by hand, so its sentence advises restoring the page or moving the change aside before Update LLM Wiki. A page file too large to prepare is larger than the publisher of this build writes (its renderer, `render-wiki.mjs`, refuses a page above {@link WIKI_PAGE_FILE_LIMIT_BYTES} and tells the agent to split it), but the publisher of 0.2.30.0 and earlier wrote a page of any size, which the reader of 0.2.30.0 read up to 8 MB and earlier readers read whole, whatever its size; so its sentence names both causes, an earlier Codebook or a hand edit, and gives each its step: restoring the page or moving the change aside before Update LLM Wiki, or else asking the editor chat to split the page into smaller ones and update the Wiki. A page whose preparation needs more heap than a page worker may use lies within that limit and can be one the publisher wrote (dense with tags), which an update renders the same again; so its sentence blames no hand edit and asks the editor chat to split the page into smaller ones, as the editor's other messages ask the editor chat for a change an update alone does not make. Every next step names Update LLM Wiki, as the editor's other Wiki messages do.
 * Called by the Wiki reader when {@link servedWikiPageOffThread} answers without a page (a worker past its heap limit is answered as `memory-limit`), for a page file larger than {@link WIKI_PAGE_FILE_LIMIT_BYTES} (at the look at its size, or when its read passes the limit), and as `busy` before the page's file is read when every place for pages in hand is taken ({@link takeWikiPagePlace}); the reader serves it with status 503 and the policy of every served page, which it needs no exception from (no script, no style).
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
