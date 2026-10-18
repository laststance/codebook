/** Why the Wiki reader did not serve a page: its preparation passed the deadline, or the worker that prepared it failed. */
export type WikiPageRefusalReason = 'deadline' | 'failed'

/**
 * Prints the page the Wiki reader answers instead of a page it could not prepare, with one plain sentence for the learner: what happened and how to get the page back. It names no path and no error, so it shows nothing of the project.
 * Called by the Wiki reader when {@link servedWikiPageOffThread} answers without a page; the reader serves it with status 503 and the policy of every served page, which it needs no exception from (no script, no style).
 * @param reason - Why the page is not served.
 * @param deadlineMs - The deadline the preparation had, written in the sentence in seconds.
 * @returns A whole HTML document.
 * @example
 * wikiPageRefusalHtml('deadline', 10_000) // => '<!doctype html>…<p>Codebook stopped preparing this page after 10 seconds. …</p>…'
 */
export function wikiPageRefusalHtml(
  reason: WikiPageRefusalReason,
  deadlineMs: number,
): string {
  const sentence =
    reason === 'deadline'
      ? `Codebook stopped preparing this page after ${deadlineMs / 1_000} seconds. No page of a Wiki needs that long, so its file may have been changed by hand. Generate the Wiki again to replace the page.`
      : 'Codebook could not prepare this page for reading. Generate the Wiki again to replace the page.'
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Page not shown</title></head><body><p>${sentence}</p></body></html>`
}
