import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'

import {
  ACTIVE_TIMEOUT_MS,
  SERVER_RENDER_CLASSIFICATION_MS,
  SERVER_RENDER_RESUMED_HIT_JOURNAL_LIMIT,
} from '../constants'
import type { RepositoryOperation } from '../repositoryConfigSchemas'
import type { RuntimeControl } from '../runtime'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { configuredRuntimeHarness } from './utils/configuredRuntimeHarness'
import type { ServerHitOrder } from './utils/serverRenderParticipant'

const submit: RepositoryOperation = {
  kind: 'click',
  title: 'Create Invoice',
  selector: 'button[type=submit]',
}

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

/**
 * Opens a version 3 run with one entry-render server stop (`afterOperation: 0`, no operations) on `entryPath`, the page not yet loaded, and waits until the entry navigation started and the stop is armed.
 * @example const harness = await entryRenderRun(context, { entryPath: '/dashboard' })
 */
async function entryRenderRun(
  context: TestContext,
  options: {
    entryPath?: string
    route?: string | null
    serverSeal?: 'rsc' | 'action-browser'
    appPaths?: Record<string, string>
  } = {},
) {
  const harness = await configuredRuntimeHarness(
    context,
    controlOf(context),
    [],
    {
      participant: 'server',
      serverSeal: options.serverSeal ?? 'rsc',
      serverRuntime: {
        route: options.route === undefined ? '/dashboard' : options.route,
        ...(options.appPaths ? { appPaths: options.appPaths } : {}),
      },
      entryPath: options.entryPath ?? '/dashboard',
      documentReadyState: 'loading',
      operations: {
        operations: [],
        stopOperations: [0],
        stopParticipants: ['server'],
      },
    },
  )
  const prepared = harness.run.prepare()
  // A failed run rejects the preparation; the tests read the failure from the run's view.
  prepared.catch(() => undefined)
  await waitUntil(
    () => harness.navigations.length === 1,
    'the entry navigation started',
  )
  return { harness, prepared }
}

/** Reads the details of every journal entry of a type, as plain data. @example journaled(harness, 'breakpoint.other-route') */
function journaled(
  harness: Awaited<ReturnType<typeof entryRenderRun>>['harness'],
  type: string,
): unknown[] {
  return harness.run
    .view()
    .events.filter((event) => event.type === type)
    .map((event) => JSON.parse(JSON.stringify(event.detail)))
}

/** Waits until the run published a server pause. @example const pause = await publishedPause(harness) */
function publishedPause(
  harness: Awaited<ReturnType<typeof entryRenderRun>>['harness'],
) {
  return waitUntil(() => {
    const view = harness.run.view()
    if (view.failures.length) throw new Error(view.failures.join('; '))
    return view.participants.server?.snapshot
  }, 'the published server pause')
}

/** Waits until the server participant received this many resumes. @example await resumesReceived(harness, 1) */
function resumesReceived(
  harness: Awaited<ReturnType<typeof entryRenderRun>>['harness'],
  count: number,
) {
  return waitUntil(
    () => harness.server!.continues.length >= count,
    `${count} resume(s) of the server`,
  )
}

for (const order of ['cdp-first', 'dap-first'] as ServerHitOrder[]) {
  // Value: protects=AC 16 and AC 5: a hit rendered by another route is resumed and journaled with that route, consumes no stop, and the next hit of the entry route pauses once, whichever of the CDP pause and the DAP stopped arrives first (spike s07-cdg: store route /dashboard/invoices while the entry is /dashboard); fails_when=the other route's hit is published, the stop is consumed by it, the journal lacks breakpoint.other-route with the route, or the entry hit pauses twice or not at all; no_claim=that the real Next produces this order of renders
  test(`a hit of another route is resumed and journaled, then the entry route's hit pauses once (${order})`, async (context) => {
    // Arrange
    const { harness } = await entryRenderRun(context)
    // Act
    harness.server!.hit({ route: '/dashboard/invoices' }, order)
    await resumesReceived(harness, 1)
    harness.server!.hit({ route: '/dashboard' }, order)
    const pause = await publishedPause(harness)
    // Assert
    assert.equal(pause.execution, 'server-render')
    assert.equal(pause.attribution, 'entry-load')
    assert.deepEqual(journaled(harness, 'breakpoint.other-route'), [
      { route: '/dashboard/invoices' },
    ])
    assert.equal(harness.server!.continues.length, 1)
    assert.equal(harness.run.view().failures.length, 0)
  })
}

// Value: protects=AC 16: codebook_stop during the route read ends the run and releases the paused server's debug session (the way a held server-action pause is released); fails_when=the server session stays attached after stop or the run does not end; no_claim=the service's stop wording (service tests)
test('stopping the run while the route is being read ends the run and releases the paused server', async (context) => {
  // Arrange
  const { harness } = await entryRenderRun(context, {})
  harness.server!.hit({ route: 'no-answer' })
  await waitUntil(
    () => harness.server!.routeReads.length === 1,
    'the route read started',
  )
  // Act
  await harness.run.stop()
  // Assert
  // The stop ends the debug session of the paused server, as for a held server-action pause, which lets the process run on.
  assert.equal(harness.run.view().status, 'cancelled')
  assert.equal(harness.releases.includes('debugger'), true)
  assert.equal(harness.server!.isClosed(), true)
  assert.equal(harness.run.view().participants.server?.snapshot, undefined)
})

// Value: protects=AC 16 and AC 21: a resume the adapter refuses fails the run with today's resume-failure sentence; fails_when=the run keeps waiting, publishes the hit or words the failure differently; no_claim=the adapter's own wording of the refusal
test('a refused resume of another route fails the run with the continuation sentence', async (context) => {
  // Arrange
  const { harness } = await entryRenderRun(context)
  harness.server!.refuseNextContinue('Thread is not paused')
  // Act
  harness.server!.hit({ route: '/dashboard/invoices' })
  await waitUntil(
    () => harness.run.view().failures.length > 0,
    'the run failed',
  )
  // Assert
  assert.match(
    harness.run.view().failures[0]!,
    /^Continue uncertain: .*Thread is not paused/,
  )
  assert.equal(harness.run.view().participants.server?.snapshot, undefined)
})

// Value: protects=AC 16: resumed hits are journaled up to the cap and only counted beyond it; fails_when=the journal grows past the cap or a resumed hit past the cap stops being resumed; no_claim=the count's place in the run record
test('resumed hits past the journal cap are still resumed but not journaled', async (context) => {
  // Arrange
  const { harness } = await entryRenderRun(context)
  const hits = SERVER_RENDER_RESUMED_HIT_JOURNAL_LIMIT + 3
  // Act
  for (let hit = 1; hit <= hits; hit++) {
    harness.server!.hit({ route: '/dashboard/invoices' })
    await resumesReceived(harness, hit)
  }
  // Assert
  assert.equal(
    journaled(harness, 'breakpoint.other-route').length,
    SERVER_RENDER_RESUMED_HIT_JOURNAL_LIMIT,
  )
  assert.equal(harness.run.view().failures.length, 0)
})

// Value: protects=AC 17: the entry route's pause is published with attribution entry-load and the run resource carries no route string of its own; fails_when=the pause is resumed as another route or the attribution is missing; no_claim=none beyond protects
test('a hit of the entry route in a route group page pauses with attribution entry-load', async (context) => {
  // Arrange
  const { harness } = await entryRenderRun(context, {
    entryPath: '/dashboard',
    appPaths: {
      '/dashboard/(overview)/page': 'app/dashboard/(overview)/page.js',
    },
  })
  // Act
  harness.server!.hit({ route: '/dashboard' })
  const pause = await publishedPause(harness)
  // Assert
  assert.equal(pause.attribution, 'entry-load')
  assert.deepEqual(journaled(harness, 'breakpoint.other-route'), [])
})

// Value: protects=AC 17: a dynamic segment of the entry path matches the store's route pattern as a segment; fails_when=/dashboard/invoices/abc/edit is compared as text with /dashboard/invoices/[id]/edit and its hit resumed; no_claim=none beyond protects
test('a hit of a dynamic entry route pauses when the store route is the pattern', async (context) => {
  // Arrange
  const { harness } = await entryRenderRun(context, {
    entryPath: '/dashboard/invoices/abc/edit',
    appPaths: {
      '/dashboard/invoices/[id]/edit/page':
        'app/dashboard/invoices/[id]/edit/page.js',
    },
  })
  // Act
  harness.server!.hit({ route: '/dashboard/invoices/[id]/edit' })
  const pause = await publishedPause(harness)
  // Assert
  assert.equal(pause.attribution, 'entry-load')
})

// Value: protects=AC 17: an unreadable route pauses as unconfirmed while the browser is on the entry route (D18); fails_when=the hit is resumed, published as entry-load, or the attribution is lost; no_claim=a real work store (spike s07-cdg g)
test('a hit whose route cannot be read pauses unconfirmed while the browser shows the entry route', async (context) => {
  // Arrange
  const { harness } = await entryRenderRun(context, { route: null })
  // Act
  harness.server!.hit({ route: null })
  const pause = await publishedPause(harness)
  // Assert
  assert.equal(pause.attribution, 'unconfirmed')
  assert.deepEqual(journaled(harness, 'breakpoint.unattributed-resumed'), [])
})

// Value: protects=AC 17 and C3: a route answer after 300 ms still classifies the hit; fails_when=a slow answer is treated as unreadable and the hit is published unconfirmed; no_claim=the real adapter's latency (spike: median 60 ms, cold 257 ms)
test('a route answer after 300 ms still classifies the hit', async (context) => {
  // Arrange
  const { harness } = await entryRenderRun(context)
  // Act
  harness.server!.hit({ route: { route: '/dashboard/invoices', afterMs: 300 } })
  await resumesReceived(harness, 1)
  // Assert
  assert.deepEqual(journaled(harness, 'breakpoint.other-route'), [
    { route: '/dashboard/invoices' },
  ])
})

// Value: protects=AC 21 and C3: no route answer within 1 s takes the unreadable-route path (pause unconfirmed on the entry route); fails_when=the hit waits longer than the bound or is resumed; no_claim=none beyond protects
test('a route read that does not answer within one second pauses unconfirmed on the entry route', async (context) => {
  // Arrange
  const { harness } = await entryRenderRun(context)
  // Act
  harness.server!.hit({ route: 'no-answer' })
  await waitUntil(
    () => harness.server!.routeReads.length === 1,
    'the route read started',
  )
  // The run's timers follow the harness clock: the second ends the classification bound.
  harness.advance(SERVER_RENDER_CLASSIFICATION_MS)
  const pause = await publishedPause(harness)
  // Assert
  assert.equal(pause.attribution, 'unconfirmed')
})

// Value: protects=AC 17: an unreadable route while the browser is not on the entry route is resumed and journaled breakpoint.unattributed-resumed; fails_when=the hit pauses or no event is journaled; no_claim=none beyond protects
test('a hit whose route cannot be read is resumed while the browser is on another route', async (context) => {
  // Arrange
  const harness = await configuredRuntimeHarness(
    context,
    controlOf(context),
    [],
    {
      participant: 'server',
      serverSeal: 'rsc',
      serverRuntime: { route: null },
      entryPath: '/dashboard/invoices',
      operations: {
        operations: [submit],
        stopOperations: [1],
        stopParticipants: ['server'],
      },
    },
  )
  await harness.run.prepare()
  harness.run.action('op-1', 'repository-operation')
  await waitUntil(() => harness.inputsSeen() === 1, 'the input was sent')
  harness.landOn('/dashboard/settings', 'within-document')
  // Act
  harness.server!.hit({ route: null })
  await waitUntil(
    () => harness.server!.continues.length === 1,
    'the unattributed hit was resumed',
  )
  // Assert
  assert.equal(journaled(harness, 'breakpoint.unattributed-resumed').length, 1)
  assert.equal(harness.run.view().participants.server?.snapshot, undefined)
})

// Value: protects=AC 17 and X16: a stop sealed in action-browser and hit in another route's (rsc) instance of the shared file is resumed and journaled breakpoint.other-route, not paused; fails_when=the shared-layer stop skips the route rule that stops sealed in rsc get; no_claim=that Next parses this instance (spike s10-bi); the harness seals from one layer
test('a shared-file stop sealed in action-browser is resumed when another route renders its rsc instance', async (context) => {
  // Arrange
  const { harness } = await entryRenderRun(context, {
    serverSeal: 'action-browser',
  })
  harness.server!.announceInstance('5036', 'rsc')
  await waitUntil(
    () => journaled(harness, 'stop.instance-sealed').length >= 1,
    'the rsc instance was accepted',
  )
  // Act
  harness.server!.hit({
    scriptId: '5036',
    generated: { line: 1, column: 0 },
    route: '/dashboard/invoices',
  })
  await resumesReceived(harness, 1)
  // Assert
  assert.deepEqual(journaled(harness, 'breakpoint.other-route'), [
    { route: '/dashboard/invoices' },
  ])
  assert.equal(harness.run.view().participants.server?.snapshot, undefined)
})

// Value: protects=AC 16: a hit that arrives before the answer to the run's own resume of the previous hit is classified on its own and pauses once; fails_when=the second hit is taken for the first one's events, fails the run as an additional stop, or is lost; no_claim=the adapter's real event order (spike s07-cdg: the next compile hit within milliseconds)
test("a hit before the answer to the previous hit's resume is classified on its own", async (context) => {
  // Arrange
  const { harness } = await entryRenderRun(context)
  const answer = harness.server!.holdNextContinueAnswer()
  harness.server!.hit({ route: '/dashboard/invoices' })
  await resumesReceived(harness, 1)
  // Act
  harness.server!.hit({ route: '/dashboard' })
  answer()
  const pause = await publishedPause(harness)
  // Assert
  assert.equal(pause.attribution, 'entry-load')
  assert.equal(harness.server!.continues.length, 1)
  assert.deepEqual(journaled(harness, 'breakpoint.other-route'), [
    { route: '/dashboard/invoices' },
  ])
})

// Value: protects=AC 21: a resume of another route's hit that the adapter never answers ends the run with the continuation sentence after the active bound; fails_when=the run waits forever or goes on with a paused server; no_claim=the 20 s bound's value (awaitResponse's own test), here a real wait
test('a resume the adapter never answers fails the run with the continuation sentence', async (context) => {
  // Arrange
  const { harness } = await entryRenderRun(context)
  harness.server!.holdNextContinue()
  // Act
  harness.server!.hit({ route: '/dashboard/invoices' })
  await waitUntil(
    () => harness.run.view().failures.length > 0,
    'the run failed',
    ACTIVE_TIMEOUT_MS + 5_000,
  )
  // Assert
  assert.match(
    harness.run.view().failures[0]!,
    /^Continue uncertain: .*Timed out waiting for repository render-hit resume/,
  )
})
