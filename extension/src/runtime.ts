import type {
  ExtensionClickOutcome,
  ExtensionSideEffect,
} from './chromeExtensionActionExecutor'
import type { ChromeExtensionConfiguration } from './chromeExtensionConfigSchemas'
import type {
  CapturedExtensionStop,
  ExtensionObservation,
  ExtensionPreparationPhase,
  ExtensionStopContext,
  ExtensionSurfaceKind,
} from './chromeExtensionContracts'
import type {
  ExtensionContinueArguments,
  ExtensionIntervention,
  ExtensionPauseView,
} from './chromeExtensionDebugger'
import type {
  ChromeExtensionHistorySink,
  ExtensionHistoryIdentity,
} from './chromeExtensionHistorySink'
import type {
  ConfiguredDefinition,
  ConfiguredDescriptor,
  ConfiguredObservation,
  ConfiguredStudy,
} from './configuredStudySchemas'
import type {
  CHROME_EXTENSION_PROFILE,
  NODE_SERVER_PROFILE,
  NODE_TEST_PROFILE,
  REPOSITORY_BROWSER_ACTION,
  REPOSITORY_BROWSER_PROFILE,
  REPOSITORY_OPERATION_ACTION,
} from './constants'
import type { ErrorCode, StudyError } from './errors'
import type { NodeServerConfiguration } from './nodeServerConfigSchemas'
import type { NodeServerHistorySink } from './nodeServerHistorySink'
import type { NodeTestConfiguration } from './nodeTestConfigSchemas'
import type { NodeTestSourceStop } from './ownedNodeTestRun'
import type { ReplayDebugSnapshot } from './replayDebugSchemas'
import type { Evidence, RecordedEvent } from './runtimeSupport/evidence'
import type {
  HostConfiguration,
  ProfileLeft,
} from './runtimeSupport/hostBrowser'
import type { PauseIdentity, PauseGate } from './runtimeSupport/pauseGate'
import type { SecretFrameGate } from './runtimeSupport/secretFrameGate'
import type { StateChangingRequestQuestion } from './utils/askToSendStateChangingRequest'
import type {
  RetryVitestListingRelease,
  VitestListingReleaseFailure,
} from './utils/listVitestTestFiles'
import type { NodeTestExecutionPlan } from './utils/planNodeTestExecution'
import type { RepositoryAdapterReadiness } from './utils/readRepositoryAdapterReadiness'
import type { PreparedTextState } from './utils/redactPreparedTexts'
import type { CauseRoots } from './utils/sanitizeCause'
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
  /** The declared inspections' values by `<mode>:<path>` (`value:user.id`, `type:user.id`), redacted ({@link redactInspectedValue}). */
  facts: Record<string, unknown>
  /** Declared inspections the debugger could not read, each as `<mode>:<path>` with its reason. */
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
  /** Milliseconds since the server launched, the clock every history entry carries; `0` before a launch. Read by the seal for the end entry's time. */
  elapsedSinceLaunchMs(): number
  /** Calls the listener after every change of {@link NodeServerRuntime.view}. */
  onDidChange(listener: () => void): { dispose(): void }
  /** Sends the declared request once; resolves once its bytes went to the owned listener (the response arrives in the view). Throws `RUN_NOT_READY`, `REQUEST_ALREADY_SENT`, `LEARNER_PAUSED`, or `LISTENER_NOT_OWNED` with zero bytes sent. */
  sendRequest(key: string): Promise<void>
  /** Continues the current pause: reserves its generation atomically, then resumes; resolves once the debugger resumed. Throws `STALE_PAUSE`, `NO_PAUSE` or `LEARNER_PAUSED`. */
  continue(pause: PauseIdentity): Promise<void>
  /** Stops the server within one 10 s deadline (D14 v3: a server paused in the debugger, or with its request under way, is ended before its debugger detaches, so the paused code never runs on; otherwise detach, SIGTERM, SIGKILL after 5 s); idempotent, retryable after a failure. */
  stop(): Promise<void>
}

/** The phase of a chrome-extension run (SR17): `starting`, the preparation phases the launch and the debugger report, then `ready`, `paused`, `observing` and the two endings. Nothing before `ready` counts as a learning stop. */
export type ChromeExtensionPhase =
  | 'starting'
  | ExtensionPreparationPhase
  | 'ready'
  | 'paused'
  | 'observing'
  | 'completed'
  | 'failed'

/**
 * One read of the run's declared observation as the run resource reports it (CR9, ER23): a value (masked, root-hidden, cut at 4,096 characters with `truncated`), a missing element or key, or a failed read with its cause.
 * A real `null` is a value; `missing` and `unavailable` are distinct from it.
 */
export type ChromeExtensionObservedRead =
  | { value: unknown; truncated?: true }
  | { missing: true }
  | { unavailable: true; cause: string }

/** The observation report of a chrome-extension run (CR9, DXR7): the baseline read at `ready` and the read after the last click. */
export type ChromeExtensionObserved = {
  kind: ExtensionObservation['kind']
  before: ChromeExtensionObservedRead
  after: ChromeExtensionObservedRead
  /** Compared on the unmasked canonical values; absent when either read is unavailable. */
  changed?: boolean
  /** Milliseconds since the run's launch when the after read agreed. */
  observedAtMs: number
}

/** What one `extension-click` call answers (SR2, DXR4); the progress is read when the call returned. */
export type ChromeExtensionClickAnswer = {
  /** 1-based index of the declared click this call performed (DXR8). */
  clickIndex: number
  outcome: ExtensionClickOutcome
  inputsApplied: number
  clickDispatched: boolean
  inputEffects: ExtensionSideEffect[]
  clickEffect: ExtensionSideEffect
}

/** One console line of the extension (C3), masked, root-hidden and cut at the event limit. */
export type ChromeExtensionOutputLine = {
  context: ExtensionStopContext
  text: string
  /** Milliseconds since the run's launch. */
  atMs: number
}

/** What a chrome-extension run shows the service: the run resource's `chromeExtension` block and `claimable` come from it (SR17, CR5, CR9, CR10, ER16, DXR7). */
export type ChromeExtensionView = {
  phase: ChromeExtensionPhase
  /** How far each click's prepared input texts were resolved (`secret` or `plain` once typed), by click then input; the texts are never in the view. */
  inputStates?: PreparedTextState[][]
  /** Set once `starting` resolved the configuration; absent while the run is still resolving it or when it refused before. */
  extension?: {
    id: string
    surface: { kind: ExtensionSurfaceKind; path: string; url: string }
    /** The manifest's `name`, `permissions` and `host_permissions` (CR5). */
    manifest: {
      name: string
      permissions: readonly string[]
      hostPermissions: readonly string[]
    }
  }
  /** Clicks performed of declared (CR9's `procedure`); `clickInFlight` is the 1-based index of a click whose call has not settled; `clickWorkPending` says the latest click's work still goes on after its call answered `paused` or `running`. */
  procedure: {
    clicksDeclared: number
    clicksPerformed: number
    clickInFlight?: number
    clickWorkPending?: boolean
  }
  /** The answer of the latest click call, updated while its steps go on. */
  lastClick?: ChromeExtensionClickAnswer
  /** Every open pause with its own continue arguments (ER16). */
  pauses: ExtensionPauseView[]
  /** Every captured declared stop, in capture order. */
  captures: CapturedExtensionStop[]
  stopsDeclared: number
  /** 1-based indexes of declared stops not reached (DXR8). */
  stopsNotReached: number[]
  /** `complete` or `partial` (any stop not reached) once the run is `completed` or was stopped after `ready` (SR17, SR22). */
  result?: 'complete' | 'partial'
  /** The observation once read; `null` when the run was stopped before its last click (SR22); absent before. */
  observed?: ChromeExtensionObserved | null
  /** `true` only when the run completed and the observation was read (changed, unchanged or missing) (DXR7). */
  claimable: boolean
  interventions: readonly ExtensionIntervention[]
  outputs: readonly ChromeExtensionOutputLine[]
  /** Output lines dropped after the run's output limit, {@link EXTENSION_OUTPUT_EVENT_LIMIT}. */
  outputsDropped: number
  /** Why the run shows no Application view (the editor refused to place it), masked and root-hidden; absent while the view opened (DR6). */
  viewUnavailable?: string
  /** The failure that ended the run (`failed`), or `OBSERVATION_UNAVAILABLE` beside a `completed` run. */
  runFailure?: StudyError
  /** What the cleanup could not confirm (ER18); absent until the cleanup ran. */
  cleanup?: { profileLeft: boolean; exitConfirmed: boolean }
}

/**
 * A chrome-extension run the service drives (Cycle 0061 pt2): resolves and checks the declaration, launches the owned Chrome with the unpacked extension, attaches the editor's debugger, arms the stops, performs one declared click per call, observes the result and cleans up through one path.
 * Created by {@link StudyEnvironment.createChromeExtensionRun}; the service owns keys, receipts (DXR3), the run resource and the save/explain refusal (SR13).
 */
export interface ChromeExtensionRuntime {
  readonly id: string
  /** Runs `starting` through `ready` and reads the observation baseline; resolves at `ready`, rejects with the run's typed {@link StudyError} after its cleanup. */
  prepare(): Promise<void>
  view(): ChromeExtensionView
  /** Calls the listener after every change of {@link ChromeExtensionRuntime.view}. */
  onDidChange(listener: () => void): { dispose(): void }
  /**
   * Performs the next declared click and answers once a declared stop pauses, the work settles or the return bound passes (SR2).
   * @throws `RUN_NOT_READY`, `RUN_PAUSED`, `ACTION_IN_PROGRESS`, `NO_MORE_ACTIONS`, `SELECTOR_NOT_FOUND` or `SERVICE_WORKER_NOT_ATTACHED` with nothing consumed; `INPUT_PARTIAL`, `CLICK_OUTCOME_UNKNOWN`, `DIALOG_UNDECLARED`, `SOURCE_CHANGED`, `SERVICE_WORKER_RESTARTED` after the run failed and was cleaned up.
   */
  click(): Promise<ChromeExtensionClickAnswer>
  /** Continues one declared pause with the arguments the run resource listed (DXR5). @throws `STALE_PAUSE`, `NO_PAUSE`, `LEARNER_PAUSED`, `SOURCE_CHANGED`. */
  continue(args: ExtensionContinueArguments): Promise<void>
  /** Ends the run through its one cleanup path (CR14); idempotent; a stop before the last click leaves `result: 'partial'` and `observed: null` (SR22). */
  stop(): Promise<void>
}

/** What {@link StudyEnvironment.createChromeExtensionRun} is given. */
export type ChromeExtensionRunInput = {
  /** The service's run id, named in the debug session and the journal. */
  runId: string
  /** The strictly parsed declaration. */
  configuration: ChromeExtensionConfiguration
  /** `codebook_start`'s `acknowledgedPermissions`, matched exactly against the manifest's permissions that reach outside the test profile (ER5). */
  acknowledgedPermissions: readonly string[]
  /** Journals the run's whitelisted `chrome-extension.*` events (SR32). */
  record: (type: string, detail?: unknown) => unknown
  /** The service's private roots, hidden in journaled text and causes. */
  privateRoots?: CauseRoots
  /**
   * Starts the run's history once its declaration resolved (the header names the extension, so the run cannot ask earlier). The run tells the sink each pause, capture, continue, the surface ending and the result, and the Application view gives it the surface's frames.
   * Resolves to `undefined` when no history could start, and the run goes on unrecorded; it never rejects. Absent → the run does not record.
   */
  beginHistory?: (
    identity: ExtensionHistoryIdentity,
  ) => Promise<ChromeExtensionHistorySink | undefined>
  /** Why no history started, once `beginHistory` resolved to `undefined`; the Application view's header words it as `Not recorded · <reason>`. */
  historyUnavailable?: () => string | undefined
  /** The gate a pause screenshot passes once a secret input was sent; absent → every screenshot is kept. */
  secretFrameGate?: SecretFrameGate
}

export type ConfiguredRuntimeSnapshot = Omit<
  ConfiguredObservation,
  'snapshotUri' | 'interpretations'
>
export type RuntimeSnapshot = ConfiguredRuntimeSnapshot
export type RuntimeAction =
  typeof REPOSITORY_BROWSER_ACTION | typeof REPOSITORY_OPERATION_ACTION
/**
 * The progress of one declared operation of a version 3 run, as the run resource lists it in `operations` (ENG-2): it moves forward only.
 * `ack` and `valueCheck` stay `pending` while a stop inside the control's `input` or `change` handler is paused; `effect` becomes `after-verified` once the operation's own `after` conditions held (for the last operation, the run's).
 */
export type OperationRecord = {
  /** 1-based, as in `afterOperation` and every receipt. */
  index: number
  kind: 'text' | 'choose' | 'click'
  title: string
  state: 'not-run' | 'sending' | 'paused' | 'done' | 'failed'
  ack: 'pending' | 'yes'
  valueCheck: 'pending' | 'passed' | 'failed' | 'n/a'
  effect: 'pending' | 'dispatched' | 'after-verified'
}
/** The first failure of an operation of a version 3 run, with the fields that decide a retry (DX-5); the service adds the run's address. */
export type OperationFailure = {
  code: string
  operationIndex: number
  /** The configuration path the fix is made at, such as `operations[2].selector`. */
  path?: string
  sent: 'not-sent' | 'sent'
  sideEffects: 'none' | 'unknown'
  /** `<runId>#<operationIndex>`: the id of the structured Output > Codebook line that records the failure. */
  logId: string
}
export type RuntimeDefinition = ConfiguredDefinition
export type RuntimeControl = Readonly<{
  signal: AbortSignal
  deadlineAt: number
  preparationDeadlineAt: number
  /** The service's id of the run, which an operation's log id (`<runId>#<operationIndex>`) and Output > Codebook lines name; the run's own id when absent. */
  runId?: string
  /** Receives one plain Output > Codebook line per operation event of a version 3 run (dispatch, receipt, effect, refusal); the lines never hold a secret. */
  outputLog?: (line: { level: 'info' | 'error'; text: string }) => void
}>
export type RuntimeSource = {
  source: string
  javascript: string
  sourceMap: string
  /** True when `javascript` and `sourceMap` are the masked copy (env-file values replaced by the mask): their text no longer hashes to the seal's hashes, which name the executed bytes. */
  redacted?: boolean
  /** With `redacted`: the SHA-256 of the unmasked JavaScript and map bytes the run still holds, so a resource read can check them against the seal although the served text is masked. */
  executedHashes?: { javascript: string; sourceMap: string }
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
  /** The Vite version a `vite-dev` run started, read from the resolved `vite/package.json`. */
  viteVersion?: string
  /** The route a Next run in a workspace with a Pages folder resolved its entry path to, once known: the router that serves it, the manifest key, and for a Pages route its workspace-relative source. Absent for a Vite run and a Next run in a workspace without a Pages folder. */
  nextRoute?: { router: 'app' | 'pages'; route: string; source?: string }
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
  /** How far the run resolved each `initialInputs` text (`pending`, `secret` or `plain`); the texts themselves are never in the view. A view without it counts every text as unresolved. */
  preparedTextStates?: PreparedTextState[]
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
    viteVersion?: string
  }
  participants: { browser: RuntimeParticipant; server?: RuntimeParticipant }
  snapshots: ConfiguredRuntimeSnapshot[]
  operation: ConfiguredStudy['operation']
  /** The progress of each declared operation of a version 3 run, in declared order; absent for versions 1 and 2. */
  operations?: OperationRecord[]
  /** The first failure of an operation of a version 3 run; absent otherwise. */
  operationFailure?: OperationFailure
  nextAction:
    | typeof REPOSITORY_BROWSER_ACTION
    | typeof REPOSITORY_OPERATION_ACTION
    | undefined
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
  /**
   * Reserves the next declared input synchronously; its protocol acknowledgement never blocks state or continuation.
   * @param options - `learnerSecret`: the value the learner typed for a `secret: "ask-learner"` operation, which the run types into the page and keeps only in memory.
   * @returns The operation's id, and for a version 3 run its 1-based `operationIndex`.
   */
  action(
    key: string,
    action: RuntimeAction,
    options?: { learnerSecret?: string },
  ): { id: string; operationIndex?: number }
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
        | typeof NODE_SERVER_PROFILE
        | typeof CHROME_EXTENSION_PROFILE,
        {
          ready: boolean
          missing: string[]
          /** node-test only: what the readiness search for a usable Vitest found ({@link searchRepositoryVitest}). */
          vitestSearch?: NodeTestVitestSearch
          /** repository-browser only: each adapter's readiness for this workspace ({@link readRepositoryAdapterReadiness}). */
          adapters?: RepositoryAdapterReadiness
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
  /**
   * The prerequisites a chrome-extension start waits on: the editor's own, the platform and the Chrome lookup, never the other profiles' checks (Vitest search, node-server gaps, Node lookup). Environments without it make the start wait on {@link StudyEnvironment.prerequisites}.
   */
  chromeExtensionStartPrerequisites?(): Promise<{
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
   * @param history - Where the run reports what it records for a saved server replay; absent when no history started (the run goes on without one).
   * @param privateRoots - The service's private roots (storage, learning directory, workspace, home), hidden in the server's output and response; absent → the run hides the workspace and home only.
   */
  createNodeServerRun?(
    configuration: NodeServerConfiguration,
    record: (type: string, detail?: unknown) => unknown,
    citedSources: ConfiguredDescriptor['sources'],
    runId: string,
    history?: NodeServerHistorySink,
    privateRoots?: CauseRoots,
  ): Promise<NodeServerRuntime>
  /**
   * Creates the chrome-extension run of a parsed declaration ({@link ChromeExtensionRuntime}); its {@link ChromeExtensionRuntime.prepare} resolves the extension, launches the owned Chrome and attaches. Environments without it read chrome-extension as not ready.
   */
  createChromeExtensionRun?(
    input: ChromeExtensionRunInput,
  ): Promise<ChromeExtensionRuntime>
  /**
   * Asks the learner in a native modal whether to send a state-changing request (POST, PUT, PATCH, DELETE), naming its method and path and that the server uses the repository's own configured database (TD-6); the chat AI cannot answer it.
   * @returns `true` for Send; `false` for Cancel, a dismissal, or the signal's abort (D6: no answer within the pause-hold bound).
   */
  confirmStateChangingRequest?(
    request: StateChangingRequestQuestion,
    signal: AbortSignal,
  ): Promise<boolean>
  /**
   * Asks the learner, in the editor's password input box, for the secret of a `secret: "ask-learner"` operation; the chat never sees the answer.
   * @param question - The run, the repository folder name and the operation's title, which the box shows as `<repository> · <title>`.
   * @param signal - Closes the box when the run stops or the wait ends.
   * @returns The typed secret, or `undefined` when the learner dismissed the box or the signal aborted.
   */
  askLearnerSecret?(
    question: { runId: string; repository: string; title: string },
    signal: AbortSignal,
  ): Promise<string | undefined>
}
