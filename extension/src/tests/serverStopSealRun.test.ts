import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'

import { StudyError } from '../errors'
import type { RepositoryOperation } from '../repositoryConfigSchemas'
import type { RuntimeControl } from '../runtime'

import { configuredRuntimeHarness } from './utils/configuredRuntimeHarness'

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

/** Opens a version 3 harness whose first stop is a server stop sealed as `serverSeal` says. @example await serverStopHarness(context, 'rsc') */
function serverStopHarness(
  context: TestContext,
  serverSeal: NonNullable<
    NonNullable<Parameters<typeof configuredRuntimeHarness>[3]>['serverSeal']
  >,
  savedSession = false,
) {
  return configuredRuntimeHarness(context, controlOf(context), [], {
    participant: 'server',
    serverSeal,
    entryPath: '/dashboard/invoices',
    ...(savedSession ? { savedSession: { admission: 'saved' } } : {}),
    operations: {
      operations: [submit],
      stopOperations: [1],
      signInPaths: ['/login'],
    },
  })
}

/** Runs the preparation and returns what it rejected with. */
function preparationFailure(
  harness: Awaited<ReturnType<typeof serverStopHarness>>,
): Promise<unknown> {
  return harness.run.prepare().then(
    () => undefined,
    (error: unknown) => error,
  )
}

for (const layer of ['action-browser', 'rsc'] as const) {
  // Value: protects=every sealed server stop is journaled with the layer it was sealed from; fails_when=no seal.layer entry, the wrong layer, or an entry for a stop that was not sealed; no_claim=the layer choice itself (serverRenderBundle tests) and attaching to a server inspector
  test(`a server stop sealed from the ${layer} layer is journaled with seal.layer ${layer}`, async (context) => {
    // Arrange
    const harness = await serverStopHarness(context, layer)
    // Act
    // The stand-in server has no inspector to attach to, so the preparation ends after the seal; the journal already holds the entry.
    await preparationFailure(harness)
    // Assert
    const sealLayers = harness.run
      .view()
      .events.filter((event) => event.type === 'seal.layer')
    assert.deepEqual(
      sealLayers.map((event) => JSON.parse(JSON.stringify(event.detail))),
      [{ stop: 'src/theme.ts:1', layer }],
    )
  })
}

// Value: protects=AC 7 fresh run: a server stop in a client component fails the run before any declared input with NEXT_STOP_NOT_SEALED, client-component and the stop, and opens no browser; fails_when=a browser is launched or navigated, the code, reason or stop is missing, or a seal.layer entry is journaled for the stop; no_claim=a real Next build (serverRenderBundle tests cut real chunks)
test('a fresh run whose server stop is in a client component fails before any input and opens no browser', async (context) => {
  // Arrange
  const harness = await serverStopHarness(context, 'client-component')
  // Act
  const failure = await preparationFailure(harness)
  // Assert
  assert.ok(failure instanceof StudyError, String(failure))
  assert.equal(failure.code, 'NEXT_STOP_NOT_SEALED')
  assert.deepEqual(JSON.parse(JSON.stringify(failure.details)), {
    reason: 'client-component',
    stop: 'src/theme.ts:1',
  })
  assert.equal(harness.launchConfigurations.length, 0)
  assert.deepEqual(harness.navigations, [])
  assert.deepEqual(
    harness.run.view().events.filter((event) => event.type === 'seal.layer'),
    [],
  )
})

// Value: protects=AC 7 saved-session run: the warm-up browser Chrome opened before the seal is released when a server stop is refused as a client component, with no seal.layer entry and no input; fails_when=the browser or the saved session stays held, or a seal.layer entry exists; no_claim=a real Chrome (the stand-in browser closes)
test('a saved-session run whose server stop is in a client component releases its warm-up browser', async (context) => {
  // Arrange
  const harness = await serverStopHarness(context, 'client-component', true)
  // Act
  const failure = await preparationFailure(harness)
  await harness.run.stop()
  // Assert
  assert.ok(failure instanceof StudyError, String(failure))
  assert.equal(failure.code, 'NEXT_STOP_NOT_SEALED')
  assert.ok(harness.releases.includes('browser'))
  assert.equal(harness.savedSessionCalls.at(-1), 'release')
  assert.equal(harness.run.view().resourcesReleased, true)
  assert.deepEqual(
    harness.run.view().events.filter((event) => event.type === 'seal.layer'),
    [],
  )
})
