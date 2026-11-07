import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { RepositoryOperation } from '../repositoryConfigSchemas'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { configuredRuntimeHarness } from './utils/configuredRuntimeHarness'
import { armedEntry } from './utils/entryRenderHarness'
import {
  hitOnLine,
  PAGES_SERVER_RETURN_LINE,
  pagesServerRun,
} from './utils/pagesServerRunHarness'

const OPERATION_ACTION = 'repository-operation'
/** The screenshot a Pages server stop's pause takes: after the image before the entry request. */
const SERVER_STOP_SCREENSHOT = 1
const UNAVAILABLE_SENTENCE =
  'The paused page drew no image of this stop within 3 s; the stop keeps its source and values, and the run goes on and ends partial.'
const SERVER_UNAVAILABLE_SENTENCE =
  'The page drew no image while the server was paused at this stop within 3 s; the stop keeps its source and values, and the run goes on and ends partial.'
const ENABLED_STOP = [
  { path: 'enabled', mode: 'value', required: true },
] as const
const showMore: RepositoryOperation = {
  kind: 'click',
  title: 'Show more',
  selector: '#more',
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

// protects=native C79-2: a stop whose paused page answers no screenshot within the 3 s bound keeps its source and values, its image reads failed with the unavailable sentence, the run continues to its result and ends partial; fails_when=the timed-out screenshot fails the run (the old "CDP Page.captureScreenshot timed out" failure), or the stop is lost, or the run reads demonstrated; no_claim=a real Chrome paused mid-frame (the stand-in page leaves screenshot 2, the stop's, unanswered until the client's bound)
test('a stop whose paused page draws no image in time keeps its values and the run reaches its result, partial', async (context) => {
  // Arrange
  const harness = await configuredRuntimeHarness(context, undefined, [], {
    timedOutScreenshots: [2],
    operations: { operations: [showMore], stopOperations: [1] },
  })
  const { run } = harness
  await run.prepare()
  // Act
  run.action('op-1', OPERATION_ACTION)
  const stop = await waitUntil(
    () => run.view().participants.browser.snapshot,
    'the stop of the Show more click',
  )
  await run.continue('browser', stop.pause)
  await waitUntil(() => run.view().status === 'completed', 'the result')
  await run.stop()
  // Assert
  const view = run.view()
  assert.deepEqual(plain(view.failures), [])
  assert.deepEqual(plain(view.captures['paused-browser']), {
    status: 'failed',
    error: UNAVAILABLE_SENTENCE,
  })
  assert.equal(view.snapshotCaptures?.[stop.id]?.status, 'failed')
  assert.equal(view.captures.before?.status, 'captured')
  assert.equal(view.captures.after?.status, 'captured')
  assert.equal(view.captureOutcome, 'incomplete')
  assert.equal(view.finalOutcome, 'partial')
  assert.equal(view.operations?.[0]?.state, 'done')
  assert.deepEqual(
    view.events
      .filter((event) => event.type === 'capture.unavailable')
      .map((event) => Reflect.get(Object(event.detail), 'phase')),
    ['paused-browser'],
  )
})

// protects=native C79-2: in a run of two stops, the second stop's image timing out (the stop that pauses right after the first stop's continue) leaves the first stop's image captured, keeps the second stop, and the run still completes partial; fails_when=the second stop's timeout ends the run, or the first stop's captured image is lost; no_claim=a real Chrome (the stand-in page leaves screenshot 3, the second stop's, unanswered)
test('a later stop whose image times out keeps the earlier captured stop image and the run completes partial', async (context) => {
  // Arrange
  const harness = await configuredRuntimeHarness(
    context,
    undefined,
    [{ line: 1, column: 7, inspections: [...ENABLED_STOP] }],
    {
      timedOutScreenshots: [3],
      operations: { operations: [showMore, pending], stopOperations: [1, 2] },
    },
  )
  const { run } = harness
  await run.prepare()
  run.action('op-1', OPERATION_ACTION)
  const firstStop = await waitUntil(
    () => run.view().participants.browser.snapshot,
    'the stop of operation 1',
  )
  await run.continue('browser', firstStop.pause)
  await waitUntil(() => run.view().operations?.[0]?.state === 'done', 'op 1')
  // Act
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
  assert.deepEqual(plain(view.failures), [])
  assert.equal(view.snapshotCaptures?.[firstStop.id]?.status, 'captured')
  assert.equal(view.snapshotCaptures?.[secondStop.id]?.status, 'failed')
  assert.equal(view.finalOutcome, 'partial')
})

// protects=only a stop's image may be missing: a screenshot of no stop (the result image after the last continue) that times out still fails the run with the client's timeout; fails_when=the after image's timeout is swallowed and the run reads completed without its result image; no_claim=which phases a real page leaves unanswered
test('a result image that times out still fails the run', async (context) => {
  // Arrange
  const harness = await configuredRuntimeHarness(context, undefined, [], {
    timedOutScreenshots: [3],
    operations: { operations: [showMore], stopOperations: [1] },
  })
  const { run } = harness
  await run.prepare()
  run.action('op-1', OPERATION_ACTION)
  const stop = await waitUntil(
    () => run.view().participants.browser.snapshot,
    'the stop of the Show more click',
  )
  // Act
  await run.continue('browser', stop.pause).catch(() => undefined)
  await waitUntil(() => run.view().failures.length > 0, 'the run failed')
  // Assert
  const view = run.view()
  assert.match(
    view.failures.join('; '),
    /CDP Page\.captureScreenshot timed out/,
  )
  assert.equal(view.captures.after?.status, 'failed')
  assert.equal(view.snapshotCaptures?.[stop.id]?.status, 'captured')
})

// protects=decision D3 (Cycle 0095, C94-L3): a server stop whose page draws no image within the 3 s bound keeps its committed source and values, its image reads failed with the server-stop sentence, and the run goes on instead of ending; fails_when=the timeout ends the run ("CDP Page.captureScreenshot timed out"), the snapshot or its values are lost, or the capture lacks the unavailable sentence; why_changed=this test pinned the old rule that a server stop's image timeout fails the run, which ended 2 of 2 Cursor runs on 2026-11-07; no_claim=a real Next server or Cursor's page (the stand-in page leaves the server stop's screenshot unanswered)
test('a server stop whose page draws no image in time keeps its committed values and the run goes on to its end, partial', async (context) => {
  // Arrange
  const harness = await pagesServerRun(context, {
    timedOutScreenshots: [SERVER_STOP_SCREENSHOT],
  })
  const prepared = harness.run.prepare()
  await armedEntry(harness)
  // Act
  harness.server!.hit(
    hitOnLine(PAGES_SERVER_RETURN_LINE, {
      fixture: 'get-server-side-props-before-await',
    }),
  )
  const stop = await waitUntil(
    () => harness.run.view().participants.server?.snapshot,
    'the server stop committed',
  )
  harness.setDocumentReadyState('complete')
  await harness.run.continue('server', stop.pause)
  await prepared
  await waitUntil(
    () => harness.run.view().status === 'completed',
    'the run went on to its end',
  )
  await harness.run.stop()
  // Assert
  const view = harness.run.view()
  assert.deepEqual(plain(view.failures), [])
  assert.equal(stop.source?.line, PAGES_SERVER_RETURN_LINE)
  assert.equal(stop.values['value:count'], 3)
  assert.deepEqual(plain(view.captures['paused-server']), {
    status: 'failed',
    error: SERVER_UNAVAILABLE_SENTENCE,
  })
  assert.equal(view.snapshotCaptures?.[stop.id]?.status, 'failed')
  assert.equal(view.captureOutcome, 'incomplete')
  assert.equal(view.finalOutcome, 'partial')
  assert.deepEqual(
    view.events
      .filter((event) => event.type === 'capture.unavailable')
      .map((event) => Reflect.get(Object(event.detail), 'phase')),
    ['paused-server'],
  )
})
