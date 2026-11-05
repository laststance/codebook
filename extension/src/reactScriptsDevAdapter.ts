import type { DevelopmentServerAdapter } from './developmentServerAdapter'
import { reactScriptsOutsidePackageRefusal } from './reactScriptsRefusals'
import { assessReactScriptsWorkspace } from './utils/assessReactScriptsWorkspace'
import { awaitReactScriptsFirstCompile } from './utils/awaitReactScriptsFirstCompile'
import { isViteScriptOfModule } from './utils/isViteScriptOfModule'
import { launchReactScriptsDevelopmentServer } from './utils/launchReactScriptsDevelopmentServer'
import { ReactScriptsBundleCache } from './utils/readReactScriptsServedBundle'
import { sealReactScriptsStop } from './utils/sealReactScriptsStop'

/** The bundle caches of the runs that are alive, by owned origin; a cache is dropped when its server closes. */
const bundleCaches = new Map<string, ReactScriptsBundleCache>()

/** The owned origin of each started server, so the settle wait can find it from the handle. */
const originsByApp = new WeakMap<object, string>()

/**
 * Gives the run's bundle cache for an origin, creating it on first use.
 * @param origin - The owned origin.
 * @returns The cache every read of this run shares.
 * @example bundleCacheOf('http://127.0.0.1:3000').mapReads // => 0
 */
function bundleCacheOf(origin: string): ReactScriptsBundleCache {
  let cache = bundleCaches.get(origin)
  if (!cache) {
    cache = new ReactScriptsBundleCache()
    bundleCaches.set(origin, cache)
  }
  return cache
}

/**
 * The react-scripts 5 development server behind {@link DevelopmentServerAdapter}: the app's own `start.js` runs through the shared launcher, readiness is the first compile (entry page, bundle, map), and stops are sealed from the one bundle and its map.
 * Selected by {@link developmentServerAdapterOf} for `adapter: "react-scripts-dev"`. The browser maps stops through `webRoot` with js-debug's default source-map handling (Cycle 0083 E1, setting (a)).
 */
export const REACT_SCRIPTS_DEV_ADAPTER: DevelopmentServerAdapter = {
  name: 'react-scripts-dev',
  async assertWorkspace(
    _workspace,
    _node,
    _signal,
    _nextPackage,
    _vitePackage,
    reactScriptsPackage,
  ) {
    if (!reactScriptsPackage)
      throw new Error('A react-scripts run resolves its package first')
    await assessReactScriptsWorkspace(reactScriptsPackage)
  },
  async start(request) {
    if (!request.reactScriptsPackage)
      throw new Error('A react-scripts run resolves its package first')
    const workspace = await assessReactScriptsWorkspace(
      request.reactScriptsPackage,
    )
    const launch = await launchReactScriptsDevelopmentServer(
      request,
      workspace,
      // The run's cache is dropped with its server.
      async (port) => {
        bundleCaches.delete(`http://127.0.0.1:${port}`)
      },
    )
    originsByApp.set(launch.app, `http://127.0.0.1:${launch.port}`)
    return launch
  },
  // react-scripts has no development lock.
  readOwnedLock: async () => undefined,
  async waitForServerSettled(app, timeoutMs, signal) {
    const origin = originsByApp.get(app)
    if (origin === undefined) return
    await awaitReactScriptsFirstCompile(
      origin,
      bundleCacheOf(origin),
      timeoutMs,
      signal,
    )
  },
  readBundle: async (request) => {
    const { reactScriptsPackage } = request
    if (!reactScriptsPackage)
      throw new Error('A react-scripts run resolves its package first')
    const packageRelativePath = reactScriptsPackage.toPackageRelative(
      request.source.path,
    )
    // A stop the mapper cannot place inside the app is refused, never read from its repository path.
    if (packageRelativePath === undefined)
      throw reactScriptsOutsidePackageRefusal(
        reactScriptsPackage.packageRootRelative,
        [request.source.path],
      )
    return sealReactScriptsStop({
      appRoot: reactScriptsPackage.packageRoot,
      packageRootRelative: reactScriptsPackage.packageRootRelative,
      packageRelativePath,
      source: request.source,
      citationEndLine: request.citationEndLine,
      ownedOrigin: request.ownedOrigin,
      signal: request.signal,
      cache: bundleCacheOf(request.ownedOrigin),
    })
  },
  // js-debug's defaults bind a stop in the app folder: no path overrides (E1 setting (a)).
  browserDebugFields: (workspace) => ({ webRoot: workspace, sourceMaps: true }),
  // The bundle's address is a loopback URL like a Vite module's, with no query that names another module.
  isScriptOfModule: isViteScriptOfModule,
}
