import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { test } from 'node:test'

import type { DebugProtocol } from '@vscode/debugprotocol'
import type { DebugSession } from 'vscode'

import type * as OwnedRepositoryBreakpointModule from '../ownedRepositoryBreakpoint'

import { loadModule } from './utils/loadModule'
import { sourceBreakpointRequest } from './utils/sourceBreakpointRequest'

/** Supplies native API identities and explicit adapter messages without starting an editor or application; `acceptsOtherLine` is the owner's rule for a verified reply on another line. The default request is what an editor sends: a breakpoint at character 0 carries no column. @example const harness = await breakpointHarness(); const configuredStop = await breakpointHarness((line) => line === 21) */
async function breakpointHarness(
  /** The owner's rule for a verified reply on another line; without it such a reply is refused. */
  acceptsOtherLine?: (line: number) => boolean,
  /** One-based column the owned breakpoint is requested at on line 20. */
  requestedColumn = 5,
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
    requestedColumn,
    acceptsOtherLine,
  )
  const request = (
    sequence = 1,
    positions: { line: number; column?: number }[] = [
      { line: 2 },
      sourceBreakpointRequest({ line: 19, character: requestedColumn - 1 }),
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
    OwnedBreakpointRemovedError: module.OwnedBreakpointRemovedError,
    OwnedBreakpointMovedError: module.OwnedBreakpointMovedError,
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

// Cycle 0045 (RT-12, NF-28): red while a request position without a column never matched a stop at column 1 ("Selected breakpoint registration is absent or ambiguous").
test('a server stop requested at column 1 registers when the editor sends its breakpoint without a column', async () => {
  // Arrange: the owned breakpoint is requested at 20:1, which the editor sends as line 20 with no column.
  const { breakpoint, session, request, response, signal } =
    await breakpointHarness(undefined, 1)
  // Act
  breakpoint.onRequest(session, request(1, [{ line: 2 }, { line: 20 }]))
  breakpoint.onResponse(session, response())
  const receipt = await breakpoint.registered(session, signal)
  // Assert
  assert.equal(
    JSON.stringify(receipt),
    '{"sessionId":"owned-server","requestSequence":1,"breakpointId":8,"status":"pending"}',
  )
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
      /Selected adapter did not acknowledge the breakpoint registration/,
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
  breakpoint.onRequest(session, request(2, [{ line: 2 }]))
  await assert.rejects(breakpoint.registered(session, signal), /absent/)
  breakpoint.onRequest(session, request(3))
  breakpoint.onResponse(session, response(3))
  breakpoint.remove()
  await assert.rejects(breakpoint.registered(session, signal), /removed/)
})

// Cycle 0045 (SM-4): red while the removal was a plain error that the run told from an adapter's refusal by comparing its text.
test('a registration read after the owned breakpoint was removed fails with the removed-breakpoint error, which the run tells from an adapter refusal by its type', async () => {
  // Arrange: one owner whose acknowledged breakpoint is removed from the editor, and one whose registration the adapter verified on another line.
  const removed = await breakpointHarness()
  removed.breakpoint.onRequest(removed.session, removed.request())
  removed.breakpoint.onResponse(removed.session, removed.response())
  removed.breakpoint.remove()
  const refused = await breakpointHarness()
  refused.breakpoint.onRequest(refused.session, refused.request())
  refused.breakpoint.onResponse(
    refused.session,
    refused.response(1, { id: 8, verified: true, line: 21, column: 5 }),
  )
  // Act
  let removal: unknown, refusal: unknown
  try {
    removed.breakpoint.registration(removed.session)
  } catch (error) {
    removal = error
  }
  try {
    refused.breakpoint.registration(refused.session)
  } catch (error) {
    refusal = error
  }
  // Assert
  assert.equal(removal instanceof removed.OwnedBreakpointRemovedError, true)
  assert.equal(
    String(removal),
    'Error: Owned breakpoint was removed before registration',
  )
  assert.match(
    String(refusal),
    /^Error: Selected adapter did not acknowledge the breakpoint registration \(requested 20:5, answered 21:5 verified\): /,
  )
  assert.equal(refusal instanceof refused.OwnedBreakpointRemovedError, false)
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
  breakpoint.onRequest(session, request(2, [{ line: 2 }]))
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
  breakpoint.onRequest(session, request(2, [{ line: 2 }]))
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
      breakpoints: [{ line: 2 }, { line: 20 }],
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
      breakpoints: [{ line: 2 }, { line: 20 }],
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

// Cycle 0045 (A-L2): the request half of the retirement check had no test; it compares the requested position only, because an owner the adapter never acknowledged was verified nowhere.
test('retiring an owned breakpoint the adapter never acknowledged fails at once when the replacement request still names the declared position', async () => {
  // Arrange: the adapter never answered the registration, so the owned breakpoint has no adapter id.
  const { breakpoint, session, request, signal } = await breakpointHarness()
  breakpoint.onRequest(session, request())

  // Act: the editor's replacement after the removal still holds a breakpoint on 20:5 (a learner's), and the adapter's reply lists it.
  const retiring = breakpoint.retire(session, signal)
  breakpoint.onRequest(session, request(2, [{ line: 20, column: 5 }]))
  breakpoint.onResponse(session, {
    seq: 102,
    type: 'response',
    command: 'setBreakpoints',
    request_seq: 2,
    success: true,
    body: { breakpoints: [{ verified: true, line: 20, column: 5 }] },
  })

  // Assert: the request decided it, before the adapter's reply was read.
  await assert.rejects(retiring, {
    message:
      'A breakpoint still targets the selected position; owned removal cannot retire learner breakpoints.',
  })
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
      breakpoints: [{ line: 2 }, { line: 20 }],
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

// Value: protects=a configured run's server stop in a loaded module going on when the adapter verifies its breakpoint on the line the run's rule accepts, with the place kept for a deadline that must name it; fails_when=the owner refuses every verified reply on another line, or accepts it without keeping where it is; why_new=the owner had no rule and its receipt no place (Cycle 0043, ER4); seam=none
test('a registration the adapter verifies on a later line the owner’s rule accepts is bound and its receipt names where it moved', async () => {
  // Arrange: the owner declared 20:5 and its rule accepts line 21.
  const { breakpoint, session, request, response, signal } =
    await breakpointHarness((line) => line === 21)
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
    await breakpointHarness((line) => line === 21)
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
      /Selected adapter did not acknowledge the breakpoint registration/,
    )
    assert.match(String(error), /"expectedLine":20/)
    assert.match(String(error), /"selectedLine":22/)
    return true
  })
  assert.equal(breakpoint.movedTo(session), undefined)
})

// Value: protects=a run requesting a stop again only from a place the adapter really verified its own breakpoint at; fails_when=a reply refused for another reason (another source, a failed reason, an id two breakpoints share) still hands its line to the owner, so the run retires the breakpoint and requests it again on line numbers that are not its own; why_new=Cycle 0045 local review (runtime-1 #3: the refused place is read by the run to make a second request); seam=none
test('a refused registration names its place only when the adapter verified the owned breakpoint there, not for a reply refused for another reason', async () => {
  // Arrange: four owners whose rule accepts line 21 only; each adapter reply verifies the owned breakpoint on line 22.
  const refusedForItsPlace = await breakpointHarness((line) => line === 21),
    inAnotherSource = await breakpointHarness((line) => line === 21),
    failedByTheAdapter = await breakpointHarness((line) => line === 21),
    sharingAnId = await breakpointHarness((line) => line === 21)
  // Act
  refusedForItsPlace.breakpoint.onRequest(
    refusedForItsPlace.session,
    refusedForItsPlace.request(),
  )
  refusedForItsPlace.breakpoint.onResponse(
    refusedForItsPlace.session,
    refusedForItsPlace.response(1, {
      id: 8,
      verified: true,
      line: 22,
      column: 5,
    }),
  )
  inAnotherSource.breakpoint.onRequest(
    inAnotherSource.session,
    inAnotherSource.request(),
  )
  inAnotherSource.breakpoint.onResponse(
    inAnotherSource.session,
    inAnotherSource.response(1, {
      id: 8,
      verified: true,
      line: 22,
      column: 5,
      source: { path: '/repo/other.ts' },
    }),
  )
  failedByTheAdapter.breakpoint.onRequest(
    failedByTheAdapter.session,
    failedByTheAdapter.request(),
  )
  failedByTheAdapter.breakpoint.onResponse(
    failedByTheAdapter.session,
    failedByTheAdapter.response(1, {
      id: 8,
      verified: true,
      line: 22,
      column: 5,
      reason: 'failed',
    }),
  )
  sharingAnId.breakpoint.onRequest(sharingAnId.session, sharingAnId.request())
  sharingAnId.breakpoint.onResponse(
    sharingAnId.session,
    sharingAnId.response(1, { id: 7, verified: true, line: 22, column: 5 }),
  )
  // Assert: every registration is refused; only the first one names a place.
  for (const refused of [
    refusedForItsPlace,
    inAnotherSource,
    failedByTheAdapter,
    sharingAnId,
  ])
    await assert.rejects(
      refused.breakpoint.registered(refused.session, refused.signal),
      /Selected adapter did not acknowledge the breakpoint registration/,
    )
  assert.equal(
    JSON.stringify(
      refusedForItsPlace.breakpoint.refusedPlace(refusedForItsPlace.session),
    ),
    '{"line":22,"column":5}',
  )
  assert.equal(
    inAnotherSource.breakpoint.refusedPlace(inAnotherSource.session),
    undefined,
  )
  assert.equal(
    failedByTheAdapter.breakpoint.refusedPlace(failedByTheAdapter.session),
    undefined,
  )
  assert.equal(
    sharingAnId.breakpoint.refusedPlace(sharingAnId.session),
    undefined,
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
      await breakpointHarness((line) => line === 21)
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
    await breakpointHarness((line) => line === 21)
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
      'Selected adapter did not acknowledge the breakpoint registration (requested 20:5, answered 21:7 unverified): {"responseSuccess":true,"responseCount":2,"expectedCount":2,"expectedLine":20,"expectedColumn":5,"selectedId":8,"selectedVerified":false,"selectedReason":"pending","selectedLine":21,"selectedColumn":7,"selectedSourceMatches":null}',
  })
  assert.equal(breakpoint.movedTo(session), undefined)
})

// Value: protects=a deadline never naming a bound place the adapter no longer has the breakpoint at, after the editor replaced the file's breakpoints; fails_when=the moved place is kept beside the registration instead of in its current acknowledgement, so it outlives a replacement or a later acknowledgement on the declared line; why_new=the moved place is read only right after the acknowledgement that set it, and the replacement tests read the receipt of an owner without a rule; seam=none
test('a breakpoint replacement after a moved acknowledgement clears the moved place, and a new acknowledgement on the declared line leaves none', async () => {
  // Arrange: the owner declared 20:5, its rule accepts line 21 and the adapter verified the breakpoint at 21:7.
  const { breakpoint, session, request, response, signal } =
    await breakpointHarness((line) => line === 21)
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
    await breakpointHarness((line) => line === 21)
  breakpoint.onRequest(session, request())
  breakpoint.onResponse(
    session,
    response(1, { id: 8, verified: true, line: 21, column: 7 }),
  )
  await breakpoint.registered(session, signal)
  // Act: the reply cannot say which breakpoint remains on 21:7.
  const retiring = breakpoint.retire(session, AbortSignal.timeout(1_000))
  breakpoint.onRequest(session, request(2, [{ line: 2 }]))
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
    await breakpointHarness((line) => line === 21)
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

// Cycle 0045 (X7-A.1): red while an event that named a refused place was ignored, so the earlier receipt still authorized the input for a stop that could not be captured.
test('a registration the adapter later reports verified on a line the owner’s rule refuses no longer authorizes input, and does again once the adapter reports an accepted place', async () => {
  // Arrange: the owner requested 20:5 and its rule accepts line 21; the registration is acknowledged as pending.
  const { breakpoint, session, request, response, OwnedBreakpointMovedError } =
    await breakpointHarness((line) => line === 21)
  breakpoint.onRequest(session, request())
  breakpoint.onResponse(session, response())
  // Act: the adapter reports the breakpoint verified at 30:1, and afterwards at 21:7.
  breakpoint.onEvent(session, {
    seq: 200,
    type: 'event',
    event: 'breakpoint',
    body: {
      reason: 'changed',
      breakpoint: { id: 8, verified: true, line: 30, column: 1 },
    },
  })
  let refusal: unknown
  try {
    breakpoint.registration(session)
  } catch (error) {
    refusal = error
  }
  const verifiedWhileRefused = breakpoint.verifiedPlace(session)
  breakpoint.onEvent(session, {
    seq: 201,
    type: 'event',
    event: 'breakpoint',
    body: {
      reason: 'changed',
      breakpoint: { id: 8, verified: true, line: 21, column: 7 },
    },
  })
  const receipt = breakpoint.registration(session)
  // Assert
  assert.equal(
    String(refusal),
    'Error: Selected adapter moved the acknowledged breakpoint to 30:1 (requested 20:5), a place its owner does not accept',
  )
  assert.equal(
    refusal instanceof OwnedBreakpointMovedError
      ? JSON.stringify(refusal.place)
      : 'another error',
    '{"line":30,"column":1}',
  )
  assert.equal(verifiedWhileRefused, undefined)
  assert.equal(
    JSON.stringify(receipt),
    '{"sessionId":"owned-server","requestSequence":1,"breakpointId":8,"status":"bound","movedTo":{"line":21,"column":7}}',
  )
})

// Cycle 0046 (row 76): the adapter's own report keeps the column the editor drops from the binding of a breakpoint requested at column 1; red while only an accepted place could be read, so a refused place had no column to word its refusal with.
test('the place the adapter last reported for the owned breakpoint is read with its column while pending, accepted and refused', async () => {
  // Arrange: the owner requested 20:5 and its rule accepts line 21; the registration is acknowledged as pending.
  const { breakpoint, session, request, response } = await breakpointHarness(
    (line) => line === 21,
  )
  breakpoint.onRequest(session, request())
  breakpoint.onResponse(session, response())
  const news = (line: number, column: number) => ({
    seq: 200 + line,
    type: 'event' as const,
    event: 'breakpoint',
    body: {
      reason: 'changed',
      breakpoint: { id: 8, verified: true, line, column },
    },
  })
  // Act: the adapter reports the breakpoint verified at 21:7, which the owner accepts, and then at 30:3, which it refuses.
  const whilePending = breakpoint.reportedPlace(session)
  breakpoint.onEvent(session, news(21, 7))
  const whenAccepted = breakpoint.reportedPlace(session)
  breakpoint.onEvent(session, news(30, 3))
  const whenRefused = breakpoint.reportedPlace(session)
  // Assert
  assert.equal(
    JSON.stringify([whilePending ?? null, whenAccepted, whenRefused]),
    '[null,{"line":21,"column":7},{"line":30,"column":3}]',
  )
})

// Cycle 0046 (row 130): what a binding without any column means: another line is another place, the requested line names no other column.
test('the read of a pending breakpoint requested at column 1 refuses a binding without any column on another line, naming that line, and none on its requested line', async () => {
  // Arrange: the owner requested 20:1; the registration is pending and the adapter reported no place with a column.
  const { breakpoint, session, request, response, signal } =
    await breakpointHarness(undefined, 1)
  breakpoint.onRequest(session, request())
  breakpoint.onResponse(session, response())
  const readWhenAnswered = async (line: number): Promise<string> => {
    session.getDebugProtocolBreakpoint = async () => ({
      id: 8,
      verified: true,
      line,
    })
    return breakpoint.assertBoundAsDeclared(session, signal).then(
      () => 'bound as declared',
      (error: unknown) => String(error),
    )
  }
  // Act
  const answers = [await readWhenAnswered(22), await readWhenAnswered(20)]
  // Assert
  assert.deepEqual(answers, [
    'Error: Declared breakpoint 20:1 is bound on line 22; this stop is captured at its declared position, so declare a statement of line 22 or another statement.',
    'bound as declared',
  ])
})
