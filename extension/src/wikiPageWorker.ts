import { join } from 'node:path'
import {
  isMainThread,
  parentPort,
  Worker,
  workerData,
} from 'node:worker_threads'

import { servedWikiPageHtml } from './utils/servedWikiPageHtml'
import type { WikiPageRefusalReason } from './utils/wikiPageRefusalHtml'

/** How {@link servedWikiPageHtml} is told the editor, the reader's script address and the publication of the page it prepares. */
type ServedWikiPageOptions = Parameters<typeof servedWikiPageHtml>[1]
/** What the reader hands the worker: the page as the Wiki folder holds it and the options it is served with, marked as Codebook's own. */
type WikiPageWorkerData = {
  role: typeof WIKI_PAGE_WORKER_ROLE
  html: string
  options: ServedWikiPageOptions
}

/** The mark of a worker this module started, so that a thread started by anyone else never runs the page preparation below. */
const WIKI_PAGE_WORKER_ROLE = 'codebook-wiki-page'

/**
 * Prepares one Wiki page for serving ({@link servedWikiPageHtml}) in a worker thread of its own, so that the editor's extension host runs on while the page is read, and stops the worker when the deadline passes.
 * Why: the HTML parser takes time that grows with the square of the page on some crafted pages (from 13 s to minutes for 1 MB), and nothing limits the size of a page in the Wiki folder; on the host's own thread such a page would stop every extension of the window. Each page gets a new worker, so a stopped worker takes nothing of a later page with it.
 * The worker is this module's compiled file, loaded from the folder of the running code (`dist`), where the package ships it as a bundle of its own.
 * Called by the Wiki reader for every HTML file it serves.
 * @param html - The page as the Wiki folder holds it.
 * @param options - How the page is served ({@link servedWikiPageHtml}).
 * @param limits.deadlineMs - How long the worker may take before it is stopped.
 * @param limits.signal - Stops the worker early, when the request that asked for the page has gone.
 * @returns
 * - `{ state: 'served', html }` with the page as served
 * - `{ state: 'deadline' }` when the deadline passed first; the worker is stopped
 * - `{ state: 'failed' }` when the worker failed, answered no page, or the request went; never the page unprepared
 * @example
 * await servedWikiPageOffThread('<body></body>', { editorScheme: 'vscode', clientAddress: '/w/t/codebook-qa.js', publication: undefined }, { deadlineMs: 10_000, signal })
 * // => { state: 'served', html: '<body><script src="/w/t/codebook-qa.js"></script></body>' }
 */
export function servedWikiPageOffThread(
  html: string,
  options: ServedWikiPageOptions,
  limits: { deadlineMs: number; signal: AbortSignal },
): Promise<
  { state: 'served'; html: string } | { state: WikiPageRefusalReason }
> {
  const data: WikiPageWorkerData = {
    role: WIKI_PAGE_WORKER_ROLE,
    html,
    options,
  }
  return new Promise((resolve) => {
    const worker = new Worker(join(__dirname, 'wikiPageWorker.js'), {
      workerData: data,
    })
    let isSettled = false
    /** Answers once, with the first of the page, the deadline, a failure and the request's end, and stops the worker. */
    const settle = (
      result:
        { state: 'served'; html: string } | { state: WikiPageRefusalReason },
    ): void => {
      if (isSettled) return
      isSettled = true
      clearTimeout(deadline)
      limits.signal.removeEventListener('abort', abandon)
      resolve(result)
      void worker.terminate()
    }
    const abandon = (): void => settle({ state: 'failed' })
    const deadline = setTimeout(
      () => settle({ state: 'deadline' }),
      limits.deadlineMs,
    )
    // A request that is gone needs no page; a signal aborted already stops the worker at once.
    if (limits.signal.aborted) abandon()
    else limits.signal.addEventListener('abort', abandon, { once: true })
    worker.once('message', (message: unknown) =>
      settle(
        typeof message === 'string'
          ? { state: 'served', html: message }
          : { state: 'failed' },
      ),
    )
    worker.once('error', () => settle({ state: 'failed' }))
    // An exit before any answer is a failure; after the page it changes nothing.
    worker.once('exit', () => settle({ state: 'failed' }))
  })
}

/**
 * Tells whether the data a worker thread was started with is the page and options {@link servedWikiPageOffThread} hands over; checked once when this module loads in a worker.
 * @param data - The thread's `workerData`.
 * @returns Whether the data carries this module's mark, a page and its options.
 * @example isOwnWorkerData({ role: 'codebook-wiki-page', html: '<p></p>', options }) // => true
 */
function isOwnWorkerData(data: unknown): data is WikiPageWorkerData {
  return (
    typeof data === 'object' &&
    data !== null &&
    'role' in data &&
    data.role === WIKI_PAGE_WORKER_ROLE &&
    'html' in data &&
    typeof data.html === 'string' &&
    'options' in data &&
    typeof data.options === 'object' &&
    data.options !== null
  )
}

// In a worker this module started, prepare the one page and answer it; an error ends the worker, which the reader answers as a failure.
if (!isMainThread && parentPort && isOwnWorkerData(workerData))
  parentPort.postMessage(
    servedWikiPageHtml(workerData.html, workerData.options),
  )
