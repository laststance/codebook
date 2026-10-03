import { join, resolve } from 'node:path'
import type { TestContext } from 'node:test'
import { runInNewContext } from 'node:vm'

import type { DebugSession } from 'vscode'

import type { ConfiguredBrowserRun } from '../../configuredBrowserRun'
import type * as ConfiguredBrowserRunModule from '../../configuredBrowserRun'
import { configuredDefinitionSchema } from '../../configuredStudySchemas'
import { SOURCE_BOUND_PAUSE_WAIT_DESCRIPTION } from '../../constants'
import type * as OwnedRepositoryBreakpointModule from '../../ownedRepositoryBreakpoint'
import type { BundleSource } from '../../repositoryBundle'
import type { RepositoryConfiguration } from '../../repositoryConfigSchemas'
import type { RuntimeControl } from '../../runtime'
import type { ViewportRecordingObserver } from '../../runtimeSupport/browserViewport'
import { sha256 } from '../../runtimeSupport/utils/sha256'
import { waitUntil } from '../../runtimeSupport/utils/waitUntil'
import { configuredDomExpression } from '../../utils/configuredDomExpression'

import { createConfiguredStudy } from './createConfiguredStudy'
import { debuggerPausedEvent } from './debuggerPausedEvent'
import { loadModule } from './loadModule'
import { repositoryHarness } from './repositoryHarness'

/** What the owned page reports for a condition that does not hold; `textDifference` is left open so a test can send a value the run must refuse. */
interface BeforeFailure {
  conditionIndex?: number
  reason: string
  textDifference?: string
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
      /** Replaces the one-statement source; its default already has an empty line 2. */
      source?: string
      /** Last line of the first citation instead of line 1. */
      citationEndLine?: number
      /** Line the first stop is declared on instead of line 1. */
      declaredLine?: number
    }
  } = {},
) {
  let owned: ConfiguredBrowserRun | undefined
  context.after(async () => {
    await owned?.stop()
  })
  const repository = await repositoryHarness(context),
    fixture = options.fixture,
    reference = createConfiguredStudy(fixture?.source, fixture?.citationEndLine)
  if (additionalStops.length)
    reference.configuration.additionalStops = additionalStops
  if (options.before) reference.configuration.action.before = options.before
  if (fixture?.declaredLine)
    reference.configuration.source.line = fixture.declaredLine
  // Each of these changes makes the frozen intent hash stale.
  if (additionalStops.length || options.before || fixture)
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
    javascript = fixture ? source : 'const nextTheme = "dark";'
  const bundle: BundleSource = {
    sourcePath,
    source,
    javascript,
    sourceMap: JSON.stringify({
      version: 3,
      sources: [sourcePath],
      sourcesContent: [source],
      names: [],
      mappings:
        options.mappings ?? (additionalStops.length ? 'AAAA,MAAM' : 'AAAA'),
    }),
    mapSource: sourcePath,
    scriptUrl: 'webpack-internal:///(app-pages-browser)/./src/theme.ts',
    chunkPath: join(repository.directory, '.next/dev/chunk.js'),
    chunkHash: '0'.repeat(64),
  }
  const releases: string[] = [],
    mouse: { type?: string; timeout?: number }[] = [],
    commands: string[] = [],
    listeners = new Map<string, (event: unknown) => void>()
  const timers = new Map<number, { at: number; callback: () => void }>()
  let clock = 0,
    timerId = 0,
    requestSequence = 0
  let emitInputPause = true,
    emitPreparationResume = false,
    stopAtStartupBreakpoint = false,
    removedAck = true,
    bound = false,
    rejectBinding = false,
    ready = true,
    beforeFailure: BeforeFailure = { conditionIndex: 0, reason: 'not-visible' },
    afterFailure: BeforeFailure | undefined,
    afterReadCount = 0,
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
  // A held wait for an accepted stop's own pause never times out until the test releases it.
  let sourceBoundWait: { released: boolean } | undefined
  // The failure the adapter answers a binding lookup with, as a session that ended does.
  let bindingLookupFailure: string | undefined
  let recordingObserver = (): ViewportRecordingObserver | undefined => undefined
  let rejectedCapture: string | undefined,
    requiredValueUnavailable = false,
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
              value: requiredValueUndefined ? 'undefined' : 'dark',
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
          // A line that ran only before its breakpoint existed never pauses again.
          if (emitNextPause)
            emitPause(
              laterStopBinding?.column ?? next.column,
              laterStopBinding?.line,
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
      // The first stop and every later one can each be reported at another position than requested; the learner's own breakpoint never is.
      const reported =
        owned?.id === 'owned-breakpoint'
          ? firstStopBinding
          : owned?.id.startsWith('owned-breakpoint-')
            ? laterStopBinding
            : undefined
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
      parameters?: { expression?: string; type?: string },
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
      }
      if (method === 'Runtime.evaluate')
        return {
          result: {
            value:
              parameters?.expression === 'location.href'
                ? 'about:blank'
                : parameters?.expression === 'location.origin'
                  ? 'http://127.0.0.1:4321'
                  : parameters?.expression === afterExpression &&
                      !run.view().operation?.inputDispatched
                    ? {
                        ready: false,
                        failure: { conditionIndex: 0, reason: 'not-visible' },
                      }
                    : ready
                      ? { ready: true, x: 12, y: 18 }
                      : { ready: false, failure: beforeFailure },
          },
        }
      if (method === 'Page.navigate') {
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
        return { scriptSource: javascript }
      if (method === 'Debugger.evaluateOnCallFrame') {
        try {
          return {
            result: {
              value: runInNewContext(parameters?.expression ?? '', {
                nextTheme: requiredValueUnavailable
                  ? { rejected: true }
                  : requiredValueUndefined
                    ? undefined
                    : 'dark',
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
        if (emitInputPause)
          emitPause(
            firstStopBinding?.column,
            firstStopBinding?.line ?? fixture?.declaredLine,
          )
        return pending
      }
      if (method === 'Page.addScriptToEvaluateOnNewDocument') return {}
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
            breakpoints: breakpoints.map((breakpoint) => ({
              line: breakpoint.location.range.start.line + 1,
              column: breakpoint.location.range.start.character + 1,
            })),
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
  const breakpointModule = await loadModule<
    typeof OwnedRepositoryBreakpointModule
  >(resolve(__dirname, '../../ownedRepositoryBreakpoint.js'), { vscode })
  const runtimeModule = await loadModule<typeof ConfiguredBrowserRunModule>(
    resolve(__dirname, '../../configuredBrowserRun.js'),
    {
      vscode,
      './ownedRepositoryBreakpoint': breakpointModule,
      './runtimeSupport/hostBrowser': {
        HostBrowser: class {
          async launch(
            configuration: DebugSession['configuration'],
          ): Promise<void> {
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
          }
        },
      },
      './runtimeSupport/cdp': { Cdp: { connect: async () => proxy } },
      './utils/readDevelopmentBundle': {
        readDevelopmentBundle: async () => ({ bundle, discovery: {} }),
      },
      './utils/assertDevelopmentWorkspace': {
        assertDevelopmentWorkspace: async () => undefined,
      },
      './utils/launchDevelopmentServer': {
        launchDevelopmentServer: () => ({
          ready: async () => {
            releases.push('application acquired')
            return 'http://127.0.0.1:4321'
          },
          close: async (): Promise<void> => {
            releases.push('application')
          },
        }),
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
            return waitUntil(read, description, 0, signal)
          }
          if (
            rejectBinding &&
            description.startsWith('a verified binding of declared stop')
          ) {
            signal?.throwIfAborted()
            await read()
            signal?.throwIfAborted()
            return waitUntil(read, description, 0, signal)
          }
          // A held wait for the accepted stop's own pause looks until the pause is there or the test releases it, then ends as its 3 s bound would.
          const heldWait = sourceBoundWait
          if (heldWait && description === SOURCE_BOUND_PAUSE_WAIT_DESCRIPTION) {
            for (;;) {
              signal?.throwIfAborted()
              const value = await read()
              if (value) return value
              if (heldWait.released)
                return waitUntil(read, description, 0, signal)
              await new Promise<void>((resolve) => {
                setImmediate(resolve)
              })
            }
          }
          return waitUntil(read, description, timeoutMs, signal)
        },
      },
    },
    {
      setTimeout: (callback: () => void, delay: number) => {
        const id = ++timerId
        timers.set(id, { at: clock + delay, callback })
        return id
      },
      clearTimeout: (id: number) => {
        timers.delete(id)
      },
    },
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
    rejectBreakpointBinding(): void {
      rejectBinding = true
    },
    /** Reports the first stop's verified binding, and its pause, at this position instead of the requested one. */
    bindFirstStopAt(line: number, column: number): void {
      firstStopBinding = { line, column }
    },
    /** Reports every later stop's verified binding, and its pause, at this position instead of the requested one. */
    bindLaterStopsAt(line: number, column: number): void {
      laterStopBinding = { line, column }
    },
    /** Keeps the run's wait for an accepted stop's own pause open instead of ending it after 3 s, so a test can tell a pause admitted at once from one adopted when that wait ends. @example const wait = harness.holdSourceBoundWait(); wait.release() */
    holdSourceBoundWait() {
      const held = { released: false }
      sourceBoundWait = held
      return {
        release: (): void => {
          held.released = true
        },
      }
    },
    /** Lets a continuation run on without the next declared stop ever pausing. */
    suppressNextPause(): void {
      emitNextPause = false
    },
    /** Makes the adapter answer every binding lookup of an owned breakpoint with this failure instead of a binding. */
    failBindingLookup(message: string): void {
      bindingLookupFailure = message
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
    advance(milliseconds: number): void {
      clock += milliseconds
      for (const [id, timer] of [...timers])
        if (timer.at <= clock) {
          timers.delete(id)
          timer.callback()
        }
    },
  }
}
