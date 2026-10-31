import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { DebugProtocol } from '@vscode/debugprotocol'

import { REPLAY_DEBUG_MAX_VARIABLES } from '../constants'
import { ReplayDebugAdapter } from '../replayDebugAdapter'
import {
  replayDebugSnapshotSchema,
  type ReplayDebugSnapshot,
} from '../replayDebugSchemas'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { captureReplayDebugSnapshot } from '../utils/captureReplayDebugSnapshot'
import { shouldCaptureReplayScope } from '../utils/shouldCaptureReplayScope'

const source = {
  name: 'app/lib/actions.ts',
  text: 'const amountInCents = amount * 100;',
  hash: sha256('const amountInCents = amount * 100;'),
  line: 1,
}
const stack: DebugProtocol.StackTraceResponse['body'] = {
  stackFrames: [{ id: 77, name: 'createInvoice', line: 1, column: 1 }],
  totalFrames: 1,
}
/** Builds isolated historical data for protocol behavior tests, never an executable target. @example recorded().frames[0]?.name */
function recorded(): ReplayDebugSnapshot {
  return {
    version: 1,
    frames: [
      {
        name: 'createInvoice',
        line: 1,
        column: 1,
        source: { ...source },
        scopes: [{ name: 'Locals', variables: [0] }],
      },
    ],
    variables: [{ name: 'amount', value: '120', type: 'number', children: [] }],
    limitations: [],
  }
}
/** Drives protocol messages without VS Code or any live debug connection; `inspected` observes loaded-values reports. @example harness().request('threads').success */
function harness(inspected: () => void = () => {}) {
  const messages: (DebugProtocol.Response | DebugProtocol.Event)[] = []
  const adapter = new ReplayDebugAdapter(
    (message) => messages.push(message),
    () => {},
    inspected,
  )
  let sequence = 0
  return {
    adapter,
    messages,
    request(command: string, arguments_?: unknown): DebugProtocol.Response {
      const requestSequence = ++sequence
      adapter.handleMessage({
        seq: requestSequence,
        type: 'request',
        command,
        arguments: arguments_,
      })
      const response = messages.find(
        (message) =>
          'request_seq' in message && message.request_seq === requestSequence,
      )
      assert.ok(response && 'request_seq' in response)
      return response
    },
  }
}

test('native replay inspection becomes ready only after current top-frame values are retrieved from the first page', () => {
  // Arrange
  const { adapter, request } = harness(),
    snapshot = recorded()
  snapshot.frames[0]!.scopes[0]!.variables.push(1)
  snapshot.variables.push(
    { name: 'invoice', value: 'Object', children: [2] },
    { name: 'quantity', value: '2', children: [] },
    { name: 'callerValue', value: '9', children: [] },
  )
  snapshot.frames.push({
    name: 'handleSubmit',
    line: 2,
    column: 1,
    scopes: [{ name: 'Caller', variables: [3] }],
  })
  adapter.select(snapshot, 'Recorded')
  request('configurationDone')
  assert.equal(adapter.inspectionReady, false)

  // Act
  const caller = request('stackTrace', { threadId: 1, startFrame: 1 }).body
    .stackFrames[0]
  const callerScope = request('scopes', { frameId: caller.id }).body.scopes[0]
  request('variables', { variablesReference: callerScope.variablesReference })
  assert.equal(adapter.inspectionReady, false)
  const frame = request('stackTrace', { threadId: 1 }).body.stackFrames[0]
  const scope = request('scopes', { frameId: frame.id }).body.scopes[0]
  assert.equal(adapter.inspectionReady, false)
  const laterPage = request('variables', {
    variablesReference: scope.variablesReference,
    start: 1,
  }).body.variables
  request('variables', { variablesReference: laterPage[0].variablesReference })
  assert.equal(adapter.inspectionReady, false)
  assert.equal(
    request('variables', { variablesReference: 999_999 }).success,
    false,
  )
  request('variables', {
    variablesReference: scope.variablesReference,
    start: 0,
  })

  // Assert
  assert.equal(adapter.inspectionReady, true)
})

test('a new recorded moment cannot reuse native inspection receipts or retired variable handles', () => {
  // Arrange
  const { adapter, request } = harness()
  adapter.select(recorded(), 'First stop')
  request('configurationDone')
  const frame = request('stackTrace', { threadId: 1 }).body.stackFrames[0]
  const scope = request('scopes', { frameId: frame.id }).body.scopes[0]
  request('variables', { variablesReference: scope.variablesReference })
  assert.equal(adapter.inspectionReady, true)

  // Act
  adapter.select(recorded(), 'Second stop')
  request('scopes', { frameId: frame.id })
  request('variables', { variablesReference: scope.variablesReference })
  request('stackTrace', { threadId: 1 })

  // Assert
  assert.equal(adapter.inspectionReady, false)
})

test('empty scopes of a retired frame cannot confirm native inspection of the next recorded moment', () => {
  // Arrange
  const { adapter, request } = harness()
  adapter.select(recorded(), 'First stop')
  request('configurationDone')
  const retiredFrame = request('stackTrace', { threadId: 1 }).body
    .stackFrames[0]
  const withoutScopes = recorded()
  withoutScopes.frames[0]!.scopes = []
  adapter.select(withoutScopes, 'Second stop')
  const currentFrame = request('stackTrace', { threadId: 2 }).body
    .stackFrames[0]

  // Act
  const retiredScopes = request('scopes', { frameId: retiredFrame.id }).body
    .scopes
  const readyAfterRetiredScopes = adapter.inspectionReady
  request('scopes', { frameId: currentFrame.id })

  // Assert
  assert.deepEqual(retiredScopes, [])
  assert.equal(readyAfterRetiredScopes, false)
  assert.equal(adapter.inspectionReady, true)
})

// Value: protects=the reader's Run and Debug hint clearing once native Variables loads a moment's values; fails_when=the adapter never reports loaded values, reports them repeatedly, or treats an empty gap stack as loaded values; why_new=ReplayDebugger needs this signal to drop the hint without a new seek; seam=none
test('native Variables loading a recorded moment reports it once, while an empty gap stack reports nothing', () => {
  // Arrange
  let reports = 0
  const { adapter, request } = harness(() => {
    reports++
  })
  adapter.select(undefined, 'Not recorded at this moment')
  request('configurationDone')
  request('stackTrace', { threadId: 1 })
  const afterGap = reports
  adapter.select(recorded(), 'Recorded stop')

  // Act
  const frame = request('stackTrace', { threadId: 2 }).body.stackFrames[0]
  const scope = request('scopes', { frameId: frame.id }).body.scopes[0]
  request('variables', { variablesReference: scope.variablesReference })
  request('variables', { variablesReference: scope.variablesReference })
  request('stackTrace', { threadId: 2 })

  // Assert
  assert.equal(afterGap, 0)
  assert.equal(reports, 1)
})

// Value: protects=a stop without captured scopes never clears the reader's Run and Debug hint; fails_when=the adapter reports loaded values for a frame that has no Variables page; why_new=the scope-less readiness test checks inspectionReady only; seam=none
test('a recorded frame without captured scopes never tells the reader that values loaded', () => {
  // Arrange
  let reports = 0
  const { adapter, request } = harness(() => {
    reports++
  })
  adapter.select(
    {
      version: 1,
      frames: [{ name: 'createInvoice', line: 1, column: 1, scopes: [] }],
      variables: [],
      limitations: [],
    },
    'Recorded',
  )
  request('configurationDone')

  // Act
  const frame = request('stackTrace', { threadId: 1 }).body.stackFrames[0]
  request('scopes', { frameId: frame.id })

  // Assert
  assert.equal(adapter.inspectionReady, true)
  assert.equal(reports, 0)
})

test('a missing-history interval needs its empty current stack rather than a variable request', () => {
  // Arrange
  const { adapter, request } = harness()
  adapter.select(undefined, 'Not recorded at this moment')
  request('configurationDone')
  assert.equal(adapter.inspectionReady, false)

  // Act
  const result = request('stackTrace', { threadId: 1 })

  // Assert
  assert.deepEqual(result.body.stackFrames, [])
  assert.equal(adapter.inspectionReady, true)
})

test('a recorded frame with no captured scopes becomes inspectable without inventing variables', () => {
  // Arrange
  const { adapter, request } = harness()
  adapter.select(
    {
      version: 1,
      frames: [{ name: 'createInvoice', line: 1, column: 1, scopes: [] }],
      variables: [],
      limitations: [],
    },
    'Recorded',
  )
  request('configurationDone')
  const frame = request('stackTrace', { threadId: 1 }).body.stackFrames[0]
  assert.equal(adapter.inspectionReady, false)

  // Act
  const result = request('scopes', { frameId: frame.id })

  // Assert
  assert.deepEqual(result.body.scopes, [])
  assert.equal(adapter.inspectionReady, true)
})

test('tampered history and disposed sessions cannot keep a confirmed native inspection', () => {
  // Arrange
  const { adapter, request } = harness()
  adapter.select(recorded(), 'Recorded')
  request('configurationDone')
  const frame = request('stackTrace', { threadId: 1 }).body.stackFrames[0]
  const scope = request('scopes', { frameId: frame.id }).body.scopes[0]
  request('variables', { variablesReference: scope.variablesReference })
  assert.equal(adapter.inspectionReady, true)
  const tampered = recorded()
  tampered.frames[0]!.source!.text = 'tampered'

  // Act
  assert.throws(() => adapter.select(tampered, 'Tampered'), /hash mismatch/)
  // Value: protects=a rejected moment never reads as inspected missing history; fails_when=readiness ignores selection validity; why_new=the empty-stack retrieval after rejection was never issued; seam=none
  const clearedStack = request('stackTrace', {
    threadId: request('threads').body.threads[0].id,
  })
  assert.deepEqual(clearedStack.body.stackFrames, [])
  assert.equal(adapter.inspectionReady, false)
  adapter.dispose()

  // Assert
  assert.equal(adapter.inspectionReady, false)
})

// Value: protects=Run and Debug showing no red "Canceled" when Next or Previous changes the recorded stop; fails_when=a closed adapter leaves a threads, stackTrace, scopes or variables request unanswered, which the editor cancels after 500 ms and shows as "Canceled" in Variables; why_new=Cycle 0045 NF-3 (candidate 13: in four of ten presses `scopes` and `threads` reached the retired session 0 to 1 ms after `disconnect` and were never answered); seam=none
test('a request Run and Debug sends after it told the recorded session to disconnect is answered with no rows, not left for the editor to cancel', () => {
  // Arrange: Run and Debug shows a recorded stop, and a stop change makes the editor disconnect the session.
  const { adapter, messages, request } = harness()
  adapter.select(recorded(), 'Recorded')
  request('configurationDone')
  const threadId = request('threads').body.threads[0].id
  const frame = request('stackTrace', { threadId }).body.stackFrames[0]
  const scope = request('scopes', { frameId: frame.id }).body.scopes[0]
  request('disconnect')

  // Act: the view requests the editor had already queued arrive after the disconnect.
  const lateRequests = [
    { seq: 101, command: 'threads' },
    { seq: 102, command: 'stackTrace', arguments: { threadId } },
    { seq: 103, command: 'scopes', arguments: { frameId: frame.id } },
    {
      seq: 104,
      command: 'variables',
      arguments: { variablesReference: scope.variablesReference },
    },
  ]
  for (const lateRequest of lateRequests)
    adapter.handleMessage({ type: 'request', ...lateRequest })

  // Assert
  assert.deepEqual(
    messages.flatMap((message) =>
      'request_seq' in message && message.request_seq > 100
        ? [
            {
              request_seq: message.request_seq,
              command: message.command,
              success: message.success,
              body: message.body,
            },
          ]
        : [],
    ),
    [
      {
        request_seq: 101,
        command: 'threads',
        success: true,
        body: { threads: [] },
      },
      {
        request_seq: 102,
        command: 'stackTrace',
        success: true,
        body: { stackFrames: [], totalFrames: 0 },
      },
      {
        request_seq: 103,
        command: 'scopes',
        success: true,
        body: { scopes: [] },
      },
      {
        request_seq: 104,
        command: 'variables',
        success: true,
        body: { variables: [] },
      },
    ],
  )
})

// Value: protects=a retired historical session staying read-only and silent beyond the four view requests; fails_when=a closed adapter answers an execution request or a second disconnect, or serves source of the stop it no longer shows; why_new=Cycle 0045 NF-3 (the closed adapter now answers four requests, so what it leaves unanswered needs its own check); seam=none
test('a closed recorded session answers nothing but the four view requests', () => {
  // Arrange
  const { adapter, messages, request } = harness()
  adapter.select(recorded(), 'Recorded')
  request('configurationDone')
  request('disconnect')
  const messagesAtClose = messages.length

  // Act
  for (const [index, command] of [
    'source',
    'loadedSources',
    'evaluate',
    'continue',
    'disconnect',
  ].entries())
    adapter.handleMessage({
      seq: 201 + index,
      type: 'request',
      command,
      arguments: { sourceReference: 1 },
    })

  // Assert
  assert.equal(messages.length, messagesAtClose)
})

test('historical stack, source and values remain inspectable without a live debugger', () => {
  // Arrange
  const { adapter, request } = harness()
  adapter.select(recorded(), 'Recorded · 00:42')
  // Act
  const frames = request('stackTrace', { threadId: 1 }).body.stackFrames
  const scopes = request('scopes', { frameId: frames[0].id }).body.scopes
  const variables = request('variables', {
    variablesReference: scopes[0].variablesReference,
  }).body.variables
  // Assert
  assert.equal(frames[0].name, 'createInvoice')
  assert.equal(frames[0].source.path, undefined)
  assert.equal(
    request('source', { sourceReference: frames[0].source.sourceReference })
      .body.content,
    'const amountInCents = amount * 100;',
  )
  assert.deepEqual(variables, [
    { name: 'amount', value: '120', type: 'number', variablesReference: 0 },
  ])
})

test('matching recorded source opens at its immutable native document URI', () => {
  // Arrange
  const { adapter, request } = harness(),
    uri = `codebook-source://workspace/node-history/run/23/${source.hash}/Captured-actions.ts`
  adapter.select(recorded(), 'Recorded Node test stop', {
    uri,
    hash: source.hash,
  })

  // Act
  const frame = request('stackTrace', { threadId: 1 }).body.stackFrames[0]!

  // Assert
  assert.equal(frame.source.path, uri)
  assert.equal(
    frame.source.sourceReference,
    0,
    'matching captured source is resolved by the native workspace URI',
  )
})

test('seeking invalidates prior frame, source and variable handles even when revisiting identical history', () => {
  // Arrange
  const { adapter, request } = harness()
  adapter.select(recorded(), 'First visit')
  const frame = request('stackTrace', { threadId: 1 }).body.stackFrames[0]
  const reference = request('scopes', { frameId: frame.id }).body.scopes[0]
    .variablesReference
  // Act
  adapter.select(recorded(), 'Second visit')
  // Assert
  assert.equal(request('scopes', { frameId: frame.id }).success, false)
  assert.equal(
    request('source', { sourceReference: frame.source.sourceReference })
      .success,
    false,
  )
  assert.equal(
    request('variables', { variablesReference: reference }).success,
    false,
  )
  assert.notEqual(
    request('stackTrace', { threadId: 1 }).body.stackFrames[0].id,
    frame.id,
  )
})

test('missing history clears native stack and labels the selected moment truthfully', () => {
  // Arrange
  const { adapter, request, messages } = harness()
  adapter.select(recorded(), 'Recorded')
  request('configurationDone')
  // Act
  adapter.select(undefined, 'Not recorded at this moment')
  // Assert
  assert.deepEqual(request('stackTrace', { threadId: 2 }).body, {
    stackFrames: [],
    totalFrames: 0,
  })
  assert.deepEqual(request('threads').body, {
    threads: [{ id: 2, name: 'Not recorded at this moment' }],
  })
  assert.ok(
    messages.some(
      (message) =>
        'event' in message &&
        message.event === 'stopped' &&
        message.body.description === 'Not recorded at this moment',
    ),
  )
})

test('historical jumps ask native debugging to keep the keyboard on replay controls through recorded points and gaps', () => {
  // Arrange
  const { adapter, request, messages } = harness()
  adapter.select(recorded(), 'Recorded')
  request('configurationDone')

  // Act
  adapter.select(undefined, 'Not recorded at this moment')
  adapter.select(recorded(), 'Recorded again')

  // Assert: the host may inspect each historical stop without borrowing the learner's keyboard.
  assert.deepEqual(
    messages
      .filter((message) => 'event' in message && message.event === 'stopped')
      .map((message) => message.body),
    [
      {
        reason: 'pause',
        description: 'Recorded',
        threadId: 1,
        allThreadsStopped: true,
        preserveFocusHint: true,
      },
      {
        reason: 'pause',
        description: 'Not recorded at this moment',
        threadId: 2,
        allThreadsStopped: true,
        preserveFocusHint: true,
      },
      {
        reason: 'pause',
        description: 'Recorded again',
        threadId: 3,
        allThreadsStopped: true,
        preserveFocusHint: true,
      },
    ],
  )
  assert.equal(
    request('stackTrace', { threadId: 3 }).body.stackFrames[0].name,
    'createInvoice',
  )
})

test('seeking retires the focused historical thread before a gap can retain native variable rows', () => {
  // Arrange
  const { adapter, request, messages } = harness()
  adapter.select(recorded(), 'Recorded')
  request('configurationDone')
  messages.length = 0
  // Act
  adapter.select(undefined, 'Not recorded at this moment')
  // Assert
  assert.deepEqual(
    messages.map((message) =>
      'event' in message ? { event: message.event, body: message.body } : {},
    ),
    [
      { event: 'invalidated', body: { areas: ['variables'] } },
      { event: 'continued', body: { threadId: 1, allThreadsContinued: false } },
      { event: 'thread', body: { reason: 'started', threadId: 2 } },
      {
        event: 'stopped',
        body: {
          reason: 'pause',
          description: 'Not recorded at this moment',
          threadId: 2,
          allThreadsStopped: true,
          preserveFocusHint: true,
        },
      },
    ],
  )
})

test('leaving a recorded stop empties the still-focused native Variables before a newer moment can pair with old values', () => {
  // Arrange
  const { adapter, request, messages } = harness()
  adapter.select(recorded(), 'Recorded · 21.82 s')
  request('configurationDone')
  const frame = request('stackTrace', { threadId: 1 }).body.stackFrames[0]
  const reference = request('scopes', { frameId: frame.id }).body.scopes[0]
    .variablesReference
  messages.length = 0
  // Act
  adapter.select(recorded(), 'Recorded · 110.15 s')
  const refetchedScopes = request('scopes', { frameId: frame.id })
  // Assert
  assert.deepEqual(
    'event' in messages[0]!
      ? { event: messages[0].event, body: messages[0].body }
      : {},
    { event: 'invalidated', body: { areas: ['variables'] } },
  )
  assert.deepEqual(refetchedScopes.body, { scopes: [] })
  assert.equal(
    request('variables', { variablesReference: reference }).success,
    false,
  )
})

test('leaving a missing-history moment sends no native Variables refresh because no values were shown', () => {
  // Arrange
  const { adapter, request, messages } = harness()
  adapter.select(undefined, 'Not recorded at this moment')
  request('configurationDone')
  messages.length = 0
  // Act
  adapter.select(recorded(), 'Recorded · 55.87 s')
  // Assert
  assert.deepEqual(
    messages.map((message) =>
      'event' in message ? message.event : 'response',
    ),
    ['continued', 'thread', 'stopped'],
  )
})

for (const command of [
  'continue',
  'next',
  'stepIn',
  'stepOut',
  'stepBack',
  'reverseContinue',
  'restart',
  'evaluate',
  'setVariable',
  'setExpression',
]) {
  test(`replay refuses ${command} instead of executing or mutating the original target`, () => {
    // Arrange
    const { adapter, request } = harness()
    adapter.select(recorded(), 'Recorded')
    // Act / Assert
    assert.equal(
      request(command, {
        expression: 'sendRequest()',
        value: '999',
        threadId: 1,
      }).success,
      false,
    )
    assert.equal(
      request('stackTrace', { threadId: 1 }).body.stackFrames[0].name,
      'createInvoice',
    )
  })
}

test('tampered historical source clears previous state and cannot open the current checkout file', () => {
  // Arrange
  const { adapter, request } = harness()
  adapter.select(recorded(), 'Recorded')
  const invalid = recorded()
  invalid.frames[0]!.source!.text = 'changed'
  // Act / Assert
  assert.throws(() => adapter.select(invalid, 'Invalid'), /hash mismatch/)
  assert.deepEqual(request('loadedSources').body.sources, [])
  assert.deepEqual(request('stackTrace', { threadId: 1 }).body.stackFrames, [])
})

test('serialized histories reject cyclic, aliased and dangling variable graphs', () => {
  // Arrange
  const cyclic = recorded()
  cyclic.variables[0]!.children = [0]
  const dangling = recorded()
  dangling.frames[0]!.scopes[0]!.variables = [1]
  const alias = recorded()
  alias.frames[0]!.scopes[0]!.variables = [0, 0]
  // Act / Assert
  assert.equal(replayDebugSnapshotSchema.safeParse(cyclic).success, false)
  assert.equal(replayDebugSnapshotSchema.safeParse(dangling).success, false)
  assert.equal(replayDebugSnapshotSchema.safeParse(alias).success, false)
})

test('live capture serializes nested scope values without retaining DAP handles', async () => {
  // Arrange
  const commands: string[] = []
  // Act
  const actual = await captureReplayDebugSnapshot({
    stack,
    verifiedSource: source,
    assertCurrent() {},
    request(command, arguments_) {
      commands.push(command)
      if (command === 'scopes')
        return Promise.resolve({
          scopes: [{ name: 'Locals', variablesReference: 555 }],
        })
      return Promise.resolve({
        variables:
          arguments_.variablesReference === 555
            ? [{ name: 'invoice', value: 'Object', variablesReference: 888 }]
            : [
                {
                  name: 'amount',
                  value: '120',
                  type: 'number',
                  variablesReference: 0,
                },
              ],
      })
    },
  })
  // Assert
  assert.deepEqual(actual.frames[0]!.scopes, [
    { name: 'Locals', variables: [0] },
  ])
  assert.deepEqual(actual.variables, [
    {
      name: 'invoice',
      value: 'Object',
      type: undefined,
      children: [1],
      unavailable: undefined,
    },
    {
      name: 'amount',
      value: '120',
      type: 'number',
      children: [],
      unavailable: undefined,
    },
  ])
  assert.deepEqual(commands, ['scopes', 'variables', 'variables'])
  assert.equal(JSON.stringify(actual).includes('variablesReference'), false)
})

test('a live browser or server stop never copies global, closure or caller-frame values into saved history', async () => {
  // Arrange
  const requests: string[] = []
  const serverStack: DebugProtocol.StackTraceResponse['body'] = {
    stackFrames: [
      stack.stackFrames[0]!,
      { id: 78, name: 'handleSubmit', line: 2, column: 1 },
    ],
    totalFrames: 2,
  }
  const references = new Map([
    [11, [{ name: 'amount', value: '120', variablesReference: 0 }]],
    [
      12,
      [
        {
          name: 'sql',
          value: 'postgres://USER:PASSWORD@db',
          variablesReference: 0,
        },
      ],
    ],
    [13, [{ name: 'process', value: 'process', variablesReference: 0 }]],
    [14, [{ name: 'cookie', value: 'session=private', variablesReference: 0 }]],
  ])
  // Act
  const actual = await captureReplayDebugSnapshot({
    stack: serverStack,
    verifiedSource: source,
    assertCurrent() {},
    request(command, arguments_) {
      requests.push(
        `${command}:${arguments_.frameId ?? arguments_.variablesReference}`,
      )
      if (command === 'scopes')
        return Promise.resolve({
          scopes:
            arguments_.frameId === 77
              ? [
                  { name: 'Local: createInvoice', variablesReference: 11 },
                  { name: 'Closure', variablesReference: 12 },
                  { name: 'Global', variablesReference: 13 },
                ]
              : [{ name: 'Local: handleSubmit', variablesReference: 14 }],
        })
      return Promise.resolve({
        variables: references.get(arguments_.variablesReference ?? 0) ?? [],
      })
    },
  })
  // Assert
  assert.deepEqual(
    actual.variables.map((variable) => `${variable.name}=${variable.value}`),
    ['amount=120'],
  )
  assert.deepEqual(
    actual.frames[0]?.scopes.map((scope) => [scope.name, scope.unavailable]),
    [
      ['Local: createInvoice', undefined],
      [
        'Closure',
        "This scope was not captured; replay keeps only the stopped frame's local values.",
      ],
      [
        'Global',
        "This scope was not captured; replay keeps only the stopped frame's local values.",
      ],
    ],
  )
  assert.equal(
    actual.frames[1]?.scopes[0]?.unavailable,
    "This scope was not captured; replay keeps only the stopped frame's local values.",
  )
  assert.deepEqual(requests, ['scopes:77', 'variables:11', 'scopes:78'])
})

test('capture rejects a resumed pause rather than saving mixed-generation values', async () => {
  // Arrange
  let resumed = false
  // Act / Assert
  await assert.rejects(
    captureReplayDebugSnapshot({
      stack,
      verifiedSource: source,
      assertCurrent() {
        if (resumed) throw new Error('Pause changed')
      },
      request() {
        resumed = true
        return Promise.resolve({ scopes: [] })
      },
    }),
    /Pause changed/,
  )
})

test('a failed scope read preserves the frame with an explicit capture limitation', async () => {
  // Arrange / Act
  const actual = await captureReplayDebugSnapshot({
    stack,
    verifiedSource: source,
    assertCurrent() {},
    request() {
      return Promise.reject(new Error('Scope unavailable'))
    },
  })
  // Assert
  assert.equal(actual.frames[0]!.name, 'createInvoice')
  assert.equal(actual.frames[0]!.unavailable, 'Scope unavailable')
  assert.deepEqual(actual.frames[0]!.scopes, [])
})

test('recursive live handles terminate with an explicit missing-history leaf', async () => {
  // Arrange / Act
  const actual = await captureReplayDebugSnapshot({
    stack,
    verifiedSource: source,
    assertCurrent() {},
    request(command) {
      return Promise.resolve(
        command === 'scopes'
          ? { scopes: [{ name: 'Local', variablesReference: 555 }] }
          : {
              variables: [
                { name: 'self', value: 'Object', variablesReference: 555 },
              ],
            },
      )
    },
  })
  // Assert
  assert.equal(actual.variables.length, 1)
  assert.equal(
    actual.variables[0]!.unavailable,
    'Cyclic debugger reference was not expanded.',
  )
})

test('oversized live scopes stop at the storage limit and disclose uncaptured values', async () => {
  // Arrange
  const variables = Array.from(
    { length: REPLAY_DEBUG_MAX_VARIABLES + 1 },
    (_, index) => ({
      name: `field${index}`,
      value: '1',
      variablesReference: 0,
    }),
  )
  // Act
  const actual = await captureReplayDebugSnapshot({
    stack,
    verifiedSource: source,
    assertCurrent() {},
    request(command) {
      return Promise.resolve(
        command === 'scopes'
          ? { scopes: [{ name: 'Local', variablesReference: 555 }] }
          : { variables },
      )
    },
  })
  // Assert
  assert.equal(actual.variables.length, 2_000)
  assert.equal(
    actual.frames[0]!.scopes[0]!.unavailable,
    'Historical variable count limit reached.',
  )
})

test('a Node test captures local values quickly and labels skipped global history', async () => {
  // Arrange
  const requests: string[] = []
  const limitedStack: DebugProtocol.StackTraceResponse['body'] = {
    stackFrames: [
      stack.stackFrames[0]!,
      { id: 78, name: 'runner', line: 2, column: 1 },
    ],
    totalFrames: 2,
  }
  // Act
  const actual = await captureReplayDebugSnapshot({
    stack: limitedStack,
    verifiedSource: source,
    assertCurrent() {},
    limits: {
      timeoutMs: 1_500,
      maxFrames: 2,
      maxVariables: 2,
      maxDepth: 1,
      includeScope: (frameIndex, scopeName) =>
        frameIndex === 0 && scopeName === 'Local',
    },
    request(command, arguments_) {
      requests.push(
        `${command}:${arguments_.frameId ?? arguments_.variablesReference}`,
      )
      return Promise.resolve(
        command === 'scopes'
          ? {
              scopes: [
                { name: 'Local', variablesReference: 555 },
                { name: 'Global', variablesReference: 999 },
              ],
            }
          : {
              variables: [
                {
                  name: 'listener',
                  value: '() => undefined',
                  variablesReference: 888,
                },
              ],
            },
      )
    },
  })
  // Assert
  assert.deepEqual(requests, ['scopes:77', 'variables:555', 'scopes:78'])
  assert.equal(actual.variables[0]?.name, 'listener')
  assert.equal(
    actual.variables[0]?.unavailable,
    'Historical variable depth limit reached.',
  )
  assert.equal(
    actual.frames[0]?.scopes[1]?.unavailable,
    "This scope was not captured; replay keeps only the stopped frame's local values.",
  )
  assert.equal(
    actual.frames[1]?.scopes[0]?.unavailable,
    "This scope was not captured; replay keeps only the stopped frame's local values.",
  )
})

test('a Node stop retains block-scoped data beside local values without copying globals or other frames', async () => {
  // Arrange
  const requests: string[] = []
  const nodeStack: DebugProtocol.StackTraceResponse['body'] = {
    stackFrames: [
      stack.stackFrames[0]!,
      { id: 78, name: 'runner', line: 2, column: 1 },
    ],
    totalFrames: 2,
  }
  const references = new Map([
    [11, [{ name: 'data', value: 'Array(1)', variablesReference: 0 }]],
    [12, [{ name: 'id', value: 'invoice-456', variablesReference: 0 }]],
    [13, [{ name: 'secret', value: 'private', variablesReference: 0 }]],
  ])
  // Act
  const actual = await captureReplayDebugSnapshot({
    stack: nodeStack,
    verifiedSource: source,
    assertCurrent() {},
    limits: {
      timeoutMs: 1_500,
      maxFrames: 2,
      maxVariables: 4,
      maxDepth: 1,
      includeScope: shouldCaptureReplayScope,
    },
    request(command, arguments_) {
      requests.push(
        `${command}:${arguments_.frameId ?? arguments_.variablesReference}`,
      )
      if (command === 'scopes')
        return Promise.resolve({
          scopes: [
            { name: 'Block: fetchInvoiceById', variablesReference: 11 },
            { name: 'Local: fetchInvoiceById', variablesReference: 12 },
            { name: 'Global', variablesReference: 13 },
          ],
        })
      return Promise.resolve({
        variables: references.get(arguments_.variablesReference ?? 0) ?? [],
      })
    },
  })
  // Assert
  assert.deepEqual(
    actual.frames[0]?.scopes.map((scope) => scope.name),
    ['Block: fetchInvoiceById', 'Local: fetchInvoiceById', 'Global'],
  )
  assert.deepEqual(
    actual.variables.map((variable) => variable.name),
    ['data', 'id'],
  )
  assert.equal(
    actual.frames[0]?.scopes[2]?.unavailable,
    "This scope was not captured; replay keeps only the stopped frame's local values.",
  )
  assert.equal(
    actual.frames[1]?.scopes[0]?.unavailable,
    "This scope was not captured; replay keeps only the stopped frame's local values.",
  )
  assert.deepEqual(requests, [
    'scopes:77',
    'variables:11',
    'variables:12',
    'scopes:78',
  ])
})

test('a replay stop keeps its local values when the editor shows localized scope names', async () => {
  // Arrange: js-debug translates scope names but keeps the language-neutral "locals" hint.
  const requests: string[] = []
  const references = new Map([
    [12, [{ name: 'amount', value: '120', variablesReference: 0 }]],
    [
      13,
      [
        {
          name: 'DATABASE_URL',
          value: 'postgres://private',
          variablesReference: 0,
        },
      ],
    ],
    [14, [{ name: 'client', value: 'Pool', variablesReference: 0 }]],
  ])
  // Act
  const actual = await captureReplayDebugSnapshot({
    stack,
    verifiedSource: source,
    assertCurrent() {},
    request(command, arguments_) {
      requests.push(
        `${command}:${arguments_.frameId ?? arguments_.variablesReference}`,
      )
      if (command === 'scopes')
        return Promise.resolve({
          scopes: [
            {
              name: 'ローカル: createInvoice',
              presentationHint: 'locals',
              variablesReference: 12,
            },
            {
              name: 'クロージャ',
              presentationHint: 'arguments',
              variablesReference: 14,
            },
            { name: 'グローバル', variablesReference: 13 },
          ],
        })
      return Promise.resolve({
        variables: references.get(arguments_.variablesReference ?? 0) ?? [],
      })
    },
  })
  // Assert
  assert.deepEqual(
    actual.variables.map((variable) => `${variable.name}=${variable.value}`),
    ['amount=120'],
  )
  assert.deepEqual(
    requests.filter((request) => request.startsWith('variables:')),
    ['variables:12'],
  )
})

test('a caller scope filter cannot widen replay capture to globals or caller frames', async () => {
  // Arrange
  const requests: string[] = []
  const callerStack: DebugProtocol.StackTraceResponse['body'] = {
    stackFrames: [
      stack.stackFrames[0]!,
      { id: 78, name: 'runner', line: 2, column: 1 },
    ],
    totalFrames: 2,
  }
  const references = new Map([
    [12, [{ name: 'amount', value: '120', variablesReference: 0 }]],
    [
      13,
      [
        {
          name: 'DATABASE_URL',
          value: 'postgres://private',
          variablesReference: 0,
        },
      ],
    ],
  ])
  // Act
  const actual = await captureReplayDebugSnapshot({
    stack: callerStack,
    verifiedSource: source,
    assertCurrent() {},
    limits: {
      timeoutMs: 1_500,
      maxFrames: 2,
      maxVariables: 4,
      maxDepth: 1,
      includeScope: () => true,
    },
    request(command, arguments_) {
      requests.push(
        `${command}:${arguments_.frameId ?? arguments_.variablesReference}`,
      )
      if (command === 'scopes')
        return Promise.resolve({
          scopes: [
            { name: 'Local', variablesReference: 12 },
            { name: 'Global', variablesReference: 13 },
          ],
        })
      return Promise.resolve({
        variables: references.get(arguments_.variablesReference ?? 0) ?? [],
      })
    },
  })
  // Assert
  assert.deepEqual(
    actual.variables.map((variable) => `${variable.name}=${variable.value}`),
    ['amount=120'],
  )
  assert.deepEqual(requests, ['scopes:77', 'variables:12', 'scopes:78'])
})

test('historical frames reuse the matching owned source document without suppressing native selection', () => {
  // Arrange
  const { adapter, request } = harness()
  // Act
  adapter.select(recorded(), 'Recorded', {
    uri: 'codebook-source:/recorded/actions.ts',
    hash: source.hash,
  })
  // Assert
  assert.deepEqual(
    request('stackTrace', { threadId: 1 }).body.stackFrames[0].source,
    {
      name: 'app/lib/actions.ts',
      path: 'codebook-source:/recorded/actions.ts',
      sourceReference: 0,
    },
  )
})

test('a different source document never substitutes for the recorded source', () => {
  // Arrange
  const { adapter, request } = harness()
  // Act
  adapter.select(recorded(), 'Recorded', {
    uri: 'codebook-source:/other/actions.ts',
    hash: sha256('other'),
  })
  const frame = request('stackTrace', { threadId: 1 }).body.stackFrames[0]
  // Assert
  assert.equal(frame.source.path, undefined)
  assert.equal(
    request('source', { sourceReference: frame.source.sourceReference }).body
      .content,
    'const amountInCents = amount * 100;',
  )
})

test('current checkout source URIs are rejected and clear the previously selected history', () => {
  // Arrange
  const { adapter, request } = harness()
  adapter.select(recorded(), 'Recorded')
  // Act / Assert
  assert.throws(
    () =>
      adapter.select(recorded(), 'Invalid', {
        uri: 'file:///workspace/actions.ts',
        hash: source.hash,
      }),
    /owned read-only/,
  )
  assert.deepEqual(request('stackTrace', { threadId: 1 }).body.stackFrames, [])
})

test('revisiting a recorded moment replaces the missing-history thread label and rejects retired threads', () => {
  // Arrange
  const { adapter, request } = harness()
  adapter.select(recorded(), 'First')
  request('configurationDone')
  adapter.select(undefined, 'Not recorded at this moment')
  // Act
  adapter.select(recorded(), 'Recorded again')
  // Assert
  assert.deepEqual(request('threads').body, {
    threads: [{ id: 3, name: 'Recorded again' }],
  })
  assert.equal(request('stackTrace', { threadId: 1 }).success, false)
  assert.equal(request('stackTrace', { threadId: 2 }).success, false)
  assert.equal(
    request('stackTrace', { threadId: 3 }).body.stackFrames[0].name,
    'createInvoice',
  )
})

test('recorded history cannot cancel the editor cleanup of a missing-history stop', async () => {
  // Arrange: the editor queues continued cleanup and cancels it on thread exit.
  const { adapter, request, messages } = harness()
  request('configurationDone')
  const stopped = new Map<number, string>([[1, 'Not recorded at this moment']])
  const cancelled = new Set<number>()
  const pending: Promise<void>[] = []
  messages.length = 0

  // Act
  adapter.select(recorded(), 'Recorded pause · 15.93 s')
  for (const message of messages) {
    if (!('event' in message)) continue
    const threadId = message.body.threadId
    if (message.event === 'continued')
      pending.push(
        Promise.resolve().then(() => {
          if (!cancelled.has(threadId)) stopped.delete(threadId)
        }),
      )
    if (message.event === 'thread' && message.body.reason === 'exited')
      cancelled.add(threadId)
    if (message.event === 'stopped')
      stopped.set(threadId, message.body.description)
  }
  await Promise.all(pending)

  // Assert: session-level heading and discoverable history describe the same moment.
  assert.deepEqual([...stopped.values()], ['Recorded pause · 15.93 s'])
  assert.deepEqual(request('threads').body, {
    threads: [{ id: 2, name: 'Recorded pause · 15.93 s' }],
  })
  assert.equal(request('stackTrace', { threadId: 1 }).success, false)
  assert.equal(
    request('stackTrace', { threadId: 2 }).body.stackFrames[0].name,
    'createInvoice',
  )
})

test('native debugger paging returns only the requested recorded frames and values', () => {
  // Arrange
  const { adapter, request } = harness()
  const snapshot: ReplayDebugSnapshot = {
    version: 1,
    frames: [
      {
        name: 'createInvoice',
        line: 1,
        column: 1,
        scopes: [{ name: 'Locals', variables: [0, 1, 2] }],
      },
      { name: 'handleSubmit', line: 5, column: 3, scopes: [] },
      { name: 'dispatch', line: 9, column: 2, scopes: [] },
    ],
    variables: [
      { name: 'amount', value: '120', type: 'number', children: [] },
      { name: 'currency', value: '"USD"', type: 'string', children: [] },
      { name: 'status', value: '"pending"', type: 'string', children: [] },
    ],
    limitations: [],
  }
  adapter.select(snapshot, 'Recorded · 00:42')

  // Act
  const page = request('stackTrace', {
    threadId: 1,
    startFrame: 1,
    levels: 1,
  }).body
  const firstFrameId = request('stackTrace', { threadId: 1 }).body
    .stackFrames[0].id
  const reference = request('scopes', { frameId: firstFrameId }).body.scopes[0]
    .variablesReference
  const values = request('variables', {
    variablesReference: reference,
    start: 1,
    count: 1,
  }).body.variables

  // Assert
  assert.equal(page.totalFrames, 3)
  assert.equal(page.stackFrames.length, 1)
  assert.equal(page.stackFrames[0].name, 'handleSubmit')
  assert.deepEqual(values, [
    { name: 'currency', value: '"USD"', type: 'string', variablesReference: 0 },
  ])
})

test('recording limitations appear as a native Variables scope so uncaptured history is disclosed', () => {
  // Arrange
  const { adapter, request } = harness()
  const snapshot = recorded()
  snapshot.frames[0]!.unavailable = 'Scope unavailable'
  snapshot.limitations = ['Historical variable count limit reached.']
  adapter.select(snapshot, 'Recorded · 00:42')

  // Act
  const frameId = request('stackTrace', { threadId: 1 }).body.stackFrames[0].id
  const scopes = request('scopes', { frameId }).body.scopes
  const limitationRows = request('variables', {
    variablesReference: scopes[1].variablesReference,
  }).body.variables

  // Assert
  assert.equal(scopes.length, 2)
  assert.equal(scopes[1].name, 'Recording limitations')
  assert.deepEqual(limitationRows, [
    {
      name: 'Not recorded',
      value: 'Scope unavailable\nHistorical variable count limit reached.',
      variablesReference: 0,
    },
  ])
})

// Value: protects=no false Run and Debug hint when a recorded stop's top frame is library code without source; fails_when=inspection stays tied to frames[0] while native Call Stack focuses the caller with source; why_new=Cycle 0032 H5, only top-frame stops were covered; seam=none
test('a stop whose top frame has no source is inspected when Variables loads the first frame with source', () => {
  // Arrange
  let reports = 0
  const { adapter, request } = harness(() => {
    reports++
  })
  const snapshot = recorded()
  snapshot.variables.push({ name: 'queued', value: '1', children: [] })
  snapshot.frames.unshift({
    name: 'processTicksAndRejections',
    line: 95,
    column: 5,
    scopes: [{ name: 'Internal', variables: [1] }],
  })
  adapter.select(snapshot, 'Recorded')
  request('configurationDone')
  const frames = request('stackTrace', { threadId: 1 }).body.stackFrames
  const withSource = frames.find(
    (frame: DebugProtocol.StackFrame) => frame.source,
  )
  const scope = request('scopes', { frameId: withSource.id }).body.scopes[0]

  // Act
  request('variables', { variablesReference: scope.variablesReference })

  // Assert
  assert.equal(withSource.name, 'createInvoice')
  assert.equal(adapter.inspectionReady, true)
  assert.equal(reports, 1)
})

// Value: protects=no false Run and Debug hint when a stop's first frame with source lies beyond native Call Stack's first page; fails_when=inspection waits for a frame Call Stack never loads while Variables shows the top frame; why_new=Cycle 0044 (0032-F5f / 0033-M1f); seam=none
test('a stop whose first frame with source lies past the first Call Stack page is inspected when Variables loads the top frame', () => {
  // Arrange: 24 library frames sit above the first frame with source (index 24).
  let reports = 0
  const { adapter, request } = harness(() => {
    reports++
  })
  const snapshot = recorded()
  for (let libraryFrame = 0; libraryFrame < 24; libraryFrame++) {
    snapshot.variables.push({ name: 'queued', value: '1', children: [] })
    snapshot.frames.unshift({
      name: `processTicksAndRejections${libraryFrame}`,
      line: 95,
      column: 5,
      scopes: [
        { name: 'Internal', variables: [snapshot.variables.length - 1] },
      ],
    })
  }
  adapter.select(snapshot, 'Recorded')
  request('configurationDone')
  // Native Call Stack loads the top frame, then 19 more: the first page has no frame with source.
  const top = request('stackTrace', { threadId: 1, startFrame: 0, levels: 1 })
    .body.stackFrames[0]
  const rest = request('stackTrace', {
    threadId: 1,
    startFrame: 1,
    levels: 19,
  }).body
  const scope = request('scopes', { frameId: top.id }).body.scopes[0]

  // Act
  request('variables', { variablesReference: scope.variablesReference })

  // Assert
  assert.equal(rest.totalFrames, 25)
  assert.equal(
    rest.stackFrames.some((frame: DebugProtocol.StackFrame) => frame.source),
    false,
  )
  assert.equal(adapter.inspectionReady, true)
  assert.equal(reports, 1)
})

// Value: protects=no false hint for a library-top stop when only its sourceless top frame is expanded; fails_when=top-frame values count although native Variables shows the caller with source; why_new=Cycle 0032 H5 counterpart; seam=none
test('loading only the sourceless top frame of a stop does not count as inspecting it', () => {
  // Arrange
  let reports = 0
  const { adapter, request } = harness(() => {
    reports++
  })
  const snapshot = recorded()
  snapshot.variables.push({ name: 'queued', value: '1', children: [] })
  snapshot.frames.unshift({
    name: 'processTicksAndRejections',
    line: 95,
    column: 5,
    scopes: [{ name: 'Internal', variables: [1] }],
  })
  adapter.select(snapshot, 'Recorded')
  request('configurationDone')
  const top = request('stackTrace', { threadId: 1 }).body.stackFrames[0]
  const scope = request('scopes', { frameId: top.id }).body.scopes[0]

  // Act
  request('variables', { variablesReference: scope.variablesReference })

  // Assert
  assert.equal(top.name, 'processTicksAndRejections')
  assert.equal(adapter.inspectionReady, false)
  assert.equal(reports, 0)
})

// Value: protects=native Variables never receiving two answers for one request; fails_when=a throwing loaded-values listener makes the adapter send a failure response after the success; why_new=Cycle 0032 H7; seam=none
test('a failing loaded-values listener still answers each native request exactly once and reports the failure', () => {
  // Arrange
  const messages: (DebugProtocol.Response | DebugProtocol.Event)[] = [],
    failures: unknown[] = []
  const adapter = new ReplayDebugAdapter(
    (message) => messages.push(message),
    () => {},
    () => {
      throw new Error('reader refresh failed')
    },
    (error) => failures.push(error),
  )
  let sequence = 0
  const request = (command: string, arguments_?: unknown) => {
    const requestSequence = ++sequence
    adapter.handleMessage({
      seq: requestSequence,
      type: 'request',
      command,
      arguments: arguments_,
    })
    return messages.filter(
      (message) =>
        'request_seq' in message && message.request_seq === requestSequence,
    ) as DebugProtocol.Response[]
  }
  adapter.select(recorded(), 'Recorded')
  request('configurationDone')
  const frame = request('stackTrace', { threadId: 1 })[0]!.body.stackFrames[0]
  const scope = request('scopes', { frameId: frame.id })[0]!.body.scopes[0]

  // Act
  const responses = request('variables', {
    variablesReference: scope.variablesReference,
  })

  // Assert
  assert.deepEqual(
    responses.map((response) => response.success),
    [true],
  )
  assert.equal(failures.length, 1)
  assert.equal(String(failures[0]), 'Error: reader refresh failed')
})

// Value: protects=gaps and scope-less stops committing at once; fails_when=a selection with nothing for Variables to load reports loadable values and makes playback wait; why_new=Cycle 0032 H4 adapter contract; seam=none
test('only a recorded stop with scopes has values for native Variables to load', () => {
  // Arrange
  const { adapter, request } = harness()
  request('configurationDone')
  const withoutScopes = recorded()
  withoutScopes.frames[0]!.scopes = []

  // Act
  adapter.select(undefined, 'Not recorded at this moment')
  const gap = adapter.hasLoadableValues
  adapter.select(withoutScopes, 'Recorded without scopes')
  const scopeLess = adapter.hasLoadableValues
  adapter.select(recorded(), 'Recorded')
  const withValues = adapter.hasLoadableValues

  // Assert
  assert.equal(gap, false)
  assert.equal(scopeLess, false)
  assert.equal(withValues, true)
})

// protects=a Bearer token that straddles the 4,096-character cut of a debugger error message is masked before the cut, so no part of it is stored; fails_when=the text is cut first and the token's first characters stay in the captured text before the marker; no_claim=other secret shapes
test('a Bearer token straddling the cut of an unavailable error message is captured masked', async () => {
  // Arrange
  const padding = `${'x'.repeat(4_055)} `
  const message = `${padding}Bearer ${'T'.repeat(40)}`

  // Act
  const actual = await captureReplayDebugSnapshot({
    stack,
    verifiedSource: source,
    assertCurrent() {},
    request() {
      return Promise.reject(new Error(message))
    },
  })

  // Assert
  assert.equal(actual.frames[0]!.unavailable, `${padding}Bearer [masked]`)
})

// protects=a Bearer token that straddles the cut of a variable type is masked before the cut; fails_when=the type is cut first and part of the token is stored; no_claim=variable names and values (masked before the cut already)
test('a Bearer token straddling the cut of a variable type is captured masked', async () => {
  // Arrange
  const padding = `${'x'.repeat(4_055)} `
  const type = `${padding}Bearer ${'T'.repeat(40)}`

  // Act
  const actual = await captureReplayDebugSnapshot({
    stack,
    verifiedSource: source,
    assertCurrent() {},
    request(command) {
      if (command === 'scopes')
        return Promise.resolve({
          scopes: [{ name: 'Locals', variablesReference: 555 }],
        })
      return Promise.resolve({
        variables: [
          { name: 'amount', value: '120', type, variablesReference: 0 },
        ],
      })
    },
  })

  // Assert
  assert.equal(actual.variables[0]!.type, `${padding}Bearer [masked]`)
})

/** Builds a recorded stop with an unsourced top frame and two caller frames, one of which kept only its recorded location, as a node-server stop whose text was too large to store. @example callerLocationSnapshot().frames.length // => 3 */
function callerLocationSnapshot(): ReplayDebugSnapshot {
  const snapshot = recorded()
  snapshot.frames = [
    {
      name: 'createInvoice',
      line: 1,
      column: 1,
      scopes: [{ name: 'Locals', variables: [0] }],
    },
    {
      name: 'handleSubmit',
      line: 42,
      column: 7,
      sourceUnavailable: 'Executed source was not verified for this frame.',
      recordedLocation: { name: 'form.tsx', path: 'src/form.tsx' },
      scopes: [],
    },
    {
      name: 'anonymous',
      line: 3,
      column: 2,
      sourceUnavailable: 'Executed source was not verified for this frame.',
      scopes: [],
    },
  ]
  return snapshot
}

// Value: protects=the replay Call Stack names the file and line of a caller frame instead of "Unknown Source"; fails_when=the capture drops the caller's reported source or the adapter omits it from the stack frame; why_new=Cycle 0063 N63-F6 showed Unknown Source for caller frames; seam=none; no_claim=opening the caller's executed text
test('live capture keeps the reported location of a caller frame so the replay Call Stack names it', async () => {
  // Arrange
  const { adapter, request } = harness()
  const snapshot = await captureReplayDebugSnapshot({
    stack: {
      stackFrames: [
        { id: 77, name: 'createInvoice', line: 1, column: 1 },
        {
          id: 78,
          name: 'handleSubmit',
          line: 42,
          column: 7,
          source: { name: 'form.tsx', path: '/repo/src/form.tsx' },
        },
        { id: 79, name: 'anonymous', line: 3, column: 2 },
      ],
      totalFrames: 3,
    },
    verifiedSource: source,
    workspaceRoot: '/repo',
    assertCurrent() {},
    request(command) {
      return Promise.resolve(
        command === 'scopes' ? { scopes: [] } : { variables: [] },
      )
    },
  })
  adapter.select(snapshot, 'Recorded · 00:42')

  // Act
  const frames = request('stackTrace', { threadId: 1 }).body.stackFrames

  // Assert
  assert.deepEqual(snapshot.frames[1]!.recordedLocation, {
    name: 'form.tsx',
    path: 'src/form.tsx',
  })
  assert.equal(snapshot.frames[2]!.recordedLocation, undefined)
  assert.equal(frames[1].source.name, 'form.tsx')
  assert.equal(frames[1].line, 42)
  assert.equal(frames[2].source, undefined)
})

// Value: protects=selecting a caller frame never shows today's file as the recorded text; fails_when=the stack frame carries a disk path or no placeholder reference; why_new=the first fix answered a bare path that the host opens from the current checkout; seam=none
test('a caller frame opens a not-recorded placeholder, never a disk path', () => {
  // Arrange
  const { adapter, request } = harness()
  adapter.select(callerLocationSnapshot(), 'Recorded')
  const callerSource = request('stackTrace', { threadId: 1 }).body
    .stackFrames[1].source

  // Act
  const content = request('source', {
    sourceReference: callerSource.sourceReference,
  }).body.content

  // Assert
  assert.equal(callerSource.path, undefined)
  assert.equal(callerSource.presentationHint, 'deemphasize')
  assert.equal(callerSource.origin, 'Executed text not recorded')
  assert.equal(
    content,
    'Not recorded at this moment: the executed text of this frame was not captured.\nRecorded location: src/form.tsx:42',
  )
})

// Value: protects=Run and Debug stays inspected when the top frame has no stored text and callers only have placeholders; fails_when=a placeholder frame becomes the inspection frame the host never focuses; why_new=Cycle 0064 D7; seam=none
test('a stop whose top frame has no stored text is inspected through the top frame, not a placeholder caller', () => {
  // Arrange
  let reports = 0
  const { adapter, request } = harness(() => {
    reports++
  })
  adapter.select(callerLocationSnapshot(), 'Recorded')
  request('configurationDone')
  const frames = request('stackTrace', { threadId: 1 }).body.stackFrames
  const scope = request('scopes', { frameId: frames[0].id }).body.scopes[0]

  // Act
  request('variables', { variablesReference: scope.variablesReference })

  // Assert
  assert.equal(adapter.inspectionReady, true)
  assert.equal(reports, 1)
})

// Value: protects=a page of only caller frames does not claim the stop was inspected; fails_when=paging past the top frame marks the stack retrieved; why_new=Cycle 0064 D7 paging; seam=none
test('a Call Stack page holding only placeholder callers does not complete the inspection', () => {
  // Arrange
  const { adapter, request } = harness()
  adapter.select(callerLocationSnapshot(), 'Recorded')
  request('configurationDone')

  // Act
  const page = request('stackTrace', { threadId: 1, startFrame: 1, levels: 2 })

  // Assert
  assert.equal(page.body.stackFrames.length, 2)
  assert.equal(page.body.totalFrames, 3)
  assert.equal(adapter.inspectionReady, false)
})

// Value: protects=snapshots saved before caller locations existed answer as before; fails_when=a frame without a location gets a source; why_new=Cycle 0064 compatibility; seam=none
test('an older snapshot without caller locations answers its callers with no source', () => {
  // Arrange
  const { adapter, request } = harness()
  const snapshot = callerLocationSnapshot()
  delete snapshot.frames[1]!.recordedLocation
  adapter.select(snapshot, 'Recorded')

  // Act
  const frames = request('stackTrace', { threadId: 1 }).body.stackFrames

  // Assert
  assert.deepEqual(
    frames.map((frame: DebugProtocol.StackFrame) => frame.source),
    [undefined, undefined, undefined],
  )
})

// Value: protects=a saved replay never holds the learner's home, storage or absolute workspace path through a caller frame's recorded location; fails_when=the capture keeps the debugger's absolute path; why_new=Cycle 0064 D6 privacy; seam=none
test('capture keeps a workspace-relative caller path and only the name for a path outside the workspace', async () => {
  // Arrange
  const stackFrames = [
    { id: 1, name: 'top', line: 1, column: 1 },
    {
      id: 2,
      name: 'inside',
      line: 5,
      column: 1,
      source: { name: 'a.ts', path: '/home/learner/repo/src/a.ts' },
    },
    {
      id: 3,
      name: 'outside',
      line: 6,
      column: 1,
      source: { name: 'b.js', path: '/home/learner/cache/b.js' },
    },
    {
      id: 4,
      name: 'absoluteName',
      line: 7,
      column: 1,
      source: { name: '/home/learner/cache/c.js' },
    },
  ]

  // Act
  const snapshot = await captureReplayDebugSnapshot({
    stack: { stackFrames, totalFrames: 4 },
    verifiedSource: source,
    workspaceRoot: '/home/learner/repo',
    assertCurrent() {},
    request(command) {
      return Promise.resolve(
        command === 'scopes' ? { scopes: [] } : { variables: [] },
      )
    },
  })

  // Assert
  assert.deepEqual(
    snapshot.frames.map((frame) => frame.recordedLocation),
    [
      undefined,
      { name: 'a.ts', path: 'src/a.ts' },
      { name: 'b.js' },
      { name: 'c.js' },
    ],
  )
  assert.equal(JSON.stringify(snapshot).includes('/home/learner'), false)
})

// Value: protects=a saved replay never holds a URL, a drive path of another host or a relative path as a caller frame's recorded location; fails_when=a URL or `C:\\` name is kept whole, or a URL-like or relative path is resolved against the host's working folder and kept; why_new=Cycle 0064 pt3 review (OCR low); seam=none
test('capture keeps only the last segment of a URL or drive-path caller name and drops a relative or URL path', async () => {
  // Arrange
  const stackFrames = [
    { id: 1, name: 'top', line: 1, column: 1 },
    {
      id: 2,
      name: 'fileUrl',
      line: 5,
      column: 1,
      source: { name: 'file:///Users/learner/cache/a.js' },
    },
    {
      id: 3,
      name: 'drivePath',
      line: 6,
      column: 1,
      source: { name: 'C:\\Users\\learner\\cache\\b.js' },
    },
    {
      id: 4,
      name: 'httpUrl',
      line: 7,
      column: 1,
      source: { name: 'http://localhost:3000/static/c.js?build=7421' },
    },
    {
      id: 5,
      name: 'bundlerUrl',
      line: 8,
      column: 1,
      source: { name: 'a.ts', path: 'webpack:///src/a.ts' },
    },
    {
      id: 6,
      name: 'relativePath',
      line: 9,
      column: 1,
      source: { name: 'd.ts', path: 'src/d.ts' },
    },
  ]

  // Act
  const snapshot = await captureReplayDebugSnapshot({
    stack: { stackFrames, totalFrames: 6 },
    verifiedSource: source,
    workspaceRoot: process.cwd(),
    assertCurrent() {},
    request(command) {
      return Promise.resolve(
        command === 'scopes' ? { scopes: [] } : { variables: [] },
      )
    },
  })

  // Assert
  assert.deepEqual(
    snapshot.frames.map((frame) => frame.recordedLocation),
    [
      undefined,
      { name: 'a.js' },
      { name: 'b.js' },
      { name: 'c.js' },
      { name: 'a.ts' },
      { name: 'd.ts' },
    ],
  )
  assert.equal(JSON.stringify(snapshot).includes('learner'), false)
  assert.equal(JSON.stringify(snapshot).includes('7421'), false)
})

// Value: protects=the replay Call Stack names the right file for a caller whose path holds `#` or `?` in a folder name; fails_when=a query and fragment are cut from every place, not only from a URL, so `/home/learner/c#/lib/x.js` is named `c`; why_new=Cycle 0064 pt3 review (OCR delegate low); seam=none
test('capture names the file of a caller whose absolute or drive path holds a hash or question mark in a folder name', async () => {
  // Arrange
  const stackFrames = [
    { id: 1, name: 'top', line: 1, column: 1 },
    {
      id: 2,
      name: 'hashFolder',
      line: 5,
      column: 1,
      source: { name: '/home/learner/c#/lib/x.js' },
    },
    {
      id: 3,
      name: 'questionFolder',
      line: 6,
      column: 1,
      source: { name: 'C:\\Users\\learner\\what?\\y.js' },
    },
  ]

  // Act
  const snapshot = await captureReplayDebugSnapshot({
    stack: { stackFrames, totalFrames: 3 },
    verifiedSource: source,
    workspaceRoot: process.cwd(),
    assertCurrent() {},
    request(command) {
      return Promise.resolve(
        command === 'scopes' ? { scopes: [] } : { variables: [] },
      )
    },
  })

  // Assert
  assert.deepEqual(
    snapshot.frames.map((frame) => frame.recordedLocation),
    [undefined, { name: 'x.js' }, { name: 'y.js' }],
  )
})

// Value: protects=a saved replay never holds a path when the capture is given no workspace folder; fails_when=a caller's absolute path is kept without a root to make it relative; why_new=the other capture tests all pass a workspaceRoot; seam=none; no_claim=that each capture call site passes its workspace (checked at their runs)
test('capture without a workspace root keeps only the name of a caller frame', async () => {
  // Arrange
  const stackFrames = [
    { id: 1, name: 'top', line: 1, column: 1 },
    {
      id: 2,
      name: 'inside',
      line: 5,
      column: 1,
      source: { name: 'a.ts', path: '/home/learner/repo/src/a.ts' },
    },
  ]

  // Act
  const snapshot = await captureReplayDebugSnapshot({
    stack: { stackFrames, totalFrames: 2 },
    verifiedSource: source,
    assertCurrent() {},
    request(command) {
      return Promise.resolve(
        command === 'scopes' ? { scopes: [] } : { variables: [] },
      )
    },
  })

  // Assert
  assert.deepEqual(snapshot.frames[1]!.recordedLocation, { name: 'a.ts' })
  assert.equal(JSON.stringify(snapshot).includes('/home/learner'), false)
})

// Value: protects=a placeholder source reference of a moment already left is refused; fails_when=select or dispose keeps the placeholder texts, so a stale reference still serves text; why_new=placeholders are a new handle table; seam=none
test('a placeholder source reference of an earlier moment is refused after another moment is selected', () => {
  // Arrange
  const { adapter, request } = harness()
  adapter.select(callerLocationSnapshot(), 'Recorded')
  const staleReference = request('stackTrace', { threadId: 1 }).body
    .stackFrames[1].source.sourceReference

  // Act
  adapter.select(recorded(), 'Recorded later')
  const response = request('source', { sourceReference: staleReference })

  // Assert
  assert.equal(response.success, false)
})

/** Reads the variables of the top frame's scope named `scopeName`, as native Variables does; `undefined` when the scope is absent. @example readScope(request, 'Recorded inspections') */
function readScope(
  request: ReturnType<typeof harness>['request'],
  scopeName: string,
): DebugProtocol.Variable[] | undefined {
  const frame = request('stackTrace', { threadId: 1 }).body.stackFrames[0]
  const scope = request('scopes', { frameId: frame.id }).body.scopes.find(
    (candidate: DebugProtocol.Scope) => candidate.name === scopeName,
  )
  return scope
    ? request('variables', { variablesReference: scope.variablesReference })
        .body.variables
    : undefined
}

// Value: protects=a value the run recorded in a closure stays readable in the replay's native debugger; fails_when=the recorded inspection that is not in the captured scopes is missing from Variables; why_new=only the bounded top-frame scopes were served, so a closure fact was recorded but invisible; seam=none; no_claim=real Cursor Variables rendering
test('a recorded inspection that lives in a closure is listed in the Recorded inspections scope', () => {
  // Arrange
  const { adapter, request } = harness()
  adapter.select(recorded(), 'Recorded', undefined, [
    {
      path: 'type',
      mode: 'value',
      display: "'test/testReducer'",
      type: 'string',
    },
  ])
  request('configurationDone')

  // Act
  const variables = readScope(request, 'Recorded inspections')

  // Assert
  assert.deepEqual(variables, [
    {
      name: 'type',
      value: "'test/testReducer'",
      type: 'string',
      variablesReference: 0,
    },
  ])
})

// Value: protects=a nested path deeper than the captured tree stays readable at the stop; fails_when=a recorded action.payload is missing from Variables; why_new=capture depth 2 drops nested paths, which only the recorded inspection holds; seam=none; no_claim=the capture limits themselves
test('a recorded nested inspection deeper than the captured tree is listed with its full path', () => {
  // Arrange
  const { adapter, request } = harness()
  adapter.select(recorded(), 'Recorded', undefined, [
    {
      path: 'action.type',
      mode: 'value',
      display: "'todos/add'",
      type: 'string',
    },
    {
      path: 'action.payload',
      mode: 'value',
      display: "'Run tests'",
      type: 'string',
    },
  ])
  request('configurationDone')

  // Act
  const variables = readScope(request, 'Recorded inspections')

  // Assert
  assert.deepEqual(
    variables?.map(({ name, value }) => `${name} = ${value}`),
    ["action.type = 'todos/add'", "action.payload = 'Run tests'"],
  )
})

// Value: protects=the recorded inspections show in the Variables of the frame native Call Stack focuses when the top frame has no source; fails_when=the scope stays on the source-less top frame, so the focused frame's Variables never list the recorded values; why_new=CodeRabbit CLI round 1 (Cycle 0067); seam=none; no_claim=real VS Code focus rendering
test('the recorded inspections sit on the first frame with source when the top frame has none', () => {
  // Arrange
  const { adapter, request } = harness()
  const snapshot = recorded()
  snapshot.variables.push({ name: 'queued', value: '1', children: [] })
  snapshot.frames.unshift({
    name: 'processTicksAndRejections',
    line: 95,
    column: 5,
    scopes: [{ name: 'Internal', variables: [1] }],
  })
  adapter.select(snapshot, 'Recorded', undefined, [
    { path: 'amount', mode: 'value', display: '120', type: 'number' },
  ])
  request('configurationDone')
  const frames = request('stackTrace', { threadId: 1 }).body.stackFrames

  // Act
  const scopeNamesOf = (frameId: number) =>
    request('scopes', { frameId }).body.scopes.map(
      (scope: DebugProtocol.Scope) => scope.name,
    )

  // Assert
  assert.deepEqual(scopeNamesOf(frames[0].id), ['Internal'])
  assert.deepEqual(scopeNamesOf(frames[1].id), [
    'Locals',
    'Recorded inspections',
  ])
})

// Value: protects=a withheld recorded value is never shown as a value; fails_when=a type-only inspection displays its type as if it were the value; why_new=the replay never listed recorded inspections before; seam=none; no_claim=redaction rules of the capture
test('an inspection recorded with only its type says its value was not recorded', () => {
  // Arrange
  const { adapter, request } = harness()
  adapter.select(recorded(), 'Recorded', undefined, [
    { path: 'token', mode: 'type', display: 'string' },
  ])
  request('configurationDone')

  // Act
  const variables = readScope(request, 'Recorded inspections')

  // Assert
  assert.deepEqual(variables, [
    {
      name: 'token',
      value: 'Value not recorded (only its type was recorded)',
      type: 'string',
      variablesReference: 0,
    },
  ])
})

// Value: protects=a stop without recorded inspections shows no empty scope; fails_when=an extra scope appears for a stop that recorded no inspection; why_new=guards the new scope against always being added; seam=none; no_claim=none
test('a stop without recorded inspections shows only its captured scopes', () => {
  // Arrange
  const { adapter, request } = harness()
  adapter.select(recorded(), 'Recorded', undefined, [])
  request('configurationDone')
  const frame = request('stackTrace', { threadId: 1 }).body.stackFrames[0]

  // Act
  const scopes = request('scopes', { frameId: frame.id }).body.scopes

  // Assert
  assert.deepEqual(
    scopes.map((scope: DebugProtocol.Scope) => scope.name),
    ['Locals'],
  )
})
