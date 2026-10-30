import { join } from 'node:path'

import type { DevelopmentServerAdapter } from './developmentServerAdapter'
import { assessViteWorkspace } from './utils/assessViteWorkspace'
import { isViteScriptOfModule } from './utils/isViteScriptOfModule'
import { launchViteDevelopmentServer } from './utils/launchViteDevelopmentServer'
import { readViteServedModule } from './utils/readViteServedModule'

/**
 * The Vite development server behind {@link DevelopmentServerAdapter}: the owned launcher starts the app's own Vite, stops are sealed from the modules it serves, and the browser maps them through `webRoot` with per-script source maps.
 * Selected by {@link developmentServerAdapterOf} for `adapter: "vite-dev"`; the launcher module sits beside this module in the extension's output.
 */
export const VITE_DEV_ADAPTER: DevelopmentServerAdapter = {
  name: 'vite-dev',
  async assertWorkspace(workspace, node, signal) {
    await assessViteWorkspace(workspace, node, signal)
  },
  async start(request) {
    const workspaceInfo = await assessViteWorkspace(
      request.workspace,
      request.node,
      request.signal,
    )
    return launchViteDevelopmentServer(
      request,
      workspaceInfo,
      join(__dirname, 'viteLauncher.js'),
    )
  },
  // Vite has no development lock.
  readOwnedLock: async () => undefined,
  readBundle: (request) =>
    readViteServedModule(
      request.workspace,
      request.ownedOrigin,
      request.source,
      request.signal,
    ),
  browserDebugFields: (workspace) => ({
    webRoot: workspace,
    sourceMaps: true,
    perScriptSourcemaps: 'yes',
  }),
  isScriptOfModule: isViteScriptOfModule,
}
