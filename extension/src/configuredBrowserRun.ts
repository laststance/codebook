import { randomUUID } from 'node:crypto'
import { lstat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import type { DebugProtocol } from '@vscode/debugprotocol'
import type { Protocol } from 'devtools-protocol'
import * as vscode from 'vscode'
import { z } from 'zod'

import {
  configuredDefinitionSchema,
  type ConfiguredDefinition,
} from './configuredStudySchemas'
import type { CONFIGURED_CAPTURE_PHASES } from './constants'
import {
  ACTIVE_TIMEOUT_MS,
  MAX_EVENTS,
  MAX_QUEUED_EVIDENCE_BYTES,
  MAX_RETAINED_EVENT_BYTES,
  MILLISECONDS_PER_SECOND,
  REPOSITORY_BINDING_HINT_EDGE_LINES,
  REPOSITORY_BINDING_HINT_NEAR_LINES,
  REPOSITORY_BROWSER_ACTION,
  REPOSITORY_BROWSER_PROFILE,
  REPOSITORY_PAUSE_HOLD_TIMEOUT_MS,
  REPOSITORY_PATH_LIMIT_CHARS,
  REPOSITORY_RUN_TIMEOUT_MS,
  REPOSITORY_SCRIPT_DIAGNOSTIC_LIMIT,
  REPOSITORY_SETUP_TIMEOUT_MS,
  REPOSITORY_STACK_FRAME_LIMIT,
} from './constants'
import { StudyError } from './errors'
import { OwnedRepositoryBreakpoint } from './ownedRepositoryBreakpoint'
import type { BundleSource } from './repositoryBundle'
import { RepositorySourceService } from './repositorySource'
import type {
  ConfiguredRuntimeSnapshot,
  ConfiguredRuntimeView,
  RuntimeAction,
  RuntimeControl,
  RuntimeSnapshot,
  StudyRuntime,
  Participant,
} from './runtime'
import type { BrowserViewportFactory } from './runtimeSupport/browserViewport'
import { Cdp } from './runtimeSupport/cdp'
import { CAPTURE_TIMEOUT_MS, RESUME_COMMANDS } from './runtimeSupport/constants'
import { Evidence } from './runtimeSupport/evidence'
import {
  HostBrowser,
  type HostConfiguration,
} from './runtimeSupport/hostBrowser'
import { PauseGate, type PauseIdentity } from './runtimeSupport/pauseGate'
import { awaitResponse } from './runtimeSupport/utils/awaitResponse'
import { settleCleanup } from './runtimeSupport/utils/settleCleanup'
import { sha256 } from './runtimeSupport/utils/sha256'
import { waitUntil } from './runtimeSupport/utils/waitUntil'
import { assertConfiguredDescriptor } from './utils/assertConfiguredDescriptor'
import { assertConfiguredSourceDocuments } from './utils/assertConfiguredSourceDocuments'
import {
  assertDevelopmentWorkspace,
  type DevelopmentLockIdentity,
} from './utils/assertDevelopmentWorkspace'
import { captureReplayDebugSnapshot } from './utils/captureReplayDebugSnapshot'
import { configuredConditionHint } from './utils/configuredConditionHint'
import { configuredDomExpression } from './utils/configuredDomExpression'
import { configuredStops } from './utils/configuredStops'
import { continuationReceipts } from './utils/continuationReceipts'
import { createBundleVerifier } from './utils/createBundleVerifier'
import { describeCdpPause } from './utils/describeCdpPause'
import { elapsedMsSince } from './utils/elapsedMsSince'
import { inspectConfiguredValues } from './utils/inspectConfiguredValues'
import { isBindingLineAccepted } from './utils/isBindingLineAccepted'
import { isFrameAtPosition } from './utils/isFrameAtPosition'
import { isPauseAtStop } from './utils/isPauseAtStop'
import { isPauseInScript } from './utils/isPauseInScript'
import { isRefreshedFrameAtStop } from './utils/isRefreshedFrameAtStop'
import { launchDevelopmentServer } from './utils/launchDevelopmentServer'
import { pausePlace } from './utils/pausePlace'
import { prepareRepositoryInputs } from './utils/prepareRepositoryInputs'
import { readDevelopmentBundle } from './utils/readDevelopmentBundle'
import { sameScriptUrl } from './utils/sameScriptUrl'
import { thrownMessage } from './utils/thrownMessage'
import {
  withUnannouncedPauses,
  type UnannouncedPausePlace,
} from './utils/withUnannouncedPauses'

interface ConfiguredBrowserOptions {
  directory: string
  workspace: string
  node: string
  host: HostConfiguration
  definition: ConfiguredDefinition
  assertWorkspace(): void
  createViewport?: BrowserViewportFactory
  revealSource(snapshot: ConfiguredRuntimeSnapshot): Promise<void>
  control?: RuntimeControl
}
type PreparedStop = ReturnType<typeof configuredStops>[number] & {
  bundle: BundleSource
  verifier: ReturnType<typeof createBundleVerifier>
  script?: Protocol.Debugger.ScriptParsedEvent
  breakpoint?: OwnedRepositoryBreakpoint
  /** The debugger's verified binding, on the declared line or on a later line {@link PreparedStop.acceptsBoundLine} accepts; every later check, the saved observation and the display use it instead of the requested position. */
  bound?: { line: number; column: number }
  /** Tells whether a line the debugger chose is this stop's place: the declared line, or a later line within the stop's citation with no mapped line between ({@link isBindingLineAccepted}). Every site that compares a binding or a pause with this stop asks it. */
  acceptsBoundLine: (line: number) => boolean
}
type DebugParticipant = {
  gate: PauseGate
  selected?: vscode.DebugSession
  cdp?: Cdp
  /** The pause of the expected declared stop: on its declared line in its module, or adopted after an announced pause stayed elsewhere in that module. `generation` is set once {@link ConfiguredBrowserRun.inspect} binds it to an accepted stop. */
  stopped?: { event: Protocol.Debugger.PausedEvent; generation?: number }
  /** A pause away from the expected declared stop that no debugger stop was accepted for, with the stop that was expected when it arrived (none between a snapshot and its continuation). The debug adapter makes such pauses for itself and resumes them; the resume retires it, and a deadline that expires meanwhile names it. */
  unannouncedPause?: {
    event: Protocol.Debugger.PausedEvent
    expectedStop: PreparedStop | undefined
  }
  /** Every script this participant announced, by script id, so the journal can name the place of a pause in any of them. */
  scriptUrls: Map<string, string>
  /** The journal clock when the last pause was observed; cleared by its resume. */
  pauseObservedAtMs?: number
  /** A DAP presentation refresh awaiting its matching stop and source check; the CDP target stays paused. */
  refresh?: {
    pause: PauseIdentity
    stopped: NonNullable<DebugParticipant['stopped']>
    stage: 'awaiting-stop' | 'validating'
  }
  expectedResumeRequests: number
}
type Continuation = {
  participant: Participant
  pause: PauseIdentity
  response: boolean
  dap: boolean
  cdp: boolean
  afterStarted: boolean
}
const domResultSchema = z.object({
  ready: z.boolean(),
  x: z.number().finite().optional(),
  y: z.number().finite().optional(),
  failure: z
    .object({
      conditionIndex: z.number().int().nonnegative().optional(),
      reason: z.enum([
        'invalid-selector',
        'selector-missing',
        'selector-not-unique',
        'not-visible',
        'text-mismatch',
        'attribute-mismatch',
        'click-target-missing',
        'click-target-not-unique',
        'click-target-not-visible',
        'click-target-disabled',
        'click-target-obscured',
      ]),
      // The only relation the page reports about a text mismatch; any other value fails the read instead of being dropped.
      textDifference: z.literal('surrounding-text').optional(),
    })
    .optional(),
})
const bindingSchema = z.object({
  verified: z.literal(true),
  line: z.number().int(),
  column: z.number().int(),
})
// Diagnostic parsing admits pending fields without granting them binding authority or retaining arbitrary adapter data.
const bindingReceiptSchema = z.object({
  id: z.number().int().optional(),
  verified: z.boolean().optional(),
  line: z.number().int().optional(),
  column: z.number().int().optional(),
  source: z
    .object({ path: z.string().max(REPOSITORY_PATH_LIMIT_CHARS).optional() })
    .optional(),
})

/** Owns one configured browser operation and its exact source/pause receipts through the shared Study lifecycle. @example await new ConfiguredBrowserRun(options).prepare() */
export class ConfiguredBrowserRun implements StudyRuntime {
  readonly id = randomUUID()
  readonly evidence: Evidence
  readonly definition: ConfiguredDefinition
  readonly activeSessions = new Set<string>()
  private readonly sessions = new Map<string, vscode.DebugSession>()
  private readonly participants: Record<Participant, DebugParticipant> = {
    browser: {
      gate: new PauseGate(),
      expectedResumeRequests: 0,
      scriptUrls: new Map(),
    },
    server: {
      gate: new PauseGate(),
      expectedResumeRequests: 0,
      scriptUrls: new Map(),
    },
  }
  private readonly stops: PreparedStop[] = []
  private readonly activities = new Set<Promise<void>>()
  private readonly acquisitions = new Set<Promise<unknown>>()
  private readonly abort = new AbortController()
  private readonly browser: HostBrowser
  private readonly sources: RepositorySourceService
  private preparedSources?: Awaited<
    ReturnType<RepositorySourceService['prepare']>
  >
  private app?: ReturnType<typeof launchDevelopmentServer>
  private ownedDevelopmentLock?: DevelopmentLockIdentity
  private preparation?: Promise<void>
  private cleanupPromise?: Promise<void>
  private manifest?: ConfiguredRuntimeView['manifest']
  private continuation?: Continuation
  private acceptedStop = false
  private stopIndex = 0
  private readonly snapshots: ConfiguredRuntimeSnapshot[] = []
  private pendingDapStop?: {
    participant: Participant
    event: DebugProtocol.Event
  }
  private pendingCdpStop?: {
    participant: Participant
    event: Protocol.Debugger.PausedEvent
  }
  private transientBrowserPause?: { timer: ReturnType<typeof setTimeout> }
  private progressTimer?: ReturnType<typeof setTimeout>
  private runTimer?: ReturnType<typeof setTimeout>
  private cleaning = false
  private cleaned = false
  private resourcesReleased = false
  private status = 'preparing'
  private origin?: string
  private operation?: ConfiguredRuntimeView['operation']
  private snapshot?: ConfiguredRuntimeSnapshot
  private snapshotReady = false
  private readonly failures: string[] = []
  private readonly captures: ConfiguredRuntimeView['captures'] = {}
  private readonly snapshotCaptures: NonNullable<
    ConfiguredRuntimeView['snapshotCaptures']
  > = {}
  private readonly cancel = (): void => {
    void this.stop().catch((error) => this.failures.push(String(error)))
  }

  constructor(readonly options: ConfiguredBrowserOptions) {
    options.control?.signal.throwIfAborted()
    this.definition = configuredDefinitionSchema.parse(options.definition)
    assertConfiguredDescriptor(
      this.definition.configuration,
      this.definition.descriptor,
    )
    if (
      sha256(JSON.stringify(this.definition.configuration)) !==
      this.definition.configurationHash
    )
      throw new Error('Configured intent hash changed')
    this.evidence = new Evidence(join(options.directory, this.id), {
      maxEvents: MAX_EVENTS,
      retainedBytes: MAX_RETAINED_EVENT_BYTES,
      queuedBytes: MAX_QUEUED_EVIDENCE_BYTES,
    })
    this.sources = new RepositorySourceService(options.workspace)
    this.browser = new HostBrowser(
      options.host,
      this.id,
      'about:blank',
      (type, detail) => this.evidence.record(type, detail),
      'normal',
      (reason) => this.fail(reason),
      options.createViewport,
    )
    options.control?.signal.addEventListener('abort', this.cancel, {
      once: true,
    })
  }

  /** Limits tracking to this launch's exact root and descendants, never the focused session. @example run.owner(unrelated) // false */
  owner(session: vscode.DebugSession): boolean {
    for (
      let ancestor: vscode.DebugSession | undefined = session;
      ancestor;
      ancestor = ancestor.parentSession
    )
      if (
        ancestor.configuration.name === `codebook repository ${this.id}` ||
        ancestor.configuration.name === `codebook server ${this.id}`
      )
        return true
    return false
  }
  /** Supplies the exact Next lock only while this configured app is still running; status can recheck other prerequisites. @example run.ownsDevelopmentLock() // { dev, ino } */
  ownsDevelopmentLock(): DevelopmentLockIdentity | undefined {
    return !this.cleaning && !this.cleaned && this.app?.isRunning()
      ? this.ownedDevelopmentLock
      : undefined
  }
  /** Identifies owned teardown for prerequisite reads after the exact lock receipt becomes unavailable. @example run.isCleaning() // true during Stop */
  isCleaning(): boolean {
    return this.cleaning && !this.cleaned
  }
  /** Adopts late debugger acquisitions before cancellation can finish. @example run.addSession(child) */
  addSession(session: vscode.DebugSession): void {
    this.sessions.set(session.id, session)
    this.activeSessions.add(session.id)
    this.evidence.record('session.started', {
      sessionId: session.id,
      parentId: session.parentSession?.id,
    })
    if (this.cleaning)
      this.track(Promise.resolve(vscode.debug.stopDebugging(session)))
  }
  /** Retains one preparation barrier for service cancellation and final cleanup. @example await run.prepare() */
  prepare(): Promise<void> {
    return (this.preparation ??= this.prepareOwned())
  }

  /** Acquires source/build/browser in order while every returned resource remains owned across cancellation. @example await this.prepareOwned() */
  private async prepareOwned(): Promise<void> {
    const now = Date.now(),
      preparationDeadlineAt =
        this.options.control?.preparationDeadlineAt ??
        now + REPOSITORY_SETUP_TIMEOUT_MS,
      deadlineAt =
        this.options.control?.deadlineAt ?? now + REPOSITORY_RUN_TIMEOUT_MS
    if (now >= preparationDeadlineAt || now >= deadlineAt)
      throw new Error('Repository preparation deadline already expired')
    this.progressDeadline(
      preparationDeadlineAt - now,
      'Repository setup deadline exceeded',
    )
    this.runTimer = setTimeout(
      () => this.fail('Repository whole-run deadline exceeded'),
      deadlineAt - now,
    )
    await this.evidence.initialize()
    this.alive()
    this.preparedSources = await this.sources.prepare(
      this.definition.descriptor.anchors,
      { signal: this.abort.signal, deadlineAt },
    )
    this.alive()
    await this.verifySources()
    await assertDevelopmentWorkspace(this.options.workspace, this.abort.signal)
    this.alive()
    const needsServer = configuredStops(this.definition.configuration).some(
      (stop) => stop.participant === 'server',
    )
    this.app = launchDevelopmentServer(
      this.options.workspace,
      this.options.node,
      (type, detail) => this.evidence.record(type, detail),
      needsServer,
    )
    this.origin = await this.app.ready(
      this.abort.signal,
      this.definition.configuration.entryPath,
    )
    this.alive()
    const developmentLock = await lstat(
      join(this.options.workspace, '.next/dev/lock'),
    ).catch((error) => {
      if (error.code === 'ENOENT') return undefined
      throw error
    })
    if (developmentLock?.isFile() && !developmentLock.isSymbolicLink())
      this.ownedDevelopmentLock = {
        dev: developmentLock.dev,
        ino: developmentLock.ino,
      }
    for (const [index, stop] of configuredStops(
      this.definition.configuration,
    ).entries()) {
      const acquired = await readDevelopmentBundle(
        this.options.workspace,
        stop.source,
        this.abort.signal,
        this.definition.configuration.entryPath,
        stop.participant === 'server' ? 'server-action' : 'browser',
      )
      this.alive()
      const verifier = createBundleVerifier(acquired.bundle),
        citation = this.definition.descriptor.anchors[stop.anchorIndex]!
      const prepared: PreparedStop = {
        ...stop,
        bundle: acquired.bundle,
        verifier,
        acceptsBoundLine: (line) =>
          isBindingLineAccepted(
            stop.source.line,
            line,
            citation,
            (startLine, endLine) =>
              verifier.mappedPositions(startLine, endLine),
          ),
      }
      this.stops.push(prepared)
      await this.evidence.save(
        `sealed-${index}-source.ts`,
        prepared.bundle.source,
      )
      this.alive()
      await this.evidence.save(
        `sealed-${index}-module.js`,
        prepared.bundle.javascript,
      )
      this.alive()
      await this.evidence.save(
        `sealed-${index}-module.map.json`,
        prepared.bundle.sourceMap,
      )
      this.alive()
      this.evidence.record('source.sealed', {
        index,
        participant: stop.participant,
        discovery: acquired.discovery,
        scriptUrl: prepared.bundle.scriptUrl,
        hashes: prepared.verifier.hashes,
      })
    }
    const first = this.stops[0]!
    const { itemId, bookTitle, nodeTitle, anchors, citationContext } =
      this.definition.descriptor
    const bound = {
      configurationHash: this.definition.configurationHash,
      configuration: this.definition.configuration,
      descriptor: { itemId, bookTitle, nodeTitle, anchors, citationContext },
      itemId,
      sourceHash: first.verifier.hashes.typescript,
      javascriptHash: first.verifier.hashes.javascript,
      mapHash: first.verifier.hashes.sourceMap,
    }
    this.manifest = { ...bound, hash: sha256(JSON.stringify(bound)) }
    // Later stops are armed only in their turn, so a line that can never bind is refused here, before any application effect.
    for (const stop of this.stops) {
      const mapped = stop.verifier.mappedPositions(
        stop.source.line,
        stop.source.line,
      )
      // A scan that stopped at its size limit proves nothing about the line; arming decides instead.
      if (mapped.complete && !mapped.positions.length)
        throw this.bindingFailure(
          stop,
          `Declared stop ${this.declaredAt(stop)} has no mapped position on that line in the sealed module`,
        )
    }
    if (needsServer) await this.selectServer()
    this.alive()
    await this.browser.launch(
      {
        name: `codebook repository ${this.id}`,
        type: 'pwa-chrome',
        request: 'launch',
        url: 'about:blank',
        webRoot: this.options.workspace,
        sourceMaps: true,
        sourceMapPathOverrides: {
          'webpack://_N_E/./*': `${this.options.workspace}/*`,
        },
        timeout: ACTIVE_TIMEOUT_MS,
      },
      this.abort.signal,
    )
    this.alive()
    await this.selectPage()
    this.alive()
    const cdp = this.requireCdp()
    await this.observeParticipant('browser')
    this.alive()
    cdp.aggregateScreencastTelemetry(() => this.evidence.elapsedMs())
    await this.browser.attachViewport(cdp, this.abort.signal)
    this.alive()
    const storage = this.definition.configuration.initialStorage ?? []
    if (storage.length) {
      await cdp.request('Page.addScriptToEvaluateOnNewDocument', {
        source: `if(location.origin===${JSON.stringify(this.origin)})for(const entry of ${JSON.stringify(storage)})localStorage.setItem(entry.key,entry.value);`,
      })
      this.alive()
    }
    await cdp.request('Page.navigate', {
      url: `${this.origin}${this.definition.configuration.entryPath ?? '/'}`,
    })
    this.alive()
    await this.waitForDom('before')
    this.alive()
    const inputs = this.definition.configuration.initialInputs ?? []
    await prepareRepositoryInputs(cdp, inputs, this.origin, () => this.alive())
    this.alive()
    if (inputs.length)
      this.evidence.record('inputs.prepared', { count: inputs.length })
    // Only the next expected stop is armed: a later stop's line may run before its turn and must not pause then. {@link continue} arms each later stop.
    await this.armStop(this.stops[0]!)
    await this.browser.reveal(this.abort.signal)
    this.alive()
    await this.capture('before')
    this.alive()
    clearTimeout(this.progressTimer)
    this.status = 'ready'
    await this.persist()
  }

  /**
   * Arms the next expected stop before any input or resume can reach it, called by {@link prepareOwned} for the first stop and by {@link continue} for each later one.
   * The declared position is a request: a browser stop records the debugger's verified binding as its position, on the declared line or on a later line the stop's rule accepts, and a server stop's owned breakpoint is given the same rule for its acknowledgement.
   * @param stop - The declared stop that is next in order.
   * @throws When a browser binding lands on a line the rule refuses or never verifies, or a server registration is refused; each failure names the declared stop.
   * @example
   * ```ts
   * await this.armStop(this.stops[0]!)
   * ```
   */
  private async armStop(stop: PreparedStop): Promise<void> {
    const position = stop.source,
      participant = this.participants[stop.participant]
    if (!participant.selected || !participant.cdp)
      throw new Error('Declared debugger was not acquired')
    if (stop.participant === 'browser') {
      await waitUntil(
        () => stop.script,
        'selected repository module',
        ACTIVE_TIMEOUT_MS,
        this.abort.signal,
      )
      const executed = await participant.cdp.request(
        'Debugger.getScriptSource',
        { scriptId: stop.script!.scriptId },
      )
      this.alive()
      if (sha256(executed.scriptSource) !== stop.verifier.hashes.javascript)
        throw new Error('Pre-input executed module differs from sealed bundle')
    }
    stop.breakpoint ??= new OwnedRepositoryBreakpoint(
      stop.bundle.sourcePath,
      position.line,
      position.column,
      'declared-line',
      stop.acceptsBoundLine,
    )
    if (stop.participant === 'server') {
      const receipt = await this.registeredStop(stop)
      this.alive()
      this.evidence.record('breakpoint.registered', {
        participant: stop.participant,
        ...receipt,
      })
      await this.verifySources()
      return
    }
    let binding: z.infer<typeof bindingSchema>,
      boundElsewhere: z.infer<typeof bindingSchema> | undefined,
      pollFailure: unknown
    try {
      binding = await waitUntil(
        async () => {
          let result: unknown
          try {
            result = await awaitResponse(
              participant.selected!.getDebugProtocolBreakpoint(
                stop.breakpoint!.breakpoint,
              ),
              'repository binding',
              this.abort.signal,
            )
          } catch (error) {
            pollFailure = error
            throw error
          }
          const parsed = bindingSchema.safeParse(result)
          if (!parsed.success) return undefined
          // The debugger chose a line the stop's rule refuses and no later poll moves it back, so the wait ends at once.
          if (!stop.acceptsBoundLine(parsed.data.line)) {
            boundElsewhere = parsed.data
            throw new Error('Repository breakpoint bound on another line')
          }
          return parsed.data
        },
        `a verified binding of declared stop ${this.declaredAt(stop)} on its declared line (requested column ${position.column}); choose an executable statement reached by the requested action`,
        ACTIVE_TIMEOUT_MS,
        this.abort.signal,
      )
    } catch (error) {
      if (boundElsewhere)
        throw this.bindingFailure(
          stop,
          `Declared stop ${this.declaredAt(stop)} bound at ${boundElsewhere.line}:${boundElsewhere.column}, not on its declared line`,
        )
      // Cancellation and an adapter failure keep their own reason; only the expired wait gains the mapping hints.
      if (pollFailure !== undefined || this.abort.signal.aborted) throw error
      throw this.bindingFailure(stop, thrownMessage(error))
    }
    this.alive()
    stop.bound = { line: binding.line, column: binding.column }
    this.evidence.record('breakpoint.bound', {
      ...binding,
      requested: { line: position.line, column: position.column },
    })
    await this.verifySources()
  }

  /**
   * Waits for a declared stop's acknowledged registration, called wherever the run needs that receipt (arming, the final input check and the pause).
   * The tracker's refusal carries positions only as JSON, so the failure gains the declared stop and the mapping hints here.
   * @param stop - A declared server stop whose owned breakpoint exists.
   * @returns The adapter's current receipt, `pending` until the module loads and `bound` afterwards.
   * @throws When the adapter refuses or revokes the registration, for example by acknowledging another line.
   * @example
   * ```ts
   * const receipt = await this.registeredStop(stop) // { status: 'pending', ... }
   * ```
   */
  private async registeredStop(
    stop: PreparedStop,
  ): Promise<Awaited<ReturnType<OwnedRepositoryBreakpoint['registered']>>> {
    try {
      return await stop.breakpoint!.registered(
        this.participants[stop.participant].selected!,
        this.abort.signal,
      )
    } catch (error) {
      if (this.abort.signal.aborted) throw error
      throw this.bindingFailure(
        stop,
        `Declared stop ${this.declaredAt(stop)} was not registered: ${thrownMessage(error)}`,
      )
    }
  }

  /** Names a declared stop by its file and line in the failures an agent reads, so it can tell which of its stops to change. @example this.declaredAt(stop) // 'app/lib/actions.ts:36' */
  private declaredAt(stop: PreparedStop): string {
    return `${stop.source.path}:${stop.source.line}`
  }

  /**
   * Reads where the debugger put a stop's breakpoint when that is another line than declared, for a deadline text that must point the agent at the line that has to run; {@link unreachedFirstStopReason} and {@link unreachedNextStopReason} call it when their deadline expires.
   * A browser stop knows its binding from arming. A server stop knows it only at its pause, so before that the owned breakpoint's current acknowledgement is asked.
   * @param stop - The declared stop that was not reached.
   * @returns The bound line and column, or `undefined` when the stop is bound on its declared line or its place is not known.
   * @example
   * ```ts
   * this.movedPlace(stop) // { line: 23, column: 5 } for a stop declared at 22:3
   * ```
   */
  private movedPlace(
    stop: PreparedStop,
  ): { line: number; column: number } | undefined {
    if (stop.bound)
      return stop.bound.line === stop.source.line ? undefined : stop.bound
    const session = this.participants[stop.participant].selected
    return session && stop.breakpoint?.movedTo(session)
  }

  /** Names a moved place for the two deadline texts. @example this.boundAt({ line: 23, column: 5 }) // '(bound at 23:5)' */
  private boundAt(place: { line: number; column: number }): string {
    return `(bound at ${place.line}:${place.column})`
  }

  /**
   * Words the failure of an action whose first declared stop never paused, read when that deadline expires (see {@link action}).
   * The deadline starts when the action is accepted, before the input is sent. A stop whose breakpoint the debugger moved to a later line pauses only when that line runs, which can lie in a branch the action skips, so the text then names that place; before the input was sent the place explains nothing.
   * @returns Today's text, or the text that names the declared stop and its bound place.
   * @example
   * ```ts
   * this.unreachedFirstStopReason() // 'Repository input reached no verified pause'
   * ```
   */
  private unreachedFirstStopReason(): string {
    const stop = this.stops[0]!,
      moved = this.movedPlace(stop)
    if (!moved || !this.operation?.inputDispatched)
      return 'Repository input reached no verified pause'
    return `Repository input reached no verified pause: declared stop ${this.declaredAt(stop)} ${this.boundAt(moved)} was not hit within ${ACTIVE_TIMEOUT_MS / MILLISECONDS_PER_SECOND} s of the accepted action; the bound line, not the declared one, must execute after the input`
  }

  /**
   * Words the failure of a continuation whose next declared stop never paused, read when that deadline expires (see {@link beginAfter}).
   * @param stop - The declared stop that was armed inside the continuation.
   * @returns The text that names the stop and the order rule; for a breakpoint the debugger moved to a later line it names that place and says that this line must run.
   * @example
   * ```ts
   * this.unreachedNextStopReason(stop) // '... declared stop app/ui/login-form.tsx:74 (bound at 75:13) was not hit within 20 s; the bound line, not the declared one, must execute after the preceding continuation'
   * ```
   */
  private unreachedNextStopReason(stop: PreparedStop): string {
    const moved = this.movedPlace(stop),
      opening = `Repository continuation reached no next declared pause: declared stop ${this.declaredAt(stop)}`,
      within = `was not hit within ${ACTIVE_TIMEOUT_MS / MILLISECONDS_PER_SECOND} s`
    return moved
      ? `${opening} ${this.boundAt(moved)} ${within}; the bound line, not the declared one, must execute after the preceding continuation`
      : `${opening} ${within}; its line must execute after the preceding continuation`
  }

  /**
   * Builds the failure for a declared stop that cannot bind, called by the preparation line check, {@link armStop}, {@link registeredStop} and {@link inspect}.
   * It appends the frozen map's positions in that stop's citation so the agent can choose another line; they are hints, never bindings.
   * @param stop - The declared stop the failure is about.
   * @param message - What happened, without a trailing period; it already names the stop.
   * @returns The error to throw; without hints when the sealed map cannot be scanned.
   * @example
   * ```ts
   * throw this.bindingFailure(stop, `Declared stop ${this.declaredAt(stop)} bound at 24:5, not on its declared line`)
   * ```
   */
  private bindingFailure(stop: PreparedStop, message: string): Error {
    const position = stop.source,
      anchor = this.definition.descriptor.anchors[stop.anchorIndex]!
    try {
      const mapped = stop.verifier.mappedPositions(
        anchor.startLine,
        anchor.endLine,
      )
      const mappedPositions = mapped.positions
      const edgeCount = REPOSITORY_BINDING_HINT_EDGE_LINES,
        nearCount = REPOSITORY_BINDING_HINT_NEAR_LINES
      // Keep the citation's boundaries and the attempted line represented when a long map needs a bounded hint.
      const sampled =
        mappedPositions.length <= edgeCount * 2 + nearCount
          ? mappedPositions
          : [
              ...new Map(
                [
                  ...mappedPositions.slice(0, edgeCount),
                  ...mappedPositions
                    .toSorted(
                      (left, right) =>
                        Math.abs(left.line - position.line) -
                        Math.abs(right.line - position.line),
                    )
                    .slice(0, nearCount),
                  ...mappedPositions.slice(-edgeCount),
                ].map((candidate) => [candidate.line, candidate]),
              ).values(),
            ].sort((left, right) => left.line - right.line)
      const locations = sampled
        .map((candidate) => `${candidate.line}:${candidate.column}`)
        .join(', ')
      const qualifier = mapped.complete ? '' : ' (partial map scan)'
      this.evidence.record('breakpoint.mapping-hints', {
        requested: position,
        citation: { startLine: anchor.startLine, endLine: anchor.endLine },
        mappedLineCount: mappedPositions.length,
        returnedLineCount: sampled.length,
        complete: mapped.complete,
      })
      return new Error(
        `${message}. Frozen source map positions in the selected citation${qualifier}: ${locations || 'none'}. These are mapped source positions, not verified debugger bindings or proof that the requested action reaches them.`,
      )
    } catch {
      return new Error(message)
    }
  }

  /** Observes each native proxy without borrowing another participant's script or suspension. @example await this.observeParticipant('server') */
  private async observeParticipant(name: Participant): Promise<void> {
    const participant = this.participants[name],
      cdp = participant.cdp
    if (!cdp) throw new Error('Selected native proxy unavailable')
    cdp.onClose = (): void => {
      if (!this.cleaning) this.fail(`Selected ${name} CDP closed`)
    }
    let observedScripts = 0
    cdp.on('Debugger.scriptParsed', (event) => {
      // The journal lists only the first scripts; a pause in a later one still needs its URL.
      participant.scriptUrls.set(event.scriptId, event.url)
      if (observedScripts++ < REPOSITORY_SCRIPT_DIAGNOSTIC_LIMIT)
        this.evidence.record('script.observed', {
          participant: name,
          scriptId: event.scriptId,
          url: event.url,
        })
      for (const stop of this.stops) {
        if (
          stop.participant !== name ||
          !event.url ||
          !sameScriptUrl(stop.bundle.scriptUrl, event.url)
        )
          continue
        if (stop.script && stop.script.scriptId !== event.scriptId) {
          this.fail('Selected module changed after sealing')
          return
        }
        stop.script = event
      }
    })
    cdp.on('Debugger.paused', (event) => this.onCdpPaused(name, event))
    cdp.on('Debugger.resumed', () => this.onCdpResumed(name))
    await cdp.subscribe([
      'Debugger.scriptParsed',
      'Debugger.paused',
      'Debugger.resumed',
    ])
    this.alive()
  }

  /** Journals every pause the runtime reports and, during an action, hands it to {@link admitPause}; only a browser pause in a run that declares no browser stop keeps its own short bound. @example this.onCdpPaused('server', event) */
  private onCdpPaused(
    name: Participant,
    event: Protocol.Debugger.PausedEvent,
  ): void {
    if (this.cleaning) return
    const participant = this.participants[name]
    participant.pauseObservedAtMs = this.evidence.elapsedMs()
    this.evidence.record('cdp.pause-observed', {
      participant: name,
      reason: event.reason,
      scriptId: event.callFrames[0]?.location.scriptId,
      hitBreakpointCount: event.hitBreakpoints?.length,
      inputDispatched: this.operation?.inputDispatched ?? false,
      // Where the pause is and how far a continuation in flight was: a pause the adapter resumes by itself leaves nothing else behind.
      ...describeCdpPause(event, participant.scriptUrls),
      stopIndex: this.stopIndex,
      continuation: continuationReceipts(this.continuation),
    })
    if (event.reason === 'instrumentation' || !this.operation) return
    // js-debug may hit and auto-resume its own browser breakpoint even when this run declares only server stops.
    if (
      name === 'browser' &&
      !this.stops.some((stop) => stop.participant === 'browser')
    ) {
      if (this.transientBrowserPause) {
        this.fail('Additional browser stop remained unowned')
        return
      }
      const transient = {
        timer: setTimeout(() => {
          if (this.transientBrowserPause === transient)
            this.fail('Unowned browser stop remained paused')
        }, 250),
      }
      this.transientBrowserPause = transient
      this.evidence.record('cdp.browser-pause-awaiting-adapter', {
        scriptId: event.callFrames[0]?.location.scriptId,
      })
      return
    }
    this.admitPause(name, event)
  }

  /**
   * Decides what a pause during an action is, called by {@link onCdpPaused} (and through it by {@link beginAfter} when a queued pause is replayed).
   * The debug adapter also pauses for breakpoints of its own and resumes them without announcing a stop, and its two channels have no common order, so the place of a pause decides, never which event was read first:
   *
   * ```
   * participant already holds a pause ──► fail "Additional <name> stop ..."
   * at the expected stop (its module, its declared line)
   *     continuation in flight ──► pendingCdpStop, replayed by beginAfter
   *     otherwise              ──► participant.stopped, bound by inspect
   * anywhere else              ──► participant.unannouncedPause, with the stop expected then
   *                                  resumed   → retireUnannouncedPause
   *                                  announced → onEvent fails, or inspect judges it when it was held for that stop
   *                                  stays     → the progress deadline names it
   * ```
   * @param name - The participant whose runtime paused.
   * @param event - The pause as the runtime reported it.
   * @example
   * ```ts
   * this.admitPause('server', event) // a pause in getUser while auth.ts:23 is expected is held, not failed
   * ```
   */
  private admitPause(
    name: Participant,
    event: Protocol.Debugger.PausedEvent,
  ): void {
    // A participant pauses once at a time; a second pause before the first one's resume is nobody's declared stop.
    if (this.holdsPause(name)) {
      this.fail(`Additional ${name} stop invalidated the declared operation`)
      return
    }
    const expectedStop = this.expectedStop(name)
    if (!isPauseAtStop(event, expectedStop)) {
      // The stop expected now is kept, so a pause that came before a stop's turn never becomes that stop's pause later.
      this.participants[name].unannouncedPause = { event, expectedStop }
      return
    }
    // The expected stop's pause becomes current only after the preceding continuation has all its receipts.
    if (this.continuation) this.pendingCdpStop = { participant: name, event }
    else this.participants[name].stopped = { event }
  }

  /** Tells {@link admitPause} whether a participant already holds a pause: its declared stop's, a queued one, or one nobody announced. @example this.holdsPause('server') // false while the server runs */
  private holdsPause(name: Participant): boolean {
    const participant = this.participants[name]
    return Boolean(
      participant.stopped ||
      participant.unannouncedPause ||
      this.pendingCdpStop?.participant === name,
    )
  }

  /** Names the declared stop whose pause may arrive next, for {@link expectedStop}: the one after a continuation in flight, otherwise the current one until its snapshot is ready. After the last continuation there is none. @example this.nextStopToPause() // stops[1] while stop 0 is being continued */
  private nextStopToPause(): PreparedStop | undefined {
    if (this.continuation) return this.stops[this.stopIndex + 1]
    return this.snapshotReady ? undefined : this.stops[this.stopIndex]
  }

  /** Gives {@link admitPause} the stop a participant's pause may belong to; a participant whose turn it is not has none. @example this.expectedStop('browser') // undefined while a server stop is next */
  private expectedStop(name: Participant): PreparedStop | undefined {
    const stop = this.nextStopToPause()
    return stop?.participant === name ? stop : undefined
  }

  /** Names where a participant's pause is, by repository path and line inside a declared stop's module, for the journal and for an expired deadline. @example this.placeOf('server', event) // 'auth.ts:18' */
  private placeOf(
    name: Participant,
    event: Protocol.Debugger.PausedEvent,
  ): string {
    return pausePlace(
      event,
      this.stops.filter((stop) => stop.participant === name),
      this.participants[name].scriptUrls,
    )
  }

  /**
   * Retires a pause that no debugger stop announced when the runtime resumes it, called by {@link onCdpResumed}.
   * The adapter made the pause for itself (a module entry breakpoint, its WebAssembly hook) and resumed it. No stop, receipt or generation of the run changes; the journal keeps where the pause was and how long it lasted. Nothing on either channel says who sent a resume, so a pause on the expected stop's line is never retired here.
   * @param name - The participant whose runtime resumed.
   * @param pausedForMs - How long the pause lasted on the journal clock, when its start was observed.
   * @returns `true` when such a pause was held and is now retired.
   * @example
   * ```ts
   * if (this.retireUnannouncedPause('server', 2)) return
   * ```
   */
  private retireUnannouncedPause(
    name: Participant,
    pausedForMs: number | undefined,
  ): boolean {
    const participant = this.participants[name],
      held = participant.unannouncedPause
    if (!held) return false
    participant.unannouncedPause = undefined
    this.evidence.record('cdp.adapter-pause-retired', {
      participant: name,
      ...describeCdpPause(held.event, participant.scriptUrls),
      place: this.placeOf(name, held.event),
      pausedForMs,
    })
    return true
  }

  /** Lists where each participant is still paused with no announced stop, server first, for the text of a deadline that expires meanwhile. @example this.unannouncedPausePlaces() // [{ participant: 'server', place: 'auth.ts:18' }] */
  private unannouncedPausePlaces(): UnannouncedPausePlace[] {
    return (['server', 'browser'] as const).flatMap((name) => {
      const held = this.participants[name].unannouncedPause
      return held
        ? [{ participant: name, place: this.placeOf(name, held.event) }]
        : []
    })
  }

  /** Tells {@link observeAfter} that no pause the adapter made for itself is still open on either participant, so completion is never certified while one of them is paused. @example this.adapterPausesRetired() // true */
  private adapterPausesRetired(): boolean {
    return (
      !this.transientBrowserPause &&
      !this.participants.server.unannouncedPause &&
      !this.participants.browser.unannouncedPause
    )
  }

  /** Attaches only the launched worker, then verifies its OS ownership through the native proxy before granting control. @example await this.selectServer() */
  private async selectServer(): Promise<void> {
    const endpoint = await this.app!.inspectorEndpoint(this.abort.signal)
    this.alive()
    const launched = await this.acquire(
      vscode.debug.startDebugging(
        vscode.workspace.getWorkspaceFolder(
          vscode.Uri.file(this.options.workspace),
        ),
        {
          name: `codebook server ${this.id}`,
          type: 'pwa-node',
          request: 'attach',
          websocketAddress: endpoint,
          cwd: this.options.workspace,
          restart: false,
          autoAttachChildProcesses: false,
          continueOnAttach: false,
          sourceMaps: true,
          sourceMapPathOverrides: {
            'webpack://_N_E/./*': `${this.options.workspace}/*`,
          },
          timeout: ACTIVE_TIMEOUT_MS,
        },
      ),
    )
    this.alive()
    if (!launched) throw new Error('Owned server debugger did not start')
    await waitUntil(
      async () => {
        const matches: {
          session: vscode.DebugSession
          cdp: Cdp
          identity: Awaited<
            ReturnType<
              ReturnType<typeof launchDevelopmentServer>['verifyInspector']
            >
          >
        }[] = []
        try {
          for (const session of this.sessions.values()) {
            if (
              !this.activeSessions.has(session.id) ||
              !this.serverSession(session)
            )
              continue
            let candidate: Cdp | undefined
            try {
              const proxy: { host: string; port: number; path: string } =
                await awaitResponse(
                  session.customRequest('requestCDPProxy'),
                  'owned server proxy',
                  this.abort.signal,
                )
              candidate = await this.acquire(
                Cdp.connect(
                  `ws://${proxy.host}:${proxy.port}${proxy.path}`,
                  (type, detail) => this.evidence.record(type, detail),
                ),
              )
              this.alive()
              const identity = await this.app!.verifyInspector(
                candidate,
                this.abort.signal,
              )
              this.alive()
              this.evidence.record('server.candidate-verified', {
                sessionId: session.id,
                parentId: session.parentSession?.id,
                identity,
              })
              matches.push({ session, cdp: candidate, identity })
            } catch (error) {
              if (this.abort.signal.aborted || this.cleaning) throw error
            } finally {
              if (
                candidate &&
                !matches.some((match) => match.cdp === candidate)
              )
                candidate.close()
            }
          }
          if (!matches.length) return false
          // A native adapter may expose one inspected worker through nested sessions; use only its deepest session.
          const selected = matches.find((candidate) =>
            matches.every((other) => {
              if (candidate.session.id === other.session.id) return true
              for (
                let ancestor = candidate.session.parentSession;
                ancestor;
                ancestor = ancestor.parentSession
              )
                if (ancestor.id === other.session.id) return true
              return false
            }),
          )
          if (
            !selected ||
            matches.some(
              (candidate) =>
                candidate.identity.pid !== selected.identity.pid ||
                candidate.identity.processGroup !==
                  selected.identity.processGroup ||
                candidate.identity.workspace !== selected.identity.workspace,
            )
          )
            throw new Error('Ambiguous owned server')
          this.alive()
          this.participants.server.selected = selected.session
          this.participants.server.cdp = selected.cdp
          return true
        } finally {
          for (const match of matches)
            if (match.cdp !== this.participants.server.cdp) match.cdp.close()
        }
      },
      'unique owned server',
      ACTIVE_TIMEOUT_MS,
      this.abort.signal,
    )
    await this.observeParticipant('server')
  }

  /** Classifies only this run's server root/descendants during native proxy discovery. @example this.serverSession(session) */
  private serverSession(session: vscode.DebugSession): boolean {
    for (
      let ancestor: vscode.DebugSession | undefined = session;
      ancestor;
      ancestor = ancestor.parentSession
    )
      if (ancestor.configuration.name === `codebook server ${this.id}`)
        return true
    return false
  }

  /** Selects exactly one blank descendant page and retains every provisional proxy until selection or release. @example await this.selectPage() */
  private async selectPage(): Promise<void> {
    await waitUntil(
      async () => {
        const matches: { session: vscode.DebugSession; cdp: Cdp }[] = []
        try {
          for (const session of this.sessions.values()) {
            if (
              !session.parentSession ||
              !this.activeSessions.has(session.id) ||
              this.serverSession(session)
            )
              continue
            let candidate: Cdp | undefined
            try {
              const proxy: { host: string; port: number; path: string } =
                await awaitResponse(
                  session.customRequest('requestCDPProxy'),
                  'owned proxy',
                  this.abort.signal,
                )
              candidate = await this.acquire(
                Cdp.connect(
                  `ws://${proxy.host}:${proxy.port}${proxy.path}`,
                  (type, detail) => this.evidence.record(type, detail),
                ),
              )
              this.alive()
              const result = await awaitResponse(
                candidate.request('Runtime.evaluate', {
                  expression: 'location.href',
                  returnByValue: true,
                }),
                'owned page identity',
                this.abort.signal,
              )
              this.alive()
              if (result.result.value === 'about:blank')
                matches.push({ session, cdp: candidate })
            } catch (error) {
              if (this.abort.signal.aborted || this.cleaning) throw error
            } finally {
              if (
                candidate &&
                !matches.some((match) => match.cdp === candidate)
              )
                candidate.close()
            }
          }
          if (matches.length > 1) throw new Error('Ambiguous owned page')
          if (!matches[0]) return false
          this.alive()
          this.participants.browser.selected = matches[0].session
          this.participants.browser.cdp = matches[0].cdp
          return true
        } finally {
          for (const match of matches)
            if (match.cdp !== this.participants.browser.cdp) match.cdp.close()
        }
      },
      'unique owned page',
      ACTIVE_TIMEOUT_MS,
      this.abort.signal,
    )
  }

  /** Reserves one declared input synchronously; its protocol ACK never blocks state or continuation. @example run.action('click-once', 'repository-click') */
  action(key: string, action: RuntimeAction) {
    if (this.operation?.key === key && action === REPOSITORY_BROWSER_ACTION)
      return { id: this.operation.id }
    if (
      action !== REPOSITORY_BROWSER_ACTION ||
      this.operation ||
      this.cleaning ||
      this.status !== 'ready'
    )
      throw new Error('conflict: wrong, repeated or unavailable input')
    this.alive()
    this.operation = {
      id: randomUUID(),
      key,
      inputDispatched: false,
      inputAcknowledged: false,
      afterVerified: false,
    }
    this.status = 'acting'
    this.progressDeadline(ACTIVE_TIMEOUT_MS, () =>
      this.unreachedFirstStopReason(),
    )
    this.evidence.record('input.accepted', { id: this.operation.id, key })
    this.track(this.dispatchInput())
    return { id: this.operation.id }
  }
  /** Verifies sources, exact origin and a unique enabled center immediately before the one mouse sequence. @example await this.dispatchInput() */
  private async dispatchInput(): Promise<void> {
    await this.verifySources()
    for (const stop of this.stops.filter(
      (candidate) => candidate.participant === 'server' && candidate.breakpoint,
    )) {
      await this.registeredStop(stop)
      this.alive()
    }
    const target = await this.readDom('before')
    this.alive()
    if (!target.ready || target.x === undefined || target.y === undefined)
      throw new Error('Click target or before conditions changed before input')
    // A result predicate already true before the click cannot prove this operation caused the result.
    const priorResult = await this.readDom('after')
    this.alive()
    if (priorResult.ready)
      throw new Error(
        'Configured after conditions were already true before application input',
      )
    // DOM checks yield to native events; recheck pending authority synchronously before dispatching the first input.
    for (const stop of this.stops.filter(
      (candidate) => candidate.participant === 'server' && candidate.breakpoint,
    )) {
      if (!stop.breakpoint!.registration(this.participants.server.selected!))
        throw new Error('Server breakpoint registration changed before input')
    }
    this.operation!.inputDispatched = true
    this.evidence.record('input.dispatched', {
      key: this.operation!.key,
      x: target.x,
      y: target.y,
    })
    const cdp = this.requireCdp()
    await cdp.request(
      'Input.dispatchMouseEvent',
      {
        type: 'mousePressed',
        button: 'left',
        clickCount: 1,
        x: target.x,
        y: target.y,
      },
      REPOSITORY_RUN_TIMEOUT_MS,
    )
    this.alive()
    await cdp.request(
      'Input.dispatchMouseEvent',
      {
        type: 'mouseReleased',
        button: 'left',
        clickCount: 1,
        x: target.x,
        y: target.y,
      },
      REPOSITORY_RUN_TIMEOUT_MS,
    )
    this.alive()
    this.operation!.inputAcknowledged = true
    this.evidence.record('input.acknowledged')
  }

  /** Resolves native event ownership independently of the currently expected stop. @example this.participantName(session) */
  private participantName(
    session: vscode.DebugSession,
  ): Participant | undefined {
    return (['browser', 'server'] as const).find(
      (name) => this.participants[name].selected?.id === session.id,
    )
  }
  /** Tracks all owned breakpoints and invalidates an unreserved resume in its own session. @example run.onRequest(session, request) */
  onRequest(
    session: vscode.DebugSession,
    request: DebugProtocol.Request,
  ): void {
    for (const stop of this.stops) stop.breakpoint?.onRequest(session, request)
    const name = this.participantName(session)
    if (this.cleaning || !name || !RESUME_COMMANDS.has(request.command)) return
    const participant = this.participants[name]
    this.evidence.record('dap.resume-request', {
      participant: name,
      command: request.command,
      sequence: request.seq,
      threadId: request.arguments?.threadId,
      expectedRequests: participant.expectedResumeRequests,
      generation: participant.gate.generation,
    })
    const expected =
      request.command === 'continue' && participant.expectedResumeRequests > 0
    if (expected) participant.expectedResumeRequests--
    participant.gate.invalidate(!expected)
    if (name === 'browser') this.browser.resumeViewport()
    if (!expected)
      this.fail('Manual or competing resume invalidated live pause')
  }
  /** Routes registration/retirement ACKs without treating another adapter's response as authority. @example run.onResponse(session, response) */
  onResponse(
    session: vscode.DebugSession,
    response: DebugProtocol.Response,
  ): void {
    for (const stop of this.stops)
      stop.breakpoint?.onResponse(session, response)
    if (
      !this.cleaning &&
      this.participantName(session) &&
      response.command === 'continue'
    )
      this.evidence.record('dap.continue-response', {
        sessionId: session.id,
        sequence: response.seq,
        requestSequence: response.request_seq,
        success: response.success,
      })
  }
  /** Reserves stops in declared order, retaining per-session generations across participant transitions. @example run.onEvent(selected, stopped) */
  onEvent(session: vscode.DebugSession, event: DebugProtocol.Event): void {
    const name = this.participantName(session)
    if (this.cleaning || !name) return
    const participant = this.participants[name]
    if (event.event === 'stopped') {
      const body: DebugProtocol.StoppedEvent['body'] = event.body
      if (name === 'browser' && this.transientBrowserPause) {
        this.fail('Unowned browser DAP stop invalidated the declared operation')
        return
      }
      const refresh = participant.refresh
      // A presentation refresh must re-announce exactly the retained session/thread without a runtime resume.
      if (refresh) {
        if (
          refresh.stage !== 'awaiting-stop' ||
          refresh.pause.sessionId !== session.id ||
          refresh.pause.threadId !== body.threadId ||
          !participant.gate.matches(refresh.pause) ||
          participant.stopped !== refresh.stopped ||
          this.continuation
        ) {
          this.fail('Unexpected stop invalidated native stack refresh')
          return
        }
        refresh.stage = 'validating'
        this.track(this.verifyStackRefresh(name, session, refresh))
        return
      }
      if (this.continuation) {
        const next = this.stops[this.stopIndex + 1]
        if (
          !next ||
          next.participant !== name ||
          (name === this.continuation.participant && !this.continuation.dap) ||
          this.pendingDapStop ||
          !Number.isInteger(body.threadId)
        ) {
          this.fail(
            `Unexpected or additional ${name} stop invalidated the declared operation`,
          )
          return
        }
        this.pendingDapStop = { participant: name, event }
        return
      }
      if (
        this.stops[this.stopIndex]?.participant !== name ||
        !Number.isInteger(body.threadId) ||
        !this.operation?.inputDispatched ||
        this.acceptedStop
      ) {
        this.evidence.record('dap.rejected-stop', {
          participant: name,
          reason: body.reason,
          threadIdValid: Number.isInteger(body.threadId),
          inputDispatched: this.operation?.inputDispatched ?? false,
          acceptedStop: this.acceptedStop,
        })
        this.fail(
          `Unexpected or additional ${name} stop invalidated the declared operation`,
        )
        return
      }
      this.acceptedStop = true
      const pause = participant.gate.stop(session.id, body.threadId!)
      this.status = `paused-${name}`
      this.progressDeadline(
        REPOSITORY_PAUSE_HOLD_TIMEOUT_MS,
        'Repository pause hold deadline exceeded',
      )
      this.evidence.record('dap.stopped', {
        participant: name,
        ...pause,
        reason: body.reason,
      })
      this.track(this.inspect(pause))
    } else if (event.event === 'continued' && this.operation) {
      const continuation = this.continuation
      this.evidence.record('dap.continued-observed', {
        participant: name,
        sequence: event.seq,
        threadId: event.body?.threadId,
        generation: participant.gate.generation,
        stopIndex: this.stopIndex,
      })
      // The adapter emits one for every resume, also of a pause it made and resumed by itself while this participant has no owned pause.
      if (this.isIdleContinued(name)) {
        this.evidence.record('dap.idle-continued-ignored', {
          participant: name,
          sequence: event.seq,
        })
        return
      }
      const pause = participant.gate.current,
        stopped = participant.stopped
      // js-debug refreshStackTrace emits continued/stopped without resuming the CDP runtime; it is not continuation authority.
      if (
        !continuation &&
        !participant.refresh &&
        pause &&
        participant.gate.matches(pause) &&
        pause.sessionId === session.id &&
        pause.threadId === event.body?.threadId &&
        stopped &&
        (stopped.generation === undefined ||
          stopped.generation === pause.generation)
      ) {
        participant.refresh = {
          pause: { ...pause },
          stopped,
          stage: 'awaiting-stop',
        }
        this.progressDeadline(
          ACTIVE_TIMEOUT_MS,
          'Native stack refresh did not confirm the retained pause',
        )
        this.evidence.record('dap.pause-refresh-pending', {
          participant: name,
          ...pause,
        })
        return
      }
      if (
        this.pendingDapStop?.participant === name ||
        !continuation ||
        continuation.participant !== name ||
        continuation.dap ||
        continuation.pause.threadId !== event.body?.threadId ||
        continuation.pause.generation !== participant.gate.generation
      ) {
        this.fail('Unowned continuation invalidated live pause')
        return
      }
      continuation.dap = true
      participant.gate.invalidate()
      if (name === 'browser') this.browser.resumeViewport()
      this.beginAfter(continuation)
    }
  }

  /** Tells {@link isIdleContinued} whether a continuation of this participant still waits for the adapter's `continued`; the first one after the reserved resume request is that receipt. @example this.awaitsContinued('server') // true between the continue request and its continued */
  private awaitsContinued(name: Participant): boolean {
    const continuation = this.continuation
    return continuation?.participant === name && !continuation.dap
  }

  /**
   * Tells {@link onEvent} whether a `continued` belongs to nothing this run owns.
   * The adapter announces every resume, also of a pause it made for itself, and that event may be read before the pause or after its resume. A continuation that already has its `continued`, such as the last one of a run, therefore does not make a later one a failure.
   * @param name - The participant whose session announced `continued`.
   * @returns `true` when the participant has no accepted pause, no queued announced stop and no continuation of its own still waiting for its `continued`.
   * @example
   * ```ts
   * this.isIdleContinued('server') // true for the adapter's continued after the last continuation
   * ```
   */
  private isIdleContinued(name: Participant): boolean {
    return (
      !this.participants[name].gate.current &&
      this.pendingDapStop?.participant !== name &&
      !this.awaitsContinued(name)
    )
  }

  /**
   * Confirms the same native source after js-debug refreshes its paused stack, called by {@link onEvent}.
   * Keeps the original captured generation; {@link continue} refuses control until this verification finishes.
   * @param name - Participant whose retained CDP pause must remain unchanged.
   * @param session - Exact owned native session that re-announced the pause.
   * @param refresh - Current refresh receipt; replacement or cleanup makes it stale.
   * @throws When source location, runtime pause or ownership changes during verification.
   * @example
   * ```ts
   * await this.verifyStackRefresh('server', session, refresh) // retains generation 1 instead of creating generation 2
   * ```
   */
  private async verifyStackRefresh(
    name: Participant,
    session: vscode.DebugSession,
    refresh: NonNullable<DebugParticipant['refresh']>,
  ): Promise<void> {
    const participant = this.participants[name],
      stop = this.stops[this.stopIndex]!
    const current = (): void => {
      this.alive()
      if (
        participant.refresh !== refresh ||
        !participant.gate.matches(refresh.pause) ||
        participant.stopped !== refresh.stopped ||
        participant.selected !== session ||
        stop.participant !== name ||
        this.continuation
      )
        throw new Error('Native stack refresh lost its retained pause')
    }
    current()
    const stack: DebugProtocol.StackTraceResponse['body'] = await awaitResponse(
      session.customRequest('stackTrace', {
        threadId: refresh.pause.threadId,
        startFrame: 0,
        levels: REPOSITORY_STACK_FRAME_LIMIT,
      }),
      'native stack refresh',
      this.abort.signal,
    )
    current()
    const frame = stack.stackFrames[0]
    // New source mappings or a different location cannot certify the prior captured source.
    if (
      !isRefreshedFrameAtStop(frame, {
        sourcePath: stop.bundle.sourcePath,
        declaredLine: stop.source.line,
        bound: stop.bound,
        acceptsBoundLine: stop.acceptsBoundLine,
      })
    )
      throw new Error(
        'Native stack refresh changed the captured source location',
      )
    participant.refresh = undefined
    this.progressDeadline(
      REPOSITORY_PAUSE_HOLD_TIMEOUT_MS,
      'Repository pause hold deadline exceeded',
    )
    this.evidence.record('dap.pause-refreshed', {
      participant: name,
      ...refresh.pause,
      line: frame.line,
      column: frame.column,
    })
  }
  /** Matches each CDP resume to its own captured generation; a queued next stop cannot resume unobserved. @example this.onCdpResumed('server') */
  private onCdpResumed(name: Participant): void {
    if (this.cleaning) return
    const participant = this.participants[name],
      pausedForMs = elapsedMsSince(
        participant.pauseObservedAtMs,
        this.evidence.elapsedMs(),
      )
    participant.pauseObservedAtMs = undefined
    if (name === 'browser' && this.transientBrowserPause) {
      clearTimeout(this.transientBrowserPause.timer)
      this.transientBrowserPause = undefined
      this.evidence.record('cdp.browser-adapter-pause-retired')
      return
    }
    if (this.retireUnannouncedPause(name, pausedForMs)) return
    if (this.pendingCdpStop?.participant === name) {
      this.fail(
        `Queued ${name} stop resumed before prior continuation receipts completed`,
      )
      return
    }
    const stopped = participant.stopped
    participant.stopped = undefined
    this.evidence.record('cdp.resumed', {
      participant: name,
      generation: stopped?.generation,
      pausedForMs,
    })
    if (!stopped) return
    const continuation = this.continuation
    if (
      !continuation ||
      continuation.participant !== name ||
      stopped.generation !== continuation.pause.generation ||
      continuation.cdp
    ) {
      this.fail(`Selected ${name} resumed outside its owned continuation`)
      return
    }
    continuation.cdp = true
    participant.gate.invalidate()
    if (name === 'browser') this.browser.resumeViewport()
    this.beginAfter(continuation)
  }
  /** Rejects loss of either selected target while retaining owned-root teardown. @example run.terminated(child) */
  terminated(session: vscode.DebugSession): void {
    this.activeSessions.delete(session.id)
    this.evidence.record('session.terminated', { sessionId: session.id })
    if (!this.cleaning && this.participantName(session))
      this.fail('Selected debugger terminated')
  }

  /**
   * Finds the runtime pause that belongs to an accepted debugger stop, called by {@link inspect}.
   * The pause may be read after its `stopped`, so the wait is bounded; it takes only a pause on the stop's declared line, which {@link admitPause} stored.
   * @param stop - The declared stop whose `stopped` was accepted.
   * @returns The stop's pause, not yet bound to a generation.
   * @throws The wait's timeout when no pause arrives on the declared line and no pause held while the stop was expected stayed elsewhere in its module.
   * @example
   * ```ts
   * const stopped = await this.pauseOfAcceptedStop(stop)
   * ```
   */
  private async pauseOfAcceptedStop(
    stop: PreparedStop,
  ): Promise<NonNullable<DebugParticipant['stopped']>> {
    const participant = this.participants[stop.participant]
    try {
      return await waitUntil(
        () => {
          const candidate = participant.stopped
          return candidate &&
            candidate.generation === undefined &&
            candidate.event.callFrames[0]?.location.scriptId ===
              stop.script?.scriptId
            ? candidate
            : undefined
        },
        'source-bound CDP stop',
        CAPTURE_TIMEOUT_MS,
        this.abort.signal,
      )
    } catch (error) {
      // An announced pause that stayed elsewhere in the stop's module since its turn began is judged by the binding and frame checks, which say what is wrong.
      const held = this.adoptPauseHeldInModule(stop)
      if (!held) throw error
      return held
    }
  }

  /**
   * Adopts a pause that stayed elsewhere in an accepted stop's module as that stop's pause, called by {@link pauseOfAcceptedStop} after its wait ended.
   * The adapter resumes its own pauses within milliseconds, so a pause that outlasted the wait in the stop's own module, held while that stop was the expected one, is the announced one: a binding on another line, or another breakpoint in that file. A pause in any other script, or one held before the stop's turn, is left alone (see {@link pauseHeldForStop}).
   * @param stop - The declared stop whose `stopped` was accepted.
   * @returns The adopted pause, or `undefined` when the run was cancelled or no such pause is held.
   * @example
   * ```ts
   * const held = this.adoptPauseHeldInModule(stop) // then inspect reports "bound at 24:5, not on its declared line"
   * ```
   */
  private adoptPauseHeldInModule(
    stop: PreparedStop,
  ): DebugParticipant['stopped'] {
    const participant = this.participants[stop.participant],
      held = this.pauseHeldForStop(stop)
    if (this.abort.signal.aborted || !held) return undefined
    participant.unannouncedPause = undefined
    participant.stopped = { event: held.event }
    return participant.stopped
  }

  /**
   * Finds the held pause that {@link adoptPauseHeldInModule} may take as an accepted stop's pause: one that arrived in the stop's module while that stop was the expected one.
   * A pause held before the stop's turn (the other participant running the line while the next stop is armed, before its continuation is requested) can be on the declared line itself; adopting it would report an observation made before the continuation as one made after it.
   * @param stop - The declared stop whose `stopped` was accepted.
   * @returns
   * - The held pause, when it was held for this stop and is in its module
   * - `undefined` otherwise, including a pause held before the stop's turn
   * @example
   * ```ts
   * this.pauseHeldForStop(stop) // undefined for a pause held between the previous snapshot and its continuation
   * ```
   */
  private pauseHeldForStop(
    stop: PreparedStop,
  ): DebugParticipant['unannouncedPause'] {
    const held = this.participants[stop.participant].unannouncedPause
    return held?.expectedStop === stop &&
      isPauseInScript(held.event, stop.script)
      ? held
      : undefined
  }

  /** Seals actual configured values and renderer pixels only while the exact source-bound pause remains current. @example await this.inspect(pause) */
  private async inspect(pause: PauseIdentity): Promise<void> {
    const stop = this.stops[this.stopIndex]!,
      participant = this.participants[stop.participant],
      phase = stop.participant === 'server' ? 'paused-server' : 'paused-browser'
    // A new stop cannot inherit the preceding stop's captured image.
    this.captures[phase] = { status: 'pending' }
    const stopped = await this.pauseOfAcceptedStop(stop)
    const current = (): void => {
      this.alive()
      if (!participant.gate.matches(pause) || participant.stopped !== stopped)
        throw new Error('Pause changed during inspection')
    }
    current()
    stopped.generation = pause.generation
    if (stop.participant === 'server') {
      const registered = await this.registeredStop(stop)
      current()
      const binding = await awaitResponse(
        participant.selected!.getDebugProtocolBreakpoint(
          stop.breakpoint!.breakpoint,
        ),
        'paused server binding',
        this.abort.signal,
      )
      current()
      const receipt = bindingReceiptSchema.safeParse(binding)
      this.evidence.record('breakpoint.pause-binding', {
        participant: stop.participant,
        sessionId: pause.sessionId,
        expected: {
          id: registered.breakpointId,
          line: stop.source.line,
          column: stop.source.column,
          path: stop.bundle.sourcePath,
        },
        returned:
          binding === undefined
            ? 'absent'
            : receipt.success
              ? 'parsed'
              : 'malformed',
        observed: receipt.success ? receipt.data : undefined,
      })
      const parsed = bindingSchema
        .extend({
          id: z.number().int(),
          source: z.object({ path: z.string().optional() }).optional(),
        })
        .safeParse(binding)
      if (
        !parsed.success ||
        parsed.data.id !== registered.breakpointId ||
        (parsed.data.source?.path &&
          resolve(parsed.data.source.path) !== stop.bundle.sourcePath)
      )
        throw new Error(
          'Pending server breakpoint did not bind to the captured source',
        )
      // The owned breakpoint is verified in the cited file but on a line the stop's rule refuses: name where it landed so the declaration can be corrected.
      if (!stop.acceptsBoundLine(parsed.data.line))
        throw this.bindingFailure(
          stop,
          `Declared stop ${this.declaredAt(stop)} bound at ${parsed.data.line}:${parsed.data.column}, not on its declared line`,
        )
      stop.bound = { line: parsed.data.line, column: parsed.data.column }
    }
    const stack: DebugProtocol.StackTraceResponse['body'] = await awaitResponse(
      participant.selected!.customRequest('stackTrace', {
        threadId: pause.threadId,
        startFrame: 0,
        levels: REPOSITORY_STACK_FRAME_LIMIT,
      }),
      'repository stack',
      this.abort.signal,
    )
    current()
    const frame = stack.stackFrames[0],
      callFrame = stopped.event.callFrames[0]!,
      position = stop.source
    // The paused frame must be the position the debugger bound, which may differ from the requested column and, by the stop's rule, from the declared line.
    if (!isFrameAtPosition(frame, stop.bundle.sourcePath, stop.bound))
      throw new Error('DAP frame differs from exact configured source')
    await this.verifySources()
    current()
    const executed = await participant.cdp!.request(
      'Debugger.getScriptSource',
      { scriptId: callFrame.location.scriptId },
    )
    current()
    stop.verifier.verify(
      executed.scriptSource,
      stop.bundle.source,
      callFrame.location,
      stop.script!.scriptId,
      frame.line,
      frame.column,
    )
    const facts = await inspectConfiguredValues(
      (parameters) =>
        participant.cdp!.request('Debugger.evaluateOnCallFrame', parameters),
      callFrame.callFrameId,
      stop.inspections,
      current,
    )
    current()
    const debuggerSnapshot = await captureReplayDebugSnapshot({
      stack,
      verifiedSource: {
        name: position.path,
        text: stop.bundle.source,
        hash: stop.verifier.hashes.typescript,
        line: frame.line,
      },
      request: (command, arguments_) =>
        participant.selected!.customRequest(command, arguments_),
      assertCurrent: current,
      signal: this.abort.signal,
    })
    current()
    let inspectionFailure: Error | undefined
    try {
      const missing = stop.inspections.find(
        (inspection) =>
          inspection.required &&
          facts.unavailableValues.some(
            (value) => value.path === `${inspection.mode}:${inspection.path}`,
          ),
      )
      if (missing)
        throw new Error(
          `Required inspection ${missing.mode}:${missing.path} is unavailable; captured facts remain readable.`,
        )
      await this.capture(phase, current, pause)
      current()
      // Retire this position before authorizing continuation; the next declared position is armed separately.
      await stop.breakpoint!.retire(participant.selected!, this.abort.signal)
      current()
    } catch (error) {
      // A still-owned verified stop retains its facts even when its image or required inspection is incomplete.
      current()
      inspectionFailure =
        error instanceof Error ? error : new Error(String(error))
      if (this.captures[phase]?.status === 'pending')
        this.captures[phase] = {
          status: 'failed',
          error: inspectionFailure.message,
        }
    }
    const receipt = this.evidence.record('snapshot.committed', {
      snapshotId: `${pause.sessionId}:${pause.generation}`,
    })
    const snapshot: ConfiguredRuntimeSnapshot = {
      id: `${pause.sessionId}:${pause.generation}`,
      itemId: this.definition.descriptor.itemId,
      actionId: REPOSITORY_BROWSER_ACTION,
      capturePhase: phase,
      participant: stop.participant,
      pause: { ...pause },
      capturedAt: receipt.wallTime,
      elapsedMs: receipt.elapsedMs,
      debugger: debuggerSnapshot,
      source: {
        text: stop.bundle.source,
        hash: stop.verifier.hashes.typescript,
        line: frame.line,
        column: frame.column,
        javascriptHash: stop.verifier.hashes.javascript,
        mapHash: stop.verifier.hashes.sourceMap,
        scriptId: stop.script!.scriptId,
        scriptUrl: stop.script!.url,
        generated: {
          line: callFrame.location.lineNumber,
          column: callFrame.location.columnNumber ?? 0,
        },
      },
      ...facts,
    }
    this.snapshotCaptures[snapshot.id] = { ...this.captures[phase] }
    try {
      await this.evidence.save(
        `snapshot-${stop.participant}-${pause.generation}.json`,
        snapshot,
      )
      await this.evidence.save('snapshot.json', snapshot)
    } catch (error) {
      current()
      this.snapshot = snapshot
      this.snapshots.push(snapshot)
      throw error
    }
    current()
    this.snapshot = snapshot
    this.snapshots.push(snapshot)
    if (inspectionFailure) {
      participant.gate.invalidate(true)
      throw inspectionFailure
    }
    this.snapshotReady = true
    await this.persist()
  }

  /** Reserves one exact tuple before source revalidation; only owned retired breakpoints can lead to an acknowledged continuation. @example await run.continue('browser', pause) */
  async continue(name: Participant, pause: PauseIdentity): Promise<void> {
    const stop = this.stops[this.stopIndex],
      participant = this.participants[name]
    if (
      stop?.participant !== name ||
      this.cleaning ||
      participant.refresh ||
      !this.snapshotReady ||
      !this.snapshot ||
      !stop.breakpoint?.retired ||
      !participant.gate.matches(this.snapshot.pause) ||
      !participant.gate.reserve(pause)
    )
      throw new Error('conflict: stale, foreign or unverified pause')
    try {
      await this.verifySources()
      this.alive()
      if (
        participant.gate.phase !== 'resume-requested' ||
        participant.gate.current?.generation !== pause.generation
      )
        throw new Error('conflict: pause changed before continue')
      const nextStop = this.stops[this.stopIndex + 1]
      if (nextStop) {
        try {
          await this.armStop(nextStop)
        } catch (error) {
          // Nothing has been resumed yet, so the record says exactly that instead of an uncertain continuation.
          this.fail(
            `Next declared stop was not armed and no resume was sent: ${String(error)}`,
          )
          throw error
        }
        this.alive()
      }
      if (
        participant.gate.phase !== 'resume-requested' ||
        participant.gate.generation !== pause.generation
      )
        throw new Error('conflict: pause changed while binding next stop')
      const continuation: Continuation = (this.continuation = {
        participant: name,
        pause: { ...pause },
        response: false,
        dap: false,
        cdp: false,
        afterStarted: false,
      })
      participant.expectedResumeRequests++
      this.evidence.record('continue.accepted', pause)
      this.progressDeadline(
        ACTIVE_TIMEOUT_MS,
        'Repository continuation acknowledgement timed out',
      )
      await awaitResponse(
        participant.selected!.customRequest('continue', {
          threadId: pause.threadId,
        }),
        'repository continue',
        this.abort.signal,
      )
      this.alive()
      continuation.response = true
      this.beginAfter(continuation)
    } catch (error) {
      this.fail(`Continue uncertain: ${String(error)}`)
      throw error
    }
  }
  /** Starts after verification once all three independent continuation acknowledgements name the original generation. @example this.beginAfter(continuation) */
  private beginAfter(continuation: Continuation): void {
    if (
      this.cleaning ||
      continuation !== this.continuation ||
      !continuation.response ||
      !continuation.dap ||
      !continuation.cdp ||
      continuation.afterStarted
    )
      return
    continuation.afterStarted = true
    this.operation!.continuedPause = continuation.pause
    if (
      this.stopIndex + 1 <
      configuredStops(this.definition.configuration).length
    ) {
      this.stopIndex++
      this.acceptedStop = false
      this.snapshotReady = false
      this.continuation = undefined
      this.status = 'acting'
      // A later stop is armed only inside the preceding continuation, so a line that ran before its turn never pauses; say which stop and why.
      const nextStop = this.stops[this.stopIndex]!
      this.progressDeadline(ACTIVE_TIMEOUT_MS, () =>
        this.unreachedNextStopReason(nextStop),
      )
      const cdpStop = this.pendingCdpStop,
        dapStop = this.pendingDapStop
      this.pendingCdpStop = undefined
      this.pendingDapStop = undefined
      // Publish queued events only after the previous generation has retired completely.
      if (cdpStop) this.onCdpPaused(cdpStop.participant, cdpStop.event)
      if (dapStop)
        this.onEvent(
          this.participants[dapStop.participant].selected!,
          dapStop.event,
        )
      return
    }
    this.status = 'resuming'
    this.progressDeadline(
      ACTIVE_TIMEOUT_MS,
      'Repository after condition or input acknowledgement timed out',
    )
    this.track(this.observeAfter(continuation))
  }
  /** Confirms input, declared DOM conditions and renderer ACK while no additional pause has invalidated the original completion, and waits until no participant is still paused at a pause the adapter made for itself. @example await this.observeAfter(continuation) */
  private async observeAfter(continuation: Continuation): Promise<void> {
    const current = (): void => {
      this.alive()
      if (
        this.continuation !== continuation ||
        Object.values(this.participants).some(
          (participant) => participant.gate.current,
        ) ||
        !continuation.dap ||
        !continuation.cdp ||
        !continuation.response
      )
        throw new Error('Original continuation no longer owns completion')
    }
    current()
    await this.waitForDom('after')
    current()
    await waitUntil(
      () => this.operation?.inputAcknowledged,
      'single input acknowledgement',
      ACTIVE_TIMEOUT_MS,
      this.abort.signal,
    )
    current()
    await waitUntil(
      () => this.adapterPausesRetired(),
      'adapter pause retirement',
      ACTIVE_TIMEOUT_MS,
      this.abort.signal,
    )
    current()
    await this.capture('after', current)
    current()
    await waitUntil(
      () => this.adapterPausesRetired(),
      'adapter pause retirement',
      ACTIVE_TIMEOUT_MS,
      this.abort.signal,
    )
    current()
    this.operation!.afterVerified = true
    this.status = 'completed'
    clearTimeout(this.progressTimer)
    this.evidence.record('screen.observed', {
      snapshotId: this.snapshot!.id,
      pause: continuation.pause,
      actionId: REPOSITORY_BROWSER_ACTION,
    })
    await this.persist()
  }

  /** Evaluates owned DOM data only after origin verification; invalid selectors/conditions never dispatch input. @example await this.readDom('before') */
  private async readDom(phase: 'before' | 'after') {
    const cdp = this.requireCdp(),
      identity = await cdp.request('Runtime.evaluate', {
        expression: 'location.origin',
        returnByValue: true,
      })
    this.alive()
    if (identity.exceptionDetails || identity.result.value !== this.origin)
      throw new Error('Selected page left its owned application origin')
    const action = this.definition.configuration.action
    const response = await cdp.request('Runtime.evaluate', {
      expression: configuredDomExpression(
        action[phase],
        phase === 'before' ? action.selector : undefined,
      ),
      returnByValue: true,
    })
    this.alive()
    if (response.exceptionDetails)
      throw new Error('Declared DOM conditions could not be evaluated')
    return domResultSchema.parse(response.result.value)
  }
  /** Polls conditions without repeating application input; setup and after verification call it. @example await this.waitForDom('after') */
  private async waitForDom(phase: 'before' | 'after'): Promise<void> {
    let lastResult: z.infer<typeof domResultSchema> | undefined
    const timeoutMessage = `Timed out waiting for configured ${phase} conditions`
    try {
      await waitUntil(
        async () => {
          lastResult = await this.readDom(phase)
          if (lastResult.failure?.reason === 'invalid-selector') {
            const location =
              lastResult.failure.conditionIndex === undefined
                ? 'click target'
                : `condition ${lastResult.failure.conditionIndex + 1}`
            throw new Error(
              `Invalid CSS selector in configured ${phase} ${location}; use browser-native CSS, not Playwright-specific pseudo selectors.`,
            )
          }
          return lastResult.ready
        },
        `configured ${phase} conditions`,
        ACTIVE_TIMEOUT_MS,
        this.abort.signal,
      )
    } catch (error) {
      if (
        !error ||
        typeof error !== 'object' ||
        !('message' in error) ||
        error.message !== timeoutMessage ||
        !lastResult?.failure
      )
        throw error
      const { conditionIndex, reason } = lastResult.failure
      const condition =
        conditionIndex === undefined
          ? 'click target'
          : `condition ${conditionIndex + 1} (${this.definition.configuration.action[phase][conditionIndex]?.kind ?? 'unknown'})`
      const failedCondition =
        conditionIndex === undefined
          ? undefined
          : this.definition.configuration.action[phase][conditionIndex]
      throw new Error(
        `${timeoutMessage}: ${condition} ${reason}.${configuredConditionHint(phase, failedCondition, lastResult.failure)}`,
      )
    }
  }
  /** Revalidates all cited disk identities and open buffers at effect/pause/continue boundaries without owning raw tabs. @example await this.verifySources() */
  private async verifySources(): Promise<void> {
    this.alive()
    assertConfiguredSourceDocuments(
      this.options.workspace,
      this.definition,
      vscode.workspace.textDocuments,
    )
    if (!this.preparedSources) throw new Error('Prepared sources are absent')
    await this.preparedSources.revalidate()
    this.alive()
    await this.preparedSources.verifyIdentities()
    this.alive()
    assertConfiguredSourceDocuments(
      this.options.workspace,
      this.definition,
      vscode.workspace.textDocuments,
    )
  }
  /** Retains exact pixels only after the source generation and native renderer both acknowledge the phase. @example await this.capture('paused-browser', current) */
  private async capture(
    phase: (typeof CONFIGURED_CAPTURE_PHASES)[number] | 'paused-server',
    current = (): void => this.alive(),
    pause?: PauseIdentity,
  ): Promise<void> {
    this.captures[phase] = { status: 'pending' }
    this.evidence.record('capture.requested', { phase, pause })
    try {
      const result = await this.requireCdp().request(
        'Page.captureScreenshot',
        { format: 'png' },
        CAPTURE_TIMEOUT_MS,
      )
      current()
      const bytes = Buffer.from(result.data, 'base64'),
        hash = sha256(bytes)
      // Record receipt-time pixels before disk/renderer waits; only the later exact-pause receipt confirms correspondence.
      this.evidence.record('capture.response-received', { phase, pause, hash })
      this.browser.recordCapture(result.data, phase)
      const file = pause ? `${phase}-${pause.generation}.png` : `${phase}.png`
      await this.evidence.save(file, bytes)
      current()
      // Native debugger focus can hide the leased panel; reacquire renderer readiness without closing the learner's source tab.
      await this.browser.reveal(this.abort.signal)
      current()
      const renderer = await this.browser.presentCapture(result.data, phase)
      current()
      if (!renderer || renderer.hash !== hash)
        throw new Error('Renderer did not acknowledge exact phase bytes')
      this.captures[phase] = { status: 'captured', file, renderer }
      this.evidence.record('capture.received', { phase, pause, renderer })
    } catch (error) {
      this.captures[phase] = { status: 'failed', error: String(error) }
      this.evidence.record('capture.failed', {
        phase,
        pause,
        reason: String(error),
      })
      throw error
    }
  }
  /** Reveals only the committed immutable source through the shared reader and drains its accepted presentation work on cleanup. @example await run.reveal(snapshot) */
  reveal(snapshot: RuntimeSnapshot): Promise<void> {
    this.alive()
    if (
      snapshot.actionId !== REPOSITORY_BROWSER_ACTION ||
      !this.snapshots.includes(snapshot)
    )
      throw new StudyError(
        'INVALID_REFERENCE',
        'Snapshot does not belong to this configured runtime.',
      )
    return this.acquire(this.options.revealSource(snapshot)).then(() => {
      this.alive()
      this.evidence.record('agent.source-revealed', {
        snapshotId: snapshot.id,
        line: snapshot.source.line,
        sourceHash: snapshot.source.hash,
        capturedReader: true,
      })
    })
  }
  /** Returns only sealed bytes for this exact learning identity, independent of later files. @example run.source(itemId)?.javascript */
  source(item: string, snapshotId?: string): BundleSource | undefined {
    if (item !== this.definition.descriptor.itemId) return undefined
    if (snapshotId === undefined) return this.stops[0]?.bundle
    const index = this.snapshots.findIndex(
      (snapshot) => snapshot.id === snapshotId,
    )
    return index < 0 ? undefined : this.stops[index]?.bundle
  }
  /** Exposes bounded descriptors and immutable references; service signatures never serialize full modules or maps. @example run.view().participants.browser.pause */
  view(): ConfiguredRuntimeView {
    const runtimeOutcome =
      this.operation?.afterVerified && !this.failures.length
        ? 'demonstrated'
        : 'not-demonstrated'
    const phases = [
      'before',
      ...new Set(
        configuredStops(this.definition.configuration).map(
          (stop) => `paused-${stop.participant}`,
        ),
      ),
      'after',
    ]
    const captureOutcome = phases.every(
      (phase) => this.captures[phase]?.status === 'captured',
    )
      ? 'complete'
      : 'incomplete'
    return {
      runId: this.id,
      profile: REPOSITORY_BROWSER_PROFILE,
      definition: this.definition,
      manifest: this.manifest,
      status: this.status,
      cleaned: this.cleaned,
      resourcesReleased: this.resourcesReleased,
      runtimeOutcome,
      captureOutcome,
      finalOutcome: !this.cleaned
        ? 'pending-teardown'
        : runtimeOutcome === 'demonstrated'
          ? captureOutcome === 'complete'
            ? 'demonstrated'
            : 'partial'
          : 'not-demonstrated',
      participants: {
        browser: this.participantView('browser'),
        ...(this.participants.server.selected
          ? { server: this.participantView('server') }
          : {}),
      },
      snapshots: [...this.snapshots],
      operation: this.operation,
      nextAction:
        this.status === 'ready' && !this.operation
          ? REPOSITORY_BROWSER_ACTION
          : undefined,
      observed: this.operation?.afterVerified
        ? { afterVerified: true }
        : undefined,
      links: [],
      captures: this.captures,
      snapshotCaptures: { ...this.snapshotCaptures },
      failures: [...this.failures],
      events: this.evidence.events,
      artifactDirectory: this.evidence.directory,
      activeSessionIds: [...this.activeSessions],
    }
  }
  /** Exposes only the matching participant's current snapshot and continuation receipt. @example this.participantView('server') */
  private participantView(
    name: Participant,
  ): ConfiguredRuntimeView['participants']['browser'] {
    const participant = this.participants[name],
      continued = this.operation?.continuedPause
    return {
      sessionId: participant.selected?.id,
      pause: participant.gate.current,
      phase: participant.gate.phase,
      snapshot:
        this.snapshotReady && this.snapshot?.participant === name
          ? this.snapshot
          : undefined,
      continued:
        continued?.sessionId === participant.selected?.id
          ? continued
          : undefined,
      conflict: participant.gate.conflict,
    }
  }
  /** Revokes every completion token immediately and schedules cleanup after the failing activity can settle. @example run.fail('source changed') */
  fail(reason: string): void {
    if (this.cleaning || this.status === 'failed') return
    this.failures.push(reason)
    this.status = 'failed'
    this.continuation = undefined
    for (const participant of Object.values(this.participants))
      participant.gate.invalidate(true)
    this.evidence.record('run.failed', { reason })
    queueMicrotask(() => {
      void this.stop().catch((error) => this.failures.push(String(error)))
    })
  }
  /** Shares owned cleanup and permits explicit retry only after an incomplete release. @example await run.stop() */
  async stop(): Promise<void> {
    const attempt = (this.cleanupPromise ??= this.cleanupOwned())
    try {
      await attempt
    } catch (error) {
      if (this.cleanupPromise === attempt) this.cleanupPromise = undefined
      throw error
    }
  }
  /** Closes transports before draining acquisitions; raw tabs, dirty files and unrelated breakpoints are never cleanup targets. @example await this.cleanupOwned() */
  private async cleanupOwned(): Promise<void> {
    this.evidence.record('cleanup.started')
    if (this.transientBrowserPause) {
      clearTimeout(this.transientBrowserPause.timer)
      this.transientBrowserPause = undefined
    }
    this.cleaning = true
    this.abort.abort()
    this.continuation = undefined
    for (const participant of Object.values(this.participants))
      participant.gate.invalidate()
    this.browser.resumeViewport()
    clearTimeout(this.progressTimer)
    clearTimeout(this.runTimer)
    this.options.control?.signal.removeEventListener('abort', this.cancel)
    if (!['failed', 'completed'].includes(this.status))
      this.status = 'cancelled'
    const failures = await settleCleanup(
      Object.entries(this.participants).map(([name, participant]) => ({
        description: `${name} CDP close`,
        release: () => participant.cdp?.close(),
      })),
    )
    failures.push(...(await this.stopKnownDebuggers()))
    failures.push(
      ...(await settleCleanup([
        {
          description: 'browser acquisitions',
          release: (): Promise<void> => this.browser.drainAcquisitions(),
        },
        {
          description: 'source/proxy acquisitions',
          release: () =>
            awaitResponse(
              Promise.allSettled(this.acquisitions),
              'repository acquisitions',
            ),
        },
        {
          description: 'preparation settle',
          release: (): Promise<void> =>
            awaitResponse(
              this.preparation?.catch(() => undefined) ?? Promise.resolve(),
              'repository preparation',
            ),
        },
        ...this.stops.map((stop) => ({
          description: 'owned breakpoint',
          release: () => stop.breakpoint?.remove(),
        })),
      ])),
    )
    failures.push(...(await this.stopKnownDebuggers()))
    failures.push(
      ...(await settleCleanup([
        {
          description: 'owned application stop',
          release: () => this.app?.close(),
        },
        {
          description: 'protocol activities settle',
          release: () =>
            awaitResponse(
              Promise.allSettled(this.activities),
              'repository activities',
            ),
        },
        {
          description: 'owned browser close',
          release: (): Promise<void> => this.browser.close(),
        },
        {
          description: 'owned sessions exit',
          release: () =>
            waitUntil(
              () => !this.activeSessions.size,
              'repository sessions exit',
              ACTIVE_TIMEOUT_MS,
            ),
        },
      ])),
    )
    this.failures.push(...failures)
    this.resourcesReleased = failures.length === 0
    this.cleaned = this.resourcesReleased
    if (failures.length) this.status = 'failed'
    this.evidence.record('cleanup.completed', {
      released: this.resourcesReleased,
      failures,
    })
    try {
      await this.persist()
    } catch (error) {
      this.cleaned = false
      this.status = 'failed'
      this.failures.push(`Final evidence persistence failed: ${String(error)}`)
      throw error
    }
    if (failures.length) throw new Error(failures.join('; '))
  }
  /** Stops only acquired active roots before and after late acquisition draining. @example await this.stopKnownDebuggers() */
  private stopKnownDebuggers(): Promise<string[]> {
    return settleCleanup(
      [...this.sessions.values()]
        .filter(
          (session) =>
            !session.parentSession && this.activeSessions.has(session.id),
        )
        .map((session) => ({
          description: 'owned debugger stop',
          release: (): Promise<void> =>
            awaitResponse(
              vscode.debug.stopDebugging(session),
              'repository debugger stop',
            ),
        })),
    )
  }
  /** Saves private run/definition evidence without changing public storage or learner understanding. @example await this.persist() */
  private async persist(): Promise<void> {
    await this.evidence.save('runtime.json', {
      ...this.view(),
      definition: this.definition,
      host: this.options.host,
    })
    await this.evidence.flush()
  }
  /** Applies the current active/hold/setup budget independently from the pending input's whole-run protocol timeout; an expiry while a participant is paused with no announced stop also says where. A reason given as a function is read at expiry, for a text that depends on what is known only then. @example this.progressDeadline(ACTIVE_TIMEOUT_MS, 'after timed out') */
  private progressDeadline(
    milliseconds: number,
    reason: string | (() => string),
  ): void {
    clearTimeout(this.progressTimer)
    // The pause that explains an expiry arrives after the deadline's text was chosen, so the text is completed when it expires.
    this.progressTimer = setTimeout(
      () =>
        this.fail(
          withUnannouncedPauses(
            typeof reason === 'function' ? reason() : reason,
            this.unannouncedPausePlaces(),
          ),
        ),
      milliseconds,
    )
  }
  /** Rejects work after cancellation, source authority failure or trusted-workspace replacement. @example this.alive() */
  private alive(): void {
    this.abort.signal.throwIfAborted()
    if (this.cleaning || this.status === 'failed')
      throw new Error('Repository run is unavailable')
    this.options.assertWorkspace()
  }
  /** Retains protocol activities so cleanup can close their transports before awaiting them. @example this.track(this.inspect(pause)) */
  private track(activity: Promise<unknown>): void {
    const tracked = activity
      .then(() => undefined)
      .catch((error) => {
        if (!this.cleaning) this.fail(String(error))
      })
      .finally(() => this.activities.delete(tracked))
    this.activities.add(tracked)
  }
  /** Preserves non-cancellable native acquisition handles beyond abort for final ownership draining. @example await this.acquire(Cdp.connect(url, record)) */
  private acquire<Value>(promise: PromiseLike<Value>): Promise<Value> {
    const pending = Promise.resolve(promise)
    this.acquisitions.add(pending)
    void pending.then(
      () => this.acquisitions.delete(pending),
      () => this.acquisitions.delete(pending),
    )
    return pending
  }
  /** Requires the explicitly selected page proxy rather than an active editor target. @example this.requireCdp().closed */
  private requireCdp(): Cdp {
    const cdp = this.participants.browser.cdp
    if (!cdp) throw new Error('Selected CDP unavailable')
    return cdp
  }
}
