import assert from 'node:assert/strict'
import { test } from 'node:test'

import type {
  NodeServerDebugger,
  NodeServerDebuggerPause,
} from '../nodeServerDebugger'

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
