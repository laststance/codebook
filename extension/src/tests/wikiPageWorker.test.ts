import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'
import * as workerThreads from 'node:worker_threads'

import * as constants from '../constants'
import type * as wikiPageWorkerModule from '../wikiPageWorker'
import { servedWikiPageOffThread } from '../wikiPageWorker'

import { loadModule } from './utils/loadModule'
import { pagesServedInChildProcess } from './utils/pagesServedInChildProcess'
import { within } from './utils/within'

/** How the tests serve a page: for the editor `vscode`, with the reader's script at a fixed address and no publication. */
const PAGE_OPTIONS = {
  editorScheme: 'vscode',
  clientAddress: '/w/t/codebook-qa.js',
  publication: undefined,
} as const

/** A page on which the HTML parser takes about 6 s on the development host: 10,000 open elements and 100,000 paragraph ends. */
const SLOW_PAGE = `<!doctype html><body>${'<x>'.repeat(10_000)}${'</p>'.repeat(100_000)}</body>`

/**
 * Loads the page-worker module with a `Worker` class that records each worker thread it starts, how many threads it started before were still alive then, and when each thread ends, so a test can tell how many workers prepared its pages and how many lived at once; the threads themselves are the real ones, running the compiled worker file.
 * Called by the tests of the workers' reuse, limit and stop.
 * @param constantOverrides - Constants the loaded module reads instead of the shipped ones.
 * @param whenStopIsAsked - Called with the worker each time the module asks a worker to stop (`terminate`), before the stop begins; when it answers a promise, the stop begins only once that promise settles, so a test can make a stop take long. By default nothing is done.
 * @param scriptOfStart - The script the worker started n-th (from 0) runs instead of the compiled worker file, evaluated with the module's options, so a test can make a thread that answers otherwise or ends by itself; `undefined` for the compiled file, which every worker runs by default.
 * @returns The loaded module's {@link servedWikiPageOffThread}, the workers it started in their order, for each of them how many threads started before it had not ended at its start, the start of the worker started n-th (from 0): a promise that settles with `'online'` when its thread runs, also for a worker the module starts only later (a test bounds the wait with {@link within}), and that worker's end: a promise that settles with `'ended'` when its thread has ended, or at once with `'never started'`.
 * @example
 * const pool = await loadPageWorkerRecordingThreads({})
 * await pool.servedWikiPageOffThread('<body></body>', PAGE_OPTIONS, limits)
 * pool.startedWorkers.length // => 1
 * pool.threadsAliveAtEachStart // => [0]
 */
async function loadPageWorkerRecordingThreads(
  constantOverrides: Partial<Record<keyof typeof constants, unknown>>,
  whenStopIsAsked: (
    worker: workerThreads.Worker,
  ) => Promise<void> | void = () => undefined,
  scriptOfStart: (startIndex: number) => string | undefined = () => undefined,
): Promise<{
  servedWikiPageOffThread: typeof servedWikiPageOffThread
  startedWorkers: workerThreads.Worker[]
  threadsAliveAtEachStart: number[]
  onlineOfWorker: (index: number) => Promise<'online'>
  endOfWorker: (index: number) => Promise<'ended' | 'never started'>
}> {
  const startedWorkers: workerThreads.Worker[] = []
  const aliveWorkers = new Set<workerThreads.Worker>()
  const threadsAliveAtEachStart: number[] = []
  const workerOnlines: {
    online: Promise<'online'>
    noteOnline: (online: 'online') => void
  }[] = []
  /** The start of the worker started n-th, made when the test asks for it or when the worker starts, whichever comes first. */
  const workerOnlineAt = (index: number): (typeof workerOnlines)[number] => {
    // A test may wait for a worker the module starts only later: the starts up to it are made now.
    for (;;) {
      const known = workerOnlines[index]
      if (known) return known
      let noteOnline: (online: 'online') => void = () => undefined
      const online = new Promise<'online'>((resolveOnline) => {
        noteOnline = resolveOnline
      })
      workerOnlines.push({ online, noteOnline })
    }
  }
  const workerEnds: Promise<'ended'>[] = []
  /** The real Worker, noting each thread it starts, the threads alive then, the moment it runs, its end, and each stop asked of it; a start the test gives a script of its own runs that script. */
  class RecordedWorker extends workerThreads.Worker {
    constructor(
      ...parameters: ConstructorParameters<typeof workerThreads.Worker>
    ) {
      const [filename, options] = parameters
      const script = scriptOfStart(startedWorkers.length)
      super(
        script ?? filename,
        script === undefined ? options : { ...options, eval: true },
      )
      threadsAliveAtEachStart.push(aliveWorkers.size)
      aliveWorkers.add(this)
      const { noteOnline } = workerOnlineAt(startedWorkers.length)
      startedWorkers.push(this)
      this.once('online', () => noteOnline('online'))
      workerEnds.push(
        new Promise((resolveEnd) =>
          this.once('exit', () => {
            aliveWorkers.delete(this)
            resolveEnd('ended')
          }),
        ),
      )
    }

    override terminate(): Promise<number> {
      const stopHeld = whenStopIsAsked(this)
      // A stop the test holds begins once the test lets it go.
      return stopHeld
        ? stopHeld.then(() => super.terminate())
        : super.terminate()
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
    threadsAliveAtEachStart,
    onlineOfWorker: (index) => workerOnlineAt(index).online,
    endOfWorker: (index) =>
      workerEnds[index] ?? Promise.resolve('never started'),
  }
}

// Value: protects=the editor's extension host, in whose process the page worker runs, against a page in the Wiki folder large enough that its preparation takes gigabytes of memory before the deadline (a 20 MB page peaked at 1.6 GB, a 60 MB page at 4.1 GB); fails_when=the page worker starts without a heap limit again, so a page that needs more memory than the limit is prepared and served, or a worker past its heap limit is answered as a failure, whose sentence advises a reload that only runs another worker to the same end, or as a page file too large, which it is not (its sentence names an earlier Codebook or a hand edit); why_new=P2P2; Cycle 0047 row 22 (P3M2) the state too-large; Cycle 0047 row 104 a state of its own, memory-limit; Cycle 0047 row 107 (ADV2-1) the workers run in a child process, as a worker at its heap limit can abort its whole process on a Node build without pointer compression; seam=a child process of this Node binary (pagesServedInChildProcess) that loads the page-worker module with loadModule and a constants module whose WIKI_PAGE_WORKER_HEAP_LIMIT_MB is 32 MB, so a page of 3 MB stands for one too large for the shipped 512 MB; no_claim=the peak memory of the editor's process (measured by hand, see WIKI_PAGE_WORKER_HEAP_LIMIT_MB)
test('a page that needs more memory than a page worker may use is refused at the memory limit, while a small page is still served under the same limit', async () => {
  // Arrange: a page of 3 MB of paragraphs and links, and a small page, for page workers that may use 32 MB of heap.
  const largePage = `<body>${'<p><a href="https://example.com/x">t</a><span>u</span></p>'.repeat(52_000)}</body>`
  const smallPage = '<body><p>Small page</p></body>'

  // Act
  const child = await pagesServedInChildProcess([largePage, smallPage], 32)

  // Assert: only the large page's state is compared, so a page served by mistake is not printed in full.
  assert.deepEqual(
    {
      exitCode: child.exitCode,
      signal: child.signal,
      large: child.output?.[0]?.state,
      small: child.output?.[1],
    },
    {
      exitCode: 0,
      signal: null,
      large: 'memory-limit',
      small: {
        state: 'served',
        html: '<body><p>Small page</p><script src="/w/t/codebook-qa.js"></script></body>',
      },
    },
  )
})

// Value: protects=the editor's extension host, and every extension of its window, against a page within the page file limit (2 MiB) whose nested formatting elements drive a page worker to its heap limit: on a Node build without pointer compression (the system Node, or a remote's Node, where the extension runs in a WSL or SSH window) a worker at the 256 MB of Cycle 0047 row 4 aborted the whole process (FATAL ERROR: Reached heap limit, exit 134) in 5 of 10 runs instead of ending its thread with ERR_WORKER_OUT_OF_MEMORY, and tabs restored after the reload ran into it again; fails_when=WIKI_PAGE_WORKER_HEAP_LIMIT_MB is lowered toward 256 MB again, so the child aborts with SIGABRT (in about half the runs at 256 MB on such a build), or the page is answered otherwise than the 512 MB limit allows, as failed or not at all; why_new=Cycle 0047 row 107 (ADV2-1); Cycle 0047 row 143 (P3TEST-1) the page may also be served: under coverage (CI's c8 passes NODE_V8_COVERAGE to the child) and CPU load the worker's heap stayed within 512 MB and the page was served in most runs measured, so the test holds the process's own end and an answer the limit allows, memory-limit or served, and not memory-limit alone; seam=a child process of this Node binary (pagesServedInChildProcess) that serves the page through the compiled page-worker module under the shipped constants, so an abort fails this test instead of ending the test runner; no_claim=which of memory-limit and served a run ends with (the garbage collector's timing under coverage and load decides), which the test above holds for a page past a smaller limit; a Node build with pointer compression (Electron's, in the desktop editors), whose worker ends as memory-limit under either limit, so there the test passes either way; that every page of 2 MiB ends cleanly at 512 MB (29 crafted shapes ended cleanly in the parent's measurement); the time and memory of the run (about 3.4 s and 0.7 GB of the process on the development host)
test('a 2 MiB page of nested formatting elements that drives a page worker toward its heap limit leaves the process that runs the worker alive, and is refused at the memory limit or served, never failed', async () => {
  // Arrange: 699,000 nested <b>, 2,097,000 bytes, within the page file limit.
  const nestedFormattingPage = '<b>'.repeat(699_000)

  // Act
  const child = await pagesServedInChildProcess([nestedFormattingPage])

  // Assert: an abort shows as the signal SIGABRT and no answer. The page is refused at the memory limit, or served in a run whose worker's heap stays within 512 MB (under coverage and load); only its state is compared, so a served page is not printed in full.
  const states = child.output?.map((answer) => answer.state)
  assert.deepEqual(
    { exitCode: child.exitCode, signal: child.signal, answers: states?.length },
    { exitCode: 0, signal: null, answers: 1 },
  )
  assert.ok(
    states?.[0] === 'memory-limit' || states?.[0] === 'served',
    `the page was answered as ${states?.[0]}`,
  )
})

// Value: protects=the editor's extension host, in whose process every page worker runs: each worker may hold up to WIKI_PAGE_WORKER_HEAP_LIMIT_MB of heap, one worker took up to 0.69 GB of the process with a page of 2 MiB at 512 MB (Node 24), and Electron's V8 may keep every isolate of the process in one pointer-compression area; fails_when=WIKI_PAGE_WORKER_HEAP_LIMIT_MB or WIKI_PAGE_WORKER_CONCURRENCY_LIMIT is raised so that the workers that may run at once may together hold more old-generation heap than two workers of 512 MB; why_new=Cycle 0047 row 4 (S11-F3); Cycle 0047 row 107 (ADV2-1) the bound is two workers of 512 MB, not one: row 4's 256 MB per worker let a worker at its limit abort the whole process on a Node build without pointer compression, and the page file limit of 2 MiB that row 4 set too keeps what one page takes; seam=none (the shipped constants); no_claim=the memory of the real editor hosts (VS Code, Cursor), which are measured by hand; that the heap limit is high enough for a page of nested formatting elements (the child-process test above) or for an ordinary page (the test below)
test('the page workers that may run at once may together use no more heap than two page workers of 512 MB', () => {
  // Arrange: the heap of two workers of 512 MB, the bound since Cycle 0047 row 107.
  const boundOfAllWorkersAtOnceMb = 1_024

  // Act
  const heapOfAllWorkersAtOnceMb =
    constants.WIKI_PAGE_WORKER_HEAP_LIMIT_MB *
    constants.WIKI_PAGE_WORKER_CONCURRENCY_LIMIT

  // Assert
  assert.ok(
    heapOfAllWorkersAtOnceMb <= boundOfAllWorkersAtOnceMb,
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

// Value: protects=the editor's extension host, in whose process every page worker runs, against pages past the deadline one after another (a crafted page reloaded, or several of them): a worker stopped at the deadline holds its heap (up to WIKI_PAGE_WORKER_HEAP_LIMIT_MB) until its thread has ended, and the place it gave back when its stop was asked let the waiting page's worker start beside it, so more threads than WIKI_PAGE_WORKER_CONCURRENCY_LIMIT lived at once, past the bound row 4 sets on their heaps together; fails_when=a stopped worker's place among the busy ones is given back when its stop is asked instead of when its thread has ended; why_new=Cycle 0047 row 79 (ADV-9); seam=the page-worker module loaded with one worker at a time and a Worker class that records the threads it starts and how many of the earlier ones were alive at each start (the threads are real); no_claim=the memory of the editor's process while a thread stops (a stop of a busy thread took about 2 ms on the development host); the shipped limit of two workers (each place is held the same way)
test('a page that waits behind a page stopped at the deadline gets its worker only once the stopped worker’s thread has ended', async () => {
  // Arrange: one worker at a time.
  const pool = await loadPageWorkerRecordingThreads({
    WIKI_PAGE_WORKER_CONCURRENCY_LIMIT: 1,
  })
  const signal = new AbortController().signal

  // Act: the slow page under a deadline of 500 ms, and a small page asked for while the slow page is prepared.
  const slow = pool.servedWikiPageOffThread(SLOW_PAGE, PAGE_OPTIONS, {
    deadlineMs: 500,
    signal,
  })
  const waiting = pool.servedWikiPageOffThread(
    '<body><p>Waiting page</p></body>',
    PAGE_OPTIONS,
    { deadlineMs: 10_000, signal },
  )
  const answers = await within(Promise.all([slow, waiting]), 5_000)

  // Assert: the waiting page's worker started when no earlier thread was alive; the answers are copied out of the loaded module's context.
  assert.deepEqual(
    structuredClone({
      answers,
      threadsAliveAtEachStart: pool.threadsAliveAtEachStart,
    }),
    {
      answers: [
        { state: 'deadline' },
        {
          state: 'served',
          html: '<body><p>Waiting page</p><script src="/w/t/codebook-qa.js"></script></body>',
        },
      ],
      threadsAliveAtEachStart: [0, 0],
    },
  )
})

// Value: protects=the editor's extension host against a page worker started beside an idle one that is being stopped: an idle worker whose idle time is up keeps its isolate and its heap (up to WIKI_PAGE_WORKER_REUSE_HEAP_LIMIT_BYTES) until its thread has ended, and a page asked for in that moment started its worker beside it, so more threads than WIKI_PAGE_WORKER_CONCURRENCY_LIMIT lived at once; fails_when=the stop of an idle worker whose time is up takes no place among the busy ones until its thread has ended; why_new=Cycle 0047 row 79 (ADV-9); seam=the page-worker module loaded with one worker at a time, an idle time of 300 ms, and a Worker class that records how many earlier threads were alive at each start and asks for the next page in the moment the module asks the idle worker to stop (the threads are real); no_claim=the memory an idle worker holds (the bound on it has its own test)
test('a page asked for while an idle worker whose time is up is being stopped gets its worker only once that worker’s thread has ended', async () => {
  // Arrange: one worker at a time and an idle time of 300 ms; the first stop the module asks for asks for the next page in that moment.
  const pagesAskedDuringAStop: ReturnType<typeof servedWikiPageOffThread>[] = []
  const signal = new AbortController().signal
  const pool = await loadPageWorkerRecordingThreads(
    {
      WIKI_PAGE_WORKER_CONCURRENCY_LIMIT: 1,
      WIKI_PAGE_WORKER_IDLE_MS: 300,
    },
    () => {
      // Only the first stop asks for a page, so the next page's worker, idle in its turn, asks for none.
      if (pagesAskedDuringAStop.length > 0) return
      pagesAskedDuringAStop.push(
        pool.servedWikiPageOffThread(
          '<body><p>Page asked during the stop</p></body>',
          PAGE_OPTIONS,
          { deadlineMs: 10_000, signal },
        ),
      )
    },
  )

  // Act: a page whose worker then waits idle until its time is up and it is stopped.
  const first = await pool.servedWikiPageOffThread(
    '<body><p>First page</p></body>',
    PAGE_OPTIONS,
    { deadlineMs: 10_000, signal },
  )
  const idleWorkerEnd = await within(pool.endOfWorker(0), 2_000)
  const askedDuringTheStop = await within(
    Promise.all(pagesAskedDuringAStop),
    5_000,
  )

  // Assert: the second worker started when no earlier thread was alive; the answers are copied out of the loaded module's context.
  assert.deepEqual(
    structuredClone({
      first,
      idleWorkerEnd,
      askedDuringTheStop,
      threadsAliveAtEachStart: pool.threadsAliveAtEachStart,
    }),
    {
      first: {
        state: 'served',
        html: '<body><p>First page</p><script src="/w/t/codebook-qa.js"></script></body>',
      },
      idleWorkerEnd: 'ended',
      askedDuringTheStop: [
        {
          state: 'served',
          html: '<body><p>Page asked during the stop</p><script src="/w/t/codebook-qa.js"></script></body>',
        },
      ],
      threadsAliveAtEachStart: [0, 0],
    },
  )
})

// Value: protects=every page the reader admitted within its own bound (takeWikiPagePlace: WIKI_PAGE_WORKER_CONCURRENCY_LIMIT + WIKI_PAGE_WAITING_LIMIT pages in hand) while a stopped page worker is still ending: the reader gives a page's place back at its answer, and the worker it was prepared by keeps its place in the pool until its thread has ended (row 79), so a page admitted in that moment found every worker busy and the line full, and was refused as busy; fails_when=a worker that is only ending still counts against the line of waiting pages, so a page the reader admitted is answered as busy, or the pool takes more pages than the reader's bound while workers end; why_new=Cycle 0047 row 103 (found while fixing row 79); seam=the page-worker module loaded with a Worker class that records the threads it starts and holds every stop until the test lets it go (the threads are real), under the shipped limits; no_claim=the time a real stop takes (about 2 ms on the development host), which the held stop stands for
test('while both page workers are ending, the two pages the reader admits in their place wait and are served, and a page beyond the reader’s bound is still refused as busy', async () => {
  // Arrange: every stop is held until the test lets it go; two slow pages under a deadline of 500 ms take both workers, and four small pages wait.
  let letTheStopsGo: () => void = () => undefined
  const stopsLetGo = new Promise<void>((resolveStops) => {
    letTheStopsGo = resolveStops
  })
  const pool = await loadPageWorkerRecordingThreads({}, () => stopsLetGo)
  const signal = new AbortController().signal
  /** Asks for a small page of the given name under a deadline of 10 s. */
  const askSmallPage = (
    name: string,
  ): ReturnType<typeof servedWikiPageOffThread> =>
    pool.servedWikiPageOffThread(`<body><p>${name}</p></body>`, PAGE_OPTIONS, {
      deadlineMs: 10_000,
      signal,
    })
  const slowPages = Promise.all([
    pool.servedWikiPageOffThread(SLOW_PAGE, PAGE_OPTIONS, {
      deadlineMs: 500,
      signal,
    }),
    pool.servedWikiPageOffThread(SLOW_PAGE, PAGE_OPTIONS, {
      deadlineMs: 500,
      signal,
    }),
  ])
  const waitingPages = [1, 2, 3, 4].map((number) =>
    askSmallPage(`Waiting page ${number}`),
  )
  const slowAnswers = await within(slowPages, 5_000)

  // Act: both slow pages are answered and their workers are ending; the reader admits two pages in their places, and a third page beyond its bound; then the stops go on.
  const admittedPages = [
    askSmallPage('Admitted page 1'),
    askSmallPage('Admitted page 2'),
  ]
  const beyondTheBound = await within(
    askSmallPage('Page beyond the bound'),
    1_000,
  )
  letTheStopsGo()
  const answers = await within(
    Promise.all([...waitingPages, ...admittedPages]),
    10_000,
  )

  // Assert: the answers are copied out of the loaded module's context.
  assert.deepEqual(structuredClone({ slowAnswers, beyondTheBound, answers }), {
    slowAnswers: [{ state: 'deadline' }, { state: 'deadline' }],
    beyondTheBound: { state: 'busy' },
    answers: [
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
      {
        state: 'served',
        html: '<body><p>Admitted page 1</p><script src="/w/t/codebook-qa.js"></script></body>',
      },
      {
        state: 'served',
        html: '<body><p>Admitted page 2</p><script src="/w/t/codebook-qa.js"></script></body>',
      },
    ],
  })
})

// Value: protects=every page that waits behind a stopped page worker whose thread does not end: a stopped worker keeps its place until its thread has ended (row 79), and a thread that never emitted its exit (only a Node defect does so) kept its place for good, so the pages behind it waited for good; fails_when=a stopped worker whose thread has not ended within WIKI_PAGE_WORKER_STOP_LIMIT_MS keeps its place, so the waiting page gets no worker, or the lost thread is never stopped once its stop can go on; why_new=Cycle 0047 row 109 (ADV2-12); seam=the page-worker module loaded with one worker at a time, a stop limit of 300 ms, and a Worker class that records how many earlier threads were alive at each start and holds every stop until the test lets it go (the threads are real); no_claim=a real thread that never ends (the held stop stands for it); the shipped stop limit of 5 s
test('a page that waits behind a stopped worker whose thread does not end gets a worker once the stop limit has passed, and is served', async () => {
  // Arrange: one worker at a time and a stop limit of 300 ms; every stop is held until the test lets it go.
  let letTheStopsGo: () => void = () => undefined
  const stopsLetGo = new Promise<void>((resolveStops) => {
    letTheStopsGo = resolveStops
  })
  const pool = await loadPageWorkerRecordingThreads(
    {
      WIKI_PAGE_WORKER_CONCURRENCY_LIMIT: 1,
      WIKI_PAGE_WORKER_STOP_LIMIT_MS: 300,
    },
    () => stopsLetGo,
  )
  const signal = new AbortController().signal

  // Act: the slow page under a deadline of 500 ms, whose stop is held, and a small page asked for while the slow page is prepared; then the stops go on.
  const slow = pool.servedWikiPageOffThread(SLOW_PAGE, PAGE_OPTIONS, {
    deadlineMs: 500,
    signal,
  })
  const waiting = pool.servedWikiPageOffThread(
    '<body><p>Waiting page</p></body>',
    PAGE_OPTIONS,
    { deadlineMs: 10_000, signal },
  )
  const answers = await within(Promise.all([slow, waiting]), 5_000)
  letTheStopsGo()
  const lostThreadEnd = await within(pool.endOfWorker(0), 2_000)

  // Assert: the waiting page's worker started while the lost thread was still alive; the answers are copied out of the loaded module's context.
  assert.deepEqual(
    structuredClone({
      answers,
      threadsAliveAtEachStart: pool.threadsAliveAtEachStart,
      lostThreadEnd,
    }),
    {
      answers: [
        { state: 'deadline' },
        {
          state: 'served',
          html: '<body><p>Waiting page</p><script src="/w/t/codebook-qa.js"></script></body>',
        },
      ],
      threadsAliveAtEachStart: [0, 1],
      lostThreadEnd: 'ended',
    },
  )
})

// Value: protects=the editor's extension host, in whose process every page worker runs, against stopped threads that do not end, one after another: each lost thread gives its place back (row 109) and may still hold its heap, so without a bound on the lost ones a Node defect that leaves every stop unended would start a new thread beside each, without end; fails_when=a stop that passes WIKI_PAGE_WORKER_STOP_LIMIT_MS gives its place back while as many threads are lost as WIKI_PAGE_WORKER_CONCURRENCY_LIMIT, or a stop that kept its place never gives it back once its thread has ended; why_new=Cycle 0047 row 109 (ADV2-12); seam=the page-worker module loaded with one worker at a time, a stop limit of 300 ms, and a Worker class that records how many earlier threads were alive at each start and holds every stop until the test lets it go (the threads are real); no_claim=the shipped limit of two workers (the bound is that limit the same way)
test('while as many stopped threads are lost as page workers may run at once, a further stopped worker keeps its place until its thread has ended', async () => {
  // Arrange: one worker at a time and a stop limit of 300 ms; every stop is held until the test lets it go.
  let letTheStopsGo: () => void = () => undefined
  const stopsLetGo = new Promise<void>((resolveStops) => {
    letTheStopsGo = resolveStops
  })
  const pool = await loadPageWorkerRecordingThreads(
    {
      WIKI_PAGE_WORKER_CONCURRENCY_LIMIT: 1,
      WIKI_PAGE_WORKER_STOP_LIMIT_MS: 300,
    },
    () => stopsLetGo,
  )
  const signal = new AbortController().signal

  // Act: two slow pages under a deadline of 500 ms, the second of which gets the place the first one's lost thread gave back, and a small page behind them; once the second's stop limit has passed, the stops go on.
  const slowPages = Promise.all([
    pool.servedWikiPageOffThread(SLOW_PAGE, PAGE_OPTIONS, {
      deadlineMs: 500,
      signal,
    }),
    pool.servedWikiPageOffThread(SLOW_PAGE, PAGE_OPTIONS, {
      deadlineMs: 500,
      signal,
    }),
  ])
  const behind = pool.servedWikiPageOffThread(
    '<body><p>Page behind</p></body>',
    PAGE_OPTIONS,
    { deadlineMs: 10_000, signal },
  )
  const slowAnswers = await within(slowPages, 5_000)
  // gstack-timing-ok: the page behind waits here whatever the timing, as no stop has gone on yet; the 1.5 s let the second worker's stop limit, 300 ms after its answer, pass first, so the check holds a stop kept in its place past its limit, and that timer fired at most 6.1 ms late in 6 runs under coverage and two busy loops on two and four cores.
  const behindWhileTheStopsAreHeld = await within(behind, 1_500)
  letTheStopsGo()
  const behindAnswer = await within(behind, 5_000)

  // Assert: the second slow page's worker started beside the lost thread, and the page behind waited until the stops went on; the answers are copied out of the loaded module's context.
  assert.deepEqual(
    structuredClone({
      slowAnswers,
      behindWhileTheStopsAreHeld,
      behindAnswer,
      firstTwoStarts: pool.threadsAliveAtEachStart.slice(0, 2),
      startedWorkers: pool.startedWorkers.length,
    }),
    {
      slowAnswers: [{ state: 'deadline' }, { state: 'deadline' }],
      behindWhileTheStopsAreHeld: 'still waiting',
      behindAnswer: {
        state: 'served',
        html: '<body><p>Page behind</p><script src="/w/t/codebook-qa.js"></script></body>',
      },
      firstTwoStarts: [0, 1],
      startedWorkers: 3,
    },
  )
})

// Value: protects=every page that waits behind a stopped page worker whose thread does not end, after an earlier lost thread has ended: a lost thread that ends gives back its count among the lost ones, and the bound on lost threads (row 109) would otherwise hold every later stop that passes the stop limit in its place as if that thread were still lost; fails_when=a lost thread that ends is still counted as lost, so the next thread whose stop passes WIKI_PAGE_WORKER_STOP_LIMIT_MS keeps its place and the page behind it waits for good, or a lost thread's end gives back the place it gave back at its stop limit a second time, so the pool counts more free places than it has and two pages asked for at once start a worker beyond WIKI_PAGE_WORKER_CONCURRENCY_LIMIT; why_new=Cycle 0047 row 109 (ADV2-12); Cycle 0047 row 149 (P3COV-1) two pages asked for at once after both lost threads ended, as no test held that a place is given back once; Cycle 0047 row 163 (CORE3-4) the first stop goes on once the second worker runs, and the second slow page has a deadline of 2 s, so the lost thread ends before the second worker's stop limit whatever the scheduler; seam=the page-worker module loaded with one worker at a time, a stop limit of 300 ms, and a Worker class that records the threads it starts and holds the stop of the first and of the second worker each until the test lets it go (the threads are real); no_claim=the shipped limit of two workers (the count is kept the same way)
test('once a lost thread has ended, the next stopped worker whose thread does not end gives its place back at the stop limit, the page behind it is served, and once both lost threads ended two pages asked for at once still get one worker between them', async () => {
  // Arrange: one worker at a time and a stop limit of 300 ms; the first and the second worker's stops are each held until the test lets them go.
  let letTheFirstStopGo: () => void = () => undefined
  const firstStopLetGo = new Promise<void>((resolveStop) => {
    letTheFirstStopGo = resolveStop
  })
  let letTheSecondStopGo: () => void = () => undefined
  const secondStopLetGo = new Promise<void>((resolveStop) => {
    letTheSecondStopGo = resolveStop
  })
  const pool = await loadPageWorkerRecordingThreads(
    {
      WIKI_PAGE_WORKER_CONCURRENCY_LIMIT: 1,
      WIKI_PAGE_WORKER_STOP_LIMIT_MS: 300,
    },
    (worker) => {
      const startedAs = pool.startedWorkers.indexOf(worker)
      if (startedAs === 0) return firstStopLetGo
      if (startedAs === 1) return secondStopLetGo
      return undefined
    },
  )
  const signal = new AbortController().signal

  // Act: two slow pages and a small page behind them. The first slow page passes its deadline of 500 ms, and its worker's thread is lost at the stop limit, so the second slow page gets a worker; once that worker runs, the first stop goes on, and the lost thread has ended before the second slow page's deadline of 2 s, so the order of the two does not depend on the scheduler. Then the second worker's stop passes its stop limit, and the second stop goes on.
  const firstSlow = pool.servedWikiPageOffThread(SLOW_PAGE, PAGE_OPTIONS, {
    deadlineMs: 500,
    signal,
  })
  const secondSlow = pool.servedWikiPageOffThread(SLOW_PAGE, PAGE_OPTIONS, {
    deadlineMs: 2_000,
    signal,
  })
  const behind = pool.servedWikiPageOffThread(
    '<body><p>Page behind</p></body>',
    PAGE_OPTIONS,
    { deadlineMs: 10_000, signal },
  )
  const secondWorkerStart = await within(pool.onlineOfWorker(1), 5_000)
  letTheFirstStopGo()
  // gstack-timing-ok: the lost thread's end is awaited, not timed, and the 2 s only bound it; it has to come before the second worker's stop limit, 2.3 s after that worker's start (its page's deadline of 2 s, which SLOW_PAGE at about 6 s passes, and the stop limit of 300 ms), and a held stop that went on ended its thread within 39 ms in 6 runs under coverage and two busy loops on two and four cores.
  const firstLostThreadEnd = await within(pool.endOfWorker(0), 2_000)
  const slowAnswers = await within(Promise.all([firstSlow, secondSlow]), 5_000)
  const behindWhileTheSecondStopIsHeld = await within(behind, 2_000)
  letTheSecondStopGo()
  const secondLostThreadEnd = await within(pool.endOfWorker(1), 2_000)
  const pagesAskedTogether = await within(
    Promise.all([
      pool.servedWikiPageOffThread(
        '<body><p>First page asked together</p></body>',
        PAGE_OPTIONS,
        { deadlineMs: 10_000, signal },
      ),
      pool.servedWikiPageOffThread(
        '<body><p>Second page asked together</p></body>',
        PAGE_OPTIONS,
        { deadlineMs: 10_000, signal },
      ),
    ]),
    5_000,
  )

  // Assert: the two pages asked together were prepared one after the other by the worker that served the page behind, in the pool's one place, and no fourth worker started; the answers are copied out of the loaded module's context.
  assert.deepEqual(
    structuredClone({
      secondWorkerStart,
      firstLostThreadEnd,
      slowAnswers,
      behindWhileTheSecondStopIsHeld,
      secondLostThreadEnd,
      pagesAskedTogether,
      startedWorkers: pool.startedWorkers.length,
    }),
    {
      secondWorkerStart: 'online',
      firstLostThreadEnd: 'ended',
      slowAnswers: [{ state: 'deadline' }, { state: 'deadline' }],
      behindWhileTheSecondStopIsHeld: {
        state: 'served',
        html: '<body><p>Page behind</p><script src="/w/t/codebook-qa.js"></script></body>',
      },
      secondLostThreadEnd: 'ended',
      pagesAskedTogether: [
        {
          state: 'served',
          html: '<body><p>First page asked together</p><script src="/w/t/codebook-qa.js"></script></body>',
        },
        {
          state: 'served',
          html: '<body><p>Second page asked together</p><script src="/w/t/codebook-qa.js"></script></body>',
        },
      ],
      startedWorkers: 3,
    },
  )
})

// Value: protects=every page that waits behind stopped page workers whose threads do not end, once the lost ones begin to end: while as many threads are lost as WIKI_PAGE_WORKER_CONCURRENCY_LIMIT, a stop that passes WIKI_PAGE_WORKER_STOP_LIMIT_MS keeps its place (row 109), and when a lost thread ended later its count fell but nothing looked at that stop again, so its place stayed taken and the page behind it waited with no timer until that worker's own thread ended (Codex's fault injection: two places taken, no lost worker, a waiting page and no active timer); fails_when=a stop that kept its place past its stop limit is not counted as lost once a lost thread ends, so the page behind it gets no worker while that stop's thread runs on, or it is counted as lost before a lost thread ends; why_new=Cycle 0047 row 142 (P3CXA-2 = P3CLA-4); seam=the page-worker module loaded with one worker at a time, a stop limit of 300 ms, and a Worker class that records how many earlier threads were alive at each start and holds the stop of the first and of the second worker each until the test lets it go (the threads are real); no_claim=a real thread that never ends (the held stop stands for it); the shipped limit of two workers (the count is kept the same way)
test('a stopped worker that kept its place past the stop limit while the lost threads were at their bound gives its place back once a lost thread ends, and the page behind it is served while its own thread is still ending', async () => {
  // Arrange: one worker at a time and a stop limit of 300 ms; the first and the second worker's stops are each held until the test lets them go.
  let letTheFirstStopGo: () => void = () => undefined
  const firstStopLetGo = new Promise<void>((resolveStop) => {
    letTheFirstStopGo = resolveStop
  })
  let letTheSecondStopGo: () => void = () => undefined
  const secondStopLetGo = new Promise<void>((resolveStop) => {
    letTheSecondStopGo = resolveStop
  })
  const pool = await loadPageWorkerRecordingThreads(
    {
      WIKI_PAGE_WORKER_CONCURRENCY_LIMIT: 1,
      WIKI_PAGE_WORKER_STOP_LIMIT_MS: 300,
    },
    (worker) => {
      const startedAs = pool.startedWorkers.indexOf(worker)
      if (startedAs === 0) return firstStopLetGo
      if (startedAs === 1) return secondStopLetGo
      return undefined
    },
  )
  const signal = new AbortController().signal

  // Act: two slow pages under a deadline of 500 ms and a small page behind them; the first worker's thread is lost, and the second's stop passes its limit while the first is still lost, so it keeps its place; then the first stop goes on and the lost thread ends, while the second stop is still held.
  const firstSlow = pool.servedWikiPageOffThread(SLOW_PAGE, PAGE_OPTIONS, {
    deadlineMs: 500,
    signal,
  })
  const secondSlow = pool.servedWikiPageOffThread(SLOW_PAGE, PAGE_OPTIONS, {
    deadlineMs: 500,
    signal,
  })
  const behind = pool.servedWikiPageOffThread(
    '<body><p>Page behind</p></body>',
    PAGE_OPTIONS,
    { deadlineMs: 10_000, signal },
  )
  const slowAnswers = await within(Promise.all([firstSlow, secondSlow]), 5_000)
  // gstack-timing-ok: the page behind waits here whatever the timing, as no stop has gone on yet; the 1 s let the second worker's stop limit, 300 ms after its answer, pass before the first stop goes on, so the second stop is held past its limit when the lost thread ends (a later timer would take the path of the test before this one, which ends alike), and that timer fired at most 6.1 ms late in 6 runs under coverage and two busy loops on two and four cores.
  const behindWhileTheFirstThreadIsLost = await within(behind, 1_000)
  letTheFirstStopGo()
  const firstLostThreadEnd = await within(pool.endOfWorker(0), 2_000)
  const behindWhileTheSecondStopIsHeld = await within(behind, 2_000)
  letTheSecondStopGo()
  const secondThreadEnd = await within(pool.endOfWorker(1), 2_000)

  // Assert: the page behind got the third worker while the second thread was still alive and the first had ended; the answers are copied out of the loaded module's context.
  assert.deepEqual(
    structuredClone({
      slowAnswers,
      behindWhileTheFirstThreadIsLost,
      firstLostThreadEnd,
      behindWhileTheSecondStopIsHeld,
      secondThreadEnd,
      threadsAliveAtEachStart: pool.threadsAliveAtEachStart,
    }),
    {
      slowAnswers: [{ state: 'deadline' }, { state: 'deadline' }],
      behindWhileTheFirstThreadIsLost: 'still waiting',
      firstLostThreadEnd: 'ended',
      behindWhileTheSecondStopIsHeld: {
        state: 'served',
        html: '<body><p>Page behind</p><script src="/w/t/codebook-qa.js"></script></body>',
      },
      secondThreadEnd: 'ended',
      threadsAliveAtEachStart: [0, 1, 1],
    },
  )
})

// Value: protects=every page that waits for a page worker where stopped threads do not end (a Node defect): while as many threads are lost as WIKI_PAGE_WORKER_CONCURRENCY_LIMIT, a further stopped worker keeps its place until a thread has ended (row 109), and a page waiting behind it had no time limit of its own, so it held its place in the line, and the reader its place among the pages in hand, for good (Codex saw two requests pending with no timer); fails_when=a page that has waited WIKI_PAGE_WAIT_LIMIT_MS without a worker is not answered as busy, or is answered before that limit, or stays in the line of waiting pages after its answer, so the page asked for after it is refused at once or is not served once a thread ends; why_new=Cycle 0047 row 189 (S2CXA-B2; the owner's D7 replaces the decision of row 142); seam=the page-worker module loaded with one worker at a time, no waiting page beyond the one each ending worker lets wait, a stop limit of 300 ms, a wait limit of 3 s, and a Worker class that records the threads it starts and holds every stop until the test lets it go (the threads are real); Cycle 0047 row 273 (P3TEST-20): the wait limit of 1 s left about 700 ms for a stopped thread to end and a new worker to take the page after it, which a busy machine can pass; no_claim=a real thread that never ends (the held stop stands for it); the shipped wait limit of 30 s; the reader's place, which it gives back once the busy answer is sent (deepWikiReader.test.ts)
test('a page that waits behind stopped workers whose threads do not end is answered as busy at the wait limit and leaves the line, so the page asked for after it waits and is served once a thread ends', async () => {
  // Arrange: one worker at a time, no waiting page beyond the one each ending worker lets wait, a stop limit of 300 ms and a wait limit of 3 s; every stop is held until the test lets it go. The first slow page passes its deadline of 500 ms and its thread is lost at the stop limit; the second slow page, asked for then, gets its place and passes its deadline, and its stop keeps its place past the stop limit, as the lost threads are at their bound.
  let letTheStopsGo: () => void = () => undefined
  const stopsLetGo = new Promise<void>((resolveStops) => {
    letTheStopsGo = resolveStops
  })
  const pool = await loadPageWorkerRecordingThreads(
    {
      WIKI_PAGE_WORKER_CONCURRENCY_LIMIT: 1,
      WIKI_PAGE_WAITING_LIMIT: 0,
      WIKI_PAGE_WORKER_STOP_LIMIT_MS: 300,
      WIKI_PAGE_WAIT_LIMIT_MS: 3_000,
    },
    () => stopsLetGo,
  )
  const signal = new AbortController().signal
  const firstSlow = await within(
    pool.servedWikiPageOffThread(SLOW_PAGE, PAGE_OPTIONS, {
      deadlineMs: 500,
      signal,
    }),
    5_000,
  )
  const secondSlow = await within(
    pool.servedWikiPageOffThread(SLOW_PAGE, PAGE_OPTIONS, {
      deadlineMs: 500,
      signal,
    }),
    5_000,
  )

  // Act: a page waits behind the second slow page's held stop; once it is answered, a page is asked for after it; then the stops go on.
  const waiting = pool.servedWikiPageOffThread(
    '<body><p>Waiting page</p></body>',
    PAGE_OPTIONS,
    { deadlineMs: 10_000, signal },
  )
  // gstack-timing-ok: the look at 1.5 s comes half the wait limit of 3 s before that limit, so only a timer 1.5 s late would look after it; the page gets no worker meanwhile whatever the timing, as both stops are held.
  const waitingBeforeTheLimit = await within(waiting, 1_500)
  const waitingAnswer = await within(waiting, 4_000)
  const after = pool.servedWikiPageOffThread(
    '<body><p>Page after</p></body>',
    PAGE_OPTIONS,
    { deadlineMs: 10_000, signal },
  )
  // gstack-timing-ok: the page after waits up to its own wait limit of 3 s, so the 2.7 s left after this look give the threads time to end and a new worker time to take it.
  const afterWhileTheStopsAreHeld = await within(after, 300)
  letTheStopsGo()
  const afterAnswer = await within(after, 5_000)

  // Assert: the answers are copied out of the loaded module's context.
  assert.deepEqual(
    structuredClone({
      firstSlow,
      secondSlow,
      waitingBeforeTheLimit,
      waitingAnswer,
      afterWhileTheStopsAreHeld,
      afterAnswer,
    }),
    {
      firstSlow: { state: 'deadline' },
      secondSlow: { state: 'deadline' },
      waitingBeforeTheLimit: 'still waiting',
      waitingAnswer: { state: 'busy' },
      afterWhileTheStopsAreHeld: 'still waiting',
      afterAnswer: {
        state: 'served',
        html: '<body><p>Page after</p><script src="/w/t/codebook-qa.js"></script></body>',
      },
    },
  )
})

// Value: protects=a page that waited for a worker and got one before its wait limit (D7): its worker answers it, also when that answer comes after the limit; fails_when=the wait limit's timer is not cleared once a worker takes the page (preparePage), so the page is answered busy at the limit while its worker still prepares it; why_new=the wait-limit test (row 189) holds its page without a worker until the limit; no test lets a page take a worker before the limit and answer after it; seam=the page-worker module loaded with one worker at a time and a wait limit of 1 s, and a Worker class whose first start runs a script that answers its first page after 0.4 s and its second after 1.2 s; no_claim=the shipped wait limit of 30 s; a real page whose preparation takes that long (the script's timers stand in for it)
test('a page that gets a worker before its wait limit is served by that worker, also when the answer comes after the limit', async () => {
  // Arrange: one worker at a time and a wait limit of 1 s; the only worker answers its first page after 0.4 s and its second after 1.2 s, each with a small heap, so it waits for the next page.
  const pool = await loadPageWorkerRecordingThreads(
    { WIKI_PAGE_WORKER_CONCURRENCY_LIMIT: 1, WIKI_PAGE_WAIT_LIMIT_MS: 1_000 },
    () => undefined,
    (startIndex) =>
      startIndex === 0
        ? "const { parentPort } = require('node:worker_threads'); let pages = 0; parentPort.on('message', () => { pages += 1; const [html, delayMs] = pages === 1 ? ['<p>First page, answered after 0.4 s</p>', 400] : ['<p>Second page, answered after 1.2 s</p>', 1200]; setTimeout(() => parentPort.postMessage({ html, heapBytes: 1 }), delayMs) })"
        : undefined,
  )
  const signal = new AbortController().signal

  // Act: the first page takes the worker; once the worker runs, a second page waits for it, and takes it when the first page is answered, 0.6 s before its wait limit.
  const first = pool.servedWikiPageOffThread(
    '<body><p>First page</p></body>',
    PAGE_OPTIONS,
    { deadlineMs: 10_000, signal },
  )
  const workerRuns = await within(pool.onlineOfWorker(0), 5_000)
  const second = pool.servedWikiPageOffThread(
    '<body><p>Second page</p></body>',
    PAGE_OPTIONS,
    { deadlineMs: 10_000, signal },
  )
  // gstack-timing-ok: the first answer comes 0.4 s after the worker runs, 0.6 s before the second page's wait limit of 1 s, and the second answer 0.6 s after that limit; the 5 s only bound a defect that holds an answer back.
  const answers = await within(Promise.all([first, second]), 5_000)

  // Assert: the answers are copied out of the loaded module's context.
  assert.deepEqual(
    structuredClone({
      workerRuns,
      answers,
      startedWorkers: pool.startedWorkers.length,
    }),
    {
      workerRuns: 'online',
      answers: [
        { state: 'served', html: '<p>First page, answered after 0.4 s</p>' },
        { state: 'served', html: '<p>Second page, answered after 1.2 s</p>' },
      ],
      startedWorkers: 1,
    },
  )
})

// Value: protects=a page whose worker thread ends before it answers without an error (a thread that exits by itself), and the page that waits behind it; fails_when=the pool answers such a page only at a message or an error, so it and every page behind it wait until the deadline or for good, or the place of the ended worker is given to the next page before its stop has settled; why_new=Cycle 0047 row 192 (S2SM-U28, the exit before an answer, wikiPageWorker.ts `worker.once('exit', fail)`); seam=the page-worker module loaded with one worker at a time and a Worker class whose first start runs a script that ends its thread at the first page it is handed (the second start runs the compiled worker file), recording the threads alive at each start (the threads are real); no_claim=what makes a real worker thread end before its answer
test('a page whose worker thread ends before it answers, without an error, is answered as failed, and the page waiting behind it gets a worker once that thread has ended and is served', async () => {
  // Arrange: one worker at a time; the first worker's thread ends as soon as it is handed a page.
  const pool = await loadPageWorkerRecordingThreads(
    { WIKI_PAGE_WORKER_CONCURRENCY_LIMIT: 1 },
    () => undefined,
    (startIndex) =>
      startIndex === 0
        ? "require('node:worker_threads').parentPort.once('message', () => process.exit(0))"
        : undefined,
  )
  const signal = new AbortController().signal

  // Act: a page for the worker that ends, and a page that waits behind it.
  const answers = await within(
    Promise.all([
      pool.servedWikiPageOffThread(
        '<body><p>Page of the ending worker</p></body>',
        PAGE_OPTIONS,
        { deadlineMs: 10_000, signal },
      ),
      pool.servedWikiPageOffThread(
        '<body><p>Waiting page</p></body>',
        PAGE_OPTIONS,
        { deadlineMs: 10_000, signal },
      ),
    ]),
    5_000,
  )

  // Assert: the waiting page's worker started when no earlier thread was alive; the answers are copied out of the loaded module's context.
  assert.deepEqual(
    structuredClone({
      answers,
      threadsAliveAtEachStart: pool.threadsAliveAtEachStart,
    }),
    {
      answers: [
        { state: 'failed' },
        {
          state: 'served',
          html: '<body><p>Waiting page</p><script src="/w/t/codebook-qa.js"></script></body>',
        },
      ],
      threadsAliveAtEachStart: [0, 0],
    },
  )
})

// Value: protects=every page after a worker that answered something that is no prepared page (a thread in an unknown state): such a worker must not prepare a later page; fails_when=a worker whose answer is no prepared page is kept idle for the next page, so that page gets the same answer and is refused too, or the worker is never stopped and keeps its thread; why_new=Cycle 0047 row 192 (S2SM-U29, an answer that is no prepared page, wikiPageWorker.ts `: settle({ state: 'failed' }, false)` of receive); seam=the page-worker module loaded with a Worker class whose first start runs a script that answers every page with a page without its heap size (the second start runs the compiled worker file), recording the threads it starts (the threads are real); no_claim=what makes a real worker answer so
test('a page whose worker answers something that is no prepared page is answered as failed, that worker ends, and the next page gets a new worker and is served', async () => {
  // Arrange: the first worker answers every page with a page without its heap size.
  const pool = await loadPageWorkerRecordingThreads(
    {},
    () => undefined,
    (startIndex) =>
      startIndex === 0
        ? "const { parentPort } = require('node:worker_threads'); parentPort.on('message', () => parentPort.postMessage({ html: '<p>No prepared page</p>' }))"
        : undefined,
  )
  const signal = new AbortController().signal

  // Act: a page for the worker that answers no prepared page, then the next page.
  const first = await within(
    pool.servedWikiPageOffThread(
      '<body><p>First page</p></body>',
      PAGE_OPTIONS,
      { deadlineMs: 10_000, signal },
    ),
    5_000,
  )
  const firstWorkerEnd = await within(pool.endOfWorker(0), 2_000)
  const next = await within(
    pool.servedWikiPageOffThread(
      '<body><p>Next page</p></body>',
      PAGE_OPTIONS,
      { deadlineMs: 10_000, signal },
    ),
    5_000,
  )

  // Assert: the answers are copied out of the loaded module's context.
  assert.deepEqual(
    structuredClone({
      first,
      firstWorkerEnd,
      next,
      startedWorkers: pool.startedWorkers.length,
    }),
    {
      first: { state: 'failed' },
      firstWorkerEnd: 'ended',
      next: {
        state: 'served',
        html: '<body><p>Next page</p><script src="/w/t/codebook-qa.js"></script></body>',
      },
      startedWorkers: 2,
    },
  )
})

// Value: protects=every page asked for while an idle worker whose time is up is being stopped and its thread does not end (a Node defect), and every later page: the stop of a retired idle worker takes a place among the busy ones (row 79), and below the bound on lost threads it is counted as lost at the stop limit and gives that place back once; fails_when=the retired idle worker's stop takes no place, so the page asked for during it starts its worker at once beside it, or the stop gives its place back a second time when the lost thread ends later, so the pool counts more free places than it has and two pages asked for at once start a worker each beyond WIKI_PAGE_WORKER_CONCURRENCY_LIMIT; why_new=Cycle 0047 row 192 (S2SM-U30 and U33: an idle worker's stop past the limit below the lost bound, wikiPageWorker.ts `busyWorkerCount += 1` of keepIdle, and a lost idle thread that ends later, `isPlaceFree = true` of stopInItsPlace); seam=the page-worker module loaded with one worker at a time, an idle time of 1 s, a stop limit of 1 s, and a Worker class that records the threads it starts and, at the first worker's stop, asks for a page and holds that stop until the test lets it go (the threads are real); no_claim=a real thread that never ends (the held stop stands for it); the shipped limits (the count is kept the same way)
test('a page asked for while a retired idle worker’s thread does not end gets a worker once that thread is counted as lost at the stop limit and is served, and once that thread has ended two pages asked for at once still get one worker between them', async () => {
  // Arrange: one worker at a time, an idle time of 1 s and a stop limit of 1 s; the first worker's stop asks for a page in that moment and is held until the test lets it go.
  let letTheStopGo: () => void = () => undefined
  const stopLetGo = new Promise<void>((resolveStop) => {
    letTheStopGo = resolveStop
  })
  let noteStopAsked: (asked: 'asked') => void = () => undefined
  const stopAsked = new Promise<'asked'>((resolveAsked) => {
    noteStopAsked = resolveAsked
  })
  const pagesAskedDuringTheStop: ReturnType<typeof servedWikiPageOffThread>[] =
    []
  const signal = new AbortController().signal
  const pool = await loadPageWorkerRecordingThreads(
    {
      WIKI_PAGE_WORKER_CONCURRENCY_LIMIT: 1,
      WIKI_PAGE_WORKER_IDLE_MS: 1_000,
      WIKI_PAGE_WORKER_STOP_LIMIT_MS: 1_000,
    },
    (worker) => {
      // Only the first worker's stop asks for a page and is held.
      if (pool.startedWorkers.indexOf(worker) !== 0) return undefined
      pagesAskedDuringTheStop.push(
        pool.servedWikiPageOffThread(
          '<body><p>Page asked during the stop</p></body>',
          PAGE_OPTIONS,
          { deadlineMs: 10_000, signal },
        ),
      )
      noteStopAsked('asked')
      return stopLetGo
    },
  )

  // Act: a page whose worker then waits idle until its time is up; the page asked for during its stop; the stop goes on; then two pages at once.
  const first = await pool.servedWikiPageOffThread(
    '<body><p>First page</p></body>',
    PAGE_OPTIONS,
    { deadlineMs: 10_000, signal },
  )
  const stopOfTheIdleWorker = await within(stopAsked, 3_000)
  // gstack-timing-ok: the half second only looks before the stop limit of 1 s, which a timer cannot pass early; the page gets no worker before that limit whatever the timing, as the stop is held.
  const askedBeforeTheStopLimit = await within(
    Promise.all(pagesAskedDuringTheStop),
    500,
  )
  const askedDuringTheStop = await within(
    Promise.all(pagesAskedDuringTheStop),
    3_000,
  )
  letTheStopGo()
  const lostThreadEnd = await within(pool.endOfWorker(0), 2_000)
  // gstack-timing-ok: the second worker waits idle for 1 s after it served the page asked during the stop, and the lost thread's end comes within tens of milliseconds of the stop going on, so both pages find it idle.
  const pagesAskedTogether = await within(
    Promise.all([
      pool.servedWikiPageOffThread(
        '<body><p>First page asked together</p></body>',
        PAGE_OPTIONS,
        { deadlineMs: 10_000, signal },
      ),
      pool.servedWikiPageOffThread(
        '<body><p>Second page asked together</p></body>',
        PAGE_OPTIONS,
        { deadlineMs: 10_000, signal },
      ),
    ]),
    5_000,
  )

  // Assert: the page asked during the stop got the second worker beside the lost thread, and the two pages asked together were prepared one after the other by that worker; the answers are copied out of the loaded module's context.
  assert.deepEqual(
    structuredClone({
      first,
      stopOfTheIdleWorker,
      askedBeforeTheStopLimit,
      askedDuringTheStop,
      lostThreadEnd,
      pagesAskedTogether,
      threadsAliveAtEachStart: pool.threadsAliveAtEachStart,
    }),
    {
      first: {
        state: 'served',
        html: '<body><p>First page</p><script src="/w/t/codebook-qa.js"></script></body>',
      },
      stopOfTheIdleWorker: 'asked',
      askedBeforeTheStopLimit: 'still waiting',
      askedDuringTheStop: [
        {
          state: 'served',
          html: '<body><p>Page asked during the stop</p><script src="/w/t/codebook-qa.js"></script></body>',
        },
      ],
      lostThreadEnd: 'ended',
      pagesAskedTogether: [
        {
          state: 'served',
          html: '<body><p>First page asked together</p><script src="/w/t/codebook-qa.js"></script></body>',
        },
        {
          state: 'served',
          html: '<body><p>Second page asked together</p><script src="/w/t/codebook-qa.js"></script></body>',
        },
      ],
      threadsAliveAtEachStart: [0, 1],
    },
  )
})

/**
 * Loads the page-worker module with one worker at a time, a stop limit and an idle time of 300 ms, and a Worker class that holds the first and the second worker's stops until the test lets each go, and asks for a page at the second worker's stop; the threads are real ({@link loadPageWorkerRecordingThreads}).
 * Called by the tests of an idle worker retired while the lost threads are at their bound: a slow page's worker is lost at the stop limit, the page asked for after it gets the second worker, which then waits idle until its time is up.
 * @returns The loaded pool, the steps that let the first and the second stop go, the moment the second stop is asked, and the page asked for then.
 * @example
 * const retirement = await loadPoolWhoseIdleWorkerRetiresAtTheLostBound()
 * await retirement.secondStopAsked // => 'asked'
 */
async function loadPoolWhoseIdleWorkerRetiresAtTheLostBound(): Promise<{
  pool: Awaited<ReturnType<typeof loadPageWorkerRecordingThreads>>
  letTheFirstStopGo: () => void
  letTheSecondStopGo: () => void
  secondStopAsked: Promise<'asked'>
  pageAskedDuringTheSecondStop: () => ReturnType<typeof servedWikiPageOffThread>
}> {
  let letTheFirstStopGo: () => void = () => undefined
  const firstStopLetGo = new Promise<void>((resolveStop) => {
    letTheFirstStopGo = resolveStop
  })
  let letTheSecondStopGo: () => void = () => undefined
  const secondStopLetGo = new Promise<void>((resolveStop) => {
    letTheSecondStopGo = resolveStop
  })
  let noteSecondStopAsked: (asked: 'asked') => void = () => undefined
  const secondStopAsked = new Promise<'asked'>((resolveAsked) => {
    noteSecondStopAsked = resolveAsked
  })
  let pageAskedDuringTheSecondStop:
    ReturnType<typeof servedWikiPageOffThread> | undefined
  const pool = await loadPageWorkerRecordingThreads(
    {
      WIKI_PAGE_WORKER_CONCURRENCY_LIMIT: 1,
      WIKI_PAGE_WORKER_STOP_LIMIT_MS: 300,
      WIKI_PAGE_WORKER_IDLE_MS: 300,
    },
    (worker) => {
      const startedAs = pool.startedWorkers.indexOf(worker)
      if (startedAs === 0) return firstStopLetGo
      if (startedAs !== 1) return undefined
      // The second worker is stopped only when its idle time is up: the page asked for now waits for its place.
      pageAskedDuringTheSecondStop = pool.servedWikiPageOffThread(
        '<body><p>Page asked during the stop</p></body>',
        PAGE_OPTIONS,
        { deadlineMs: 10_000, signal: new AbortController().signal },
      )
      noteSecondStopAsked('asked')
      return secondStopLetGo
    },
  )
  return {
    pool,
    letTheFirstStopGo,
    letTheSecondStopGo,
    secondStopAsked,
    pageAskedDuringTheSecondStop: () =>
      pageAskedDuringTheSecondStop ?? Promise.resolve({ state: 'failed' }),
  }
}

// Value: protects=the editor's extension host against an idle worker retired while as many stopped threads are lost as WIKI_PAGE_WORKER_CONCURRENCY_LIMIT: its thread may hold its heap, so its stop keeps its place past the stop limit (row 109) until its own thread has ended, and then gives it to the page waiting; fails_when=the retired idle worker's stop is counted as lost at the stop limit although the lost threads are at their bound, so the page asked for during it starts a worker beside two lost threads, or that stop keeps its place after its own thread has ended; why_new=Cycle 0047 row 192 (S2SM-U31, an idle worker's stop at the lost bound, wikiPageWorker.ts `if (lostWorkerCount >= WIKI_PAGE_WORKER_CONCURRENCY_LIMIT)` of the stop limit); seam=the page-worker module loaded with one worker at a time, a stop limit and an idle time of 300 ms, and a Worker class that records the threads it starts and holds the first and the second worker's stops until the test lets each go (the threads are real); no_claim=a real thread that never ends (the held stops stand for it); the shipped limits (the bound is that limit the same way)
test('an idle worker retired while the lost threads are at their bound keeps its place past the stop limit, and the page asked for during its stop gets a worker once that worker’s own thread has ended, while the lost thread still runs', async () => {
  // Arrange: a slow page's worker is lost at the stop limit, and the page asked for after it gets the second worker, which waits idle until its time is up; its stop asks for a page.
  const retirement = await loadPoolWhoseIdleWorkerRetiresAtTheLostBound()
  const signal = new AbortController().signal
  const slow = await within(
    retirement.pool.servedWikiPageOffThread(SLOW_PAGE, PAGE_OPTIONS, {
      deadlineMs: 500,
      signal,
    }),
    5_000,
  )
  const second = await within(
    retirement.pool.servedWikiPageOffThread(
      '<body><p>Second page</p></body>',
      PAGE_OPTIONS,
      { deadlineMs: 10_000, signal },
    ),
    5_000,
  )
  const secondStop = await within(retirement.secondStopAsked, 3_000)

  // Act: the second stop's limit passes while the first thread is lost; then the second stop goes on, and last the first.
  // gstack-timing-ok: the 1 s lets the second stop's limit of 300 ms pass, and the page gets no worker meanwhile whatever the timing, as both stops are held.
  const askedPastTheStopLimit = await within(
    retirement.pageAskedDuringTheSecondStop(),
    1_000,
  )
  retirement.letTheSecondStopGo()
  const askedOnceTheSecondThreadEnded = await within(
    retirement.pageAskedDuringTheSecondStop(),
    3_000,
  )
  const lostThreadAliveThen = await within(retirement.pool.endOfWorker(0), 0)
  retirement.letTheFirstStopGo()
  const lostThreadEnd = await within(retirement.pool.endOfWorker(0), 2_000)

  // Assert: the third worker started beside the lost first thread, after the second had ended; the answers are copied out of the loaded module's context.
  assert.deepEqual(
    structuredClone({
      slow,
      second,
      secondStop,
      askedPastTheStopLimit,
      askedOnceTheSecondThreadEnded,
      lostThreadAliveThen,
      lostThreadEnd,
      threadsAliveAtEachStart: retirement.pool.threadsAliveAtEachStart,
    }),
    {
      slow: { state: 'deadline' },
      second: {
        state: 'served',
        html: '<body><p>Second page</p><script src="/w/t/codebook-qa.js"></script></body>',
      },
      secondStop: 'asked',
      askedPastTheStopLimit: 'still waiting',
      askedOnceTheSecondThreadEnded: {
        state: 'served',
        html: '<body><p>Page asked during the stop</p><script src="/w/t/codebook-qa.js"></script></body>',
      },
      lostThreadAliveThen: 'still waiting',
      lostThreadEnd: 'ended',
      threadsAliveAtEachStart: [0, 1, 1],
    },
  )
})

// Value: protects=every page that waits behind an idle worker retired while as many stopped threads are lost as WIKI_PAGE_WORKER_CONCURRENCY_LIMIT, once a lost thread ends: the retired worker's stop that kept its place past the stop limit is counted as lost in that thread's stead and gives its place back, so the page behind it does not wait for that worker's own thread; fails_when=a lost thread's end does not count the oldest stop held past its limit as lost in its stead, so the page asked for during the retired worker's stop waits until that worker's own thread has ended, which may be never; why_new=Cycle 0047 row 192 (S2SM-U32, an idle worker's stop at the lost bound freed when a lost thread ends, wikiPageWorker.ts `stopsHeldPastTheirLimit.shift()?.()`); seam=the page-worker module loaded with one worker at a time, a stop limit and an idle time of 300 ms, and a Worker class that records the threads it starts and holds the first and the second worker's stops until the test lets each go (the threads are real); no_claim=a real thread that never ends (the held stops stand for it); the shipped limits
test('an idle worker retired while the lost threads are at their bound gives its place back once a lost thread ends, and the page asked for during its stop is served while that worker’s own thread is still ending', async () => {
  // Arrange: a slow page's worker is lost at the stop limit, and the page asked for after it gets the second worker, which waits idle until its time is up; its stop asks for a page.
  const retirement = await loadPoolWhoseIdleWorkerRetiresAtTheLostBound()
  const signal = new AbortController().signal
  const slow = await within(
    retirement.pool.servedWikiPageOffThread(SLOW_PAGE, PAGE_OPTIONS, {
      deadlineMs: 500,
      signal,
    }),
    5_000,
  )
  const second = await within(
    retirement.pool.servedWikiPageOffThread(
      '<body><p>Second page</p></body>',
      PAGE_OPTIONS,
      { deadlineMs: 10_000, signal },
    ),
    5_000,
  )
  const secondStop = await within(retirement.secondStopAsked, 3_000)

  // Act: the second stop's limit passes while the first thread is lost; then the first stop goes on and the lost thread ends, while the second stop is still held; last the second stop goes on.
  // gstack-timing-ok: the 1 s lets the second stop's limit of 300 ms pass, and the page gets no worker meanwhile whatever the timing, as both stops are held.
  const askedPastTheStopLimit = await within(
    retirement.pageAskedDuringTheSecondStop(),
    1_000,
  )
  retirement.letTheFirstStopGo()
  const lostThreadEnd = await within(retirement.pool.endOfWorker(0), 2_000)
  const askedOnceTheLostThreadEnded = await within(
    retirement.pageAskedDuringTheSecondStop(),
    3_000,
  )
  const secondThreadAliveThen = await within(retirement.pool.endOfWorker(1), 0)
  retirement.letTheSecondStopGo()
  const secondThreadEnd = await within(retirement.pool.endOfWorker(1), 2_000)

  // Assert: the third worker started beside the second thread, after the lost first one had ended; the answers are copied out of the loaded module's context.
  assert.deepEqual(
    structuredClone({
      slow,
      second,
      secondStop,
      askedPastTheStopLimit,
      lostThreadEnd,
      askedOnceTheLostThreadEnded,
      secondThreadAliveThen,
      secondThreadEnd,
      threadsAliveAtEachStart: retirement.pool.threadsAliveAtEachStart,
    }),
    {
      slow: { state: 'deadline' },
      second: {
        state: 'served',
        html: '<body><p>Second page</p><script src="/w/t/codebook-qa.js"></script></body>',
      },
      secondStop: 'asked',
      askedPastTheStopLimit: 'still waiting',
      lostThreadEnd: 'ended',
      askedOnceTheLostThreadEnded: {
        state: 'served',
        html: '<body><p>Page asked during the stop</p><script src="/w/t/codebook-qa.js"></script></body>',
      },
      secondThreadAliveThen: 'still waiting',
      secondThreadEnd: 'ended',
      threadsAliveAtEachStart: [0, 1, 1],
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
