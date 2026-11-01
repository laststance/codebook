import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { test } from 'node:test'

import { SECRET_FRAME_MARGIN_MS } from '../constants'
import type { RepositoryOperation } from '../repositoryConfigSchemas'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { configuredRuntimeHarness } from './utils/configuredRuntimeHarness'

const OPERATION_ACTION = 'repository-operation'
const CROSS_ORIGIN_SENTENCE =
  'An image was withheld while a frame from another origin, whose content Codebook cannot read, was on screen after a secret was typed.'
const ENABLED_STOP = [
  { path: 'enabled', mode: 'value', required: true },
] as const
const password: RepositoryOperation = {
  kind: 'text',
  title: 'Password',
  selector: '#password',
  secret: 'ask-learner',
}
const pending: RepositoryOperation = {
  kind: 'click',
  title: 'Pending',
  selector: '#pending',
}

/** Copies a value out of the run module's realm, whose objects a strict deep comparison would not take for this realm's. */
function plain<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value))
}

// protects=a third-party widget on the page after a typed secret never fails the run or loses the stop: the stop keeps its source and values, its image reads withheld, and the run completes; fails_when=the old gate passes and stores the image (status 'captured'), or the withheld capture throws 'Image withheld...' and the run fails; no_claim=a real page and screencast (the harness stands in for the observer and the viewport), pixels
test('a stop image withheld for a frame from another origin is recorded as withheld, and the run still reaches its result, partial', async (context) => {
  // Arrange
  const harness = await configuredRuntimeHarness(context, undefined, [], {
    consultSecretFrameGate: true,
    operations: {
      operations: [password],
      stopOperations: [1],
      controls: { '#password': { tagName: 'input', type: 'password' } },
    },
  })
  const { run } = harness
  await run.prepare()
  harness.setCrossOriginFrameDrawn(true)
  // Act
  run.action('op-1', OPERATION_ACTION, { learnerSecret: 'typed-by-learner' })
  const stop = await waitUntil(
    () => run.view().participants.browser.snapshot,
    'the stop of the password operation',
  )
  await run.continue('browser', stop.pause)
  await waitUntil(() => run.view().status === 'completed', 'the result')
  await run.stop()
  // Assert
  const view = run.view()
  assert.deepEqual(plain(view.captures['paused-browser']), {
    status: 'withheld',
    withheldReason: 'cross-origin-frame',
    error: CROSS_ORIGIN_SENTENCE,
  })
  assert.equal(view.snapshotCaptures?.[stop.id]?.status, 'withheld')
  assert.equal(view.captures.after?.status, 'withheld')
  assert.deepEqual(plain(view.failures), [])
  assert.equal(view.captureOutcome, 'incomplete')
  assert.equal(view.finalOutcome, 'partial')
  assert.equal(view.operations?.[0]?.state, 'done')
  assert.deepEqual(plain(view.withheldImages), {
    crossOriginFrame: 2,
    secretNotVerified: 0,
  })
  const withheldEvent = view.events.find(
    (event) => event.type === 'capture.withheld',
  )
  assert.equal(
    (withheldEvent?.detail as { reason?: string } | undefined)?.reason,
    'cross-origin-frame',
  )
  assert.deepEqual(
    readdirSync(view.artifactDirectory).filter((name) =>
      /^paused-browser.*\.png$/.test(name),
    ),
    [],
  )
})

// protects=the outcome counts every stop's image, so a study with a missing stop image is never saved as demonstrated (which decodeConfiguredStudy would reject at save); fails_when=captureOutcome reads only the last capture of each phase and the run reads 'demonstrated'; no_claim=the save itself
test('an earlier stop image withheld keeps the run partial even when later images are captured', async (context) => {
  // Arrange
  const harness = await configuredRuntimeHarness(
    context,
    undefined,
    [{ line: 1, column: 7, inspections: [...ENABLED_STOP] }],
    {
      consultSecretFrameGate: true,
      operations: {
        operations: [password, pending],
        stopOperations: [1, 2],
        controls: { '#password': { tagName: 'input', type: 'password' } },
      },
    },
  )
  const { run } = harness
  await run.prepare()
  harness.setCrossOriginFrameDrawn(true)
  run.action('op-1', OPERATION_ACTION, { learnerSecret: 'typed-by-learner' })
  const firstStop = await waitUntil(
    () => run.view().participants.browser.snapshot,
    'the stop of operation 1',
  )
  // Act
  const closedAtMs = harness.setCrossOriginFrameDrawn(false)
  await waitUntil(
    () => Date.now() > closedAtMs + SECRET_FRAME_MARGIN_MS,
    'the page clock past the closed interval',
  )
  await run.continue('browser', firstStop.pause)
  await waitUntil(() => run.view().operations?.[0]?.state === 'done', 'op 1')
  run.action('op-2', OPERATION_ACTION)
  const secondStop = await waitUntil(() => {
    const snapshot = run.view().participants.browser.snapshot
    return snapshot && snapshot.id !== firstStop.id ? snapshot : undefined
  }, 'the stop of operation 2')
  await run.continue('browser', secondStop.pause)
  await waitUntil(() => run.view().status === 'completed', 'the result')
  await run.stop()
  // Assert
  const view = run.view()
  assert.equal(view.snapshotCaptures?.[firstStop.id]?.status, 'withheld')
  assert.equal(view.snapshotCaptures?.[secondStop.id]?.status, 'captured')
  assert.equal(view.captures.after?.status, 'captured')
  assert.equal(view.finalOutcome, 'partial')
  assert.deepEqual(plain(view.failures), [])
})
