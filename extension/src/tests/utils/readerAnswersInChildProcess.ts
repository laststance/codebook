import { join } from 'node:path'
import { text } from 'node:stream/consumers'

import * as constants from '../../constants'
import type * as deepWikiReaderModule from '../../deepWikiReader'
import type * as wikiPageWorkerModule from '../../wikiPageWorker'

import { loadModule } from './loadModule'
import { runNodeScriptInChild } from './runNodeScriptInChild'

/** What the child is handed: the Wiki to serve, its project, the pages to ask for one after another, and the heap limit the reader's page workers get instead of the shipped one. */
type ReadingInput = {
  outputDirectory: string
  projectRoot: string
  pagePaths: string[]
  heapLimitMb: number
}
/** What the reader answered for one page: its status, its `Content-Security-Policy` and its body. */
type ReaderResponse = { status: number; policy: string | null; body: string }
/** What the child writes: the reader's address and its answer for each page, in order. */
type ReaderAnswers = { readerUrl: string; responses: ReaderResponse[] }

/**
 * Starts the compiled Wiki reader ({@link startDeepWikiReader}) in a child process, with the real page-worker module under a heap limit of the test's, asks it for pages one after another and tells how the child ended and what the reader answered.
 * Why: a page worker that reaches its heap limit can abort its whole process on a Node build without pointer compression; in a child, the abort ends the test in its assertion and not the test runner ({@link runNodeScriptInChild}).
 * Called by the reader's tests that drive a page worker to its heap limit.
 * @param outputDirectory - The Wiki folder the reader serves.
 * @param projectRoot - The project the Wiki belongs to.
 * @param pagePaths - The pages asked for, relative to the reader's address.
 * @param heapLimitMb - The heap limit of the reader's page workers, in place of {@link WIKI_PAGE_WORKER_HEAP_LIMIT_MB}.
 * @returns The child's exit code and signal, and as `output` the reader's address (`readerUrl`) and for each page its status, its `Content-Security-Policy` (`policy`) and its body (`responses`); an aborted child has no exit code, the signal `'SIGABRT'` and no output.
 * @example
 * await readerAnswersInChildProcess(outputDirectory, projectRoot, ['small.html'], 32)
 * // => { exitCode: 0, signal: null, output: { readerUrl: 'http://127.0.0.1:41234/w/0f…/index.html', responses: [{ status: 200, policy: '…', body: '…' }] } }
 */
export function readerAnswersInChildProcess(
  outputDirectory: string,
  projectRoot: string,
  pagePaths: string[],
  heapLimitMb: number,
): ReturnType<typeof runNodeScriptInChild<ReaderAnswers>> {
  const input: ReadingInput = {
    outputDirectory,
    projectRoot,
    pagePaths,
    heapLimitMb,
  }
  return runNodeScriptInChild(__filename, input, 60_000, isReaderAnswers)
}

/**
 * Tells whether what the child wrote is the reader's address and a list of its answers; asked by {@link runNodeScriptInChild} for the child's output.
 * @param value - The child's output, read as JSON.
 * @returns Whether it has a `readerUrl` text and a `responses` list whose every item has a numeric `status` and a `body` text.
 * @example isReaderAnswers({ readerUrl: 'http://127.0.0.1:1/w/0f/index.html', responses: [{ status: 200, policy: null, body: '' }] }) // => true
 */
function isReaderAnswers(value: unknown): value is ReaderAnswers {
  return (
    typeof value === 'object' &&
    value !== null &&
    'readerUrl' in value &&
    typeof value.readerUrl === 'string' &&
    'responses' in value &&
    Array.isArray(value.responses) &&
    value.responses.every(
      (response: unknown) =>
        typeof response === 'object' &&
        response !== null &&
        'status' in response &&
        typeof response.status === 'number' &&
        'body' in response &&
        typeof response.body === 'string',
    )
  )
}

/**
 * The child's side: reads the Wiki and the pages from the standard input, starts the reader, asks for each page and writes the answers as JSON; run when this file is the child's script.
 * @example await askReaderForPagesOfStandardInput() // writes { "readerUrl": "…", "responses": [{ "status": 503, … }] }
 */
async function askReaderForPagesOfStandardInput(): Promise<void> {
  const { outputDirectory, projectRoot, pagePaths, heapLimitMb }: ReadingInput =
    JSON.parse(await text(process.stdin))
  const workerUnderTheHeapLimit = await loadModule<typeof wikiPageWorkerModule>(
    join(__dirname, '..', '..', 'wikiPageWorker.js'),
    {
      './constants': {
        ...constants,
        WIKI_PAGE_WORKER_HEAP_LIMIT_MB: heapLimitMb,
      },
    },
  )
  const { startDeepWikiReader } = await loadModule<typeof deepWikiReaderModule>(
    join(__dirname, '..', '..', 'deepWikiReader.js'),
    { './wikiPageWorker': workerUnderTheHeapLimit },
    { URL },
  )
  const reader = await startDeepWikiReader(
    outputDirectory,
    projectRoot,
    async () => ({ handoff: 'not asked' }),
  )
  const responses: ReaderResponse[] = []
  // One page at a time, as a learner opens them one after another.
  for (const pagePath of pagePaths) {
    const response = await fetch(new URL(pagePath, reader.url))
    responses.push({
      status: response.status,
      policy: response.headers.get('content-security-policy'),
      body: await response.text(),
    })
  }
  await reader.close()
  process.stdout.write(JSON.stringify({ readerUrl: reader.url, responses }))
}

// Only the child runs the reader; a test that imports this file gets the function above.
if (require.main === module) void askReaderForPagesOfStandardInput()
