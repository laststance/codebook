import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  NodeProcessRun,
  type NodeProcessPreparation,
  type NodeProcessRunOptions,
} from '../nodeProcessRun'
import type { NodeServerExit } from '../utils/launchNodeServer'

import { createManualClock } from './utils/createManualClock'
import {
  FakeNodeServerDebugger,
  WORKSPACE,
  fakeServer,
} from './utils/nodeServerRunHarness'

/** What a test arranges around the core. */
type CoreArrangement = {
  coreOptions?: NodeProcessRunOptions
  armFails?: Error
  /** What the group probe answers. */
  groupGone?: boolean
  /** What the pid probe answers for the leader's id. */
  processGone?: boolean
  /** What the leader's start read answers after launch; the first read (at launch) always answers `start-1`. */
  startAfterLaunch?: string | undefined
  /** Whether the owner's capture window is open; open by default, as a script run's is once released. */
  windowOpen?: boolean
  /** How many declared stops the preparation resolves. */
  stops?: 1 | 2
}

const NATURAL_EXIT: NodeServerExit = { exitCode: 0, signal: null }

/** Builds a core against fakes, the way a script run would: the capture window is always open once released. */
function createCore(arrangement: CoreArrangement = {}) {
  const order: string[] = []
  const events: Array<{ type: string; detail: unknown }> = []
  const clock = createManualClock()
  const signals: Array<[number, string]> = []
  const harnessOptions = { armFails: arrangement.armFails }
  const process = fakeServer(order, harnessOptions, { output: '' })
  let exitFact: NodeServerExit | undefined
  // The fake launcher gains the exit-event getter the real one has.
  const launched = Object.assign(process, {
    exitedEvent: (): NodeServerExit | undefined => exitFact,
  })
  let startReads = 0
  const debuggers: FakeNodeServerDebugger[] = []
  const core: NodeProcessRun = new NodeProcessRun({
    workspace: WORKSPACE,
    runId: 'script-run-1',
    record: (type, detail) => events.push({ type, detail }),
    citedSources: [],
    declaredPort: 0,
    notify: () => undefined,
    options: arrangement.coreOptions,
    hooks: {
      inWindow: () => arrangement.windowOpen ?? true,
      holdLimits: () => undefined,
      releaseLimits: () => undefined,
      onStopAdmitted: () => undefined,
      onProcessOutput: () => undefined,
    },
    dependencies: {
      clock: {
        now: () => clock.now(),
        set: (callback, delayMs) => {
          const id = clock.setTimeout(callback, delayMs)
          return (): void => clock.clearTimeout(id)
        },
      },
      node: { executable: '/usr/bin/node', version: '26.0.0' },
      createDebugger: (input) => {
        const created = new FakeNodeServerDebugger(input, order, harnessOptions)
        debuggers.push(created)
        return created
      },
      launch: async () => {
        order.push('launch')
        return launched
      },
      signalGroup: (group, signal) => {
        order.push(`signal:${signal}`)
        signals.push([group, signal])
      },
      isGroupGone: () => arrangement.groupGone ?? false,
      isProcessGone: () => arrangement.processGone ?? false,
      readProcessStart: async () =>
        startReads++ === 0 ? 'start-1' : arrangement.startAfterLaunch,
      readProcessCwd: async () => undefined,
      readListeningPorts: async () => [],
      rememberProcess: async () => undefined,
      forgetProcess: async () => undefined,
    },
  })
  const stopCount = arrangement.stops ?? 1
  const preparation: NodeProcessPreparation = {
    resolveStops: async () =>
      Array.from({ length: stopCount }, (_, index) => ({
        declaredStopIndex: index,
        path: 'src/script.ts',
        file: `${WORKSPACE}/src/script.ts`,
        line: 3 + index,
        column: 1,
        hash: 'a'.repeat(64),
        inspections: [],
      })),
    resolveLaunch: async () => ({
      packageRoot: WORKSPACE,
      entry: `${WORKSPACE}/script.js`,
      loader: { kind: 'node' },
    }),
    // A script run is prepared as soon as it is released, so a stop it hits is captured.
    afterRelease: async () => core.markPrepared(),
  }
  return {
    core,
    preparation,
    order,
    events,
    signals,
    process: launched,
    get debug(): FakeNodeServerDebugger {
      const [first] = debuggers
      if (!first) throw new Error('The core created no debugger yet.')
      return first
    },
    /** The leader exits by itself: its `exit` event fires while the output pipes stay open (the close fact stays unset). */
    leaderExitsByItself: (): void => {
      exitFact = NATURAL_EXIT
    },
  }
}

/** Lets the core finish the captures that were started (the fake debugger answers in microtasks). */
async function settle(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve))
}

const CONFIRM_FIRST: NodeProcessRunOptions = {
  confirmEverySignalAfterNaturalExit: true,
}

// protects=a group that still holds the launched leader's survivors is ended with SIGKILL after the leader exited by itself; fails_when=the confirmation after a natural exit refuses a group that is still the launched one; no_claim=a real process table (the fakes answer the probes)
test('a script that exited by itself while its child lives has its group killed after the group is confirmed as the launched one', async () => {
  // Arrange
  const arranged = createCore({
    coreOptions: CONFIRM_FIRST,
    groupGone: false,
    processGone: true,
    startAfterLaunch: undefined,
  })
  await arranged.core.prepare(arranged.preparation)
  arranged.debug.learnerPause()
  arranged.leaderExitsByItself()

  // Act
  await arranged.core.stop()

  // Assert
  assert.deepEqual(arranged.signals, [[4242, 'SIGKILL']])
  assert.equal(arranged.core.unsignalledGroup(), undefined)
})

// protects=a group that is gone after the script exited by itself receives no signal and the outcome says so; fails_when=the first release signals a group id nobody holds any more; no_claim=real process groups
test('a script whose group is already gone gets no signal after its natural exit and the stop reports the group as gone', async () => {
  // Arrange
  const arranged = createCore({ coreOptions: CONFIRM_FIRST, groupGone: true })
  await arranged.core.prepare(arranged.preparation)
  arranged.debug.learnerPause()
  arranged.leaderExitsByItself()

  // Act
  await arranged.core.stop()

  // Assert
  assert.deepEqual(arranged.signals, [])
  assert.equal(arranged.core.unsignalledGroup(), 'gone')
  assert.deepEqual(
    arranged.events.filter(
      ({ type }) => type === 'node-server.group-not-signalled',
    ),
    [{ type: 'node-server.group-not-signalled', detail: { reason: 'gone' } }],
  )
})

// protects=a group id that another process holds after the script exited by itself is never signalled; fails_when=the first release signals a reused group id; no_claim=a real reuse of a process-group id (the fake process table says another process has the id)
test('a script whose group id another process holds now gets no signal after its natural exit', async () => {
  // Arrange
  const arranged = createCore({
    coreOptions: CONFIRM_FIRST,
    groupGone: false,
    startAfterLaunch: 'start-of-another-process',
  })
  await arranged.core.prepare(arranged.preparation)
  arranged.debug.learnerPause()
  arranged.leaderExitsByItself()

  // Act
  await arranged.core.stop()

  // Assert
  assert.deepEqual(arranged.signals, [])
  assert.equal(arranged.core.unsignalledGroup(), 'replaced')
})

// protects=a group that cannot be identified after the script's natural exit receives no signal and the stop still completes with the reason reported; fails_when=the stop fails or signals an unidentified group; no_claim=real process probes
test('a script whose group cannot be identified gets no signal after its natural exit and the stop reports it unverifiable', async () => {
  // Arrange
  const arranged = createCore({
    coreOptions: CONFIRM_FIRST,
    groupGone: false,
    processGone: false,
  })
  await arranged.core.prepare(arranged.preparation)
  arranged.debug.learnerPause()
  arranged.leaderExitsByItself()

  // Act
  await arranged.core.stop()

  // Assert
  assert.deepEqual(arranged.signals, [])
  assert.equal(arranged.core.unsignalledGroup(), 'unverifiable')
})

// protects=the launcher's close confirms the group before its first signal when the script exited by itself, and an unidentified group is left alone instead of failing the close; fails_when=the close is told it is a first close, or it throws for an unverifiable group; no_claim=the launcher's own signalling (its tests cover it)
test('the close after a natural exit is told to confirm the group from its first signal and leaves an unidentified group alone', async () => {
  // Arrange
  const arranged = createCore({
    coreOptions: CONFIRM_FIRST,
    processGone: false,
    windowOpen: false,
  })
  await arranged.core.prepare(arranged.preparation)
  arranged.leaderExitsByItself()

  // Act
  await arranged.core.stop()
  const closeOptions = arranged.process.closeOptions[0]
  const verdict = await closeOptions?.confirmGroup?.()

  // Assert
  assert.equal(closeOptions?.retried, true)
  assert.equal(verdict, 'gone')
  assert.equal(arranged.core.unsignalledGroup(), 'unverifiable')
})

// protects=without the option the server's path is unchanged: the first release signals without a confirmation; fails_when=the option's confirmation leaks into the server's default path; no_claim=the option on
test('without the option a first release signals the group even after the leader exited by itself', async () => {
  // Arrange
  const arranged = createCore({ groupGone: false, processGone: false })
  await arranged.core.prepare(arranged.preparation)
  arranged.debug.learnerPause()
  arranged.leaderExitsByItself()

  // Act
  await arranged.core.stop()

  // Assert
  assert.deepEqual(arranged.signals, [[4242, 'SIGKILL']])
  assert.equal(arranged.core.unsignalledGroup(), undefined)
})

// protects=a preparation that fails before the release ends the group with SIGKILL before the debugger lets go or detaches, so the paused script never runs; fails_when=release() or the detach comes before the SIGKILL; no_claim=js-debug timing (the debugger is a fake)
test('a failed preparation of a script kills the group before any debugger release or detach', async () => {
  // Arrange
  const arranged = createCore({
    coreOptions: { killFirstUnlessReleased: true },
    windowOpen: false,
    armFails: new Error('arming failed'),
  })

  // Act
  await assert.rejects(arranged.core.prepare(arranged.preparation))

  // Assert
  const killIndex = arranged.order.indexOf('signal:SIGKILL')
  assert.notEqual(killIndex, -1)
  assert.equal(arranged.order.includes('detach'), false)
  const releaseIndex = arranged.order.indexOf('debugger.release')
  assert.ok(releaseIndex > killIndex, arranged.order.join(', '))
  assert.equal(arranged.order.includes('releaseEntry'), false)
})

// protects=without the option a failed preparation keeps the server's path (detach first, no SIGKILL); fails_when=the script option leaks into the server's default; no_claim=the option on
test('without the option a failed preparation detaches the debugger first as the server run does', async () => {
  // Arrange
  const arranged = createCore({
    windowOpen: false,
    armFails: new Error('arming failed'),
  })

  // Act
  await assert.rejects(arranged.core.prepare(arranged.preparation))

  // Assert
  assert.equal(arranged.order.includes('detach'), true)
  assert.equal(arranged.order.includes('signal:SIGKILL'), false)
})

// protects=the core says which declared stops were captured and that the budget was not spent; fails_when=the accounting drops or reorders a captured stop; no_claim=the server's own view
test('the capture accounting lists the stops captured in hit order while the budget is unspent', async () => {
  // Arrange
  const arranged = createCore({ stops: 2 })
  await arranged.core.prepare(arranged.preparation)

  // Act
  for (const index of [0, 1, 0]) {
    arranged.debug.hit(index)
    await settle()
  }

  // Assert
  assert.deepEqual(arranged.core.captureAccounting(), {
    stopsReached: [0, 1, 0],
    captureBudgetExhausted: false,
  })
})

// protects=a hit beyond the sixteenth capture retires the breakpoints, goes on uncaptured and the accounting says the budget was spent without listing that hit; fails_when=the 17th hit is listed as reached or the flag stays false; no_claim=the history's own flag
test('the capture accounting reports the spent budget after sixteen captures and does not list the seventeenth hit', async () => {
  // Arrange
  const arranged = createCore({ stops: 2 })
  await arranged.core.prepare(arranged.preparation)

  // Act
  for (let hit = 0; hit < 16; hit++) {
    arranged.debug.hit(0)
    await settle()
  }
  arranged.debug.hit(1)
  await settle()

  // Assert
  assert.deepEqual(arranged.core.captureAccounting(), {
    stopsReached: Array.from({ length: 16 }, () => 0),
    captureBudgetExhausted: true,
  })
  assert.equal(arranged.debug.retireCount, 1)
})
