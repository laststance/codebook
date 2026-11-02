import { setTimeout as sleep } from 'node:timers/promises'

import type { DebugSession } from 'vscode'

import type { ConfiguredBrowserRun } from '../../configuredBrowserRun'
import { SERVER_RENDER_ROUTE_EXPRESSION } from '../../constants'

import { debuggerPausedEvent } from './debuggerPausedEvent'

/** The adapter id of the first editor breakpoint the server session acknowledges; later ones count up from it. */
const FIRST_SERVER_ADAPTER_BREAKPOINT_ID = 40

/** What the stand-in work store answers when the run reads the route of a paused frame. */
export type ServerRouteAnswer =
  | string
  /** The store is absent on the frame (`undefined`): an unreadable route. */
  | null
  /** The adapter never answers the route read (until the run ends). */
  | 'no-answer'
  /** The `evaluate` request fails with this message. */
  | { error: string }
  /** The answer comes after this many milliseconds, then reads as the route. */
  | { route: string; afterMs: number }

/** One hit of an armed server breakpoint, as the spike's logs show it. */
export interface ServerHit {
  /** The script the top frame is in; a script not announced yet is announced at the sealed address. Default `server`. */
  scriptId?: string
  /** The generated place of the pause (zero-based); default 0:0, which the harness's default map sends to source 1:1. */
  generated?: { line: number; column: number }
  /** The source line and column the DAP stack frame reports (one-based); default 1:1. */
  source?: { line: number; column: number }
  /** What the work store answers on this frame; default the participant's default route. */
  route?: ServerRouteAnswer
  /**
   * The script was parsed before the run subscribed, as in a saved-session run whose warm-up load renders the entry route before the debugger attaches: it is never announced by `Debugger.scriptParsed`, and `Debugger.getScriptSource` answers the sealed text ending with `//# sourceURL=<url>`.
   * `url` defaults to the sealed address; `scriptText` replaces the sealed text (before the comment).
   */
  unannounced?: { url?: string; scriptText?: string; reactCopy?: number }
  /** The reason both channels report for the pause (default `breakpoint` for the DAP `stopped`, `other` for the CDP pause), such as `exception`. */
  stopReason?: string
}

/** Which of the two channels of a pause arrives first (`both` sends the CDP pause and then the DAP `stopped`). */
export type ServerHitOrder = 'cdp-first' | 'dap-first' | 'cdp-only' | 'dap-only'

/** What {@link createServerParticipant} needs from the harness around it. */
export interface ServerParticipantParts {
  /** The run the participant's events go to; read when an event is sent, because the run is created after the participant. */
  run(): ConfiguredBrowserRun
  /** The absolute path of the sealed source, which the DAP frames and breakpoints name. */
  sourcePath: string
  /** The sealed module's generated text, which `Debugger.getScriptSource` answers for a script without a text of its own. */
  javascript: string
  /** The address the sealed module is announced under. */
  scriptUrl: string
  /** The sealed module's source map as JSON, which a further instance of the module carries with its own mappings. */
  sourceMap: string
  /** The workspace the verified inspector reports. */
  workspace: string
  /** The route the work store answers on a frame whose hit names none; `null` for an unreadable route. */
  defaultRoute: string | null
  /** The debugger's value for an expression evaluated on the paused call frame (the same answer the page's channel gives). */
  evaluateOnCallFrame(expression: string | undefined): unknown
  /** The editor's breakpoints, shared with the harness (the participant acknowledges the ones in its source). */
  breakpoints: {
    id: string
    location: { range: { start: { line: number; character: number } } }
  }[]
  /** Records a release, for the harness's list of released resources. */
  released(name: string): void
}

/**
 * Builds the scripted Node participant of a version 3 run that declares server stops: its debug session, its inspector channel and the controls a test uses to send the hits, announcements and resumes the spike's logs show.
 *
 * Why it exists: `configuredRuntimeHarness` models the page only; a server stop needs an inspector endpoint, a `pwa-node` session, a second CDP channel and DAP answers, which this module scripts once for every server-render test. It is created by `configuredRuntimeHarness` when its options name `serverRuntime`, and a test reads it as `harness.server`.
 * @param parts - The harness pieces the participant shares.
 * @returns The session and channel the harness wires into the run, the breakpoint hooks, and the test API in `api`.
 * @example
 * const participant = createServerParticipant(parts)
 * participant.api.hit({ route: '/dashboard' }) // CDP pause, then DAP stopped, for the latest armed breakpoint
 */
export function createServerParticipant(parts: ServerParticipantParts) {
  const listeners = new Map<string, (event: unknown) => void>()
  let sequence = 1_000
  let hitNumber = 0
  /** The script texts and addresses the participant announced, by script id. */
  const announced = new Map<string, string>()
  const scriptTexts = new Map<string, string>()
  const heldScriptReads = new Map<string, Promise<void>>()
  const routes = new Map<number, ServerRouteAnswer>()
  const frames = new Map<number, { line: number; column: number }>()
  let currentHit = 0
  let currentStopReason = 'breakpoint'
  const adapterIds = new Map<string, number>()
  const adapterId = (breakpoint: { id: string }): number => {
    const known = adapterIds.get(breakpoint.id)
    if (known !== undefined) return known
    const assigned = FIRST_SERVER_ADAPTER_BREAKPOINT_ID + adapterIds.size
    adapterIds.set(breakpoint.id, assigned)
    return assigned
  }
  /** Every DAP command the run sent the server session, in order. */
  const commands: string[] = []
  /** Every `continue` the run sent the server session, in order, with the number of the hit it resumed. */
  const continues: { hit: number }[] = []
  /** Every route read (`evaluate` of the frozen expression) the run made, with the hit it asked about. */
  const routeReads: number[] = []
  let continueBehavior:
    | { kind: 'refuse'; message: string }
    | { kind: 'hold'; released: Promise<void> }
    | { kind: 'hold-answer'; released: Promise<void> }
    | { kind: 'no-events' }
    | undefined
  let breakpointsAcknowledged = 0
  let closed = false

  const session: DebugSession = {
    id: 'server-session',
    type: 'pwa-node',
    name: 'server',
    workspaceFolder: undefined,
    configuration: { type: 'pwa-node', name: '', request: 'attach' },
    customRequest: async (command, arguments_) => {
      commands.push(command)
      if (command === 'requestCDPProxy')
        return { host: '127.0.0.1', port: 1235, path: '/server' }
      if (command === 'stackTrace') {
        const frame = frames.get(currentHit) ?? { line: 1, column: 1 }
        return {
          stackFrames: [
            {
              id: currentHit,
              name: 'serverStep',
              source: { path: parts.sourcePath },
              line: frame.line,
              column: frame.column,
            },
          ],
        }
      }
      if (command === 'scopes')
        return { scopes: [{ name: 'Local', variablesReference: 601 }] }
      if (command === 'variables')
        return {
          variables: [
            {
              name: 'nextTheme',
              value: 'dark',
              type: 'string',
              variablesReference: 0,
            },
          ],
        }
      if (command === 'evaluate') {
        const request = arguments_ as { expression?: string; frameId?: number }
        if (request.expression !== SERVER_RENDER_ROUTE_EXPRESSION)
          throw new Error(`Unexpected server evaluate: ${request.expression}`)
        const hit = request.frameId ?? currentHit
        routeReads.push(hit)
        // A per-hit `null` is an unreadable route; only an unset hit takes the default.
        return answerRoute(
          routes.has(hit) ? routes.get(hit)! : parts.defaultRoute,
        )
      }
      if (command === 'continue') return answerContinue(arguments_)
      throw new Error(`Unexpected server DAP command: ${command}`)
    },
    getDebugProtocolBreakpoint: async (breakpoint) => {
      const current = parts.breakpoints.find(
        (candidate) => candidate.id === breakpoint.id,
      )
      if (!current) return undefined
      return {
        id: adapterId(breakpoint),
        verified: true,
        line: current.location.range.start.line + 1,
        column: current.location.range.start.character + 1,
        source: { path: parts.sourcePath },
      }
    },
  }

  /** Words the stand-in work store's answer to the frozen route expression the way the adapter prints it: a string result quoted, an absent store as `undefined`. */
  const answerRoute = async (
    answer: ServerRouteAnswer,
  ): Promise<{ result: string }> => {
    if (answer === 'no-answer') return new Promise<never>(() => {})
    if (answer !== null && typeof answer === 'object') {
      if ('error' in answer) throw new Error(answer.error)
      await sleep(answer.afterMs)
      return { result: `'${answer.route}'` }
    }
    return { result: answer === null ? 'undefined' : `'${answer}'` }
  }

  const answerContinue = async (arguments_: unknown): Promise<object> => {
    const run = parts.run()
    continues.push({ hit: currentHit })
    run.onRequest(session, {
      type: 'request',
      seq: ++sequence,
      command: 'continue',
      arguments: arguments_,
    })
    const behavior = continueBehavior
    continueBehavior = undefined
    if (behavior?.kind === 'refuse') throw new Error(behavior.message)
    if (behavior?.kind === 'hold') await behavior.released
    if (behavior?.kind !== 'no-events') {
      run.onEvent(session, {
        type: 'event',
        seq: ++sequence,
        event: 'continued',
        body: { threadId: 1 },
      })
      listeners.get('Debugger.resumed')?.({})
    }
    // The process runs on while the adapter's answer is still on its way.
    if (behavior?.kind === 'hold-answer') await behavior.released
    return {}
  }

  const proxy = {
    name: 'server',
    closed: false,
    onClose: undefined as (() => void) | undefined,
    on(event: string, listener: (event: unknown) => void): void {
      listeners.set(event, listener)
    },
    async subscribe(): Promise<void> {},
    aggregateScreencastTelemetry(): void {},
    close(): void {
      if (this.closed) return
      this.closed = true
      closed = true
      parts.released('server proxy')
      this.onClose?.()
    },
    async request(
      method: string,
      parameters?: {
        expression?: string
        scriptId?: string
      },
    ) {
      if (method === 'Runtime.evaluate') return { result: { value: undefined } }
      if (method === 'Debugger.getScriptSource') {
        const scriptId = parameters?.scriptId ?? ''
        await heldScriptReads.get(scriptId)
        return { scriptSource: scriptTexts.get(scriptId) ?? parts.javascript }
      }
      if (method === 'Debugger.evaluateOnCallFrame') {
        try {
          return {
            result: {
              value: parts.evaluateOnCallFrame(parameters?.expression),
            },
          }
        } catch {
          // A local the frame does not hold (an optional inspection) is an exception of the evaluation, as natively.
          return {
            result: { type: 'undefined' },
            exceptionDetails: {
              exceptionId: 1,
              text: 'Unavailable test local',
              lineNumber: 0,
              columnNumber: 0,
            },
          }
        }
      }
      throw new Error(`Unexpected server inspector method: ${method}`)
    },
    requestQuietly(
      method: string,
      parameters?: Record<string, unknown>,
    ): Promise<unknown> {
      return this.request(method, parameters)
    },
  }

  /** Sends `Debugger.scriptParsed` for a script, once per id and address. */
  const announce = (scriptId: string, url = parts.scriptUrl): void => {
    announced.set(scriptId, url)
    listeners.get('Debugger.scriptParsed')?.({
      scriptId,
      url,
      executionContextId: 1,
    })
  }

  const pauseCdp = (hit: ServerHit = {}): number => {
    const scriptId = hit.scriptId ?? 'server'
    if (hit.unannounced) {
      // Parsed before the subscription: only the text is known, never an announcement.
      const url =
        hit.unannounced.url ??
        (hit.unannounced.reactCopy === undefined
          ? parts.scriptUrl
          : `about://React/Server/${parts.scriptUrl}?${hit.unannounced.reactCopy}`)
      const text = hit.unannounced.scriptText
      // The sealed text of a run that sets `serverModuleSourceUrl` already ends with its comment; another address replaces it.
      const base = (text ?? parts.javascript).replace(
        /\n\/\/# sourceURL=[^\n]*$/,
        '',
      )
      const hasOwnAddress =
        hit.unannounced.url === undefined &&
        hit.unannounced.reactCopy === undefined
      scriptTexts.set(
        scriptId,
        hasOwnAddress && (text ?? parts.javascript).includes('sourceURL=')
          ? (text ?? parts.javascript)
          : `${base}\n//# sourceURL=${url}`,
      )
    } else if (!announced.has(scriptId)) announce(scriptId)
    currentHit = ++hitNumber
    currentStopReason = hit.stopReason ?? 'breakpoint'
    routes.set(
      currentHit,
      hit.route === undefined ? parts.defaultRoute : hit.route,
    )
    frames.set(currentHit, hit.source ?? { line: 1, column: 1 })
    listeners.get('Debugger.paused')?.(
      debuggerPausedEvent({
        callFrameId: `server-frame-${currentHit}`,
        scriptId,
        lineNumber: hit.generated?.line ?? 0,
        columnNumber: hit.generated?.column ?? 0,
        hitBreakpoints: ['native'],
        ...(hit.stopReason === undefined ? {} : { reason: hit.stopReason }),
      }),
    )
    return currentHit
  }

  const stopDap = (): void => {
    parts.run().onEvent(session, {
      type: 'event',
      seq: ++sequence,
      event: 'stopped',
      body: { reason: currentStopReason, threadId: 1 },
    })
  }

  /** Sends the breakpoint registrations the editor holds for the sealed source to the server session, as the adapter acknowledges them (pending until the pause). */
  const acknowledgeBreakpoints = (): void => {
    const run = parts.run()
    const selected = parts.breakpoints
    const requestSequence = ++sequence
    run.onRequest(session, {
      type: 'request',
      seq: requestSequence,
      command: 'setBreakpoints',
      arguments: {
        source: { path: parts.sourcePath },
        breakpoints: selected.map((breakpoint) => ({
          line: breakpoint.location.range.start.line + 1,
          column: breakpoint.location.range.start.character + 1,
        })),
      },
    })
    breakpointsAcknowledged++
    run.onResponse(session, {
      type: 'response',
      seq: ++sequence,
      command: 'setBreakpoints',
      request_seq: requestSequence,
      success: true,
      body: {
        breakpoints: selected.map((breakpoint) => ({
          id: adapterId(breakpoint),
          verified: false,
        })),
      },
    })
  }

  const api = {
    /** The debug session the run sees as the server's. */
    session,
    /** The address the sealed module is announced under. */
    sealedUrl: parts.scriptUrl,
    /**
     * Announces a script as the debugger does when Next parses a module: the sealed address by default, any other address for a re-parsed instance or React's copy.
     * @example harness.server.announceScript('3794')
     */
    announceScript: announce,
    /**
     * Announces one of React's fabricated copies of the sealed module (`about://React/Server/<sealed address>?<n>`).
     * @example harness.server.announceReactCopy('3670', 107)
     */
    announceReactCopy(scriptId: string, copy: number): void {
      announce(scriptId, `about://React/Server/${parts.scriptUrl}?${copy}`)
    },
    /**
     * Announces the sealed module again under a new script id, at the sealed address or in another webpack layer (`rsc`, `action-browser`), as Next parses a shared module for another route or layer: an extra leading line shifts the generated code by one line, and the instance carries its own inline source map.
     * @param scriptId - The new script's id.
     * @param layer - The layer in the address; omitted for the sealed address itself.
     * @param mappings - The instance's own mappings; `;AAAA` puts the one statement on generated line 2, so a hit there is `generated: { line: 1, column: 0 }`.
     * @example harness.server.announceInstance('5036', 'rsc')
     */
    announceInstance(
      scriptId: string,
      layer?: string,
      mappings = ';AAAA',
    ): void {
      const url = layer
        ? parts.scriptUrl.replace(/\([^)/]+\)/, `(${layer})`)
        : parts.scriptUrl
      const map = { ...JSON.parse(parts.sourceMap), mappings }
      scriptTexts.set(
        scriptId,
        `"use strict";\n${parts.javascript}\n//# sourceURL=${url}\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(JSON.stringify(map)).toString('base64')}`,
      )
      announce(scriptId, url)
    },
    /**
     * Builds the text of an instance of the sealed module that carries its own inline source map, for {@link ServerHit.unannounced}.
     * @param mappings - The instance's own mappings.
     * @param url - The address in the text's `sourceURL` comment.
     * @param changedOriginal - Puts another original text in the map, as a module whose source changed.
     * @example harness.server.instanceText(';AAAA', 'webpack-internal:///(rsc)/./app/page.tsx', true)
     */
    instanceText(
      mappings: string,
      url: string,
      changedOriginal = false,
    ): string {
      const map = { ...JSON.parse(parts.sourceMap), mappings }
      if (changedOriginal) map.sourcesContent = ['var nextTheme = "light";\n']
      const generated = parts.javascript.replace(
        /\n\/\/# sourceURL=[^\n]*$/,
        '',
      )
      return `"use strict";\n${generated}\n//# sourceURL=${url}\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(JSON.stringify(map)).toString('base64')}`
    },
    /** Gives a script its own generated text, as a re-parsed instance with other code has. */
    setScriptText(scriptId: string, text: string): void {
      scriptTexts.set(scriptId, text)
    },
    /** Keeps the run's read of a script's text open until the returned function is called. */
    holdScriptRead(scriptId: string): () => void {
      let release = (): void => {}
      heldScriptReads.set(
        scriptId,
        new Promise<void>((resolve) => {
          release = resolve
        }),
      )
      return release
    },
    /**
     * Sends one hit of the armed breakpoint: the CDP pause and the DAP `stopped`, in the order given (default CDP first, as the spike's logs mostly show).
     * @returns The number of the hit, which `continues` and `routeReads` name.
     * @example harness.server.hit({ scriptId: '5036', route: '/dashboard/invoices' })
     */
    hit(hit: ServerHit = {}, order: ServerHitOrder = 'cdp-first'): number {
      if (order === 'dap-only') {
        stopDap()
        return currentHit
      }
      if (order === 'dap-first') stopDap()
      const number = pauseCdp(hit)
      if (order === 'cdp-first') stopDap()
      return number
    },
    /** Sends only the CDP pause of a hit (its DAP `stopped` comes later through {@link stopDap}). */
    pauseCdp,
    /** Sends only the DAP `stopped`. */
    stopDap,
    /** Sends the CDP `Debugger.resumed` alone, as the adapter does for a pause it resumed itself. */
    emitResumed(): void {
      listeners.get('Debugger.resumed')?.({})
    },
    /** Sends the DAP `continued` alone. */
    emitContinued(): void {
      parts.run().onEvent(session, {
        type: 'event',
        seq: ++sequence,
        event: 'continued',
        body: { threadId: 1 },
      })
    },
    /** Makes the adapter refuse the next resume with this message (`Thread is not paused`). */
    refuseNextContinue(message = 'Thread is not paused'): void {
      continueBehavior = { kind: 'refuse', message }
    },
    /** Keeps the next resume's answer back until the returned function is called; the `continued` events follow it. */
    holdNextContinue(): () => void {
      let release = (): void => {}
      continueBehavior = {
        kind: 'hold',
        released: new Promise<void>((resolve) => {
          release = resolve
        }),
      }
      return release
    },
    /** Sends the `continued` and `resumed` events of the next resume at once but keeps the adapter's answer back until the returned function is called, so the process can hit again before the continue is acknowledged. */
    holdNextContinueAnswer(): () => void {
      let release = (): void => {}
      continueBehavior = {
        kind: 'hold-answer',
        released: new Promise<void>((resolve) => {
          release = resolve
        }),
      }
      return release
    },
    /** Makes the adapter answer the next resume without sending `continued` or `Debugger.resumed`, as a resume that did not happen. */
    answerNextContinueWithoutEvents(): void {
      continueBehavior = { kind: 'no-events' }
    },
    /** Sets the route the work store answers on every later hit that names none (`null` for an unreadable route). */
    setDefaultRoute(route: string | null): void {
      parts.defaultRoute = route
    },
    /** Every DAP command the run sent the server session, in order. */
    commands,
    /** Every resume the run sent the server session, with the hit it resumed. */
    continues,
    /** The hit each route read asked about, in order. */
    routeReads,
    /** How many `setBreakpoints` registrations the participant acknowledged. */
    breakpointsAcknowledged: (): number => breakpointsAcknowledged,
    /** Whether the run closed the server's inspector channel. */
    isClosed: (): boolean => closed,
  }

  return {
    session,
    proxy,
    api,
    acknowledgeBreakpoints,
    /** The inspector endpoint and identity check the stand-in server application offers. */
    application: {
      inspectorEndpoint: async (): Promise<string> =>
        'ws://127.0.0.1:1235/worker',
      verifyInspector: async () => ({
        pid: 1235,
        processGroup: 1234,
        workspace: parts.workspace,
        isMainThread: true,
        threadId: 0,
      }),
    },
  }
}
