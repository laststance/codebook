import { readFile, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import type { TestContext } from 'node:test'

import { REPOSITORY_RUN_TIMEOUT_MS } from '../../constants'
import { StudyError } from '../../errors'
import type { RepositoryOperation } from '../../repositoryConfigSchemas'
import type { RuntimeControl } from '../../runtime'
import type { ProcessOutputEvent } from '../../utils/captureProcessOutput'

import { configuredRuntimeHarness } from './configuredRuntimeHarness'
import { ADD } from './routeHandlerRunHarness'
import type { ServerHit, ServerHitOrder } from './serverRenderParticipant'

/** The API file the harness declares its stop in, inside `apiServer.packageRoot`. */
export const API_STOP_FILE = 'apps/api/src/rpc/switches.ts'
/** The folder of the stand-in Expo app. */
export const API_APP_FOLDER = 'apps/app'
/** The port the API declares (the stand-in Expo web script declares 8081). */
export const API_PORT = 4100
/** The origin the stand-in page sends the API's requests to. */
export const API_ORIGIN = `http://localhost:${API_PORT}`

/** When the API's entry pause (`--inspect-brk`) reaches the run: `at-start` as soon as the debug session starts (before the run selected it), `during-subscribe` while the run subscribes the inspector channel, `manual` never (the test sends it). */
export type ApiEntryTiming = 'at-start' | 'during-subscribe' | 'manual'

/** Whether the inspector-side entry pause (`Debugger.paused` `Break on start`) arrives while the run subscribes the channel, before it releases the entry (`before-release`); E1 observed it beside the debug adapter's entry `stopped`. A test sends it after the release with `sendEntryCdpPause`. */
export type ApiEntryCdpPauseTiming = 'before-release'

/** What the stand-in `OwnedApiServer` does and what the run asked of it. */
export interface FakeApiServer {
  /** The ordered log of what the run did with the API and Metro: `check`, `launch`, `inspector-endpoint`, `verify`, `listen`, `kill-first`, `close`, `metro-start`. */
  events: string[]
  /** What the run gave `OwnedApiServer.check`. */
  checkInputs: {
    workspace: string
    secrets?: () => ReadonlySet<string>
    onOutput?: (event: ProcessOutputEvent) => void | Promise<void>
    onDebuggerDisconnectNotice?: () => void | Promise<void>
    privateRoots?: { workspace?: readonly string[]; home?: readonly string[] }
    declaration: { port: number }
  }[]
  /** Fails the next check with this refusal, as a taken port or a missing entry does. */
  checkFailure?: StudyError
  /** Fails the launch. */
  launchFailure?: Error
  /** Fails the inspector verification, as a foreign inspector does; the run retries a failed candidate until its wait ends. */
  verifyFailure?: Error
  /** Fails the lookup of the inspector's address, as a process that announced none does. */
  endpointFailure?: Error
  /** How the listener wait ends: at once, never (until the run is cancelled) or with this error. */
  listen: 'ok' | 'never' | StudyError
  /** Makes the normal close fail, as a group that outlives the stop deadline does. */
  closeFails: boolean
  /** Makes the kill-first fail, as a group that outlives the kill or whose identity cannot be confirmed does; the process keeps running. */
  killFails: boolean
  /** Ends the API process as the operating system reports it: the exit fact settles. */
  exit(
    exitCode: number | null,
    signal?: NodeJS.Signals | null,
    tail?: string,
  ): void
  /** Delivers one chunk of the API's output to the run, as the launcher does. */
  emitOutput(text: string, channel?: 'stdout' | 'stderr'): Promise<void>
  /** Tells the run what the launcher tells it once Node's debugger-disconnect notice was read on the raw stderr and the API is confirmed to be ending. */
  emitDisconnectNotice(): Promise<void>
  /** Whether the group was killed before anything else. */
  killedFirst: boolean
  /** What the stand-in's `outputTailNow` answers: the launcher's masked live tail. */
  outputTail: string
}

/**
 * Builds the stand-in of the `ownedApiServer` module a run loads, and the handle a test steers and reads it with.
 * Why it exists: run-level tests need the API's lifecycle (check, launch, inspector, listener, exit, kill, close) without starting a process; real Node and a real inspector are `ownedApiServer.test.ts`'s.
 * Called by {@link apiServerRunHarness}.
 * @returns The module stand-in and the handle.
 * @example const { module, fake } = createFakeApiServer()
 */
export function createFakeApiServer() {
  let settleExit: (fact: {
    exitCode: number | null
    signal: NodeJS.Signals | null
    outputTail: string
  }) => void = () => {}
  const exited = new Promise<{
    exitCode: number | null
    signal: NodeJS.Signals | null
    outputTail: string
  }>((resolve) => {
    settleExit = resolve
  })
  const fake: FakeApiServer = {
    events: [],
    checkInputs: [],
    listen: 'ok',
    closeFails: false,
    killFails: false,
    killedFirst: false,
    outputTail: '',
    exit: (exitCode, signal = null, tail = '') =>
      settleExit({ exitCode, signal, outputTail: tail }),
    emitOutput: async (text, channel = 'stdout') => {
      await fake.checkInputs[0]?.onOutput?.({
        sequence: 1,
        elapsedMs: 5,
        channel,
        text,
      })
    },
    emitDisconnectNotice: async () => {
      await fake.checkInputs[0]?.onDebuggerDisconnectNotice?.()
    },
  }
  const instance = (packageRoot: string, port: number) => ({
    pid: 4242,
    processGroup: 4242,
    packageRoot,
    port,
    inspectorEndpoint: async (): Promise<string> => {
      fake.events.push('inspector-endpoint')
      if (fake.endpointFailure) throw fake.endpointFailure
      return 'ws://127.0.0.1:1235/worker'
    },
    verifyInspector: async () => {
      fake.events.push('verify')
      if (fake.verifyFailure) throw fake.verifyFailure
      return {
        pid: 1235,
        processGroup: 4242,
        workspace: packageRoot,
        isMainThread: true,
        threadId: 0,
      }
    },
    waitForListener: async (signal: AbortSignal) => {
      fake.events.push('listen')
      if (fake.listen === 'never')
        return new Promise<never>((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(signal.reason)),
        )
      if (fake.listen !== 'ok') throw fake.listen
      return { host: '127.0.0.1' as const, port }
    },
    whenExited: () => exited,
    outputTailNow: () => fake.outputTail,
    exitError: async () =>
      new StudyError('SERVER_EXITED', 'The server exited.'),
    killIfPaused: async () => {
      fake.events.push('kill-first')
      if (fake.killFails) throw new Error('The API group could not be killed')
      fake.killedFirst = fake.events.indexOf('close') === -1
      fake.exit(null, 'SIGKILL')
      return exited
    },
    close: async () => {
      fake.events.push('close')
      if (fake.closeFails) throw new Error('The API group outlived the stop')
      fake.exit(null, 'SIGTERM')
      return exited
    },
  })
  const module = {
    OwnedApiServer: {
      check: async (input: {
        workspace: string
        declaration: { packageRoot: string; port: number }
        secrets?: () => ReadonlySet<string>
        onOutput?: (event: ProcessOutputEvent) => void | Promise<void>
        onDebuggerDisconnectNotice?: () => void | Promise<void>
        privateRoots?: {
          workspace?: readonly string[]
          home?: readonly string[]
        }
      }) => {
        fake.events.push('check')
        fake.checkInputs.push(input)
        if (fake.checkFailure) throw fake.checkFailure
        const packageRoot = join(input.workspace, input.declaration.packageRoot)
        return {
          resolved: {},
          launch: async () => {
            fake.events.push('launch')
            if (fake.launchFailure) throw fake.launchFailure
            return instance(packageRoot, input.declaration.port)
          },
        }
      },
    },
  }
  return { module, fake }
}

/** The harness of a run that declares `apiServer` ({@link apiServerRunHarness}). */
export type ApiServerRunHarness = Awaited<
  ReturnType<typeof apiServerRunHarness>
>

/** Builds the control the service gives a run; the whole-run deadline is far away so a test moves only the clock it means to. @example apiControl(context).runId // => 'service-run-99' */
function apiControl(context: TestContext): RuntimeControl {
  const abort = new AbortController()
  context.after(() => abort.abort())
  return {
    signal: abort.signal,
    deadlineAt: Date.now() + REPOSITORY_RUN_TIMEOUT_MS,
    preparationDeadlineAt: Date.now() + 300_000,
    runId: 'service-run-99',
  }
}

/**
 * Opens a version 3 run (`expo-web-dev` by default, `vite-dev` with `adapter`) that declares `apiServer` (`apps/api`, port 4100) beside an Expo app (`apps/app`), with one server stop in the API file after the given operations, one click operation, and the API's Node inspector scripted as a `pwa-node` session.
 * Why it exists: every run-level API test starts the same way; the options add what differs (the operations, the entry pause's timing, the stand-in API's behavior). The harness answers E1's recorded shapes: a `file://` script address, an inline map with an absolute source path, a pause on the declared line.
 * @param context - The test.
 * @param options - `stopOperations` names the `afterOperation` of each stop (default one stop after operation 1); `operations`; `entry` when the entry pause arrives (default `at-start`); `fake` preset behavior of the stand-in API; `apiPort` the declared API port; `adapter`, `vite` and `proxyPaths` for a `vite-dev` run; `extra` further harness options.
 * @returns The harness (not prepared) with `fake`, the stand-in API handle.
 * @example const harness = await apiServerRunHarness(context); await harness.run.prepare()
 */
export async function apiServerRunHarness(
  context: TestContext,
  options: {
    stopOperations?: number[]
    /** The `hold` each stop declares, the first stop first (API 1.43); a missing entry declares nothing. */
    stopHolds?: Array<'explain' | 'record' | undefined>
    operations?: RepositoryOperation[]
    entry?: ApiEntryTiming
    entryCdpPause?: ApiEntryCdpPauseTiming
    fake?: Partial<Pick<FakeApiServer, 'listen' | 'closeFails'>>
    apiPort?: number
    /** The adapter of the run (default `expo-web-dev`, so Cycle 0099 tests are unchanged). */
    adapter?: 'expo-web-dev' | 'vite-dev'
    /** The Vite stand-in's ports and `proxyPaths` of a `vite-dev` run (see `configuredRuntimeHarness`'s `apiServer.vite`). */
    vite?: NonNullable<
      NonNullable<
        NonNullable<Parameters<typeof configuredRuntimeHarness>[3]>['apiServer']
      >['vite']
    >
    proxyPaths?: string[]
    /** Further stops after the first (an API stop), such as a browser stop declared after it; their operations and participants come from `extra.operations`. */
    additionalStops?: Parameters<typeof configuredRuntimeHarness>[2]
    extra?: Partial<Parameters<typeof configuredRuntimeHarness>[3]>
  } = {},
) {
  const { module, fake } = createFakeApiServer()
  Object.assign(fake, options.fake)
  const stopOperations = options.stopOperations ?? [1]
  const entry = options.entry ?? 'at-start'
  let entryStopper: (() => void) | undefined
  let pausedListener: ((event: unknown) => void) | undefined
  const harness = await configuredRuntimeHarness(
    context,
    apiControl(context),
    options.additionalStops ?? [],
    {
      participant: 'server',
      adapter: options.adapter ?? 'expo-web-dev',
      packageRoot: API_APP_FOLDER,
      packageApp: { stopsOutside: true },
      serverRuntime: { route: null },
      entryPath: '/',
      realSourceRoot: true,
      sourcePath: API_STOP_FILE,
      apiServer: {
        declaration: {
          packageRoot: 'apps/api',
          entry: 'src/server.ts',
          port: options.apiPort ?? API_PORT,
          ...(options.proxyPaths ? { proxyPaths: options.proxyPaths } : {}),
        },
        module,
        ...(options.vite ? { vite: options.vite } : {}),
      },
      operations: {
        operations: options.operations ?? [ADD],
        stopOperations,
        ...(options.stopHolds ? { stopHolds: options.stopHolds } : {}),
        stopParticipants: stopOperations.map(() => 'server'),
      },
      // The entry pause of `--inspect-brk` reaches the run before the session is its participant.
      onServerDebuggingStarted: () => {
        if (entry === 'at-start') entryStopper?.()
      },
      onApplicationStart: () => fake.events.push('metro-start'),
      ...options.extra,
    },
  )
  // Keeps the run's `Debugger.paused` listener so the inspector-side entry pause can reach it.
  const proxy = harness.serverProxy!
  const registerListener = proxy.on.bind(proxy)
  proxy.on = (event: string, listener: (event: unknown) => void): void => {
    if (event === 'Debugger.paused') pausedListener = listener
    registerListener(event, listener)
  }
  const sendEntryCdpPause = (): void => pausedListener?.(ENTRY_CDP_PAUSE)
  entryStopper = (): void => sendEntryStop(harness)
  // The listener exists only once the run selected the server, so the pause is sent while it subscribes.
  if (options.entryCdpPause === 'before-release') {
    const subscribe = proxy.subscribe.bind(proxy)
    proxy.subscribe = async (): Promise<void> => {
      sendEntryCdpPause()
      await subscribe()
    }
  }
  if (entry === 'during-subscribe') {
    const subscribe = proxy.subscribe.bind(proxy)
    proxy.subscribe = async (): Promise<void> => {
      entryStopper?.()
      await subscribe()
    }
  }
  return {
    ...harness,
    fake,
    sendEntryStop: (): void => sendEntryStop(harness),
    sendEntryCdpPause,
  }
}

/** The inspector's report of the API's entry: js-debug names the reason `Break on start`, which the protocol's list does not. */
const ENTRY_CDP_PAUSE = {
  reason: 'Break on start',
  callFrames: [
    {
      callFrameId: 'api-entry-frame',
      functionName: '',
      location: {
        scriptId: 'api-entry-script',
        lineNumber: 0,
        columnNumber: 0,
      },
    },
  ],
}

/**
 * Sends the API's entry pause (`--inspect-brk`) to the run as the debug adapter's `stopped` event.
 * @param harness - The run's harness.
 * @example sendEntryStop(harness)
 */
function sendEntryStop(harness: {
  run: { onEvent(session: never, event: never): void }
  server?: { session: unknown }
}): void {
  const { run, server } = harness
  run.onEvent(
    server!.session as never,
    {
      type: 'event',
      seq: 1,
      event: 'stopped',
      body: {
        // E1's journal: js-debug's Node thread is 0.
        threadId: 0,
        reason: 'pause',
        description: 'Paused on debugger statement',
      },
    } as never,
  )
}

/**
 * Gives the text of an API module as tsx emits it: the generated code and one inline map whose source is the stop file's absolute path with its retained original.
 * @param stopPath - The stop file's real path.
 * @param original - The text the map retains; the file's own text unless a test changes it.
 * @param options - `withoutMap` leaves the map out; `mappings` replaces the one-position mapping.
 * @returns The script text `Debugger.getScriptSource` answers.
 * @example apiScriptText('/repo/apps/api/src/a.ts', 'var x = 1;\n') // 'const nextTheme = …//# sourceMappingURL=data:…'
 */
export function apiScriptText(
  stopPath: string,
  original: string,
  options: { withoutMap?: boolean; mappings?: string } = {},
): string {
  const generated = 'const nextTheme = "dark";'
  if (options.withoutMap) return generated
  const map = {
    version: 3,
    sources: [stopPath],
    sourcesContent: [original],
    names: [],
    mappings: options.mappings ?? 'AAAA',
  }
  return `${generated}\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(JSON.stringify(map)).toString('base64')}`
}

/**
 * Sends the hit of the API stop's breakpoint: the script is the stop file's tsx module (or the text the test gives), the pause names the stop's own breakpoint as js-debug does.
 * @param harness - The run's harness.
 * @param extra - Further fields of the hit; `scriptText` replaces the executed module's text.
 * @param order - Which channel arrives first (default CDP first).
 * @returns The number of the hit.
 * @example await apiServerHit(harness, {}, 'dap-first')
 */
export async function apiServerHit(
  harness: ApiServerRunHarness,
  extra: ServerHit & { scriptText?: string } = {},
  order?: ServerHitOrder,
): Promise<number> {
  const stopPath = await realpath(join(harness.directory, API_STOP_FILE))
  const original = await readFile(stopPath, 'utf8')
  const { scriptText, ...hit } = extra
  harness.server!.setScriptText(
    'server',
    scriptText ?? apiScriptText(stopPath, original),
  )
  return harness.server!.hit(
    {
      generated: { line: 0, column: 0 },
      hitBreakpoints: ['owned-breakpoint'],
      ...hit,
    },
    order,
  )
}

/**
 * Reports the start of a page request to the API origin, as the browser's `Network` event does.
 * @param harness - The run's harness.
 * @param request - Its id, method, path and the time it started (default now) with its monotonic timestamp (seconds).
 * @example sendApiRequest(harness, { id: '7', method: 'POST', path: '/api/rpc/switchTo' })
 */
export function sendApiRequest(
  harness: ApiServerRunHarness,
  request: {
    id: string
    method?: string
    path: string
    startedAtMs?: number
    timestamp?: number
    origin?: string
  },
): void {
  harness.emitPageEvent('Network.requestWillBeSent', {
    requestId: request.id,
    timestamp: request.timestamp ?? 100,
    wallTime: (request.startedAtMs ?? Date.now()) / 1000,
    request: {
      method: request.method ?? 'POST',
      url: `${request.origin ?? API_ORIGIN}${request.path}`,
    },
  })
}

/**
 * Reports the end of a page request, finished or failed.
 * @param harness - The run's harness.
 * @param id - The request's id.
 * @param timestamp - The event's monotonic timestamp in seconds.
 * @param failed - Whether the request failed instead of finishing.
 * @example endApiRequest(harness, '7', 100.2)
 */
export function endApiRequest(
  harness: ApiServerRunHarness,
  id: string,
  timestamp: number,
  failed = false,
): void {
  harness.emitPageEvent(
    failed ? 'Network.loadingFailed' : 'Network.loadingFinished',
    { requestId: id, timestamp },
  )
}
