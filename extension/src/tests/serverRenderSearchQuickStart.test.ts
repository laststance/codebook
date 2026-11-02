import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { runInNewContext } from 'node:vm'

import type { RuntimeControl } from '../runtime'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { SERVER_RENDER_SEARCH_CONFIGURATION } from '../serverRenderHelp'
import { configuredDomExpression } from '../utils/configuredDomExpression'

import { configuredRuntimeHarness } from './utils/configuredRuntimeHarness'
import { fakePageContext, type FakePageElement } from './utils/fakePageContext'

/** The page of the development target's invoices route before the search: the heading and the search box without a value attribute. */
const PAGE_BEFORE_SEARCH: FakePageElement[] = [
  { selector: 'h1', textContent: 'Invoices' },
  { selector: 'input[placeholder="Search invoices..."]', textContent: '' },
]

/** The same route after the search "paid": the search box's value attribute carries the term. */
const PAGE_AFTER_SEARCH: FakePageElement[] = [
  { selector: 'h1', textContent: 'Invoices' },
  {
    selector: 'input[placeholder="Search invoices..."]',
    textContent: '',
    attributes: { value: 'paid' },
  },
]

/** Builds the control the service gives a run. @example controlOf(context) */
function controlOf(context: TestContext): RuntimeControl {
  const abort = new AbortController()
  context.after(() => abort.abort())
  return {
    signal: abort.signal,
    deadlineAt: Date.now() + 300_000,
    preparationDeadlineAt: Date.now() + 300_000,
    runId: 'service-run-71',
  }
}

/** Reads whether the quick start's run-level `after` conditions hold on a page. @example holdsOn(PAGE_BEFORE_SEARCH) // => false */
function holdsOn(elements: FakePageElement[]): boolean {
  const answer: { ready: boolean } = runInNewContext(
    configuredDomExpression([...SERVER_RENDER_SEARCH_CONFIGURATION.after]),
    fakePageContext(elements),
  )
  return answer.ready
}

// Value: protects=the help's search quick start run as written: Codebook's guard (the run-level after conditions must not hold before the last operation) lets operation 1 through, the re-render hit pauses as a server render observed after operation 1, and after the continue the run completes; fails_when=the quick start's after already holds on the page before the search (the h1 "Invoices" condition), so the operation is refused with INPUT_NOT_ACCEPTED and the run never reaches the pause; no_claim=a real Next dev server or the target's real markup (stand-in page)
test('the search quick start sends its operation and pauses the re-render after operation 1, then completes', async (context) => {
  // Arrange
  const harness = await configuredRuntimeHarness(
    context,
    controlOf(context),
    [],
    {
      participant: 'server',
      serverSeal: 'rsc',
      serverRuntime: { route: '/dashboard/invoices' },
      entryPath: '/dashboard/invoices',
      before: [...SERVER_RENDER_SEARCH_CONFIGURATION.before],
      after: [...SERVER_RENDER_SEARCH_CONFIGURATION.after],
      operations: {
        operations: [...SERVER_RENDER_SEARCH_CONFIGURATION.operations],
        stopOperations: [1],
        stopParticipants: ['server'],
      },
    },
  )
  harness.showBeforePage(PAGE_BEFORE_SEARCH)
  await harness.run.prepare()
  // Act: the search is sent and the server renders the result
  harness.run.action('op-1', 'repository-operation')
  await waitUntil(
    () => harness.inputsSeen() === 1,
    'the search input reached the page',
  )
  harness.server!.hit({ route: '/dashboard/invoices' })
  const pause = await waitUntil(
    () => harness.run.view().participants.server?.snapshot,
    'the published server pause',
  )
  // Assert
  assert.equal(pause.execution, 'server-render')
  assert.equal(pause.attribution, 'after-operation')
  assert.equal(pause.operationIndex, 1)
  // Act: the searched page appears and the learner continues
  harness.showAfterPage(PAGE_AFTER_SEARCH)
  await harness.run.continue('server', pause.pause)
  await waitUntil(
    () => harness.run.view().status === 'completed',
    'the run completed after the continue',
  )
  // Assert
  assert.equal(harness.run.view().status, 'completed')
})

// Value: protects=the quick start's run-level after is a condition only the searched page satisfies; fails_when=it holds on the page before the search (an h1 "Invoices" condition does) or no longer holds after it; no_claim=the target's real pagination markup (a stand-in page)
test('the search quick start run-level after does not hold before the search and holds after it', () => {
  // Arrange: the pages before and after the search
  // Act
  const holdsBefore = holdsOn(PAGE_BEFORE_SEARCH)
  const holdsAfter = holdsOn(PAGE_AFTER_SEARCH)
  // Assert
  assert.equal(holdsBefore, false)
  assert.equal(holdsAfter, true)
})
