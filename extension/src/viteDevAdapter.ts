import { join } from 'node:path'

import type { DevelopmentServerAdapter } from './developmentServerAdapter'
import { assessViteWorkspace } from './utils/assessViteWorkspace'
import { awaitViteOptimizerIdle } from './utils/awaitViteOptimizerIdle'
import { isViteScriptOfModule } from './utils/isViteScriptOfModule'
import { launchViteDevelopmentServer } from './utils/launchViteDevelopmentServer'
import { readViteServedModule } from './utils/readViteServedModule'
import type { ResolvedVitePackage } from './utils/resolveVitePackage'
import { viteOutsidePackageRefusal } from './viteRefusals'

/**
 * Gives the repository root a nested Vite app is resolved inside, or `undefined` for the root app.
 *
 * Why it exists: Vite of a nested app is found only inside the repository (decision D7), while the root app keeps Node's own resolution. Called by the adapter's `assertWorkspace` and `start`.
 * @param vitePackage - The Vite app the run resolved, when it resolved one.
 * @returns The repository root for a nested app; `undefined` for a root run.
 * @example nestedRepositoryRoot(resolved) // => '/repo' for packageRoot "examples/react/basic"
 */
function nestedRepositoryRoot(
  vitePackage: ResolvedVitePackage | undefined,
): string | undefined {
  return vitePackage && !vitePackage.isRoot
    ? vitePackage.repositoryRoot
    : undefined
}

/**
 * The Vite development server behind {@link DevelopmentServerAdapter}: the owned launcher starts the app's own Vite, stops are sealed from the modules it serves, and the browser maps them through `webRoot` with per-script source maps.
 * Selected by {@link developmentServerAdapterOf} for `adapter: "vite-dev"`; the launcher module sits beside this module in the extension's output.
 * A nested app (Cycle 0077) runs exactly as a root app does, with its folder as the launcher's root and working folder, the seal's package root and the browser's `webRoot`.
 */
export const VITE_DEV_ADAPTER: DevelopmentServerAdapter = {
  name: 'vite-dev',
  async assertWorkspace(workspace, node, signal, _nextPackage, vitePackage) {
    await assessViteWorkspace(
      workspace,
      node,
      signal,
      nestedRepositoryRoot(vitePackage),
    )
  },
  async start(request) {
    const workspaceInfo = await assessViteWorkspace(
      request.workspace,
      request.node,
      request.signal,
      nestedRepositoryRoot(request.vitePackage),
    )
    return launchViteDevelopmentServer(
      request,
      workspaceInfo,
      join(__dirname, 'viteLauncher.js'),
    )
  },
  // Vite has no development lock.
  readOwnedLock: async () => undefined,
  waitForServerSettled: awaitViteOptimizerIdle,
  readBundle: async (request) => {
    const { vitePackage } = request
    // A nested app is sealed in its own folder under the stop's package-relative path; a root run keeps the repository root and the declared path.
    if (vitePackage && !vitePackage.isRoot) {
      const packageRelativePath = vitePackage.toPackageRelative(
        request.source.path,
      )
      // A stop the mapper cannot place inside the app is refused, never read from its repository path.
      if (packageRelativePath === undefined)
        throw viteOutsidePackageRefusal(vitePackage.packageRootRelative, [
          request.source.path,
        ])
      return readViteServedModule(
        vitePackage.packageRoot,
        request.ownedOrigin,
        request.source,
        request.signal,
        packageRelativePath,
      )
    }
    return readViteServedModule(
      request.workspace,
      request.ownedOrigin,
      request.source,
      request.signal,
      request.source.path,
    )
  },
  browserDebugFields: (workspace) => ({
    webRoot: workspace,
    sourceMaps: true,
    perScriptSourcemaps: 'yes',
  }),
  isScriptOfModule: isViteScriptOfModule,
}
