import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'

import type { RepositoryOperation } from '../repositoryConfigSchemas'
import type { RuntimeControl } from '../runtime'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { configuredRuntimeHarness } from './utils/configuredRuntimeHarness'

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

// Value: protects=the harness contract L3 builds on: a version 3 run with an entry-render server stop (afterOperation 0, no operations) attaches the scripted server, arms the stop and publishes the pause of a scripted hit before the page loads (spike s01-base: Debugger.paused then stopped, route /dashboard/invoices); fails_when=the run cannot attach the scripted server, the stop is never armed, or the hit does not reach a published pause; no_claim=route classification, sets or the entry-load navigation rules (their own tests)
test('a scripted server hit pauses an entry-render stop of a run with no operations', async (context) => {
  // Arrange
  const harness = await configuredRuntimeHarness(
    context,
    controlOf(context),
    [],
    {
      participant: 'server',
      serverSeal: 'rsc',
      serverRuntime: { route: '/dashboard' },
      entryPath: '/dashboard',
      documentReadyState: 'loading',
      operations: {
        operations: [],
        stopOperations: [0],
        stopParticipants: ['server'],
      },
    },
  )
  const prepared = harness.run.prepare()
  await waitUntil(
    () => harness.server!.breakpointsAcknowledged() > 0,
    'the server stop was registered',
  )
  await waitUntil(
    () => harness.navigations.length === 1,
    'the entry navigation started',
  )
  // Act
  harness.server!.hit({ route: '/dashboard' })
  const pause = await waitUntil(
    () => harness.run.view().participants.server?.snapshot,
    'the published server pause',
  )
  // Assert
  assert.equal(harness.run.view().status, 'paused-server')
  assert.equal(pause.execution, 'server-render')
  assert.equal(pause.attribution, 'entry-load')
  assert.equal(pause.declaredIndex, 0)
  assert.equal(pause.executionIndex, 0)
  // Act: the learner continues and the page finishes loading
  harness.setDocumentReadyState('complete')
  await harness.run.continue('server', pause.pause)
  await prepared
  await waitUntil(
    () => harness.run.view().status === 'completed',
    'the run completed after the entry load',
  )
  // Assert
  assert.equal(harness.server!.continues.length, 1)
})

const submit: RepositoryOperation = {
  kind: 'click',
  title: 'Create Invoice',
  selector: 'button[type=submit]',
}

// Value: protects=the harness contract for an operation-driven stop: the input is answered at once (the server renders on its own), a scripted hit after it pauses the run as a server-render pause observed after operation 1, and the run completes after the continue (spike s10-bi: the POST paused in the page re-render); fails_when=the page's input waits for the server stop, the server hit is not matched to the declared stop, or the attribution is lost; no_claim=classification of other routes and the 20 s bounds
test('a scripted server hit after an operation pauses the stop declared after that operation', async (context) => {
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
      operations: {
        operations: [submit],
        stopOperations: [1],
        stopParticipants: ['server'],
      },
    },
  )
  await harness.run.prepare()
  // Act
  harness.run.action('op-1', 'repository-operation')
  await waitUntil(
    () => harness.inputsSeen() === 1,
    'the input reached the page',
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
  // Act
  await harness.run.continue('server', pause.pause)
  await waitUntil(
    () => harness.run.view().status === 'completed',
    'the run completed after the continue',
  )
})
