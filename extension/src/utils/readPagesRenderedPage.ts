import { NEXT_PAGES_PAGE_EXPRESSION } from '../constants'

import { pagesCompiledPathOfModuleUrl } from './pagesCompiledPathOfModuleUrl'
import type { PagesHitReader, PagesManifest } from './pagesHitReader'
import { pagesRequestPathOf } from './pagesRequestPathOf'
import {
  readWithinVerdictBudget,
  type BudgetedRead,
  type VerdictBudget,
} from './readWithinVerdictBudget'
import { renderedRouteOf } from './renderedRouteOf'
import { resolveNextPagesRoute } from './resolveNextPagesRoute'

/** The page a Pages hit renders, and what the answer rests on. */
export type PagesRenderedPage =
  | {
      state: 'read'
      route: string
      /** `frame`: the stack named the page (`pathname` of the renderer, or a page-module frame that the browser's one outstanding page request does not contradict). The browser's request is never the evidence of a page on its own. */
      evidence: 'frame'
    }
  /** No frame of the stack named the page, but the browser's one outstanding page request is for the entry route. That is a hint, never proof: the paused work can serve another page that the entry page's server code fetched, which the browser never sees. */
  | { state: 'named-by-request' }
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

/** The hit's `pages-manifest.json` read, started on first use so the sources that need it share one read. */
type ManifestReader = () => Promise<BudgetedRead<PagesManifest | undefined>>

/**
 * Reads which page a Pages hit renders, from the cheapest source that has the answer.
 *
 * Why it exists: Pages has no work store to ask, yet the data function of another page can run the same helper, so a hit is the learner's pause only when the page it renders is the entry page. Called by {@link pagesDataFunctionHitVerdictOf} once the data-function call frame is found.
 * In order: `pathname` evaluated on the synchronous frame of the traced call; else the page-module frame nearest the call frame, moved through `pages-manifest.json`, checked against the browser's outstanding page requests; else those requests alone (exactly one, resolved to its route through the whole manifest with Next's route precedence), which can only name the entry page as `named-by-request`, never read it. A source that fails or has no answer passes the read to the next; the budget ends the whole read.
 * The page-module frame names the module that defines the data function, not the page that calls it: another page may re-export the function (`export { getServerSideProps } from './original'`), and after an `await` only the defining module is on the stack. So a module frame that names the entry page is accepted unless the one outstanding page request resolves to another route, and a module frame that names another page is a confident answer only when that request resolves to the same route.
 * The browser's request is never the page's proof: the entry page's data function can fetch another page of the same Next server over HTTP, and that page's data function pauses while the browser sees only the entry request. Without a `pathname` frame or a page-module frame, a request for the entry route is therefore only `named-by-request`.
 * @param facts - The frame to evaluate on, the frames inside the call frame and the entry route.
 * @param reader - Evaluates, reads the manifest and lists the outstanding requests.
 * @param budget - The hit's single time budget.
 * @returns
 * - `read` with the page's route and the evidence (`frame`)
 * - `named-by-request` when no frame named the page and the browser's one outstanding page request resolves to the entry route
 * - `unreadable` when no source named a page: one request for another route, more than one request, or a manifest that cannot be read leaves the request without an answer, and a module frame that the request contradicts, or that names another page without a request to back it, is not an answer
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
  // The module frame and the request both need the manifest; one read serves both.
  let manifestRead: ReturnType<ManifestReader> | undefined
  const readManifest: ManifestReader = () =>
    (manifestRead ??= readWithinVerdictBudget(
      () => reader.pagesManifest(),
      budget,
    ))
  const fromModule = await routeFromPageModuleFrame(
    facts.insideFrameUrls,
    readManifest,
  )
  if (fromModule.status === 'timeout') return { state: 'timed-out' }
  const fromRequest = await routeFromRequests(
    reader.outstandingRequests(),
    readManifest,
  )
  if (fromRequest.status === 'timeout') return { state: 'timed-out' }
  return pageOfModuleAndRequest(facts.entryRoute, fromModule, fromRequest)
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
  readManifest: ManifestReader,
): Promise<PageSourceRead> {
  const compiledPaths = insideFrameUrls
    .map(pagesCompiledPathOfModuleUrl)
    .filter((path) => path !== undefined)
  // A stack without a page-module frame costs no manifest read.
  if (compiledPaths.length === 0) return NO_ROUTE
  const read = await readManifest()
  if (read.status === 'timeout') return { status: 'timeout' }
  if (read.status === 'failed' || read.value === undefined) return NO_ROUTE
  const entries = Object.entries(read.value)
  for (const compiledPath of compiledPaths) {
    const route = entries.find(([, compiled]) => compiled === compiledPath)?.[0]
    if (route !== undefined) return { status: 'route', route }
  }
  return NO_ROUTE
}

/**
 * Names the route of the browser's only outstanding page request, the way Next's router serves it.
 *
 * Why it exists: after an `await` the stack holds no page frame, and the request is the one fact that says which page the browser waits for, which backs or contradicts a page-module frame (it never decides the hit's page alone, see {@link pageOfModuleAndRequest}); matching it against the entry pattern alone would take a static sibling's request for the dynamic entry page. Called by {@link readPagesRenderedPage} for the outstanding requests of the hit.
 * The request path is resolved against the whole manifest with Next's route precedence ({@link resolveNextPagesRoute}), so a static sibling (`/products/new`) wins over the dynamic entry route (`/products/[id]`) exactly as it does for Next. Zero or several page requests name no page, and a manifest that cannot be read or lists no route for the path leaves the request unresolved, never guessed.
 */
async function routeFromRequests(
  requests: ReturnType<PagesHitReader['outstandingRequests']>,
  readManifest: ManifestReader,
): Promise<PageSourceRead> {
  const pagePaths = requests
    .map(pagesRequestPathOf)
    .filter((path) => path !== undefined)
  const [onlyPagePath] = pagePaths
  // Only one outstanding page request says which page the server renders, and only that one costs a manifest read.
  if (pagePaths.length !== 1 || onlyPagePath === undefined) return NO_ROUTE
  const read = await readManifest()
  if (read.status === 'timeout') return { status: 'timeout' }
  if (read.status === 'failed' || read.value === undefined) return NO_ROUTE
  try {
    const resolved = resolveNextPagesRoute(read.value, onlyPagePath)
    return resolved.kind === 'matched'
      ? { status: 'route', route: resolved.route }
      : NO_ROUTE
  } catch {
    // A path or a manifest value that does not parse resolves to no route.
    return NO_ROUTE
  }
}

/**
 * Joins what the page-module frame and the outstanding page request say into the page of the hit.
 *
 * Why it exists: the module frame names the module that defines the data function, which is not always the page that runs it, so neither source decides alone. Called by {@link readPagesRenderedPage} once both sources are read.
 * The module frame is the module that defines the data function, which another page may re-export, so it names the running page only when nothing contradicts it: a module of the entry page stands unless the request resolves to another route, and a module of another page stands only when the request resolves to that same route. With no module frame the request can only make the page `named-by-request` (when it resolves to the entry route), because the browser sees the request it sent and not the page the paused server work serves.
 */
function pageOfModuleAndRequest(
  entryRoute: string,
  fromModule: PageSourceRead,
  fromRequest: PageSourceRead,
): PagesRenderedPage {
  const moduleRoute =
    fromModule.status === 'route' ? fromModule.route : undefined
  const requestRoute =
    fromRequest.status === 'route' ? fromRequest.route : undefined
  // The request alone never reads the page: it is the browser's view, not the paused work's.
  if (moduleRoute === undefined)
    return requestRoute === entryRoute
      ? { state: 'named-by-request' }
      : { state: 'unreadable' }
  // Without a request the entry page's own module stands; another page's module has nothing to back it.
  const isModuleBacked =
    requestRoute === undefined
      ? moduleRoute === entryRoute
      : requestRoute === moduleRoute
  return isModuleBacked
    ? { state: 'read', route: moduleRoute, evidence: 'frame' }
    : { state: 'unreadable' }
}
