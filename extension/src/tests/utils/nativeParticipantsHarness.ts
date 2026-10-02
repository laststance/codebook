import { join, resolve } from 'node:path'
import type { TestContext } from 'node:test'

import type { DebugSession } from 'vscode'

import type { ConfiguredBrowserRun } from '../../configuredBrowserRun'
import type * as ConfiguredBrowserRunModule from '../../configuredBrowserRun'
import { configuredDefinitionSchema } from '../../configuredStudySchemas'
import type * as OwnedRepositoryBreakpointModule from '../../ownedRepositoryBreakpoint'
import { crossRuntimeRepositoryConfigSchema } from '../../repositoryConfigSchemas'
import type { Participant } from '../../runtime'
import type { ViewportRecordingObserver } from '../../runtimeSupport/browserViewport'
import { sha256 } from '../../runtimeSupport/utils/sha256'
import { waitUntil } from '../../runtimeSupport/utils/waitUntil'
import { configuredDomExpression } from '../../utils/configuredDomExpression'
import { configuredStops } from '../../utils/configuredStops'

import { createCrossRuntimeStudy } from './createCrossRuntimeStudy'
import { loadModule } from './loadModule'
import { repositoryHarness } from './repositoryHarness'

/** Exercises the real coordinator using two controlled native transports and inert source records; never native product proof. @example const harness = await nativeParticipantsHarness(context); await harness.run.prepare() */
export async function nativeParticipantsHarness(
  context: TestContext,
  stopParticipants: readonly Participant[] = ['server', 'browser', 'server'],
  options: {
    duplicateServerSession?: boolean
    distinctServerWorker?: boolean
    /** Declares a participant's stops at another column of line 1 than the default 1:1, to model a request the debugger binds elsewhere on the line. */
    declaredColumn?: Partial<Record<Participant, number>>
    /** Replaces a participant's sealed map; the default maps only generated 0:0 to source 1:1. */
    mappings?: Partial<Record<Participant, string>>
  } = {},
) {
  let owned: ConfiguredBrowserRun | undefined
  let recordingObserver = (): ViewportRecordingObserver | undefined => undefined
  context.after(async () => {
    await owned?.stop()
  })
  const repository = await repositoryHarness(context),
    history = createCrossRuntimeStudy()
  const original = configuredStops(history.configuration)
  const declared = (stop: (typeof original)[number]) => ({
    ...stop,
    source: {
      ...stop.source,
      column: options.declaredColumn?.[stop.participant] ?? stop.source.column,
    },
  })
  const server = declared(original[1]!),
    browser = declared(original[0]!),
    first = stopParticipants[0] === 'browser' ? browser : server
  const configuration = crossRuntimeRepositoryConfigSchema.parse({
    ...history.configuration,
    version: 2 as const,
    participant: first.participant,
    source: first.source,
    inspections: first.inspections,
    book: { ...history.configuration.book, anchorIndex: first.anchorIndex },
    additionalStops: stopParticipants
      .slice(1)
      .map((participant) => (participant === 'server' ? server : browser)),
  })
  const definition = configuredDefinitionSchema.parse({
    configuration,
    configurationHash: sha256(JSON.stringify(configuration)),
    descriptor: history.descriptor,
  })
  for (const source of definition.descriptor.sources)
    await repository.track(source.path, source.text)
  const stops = configuredStops(definition.configuration)
  const listeners: Record<
    Participant,
    Map<string, (event: unknown) => void>
  > = { browser: new Map(), server: new Map() }
  const commands: { participant: Participant; method: string }[] = [],
    released: string[] = []
  const identities: Participant[] = [],
    launches: DebugSession['configuration'][] = []
  let run: ConfiguredBrowserRun,
    sequence = 0,
    breakpointNumber = 0,
    currentIndex = 0
  let pausedLine = 1,
    pausedColumn = 1
  let pausedPath: string | undefined
  let heldBindingLookup: { wait: Promise<void>; entered(): void } | undefined
  // What the adapter reports as each participant's verified binding; the declaration may ask for another column.
  const boundAt: Record<Participant, { line: number; column: number }> = {
    browser: { line: 1, column: 1 },
    server: { line: 1, column: 1 },
  }
  let acknowledgedAt: { line: number; column: number } | undefined,
    browserLineRunsOnInput = false,
    reboundPauseId = false
  let inputResolve = (): void => {},
    heldResponse: (() => void) | undefined,
    holdResponse = false
  // Event controls for a test that sends the adapter's own pauses between the declared ones.
  let nextPauseHeld = false,
    inputHeld = false,
    sourceBoundWaitExpired = false
  // Where each participant's declared pause is reported in the generated module; 0:0 maps to the declared 1:1.
  const pausedAt: Record<
    Participant,
    { lineNumber: number; columnNumber: number }
  > = {
    browser: { lineNumber: 0, columnNumber: 0 },
    server: { lineNumber: 0, columnNumber: 0 },
  }
  let revokeDuringDom = false,
    afterReadyBeforeInput = false
  const afterExpression = configuredDomExpression(
    definition.configuration.action.after,
  )
  let failedRegistration = false,
    badSource = false,
    unboundPause = false,
    foreignBinding = false
  const bundle = (name: Participant) => {
    const stop =
      stops.find((stop) => stop.participant === name) ??
      (name === 'browser' ? browser : server)
    const source = definition.descriptor.sources.find(
      (source) => source.path === stop.source.path,
    )!
    const sourcePath = join(repository.directory, source.path)
    return {
      sourcePath,
      source: source.text,
      javascript: source.text,
      sourceMap: JSON.stringify({
        version: 3,
        sources: [sourcePath],
        sourcesContent: [source.text],
        names: [],
        mappings: options.mappings?.[name] ?? 'AAAA',
      }),
      mapSource: sourcePath,
      scriptUrl: `webpack-internal:///(${name === 'server' ? 'action-browser' : 'app-pages-browser'})/./${source.path}`,
      chunkPath: join(repository.directory, '.next/dev/chunk.js'),
      chunkHash: '0'.repeat(64),
    }
  }
  type Breakpoint = {
    id: string
    location: {
      uri: { fsPath: string }
      range: { start: { line: number; character: number } }
    }
  }
  const breakpoints: Breakpoint[] = []
  const root: DebugSession = {
    id: 'browser-root',
    type: 'pwa-chrome',
    name: 'root',
    workspaceFolder: undefined,
    configuration: { type: 'pwa-chrome', name: '', request: 'launch' },
    customRequest: async () => undefined,
    getDebugProtocolBreakpoint: async () => undefined,
  }
  const session = (name: Participant): DebugSession => ({
    ...root,
    id: `${name}-session`,
    type: name === 'server' ? 'pwa-node' : 'pwa-chrome',
    parentSession: name === 'browser' ? root : undefined,
    configuration: { ...root.configuration },
    customRequest: async (command, args) => {
      commands.push({ participant: name, method: command })
      if (command === 'requestCDPProxy')
        return {
          host: '127.0.0.1',
          port: name === 'server' ? 1235 : 1234,
          path: `/${name}`,
        }
      if (command === 'stackTrace')
        return {
          stackFrames: [
            {
              id: 1,
              name: `${name}Step`,
              source: { path: pausedPath ?? bundle(name).sourcePath },
              line: pausedLine,
              column: pausedColumn,
            },
          ],
        }
      if (command === 'scopes')
        return { scopes: [{ name: 'Local', variablesReference: 10 }] }
      if (command === 'variables')
        return {
          variables: [
            {
              name: name === 'server' ? 'mode' : 'nextTheme',
              value: name === 'server' ? 'display' : 'dark',
              variablesReference: 0,
            },
          ],
        }
      if (command === 'continue') {
        run.onRequest(sessions[name], {
          type: 'request',
          seq: ++sequence,
          command,
          arguments: args,
        })
        run.onEvent(sessions[name], {
          type: 'event',
          seq: ++sequence,
          event: 'continued',
          body: { threadId: 1 },
        })
        listeners[name].get('Debugger.resumed')?.({})
        currentIndex++
        const next = stops[currentIndex]
        // A held next pause or input is released by the test, after the events it sends in between.
        if (next && !nextPauseHeld) emitPause(next.participant)
        if (!next && !inputHeld) inputResolve()
        if (holdResponse)
          await new Promise<void>((resolve) => {
            heldResponse = resolve
          })
        return {}
      }
      throw new Error(`Unexpected native command: ${command}`)
    },
    getDebugProtocolBreakpoint: async (breakpoint) => {
      const held = heldBindingLookup
      if (held) {
        heldBindingLookup = undefined
        held.entered()
        await held.wait
      }
      return breakpoints.some((current) => current.id === breakpoint.id)
        ? {
            id: breakpoint.id.length + (reboundPauseId ? 1 : 0),
            verified: !unboundPause,
            line: boundAt[name].line,
            column: boundAt[name].column,
            source: {
              path: foreignBinding
                ? '/foreign/source.ts'
                : bundle(name).sourcePath,
            },
          }
        : undefined
    },
  })
  const serverParent = session('server')
  const serverChild: DebugSession | undefined = options.duplicateServerSession
    ? {
        ...serverParent,
        id: 'server-child',
        parentSession: serverParent,
        configuration: { ...serverParent.configuration },
      }
    : undefined
  const sessions: Record<Participant, DebugSession> = {
    browser: session('browser'),
    server: serverChild ?? serverParent,
  }
  const emitScript = (name: Participant) =>
    listeners[name].get('Debugger.scriptParsed')?.({
      scriptId: name,
      url: bundle(name).scriptUrl,
      executionContextId: 1,
    })
  const emitDeclaredPause = (name: Participant): void => {
    // Server code is first loaded by application input, never imported during preparation.
    emitScript(name)
    listeners[name].get('Debugger.paused')?.({
      reason: 'other',
      hitBreakpoints: ['native'],
      callFrames: [
        {
          callFrameId: name,
          location: { scriptId: name, ...pausedAt[name] },
        },
      ],
    })
  }
  const emitStopped = (name: Participant): void => {
    run.onEvent(sessions[name], {
      type: 'event',
      seq: ++sequence,
      event: 'stopped',
      body: { reason: 'breakpoint', threadId: 1 },
    })
  }
  const emitPause = (name: Participant): void => {
    emitDeclaredPause(name)
    emitStopped(name)
  }
  const proxy = (name: Participant) => ({
    name,
    closed: false,
    onClose: undefined as (() => void) | undefined,
    on(event: string, listener: (event: unknown) => void): void {
      listeners[name].set(event, listener)
    },
    async subscribe(): Promise<void> {},
    aggregateScreencastTelemetry(): void {},
    close(): void {
      if (this.closed) return
      this.closed = true
      released.push(`${name} proxy`)
      inputResolve()
      heldResponse?.()
      this.onClose?.()
    },
    async request(
      method: string,
      parameters?: { expression?: string; type?: string },
    ) {
      commands.push({ participant: name, method })
      if (
        name === 'server' &&
        (method.startsWith('Page.') || method.startsWith('Input.'))
      )
        throw new Error('Application input/video reached server proxy')
      if (
        method === 'Runtime.evaluate' &&
        revokeDuringDom &&
        parameters?.expression !== 'location.origin'
      ) {
        revokeDuringDom = false
        failedRegistration = true
        acknowledge(bundle('server').sourcePath)
      }
      if (method === 'Runtime.evaluate')
        return {
          result: {
            value:
              parameters?.expression === 'location.href'
                ? 'about:blank'
                : parameters?.expression === 'location.origin'
                  ? 'http://127.0.0.1:4321'
                  : parameters?.expression === afterExpression
                    ? {
                        ready:
                          afterReadyBeforeInput ||
                          Boolean(run.view().operation?.inputDispatched),
                      }
                    : { ready: true, x: 12, y: 18 },
          },
        }
      if (method === 'Page.navigate') {
        emitScript('browser')
        return {}
      }
      if (method === 'Debugger.getScriptSource')
        return {
          scriptSource: badSource
            ? 'different module'
            : bundle(name).javascript,
        }
      if (method === 'Debugger.evaluateOnCallFrame')
        return {
          result: {
            value: parameters?.expression?.startsWith('typeof ')
              ? 'function'
              : name === 'server'
                ? 'display'
                : 'dark',
          },
        }
      if (method === 'Page.captureScreenshot')
        return {
          data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRFEAAAAASUVORK5CYII=',
        }
      if (method === 'Input.dispatchMouseEvent') {
        if (parameters?.type === 'mousePressed') return {}
        const pending = new Promise<void>((resolve) => {
          inputResolve = resolve
        })
        // The click re-renders the component at once; the line pauses only where a breakpoint is installed for it at that moment.
        if (
          browserLineRunsOnInput &&
          breakpoints.some(
            (breakpoint) =>
              breakpoint.location.uri.fsPath === bundle('browser').sourcePath,
          )
        ) {
          // Order recorded in the installed trial: the adapter's stopped event, then the inspector's pause.
          run.onEvent(sessions.browser, {
            type: 'event',
            seq: ++sequence,
            event: 'stopped',
            body: { reason: 'breakpoint', threadId: 1 },
          })
          emitScript('browser')
          listeners.browser.get('Debugger.paused')?.({
            reason: 'other',
            hitBreakpoints: ['native'],
            callFrames: [
              {
                callFrameId: 'browser',
                location: {
                  scriptId: 'browser',
                  lineNumber: 0,
                  columnNumber: 0,
                },
              },
            ],
          })
        }
        emitPause(stops[0]!.participant)
        return pending
      }
      throw new Error(`Unexpected inspector method: ${method}`)
    },
  })
  const proxies = { browser: proxy('browser'), server: proxy('server') }
  const parentServerProxy = proxy('server')
  let serverProxyConnections = 0
  const acknowledge = (sourcePath: string): void => {
    for (const name of ['browser', 'server'] as const) {
      const selected = breakpoints.filter(
          (breakpoint) => breakpoint.location.uri.fsPath === sourcePath,
        ),
        requestSequence = ++sequence
      run.onRequest(sessions[name], {
        type: 'request',
        seq: requestSequence,
        command: 'setBreakpoints',
        arguments: {
          source: { path: sourcePath },
          breakpoints: selected.map((breakpoint) => ({
            line: breakpoint.location.range.start.line + 1,
            column: breakpoint.location.range.start.character + 1,
          })),
        },
      })
      run.onResponse(sessions[name], {
        type: 'response',
        seq: ++sequence,
        command: 'setBreakpoints',
        request_seq: requestSequence,
        success: !failedRegistration,
        body: {
          breakpoints: selected.map((breakpoint) => ({
            id: breakpoint.id.length,
            // A module that is already loaded is acknowledged as verified, at the position the adapter chose.
            ...(acknowledgedAt
              ? { verified: true, ...acknowledgedAt }
              : { verified: false }),
          })),
        },
      })
    }
  }
  const vscode = {
    workspace: { textDocuments: [], getWorkspaceFolder: () => undefined },
    Uri: { file: (path: string) => ({ fsPath: path }) },
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
      readonly id = `breakpoint-${++breakpointNumber}`
      constructor(readonly location: unknown) {}
    },
    debug: {
      breakpoints,
      addBreakpoints(added: Breakpoint[]): void {
        breakpoints.push(...added)
        queueMicrotask(() => {
          for (const breakpoint of added)
            acknowledge(breakpoint.location.uri.fsPath)
        })
      },
      removeBreakpoints(removed: Breakpoint[]): void {
        for (const breakpoint of removed) {
          const index = breakpoints.findIndex(
            (candidate) => candidate.id === breakpoint.id,
          )
          if (index >= 0) breakpoints.splice(index, 1)
        }
        queueMicrotask(() => {
          for (const breakpoint of removed)
            acknowledge(breakpoint.location.uri.fsPath)
        })
      },
      async startDebugging(
        _folder: unknown,
        config: DebugSession['configuration'],
      ) {
        launches.push(config)
        Object.assign(serverParent.configuration, config)
        run.addSession(serverParent)
        if (serverChild) run.addSession(serverChild)
        return true
      },
      async stopDebugging(selected: DebugSession): Promise<void> {
        released.push(selected.id)
        run.terminated(selected)
        if (selected === root) run.terminated(sessions.browser)
        if (selected === serverParent && serverChild)
          run.terminated(serverChild)
      },
    },
  }
  const ownedBreakpoint = await loadModule<
    typeof OwnedRepositoryBreakpointModule
  >(resolve(__dirname, '../../ownedRepositoryBreakpoint.js'), { vscode })
  const module = await loadModule<typeof ConfiguredBrowserRunModule>(
    resolve(__dirname, '../../configuredBrowserRun.js'),
    {
      vscode,
      './ownedRepositoryBreakpoint': ownedBreakpoint,
      './runtimeSupport/cdp': {
        Cdp: {
          connect: async (url: string) => {
            if (!url.endsWith('/server')) return proxies.browser
            // Native adapters can expose the same worker through a parent and child session.
            return options.duplicateServerSession &&
              serverProxyConnections++ === 0
              ? parentServerProxy
              : proxies.server
          },
        },
      },
      './runtimeSupport/hostBrowser': {
        HostBrowser: class {
          async launch(config: DebugSession['configuration']): Promise<void> {
            Object.assign(root.configuration, config)
            run.addSession(root)
            run.addSession(sessions.browser)
          }
          async attachViewport(): Promise<void> {}
          async reveal(): Promise<void> {}
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
          async drainAcquisitions(): Promise<void> {}
          async presentCapture(data: string) {
            return {
              epoch: 'test',
              id: 1,
              hash: sha256(Buffer.from(data, 'base64')),
            }
          }
          async close(): Promise<void> {
            released.push('browser')
          }
        },
      },
      './runtimeSupport/utils/waitUntil': {
        waitUntil: async <Value>(
          read: () => Value | Promise<Value>,
          description: string,
          timeoutMs?: number,
          signal?: AbortSignal,
        ) => {
          // The capture bound is 3 s of real time; a test of its expiry looks once and then lets the real timeout contract end the wait.
          if (
            sourceBoundWaitExpired &&
            description === 'source-bound CDP stop'
          ) {
            signal?.throwIfAborted()
            const value = await read()
            signal?.throwIfAborted()
            if (value) return value
            return waitUntil(read, description, 0, signal)
          }
          return waitUntil(read, description, timeoutMs, signal)
        },
      },
      './utils/readDevelopmentBundle': {
        readDevelopmentBundle: async (
          _workspace: string,
          _source: unknown,
          _signal: AbortSignal,
          _entry: string,
          execution: string,
        ) => ({
          bundle: bundle(execution === 'server-action' ? 'server' : 'browser'),
          discovery: {},
        }),
      },
      './utils/assertDevelopmentWorkspace': {
        assertDevelopmentWorkspace: async () => undefined,
      },
      './utils/launchDevelopmentServer': {
        launchDevelopmentServer: (
          _workspace: string,
          _node: string,
          _log: unknown,
          inspect: boolean,
        ) => {
          if (!inspect) throw new Error('Server inspection not requested')
          return {
            ready: async () => 'http://127.0.0.1:4321',
            inspectorEndpoint: async () => 'ws://127.0.0.1:1235/worker',
            verifyInspector: async (candidate: typeof proxies.server) => {
              identities.push(candidate.name)
              if (candidate.name !== 'server') throw new Error('Foreign worker')
              return {
                pid:
                  options.distinctServerWorker &&
                  candidate === parentServerProxy
                    ? 1236
                    : 1235,
                processGroup: 1234,
                workspace: repository.directory,
              }
            },
            close: async (): Promise<void> => {
              released.push('application')
            },
          }
        },
      },
    },
  )
  run = owned = new module.ConfiguredBrowserRun({
    directory: join(repository.directory, '.runtime'),
    workspace: repository.directory,
    node: process.execPath,
    definition,
    host: {
      id: 'vscode',
      productVersion: 'test',
      apiVersion: 'test',
      commit: 'test',
    },
    assertWorkspace() {},
    revealSource: async () => {},
  })
  return {
    ...repository,
    run,
    definition,
    commands,
    released,
    identities,
    launches,
    breakpoints,
    sessions,
    proxies,
    parentServerProxy,
    emitPause,
    observeRecording(
      observer: () => ViewportRecordingObserver | undefined,
    ): void {
      recordingObserver = observer
    },
    revokeDuringDomCheck(): void {
      revokeDuringDom = true
    },
    satisfyAfterBeforeInput(): void {
      afterReadyBeforeInput = true
    },
    failRegistration(): void {
      failedRegistration = true
    },
    changeExecutedSource(): void {
      badSource = true
    },
    leavePauseUnbound(): void {
      unboundPause = true
    },
    bindForeignSource(): void {
      foreignBinding = true
    },
    revokeServerRegistration(): void {
      failedRegistration = true
      acknowledge(bundle('server').sourcePath)
    },
    holdContinueResponse(): void {
      holdResponse = true
    },
    releaseContinueResponse(): void {
      holdResponse = false
      heldResponse?.()
    },
    emitResume(name: Participant): void {
      listeners[name].get('Debugger.resumed')?.({})
    },
    /** Keeps a continuation from announcing the next declared stop, so a test can send other events first and then release the stop's two notifications in the order it needs. @example const next = harness.holdNextPause(); next.stopped(); next.paused() */
    holdNextPause() {
      nextPauseHeld = true
      return {
        /** Sends the held stop's DAP `stopped` alone. */
        stopped: (): void => emitStopped(stops[currentIndex]!.participant),
        /** Announces the held stop's module and sends its runtime pause alone. */
        paused: (): void => emitDeclaredPause(stops[currentIndex]!.participant),
      }
    },
    /** Keeps the input acknowledgement back after the last continuation, so a test can send events while the after conditions are still open. */
    holdInput(): void {
      inputHeld = true
    },
    releaseInput(): void {
      inputHeld = false
      inputResolve()
    },
    /** Reports a participant's declared pauses at this generated position instead of 0:0, as a breakpoint the debugger bound elsewhere in the module does. */
    pauseAt(name: Participant, lineNumber: number, columnNumber: number): void {
      pausedAt[name] = { lineNumber, columnNumber }
    },
    /** Announces a further script of a participant, as the runtime does for every module it parses. */
    announceScript(name: Participant, scriptId: string, url: string): void {
      listeners[name].get('Debugger.scriptParsed')?.({
        scriptId,
        url,
        executionContextId: 1,
      })
    },
    /** Reports a runtime pause with no debugger stop at a chosen generated place, as the debug adapter's own breakpoints and hooks arrive. */
    emitUnannouncedPause(
      name: Participant,
      place: {
        scriptId: string
        lineNumber: number
        columnNumber: number
        functionName: string
        hitBreakpoints: string[]
      },
    ): void {
      listeners[name].get('Debugger.paused')?.({
        reason: 'other',
        hitBreakpoints: place.hitBreakpoints,
        callFrames: [
          {
            callFrameId: 'adapter-frame',
            functionName: place.functionName,
            location: {
              scriptId: place.scriptId,
              lineNumber: place.lineNumber,
              columnNumber: place.columnNumber,
            },
          },
        ],
      })
    },
    /** Ends the wait for an accepted stop's own pause after one look, as its 3 s bound would. */
    expireSourceBoundWait(): void {
      sourceBoundWaitExpired = true
    },
    // A changed native frame must not inherit a previously captured source pause.
    movePausedFrame(line: number, column = 1): void {
      pausedLine = line
      pausedColumn = column
    },
    /** Reports the paused top frame in this file instead of the stop's own source. */
    movePausedFrameToFile(path: string): void {
      pausedPath = path
    },
    /** Keeps the adapter's next binding lookup unanswered until released, so a test can act while a paused stop's bound position is still unknown. @example const lookup = harness.holdBindingLookup(); await lookup.started; lookup.release() */
    holdBindingLookup() {
      let release = (): void => {},
        entered = (): void => {}
      const started = new Promise<void>((resolve) => {
          entered = resolve
        }),
        wait = new Promise<void>((resolve) => {
          release = resolve
        })
      heldBindingLookup = { wait, entered }
      return { started, release }
    },
    /** Reports a participant's verified binding at this position instead of 1:1. */
    bindAt(name: Participant, line: number, column: number): void {
      boundAt[name] = { line, column }
    },
    /** Acknowledges later registrations as verified at this position, as an adapter does for a module that is already loaded. */
    acknowledgeRegistrationsAt(line: number, column: number): void {
      acknowledgedAt = { line, column }
    },
    /** Makes the click execute the browser stop's line before the first declared stop pauses. */
    runBrowserLineOnInput(): void {
      browserLineRunsOnInput = true
    },
    /** Reports the paused binding under another adapter id than the acknowledged registration. */
    rebindPauseId(): void {
      reboundPauseId = true
    },
    emitBrowserAdapterPause(): void {
      listeners.browser.get('Debugger.paused')?.({
        reason: 'other',
        hitBreakpoints: ['adapter-internal'],
        callFrames: [
          {
            callFrameId: 'adapter',
            location: {
              scriptId: 'adapter-internal',
              lineNumber: 0,
              columnNumber: 0,
            },
          },
        ],
      })
    },
  }
}
