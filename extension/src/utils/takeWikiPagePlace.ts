import {
  WIKI_PAGE_WAITING_LIMIT,
  WIKI_PAGE_WORKER_CONCURRENCY_LIMIT,
} from '../constants'

/** How many Wiki pages hold a place now, in this extension host: their metadata or their file is read, they wait for a page worker or are prepared by one, or their answer has not left the host yet. */
let placedPageCount = 0

/**
 * Takes one of the places for Wiki pages in hand, before any file is read for the page, or answers that every place is taken.
 *
 * Why: a page in hand keeps its file's bytes (up to {@link WIKI_PAGE_FILE_LIMIT_BYTES}, and a string of up to twice that) in the editor's extension host until its answer has left the host, and before that the manifest and the publication identity the reader reads for it. The page workers prepare {@link WIKI_PAGE_WORKER_CONCURRENCY_LIMIT} pages at once and let {@link WIKI_PAGE_WAITING_LIMIT} wait, so that many places keep every page that can be prepared, and a further page would only be read to be refused. The places are counted for the whole host, as its page workers are, whatever reader asks.
 * Trigger: the Wiki reader takes a place for every page a browser opens before it reads the manifest, the publication identity or the page's file, and gives it back once the page's answer (the page, or a refusal) has left the host or its connection has closed; an answer the browser does not receive is ended at {@link WIKI_RESPONSE_SEND_LIMIT_MS}.
 *
 * @returns A function that gives the place back, which the caller calls once the page's answer is done (a further call does nothing); `undefined` when every place is taken, and the page is then refused without any file being read for it.
 *
 * @example
 * ```ts
 * const givePlaceBack = takeWikiPagePlace() // => a function, or undefined while six pages are in hand
 * if (givePlaceBack) response.once('close', givePlaceBack) // the answer has left the host, or its connection closed
 * ```
 */
export function takeWikiPagePlace(): (() => void) | undefined {
  if (
    placedPageCount >=
    WIKI_PAGE_WORKER_CONCURRENCY_LIMIT + WIKI_PAGE_WAITING_LIMIT
  )
    return undefined
  placedPageCount += 1
  let isGivenBack = false
  return (): void => {
    // A place is given back once, however often the caller calls.
    if (isGivenBack) return
    isGivenBack = true
    placedPageCount -= 1
  }
}
