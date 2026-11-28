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
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
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
    // No request window was opened, and every pause carries the window and sign-in phase it arrived in.
    inRequestWindowAtStop: false,
    inSignInAtStop: false,
  })
  assert.equal(learner.declaredStopIndex, undefined)
  assert.equal(learner.location?.line, 30)
  assert.deepEqual(plain(heard.resumes), [owned.token])
  await debug.release()
})

// protects=a declared stop hit before any entry pause is reported as a hit and the first stop is not continued as an entry; fails_when=the hit is swallowed as the entry pause; no_claim=js-debug's entry behavior
test('a declared stop hit as the very first stop is reported as a pause, not continued as the entry', async () => {
  // Arrange
  // The hit follows the acknowledgement of its breakpoint, as a real hit can only do (the debugger takes the owned ids as they stand when the stop arrives).
  const editor = await editorHarness({ noAutomaticStop: true })
  const { debug, heard } = await armedDebugger(editor)
  editor.adapter.stop('breakpoint', [OWNED_IDS[0]!], {
    file: STOP_FILE,
    line: 14,
  })
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

// protects=on a node run too, a declared stop hit while the request window is closed (between the sign-in response and the declared request's first byte) reaches the run as arrived outside the window, so the run holds it as unattributed instead of capturing it while the stop ledger calls it the learner's; fails_when=only a Bun run records the window at arrival, so a node run judges the hit by the request state when its stack has been read and the Study and the chat disagree about who caused the stop (Cycle 0153 review round R2, OCR A Minor); seam=the editor harness's node entry pause, a closed window and an owned hit; no_claim=the run's own classification (ownedNodeServerRun.test.ts)
test('a node declared stop hit while the request window is closed reaches the run as arrived outside the window', async () => {
  // Arrange
  codebookStopLedger.reset()
  const editor = await editorHarness()
  const { debug, heard } = await armedDebugger(editor)
  await debug.releaseEntry(AbortSignal.timeout(5_000))
  debug.setRequestWindow(false)
  // Act
  editor.adapter.stop('breakpoint', [OWNED_IDS[0]!], {
    file: STOP_FILE,
    line: 14,
  })
  const hit = await heard.nextPause()
  // Assert
  assert.equal(hit.declaredStopIndex, 0)
  assert.equal(hit.inRequestWindowAtStop, false)
  assert.equal(
    codebookStopLedger.isCodebookCausedStop('node-server-session'),
    false,
  )
  await debug.release()
})

// protects=a declared stop that arrives while the sign-in request's window is open is reported as arrived during the sign-in even when the window has closed and the sign-in is over by the time its stack has been read, and a stop in the declared request's window is not; fails_when=the sign-in phase is read when the classification finishes (or not recorded), so a stop the sign-in caused can be saved as the declared request's hit (Cycle 0153 review round R3, OCR A Minor); seam=the editor harness's gated stack read and the debugger's setRequestWindow with the sign-in marker; no_claim=the run's own classification (nodeServerSignInRun.test.ts)
test(
  'a declared stop that arrived in the sign-in window is reported as arrived during the sign-in after the window closed',
  { timeout: 15_000 },
  async () => {
    // Arrange
    codebookStopLedger.reset()
    const gate = defer<void>()
    const editor = await editorHarness({ stackTraceGate: gate.promise })
    const { debug, heard } = await armedDebugger(editor)
    await debug.releaseEntry(AbortSignal.timeout(5_000))
    debug.setRequestWindow(true, { signIn: true })
    editor.adapter.stop('breakpoint', [OWNED_IDS[0]!], {
      file: STOP_FILE,
      line: 14,
    })
    // Act
    debug.setRequestWindow(false)
    gate.resolve()
    const signInHit = await heard.nextPause()
    editor.adapter.learnerContinues()
    debug.setRequestWindow(true, { signIn: false })
    editor.adapter.stop('breakpoint', [OWNED_IDS[1]!], {
      file: STOP_FILE,
      line: 20,
    })
    const declaredHit = await heard.nextPause()
    // Assert
    assert.equal(signInHit.inRequestWindowAtStop, true)
    assert.equal(signInHit.inSignInAtStop, true)
    assert.equal(declaredHit.inRequestWindowAtStop, true)
    assert.equal(declaredHit.inSignInAtStop, false)
    await debug.release()
  },
)

// protects=the run's intent to send never opens the request window over a Pause the learner sent: the window stays closed through the Pause's answer and its stop, and opens when that stop runs on; fails_when=setRequestWindow(true) opens the ledger at once, so a stop the Pause causes on a declared line reads as arrived inside the window (Cycle 0153 ship pass 1 S2); seam=the editor harness's unanswered Pause, the debugger's setRequestWindow and the stop ledger; no_claim=the run's own refusal of the write (ownedNodeServerRunEditor.test.ts)
test(
  'a request window the run opens over an outstanding learner Pause stays closed until the Pause stop runs on',
  { timeout: 15_000 },
  async () => {
    // Arrange
    codebookStopLedger.reset()
    const editor = await editorHarness()
    const { debug, heard } = await armedDebugger(editor)
    await debug.releaseEntry(AbortSignal.timeout(5_000))
    const answerPause = editor.adapter.learnerSendsPause()
    // Act
    debug.setRequestWindow(true)
    const whileUnanswered = codebookStopLedger.isWindowOpen(
      'node-server-session',
    )
    const pendingWhileUnanswered = debug.learnerPausePending?.()
    answerPause()
    editor.adapter.stop('pause', undefined, { file: STOP_FILE, line: 30 })
    await heard.nextPause()
    const whileHeld = codebookStopLedger.isWindowOpen('node-server-session')
    editor.adapter.learnerContinues()
    // Assert
    assert.equal(whileUnanswered, false)
    assert.equal(pendingWhileUnanswered, true)
    assert.equal(whileHeld, false)
    assert.equal(codebookStopLedger.isWindowOpen('node-server-session'), true)
    assert.equal(debug.learnerPausePending?.(), false)
    await debug.release()
  },
)

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

// protects=a stop that arrives between a Continue request and its reply is still reported to the run and still counts as a paused thread, so the run holds or captures it; fails_when=the late reply of the earlier Continue removes the newer stop of the same thread, so it is never reported and its thread reads as running (Cycle 0152 defect 4, Node path); seam=the editor harness's learner Continue request, a second declared hit, then the adapter's reply; no_claim=the adapter's real message order (the native check covers it)
test(
  'a stop of the same thread that arrives before the reply to an earlier Continue is still reported as a pause',
  { timeout: 15_000 },
  async () => {
    // Arrange
    const editor = await editorHarness()
    const { debug, heard } = await armedDebugger(editor)
    await debug.releaseEntry(AbortSignal.timeout(5_000))
    editor.adapter.stop('breakpoint', [OWNED_IDS[0]!], {
      file: STOP_FILE,
      line: 14,
    })
    await heard.nextPause()
    const answerContinue = editor.adapter.learnerSendsContinue()
    editor.adapter.stop('breakpoint', [OWNED_IDS[1]!], {
      file: STOP_FILE,
      line: 20,
    })
    // Act
    answerContinue()
    await waitUntil(
      () => heard.pauses.length === 2,
      'the second stop reported to the run',
      2_000,
    )
    const continuesBefore = editor.requests.filter(
      (request) => request.command === 'continue',
    ).length
    await debug.resume(heard.pauses[1]!, AbortSignal.timeout(5_000))
    // Assert
    assert.equal(heard.pauses[1]?.declaredStopIndex, 1)
    // The reply ended the first pause only; Codebook's own resume then ended the second.
    assert.deepEqual(plain(heard.resumes), [
      heard.pauses[0]!.token,
      heard.pauses[1].token,
    ])
    assert.equal(
      editor.requests.filter((request) => request.command === 'continue')
        .length,
      continuesBefore + 1,
    )
    await debug.release()
  },
)

// protects=a Codebook resume names the newest stop of its thread only: after the learner's Continue of pause A and an exception B of the same thread that arrived before the answer, resuming A sends no continue and B stays reported and paused; fails_when=the thread id alone authorizes the resume, so the continue request acts on exception B and erases it before the run reports it (Cycle 0153 ship pass 1 S3, OV2); seam=the editor harness's learner Continue request, a second stop and the adapter's reply; no_claim=the run's own handling of the refusal
test(
  'resuming an older pause sends no continue once its thread stopped again before the learner Continue was answered',
  { timeout: 15_000 },
  async () => {
    // Arrange
    const editor = await editorHarness()
    const { debug, heard } = await armedDebugger(editor)
    await debug.releaseEntry(AbortSignal.timeout(5_000))
    editor.adapter.stop('breakpoint', [OWNED_IDS[0]!], {
      file: STOP_FILE,
      line: 14,
    })
    const olderPause = await heard.nextPause()
    const answerContinue = editor.adapter.learnerSendsContinue()
    editor.adapter.stop('exception', undefined, { file: STOP_FILE, line: 30 })
    await waitUntil(
      () => heard.pauses.length === 2,
      'the exception stop reported to the run',
      2_000,
    )
    const continuesBefore = editor.requests.filter(
      (request) => request.command === 'continue',
    ).length
    // Act
    const refusal = debug.resume(olderPause, AbortSignal.timeout(5_000))
    await assert.rejects(refusal, /The owned pause is no longer current/)
    answerContinue()
    // Assert
    assert.equal(
      editor.requests.filter((request) => request.command === 'continue')
        .length,
      continuesBefore,
    )
    assert.equal(heard.pauses[1]?.reason, 'exception')
    // The reply ended the older pause only; the exception is still a paused thread the run can resume.
    assert.deepEqual(plain(heard.resumes), [olderPause.token])
    await debug.resume(heard.pauses[1], AbortSignal.timeout(5_000))
    assert.deepEqual(plain(heard.resumes), [
      olderPause.token,
      heard.pauses[1].token,
    ])
    await debug.release()
  },
)

// protects=a stop that arrived before the reply to the learner's Continue is judged as outside the request's window again when the adapter refuses that Continue: the learner's pause is still held; fails_when=the stop keeps the window the pending Continue promised, so a refused Continue lets a stop count as the request's while the learner still holds a pause (Cycle 0153 ship pass 1 OV4); seam=the editor harness's learner Pause and its stop, a Continue request, a gated stack read of the next stop and a refused reply; no_claim=a stop of another thread
test(
  'a stop that arrived before a refused learner Continue is judged outside the request window',
  { timeout: 15_000 },
  async () => {
    // Arrange
    codebookStopLedger.reset()
    const gate = defer<void>()
    const editorOptions: { stackTraceGate?: Promise<void> } = {}
    const editor = await editorHarness(editorOptions)
    const { debug, heard } = await armedDebugger(editor)
    await debug.releaseEntry(AbortSignal.timeout(5_000))
    debug.setRequestWindow(true)
    editor.adapter.learnerPauses()
    editor.adapter.stop('pause', undefined, { file: STOP_FILE, line: 30 })
    await heard.nextPause()
    const answerContinue = editor.adapter.learnerSendsContinue()
    editorOptions.stackTraceGate = gate.promise
    editor.adapter.stop('breakpoint', [OWNED_IDS[0]!], {
      file: STOP_FILE,
      line: 14,
    })
    // Act
    answerContinue({ rejected: true })
    gate.resolve()
    const hit = await heard.nextPause()
    // Assert
    assert.equal(hit.declaredStopIndex, 0)
    assert.equal(hit.inRequestWindowAtStop, false)
    assert.equal(codebookStopLedger.isWindowOpen('node-server-session'), false)
    await debug.release()
  },
)

// protects=a stop of another thread does not consume the learner's Pause of thread 1: the request window stays closed while thread 2 stops and runs on, and the stop of thread 1 that the Pause causes is the learner's; fails_when=the first stop of the session settles the Pause whatever its thread, so thread 2's run-on reopens the window and thread 1's stop on a declared line reads as the request's (Cycle 0153 ship pass 1 S10, OV7); seam=the editor harness's accepted Pause of thread 1, a stop and a run-on of thread 2, then a declared hit on thread 1; no_claim=whether js-debug reports several threads under one session
test(
  'a stop of another thread does not settle the learner Pause of thread 1',
  { timeout: 15_000 },
  async () => {
    // Arrange
    codebookStopLedger.reset()
    const editor = await editorHarness()
    const { debug, heard } = await armedDebugger(editor)
    await debug.releaseEntry(AbortSignal.timeout(5_000))
    debug.setRequestWindow(true)
    editor.adapter.learnerPauses()
    // Act
    editor.adapter.stop(
      'exception',
      undefined,
      { file: STOP_FILE, line: 30 },
      2,
    )
    await heard.nextPause()
    editor.adapter.continued(2, false)
    const windowAfterOtherThread = codebookStopLedger.isWindowOpen(
      'node-server-session',
    )
    editor.adapter.stop('breakpoint', [OWNED_IDS[0]!], {
      file: STOP_FILE,
      line: 14,
    })
    const pausedThread = await heard.nextPause()
    // Assert
    assert.equal(windowAfterOtherThread, false)
    assert.equal(pausedThread.declaredStopIndex, 0)
    assert.equal(pausedThread.inRequestWindowAtStop, false)
    assert.equal(pausedThread.learnerRequested, true)
    await debug.release()
  },
)

// protects=a stop that arrives while the learner's Pause is unanswered stays a held learner stop through the adapter's refusal of that Pause: the request window does not reopen while the stop is still held, and opens when the stop runs on; fails_when=the refusal reopens the window because the stop was not recorded as the learner's, so a declared hit before the learner's Continue reads as the request's (Cycle 0153 ship pass 1 S11); seam=the editor harness's unanswered Pause, an exception stop, the refused Pause answer and the learner's Continue; no_claim=which reason js-debug reports for a thread that was already stopped
test(
  'a stop that arrived while the learner Pause was unanswered keeps the request window closed after the Pause is refused',
  { timeout: 15_000 },
  async () => {
    // Arrange
    codebookStopLedger.reset()
    const editor = await editorHarness()
    const { debug, heard } = await armedDebugger(editor)
    await debug.releaseEntry(AbortSignal.timeout(5_000))
    debug.setRequestWindow(true)
    const answerPause = editor.adapter.learnerSendsPause()
    editor.adapter.stop('exception', undefined, { file: STOP_FILE, line: 30 })
    await heard.nextPause()
    // Act
    answerPause({ rejected: true })
    const windowAfterRefusal = codebookStopLedger.isWindowOpen(
      'node-server-session',
    )
    const pendingAfterRefusal = debug.learnerPausePending?.()
    editor.adapter.learnerContinues()
    // Assert
    assert.equal(windowAfterRefusal, false)
    assert.equal(pendingAfterRefusal, true)
    assert.equal(codebookStopLedger.isWindowOpen('node-server-session'), true)
    await debug.release()
  },
)

// protects=the entry release continues the entry pause only while it is still its thread's newest stop: a learner who continued the entry during the arming, with the thread stopped again as an exception, loses nothing to a Codebook continue; fails_when=the release sends a raw continue for the entry's thread id, so the exception is resumed before it is classified and the run reports no pause (Cycle 0153 ship pass 2 T3); seam=the editor harness's learner Continue of the entry stop and a later exception of the same thread; no_claim=the run's own handling of the exception
test(
  'releasing the entry sends no continue when the learner continued the entry and the thread stopped again',
  { timeout: 15_000 },
  async () => {
    // Arrange
    const editor = await editorHarness()
    const { debug, heard } = await armedDebugger(editor)
    editor.adapter.learnerContinues()
    editor.adapter.stop('exception', undefined, { file: STOP_FILE, line: 30 })
    // Act
    await debug.releaseEntry(AbortSignal.timeout(5_000))
    // Assert
    assert.equal(
      editor.requests.filter((request) => request.command === 'continue')
        .length,
      0,
    )
    await waitUntil(
      () => heard.pauses.length === 1,
      'the exception reported to the run',
      2_000,
    )
    assert.equal(heard.pauses[0]?.reason, 'exception')
    await debug.release()
  },
)

// protects=a stop that arrives before the adapter's accepted answer to the learner's Pause settles that Pause: continuing the stop releases the write guard and the request window opens again, with no second stop awaited; fails_when=the accepted answer leaves the Pause waiting for a stop that already came, so a ready server refuses every request after the learner continued (Cycle 0153 ship pass 2 T4, L2); seam=the editor harness's unanswered Pause, a pause stop, the accepted answer and the learner's Continue; no_claim=which order js-debug really answers in
test(
  'continuing a stop that arrived before the accepted answer to the learner Pause releases the write guard',
  { timeout: 15_000 },
  async () => {
    // Arrange
    codebookStopLedger.reset()
    const editor = await editorHarness()
    const { debug, heard } = await armedDebugger(editor)
    await debug.releaseEntry(AbortSignal.timeout(5_000))
    debug.setRequestWindow(true)
    const answerPause = editor.adapter.learnerSendsPause()
    editor.adapter.stop('pause', undefined, { file: STOP_FILE, line: 30 })
    await heard.nextPause()
    // Act
    answerPause()
    const pendingWhileHeld = debug.learnerPausePending?.()
    editor.adapter.learnerContinues()
    // Assert
    assert.equal(pendingWhileHeld, true)
    assert.equal(debug.learnerPausePending?.(), false)
    assert.equal(codebookStopLedger.isWindowOpen('node-server-session'), true)
    await debug.release()
  },
)

// protects=the debugger tells a Pause that no stop met yet from a stop the learner holds: the run words its refusal for the first, since there is nothing to continue; fails_when=both read the same, so the refusal asks the learner to continue a stop that does not exist (Cycle 0153 ship pass 2 L1); seam=the editor harness's accepted Pause with no stop, then the stop it causes; no_claim=the wording
test(
  'a Pause with no stop yet awaits its stop and a held stop does not',
  { timeout: 15_000 },
  async () => {
    // Arrange
    const editor = await editorHarness()
    const { debug, heard } = await armedDebugger(editor)
    await debug.releaseEntry(AbortSignal.timeout(5_000))
    // Act
    editor.adapter.learnerPauses()
    const awaitingBeforeStop = debug.learnerPauseAwaitsStop?.()
    editor.adapter.stop('pause', undefined, { file: STOP_FILE, line: 30 })
    await heard.nextPause()
    // Assert
    assert.equal(awaitingBeforeStop, true)
    assert.equal(debug.learnerPauseAwaitsStop?.(), false)
    assert.equal(debug.learnerPausePending?.(), true)
    await debug.release()
  },
)

// protects=a Pause of thread 1 that an all-threads stop reported on thread 2 settles keeps the learner's hold until every thread runs: a Continue of thread 2 alone leaves thread 1 stopped, so the write guard stays closed; fails_when=the partial continued event ends the hold of the stop it was reported on, and the guard opens while thread 1 is still stopped (Cycle 0153 ship pass 2 T7, OV1); seam=the editor harness's accepted Pause of thread 1, an all-threads stop on thread 2, a partial continued event and the learner's Continue of every thread; no_claim=js-debug's per-thread semantics
test(
  'a Continue of thread 2 alone does not release a Pause of thread 1 that an all-threads stop on thread 2 settled',
  { timeout: 15_000 },
  async () => {
    // Arrange
    codebookStopLedger.reset()
    const editor = await editorHarness()
    const { debug, heard } = await armedDebugger(editor)
    await debug.releaseEntry(AbortSignal.timeout(5_000))
    debug.setRequestWindow(true)
    editor.adapter.learnerPauses({}, 1)
    editor.adapter.stop(
      'pause',
      undefined,
      { file: STOP_FILE, line: 30 },
      2,
      true,
    )
    await heard.nextPause()
    // Act
    editor.adapter.continued(2, false)
    const pendingAfterPartialContinue = debug.learnerPausePending?.()
    const windowAfterPartialContinue = codebookStopLedger.isWindowOpen(
      'node-server-session',
    )
    editor.adapter.learnerContinues()
    // Assert
    assert.equal(pendingAfterPartialContinue, true)
    assert.equal(windowAfterPartialContinue, false)
    assert.equal(debug.learnerPausePending?.(), false)
    assert.equal(codebookStopLedger.isWindowOpen('node-server-session'), true)
    await debug.release()
  },
)

// protects=a Node hit that names an owned breakpoint by id stays that declared stop when the editor removes the breakpoint while the stack is being read: the matching ids and the accepted lines are taken when the stop arrives; fails_when=the classification looks the breakpoint up when the stack read finishes, so the removed breakpoint no longer matches and the hit that already arrived is reported as no declared stop (Cycle 0153 ship pass 2 T12); seam=the editor harness's gated stack read, a breakpoint hit by id and the editor's removal of the owned breakpoints during the read; no_claim=how an editor removes an owned breakpoint
test(
  'a hit by breakpoint id stays its declared stop when the owned breakpoint is removed during the stack read',
  { timeout: 15_000 },
  async () => {
    // Arrange
    const gate = defer<void>()
    const editorOptions: { stackTraceGate?: Promise<void> } = {}
    const editor = await editorHarness(editorOptions)
    const { debug, heard } = await armedDebugger(editor)
    await debug.releaseEntry(AbortSignal.timeout(5_000))
    editorOptions.stackTraceGate = gate.promise
    editor.adapter.stop('breakpoint', [OWNED_IDS[0]!], {
      file: STOP_FILE,
      line: 14,
    })
    // Act
    editor.editor.debug.removeBreakpoints([...editor.editorBreakpoints])
    gate.resolve()
    const pause = await heard.nextPause()
    // Assert
    assert.equal(pause.declaredStopIndex, 0)
    await debug.release()
  },
)
