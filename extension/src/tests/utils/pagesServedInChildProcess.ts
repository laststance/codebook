import { join } from 'node:path'
import { text } from 'node:stream/consumers'

import * as constants from '../../constants'
import type * as wikiPageWorkerModule from '../../wikiPageWorker'

import { loadModule } from './loadModule'
import { runNodeScriptInChild } from './runNodeScriptInChild'

/** What the child is handed: the pages, served one after another, and the heap limit its page workers get instead of the shipped one, if any. */
type ServingInput = { pages: string[]; heapLimitMb?: number }
/** What the child writes for each page: {@link servedWikiPageOffThread}'s answer, with the page as served when it was served. */
type ChildAnswer = { state: string; html?: string }

/**
 * Serves pages one after another through the compiled page-worker module ({@link servedWikiPageOffThread}) in a child process, each under a deadline of 20 s, and tells how the child ended and what each page was answered.
 * Why: a worker that reaches its heap limit can abort its whole process on a Node build without pointer compression; in a child, the abort ends the test in its assertion and not the test runner ({@link runNodeScriptInChild}).
 * Called by the tests that drive a page worker to its heap limit.
 * @param pages - The pages, as the Wiki folder holds them; each is served for the editor `vscode`, with the reader's script at `/w/t/codebook-qa.js` and no publication.
 * @param heapLimitMb - The heap limit the child's page workers get instead of the shipped {@link WIKI_PAGE_WORKER_HEAP_LIMIT_MB}; the shipped constants when left out.
 * @returns The child's exit code and signal, and as `output` the answer of each page in order; an aborted child has no exit code, the signal `'SIGABRT'` and no output.
 * @example
 * await pagesServedInChildProcess(['<body><p>Small page</p></body>'], 32)
 * // => { exitCode: 0, signal: null, output: [{ state: 'served', html: '<body><p>Small page</p><script src="/w/t/codebook-qa.js"></script></body>' }] }
 */
export function pagesServedInChildProcess(
  pages: string[],
  heapLimitMb?: number,
): ReturnType<typeof runNodeScriptInChild<ChildAnswer[]>> {
  const input: ServingInput = { pages, heapLimitMb }
  return runNodeScriptInChild(__filename, input, 60_000, isAnswerList)
}

/**
 * Tells whether what the child wrote is a list of answers, each with its state; asked by {@link runNodeScriptInChild} for the child's output.
 * @param value - The child's output, read as JSON.
 * @returns Whether it is a list whose every item has a `state` text.
 * @example isAnswerList([{ state: 'memory-limit' }]) // => true
 */
function isAnswerList(value: unknown): value is ChildAnswer[] {
  return (
    Array.isArray(value) &&
    value.every(
      (answer: unknown) =>
        typeof answer === 'object' &&
        answer !== null &&
        'state' in answer &&
        typeof answer.state === 'string',
    )
  )
}

/**
 * The child's side: reads the pages from the standard input, serves them one after another and writes their answers as JSON; run when this file is the child's script.
 * @example await servePagesOfStandardInput() // writes [{ "state": "memory-limit" }]
 */
async function servePagesOfStandardInput(): Promise<void> {
  const { pages, heapLimitMb }: ServingInput = JSON.parse(
    await text(process.stdin),
  )
  const constantsOfTheChild =
    heapLimitMb === undefined
      ? constants
      : { ...constants, WIKI_PAGE_WORKER_HEAP_LIMIT_MB: heapLimitMb }
  const { servedWikiPageOffThread } = await loadModule<
    typeof wikiPageWorkerModule
  >(join(__dirname, '..', '..', 'wikiPageWorker.js'), {
    './constants': constantsOfTheChild,
  })
  const answers: unknown[] = []
  // One page at a time, as a learner opens them one after another.
  for (const page of pages)
    answers.push(
      await servedWikiPageOffThread(
        page,
        {
          editorScheme: 'vscode',
          clientAddress: '/w/t/codebook-qa.js',
          publication: undefined,
        },
        { deadlineMs: 20_000, signal: new AbortController().signal },
      ),
    )
  process.stdout.write(JSON.stringify(answers))
}

// Only the child runs the pages; a test that imports this file gets the function above.
if (require.main === module) void servePagesOfStandardInput()
