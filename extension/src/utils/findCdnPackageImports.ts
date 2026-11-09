import { matchCdnPackageUrl } from './matchCdnPackageUrl'
import { readStaticPageHtml } from './readStaticPageHtml'

/** One CDN file of the declared library that a page names: the address as written and the path below the package folder. */
export type CdnPackageImport = Readonly<{ url: string; path: string }>

/** A CDN address inside a script text: a quoted or bare `https://unpkg.com/…` or `https://cdn.jsdelivr.net/…` URL. */
const CDN_ADDRESS = /https:\/\/(?:unpkg\.com|cdn\.jsdelivr\.net)\/[^\s'"`)<>]+/g

/**
 * Lists every CDN address a page names, in document order: its `<script src>` values and the unpkg and jsDelivr addresses inside its inline scripts.
 * Called by {@link findCdnPackageImports} and by the run, which tells the learner that a page without `library` loads a published copy.
 * @param html - The entry page's text.
 * @param scriptTexts - The texts of the same-origin script files the page loads (one level), scanned after the page.
 * @returns The distinct addresses.
 * @example findCdnAddresses('<script src="https://unpkg.com/x@1/a.js"></script>') // => ['https://unpkg.com/x@1/a.js']
 * @example findCdnAddresses('<script src="app.js"></script>', ['import "https://unpkg.com/x@1/a.js"']) // => ['https://unpkg.com/x@1/a.js']
 */
export function findCdnAddresses(
  html: string,
  scriptTexts: readonly string[] = [],
): string[] {
  const page = readStaticPageHtml(html)
  const addresses = [
    ...page.scriptSources.filter((source) =>
      new RegExp(CDN_ADDRESS.source).test(source),
    ),
    ...page.inlineScripts.flatMap((script) =>
      [...script.text.matchAll(CDN_ADDRESS)].map((match) => match[0]),
    ),
    ...scriptTexts.flatMap((text) =>
      [...text.matchAll(CDN_ADDRESS)].map((match) => match[0]),
    ),
  ]
  return [...new Set(addresses)]
}

/**
 * Lists the CDN files of the declared library that a page names, in document order.
 *
 * Why it exists: the library stop is sealed before the page runs, so the seal needs to know which packed files the page will load in place of the CDN ones; it reads them from the page's inline scripts and `<script src>` addresses (one level deep, as readiness does). Called by the library seal.
 * @param html - The entry page's text.
 * @param packageName - The library's package name.
 * @param scriptTexts - The texts of the same-origin script files the page loads (one level), so an `app.js` that imports the library from a CDN counts.
 * @returns Each distinct matching address with its package path.
 * @example
 * findCdnPackageImports('<script type="module">import {a} from "https://unpkg.com/lib@latest/dist/lib.mjs"</script>', 'lib') // => [{ url: 'https://unpkg.com/lib@latest/dist/lib.mjs', path: 'dist/lib.mjs' }]
 */
export function findCdnPackageImports(
  html: string,
  packageName: string,
  scriptTexts: readonly string[] = [],
): CdnPackageImport[] {
  return findCdnAddresses(html, scriptTexts).flatMap((url) => {
    const request = matchCdnPackageUrl(url, packageName)
    return request === undefined ? [] : [{ url, path: request.path }]
  })
}
