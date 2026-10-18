import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'

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
