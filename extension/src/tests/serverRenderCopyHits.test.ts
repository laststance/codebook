import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'

import { SERVER_RENDER_RESUMED_HIT_JOURNAL_LIMIT } from '../constants'
import type { RuntimeControl } from '../runtime'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { configuredRuntimeHarness } from './utils/configuredRuntimeHarness'
import type { ServerHitOrder } from './utils/serverRenderParticipant'

/** A required value of the harness page at a stop, as the single-action tests declare it. */
const ENABLED_STOP = [
  { path: 'enabled', mode: 'value', required: true },
] as const
/** The component file of the copy tests: stops A on line 1 and B on line 3 with a mapped statement between (spike s04-table: table.tsx lines 15 and 22). */
const COMPONENT_SOURCE =
  'var nextTheme = "dark";\nvar between = 1;\nvar enabled = false;\n'
const COMPONENT_MAP = 'AAAA;AACA;AACA'
const STOP_B_PLACE = { line: 2, column: 0 }
const STOP_B_SOURCE = { line: 3, column: 1 }

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
 * Opens a version 3 run with two entry-render stops A and B in one component file, the page not loaded yet, and waits until the navigation started.
 * @example const harness = await twoStopEntryRun(context)
 */
async function twoStopEntryRun(context: TestContext) {
  const harness = await configuredRuntimeHarness(
    context,
    controlOf(context),
    [{ line: 3, column: 1, inspections: [...ENABLED_STOP] }],
    {
      participant: 'server',
      serverSeal: 'rsc',
      serverRuntime: { route: '/dashboard/invoices' },
      entryPath: '/dashboard/invoices',
      documentReadyState: 'loading',
      mappings: COMPONENT_MAP,
      fixture: { source: COMPONENT_SOURCE, citationEndLine: 3 },
      operations: {
        operations: [],
        stopOperations: [0, 0],
        stopParticipants: ['server', 'server'],
      },
    },
  )
  const prepared = harness.run.prepare()
  prepared.catch(() => undefined)
  await waitUntil(
    () => harness.navigations.length === 1,
    'the entry navigation started',
  )
  return { harness, prepared }
}

type Run = Awaited<ReturnType<typeof twoStopEntryRun>>['harness']

/** Reads the details of every journal entry of a type, as plain data. @example journaled(harness, 'breakpoint.react-copy') */
function journaled(harness: Run, type: string): unknown[] {
  return harness.run
    .view()
    .events.filter((event) => event.type === type)
    .map((event) => JSON.parse(JSON.stringify(event.detail)))
}

/** Waits until the run published a server pause other than the given one. @example const second = await nextPause(harness, first.id) */
function nextPause(harness: Run, afterSnapshotId?: string) {
  return waitUntil(() => {
    const view = harness.run.view()
    if (view.failures.length) throw new Error(view.failures.join('; '))
    const snapshot = view.participants.server?.snapshot
    return snapshot && snapshot.id !== afterSnapshotId ? snapshot : undefined
  }, 'the published server pause')
}

/** Waits until the server participant received this many resumes. @example await resumesReceived(harness, 2) */
function resumesReceived(harness: Run, count: number) {
  return waitUntil(
    () => harness.server!.continues.length >= count,
    `${count} resume(s) of the server`,
  )
}

/** Sends a hit in a React copy at stop B's position. @example hitCopyAtB(harness, '3672', 109, 'cdp-first') */
function hitCopyAtB(
  harness: Run,
  scriptId: string,
  copy: number,
  order: ServerHitOrder = 'cdp-first',
): void {
  harness.server!.announceReactCopy(scriptId, copy)
  harness.server!.hit(
    { scriptId, generated: STOP_B_PLACE, source: STOP_B_SOURCE },
    order,
  )
}

for (const order of ['cdp-first', 'dap-first'] as ServerHitOrder[]) {
  // Value: protects=AC 21 and F1: stops A and B of one component file armed together: A's real hit is captured and retired, React's copy hit at B's position is resumed by the run and journaled breakpoint.react-copy, B's real hit is captured and the page loads (spike s04-table: ?107 and ?109 copies hit again right after the continue); fails_when=the copy hit pauses as B, fails the run as an unexpected stop, or consumes B so that the real hit is lost; no_claim=that js-debug sends exactly these copies (native trial)
  test(`a copy hit at the position of the other stop is resumed and the real hit of that stop is captured (${order})`, async (context) => {
    // Arrange
    const { harness, prepared } = await twoStopEntryRun(context)
    harness.server!.hit({})
    const stopA = await nextPause(harness)
    await harness.run.continue('server', stopA.pause)
    await resumesReceived(harness, 1)
    // Act: React's copy of the module hits B's breakpoint right after the continue
    hitCopyAtB(harness, '3672', 109, order)
    await resumesReceived(harness, 2)
    harness.server!.hit({ generated: STOP_B_PLACE, source: STOP_B_SOURCE })
    const stopB = await nextPause(harness, stopA.id)
    // Assert
    assert.deepEqual(journaled(harness, 'breakpoint.react-copy'), [{}])
    assert.equal(stopA.declaredIndex, 0)
    assert.equal(stopB.declaredIndex, 1)
    assert.equal(stopB.source.scriptId, 'server')
    assert.equal(harness.run.view().failures.length, 0)
    // Act: the page loads after the last continue
    harness.setDocumentReadyState('complete')
    await harness.run.continue('server', stopB.pause)
    await prepared
    await waitUntil(
      () => harness.run.view().status === 'completed',
      'the run completed',
    )
  })
}

// Value: protects=AC 21: a copy hit that arrives before the continue's acknowledgement is resumed and the continuation still completes; fails_when=the copy hit is taken for the continuation's events, fails the run, or the continue never settles; no_claim=the adapter's real event order (the spike saw the copies right after the continue)
test('a copy hit before the continue is acknowledged is resumed and the continuation completes', async (context) => {
  // Arrange
  const { harness } = await twoStopEntryRun(context)
  harness.server!.hit({})
  const stopA = await nextPause(harness)
  const answer = harness.server!.holdNextContinueAnswer()
  const continued = harness.run.continue('server', stopA.pause)
  await resumesReceived(harness, 1)
  // Act
  hitCopyAtB(harness, '3672', 109)
  await resumesReceived(harness, 2)
  answer()
  await continued
  harness.server!.hit({ generated: STOP_B_PLACE, source: STOP_B_SOURCE })
  const stopB = await nextPause(harness, stopA.id)
  // Assert
  assert.deepEqual(journaled(harness, 'breakpoint.react-copy'), [{}])
  assert.equal(stopB.declaredIndex, 1)
  assert.equal(harness.run.view().failures.length, 0)
})

// Value: protects=AC 21: a copy hit after the last stop was continued, while the page is still loading, is resumed and the page loads; fails_when=the late hit fails the run or keeps the page from loading; no_claim=none beyond protects
test('a copy hit after the last stop is resumed and the entry page loads', async (context) => {
  // Arrange
  const { harness, prepared } = await twoStopEntryRun(context)
  harness.server!.hit({})
  const stopA = await nextPause(harness)
  await harness.run.continue('server', stopA.pause)
  await resumesReceived(harness, 1)
  harness.server!.hit({ generated: STOP_B_PLACE, source: STOP_B_SOURCE })
  const stopB = await nextPause(harness, stopA.id)
  await harness.run.continue('server', stopB.pause)
  await resumesReceived(harness, 2)
  // Act
  hitCopyAtB(harness, '3672', 109)
  await resumesReceived(harness, 3)
  harness.setDocumentReadyState('complete')
  await prepared
  // Assert
  assert.deepEqual(journaled(harness, 'breakpoint.react-copy'), [{}])
  assert.equal(harness.run.view().failures.length, 0)
})

// Value: protects=X15 repeat hit: a later hit of a stop that already paused, in an (rsc) script, is resumed and journaled breakpoint.repeat-hit, never failed as an unexpected stop; fails_when=the repeat fails the run or pauses a second time; no_claim=what makes the debugger hit twice (js-debug rebinding in a re-parsed instance)
test('a second hit of a stop that already paused is resumed and journaled as a repeat', async (context) => {
  // Arrange
  const { harness, prepared } = await twoStopEntryRun(context)
  harness.server!.hit({})
  const stopA = await nextPause(harness)
  await harness.run.continue('server', stopA.pause)
  await resumesReceived(harness, 1)
  // Act: A's position runs again while B is still awaited
  harness.server!.hit({})
  await resumesReceived(harness, 2)
  harness.server!.hit({ generated: STOP_B_PLACE, source: STOP_B_SOURCE })
  const stopB = await nextPause(harness, stopA.id)
  // Assert
  assert.deepEqual(journaled(harness, 'breakpoint.repeat-hit'), [{}])
  assert.equal(stopB.declaredIndex, 1)
  harness.setDocumentReadyState('complete')
  await harness.run.continue('server', stopB.pause)
  await prepared
})

// Value: protects=AC 21: a refused resume of a copy hit fails the run with today's resume-failure sentence; fails_when=the run goes on with the server paused, or words the failure otherwise; no_claim=the adapter's own wording of the refusal
test('a refused resume of a copy hit fails the run with the continuation sentence', async (context) => {
  // Arrange
  const { harness } = await twoStopEntryRun(context)
  harness.server!.hit({})
  const stopA = await nextPause(harness)
  await harness.run.continue('server', stopA.pause)
  await resumesReceived(harness, 1)
  harness.server!.refuseNextContinue('Thread is not paused')
  // Act
  hitCopyAtB(harness, '3672', 109)
  await waitUntil(
    () => harness.run.view().failures.length > 0,
    'the run failed',
  )
  // Assert
  assert.match(
    harness.run.view().failures[0]!,
    /^Continue uncertain: .*Thread is not paused/,
  )
})

// Value: protects=AC 21: resumed copy hits count toward the resumed-hit cap: past it they are still resumed but no longer journaled; fails_when=the journal grows past the cap or a copy past it stops being resumed; no_claim=the count's place in the run record
test('copy hits past the journal cap are still resumed but not journaled', async (context) => {
  // Arrange
  const { harness } = await twoStopEntryRun(context)
  harness.server!.hit({})
  const stopA = await nextPause(harness)
  await harness.run.continue('server', stopA.pause)
  await resumesReceived(harness, 1)
  const copies = SERVER_RENDER_RESUMED_HIT_JOURNAL_LIMIT + 3
  // Act
  for (let copy = 1; copy <= copies; copy++) {
    hitCopyAtB(harness, `copy-${copy}`, copy)
    await resumesReceived(harness, 1 + copy)
  }
  // Assert
  assert.equal(
    journaled(harness, 'breakpoint.react-copy').length,
    SERVER_RENDER_RESUMED_HIT_JOURNAL_LIMIT,
  )
  assert.equal(harness.run.view().failures.length, 0)
})

// Value: protects=task 3a run messages: an entry-render pause says that the page finishes loading after the continue, and after a continue inside a set the run says which stop of the render it waits for (2 of 2); fails_when=the message is missing, names another position, or stays after the last stop; no_claim=the service's JSON field name for the message (service tests)
test('the run says what the render waits for while an entry-render pause is held and inside a set', async (context) => {
  // Arrange
  const { harness } = await twoStopEntryRun(context)
  // Act
  harness.server!.hit({})
  const stopA = await nextPause(harness)
  // Assert
  assert.equal(
    harness.run.view().renderMessage,
    'The server render of the entry page is paused; the page finishes loading after you continue.',
  )
  // Act
  await harness.run.continue('server', stopA.pause)
  await resumesReceived(harness, 1)
  // Assert
  assert.equal(
    harness.run.view().renderMessage,
    'Waiting for the next stop of this render (2 of 2).',
  )
  // Act
  harness.server!.hit({ generated: STOP_B_PLACE, source: STOP_B_SOURCE })
  const stopB = await nextPause(harness, stopA.id)
  await harness.run.continue('server', stopB.pause)
  await resumesReceived(harness, 2)
  // Assert
  assert.equal(harness.run.view().renderMessage, undefined)
})
