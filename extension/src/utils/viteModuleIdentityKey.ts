import { VITE_CACHE_BUSTING_QUERY_PARAMS } from '../constants'

/**
 * Builds the key that tells whether two served Vite URLs of one file are the same module.
 *
 * Why it exists: `a.js?raw` is a string module and `a.js` is executable code, so listing by real file alone would let the first hide the second, while `a.js?t=1` and `a.js?v=2` are one module under cache-busting names. Called by {@link walkViteLibraryModules} for each library module it reaches.
 *
 * @param realFile - The module's real file path.
 * @param url - The served URL, possibly with a query.
 * @returns The real file path plus the query with the cache-busting parameters removed; other parameters keep their order.
 * @example
 * viteModuleIdentityKey('/lib/a.js', '/@fs/lib/a.js?t=1&raw') // => '/lib/a.js?raw'
 */
export function viteModuleIdentityKey(realFile: string, url: string): string {
  const queryStart = url.indexOf('?')
  if (queryStart === -1) return realFile
  // A fragment is never sent to the server, so it is not part of the identity.
  const query = url.slice(queryStart + 1).split('#')[0] ?? ''
  const kept = query
    .split('&')
    .filter((pair) => pair !== '')
    .filter((pair) => {
      const name = pair.split('=')[0] ?? ''
      return !(VITE_CACHE_BUSTING_QUERY_PARAMS as readonly string[]).includes(
        name,
      )
    })
  return kept.length === 0 ? realFile : `${realFile}?${kept.join('&')}`
}
