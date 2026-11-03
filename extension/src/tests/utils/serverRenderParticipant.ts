import { setTimeout as sleep } from 'node:timers/promises'

import type { DebugSession } from 'vscode'

import type { ConfiguredBrowserRun } from '../../configuredBrowserRun'
import {
  NEXT_PAGES_PAGE_EXPRESSION,
  SERVER_RENDER_ROUTE_EXPRESSION,
} from '../../constants'
import { isNextPagesRendererUrl } from '../../utils/isNextPagesRendererUrl'
import type { PagesPausedEvent } from '../../utils/parsePagesPausedEvent'

import { debuggerPausedEvent } from './debuggerPausedEvent'
import { pagesPausedFixtureOf } from './pagesPausedFixture'
import { pagesRuntimeTextOf } from './pagesRuntimeText'

/** The adapter id of the first editor breakpoint the server session acknowledges; later ones count up from it. */
const FIRST_SERVER_ADAPTER_BREAKPOINT_ID = 40

/** The `variablesReference` of the local scope the participant answers; its members come from {@link createServerParticipant}'s `setScope`. */
const LOCAL_SCOPE_REFERENCE = 601
/** The first reference of an object member in a scripted scope. */
const FIRST_SCRIPTED_VARIABLE_REFERENCE = 700

/** One variable of a DAP `variables` answer. */
interface ScriptedVariable {
  name: string
  value: string
  type: string
  variablesReference: number
}

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

/**
 * The stack of a Pages server hit, built from an E0b payload that js-debug's proxy forwarded (`fixtures/next-pages-paused`): the fixture's frames and async chain stand for Next's renderer, the hit's own place for the stop's line.
 * Synchronous frames carry an empty `url`, as the proxy sends them; the script addresses come from `Debugger.scriptParsed`, which the participant sends for the fixture's scripts the first time a hit names them.
 */
export interface PagesHitScript {
  /** The recorded payload: `get-server-side-props-before-await`, `get-server-side-props-after-await`, `get-static-props-after-await` or `get-static-props-helper-after-await`. */
  fixture: string
  /** Puts the hit's own frame before the fixture's synchronous frames (a helper or a handler that the data function calls) instead of in place of the first one (the data function itself). */
  prepend?: boolean
  /** What `pathname` evaluates to on the renderer's `renderToHTMLImpl` frame: a route, or `null` for an evaluation that throws (an unreadable page). The route `/` by default. */
  pathname?: string | null
  /** Changes the event before it is sent: drop frames, cut the async chain, replace the script address of a frame. */
  edit?: (event: PagesPausedEvent, scriptUrls: Record<string, string>) => void
  /** The answers of `Debugger.getStackTrace` by stack trace id: a `Runtime.StackTrace`, or `'fail'` for a rejected read. */
  stackTraces?: Record<string, object | 'fail'>
  /** The fixture scripts the proxy never announces (parsed before the debugger attached, as the readiness request's compile does): `'all'`, or their ids. Their texts can still be read: the renderer's is the vendored runtime, a webpack module's ends with its `sourceURL` comment, a file loaded by Node's own loader has none. */
  unannounced?: 'all' | readonly string[]
  /** The text `Debugger.getScriptSource` answers for a fixture script, by id, in place of the default above: a page module that declares its data function, or a renderer whose call sites Next changed. */
  scriptTexts?: Readonly<Record<string, string>>
}

/**
 * Gives the text a fixture script the proxy never announced answers: a webpack module (`webpack-internal:///…`, `(pages-dir-node)/…`) is evaluated with its address in a closing `sourceURL` comment, a file Node's own loader read (`file:///…`) has none.
 * @param url - The script's address in the recorded payload.
 * @returns A stand-in module text.
 * @example
 * unannouncedModuleTextOf('(pages-dir-node)/./pages/index.js').endsWith('\n//# sourceURL=(pages-dir-node)/./pages/index.js') // => true
 * unannouncedModuleTextOf('file:///app/node_modules/next/dist/server/base-server.js').includes('sourceURL') // => false
 */
function unannouncedModuleTextOf(url: string): string {
  const body = '/* module parsed before the debugger attached */'
  return url.startsWith('file:') ? body : `${body}\n//# sourceURL=${url}`
}

/** One hit of an armed server breakpoint, as the spike's logs show it. */
export interface ServerHit {
  /** A Pages data-function hit: the stack the hit pauses with ({@link PagesHitScript}). Without it the pause has the one frame of the stop. */
  pages?: PagesHitScript
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
  /** The scripts whose next text read fails, as a transient `Debugger.getScriptSource` error does. */
  const failingScriptReads = new Set<string>()
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
  /** Holds the answer of the next `stackTrace` until released, as an adapter that is slow to read a stack. */
  let heldStackAnswer: Promise<void> | undefined
  /** The name the DAP stack frame of a hit reports; `serverStep` unless a test sets another. */
  let frameName = 'serverStep'
  /** The variables the DAP `variables` request answers by reference, when a test scripted the scope; the default scope (`nextTheme`) otherwise. */
  const scriptedVariables = new Map<number, ScriptedVariable[]>()
  let nextVariableReference = FIRST_SCRIPTED_VARIABLE_REFERENCE
  /** Every method the run sent through the server's inspector proxy, in order. */
  const inspectorMethods: string[] = []
  /** The methods of {@link inspectorMethods} sent with `request`, which the real channel journals as `cdp.sent` and `cdp.response`; a `requestQuietly` send is not listed. */
  const journaledInspectorMethods: string[] = []
  /** What `pathname` evaluates to on a Pages hit's `renderToHTMLImpl` frame, by call frame id (`null`: an evaluation that throws). */
  const pagesPathnames = new Map<string, string | null>()
  /** The answers of `Debugger.getStackTrace`, by stack trace id. */
  const stackTraces = new Map<string, object | 'fail'>()

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
        const held = heldStackAnswer
        heldStackAnswer = undefined
        await held
        const frame = frames.get(currentHit) ?? { line: 1, column: 1 }
        return {
          stackFrames: [
            {
              id: currentHit,
              name: frameName,
              source: { path: parts.sourcePath },
              line: frame.line,
              column: frame.column,
            },
          ],
        }
      }
      if (command === 'scopes')
        return {
          scopes: [
            { name: 'Local', variablesReference: LOCAL_SCOPE_REFERENCE },
          ],
        }
      if (command === 'variables') {
        const reference = (arguments_ as { variablesReference?: number })
          .variablesReference
        const scripted = scriptedVariables.get(reference ?? -1)
        if (scripted) return { variables: scripted }
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
    /** Sends a request the real channel journals (`cdp.sent`, `cdp.response`). */
    async request(
      method: string,
      parameters?: {
        expression?: string
        scriptId?: string
        callFrameId?: string
        stackTraceId?: { id: string }
      },
    ) {
      journaledInspectorMethods.push(method)
      return this.answer(method, parameters)
    },
    /** Answers a request of either path as the server's inspector does. */
    async answer(
      method: string,
      parameters?: {
        expression?: string
        scriptId?: string
        callFrameId?: string
        stackTraceId?: { id: string }
      },
    ) {
      inspectorMethods.push(method)
      if (method === 'Runtime.evaluate') return { result: { value: undefined } }
      if (method === 'Debugger.getStackTrace') {
        const answer = stackTraces.get(parameters?.stackTraceId?.id ?? '')
        if (answer === undefined || answer === 'fail')
          throw new Error('Unknown stack trace id')
        return { stackTrace: answer }
      }
      if (method === 'Debugger.getScriptSource') {
        const scriptId = parameters?.scriptId ?? ''
        await heldScriptReads.get(scriptId)
        if (failingScriptReads.delete(scriptId))
          throw new Error(
            `Debugger.getScriptSource: No script for id: ${scriptId}`,
          )
        return { scriptSource: scriptTexts.get(scriptId) ?? parts.javascript }
      }
      if (
        method === 'Debugger.evaluateOnCallFrame' &&
        parameters?.expression === NEXT_PAGES_PAGE_EXPRESSION &&
        parameters.callFrameId !== undefined &&
        pagesPathnames.has(parameters.callFrameId)
      ) {
        const pathname = pagesPathnames.get(parameters.callFrameId)
        return pathname === null
          ? {
              result: { type: 'undefined' },
              exceptionDetails: {
                exceptionId: 2,
                text: 'pathname is not defined',
                lineNumber: 0,
                columnNumber: 0,
              },
            }
          : { result: { type: 'string', value: pathname } }
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
      return this.answer(method, parameters)
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
    const own = debuggerPausedEvent({
      callFrameId: `server-frame-${currentHit}`,
      scriptId,
      lineNumber: hit.generated?.line ?? 0,
      columnNumber: hit.generated?.column ?? 0,
      hitBreakpoints: ['native'],
      ...(hit.stopReason === undefined ? {} : { reason: hit.stopReason }),
    })
    listeners.get('Debugger.paused')?.(
      hit.pages ? pagesEventOf(hit.pages, own, currentHit) : own,
    )
    return currentHit
  }

  /**
   * Builds the paused event of a Pages data-function hit from an E0b payload: the hit's own frame in place of the data function's frame (or before the fixture's frames), the fixture's other frames and async chain, and the scripts they name announced.
   * @param script - The fixture and its edits.
   * @param own - The event of the hit's own frame.
   * @param hitNumber - The hit's number, which keeps call frame ids apart.
   * @returns The `Debugger.paused` params the proxy forwards: synchronous frames with an empty `url`.
   */
  const pagesEventOf = (
    script: PagesHitScript,
    own: ReturnType<typeof debuggerPausedEvent>,
    hitNumber: number,
  ) => {
    const fixture = pagesPausedFixtureOf(script.fixture)
    const scriptUrls = { ...fixture.scriptUrls }
    const event = fixture.event
    const ownFrame = own.callFrames[0]!
    const fixtureFrames = event.callFrames.map((frame) => ({
      ...frame,
      callFrameId: `${hitNumber}-${frame.callFrameId}`,
    }))
    event.callFrames = [
      { ...ownFrame, functionName: '', url: '' },
      ...fixtureFrames.slice(script.prepend ? 0 : 1),
    ]
    script.edit?.(event, scriptUrls)
    // The scripts the stack names are announced once, the renderer's with its text.
    for (const [scriptId, url] of Object.entries(scriptUrls)) {
      if (announced.has(scriptId)) continue
      const isUnannounced =
        script.unannounced === 'all' || script.unannounced?.includes(scriptId)
      const text =
        script.scriptTexts?.[scriptId] ??
        (isNextPagesRendererUrl(url)
          ? pagesRuntimeTextOf(
              fixture.nextVersion === '16.4.4' ? '16.4.4' : '16.1.4',
            )
          : isUnannounced
            ? unannouncedModuleTextOf(url)
            : undefined)
      if (text !== undefined) scriptTexts.set(scriptId, text)
      if (!isUnannounced) announce(scriptId, url)
    }
    // `pathname` is a parameter of the renderer's `renderToHTMLImpl`, the frame that holds the traced call.
    for (const frame of event.callFrames)
      if (frame.functionName === 'renderToHTMLImpl' && frame.callFrameId)
        pagesPathnames.set(frame.callFrameId, script.pathname ?? '/')
    for (const [id, trace] of Object.entries(script.stackTraces ?? {}))
      stackTraces.set(id, trace)
    return {
      ...own,
      callFrames: event.callFrames,
      ...(event.asyncStackTrace
        ? { asyncStackTrace: event.asyncStackTrace }
        : {}),
      ...(event.asyncStackTraceId
        ? { asyncStackTraceId: event.asyncStackTraceId }
        : {}),
    }
  }

  const stopDap = (): void => {
    parts.run().onEvent(session, {
      type: 'event',
      seq: ++sequence,
      event: 'stopped',
      body: { reason: currentStopReason, threadId: 1 },
    })
  }

  /** The requested source lines whose registration the adapter verifies in its answer; every other registration stays pending. */
  let verifiedRegistrationLines: number[] = []

  /** Sends the breakpoint registrations the editor holds for the sealed source to the server session, as the adapter acknowledges them (pending until the pause). */
  const acknowledgeBreakpoints = (): void => {
    const run = parts.run()
    const verifiedLines = verifiedRegistrationLines
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
        breakpoints: selected.map((breakpoint) => {
          const line = breakpoint.location.range.start.line + 1
          // A registration on a line the test chose is verified at once; every other one stays pending until its pause.
          return verifiedLines.includes(line)
            ? {
                id: adapterId(breakpoint),
                verified: true,
                line,
                column: breakpoint.location.range.start.character + 1,
              }
            : { id: adapterId(breakpoint), verified: false }
        }),
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
    /** Makes the run's next read of a script's text fail, as a transient `Debugger.getScriptSource` error; the read after it answers. */
    failNextScriptRead(scriptId: string): void {
      failingScriptReads.add(scriptId)
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
    /** Keeps the answer of the next `stackTrace` back until the returned function is called, as an adapter that is slow to read a stack. */
    holdNextStackTrace(): () => void {
      let release = (): void => {}
      heldStackAnswer = new Promise<void>((resolve) => {
        release = resolve
      })
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
    /**
     * Makes the adapter verify, in its next answers, the registrations requested on these source lines; every other registration stays pending until its pause.
     * @example harness.server.verifyRegistrationsOnLines([1])
     */
    verifyRegistrationsOnLines(lines: number[]): void {
      verifiedRegistrationLines = lines
    },
    /**
     * Scripts the locals the debugger shows at the next hits: the members of the local scope, an object or array expanding into its own members, as js-debug answers `variables` (a string value is quoted).
     * @example harness.server.setScope({ count: 3, req: { headers: { cookie: 'sid=abc' } } })
     */
    setScope(values: Record<string, unknown>): void {
      scriptedVariables.clear()
      nextVariableReference = FIRST_SCRIPTED_VARIABLE_REFERENCE
      const describe = (name: string, value: unknown): ScriptedVariable => {
        if (value !== null && typeof value === 'object') {
          const reference = nextVariableReference++
          scriptedVariables.set(
            reference,
            Object.entries(value).map(([member, memberValue]) =>
              describe(member, memberValue),
            ),
          )
          return {
            name,
            value: Array.isArray(value) ? `Array(${value.length})` : 'Object',
            type: 'object',
            variablesReference: reference,
          }
        }
        return {
          name,
          value: typeof value === 'string' ? `'${value}'` : String(value),
          type: typeof value,
          variablesReference: 0,
        }
      }
      scriptedVariables.set(
        LOCAL_SCOPE_REFERENCE,
        Object.entries(values).map(([name, value]) => describe(name, value)),
      )
    },
    /** Sets the name the DAP stack frame of the next hits reports (`getServerSideProps`). @example harness.server.setFrameName('getServerSideProps') */
    setFrameName(name: string): void {
      frameName = name
    },
    /** Every DAP command the run sent the server session, in order. */
    commands,
    /** Every method the run sent through the server's inspector proxy, in order: the Pages verdict sends read-only `Debugger` commands only. */
    inspectorMethods,
    /** The methods the run sent with the journaled `request` path, in order; the real channel writes a `cdp.sent` and a `cdp.response` entry for each one, and none for a successful `requestQuietly`. */
    journaledInspectorMethods,
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
