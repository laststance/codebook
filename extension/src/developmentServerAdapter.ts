import type {
  OPERATIONS_REPOSITORY_BROWSER_ADAPTERS,
  ViteSetupStep,
} from './constants'
import type { BundleSource } from './repositoryBundle'
import type { RepositoryConfiguration } from './repositoryConfigSchemas'
import type { SourceMapLimits } from './sourceMapLimits'
import type { PortCheckOptions } from './utils/assertDevelopmentPortFree'
import type { DevelopmentLockIdentity } from './utils/assertDevelopmentWorkspace'
import type { NextPagesDiscoveryCache } from './utils/createNextPagesDiscoveryCache'
import type { launchDevelopmentServer } from './utils/launchDevelopmentServer'
import type {
  FrozenLibraryBuild,
  LibraryPackage,
} from './utils/libraryBuildStop'
import type { DeclaredDevelopmentPort } from './utils/readDeclaredDevelopmentPort'
import type { DevelopmentServerLayer } from './utils/readDevelopmentBundle'
import type {
  ResolvedNextPackage,
  ResolvedPackage,
} from './utils/resolveNextPackage'
import type { ResolvedVitePackage } from './utils/resolveVitePackage'
import type { ViteLibraryModuleSource } from './utils/selectViteLibraryCandidate'
import type { ViteLibraryModules } from './utils/viteLibraryModules'
import type { ViteLauncherLibraryOptions } from './viteLauncherProtocol'

/** The name a repository-browser configuration gives its development server (`adapter`), the one key of {@link DevelopmentServerAdapter}. */
export type DevelopmentServerAdapterName =
  (typeof OPERATIONS_REPOSITORY_BROWSER_ADAPTERS)[number]

/** The owned development server a run started: the handle {@link ConfiguredBrowserRun} waits on, inspects and closes. */
export type DevelopmentApp = ReturnType<typeof launchDevelopmentServer>

/** What {@link DevelopmentServerAdapter.start} needs from the run that starts the server. */
export type DevelopmentServerStart = {
  /** The app's package root (the opened repository root for a root app; the canonical `packageRoot` folder for a nested Next or Vite app). */
  workspace: string
  /** The package a Next run resolved ({@link resolveNextPackage}): the launch runs its verified executable with `workspace` as its working folder. Absent for a Vite run. */
  nextPackage?: ResolvedNextPackage
  /** The Vite app a nested Vite run resolved ({@link resolveVitePackage}): the launcher runs with `workspace` (the app folder) as its root and working folder. Absent for a root Vite run and for a Next run. */
  vitePackage?: ResolvedVitePackage
  /** The react-scripts app a `react-scripts-dev` run resolved ({@link resolveReactScriptsPackage}): the server runs with `workspace` (the app folder) as its working folder. Absent for every other run. */
  reactScriptsPackage?: ResolvedPackage
  /** The Expo app an `expo-web-dev` run resolved ({@link resolveExpoWebPackage}): the CLI runs with `workspace` (the app folder) as its working folder. Absent for every other run. */
  expoWebPackage?: ResolvedPackage
  /** The checked-out library a Vite run serves from its packed copy (the library route): the owned launcher redirects the app's imports of it, and the run's private Vite cache (`<privateFolder>/vite-cache`) passes the settings check. Absent for every other run. */
  viteLibrary?: ViteLauncherLibraryOptions
  /** The configured entry path of the run (`/` when none): an `expo-web-dev` run asks Metro's entry page there to find the bundle. */
  entryPath?: string
  /** The Node executable of the run (`Codebook: Node Executable`). */
  node: string
  /** Appends to the run's evidence journal. */
  record: (type: string, detail?: unknown) => unknown
  /** Whether the native server inspector is requested (Next server stops only). */
  inspectServer: boolean
  /** Ends the start when the run is cancelled. */
  signal: AbortSignal
  /** Throws when the run is no longer alive; called between steps, as the run does. */
  alive: () => void
  /** Refuses the start when the declared port is taken ({@link assertDevelopmentPortFree}); `refuse` words the refusal for an adapter other than Next. */
  assertPortFree: (
    declared: DeclaredDevelopmentPort,
    refuse?: PortCheckOptions['refuse'],
  ) => Promise<void>
  /** Names the setup step reached (`resolving the Vite config`, `starting Vite`), so a setup-deadline refusal can say where it stopped. */
  onStep: (step: ViteSetupStep) => void
  /** Reports where the port was declared, once known, for the run resource. */
  onDeclaredPort: (declared: DeclaredDevelopmentPort) => void
  /** Hands the started server to the run the moment it exists, so cleanup closes it even when a later step fails. */
  onApp: (app: DevelopmentApp) => void
  /** Masks values the shared redaction leaves in the server output the run journals and quotes (cookie, query and secret-named values); a Next run in a workspace with a Pages folder passes {@link maskNextServerOutput}. The Vite adapter has its own mask and ignores it. */
  outputMask?: (text: string) => string
}

/** What {@link DevelopmentServerAdapter.readBundle} needs to seal one declared stop. */
export type DevelopmentBundleRequest = {
  /** The opened repository's root (stop files and recorded sources are relative to it). */
  workspace: string
  /** The Next app the run resolved: its readers read the package root and match the stop by its package-relative path. Absent for a Vite run and for a caller with only a root app. */
  nextPackage?: ResolvedNextPackage
  /** The nested Vite app the run resolved: the seal reads the stop in the app folder under the stop's package-relative path. Absent for a root Vite run and for a Next run. */
  vitePackage?: ResolvedVitePackage
  /** The react-scripts app a `react-scripts-dev` run resolved: the seal reads the stop in the app folder under the stop's package-relative path. Absent for every other run. */
  reactScriptsPackage?: ResolvedPackage
  /** The Expo app an `expo-web-dev` run resolved: the seal reads the stop in the app folder under the stop's package-relative path. Absent for every other run. */
  expoWebPackage?: ResolvedPackage
  source: RepositoryConfiguration['source']
  /** The last line of the stop's citation, up to which a stop declared on a line with no mapped position is requested at the first mapped position after it ({@link resolveArmedPlace}); a Pages server stop's seal checks that line's client mapping too ({@link sealPagesServerStop}). */
  citationEndLine: number
  signal: AbortSignal
  entryPath: string
  /** `server-action` is a Next server stop (sealed as the `(action-browser)` module, else the `(rsc)` module of the entry route's server chunk; in a workspace library of a nested App Router app as the library's `(rsc)` module in source terms; in a Pages run as the `(pages-dir-node)` module of the page's server compile or its server chunks); a browser stop is sealed from the code the page loads. */
  execution: 'browser' | 'server-action'
  /** The owned origin the ready server reported (`http://127.0.0.1:<port>`). */
  ownedOrigin: string
  /** Appends to the run's evidence journal. */
  record: (type: string, detail?: unknown) => unknown
  /** The Pages route a Next run on the Pages path resolved, its entry page's own source (workspace-relative), and the run's one discovery cache; a browser stop is then sealed from the page's entry chunks ({@link readPagesDevelopmentBundle}) and a server stop from the page's server build ({@link sealPagesServerStop}). Absent for every other run. */
  nextRoute?: {
    route: string
    entrySource: string
    cache: NextPagesDiscoveryCache
  }
  /** Set for a server stop in a workspace library: the frozen build the stop is sealed through ({@link sealLibraryStop}) instead of the stop file's own module. Absent for every other stop. */
  library?: LibraryStopSealInput
  /** Set for a browser stop of a nested Vite run in a workspace library the app reaches: the library and the page generation's served modules the stop is sealed through ({@link sealViteLibraryStop}) instead of the app's own module. Absent for every other stop. */
  viteLibrary?: ViteLibraryStopSealInput
}

/** What the Vite library seal needs besides the stop: the detected library and the generation's module source. */
export type ViteLibraryStopSealInput = {
  library: LibraryPackage
  /** The launcher's walk and the served modules of this library for the current page generation. */
  moduleSource: ViteLibraryModuleSource
}

/** What the library seal needs besides the stop: the frozen build, the app's package root (repository-relative) and the real repository root. */
export type LibraryStopSealInput = {
  frozen: FrozenLibraryBuild
  packageRootRelative: string
  /** The real (symlink-free) repository root the built files are named below. */
  realRoot: string
  /** Set for a stop (browser or server) of a nested App Router app: the stop is sealed in source terms ({@link sealAppLibraryStop}), from the client chunks for a browser stop and the `(rsc)` modules of the server compile for a server stop. Absent for a Pages stop. */
  appBrowser?: AppBrowserLibrarySealInput
}

/** What the App Router library seal (either participant) needs beyond the frozen build. */
export type AppBrowserLibrarySealInput = {
  /** For each frozen build flavour's built path, the paths the app's map may name for the stop file ({@link appResolvedPathsOf}). */
  appResolvedPaths: Readonly<Record<string, readonly string[]>>
  /** The checked-out stop file's absolute real path, which the sealed bundle and the browser's map override lead to. */
  sourceRealPath: string
  /** The checked-out stop file's text, equal to the accepted hash. */
  sourceText: string
  /** The run's discovery cache for App Router library seals. */
  cache: NextPagesDiscoveryCache
}

/** The sealed module of one stop with what the discovery measured, as {@link readDevelopmentBundle} returns it. */
export type DevelopmentBundle = {
  bundle: BundleSource
  discovery: unknown
  /** The webpack layer a Next server stop was sealed from (`action-browser` first, else `rsc`; `pages-dir-node` in a Pages run); absent for a browser stop and for a Vite run. */
  layer?: DevelopmentServerLayer
  /** What the seal could not establish and accepted anyway, journaled as `seal.evidence`: `client-mapping-unverified` for a server stop on a line of the entry page's own module whose client mapping the scan could not read to its end. Absent otherwise. */
  evidence?: 'client-mapping-unverified'
  /** Set for a library stop: the repository-relative built file whose module the bundle holds (the bundle is in built terms). */
  libraryBuiltPath?: string
  /** The size limits the adapter sealed the bundle under, which the run's verifier, instance checks and source resources apply too. Absent means today's shared limits ({@link DEFAULT_SOURCE_MAP_LIMITS}); the `expo-web-dev` adapter sets {@link EXPO_WEB_SOURCE_MAP_LIMITS}. */
  limits?: SourceMapLimits
}

/** The js-debug launch fields that depend on how the development server serves its modules. */
export type BrowserDebugFields = {
  webRoot: string
  sourceMaps: true
  sourceMapPathOverrides?: Record<string, string>
  perScriptSourcemaps?: 'yes'
  /** Maps a URL prefix the server serves to a folder on disk (`/@fs/` to `/` for a Vite workspace library served outside the app's root). */
  pathMapping?: Record<string, string>
}

/**
 * How one development server starts, is sealed and is debugged: a concrete record per adapter, not a plugin system.
 *
 * Why it exists: {@link ConfiguredBrowserRun} serves every `adapter` value of a repository-browser configuration through the same preparation, and only these steps differ between a Next webpack server and a Vite server.
 * Called by {@link ConfiguredBrowserRun} during preparation and parsed-script matching; selected by the configuration's `adapter`.
 */
export interface DevelopmentServerAdapter {
  readonly name: DevelopmentServerAdapterName
  /** Refuses a workspace that lacks the adapter's prerequisites, before any process starts. */
  assertWorkspace(
    workspace: string,
    node: string,
    signal: AbortSignal,
    nextPackage?: ResolvedNextPackage,
    vitePackage?: ResolvedVitePackage,
    reactScriptsPackage?: ResolvedPackage,
    expoWebPackage?: ResolvedPackage,
  ): Promise<void>
  /** Starts the owned server on the project's own port and returns it with that port. */
  start(request: DevelopmentServerStart): Promise<{
    app: DevelopmentApp
    port: number
    /** The Vite version the launcher reported from the resolved `vite/package.json` (Vite only). */
    viteVersion?: string
    /** The Expo SDK version the CLI reported from the resolved `expo/package.json` (Expo only). */
    expoVersion?: string
    /** Masks the values the start learned (dev-script assignments and env-file values) in text the run keeps, such as a sealed module; the mask reads its values at call time. Vite only. */
    maskText?: (text: string) => string
    /** Masks only the env-file and script values, with no secret-shape redaction, in the sealed module text and map a run keeps: project code can hold credential-shaped literals that are not env values. Vite only. */
    maskModuleText?: (text: string) => string
  }>
  /** Reads the identity of the dev lock the started server owns; only Next has one. */
  readOwnedLock(workspace: string): Promise<DevelopmentLockIdentity | undefined>
  /**
   * Waits until the server has finished work that would reload the page by itself (Vite's dependency optimizer); Next has none and returns at once.
   * Called by the run before each quiet window of the page, bounded by `timeoutMs` and `signal`.
   */
  waitForServerSettled(
    app: DevelopmentApp,
    timeoutMs: number,
    signal: AbortSignal,
  ): Promise<void>
  /** Seals the module one declared stop runs in. */
  readBundle(request: DevelopmentBundleRequest): Promise<DevelopmentBundle>
  /**
   * Asks the owned server which modules of one library folder the page reaches from its entry modules (Vite's client graph, inside the launcher); only Vite has it.
   * Called by the run once per page generation for a library stop.
   */
  walkLibraryModules?(
    app: DevelopmentApp,
    request: { entries: string[]; libraryFolder: string },
    signal: AbortSignal,
  ): Promise<ViteLibraryModules>
  /** The js-debug launch fields of the browser that opens the app; `libraryOverrides` are exact `sourceMapPathOverrides` entries for browser stops in workspace libraries of a nested App Router app (the Next adapter adds them, others ignore them). */
  browserDebugFields(
    workspace: string,
    libraryOverrides?: Readonly<Record<string, string>>,
  ): BrowserDebugFields
  /** Tells whether a script URL a runtime announced is the sealed module's address. */
  isScriptOfModule(sealedUrl: string, announcedUrl: string): boolean
}
