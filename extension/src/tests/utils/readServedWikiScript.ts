import { serveMinimalWiki } from './serveMinimalWiki'

/**
 * Reads the page script exactly as a started reader serves it, so page tests run what the browser gets.
 *
 * @returns The text of `codebook-qa.js`.
 *
 * @example
 * ```ts
 * const page = await openFakeWikiPage(await readServedWikiScript(), 'current-shell')
 * ```
 */
export async function readServedWikiScript(): Promise<string> {
  const wiki = await serveMinimalWiki()
  try {
    const response = await fetch(new URL('codebook-qa.js', wiki.reader.url))
    return await response.text()
  } finally {
    await wiki.close()
  }
}
