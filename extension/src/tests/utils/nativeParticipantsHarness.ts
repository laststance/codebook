import { join, resolve } from 'node:path'
import type { TestContext } from 'node:test'
import type { DebugSession } from 'vscode'
import { sha256 } from '../../runtimeSupport/utils/sha256'
import { crossRuntimeRepositoryConfigSchema } from '../../repositoryConfigSchemas'
import { configuredDefinitionSchema } from '../../configuredStudySchemas'
import type { ConfiguredBrowserRun } from '../../configuredBrowserRun'
import type { ViewportRecordingObserver } from '../../runtimeSupport/browserViewport'
import type { Participant } from '../../runtime'
import { configuredStops } from '../../utils/configuredStops'
import { configuredDomExpression } from '../../utils/configuredDomExpression'
import { createCrossRuntimeStudy } from './createCrossRuntimeStudy'
import { repositoryHarness } from './repositoryHarness'
import { loadModule } from './loadModule'

/** Exercises the real coordinator using two controlled native transports and inert source records; never native product proof. @example const harness = await nativeParticipantsHarness(context); await harness.run.prepare() */
export async function nativeParticipantsHarness(
  context: TestContext,
  stopParticipants: readonly Participant[] = ['server', 'browser', 'server'],
  options: {
    duplicateServerSession?: boolean
    distinctServerWorker?: boolean
  } = {},
) {
  let owned: ConfiguredBrowserRun | undefined
  let recordingObserver = (): ViewportRecordingObserver | undefined => undefined
  context.after(async () => {
    await owned?.stop()
  })
  const repository = await repositoryHarness(context),
    history = createCrossRuntimeStudy()
  const original = configuredStops(history.configuration),
    server = original[1]!,
    browser = original[0]!
  const configuration = crossRuntimeRepositoryConfigSchema.parse({
    ...history.configuration,
    version: 2 as const,
    participant: 'server' as const,
    source: server.source,
    inspections: server.inspections,
    book: { ...history.configuration.book, anchorIndex: server.anchorIndex },
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
  let pausedLine = 1
  let inputResolve = () => {},
    heldResponse: (() => void) | undefined,
    holdResponse = false
  let revokeDuringDom = false,
    afterReadyBeforeInput = false
  const afterExpression = configuredDomExpression(
    definition.configuration.action.after,
  )
  let badWorker = false,
    failedRegistration = false,
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
        mappings: 'AAAA',
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
              source: { path: bundle(name).sourcePath },
              line: pausedLine,
              column: 1,
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
        if (stops[currentIndex]) emitPause(stops[currentIndex]!.participant)
        else inputResolve()
        if (holdResponse)
          await new Promise<void>((resolve) => {
            heldResponse = resolve
          })
        return {}
      }
      throw new Error(`Unexpected native command: ${command}`)
    },
    getDebugProtocolBreakpoint: async (breakpoint) =>
      breakpoints.some((current) => current.id === breakpoint.id)
        ? {
            id: breakpoint.id.length,
            verified: !unboundPause,
            line: 1,
            column: 1,
            source: {
              path: foreignBinding
                ? '/foreign/source.ts'
                : bundle(name).sourcePath,
            },
          }
        : undefined,
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
  const emitPause = (name: Participant) => {
    // Server code is first loaded by application input, never imported during preparation.
    emitScript(name)
    listeners[name].get('Debugger.paused')?.({
      reason: 'other',
      hitBreakpoints: ['native'],
      callFrames: [
        {
          callFrameId: name,
          location: { scriptId: name, lineNumber: 0, columnNumber: 0 },
        },
      ],
    })
    run.onEvent(sessions[name], {
      type: 'event',
      seq: ++sequence,
      event: 'stopped',
      body: { reason: 'breakpoint', threadId: 1 },
    })
  }
  const proxy = (name: Participant) => ({
    name,
    closed: false,
    onClose: undefined as (() => void) | undefined,
    on(event: string, listener: (event: unknown) => void) {
      listeners[name].set(event, listener)
    },
    async subscribe() {},
    aggregateScreencastTelemetry() {},
    close() {
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
        emitPause(stops[0]!.participant)
        return pending
      }
      throw new Error(`Unexpected inspector method: ${method}`)
    },
  })
  const proxies = { browser: proxy('browser'), server: proxy('server') }
  const parentServerProxy = proxy('server')
  let serverProxyConnections = 0
  const acknowledge = (sourcePath: string) => {
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
            verified: false,
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
      addBreakpoints(added: Breakpoint[]) {
        breakpoints.push(...added)
        queueMicrotask(() => {
          for (const breakpoint of added)
            acknowledge(breakpoint.location.uri.fsPath)
        })
      },
      removeBreakpoints(removed: Breakpoint[]) {
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
      async stopDebugging(selected: DebugSession) {
        released.push(selected.id)
        run.terminated(selected)
        if (selected === root) run.terminated(sessions.browser)
        if (selected === serverParent && serverChild)
          run.terminated(serverChild)
      },
    },
  }
  const ownedBreakpoint = await loadModule<
    typeof import('../../ownedRepositoryBreakpoint')
  >(resolve(__dirname, '../../ownedRepositoryBreakpoint.js'), { vscode })
  const module = await loadModule<typeof import('../../configuredBrowserRun')>(
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
          async launch(config: DebugSession['configuration']) {
            Object.assign(root.configuration, config)
            run.addSession(root)
            run.addSession(sessions.browser)
          }
          async attachViewport() {}
          async reveal() {}
          resumeViewport() {}
          recordCapture(data: string, phase: string) {
            const observer = recordingObserver()
            observer?.frame({
              data,
              phase,
              kind: 'phase',
              elapsedMs: observer.elapsedMs(),
            })
          }
          async drainAcquisitions() {}
          async presentCapture(data: string) {
            return {
              epoch: 'test',
              id: 1,
              hash: sha256(Buffer.from(data, 'base64')),
            }
          }
          async close() {
            released.push('browser')
          }
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
              if (badWorker || candidate.name !== 'server')
                throw new Error('Foreign worker')
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
            close: async () => {
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
    observeRecording(observer: () => ViewportRecordingObserver | undefined) {
      recordingObserver = observer
    },
    revokeDuringDomCheck() {
      revokeDuringDom = true
    },
    satisfyAfterBeforeInput() {
      afterReadyBeforeInput = true
    },
    failRegistration() {
      failedRegistration = true
    },
    changeExecutedSource() {
      badSource = true
    },
    leavePauseUnbound() {
      unboundPause = true
    },
    bindForeignSource() {
      foreignBinding = true
    },
    revokeServerRegistration() {
      failedRegistration = true
      acknowledge(bundle('server').sourcePath)
    },
    holdContinueResponse() {
      holdResponse = true
    },
    releaseContinueResponse() {
      holdResponse = false
      heldResponse?.()
    },
    emitResume(name: Participant) {
      listeners[name].get('Debugger.resumed')?.({})
    },
    // A changed native frame must not inherit a previously captured source pause.
    movePausedFrame(line: number) {
      pausedLine = line
    },
    emitBrowserAdapterPause() {
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
