import assert from 'node:assert/strict'
import { test } from 'node:test'

import type {
  NodeServerDebugger,
  NodeServerDebuggerPause,
} from '../nodeServerDebugger'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { defer } from './utils/defer'
import {
  EDITOR_WORKSPACE,
  editorHarness,
  OWNED_IDS,
  STOP_FILE,
} from './utils/nodeServerEditorHarness'

/** The two declared stops: lines 14 and 20 of one file. */
const TWO_STOPS = [
  { line: 14, column: 3 },
  { line: 20, column: 3 },
]

/** The attach input of a Bun launch in the editor harness's workspace. */
const BUN_ATTACH = {
  endpoint: 'ws://127.0.0.1:9229/abc',
  packageRoot: EDITOR_WORKSPACE,
  pid: 4242,
  processGroup: 4242,
  runtime: 'bun',
} as const

/** Copies a value out of the loaded module's realm, so deep equality compares plain data. */
function plain<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value))
}

/** Lets a test await the next pause the debugger reports. */
function nextPauseOf(debug: NodeServerDebugger) {
  let waiting = defer<NodeServerDebuggerPause>()
  debug.subscribe({
    onPause: (pause) => {
      waiting.resolve(pause)
      waiting = defer()
    },
    onResume: () => undefined,
    onEnd: () => undefined,
  })
  return () => waiting.promise
}

// Value: protects=a Bun attach maps Bun's package-root source-map paths (`/src/index.ts`) onto the package root's real path, so the stops bind on the learner's TypeScript lines (probe E1-M2: unmapped or unnormalized paths left stops unbound); fails_when=the Bun attach omits the override, maps another folder, or a node attach gains it; seam=the editor harness's recorded startDebugging configuration; no_claim=js-debug's override matching (the native check covers it)
test('a Bun attach maps Bun source-map paths from the package root, and a node attach does not', async () => {
  // Arrange
  const bunEditor = await editorHarness()
  const nodeEditor = await editorHarness()
  const bun = bunEditor.createDebugger(TWO_STOPS)
  const node = nodeEditor.createDebugger(TWO_STOPS)
  // Act
  await bun.debug.attach({ ...BUN_ATTACH, signal: AbortSignal.timeout(5_000) })
  await node.debug.attach({
    ...BUN_ATTACH,
    runtime: 'node',
    signal: AbortSignal.timeout(5_000),
  })
  // Assert
  assert.deepEqual(
    plain(bunEditor.started[0]?.configuration.sourceMapPathOverrides),
    { '/*': `${EDITOR_WORKSPACE}/*` },
  )
  assert.equal(
    nodeEditor.started[0]?.configuration.sourceMapPathOverrides,
    undefined,
  )
  await bun.debug.release()
  await node.debug.release()
})

// Value: protects=a release without an entry pause (a Bun launch) continues nothing and hands the first stop to the run as a pause, so an owned hit is never swallowed as an entry; fails_when=the release sends a continue, waits for an entry pause that never comes, or drops the stop; seam=the editor harness reporting an owned hit as its first stop; no_claim=Bun's real stop order
test('a release without an entry pause continues nothing and reports the first stop as a pause', async () => {
  // Arrange
  const editor = await editorHarness({
    firstStop: {
      reason: 'breakpoint',
      ids: [OWNED_IDS[0]!],
      frame: { file: STOP_FILE, line: 14 },
    },
  })
  const { debug } = editor.createDebugger(TWO_STOPS)
  await debug.attach({ ...BUN_ATTACH, signal: AbortSignal.timeout(5_000) })
  const nextPause = nextPauseOf(debug)
  await debug.armStops(
    TWO_STOPS.map((stop, index) => ({
      declaredStopIndex: index,
      path: 'src/routes/users.ts',
      file: STOP_FILE,
      line: stop.line,
      column: stop.column,
      hash: 'a'.repeat(64),
      inspections: [],
    })),
    AbortSignal.timeout(5_000),
  )
  // Act
  await debug.releaseEntry(AbortSignal.timeout(5_000), { entryPause: false })
  const first = await nextPause()
  // Assert
  assert.equal(first.declaredStopIndex, 0)
  assert.equal(
    editor.requests.filter((request) => request.command === 'continue').length,
    0,
  )
  await debug.release()
})

// Value: protects=a stop that a Bun target made and ran on before the release (an exception pause during startup the learner continued) is not handed to the run at the release, and the next stop of the same thread is; fails_when=the release re-queues every stop of the session, so the run hears a pause of a thread that is running (Cycle 0152 review finding); seam=the editor harness's startup stop, the adapter's continued event, then an owned hit; no_claim=which startup stops real Bun makes
test('a stop that ran on before a Bun release is not reported at the release, and the next stop is', async () => {
  // Arrange
  const editor = await editorHarness({
    firstStop: { reason: 'exception', frame: { file: STOP_FILE, line: 3 } },
  })
  const { debug } = editor.createDebugger(TWO_STOPS)
  await debug.attach({ ...BUN_ATTACH, signal: AbortSignal.timeout(5_000) })
  const nextPause = nextPauseOf(debug)
  await debug.armStops(
    TWO_STOPS.map((stop, index) => ({
      declaredStopIndex: index,
      path: 'src/routes/users.ts',
      file: STOP_FILE,
      line: stop.line,
      column: stop.column,
      hash: 'a'.repeat(64),
      inspections: [],
    })),
    AbortSignal.timeout(5_000),
  )
  editor.adapter.continued(1, true)
  // Act
  await debug.releaseEntry(AbortSignal.timeout(5_000), { entryPause: false })
  editor.adapter.stop('breakpoint', [OWNED_IDS[1]!], {
    file: STOP_FILE,
    line: 20,
  })
  const first = await nextPause()
  // Assert
  assert.equal(first.declaredStopIndex, 1)
  assert.equal(first.reason, 'breakpoint')
  await debug.release()
})

/** Arms the two declared stops of {@link TWO_STOPS} in the harness's stop file. */
async function armTwoStops(debug: NodeServerDebugger): Promise<void> {
  await debug.armStops(
    TWO_STOPS.map((stop, index) => ({
      declaredStopIndex: index,
      path: 'src/routes/users.ts',
      file: STOP_FILE,
      line: stop.line,
      column: stop.column,
      hash: 'a'.repeat(64),
      inspections: [],
    })),
    AbortSignal.timeout(5_000),
  )
}

// Value: protects=the first hit of a declared stop in a Bun module, which js-debug sends without hit ids (it handles a Bun module's first pause as the module's entry pause and rewrites it as a plain breakpoint), is the declared stop by its place; fails_when=a Bun stop without ids on the armed stop's line is reported as the learner's pause, so the run holds it, captures nothing and ends with PAUSE_HOLD_EXPIRED (Cycle 0152 N0 attempt 1 in VS Code 1.148.0); seam=the editor harness reporting a breakpoint stop with no ids on the declared line; no_claim=js-debug's real event (trace of probe E1-M2 and the N0 run)
test('a Bun breakpoint stop without hit ids on an armed stop line is that declared stop', async () => {
  // Arrange
  const editor = await editorHarness({
    firstStop: { reason: 'breakpoint', frame: { file: STOP_FILE, line: 14 } },
  })
  const { debug } = editor.createDebugger(TWO_STOPS)
  await debug.attach({ ...BUN_ATTACH, signal: AbortSignal.timeout(5_000) })
  const nextPause = nextPauseOf(debug)
  await armTwoStops(debug)
  // Act
  await debug.releaseEntry(AbortSignal.timeout(5_000), { entryPause: false })
  const first = await nextPause()
  // Assert
  assert.equal(first.declaredStopIndex, 0)
  await debug.release()
})

// Value: protects=a Bun stop without hit ids anywhere else (a learner's own breakpoint on another line) stays the learner's pause; fails_when=the judgment by place accepts any breakpoint stop of a Bun run; seam=the editor harness reporting a breakpoint stop with no ids on an unarmed line; no_claim=which lines learners break on
test('a Bun breakpoint stop without hit ids on another line stays the learner pause', async () => {
  // Arrange
  const editor = await editorHarness({
    firstStop: { reason: 'breakpoint', frame: { file: STOP_FILE, line: 30 } },
  })
  const { debug } = editor.createDebugger(TWO_STOPS)
  await debug.attach({ ...BUN_ATTACH, signal: AbortSignal.timeout(5_000) })
  const nextPause = nextPauseOf(debug)
  await armTwoStops(debug)
  // Act
  await debug.releaseEntry(AbortSignal.timeout(5_000), { entryPause: false })
  const first = await nextPause()
  // Assert
  assert.equal(first.declaredStopIndex, undefined)
  await debug.release()
})

// Value: protects=a node run keeps the strict rule: a breakpoint stop without hit ids, even on an armed stop's line, stays the learner's (only Bun's js-debug path drops the ids); fails_when=the judgment by place leaks into node runs, so a learner's own breakpoint at a declared line is taken as Codebook's stop; seam=the editor harness's entry pause, then a breakpoint stop with no ids on the declared line; no_claim=V8's own hit reporting
test('a node breakpoint stop without hit ids on an armed stop line stays the learner pause', async () => {
  // Arrange
  const editor = await editorHarness()
  const { debug } = editor.createDebugger(TWO_STOPS)
  await debug.attach({
    ...BUN_ATTACH,
    runtime: 'node',
    signal: AbortSignal.timeout(5_000),
  })
  const nextPause = nextPauseOf(debug)
  await armTwoStops(debug)
  await debug.releaseEntry(AbortSignal.timeout(5_000))
  // Act
  editor.adapter.stop('breakpoint', undefined, { file: STOP_FILE, line: 14 })
  const first = await nextPause()
  // Assert
  assert.equal(first.declaredStopIndex, undefined)
  await debug.release()
})

/** The stops of one line that holds two declared stops, at columns 3 and 24. */
const SAME_LINE_STOPS = [
  { line: 14, column: 3 },
  { line: 14, column: 24 },
]

/** Arms the given stops in the harness's stop file and returns what arming answered. */
function armStopsAt(
  debug: NodeServerDebugger,
  stops: Array<{ line: number; column: number }>,
  signal: AbortSignal = AbortSignal.timeout(5_000),
) {
  return debug.armStops(
    stops.map((stop, index) => ({
      declaredStopIndex: index,
      path: 'src/routes/users.ts',
      file: STOP_FILE,
      line: stop.line,
      column: stop.column,
      hash: 'a'.repeat(64),
      inspections: [],
    })),
    signal,
  )
}

// Value: protects=an ID-less Bun hit on a line that holds two declared stops is attributed by its column, so the second stop's hit is the second stop; fails_when=the hit goes to the first stop of the line (file and line alone decide), so the run captures the wrong stop; seam=the editor harness reporting an ID-less breakpoint stop at column 24; no_claim=js-debug's real column for a paused frame
test('a Bun breakpoint stop without hit ids at the second column of a shared line is the second declared stop', async () => {
  // Arrange
  const editor = await editorHarness({
    firstStop: {
      reason: 'breakpoint',
      frame: { file: STOP_FILE, line: 14, column: 24 },
    },
  })
  const { debug } = editor.createDebugger(SAME_LINE_STOPS)
  await debug.attach({ ...BUN_ATTACH, signal: AbortSignal.timeout(5_000) })
  const nextPause = nextPauseOf(debug)
  await armStopsAt(debug, SAME_LINE_STOPS)
  // Act
  await debug.releaseEntry(AbortSignal.timeout(5_000), { entryPause: false })
  const first = await nextPause()
  // Assert
  assert.equal(first.declaredStopIndex, 1)
  await debug.release()
})

// Value: protects=an ID-less Bun hit on a shared line at a column that matches neither declared stop stays the learner's pause; fails_when=the hit is guessed as the first stop of the line; seam=the editor harness reporting an ID-less stop at column 10; no_claim=which columns learners break on
test('a Bun breakpoint stop without hit ids at a column matching neither stop of a shared line stays the learner pause', async () => {
  // Arrange
  const editor = await editorHarness({
    firstStop: {
      reason: 'breakpoint',
      frame: { file: STOP_FILE, line: 14, column: 10 },
    },
  })
  const { debug } = editor.createDebugger(SAME_LINE_STOPS)
  await debug.attach({ ...BUN_ATTACH, signal: AbortSignal.timeout(5_000) })
  const nextPause = nextPauseOf(debug)
  await armStopsAt(debug, SAME_LINE_STOPS)
  // Act
  await debug.releaseEntry(AbortSignal.timeout(5_000), { entryPause: false })
  const first = await nextPause()
  // Assert
  assert.equal(first.declaredStopIndex, undefined)
  await debug.release()
})

// Value: protects=a Bun stop whose registration the adapter verified with a line but no column counts as bound at that line; fails_when=a line-only verified reply reads as unbound, so the run refuses a stop that binds; seam=the editor harness answering the registration without a column; no_claim=which editors drop the column
test('a Bun stop verified with a line and no column is armed as bound at that line', async () => {
  // Arrange
  const editor = await editorHarness({
    breakpointReply: (requested, id) => ({
      id,
      verified: true,
      line: requested.line,
    }),
  })
  const { debug } = editor.createDebugger([{ line: 14, column: 3 }])
  await debug.attach({ ...BUN_ATTACH, signal: AbortSignal.timeout(5_000) })
  // Act
  const armed = await armStopsAt(debug, [{ line: 14, column: 3 }])
  // Assert
  assert.equal(armed[0]?.boundLine, 14)
  await debug.release()
})

// Value: protects=a Bun stop whose registration is pending at first and verified before the arming deadline counts as bound; fails_when=a pending reply is asked once and then read as unbound, so a stop that binds a moment later is refused; seam=the editor harness's pending reply and a later breakpoint event; no_claim=how long js-debug takes to verify
test('a Bun stop pending at first and verified before the arming deadline is armed as bound', async () => {
  // Arrange
  let pendingReplies = 0
  const editor = await editorHarness({
    breakpointReply: (_requested, id) => {
      pendingReplies += 1
      return { id, verified: false }
    },
  })
  const { debug } = editor.createDebugger([{ line: 14, column: 3 }])
  await debug.attach({ ...BUN_ATTACH, signal: AbortSignal.timeout(5_000) })
  const arming = armStopsAt(debug, [{ line: 14, column: 3 }])
  // The editor hands its pending reply to the debugger in a microtask after it asked for it, so a poll that sees the reply asked for sees it taken.
  await waitUntil(
    () => pendingReplies > 0,
    'the pending reply to the stop registration',
    5_000,
  )
  // Act
  editor.adapter.breakpointNews({
    id: OWNED_IDS[0]!,
    verified: true,
    line: 14,
    column: 3,
  })
  const armed = await arming
  // Assert
  assert.equal(armed[0]?.boundLine, 14)
  await debug.release()
})

// Value: protects=a Bun stop whose registration never verifies is armed with no bound line once the arming deadline passes, so the run refuses it by name instead of failing the arming; fails_when=the deadline is rethrown as an arming failure, or the stop is reported bound; seam=the editor harness's pending reply and an arming signal that times out after 300 ms; no_claim=the length of the real arming budget
test('a Bun stop whose registration never verifies is armed unbound when the arming deadline passes', async () => {
  // Arrange
  const editor = await editorHarness({
    breakpointReply: (_requested, id) => ({ id, verified: false }),
  })
  const { debug } = editor.createDebugger([{ line: 14, column: 3 }])
  await debug.attach({ ...BUN_ATTACH, signal: AbortSignal.timeout(5_000) })
  // Act
  const armed = await armStopsAt(
    debug,
    [{ line: 14, column: 3 }],
    AbortSignal.timeout(300),
  )
  // Assert
  assert.equal(armed.length, 1)
  assert.equal(armed[0]?.boundLine, undefined)
  await debug.release()
})

// Value: protects=a Bun arming the run itself ended (an exit or a failure aborts the signal with its reason) rejects with that reason instead of reading as an unbound stop; fails_when=any abort is swallowed as a deadline, so a dead run is reported as a refused stop; seam=the editor harness's pending reply and a signal aborted with an Error; no_claim=which events abort the signal
test('a Bun stop arming rejects with the aborting reason when the arming is aborted for another reason than the deadline', async () => {
  // Arrange
  let pendingReplies = 0
  const editor = await editorHarness({
    breakpointReply: (_requested, id) => {
      pendingReplies += 1
      return { id, verified: false }
    },
  })
  const { debug } = editor.createDebugger([{ line: 14, column: 3 }])
  await debug.attach({ ...BUN_ATTACH, signal: AbortSignal.timeout(5_000) })
  const controller = new AbortController()
  const arming = armStopsAt(debug, [{ line: 14, column: 3 }], controller.signal)
  const rejection = assert.rejects(arming, { message: 'run stopped' })
  await waitUntil(
    () => pendingReplies > 0,
    'the pending reply to the stop registration',
    5_000,
  )
  // The arming polls for the acknowledgement once more, then waits for the verification; let it reach that wait so the abort ends the wait itself. Nothing outside the debugger shows that moment: on a slower machine the abort can end the earlier poll instead, which rejects with the same reason, so the test never fails falsely; it then only misses this branch.
  await new Promise((resolve) => setTimeout(resolve, 200))
  // Act
  controller.abort(new Error('run stopped'))
  // Assert
  await rejection
  await debug.release()
})

// Value: protects=a Bun stop the adapter withdrew after verifying it is read as unbound by the re-read the run makes before it is prepared; fails_when=the re-read still reports the stop's earlier verified line; seam=the editor harness's unverified breakpoint event after arming; no_claim=when js-debug withdraws a binding
test('a Bun stop withdrawn by the adapter after arming is reported unbound by the re-read', async () => {
  // Arrange
  const editor = await editorHarness()
  const { debug } = editor.createDebugger(TWO_STOPS)
  await debug.attach({ ...BUN_ATTACH, signal: AbortSignal.timeout(5_000) })
  await armTwoStops(debug)
  // Act
  editor.adapter.breakpointNews({ id: OWNED_IDS[0]!, verified: false })
  const current = plain(debug.currentlyBoundStops?.())
  // Assert
  assert.deepEqual(current, [
    { declaredStopIndex: 0 },
    { declaredStopIndex: 1, boundLine: 20 },
  ])
  await debug.release()
})

// Value: protects=a Bun stop whose binding the adapter's news put on another line, without naming a column, is read as unbound by the re-read before the run is prepared, so no request is sent for a stop that left its declared line; fails_when=the re-read keeps the stop's earlier whole position because news without a column on a refused line is ignored; seam=the editor harness's breakpoint event without a column after arming; no_claim=whether js-debug sends news without a column
test('a Bun stop the adapter moves to another line without a column is reported unbound by the re-read', async () => {
  // Arrange
  const editor = await editorHarness()
  const { debug } = editor.createDebugger(TWO_STOPS)
  await debug.attach({ ...BUN_ATTACH, signal: AbortSignal.timeout(5_000) })
  await armTwoStops(debug)
  // Act
  editor.adapter.breakpointNews({ id: OWNED_IDS[0]!, verified: true, line: 15 })
  const current = plain(debug.currentlyBoundStops?.())
  // Assert
  assert.deepEqual(current, [
    { declaredStopIndex: 0 },
    { declaredStopIndex: 1, boundLine: 20 },
  ])
  await debug.release()
})

// Value: protects=the adapter's latest report decides a Bun stop's place: news with a whole position on the declared line, after news without a column moved it away, binds it again; fails_when=the earlier line without a column keeps deciding, so a stop the adapter bound again reads as unbound; seam=two breakpoint events of the editor harness after arming; no_claim=the order in which js-debug sends its news
test('a Bun stop moved away by news without a column is bound again by later news that names its whole place', async () => {
  // Arrange
  const editor = await editorHarness()
  const { debug } = editor.createDebugger(TWO_STOPS)
  await debug.attach({ ...BUN_ATTACH, signal: AbortSignal.timeout(5_000) })
  await armTwoStops(debug)
  editor.adapter.breakpointNews({ id: OWNED_IDS[0]!, verified: true, line: 15 })
  // Act
  editor.adapter.breakpointNews({
    id: OWNED_IDS[0]!,
    verified: true,
    line: 14,
    column: 7,
  })
  const current = plain(debug.currentlyBoundStops?.())
  // Assert
  assert.deepEqual(current, [
    { declaredStopIndex: 0, boundLine: 14 },
    { declaredStopIndex: 1, boundLine: 20 },
  ])
  await debug.release()
})
