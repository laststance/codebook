import { test } from 'node:test'
import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import type * as vscode from 'vscode'
import type { DebugProtocol } from '@vscode/debugprotocol'
import { ReplayDebugger } from '../replayDebugger'
import type { ReplayDebugSnapshot } from '../replayDebugSchemas'
import { POLL_INTERVAL_MS } from '../runtimeSupport/constants'
import { REPLAY_DEBUG_INSPECTION_GRACE_MS } from '../constants'

const firstSnapshot: ReplayDebugSnapshot = {
  version: 1,
  frames: [{ name: 'LoginButton', line: 90, column: 5, scopes: [] }],
  variables: [],
  limitations: [],
}
const inspectedSnapshot: ReplayDebugSnapshot = {
  version: 1,
  frames: [
    {
      name: 'LoginButton',
      line: 90,
      column: 5,
      scopes: [{ name: 'Local', variables: [0] }],
    },
  ],
  variables: [{ name: 'pending', value: 'true', children: [] }],
  limitations: [],
}

/** Minimal editor event port for owned-session lifecycle tests. @example emitter.fire(session) */
class TestEmitter<Value> {
  private readonly listeners = new Set<(value: Value) => void>()
  readonly event: vscode.Event<Value> = (listener, thisArgs, disposables) => {
    const wrapped = (value: Value) => listener.call(thisArgs, value)
    this.listeners.add(wrapped)
    const disposable = {
      dispose: () => {
        this.listeners.delete(wrapped)
      },
    }
    disposables?.push(disposable)
    return disposable
  }
  fire(value: Value): void {
    for (const listener of this.listeners) listener(value)
  }
  dispose(): void {
    this.listeners.clear()
  }
}
/** Exposes owned native lifecycle operations and counts reader notifications; `manualInspection` lets readiness tests withhold client requests, while `disconnectBeforeTermination` models native Stop ordering. @example harness().changes() */
function harness(
  startGate?: Promise<void>,
  terminationGate?: Promise<void>,
  refusedStarts = 0,
  disconnectBeforeTermination = false,
  manualInspection = false,
) {
  const terminated = new TestEmitter<vscode.DebugSession>(),
    stopped: string[] = [],
    messages: Array<DebugProtocol.Response | DebugProtocol.Event> = []
  let factory: vscode.DebugAdapterDescriptorFactory | undefined,
    adapter: vscode.DebugAdapter | undefined,
    session: vscode.DebugSession | undefined
  let sessionCount = 0
  let requestSequence = 100
  /** Models a real native-client request against the current adapter for lifecycle tests. @example request('threads').body.threads */
  function request(command: string, arguments_?: unknown) {
    const sequence = ++requestSequence
    assert.ok(adapter)
    adapter.handleMessage({
      type: 'request',
      seq: sequence,
      command,
      arguments: arguments_,
    })
    const response = messages.find(
      (message) => 'request_seq' in message && message.request_seq === sequence,
    )
    assert.ok(response && 'request_seq' in response)
    return response
  }
  /** Retrieves the selected stop as native Variables does; automatic clients invoke it after stopped. @example inspect() */
  function inspect() {
    const thread = request('threads').body.threads[0]
    const frame = request('stackTrace', { threadId: thread.id }).body
      .stackFrames[0]
    // A gap has no scopes or values to retrieve.
    if (!frame) return
    const scope = request('scopes', { frameId: frame.id }).body.scopes[0]
    if (scope)
      request('variables', { variablesReference: scope.variablesReference })
  }
  let signalStarted = () => {}
  const started = new Promise<void>((resolve) => {
    signalStarted = resolve
  })
  let signalStopRequested = () => {}
  const stopRequested = new Promise<void>((resolve) => {
    signalStopRequested = resolve
  })
  class Inline {
    constructor(public implementation: vscode.DebugAdapter) {
      adapter = implementation
      implementation.onDidSendMessage((message) => {
        // VS Code intentionally types its wire message as opaque; this inline adapter emits only DAP events and responses.
        const protocolMessage = message as
          DebugProtocol.Response | DebugProtocol.Event
        messages.push(protocolMessage)
        if (
          !manualInspection &&
          'event' in protocolMessage &&
          protocolMessage.event === 'stopped'
        )
          inspect()
      })
    }
  }
  const editor: ConstructorParameters<typeof ReplayDebugger>[0] = {
    EventEmitter: TestEmitter,
    DebugAdapterInlineImplementation: Inline,
    debug: {
      registerDebugAdapterDescriptorFactory(_type, value) {
        factory = value
        return {
          dispose() {
            factory = undefined
          },
        }
      },
      onDidTerminateDebugSession: terminated.event,
      async startDebugging(_folder, configuration) {
        if (typeof configuration === 'string')
          throw new Error('Expected an owned inline configuration')
        if (refusedStarts > 0) {
          refusedStarts--
          return false
        }
        session = {
          id:
            ++sessionCount === 1
              ? 'historical-owned'
              : `historical-owned-${sessionCount}`,
          type: 'codebook-replay',
          name: configuration.name,
          configuration,
          workspaceFolder: undefined,
          customRequest: async () => undefined,
          getDebugProtocolBreakpoint: async () => undefined,
        }
        await factory?.createDebugAdapterDescriptor(session, undefined)
        adapter?.handleMessage({
          type: 'request',
          seq: 1,
          command: 'configurationDone',
        })
        signalStarted()
        await startGate
        return true
      },
      async stopDebugging(target) {
        assert.ok(target)
        stopped.push(target.id)
        signalStopRequested()
        // The editor asks the inline adapter to disconnect before the session-ended event arrives.
        if (disconnectBeforeTermination)
          adapter?.handleMessage({
            type: 'request',
            seq: 1_000,
            command: 'disconnect',
          })
        await terminationGate
        terminated.fire(target)
      },
    },
  }
  let changes = 0
  const owner = new ReplayDebugger(editor, () => {
    changes++
  })
  return {
    owner,
    stopped,
    messages,
    started,
    stopRequested,
    request,
    inspect,
    changes: () => changes,
    terminate: () => {
      assert.ok(session)
      terminated.fire(session)
    },
    disconnect: () => {
      assert.ok(adapter)
      adapter.handleMessage({
        type: 'request',
        seq: 999,
        command: 'disconnect',
      })
    },
    terminateForeign: () => {
      assert.ok(session)
      terminated.fire({ ...session, id: 'unrelated-live-session' })
    },
    foreignStart: async () => {
      assert.ok(factory)
      assert.ok(session)
      return factory.createDebugAdapterDescriptor(
        {
          ...session,
          id: 'foreign',
          configuration: {
            ...session.configuration,
            codebookReplayOwner: 'other-owner',
          },
        },
        undefined,
      )
    },
    relaunch: async () => {
      assert.ok(factory)
      assert.ok(session)
      return factory.createDebugAdapterDescriptor(
        { ...session, id: 'relaunched-by-editor' },
        undefined,
      )
    },
  }
}

test('historical workspace closure stops only its owned native session', async () => {
  // Arrange
  const { owner, stopped } = harness()
  await owner.present(
    undefined,
    'Not recorded at this moment',
    new AbortController().signal,
  )
  // Act
  await owner.dispose()
  await owner.dispose()
  // Assert
  assert.deepEqual(stopped, ['historical-owned'])
})

test('closing during delayed native startup retires the acquired session exactly once', async () => {
  // Arrange
  let release = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const { owner, stopped, started } = harness(gate)
  const showing = owner.present(
    undefined,
    'Missing',
    new AbortController().signal,
  )
  const rejected = assert.rejects(showing, /closed during startup/)
  await started
  // Act
  const closing = owner.dispose()
  release()
  await rejected
  await closing
  // Assert
  assert.deepEqual(stopped, ['historical-owned'])
})

test('a superseded seek cannot publish after native debugger startup completes', async () => {
  // Arrange
  let release = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const { owner, started } = harness(gate)
  const showing = owner.present(
    undefined,
    'Old requested moment',
    new AbortController().signal,
  )
  const rejected = assert.rejects(showing, /superseded/)
  await started
  // Act
  owner.invalidate()
  release()
  await rejected
  // Assert
  await owner.present(
    undefined,
    'Not recorded at this moment',
    new AbortController().signal,
  )
  await owner.dispose()
})

test('manual native termination does not silently relaunch a session during playback', async () => {
  // Arrange
  const { owner, terminate, stopped } = harness()
  await owner.present(undefined, 'Missing', new AbortController().signal)
  // Act
  terminate()
  // Assert
  await assert.rejects(
    owner.present(undefined, 'Missing', new AbortController().signal),
    /closed/,
  )
  await owner.dispose()
  assert.deepEqual(stopped, [])
})

test('a learner-stopped historical session reports itself unavailable so an explicit replay reopen can replace it', async () => {
  // Arrange
  const { owner, terminate } = harness()
  await owner.present(
    firstSnapshot,
    'Recorded pause',
    new AbortController().signal,
  )
  assert.equal(owner.available, true)
  // Act
  terminate()
  // Assert
  assert.equal(owner.available, false)
  await owner.dispose()
})

test('an editor relaunch of a learner-stopped historical session is refused instead of adopted without history', async () => {
  // Arrange
  const { owner, terminate, relaunch } = harness()
  await owner.present(
    firstSnapshot,
    'Recorded pause',
    new AbortController().signal,
  )
  // Act
  terminate()
  // Assert
  await assert.rejects(relaunch(), /Open historical debugging/)
  await owner.dispose()
})

test('a refused native startup is retried by the next historical presentation', async () => {
  // Arrange
  const { owner, stopped } = harness(undefined, undefined, 1)
  const signal = new AbortController().signal
  await assert.rejects(
    owner.present(firstSnapshot, 'Recorded pause', signal),
    /did not start/,
  )
  // Act
  await owner.present(firstSnapshot, 'Recorded pause', signal)
  // Assert
  assert.equal(owner.available, true)
  await owner.dispose()
  assert.deepEqual(stopped, ['historical-owned'])
})

test('seeking another recorded stop retires the old owned session before opening new native values', async () => {
  // Arrange
  const { owner, stopped } = harness()
  const signal = new AbortController().signal
  await owner.present(firstSnapshot, 'First recorded stop', signal)
  // Act
  owner.invalidate()
  await owner.retire(undefined, signal)
  assert.deepEqual(stopped, ['historical-owned'])
  await owner.present(undefined, 'Second recorded stop', signal)
  await owner.dispose()
  // Assert
  assert.deepEqual(stopped, ['historical-owned', 'historical-owned-2'])
})

test('video frames within one recorded stop preserve their native debug session', async () => {
  // Arrange
  const { owner, stopped } = harness()
  const signal = new AbortController().signal
  await owner.present(firstSnapshot, 'Recorded pause', signal)
  // Act
  await owner.retire(firstSnapshot, signal)
  await owner.present(firstSnapshot, 'Recorded pause', signal)
  // Assert
  assert.deepEqual(stopped, [])
  await owner.dispose()
})

test('a new recorded stop waits for native termination before replacing historical values', async () => {
  // Arrange
  let releaseTermination = () => {}
  const terminationGate = new Promise<void>((resolve) => {
    releaseTermination = resolve
  })
  const { owner, stopped, stopRequested } = harness(undefined, terminationGate)
  const signal = new AbortController().signal
  await owner.present(firstSnapshot, 'First recorded stop', signal)

  // Act
  owner.invalidate()
  const retiring = owner.retire(undefined, signal)
  await stopRequested
  let replacementPresented = false
  const replacement = owner
    .present(undefined, 'Second recorded stop', signal)
    .then(() => {
      replacementPresented = true
    })

  // Assert
  assert.deepEqual(stopped, ['historical-owned'])
  assert.equal(replacementPresented, false)
  releaseTermination()
  await retiring
  await replacement
  assert.equal(replacementPresented, true)
  await owner.dispose()
  assert.deepEqual(stopped, ['historical-owned', 'historical-owned-2'])
})

test('a launch configuration cannot borrow another learning session owner', async () => {
  // Arrange
  const { owner, foreignStart } = harness()
  await owner.present(undefined, 'Missing', new AbortController().signal)
  // Act / Assert
  await assert.rejects(foreignStart(), /Open historical debugging/)
  await owner.dispose()
})

test('an unrelated debugger ending does not detach or stop the selected historical session', async () => {
  // Arrange
  const { owner, stopped, terminateForeign } = harness()
  const signal = new AbortController().signal
  await owner.present(firstSnapshot, 'Recorded pause', signal)

  // Act
  terminateForeign()
  await owner.present(firstSnapshot, 'Recorded pause', signal)

  // Assert
  assert.deepEqual(stopped, [])
  await owner.dispose()
  assert.deepEqual(stopped, ['historical-owned'])
})

test('stopping the recorded session from the native debugger marks history unavailable before the editor reports termination', async () => {
  // Arrange
  const { owner, messages, disconnect } = harness()
  const signal = new AbortController().signal
  await owner.present(firstSnapshot, 'Recorded pause', signal)

  // Act: the native Stop button sends DAP disconnect to the historical adapter.
  disconnect()

  // Assert
  assert.equal(owner.available, false)
  assert.equal(
    messages.some(
      (message) => 'event' in message && message.event === 'terminated',
    ),
    true,
  )
  await assert.rejects(
    owner.present(firstSnapshot, 'Recorded pause', signal),
    /Reopen the learning replay/,
  )
  await owner.dispose()
})

test('replacing a recorded stop keeps history available when the editor disconnects the old adapter before termination', async () => {
  // Arrange
  const { owner, stopped } = harness(undefined, undefined, 0, true)
  const signal = new AbortController().signal
  await owner.present(firstSnapshot, 'First recorded stop', signal)

  // Act
  owner.invalidate()
  await owner.retire(undefined, signal)
  await owner.present(undefined, 'Second recorded stop', signal)

  // Assert
  assert.equal(owner.available, true)
  await owner.dispose()
  assert.deepEqual(stopped, ['historical-owned', 'historical-owned-2'])
})

test('replay remains loading until the native debugger retrieves the current recorded Local values', async () => {
  // Arrange
  const fixture = harness(undefined, undefined, 0, false, true)
  let outcome = 'pending'
  const showing = fixture.owner
    .present(inspectedSnapshot, 'Recorded pause', new AbortController().signal)
    .then((result) => {
      outcome = result
    })
  try {
    await fixture.started
    await delay(POLL_INTERVAL_MS * 2)
    assert.equal(outcome, 'pending')

    // Act
    const thread = fixture.request('threads').body.threads[0]
    const frame = fixture.request('stackTrace', { threadId: thread.id }).body
      .stackFrames[0]
    const scope = fixture.request('scopes', { frameId: frame.id }).body
      .scopes[0]
    await delay(POLL_INTERVAL_MS * 2)
    const beforeVariables = outcome
    fixture.request('variables', {
      variablesReference: scope.variablesReference,
    })
    await showing

    // Assert
    assert.equal(
      beforeVariables,
      'pending',
      'a current stack and scopes are not yet recorded Variables',
    )
    assert.equal(outcome, 'inspected')
  } finally {
    await fixture.owner.dispose()
  }
})

test('a duplicate replay presentation cannot skip pending native inspection', async () => {
  // Arrange
  const fixture = harness(undefined, undefined, 0, false, true),
    signal = new AbortController().signal
  const first = fixture.owner.present(
    inspectedSnapshot,
    'Recorded pause',
    signal,
  )
  const firstRejected = assert.rejects(first, /superseded/)
  void firstRejected.catch(() => {})
  let duplicateOutcome = 'pending'
  try {
    await fixture.started
    await new Promise<void>((resolve) => setImmediate(resolve))

    // Act
    const duplicate = fixture.owner
      .present(inspectedSnapshot, 'Recorded pause', signal)
      .then((result) => {
        duplicateOutcome = result
      })
    await delay(POLL_INTERVAL_MS * 2)
    const beforeInspection = duplicateOutcome
    fixture.inspect()
    await duplicate
    await firstRejected

    // Assert
    assert.equal(beforeInspection, 'pending')
    assert.equal(duplicateOutcome, 'inspected')
  } finally {
    await fixture.owner.dispose()
    await firstRejected.catch(() => {})
  }
})

test('canceling a replay during native inspection cannot confirm that recorded moment', async () => {
  // Arrange
  const fixture = harness(undefined, undefined, 0, false, true),
    controller = new AbortController()
  const showing = fixture.owner.present(
    inspectedSnapshot,
    'Recorded pause',
    controller.signal,
  )
  const rejected = assert.rejects(showing, /abort/i)
  void rejected.catch(() => {})
  try {
    await fixture.started
    await new Promise<void>((resolve) => setImmediate(resolve))

    // Act
    controller.abort()

    // Assert
    await rejected
    assert.deepEqual(fixture.stopped, [])
  } finally {
    await fixture.owner.dispose()
    await rejected.catch(() => {})
  }
})

for (const endSession of ['terminate', 'disconnect'] satisfies Array<
  'terminate' | 'disconnect'
>) {
  test(`native ${endSession} during replay inspection refuses confirmation and requires explicit reopening`, async () => {
    // Arrange
    const fixture = harness(undefined, undefined, 0, false, true)
    const showing = fixture.owner.present(
      inspectedSnapshot,
      'Recorded pause',
      new AbortController().signal,
    )
    const rejected = assert.rejects(showing, /closed|Reopen/i)
    void rejected.catch(() => {})
    try {
      await fixture.started
      await new Promise<void>((resolve) => setImmediate(resolve))

      // Act
      fixture[endSession]()

      // Assert
      await rejected
      assert.equal(fixture.owner.available, false)
    } finally {
      await fixture.owner.dispose()
      await rejected.catch(() => {})
    }
  })
}

// Value: protects=a hidden Variables view or a focused foreign session never turns replay navigation into a failure; fails_when=present waits indefinitely or rejects when native Run and Debug does not retrieve values; why_new=the review found default layouts where Variables is hidden during outline navigation; seam=none
test('a recorded moment commits without native values when Run and Debug does not load them, and later inspection loads them', async () => {
  // Arrange
  const fixture = harness(undefined, undefined, 0, false, true),
    signal = new AbortController().signal
  try {
    // Act
    const hiddenInspection = await fixture.owner.present(
      inspectedSnapshot,
      'Recorded pause',
      signal,
    )
    fixture.inspect()
    const afterOpeningRunAndDebug = await fixture.owner.present(
      inspectedSnapshot,
      'Recorded pause',
      signal,
    )

    // Assert
    assert.equal(hiddenInspection, 'uninspected')
    assert.equal(afterOpeningRunAndDebug, 'inspected')
    assert.deepEqual(
      fixture.stopped,
      [],
      'an uninspected moment must not restart or stop the native session',
    )
    assert.equal(fixture.owner.available, true)
  } finally {
    await fixture.owner.dispose()
  }
})

// Value: protects=continuous playback through a paused interval while Variables is hidden; fails_when=every video frame of an uninspected stop waits for the grace again; why_new=frames of one stop reuse the same selection; seam=none
test('later video frames of a stop committed without native values do not wait for Run and Debug again', async () => {
  // Arrange
  const fixture = harness(undefined, undefined, 0, false, true),
    signal = new AbortController().signal
  try {
    await fixture.owner.present(inspectedSnapshot, 'Recorded pause', signal)

    // Act
    const laterFrame = await Promise.race([
      fixture.owner.present(inspectedSnapshot, 'Recorded pause', signal),
      delay(POLL_INTERVAL_MS * 4, 'still waiting for Run and Debug'),
    ])

    // Assert
    assert.equal(laterFrame, 'uninspected')
  } finally {
    await fixture.owner.dispose()
  }
})

// Value: protects=retrying a stop whose presentation was interrupted keeps the native session that already shows it; fails_when=retire treats that stop as different and restarts the owned session; why_new=present selects the stop in native Run and Debug before its inspection wait; seam=none
test('retrying a stop whose presentation was interrupted keeps the native session showing it instead of restarting', async () => {
  // Arrange
  const fixture = harness(undefined, undefined, 0, false, true)
  const laterSnapshot: ReplayDebugSnapshot = {
    ...inspectedSnapshot,
    frames: [
      {
        name: 'LoginForm',
        line: 75,
        column: 13,
        scopes: [{ name: 'Local', variables: [0] }],
      },
    ],
  }
  try {
    const first = fixture.owner.present(
      inspectedSnapshot,
      'First recorded pause',
      new AbortController().signal,
    )
    await fixture.started
    await new Promise<void>((resolve) => setImmediate(resolve))
    fixture.inspect()
    await first
    const abandoned = new AbortController()
    const interrupted = assert.rejects(
      fixture.owner.present(
        laterSnapshot,
        'Later recorded pause',
        abandoned.signal,
      ),
      /abort/i,
    )
    await new Promise<void>((resolve) => setImmediate(resolve))
    abandoned.abort()
    await interrupted
    const signal = new AbortController().signal

    // Act
    await fixture.owner.retire(laterSnapshot, signal)
    const retried = fixture.owner.present(
      laterSnapshot,
      'Later recorded pause',
      signal,
    )
    await new Promise<void>((resolve) => setImmediate(resolve))
    fixture.inspect()
    const inspection = await retried

    // Assert
    assert.equal(inspection, 'inspected')
    assert.deepEqual(
      fixture.stopped,
      [],
      'the interrupted stop is already selected in the running session',
    )
    assert.equal(
      fixture.request('threads').body.threads[0].name,
      'Later recorded pause',
    )
  } finally {
    await fixture.owner.dispose()
  }
})

// Value: protects=a stop shown again after Codebook restarted its owned session reaches the fresh adapter; fails_when=the owner keeps its selection after the session ends and skips selecting the new adapter; why_new=present does not reselect an unchanged stop; seam=none
test('a stop shown again after Codebook restarts its native session is selected in the new session', async () => {
  // Arrange
  const fixture = harness(),
    signal = new AbortController().signal
  const laterSnapshot: ReplayDebugSnapshot = {
    ...inspectedSnapshot,
    frames: [
      {
        name: 'LoginForm',
        line: 75,
        column: 13,
        scopes: [{ name: 'Local', variables: [0] }],
      },
    ],
  }
  try {
    await fixture.owner.present(
      inspectedSnapshot,
      'First recorded pause',
      signal,
    )

    // Act
    await fixture.owner.retire(laterSnapshot, signal)
    const inspection = await fixture.owner.present(
      inspectedSnapshot,
      'First recorded pause',
      signal,
    )

    // Assert
    assert.equal(inspection, 'inspected')
    assert.deepEqual(fixture.stopped, ['historical-owned'])
    assert.equal(
      fixture.request('threads').body.threads[0].name,
      'First recorded pause',
    )
  } finally {
    await fixture.owner.dispose()
  }
})

// Value: protects=Play across recorded stops while Variables stays hidden, and the reader learning when values load; fails_when=each new stop waits the full grace again, or loading values does not notify the reader; why_new=the review found Play stalling about one second per stop; seam=none
test('while Run and Debug loads no values, later recorded stops commit at once until it loads them again', async () => {
  // Arrange
  const fixture = harness(undefined, undefined, 0, false, true),
    signal = new AbortController().signal
  const laterSnapshot: ReplayDebugSnapshot = {
    ...inspectedSnapshot,
    frames: [
      {
        name: 'LoginForm',
        line: 75,
        column: 13,
        scopes: [{ name: 'Local', variables: [0] }],
      },
    ],
  }
  try {
    await fixture.owner.present(
      inspectedSnapshot,
      'First recorded pause',
      signal,
    )

    // Act
    const laterStop = await Promise.race([
      fixture.owner.present(laterSnapshot, 'Later recorded pause', signal),
      delay(POLL_INTERVAL_MS * 4, 'still waiting for Run and Debug'),
    ])
    fixture.inspect()
    const changesAfterLoading = fixture.changes()
    let returnOutcome = 'pending'
    const returning = fixture.owner
      .present(inspectedSnapshot, 'First recorded pause', signal)
      .then((result) => {
        returnOutcome = result
      })
    await delay(POLL_INTERVAL_MS * 2)
    const whileLoading = returnOutcome
    fixture.inspect()
    await returning

    // Assert
    assert.equal(laterStop, 'uninspected')
    assert.equal(changesAfterLoading, 1)
    assert.equal(
      whileLoading,
      'pending',
      'once values load, a new stop waits for its own values again',
    )
    assert.equal(returnOutcome, 'inspected')
  } finally {
    await fixture.owner.dispose()
  }
})

// Value: protects=Play crossing a gap while Call Stack is open but Variables stays collapsed; fails_when=the empty gap stack counts as loaded values, so the next stop waits the full grace again; why_new=only a retrieved Variables page shows that values load; seam=none
test('an empty gap stack shown in Call Stack does not make the next recorded stop wait for Variables again', async () => {
  // Arrange
  const fixture = harness(undefined, undefined, 0, false, true),
    signal = new AbortController().signal
  const laterSnapshot: ReplayDebugSnapshot = {
    ...inspectedSnapshot,
    frames: [
      {
        name: 'LoginForm',
        line: 75,
        column: 13,
        scopes: [{ name: 'Local', variables: [0] }],
      },
    ],
  }
  try {
    await fixture.owner.present(
      inspectedSnapshot,
      'First recorded pause',
      signal,
    )
    const gap = await fixture.owner.present(
      undefined,
      'Not recorded at this moment',
      signal,
    )
    fixture.inspect()

    // Act
    const laterStop = await Promise.race([
      fixture.owner.present(laterSnapshot, 'Later recorded pause', signal),
      delay(POLL_INTERVAL_MS * 4, 'still waiting for Run and Debug'),
    ])

    // Assert
    assert.equal(gap, 'uninspected')
    assert.equal(laterStop, 'uninspected')
    assert.equal(fixture.changes(), 0)
  } finally {
    await fixture.owner.dispose()
  }
})

// Value: protects=Play across recorded stops while Variables stays hidden, through the session restart Codebook performs to change stops; fails_when=Codebook's own retirement forgets that values are unrequested, so each stop waits the full grace and the hint blinks; why_new=the earlier cross-stop test never retires between stops as StudyWorkspace.presentPlayback does; seam=none
test('recorded stops that Codebook restarts the session for keep committing at once while Run and Debug loads no values', async () => {
  // Arrange
  const fixture = harness(undefined, undefined, 0, false, true),
    signal = new AbortController().signal
  const laterSnapshot: ReplayDebugSnapshot = {
    ...inspectedSnapshot,
    frames: [
      {
        name: 'LoginForm',
        line: 75,
        column: 13,
        scopes: [{ name: 'Local', variables: [0] }],
      },
    ],
  }
  try {
    await fixture.owner.present(
      inspectedSnapshot,
      'First recorded pause',
      signal,
    )

    // Act
    await fixture.owner.retire(laterSnapshot, signal)
    const laterStop = await Promise.race([
      fixture.owner.present(laterSnapshot, 'Later recorded pause', signal),
      delay(POLL_INTERVAL_MS * 4, 'still waiting for Run and Debug'),
    ])

    // Assert
    assert.deepEqual(fixture.stopped, ['historical-owned'])
    assert.equal(laterStop, 'uninspected')
    assert.equal(
      fixture.changes(),
      0,
      'Codebook changing stops does not clear the reader hint',
    )
  } finally {
    await fixture.owner.dispose()
  }
})

// Value: protects=Play through a multi-frame gap while Call Stack is open but Variables stays collapsed; fails_when=a repeated gap frame whose empty stack was already retrieved counts as loaded values; why_new=the single-frame gap test never presents the same gap twice; seam=none
test('several video frames of a gap shown in Call Stack do not make the next recorded stop wait for Variables again', async () => {
  // Arrange
  const fixture = harness(undefined, undefined, 0, false, true),
    signal = new AbortController().signal
  const laterSnapshot: ReplayDebugSnapshot = {
    ...inspectedSnapshot,
    frames: [
      {
        name: 'LoginForm',
        line: 75,
        column: 13,
        scopes: [{ name: 'Local', variables: [0] }],
      },
    ],
  }
  try {
    await fixture.owner.present(
      inspectedSnapshot,
      'First recorded pause',
      signal,
    )
    await fixture.owner.present(
      undefined,
      'Not recorded at this moment',
      signal,
    )
    fixture.inspect()
    await fixture.owner.present(
      undefined,
      'Not recorded at this moment',
      signal,
    )

    // Act
    const laterStop = await Promise.race([
      fixture.owner.present(laterSnapshot, 'Later recorded pause', signal),
      delay(POLL_INTERVAL_MS * 4, 'still waiting for Run and Debug'),
    ])

    // Assert
    assert.equal(laterStop, 'uninspected')
    assert.equal(fixture.changes(), 0)
  } finally {
    await fixture.owner.dispose()
  }
})

// Value: protects=a stop whose values load during the last poll interval of the grace commits as inspected, so no stale hint follows the reader notification; fails_when=the grace deadline reports 'uninspected' without reading readiness once more; why_new=waitUntil sleeps before its final deadline check; seam=node:test mocks of performance.now and the shared timers/promises setTimeout drive the grace clock
test('values Run and Debug loads during the last grace poll commit the stop as inspected', async (context) => {
  // Arrange
  const promiseTimers: typeof import('node:timers/promises') = createRequire(
    __filename,
  )('node:timers/promises')
  const fixture = harness(undefined, undefined, 0, false, true),
    realSleep = promiseTimers.setTimeout
  let clockMs = 0
  context.mock.method(performance, 'now', () => clockMs)
  context.mock.method(
    promiseTimers,
    'setTimeout',
    (delayMs: number, value?: unknown, options?: { signal?: AbortSignal }) => {
      clockMs += delayMs
      // Native Variables finishes loading after the last readiness read but before the grace deadline check.
      if (clockMs >= REPLAY_DEBUG_INSPECTION_GRACE_MS) fixture.inspect()
      return realSleep(0, value, options)
    },
  )
  try {
    // Act
    const inspection = await fixture.owner.present(
      inspectedSnapshot,
      'Recorded pause',
      new AbortController().signal,
    )

    // Assert
    assert.equal(inspection, 'inspected')
    assert.equal(fixture.changes(), 1)
  } finally {
    context.mock.restoreAll()
    await fixture.owner.dispose()
  }
})

// Value: protects=the reader dropping its Run and Debug hint when the learner stops the recorded session; fails_when=an ended session leaves a hint that names a session which no longer exists; why_new=the review found a stale hint after native Stop; seam=none
test('stopping the recorded session from the native debugger notifies the reader', async () => {
  // Arrange
  const fixture = harness(undefined, undefined, 0, false, true)
  try {
    await fixture.owner.present(
      inspectedSnapshot,
      'Recorded pause',
      new AbortController().signal,
    )
    const beforeStop = fixture.changes()

    // Act
    fixture.terminate()

    // Assert
    assert.equal(beforeStop, 0)
    assert.equal(fixture.changes(), 1)
    assert.equal(fixture.owner.available, false)
  } finally {
    await fixture.owner.dispose()
  }
})

test('a missing-history interval is confirmed by its current empty stack alone', async () => {
  // Arrange
  const fixture = harness(undefined, undefined, 0, false, true)
  let outcome = 'pending'
  const showing = fixture.owner
    .present(
      undefined,
      'Not recorded at this moment',
      new AbortController().signal,
    )
    .then((result) => {
      outcome = result
    })
  try {
    await fixture.started
    await delay(POLL_INTERVAL_MS * 2)
    const beforeStack = outcome

    // Act
    fixture.inspect()
    await showing

    // Assert
    assert.equal(beforeStack, 'pending')
    assert.equal(outcome, 'inspected')
  } finally {
    await fixture.owner.dispose()
  }
})

test('a newer replay stop cannot be confirmed by inspection of the superseded frame', async () => {
  // Arrange
  const fixture = harness(undefined, undefined, 0, false, true),
    signal = new AbortController().signal
  const laterSnapshot: ReplayDebugSnapshot = {
    ...inspectedSnapshot,
    frames: [
      {
        name: 'LoginForm',
        line: 75,
        column: 13,
        scopes: [{ name: 'Local', variables: [0] }],
      },
    ],
    variables: [{ name: 'state', value: 'CredentialsSignin', children: [] }],
  }
  const first = fixture.owner.present(
    inspectedSnapshot,
    'First recorded pause',
    signal,
  )
  const firstRejected = assert.rejects(first, /superseded/)
  void firstRejected.catch(() => {})
  let laterOutcome = 'pending'
  try {
    await fixture.started
    await new Promise<void>((resolve) => setImmediate(resolve))
    const firstThread = fixture.request('threads').body.threads[0]
    const firstFrame = fixture.request('stackTrace', {
      threadId: firstThread.id,
    }).body.stackFrames[0]

    // Act
    const later = fixture.owner
      .present(laterSnapshot, 'Later recorded pause', signal)
      .then((result) => {
        laterOutcome = result
      })
    await new Promise<void>((resolve) => setImmediate(resolve))
    const staleScopes = fixture.request('scopes', { frameId: firstFrame.id })
      .body.scopes
    await delay(POLL_INTERVAL_MS * 2)
    const afterStaleInspection = laterOutcome
    fixture.inspect()
    await later
    await firstRejected

    // Assert
    assert.deepEqual(staleScopes, [])
    assert.equal(afterStaleInspection, 'pending')
    assert.equal(laterOutcome, 'inspected')
  } finally {
    await fixture.owner.dispose()
    await firstRejected.catch(() => {})
  }
})

test('workspace closure during pending native inspection rejects the moment and stops only its owned session', async () => {
  // Arrange
  const fixture = harness(undefined, undefined, 0, false, true)
  const showing = fixture.owner.present(
    inspectedSnapshot,
    'Recorded pause',
    new AbortController().signal,
  )
  const rejected = assert.rejects(showing, /closed|Reopen/i)
  void rejected.catch(() => {})
  try {
    await fixture.started
    await new Promise<void>((resolve) => setImmediate(resolve))

    // Act
    await fixture.owner.dispose()

    // Assert
    await rejected
    assert.deepEqual(fixture.stopped, ['historical-owned'])
  } finally {
    await fixture.owner.dispose()
    await rejected.catch(() => {})
  }
})

test('video frames at an already inspected stop reuse recorded values without asking the native client again', async () => {
  // Arrange
  const fixture = harness(undefined, undefined, 0, false, true),
    signal = new AbortController().signal
  try {
    const showing = fixture.owner.present(
      inspectedSnapshot,
      'Recorded pause',
      signal,
    )
    await fixture.started
    await new Promise<void>((resolve) => setImmediate(resolve))
    fixture.inspect()
    await showing
    const originalMessages = fixture.messages.length

    // Act
    await fixture.owner.retire(inspectedSnapshot, signal)
    const reused = await fixture.owner.present(
      inspectedSnapshot,
      'Recorded pause',
      signal,
    )

    // Assert
    assert.equal(reused, 'inspected')
    assert.equal(fixture.messages.length, originalMessages)
    assert.deepEqual(fixture.stopped, [])
  } finally {
    await fixture.owner.dispose()
  }
})
