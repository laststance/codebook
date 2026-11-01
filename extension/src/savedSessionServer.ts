import type {
  DevelopmentApp,
  DevelopmentServerAdapter,
} from './developmentServerAdapter'
import type { SavedSessionServer } from './runtimeSupport/savedSessionTypes'
import { assertDevelopmentPortFree } from './utils/assertDevelopmentPortFree'
import { maskNextServerOutput } from './utils/maskNextServerOutput'
import { browserOriginOf } from './utils/ownedApplicationOrigin'
import {
  startIpv6LoopbackForwarder,
  type Ipv6LoopbackForwarder,
} from './utils/startIpv6LoopbackForwarder'

/** What a setup's server start acts through; the real ones unless a test names its own. */
export interface SavedSessionServerDependencies {
  assertPortFree: typeof assertDevelopmentPortFree
  startForwarder(port: number): Promise<Ipv6LoopbackForwarder | undefined>
}

/** What a setup's server start needs from the setup. */
export interface SavedSessionServerRequest {
  workspace: string
  node: string
  /** The path the server must answer before the browser opens. */
  signInPath: string
  /** Ends the start when the setup is closed. */
  signal: AbortSignal
}

const REAL_SERVER_DEPENDENCIES: SavedSessionServerDependencies = {
  assertPortFree: assertDevelopmentPortFree,
  startForwarder: startIpv6LoopbackForwarder,
}

/**
 * Starts the repository's own development server for a saved-session setup and waits until its sign-in path answers.
 * Why it exists: the learner signs in against the app on the project's own port (its auth origin points there), so the setup starts the server exactly as a run does and owns `[::1]` for `localhost`, but records nothing and opens no run.
 * Called through `StudyEnvironment.startSavedSessionServer` by the setup state machine; the caller closes the returned server in its own `finally`.
 * @param adapter - The repository's development server adapter.
 * @param request - The workspace, Node, sign-in path and a signal.
 * @param dependencies - The port check and the `[::1]` forwarder; the real ones in the product.
 * @returns The `http://localhost:<port>` origin, the port and a `close` that stops the forwarder and the server.
 * @throws What the adapter, the port check or the readiness wait throws; whatever started is closed first.
 * @example
 * const server = await startSavedSessionServer(developmentServerAdapterOf('next-dev-webpack'), { workspace, node, signInPath: '/login', signal })
 */
export async function startSavedSessionServer(
  adapter: DevelopmentServerAdapter,
  request: SavedSessionServerRequest,
  dependencies: SavedSessionServerDependencies = REAL_SERVER_DEPENDENCIES,
): Promise<SavedSessionServer> {
  let app: DevelopmentApp | undefined
  let forwarder: Ipv6LoopbackForwarder | undefined
  const closeAll = async (): Promise<void> => {
    // The forwarder frees its port first; the server's own close is awaited even when the forwarder's fails.
    try {
      await forwarder?.close()
    } finally {
      await app?.close()
    }
  }
  try {
    await adapter.assertWorkspace(
      request.workspace,
      request.node,
      request.signal,
    )
    const started = await adapter.start({
      workspace: request.workspace,
      node: request.node,
      record: () => undefined,
      inspectServer: false,
      signal: request.signal,
      alive: () => request.signal.throwIfAborted(),
      assertPortFree: (declared, refuse) =>
        dependencies.assertPortFree(declared, {
          signal: request.signal,
          ...(refuse ? { refuse } : {}),
        }),
      onStep: () => undefined,
      onDeclaredPort: () => undefined,
      onApp: (startedApp) => {
        app = startedApp
      },
      outputMask: maskNextServerOutput,
    })
    // A 3xx or 404 of the sign-in path is fine: the page the learner reaches is the app's own answer.
    const { origin } = await started.app.readyEntry(
      request.signal,
      request.signInPath,
    )
    forwarder = await dependencies.startForwarder(started.port)
    request.signal.throwIfAborted()
    return {
      origin: browserOriginOf(origin),
      port: started.port,
      close: closeAll,
    }
  } catch (error) {
    await closeAll().catch(() => undefined)
    throw error
  }
}
