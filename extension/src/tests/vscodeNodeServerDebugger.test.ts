import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import type {
  NodeServerDebugger,
  NodeServerDebuggerPause,
} from '../nodeServerDebugger'
import { codebookStopLedger } from '../runtimeSupport/codebookStopLedger'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { maskLearnerSecretText } from '../utils/maskLearnerSecretText'

import { defer } from './utils/defer'
import {
  EDITOR_WORKSPACE,
  editorHarness,
  LEARNER_BREAKPOINT_ID,
  OWNED_IDS,
  STOP_FILE,
} from './utils/nodeServerEditorHarness'
import { removeTestFolder } from './utils/removeTestFolder'

/** The two declared stops of every test here: lines 14 and 20 of one file. */
const TWO_STOPS = [
  { line: 14, column: 3 },
  { line: 20, column: 3 },
]

/** Copies a value out of the loaded module's realm, so deep equality compares plain data. */
function plain<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value))
}

/** Collects what a debugger reports and lets a test await the next pause. */
function listen(debug: NodeServerDebugger) {
  const pauses: NodeServerDebuggerPause[] = []
  const resumes: number[] = []
  const ends: string[] = []
  let waiting = defer<NodeServerDebuggerPause>()
  debug.subscribe({
    onPause: (pause) => {
      pauses.push(pause)
      waiting.resolve(pause)
      waiting = defer()
    },
    onResume: (token) => resumes.push(token),
    onEnd: (reason) => ends.push(reason),
  })
  return {
    pauses,
    resumes,
    ends,
    nextPause: () => waiting.promise,
  }
}

const ATTACH = {
  endpoint: 'ws://127.0.0.1:9229/abc',
  packageRoot: EDITOR_WORKSPACE,
  pid: 4242,
  processGroup: 4242,
}

// protects=the pwa-node attach carries the run's session name, no continue on attach, source maps and no save; fails_when=a node-test name, another request kind or a save of the learner's files; no_claim=a real pwa-node
test('attaching starts a pwa-node attach named after the run and binds the session by that name', async () => {
  // Arrange
  const editor = await editorHarness()
  const { debug } = editor.createDebugger(TWO_STOPS)
  // Act
  await debug.attach({ ...ATTACH, signal: AbortSignal.timeout(5_000) })
  // Assert
  assert.deepEqual(plain(editor.started[0]?.configuration), {
    name: 'codebook node server run-9',
    type: 'pwa-node',
    request: 'attach',
    websocketAddress: 'ws://127.0.0.1:9229/abc',
    cwd: EDITOR_WORKSPACE,
    restart: false,
    autoAttachChildProcesses: false,
    continueOnAttach: false,
    sourceMaps: true,
    timeout: 45_000,
  })
  assert.deepEqual(plain(editor.started[0]?.options), {
    suppressSaveBeforeStart: true,
  })
  assert.deepEqual(plain(editor.bindings), [
    { name: 'codebook node server run-9', workingDirectory: EDITOR_WORKSPACE },
  ])
  await debug.release()
})

// Value: protects=a node-server or node-script run binds the child session that holds the process, so its first pause is not held for the 20 s answer bound by js-debug's silent attach root; fails_when=the binding loop offers the root first, so the stand-in asks the root `requestCDPProxy` as the real binding does and waits on a request that never answers (the real binding waits its 20 s bound), and the binding does not finish within 2 s, the root received a request, the adopted session is not the child, or the binding comes later than 1 s after the child started; why_new=Cycle 0085: every harness session answered, so the root's silence was never modelled; seam=the editor's session tree (a root whose requestCDPProxy never settles, and the target child started 100 ms later) and a binding stand-in that records the sessions it is offered; no_claim=js-debug's real timing (native checks C85-1 and C85-2)
test('a node-server run binds its target child within a second of the child starting while the attach root never answers', async () => {
  // Arrange
  const editor = await editorHarness({ childStartDelayMs: 100 })
  const { debug } = editor.createDebugger(TWO_STOPS)
  let timer: NodeJS.Timeout | undefined
  const timedOut = new Promise<'timed out'>((resolve) => {
    timer = setTimeout(() => resolve('timed out'), 2_000)
  })
  try {
    // Act
    const boundAt = debug
      .attach({ ...ATTACH, signal: AbortSignal.timeout(5_000) })
      .then(() => Date.now())
    const outcome = await Promise.race([boundAt, timedOut])

    // Assert
    assert.deepEqual(editor.boundSessionIds, ['node-server-session'])
    assert.deepEqual(editor.rootRequests, [])
    assert.equal(typeof outcome, 'number')
    // gstack-timing-ok: the defect this guards waits the 20 s answer bound; the binding takes about 0.1-0.25 s here, so the 1 s bound only tells the two apart and the adopted-session and root-request assertions above carry the outcome
    assert.ok(
      (outcome as number) - editor.childStartedAt()! < 1_000,
      'the binding came 1 s or more after the child started',
    )
  } finally {
    clearTimeout(timer)
    await debug.release()
  }
})

// protects=several owned breakpoints in one file are armed at once and each is acknowledged under its own id; fails_when=the second stop of a file is dropped, mixed up or armed one at a time; no_claim=VS Code's own batching
test('two declared stops in one file are armed together and acknowledged under their own ids', async () => {
  // Arrange
  const editor = await editorHarness()
  const { debug } = editor.createDebugger(TWO_STOPS)
  await debug.attach({ ...ATTACH, signal: AbortSignal.timeout(5_000) })
  // Act
  const armed = await debug.armStops(
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
  // Assert
  assert.deepEqual(plain(armed), [
    { declaredStopIndex: 0, breakpointId: OWNED_IDS[0], boundLine: 14 },
    { declaredStopIndex: 1, breakpointId: OWNED_IDS[1], boundLine: 20 },
  ])
  assert.equal(editor.editorBreakpoints.length, 2)
  await debug.release()
})

/** Arms the two stops of {@link TWO_STOPS} on an attached debugger. */
async function armedDebugger(
  editor: Awaited<ReturnType<typeof editorHarness>>,
) {
  const created = editor.createDebugger(TWO_STOPS)
  await created.debug.attach({ ...ATTACH, signal: AbortSignal.timeout(5_000) })
  const heard = listen(created.debug)
  await created.debug.armStops(
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
  return { ...created, heard }
}

// protects=a stop bound on another line than declared is refused with both positions; fails_when=the run arms a stop the debugger moved; no_claim=js-debug's binding rules
test('a stop the debugger bound on another line is refused naming both positions', async () => {
  // Arrange
  const editor = await editorHarness({ verifiedLine: 15 })
  const { debug } = editor.createDebugger([{ line: 14, column: 3 }])
  await debug.attach({ ...ATTACH, signal: AbortSignal.timeout(5_000) })
  // Act
  const refusal = debug.armStops(
    [
      {
        declaredStopIndex: 0,
        path: 'src/routes/users.ts',
        file: STOP_FILE,
        line: 14,
        column: 3,
        hash: 'a'.repeat(64),
        inspections: [],
      },
    ],
    AbortSignal.timeout(5_000),
  )
  // Assert
  await assert.rejects(
    refusal,
    /Declared breakpoint 14:3 is bound at 15:3; this stop is captured on its declared line/,
  )
  await debug.release()
})

// protects=the entry pause is continued exactly once and later pauses are classified (a hit of each declared stop, a learner breakpoint on another line); fails_when=a second continue, a missed hit or a learner breakpoint taken for an owned stop; no_claim=real js-debug stop events
test('the entry pause is continued once, then a hit of the second stop and a learner breakpoint are told apart', async () => {
  // Arrange
  const editor = await editorHarness()
  const { debug, heard } = await armedDebugger(editor)
  // Act
  await debug.releaseEntry(AbortSignal.timeout(5_000))
  const continuesAfterEntry = editor.requests.filter(
    (request) => request.command === 'continue',
  ).length
  editor.adapter.stop('breakpoint', [OWNED_IDS[1]!], {
    file: STOP_FILE,
    line: 20,
  })
  const owned = await heard.nextPause()
  editor.adapter.learnerContinues()
  editor.adapter.stop('breakpoint', [LEARNER_BREAKPOINT_ID], {
    file: STOP_FILE,
    line: 30,
  })
  const learner = await heard.nextPause()
  // Assert
  assert.equal(continuesAfterEntry, 1)
  assert.deepEqual(plain({ ...owned, token: undefined }), {
    sessionId: 'node-server-session',
    threadId: 1,
    reason: 'breakpoint',
    declaredStopIndex: 1,
    location: { path: 'src/routes/users.ts', line: 20 },
  })
  assert.equal(learner.declaredStopIndex, undefined)
  assert.equal(learner.location?.line, 30)
  assert.deepEqual(plain(heard.resumes), [owned.token])
  await debug.release()
})

// protects=a declared stop hit before any entry pause is reported as a hit and the first stop is not continued as an entry; fails_when=the hit is swallowed as the entry pause; no_claim=js-debug's entry behavior
test('a declared stop hit as the very first stop is reported as a pause, not continued as the entry', async () => {
  // Arrange
  const editor = await editorHarness({
    firstStop: {
      reason: 'breakpoint',
      ids: [OWNED_IDS[0]!],
      frame: { file: STOP_FILE, line: 14 },
    },
  })
  const { debug, heard } = await armedDebugger(editor)
  // Act
  const entryRelease = debug.releaseEntry(AbortSignal.timeout(5_000))
  const first = await heard.nextPause()
  await entryRelease
  // Assert
  assert.equal(first.declaredStopIndex, 0)
  assert.equal(
    editor.requests.filter((request) => request.command === 'continue').length,
    0,
  )
  await debug.release()
})

// protects=the learner's Continue in the editor reaches the run as a resume of that pause; fails_when=the run keeps a pause the learner continued; no_claim=the editor's button
test('the learner continuing a reported pause reaches the run as a resume of its token', async () => {
  // Arrange
  const editor = await editorHarness()
  const { debug, heard } = await armedDebugger(editor)
  await debug.releaseEntry(AbortSignal.timeout(5_000))
  editor.adapter.stop('breakpoint', [OWNED_IDS[0]!], {
    file: STOP_FILE,
    line: 14,
  })
  const pause = await heard.nextPause()
  // Act
  editor.adapter.learnerContinues()
  // Assert
  assert.deepEqual(plain(heard.resumes), [pause.token])
  await debug.release()
})

// protects=the stop ledger tells a stop of the request window from the learner's: only an owned hit inside the window is Codebook's; fails_when=a learner's stop reads as Codebook's or the window's hit does not; no_claim=the workspace's keyboard handling
test('only an owned hit inside the request window counts as a stop Codebook caused', async () => {
  // Arrange
  codebookStopLedger.reset()
  const editor = await editorHarness()
  const { debug, heard } = await armedDebugger(editor)
  await debug.releaseEntry(AbortSignal.timeout(5_000))
  // Act
  debug.setRequestWindow(true)
  editor.adapter.stop('breakpoint', [OWNED_IDS[0]!], {
    file: STOP_FILE,
    line: 14,
  })
  await heard.nextPause()
  const insideWindow = codebookStopLedger.isCodebookCausedStop(
    'node-server-session',
  )
  editor.adapter.learnerContinues()
  editor.adapter.stop('breakpoint', [LEARNER_BREAKPOINT_ID], {
    file: STOP_FILE,
    line: 30,
  })
  await heard.nextPause()
  const learnersStop = codebookStopLedger.isCodebookCausedStop(
    'node-server-session',
  )
  debug.setRequestWindow(false)
  editor.adapter.learnerContinues()
  editor.adapter.stop('breakpoint', [OWNED_IDS[1]!], {
    file: STOP_FILE,
    line: 20,
  })
  await heard.nextPause()
  const outsideWindow = codebookStopLedger.isCodebookCausedStop(
    'node-server-session',
  )
  // Assert
  assert.equal(insideWindow, true)
  assert.equal(learnersStop, false)
  assert.equal(outsideWindow, false)
  await debug.release()
})

// protects=retiring removes every owned breakpoint, one after another, each confirmed by the adapter; fails_when=one stays armed; no_claim=VS Code's own removal
test('retiring the stops removes both owned breakpoints of the file', async () => {
  // Arrange
  const editor = await editorHarness()
  const { debug } = await armedDebugger(editor)
  await debug.releaseEntry(AbortSignal.timeout(5_000))
  // Act
  await debug.retireStops(AbortSignal.timeout(5_000))
  // Assert
  assert.equal(editor.editorBreakpoints.length, 0)
  await debug.release()
})

// protects=release ends the session and removes the breakpoints, and a failed release is retried; fails_when=the session stays or the retry replays the failure; no_claim=the editor's debug model
test('a release that the editor rejects once succeeds on the retry', async () => {
  // Arrange
  const editor = await editorHarness({ stopFailures: 1 })
  const { debug } = await armedDebugger(editor)
  await debug.releaseEntry(AbortSignal.timeout(5_000))
  // Act
  const first = debug.release()
  await assert.rejects(first, /the adapter did not answer \(stop 1\)/)
  await debug.release()
  // Assert
  assert.equal(editor.editorBreakpoints.length, 0)
  assert.equal(
    editor.calls.filter((call) => call === 'stopDebugging').length,
    2,
  )
})

// protects=an ended session reaches the run unless the run released it; fails_when=the run does not learn the session ended; no_claim=a crash of the adapter
test('the editor ending the session reaches the run once, and a release stays silent', async () => {
  // Arrange
  const ended = await editorHarness()
  const { debug, heard } = await armedDebugger(ended)
  const quiet = await editorHarness()
  const quietRun = await armedDebugger(quiet)
  // Act
  ended.adapter.end()
  await quietRun.debug.release()
  quiet.adapter.end()
  // Assert
  assert.deepEqual(plain(heard.ends), ['the debug session was terminated'])
  assert.deepEqual(plain(quietRun.heard.ends), [])
  await debug.release()
})

// protects=an open editor document that differs from the cited source refuses with SOURCE_CHANGED; fails_when=a run starts on text the learner changed; no_claim=real documents
test('a cited source open in the editor with other text refuses with SOURCE_CHANGED', async () => {
  // Arrange
  const editor = await editorHarness({
    documents: [
      {
        uri: { scheme: 'file', fsPath: STOP_FILE },
        getText: () => 'changed\n',
      },
    ],
  })
  const { debug } = editor.createDebugger(TWO_STOPS, undefined, [
    {
      path: 'src/routes/users.ts',
      hash: sha256('cited\n'),
      text: 'cited\n',
      lineCount: 1,
    },
  ])
  // Act / Assert
  assert.throws(
    () => debug.assertSourcesUnchanged(),
    (error) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'SOURCE_CHANGED',
  )
})

// protects=capture reads the declared facts and the source hash at an owned pause and resume continues the thread; fails_when=a capture of a changed file passes or the continue is not sent; no_claim=real variables
test('capturing an owned pause returns its facts and source hash, and resuming continues its thread', async () => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-server-debugger-'))
  const file = join(directory, 'src/routes/users.ts')
  await mkdir(join(directory, 'src/routes'), { recursive: true })
  const text = 'export const handler = () => 1\n'
  await writeFile(file, text)
  const editor = await editorHarness()
  const { debug } = editor.createDebugger([{ line: 14, column: 3 }], {
    file,
    hash: sha256(text),
    workspace: directory,
  })
  try {
    await debug.attach({
      ...ATTACH,
      packageRoot: directory,
      signal: AbortSignal.timeout(5_000),
    })
    const heard = listen(debug)
    await debug.armStops(
      [
        {
          declaredStopIndex: 0,
          path: 'src/routes/users.ts',
          file,
          line: 14,
          column: 3,
          hash: sha256(text),
          inspections: [],
        },
      ],
      AbortSignal.timeout(5_000),
    )
    await debug.releaseEntry(AbortSignal.timeout(5_000))
    editor.adapter.stop('breakpoint', [OWNED_IDS[0]!], { file, line: 14 })
    const pause = await heard.nextPause()
    // Act
    const capture = await debug.capture(pause, AbortSignal.timeout(5_000))
    await debug.resume(pause, AbortSignal.timeout(5_000))
    // Assert
    assert.equal(capture.path, 'src/routes/users.ts')
    assert.equal(capture.line, 14)
    assert.equal(capture.sourceHash, sha256(text))
    assert.deepEqual(plain(capture.facts), [
      { path: 'user.id', mode: 'value', display: '7', type: 'number' },
    ])
    assert.deepEqual(
      plain(
        editor.requests
          .filter((request) => request.command === 'continue')
          .at(-1)?.arguments,
      ),
      { threadId: 1 },
    )
    assert.deepEqual(plain(heard.resumes), [pause.token])
    // A source that changed on disk since the article cited it is refused at the next capture.
    await writeFile(file, 'changed\n')
    editor.adapter.stop('breakpoint', [OWNED_IDS[0]!], { file, line: 14 })
    const changed = await heard.nextPause()
    await assert.rejects(
      debug.capture(changed, AbortSignal.timeout(5_000)),
      (error) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'SOURCE_CHANGED',
    )
  } finally {
    await debug.release()
    await removeTestFolder(directory)
  }
})

// protects=a stop captured while a string holds the run's secret across the snapshot's cut saves [masked] and no fragment of the secret; fails_when=the debugger passes no maskKnownText, so the cut at 4,096 characters leaves the first half of the secret in the saved text; no_claim=the real adapter's variable previews (a scripted Local scope stands in) and the inspections' display text
test('a stop whose captured string holds the run secret across the snapshot cut saves the masked value without a fragment', async () => {
  // Arrange
  const secret = 'hunter2-session-secret'
  const directory = await mkdtemp(join(tmpdir(), 'codebook-server-debugger-'))
  const file = join(directory, 'src/routes/users.ts')
  await mkdir(join(directory, 'src/routes'), { recursive: true })
  const text = 'export const handler = () => 1\n'
  await writeFile(file, text)
  // The secret begins inside the saved-text limit and ends beyond it, so an unmasked cut would keep its first 13 characters while the masked text still fits.
  const longValue = `${'x'.repeat(4_070)}${secret}${'y'.repeat(50)}`
  const editor = await editorHarness({
    localVariables: [
      {
        name: 'cookieHeader',
        value: longValue,
        type: 'string',
        variablesReference: 0,
      },
    ],
  })
  const secrets = new Set<string>()
  const { debug } = editor.createDebugger(
    [{ line: 14, column: 3 }],
    { file, hash: sha256(text), workspace: directory },
    [],
    (value) => maskLearnerSecretText(value, secrets),
  )
  try {
    await debug.attach({
      ...ATTACH,
      packageRoot: directory,
      signal: AbortSignal.timeout(5_000),
    })
    const heard = listen(debug)
    await debug.armStops(
      [
        {
          declaredStopIndex: 0,
          path: 'src/routes/users.ts',
          file,
          line: 14,
          column: 3,
          hash: sha256(text),
          inspections: [],
        },
      ],
      AbortSignal.timeout(5_000),
    )
    await debug.releaseEntry(AbortSignal.timeout(5_000))
    editor.adapter.stop('breakpoint', [OWNED_IDS[0]!], { file, line: 14 })
    const pause = await heard.nextPause()
    // The secret joins the set after the debugger was made: the mask is read at capture time.
    secrets.add(secret)
    // Act
    const capture = await debug.capture(pause, AbortSignal.timeout(5_000))
    // Assert
    const saved = JSON.stringify(plain(capture.snapshot))
    assert.equal(saved.includes('[masked]'), true)
    assert.equal(saved.includes('hunter2'), false)
    assert.equal(saved.includes('hunter'), false)
  } finally {
    await debug.release()
    await removeTestFolder(directory)
  }
})

// protects=a pause whose stack cannot be read is still reported, as a held pause without a declared stop; fails_when=the pause is swallowed so the run reads in-flight and a stop resumes the paused code; no_claim=a real adapter timeout
test('a pause whose stack trace fails is reported as a pause that is no declared stop', async () => {
  // Arrange
  const editor = await editorHarness({ stackTraceFails: true })
  const { debug, heard } = await armedDebugger(editor)
  await debug.releaseEntry(AbortSignal.timeout(5_000))
  // Act
  editor.adapter.stop('breakpoint', [OWNED_IDS[0]!], {
    file: STOP_FILE,
    line: 14,
  })
  const pause = await heard.nextPause()
  // Assert
  assert.equal(pause.declaredStopIndex, undefined)
  assert.equal(pause.reason, 'breakpoint')
  assert.equal(pause.location, undefined)
  await debug.release()
})

// protects=D14: a stop the adapter reported but whose stack the editor is still reading counts as a pause the run has not heard of, until it is reported; fails_when=a stop admitted in that window reads the server as running, so the detach resumes the paused handler; no_claim=a real adapter's timing
test('a stop whose stack is still being read counts as an unreported pause until the run hears of it', async () => {
  // Arrange
  const stackTrace = defer<void>()
  const editor = await editorHarness({ stackTraceGate: stackTrace.promise })
  const { debug, heard } = await armedDebugger(editor)
  await debug.releaseEntry(AbortSignal.timeout(5_000))
  const afterEntry = debug.hasUnreportedPause()
  // Act
  editor.adapter.stop('breakpoint', [OWNED_IDS[0]!], {
    file: STOP_FILE,
    line: 14,
  })
  const whileReading = debug.hasUnreportedPause()
  stackTrace.resolve()
  await heard.nextPause()
  // Assert
  assert.equal(afterEntry, false)
  assert.equal(whileReading, true)
  assert.equal(debug.hasUnreportedPause(), false)
  await debug.release()
})

// protects=D14 v3 / Cycle 0058 task 4: a stop that arrives after the release began (the detach is under way) is still reported to the run for the bound session, so the run can kill the group before the detach resumes it; a stop of a child session is never reported; fails_when=the debugger drops the stop once its release began, or reports a child session's stop; no_claim=the run's reaction (its own test)
test(
  'a stop after the release began is reported for the bound session and a child session stays silent',
  { timeout: 10_000 },
  async () => {
    // Arrange
    const editor = await editorHarness({ stopFailures: 1 })
    const { debug, heard } = await armedDebugger(editor)
    await debug.releaseEntry(AbortSignal.timeout(5_000))
    await assert.rejects(debug.release(), /the adapter did not answer/)
    // Act
    await editor.adapter.childStops()
    // The run hears a stop during the release in the turn it arrives, so the wait is taken first.
    const nextPause = heard.nextPause()
    editor.adapter.stop('breakpoint', [OWNED_IDS[0]!], {
      file: STOP_FILE,
      line: 14,
    })
    const pause = await nextPause
    // Assert
    assert.equal(pause.sessionId, 'node-server-session')
    assert.equal(pause.reason, 'breakpoint')
    assert.equal(heard.pauses.length, 1)
    assert.equal(debug.hasUnreportedPause(), false)
    await debug.release()
  },
)

// protects=Cycle 0058 task 4 (ship Codex adversarial review): a stop the adapter reports while the release is under way reaches the run even when the detach's `continued` follows in the same turn, so the run can end the group; fails_when=the stop waits in the classification queue and the `continued` drops it before the run hears of it; no_claim=the run's reaction (its own test)
test(
  'a stop during the release is reported to the run even when a continue follows it at once',
  { timeout: 10_000 },
  async () => {
    // Arrange
    const stopHeld = defer<void>()
    const editor = await editorHarness({ stopGate: stopHeld.promise })
    const { debug, heard } = await armedDebugger(editor)
    await debug.releaseEntry(AbortSignal.timeout(5_000))
    const releasing = debug.release()
    // Act
    editor.adapter.stop('breakpoint', [OWNED_IDS[0]!], {
      file: STOP_FILE,
      line: 14,
    })
    editor.adapter.continued(1, true)
    stopHeld.resolve()
    await releasing
    await new Promise((resolve) => setImmediate(resolve))
    // Assert
    assert.deepEqual(
      heard.pauses.map((pause) => [pause.sessionId, pause.reason]),
      [['node-server-session', 'breakpoint']],
    )
  },
)

// protects=a stop the learner continues before its stack arrives is no pause any more; fails_when=a server running on is still read as paused, so a stop kills it instead of letting it shut down; no_claim=none
test('a stop the learner continues before its stack arrives no longer counts as an unreported pause', async () => {
  // Arrange
  const stackTrace = defer<void>()
  const editor = await editorHarness({ stackTraceGate: stackTrace.promise })
  const { debug } = await armedDebugger(editor)
  await debug.releaseEntry(AbortSignal.timeout(5_000))
  editor.adapter.stop('breakpoint', [OWNED_IDS[0]!], {
    file: STOP_FILE,
    line: 14,
  })
  // Act
  editor.adapter.learnerContinues()
  // Assert
  assert.equal(debug.hasUnreportedPause(), false)
  stackTrace.resolve()
  await debug.release()
})

// protects=the entry pause, which the run never hears of and which nothing of the request has reached, is no unreported pause: a Stop during preparation lets the debugger go first; fails_when=the entry pause reads as an unreported stop; no_claim=none
test('the entry pause does not count as an unreported pause', async () => {
  // Arrange
  const editor = await editorHarness()
  const { debug } = await armedDebugger(editor)
  // Act
  const beforeRelease = debug.hasUnreportedPause()
  // Assert
  assert.equal(beforeRelease, false)
  await debug.release()
})

// protects=a learner Continue the adapter rejects leaves the stop being read counted, since the target stays paused; fails_when=the request alone clears it and a Stop detaches a paused server; no_claim=a real adapter's rejection reasons
test('a learner Continue the adapter rejects keeps a stop being read counted as unreported', async () => {
  // Arrange
  const stackTrace = defer<void>()
  const editor = await editorHarness({ stackTraceGate: stackTrace.promise })
  const { debug } = await armedDebugger(editor)
  await debug.releaseEntry(AbortSignal.timeout(5_000))
  editor.adapter.stop('breakpoint', [OWNED_IDS[0]!], {
    file: STOP_FILE,
    line: 14,
  })
  // Act
  editor.adapter.learnerContinues({ rejected: true })
  // Assert
  assert.equal(debug.hasUnreportedPause(), true)
  stackTrace.resolve()
  await debug.release()
})

// protects=a learner Continue the adapter rejects keeps the reported pause current, so the run's own continue of it still works; fails_when=the pause is dropped on the request and a retry answers 'no longer current'; no_claim=none
test('a learner Continue the adapter rejects keeps the reported pause current for the next continue', async () => {
  // Arrange
  const editor = await editorHarness()
  const { debug, heard } = await armedDebugger(editor)
  await debug.releaseEntry(AbortSignal.timeout(5_000))
  editor.adapter.stop('breakpoint', [OWNED_IDS[0]!], {
    file: STOP_FILE,
    line: 14,
  })
  const pause = await heard.nextPause()
  // Act
  editor.adapter.learnerContinues({ rejected: true })
  const resumesAfterRejection = [...heard.resumes]
  await debug.resume(pause, AbortSignal.timeout(5_000))
  // Assert
  assert.deepEqual(plain(resumesAfterRejection), [])
  assert.deepEqual(plain(heard.resumes), [pause.token])
  await debug.release()
})

// protects=another thread running on clears only that thread's stops: a stop still being read on its own thread stays counted; fails_when=a continued event of thread 2 clears thread 1's unreported stop; no_claim=js-debug's thread model
test("another thread's continued event keeps this thread's stop counted as unreported", async () => {
  // Arrange
  const stackTrace = defer<void>()
  const editor = await editorHarness({ stackTraceGate: stackTrace.promise })
  const { debug } = await armedDebugger(editor)
  await debug.releaseEntry(AbortSignal.timeout(5_000))
  editor.adapter.stop('breakpoint', [OWNED_IDS[0]!], {
    file: STOP_FILE,
    line: 14,
  })
  // Act
  editor.adapter.continued(2, false)
  // Assert
  assert.equal(debug.hasUnreportedPause(), true)
  stackTrace.resolve()
  await debug.release()
})

// protects=a stop that ran on while its stack was read is never reported as the current pause, even when the thread stopped again meanwhile; fails_when=the resumed stop and the new one are both reported, mixing two pauses' facts; no_claim=a real adapter's timing
test('a stop resumed while its stack was read is not reported when the thread stops again', async () => {
  // Arrange
  const stackTrace = defer<void>()
  const editor = await editorHarness({ stackTraceGate: stackTrace.promise })
  const { debug, heard } = await armedDebugger(editor)
  await debug.releaseEntry(AbortSignal.timeout(5_000))
  editor.adapter.stop('breakpoint', [OWNED_IDS[0]!], {
    file: STOP_FILE,
    line: 14,
  })
  // Act
  editor.adapter.learnerContinues()
  editor.adapter.stop('breakpoint', [OWNED_IDS[1]!], {
    file: STOP_FILE,
    line: 20,
  })
  stackTrace.resolve()
  const reported = await heard.nextPause()
  // Assert
  // Tokens count the adapter's stops: 1 the entry, 2 the resumed stop, 3 the current one.
  assert.equal(reported.token, 3)
  assert.equal(reported.declaredStopIndex, 1)
  await debug.release()
})
