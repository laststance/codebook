import { readFile, realpath } from 'node:fs/promises'
import { join } from 'node:path'

import { STATIC_PAGE_FILE_LIMIT_BYTES, VITE_SETUP_STEPS } from './constants'
import type {
  DevelopmentApp,
  DevelopmentServerAdapter,
} from './developmentServerAdapter'
import {
  staticPageEntryUnreadableRefusal,
  staticPageNeedsBundlerRefusal,
  staticPageNoEntryRefusal,
  staticPageNotPageRefusal,
  staticPageOutsidePackageRefusal,
} from './staticPageRefusals'
import { awaitStaticPageReady } from './utils/awaitStaticPageReady'
import { findCdnPackageImports } from './utils/findCdnPackageImports'
import { isStaticPageScriptOfModule } from './utils/isStaticPageScriptOfModule'
import { libraryRelativePath } from './utils/libraryRelativePath'
import { SingleBundleCache } from './utils/readSingleServedBundle'
import {
  judgeStaticPage,
  staticPageEntryFile,
} from './utils/readStaticPageReadiness'
import type { ResolvedPackage } from './utils/resolveNextPackage'
import { sealStaticPageLibraryStop } from './utils/sealStaticPageLibraryStop'
import { sealStaticPageScript } from './utils/sealStaticPageScript'
import {
  startStaticPageServer,
  type StaticPageServer,
} from './utils/startStaticPageServer'

/** The entry address of each started server, by its handle, so the settle wait finds it and nothing outlives the server. */
const entryUrlByApp = new WeakMap<object, string>()

/**
 * Refuses a page folder that cannot be served as written, before anything starts.
 * Called by the adapter's `assertWorkspace` and `start`.
 * @param page - The resolved page folder.
 * @param entryPath - The configured entry path.
 * @throws `STATIC_PAGE_UNSUPPORTED` with reason `no-entry-page`, `needs-bundler`, `entry-unreadable` or `not-a-static-page`.
 * @example await assertStaticPageServable(page, '/')
 */
async function assertStaticPageServable(
  page: ResolvedPackage,
  entryPath: string,
): Promise<void> {
  const folder = await realpath(page.packageRoot)
  const problem = await judgeStaticPage(folder, entryPath)
  if (problem === undefined) return
  switch (problem.gap) {
    case 'no-entry-page':
      throw staticPageNoEntryRefusal(problem.entry)
    case 'needs-bundler':
      throw staticPageNeedsBundlerRefusal(problem.reference, problem.kind)
    case 'entry-unreadable':
      throw staticPageEntryUnreadableRefusal(problem.problem)
    case 'not-a-static-page':
      throw staticPageNotPageRefusal(page.packageRootRelative, problem.adapter)
  }
}

/**
 * Gives the run the handle of a started static server in the shape of the development-server handle.
 *
 * Why it exists: the run waits on, inspects and closes one handle per adapter, and a static server is no child process: it has no pid, no output and no inspector, and the run never asks it for those because a `static-page` run observes browser stops only. Called by the adapter's `start`.
 * @param server - The started static server.
 * @param record - Appends to the run's evidence journal.
 * @returns The handle.
 * @example const app = staticPageAppOf(server, record); await app.ready(signal, '/')
 */
function staticPageAppOf(
  server: StaticPageServer,
  record: (type: string, detail?: unknown) => unknown,
): DevelopmentApp {
  const handle = {
    pid: undefined,
    isRunning: () => server.isRunning(),
    exitStatus: () => ({ exitCode: null, signal: null }),
    outputTail: () => '',
    listening: async () => server.origin,
    assertRunning(): void {
      if (!server.isRunning()) throw new Error('The static server stopped')
    },
    async ready(signal: AbortSignal, entryPath = '/'): Promise<string> {
      const response = await fetch(`${server.origin}${entryPath}`, {
        redirect: 'manual',
        signal,
      })
      await response.body?.cancel()
      if (!response.ok)
        throw new Error(
          `Selected application page failed or redirected: ${response.status}. Select the actual entry path.`,
        )
      record('application.ready', { origin: server.origin })
      return server.origin
    },
    async close(): Promise<void> {
      await server.close()
      record('application.closed', { origin: server.origin })
    },
  }
  // The run reads only the members above for a browser-only adapter; the child-process members (messages, inspector, raw output) are never asked of a static server.
  return Object.assign(handle)
}

/**
 * The `static-page` adapter: Codebook's own loopback static server serves the page's folder as written, readiness is the entry page and its same-origin scripts being served, and a stop in the page's own scripts is sealed against the served bytes.
 * Selected by {@link developmentServerAdapterOf} for `adapter: "static-page"`. A stop in the declared library takes the packed-build seal ({@link sealStaticPageLibraryStop}).
 */
export const STATIC_PAGE_ADAPTER: DevelopmentServerAdapter = {
  name: 'static-page',
  async assertWorkspace(
    _workspace,
    _node,
    _signal,
    _nextPackage,
    _vitePackage,
    _reactScriptsPackage,
    _expoWebPackage,
    staticPagePackage,
    entryPath,
  ) {
    if (!staticPagePackage)
      throw new Error('A static-page run resolves its package first')
    await assertStaticPageServable(staticPagePackage, entryPath ?? '/')
  },
  async start(request) {
    const { staticPagePackage } = request
    if (!staticPagePackage)
      throw new Error('A static-page run resolves its package first')
    const entryPath = request.entryPath ?? '/'
    await assertStaticPageServable(staticPagePackage, entryPath)
    request.alive()
    request.onStep(VITE_SETUP_STEPS.waitingForServer)
    const server = await startStaticPageServer(staticPagePackage.packageRoot)
    const app = staticPageAppOf(server, request.record)
    request.record('application.acquired', {
      adapter: 'static-page',
      origin: server.origin,
    })
    entryUrlByApp.set(app, `${server.origin}${entryPath}`)
    request.onApp(app)
    return { app, port: server.port }
  },
  // A static page has no development lock.
  readOwnedLock: async () => undefined,
  async waitForServerSettled(app, timeoutMs, signal) {
    const entryUrl = entryUrlByApp.get(app)
    if (entryUrl === undefined) return
    await awaitStaticPageReady(entryUrl, timeoutMs, signal)
  },
  readBundle: async (request) => {
    const { staticPagePackage } = request
    if (!staticPagePackage)
      throw new Error('A static-page run resolves its package first')
    const libraryStop = request.staticPageLibraryStop
    // A stop in the declared library is sealed against the packed build the redirect serves, not refused as outside the page.
    if (libraryStop) {
      const entry = staticPageEntryFile(request.entryPath) ?? 'index.html'
      const pageText = await readFile(
        join(await realpath(staticPagePackage.packageRoot), entry),
        'utf8',
      )
      return sealStaticPageLibraryStop(
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
          cache: new SingleBundleCache(),
        },
        {
          packageName: libraryStop.packageName,
          examplePackageRoot: libraryStop.examplePackageRoot,
          packedRoot: libraryStop.packedRoot,
          files: libraryStop.files,
          imports: findCdnPackageImports(
            pageText.slice(0, STATIC_PAGE_FILE_LIMIT_BYTES),
            libraryStop.packageName,
          ),
        },
      )
    }
    // A stop the mapper cannot place inside the page is refused, never read from its repository path.
    if (staticPagePackage.toPackageRelative(request.source.path) === undefined)
      throw staticPageOutsidePackageRefusal(
        staticPagePackage.packageRootRelative,
        [request.source.path],
        'partial',
      )
    return sealStaticPageScript({
      page: staticPagePackage,
      source: request.source,
      citationEndLine: request.citationEndLine,
      ownedOrigin: request.ownedOrigin,
      entryPath: request.entryPath,
      signal: request.signal,
    })
  },
  // js-debug's defaults bind a stop in the page folder: no path overrides (Cycle 0105 E1 (c)).
  browserDebugFields: (workspace) => ({ webRoot: workspace, sourceMaps: true }),
  isScriptOfModule: isStaticPageScriptOfModule,
}
