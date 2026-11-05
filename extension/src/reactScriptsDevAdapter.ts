import type { DevelopmentServerAdapter } from './developmentServerAdapter'
import { reactScriptsOutsidePackageRefusal } from './reactScriptsRefusals'
import { assessReactScriptsWorkspace } from './utils/assessReactScriptsWorkspace'
import { awaitReactScriptsFirstCompile } from './utils/awaitReactScriptsFirstCompile'
import { isViteScriptOfModule } from './utils/isViteScriptOfModule'
import { launchReactScriptsDevelopmentServer } from './utils/launchReactScriptsDevelopmentServer'
import { ReactScriptsBundleCache } from './utils/readReactScriptsServedBundle'
import { sealReactScriptsStop } from './utils/sealReactScriptsStop'

/** The origin and bundle cache of each started server, by its handle, so the settle wait finds them and nothing outlives the server. */
const runsByApp = new WeakMap<
  object,
  { origin: string; cache: ReactScriptsBundleCache }
>()

/** The caches of the runs that are alive, by owned origin: a seal request carries the origin, not the handle. Only `start` adds an entry, and it is dropped when the server closes. */
const aliveCachesByOrigin = new Map<string, ReactScriptsBundleCache>()

/**
 * Gives the cache of a started run for its origin.
 * @param origin - The owned origin.
 * @returns The run's cache; a fresh unshared one for an origin no run of this adapter started, so a read for it keeps nothing.
 * @example bundleCacheOf('http://127.0.0.1:3000').mapReads // => 0
 */
function bundleCacheOf(origin: string): ReactScriptsBundleCache {
  return aliveCachesByOrigin.get(origin) ?? new ReactScriptsBundleCache()
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
        aliveCachesByOrigin.delete(`http://127.0.0.1:${port}`)
      },
    )
    const cache = new ReactScriptsBundleCache(workspace.publicPath)
    const origin = `http://127.0.0.1:${launch.port}`
    aliveCachesByOrigin.set(origin, cache)
    runsByApp.set(launch.app, { origin, cache })
    return launch
  },
  // react-scripts has no development lock.
  readOwnedLock: async () => undefined,
  async waitForServerSettled(app, timeoutMs, signal) {
    const run = runsByApp.get(app)
    if (run === undefined) return
    await awaitReactScriptsFirstCompile(
      run.origin,
      run.cache,
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
