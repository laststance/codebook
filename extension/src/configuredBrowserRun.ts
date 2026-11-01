import { randomUUID } from 'node:crypto'
import { lstat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

import type { DebugProtocol } from '@vscode/debugprotocol'
import type { Protocol } from 'devtools-protocol'
import * as vscode from 'vscode'
import { z } from 'zod'

import {
  OperationRefusal,
  prepareOperation,
  waitForSettledPage,
  type OperationPort,
  type PreparedOperation,
} from './configuredOperations'
import {
  configuredDefinitionSchema,
  type ConfiguredDefinition,
} from './configuredStudySchemas'
import type {
  CONFIGURED_CAPTURE_PHASES,
  NextSetupStep,
  ViteSetupStep,
} from './constants'
import {
  ACTIVE_TIMEOUT_MS,
  NEXT_ROUTER_POLL_INTERVAL_MS,
  NEXT_SETUP_STEPS,
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
  REDACTED_MODULE_LABEL,
  REPOSITORY_BROWSER_PROFILE,
  OPERATIONS_CONFIG_VERSION,
  REPOSITORY_OPERATION_ACTION,
  REPOSITORY_PAUSE_HOLD_TIMEOUT_MS,
  REPOSITORY_PATH_LIMIT_CHARS,
  REPOSITORY_STOP_INSTANCE_READ_MS,
  REPOSITORY_STOP_MODULE_FIRST_JOURNAL_BEYOND_LIMIT,
  REPOSITORY_STOP_MODULE_JOURNAL_LIMIT,
  REPOSITORY_RUN_TIMEOUT_MS,
  REPOSITORY_SCRIPT_DIAGNOSTIC_LIMIT,
  SECRET_FRAME_SOURCE_URL,
  REPOSITORY_SETUP_TIMEOUT_MS,
  VITE_PAGE_GENERATION_LIMIT,
  VITE_SETUP_STEPS,
  VITE_PAGE_QUIET_MS,
  REPOSITORY_STACK_FRAME_LIMIT,
  REPOSITORY_UNOWNED_PAGE_PAUSE_LIMIT_MS,
  SOURCE_BOUND_PAUSE_WAIT_DESCRIPTION,
  SECRET_FRAME_VALUE_COPY_MIN_CHARS,
} from './constants'
import type {
  DevelopmentBundle,
  DevelopmentBundleRequest,
  DevelopmentServerAdapter,
  DevelopmentServerAdapterName,
} from './developmentServerAdapter'
import { StudyError } from './errors'
import {
  nextRefusal,
  nextSetupDeadlineRecovery,
  nextSetupDeadlineSentence,
  nextSetupDeadlineVariantOf,
  type NextRouterState,
} from './nextRefusals'
import {
  OwnedBreakpointMovedError,
  OwnedBreakpointRemovedError,
  OwnedRepositoryBreakpoint,
  verifiedLineSchema,
  type verifiedPlaceSchema,
} from './ownedRepositoryBreakpoint'
import type { BundleSource } from './repositoryBundle'
import {
  configuredDomFailureSchema,
  configuredTextReadingsSchema,
  type ConfiguredDomFailure,
  type OperationsRepositoryConfiguration,
  type RepositoryCondition,
} from './repositoryConfigSchemas'
import { RepositorySourceService } from './repositorySource'
import type {
  ConfiguredRuntimeSnapshot,
  ConfiguredRuntimeView,
  OperationFailure,
  OperationRecord,
  RuntimeAction,
  RuntimeControl,
  RuntimeSource,
  RuntimeSnapshot,
  StudyRuntime,
  Participant,
} from './runtime'
import type { BrowserViewportFactory } from './runtimeSupport/browserViewport'
import { Cdp } from './runtimeSupport/cdp'
import { codebookStopLedger } from './runtimeSupport/codebookStopLedger'
import { CAPTURE_TIMEOUT_MS, RESUME_COMMANDS } from './runtimeSupport/constants'
import { Evidence } from './runtimeSupport/evidence'
import {
  HostBrowser,
  type HostConfiguration,
} from './runtimeSupport/hostBrowser'
import { PauseGate, type PauseIdentity } from './runtimeSupport/pauseGate'
import { SecretFrameGate } from './runtimeSupport/secretFrameGate'
import { awaitResponse } from './runtimeSupport/utils/awaitResponse'
import { isStopCausedByCodebook } from './runtimeSupport/utils/isStopCausedByCodebook'
import { settleCleanup } from './runtimeSupport/utils/settleCleanup'
import { sha256 } from './runtimeSupport/utils/sha256'
import { WaitTimeoutError } from './runtimeSupport/utils/waitTimeoutError'
import { waitTimeoutText } from './runtimeSupport/utils/waitTimeoutText'
import { waitUntil } from './runtimeSupport/utils/waitUntil'
import { afterOperationOf } from './utils/afterOperationOf'
import { assertConfiguredDescriptor } from './utils/assertConfiguredDescriptor'
import { assertConfiguredSourceDocuments } from './utils/assertConfiguredSourceDocuments'
import { assertDevelopmentPortFree } from './utils/assertDevelopmentPortFree'
import {
  assertDevelopmentWorkspace,
  type DevelopmentLockIdentity,
} from './utils/assertDevelopmentWorkspace'
import { refuseViteMisroute } from './utils/assessViteWorkspace'
import { boundColumnOfInstance } from './utils/boundColumnOfInstance'
import {
  breakLocationLinesOnTheWay,
  type BreakLocationsOnTheWay,
  type MappedBreakLocation,
} from './utils/breakLocationLinesOnTheWay'
import { canonicalDefinition } from './utils/canonicalDefinition'
import { captureReplayDebugSnapshot } from './utils/captureReplayDebugSnapshot'
import { causeRootsFor } from './utils/causeRootsFor'
import {
  completeBindingPlace,
  type CompletedBindingPlace,
} from './utils/completeBindingPlace'
import { configuredConditionHint } from './utils/configuredConditionHint'
import { configuredDomExpression } from './utils/configuredDomExpression'
import { configuredScrollExpression } from './utils/configuredScrollExpression'
import { configuredStopFields } from './utils/configuredStopFields'
import { configuredStops } from './utils/configuredStops'
import { continuationReceipts } from './utils/continuationReceipts'
import { createBindingLineRule } from './utils/createBindingLineRule'
import { createBundleVerifier } from './utils/createBundleVerifier'
import {
  createNextPagesDiscoveryCache,
  type NextPagesDiscoveryCache,
} from './utils/createNextPagesDiscoveryCache'
import { cutCauseForDisplay } from './utils/cutCauseForDisplay'
import { deadlineText } from './utils/deadlineText'
import { declarationStatementEndLine } from './utils/declarationStatementEndLine'
import { declaredAndArmedPlace } from './utils/declaredAndArmedPlace'
import { declaredInspectionBindings } from './utils/declaredInspectionBindings'
import { describeCdpPause } from './utils/describeCdpPause'
import { describeNextLaunchFailure } from './utils/describeNextLaunchFailure'
import { elapsedMsSince } from './utils/elapsedMsSince'
import { bundleOfEvaluatedModule } from './utils/extractDevelopmentModule'
import { findUnmappedDeclaredStop } from './utils/findUnmappedDeclaredStop'
import { formatRefusalFailure } from './utils/formatRefusalFailure'
import { inspectConfiguredValues } from './utils/inspectConfiguredValues'
import { isBlankOrCommentLine } from './utils/isBlankOrCommentLine'
import { isFrameAtPosition } from './utils/isFrameAtPosition'
import type { GeneratedPosition } from './utils/isGeneratedPositionBefore'
import { isHotUpdateScriptUrl } from './utils/isHotUpdateScriptUrl'
import { isModuleEntryPause } from './utils/isModuleEntryPause'
import { isModuleInAnotherLayer } from './utils/isModuleInAnotherLayer'
import { isPageStubOfSource } from './utils/isPageStubOfSource'
import { isPauseAtBoundColumn } from './utils/isPauseAtBoundColumn'
import { isPauseAtStop, type PauseStopTarget } from './utils/isPauseAtStop'
import { isPauseInScript } from './utils/isPauseInScript'
import { isRefreshedFrameAtStop } from './utils/isRefreshedFrameAtStop'
import { isSameGeneratedPosition } from './utils/isSameGeneratedPosition'
import { launchDevelopmentServer } from './utils/launchDevelopmentServer'
import { maskLearnerSecretText } from './utils/maskLearnerSecretText'
import { maskNextServerOutput } from './utils/maskNextServerOutput'
import { maskSourceMapText } from './utils/maskSourceMapText'
import {
  nextEntryLeftMessage,
  type NextEntryLeftMoment,
} from './utils/nextEntryLeftMessage'
import { nextPathnameOf } from './utils/nextPathnameOf'
import { nextServedChunkFetcher } from './utils/nextServedChunkFetcher'
import { nextServerOnlyFileReason } from './utils/nextServerOnlyFileReason'
import { nextServerOnlyStopMessage } from './utils/nextServerOnlyStopMessage'
import { OperationAfterTimeoutError } from './utils/operationAfterTimeoutError'
import {
  browserOriginOf,
  isOwnedApplicationOrigin,
  loopbackOriginsOf,
} from './utils/ownedApplicationOrigin'
import {
  pagePauseUnderResumeText,
  type PagePauseUnderResume,
} from './utils/pagePauseUnderResumeText'
import { pausePlace } from './utils/pausePlace'
import { placeAfterDeclaringLine } from './utils/placeAfterDeclaringLine'
import { preparedInputsOf } from './utils/preparedInputsOf'
import { prepareRepositoryInputs } from './utils/prepareRepositoryInputs'
import { readDeclaredDevelopmentPort } from './utils/readDeclaredDevelopmentPort'
import { readDevelopmentBundle } from './utils/readDevelopmentBundle'
import {
  readNextPagesState,
  type NextPagesState,
} from './utils/readNextPagesState'
import { readNextRouteManifests } from './utils/readNextRouteManifests'
import { readNextRouterKind } from './utils/readNextRouterKind'
import { readNextServerOnlyReason } from './utils/readNextServerOnlyReason'
import { readPagesDevelopmentBundle } from './utils/readPagesDevelopmentBundle'
import { readNextInstallation } from './utils/readRepositoryAdapterReadiness'
import { redactNextEntryPath } from './utils/redactNextEntryPath'
import { redactPreparedConfiguration } from './utils/redactPreparedConfiguration'
import type { PreparedTextState } from './utils/redactPreparedTexts'
import { resolveArmedPlace } from './utils/resolveArmedPlace'
import {
  resolveNextPagesEntry,
  type NextPagesEntry,
} from './utils/resolveNextPagesEntry'
import { sameScriptUrl } from './utils/sameScriptUrl'
import { sanitizeCause } from './utils/sanitizeCause'
import { selfDeclaredInspectionHint } from './utils/selfDeclaredInspectionHint'
import type { MappedPositionsScan } from './utils/sourceMapMappedPositions'
import {
  startIpv6LoopbackForwarder,
  type Ipv6LoopbackForwarder,
} from './utils/startIpv6LoopbackForwarder'
import { takenStopPosition } from './utils/takenStopPosition'
import { thrownMessage } from './utils/thrownMessage'
import { withFinalPeriod } from './utils/withFinalPeriod'
import {
  withUnannouncedPauses,
  type UnannouncedPausePlace,
} from './utils/withUnannouncedPauses'
import { VITE_DEV_ADAPTER } from './viteDevAdapter'
import {
  viteRefusal,
  viteReloadText,
  viteResealFailureSentence,
  viteSetupDeadlineSentence,
  viteSetupDeadlineText,
} from './viteRefusals'

/**
 * Seals one browser stop of a Next Pages run from the chunks the page loads at start, before the browser opens, so the debugger binds it when the page's scripts are parsed.
 *
 * Why it exists: a Pages page has no App client-reference manifest, so the App seal ({@link readDevelopmentBundle}) cannot find its modules; the page's and `_app`'s entry chunks hold them. Called by the Next adapter's `readBundle` when the request carries the Pages route; the run's one discovery cache is shared by its stops, and a listed chunk with no file is read from the owned server ({@link nextServedChunkFetcher}).
 * @param request - The stop's seal request.
 * @param nextRoute - The resolved Pages route and the run's discovery cache.
 * @returns The sealed module and what its discovery measured.
 * @throws `NEXT_STOP_NOT_SEALED` when no entry chunk holds the module (a module loaded later, for example through `next/dynamic`); the seal's own failures unchanged.
 * @example
 * await readNextPagesStopBundle(request, { route: '/', cache }) // => { bundle: { scriptUrl: 'webpack-internal:///(pages-dir-browser)/./src/pages/index.tsx', … }, discovery: { … } }
 */
async function readNextPagesStopBundle(
  request: DevelopmentBundleRequest,
  nextRoute: NonNullable<DevelopmentBundleRequest['nextRoute']>,
): Promise<DevelopmentBundle> {
  const sealed = await readPagesDevelopmentBundle({
    workspace: request.workspace,
    selected: request.source,
    route: nextRoute.route,
    signal: request.signal,
    cache: nextRoute.cache,
    fetchChunk: nextServedChunkFetcher(request.ownedOrigin),
  })
  if (sealed.kind === 'sealed')
    return { bundle: sealed.bundle, discovery: sealed.discovery }
  throw nextRefusal(
    'NEXT_STOP_NOT_SEALED',
    `${request.source.path} is not in the code the page ${redactNextEntryPath(sealed.route)} loads at start; a module loaded later (for example through next/dynamic) cannot be sealed before input.`,
  )
}

/**
 * The Next webpack development server behind {@link DevelopmentServerAdapter}: today's workspace check, port reading, launch, `.next/dev` bundle sealing and webpack source-map paths; a browser stop of a Pages run is sealed from the page's entry chunks ({@link readNextPagesStopBundle}).
 * Selected by {@link developmentServerAdapterOf} for `adapter: "next-dev-webpack"`.
 */
const NEXT_DEV_WEBPACK_ADAPTER: DevelopmentServerAdapter = {
  name: 'next-dev-webpack',
  async assertWorkspace(workspace, _node, signal) {
    try {
      await assertDevelopmentWorkspace(workspace, signal)
    } catch (error) {
      // A Vite app without Next is told which adapter to use instead of "install Next".
      await refuseViteMisroute(workspace)
      throw error
    }
  },
  async start(request) {
    const declaredPort = await readDeclaredDevelopmentPort(request.workspace)
    request.onDeclaredPort(declaredPort)
    await request.assertPortFree(declaredPort)
    request.alive()
    const app = launchDevelopmentServer(
      request.workspace,
      request.node,
      request.record,
      request.inspectServer,
      declaredPort.port,
      undefined,
      request.outputMask,
    )
    request.onApp(app)
    return { app, port: declaredPort.port }
  },
  // Next has no dependency optimizer that reloads the page by itself.
  waitForServerSettled: async () => undefined,
  async readOwnedLock(workspace) {
    // The lock's identity is read with exact numbers: a file id can be larger than a number holds exactly.
    const developmentLock = await lstat(join(workspace, '.next/dev/lock'), {
      bigint: true,
    }).catch((error) => {
      if (error.code === 'ENOENT') return undefined
      throw error
    })
    if (developmentLock?.isFile() && !developmentLock.isSymbolicLink())
      return { dev: developmentLock.dev, ino: developmentLock.ino }
    return undefined
  },
  readBundle: (request) =>
    // A browser stop of a Pages run is sealed from the page's entry chunks; every other stop as before.
    request.nextRoute && request.execution === 'browser'
      ? readNextPagesStopBundle(request, request.nextRoute)
      : readDevelopmentBundle(
          request.workspace,
          request.source,
          request.signal,
          request.entryPath,
          request.execution,
        ),
  browserDebugFields: (workspace) => ({
    webRoot: workspace,
    sourceMaps: true,
    sourceMapPathOverrides: { 'webpack://_N_E/./*': `${workspace}/*` },
  }),
  isScriptOfModule: (sealedUrl, announcedUrl) =>
    sameScriptUrl(sealedUrl, announcedUrl),
}

/**
 * Chooses the adapter record a configuration's `adapter` names, for {@link ConfiguredBrowserRun.prepareOwned}.
 * @param name - The configuration's `adapter`.
 * @returns The adapter record.
 * @example
 * ```ts
 * developmentServerAdapterOf('next-dev-webpack').name // 'next-dev-webpack'
 * ```
 */
function developmentServerAdapterOf(
  name: DevelopmentServerAdapterName,
): DevelopmentServerAdapter {
  return DEVELOPMENT_SERVER_ADAPTERS[name]
}

const DEVELOPMENT_SERVER_ADAPTERS: Record<
  DevelopmentServerAdapterName,
  DevelopmentServerAdapter
> = {
  'next-dev-webpack': NEXT_DEV_WEBPACK_ADAPTER,
  'vite-dev': VITE_DEV_ADAPTER,
}

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
/** One script a runtime parsed for a declared stop's module: the sealed one, or the same module loaded for another webpack layer ({@link PreparedStop.instances}), each with the map that places its own generated code. */
type StopModule = {
  bundle: BundleSource
  verifier: ReturnType<typeof createBundleVerifier>
  script?: Protocol.Debugger.ScriptParsedEvent
}
/** An accepted instance of a declared stop's module for another webpack layer: its own bundle and map, and the column its map puts the stop's bound statement at, found once per binding ({@link ConfiguredBrowserRun.boundColumnIn}). */
type StopInstance = StopModule & {
  script: Protocol.Debugger.ScriptParsedEvent
  boundColumn?: { line: number; column: number; instanceColumn: number }
}
type PreparedStop = ReturnType<typeof configuredStops>[number] & {
  bundle: BundleSource
  verifier: ReturnType<typeof createBundleVerifier>
  script?: Protocol.Debugger.ScriptParsedEvent
  /** The same module as the runtime parsed it for other webpack layers, by script id, once each was read and found to map onto the frozen original ({@link ConfiguredBrowserRun.adoptInstance}); a server stop's line can run in any of them, not only in the sealed one. */
  instances: Map<string, StopInstance>
  /** The scripts of the stop's module for other layers that are not usable (yet), by script id: the text is still being read, or the instance was refused with the reason. A pause held in one fails with a sentence that names it ({@link ConfiguredBrowserRun.unusableInstanceFailure}). A newer script of the same address replaces the entry. */
  unusableInstances: Map<string, { url: string; reason: string }>
  breakpoint?: OwnedRepositoryBreakpoint
  /** The one scan of the stop's sealed map, from its declared line to the end of its citation; {@link resolveArmedPlace}, {@link createBindingLineRule} and the preparation refusal read it instead of the map. */
  scan: MappedPositionsScan
  /** Where the stop's breakpoint is requested ({@link resolveArmedPlace}): the declared position, or the first mapped position after a declared line that has none or that declares a binding the stop requires ({@link ConfiguredBrowserRun.requestAfterSelfDeclaringLine}). */
  armed: { line: number; column: number }
  /** The first line the stop may be requested on: the declared line, or the line after the statement it begins when that statement declares a binding the stop requires ({@link ConfiguredBrowserRun.requestAfterSelfDeclaringLine}); {@link ConfiguredBrowserRun.confirmRequestedPlace} searches the debugger's break locations from it. */
  earliestRequestLine: number
  /** The place of the stop's first request, kept once {@link ConfiguredBrowserRun.rearmOnRequestedLine} requested the stop a second time, so a text can say which column the second request replaced. */
  firstRequest?: { line: number; column: number }
  /** The debugger's verified binding, on the declared line or on a later line {@link PreparedStop.acceptsBoundLine} accepts; every later check, the saved observation and the display use it instead of the requested position. */
  bound?: { line: number; column: number }
  /** Tells whether a line the debugger chose is this stop's place, measured from the line the stop is requested on ({@link createBindingLineRule}): the lines from the declared to the requested one, or a later line within the stop's citation with no mapped line between it and the requested line. Every site that compares a binding or a pause with this stop asks it. */
  acceptsBoundLine: (line: number) => boolean
  /** Names the condition that refuses a line as this stop's place, for the failure an agent reads; `undefined` for an accepted line. */
  bindingRefusal: (line: number) => string | undefined
  /** The binding the stop's rule was last built for from the debugger's break locations, with the generated place taken for it ({@link ConfiguredBrowserRun.rebuildRuleFromBreakLocations}); a pause on that line at another generated place is judged once more, and a refusal of that same binding at that same place stands without the debugger being asked again. `generated` is absent when the generated places were not known; the field is absent while the map's rule stands. */
  judgedBinding?: {
    line: number
    column: number
    generated?: GeneratedPosition
  }
}
/**
 * Names the bindings of a stop's required inspections that its own declared line declares; called by {@link ConfiguredBrowserRun.requestAfterSelfDeclaringLine} at preparation.
 * @param stop - The declared stop, as {@link configuredStops} gives it.
 * @param lines - The lines of the stop's sealed source.
 * @returns The bindings ({@link declaredInspectionBindings}); `[]` when the line declares none of them or the source has no such line.
 * @example
 * requiredBindingsDeclaredOn(stop, ['const nextTheme = "dark";']) // => ['nextTheme'] for value:nextTheme required on line 1
 */
function requiredBindingsDeclaredOn(
  stop: ReturnType<typeof configuredStops>[number],
  lines: readonly string[],
): string[] {
  return declaredInspectionBindings(
    lines[stop.source.line - 1] ?? '',
    stop.inspections
      .filter((inspection) => inspection.required)
      .map((inspection) => inspection.path),
  )
}
/** What a server stop's registration says when a deadline expires; a refusal keeps the reason the registration read threw, so the deadline text can pass it on, and the place when the adapter moved the breakpoint to a line the stop's rule refuses. */
/** The wait {@link ConfiguredBrowserRun.completeOperation} is in, which decides how the run's deadline words its failure. */
type OperationWait = 'pauses' | 'after' | 'run-after'

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
    /** The declared server stop the run was resuming the page for when it took this pause as its own (a page pause read while a resume of the run's own had no answer, {@link ConfiguredBrowserRun.ownPagePauseUnderResume}): its resume is then nobody else's, however long the adapter takes to answer. */
    resumedByRun?: PreparedStop
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
// The click step's scroll answers only whether it scrolled; any other answer reads as no scroll.
const scrollResultSchema = z.object({ scrolled: z.boolean() })
const domResultSchema = z.object({
  ready: z.boolean(),
  x: z.number().finite().optional(),
  y: z.number().finite().optional(),
  failure: configuredDomFailureSchema.optional(),
  textReadings: configuredTextReadingsSchema.optional(),
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
/** A server stop's owned breakpoint as the editor answers it at the stop's pause: verified, under the adapter's id, on its line and, when the editor kept it, at its column. */
const pausedServerBindingSchema = verifiedLineSchema.extend({
  id: z.number().int(),
  source: z.object({ path: z.string().optional() }).optional(),
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
  /** The adapter of the configuration, chosen at the start of preparation. */
  private adapter?: DevelopmentServerAdapter
  /** The setup step reached, named when the setup deadline expires. */
  private setupStep: ViteSetupStep = VITE_SETUP_STEPS.validatingProject
  /** When the setup budget ends (epoch milliseconds); bounds the wait for the Vite dependency optimizer. */
  private preparationDeadlineAt = 0
  /** The length of the setup budget (milliseconds), named by the setup-deadline refusal. */
  private preparationBudgetMs = 0
  /** Whether the run asked its browser to open the entry page; only then is a page load a reload. */
  private navigationRequested = false
  /** Whether the first load of the entry page was seen. */
  private firstNavigationSeen = false
  /** Whether the initial inputs are being or were written, after which a page load ends the run. */
  private inputsPrepared = false
  /** How many reloads before the inputs started a new page generation (a Vite dependency-optimizer reload). */
  private pageGeneration = 0
  /** The page generation the stops' current seals were read for (0 after the first seal); {@link waitForStablePage} seals again when the stable page is a later one. */
  private sealedGeneration = 0
  private preparation?: Promise<void>
  private cleanupPromise?: Promise<void>
  /** The sealed part of the manifest; the configuration and its hash are added by {@link currentManifest} from the redacted form. */
  private sealedManifest?: Omit<
    NonNullable<ConfiguredRuntimeView['manifest']>,
    'hash' | 'configuration' | 'configurationHash'
  >
  /**
   * Gate every stored image passes once a secret operation was sent (ENG-5). Inert until the operation engine arms it; its failure fails the run with `SECRET_BECAME_VISIBLE`.
   */
  readonly secretFrameGate = new SecretFrameGate({
    evaluate: async (expression, timeoutMs) => {
      // Quiet, and marked: the gate's many queries are neither journaled one by one nor listed as observed scripts; it journals its own summary.
      const answer = await this.requireCdp().requestQuietly(
        'Runtime.evaluate',
        {
          expression: `${expression}\n//# sourceURL=${SECRET_FRAME_SOURCE_URL}`,
          returnByValue: true,
        },
        timeoutMs,
      )
      return answer.result.value
    },
    onFailure: (reason) => this.failSecretVisible(reason),
    onSummary: (summary) =>
      this.evidence.record('secret-frame.summary', summary),
  })
  /** Where each prepared text stands; the real texts never leave {@link definition}'s memory. */
  private readonly preparedStates: PreparedTextState[] = []
  private continuation?: Continuation
  private acceptedStop = false
  private stopIndex = 0
  private readonly snapshots: ConfiguredRuntimeSnapshot[] = []
  /** The bundle each committed snapshot ran in, by snapshot id: the sealed module's, or another layer's instance whose generated code and map differ ({@link source}, F565). */
  private readonly snapshotBundles = new Map<string, BundleSource>()
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
    /** The declared server stop the run was resuming the page for when it took this pause as its own and cleared its timer ({@link ownPagePauseUnderResume}). */
    resumedByRun?: PreparedStop
  }
  /** The resumes of a page pause at a server stop's breakpoint the run itself has under way, oldest first, each by the declared server stop its `stopped` named: one more for each `continue` the run sends, one fewer once the debugger answered that request or the request failed ({@link resumeServerBreakpointInBrowser}, {@link pageResumeEnded}). While one is under way a page pause read meanwhile is taken as the run's own, whichever of the two channels was read first, and is not bounded as a pause nobody owns ({@link ownPagePauseUnderResume}). A resume of the page does not end one: the debugger pauses the page at the first position of the module for itself and resumes it before the pause at the breakpoint, so the page's next resume need not be the one the run asked for. */
  private readonly pageResumesUnderWay: PreparedStop[] = []
  /** The last resume of a page pause at a server stop's breakpoint that the debugger answered, with the run clock at that answer: the page's own events can be read after the answer, so a page pause in the stub of that stop's module that is read within the debugger's bound of the answer is still taken as that resume's ({@link answeredResumeOfOpenPause}). */
  private answeredPageResume?: { stop: PreparedStop; answeredAtMs: number }
  /** How many pauses away from the expected stop were observed; the journal names only the first {@link REPOSITORY_ADAPTER_PAUSE_JOURNAL_LIMIT} of them. */
  private offStopPauseCount = 0
  /** How many instrumentation pauses of the runtime were observed; they are journaled under the same limit, counted apart, so they leave the pauses the debugger makes for itself their room in the journal. */
  private instrumentationPauseCount = 0
  /** How many idle `continued` events were read; journaled under the same cap. */
  private idleContinuedCount = 0
  /** How many pauses, resumes of pauses that were only counted and idle `continued` events past their caps were left out of the journal; cleanup journals the count. */
  private unjournaledAdapterEvents = 0
  /** How many `stop.module-parsed`, `stop.instance-sealed` and `stop.instance-refused` entries were journaled, by type, against {@link REPOSITORY_STOP_MODULE_JOURNAL_LIMIT}. */
  private readonly stopModuleJournaled = new Map<string, number>()
  /** The entries ({@link ConfiguredBrowserRun.journalStopModule}) already journaled once for an entry type, stop and script address, so the first of each is journaled past the cap. */
  private readonly stopModuleFirstJournaled = new Set<string>()
  /** How many first entries were journaled past the cap, against {@link REPOSITORY_STOP_MODULE_FIRST_JOURNAL_BEYOND_LIMIT} (F473). */
  private stopModuleFirstBeyondLimit = 0
  /** How many of those entries past the cap were only counted; cleanup journals the count. */
  private unjournaledStopModuleEvents = 0
  /** The order in which a runtime announced the scripts of declared stops' modules, by participant and script id, so an older read's end never removes a newer accepted script of the same address ({@link adoptInstance}, F476). */
  private readonly scriptAnnouncements = new Map<string, number>()
  /** How many scripts were announced so far; the next announcement's order. */
  private scriptAnnouncementCount = 0
  /** The reads of script texts in flight, by participant and script id, so the stops of one module share a read ({@link instanceTextOf}). */
  private readonly instanceTexts = new Map<string, Promise<string>>()
  /** What the after conditions last answered while they did not hold, so the run's own deadline, which ends the after wait first, can still name the condition and its hint ({@link afterDeadlineReason}). */
  private lastAfterFailure?: ConfiguredDomFailure
  /** What the current operation's own after conditions last answered while they did not hold, for the same reason as {@link lastAfterFailure} ({@link operationAfterDeadlineText}). */
  private lastOperationAfterFailure?: ConfiguredDomFailure
  /** The phases whose text conditions were journaled as held on one of several elements; each phase is journaled once ({@link journalTextReadings}). */
  private readonly journaledTextReadingPhases = new Set<'before' | 'after'>()
  private progressTimer?: ReturnType<typeof setTimeout>
  /** True while {@link progressTimer} is the pause hold, the only deadline {@link renewPauseHold} may restart. */
  private holdingPause = false
  private runTimer?: ReturnType<typeof setTimeout>
  private cleaning = false
  private cleaned = false
  private resourcesReleased = false
  /** True from the completion of the run until its final save of its events and run record settled ({@link observeAfter}); read through {@link isSavingCompletion}. */
  private savingCompletion = false
  private status = 'preparing'
  private origin?: string
  /** Where the app's port was declared, reported beside the origin so a default is visible. */
  private portSource?: string
  /** The Vite version the launcher reported, for a `vite-dev` run. */
  private viteVersion?: string
  /** The Next setup step reached; a Pages run's setup deadline names it ({@link setupDeadlineText}). The Vite step stays in {@link setupStep}. */
  private nextSetupStep: NextSetupStep = NEXT_SETUP_STEPS.validatingProject
  /** The Pages route of a Next run on the Pages path, with the run's one discovery cache; set once the entry path resolved as a Pages route. The setup-deadline text, the seal and the Pages-only checks read it; every other run leaves it unset. */
  private pagesRun?: NextPagesEntry & { cache: NextPagesDiscoveryCache }
  /** True once the workspace is known to have a Pages folder, before its entry resolved: a setup deadline then names `NEXT_SETUP_DEADLINE` unless the entry resolved as an App route ({@link setupDeadlineText}). */
  private pagesCapable = false
  /** The route a Next run in a workspace with a Pages folder resolved its entry path to, for the run resource. */
  private nextRoute?: ConfiguredRuntimeView['nextRoute']
  /** What the router wait of a Pages run saw: `absent` until `window.next.router` exists, `late` once it was seen; the setup-deadline text reads it. */
  private nextRouterState?: NextRouterState
  /** The selector of the initial input being written, which a setup deadline at the input step names. */
  private pendingInputSelector?: string
  /** Whether an initial input's text was sent and the page's answer has not come back, so a deadline then cannot tell whether it was written. */
  private inputInFlight = false
  /** Masks env-file and script values, and secret shapes, in captured values ({@link inspectConfiguredValues}); absent for a Next run. */
  private maskText?: (text: string) => string
  /**
   * Hides what a text may hold of a secret: env-file values and secret shapes first, then every value the learner typed (ENG-4).
   * Passed as the masking of inspection values and debugger previews, and used for failures and Output lines.
   * @param text - Any text the run stores or serves.
   * @returns The masked text.
   * @example this.maskRunText('Login failed for hunter2') // => 'Login failed for [masked]'
   */
  private readonly maskRunText = (text: string): string =>
    maskLearnerSecretText(
      this.maskText?.(text) ?? text,
      this.learnerSecretValues,
    )
  /** Masks only env-file and script values in the module text a Vite run keeps ({@link archivedModuleText}); absent for a Next run. */
  private maskModuleText?: (text: string) => string
  /** The masked copy of each bundle, kept so a read does not mask the same module again; a re-sealed bundle is a new object, so its entry is never stale. */
  private readonly archivedModules = new WeakMap<
    BundleSource,
    ReturnType<ConfiguredBrowserRun['archivedModuleText']>
  >()
  /** Codebook's listener on `[::1]:<port>` (D66), closed with the run. */
  private ipv6Forwarder?: Ipv6LoopbackForwarder
  /** Whether `[::1]` at the port is the run's own, so the origin checks accept it. */
  private ownsIpv6Loopback = false
  private operation?: ConfiguredRuntimeView['operation']
  /** The version 3 configuration of this run; absent for versions 1 and 2, whose single action keeps its own path. */
  private readonly operationsConfiguration?: OperationsRepositoryConfiguration
  /** The progress of each declared operation of a version 3 run, in declared order. */
  private readonly operationRecords: OperationRecord[] = []
  /** How many operations `action` reserved; the next one is `operationsAccepted + 1`. */
  private operationsAccepted = 0
  /** How many operations had their first input event sent; a stop declared `afterOperation: k` is armed once this reaches `k`. */
  private operationsDispatched = 0
  /** Whether {@link armSecretGate} is waiting for the gate to arm; a failure of the gate then becomes that operation's own not-sent refusal. */
  private armingSecretGate = false
  /** The operation each `action` key reserved, so a repeat of a key finds its operation. */
  private readonly operationIndexByKey = new Map<string, number>()
  /** The id and the key of each reserved operation, in order. */
  private readonly operationIds: string[] = []
  private readonly operationKeys: string[] = []
  /** The operations whose completion was started, so each is completed once. */
  private readonly operationsSettling = new Set<number>()
  /** The journal clock of the page's last main-frame navigation; the settle wait reads it. */
  private lastNavigationAtMs = Number.NEGATIVE_INFINITY
  /** The stops whose breakpoint was requested: a version 3 stop is armed in its operation's turn, never earlier. */
  private readonly armedStops = new Set<PreparedStop>()
  private operationFailure?: OperationFailure
  /** The secrets the learner typed for `secret: "ask-learner"` operations: in memory only, never persisted or served; the sinks that mask exact occurrences read it through {@link learnerSecrets}. */
  private readonly learnerSecretValues = new Set<string>()

  /**
   * Gives the secrets the learner typed for ask-learner operations, for the sinks that mask every exact occurrence of them (ENG-4).
   * The set lives in memory for the run's life and is never persisted, logged or served.
   * @returns The learner's secrets so far; empty for a run without an ask-learner operation.
   * @example for (const secret of run.learnerSecrets) text = text.replaceAll(secret, '[masked]')
   */
  get learnerSecrets(): ReadonlySet<string> {
    return this.learnerSecretValues
  }
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
    const configuration = this.definition.configuration
    if (configuration.version === OPERATIONS_CONFIG_VERSION) {
      this.operationsConfiguration = configuration
      for (const [index, operation] of configuration.operations.entries())
        this.operationRecords.push({
          index: index + 1,
          kind: operation.kind,
          title: operation.title,
          state: 'not-run',
          ack: 'pending',
          valueCheck: operation.kind === 'click' ? 'n/a' : 'pending',
          effect: 'pending',
        })
    }
    this.evidence = new Evidence(join(options.directory, this.id), {
      maxEvents: MAX_EVENTS,
      retainedBytes: MAX_RETAINED_EVENT_BYTES,
      queuedBytes: MAX_QUEUED_EVIDENCE_BYTES,
    })
    // Every journal event and saved JSON file hides the learner's secrets by value (ENG-4).
    this.evidence.learnerSecrets = () => this.learnerSecretValues
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
    this.browser.setSecretFrameGate(this.secretFrameGate)
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
    this.preparationDeadlineAt = preparationDeadlineAt
    this.preparationBudgetMs = preparationDeadlineAt - now
    // The text is read at expiry: a Next run learns only after its route manifests whether it is a Pages run.
    this.progressDeadline(preparationDeadlineAt - now, () =>
      this.setupDeadlineText(preparationDeadlineAt - now),
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
    const adapter = developmentServerAdapterOf(
      this.definition.configuration.adapter,
    )
    this.adapter = adapter
    await adapter.assertWorkspace(
      this.options.workspace,
      this.options.node,
      this.abort.signal,
    )
    this.alive()
    const needsServer = configuredStops(this.definition.configuration).some(
      (stop) => stop.participant === 'server',
    )
    // Only a Next workspace with a Pages folder takes the structured entry check and the route manifests; every other run keeps today's readiness.
    const hasPagesFolder = await this.hasNextPagesFolder(adapter)
    this.pagesCapable = hasPagesFolder
    this.alive()
    this.nextSetupStep = NEXT_SETUP_STEPS.startingNext
    // The app runs on the port the project declares (its auth origin points there); a busy port refuses the start instead of moving the app.
    const started = await adapter.start({
      ...(hasPagesFolder ? { outputMask: maskNextServerOutput } : {}),
      workspace: this.options.workspace,
      node: this.options.node,
      record: (type, detail) => this.evidence.record(type, detail),
      inspectServer: needsServer,
      signal: this.abort.signal,
      alive: () => this.alive(),
      assertPortFree: (declared, refuse) =>
        assertDevelopmentPortFree(declared, {
          signal: this.abort.signal,
          ...(refuse ? { refuse } : {}),
        }),
      onStep: (step) => {
        this.setupStep = step
      },
      onDeclaredPort: (declared) => {
        this.portSource = declared.source
      },
      onApp: (app) => {
        this.app = app
      },
    })
    this.viteVersion = started.viteVersion
    this.maskText = started.maskText
    this.maskModuleText = started.maskModuleText
    const declaredPort = { port: started.port }
    // The server binds 127.0.0.1; the browser opens `localhost` at its port, the name the project's own origin settings use (D65).
    this.setupStep = VITE_SETUP_STEPS.waitingForServer
    this.nextSetupStep = NEXT_SETUP_STEPS.waitingForServer
    const ownedOrigin = hasPagesFolder
      ? await this.readyPagesCapableEntry(started.port)
      : await this.app!.ready(
          this.abort.signal,
          this.definition.configuration.entryPath,
        )
    this.origin = browserOriginOf(ownedOrigin)
    // `localhost` may resolve to ::1: Codebook owns that endpoint for the whole run, or the host has none (D66).
    this.ipv6Forwarder = await startIpv6LoopbackForwarder(declaredPort.port)
    this.ownsIpv6Loopback = this.ipv6Forwarder !== undefined
    this.alive()
    this.ownedDevelopmentLock = await adapter.readOwnedLock(
      this.options.workspace,
    )
    this.setupStep = VITE_SETUP_STEPS.sealingStops
    this.nextSetupStep = NEXT_SETUP_STEPS.sealingStops
    for (const [index, stop] of configuredStops(
      this.definition.configuration,
    ).entries())
      this.stops.push(
        await this.sealDeclaredStop(stop, index, adapter, ownedOrigin),
      )
    // A Pages stop whose line its browser module does not map is refused with what is established about that line, before the general check.
    if (this.pagesRun) await this.refuseUnmappedPagesStop(this.pagesRun)
    this.freezeSealedStops()
    if (needsServer) await this.selectServer()
    this.alive()
    this.setupStep = VITE_SETUP_STEPS.openingBrowser
    this.nextSetupStep = NEXT_SETUP_STEPS.openingBrowser
    await this.browser.launch(
      {
        name: `codebook repository ${this.id}`,
        type: 'pwa-chrome',
        request: 'launch',
        url: 'about:blank',
        ...adapter.browserDebugFields(this.options.workspace),
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
        source: `if(${JSON.stringify(loopbackOriginsOf(this.origin, this.ownsIpv6Loopback))}.includes(location.origin))for(const entry of ${JSON.stringify(storage)})localStorage.setItem(entry.key,entry.value);`,
      })
      this.alive()
    }
    this.setupStep = VITE_SETUP_STEPS.loadingEntryPage
    this.nextSetupStep = NEXT_SETUP_STEPS.loadingEntryPage
    this.navigationRequested = true
    await cdp.request('Page.navigate', {
      url: `${this.origin}${this.definition.configuration.entryPath ?? '/'}`,
    })
    this.alive()
    await this.waitForDom('before')
    this.alive()
    // A Pages page must still be at its entry path, with its router ready on the resolved route.
    if (this.pagesRun) await this.confirmPagesEntryAfterLoad(this.pagesRun)
    // Vite's dependency optimizer may reload the page once after the first load; each reload before the inputs starts a new page generation.
    if (adapter.name === 'vite-dev') {
      this.setupStep = VITE_SETUP_STEPS.settlingPage
      await this.waitForStablePage(adapter, ownedOrigin)
    }
    this.setupStep = VITE_SETUP_STEPS.writingInputs
    this.nextSetupStep = NEXT_SETUP_STEPS.writingInputs
    const inputs = this.preparedInputs()
    // A Pages page can still leave its entry path on the client after its router was ready; nothing is written then.
    if (this.pagesRun && inputs.length)
      await this.refusePagesPathLeft('before-input')
    // A page load after this point is a reload the run did not make: the inputs may already be in the page.
    this.inputsPrepared = true
    await prepareRepositoryInputs(
      cdp,
      inputs,
      loopbackOriginsOf(this.origin, this.ownsIpv6Loopback),
      () => this.alive(),
      {
        started: (selector) => {
          this.pendingInputSelector = selector
        },
        inserting: (inFlight) => {
          this.inputInFlight = inFlight
        },
        classified: async (index, secret, selector, passwordControl) => {
          // Fixed before the text is sent, so no later write holds a secret text.
          this.preparedStates[index] = secret ? 'secret' : 'plain'
          // A secret text into a password input arms the frame gate before it is sent, as an ask-learner operation does; into any other control the browser draws it as typed, as in 0.2.70.0, so it is masked by state and value only.
          if (secret && passwordControl)
            await this.armPreparedSecretGate(selector, inputs[index]!.text)
          else if (
            secret &&
            inputs[index]!.text.length >= SECRET_FRAME_VALUE_COPY_MIN_CHARS
          )
            this.learnerSecretValues.add(inputs[index]!.text)
        },
      },
    )
    this.pendingInputSelector = undefined
    this.alive()
    if (inputs.length)
      this.evidence.record('inputs.prepared', { count: inputs.length })
    // Every declared input is written: a deadline from here names arming the first stop, not an input.
    this.nextSetupStep = NEXT_SETUP_STEPS.armingFirstStop
    // Only the next expected stop is armed: a later stop's line may run before its turn and must not pause then. {@link continue} arms each later stop.
    // A version 3 stop is armed in its operation's turn: a first stop declared after a later operation waits for that operation's dispatch.
    if (this.isStopDueBy(this.stops[0]!, 1)) {
      await this.armStop(this.stops[0]!)
      this.armedStops.add(this.stops[0]!)
    }
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
   * Reads and seals the module one declared stop runs in, and prepares everything the run derives from the sealed bytes (map scan, armed place, binding rule).
   *
   * Why it exists: the first seal happens once in {@link prepareOwned}; a Vite run seals again for each new page generation before the inputs ({@link resealStopsForGeneration}), because the dev server serves new `?v=` import hashes after a dependency-optimizer reload. Both go through the adapter's `readBundle`.
   * @param stop - The configured stop, as {@link configuredStops} gives it.
   * @param index - Its zero-based place among the declared stops.
   * @param adapter - The run's development-server adapter, whose `readBundle` reads the served module.
   * @param ownedOrigin - The origin the owned server reported, which the module is fetched from.
   * @param generation - The page generation a renewal belongs to; absent for the first seal. Only the first seal journals the position decisions of the stop (`breakpoint.column-on-blank-line`, `breakpoint.armed-after-self-declaring-line`), because a renewal reaches the same decisions again.
   * @returns The prepared stop for the freshly sealed bytes; its sealed files and journal entry are written.
   * @throws When the module cannot be sealed or the run is no longer alive.
   * @example
   * ```ts
   * this.stops.push(await this.sealDeclaredStop(stop, 0, adapter, ownedOrigin))
   * ```
   */
  private async sealDeclaredStop(
    stop: ReturnType<typeof configuredStops>[number],
    index: number,
    adapter: DevelopmentServerAdapter,
    ownedOrigin: string,
    generation?: number,
  ): Promise<PreparedStop> {
    // A Pages run observes only the page's client code: a server stop, a `_document` or an API route never runs there, so it is refused before its own chunks are read.
    if (this.pagesRun) this.refuseServerOnlyPagesStop(stop, this.pagesRun)
    const acquired = await adapter.readBundle({
      workspace: this.options.workspace,
      source: stop.source,
      signal: this.abort.signal,
      entryPath: this.definition.configuration.entryPath ?? '/',
      execution: stop.participant === 'server' ? 'server-action' : 'browser',
      ownedOrigin,
      record: (type, detail) => this.evidence.record(type, detail),
      ...(this.pagesRun
        ? {
            nextRoute: {
              route: this.pagesRun.route,
              cache: this.pagesRun.cache,
            },
          }
        : {}),
    })
    this.alive()
    const verifier = createBundleVerifier(acquired.bundle),
      citation = this.definition.descriptor.anchors[stop.anchorIndex]!
    // The sealed map is scanned once per stop, from its declared line to the end of its citation; the place, the rule and the refusal below read that scan, and the pause handler only compares lines.
    const scan = verifier.mappedPositions(stop.source.line, citation.endLine),
      // A renewal reaches the decisions of the first seal again, so only the first seal journals them.
      isFirstSeal = generation === undefined,
      taken = this.takeDeclaredPosition(stop, index, isFirstSeal),
      afterDeclaration = this.requestAfterSelfDeclaringLine(
        stop,
        acquired.bundle.source.split(/\r\n|\r|\n/),
        scan,
        citation.endLine,
        isFirstSeal,
      ),
      // A stop whose own line declares a binding it requires is requested after that declaration's statement; otherwise the debugger verifies no breakpoint on a line without a mapped position, so such a stop is requested at the first mapped position after it. The rule is measured from there.
      armed = afterDeclaration.armed ?? resolveArmedPlace(taken, scan)
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
      earliestRequestLine: afterDeclaration.earliestLine,
      acceptsBoundLine: bindingRule.accepts,
      bindingRefusal: bindingRule.refusal,
      instances: new Map(),
      unusableInstances: new Map(),
    }
    // A renewal keeps the first seal's files, so each journal entry names the bytes of its own files.
    const fileStem = isFirstSeal
      ? `sealed-${index}`
      : `sealed-${index}-generation-${generation}`
    await this.evidence.save(`${fileStem}-source.ts`, prepared.bundle.source)
    this.alive()
    const archivedModule = this.archivedModuleText(prepared.bundle)
    await this.evidence.save(
      `${fileStem}-module.js`,
      archivedModule.evidenceJavascript,
    )
    this.alive()
    await this.evidence.save(
      `${fileStem}-module.map.json`,
      archivedModule.sourceMap,
    )
    this.alive()
    this.evidence.record(
      generation === undefined ? 'source.sealed' : 'source.resealed',
      {
        index,
        ...(generation === undefined ? {} : { generation }),
        // The hashes below name the executed bytes; the saved copy is masked when this is true.
        redacted: archivedModule.redacted,
        participant: stop.participant,
        discovery: acquired.discovery,
        scriptUrl: prepared.bundle.scriptUrl,
        hashes: prepared.verifier.hashes,
      },
    )
    return prepared
  }

  /**
   * Binds the run's manifest to the first stop's current seal and refuses a stop that can never bind, after all stops are sealed or sealed again.
   * Called by {@link prepareOwned} after the first seal and by {@link resealStopsForGeneration} after each renewal, so the manifest always names the bytes that are checked.
   * @throws When a later stop's line has no mapped position in its sealed module.
   * @example
   * ```ts
   * this.freezeSealedStops()
   * ```
   */
  private freezeSealedStops(): void {
    const first = this.stops[0]!
    const { itemId, bookTitle, nodeTitle, anchors, citationContext } =
      this.definition.descriptor
    this.sealedManifest = {
      descriptor: { itemId, bookTitle, nodeTitle, anchors, citationContext },
      itemId,
      sourceHash: first.verifier.hashes.typescript,
      javascriptHash: first.verifier.hashes.javascript,
      mapHash: first.verifier.hashes.sourceMap,
      // Only a Vite run names its version, so a Next manifest and its hash are what they were.
      ...(this.viteVersion ? { viteVersion: this.viteVersion } : {}),
    }
    // Later stops are armed only in their turn, so a line that can never bind is refused here, before any application effect.
    const unmappedStop = this.unbindableStop()
    if (unmappedStop)
      throw this.bindingFailure(
        unmappedStop,
        `Declared stop ${this.declaredAt(unmappedStop)} has no mapped position on that line in the sealed module`,
      )
  }

  /**
   * Finds the first sealed stop whose declared line can never bind: its sealed map has no position on the line and no later place within its citation ({@link findUnmappedDeclaredStop}).
   * Called by {@link freezeSealedStops}, which refuses it, and before that by {@link refuseUnmappedPagesStop} for a Pages run, which names what is established about the line first.
   * @returns The stop, or `undefined` when every stop can bind.
   * @example
   * this.unbindableStop() // => the stop declared on a getStaticProps line its browser module does not map
   */
  private unbindableStop(): PreparedStop | undefined {
    return findUnmappedDeclaredStop(
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
  }

  /**
   * Seals every declared stop again for a new page generation, before the inputs are written.
   *
   * Why it exists: after Vite's dependency optimizer reloads the page, the dev server serves the stop modules with new `?v=` import hashes, so the bytes the new page executes differ from the first seal. Replacing the seals here lets the executed-bytes check guard the latest seal; once the inputs are written nothing is sealed again and a reload still refuses with `VITE_PAGE_RELOADED`.
   * Called by {@link waitForStablePage} for each generation it sees. The prepared stops are updated in place so a script the new page already announced stays bound.
   * @param generation - The page generation the renewal belongs to; journaled with each renewal.
   * @param adapter - The run's development-server adapter.
   * @param ownedOrigin - The origin the owned server reported.
   * @example
   * ```ts
   * await this.resealStopsForGeneration(this.pageGeneration, adapter, ownedOrigin)
   * ```
   */
  private async resealStopsForGeneration(
    generation: number,
    adapter: DevelopmentServerAdapter,
    ownedOrigin: string,
  ): Promise<void> {
    for (const [index, stop] of configuredStops(
      this.definition.configuration,
    ).entries()) {
      const renewed = await this.sealDeclaredStop(
        stop,
        index,
        adapter,
        ownedOrigin,
        generation,
      ).catch((error: unknown) => {
        // A renewal fails after the browser opened: the refusal says so and that one new start may pass, unlike a first seal.
        if (!(error instanceof StudyError) || error.code !== 'VITE_SEAL_FAILED')
          throw error
        throw viteRefusal(
          'VITE_SEAL_FAILED',
          viteResealFailureSentence(generation, error.message),
        )
      })
      Object.assign(this.stops[index]!, renewed)
    }
    this.freezeSealedStops()
  }

  /**
   * Treats a main-frame page load of a Vite run: a reload before the inputs starts a new page generation, a load after them ends the run.
   * Why: Vite's dependency optimizer can reload the page once after its first load. The stops' earlier script bindings belong to the old page, so they are discarded and bound again from the new parse (which is compared with the sealed bytes again before arming); once inputs may be in the page, a load makes the click's outcome unknown.
   * Called by the `Page.frameNavigated` observer of {@link observeParticipant}.
   * @param event - The navigation the page committed.
   * @example
   * ```ts
   * this.onPageNavigated(event) // the second load before inputs: pageGeneration becomes 1
   * ```
   */
  private onPageNavigated(event: Protocol.Page.FrameNavigatedEvent): void {
    // Only the run's own main frame, after the run asked for the entry page.
    if (this.cleaning || event.frame.parentId || !this.navigationRequested)
      return
    this.lastNavigationAtMs = performance.now()
    // A Next version 3 run follows client-side navigation, but a full document load before its last operation ends it; Vite keeps its own rule below.
    if (this.operationsConfiguration && this.adapter?.name !== 'vite-dev') {
      this.onOperationsNavigation()
      return
    }
    if (!this.firstNavigationSeen) {
      this.firstNavigationSeen = true
      return
    }
    if (this.inputsPrepared) {
      this.fail(viteReloadText(this.operation?.inputDispatched ?? false))
      return
    }
    this.pageGeneration += 1
    for (const stop of this.stops) stop.script = undefined
    this.evidence.record('page.generation-started', {
      generation: this.pageGeneration,
    })
  }

  /**
   * Waits until the page has stayed loaded for a quiet window with no further reload, called by {@link prepareOwned} for a Vite run before the inputs are written.
   * Before each quiet window it waits for the server's dependency optimizer to be idle ({@link DevelopmentServerAdapter.waitForServerSettled}), and after each reload it seals the stops again ({@link resealStopsForGeneration}).
   * The optimizer wait is bounded by what is left of the setup budget, with no floor, so a never-settling optimizer ends as the coded setup deadline naming the step, never as the uncoded wait timeout.
   * @param adapter - The run's development-server adapter, asked whether the server is settled.
   * @param ownedOrigin - The origin the owned server reported, which the stops are sealed from again.
   * @throws `VITE_PAGE_UNSTABLE` when the page reloads more often than {@link VITE_PAGE_GENERATION_LIMIT} before the inputs; `VITE_SETUP_DEADLINE` when the setup budget is spent while waiting for the optimizer.
   * @example
   * ```ts
   * await this.waitForStablePage(adapter, ownedOrigin)
   * ```
   */
  private async waitForStablePage(
    adapter: DevelopmentServerAdapter,
    ownedOrigin: string,
  ): Promise<void> {
    for (;;) {
      const generation = this.pageGeneration
      // The optimizer's own run decides when its reload comes, so the quiet window starts only after it is idle.
      await this.waitForOptimizerWithinBudget(adapter)
      this.alive()
      await sleep(VITE_PAGE_QUIET_MS, undefined, { signal: this.abort.signal })
      this.alive()
      if (this.pageGeneration > VITE_PAGE_GENERATION_LIMIT)
        throw viteRefusal(
          'VITE_PAGE_UNSTABLE',
          `The page reloaded ${this.pageGeneration} times before the inputs were written; Codebook stops after ${VITE_PAGE_GENERATION_LIMIT} and nothing was sent.`,
        )
      // A reload during this iteration: wait for the new page, then judge it again.
      if (generation !== this.pageGeneration) {
        await this.waitForDom('before')
        this.alive()
        continue
      }
      // Stable, and the seals already belong to this generation.
      if (this.sealedGeneration === generation) return
      // A reload that landed before this wait began leaves stable but unsealed generations too.
      await this.waitForDom('before')
      this.alive()
      // The page executes the modules the server serves now: seal them again, then confirm the page stays stable.
      await this.resealStopsForGeneration(generation, adapter, ownedOrigin)
      this.sealedGeneration = generation
    }
  }

  /**
   * Waits for the server's dependency optimizer to be idle, bounded by what is left of the setup budget.
   *
   * Why it exists: the setup-deadline timer and the launcher's own wait both end at the deadline; bounding the wait by the remaining budget and turning its timeout into the coded refusal keeps the deadline from surfacing as the uncoded wait timeout. Called by {@link waitForStablePage} before each quiet window.
   * @param adapter - The run's development-server adapter.
   * @throws `VITE_SETUP_DEADLINE` naming the current step when the budget is spent or the wait times out; any other failure of the wait unchanged.
   * @example
   * ```ts
   * await this.waitForOptimizerWithinBudget(adapter)
   * ```
   */
  private async waitForOptimizerWithinBudget(
    adapter: DevelopmentServerAdapter,
  ): Promise<void> {
    const remainingMs = this.preparationDeadlineAt - Date.now()
    const deadlineRefusal = (): StudyError =>
      viteRefusal(
        'VITE_SETUP_DEADLINE',
        viteSetupDeadlineSentence(this.setupStep, this.preparationBudgetMs),
      )
    // No floor: a spent budget is a deadline, not a one-second grace wait.
    if (remainingMs <= 0) throw deadlineRefusal()
    try {
      await adapter.waitForServerSettled(
        this.app!,
        remainingMs,
        this.abort.signal,
      )
    } catch (error) {
      // The launcher's wait timed out at the budget's end: report the deadline, not the wait.
      if (error instanceof WaitTimeoutError) throw deadlineRefusal()
      throw error
    }
  }

  /**
   * Words the failure of an expired setup budget, read when the progress deadline of {@link prepareOwned} expires.
   * A Vite run names its step with `VITE_SETUP_DEADLINE`; a Next run on the Pages path names its step with `NEXT_SETUP_DEADLINE` and the variant whose static recovery fits what had already run; every other Next run keeps the plain text.
   * @param budgetMs - The setup budget that expired.
   * @returns The failure text.
   * @example
   * this.setupDeadlineText(90_000) // => 'NEXT_SETUP_DEADLINE(router-absent): Repository setup deadline (90 s) exceeded while waiting for the page router …' for a Pages run at the router step
   */
  private setupDeadlineText(budgetMs: number): string {
    if (this.definition.configuration.adapter === 'vite-dev')
      return viteSetupDeadlineText(this.setupStep, budgetMs)
    // A run on the Pages path, or one in a Pages-capable workspace whose entry is not yet resolved as App, names a code; an App run's text stays as it was.
    const mayTakePagesPath =
      this.pagesRun !== undefined ||
      (this.pagesCapable && this.nextRoute?.router !== 'app')
    if (!mayTakePagesPath) return 'Repository setup deadline exceeded'
    return formatRefusalFailure(
      'NEXT_SETUP_DEADLINE',
      nextSetupDeadlineSentence(
        this.nextSetupStep,
        budgetMs,
        this.nextRouterState,
        this.pendingInputSelector,
      ),
      nextSetupDeadlineVariantOf(
        this.nextSetupStep,
        this.nextRouterState,
        this.inputInFlight,
      ),
    )
  }

  /**
   * Builds the `NEXT_SETUP_DEADLINE` refusal a Pages run throws itself when a wait of its own reaches the end of the setup budget, with the static recovery of its variant.
   * Called by {@link waitForPagesRouter}; the progress deadline's text ({@link setupDeadlineText}) says the same when its timer comes first.
   * @returns The error to throw.
   * @example
   * throw this.pagesSetupDeadlineError() // NEXT_SETUP_DEADLINE with the router-late recovery once a router was seen
   */
  private pagesSetupDeadlineError(): StudyError {
    const message = nextSetupDeadlineSentence(
      this.nextSetupStep,
      this.preparationBudgetMs,
      this.nextRouterState,
      this.pendingInputSelector,
    )
    return new StudyError(
      'NEXT_SETUP_DEADLINE',
      message,
      message,
      nextSetupDeadlineRecovery(
        nextSetupDeadlineVariantOf(
          this.nextSetupStep,
          this.nextRouterState,
          this.inputInFlight,
        ),
      ),
    )
  }

  /**
   * Tells whether the run is a Next run in a workspace with a Pages folder (`pages/` or `src/pages/`, with or without an App folder), read from the filesystem before the server starts.
   * Called by {@link prepareOwned}: only such a run takes the structured entry check and reads the route manifests ({@link readyPagesCapableEntry}); a workspace without a Pages folder keeps today's readiness exactly.
   * @param adapter - The run's development-server adapter.
   * @returns `true` for the Next adapter in a workspace whose router kind is `pages` or `both` ({@link readNextRouterKind}).
   * @example
   * await this.hasNextPagesFolder(adapter) // => true for a workspace with src/pages/index.tsx
   */
  private async hasNextPagesFolder(
    adapter: DevelopmentServerAdapter,
  ): Promise<boolean> {
    if (adapter.name !== 'next-dev-webpack') return false
    const routerKind = await readNextRouterKind(this.options.workspace)
    return routerKind === 'pages' || routerKind === 'both'
  }

  /**
   * Proves a Pages-capable Next server ready and decides which router serves the entry path: the structured entry check, the route manifests, then the App path unchanged or the Pages path with its refusals.
   *
   * Why it exists: in a workspace with a Pages folder a 3xx or 404 of the entry path is data for the decision, not a failure (Issue 166, run sequence steps 3–6). An App route replays today's readiness verdict on the answer already read; a Pages route is checked in the frozen refusal precedence ({@link resolveNextPagesEntry}) before the browser opens, so the run's cleanup stops only the owned server. Called by {@link prepareOwned} instead of `ready`.
   * @param port - The port the server was started on, named by a launch-failure note.
   * @returns The origin the owned server listens on.
   * @throws The launch failure with the preparation and webpack notes; `RUNTIME_FAILED` for a manifest that cannot be read; today's App readiness failures; the Pages refusals.
   * @example
   * const ownedOrigin = await this.readyPagesCapableEntry(3000) // 'http://127.0.0.1:3000', with this.pagesRun set for a Pages route
   */
  private async readyPagesCapableEntry(port: number): Promise<string> {
    const workspace = this.options.workspace,
      entryPath = this.definition.configuration.entryPath ?? '/'
    const { origin, entry } = await this.app!.readyEntry(
      this.abort.signal,
      entryPath,
    ).catch(async (error: unknown) => {
      throw await this.withLaunchFailureNotes(error, port)
    })
    this.alive()
    this.nextSetupStep = NEXT_SETUP_STEPS.readingManifests
    const manifests = await readNextRouteManifests({
      workspace,
      entryPath,
      signal: this.abort.signal,
    }).catch((error: unknown) => {
      throw this.manifestReadFailure(error)
    })
    this.alive()
    if (manifests.kind === 'app') {
      // The route is known once the manifests resolved it, so it is recorded before the App verdict: a setup deadline during that verdict keeps an App run's uncoded text ({@link setupDeadlineText}).
      this.nextRoute = { router: 'app', route: manifests.route.key }
      // An App route keeps today's readiness verdict, judged on the answer already read.
      await this.app!.confirmAppEntry(this.abort.signal, entryPath, entry)
      return origin
    }
    const nextVersion = (await readNextInstallation(workspace)).version
    const resolved = await resolveNextPagesEntry({
      workspace,
      entryPath,
      entry,
      manifests,
      nextVersion,
      outputTail: () => this.app!.outputTail(),
      compileFailureSentences: () =>
        describeNextLaunchFailure({ workspace, nextVersion, port }),
    })
    this.alive()
    this.pagesRun = { ...resolved, cache: createNextPagesDiscoveryCache() }
    this.nextRoute = {
      router: 'pages',
      route: resolved.route,
      source: resolved.source,
    }
    this.evidence.record('next.route-resolved', this.nextRoute)
    return origin
  }

  /**
   * Adds the Pages-path notes to an uncoded launch failure (the server exited or never listened): the preparation `scripts.dev` runs that Codebook skipped, and that Codebook ran Next with webpack when the dev script does not ask for it.
   * Called by {@link readyPagesCapableEntry} only, so a workspace without a Pages folder keeps its launch-failure text unchanged; a cancelled run and a coded failure keep their own words.
   * @param error - What the entry check rejected with.
   * @param port - The port the server was started on.
   * @returns The error to throw: a new error with the notes appended, or `error` itself.
   * @example
   * throw await this.withLaunchFailureNotes(new Error('Application exited: 1: …'), 3000) // 'Application exited: 1: …. Codebook runs your Next app with webpack …'
   */
  private async withLaunchFailureNotes(
    error: unknown,
    port: number,
  ): Promise<unknown> {
    if (this.abort.signal.aborted || error instanceof StudyError) return error
    const workspace = this.options.workspace
    const notes = await describeNextLaunchFailure({
      workspace,
      nextVersion: (await readNextInstallation(workspace)).version,
      port,
    })
    return notes.length
      ? new Error(`${withFinalPeriod(thrownMessage(error))} ${notes.join(' ')}`)
      : error
  }

  /**
   * Turns a route manifest that could not be read into the `RUNTIME_FAILED` error an agent reads: the manifest, the reason and where the run's journal is; any other failure (a cancelled run) is passed on.
   * Called by {@link readyPagesCapableEntry} for the rejection of {@link readNextRouteManifests}, whose error already names the file and never quotes its content.
   * @param error - What the manifest read rejected with.
   * @returns The error to throw.
   * @example
   * throw this.manifestReadFailure(new Error('Next route manifest .next/dev/server/pages-manifest.json could not be read: it is not valid JSON'))
   */
  private manifestReadFailure(error: unknown): unknown {
    const reason = thrownMessage(error)
    // Only the reader's own failure names a manifest; a cancelled run passes on as it is.
    if (this.abort.signal.aborted || !reason.startsWith('Next route manifest '))
      return error
    const message = `${withFinalPeriod(reason)} Codebook stopped the server it started before opening the browser; the run's journal is at the run resource's eventsUri.`
    return new StudyError('RUNTIME_FAILED', message, message)
  }

  /**
   * Refuses a declared stop of a Pages run that cannot pause in the page's client code, before its own chunks are read and before the browser opens: a server stop, since a Pages run observes only the page's client code in the browser, or a browser stop in a file Next never runs in the browser (`_document`, an API route).
   * Called by {@link sealDeclaredStop} for each stop of a Pages run.
   * @param stop - The declared stop.
   * @param pagesRun - The resolved Pages route, whose folder the file rule reads.
   * @throws `NEXT_SERVER_ONLY_STOP` naming the server stop, or the file's reason.
   * @example
   * this.refuseServerOnlyPagesStop(stop, this.pagesRun) // throws for src/pages/api/hello.ts, and for any stop with participant "server"
   */
  private refuseServerOnlyPagesStop(
    stop: ReturnType<typeof configuredStops>[number],
    pagesRun: NextPagesEntry,
  ): void {
    const place = `${stop.source.path}:${stop.source.line}`
    // A Pages run debugs the browser only, so a server stop is refused wherever its file is.
    if (stop.participant !== 'browser')
      throw nextRefusal(
        'NEXT_SERVER_ONLY_STOP',
        `Declared stop ${place} is a server stop (participant "server"), but a Pages Router run observes only the page's client code in the browser; Codebook does not pause the Next server in a Pages run. Move the stop to the client code of the page that serves the same question, with participant "browser".`,
      )
    const reason = nextServerOnlyFileReason(stop.source.path, pagesRun.folder)
    if (reason)
      throw nextRefusal(
        'NEXT_SERVER_ONLY_STOP',
        nextServerOnlyStopMessage(place, reason),
      )
  }

  /**
   * Refuses a sealed browser stop of a Pages run whose declared line is established as server-only (the page's server compile maps it and the browser module does not), also when a later line of its citation could bind; then a stop whose line can never bind as not sealed, which says it is not thereby server-only.
   * Called by {@link prepareOwned} after the seal and before {@link freezeSealedStops}, which keeps the general refusal for every other stop.
   * @param pagesRun - The resolved Pages route and the run's discovery cache.
   * @throws `NEXT_SERVER_ONLY_STOP` or `NEXT_STOP_NOT_SEALED`.
   * @example
   * await this.refuseUnmappedPagesStop(this.pagesRun) // throws NEXT_SERVER_ONLY_STOP for a getStaticProps line
   */
  private async refuseUnmappedPagesStop(pagesRun: {
    folder: NextPagesEntry['folder']
    compiledPath: string
    cache: NextPagesDiscoveryCache
  }): Promise<void> {
    // Every stop is checked, not only one no later line can bind: a server-only line (getServerSideProps above the component) is never moved to the client code after it. Each is a browser stop, as the seal refused every server stop of a Pages run ({@link refuseServerOnlyPagesStop}).
    for (const stop of this.stops) {
      // A blank, comment or type-only line holds no code to run on either side, so it binds to the next mapped line without a server read.
      if (isBlankOrCommentLine(stop.bundle.source, stop.source.line)) continue
      const established = await readNextServerOnlyReason({
        workspace: this.options.workspace,
        path: stop.source.path,
        line: stop.source.line,
        folder: pagesRun.folder,
        compiledPath: pagesRun.compiledPath,
        clientBundle: stop.bundle,
        signal: this.abort.signal,
        cache: pagesRun.cache,
      })
      this.alive()
      if (established.kind === 'server-only')
        throw nextRefusal(
          'NEXT_SERVER_ONLY_STOP',
          nextServerOnlyStopMessage(this.declaredAt(stop), established.reason),
        )
    }
    const unmapped = this.unbindableStop()
    if (!unmapped) return
    throw nextRefusal(
      'NEXT_STOP_NOT_SEALED',
      `Codebook could not verify a browser source mapping for ${this.declaredAt(unmapped)}. This does not establish that the code is server-only.`,
    )
  }

  /**
   * Checks a Pages page after it loaded and before any input: it is still at its entry path, its Next router becomes ready within the setup budget, and the router's route is the one the entry path resolved to.
   * Called by {@link prepareOwned} after the before conditions held. A redirect in the page, a rewrite, middleware or a client redirect ends the run before any input.
   * @param pagesRun - The resolved Pages route.
   * @throws `NEXT_ENTRY_REDIRECTED` for another path or route; `NEXT_SETUP_DEADLINE` when the router is not ready within the budget.
   * @example
   * await this.confirmPagesEntryAfterLoad(this.pagesRun)
   */
  private async confirmPagesEntryAfterLoad(
    pagesRun: NextPagesEntry,
  ): Promise<void> {
    const cdp = this.requireCdp()
    const loaded = await readNextPagesState(cdp)
    this.alive()
    this.refuseLeftEntryPath(loaded, 'after-load')
    this.nextSetupStep = NEXT_SETUP_STEPS.waitingForRouter
    const ready = await this.waitForPagesRouter(cdp)
    this.refuseLeftEntryPath(ready, 'after-load')
    // A rewrite or middleware can serve another page at the same path; the router names the page it rendered.
    if (ready.route !== pagesRun.route)
      throw nextRefusal(
        'NEXT_ENTRY_REDIRECTED',
        `The page at the entry path ${redactNextEntryPath(this.definition.configuration.entryPath ?? '/')} reports the Pages route ${ready.route === undefined ? '(none)' : redactNextEntryPath(ready.route)}, not ${redactNextEntryPath(pagesRun.route)}, the route the entry path resolved to: a rewrite, middleware or a client redirect served another page, so Codebook sent no input or click; the browser Codebook opened is closed with the run.`,
      )
    this.evidence.record('next.router-ready', { route: pagesRun.route })
  }

  /**
   * Waits for the Pages router to become ready (`window.next.router.isReady`), reading the page every {@link NEXT_ROUTER_POLL_INTERVAL_MS} within what is left of the setup budget, and remembers whether a router was ever seen for the deadline's text.
   * Called by {@link confirmPagesEntryAfterLoad}.
   * @param cdp - The owned page's channel.
   * @returns The first state with a ready router.
   * @throws `NEXT_SETUP_DEADLINE` (router absent or late) when the next read would pass the budget.
   * @example
   * const ready = await this.waitForPagesRouter(cdp) // { pathname: '/', routerSeen: true, isReady: true, route: '/' }
   */
  private async waitForPagesRouter(cdp: Cdp): Promise<NextPagesState> {
    this.nextRouterState = 'absent'
    for (;;) {
      const state = await readNextPagesState(cdp)
      this.alive()
      if (state.routerSeen) this.nextRouterState = 'late'
      if (state.isReady) return state
      // The wait shares the setup budget: when the next read would pass it, the coded deadline names the router step.
      if (
        Date.now() + NEXT_ROUTER_POLL_INTERVAL_MS >=
        this.preparationDeadlineAt
      )
        throw this.pagesSetupDeadlineError()
      await sleep(NEXT_ROUTER_POLL_INTERVAL_MS, undefined, {
        signal: this.abort.signal,
      })
      this.alive()
    }
  }

  /**
   * Refuses a Pages page whose pathname, normalized like the entry path ({@link nextPathnameOf}), is no longer the entry path.
   * Called by {@link confirmPagesEntryAfterLoad}, {@link refusePagesPathLeft} and {@link refusePagesPathLeftAfterWait}.
   * @param state - What the page reported.
   * @param moment - When it was read, for the message.
   * @throws `NEXT_ENTRY_REDIRECTED` naming both paths, redacted.
   * @example
   * this.refuseLeftEntryPath({ pathname: '/login', routerSeen: true, isReady: true, route: '/login' }, 'after-load') // throws
   */
  private refuseLeftEntryPath(
    state: NextPagesState,
    moment: NextEntryLeftMoment,
  ): void {
    const entryPath = this.definition.configuration.entryPath ?? '/'
    if (nextPathnameOf(state.pathname) !== nextPathnameOf(entryPath))
      throw nextRefusal(
        'NEXT_ENTRY_REDIRECTED',
        nextEntryLeftMessage(entryPath, state.pathname, moment),
      )
  }

  /**
   * Reads a Pages page's pathname once more right before an input and refuses when it left the entry path, so a client redirect that lands after the router was ready receives no input.
   * Called by {@link prepareOwned} before the first initial input and by {@link dispatchInput} before the click.
   * @param moment - Which input is next.
   * @throws `NEXT_ENTRY_REDIRECTED` naming both paths.
   * @example
   * await this.refusePagesPathLeft('before-input')
   */
  private async refusePagesPathLeft(
    moment: NextEntryLeftMoment,
  ): Promise<void> {
    const state = await readNextPagesState(this.requireCdp())
    this.alive()
    this.refuseLeftEntryPath(state, moment)
  }

  /**
   * Reads a Pages page's pathname after its before conditions did not hold in time and refuses when it left the entry path, so a client redirect that lands before the conditions hold ends as `NEXT_ENTRY_REDIRECTED` instead of a condition timeout.
   * Called by {@link waitForDom} on the timeout of the before wait of a Pages run; a page that cannot be read keeps the timeout, which the caller then throws.
   * @throws `NEXT_ENTRY_REDIRECTED` naming both paths, as a page that ended at another path once it loaded.
   * @example
   * await this.refusePagesPathLeftAfterWait()
   */
  private async refusePagesPathLeftAfterWait(): Promise<void> {
    const state = await readNextPagesState(this.requireCdp()).catch(
      () => undefined,
    )
    this.alive()
    if (state) this.refuseLeftEntryPath(state, 'after-load')
  }

  /**
   * Words the `SOURCE_CHANGED` failure of a Pages run whose sealed module was parsed again under another script id (Fast Refresh or HMR), saying that earlier observations stay readable and, when the click was sent and its result not verified, that it was not verified.
   * Called by {@link bindParsedScript}; every other run keeps its plain text.
   * @param stop - The stop whose module changed.
   * @returns The coded failure text.
   * @example
   * this.sourceChangedText(stop) // => 'SOURCE_CHANGED: src/components/PostList.tsx changed during the run, so Codebook stopped it. Earlier captured observations remain readable.'
   */
  private sourceChangedText(stop: PreparedStop): string {
    const clickUnverified =
      this.operation?.inputDispatched === true && !this.operation.afterVerified
    return formatRefusalFailure(
      'SOURCE_CHANGED',
      `${stop.source.path} changed during the run, so Codebook stopped it. Earlier captured observations remain readable.${clickUnverified ? " The click's result was not verified." : ''}`,
    )
  }

  /**
   * Takes a declared stop at the position Codebook uses for it and journals the difference, for the preparation of each stop in {@link prepareOwned}: a column declared on a blank line means that line, so the stop is taken at the line's start ({@link takenStopPosition}) and its breakpoint is requested from there.
   * @param stop - The declared stop, as {@link configuredStops} gives it.
   * @param stopIndex - Its zero-based place among the declared stops, which names its configuration field.
   * @param journalDecision - Whether to journal the decision; false for a renewal, which reaches the first seal's decision again.
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
    journalDecision: boolean,
  ): ReturnType<typeof configuredStops>[number]['source'] {
    const taken = takenStopPosition(
      stop.source,
      this.definition.descriptor.sources,
    )
    // Only a column the run set aside is journaled, so the journal says what Codebook did with the declaration.
    if (journalDecision && taken.column !== stop.source.column)
      this.evidence.record('breakpoint.column-on-blank-line', {
        participant: stop.participant,
        field: `${configuredStopFields(this.definition.configuration.version, stopIndex).source}.column`,
        declared: { line: stop.source.line, column: stop.source.column },
        taken: { line: taken.line, column: taken.column },
      })
    return taken
  }

  /**
   * Requests a stop after the statement its declared line begins when that line declares a binding the stop requires, for the preparation of each stop in {@link prepareOwned}: the debugger pauses before a line runs, so such a binding has no value before its whole statement has run, and what the agent meant (that binding's value) exists from the next line after the statement that can pause.
   * @param stop - The declared stop, as {@link configuredStops} gives it.
   * @param lines - The lines of the stop's sealed source.
   * @param scan - The stop's one scan of its sealed map, from the declared line to the end of its citation.
   * @param citationEndLine - The last line of the stop's citation.
   * @param journalDecision - Whether to journal the decision; false for a renewal, which reaches the first seal's decision again.
   * @returns `armed` and `earliestLine`:
   * - `armed`: the first mapped position after the declaring statement's last line within the citation ({@link declarationStatementEndLine}, {@link placeAfterDeclaringLine}), after the journal entry `breakpoint.armed-after-self-declaring-line` with the participant, the declared and the armed place and the bindings; `undefined` when the declared line declares no required binding of the stop, the statement does not end within the citation (or the text cannot tell where it ends), or the scan finds no later line of the citation to request (a partial scan may have missed it): the stop is then placed by {@link resolveArmedPlace}, and nothing is journaled; a server stop so placed by a partial scan is refused at its arming when its module is not loaded yet ({@link confirmRequestedPlace})
   * - `earliestLine`: the line after the declaring statement when the statement's end is known, otherwise the declared line; {@link confirmRequestedPlace} searches the debugger's break locations from it when the scan was partial
   * @example
   * ```ts
   * this.requestAfterSelfDeclaringLine(stop, lines, scan, 25) // => { armed: { line: 24, column: 3 }, earliestLine: 24 } for `const total = useMemo(() => {` on line 21 whose statement ends on line 23, with value:total required
   * ```
   */
  private requestAfterSelfDeclaringLine(
    stop: ReturnType<typeof configuredStops>[number],
    lines: readonly string[],
    scan: MappedPositionsScan,
    citationEndLine: number,
    journalDecision: boolean,
  ): { armed?: { line: number; column: number }; earliestLine: number } {
    const bindings = requiredBindingsDeclaredOn(stop, lines)
    // Only a required binding of the declared line itself moves the stop; a stop whose values exist before its line stays where it was declared.
    if (!bindings.length) return { earliestLine: stop.source.line }
    const statementEnd = declarationStatementEndLine(
      lines,
      stop.source.line,
      citationEndLine,
    )
    // A statement that does not end within the citation, or whose end the text cannot tell, leaves the stop where it was declared.
    if (statementEnd === undefined) return { earliestLine: stop.source.line }
    const armed = placeAfterDeclaringLine(statementEnd, scan)
    if (armed && journalDecision)
      this.evidence.record('breakpoint.armed-after-self-declaring-line', {
        participant: stop.participant,
        declared: { line: stop.source.line, column: stop.source.column },
        armed,
        bindings,
      })
    // The binding has no value before its whole statement ran, so no break location inside the statement may stand in for the stop.
    return { armed, earliestLine: statementEnd + 1 }
  }

  /**
   * Compares the module the page executes for a browser stop with the stop's sealed bundle, for {@link armStop} and for the check of later stops before input in {@link prepareOwned}.
   * The script is compared with its own sealed text: for an accepted instance of the module for another webpack layer ({@link moduleOf}) that is the instance's, never the sealed script's. A server stop's instance is also compared at its capture, where {@link inspect} reads the executed script again and {@link createBundleVerifier}'s `verify` checks its hash against the instance's own, so a text that changed between the instance's acceptance and the pause refuses the capture.
   * @param stop - A stop whose module is loaded (`stop.script` is set).
   * @param phase - When the check runs, for the failure text.
   * @param scriptId - The script to check when it is an accepted instance of the stop's module; the sealed script by default.
   * @throws When the executed bytes differ from the sealed ones; the text names the declared stop and the phase.
   * @example
   * ```ts
   * await this.assertExecutedModuleSealed(stop, 'before input')
   * ```
   */
  private async assertExecutedModuleSealed(
    stop: PreparedStop,
    phase: string,
    scriptId?: string,
  ): Promise<void> {
    const module = this.moduleOf(stop, scriptId)
    const executed = await this.participants[stop.participant].cdp!.request(
      'Debugger.getScriptSource',
      { scriptId: module.script!.scriptId },
    )
    this.alive()
    if (sha256(executed.scriptSource) !== module.verifier.hashes.javascript)
      throw new Error(
        `Executed module of declared stop ${this.declaredAt(stop)} differs from its sealed bundle (checked ${phase})`,
      )
  }

  /**
   * Arms the next expected stop before any input or resume can reach it, called by {@link prepareOwned} for the first stop and by {@link continue} for each later one.
   * The breakpoint is requested at {@link PreparedStop.armed}: the declared position, or, because the debugger verifies nothing on a line without a mapped position, the first mapped position after such a declared line ({@link resolveArmedPlace}). The stop's rule is measured from that requested line. The requested column is a preference: a browser stop records the debugger's verified binding as its position, on the requested line or on a line the rule accepts, and a server stop's owned breakpoint is given the same rule for its acknowledgement.
   * For both participants, a binding acknowledged on a later line although the requested line can pause is answered with one more request, at that line's break location before the requested column ({@link rearmOnRequestedLine}), whether the stop's rule accepts that later line or refuses it; the stop is refused only when the second request is bound on a later line again, or no break location lies before the requested column. A later line the rule refuses is refused as such only when the requested line cannot pause, or the debugger cannot say.
   * @param stop - The declared stop that is next in order.
   * @throws When a browser binding lands on a line the rule refuses or never verifies, a server registration is refused, a second request is bound past its line again, or a server stop's place lies inside the statement that declares a binding it requires and its module is not loaded yet ({@link confirmRequestedPlace}); each failure names the declared stop.
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
    await this.assertBindingAccepted(stop, binding)
    this.bindBoundPlace(stop, binding)
    this.evidence.record('breakpoint.bound', {
      ...binding,
      requested: { line: position.line, column: position.column },
      ...declaredAndArmedPlace(position, armed),
    })
    await this.verifySources()
  }

  /**
   * Refuses a browser stop's verified binding on a line the stop's rule does not accept, also by the debugger's own break locations ({@link acceptsByBreakLocations}), for {@link armStop} once no second request could move it back to the requested line.
   * @param stop - The browser stop being armed.
   * @param binding - The verified binding the stop would be bound at.
   * @throws The binding failure that names the declared stop, the place and the rule's reason ({@link refusedBindingText}), with the mapping hints.
   * @example
   * ```ts
   * await this.assertBindingAccepted(stop, { line: 26, column: 5 }) // throws 'Declared stop app/page.tsx:22 bound at 26:5, refused: line 23 between the declared line 22 and line 26 has a mapped position. …'
   * ```
   */
  private async assertBindingAccepted(
    stop: PreparedStop,
    binding: { line: number; column: number },
  ): Promise<void> {
    const accepted = await this.acceptsByBreakLocations(stop, binding)
    this.alive()
    if (!accepted)
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
    if (acknowledged.refusal !== undefined)
      await this.requestRefusedAgain(stop, acknowledged)
  }

  /**
   * Decides a refused server registration for {@link acknowledgedOnRequestedLine}, once no second request on the requested line stands in its place: a reply the source map alone refused on a later line is requested again when the debugger's own break locations accept that line ({@link requestAgainUnderBreakLocations}).
   * @param stop - The server stop being armed.
   * @param refused - The refused acknowledgement ({@link serverAcknowledgement} with its `refusal`).
   * @returns Once the new request was acknowledged without a refusal.
   * @throws The registration's refusal when the break locations do not accept its place, and the new request's refusal when it was refused too.
   * @example
   * ```ts
   * if (acknowledged.refusal !== undefined) await this.requestRefusedAgain(stop, acknowledged)
   * ```
   */
  private async requestRefusedAgain(
    stop: PreparedStop,
    refused: Awaited<ReturnType<ConfiguredBrowserRun['serverAcknowledgement']>>,
  ): Promise<void> {
    // A reply the source map alone refused on a later line is requested again when the debugger's own break locations accept that line.
    const acknowledged =
      refused.place && (await this.acceptsByBreakLocations(stop, refused.place))
        ? await this.requestAgainUnderBreakLocations(stop, refused.place)
        : refused
    // No second request could be made for a refused registration, or the second one was refused too: the refusal stands.
    if (acknowledged.refusal !== undefined) throw acknowledged.refusal
  }

  /**
   * Requests a server stop's breakpoint once more at the same place after its registration reply was refused on a later line that the debugger's own break locations accept ({@link acceptsByBreakLocations}), for {@link requestRefusedAgain}: a refused reply is never taken back, so the refused registration is retired, confirmed by the adapter, and the new one is judged by the stop's rebuilt rule.
   * @param stop - The server stop being armed; its rule was just rebuilt from the break locations.
   * @param place - Where the adapter verified the refused registration.
   * @returns The acknowledgement of the new request ({@link serverAcknowledgement}).
   * @throws When the refused registration's retirement is not confirmed, naming the stop and the place; a cancelled run keeps its own reason.
   * @example
   * ```ts
   * acknowledged = await this.requestAgainUnderBreakLocations(stop, { line: 32, column: 11 })
   * ```
   */
  private async requestAgainUnderBreakLocations(
    stop: PreparedStop,
    place: { line: number; column: number },
  ): Promise<
    Awaited<ReturnType<ConfiguredBrowserRun['serverAcknowledgement']>>
  > {
    try {
      await stop.breakpoint!.retire(
        this.participants[stop.participant].selected!,
        this.abort.signal,
      )
    } catch (error) {
      if (this.abort.signal.aborted) throw error
      throw new Error(
        `Declared stop ${this.declaredAt(stop)} bound at ${place.line}:${place.column}, which the debugger's break locations accept, and its refused breakpoint could not be retired before a new request: ${thrownMessage(error)}`,
      )
    }
    this.alive()
    stop.breakpoint = this.requestBreakpoint(stop)
    this.evidence.record('breakpoint.requested-again-after-break-locations', {
      participant: stop.participant,
      ...declaredAndArmedPlace(stop.source, stop.armed),
      refusedPlace: { line: place.line, column: place.column },
    })
    return this.serverAcknowledgement(stop)
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
      // The stop's rule is read at each acknowledgement, so a rule built again from the debugger's break locations ({@link acceptsByBreakLocations}) also judges the adapter's later news.
      (line) => stop.acceptsBoundLine(line),
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
          const binding = this.verifiedBinding(stop, result)
          if (!binding) return undefined
          // The debugger chose a line the stop's rule refuses and no later poll moves it back, so the wait ends at once. A refused line after the requested one is returned: the requested line may still pause at an earlier column.
          if (this.isRefusedBeforeRequest(stop, binding.line)) {
            boundElsewhere = binding
            throw new Error('Repository breakpoint bound on another line')
          }
          return binding
        },
        `a verified binding of declared stop ${this.declaredAt(stop)} on its declared line or a later line its binding rule accepts (${this.requestedAt(stop)}); declare the stop on an executable statement the action reaches (${this.declaredField(stop)})`,
        ACTIVE_TIMEOUT_MS,
        this.abort.signal,
      )
    } catch (error) {
      throw this.bindingWaitFailure(stop, error, boundElsewhere, pollFailure)
    }
  }

  /**
   * Reads a browser stop's verified binding from what the editor answered while the stop is armed, for each look of {@link verifiedBrowserBinding}; a binding the editor answered without a column gets the adapter's ({@link completedPlace}).
   * @param stop - The browser stop being armed.
   * @param answered - What the editor answered for the stop's owned breakpoint.
   * @returns The verified line and column; `undefined` while the binding is unverified, absent, or names no column the adapter reported either.
   * @example
   * ```ts
   * this.verifiedBinding(stop, { id: 12, verified: true, line: 22 }) // { verified: true, line: 22, column: 3 } once the adapter's news named 22:3
   * ```
   */
  private verifiedBinding(
    stop: PreparedStop,
    answered: unknown,
  ): z.infer<typeof verifiedPlaceSchema> | undefined {
    const place = this.completedPlace(
      stop,
      verifiedLineSchema.safeParse(answered).data,
    )
    return place && { verified: true, line: place.line, column: place.column }
  }

  /**
   * Gives a verified binding the editor answered its whole place: a binding without a column, as both editors answer for a stop requested at column 1 once the adapter sent news about it, takes the column the adapter itself reported for that breakpoint, or, at a pause, the paused top frame's on that line ({@link completeBindingPlace}). Called wherever the run reads a binding from the editor: {@link verifiedBinding}, {@link pauseAtMovedColumn}, {@link serverBindingAtPause} and {@link movedBrowserBinding}.
   * @param stop - The stop whose owned breakpoint was read.
   * @param binding - The verified binding's line and, when the editor kept it, its column; `undefined` for an answer that is no verified binding.
   * @param pausedAt - The generated place of the paused top frame, when the binding is read at the stop's pause; left out where no pause can vouch for a column.
   * @returns The binding's line and column with where the column came from; `undefined` for no verified binding, and for one without a column when neither the adapter nor the paused frame names one on its line.
   * @example
   * ```ts
   * this.completedPlace(stop, { line: 32 }) // { line: 32, column: 11, columnFrom: 'adapter' } for a breakpoint the adapter reported verified at 32:11
   * ```
   */
  private completedPlace(
    stop: PreparedStop,
    binding: { line: number; column?: number } | undefined,
    pausedAt?: Protocol.Debugger.Location,
  ): CompletedBindingPlace | undefined {
    if (!binding) return undefined
    const session = this.participants[stop.participant].selected!
    return completeBindingPlace(
      binding,
      stop.breakpoint!.reportedPlace(session),
      pausedAt && this.sourcePlaceOf(stop, pausedAt),
    )
  }

  /**
   * Maps a generated location of a stop's module back to its place in the sealed original, for {@link completedPlace} (the paused top frame) and {@link mappedBreakLocations} (each listed break location).
   * @param stop - The stop whose sealed map is asked.
   * @param location - A generated position in the stop's module.
   * @returns The one-based source line and column; `undefined` for unmapped generated code and for a place in another original.
   * @example
   * ```ts
   * this.sourcePlaceOf(stop, { lineNumber: 32, columnNumber: 52 }) // { line: 32, column: 11 }
   * ```
   */
  private sourcePlaceOf(
    stop: PreparedStop,
    location: Pick<Protocol.Debugger.Location, 'lineNumber' | 'columnNumber'> &
      Partial<Pick<Protocol.Debugger.Location, 'scriptId'>>,
  ): { line: number; column: number } | undefined {
    // A location in an instance of the module for another layer is mapped by that instance's own map.
    const { verifier } = this.moduleOf(stop, location.scriptId),
      line = verifier.originalLine(location),
      column = verifier.originalColumn(location)
    return line === undefined || column === undefined
      ? undefined
      : { line, column }
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
   * When the adapter's news moved the acknowledged breakpoint to a later line that the source map alone refuses (js-debug verifies a pending server breakpoint when its module loads), the debugger's own break locations judge that line once more ({@link acceptsByBreakLocations}); when they accept it, the owned breakpoint takes that place again ({@link OwnedRepositoryBreakpoint.retakeRefusedPlace}) and its receipt is read once more.
   * @param stop - A declared server stop whose owned breakpoint exists.
   * @param pausedAt - The generated place of the paused top frame, when the receipt is read at the stop's pause ({@link inspect}): refused news is then judged up to that place.
   * @returns The adapter's current receipt, `pending` until the module loads and `bound` afterwards.
   * @throws When the adapter refuses or revokes the registration, for example by acknowledging a line the stop's binding rule refuses, also by the break locations.
   * @example
   * ```ts
   * const receipt = await this.registeredStop(stop) // { status: 'pending', ... }
   * ```
   */
  private async registeredStop(
    stop: PreparedStop,
    pausedAt?: Protocol.Debugger.Location,
  ): Promise<Awaited<ReturnType<OwnedRepositoryBreakpoint['registered']>>> {
    const session = this.participants[stop.participant].selected!
    try {
      return await stop.breakpoint!.registered(session, this.abort.signal)
    } catch (error) {
      if (this.abort.signal.aborted) throw error
      // Only news that moved the breakpoint to a refused place is judged once more; every other failure stands.
      if (!(error instanceof OwnedBreakpointMovedError))
        throw this.registrationFailure(stop, error)
      return this.registeredAfterRefusedNews(stop, session, error, pausedAt)
    }
  }

  /**
   * Reads a server stop's receipt once more after the adapter's news moved its acknowledged breakpoint to a place the source map alone refuses, for {@link registeredStop} when its read failed for that reason.
   * @param stop - The declared server stop whose receipt was read.
   * @param session - The stop's selected session.
   * @param moved - The failure of the read, which carries the refused place.
   * @param pausedAt - The generated place of the paused top frame, when the receipt is read at the stop's pause.
   * @returns The receipt read again ({@link registeredStop}), once the debugger's own break locations accepted the place and the owned breakpoint took it again ({@link OwnedRepositoryBreakpoint.retakeRefusedPlace}), or once later news moved the breakpoint away from that place while this judgement waited ({@link isStillRefusedAt}).
   * @throws The registration failure ({@link registrationFailure}) when the breakpoint still stands at the refused place and the break locations refuse it too, or the module is not announced within the bound ({@link moduleAnnouncedForJudgement}) and the map's rule stands.
   * @example
   * ```ts
   * return this.registeredAfterRefusedNews(stop, session, error) // { status: 'bound', movedTo: { line: 32, column: 11 }, ... }
   * ```
   */
  private async registeredAfterRefusedNews(
    stop: PreparedStop,
    session: vscode.DebugSession,
    moved: OwnedBreakpointMovedError,
    pausedAt?: Protocol.Debugger.Location,
  ): ReturnType<ConfiguredBrowserRun['registeredStop']> {
    // The adapter can report the breakpoint verified before the run's own channel announced the module, and the break locations cannot be asked without it.
    await this.moduleAnnouncedForJudgement(stop, moved.place.line)
    // The wait lasts up to the capture bound, and later news may have moved the breakpoint meanwhile: the receipt is read for the place it has now, and nothing is judged or refused for a place it left.
    if (!this.isStillRefusedAt(stop, session, moved.place))
      return this.registeredStop(stop, pausedAt)
    // The news named a place the map alone refused; the debugger's break locations may accept it, and then the breakpoint stands there (it may already, when {@link retakeNewsByBreakLocations} judged that news first), so the receipt is read once more.
    if (await this.acceptsByBreakLocations(stop, moved.place, pausedAt)) {
      stop.breakpoint!.retakeRefusedPlace(session)
      return this.registeredStop(stop, pausedAt)
    }
    // The debugger's answer took time too: the refusal stands only for the place the breakpoint still has.
    if (!this.isStillRefusedAt(stop, session, moved.place))
      return this.registeredStop(stop, pausedAt)
    throw this.registrationFailure(stop, moved)
  }

  /**
   * Tells {@link registeredAfterRefusedNews} after each of its waits whether a stop's owned breakpoint still stands at the refused place that judgement began with; the adapter's later news can put the breakpoint at an accepted place, or at another refused one, while the run waits for the module or for the debugger's break locations.
   * @param stop - The declared server stop whose receipt is being read.
   * @param session - The stop's selected session.
   * @param place - The refused place the read of the receipt failed for.
   * @returns `true` while the breakpoint's refused place is that line and column; `false` once it stands at an accepted place (no refused place is left) or was refused at another place.
   * @example
   * ```ts
   * this.isStillRefusedAt(stop, session, { line: 4, column: 3 }) // false after news verified the breakpoint at 1:1, which the stop's rule accepts
   * ```
   */
  private isStillRefusedAt(
    stop: PreparedStop,
    session: vscode.DebugSession,
    place: { line: number; column: number },
  ): boolean {
    const refusedNow = stop.breakpoint!.refusedPlace(session)
    return refusedNow?.line === place.line && refusedNow.column === place.column
  }

  /**
   * Waits a bounded time for a stop's module to be announced when only the debugger's break locations could lift the refusal of a line, for {@link registeredAfterRefusedNews}: the adapter's news about a pending breakpoint can be read before the run's own channel announces the module, and a receipt read in that window (before the input, or while a later stop is armed) would be refused by the source map alone, with a reason the judgement at the module's announcement lifts milliseconds later.
   * The wait ends with the module or after the capture bound; the map's reason is then given only when the module did not arrive.
   * @param stop - The stop whose receipt was read.
   * @param line - The line the adapter's news named, which the stop's rule refuses.
   * @example
   * ```ts
   * await this.moduleAnnouncedForJudgement(stop, 32) // returns at once for a parsed module, and for a line the break locations could not judge
   * ```
   */
  private async moduleAnnouncedForJudgement(
    stop: PreparedStop,
    line: number,
  ): Promise<void> {
    const citation = this.definition.descriptor.anchors[stop.anchorIndex]!
    // A parsed module can be asked at once; a line before the requested one or after the citation is refused whatever the debugger lists.
    if (stop.script || line <= stop.armed.line || line > citation.endLine)
      return
    await waitUntil(
      () => stop.script,
      `the announcement of the module of declared stop ${this.declaredAt(stop)}`,
      CAPTURE_TIMEOUT_MS,
      this.abort.signal,
    ).catch(() => undefined)
    this.alive()
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
   * @param module - The script of the stop's module to ask: the sealed one, or an accepted instance for another layer (its locations are mapped by its own map).
   * @returns
   * - The one-based source place of every answered location the sealed map puts in the stop's original, with its zero-based generated position; a location in unmapped code or in another original is left out
   * - `undefined` when the adapter cannot list break locations, or did not answer within the bound
   * @example
   * ```ts
   * await this.mappedBreakLocations(stop) // [{ line: 22, column: 3, generated: { lineNumber: 21, columnNumber: 2 } }, { line: 23, column: 5, generated: { lineNumber: 22, columnNumber: 4 } }]
   * ```
   */
  private async mappedBreakLocations(
    stop: PreparedStop,
    range?: NonNullable<
      ReturnType<PreparedStop['verifier']['generatedRangeOfLine']>['range']
    >,
    timeoutMs?: number,
    module: StopModule = stop,
  ): Promise<MappedBreakLocation[] | undefined> {
    const scriptId = module.script!.scriptId
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
      const place = this.sourcePlaceOf(stop, location)
      if (!place) return []
      const { lineNumber, columnNumber = 0 } = location
      return [{ ...place, generated: { lineNumber, columnNumber } }]
    })
  }

  /**
   * Chooses the place of a stop whose sealed map was too large to scan completely and whose scan found no position on the line it is requested on, when {@link armStop} first arms it: a partial scan cannot say whether that line, or which later line, holds code, so the debugger's break locations decide.
   * The stop is requested at the first place the debugger can pause at from its earliest line ({@link PreparedStop.earliestRequestLine}) to the end of its citation: the declared line itself when it can pause there ("not found in a partial scan" is not "absent"), otherwise the first later line that can, and the stop's line rule is then measured from that line. A stop whose declared line declares a binding it requires is searched from the line after that whole declaration, so a break location inside a multi-line initializer or its callback, where the binding has no value yet, is never requested. A line that only looks like code in the text (the body of a block comment, a `>` that closes an opening tag) has no break location and is never requested.
   * The place chosen at preparation is kept when the debugger cannot be asked: the module is not parsed yet (a server stop before the input), the adapter cannot list break locations, or none lies in the citation. A server stop whose module is not parsed yet and whose place lies before its earliest line, inside the statement that declares a binding it requires, is refused instead ({@link armsInsideDeclarationUnasked}): it would pause where that binding has no value yet.
   * @param stop - The stop being armed for the first time.
   * @throws The binding failure that names the declared stop, the declaring statement and the line to declare the stop on ({@link insideUnloadedDeclarationText}), for such a server stop: before the input for the first stop, before the preceding stop is resumed for a later one.
   * @example
   * ```ts
   * await this.confirmRequestedPlace(stop) // stop.armed: { line: 39, column: 9 } for a blank declared line 38
   * ```
   */
  private async confirmRequestedPlace(stop: PreparedStop): Promise<void> {
    // No break locations can move this server stop past its declaring statement, so it is refused before it can pause inside it.
    if (this.armsInsideDeclarationUnasked(stop))
      throw this.bindingFailure(stop, this.insideUnloadedDeclarationText(stop))
    if (this.keepsPlaceUnasked(stop)) return
    const citation = this.definition.descriptor.anchors[stop.anchorIndex]!,
      first = (await this.mappedBreakLocations(stop))
        ?.filter(
          (place) =>
            place.line >= stop.earliestRequestLine &&
            place.line <= citation.endLine,
        )
        .sort(
          (left, right) => left.line - right.line || left.column - right.column,
        )[0]
    // The place chosen at preparation stands when it is the first place that can pause, or the debugger named none.
    if (!first || first.line === stop.armed.line) return
    stop.armed = { line: first.line, column: first.column }
    // The rule was built for a request on the line chosen at preparation; it is measured from the line the stop is requested on.
    const rule = createBindingLineRule(
      stop.source.line,
      citation,
      stop.scan,
      first.line,
    )
    stop.acceptsBoundLine = rule.accepts
    stop.bindingRefusal = rule.refusal
  }

  /**
   * Says whether a server stop would be armed inside the statement its declared line begins, with no debugger to ask for a later place, as the first check of {@link confirmRequestedPlace}.
   * A stop whose declared line declares a binding it requires is requested after that whole statement ({@link requestAfterSelfDeclaringLine}). When the map was too large to scan completely and the partial scan found no position after the statement, the place chosen at preparation lies on the declared line, and only the debugger's break locations can move it. A browser stop's module is parsed when the stop is armed; a server module is often loaded only by the application input, and then nothing can be asked.
   * @param stop - The stop being armed for the first time.
   * @returns `true` for a server stop with a partial scan, a module that is not parsed yet, and a place before its earliest line ({@link PreparedStop.earliestRequestLine}); `false` otherwise, also for every browser stop and for a complete scan, whose place the scan already chose.
   * @example
   * ```ts
   * this.armsInsideDeclarationUnasked(stop) // true for a server stop on `export const mode = pick(` whose statement ends on line 3, partly scanned, before the server loaded the module
   * ```
   */
  private armsInsideDeclarationUnasked(stop: PreparedStop): boolean {
    return (
      stop.participant === 'server' &&
      !stop.scan.complete &&
      !stop.script &&
      stop.armed.line < stop.earliestRequestLine
    )
  }

  /**
   * Words the refusal of a server stop that {@link armsInsideDeclarationUnasked} finds, for {@link confirmRequestedPlace}: it names the bindings, the declaring statement and the first line the stop may be declared on, so the agent can move the stop past the statement.
   * @param stop - The server stop being armed; its declared line declares a binding it requires.
   * @returns The text without a trailing period, for {@link bindingFailure}; a one-line declaration is named by its line alone.
   * @example
   * ```ts
   * this.insideUnloadedDeclarationText(stop) // 'Declared stop src/mode.ts:1 requires mode, which line 1 declares in a statement that ends on line 3, so mode has no value before line 4; … Declare this stop on line 4 or a later line, within a citation that covers that line (configuration.source)'
   * ```
   */
  private insideUnloadedDeclarationText(stop: PreparedStop): string {
    const bindings = requiredBindingsDeclaredOn(
        stop,
        stop.bundle.source.split(/\r\n|\r|\n/),
      ),
      names = bindings.join(' and '),
      firstLine = stop.earliestRequestLine,
      statementEnd = firstLine - 1
    // A statement that ends on its own line needs no second line number.
    const declaration =
      statementEnd === stop.source.line
        ? `which line ${stop.source.line} declares`
        : `which line ${stop.source.line} declares in a statement that ends on line ${statementEnd}`
    return `Declared stop ${this.declaredAt(stop)} requires ${names}, ${declaration}, so ${names} ${bindings.length === 1 ? 'has' : 'have'} no value before line ${firstLine}; the sealed map was too large to scan completely and the server has not loaded the module yet, so Codebook cannot find where the debugger can pause from line ${firstLine} on. Declare this stop on line ${firstLine} or a later line, within a citation that covers that line (${this.declaredField(stop)})`
  }

  /**
   * Says whether a stop keeps the place its scan chose without the debugger being asked, as the second check of {@link confirmRequestedPlace}.
   * @param stop - The stop being armed for the first time.
   * @returns `true` for a complete scan, for a partial one that found the line the stop is requested on when that line is not before its earliest line ({@link PreparedStop.earliestRequestLine}): they already chose the place, and for a module that is not parsed yet (the debugger cannot be asked); `false` when the break locations must decide.
   * @example
   * ```ts
   * this.keepsPlaceUnasked(stop) // true for a stop whose map was scanned completely
   * ```
   */
  private keepsPlaceUnasked(stop: PreparedStop): boolean {
    // A complete scan, and a partial one that found the requested line from the stop's earliest line on, already chose the place.
    return (
      stop.scan.complete ||
      (stop.armed.line >= stop.earliestRequestLine &&
        stop.scan.positions.some(
          (position) => position.line === stop.armed.line,
        )) ||
      !stop.script
    )
  }

  /**
   * Judges a binding the sealed map alone refuses once more from the debugger's own break locations, so a mapped line the debugger cannot pause on (a function head, its parameters, `try {`) does not lie between the requested and the bound line; {@link assertBindingAccepted}, {@link requestRefusedAgain}, {@link registeredAfterRefusedNews}, {@link retakeNewsByBreakLocations} and {@link bindAtPause} call it before they refuse a binding.
   * A generated module does not keep the order of its source, so a break location lies between only when it lies, in the generated module, between the place the stop was requested at and the place of the binding ({@link breakLocationsOnTheWayTo}). When the debugger lists its break locations, the stop's rule is built again from them ({@link createBindingLineRule}) and kept for every later check of the stop, and `breakpoint.rule-from-break-locations` journals the lines that counted. The map's rule stands when the line lies before the requested one or after the citation, the module is not parsed yet, or the adapter cannot list break locations.
   * @param stop - The stop whose binding is judged.
   * @param bound - The line and column the debugger bound the stop at.
   * @param pausedAt - The generated place of the paused top frame, when the binding is judged at the stop's pause: on the bound line it is the binding's generated place. Without it the sealed map's place of the bound line and column is taken.
   * @returns `true` when the stop's rule, rebuilt from the break locations when they were read, accepts the line; `false` when it still refuses it.
   * @example
   * ```ts
   * await this.acceptsByBreakLocations(stop, { line: 32, column: 11 }) // true for a stop requested on line 26 whose lines 27 to 31 are mapped but have no break location between the two generated places
   * ```
   */
  private async acceptsByBreakLocations(
    stop: PreparedStop,
    bound: { line: number; column: number },
    pausedAt?: Protocol.Debugger.Location,
  ): Promise<boolean> {
    const pausedThere = this.pausedOnLine(stop, bound.line, pausedAt)
    if (this.acceptsAsJudged(stop, bound.line, pausedThere)) return true
    const citation = this.definition.descriptor.anchors[stop.anchorIndex]!
    if (
      this.keepsMapRuleUnasked(stop, bound.line, citation) ||
      this.isRefusalJudged(stop, bound, pausedThere)
    )
      return false
    // The break locations are read for the script that paused, and mapped and measured by its own map.
    const module = this.moduleOf(stop, pausedAt?.scriptId),
      places = await this.mappedBreakLocations(
        stop,
        undefined,
        undefined,
        module,
      )
    return this.acceptsUnderBreakLocations(
      stop,
      bound,
      citation,
      places,
      pausedThere,
      module,
    )
  }

  /**
   * Gives the generated place of a paused top frame when it is the place of a binding on a line, for {@link acceptsByBreakLocations}: only a frame in the stop's module that the sealed map puts on the bound line says where that binding lies in the generated module.
   * @param stop - The stop whose binding is judged.
   * @param line - The line the debugger bound the stop on.
   * @param pausedAt - The generated place of the paused top frame; `undefined` when the binding is judged before any pause.
   * @returns The frame's generated position; `undefined` without a pause, for a frame in another script, and for one the map puts on another line.
   * @example
   * ```ts
   * this.pausedOnLine(stop, 32, { scriptId: '1922', lineNumber: 32, columnNumber: 52 }) // { lineNumber: 32, columnNumber: 52 }
   * ```
   */
  private pausedOnLine(
    stop: PreparedStop,
    line: number,
    pausedAt: Protocol.Debugger.Location | undefined,
  ): GeneratedPosition | undefined {
    if (!pausedAt || !this.isInModuleOnLine(stop, pausedAt, line))
      return undefined
    const { lineNumber, columnNumber = 0 } = pausedAt
    return { lineNumber, columnNumber }
  }

  /** Tells {@link pausedOnLine} whether a generated location lies in a stop's module (the sealed script or an accepted instance) and the map of that script puts it on a line. @example this.isInModuleOnLine(stop, { scriptId: '1922', lineNumber: 32, columnNumber: 52 }, 32) // true */
  private isInModuleOnLine(
    stop: PreparedStop,
    location: Protocol.Debugger.Location,
    line: number,
  ): boolean {
    // The pause is placed by the map of the script it is in: the sealed module or an accepted instance for another layer.
    return (
      this.isScriptOfModule(stop, location.scriptId) &&
      this.moduleOf(stop, location.scriptId).verifier.originalLine(location) ===
        line
    )
  }

  /** Tells whether a script id names the sealed script of a stop's module or an accepted instance of it for another webpack layer. @example this.isScriptOfModule(stop, '1904') // true for the accepted (middleware) instance */
  private isScriptOfModule(stop: PreparedStop, scriptId: string): boolean {
    return scriptId === stop.script?.scriptId || stop.instances.has(scriptId)
  }

  /**
   * Says whether a stop's rule already accepts a bound line for the generated place it is judged at, as the first check of {@link acceptsByBreakLocations} and of {@link acceptsUnderBreakLocations}, so the debugger is asked only for a line the rule refuses, or for a pause the rule was not built for.
   * A rule rebuilt for this line before its pause took the binding's generated place from the sealed map ({@link PreparedStop.judgedBinding}); a pause at another generated place is judged once more, up to where the program really stands.
   * @param stop - The stop whose binding is judged.
   * @param line - The line the debugger bound the stop on.
   * @param pausedThere - The generated place of the paused top frame on that line ({@link pausedOnLine}); `undefined` before any pause.
   * @returns `false` for a line the rule refuses, and for a pause at another generated place than the rule was built for; `true` otherwise.
   * @example
   * ```ts
   * this.acceptsAsJudged(stop, 23, undefined) // true for a stop requested on line 22: the next line has nothing between
   * ```
   */
  private acceptsAsJudged(
    stop: PreparedStop,
    line: number,
    pausedThere: GeneratedPosition | undefined,
  ): boolean {
    if (!stop.acceptsBoundLine(line)) return false
    return !pausedThere || this.isRuleBuiltForPlace(stop, line, pausedThere)
  }

  /**
   * Says whether a stop's rule holds for a pause on a bound line, as the second check of {@link acceptsAsJudged}.
   * @param stop - The stop whose binding is judged.
   * @param line - The line the debugger bound the stop on, which the rule accepts.
   * @param pausedThere - The generated place of the paused top frame on that line.
   * @returns `true` when the rule was not built for a generated place of this line (the map's rule, or a judgement of another line), and when it was built for exactly this place; `false` when it was built for another generated place of the line.
   * @example
   * ```ts
   * this.isRuleBuiltForPlace(stop, 32, { lineNumber: 32, columnNumber: 52 }) // true once the rule was built for the binding at generated 32:52
   * ```
   */
  private isRuleBuiltForPlace(
    stop: PreparedStop,
    line: number,
    pausedThere: GeneratedPosition,
  ): boolean {
    const judged = stop.judgedBinding
    // A rule that was not built for a generated place of this line holds wherever the program stands on it.
    if (judged?.line !== line || !judged.generated) return true
    return isSameGeneratedPosition(judged.generated, pausedThere)
  }

  /**
   * Says whether the stop's rule already refused this very binding at the generated place it is judged at, as the third check of {@link acceptsByBreakLocations} and of {@link acceptsUnderBreakLocations}: the refusal then stands, and the debugger is not asked and the journal not written a second time. The first judgement of a binding (when the adapter's news arrives, or the module is announced) keeps the journal entry, because that is when the run learned it; a later read of the receipt, before the input or at the pause, has nothing new to judge.
   * A pause at another generated place than the refusal was built for is new information and is judged once more, and so is a pause after a refusal that knew no generated place.
   * @param stop - The stop whose binding is judged.
   * @param bound - The line and column the debugger bound the stop at.
   * @param pausedThere - The generated place of the paused top frame on the bound line ({@link pausedOnLine}); `undefined` before any pause.
   * @returns `true` when the rule refuses the line and was built for this line and column, before a pause or for exactly the place of this pause; `false` otherwise.
   * @example
   * ```ts
   * this.isRefusalJudged(stop, { line: 7, column: 3 }, undefined) // true once the news that named 7:3 was judged and refused
   * ```
   */
  private isRefusalJudged(
    stop: PreparedStop,
    bound: { line: number; column: number },
    pausedThere: GeneratedPosition | undefined,
  ): boolean {
    const judged = this.judgementOf(stop, bound)
    if (!judged || stop.acceptsBoundLine(bound.line)) return false
    return (
      !pausedThere || isSameGeneratedPosition(judged.generated, pausedThere)
    )
  }

  /** Gives {@link isRefusalJudged} the judgement a stop's rule was last built for when it was this binding's line and column. @example this.judgementOf(stop, { line: 7, column: 3 }) // { line: 7, column: 3, generated: { lineNumber: 6, columnNumber: 2 } } */
  private judgementOf(
    stop: PreparedStop,
    bound: { line: number; column: number },
  ): PreparedStop['judgedBinding'] {
    const judged = stop.judgedBinding
    return judged?.line === bound.line && judged.column === bound.column
      ? judged
      : undefined
  }

  /**
   * Says whether the map's rule stands for a refused line without the debugger being asked, as the second check of {@link acceptsByBreakLocations}.
   * @param stop - The stop whose binding is judged.
   * @param line - The line the debugger bound the stop on, which the stop's rule refuses.
   * @param citation - The stop's article excerpt.
   * @returns `true` for a line up to the requested one, for a line after the citation and for a module that is not parsed yet; `false` when the break locations can judge the line.
   * @example
   * ```ts
   * this.keepsMapRuleUnasked(stop, 96, { endLine: 95 }) // true: the line lies after the citation
   * ```
   */
  private keepsMapRuleUnasked(
    stop: PreparedStop,
    line: number,
    citation: { endLine: number },
  ): boolean {
    // Only a later line within the citation is refused for what lies between it and the requested line, and only a parsed module can be asked.
    return line <= stop.armed.line || line > citation.endLine || !stop.script
  }

  /**
   * Judges a binding by the break locations the debugger listed, as the last step of {@link acceptsByBreakLocations}: the stop's rule is built again from them ({@link rebuildRuleFromBreakLocations}), kept on the stop and journaled as `breakpoint.rule-from-break-locations`.
   * For the judged binding only the break locations between the two generated places count ({@link breakLocationsOnTheWayTo}); when either generated place cannot be known, every line with a break location counts, as for every other line the kept rule is asked about later.
   * @param stop - The stop whose binding is judged.
   * @param bound - The line and column the debugger bound the stop at.
   * @param citation - The stop's article excerpt.
   * @param places - The module's break locations mapped back to the source ({@link mappedBreakLocations}); `undefined` when the adapter could not list them.
   * @param pausedThere - The generated place of the paused top frame on the bound line ({@link pausedOnLine}); `undefined` before any pause.
   * @param module - The script of the stop's module that paused: the sealed one, or an accepted instance for another layer, whose own map places the stop's requested line.
   * @returns What the stop's rule says without break locations (the rule in force stands) and when another judgement of the same stop already accepted the binding; otherwise what the rebuilt rule says.
   * @example
   * ```ts
   * this.acceptsUnderBreakLocations(stop, { line: 32, column: 11 }, citation, places, undefined) // true for a stop requested on line 26 when no listed place lies between the two generated places
   * ```
   */
  private acceptsUnderBreakLocations(
    stop: PreparedStop,
    bound: { line: number; column: number },
    citation: { endLine: number },
    places: MappedBreakLocation[] | undefined,
    pausedThere: GeneratedPosition | undefined,
    module: StopModule = stop,
  ): boolean {
    if (!places) return stop.acceptsBoundLine(bound.line)
    // Another judgement of the same stop finished while the debugger answered: its rule stands, also when it refused this binding.
    if (this.acceptsAsJudged(stop, bound.line, pausedThere)) return true
    if (this.isRefusalJudged(stop, bound, pausedThere)) return false
    this.rebuildRuleFromBreakLocations(
      stop,
      bound,
      citation,
      places,
      pausedThere,
      module,
    )
    return stop.acceptsBoundLine(bound.line)
  }

  /**
   * Builds a stop's rule again for one binding from the break locations the debugger listed, keeps it on the stop with the generated place it was built for and journals it; the last step of {@link acceptsUnderBreakLocations}.
   * @param stop - The stop whose binding is judged.
   * @param bound - The line and column the debugger bound the stop at.
   * @param citation - The stop's article excerpt.
   * @param places - The module's break locations mapped back to the source.
   * @param pausedThere - The generated place of the paused top frame on the bound line; `undefined` before any pause.
   * @param module - The script of the stop's module that paused: the sealed one, or an accepted instance for another layer, whose own map places the stop's requested line.
   * @example
   * ```ts
   * this.rebuildRuleFromBreakLocations(stop, { line: 32, column: 11 }, citation, places, undefined) // stop.acceptsBoundLine(32) is then true when nothing lies between the two generated places
   * ```
   */
  private rebuildRuleFromBreakLocations(
    stop: PreparedStop,
    bound: { line: number; column: number },
    citation: { endLine: number },
    places: MappedBreakLocation[],
    pausedThere: GeneratedPosition | undefined,
    module: StopModule = stop,
  ): void {
    const onTheWay = this.breakLocationsOnTheWayTo(
        stop,
        bound,
        places,
        pausedThere,
        module,
      ),
      breakLocationLines = [...new Set(places.map((place) => place.line))].sort(
        (left, right) => left - right,
      )
    const rule = createBindingLineRule(
      stop.source.line,
      citation,
      stop.scan,
      stop.armed.line,
      breakLocationLines,
      onTheWay && {
        line: bound.line,
        breakLocationLinesBetween: onTheWay.lines,
      },
    )
    stop.acceptsBoundLine = rule.accepts
    stop.bindingRefusal = rule.refusal
    stop.judgedBinding = {
      line: bound.line,
      column: bound.column,
      generated: onTheWay?.boundAt,
    }
    this.journalRuleFromBreakLocations(
      stop,
      bound.line,
      citation,
      onTheWay ?? breakLocationLines,
    )
  }

  /**
   * Finds the break locations the debugger passed on its way to a binding, for {@link rebuildRuleFromBreakLocations}: from the first generated position the sealed map puts on the line the stop was requested on, to the generated place of the binding ({@link breakLocationLinesOnTheWay}).
   * @param stop - The stop whose binding is judged.
   * @param bound - The line and column the debugger bound the stop at.
   * @param places - The module's break locations mapped back to the source.
   * @param pausedThere - The generated place of the paused top frame on the bound line; `undefined` before any pause, when the first listed place from the requested one on that the map puts at `bound` is taken.
   * @param module - The script of the stop's module that paused: the sealed one, or an accepted instance for another layer, whose own map places the stop's requested line.
   * @returns The lines on the way with both generated places; `undefined` when the map names no generated position for the requested line, no listed place lies at the binding, or the binding lies before the requested place.
   * @example
   * ```ts
   * this.breakLocationsOnTheWayTo(stop, { line: 32, column: 11 }, places, undefined) // { lines: [], requestedAt: { lineNumber: 30, columnNumber: 1 }, boundAt: { lineNumber: 32, columnNumber: 52 } }
   * ```
   */
  private breakLocationsOnTheWayTo(
    stop: PreparedStop,
    bound: { line: number; column: number },
    places: MappedBreakLocation[],
    pausedThere: GeneratedPosition | undefined,
    module: StopModule = stop,
  ): BreakLocationsOnTheWay | undefined {
    return breakLocationLinesOnTheWay(
      places,
      // The scan reads the map in generated order, so the first position it found for the line is the earliest, also when it stopped at its size limit. The paused script's own map gives it.
      module.verifier.generatedRangeOfLine(stop.armed.line).range?.start,
      bound,
      pausedThere,
    )
  }

  /**
   * Journals `breakpoint.rule-from-break-locations` for {@link rebuildRuleFromBreakLocations}: the lines of the citation after the requested one whose break location counted for the judged binding.
   * @param stop - The stop whose rule was rebuilt.
   * @param boundLine - The line the debugger bound the stop on.
   * @param citation - The stop's article excerpt.
   * @param counted - The break locations on the way to the binding, with both generated places, which the entry then names one-based; or, when the generated places were not known, every source line with a break location.
   * @example
   * ```ts
   * this.journalRuleFromBreakLocations(stop, 32, citation, { lines: [], requestedAt, boundAt }) // breakLocationLines: [32]
   * ```
   */
  private journalRuleFromBreakLocations(
    stop: PreparedStop,
    boundLine: number,
    citation: { endLine: number },
    counted: BreakLocationsOnTheWay | readonly number[],
  ): void {
    const oneBased = (place: GeneratedPosition) => ({
      line: place.lineNumber + 1,
      column: place.columnNumber + 1,
    })
    // On the way to a binding, the lines passed and the bound line itself count; without the generated places every line with a break location does.
    const lines = 'lines' in counted ? [...counted.lines, boundLine] : counted
    this.evidence.record('breakpoint.rule-from-break-locations', {
      participant: stop.participant,
      ...declaredAndArmedPlace(stop.source, stop.armed),
      boundLine,
      breakLocationLines: [...new Set(lines)]
        .sort((left, right) => left - right)
        .filter(
          (candidate) =>
            candidate > stop.armed.line && candidate <= citation.endLine,
        ),
      ...('lines' in counted
        ? {
            generatedPlaces: {
              requested: oneBased(counted.requestedAt),
              bound: oneBased(counted.boundAt),
            },
          }
        : {}),
    })
  }

  /**
   * Judges the adapter's news about a stop's owned breakpoint once more by the debugger's own break locations when the source map alone refused the place it names, for {@link onEvent} right after a `breakpoint` event changed that place and for {@link judgeNewsRefusedBeforeModule} once the stop's module is announced: when they accept it, the breakpoint stands there ({@link OwnedRepositoryBreakpoint.retakeRefusedPlace}), so its verified place is what a pause is compared with, and a pause of the stop that was held meanwhile is taken at once ({@link admitPauseHeldFor}).
   * @param stop - The declared stop whose owned breakpoint the news is about.
   * @param session - The session that sent the news.
   * @example
   * ```ts
   * this.track(this.retakeNewsByBreakLocations(stop, session))
   * ```
   */
  private async retakeNewsByBreakLocations(
    stop: PreparedStop,
    session: vscode.DebugSession,
  ): Promise<void> {
    const place = stop.breakpoint?.refusedPlace(session)
    // News that restored an accepted place, or a refusal the break locations keep, leaves the registration as it is.
    if (!place || !(await this.acceptsByBreakLocations(stop, place))) return
    stop.breakpoint?.retakeRefusedPlace(session)
    // The stop may have paused while the debugger was asked: that pause was held because its line was still refused.
    this.admitPauseHeldFor(stop)
  }

  /**
   * Takes a pause that is held for a stop as that stop's pause once the stop's rule accepts its place, for {@link retakeNewsByBreakLocations}: a pause that arrived while the debugger still had to answer the break-location request was held because its line was refused then, and nothing else looks at it again before the wait for the stop's own pause ends.
   * The pause is stored as {@link admitPause} would have stored it had the judgement been finished when it arrived, so {@link pauseOfAcceptedStop} finds it at once and no adoption is journaled.
   * @param stop - The stop whose owned breakpoint just took its verified place.
   * @example
   * ```ts
   * this.admitPauseHeldFor(stop) // the pause held on line 32 becomes the pause of the stop declared on line 26
   * ```
   */
  private admitPauseHeldFor(stop: PreparedStop): void {
    const participant = this.participants[stop.participant],
      held = this.pauseHeldForStop(stop)
    // A pause elsewhere than the verified place stays held: the end of the wait judges it.
    if (!held || !this.isPauseOfStop(held.event, stop)) return
    participant.unannouncedPause = undefined
    // The expected stop's pause becomes current only after the preceding continuation has all its receipts.
    if (this.continuation)
      this.pendingCdpStop = { participant: stop.participant, event: held.event }
    else participant.stopped = { event: held.event }
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
   * @returns The opening alone while the page stands paused at a server stop's breakpoint under the run's own resume: the deadline's text names that pause next ({@link withPagePauseUnderResume}), and it, not a line that did not run, is why no stop followed. Otherwise the text that names the stop and, in this order, the place a moved breakpoint is bound at, a server stop's registration ({@link notHitServerFirstStopReason}), or that its line must execute.
   * @example
   * ```ts
   * this.notHitFirstStopReason(stop, 'Repository input reached no verified pause') // '…: declared stop app/ui/login-form.tsx:74 was not hit within 20 s of the accepted action; its line must execute after the input'
   * ```
   */
  private notHitFirstStopReason(stop: PreparedStop, opening: string): string {
    // The page stands paused under the run's own resume: no line of a declared stop is to blame.
    if (this.openPageResume()) return opening
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
   * @returns The text that names the stop: paused there without the debugger announcing it, or what {@link notHitNextStopReason} says.
   * @example
   * ```ts
   * this.unreachedNextStopReason(stop) // '... declared stop app/ui/login-form.tsx:74 (bound at 75:13) was not hit within 20 s; the bound line, not the declared one, must execute after the preceding continuation'
   * ```
   */
  private unreachedNextStopReason(stop: PreparedStop): string {
    const unreached = 'Repository continuation reached no next declared pause',
      opening = `${unreached}: declared stop ${this.declaredAt(stop)}`,
      paused = this.unannouncedStopPlace(stop)
    // The stop's own pause arrived and was admitted, so the line ran; only the debugger's announcement is missing.
    if (paused)
      return `${opening} is paused at ${paused}, but the debugger did not announce that stop within ${ACTIVE_TIMEOUT_MS / MILLISECONDS_PER_SECOND} s of the preceding continuation`
    // The page stands paused under the run's own resume: no line of a declared stop is to blame, and the deadline's text names that pause next.
    if (this.openPageResume()) return unreached
    return this.notHitNextStopReason(stop, opening)
  }

  /**
   * Words the failure of a continuation whose next declared stop was not hit; the second half of {@link unreachedNextStopReason}, reached when no pause of that stop is held and the page does not stand paused under the run's own resume.
   * @param stop - The declared stop that was armed inside the continuation.
   * @param opening - The text that names the stop.
   * @returns The text that names the stop and the order rule; for a breakpoint the debugger moved to a later line it names that place and says that this line must run, and for a server stop that is not bound yet what its registration explains ({@link unboundServerNextStopReason}).
   * @example
   * ```ts
   * this.notHitNextStopReason(stop, opening) // '... declared stop app/ui/login-form.tsx:74 was not hit within 20 s; its line must execute after the preceding continuation'
   * ```
   */
  private notHitNextStopReason(stop: PreparedStop, opening: string): string {
    const moved = this.movedPlace(stop),
      within = `was not hit within ${ACTIVE_TIMEOUT_MS / MILLISECONDS_PER_SECOND} s`
    if (moved)
      return `${opening} ${this.boundAt(moved)} ${within}; the bound line, not the declared one, must execute after the preceding continuation`
    return (
      this.unboundServerNextStopReason(stop, opening, within) ??
      `${opening} ${within}; its line must execute after the preceding continuation`
    )
  }

  /**
   * Words the failure of a continuation whose next declared stop is a server stop that is not bound yet and whose registration explains more than the order rule; called by {@link notHitNextStopReason} when the breakpoint did not move.
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
    return this.adapter
      ? this.adapter.isScriptOfModule(stop.bundle.scriptUrl, event.url)
      : sameScriptUrl(stop.bundle.scriptUrl, event.url)
  }

  /**
   * Gives every declared stop of a participant the script its sealed module was parsed as, for the `Debugger.scriptParsed` handler of {@link observeParticipant}.
   * A module that is parsed again under another script id after it was sealed fails the run, and no later stop is given the script.
   * News about a stop's owned breakpoint that the source map alone refused before the module was announced is judged now ({@link judgeNewsRefusedBeforeModule}).
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
    // A Fast Refresh hot-update chunk is never a module a Pages run sealed.
    if (this.pagesRun && isHotUpdateScriptUrl(event.url)) return
    for (const stop of this.stops) {
      // The same module parsed for another webpack layer is a further instance of the stop's module, placed by its own map.
      if (this.isModuleInAnotherLayerOfStop(stop, name, event))
        this.track(this.adoptInstance(stop, name, event))
      if (!this.isModuleOfStop(stop, name, event)) continue
      if (this.isSealedAsAnotherScript(stop, event)) {
        // A Pages run names the changed file with SOURCE_CHANGED; every other run keeps its text.
        this.fail(
          this.pagesRun
            ? this.sourceChangedText(stop)
            : 'Selected module changed after sealing',
        )
        return
      }
      stop.script = event
      // The journal lists only the first scripts a runtime parses; the first announcement of each stop's module is always journaled and repeats are capped ({@link journalStopModule}), so a run that never pauses shows which script it was waiting in.
      this.journalStopModule('stop.module-parsed', {
        participant: name,
        source: stop.source.path,
        line: stop.source.line,
        scriptId: event.scriptId,
        scriptUrl: event.url,
      })
      this.judgeNewsRefusedBeforeModule(stop)
    }
  }

  /**
   * Judges the adapter's news about a stop's owned breakpoint by the debugger's break locations once the stop's module is announced, for {@link bindParsedScript}: the adapter can report a pending breakpoint verified before the run's own channel announces the module, and news the source map alone refuses cannot be judged without the module ({@link retakeNewsByBreakLocations}). Judged now, the stop's pause is matched as it arrives instead of being held for the whole wait for its own pause.
   * @param stop - The stop whose module was just announced.
   * @example
   * ```ts
   * this.judgeNewsRefusedBeforeModule(stop) // asks the break locations when the adapter's news named a place the map alone refuses
   * ```
   */
  private judgeNewsRefusedBeforeModule(stop: PreparedStop): void {
    const session = this.participants[stop.participant].selected
    if (session) this.track(this.retakeNewsByBreakLocations(stop, session))
  }

  /** Tells {@link bindParsedScript} whether a stop's module was already announced under another script id than the one announced now. @example this.isSealedAsAnotherScript(stop, event) // false for the module's first announcement */
  private isSealedAsAnotherScript(
    stop: PreparedStop,
    event: Protocol.Debugger.ScriptParsedEvent,
  ): boolean {
    return stop.script !== undefined && stop.script.scriptId !== event.scriptId
  }

  /** Tells {@link bindParsedScript} whether a script a server runtime announced is the module of a declared server stop loaded for another webpack layer than the sealed one. @example this.isModuleInAnotherLayerOfStop(stop, 'server', event) // true for (middleware)/./auth.config.ts while the stop was sealed as (action-browser)/./auth.config.ts */
  private isModuleInAnotherLayerOfStop(
    stop: PreparedStop,
    name: Participant,
    event: Protocol.Debugger.ScriptParsedEvent,
  ): boolean {
    return (
      stop.participant === 'server' &&
      name === 'server' &&
      Boolean(event.url) &&
      isModuleInAnotherLayer(stop.bundle.scriptUrl, event.url)
    )
  }

  /**
   * Reads another layer's instance of a declared server stop's module and, when its own source map puts it on the frozen original, accepts it as a script the stop's line may run in; called by {@link bindParsedScript} for each such script the runtime announces.
   * Next compiles a source file once per webpack layer, so the sealed `(action-browser)` instance is not the only script that can hold a declared line (the `authorized` callback of `auth.config.ts` runs in the `(middleware)` one). The instance's generated code differs from the sealed one, so it is placed by the map in its own text, never by the sealed map. The text is read once for all stops of the module and within {@link REPOSITORY_STOP_INSTANCE_READ_MS}; an instance whose map names another original or whose text cannot be read in time is journaled as refused (cut and without private paths) and never takes a pause for the stop, and a pause held in it fails with a sentence naming it ({@link unusableInstanceFailure}). A script announced again for the same address (HMR) replaces the older instance, unless a pause is held or captured in the older one ({@link holdsPauseInScript}). A run that ended or failed while the text was read records and judges nothing. When a pause in the script arrived before the read ended, it is judged now ({@link readmitHeldPause}).
   * @param stop - The declared server stop.
   * @param name - The participant whose runtime announced the script.
   * @param event - The announced script.
   * @example
   * ```ts
   * await this.adoptInstance(stop, 'server', event) // journals stop.instance-sealed for (middleware)/./auth.config.ts
   * ```
   */
  private async adoptInstance(
    stop: PreparedStop,
    name: Participant,
    event: Protocol.Debugger.ScriptParsedEvent,
  ): Promise<void> {
    if (!this.participants[name].cdp || !this.isRunOpen()) return
    const order = this.announceScript(name, event.scriptId)
    // A newer script of the same address replaces the older one that is still being read or was refused, unless a pause is held or captured in the older one (F460).
    this.forgetSupersededScripts(
      stop.unusableInstances.entries(),
      name,
      event.url,
      order,
      (scriptId) => {
        stop.unusableInstances.delete(scriptId)
        this.releaseScriptAnnouncement(name, scriptId)
      },
      (other) => other.url,
    )
    stop.unusableInstances.set(event.scriptId, {
      url: event.url,
      reason: 'its text had not been read yet',
    })
    const journaled = {
      participant: name,
      source: stop.source.path,
      line: stop.source.line,
      scriptId: event.scriptId,
      scriptUrl: event.url,
    }
    let instance: StopInstance
    try {
      const scriptSource = await this.instanceTextOf(name, event.scriptId)
      // The run may have ended, or a newer script of this address may have replaced this one, while its text was read.
      if (!this.isRunOpen() || !stop.unusableInstances.has(event.scriptId))
        return
      const bundle = bundleOfEvaluatedModule(
        scriptSource,
        stop.bundle,
        event.url,
      )
      if (!bundle) throw new Error('The script text names another address')
      instance = {
        bundle,
        verifier: createBundleVerifier(bundle),
        script: event,
      }
    } catch (error) {
      if (!this.isRunOpen() || !stop.unusableInstances.has(event.scriptId))
        return
      const reason = this.journalCauseOf(error)
      stop.unusableInstances.set(event.scriptId, { url: event.url, reason })
      this.journalStopModule('stop.instance-refused', { ...journaled, reason })
      return
    }
    stop.unusableInstances.delete(event.scriptId)
    // Only the scripts announced before this one are replaced: a newer script of the address may have been accepted while this older one was read (F476).
    this.forgetSupersededScripts(
      stop.instances.entries(),
      name,
      event.url,
      order,
      (scriptId) => {
        stop.instances.delete(scriptId)
        this.releaseScriptAnnouncement(name, scriptId)
      },
      (other) => other.script.url,
    )
    stop.instances.set(event.scriptId, instance)
    this.journalStopModule('stop.instance-sealed', {
      ...journaled,
      hashes: instance.verifier.hashes,
    })
    this.readmitHeldPause(stop, name, event.scriptId)
  }

  /**
   * Gives a script its announcement order once: the stops of one module share the script id, so a later stop's announcement of the same script keeps the order the first one got (F483); called by {@link adoptInstance}.
   * @param name - The participant whose runtime announced the script.
   * @param scriptId - The announced script's id.
   * @returns The script's order among the announced scripts.
   * @example this.announceScript('server', '1904') // 1 for the first script announced
   */
  private announceScript(name: Participant, scriptId: string): number {
    const key = `${name}:${scriptId}`
    const known = this.scriptAnnouncements.get(key)
    if (known !== undefined) return known
    const order = ++this.scriptAnnouncementCount
    this.scriptAnnouncements.set(key, order)
    return order
  }

  /**
   * Drops a script's announcement order once no stop keeps an instance or an unusable entry of it, so scripts of per-rebuild addresses do not pile up for the run (F483); called when {@link forgetSupersededScripts} removes an entry.
   * @param name - The participant whose runtime announced the script.
   * @param scriptId - The script's id.
   * @example this.releaseScriptAnnouncement('server', '1904')
   */
  private releaseScriptAnnouncement(name: Participant, scriptId: string): void {
    const kept = this.stops.some(
      (stop) =>
        stop.participant === name &&
        (stop.instances.has(scriptId) || stop.unusableInstances.has(scriptId)),
    )
    if (!kept) this.scriptAnnouncements.delete(`${name}:${scriptId}`)
  }

  /**
   * Forgets the older scripts of an address that a newer script of that address replaces, except one a pause is held or captured in ({@link holdsPauseInScript}); for {@link adoptInstance}.
   * @param entries - The older scripts by script id (a snapshot is taken, so deleting while reading is safe).
   * @param name - The participant whose runtime announced the newer script.
   * @param url - The address of the newer script.
   * @param order - The announcement order of the script that replaces the others ({@link scriptAnnouncements}); a script announced after it stays.
   * @param forget - Removes one script by id from its map.
   * @param urlOf - Reads a script entry's address.
   * @example
   * ```ts
   * this.forgetSupersededScripts(stop.instances.entries(), 'server', event.url, order, (id) => stop.instances.delete(id), (other) => other.script.url)
   * ```
   */
  private forgetSupersededScripts<Entry>(
    entries: IterableIterator<[string, Entry]>,
    name: Participant,
    url: string,
    order: number,
    forget: (scriptId: string) => void,
    urlOf: (entry: Entry) => string,
  ): void {
    for (const [scriptId, entry] of [...entries]) {
      const key = `${name}:${scriptId}`
      const isOlder = (this.scriptAnnouncements.get(key) ?? 0) < order
      if (
        urlOf(entry) !== url ||
        !isOlder ||
        this.holdsPauseInScript(name, scriptId)
      )
        continue
      forget(scriptId)
    }
  }

  /**
   * Tells whether a participant holds a pause whose top frame is in a script: a captured stop, a stop being replayed or refreshed, or a pause held away from the expected stop.
   * Why: {@link adoptInstance} keeps an older instance of a module while such a pause is in its script, so the pause is still judged by that instance's own map and text and not by the sealed module's (F460).
   * Called by {@link adoptInstance} when a newer script of the same address replaces an older instance.
   * @param name - The participant whose pauses are asked.
   * @param scriptId - The script id.
   * @returns `true` when a pause of the participant is in that script.
   * @example
   * ```ts
   * this.holdsPauseInScript('server', '1904') // true while a pause in script 1904 awaits its stop's wait
   * ```
   */
  private holdsPauseInScript(name: Participant, scriptId: string): boolean {
    const participant = this.participants[name]
    const pending =
      this.pendingCdpStop?.participant === name
        ? this.pendingCdpStop.event
        : undefined
    return [
      participant.stopped?.event,
      participant.refresh?.stopped.event,
      participant.unannouncedPause?.event,
      pending,
    ].some((event) => event?.callFrames[0]?.location.scriptId === scriptId)
  }

  /**
   * Reads the text the runtime holds for a script, once for every stop of the module that asks while the read is in flight, and within {@link REPOSITORY_STOP_INSTANCE_READ_MS}; for {@link adoptInstance}.
   * The read is forgotten as soon as it settles, so a superseded bundle is not kept in memory.
   * @param name - The participant whose runtime holds the script.
   * @param scriptId - The script to read.
   * @returns The script's source text.
   * @throws When the runtime does not answer in time, answers with an error, or the run is aborted.
   * @example
   * ```ts
   * const text = await this.instanceTextOf('server', '1904')
   * ```
   */
  private instanceTextOf(name: Participant, scriptId: string): Promise<string> {
    const key = `${name}:${scriptId}`
    let read = this.instanceTexts.get(key)
    if (!read) {
      read = awaitResponse(
        this.participants[name]
          .cdp!.request('Debugger.getScriptSource', { scriptId })
          .then((executed) => executed.scriptSource),
        `the text of script ${scriptId}`,
        this.abort.signal,
        REPOSITORY_STOP_INSTANCE_READ_MS,
      )
      this.instanceTexts.set(key, read)
      const forget = (): void => {
        this.instanceTexts.delete(key)
      }
      read.then(forget, forget)
    }
    return read
  }

  /** Tells whether the run can still record and judge: not cleaning, not aborted, not failed and not completed. @example if (!this.isRunOpen()) return */
  private isRunOpen(): boolean {
    return (
      !this.cleaning &&
      !this.abort.signal.aborted &&
      this.status !== 'failed' &&
      this.status !== 'completed'
    )
  }

  /** Words a thrown cause for the journal and for a failure sentence: its message without private paths ({@link sanitizeCause}), cut to what a surface shows ({@link cutCauseForDisplay}). @example this.journalCauseOf(new Error('ENOENT /Users/ada/repo/a.ts')) // 'ENOENT <workspace>/a.ts' */
  private journalCauseOf(error: unknown): string {
    return cutCauseForDisplay(
      sanitizeCause(
        thrownMessage(error),
        causeRootsFor([this.options.directory], this.options.workspace),
      ),
    )
  }

  /**
   * Journals a `stop.module-parsed`, `stop.instance-sealed` or `stop.instance-refused` entry, each type up to {@link REPOSITORY_STOP_MODULE_JOURNAL_LIMIT}, the rest only counted ({@link cleanupOwned} journals the count), like the pauses a hook makes in a loop.
   * The first entry of a type for each stop and script address (without its query and hash) is journaled past the cap too: it is the evidence (the instance's hashes) of that stop's module, and HMR churn of one module must not use it up for the others (F467). Those first entries are bounded by the stops and layers of the run, and absolutely by {@link REPOSITORY_STOP_MODULE_FIRST_JOURNAL_BEYOND_LIMIT}, so addresses that change per rebuild cannot grow the journal without a ceiling (F473).
   * @param type - The entry's type.
   * @param payload - The entry's fields.
   * @example
   * ```ts
   * this.journalStopModule('stop.instance-refused', { participant: 'server', reason })
   * ```
   */
  private journalStopModule(
    type:
      'stop.module-parsed' | 'stop.instance-sealed' | 'stop.instance-refused',
    payload: Record<string, unknown>,
  ): void {
    const journaled = this.stopModuleJournaled.get(type) ?? 0
    // One key per entry type, stop and script address: its first entry is never left out.
    const firstKey = JSON.stringify([
      type,
      payload.participant,
      payload.source,
      payload.line,
      // An address that only differs in its query or hash is the same script address (F473).
      String(payload.scriptUrl ?? '').replace(/[?#].*$/s, ''),
    ])
    const isFirst = !this.stopModuleFirstJournaled.has(firstKey)
    if (journaled >= REPOSITORY_STOP_MODULE_JOURNAL_LIMIT) {
      // Past the cap only a first entry is journaled, and only up to an absolute second cap (F473).
      const mayBeJournaled =
        isFirst &&
        this.stopModuleFirstBeyondLimit <
          REPOSITORY_STOP_MODULE_FIRST_JOURNAL_BEYOND_LIMIT
      if (!mayBeJournaled) {
        this.unjournaledStopModuleEvents++
        return
      }
      this.stopModuleFirstBeyondLimit++
    }
    this.stopModuleFirstJournaled.add(firstKey)
    this.stopModuleJournaled.set(type, journaled + 1)
    this.evidence.record(type, payload)
  }

  /**
   * Judges again a pause that was held in a script of a declared stop's module before that script was accepted as an instance of it, for {@link adoptInstance}: the pause arrived while the instance's text was still being read, when no map placed it.
   * @param stop - The declared stop whose instance was just accepted.
   * @param name - The participant whose runtime paused.
   * @param scriptId - The accepted instance.
   * @example
   * ```ts
   * this.readmitHeldPause(stop, 'server', '1904') // the pause held in 1904 becomes the stop's pause when it is at the stop's line
   * ```
   */
  private readmitHeldPause(
    stop: PreparedStop,
    name: Participant,
    scriptId: string,
  ): void {
    const participant = this.participants[name],
      held = participant.unannouncedPause
    if (
      !held ||
      held.expectedStop !== stop ||
      this.expectedStop(name) !== stop ||
      held.event.callFrames[0]?.location.scriptId !== scriptId
    )
      return
    participant.unannouncedPause = undefined
    this.admitPause(name, held.event, held.journaled)
    // A pause that is still not the stop's keeps the time it has been held since.
    if (participant.unannouncedPause) participant.unannouncedPause = held
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
      // The secret frame gate's own expressions are no page script: not listed, not bound.
      if (event.url === SECRET_FRAME_SOURCE_URL) return
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
    const events = [
      'Debugger.scriptParsed',
      'Debugger.paused',
      'Debugger.resumed',
    ]
    // A version 3 run on any adapter also watches main-frame loads: its settle wait reads them, and a load before the last operation ends the run.
    if (
      name === 'browser' &&
      (this.adapter?.name === 'vite-dev' || this.operationsConfiguration)
    ) {
      cdp.on('Page.frameNavigated', (event) => this.onPageNavigated(event))
      events.push('Page.frameNavigated')
    }
    await cdp.subscribe(events)
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
        }, this.unownedPagePauseLimitMs(event)),
        event,
        journaled,
      }
      this.transientBrowserPause = transient
      // The run resumes this page pause itself, so the stop the adapter reports for it is the run's.
      this.openCausalWindow('browser')
      this.ownPagePauseUnderResume()
      if (journaled)
        this.evidence.record('cdp.browser-pause-awaiting-adapter', {
          scriptId: event.callFrames[0]?.location.scriptId,
        })
      return
    }
    this.admitPause(name, event, journaled)
    // Asked after a server pause too, where it finds nothing to take: the page's open pause was judged when the run sent its resume or when that pause was read.
    this.ownPagePauseUnderResume()
  }

  /**
   * Chooses how long a page pause may last in a run that declares no browser stop, for the timer {@link onCdpPaused} starts for it.
   * The debugger also sets a server stop's breakpoint in the page, and the page pauses there in its stub of the server module. The debug adapter reports that pause as a stop that names the server breakpoint, which the run then resumes itself ({@link resumeServerBreakpointInBrowser}); it may first resolve which breakpoints were hit, so that report can come later than the short bound of a pause nobody owns. Such a pause is known by its place before the report arrives, and has the bound of a pause of the adapter's own until then.
   * The adapter's own breakpoint at a module's first position is set by the bare base name of the declared stop's file, so the page also pauses for a moment at the first position of every other script whose address contains that name, until the adapter has read that script's source map; such a pause is known by its one breakpoint ({@link isModuleEntryPause}) and has the adapter's bound too.
   * @param event - The page's pause.
   * @returns {@link REPOSITORY_ADAPTER_PAUSE_LIMIT_MS} for a pause whose top frame lies in the page's stub of a declared server stop's module ({@link isPageStubOfSource}) and for the adapter's own pause at the first position of a module named like a declared stop's file; {@link REPOSITORY_UNOWNED_PAGE_PAUSE_LIMIT_MS} for every other pause, also one without a frame.
   * @example
   * ```ts
   * this.unownedPagePauseLimitMs(event) // 3000 for a pause in (app-pages-browser)/./app/lib/actions.ts while a server stop is declared in app/lib/actions.ts, otherwise 250
   * ```
   */
  private unownedPagePauseLimitMs(
    event: Protocol.Debugger.PausedEvent,
  ): number {
    const scriptUrl = this.pageScriptUrlOf(event),
      sourcePaths = this.stops.map((stop) => stop.source.path)
    const isAdaptersOwn =
      sourcePaths.some((path) => isPageStubOfSource(scriptUrl, path)) ||
      isModuleEntryPause(event, scriptUrl, sourcePaths)
    return isAdaptersOwn
      ? REPOSITORY_ADAPTER_PAUSE_LIMIT_MS
      : REPOSITORY_UNOWNED_PAGE_PAUSE_LIMIT_MS
  }

  /** Gives the address the page's runtime announced for the script a page pause is in, for {@link unownedPagePauseLimitMs}, {@link answeredResumeOfOpenPause}, {@link isPageEntryPause} and {@link isPagePauseInServerStub}; `undefined` for a pause without a frame and for a script the page never announced. @example this.pageScriptUrlOf(event) // 'webpack-internal:///(app-pages-browser)/./app/lib/actions.ts' */
  private pageScriptUrlOf(
    event: Protocol.Debugger.PausedEvent,
  ): string | undefined {
    const scriptId = event.callFrames[0]?.location.scriptId
    return scriptId === undefined
      ? undefined
      : this.participants.browser.scriptUrls.get(scriptId)
  }

  /**
   * Takes the page pause the run itself is resuming out of the bounds of a pause nobody owns and marks it with the declared server stop of that resume ({@link stopOfPageResume}); called by {@link resumeServerBreakpointInBrowser} when it sends that resume and by {@link onCdpPaused} for a page pause read while a resume has no answer yet, or in that stop's stub shortly after the debugger answered one. Such a pause can also be the one the debugger makes for itself at the module's first position before the pause at the breakpoint; it resumes that one within milliseconds, and the mark goes with the pause.
   * In a run without browser stops such a pause runs against the short bound of an unowned page pause, and in a run with browser stops a held pause that is resumed late is taken for a competing resume. Neither holds for a pause the run resumes itself: it is bounded by the request the run sent (the adapter's answer within the active bound) and by the action's own deadline, and either end names the pause and what became of the resume ({@link pageResumeFailure}, {@link withPagePauseUnderResume}).
   * It reads only the run's resumes and the page's open pause, never which participant paused, so {@link onCdpPaused} asks it after a server pause as well, and a server pause never makes a waiting page pause the run's own: a resume marks every open page pause when it is sent, a page pause read while one has no answer is marked when it is read, and the bound of an answered resume only runs out, so a page pause that was not taken when it was read is taken later only by a resume the run sends then. The one thing a call after another pause can change is which of two declared stops an already taken pause is kept for (the oldest resume still without an answer).
   * @example
   * ```ts
   * this.ownPagePauseUnderResume() // clears the 250 ms timer of the page pause the run is resuming
   * ```
   */
  private ownPagePauseUnderResume(): void {
    const stop = this.stopOfPageResume(),
      transient = this.transientBrowserPause,
      held = this.participants.browser.unannouncedPause
    if (!stop) return
    // The timed pause of a run without browser stops loses its timer; either pause keeps the stop it was taken for.
    if (transient) {
      clearTimeout(transient.timer)
      transient.resumedByRun = stop
    }
    if (held) held.resumedByRun = stop
  }

  /** Gives {@link ownPagePauseUnderResume} the declared server stop whose resume the page's open pause belongs to: the oldest resume without an answer, otherwise the one the debugger just answered when that pause lies in its stub ({@link answeredResumeOfOpenPause}); `undefined` when the pause is nobody's. @example this.stopOfPageResume() // the server stop declared at app/lib/actions.ts:27 */
  private stopOfPageResume(): PreparedStop | undefined {
    return this.pageResumesUnderWay[0] ?? this.answeredResumeOfOpenPause()
  }

  /**
   * Finds the answered resume the page's open pause belongs to, for {@link stopOfPageResume}: the debugger's answer can be read before the page's own events (240 ms before them in a native run), so a pause that is read after the answer is not known as the run's own by a request under way. Within the debugger's bound of the answer, a pause in the stub of that stop's module is taken as the one the debugger answered for: when the debugger resumes it, as it does, it is retired like every pause; when the page never reports that resume, the run ends naming the pause and saying that the debugger answered ({@link openPageResume}).
   * @returns The declared server stop of the last answered resume, when it was answered at most {@link REPOSITORY_ADAPTER_PAUSE_LIMIT_MS} ago and the page's open pause lies in the page's stub of that stop's module ({@link isPageStubOfSource}); `undefined` otherwise, also for a pause in any other script.
   * @example
   * ```ts
   * this.answeredResumeOfOpenPause() // the stop declared at app/lib/actions.ts:27 for a pause in (app-pages-browser)/./app/lib/actions.ts read 240 ms after the debugger's answer
   * ```
   */
  private answeredResumeOfOpenPause(): PreparedStop | undefined {
    const answered = this.recentlyAnsweredPageResume(),
      open = this.openPagePause()
    if (!answered || !open) return undefined
    return isPageStubOfSource(
      this.pageScriptUrlOf(open.event),
      answered.source.path,
    )
      ? answered
      : undefined
  }

  /** Gives {@link answeredResumeOfOpenPause} the declared server stop of the last resume the debugger answered, while that answer is no older than the debugger's bound for a pause of its own; `undefined` afterwards and before any answer. @example this.recentlyAnsweredPageResume() // undefined 3,001 ms after the answer */
  private recentlyAnsweredPageResume(): PreparedStop | undefined {
    const answered = this.answeredPageResume
    return answered &&
      performance.now() - answered.answeredAtMs <=
        REPOSITORY_ADAPTER_PAUSE_LIMIT_MS
      ? answered.stop
      : undefined
  }

  /** Gives the page's pause that is open and that no declared stop owns: the timed one of a run that declares no browser stop, or the held one of a run that declares one; {@link answeredResumeOfOpenPause} and {@link pagePauseTakenUnderResume} read it. @example this.openPagePause()?.event // the paused event in the page's copy of app/lib/actions.ts */
  private openPagePause():
    | { event: Protocol.Debugger.PausedEvent; resumedByRun?: PreparedStop }
    | undefined {
    return (
      this.transientBrowserPause ?? this.participants.browser.unannouncedPause
    )
  }

  /** Tells whether a pause is at a declared stop's bound place: on its line by {@link isPauseAtStop}, asked with {@link pauseTarget} so a server stop the adapter already verified is compared with that line, and, once the run knows the binding, at its column by {@link isPauseAtBoundColumn}. @example this.isPauseOfStop(event, this.expectedStop('server')) // false for the adapter's entry breakpoint */
  private isPauseOfStop(
    event: Protocol.Debugger.PausedEvent,
    stop: PreparedStop | undefined,
  ): stop is PreparedStop {
    if (stop === undefined) return false
    // The pause is compared by the map of the script it is in: the instances of one module differ in generated code.
    const module = this.moduleOf(stop, event.callFrames[0]?.location.scriptId)
    return (
      isPauseAtStop(event, this.pauseTarget(stop, module)) &&
      isPauseAtBoundColumn(event, {
        bound: this.boundColumnIn(stop, module),
        verifier: module.verifier,
      })
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

  /**
   * Gives the place a stop's bound statement has in one script of its module, for the column check of {@link isPauseOfStop}: the stop's own binding for the sealed script, and for an accepted instance the column at which the instance's own map puts that statement ({@link boundColumnOfInstance}), because another layer's map can put the same statement at another column. The column is found once per binding.
   * @param stop - The declared stop.
   * @param module - The script the pause is in.
   * @returns The binding in that script's terms; `undefined` while the stop is not bound.
   * @example
   * ```ts
   * this.boundColumnIn(stop, this.moduleOf(stop, '1904')) // { line: 1, column: 4 } for a stop bound at 1:9 whose (middleware) instance maps that statement to column 4
   * ```
   */
  private boundColumnIn(
    stop: PreparedStop,
    module: StopModule,
  ): { line: number; column: number } | undefined {
    const { bound } = stop
    if (!bound || module === stop) return bound
    // Any module but the stop itself is an accepted instance ({@link moduleOf}).
    const instance = module as StopInstance
    if (
      instance.boundColumn?.line !== bound.line ||
      instance.boundColumn.column !== bound.column
    )
      instance.boundColumn = {
        ...bound,
        instanceColumn: boundColumnOfInstance(
          stop.verifier,
          instance.verifier,
          bound,
        ),
      }
    return { line: bound.line, column: instance.boundColumn.instanceColumn }
  }

  /** Gives {@link isPauseOfStop} what a pause's line is compared with: the stop, and as its bound line the run's binding or, before the run read it, the place where the stop's owned breakpoint is verified, so an adapter pause on another acceptable line is not taken for it. @example this.pauseTarget(stop).bound // { line: 33, column: 5 } for a server stop verified on its declared line */
  private pauseTarget(
    stop: PreparedStop,
    module: StopModule = stop,
  ): PauseStopTarget {
    const session = this.participants[stop.participant].selected
    return {
      ...stop,
      script: module.script,
      verifier: module.verifier,
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
    if (this.continuation) {
      const next = this.stops[this.stopIndex + 1]
      // A version 3 stop declared after a later operation has no turn until that operation's input is sent.
      return next && this.isStopDueBy(next, this.operationsDispatched)
        ? next
        : undefined
    }
    // The first stop's turn begins when the input is sent, not when the action is accepted: its line can run while the input is still being checked.
    if (this.isBeforeFirstInput()) return undefined
    return this.snapshotReady ? undefined : this.stops[this.stopIndex]
  }

  /** Tells {@link nextStopToPause} whether the current stop's turn has not begun: for versions 1 and 2, no stop was committed yet and the input was not sent; for version 3, the operation the stop follows was not sent. @example this.isBeforeFirstInput() // true while the action is accepted and its input is still being checked */
  private isBeforeFirstInput(): boolean {
    if (this.operationsConfiguration) {
      const stop = this.stops[this.stopIndex]
      return !stop || !this.isStopDueBy(stop, this.operationsDispatched)
    }
    return this.stopIndex === 0 && !this.operation?.inputDispatched
  }

  /**
   * Tells {@link onEvent} whether a participant's `stopped` came before the input the current stop waits for was sent, so the event is rejected as no stop of the declared operation.
   * Version 3 asks {@link isBeforeFirstInput} (the operation the stop follows); versions 1 and 2 ask whether the action's input was dispatched, for every stop of the run.
   * @returns `true` while the current stop's input is still unsent.
   * @example this.isBeforeStopInput() // true for a version 3 stop declared afterOperation 2 while only operation 1 was sent
   */
  private isBeforeStopInput(): boolean {
    // Version 3 stops each follow their own operation; versions 1 and 2 share the action's one input.
    return this.operationsConfiguration
      ? this.isBeforeFirstInput()
      : !this.operation?.inputDispatched
  }

  /**
   * Tells whether a stop's turn has begun once a number of operations were sent: a version 3 stop is armed once the operation it follows was sent (ENG-1); the stops of versions 1 and 2 are due as soon as any input is.
   * Called by {@link nextStopToPause}, {@link isBeforeFirstInput}, {@link armStopsOfOperation} and {@link prepareOwned}.
   * @param stop - The declared stop.
   * @param operationsSent - How many operations had their input sent.
   * @returns `true` when the stop's operation is among the sent ones.
   * @example this.isStopDueBy(stop, 1) // true for a stop declared afterOperation 1
   */
  private isStopDueBy(stop: PreparedStop, operationsSent: number): boolean {
    const afterOperation = afterOperationOf(stop)
    return afterOperation === undefined || afterOperation <= operationsSent
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
      this.stops
        .filter((stop) => stop.participant === name)
        .flatMap((stop) => [
          stop,
          ...[...stop.instances.values()].map((instance) => ({
            ...stop,
            script: instance.script,
            verifier: instance.verifier,
          })),
        ]),
      this.participants[name].scriptUrls,
    )
  }

  /**
   * Tells {@link retireUnannouncedPause} whether a held pause was resumed by someone other than the debug adapter or the run: it lasted longer than the adapter holds a pause of its own, and the run did not resume it itself.
   * @param held - The held pause that the runtime just resumed.
   * @param limitMs - The longest a pause of the adapter's own lasts ({@link adapterPauseLimitMs}).
   * @returns `true` for a pause that outlasted the bound and that the run did not resume; `false` otherwise.
   * @example
   * ```ts
   * this.isResumedBySomeoneElse(held, 3_000) // false for a page pause at a server stop's breakpoint that the run resumed after 4 s
   * ```
   */
  private isResumedBySomeoneElse(
    held: NonNullable<DebugParticipant['unannouncedPause']>,
    limitMs: number,
  ): boolean {
    return !held.resumedByRun && performance.now() - held.heldAtMs > limitMs
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
    const limitMs = this.adapterPauseLimitMs(name, held.event)
    participant.unannouncedPause = undefined
    // Nothing says who sent a resume, but the adapter resumes its own pauses within milliseconds: a pause that lasted longer was resumed by someone else, unless the run resumed it itself.
    if (this.isResumedBySomeoneElse(held, limitMs)) {
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
   * A page pause the run knows as the adapter's own pause at a module's first position ({@link isPageEntryPause}) is never the announced one: it hit the adapter's breakpoint alone, and the adapter resumes it once it has read that script's source map, which can take longer than the short bound. It has the adapter's bound in both phases, as in a run without browser stops ({@link unownedPagePauseLimitMs}).
   * A page pause in the page's stub of a declared server stop's module ({@link isPagePauseInServerStub}) is the pause of that server stop's breakpoint, or the adapter's own before it: the adapter resumes it, or reports it as a stop the run resumes, and may first resolve which breakpoints were hit. It has the adapter's bound in both phases too, as the same pause has in a run without browser stops.
   * @param name - The participant whose runtime resumed.
   * @param held - The held pause that was resumed.
   * @returns {@link REPOSITORY_ANNOUNCED_PAUSE_RESUME_LIMIT_MS} while the participant's accepted stop awaits its own pause and the held pause is neither the adapter's entry pause nor a page pause in a server stop's stub; otherwise {@link REPOSITORY_ADAPTER_PAUSE_LIMIT_MS}.
   * @example
   * ```ts
   * this.adapterPauseLimitMs('server', held.event) // 3000 while no server stop is accepted, and again once the accepted one is captured
   * ```
   */
  private adapterPauseLimitMs(
    name: Participant,
    held: Protocol.Debugger.PausedEvent,
  ): number {
    return this.awaitsOwnPause(name) && !this.isAdaptersPagePause(name, held)
      ? REPOSITORY_ANNOUNCED_PAUSE_RESUME_LIMIT_MS
      : REPOSITORY_ADAPTER_PAUSE_LIMIT_MS
  }

  /** Tells {@link adapterPauseLimitMs} whether a held pause is one of the two page pauses that are the debug adapter's to resume or to report, whatever the phase: its own pause at a module's first position ({@link isPageEntryPause}) or a pause in the page's stub of a declared server stop's module ({@link isPagePauseInServerStub}). @example this.isAdaptersPagePause('browser', held.event) // true for a pause in (app-pages-browser)/./app/lib/actions.ts while a server stop is declared in app/lib/actions.ts */
  private isAdaptersPagePause(
    name: Participant,
    event: Protocol.Debugger.PausedEvent,
  ): boolean {
    return (
      this.isPageEntryPause(name, event) ||
      this.isPagePauseInServerStub(name, event)
    )
  }

  /**
   * Tells {@link isAdaptersPagePause} whether a held pause is a page pause in the page's stub of a declared server stop's module ({@link isPageStubOfSource}), the pause {@link unownedPagePauseLimitMs} gives the adapter's bound in a run without browser stops.
   * A pause in the module of the stop that is accepted now is left out: when a browser stop is declared in that same file, a held pause there may be that stop's own, announced one, which the adapter never resumes by itself.
   * @param name - The participant whose runtime resumed.
   * @param event - The held pause.
   * @returns `true` for a page pause whose script is the stub of a declared server stop's module and is not the module of the stop whose turn it is; `false` otherwise, also for every server pause.
   * @example
   * ```ts
   * this.isPagePauseInServerStub('browser', held.event) // true for a pause in (app-pages-browser)/./app/lib/actions.ts while a server stop is declared in app/lib/actions.ts and the browser stop in app/ui/login-form.tsx
   * ```
   */
  private isPagePauseInServerStub(
    name: Participant,
    event: Protocol.Debugger.PausedEvent,
  ): boolean {
    if (
      name !== 'browser' ||
      isPauseInScript(event, this.stops[this.stopIndex]?.script)
    )
      return false
    const scriptUrl = this.pageScriptUrlOf(event)
    return this.stops.some(
      (stop) =>
        stop.participant === 'server' &&
        isPageStubOfSource(scriptUrl, stop.source.path),
    )
  }

  /** Tells {@link isAdaptersPagePause} and {@link pauseHeldBeforeTurn} whether a held pause is the page's pause at the debug adapter's own breakpoint at a module's first position ({@link isModuleEntryPause}, asked with the page's script addresses and the files of every declared stop); the rule was observed for the page only, so a server pause is never taken for one. @example this.isPageEntryPause('browser', held.event) // true for a pause at 1:1 of (app-pages-browser)/./app/lib/my-actions.ts that hit br:2:0:0:actions */
  private isPageEntryPause(
    name: Participant,
    event: Protocol.Debugger.PausedEvent,
  ): boolean {
    return (
      name === 'browser' &&
      isModuleEntryPause(
        event,
        this.pageScriptUrlOf(event),
        this.stops.map((stop) => stop.source.path),
      )
    )
  }

  /** Lists where each participant is still paused with no announced stop, server first, for the text of a deadline that expires meanwhile. A page pause the run itself is resuming is left out: a stop announced it, and the deadline's text names it with what became of that resume ({@link withPagePauseUnderResume}). @example this.unannouncedPausePlaces() // [{ participant: 'server', place: 'auth.ts:18' }] */
  private unannouncedPausePlaces(): UnannouncedPausePlace[] {
    return (['server', 'browser'] as const).flatMap((name) => {
      const held = this.participants[name].unannouncedPause
      return held && !held.resumedByRun
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
        // Without this the editor saves every modified editor of the learner as the session starts, and a cited source written then no longer is the file the run sealed.
        { suppressSaveBeforeStart: true },
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
    // A background worker shares the server's PID but cannot supply its route's native pauses.
    const mainThreads = matches.filter(
      (candidate) => candidate.identity.isMainThread,
    )
    if (!mainThreads.length) return false
    // A native adapter may expose one inspected worker through nested sessions; use only its deepest session.
    const selected = mainThreads.find((candidate) =>
      mainThreads.every((other) => {
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
      mainThreads.some(
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

  /**
   * Reserves one declared input synchronously; its protocol ACK never blocks state or continuation.
   * A version 3 run reserves its next declared operation ({@link reserveOperation}); versions 1 and 2 reserve their one click.
   * @param options - `learnerSecret`: the value the learner typed for an ask-learner operation (version 3 only).
   * @example run.action('click-once', 'repository-click')
   */
  action(
    key: string,
    action: RuntimeAction,
    options?: { learnerSecret?: string },
  ): { id: string; operationIndex?: number } {
    if (this.operationsConfiguration)
      return this.reserveOperation(key, action, options?.learnerSecret)
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
    // The input's first stop is the run's, so its causal window opens with the input.
    this.openCausalWindowOfStop(this.stopIndex)
    this.progressDeadline(ACTIVE_TIMEOUT_MS, () =>
      this.unreachedFirstStopReason(),
    )
    this.evidence.record('input.accepted', { id: this.operation.id, key })
    this.track(this.dispatchInput())
    return { id: this.operation.id }
  }
  /**
   * Lists the prepared text inputs a run writes at setup: the `initialInputs` of versions 1 and 2, none for version 3, whose texts are operations sent one by one.
   * @returns The selectors and texts to write before the first stop is armed.
   * @example this.preparedInputs() // => [{ selector: '#email', text: 'a@b.c' }] for a version 1 run that declares one
   */
  private preparedInputs(): { selector: string; text: string }[] {
    const configuration = this.definition.configuration
    return 'initialInputs' in configuration
      ? (configuration.initialInputs ?? [])
      : []
  }

  /**
   * Reserves the next declared operation of a version 3 run for `codebook_action`, and starts sending it in the background.
   * Why: the receipt returns at once and never waits on the page's acknowledgement or the value check; the operation's progress lives in {@link view}'s `operations`.
   * @param key - The action's key; a repeat of a reserved key finds its operation again.
   * @param action - Must be `repository-operation`.
   * @param learnerSecret - The value the learner typed for an ask-learner operation; required for one, kept in memory only.
   * @returns The operation's id and its 1-based index.
   * @throws `conflict:` when the action is another one, the run is not `ready`, or every operation was reserved; an ask-learner operation without its secret.
   * @example run.action('op-1', 'repository-operation') // => { id: '…', operationIndex: 1 }
   */
  private reserveOperation(
    key: string,
    action: RuntimeAction,
    learnerSecret: string | undefined,
  ): { id: string; operationIndex: number } {
    const configuration = this.operationsConfiguration!
    const known = this.operationIndexByKey.get(key)
    if (known !== undefined && action === REPOSITORY_OPERATION_ACTION)
      return { id: this.operationIds[known - 1]!, operationIndex: known }
    const index = this.operationsAccepted + 1
    if (
      action !== REPOSITORY_OPERATION_ACTION ||
      index > configuration.operations.length ||
      this.cleaning ||
      this.status !== 'ready'
    )
      throw new Error('conflict: wrong, repeated or unavailable input')
    this.alive()
    const operation = configuration.operations[index - 1]!
    const isAskLearner = operation.kind === 'text' && operation.secret
    if (isAskLearner && learnerSecret === undefined)
      throw new Error('conflict: the learner secret was not supplied')
    // The secret is known to the run from this moment, so every sink that masks exact occurrences covers it.
    if (learnerSecret !== undefined && isAskLearner)
      this.learnerSecretValues.add(learnerSecret)
    const id = randomUUID()
    this.operationIds.push(id)
    this.operationKeys.push(key)
    this.operationIndexByKey.set(key, index)
    this.operationsAccepted = index
    // The aggregate `operation` keeps the first operation's id and key; its dispatch and acknowledgement flags only move forward (a saved checkpoint must never take one back), and each operation's own progress lives in its record.
    this.operation ??= {
      id,
      key,
      inputDispatched: false,
      inputAcknowledged: false,
      afterVerified: false,
    }
    this.status = 'acting'
    // The stop this operation's input leads to opens its causal window with the input.
    const stop = this.stops[this.stopIndex]
    if (stop && afterOperationOf(stop) === index)
      this.openCausalWindowOfStop(this.stopIndex)
    this.progressDeadline(ACTIVE_TIMEOUT_MS, () =>
      this.unreachedOperationReason(index),
    )
    this.evidence.record('input.accepted', {
      id,
      key,
      operationIndex: index,
    })
    this.logOperation(index, 'info', `accepted (${operation.kind})`)
    this.track(this.dispatchOperation(index, learnerSecret))
    return { id, operationIndex: index }
  }

  /**
   * Words the failure of an operation whose input or stop did not follow within the active bound, read when the progress deadline expires.
   * @param index - The operation in flight (1-based).
   * @returns The declared stop's reason when the operation's stop was not hit, otherwise that the input was not sent or acknowledged.
   * @example this.unreachedOperationReason(2) // 'Operation 2 reached no verified pause: declared stop app/ui/form.tsx:22 was not hit within 20 s of the accepted action; its line must execute after the input'
   */
  private unreachedOperationReason(index: number): string {
    const stop = this.stops[this.stopIndex]
    const opening = `Operation ${index} reached no verified pause`
    if (
      stop &&
      afterOperationOf(stop) === index &&
      this.operationsDispatched >= index
    ) {
      const paused = this.unannouncedStopPlace(stop)
      if (paused)
        return `${opening}: declared stop ${this.declaredAt(stop)} is paused at ${paused}, but the debugger did not announce that stop within ${ACTIVE_TIMEOUT_MS / MILLISECONDS_PER_SECOND} s of the accepted action`
      return this.notHitFirstStopReason(stop, opening)
    }
    return this.operationsDispatched >= index
      ? `Operation ${index} was sent, but its input was not acknowledged within ${ACTIVE_TIMEOUT_MS / MILLISECONDS_PER_SECOND} s`
      : `Operation ${index} was accepted, but its input was not sent within ${ACTIVE_TIMEOUT_MS / MILLISECONDS_PER_SECOND} s`
  }

  /**
   * Sends one operation of a version 3 run: verifies the sources, arms the stops that follow it, waits for the page to settle, resolves its control, then sends its input once.
   * Why: a reserved operation is sent in the background so its receipt never waits on the page; called by {@link reserveOperation} through {@link track}, so a failure fails the run with its code.
   * @param index - The reserved operation (1-based).
   * @param learnerSecret - The ask-learner value, when the operation declares one.
   * @throws {@link OperationRefusal} for a refusal that sent nothing or a failure of the input; the run's own errors (a changed source, a registration) as they are.
   * @example this.track(this.dispatchOperation(1, undefined))
   */
  private async dispatchOperation(
    index: number,
    learnerSecret: string | undefined,
  ): Promise<void> {
    const configuration = this.operationsConfiguration!
    const total = configuration.operations.length
    const operation = configuration.operations[index - 1]!
    const record = this.operationRecords[index - 1]!
    this.moveForward(record, { state: 'sending' })
    await this.verifySources()
    await this.armStopsOfOperation(index)
    for (const stop of this.armedServerStops()) {
      await this.registeredStop(stop)
      this.alive()
    }
    // A Pages page that already left its entry path is refused first, as before the one click of version 1 and 2.
    if (index === 1 && this.pagesRun && (await this.pagesPathLeftBeforeClick()))
      return
    const port = this.operationPort()
    let hookFailure: unknown
    try {
      await waitForSettledPage(port, index)
      this.alive()
      await this.assertOperationConditions(index, total)
      const prepare = (): Promise<PreparedOperation> =>
        prepareOperation(port, { index, total, operation, learnerSecret })
      let prepared = await prepare()
      // The page reads yielded to the adapter's news: a place the source map alone refused is judged by the break locations first, and the control is resolved again.
      if (await this.judgeNewsRefusedBeforeInput()) {
        await prepared.discard()
        prepared = await prepare()
      }
      const hooks = this.operationHooks(index, operation)
      // Every image path is gated from before the secret is typed (ENG-5); a control that is no safe password control gets no input.
      if (prepared.isSecret)
        await this.armSecretGate(index, operation.selector, learnerSecret)
      await prepared.send({
        ...hooks,
        beforeInput: () => {
          try {
            hooks.beforeInput()
          } catch (error) {
            hookFailure = error
            throw error
          }
        },
      })
    } catch (error) {
      throw this.refusalOfOperationFailure(index, error, hookFailure)
    }
    this.settleOperation(index)
  }

  /**
   * Fails the run because the secret control stopped being safe to draw; capture stops for the rest of the run and the images stored before stay.
   * Called by the secret frame gate's failure hook; a version 3 run keeps the operation's failure fields (DX-5).
   * @param reason - Why the gate failed.
   * @example this.failSecretVisible('control-not-password')
   */
  private failSecretVisible(reason: string): void {
    // Arming reports its own refusal for this operation (not sent); the gate's synchronous failure must not fail the run first as the previous operation.
    if (this.armingSecretGate) return
    const message = `The control that received a secret stopped being a safe password control (${reason}); Codebook stopped recording and kept no image from that time.`
    if (this.operationsConfiguration && this.operationsDispatched > 0)
      this.failOperation(
        new OperationRefusal('SECRET_BECAME_VISIBLE', message, {
          operationIndex: this.operationsDispatched,
          sent: 'sent',
        }),
      )
    else this.fail(`SECRET_BECAME_VISIBLE: ${message}`)
  }

  /**
   * Arms the secret frame gate on the control that is about to receive a version 1 or 2 prepared secret text, and refuses the text unsent when the gate failed at once.
   * Called from the setup's classification hook of {@link prepareRepositoryInputs}; the value is armed with itself and joins the run's secret set (masked by value everywhere). A value shorter than {@link SECRET_FRAME_VALUE_COPY_MIN_CHARS} characters cannot be told from page text, so it is refused before it is typed, as the ask-learner box refuses it.
   * @param selector - The selector of the control that receives the text.
   * @param text - The prepared text about to be typed. Never logged.
   * @throws When the text is too short to watch, the control is no safe password control or the page could not answer; nothing was sent.
   * @example await this.armPreparedSecretGate('#password', 'correct horse')
   */
  private async armPreparedSecretGate(
    selector: string,
    text: string,
  ): Promise<void> {
    // A short value cannot be watched without withholding every image, so nothing is armed and nothing is sent.
    if (text.length < SECRET_FRAME_VALUE_COPY_MIN_CHARS)
      throw new Error(
        `SECRET_INPUT_VISIBLE: The prepared text for ${selector} was not sent: a secret shorter than ${SECRET_FRAME_VALUE_COPY_MIN_CHARS} characters cannot be told from page text, so a copy of it could reach the recorded frames. Use a test password of ${SECRET_FRAME_VALUE_COPY_MIN_CHARS} or more characters.`,
      )
    this.learnerSecretValues.add(text)
    this.armingSecretGate = true
    try {
      await this.secretFrameGate.arm(selector, text)
    } finally {
      this.armingSecretGate = false
    }
    this.alive()
    const reason = this.secretFrameGate.failure
    if (reason !== undefined)
      throw new Error(
        `SECRET_BECAME_VISIBLE: The prepared text was not sent: its control is not a safe password control (${reason}).`,
      )
  }

  /**
   * Arms the secret frame gate on the control that is about to receive the learner's secret, and refuses the input when the gate failed at once.
   * Called by {@link dispatchOperation} right before the input of an ask-learner operation; the gate stays armed for the rest of the run.
   * @param index - The operation (1-based).
   * @param selector - The selector of the secret control.
   * @param learnerSecret - The value about to be typed; the observer counts its occurrences in the page text before the input, so the copy baseline never depends on listener order. Never logged.
   * @throws {@link OperationRefusal} `SECRET_BECAME_VISIBLE` when the control is not a password control, or the page could not answer; nothing was sent.
   * @example await this.armSecretGate(2, '#password')
   */
  private async armSecretGate(
    index: number,
    selector: string,
    learnerSecret: string | undefined,
  ): Promise<void> {
    this.armingSecretGate = true
    try {
      await this.secretFrameGate.arm(selector, learnerSecret)
    } finally {
      this.armingSecretGate = false
    }
    this.alive()
    const reason = this.secretFrameGate.failure
    if (reason !== undefined)
      throw new OperationRefusal(
        'SECRET_BECAME_VISIBLE',
        `Operation ${index} was not sent: the control for the secret is not a safe password control (${reason}).`,
        { operationIndex: index, path: `operations[${index - 1}].selector` },
      )
  }

  /**
   * Gives what the run lets the operation engine use.
   * @returns The page channel, the navigation clock, the click-point reader and the run's liveness check.
   * @example prepareOperation(this.operationPort(), { index: 1, total: 4, operation })
   */
  private operationPort(): OperationPort {
    return {
      pageCdp: () => this.ownedPageCdp(),
      origins: () => loopbackOriginsOf(this.origin!, this.ownsIpv6Loopback),
      assertCurrent: (): void => this.alive(),
      millisecondsSinceNavigation: () =>
        performance.now() - this.lastNavigationAtMs,
      sleep: (delayMs) =>
        sleep(delayMs, undefined, { signal: this.abort.signal }),
      readClickPoint: async (selector) => {
        const scrolled = await this.scrollTargetIntoView(selector)
        const target = await this.readConditions([], selector)
        this.alive()
        if (!target.ready)
          throw new Error(
            `${selector} is not a unique visible enabled target (${target.failure?.reason ?? 'unavailable'})`,
          )
        return this.clickPoint(target, scrolled)
      },
    }
  }

  /**
   * Checks the run-level conditions that guard one operation, right before it is sent: the `before` conditions hold before the first, and the `after` conditions do not hold yet before the last (a result already true cannot prove the operation caused it).
   * @param index - The operation about to be sent (1-based).
   * @param total - How many operations the run declares.
   * @throws {@link OperationRefusal} `INPUT_NOT_ACCEPTED` naming `before` or `after` when a condition is not as required; nothing was sent.
   * @example await this.assertOperationConditions(1, 4)
   */
  private async assertOperationConditions(
    index: number,
    total: number,
  ): Promise<void> {
    const configuration = this.operationsConfiguration!
    if (index === 1) {
      const before = await this.readConditions(configuration.before)
      this.alive()
      if (!before.ready)
        throw new OperationRefusal(
          'INPUT_NOT_ACCEPTED',
          `Operation 1 was not sent: the run's before conditions no longer hold on the page (${before.failure?.reason ?? 'unavailable'}).`,
          { operationIndex: 1, path: 'before' },
        )
    }
    if (index === total) {
      const prior = await this.readConditions(configuration.after)
      this.alive()
      if (prior.ready)
        throw new OperationRefusal(
          'INPUT_NOT_ACCEPTED',
          `Operation ${index} was not sent: the run's after conditions already hold before the last operation, so its result could not prove the operation caused it. Declare an after condition that only the result satisfies.`,
          { operationIndex: index, path: 'after' },
        )
    }
  }

  /**
   * Builds the moments of one operation's input for the engine: the dispatch, the acknowledgement and the value check each move the operation's record forward and are journaled without any text.
   * @param index - The operation (1-based).
   * @param operation - Its declaration, of which only the kind and selector are journaled.
   * @returns The hooks the engine calls.
   * @example await prepared.send(this.operationHooks(1, operation))
   */
  private operationHooks(
    index: number,
    operation: OperationsRepositoryConfiguration['operations'][number],
  ) {
    const record = this.operationRecords[index - 1]!
    return {
      beforeInput: (): void => {
        this.assertServerRegistrationsHeld()
        this.operationsDispatched = index
        this.operation!.inputDispatched = true
        this.evidence.record('input.dispatched', {
          key: this.operationKeys.at(index - 1),
          operationIndex: index,
          kind: operation.kind,
        })
        this.logOperation(index, 'info', `sending (${operation.kind})`)
      },
      acknowledged: (): void => {
        this.moveForward(record, { ack: 'yes' })
        this.operation!.inputAcknowledged = true
        this.evidence.record('input.acknowledged', { operationIndex: index })
        this.logOperation(index, 'info', 'acknowledged')
      },
      valueChecked: (passed: boolean): void => {
        this.moveForward(record, { valueCheck: passed ? 'passed' : 'failed' })
        this.logOperation(
          index,
          'info',
          `value check ${passed ? 'passed' : 'failed'}`,
        )
      },
    }
  }

  /**
   * Arms the first stop that follows an operation, just before that operation's input; a version 3 stop is never armed earlier, so its line cannot pause the run before its turn (ENG-1).
   * Later stops of the same operation are armed inside the continuation that precedes them, as before ({@link continue}).
   * @param index - The operation about to be sent (1-based).
   * @example await this.armStopsOfOperation(2)
   */
  private async armStopsOfOperation(index: number): Promise<void> {
    const stop = this.stops[this.stopIndex]
    if (!stop || afterOperationOf(stop) !== index || this.armedStops.has(stop))
      return
    await this.armStop(stop)
    this.armedStops.add(stop)
    this.alive()
  }

  /**
   * Moves an operation's record forward; a value never goes back, and `done` or `failed` is final (ENG-2).
   * @param record - The operation's record.
   * @param patch - The fields to advance.
   * @example this.moveForward(record, { ack: 'yes' })
   */
  private moveForward(
    record: OperationRecord,
    patch: Partial<
      Pick<OperationRecord, 'state' | 'ack' | 'valueCheck' | 'effect'>
    >,
  ): void {
    if (record.state === 'done' || record.state === 'failed') return
    const stateRank = {
      'not-run': 0,
      sending: 1,
      paused: 2,
      done: 3,
      failed: 3,
    }
    const effectRank = { pending: 0, dispatched: 1, 'after-verified': 2 }
    if (patch.state && stateRank[patch.state] >= stateRank[record.state])
      record.state = patch.state
    if (patch.ack) record.ack = patch.ack
    if (patch.valueCheck && record.valueCheck === 'pending')
      record.valueCheck = patch.valueCheck
    if (patch.effect && effectRank[patch.effect] >= effectRank[record.effect])
      record.effect = patch.effect
  }

  /**
   * Marks the operation a committed stop belongs to as paused; called when the stop's observation is published.
   * @param stop - The stop whose pause was committed.
   * @example this.markOperationPaused(stop)
   */
  private markOperationPaused(stop: PreparedStop): void {
    const index = afterOperationOf(stop)
    const record =
      index === undefined ? undefined : this.operationRecords[index - 1]
    if (record) this.moveForward(record, { state: 'paused' })
  }

  /**
   * Gives the stop a continuation arms before it resumes: the stop after the one being continued, except that a version 3 stop that follows a later operation is armed in that operation's turn ({@link armStopsOfOperation}), not inside this continuation.
   * @param continuedStop - The stop being continued.
   * @returns The next declared stop to arm now; `undefined` when there is none, or it follows a later operation.
   * @example this.stopArmedAfter(this.stops[0]!) // this.stops[1] for a version 1 run, undefined for a version 3 stop declared after the next operation
   */
  private stopArmedAfter(
    continuedStop: PreparedStop,
  ): PreparedStop | undefined {
    const nextStop = this.stops[this.stopIndex + 1]
    if (!nextStop || !this.operationsConfiguration) return nextStop
    return afterOperationOf(nextStop) === afterOperationOf(continuedStop)
      ? nextStop
      : undefined
  }

  /**
   * Returns the run to `ready` for the next operation, or observes the result after the last one, once an operation is done: its input was acknowledged, its value checked, and every stop declared for it continued (ENG-1).
   * Called after an operation's input returned ({@link dispatchOperation}) and after the last stop of an operation was continued ({@link beginAfter}); it acts once per operation.
   * @param index - The operation (1-based).
   * @example this.settleOperation(1)
   */
  private settleOperation(index: number): void {
    const record = this.operationRecords[index - 1]
    const stop = this.stops[this.stopIndex]
    // A stop of this operation (or an earlier one) is still ahead or paused: the operation is not done.
    const hasPendingStop =
      stop !== undefined && (afterOperationOf(stop) ?? Infinity) <= index
    if (
      !record ||
      this.cleaning ||
      this.status === 'failed' ||
      record.state === 'done' ||
      record.ack !== 'yes' ||
      record.valueCheck === 'pending' ||
      hasPendingStop ||
      this.operationsSettling.has(index)
    )
      return
    this.operationsSettling.add(index)
    this.track(this.completeOperation(index))
  }

  /**
   * Finishes one operation after its input and stops: checks its own `after` conditions, then offers the next operation (`ready`) or, after the last, observes the run-level `after` conditions.
   * @param index - The operation (1-based).
   * @throws {@link OperationRefusal} `OPERATION_AFTER_NOT_MET` when the operation's `after` conditions do not hold in time.
   * @example this.track(this.completeOperation(2))
   */
  private async completeOperation(index: number): Promise<void> {
    const configuration = this.operationsConfiguration!
    const operation = configuration.operations[index - 1]!
    const record = this.operationRecords[index - 1]!
    const isLast = index === configuration.operations.length
    // Which wait the run's deadline, armed before both and ending first, interrupts: it words that wait's failure.
    let waiting: OperationWait = 'pauses'
    this.lastOperationAfterFailure = undefined
    this.progressDeadline(ACTIVE_TIMEOUT_MS, () =>
      this.operationDeadlineText(index, waiting),
    )
    try {
      await waitUntil(
        () => this.adapterPausesRetired(),
        ADAPTER_PAUSE_RETIREMENT_WAIT_DESCRIPTION,
        ACTIVE_TIMEOUT_MS,
        this.abort.signal,
      )
      this.alive()
      // The operation's own conditions prove its effect; the last operation without any takes the run's, observed below.
      waiting = operation.after ? 'after' : 'run-after'
      if (operation.after) {
        await this.waitForConditions(operation.after)
        this.alive()
        this.moveForward(record, { effect: 'after-verified' })
      } else if (!isLast) this.moveForward(record, { effect: 'dispatched' })
    } catch (error) {
      this.alive()
      throw this.refusalOfOperationFailure(index, error, undefined)
    }
    if (isLast) {
      this.status = 'resuming'
      // The operation's own conditions held; from here the run-level conditions are what the progress deadline interrupts.
      waiting = 'run-after'
      await this.observeAfter(undefined)
      return
    }
    this.moveForward(record, { state: 'done' })
    this.logOperation(index, 'info', `done (${record.effect})`)
    clearTimeout(this.progressTimer)
    this.status = 'ready'
    await this.persist()
  }

  /**
   * Words the failure of the wait {@link completeOperation} was in when the progress deadline expired; it records the operation's failure fields first.
   * The deadline and the waits share one bound and the deadline was armed first, so it ends them: the adapter pause wait fails as an unexpected failure with its log id, the operation's own after conditions as `OPERATION_AFTER_NOT_MET` naming the condition that did not hold.
   * @param index - The operation (1-based).
   * @param waiting - The wait that was running; `run-after` is the last operation's run-level after wait, worded by {@link afterDeadlineReason}.
   * @returns The coded failure text.
   * @example this.operationDeadlineText(4, 'after') // 'OPERATION_AFTER_NOT_MET: Operation 4 (Create Invoice) was sent, but …'
   */
  private operationDeadlineText(index: number, waiting: OperationWait): string {
    let refusal: OperationRefusal
    if (waiting === 'pauses')
      refusal = this.unexpectedOperationRefusal(
        index,
        waitTimeoutText(ADAPTER_PAUSE_RETIREMENT_WAIT_DESCRIPTION),
      )
    else if (waiting === 'after')
      refusal = this.afterNotMet(
        index,
        this.operationAfterTimeoutText(),
        'operation',
      )
    else refusal = this.afterNotMet(index, this.afterDeadlineReason(), 'run')
    this.recordOperationFailure(refusal)
    return formatRefusalFailure(refusal.code, refusal.message)
  }

  /**
   * Words the timeout of the current operation's own after conditions, naming the condition that did not hold when the page answered one.
   * @returns The timeout text, shared by the wait's own error and the run's deadline.
   * @example this.operationAfterTimeoutText() // "Timed out waiting for the operation's after conditions: condition 2 not-visible"
   */
  private operationAfterTimeoutText(): string {
    const failure = this.lastOperationAfterFailure
    return `Timed out waiting for the operation's after conditions${failure ? `: condition ${(failure.conditionIndex ?? 0) + 1} ${failure.reason}` : ''}`
  }

  /**
   * Builds the `OPERATION_AFTER_NOT_MET` refusal of an operation that was sent whose result did not show in time.
   * @param index - The operation (1-based).
   * @param detail - What the page showed or did not show.
   * @param scope - The conditions that failed: the operation's own `after`, or the run-level `after` the last operation takes as its result (also after its own `after` held).
   * @returns The refusal, which names the configuration path of the conditions that failed.
   * @example this.afterNotMet(4, 'Timed out waiting for configured after conditions', 'run')
   */
  private afterNotMet(
    index: number,
    detail: string,
    scope: 'operation' | 'run',
  ): OperationRefusal {
    const configuration = this.operationsConfiguration!
    const operation = configuration.operations[index - 1]!
    const isRunLevel = scope === 'run'
    return new OperationRefusal(
      'OPERATION_AFTER_NOT_MET',
      `Operation ${index} (${operation.title}) was sent, but its result could not be confirmed: ${detail}`,
      {
        operationIndex: index,
        path: isRunLevel ? 'after' : `operations[${index - 1}].after`,
        sent: 'sent',
      },
    )
  }

  /**
   * Turns what stopped an operation into the refusal the run fails with: a refusal stays as it is, the run's own errors and a hook's refusal stay as they are, and anything the page or the transport raised becomes `RUN_FAILED_UNEXPECTEDLY` with a log id (the cause goes to Output > Codebook only).
   * @param index - The operation (1-based).
   * @param error - What was thrown.
   * @param hookFailure - The error the run's own `beforeInput` hook raised, which reaches the run unchanged.
   * @returns What to throw.
   * @example throw this.refusalOfOperationFailure(2, error, hookFailure)
   */
  private refusalOfOperationFailure(
    index: number,
    error: unknown,
    hookFailure: unknown,
  ): unknown {
    if (
      error instanceof OperationRefusal ||
      error instanceof StudyError ||
      error === hookFailure ||
      this.cleaning ||
      this.abort.signal.aborted ||
      this.status === 'failed'
    )
      return error
    // Only the wait for the operation's own after conditions means the result did not show; any other timeout is unexpected.
    if (error instanceof OperationAfterTimeoutError)
      return this.afterNotMet(index, thrownMessage(error), 'operation')
    return this.unexpectedOperationRefusal(index, thrownMessage(error))
  }

  /**
   * Builds the `RUN_FAILED_UNEXPECTEDLY` refusal of an operation, journaling the cause to Output > Codebook only.
   * @param index - The operation (1-based).
   * @param cause - What went wrong; never shown to the agent.
   * @returns The refusal with the log id; `sent` follows whether the operation's input was dispatched.
   * @example throw this.unexpectedOperationRefusal(2, 'Timed out waiting for adapter pause retirement')
   */
  private unexpectedOperationRefusal(
    index: number,
    cause: string,
  ): OperationRefusal {
    const operation = this.operationsConfiguration!.operations[index - 1]!
    this.logOperation(index, 'error', `unexpected failure: ${cause}`)
    return new OperationRefusal(
      'RUN_FAILED_UNEXPECTEDLY',
      `Operation ${index} (${operation.title}) failed unexpectedly. See Output > Codebook, log id ${this.operationLogId(index)}.`,
      {
        operationIndex: index,
        sent: this.operationsDispatched >= index ? 'sent' : 'not-sent',
      },
    )
  }

  /**
   * Fails the run with an operation's coded refusal and keeps its fields for the run resource and the error the agent reads (DX-5).
   * Called by {@link track} for any {@link OperationRefusal} an activity throws and by {@link onOperationsNavigation}.
   * @param refusal - The refusal.
   * @example this.failOperation(new OperationRefusal('OPTION_NOT_AVAILABLE', '…', { operationIndex: 1 }))
   */
  private failOperation(refusal: OperationRefusal): void {
    if (
      this.cleaning ||
      this.status === 'failed' ||
      this.status === 'completed'
    )
      return
    this.recordOperationFailure(refusal)
    this.fail(formatRefusalFailure(refusal.code, refusal.message))
  }

  /**
   * Records an operation's first failure: the record turns `failed`, the fields are kept for the resource, and one Output > Codebook line carries the log id.
   * @param refusal - The refusal.
   * @example this.recordOperationFailure(refusal)
   */
  private recordOperationFailure(refusal: OperationRefusal): void {
    if (this.operationFailure) return
    const record = this.operationRecords[refusal.operationIndex - 1]
    if (record) this.moveForward(record, { state: 'failed' })
    // An earlier operation of the run reached the page, so a rerun would repeat it: the side effects are unknown whatever this operation's own fact is.
    const earlierDispatched =
      Math.min(this.operationsDispatched, refusal.operationIndex - 1) >= 1
    const sideEffects = earlierDispatched ? 'unknown' : refusal.sideEffects
    this.operationFailure = {
      code: refusal.code,
      operationIndex: refusal.operationIndex,
      path: refusal.path,
      sent: refusal.sent,
      sideEffects,
      logId: this.operationLogId(refusal.operationIndex),
    }
    this.logOperation(
      refusal.operationIndex,
      'error',
      `refused ${refusal.code} (sent: ${refusal.sent}, side effects: ${sideEffects})`,
    )
  }

  /**
   * Names the Output > Codebook line of an operation: the run's address and the operation's index.
   * @param index - The operation (1-based).
   * @returns `<runId>#<index>`.
   * @example this.operationLogId(2) // => '4f1c…#2'
   */
  private operationLogId(index: number): string {
    return `${this.options.control?.runId ?? this.id}#${index}`
  }

  /**
   * Writes one structured line to Output > Codebook for an operation event; the line holds the run, the operation and the event, never a typed value.
   * @param index - The operation (1-based).
   * @param level - `error` for a refusal or failure.
   * @param text - The event.
   * @example this.logOperation(1, 'info', 'sending (click)')
   */
  private logOperation(
    index: number,
    level: 'info' | 'error',
    text: string,
  ): void {
    const total = this.operationsConfiguration?.operations.length ?? 0
    try {
      this.options.control?.outputLog?.({
        level,
        text: this.maskRunText(
          `Run ${this.options.control.runId ?? this.id}: operation ${index}/${total} ${text} [log ${this.operationLogId(index)}]`,
        ),
      })
    } catch {
      // The line is also in the run's journal; the channel has nowhere to write.
    }
  }

  /**
   * Ends a Next version 3 run whose page loaded a new document before the last operation was sent; called for each main-frame load after the entry page.
   * A load before the first operation is the entry page or its redirect, and a load after the last operation is the result.
   * @example this.onOperationsNavigation()
   */
  private onOperationsNavigation(): void {
    if (!this.firstNavigationSeen) {
      this.firstNavigationSeen = true
      return
    }
    const total = this.operationsConfiguration!.operations.length
    const sent = this.operationsDispatched
    if (sent === 0) return
    if (sent >= total) {
      this.evidence.record('page.navigated-after-last-operation')
      return
    }
    this.failOperation(
      new OperationRefusal(
        'NAVIGATION_BEFORE_LAST_OPERATION',
        `The page loaded a new document after operation ${sent} and before operation ${sent + 1} could be sent, so the next operation would act on another page.`,
        { operationIndex: sent, sent: 'sent' },
      ),
    )
  }

  /** Verifies sources, exact origin and a unique enabled center immediately before the one mouse sequence. The page is read once more, and only once, when the adapter's news about a server stop's breakpoint arrived during the first read and had to be judged by the debugger's break locations ({@link judgeNewsRefusedBeforeInput}); the synchronous receipt check stays the last step before the input. @example await this.dispatchInput() */
  private async dispatchInput(): Promise<void> {
    await this.verifySources()
    for (const stop of this.armedServerStops()) {
      await this.registeredStop(stop)
      this.alive()
    }
    // A Pages page that already left its entry path on the client is refused first: the other page rarely holds the click target, whose read would end the run uncoded.
    if (this.pagesRun && (await this.pagesPathLeftBeforeClick())) return
    let point = await this.clickPointBeforeInput()
    // The DOM reads yielded to the adapter's news: a place the source map alone refused is judged by the break locations first, and the page, which went on meanwhile, is read again.
    if (await this.judgeNewsRefusedBeforeInput())
      point = await this.clickPointBeforeInput()
    // A Pages page that left its entry path while the click target was read receives no click either.
    if (this.pagesRun && (await this.pagesPathLeftBeforeClick())) return
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
   * Reads a Pages page's pathname right before the click and, when it left the entry path, fails the run with the coded `NEXT_ENTRY_REDIRECTED` text instead of clicking.
   * Called by {@link dispatchInput}, whose failures reach the run as plain text, so the code is written into the failure here ({@link formatRefusalFailure}).
   * @returns `true` when the run was failed and no click may be sent; `false` when the page is still at its entry path.
   * @throws Any other failure of the read.
   * @example
   * if (await this.pagesPathLeftBeforeClick()) return
   */
  private async pagesPathLeftBeforeClick(): Promise<boolean> {
    const moment =
      this.preparedInputs().length > 0
        ? 'before-click-after-inputs'
        : 'before-click-no-inputs'
    try {
      await this.refusePagesPathLeft(moment)
      return false
    } catch (error) {
      if (
        !(error instanceof StudyError) ||
        error.code !== 'NEXT_ENTRY_REDIRECTED'
      )
        throw error
      this.fail(formatRefusalFailure('NEXT_ENTRY_REDIRECTED', error.message))
      return true
    }
  }

  /** Lists the server stops whose owned breakpoint exists, for the receipt reads of {@link dispatchInput}, {@link judgeNewsRefusedBeforeInput} and {@link assertServerRegistrationsHeld}. @example this.armedServerStops() // [stops[0]] before the first input of a run whose first stop is a server stop */
  private armedServerStops(): PreparedStop[] {
    // A retired breakpoint belongs to a stop already continued (a later operation of a version 3 run), whose registration is no longer read.
    return this.stops.filter(
      (candidate) =>
        candidate.participant === 'server' &&
        candidate.breakpoint &&
        !candidate.breakpoint.retired,
    )
  }

  /**
   * Reads the page right before the input, for {@link dispatchInput}: it scrolls a click target outside the viewport into view once ({@link scrollClickTargetIntoView}), then reads the before conditions with the click target, then the after conditions, which must not hold yet.
   * @returns The center of the unique enabled click target, in viewport coordinates.
   * @throws When the before conditions do not hold or name no point ({@link clickPoint}), and when the after conditions already hold: a result that is true before the click cannot prove this operation caused it.
   * @example
   * ```ts
   * const point = await this.clickPointBeforeInput() // { x: 120, y: 48 }
   * ```
   */
  private async clickPointBeforeInput(): Promise<{ x: number; y: number }> {
    const scrolled = await this.scrollClickTargetIntoView()
    const target = await this.readDom('before')
    this.alive()
    const point = this.clickPoint(target, scrolled)
    // A result predicate already true before the click cannot prove this operation caused the result.
    const priorResult = await this.readDom('after')
    this.alive()
    if (priorResult.ready)
      throw new Error(
        'Configured after conditions were already true before application input',
      )
    return point
  }

  /**
   * Judges news about an armed server stop's breakpoint that arrived while {@link dispatchInput} read the page and that the source map alone refused, before the synchronous receipt check would end the run with that refusal: the debugger's break locations need a round trip, which {@link registeredStop} makes.
   * @returns `true` when at least one armed server stop had a refused place and its receipt stands again, so the caller reads the page once more; `false` when no stop had one.
   * @throws The registration failure of {@link registeredStop} when the break locations keep the refusal, or the registration was refused for another reason.
   * @example
   * ```ts
   * if (await this.judgeNewsRefusedBeforeInput()) point = await this.clickPointBeforeInput()
   * ```
   */
  private async judgeNewsRefusedBeforeInput(): Promise<boolean> {
    const session = this.participants.server.selected
    const refused = this.armedServerStops().filter(
      (stop) => session && stop.breakpoint!.refusedPlace(session),
    )
    for (const stop of refused) {
      await this.registeredStop(stop)
      this.alive()
    }
    return refused.length > 0
  }

  /**
   * Takes the point of the one mouse sequence from what the page answered for the before conditions, for {@link dispatchInput} right after that read.
   * @param target - The answer of the page for the `before` phase.
   * @param scrolled - Whether the click step's scroll right before that read scrolled the page ({@link scrollClickTargetIntoView}).
   * @returns The center of the unique enabled click target, in viewport coordinates.
   * @throws When the before conditions no longer hold or the page named no point: a target outside the viewport after a real scroll stayed there, and one that left the viewport without a scroll changed before input.
   * @example
   * ```ts
   * this.clickPoint({ ready: true, x: 120, y: 48 }, false) // { x: 120, y: 48 }
   * this.clickPoint({ ready: true }, true)                // throws 'Click target stayed outside the viewport after Codebook scrolled it into view'
   * ```
   */
  private clickPoint(
    target: z.infer<typeof domResultSchema>,
    scrolled: boolean,
  ): { x: number; y: number } {
    if (!target.ready)
      throw new Error('Click target or before conditions changed before input')
    // A target that holds without a point lies outside the viewport, so no point can be hit-tested: after a real scroll it stayed there; without one, it moved out after the scroll found it inside.
    if (target.x === undefined || target.y === undefined)
      throw new Error(
        scrolled
          ? 'Click target stayed outside the viewport after Codebook scrolled it into view'
          : 'Click target or before conditions changed before input',
      )
    return { x: target.x, y: target.y }
  }

  /**
   * Scrolls the click target to the middle of the viewport when its centre lies outside it ({@link configuredScrollExpression}), after the page's origin is verified.
   * Called by {@link clickPointBeforeInput} once per read of the click point, right before that read, so the condition reads ({@link readDom}) stay reads. Only whether the page scrolled is read here, so {@link clickPoint} names a target outside the viewport truthfully; the read that follows names a missing, hidden or obscured target.
   * @returns `true` when the page answered that it scrolled; `false` for a target it left in place, and for any other answer.
   * @throws When the page left its owned application origin, or the run is no longer alive.
   * @example
   * ```ts
   * await this.scrollClickTargetIntoView() // => true: a "Load Newer" button below a long list now sits in the middle of the viewport
   * ```
   */
  private async scrollClickTargetIntoView(): Promise<boolean> {
    // Only versions 1 and 2 reach this: they declare the one click's selector.
    return this.scrollTargetIntoView(this.declaredAction().selector!)
  }

  /**
   * Scrolls a click target to the middle of the viewport when its centre lies outside it; the body of {@link scrollClickTargetIntoView} and the click step of a version 3 operation.
   * @param selector - The click target.
   * @returns `true` when the page answered that it scrolled; `false` for a target it left in place, and for any other answer.
   * @throws When the page left its owned application origin, or the run is no longer alive.
   * @example await this.scrollTargetIntoView('button[type=submit]')
   */
  private async scrollTargetIntoView(selector: string): Promise<boolean> {
    const cdp = await this.ownedPageCdp()
    const response = await cdp.request('Runtime.evaluate', {
      expression: configuredScrollExpression(selector),
      returnByValue: true,
    })
    this.alive()
    return (
      scrollResultSchema.safeParse(response.result.value).data?.scrolled ===
      true
    )
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
    for (const stop of this.armedServerStops()) {
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
    this.closeWindowAtLearnerPause(session, request)
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
      for (const stop of this.stops) {
        const refusedBefore = stop.breakpoint?.refusedPlace(session)
        stop.breakpoint?.onEvent(session, event)
        // News of the stop's own participant that the source map alone refused is judged once more by the debugger's break locations as it arrives, so the stop's pause is matched at once and a deadline names no refusal they would lift.
        if (
          stop.participant === name &&
          stop.breakpoint?.refusedPlace(session) !== refusedBefore
        )
          this.track(this.retakeNewsByBreakLocations(stop, session))
      }
    if (event.event === 'stopped') {
      const body: DebugProtocol.StoppedEvent['body'] = event.body
      // The editor sends a server stop's breakpoint to the browser session too, and the page's stub of a "use server" module maps the same line: that browser pause belongs to the server stop's breakpoint, not to a stop of the page, so it is resumed.
      const serverStop =
        name === 'browser'
          ? this.serverStopOfBrowserPause(session, body)
          : undefined
      this.recordStopVerdict(session, participant, serverStop !== undefined)
      if (serverStop) {
        this.track(
          this.resumeServerBreakpointInBrowser(session, body, serverStop),
        )
        return
      }
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
        this.isBeforeStopInput() ||
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
      // The accepted stop ends its causal window: the session's next stop needs an input, a continuation or a resume of the run's own.
      codebookStopLedger.closeWindow([session.id])
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

  /**
   * Finds the declared server stop whose owned breakpoint a browser `stopped` event names, for {@link onEvent} before it judges that event as a stop of the page.
   * The editor sends every breakpoint to every debug session, so a server stop's breakpoint is set in the browser session as well. The page holds a stub of a `"use server"` module (the client's reference to each exported action), and when the stub's source map maps the stop's line, the debugger pauses the page there when the stub is evaluated and reports a `stopped` whose breakpoint ids name that breakpoint. A pause that names no id, or also a breakpoint that is not a server stop's, is left to the run's own rules.
   * @param session - The browser session that sent the event.
   * @param body - The event's body: its thread and the adapter's ids of the breakpoints it hit.
   * @returns The server stop whose breakpoint every hit id names, while the browser holds no pause, queued stop or unacknowledged continuation of its own; `undefined` otherwise.
   * @example
   * ```ts
   * this.serverStopOfBrowserPause(session, { reason: 'breakpoint', threadId: 1, hitBreakpointIds: [12] }) // the server stop declared at app/lib/actions.ts:27 whose breakpoint the browser adapter calls 12
   * ```
   */
  private serverStopOfBrowserPause(
    session: vscode.DebugSession,
    body: DebugProtocol.StoppedEvent['body'],
  ): PreparedStop | undefined {
    // A pause of the browser's own, or one whose thread or breakpoints are unknown, is never resumed by the run.
    if (!Number.isInteger(body.threadId) || this.browserHoldsOwnPause())
      return undefined
    return this.serverStopOfEveryBreakpoint(
      session,
      body.hitBreakpointIds ?? [],
    )
  }

  /**
   * Says whether the browser holds a pause, a queued stop or an unacknowledged continuation of its own, for {@link serverStopOfBrowserPause}: a `stopped` that arrives then is never taken for a pause in a stub of a server module.
   * @returns `true` while the browser's gate holds a pause, its announced stop is queued, or its continuation still waits for the adapter's `continued`.
   * @example
   * ```ts
   * this.browserHoldsOwnPause() // true while a declared browser stop is being inspected
   * ```
   */
  private browserHoldsOwnPause(): boolean {
    return Boolean(
      this.participants.browser.gate.current ||
      this.pendingDapStop?.participant === 'browser' ||
      this.awaitsContinued('browser'),
    )
  }

  /**
   * Finds the server stop a browser pause names with every breakpoint it hit, for {@link serverStopOfBrowserPause} once the pause is known to be none of the browser's own.
   * @param session - The browser session that sent the `stopped` event.
   * @param hitIds - The adapter's ids of the breakpoints the pause hit; empty when the event named none.
   * @returns The server stop whose owned breakpoint the first id names, when every id names a server stop's breakpoint in this session; `undefined` when one of them does not, and for a pause that names no breakpoint.
   * @example
   * ```ts
   * this.serverStopOfEveryBreakpoint(session, [12]) // the server stop whose breakpoint the browser adapter calls 12
   * ```
   */
  private serverStopOfEveryBreakpoint(
    session: vscode.DebugSession,
    hitIds: readonly number[],
  ): PreparedStop | undefined {
    const serverStopOf = (id: number): PreparedStop | undefined =>
      this.stops.find(
        (stop) =>
          stop.participant === 'server' &&
          stop.breakpoint?.acknowledgedId(session) === id,
      )
    // Every breakpoint the pause hit must be a server stop's, so a breakpoint of the page's own is never resumed past.
    return hitIds.length > 0 && hitIds.every((id) => serverStopOf(id))
      ? serverStopOf(hitIds[0]!)
      : undefined
  }

  /**
   * Resumes a browser pause at a server stop's breakpoint ({@link serverStopOfBrowserPause}), for {@link onEvent}: the run sends the `continue` itself and reserves it, so {@link onRequest} does not take it for a manual resume, and journals `dap.server-breakpoint-browser-resume-requested` when it sends the request and `dap.server-breakpoint-browser-stop-resumed` once the adapter answered it: a request the adapter refuses or never answers leaves no entry that says resumed. The runtime pause it ends is retired by {@link onCdpResumed} like a pause the debugger made for itself.
   * @param session - The browser session that is paused.
   * @param body - The `stopped` event's body; its thread is resumed.
   * @param stop - The server stop whose breakpoint the page paused at.
   * @throws When the adapter refuses the `continue` or does not answer it within the bound: the failure that names the page's pause, the declared stop and what the request failed with ({@link pageResumeFailure}); {@link track} then ends the run with that reason.
   * @example
   * ```ts
   * this.track(this.resumeServerBreakpointInBrowser(session, body, stop))
   * ```
   */
  private async resumeServerBreakpointInBrowser(
    session: vscode.DebugSession,
    body: DebugProtocol.StoppedEvent['body'],
    stop: PreparedStop,
  ): Promise<void> {
    this.participants.browser.expectedResumeRequests++
    // The run's own resume of a server stop's page pause: the stop the adapter reports next for this session is the run's.
    codebookStopLedger.openWindow([session.id])
    // From here on the page's pause is the run's own to resume, also when its runtime event is read only later.
    this.pageResumesUnderWay.push(stop)
    this.ownPagePauseUnderResume()
    const detail = {
      participant: 'browser',
      threadId: body.threadId,
      hitBreakpointIds: body.hitBreakpointIds,
      declared: this.declaredAt(stop),
      inputDispatched: this.operation?.inputDispatched ?? false,
    }
    // The journal says what happened: the request now, the resume only once the adapter answered it.
    this.evidence.record(
      'dap.server-breakpoint-browser-resume-requested',
      detail,
    )
    try {
      await awaitResponse(
        session.customRequest('continue', { threadId: body.threadId }),
        'browser resume of a server stop breakpoint',
        this.abort.signal,
      )
    } catch (error) {
      throw this.pageResumeFailure(stop, error)
    }
    // The debugger answered: the request is no longer under way, whatever resumes of the page were read meanwhile; a pause of the page that is read only now is still this resume's for the debugger's bound.
    this.pageResumeEnded(stop)
    this.answeredPageResume = { stop, answeredAtMs: performance.now() }
    this.evidence.record('dap.server-breakpoint-browser-stop-resumed', detail)
  }

  /**
   * Takes one resume of the run's own off those under way ({@link pageResumesUnderWay}); called by {@link resumeServerBreakpointInBrowser} once the debugger answered its request and by {@link pageResumeFailure} when the request failed.
   * @param stop - The declared server stop of the request that ended; the oldest resume under way for that stop is taken.
   * @example
   * ```ts
   * this.pageResumeEnded(stop) // 2 resumes under way become 1
   * ```
   */
  private pageResumeEnded(stop: PreparedStop): void {
    const ended = this.pageResumesUnderWay.indexOf(stop)
    if (ended >= 0) this.pageResumesUnderWay.splice(ended, 1)
  }

  /**
   * Words the failure of the run's own resume of a page pause at a server stop's breakpoint, for {@link resumeServerBreakpointInBrowser} when the debugger refused its request or did not answer it within the bound: the debugger's bare text ("Thread is not paused") says neither what was paused nor that the stop's declaration is not the reason.
   * The request is no longer under way afterwards ({@link pageResumeEnded}).
   * @param stop - The declared server stop whose breakpoint the page paused at.
   * @param error - What the request failed with.
   * @returns `error` itself for a cancelled run, otherwise the error that names the page's pause, the declared stop and the failure in quotation marks ({@link pagePauseUnderResumeText}); {@link track} ends the run with it.
   * @example
   * ```ts
   * throw this.pageResumeFailure(stop, new Error('Thread is not paused')) // 'The page paused at …, at the breakpoint of declared server stop app/lib/actions.ts:27, …. Codebook asked the debugger to resume the page, and the request failed: "Thread is not paused". Keep the declaration and start a new run.'
   * ```
   */
  private pageResumeFailure(stop: PreparedStop, error: unknown): unknown {
    const pause = this.pagePauseOf(stop)
    this.pageResumeEnded(stop)
    if (this.abort.signal.aborted) return error
    return new Error(
      pagePauseUnderResumeText(pause, { failure: thrownMessage(error) }),
    )
  }

  /**
   * Describes the page pause the run itself is resuming for a failure text, for {@link pageResumeFailure} and {@link withPagePauseUnderResume}.
   * The pause is the one {@link ownPagePauseUnderResume} took out of the bounds of a pause nobody owns: the timed page pause of a run without browser stops, or the held one marked as resumed by the run. Neither exists while only the debugger's `stopped` was read, and for a pause from before the action.
   * @param stop - The declared server stop whose breakpoint the page paused at.
   * @returns The declared stop as the failures name it ({@link declaredAt}) and the place of the page's pause ({@link placeOf}), `undefined` while that pause was not read.
   * @example
   * ```ts
   * this.pagePauseOf(stop) // { declared: 'app/lib/actions.ts:27', place: 'webpack-internal:///(app-pages-browser)/./app/lib/actions.ts 11:116' }
   * ```
   */
  private pagePauseOf(stop: PreparedStop): PagePauseUnderResume {
    const taken = this.pagePauseTakenUnderResume()
    return {
      declared: this.declaredAt(stop),
      place: taken && this.placeOf('browser', taken.event),
    }
  }

  /** Gives {@link pagePauseOf} and {@link openPageResume} the page pause that is open and that {@link ownPagePauseUnderResume} took for a resume of the run's own, with the declared server stop it marked: the held one of a run that declares a browser stop, or the timed one of a run that declares none; `undefined` when no such pause is open, also while the page's own pause was not read. @example this.pagePauseTakenUnderResume()?.resumedByRun // the server stop declared at app/lib/actions.ts:27 */
  private pagePauseTakenUnderResume():
    | { event: Protocol.Debugger.PausedEvent; resumedByRun: PreparedStop }
    | undefined {
    const taken = this.openPagePause()
    if (!taken?.resumedByRun) return undefined
    return { event: taken.event, resumedByRun: taken.resumedByRun }
  }

  /**
   * Tells the deadline texts whether the page stands paused under a resume of the run's own, and what became of that resume; {@link withPagePauseUnderResume}, {@link notHitFirstStopReason} and {@link unreachedNextStopReason} ask it when their deadline expires.
   * @returns
   * - The declared server stop of the oldest request without an answer, as `unanswered`
   * - Otherwise, while a page pause the run took as its own is still open: its declared server stop, as `answered` (the debugger answered every request, and the page reported no resume of that pause)
   * - `undefined` otherwise
   * @example
   * ```ts
   * this.openPageResume() // { stop, outcome: 'unanswered' } while the debugger has not answered the run's continue
   * ```
   */
  private openPageResume():
    { stop: PreparedStop; outcome: 'unanswered' | 'answered' } | undefined {
    const unanswered = this.pageResumesUnderWay[0]
    if (unanswered) return { stop: unanswered, outcome: 'unanswered' }
    const answeredFor = this.pagePauseTakenUnderResume()?.resumedByRun
    return answeredFor && { stop: answeredFor, outcome: 'answered' }
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
      // The stop's pause may have been taken just as the wait ended, when a judgement by break locations accepted its place ({@link admitPauseHeldFor}); otherwise an announced pause that stayed elsewhere in the stop's module since its turn began is judged by the binding and frame checks, which say what is wrong.
      const held =
        this.unboundPauseInModule(participant, stop) ??
        this.adoptPauseHeldInModule(stop)
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

  /** Tells {@link unboundPauseInModule} whether a pause's top frame names the script id of a stop's module (the sealed script or an accepted instance for another layer), as far as either is known. @example this.hasTopFrameInScriptOf(event, stop) // false for a pause in another script */
  private hasTopFrameInScriptOf(
    event: Protocol.Debugger.PausedEvent,
    stop: PreparedStop,
  ): boolean {
    const scriptId = event.callFrames[0]?.location.scriptId
    return (
      scriptId === stop.script?.scriptId ||
      (scriptId !== undefined && stop.instances.has(scriptId))
    )
  }

  /**
   * Gives the script of a stop's module that a script id names, with its own bundle and map: the accepted instance for another layer when the id is one, the sealed module otherwise. Every comparison of a pause with a stop's generated code asks it, because the instances' generated code differs.
   * @param stop - The declared stop.
   * @param scriptId - The script a pause or location lies in; none gives the sealed module.
   * @returns The module that script is an instance of.
   * @example
   * ```ts
   * this.moduleOf(stop, '1904').verifier // the map of the (middleware) instance
   * ```
   */
  private moduleOf(stop: PreparedStop, scriptId?: string): StopModule {
    return (
      (scriptId === undefined ? undefined : stop.instances.get(scriptId)) ??
      stop
    )
  }

  /** Tells whether a pause's top frame is in the sealed script of a stop's module or in an accepted instance of it for another layer. @example this.isPauseInModuleOf(event, stop) // true for a pause in the (middleware) instance of the stop's file */
  private isPauseInModuleOf(
    event: Protocol.Debugger.PausedEvent,
    stop: PreparedStop,
  ): boolean {
    return (
      isPauseInScript(event, stop.script) ||
      [...stop.instances.values()].some((instance) =>
        isPauseInScript(event, instance.script),
      )
    )
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
    if (early) return this.earlyPauseFailure(stop, early)
    // A pause held in another layer's copy of the module that was never usable says so instead of naming the wait.
    return (
      (this.abort.signal.aborted
        ? undefined
        : this.unusableInstanceFailure(stop)) ?? error
    )
  }

  /**
   * Words the failure of an accepted stop whose pause is held in a script of its module for another webpack layer that Codebook could not use, for {@link unreachedPauseFailure}: the copy's text was not read in time or was refused, so the pause cannot be placed and the wait would end as a bare timeout.
   * @param stop - The declared stop whose `stopped` was accepted.
   * @returns The failure naming the script and the reason; `undefined` when no pause held for this stop lies in such a script.
   * @example
   * ```ts
   * this.unusableInstanceFailure(stop)?.message // 'Declared stop app/auth.ts:18 paused at … in script 1904 …, another webpack layer's copy of its module that Codebook could not use: Timed out waiting for the text of script 1904.'
   * ```
   */
  private unusableInstanceFailure(stop: PreparedStop): Error | undefined {
    const held = this.participants[stop.participant].unannouncedPause,
      scriptId = held?.event.callFrames[0]?.location.scriptId,
      unusable =
        scriptId === undefined
          ? undefined
          : stop.unusableInstances.get(scriptId)
    if (!held || held.expectedStop !== stop || !unusable) return undefined
    return new Error(
      `Declared stop ${this.declaredAt(stop)} paused at ${this.placeOf(stop.participant, held.event)} in script ${scriptId} (${unusable.url}), another webpack layer's copy of its module that Codebook could not use: ${unusable.reason}. That pause is no observation of this stop; start a new run`,
    )
  }

  /**
   * Takes a pause held for an accepted browser stop on its bound line at another column as that stop's pause without waiting for the bound of {@link pauseOfAcceptedStop}, when the debugger moved the stop's binding to that column after it was armed.
   * The binding is read again once: only when it names the held pause's column is the pause the announced one. A binding the editor answers without a column (a stop requested at column 1, after the adapter's news) takes the column the adapter itself reported, never the held pause's own, which would prove nothing ({@link completedPlace}). A pause the debugger makes for itself at another statement of that line leaves the binding where it was and keeps waiting for its resume, and a held pause on any other line is judged when the wait has ended ({@link adoptPauseHeldInModule}).
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
    const binding = this.completedPlace(
      stop,
      verifiedLineSchema.safeParse(
        await awaitResponse(
          participant.selected!.getDebugProtocolBreakpoint(
            stop.breakpoint!.breakpoint,
          ),
          'held browser binding',
          this.abort.signal,
          CAPTURE_TIMEOUT_MS,
        ).catch(() => undefined),
      ).data,
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
    return location &&
      isPauseAtStop(
        held.event,
        this.pauseTarget(stop, this.moduleOf(stop, location.scriptId)),
      )
      ? location
      : undefined
  }

  /**
   * Says whether a binding read again names the column of a held pause on the stop's bound line, as the last check of {@link pauseAtMovedColumn} once that read has answered.
   * @param stop - A bound browser stop ({@link heldLocationOnBoundLine} gave the location); its bound line is read now, after the wait for the binding.
   * @param binding - The place the adapter's answer names ({@link completedPlace}); `undefined` when the binding could not be read, is not verified, or names no column the adapter reported either.
   * @param location - The generated location of the held pause's top frame.
   * @returns `true` when the binding is on the bound line at the pause's column; `false` when it could not be read, is on another line, or did not move to that column.
   * @example
   * ```ts
   * this.isBoundAtHeldColumn(stop, undefined, location) // false
   * ```
   */
  private isBoundAtHeldColumn(
    stop: PreparedStop,
    binding: { line: number; column: number } | undefined,
    location: Protocol.Debugger.Location,
  ): boolean {
    return (
      binding?.line === stop.bound!.line &&
      binding.column === stop.verifier.originalColumn(location)
    )
  }

  /**
   * Finds a pause in an accepted stop's module that was held before that stop's turn, for {@link pauseOfAcceptedStop}: its line ran before the input was sent or before the preceding continuation was requested.
   * The debug adapter's own pause at the first position of that module ({@link isPageEntryPause}) is not such a pause: no line of the stop ran, the adapter resumes it once it has read the module's source map, and its resume is measured by the adapter's own bound ({@link adapterPauseLimitMs}).
   * @param stop - The declared stop whose `stopped` was accepted.
   * @returns The held pause, or `undefined` when none is held, it is the adapter's own pause at the module's first position, or it was held during the stop's turn or in another script.
   * @example
   * ```ts
   * this.pauseHeldBeforeTurn(stop) // the pause of a re-render that ran while the stop was being armed
   * ```
   */
  private pauseHeldBeforeTurn(
    stop: PreparedStop,
  ): DebugParticipant['unannouncedPause'] {
    const held = this.participants[stop.participant].unannouncedPause
    // The adapter's own pause at the module's first position is no early run of the stop's line.
    if (!held || this.isPageEntryPause(stop.participant, held.event))
      return undefined
    return this.isHeldBeforeTurnOf(stop, held) ? held : undefined
  }

  /** Tells {@link pauseHeldBeforeTurn} whether a held pause lies in a stop's module and was held while that stop was not the expected one. @example this.isHeldBeforeTurnOf(stop, held) // true for the pause of a re-render that ran while the stop was being armed */
  private isHeldBeforeTurnOf(
    stop: PreparedStop,
    held: NonNullable<DebugParticipant['unannouncedPause']>,
  ): boolean {
    return (
      held.expectedStop !== stop && this.isPauseInModuleOf(held.event, stop)
    )
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
    if (!this.isPauseInModuleOf(event, stop) || !location) return false
    return !this.moduleOf(stop, location.scriptId).verifier.isInAnotherOriginal(
      location,
    )
  }

  /**
   * Reads where the editor has a server stop's owned breakpoint at the stop's pause, for {@link inspect}: a registration that was pending while the stop was armed names its place only now. The answer is journaled as `breakpoint.pause-binding`, with `columnFrom` when the editor answered no column and it was taken from the adapter's report or the paused frame ({@link completedPlace}).
   * @param stop - The paused server stop.
   * @param pause - The identity of its pause, for the journal.
   * @param breakpointId - The adapter's id of the acknowledged registration, which the binding must carry.
   * @param pausedAt - The generated place of the paused top frame.
   * @param current - Throws when the pause is no longer the inspected one; asked once the editor answered, before the answer is journaled or judged.
   * @returns The binding's line and column, and where the column came from.
   * @throws "Pending server breakpoint did not bind to the captured source" when the answer is absent, unverified, under another id, in another file, or names no column and neither the adapter nor the paused frame names one on its line.
   * @example
   * ```ts
   * await this.serverBindingAtPause(stop, pause, 0, pausedAt, current) // { line: 32, column: 11, columnFrom: 'adapter' } for an answer { id: 0, verified: true, line: 32 }
   * ```
   */
  private async serverBindingAtPause(
    stop: PreparedStop,
    pause: PauseIdentity,
    breakpointId: number,
    pausedAt: Protocol.Debugger.Location | undefined,
    current: () => void,
  ): Promise<CompletedBindingPlace> {
    const answered = await awaitResponse(
      this.participants[stop.participant].selected!.getDebugProtocolBreakpoint(
        stop.breakpoint!.breakpoint,
      ),
      'paused server binding',
      this.abort.signal,
    )
    current()
    const place = this.ownedBindingPlace(stop, answered, breakpointId, pausedAt)
    this.journalPauseBinding(stop, pause, breakpointId, answered, place)
    if (!place)
      throw new Error(
        'Pending server breakpoint did not bind to the captured source',
      )
    return place
  }

  /**
   * Reads the place of a server stop's binding from what the editor answered at its pause when that answer is the acknowledged breakpoint in the cited file, for {@link serverBindingAtPause}.
   * @param stop - The paused server stop.
   * @param answered - What the editor answered for the stop's owned breakpoint.
   * @param breakpointId - The adapter's id of the acknowledged registration.
   * @param pausedAt - The generated place of the paused top frame.
   * @returns The binding's whole place ({@link completedPlace}); `undefined` for an absent or unverified answer, another id, another file, and a binding whose column nothing names.
   * @example
   * ```ts
   * this.ownedBindingPlace(stop, { id: 7, verified: true, line: 32, column: 11 }, 0, pausedAt) // undefined: another breakpoint's id
   * ```
   */
  private ownedBindingPlace(
    stop: PreparedStop,
    answered: unknown,
    breakpointId: number,
    pausedAt: Protocol.Debugger.Location | undefined,
  ): CompletedBindingPlace | undefined {
    const parsed = pausedServerBindingSchema.safeParse(answered)
    if (
      !parsed.success ||
      !this.isAcknowledgedInSource(stop, parsed.data, breakpointId)
    )
      return undefined
    return this.completedPlace(stop, parsed.data, pausedAt)
  }

  /**
   * Tells {@link ownedBindingPlace} whether a verified binding is the acknowledged breakpoint in the stop's cited file.
   * @param stop - The paused server stop.
   * @param binding - The binding's id and, when the adapter names it, its file.
   * @param breakpointId - The adapter's id of the acknowledged registration.
   * @returns `false` for another id and for a binding the adapter reports in another file; `true` otherwise, also when it names no file.
   * @example
   * ```ts
   * this.isAcknowledgedInSource(stop, { id: 0, source: { path: '/foreign/source.ts' } }, 0) // false
   * ```
   */
  private isAcknowledgedInSource(
    stop: PreparedStop,
    binding: z.infer<typeof pausedServerBindingSchema>,
    breakpointId: number,
  ): boolean {
    if (binding.id !== breakpointId) return false
    const path = binding.source?.path
    // A binding the adapter reports in another file is not the cited source's.
    return !path || resolve(path) === stop.bundle.sourcePath
  }

  /**
   * Journals what the editor answered for a server stop's owned breakpoint at its pause as `breakpoint.pause-binding`, for {@link serverBindingAtPause}, before that answer is judged.
   * @param stop - The paused server stop.
   * @param pause - The identity of its pause.
   * @param breakpointId - The adapter's id of the acknowledged registration.
   * @param answered - What the editor answered.
   * @param place - The binding's whole place when the answer was taken; its `columnFrom` is journaled when the column did not come from the answer itself.
   * @example
   * ```ts
   * this.journalPauseBinding(stop, pause, 0, { id: 0, verified: true, line: 32 }, { line: 32, column: 11, columnFrom: 'adapter' })
   * ```
   */
  private journalPauseBinding(
    stop: PreparedStop,
    pause: PauseIdentity,
    breakpointId: number,
    answered: unknown,
    place: CompletedBindingPlace | undefined,
  ): void {
    const receipt = bindingReceiptSchema.safeParse(answered)
    this.evidence.record('breakpoint.pause-binding', {
      participant: stop.participant,
      sessionId: pause.sessionId,
      expected: {
        id: breakpointId,
        line: stop.source.line,
        column: stop.source.column,
        path: stop.bundle.sourcePath,
      },
      ...declaredAndArmedPlace(stop.source, stop.armed),
      returned: this.describeAnswer(answered, receipt.success),
      observed: receipt.success ? receipt.data : undefined,
      // The editor answered no column: the entry says where the run took it from.
      ...(place && place.columnFrom !== 'binding'
        ? { completedColumn: place.column, columnFrom: place.columnFrom }
        : {}),
    })
  }

  /** Names what the editor answered for a binding in the journal entry of {@link journalPauseBinding}. @example this.describeAnswer(undefined, false) // 'absent' */
  private describeAnswer(
    answered: unknown,
    isReadable: boolean,
  ): 'absent' | 'parsed' | 'malformed' {
    if (answered === undefined) return 'absent'
    return isReadable ? 'parsed' : 'malformed'
  }

  /**
   * Reads a browser stop's binding again at a pause that was adopted away from the binding verified at arming, for {@link inspect}: the debugger may have moved that binding since.
   * @param stop - The paused browser stop, bound at arming.
   * @param pausedAt - The generated place of the paused top frame.
   * @returns The binding's whole place ({@link completedPlace}) when it is another place than the stop is bound at; `undefined` when the binding stands where it was, is unverified, or names no column and nothing names one on its line.
   * @example
   * ```ts
   * await this.movedBrowserBinding(stop, pausedAt) // { line: 23, column: 5, columnFrom: 'adapter' } for a stop bound at 22:3 that the debugger moved
   * ```
   */
  private async movedBrowserBinding(
    stop: PreparedStop,
    pausedAt: Protocol.Debugger.Location | undefined,
  ): Promise<CompletedBindingPlace | undefined> {
    const answered = await awaitResponse(
      this.participants[stop.participant].selected!.getDebugProtocolBreakpoint(
        stop.breakpoint!.breakpoint,
      ),
      'paused browser binding',
      this.abort.signal,
    )
    const place = this.completedPlace(
      stop,
      verifiedLineSchema.safeParse(answered).data,
      pausedAt,
    )
    return place && !this.isBoundAt(stop, place) ? place : undefined
  }

  /**
   * Binds a paused stop at a binding first known, or found moved, at its pause, for the two branches of {@link inspect}: the stop's rule judges the place, also by the debugger's own break locations up to where the program stands ({@link acceptsByBreakLocations}).
   * @param stop - The paused stop.
   * @param place - Where the debugger has the stop's breakpoint now.
   * @param pausedAt - The generated place of the paused top frame.
   * @param current - Throws when the pause is no longer the inspected one; asked after every wait.
   * @throws The binding failure that names the declared stop, the place and the rule's reason ({@link refusedBindingText}) for a refused place, and the failure of {@link bindBoundPlace} for a place an earlier stop already bound.
   * @example
   * ```ts
   * await this.bindAtPause(stop, { line: 32, column: 11 }, pausedAt, current)
   * ```
   */
  private async bindAtPause(
    stop: PreparedStop,
    place: { line: number; column: number },
    pausedAt: Protocol.Debugger.Location | undefined,
    current: () => void,
  ): Promise<void> {
    // The owned breakpoint is verified in the cited file but on a line the stop's rule refuses, also by the debugger's own break locations: name where it landed and why so the declaration can be corrected.
    const accepted = await this.acceptsByBreakLocations(stop, place, pausedAt)
    current()
    if (!accepted)
      throw this.bindingFailure(stop, this.refusedBindingText(stop, place))
    this.bindBoundPlace(stop, place)
    await this.journalSlidePastPausableLine(stop, place)
    current()
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
    // Where the program stands in the generated module: the place of a binding first known now, and the column of one the editor answers without.
    const pausedAt = stopped.event.callFrames[0]?.location
    if (stop.participant === 'server') {
      const registered = await this.registeredStop(stop, pausedAt)
      current()
      const binding = await this.serverBindingAtPause(
        stop,
        pause,
        registered.breakpointId,
        pausedAt,
        current,
      )
      await this.bindAtPause(stop, binding, pausedAt, current)
    } else if (stopped.adopted) {
      // A browser pause away from the binding verified at arming: the debugger may have moved that binding since, so it is read again and named.
      const moved = await this.movedBrowserBinding(stop, pausedAt)
      current()
      if (moved) await this.bindAtPause(stop, moved, pausedAt, current)
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
    // The executed script is verified against its own instance: another layer's generated code differs from the sealed one.
    const executedModule = this.moduleOf(stop, callFrame.location.scriptId)
    executedModule.verifier.verify(
      executed.scriptSource,
      executedModule.bundle.source,
      callFrame.location,
      executedModule.script!.scriptId,
      frame.line,
      frame.column,
    )
    const facts = await inspectConfiguredValues(
      (parameters) =>
        participant.cdp!.request('Debugger.evaluateOnCallFrame', parameters),
      callFrame.callFrameId,
      stop.inspections,
      current,
      this.maskRunText,
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
      workspaceRoot: this.options.workspace,
      maskKnownText: this.maskRunText,
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
          `Required inspection ${missing.mode}:${missing.path} is unavailable; captured facts remain readable.${selfDeclaredInspectionHint(stop.bundle.source, frame.line, missing.path, this.definition.descriptor.anchors[stop.anchorIndex]!.endLine, stop.source.line)}`,
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
        javascriptHash: executedModule.verifier.hashes.javascript,
        mapHash: executedModule.verifier.hashes.sourceMap,
        scriptId: executedModule.script!.scriptId,
        scriptUrl: executedModule.script!.url,
        generated: {
          line: callFrame.location.lineNumber,
          column: callFrame.location.columnNumber ?? 0,
        },
        // The stop's rule accepted this bound line: no line between it and the requested one has a mapped position (or, once the debugger listed its break locations, a break location between the two generated places), and the requested line is the declared one or the first mapped line after it.
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
    this.snapshotBundles.set(snapshot.id, executedModule.bundle)
    try {
      // A stop captured in another layer's instance keeps that instance's generated code and map, which its hashes name, beside the sealed ones.
      if (executedModule !== stop) {
        const archivedModule = this.archivedModuleText(executedModule.bundle)
        await this.evidence.save(
          `snapshot-${stop.participant}-${pause.generation}-module.js`,
          archivedModule.evidenceJavascript,
        )
        await this.evidence.save(
          `snapshot-${stop.participant}-${pause.generation}-module.map.json`,
          archivedModule.sourceMap,
        )
      }
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
    this.markOperationPaused(stop)
    this.snapshotReady = true
    await this.persist()
  }

  /**
   * Continues the committed pause of a declared stop, called by the service for `codebook_continue` and for the Study pane's Continue.
   * Reserves the exact pause before source revalidation, then arms the next declared stop and reads the other participant's earlier pauses before it requests the resume; only an owned, retired breakpoint leads to an acknowledged continuation.
   * @param name - The participant whose committed pause is continued.
   * @param pause - The pause identity the caller copied from the run's view.
   * @throws `conflict: stale, foreign or unverified pause` without ending the run; every later failure ends the run and is thrown on. The run's reason is "Sources were not confirmed before the continuation and no resume was sent: …", "Next declared stop was not armed and no resume was sent: …" or "Next declared stop could not be continued to: … and no resume was sent. …" for the three steps that come before the resume, and "Continue uncertain: …" otherwise.
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
      await this.confirmSourcesBeforeResume()
      this.alive()
      if (
        participant.gate.phase !== 'resume-requested' ||
        participant.gate.current?.generation !== pause.generation
      )
        throw new Error('conflict: pause changed before continue')
      const nextStop = this.stopArmedAfter(stop)
      if (nextStop) {
        try {
          await this.armStop(nextStop)
          this.armedStops.add(nextStop)
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
      // The continuation's next declared stop is the run's, so its window opens with the continuation.
      this.openCausalWindowOfNextStop(nextStop)
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
   * Revalidates the cited sources and the editor's documents of them as the first step of {@link continue}, before anything is armed or resumed, so that a refusal there is recorded as what it is.
   * @throws What {@link verifySources} failed with (a `SOURCE_CHANGED` {@link StudyError} for a changed file or a changed document), after the run was failed with a sentence that says that no resume was sent: this check comes before the resume is requested, so its failure is never an uncertain continuation.
   * @example
   * ```ts
   * await this.confirmSourcesBeforeResume() // run.view().failures[0] === 'Sources were not confirmed before the continuation and no resume was sent: The cited source src/theme.ts is open in the editor with text that differs ...'
   * ```
   */
  private async confirmSourcesBeforeResume(): Promise<void> {
    try {
      await this.verifySources()
    } catch (error) {
      // Nothing has been armed or resumed yet, so the record says exactly that, as for a next stop that could not be armed.
      this.fail(
        `Sources were not confirmed before the continuation and no resume was sent: ${thrownMessage(error)}`,
      )
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
    const continuedStop = this.stops[this.stopIndex]
    const followingStop = this.stops[this.stopIndex + 1]
    // A version 3 run advances within an operation only to a stop declared for the same operation; otherwise the operation is done with its stops.
    const advancesToNextStop = this.operationsConfiguration
      ? followingStop !== undefined &&
        afterOperationOf(followingStop) === afterOperationOf(continuedStop!)
      : this.stopIndex + 1 <
        configuredStops(this.definition.configuration).length
    if (this.operationsConfiguration && !advancesToNextStop) {
      // A pause queued during this continuation belongs to no declared stop of this operation (an undeclared or learner breakpoint); versions 1 and 2 fail such a pause, and so does this branch before the operation settles.
      const queuedStop = this.pendingCdpStop ?? this.pendingDapStop
      if (queuedStop) {
        this.pendingCdpStop = undefined
        this.pendingDapStop = undefined
        this.fail(
          `Unexpected or additional ${queuedStop.participant} stop invalidated the declared operation`,
        )
        return
      }
      const operationIndex = afterOperationOf(continuedStop!)!
      this.stopIndex++
      this.acceptedStop = false
      this.snapshotReady = false
      this.continuation = undefined
      this.status = 'acting'
      this.progressDeadline(ACTIVE_TIMEOUT_MS, () =>
        this.unreachedOperationReason(operationIndex),
      )
      // The operation is done with its stops once its input and value check are too.
      this.settleOperation(operationIndex)
      return
    }
    if (advancesToNextStop) {
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
  /** Confirms input, declared DOM conditions and renderer ACK while no additional pause has invalidated the original completion, waits until no participant is still paused at a pause the adapter made for itself, and reads the conditions once more after the after image, failing the run when they no longer hold; the run completes with the save of its final events and run record, and fails when that save fails. @example await this.observeAfter(continuation) */
  private async observeAfter(
    continuation: Continuation | undefined,
  ): Promise<void> {
    const current = (): void => {
      this.alive()
      if (
        this.continuation !== continuation ||
        Object.values(this.participants).some(
          (participant) => participant.gate.current,
        ) ||
        // A version 3 run whose last operation had no stop to continue has no continuation to own the completion.
        (continuation &&
          (!continuation.dap || !continuation.cdp || !continuation.response))
      )
        throw new Error('Original continuation no longer owns completion')
    }
    current()
    await this.waitForDom('after')
    current()
    await waitUntil(
      // A version 3 run waits for the acknowledgement of the operation in flight, which its own record keeps.
      () =>
        this.operationsConfiguration
          ? this.operationRecords[this.operationsAccepted - 1]?.ack === 'yes'
          : this.operation?.inputAcknowledged,
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
      if (this.operationsConfiguration)
        this.failOperation(
          this.afterNotMet(
            this.operationsConfiguration.operations.length,
            this.changedAfterCaptureReason(afterCapture.failure),
            'run',
          ),
        )
      else this.fail(this.changedAfterCaptureReason(afterCapture.failure))
      return
    }
    this.operation!.afterVerified = true
    // The last operation takes the run-level after conditions as its own result (CEO-S33).
    const lastRecord = this.operationRecords.at(-1)
    if (lastRecord) {
      this.moveForward(lastRecord, { effect: 'after-verified' })
      this.moveForward(lastRecord, { state: 'done' })
      this.logOperation(lastRecord.index, 'info', 'done (after-verified)')
    }
    this.status = 'completed'
    // The completion is the result only once its final save settled ({@link isSavingCompletion}).
    this.savingCompletion = true
    // A completed run has no deadline left: neither its phase's nor its whole-run deadline may fail it while it waits for its release.
    clearTimeout(this.progressTimer)
    clearTimeout(this.runTimer)
    this.evidence.record('screen.observed', {
      snapshotId: this.snapshot!.id,
      pause: continuation?.pause ?? this.operation!.continuedPause,
      actionId: REPOSITORY_BROWSER_ACTION,
    })
    try {
      await this.persist()
    } catch (error) {
      // The final save belongs to the completion: a run whose final events or record were not saved (a failed write, the event limit passed by this last event) fails with it, so its journal ends with `run.failed` and its recording is sealed partial (Cycle 0047 row 197). A failure that reaches the run after this save leaves it completed (row 41).
      if (this.status === 'completed') this.enterFailure(String(error))
    } finally {
      this.savingCompletion = false
    }
  }

  /**
   * Says whether the run completed and its final save of its events and run record has not settled yet; asked by {@link StudyService.endedRunState}, so that a continuation waiting for the next state answers the result only once that save succeeded, and the failure when it failed (Cycle 0047 row 241), and by {@link StudyService.shownRuntimeOf}, so that the run resource shows no result during that save (row 252).
   * Why: the run shows `completed` from its completion on, also during that save, as the run record it saves says (row 197's failure turns it into `failed` after the save); an agent answered with the result in between would report a run that then fails.
   * @returns `true` while the final save is under way; `false` before the completion and once the save settled.
   * @example run.isSavingCompletion() // => true while runtime.json of the completed run is written
   */
  isSavingCompletion(): boolean {
    return this.savingCompletion
  }

  /**
   * Verifies that the selected page is still at the owned application origin before Codebook evaluates anything in it.
   * Called by {@link readDom} for every condition read and by {@link scrollClickTargetIntoView} before the click's scroll.
   * @returns The selected page's channel.
   * @throws When the page left its owned application origin, or the run is no longer alive.
   * @example
   * ```ts
   * const cdp = await this.ownedPageCdp()
   * ```
   */
  private async ownedPageCdp(): Promise<Cdp> {
    const cdp = this.requireCdp(),
      identity = await cdp.request('Runtime.evaluate', {
        expression: 'location.origin',
        returnByValue: true,
      })
    this.alive()
    if (
      identity.exceptionDetails ||
      !isOwnedApplicationOrigin(
        identity.result.value,
        this.origin!,
        this.ownsIpv6Loopback,
      )
    )
      throw new Error('Selected page left its owned application origin')
    return cdp
  }

  /** Evaluates owned DOM data only after origin verification; it only reads the page, and invalid selectors/conditions never dispatch input. @example await this.readDom('before') */
  private async readDom(phase: 'before' | 'after') {
    const action = this.declaredAction()
    return this.readConditions(
      action[phase],
      phase === 'before' ? action.selector : undefined,
    )
  }
  /**
   * Gives the conditions the run-level phases read: the `action` of versions 1 and 2 (its click target included), or the `before` and `after` of version 3, which has no one click target.
   * @returns The selector of the click target when there is one, and the conditions of both phases.
   * @example this.declaredAction().after[0]?.kind // 'visible'
   */
  private declaredAction(): {
    selector?: string
    before: RepositoryCondition[]
    after: RepositoryCondition[]
  } {
    const configuration = this.definition.configuration
    return 'action' in configuration
      ? configuration.action
      : { before: configuration.before, after: configuration.after }
  }
  /**
   * Reads declared conditions, and optionally a click target's centre, from the owned page, after the origin check; it only reads, and an invalid selector never dispatches input.
   * Called by {@link readDom} for the run-level phases and by version 3's operation checks.
   * @param conditions - The conditions to read.
   * @param selector - The click target to locate, when the read is also for a click.
   * @returns The page's counts and reasons ({@link inspectDom}'s answer).
   * @example await this.readConditions([{ kind: 'visible', selector: 'table' }])
   */
  private async readConditions(
    conditions: RepositoryCondition[],
    selector?: string,
  ) {
    const cdp = await this.ownedPageCdp()
    const response = await cdp.request('Runtime.evaluate', {
      expression: configuredDomExpression(conditions, selector),
      returnByValue: true,
    })
    this.alive()
    if (response.exceptionDetails)
      throw new Error('Declared DOM conditions could not be evaluated')
    return domResultSchema.parse(response.result.value)
  }
  /**
   * Waits until an operation's own `after` conditions hold, bounded as the run-level wait.
   * @param conditions - The operation's conditions.
   * @throws The wait's timeout, which names the first condition that did not hold.
   * @example await this.waitForConditions(operation.after)
   */
  private async waitForConditions(
    conditions: RepositoryCondition[],
  ): Promise<void> {
    try {
      await waitUntil(
        async () => {
          const last = await this.readConditions(conditions)
          this.lastOperationAfterFailure = last.ready ? undefined : last.failure
          return last.ready
        },
        "the operation's after conditions",
        ACTIVE_TIMEOUT_MS,
        this.abort.signal,
      )
    } catch (error) {
      if (!(error instanceof WaitTimeoutError)) throw error
      throw new OperationAfterTimeoutError(this.operationAfterTimeoutText())
    }
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
      : this.declaredAction()[phase][conditionIndex]
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
   * The canonical redacted configuration and its hash: every prepared text not resolved as plain is masked (ENG-3).
   * Called by {@link servedDefinition} and {@link currentManifest}; the hash is the existing configuration hash over this form.
   * @returns The configuration and its SHA-256.
   * @example
   * this.canonicalConfiguration().hash // => the hash a saved study carries
   */
  private canonicalConfiguration(): {
    configuration: ConfiguredDefinition['configuration']
    hash: string
  } {
    const canonical = canonicalDefinition(this.definition, this.preparedStates)
    return {
      configuration: canonical.configuration,
      hash: canonical.configurationHash,
    }
  }
  /**
   * The definition the run resource and `runtime.json` show: prepared texts as `[pending]`, masked or plain, with the canonical hash.
   * `[pending]` is a view state only; it is in no hashed form.
   * @example
   * this.servedDefinition().configuration.initialInputs?.[0]?.text // => '[pending]' before the control is resolved
   */
  private servedDefinition(): ConfiguredDefinition {
    if (preparedInputsOf(this.definition.configuration) === undefined)
      return this.definition
    return {
      ...this.definition,
      configuration: redactPreparedConfiguration(
        this.definition.configuration,
        this.preparedStates,
        'view',
      ),
      configurationHash: this.canonicalConfiguration().hash,
    }
  }
  /**
   * The manifest the run resource serves: the sealed fields with the canonical configuration, rebuilt as prepared texts are resolved.
   * @returns The manifest, or `undefined` before the stops are sealed.
   * @example
   * this.currentManifest()?.configuration.initialInputs?.[0]?.text // => '[pending]' before apply, '[masked]' after a secret
   */
  private currentManifest(): ConfiguredRuntimeView['manifest'] {
    if (!this.sealedManifest) return undefined
    const canonical = this.canonicalConfiguration()
    const bound = {
      configurationHash: canonical.hash,
      configuration: canonical.configuration,
      ...this.sealedManifest,
    }
    return {
      ...bound,
      // The served configuration shows the pending mark; the hash is over the canonical form.
      configuration: this.servedDefinition().configuration,
      hash: sha256(JSON.stringify(bound)),
    }
  }

  /**
   * Polls the declared DOM conditions without repeating application input; setup ({@link prepareOwned}) and after verification ({@link observeAfter}) call it.
   * Once they hold, a text condition that held on one of several elements is journaled ({@link journalTextReadings}).
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
      if (!(error instanceof WaitTimeoutError)) throw error
      // A Pages page that left its entry path while its before conditions were awaited is refused as the redirect it is, not as a missing condition.
      if (phase === 'before' && this.pagesRun)
        await this.refusePagesPathLeftAfterWait()
      // Only the wait's own timeout is completed with the condition the page named last; the type says so, whatever the wait's sentence is.
      if (!lastResult?.failure) throw error
      throw new Error(this.conditionTimeoutText(phase, lastResult.failure))
    }
    this.journalTextReadings(phase, lastResult?.textReadings)
  }
  /**
   * Journals which reading made a text condition hold when its selector matched several elements, so the run says what Codebook did with such a condition; called by {@link waitForDom} once the conditions of a phase held.
   * @param phase - Whether the conditions guard the input or prove the result.
   * @param textReadings - The page's counts for each text condition that held on one of several elements; absent when every condition matched one element.
   * @returns Nothing; the entry `condition.text-held-on-one-of-several` is recorded with the phase and the counts, once per phase of a run.
   * @example
   * ```ts
   * this.journalTextReadings('after', [{ conditionIndex: 0, matchedElements: 3, readingElements: 1 }])
   * ```
   */
  private journalTextReadings(
    phase: 'before' | 'after',
    textReadings: z.infer<typeof configuredTextReadingsSchema> | undefined,
  ): void {
    // The after conditions are read several times before a result is certified; the first read that held is the one journaled.
    if (!textReadings?.length || this.journaledTextReadingPhases.has(phase))
      return
    this.journaledTextReadingPhases.add(phase)
    this.evidence.record('condition.text-held-on-one-of-several', {
      phase,
      readings: textReadings.map((reading) => ({
        condition: reading.conditionIndex + 1,
        matchedElements: reading.matchedElements,
        readingElements: reading.readingElements,
      })),
    })
  }
  /** Revalidates all cited disk identities and open buffers at effect/pause/continue boundaries without owning raw tabs. @example await this.verifySources() */
  private async verifySources(): Promise<void> {
    this.alive()
    assertConfiguredSourceDocuments(
      this.options.workspace,
      this.definition.descriptor.sources,
      vscode.workspace.textDocuments,
    )
    if (!this.preparedSources) throw new Error('Prepared sources are absent')
    await this.preparedSources.revalidate()
    this.alive()
    await this.preparedSources.verifyIdentities()
    this.alive()
    assertConfiguredSourceDocuments(
      this.options.workspace,
      this.definition.descriptor.sources,
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
      const requestedAtMs = Date.now()
      const result = await this.requireCdp().request(
        'Page.captureScreenshot',
        { format: 'png' },
        CAPTURE_TIMEOUT_MS,
      )
      current()
      const bytes = Buffer.from(result.data, 'base64'),
        hash = sha256(bytes)
      // A stop screenshot keeps no pixel from a window the secret gate cannot call safe; it reaches the recorder in order with the stream frames.
      if (
        (await this.browser.recordCapture(
          result.data,
          phase,
          requestedAtMs,
        )) === 'drop'
      )
        throw new Error('Image withheld: a secret control was not safe to draw')
      current()
      // Receipt-time pixels went to the recording before disk/renderer waits; only the later exact-pause receipt confirms correspondence.
      this.evidence.record('capture.response-received', { phase, pause, hash })
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
  /**
   * Returns only sealed bytes for this exact learning identity, independent of later files: the first stop's sealed module without a snapshot, and with one the module the snapshot ran in, whose JavaScript and map its `javascriptHash` and `mapHash` name (another webpack layer's instance for a stop captured there, F565). The run's historical source resources read it.
   * @param item - The learning item; another item has no source here.
   * @param snapshotId - A committed snapshot of this run.
   * @returns The bundle, or `undefined` for another item or an unknown snapshot.
   * @example run.source(itemId, snapshot.id)?.javascript // the (middleware) instance's code for a stop captured there
   */
  source(item: string, snapshotId?: string): RuntimeSource | undefined {
    if (item !== this.definition.descriptor.itemId) return undefined
    const bundle =
      snapshotId === undefined
        ? this.stops[0]?.bundle
        : this.snapshotBundles.get(snapshotId)
    if (!bundle) return undefined
    const archivedModule = this.archivedModuleText(bundle)
    return archivedModule.redacted
      ? {
          ...bundle,
          javascript: archivedModule.javascript,
          sourceMap: archivedModule.sourceMap,
          redacted: true,
          executedHashes: {
            javascript: sha256(bundle.javascript),
            sourceMap: sha256(bundle.sourceMap),
          },
        }
      : bundle
  }
  /**
   * Masks the env-file and script values in the module text a Vite run keeps, and says whether anything was masked.
   *
   * Why it exists: Vite inlines `import.meta.env` values (the `VITE_` ones from the `.env` files) into the modules it serves, and the sealed module is written to the run's evidence and served by the source resources. Called by the sealing loop, the snapshot save and {@link source}.
   * Only those values are masked, never secret shapes: project code may hold credential-shaped literals that are not env values. The source map is masked through its parsed strings, so it stays valid JSON. The seal's hashes keep naming the executed bytes; only the kept copy is masked.
   *
   * @param bundle - The sealed or executed module.
   * @returns The JavaScript and map text to keep, `redacted` when either changed, and `evidenceJavascript`: the JavaScript with the label line appended when redacted (the evidence file; the source resource appends the same label itself).
   * @example
   * this.archivedModuleText(bundle) // => { javascript: 'const k = "[masked]"', sourceMap: '{…}', redacted: true, evidenceJavascript: 'const k = "[masked]"\n// [masked] …\n' }
   */
  private archivedModuleText(bundle: BundleSource): {
    javascript: string
    sourceMap: string
    redacted: boolean
    evidenceJavascript: string
  } {
    // Every source read, seal and evidence save asks again; the bundle never changes, so the first answer stands.
    const remembered = this.archivedModules.get(bundle)
    if (remembered) return remembered
    const archived = this.maskedArchive(bundle)
    this.archivedModules.set(bundle, archived)
    return archived
  }
  /** Masks one bundle without the memo; see {@link archivedModuleText}. */
  private maskedArchive(bundle: BundleSource): {
    javascript: string
    sourceMap: string
    redacted: boolean
    evidenceJavascript: string
  } {
    const mask = this.maskModuleText
    if (!mask)
      return {
        javascript: bundle.javascript,
        sourceMap: bundle.sourceMap,
        redacted: false,
        evidenceJavascript: bundle.javascript,
      }
    const javascript = mask(bundle.javascript)
    const sourceMap = maskSourceMapText(bundle.sourceMap, mask)
    const redacted =
      javascript !== bundle.javascript || sourceMap !== bundle.sourceMap
    return {
      javascript,
      sourceMap,
      redacted,
      // The label comes after the last line, so no line number moves.
      evidenceJavascript: redacted
        ? `${javascript}\n${REDACTED_MODULE_LABEL}\n`
        : javascript,
    }
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
      definition: this.servedDefinition(),
      preparedTextStates: [...this.preparedStates],
      manifest: this.currentManifest(),
      applicationOrigin: this.origin,
      applicationPortSource: this.portSource,
      viteVersion: this.viteVersion,
      nextRoute: this.nextRoute,
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
      // Only a version 3 run lists its operations and, after a refusal or failure, the fields that decide a retry.
      ...(this.operationsConfiguration
        ? {
            operations: this.operationRecords.map((record) => ({ ...record })),
            ...(this.operationFailure
              ? { operationFailure: { ...this.operationFailure } }
              : {}),
          }
        : {}),
      nextAction: this.offeredAction(),
      observed: this.operation?.afterVerified
        ? { afterVerified: true }
        : undefined,
      links: [],
      captures: this.captures,
      snapshotCaptures: { ...this.snapshotCaptures },
      failures: this.failures.map(this.maskRunText),
      events: this.evidence.events,
      artifactDirectory: this.evidence.directory,
      activeSessionIds: [...this.activeSessions],
    }
  }
  /**
   * Names the action the run offers now: the one click of versions 1 and 2 while nothing was reserved, or `repository-operation` for a version 3 run that is `ready` with an operation left.
   * @returns The action, or `undefined` while the run is not ready, paused, or has reserved every operation.
   * @example this.offeredAction() // 'repository-operation' between operations
   */
  private offeredAction(): ConfiguredRuntimeView['nextAction'] {
    if (this.status !== 'ready') return undefined
    if (this.operationsConfiguration)
      return this.operationsAccepted < this.operationRecords.length
        ? REPOSITORY_OPERATION_ACTION
        : undefined
    return this.operation ? undefined : REPOSITORY_BROWSER_ACTION
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
  /** Revokes every completion token immediately and schedules cleanup after the failing activity can settle; a run that is cleaning, that failed already or that completed is left as it is, so a failure that arrives while a completed run waits for its release does not take its result. @example run.fail('source changed') */
  fail(reason: string): void {
    // A completed run's result was verified; only its release is left, which reports its own failures.
    if (
      this.cleaning ||
      this.status === 'failed' ||
      this.status === 'completed'
    )
      return
    this.enterFailure(reason)
  }
  /**
   * Fails the run: records the reason, revokes every completion token, journals `run.failed` and schedules the cleanup; the body of {@link fail} for a run that may still fail, and called by {@link observeAfter} for a completed run whose final save failed, which {@link fail} leaves completed (Cycle 0047 row 197).
   * @param unmaskedReason - The failure before masking; the run's failures and its journal keep its masked form.
   * @example this.enterFailure('Error: ENOSPC: no space left on device, write')
   */
  private enterFailure(unmaskedReason: string): void {
    // A failure sentence may quote what the page was given.
    const reason = this.maskRunText(unmaskedReason)
    this.failures.push(reason)
    this.status = 'failed'
    this.continuation = undefined
    // An operation that was being sent or was paused when the run failed is recorded failed, so a partial replay shows how far the flow got.
    for (const record of this.operationRecords)
      if (record.state === 'sending' || record.state === 'paused')
        this.moveForward(record, { state: 'failed' })
    codebookStopLedger.closeWindow(this.participantSessionIds())
    for (const participant of Object.values(this.participants))
      participant.gate.invalidate(true)
    // Also after the evidence refused further events: the journal of a failed run ends with its failure (Cycle 0046 row 666).
    this.evidence.recordFailure(reason)
    queueMicrotask(() => {
      void this.stop().catch((error) => this.failures.push(String(error)))
    })
  }
  /**
   * Lists the debug sessions the run's participants are attached to, for the causal window and for the ledger's cleanup.
   * @returns The session ids of the attached participants; an unattached participant contributes nothing.
   * @example this.participantSessionIds() // => ['live-next-browser', 'live-next-server']
   */
  private participantSessionIds(): string[] {
    return Object.values(this.participants).flatMap((participant) =>
      participant.selected ? [participant.selected.id] : [],
    )
  }
  /**
   * Opens the causal window of a participant's debug session, so the stop it reports next is judged as the run's; the window is read by {@link CodebookStopLedger}.
   * @param name - The participant whose next stop the run expects; `undefined` when no stop is declared next.
   * @example this.openCausalWindow('browser') // the page pause the run resumes itself
   */
  private openCausalWindow(name: Participant | undefined): void {
    const sessionId = name ? this.participants[name].selected?.id : undefined
    if (sessionId) codebookStopLedger.openWindow([sessionId])
  }
  /**
   * Opens the causal window of the participant of a declared stop; called by {@link action} for the input's first stop and by {@link continue} for the continuation's next stop.
   * @param stopIndex - The index of the declared stop the run expects next; past the last stop, nothing opens.
   * @example this.openCausalWindowOfStop(this.stopIndex + 1)
   */
  private openCausalWindowOfStop(stopIndex: number): void {
    this.openCausalWindow(this.stops[stopIndex]?.participant)
  }
  /**
   * Opens the causal window of the stop a continuation arms, called by {@link continue}; no stop armed, no window.
   * @param nextStop - The stop {@link stopArmedAfter} gave, if any.
   * @example this.openCausalWindowOfNextStop(this.stopArmedAfter(stop))
   */
  private openCausalWindowOfNextStop(nextStop: PreparedStop | undefined): void {
    this.openCausalWindow(nextStop?.participant)
  }
  /**
   * Ends the causal window of a session whose program the learner pauses, so the stop the pause makes is the learner's; called by {@link onRequest} for every request, before it looks at resumes only. A resume the run did not make ends the window through {@link fail}.
   * @param session - The session the request goes to.
   * @param request - The editor's request.
   * @example this.closeWindowAtLearnerPause(session, { type: 'request', seq: 4, command: 'pause', arguments: { threadId: 1 } })
   */
  private closeWindowAtLearnerPause(
    session: vscode.DebugSession,
    request: DebugProtocol.Request,
  ): void {
    if (request.command === 'pause')
      codebookStopLedger.closeWindow([session.id])
  }
  /**
   * Records in {@link CodebookStopLedger} whether a stop the adapter reported is the run's own ({@link isStopCausedByCodebook}); called by {@link onEvent} for every `stopped` event of a participant, also for a queued one it reads again once its continuation completes.
   * @param session - The session that stopped.
   * @param participant - Its participant, whose pending refresh marks an adapter refresh of a pause the run holds.
   * @param isRunResumedPageStop - Whether the stop is a page pause at a server stop's breakpoint that the run resumes itself.
   * @example this.recordStopVerdict(session, participant, serverStop !== undefined)
   */
  private recordStopVerdict(
    session: vscode.DebugSession,
    participant: DebugParticipant,
    isRunResumedPageStop: boolean,
  ): void {
    codebookStopLedger.recordStop(
      session.id,
      isStopCausedByCodebook({
        windowOpen: codebookStopLedger.isWindowOpen(session.id),
        isAdapterRefresh: Boolean(
          participant.refresh || participant.deferredRefresh,
        ),
        isRunResumedPageStop,
      }),
    )
  }
  /**
   * Drops the ledger's windows and verdicts of the run's sessions, so a stop held after the run ended is no longer Codebook's; called by {@link cleanupOwned}.
   * @example this.forgetCausalSessions()
   */
  private forgetCausalSessions(): void {
    for (const sessionId of this.participantSessionIds())
      codebookStopLedger.forget(sessionId)
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
  /**
   * Closes transports before draining acquisitions; raw tabs, dirty files and unrelated breakpoints are never cleanup targets. Called once by {@link stop}, again only after an incomplete release.
   * The run's evidence is persisted last. When that fails after every resource was released (the evidence failed for good: a full disk, its buffering limit, its folder removed by hand), the release is finished all the same: the run is cleaned, its status is failed and the persistence failure is its failure, so the service can mark the run stopped and start another; a retry could only fail on the same evidence again.
   * @throws The first release failures, joined, when a resource could not be released; the persistence failure when it comes on top of such a release failure.
   * @example await this.cleanupOwned()
   */
  private async cleanupOwned(): Promise<void> {
    if (this.unjournaledAdapterEvents)
      this.evidence.record('cdp.adapter-pauses-not-journaled', {
        count: this.unjournaledAdapterEvents,
        journalLimit: REPOSITORY_ADAPTER_PAUSE_JOURNAL_LIMIT,
      })
    if (this.unjournaledStopModuleEvents)
      this.evidence.record('stop.module-events-not-journaled', {
        count: this.unjournaledStopModuleEvents,
        journalLimit: REPOSITORY_STOP_MODULE_JOURNAL_LIMIT,
      })
    this.evidence.record('cleanup.started')
    // Teardown frames are not history: the history ends at once and queued images get their verdict while the page still answers, later ones are discarded.
    const historyEnded = this.browser
      .endRecordingHistory()
      .catch(() => undefined)
    // No operation input may start once cleanup began, so the run closes before the bounded drain below (the drain depends on neither the flag nor the signal).
    this.cleaning = true
    this.abort.abort()
    await historyEnded
    this.forgetCausalSessions()
    this.scriptAnnouncements.clear()
    if (this.transientBrowserPause) {
      clearTimeout(this.transientBrowserPause.timer)
      this.transientBrowserPause = undefined
    }
    // The gate's last counts are journaled once, with the run's other closing facts.
    this.secretFrameGate.flushSummary()
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
          description: 'owned [::1] forwarder stop',
          release: () => this.ipv6Forwarder?.close(),
        },
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
      this.status = 'failed'
      this.failures.push(`Final evidence persistence failed: ${String(error)}`)
      // A run whose resources are all released has finished its release: the persistence failure stays the run's failure, and a retry would only meet the same evidence failure again, which the evidence keeps.
      if (!this.resourcesReleased) throw error
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
   * @returns The reason, followed by where each participant is paused without an announced stop and by the page pause the run is still resuming ({@link withPagePauseUnderResume}).
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
      return this.withPagePauseUnderResume(
        withUnannouncedPauses(text, this.unannouncedPausePlaces()),
      )
    } catch (error) {
      return `${text} (where a participant is paused could not be read: ${thrownMessage(error)})`
    }
  }
  /**
   * Adds to an expired deadline's text the page pause the run itself is still resuming, for {@link expiredDeadlineText}: once the run sent its resume nothing else names that pause, and a deadline that expires while the debugger has not answered would read as if a declared stop's line had not run.
   * @param text - The deadline's text so far.
   * @returns The text itself while the page does not stand paused under a resume of the run's own ({@link openPageResume}); otherwise the text, a period, and the sentences of {@link pagePauseUnderResumeText}, which say that the request has no answer, or that the debugger answered it and the page reported no resume.
   * @example
   * ```ts
   * this.withPagePauseUnderResume('Repository input reached no verified pause') // '… pause. The page paused at …, at the breakpoint of declared server stop app/lib/actions.ts:27, …. Codebook asked the debugger to resume the page and got no answer, so the page stayed paused. Keep the declaration and start a new run.'
   * ```
   */
  private withPagePauseUnderResume(text: string): string {
    const open = this.openPageResume()
    if (!open) return text
    const pause = this.pagePauseOf(open.stop)
    return `${withFinalPeriod(text)} ${pagePauseUnderResumeText(pause, open.outcome)}`
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
        if (this.cleaning) return
        // An operation's refusal keeps its code and fields; any other failure keeps its text.
        if (error instanceof OperationRefusal) this.failOperation(error)
        else this.fail(String(error))
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
