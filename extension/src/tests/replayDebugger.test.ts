import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'

import type { DebugProtocol } from '@vscode/debugprotocol'
import type * as vscode from 'vscode'

import {
  REPLAY_DEBUG_CAPTURE_TIMEOUT_MS,
  REPLAY_DEBUG_INSPECTION_GRACE_MS,
  REPLAY_DEBUG_VALUES_PAINT_ALLOWANCE_MS,
} from '../constants'
import { ReplayDebugAdapter } from '../replayDebugAdapter'
import { ReplayDebugger } from '../replayDebugger'
import type { ReplayDebugSnapshot } from '../replayDebugSchemas'
import { POLL_INTERVAL_MS } from '../runtimeSupport/constants'
import { sha256 } from '../runtimeSupport/utils/sha256'

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
      dispose: (): void => {
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
/** Lets queued promise continuations run while fake timers hold every timeout; the check queue is not faked. @example await flushNative() */
async function flushNative(): Promise<void> {
  for (let turn = 0; turn < 5; turn++)
    await new Promise<void>((resolve) => setImmediate(resolve))
}
/** Exposes owned native lifecycle operations and counts reader notifications; `manualInspection` lets readiness tests withhold client requests, `disconnectBeforeTermination` models native Stop ordering, `configurationGate` delays the editor's configurationDone (and so the first stopped event), `refusalGate` delays each refused start's answer, `listeners` replaces the reader's notification handlers and `descriptorGate` delays the editor's request for the adapter of an accepted launch. @example harness().changes() */
function harness(
  startGate?: Promise<void>,
  terminationGate?: Promise<void>,
  refusedStarts = 0,
  disconnectBeforeTermination = false,
  manualInspection = false,
  configurationGate?: Promise<void>,
  refusalGate?: Promise<void>,
  listeners?: { changed?: () => void; failed?: (error: unknown) => void },
  /** The id of another debug session whose paused thread holds the Run and Debug focus, as while a live run or a learner's own session is paused and selected in Call Stack. */
  focusedForeignPauseSessionId?: string,
  /** Holds an accepted launch before the editor asks the descriptor factory for its adapter, as a slow editor does. */
  descriptorGate?: Promise<void>,
  /** Models entry while another native debugger is already active, before this owner's public lifecycle subscriptions. */
  initialActiveSessionId?: string,
) {
  const startedSessions = new TestEmitter<vscode.DebugSession>(),
    terminated = new TestEmitter<vscode.DebugSession>(),
    stopped: string[] = [],
    messages: Array<DebugProtocol.Response | DebugProtocol.Event> = []
  let factory: vscode.DebugAdapterDescriptorFactory | undefined,
    adapter: vscode.DebugAdapter | undefined,
    inline: { implementation: vscode.DebugAdapter } | undefined,
    session: vscode.DebugSession | undefined
  let sessionCount = 0
  let startCalls = 0
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
  function inspect(): void {
    const thread = request('threads').body.threads[0]
    const frame = request('stackTrace', { threadId: thread.id }).body
      .stackFrames[0]
    // A gap has no scopes or values to retrieve.
    if (!frame) return
    const scope = request('scopes', { frameId: frame.id }).body.scopes[0]
    if (scope)
      request('variables', { variablesReference: scope.variablesReference })
  }
  let signalStarted = (): void => {}
  const started = new Promise<void>((resolve) => {
    signalStarted = resolve
  })
  let signalStopRequested = (): void => {}
  const stopRequested = new Promise<void>((resolve) => {
    signalStopRequested = resolve
  })
  class Inline {
    constructor(public implementation: vscode.DebugAdapter) {
      adapter = implementation
      inline = this
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
      get activeDebugSession(): vscode.DebugSession | undefined {
        if (session || initialActiveSessionId === undefined) return session
        return {
          id: initialActiveSessionId,
          type: 'pwa-node',
          name: 'Learner debugger',
          configuration: {
            type: 'pwa-node',
            name: 'Learner debugger',
            request: 'launch',
          },
          workspaceFolder: undefined,
          customRequest: async () => undefined,
          getDebugProtocolBreakpoint: async () => undefined,
        }
      },
      get activeStackItem(): vscode.DebugThread | undefined {
        // The editor reports the focused paused thread with its session; only the session's identity is read.
        return focusedForeignPauseSessionId === undefined
          ? undefined
          : {
              session: {
                id: focusedForeignPauseSessionId,
                type: 'pwa-node',
                name: 'Next.js: debug server-side',
                configuration: {
                  type: 'pwa-node',
                  name: 'Next.js: debug server-side',
                  request: 'launch',
                },
                workspaceFolder: undefined,
                customRequest: async () => undefined,
                getDebugProtocolBreakpoint: async () => undefined,
              },
              threadId: 1,
            }
      },
      registerDebugAdapterDescriptorFactory(_type, value) {
        factory = value
        return {
          dispose(): void {
            factory = undefined
          },
        }
      },
      onDidTerminateDebugSession: terminated.event,
      onDidStartDebugSession: startedSessions.event,
      async startDebugging(_folder, configuration) {
        if (typeof configuration === 'string')
          throw new Error('Expected an owned inline configuration')
        if (refusedStarts > 0) {
          refusedStarts--
          startCalls++
          signalStarted()
          await refusalGate
          return false
        }
        startCalls++
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
        if (descriptorGate) {
          signalStarted()
          await descriptorGate
        }
        await factory?.createDebugAdapterDescriptor(session, undefined)
        startedSessions.fire(session)
        const configured = adapter
        const configure = (): void =>
          configured?.handleMessage({
            type: 'request',
            seq: 1,
            command: 'configurationDone',
          })
        if (configurationGate) void configurationGate.then(configure)
        else configure()
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
  const owner = new ReplayDebugger(
    editor,
    () => {
      changes++
      listeners?.changed?.()
    },
    listeners?.failed,
  )
  return {
    editor,
    owner,
    stopped,
    messages,
    started,
    stopRequested,
    request,
    inspect,
    startForeignSession: (): void => {
      assert.ok(session)
      startedSessions.fire({
        ...session,
        id: 'learner-foreign-session',
        configuration: {
          type: 'pwa-node',
          name: 'Learner debugger',
          request: 'launch',
        },
      })
    },
    changes: () => changes,
    startCalls: () => startCalls,
    /** Models the editor disposing the inline adapter before it reports the session's termination. */
    disposeAdapter: (): void => {
      assert.ok(inline)
      inline.implementation.dispose()
    },
    terminate: (): void => {
      assert.ok(session)
      terminated.fire(session)
    },
    disconnect: (): void => {
      assert.ok(adapter)
      adapter.handleMessage({
        type: 'request',
        seq: 999,
        command: 'disconnect',
      })
    },
    terminateForeign: (id = 'unrelated-live-session'): void => {
      assert.ok(session)
      terminated.fire({ ...session, id })
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

test('a recorded native stack selects its current historical model without requiring a second learner frame choice', async () => {
  // Arrange: a client honors the focus hint and fetches only the stack until the native session is selected.
  const fixture = harness(undefined, undefined, 0, false, true)
  try {
    const selections: string[] = []
    fixture.editor.commands = {
      getCommands: async () => ['workbench.action.debug.focusProcess'],
      executeCommand: async (command, ...arguments_) => {
        assert.deepEqual(arguments_, [null])
        selections.push(command)
        fixture.inspect()
        return undefined
      },
    }
    const pending = fixture.owner.present(
      inspectedSnapshot,
      'Recorded with native values',
      new AbortController().signal,
    )
    await fixture.started
    await flushNative()

    // Act: the current client obtains its real native stack before any model selection is allowed.
    const currentThread = fixture.request('threads').body.threads[0]
    fixture.request('stackTrace', { threadId: currentThread.id })
    await flushNative()

    // Assert: actual native requests establish inspection, rather than the selection command claiming it.
    assert.equal(await pending, 'inspected')
    assert.deepEqual(selections, ['workbench.action.debug.focusProcess'])
  } finally {
    await fixture.owner.dispose()
  }
})

// Value: protects=Play inside one recorded stop: its frames share one selection, so the owner asks the host for its commands once and selects the native model once, while the next stop is selected again (F6, Cycle 0046 /ship review); fails_when=every presented frame of a stop with values asks `getCommands(true)` and runs workbench.action.debug.focusProcess again, a catalog roundtrip and a model selection per frame; why_new=every model-selection test presented one frame; seam=the editor's command port, which counts discovery and selections, and the native client's threads and stackTrace requests
test('the frames of one recorded stop ask the host for its commands once and select the native model once, and the next stop is selected again', async () => {
  // Arrange: a client honors the focus hint, loading the stop's values when the model is selected; the host's command catalog counts its answers.
  const fixture = harness(undefined, undefined, 0, false, true)
  try {
    let discoveries = 0
    const selections: string[] = []
    fixture.editor.commands = {
      getCommands: async () => {
        discoveries += 1
        return ['workbench.action.debug.focusProcess']
      },
      executeCommand: async (command) => {
        selections.push(command)
        fixture.inspect()
        return undefined
      },
    }
    const firstFrame = fixture.owner.present(
      inspectedSnapshot,
      'Recorded pause · 1.00 s',
      new AbortController().signal,
    )
    await fixture.started
    await flushNative()
    const firstThread = fixture.request('threads').body.threads[0]
    fixture.request('stackTrace', { threadId: firstThread.id })
    const inspections = [await firstFrame]

    // Act: two later frames of the same stop, as Play presents them, then the next stop.
    for (let frame = 0; frame < 2; frame += 1)
      inspections.push(
        await fixture.owner.present(
          inspectedSnapshot,
          'Recorded pause · 1.00 s',
          new AbortController().signal,
        ),
      )
    const nextStop = fixture.owner.present(
      structuredClone(inspectedSnapshot),
      'Recorded pause · 2.50 s',
      new AbortController().signal,
    )
    await flushNative()
    const nextThread = fixture.request('threads').body.threads[0]
    fixture.request('stackTrace', { threadId: nextThread.id })
    inspections.push(await nextStop)

    // Assert
    assert.deepEqual(
      { inspections, discoveries, selections },
      {
        inspections: ['inspected', 'inspected', 'inspected', 'inspected'],
        discoveries: 1,
        selections: [
          'workbench.action.debug.focusProcess',
          'workbench.action.debug.focusProcess',
        ],
      },
    )
  } finally {
    await fixture.owner.dispose()
  }
})

// Value: protects=the native model of a recorded stop whose stack native Call Stack fetched only after the grace: its first frame selects nothing, and the next frame of the same stop selects it, once (F6's rule: a selection whose model was not selected is tried again); fails_when=the selection is noted as settled before the stack wait ends, so the stop's model is never selected while the learner plays or seeks within it; why_new=TR3, Cycle 0046 repeat testing review (F6's retry had no test); seam=the editor's command port, which counts selections, the native client's threads and stackTrace requests, held back until the grace passed on the faked clock
test('a recorded stop whose stack arrives after the grace selects its native model at its next frame, once', async (context) => {
  // Arrange: a client that fetches nothing until the test asks, on a clock that only the test moves.
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const fixture = harness(undefined, undefined, 0, false, true)
  const selections: string[] = []
  fixture.editor.commands = {
    getCommands: async () => ['workbench.action.debug.focusProcess'],
    executeCommand: async (command) => {
      selections.push(command)
      return undefined
    },
  }
  try {
    const firstFrame = fixture.owner.present(
      inspectedSnapshot,
      'Recorded pause · 1.00 s',
      new AbortController().signal,
    )
    await fixture.started
    await flushNative()
    // The stack is not fetched within the grace, and then the values are not either.
    context.mock.timers.tick(REPLAY_DEBUG_INSPECTION_GRACE_MS)
    await flushNative()
    context.mock.timers.tick(REPLAY_DEBUG_INSPECTION_GRACE_MS)
    await firstFrame
    const selectionsAtTheFirstFrame = [...selections]

    // Act: the next frame of the same stop, whose stack the client fetches now.
    const nextFrame = fixture.owner.present(
      inspectedSnapshot,
      'Recorded pause · 1.00 s',
      new AbortController().signal,
    )
    await flushNative()
    const thread = fixture.request('threads').body.threads[0]
    fixture.request('stackTrace', { threadId: thread.id })
    await flushNative()
    await nextFrame

    // Assert
    assert.deepEqual(
      { selectionsAtTheFirstFrame, selectionsAtTheNextFrame: selections },
      {
        selectionsAtTheFirstFrame: [],
        selectionsAtTheNextFrame: ['workbench.action.debug.focusProcess'],
      },
    )
  } finally {
    context.mock.timers.reset()
    await fixture.owner.dispose()
  }
})

// Value: protects=the native model of a recorded stop shown while another debugger was active: its first frame selects nothing (the default resolver could pick the other session), and the next frame of the same stop, once that debugger ended, selects it, once (F6's rule: a selection whose model was not selected is tried again); fails_when=the selection is noted as settled before the cohort check, so the stop's model is never selected after the other debugger ended; why_new=TR3, Cycle 0046 repeat testing review (F6's retry had no test; the earlier test of an ended competitor presents another label, a new selection); seam=the editor's command port, which counts selections, the public start and end of another debug session, and the native client's threads and stackTrace requests
test('a recorded stop shown while another debugger was active selects its native model at its next frame once that debugger ended, once', async () => {
  // Arrange: the first frame of a stop is shown while a learner's debugger starts beside it.
  const fixture = harness(undefined, undefined, 0, false, true)
  const selections: string[] = []
  fixture.editor.commands = {
    getCommands: async () => ['workbench.action.debug.focusProcess'],
    executeCommand: async (command) => {
      selections.push(command)
      return undefined
    },
  }
  try {
    const firstFrame = fixture.owner.present(
      inspectedSnapshot,
      'Recorded pause · 1.00 s',
      new AbortController().signal,
    )
    await fixture.started
    await flushNative()
    fixture.startForeignSession()
    const thread = fixture.request('threads').body.threads[0]
    fixture.request('stackTrace', { threadId: thread.id })
    await firstFrame
    const selectionsAtTheFirstFrame = [...selections]

    // Act: the learner's debugger ends, then the next frame of the same stop is shown.
    fixture.terminateForeign('learner-foreign-session')
    await fixture.owner.present(
      inspectedSnapshot,
      'Recorded pause · 1.00 s',
      new AbortController().signal,
    )

    // Assert
    assert.deepEqual(
      { selectionsAtTheFirstFrame, selectionsAtTheNextFrame: selections },
      {
        selectionsAtTheFirstFrame: [],
        selectionsAtTheNextFrame: ['workbench.action.debug.focusProcess'],
      },
    )
  } finally {
    await fixture.owner.dispose()
  }
})

test('a background native debugger cannot be selected by historical default-session resolution', async () => {
  // Arrange: the host resolver may choose any paused session when no explicit native model is supplied.
  const fixture = harness(undefined, undefined, 0, false, true)
  try {
    const selections: string[] = []
    fixture.editor.commands = {
      getCommands: async () => ['workbench.action.debug.focusProcess'],
      executeCommand: async (command) => {
        selections.push(command)
        return undefined
      },
    }
    const pending = fixture.owner.present(
      inspectedSnapshot,
      'Recorded beside another native debugger',
      new AbortController().signal,
    )
    await fixture.started
    await flushNative()

    // Act: the other debugger is known through the real public lifecycle surface, even with no focused foreign frame.
    fixture.startForeignSession()
    const currentThread = fixture.request('threads').body.threads[0]
    fixture.request('stackTrace', { threadId: currentThread.id })

    // Assert
    assert.equal(await pending, 'uninspected')
    assert.deepEqual(selections, [])
    assert.deepEqual(fixture.stopped, [])
  } finally {
    await fixture.owner.dispose()
  }
})

test('replay entered while another debugger is already active never guesses the native session cohort', async () => {
  // Arrange
  const fixture = harness(
    undefined,
    undefined,
    0,
    false,
    true,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    'preexisting-learner-debugger',
  )
  try {
    const selections: string[] = []
    fixture.editor.commands = {
      getCommands: async () => ['workbench.action.debug.focusProcess'],
      executeCommand: async (command) => {
        selections.push(command)
        return undefined
      },
    }
    const pending = fixture.owner.present(
      inspectedSnapshot,
      'Recorded beside an existing native debugger',
      new AbortController().signal,
    )
    await fixture.started
    await flushNative()

    // Act: the historical session is now active, but the earlier native cohort is still unknown.
    const currentThread = fixture.request('threads').body.threads[0]
    fixture.request('stackTrace', { threadId: currentThread.id })

    // Assert
    assert.equal(await pending, 'uninspected')
    assert.deepEqual(selections, [])
    assert.deepEqual(fixture.stopped, [])
  } finally {
    await fixture.owner.dispose()
  }
})

test('ending an observed competing debugger lets the next recorded native moment load its own values', async () => {
  // Arrange
  const fixture = harness(undefined, undefined, 0, false, true)
  try {
    const selections: string[] = []
    fixture.editor.commands = {
      getCommands: async () => ['workbench.action.debug.focusProcess'],
      executeCommand: async (command) => {
        selections.push(command)
        fixture.inspect()
        return undefined
      },
    }
    const earlier = fixture.owner.present(
      inspectedSnapshot,
      'Recorded while another debugger remains',
      new AbortController().signal,
    )
    await fixture.started
    await flushNative()
    fixture.startForeignSession()
    const earlierThread = fixture.request('threads').body.threads[0]
    fixture.request('stackTrace', { threadId: earlierThread.id })
    assert.equal(await earlier, 'uninspected')

    // Act
    fixture.terminateForeign('learner-foreign-session')
    const later = fixture.owner.present(
      inspectedSnapshot,
      'Recorded after the observed competitor ended',
      new AbortController().signal,
    )
    await flushNative()
    const laterThread = fixture.request('threads').body.threads[0]
    fixture.request('stackTrace', { threadId: laterThread.id })

    // Assert
    assert.equal(await later, 'inspected')
    assert.deepEqual(selections, ['workbench.action.debug.focusProcess'])
    assert.deepEqual(fixture.stopped, [])
  } finally {
    await fixture.owner.dispose()
  }
})

test('an unavailable native selection command leaves historical inspection truthful and never dispatches another command', async () => {
  // Arrange
  const fixture = harness(undefined, undefined, 0, false, true)
  const selections: string[] = []
  fixture.editor.commands = {
    getCommands: async () => [],
    executeCommand: async (command) => {
      selections.push(command)
      return undefined
    },
  }

  // Act
  const result = await fixture.owner.present(
    inspectedSnapshot,
    'Recorded without the native selection command',
    new AbortController().signal,
  )

  // Assert
  assert.equal(result, 'uninspected')
  assert.deepEqual(selections, [])
  await fixture.owner.dispose()
})

test('a foreign paused debugger keeps its selected model while a recorded stack becomes available', async () => {
  // Arrange
  const fixture = harness(
    undefined,
    undefined,
    0,
    false,
    true,
    undefined,
    undefined,
    undefined,
    'learner-foreign-session',
  )
  const selections: string[] = []
  fixture.editor.commands = {
    getCommands: async () => ['workbench.action.debug.focusProcess'],
    executeCommand: async (command) => {
      selections.push(command)
      return undefined
    },
  }

  // Act
  const result = await fixture.owner.present(
    inspectedSnapshot,
    'Recorded beside the learner debugger',
    new AbortController().signal,
  )

  // Assert
  assert.equal(result, 'uninspected')
  assert.deepEqual(selections, [])
  assert.deepEqual(fixture.stopped, [])
  await fixture.owner.dispose()
})

test('historical model selection waits for the current stack and leaves an unavailable stack uninspected', async () => {
  // Arrange
  const fixture = harness(undefined, undefined, 0, false, true)
  const selections: string[] = []
  fixture.editor.commands = {
    getCommands: async () => ['workbench.action.debug.focusProcess'],
    executeCommand: async (command) => {
      selections.push(command)
      return undefined
    },
  }

  // Act: no stackTrace request is supplied by this native client.
  const result = await fixture.owner.present(
    inspectedSnapshot,
    'Recorded while the native stack is hidden',
    new AbortController().signal,
  )

  // Assert
  assert.equal(result, 'uninspected')
  assert.deepEqual(selections, [])
  await fixture.owner.dispose()
})

test('a newer active debugger is never selected by a historical presentation waiting for command discovery', async () => {
  // Arrange
  const fixture = harness(undefined, undefined, 0, false, true)
  const selections: string[] = []
  let provideCommands = (_commands: string[]): void => {}
  const available = new Promise<string[]>((resolve) => {
    provideCommands = resolve
  })
  fixture.editor.commands = {
    getCommands: () => available,
    executeCommand: async (command) => {
      selections.push(command)
      return undefined
    },
  }
  const pending = fixture.owner.present(
    inspectedSnapshot,
    'Recorded before a different session is selected',
    new AbortController().signal,
  )
  await fixture.started
  await flushNative()
  const currentThread = fixture.request('threads').body.threads[0]
  fixture.request('stackTrace', { threadId: currentThread.id })

  // Act: the public active owner changes while command discovery is outstanding.
  Object.defineProperty(fixture.editor.debug, 'activeDebugSession', {
    get: () => undefined,
  })
  provideCommands(['workbench.action.debug.focusProcess'])

  // Assert
  assert.equal(await pending, 'uninspected')
  assert.deepEqual(selections, [])
  await fixture.owner.dispose()
})

test('cancelling a historical presentation awaiting its stack prevents a later native model selection', async () => {
  // Arrange
  const fixture = harness(undefined, undefined, 0, false, true)
  const cancellation = new AbortController()
  const selections: string[] = []
  fixture.editor.commands = {
    getCommands: async () => ['workbench.action.debug.focusProcess'],
    executeCommand: async (command) => {
      selections.push(command)
      return undefined
    },
  }
  const pending = fixture.owner.present(
    inspectedSnapshot,
    'Recorded before cancellation',
    cancellation.signal,
  )
  const rejected = assert.rejects(pending, /Learner left this recorded moment/)
  await fixture.started
  await flushNative()

  // Act
  cancellation.abort(new Error('Learner left this recorded moment'))
  await rejected
  const currentThread = fixture.request('threads').body.threads[0]
  fixture.request('stackTrace', { threadId: currentThread.id })
  await flushNative()

  // Assert
  assert.deepEqual(selections, [])
  assert.equal(fixture.owner.available, true)
  await fixture.owner.dispose()
})

test('superseded recorded history cannot select a native model after the newer gap commits', async (context) => {
  // Arrange
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const fixture = harness(undefined, undefined, 0, false, true)
  const selections: string[] = []
  fixture.editor.commands = {
    getCommands: async () => ['workbench.action.debug.focusProcess'],
    executeCommand: async (command) => {
      selections.push(command)
      return undefined
    },
  }
  const pending = fixture.owner.present(
    inspectedSnapshot,
    'Recorded before a newer gap',
    new AbortController().signal,
  )
  const rejected = assert.rejects(pending, /presentation was superseded/)
  try {
    await fixture.started
    await flushNative()

    // Act
    const gap = await fixture.owner.present(
      undefined,
      'Not recorded at this moment',
      new AbortController().signal,
    )
    context.mock.timers.tick(REPLAY_DEBUG_INSPECTION_GRACE_MS)
    await rejected

    // Assert
    assert.equal(gap, 'no-values')
    assert.deepEqual(selections, [])
    const currentThread = fixture.request('threads').body.threads[0]
    assert.equal(currentThread.name, 'Not recorded at this moment')
    assert.deepEqual(
      fixture.request('stackTrace', { threadId: currentThread.id }).body
        .stackFrames,
      [],
    )
  } finally {
    context.mock.timers.reset()
    await fixture.owner.dispose()
  }
})

test('unsupported command discovery cannot commit obsolete recorded history after a newer gap', async () => {
  // Arrange
  const fixture = harness(undefined, undefined, 0, false, true)
  const selections: string[] = []
  let provideCommands = (_commands: string[]): void => {}
  fixture.editor.commands = {
    getCommands: () =>
      new Promise<string[]>((resolve) => {
        provideCommands = resolve
      }),
    executeCommand: async (command) => {
      selections.push(command)
      return undefined
    },
  }
  const pending = fixture.owner.present(
    inspectedSnapshot,
    'Recorded before unsupported command discovery finishes',
    new AbortController().signal,
  )
  const rejected = assert.rejects(pending, /presentation was superseded/)
  await fixture.started
  await flushNative()

  // Act
  const gap = await fixture.owner.present(
    undefined,
    'Not recorded at this moment',
    new AbortController().signal,
  )
  const currentThread = fixture.request('threads').body.threads[0]
  fixture.request('stackTrace', { threadId: currentThread.id })
  provideCommands([])

  // Assert
  await rejected
  assert.equal(gap, 'no-values')
  assert.deepEqual(selections, [])
  await fixture.owner.dispose()
})

test('unanswered native command discovery cannot stall a saved recorded moment indefinitely', async (context) => {
  // Arrange
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const fixture = harness(undefined, undefined, 0, false, true)
  const selections: string[] = []
  fixture.editor.commands = {
    getCommands: () => new Promise<string[]>(() => {}),
    executeCommand: async (command) => {
      selections.push(command)
      return undefined
    },
  }
  const pending = fixture.owner.present(
    inspectedSnapshot,
    'Recorded while command discovery is unanswered',
    new AbortController().signal,
  )
  const rejected = assert.rejects(
    pending,
    /Timed out waiting for native historical model command availability/,
  )
  try {
    await fixture.started
    await flushNative()

    // Act
    context.mock.timers.tick(REPLAY_DEBUG_CAPTURE_TIMEOUT_MS)
    await rejected

    // Assert
    assert.deepEqual(selections, [])
    assert.equal(fixture.owner.available, true)
  } finally {
    context.mock.timers.reset()
    await fixture.owner.dispose()
  }
})

test('unanswered native model selection ends within its bound without claiming inspected values', async (context) => {
  // Arrange
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const fixture = harness(undefined, undefined, 0, false, true)
  const selections: string[] = []
  fixture.editor.commands = {
    getCommands: async () => ['workbench.action.debug.focusProcess'],
    executeCommand: (command) => {
      selections.push(command)
      return new Promise<undefined>(() => {})
    },
  }
  const pending = fixture.owner.present(
    inspectedSnapshot,
    'Recorded while model selection is unanswered',
    new AbortController().signal,
  )
  const rejected = assert.rejects(
    pending,
    /Timed out waiting for native historical model selection/,
  )
  try {
    await fixture.started
    await flushNative()
    const currentThread = fixture.request('threads').body.threads[0]
    fixture.request('stackTrace', { threadId: currentThread.id })
    await flushNative()

    // Act
    context.mock.timers.tick(REPLAY_DEBUG_CAPTURE_TIMEOUT_MS)
    await rejected

    // Assert
    assert.deepEqual(selections, ['workbench.action.debug.focusProcess'])
    assert.equal(fixture.owner.available, true)
  } finally {
    context.mock.timers.reset()
    await fixture.owner.dispose()
  }
})

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
  let release = (): void => {}
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
  let release = (): void => {}
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
  let releaseTermination = (): void => {}
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

// Value: protects=a seek during Codebook's own stop change; fails_when=the old adapter's disconnect marks history unavailable before its termination, so the seek is refused as closed and the reader reloads; why_new=Cycle 0044 (0034-C1 / 0034-PL3); seam=none
test('a seek between the old adapter disconnect and its termination during a stop change still presents the next stop', async () => {
  // Arrange
  let releaseTermination = (): void => {}
  const fixture = harness(
    undefined,
    new Promise<void>((resolve) => {
      releaseTermination = resolve
    }),
    0,
    true,
  )
  await fixture.owner.present(
    firstSnapshot,
    'First recorded stop',
    new AbortController().signal,
  )
  fixture.owner.invalidate()
  const retiring = fixture.owner.retire(undefined, new AbortController().signal)
  await fixture.stopRequested
  try {
    // Act
    const availableBetween = fixture.owner.available
    const seeking = fixture.owner.present(
      inspectedSnapshot,
      'Second recorded stop',
      new AbortController().signal,
    )
    releaseTermination()
    await retiring
    const outcome = await seeking

    // Assert
    assert.equal(availableBetween, true)
    assert.equal(outcome, 'inspected')
    assert.equal(fixture.owner.available, true)
  } finally {
    releaseTermination()
    await fixture.owner.dispose()
  }
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

  test(`native ${endSession} during a pending inspection wait fails the replay moment at once instead of at the inspection grace`, async (context) => {
    // Arrange
    context.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
    const fixture = harness(undefined, undefined, 0, false, true)
    let outcome = 'pending'
    const showing = fixture.owner
      .present(
        inspectedSnapshot,
        'Recorded pause',
        new AbortController().signal,
      )
      .then(
        (inspection) => {
          outcome = inspection
        },
        (error: unknown) => {
          outcome = error instanceof Error ? error.message : String(error)
        },
      )
    try {
      await fixture.started
      await flushNative()

      // Act: no timer advances, so only the ownership change can end the wait.
      fixture[endSession]()
      await flushNative()

      // Assert
      assert.match(outcome, /Reopen the learning replay/)
    } finally {
      context.mock.timers.reset()
      await fixture.owner.dispose()
      await showing
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
    // The reader is told once the paint allowance after the served values passed.
    await delay(REPLAY_DEBUG_VALUES_PAINT_ALLOWANCE_MS + POLL_INTERVAL_MS)
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
    assert.equal(gap, 'no-values')
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
test('values Run and Debug loads just before the grace deadline commit the stop as inspected', async (context) => {
  // Arrange
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  const fixture = harness(undefined, undefined, 0, false, true)
  let outcome = 'pending'
  const showing = fixture.owner
    .present(inspectedSnapshot, 'Recorded pause', new AbortController().signal)
    .then((result) => {
      outcome = result
    })
  try {
    await fixture.started
    await flushNative()
    context.mock.timers.tick(REPLAY_DEBUG_INSPECTION_GRACE_MS - 1)
    await flushNative()
    const beforeValues = outcome

    // Act
    fixture.inspect()
    await showing
    context.mock.timers.tick(REPLAY_DEBUG_VALUES_PAINT_ALLOWANCE_MS)

    // Assert
    assert.equal(beforeValues, 'pending')
    assert.equal(outcome, 'inspected')
    assert.equal(fixture.changes(), 1)
  } finally {
    context.mock.timers.reset()
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

// Value: protects=Play crossing an unrecorded interval while Call Stack is hidden; fails_when=a gap waits for an empty-stack request that a hidden Call Stack never sends; why_new=Cycle 0032 H4 replaces the empty-stack wait; seam=none
test('a missing-history interval commits at once without waiting for native Call Stack', async () => {
  // Arrange
  const fixture = harness(undefined, undefined, 0, false, true)
  try {
    // Act
    const outcome = await Promise.race([
      fixture.owner.present(
        undefined,
        'Not recorded at this moment',
        new AbortController().signal,
      ),
      delay(POLL_INTERVAL_MS * 4, 'still waiting for Call Stack'),
    ])

    // Assert
    assert.equal(outcome, 'no-values')
    assert.equal(fixture.changes(), 0)
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

// Value: protects=hidden-Variables playback cost and hint timing; fails_when=the wait polls readiness or measures its grace from somewhere other than the stopped event; why_new=Cycle 0032 H8 event-driven wait; seam=none
test('with Variables hidden a stop commits without values exactly one grace after Run and Debug is told about it, without polling', async (context) => {
  // Arrange
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  const readiness = Object.getOwnPropertyDescriptor(
    ReplayDebugAdapter.prototype,
    'inspectionReady',
  )!.get!
  let readinessReads = 0
  context.mock.method(
    ReplayDebugAdapter.prototype,
    'inspectionReady',
    function (this: ReplayDebugAdapter) {
      readinessReads++
      return readiness.call(this)
    },
    { getter: true },
  )
  const fixture = harness(undefined, undefined, 0, false, true)
  let outcome = 'pending'
  const showing = fixture.owner
    .present(inspectedSnapshot, 'Recorded pause', new AbortController().signal)
    .then((result) => {
      outcome = result
    })
  try {
    await fixture.started
    await flushNative()
    const readsWhileWaiting = readinessReads

    // Act
    context.mock.timers.tick(REPLAY_DEBUG_INSPECTION_GRACE_MS - 1)
    await flushNative()
    const beforeDeadline = outcome
    const readsBeforeDeadline = readinessReads
    context.mock.timers.tick(1)
    await showing

    // Assert
    assert.equal(beforeDeadline, 'pending')
    assert.equal(
      readsBeforeDeadline,
      readsWhileWaiting,
      'no readiness polls while nothing changes',
    )
    assert.equal(outcome, 'uninspected')
  } finally {
    context.mock.timers.reset()
    await fixture.owner.dispose()
  }
})

// Value: protects=a (re)started session getting its whole grace; fails_when=the grace starts at select() and a slow session launch eats it, so a visible Variables view still gets the hint; why_new=Cycle 0032 H8; seam=none
test('a stop that Run and Debug learns about late still gets the whole grace from that moment', async (context) => {
  // Arrange
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  let configure = (): void => {}
  const configurationGate = new Promise<void>((resolve) => {
    configure = resolve
  })
  const fixture = harness(
    undefined,
    undefined,
    0,
    false,
    true,
    configurationGate,
  )
  let outcome = 'pending'
  const showing = fixture.owner
    .present(inspectedSnapshot, 'Recorded pause', new AbortController().signal)
    .then((result) => {
      outcome = result
    })
  try {
    await fixture.started
    await flushNative()
    context.mock.timers.tick(3_000)
    await flushNative()
    const beforeStopped = outcome

    // Act
    configure()
    await flushNative()
    context.mock.timers.tick(REPLAY_DEBUG_INSPECTION_GRACE_MS - 1)
    await flushNative()
    const beforeDeadline = outcome
    context.mock.timers.tick(1)
    await showing

    // Assert
    assert.equal(beforeStopped, 'pending')
    assert.equal(beforeDeadline, 'pending')
    assert.equal(outcome, 'uninspected')
  } finally {
    configure()
    context.mock.timers.reset()
    await fixture.owner.dispose()
  }
})

// Value: protects=playback when the editor never tells Run and Debug about the stop; fails_when=the wait has no deadline without a stopped event and playback stalls; why_new=Cycle 0032 H8 capture deadline; seam=none
test('a stop that Run and Debug is never told about commits without values at the capture deadline', async (context) => {
  // Arrange
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  const fixture = harness(
    undefined,
    undefined,
    0,
    false,
    true,
    new Promise<void>(() => {}),
  )
  let outcome = 'pending'
  const showing = fixture.owner
    .present(inspectedSnapshot, 'Recorded pause', new AbortController().signal)
    .then((result) => {
      outcome = result
    })
  try {
    await fixture.started
    await flushNative()

    // Act
    context.mock.timers.tick(REPLAY_DEBUG_CAPTURE_TIMEOUT_MS - 1)
    await flushNative()
    const beforeDeadline = outcome
    context.mock.timers.tick(1)
    await showing

    // Assert
    assert.equal(beforeDeadline, 'pending')
    assert.equal(outcome, 'uninspected')
  } finally {
    context.mock.timers.reset()
    await fixture.owner.dispose()
  }
})

// Value: protects=Play through a stop without captured scopes while Variables is hidden; fails_when=a scope-less stop waits, shows a hint or resets the session-level unrequested state; why_new=Cycle 0032 H4; seam=none
test('a recorded stop without scopes commits at once and later stops keep committing without waiting while Variables stays hidden', async () => {
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
    const hidden = await fixture.owner.present(
      inspectedSnapshot,
      'First recorded pause',
      signal,
    )

    // Act
    const scopeLess = await Promise.race([
      fixture.owner.present(
        firstSnapshot,
        'Recorded pause without scopes',
        signal,
      ),
      delay(POLL_INTERVAL_MS * 4, 'still waiting for Run and Debug'),
    ])
    const laterStop = await Promise.race([
      fixture.owner.present(laterSnapshot, 'Later recorded pause', signal),
      delay(POLL_INTERVAL_MS * 4, 'still waiting for Run and Debug'),
    ])

    // Assert
    assert.equal(hidden, 'uninspected')
    assert.equal(scopeLess, 'no-values')
    assert.equal(laterStop, 'uninspected')
    assert.equal(fixture.changes(), 0)
  } finally {
    await fixture.owner.dispose()
  }
})

// Value: protects=Run and Debug showing the stop the learner returns to after a failed selection; fails_when=the duplicate-selection guard skips select() and native views stay empty; why_new=Cycle 0032 H6; seam=none
test('a stop is selected again in Run and Debug after a failed selection of another stop', async () => {
  // Arrange
  const fixture = harness(),
    signal = new AbortController().signal
  const tampered: ReplayDebugSnapshot = {
    ...inspectedSnapshot,
    frames: [
      {
        ...inspectedSnapshot.frames[0]!,
        source: {
          name: 'LoginButton.tsx',
          text: 'export const pending = true',
          hash: sha256('different source'),
          line: 1,
        },
      },
    ],
  }
  try {
    await fixture.owner.present(inspectedSnapshot, 'Recorded pause A', signal)
    await assert.rejects(
      fixture.owner.present(tampered, 'Tampered pause', signal),
      /Recorded debugger source hash mismatch/,
    )

    // Act
    const shown = await fixture.owner.present(
      inspectedSnapshot,
      'Recorded pause A',
      signal,
    )

    // Assert
    const thread = fixture.request('threads').body.threads[0]
    const frames = fixture.request('stackTrace', { threadId: thread.id }).body
      .stackFrames
    assert.equal(shown, 'inspected')
    assert.equal(thread.name, 'Recorded pause A')
    assert.deepEqual(
      frames.map((frame: { name: string }) => frame.name),
      ['LoginButton'],
    )
  } finally {
    await fixture.owner.dispose()
  }
})

// Value: protects=the playback queue when the editor never answers a session startup; fails_when=an abandoned presentation keeps waiting for startDebugging, so PlaybackController never processes the next frame; why_new=Cycle 0032 D5 (outside voice); seam=none
test('an abandoned presentation leaves a native startup that never answers, and the next presentation shows its stop once startup completes', async () => {
  // Arrange
  let releaseStart = (): void => {}
  const startGate = new Promise<void>((resolve) => {
    releaseStart = resolve
  })
  const fixture = harness(startGate),
    abandoned = new AbortController()
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
    const first = fixture.owner
      .present(inspectedSnapshot, 'First recorded pause', abandoned.signal)
      .then(
        () => 'committed',
        (error: unknown) => String(error),
      )
    await fixture.started

    // Act
    abandoned.abort(new Error('Playback presentation superseded'))
    const firstOutcome = await Promise.race([
      first,
      delay(POLL_INTERVAL_MS * 4, 'still waiting for native startup'),
    ])
    releaseStart()
    const next = await fixture.owner.present(
      laterSnapshot,
      'Later recorded pause',
      new AbortController().signal,
    )

    // Assert
    assert.equal(firstOutcome, 'Error: Playback presentation superseded')
    assert.equal(next, 'inspected')
    assert.equal(
      fixture.request('threads').body.threads[0].name,
      'Later recorded pause',
    )
  } finally {
    releaseStart()
    await fixture.owner.dispose()
  }
})

// Value: protects=retrying a startup the editor refused after its only presentation was abandoned; fails_when=the refusal stays cached because cleanup runs only for a waiter that was not aborted; why_new=Cycle 0033 L1 (Codex probe: 1 start call instead of 2); seam=none
test('a startup the editor refuses after its only presentation was abandoned is retried by the next presentation', async () => {
  // Arrange
  let answerRefusal = (): void => {}
  const refusalGate = new Promise<void>((resolve) => {
    answerRefusal = resolve
  })
  const fixture = harness(
    undefined,
    undefined,
    1,
    false,
    false,
    undefined,
    refusalGate,
  )
  const abandoned = new AbortController()
  const first = fixture.owner
    .present(inspectedSnapshot, 'Recorded pause', abandoned.signal)
    .catch((error: unknown) => String(error))
  await fixture.started
  abandoned.abort(new Error('Playback presentation superseded'))
  await first
  try {
    // Act
    answerRefusal()
    await flushNative()
    const next = await fixture.owner.present(
      inspectedSnapshot,
      'Recorded pause',
      new AbortController().signal,
    )

    // Assert
    assert.equal(next, 'inspected')
    assert.equal(fixture.startCalls(), 2)
  } finally {
    await fixture.owner.dispose()
  }
})

// Value: protects=a saved Node stop selection, whose signal never aborts, when the editor never answers startDebugging; fails_when=the shared startup has no bound; why_new=Cycle 0033 A2; seam=none
test('a startup the editor never answers makes the historical debugger unavailable after the capture timeout instead of waiting forever', async (context) => {
  // Arrange
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const fixture = harness(
    undefined,
    undefined,
    1,
    false,
    false,
    undefined,
    new Promise<void>(() => {}),
  )
  let outcome = 'pending'
  const showing = fixture.owner
    .present(inspectedSnapshot, 'Recorded pause', new AbortController().signal)
    .then(
      (result) => {
        outcome = result
      },
      (error: unknown) => {
        outcome = String(error)
      },
    )
  try {
    await fixture.started
    await flushNative()

    // Act
    context.mock.timers.tick(REPLAY_DEBUG_CAPTURE_TIMEOUT_MS - 1)
    await flushNative()
    const beforeDeadline = outcome
    context.mock.timers.tick(1)
    await showing

    // Assert
    assert.equal(beforeDeadline, 'pending')
    assert.match(outcome, /Historical debugger closed/)
    assert.equal(fixture.owner.available, false)
    assert.equal(fixture.changes(), 1)
  } finally {
    context.mock.timers.reset()
    await fixture.owner.dispose()
  }
})

// Value: protects=replay after a healthy but slow historical-debugger startup; fails_when=the late session is stopped and replay fails until the learner reopens the recording; why_new=Cycle 0044 (0033-F2e2 / 0034-OOS1); seam=none
test('a healthy startup slower than the capture timeout is adopted when it completes, so the next stop presents without reopening the replay', async (context) => {
  // Arrange
  context.mock.timers.enable({ apis: ['setTimeout'] })
  let releaseStart = (): void => {}
  const startGate = new Promise<void>((resolve) => {
    releaseStart = resolve
  })
  const fixture = harness(startGate)
  const showing = fixture.owner
    .present(inspectedSnapshot, 'Recorded pause', new AbortController().signal)
    .catch((error: unknown) => String(error))
  try {
    await fixture.started
    await flushNative()
    context.mock.timers.tick(REPLAY_DEBUG_CAPTURE_TIMEOUT_MS)
    const outcome = await showing

    // Act
    releaseStart()
    await flushNative()
    const next = await fixture.owner.present(
      inspectedSnapshot,
      'Next recorded pause',
      new AbortController().signal,
    )

    // Assert
    assert.match(outcome, /Historical debugger closed/)
    assert.equal(fixture.owner.available, true)
    assert.equal(next, 'inspected')
    assert.deepEqual(fixture.stopped, [])
    assert.equal(fixture.startCalls(), 1)
  } finally {
    context.mock.timers.reset()
    await fixture.owner.dispose()
  }
})

// Value: protects=replay after a startup in which the editor asked for the historical adapter only after the capture timeout; fails_when=the descriptor factory refuses its own expired launch as a detached owner's, so the late session never starts and replay fails until the learner reopens the recording; why_new=Cycle 0045 A-L3 (the adoption covered only a descriptor requested before the bound expired, and its comment promised both); seam=none
test('a startup whose adapter the editor asks for only after the capture timeout is adopted when it completes, so the next stop presents without reopening the replay', async (context) => {
  // Arrange: the editor accepted the launch and has not asked for its adapter when the capture timeout passes.
  context.mock.timers.enable({ apis: ['setTimeout'] })
  let requestAdapter = (): void => {}
  const descriptorGate = new Promise<void>((resolve) => {
    requestAdapter = resolve
  })
  const fixture = harness(
    undefined,
    undefined,
    0,
    false,
    false,
    undefined,
    undefined,
    undefined,
    undefined,
    descriptorGate,
  )
  const showing = fixture.owner
    .present(inspectedSnapshot, 'Recorded pause', new AbortController().signal)
    .catch((error: unknown) => String(error))
  try {
    await fixture.started
    await flushNative()
    context.mock.timers.tick(REPLAY_DEBUG_CAPTURE_TIMEOUT_MS)
    const outcome = await showing
    const availableAfterTimeout = fixture.owner.available

    // Act: the editor asks for the adapter and finishes the launch.
    requestAdapter()
    await flushNative()
    const next = await fixture.owner.present(
      inspectedSnapshot,
      'Next recorded pause',
      new AbortController().signal,
    )

    // Assert
    assert.equal(
      outcome,
      'Error: Historical debugger closed. Reopen the learning replay to restore it.',
    )
    assert.equal(availableAfterTimeout, false)
    assert.equal(fixture.owner.available, true)
    assert.equal(next, 'inspected')
    assert.deepEqual(fixture.stopped, [])
    assert.equal(fixture.startCalls(), 1)
  } finally {
    context.mock.timers.reset()
    await fixture.owner.dispose()
  }
})

// Value: protects=the playback queue when the editor never finishes stopping the old stop's session; fails_when=retire() awaits the shared retirement without the presentation signal; why_new=Cycle 0033 L2; seam=none
test('a presentation cancelled while the old stop is still retiring leaves at once with its own reason', async () => {
  // Arrange
  let releaseTermination = (): void => {}
  const fixture = harness(
    undefined,
    new Promise<void>((resolve) => {
      releaseTermination = resolve
    }),
  )
  await fixture.owner.present(
    firstSnapshot,
    'First recorded stop',
    new AbortController().signal,
  )
  const cancelled = new AbortController()
  try {
    fixture.owner.invalidate()
    const retiring = fixture.owner
      .retire(undefined, cancelled.signal)
      .catch((error: unknown) => String(error))
    await fixture.stopRequested

    // Act
    cancelled.abort(new Error('Playback presentation superseded'))
    const outcome = await Promise.race([
      retiring,
      delay(POLL_INTERVAL_MS * 4, 'still waiting for native termination'),
    ])

    // Assert
    assert.equal(outcome, 'Error: Playback presentation superseded')
  } finally {
    releaseTermination()
    await fixture.owner.dispose()
  }
})

// Value: protects=later presentations when the editor never finishes stopping the old stop's session; fails_when=the shared retirement has no bound; why_new=Cycle 0033 L2; seam=none
test('a retirement the editor never finishes makes later presentations fail with the closed-debugger error after the capture timeout', async (context) => {
  // Arrange
  context.mock.timers.enable({ apis: ['setTimeout'] })
  let releaseTermination = (): void => {}
  const fixture = harness(
    undefined,
    new Promise<void>((resolve) => {
      releaseTermination = resolve
    }),
  )
  await fixture.owner.present(
    firstSnapshot,
    'First recorded stop',
    new AbortController().signal,
  )
  fixture.owner.invalidate()
  let outcome = 'pending'
  const retiring = fixture.owner
    .retire(undefined, new AbortController().signal)
    .then(
      () => {
        outcome = 'retired'
      },
      (error: unknown) => {
        outcome = String(error)
      },
    )
  try {
    await fixture.stopRequested
    await flushNative()

    // Act
    context.mock.timers.tick(REPLAY_DEBUG_CAPTURE_TIMEOUT_MS - 1)
    await flushNative()
    const beforeDeadline = outcome
    context.mock.timers.tick(1)
    await retiring

    // Assert
    assert.equal(beforeDeadline, 'pending')
    assert.match(outcome, /Historical debugger closed/)
    assert.equal(fixture.owner.available, false)
    await assert.rejects(
      fixture.owner.present(
        undefined,
        'Second recorded stop',
        new AbortController().signal,
      ),
      /Historical debugger closed/,
    )
  } finally {
    context.mock.timers.reset()
    releaseTermination()
    await fixture.owner.dispose()
  }
})

// Value: protects=an expired retirement staying unavailable when the editor finally reports termination; fails_when=the termination handler re-attaches the owner because the retiring session id survived expiry; why_new=Cycle 0033 O3 (Codex outside voice); seam=none
// Value: protects=no recorded session left alive after a retirement outlived its bound; fails_when=the expired owner never asks the editor again and the session stays until an explicit reopen; why_new=Cycle 0044 (0033-F2d / 0034-OOS2); seam=none
test('a retirement that outlives the capture timeout asks the editor once more to stop the session still showing history', async (context) => {
  // Arrange
  context.mock.timers.enable({ apis: ['setTimeout'] })
  let releaseTermination = (): void => {}
  const fixture = harness(
    undefined,
    new Promise<void>((resolve) => {
      releaseTermination = resolve
    }),
  )
  await fixture.owner.present(
    firstSnapshot,
    'First recorded stop',
    new AbortController().signal,
  )
  fixture.owner.invalidate()
  const retiring = fixture.owner
    .retire(undefined, new AbortController().signal)
    .catch((error: unknown) => String(error))
  try {
    await fixture.stopRequested
    await flushNative()
    const stopsBeforeExpiry = [...fixture.stopped]

    // Act
    context.mock.timers.tick(REPLAY_DEBUG_CAPTURE_TIMEOUT_MS)
    await retiring
    await flushNative()

    // Assert
    assert.deepEqual(stopsBeforeExpiry, ['historical-owned'])
    assert.deepEqual(fixture.stopped, ['historical-owned', 'historical-owned'])
    assert.equal(fixture.owner.available, false)
  } finally {
    context.mock.timers.reset()
    releaseTermination()
    await fixture.owner.dispose()
  }
})

test('a termination that arrives after the retirement bound expired leaves the historical debugger unavailable', async (context) => {
  // Arrange
  context.mock.timers.enable({ apis: ['setTimeout'] })
  let releaseTermination = (): void => {}
  const terminationGate = new Promise<void>((resolve) => {
    releaseTermination = resolve
  })
  const fixture = harness(undefined, terminationGate)
  await fixture.owner.present(
    firstSnapshot,
    'First recorded stop',
    new AbortController().signal,
  )
  fixture.owner.invalidate()
  const retiring = fixture.owner
    .retire(undefined, new AbortController().signal)
    .catch((error: unknown) => String(error))
  try {
    await fixture.stopRequested
    await flushNative()
    context.mock.timers.tick(REPLAY_DEBUG_CAPTURE_TIMEOUT_MS)
    await retiring

    // Act
    releaseTermination()
    await flushNative()

    // Assert
    assert.equal(fixture.owner.available, false)
    await assert.rejects(
      fixture.owner.present(
        undefined,
        'Second recorded stop',
        new AbortController().signal,
      ),
      /Historical debugger closed/,
    )
  } finally {
    context.mock.timers.reset()
    await fixture.owner.dispose()
  }
})

// Value: protects=closing the reader and replacing an unavailable debugger when the editor never acknowledges the stop; fails_when=dispose() awaits stopDebugging without a bound; why_new=Cycle 0033 A1; seam=none
test('closing the historical debugger completes after the capture timeout when the editor never acknowledges the stop, and asks the editor to stop once more', async (context) => {
  // Arrange
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const fixture = harness(undefined, new Promise<void>(() => {}))
  await fixture.owner.present(
    undefined,
    'Not recorded at this moment',
    new AbortController().signal,
  )
  let closed = false
  // Act
  const closing = fixture.owner.dispose().then(() => {
    closed = true
  })
  await fixture.stopRequested
  await flushNative()
  context.mock.timers.tick(REPLAY_DEBUG_CAPTURE_TIMEOUT_MS - 1)
  await flushNative()
  const beforeDeadline = closed
  context.mock.timers.tick(1)
  await closing
  context.mock.timers.reset()

  // Assert
  assert.equal(beforeDeadline, false)
  assert.equal(closed, true)
  assert.deepEqual(fixture.stopped, ['historical-owned', 'historical-owned'])
})

// Value: protects=the 1 s grace when the wall clock jumps backward before a later presentation waits on the same stop; fails_when=the grace delay is computed from Date without a nominal cap; why_new=Cycle 0033 M1 (e); seam=node:test Date mock
test('a backward wall-clock jump cannot stretch the grace for a stop whose values Run and Debug never loads', async (context) => {
  // Arrange
  context.mock.timers.enable({
    apis: ['setTimeout', 'Date'],
    now: 10_000_000,
  })
  const fixture = harness(undefined, undefined, 0, false, true),
    abandoned = new AbortController()
  const first = fixture.owner
    .present(inspectedSnapshot, 'Recorded pause', abandoned.signal)
    .catch((error: unknown) => String(error))
  let outcome = 'pending'
  try {
    await fixture.started
    await flushNative()
    abandoned.abort(new Error('Playback presentation superseded'))
    await first

    // Act
    context.mock.timers.setTime(10_000_000 - 3_600_000)
    const again = fixture.owner
      .present(
        inspectedSnapshot,
        'Recorded pause',
        new AbortController().signal,
      )
      .then(
        (result) => {
          outcome = result
        },
        (error: unknown) => {
          outcome = String(error)
        },
      )
    await flushNative()
    context.mock.timers.tick(REPLAY_DEBUG_INSPECTION_GRACE_MS)
    await flushNative()

    // Assert
    assert.equal(outcome, 'uninspected')
    await again
  } finally {
    context.mock.timers.reset()
    await fixture.owner.dispose()
  }
})

// Value: protects=a stop whose only Variables group is the synthetic Recording limitations note committing at once; fails_when=hasLoadableValues counts the synthetic scope and the stop waits for a grace that cannot load recorded values; why_new=Cycle 0033 M1 (a); seam=none
test('a stop whose only Variables group is the recording limitations note commits at once without waiting for Run and Debug', async () => {
  // Arrange
  const fixture = harness(undefined, undefined, 0, false, true)
  const limitedSnapshot: ReplayDebugSnapshot = {
    version: 1,
    frames: [
      {
        name: 'LoginButton',
        line: 90,
        column: 5,
        scopes: [],
        unavailable: 'Scopes were not captured at this stop.',
      },
    ],
    variables: [],
    limitations: [],
  }
  try {
    // Act
    const outcome = await Promise.race([
      fixture.owner.present(
        limitedSnapshot,
        'Recorded pause',
        new AbortController().signal,
      ),
      delay(POLL_INTERVAL_MS * 4, 'still waiting for Run and Debug'),
    ])

    // Assert
    assert.equal(outcome, 'no-values')
  } finally {
    await fixture.owner.dispose()
  }
})

// Value: protects=a stop presented into an adapter the editor already disposed failing closed instead of committing as "no values"; fails_when=present() treats a disposed adapter's empty state as a gap; why_new=Cycle 0033 M1 (g); seam=none
test('a stop presented after the editor disposed the historical adapter fails closed instead of committing without values', async () => {
  // Arrange
  const fixture = harness()
  await fixture.owner.present(
    firstSnapshot,
    'First recorded stop',
    new AbortController().signal,
  )
  try {
    fixture.disposeAdapter()

    // Act
    const outcome = await fixture.owner
      .present(
        inspectedSnapshot,
        'Second recorded stop',
        new AbortController().signal,
      )
      .catch((error: unknown) => String(error))

    // Assert
    assert.match(outcome, /Historical debugger closed/)
  } finally {
    await fixture.owner.dispose()
  }
})

// Value: protects=the 5 s capture deadline when the wall clock jumps backward before a later presentation waits on a stop Run and Debug was never told about; fails_when=the stopped-event deadline is computed from Date without its nominal cap; why_new=Cycle 0033 C2 clamps two delays and only the 1 s grace had a test; seam=none
test('a backward wall-clock jump cannot stretch the capture deadline for a stop Run and Debug is never told about', async (context) => {
  // Arrange
  context.mock.timers.enable({
    apis: ['setTimeout', 'Date'],
    now: 10_000_000,
  })
  const fixture = harness(
      undefined,
      undefined,
      0,
      false,
      true,
      new Promise<void>(() => {}),
    ),
    abandoned = new AbortController()
  const first = fixture.owner
    .present(inspectedSnapshot, 'Recorded pause', abandoned.signal)
    .catch((error: unknown) => String(error))
  let outcome = 'pending'
  try {
    await fixture.started
    await flushNative()
    abandoned.abort(new Error('Playback presentation superseded'))
    await first

    // Act
    context.mock.timers.setTime(10_000_000 - 3_600_000)
    const again = fixture.owner
      .present(
        inspectedSnapshot,
        'Recorded pause',
        new AbortController().signal,
      )
      .then(
        (result) => {
          outcome = result
        },
        (error: unknown) => {
          outcome = String(error)
        },
      )
    await flushNative()
    context.mock.timers.tick(REPLAY_DEBUG_CAPTURE_TIMEOUT_MS - 1)
    await flushNative()
    const beforeDeadline = outcome
    context.mock.timers.tick(1)
    await flushNative()

    // Assert
    assert.equal(beforeDeadline, 'pending')
    assert.equal(outcome, 'uninspected')
    await again
  } finally {
    context.mock.timers.reset()
    await fixture.owner.dispose()
  }
})

// Value: protects=an expired retirement staying unavailable when the editor disconnected the adapter first; fails_when=expire() returns early for a detached owner and the retiring session id survives; why_new=Cycle 0034 E1 (the O3 test has no disconnect before the bound); seam=none
test('a termination that arrives after the retirement bound expired leaves the historical debugger unavailable when the editor had disconnected the adapter first', async (context) => {
  // Arrange
  context.mock.timers.enable({ apis: ['setTimeout'] })
  let releaseTermination = (): void => {}
  const fixture = harness(
    undefined,
    new Promise<void>((resolve) => {
      releaseTermination = resolve
    }),
    0,
    true,
  )
  await fixture.owner.present(
    firstSnapshot,
    'First recorded stop',
    new AbortController().signal,
  )
  fixture.owner.invalidate()
  const retiring = fixture.owner
    .retire(undefined, new AbortController().signal)
    .then(
      () => 'retired',
      (error: unknown) => String(error),
    )
  try {
    await fixture.stopRequested
    await flushNative()
    context.mock.timers.tick(REPLAY_DEBUG_CAPTURE_TIMEOUT_MS)
    const outcome = await retiring

    // Act
    releaseTermination()
    await flushNative()

    // Assert
    assert.match(outcome, /Historical debugger closed/)
    assert.equal(fixture.owner.available, false)
  } finally {
    context.mock.timers.reset()
    releaseTermination()
    await fixture.owner.dispose()
  }
})

// Value: protects=the reader learning that the session is gone when the editor never reports termination; fails_when=expiry notifies only an owner that was still available; why_new=Cycle 0034 E1 (plan review P1); seam=none
test('a retirement bound that expires after the editor disconnected the adapter notifies the reader even when no termination follows', async (context) => {
  // Arrange
  context.mock.timers.enable({ apis: ['setTimeout'] })
  let releaseTermination = (): void => {}
  const fixture = harness(
    undefined,
    new Promise<void>((resolve) => {
      releaseTermination = resolve
    }),
    0,
    true,
  )
  await fixture.owner.present(
    firstSnapshot,
    'First recorded stop',
    new AbortController().signal,
  )
  fixture.owner.invalidate()
  const retiring = fixture.owner
    .retire(undefined, new AbortController().signal)
    .catch((error: unknown) => String(error))
  try {
    await fixture.stopRequested
    await flushNative()
    const notifiedBeforeExpiry = fixture.changes()

    // Act
    context.mock.timers.tick(REPLAY_DEBUG_CAPTURE_TIMEOUT_MS)
    await retiring

    // Assert
    assert.equal(notifiedBeforeExpiry, 0)
    assert.equal(fixture.changes(), 1)
  } finally {
    context.mock.timers.reset()
    releaseTermination()
    await fixture.owner.dispose()
  }
})

// Value: protects=an owner that gave up on its startup staying unavailable; fails_when=a retirement waiting for that startup registers the late session and its termination re-attaches the owner; why_new=Cycle 0034 E2; seam=none
test('a retirement that was waiting for a startup which then expired leaves the historical debugger unavailable', async (context) => {
  // Arrange
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const fixture = harness(new Promise<void>(() => {})),
    abandoned = new AbortController()
  const first = fixture.owner
    .present(inspectedSnapshot, 'First recorded stop', abandoned.signal)
    .catch((error: unknown) => String(error))
  try {
    await fixture.started
    await flushNative()
    abandoned.abort(new Error('Playback presentation superseded'))
    await first
    const retiring = fixture.owner
      .retire(firstSnapshot, new AbortController().signal)
      .then(
        () => 'retired',
        (error: unknown) => String(error),
      )
    await flushNative()

    // Act
    context.mock.timers.tick(REPLAY_DEBUG_CAPTURE_TIMEOUT_MS)
    const outcome = await retiring
    await flushNative()

    // Assert
    assert.match(outcome, /Historical debugger closed/)
    assert.equal(fixture.owner.available, false)
  } finally {
    context.mock.timers.reset()
    await fixture.owner.dispose()
  }
})

// Value: protects=presentations failing at the bound when the reader's listener throws; fails_when=the waiters are rejected only after expire() returns; why_new=Cycle 0034 E3; seam=none
test('a reader listener that throws when the startup bound expires still lets the waiting presentation fail with the closed-debugger error', async (context) => {
  // Arrange
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const reported: string[] = []
  const fixture = harness(
    undefined,
    undefined,
    1,
    false,
    false,
    undefined,
    new Promise<void>(() => {}),
    {
      changed: () => {
        throw new Error('reader publish failed')
      },
      failed: (error) => reported.push(String(error)),
    },
  )
  let outcome = 'pending'
  void fixture.owner
    .present(inspectedSnapshot, 'Recorded pause', new AbortController().signal)
    .then(
      (result) => {
        outcome = result
      },
      (error: unknown) => {
        outcome = String(error)
      },
    )
  try {
    await fixture.started
    await flushNative()

    // Act
    try {
      context.mock.timers.tick(REPLAY_DEBUG_CAPTURE_TIMEOUT_MS)
    } catch {
      // Without the fix the listener's error escapes the expiry timer.
    }
    await flushNative()

    // Assert
    assert.match(outcome, /Historical debugger closed/)
    assert.deepEqual(reported, ['Error: reader publish failed'])
  } finally {
    context.mock.timers.reset()
    await fixture.owner.dispose()
  }
})

// Value: protects=the explicit reopen replacing an owner whose adapter the editor disposed; fails_when=the owner still reports itself available after failing closed; why_new=Cycle 0034 E4 (the M1 (g) test asserts only the error); seam=none
test('a stop presented after the editor disposed the historical adapter makes the historical debugger unavailable and notifies the reader', async () => {
  // Arrange
  const fixture = harness()
  await fixture.owner.present(
    firstSnapshot,
    'First recorded stop',
    new AbortController().signal,
  )
  try {
    fixture.disposeAdapter()

    // Act
    await fixture.owner
      .present(
        inspectedSnapshot,
        'Second recorded stop',
        new AbortController().signal,
      )
      .catch(() => {})

    // Assert
    assert.equal(fixture.owner.available, false)
    assert.equal(fixture.changes(), 1)
  } finally {
    await fixture.owner.dispose()
  }
})

// Value: protects=a healthy owner when a seek arrives during a slow cold start; fails_when=the retirement bound starts before the pending startup settled; why_new=Cycle 0034 E5 (L2 tests have no pending startup); seam=none
test('a retirement requested during a 4 s startup whose stop then takes 2 s keeps the historical debugger available', async (context) => {
  // Arrange
  context.mock.timers.enable({ apis: ['setTimeout'] })
  let releaseStart = (): void => {},
    releaseTermination = (): void => {}
  const fixture = harness(
      new Promise<void>((resolve) => {
        releaseStart = resolve
      }),
      new Promise<void>((resolve) => {
        releaseTermination = resolve
      }),
    ),
    abandoned = new AbortController()
  const first = fixture.owner
    .present(inspectedSnapshot, 'First recorded stop', abandoned.signal)
    .catch((error: unknown) => String(error))
  let outcome = 'pending'
  try {
    await fixture.started
    await flushNative()
    abandoned.abort(new Error('Playback presentation superseded'))
    await first
    const retiring = fixture.owner
      .retire(firstSnapshot, new AbortController().signal)
      .then(
        () => {
          outcome = 'retired'
        },
        (error: unknown) => {
          outcome = String(error)
        },
      )
    await flushNative()

    // Act
    context.mock.timers.tick(4_000)
    releaseStart()
    await fixture.stopRequested
    await flushNative()
    context.mock.timers.tick(2_000)
    releaseTermination()
    await flushNative()
    await retiring

    // Assert
    assert.equal(outcome, 'retired')
    assert.equal(fixture.owner.available, true)
    assert.deepEqual(fixture.stopped, ['historical-owned'])
  } finally {
    context.mock.timers.reset()
    releaseStart()
    releaseTermination()
    await fixture.owner.dispose()
  }
})

// Value: protects=the 5 s retirement bound counted from the end of a pending startup; fails_when=the bound still starts at retire() or is lost; why_new=Cycle 0034 E5; seam=none
test('a stop the editor never answers after a 4 s startup fails the retirement 5 s after that startup settled', async (context) => {
  // Arrange
  context.mock.timers.enable({ apis: ['setTimeout'] })
  let releaseStart = (): void => {},
    releaseTermination = (): void => {}
  const fixture = harness(
      new Promise<void>((resolve) => {
        releaseStart = resolve
      }),
      new Promise<void>((resolve) => {
        releaseTermination = resolve
      }),
    ),
    abandoned = new AbortController()
  const first = fixture.owner
    .present(inspectedSnapshot, 'First recorded stop', abandoned.signal)
    .catch((error: unknown) => String(error))
  let outcome = 'pending'
  try {
    await fixture.started
    await flushNative()
    abandoned.abort(new Error('Playback presentation superseded'))
    await first
    const retiring = fixture.owner
      .retire(firstSnapshot, new AbortController().signal)
      .then(
        () => {
          outcome = 'retired'
        },
        (error: unknown) => {
          outcome = String(error)
        },
      )
    await flushNative()
    context.mock.timers.tick(4_000)
    releaseStart()
    await fixture.stopRequested
    await flushNative()

    // Act
    context.mock.timers.tick(REPLAY_DEBUG_CAPTURE_TIMEOUT_MS - 1)
    await flushNative()
    const beforeDeadline = outcome
    context.mock.timers.tick(1)
    await retiring

    // Assert
    assert.equal(beforeDeadline, 'pending')
    assert.match(outcome, /Historical debugger closed/)
    assert.equal(fixture.owner.available, false)
  } finally {
    context.mock.timers.reset()
    releaseStart()
    releaseTermination()
    await fixture.owner.dispose()
  }
})

// Value: protects=waiting presentations when the reader's listener and its error channel both fail as the startup bound expires; fails_when=the rejection runs only if the give-up call returns; why_new=Cycle 0035 H3 (Cycle 0034 E3 covers a listener that throws while the error channel works); seam=none
test('a waiting presentation still fails with the closed-debugger error when the reader listener and its error channel both throw as the startup bound expires', async (context) => {
  // Arrange
  context.mock.timers.enable({ apis: ['setTimeout'] })
  let releaseStartup = (): void => {}
  // Released only in cleanup, so dispose cannot hang on the startup when the give-up regresses and the assertion fails instead.
  const startupGate = new Promise<void>((resolve) => {
    releaseStartup = resolve
  })
  const fixture = harness(
    undefined,
    undefined,
    1,
    false,
    false,
    undefined,
    startupGate,
    {
      changed: () => {
        throw new Error('reader publish failed')
      },
      failed: () => {
        throw new Error('reader error channel failed')
      },
    },
  )
  let outcome = 'pending'
  void fixture.owner
    .present(inspectedSnapshot, 'Recorded pause', new AbortController().signal)
    .then(
      (result) => {
        outcome = result
      },
      (error: unknown) => {
        outcome = String(error)
      },
    )
  try {
    await fixture.started
    await flushNative()

    // Act
    try {
      context.mock.timers.tick(REPLAY_DEBUG_CAPTURE_TIMEOUT_MS)
    } catch {
      // Without the fix the error channel's own error escapes the expiry timer.
    }
    await flushNative()

    // Assert
    assert.match(outcome, /Historical debugger closed/)
    assert.equal(fixture.owner.available, false)
  } finally {
    context.mock.timers.reset()
    releaseStartup()
    await fixture.owner.dispose()
  }
})

// Value: protects=the reopen message for a stop presented on an adapter the editor disposed, when the reader's listener and its error channel both fail; fails_when=the presentation rejects with the error channel's own error instead of the closed-debugger error; why_new=Cycle 0035 H3 (the disposed-adapter give-up had no failing-listener test); seam=none
test('a stop presented after the editor disposed the historical adapter still fails with the closed-debugger error when the reader listener and its error channel both throw', async () => {
  // Arrange
  let readerFailing = false
  const fixture = harness(
    undefined,
    undefined,
    0,
    false,
    false,
    undefined,
    undefined,
    {
      changed: () => {
        if (readerFailing) throw new Error('reader publish failed')
      },
      failed: () => {
        throw new Error('reader error channel failed')
      },
    },
  )
  await fixture.owner.present(
    firstSnapshot,
    'First recorded stop',
    new AbortController().signal,
  )
  try {
    fixture.disposeAdapter()
    readerFailing = true

    // Act
    const outcome = await fixture.owner
      .present(
        inspectedSnapshot,
        'Second recorded stop',
        new AbortController().signal,
      )
      .catch((error: unknown) => String(error))

    // Assert
    assert.match(outcome, /Historical debugger closed/)
    assert.equal(fixture.owner.available, false)
  } finally {
    readerFailing = false
    await fixture.owner.dispose()
  }
})

// Value: protects=the editor's DAP stream and event loop when the reader's listener and its error channel both fail outside the give-up path; fails_when=the values-loaded notification or the session-ended handler lets the error channel's own error escape; why_new=Cycle 0035 R09 (only giveUp() guarded the double fault); seam=none
test('a reader listener and error channel that both throw when Run and Debug loads values or the historical session ends let no error escape into the editor', async () => {
  // Arrange: the first stop commits without values, so a later inspection reports values-loaded.
  let readerFailing = false
  const fixture = harness(
    undefined,
    undefined,
    0,
    false,
    true,
    undefined,
    undefined,
    {
      changed: () => {
        if (readerFailing) throw new Error('reader publish failed')
      },
      failed: () => {
        throw new Error('reader error channel failed')
      },
    },
  )
  const escapedError = (notify: () => void): string => {
    try {
      notify()
      return 'none'
    } catch (error) {
      return String(error)
    }
  }
  try {
    const committed = await fixture.owner.present(
      inspectedSnapshot,
      'Recorded pause',
      new AbortController().signal,
    )
    readerFailing = true

    // Act: the reader is told about the loaded values one paint allowance later, from a timer nothing may escape from either.
    const escapedOnValuesLoaded = escapedError(() => fixture.inspect())
    await delay(REPLAY_DEBUG_VALUES_PAINT_ALLOWANCE_MS + POLL_INTERVAL_MS)
    const escapedOnSessionEnded = escapedError(() => fixture.terminate())

    // Assert
    assert.equal(committed, 'uninspected')
    assert.equal(escapedOnValuesLoaded, 'none')
    assert.equal(escapedOnSessionEnded, 'none')
    assert.equal(fixture.owner.available, false)
  } finally {
    readerFailing = false
    await fixture.owner.dispose()
  }
})

// Value: protects=an owner the reader closed while its native startup was still pending; fails_when=the retirement that waited for that startup resolves as retired or stops the session a second time; why_new=Cycle 0035 H5c (Cycle 0034 E2 covers the gave-up arm of the same guard only); seam=none
test('a retirement that was waiting for a startup during which the reader closed fails closed and stops the session only once', async () => {
  // Arrange
  let releaseStartup = (): void => {}
  const startupGate = new Promise<void>((resolve) => {
    releaseStartup = resolve
  })
  const fixture = harness(startupGate),
    abandoned = new AbortController()
  const first = fixture.owner
    .present(inspectedSnapshot, 'First recorded stop', abandoned.signal)
    .catch((error: unknown) => String(error))
  await fixture.started
  abandoned.abort(new Error('Playback presentation superseded'))
  await first
  const retiring = fixture.owner
    .retire(firstSnapshot, new AbortController().signal)
    .then(
      () => 'retired',
      (error: unknown) => String(error),
    )

  // Act
  const closing = fixture.owner.dispose()
  releaseStartup()
  const outcome = await retiring
  await closing

  // Assert: the retirement's own closed guard answers, not the startup's "closed during startup" rejection.
  assert.equal(
    outcome,
    'Error: Historical debugger closed. Reopen the learning replay to restore it.',
  )
  assert.deepEqual(fixture.stopped, ['historical-owned'])
})

// Value: protects=the 2.0 s bound of a Recording press on a paused live run's own recording (0035-O01); fails_when=a recorded stop waits the whole inspection grace although another session's paused frame keeps the Run and Debug focus, so its values can never load during the wait; why_new=native run of 2026-10-04 measured 1.2 to 1.3 s between the shown range and the presented position in three takes; seam=none
test('a recorded stop is shown at once, without its values, while a paused frame of another debug session keeps the Run and Debug focus', async (context) => {
  // Arrange
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  const fixture = harness(
    undefined,
    undefined,
    0,
    false,
    true,
    undefined,
    undefined,
    undefined,
    'live-next-server',
  )
  let outcome = 'pending'

  // Act
  const showing = fixture.owner
    .present(inspectedSnapshot, 'Recorded pause', new AbortController().signal)
    .then((result) => {
      outcome = result
    })
  try {
    await fixture.started
    await flushNative()

    // Assert
    assert.equal(outcome, 'uninspected', 'shown before any timer ran')
    assert.equal(fixture.stopped.length, 0)
  } finally {
    // A presentation that still waits is released, so a failure reports instead of holding the file.
    context.mock.timers.tick(REPLAY_DEBUG_INSPECTION_GRACE_MS)
    await showing
    context.mock.timers.reset()
    await fixture.owner.dispose()
  }
})

// Value: protects=Show Variables acting on a Variables tree that holds the presented stop; fails_when=the wait for native Variables ends before that view asked for the stop's scopes, so list commands run on an empty tree again, or it never ends; why_new=Cycle 0044 (0031-U1 in VS Code 1.140: a hidden Variables view asks for a stop's scopes only 400 ms after it is shown); seam=none
test('a wait for native Variables ends when that view asks for the presented stop scopes, and its values wait ends when the first scope is listed', async () => {
  // Arrange: Variables is hidden, so the stop commits without the native client asking for its scopes.
  const fixture = harness(undefined, undefined, 0, false, true)
  try {
    await fixture.owner.present(
      inspectedSnapshot,
      'Recorded pause',
      new AbortController().signal,
    )
    let scopesOutcome: boolean | 'pending' = 'pending',
      valuesOutcome: boolean | 'pending' = 'pending'
    const scopesWait = fixture.owner
        .awaitRetrieval('scopes', 5_000)
        .then((retrieved) => {
          scopesOutcome = retrieved
        }),
      valuesWait = fixture.owner
        .awaitRetrieval('values', 5_000)
        .then((retrieved) => {
          valuesOutcome = retrieved
        })

    // Act: the shown view refreshes, as native Variables does: threads and stack, then the frame's scopes, then the first scope's values.
    const thread = fixture.request('threads').body.threads[0]
    const frame = fixture.request('stackTrace', { threadId: thread.id }).body
      .stackFrames[0]
    await flushNative()
    const scopesBeforeTheViewAsked = scopesOutcome
    const scope = fixture.request('scopes', { frameId: frame.id }).body
      .scopes[0]
    await scopesWait
    await flushNative()
    const valuesBeforeTheScopeWasListed = valuesOutcome
    fixture.request('variables', {
      variablesReference: scope.variablesReference,
    })
    await valuesWait

    // Assert
    assert.equal(scopesBeforeTheViewAsked, 'pending')
    assert.equal(scopesOutcome, true)
    assert.equal(valuesBeforeTheScopeWasListed, 'pending')
    assert.equal(valuesOutcome, true)
  } finally {
    await fixture.owner.dispose()
  }
})

// Value: protects=Show Variables finishing when Run and Debug shows another session or never opens; fails_when=the wait for native Variables has no bound, so the button's action hangs, or it reports the scopes as retrieved although nobody asked; why_new=Cycle 0044 (0031-U1: the wait must end when the signal never comes); seam=none
test('a wait for native Variables that never asks for the stop ends at its bound without the scopes', async (context) => {
  // Arrange
  const fixture = harness(undefined, undefined, 0, false, true)
  try {
    await fixture.owner.present(
      inspectedSnapshot,
      'Recorded pause',
      new AbortController().signal,
    )
    context.mock.timers.enable({ apis: ['setTimeout'] })
    let outcome: boolean | 'pending' = 'pending'
    const waiting = fixture.owner
      .awaitRetrieval('scopes', 2_000)
      .then((retrieved) => {
        outcome = retrieved
      })

    // Act
    context.mock.timers.tick(1_999)
    await flushNative()
    const beforeTheBound = outcome
    context.mock.timers.tick(1)
    await waiting

    // Assert
    assert.equal(beforeTheBound, 'pending')
    assert.equal(outcome, false)
  } finally {
    context.mock.timers.reset()
    await fixture.owner.dispose()
  }
})

// Value: protects=Show Variables returning at once after the learner stopped the recorded session; fails_when=the wait for native Variables sits out its whole bound on a session that can answer nothing; why_new=Cycle 0044 (0031-U1); seam=none
test('a wait for native Variables ends at once without the scopes when the learner stops the recorded session', async () => {
  // Arrange
  const fixture = harness(undefined, undefined, 0, false, true)
  try {
    await fixture.owner.present(
      inspectedSnapshot,
      'Recorded pause',
      new AbortController().signal,
    )
    const waiting = fixture.owner.awaitRetrieval('scopes', 60_000)

    // Act
    fixture.terminate()
    const outcome = await Promise.race([
      waiting,
      delay(1_000, 'still waiting for native Variables'),
    ])

    // Assert
    assert.equal(outcome, false)
  } finally {
    await fixture.owner.dispose()
  }
})

// Value: protects=a recorded stop deep in library frames committing with its image at once and without a hint for values that do not exist; fails_when=the presentation reads only once, before any Call Stack page was served, whether the stop has values to load, so after the first page moved the inspection frame to a top frame without scopes it waits the whole grace and commits as uninspected or inspected; why_new=Cycle 0045 A-L4; seam=none
test('a stop whose first frame with source lies past the first Call Stack page and whose top frame has no scopes commits as a stop without values once that page is loaded, without waiting the inspection grace', async (context) => {
  // Arrange: twenty library frames without source or scopes lie above the first frame with source, which holds the recorded values.
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  const sourceText = 'const pending = true'
  const deepSourceSnapshot: ReplayDebugSnapshot = {
    version: 1,
    frames: [
      ...Array.from({ length: 20 }, (_unused, index) => ({
        name: `libraryFrame${index}`,
        line: 1,
        column: 1,
        scopes: [],
      })),
      {
        name: 'LoginButton',
        line: 1,
        column: 1,
        source: {
          name: 'app/ui/login-form.tsx',
          text: sourceText,
          hash: sha256(sourceText),
          line: 1,
        },
        scopes: [{ name: 'Local', variables: [0] }],
      },
    ],
    variables: [{ name: 'pending', value: 'true', children: [] }],
    limitations: [],
  }
  const fixture = harness(undefined, undefined, 0, false, true)
  let outcome = 'pending'
  const showing = fixture.owner
    .present(deepSourceSnapshot, 'Recorded pause', new AbortController().signal)
    .then((inspection) => {
      outcome = inspection
    })
  try {
    await fixture.started
    await flushNative()
    const outcomeBeforeCallStack = outcome

    // Act: native Call Stack loads its first page of twenty frames; no timer runs.
    const thread = fixture.request('threads').body.threads[0]
    const firstPage = fixture.request('stackTrace', {
      threadId: thread.id,
      startFrame: 0,
      levels: 20,
    }).body
    await flushNative()

    // Assert
    assert.equal(outcomeBeforeCallStack, 'pending')
    assert.equal(firstPage.stackFrames.length, 20)
    assert.equal(firstPage.totalFrames, 21)
    assert.equal(outcome, 'no-values')
  } finally {
    context.mock.timers.tick(REPLAY_DEBUG_CAPTURE_TIMEOUT_MS)
    await showing
    context.mock.timers.reset()
    await fixture.owner.dispose()
  }
})

// Value: protects=Run and Debug telling the truth while a tab the learner opened covers the recorded application; fails_when=the emptied recorded session always reads "Not recorded at this moment", although the moment is recorded and only hidden; why_new=Cycle 0045 NF-31 as DR-19 (opening a workspace file in the application group emptied Run and Debug with that label); seam=none
test('while another tab covers the recorded application Run and Debug says that the recording is covered, not that the moment was not recorded', async () => {
  // Arrange: Run and Debug shows a recorded stop.
  const fixture = harness()
  try {
    await fixture.owner.present(
      inspectedSnapshot,
      'Recorded pause · 0.10 s',
      new AbortController().signal,
    )
    const messagesBefore = fixture.messages.length

    // Act: the reader retires the displayed moment because another tab is in front of the recorded application.
    fixture.owner.invalidate('Recorded application is covered by another tab')

    // Assert: the stop description and the thread name the cover, and no stack of the hidden moment is served.
    const stopDescriptions = fixture.messages
      .slice(messagesBefore)
      .flatMap((message) =>
        'event' in message && message.event === 'stopped'
          ? [message.body.description]
          : [],
      )
    const threads = fixture.request('threads').body.threads
    assert.deepEqual(stopDescriptions, [
      'Recorded application is covered by another tab',
    ])
    assert.deepEqual(
      threads.map((thread: { name: string }) => thread.name),
      ['Recorded application is covered by another tab'],
    )
    assert.deepEqual(
      fixture.request('stackTrace', { threadId: threads[0].id }).body
        .stackFrames,
      [],
    )
  } finally {
    await fixture.owner.dispose()
  }
})

// Value: protects=the recorded values and the reader's dropped hint both reaching the screen after one press of Show Variables; fails_when=the reader is told in the same instant the adapter served the values, so its repaint lands within a few milliseconds of the native view's and, under WSLg, neither is shown until the pointer moves; why_new=Cycle 0044 (0031-U1 in VS Code 1.140 on WSLg: the first scope stayed open and empty and the hint stayed, although the editor held the values); seam=none
test('the reader is told that Run and Debug loaded the values 150 ms after they were served, not in the same instant', async (context) => {
  // Arrange: Variables is hidden, so the stop commits without its values.
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  const fixture = harness(undefined, undefined, 0, false, true)
  const showing = fixture.owner.present(
    inspectedSnapshot,
    'Recorded pause',
    new AbortController().signal,
  )
  try {
    await fixture.started
    await flushNative()
    context.mock.timers.tick(REPLAY_DEBUG_INSPECTION_GRACE_MS)
    const committed = await showing

    // Act: native Variables is shown and retrieves the stop's values.
    fixture.inspect()
    const toldWhenServed = fixture.changes()
    context.mock.timers.tick(149)
    const toldAfter149Ms = fixture.changes()
    context.mock.timers.tick(1)

    // Assert
    assert.equal(committed, 'uninspected')
    assert.equal(toldWhenServed, 0)
    assert.equal(toldAfter149Ms, 0)
    assert.equal(fixture.changes(), 1)
  } finally {
    context.mock.timers.reset()
    await fixture.owner.dispose()
  }
})

// Value: protects=the editor's event loop after the historical debugger was disposed: no notice to the reader waits on a timer of an owner that is gone; fails_when=the values-loaded notice, scheduled 150 ms after the adapter served the values, stays pending through the disposal and keeps the event loop alive for an owner that tells its reader nothing any more; why_new=Cycle 0045 local review coderabbit #4 (the notice's timer handle was not kept), and its pre-landing review PL-29 (row 37 of Cycle 0046): the test counted the pending timers of the whole process, which the timers of earlier tests change; seam=node:test's fake timers, with a record of the timers this test starts and cancels
test('a disposed historical debugger leaves no values-loaded notice waiting on a timer', async (context) => {
  // Arrange: no real time passes, and every timer started or cancelled from here on is recorded.
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  const startedTimers = context.mock.method(globalThis, 'setTimeout'),
    cancelledTimers = context.mock.method(globalThis, 'clearTimeout')
  const fixture = harness(undefined, undefined, 0, false, true)
  const showing = fixture.owner.present(
    inspectedSnapshot,
    'Recorded pause',
    new AbortController().signal,
  )
  try {
    await fixture.started
    await flushNative()
    context.mock.timers.tick(REPLAY_DEBUG_INSPECTION_GRACE_MS)
    await showing
    // The values of the presented stop are served, so the notice to the reader waits for its paint allowance.
    const timersStartedBeforeTheNotice = startedTimers.mock.callCount()
    fixture.inspect()
    const noticeTimers = startedTimers.mock.calls.slice(
      timersStartedBeforeTheNotice,
    )

    // Act
    await fixture.owner.dispose()
    const wasNoticeTimerCancelled = cancelledTimers.mock.calls.some(
      (cancellation) => cancellation.arguments[0] === noticeTimers[0]?.result,
    )
    context.mock.timers.tick(150)

    // Assert: serving the values started one timer, of 150 ms, and the disposal cancelled that very timer; the reader was told of the session's end and of nothing after it.
    assert.deepEqual(
      noticeTimers.map((timer) => timer.arguments[1]),
      [150],
    )
    assert.equal(wasNoticeTimerCancelled, true)
    assert.equal(fixture.changes(), 1)
  } finally {
    // The records come off before the fake timers do, so the real timer functions are back for the next test.
    startedTimers.mock.restore()
    cancelledTimers.mock.restore()
    context.mock.timers.reset()
    await fixture.owner.dispose()
  }
})

// Value: protects=the hint of the stop the reader shows now; fails_when=values served for a stop the recording left within the paint allowance are still reported, so the reader drops the hint of the moment it moved to; why_new=Cycle 0044 (the values-loaded notification is delivered late); seam=none
test('values served for a stop the recording has left by the time the reader would be told are not reported', async (context) => {
  // Arrange
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  const fixture = harness(undefined, undefined, 0, false, true)
  const showing = fixture.owner.present(
    inspectedSnapshot,
    'Recorded pause',
    new AbortController().signal,
  )
  try {
    await fixture.started
    await flushNative()
    context.mock.timers.tick(REPLAY_DEBUG_INSPECTION_GRACE_MS)
    await showing

    // Act: the values are served, and a seek retires the displayed moment before the reader is told.
    fixture.inspect()
    fixture.owner.invalidate()
    context.mock.timers.tick(150)

    // Assert
    assert.equal(fixture.changes(), 0)
  } finally {
    context.mock.timers.reset()
    await fixture.owner.dispose()
  }
})
