import assert from 'node:assert/strict'
import { test } from 'node:test'

import { MAX_EVENTS } from '../constants'
import { StudyError } from '../errors'
import { readResource } from '../resources'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import type { NodeServerOutputLine } from '../utils/describeNodeServerOutputLine'
import { nodeServerEventDetail } from '../utils/nodeServerEventDetail'

import { createHarness } from './helpers'
import { startFakeNodeServerRun } from './utils/startFakeNodeServerRun'

/** Reads the first page of a run's events the way an agent does. */
async function eventsOf(
  service: Parameters<typeof readResource>[0],
  runUri: string,
): Promise<{ type: string; detail: Record<string, unknown> }[]> {
  const page = await readResource(service, `${runUri}/events/0`)
  assert.ok('text' in page)
  return JSON.parse(page.text).events
}

// protects=the event whitelist per type: output keeps channel and text cut at 4,096 characters with credentials masked; request, response, learner pause and resume and failure keep their listed fields only; fails_when=a path, an argument list, a variable name or an unlisted field reaches the events resource; no_claim=the events the real run emits (integration)
test('node-server events publish only their whitelisted fields, masked and bounded', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const { service, record, run } = await startFakeNodeServerRun(harness)
  const privateFile = `${harness.directory}/src/server.ts`
  // Act
  run.record('node-server.output', {
    sequence: 1,
    elapsedMs: 3,
    channel: 'stderr',
    text: `Authorization: Bearer abcdefgh12345 ${'x'.repeat(5_000)}`,
    cwd: '/Users/ada/repo',
  })
  run.record('node-server.request', {
    method: 'POST',
    path: '/api/items?q=sk-abcdefghijklmnopqrstuvwxyz',
    bodyBytes: 18,
    address: '127.0.0.1:4100',
    headers: { cookie: 'x' },
  })
  run.record('node-server.response', {
    status: 201,
    contentType: 'application/json',
    body: '{"id":7}',
    bodyBytes: 8,
    readCut: false,
    location: '/api/items/7',
    elapsedMs: 31,
    rawHeaders: ['set-cookie'],
  })
  run.record('node-server.learner-paused', {
    kind: 'unattributed',
    path: 'src/routes/items.ts',
    line: 12,
    reason: 'breakpoint',
    declaredStopIndex: 1,
    threadId: 3,
  })
  run.record('node-server.learner-resumed', { declaredStopIndex: 1 })
  run.record('node-server.failure', {
    code: 'REQUEST_FAILED',
    cause: `ECONNRESET at '${privateFile}'`,
    stack: 'x',
  })
  const events = await eventsOf(service, service.uri(record.id))
  // Assert
  const byType = Object.fromEntries(
    events.map((event) => [event.type, event.detail]),
  )
  assert.deepEqual(Object.keys(byType), [
    'node-server.output',
    'node-server.request',
    'node-server.response',
    'node-server.learner-paused',
    'node-server.learner-resumed',
    'node-server.failure',
  ])
  assert.equal(byType['node-server.output']?.channel, 'stderr')
  assert.equal((byType['node-server.output']?.text as string).length, 4_096)
  assert.match(
    byType['node-server.output']?.text as string,
    /^Authorization: Bearer \[masked\] /,
  )
  assert.deepEqual(byType['node-server.request'], {
    method: 'POST',
    path: '/api/items?q=[masked]',
    bodyBytes: 18,
    address: '127.0.0.1:4100',
  })
  assert.deepEqual(byType['node-server.response'], {
    status: 201,
    contentType: 'application/json',
    body: '{"id":7}',
    bodyBytes: 8,
    readCut: false,
    location: '/api/items/7',
    elapsedMs: 31,
  })
  assert.deepEqual(byType['node-server.learner-paused'], {
    kind: 'unattributed',
    declaredStopIndex: 1,
    path: 'src/routes/items.ts',
    line: 12,
    reason: 'breakpoint',
  })
  assert.deepEqual(byType['node-server.learner-resumed'], {
    declaredStopIndex: 1,
  })
  assert.equal(byType['node-server.failure']?.code, 'REQUEST_FAILED')
  assert.equal(
    byType['node-server.failure']?.cause,
    "ECONNRESET at '<storage>/src/server.ts'",
  )
})

// protects=started and closed events keep no private path: the pid, the loader kind, the Node version and the exit code or signal only; an unknown type reads omitted; fails_when=the launch journal's paths, arguments or variable names leave the run; no_claim=none
test('node-server started and closed events are reduced and an unknown type reads omitted', () => {
  // Arrange
  const started = {
    pid: 4242,
    args: [
      '--inspect-brk=127.0.0.1:0',
      '--import',
      '<workspace>/node_modules/tsx/dist/loader.mjs',
      '<storage>/src/server.ts',
    ],
    cwd: '<workspace>',
    loader: '<workspace>/node_modules/tsx/dist/loader.mjs',
    nodeVersion: 'v24.1.0',
    inheritedVariables: ['HOME', 'PATH'],
    secretEnvironmentInherited: false,
  }
  // Act
  const startedDetail = nodeServerEventDetail('node-server.started', started)
  const closedDetail = nodeServerEventDetail('node-server.closed', {
    pid: 4242,
    exitCode: null,
    signal: 'SIGTERM',
    killed: false,
  })
  const unknown = nodeServerEventDetail('node-server.surprise', { token: 'x' })
  const notAnObject = nodeServerEventDetail('node-server.request', 'text')
  // Assert
  assert.deepEqual(startedDetail, {
    pid: 4242,
    loader: 'tsx',
    nodeVersion: 'v24.1.0',
  })
  assert.deepEqual(closedDetail, {
    pid: 4242,
    exitCode: null,
    signal: 'SIGTERM',
  })
  assert.deepEqual(unknown, { omitted: true })
  assert.deepEqual(notAnObject, {
    method: null,
    path: null,
    bodyBytes: null,
    address: null,
  })
})

// protects=the events journal keeps the test run's bounds: after MAX_EVENTS events, or one event over the detail bound, one truncation marker ends it and later events are dropped; fails_when=the journal grows without bound or the marker is missing; no_claim=Output lines (they do not depend on the journal's room)
test('node-server events stop at the journal bounds with one truncation marker', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const { record, run } = await startFakeNodeServerRun(harness)
  // Act
  for (let index = 0; index < MAX_EVENTS + 5; index++)
    run.record('node-server.learner-resumed', { path: 'a.ts', line: index })
  // Assert
  const events = record.nodeEvents ?? []
  assert.equal(events.length, MAX_EVENTS)
  assert.equal(events.at(-1)?.type, 'node-server.events-truncated')
  assert.equal(
    events.filter((event) => event.type === 'node-server.events-truncated')
      .length,
    1,
  )
})

// protects=one event whose escaped detail exceeds the per-event bound ends the journal at once; fails_when=an oversized event is kept whole; no_claim=none
test('a node-server event over the per-event byte bound is replaced by the truncation marker', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const { record, run } = await startFakeNodeServerRun(harness)
  // Act
  run.record('node-server.output', {
    sequence: 1,
    elapsedMs: 1,
    channel: 'stdout',
    text: '\u0001'.repeat(4_096),
  })
  // Assert
  assert.deepEqual(
    (record.nodeEvents ?? []).map((event) => event.type),
    ['node-server.events-truncated'],
  )
})

// protects=the run's lifecycle events reach the events resource with their listed fields only (ready, a stop hit at start, a pause, the capture budget, a port held by another process, attach and stop); fails_when=one of them reads omitted or keeps an unlisted field; no_claim=the run emitting them (ownedNodeServerRun.test.ts)
test('node-server lifecycle events keep their listed fields and drop the rest', () => {
  // Arrange
  const emitted: Array<[string, Record<string, unknown>]> = [
    ['node-server.ready', { host: '::1', port: 4100, socket: 'x' }],
    ['node-server.stop-hit-at-start', { declaredStopIndex: 0, frame: 'x' }],
    [
      'node-server.pause',
      { declaredStopIndex: 1, stopNumber: 2, pauseGeneration: 3, threadId: 9 },
    ],
    ['node-server.capture-budget-exhausted', { limit: 16, hits: 17 }],
    [
      'node-server.port-held-by-other',
      { port: 4100, pid: 77, command: 'postgres', cwd: '/x' },
    ],
    ['node-server.attached', { pid: 4242, endpoint: 'ws://127.0.0.1:1/x' }],
    ['node-server.stopped', { pid: 4242, signal: 'SIGKILL' }],
  ]
  // Act
  const details = emitted.map(([type, detail]) => [
    type,
    nodeServerEventDetail(type, detail),
  ])
  // Assert
  assert.deepEqual(details, [
    ['node-server.ready', { host: '::1', port: 4100 }],
    ['node-server.stop-hit-at-start', { declaredStopIndex: 0 }],
    [
      'node-server.pause',
      { declaredStopIndex: 1, stopNumber: 2, pauseGeneration: 3 },
    ],
    ['node-server.capture-budget-exhausted', { limit: 16 }],
    [
      'node-server.port-held-by-other',
      { port: 4100, pid: 77, command: 'postgres' },
    ],
    ['node-server.attached', { pid: 4242 }],
    ['node-server.stopped', { pid: 4242 }],
  ])
})

/** Starts a run whose Output › Codebook lines a test reads. */
async function startWithOutput(context: {
  after(callback: () => unknown): void
}) {
  const harness = await createHarness()
  context.after(() => harness.close())
  const lines: NodeServerOutputLine[] = []
  harness.service.outputLog = (line) => lines.push(line)
  return { harness, lines, ...(await startFakeNodeServerRun(harness)) }
}

// protects=D10: Output › Codebook gets one plain entry for the request and one for the response, each naming the run id; output text and other events write none; fails_when=an entry is missing, doubled, names no run or leaks the body; no_claim=the channel itself (extension wiring)
test('the Output channel gets one plain entry for the request and one for the response, naming the run', async (context) => {
  // Arrange
  const { lines, record, run } = await startWithOutput(context)
  // Act
  run.record('node-server.output', { channel: 'stdout', text: 'listening' })
  run.record('node-server.request', {
    method: 'GET',
    path: '/api/healthz',
    bodyBytes: 0,
    address: '127.0.0.1:4100',
  })
  run.record('node-server.response', {
    status: 200,
    contentType: 'application/json',
    body: '{"status":"ok"}',
    bodyBytes: 15,
    elapsedMs: 12,
  })
  // Assert
  assert.deepEqual(lines, [
    {
      level: 'info',
      text: `Run ${record.id}: sent GET /api/healthz to 127.0.0.1:4100 (0 body bytes).`,
    },
    {
      level: 'info',
      text: `Run ${record.id}: response 200 application/json after 12 ms (15 body bytes).`,
    },
  ])
})

// protects=D10: a start failure writes only its failure entry, once, naming the run and the code, even when the run also reported a failure event; fails_when=a request or response entry appears for a start that sent nothing, or the failure is written twice; no_claim=none
test('a start failure writes only its failure entry, once', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const lines: NodeServerOutputLine[] = []
  harness.service.outputLog = (line) => lines.push(line)
  const { record, run } = await startFakeNodeServerRun(harness, {
    holdPrepare: true,
  })
  run.prepareFailure = new StudyError(
    'SERVER_NOT_LISTENING',
    'Port 4100 is not listening; the server listens on port 4300 (port: 4300).',
  )
  await waitUntil(() => run.calls.includes('prepare'), 'the run was created')
  // Act
  run.record('node-server.failure', {
    code: 'SERVER_NOT_LISTENING',
    cause: 'not listening',
  })
  run.prepareGate.resolve()
  await record.preparation
  await record.stopPromise
  // Assert
  assert.deepEqual(lines, [
    {
      level: 'error',
      text: `Run ${record.id} failed: SERVER_NOT_LISTENING: not listening`,
    },
  ])
})

// protects=D10: a request failure and a run failure that the run reported no failure event for are still written once each; fails_when=a failure is invisible in Output › Codebook; no_claim=none
test('a failed request and a failed run each write one failure entry without a failure event', async (context) => {
  // Arrange
  const { lines, record, run } = await startWithOutput(context)
  await run.enter('request-in-flight')
  // Act
  run.failRun(new StudyError('SERVER_EXITED', 'The server exited with code 1.'))
  run.failRun(new StudyError('SERVER_EXITED', 'The server exited with code 1.'))
  await record.stopPromise
  // Assert
  assert.deepEqual(lines, [
    {
      level: 'error',
      text: `Run ${record.id} failed: SERVER_EXITED: The server exited with code 1.`,
    },
  ])
})

// protects=a sink that throws must not escape the run that reports (the channel after deactivation); fails_when=a throwing outputLog breaks the event callback; no_claim=none
test('a throwing Output sink does not break the run', async (context) => {
  // Arrange
  const { harness, record, run } = await startWithOutput(context)
  harness.service.outputLog = () => {
    throw new Error('channel disposed')
  }
  // Act / Assert
  assert.doesNotThrow(() =>
    run.record('node-server.request', {
      method: 'GET',
      path: '/',
      bodyBytes: 0,
      address: '127.0.0.1:4100',
    }),
  )
  assert.equal(record.nodeEvents?.length, 1)
})
