import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'
import * as workerThreads from 'node:worker_threads'

import * as constants from '../constants'
import type * as wikiPageWorkerModule from '../wikiPageWorker'
import { servedWikiPageOffThread } from '../wikiPageWorker'

import { loadModule } from './utils/loadModule'

/** How the tests serve a page: for the editor `vscode`, with the reader's script at a fixed address and no publication. */
const PAGE_OPTIONS = {
  editorScheme: 'vscode',
  clientAddress: '/w/t/codebook-qa.js',
  publication: undefined,
} as const

/** A page on which the HTML parser takes about 6 s on the development host: 10,000 open elements and 100,000 paragraph ends. */
const SLOW_PAGE = `<!doctype html><body>${'<x>'.repeat(10_000)}${'</p>'.repeat(100_000)}</body>`

/**
 * Loads the page-worker module with a `Worker` class that records each worker thread it starts and when that thread ends, so a test can tell how many workers prepared its pages; the threads themselves are the real ones, running the compiled worker file.
 * Called by the tests of the workers' reuse, limit and stop.
 * @param constantOverrides - Constants the loaded module reads instead of the shipped ones.
 * @returns The loaded module's {@link servedWikiPageOffThread}, the workers it started in their order, and the end of the worker started n-th (from 0): a promise that settles with `'ended'` when its thread has ended, or at once with `'never started'`.
 * @example
 * const pool = await loadPageWorkerRecordingThreads({})
 * await pool.servedWikiPageOffThread('<body></body>', PAGE_OPTIONS, limits)
 * pool.startedWorkers.length // => 1
 */
async function loadPageWorkerRecordingThreads(
  constantOverrides: Partial<Record<keyof typeof constants, unknown>>,
): Promise<{
  servedWikiPageOffThread: typeof servedWikiPageOffThread
  startedWorkers: workerThreads.Worker[]
  endOfWorker: (index: number) => Promise<'ended' | 'never started'>
}> {
  const startedWorkers: workerThreads.Worker[] = []
  const workerEnds: Promise<'ended'>[] = []
  /** The real Worker, noting each thread it starts and its end. */
  class RecordedWorker extends workerThreads.Worker {
    constructor(
      ...parameters: ConstructorParameters<typeof workerThreads.Worker>
    ) {
      super(...parameters)
      startedWorkers.push(this)
      workerEnds.push(
        new Promise((resolveEnd) =>
          this.once('exit', () => resolveEnd('ended')),
        ),
      )
    }
  }
  const loaded = await loadModule<typeof wikiPageWorkerModule>(
    join(__dirname, '..', 'wikiPageWorker.js'),
    {
      'node:worker_threads': { ...workerThreads, Worker: RecordedWorker },
      './constants': { ...constants, ...constantOverrides },
    },
  )
  return {
    servedWikiPageOffThread: loaded.servedWikiPageOffThread,
    startedWorkers,
    endOfWorker: (index) =>
      workerEnds[index] ?? Promise.resolve('never started'),
  }
}

/**
 * Waits for a promise for at most a while, so that a test whose awaited event never comes fails in its assertion instead of at the runner's timeout.
 * @param promise - What the test waits for.
 * @param waitMs - How long it waits at most.
 * @returns What the promise settled with, or `'still waiting'`.
 * @example await within(pool.endOfWorker(0), 2_000) // => 'ended'
 */
function within<Value>(
  promise: Promise<Value>,
  waitMs: number,
): Promise<Value | 'still waiting'> {
  return Promise.race([
    promise,
    new Promise<'still waiting'>((resolveWait) =>
      setTimeout(() => resolveWait('still waiting'), waitMs),
    ),
  ])
}

// Value: protects=the editor's extension host, in whose process the page worker runs, against a page in the Wiki folder large enough that its preparation takes gigabytes of memory before the deadline (a 20 MB page peaked at 1.6 GB, a 60 MB page at 4.1 GB); fails_when=the page worker starts without a heap limit again, so a page that needs more memory than the limit is prepared and served; why_new=P2P2; seam=the page-worker module loaded with loadModule and a constants module whose WIKI_PAGE_WORKER_HEAP_LIMIT_MB is 32 MB, so a page of 3 MB stands for one of 20 MB under the shipped 512 MB; no_claim=the peak memory of the editor's process (measured by hand, see the cycle record)
test('a page that needs more memory than a page worker may use is refused as failed, while a small page is still served under the same limit', async () => {
  // Arrange: a page worker that may use 32 MB of heap, a page of 3 MB of paragraphs and links, and a small page.
  const { servedWikiPageOffThread: servedUnderSmallHeap } = await loadModule<
    typeof wikiPageWorkerModule
  >(join(__dirname, '..', 'wikiPageWorker.js'), {
    './constants': { ...constants, WIKI_PAGE_WORKER_HEAP_LIMIT_MB: 32 },
  })
  const largePage = `<body>${'<p><a href="https://example.com/x">t</a><span>u</span></p>'.repeat(52_000)}</body>`
  const limits = {
    deadlineMs: 20_000,
    signal: new AbortController().signal,
  }

  // Act
  const large = await servedUnderSmallHeap(largePage, PAGE_OPTIONS, limits)
  const small = await servedUnderSmallHeap(
    '<body><p>Small page</p></body>',
    PAGE_OPTIONS,
    limits,
  )

  // Assert: only the large page's state is compared, so a page served by mistake is not printed in full; the small page's answer is copied out of the loaded module's context.
  assert.deepEqual(
    { large: large.state, small: { ...small } },
    {
      large: 'failed',
      small: {
        state: 'served',
        html: '<body><p>Small page</p><script src="/w/t/codebook-qa.js"></script></body>',
      },
    },
  )
})

// Value: protects=every ordinary Wiki page against a heap limit of the page worker set too low for it; fails_when=WIKI_PAGE_WORKER_HEAP_LIMIT_MB is lowered below what an ordinary page of more than 1 MB needs, so the learner gets the refusal page for an ordinary page; why_new=P2P2 (the limit it adds); seam=none; no_claim=pages larger than the 1.14 MB page (a 5 MB page was served by hand, a 20 MB page was refused)
test('an ordinary page of more than 1 MB is served under the page worker’s heap limit', async () => {
  // Arrange: a body of 9,000 sections of a heading, text, a link and code, 1,143,000 bytes.
  const sections =
    '<section><h2 id="s">Title</h2><p>Some text with <a href="https://example.com/x">a link</a> and <code>code</code>.</p></section>'.repeat(
      9_000,
    )
  const ordinaryPage = `<body>${sections}</body>`

  // Act
  const served = await servedWikiPageOffThread(ordinaryPage, PAGE_OPTIONS, {
    deadlineMs: 20_000,
    signal: new AbortController().signal,
  })

  // Assert: the page as served, the reader's script after its last section.
  assert.deepEqual(served, {
    state: 'served',
    html: `<body>${sections}<script src="/w/t/codebook-qa.js"></script></body>`,
  })
})

// Value: protects=the time of every page view of the Wiki reader: a new worker thread loads the reader's code cold for each page, an 18 KB page took 36 ms through a new worker against 3.2 ms on a warm thread; fails_when=the reader starts a new worker for a page while one that answered its last page waits idle, so every page view pays the start again; why_new=P2P3; seam=the page-worker module loaded with a Worker class that records the threads it starts (the threads are real); no_claim=the time saved (measured by hand: see the report)
test('two pages prepared one after another are prepared by the same worker thread', async () => {
  // Arrange
  const pool = await loadPageWorkerRecordingThreads({})
  const limits = { deadlineMs: 10_000, signal: new AbortController().signal }

  // Act
  const first = await pool.servedWikiPageOffThread(
    '<body><p>First page</p></body>',
    PAGE_OPTIONS,
    limits,
  )
  const second = await pool.servedWikiPageOffThread(
    '<body><p>Second page</p></body>',
    PAGE_OPTIONS,
    limits,
  )

  // Assert: both pages, and one worker started for them; the answers are copied out of the loaded module's context.
  assert.deepEqual(
    structuredClone({
      first,
      second,
      startedWorkers: pool.startedWorkers.length,
    }),
    {
      first: {
        state: 'served',
        html: '<body><p>First page</p><script src="/w/t/codebook-qa.js"></script></body>',
      },
      second: {
        state: 'served',
        html: '<body><p>Second page</p><script src="/w/t/codebook-qa.js"></script></body>',
      },
      startedWorkers: 1,
    },
  )
})

// Value: protects=every page after a page whose preparation passed the deadline: the stopped worker may be in any state, and a page handed to it would never be answered; fails_when=the worker stopped at the deadline is kept for the next page, or is not stopped at all and keeps a core busy; why_new=P2P3 (workers are reused after an answer); seam=the page-worker module loaded with a Worker class that records the threads it starts (the threads are real); no_claim=none
test('a worker stopped at the deadline prepares no later page: it ends, and the next page gets a new worker', async () => {
  // Arrange
  const pool = await loadPageWorkerRecordingThreads({})
  const signal = new AbortController().signal

  // Act: the slow page under a deadline of 500 ms, then a small page.
  const slow = await pool.servedWikiPageOffThread(SLOW_PAGE, PAGE_OPTIONS, {
    deadlineMs: 500,
    signal,
  })
  const next = await pool.servedWikiPageOffThread(
    '<body><p>Next page</p></body>',
    PAGE_OPTIONS,
    { deadlineMs: 10_000, signal },
  )
  const stoppedWorkerEnd = await within(pool.endOfWorker(0), 2_000)

  // Assert: the answers are copied out of the loaded module's context.
  assert.deepEqual(
    structuredClone({
      slow,
      next,
      startedWorkers: pool.startedWorkers.length,
      stoppedWorkerEnd,
    }),
    {
      slow: { state: 'deadline' },
      next: {
        state: 'served',
        html: '<body><p>Next page</p><script src="/w/t/codebook-qa.js"></script></body>',
      },
      startedWorkers: 2,
      stoppedWorkerEnd: 'ended',
    },
  )
})

// Value: protects=the editor's machine against many pages asked for at once (tabs, or a page that names others), each of which may keep a core busy until the deadline; fails_when=the reader starts a worker for every page asked for at once, or a page waiting for a worker is never served, or a page whose request went while it waited still gets a worker or keeps its answer until a worker is free; why_new=P2RT3; seam=the page-worker module loaded with a Worker class that records the threads it starts (the threads are real); no_claim=the number of cores of the learner's machine (the limit is the same everywhere)
test('no more than two pages are prepared at once: a third page waits for a free worker, and a page whose request goes while it waits is answered at once without a worker', async () => {
  // Arrange
  const pool = await loadPageWorkerRecordingThreads({})
  const signal = new AbortController().signal
  const fourthRequest = new AbortController()
  const answered = new Set<string>()
  /** Asks for a page and notes, by its name, when it is answered. */
  const ask = (
    name: string,
    html: string,
    limits: { deadlineMs: number; signal: AbortSignal },
  ): ReturnType<typeof servedWikiPageOffThread> =>
    pool.servedWikiPageOffThread(html, PAGE_OPTIONS, limits).then((page) => {
      answered.add(name)
      return page
    })

  // Act: two slow pages under a deadline of 2 s, then two small pages; the fourth page's request goes while it waits.
  const first = ask('first', SLOW_PAGE, { deadlineMs: 2_000, signal })
  const second = ask('second', SLOW_PAGE, { deadlineMs: 2_000, signal })
  const third = ask('third', '<body><p>Third page</p></body>', {
    deadlineMs: 10_000,
    signal,
  })
  const fourth = ask('fourth', '<body><p>Fourth page</p></body>', {
    deadlineMs: 10_000,
    signal: fourthRequest.signal,
  })
  const workersWhileTwoPagesArePrepared = pool.startedWorkers.length
  await new Promise((resolveWait) => setTimeout(resolveWait, 200))
  const answeredAfter200Ms = [...answered]
  fourthRequest.abort()
  const fourthAnswer = await within(fourth, 1_000)
  const answeredWhenTheFourthLeft = [...answered]
  const answers = await Promise.all([first, second, third])

  // Assert: the third page got the first worker free, a new one, since both slow pages' workers were stopped; the fourth got none. The answers are copied out of the loaded module's context.
  assert.deepEqual(
    structuredClone({
      workersWhileTwoPagesArePrepared,
      answeredAfter200Ms,
      fourthAnswer,
      answeredWhenTheFourthLeft,
      answers,
      startedWorkers: pool.startedWorkers.length,
    }),
    {
      workersWhileTwoPagesArePrepared: 2,
      answeredAfter200Ms: [],
      fourthAnswer: { state: 'failed' },
      answeredWhenTheFourthLeft: ['fourth'],
      answers: [
        { state: 'deadline' },
        { state: 'deadline' },
        {
          state: 'served',
          html: '<body><p>Third page</p><script src="/w/t/codebook-qa.js"></script></body>',
        },
      ],
      startedWorkers: 3,
    },
  )
})

// Value: protects=the editor's process against worker threads held for a reader nobody reads: each idle worker keeps its isolate and the heap of its last page; fails_when=a worker that answered its page is kept idle for good, or is stopped at once so no page reuses it; why_new=P2P3 (workers are reused after an answer); seam=the page-worker module loaded with a Worker class that records the threads it starts, and a constants module whose WIKI_PAGE_WORKER_IDLE_MS is 300 ms; no_claim=the memory an idle worker holds
test('a worker left without a page for longer than its idle time ends, and the next page gets a new worker', async () => {
  // Arrange
  const pool = await loadPageWorkerRecordingThreads({
    WIKI_PAGE_WORKER_IDLE_MS: 300,
  })
  const limits = { deadlineMs: 10_000, signal: new AbortController().signal }

  // Act: a page, a second page at once, then a third after the idle time.
  await pool.servedWikiPageOffThread(
    '<body><p>First page</p></body>',
    PAGE_OPTIONS,
    limits,
  )
  await pool.servedWikiPageOffThread(
    '<body><p>Second page</p></body>',
    PAGE_OPTIONS,
    limits,
  )
  const workersBeforeTheIdleTime = pool.startedWorkers.length
  const idleWorkerEnd = await within(pool.endOfWorker(0), 2_000)
  const third = await pool.servedWikiPageOffThread(
    '<body><p>Third page</p></body>',
    PAGE_OPTIONS,
    limits,
  )

  // Assert: the answer is copied out of the loaded module's context.
  assert.deepEqual(
    structuredClone({
      workersBeforeTheIdleTime,
      idleWorkerEnd,
      third,
      startedWorkers: pool.startedWorkers.length,
    }),
    {
      workersBeforeTheIdleTime: 1,
      idleWorkerEnd: 'ended',
      third: {
        state: 'served',
        html: '<body><p>Third page</p><script src="/w/t/codebook-qa.js"></script></body>',
      },
      startedWorkers: 2,
    },
  )
})
