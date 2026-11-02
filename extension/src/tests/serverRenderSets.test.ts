import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'

import type { RepositoryOperation } from '../repositoryConfigSchemas'
import type { RuntimeControl } from '../runtime'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { configuredRuntimeHarness } from './utils/configuredRuntimeHarness'

const submit: RepositoryOperation = {
  kind: 'click',
  title: 'Create Invoice',
  selector: 'button[type=submit]',
}
/** A required value of the harness page at a stop, as the single-action tests declare it. */
const ENABLED_STOP = [
  { path: 'enabled', mode: 'value', required: true },
] as const
/** The module of the set tests: a stop on line 1 and one on line 3 with a mapped statement between them, so a pause on one line cannot pass for the other stop's slid binding (spike s07-cdg: lines 78 and 91 of fetchCardData). Generated line n is source line n + 1 under the map {@link TWO_LINE_MAP}. */
const TWO_LINE_SOURCE =
  'var nextTheme = "dark";\nvar between = 1;\nvar enabled = false;\n'
const TWO_LINE_MAP = 'AAAA;AACA;AACA'
/** Where the second declared stop sits in the sealed script, and in an instance with one extra leading line. */
const SECOND_STOP_PLACE = { line: 2, column: 0 }
const SECOND_STOP_IN_INSTANCE = { line: 3, column: 0 }
const FIRST_STOP_IN_INSTANCE = { line: 1, column: 0 }
const SECOND_STOP_SOURCE = { line: 3, column: 1 }

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
 * Opens a version 3 run with two server stops declared after operation 1 (a set) on the invoices route, prepared and with the operation sent.
 * @param seal - The layer the stops are sealed in.
 * @example const harness = await twoStopSet(context, 'rsc')
 */
async function twoStopSet(
  context: TestContext,
  seal: 'rsc' | 'action-browser',
) {
  const harness = await configuredRuntimeHarness(
    context,
    controlOf(context),
    [{ line: 3, column: 1, inspections: [...ENABLED_STOP] }],
    {
      participant: 'server',
      serverSeal: seal,
      serverRuntime: { route: '/dashboard/invoices' },
      entryPath: '/dashboard/invoices',
      mappings: TWO_LINE_MAP,
      fixture: { source: TWO_LINE_SOURCE, citationEndLine: 3 },
      operations: {
        operations: [submit],
        stopOperations: [1, 1],
        stopParticipants: ['server', 'server'],
      },
    },
  )
  await harness.run.prepare()
  harness.run.action('op-1', 'repository-operation')
  await waitUntil(() => harness.inputsSeen() === 1, 'the input was sent')
  return harness
}

/**
 * Announces the module as an `(rsc)` instance and waits until the run accepted it for every stop that shares the file.
 * @example await announceRscInstance(harness, 'rsc-1', 2)
 */
async function announceRscInstance(
  harness: Awaited<ReturnType<typeof twoStopSet>>,
  scriptId: string,
  stopCount: number,
): Promise<void> {
  harness.server!.announceInstance(scriptId, 'rsc', `;${TWO_LINE_MAP}`)
  await waitUntil(
    () =>
      harness.run
        .view()
        .events.filter((event) => event.type === 'stop.instance-sealed')
        .length >= stopCount,
    `${scriptId} accepted as an instance`,
  )
}

/** Waits until the run published a server pause that is not the given one. @example const second = await nextPause(harness, first.id) */
function nextPause(
  harness: Awaited<ReturnType<typeof twoStopSet>>,
  afterSnapshotId?: string,
) {
  return waitUntil(() => {
    const view = harness.run.view()
    if (view.failures.length) throw new Error(view.failures.join('; '))
    const snapshot = view.participants.server?.snapshot
    return snapshot && snapshot.id !== afterSnapshotId ? snapshot : undefined
  }, 'the published server pause')
}

// Value: protects=AC 5a and D15: two render stops of one set in branches of one Promise.all both pause, one after the other, whichever branch the render runs first; the pauses carry declaredIndex and executionIndex (spike s07-cdg: lines 78 and 91 of fetchCardData paused in execution order); fails_when=the stop that runs second in declaration order fails the run as an unexpected stop, the set is armed one at a time, or the indexes follow the declared order; no_claim=that the real render runs these branches in this order
test('two render stops of one set pause in the order the render runs them, whichever branch runs first', async (context) => {
  // Arrange
  const harness = await twoStopSet(context, 'rsc')
  // Act: the second declared stop runs first
  harness.server!.hit({
    generated: SECOND_STOP_PLACE,
    source: SECOND_STOP_SOURCE,
  })
  const first = await nextPause(harness)
  // Assert
  assert.equal(first.execution, 'server-render')
  assert.equal(first.attribution, 'after-operation')
  assert.equal(first.operationIndex, 1)
  assert.equal(first.declaredIndex, 1)
  assert.equal(first.executionIndex, 0)
  // Act: continue it, then the first declared stop runs
  await harness.run.continue('server', first.pause)
  await waitUntil(() => harness.server!.continues.length === 1, 'resumed')
  harness.server!.hit({})
  const second = await nextPause(harness, first.id)
  // Assert
  assert.equal(second.declaredIndex, 0)
  assert.equal(second.executionIndex, 1)
  assert.equal(second.operationIndex, 1)
  assert.equal(harness.run.view().failures.length, 0)
  // Act
  await harness.run.continue('server', second.pause)
  await waitUntil(
    () => harness.run.view().status === 'completed',
    'the run completed after both stops',
  )
})

// Value: protects=D15 and AC 5a: the declared order is kept when the render runs the stops in that order; fails_when=the pauses swap indexes without need; no_claim=none beyond protects
test('two render stops of one set pause in declared order when the render runs them in that order', async (context) => {
  // Arrange
  const harness = await twoStopSet(context, 'rsc')
  // Act
  harness.server!.hit({})
  const first = await nextPause(harness)
  await harness.run.continue('server', first.pause)
  await waitUntil(() => harness.server!.continues.length === 1, 'resumed')
  harness.server!.hit({
    generated: SECOND_STOP_PLACE,
    source: SECOND_STOP_SOURCE,
  })
  const second = await nextPause(harness, first.id)
  // Assert
  assert.deepEqual([first.declaredIndex, first.executionIndex], [0, 0])
  assert.deepEqual([second.declaredIndex, second.executionIndex], [1, 1])
})

// Value: protects=AC 5c and D15: stops of a shared file (sealed in action-browser) and a render-only file armed together both pause in the (rsc) instance, whichever runs first, each placed by that instance's own map; fails_when=a shared-layer stop changes the arming so that only one of the two pauses, or the second is matched to the wrong stop; no_claim=that Next sealed the two stops in different layers (the harness seals both from one layer)
test('stops of a shared-layer file and a render-only file in one set both pause in the rsc instance', async (context) => {
  // Arrange
  const harness = await twoStopSet(context, 'action-browser')
  await announceRscInstance(harness, 'rsc-1', 2)
  // Act: the render-only stop (second declared) runs first, in the rsc instance
  harness.server!.hit({
    scriptId: 'rsc-1',
    generated: SECOND_STOP_IN_INSTANCE,
    source: SECOND_STOP_SOURCE,
  })
  const first = await nextPause(harness)
  await harness.run.continue('server', first.pause)
  await waitUntil(() => harness.server!.continues.length === 1, 'resumed')
  harness.server!.hit({
    scriptId: 'rsc-1',
    generated: FIRST_STOP_IN_INSTANCE,
  })
  const second = await nextPause(harness, first.id)
  // Assert
  assert.equal(first.execution, 'server-render')
  assert.equal(second.execution, 'server-render')
  assert.equal(first.source.scriptId, 'rsc-1')
  assert.equal(second.source.scriptId, 'rsc-1')
  assert.deepEqual([first.declaredIndex, second.declaredIndex], [1, 0])
  assert.equal(
    harness.run.view().events.filter((event) => event.type === 'seal.layer')
      .length,
    2,
  )
})

// Value: protects=AC 5b: a group [server-action stop in the action, server-render stop in the page] after a submit whose action revalidates the entry route pauses in the action first (execution server-action) and, after its continue, in the re-render (execution server-render, observed after operation 1); fails_when=the render stop is skipped, the action stop reads server-render, or the render stop is not matched; no_claim=the real revalidation (spike s10-bi: actions.ts:162, page.tsx:26, data.ts:154 inside one POST)
test('a stop in the action pauses first and a stop in the re-render pauses after its continue', async (context) => {
  // Arrange
  const harness = await twoStopSet(context, 'action-browser')
  await announceRscInstance(harness, 'rsc-1', 2)
  // Act: the action runs in the action-browser script
  harness.server!.hit({})
  const action = await nextPause(harness)
  await harness.run.continue('server', action.pause)
  await waitUntil(() => harness.server!.continues.length === 1, 'resumed')
  // Act: the re-render runs the second stop in the rsc instance
  harness.server!.hit({
    scriptId: 'rsc-1',
    generated: SECOND_STOP_IN_INSTANCE,
    source: SECOND_STOP_SOURCE,
  })
  const render = await nextPause(harness, action.id)
  // Assert
  assert.equal(action.execution, 'server-action')
  assert.equal(action.attribution, undefined)
  assert.equal(render.execution, 'server-render')
  assert.equal(render.attribution, 'after-operation')
  assert.equal(render.operationIndex, 1)
})

// Value: protects=AC 8: one stop in a file that both layers hold is sealed in action-browser (journal seal.layer) and pauses at its first hit after arming in the (rsc) instance of a render, placed by that instance's own map and reading server-render; fails_when=the pause is placed by the sealed script's map, reads server-action, or the instance's hit is refused; no_claim=that Next parses both layers (spike s10-bi: shared helper in two instances)
test('a stop sealed in action-browser pauses in the rsc instance of a render and reads server-render', async (context) => {
  // Arrange
  const harness = await configuredRuntimeHarness(
    context,
    controlOf(context),
    [],
    {
      participant: 'server',
      serverSeal: 'action-browser',
      serverRuntime: { route: '/dashboard/invoices' },
      entryPath: '/dashboard/invoices',
      operations: {
        operations: [submit],
        stopOperations: [1],
        stopParticipants: ['server'],
      },
    },
  )
  await harness.run.prepare()
  harness.server!.announceInstance('rsc-1', 'rsc')
  harness.run.action('op-1', 'repository-operation')
  await waitUntil(() => harness.inputsSeen() === 1, 'the input was sent')
  // Act
  harness.server!.hit({ scriptId: 'rsc-1', generated: FIRST_STOP_IN_INSTANCE })
  const pause = await waitUntil(
    () => harness.run.view().participants.server?.snapshot,
    'the published server pause',
  )
  // Assert
  assert.equal(pause.execution, 'server-render')
  assert.equal(pause.attribution, 'after-operation')
  assert.equal(pause.source.scriptId, 'rsc-1')
  assert.deepEqual(JSON.parse(JSON.stringify(pause.source.generated)), {
    line: 1,
    column: 0,
  })
  assert.deepEqual(
    harness.run
      .view()
      .events.filter((event) => event.type === 'seal.layer')
      .map((event) => JSON.parse(JSON.stringify(event.detail))),
    [{ stop: 'src/theme.ts:1', layer: 'action-browser' }],
  )
})

// Value: protects=AC 1: an operation-driven run whose operation is a text input into the search box pauses at two render stops declared after it, both reading server-render and observed after operation 1 (the values query and data are native evidence); fails_when=a text operation's stops are not armed with the set, or the pauses lose their operation index; no_claim=the debugger's values at the stops
test('a text operation is followed by two render pauses observed after operation 1', async (context) => {
  // Arrange
  const harness = await configuredRuntimeHarness(
    context,
    controlOf(context),
    [{ line: 3, column: 1, inspections: [...ENABLED_STOP] }],
    {
      participant: 'server',
      serverSeal: 'rsc',
      serverRuntime: { route: '/dashboard/invoices' },
      entryPath: '/dashboard/invoices',
      mappings: TWO_LINE_MAP,
      fixture: { source: TWO_LINE_SOURCE, citationEndLine: 3 },
      operations: {
        operations: [
          {
            kind: 'text',
            title: 'Search',
            selector: 'input[placeholder="Search invoices..."]',
            text: 'de',
          },
        ],
        stopOperations: [1, 1],
        stopParticipants: ['server', 'server'],
      },
    },
  )
  await harness.run.prepare()
  // Act
  harness.run.action('op-1', 'repository-operation')
  await waitUntil(() => harness.inputsSeen() === 1, 'the text was typed')
  harness.server!.hit({})
  const first = await nextPause(harness)
  await harness.run.continue('server', first.pause)
  await waitUntil(() => harness.server!.continues.length === 1, 'resumed')
  harness.server!.hit({
    generated: SECOND_STOP_PLACE,
    source: SECOND_STOP_SOURCE,
  })
  const second = await nextPause(harness, first.id)
  // Assert
  assert.deepEqual(harness.insertedTexts, ['de'])
  assert.deepEqual(
    [first, second].map((pause) => [
      pause.execution,
      pause.attribution,
      pause.operationIndex,
    ]),
    [
      ['server-render', 'after-operation', 1],
      ['server-render', 'after-operation', 1],
    ],
  )
})

// Value: protects=D15 with H2: when the second declared stop of a set is hit in a new (rsc) instance whose text is still being read, the pause waits for the read and is then matched to the second declared stop, so the set pauses in the order the render ran it; fails_when=the pause is judged before the instance is accepted, the first declared stop is expected, and the run fails with "DAP frame differs from the bound configured source position"; no_claim=the length of a real script read
test('a hit of the second set stop in an instance still being read is matched to that stop once the instance is accepted', async (context) => {
  // Arrange: a set sealed in action-browser, the rsc instance announced with its text read held back
  const harness = await twoStopSet(context, 'action-browser')
  const releaseRead = harness.server!.holdScriptRead('rsc-1')
  harness.server!.announceInstance('rsc-1', 'rsc', `;${TWO_LINE_MAP}`)
  // Act: the second declared stop runs first, in the instance nobody has read yet
  harness.server!.hit({
    scriptId: 'rsc-1',
    generated: SECOND_STOP_IN_INSTANCE,
    source: SECOND_STOP_SOURCE,
  })
  await new Promise<void>((resolve) => setTimeout(resolve, 100))
  releaseRead()
  const first = await nextPause(harness)
  // Assert
  assert.equal(first.execution, 'server-render')
  assert.equal(first.source.scriptId, 'rsc-1')
  assert.equal(first.declaredIndex, 1)
  assert.equal(first.executionIndex, 0)
  assert.equal(harness.run.view().failures.length, 0)
  // Act: continue it, then the first declared stop runs in the same instance
  await harness.run.continue('server', first.pause)
  await waitUntil(() => harness.server!.continues.length === 1, 'resumed')
  harness.server!.hit({
    scriptId: 'rsc-1',
    generated: FIRST_STOP_IN_INSTANCE,
  })
  const second = await nextPause(harness, first.id)
  // Assert
  assert.deepEqual([second.declaredIndex, second.executionIndex], [0, 1])
  assert.equal(harness.run.view().failures.length, 0)
})

// Value: protects=the source resource without a snapshot names the first DECLARED stop's module, the module the sealed manifest hashes, after a render ran the second declared stop first; fails_when=source() reads this.stops[0], which the pause-order swap made the second declared stop; no_claim=the real bundles of two modules (the harness seals one module for both stops, so the test gives the second stop a marked copy)
test('the source without a snapshot stays the first declared stop module after the second declared stop paused first', async (context) => {
  // Arrange
  const harness = await twoStopSet(context, 'rsc')
  const internals = harness.run as unknown as {
    stops: { declaredIndex: number; bundle: { javascript: string } }[]
    definition: { descriptor: { itemId: string } }
  }
  const itemId = internals.definition.descriptor.itemId
  const firstDeclaredJavascript = internals.stops[0]!.bundle.javascript
  // The second declared stop gets its own module text, so the two stops' modules differ.
  internals.stops[1]!.bundle = {
    ...internals.stops[1]!.bundle,
    javascript: 'var secondStopModule = 1;',
  }
  // Act: the second declared stop runs first
  harness.server!.hit({
    generated: SECOND_STOP_PLACE,
    source: SECOND_STOP_SOURCE,
  })
  const first = await nextPause(harness)
  // Assert
  assert.equal(first.declaredIndex, 1)
  assert.equal(harness.run.source(itemId)?.javascript, firstDeclaredJavascript)
})
