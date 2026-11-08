import type {
  REVERSE_PROXY_STATES,
  ReverseProxyRefusalReason,
} from './constants'
import type { DevelopmentApp } from './developmentServerAdapter'
import type { ReverseProxyDeclaration } from './reverseProxyDeclarationSchema'
import type { ReverseProxyRefusalFacts } from './reverseProxyRefusals'
import type { probeBrowserAddress } from './utils/probeBrowserAddress'
import type { proveReverseProxy } from './utils/proveReverseProxy'
import type { readSystemCertificates } from './utils/readSystemCertificates'
import type { ReverseProxyLookup } from './utils/resolveReverseProxyHost'

/** The stand-ins a test injects and the real ones the product uses. */
export type ReverseProxyDependencies = {
  /** The host resolver, {@link ReverseProxyLookup}. */
  lookup: ReverseProxyLookup
  /** The read of the operating system's certificates. */
  readSystemCertificates: typeof readSystemCertificates
  /** The Node proof request. */
  prove: typeof proveReverseProxy
  /** The throwaway browser's address check. */
  probe: typeof probeBrowserAddress
}

/** What {@link ReverseProxyGate} is built from. */
export type ReverseProxyGateOptions = {
  /** The Chrome binary the real browser uses (`host.chrome.binary`, or the setup's `chromeExecutable`); the probe starts the same one. */
  chromeBinary: string
  /** The sealed declaration; the origin is already canonical. */
  declaration: ReverseProxyDeclaration
  /** The run's resolved Node executable, which reads the system certificates. */
  nodeExecutable: string
  /** Overrides of the real dependencies; absent keys use the real ones. */
  dependencies?: Partial<ReverseProxyDependencies>
}

/** Why the gate refused: the reason and the facts {@link reverseProxyRefusal} words it from. */
export type ReverseProxyFailure = {
  reason: ReverseProxyRefusalReason
  facts: ReverseProxyRefusalFacts
}

/** What the gate adds to the start request of the development server. */
export type ReverseProxyStartFacts = {
  upstreamPort: number
  identity: { preloadPath: string; secret: string }
}

/** What the run resource shows of the declaration. */
export type ReverseProxyView = {
  origin: string
  upstreamPort: number
  state: (typeof REVERSE_PROXY_STATES)[number]
  address?: string
  proofMs?: number
}

/**
 * The proof that this run's declared origin reaches the development server Codebook started: the origin, the validated address, when it was proved and the two process ids it is bound to.
 *
 * Why it exists: the saved session and the owned-origin rule rely on one fact with one owner. It is built only by {@link ReverseProxyGate.prove} after the transport and the browser check passed (a module-private constructor and a `WeakSet` of issued instances), lives in the run's gate and is gone with the run. Never stored in a configuration, a request or the MCP surface.
 */
export class ReverseProxyProof {
  readonly origin!: string
  readonly address!: string
  readonly provedAt!: number
  /** The process that answered the proof: Next's forked server child. */
  readonly serverPid!: number
  /** The spawned CLI, whose process group the answer was bound to. */
  readonly cliPid!: number
}

/**
 * The whole runtime of a `reverseProxy` declaration: resolve, same-socket rule, identity secret and preload file, proof, pin rule, state, view and dispose.
 *
 * Why it exists: the run ({@link ConfiguredBrowserRun}) and the saved-session setup (`startSavedSessionServer`) are its two callers, so the pin rule, the proof state and the owned-origin rule have one owner. Methods that can refuse return a {@link ReverseProxyFailure} instead of throwing, and the caller words it with {@link reverseProxyRefusal}.
 * @example
 * const gate = new ReverseProxyGate({ chromeBinary, declaration, nodeExecutable })
 * const failure = await gate.resolve(signal) // => undefined when the host is a trusted loopback address
 */
export class ReverseProxyGate {
  constructor(options: ReverseProxyGateOptions) {
    void options
    throw new Error('not implemented')
  }

  /**
   * Resolves the declared host (loopback rule) and applies the same-socket rule; state `resolving`.
   * @param signal - The run's signal.
   * @returns `undefined` when the host is trusted, else the failure (`not-resolved`, `not-loopback` or `same-socket`).
   */
  async resolve(signal: AbortSignal): Promise<ReverseProxyFailure | undefined> {
    void signal
    throw new Error('not implemented')
  }

  /**
   * Draws the run's secret and writes the identity preload into a private temporary folder; after a passing resolution.
   * @returns The facts the start request adds: the declared port and the identity.
   */
  async preparePreload(): Promise<ReverseProxyStartFacts> {
    throw new Error('not implemented')
  }

  /**
   * Waits for the started server to listen, sends the Node proof, binds the answer to the spawned process group, then runs the browser address check; state `proving`, then `proved`.
   * @param app - The started development server.
   * @param signal - The run's signal.
   * @returns `undefined` when proved, else the failure.
   */
  async prove(
    app: Pick<DevelopmentApp, 'pid' | 'isRunning' | 'listening'>,
    signal: AbortSignal,
  ): Promise<ReverseProxyFailure | undefined> {
    void app
    void signal
    throw new Error('not implemented')
  }

  /**
   * The Chrome switch that pins the declared host to the validated address.
   * @returns The whole `--host-resolver-rules=…` switch; only after a passing resolution.
   */
  hostResolverRules(): string {
    throw new Error('not implemented')
  }

  /**
   * Tells whether the proof still admits an origin: only the normalized declared origin, while the spawned CLI and the answering server process both live.
   * @param origin - The origin to admit.
   * @returns `true` when admitted.
   */
  admits(origin: string): boolean {
    void origin
    throw new Error('not implemented')
  }

  /**
   * The run resource's `reverseProxy` block.
   * @returns {@link ReverseProxyView}.
   */
  view(): ReverseProxyView {
    throw new Error('not implemented')
  }

  /** Removes the preload folder and invalidates the proof; idempotent. */
  async dispose(): Promise<void> {
    throw new Error('not implemented')
  }
}
