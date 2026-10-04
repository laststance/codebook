import { serveMinimalWiki } from './serveMinimalWiki'

/**
 * Reads the page script exactly as a started reader serves it, so page tests run what the browser gets.
 *
 * @param servedWiki - A Wiki the caller serves and closes itself; when omitted the helper serves a minimal one and closes it.
 * @returns The text of `codebook-qa.js`.
 * @throws When the reader answers the script's address with an error status; the message names the status, so the page tests stop there instead of running an error body as the page script.
 *
 * @example
 * ```ts
 * const page = await openFakeWikiPage(await readServedWikiScript(), 'current-shell')
 * ```
 */
export async function readServedWikiScript(
  servedWiki?: Awaited<ReturnType<typeof serveMinimalWiki>>,
): Promise<string> {
  const wiki = servedWiki ?? (await serveMinimalWiki())
  try {
    const response = await fetch(new URL('codebook-qa.js', wiki.reader.url))
    // An error answer is JSON: run as the page script it would fail every page test with a syntax error that names no cause.
    if (!response.ok)
      throw new Error(
        `The Wiki reader answered ${response.status} for codebook-qa.js, so the page tests have no page script to run. Check the reader's route for that file.`,
      )
    return await response.text()
  } finally {
    // A Wiki the caller served is the caller's to close.
    if (!servedWiki) await wiki.close()
  }
}
