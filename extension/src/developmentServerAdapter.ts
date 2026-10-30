import type { ViteSetupStep } from './constants'
import type { BundleSource } from './repositoryBundle'
import type { RepositoryConfiguration } from './repositoryConfigSchemas'
import type { PortCheckOptions } from './utils/assertDevelopmentPortFree'
import type { DevelopmentLockIdentity } from './utils/assertDevelopmentWorkspace'
import type { launchDevelopmentServer } from './utils/launchDevelopmentServer'
import type { DeclaredDevelopmentPort } from './utils/readDeclaredDevelopmentPort'

/** The name a repository-browser configuration gives its development server (`adapter`), the one key of {@link DevelopmentServerAdapter}. */
export type DevelopmentServerAdapterName = RepositoryConfiguration['adapter']

/** The owned development server a run started: the handle {@link ConfiguredBrowserRun} waits on, inspects and closes. */
export type DevelopmentApp = ReturnType<typeof launchDevelopmentServer>

/** What {@link DevelopmentServerAdapter.start} needs from the run that starts the server. */
export type DevelopmentServerStart = {
  /** The opened workspace, which is the package root this version. */
  workspace: string
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
}

/** What {@link DevelopmentServerAdapter.readBundle} needs to seal one declared stop. */
export type DevelopmentBundleRequest = {
  workspace: string
  source: RepositoryConfiguration['source']
  signal: AbortSignal
  entryPath: string
  /** `server-action` is a Next server stop; a browser stop is sealed from the code the page loads. */
  execution: 'browser' | 'server-action'
  /** The owned origin the ready server reported (`http://127.0.0.1:<port>`). */
  ownedOrigin: string
  /** Appends to the run's evidence journal. */
  record: (type: string, detail?: unknown) => unknown
}

/** The sealed module of one stop with what the discovery measured, as {@link readDevelopmentBundle} returns it. */
export type DevelopmentBundle = {
  bundle: BundleSource
  discovery: unknown
}

/** The js-debug launch fields that depend on how the development server serves its modules. */
export type BrowserDebugFields = {
  webRoot: string
  sourceMaps: true
  sourceMapPathOverrides?: Record<string, string>
  perScriptSourcemaps?: 'yes'
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
  ): Promise<void>
  /** Starts the owned server on the project's own port and returns it with that port. */
  start(request: DevelopmentServerStart): Promise<{
    app: DevelopmentApp
    port: number
    /** The Vite version the launcher reported from the resolved `vite/package.json` (Vite only). */
    viteVersion?: string
    /** Masks the values the start learned (dev-script assignments and env-file values) in text the run keeps, such as a sealed module; the mask reads its values at call time. Vite only. */
    maskText?: (text: string) => string
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
  /** The js-debug launch fields of the browser that opens the app. */
  browserDebugFields(workspace: string): BrowserDebugFields
  /** Tells whether a script URL a runtime announced is the sealed module's address. */
  isScriptOfModule(sealedUrl: string, announcedUrl: string): boolean
}
