import type { DevelopmentServerAdapter } from './developmentServerAdapter'
import { expoWebSealedOutsidePackageRefusal } from './expoWebRefusals'
import { EXPO_WEB_SINGLE_BUNDLE_PROFILE } from './expoWebSingleBundleProfile'
import { assessExpoWebWorkspace } from './utils/assessExpoWebWorkspace'
import { awaitExpoWebBundle } from './utils/awaitExpoWebBundle'
import { isExpoWebScriptOfModule } from './utils/isExpoWebScriptOfModule'
import { launchExpoWebDevelopmentServer } from './utils/launchExpoWebDevelopmentServer'
import {
  SingleBundleCache,
  type SingleBundleProgress,
} from './utils/readSingleServedBundle'
import { sealSingleBundleStop } from './utils/sealSingleBundleStop'

/** What the adapter keeps of each started server, by its handle, so the settle wait finds it and nothing outlives the server. */
type ExpoWebRun = {
  /** The owned origin the server listens on. */
  origin: string
  cache: SingleBundleCache
  /** Masks values and secret shapes in text the run keeps. */
  mask: (text: string) => string
  /** Appends to the run's evidence journal. */
  record: (type: string, detail?: unknown) => unknown
}

const runsByApp = new WeakMap<object, ExpoWebRun>()

/** The caches of the runs that are alive, by owned origin: a seal request carries the origin, not the handle. Only `start` adds an entry, and it is dropped when the server closes. */
const aliveCachesByOrigin = new Map<string, SingleBundleCache>()

/** The journal name of each step the readiness wait reports (DX-11). */
const JOURNAL_STEP_OF_PROGRESS: Record<SingleBundleProgress, string> = {
  html: 'html-served',
  bundle: 'bundle-served',
  map: 'map-served',
}

/**
 * Gives the cache of a started run for its origin.
 * @param origin - The owned origin.
 * @returns The run's cache; a fresh unshared one for an origin no run of this adapter started, so a read for it keeps nothing.
 * @example bundleCacheOf('http://127.0.0.1:4101').mapReads // => 0
 */
function bundleCacheOf(origin: string): SingleBundleCache {
  return aliveCachesByOrigin.get(origin) ?? new SingleBundleCache()
}

/**
 * The Expo SDK 57 web development server behind {@link DevelopmentServerAdapter}: the app's own Expo CLI runs through the shared launcher on the web script's declared port, readiness is Metro's served bundle and map (entry page, bundle, map), and stops are sealed from the one entry bundle and its map.
 * Selected by {@link developmentServerAdapterOf} for `adapter: "expo-web-dev"`; browser stops only. The browser maps stops through `webRoot` with js-debug's default source-map handling (Cycle 0089, E1c).
 */
export const EXPO_WEB_DEV_ADAPTER: DevelopmentServerAdapter = {
  name: 'expo-web-dev',
  async assertWorkspace(
    _workspace,
    _node,
    _signal,
    _nextPackage,
    _vitePackage,
    _reactScriptsPackage,
    expoWebPackage,
  ) {
    if (!expoWebPackage)
      throw new Error('An Expo web run resolves its package first')
    // Static checks only: nothing is executed and nothing is started.
    await assessExpoWebWorkspace(expoWebPackage)
  },
  async start(request) {
    if (!request.expoWebPackage)
      throw new Error('An Expo web run resolves its package first')
    const workspace = await assessExpoWebWorkspace(request.expoWebPackage)
    const origin = `http://127.0.0.1:${workspace.port}`
    const launch = await launchExpoWebDevelopmentServer(
      request,
      workspace,
      // The run's cache is dropped with its server.
      async (port) => {
        aliveCachesByOrigin.delete(`http://127.0.0.1:${port}`)
      },
    )
    const cache = new SingleBundleCache(request.entryPath ?? '/')
    aliveCachesByOrigin.set(origin, cache)
    runsByApp.set(launch.app, {
      origin,
      cache,
      mask: launch.maskText,
      record: request.record,
    })
    return { ...launch, expoVersion: workspace.version }
  },
  // Expo has no development lock.
  readOwnedLock: async () => undefined,
  async waitForServerSettled(app, timeoutMs, signal) {
    const run = runsByApp.get(app)
    if (run === undefined) return
    await awaitExpoWebBundle(run.origin, run.cache, timeoutMs, signal, {
      isRunning: app.isRunning,
      exitStatus: app.exitStatus,
      mask: run.mask,
      onStep: (step, elapsedMs) =>
        run.record('expo.step', {
          step: JOURNAL_STEP_OF_PROGRESS[step],
          elapsedMs,
        }),
    })
  },
  readBundle: async (request) => {
    const { expoWebPackage } = request
    if (!expoWebPackage)
      throw new Error('An Expo web run resolves its package first')
    const packageRelativePath = expoWebPackage.toPackageRelative(
      request.source.path,
    )
    // A stop the mapper cannot place inside the app is refused, never read from its repository path.
    if (packageRelativePath === undefined)
      throw expoWebSealedOutsidePackageRefusal(
        expoWebPackage.packageRootRelative,
        [request.source.path],
      )
    return sealSingleBundleStop(
      {
        appRoot: expoWebPackage.packageRoot,
        packageRootRelative: expoWebPackage.packageRootRelative,
        packageRelativePath,
        source: request.source,
        citationEndLine: request.citationEndLine,
        ownedOrigin: request.ownedOrigin,
        signal: request.signal,
        cache: bundleCacheOf(request.ownedOrigin),
      },
      EXPO_WEB_SINGLE_BUNDLE_PROFILE,
    )
  },
  // js-debug's defaults bind a stop in the app folder (E1c): no path overrides.
  browserDebugFields: (workspace) => ({ webRoot: workspace, sourceMaps: true }),
  // The bundle's address is a loopback URL with Metro's query, which must match exactly (Vite's `t`/`v` cache-busting parameters mean nothing here).
  isScriptOfModule: isExpoWebScriptOfModule,
}
