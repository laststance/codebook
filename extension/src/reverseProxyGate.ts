import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import {
  REVERSE_PROXY_PROBE_TIMEOUT_MS,
  REVERSE_PROXY_PROOF_PATH_PREFIX,
  REVERSE_PROXY_PROOF_TIMEOUT_MS,
  REVERSE_PROXY_SYSTEM_CERTIFICATES_TIMEOUT_MS,
  type REVERSE_PROXY_STATES,
  type ReverseProxyRefusalReason,
} from './constants'
import type { DevelopmentApp } from './developmentServerAdapter'
import type { ReverseProxyDeclaration } from './reverseProxyDeclarationSchema'
import type { ReverseProxyRefusalFacts } from './reverseProxyRefusals'
import { buildDevelopmentServerEnvironment } from './utils/developmentServerEnvironment'
import { hostResolverRuleOf } from './utils/hostResolverRule'
import type { ParsedReverseProxyOrigin } from './utils/parseReverseProxyOrigin'
import { probeBrowserAddress } from './utils/probeBrowserAddress'
import { proveReverseProxy } from './utils/proveReverseProxy'
import { psProgramPath } from './utils/psProgramPath'
import { readSystemCertificates } from './utils/readSystemCertificates'
import {
  resolveReverseProxyHost,
  type ReverseProxyLookup,
} from './utils/resolveReverseProxyHost'
import {
  buildReverseProxyIdentityPreloadSource,
  expectedProofOf,
} from './utils/reverseProxyIdentityPreload'

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
  /** The process group of a process id, or `undefined` where the platform has no `ps` (Windows); rejects when `ps` fails. */
  processGroupOf: (processId: number) => Promise<number | undefined>
  /** Whether a process id still names a live process. */
  isProcessAlive: (processId: number) => boolean
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

/** Why the gate refused: the reason and the facts {@link reverseProxyRefusal} words it from. `facts.resourcesReleased` covers only what the gate itself holds (its throwaway browser is closed, nothing else); the run overwrites it with its confirmed cleanup, and fills `facts.logId` for `proof-unclassified`. */
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

/** The proof of the spawned server's `ps` field query, bounded so a stuck `ps` cannot hold the run. */
const PROCESS_QUERY_TIMEOUT_MS = 5_000

/** The facts of a proof the gate issues. */
type ProofFacts = {
  origin: string
  address: string
  provedAt: number
  serverPid: number
  cliPid: number
}

/** Every proof the gate issued; {@link ReverseProxyGate.admits} accepts no other instance. */
const ISSUED_PROOFS = new WeakSet<ReverseProxyProof>()

/** Set by the class's static block: the only way to build a proof outside its constructor. */
let issueProof: (facts: ProofFacts) => ReverseProxyProof

/**
 * The proof that this run's declared origin reaches the development server Codebook started: the origin, the validated address, when it was proved and the two process ids it is bound to.
 *
 * Why it exists: the saved session and the owned-origin rule rely on one fact with one owner. It is built only by {@link ReverseProxyGate.prove} after the transport and the browser check passed (a private constructor and a `WeakSet` of issued instances), lives in the run's gate and is gone with the run. Never stored in a configuration, a request or the MCP surface.
 */
export class ReverseProxyProof {
  static {
    issueProof = (facts) => {
      const proof = new ReverseProxyProof(facts)
      ISSUED_PROOFS.add(proof)
      return proof
    }
  }

  readonly origin: string
  readonly address: string
  readonly provedAt: number
  /** The process that answered the proof: Next's forked server child. */
  readonly serverPid: number
  /** The spawned CLI, whose process group the answer was bound to. */
  readonly cliPid: number

  private constructor(facts: ProofFacts) {
    this.origin = facts.origin
    this.address = facts.address
    this.provedAt = facts.provedAt
    this.serverPid = facts.serverPid
    this.cliPid = facts.cliPid
  }
}

/**
 * Reads the process group of a process with `ps`, started by an absolute path.
 *
 * Why it exists: the proof's answering process is Next's forked server child, so the answer is bound to the spawned group, not to the parent alone. Called by the gate's default {@link ReverseProxyDependencies.processGroupOf}.
 * @param processId - The answering process.
 * @returns The group id, or `undefined` on Windows, which has no `ps`.
 * @throws When `ps` is missing, fails or prints something else than a number.
 * @example
 * await readProcessGroup(process.pid) // => 4242
 */
async function readProcessGroup(
  processId: number,
): Promise<number | undefined> {
  // No `ps` on Windows: the spawned CLI's liveness alone binds the answer there.
  if (process.platform === 'win32') return undefined
  const { stdout } = await promisify(execFile)(
    await psProgramPath('The process group check of the proof'),
    ['-o', 'pgid=', '-p', String(processId)],
    { timeout: PROCESS_QUERY_TIMEOUT_MS },
  )
  if (!/^\s*\d+\s*$/.test(stdout))
    throw new Error('The process group of the proof is unreadable')
  return Number(stdout.trim())
}

/**
 * Tells whether a process id names a live process.
 * @param processId - The process to signal with signal 0.
 * @returns `true` when it exists.
 * @example
 * isProcessAlive(process.pid) // => true
 */
function isProcessAlive(processId: number): boolean {
  try {
    process.kill(processId, 0)
    return true
  } catch {
    return false
  }
}

/** The real dependencies a gate uses for every key a test does not override. */
const REAL_DEPENDENCIES: ReverseProxyDependencies = {
  lookup: (hostname, options) => lookup(hostname, options),
  readSystemCertificates,
  prove: proveReverseProxy,
  probe: probeBrowserAddress,
  processGroupOf: readProcessGroup,
  isProcessAlive,
}

/**
 * Splits a canonical origin into the parts the proof reads.
 * @param origin - The declared, already canonical origin.
 * @returns The parts of {@link ParsedReverseProxyOrigin}.
 * @example
 * originPartsOf('https://app.example.test:8443').effectivePort // => 8443
 */
function originPartsOf(
  origin: string,
): Extract<ParsedReverseProxyOrigin, { ok: true }> {
  const url = new URL(origin)
  const scheme = url.protocol === 'https:' ? 'https' : 'http'
  return {
    ok: true,
    origin,
    hostname: url.hostname,
    port: url.port,
    effectivePort: Number(url.port) || (scheme === 'https' ? 443 : 80),
    scheme,
  }
}

/** Draws `byteCount` random bytes as hex. */
function randomHex(byteCount: number): string {
  return randomBytes(byteCount).toString('hex')
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
  private readonly parts: Extract<ParsedReverseProxyOrigin, { ok: true }>
  private readonly dependencies: ReverseProxyDependencies
  private state: ReverseProxyView['state'] = 'resolving'
  private address: string | undefined
  private startFacts: ReverseProxyStartFacts | undefined
  private preloadFolder: string | undefined
  private proof: ReverseProxyProof | undefined
  private proofMs: number | undefined
  private app: Pick<DevelopmentApp, 'isRunning'> | undefined

  constructor(private readonly options: ReverseProxyGateOptions) {
    this.parts = originPartsOf(options.declaration.origin)
    this.dependencies = { ...REAL_DEPENDENCIES, ...options.dependencies }
  }

  /** The facts every failure carries. */
  private failure(
    reason: ReverseProxyRefusalReason,
    extra: Partial<ReverseProxyRefusalFacts> = {},
  ): ReverseProxyFailure {
    this.state = 'refused'
    return {
      reason,
      facts: {
        origin: this.parts.origin,
        upstreamPort: this.options.declaration.upstreamPort,
        resourcesReleased: true,
        ...extra,
      },
    }
  }

  /**
   * Resolves the declared host (loopback rule) and applies the same-socket rule; state `resolving`.
   * @param signal - The run's signal.
   * @returns `undefined` when the host is trusted, else the failure (`not-resolved`, `not-loopback` or `same-socket`).
   * @example
   * await gate.resolve(signal) // => { reason: 'not-loopback', facts: { …, address: '10.0.0.5' } }
   */
  async resolve(signal: AbortSignal): Promise<ReverseProxyFailure | undefined> {
    const resolved = await resolveReverseProxyHost(
      this.parts.hostname,
      { lookup: this.dependencies.lookup },
      signal,
    )
    if (!resolved.ok)
      return this.failure(
        resolved.reason,
        resolved.reason === 'not-loopback' ? { address: resolved.address } : {},
      )
    // The proxy and the server cannot share the socket the origin names.
    const isOwnSocket =
      this.parts.effectivePort === this.options.declaration.upstreamPort &&
      (resolved.address === '127.0.0.1' || resolved.address === '::1')
    if (isOwnSocket)
      return this.failure('same-socket', { address: resolved.address })
    this.address = resolved.address
    return undefined
  }

  /**
   * Draws the run's secret and writes the identity preload into a private temporary folder; after a passing resolution.
   * @returns The facts the start request adds: the declared port and the identity.
   * @throws When the host was not resolved first.
   * @example
   * const { identity } = await gate.preparePreload() // identity.preloadPath is a file in a 0700 folder
   */
  async preparePreload(): Promise<ReverseProxyStartFacts> {
    if (this.address === undefined)
      throw new Error('The reverse proxy host must be resolved first')
    // One folder and one secret per run, however often it is asked.
    if (this.startFacts !== undefined) return this.startFacts
    const folder = await mkdtemp(join(tmpdir(), 'codebook-reverse-proxy-'))
    this.preloadFolder = folder
    await chmod(folder, 0o700)
    const preloadPath = join(folder, 'identity-preload.cjs')
    await writeFile(preloadPath, buildReverseProxyIdentityPreloadSource(), {
      mode: 0o600,
    })
    this.startFacts = {
      upstreamPort: this.options.declaration.upstreamPort,
      identity: { preloadPath, secret: randomHex(32) },
    }
    return this.startFacts
  }

  /**
   * Waits for the started server to listen, sends the Node proof, binds the answer to the spawned process group, then runs the browser address check; state `proving`, then `proved`.
   * @param app - The started development server.
   * @param signal - The run's signal.
   * @returns `undefined` when proved, else the failure.
   * @throws When the server exits before it listens, the launch preparation was skipped, or the run is cancelled.
   * @example
   * await gate.prove(app, signal) // => undefined, and gate.admits('https://app.example.test') is true
   */
  async prove(
    app: Pick<DevelopmentApp, 'pid' | 'isRunning' | 'listening'>,
    signal: AbortSignal,
  ): Promise<ReverseProxyFailure | undefined> {
    if (this.address === undefined || this.startFacts === undefined)
      throw new Error('The reverse proxy must be resolved and prepared first')
    this.state = 'proving'
    const startedAt = Date.now()
    await app.listening(signal)
    const failure =
      (await this.proveWithNode(app, this.address, signal)) ??
      (await this.probeBrowser(this.address, signal))
    if (failure !== undefined) return failure
    this.proofMs = Date.now() - startedAt
    this.app = app
    this.state = 'proved'
    return undefined
  }

  /** The Node proof and the process binding; records the proof's pids on success. */
  private async proveWithNode(
    app: Pick<DevelopmentApp, 'pid' | 'isRunning'>,
    address: string,
    signal: AbortSignal,
  ): Promise<ReverseProxyFailure | undefined> {
    const certificates = await this.dependencies.readSystemCertificates(
      {
        nodeExecutable: this.options.nodeExecutable,
        environment: buildDevelopmentServerEnvironment(),
        timeoutMs: REVERSE_PROXY_SYSTEM_CERTIFICATES_TIMEOUT_MS,
      },
      signal,
    )
    if (!certificates.ok) return this.failure('proof-unclassified', { address })
    const challenge = randomHex(16)
    const result = await this.dependencies.prove(
      {
        origin: this.parts,
        address,
        challenge,
        expected: expectedProofOf(this.startFacts!.identity.secret, challenge),
        ca: certificates.certificates,
        timeoutMs: REVERSE_PROXY_PROOF_TIMEOUT_MS,
      },
      signal,
    )
    if (!result.ok) {
      const { ok, reason, ...facts } = result
      void ok
      return this.failure(reason, { address, ...facts })
    }
    return this.bindToProcessGroup(app, address, result.serverPid)
  }

  /** Binds the answering process to the spawned CLI's process group and issues the proof. */
  private async bindToProcessGroup(
    app: Pick<DevelopmentApp, 'pid' | 'isRunning'>,
    address: string,
    serverPid: number,
  ): Promise<ReverseProxyFailure | undefined> {
    const cliPid = app.pid
    if (cliPid === undefined || !app.isRunning())
      return this.failure('proof-wrong-server', { address, status: 200 })
    let group: number | undefined
    try {
      group = await this.dependencies.processGroupOf(serverPid)
    } catch {
      return this.failure('proof-unclassified', { address })
    }
    // A foreign process answered: it is not in the group Codebook spawned.
    if (group !== undefined && group !== cliPid)
      return this.failure('proof-wrong-server', { address, status: 200 })
    this.proof = issueProof({
      origin: this.parts.origin,
      address,
      provedAt: Date.now(),
      serverPid,
      cliPid,
    })
    return undefined
  }

  /** The throwaway browser's address check; clears the proof when it fails. */
  private async probeBrowser(
    address: string,
    signal: AbortSignal,
  ): Promise<ReverseProxyFailure | undefined> {
    const result = await this.dependencies.probe(
      {
        chromeBinary: this.options.chromeBinary,
        hostResolverRules: this.hostResolverRules(),
        url: `${this.parts.origin}${REVERSE_PROXY_PROOF_PATH_PREFIX}${randomHex(16)}`,
        expectedAddress: address,
        expectedPort: this.parts.effectivePort,
        timeoutMs: REVERSE_PROXY_PROBE_TIMEOUT_MS,
      },
      signal,
    )
    if (result.ok) return undefined
    this.proof = undefined
    const { ok, reason, ...facts } = result
    void ok
    return this.failure(reason, {
      address,
      ...(reason === 'proof-timeout'
        ? { timeoutMs: REVERSE_PROXY_PROBE_TIMEOUT_MS }
        : {}),
      ...facts,
    })
  }

  /**
   * The Chrome switch that pins the declared host to the validated address.
   * @returns The whole `--host-resolver-rules=…` switch; only after a passing resolution.
   * @throws When the host was not resolved first.
   * @example
   * gate.hostResolverRules() // => '--host-resolver-rules=MAP app.example.test 127.0.0.1'
   */
  hostResolverRules(): string {
    if (this.address === undefined)
      throw new Error('The reverse proxy host must be resolved first')
    return hostResolverRuleOf(this.parts.hostname, this.address)
  }

  /**
   * Tells whether the proof still admits an origin: only the normalized declared origin, while the spawned CLI and the answering server process both live.
   * @param origin - The origin to admit.
   * @returns `true` when admitted.
   * @example
   * gate.admits('https://app.example.test') // => true after a passing prove()
   */
  admits(origin: string): boolean {
    const proof = this.proof
    if (proof === undefined || !ISSUED_PROOFS.has(proof)) return false
    if (origin !== proof.origin) return false
    // Both the spawned parent and the answering child must still run.
    return (
      this.app?.isRunning() === true &&
      this.dependencies.isProcessAlive(proof.serverPid)
    )
  }

  /**
   * The run resource's `reverseProxy` block.
   * @returns {@link ReverseProxyView}.
   * @example
   * gate.view() // => { origin: 'https://app.example.test', upstreamPort: 4310, state: 'proved', address: '127.0.0.1', proofMs: 120 }
   */
  view(): ReverseProxyView {
    return {
      origin: this.parts.origin,
      upstreamPort: this.options.declaration.upstreamPort,
      state: this.state,
      ...(this.address === undefined ? {} : { address: this.address }),
      ...(this.proofMs === undefined ? {} : { proofMs: this.proofMs }),
    }
  }

  /** Removes the preload folder and invalidates the proof; idempotent. */
  async dispose(): Promise<void> {
    this.proof = undefined
    this.app = undefined
    const folder = this.preloadFolder
    this.preloadFolder = undefined
    if (folder !== undefined) await rm(folder, { recursive: true, force: true })
  }
}
