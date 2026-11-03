import { holdsNextPagesRendererPatterns } from './holdsNextPagesRendererPatterns'
import { isNextPagesRendererUrl } from './isNextPagesRendererUrl'
import {
  nextPagesDataFunctionCallAt,
  type NextPagesDataFunctionCall,
} from './nextPagesDataFunctionCallAt'
import type { PagesHitReader } from './pagesHitReader'
import { pagesStackFramesOf, type PagesStackFrame } from './pagesStackFramesOf'
import {
  parsePagesPausedEvent,
  type PagesPausedEvent,
} from './parsePagesPausedEvent'
import {
  readPagesAsyncChain,
  type PagesChainIncompleteCause,
} from './readPagesAsyncChain'
import { readPagesRenderedPage } from './readPagesRenderedPage'
import {
  readWithinVerdictBudget,
  type VerdictBudget,
} from './readWithinVerdictBudget'
import { valueShapeSummaryOf } from './valueShapeSummaryOf'

/** The data function whose call a hit was found inside. */
export type PagesDataFunctionName = NextPagesDataFunctionCall['dataFunction']

/** Why a hit pauses without proof that it is the entry page's data function (the journal's `reason`). */
export type PagesUnconfirmedReason =
  /** The event carried no async chain and its synchronous frames hold no data-function call. */
  | { reason: 'no-async-chain' }
  /** No frame of Next's page renderer is in reach, or the renderer's text holds none of the known patterns: recognition itself failed. */
  | { reason: 'no-renderer-frame' }
  /** The data-function call was found but the page it renders could not be confirmed: no frame named it (or none could be read), and the browser's request, when it names the entry page, is no proof. */
  | { reason: 'route-unreadable' }
  /** The async chain could not be read to its end. */
  | { reason: 'chain-incomplete'; cause: PagesChainIncompleteCause }
  /** The event had an unexpected shape; `shape` names its fields and types, never a value. */
  | { reason: 'verdict-error'; shape: string }

/** What a hit of an armed Pages server stop means: published as the learner's pause (with its attribution) or resumed by the run (with the journal event that records why). */
export type PagesDataFunctionHitVerdict =
  /** Inside the entry page's data function, on proof. */
  | {
      action: 'pause'
      attribution: 'entry-load' | 'after-operation'
      dataFunction: PagesDataFunctionName
      /** The stack named the page; the browser's outstanding request alone never takes a pause (it is `unconfirmed`). */
      evidence: 'frame'
    }
  /** Not proven: published labelled `unconfirmed`, and never counted as proof. */
  | ({ action: 'pause'; attribution: 'unconfirmed' } & PagesUnconfirmedReason)
  | { action: 'resume'; event: 'breakpoint.other-route'; route: string }
  | { action: 'resume'; event: 'breakpoint.outside-data-function' }
  | { action: 'resume'; event: 'breakpoint.unattributed-resumed' }

/** The facts a Pages hit is judged by. */
export type PagesDataFunctionHit = {
  /** The `params` of the `Debugger.paused` event as received; any shape, a bad one is a `verdict-error`. */
  event: unknown
  /** The entry page's route, its `pages-manifest.json` key (`/products/[id]`). */
  entryRoute: string
  /** Whether the browser's main frame shows the entry route ({@link isBrowserOnEntryRoute}); decides an unreadable page. */
  browserOnEntryRoute: boolean
  /** The stop's operation group: 0 for the entry render, k for the render observed after operation k. */
  group: number
}

/** Where the data function is called in the stack, and the frame its page is read on. */
type FoundDataFunctionCall = {
  /** Index in the frame list; the frames before it are inside the call. */
  index: number
  dataFunction: PagesDataFunctionName
  /** The synchronous frame of the traced call, where `pathname` is in scope. */
  pathnameCallFrameId: string | undefined
}

/** How far the renderer's frames could be recognised. */
type RendererReading = 'none' | 'recognised' | 'unrecognised'

/** What the stack of a hit showed, as far as it was read. */
type HitEvidence = {
  /** Innermost first: the synchronous frames, then each async level read so far. */
  frames: PagesStackFrame[]
  call: FoundDataFunctionCall | undefined
  chain: 'absent' | 'complete' | { incomplete: PagesChainIncompleteCause }
  renderer: RendererReading
}

/** What scanning the frames read so far came to. */
type RendererScan =
  | {
      kind: 'scanned'
      call: FoundDataFunctionCall | undefined
      renderer: RendererReading
    }
  | { kind: 'timeout' }

/**
 * Decides what a hit of an armed server stop in a Pages run means, before anything is published: the entry page's data function, another page's, or code outside every data function.
 *
 * Why it exists: Next runs many requests and the page's own render through the code a stop sits in, but only a hit inside the entry page's `getServerSideProps` or `getStaticProps` is the learner's pause. Next's renderer calls the data function from a known place, so the stack (synchronous frames and the async chain) says whether the hit is inside it. The decision does no I/O itself: the stack comes with the hit, everything else through {@link PagesHitReader}, all within one budget. Called by {@link ConfiguredBrowserRun} for each hit of a Pages server stop, App Router's counterpart being {@link serverRenderHitVerdictOf}.
 * Three outcomes are never conflated: inside (a data-function call frame is in the stack), outside (positive evidence: the chain was read to its end, holds a renderer frame, and holds no call frame) and insufficient evidence (`unconfirmed` with its reason).
 * @param hit - The event and the facts of the run.
 * @param reader - Supplies script addresses and texts, `pathname`, stack continuations, the manifest and the outstanding requests.
 * @param budget - The hit's single time budget ({@link createVerdictBudget}); a spent budget is `chain-incomplete` with cause `timeout`.
 * @returns
 * - pause `entry-load` (group 0) or `after-operation` (group k >= 1) with the data function and the evidence (`frame`) when the hit is inside the entry page's data function and the stack names the entry page
 * - resume `breakpoint.other-route` (with the route) when the page it renders is another page
 * - resume `breakpoint.outside-data-function` only on positive evidence
 * - pause `unconfirmed` with `route-unreadable` when no frame names the page and only the browser's one outstanding page request is for the entry route: the request is no proof that the paused work serves the entry page
 * - for an unreadable page: pause `unconfirmed` with `route-unreadable` while the browser shows the entry route, else resume `breakpoint.unattributed-resumed`
 * - pause `unconfirmed` with `no-async-chain`, `no-renderer-frame`, `chain-incomplete` (and its cause) or `verdict-error` (and a value-free shape summary) otherwise; incomplete evidence is never `outside-data-function`
 * The returned promise never rejects.
 * @example
 * await pagesDataFunctionHitVerdictOf({ event, entryRoute: '/', browserOnEntryRoute: true, group: 0 }, reader, budget)
 * // => { action: 'pause', attribution: 'entry-load', dataFunction: 'getServerSideProps', evidence: 'frame' }
 */
export async function pagesDataFunctionHitVerdictOf(
  hit: PagesDataFunctionHit,
  reader: PagesHitReader,
  budget: VerdictBudget,
): Promise<PagesDataFunctionHitVerdict> {
  try {
    const event = parsePagesPausedEvent(hit.event)
    if (!event) return verdictErrorOf(hit.event)
    return await judge(hit, event, reader, budget)
  } catch {
    // The verdict never throws into the run: a failure nobody expected is a recorded verdict error.
    return verdictErrorOf(hit.event)
  }
}

/** Reads the stack, then judges what it shows. */
async function judge(
  hit: PagesDataFunctionHit,
  event: PagesPausedEvent,
  reader: PagesHitReader,
  budget: VerdictBudget,
): Promise<PagesDataFunctionHitVerdict> {
  const evidence = await gatherEvidence(event, reader, budget)
  return evidence.call
    ? judgeInsideDataFunction(
        hit,
        evidence.call,
        evidence.frames,
        reader,
        budget,
      )
    : judgeWithoutDataFunctionCall(evidence)
}

/**
 * Reads the stack level by level until the data-function call is found, or until the chain ends, stops short or the budget is spent.
 * @param event - The parsed paused event.
 * @param reader - Supplies script addresses, renderer texts and chain continuations.
 * @param budget - The hit's single time budget.
 * @returns The frames read, the call if found, how the chain ended and whether the renderer was recognised.
 */
async function gatherEvidence(
  event: PagesPausedEvent,
  reader: PagesHitReader,
  budget: VerdictBudget,
): Promise<HitEvidence> {
  const frames = pagesStackFramesOf(
    { origin: 'sync', callFrames: event.callFrames },
    reader.scriptUrlOf,
  )
  const rendererTexts = new Map<string, string | undefined>()
  const levels = readPagesAsyncChain(event, reader, budget)
  // What a chain that ends without a cut is: complete, or absent when the event carried none.
  const endedChain =
    event.asyncStackTrace !== undefined || event.asyncStackTraceId !== undefined
      ? 'complete'
      : 'absent'
  for (;;) {
    const scan = await scanRendererFrames(frames, rendererTexts, reader, budget)
    if (scan.kind === 'timeout')
      return {
        frames,
        call: undefined,
        chain: { incomplete: 'timeout' },
        renderer: 'none',
      }
    const { call, renderer } = scan
    // The first call frame found ends the read: what is inside it is already in the list.
    if (call) return { frames, call, chain: endedChain, renderer }
    const step = await levels.next()
    if (step.done) return { frames, call, chain: endedChain, renderer }
    if (step.value.kind === 'incomplete')
      return {
        frames,
        call,
        chain: { incomplete: step.value.cause },
        renderer,
      }
    frames.push(...step.value.frames)
  }
}

/**
 * Finds the data-function call among the frames read so far, reading the renderer's text once per renderer script of the hit.
 * @param frames - The frames read so far, innermost first.
 * @param rendererTexts - The hit's copy of the renderer texts by script id; filled here.
 * @param reader - Supplies the renderer's text.
 * @param budget - The hit's single time budget.
 * @returns The call and the recognition state, or `timeout` when the budget ended during a text read.
 */
async function scanRendererFrames(
  frames: readonly PagesStackFrame[],
  rendererTexts: Map<string, string | undefined>,
  reader: Pick<PagesHitReader, 'scriptSourceOf'>,
  budget: VerdictBudget,
): Promise<RendererScan> {
  const rendererScriptIds = [
    ...new Set(
      frames
        .filter((frame) => isNextPagesRendererUrl(frame.url))
        .map((frame) => frame.scriptId),
    ),
  ]
  if (rendererScriptIds.length === 0)
    return { kind: 'scanned', call: undefined, renderer: 'none' }
  for (const scriptId of rendererScriptIds) {
    if (rendererTexts.has(scriptId)) continue
    const read = await readWithinVerdictBudget(
      () => reader.scriptSourceOf(scriptId),
      budget,
    )
    if (read.status === 'timeout') return { kind: 'timeout' }
    // A text that could not be read is kept as unread, so the renderer counts as unrecognised.
    rendererTexts.set(scriptId, read.status === 'read' ? read.value : undefined)
  }
  const isEveryTextRecognised = rendererScriptIds.every((scriptId) => {
    const text = rendererTexts.get(scriptId)
    return text !== undefined && holdsNextPagesRendererPatterns(text)
  })
  return {
    kind: 'scanned',
    call: findDataFunctionCall(frames, rendererTexts),
    renderer: isEveryTextRecognised ? 'recognised' : 'unrecognised',
  }
}

/**
 * Finds the innermost frame that calls a data function, and the synchronous frame of the traced call beside it.
 * @param frames - The frames read so far, innermost first.
 * @param rendererTexts - The renderer texts by script id.
 * @returns The call, or `undefined` when no renderer frame is a data-function call.
 */
function findDataFunctionCall(
  frames: readonly PagesStackFrame[],
  rendererTexts: ReadonlyMap<string, string | undefined>,
): FoundDataFunctionCall | undefined {
  const calls = frames.map((frame) => {
    const text = rendererTexts.get(frame.scriptId)
    return text === undefined
      ? undefined
      : nextPagesDataFunctionCallAt(text, frame.lineNumber, frame.columnNumber)
  })
  const index = calls.findIndex((call) => call !== undefined)
  const firstCall = calls[index]
  if (!firstCall) return undefined
  // `pathname` is in scope on the synchronous frame of the traced call, never on the call arrow.
  const pathnameFrame = frames.find(
    (frame, frameIndex) =>
      frame.origin === 'sync' &&
      calls[frameIndex]?.form === 'traced-await' &&
      calls[frameIndex]?.dataFunction === firstCall.dataFunction,
  )
  return {
    index,
    dataFunction: firstCall.dataFunction,
    pathnameCallFrameId: pathnameFrame?.callFrameId,
  }
}

/** Judges a hit whose stack holds the data-function call: the page it renders decides. */
async function judgeInsideDataFunction(
  hit: PagesDataFunctionHit,
  call: FoundDataFunctionCall,
  frames: readonly PagesStackFrame[],
  reader: PagesHitReader,
  budget: VerdictBudget,
): Promise<PagesDataFunctionHitVerdict> {
  const page = await readPagesRenderedPage(
    {
      pathnameCallFrameId: call.pathnameCallFrameId,
      // The frames inside the call, the one nearest the call first.
      insideFrameUrls: frames
        .slice(0, call.index)
        .map((frame) => frame.url)
        .reverse(),
      entryRoute: hit.entryRoute,
    },
    reader,
    budget,
  )
  if (page.state === 'timed-out')
    return unconfirmed({ reason: 'chain-incomplete', cause: 'timeout' })
  // The browser's request alone is no proof: the entry page's data function can fetch another page of the same server, whose data function pauses while the browser sees only the entry request.
  if (page.state === 'named-by-request')
    return unconfirmed({ reason: 'route-unreadable' })
  if (page.state === 'unreadable')
    // An unreadable page pauses only while the browser shows the entry route; another page's hit must not pause the learner.
    return hit.browserOnEntryRoute
      ? unconfirmed({ reason: 'route-unreadable' })
      : { action: 'resume', event: 'breakpoint.unattributed-resumed' }
  if (page.route !== hit.entryRoute)
    return {
      action: 'resume',
      event: 'breakpoint.other-route',
      route: page.route,
    }
  return {
    action: 'pause',
    attribution: hit.group === 0 ? 'entry-load' : 'after-operation',
    dataFunction: call.dataFunction,
    evidence: page.evidence,
  }
}

/** Judges a hit whose stack, as far as it was read, holds no data-function call; only a complete chain with a recognised renderer is outside. */
function judgeWithoutDataFunctionCall(
  evidence: HitEvidence,
): PagesDataFunctionHitVerdict {
  if (evidence.chain === 'absent')
    return unconfirmed({ reason: 'no-async-chain' })
  if (evidence.renderer === 'unrecognised')
    return unconfirmed({ reason: 'no-renderer-frame' })
  if (typeof evidence.chain === 'object')
    return unconfirmed({
      reason: 'chain-incomplete',
      cause: evidence.chain.incomplete,
    })
  if (evidence.renderer === 'none')
    return unconfirmed({ reason: 'no-renderer-frame' })
  // Positive evidence: the whole chain was read, it holds renderer frames, and none of them calls a data function.
  return { action: 'resume', event: 'breakpoint.outside-data-function' }
}

/** Builds the pause that is published labelled `unconfirmed`. */
function unconfirmed(
  reason: PagesUnconfirmedReason,
): PagesDataFunctionHitVerdict {
  return { action: 'pause', attribution: 'unconfirmed', ...reason }
}

/** Builds the `verdict-error` pause for an event that could not be judged, naming its shape and no value. */
function verdictErrorOf(event: unknown): PagesDataFunctionHitVerdict {
  let shape: string
  try {
    shape = valueShapeSummaryOf(event)
  } catch {
    // Even the summary must not throw: the verdict never does.
    shape = 'unsummarisable'
  }
  return unconfirmed({ reason: 'verdict-error', shape })
}
