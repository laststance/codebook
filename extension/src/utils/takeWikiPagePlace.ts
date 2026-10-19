import {
  WIKI_PAGE_WAITING_LIMIT,
  WIKI_PAGE_WORKER_CONCURRENCY_LIMIT,
} from '../constants'

/** How many Wiki pages hold a place now, in this extension host: their file is read, or they wait for a page worker or are prepared by one. */
let placedPageCount = 0

/**
 * Takes one of the places for Wiki pages in hand, before the page's file is read, or answers that every place is taken.
 *
 * Why: a page in hand keeps its file's bytes (up to {@link WIKI_PAGE_FILE_LIMIT_BYTES}, and a string of up to twice that) in the editor's extension host until it is answered. The page workers prepare {@link WIKI_PAGE_WORKER_CONCURRENCY_LIMIT} pages at once and let {@link WIKI_PAGE_WAITING_LIMIT} wait, so that many places keep every page that can be prepared, and a further page would only be read to be refused. The places are counted for the whole host, as its page workers are, whatever reader asks.
 * Trigger: the Wiki reader takes a place for every page file within the size limit before it opens it, and gives it back when the page is answered.
 *
 * @returns A function that gives the place back, which the caller calls once the page is answered (a further call does nothing); `undefined` when every place is taken, and the page is then refused without its file being read.
 *
 * @example
 * ```ts
 * const givePlaceBack = takeWikiPagePlace() // => a function, or undefined while six pages are in hand
 * try { await readAndPreparePage() } finally { givePlaceBack?.() }
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
