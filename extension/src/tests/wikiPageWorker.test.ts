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
 * @returns The loaded module's {@link servedWikiPageOffThread}, the workers it started in their order, the start of the worker started n-th (from 0): a promise that settles with `'online'` when its thread runs, or at once with `'never started'`, and that worker's end: a promise that settles with `'ended'` when its thread has ended, or at once with `'never started'`.
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
  onlineOfWorker: (index: number) => Promise<'online' | 'never started'>
  endOfWorker: (index: number) => Promise<'ended' | 'never started'>
}> {
  const startedWorkers: workerThreads.Worker[] = []
  const workerOnlines: Promise<'online'>[] = []
  const workerEnds: Promise<'ended'>[] = []
  /** The real Worker, noting each thread it starts, the moment it runs and its end. */
  class RecordedWorker extends workerThreads.Worker {
    constructor(
      ...parameters: ConstructorParameters<typeof workerThreads.Worker>
    ) {
      super(...parameters)
      startedWorkers.push(this)
      workerOnlines.push(
        new Promise((resolveOnline) =>
          this.once('online', () => resolveOnline('online')),
        ),
      )
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
    onlineOfWorker: (index) =>
      workerOnlines[index] ?? Promise.resolve('never started'),
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

// Value: protects=the editor's extension host, in whose process the page worker runs, against a page in the Wiki folder large enough that its preparation takes gigabytes of memory before the deadline (a 20 MB page peaked at 1.6 GB, a 60 MB page at 4.1 GB); fails_when=the page worker starts without a heap limit again, so a page that needs more memory than the limit is prepared and served, or a worker past its heap limit is answered as a failure, whose sentence advises a reload that only runs another worker to the same end; why_new=P2P2; Cycle 0047 row 22 (P3M2) the state too-large; seam=the page-worker module loaded with loadModule and a constants module whose WIKI_PAGE_WORKER_HEAP_LIMIT_MB is 32 MB, so a page of 3 MB stands for one too large for the shipped 256 MB (which refuses a page of 8 MB, see WIKI_PAGE_WORKER_HEAP_LIMIT_MB); no_claim=the peak memory of the editor's process (measured by hand, see the cycle record)
test('a page that needs more memory than a page worker may use is refused as too large, while a small page is still served under the same limit', async () => {
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
      large: 'too-large',
      small: {
        state: 'served',
        html: '<body><p>Small page</p><script src="/w/t/codebook-qa.js"></script></body>',
      },
    },
  )
})

// Value: protects=the editor's extension host, in whose process every page worker runs: under the former limit of 512 MB one worker took 0.5 to 0.75 GB before it was refused or served (Node 24), two at once twice that, and Electron's V8 may keep every isolate of the process in one pointer-compression area; fails_when=WIKI_PAGE_WORKER_HEAP_LIMIT_MB or WIKI_PAGE_WORKER_CONCURRENCY_LIMIT is raised so that the workers that may run at once may together hold more old-generation heap than one worker could before (512 MB); why_new=Cycle 0047 row 4 (S11-F3); seam=none (the shipped constants); no_claim=the memory of the real editor hosts (VS Code, Cursor), which are measured by hand; that an ordinary page still fits (the test below)
test('the page workers that may run at once may together use no more heap than one page worker could before Cycle 0047', () => {
  // Arrange: the heap limit of one page worker until Cycle 0046.
  const formerHeapLimitOfOneWorkerMb = 512

  // Act
  const heapOfAllWorkersAtOnceMb =
    constants.WIKI_PAGE_WORKER_HEAP_LIMIT_MB *
    constants.WIKI_PAGE_WORKER_CONCURRENCY_LIMIT

  // Assert
  assert.ok(
    heapOfAllWorkersAtOnceMb <= formerHeapLimitOfOneWorkerMb,
    `the page workers may use ${heapOfAllWorkersAtOnceMb} MB of heap together`,
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

// Value: protects=the editor's extension host against many pages asked for at once (a page that names hundreds of others, a script that opens them): each waiting page kept its page (up to 2 MiB, and a string of twice that) in the host's memory, and the line had no end (a probe kept 100 pages waiting beside two workers); fails_when=the line of pages waiting for a worker takes more than WIKI_PAGE_WAITING_LIMIT pages, so a further page waits instead of being refused at once, or a page that found room in the line is not served; why_new=Cycle 0047 row 3 (S11-X1); seam=the page-worker module loaded with a Worker class that records the threads it starts (the threads are real), under the shipped limits; no_claim=the reader's refusal before it reads a page file (deepWikiReader.test.ts)
test('while two pages are prepared and four wait, a further page is refused as busy at once without a worker, and the four waiting pages are still served', async () => {
  // Arrange: two slow pages under a deadline of 1.5 s take both workers, and four small pages wait.
  const pool = await loadPageWorkerRecordingThreads({})
  const signal = new AbortController().signal
  const slowPages = [
    pool.servedWikiPageOffThread(SLOW_PAGE, PAGE_OPTIONS, {
      deadlineMs: 1_500,
      signal,
    }),
    pool.servedWikiPageOffThread(SLOW_PAGE, PAGE_OPTIONS, {
      deadlineMs: 1_500,
      signal,
    }),
  ]
  const waitingPages = [1, 2, 3, 4].map((number) =>
    pool.servedWikiPageOffThread(
      `<body><p>Waiting page ${number}</p></body>`,
      PAGE_OPTIONS,
      { deadlineMs: 10_000, signal },
    ),
  )

  // Act
  const further = await within(
    pool.servedWikiPageOffThread(
      '<body><p>Further page</p></body>',
      PAGE_OPTIONS,
      { deadlineMs: 10_000, signal },
    ),
    500,
  )
  const workersWhenTheFurtherPageWasAnswered = pool.startedWorkers.length
  const answers = await Promise.all([...slowPages, ...waitingPages])

  // Assert: the answers are copied out of the loaded module's context.
  assert.deepEqual(
    structuredClone({ further, workersWhenTheFurtherPageWasAnswered, answers }),
    {
      further: { state: 'busy' },
      workersWhenTheFurtherPageWasAnswered: 2,
      answers: [
        { state: 'deadline' },
        { state: 'deadline' },
        {
          state: 'served',
          html: '<body><p>Waiting page 1</p><script src="/w/t/codebook-qa.js"></script></body>',
        },
        {
          state: 'served',
          html: '<body><p>Waiting page 2</p><script src="/w/t/codebook-qa.js"></script></body>',
        },
        {
          state: 'served',
          html: '<body><p>Waiting page 3</p><script src="/w/t/codebook-qa.js"></script></body>',
        },
        {
          state: 'served',
          html: '<body><p>Waiting page 4</p><script src="/w/t/codebook-qa.js"></script></body>',
        },
      ],
    },
  )
})

// Value: protects=the editor's process against worker threads held for a reader nobody reads: each idle worker keeps its isolate and the heap that the pages it prepared grew it to, up to WIKI_PAGE_WORKER_REUSE_HEAP_LIMIT_BYTES; fails_when=a worker that answered its page is kept idle for good, or is stopped at once so no page reuses it; why_new=P2P3 (workers are reused after an answer); Cycle 0047 row 17 (P3P1) the heap an idle worker keeps is the one its pages grew it to, not its last page's; seam=the page-worker module loaded with a Worker class that records the threads it starts, and a constants module whose WIKI_PAGE_WORKER_IDLE_MS is 300 ms; no_claim=the memory an idle worker holds (the bound on it has its own test)
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

// Value: protects=the editor's process against an idle page worker that holds the heap its largest page grew it to (after the ordinary page of 1.14 MB 150 to 190 MB on the development host, after an 8 MB page about 0.64 GB) for as long as pages keep coming, since every page it serves starts its idle time again; fails_when=a worker whose heap grew past WIKI_PAGE_WORKER_REUSE_HEAP_LIMIT_BYTES while it prepared its page is kept for the next page; why_new=Cycle 0047 row 17 (P3P1 = P3RT1); seam=the page-worker module loaded with a Worker class that records the threads it starts (the threads are real); no_claim=the exact heap a page leaves, which differs between V8 versions (this page leaves more than twice the bound on the development host)
test('a worker whose heap grew large while it prepared an ordinary page of more than 1 MB ends after its answer, and the next page gets a new worker', async () => {
  // Arrange: a body of 9,000 sections of a heading, text, a link and code, 1,143,000 bytes.
  const pool = await loadPageWorkerRecordingThreads({})
  const sections =
    '<section><h2 id="s">Title</h2><p>Some text with <a href="https://example.com/x">a link</a> and <code>code</code>.</p></section>'.repeat(
      9_000,
    )
  const limits = { deadlineMs: 20_000, signal: new AbortController().signal }

  // Act
  const large = await pool.servedWikiPageOffThread(
    `<body>${sections}</body>`,
    PAGE_OPTIONS,
    limits,
  )
  const largePageWorkerEnd = await within(pool.endOfWorker(0), 2_000)
  const next = await pool.servedWikiPageOffThread(
    '<body><p>Next page</p></body>',
    PAGE_OPTIONS,
    limits,
  )

  // Assert: only the large page's state is compared, so its page is not printed in full; the answers are copied out of the loaded module's context.
  assert.deepEqual(
    structuredClone({
      large: large.state,
      largePageWorkerEnd,
      next,
      startedWorkers: pool.startedWorkers.length,
    }),
    {
      large: 'served',
      largePageWorkerEnd: 'ended',
      next: {
        state: 'served',
        html: '<body><p>Next page</p><script src="/w/t/codebook-qa.js"></script></body>',
      },
      startedWorkers: 2,
    },
  )
})

// Value: protects=the editor's machine and every later page against a request that goes while its page is prepared (a reload, a closed tab): its worker must stop at once and its place go to the next page; fails_when=an aborted page leaves its worker running until the deadline, or keeps its place among the busy workers, so the next page waits for the deadline or for good; why_new=P2T5; Cycle 0047 row 75 (P5-T1) the request goes once the slow page's thread runs, not after a sleep of 200 ms; seam=the page-worker module loaded with a Worker class that records the threads it starts and when each runs (the threads are real), and a constants module whose WIKI_PAGE_WORKER_CONCURRENCY_LIMIT is 1, so the one place is the aborted page's; no_claim=the reader's abort when the response closes (the reader test covers it)
test('a page whose request goes while it is prepared stops its worker, and the next page gets its place at once', async () => {
  // Arrange: one worker at a time, and the slow page under a deadline of 30 s, whose worker's thread runs before the Act.
  const pool = await loadPageWorkerRecordingThreads({
    WIKI_PAGE_WORKER_CONCURRENCY_LIMIT: 1,
  })
  const slowRequest = new AbortController()
  const slow = pool.servedWikiPageOffThread(SLOW_PAGE, PAGE_OPTIONS, {
    deadlineMs: 30_000,
    signal: slowRequest.signal,
  })
  const slowPageWorkerStart = await within(pool.onlineOfWorker(0), 2_000)

  // Act: the slow page's request goes, then the next page is asked for.
  slowRequest.abort()
  const slowAnswer = await within(slow, 1_000)
  const next = await within(
    pool.servedWikiPageOffThread(
      '<body><p>Next page</p></body>',
      PAGE_OPTIONS,
      {
        deadlineMs: 10_000,
        signal: new AbortController().signal,
      },
    ),
    5_000,
  )
  const abortedWorkerEnd = await within(pool.endOfWorker(0), 2_000)

  // Assert: the answers are copied out of the loaded module's context.
  assert.deepEqual(
    structuredClone({
      slowPageWorkerStart,
      slowAnswer,
      next,
      abortedWorkerEnd,
      startedWorkers: pool.startedWorkers.length,
    }),
    {
      slowPageWorkerStart: 'online',
      slowAnswer: { state: 'failed' },
      next: {
        state: 'served',
        html: '<body><p>Next page</p><script src="/w/t/codebook-qa.js"></script></body>',
      },
      abortedWorkerEnd: 'ended',
      startedWorkers: 2,
    },
  )
})

// Value: protects=an ordinary page asked for while crafted pages hold every page worker (tabs restored); fails_when=a waiting page's deadline counts from its request instead of from the moment a worker takes it, so the page is refused as past its deadline; why_new=the P2RT3 test's waiting page has 10 s, more than its wait; seam=the page-worker module loaded with one worker at a time; no_claim=the shipped limit of two workers
test('a page that waited for a free worker gets its whole deadline from the moment a worker takes it, and is served', async () => {
  // Arrange: one worker at a time.
  const pool = await loadPageWorkerRecordingThreads({
    WIKI_PAGE_WORKER_CONCURRENCY_LIMIT: 1,
  })
  const signal = new AbortController().signal

  // Act: the slow page under a deadline of 1.5 s, and a small page under a deadline of 1 s asked for while the slow page is prepared.
  const slow = pool.servedWikiPageOffThread(SLOW_PAGE, PAGE_OPTIONS, {
    deadlineMs: 1_500,
    signal,
  })
  const waiting = pool.servedWikiPageOffThread(
    '<body><p>Waiting page</p></body>',
    PAGE_OPTIONS,
    { deadlineMs: 1_000, signal },
  )
  const answers = await Promise.all([slow, waiting])

  // Assert: the answers are copied out of the loaded module's context.
  assert.deepEqual(structuredClone(answers), [
    { state: 'deadline' },
    {
      state: 'served',
      html: '<body><p>Waiting page</p><script src="/w/t/codebook-qa.js"></script></body>',
    },
  ])
})

// Value: protects=the editor's machine against a page whose request went before the reader handed it over (the reader hands such a page over with its signal aborted, G7): it must take no worker and no place among the busy ones; fails_when=the pool starts a worker for a page whose signal is aborted already, which no abort event then stops, so the page is prepared to its end or its deadline; why_new=Step 7 pass 3 W4 (the early answer became reachable with G7); seam=the page-worker module loaded with a Worker class that records the threads it starts; no_claim=none
test('a page whose request went before it was asked for is answered as failed at once, and no worker starts for it', async () => {
  // Arrange: a request that is gone already.
  const pool = await loadPageWorkerRecordingThreads({})
  const goneRequest = new AbortController()
  goneRequest.abort()

  // Act
  const answer = await within(
    pool.servedWikiPageOffThread(
      '<body><p>Gone page</p></body>',
      PAGE_OPTIONS,
      { deadlineMs: 10_000, signal: goneRequest.signal },
    ),
    1_000,
  )

  // Assert: the answer is copied out of the loaded module's context.
  assert.deepEqual(
    structuredClone({ answer, startedWorkers: pool.startedWorkers.length }),
    { answer: { state: 'failed' }, startedWorkers: 0 },
  )
})

/**
 * Loads the page-worker module with a `Worker` class whose chosen starts throw as `new Worker` throws when the system gives it no thread (`ERR_WORKER_INIT_FAILED`); every other start runs the real compiled worker file.
 * Called by the tests of a worker that cannot start.
 * @param failingStarts - Which starts throw, counted from 0 in the order the module asks for workers.
 * @param constantOverrides - Constants the loaded module reads instead of the shipped ones.
 * @returns The loaded module's {@link servedWikiPageOffThread}, how many starts it asked for, the failed ones included, and the start of the thread of the n-th start (from 0): a promise that settles with `'online'` when that thread runs, or at once with `'never started'` for a start that threw or was not asked for.
 * @example
 * const pool = await loadPageWorkerWhoseStartsFail([0], {})
 * await pool.servedWikiPageOffThread('<body></body>', PAGE_OPTIONS, limits) // => { state: 'failed' }
 * pool.startAttempts() // => 1
 * await pool.onlineOfStart(0) // => 'never started'
 */
async function loadPageWorkerWhoseStartsFail(
  failingStarts: number[],
  constantOverrides: Partial<Record<keyof typeof constants, unknown>>,
): Promise<{
  servedWikiPageOffThread: typeof servedWikiPageOffThread
  startAttempts: () => number
  onlineOfStart: (attempt: number) => Promise<'online' | 'never started'>
}> {
  let startAttempts = 0
  const onlines = new Map<number, Promise<'online'>>()
  /** The real Worker, except at the chosen starts, where it throws before any thread starts; each thread that starts notes the moment it runs. */
  class WorkerWhoseStartsFail extends workerThreads.Worker {
    constructor(
      ...parameters: ConstructorParameters<typeof workerThreads.Worker>
    ) {
      const attempt = startAttempts
      startAttempts += 1
      if (failingStarts.includes(attempt))
        throw Object.assign(new Error('The Worker initialization failed'), {
          code: 'ERR_WORKER_INIT_FAILED',
        })
      super(...parameters)
      onlines.set(
        attempt,
        new Promise((resolveOnline) =>
          this.once('online', () => resolveOnline('online')),
        ),
      )
    }
  }
  const loaded = await loadModule<typeof wikiPageWorkerModule>(
    join(__dirname, '..', 'wikiPageWorker.js'),
    {
      'node:worker_threads': {
        ...workerThreads,
        Worker: WorkerWhoseStartsFail,
      },
      './constants': { ...constants, ...constantOverrides },
    },
  )
  return {
    servedWikiPageOffThread: loaded.servedWikiPageOffThread,
    startAttempts: () => startAttempts,
    onlineOfStart: (attempt) =>
      onlines.get(attempt) ?? Promise.resolve('never started'),
  }
}

// Value: protects=a learner whose page meets a host that cannot start a worker thread (no thread or no memory left for one): the page must get the refusal page; fails_when=the synchronous throw of `new Worker` (ERR_WORKER_INIT_FAILED) leaves servedWikiPageOffThread as a rejection, which the reader answers with a JSON error, or the failed start keeps a place among the busy workers so the next page never gets one; why_new=Cycle 0047 row 5 (S11-X3 = S11-F4); seam=the page-worker module loaded with a Worker class whose first start throws (the second runs a real thread); no_claim=what makes a real start fail
test('a page whose worker cannot start is answered as failed, not with an error, and the next page gets a worker that starts', async () => {
  // Arrange: the first start of a worker throws.
  const pool = await loadPageWorkerWhoseStartsFail([0], {})
  const limits = { deadlineMs: 10_000, signal: new AbortController().signal }

  // Act: the rejection, if any, is noted by its code.
  const first = await within(
    pool
      .servedWikiPageOffThread(
        '<body><p>First page</p></body>',
        PAGE_OPTIONS,
        limits,
      )
      .catch((error: { code?: string }) => ({ rejectedWith: error.code })),
    2_000,
  )
  const second = await within(
    pool.servedWikiPageOffThread(
      '<body><p>Second page</p></body>',
      PAGE_OPTIONS,
      limits,
    ),
    5_000,
  )

  // Assert: the answers are copied out of the loaded module's context.
  assert.deepEqual(
    structuredClone({ first, second, startAttempts: pool.startAttempts() }),
    {
      first: { state: 'failed' },
      second: {
        state: 'served',
        html: '<body><p>Second page</p><script src="/w/t/codebook-qa.js"></script></body>',
      },
      startAttempts: 2,
    },
  )
})

// Value: protects=every page that waited for a worker when the worker it gets cannot start: it must be answered, and the pages behind it must still start; fails_when=the throw of `new Worker` escapes from the event that freed the worker (an abort, an exit, the deadline) as an uncaught error in the editor's host, the page that waited is never answered because its entry and its cancellation were dropped before its worker started, or the pages behind it never start; why_new=Cycle 0047 row 5 (S11-X3 = S11-F4); Cycle 0047 row 75 (P5-T1) the slow page's request goes once its thread runs, not after a sleep of 200 ms; seam=the page-worker module loaded with one worker at a time and a Worker class whose second start throws (the first and the third run real threads, each noting when it runs); no_claim=a worker that fails after its start (the reader test of a failing worker covers it)
test('when the worker of a page that waited cannot start, that page is answered as failed and the page behind it still gets a worker', async () => {
  // Arrange: one worker at a time; the slow page holds it, its worker's thread runs, and two pages wait behind it.
  const pool = await loadPageWorkerWhoseStartsFail([1], {
    WIKI_PAGE_WORKER_CONCURRENCY_LIMIT: 1,
  })
  const signal = new AbortController().signal
  const slowRequest = new AbortController()
  const slow = pool.servedWikiPageOffThread(SLOW_PAGE, PAGE_OPTIONS, {
    deadlineMs: 30_000,
    signal: slowRequest.signal,
  })
  const waiting = pool.servedWikiPageOffThread(
    '<body><p>Waiting page</p></body>',
    PAGE_OPTIONS,
    { deadlineMs: 10_000, signal },
  )
  const behind = pool.servedWikiPageOffThread(
    '<body><p>Page behind</p></body>',
    PAGE_OPTIONS,
    { deadlineMs: 10_000, signal },
  )
  const slowPageWorkerStart = await within(pool.onlineOfStart(0), 2_000)

  // Act: the slow page's request goes, so the waiting page needs a new worker, and that start throws.
  slowRequest.abort()
  const answers = await within(Promise.all([slow, waiting, behind]), 5_000)

  // Assert: the answers are copied out of the loaded module's context.
  assert.deepEqual(
    structuredClone({
      slowPageWorkerStart,
      answers,
      startAttempts: pool.startAttempts(),
    }),
    {
      slowPageWorkerStart: 'online',
      answers: [
        { state: 'failed' },
        { state: 'failed' },
        {
          state: 'served',
          html: '<body><p>Page behind</p><script src="/w/t/codebook-qa.js"></script></body>',
        },
      ],
      startAttempts: 3,
    },
  )
})
