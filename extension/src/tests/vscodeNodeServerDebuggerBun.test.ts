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
