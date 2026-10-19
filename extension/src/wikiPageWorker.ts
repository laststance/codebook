import { join } from 'node:path'
import { getHeapStatistics } from 'node:v8'
import {
  isMainThread,
  parentPort,
  Worker,
  workerData,
} from 'node:worker_threads'

import {
  WIKI_PAGE_WAITING_LIMIT,
  WIKI_PAGE_WORKER_CONCURRENCY_LIMIT,
  WIKI_PAGE_WORKER_HEAP_LIMIT_MB,
  WIKI_PAGE_WORKER_IDLE_MS,
  WIKI_PAGE_WORKER_REUSE_HEAP_LIMIT_BYTES,
} from './constants'
import { servedWikiPageHtml } from './utils/servedWikiPageHtml'
import type { WikiPageRefusalReason } from './utils/wikiPageRefusalHtml'

/** How {@link servedWikiPageHtml} is told the editor, the reader's script address and the publication of the page it prepares. */
type ServedWikiPageOptions = Parameters<typeof servedWikiPageHtml>[1]
/** What {@link servedWikiPageOffThread} answers: the page as served, or why it is not served. A page that needs more heap than a worker may use ({@link WIKI_PAGE_WORKER_HEAP_LIMIT_MB}) is too large, as a page file larger than the reader reads is. */
type ServedWikiPage =
  { state: 'served'; html: string } | { state: WikiPageRefusalReason }
/** What the reader hands a worker for each page: the page as the Wiki folder holds it and the options it is served with. */
type WikiPageRequest = { html: string; options: ServedWikiPageOptions }
/** What a worker answers for a page it prepared: the page as served, and the heap its thread holds then (V8's `total_heap_size`), by which the reader tells whether to keep the worker for the next page. */
type PreparedWikiPage = { html: string; heapBytes: number }
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
/** How many workers prepare a page now or are being stopped, each until its thread has ended; never more than {@link WIKI_PAGE_WORKER_CONCURRENCY_LIMIT}. The idle workers are never more than the places left free, so no more threads than that limit are alive at once, and their heaps stay within that many times {@link WIKI_PAGE_WORKER_HEAP_LIMIT_MB}. */
let busyWorkerCount = 0
/** How many of the busy workers are only ending: stopped, they prepare no page and hold their place until their thread has ended ({@link stopInItsPlace}). Each holds a place among the busy ones but no page, so the line takes one more page for it, and the pages the pool holds stay as many as with every worker preparing one. */
let endingWorkerCount = 0
/** Pages asked for while every worker was busy, oldest first; never more than {@link WIKI_PAGE_WAITING_LIMIT} and one more for each worker that is only ending, so the pages prepared and the pages waiting are never more than {@link WIKI_PAGE_WORKER_CONCURRENCY_LIMIT} and {@link WIKI_PAGE_WAITING_LIMIT} together, the pages the reader holds at once ({@link takeWikiPagePlace}). */
const waitingPages: AskedWikiPage[] = []

/**
 * Prepares one Wiki page for serving ({@link servedWikiPageHtml}) on a worker thread, so that the editor's extension host runs on while the page is read, and stops the worker when the deadline passes.
 * Why: the HTML parser takes time that grows with the square of the page on some crafted pages (from 13 s to minutes for 1 MB), well within the page file limit ({@link WIKI_PAGE_FILE_LIMIT_BYTES}); on the host's own thread such a page would stop every extension of the window. The worker's heap is limited ({@link WIKI_PAGE_WORKER_HEAP_LIMIT_MB}), because it runs in the host's process, which a crafted page would otherwise grow by many times its size (a page of 20 MB took 1.6 GB without a limit).
 * At most {@link WIKI_PAGE_WORKER_CONCURRENCY_LIMIT} workers prepare pages at once, so pages asked for together keep that many cores busy at most; a page asked for while every worker is busy waits for the first one free, and its deadline counts from then. A worker that is stopped keeps its place until its thread has ended, as it keeps its heap until then, so no new worker starts beside it. At most {@link WIKI_PAGE_WAITING_LIMIT} pages wait, each holding its page in the host's memory, and one more for each worker that is only ending, whose page was answered: the pages prepared and waiting are never more than the pages the reader holds at once ({@link takeWikiPagePlace}), so a page the reader admitted is never refused because a worker is still ending. A further page is answered at once as `busy`, so the wait is bounded too (the last waiting page gets a worker within two deadlines). A worker that answered its page with a heap of at most {@link WIKI_PAGE_WORKER_REUSE_HEAP_LIMIT_BYTES} waits {@link WIKI_PAGE_WORKER_IDLE_MS} for the next one and prepares it without loading the reader's code again ({@link servedWikiPageHtml} keeps nothing from one page to the next); a waiting worker keeps the heap its pages grew it to, so one whose heap grew past that bound is stopped after its answer. A worker stopped at the deadline, one that failed and one whose request went are stopped and never reused, so a stopped worker takes nothing of a later page with it.
 * The worker is this module's compiled file, loaded from the folder of the running code (`dist`), where the package ships it as a bundle of its own.
 * Called by the Wiki reader for every HTML file it serves.
 * @param html - The page as the Wiki folder holds it.
 * @param options - How the page is served ({@link servedWikiPageHtml}).
 * @param limits.deadlineMs - How long the worker may take for the page, from the moment it takes it, before it is stopped.
 * @param limits.signal - Stops the worker early, or takes the page out of the line of waiting pages, when the request that asked for the page has gone.
 * @returns
 * - `{ state: 'served', html }` with the page as served
 * - `{ state: 'deadline' }` when the deadline passed first; the worker is stopped
 * - `{ state: 'too-large' }` when the worker reached its heap limit ({@link WIKI_PAGE_WORKER_HEAP_LIMIT_MB}, `ERR_WORKER_OUT_OF_MEMORY`): a reload would only run another worker to the same end
 * - `{ state: 'busy' }` at once when every worker is busy and {@link WIKI_PAGE_WAITING_LIMIT} pages wait already, and one more for each worker that is only ending; no worker starts for it
 * - `{ state: 'failed' }` when the worker failed otherwise, answered no page, or the request went, also while the page waited; never the page unprepared
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
    // Every worker is busy and the line is full: the page would only hold its bytes in the host for a wait that long. A worker that is only ending holds no page, so its page's place goes to the line.
    if (waitingPages.length >= WIKI_PAGE_WAITING_LIMIT + endingWorkerCount) {
      resolve({ state: 'busy' })
      return
    }
    // Every worker is busy: the page waits for the first one free, and leaves the line when its request goes.
    waitingPages.push(page)
    limits.signal.addEventListener('abort', page.leaveLine, { once: true })
  })
}

/**
 * Hands one page to an idle worker, or to a new one, and answers it once: with the page, at the deadline, at a failure or when the request goes. Afterwards the worker waits for the next page only when it answered a page, and the first page waiting then gets a worker; otherwise it is stopped, and the first page waiting gets a worker once the stopped one's thread has ended ({@link stopInItsPlace}). A page whose new worker cannot start is answered as failed at once, and the first page waiting then tries a worker of its own; a page that waited keeps its cancellation from the line until its worker took it.
 * Called by {@link servedWikiPageOffThread} when a worker is free, and for the next waiting page whenever a page is answered.
 * @param page - The page asked for; its request has not gone.
 * @example preparePage({ request: { html, options }, limits, answer: resolve, leaveLine })
 */
function preparePage(page: AskedWikiPage): void {
  const worker = takeIdleWorker() ?? startPageWorker()
  // A worker that cannot start prepares no page: this page is answered, and the next waiting page is not left behind it.
  if (!worker) {
    page.limits.signal.removeEventListener('abort', page.leaveLine)
    page.answer({ state: 'failed' })
    startNextWaitingPage()
    return
  }
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
    worker.off('error', failWith)
    worker.off('exit', fail)
    // Only a worker that answered a page waits for the next one: a worker stopped, failed or past the deadline may be in any state.
    if (!isWorkerReusable) {
      page.answer(result)
      stopInItsPlace(worker)
      return
    }
    busyWorkerCount -= 1
    keepIdle(worker)
    page.answer(result)
    startNextWaitingPage()
  }
  // A worker waits for the next page only while its heap is small: a waiting worker keeps the heap its pages grew it to, and every page it serves starts its idle time again.
  const receive = (message: unknown): void =>
    isPreparedWikiPage(message)
      ? settle(
          { state: 'served', html: message.html },
          message.heapBytes <= WIKI_PAGE_WORKER_REUSE_HEAP_LIMIT_BYTES,
        )
      : settle({ state: 'failed' }, false)
  const fail = (): void => settle({ state: 'failed' }, false)
  // A worker past its heap limit ends with ERR_WORKER_OUT_OF_MEMORY: the page needs more memory than a worker may use, which no reload changes.
  const failWith = (error: unknown): void =>
    settle({ state: isOutOfMemory(error) ? 'too-large' : 'failed' }, false)
  const deadline = setTimeout(
    () => settle({ state: 'deadline' }, false),
    page.limits.deadlineMs,
  )
  page.limits.signal.addEventListener('abort', fail, { once: true })
  // The page's cancellation passes from the line to its worker only now, when the worker has taken the page.
  page.limits.signal.removeEventListener('abort', page.leaveLine)
  worker.once('message', receive)
  worker.once('error', failWith)
  // An exit before the answer is a failure.
  worker.once('exit', fail)
  worker.postMessage(page.request)
}

/**
 * Starts a worker thread that prepares pages, under the heap limit; called by {@link preparePage} when no idle worker waits.
 * @returns The worker, which waits for its first page; `undefined` when `new Worker` throws, as it does when the system gives it no thread (`ERR_WORKER_INIT_FAILED`), so the throw never escapes from the event that freed a worker.
 * @example const worker = startPageWorker() // => a Worker, or undefined when none can start
 */
function startPageWorker(): Worker | undefined {
  const data: WikiPageWorkerData = { role: WIKI_PAGE_WORKER_ROLE }
  let worker: Worker
  try {
    // The heap limit bounds the memory a large page takes in the editor's process; a worker past it ends with ERR_WORKER_OUT_OF_MEMORY, and its page is answered as too large.
    worker = new Worker(join(__dirname, 'wikiPageWorker.js'), {
      workerData: data,
      resourceLimits: {
        maxOldGenerationSizeMb: WIKI_PAGE_WORKER_HEAP_LIMIT_MB,
      },
    })
  } catch {
    return undefined
  }
  // An error is always followed by the worker's exit, which the page it prepares answers; between pages neither may reach the host as an uncaught error, and an idle worker that ends leaves the idle ones.
  worker.on('error', () => undefined)
  worker.once('exit', () => dropIdleWorker(worker))
  return worker
}

/**
 * Stops a worker that holds a place among the busy ones, and gives that place to the first waiting page only once the worker's thread has ended; meanwhile the worker counts as only ending ({@link endingWorkerCount}), and the line of waiting pages takes one more page.
 * Why: `terminate` only asks the thread to stop, and the thread keeps its heap (up to {@link WIKI_PAGE_WORKER_HEAP_LIMIT_MB}) until its `exit`; a place given back at once let a new worker start beside it, so pages stopped at the deadline one after another kept more than {@link WIKI_PAGE_WORKER_CONCURRENCY_LIMIT} heaps at once.
 * Called by {@link preparePage} for a worker that was stopped, failed, passed the deadline or lost its request, and by {@link keepIdle} for an idle worker whose time is up, which takes a place for its stop.
 * @param worker - The worker; its place is counted in {@link busyWorkerCount}.
 * @example stopInItsPlace(worker) // the place is free, and the next waiting page starts, once the thread has ended
 */
function stopInItsPlace(worker: Worker): void {
  // Until its thread has ended, the worker prepares no page, and the line takes a page in its page's place.
  endingWorkerCount += 1
  /** Gives the place back and hands it to the first waiting page. */
  const freePlace = (): void => {
    endingWorkerCount -= 1
    busyWorkerCount -= 1
    startNextWaitingPage()
  }
  // The stop of a worker that ended already settles at once; a stop that fails frees the place too, so no page waits for good.
  void worker.terminate().then(freePlace, freePlace)
}

/**
 * Lets a worker that answered its page wait for the next one, and stops it when none comes within {@link WIKI_PAGE_WORKER_IDLE_MS}; called by {@link preparePage} after a page was served by a worker whose heap is within {@link WIKI_PAGE_WORKER_REUSE_HEAP_LIMIT_BYTES}.
 * @param worker - The worker, which is idle now.
 * @example keepIdle(worker)
 */
function keepIdle(worker: Worker): void {
  // An idle worker holds neither the editor's process nor a test's open.
  worker.unref()
  const retirement = setTimeout(() => {
    dropIdleWorker(worker)
    // The idle worker takes a place for its stop, which is free, since the idle workers are never more than the free places, so no page's worker starts beside its thread.
    busyWorkerCount += 1
    stopInItsPlace(worker)
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
 * Hands the oldest waiting page to the worker just freed; called by {@link preparePage} after every answer. The page keeps its cancellation from the line until {@link preparePage} gave it a worker.
 * @example startNextWaitingPage()
 */
function startNextWaitingPage(): void {
  const next = waitingPages.shift()
  if (!next) return
  preparePage(next)
}

/**
 * Tells whether a worker's error is the end at its heap limit ({@link WIKI_PAGE_WORKER_HEAP_LIMIT_MB}); asked by {@link preparePage} for the error a worker ends with.
 * @param error - What the worker's `error` event carried.
 * @returns Whether its code is `ERR_WORKER_OUT_OF_MEMORY`.
 * @example isOutOfMemory(Object.assign(new Error('Worker terminated due to reaching memory limit'), { code: 'ERR_WORKER_OUT_OF_MEMORY' })) // => true
 */
function isOutOfMemory(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ERR_WORKER_OUT_OF_MEMORY'
  )
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
 * Tells whether a worker's answer is a prepared page and the heap the worker holds, as the worker below posts them; anything else is answered as a failure.
 * @param message - The worker's answer.
 * @returns Whether it carries the page as served and a heap size.
 * @example isPreparedWikiPage({ html: '<p></p>', heapBytes: 20_000_000 }) // => true
 */
function isPreparedWikiPage(message: unknown): message is PreparedWikiPage {
  return (
    typeof message === 'object' &&
    message !== null &&
    'html' in message &&
    typeof message.html === 'string' &&
    'heapBytes' in message &&
    typeof message.heapBytes === 'number'
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

// In a worker this module started, prepare each page handed over and answer it with the heap the thread holds then, then wait for the next; anything but a page is answered with no page, and an error ends the worker; the reader answers both as a failure.
if (!isMainThread && parentPort && isOwnWorkerData(workerData)) {
  const port = parentPort
  port.on('message', (message: unknown) => {
    if (!isWikiPageRequest(message)) {
      port.postMessage(null)
      return
    }
    const prepared: PreparedWikiPage = {
      html: servedWikiPageHtml(message.html, message.options),
      heapBytes: getHeapStatistics().total_heap_size,
    }
    port.postMessage(prepared)
  })
}
