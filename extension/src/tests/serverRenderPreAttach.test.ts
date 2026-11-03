import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'

import type { RepositoryOperation } from '../repositoryConfigSchemas'
import type { RuntimeControl } from '../runtime'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { configuredRuntimeHarness } from './utils/configuredRuntimeHarness'
import { armedEntry, entryRenderHarness } from './utils/entryRenderHarness'

const submit: RepositoryOperation = {
  kind: 'click',
  title: 'Create Invoice',
  selector: 'button[type=submit]',
}
const ENABLED_STOP = [
  { path: 'enabled', mode: 'value', required: true },
] as const
/** The module of the two-stop tests: a stop on line 1 and one on line 3 with a mapped statement between them. */
const TWO_LINE_SOURCE =
  'var nextTheme = "dark";\nvar between = 1;\nvar enabled = false;\n'
const TWO_LINE_MAP = 'AAAA;AACA;AACA'
const SECOND_STOP_PLACE = { line: 2, column: 0 }
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
 * Opens a version 3 run whose stops follow operation 1 and sends the operation, as a saved-session run does after its entry render.
 * @param stopCount - One stop (the harness's) or two (a set).
 * @example const harness = await afterOperationRun(context, 2)
 */
async function afterOperationRun(context: TestContext, stopCount: 1 | 2) {
  const harness = await configuredRuntimeHarness(
    context,
    controlOf(context),
    stopCount === 2
      ? [{ line: 3, column: 1, inspections: [...ENABLED_STOP] }]
      : [],
    {
      participant: 'server',
      serverSeal: 'rsc',
      serverModuleSourceUrl: true,
      serverRuntime: { route: '/dashboard/invoices' },
      entryPath: '/dashboard/invoices',
      ...(stopCount === 2
        ? {
            mappings: TWO_LINE_MAP,
            fixture: { source: TWO_LINE_SOURCE, citationEndLine: 3 },
          }
        : {}),
      operations: {
        operations: [submit],
        stopOperations: stopCount === 2 ? [1, 1] : [1],
        stopParticipants: stopCount === 2 ? ['server', 'server'] : ['server'],
      },
    },
  )
  await harness.run.prepare()
  harness.run.action('op-1', 'repository-operation')
  await waitUntil(() => harness.inputsSeen() === 1, 'the input was sent')
  return harness
}

type Harness = Awaited<ReturnType<typeof afterOperationRun>>

/** Waits until the run published a server pause other than the given one. @example const second = await nextPause(harness, first.id) */
function nextPause(harness: Harness, afterSnapshotId?: string) {
  return waitUntil(() => {
    const view = harness.run.view()
    if (view.failures.length) throw new Error(view.failures.join('; '))
    const snapshot = view.participants.server?.snapshot
    return snapshot && snapshot.id !== afterSnapshotId ? snapshot : undefined
  }, 'the published server pause')
}

/** Reads the details of every journal entry of a type, as plain data. @example journaled(harness, 'script.discovered') */
function journaled(harness: Harness, type: string): unknown[] {
  return harness.run
    .view()
    .events.filter((event) => event.type === type)
    .map((event) => JSON.parse(JSON.stringify(event.detail)))
}

// Value: protects=Cycle 0071 N71: a saved-session run whose server module was evaluated before the debugger attached (the proxy never announces it) still takes the operation-driven re-render pause as the stop's; fails_when=the pause stays unmatched and the run fails with the source-bound CDP stop wait; no_claim=that js-debug reads this text in a real run (native trial)
test('an after-operation render pause in a server module parsed before the attach is the stop pause', async (context) => {
  // Arrange
  const harness = await afterOperationRun(context, 1)
  // Act: the pause is in a script no scriptParsed announced
  harness.server!.hit({
    route: '/dashboard/invoices',
    unannounced: {},
  })
  const pause = await nextPause(harness)
  // Assert
  assert.equal(pause.execution, 'server-render')
  assert.equal(pause.attribution, 'after-operation')
  assert.equal(pause.operationIndex, 1)
  assert.equal(pause.source.scriptId, 'server')
  assert.equal(harness.run.view().failures.length, 0)
  assert.equal(journaled(harness, 'script.discovered').length, 1)
})

// Value: protects=Cycle 0071 N71: the entry-render stop (afterOperation 0, operations omitted) of a saved-session run is taken when its module was parsed before the attach, and the page then loads; fails_when=the entry pause is never taken, the run fails with the source-bound wait, or the page cannot finish loading; no_claim=a real Next dev server
test('an entry-render pause in a server module parsed before the attach is taken and the run completes', async (context) => {
  // Arrange
  const harness = await entryRenderHarness(context, {
    serverModuleSourceUrl: true,
  })
  const prepared = harness.run.prepare().catch((error: unknown) => error)
  await armedEntry(harness)
  // Act
  harness.server!.hit({ route: '/dashboard', unannounced: {} })
  const pause = await waitUntil(
    () => harness.run.view().participants.server?.snapshot,
    'the published entry-render pause',
  )
  harness.setDocumentReadyState('complete')
  await harness.run.continue('server', pause.pause)
  await prepared
  await waitUntil(
    () => harness.run.view().status === 'completed',
    'the run completed',
  )
  // Assert
  assert.equal(pause.execution, 'server-render')
  assert.equal(pause.attribution, 'entry-load')
  assert.equal(harness.run.view().failures.length, 0)
})

// Value: protects=Cycle 0071 N71 with a set: both stops of a set pause in execution order when their shared module was parsed before the attach; fails_when=the second stop of the set, or the first, is not matched because the module was never announced; no_claim=the order the real render runs the branches in
test('two stops of a set in a module parsed before the attach both pause in the order the render runs them', async (context) => {
  // Arrange
  const harness = await afterOperationRun(context, 2)
  // Act: the second declared stop runs first
  harness.server!.hit({
    generated: SECOND_STOP_PLACE,
    source: SECOND_STOP_SOURCE,
    unannounced: {},
  })
  const first = await nextPause(harness)
  await harness.run.continue('server', first.pause)
  await waitUntil(() => harness.server!.continues.length === 1, 'resumed')
  harness.server!.hit({ unannounced: {} })
  const second = await nextPause(harness, first.id)
  // Assert
  assert.equal(first.declaredIndex, 1)
  assert.equal(first.executionIndex, 0)
  assert.equal(second.declaredIndex, 0)
  assert.equal(second.executionIndex, 1)
  assert.equal(harness.run.view().failures.length, 0)
})

// Value: protects=F1 for a script never announced: a React copy parsed before the attach and hit at an owned stop's position is resumed as a copy and journaled breakpoint.react-copy; fails_when=the copy is not recognised for lack of its address and is admitted as the stop or fails the run as an extra stop; no_claim=that js-debug sends exactly this copy (native trial)
test('a React copy parsed before the attach and hit at the stop position is resumed as a copy', async (context) => {
  // Arrange
  const harness = await afterOperationRun(context, 1)
  // Act
  harness.server!.hit({
    scriptId: '3672',
    route: '/dashboard/invoices',
    unannounced: { reactCopy: 109 },
  })
  await waitUntil(
    () => harness.server!.continues.length >= 1,
    'the copy hit was resumed',
  )
  harness.server!.hit({
    route: '/dashboard/invoices',
    unannounced: {},
  })
  const pause = await nextPause(harness)
  // Assert
  assert.deepEqual(journaled(harness, 'breakpoint.react-copy'), [{}])
  assert.equal(pause.source.scriptId, 'server')
  assert.equal(harness.run.view().failures.length, 0)
})

// Value: protects=a pause in a script that belongs to no stop keeps today's handling after discovery; fails_when=the pause of an unrelated pre-attach module is taken as the stop's pause; no_claim=what the run finally does with the held pause
test('a pause in a pre-attach module that is no stop module is not taken as the stop pause', async (context) => {
  // Arrange
  const harness = await afterOperationRun(context, 1)
  // Act
  harness.server!.hit({
    scriptId: 'other',
    route: '/dashboard/invoices',
    unannounced: { url: 'webpack-internal:///(rsc)/./app/other.tsx' },
  })
  await waitUntil(
    () => journaled(harness, 'script.discovered').length === 1,
    'the script was discovered',
  )
  await new Promise<void>((resolve) => setTimeout(resolve, 200))
  // Assert
  assert.equal(harness.run.view().participants.server?.snapshot, undefined)
  assert.equal(harness.run['stops'][0]!.script, undefined)
})

// Value: protects=SOURCE_CHANGED for a pre-attach instance: a script of the stop's module parsed before the attach whose inline map names another original ends the run with SOURCE_CHANGED; fails_when=the changed original is accepted as an instance of the stop; no_claim=the wording of the failure
test('a pre-attach instance whose map names a changed original ends the run with SOURCE_CHANGED', async (context) => {
  // Arrange: the sealed script is announced, a second instance was parsed before the attach
  const harness = await afterOperationRun(context, 1)
  harness.server!.announceScript('server')
  // Act
  harness.server!.hit({
    scriptId: 'pre-1',
    route: '/dashboard/invoices',
    unannounced: {
      scriptText: harness.server!.instanceText(
        ';AAAA',
        harness.server!.sealedUrl,
        true,
      ),
    },
  })
  await waitUntil(
    () => harness.run.view().failures.length > 0,
    'the run failed',
  )
  // Assert
  assert.match(harness.run.view().failures[0] ?? '', /SOURCE_CHANGED|changed/)
})

// Value: protects=the read bound: a script whose text the runtime does not answer in time stays unknown and its pause is not taken; fails_when=the pause is taken as the stop's without its address, or the run waits past the read bound; no_claim=the length of a real read
test('a pre-attach script whose text is not answered stays unknown and its pause is not taken', async (context) => {
  // Arrange
  const harness = await afterOperationRun(context, 1)
  harness.server!.holdScriptRead('server')
  // Act
  harness.server!.hit({ route: '/dashboard/invoices', unannounced: {} })
  await new Promise<void>((resolve) => setTimeout(resolve, 2_300))
  // Assert
  assert.equal(harness.run.view().participants.server?.snapshot, undefined)
  assert.equal(journaled(harness, 'script.discovered').length, 0)
})

// Value: protects=F1 when the script read outlasts the classification window: the DAP stopped comes before the CDP pause of a pre-attach React copy and the copy's text answer is slow; fails_when=the stopped is settled unclassified after the 1 s window, so the copy is taken as the owned stop or fails the run as an additional stop; no_claim=the real length of a js-debug read
test('a pre-attach React copy whose text answers after the classification window is still resumed as a copy', async (context) => {
  // Arrange
  const harness = await afterOperationRun(context, 1)
  const releaseRead = harness.server!.holdScriptRead('3672')
  // Act: the stopped comes first, the copy's text is answered 1.2 s later
  harness.server!.hit(
    {
      scriptId: '3672',
      route: '/dashboard/invoices',
      unannounced: { reactCopy: 109 },
    },
    'dap-first',
  )
  await new Promise<void>((resolve) => setTimeout(resolve, 1_200))
  releaseRead()
  await waitUntil(
    () => harness.server!.continues.length >= 1,
    'the copy hit was resumed',
  )
  harness.server!.hit({ route: '/dashboard/invoices', unannounced: {} })
  const pause = await nextPause(harness)
  // Assert
  assert.deepEqual(journaled(harness, 'breakpoint.react-copy'), [{}])
  assert.equal(pause.source.scriptId, 'server')
  assert.equal(harness.run.view().failures.length, 0)
})

// Value: protects=a discovery whose binding throws ends the run with a clear reason and no unhandled rejection; fails_when=the rejection of the discovery is unhandled, the pause stays held or the run keeps waiting without a reason; no_claim=which binding error a real script could cause
test('a pre-attach discovery whose binding throws fails the run with a reason and no unhandled rejection', async (context) => {
  // Arrange
  const harness = await afterOperationRun(context, 1)
  const unhandled: unknown[] = []
  const onUnhandled = (reason: unknown): void => {
    unhandled.push(reason)
  }
  process.on('unhandledRejection', onUnhandled)
  context.after(() => process.off('unhandledRejection', onUnhandled))
  Object.assign(harness.run, {
    bindParsedScript: (): void => {
      throw new Error('binding exploded')
    },
  })
  // Act
  harness.server!.hit({ route: '/dashboard/invoices', unannounced: {} })
  await waitUntil(
    () => harness.run.view().failures.length > 0,
    'the run failed',
  )
  await new Promise<void>((resolve) => setTimeout(resolve, 100))
  // Assert
  assert.match(
    harness.run.view().failures[0] ?? '',
    /Reading the script behind a server pause failed: binding exploded/,
  )
  assert.deepEqual(unhandled, [])
})

// Value: protects=a Pages run that declares a server stop reads the text of a server script it never saw parsed, as an App Router run does, and journals script.discovered (Cycle 0073 gate: the unannounced-script guard no longer excludes Pages runs; a Pages run without a server stop never gets here); fails_when=the Pages run's server pause in an unknown script is ignored and nothing is discovered; why_new=changed in Cycle 0073 (AC 6): it pinned "a Pages run does not discover"; no_claim=the Pages failure wording
test('a Pages run with a server stop discovers a script it never saw parsed', async (context) => {
  // Arrange
  const harness = await afterOperationRun(context, 1)
  Object.assign(harness.run, { pagesRun: { route: '/dashboard/invoices' } })
  // Act
  harness.server!.hit({ route: '/dashboard/invoices', unannounced: {} })
  await waitUntil(
    () => journaled(harness, 'script.discovered').length === 1,
    'the script behind the pause was discovered',
  )
  // Assert
  assert.equal(journaled(harness, 'script.discovered').length, 1)
})

// Value: protects=the journal bound: script.discovered is listed only up to the diagnostic cap and the rest are counted; fails_when=every discovered script is journaled; no_claim=the cap's value for a real run
test('script.discovered entries stop at the diagnostic cap', async (context) => {
  // Arrange
  const harness = await afterOperationRun(context, 1)
  // Act
  for (let index = 0; index < 205; index++) {
    const scriptId = `bulk-${index}`
    harness.server!.setScriptText(
      scriptId,
      `var a = 1;\n//# sourceURL=webpack-internal:///(rsc)/./app/bulk-${index}.tsx`,
    )
    await harness.run['discoverUnannouncedScript']('server', scriptId)
  }
  // Assert
  assert.equal(journaled(harness, 'script.discovered').length, 200)
})

// Value: protects=journal hygiene: a discovered address is cut to a bound and a data: URL body is never journaled; fails_when=a long address or the body of a data: URL reaches the journal; no_claim=masking of secrets in an address
test('a long or data: source address is cut or reduced before it is journaled', async (context) => {
  // Arrange
  const harness = await afterOperationRun(context, 1)
  harness.server!.setScriptText(
    'long',
    `var a = 1;\n//# sourceURL=webpack-internal:///${'x'.repeat(2_000)}`,
  )
  harness.server!.setScriptText(
    'data',
    'var a = 1;\n//# sourceURL=data:text/javascript;base64,SECRETBODY',
  )
  // Act
  await harness.run['discoverUnannouncedScript']('server', 'long')
  await harness.run['discoverUnannouncedScript']('server', 'data')
  // Assert
  const urls = journaled(harness, 'script.discovered').map(
    (detail) => (detail as { url: string }).url,
  )
  assert.equal(urls[0]!.length <= 300, true)
  assert.equal(urls[1], 'data:')
})
