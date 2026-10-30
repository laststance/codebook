import { join, resolve } from 'node:path'
import type { TestContext } from 'node:test'
import { runInNewContext } from 'node:vm'

import type { DebugSession } from 'vscode'

import type { ConfiguredBrowserRun } from '../../configuredBrowserRun'
import type * as ConfiguredBrowserRunModule from '../../configuredBrowserRun'
import { configuredDefinitionSchema } from '../../configuredStudySchemas'
import { REPOSITORY_LITERAL_LIMIT_CHARS } from '../../constants'
import { StudyError } from '../../errors'
import type * as OwnedRepositoryBreakpointModule from '../../ownedRepositoryBreakpoint'
import type { BundleSource } from '../../repositoryBundle'
import type { RepositoryConfiguration } from '../../repositoryConfigSchemas'
import type { RuntimeControl } from '../../runtime'
import type { ViewportRecordingObserver } from '../../runtimeSupport/browserViewport'
import type { ProfileLeft } from '../../runtimeSupport/hostBrowser'
import { sha256 } from '../../runtimeSupport/utils/sha256'
import { WaitTimeoutError } from '../../runtimeSupport/utils/waitTimeoutError'
import { waitUntil } from '../../runtimeSupport/utils/waitUntil'
import { configuredDomExpression } from '../../utils/configuredDomExpression'
import { createBundleVerifier } from '../../utils/createBundleVerifier'
import { maskEnvValues, maskKnownValues } from '../../utils/maskKnownValues'
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

/** The source of a fixture that gives none: one statement on line 1 and an empty line 2, declared with `var` so that the stop on line 1, which requires value:nextTheme, stays on its declared line. */
const FIXTURE_SOURCE = 'var nextTheme = "dark";\n'

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
    /** Makes the Vite stand-in never finish reading the served module, as a server that stops answering does while a stop is sealed. */
    sealHangs?: boolean
    /** The executed module's text instead of the default one-statement module, such as a Vite module with an inlined env value. */
    moduleJavascript?: string
    /** Makes the Vite stand-in report these values as the ones it masks in kept module text, as the launcher's env-file values are. */
    maskedValues?: string[]
    /** Names the executed module's source map lists (its `names`), such as an env value an inlined constant carries. */
    sourceMapNames?: string[]
    /** The text the debugger reports for `nextTheme` (its variable and the declared inspection) instead of `dark`. */
    capturedValue?: string
    /** Makes the Vite stand-in reload the page, serving changed module bytes, right after the entry page was requested and before the run waits for the page to settle. */
    reloadDuringEntryLoad?: boolean
  } = {},
) {
  let owned: ConfiguredBrowserRun | undefined
  context.after(async () => {
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
  // Each of these changes makes the frozen intent hash stale.
  if (additionalStops.length || options.before || fixture || options.adapter)
    reference.configurationHash = sha256(
      JSON.stringify(reference.configuration),
    )
  for (const source of reference.descriptor!.sources)
    await repository.track(source.path, source.text)
  const definition = configuredDefinitionSchema.parse({
    configuration: reference.configuration,
    configurationHash: reference.configurationHash,
    descriptor: reference.descriptor,
  })
  const afterExpression = configuredDomExpression(
    definition.configuration.action.after,
  )
  const sourcePath = join(
      repository.directory,
      definition.configuration.source.path,
    ),
    source = reference.descriptor!.sources[0]!.text,
    // With a fixture the executed module mirrors the source line for line, so a pause can be placed on any of its lines.
    javascript =
      options.moduleJavascript ??
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
  let emitInputPause = true,
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
                : (options.capturedValue ?? 'dark'),
              type: requiredValueUndefined ? 'undefined' : 'string',
              variablesReference: 0,
            },
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
        if (next) {
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
  const emitPause = (column = 1, line = 1): void => {
    currentColumn = column
    currentLine = line
    stopCount++
    // A real debugger may reveal an existing source tab over the leased application panel.
    if (hideViewportAtPause) viewportReady = false
    emitCdpPause()
    run.onEvent(selected, {
      seq: ++requestSequence,
      type: 'event',
      event: 'stopped',
      body: { threadId: 1, reason: 'breakpoint' },
    })
  }
  let screenshot =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRFEAAAAASUVORK5CYII='
  /** Answers what the page evaluates: its location, and the configured DOM conditions, of which the after conditions hold only once the input was sent. */
  const pageEvaluation = (expression: string | undefined): unknown => {
    if (expression === 'location.href') return 'about:blank'
    if (expression === 'location.origin') return pageOrigin
    if (
      expression === afterExpression &&
      !run.view().operation?.inputDispatched
    )
      return {
        ready: false,
        failure: { conditionIndex: 0, reason: 'not-visible' },
      }
    return ready
      ? { ready: true, x: 12, y: 18 }
      : { ready: false, failure: beforeFailure }
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
      },
      timeout?: number,
    ) {
      // After the input, the after conditions answer the failure a test chose, and every read of them is counted.
      if (
        method === 'Runtime.evaluate' &&
        parameters?.expression === afterExpression &&
        run.view().operation?.inputDispatched
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
      if (method === 'Runtime.evaluate')
        return { result: { value: pageEvaluation(parameters?.expression) } }
      if (method === 'Page.navigate') {
        navigations.push(String(parameters?.url))
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
      if (method === 'Page.captureScreenshot') return { data: screenshot }
      if (method === 'Input.dispatchMouseEvent') {
        mouse.push({ type: parameters?.type, timeout })
        if (parameters?.type === 'mousePressed') return {}
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
  const fakeApplication = {
    ready: async () => {
      releases.push('application acquired')
      return 'http://127.0.0.1:4321'
    },
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
          async launch(
            configuration: DebugSession['configuration'],
          ): Promise<void> {
            launchConfigurations.push(configuration)
            root.configuration.name = configuration.name
            run.addSession(root)
            run.addSession(selected)
          }
          async attachViewport(): Promise<void> {}
          async reveal(): Promise<void> {
            viewportReady = true
          }
          resumeViewport(): void {}
          recordCapture(data: string, phase: string): void {
            const observer = recordingObserver()
            observer?.frame({
              data,
              phase,
              kind: 'phase',
              elapsedMs: observer.elapsedMs(),
            })
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
        readDevelopmentBundle: async () => ({ bundle, discovery: {} }),
      },
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
    revealSource: async () => {
      releases.push('captured source')
    },
  })
  return {
    ...repository,
    run,
    definition: { ...definition, configuration: reference.configuration },
    documents,
    breakpoints,
    userBreakpoint,
    mouse,
    commands,
    releases,
    emitPause,
    emitCdpPause,
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
    setScreenshot(base64: string): void {
      screenshot = base64
    },
    /** Makes the page report this `location.origin`, as after a redirect to another loopback name. @example harness.setPageOrigin('http://localhost:4321') */
    setPageOrigin(origin: string): void {
      pageOrigin = origin
    },
    /** Every URL the run navigated the page to, in order. */
    navigations,
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
    suppressInputPause(): void {
      emitInputPause = false
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
