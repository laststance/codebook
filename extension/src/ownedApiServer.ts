import { setTimeout as delay } from 'node:timers/promises'

import {
  NODE_SERVER_GROUP_EXIT_POLL_MS,
  NODE_SERVER_READY_TIMEOUT_MS,
  NODE_SERVER_STOP_DEADLINE_MS,
  OWNED_API_SERVER_OUTPUT_SETTLE_MS,
} from './constants'
import { StudyError } from './errors'
import {
  withDefaultNodeLoader,
  type NodeServerConfiguration,
} from './nodeServerConfigSchemas'
import type { Cdp } from './runtimeSupport/cdp'
import { waitUntil } from './runtimeSupport/utils/waitUntil'
import { assertNodeServerPortFree } from './utils/assertNodeServerPortFree'
import type { ProcessOutputEvent } from './utils/captureProcessOutput'
import {
  serverExitedError,
  serverNotListeningError,
} from './utils/describeNodeServerRunFailure'
import { expandLearnerSecretForms } from './utils/expandLearnerSecretForms'
import { findPortOccupant } from './utils/findPortOccupant'
import { isProcessGroupGone } from './utils/isProcessGroupGone'
import {
  launchNodeServer,
  type NodeServerCloseOptions,
  type NodeServerExit,
} from './utils/launchNodeServer'
import { maskRunSecrets } from './utils/maskRunSecrets'
import {
  beginReleaseOfOwnedDevelopmentPort,
  claimOwnedDevelopmentPort,
  releaseOwnedDevelopmentPort,
  type OwnedDevelopmentPortClaim,
} from './utils/ownedDevelopmentPorts'
import { readListeningPortsOfProcess } from './utils/readListeningPortsOfProcess'
import {
  resolveNodeServerLaunch,
  type ResolvedNodeServerLaunch,
} from './utils/resolveNodeServerLaunch'
import type { CauseRoots } from './utils/sanitizeCause'
import { signalProcessGroup } from './utils/signalProcessGroup'
import { verifyListenerOwnership } from './utils/verifyListenerOwnership'
import { verifyNodeTestInspectorOwnership } from './utils/verifyNodeTestInspectorOwnership'
import { readInspectorThreadIdentity } from './utils/verifyServerInspectorOwnership'
import { waitForServerReadiness } from './utils/waitForServerReadiness'

/** The declaration fields an owned API server needs: where it runs, what it runs, how it is loaded and the port its own code listens on. */
export type OwnedApiServerDeclaration = Pick<
  NodeServerConfiguration,
  'packageRoot' | 'entry' | 'port'
> & { loader?: NodeServerConfiguration['loader'] }

/** What {@link OwnedApiServer.check} is given. */
export type OwnedApiServerInput = {
  /** The opened repository's real root. */
  workspace: string
  declaration: OwnedApiServerDeclaration
  /** The external Node executable and its version. */
  node: { executable: string; version: string }
  /** Journals `node-server.*` events of the launch and the close. */
  record: (type: string, detail?: unknown) => unknown
  /** Receives each masked, stamped output chunk at once. */
  onOutput?: (event: ProcessOutputEvent) => void | Promise<void>
  /** The values the learner typed during the run, read at every output chunk (the set grows after the launch); they are masked in every form a server may echo. */
  secrets?: () => ReadonlySet<string>
  /** Called with the byte count of held output that was dropped instead of published. */
  onWithheld?: (bytes: number) => void
  /** The private roots the output must not carry. */
  privateRoots?: CauseRoots
  /** Cancels the checks. */
  signal?: AbortSignal
  /** How long the listener may take to appear, in running time; {@link NODE_SERVER_READY_TIMEOUT_MS} unless a test names its own. */
  readyTimeoutMs?: number
}

/** How the API process ended: the leader's exit and the masked last output. */
export type OwnedApiServerExit = NodeServerExit & {
  /** The server's last output, learner secrets masked; the failure words hide private paths ({@link OwnedApiServer.exitError}). */
  outputTail: string
}

/** What {@link OwnedApiServer.verifyInspector} proves: the inspected JavaScript thread is the launched process's main thread, in its folder and group. */
export type OwnedApiServerIdentity = {
  pid: number
  processGroup: number
  /** The API's real package root. */
  workspace: string
  isMainThread: boolean
  threadId: number
}

/** The loopback endpoint the API accepts on, with its listener verified as the launched process's. */
export type OwnedApiServerListener = { host: '127.0.0.1' | '::1'; port: number }

/**
 * Builds the live mask of the launcher: every member reads the learner's secrets at call time, so a value typed after the launch is masked from then on.
 * Called by the launch of {@link OwnedApiServer.check}.
 * @param secrets - Reads the run's current secret values.
 * @param onWithheld - Told the byte count of dropped held output.
 * @returns The mask the launcher applies before output is journaled or stored.
 * @example
 * buildLiveMask(() => new Set(['hunter2']), () => undefined).mask('pw hunter2') // => 'pw [masked]'
 */
function buildLiveMask(
  secrets: () => ReadonlySet<string>,
  onWithheld: (bytes: number) => void,
) {
  let cached: { key: string; forms: Set<string>; longest: number } | undefined
  // The forms are rebuilt only when the secret set changed since the last chunk.
  const current = (): NonNullable<typeof cached> => {
    const values = secrets()
    const key = [...values].join('\u0000')
    if (cached?.key !== key) {
      const forms = expandLearnerSecretForms(values, true)
      cached = {
        key,
        forms,
        longest: Math.max(0, ...[...forms].map((form) => form.length)),
      }
    }
    return cached
  }
  return {
    mask: (text: string): string =>
      secrets().size === 0 ? text : maskRunSecrets(text, current().forms),
    holdback: (): number => (secrets().size === 0 ? 0 : current().longest),
    forms: (): readonly string[] =>
      secrets().size === 0 ? [] : [...current().forms],
    onWithheld,
  }
}

/** An API launch that passed the side-effect-free checks ({@link OwnedApiServer.check}); nothing is spawned until {@link CheckedApiServer.launch}. */
export type CheckedApiServer = {
  /** The real package root and entry the launch will run. */
  resolved: ResolvedNodeServerLaunch
  /** Spawns `node --inspect-brk=127.0.0.1:0 [--import <loader>] <entry>`; the process stays paused before its first line. */
  launch(): Promise<OwnedApiServer>
}

/**
 * One API process a browser run owns (Issue #258): checked, launched under `--inspect-brk`, verified over its inspector, released by the run's debugger, waited for on its declared port, and ended (kill-first when a pause is held, or normally).
 * Why: the browser run attaches a debugger to the learner's own API; this class wraps {@link launchNodeServer} (arguments, environment, group, output capture and close unchanged) and adds the pieces the browser run needs that the node-server run keeps privately.
 * Called by the browser run's API preparation and cleanup. Failures are the node-server run's {@link StudyError} codes: `NODE_SERVER_SOURCE_REFUSED`, `PORT_UNAVAILABLE`, `SERVER_EXITED`, `SERVER_NOT_LISTENING`, `LISTENER_NOT_OWNED`, `PORT_OWNER_UNKNOWN`.
 * @example
 * const checked = await OwnedApiServer.check(input)
 * const api = await checked.launch()
 * const endpoint = await api.inspectorEndpoint(signal)
 */
export class OwnedApiServer {
  /** The launched process id. */
  readonly pid: number
  /** The launched process group's id (the leader's pid). */
  readonly processGroup: number
  /** The API's real package root. */
  readonly packageRoot: string
  /** The declared port the API's own code listens on. */
  readonly port: number
  private inspectorPort?: number
  private exitFact?: Promise<OwnedApiServerExit>
  private closing?: Promise<OwnedApiServerExit>
  private killedFirst = false

  private constructor(
    private readonly launched: Awaited<ReturnType<typeof launchNodeServer>>,
    private readonly input: OwnedApiServerInput,
    resolved: ResolvedNodeServerLaunch,
    private readonly claim: OwnedDevelopmentPortClaim,
  ) {
    if (launched.pid === undefined)
      throw new Error('The API server process did not start.')
    this.pid = launched.pid
    this.processGroup = launched.pid
    this.packageRoot = resolved.packageRoot
    this.port = input.declaration.port
  }

  /**
   * Checks the launch without any side effect: the real package root, entry and loader on disk, and the declared port free.
   * @param input - The repository, the declaration, the Node, the journal and the live mask ({@link OwnedApiServerInput}).
   * @returns The checked launch.
   * @throws `NODE_SERVER_SOURCE_REFUSED` for a path or loader that is missing or leaves the repository; `PORT_UNAVAILABLE` for a taken port.
   * @example const checked = await OwnedApiServer.check(input)
   */
  static async check(input: OwnedApiServerInput): Promise<CheckedApiServer> {
    const { declaration } = input
    const resolved = await resolveNodeServerLaunch(
      input.workspace,
      withDefaultNodeLoader({
        packageRoot: declaration.packageRoot,
        entry: declaration.entry,
        loader: declaration.loader,
      }),
    )
    await assertNodeServerPortFree({
      port: declaration.port,
      signal: input.signal,
      findPortOccupant,
    })
    return {
      resolved,
      launch: async () => {
        const claim = claimOwnedDevelopmentPort(declaration.port)
        try {
          const launched = await launchNodeServer(
            {
              ...resolved,
              workspace: input.workspace,
              node: input.node,
              ...(input.privateRoots
                ? { privateRoots: input.privateRoots }
                : {}),
              ...(input.secrets
                ? {
                    knownValues: buildLiveMask(
                      input.secrets,
                      input.onWithheld ?? ((): void => undefined),
                    ),
                  }
                : {}),
            },
            input.record,
            input.onOutput,
          )
          return new OwnedApiServer(launched, input, resolved, claim)
        } catch (error) {
          // A launch that never produced a server holds no port.
          releaseOwnedDevelopmentPort(claim)
          throw error
        }
      },
    }
  }

  /**
   * Waits for the inspector announcement of this very process.
   * @param signal - Cancels the wait.
   * @returns The `ws://127.0.0.1:<port>/<id>` endpoint.
   * @throws When the process exits first or announces nothing in time.
   * @example await api.inspectorEndpoint(signal) // => 'ws://127.0.0.1:58209/543bb4f3-…'
   */
  async inspectorEndpoint(signal: AbortSignal): Promise<string> {
    const endpoint = await this.launched.inspectorEndpoint(signal)
    this.inspectorPort = Number(new URL(endpoint).port)
    return endpoint
  }

  /**
   * Proves an inspector is the launched process's main thread: its cwd is the API's real package root, its pid is in the launched group, and it is the main JavaScript thread (E-2).
   * @param inspector - The connected inspector, paused at the entry.
   * @param signal - Cancels the check.
   * @returns The identity the browser run's server selection filters on.
   * @throws When the process ended, the inspector is foreign, or an answer is malformed.
   * @example (await api.verifyInspector(cdp, signal)).isMainThread // => true
   */
  async verifyInspector(
    inspector: Pick<Cdp, 'request'>,
    signal: AbortSignal,
  ): Promise<OwnedApiServerIdentity> {
    const assertRunning = (): void => {
      if (this.launched.exitedEvent() || this.closing)
        throw new Error(
          'Owned API server is unavailable for inspector verification',
        )
    }
    const owner = await verifyNodeTestInspectorOwnership(
      inspector,
      this.packageRoot,
      this.processGroup,
      signal,
      assertRunning,
    )
    const thread = await readInspectorThreadIdentity(
      inspector,
      signal,
      assertRunning,
    )
    return { ...owner, ...thread }
  }

  /**
   * Waits until the launched process accepts on the declared port and the listener is its own, racing its exit and the ready bound.
   * Called after the browser run released the entry pause.
   * @param signal - Cancels the wait.
   * @returns The accepted loopback endpoint.
   * @throws `SERVER_EXITED` when the process exits first; `SERVER_NOT_LISTENING` when the bound passes (naming another port the process listens on, if any); `LISTENER_NOT_OWNED` or `PORT_OWNER_UNKNOWN` for a listener that is not the launched group's.
   * @example await api.waitForListener(signal) // => { host: '127.0.0.1', port: 4100 }
   */
  async waitForListener(signal: AbortSignal): Promise<OwnedApiServerListener> {
    const stopProbing = new AbortController()
    const probeSignal = AbortSignal.any([signal, stopProbing.signal])
    const deadline =
      performance.now() +
      (this.input.readyTimeoutMs ?? NODE_SERVER_READY_TIMEOUT_MS)
    try {
      const outcome = await Promise.race([
        waitForServerReadiness({
          port: this.port,
          hasTimeLeft: () => performance.now() < deadline,
          signal: probeSignal,
        }),
        this.launched.whenExitEvent().then(() => 'exited' as const),
      ])
      if (outcome === 'exited') throw await this.exitError()
      if (!outcome) throw await this.notListeningError()
      const verdict = await verifyListenerOwnership({
        port: this.port,
        selectedHost: outcome.host,
        ownerPid: this.pid,
        processGroup: this.processGroup,
        acceptedWithoutListener: true,
      })
      if (!verdict.owned) throw new StudyError(verdict.code, verdict.message)
      return { host: outcome.host, port: this.port }
    } finally {
      // Ends a probe round that lost the race.
      stopProbing.abort()
    }
  }

  /** Builds `SERVER_NOT_LISTENING`, naming a port the process listens on instead of the declared one. */
  private async notListeningError(): Promise<StudyError> {
    const ports = await readListeningPortsOfProcess(this.pid).catch(() => [])
    return serverNotListeningError(
      this.port,
      ports.find((port) => port !== this.port && port !== this.inspectorPort),
    )
  }

  /**
   * The exit fact, usable at any time: settles when the leader exits, with its code or signal and the masked last output.
   * The browser run's failure arbiter prefers it over a transport loss (E-6).
   * @returns The exit fact; it never rejects.
   * @example (await api.whenExited()).exitCode // => 5
   */
  whenExited(): Promise<OwnedApiServerExit> {
    this.exitFact ??= (async () => {
      const exit = await this.launched.whenExitEvent()
      // Let the output pipes drain so the tail holds the last line; a descendant holding them open cannot delay it past the bound.
      await Promise.race([
        this.launched.whenExited(),
        delay(OWNED_API_SERVER_OUTPUT_SETTLE_MS),
      ])
      return { ...exit, outputTail: this.launched.output() }
    })()
    return this.exitFact
  }

  /**
   * Words the process's exit as `SERVER_EXITED` with its masked last output.
   * @returns The typed error.
   * @example throw await api.exitError()
   */
  async exitError(): Promise<StudyError> {
    const fact = await this.whenExited()
    return serverExitedError(fact, fact.outputTail, this.input.workspace)
  }

  /**
   * Kill-first (E-4): SIGKILL to the whole group so a paused or in-flight handler never resumes, then waits until the group is observed gone.
   * The browser run calls it before any resume or detach when a pause is held or a request is in flight. Idempotent.
   * @returns How the process ended.
   * @throws When the group outlives the stop deadline.
   * @example await api.killIfPaused() // => { exitCode: null, signal: 'SIGKILL', outputTail: '' }
   */
  async killIfPaused(): Promise<OwnedApiServerExit> {
    this.killedFirst = true
    // A group that already ended may belong to another process now, so it is not signalled again.
    if (!isProcessGroupGone(this.processGroup))
      signalProcessGroup(this.processGroup, 'SIGKILL')
    await waitUntil(
      () => isProcessGroupGone(this.processGroup),
      'owned API server process group exit',
      NODE_SERVER_STOP_DEADLINE_MS,
      undefined,
      NODE_SERVER_GROUP_EXIT_POLL_MS,
    )
    // The group is gone, so the normal close only settles the output and the journal.
    return this.close()
  }

  /**
   * Normal stop: the node-server run's graceful end (debugger detach, SIGTERM, then SIGKILL after its bound), resolved when the group is gone. Idempotent.
   * @param detachDebugger - Ends the run's debugger session for this process; skipped when absent.
   * @param options - The stop's clock and bounds ({@link NodeServerCloseOptions}).
   * @returns How the process ended.
   * @throws When the group outlives the stop deadline.
   * @example await api.close(() => session.detach())
   */
  close(
    detachDebugger?: () => Promise<void>,
    options?: NodeServerCloseOptions,
  ): Promise<OwnedApiServerExit> {
    beginReleaseOfOwnedDevelopmentPort(this.claim)
    const attempt = (this.closing ??= (async () => {
      await this.launched.close(detachDebugger, options)
      releaseOwnedDevelopmentPort(this.claim)
      this.input.record('api-server.ended', {
        pid: this.pid,
        killedFirst: this.killedFirst,
      })
      return this.whenExited()
    })())
    // A failed close may be retried by a later call.
    attempt.catch(() => {
      if (this.closing === attempt) this.closing = undefined
    })
    return attempt
  }
}
