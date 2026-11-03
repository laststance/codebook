import { NEXT_PAGES_PAGE_EXPRESSION } from '../constants'

import { isBrowserOnEntryRoute } from './isBrowserOnEntryRoute'
import { pagesCompiledPathOfModuleUrl } from './pagesCompiledPathOfModuleUrl'
import type { PagesHitReader } from './pagesHitReader'
import { pagesRequestPathOf } from './pagesRequestPathOf'
import {
  readWithinVerdictBudget,
  type VerdictBudget,
} from './readWithinVerdictBudget'
import { renderedRouteOf } from './renderedRouteOf'

/** The page a Pages hit renders, and what the answer rests on. */
export type PagesRenderedPage =
  | {
      state: 'read'
      route: string
      /** `frame`: the stack named the page (`pathname` of the renderer, or a page-module frame); `request`: the browser's one outstanding page request did. */
      evidence: 'frame' | 'request'
    }
  | { state: 'unreadable' }
  | { state: 'timed-out' }

/** What the hit's stack offers for reading its page. */
export type PagesPageReadFacts = {
  /** The synchronous frame of the renderer's traced call (`renderToHTMLImpl`), where `pathname` is in scope; `undefined` when the stack holds none (after an `await`). */
  pathnameCallFrameId: string | undefined
  /** The script addresses of the frames inside the data-function call frame, the one nearest the call frame first. */
  insideFrameUrls: readonly string[]
  /** The entry page's route (its `pages-manifest.json` key). */
  entryRoute: string
}

/** What one source of the page came to: a route, nothing, or a spent budget. */
type PageSourceRead =
  | { status: 'route'; route: string }
  | { status: 'none' }
  | { status: 'timeout' }

const NO_ROUTE: PageSourceRead = { status: 'none' }

/**
 * Reads which page a Pages hit renders, from the cheapest source that has the answer.
 *
 * Why it exists: Pages has no work store to ask, yet the data function of another page can run the same helper, so a hit is the learner's pause only when the page it renders is the entry page. Called by {@link pagesDataFunctionHitVerdictOf} once the data-function call frame is found.
 * In order: `pathname` evaluated on the synchronous frame of the traced call; else the page-module frame nearest the call frame, moved through `pages-manifest.json`; else the browser's outstanding page requests (exactly one, for the entry route). A source that fails or has no answer passes the read to the next; the budget ends the whole read.
 * @param facts - The frame to evaluate on, the frames inside the call frame and the entry route.
 * @param reader - Evaluates, reads the manifest and lists the outstanding requests.
 * @param budget - The hit's single time budget.
 * @returns
 * - `read` with the page's route and the evidence
 * - `unreadable` when no source named a page (the request source names the entry page or nothing: one request for another route, or more than one request, leaves it unreadable)
 * - `timed-out` when the budget ended during a read
 * @example
 * await readPagesRenderedPage({ pathnameCallFrameId: 'f3', insideFrameUrls: [], entryRoute: '/' }, reader, budget) // => { state: 'read', route: '/', evidence: 'frame' }
 */
export async function readPagesRenderedPage(
  facts: PagesPageReadFacts,
  reader: Pick<
    PagesHitReader,
    'evaluateOnCallFrame' | 'pagesManifest' | 'outstandingRequests'
  >,
  budget: VerdictBudget,
): Promise<PagesRenderedPage> {
  const fromPathname = await routeFromPathname(
    facts.pathnameCallFrameId,
    reader,
    budget,
  )
  if (fromPathname.status !== 'none') return pageOfFrameRead(fromPathname)
  const fromModule = await routeFromPageModuleFrame(
    facts.insideFrameUrls,
    reader,
    budget,
  )
  if (fromModule.status !== 'none') return pageOfFrameRead(fromModule)
  return entryRouteFromRequests(facts.entryRoute, reader.outstandingRequests())
}

/** Turns a source that answered (a route or a spent budget) into the page read's result. */
function pageOfFrameRead(
  read: Exclude<PageSourceRead, { status: 'none' }>,
): PagesRenderedPage {
  return read.status === 'timeout'
    ? { state: 'timed-out' }
    : { state: 'read', route: read.route, evidence: 'frame' }
}

/** Evaluates `pathname` on the traced call's synchronous frame; the frame does not exist after an `await`. */
async function routeFromPathname(
  callFrameId: string | undefined,
  reader: Pick<PagesHitReader, 'evaluateOnCallFrame'>,
  budget: VerdictBudget,
): Promise<PageSourceRead> {
  if (callFrameId === undefined) return NO_ROUTE
  const read = await readWithinVerdictBudget(
    () =>
      reader.evaluateOnCallFrame({
        callFrameId,
        expression: NEXT_PAGES_PAGE_EXPRESSION,
        // The expression is a plain identifier; these flags keep it from running anything else.
        silent: true,
        throwOnSideEffect: true,
        returnByValue: true,
      }),
    budget,
  )
  if (read.status === 'timeout') return { status: 'timeout' }
  if (read.status === 'failed' || read.value.exceptionDetails) return NO_ROUTE
  const { result } = read.value
  const route =
    result.type === 'string' && typeof result.value === 'string'
      ? renderedRouteOf(result.value)
      : undefined
  return route?.state === 'read'
    ? { status: 'route', route: route.route }
    : NO_ROUTE
}

/** Moves from the page-module frame nearest the data-function call frame to its route through the manifest. */
async function routeFromPageModuleFrame(
  insideFrameUrls: readonly string[],
  reader: Pick<PagesHitReader, 'pagesManifest'>,
  budget: VerdictBudget,
): Promise<PageSourceRead> {
  const compiledPaths = insideFrameUrls
    .map(pagesCompiledPathOfModuleUrl)
    .filter((path) => path !== undefined)
  // A stack without a page-module frame costs no manifest read.
  if (compiledPaths.length === 0) return NO_ROUTE
  const read = await readWithinVerdictBudget(
    () => reader.pagesManifest(),
    budget,
  )
  if (read.status === 'timeout') return { status: 'timeout' }
  if (read.status === 'failed' || read.value === undefined) return NO_ROUTE
  const entries = Object.entries(read.value)
  for (const compiledPath of compiledPaths) {
    const route = entries.find(([, compiled]) => compiled === compiledPath)?.[0]
    if (route !== undefined) return { status: 'route', route }
  }
  return NO_ROUTE
}

/** Names the entry page when the browser's only outstanding page request is for the entry route. */
function entryRouteFromRequests(
  entryRoute: string,
  requests: ReturnType<PagesHitReader['outstandingRequests']>,
): PagesRenderedPage {
  const pagePaths = requests
    .map(pagesRequestPathOf)
    .filter((path) => path !== undefined)
  const [onlyPagePath] = pagePaths
  return pagePaths.length === 1 &&
    onlyPagePath !== undefined &&
    isBrowserOnEntryRoute(onlyPagePath, entryRoute)
    ? { state: 'read', route: entryRoute, evidence: 'request' }
    : { state: 'unreadable' }
}
