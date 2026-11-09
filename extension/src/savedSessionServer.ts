import type {
  DevelopmentApp,
  DevelopmentServerAdapter,
} from './developmentServerAdapter'
import type { ReverseProxyDeclaration } from './reverseProxyDeclarationSchema'
import {
  ReverseProxyGate,
  type ReverseProxyFailure,
  type ReverseProxyGateOptions,
} from './reverseProxyGate'
import { reverseProxyRefusal } from './reverseProxyRefusals'
import type { SavedSessionServer } from './runtimeSupport/savedSessionTypes'
import { assertDevelopmentPortFree } from './utils/assertDevelopmentPortFree'
import { assertSavedSessionOrigin } from './utils/assertSavedSessionOrigin'
import { maskNextServerOutput } from './utils/maskNextServerOutput'
import { browserOriginOf } from './utils/ownedApplicationOrigin'
import {
  startIpv6LoopbackForwarder,
  type Ipv6LoopbackForwarder,
} from './utils/startIpv6LoopbackForwarder'

/** The part of {@link ReverseProxyGate} a setup at a declared origin uses; a test names a stand-in. */
export type SetupReverseProxyGate = Pick<
  ReverseProxyGate,
  | 'resolve'
  | 'preparePreload'
  | 'prove'
  | 'hostResolverRules'
  | 'admits'
  | 'dispose'
>

/** What a setup's server start acts through; the real ones unless a test names its own. */
export interface SavedSessionServerDependencies {
  assertPortFree: typeof assertDevelopmentPortFree
  startForwarder(port: number): Promise<Ipv6LoopbackForwarder | undefined>
  /** Builds the gate of a setup at a declared `reverseProxy` origin (API 1.40). */
  createGate(options: ReverseProxyGateOptions): SetupReverseProxyGate
}

/** What a setup's server start needs from the setup. */
export interface SavedSessionServerRequest {
  workspace: string
  node: string
  /** The path the server must answer before the browser opens. */
  signInPath: string
  /** Ends the start when the setup is closed. */
  signal: AbortSignal
  /** A setup at the origin a `reverseProxy` run declared (API 1.40): the declaration and the Chrome binary the throwaway browser check starts. Absent for a setup at localhost. */
  reverseProxy?: { declaration: ReverseProxyDeclaration; chromeBinary: string }
}

const REAL_SERVER_DEPENDENCIES: SavedSessionServerDependencies = {
  assertPortFree: assertDevelopmentPortFree,
  startForwarder: startIpv6LoopbackForwarder,
  createGate: (options) => new ReverseProxyGate(options),
}

/**
 * Starts the repository's own development server for a saved-session setup and waits until its sign-in path answers.
 * Why it exists: the learner signs in against the app on the project's own port (its auth origin points there), so the setup starts the server exactly as a run does and owns `[::1]` for `localhost`, but records nothing and opens no run.
 * With a `reverseProxy` declaration (API 1.40) the setup opens the app at the declared origin: it resolves the host, starts the server on the declared upstream port with the identity preload, proves that the origin reaches that server through the same {@link ReverseProxyGate} a run uses (so the pin rule and the proof have one owner), and only then asks for the sign-in path. Any failure closes everything it started, the gate included, and a refusal of the gate becomes the {@link reverseProxyRefusal} of its reason.
 * Called through `StudyEnvironment.startSavedSessionServer` by the setup state machine; the caller closes the returned server in its own `finally`.
 * @param adapter - The repository's development server adapter.
 * @param request - The workspace, Node, sign-in path, a signal and, for a declared origin, the declaration with the Chrome binary.
 * @param dependencies - The port check, the `[::1]` forwarder and the gate factory; the real ones in the product.
 * @returns The `http://localhost:<port>` origin (or the declared origin), the port, the cookie host, the `--host-resolver-rules` switch of a declared origin and a `close` that stops the forwarder, the server and the gate.
 * @throws What the adapter, the port check or the readiness wait throws, or `REVERSE_PROXY_REFUSED` / `SIGN_IN_ORIGIN_REFUSED` for a declared origin; whatever started is closed first.
 * @example
 * const server = await startSavedSessionServer(developmentServerAdapterOf('next-dev-webpack'), { workspace, node, signInPath: '/login', signal })
 * server.origin // => 'http://localhost:3000'
 */
export async function startSavedSessionServer(
  adapter: DevelopmentServerAdapter,
  request: SavedSessionServerRequest,
  dependencies: SavedSessionServerDependencies = REAL_SERVER_DEPENDENCIES,
): Promise<SavedSessionServer> {
  const declared = request.reverseProxy?.declaration
  const gate = request.reverseProxy
    ? dependencies.createGate({
        chromeBinary: request.reverseProxy.chromeBinary,
        declaration: request.reverseProxy.declaration,
        nodeExecutable: request.node,
      })
    : undefined
  let app: DevelopmentApp | undefined
  let forwarder: Ipv6LoopbackForwarder | undefined
  let closing: Promise<void> | undefined
  const closeParts = async (): Promise<void> => {
    // The forwarder frees its port first; the server's own close is awaited even when the forwarder's fails, and the gate goes last.
    try {
      await forwarder?.close()
    } finally {
      try {
        await app?.close()
      } finally {
        await gate?.dispose()
      }
    }
  }
  // One close for every exit path, so a refusal that confirms the release and the catch below never close twice.
  const closeAll = (): Promise<void> => (closing ??= closeParts())
  /** Closes what started, confirms it, and throws the refusal of the gate's reason. */
  const refuse = async (failure: ReverseProxyFailure): Promise<never> => {
    const resourcesReleased = await closeAll().then(
      () => true,
      () => false,
    )
    throw reverseProxyRefusal(failure.reason, {
      ...failure.facts,
      // A gate refusal that already reports an unconfirmed release stays false whatever this cleanup confirms.
      resourcesReleased: resourcesReleased && failure.facts.resourcesReleased,
    })
  }
  try {
    const resolveFailure = await gate?.resolve(request.signal)
    if (resolveFailure) return await refuse(resolveFailure)
    const startFacts = await gate?.preparePreload()
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
      assertPortFree: (declaredPort, refuseWith) =>
        dependencies.assertPortFree(declaredPort, {
          signal: request.signal,
          ...(refuseWith ? { refuse: refuseWith } : {}),
        }),
      onStep: () => undefined,
      onDeclaredPort: () => undefined,
      onApp: (startedApp) => {
        app = startedApp
      },
      outputMask: maskNextServerOutput,
      // The same start facts as a run: the declared port and the identity the proof relies on.
      ...(startFacts ? { reverseProxy: startFacts } : {}),
    })
    // The proof comes before any request that runs the app's code, the sign-in path included.
    const proofFailure = await gate?.prove(started.app, request.signal)
    if (proofFailure) return await refuse(proofFailure)
    // A 3xx or 404 of the sign-in path is fine: the page the learner reaches is the app's own answer.
    const { origin } = await started.app.readyEntry(
      request.signal,
      request.signInPath,
      undefined,
      undefined,
      declared?.origin,
    )
    forwarder = await dependencies.startForwarder(started.port)
    request.signal.throwIfAborted()
    if (gate && declared)
      return declaredServerOf(gate, declared, origin, started.port, closeAll)
    return {
      origin: browserOriginOf(origin),
      port: started.port,
      cookieHost: 'localhost',
      close: closeAll,
    }
  } catch (error) {
    await closeAll().catch(() => undefined)
    throw error
  }
}

/**
 * Consults the proof once more, then words the server a setup at a declared origin hands to the setup browser.
 * Why it exists: the setup may open its browser (which holds the saved profile) only at an origin this start proved, and only while the proof still admits it. Called by {@link startSavedSessionServer} after the readiness request and the forwarder.
 * @param gate - The gate that proved the origin.
 * @param declared - The declaration the setup opens the app at.
 * @param ownedOrigin - The loopback origin the readiness request reported, such as `http://127.0.0.1:4310`.
 * @param port - The upstream port the server listens on.
 * @param close - Stops the forwarder, the server and the gate.
 * @returns The declared origin, its pin switch and its cookie host.
 * @throws {@link StudyError} `SIGN_IN_ORIGIN_REFUSED` (`origin-not-proven`) when the proof no longer admits the declared origin.
 * @example
 * declaredServerOf(gate, { origin: 'https://app.example.test', upstreamPort: 4310 }, 'http://127.0.0.1:4310', 4310, close).cookieHost // => 'app.example.test'
 */
function declaredServerOf(
  gate: SetupReverseProxyGate,
  declared: ReverseProxyDeclaration,
  ownedOrigin: string,
  port: number,
  close: () => Promise<void>,
): SavedSessionServer {
  assertSavedSessionOrigin(ownedOrigin, {
    origin: declared.origin,
    admits: () => gate.admits(declared.origin),
  })
  return {
    origin: declared.origin,
    port,
    hostResolverRules: gate.hostResolverRules(),
    cookieHost: new URL(declared.origin).hostname,
    close,
  }
}
