import type { CdnPackageImport } from './findCdnPackageImports'
import { matchCdnPackageUrl } from './matchCdnPackageUrl'

/** A relative specifier of a script: `from './x'`, a bare `import './x'` or `import('./x')`. */
const RELATIVE_SPECIFIER =
  /(?:\bfrom\s*|\bimport\s*\(?\s*)(['"])(\.{1,2}\/[^'"\n]+)\1/g

/**
 * Lists the CDN files a packed script imports by relative specifier, each resolved against the importer's address.
 * Called by {@link followPackedRelativeImports} for each file it reads.
 * @param text - The packed script's text.
 * @param importerUrl - The CDN address the browser asks for the script by.
 * @param packageName - The library's package name.
 * @returns The distinct files of the library, in text order; a specifier that leaves the package's CDN folder is dropped.
 * @example listRelativePackedImports("import './chunk.mjs'", 'https://unpkg.com/lib@1/dist/lib.mjs', 'lib') // => [{ url: 'https://unpkg.com/lib@1/dist/chunk.mjs', path: 'dist/chunk.mjs' }]
 */
export function listRelativePackedImports(
  text: string,
  importerUrl: string,
  packageName: string,
): CdnPackageImport[] {
  const found = new Map<string, CdnPackageImport>()
  for (const match of text.matchAll(RELATIVE_SPECIFIER)) {
    const specifier = match[2]
    if (specifier === undefined) continue
    const url = URL.canParse(specifier, importerUrl)
      ? new URL(specifier, importerUrl).href
      : undefined
    const request =
      url === undefined ? undefined : matchCdnPackageUrl(url, packageName)
    if (url !== undefined && request !== undefined && !found.has(url))
      found.set(url, { url, path: request.path })
  }
  return [...found.values()]
}
