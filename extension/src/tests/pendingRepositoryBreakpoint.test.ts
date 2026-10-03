import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { test } from 'node:test'

import type { DebugProtocol } from '@vscode/debugprotocol'
import type { DebugSession } from 'vscode'

import type * as OwnedRepositoryBreakpointModule from '../ownedRepositoryBreakpoint'

import { loadModule } from './utils/loadModule'

/** Supplies native API identities and explicit adapter messages without starting an editor or application; `acknowledgedAt` selects the registration rule of the owner under test. @example const harness = await breakpointHarness(); const nodeTestStop = await breakpointHarness('declared-column') */
async function breakpointHarness(
  acknowledgedAt?: 'declared-line' | 'declared-column',
  /** The owner's rule for a verified reply on another line; without it such a reply is refused. */
  acceptsLaterLine?: (line: number) => boolean,
) {
  class Position {
    constructor(
      readonly line: number,
      readonly character: number,
    ) {}
  }
  class Location {
    readonly range
    constructor(
      readonly uri: { fsPath: string },
      start: Position,
    ) {
      this.range = { start }
    }
  }
  let nextId = 0
  class SourceBreakpoint {
    readonly id = String(++nextId)
    constructor(readonly location: Location) {}
  }
  const breakpoints: SourceBreakpoint[] = []
  const module = await loadModule<typeof OwnedRepositoryBreakpointModule>(
    resolve(__dirname, '../ownedRepositoryBreakpoint.js'),
    {
      vscode: {
        Position,
        Location,
        SourceBreakpoint,
        Uri: { file: (fsPath: string) => ({ fsPath }) },
        debug: {
          breakpoints,
          addBreakpoints(values: SourceBreakpoint[]) {
            breakpoints.push(...values)
          },
          removeBreakpoints(values: SourceBreakpoint[]) {
            for (const value of values) {
              const index = breakpoints.indexOf(value)
              if (index >= 0) breakpoints.splice(index, 1)
            }
          },
        },
      },
    },
  )
  const session: DebugSession = {
    id: 'owned-server',
    name: 'server',
    type: 'pwa-node',
    workspaceFolder: undefined,
    configuration: { type: 'pwa-node', name: 'server', request: 'attach' },
    customRequest: async () => undefined,
    getDebugProtocolBreakpoint: async () => undefined,
  }
  const breakpoint = new module.OwnedRepositoryBreakpoint(
    '/repo/actions.ts',
    20,
    5,
    acknowledgedAt,
    acceptsLaterLine,
  )
  const request = (
    sequence = 1,
    positions = [
      { line: 2, column: 1 },
      { line: 20, column: 5 },
    ],
  ): DebugProtocol.Request => ({
    seq: sequence,
    type: 'request',
    command: 'setBreakpoints',
    arguments: { source: { path: '/repo/actions.ts' }, breakpoints: positions },
  })
  const response = (
    sequence = 1,
    selected: DebugProtocol.Breakpoint = {
      id: 8,
      verified: false,
      reason: 'pending',
    },
  ): DebugProtocol.Response => ({
    seq: sequence + 100,
    type: 'response',
    command: 'setBreakpoints',
    request_seq: sequence,
    success: true,
    body: {
      breakpoints: [{ id: 7, verified: true, line: 2, column: 1 }, selected],
    },
  })
  return {
    breakpoint,
    session,
    request,
    response,
    signal: new AbortController().signal,
    editorBreakpoints: breakpoints,
  }
}

test('an acknowledged lazy server breakpoint remains pending rather than claiming a loaded binding', async () => {
  // Arrange
  const { breakpoint, session, request, response, signal } =
    await breakpointHarness()
  // Act
  breakpoint.onRequest(session, request())
  breakpoint.onResponse(session, response())
  const receipt = await breakpoint.registered(session, signal)
  // Assert
  assert.equal(
    JSON.stringify(receipt),
    '{"sessionId":"owned-server","requestSequence":1,"breakpointId":8,"status":"pending"}',
  )
  assert.equal(breakpoint.retired, false)
})

test('a registration verified at the requested position of the declared line is bound', async () => {
  // Arrange
  const { breakpoint, session, request, response, signal } =
    await breakpointHarness()
  // Act
  breakpoint.onRequest(session, request())
  breakpoint.onResponse(
    session,
    response(1, {
      id: 8,
      verified: true,
      line: 20,
      column: 5,
      source: { path: '/repo/actions.ts' },
    }),
  )
  // Assert
  assert.equal((await breakpoint.registered(session, signal)).status, 'bound')
})

test('a registration the adapter verifies at another column of the declared line keeps its receipt as bound', async () => {
  // Arrange
  const { breakpoint, session, request, response, signal } =
    await breakpointHarness()
  // Act
  breakpoint.onRequest(session, request())
  breakpoint.onResponse(
    session,
    response(1, { id: 8, verified: true, line: 20, column: 9 }),
  )
  const receipt = await breakpoint.registered(session, signal)
  // Assert
  assert.equal(
    JSON.stringify(receipt),
    '{"sessionId":"owned-server","requestSequence":1,"breakpointId":8,"status":"bound"}',
  )
})

test('a pending registration that reports another column of the declared line stays pending', async () => {
  // Arrange
  const { breakpoint, session, request, response, signal } =
    await breakpointHarness()
  // Act
  breakpoint.onRequest(session, request())
  breakpoint.onResponse(
    session,
    response(1, { id: 8, verified: false, line: 20, column: 6 }),
  )
  // Assert
  assert.equal((await breakpoint.registered(session, signal)).status, 'pending')
})

test('a registration the adapter verifies on another line blocks continuation and identifies the rejected position', async () => {
  // Arrange
  const { breakpoint, session, request, response, signal } =
    await breakpointHarness()
  // Act
  breakpoint.onRequest(session, request())
  breakpoint.onResponse(
    session,
    response(1, { id: 8, verified: true, line: 21, column: 5 }),
  )
  // Assert
  await assert.rejects(breakpoint.registered(session, signal), (error) => {
    assert.match(
      String(error),
      /Selected adapter did not acknowledge the declared breakpoint registration/,
    )
    assert.match(String(error), /"expectedLine":20/)
    assert.match(String(error), /"selectedLine":21/)
    assert.match(String(error), /"selectedColumn":5/)
    return true
  })
})

test('failed missing duplicate and rebound adapter registrations cannot authorize application input', async () => {
  for (const selected of [
    { id: 8, verified: false, reason: 'failed' },
    { verified: false },
    { id: 7, verified: false },
    { id: 8, verified: true },
    { id: 8, verified: true, line: 21, column: 5 },
    { id: 8, verified: false, line: 21, column: 5 },
    { id: 8, verified: false, source: { path: '/repo/other.ts' } },
  ] satisfies DebugProtocol.Breakpoint[]) {
    // Arrange
    const { breakpoint, session, request, response, signal } =
      await breakpointHarness()
    // Act
    breakpoint.onRequest(session, request())
    breakpoint.onResponse(session, response(1, selected))
    // Assert
    await assert.rejects(
      breakpoint.registered(session, signal),
      /did not acknowledge/,
    )
  }
})

test('truncated and unsuccessful setBreakpoints replies cannot acknowledge a pending source stop', async () => {
  for (const kind of ['truncated', 'failed']) {
    // Arrange
    const { breakpoint, session, request, response, signal } =
        await breakpointHarness(),
      reply = response()
    if (kind === 'truncated')
      reply.body = { breakpoints: [{ id: 8, verified: false }] }
    else reply.success = false
    // Act
    breakpoint.onRequest(session, request())
    breakpoint.onResponse(session, reply)
    // Assert
    await assert.rejects(
      breakpoint.registered(session, signal),
      /did not acknowledge/,
    )
  }
})

test('a later breakpoint replacement invalidates earlier acknowledgements and ignores their delayed responses', async () => {
  // Arrange
  const { breakpoint, session, request, response, signal } =
    await breakpointHarness()
  breakpoint.onRequest(session, request())
  breakpoint.onResponse(session, response())
  assert.equal(
    (await breakpoint.registered(session, signal)).requestSequence,
    1,
  )
  // Act
  breakpoint.onRequest(session, request(2))
  breakpoint.onResponse(session, response(1))
  const cancellation = new AbortController(),
    waiting = breakpoint.registered(session, cancellation.signal)
  cancellation.abort()
  // Assert
  await assert.rejects(waiting, { name: 'AbortError' })
  breakpoint.onResponse(session, response(2))
  assert.equal(
    (await breakpoint.registered(session, signal)).requestSequence,
    2,
  )
})

test('another debugger session or source cannot acknowledge the selected registration', async () => {
  // Arrange
  const { breakpoint, session, request, response } = await breakpointHarness()
  const foreign = { ...session, id: 'foreign-server' },
    wrongSource = request()
  wrongSource.arguments.source.path = '/repo/other.ts'
  // Act
  breakpoint.onRequest(session, wrongSource)
  breakpoint.onResponse(session, response())
  breakpoint.onRequest(session, request())
  breakpoint.onResponse(foreign, response())
  const cancellation = new AbortController(),
    waiting = breakpoint.registered(session, cancellation.signal)
  cancellation.abort()
  // Assert
  await assert.rejects(waiting, { name: 'AbortError' })
})

test('removed or ambiguous requested positions revoke earlier pending registration', async () => {
  // Arrange
  const { breakpoint, session, request, response, signal } =
    await breakpointHarness()
  // Act / Assert
  breakpoint.onRequest(
    session,
    request(1, [
      { line: 20, column: 5 },
      { line: 20, column: 5 },
    ]),
  )
  await assert.rejects(breakpoint.registered(session, signal), /ambiguous/)
  breakpoint.onRequest(session, request(2, [{ line: 2, column: 1 }]))
  await assert.rejects(breakpoint.registered(session, signal), /absent/)
  breakpoint.onRequest(session, request(3))
  breakpoint.onResponse(session, response(3))
  breakpoint.remove()
  await assert.rejects(breakpoint.registered(session, signal), /removed/)
})

test('conditional logpoint and modified-source requests cannot qualify the frozen unconditional stop', async () => {
  for (const property of [
    'condition',
    'hitCondition',
    'logMessage',
    'sourceModified',
  ]) {
    // Arrange
    const { breakpoint, session, request, response, signal } =
        await breakpointHarness(),
      changed = request()
    if (property === 'sourceModified') changed.arguments.sourceModified = true
    else changed.arguments.breakpoints[1][property] = 'changed'
    // Act
    breakpoint.onRequest(session, changed)
    breakpoint.onResponse(session, response())
    // Assert
    await assert.rejects(
      breakpoint.registered(session, signal),
      /changed source or pause behavior/,
    )
  }
})

test('a malformed same-source replacement cannot retain an earlier valid acknowledgement', async () => {
  // Arrange
  const { breakpoint, session, request, response, signal } =
    await breakpointHarness()
  breakpoint.onRequest(session, request())
  breakpoint.onResponse(session, response())
  assert.equal(
    (await breakpoint.registered(session, signal)).requestSequence,
    1,
  )
  const malformed = request(2)
  malformed.arguments.breakpoints = 'invalid'
  // Act
  breakpoint.onRequest(session, malformed)
  breakpoint.onResponse(session, response(1))
  // Assert
  await assert.rejects(
    breakpoint.registered(session, signal),
    /Malformed breakpoint registration replacement/,
  )
})

test('an owned breakpoint the learner already removed retires without waiting for another adapter reply', async () => {
  // Arrange: the stop was acknowledged, then the learner clicked the owned gutter breakpoint away during the pause.
  const { breakpoint, session, request, response, signal, editorBreakpoints } =
    await breakpointHarness()
  breakpoint.onRequest(session, request())
  breakpoint.onResponse(session, response())
  await breakpoint.registered(session, signal)
  editorBreakpoints.splice(editorBreakpoints.indexOf(breakpoint.breakpoint), 1)
  breakpoint.onRequest(session, request(2, [{ line: 2, column: 1 }]))
  // Act: finishing the stop must not wait for a setBreakpoints request the editor will never send.
  await breakpoint.retire(session, AbortSignal.timeout(1_000))
  // Assert
  assert.equal(breakpoint.retired, true)
})

test('a learner-removed owned breakpoint still counts as retired only after the adapter releases it', async () => {
  // Arrange: the editor removed the breakpoint, but the adapter still reports it bound.
  const { breakpoint, session, request, response, signal, editorBreakpoints } =
    await breakpointHarness()
  breakpoint.onRequest(session, request())
  breakpoint.onResponse(session, response())
  await breakpoint.registered(session, signal)
  editorBreakpoints.splice(editorBreakpoints.indexOf(breakpoint.breakpoint), 1)
  breakpoint.onRequest(session, request(2, [{ line: 2, column: 1 }]))
  const stillBound: DebugSession = {
    ...session,
    getDebugProtocolBreakpoint: async () => ({ id: 8, verified: true }),
  }
  // Act / Assert
  await assert.rejects(breakpoint.retire(stillBound, AbortSignal.timeout(300)))
  assert.equal(breakpoint.retired, false)
})

test('a learner gutter breakpoint on the owned line does not block retiring the owned breakpoint', async () => {
  // Arrange: the owned stop 20:5 is acknowledged as breakpoint 8; the learner also has a line-only gutter breakpoint on line 20.
  const { breakpoint, session, request, response, signal } =
    await breakpointHarness()
  breakpoint.onRequest(session, request())
  breakpoint.onResponse(session, response())
  await breakpoint.registered(session, signal)

  // Act: after Codebook removes its breakpoint, the editor's replacement keeps only the learner's breakpoints, and the adapter no longer lists id 8.
  const retiring = breakpoint.retire(session, AbortSignal.timeout(1_000))
  breakpoint.onRequest(session, {
    seq: 2,
    type: 'request',
    command: 'setBreakpoints',
    arguments: {
      source: { path: '/repo/actions.ts' },
      breakpoints: [{ line: 2, column: 1 }, { line: 20 }],
    },
  })
  breakpoint.onResponse(session, {
    seq: 102,
    type: 'response',
    command: 'setBreakpoints',
    request_seq: 2,
    success: true,
    body: {
      breakpoints: [
        { id: 7, verified: true, line: 2, column: 1 },
        { id: 9, verified: true, line: 20, column: 5 },
      ],
    },
  })
  await retiring

  // Assert
  assert.equal(breakpoint.retired, true)
})

test('a retirement reply that still lists the owned breakpoint id does not count as retirement', async () => {
  // Arrange
  const { breakpoint, session, request, response, signal } =
    await breakpointHarness()
  breakpoint.onRequest(session, request())
  breakpoint.onResponse(session, response())
  await breakpoint.registered(session, signal)

  // Act: the adapter's reply to the replacement still reports owned breakpoint 8.
  const retiring = breakpoint.retire(session, AbortSignal.timeout(1_000))
  breakpoint.onRequest(session, {
    seq: 2,
    type: 'request',
    command: 'setBreakpoints',
    arguments: {
      source: { path: '/repo/actions.ts' },
      breakpoints: [{ line: 2, column: 1 }, { line: 20 }],
    },
  })
  breakpoint.onResponse(session, {
    seq: 102,
    type: 'response',
    command: 'setBreakpoints',
    request_seq: 2,
    success: true,
    body: {
      breakpoints: [
        { id: 7, verified: true, line: 2, column: 1 },
        { id: 8, verified: true, line: 20, column: 5 },
      ],
    },
  })

  // Assert
  await assert.rejects(
    retiring,
    /did not confirm retirement of the owned breakpoint/,
  )
  assert.equal(breakpoint.retired, false)
})

test('without breakpoint ids in the adapter reply, a breakpoint left on the owned position still blocks retirement', async () => {
  // Arrange
  const { breakpoint, session, request, response, signal } =
    await breakpointHarness()
  breakpoint.onRequest(session, request())
  breakpoint.onResponse(session, response())
  await breakpoint.registered(session, signal)

  // Act: the reply cannot say which breakpoint remains on 20:5.
  const retiring = breakpoint.retire(session, AbortSignal.timeout(1_000))
  breakpoint.onRequest(session, {
    seq: 2,
    type: 'request',
    command: 'setBreakpoints',
    arguments: {
      source: { path: '/repo/actions.ts' },
      breakpoints: [{ line: 2, column: 1 }, { line: 20 }],
    },
  })
  breakpoint.onResponse(session, {
    seq: 102,
    type: 'response',
    command: 'setBreakpoints',
    request_seq: 2,
    success: true,
    body: {
      breakpoints: [
        { verified: true, line: 2, column: 1 },
        { verified: true, line: 20, column: 5 },
      ],
    },
  })

  // Assert
  await assert.rejects(
    retiring,
    /did not confirm retirement of the owned breakpoint/,
  )
  assert.equal(breakpoint.retired, false)
})

for (const verified of [true, false])
  test(`an owner that captures at the declared column refuses a ${verified ? 'verified' : 'pending'} registration at another column of the declared line`, async () => {
    // Arrange: a Node test stop declared at 20:5.
    const { breakpoint, session, request, response, signal } =
      await breakpointHarness('declared-column')
    // Act
    breakpoint.onRequest(session, request())
    breakpoint.onResponse(
      session,
      response(
        1,
        verified
          ? { id: 8, verified: true, line: 20, column: 12 }
          : { id: 8, verified: false, reason: 'pending', line: 20, column: 12 },
      ),
    )
    // Assert
    await assert.rejects(
      breakpoint.registered(session, signal),
      verified
        ? {
            message:
              'Selected adapter did not acknowledge the declared breakpoint registration (declared 20:5, answered 20:12 verified): {"responseSuccess":true,"responseCount":2,"expectedCount":2,"expectedLine":20,"expectedColumn":5,"selectedId":8,"selectedVerified":true,"selectedReason":null,"selectedLine":20,"selectedColumn":12,"selectedSourceMatches":null}',
          }
        : {
            message:
              'Selected adapter did not acknowledge the declared breakpoint registration (declared 20:5, answered 20:12 unverified): {"responseSuccess":true,"responseCount":2,"expectedCount":2,"expectedLine":20,"expectedColumn":5,"selectedId":8,"selectedVerified":false,"selectedReason":"pending","selectedLine":20,"selectedColumn":12,"selectedSourceMatches":null}',
          },
    )
  })

test('an owner that captures at the declared column still accepts a pending registration that names no column yet', async () => {
  // Arrange
  const { breakpoint, session, request, response, signal } =
    await breakpointHarness('declared-column')
  // Act
  breakpoint.onRequest(session, request())
  breakpoint.onResponse(
    session,
    response(1, { id: 8, verified: false, reason: 'pending' }),
  )
  const receipt = await breakpoint.registered(session, signal)
  // Assert
  assert.equal(receipt.status, 'pending')
  assert.equal(receipt.breakpointId, 8)
})

test('an owner that captures at the declared column accepts a registration verified at exactly that position and refuses a verified one that names no column', async () => {
  // Arrange
  const exact = await breakpointHarness('declared-column'),
    withoutColumn = await breakpointHarness('declared-column')
  // Act
  exact.breakpoint.onRequest(exact.session, exact.request())
  exact.breakpoint.onResponse(
    exact.session,
    exact.response(1, { id: 8, verified: true, line: 20, column: 5 }),
  )
  withoutColumn.breakpoint.onRequest(
    withoutColumn.session,
    withoutColumn.request(),
  )
  withoutColumn.breakpoint.onResponse(
    withoutColumn.session,
    withoutColumn.response(1, { id: 8, verified: true, line: 20 }),
  )
  // Assert
  assert.equal(
    (await exact.breakpoint.registered(exact.session, exact.signal)).status,
    'bound',
  )
  await assert.rejects(
    withoutColumn.breakpoint.registered(
      withoutColumn.session,
      withoutColumn.signal,
    ),
    /Selected adapter did not acknowledge the declared breakpoint registration/,
  )
})

// Value: protects=a configured run's server stop in a loaded module going on when the adapter verifies its breakpoint on the line the run's rule accepts, with the place kept for a deadline that must name it; fails_when=the owner refuses every verified reply on another line, or accepts it without keeping where it is; why_new=the owner had no rule and its receipt no place (Cycle 0043, ER4); seam=none
test('a registration the adapter verifies on a later line the owner’s rule accepts is bound and its receipt names where it moved', async () => {
  // Arrange: the owner declared 20:5 and its rule accepts line 21.
  const { breakpoint, session, request, response, signal } =
    await breakpointHarness('declared-line', (line) => line === 21)
  // Act
  breakpoint.onRequest(session, request())
  breakpoint.onResponse(
    session,
    response(1, { id: 8, verified: true, line: 21, column: 7 }),
  )
  const receipt = await breakpoint.registered(session, signal)
  // Assert
  assert.equal(
    JSON.stringify(receipt),
    '{"sessionId":"owned-server","requestSequence":1,"breakpointId":8,"status":"bound","movedTo":{"line":21,"column":7}}',
  )
  assert.equal(
    JSON.stringify(breakpoint.movedTo(session)),
    '{"line":21,"column":7}',
  )
})

// Value: protects=the owner's rule deciding, not the mere presence of one: a line the rule refuses still blocks the input; fails_when=any verified reply on another line is accepted once a rule exists; why_new=the rule is new (Cycle 0043, ER4); seam=none
test('a registration the adapter verifies on a line the owner’s rule refuses blocks continuation and identifies the rejected position', async () => {
  // Arrange: the rule accepts line 21 only and the adapter verifies line 22.
  const { breakpoint, session, request, response, signal } =
    await breakpointHarness('declared-line', (line) => line === 21)
  // Act
  breakpoint.onRequest(session, request())
  breakpoint.onResponse(
    session,
    response(1, { id: 8, verified: true, line: 22, column: 5 }),
  )
  // Assert
  await assert.rejects(breakpoint.registered(session, signal), (error) => {
    assert.match(
      String(error),
      /Selected adapter did not acknowledge the declared breakpoint registration/,
    )
    assert.match(String(error), /"expectedLine":20/)
    assert.match(String(error), /"selectedLine":22/)
    return true
  })
  assert.equal(breakpoint.movedTo(session), undefined)
})

// Value: protects=a Node test stop staying refused on another line, because that caller captures its pause at the declared column; fails_when=a rule passed to a 'declared-column' owner is consulted; why_new=the rule is new and must not reach Node test stops (Cycle 0043, ER4); seam=none
test('an owner that captures at the declared column refuses a verified reply on another line even when a rule would accept it', async () => {
  // Arrange
  const { breakpoint, session, request, response, signal } =
    await breakpointHarness('declared-column', () => true)
  // Act
  breakpoint.onRequest(session, request())
  breakpoint.onResponse(
    session,
    response(1, { id: 8, verified: true, line: 21, column: 5 }),
  )
  // Assert
  await assert.rejects(
    breakpoint.registered(session, signal),
    /did not acknowledge/,
  )
})

// Value: protects=a receipt keeping its shape for every acknowledgement that did not move the breakpoint, and a reply that names no column being accepted without a place nobody could report; fails_when=a same-line or pending acknowledgement gains a movedTo key, or a later line without a column is refused or given an incomplete place; why_new=the receipt's place is new (Cycle 0043, ER4); seam=none
test('a registration on the declared line, a pending one and a later line without a column carry no moved place', async () => {
  const receipts: string[] = []
  for (const selected of [
    { id: 8, verified: true, line: 20, column: 12 },
    { id: 8, verified: false, reason: 'pending' },
    { id: 8, verified: true, line: 21 },
  ] satisfies DebugProtocol.Breakpoint[]) {
    // Arrange
    const { breakpoint, session, request, response, signal } =
      await breakpointHarness('declared-line', (line) => line === 21)
    // Act
    breakpoint.onRequest(session, request())
    breakpoint.onResponse(session, response(1, selected))
    receipts.push(JSON.stringify(await breakpoint.registered(session, signal)))
    // Assert
    assert.equal(breakpoint.movedTo(session), undefined)
  }
  assert.deepEqual(receipts, [
    '{"sessionId":"owned-server","requestSequence":1,"breakpointId":8,"status":"bound"}',
    '{"sessionId":"owned-server","requestSequence":1,"breakpointId":8,"status":"pending"}',
    '{"sessionId":"owned-server","requestSequence":1,"breakpointId":8,"status":"bound"}',
  ])
})

// Value: protects=application input staying blocked while the adapter has not verified the breakpoint and names a line other than the declared one, also when the owner's rule would accept that line once verified; fails_when=the rule is asked for an unverified reply, so a breakpoint nobody verified is taken as registered on the later line; why_new=the unverified replies on another line are tested for an owner without a rule, and every reply to an owner with a rule is verified or names no line; seam=none
test('a pending registration that names a later line the owner’s rule accepts still blocks continuation and identifies the rejected position', async () => {
  // Arrange: the owner declared 20:5, its rule accepts line 21 and the adapter has not verified the breakpoint it reports at 21:7.
  const { breakpoint, session, request, response, signal } =
    await breakpointHarness('declared-line', (line) => line === 21)
  // Act
  breakpoint.onRequest(session, request())
  breakpoint.onResponse(
    session,
    response(1, {
      id: 8,
      verified: false,
      reason: 'pending',
      line: 21,
      column: 7,
    }),
  )
  // Assert
  await assert.rejects(breakpoint.registered(session, signal), {
    message:
      'Selected adapter did not acknowledge the declared breakpoint registration (declared 20:5, answered 21:7 unverified): {"responseSuccess":true,"responseCount":2,"expectedCount":2,"expectedLine":20,"expectedColumn":5,"selectedId":8,"selectedVerified":false,"selectedReason":"pending","selectedLine":21,"selectedColumn":7,"selectedSourceMatches":null}',
  })
  assert.equal(breakpoint.movedTo(session), undefined)
})

// Value: protects=a deadline never naming a bound place the adapter no longer has the breakpoint at, after the editor replaced the file's breakpoints; fails_when=the moved place is kept beside the registration instead of in its current acknowledgement, so it outlives a replacement or a later acknowledgement on the declared line; why_new=the moved place is read only right after the acknowledgement that set it, and the replacement tests read the receipt of an owner without a rule; seam=none
test('a breakpoint replacement after a moved acknowledgement clears the moved place, and a new acknowledgement on the declared line leaves none', async () => {
  // Arrange: the owner declared 20:5, its rule accepts line 21 and the adapter verified the breakpoint at 21:7.
  const { breakpoint, session, request, response, signal } =
    await breakpointHarness('declared-line', (line) => line === 21)
  breakpoint.onRequest(session, request())
  breakpoint.onResponse(
    session,
    response(1, { id: 8, verified: true, line: 21, column: 7 }),
  )
  const placeBeforeReplacement = JSON.stringify(breakpoint.movedTo(session))
  // Act: the editor replaces the file's breakpoints, a delayed copy of the first reply arrives, and the adapter then verifies the owned breakpoint on its declared line.
  breakpoint.onRequest(session, request(2))
  breakpoint.onResponse(
    session,
    response(1, { id: 8, verified: true, line: 21, column: 7 }),
  )
  const placeWhileUnacknowledged = breakpoint.movedTo(session)
  breakpoint.onResponse(
    session,
    response(2, { id: 8, verified: true, line: 20, column: 5 }),
  )
  const receipt = await breakpoint.registered(session, signal)
  // Assert
  assert.equal(placeBeforeReplacement, '{"line":21,"column":7}')
  assert.equal(placeWhileUnacknowledged, undefined)
  assert.equal(
    JSON.stringify(receipt),
    '{"sessionId":"owned-server","requestSequence":2,"breakpointId":8,"status":"bound"}',
  )
  assert.equal(breakpoint.movedTo(session), undefined)
})

// Value: protects=a moved owned breakpoint still listed by a retirement reply without ids keeping retirement unconfirmed; fails_when=the fallback compares only the declared position 20:5 and counts the breakpoint left at its moved place 21:7 as retired; why_new=Cycle 0043 R5; seam=none
test('without breakpoint ids in the adapter reply, a breakpoint left on the place the owned one moved to still blocks retirement', async () => {
  // Arrange: the owner declared 20:5, its rule accepts line 21 and the adapter verified the breakpoint at 21:7.
  const { breakpoint, session, request, response, signal } =
    await breakpointHarness('declared-line', (line) => line === 21)
  breakpoint.onRequest(session, request())
  breakpoint.onResponse(
    session,
    response(1, { id: 8, verified: true, line: 21, column: 7 }),
  )
  await breakpoint.registered(session, signal)
  // Act: the reply cannot say which breakpoint remains on 21:7.
  const retiring = breakpoint.retire(session, AbortSignal.timeout(1_000))
  breakpoint.onRequest(session, request(2, [{ line: 2, column: 1 }]))
  breakpoint.onResponse(session, {
    seq: 102,
    type: 'response',
    command: 'setBreakpoints',
    request_seq: 2,
    success: true,
    body: {
      breakpoints: [
        { verified: true, line: 2, column: 1 },
        { verified: true, line: 21, column: 7 },
      ],
    },
  })
  // Assert
  await assert.rejects(
    retiring,
    /did not confirm retirement of the owned breakpoint/,
  )
  assert.equal(breakpoint.retired, false)
})

// Value: protects=a deadline never naming a moved place of a registration that later failed; fails_when=movedTo reads the receipt's place without the registration's failure; why_new=Cycle 0043 R14 (removing the failure check left every test green); seam=none
test('a moved acknowledgement followed by a failed duplicate reply for the same registration leaves no moved or verified place', async () => {
  // Arrange: the adapter verified the owned breakpoint at 21:7, which the owner's rule accepts.
  const { breakpoint, session, request, response } = await breakpointHarness(
    'declared-line',
    (line) => line === 21,
  )
  breakpoint.onRequest(session, request())
  breakpoint.onResponse(
    session,
    response(1, { id: 8, verified: true, line: 21, column: 7 }),
  )
  const placeBeforeFailure = JSON.stringify(breakpoint.movedTo(session))
  // Act: a duplicate reply to the same request is unsuccessful.
  breakpoint.onResponse(session, { ...response(1), success: false })
  // Assert
  assert.equal(placeBeforeFailure, '{"line":21,"column":7}')
  assert.equal(breakpoint.movedTo(session), undefined)
  assert.equal(breakpoint.verifiedPlace(session), undefined)
})

// Value: protects=a pending server stop learning where the adapter bound it when its module loads, so its deadline can name that place and a pause is compared with it; fails_when=the adapter's DAP breakpoint event is ignored and the place stays unknown; why_new=Cycle 0043 R8/O1 (only a setBreakpoints reply gave a place); seam=none
test('a pending registration that the adapter later reports verified on a later line the owner’s rule accepts gains that moved place, and one on a refused line does not', async () => {
  // Arrange: the owner declared 20:5 and its rule accepts line 21; the registration is pending.
  const { breakpoint, session, request, response, signal } =
    await breakpointHarness('declared-line', (line) => line === 21)
  breakpoint.onRequest(session, request())
  breakpoint.onResponse(session, response())
  // Act
  breakpoint.onEvent(session, {
    seq: 200,
    type: 'event',
    event: 'breakpoint',
    body: {
      reason: 'changed',
      breakpoint: { id: 8, verified: true, line: 30, column: 1 },
    },
  })
  const placeAfterRefusedLine = breakpoint.movedTo(session)
  breakpoint.onEvent(session, {
    seq: 201,
    type: 'event',
    event: 'breakpoint',
    body: {
      reason: 'changed',
      breakpoint: { id: 8, verified: true, line: 21, column: 7 },
    },
  })
  const receipt = await breakpoint.registered(session, signal)
  // Assert
  assert.equal(placeAfterRefusedLine, undefined)
  assert.equal(
    JSON.stringify(breakpoint.movedTo(session)),
    '{"line":21,"column":7}',
  )
  assert.equal(
    JSON.stringify(receipt),
    '{"sessionId":"owned-server","requestSequence":1,"breakpointId":8,"status":"bound","movedTo":{"line":21,"column":7}}',
  )
})
