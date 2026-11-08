import { mkdir, realpath, symlink, writeFile } from 'node:fs/promises'
import { dirname, join, posix, resolve } from 'node:path'
import type { TestContext } from 'node:test'
import { pathToFileURL } from 'node:url'
import { runInNewContext } from 'node:vm'

import type { DebugSession, DebugSessionOptions } from 'vscode'

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
import type { Participant, RuntimeControl } from '../../runtime'
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
import { CdpRequestTimeoutError } from '../../runtimeSupport/utils/cdpRequestTimeoutError'
import { describeWithheldImage } from '../../runtimeSupport/utils/describeWithheldImage'
import { sha256 } from '../../runtimeSupport/utils/sha256'
import { WaitTimeoutError } from '../../runtimeSupport/utils/waitTimeoutError'
import { waitUntil } from '../../runtimeSupport/utils/waitUntil'
import { citationContext } from '../../utils/citationContext'
import { clientComponentRefusal } from '../../utils/clientComponentRefusal'
import { configuredDomExpression } from '../../utils/configuredDomExpression'
import { configuredScrollExpression } from '../../utils/configuredScrollExpression'
import {
  createBundleVerifier,
  isChangedOriginalError,
} from '../../utils/createBundleVerifier'
import type { NextPagesDiscoveryCache } from '../../utils/createNextPagesDiscoveryCache'
import {
  describeNextEntryResponse,
  type NextEntryResponse,
} from '../../utils/describeNextEntryResponse'
import { maskEnvValues, maskKnownValues } from '../../utils/maskKnownValues'
import {
  readinessOutcomeOfError,
  type ReadinessObserver,
} from '../../utils/readinessEntryRecord'
import { NEXT_PAGES_STATE_EXPRESSION } from '../../utils/readNextPagesState'
import { readPagesDevelopmentBundle } from '../../utils/readPagesDevelopmentBundle'
import * as viteDevAdapter from '../../viteDevAdapter'
import type { ViteLibraryRouteDependencies } from '../../viteLibraryRoute'

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
import { defer } from './defer'
import { fakePageContext, type FakePageElement } from './fakePageContext'
import type { libraryFixture } from './libraryBuildHarness'
import {
  loadConstantsWith,
  type RuntimeConstantOverrides,
} from './loadConstantsWith'
import { loadModule } from './loadModule'
import { writeDecoyNextApp, writeNestedPackage } from './nestedNextWorkspace'
import {
  NESTED_VITE_LIBRARY_BUILT_PATH,
  servedViteLibraryModule,
  writeNestedViteLibrary,
  writeNestedVitePackage,
} from './nestedViteWorkspace'
import {
  writeNextPagesWorkspace,
  type NextPagesHarnessOptions,
  type NextPagesPageState,
} from './nextPagesWorkspace'
import { repositoryHarness } from './repositoryHarness'
import { createServerParticipant } from './serverRenderParticipant'
import { sourceBreakpointRequest } from './sourceBreakpointRequest'
import { startViteLibraryServer } from './viteLibraryServer'
import { withExpoStandIns } from './withExpoStandIns'

/** What the owned page reports for a condition that does not hold; `textDifference` is left open so a test can send a value the run must refuse. */
interface BeforeFailure {
  conditionIndex?: number
  reason: string
  textDifference?: string
  /** The page's control counts, sent with a missing click target. */
  candidates?: { button: number; link: number; field: number }
}

/**
 * Names the webpack layer a scripted server stop is sealed at: `rsc`, `api-node` (a Pages API route) or `action-browser` (the default).
 * @param seal - The harness option `serverSeal`.
 * @returns The layer in the module address `webpack-internal:///(<layer>)/./<path>`.
 * @example serverLayerOf('api-node') // => 'api-node'
 */
function serverLayerOf(seal: string | undefined): string {
  return seal === 'rsc' || seal === 'api-node' ? seal : 'action-browser'
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

/**
 * Writes the workspace library of a Vite library stop and starts the loopback server that serves it, for {@link configuredRuntimeHarness}.
 * @param input - The repository and app folders, the library source text and whether the app's link to the library is left out.
 * @returns The server, the served module text, and the served path of the library module (without a query).
 * @example const library = await stageViteLibrary({ repositoryDirectory, packageDirectory, sourceText })
 */
async function stageViteLibrary(input: {
  repositoryDirectory: string
  packageDirectory: string
  sourceText: string
  mappings: string
  unlinked?: boolean
}) {
  const servedModule = servedViteLibraryModule(
    input.sourceText,
    'const nextTheme = "dark";',
    input.mappings,
  )
  await writeNestedViteLibrary({
    repositoryDirectory: input.repositoryDirectory,
    packageDirectory: input.packageDirectory,
    sourceText: input.sourceText,
    servedModule,
    linked: !input.unlinked,
  })
  const realRepository = await realpath(input.repositoryDirectory)
  const moduleRoute = `/@fs${realRepository}/${NESTED_VITE_LIBRARY_BUILT_PATH}`
  const server = await startViteLibraryServer(moduleRoute, servedModule)
  return { server, servedModule, moduleRoute }
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

/**
 * Moves every cited source of a configured study into a package folder below the repository root, keeping text and hash, as the repository-relative paths of a nested Next app read.
 * @param reference - The study {@link createConfiguredStudy} made; changed in place.
 * @param packageRoot - The repository-relative package folder.
 * @example nestSources(reference, 'examples/web') // src/theme.ts becomes examples/web/src/theme.ts
 */
function nestSources(
  reference: ReturnType<typeof createConfiguredStudy>,
  packageRoot: string,
): void {
  const descriptor = reference.descriptor!
  reference.configuration.source.path = `${packageRoot}/${reference.configuration.source.path}`
  for (const anchor of descriptor.anchors)
    anchor.path = `${packageRoot}/${anchor.path}`
  for (const source of descriptor.sources)
    source.path = `${packageRoot}/${source.path}`
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
    /** Replaces the declared run-level after conditions, so a test can run the shape a quick start declares. */
    after?: RepositoryConfiguration['action']['after']
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
    /** Makes the mocked port check refuse as a taken declared port does, so a test can prove what happens before it. */
    declaredPortTaken?: boolean
    /** Runs the configuration on the Vite adapter: its stand-in starts the stub server, serves the sealed module at its owned address and loads the entry page once. */
    adapter?: 'vite-dev' | 'expo-web-dev'
    /**
     * A version 3 `expo-web-dev` or `vite-dev` run that declares `apiServer` (Cycle 0099, 0100): the declaration retained in the configuration and the stand-in of the `ownedApiServer` module the run loads, so no API process starts ({@link apiServerRunHarness}). Only with `packageRoot`. The optional `vite` knob serves the Vite stand-in: the dev script's `--port` (`scriptPort`), the port the stand-in server listens on (`port`) and, when `declared` is set, the facts the launcher reports before Vite's own port check.
     */
    apiServer?: {
      declaration: {
        packageRoot: string
        entry: string
        port: number
        proxyPaths?: string[]
      }
      module: unknown
      vite?: {
        scriptPort?: number
        port?: number
        declared?: { port: number; source: string }
      }
    }
    /** Called with the scripted participant right after the run started the server debug session and before it selected it, so a test sends the API's entry pause at that moment. */
    onServerDebuggingStarted?: (
      participant: ReturnType<typeof createServerParticipant>,
    ) => void
    /** Called when the stand-in adapter starts the app, so a test orders the app's start against the API's. */
    onApplicationStart?: () => void
    /** Makes the stand-in adapter's start fail with this message, as an app that cannot start does. */
    applicationStartFails?: string
    // pregate-literal: API_VERSION=1.34 the Vite library route was added at API 1.34 (its minimum), not the current API
    /** A nested Vite run that declares `library` (API 1.34): the declared folder and the route's seams (confirmation, checks, build, private folder), which a test fakes. The stand-in start then runs the build between the facts and the listen, as the real launcher start does. */
    libraryRoute?: {
      declared: string
      dependencies: ViteLibraryRouteDependencies
    }
    /** Makes the Vite stand-in refuse to seal with this sentence, as a missing served module does. */
    sealFailure?: string
    /** Makes the stand-in seal (the Vite served-module read, or the Next `.next/dev` read) never finish, as a server that stops answering does while a stop is sealed. */
    sealHangs?: boolean
    /** Makes the stand-in server seal answer as {@link readDevelopmentBundle} does for a Next server stop: the layer it sealed (`action-browser` or `rsc`), or the client-component refusal of a `'use client'` file's reference stub. */
    serverSeal?: 'action-browser' | 'rsc' | 'client-component' | 'api-node'
    /**
     * Gives a version 3 run its scripted Node participant (`harness.server`, see {@link createServerParticipant}): the stand-in server offers an inspector, the run attaches a `pwa-node` session and a second CDP channel, acknowledges the server stops' registrations, and a test sends the server's hits itself. Server stops are sealed at `(<serverSeal ?? 'action-browser'>)/./<path>`; `route` is the route the work store answers by default (`null`: unreadable). Without it a server stop's preparation ends after the seal, as before.
     */
    serverRuntime?: {
      route?: string | null
      /** The App paths manifest written to `.next/dev/server/app-paths-manifest.json` (manifest key to compiled page); by default one page for the entry path, such as `/dashboard/page`. */
      appPaths?: Record<string, string>
    }
    /**
     * Keeps the answer of every `Page.navigate` back, and the main frame's commit with it, until a test calls {@link answerNavigation}, as a pause before the response headers does (spike s05-preshell: answer and commit came after the continue). Only for a run opened with `serverRuntime`.
     */
    holdNavigation?: boolean
    /** The path the main frame lands on after the nth `Page.navigate` of a saved-session run (zero-based), when it differs from `navigationLandsOn`; later navigations use `navigationLandsOn`. */
    navigationLandings?: string[]
    /** Replaces the declared inspections (default: the value of `nextTheme`), so a test can inspect a local such as a `cookies()` result. */
    inspections?: RepositoryConfiguration['inspections']
    /** Further locals the stand-in debugger holds at a stop beside `nextTheme`, by name, as the app's scope would (an object reads as the marker `{ type: 'object' }`, as in a real frame). */
    inspectionScope?: Record<string, unknown>
    /** Makes `document.readyState` read `loading` from the nth `Page.navigate` on (one-based), so the warm-up load of a saved-session run, which waits for `complete`, finishes before the armed entry load starts loading. */
    loadingFromNavigation?: number
    /** Called whenever the stand-in page is asked for a screenshot, so a test changes what the page shows between a capture and the re-read that follows it. */
    onScreenshot?: () => void
    /** What `document.readyState` answers from the start (default `complete`); an entry-render test starts with `loading` and calls `setDocumentReadyState('complete')` once the page may load. */
    documentReadyState?: 'loading' | 'complete'
    /** The executed module's text instead of the default one-statement module, such as a Vite module with an inlined env value. */
    moduleJavascript?: string
    /** Ends the executed server module's text with the `//# sourceURL=` comment webpack gives an evaluated module, so a script the run never saw parsed can be recognised by it at its first pause. */
    serverModuleSourceUrl?: boolean
    /** Seals the stop the way a real adapter does instead of returning the harness's own bundle: the stand-in `readBundle` returns what this returns, announces the sealed bundle's address and serves its JavaScript to the debugger. A sealed bundle's `limits` reach the run's verifier and source resources as they do for a real adapter. */
    sealBundle?: (
      request: Parameters<typeof viteDevAdapter.VITE_DEV_ADAPTER.readBundle>[0],
    ) => ReturnType<typeof viteDevAdapter.VITE_DEV_ADAPTER.readBundle>
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
    /**
     * Stages a server stop in a workspace library ({@link libraryFixture}): called with the repository after it exists, it writes the library and its builds and gives the eval modules of the server compile. The debugger's frames, breakpoint file and script then name the built file, as js-debug reports Next's eval map (the built file's own map is not chained).
     */
    libraryStop?: ReturnType<typeof libraryFixture>
    /**
     * How the page announces a browser library stop's module. `resolved` (the default) is what js-debug's CDP channel sends a run (native C79-1 journal): the module address with its dot segments resolved, so `(pages-dir-browser)/../../packages/lib/build/modern/core.js` arrives as `packages/lib/build/modern/core.js`. `as-written` is the address the build wrote, as a direct CDP connection to Chrome reports it (E1).
     */
    browserLibraryAnnouncement?: 'resolved' | 'as-written'
    /** Moves the first cited source, and the stop declared in it, to this repository-relative path (such as a file under `src/pages`; with `packageRoot` a file inside that folder). */
    sourcePath?: string
    /**
     * Runs a nested Next app at this repository-relative folder (Issue 192), the one way to declare a nested package in this harness: the version 3 configuration (with `operations`) declares `packageRoot` last, the folder gets a `package.json` and a Next installation, the first cited source moves below it (unless `sourcePath` names one, which must then lie inside it), and with `nextPages` the Pages project (`.next/dev`, chunks) is written under it instead of at the repository root. Module ids Next prints name the package-relative path; stops keep their repository-relative path.
     */
    packageRoot?: string
    /**
     * Stages a workspace library a nested Vite app reaches (Cycle 0078): the first cited source moves to `packages/core/src/a.ts` outside the app, the library gets a build mapped to it and a link from the app, and a loopback server serves the entry page and the library module under `/@fs/`. A library stop is then sealed by the real Vite adapter from that server, while the debugger stays scripted; the stand-in launcher's walk lists the library module. Only with `adapter: "vite-dev"` and `packageRoot`.
     */
    viteLibrary?: {
      /** Leaves the page's scripts unannounced for the library module, as a module that only the operation loads (`import()` in a click handler) is. */
      lazy?: boolean
      /** Leaves the app's `node_modules` link to the library out, so the app does not reach it. */
      unlinked?: boolean
      /** Makes the stand-in launcher's walk list the library module twice (two served addresses with the same text), as a page that loads two copies of the file does. */
      listTwice?: boolean
    }
    /** Variations of the nested app declared by `packageRoot`. */
    packageApp?: {
      /** Writes a different Next app at the repository root: `pages/`, `app/`, `package.json` (another port and `dev` script), `node_modules/next` and `.next` whose contents differ from the package's, so a read of the wrong root yields another value. */
      decoyRoot?: boolean
      /** Where `node_modules/next` is installed: in the package folder (default) or hoisted to the repository root, as a workspace install does. */
      next?: 'package' | 'hoisted'
      /** Declares this value instead of `packageRoot` while the app lives in `packageRoot` (a symlinked alias inside the repository points at it). */
      declared?: string
      /** Leaves the cited sources at their repository-relative path outside the package folder, as a stop in a shared workspace package is. */
      stopsOutside?: boolean
      /** For a nested Vite app (`adapter: "vite-dev"`): the text of the app folder's `.env`. */
      envText?: string
    }
    /** Declares the first stop for this participant in a version 2 (cross-runtime) configuration, as a start that names `participant` does, or in a version 3 configuration when `operations` is given; only without additional stops in the version 2 form, whose form differs. */
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
    /** Makes the stand-in server's `listening` wait take this long, as a Next start that listens late after the spawn. */
    listeningAfterMs?: number
    /** Makes the stand-in server's `assertRunning` throw this message, as a process that exited early with its output tail. */
    exitedWith?: string
    /** Makes the stand-in server's structured entry check (`readyEntry`) never answer until the run is cancelled, as a first compile that is still running does. */
    entryHangs?: boolean
    /** Keeps the stand-in server's readiness request (`ready` and `readyEntry`) open after it was sent until a test calls `releaseReadiness`, as a request whose server code is paused at a module's first evaluation. */
    holdReadiness?: boolean
    /** Names the stop file by its real path (no symlink in it), as the preparation window and the seal of a real run do, so a macOS temporary folder under `/var` matches the `/private/var` path the run reads. */
    realSourceRoot?: boolean
    /** The HTTP status the stand-in server answers to the App readiness check (`ready`), 200 by default; any other status closes the readiness record with it and rejects with the launcher's own sentence, as `ready` does for an answer that is not OK. */
    readyAnswer?: number
    /**
     * Binds a stand-in saved-session store to the run, as `createRuntime` does for a version 3 run: `admission` is what the store answers (the saved session with a lease, or a fresh profile with the reason), `refuse` makes it throw a coded refusal instead, `refuseAtLaunch` makes the lease's last check at the launch throw one (a Chrome that took the folder meanwhile), and `appCookies` is the lease's cookie kind.
     * The stand-in browser then takes the lease like the real one (`prepareForLaunch` at launch, `recordBrowser` after it), and the page reports its navigations.
     */
    savedSession?: {
      admission: 'saved' | 'no-saved-session' | 'setup-not-finished'
      refuse?: StudyError
      refuseAtLaunch?: StudyError
      appCookies?: AppCookieKind
    }
    /** The structured answer of the stand-in server's entry check (`readyEntry`) for a version 3 run: the status and the `Location` it redirects to. */
    entryAnswer?: { status: number; location?: string }
    /** The origin the stand-in server reports as its own (default `http://127.0.0.1:4321`). */
    serverOrigin?: string
    /**
     * Moves the cited source `src/mode.ts` (the study's second anchor) to this repository-relative path and makes every additional stop declare that file, so one run can hold a stop in the first file and stops in a second one (such as a library browser stop beside a server stop in the app's own page). Only in a version 3 run with `operations`; by default every additional stop stays in the first file.
     */
    additionalStopFile?: string
    /** With `additionalStopFile`: the additional stops (0-based) declared in that file; the others stay in the first file. Default: every additional stop. */
    additionalStopFileStops?: number[]
    /** The configuration's entry path (default: none, so `/`). */
    entryPath?: string
    /** Makes the stand-in browser's first `close` fail, as a close that could not confirm Chrome's exit does; the second succeeds. */
    closeFailsOnce?: boolean
    /** Makes the stand-in owned application's first `close` fail, as a server whose stop could not be confirmed; the second succeeds. */
    applicationCloseFailsOnce?: boolean
    /** Makes the stand-in page's first `Page.close` wait for this promise and then fail, as a page close that outlasts the close bound before it fails; later closes succeed. */
    firstCloseFailsAfter?: Promise<void>
    /** With `firstCloseFailsAfter`: called when the stand-in page's first `Page.close` starts, so a test waits for the close itself instead of for real time. */
    onFirstCloseStarted?: () => void
    /** Makes the stand-in page acknowledge `Page.close` but never report it detached, as a target Chrome keeps listed past the close bound. */
    pageStaysAfterClose?: boolean
    /** Makes the stand-in page acknowledge `Page.close`, report no detach and end the browser participant's debug session a turn later, as js-debug 1.140 does in a native run. */
    pageCloseEndsSession?: boolean
    /** Makes the stand-in browser's `close` settle only after the run stopped its debuggers, as a managed Chrome does: it exits only when the debugger session stops. */
    browserCloseWaitsForDebuggerStop?: boolean
    /** The path the stand-in page lands on after each `Page.navigate` of a saved-session run (default: the path asked for). */
    navigationLandsOn?: string
    /** Makes the stand-in server's App verdict (`confirmAppEntry`) record its answer and then never settle until the run is cancelled, as a redirected root whose second request does not answer. */
    appEntryConfirmationHangs?: boolean
    /** Makes the stand-in page never answer a screenshot until the run is cancelled, so the run stays at the end of its setup, after the inputs were written. */
    holdScreenshot?: boolean
    /** The screenshot requests (counted from 1 over the run) the stand-in page leaves unanswered until the request's bound, as a page paused in the middle of a frame does: each fails with the client's timeout error. */
    timedOutScreenshots?: readonly number[]
    /**
     * Runs a version 3 configuration of ordered operations instead of the single action: the first stop and each of `additionalStops` follow the operation `stopOperations` names (the first stop first). A stop's pause is reported inside the input of its operation, which the page answers only once the operation's last stop was continued, as a handler paused in the debugger does.
     */
    operations?: {
      /** The operations; an empty list omits the field from the configuration (allowed when every stop declares `afterOperation: 0`). */
      operations: RepositoryOperation[]
      stopOperations: number[]
      /** The participant of each stop, the first stop first; by default the first is `options.participant ?? 'browser'` and every other stop is a browser stop. */
      stopParticipants?: Participant[]
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
      /** The configuration's `initialStorage`. */
      initialStorage?: { key: string; value: string }[]
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
  // A version 1 configuration names two adapters only; the version 3 shape built below takes the Expo one from the same field.
  if (options.adapter)
    Object.assign(reference.configuration, { adapter: options.adapter })
  if (additionalStops.length)
    reference.configuration.additionalStops = additionalStops
  if (options.inspections)
    reference.configuration.inspections = options.inspections
  if (options.before) reference.configuration.action.before = options.before
  if (options.after) reference.configuration.action.after = options.after
  if (fixture?.declaredLine)
    reference.configuration.source.line = fixture.declaredLine
  if (fixture?.declaredColumn)
    reference.configuration.source.column = fixture.declaredColumn
  if (options.sourcePath) relocateFirstSource(reference, options.sourcePath)
  if (options.additionalStopFile) {
    // The second anchor and source move together, so the descriptor still holds the stop file's text and hash.
    const descriptor = reference.descriptor!
    descriptor.anchors[1]!.path = options.additionalStopFile
    descriptor.sources[1]!.path = options.additionalStopFile
    descriptor.citationContext = citationContext(descriptor.anchors)
  }
  // A nested Next app: the stops keep repository-relative paths, the package-relative path is what Next prints.
  const packageFolder = options.packageRoot
  const packageRootDeclared = packageFolder
    ? (options.packageApp?.declared ?? packageFolder)
    : undefined
  let packageSourcePath = reference.configuration.source.path
  if (packageFolder && !options.packageApp?.stopsOutside) {
    // A named source already lies inside the package; the default one moves below it.
    if (options.sourcePath) {
      // Next module ids and script URLs are POSIX paths on every OS, so the logical path is taken with posix.
      packageSourcePath = posix.relative(packageFolder, options.sourcePath)
      if (
        packageSourcePath === '..' ||
        packageSourcePath.startsWith('../') ||
        posix.isAbsolute(packageSourcePath)
      )
        throw new Error(
          `sourcePath ${options.sourcePath} must lie inside packageRoot ${packageFolder}.`,
        )
    } else nestSources(reference, packageFolder)
  }
  if (options.entryPath ?? options.nextPages?.entryPath)
    reference.configuration.entryPath =
      options.entryPath ?? options.nextPages?.entryPath
  if (options.initialInputs)
    reference.configuration.initialInputs = options.initialInputs
  // A version 2 configuration names the first stop's participant; its other fields are the version 1 ones.
  const isInStopFile = (index: number): boolean =>
    Boolean(options.additionalStopFile) &&
    (options.additionalStopFileStops?.includes(index) ?? true)
  const unnestedConfiguration = options.operations
    ? {
        version: 3 as const,
        adapter: reference.configuration.adapter,
        book: reference.configuration.book,
        source: reference.configuration.source,
        participant:
          options.operations.stopParticipants?.[0] ??
          options.participant ??
          ('browser' as const),
        afterOperation: options.operations.stopOperations[0]!,
        before: reference.configuration.action.before,
        after: reference.configuration.action.after,
        ...(options.operations.operations.length
          ? { operations: options.operations.operations }
          : {}),
        inspections: reference.configuration.inspections,
        additionalStops: additionalStops.map((stop, index) => ({
          participant:
            options.operations!.stopParticipants?.[index + 1] ??
            ('browser' as const),
          source: {
            ...reference.configuration.source,
            ...(isInStopFile(index)
              ? {
                  path: options.additionalStopFile,
                  hash: reference.descriptor!.sources[1]!.hash,
                }
              : {}),
            line: stop.line,
            column: stop.column,
          },
          anchorIndex: isInStopFile(index)
            ? 1
            : reference.configuration.book.anchorIndex,
          inspections: stop.inspections,
          afterOperation: options.operations!.stopOperations[index + 1]!,
        })),
        ...(reference.configuration.entryPath
          ? { entryPath: reference.configuration.entryPath }
          : {}),
        // The schema's key order, which the intent hash reads: initialStorage before signInPaths and session.
        ...(options.operations.initialStorage
          ? { initialStorage: options.operations.initialStorage }
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
  // A nested app declares its folder; the field exists only in a version 3 configuration.
  if (packageRootDeclared && unnestedConfiguration.version !== 3)
    throw new Error('A nested Next app needs a version 3 configuration')
  const configuration = (
    packageRootDeclared
      ? {
          ...unnestedConfiguration,
          packageRoot: packageRootDeclared,
          ...(options.libraryRoute
            ? { library: { packageRoot: options.libraryRoute.declared } }
            : {}),
        }
      : // A library declared without a nested app is a root app that declares `library`, which the run refuses.
        options.libraryRoute && unnestedConfiguration.version === 3
        ? {
            ...unnestedConfiguration,
            library: { packageRoot: options.libraryRoute.declared },
          }
        : unnestedConfiguration
  ) as typeof unnestedConfiguration
  // The app's own API declaration is the schema's last key, so appending it keeps the parsed key order the intent hash reads.
  if (options.apiServer)
    Object.assign(configuration, { apiServer: options.apiServer.declaration })
  // Each of these changes makes the frozen intent hash stale.
  if (
    options.apiServer ||
    packageFolder ||
    additionalStops.length ||
    options.before ||
    options.after ||
    fixture ||
    options.adapter ||
    options.sourcePath ||
    options.nextPages?.entryPath ||
    options.entryPath ||
    options.initialInputs ||
    options.inspections ||
    options.participant ||
    options.libraryRoute ||
    options.operations
  )
    reference.configurationHash = sha256(JSON.stringify(configuration))
  for (const source of reference.descriptor!.sources)
    await repository.track(source.path, source.text)
  // A Pages project around the cited source: its Pages folder, Next, the `.next/dev` build and the module the page executes.
  // The package folder holds the app's own files: the Next app of a nested run is written there, the root keeps a decoy.
  const packageDirectory = packageFolder
    ? join(repository.directory, packageFolder)
    : repository.directory
  // A nested Vite app brings its own decoy root (another Vite app); a Next run keeps the Next decoy.
  if (options.packageApp?.decoyRoot && options.adapter !== 'vite-dev')
    await writeDecoyNextApp(
      repository.directory,
      options.packageApp?.next !== 'hoisted',
    )
  // The package-relative path of the first cited source: the module id Next prints and the seal compares.
  const nextCited = {
    path: packageSourcePath,
    text: reference.descriptor!.sources[0]!.text,
  }
  // A library stop: the writer lays out the workspace library (sources' builds, link) and gives the eval modules the page's server compile holds.
  const library = options.libraryStop
    ? await options.libraryStop({
        directory: repository.directory,
        realRoot: await realpath(repository.directory),
      })
    : undefined
  const pagesBuild = options.nextPages
    ? await writeNextPagesWorkspace(
        packageDirectory,
        nextCited,
        library
          ? {
              ...options.nextPages,
              citedInPageChunk: false,
              serverCompile: {
                ...(typeof options.nextPages.serverCompile === 'object'
                  ? options.nextPages.serverCompile
                  : {}),
                holdsCited: false,
                extraModules: library.serverModules,
              },
              extraBrowserModules: library.browserModules,
              extraAppModules: library.browserAppModules,
            }
          : options.nextPages,
      )
    : undefined
  if (packageFolder && options.adapter === 'expo-web-dev') {
    await mkdir(packageDirectory, { recursive: true })
    await writeFile(
      join(packageDirectory, 'package.json'),
      JSON.stringify({ name: 'app', dependencies: { expo: '57.0.0' } }),
    )
  } else if (packageFolder && options.adapter === 'vite-dev')
    await writeNestedVitePackage({
      repositoryDirectory: repository.directory,
      packageDirectory,
      decoyRoot: options.packageApp?.decoyRoot,
      envText: options.packageApp?.envText,
    })
  else if (packageFolder)
    await writeNestedPackage({
      repositoryDirectory: repository.directory,
      packageDirectory,
      withNext: !options.nextPages,
      next: options.packageApp?.next ?? 'package',
    })
  // A Vite library stop: the library, its build and the loopback server the real seal fetches from.
  const viteLibrary = options.viteLibrary
    ? await stageViteLibrary({
        repositoryDirectory: repository.directory,
        packageDirectory,
        sourceText: reference.descriptor!.sources[0]!.text,
        mappings: additionalStops.length ? 'AAAA,MAAM' : 'AAAA',
        unlinked: options.viteLibrary.unlinked,
      })
    : undefined
  if (viteLibrary) context.after(() => viteLibrary.server.close())
  // A declared alias is a link inside the repository that points at the folder holding the app.
  if (packageFolder && packageRootDeclared !== packageFolder) {
    await mkdir(dirname(join(repository.directory, packageRootDeclared!)), {
      recursive: true,
    })
    await symlink(
      join(repository.directory, packageFolder),
      join(repository.directory, packageRootDeclared!),
    )
  }
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
  // A Pages server stop is sealed from the build's real path (its maps name the canonical workspace), so the editor's breakpoints and the debugger's frames name that path too. A library stop with a server (`serverRuntime`) is covered by that; a browser-only library stop names it as well; no other caller passes `library`.
  const sourceRoot =
    (options.nextPages && options.serverRuntime) ||
    options.realSourceRoot ||
    viteLibrary ||
    (library && options.participant === 'browser') ||
    // An App Router server library stop runs in the checked-out source, named by its real path.
    (library?.appRouterServer && options.serverRuntime)
      ? await realpath(repository.directory)
      : repository.directory
  // A browser library stop of a Next Pages run: the page executes the library's `(pages-dir-browser)` module, and the debugger reports its built line.
  const browserLibrary =
    library && options.participant === 'browser' ? library : undefined
  /** Gives the address the page announces for its stop module: a browser library module's address resolved as js-debug sends it, every other address as the build wrote it. */
  const announcedPageUrlOf = (scriptUrl: string): string =>
    browserLibrary && options.browserLibraryAnnouncement !== 'as-written'
      ? new URL(scriptUrl).href
      : scriptUrl
  const browserLibraryHit =
    browserLibrary && fixture?.declaredLine
      ? browserLibrary.hitAt(fixture.declaredLine, 'pages-dir-browser')
      : undefined
  const sourcePath = library
      ? join(sourceRoot, library.frameFile ?? library.builtPath)
      : join(sourceRoot, definition.configuration.source.path),
    source = reference.descriptor!.sources[0]!.text,
    // With a fixture the executed module mirrors the source line for line, so a pause can be placed on any of its lines; a Pages page executes the eval module of its chunk.
    baseJavascript =
      options.moduleJavascript ??
      viteLibrary?.servedModule ??
      browserLibrary?.browserModuleJavascript ??
      pagesBuild?.moduleJavascript ??
      (fixture ? source : 'const nextTheme = "dark";'),
    javascript = options.serverModuleSourceUrl
      ? `${baseJavascript}\n//# sourceURL=webpack-internal:///(${serverLayerOf(options.serverSeal)})/./${packageSourcePath}`
      : baseJavascript
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
    scriptUrl: viteLibrary
      ? `${viteLibrary.server.origin}${viteLibrary.moduleRoute}?v=v1`
      : browserLibrary
        ? browserLibrary.browserAddress
        : options.adapter
          ? 'http://127.0.0.1:4321/src/theme.ts'
          : options.nextPages
            ? `webpack-internal:///(pages-dir-browser)/./${packageSourcePath}`
            : `webpack-internal:///(app-pages-browser)/./${packageSourcePath}`,
    chunkPath: join(packageDirectory, '.next/dev/chunk.js'),
    chunkHash: '0'.repeat(64),
  }
  // The folder each Next reader of the mocked seam received, so a nested run proves the package root reached it.
  const developmentBundleRoots: string[] = [],
    assertedWorkspaceRoots: string[] = [],
    declaredPortRoots: string[] = [],
    launchRequests: unknown[] = []
  // What the Vite stand-in received, so a nested Vite run proves the app folder reached the workspace check, the start and the seal.
  const viteRequests: {
    assertedWorkspace: { workspace: string; packageRoot?: string }[]
    started: { workspace: string; packageRoot?: string; library?: unknown }[]
    sealed: { workspace: string; packageRoot?: string; sourcePath: string }[]
  } = { assertedWorkspace: [], started: [], sealed: [] }
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
  // The walks the Vite stand-in launcher answered for a library stop, and the `?v=` hash its listing names now ({@link setLibraryVersion}).
  const libraryWalks: { entries: string[]; libraryFolder: string }[] = []
  let libraryVersion = 'v1'
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
  // How many times the run asked the scripted route-manifest reader.
  let manifestReads = 0
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
  // How many times the run launched the development server (`launchDevelopmentServer`), so a refusal that comes before the server starts can say none was.
  let developmentServerLaunches = 0
  // Every argument list the run gave `launchDevelopmentServer`, so a test reads the inspector flag and the library options.
  const developmentServerLaunchArguments: unknown[][] = []
  // The text of each initial input the run sent to the page, in order.
  const insertedTexts: string[] = []
  // The method of every `Input.*` CDP request the run sent to the page, in order (no parameters, so no typed value is kept).
  const inputRequests: string[] = []
  // The source of every script the run registered for each new document of the page (`initialStorage`'s writes), in order.
  const newDocumentScripts: string[] = []
  // The calls the run made to the stand-in saved-session store and its lease, in order, and the folders the stand-in browser was told to open.
  const savedSessionCalls: string[] = []
  const savedProfileFolders: string[] = []
  const signInNotices: SignInRequiredReason[] = []
  // The pathname the stand-in page reports; a landing replaces it.
  let pagePathname = options.entryPath ?? '/'
  // How many `document.readyState` reads the run started, whether the next one rejects, and the promise a held read waits on.
  let readyStateReadsStarted = 0
  let rejectNextReadyStateRead = false
  let readyStateHold: Promise<void> | undefined
  let documentReadyState: 'loading' | 'complete' =
    options.documentReadyState ?? 'complete'
  let navigationCount = 0
  /** The `Page.navigate` requests whose answer is held, oldest first ({@link holdNavigation}). */
  const heldNavigations: {
    url: string
    answer: () => void
    reject: (error: Error) => void
  }[] = []
  /** The timeout each `Page.navigate` request asked for (`undefined`: the channel's own default). */
  const navigateTimeouts: (number | undefined)[] = []
  let closeAttempts = 0
  let applicationCloseAttempts = 0
  let pageCloseAttempts = 0
  let debuggersHaveStopped: () => void = () => undefined
  const debuggersStopped = new Promise<void>((resolve) => {
    debuggersHaveStopped = resolve
  })
  const serverOrigin =
    viteLibrary?.server.origin ??
    options.serverOrigin ??
    'http://127.0.0.1:4321'
  // The loopback name the browser opens the owned server by; a Vite library stop's server listens on a free port.
  const localhostOrigin = viteLibrary
    ? `http://localhost:${new URL(serverOrigin).port}`
    : 'http://localhost:4321'
  const savedLease: SavedSessionRunLease = {
    profile: '/stand-in/Application Support/sign-in-profiles/0123abcd',
    setupAt: '2026-11-02T00:00:00.000Z',
    appCookies: options.savedSession?.appCookies ?? 'persistent',
    recordBrowser: async () => {
      savedSessionCalls.push('recordBrowser')
    },
    prepareForLaunch: async () => {
      savedSessionCalls.push('prepare')
      if (options.savedSession?.refuseAtLaunch)
        throw options.savedSession.refuseAtLaunch
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
    pageOrigin = viteLibrary?.server.origin ?? 'http://127.0.0.1:4321',
    executedScriptSource: string | undefined,
    ready = true,
    beforeFailure: BeforeFailure = { conditionIndex: 0, reason: 'not-visible' },
    afterFailure: BeforeFailure | undefined,
    afterReadCount = 0,
    // The elements the page shows after the input, each with its text; when set, the after conditions are evaluated on them by the real page expression.
    afterPageElements: FakePageElement[] | undefined,
    // What the page shows before the input; when set, the after conditions read just before the last operation are evaluated on it by the real page expression.
    beforePageElements: FakePageElement[] | undefined,
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
  /**
   * Gives the id the stand-in browser adapter numbers an editor breakpoint with. A run that stages an App Router server compile numbers them by the breakpoint's own count (`owned-breakpoint` is 1, `owned-breakpoint-2` is 2), so a pause can name one stop's breakpoint and not another's; every other run keeps the single id 1.
   * @param breakpointId - The editor breakpoint's id in this harness.
   * @returns The adapter's id.
   * @example browserAdapterIdOf('owned-breakpoint-2') // 2 in an App Router server run, else 1
   */
  const browserAdapterIdOf = (breakpointId: string): number => {
    if (!library?.appRouterServer) return 1
    // `owned-breakpoint` is 1; a suffixed id carries its number. Any other id would silently share id 1 with an owned breakpoint.
    if (breakpointId === 'owned-breakpoint') return 1
    const suffix = /^owned-breakpoint-(\d+)$/.exec(breakpointId)?.[1]
    if (suffix === undefined)
      throw new Error(
        `browserAdapterIdOf: ${breakpointId} is no owned breakpoint of an App Router server run`,
      )
    return Number(suffix)
  }
  /** Sends the page session's `setBreakpoints` request and the adapter's answer for the editor's breakpoints in the library file, as the page's adapter acknowledges them. */
  const acknowledgeBrowserBreakpoints = (): void => {
    const owned = breakpoints.filter((breakpoint) =>
      breakpoint.id.startsWith('owned-breakpoint'),
    )
    const sequence = ++requestSequence
    run.onRequest(selected, {
      seq: sequence,
      type: 'request',
      command: 'setBreakpoints',
      arguments: {
        source: { path: sourcePath },
        breakpoints: owned.map((breakpoint) =>
          sourceBreakpointRequest(breakpoint.location.range.start),
        ),
      },
    })
    run.onResponse(selected, {
      seq: ++requestSequence,
      type: 'response',
      command: 'setBreakpoints',
      request_seq: sequence,
      success: true,
      body: {
        breakpoints: owned.map((breakpoint) => ({
          id: browserAdapterIdOf(breakpoint.id),
          verified: true,
          line: breakpoint.location.range.start.line + 1,
          column: breakpoint.location.range.start.character + 1,
        })),
      },
    })
  }
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
        // A server stop never pauses the page's handler: the page's answer goes on after the last browser stop was continued.
        const nextPausesPage =
          (operationsOption?.stopParticipants?.[stopCount] ?? 'browser') ===
          'browser'
        if (next && nextBelongsToLatestInput && nextPausesPage) {
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
            id: browserAdapterIdOf(owned.id),
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
        lineNumber: browserLibraryHit
          ? browserLibraryHit.generated.line
          : currentLine - 1,
        columnNumber: browserLibraryHit
          ? browserLibraryHit.generated.column
          : currentColumn - 1,
        hitBreakpoints: ['mapped-source'],
      }),
    )
  }
  const emitPause = (column = 1, line = 1, announced = true): void => {
    // A browser library stop pauses on the built line the library's stop translates to.
    currentColumn = browserLibraryHit?.source.column ?? column
    currentLine = browserLibraryHit?.source.line ?? line
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
    // A run with no operation shows its result once the entry page loaded: there is no input to wait for.
    if (operationsOption && operationsOption.operations.length === 0)
      return true
    const view = run.view()
    return view.operations
      ? view.operations.at(-1)?.ack === 'yes'
      : Boolean(view.operation?.inputDispatched)
  }
  /** Tells whether a declared stop follows the operation the page just received an input for and pauses its handler; after {@link suppressInputPause} the input runs past that stop's line and is answered at once. */
  const stopPausesLatestInput = (): boolean =>
    emitInputPause && indexOfFirstBrowserStopOf(inputsSeen) >= 0
  /** Finds the first browser stop that follows an operation: a server stop never pauses the page's handler, the server renders on its own. */
  function indexOfFirstBrowserStopOf(operationIndex: number): number {
    return (
      operationsOption?.stopOperations.findIndex(
        (stopOperation, index) =>
          stopOperation === operationIndex &&
          (operationsOption.stopParticipants?.[index] ??
            (index === 0 ? (options.participant ?? 'browser') : 'browser')) ===
            'browser',
      ) ?? -1
    )
  }
  /** Keeps the page's answer to an input open until the last stop of its operation was continued. */
  const holdInputUntilContinued = (): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      inputResolve = resolve
      inputReject = reject
    })
  /** Reports the first stop that follows the operation the page just received an input for. */
  const emitFirstStopOfLatestInput = (): void => {
    const index = indexOfFirstBrowserStopOf(inputsSeen)
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
    if (expression === 'document.readyState') return documentReadyState
    if (expression === 'location.href') return 'about:blank'
    if (expression === 'location.pathname') return pagePathname
    if (expression === '[location.origin,location.pathname]')
      return [pageOrigin, pagePathname]
    if (expression === 'location.origin') return pageOrigin
    if (expression === scrollExpression)
      return { scrolled: clickTargetScrolled }
    // An operation's own after conditions that a test chose never to hold.
    const operationAfterAnswer = operationAfterFailures.get(expression ?? '')
    if (operationAfterAnswer)
      return { ready: false, failure: operationAfterAnswer }
    if (
      expression === afterExpression &&
      !isResultVisible() &&
      beforePageElements
    )
      return JSON.parse(
        JSON.stringify(
          runInNewContext(afterExpression, fakePageContext(beforePageElements)),
        ),
      )
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
  /** Evaluates a declared inspection's expression against the scope the stand-in debugger shows at a pause (page and server alike). */
  const evaluateInspection = (expression: string | undefined): unknown =>
    runInNewContext(expression ?? '', {
      nextTheme: requiredInspectionValue(),
      ...options.inspectionScope,
      setTheme() {},
      enabled: false,
      selection: null,
    })
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
      // A request the channel never answered fails with it, as the real channel's pending requests do.
      for (const held of heldNavigations.splice(0))
        held.reject(new Error('CDP disconnected'))
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
        source?: string
      },
      timeout?: number,
    ) {
      if (method.startsWith('Input.')) inputRequests.push(method)
      // The page close the Vite library route asks for: acknowledged, then the page is detached (unless it stays listed).
      if (method === 'Page.close') {
        if (options.firstCloseFailsAfter && pageCloseAttempts++ === 0) {
          options.onFirstCloseStarted?.()
          await options.firstCloseFailsAfter
          throw new Error('The page close failed late')
        }
        releases.push('page')
        // js-debug reports no detach on its page proxy: it ends the page's debug session instead.
        if (options.pageCloseEndsSession)
          setImmediate(() => run.terminated(selected))
        else if (!options.pageStaysAfterClose)
          listeners.get('Inspector.detached')?.({ reason: 'target_closed' })
        return {}
      }
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
                  runInNewContext(afterExpression, fakePageContext(shown)),
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
      if (
        method === 'Runtime.evaluate' &&
        parameters?.expression === 'document.readyState'
      ) {
        readyStateReadsStarted++
        if (rejectNextReadyStateRead) {
          rejectNextReadyStateRead = false
          throw new Error('Execution context was destroyed.')
        }
        // A held read answers only after the test releases it, as a read does while the page's JS is paused.
        if (readyStateHold) {
          await readyStateHold
          return { result: { value: pageEvaluation(parameters.expression) } }
        }
      }
      if (method === 'Runtime.evaluate')
        return { result: { value: pageEvaluation(parameters?.expression) } }
      if (method === 'Page.navigate') {
        navigations.push(String(parameters?.url))
        navigateTimeouts.push(timeout)
        if (options.loadingFromNavigation === navigations.length)
          documentReadyState = 'loading'
        if (options.holdNavigation && options.serverRuntime) {
          const url = String(parameters?.url)
          return new Promise<object>((resolve, reject) => {
            heldNavigations.push({
              url,
              reject,
              answer: () => {
                listeners.get('Page.frameNavigated')?.({
                  frame: {
                    id: 'main',
                    url,
                    loaderId: `loader-${++navigationCount}`,
                  },
                })
                resolve({})
              },
            })
          })
        }
        // A saved-session run's page reports the document it commits: the path asked for, or the one a test chose it lands on.
        if (options.savedSession) {
          // The landing may carry a query, as a redirect to sign-in carries its callback; the page's pathname has none.
          const landing =
            options.navigationLandings?.[navigations.length - 1] ??
            options.navigationLandsOn ??
            new URL(String(parameters?.url)).pathname
          pagePathname = landing.split('?')[0]!
          listeners.get('Page.frameNavigated')?.({
            frame: {
              id: 'main',
              url: `${localhostOrigin}${landing}`,
              loaderId: `loader-${++navigationCount}`,
            },
          })
        }
        // A run with a scripted server commits the entry document for the main frame's loader, as the entry-load phase waits for.
        else if (options.serverRuntime)
          listeners.get('Page.frameNavigated')?.({
            frame: {
              id: 'main',
              url: String(parameters?.url),
              loaderId: `loader-${++navigationCount}`,
            },
          })
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
        // A library module that only the operation loads is not parsed with the page.
        if (!options.viteLibrary?.lazy)
          listeners.get('Debugger.scriptParsed')?.({
            scriptId: 'actual',
            url: announcedPageUrlOf(bundle.scriptUrl),
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
            result: { value: evaluateInspection(parameters?.expression) },
          }
        } catch (error) {
          return {
            result: { type: 'undefined' },
            exceptionDetails: {
              exceptionId: 1,
              text: 'Unavailable test local',
              lineNumber: 0,
              columnNumber: currentColumn - 1,
              // An EvalError stands in for V8's side-effect refusal under throwOnSideEffect, which names itself this way.
              ...(error instanceof EvalError
                ? {
                    exception: {
                      type: 'object' as const,
                      subtype: 'error' as const,
                      className: 'EvalError',
                      description: `EvalError: ${error.message}`,
                    },
                  }
                : {}),
            },
          }
        }
      }
      if (method === 'Page.captureScreenshot') {
        screenshotCount += 1
        options.onScreenshot?.()
        // A held capture is answered only by the transport closing, as a lost reply is.
        if (options.holdScreenshot)
          return new Promise<never>((_resolve, reject) => {
            rejectHeldScreenshot = reject
          })
        // A request the page never answers fails as the client's bound ends it.
        if (options.timedOutScreenshots?.includes(screenshotCount))
          throw new CdpRequestTimeoutError(method)
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
      if (method === 'Page.addScriptToEvaluateOnNewDocument') {
        newDocumentScripts.push(parameters?.source ?? '')
        return {}
      }
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
  // The scripted Node participant of a run that declares server stops (opt in with `serverRuntime`).
  // A Pages run seals its server stops from the page's server compile, so the Next server executes that `(pages-dir-node)` module.
  // An API-route run is a Pages run whose server stop is sealed at its pause, from the `(api-node)` layer, not from the page's server compile.
  const isPagesServer = Boolean(
    options.nextPages &&
    options.serverRuntime &&
    options.serverSeal !== 'api-node',
  )
  const serverScriptUrl = options.apiServer
    ? // The API's modules are plain files the Node process loads: the debugger announces their file URL.
      pathToFileURL(sourcePath).href
    : isPagesServer
      ? library
        ? `webpack-internal:///(pages-dir-node)/${library.runtimePath}`
        : `webpack-internal:///(pages-dir-node)/./${packageSourcePath}`
      : library?.appRouterServer
        ? library.appRouterServer.rscAddress
        : `webpack-internal:///(${serverLayerOf(options.serverSeal)})/./${packageSourcePath}`
  const serverParticipant = options.serverRuntime
    ? createServerParticipant({
        run: () => run,
        sourcePath,
        javascript:
          library?.moduleJavascript ??
          pagesBuild?.serverModuleJavascript ??
          javascript,
        scriptUrl: serverScriptUrl,
        sourceMap: library?.moduleMap ?? bundle.sourceMap,
        workspace: packageDirectory,
        defaultRoute: options.serverRuntime.route ?? null,
        evaluateOnCallFrame: evaluateInspection,
        breakpoints,
        released: (name) => releases.push(name),
      })
    : undefined
  const serverLaunches: DebugSession['configuration'][] = []
  // The compiled App paths manifest the run reads to know the entry route's pattern; a Pages run reads the Pages manifest the build harness wrote.
  if (options.serverRuntime && !isPagesServer && !options.nextPages) {
    const entryPathname = (options.entryPath ?? '/').split(/[?#]/)[0]!
    const stem = entryPathname === '/' ? '' : entryPathname.replace(/\/$/, '')
    const manifestPath = join(
      packageDirectory,
      '.next/dev/server/app-paths-manifest.json',
    )
    await mkdir(dirname(manifestPath), { recursive: true })
    await writeFile(
      manifestPath,
      JSON.stringify(
        options.serverRuntime.appPaths ?? {
          [`${stem}/page`]: `app${stem}/page.js`,
        },
      ),
    )
  }
  const vscode = {
    workspace: {
      textDocuments: documents,
      getWorkspaceFolder: () => undefined,
    },
    debug: {
      breakpoints,
      addBreakpoints(added: TestBreakpoint[]): void {
        breakpoints.push(...added)
        if (serverParticipant)
          queueMicrotask(() => serverParticipant.acknowledgeBreakpoints())
        // The editor sends every breakpoint to the page's session too; an App Router server run's page numbers them ({@link browserAdapterIdOf}).
        if (library?.appRouterServer)
          queueMicrotask(() => acknowledgeBrowserBreakpoints())
      },
      async startDebugging(
        _folder: unknown,
        config: DebugSession['configuration'],
        _startOptions?: DebugSessionOptions,
      ): Promise<boolean> {
        if (!serverParticipant) throw new Error('No server participant')
        serverLaunches.push(config)
        Object.assign(serverParticipant.rootSession.configuration, config)
        Object.assign(serverParticipant.session.configuration, config)
        // js-debug announces its silent root first; the server's target session is its child.
        run.addSession(serverParticipant.rootSession)
        run.addSession(serverParticipant.session)
        options.onServerDebuggingStarted?.(serverParticipant)
        return true
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
            // A provisional breakpoint is placed in the real path of its file; the sealed bundle's path is the harness's.
            source: { path: removed[0]?.location.uri?.fsPath ?? sourcePath },
            breakpoints: breakpoints.map((breakpoint) =>
              sourceBreakpointRequest(breakpoint.location.range.start),
            ),
          },
        })
        if (serverParticipant)
          queueMicrotask(() =>
            serverParticipant.acknowledgeBreakpoints(
              removed[0]?.location.uri?.fsPath,
            ),
          )
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
        debuggersHaveStopped()
        run.terminated(root)
        run.terminated(selected)
        if (serverParticipant) {
          run.terminated(serverParticipant.session)
          run.terminated(serverParticipant.rootSession)
        }
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
  /**
   * Plays the launcher's readiness request for the run's record: it is sent, then it ends with the scripted answer or without one (`readinessFailure`).
   * @param observer - The run's record, as the launcher gets it.
   * @param status - The status the stand-in server answers.
   * @throws The error a request that ended without an answer rejects with.
   */
  const playReadinessRequest = (
    observer: ReadinessObserver | undefined,
    status: number,
  ): void => {
    observer?.sent()
    const failure = options.nextPages?.readinessFailure
    if (!failure) {
      observer?.closed({ status })
      return
    }
    observer?.closed({ outcome: failure })
    const error = new Error(
      failure === 'timeout'
        ? 'The operation was aborted due to timeout'
        : 'fetch failed',
    )
    if (failure === 'timeout') error.name = 'TimeoutError'
    throw error
  }
  /**
   * Plays a readiness request that was sent and gets no answer (`nextPages.readinessUnanswered`): it ends only when the run is cancelled, and its record closes with the outcome the real launcher names for that rejection.
   * @param observer - The run's record, as the launcher gets it.
   * @param signal - The run's stop signal, which the request carries.
   * @throws The signal's reason once the run is cancelled.
   */
  const holdReadinessRequestUnanswered = (
    observer: ReadinessObserver | undefined,
    signal: AbortSignal,
  ): Promise<never> => {
    observer?.sent()
    return new Promise<never>((_resolve, reject) =>
      signal.addEventListener('abort', () => {
        observer?.closed({
          outcome: readinessOutcomeOfError(signal.reason, signal),
        })
        reject(signal.reason)
      }),
    )
  }
  const readinessGate = defer<void>()
  let readinessRequestHeld = false
  /** Sends the readiness request and keeps it open until {@link readinessGate} is released, when the options hold it. */
  const holdReadinessRequest = async (
    observer: ReadinessObserver | undefined,
    signal: AbortSignal,
  ): Promise<void> => {
    if (!options.holdReadiness) return
    observer?.sent()
    readinessRequestHeld = true
    // The run's stop ends the request, as it ends a real one; the request is no longer held either way.
    try {
      await Promise.race([
        readinessGate.promise,
        new Promise<never>((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(signal.reason), {
            once: true,
          }),
        ),
      ])
    } finally {
      readinessRequestHeld = false
    }
  }
  const fakeApplication = {
    listening: async (signal: AbortSignal): Promise<string> => {
      if (options.listeningAfterMs)
        await new Promise((resolveWait) =>
          setTimeout(resolveWait, options.listeningAfterMs),
        )
      signal.throwIfAborted()
      return serverOrigin
    },
    assertRunning: (): void => {
      if (options.exitedWith) throw new Error(options.exitedWith)
    },
    ready: async (
      signal: AbortSignal,
      entryPath?: string,
      observer?: ReadinessObserver,
    ) => {
      readyEntryPaths.push(entryPath)
      if (options.launchFailure) throw new Error(options.launchFailure)
      releases.push('application acquired')
      await holdReadinessRequest(observer, signal)
      const status = options.readyAnswer ?? 200
      playReadinessRequest(observer, status)
      // An answer that is not OK rejects with the launcher's own sentence, after the record closed with its status.
      if (status !== 200)
        throw new Error(
          entryPath === undefined || entryPath === '/'
            ? `Application root failed: ${status}: ${options.nextPages?.outputTail ?? ''}`
            : `Selected application page failed or redirected: ${status}. Select the actual entry path and prerequisites.`,
        )
      return serverOrigin
    },
    // The structured entry check of a Pages-capable run: the scripted answer, described by the real code, never fetched.
    readyEntry: async (
      signal: AbortSignal,
      entryPath: string,
      signInPaths?: readonly string[],
      observer?: ReadinessObserver,
    ) => {
      entryChecks.push(entryPath)
      // A data function that hangs keeps the sent request unanswered until the run is cancelled.
      if (options.nextPages?.readinessUnanswered)
        await holdReadinessRequestUnanswered(observer, signal)
      // A first compile that has not finished answers only when the run is cancelled.
      if (options.entryHangs)
        await new Promise<never>((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(signal.reason)),
        )
      if (options.launchFailure) throw new Error(options.launchFailure)
      releases.push('application acquired')
      await holdReadinessRequest(observer, signal)
      const origin = serverOrigin,
        answer = options.entryAnswer ??
          options.nextPages?.entry ?? { status: 200 }
      playReadinessRequest(observer, answer.status)
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
    ...serverParticipant?.application,
    close: async (): Promise<void> => {
      // A server whose stop failed once is still running, as the run must assume.
      if (options.applicationCloseFailsOnce && applicationCloseAttempts++ === 0)
        throw new Error('The owned server did not confirm its exit')
      releases.push('application')
    },
  }
  const breakpointModule = await loadModule<
    typeof OwnedRepositoryBreakpointModule
  >(resolve(__dirname, '../../ownedRepositoryBreakpoint.js'), { vscode })
  const runtimeModule = await loadModule<typeof ConfiguredBrowserRunModule>(
    resolve(__dirname, '../../configuredBrowserRun.js'),
    withExpoStandIns(options, {
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
            // A managed Chrome exits only when the debugger session stops, so its close cannot settle before that.
            if (options.browserCloseWaitsForDebuggerStop) await debuggersStopped
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
      './runtimeSupport/cdp': {
        Cdp: {
          connect: async (url: string) =>
            serverParticipant && url.endsWith('/server')
              ? serverParticipant.proxy
              : proxy,
        },
      },
      './utils/createBundleVerifier': {
        isChangedOriginalError,
        // The real verifier, with every scan of its sealed map recorded.
        createBundleVerifier: (
          sealed: BundleSource,
          limits?: Parameters<typeof createBundleVerifier>[1],
        ) => {
          const verifier = createBundleVerifier(sealed, limits)
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
          workspaceRoot: string,
          source: Parameters<typeof clientComponentRefusal>[0],
          signal: AbortSignal,
          _entryPath?: string,
          execution?: string,
          nextPackage?: { packageRoot: string },
        ) => {
          // A nested app is read below its package root; the first argument stays the repository root.
          developmentBundleRoots.push(nextPackage?.packageRoot ?? workspaceRoot)
          // A hung `.next/dev` read ends only when the run is cancelled.
          if (options.sealHangs)
            await new Promise<never>((_resolve, reject) =>
              signal.addEventListener('abort', () => reject(signal.reason)),
            )
          if (options.serverSeal === 'client-component')
            throw clientComponentRefusal(source)
          // A server stop of a run with a scripted server is sealed at the address of the layer it is sealed from.
          const isServerStop =
            serverParticipant && execution === 'server-action'
          return {
            bundle: isServerStop
              ? { ...bundle, scriptUrl: serverScriptUrl }
              : bundle,
            discovery: {},
            ...(serverParticipant
              ? { layer: options.serverSeal ?? 'action-browser' }
              : options.serverSeal
                ? { layer: options.serverSeal }
                : {}),
          }
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
              readNextRouteManifests: async (request: {
                signal?: AbortSignal
              }) => {
                manifestReads += 1
                // A poll still waiting for a cold compile answers only when the run is cancelled.
                if (options.nextPages?.manifestsHang)
                  await new Promise<never>((_resolve, reject) =>
                    request.signal?.addEventListener('abort', () =>
                      reject(request.signal?.reason),
                    ),
                  )
                const failure = options.nextPages?.manifestFailure
                if (failure) throw new Error(failure)
                return options.nextPages?.manifests
              },
            },
          }
        : {}),
      './utils/assertDevelopmentWorkspace': {
        assertDevelopmentWorkspace: async (workspaceRoot: string) => {
          assertedWorkspaceRoots.push(workspaceRoot)
        },
      },
      './utils/readDeclaredDevelopmentPort': {
        readDeclaredDevelopmentPort: async (workspaceRoot: string) => {
          declaredPortRoots.push(workspaceRoot)
          return { port: 4321, source: 'the dev script in package.json' }
        },
      },
      './utils/assertDevelopmentPortFree': {
        assertDevelopmentPortFree: async () => {
          if (options.declaredPortTaken)
            throw new StudyError(
              'PREREQUISITE_MISSING',
              'Port 4321 is in use on this machine',
            )
        },
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
        launchDevelopmentServer: (...launchArguments: unknown[]) => {
          launchRequests.push(launchArguments[0])
          developmentServerLaunchArguments.push(launchArguments)
          developmentServerLaunches += 1
          return fakeApplication
        },
      },
      './viteDevAdapter': {
        VITE_DEV_ADAPTER: {
          ...viteDevAdapter.VITE_DEV_ADAPTER,
          assertWorkspace: async (
            workspace: string,
            _node: string,
            _signal: AbortSignal,
            _nextPackage?: unknown,
            vitePackage?: { packageRoot: string },
          ) => {
            viteRequests.assertedWorkspace.push({
              workspace,
              packageRoot: vitePackage?.packageRoot,
            })
          },
          start: async (request: {
            workspace: string
            vitePackage?: { packageRoot: string }
            viteLibrary?: unknown
            prepareLibrary?: () => Promise<void>
            onApp(app: typeof fakeApplication): void
            onStep(step: string): void
            onDeclaredPort(declared: { port: number; source: string }): void
            assertPortFree(declared: {
              port: number
              source: string
            }): Promise<void>
          }) => {
            viteRequests.started.push({
              workspace: request.workspace,
              packageRoot: request.vitePackage?.packageRoot,
              ...(request.viteLibrary === undefined
                ? {}
                : { library: request.viteLibrary }),
            })
            // The real start builds the library between the facts and the listen.
            if (request.viteLibrary) {
              request.onApp(fakeApplication)
              await request.prepareLibrary?.()
            }
            // The real launcher reports the port its config resolved and checks it before it listens; an `apiServer` test scripts those facts.
            const declared = options.apiServer?.vite?.declared
            if (declared) {
              request.onDeclaredPort(declared)
              await request.assertPortFree(declared)
            }
            request.onStep('starting Vite')
            setupSteps.push('starting Vite')
            request.onApp(fakeApplication)
            options.onApplicationStart?.()
            if (options.applicationStartFails)
              throw new Error(options.applicationStartFails)
            return {
              app: fakeApplication,
              port: options.apiServer?.vite?.port ?? 4321,
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
          // The stand-in launcher lists the one library module the server serves, under the hash of the moment.
          walkLibraryModules: async (
            _app: unknown,
            request: { entries: string[]; libraryFolder: string },
          ) => {
            libraryWalks.push(request)
            return {
              modules: viteLibrary
                ? [
                    `${viteLibrary.moduleRoute}?v=${libraryVersion}`,
                    ...(options.viteLibrary?.listTwice
                      ? [
                          `${viteLibrary.moduleRoute}?v=${libraryVersion}&copy=2`,
                        ]
                      : []),
                  ]
                : [],
              optimizedLibrary: false,
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
          readBundle: async (
            request: Parameters<
              typeof viteDevAdapter.VITE_DEV_ADAPTER.readBundle
            >[0],
          ) => {
            viteRequests.sealed.push({
              workspace: request.workspace,
              packageRoot: request.vitePackage?.packageRoot,
              sourcePath: request.source.path,
            })
            sealReads += 1
            // A library stop is sealed by the real adapter from the loopback server; the page then announces the module under its sealed address.
            if (request.viteLibrary) {
              const sealed =
                await viteDevAdapter.VITE_DEV_ADAPTER.readBundle(request)
              bundle.scriptUrl = sealed.bundle.scriptUrl
              return sealed
            }
            if (options.sealBundle) {
              const sealed = await options.sealBundle(request)
              // The page announces the sealed address and the debugger serves the sealed bytes.
              bundle.scriptUrl = sealed.bundle.scriptUrl
              servedJavascript = sealed.bundle.javascript
              return sealed
            }
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
    }),
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
    ...(options.libraryRoute
      ? { viteLibrary: options.libraryRoute.dependencies }
      : {}),
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
    /** The scripted Node participant of a run opened with `serverRuntime` (see {@link createServerParticipant}); `undefined` otherwise. */
    server: serverParticipant?.api,
    /** The folder each mocked Next reader received: `readDevelopmentBundle`, `assertDevelopmentWorkspace`, `readDeclaredDevelopmentPort` and the first argument of each `launchDevelopmentServer` call. */
    readerRoots: {
      developmentBundle: developmentBundleRoots,
      assertedWorkspace: assertedWorkspaceRoots,
      declaredPort: declaredPortRoots,
      launchRequests,
    },
    /** What the Vite stand-in received from the run: the workspace check's and the start's folder, and each sealed stop's repository root, package root and declared path. */
    viteRequests,
    /** The configuration of each server debug session the run started, in order. */
    serverLaunches,
    /** The scripted server's inspector channel, whose `subscribe` a test may replace to act while the run subscribes. */
    serverProxy: serverParticipant?.proxy,
    /** Delivers a CDP event of the owned page to the run's listener, as the browser's own channel does (`Network.requestWillBeSent`, `Network.loadingFinished`). @example harness.emitPageEvent('Network.loadingFinished', { requestId: '9', timestamp: 12 }) */
    emitPageEvent(event: string, parameters: unknown): void {
      listeners.get(event)?.(parameters)
    },
    /** Changes what `document.readyState` answers from now on, so a test lets the entry page finish loading once its server stops were continued. @example harness.setDocumentReadyState('complete') */
    setDocumentReadyState(state: 'loading' | 'complete'): void {
      documentReadyState = state
    },
    /** How many `document.readyState` reads the run started so far. @example harness.readyStateReads() */
    readyStateReads: (): number => readyStateReadsStarted,
    /** Makes the next `document.readyState` read reject, as one does when the execution context is gone in a commit. @example harness.rejectNextReadyStateRead() */
    rejectNextReadyStateRead(): void {
      rejectNextReadyStateRead = true
    },
    /** Holds every later `document.readyState` read unanswered until the returned function is called, as a paused page does. @returns The release. @example const release = harness.holdReadyStateReads() */
    holdReadyStateReads(): () => void {
      let release = (): void => {}
      readyStateHold = new Promise<void>((resolve) => {
        release = resolve
      })
      return (): void => {
        readyStateHold = undefined
        release()
      }
    },
    /** How many operation inputs the stand-in page received (version 3 runs). */
    inputsSeen: (): number => inputsSeen,
    /** How many owned stop breakpoints the run has requested so far (a retired one still counts), so a test sees whether a stop was armed yet. */
    ownedBreakpointsRequested: (): number => breakpointCount,
    /** Sets the source position the debugger reports as the paused top frame, for a pause a test sends in parts. */
    setPausedFrame(column: number, line = 1): void {
      currentColumn = column
      currentLine = line
    },
    /**
     * Sends the page session's `setBreakpoints` for the editor's owned breakpoints, each at its own file, and the adapter's verified answer, as the editor sends every breakpoint to the page's session too; the page's adapter numbers them from 101.
     * @returns The page adapter's ids of the owned breakpoints, in the editor's order.
     * @example const ids = harness.acknowledgeOwnedBreakpointsInPage() // [101]
     */
    acknowledgeOwnedBreakpointsInPage(): number[] {
      const owned = breakpoints.filter((breakpoint) =>
        breakpoint.id.startsWith('owned-breakpoint'),
      )
      const ids: number[] = []
      for (const path of new Set(
        owned.map((entry) => entry.location.uri.fsPath),
      )) {
        const inFile = owned.filter(
          (entry) => entry.location.uri.fsPath === path,
        )
        const fileIds = inFile.map((_entry, index) => 101 + ids.length + index)
        const sequence = ++requestSequence
        run.onRequest(selected, {
          seq: sequence,
          type: 'request',
          command: 'setBreakpoints',
          arguments: {
            source: { path },
            breakpoints: inFile.map((entry) =>
              sourceBreakpointRequest(entry.location.range.start),
            ),
          },
        })
        run.onResponse(selected, {
          seq: ++requestSequence,
          type: 'response',
          command: 'setBreakpoints',
          request_seq: sequence,
          success: true,
          body: {
            breakpoints: inFile.map((entry, index) => ({
              id: fileIds[index],
              verified: true,
              line: entry.location.range.start.line + 1,
              column: entry.location.range.start.character + 1,
            })),
          },
        })
        ids.push(...fileIds)
      }
      return ids
    },
    /** Sends the debugger's `stopped` alone, for a pause the runtime reported earlier; `hitBreakpointIds` are the adapter's ids of the breakpoints it names, and `source` is the place its stack frame reports. @example harness.emitStopped({ hitBreakpointIds: [12], source: { line: 3, column: 1 } }) */
    emitStopped(options?: {
      hitBreakpointIds?: number[]
      source?: { line: number; column: number }
    }): void {
      if (options?.source) {
        currentLine = options.source.line
        currentColumn = options.source.column
      }
      const hitBreakpointIds = options?.hitBreakpointIds
      run.onEvent(selected, {
        seq: ++requestSequence,
        type: 'event',
        event: 'stopped',
        body: {
          threadId: 1,
          reason: 'breakpoint',
          ...(hitBreakpointIds ? { hitBreakpointIds } : {}),
        },
      })
    },
    /** Announces a script of the owned page, as the debugger does for every module it parses. */
    announceScript(scriptId: string, url: string, hash?: string): void {
      listeners.get('Debugger.scriptParsed')?.({
        scriptId,
        url,
        executionContextId: 1,
        ...(hash === undefined ? {} : { hash }),
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
    /** Makes the stand-in page draw the secret control's text from now on, as a show-password toggle does; `false` restores the dots. */
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
    /** Whether the readiness request is open and held ({@link holdReadiness}). */
    readinessRequestHeld: (): boolean => readinessRequestHeld,
    /** Lets the held readiness request end with its scripted answer. @example harness.releaseReadiness() */
    releaseReadiness(): void {
      readinessGate.resolve()
    },
    /** The entry path the run passed to each readiness check of the stand-in server (`app.ready`), in order. */
    readyEntryPaths,
    /** The entry path of each structured entry check (`app.readyEntry`) of a Pages-capable run, in order. */
    entryChecks,
    /** How many times the run launched the development server (the Next adapter calls `launchDevelopmentServer`); 0 for a run refused before its server starts. */
    developmentServerLaunches: (): number => developmentServerLaunches,
    /** The arguments of each `launchDevelopmentServer` call, in order: the folder, the Node executable, the journal writer, whether the server inspector was requested, the port, and so on. */
    developmentServerLaunchArguments,
    /** The text of each initial input the run sent to the page (`Input.insertText`), in order. */
    insertedTexts,
    /** The method of every `Input.*` request the run sent to the page (`Input.insertText`, `Input.dispatchMouseEvent`, …), in order; the saved-session lanes assert that a refusal or a facts read sends none. */
    inputRequests,
    /** The source of every script the run registered for each new document of the page (`Page.addScriptToEvaluateOnNewDocument`), in order; `initialStorage` is written by one. */
    newDocumentScripts,
    /** The calls the run made to the stand-in saved-session store and its lease, in order: `acquire:<runId>`, `remember`, `prepare`, `recordBrowser`, `release`. */
    savedSessionCalls,
    /** The folders the stand-in browser was told to open as the saved session. */
    savedProfileFolders,
    /** The reasons of the notices the run asked the editor to show. */
    signInNotices,
    /** The stand-in lease's folder, which no journal record or error may name. */
    savedProfileFolder: savedLease.profile,
    /** Reports that the page reached this path of the run's origin, or this absolute URL on its own origin (an external sign-in page, Chrome's error page), as a redirect does: a full document load, or a client-side navigation inside the document. @example harness.landOn('/login', 'document') */
    landOn(path: string, kind: 'document' | 'within-document'): void {
      const onRunOrigin = path.startsWith('/')
      const url = onRunOrigin ? `${localhostOrigin}${path}` : path
      // The page's pathname has no query; the event's URL keeps it, as a redirect to sign-in carries a callback.
      pagePathname = new URL(url).pathname
      if (!onRunOrigin) pageOrigin = new URL(url).origin
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
    /** Reports the page's network events for the requests a Pages hit may be working for, as the browser does; a request comes from the main frame (`main`) unless a test names the frame. @example harness.pageRequest.start('7', 'http://localhost:4321/_next/data/build/index.json?page=2', 'Fetch') */
    pageRequest: {
      start(
        requestId: string,
        url: string,
        type = 'Document',
        frameId = 'main',
        method = 'GET',
        wallTime?: number,
      ): void {
        listeners.get('Network.requestWillBeSent')?.({
          requestId,
          frameId,
          request: { url, method },
          type,
          // The browser's own start of the request, in seconds since the epoch; absent as an older event.
          ...(wallTime === undefined ? {} : { wallTime }),
        })
      },
      /** Reports that the page attached an iframe under its main frame, as `Page.frameAttached` does. @example harness.pageRequest.attachChildFrame('child-1') */
      attachChildFrame(frameId: string): void {
        listeners.get('Page.frameAttached')?.({
          frameId,
          parentFrameId: 'main',
        })
      },
      finish(requestId: string): void {
        listeners.get('Network.responseReceived')?.({ requestId })
      },
    },
    /** The answers the run asked the stand-in server to judge the App way (`app.confirmAppEntry`), in order. */
    appEntryConfirmations,
    /** Every Pages seal the run asked for, with its discovery cache and the bytes read before and after. */
    pagesSeals,
    /** The `.next/dev/build-manifest.json` text written for a Pages run. */
    pagesBuildManifest: pagesBuild?.buildManifest,
    /** How many times the run read the Pages router state. */
    pagesStateReads: (): number => pagesStateReads,
    /** How many times the run asked the scripted route-manifest reader (`nextPages.manifests`). */
    manifestReads: (): number => manifestReads,
    /** Makes every later read of the Pages router state answer this state, as a client redirect or a late router does. @example harness.setPagesState({ pathname: '/login', routerSeen: true, isReady: true, route: '/login' }) */
    setPagesState(state: NextPagesPageState): void {
      pagesStates = [state]
    },
    /** The configuration of each browser the run launched, in order. */
    launchConfigurations,
    /** Reports another main-frame page load, as a Vite dependency-optimizer reload or a click's navigation does. @example harness.reloadPage() */
    reloadPage(): void {
      listeners.get('Page.frameNavigated')?.({
        frame: { id: 'main', url: `${localhostOrigin}/` },
      })
    },
    /** The timeout each `Page.navigate` request asked for, in order (`undefined`: the channel's own default). */
    navigateTimeouts,
    /** How many `Page.navigate` requests are still unanswered ({@link holdNavigation}). */
    heldNavigationCount: (): number => heldNavigations.length,
    /** Answers the oldest held `Page.navigate` and commits the main frame's document for it, as the browser does once the response headers arrive. @example harness.answerNavigation() */
    answerNavigation(): void {
      heldNavigations.shift()?.answer()
    },
    /** Commits another main-frame document with a new loader, as a redirect or a script's `location.replace` does, and says the page is now on this path. @example harness.commitMainFrame('/login') */
    commitMainFrame(path: string): void {
      pagePathname = path.split('?')[0]!
      listeners.get('Page.frameNavigated')?.({
        frame: {
          id: 'main',
          url: `${localhostOrigin}${path}`,
          loaderId: `loader-${++navigationCount}`,
        },
      })
    },
    /** Reports the page's inspector channel as lost, as Chrome crashing or closing does. */
    disconnectPage(): void {
      proxy.close()
    },
    /** Reports a page load inside a frame other than the main one. */
    loadSubframe(): void {
      listeners.get('Page.frameNavigated')?.({
        frame: {
          id: 'child',
          parentId: 'main',
          url: `${localhostOrigin}/x`,
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
    /** The Vite library stop's stand-in launcher and server (Cycle 0078); absent without the `viteLibrary` option. */
    viteLibrary: viteLibrary && {
      /** Every walk the run asked the stand-in launcher for, in order. */
      walks: libraryWalks,
      /** Makes the stand-in launcher list the library module under this `?v=` hash from now on, as a dependency-optimizer reload does. @example harness.viteLibrary?.setVersion('v2') */
      setVersion(version: string): void {
        libraryVersion = version
      },
      /** Serves this module text from the loopback server from now on (a rebuild). @example harness.viteLibrary?.setModuleText('…') */
      setModuleText(text: string): void {
        viteLibrary.server.setModuleText(text)
      },
      /** The served module text the harness started with. */
      servedModule: viteLibrary.servedModule,
      /** The module's served address under the hash the stand-in launcher lists now. */
      moduleAddress: (version = libraryVersion): string =>
        `${viteLibrary.server.origin}${viteLibrary.moduleRoute}?v=${version}`,
    },
    /** How many times the run read a stop module from the Vite stand-in. */
    sealReadCount(): number {
      return sealReads
    },
    /** How many times the run asked whether the server was settled (the dependency optimizer idle). */
    settledQuestionCount(): number {
      return settledQuestions
    },
    /** The id the stand-in browser adapter gives an editor breakpoint (see {@link browserAdapterIdOf}). @example harness.browserAdapterIdOf('owned-breakpoint') // 1 */
    browserAdapterIdOf,
    /**
     * Pauses the page in a script at a generated place and reports the DAP `stopped` of that pause, as the adapter does for a breakpoint hit in the page's copy of a library module; the stack the run reads then names this source place.
     * @param pause - The script, its generated place, the source place of the DAP frame and the adapter ids of the breakpoints hit (none when omitted).
     * @example harness.pauseBrowserInLibrary({ scriptId: 'browser-lib', generated: { line: 11, column: 2 }, source: { line: 2, column: 1 }, hitBreakpointIds: [1] })
     */
    pauseBrowserInLibrary(pause: {
      scriptId: string
      generated: { line: number; column: number }
      source: { line: number; column: number }
      hitBreakpointIds?: number[]
    }): void {
      currentLine = pause.source.line
      currentColumn = pause.source.column
      listeners.get('Debugger.paused')?.(
        debuggerPausedEvent({
          callFrameId: 'selected-frame',
          scriptId: pause.scriptId,
          lineNumber: pause.generated.line,
          columnNumber: pause.generated.column,
          hitBreakpoints: ['mapped-source'],
        }),
      )
      run.onEvent(selected, {
        seq: ++requestSequence,
        type: 'event',
        event: 'stopped',
        body: {
          threadId: 1,
          reason: 'breakpoint',
          ...(pause.hitBreakpointIds
            ? { hitBreakpointIds: pause.hitBreakpointIds }
            : {}),
        },
      })
    },
    /** Re-announces the sealed module the way the new page generation parses it. @example harness.announceSealedModule('second') */
    announceSealedModule(scriptId: string): void {
      listeners.get('Debugger.scriptParsed')?.({
        scriptId,
        url: announcedPageUrlOf(bundle.scriptUrl),
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
    showAfterPage(elements: FakePageElement[]): void {
      afterPageElements = elements
    },
    /** Makes the page show these elements before the input, so the run's own after-condition expression is read on them just before the last operation: a condition they satisfy makes the run refuse the operation. @example harness.showBeforePage([{ selector: 'h1', textContent: 'Invoices' }]) */
    showBeforePage(elements: FakePageElement[]): void {
      beforePageElements = elements
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
