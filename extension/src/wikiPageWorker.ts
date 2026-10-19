import { join } from 'node:path'
import {
  isMainThread,
  parentPort,
  Worker,
  workerData,
} from 'node:worker_threads'

import {
  WIKI_PAGE_WORKER_CONCURRENCY_LIMIT,
  WIKI_PAGE_WORKER_HEAP_LIMIT_MB,
  WIKI_PAGE_WORKER_IDLE_MS,
} from './constants'
import { servedWikiPageHtml } from './utils/servedWikiPageHtml'
import type { WikiPageRefusalReason } from './utils/wikiPageRefusalHtml'

/** How {@link servedWikiPageHtml} is told the editor, the reader's script address and the publication of the page it prepares. */
type ServedWikiPageOptions = Parameters<typeof servedWikiPageHtml>[1]
/** What {@link servedWikiPageOffThread} answers: the page as served, or why it is not served; a page file too large to prepare is refused by the reader before it is read. */
type ServedWikiPage =
  | { state: 'served'; html: string }
  | { state: Exclude<WikiPageRefusalReason, 'too-large'> }
/** What the reader hands a worker for each page: the page as the Wiki folder holds it and the options it is served with. */
type WikiPageRequest = { html: string; options: ServedWikiPageOptions }
/** What a worker is started with: the mark of a worker this module started. */
type WikiPageWorkerData = { role: typeof WIKI_PAGE_WORKER_ROLE }
/** A page asked for: what its worker is handed, the request's deadline and signal, how it is answered, and how it leaves the line of waiting pages when its request goes. */
type AskedWikiPage = {
  request: WikiPageRequest
  limits: { deadlineMs: number; signal: AbortSignal }
  answer: (page: ServedWikiPage) => void
  leaveLine: () => void
}

/** The mark of a worker this module started, so that a thread started by anyone else never runs the page preparation below. */
const WIKI_PAGE_WORKER_ROLE = 'codebook-wiki-page'

/** Workers that answered their last page and wait for the next one, newest last, each with the timer that stops it when no page comes. */
const idleWorkers: { worker: Worker; retirement: NodeJS.Timeout }[] = []
/** How many workers prepare a page now; never more than {@link WIKI_PAGE_WORKER_CONCURRENCY_LIMIT}. */
let busyWorkerCount = 0
/** Pages asked for while every worker was busy, oldest first. */
const waitingPages: AskedWikiPage[] = []

/**
 * Prepares one Wiki page for serving ({@link servedWikiPageHtml}) on a worker thread, so that the editor's extension host runs on while the page is read, and stops the worker when the deadline passes.
 * Why: the HTML parser takes time that grows with the square of the page on some crafted pages (from 13 s to minutes for 1 MB), and nothing limits the size of a page in the Wiki folder; on the host's own thread such a page would stop every extension of the window. The worker's heap is limited ({@link WIKI_PAGE_WORKER_HEAP_LIMIT_MB}), because it runs in the host's process, which a page of tens of megabytes would otherwise grow by gigabytes.
 * At most {@link WIKI_PAGE_WORKER_CONCURRENCY_LIMIT} workers prepare pages at once, so pages asked for together keep that many cores busy at most; a page asked for while every worker is busy waits for the first one free, and its deadline counts from then. A worker that answered its page waits {@link WIKI_PAGE_WORKER_IDLE_MS} for the next one and prepares it without loading the reader's code again ({@link servedWikiPageHtml} keeps nothing from one page to the next); a worker stopped at the deadline, one that failed and one whose request went are stopped and never reused, so a stopped worker takes nothing of a later page with it.
 * The worker is this module's compiled file, loaded from the folder of the running code (`dist`), where the package ships it as a bundle of its own.
 * Called by the Wiki reader for every HTML file it serves.
 * @param html - The page as the Wiki folder holds it.
 * @param options - How the page is served ({@link servedWikiPageHtml}).
 * @param limits.deadlineMs - How long the worker may take for the page, from the moment it takes it, before it is stopped.
 * @param limits.signal - Stops the worker early, or takes the page out of the line of waiting pages, when the request that asked for the page has gone.
 * @returns
 * - `{ state: 'served', html }` with the page as served
 * - `{ state: 'deadline' }` when the deadline passed first; the worker is stopped
 * - `{ state: 'failed' }` when the worker failed (its heap limit included), answered no page, or the request went, also while the page waited; never the page unprepared
 * @example
 * await servedWikiPageOffThread('<body></body>', { editorScheme: 'vscode', clientAddress: '/w/t/codebook-qa.js', publication: undefined }, { deadlineMs: 10_000, signal })
 * // => { state: 'served', html: '<body><script src="/w/t/codebook-qa.js"></script></body>' }
 */
export function servedWikiPageOffThread(
  html: string,
  options: ServedWikiPageOptions,
  limits: { deadlineMs: number; signal: AbortSignal },
): Promise<ServedWikiPage> {
  return new Promise((resolve) => {
    // A request that is gone needs no page.
    if (limits.signal.aborted) {
      resolve({ state: 'failed' })
      return
    }
    const page: AskedWikiPage = {
      request: { html, options },
      limits,
      answer: resolve,
      leaveLine: () => {
        const place = waitingPages.indexOf(page)
        if (place !== -1) waitingPages.splice(place, 1)
        resolve({ state: 'failed' })
      },
    }
    if (busyWorkerCount < WIKI_PAGE_WORKER_CONCURRENCY_LIMIT) {
      preparePage(page)
      return
    }
    // Every worker is busy: the page waits for the first one free, and leaves the line when its request goes.
    waitingPages.push(page)
    limits.signal.addEventListener('abort', page.leaveLine, { once: true })
  })
}

/**
 * Hands one page to an idle worker, or to a new one, and answers it once: with the page, at the deadline, at a failure or when the request goes. Afterwards the worker waits for the next page only when it answered a page; otherwise it is stopped. The first page waiting then gets a worker.
 * Called by {@link servedWikiPageOffThread} when a worker is free, and for the next waiting page whenever a page is answered.
 * @param page - The page asked for; its request has not gone.
 * @example preparePage({ request: { html, options }, limits, answer: resolve, leaveLine })
 */
function preparePage(page: AskedWikiPage): void {
  const worker = takeIdleWorker() ?? startPageWorker()
  busyWorkerCount += 1
  // A worker that prepares a page holds the process open until it answers.
  worker.ref()
  let isSettled = false
  /** Answers once, with the first of the page, the deadline, a failure and the request's end, and keeps or stops the worker. */
  const settle = (result: ServedWikiPage, isWorkerReusable: boolean): void => {
    if (isSettled) return
    isSettled = true
    clearTimeout(deadline)
    page.limits.signal.removeEventListener('abort', fail)
    worker.off('message', receive)
    worker.off('error', fail)
    worker.off('exit', fail)
    busyWorkerCount -= 1
    // Only a worker that answered a page waits for the next one: a worker stopped, failed or past the deadline may be in any state.
    if (isWorkerReusable) keepIdle(worker)
    else void worker.terminate()
    page.answer(result)
    startNextWaitingPage()
  }
  const receive = (message: unknown): void =>
    typeof message === 'string'
      ? settle({ state: 'served', html: message }, true)
      : settle({ state: 'failed' }, false)
  const fail = (): void => settle({ state: 'failed' }, false)
  const deadline = setTimeout(
    () => settle({ state: 'deadline' }, false),
    page.limits.deadlineMs,
  )
  page.limits.signal.addEventListener('abort', fail, { once: true })
  worker.once('message', receive)
  worker.once('error', fail)
  // An exit before the answer is a failure.
  worker.once('exit', fail)
  worker.postMessage(page.request)
}

/**
 * Starts a worker thread that prepares pages, under the heap limit; called by {@link preparePage} when no idle worker waits.
 * @returns The worker, which waits for its first page.
 * @example const worker = startPageWorker()
 */
function startPageWorker(): Worker {
  const data: WikiPageWorkerData = { role: WIKI_PAGE_WORKER_ROLE }
  // The heap limit bounds the memory a large page takes in the editor's process; a worker past it ends with an error, answered as a failure.
  const worker = new Worker(join(__dirname, 'wikiPageWorker.js'), {
    workerData: data,
    resourceLimits: { maxOldGenerationSizeMb: WIKI_PAGE_WORKER_HEAP_LIMIT_MB },
  })
  // An error is always followed by the worker's exit, which the page it prepares answers; between pages neither may reach the host as an uncaught error, and an idle worker that ends leaves the idle ones.
  worker.on('error', () => undefined)
  worker.once('exit', () => dropIdleWorker(worker))
  return worker
}

/**
 * Lets a worker that answered its page wait for the next one, and stops it when none comes within {@link WIKI_PAGE_WORKER_IDLE_MS}; called by {@link preparePage} after a page was served.
 * @param worker - The worker, which is idle now.
 * @example keepIdle(worker)
 */
function keepIdle(worker: Worker): void {
  // An idle worker holds neither the editor's process nor a test's open.
  worker.unref()
  const retirement = setTimeout(() => {
    dropIdleWorker(worker)
    void worker.terminate()
  }, WIKI_PAGE_WORKER_IDLE_MS)
  retirement.unref()
  idleWorkers.push({ worker, retirement })
}

/**
 * Takes the worker that answered a page last out of the idle ones; called by {@link preparePage}.
 * @returns The worker, or `undefined` when none is idle.
 * @example takeIdleWorker() // => the worker that served the page before, or undefined
 */
function takeIdleWorker(): Worker | undefined {
  const idle = idleWorkers.pop()
  clearTimeout(idle?.retirement)
  return idle?.worker
}

/**
 * Takes a worker out of the idle ones, when it is there; called when an idle worker's time is up and when any worker ends.
 * @param worker - The worker.
 * @example dropIdleWorker(worker)
 */
function dropIdleWorker(worker: Worker): void {
  const place = idleWorkers.findIndex((idle) => idle.worker === worker)
  if (place === -1) return
  const [dropped] = idleWorkers.splice(place, 1)
  clearTimeout(dropped?.retirement)
}

/**
 * Hands the oldest waiting page to the worker just freed; called by {@link preparePage} after every answer.
 * @example startNextWaitingPage()
 */
function startNextWaitingPage(): void {
  const next = waitingPages.shift()
  if (!next) return
  next.limits.signal.removeEventListener('abort', next.leaveLine)
  preparePage(next)
}

/**
 * Tells whether the data a worker thread was started with carries the mark of a worker {@link servedWikiPageOffThread} started; checked once when this module loads in a worker.
 * @param data - The thread's `workerData`.
 * @returns Whether the data carries this module's mark.
 * @example isOwnWorkerData({ role: 'codebook-wiki-page' }) // => true
 */
function isOwnWorkerData(data: unknown): data is WikiPageWorkerData {
  return (
    typeof data === 'object' &&
    data !== null &&
    'role' in data &&
    data.role === WIKI_PAGE_WORKER_ROLE
  )
}

/**
 * Tells whether a message a worker received is a page and the options it is served with, as {@link preparePage} hands them over.
 * @param message - The message.
 * @returns Whether it carries a page and its options.
 * @example isWikiPageRequest({ html: '<p></p>', options }) // => true
 */
function isWikiPageRequest(message: unknown): message is WikiPageRequest {
  return (
    typeof message === 'object' &&
    message !== null &&
    'html' in message &&
    typeof message.html === 'string' &&
    'options' in message &&
    typeof message.options === 'object' &&
    message.options !== null
  )
}

// In a worker this module started, prepare each page handed over and answer it, then wait for the next; anything but a page is answered with no page, and an error ends the worker; the reader answers both as a failure.
if (!isMainThread && parentPort && isOwnWorkerData(workerData)) {
  const port = parentPort
  port.on('message', (message: unknown) =>
    port.postMessage(
      isWikiPageRequest(message)
        ? servedWikiPageHtml(message.html, message.options)
        : null,
    ),
  )
}
