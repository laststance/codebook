import { join, resolve } from 'node:path'
import type { TestContext } from 'node:test'
import { runInNewContext } from 'node:vm'

import type { DebugSession } from 'vscode'

import type { ConfiguredBrowserRun } from '../../configuredBrowserRun'
import type * as ConfiguredBrowserRunModule from '../../configuredBrowserRun'
import { configuredDefinitionSchema } from '../../configuredStudySchemas'
import {
  CROSS_RUNTIME_CONFIG_VERSION,
  SECRET_FRAME_OBSERVER_GLOBAL,
  REPOSITORY_LITERAL_LIMIT_CHARS,
} from '../../constants'
import { StudyError } from '../../errors'
import type * as OwnedRepositoryBreakpointModule from '../../ownedRepositoryBreakpoint'
import type { BundleSource } from '../../repositoryBundle'
import type {
  RepositoryConfiguration,
  RepositoryOperation,
} from '../../repositoryConfigSchemas'
import type { RuntimeControl } from '../../runtime'
import type { ViewportRecordingObserver } from '../../runtimeSupport/browserViewport'
import type { ProfileLeft } from '../../runtimeSupport/hostBrowser'
import type {
  AppCookieKind,
  SavedSessionRunLease,
  SignInRequiredReason,
} from '../../runtimeSupport/savedSessionTypes'
import {
  WITHHOLD_REASON_OF_VERDICT,
  type SecretFrameGate,
  type SecretFrameVerdict,
} from '../../runtimeSupport/secretFrameGate'
import { describeWithheldImage } from '../../runtimeSupport/utils/describeWithheldImage'
import { sha256 } from '../../runtimeSupport/utils/sha256'
import { WaitTimeoutError } from '../../runtimeSupport/utils/waitTimeoutError'
import { waitUntil } from '../../runtimeSupport/utils/waitUntil'
import { citationContext } from '../../utils/citationContext'
import { configuredDomExpression } from '../../utils/configuredDomExpression'
import { configuredScrollExpression } from '../../utils/configuredScrollExpression'
import { createBundleVerifier } from '../../utils/createBundleVerifier'
import type { NextPagesDiscoveryCache } from '../../utils/createNextPagesDiscoveryCache'
import {
  describeNextEntryResponse,
  type NextEntryResponse,
} from '../../utils/describeNextEntryResponse'
import { maskEnvValues, maskKnownValues } from '../../utils/maskKnownValues'
import { NEXT_PAGES_STATE_EXPRESSION } from '../../utils/readNextPagesState'
import { readPagesDevelopmentBundle } from '../../utils/readPagesDevelopmentBundle'
import * as viteDevAdapter from '../../viteDevAdapter'

import {
  answerBreakLocationRequest,
  type BreakLocationRange,
  type GeneratedPlace,
  type ScriptPlace,
} from './breakLocationsInRange'
import { createConfiguredStudy } from './createConfiguredStudy'
import { createManualClock } from './createManualClock'
import { createSourceBoundWaitHold } from './createSourceBoundWaitHold'
import { debuggerPausedEvent } from './debuggerPausedEvent'
import {
  loadConstantsWith,
  type RuntimeConstantOverrides,
} from './loadConstantsWith'
import { loadModule } from './loadModule'
import {
  writeNextPagesWorkspace,
  type NextPagesHarnessOptions,
  type NextPagesPageState,
} from './nextPagesWorkspace'
import { repositoryHarness } from './repositoryHarness'
import { sourceBreakpointRequest } from './sourceBreakpointRequest'

/** What the owned page reports for a condition that does not hold; `textDifference` is left open so a test can send a value the run must refuse. */
interface BeforeFailure {
  conditionIndex?: number
  reason: string
  textDifference?: string
  /** The page's control counts, sent with a missing click target. */
  candidates?: { button: number; link: number; field: number }
}

/** What the stand-in page reports of one control a version 3 operation names; a control without an entry is an ordinary text input. */
export interface FakeControl {
  tagName?: 'input' | 'textarea' | 'select'
  /** The `<input type>`; `text` by default. */
  type?: string
  /** The type the secret frame gate's in-page observer finds on the control, when it differs from `type`. */
  observedType?: string
  name?: string
  id?: string
  autocomplete?: string
  /** A `<select multiple>`. */
  multiple?: boolean
  /** The options of a select. */
  options?: { value: string; disabled?: boolean }[]
}

/** The source of a fixture that gives none: one statement on line 1 and an empty line 2, declared with `var` so that the stop on line 1, which requires value:nextTheme, stays on its declared line. */
const FIXTURE_SOURCE = 'var nextTheme = "dark";\n'

/**
 * Moves the first cited source of a configured study, and the stop declared in it, to another workspace-relative path, keeping its text and hash.
 * @param reference - The study {@link createConfiguredStudy} made; changed in place.
 * @param path - The new path, such as `src/pages/api/hello.ts`.
 * @example relocateFirstSource(reference, 'src/pages/_document.tsx')
 */
function relocateFirstSource(
  reference: ReturnType<typeof createConfiguredStudy>,
  path: string,
): void {
  const descriptor = reference.descriptor!
  reference.configuration.source.path = path
  descriptor.anchors[0]!.path = path
  descriptor.sources[0]!.path = path
  descriptor.citationContext = citationContext(descriptor.anchors)
}

/** Drives the product coordinator with real Git/source/evidence and controlled native protocol events, never claiming actual-editor proof. @example const harness = await configuredRuntimeHarness(context); await harness.run.prepare() */
export async function configuredRuntimeHarness(
  context: TestContext,
  control?: RuntimeControl,
  additionalStops: RepositoryConfiguration['additionalStops'] = [],
  options: {
    /** Replaces the sealed map; by default generated 0:0 maps to source 1:1, and with additional stops generated 0:6 maps to 1:7 as well. */
    mappings?: string
    /** Replaces the declared before conditions, so a test can make a text or attribute condition the one that fails. */
    before?: RepositoryConfiguration['action']['before']
    /** Opts into a source the debugger can bind on another line than declared: the executed module is then the source text itself, so generated line n is source line n + 1 under a map such as 'AAAA;AACA'. */
    fixture?: {
      /** Replaces the one-statement source; its default (`var nextTheme = "dark";`) already has an empty line 2. */
      source?: string
      /** Last line of the first citation instead of line 1. */
      citationEndLine?: number
      /** Line the first stop is declared on instead of line 1. */
      declaredLine?: number
      /** Column the first stop is declared at instead of column 1. */
      declaredColumn?: number
    }
    /** Replaces runtime bounds in the run's own module and in the constants it reads ({@link loadConstantsWith}), so a test can make two bounds equal and see what depends on their values. The modules the run requires (the owned breakpoint, `waitUntil`) keep the real bounds. */
    runtimeConstants?: RuntimeConstantOverrides
    /** The stand-in browser closes without a failure and then names this profile folder as one it could not remove, as the real adapter does. */
    browserProfileLeft?: ProfileLeft
    /** How the stand-in `[::1]` forwarder starts: its own (default), absent on a host without IPv6 loopback, or refused because another process holds `[::1]`. */
    ipv6Loopback?: 'owned' | 'absent' | 'held'
    /** Runs the configuration on the Vite adapter: its stand-in starts the stub server, serves the sealed module at its owned address and loads the entry page once. */
    adapter?: 'vite-dev'
    /** Makes the Vite stand-in refuse to seal with this sentence, as a missing served module does. */
    sealFailure?: string
    /** Makes the stand-in seal (the Vite served-module read, or the Next `.next/dev` read) never finish, as a server that stops answering does while a stop is sealed. */
    sealHangs?: boolean
    /** The executed module's text instead of the default one-statement module, such as a Vite module with an inlined env value. */
    moduleJavascript?: string
    /** Makes the Vite stand-in report these values as the ones it masks in kept module text, as the launcher's env-file values are. */
    maskedValues?: string[]
    /** Names the executed module's source map lists (its `names`), such as an env value an inlined constant carries. */
    sourceMapNames?: string[]
    /** The text the debugger reports for `nextTheme` (its variable and the declared inspection) instead of `dark`. */
    capturedValue?: string | number | boolean
    /** Further variables the debugger reports at a stop beside `nextTheme`, by name (such as a secret-named `sessionToken`), as the app's scope would hold. */
    extraVariables?: Record<string, string>
    /** Makes the Vite stand-in reload the page, serving changed module bytes, right after the entry page was requested and before the run waits for the page to settle. */
    reloadDuringEntryLoad?: boolean
    /** Runs the Next configuration in a workspace with a Pages folder: the stand-in server answers the structured entry check, the `.next/dev` build is written around the cited source, and the page reports `window.next.router` ({@link NextPagesHarnessOptions}). */
    nextPages?: NextPagesHarnessOptions
    /** Moves the first cited source, and the stop declared in it, to this workspace-relative path (such as a file under `src/pages`). */
    sourcePath?: string
    /** Declares the first stop for this participant in a version 2 (cross-runtime) configuration, as a start that names `participant` does; only without additional stops, whose version 2 form differs. */
    participant?: 'browser' | 'server'
    /** The configuration's initial inputs; the stand-in page has one editable control for each selector. */
    initialInputs?: RepositoryConfiguration['initialInputs']
    /** What the focus phase of an initial input reports about its control, by selector: type, name, id and autocomplete. */
    preparedControls?: Record<
      string,
      { type?: string; name?: string; id?: string; autocomplete?: string }
    >
    /** Makes the stand-in page never answer the text insert of an initial input, as a page whose reply is lost. */
    holdInputInsert?: boolean
    /** Makes the stand-in browser's end of the recording history wait until {@link releaseRecordingHistoryEnd} is called, as a drain of queued image verdicts that takes its whole bound. */
    holdRecordingHistoryEnd?: boolean
    /** Makes the stand-in browser's `recordCapture` ask the run's secret frame gate for its verdict, as the real browser does; a withheld image becomes a recording gap. Without it the stand-in keeps every image ('pass'). */
    consultSecretFrameGate?: boolean
    /** Makes the stand-in server's readiness check (`ready` and `readyEntry`) reject with this message, as a server that exits before it listens does. */
    launchFailure?: string
    /** Makes the stand-in server's structured entry check (`readyEntry`) never answer until the run is cancelled, as a first compile that is still running does. */
    entryHangs?: boolean
    /**
     * Binds a stand-in saved-session store to the run, as `createRuntime` does for a version 3 run: `admission` is what the store answers (the saved session with a lease, or a fresh profile with the reason), `refuse` makes it throw a coded refusal instead, and `appCookies` is the lease's cookie kind.
     * The stand-in browser then takes the lease like the real one (`prepareForLaunch` at launch, `recordBrowser` after it), and the page reports its navigations.
     */
    savedSession?: {
      admission: 'saved' | 'no-saved-session' | 'setup-not-finished'
      refuse?: StudyError
      appCookies?: AppCookieKind
    }
    /** The structured answer of the stand-in server's entry check (`readyEntry`) for a version 3 run: the status and the `Location` it redirects to. */
    entryAnswer?: { status: number; location?: string }
    /** The origin the stand-in server reports as its own (default `http://127.0.0.1:4321`). */
    serverOrigin?: string
    /** The configuration's entry path (default: none, so `/`). */
    entryPath?: string
    /** Makes the stand-in browser's first `close` fail, as a close that could not confirm Chrome's exit does; the second succeeds. */
    closeFailsOnce?: boolean
    /** The path the stand-in page lands on after each `Page.navigate` of a saved-session run (default: the path asked for). */
    navigationLandsOn?: string
    /** Makes the stand-in server's App verdict (`confirmAppEntry`) record its answer and then never settle until the run is cancelled, as a redirected root whose second request does not answer. */
    appEntryConfirmationHangs?: boolean
    /** Makes the stand-in page never answer a screenshot until the run is cancelled, so the run stays at the end of its setup, after the inputs were written. */
    holdScreenshot?: boolean
    /**
     * Runs a version 3 configuration of ordered operations instead of the single action: the first stop and each of `additionalStops` follow the operation `stopOperations` names (the first stop first). A stop's pause is reported inside the input of its operation, which the page answers only once the operation's last stop was continued, as a handler paused in the debugger does.
     */
    operations?: {
      operations: RepositoryOperation[]
      stopOperations: number[]
      /** The controls the stand-in page reports, by selector. */
      controls?: Record<string, FakeControl>
      /** Selectors whose text the page reads back differently after the insert, as a control that rewrites its value does. */
      failValueCheck?: string[]
      /** The reason the page gives when a text's value check fails, in place of the default; a page may quote what it holds. */
      failValueCheckReason?: string
      /** Selectors of native-value controls (number, select) whose page call applies nothing, as a select without the declared option does. */
      unappliedNativeValue?: string[]
      /** Makes the page's answer to resolving a control throw an error with this message, as a transport failure that quotes text does. */
      selectControlFailsWith?: string
      /** The configuration's `signInPaths`. */
      signInPaths?: string[]
      /** The configuration's `session: "fresh"`. */
      session?: 'fresh'
    }
  } = {},
) {
  let owned: ConfiguredBrowserRun | undefined
  let releaseHistoryEnd: () => void = () => {}
  const historyEndReleased = new Promise<void>((resolve) => {
    releaseHistoryEnd = resolve
  })
  context.after(async () => {
    releaseHistoryEnd()
    await owned?.stop()
  })
  const repository = await repositoryHarness(context),
    fixture = options.fixture,
    // A fixture without its own source declares the stop's binding with `var`, which the run reads where it was declared: a `const` on the stop's own line would make the run request the stop on the next mapped line, as it does for an agent's declaration.
    reference = createConfiguredStudy(
      fixture ? (fixture.source ?? FIXTURE_SOURCE) : undefined,
      fixture?.citationEndLine,
    )
  if (options.adapter) reference.configuration.adapter = options.adapter
  if (additionalStops.length)
    reference.configuration.additionalStops = additionalStops
  if (options.before) reference.configuration.action.before = options.before
  if (fixture?.declaredLine)
    reference.configuration.source.line = fixture.declaredLine
  if (fixture?.declaredColumn)
    reference.configuration.source.column = fixture.declaredColumn
  if (options.sourcePath) relocateFirstSource(reference, options.sourcePath)
  if (options.entryPath ?? options.nextPages?.entryPath)
    reference.configuration.entryPath =
      options.entryPath ?? options.nextPages?.entryPath
  if (options.initialInputs)
    reference.configuration.initialInputs = options.initialInputs
  // A version 2 configuration names the first stop's participant; its other fields are the version 1 ones.
  const configuration = options.operations
    ? {
        version: 3 as const,
        adapter: reference.configuration.adapter,
        book: reference.configuration.book,
        source: reference.configuration.source,
        participant: 'browser' as const,
        afterOperation: options.operations.stopOperations[0]!,
        before: reference.configuration.action.before,
        after: reference.configuration.action.after,
        operations: options.operations.operations,
        inspections: reference.configuration.inspections,
        additionalStops: additionalStops.map((stop, index) => ({
          participant: 'browser' as const,
          source: {
            ...reference.configuration.source,
            line: stop.line,
            column: stop.column,
          },
          anchorIndex: reference.configuration.book.anchorIndex,
          inspections: stop.inspections,
          afterOperation: options.operations!.stopOperations[index + 1]!,
        })),
        ...(reference.configuration.entryPath
          ? { entryPath: reference.configuration.entryPath }
          : {}),
        ...(options.operations.signInPaths
          ? { signInPaths: options.operations.signInPaths }
          : {}),
        ...(options.operations.session
          ? { session: options.operations.session }
          : {}),
      }
    : options.participant
      ? {
          ...reference.configuration,
          version: CROSS_RUNTIME_CONFIG_VERSION,
          participant: options.participant,
        }
      : reference.configuration
  // Each of these changes makes the frozen intent hash stale.
  if (
    additionalStops.length ||
    options.before ||
    fixture ||
    options.adapter ||
    options.sourcePath ||
    options.nextPages?.entryPath ||
    options.entryPath ||
    options.initialInputs ||
    options.participant ||
    options.operations
  )
    reference.configurationHash = sha256(JSON.stringify(configuration))
  for (const source of reference.descriptor!.sources)
    await repository.track(source.path, source.text)
  // A Pages project around the cited source: its Pages folder, Next, the `.next/dev` build and the module the page executes.
  const pagesBuild = options.nextPages
    ? await writeNextPagesWorkspace(
        repository.directory,
        reference.descriptor!.sources[0]!,
        options.nextPages,
      )
    : undefined
  const definition = configuredDefinitionSchema.parse({
    configuration,
    configurationHash: reference.configurationHash,
    descriptor: reference.descriptor,
  })
  // A version 3 configuration has no one click target; its run-level after conditions stand for the action's.
  const declaredAction =
    'action' in definition.configuration
      ? definition.configuration.action
      : { after: definition.configuration.after, selector: '#unused' }
  const afterExpression = configuredDomExpression(declaredAction.after)
  const scrollExpression = configuredScrollExpression(declaredAction.selector)
  const sourcePath = join(
      repository.directory,
      definition.configuration.source.path,
    ),
    source = reference.descriptor!.sources[0]!.text,
    // With a fixture the executed module mirrors the source line for line, so a pause can be placed on any of its lines; a Pages page executes the eval module of its chunk.
    javascript =
      options.moduleJavascript ??
      pagesBuild?.moduleJavascript ??
      (fixture ? source : 'const nextTheme = "dark";')
  const bundle: BundleSource = {
    sourcePath,
    source,
    javascript,
    sourceMap: JSON.stringify({
      version: 3,
      sources: [sourcePath],
      sourcesContent: [source],
      names: options.sourceMapNames ?? [],
      mappings:
        options.mappings ?? (additionalStops.length ? 'AAAA,MAAM' : 'AAAA'),
    }),
    mapSource: sourcePath,
    scriptUrl: options.adapter
      ? 'http://127.0.0.1:4321/src/theme.ts'
      : options.nextPages
        ? `webpack-internal:///(pages-dir-browser)/./${definition.configuration.source.path}`
        : 'webpack-internal:///(app-pages-browser)/./src/theme.ts',
    chunkPath: join(repository.directory, '.next/dev/chunk.js'),
    chunkHash: '0'.repeat(64),
  }
  const releases: string[] = [],
    mouse: { type?: string; timeout?: number }[] = [],
    commands: string[] = [],
    listeners = new Map<string, (event: unknown) => void>()
  const clock = createManualClock()
  let requestSequence = 0
  const bindingWaitBudgetsMs: (number | undefined)[] = []
  const navigations: string[] = []
  // Every expression the run evaluated in the owned page, in order.
  const evaluatedExpressions: string[] = []
  const launchConfigurations: DebugSession['configuration'][] = []
  const setupSteps: string[] = []
  // The text of the module the Vite stand-in serves now; {@link serveChangedModule} replaces it, as a dependency-optimizer reload does.
  let servedJavascript = javascript
  // The seal refusal the Vite stand-in gives from now on; {@link refuseLaterSeals} sets it.
  let laterSealRefusal: string | undefined
  // How many times the run asked the Vite stand-in whether the server is settled, and the hold on its answer.
  let settledQuestions = 0
  // How many times the run read a stop module from the Vite stand-in.
  let sealReads = 0
  let optimizerHold: Promise<void> | undefined
  // The wait bounds the run passed to the stand-in, and the way to end a wait as the launcher's own wait does at its bound.
  const settledTimeoutsMs: number[] = []
  let expireOptimizerWait = (): void => {}
  // The router states the Pages page reports, one per read, the last repeating; {@link setPagesState} replaces them.
  let pagesStates: NextPagesPageState[] = options.nextPages?.pageStates ?? [
    {
      pathname: options.nextPages?.entryPath ?? '/',
      routerSeen: true,
      isReady: true,
      route: '/',
    },
  ]
  let pagesStateReads = 0
  /** Answers one read of the Pages router state: the next scripted state, the last one repeating. */
  const nextPagesState = (): NextPagesPageState => {
    const state =
      pagesStates[Math.min(pagesStateReads, pagesStates.length - 1)]!
    pagesStateReads += 1
    return state
  }
  // Every Pages seal the run asked for, with the run's discovery cache and the bytes it had read before and after.
  const pagesSeals: {
    cache: NextPagesDiscoveryCache
    readBytesBefore: number
    readBytesAfter?: number
  }[] = []
  // The entry path of each structured entry check the run asked the stand-in server for.
  const entryChecks: string[] = []
  // The text of each initial input the run sent to the page, in order.
  const insertedTexts: string[] = []
  // The method of every `Input.*` CDP request the run sent to the page, in order (no parameters, so no typed value is kept).
  const inputRequests: string[] = []
  // The calls the run made to the stand-in saved-session store and its lease, in order, and the folders the stand-in browser was told to open.
  const savedSessionCalls: string[] = []
  const savedProfileFolders: string[] = []
  const signInNotices: SignInRequiredReason[] = []
  // The pathname the stand-in page reports; a landing replaces it.
  let pagePathname = options.entryPath ?? '/'
  let closeAttempts = 0
  const serverOrigin = options.serverOrigin ?? 'http://127.0.0.1:4321'
  const savedLease: SavedSessionRunLease = {
    profile: '/stand-in/Application Support/sign-in-profiles/0123abcd',
    setupAt: '2026-11-02T00:00:00.000Z',
    appCookies: options.savedSession?.appCookies ?? 'persistent',
    recordBrowser: async () => {
      savedSessionCalls.push('recordBrowser')
    },
    prepareForLaunch: async () => {
      savedSessionCalls.push('prepare')
    },
    release: async () => {
      savedSessionCalls.push('release')
      releases.push('saved session')
    },
  }
  // The store bound to the repository, as `createRuntime` hands it to a version 3 run.
  const savedSessionPort = options.savedSession
    ? {
        repositoryName: 'shop',
        acquire: async (runId: string, session: string) => {
          savedSessionCalls.push(`acquire:${runId}:${session}`)
          // The order against the server's start is what a test reads.
          releases.push('saved session acquired')
          if (options.savedSession?.refuse) throw options.savedSession.refuse
          const { admission } = options.savedSession!
          return admission === 'saved'
            ? ({ session: 'saved', lease: savedLease } as const)
            : ({ session: 'fresh', signInRequiredReason: admission } as const)
        },
        rememberSignInPaths: async (): Promise<void> => {
          savedSessionCalls.push('remember')
        },
      }
    : undefined
  let screenshotCount = 0
  // Ends a held insert of an initial input when the page's transport closes.
  let rejectHeldInsert = (_error: Error): void => {}
  let rejectHeldScreenshot = (_error: Error): void => {}
  // The answers an App replay of the structured entry check was asked to judge.
  const appEntryConfirmations: NextEntryResponse[] = []
  let emitInputPause = true,
    // Whether the debugger reports `stopped` for the pause of a version 3 input; without it the runtime's pause stays unannounced.
    announceInputPause = true,
    emitPreparationResume = false,
    stopAtStartupBreakpoint = false,
    removedAck = true,
    bound = false,
    rejectBinding = false,
    pageOrigin = 'http://127.0.0.1:4321',
    executedScriptSource: string | undefined,
    ready = true,
    beforeFailure: BeforeFailure = { conditionIndex: 0, reason: 'not-visible' },
    afterFailure: BeforeFailure | undefined,
    afterReadCount = 0,
    // The elements the page shows after the input, each with its text; when set, the after conditions are evaluated on them by the real page expression.
    afterPageElements: { selector: string; textContent: string }[] | undefined,
    inputResolve = (): void => {},
    inputReject = (_error: Error): void => {},
    onClose = (): void => {},
    heldPhase: string | undefined,
    releaseCapture = (): void => {},
    captureEntered = (): void => {}
  let run: ConfiguredBrowserRun
  let currentColumn = 1,
    currentLine = 1,
    stopCount = 0,
    breakpointCount = 0
  // Where the adapter reports the first stop's verified binding when it differs from the requested position.
  let firstStopBinding: { line: number; column: number } | undefined,
    emitNextPause = true
  // Where the adapter reports every later stop's verified binding when it differs from the requested position.
  let laterStopBinding: { line: number; column: number } | undefined
  // A held wait for an accepted stop's own pause does not end after 3 s of real time.
  const sourceBoundWait = createSourceBoundWaitHold()
  // The failure the adapter answers a binding lookup with, as a session that ended does.
  let bindingLookupFailure: string | undefined
  // Whether the adapter leaves the next binding lookup of an owned breakpoint without an answer.
  let isNextBindingLookupUnanswered = false
  // The sentence the wait for the before conditions words its timeout with instead of its own.
  let beforeTimeoutSentence: string | undefined
  // The source lines the adapter verifies a breakpoint on; a request on any other line stays unverified, as a debugger leaves one on a line without a mapped position.
  let verifiableLines: number[] | undefined
  let recordingObserver = (): ViewportRecordingObserver | undefined => undefined
  // The generated places the adapter lists as break locations of the module; without them it cannot answer.
  let possibleBreakLocations: GeneratedPlace[] | undefined
  // Every scan of a sealed map the run asked its verifiers for, in order.
  const mapScans: { startLine: number; endLine: number }[] = []
  // Every range the run asked break locations for, in order, as it sent them.
  const breakLocationRequests: BreakLocationRange[] = []
  // The bound the run gave each of those requests, in the same order; `undefined` for a request left to the default.
  const breakLocationRequestTimeoutsMs: (number | undefined)[] = []
  let rejectedCapture: string | undefined,
    requiredValueUnavailable = false,
    requiredValueObject = false,
    requiredValueUndefined = false
  let hideViewportAtPause = false,
    viewportReady = true
  let secretVisibleSince: number | null = null
  /** The stand-in page's record of a drawn frame from another origin: when it appeared (page clock) and the closed intervals. */
  let crossOriginDrawnSince: number | null = null
  const crossOriginClosed: [number, number][] = []
  /** The run's secret frame gate, kept when {@link consultSecretFrameGate} is set. */
  let consultedGate: SecretFrameGate | undefined
  let controlledContinuation = false,
    continuationEntered = (): void => {},
    acknowledgeContinuation = (): void => {},
    rejectContinuation = (_error: Error): void => {}
  type TestBreakpoint = {
    id: string
    location: {
      uri: { fsPath: string }
      range: { start: { line: number; character: number } }
    }
  }
  const userBreakpoint: TestBreakpoint = {
    id: 'learner-owned',
    location: {
      uri: { fsPath: sourcePath },
      range: { start: { line: 10, character: 0 } },
    },
  }
  const breakpoints: TestBreakpoint[] = [userBreakpoint]
  const root: DebugSession = {
    id: 'owned-root',
    type: 'pwa-chrome',
    name: 'owned',
    workspaceFolder: undefined,
    configuration: { type: 'pwa-chrome', name: 'owned', request: 'launch' },
    customRequest: async () => undefined,
    getDebugProtocolBreakpoint: async () => undefined,
  }
  const selected: DebugSession = {
    ...root,
    id: 'browser-session',
    parentSession: root,
    customRequest: async (command, arguments_) => {
      commands.push(command)
      if (command === 'requestCDPProxy')
        return { host: 'localhost', port: 1234, path: '/owned' }
      if (command === 'stackTrace')
        return {
          stackFrames: [
            {
              id: 1,
              name: 'configured',
              source: { path: sourcePath },
              line: currentLine,
              column: currentColumn,
            },
          ],
        }
      if (command === 'scopes')
        return { scopes: [{ name: 'Local', variablesReference: 501 }] }
      if (command === 'variables')
        return {
          variables: [
            {
              name: 'nextTheme',
              value: requiredValueUndefined
                ? 'undefined'
                : String(options.capturedValue ?? 'dark'),
              type: requiredValueUndefined ? 'undefined' : 'string',
              variablesReference: 0,
            },
            ...Object.entries(options.extraVariables ?? {}).map(
              ([name, value]) => ({
                name,
                value: JSON.stringify(value),
                type: 'string',
                variablesReference: 0,
              }),
            ),
          ],
        }
      if (command === 'continue') {
        run.onRequest(selected, {
          type: 'request',
          seq: ++requestSequence,
          command,
          arguments: arguments_,
        })
        // Controlled cases deliver response, DAP, CDP and input receipts independently.
        if (controlledContinuation) {
          const response = new Promise<void>((resolve, reject) => {
            acknowledgeContinuation = resolve
            rejectContinuation = reject
          })
          continuationEntered()
          await response
          return {}
        }
        run.onEvent(selected, {
          type: 'event',
          seq: ++requestSequence,
          event: 'continued',
          body: { threadId: 1 },
        })
        listeners.get('Debugger.resumed')?.({})
        const next = additionalStops[stopCount - 1]
        // A version 3 stop pauses only inside the input of its own operation.
        const nextBelongsToLatestInput =
          !operationsOption ||
          operationsOption.stopOperations[stopCount] === inputsSeen
        if (next && nextBelongsToLatestInput) {
          // A debugger that verifies only some lines pauses a later stop where its breakpoint was requested.
          const requestedLater = verifiableLines
            ? breakpoints.find((candidate) =>
                candidate.id.startsWith('owned-breakpoint-'),
              )?.location.range.start
            : undefined
          // A line that ran only before its breakpoint existed never pauses again.
          if (emitNextPause)
            emitPause(
              laterStopBinding?.column ??
                (requestedLater ? requestedLater.character + 1 : next.column),
              laterStopBinding?.line ??
                (requestedLater ? requestedLater.line + 1 : undefined),
            )
        } else inputResolve()
        return {}
      }
      throw new Error(`Unexpected DAP command: ${command}`)
    },
    getDebugProtocolBreakpoint: async (breakpoint) => {
      const owned = breakpoints.find(
        (candidate) => candidate.id === breakpoint.id,
      )
      if (owned && bindingLookupFailure) throw new Error(bindingLookupFailure)
      // An adapter that does not answer: the lookup stays pending for as long as its caller waits.
      if (owned && isNextBindingLookupUnanswered) {
        isNextBindingLookupUnanswered = false
        return new Promise<never>(() => {})
      }
      // The first stop and every later one can each be reported at another position than requested; the learner's own breakpoint never is.
      let reported: { line: number; column: number } | undefined
      if (owned?.id === 'owned-breakpoint') reported = firstStopBinding
      else if (owned?.id.startsWith('owned-breakpoint-'))
        reported = laterStopBinding
      if (
        owned &&
        verifiableLines &&
        !verifiableLines.includes(owned.location.range.start.line + 1)
      )
        return undefined
      return bound && !rejectBinding && owned
        ? {
            id: 1,
            verified: true,
            line: reported?.line ?? owned.location.range.start.line + 1,
            column:
              reported?.column ?? owned.location.range.start.character + 1,
          }
        : undefined
    },
  }
  const emitCdpPause = (): void => {
    listeners.get('Debugger.paused')?.(
      debuggerPausedEvent({
        callFrameId: 'selected-frame',
        scriptId: 'actual',
        lineNumber: currentLine - 1,
        columnNumber: currentColumn - 1,
        hitBreakpoints: ['mapped-source'],
      }),
    )
  }
  const emitPause = (column = 1, line = 1, announced = true): void => {
    currentColumn = column
    currentLine = line
    stopCount++
    // A real debugger may reveal an existing source tab over the leased application panel.
    if (hideViewportAtPause) viewportReady = false
    emitCdpPause()
    // A debugger that never announces the pause sends no `stopped` for it; the runtime stays paused all the same.
    if (!announced) return
    run.onEvent(selected, {
      seq: ++requestSequence,
      type: 'event',
      event: 'stopped',
      body: { threadId: 1, reason: 'breakpoint' },
    })
  }
  // Whether the page answers held conditions without a click point, and whether the click step's scroll answers that it scrolled; {@link answerWithoutClickPoint} sets both.
  let clickTargetWithoutPoint = false
  let clickTargetScrolled = false
  let screenshot =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRFEAAAAASUVORK5CYII='
  // The read expression of an operation's own after conditions, by expression, with the failure the page answers while a test keeps them from holding.
  const operationAfterFailures = new Map<string, BeforeFailure>()
  // The version 3 operations the stand-in page received an input for, and the stops it reported.
  let inputsSeen = 0
  const operationsOption = options.operations
  /** Tells whether the result of the action is visible: the single input was sent, or the last operation of a version 3 run was acknowledged. */
  const isResultVisible = (): boolean => {
    const view = run.view()
    return view.operations
      ? view.operations.at(-1)?.ack === 'yes'
      : Boolean(view.operation?.inputDispatched)
  }
  /** Tells whether a declared stop follows the operation the page just received an input for and pauses its handler; after {@link suppressInputPause} the input runs past that stop's line and is answered at once. */
  const stopPausesLatestInput = (): boolean =>
    emitInputPause &&
    (operationsOption?.stopOperations.includes(inputsSeen) ?? false)
  /** Keeps the page's answer to an input open until the last stop of its operation was continued. */
  const holdInputUntilContinued = (): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      inputResolve = resolve
      inputReject = reject
    })
  /** Reports the first stop that follows the operation the page just received an input for. */
  const emitFirstStopOfLatestInput = (): void => {
    const index = operationsOption!.stopOperations.indexOf(inputsSeen)
    emitPause(
      index === 0 ? 1 : additionalStops[index - 1]!.column,
      index === 0 ? 1 : additionalStops[index - 1]!.line,
      announceInputPause,
    )
  }
  /** Answers one call of a function in a control the run resolved. */
  const answerFunctionCall = (parameters: {
    objectId?: string
    functionDeclaration?: string
    arguments?: { value?: Record<string, unknown> }[]
  }): unknown => {
    const declaration = parameters.functionDeclaration ?? ''
    const argument = parameters.arguments?.[0]?.value ?? {}
    const selector = parameters.objectId?.startsWith('control:')
      ? parameters.objectId.slice('control:'.length)
      : String(argument.selector ?? '')
    const control = operationsOption?.controls?.[selector]
    if (declaration.includes('describeOperationControl'))
      return {
        ready: true,
        tagName: control?.tagName ?? 'input',
        type: control?.type ?? (control?.tagName === 'select' ? '' : 'text'),
        name: control?.name ?? '',
        id: control?.id ?? '',
        autocomplete: control?.autocomplete ?? '',
        multiple: control?.multiple ?? false,
        isContentEditable: false,
        isFocused: true,
      }
    if (declaration.includes('checkSelectOption')) {
      const option = control?.options?.find(
        (candidate) => candidate.value === argument.value,
      )
      return {
        state: !option ? 'missing' : option.disabled ? 'disabled' : 'available',
      }
    }
    if (declaration.includes('applyNativeValue')) {
      if (operationsOption?.unappliedNativeValue?.includes(selector))
        return { applied: false, reason: 'option-missing' }
      return {
        applied: true,
        valueMatches: true,
        isValid: true,
        rule: { min: '1' },
      }
    }
    if (
      argument.phase === 'verify' &&
      operationsOption?.failValueCheck?.includes(String(argument.selector))
    )
      return {
        ready: false,
        reason:
          operationsOption?.failValueCheckReason ?? 'input-result-changed',
      }
    // A prepared input's focus phase reports the control its selector resolved to; a selector without a declared control reports none.
    const preparedControl =
      typeof argument.selector === 'string' && argument.phase === 'focus'
        ? options.preparedControls?.[argument.selector]
        : undefined
    return { ready: true, ...(preparedControl && { control: preparedControl }) }
  }
  /** Answers what the page evaluates: its location, and the configured DOM conditions, of which the after conditions hold only once the input was sent. */
  const pageEvaluation = (expression: string | undefined): unknown => {
    if (expression === NEXT_PAGES_STATE_EXPRESSION) return nextPagesState()
    if (expression === 'document.readyState') return 'complete'
    if (expression === 'location.href') return 'about:blank'
    if (expression === 'location.pathname') return pagePathname
    if (expression === 'location.origin') return pageOrigin
    if (expression === scrollExpression)
      return { scrolled: clickTargetScrolled }
    // An operation's own after conditions that a test chose never to hold.
    const operationAfterAnswer = operationAfterFailures.get(expression ?? '')
    if (operationAfterAnswer)
      return { ready: false, failure: operationAfterAnswer }
    if (expression === afterExpression && !isResultVisible())
      return {
        ready: false,
        failure: { conditionIndex: 0, reason: 'not-visible' },
      }
    if (!ready) return { ready: false, failure: beforeFailure }
    return clickTargetWithoutPoint
      ? { ready: true }
      : { ready: true, x: 12, y: 18 }
  }
  /** Gives the required inspection's path its value at the pause: a theme name, or what a test asked for instead. */
  const requiredInspectionValue = (): unknown => {
    if (requiredValueUnavailable)
      return 'x'.repeat(REPOSITORY_LITERAL_LIMIT_CHARS + 1)
    if (requiredValueObject) return { email: 'learner@example.com' }
    return requiredValueUndefined
      ? undefined
      : (options.capturedValue ?? 'dark')
  }
  const proxy = {
    closed: false,
    get onClose() {
      return onClose
    },
    set onClose(listener: () => void) {
      onClose = listener
    },
    on(event: string, listener: (value: unknown) => void): void {
      listeners.set(event, listener)
    },
    async subscribe(): Promise<void> {},
    aggregateScreencastTelemetry(): void {},
    close(): void {
      if (this.closed) return
      this.closed = true
      releases.push('cdp')
      inputReject(new Error('CDP disconnected'))
      rejectHeldInsert(new Error('CDP disconnected'))
      rejectHeldScreenshot(new Error('CDP disconnected'))
      rejectContinuation(new Error('DAP disconnected'))
      onClose()
    },
    async request(
      method: string,
      parameters?: {
        expression?: string
        url?: string
        type?: string
        start?: ScriptPlace
        end?: ScriptPlace
        text?: string
        objectId?: string
        functionDeclaration?: string
        arguments?: { value?: Record<string, unknown> }[]
      },
      timeout?: number,
    ) {
      if (method.startsWith('Input.')) inputRequests.push(method)
      if (method === 'Runtime.evaluate')
        evaluatedExpressions.push(parameters?.expression ?? '')
      // After the input, the after conditions answer the failure a test chose, and every read of them is counted.
      if (
        method === 'Runtime.evaluate' &&
        parameters?.expression === afterExpression &&
        isResultVisible()
      ) {
        afterReadCount++
        if (afterFailure)
          return { result: { value: { ready: false, failure: afterFailure } } }
        if (afterPageElements) {
          const shown = afterPageElements
          return {
            result: {
              value: JSON.parse(
                JSON.stringify(
                  runInNewContext(afterExpression, {
                    document: {
                      querySelectorAll: (selector: string) =>
                        shown.filter(
                          (element) => element.selector === selector,
                        ),
                    },
                  }),
                ),
              ),
            },
          }
        }
      }
      // The initial inputs: one editable control per selector, focused and verified, whose insert answers unless it is held.
      if (
        method === 'Runtime.evaluate' &&
        parameters?.expression?.startsWith('(function selectInput')
      )
        return { result: { subtype: 'node', objectId: 'input-control' } }
      // A version 3 operation's control: its selector travels in the object id, so a later call on it knows which control it is.
      if (
        method === 'Runtime.evaluate' &&
        parameters?.expression?.startsWith('(function selectControl')
      ) {
        if (operationsOption?.selectControlFailsWith)
          throw new Error(operationsOption.selectControlFailsWith)
        const quoted = /\)\(("(?:[^"\\]|\\.)*"),\[/.exec(
          parameters.expression,
        )?.[1]
        return {
          result: {
            subtype: 'node',
            objectId: `control:${quoted ? JSON.parse(quoted) : ''}`,
          },
        }
      }
      if (method === 'Runtime.callFunctionOn') {
        const answer = {
          result: { value: answerFunctionCall(parameters ?? {}) },
        }
        // A number or select value is the operation's input: its stop, if any, pauses inside the page's handlers.
        if (parameters?.functionDeclaration?.includes('applyNativeValue')) {
          inputsSeen++
          if (stopPausesLatestInput()) {
            emitFirstStopOfLatestInput()
            await holdInputUntilContinued()
          }
        }
        return answer
      }
      if (method === 'Runtime.releaseObject') return {}
      if (method === 'Input.insertText') {
        insertedTexts.push(String(parameters?.text))
        if (operationsOption) {
          inputsSeen++
          if (stopPausesLatestInput()) {
            emitFirstStopOfLatestInput()
            await holdInputUntilContinued()
          }
          return {}
        }
        // A held insert is answered only by the transport closing, as a lost reply is.
        if (options.holdInputInsert)
          return new Promise<never>((_resolve, reject) => {
            rejectHeldInsert = reject
          })
        return {}
      }
      // The secret frame gate's in-page observer: installed on a password control, it reports the time a script made the control draw its text.
      if (
        method === 'Runtime.evaluate' &&
        parameters?.expression?.includes(SECRET_FRAME_OBSERVER_GLOBAL)
      ) {
        const expression = parameters.expression
        if (expression.startsWith('window['))
          return {
            result: {
              value: {
                now: Date.now(),
                open: secretVisibleSince,
                unsafe: [],
                crossOriginOpen: crossOriginDrawnSince,
                crossOrigin: [...crossOriginClosed],
                ...(secretVisibleSince !== null && {
                  reason: 'control-not-password',
                }),
              },
            },
          }
        const quoted = /\)\(("(?:[^"\\]|\\.)*"),/.exec(expression)?.[1]
        const observedSelector = quoted ? JSON.parse(quoted) : ''
        // A version 1 or 2 prepared control is described by `preparedControls`; an operation's by its own controls.
        const control =
          operationsOption?.controls?.[observedSelector] ??
          options.preparedControls?.[observedSelector]
        // A prepared input whose control the test never described is no secret control the stand-in observer could dispute: it reads as a safe password control.
        const undescribedPreparedInput =
          control === undefined &&
          options.initialInputs?.some(
            (input) => input.selector === observedSelector,
          ) === true
        return {
          result: {
            value:
              undescribedPreparedInput ||
              ((control && 'observedType' in control
                ? control.observedType
                : undefined) ?? control?.type) === 'password'
                ? { ok: true, origin: 1 }
                : { ok: false, reason: 'control-not-password' },
          },
        }
      }
      if (method === 'Runtime.evaluate')
        return { result: { value: pageEvaluation(parameters?.expression) } }
      if (method === 'Page.navigate') {
        navigations.push(String(parameters?.url))
        // A saved-session run's page reports the document it commits: the path asked for, or the one a test chose it lands on.
        if (options.savedSession) {
          // The landing may carry a query, as a redirect to sign-in carries its callback; the page's pathname has none.
          const landing =
            options.navigationLandsOn ??
            new URL(String(parameters?.url)).pathname
          pagePathname = landing.split('?')[0]!
          listeners.get('Page.frameNavigated')?.({
            frame: {
              id: 'main',
              url: `http://localhost:4321${landing}`,
            },
          })
        }
        if (options.adapter)
          listeners.get('Page.frameNavigated')?.({
            frame: { id: 'main', url: String(parameters?.url) },
          })
        // A dependency-optimizer reload that lands while the entry page is still loading, with new bytes served.
        if (options.adapter && options.reloadDuringEntryLoad) {
          servedJavascript = `${javascript}\n// ?v=late-reload`
          listeners.get('Page.frameNavigated')?.({
            frame: { id: 'main', url: String(parameters?.url) },
          })
        }
        bound = !rejectBinding
        // VS Code can surface a bound source stop during hydration when Codebook arms its breakpoint too early.
        if (
          stopAtStartupBreakpoint &&
          breakpoints.some((breakpoint) => breakpoint.id === 'owned-breakpoint')
        ) {
          run.onEvent(selected, {
            seq: ++requestSequence,
            type: 'event',
            event: 'stopped',
            body: { threadId: 1, reason: 'breakpoint' },
          })
        }
        // js-debug can resume internal source-map stops without exposing a DAP stop.
        if (emitPreparationResume) emitCdpPause()
        listeners.get('Debugger.scriptParsed')?.({
          scriptId: 'actual',
          url: bundle.scriptUrl,
          executionContextId: 1,
        })
        if (emitPreparationResume) {
          listeners.get('Debugger.resumed')?.({})
          emitCdpPause()
          listeners.get('Debugger.resumed')?.({})
        }
        return {}
      }
      if (method === 'Debugger.getScriptSource')
        return { scriptSource: executedScriptSource ?? servedJavascript }
      if (method === 'Debugger.evaluateOnCallFrame') {
        try {
          return {
            result: {
              value: runInNewContext(parameters?.expression ?? '', {
                nextTheme: requiredInspectionValue(),
                setTheme() {},
                enabled: false,
                selection: null,
              }),
            },
          }
        } catch {
          return {
            result: { type: 'undefined' },
            exceptionDetails: {
              exceptionId: 1,
              text: 'Unavailable test local',
              lineNumber: 0,
              columnNumber: currentColumn - 1,
            },
          }
        }
      }
      if (method === 'Page.captureScreenshot') {
        screenshotCount += 1
        // A held capture is answered only by the transport closing, as a lost reply is.
        if (options.holdScreenshot)
          return new Promise<never>((_resolve, reject) => {
            rejectHeldScreenshot = reject
          })
        return { data: screenshot }
      }
      if (method === 'Input.dispatchMouseEvent') {
        mouse.push({ type: parameters?.type, timeout })
        if (parameters?.type === 'mousePressed') return {}
        // A version 3 click: answered at once unless a stop follows it and pauses inside the click's handler.
        if (operationsOption) {
          inputsSeen++
          if (!stopPausesLatestInput()) return {}
          emitFirstStopOfLatestInput()
          return holdInputUntilContinued().then(() => ({}))
        }
        const pending = new Promise<void>((resolve, reject) => {
          inputResolve = resolve
          inputReject = reject
        })
        // A debugger that verifies only some lines pauses where the first stop's breakpoint was requested.
        const requested = verifiableLines
          ? breakpoints.find((candidate) => candidate.id === 'owned-breakpoint')
              ?.location.range.start
          : undefined
        // A first stop that was requested a second time has a later owned breakpoint; it pauses where that one is bound.
        const requestedAgain = stopCount
          ? undefined
          : breakpoints.find((candidate) =>
              candidate.id.startsWith('owned-breakpoint-'),
            )?.location.range.start
        if (emitInputPause && requestedAgain)
          emitPause(
            laterStopBinding?.column ?? requestedAgain.character + 1,
            laterStopBinding?.line ?? requestedAgain.line + 1,
          )
        else if (emitInputPause)
          emitPause(
            firstStopBinding?.column ??
              (requested ? requested.character + 1 : undefined),
            firstStopBinding?.line ??
              (requested ? requested.line + 1 : undefined) ??
              fixture?.declaredLine,
          )
        return pending
      }
      if (method === 'Page.addScriptToEvaluateOnNewDocument') return {}
      if (
        method === 'Debugger.getPossibleBreakpoints' &&
        possibleBreakLocations &&
        parameters?.start
      ) {
        const { range, answer } = answerBreakLocationRequest(
          possibleBreakLocations,
          'actual',
          { start: parameters.start, end: parameters.end },
        )
        breakLocationRequests.push(range)
        breakLocationRequestTimeoutsMs.push(timeout)
        return answer
      }
      throw new Error(`Unexpected CDP request: ${method}`)
    },
    /** The quiet path answers as the journaled one does; only the real Cdp differs in what it journals. */
    requestQuietly(
      method: string,
      parameters?: Record<string, unknown>,
      timeout?: number,
    ) {
      return (
        this as unknown as {
          request(m: string, p?: unknown, t?: number): Promise<unknown>
        }
      ).request(method, parameters, timeout)
    },
  }
  const documents = [
    {
      uri: { scheme: 'file', fsPath: sourcePath },
      isDirty: false,
      text: source,
      getText() {
        return this.text
      },
    },
  ]
  const vscode = {
    workspace: { textDocuments: documents },
    debug: {
      breakpoints,
      addBreakpoints(added: TestBreakpoint[]): void {
        breakpoints.push(...added)
      },
      removeBreakpoints(removed: TestBreakpoint[]): void {
        for (const breakpoint of removed) {
          const index = breakpoints.findIndex(
            (candidate) => candidate.id === breakpoint.id,
          )
          if (index >= 0) breakpoints.splice(index, 1)
        }
        releases.push('owned breakpoint')
        const sequence = ++requestSequence
        run.onRequest(selected, {
          seq: sequence,
          type: 'request',
          command: 'setBreakpoints',
          arguments: {
            source: { path: sourcePath },
            breakpoints: breakpoints.map((breakpoint) =>
              sourceBreakpointRequest(breakpoint.location.range.start),
            ),
          },
        })
        if (removedAck)
          queueMicrotask(() =>
            run.onResponse(selected, {
              seq: ++requestSequence,
              type: 'response',
              command: 'setBreakpoints',
              request_seq: sequence,
              success: true,
              body: {
                breakpoints: breakpoints.map((breakpoint) => ({
                  line: breakpoint.location.range.start.line + 1,
                  column: breakpoint.location.range.start.character + 1,
                })),
              },
            }),
          )
      },
      stopDebugging: async (): Promise<void> => {
        releases.push('debugger')
        run.terminated(root)
        run.terminated(selected)
      },
    },
    Uri: { file: (path: string) => ({ scheme: 'file', fsPath: path }) },
    Position: class {
      constructor(
        readonly line: number,
        readonly character: number,
      ) {}
    },
    Location: class {
      readonly range
      constructor(
        readonly uri: unknown,
        position: unknown,
      ) {
        this.range = { start: position }
      }
    },
    SourceBreakpoint: class {
      readonly id =
        ++breakpointCount === 1
          ? 'owned-breakpoint'
          : `owned-breakpoint-${breakpointCount}`
      constructor(readonly location: unknown) {}
    },
  }
  // The entry path the run passed to each readiness check of the stand-in server, in order.
  const readyEntryPaths: (string | undefined)[] = []
  const fakeApplication = {
    ready: async (_signal: AbortSignal, entryPath?: string) => {
      readyEntryPaths.push(entryPath)
      if (options.launchFailure) throw new Error(options.launchFailure)
      releases.push('application acquired')
      return serverOrigin
    },
    // The structured entry check of a Pages-capable run: the scripted answer, described by the real code, never fetched.
    readyEntry: async (
      signal: AbortSignal,
      entryPath: string,
      signInPaths?: readonly string[],
    ) => {
      entryChecks.push(entryPath)
      // A first compile that has not finished answers only when the run is cancelled.
      if (options.entryHangs)
        await new Promise<never>((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(signal.reason)),
        )
      if (options.launchFailure) throw new Error(options.launchFailure)
      releases.push('application acquired')
      const origin = serverOrigin,
        answer = options.entryAnswer ??
          options.nextPages?.entry ?? { status: 200 }
      return {
        origin,
        entry: describeNextEntryResponse(
          answer.status,
          answer.location ?? null,
          `${origin}${entryPath}`,
          origin,
          signInPaths,
        ),
      }
    },
    confirmAppEntry: async (
      signal: AbortSignal,
      _entryPath: string,
      entry: NextEntryResponse,
    ): Promise<void> => {
      appEntryConfirmations.push(entry)
      // A root request that does not answer settles only when the run is cancelled.
      if (options.appEntryConfirmationHangs)
        await new Promise<never>((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(signal.reason)),
        )
    },
    outputTail: () => options.nextPages?.outputTail ?? '',
    close: async (): Promise<void> => {
      releases.push('application')
    },
  }
  const breakpointModule = await loadModule<
    typeof OwnedRepositoryBreakpointModule
  >(resolve(__dirname, '../../ownedRepositoryBreakpoint.js'), { vscode })
  const runtimeModule = await loadModule<typeof ConfiguredBrowserRunModule>(
    resolve(__dirname, '../../configuredBrowserRun.js'),
    {
      vscode,
      ...(options.runtimeConstants
        ? await loadConstantsWith(options.runtimeConstants)
        : {}),
      './ownedRepositoryBreakpoint': breakpointModule,
      './runtimeSupport/hostBrowser': {
        HostBrowser: class {
          profileLeft?: ProfileLeft
          private lease?: SavedSessionRunLease
          useSavedProfile(lease: SavedSessionRunLease): void {
            this.lease = lease
            savedProfileFolders.push(lease.profile)
          }
          async recordSavedBrowser(): Promise<void> {
            await this.lease?.recordBrowser({ executable: 'chrome', pid: 4242 })
          }
          async launch(
            configuration: DebugSession['configuration'],
          ): Promise<void> {
            // The real browser asks the lease to clear stale Chrome locks right before it launches.
            await this.lease?.prepareForLaunch()
            launchConfigurations.push(configuration)
            root.configuration.name = configuration.name
            run.addSession(root)
            run.addSession(selected)
          }
          async attachViewport(): Promise<void> {}
          setSecretFrameGate(gate: SecretFrameGate): void {
            if (options.consultSecretFrameGate) consultedGate = gate
          }
          async reveal(): Promise<void> {
            viewportReady = true
          }
          resumeViewport(): void {}
          async endRecordingHistory(): Promise<void> {
            if (options.holdRecordingHistoryEnd) await historyEndReleased
          }
          async recordCapture(
            data: string,
            phase: string,
            requestedAtMs: number,
          ): Promise<SecretFrameVerdict> {
            const observer = recordingObserver()
            const verdict = consultedGate
              ? await consultedGate.admitCapture(requestedAtMs, Date.now())
              : 'pass'
            if (verdict === 'pass')
              observer?.frame({
                data,
                phase,
                kind: 'phase',
                elapsedMs: observer.elapsedMs(),
              })
            else
              observer?.gap?.({
                elapsedMs: observer.elapsedMs(),
                reason: describeWithheldImage(
                  WITHHOLD_REASON_OF_VERDICT[verdict],
                ),
              })
            return verdict
          }
          async presentCapture(data: string, phase: string) {
            if (!viewportReady) throw new Error('Webview is not ready')
            if (phase === heldPhase) {
              captureEntered()
              await new Promise<void>((resolve) => {
                releaseCapture = resolve
              })
            }
            if (phase === rejectedCapture) return undefined
            return {
              epoch: 'test',
              id: 1,
              hash: sha256(Buffer.from(data, 'base64')),
            }
          }
          async drainAcquisitions(): Promise<void> {
            releases.push('acquisitions')
          }
          async close(): Promise<void> {
            // A close that cannot confirm Chrome's exit throws once, as the real one does for a failed process listing.
            if (options.closeFailsOnce && closeAttempts++ === 0)
              throw new Error(
                'The saved-session Chrome exit could not be confirmed',
              )
            releases.push('browser')
            this.profileLeft = options.browserProfileLeft
          }
        },
      },
      './runtimeSupport/cdp': { Cdp: { connect: async () => proxy } },
      './utils/createBundleVerifier': {
        // The real verifier, with every scan of its sealed map recorded.
        createBundleVerifier: (sealed: BundleSource) => {
          const verifier = createBundleVerifier(sealed)
          return {
            ...verifier,
            mappedPositions: (startLine: number, endLine: number) => {
              mapScans.push({ startLine, endLine })
              return verifier.mappedPositions(startLine, endLine)
            },
          }
        },
      },
      './utils/readDevelopmentBundle': {
        readDevelopmentBundle: async (
          _workspace: string,
          _source: unknown,
          signal: AbortSignal,
        ) => {
          // A hung `.next/dev` read ends only when the run is cancelled.
          if (options.sealHangs)
            await new Promise<never>((_resolve, reject) =>
              signal.addEventListener('abort', () => reject(signal.reason)),
            )
          return { bundle, discovery: {} }
        },
      },
      // The real Pages seal over the written build, with every request and its cache's bytes recorded.
      './utils/readPagesDevelopmentBundle': {
        readPagesDevelopmentBundle: async (
          request: Parameters<typeof readPagesDevelopmentBundle>[0],
        ) => {
          const seal: (typeof pagesSeals)[number] = {
            cache: request.cache,
            readBytesBefore: request.cache.readBytes,
          }
          pagesSeals.push(seal)
          const result = await readPagesDevelopmentBundle(request)
          seal.readBytesAfter = request.cache.readBytes
          return result
        },
      },
      // A scripted manifest answer or failure replaces the reader's poll; without one the real reader reads the written manifests.
      ...(options.nextPages?.manifests || options.nextPages?.manifestFailure
        ? {
            './utils/readNextRouteManifests': {
              readNextRouteManifests: async () => {
                const failure = options.nextPages?.manifestFailure
                if (failure) throw new Error(failure)
                return options.nextPages?.manifests
              },
            },
          }
        : {}),
      './utils/assertDevelopmentWorkspace': {
        assertDevelopmentWorkspace: async () => undefined,
      },
      './utils/readDeclaredDevelopmentPort': {
        readDeclaredDevelopmentPort: async () => ({
          port: 4321,
          source: 'the dev script in package.json',
        }),
      },
      './utils/assertDevelopmentPortFree': {
        assertDevelopmentPortFree: async () => undefined,
      },
      './utils/startIpv6LoopbackForwarder': {
        startIpv6LoopbackForwarder: async (port: number) => {
          if (options.ipv6Loopback === 'absent') return undefined
          if (options.ipv6Loopback === 'held')
            throw new StudyError(
              'PREREQUISITE_MISSING',
              `Port ${port} is in use on this machine at [::1]`,
            )
          releases.push('ipv6 forwarder started')
          return {
            close: async (): Promise<void> => {
              releases.push('ipv6 forwarder')
            },
          }
        },
      },
      './utils/launchDevelopmentServer': {
        launchDevelopmentServer: () => fakeApplication,
      },
      './viteDevAdapter': {
        VITE_DEV_ADAPTER: {
          ...viteDevAdapter.VITE_DEV_ADAPTER,
          assertWorkspace: async () => undefined,
          start: async (request: {
            onApp(app: typeof fakeApplication): void
            onStep(step: string): void
          }) => {
            request.onStep('starting Vite')
            setupSteps.push('starting Vite')
            request.onApp(fakeApplication)
            return {
              app: fakeApplication,
              port: 4321,
              viteVersion: '8.3.5',
              ...(options.maskedValues
                ? {
                    maskText: (text: string) =>
                      maskKnownValues(text, options.maskedValues ?? []),
                    maskModuleText: (text: string) =>
                      maskEnvValues(text, options.maskedValues ?? []),
                  }
                : {}),
            }
          },
          waitForServerSettled: async (_app: unknown, timeoutMs: number) => {
            settledQuestions += 1
            settledTimeoutsMs.push(timeoutMs)
            await Promise.race([
              optimizerHold,
              // The launcher's wait ends with the uncoded wait timeout when its bound passes.
              new Promise<never>((_resolve, reject) => {
                expireOptimizerWait = (): void =>
                  reject(
                    new WaitTimeoutError(
                      'Timed out waiting for a message of the owned launcher',
                    ),
                  )
              }),
            ])
          },
          readBundle: async (request: { signal: AbortSignal }) => {
            sealReads += 1
            if (options.sealFailure) throw new Error(options.sealFailure)
            if (laterSealRefusal !== undefined)
              throw new StudyError(
                'VITE_SEAL_FAILED',
                laterSealRefusal,
                laterSealRefusal,
              )
            // A hung server read ends only when the run is cancelled.
            if (options.sealHangs)
              await new Promise<never>((_resolve, reject) =>
                request.signal.addEventListener('abort', () =>
                  reject(request.signal.reason),
                ),
              )
            return {
              bundle: { ...bundle, javascript: servedJavascript },
              discovery: {},
            }
          },
        },
      },
      './runtimeSupport/utils/waitUntil': {
        waitUntil: async <Value>(
          read: () => Value | Promise<Value>,
          description: string,
          timeoutMs?: number,
          signal?: AbortSignal,
        ) => {
          // A deliberately disabled readiness condition is stable; inspect it once, then use the real timeout contract.
          if (
            !ready &&
            description.startsWith('configured before conditions')
          ) {
            signal?.throwIfAborted()
            const value = await read()
            signal?.throwIfAborted()
            if (value) return value
            // A wait is free to word its timeout; the run must know it by its type.
            if (beforeTimeoutSentence)
              throw new WaitTimeoutError(beforeTimeoutSentence)
            return waitUntil(read, description, 0, signal)
          }
          if (
            rejectBinding &&
            description.startsWith('a verified binding of declared stop')
          ) {
            // The wait ends at once here, so the budget the run asked for is kept for the test to read.
            bindingWaitBudgetsMs.push(timeoutMs)
            signal?.throwIfAborted()
            await read()
            signal?.throwIfAborted()
            return waitUntil(read, description, 0, signal)
          }
          if (sourceBoundWait.holds(description))
            return sourceBoundWait.wait(read, description, signal)
          return waitUntil(read, description, timeoutMs, signal)
        },
      },
    },
    { setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout },
  )
  run = owned = new runtimeModule.ConfiguredBrowserRun({
    directory: join(repository.directory, '.runtime'),
    workspace: repository.directory,
    node: process.execPath,
    host: {
      id: 'vscode',
      productVersion: 'test',
      apiVersion: 'test',
      commit: 'test',
    },
    definition,
    control,
    assertWorkspace() {},
    savedSession: savedSessionPort,
    onSignInRequired: ({ reason }) => signInNotices.push(reason),
    revealSource: async () => {
      releases.push('captured source')
    },
  })
  return {
    ...repository,
    run,
    definition: { ...definition, configuration },
    documents,
    breakpoints,
    userBreakpoint,
    mouse,
    commands,
    /** Every expression the run evaluated in the owned page, in order. */
    evaluatedExpressions,
    releases,
    emitPause,
    emitCdpPause,
    /** How many operation inputs the stand-in page received (version 3 runs). */
    inputsSeen: (): number => inputsSeen,
    /** How many owned stop breakpoints the run has requested so far (a retired one still counts), so a test sees whether a stop was armed yet. */
    ownedBreakpointsRequested: (): number => breakpointCount,
    /** Sets the source position the debugger reports as the paused top frame, for a pause a test sends in parts. */
    setPausedFrame(column: number, line = 1): void {
      currentColumn = column
      currentLine = line
    },
    /** Sends the debugger's `stopped` alone, for a pause the runtime reported earlier. */
    emitStopped(): void {
      run.onEvent(selected, {
        seq: ++requestSequence,
        type: 'event',
        event: 'stopped',
        body: { threadId: 1, reason: 'breakpoint' },
      })
    },
    /** Announces a script of the owned page, as the debugger does for every module it parses. */
    announceScript(scriptId: string, url: string): void {
      listeners.get('Debugger.scriptParsed')?.({
        scriptId,
        url,
        executionContextId: 1,
      })
    },
    /** Reports a pause at a chosen generated place with no DAP stop, as a pause the adapter makes for itself arrives. */
    emitCdpPauseAt(place: {
      scriptId: string
      lineNumber: number
      columnNumber: number
      functionName: string
      hitBreakpoints: string[]
    }): void {
      listeners.get('Debugger.paused')?.(
        debuggerPausedEvent({ callFrameId: 'adapter-frame', ...place }),
      )
    },
    /** Makes the stand-in page draw the secret control's text from now on, as a show-password toggle does; `false` restores the dots. */
    /**
     * Shows or hides a frame from another origin on the stand-in page, as the observer would report it.
     * @returns The page time (ms since the epoch) it recorded.
     */
    setCrossOriginFrameDrawn(drawn: boolean): number {
      const now = Date.now()
      if (drawn) crossOriginDrawnSince ??= now
      else if (crossOriginDrawnSince !== null) {
        crossOriginClosed.push([crossOriginDrawnSince, now])
        crossOriginDrawnSince = null
      }
      return now
    },
    setSecretVisible(visible: boolean): void {
      secretVisibleSince = visible ? Date.now() : null
    },
    setScreenshot(base64: string): void {
      screenshot = base64
    },
    /** Lets a held end of the recording history finish. @example harness.releaseRecordingHistoryEnd() */
    releaseRecordingHistoryEnd: (): void => releaseHistoryEnd(),
    /** Makes the page report this `location.origin`, as after a redirect to another loopback name. @example harness.setPageOrigin('http://localhost:4321') */
    setPageOrigin(origin: string): void {
      pageOrigin = origin
    },
    /** Every URL the run navigated the page to, in order. */
    navigations,
    /** The entry path the run passed to each readiness check of the stand-in server (`app.ready`), in order. */
    readyEntryPaths,
    /** The entry path of each structured entry check (`app.readyEntry`) of a Pages-capable run, in order. */
    entryChecks,
    /** The text of each initial input the run sent to the page (`Input.insertText`), in order. */
    insertedTexts,
    /** The method of every `Input.*` request the run sent to the page (`Input.insertText`, `Input.dispatchMouseEvent`, …), in order; the saved-session lanes assert that a refusal or a facts read sends none. */
    inputRequests,
    /** The calls the run made to the stand-in saved-session store and its lease, in order: `acquire:<runId>`, `remember`, `prepare`, `recordBrowser`, `release`. */
    savedSessionCalls,
    /** The folders the stand-in browser was told to open as the saved session. */
    savedProfileFolders,
    /** The reasons of the notices the run asked the editor to show. */
    signInNotices,
    /** The stand-in lease's folder, which no journal record or error may name. */
    savedProfileFolder: savedLease.profile,
    /** Reports that the page reached this path, as a redirect does: a full document load, or a client-side navigation inside the document. @example harness.landOn('/login', 'document') */
    landOn(path: string, kind: 'document' | 'within-document'): void {
      // The page's pathname has no query; the event's URL keeps it, as a redirect to sign-in carries a callback.
      pagePathname = path.split('?')[0]!
      const url = `http://localhost:4321${path}`
      if (kind === 'document')
        listeners.get('Page.frameNavigated')?.({ frame: { id: 'main', url } })
      else
        listeners.get('Page.navigatedWithinDocument')?.({
          frameId: 'main',
          url,
        })
    },
    /** How many screenshots the run asked the stand-in page for. */
    screenshotRequests: () => screenshotCount,
    /** The answers the run asked the stand-in server to judge the App way (`app.confirmAppEntry`), in order. */
    appEntryConfirmations,
    /** Every Pages seal the run asked for, with its discovery cache and the bytes read before and after. */
    pagesSeals,
    /** The `.next/dev/build-manifest.json` text written for a Pages run. */
    pagesBuildManifest: pagesBuild?.buildManifest,
    /** How many times the run read the Pages router state. */
    pagesStateReads: (): number => pagesStateReads,
    /** Makes every later read of the Pages router state answer this state, as a client redirect or a late router does. @example harness.setPagesState({ pathname: '/login', routerSeen: true, isReady: true, route: '/login' }) */
    setPagesState(state: NextPagesPageState): void {
      pagesStates = [state]
    },
    /** The configuration of each browser the run launched, in order. */
    launchConfigurations,
    /** Reports another main-frame page load, as a Vite dependency-optimizer reload or a click's navigation does. @example harness.reloadPage() */
    reloadPage(): void {
      listeners.get('Page.frameNavigated')?.({
        frame: { id: 'main', url: 'http://localhost:4321/' },
      })
    },
    /** Reports a page load inside a frame other than the main one. */
    loadSubframe(): void {
      listeners.get('Page.frameNavigated')?.({
        frame: {
          id: 'child',
          parentId: 'main',
          url: 'http://localhost:4321/x',
        },
      })
    },
    /** Makes the Vite stand-in serve this text for the stop module from now on, and the page execute it, as a dependency-optimizer reload does with new import hashes. @example harness.serveChangedModule('const nextTheme = "dark";\n// ?v=2') */
    serveChangedModule(changedJavascript: string): void {
      servedJavascript = changedJavascript
    },
    /** Makes every later seal read of the Vite stand-in refuse with `VITE_SEAL_FAILED` and this sentence, as a module read during a reload can. @example harness.refuseLaterSeals('Declared stop src/theme.ts:1 cannot be sealed: no source map.') */
    refuseLaterSeals(sentence: string): void {
      laterSealRefusal = sentence
    },
    /** Keeps the Vite stand-in's dependency optimizer busy until the returned function is called. @example const release = harness.holdOptimizer() */
    holdOptimizer(): () => void {
      let release = (): void => {}
      optimizerHold = new Promise<void>((resolve) => {
        release = resolve
      })
      return release
    },
    /** The bounds (milliseconds) the run gave each wait for the optimizer to be idle. */
    settledTimeoutsMs(): readonly number[] {
      return settledTimeoutsMs
    },
    /** Ends the pending optimizer wait as the launcher's own wait does when its bound passes: with the uncoded wait timeout. @example harness.expireOptimizerWait() */
    expireOptimizerWait(): void {
      expireOptimizerWait()
    },
    /** How many times the run read a stop module from the Vite stand-in. */
    sealReadCount(): number {
      return sealReads
    },
    /** How many times the run asked whether the server was settled (the dependency optimizer idle). */
    settledQuestionCount(): number {
      return settledQuestions
    },
    /** Re-announces the sealed module the way the new page generation parses it. @example harness.announceSealedModule('second') */
    announceSealedModule(scriptId: string): void {
      listeners.get('Debugger.scriptParsed')?.({
        scriptId,
        url: bundle.scriptUrl,
        executionContextId: 1,
      })
    },
    rejectBreakpointBinding(): void {
      rejectBinding = true
    },
    /** The budget the run gave each binding wait that {@link rejectBreakpointBinding} ended at once, in milliseconds. */
    bindingWaitBudgetsMs,
    /** Makes the page report other executed bytes for the selected module than the sealed bundle holds, as a rebuild between sealing and arming does. */
    replaceExecutedModule(scriptSource: string): void {
      executedScriptSource = scriptSource
    },
    /** Makes the adapter verify a breakpoint only when it is requested on one of these source lines, and pause every stop where its breakpoint was requested: a request on a line without a mapped position is never verified, as natively. @example harness.verifyBreakpointsOnlyOnLines([2]) */
    verifyBreakpointsOnlyOnLines(lines: number[]): void {
      verifiableLines = lines
    },
    /** Reports the first stop's verified binding, and its pause, at this position instead of the requested one. */
    bindFirstStopAt(line: number, column: number): void {
      firstStopBinding = { line, column }
    },
    /** Makes the adapter answer `Debugger.getPossibleBreakpoints` with a location at column 0 of each of these zero-based generated lines, within the range the run asks for. */
    listPossibleBreakLines(lines: number[]): void {
      possibleBreakLocations = lines.map((lineNumber) => ({
        lineNumber,
        columnNumber: 0,
      }))
    },
    /** Makes the adapter answer `Debugger.getPossibleBreakpoints` with these zero-based generated places, within the range the run asks for. @example harness.listPossibleBreakLocations([{ lineNumber: 0, columnNumber: 6 }]) */
    listPossibleBreakLocations(locations: GeneratedPlace[]): void {
      possibleBreakLocations = locations
    },
    /** Every `Debugger.getPossibleBreakpoints` range the run asked for, in order, as the run sent it. */
    breakLocationRequests,
    /** The bound in milliseconds the run gave each of those requests, in the same order; `undefined` where the run left the request to its default bound. */
    breakLocationRequestTimeoutsMs,
    /** Every scan of a sealed map the run made, by its line range, in order: preparation scans once per stop, and a binding failure scans the citation for its hints. */
    mapScans,
    /** Reports every later stop's verified binding, and its pause, at this position instead of the requested one. */
    bindLaterStopsAt(line: number, column: number): void {
      laterStopBinding = { line, column }
    },
    /** Keeps the run's wait for an accepted stop's own pause open instead of ending it after 3 s, so a test can tell a pause admitted at once from one adopted when that wait ends. @example harness.holdSourceBoundWait() */
    holdSourceBoundWait: sourceBoundWait.hold,
    /** Lets a continuation run on without the next declared stop ever pausing. */
    suppressNextPause(): void {
      emitNextPause = false
    },
    /** Makes the adapter answer every binding lookup of an owned breakpoint with this failure instead of a binding. */
    failBindingLookup(message: string): void {
      bindingLookupFailure = message
    },
    /** Makes the adapter leave the next binding lookup of an owned breakpoint without an answer, as an adapter that is busy does; every later lookup is answered again. @example harness.leaveNextBindingLookupUnanswered() */
    leaveNextBindingLookupUnanswered(): void {
      isNextBindingLookupUnanswered = true
    },
    observeRecording(
      observer: () => ViewportRecordingObserver | undefined,
    ): void {
      recordingObserver = observer
    },
    rejectCapture(phase: string): void {
      rejectedCapture = phase
    },
    requireUnavailableValue(): void {
      requiredValueUnavailable = true
    },
    useUndefinedValue(): void {
      requiredValueUndefined = true
    },
    /** Makes the required inspection's path an application object, whose members the capture does not bound. */
    useObjectValue(): void {
      requiredValueObject = true
    },
    /** Lets the input run past its declared stop's line without a pause, as a handler that skips that line does: a version 1 or 2 click stays unanswered, a version 3 input is answered at once. @example harness.suppressInputPause() */
    suppressInputPause(): void {
      emitInputPause = false
    },
    /** Makes the pause of a version 3 input at its declared stop reach the run from the runtime alone, with no debugger `stopped`, as a debugger that never announces that stop does; the input stays unanswered. @example harness.withholdInputStopAnnouncement() */
    withholdInputStopAnnouncement(): void {
      announceInputPause = false
    },
    resumeDuringPreparation(): void {
      emitPreparationResume = true
    },
    stopOnStartupWhenOwnedBreakpointPresent(): void {
      stopAtStartupBreakpoint = true
    },
    hideViewportOnPause(): void {
      hideViewportAtPause = true
    },
    /** Reports a debugger `stopped` event of the browser session with no runtime pause, as a breakpoint of the learner's own does. @example harness.emitDapStopOnly() */
    emitDapStopOnly(threadId = 1): void {
      run.onEvent(selected, {
        seq: ++requestSequence,
        type: 'event',
        event: 'stopped',
        body: { threadId, reason: 'breakpoint' },
      })
    },
    manualResume(): void {
      listeners.get('Debugger.resumed')?.({})
    },
    holdContinuation() {
      controlledContinuation = true
      const started = new Promise<void>((resolve) => {
        continuationEntered = resolve
      })
      return {
        started,
        response: (): void => acknowledgeContinuation(),
        input: (): void => inputResolve(),
        dap: (threadId = 1): void =>
          run.onEvent(selected, {
            type: 'event',
            seq: ++requestSequence,
            event: 'continued',
            body: { threadId },
          }),
        cdp: () => listeners.get('Debugger.resumed')?.({}),
      }
    },
    setReady(value: boolean): void {
      ready = value
    },
    /** Makes every later DOM read answer that the conditions hold without a click point, as the owned page does for a click target outside the viewport, and the click step's scroll answer `{ scrolled }`: by default it scrolled and the target stayed outside; `{ scrolled: false }` stands for a target the scroll found inside the viewport and that left it before the read. @example harness.answerWithoutClickPoint({ scrolled: false }) */
    answerWithoutClickPoint({
      scrolled = true,
    }: { scrolled?: boolean } = {}): void {
      clickTargetWithoutPoint = true
      clickTargetScrolled = scrolled
    },
    /** Makes every later DOM read answer this failure, as the owned page would for a before condition that never holds. */
    failBeforeWith(failure: BeforeFailure): void {
      ready = false
      beforeFailure = failure
    },
    /** Makes the wait for before conditions that do not hold end with a timeout of the wait's error type worded as this sentence, instead of the wait's own wording. @example harness.wordBeforeTimeoutAs('The page was not ready in time') */
    wordBeforeTimeoutAs(sentence: string): void {
      beforeTimeoutSentence = sentence
    },
    /** Makes the page show these elements after the input, so the run's own after-condition expression reads them: each element answers the selector it is listed under, with its text. @example harness.showAfterPage([{ selector: 'label', textContent: 'Dark' }]) */
    showAfterPage(elements: { selector: string; textContent: string }[]): void {
      afterPageElements = elements
    },
    /** Makes the after conditions answer this failure on every read after the input, as an owned page whose result never appears does. */
    failAfterWith(failure: BeforeFailure): void {
      afterFailure = failure
    },
    /** Makes the own `after` conditions of a version 3 operation answer this failure on every read, as an owned page whose result never appears does. @example harness.failOperationAfterWith(1, { conditionIndex: 1, reason: 'not-visible' }) */
    failOperationAfterWith(
      operationIndex: number,
      failure: BeforeFailure,
    ): void {
      const conditions = operationsOption?.operations[operationIndex - 1]?.after
      if (!conditions) throw new Error('The operation declares no after')
      operationAfterFailures.set(configuredDomExpression(conditions), failure)
    },
    /** How many times the run read the after conditions after the input. */
    afterReads(): number {
      return afterReadCount
    },
    suppressRetirementAck(): void {
      removedAck = false
    },
    holdCapture(phase: string) {
      heldPhase = phase
      const started = new Promise<void>((resolve) => {
        captureEntered = resolve
      })
      return {
        started,
        release: (): void => {
          heldPhase = undefined
          releaseCapture()
        },
      }
    },
    /** Moves the run's manual clock forward and fires its due timers in the order they fall due. @example harness.advance(20_000) */
    advance: clock.advance,
  }
}
