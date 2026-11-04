/**
 * Gives the server chunk of an App Router page, relative to `.next/dev`, from the App paths manifest.
 *
 * Why it exists: an App Router page's server compile (`server/app/page.js`) holds the `(rsc)` and `(ssr)` modules of the page and of everything it imports in one chunk, and two readers search it: the app's own server stop ({@link readDevelopmentBundle}) and a server stop in a workspace library ({@link sealAppLibraryStop}). Both name the chunk through this one rule.
 * @param routes - The parsed `app-paths-manifest.json`: keys to compiled page paths.
 * @param routeKey - The page's manifest key, from {@link resolveNextClientManifest}.
 * @returns The chunk path below `.next/dev`, e.g. `server/app/page.js`.
 * @throws When the manifest has no entry for the key.
 * @example
 * serverChunkOfRoute({ '/page': 'app/page.js' }, '/page') // => 'server/app/page.js'
 */
export function serverChunkOfRoute(
  routes: Readonly<Record<string, string>>,
  routeKey: string,
): string {
  const compiled = routes[routeKey]
  if (compiled === undefined)
    throw new Error('Selected route has no compiled server page')
  return `server/${compiled}`
}
