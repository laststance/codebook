import type {
  ConfiguredDefinition,
  ConfiguredDescriptor,
  ConfiguredObservation,
  ConfiguredStudy,
} from './configuredStudySchemas'
import type {
  NODE_SERVER_PROFILE,
  NODE_TEST_PROFILE,
  REPOSITORY_BROWSER_ACTION,
  REPOSITORY_BROWSER_PROFILE,
} from './constants'
import type { ErrorCode, StudyError } from './errors'
import type { NodeServerConfiguration } from './nodeServerConfigSchemas'
import type { NodeTestConfiguration } from './nodeTestConfigSchemas'
import type { NodeTestSourceStop } from './ownedNodeTestRun'
import type { ReplayDebugSnapshot } from './replayDebugSchemas'
import type { Evidence, RecordedEvent } from './runtimeSupport/evidence'
import type {
  HostConfiguration,
  ProfileLeft,
} from './runtimeSupport/hostBrowser'
import type { PauseIdentity, PauseGate } from './runtimeSupport/pauseGate'
import type {
  RetryVitestListingRelease,
  VitestListingReleaseFailure,
} from './utils/listVitestTestFiles'
import type { NodeTestExecutionPlan } from './utils/planNodeTestExecution'
import type { NodeTestVitestSearch } from './utils/searchRepositoryVitest'

export interface NodeTestRuntime {
  readonly id: string
  prepare(): Promise<NodeTestSourceStop>
  hasNextStop(): boolean
  advance(): Promise<NodeTestSourceStop>
  complete(): Promise<{
    exitCode: number | null
    signal: NodeJS.Signals | null
    output: string
    elapsedMs: number
    /** Why Vitest's report could not confirm the cited test, for a run whose non-zero exit or signal already says it did not pass; the run's error names it beside the recorded result. */
    reportFailure?: string
  }>
  stop(): Promise<void>
}

/** Where a node-server run stands (Issue #139 task 10's state table); `stopping` also covers a failed stop that awaits its retry (D9). */
export type NodeServerState =
  | 'preparing'
  | 'ready'
  | 'request-in-flight'
  | 'paused'
  | 'learner-paused'
  | 'unattributed'
  | 'responded'
  | 'request-failed'
  | 'stopping'
  | 'stopped'

/** One declared stop of a node-server run as armed: index 0 is the configuration's `source`, then its `additionalStops` in order. */
export type NodeServerStop = {
  declaredStopIndex: number
  path: string
  declaredLine: number
  /** The line the debugger bound the stop to, once it verified the breakpoint. */
  boundLine?: number
}

/** What one hit of a declared stop inside the request window captured, already redacted; kept in memory for the run's lifetime in a shape the next cycle's durable server journal can serialize. */
export type NodeServerCapture = {
  declaredStopIndex: number
  /** One-based: `declaredStopIndex + 1`. */
  stopNumber: number
  pauseGeneration: number
  path: string
  line: number
  /** SHA-256 of the executed source file's text at the hit. */
  sourceHash: string
  /** The declared inspections' values by inspection path, redacted ({@link redactInspectedValue}). */
  facts: Record<string, unknown>
  /** Declared inspections the debugger could not read, each with its reason. */
  unavailable: Array<{ path: string; reason: string }>
  /** The redacted debugger snapshot (frames, scopes, variables) of the hit. */
  snapshot?: ReplayDebugSnapshot
  /** Milliseconds since the run's launch. */
  capturedAtMs: number
  /** How the hit was tied to the declared request: by the request window's timing (the request carries `x-codebook-run`). */
  attribution: 'timing'
}

/** The current pause at a declared stop inside the request window, with the identity a continuation copies; `generation` is the run-wide pause generation. */
export type NodeServerPause = PauseIdentity & {
  declaredStopIndex: number
  stopNumber: number
  /** Index into {@link NodeServerView.captures} of this pause's capture. */
  captureIndex: number
}

/** A pause Codebook neither owns nor resumes: the learner's own (a learner breakpoint, `debugger;`, an exception, the pause button) or a declared stop hit outside the request window. */
export type NodeServerHeldPause = {
  kind: 'learner' | 'unattributed'
  /** The debug adapter's stopped reason, such as `breakpoint`, `exception` or `pause`. */
  reason: string
  sessionId: string
  threadId: number
  path?: string
  line?: number
}

/** The declared request as it was sent. */
export type NodeServerSentRequest = {
  key: string
  method: string
  path: string
  bodyBytes: number
  /** The loopback address the bytes went to, as `127.0.0.1:<port>` or `[::1]:<port>`. */
  address: string
  /** Milliseconds since the run's launch. */
  sentAtMs: number
}

/** The response observed for the declared request; HTTP 4xx and 5xx are observed responses too. */
export type NodeServerResponse = {
  status: number
  contentType?: string
  /** The shown body, redacted: up to its first 8,192 bytes as UTF-8 text (cut at a code point with `… <n> more bytes`; invalid UTF-8 as U+FFFD with `(not valid UTF-8)`), or `(binary, <n> bytes)`. */
  body: string
  bodyBytes: number
  /** True when the read stopped at 1 MiB and the socket was destroyed (`(cut at 1 MiB)`). */
  readCut: boolean
  /** A redirect's `Location` as a same-origin path, or `(another origin)`; redirects are never followed. */
  location?: string
  elapsedMs: number
}

/** A failure that ended the declared request, not the server (D1): the run reads `request-failed`. */
export type NodeServerRequestFailure = {
  code: Extract<ErrorCode, 'REQUEST_FAILED' | 'REQUEST_TIMEOUT'>
  message: string
}

/** What a node-server run shows the service: its state, stops, current or held pause, request, response or failure, and captures. */
export type NodeServerView = {
  state: NodeServerState
  /** The launched server's pid (also its process group). */
  pid?: number
  /** The loopback endpoint readiness selected (`127.0.0.1` when both accept). */
  address?: { host: '127.0.0.1' | '::1'; port: number }
  stops: NodeServerStop[]
  /** Zero-based indices of declared stops hit during preparation, before readiness: the request may not reach those lines. */
  stopsHitAtStart: number[]
  /** Zero-based indices of declared stops hit during the request, in hit order. */
  stopsReached: number[]
  /** The run-wide pause generation; it grows with every pause. */
  pauseGeneration: number
  pause?: NodeServerPause
  heldPause?: NodeServerHeldPause
  request?: NodeServerSentRequest
  response?: NodeServerResponse
  requestFailure?: NodeServerRequestFailure
  captures: NodeServerCapture[]
  /** True once a request hit more than 16 captures: the owned breakpoints were retired and the request went on uncaptured. */
  captureBudgetExhausted: boolean
  /** A failure that ends the run (SERVER_EXITED, PAUSE_HOLD_EXPIRED, RUNTIME_FAILED, or a preparation refusal): the service sets it as the run's error and stops the run. */
  runFailure?: StudyError
  /** How many stops failed so far; the second failure's message names the pid (D9). */
  failedStops: number
}

/**
 * The node-server run the service drives (Issue #139 tasks 9–10): it launches the repository's server under the debugger, arms the declared stops, sends the declared request once, captures the hits and stops the server.
 * Created by {@link StudyEnvironment.createNodeServerRun}; the service reads {@link NodeServerRuntime.view} for state and answers, and owns receipts, keys and the confirmation of a state-changing request.
 */
export interface NodeServerRuntime {
  readonly id: string
  /** Launches, attaches, arms every declared stop, releases, waits for readiness and verifies the listener; resolves when the run is `ready`, rejects with the run's typed {@link StudyError}. */
  prepare(): Promise<void>
  view(): NodeServerView
  /** Calls the listener after every change of {@link NodeServerRuntime.view}. */
  onDidChange(listener: () => void): { dispose(): void }
  /** Sends the declared request once; resolves once its bytes went to the owned listener (the response arrives in the view). Throws `RUN_NOT_READY`, `REQUEST_ALREADY_SENT`, `LEARNER_PAUSED`, or `LISTENER_NOT_OWNED` with zero bytes sent. */
  sendRequest(key: string): Promise<void>
  /** Continues the current pause: reserves its generation atomically, then resumes; resolves once the debugger resumed. Throws `STALE_PAUSE`, `NO_PAUSE` or `LEARNER_PAUSED`. */
  continue(pause: PauseIdentity): Promise<void>
  /** Stops the server within one 10 s deadline (D14: a server paused in the request is ended before its debugger detaches, so the paused code never runs on; otherwise detach, SIGTERM, SIGKILL after 5 s); idempotent, retryable after a failure. */
  stop(): Promise<void>
}

export type ConfiguredRuntimeSnapshot = Omit<
  ConfiguredObservation,
  'snapshotUri' | 'interpretations'
>
export type RuntimeSnapshot = ConfiguredRuntimeSnapshot
export type RuntimeAction = typeof REPOSITORY_BROWSER_ACTION
export type RuntimeDefinition = ConfiguredDefinition
export type RuntimeControl = Readonly<{
  signal: AbortSignal
  deadlineAt: number
  preparationDeadlineAt: number
}>
export type RuntimeSource = {
  source: string
  javascript: string
  sourceMap: string
}
export type Participant = 'server' | 'browser'
export type RuntimeParticipant = {
  sessionId?: string
  pause: PauseIdentity | undefined
  phase: PauseGate['phase']
  snapshot: ConfiguredRuntimeSnapshot | undefined
  continued?: PauseIdentity
  conflict: boolean
}
export type ConfiguredRuntimeView = {
  runId: string
  /** The origin the owned app listens on (the project's own port), once it is ready. */
  applicationOrigin?: string
  /** Where the app's port was declared (D67): the `dev` script's own `-p`/`--port`, a `PORT=` that the script assigns (also in a script it delegates to), or Next's default 3000; the text also says when 3000 was taken because the script has a form Codebook does not read. `.env*` files are not read. */
  applicationPortSource?: string
  status: string
  cleaned: boolean
  resourcesReleased: boolean
  /** The run's own browser profile folder when its cleanup could not remove it. It is no failed release: `cleaned`, `resourcesReleased` and the outcomes are as without it. */
  browserProfileLeft?: ProfileLeft
  runtimeOutcome: 'demonstrated' | 'not-demonstrated'
  captureOutcome: 'complete' | 'incomplete'
  finalOutcome: ConfiguredStudy['finalOutcome']
  captures: Record<
    string,
    {
      status: 'pending' | 'captured' | 'failed'
      file?: string
      error?: string
      renderer?: { epoch: string; id: number; hash: string }
    }
  >
  snapshotCaptures?: Record<string, ConfiguredRuntimeView['captures'][string]>
  failures: string[]
  events: RecordedEvent[]
  artifactDirectory: string
  activeSessionIds: string[]
  profile: typeof REPOSITORY_BROWSER_PROFILE
  definition: ConfiguredDefinition
  manifest?: {
    hash: string
    configurationHash: string
    configuration: ConfiguredDefinition['configuration']
    descriptor: Pick<
      ConfiguredDefinition['descriptor'],
      'itemId' | 'bookTitle' | 'nodeTitle' | 'anchors' | 'citationContext'
    >
    itemId: ConfiguredObservation['itemId']
    sourceHash: string
    javascriptHash: string
    mapHash: string
  }
  participants: { browser: RuntimeParticipant; server?: RuntimeParticipant }
  snapshots: ConfiguredRuntimeSnapshot[]
  operation: ConfiguredStudy['operation']
  nextAction: typeof REPOSITORY_BROWSER_ACTION | undefined
  observed: { afterVerified: true } | undefined
  links: never[]
}
export type RuntimeView = ConfiguredRuntimeView
/** Shares owned repository runtime control with the service and recording pipeline. @example const runtime = await environment.createRuntime(directory, definition) */
export interface StudyRuntime {
  readonly id: string
  readonly evidence: Pick<
    Evidence,
    | 'save'
    | 'flush'
    | 'record'
    | 'recordFailure'
    | 'failure'
    | 'directory'
    | 'elapsedMs'
  >
  prepare(): Promise<void>
  view(): RuntimeView
  action(key: string, action: RuntimeAction): { id: string }
  continue(participant: Participant, pause: PauseIdentity): Promise<void>
  stop(): Promise<void>
  fail(reason: string): void
  source(item: string, snapshotId?: string): RuntimeSource | undefined
  reveal(snapshot: RuntimeSnapshot): Promise<void>
  /** Restarts a held pause's hold deadline while the learner reads a replay; runtimes without a pause hold omit it. */
  renewPauseHold?(): void
  /** Says whether the run completed and its final save has not settled yet, during which its completion is no result (a failed save fails the run); runtimes without such a save omit it. */
  isSavingCompletion?(): boolean
}
/** What a node-test start's pre-history check is bound by: the start's cancellation and preparation deadline (epoch milliseconds on the service's clock `now`), which bound a root claim's listing, and who hears of a root listing whose process group could not be confirmed as ended, before the run's history (or its journal) exists, with the retry that releases it at the run's stop. */
export type NodeTestPreparationControl = {
  signal: AbortSignal
  deadlineAt: number
  /** The clock `deadlineAt` is measured on: the service's own, which a test may replace. */
  now: () => number
  onListingNotReleased?: (
    failure: VitestListingReleaseFailure,
    retryRelease: RetryVitestListingRelease,
  ) => void
}
export interface StudyEnvironment {
  readonly workspace: string
  readonly host: HostConfiguration
  /** `vscode.env.remoteName` of the window: `wsl` in a WSL remote window, absent in a local one. A remote window has no Trash, so {@link StudyService} starts there with study removal unavailable. */
  readonly remoteName?: string
  readonly build: { revision: string; dirty: boolean; sourceHash: string }
  assertWorkspace?(): void
  prerequisites(): Promise<{
    ready: boolean
    missing: string[]
    profiles?: Partial<
      Record<
        | typeof REPOSITORY_BROWSER_PROFILE
        | typeof NODE_TEST_PROFILE
        | typeof NODE_SERVER_PROFILE,
        {
          ready: boolean
          missing: string[]
          /** node-test only: what the readiness search for a usable Vitest found ({@link searchRepositoryVitest}). */
          vitestSearch?: NodeTestVitestSearch
        }
      >
    >
  }>
  /**
   * The prerequisites a node-test start waits on: the editor's own, the bundled debugger and the external Node, never the repository-wide Vitest search, since the start checks the cited test's own Vitest before its history begins. Environments without it make the start wait on {@link StudyEnvironment.prerequisites}.
   */
  nodeTestStartPrerequisites?(): Promise<{ ready: boolean; missing: string[] }>
  nodeServerStartPrerequisites?(): Promise<{
    ready: boolean
    missing: string[]
  }>
  createRuntime(
    directory: string,
    definition: RuntimeDefinition,
    control?: RuntimeControl,
  ): Promise<StudyRuntime>
  /**
   * Checks the files a node-test configuration names against the opened repository and the editor's open documents of the cited sources ({@link checkNodeTestFiles}), then plans the run ({@link planNodeTestExecution}): its Vitest root, the root claim, its Vitest and its filter, before the run's history begins; a refusal ends the run with its typed error and records nothing.
   * @param citedSources - The article's text of every source the selected node cites; an open editor document with other text refuses the start.
   * @param control - The start's cancellation, its preparation deadline and who hears of an unreleased root listing ({@link NodeTestPreparationControl}).
   * @returns The execution plan the run launches with.
   * @throws The typed refusal of a path that is not a file, a changed source or a changed test file, a cited source open in the editor with other text, and every refusal of the plan's Vitest rules.
   */
  checkNodeTestFiles?(
    configuration: NodeTestConfiguration,
    citedSources: ConfiguredDescriptor['sources'],
    control: NodeTestPreparationControl,
  ): Promise<NodeTestExecutionPlan>
  createNodeTestRun?(
    configuration: NodeTestConfiguration,
    record: (type: string, detail?: unknown) => unknown,
    /** The article's text of every source the selected node cites: the run refuses its start, and ends at a continuation or at a stop, while the editor holds other text for one of them. */
    citedSources: ConfiguredDescriptor['sources'],
    /** The plan {@link StudyEnvironment.checkNodeTestFiles} returned; `undefined` only for an environment without that check, which then refuses. */
    plan: NodeTestExecutionPlan | undefined,
  ): Promise<NodeTestRuntime>
  /**
   * Creates the node-server run of a parsed configuration ({@link NodeServerRuntime}); its {@link NodeServerRuntime.prepare} checks the launch inputs, spawns and attaches. Environments without it read node-server as not ready.
   * @param configuration - The strictly parsed node-server configuration.
   * @param record - Journals the run's whitelisted `node-server.*` events.
   * @param citedSources - The article's text of every source the selected node cites; an open editor document with other text refuses the start (D12).
   * @param runId - The service's run id, sent as `x-codebook-run` and named in the debug session.
   */
  createNodeServerRun?(
    configuration: NodeServerConfiguration,
    record: (type: string, detail?: unknown) => unknown,
    citedSources: ConfiguredDescriptor['sources'],
    runId: string,
  ): Promise<NodeServerRuntime>
  /**
   * Asks the learner in a native modal whether to send a state-changing request (POST, PUT, PATCH, DELETE), naming its method and path and that the server uses the repository's own configured database (TD-6); the chat AI cannot answer it.
   * @returns `true` for Send; `false` for Cancel, a dismissal, or the signal's abort (D6: no answer within the pause-hold bound).
   */
  confirmStateChangingRequest?(
    request: { method: string; path: string },
    signal: AbortSignal,
  ): Promise<boolean>
}
