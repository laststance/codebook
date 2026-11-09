import { STATIC_PAGE_CDN_HOSTS } from '../constants'

/** The file a CDN URL asks for inside a package: the version it named and the path below the package folder. */
export type CdnPackageRequest = Readonly<{
  /** The version or tag the URL named, as written. */
  version: string
  /** The path below the package folder, decoded, forward slashes, never empty. */
  path: string
}>

/**
 * Tells whether a URL asks a CDN for a file of the declared library, and for which file.
 *
 * Why it exists: the redirect serves the packed checked-out build in place of exactly the requests of the forms `https://unpkg.com/<package>@<version>/<path>` and `https://cdn.jsdelivr.net/npm/<package>@<version>/<path>`; the package name is the declared library's, matched literally (a scoped name included). Called by {@link CdnImportRedirect} for each paused request and by the seal for each CDN import the page names.
 * @param url - The requested URL; query and fragment are dropped before matching.
 * @param packageName - The declared library's package name.
 * @returns The version and path for a match; `undefined` for another host, another package, a URL without `@<version>` or without a path, and for an empty path.
 * @example
 * matchCdnPackageUrl('https://unpkg.com/lib@latest/dist/lib.mjs?x=1', 'lib') // => { version: 'latest', path: 'dist/lib.mjs' }
 * matchCdnPackageUrl('https://cdn.jsdelivr.net/npm/@s/lib@1.0.0/index.js', '@s/lib') // => { version: '1.0.0', path: 'index.js' }
 * matchCdnPackageUrl('https://unpkg.com/lib/dist/lib.mjs', 'lib') // => undefined
 */
export function matchCdnPackageUrl(
  url: string,
  packageName: string,
): CdnPackageRequest | undefined {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return undefined
  }
  const host = STATIC_PAGE_CDN_HOSTS.find(
    (candidate) => candidate.host === parsed.hostname,
  )
  if (parsed.protocol !== 'https:' || host === undefined) return undefined
  if (!parsed.pathname.startsWith(host.prefix)) return undefined
  const afterPrefix = parsed.pathname.slice(host.prefix.length)
  const named = `${packageName}@`
  if (!afterPrefix.startsWith(named)) return undefined
  const rest = afterPrefix.slice(named.length)
  const slash = rest.indexOf('/')
  if (slash <= 0) return undefined
  const version = rest.slice(0, slash)
  let path: string
  try {
    path = decodeURIComponent(rest.slice(slash + 1))
  } catch {
    return undefined
  }
  // A path that climbs out of the package is still a match: the redirect then refuses it as absent.
  if (path === '') return undefined
  return { version, path }
}
