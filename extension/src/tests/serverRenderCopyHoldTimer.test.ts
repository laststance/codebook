import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'

import type { RuntimeControl } from '../runtime'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { configuredRuntimeHarness } from './utils/configuredRuntimeHarness'

/** A required value of the harness page at a stop. */
const ENABLED_STOP = [
  { path: 'enabled', mode: 'value', required: true },
] as const
/** The component file: stops A on line 1 and B on line 3 with a mapped statement between. */
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

// Value: protects=F1 with the C3 bound: a copy at an owned stop's position whose DAP stopped arrives 200 ms after the CDP pause and whose stack read outlasts the 1 s copy-hold timer is still resumed as a copy and journaled, so the server does not stay paused until the deadline; fails_when=the timer's hand-off to admission is read as the adapter's resume and the stopped event is dropped; why_new=the copy tests answer the stack at once, so the timer never fires during the read; seam=none; no_claim=the adapter's real stack latency
test('a copy hit whose stack read outlasts the copy-hold timer is still resumed and journaled', async (context) => {
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
  harness.server!.hit({})
  const stopA = await waitUntil(
    () => harness.run.view().participants.server?.snapshot,
    'the published server pause',
  )
  await harness.run.continue('server', stopA.pause)
  await waitUntil(
    () => harness.server!.continues.length >= 1,
    'the first resume of the server',
  )
  harness.server!.announceReactCopy('3672', 109)
  // Act: CDP pause, DAP stopped 200 ms later, stack answered 900 ms after that
  harness.server!.pauseCdp({
    scriptId: '3672',
    generated: STOP_B_PLACE,
    source: STOP_B_SOURCE,
  })
  harness.advance(200)
  const releaseStack = harness.server!.holdNextStackTrace()
  const stackReadsBefore = harness.server!.commands.filter(
    (command) => command === 'stackTrace',
  ).length
  harness.server!.stopDap()
  // The stack read is under way (held) before the copy-hold timer falls due
  await waitUntil(
    () =>
      harness.server!.commands.filter((command) => command === 'stackTrace')
        .length > stackReadsBefore,
    'the stack read of the copy hit started',
  )
  harness.advance(900)
  releaseStack()
  await waitUntil(
    () => harness.server!.continues.length >= 2,
    'the copy was resumed by the run',
  )
  // Assert
  const copies = harness.run
    .view()
    .events.filter((event) => event.type === 'breakpoint.react-copy')
  assert.equal(copies.length, 1)
  assert.equal(harness.run.view().failures.length, 0)
})
