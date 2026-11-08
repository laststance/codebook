import assert from 'node:assert/strict'
import { test } from 'node:test'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import {
  apiScriptText,
  apiServerHit,
  apiServerRunHarness,
  endApiRequest,
  sendApiRequest,
  type ApiServerRunHarness,
} from './utils/apiServerRunHarness'
import {
  journalTypes,
  publishedPause,
  sendOperation,
} from './utils/routeHandlerRunHarness'

/**
 * Prepares the run, sends operation 1 and returns the instant just before the page could send its request.
 * @example const sentAtMs = await openOperation(harness)
 */
async function openOperation(harness: ApiServerRunHarness): Promise<number> {
  await harness.run.prepare()
  await sendOperation(harness, 1)
  return Date.now()
}

/** Copies the request fact of a published pause into this realm for a strict comparison. @example factOf(snapshot) // { state: 'attributed', … } */
function factOf(snapshot: { apiRequest?: object }): object | undefined {
  return snapshot.apiRequest ? { ...snapshot.apiRequest } : undefined
}

// Value: protects=AC 4 attributed row and D7: the one page request that started after the operation's input and was still open at the pause is named by method and path without its query, with its operation and the time-window basis, and the run resource carries the ready sentence; fails_when=the query reaches the fact, the basis or operation is missing, or the message lacks the sentence; no_claim=a real browser's Network timing or js-debug's pause latency (the stand-in page sends the events)
test('an API pause is tied to the one open page request and names its method and path without the query', async (context) => {
  // Arrange
  const harness = await apiServerRunHarness(context)
  await openOperation(harness)
  sendApiRequest(harness, {
    id: '7',
    method: 'POST',
    path: '/api/rpc/switches/switchTo?activity=3',
  })
  // Act
  await apiServerHit(harness)
  const snapshot = await publishedPause(harness)
  // Assert
  const fact = factOf(snapshot) as { sentence: string }
  assert.deepEqual(
    { ...fact, sentence: undefined },
    {
      state: 'attributed',
      method: 'POST',
      path: '/api/rpc/switches/switchTo',
      operation: 1,
      basis: 'time-window',
      sentence: undefined,
    },
  )
  assert.equal(fact.sentence.includes('POST /api/rpc/switches/switchTo'), true)
  assert.deepEqual(
    {
      execution: snapshot.execution,
      attribution: snapshot.attribution,
      message: harness.run.view().renderMessage?.startsWith(fact.sentence),
      status: harness.run.view().status,
    },
    {
      execution: 'server-action',
      attribution: undefined,
      message: true,
      status: 'paused-server',
    },
  )
})

// Value: protects=AC 4 none row and OV-2: an API pause with no page request open in the operation's window says that none was observed, never a request; fails_when=a request is named or the count is not 0; no_claim=what made the API reach the line
test('an API pause with no open page request is unattributed with reason none', async (context) => {
  // Arrange
  const harness = await apiServerRunHarness(context)
  await openOperation(harness)
  // Act
  await apiServerHit(harness)
  const snapshot = await publishedPause(harness)
  // Assert
  assert.deepEqual(
    { ...factOf(snapshot), sentence: undefined },
    { state: 'unattributed', reason: 'none', count: 0, sentence: undefined },
  )
})

// Value: protects=AC 4 several row: two open page requests in the window make the pause unattributed with their count, so no request is claimed; fails_when=one of them is named; no_claim=which one reached the line
test('an API pause with two open page requests is unattributed with reason several', async (context) => {
  // Arrange
  const harness = await apiServerRunHarness(context)
  await openOperation(harness)
  sendApiRequest(harness, { id: '7', path: '/api/rpc/a' })
  sendApiRequest(harness, { id: '8', path: '/api/rpc/b' })
  // Act
  await apiServerHit(harness)
  const snapshot = await publishedPause(harness)
  // Assert
  assert.deepEqual(
    { ...factOf(snapshot), sentence: undefined },
    { state: 'unattributed', reason: 'several', count: 2, sentence: undefined },
  )
})

// Value: protects=OV-1: a request that ended before the pause is excluded by its own timestamps even when its end event is received after the pause; fails_when=the late end event keeps the request a candidate; no_claim=real event ordering between the page and the editor connections
test('a page request whose end event arrives after the pause but ended before it is not a candidate', async (context) => {
  // Arrange
  const harness = await apiServerRunHarness(context)
  const operationSentAtMs = await openOperation(harness)
  sendApiRequest(harness, {
    id: '7',
    path: '/api/rpc/early',
    startedAtMs: operationSentAtMs,
    timestamp: 100,
  })
  await new Promise((resolve) => setTimeout(resolve, 250))
  // Act
  await apiServerHit(harness)
  // The request's own end timestamp says it finished 20 ms after it started, long before the pause.
  endApiRequest(harness, '7', 100.02)
  const snapshot = await publishedPause(harness)
  // Assert
  assert.deepEqual(
    { ...factOf(snapshot), sentence: undefined },
    { state: 'unattributed', reason: 'none', count: 0, sentence: undefined },
  )
})

// Value: protects=OV-1 delayed end: a request still open at the pause stays the candidate when its end event arrives after the pause with a time after it; fails_when=the later end drops the request; no_claim=real event ordering
test('a page request that ended after the pause stays the candidate when its end arrives late', async (context) => {
  // Arrange
  const harness = await apiServerRunHarness(context)
  const operationSentAtMs = await openOperation(harness)
  sendApiRequest(harness, {
    id: '7',
    path: '/api/rpc/slow',
    startedAtMs: operationSentAtMs,
    timestamp: 100,
  })
  // Act
  await apiServerHit(harness)
  endApiRequest(harness, '7', 105)
  const snapshot = await publishedPause(harness)
  // Assert
  assert.equal((factOf(snapshot) as { path: string }).path, '/api/rpc/slow')
})

// Value: protects=AC 4 delayed start: a request whose start event is received within the fixed wait after the pause, with a wall time inside the window, is counted; fails_when=the judgement happens at the pause and misses it; no_claim=the real 1 s race between two connections
test('a page request whose start event arrives after the pause but started inside the window is counted', async (context) => {
  // Arrange
  const harness = await apiServerRunHarness(context)
  const operationSentAtMs = await openOperation(harness)
  // Act
  await apiServerHit(harness)
  // The start event is sent right after the run stamped the pause's receipt, so the whole fixed wait remains for it under load.
  await waitUntil(
    () => harness.run['apiPauseReceivedAtMs'] !== undefined,
    'the API pause receipt',
  )
  sendApiRequest(harness, {
    id: '7',
    path: '/api/rpc/late',
    startedAtMs: operationSentAtMs + 1,
  })
  const snapshot = await publishedPause(harness)
  // Assert
  assert.equal((factOf(snapshot) as { path: string }).path, '/api/rpc/late')
})

// Value: protects=OV-3 and AC 5: a server stop declared after operation 3 requests no breakpoint while operations 1 and 2 run, so a handler they also reach never pauses early; fails_when=the API breakpoint exists before operation 3 is sent; no_claim=js-debug's binding of a pending breakpoint
test('an API stop declared after operation 3 requests its breakpoint only when operation 3 is sent', async (context) => {
  // Arrange
  const operation = (title: string) => ({
    kind: 'click' as const,
    title,
    selector: 'button[type=submit]',
  })
  const harness = await apiServerRunHarness(context, {
    stopOperations: [3],
    operations: [operation('One'), operation('Two'), operation('Three')],
  })
  await harness.run.prepare()
  const requested = (): number => harness.ownedBreakpointsRequested()
  // Act
  harness.run.action('op-1', 'repository-operation')
  await waitUntil(
    () => harness.run.view().operations?.[0]?.state === 'done',
    'operation 1',
  )
  const afterFirst = requested()
  harness.run.action('op-2', 'repository-operation')
  await waitUntil(
    () => harness.run.view().operations?.[1]?.state === 'done',
    'operation 2',
  )
  const afterSecond = requested()
  harness.run.action('op-3', 'repository-operation')
  await waitUntil(
    () => journalTypes(harness).includes('route-handler.armed'),
    'the breakpoint of operation 3',
  )
  // Assert
  assert.deepEqual(
    {
      afterFirst,
      afterSecond,
      armed: journalTypes(harness).filter(
        (type) => type === 'route-handler.armed',
      ).length,
    },
    { afterFirst: 0, afterSecond: 0, armed: 1 },
  )
})

// Value: protects=E-3 and D21 (entry before selection): the entry pause that arrives while the session is not yet a participant is held and continued exactly once after the session was selected and the channel subscribed; fails_when=the event fails the run as an unexpected stop, is dropped, or is continued before the selection or twice; no_claim=js-debug's real entry event order
test('an entry pause that arrives before the session is selected is held and continued once after selection', async (context) => {
  // Arrange
  const harness = await apiServerRunHarness(context, { entry: 'at-start' })
  // Act
  await harness.run.prepare()
  // Assert
  const types = journalTypes(harness)
  assert.deepEqual(
    {
      heldBeforeSelected:
        types.indexOf('api-server.entry-held') <
        types.indexOf('server.selected'),
      releasedAfterSelected:
        types.indexOf('server.selected') <
        types.indexOf('api-server.entry-released'),
      continues: harness.server!.continues.length,
      status: harness.run.view().status,
    },
    {
      heldBeforeSelected: true,
      releasedAfterSelected: true,
      continues: 1,
      status: 'ready',
    },
  )
})

// Value: protects=E-3 and D21 (entry during subscription): the entry pause that arrives while the run subscribes the inspector channel is held and continued once after the subscription; fails_when=the event is taken as a stop of the selected participant, or the release does not wait for it; no_claim=js-debug's real entry event order
test('an entry pause that arrives during the channel subscription is held and continued once', async (context) => {
  // Arrange
  const harness = await apiServerRunHarness(context, {
    entry: 'during-subscribe',
  })
  // Act
  await harness.run.prepare()
  // Assert
  const types = journalTypes(harness)
  assert.deepEqual(
    {
      heldAfterSelected:
        types.indexOf('server.selected') <
        types.indexOf('api-server.entry-held'),
      continues: harness.server!.continues.length,
      status: harness.run.view().status,
    },
    { heldAfterSelected: true, continues: 1, status: 'ready' },
  )
})

// Value: protects=E-3 cancel before release: a run cancelled while it waits for the entry pause continues nothing and ends the API's group; fails_when=a continue is sent for a cancelled run, or the group is left; no_claim=the 45 s attach bound
test('a run cancelled before the entry pause arrived continues nothing and ends the API group', async (context) => {
  // Arrange
  const harness = await apiServerRunHarness(context, { entry: 'manual' })
  const preparation = harness.run.prepare().then(
    () => 'prepared',
    () => 'cancelled',
  )
  await waitUntil(
    () => journalTypes(harness).includes('server.selected'),
    'the selection',
  )
  // Act
  await harness.run.stop()
  const outcome = await preparation
  // Assert
  assert.deepEqual(
    {
      outcome,
      continues: harness.server!.continues.length,
      released: journalTypes(harness).includes('api-server.entry-released'),
      events: harness.fake.events.slice(-2),
    },
    {
      outcome: 'cancelled',
      continues: 0,
      released: false,
      events: ['kill-first', 'close'],
    },
  )
})

// Value: protects=OV-4 and E-4: an executed script whose map retains another version of the stop file is refused as source-drift, the API's group is killed before anything resumes, and the handler is never continued; fails_when=the run resumes the pause, shows the declared line, or the refusal lacks its code; no_claim=a marker file written by a real handler (ownedApiServer.test.ts kills a real group)
test('a seal that finds another version of the stop file fails the run and kills the API before any resume', async (context) => {
  // Arrange
  const harness = await apiServerRunHarness(context)
  await openOperation(harness)
  sendApiRequest(harness, { id: '7', path: '/api/rpc/x' })
  // Act
  await apiServerHit(harness, {
    scriptText: apiScriptText(
      harness.server!.sealedUrl.replace('file://', ''),
      'var nextTheme = "edited";\n',
    ),
  })
  await waitUntil(
    () => harness.run.view().status === 'failed',
    'the seal refusal',
  )
  // Assert
  const events = harness.fake.events
  assert.deepEqual(
    {
      failure: harness.run
        .view()
        .failures[0]?.startsWith('EXPO_WEB_SEAL_FAILED(api-seal:'),
      killedFirst: events.indexOf('kill-first') >= 0,
      killBeforeClose:
        events.indexOf('close') === -1 ||
        events.indexOf('kill-first') < events.indexOf('close'),
      continues: harness.server!.continues.length,
      snapshots: harness.run.view().snapshots.length,
    },
    {
      failure: true,
      killedFirst: true,
      killBeforeClose: true,
      continues: 1,
      snapshots: 0,
    },
  )
})

// Value: protects=OV-4 source-unverifiable: an executed script without an inline map is refused and never resumed; fails_when=the disk file is taken as proof, or the handler continues; no_claim=tsx's real output
test('a seal that finds no inline map fails the run and never resumes the handler', async (context) => {
  // Arrange
  const harness = await apiServerRunHarness(context)
  await openOperation(harness)
  sendApiRequest(harness, { id: '7', path: '/api/rpc/x' })
  // Act
  await apiServerHit(harness, { scriptText: 'const nextTheme = "dark";' })
  await waitUntil(
    () => harness.run.view().status === 'failed',
    'the seal refusal',
  )
  // Assert
  assert.deepEqual(
    {
      failure: harness.run
        .view()
        .failures[0]?.startsWith('EXPO_WEB_SEAL_FAILED(api-seal:'),
      killedFirst: harness.fake.events.includes('kill-first'),
      continues: harness.server!.continues.length,
    },
    { failure: true, killedFirst: true, continues: 1 },
  )
})

// Value: protects=the pause orders of the two channels: the same API pause is published whichever of the DAP stopped and the CDP pause arrives first; fails_when=one order fails the run or publishes a second pause; no_claim=js-debug's real order
for (const order of ['cdp-first', 'dap-first'] as const)
  test(`an API pause is published once when the ${order === 'cdp-first' ? 'inspector pause' : 'debugger stop'} arrives first`, async (context) => {
    // Arrange
    const harness = await apiServerRunHarness(context)
    await openOperation(harness)
    sendApiRequest(harness, { id: '7', path: '/api/rpc/x' })
    // Act
    await apiServerHit(harness, {}, order)
    const snapshot = await publishedPause(harness)
    // Assert
    assert.deepEqual(
      {
        state:
          factOf(snapshot) && (factOf(snapshot) as { state: string }).state,
        snapshots: harness.run.view().snapshots.length,
        failures: [...harness.run.view().failures],
      },
      { state: 'attributed', snapshots: 1, failures: [] },
    )
  })
