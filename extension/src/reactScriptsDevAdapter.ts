import type { DevelopmentServerAdapter } from './developmentServerAdapter'
import { reactScriptsOutsidePackageRefusal } from './reactScriptsRefusals'
import { assessReactScriptsWorkspace } from './utils/assessReactScriptsWorkspace'
import { awaitReactScriptsFirstCompile } from './utils/awaitReactScriptsFirstCompile'
import { isViteScriptOfModule } from './utils/isViteScriptOfModule'
import { launchReactScriptsDevelopmentServer } from './utils/launchReactScriptsDevelopmentServer'
import { ReactScriptsBundleCache } from './utils/readReactScriptsServedBundle'
import { sealReactScriptsLibraryStop } from './utils/sealReactScriptsLibraryStop'
import { sealReactScriptsStop } from './utils/sealReactScriptsStop'

/**
 * Gives a library stop's path below the library folder.
 * Why it exists: the library seal reads the stop below the checked-out library, while a declared stop is repository-relative. Called by {@link REACT_SCRIPTS_DEV_ADAPTER}'s `readBundle` for a library stop.
 * @param libraryRootRelative - The library's repository-relative folder (`"."` for the repository root).
 * @param repositoryPath - The stop's repository-relative path, inside that folder.
 * @returns The path below the library folder, forward slashes.
 * @example
 * libraryRelativePath('packages/lib', 'packages/lib/src/a.ts') // => 'src/a.ts'
 * libraryRelativePath('.', 'src/a.ts') // => 'src/a.ts'
 */
function libraryRelativePath(
  libraryRootRelative: string,
  repositoryPath: string,
): string {
  return libraryRootRelative === '.'
    ? repositoryPath
    : repositoryPath.slice(libraryRootRelative.length + 1)
}

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
    node,
    signal,
    _nextPackage,
    _vitePackage,
    reactScriptsPackage,
  ) {
    if (!reactScriptsPackage)
      throw new Error('A react-scripts run resolves its package first')
    await assessReactScriptsWorkspace(reactScriptsPackage, node, signal)
  },
  async start(request) {
    if (!request.reactScriptsPackage)
      throw new Error('A react-scripts run resolves its package first')
    const workspace = await assessReactScriptsWorkspace(
      request.reactScriptsPackage,
      request.node,
      request.signal,
    )
    // Created before the launch so the server's cleanup can tell this run's entry from a later run's on the same port.
    const cache = new ReactScriptsBundleCache(
      workspace.publicPath,
      request.reactScriptsPackage.packageRoot,
    )
    const launch = await launchReactScriptsDevelopmentServer(
      request,
      workspace,
      // The run's cache is dropped with its server; a stale cleanup must leave a newer run's entry.
      async (port) => {
        const closedOrigin = `http://127.0.0.1:${port}`
        if (aliveCachesByOrigin.get(closedOrigin) === cache)
          aliveCachesByOrigin.delete(closedOrigin)
      },
    )
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
    const libraryStop = request.reactScriptsLibraryStop
    // A stop in the checked-out library of a library run is sealed through the packed build (decision D3), not refused as outside the app.
    if (libraryStop)
      return sealReactScriptsLibraryStop(
        {
          appRoot: libraryStop.libraryRoot,
          packageRootRelative: libraryStop.libraryRootRelative,
          packageRelativePath: libraryRelativePath(
            libraryStop.libraryRootRelative,
            request.source.path,
          ),
          source: request.source,
          citationEndLine: request.citationEndLine,
          ownedOrigin: request.ownedOrigin,
          signal: request.signal,
          cache: bundleCacheOf(request.ownedOrigin),
        },
        {
          packageName: libraryStop.packageName,
          examplePackageRoot: libraryStop.examplePackageRoot,
          packedRoot: libraryStop.packedRoot,
        },
      )
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
