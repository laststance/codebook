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
  ADAPTER_PAUSE_RETIREMENT_WAIT_DESCRIPTION,
  MAX_EVENTS,
  MAX_QUEUED_EVIDENCE_BYTES,
  MAX_RETAINED_EVENT_BYTES,
  MILLISECONDS_PER_SECOND,
  REPOSITORY_ADAPTER_PAUSE_JOURNAL_LIMIT,
  REPOSITORY_ADAPTER_PAUSE_LIMIT_MS,
  REPOSITORY_ANNOUNCED_PAUSE_RESUME_LIMIT_MS,
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
  SOURCE_BOUND_PAUSE_WAIT_DESCRIPTION,
} from './constants'
import { StudyError } from './errors'
import {
  OwnedBreakpointMovedError,
  OwnedBreakpointRemovedError,
  OwnedRepositoryBreakpoint,
  verifiedPlaceSchema,
} from './ownedRepositoryBreakpoint'
import type { BundleSource } from './repositoryBundle'
import {
  configuredDomFailureSchema,
  type ConfiguredDomFailure,
} from './repositoryConfigSchemas'
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
import { WaitTimeoutError } from './runtimeSupport/utils/waitTimeoutError'
import { waitTimeoutText } from './runtimeSupport/utils/waitTimeoutText'
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
import { configuredStopFields } from './utils/configuredStopFields'
import { configuredStops } from './utils/configuredStops'
import { continuationReceipts } from './utils/continuationReceipts'
import { createBindingLineRule } from './utils/createBindingLineRule'
import { createBundleVerifier } from './utils/createBundleVerifier'
import { deadlineText } from './utils/deadlineText'
import { declaredAndArmedPlace } from './utils/declaredAndArmedPlace'
import { describeCdpPause } from './utils/describeCdpPause'
import { elapsedMsSince } from './utils/elapsedMsSince'
import { findUnmappedDeclaredStop } from './utils/findUnmappedDeclaredStop'
import { inspectConfiguredValues } from './utils/inspectConfiguredValues'
import { isBlankOrCommentLine } from './utils/isBlankOrCommentLine'
import { isFrameAtPosition } from './utils/isFrameAtPosition'
import { isPauseAtBoundColumn } from './utils/isPauseAtBoundColumn'
import { isPauseAtStop, type PauseStopTarget } from './utils/isPauseAtStop'
import { isPauseInScript } from './utils/isPauseInScript'
import { isRefreshedFrameAtStop } from './utils/isRefreshedFrameAtStop'
import { launchDevelopmentServer } from './utils/launchDevelopmentServer'
import { pausePlace } from './utils/pausePlace'
import { prepareRepositoryInputs } from './utils/prepareRepositoryInputs'
import { readDevelopmentBundle } from './utils/readDevelopmentBundle'
import { resolveArmedPlace } from './utils/resolveArmedPlace'
import { sameScriptUrl } from './utils/sameScriptUrl'
import { selfDeclaredInspectionHint } from './utils/selfDeclaredInspectionHint'
import type { MappedPositionsScan } from './utils/sourceMapMappedPositions'
import { takenStopPosition } from './utils/takenStopPosition'
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
  /** The one scan of the stop's sealed map, from its declared line to the end of its citation; {@link resolveArmedPlace}, {@link createBindingLineRule} and the preparation refusal read it instead of the map. */
  scan: MappedPositionsScan
  /** Where the stop's breakpoint is requested ({@link resolveArmedPlace}): the declared position, or the first mapped position after a declared line that has none. */
  armed: { line: number; column: number }
  /** The place of the stop's first request, kept once {@link ConfiguredBrowserRun.rearmOnRequestedLine} requested the stop a second time, so a text can say which column the second request replaced. */
  firstRequest?: { line: number; column: number }
  /** The debugger's verified binding, on the declared line or on a later line {@link PreparedStop.acceptsBoundLine} accepts; every later check, the saved observation and the display use it instead of the requested position. */
  bound?: { line: number; column: number }
  /** Tells whether a line the debugger chose is this stop's place, measured from the line the stop is requested on ({@link createBindingLineRule}): the lines from the declared to the requested one, or a later line within the stop's citation with no mapped line between it and the requested line. Every site that compares a binding or a pause with this stop asks it. */
  acceptsBoundLine: (line: number) => boolean
  /** Names the condition that refuses a line as this stop's place, for the failure an agent reads; `undefined` for an accepted line. */
  bindingRefusal: (line: number) => string | undefined
}
/** What a server stop's registration says when a deadline expires; a refusal keeps the reason the registration read threw, so the deadline text can pass it on, and the place when the adapter moved the breakpoint to a line the stop's rule refuses. */
type RegistrationStatus =
  | { status: 'pending' | 'bound' | 'unknown' }
  | {
      status: 'refused'
      reason: string
      movedTo?: { line: number; column: number }
    }
type DebugParticipant = {
  gate: PauseGate
  selected?: vscode.DebugSession
  cdp?: Cdp
  /** The pause of the expected declared stop: on its bound line in its module (before the binding is known, the declared line or a line its rule accepts), or adopted after an announced pause stayed elsewhere in that module. `generation` is set once {@link ConfiguredBrowserRun.inspect} binds it to an accepted stop. */
  stopped?: {
    event: Protocol.Debugger.PausedEvent
    generation?: number
    /** Set when the pause was held elsewhere in the stop's module and taken as the announced one after the wait for the stop's own pause ({@link ConfiguredBrowserRun.adoptPauseHeldInModule}). */
    adopted?: true
  }
  /** A pause away from the expected declared stop that no debugger stop was accepted for, with the stop that was expected when it arrived (none between a snapshot and its continuation). The debug adapter makes such pauses for itself and resumes them; the resume retires it, and a deadline that expires meanwhile names it. */
  unannouncedPause?: {
    event: Protocol.Debugger.PausedEvent
    expectedStop: PreparedStop | undefined
    /** The run clock when the pause was held, for the bound within which a resume is the debug adapter's own. */
    heldAtMs: number
    /** Whether its observation was journaled; past the journal's cap of such pauses only their count is kept. */
    journaled: boolean
  }
  /** The runtime is paused for its own instrumentation (a source map being read); it is no stop and no adapter breakpoint, but completion waits for its resume. */
  instrumentationPaused?: boolean
  /** A stack refresh announced while the accepted stop's own pause was still awaited or had been adopted: {@link ConfiguredBrowserRun.inspect} judges that stop, so the refresh's re-announced stop is consumed without a check of its own. */
  deferredRefresh?: PauseIdentity
  /** Every script this participant announced, by script id, so the journal can name the place of a pause in any of them. */
  scriptUrls: Map<string, string>
  /** The journal clock when the last pause was observed; cleared by its resume. */
  pauseObservedAtMs?: number
  /** Whether the last observed pause was journaled or only counted; cleared by its resume. The resume of a pause nothing holds (an instrumentation pause, a pause from before the action) is journaled or counted with it. */
  pauseJournaled?: boolean
  /** A DAP presentation refresh awaiting its matching stop and source check; the CDP target stays paused. */
  refresh?: {
    pause: PauseIdentity
    stopped: NonNullable<DebugParticipant['stopped']>
    stage: 'awaiting-stop' | 'validating'
  }
  expectedResumeRequests: number
}
/** A server debug session whose native proxy was verified to inspect the launched worker; {@link ConfiguredBrowserRun.selectServer} collects them and selects one. */
type ServerMatch = {
  session: vscode.DebugSession
  cdp: Cdp
  identity: Awaited<
    ReturnType<ReturnType<typeof launchDevelopmentServer>['verifyInspector']>
  >
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
  failure: configuredDomFailureSchema.optional(),
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
  private transientBrowserPause?: {
    timer: ReturnType<typeof setTimeout>
    event: Protocol.Debugger.PausedEvent
    journaled: boolean
  }
  /** How many pauses away from the expected stop were observed; the journal names only the first {@link REPOSITORY_ADAPTER_PAUSE_JOURNAL_LIMIT} of them. */
  private offStopPauseCount = 0
  /** How many instrumentation pauses of the runtime were observed; they are journaled under the same limit, counted apart, so they leave the pauses the debugger makes for itself their room in the journal. */
  private instrumentationPauseCount = 0
  /** How many idle `continued` events were read; journaled under the same cap. */
  private idleContinuedCount = 0
  /** How many pauses, resumes of pauses that were only counted and idle `continued` events past their caps were left out of the journal; cleanup journals the count. */
  private unjournaledAdapterEvents = 0
  /** What the after conditions last answered while they did not hold, so the run's own deadline, which ends the after wait first, can still name the condition and its hint ({@link afterDeadlineReason}). */
  private lastAfterFailure?: ConfiguredDomFailure
  private progressTimer?: ReturnType<typeof setTimeout>
  /** True while {@link progressTimer} is the pause hold, the only deadline {@link renewPauseHold} may restart. */
  private holdingPause = false
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
      () =>
        this.fail(
          this.expiredDeadlineText(
            'Repository whole-run deadline exceeded',
            deadlineAt - now,
          ),
        ),
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
      // The sealed map is scanned once per stop, from its declared line to the end of its citation; the place, the rule and the refusal below read that scan, and the pause handler only compares lines.
      const scan = verifier.mappedPositions(stop.source.line, citation.endLine),
        taken = this.takeDeclaredPosition(stop, index),
        // The debugger verifies no breakpoint on a line without a mapped position, so such a stop is requested at the first mapped position after it, and its rule is measured from there.
        armed = resolveArmedPlace(taken, scan)
      const bindingRule = createBindingLineRule(
        stop.source.line,
        citation,
        scan,
        armed.line,
      )
      const prepared: PreparedStop = {
        ...stop,
        bundle: acquired.bundle,
        verifier,
        scan,
        armed: { line: armed.line, column: armed.column },
        acceptsBoundLine: bindingRule.accepts,
        bindingRefusal: bindingRule.refusal,
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
    const unmappedStop = findUnmappedDeclaredStop(
      this.stops,
      (stop, scanComplete) =>
        // When the scan stopped at its size limit, the sealed source says whether the line holds code.
        (!scanComplete &&
          !isBlankOrCommentLine(stop.bundle.source, stop.source.line)) ||
        // The debugger verifies nothing on a line without a mapped position, so such a stop is requested at the first mapped position after it within its citation; only a stop with no such place can never bind.
        this.canLaterLineBind(
          stop,
          this.definition.descriptor.anchors[stop.anchorIndex]!.endLine,
        ),
    )
    if (unmappedStop)
      throw this.bindingFailure(
        unmappedStop,
        `Declared stop ${this.declaredAt(unmappedStop)} has no mapped position on that line in the sealed module`,
      )
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
    // A later browser stop is armed only in its turn, but a module that is already loaded can be compared with its sealed bundle now, before any application effect.
    for (const laterStop of this.stops.slice(1))
      if (laterStop.participant === 'browser' && laterStop.script)
        await this.assertExecutedModuleSealed(laterStop, 'before input')
    await this.browser.reveal(this.abort.signal)
    this.alive()
    await this.capture('before')
    this.alive()
    clearTimeout(this.progressTimer)
    this.status = 'ready'
    await this.persist()
  }

  /**
   * Takes a declared stop at the position Codebook uses for it and journals the difference, for the preparation of each stop in {@link prepareOwned}: a column declared on a blank line means that line, so the stop is taken at the line's start ({@link takenStopPosition}) and its breakpoint is requested from there.
   * @param stop - The declared stop, as {@link configuredStops} gives it.
   * @param stopIndex - Its zero-based place among the declared stops, which names its configuration field.
   * @returns
   * - A stop declared past column 1 of a blank line: its line at column 1, after the journal entry `breakpoint.column-on-blank-line` with the field, the declared and the taken position
   * - Any other stop: its declared position, and nothing is journaled
   * @example
   * ```ts
   * this.takeDeclaredPosition(stop, 1) // => { line: 38, column: 1, … } for additionalStops[0] declared at 38:9 on a blank line 38
   * ```
   */
  private takeDeclaredPosition(
    stop: ReturnType<typeof configuredStops>[number],
    stopIndex: number,
  ): ReturnType<typeof configuredStops>[number]['source'] {
    const taken = takenStopPosition(
      stop.source,
      this.definition.descriptor.sources,
    )
    // Only a column the run set aside is journaled, so the journal says what Codebook did with the declaration.
    if (taken.column !== stop.source.column)
      this.evidence.record('breakpoint.column-on-blank-line', {
        participant: stop.participant,
        field: `${configuredStopFields(this.definition.configuration.version, stopIndex).source}.column`,
        declared: { line: stop.source.line, column: stop.source.column },
        taken: { line: taken.line, column: taken.column },
      })
    return taken
  }

  /**
   * Compares the module the page executes for a browser stop with the stop's sealed bundle, for {@link armStop} and for the check of later stops before input in {@link prepareOwned}.
   * @param stop - A browser stop whose module is loaded (`stop.script` is set).
   * @param phase - When the check runs, for the failure text.
   * @throws When the executed bytes differ from the sealed ones; the text names the declared stop and the phase.
   * @example
   * ```ts
   * await this.assertExecutedModuleSealed(stop, 'before input')
   * ```
   */
  private async assertExecutedModuleSealed(
    stop: PreparedStop,
    phase: string,
  ): Promise<void> {
    const executed = await this.participants[stop.participant].cdp!.request(
      'Debugger.getScriptSource',
      { scriptId: stop.script!.scriptId },
    )
    this.alive()
    if (sha256(executed.scriptSource) !== stop.verifier.hashes.javascript)
      throw new Error(
        `Executed module of declared stop ${this.declaredAt(stop)} differs from its sealed bundle (checked ${phase})`,
      )
  }

  /**
   * Arms the next expected stop before any input or resume can reach it, called by {@link prepareOwned} for the first stop and by {@link continue} for each later one.
   * The breakpoint is requested at {@link PreparedStop.armed}: the declared position, or, because the debugger verifies nothing on a line without a mapped position, the first mapped position after such a declared line ({@link resolveArmedPlace}). The stop's rule is measured from that requested line. The requested column is a preference: a browser stop records the debugger's verified binding as its position, on the requested line or on a line the rule accepts, and a server stop's owned breakpoint is given the same rule for its acknowledgement.
   * For both participants, a binding acknowledged on a later line although the requested line can pause is answered with one more request, at that line's break location before the requested column ({@link rearmOnRequestedLine}), whether the stop's rule accepts that later line or refuses it; the stop is refused only when the second request is bound on a later line again, or no break location lies before the requested column. A later line the rule refuses is refused as such only when the requested line cannot pause, or the debugger cannot say.
   * @param stop - The declared stop that is next in order.
   * @throws When a browser binding lands on a line the rule refuses or never verifies, a server registration is refused, or a second request is bound past its line again; each failure names the declared stop.
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
      // The first stop is armed before input; every later one inside the continuation that precedes it.
      const phase =
        stop === this.stops[0]
          ? 'before input'
          : 'while arming it inside the preceding continuation'
      await waitUntil(
        () => stop.script,
        `the loaded module of declared stop ${this.declaredAt(stop)} (${phase})`,
        ACTIVE_TIMEOUT_MS,
        this.abort.signal,
      )
      await this.assertExecutedModuleSealed(stop, phase)
    }
    // A map too large to scan left the place of a stop on a line it found no position for undecided; the parsed module's break locations decide it now.
    if (!stop.breakpoint) await this.confirmRequestedPlace(stop)
    let armed = stop.armed
    if (!stop.breakpoint && armed.line !== position.line)
      this.evidence.record('breakpoint.armed-after-declared-line', {
        participant: stop.participant,
        declared: { line: position.line, column: position.column },
        armed,
      })
    stop.breakpoint ??= this.requestBreakpoint(stop)
    if (stop.participant === 'server') {
      await this.acknowledgedOnRequestedLine(stop, armed)
      await this.verifySources()
      return
    }
    let binding = await this.verifiedBrowserBinding(stop)
    this.alive()
    // A line after the requested one is the stop's place only when the debugger could not pause on the requested line at all; when it can, the stop is requested once more at that line's break location before the requested column.
    if (
      binding.line > armed.line &&
      (await this.rearmOnRequestedLine(stop, binding))
    ) {
      const firstRequest = armed
      armed = stop.armed
      binding = await this.verifiedBrowserBinding(stop)
      this.alive()
      if (binding.line > armed.line)
        throw this.slideRefusal(stop, binding, firstRequest)
    }
    // No second request could be made (the requested line cannot pause, or the debugger cannot say): a later line the stop's rule refuses is refused now.
    this.assertBindingAccepted(stop, binding)
    this.bindBoundPlace(stop, binding)
    this.evidence.record('breakpoint.bound', {
      ...binding,
      requested: { line: position.line, column: position.column },
      ...declaredAndArmedPlace(position, armed),
    })
    await this.verifySources()
  }

  /**
   * Refuses a browser stop's verified binding on a line the stop's rule does not accept, for {@link armStop} once no second request could move it back to the requested line.
   * @param stop - The browser stop being armed.
   * @param binding - The verified binding the stop would be bound at.
   * @throws The binding failure that names the declared stop, the place and the rule's reason ({@link refusedBindingText}), with the mapping hints.
   * @example
   * ```ts
   * this.assertBindingAccepted(stop, { line: 26, column: 5 }) // throws 'Declared stop app/page.tsx:22 bound at 26:5, refused: line 23 between the declared line 22 and line 26 has a mapped position. …'
   * ```
   */
  private assertBindingAccepted(
    stop: PreparedStop,
    binding: { line: number; column: number },
  ): void {
    if (!stop.acceptsBoundLine(binding.line))
      throw this.bindingFailure(stop, this.refusedBindingText(stop, binding))
  }

  /**
   * Waits until the adapter acknowledged a server stop's registration while the stop is armed, for {@link armStop}; a pending registration is judged at its pause.
   * An acknowledgement on a later line, one the stop's rule accepts or one it refuses, is answered with one more request on the requested line when that line can pause ({@link rearmOnRequestedLine}).
   * @param stop - The server stop being armed; its owned breakpoint exists.
   * @param firstRequest - Where the stop was requested first ({@link PreparedStop.armed} before a second request).
   * @throws The registration's refusal when no second request could be made for it; the slide refusal ({@link slideRefusal}) when the second request was acknowledged on a later line again.
   * @example
   * ```ts
   * await this.acknowledgedOnRequestedLine(stop, stop.armed)
   * ```
   */
  private async acknowledgedOnRequestedLine(
    stop: PreparedStop,
    firstRequest: { line: number; column: number },
  ): Promise<void> {
    let acknowledged = await this.serverAcknowledgement(stop)
    const laterPlace = this.placeAfterLine(
      acknowledged.place,
      firstRequest.line,
    )
    if (laterPlace && (await this.rearmOnRequestedLine(stop, laterPlace)))
      acknowledged = await this.secondServerAcknowledgement(stop, firstRequest)
    // No second request could be made for a refused registration, or the second one was refused too: the refusal stands.
    if (acknowledged.refusal !== undefined) throw acknowledged.refusal
  }

  /**
   * Reads the acknowledgement of a server stop's second request, for {@link acknowledgedOnRequestedLine} right after {@link rearmOnRequestedLine} made it.
   * @param stop - The server stop being armed, requested a second time.
   * @param firstRequest - Where the stop was requested first.
   * @returns The acknowledgement of the second request, on the requested line or before it.
   * @throws The slide refusal ({@link slideRefusal}) when the adapter acknowledged the second request on a later line again: the stop cannot be bound on the line it was requested on.
   * @example
   * ```ts
   * acknowledged = await this.secondServerAcknowledgement(stop, firstRequest)
   * ```
   */
  private async secondServerAcknowledgement(
    stop: PreparedStop,
    firstRequest: { line: number; column: number },
  ): Promise<
    Awaited<ReturnType<ConfiguredBrowserRun['serverAcknowledgement']>>
  > {
    const acknowledged = await this.serverAcknowledgement(stop)
    const laterPlace = this.placeAfterLine(
      acknowledged.place,
      firstRequest.line,
    )
    if (laterPlace) throw this.slideRefusal(stop, laterPlace, firstRequest)
    return acknowledged
  }

  /**
   * Waits for the adapter's answer to a server stop's registration while the stop is armed and journals an acknowledged one as `breakpoint.registered`; called by {@link acknowledgedOnRequestedLine} for the first request and by {@link secondServerAcknowledgement} for the second.
   * A registration the adapter verified at a place the stop's rule refuses is returned with that place instead of thrown, so the caller can first ask whether the requested line can pause.
   * @param stop - The server stop being armed.
   * @returns
   * - `{ place }` for an acknowledged registration: where the adapter verified it on another line than requested (the receipt's `movedTo`), `undefined` on the requested line or while pending
   * - `{ place, refusal }` for a registration refused because of its place ({@link OwnedRepositoryBreakpoint.refusedPlace}): that place and the failure to throw when no second request is made
   * @throws The registration's failure when it was refused for another reason than its place, and for a cancelled run.
   * @example
   * ```ts
   * await this.serverAcknowledgement(stop) // { place: { line: 23, column: 5 } } for a stop requested at 22:40
   * ```
   */
  private async serverAcknowledgement(stop: PreparedStop): Promise<{
    place: { line: number; column: number } | undefined
    refusal?: unknown
  }> {
    try {
      const receipt = await this.registeredStop(stop)
      this.alive()
      this.evidence.record('breakpoint.registered', {
        participant: stop.participant,
        ...receipt,
      })
      return { place: receipt.movedTo }
    } catch (refusal) {
      const place = stop.breakpoint!.refusedPlace(
        this.participants[stop.participant].selected!,
      )
      // A cancelled run and a refusal that names no place keep their own failure.
      if (this.abort.signal.aborted || !place) throw refusal
      return { place, refusal }
    }
  }

  /** Gives a place only when it lies after a line, for the two checks of a server acknowledgement against the line its stop was requested on ({@link acknowledgedOnRequestedLine}, {@link secondServerAcknowledgement}). @example this.placeAfterLine({ line: 23, column: 5 }, 22) // { line: 23, column: 5 } */
  private placeAfterLine(
    place: { line: number; column: number } | undefined,
    line: number,
  ): { line: number; column: number } | undefined {
    return place && place.line > line ? place : undefined
  }

  /**
   * Adds a stop's owned breakpoint to the editor at the place the stop is requested at ({@link PreparedStop.armed}), with the stop's line rule for its acknowledgement; {@link armStop} calls it for the first request and {@link rearmOnRequestedLine} for the second.
   * @param stop - The stop being armed.
   * @returns The owner of the new editor breakpoint; the adapter has not acknowledged it yet.
   * @example
   * ```ts
   * stop.breakpoint ??= this.requestBreakpoint(stop)
   * ```
   */
  private requestBreakpoint(stop: PreparedStop): OwnedRepositoryBreakpoint {
    return new OwnedRepositoryBreakpoint(
      stop.bundle.sourcePath,
      stop.armed.line,
      stop.armed.column,
      'declared-line',
      stop.acceptsBoundLine,
    )
  }

  /**
   * Waits until the debugger verifies a browser stop's breakpoint, for {@link armStop}: once for the first request and once more after {@link rearmOnRequestedLine}.
   * @param stop - A browser stop whose owned breakpoint exists.
   * @returns The verified line and column: on a line the stop's rule accepts, or on a line after the requested one that the rule refuses, which {@link armStop} answers with a second request or refuses ({@link assertBindingAccepted}).
   * @throws When the binding lands before the declared line (at once, naming the condition) or never verifies within the bound (with the mapping hints); cancellation and an adapter failure keep their own reason.
   * @example
   * ```ts
   * const binding = await this.verifiedBrowserBinding(stop) // { verified: true, line: 23, column: 5 }
   * ```
   */
  private async verifiedBrowserBinding(
    stop: PreparedStop,
  ): Promise<z.infer<typeof verifiedPlaceSchema>> {
    const session = this.participants[stop.participant].selected!
    let boundElsewhere: z.infer<typeof verifiedPlaceSchema> | undefined,
      pollFailure: unknown
    try {
      return await waitUntil(
        async () => {
          let result: unknown
          try {
            result = await awaitResponse(
              session.getDebugProtocolBreakpoint(stop.breakpoint!.breakpoint),
              'repository binding',
              this.abort.signal,
            )
          } catch (error) {
            pollFailure = error
            throw error
          }
          const parsed = verifiedPlaceSchema.safeParse(result)
          if (!parsed.success) return undefined
          // The debugger chose a line the stop's rule refuses and no later poll moves it back, so the wait ends at once. A refused line after the requested one is returned: the requested line may still pause at an earlier column.
          if (this.isRefusedBeforeRequest(stop, parsed.data.line)) {
            boundElsewhere = parsed.data
            throw new Error('Repository breakpoint bound on another line')
          }
          return parsed.data
        },
        `a verified binding of declared stop ${this.declaredAt(stop)} on its declared line or a later line its binding rule accepts (${this.requestedAt(stop)}); declare the stop on an executable statement the action reaches (${this.declaredField(stop)})`,
        ACTIVE_TIMEOUT_MS,
        this.abort.signal,
      )
    } catch (error) {
      throw this.bindingWaitFailure(stop, error, boundElsewhere, pollFailure)
    }
  }

  /** Says whether a line the debugger bound a browser stop on is refused by the stop's rule and no second request can help, for each look of {@link verifiedBrowserBinding}: a refused line up to the requested one (a line before the declared line). @example this.isRefusedBeforeRequest(stop, 21) // true for a stop declared and requested on line 22 */
  private isRefusedBeforeRequest(stop: PreparedStop, line: number): boolean {
    return !stop.acceptsBoundLine(line) && line <= stop.armed.line
  }

  /**
   * Chooses what {@link verifiedBrowserBinding} throws when its wait ended without a verified binding on an accepted line, at the moment the wait ends.
   * @param stop - The browser stop whose binding was waited for.
   * @param error - What the wait threw.
   * @param boundElsewhere - The verified place on a line the stop's rule refuses, when a poll found one.
   * @param pollFailure - What a poll of the adapter threw, when one failed; `undefined` otherwise.
   * @returns
   * - The binding failure that names the refused place, for a binding on a refused line
   * - `error` itself, for a failed poll and for a cancelled run: they keep their own reason
   * - The binding failure with the wait's text and the mapping hints, for the expired wait
   * @example
   * ```ts
   * throw this.bindingWaitFailure(stop, error, undefined, undefined)
   * ```
   */
  private bindingWaitFailure(
    stop: PreparedStop,
    error: unknown,
    boundElsewhere: z.infer<typeof verifiedPlaceSchema> | undefined,
    pollFailure: unknown,
  ): unknown {
    if (boundElsewhere)
      return this.bindingFailure(
        stop,
        this.refusedBindingText(stop, boundElsewhere),
      )
    // Cancellation and an adapter failure keep their own reason; only the expired wait gains the mapping hints.
    if (pollFailure !== undefined || this.abort.signal.aborted) return error
    return this.bindingFailure(stop, thrownMessage(error))
  }

  /**
   * Names where a stop's breakpoint is requested, for the text of a binding that never verifies ({@link verifiedBrowserBinding}), so an agent sees the place the debugger was asked for and how Codebook chose it.
   * @param stop - The stop whose binding did not verify.
   * @returns
   * - `requested column C` for a stop requested where it was declared
   * - `requested at L:C, the first mapped position after the declared line` for a declared line without a mapped position ({@link resolveArmedPlace})
   * - `requested at L:C, the first place the debugger can pause at after the declared line` when the map was too large to scan and the break locations chose the place ({@link confirmRequestedPlace})
   * - `requested again at L:c, the line's break location before the first requested column C` after a second request ({@link rearmOnRequestedLine})
   * @example
   * ```ts
   * this.requestedAt(stop) // 'requested column 9'
   * ```
   */
  private requestedAt(stop: PreparedStop): string {
    const { armed, source, firstRequest } = stop
    // A second request names the column it replaced on its line.
    if (firstRequest)
      return `requested again at ${armed.line}:${armed.column}, the line's break location before the first requested column ${firstRequest.column}`
    if (armed.line === source.line) return `requested column ${source.column}`
    // A map too large to scan left the place to the debugger's break locations.
    const chosenBy = stop.scan.complete
      ? 'the first mapped position after the declared line'
      : 'the first place the debugger can pause at after the declared line'
    return `requested at ${armed.line}:${armed.column}, ${chosenBy}`
  }

  /**
   * Requests a stop's breakpoint once more on the line it was requested on, when the debugger acknowledged it on a later line although that line can pause: the requested column lay after the line's last break location, so the break location before it is asked for instead of taking the later line as the stop. {@link armStop} calls it for both participants while the stop is armed, before any input or resume.
   * The first registration is retired, and its retirement confirmed by the adapter ({@link OwnedRepositoryBreakpoint.retire}), before the second replaces it: afterwards exactly one owned breakpoint exists, and none after a failure or a cancellation.
   * @param stop - The stop being armed; the adapter acknowledged its owned breakpoint.
   * @param binding - Where the debugger acknowledged the breakpoint, on a later line than requested.
   * @returns
   * - `true` when the stop was requested again: {@link PreparedStop.armed} names the new request and `stop.breakpoint` owns the new registration, whose acknowledgement the caller waits for
   * - `false` when the requested line cannot pause, the adapter cannot list break locations, or the stop's module is not parsed yet: the binding is left to the stop's line rule
   * @throws The slide refusal ({@link slideRefusal}) when the requested line can pause but has no break location before the requested column; and when the first registration's retirement is not confirmed.
   * @example
   * ```ts
   * if (await this.rearmOnRequestedLine(stop, { line: 23, column: 5 })) binding = await this.verifiedBrowserBinding(stop)
   * ```
   */
  private async rearmOnRequestedLine(
    stop: PreparedStop,
    binding: { line: number; column: number },
  ): Promise<boolean> {
    // A server module the runtime has not announced has no break locations to ask for.
    if (!stop.script) return false
    const firstRequest = stop.armed,
      pausableColumns = await this.pausableColumns(stop, firstRequest.line)
    // An adapter that cannot list break locations, and a line that cannot pause, leave the binding to the line rule.
    if (!this.hasPausableColumn(pausableColumns)) return false
    const column = this.secondRequestColumn(
      stop,
      binding,
      pausableColumns,
      firstRequest.column,
    )
    try {
      await stop.breakpoint!.retire(
        this.participants[stop.participant].selected!,
        this.abort.signal,
      )
    } catch (error) {
      throw this.retirementFailure(
        stop,
        binding,
        firstRequest.line,
        column,
        error,
      )
    }
    this.alive()
    stop.armed = { line: firstRequest.line, column }
    stop.firstRequest = firstRequest
    stop.breakpoint = this.requestBreakpoint(stop)
    this.evidence.record('breakpoint.rearmed-on-requested-line', {
      participant: stop.participant,
      declared: { line: stop.source.line, column: stop.source.column },
      armed: stop.armed,
      firstRequest,
      firstBinding: { line: binding.line, column: binding.column },
    })
    return true
  }

  /**
   * Says whether the debugger named at least one break location on a line, for {@link rearmOnRequestedLine} and {@link journalSlidePastPausableLine} right after they asked {@link pausableColumns}.
   * @param columns - What the debugger answered for the line; `undefined` when the adapter cannot list break locations.
   * @returns `true` for a line that can pause; `false` for a line that cannot, and when the adapter cannot say.
   * @example
   * ```ts
   * this.hasPausableColumn([]) // false
   * ```
   */
  private hasPausableColumn(
    columns: number[] | undefined,
  ): columns is number[] {
    return Boolean(columns?.length)
  }

  /**
   * Chooses the column of a stop's second request on the line it was requested on, for {@link rearmOnRequestedLine}: the line's last break location before the first requested column.
   * @param stop - The stop being armed.
   * @param binding - Where the debugger acknowledged the first request, on a later line.
   * @param pausableColumns - The break locations of the requested line, ascending and not empty.
   * @param requestedColumn - The column of the first request.
   * @returns The column to request instead.
   * @throws The slide refusal ({@link slideRefusal}) when no break location lies before the requested column.
   * @example
   * ```ts
   * this.secondRequestColumn(stop, { line: 23, column: 5 }, [3, 20], 12) // 3
   * ```
   */
  private secondRequestColumn(
    stop: PreparedStop,
    binding: { line: number; column: number },
    pausableColumns: number[],
    requestedColumn: number,
  ): number {
    const column = pausableColumns.findLast(
      (pausableColumn) => pausableColumn < requestedColumn,
    )
    if (column === undefined) throw this.slideRefusal(stop, binding)
    return column
  }

  /**
   * Chooses what {@link rearmOnRequestedLine} throws when the first registration could not be retired before the second request.
   * @param stop - The stop being armed.
   * @param binding - Where the debugger acknowledged the first request.
   * @param requestedLine - The line of the first request, which can pause.
   * @param column - The column the second request would have taken on that line.
   * @param error - What the retirement threw.
   * @returns `error` itself for a cancelled run, otherwise the error that names the stop, the binding, the column and the retirement's reason.
   * @example
   * ```ts
   * throw this.retirementFailure(stop, { line: 23, column: 5 }, 22, 3, error)
   * ```
   */
  private retirementFailure(
    stop: PreparedStop,
    binding: { line: number; column: number },
    requestedLine: number,
    column: number,
    error: unknown,
  ): unknown {
    if (this.abort.signal.aborted) return error
    return new Error(
      `Declared stop ${this.declaredAt(stop)} bound at ${binding.line}:${binding.column} although line ${requestedLine} can pause at column ${column}, and its first breakpoint could not be retired before a second request there: ${thrownMessage(error)}`,
    )
  }

  /**
   * Waits for a declared stop's acknowledged registration, called wherever the run needs that receipt (arming, the final input check and the pause).
   * The tracker's refusal carries positions only as JSON, so the failure gains the declared stop and the mapping hints here; a breakpoint that was removed gets no hints, because another line would not help.
   * @param stop - A declared server stop whose owned breakpoint exists.
   * @returns The adapter's current receipt, `pending` until the module loads and `bound` afterwards.
   * @throws When the adapter refuses or revokes the registration, for example by acknowledging a line the stop's binding rule refuses.
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
      throw this.registrationFailure(stop, error)
    }
  }

  /**
   * Words a refused or lost registration for {@link registeredStop} and for the synchronous receipt check before input in {@link dispatchInput}, so each place the run reads the receipt names the declared stop.
   * @param stop - The declared server stop whose registration failed.
   * @param error - What the tracker threw.
   * @returns The error to throw. A refusal names the next step (a new run, then another statement of the citation) and the configuration field of the stop, followed by the mapping hints; a removed breakpoint gets neither, because another line would not help. A breakpoint the adapter moved to a line the stop's rule refuses is worded as every refused binding ({@link refusedBindingText}): the place and the rule's reason.
   * @example
   * ```ts
   * throw this.registrationFailure(stop, error) // 'Declared stop app/lib/actions.ts:36 was not registered: …. Start a new run; if the registration is refused again, declare this stop on another statement of its citation (configuration.source). Frozen source map positions …'
   * ```
   */
  private registrationFailure(stop: PreparedStop, error: unknown): Error {
    // The adapter's later news put the acknowledged breakpoint on a line the stop's rule refuses.
    if (error instanceof OwnedBreakpointMovedError)
      return this.bindingFailure(
        stop,
        this.refusedBindingText(stop, error.place),
      )
    const reason = thrownMessage(error),
      message = `Declared stop ${this.declaredAt(stop)} was not registered: ${reason}`
    // A removed breakpoint is told by its type, not by its text.
    return error instanceof OwnedBreakpointRemovedError
      ? new Error(message)
      : this.bindingFailure(
          stop,
          `${message}. Start a new run; if the registration is refused again, declare this stop on another statement of its citation (${this.declaredField(stop)})`,
        )
  }

  /** Names the configuration field that holds a declared stop's position, for the refusals that tell the agent what to change ({@link registrationFailure}, {@link slideRefusal}). @example this.declaredField(stop) // 'configuration.source' for the first stop */
  private declaredField(stop: PreparedStop): string {
    return configuredStopFields(
      this.definition.configuration.version,
      this.stops.indexOf(stop),
    ).source
  }

  /** Names a declared stop by its file and line in the failures an agent reads, so it can tell which of its stops to change; stops that share one line (a line that runs twice) are told apart by their place in the declared order. @example this.declaredAt(stop) // 'app/lib/actions.ts:36', or 'app/lib/actions.ts:36 (stop 2 of 3)' when another stop names that line */
  private declaredAt(stop: PreparedStop): string {
    const place = `${stop.source.path}:${stop.source.line}`,
      sharesLine = this.stops.some(
        (other) =>
          other !== stop &&
          other.source.path === stop.source.path &&
          other.source.line === stop.source.line,
      )
    return sharesLine
      ? `${place} (stop ${this.stops.indexOf(stop) + 1} of ${this.stops.length})`
      : place
  }

  /**
   * Tells whether a line after a declared stop's line, within its citation, can carry a position, so a stop declared on a line without one is refused before any input only when there is no later place to request it at: the debugger verifies nothing on the declared line itself, and the stop is requested at the first mapped position after it ({@link resolveArmedPlace}), from which its rule is measured.
   * Called by the declared-line check of preparation. The sealed map decides when it was scanned completely; when it is too large to scan, the sealed source text decides, so a small and an oversized map follow one rule.
   * @param stop - The declared stop whose own line has no position.
   * @param endLine - The last line of the stop's citation; a binding after it is refused by the stop's rule anyway.
   * @returns
   * - `true` when the map has a position on a later line of the citation, or, for a map too large to scan, when a later line is neither blank nor a comment: arming then decides
   * - `false` when the declared line is the citation's last, or every later line has no position (blank or comment-only for a map too large to scan)
   * @example
   * ```ts
   * this.canLaterLineBind(stop, 95) // true for a stop declared on `return (` above `<form>`
   * ```
   */
  private canLaterLineBind(stop: PreparedStop, endLine: number): boolean {
    if (
      stop.scan.positions.some((position) => position.line > stop.source.line)
    )
      return true
    if (stop.scan.complete) return false
    // The scan stopped at its size limit before it found a later position: any remaining line that could hold code may be where the stop is requested, which the debugger's break locations decide when it is armed.
    return this.hasLaterCodeLine(stop, endLine)
  }

  /**
   * Reads the sealed source text for a line after a declared stop's line that could hold code, for {@link canLaterLineBind} when the stop's map was too large to scan completely.
   * @param stop - The declared stop whose own line has no position.
   * @param endLine - The last line of the stop's citation.
   * @returns `true` when a line after the declared one, up to `endLine`, is neither blank nor a comment; `false` when the declared line is the citation's last or every later line is blank or comment-only.
   * @example
   * ```ts
   * this.hasLaterCodeLine(stop, 95) // false for a stop declared above nothing but comments
   * ```
   */
  private hasLaterCodeLine(stop: PreparedStop, endLine: number): boolean {
    for (let line = stop.source.line + 1; line <= endLine; line++)
      if (!isBlankOrCommentLine(stop.bundle.source, line)) return true
    return false
  }

  /**
   * Tells {@link bindBoundPlace} whether an earlier stop is another declaration of the same participant and file: one on another line, whose bound place must not be this stop's too.
   * @param candidate - An earlier declared stop.
   * @param stop - The declared stop whose binding was accepted by its rule.
   * @returns `true` for a stop of the same participant in the same original file that is declared on another line; `false` for one declared on the same line (a statement that runs twice).
   * @example
   * ```ts
   * this.isDeclaredElsewhereInFile(this.stops[0], this.stops[1]) // true for src/theme.ts:1 and src/theme.ts:3
   * ```
   */
  private isDeclaredElsewhereInFile(
    candidate: PreparedStop,
    stop: PreparedStop,
  ): boolean {
    return (
      candidate.participant === stop.participant &&
      candidate.bundle.sourcePath === stop.bundle.sourcePath &&
      candidate.source.line !== stop.source.line
    )
  }

  /**
   * Tells {@link bindBoundPlace} whether a stop's verified binding is the given place.
   * @param candidate - A declared stop; one that is not bound yet is at no place.
   * @param place - The verified binding to compare with.
   * @returns `true` when the stop is bound at that line and column.
   * @example
   * ```ts
   * this.isBoundAt(stop, { line: 23, column: 5 }) // false before the stop is armed
   * ```
   */
  private isBoundAt(
    candidate: PreparedStop,
    place: { line: number; column: number },
  ): boolean {
    return (
      candidate.bound?.line === place.line &&
      candidate.bound.column === place.column
    )
  }

  /** Words a binding the stop's rule refuses, naming the condition that refused it, for {@link armStop} and {@link inspect}. @example this.refusedBindingText(stop, { line: 3, column: 1 }) // 'Declared stop src/theme.ts:1 bound at 3:1, refused: line 2 between the declared line 1 and line 3 has a mapped position' */
  private refusedBindingText(
    stop: PreparedStop,
    place: { line: number; column: number },
  ): string {
    return `Declared stop ${this.declaredAt(stop)} bound at ${place.line}:${place.column}, refused: ${stop.bindingRefusal(place.line) ?? 'the binding rule refused that line'}`
  }

  /**
   * Records where the debugger bound a stop, refusing a place that an earlier stop of the same participant and file, declared on another line, already bound: one statement would then be committed twice as two different stops, or the later stop would wait for a line that already ran. Declaring one line twice stays allowed (a statement that runs twice). Called by {@link armStop} and {@link inspect} before anything is committed for the stop.
   * @param stop - The declared stop whose binding was accepted by its rule.
   * @param place - The verified binding.
   * @throws When an earlier declared stop has the same bound place; the text names both declared stops and the place.
   * @example
   * ```ts
   * this.bindBoundPlace(stop, { line: 23, column: 5 })
   * ```
   */
  private bindBoundPlace(
    stop: PreparedStop,
    place: { line: number; column: number },
  ): void {
    const earlier = this.stops
      .slice(0, this.stops.indexOf(stop))
      .find(
        (candidate) =>
          this.isDeclaredElsewhereInFile(candidate, stop) &&
          this.isBoundAt(candidate, place),
      )
    if (earlier)
      throw this.bindingFailure(
        stop,
        `Declared stops ${this.declaredAt(earlier)} and ${this.declaredAt(stop)} both bound at ${place.line}:${place.column}; one bound place is one stop, so declare it once`,
      )
    stop.bound = { line: place.line, column: place.column }
  }

  /**
   * Journals that a binding first known at a stop's pause lies past a requested line that can pause, called by {@link inspect} for a server stop whose registration was still pending while it was armed and for a browser pause adopted after the debugger moved its breakpoint.
   * The program already stands on the bound line, so the binding stays accepted under the stop's line rule and nothing is refused; the entry `breakpoint.slid-past-pausable-line` lets the stop's `place` sentence name the column that pauses on the requested line ({@link journaledBindingOfSnapshot}, {@link describeBoundPlace}).
   * @param stop - The paused stop; its binding was accepted and recorded.
   * @param bound - Where the debugger has the breakpoint at the pause.
   * @example
   * ```ts
   * await this.journalSlidePastPausableLine(stop, { line: 36, column: 5 })
   * ```
   */
  private async journalSlidePastPausableLine(
    stop: PreparedStop,
    bound: { line: number; column: number },
  ): Promise<void> {
    if (bound.line <= stop.armed.line || !stop.script) return
    // The answer only words the stop's place, so it gets the short capture bound: an adapter that does not answer delays the stop's commit by that bound and no longer.
    const pausableColumns = await this.pausableColumns(
      stop,
      stop.armed.line,
      CAPTURE_TIMEOUT_MS,
    )
    // A requested line that cannot pause, or an adapter that cannot say or does not answer in time, leaves nothing to tell.
    if (!this.hasPausableColumn(pausableColumns)) return
    this.evidence.record('breakpoint.slid-past-pausable-line', {
      participant: stop.participant,
      ...declaredAndArmedPlace(stop.source, stop.armed),
      bound: { line: bound.line, column: bound.column },
      pausableColumn: this.nearestPausableColumn(
        pausableColumns,
        stop.armed.column,
      ),
    })
  }

  /**
   * Names the break location a second request would have taken on a requested line that can pause, for the journal entry of {@link journalSlidePastPausableLine}.
   * @param pausableColumns - The break locations of the requested line, ascending and not empty.
   * @param requestedColumn - The column the stop was requested at.
   * @returns The nearest break location before the requested column, otherwise the line's first.
   * @example
   * ```ts
   * this.nearestPausableColumn([3, 20], 2) // 3
   * ```
   */
  private nearestPausableColumn(
    pausableColumns: number[],
    requestedColumn: number,
  ): number | undefined {
    return (
      pausableColumns.findLast(
        (pausableColumn) => pausableColumn < requestedColumn,
      ) ?? pausableColumns[0]
    )
  }

  /**
   * Builds the refusal of a stop the debugger bound on a later line although the line it was requested on can pause: the requested column lay after that line's last break location, so the later line is not the requested statement. {@link rearmOnRequestedLine} throws it when no break location lies before the requested column, and {@link armStop} when a second request there was bound on a later line again.
   * @param stop - The stop being armed.
   * @param binding - Where the debugger bound the breakpoint, on a later line than requested.
   * @param firstRequest - Where the stop was requested first, when it was then requested again at {@link PreparedStop.armed}; absent when no second request was made.
   * @returns The error to throw, with the mapping hints: it names the declared stop, the bound place, the line that can pause, the second request when there was one, and what to declare.
   * @example
   * ```ts
   * throw this.slideRefusal(stop, { line: 23, column: 5 })
   * ```
   */
  private slideRefusal(
    stop: PreparedStop,
    binding: { line: number; column: number },
    firstRequest?: { line: number; column: number },
  ): Error {
    const { armed, source } = stop,
      requestedColumn = (firstRequest ?? armed).column
    const pausableLine =
        armed.line === source.line
          ? `the declared line ${source.line}`
          : `line ${armed.line}, where the stop was requested`,
      secondRequest = firstRequest
        ? `, and a second request at ${armed.line}:${armed.column} was bound on line ${binding.line} again`
        : ''
    const advice = this.slideAdvice(stop)
    return this.bindingFailure(
      stop,
      `Declared stop ${this.declaredAt(stop)} bound at ${binding.line}:${binding.column}, refused: the debugger can pause on ${pausableLine}, so requested column ${requestedColumn} lies after its statement${secondRequest}; ${advice}`,
    )
  }

  /**
   * Words what to declare instead, as the last part of the refusal {@link slideRefusal} builds.
   * @param stop - The stop being armed.
   * @returns For a stop requested on its declared line, the column to declare; for a stop requested after it, the line and column to declare. Both name the configuration field.
   * @example
   * ```ts
   * this.slideAdvice(stop) // 'declare the column where the statement begins (configuration.source.column)'
   * ```
   */
  private slideAdvice(stop: PreparedStop): string {
    const { armed, source } = stop,
      field = this.declaredField(stop)
    // Codebook chose the column of a stop requested after its declared line, so the agent is told which line to declare.
    return armed.line === source.line
      ? `declare the column where the statement begins (${field}.column)`
      : `declare the stop on line ${armed.line} at the column where its statement begins (${field})`
  }

  /**
   * Asks the debugger where it can pause on one line of a stop's source, so a breakpoint the debugger moved to a later line because the line cannot pause is told from one requested after the line's last break location; {@link rearmOnRequestedLine} asks it for the line the stop was requested on.
   * The request covers only the generated range the sealed map gives for the line; a map too large to scan completely is asked for the whole module, because a partial scan may have missed mappings of the line. Every answered location is mapped back, since the range can hold places of other lines.
   * @param stop - The stop; its module is parsed (`stop.script` is set).
   * @param line - One-based line of the stop's source.
   * @param timeoutMs - How long the adapter's answer is waited for; left out while a stop is armed (the active bound), and the capture bound for {@link journalSlidePastPausableLine}, whose answer changes no decision.
   * @returns
   * - The one-based source columns of the line's break locations, ascending; empty when the debugger cannot pause on the line
   * - `undefined` when the adapter cannot list break locations, or did not answer within the bound
   * @example
   * ```ts
   * await this.pausableColumns(stop, 22) // [3] for a line whose statement begins at column 3
   * ```
   */
  private async pausableColumns(
    stop: PreparedStop,
    line: number,
    timeoutMs?: number,
  ): Promise<number[] | undefined> {
    const { range, complete } = stop.verifier.generatedRangeOfLine(line)
    // A completely scanned map without a position on the line leaves the debugger no place to pause there.
    if (complete && !range) return []
    const places = await this.mappedBreakLocations(
      stop,
      complete ? range : undefined,
      timeoutMs,
    )
    return places
      ?.filter((place) => place.line === line)
      .map((place) => place.column)
      .sort((left, right) => left - right)
  }

  /**
   * Asks the debugger for the break locations of a stop's module and maps each back to the sealed original, for {@link pausableColumns} (one line's generated range) and {@link confirmRequestedPlace} (the whole module, when its map was too large to scan).
   * @param stop - The stop; its module is parsed (`stop.script` is set).
   * @param range - The generated range to ask for, with an exclusive `end`; without it the whole module is asked.
   * @param timeoutMs - How long the adapter's answer is waited for; the request's own default (the active bound) when left out.
   * @returns
   * - The one-based source place of every answered location the sealed map puts in the stop's original; a location in unmapped code or in another original is left out
   * - `undefined` when the adapter cannot list break locations, or did not answer within the bound
   * @example
   * ```ts
   * await this.mappedBreakLocations(stop) // [{ line: 22, column: 3 }, { line: 23, column: 5 }]
   * ```
   */
  private async mappedBreakLocations(
    stop: PreparedStop,
    range?: NonNullable<
      ReturnType<PreparedStop['verifier']['generatedRangeOfLine']>['range']
    >,
    timeoutMs?: number,
  ): Promise<{ line: number; column: number }[] | undefined> {
    const scriptId = stop.script!.scriptId
    let locations: Protocol.Debugger.BreakLocation[]
    try {
      ;({ locations } = await this.participants[stop.participant].cdp!.request(
        'Debugger.getPossibleBreakpoints',
        range
          ? {
              start: { scriptId, ...range.start },
              end: { scriptId, ...range.end },
            }
          : { start: { scriptId, lineNumber: 0, columnNumber: 0 } },
        timeoutMs,
      ))
    } catch {
      this.alive()
      return undefined
    }
    this.alive()
    return locations.flatMap((location) => {
      const line = stop.verifier.originalLine(location),
        column = stop.verifier.originalColumn(location)
      return line === undefined || column === undefined
        ? []
        : [{ line, column }]
    })
  }

  /**
   * Chooses the place of a stop whose sealed map was too large to scan completely and whose scan found no position on the declared line, when {@link armStop} first arms it: a partial scan cannot say whether that line, or which later line, holds code, so the debugger's break locations decide.
   * The stop is requested at the first place the debugger can pause at from the declared line to the end of its citation: the declared line itself when it can pause there ("not found in a partial scan" is not "absent"), otherwise the first later line that can, and the stop's line rule is then measured from that line. A line that only looks like code in the text (the body of a block comment, a `>` that closes an opening tag) has no break location and is never requested.
   * The declared place is kept when the debugger cannot be asked: the module is not parsed yet (a server stop before the input), the adapter cannot list break locations, or none lies in the citation.
   * @param stop - The stop being armed for the first time.
   * @example
   * ```ts
   * await this.confirmRequestedPlace(stop) // stop.armed: { line: 39, column: 9 } for a blank declared line 38
   * ```
   */
  private async confirmRequestedPlace(stop: PreparedStop): Promise<void> {
    const declaredLine = stop.source.line
    if (this.keepsPlaceUnasked(stop)) return
    const citation = this.definition.descriptor.anchors[stop.anchorIndex]!,
      first = (await this.mappedBreakLocations(stop))
        ?.filter(
          (place) =>
            place.line >= declaredLine && place.line <= citation.endLine,
        )
        .sort(
          (left, right) => left.line - right.line || left.column - right.column,
        )[0]
    if (!first || first.line === declaredLine) return
    stop.armed = first
    // The rule was built for a request on the declared line; it is measured from the line the stop is requested on.
    const rule = createBindingLineRule(
      declaredLine,
      citation,
      stop.scan,
      first.line,
    )
    stop.acceptsBoundLine = rule.accepts
    stop.bindingRefusal = rule.refusal
  }

  /**
   * Says whether a stop keeps the place its scan chose without the debugger being asked, as the first check of {@link confirmRequestedPlace}.
   * @param stop - The stop being armed for the first time.
   * @returns `true` for a complete scan and for a partial one that found the declared line (they already chose the place), and for a module that is not parsed yet (the debugger cannot be asked); `false` when the break locations must decide.
   * @example
   * ```ts
   * this.keepsPlaceUnasked(stop) // true for a stop whose map was scanned completely
   * ```
   */
  private keepsPlaceUnasked(stop: PreparedStop): boolean {
    // A complete scan, and a partial one that found the declared line, already chose the place.
    return (
      stop.scan.complete ||
      stop.scan.positions.some(
        (position) => position.line === stop.source.line,
      ) ||
      !stop.script
    )
  }

  /**
   * Reads where the debugger put a stop's breakpoint when that is another line than declared, for a deadline text that must point the agent at the line that has to run; {@link unreachedFirstStopReason} and {@link unreachedNextStopReason} call it when their deadline expires.
   * A browser stop knows its binding from arming. A server stop knows it only at its pause, so before that the owned breakpoint's current acknowledgement is asked.
   * @param stop - The declared stop that was not reached.
   * @returns The bound line and column, or `undefined` when the stop is bound on the line it was declared on or its place is not known.
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
   * The deadline starts when the action is accepted, before the input is sent; before the input was sent no stop or place explains anything. Afterwards the text names the declared stop: paused there without the debugger announcing it, or not hit, with the place a moved breakpoint is bound at (that line can lie in a branch the action skips) or, for a server stop, its registration and that the action's request may still be running.
   * @returns The bare text before the input, otherwise the text that names the declared stop and what is known about it.
   * @example
   * ```ts
   * this.unreachedFirstStopReason() // 'Repository input reached no verified pause'
   * ```
   */
  private unreachedFirstStopReason(): string {
    const stop = this.stops[0]!,
      opening = 'Repository input reached no verified pause'
    if (!this.operation?.inputDispatched) return opening
    const paused = this.unannouncedStopPlace(stop)
    if (paused)
      return `${opening}: declared stop ${this.declaredAt(stop)} is paused at ${paused}, but the debugger did not announce that stop within ${ACTIVE_TIMEOUT_MS / MILLISECONDS_PER_SECOND} s of the accepted action`
    return this.notHitFirstStopReason(stop, opening)
  }

  /**
   * Words the failure of an action whose first declared stop was not hit after the input was sent; the second half of {@link unreachedFirstStopReason}, reached when no pause of that stop is held.
   * @param stop - The first declared stop.
   * @param opening - The text every form of the failure begins with.
   * @returns The text that names the stop and, in this order, the place a moved breakpoint is bound at, a server stop's registration ({@link notHitServerFirstStopReason}), or that its line must execute.
   * @example
   * ```ts
   * this.notHitFirstStopReason(stop, 'Repository input reached no verified pause') // '…: declared stop app/ui/login-form.tsx:74 was not hit within 20 s of the accepted action; its line must execute after the input'
   * ```
   */
  private notHitFirstStopReason(stop: PreparedStop, opening: string): string {
    const moved = this.movedPlace(stop),
      notHit = `was not hit within ${ACTIVE_TIMEOUT_MS / MILLISECONDS_PER_SECOND} s of the accepted action`
    if (moved)
      return `${opening}: declared stop ${this.declaredAt(stop)} ${this.boundAt(moved)} ${notHit}; the bound line, not the declared one, must execute after the input`
    if (stop.participant === 'server')
      return this.notHitServerFirstStopReason(stop, opening, notHit)
    return `${opening}: declared stop ${this.declaredAt(stop)} ${notHit}; its line must execute after the input`
  }

  /**
   * Words the failure of an action whose first declared stop is a server stop that was not hit and whose breakpoint did not move; called by {@link notHitFirstStopReason}.
   * @param stop - The first declared stop, a server stop.
   * @param opening - The text every form of the failure begins with.
   * @param notHit - The part that says the stop was not hit within the bound.
   * @returns For a registration the adapter does not hold acknowledged, what {@link unacknowledgedText} says; otherwise the registration's status and that the action's request may still be running. Both name the place the stop was requested at when that is not the declared one.
   * @example
   * ```ts
   * this.notHitServerFirstStopReason(stop, opening, notHit) // '…: declared server stop app/lib/actions.ts:12 (registration pending) was not hit within 20 s of the accepted action; the server action's request may still be running …'
   * ```
   */
  private notHitServerFirstStopReason(
    stop: PreparedStop,
    opening: string,
    notHit: string,
  ): string {
    const requested = this.requestedElsewhere(stop),
      registration = this.registrationStatus(stop)
    // Refused, revoked or without a current receipt: the adapter holds no acknowledged breakpoint for the stop, so its line is not the reason.
    if (this.isUnacknowledged(registration.status))
      return `${opening}: declared server stop ${this.declaredAt(stop)}${requested ? ` (${requested})` : ''} ${notHit}; ${this.unacknowledgedText(stop, registration)}`
    return `${opening}: declared server stop ${this.declaredAt(stop)} (${requested ? `${requested}, ` : ''}registration ${registration.status}) ${notHit}; the server action's request may still be running (a first compilation after a cold start can take longer), or its line does not execute for this input. Start a new run; if the stop is not hit again, declare a line this action executes.`
  }

  /**
   * Says whether a registration read means that the adapter holds no acknowledged breakpoint for a server stop, for the two deadline texts ({@link notHitServerFirstStopReason}, {@link unboundServerNextStopReason}) before they append {@link unacknowledgedText}.
   * @param status - The status {@link registrationStatus} read.
   * @returns `true` for `refused` (refused, revoked or moved to a refused place) and for `unknown` (no current receipt); `false` for `pending` and `bound`.
   * @example
   * ```ts
   * this.isUnacknowledged('pending') // false
   * ```
   */
  private isUnacknowledged(status: RegistrationStatus['status']): boolean {
    return status === 'refused' || status === 'unknown'
  }

  /** Names the place a stop's breakpoint was requested at when that is not the declared position (the first mapped position after an unmapped declared line, or a second request on its line), for the deadline texts of a server stop, whose breakpoint waits there. @example this.requestedElsewhere(stop) // 'requested at 39:9', or undefined for a stop requested where it was declared */
  private requestedElsewhere(stop: PreparedStop): string | undefined {
    const { armed, source } = stop
    return armed.line === source.line && armed.column === source.column
      ? undefined
      : `requested at ${armed.line}:${armed.column}`
  }

  /** Names where the expected stop's own pause is held when the debugger never announced it, for the two deadline texts; such a pause was admitted at the stop's place, so saying the stop was not hit would be wrong. @example this.unannouncedStopPlace(stop) // 'auth.ts:42' */
  private unannouncedStopPlace(stop: PreparedStop): string | undefined {
    const held = this.participants[stop.participant].stopped
    return held && held.generation === undefined
      ? this.placeOf(stop.participant, held.event)
      : undefined
  }

  /**
   * Reads a server stop's registration for the two deadline texts without throwing, so neither claims more than the adapter said; {@link unreachedFirstStopReason} and {@link unreachedNextStopReason} call it when their deadline expires.
   * @param stop - The declared server stop that was not reached.
   * @returns
   * - `pending` until the stop's module loads, `bound` once the adapter verified it
   * - `refused` with the reason the registration read threw, when the adapter refused or revoked it or the breakpoint is gone; and with `movedTo` when the adapter moved it to a place the stop's rule refuses
   * - `unknown` when no current receipt can be read: a newer registration request is unanswered, or no session is selected
   * @example
   * ```ts
   * this.registrationStatus(stop) // { status: 'refused', reason: 'Owned breakpoint was removed before registration' }
   * ```
   */
  private registrationStatus(stop: PreparedStop): RegistrationStatus {
    const session = this.participants[stop.participant].selected
    if (!session || !stop.breakpoint) return { status: 'unknown' }
    try {
      return this.receiptStatus(stop.breakpoint.registration(session))
    } catch (error) {
      return this.refusedStatus(error)
    }
  }

  /**
   * Turns the receipt a registration read returned into what {@link registrationStatus} reports.
   * @param receipt - The adapter's current receipt; `undefined` while a newer registration request is unanswered.
   * @returns The receipt's `pending` or `bound`, or `unknown` without a receipt.
   * @example
   * ```ts
   * this.receiptStatus(undefined) // { status: 'unknown' }
   * ```
   */
  private receiptStatus(
    receipt: { status: 'pending' | 'bound' } | undefined,
  ): RegistrationStatus {
    return receipt ? { status: receipt.status } : { status: 'unknown' }
  }

  /**
   * Turns what a registration read threw into the refusal {@link registrationStatus} reports.
   * @param error - What the read threw: the adapter refused or revoked the registration, the breakpoint is gone, or the adapter moved it to a place the stop's rule refuses.
   * @returns `refused` with the thrown reason, and with `movedTo` for an {@link OwnedBreakpointMovedError}.
   * @example
   * ```ts
   * this.refusedStatus(new Error('Owned breakpoint was removed before registration')) // { status: 'refused', reason: 'Owned breakpoint was removed before registration' }
   * ```
   */
  private refusedStatus(error: unknown): RegistrationStatus {
    return {
      status: 'refused',
      reason: thrownMessage(error),
      ...(error instanceof OwnedBreakpointMovedError
        ? { movedTo: error.place }
        : {}),
    }
  }

  /**
   * Words what both deadline texts say for a server stop whose breakpoint the adapter does not hold acknowledged where the stop can use it; {@link unreachedFirstStopReason} and {@link unreachedNextStopReason} append it.
   * @param stop - The declared server stop that was not reached.
   * @param registration - What {@link registrationStatus} read: refused, or without a current receipt.
   * @returns
   * - For a breakpoint the adapter moved to a line the stop's rule refuses: the place, the rule's reason, and that the bound place is what to declare, because a new run would bind it there again
   * - Otherwise what was read, and that only a new run helps, because no other declaration would
   * @example
   * ```ts
   * this.unacknowledgedText(stop, { status: 'unknown' }) // 'the debugger no longer acknowledged its breakpoint (no current registration receipt could be read), so the stop could not pause. Stop this run and start a new one.'
   * ```
   */
  private unacknowledgedText(
    stop: PreparedStop,
    registration: RegistrationStatus,
  ): string {
    // The adapter moved the acknowledged breakpoint to a refused line: the declaration, not the run, is what to change.
    if (registration.status === 'refused' && registration.movedTo)
      return this.movedToRefusedLineText(stop, registration.movedTo)
    const read =
      registration.status === 'refused'
        ? registration.reason
        : 'no current registration receipt could be read'
    return `the debugger no longer acknowledged its breakpoint (${read}), so the stop could not pause. Stop this run and start a new one.`
  }

  /**
   * Words the first form of {@link unacknowledgedText}: the adapter moved a server stop's acknowledged breakpoint to a line the stop's rule refuses.
   * @param stop - The declared server stop that was not reached.
   * @param movedTo - The place the adapter moved the breakpoint to.
   * @returns The place, the rule's reason for refusing its line, and that the bound place is what to declare.
   * @example
   * ```ts
   * this.movedToRefusedLineText(stop, { line: 40, column: 3 }) // 'the debugger moved its breakpoint to 40:3, refused: …, so the stop could not be captured there. Declare the bound place instead (configuration.source), in a citation that covers it.'
   * ```
   */
  private movedToRefusedLineText(
    stop: PreparedStop,
    movedTo: { line: number; column: number },
  ): string {
    const { line, column } = movedTo
    return `the debugger moved its breakpoint to ${line}:${column}, refused: ${stop.bindingRefusal(line) ?? 'the binding rule refused that line'}, so the stop could not be captured there. Declare the bound place instead (${this.declaredField(stop)}), in a citation that covers it.`
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
      within = `was not hit within ${ACTIVE_TIMEOUT_MS / MILLISECONDS_PER_SECOND} s`,
      paused = this.unannouncedStopPlace(stop)
    // The stop's own pause arrived and was admitted, so the line ran; only the debugger's announcement is missing.
    if (paused)
      return `${opening} is paused at ${paused}, but the debugger did not announce that stop within ${ACTIVE_TIMEOUT_MS / MILLISECONDS_PER_SECOND} s of the preceding continuation`
    if (moved)
      return `${opening} ${this.boundAt(moved)} ${within}; the bound line, not the declared one, must execute after the preceding continuation`
    return (
      this.unboundServerNextStopReason(stop, opening, within) ??
      `${opening} ${within}; its line must execute after the preceding continuation`
    )
  }

  /**
   * Words the failure of a continuation whose next declared stop is a server stop that is not bound yet and whose registration explains more than the order rule; called by {@link unreachedNextStopReason} when no pause is held and the breakpoint did not move.
   * @param stop - The declared stop that was armed inside the continuation.
   * @param opening - The text that names the stop.
   * @param within - The part that says the stop was not hit within the bound.
   * @returns
   * - For a pending registration: that its breakpoint was still pending
   * - For a registration the adapter does not hold acknowledged: what {@link unacknowledgedText} says
   * - `undefined` for a browser stop, a bound server stop and a bound registration: the order rule is what to say
   * @example
   * ```ts
   * this.unboundServerNextStopReason(stop, opening, within) // undefined for a browser stop
   * ```
   */
  private unboundServerNextStopReason(
    stop: PreparedStop,
    opening: string,
    within: string,
  ): string | undefined {
    const registration = this.unboundServerRegistration(stop),
      serverOpening = this.withRequestedPlace(stop, opening)
    if (!registration) return undefined
    if (registration.status === 'pending')
      return `${serverOpening} ${within}; its breakpoint was still pending (the debugger had not verified it in a loaded module), so the line may not be bound or may not have run after the preceding continuation. Start a new run; if the stop is not hit again, declare a line this action executes after the preceding stop.`
    // Refused, revoked or without a current receipt: the adapter holds no acknowledged breakpoint for the stop.
    if (this.isUnacknowledged(registration.status))
      return `${serverOpening} ${within}; ${this.unacknowledgedText(stop, registration)}`
    return undefined
  }

  /**
   * Reads the registration of a server stop that is not bound yet, for {@link unboundServerNextStopReason}.
   * @param stop - The declared stop that was not reached.
   * @returns What {@link registrationStatus} reads, or `undefined` for a browser stop and for a server stop that was bound at an earlier pause.
   * @example
   * ```ts
   * this.unboundServerRegistration(stop) // { status: 'pending' }
   * ```
   */
  private unboundServerRegistration(
    stop: PreparedStop,
  ): RegistrationStatus | undefined {
    // A server stop is bound only at its pause; until then the order rule would claim more than its registration says.
    return stop.participant === 'server' && !stop.bound
      ? this.registrationStatus(stop)
      : undefined
  }

  /**
   * Adds the place a stop's breakpoint was requested at to a deadline text's opening, for {@link unboundServerNextStopReason}.
   * @param stop - The declared stop that was not reached.
   * @param opening - The text that names the stop.
   * @returns The opening followed by `(requested at L:C)` for a stop requested at another place than declared, otherwise the opening as it is.
   * @example
   * ```ts
   * this.withRequestedPlace(stop, opening) // '… declared stop app/lib/actions.ts:38 (requested at 39:9)'
   * ```
   */
  private withRequestedPlace(stop: PreparedStop, opening: string): string {
    const requested = this.requestedElsewhere(stop)
    // A server stop that was requested at another place than declared says so, because that place is where its breakpoint waits.
    return requested ? `${opening} (${requested})` : opening
  }

  /**
   * Builds the failure for a declared stop that cannot bind, called by the preparation line check, {@link armStop}, {@link registeredStop} and {@link inspect}.
   * It appends the frozen map's positions in that stop's citation so the agent can choose another line; they are hints, never bindings.
   * @param stop - The declared stop the failure is about.
   * @param message - What happened, without a trailing period; it already names the stop.
   * @returns The error to throw; without hints when the sealed map cannot be scanned.
   * @example
   * ```ts
   * throw this.bindingFailure(stop, this.refusedBindingText(stop, { line: 24, column: 5 }))
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

  /**
   * Tells {@link bindParsedScript} whether a script the runtime announced is the sealed module of a declared stop.
   * @param stop - A declared stop.
   * @param name - The participant whose runtime announced the script.
   * @param event - The announced script; its URL is read only for a stop of that participant, and is empty for a script without one.
   * @returns `true` for a stop of that participant whose sealed module has the script's URL.
   * @example
   * ```ts
   * this.isModuleOfStop(stop, 'server', event) // false for a script without a URL: it is no stop's module
   * ```
   */
  private isModuleOfStop(
    stop: PreparedStop,
    name: Participant,
    event: Protocol.Debugger.ScriptParsedEvent,
  ): boolean {
    if (stop.participant !== name || !event.url) return false
    return sameScriptUrl(stop.bundle.scriptUrl, event.url)
  }

  /**
   * Gives every declared stop of a participant the script its sealed module was parsed as, for the `Debugger.scriptParsed` handler of {@link observeParticipant}.
   * A module that is parsed again under another script id after it was sealed fails the run, and no later stop is given the script.
   * @param name - The participant whose runtime announced the script.
   * @param event - The announced script.
   * @example
   * ```ts
   * this.bindParsedScript('server', event)
   * ```
   */
  private bindParsedScript(
    name: Participant,
    event: Protocol.Debugger.ScriptParsedEvent,
  ): void {
    for (const stop of this.stops) {
      if (!this.isModuleOfStop(stop, name, event)) continue
      if (this.isSealedAsAnotherScript(stop, event)) {
        this.fail('Selected module changed after sealing')
        return
      }
      stop.script = event
    }
  }

  /** Tells {@link bindParsedScript} whether a stop's module was already announced under another script id than the one announced now. @example this.isSealedAsAnotherScript(stop, event) // false for the module's first announcement */
  private isSealedAsAnotherScript(
    stop: PreparedStop,
    event: Protocol.Debugger.ScriptParsedEvent,
  ): boolean {
    return stop.script !== undefined && stop.script.scriptId !== event.scriptId
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
      this.bindParsedScript(name, event)
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

  /** Journals the pauses the runtime reports (a declared stop's always; the runtime's instrumentation pauses and every other pause each up to {@link REPOSITORY_ADAPTER_PAUSE_JOURNAL_LIMIT}, the rest counted) and, during an action, hands a pause to {@link admitPause}; only a browser pause in a run that declares no browser stop keeps its own short bound. @example this.onCdpPaused('server', event) */
  private onCdpPaused(
    name: Participant,
    event: Protocol.Debugger.PausedEvent,
  ): void {
    if (this.cleaning) return
    const participant = this.participants[name]
    participant.pauseObservedAtMs = this.evidence.elapsedMs()
    const isInstrumentation = event.reason === 'instrumentation'
    // A hook that pauses in a loop must not use up the journal: a declared stop's pause is always journaled, any other only up to a cap. The runtime's instrumentation pauses are counted before that cap, under one of their own, so they cannot use up the room of the pauses the debugger makes for itself.
    const journaled = isInstrumentation
      ? this.instrumentationPauseCount++ <
        REPOSITORY_ADAPTER_PAUSE_JOURNAL_LIMIT
      : this.isPauseOfStop(event, this.expectedStop(name)) ||
        this.offStopPauseCount++ < REPOSITORY_ADAPTER_PAUSE_JOURNAL_LIMIT
    participant.pauseJournaled = journaled
    if (journaled)
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
    else this.unjournaledAdapterEvents++
    // The runtime's own instrumentation pause is nobody's stop, but it is open until its resume and completion waits for that.
    if (isInstrumentation) {
      participant.instrumentationPaused = true
      return
    }
    if (!this.operation) return
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
        event,
        journaled,
      }
      this.transientBrowserPause = transient
      if (journaled)
        this.evidence.record('cdp.browser-pause-awaiting-adapter', {
          scriptId: event.callFrames[0]?.location.scriptId,
        })
      return
    }
    this.admitPause(name, event, journaled)
  }

  /** Tells whether a pause is at a declared stop's bound place: on its line by {@link isPauseAtStop}, asked with {@link pauseTarget} so a server stop the adapter already verified is compared with that line, and, once the run knows the binding, at its column by {@link isPauseAtBoundColumn}. @example this.isPauseOfStop(event, this.expectedStop('server')) // false for the adapter's entry breakpoint */
  private isPauseOfStop(
    event: Protocol.Debugger.PausedEvent,
    stop: PreparedStop | undefined,
  ): stop is PreparedStop {
    return (
      stop !== undefined &&
      isPauseAtStop(event, this.pauseTarget(stop)) &&
      isPauseAtBoundColumn(event, stop)
    )
  }

  /**
   * Decides what a pause during an action is, called by {@link onCdpPaused} (and through it by {@link beginAfter} when a queued pause is replayed).
   * The debug adapter also pauses for breakpoints of its own and resumes them without announcing a stop, and its two channels have no common order, so the place of a pause decides, never which event was read first:
   *
   * ```
   * participant already holds a pause ──► fail "Additional <name> stop ..."
   * at the expected stop (its module, its bound line)
   *     continuation in flight ──► pendingCdpStop, replayed by beginAfter
   *     otherwise              ──► participant.stopped, bound by inspect
   * anywhere else              ──► participant.unannouncedPause, with the stop expected then
   *                                  resumed   → retireUnannouncedPause
   *                                  announced → onEvent fails, or inspect judges it when it was held for that stop
   *                                  stays     → the progress deadline names it
   * ```
   * @param name - The participant whose runtime paused.
   * @param event - The pause as the runtime reported it.
   * @param journaled - Whether the pause's observation was journaled; a held pause past the journal's cap is only counted when it is retired.
   * @example
   * ```ts
   * this.admitPause('server', event) // a pause in getUser while auth.ts:23 is expected is held, not failed
   * ```
   */
  private admitPause(
    name: Participant,
    event: Protocol.Debugger.PausedEvent,
    journaled = true,
  ): void {
    // A participant pauses once at a time; a second pause before the first one's resume is nobody's declared stop.
    if (this.holdsPause(name)) {
      this.fail(`Additional ${name} stop invalidated the declared operation`)
      return
    }
    const expectedStop = this.expectedStop(name)
    // On the stop's line but at another column than the debugger bound it at is another statement of that line, not the stop.
    if (!this.isPauseOfStop(event, expectedStop)) {
      // The stop expected now is kept, so a pause that came before a stop's turn never becomes that stop's pause later.
      this.participants[name].unannouncedPause = {
        event,
        expectedStop,
        heldAtMs: performance.now(),
        journaled,
      }
      return
    }
    // The expected stop's pause becomes current only after the preceding continuation has all its receipts.
    if (this.continuation) this.pendingCdpStop = { participant: name, event }
    else this.participants[name].stopped = { event }
  }

  /** Gives {@link isPauseOfStop} what a pause's line is compared with: the stop, and as its bound line the run's binding or, before the run read it, the place where the stop's owned breakpoint is verified, so an adapter pause on another acceptable line is not taken for it. @example this.pauseTarget(stop).bound // { line: 33, column: 5 } for a server stop verified on its declared line */
  private pauseTarget(stop: PreparedStop): PauseStopTarget {
    const session = this.participants[stop.participant].selected
    return {
      ...stop,
      bound:
        stop.bound ??
        (session ? stop.breakpoint?.verifiedPlace(session) : undefined),
    }
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

  /** Names the declared stop whose pause may arrive next, for {@link expectedStop}: the one after a continuation in flight, otherwise the current one from the moment the input is sent until its snapshot is ready. Before the input and after the last continuation there is none. @example this.nextStopToPause() // stops[1] while stop 0 is being continued */
  private nextStopToPause(): PreparedStop | undefined {
    if (this.continuation) return this.stops[this.stopIndex + 1]
    // The first stop's turn begins when the input is sent, not when the action is accepted: its line can run while the input is still being checked.
    if (this.isBeforeFirstInput()) return undefined
    return this.snapshotReady ? undefined : this.stops[this.stopIndex]
  }

  /** Tells {@link nextStopToPause} whether the first stop's turn has not begun: no stop was committed yet and the input was not sent. @example this.isBeforeFirstInput() // true while the action is accepted and its input is still being checked */
  private isBeforeFirstInput(): boolean {
    return this.stopIndex === 0 && !this.operation?.inputDispatched
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
   * The adapter made the pause for itself (a module entry breakpoint, its WebAssembly hook) and resumed it. No stop, receipt or generation of the run changes; the journal keeps where the pause was and how long it lasted (past its cap of such pauses, only their count). Nothing on either channel says who sent a resume, so a pause on the expected stop's line is never retired here, and a pause that outlasted the adapter's bound ({@link adapterPauseLimitMs}) ends the run as a manual or competing resume.
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
    const limitMs = this.adapterPauseLimitMs(name)
    participant.unannouncedPause = undefined
    // Nothing says who sent a resume, but the adapter resumes its own pauses within milliseconds: a pause that lasted longer was resumed by someone else.
    if (performance.now() - held.heldAtMs > limitMs) {
      const place = this.placeOf(name, held.event)
      this.evidence.record('cdp.unannounced-pause-resumed-late', {
        participant: name,
        place,
        pausedForMs,
        limitMs,
      })
      this.fail(
        `Manual or competing resume invalidated live pause: the ${name} pause at ${place} that no debugger stop announced was resumed after more than ${limitMs} ms, longer than the debugger holds a pause of its own`,
      )
      return true
    }
    if (held.journaled)
      this.evidence.record('cdp.adapter-pause-retired', {
        participant: name,
        ...describeCdpPause(held.event, participant.scriptUrls),
        place: this.placeOf(name, held.event),
        pausedForMs,
      })
    else this.unjournaledAdapterEvents++
    return true
  }

  /**
   * Gives {@link retireUnannouncedPause} the longest a pause may have lasted for its resume to be the debug adapter's own.
   * While the participant's stop is accepted and its own pause is still awaited ({@link awaitsOwnPause}), the held pause may be the announced one (bound elsewhere), which the adapter never resumes by itself, so the bound is the short one. Once that stop is captured, also after its continuation and through the after phase of the last stop, a held pause is the adapter's own again.
   * @param name - The participant whose runtime resumed.
   * @returns The bound in milliseconds.
   * @example
   * ```ts
   * this.adapterPauseLimitMs('server') // 3000 while no server stop is accepted, and again once the accepted one is captured
   * ```
   */
  private adapterPauseLimitMs(name: Participant): number {
    return this.awaitsOwnPause(name)
      ? REPOSITORY_ANNOUNCED_PAUSE_RESUME_LIMIT_MS
      : REPOSITORY_ADAPTER_PAUSE_LIMIT_MS
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

  /** Tells {@link observeAfter} that no pause the adapter made for itself, and no instrumentation pause of the runtime, is still open on either participant, so completion is never certified while one of them is paused. @example this.adapterPausesRetired() // true */
  private adapterPausesRetired(): boolean {
    return (
      !this.transientBrowserPause &&
      this.holdsNoUnannouncedPause() &&
      this.holdsNoInstrumentationPause()
    )
  }

  /** Tells {@link adapterPausesRetired} that neither participant is paused with no announced stop. @example this.holdsNoUnannouncedPause() // false while the adapter's own pause on the server is open */
  private holdsNoUnannouncedPause(): boolean {
    return (
      !this.participants.server.unannouncedPause &&
      !this.participants.browser.unannouncedPause
    )
  }

  /** Tells {@link adapterPausesRetired} that neither participant's runtime is paused for its own instrumentation. @example this.holdsNoInstrumentationPause() // false while the server reads a source map */
  private holdsNoInstrumentationPause(): boolean {
    return (
      !this.participants.server.instrumentationPaused &&
      !this.participants.browser.instrumentationPaused
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
        const matches: ServerMatch[] = []
        try {
          for (const session of this.sessions.values()) {
            if (!this.isActiveServerSession(session)) continue
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
              this.recordVerifiedServerCandidate(session, identity)
              matches.push({ session, cdp: candidate, identity })
            } catch (error) {
              this.rethrowWhenEnding(error)
            } finally {
              this.closeUnmatchedProxy(candidate, matches)
            }
          }
          return this.selectVerifiedServer(matches)
        } finally {
          this.closeUnselectedProxies('server', matches)
        }
      },
      'unique owned server',
      ACTIVE_TIMEOUT_MS,
      this.abort.signal,
    )
    await this.observeParticipant('server')
  }

  /**
   * Tells the discovery of {@link selectServer} whether a debug session is one of this run's live server sessions, read anew for each session after the proxy of the one before it was verified.
   * @param session - A debug session the run knows.
   * @returns `true` for a session that has not terminated and is the run's server root or one of its descendants.
   * @example
   * ```ts
   * this.isActiveServerSession(session) // false for the browser's sessions
   * ```
   */
  private isActiveServerSession(session: vscode.DebugSession): boolean {
    return this.activeSessions.has(session.id) && this.serverSession(session)
  }

  /**
   * Journals that a server session's native proxy leads to the launched worker, for {@link selectServer} once the inspector's identity was verified.
   * @param session - The session whose proxy was verified.
   * @param identity - The verified identity of the inspected process.
   * @example
   * ```ts
   * this.recordVerifiedServerCandidate(session, identity)
   * ```
   */
  private recordVerifiedServerCandidate(
    session: vscode.DebugSession,
    identity: ServerMatch['identity'],
  ): void {
    this.evidence.record('server.candidate-verified', {
      sessionId: session.id,
      parentId: session.parentSession?.id,
      identity,
    })
  }

  /**
   * Passes on the failure of one candidate proxy only while the run ends, for the discoveries of {@link selectServer} and {@link selectPage}: a session that is not the wanted target fails its checks and is skipped, but an aborted or cleaning run must not go on to the next one.
   * @param error - What the candidate's proxy or its identity check threw.
   * @throws That error, when the run was aborted or is cleaning up.
   * @example
   * ```ts
   * this.rethrowWhenEnding(error) // returns for a session that offers no proxy
   * ```
   */
  private rethrowWhenEnding(error: unknown): void {
    if (this.abort.signal.aborted || this.cleaning) throw error
  }

  /**
   * Closes a candidate proxy that was connected and not taken as a match, for the discoveries of {@link selectServer} and {@link selectPage} when one session's check has ended.
   * @param candidate - The proxy connected for the session; `undefined` when none was.
   * @param matches - The matches found so far, whose proxies stay open until one is selected.
   * @example
   * ```ts
   * this.closeUnmatchedProxy(candidate, matches)
   * ```
   */
  private closeUnmatchedProxy(
    candidate: Cdp | undefined,
    matches: { cdp: Cdp }[],
  ): void {
    if (candidate && !matches.some((match) => match.cdp === candidate))
      candidate.close()
  }

  /**
   * Closes every provisional proxy of one discovery pass except the one the participant selected, for {@link selectServer} and {@link selectPage} when the pass ends, also by a failure.
   * @param name - The participant the discovery selects for.
   * @param matches - The matches of this pass.
   * @example
   * ```ts
   * this.closeUnselectedProxies('browser', matches)
   * ```
   */
  private closeUnselectedProxies(
    name: Participant,
    matches: { cdp: Cdp }[],
  ): void {
    for (const match of matches)
      if (match.cdp !== this.participants[name].cdp) match.cdp.close()
  }

  /**
   * Selects the one launched worker among the verified server sessions, as the last step of a discovery pass of {@link selectServer}.
   * @param matches - The server sessions whose proxies were verified in this pass.
   * @returns `false` when no session was verified yet, so the wait goes on; `true` once the server participant has its session and proxy.
   * @throws `Ambiguous owned server` when no session is the deepest of all, or the sessions inspect different processes.
   * @example
   * ```ts
   * this.selectVerifiedServer([]) // false
   * ```
   */
  private selectVerifiedServer(matches: ServerMatch[]): boolean {
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
          candidate.identity.processGroup !== selected.identity.processGroup ||
          candidate.identity.workspace !== selected.identity.workspace,
      )
    )
      throw new Error('Ambiguous owned server')
    this.alive()
    this.participants.server.selected = selected.session
    this.participants.server.cdp = selected.cdp
    return true
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
            if (!this.isActivePageSession(session)) continue
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
              this.keepBlankPage(
                matches,
                session,
                candidate,
                result.result.value,
              )
            } catch (error) {
              this.rethrowWhenEnding(error)
            } finally {
              this.closeUnmatchedProxy(candidate, matches)
            }
          }
          return this.selectBlankPage(matches)
        } finally {
          this.closeUnselectedProxies('browser', matches)
        }
      },
      'unique owned page',
      ACTIVE_TIMEOUT_MS,
      this.abort.signal,
    )
  }

  /**
   * Tells the discovery of {@link selectPage} whether a debug session may be the run's page, read anew for each session after the proxy of the one before it was checked.
   * @param session - A debug session the run knows.
   * @returns `true` for a child session that has not terminated and is not one of the run's server sessions.
   * @example
   * ```ts
   * this.isActivePageSession(session) // false for the browser's root session
   * ```
   */
  private isActivePageSession(session: vscode.DebugSession): boolean {
    if (!session.parentSession || !this.activeSessions.has(session.id))
      return false
    return !this.serverSession(session)
  }

  /**
   * Takes a checked session as a match when its page is still the blank one the run opened, for the discovery of {@link selectPage} once the page answered where it is.
   * @param matches - The matches of this pass, which gain the session.
   * @param session - The session whose page was asked.
   * @param cdp - The proxy connected for that session.
   * @param href - What the page answered for `location.href`.
   * @example
   * ```ts
   * this.keepBlankPage(matches, session, candidate, 'about:blank') // matches now holds the session
   * ```
   */
  private keepBlankPage(
    matches: { session: vscode.DebugSession; cdp: Cdp }[],
    session: vscode.DebugSession,
    cdp: Cdp,
    href: unknown,
  ): void {
    if (href === 'about:blank') matches.push({ session, cdp })
  }

  /**
   * Selects the one blank page among the checked sessions, as the last step of a discovery pass of {@link selectPage}.
   * @param matches - The sessions whose page answered `about:blank` in this pass.
   * @returns `false` when no page was found yet, so the wait goes on; `true` once the browser participant has its session and proxy.
   * @throws `Ambiguous owned page` when more than one session shows a blank page.
   * @example
   * ```ts
   * this.selectBlankPage([]) // false
   * ```
   */
  private selectBlankPage(
    matches: { session: vscode.DebugSession; cdp: Cdp }[],
  ): boolean {
    if (matches.length > 1) throw new Error('Ambiguous owned page')
    if (!matches[0]) return false
    this.alive()
    this.participants.browser.selected = matches[0].session
    this.participants.browser.cdp = matches[0].cdp
    return true
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
    const point = this.clickPoint(target)
    // A result predicate already true before the click cannot prove this operation caused the result.
    const priorResult = await this.readDom('after')
    this.alive()
    if (priorResult.ready)
      throw new Error(
        'Configured after conditions were already true before application input',
      )
    // DOM checks yield to native events; recheck pending authority synchronously before dispatching the first input.
    this.assertServerRegistrationsHeld()
    this.operation!.inputDispatched = true
    this.evidence.record('input.dispatched', {
      key: this.operation!.key,
      x: point.x,
      y: point.y,
    })
    const cdp = this.requireCdp()
    await cdp.request(
      'Input.dispatchMouseEvent',
      {
        type: 'mousePressed',
        button: 'left',
        clickCount: 1,
        x: point.x,
        y: point.y,
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
        x: point.x,
        y: point.y,
      },
      REPOSITORY_RUN_TIMEOUT_MS,
    )
    this.alive()
    this.operation!.inputAcknowledged = true
    this.evidence.record('input.acknowledged')
  }

  /**
   * Takes the point of the one mouse sequence from what the page answered for the before conditions, for {@link dispatchInput} right after that read.
   * @param target - The answer of the page for the `before` phase.
   * @returns The center of the unique enabled click target, in viewport coordinates.
   * @throws When the before conditions no longer hold or the page named no point.
   * @example
   * ```ts
   * this.clickPoint({ ready: true, x: 120, y: 48 }) // { x: 120, y: 48 }
   * ```
   */
  private clickPoint(
    target: Awaited<ReturnType<ConfiguredBrowserRun['readDom']>>,
  ): { x: number; y: number } {
    if (!target.ready || target.x === undefined || target.y === undefined)
      throw new Error('Click target or before conditions changed before input')
    return { x: target.x, y: target.y }
  }

  /**
   * Reads every armed server stop's registration once more, synchronously, as the last check of {@link dispatchInput} before the input is marked dispatched: the DOM reads before it yielded to native events that can revoke a registration.
   * @throws The registration failure ({@link registrationFailure}) when the adapter refused or revoked a registration, and a plain error when a stop has no current receipt.
   * @example
   * ```ts
   * this.assertServerRegistrationsHeld() // throws 'Server breakpoint registration changed before input' while a newer request is unanswered
   * ```
   */
  private assertServerRegistrationsHeld(): void {
    for (const stop of this.stops.filter(
      (candidate) => candidate.participant === 'server' && candidate.breakpoint,
    )) {
      let receipt: ReturnType<OwnedRepositoryBreakpoint['registration']>
      try {
        receipt = stop.breakpoint!.registration(
          this.participants.server.selected!,
        )
      } catch (error) {
        throw this.registrationFailure(stop, error)
      }
      if (!receipt)
        throw new Error('Server breakpoint registration changed before input')
    }
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
  /** Reserves stops in declared order, retaining per-session generations across participant transitions. An accepted stop starts the pause hold and its inspection; the status becomes `paused-<participant>` only when {@link inspect} commits the observation. @example run.onEvent(selected, stopped) */
  onEvent(session: vscode.DebugSession, event: DebugProtocol.Event): void {
    const name = this.participantName(session)
    if (this.cleaning || !name) return
    const participant = this.participants[name]
    // The adapter's later news about an owned breakpoint (a pending one verified when its module loads) gives that stop its place.
    if (event.event === 'breakpoint')
      for (const stop of this.stops) stop.breakpoint?.onEvent(session, event)
    if (event.event === 'stopped') {
      const body: DebugProtocol.StoppedEvent['body'] = event.body
      if (name === 'browser' && this.transientBrowserPause) {
        this.fail('Unowned browser DAP stop invalidated the declared operation')
        return
      }
      const deferred = participant.deferredRefresh
      // The re-announcement of a refresh that came while the accepted stop's own pause was still awaited: inspect is judging that stop, so nothing is verified here.
      if (deferred) {
        participant.deferredRefresh = undefined
        if (
          deferred.sessionId !== session.id ||
          deferred.threadId !== body.threadId ||
          !participant.gate.matches(deferred) ||
          this.continuation
        ) {
          this.fail('Unexpected stop invalidated native stack refresh')
          return
        }
        this.evidence.record('dap.pause-refresh-deferred-stop', {
          participant: name,
          ...deferred,
        })
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
      // The run's status stays what it was until inspect has committed the observation: a read in between must not answer a pause it can neither read nor continue.
      this.holdPauseDeadline()
      this.evidence.record('dap.stopped', {
        participant: name,
        ...pause,
        reason: body.reason,
      })
      this.track(this.inspect(pause))
    } else if (event.event === 'continued' && this.operation) {
      const continuation = this.continuation,
        isIdle = this.isIdleContinued(name)
      // An idle one belongs to a pause the adapter resumed by itself; a hook that pauses in a loop sends one per turn, so they share that journal cap.
      if (
        isIdle &&
        this.idleContinuedCount++ >= REPOSITORY_ADAPTER_PAUSE_JOURNAL_LIMIT
      ) {
        this.unjournaledAdapterEvents++
        return
      }
      this.evidence.record('dap.continued-observed', {
        participant: name,
        sequence: event.seq,
        threadId: event.body?.threadId,
        generation: participant.gate.generation,
        stopIndex: this.stopIndex,
      })
      // The adapter emits one for every resume, also of a pause it made and resumed by itself while this participant has no owned pause.
      if (isIdle) {
        this.evidence.record('dap.idle-continued-ignored', {
          participant: name,
          sequence: event.seq,
        })
        return
      }
      const pause = participant.gate.current,
        stopped = participant.stopped
      // A refresh while the accepted stop's own pause is still awaited, or after a held pause was adopted for it: inspect judges that stop and names its binding, so the refresh gets no check of its own.
      if (
        !continuation &&
        !participant.refresh &&
        !participant.deferredRefresh &&
        pause &&
        participant.gate.matches(pause) &&
        pause.sessionId === session.id &&
        pause.threadId === event.body?.threadId &&
        this.awaitsOwnPause(name)
      ) {
        participant.deferredRefresh = { ...pause }
        this.evidence.record('dap.pause-refresh-deferred', {
          participant: name,
          ...pause,
        })
        return
      }
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

  /** Tells {@link onEvent} and {@link adapterPauseLimitMs} whether this participant's accepted stop has no pause of its own yet: {@link inspect} is still waiting for it, or took a pause held elsewhere in the stop's module and is about to judge its binding. @example this.awaitsOwnPause('server') // true during the wait of pauseOfAcceptedStop */
  private awaitsOwnPause(name: Participant): boolean {
    const stopped = this.participants[name].stopped
    return this.isAcceptedStopOf(name) && (!stopped || stopped.adopted === true)
  }

  /** Tells {@link awaitsOwnPause} whether the stop whose `stopped` was accepted, and whose snapshot is not ready yet, is this participant's. @example this.isAcceptedStopOf('browser') // false while a server stop is being inspected */
  private isAcceptedStopOf(name: Participant): boolean {
    return (
      this.acceptedStop &&
      !this.snapshotReady &&
      this.stops[this.stopIndex]?.participant === name
    )
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
    this.holdPauseDeadline()
    this.evidence.record('dap.pause-refreshed', {
      participant: name,
      ...refresh.pause,
      line: frame.line,
      column: frame.column,
    })
  }
  /** Matches each CDP resume to its own captured generation; a queued next stop cannot resume unobserved. A resume of a pause no debugger stop announced is not a continuation: {@link retireUnannouncedPause} retires it (and the transient browser pause of a run without browser stops is retired here), journaling its place and duration. The resume of a pause nothing holds (an instrumentation pause, a pause from before the action) is journaled when that pause was, otherwise counted. @example this.onCdpResumed('server') */
  private onCdpResumed(name: Participant): void {
    if (this.cleaning) return
    const participant = this.participants[name],
      pausedForMs = elapsedMsSince(
        participant.pauseObservedAtMs,
        this.evidence.elapsedMs(),
      )
    // Only a pause that was observed and left out of the journal is not journaled; a resume whose pause was never observed is journaled as before.
    const isPauseOnlyCounted = participant.pauseJournaled === false
    participant.pauseObservedAtMs = undefined
    participant.pauseJournaled = undefined
    // The runtime's own instrumentation pause ended; it never was a stop of this run. Its resume is journaled only when its pause was, so both stay under the cap.
    if (participant.instrumentationPaused) {
      participant.instrumentationPaused = false
      this.journalUnheldResume(name, pausedForMs, isPauseOnlyCounted)
      return
    }
    const transient = this.transientBrowserPause
    if (name === 'browser' && transient) {
      clearTimeout(transient.timer)
      this.transientBrowserPause = undefined
      if (transient.journaled)
        this.evidence.record('cdp.browser-adapter-pause-retired', {
          ...describeCdpPause(transient.event, participant.scriptUrls),
          place: this.placeOf('browser', transient.event),
          pausedForMs,
        })
      else this.unjournaledAdapterEvents++
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
    // A pause from before the action is held by nothing; past the journal's cap its resume is counted, as its observation was.
    if (!stopped) {
      this.journalUnheldResume(name, pausedForMs, isPauseOnlyCounted)
      return
    }
    this.evidence.record('cdp.resumed', {
      participant: name,
      generation: stopped.generation,
      pausedForMs,
    })
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
  /**
   * Journals the resume of a pause nothing holds (the runtime's instrumentation pause, a pause from before the action) as `cdp.resumed`, or counts it when its observation was only counted, so a loop of such pauses stays under the journal's cap; called by {@link onCdpResumed}.
   * @param name - The participant whose runtime resumed.
   * @param pausedForMs - How long the pause lasted on the journal clock, when its start was observed.
   * @param isPauseOnlyCounted - Whether the pause's observation was left out of the journal.
   * @example
   * ```ts
   * this.journalUnheldResume('server', 2, false) // journals cdp.resumed { participant: 'server', pausedForMs: 2 }
   * ```
   */
  private journalUnheldResume(
    name: Participant,
    pausedForMs: number | undefined,
    isPauseOnlyCounted: boolean,
  ): void {
    if (isPauseOnlyCounted) this.unjournaledAdapterEvents++
    else this.evidence.record('cdp.resumed', { participant: name, pausedForMs })
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
   * The pause may be read after its `stopped`, so the wait is bounded; it takes only a pause at the stop's place (its bound line, or before that is known its declared line or a line its rule accepts), which {@link admitPause} stored. A pause held on a browser stop's bound line at another column is taken at once when the binding, read again, names that column ({@link pauseAtMovedColumn}); every other held pause is judged only when the wait has ended.
   * @param stop - The declared stop whose `stopped` was accepted.
   * @returns The stop's pause, not yet bound to a generation.
   * @throws The wait's timeout when no pause arrives at the stop's place and no pause held while the stop was expected stayed elsewhere in its module.
   * @example
   * ```ts
   * const stopped = await this.pauseOfAcceptedStop(stop)
   * ```
   */
  private async pauseOfAcceptedStop(
    stop: PreparedStop,
  ): Promise<NonNullable<DebugParticipant['stopped']>> {
    const participant = this.participants[stop.participant]
    // The held pause whose column was already compared with the binding read again; one read per held pause is enough.
    let comparedPause: Protocol.Debugger.PausedEvent | undefined
    try {
      return await waitUntil(
        async () => {
          // A pause held since before the stop's turn that outlasted the adapter's bound is not about to be resumed; the wait ends with its text.
          this.assertNoOverdueEarlyPause(stop)
          const candidate = this.unboundPauseInModule(participant, stop)
          if (candidate) return candidate
          const held = this.pauseHeldForStop(stop)
          if (!held || held.event === comparedPause) return undefined
          comparedPause = held.event
          return this.pauseAtMovedColumn(stop, held)
        },
        SOURCE_BOUND_PAUSE_WAIT_DESCRIPTION,
        CAPTURE_TIMEOUT_MS,
        this.abort.signal,
      )
    } catch (error) {
      // An announced pause that stayed elsewhere in the stop's module since its turn began is judged by the binding and frame checks, which say what is wrong.
      const held = this.adoptPauseHeldInModule(stop)
      if (held) return held
      throw this.unreachedPauseFailure(stop, error)
    }
  }

  /**
   * Ends the wait of {@link pauseOfAcceptedStop} when a pause held since before the stop's turn outlasted the adapter's bound; each look of that wait asks it first.
   * @param stop - The declared stop whose `stopped` was accepted.
   * @throws The text of {@link earlyPauseFailure} when such a pause is held for longer than {@link REPOSITORY_ANNOUNCED_PAUSE_RESUME_LIMIT_MS}.
   * @example
   * ```ts
   * this.assertNoOverdueEarlyPause(stop) // returns while no pause from before the stop's turn is held
   * ```
   */
  private assertNoOverdueEarlyPause(stop: PreparedStop): void {
    const early = this.pauseHeldBeforeTurn(stop)
    if (
      early &&
      performance.now() - early.heldAtMs >
        REPOSITORY_ANNOUNCED_PAUSE_RESUME_LIMIT_MS
    )
      throw this.earlyPauseFailure(stop, early)
  }

  /**
   * Reads the pause {@link admitPause} stored for a participant when it is the one an accepted stop waits for, for each look of {@link pauseOfAcceptedStop}.
   * @param participant - The stop's participant.
   * @param stop - The declared stop whose `stopped` was accepted.
   * @returns The stored pause while it is bound to no generation yet and its top frame is in the stop's script; `undefined` otherwise.
   * @example
   * ```ts
   * this.unboundPauseInModule(this.participants.server, stop) // undefined until the runtime pause of the stop arrived
   * ```
   */
  private unboundPauseInModule(
    participant: DebugParticipant,
    stop: PreparedStop,
  ): DebugParticipant['stopped'] {
    const candidate = participant.stopped
    if (!candidate || candidate.generation !== undefined) return undefined
    return this.hasTopFrameInScriptOf(candidate.event, stop)
      ? candidate
      : undefined
  }

  /** Tells {@link unboundPauseInModule} whether a pause's top frame names the script id of a stop's module, as far as either is known. @example this.hasTopFrameInScriptOf(event, stop) // false for a pause in another script */
  private hasTopFrameInScriptOf(
    event: Protocol.Debugger.PausedEvent,
    stop: PreparedStop,
  ): boolean {
    return event.callFrames[0]?.location.scriptId === stop.script?.scriptId
  }

  /**
   * Chooses what {@link pauseOfAcceptedStop} fails with when its wait ended and no held pause could be adopted.
   * @param stop - The declared stop whose `stopped` was accepted.
   * @param error - What ended the wait.
   * @returns The text of {@link earlyPauseFailure} when the run was not aborted and a pause from before the stop's turn is held; otherwise `error` itself.
   * @example
   * ```ts
   * throw this.unreachedPauseFailure(stop, error)
   * ```
   */
  private unreachedPauseFailure(stop: PreparedStop, error: unknown): unknown {
    // A pause that came before the stop's turn is never adopted; the failure says that the line ran early instead of naming the wait.
    const early = this.abort.signal.aborted
      ? undefined
      : this.pauseHeldBeforeTurn(stop)
    return early ? this.earlyPauseFailure(stop, early) : error
  }

  /**
   * Takes a pause held for an accepted browser stop on its bound line at another column as that stop's pause without waiting for the bound of {@link pauseOfAcceptedStop}, when the debugger moved the stop's binding to that column after it was armed.
   * The binding is read again once: only when it names the held pause's column is the pause the announced one. A pause the debugger makes for itself at another statement of that line leaves the binding where it was and keeps waiting for its resume, and a held pause on any other line is judged when the wait has ended ({@link adoptPauseHeldInModule}).
   * @param stop - The declared stop whose `stopped` was accepted.
   * @param held - The pause held for that stop in its module ({@link pauseHeldForStop}).
   * @returns
   * - The adopted pause, when the re-read binding is on the stop's bound line at the held pause's column and the pause is still held
   * - `undefined` for a server stop, a pause on another line, a binding that did not move to the pause's column or could not be read, and a pause that was resumed while the binding was read
   * @example
   * ```ts
   * await this.pauseAtMovedColumn(stop, held) // the stop armed at 22:5 whose breakpoint and pause are now at 22:12 is taken at once
   * ```
   */
  private async pauseAtMovedColumn(
    stop: PreparedStop,
    held: NonNullable<DebugParticipant['unannouncedPause']>,
  ): Promise<DebugParticipant['stopped']> {
    const participant = this.participants[stop.participant],
      location = this.heldLocationOnBoundLine(stop, held)
    if (!location) return undefined
    // A binding that cannot be read now decides nothing: the pause stays held and the end of the wait judges it. The read has the wait's own bound, so an adapter that does not answer cannot hold the wait past it.
    const binding = verifiedPlaceSchema.safeParse(
      await awaitResponse(
        participant.selected!.getDebugProtocolBreakpoint(
          stop.breakpoint!.breakpoint,
        ),
        'held browser binding',
        this.abort.signal,
        CAPTURE_TIMEOUT_MS,
      ).catch(() => undefined),
    )
    // The pause may have been resumed while the binding was read.
    if (
      participant.unannouncedPause !== held ||
      !this.isBoundAtHeldColumn(stop, binding, location)
    )
      return undefined
    return this.adoptPauseHeldInModule(stop)
  }

  /**
   * Gives the place of a held pause only when the binding of its stop can have moved to it, as the first check of {@link pauseAtMovedColumn} before the binding is read again.
   * @param stop - The declared stop whose `stopped` was accepted.
   * @param held - The pause held for that stop in its module.
   * @returns The generated location of the pause's top frame for a bound browser stop paused on its bound line; `undefined` for a server stop, a stop without a binding, and a pause without a frame or on another line.
   * @example
   * ```ts
   * this.heldLocationOnBoundLine(stop, held) // { scriptId: '12', lineNumber: 21, columnNumber: 11 }
   * ```
   */
  private heldLocationOnBoundLine(
    stop: PreparedStop,
    held: NonNullable<DebugParticipant['unannouncedPause']>,
  ): Protocol.Debugger.Location | undefined {
    // Only a browser stop has a binding from arming that can move along its line; a pause on another line waits for the bound.
    if (stop.participant !== 'browser' || !stop.bound) return undefined
    return this.locationOfPauseAtStop(stop, held)
  }

  /**
   * Gives the place of a held pause when it is on its stop's line, for {@link heldLocationOnBoundLine} once the stop is known to be a bound browser stop.
   * @param stop - The declared stop whose `stopped` was accepted.
   * @param held - The pause held for that stop in its module.
   * @returns The generated location of the pause's top frame, or `undefined` for a pause without a frame or on another line.
   * @example
   * ```ts
   * this.locationOfPauseAtStop(stop, held) // undefined for a pause one line below the bound line
   * ```
   */
  private locationOfPauseAtStop(
    stop: PreparedStop,
    held: NonNullable<DebugParticipant['unannouncedPause']>,
  ): Protocol.Debugger.Location | undefined {
    const location = held.event.callFrames[0]?.location
    return location && isPauseAtStop(held.event, this.pauseTarget(stop))
      ? location
      : undefined
  }

  /**
   * Says whether a binding read again names the column of a held pause on the stop's bound line, as the last check of {@link pauseAtMovedColumn} once that read has answered.
   * @param stop - A bound browser stop ({@link heldLocationOnBoundLine} gave the location); its bound line is read now, after the wait for the binding.
   * @param binding - The parsed answer of the adapter; unsuccessful when the binding could not be read or is not verified at a whole position.
   * @param location - The generated location of the held pause's top frame.
   * @returns `true` when the binding is on the bound line at the pause's column; `false` when it could not be read, is on another line, or did not move to that column.
   * @example
   * ```ts
   * this.isBoundAtHeldColumn(stop, verifiedPlaceSchema.safeParse(undefined), location) // false
   * ```
   */
  private isBoundAtHeldColumn(
    stop: PreparedStop,
    binding: ReturnType<typeof verifiedPlaceSchema.safeParse>,
    location: Protocol.Debugger.Location,
  ): boolean {
    return (
      binding.success &&
      binding.data.line === stop.bound!.line &&
      binding.data.column === stop.verifier.originalColumn(location)
    )
  }

  /**
   * Finds a pause in an accepted stop's module that was held before that stop's turn, for {@link pauseOfAcceptedStop}: its line ran before the input was sent or before the preceding continuation was requested.
   * @param stop - The declared stop whose `stopped` was accepted.
   * @returns The held pause, or `undefined` when none is held or it was held during the stop's turn or in another script.
   * @example
   * ```ts
   * this.pauseHeldBeforeTurn(stop) // the pause of a re-render that ran while the stop was being armed
   * ```
   */
  private pauseHeldBeforeTurn(
    stop: PreparedStop,
  ): DebugParticipant['unannouncedPause'] {
    const held = this.participants[stop.participant].unannouncedPause
    return held &&
      held.expectedStop !== stop &&
      isPauseInScript(held.event, stop.script)
      ? held
      : undefined
  }

  /** Words the failure of an accepted stop whose only pause came before its turn, so the agent learns that the line ran early instead of reading a timeout. @example this.earlyPauseFailure(stop, held).message // 'Declared stop app/ui/form.tsx:22 paused at app/ui/form.tsx:22 before its turn: …' */
  private earlyPauseFailure(
    stop: PreparedStop,
    held: NonNullable<DebugParticipant['unannouncedPause']>,
  ): Error {
    // A later stop is armed inside the continuation, before its resume is requested, so its line can run in that window as well as earlier.
    const [turn, remedy] =
      this.stopIndex === 0
        ? ['the input was sent', 'the input']
        : [
            'the preceding continuation was requested (while this stop was being armed, or earlier)',
            'the preceding stop continues',
          ]
    return new Error(
      `Declared stop ${this.declaredAt(stop)} paused at ${this.placeOf(stop.participant, held.event)} before its turn: its line ran before ${turn}, so that pause is no observation of this stop; declare a line that runs only after ${remedy}`,
    )
  }

  /**
   * Adopts a pause that stayed elsewhere in an accepted stop's module as that stop's pause, called by {@link pauseOfAcceptedStop} after its wait ended and by {@link pauseAtMovedColumn} as soon as the binding read again names the held pause's column.
   * The adapter resumes its own pauses within milliseconds, so a pause that outlasted the wait in the stop's own module, held while that stop was the expected one, is the announced one: a binding on another line, or another breakpoint in that file. A pause in any other script, or one held before the stop's turn, is left alone (see {@link pauseHeldForStop}).
   * @param stop - The declared stop whose `stopped` was accepted.
   * @returns The adopted pause, or `undefined` when the run was cancelled or no such pause is held.
   * @example
   * ```ts
   * const held = this.adoptPauseHeldInModule(stop) // then inspect reports "bound at 24:5, refused: …"
   * ```
   */
  private adoptPauseHeldInModule(
    stop: PreparedStop,
  ): DebugParticipant['stopped'] {
    const participant = this.participants[stop.participant],
      held = this.pauseHeldForStop(stop)
    if (this.abort.signal.aborted || !held) return undefined
    participant.unannouncedPause = undefined
    participant.stopped = { event: held.event, adopted: true }
    // The evidence must show that this stop's pause was taken from a held one, not admitted on its line.
    this.evidence.record('cdp.held-pause-adopted', {
      participant: stop.participant,
      ...describeCdpPause(held.event, participant.scriptUrls),
      place: this.placeOf(stop.participant, held.event),
      declared: this.declaredAt(stop),
    })
    return participant.stopped
  }

  /**
   * Finds the held pause that {@link adoptPauseHeldInModule} may take as an accepted stop's pause: one that arrived in the stop's module while that stop was the expected one.
   * A pause held before the stop's turn (the other participant running the line while the next stop is armed, before its continuation is requested) can be on the declared line itself; adopting it would report an observation made before the continuation as one made after it.
   * @param stop - The declared stop whose `stopped` was accepted.
   * @returns
   * - The held pause, when it was held for this stop in its module and the sealed map does not place it in another original
   * - `undefined` otherwise, including a pause held before the stop's turn and one in another original of the same script
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
      this.isPauseInOriginalOf(held.event, stop)
      ? held
      : undefined
  }

  /**
   * Tells {@link pauseHeldForStop} whether a held pause lies in a stop's module and in its original file.
   * @param event - The held pause.
   * @param stop - The declared stop the pause was held for.
   * @returns `true` when the pause's top frame is in the stop's script and the sealed map does not place it in another original; `false` for a pause without a frame.
   * @example
   * ```ts
   * this.isPauseInOriginalOf(held.event, stop) // false for a pause in another original of the same bundle
   * ```
   */
  private isPauseInOriginalOf(
    event: Protocol.Debugger.PausedEvent,
    stop: PreparedStop,
  ): boolean {
    const location = event.callFrames[0]?.location
    // A bundle can hold several originals in one script; a pause the sealed map places in another original cannot be this stop's binding.
    if (!isPauseInScript(event, stop.script) || !location) return false
    return !stop.verifier.isInAnotherOriginal(location)
  }

  /**
   * Seals actual configured values and renderer pixels only while the exact source-bound pause remains current, called by {@link onEvent} for an accepted debugger stop.
   * When the observation is committed it publishes, in one synchronous step, the snapshot, the status `paused-<participant>` and the ready snapshot that offers the continuation; until then the run's status is the one before the stop, so a read of the run never finds a paused state without its observation.
   * @param pause - The identity the pause gate gave the accepted stop.
   * @throws The failure that ends the run when the pause changed, its binding or frame is refused, or the evidence cannot be saved; a failed image or required inspection is thrown after the snapshot was committed, so its facts stay readable.
   * @example
   * ```ts
   * this.track(this.inspect(pause))
   * ```
   */
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
        ...declaredAndArmedPlace(stop.source, stop.armed),
        returned:
          binding === undefined
            ? 'absent'
            : receipt.success
              ? 'parsed'
              : 'malformed',
        observed: receipt.success ? receipt.data : undefined,
      })
      const parsed = verifiedPlaceSchema
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
      // The owned breakpoint is verified in the cited file but on a line the stop's rule refuses: name where it landed and why so the declaration can be corrected.
      if (!stop.acceptsBoundLine(parsed.data.line))
        throw this.bindingFailure(
          stop,
          this.refusedBindingText(stop, parsed.data),
        )
      this.bindBoundPlace(stop, parsed.data)
      await this.journalSlidePastPausableLine(stop, parsed.data)
      current()
    } else if (stopped.adopted) {
      // A browser pause away from the binding verified at arming: the debugger may have moved that binding since, so it is read again and named.
      const moved = verifiedPlaceSchema.safeParse(
        await awaitResponse(
          participant.selected!.getDebugProtocolBreakpoint(
            stop.breakpoint!.breakpoint,
          ),
          'paused browser binding',
          this.abort.signal,
        ),
      )
      current()
      if (
        moved.success &&
        (moved.data.line !== stop.bound?.line ||
          moved.data.column !== stop.bound.column)
      ) {
        if (!stop.acceptsBoundLine(moved.data.line))
          throw this.bindingFailure(
            stop,
            this.refusedBindingText(stop, moved.data),
          )
        this.bindBoundPlace(stop, moved.data)
        await this.journalSlidePastPausableLine(stop, moved.data)
        current()
      }
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
      throw new Error(
        'DAP frame differs from the bound configured source position',
      )
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
          `Required inspection ${missing.mode}:${missing.path} is unavailable; captured facts remain readable.${selfDeclaredInspectionHint(stop.bundle.source, frame.line, missing.path)}`,
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
        // The stop's rule accepted this bound line: no line between it and the requested one has a mapped position, and the requested line is the declared one or the first mapped line after it.
        binding: {
          declaredLine: position.line,
          ...(stop.armed.line === position.line
            ? {}
            : { requestedLine: stop.armed.line }),
          boundLine: frame.line,
          mappedLinesBetween: 0,
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
    // The paused state is published in one step with the observation (above) and the continuation it offers (the ready snapshot), so no read sees one without the others.
    this.status = phase
    this.snapshotReady = true
    await this.persist()
  }

  /**
   * Continues the committed pause of a declared stop, called by the service for `codebook_continue` and for the Study pane's Continue.
   * Reserves the exact pause before source revalidation, then arms the next declared stop and reads the other participant's earlier pauses before it requests the resume; only an owned, retired breakpoint leads to an acknowledged continuation.
   * @param name - The participant whose committed pause is continued.
   * @param pause - The pause identity the caller copied from the run's view.
   * @throws `conflict: stale, foreign or unverified pause` without ending the run; every later failure ends the run and is thrown on. The run's reason is "Next declared stop was not armed and no resume was sent: …" or "Next declared stop could not be continued to: … and no resume was sent. …" for the two steps that come before the resume, and "Continue uncertain: …" otherwise.
   * @example
   * ```ts
   * await run.continue('browser', pause)
   * ```
   */
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
            `Next declared stop was not armed and no resume was sent: ${thrownMessage(error)}`,
          )
          throw error
        }
        this.alive()
        // The other participant keeps running while its stop is armed: a pause it made before this point is read before the continuation exists, so it is never taken for that stop.
        if (nextStop.participant !== name) {
          await this.deliverEarlierPauses(nextStop.participant)
          this.alive()
        }
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
  /**
   * Makes one round trip on a participant's inspector channel, called by {@link continue} before the continuation exists.
   * Events on one channel keep their order, so every pause the participant sent before it answered has been read when this returns.
   * @param name - The participant whose next stop was armed.
   * @throws What the round trip failed with, after the run was failed with a sentence that says that no resume was sent: this read comes before the resume is requested, so its failure is never an uncertain continuation.
   * @example
   * ```ts
   * await this.deliverEarlierPauses('browser')
   * ```
   */
  private async deliverEarlierPauses(name: Participant): Promise<void> {
    try {
      const cdp = this.participants[name].cdp
      if (!cdp) throw new Error('Selected native proxy unavailable')
      await awaitResponse(
        cdp.request('Runtime.evaluate', {
          expression: 'undefined',
          returnByValue: true,
        }),
        'earlier pause delivery',
        this.abort.signal,
      )
    } catch (error) {
      // Nothing has been resumed yet, so the record says exactly that, as for a next stop that could not be armed.
      this.fail(
        `Next declared stop could not be continued to: the earlier pauses of the ${name} could not be read (${thrownMessage(error)}), and no resume was sent. Earlier observations stay.`,
      )
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
      // A later stop is armed only inside the preceding continuation, so its line pauses as that stop only after it; a pause on that line before its turn is held as unannounced and never adopted ({@link pauseHeldForStop}). Say which stop and why.
      const nextStop = this.stops[this.stopIndex]!
      this.progressDeadline(ACTIVE_TIMEOUT_MS, () =>
        this.unreachedNextStopReason(nextStop),
      )
      const cdpStop = this.pendingCdpStop,
        dapStop = this.pendingDapStop
      this.pendingCdpStop = undefined
      this.pendingDapStop = undefined
      // Publish queued events only after the previous generation has retired completely. The pause was journaled when it was observed and its clock keeps running, so it is admitted, not observed again.
      if (cdpStop) this.admitPause(cdpStop.participant, cdpStop.event)
      if (dapStop)
        this.onEvent(
          this.participants[dapStop.participant].selected!,
          dapStop.event,
        )
      return
    }
    this.status = 'resuming'
    this.progressDeadline(ACTIVE_TIMEOUT_MS, () => this.afterDeadlineReason())
    this.track(this.observeAfter(continuation))
  }
  /** Confirms input, declared DOM conditions and renderer ACK while no additional pause has invalidated the original completion, waits until no participant is still paused at a pause the adapter made for itself, and reads the conditions once more after the after image, failing the run when they no longer hold. @example await this.observeAfter(continuation) */
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
    // The conditions may have been read while a participant was paused in the middle of a task: once nothing is paused they are read again, until a read ends with nothing paused.
    do {
      await waitUntil(
        () => this.adapterPausesRetired(),
        ADAPTER_PAUSE_RETIREMENT_WAIT_DESCRIPTION,
        ACTIVE_TIMEOUT_MS,
        this.abort.signal,
      )
      current()
      await this.waitForDom('after')
      current()
    } while (!this.adapterPausesRetired())
    await this.capture('after', current)
    current()
    // The page can change while the image is captured (a participant paused during the capture runs on at its resume): the conditions are read once more with nothing paused, and a result that no longer holds is not certified.
    let afterCapture: z.infer<typeof domResultSchema>
    do {
      await waitUntil(
        () => this.adapterPausesRetired(),
        ADAPTER_PAUSE_RETIREMENT_WAIT_DESCRIPTION,
        ACTIVE_TIMEOUT_MS,
        this.abort.signal,
      )
      current()
      afterCapture = await this.readDom('after')
      current()
    } while (!this.adapterPausesRetired())
    if (!afterCapture.ready) {
      this.fail(this.changedAfterCaptureReason(afterCapture.failure))
      return
    }
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
  /**
   * Words the failure of the deadline armed when the last continuation began, read when it expires (see {@link beginAfter}).
   * That deadline and the after wait share one bound and the deadline was armed first, so it ends the wait; the text then says what the after wait would have said.
   * @returns The after conditions' timeout text with its hint while they did not hold, otherwise the plain text.
   * @example
   * ```ts
   * this.afterDeadlineReason() // 'Timed out waiting for configured after conditions: condition 1 (text) text-mismatch. A text condition …'
   * ```
   */
  private afterDeadlineReason(): string {
    const failure = this.lastAfterFailure
    return failure
      ? this.conditionTimeoutText('after', failure)
      : 'Repository after condition or input acknowledgement timed out'
  }
  /**
   * Composes the text of DOM conditions that did not hold within their bound, called by {@link waitForDom} and {@link afterDeadlineReason}.
   * @param phase - Whether the conditions guard the input or prove the result.
   * @param failure - What the page answered last.
   * @returns The timeout text naming the condition (or click target), the reason and the hint.
   * @example
   * ```ts
   * this.conditionTimeoutText('after', { conditionIndex: 0, reason: 'not-visible' }) // 'Timed out waiting for configured after conditions: condition 1 (visible) not-visible.'
   * ```
   */
  private conditionTimeoutText(
    phase: 'before' | 'after',
    failure: ConfiguredDomFailure,
  ): string {
    return `${waitTimeoutText(this.conditionsWaitDescription(phase))}: ${this.failedConditionText(phase, failure)}`
  }
  /** Names the wait for a phase's declared DOM conditions, so the wait {@link waitForDom} starts and the text {@link conditionTimeoutText} composes name the same thing. @example this.conditionsWaitDescription('after') // 'configured after conditions' */
  private conditionsWaitDescription(phase: 'before' | 'after'): string {
    return `configured ${phase} conditions`
  }
  /**
   * Names a declared DOM condition that did not hold, with the page's reason and the hint that corrects it, for {@link conditionTimeoutText} and {@link changedAfterCaptureReason}.
   * @param phase - Whether the condition guards the input or proves the result.
   * @param failure - What the page answered.
   * @returns The condition (or the click target), the reason and a period, followed by the hint when there is one.
   * @example
   * ```ts
   * this.failedConditionText('after', { conditionIndex: 0, reason: 'not-visible' }) // 'condition 1 (visible) not-visible.'
   * ```
   */
  private failedConditionText(
    phase: 'before' | 'after',
    failure: ConfiguredDomFailure,
  ): string {
    const { conditionIndex, reason } = failure
    const failedCondition = this.declaredCondition(phase, conditionIndex)
    const condition =
      conditionIndex === undefined
        ? 'click target'
        : `condition ${conditionIndex + 1} (${failedCondition?.kind ?? 'unknown'})`
    return `${condition} ${reason}.${configuredConditionHint(phase, failedCondition, failure)}`
  }
  /**
   * Looks up the declared DOM condition a page answer points at, for {@link failedConditionText}.
   * @param phase - Whether the condition guards the input or proves the result.
   * @param conditionIndex - The index the page answered; `undefined` when it named the click target instead.
   * @returns The declared condition, or `undefined` for the click target and for an index the declaration does not have.
   * @example
   * ```ts
   * this.declaredCondition('after', 0)?.kind // 'visible'
   * ```
   */
  private declaredCondition(
    phase: 'before' | 'after',
    conditionIndex: number | undefined,
  ) {
    return conditionIndex === undefined
      ? undefined
      : this.definition.configuration.action[phase][conditionIndex]
  }
  /**
   * Words the failure of a run whose after conditions held before the after image was captured and no longer held when {@link observeAfter} read them again after it, so such a run is never certified as demonstrated.
   * @param failure - What the page answered at the second read; `undefined` when it named no condition.
   * @returns The text that says what was observed, which condition no longer held, and what to declare before a new run.
   * @example
   * ```ts
   * this.changedAfterCaptureReason({ conditionIndex: 0, reason: 'not-visible' }) // 'Repository after conditions held before the after image was captured and no longer held when they were read again after it: condition 1 (visible) not-visible. The page changed …'
   * ```
   */
  private changedAfterCaptureReason(
    failure: ConfiguredDomFailure | undefined,
  ): string {
    const observed =
      'Repository after conditions held before the after image was captured and no longer held when they were read again after it'
    return `${failure ? `${observed}: ${this.failedConditionText('after', failure)}` : `${observed}.`} The page changed during the capture, so the result is not demonstrated. Declare in configuration.action.after a condition that still holds once the action has finished, then start a new run.`
  }
  /**
   * Ends the wait of {@link waitForDom} at once when the page could not use a declared selector; each read of the conditions is checked with it.
   * @param phase - Whether the conditions guard the input or prove the result.
   * @param failure - What the page named at this read; `undefined` when it named nothing.
   * @throws The invalid-selector text, naming the click target or the condition by its number, when the page's reason is `invalid-selector`.
   * @example
   * ```ts
   * this.assertSelectorsValid('after', { conditionIndex: 0, reason: 'invalid-selector' }) // throws 'Invalid CSS selector in configured after condition 1; use browser-native CSS, not Playwright-specific pseudo selectors.'
   * ```
   */
  private assertSelectorsValid(
    phase: 'before' | 'after',
    failure: ConfiguredDomFailure | undefined,
  ): void {
    if (failure?.reason !== 'invalid-selector') return
    const location =
      failure.conditionIndex === undefined
        ? 'click target'
        : `condition ${failure.conditionIndex + 1}`
    throw new Error(
      `Invalid CSS selector in configured ${phase} ${location}; use browser-native CSS, not Playwright-specific pseudo selectors.`,
    )
  }

  /**
   * Polls the declared DOM conditions without repeating application input; setup ({@link prepareOwned}) and after verification ({@link observeAfter}) call it.
   * @param phase - Whether the conditions guard the input or prove the result.
   * @throws The text of {@link conditionTimeoutText} when the wait timed out ({@link WaitTimeoutError}, however the wait worded it) and the page named a condition; the invalid-selector text at once; any other failure of the wait unchanged.
   * @example
   * ```ts
   * await this.waitForDom('after')
   * ```
   */
  private async waitForDom(phase: 'before' | 'after'): Promise<void> {
    let lastResult: z.infer<typeof domResultSchema> | undefined
    try {
      await waitUntil(
        async () => {
          lastResult = await this.readDom(phase)
          if (phase === 'after')
            this.lastAfterFailure = lastResult.ready
              ? undefined
              : lastResult.failure
          this.assertSelectorsValid(phase, lastResult.failure)
          return lastResult.ready
        },
        this.conditionsWaitDescription(phase),
        ACTIVE_TIMEOUT_MS,
        this.abort.signal,
      )
    } catch (error) {
      // Only the wait's own timeout is completed with the condition the page named last; the type says so, whatever the wait's sentence is.
      if (!(error instanceof WaitTimeoutError) || !lastResult?.failure)
        throw error
      throw new Error(this.conditionTimeoutText(phase, lastResult.failure))
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
      browserProfileLeft: this.browser.profileLeft,
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
  /**
   * Restarts the pause hold while the learner reads a replay, so studying a recording longer than the hold does not release the live pause.
   *
   * Called by the study workspace each time it presents a replay moment. Only a held pause is renewed; an active,
   * refresh or continuation deadline and the whole-run deadline are never extended.
   *
   * @example
   * run.renewPauseHold() // a held pause now expires REPOSITORY_PAUSE_HOLD_TIMEOUT_MS from now
   */
  renewPauseHold(): void {
    // Only the hold deadline of a still-held pause may restart.
    if (
      this.cleaning ||
      !this.holdingPause ||
      !this.status.startsWith('paused-')
    )
      return
    // No journal entry: a playing replay renews on every frame, and the bounded journal must keep its room for the run's own events.
    this.holdPauseDeadline()
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
    if (this.unjournaledAdapterEvents)
      this.evidence.record('cdp.adapter-pauses-not-journaled', {
        count: this.unjournaledAdapterEvents,
        journalLimit: REPOSITORY_ADAPTER_PAUSE_JOURNAL_LIMIT,
      })
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
    // A released run names no further pause; its script maps can be as large as the application.
    if (this.cleaned)
      for (const participant of Object.values(this.participants))
        participant.scriptUrls.clear()
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
  /**
   * Starts the pause hold, the deadline of a pause that is kept for the learner, called when a declared stop is accepted ({@link onEvent}), when a stack refresh confirmed the retained pause ({@link verifyStackRefresh}) and by {@link renewPauseHold}.
   * It is the only place that marks the running deadline as the hold, so what a deadline is for decides whether a replay may renew it, never its length.
   * @example
   * ```ts
   * this.holdPauseDeadline() // the pause is released REPOSITORY_PAUSE_HOLD_TIMEOUT_MS from now unless renewed
   * ```
   */
  private holdPauseDeadline(): void {
    this.progressDeadline(
      REPOSITORY_PAUSE_HOLD_TIMEOUT_MS,
      'Repository pause hold deadline exceeded',
    )
    this.holdingPause = true
  }
  /** Applies the current active/hold/setup budget independently from the pending input's whole-run protocol timeout; an expiry while a participant is paused with no announced stop also says where. A reason given as a function is read at expiry, for a text that depends on what is known only then. Every deadline started here is no pause hold; {@link holdPauseDeadline} marks the one that is. @example this.progressDeadline(ACTIVE_TIMEOUT_MS, 'after timed out') */
  private progressDeadline(
    milliseconds: number,
    reason: string | (() => string),
  ): void {
    clearTimeout(this.progressTimer)
    this.holdingPause = false
    // The pause that explains an expiry arrives after the deadline's text was chosen, so the text is completed when it expires.
    this.progressTimer = setTimeout(
      () => this.fail(this.expiredDeadlineText(reason, milliseconds)),
      milliseconds,
    )
  }
  /**
   * Builds a deadline's failure text when it expires, called by the timers of {@link progressDeadline} and of the whole-run deadline.
   * A throw inside a timer callback would escape it and leave the run unfailed, so a reason that cannot be composed is replaced by {@link deadlineText} and a paused place that cannot be read by a text that says so.
   * @param reason - The deadline's text, or a function that reads it at expiry.
   * @param milliseconds - The deadline's length, named when the reason cannot be composed.
   * @returns The reason, followed by where each participant is paused without an announced stop.
   * @example
   * ```ts
   * this.expiredDeadlineText('Repository whole-run deadline exceeded', 300_000) // '… exceeded. The server is paused at auth.ts:18 without a debugger stop.'
   * ```
   */
  private expiredDeadlineText(
    reason: string | (() => string),
    milliseconds: number,
  ): string {
    const text = deadlineText(reason, milliseconds)
    try {
      return withUnannouncedPauses(text, this.unannouncedPausePlaces())
    } catch (error) {
      return `${text} (where a participant is paused could not be read: ${thrownMessage(error)})`
    }
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
