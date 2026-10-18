import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

import { repositoryHtml } from '../ui/repositoryHtml'

// Value: protects=the first error of the Repository Wiki pane (a storage failure, a refused article) being announced: its status region is in the page, rendered and empty, before that error, and the shared rules give the empty region no room; fails_when=the pane's own stylesheet hides #errors while it is empty again (`#errors:empty{display:none}` beats the shared `[role=status]:empty` rule), so the region enters the page together with its first error and a screen reader says nothing; why_new=D1 (Cycle 0046 row 63's pattern, in the Repository pane); seam=none; no_claim=what a browser renders (the Repository pane's DOM check reads that in CI)
test('the Repository Wiki pane keeps its empty error status region rendered by no rule of its own, so the first error changes a region that is already there', () => {
  // Act
  const html = repositoryHtml()
  const rulesOfTheErrorRegion = html.match(/#errors[^{<]*\{[^}]*\}/g)

  // Assert
  assert.equal(
    html.includes(
      '<p id="errors" class="error" role="status" aria-live="polite"></p>',
    ),
    true,
  )
  assert.equal(
    html.includes(
      '.error:empty:not([role=status]){display:none}[role=status]:empty{margin:0;padding:0;border:0}',
    ),
    true,
  )
  assert.deepEqual(rulesOfTheErrorRegion, null)
})

// Value: protects=the Repository Wiki pane shown again after its document's ready reached the reader while the pane still counted as hidden: the document answers the reader's request with ready, so its article renders and its receipts count; fails_when=the pane's script drops the reader's `announce-ready` request (it reads every message as an article model and returns at a type other than `repository`), so the request goes unanswered and the pane stays without its document; why_new=CR5-6's reader test and the Study harness answer the request in place of the pane's script (repositoryReader.test.ts, answerAsWikiDocument of studyWorkspaceHarness.ts); seam=none (the script repositoryHtml prints, run in a VM context with a stand-in of the webview's DOM); no_claim=a real webview's message order, and the article the pane renders
test('the Repository Wiki pane says it is ready once as it loads and once more at each request of the reader to say it again', () => {
  // Arrange: the pane's own script, run with a stand-in of the webview's DOM that keeps what the script posts and the message listeners it adds.
  const script = /<script nonce="[^"]+">([\s\S]*)<\/script>/.exec(
    repositoryHtml(),
  )?.[1]
  assert.ok(script)
  const posted: unknown[] = []
  const messageListeners: ((event: { data: unknown }) => void)[] = []
  runInNewContext(script, {
    acquireVsCodeApi: () => ({
      getState: (): undefined => undefined,
      setState: (): void => {},
      // A copy in this test's realm, so the posted messages compare with plain objects.
      postMessage: (message: unknown): void => {
        posted.push(structuredClone(message))
      },
    }),
    document: {
      body: {},
      activeElement: undefined,
      hasFocus: (): boolean => false,
      getElementById: (): Record<string, unknown> => ({}),
      addEventListener: (): void => {},
    },
    window: {
      addEventListener: (
        name: string,
        listener: (event: { data: unknown }) => void,
      ): void => {
        if (name === 'message') messageListeners.push(listener)
      },
    },
    HTMLElement: class {},
  })
  const postedAtLoad = [...posted]

  // Act: the reader asks twice, as it does each time the pane is shown again after a ready it could not take.
  for (let request = 0; request < 2; request += 1)
    for (const listener of messageListeners)
      listener({ data: { type: 'announce-ready' } })

  // Assert
  assert.deepEqual(
    { postedAtLoad, postedForTheRequests: posted.slice(postedAtLoad.length) },
    {
      postedAtLoad: [{ type: 'ready' }],
      postedForTheRequests: [{ type: 'ready' }, { type: 'ready' }],
    },
  )
})
