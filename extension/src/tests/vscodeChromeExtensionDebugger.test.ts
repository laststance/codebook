import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'

import { StudyError } from '../errors'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import {
  EXTENSION_ID,
  type ConstantOverrides,
  extensionEditorHarness,
  SURFACE_URL,
  WORKER_URL,
  type TestStop,
} from './utils/chromeExtensionEditorHarness'
import { defer } from './utils/defer'

const SIGNAL = (): AbortSignal => AbortSignal.timeout(5_000)

/** Copies a value out of the loaded module's realm, so deep equality compares plain data. */
function plain<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value))
}

/** Waits until a condition holds; the debugger classifies stops asynchronously. */
async function until(condition: () => boolean): Promise<void> {
  await waitUntil(condition, 'the condition to hold', 1_000, undefined, 2)
}

/**
 * Runs the debugger's setup to the point a click could start: attach with the surface's page child, the worker child, armed stops and `ready`.
 * @param stops - The declared stops of the run.
 * @param options.withWorker - Whether the extension's worker child session appears (default true).
 */
async function readyRun(
  stops: TestStop[],
  options: {
    withWorker?: boolean
    captureGate?: Promise<void>
    constants?: ConstantOverrides
  } = {},
) {
  const editor = await extensionEditorHarness({
    captureGate: options.captureGate,
    constants: options.constants,
  })
  const created = editor.createDebugger(stops)
  const attaching = created.debug.attach(SIGNAL())
  await until(() => editor.started.length > 0)
  const page = await editor.addChild({
    kind: 'page',
    id: 'page-session',
    title: 'Popup « Bookmarks',
  })
  await attaching
  const worker =
    options.withWorker === false
      ? undefined
      : await editor.addChild({
          kind: 'service_worker',
          id: 'worker-session',
          title: 'Bookmarks: service-worker.js',
        })
  if (worker) await created.debug.waitForWorker(SIGNAL())
  await created.debug.armStops(SIGNAL())
  created.debug.markReady()
  return { ...created, editor, page, worker: worker! }
}

const PAGE_STOP: TestStop = { file: 'popup.js', line: 2, context: 'page' }
const WORKER_STOP: TestStop = {
  file: 'service-worker.js',
  line: 3,
  context: 'service-worker',
}
const SECOND_WORKER_STOP: TestStop = { ...WORKER_STOP, line: 4 }
const SECOND_PAGE_STOP: TestStop = { ...PAGE_STOP, line: 3 }

/** Lets the debugger's promise chains settle without a clock, so a test with faked timers can wait. */
async function flush(): Promise<void> {
  for (let turn = 0; turn < 5; turn += 1)
    await new Promise((resolve) => setImmediate(resolve))
}

// protects=the attach carries the owned browser's port, the surface filter and the id-to-folder mapping, and the surface child is found by target type whatever its name; fails_when=a wrong request kind, a missing urlFilter or pathMapping, a save of the learner's files or attribution by name; no_claim=real js-debug
test('attaching starts a pwa-chrome attach for the surface and finds the page child by target type, not by name', async () => {
  // Arrange
  const editor = await extensionEditorHarness()
  const { debug } = editor.createDebugger([PAGE_STOP])
  // Act
  const attaching = debug.attach(SIGNAL())
  await until(() => editor.started.length > 0)
  await editor.addChild({
    kind: 'page',
    id: 'page-session',
    title: 'Bookmarks: something else entirely',
  })
  await attaching
  // Assert
  assert.deepEqual(plain(editor.started[0]?.configuration), {
    type: 'pwa-chrome',
    request: 'attach',
    name: 'codebook chrome extension run-3',
    port: 9333,
    webRoot: editor.folder,
    urlFilter: SURFACE_URL,
    pathMapping: {
      [`chrome-extension://${EXTENSION_ID}/`]: `${editor.folder}/`,
    },
    targetSelection: 'automatic',
  })
  assert.deepEqual(plain(editor.started[0]?.options), {
    suppressSaveBeforeStart: true,
  })
  await debug.release()
  await editor.dispose()
})

// protects=CR15 (the run journals attaching, waking and arming); fails_when=a phase is missing, renamed or reordered, or an elapsed time decreases; no_claim=the launch phases
test('setup with a service-worker stop reports attaching, waking and arming in order with non-decreasing elapsed milliseconds', async () => {
  // Arrange
  const reported: Array<{ name: string; elapsedMs: number }> = []
  const editor = await extensionEditorHarness()
  const created = editor.createDebugger([WORKER_STOP], {
    onPhase: (name, elapsedMs) => reported.push({ name, elapsedMs }),
  })
  // Act
  const attaching = created.debug.attach(SIGNAL())
  await until(() => editor.started.length > 0)
  await editor.addChild({
    kind: 'page',
    id: 'page-session',
  })
  await attaching
  await editor.addChild({
    kind: 'service_worker',
    id: 'worker-session',
  })
  await created.debug.waitForWorker(SIGNAL())
  await created.debug.armStops(SIGNAL())
  // Assert
  assert.deepEqual(
    reported.map(({ name }) => name),
    ['attaching', 'waking', 'arming'],
  )
  const times = reported.map(({ elapsedMs }) => elapsedMs)
  assert.deepEqual(
    times,
    [...times].sort((left, right) => left - right),
  )
  await created.debug.release()
  await editor.dispose()
})

// protects=waking is reported only when a service-worker stop is declared; fails_when=a page-only run reports waking; no_claim=whether the run still waits for the worker
test('setup with only a page stop reports attaching and arming but no waking', async () => {
  // Arrange
  const names: string[] = []
  const editor = await extensionEditorHarness()
  const created = editor.createDebugger([PAGE_STOP], {
    onPhase: (name) => names.push(name),
  })
  // Act
  const attaching = created.debug.attach(SIGNAL())
  await until(() => editor.started.length > 0)
  await editor.addChild({
    kind: 'page',
    id: 'page-session',
  })
  await attaching
  await created.debug.armStops(SIGNAL())
  // Assert
  assert.deepEqual(names, ['attaching', 'arming'])
  await created.debug.release()
  await editor.dispose()
})

// protects=the setup surviving a faulty journal; fails_when=a throwing onPhase callback fails the attach; no_claim=what the callback does
test('a throwing onPhase callback does not break the attach', async () => {
  // Arrange
  const editor = await extensionEditorHarness()
  const created = editor.createDebugger([PAGE_STOP], {
    onPhase: () => {
      throw new Error('journal unavailable')
    },
  })
  // Act
  const attaching = created.debug.attach(SIGNAL())
  await until(() => editor.started.length > 0)
  await editor.addChild({
    kind: 'page',
    id: 'page-session',
  })
  // Assert
  await assert.doesNotReject(attaching)
  await created.debug.release()
  await editor.dispose()
})

// protects=a worker of another extension never arms or pauses a declared stop; fails_when=the stop is armed in or paused by the other extension's worker; no_claim=js-debug's own session creation
test('a service-worker stop is armed and paused only in this extension’s worker, not in another extension’s worker', async () => {
  // Arrange
  const editor = await extensionEditorHarness()
  const created = editor.createDebugger([WORKER_STOP])
  const attaching = created.debug.attach(SIGNAL())
  await until(() => editor.started.length > 0)
  await editor.addChild({
    kind: 'page',
    id: 'page-session',
  })
  await attaching
  const foreign = await editor.addChild({
    kind: 'service_worker',
    parent: editor.session('root-session'),
    id: 'foreign-session',
  })
  const own = await editor.addChild({
    kind: 'service_worker',
    id: 'worker-session',
  })
  await created.debug.waitForWorker(SIGNAL())
  await created.debug.armStops(SIGNAL())
  created.debug.markReady()
  // Act
  editor.adapter.stop(
    foreign,
    'breakpoint',
    [editor.adapterIdAt(foreign, 'service-worker.js', 3)],
    { file: editor.path('service-worker.js'), line: 3 },
  )
  await sleep(20)
  const pausesAfterForeign = created.debug.pauses().length
  editor.adapter.stop(
    own,
    'breakpoint',
    [editor.adapterIdAt(own, 'service-worker.js', 3)],
    { file: editor.path('service-worker.js'), line: 3 },
  )
  await until(() => created.debug.pauses().length === 1)
  // Assert
  assert.equal(pausesAfterForeign, 0)
  assert.equal(created.debug.pauses()[0]?.sessionId, 'worker-session')
  await created.debug.release()
  await editor.dispose()
})

// protects=a stop counts as armed only when verified in a session of its own context; fails_when=a stop the worker bound elsewhere passes because the page verified it; no_claim=js-debug's binding rules
test('a service-worker stop the worker bound on another line is refused with STOP_NOT_BOUND although the page verified it', async () => {
  // Arrange
  const editor = await extensionEditorHarness()
  const { debug } = editor.createDebugger([WORKER_STOP])
  const attaching = debug.attach(SIGNAL())
  await until(() => editor.started.length > 0)
  await editor.addChild({
    kind: 'page',
    id: 'page-session',
  })
  await attaching
  const worker = await editor.addChild({
    kind: 'service_worker',
    id: 'worker-session',
  })
  editor.setBoundLine(worker, 4)
  await debug.waitForWorker(SIGNAL())
  // Act
  const arming = debug.armStops(SIGNAL())
  // Assert
  await assert.rejects(
    arming,
    (error: unknown) =>
      error instanceof StudyError &&
      error.code === 'STOP_NOT_BOUND' &&
      error.message === 'Stop 1 could not be set in the service worker.',
  )
  await debug.release()
  await editor.dispose()
})

// protects=one editor breakpoint carries the logical stops of both contexts on a shared line; fails_when=two editor breakpoints are added or a stop is lost; no_claim=VS Code's own merging
test('a line declared in both contexts is one editor breakpoint', async () => {
  // Arrange
  const run = await readyRun([
    { file: 'popup.js', line: 2, context: 'page' },
    { file: 'popup.js', line: 2, context: 'service-worker' },
  ])
  // Assert
  assert.equal(run.editor.editorBreakpoints.length, 1)
  await run.debug.release()
  await run.editor.dispose()
})

// protects=a page hit is the page's logical stop and a worker hit of the same line is the worker's, in either order, with both pauses open at once; fails_when=one context retires the other's stop or the second pause replaces the first; no_claim=real thread timing
test('page then worker hits of one shared line open two pauses with their own continue arguments', async () => {
  // Arrange
  const run = await readyRun([
    { file: 'popup.js', line: 2, context: 'page' },
    { file: 'popup.js', line: 2, context: 'service-worker' },
  ])
  const frame = { file: run.editor.path('popup.js'), line: 2 }
  // Act
  run.editor.adapter.stop(
    run.page,
    'breakpoint',
    [run.editor.adapterIdAt(run.page, 'popup.js', 2)],
    frame,
  )
  await until(() => run.debug.pauses().length === 1)
  run.editor.adapter.stop(
    run.worker,
    'breakpoint',
    [run.editor.adapterIdAt(run.worker, 'popup.js', 2)],
    frame,
  )
  await until(() => run.debug.pauses().length === 2)
  await until(() =>
    run.debug.pauses().every((pause) => pause.status === 'captured'),
  )
  // Assert
  assert.deepEqual(
    plain(
      run.debug
        .pauses()
        .map((pause) => [
          pause.stopIndex,
          pause.context,
          pause.continueArguments,
        ]),
    ),
    [
      [
        1,
        'page',
        {
          participant: 'extension',
          sessionId: 'page-session',
          threadId: 1,
          generation: 1,
        },
      ],
      [
        2,
        'service-worker',
        {
          participant: 'extension',
          sessionId: 'worker-session',
          threadId: 1,
          generation: 2,
        },
      ],
    ],
  )
  assert.deepEqual(plain(run.debug.stopsNotReached()), [])
  await run.debug.release()
  await run.editor.dispose()
})

// protects=the worker-first order of the shared line; fails_when=the stop numbers or contexts depend on which context pauses first; no_claim=real thread timing
test('worker then page hits of one shared line pause both stops in their own contexts', async () => {
  // Arrange
  const run = await readyRun([
    { file: 'popup.js', line: 2, context: 'page' },
    { file: 'popup.js', line: 2, context: 'service-worker' },
  ])
  const frame = { file: run.editor.path('popup.js'), line: 2 }
  // Act
  run.editor.adapter.stop(
    run.worker,
    'breakpoint',
    [run.editor.adapterIdAt(run.worker, 'popup.js', 2)],
    frame,
  )
  await until(() => run.debug.pauses().length === 1)
  run.editor.adapter.stop(
    run.page,
    'breakpoint',
    [run.editor.adapterIdAt(run.page, 'popup.js', 2)],
    frame,
  )
  await until(() => run.debug.pauses().length === 2)
  // Assert
  assert.deepEqual(
    plain(run.debug.pauses().map((pause) => [pause.stopIndex, pause.context])),
    [
      [2, 'service-worker'],
      [1, 'page'],
    ],
  )
  await run.debug.release()
  await run.editor.dispose()
})

// protects=a hit in a context the stop was not declared for is resumed and journaled, never offered; fails_when=the pause is kept or not resumed; no_claim=js-debug's own shared-module behavior
test('a hit in the other context is resumed and journaled as a context mismatch', async () => {
  // Arrange
  const run = await readyRun([PAGE_STOP, WORKER_STOP])
  // Act
  run.editor.adapter.stop(
    run.worker,
    'breakpoint',
    [run.editor.adapterIdAt(run.worker, 'popup.js', 2)],
    { file: run.editor.path('popup.js'), line: 2 },
  )
  await until(() =>
    run.events.some(
      (event) => event.type === 'chrome-extension.context-mismatch',
    ),
  )
  // Assert
  assert.deepEqual(
    plain(
      run.events.filter(
        (event) => event.type === 'chrome-extension.context-mismatch',
      ),
    ),
    [
      {
        type: 'chrome-extension.context-mismatch',
        detail: { stopIndex: 1, context: 'service-worker' },
      },
    ],
  )
  assert.equal(run.debug.pauses().length, 0)
  assert.equal(
    run.editor.requests.some(
      (request) =>
        request.sessionId === 'worker-session' &&
        request.command === 'continue',
    ),
    true,
  )
  await run.debug.release()
  await run.editor.dispose()
})

// protects=a second hit of a stop already taken is resumed and journaled while its place stays shared; fails_when=the repeat pauses again or is kept; no_claim=js-debug thread semantics
test('a repeated hit of a retired stop on a shared line is resumed and journaled as a repeat hit', async () => {
  // Arrange
  const run = await readyRun([
    { file: 'popup.js', line: 2, context: 'page' },
    { file: 'popup.js', line: 2, context: 'service-worker' },
  ])
  const frame = { file: run.editor.path('popup.js'), line: 2 }
  const pageId = run.editor.adapterIdAt(run.page, 'popup.js', 2)
  run.editor.adapter.stop(run.page, 'breakpoint', [pageId], frame)
  await until(() => run.debug.pauses().length === 1)
  run.editor.adapter.learnerContinues(run.page)
  await until(() => run.debug.pauses().length === 0)
  // Act
  run.editor.adapter.stop(run.page, 'breakpoint', [pageId], frame)
  await until(() =>
    run.events.some((event) => event.type === 'chrome-extension.repeat-hit'),
  )
  // Assert
  assert.deepEqual(
    plain(
      run.events.filter(
        (event) => event.type === 'chrome-extension.repeat-hit',
      ),
    ),
    [
      {
        type: 'chrome-extension.repeat-hit',
        detail: { stopIndex: 1, path: 'popup.js', line: 2 },
      },
    ],
  )
  assert.equal(run.debug.pauses().length, 0)
  await run.debug.release()
  await run.editor.dispose()
})

// protects=a page stop is captured with its declared file and line (cited by the chat's explanation, DR11), context, generation 0, target URL and pinned hash, continued once, then no longer reached; fails_when=a capture field is missing (the Cycle 0061 pt2 dry run's captures had no file or line, and the chat cited another line) or the continue is not sent; no_claim=real variables
test('a page stop is captured with context, URL and pinned hash and continues once', async () => {
  // Arrange
  const run = await readyRun([PAGE_STOP])
  // Act
  run.editor.adapter.stop(
    run.page,
    'breakpoint',
    [run.editor.adapterIdAt(run.page, 'popup.js', 2)],
    {
      file: run.editor.path('popup.js'),
      line: 2,
    },
  )
  await until(() => run.debug.pauses()[0]?.status === 'captured')
  const [pause] = run.debug.pauses()
  await run.debug.resume(pause!.continueArguments!, SIGNAL())
  // Assert
  assert.equal(pause?.captured?.stopIndex, 1)
  assert.equal(pause?.captured?.path, 'popup.js')
  assert.equal(pause?.captured?.line, 2)
  assert.equal(pause?.captured?.context, 'page')
  assert.equal(pause?.captured?.workerGeneration, 0)
  assert.equal(pause?.captured?.targetUrl, SURFACE_URL)
  assert.equal(
    pause?.captured?.sha256,
    'c45d3a272228cc542168164ba961fa622e95260bfd107eb1276940cb5209433e',
  )
  assert.equal(run.debug.pauses().length, 0)
  assert.deepEqual(plain(run.debug.stopsNotReached()), [])
  assert.equal(
    run.editor.requests.filter((request) => request.command === 'continue')
      .length,
    1,
  )
  await run.debug.release()
  await run.editor.dispose()
})

// protects=a worker stop carries worker generation 1 and the worker's URL; fails_when=the generation or URL is the page's; no_claim=a restarted worker's second generation
test('a service-worker stop is captured with worker generation 1 and the worker URL', async () => {
  // Arrange
  const run = await readyRun([WORKER_STOP])
  // Act
  run.editor.adapter.stop(
    run.worker,
    'breakpoint',
    [run.editor.adapterIdAt(run.worker, 'service-worker.js', 3)],
    {
      file: run.editor.path('service-worker.js'),
      line: 3,
    },
  )
  await until(() => run.debug.pauses()[0]?.status === 'captured')
  // Assert
  const captured = run.debug.pauses()[0]?.captured
  assert.deepEqual(
    [captured?.context, captured?.workerGeneration, captured?.targetUrl],
    ['service-worker', 1, WORKER_URL],
  )
  await run.debug.release()
  await run.editor.dispose()
})

// protects=a declared hit before ready is startup code that is resumed, journaled and left armed; fails_when=it is offered as a stop or retires the stop; no_claim=whether js-debug pauses startup code
test('a declared hit before ready is resumed and journaled as a prepare pause and the stop stays armed', async () => {
  // Arrange
  const editor = await extensionEditorHarness()
  const created = editor.createDebugger([PAGE_STOP])
  const attaching = created.debug.attach(SIGNAL())
  await until(() => editor.started.length > 0)
  const page = await editor.addChild({
    kind: 'page',
    id: 'page-session',
  })
  await attaching
  await created.debug.armStops(SIGNAL())
  // Act
  editor.adapter.stop(
    page,
    'breakpoint',
    [editor.adapterIdAt(page, 'popup.js', 2)],
    {
      file: editor.path('popup.js'),
      line: 2,
    },
  )
  await until(() =>
    created.events.some(
      (event) => event.type === 'chrome-extension.prepare-pause',
    ),
  )
  // Assert
  assert.deepEqual(
    plain(
      created.events.filter(
        (event) => event.type === 'chrome-extension.prepare-pause',
      ),
    ),
    [
      {
        type: 'chrome-extension.prepare-pause',
        detail: { path: 'popup.js', line: 2, context: 'page' },
      },
    ],
  )
  assert.deepEqual(
    plain(created.debug.interventions().map((entry) => entry.kind)),
    ['resume-prepare-pause'],
  )
  assert.equal(created.debug.pauses().length, 0)
  assert.deepEqual(plain(created.debug.stopsNotReached()), [1])
  await created.debug.release()
  await editor.dispose()
})

// protects=a learner Pause stays the learner's, is reported without continue arguments and Codebook refuses to continue it; fails_when=it is auto-resumed or continuable; no_claim=the learner's UI
test('a learner Pause is kept without continue arguments and Codebook refuses to continue it', async () => {
  // Arrange
  const run = await readyRun([PAGE_STOP])
  // Act
  run.editor.adapter.stop(run.page, 'pause')
  await until(() => run.debug.pauses().length === 1)
  const [pause] = run.debug.pauses()
  const refusal = run.debug.resume(
    {
      participant: 'extension',
      sessionId: 'page-session',
      threadId: 1,
      generation: pause!.generation,
    },
    SIGNAL(),
  )
  // Assert
  assert.equal(pause?.kind, 'learner')
  assert.equal(pause?.continueArguments, undefined)
  await assert.rejects(
    refusal,
    (error: unknown) =>
      error instanceof StudyError && error.code === 'LEARNER_PAUSED',
  )
  assert.equal(
    run.editor.requests.some((request) => request.command === 'continue'),
    false,
  )
  await run.debug.release()
  await run.editor.dispose()
})

// protects=a learner breakpoint on a line Codebook already retired is the learner's pause; fails_when=it is resumed as a repeat or captured as a declared stop; no_claim=the learner's breakpoint placement
test('a learner breakpoint on a retired line is kept as the learner’s pause', async () => {
  // Arrange
  const run = await readyRun([PAGE_STOP])
  run.editor.adapter.stop(
    run.page,
    'breakpoint',
    [run.editor.adapterIdAt(run.page, 'popup.js', 2)],
    {
      file: run.editor.path('popup.js'),
      line: 2,
    },
  )
  await until(() => run.debug.pauses()[0]?.status === 'captured')
  run.editor.adapter.learnerContinues(run.page)
  await until(() => run.debug.pauses().length === 0)
  // Act
  run.editor.adapter.stop(run.page, 'breakpoint', [9_999], {
    file: run.editor.path('popup.js'),
    line: 2,
  })
  await until(() => run.debug.pauses().length === 1)
  // Assert
  assert.deepEqual(
    [run.debug.pauses()[0]?.kind, run.debug.pauses()[0]?.reason],
    ['learner', 'breakpoint'],
  )
  await run.debug.release()
  await run.editor.dispose()
})

// protects=a learner breakpoint beside the owned one on a live stop keeps the pause the learner's and the declared stop unreached; fails_when=the hit is captured and retired as Codebook's stop; no_claim=how the editor merges two breakpoints on one line
test('a learner breakpoint sharing the line of a live declared stop keeps the pause the learner’s', async () => {
  // Arrange
  const run = await readyRun([PAGE_STOP])
  const ownedId = run.editor.adapterIdAt(run.page, 'popup.js', 2)
  // Act
  run.editor.adapter.stop(run.page, 'breakpoint', [ownedId, 9_999], {
    file: run.editor.path('popup.js'),
    line: 2,
  })
  await until(() => run.debug.pauses().length === 1)
  // Assert
  assert.equal(run.debug.pauses()[0]?.kind, 'learner')
  assert.deepEqual(plain(run.debug.stopsNotReached()), [1])
  await run.debug.release()
  await run.editor.dispose()
})

// protects=the learner's own Continue during a capture drops the capture and makes the continue arguments stale; fails_when=a captured snapshot of an ended pause is kept or the old arguments still work; no_claim=real adapter replies
test('a manual continue during a capture ends the pause and its continue arguments answer STALE_PAUSE', async () => {
  // Arrange
  const gate = defer<void>()
  const run = await readyRun([PAGE_STOP], { captureGate: gate.promise })
  run.editor.adapter.stop(
    run.page,
    'breakpoint',
    [run.editor.adapterIdAt(run.page, 'popup.js', 2)],
    {
      file: run.editor.path('popup.js'),
      line: 2,
    },
  )
  await until(() => run.debug.pauses().length === 1)
  const args = run.debug.pauses()[0]!.continueArguments!
  // Act
  run.editor.adapter.learnerContinues(run.page)
  gate.resolve()
  await until(() => run.debug.pauses().length === 0)
  const refusal = run.debug.resume(args, SIGNAL())
  // Assert
  assert.equal(run.debug.pauses().length, 0)
  await assert.rejects(
    refusal,
    (error: unknown) =>
      error instanceof StudyError && error.code === 'STALE_PAUSE',
  )
  await run.debug.release()
  await run.editor.dispose()
})

// protects=continuing one pause never invalidates another and a pause that opens during a capture is kept; fails_when=the second pause replaces the first or the first continue ends both; no_claim=real thread timing
test('a pause that opens during another pause’s capture is kept and continuing one leaves the other paused', async () => {
  // Arrange
  const gate = defer<void>()
  const run = await readyRun([PAGE_STOP, WORKER_STOP], {
    captureGate: gate.promise,
  })
  run.editor.adapter.stop(
    run.page,
    'breakpoint',
    [run.editor.adapterIdAt(run.page, 'popup.js', 2)],
    {
      file: run.editor.path('popup.js'),
      line: 2,
    },
  )
  await until(() => run.debug.pauses().length === 1)
  // Act
  run.editor.adapter.stop(
    run.worker,
    'breakpoint',
    [run.editor.adapterIdAt(run.worker, 'service-worker.js', 3)],
    {
      file: run.editor.path('service-worker.js'),
      line: 3,
    },
  )
  await until(() => run.debug.pauses().length === 2)
  gate.resolve()
  await until(() =>
    run.debug.pauses().every((pause) => pause.status === 'captured'),
  )
  await run.debug.resume(run.debug.pauses()[0]!.continueArguments!, SIGNAL())
  // Assert
  assert.deepEqual(
    plain(run.debug.pauses().map((pause) => [pause.context, pause.status])),
    [['service-worker', 'captured']],
  )
  await run.debug.release()
  await run.editor.dispose()
})

// protects=a worker that ends while paused fails the run with SERVICE_WORKER_LOST and its continue arguments go stale; fails_when=the run keeps waiting or the old arguments still resume; no_claim=real worker termination
test('a worker session that ends while paused fails the run with SERVICE_WORKER_LOST and leaves the page pause', async () => {
  // Arrange
  const run = await readyRun([PAGE_STOP, WORKER_STOP])
  run.editor.adapter.stop(
    run.page,
    'breakpoint',
    [run.editor.adapterIdAt(run.page, 'popup.js', 2)],
    {
      file: run.editor.path('popup.js'),
      line: 2,
    },
  )
  run.editor.adapter.stop(
    run.worker,
    'breakpoint',
    [run.editor.adapterIdAt(run.worker, 'service-worker.js', 3)],
    {
      file: run.editor.path('service-worker.js'),
      line: 3,
    },
  )
  await until(() => run.debug.pauses().length === 2)
  const workerArgs = run.debug.pauses()[1]!.continueArguments!
  // Act
  run.editor.adapter.end(run.worker)
  // Assert
  assert.deepEqual(
    run.failures.map((error) => [error.code, error.message]),
    [
      [
        'SERVICE_WORKER_LOST',
        "The extension's service worker stopped while it was paused.",
      ],
    ],
  )
  assert.deepEqual(plain(run.debug.pauses().map((pause) => pause.context)), [
    'page',
  ])
  await assert.rejects(
    run.debug.resume(workerArgs, SIGNAL()),
    (error: unknown) =>
      error instanceof StudyError && error.code === 'STALE_PAUSE',
  )
  await run.debug.release()
  await run.editor.dispose()
})

// protects=a page session that ends under a declared pause closes the pause and clears its hold, and the ended surface is no failure of the debugger (pt2 reports SURFACE_LOST); fails_when=the pause stays listed or its hold timer later fails the run with PAUSE_HOLD_EXPIRED; no_claim=the SURFACE_LOST report of the lifecycle
test('a page session that ends under a declared pause closes the pause and its hold never fails the run', async (context) => {
  // Arrange
  const run = await readyRun([PAGE_STOP])
  context.mock.timers.enable({ apis: ['setTimeout'] })
  run.editor.adapter.stop(
    run.page,
    'breakpoint',
    [run.editor.adapterIdAt(run.page, 'popup.js', 2)],
    { file: run.editor.path('popup.js'), line: 2 },
  )
  await flush()
  assert.equal(run.debug.pauses().length, 1)
  // Act
  run.editor.adapter.end(run.page)
  context.mock.timers.tick(600_000)
  // Assert
  assert.equal(run.debug.pauses().length, 0)
  assert.deepEqual(run.failures, [])
  context.mock.timers.reset()
  await run.debug.release()
  await run.editor.dispose()
})

// protects=a worker that ends while the learner has it paused (reason pause) is a lost worker and run state; fails_when=the run is not failed with SERVICE_WORKER_LOST or the learner pause stays listed; no_claim=declared worker pauses (own test)
test('a worker session that ends under a learner pause fails the run with SERVICE_WORKER_LOST and leaves no pause', async () => {
  // Arrange
  const run = await readyRun([WORKER_STOP])
  run.editor.adapter.stop(run.worker, 'pause')
  await until(() => run.debug.pauses().length === 1)
  // Act
  run.editor.adapter.end(run.worker)
  // Assert
  assert.deepEqual(
    run.failures.map((error) => error.code),
    ['SERVICE_WORKER_LOST'],
  )
  assert.equal(run.debug.pauses().length, 0)
  await run.debug.release()
  await run.editor.dispose()
})

// protects=a pause in a worker proven foreign (its URL is known and under another extension) is continued and journaled; fails_when=the foreign worker stays paused or nothing is journaled; no_claim=pages of other tabs (own test)
test('a pause in another extension’s worker is continued and journaled as resume-foreign-pause', async () => {
  // Arrange
  const editor = await extensionEditorHarness()
  const created = editor.createDebugger([PAGE_STOP])
  const attaching = created.debug.attach(SIGNAL())
  await until(() => editor.started.length > 0)
  await editor.addChild({
    kind: 'page',
    id: 'page-session',
  })
  await attaching
  const foreign = await editor.addChild({
    kind: 'service_worker',
    parent: editor.session('root-session'),
    id: 'foreign-worker-session',
  })
  // Act
  editor.adapter.stop(foreign, 'pause', undefined, undefined, 6)
  await until(() =>
    editor.requests.some(
      (request) =>
        request.sessionId === 'foreign-worker-session' &&
        request.command === 'continue',
    ),
  )
  // Assert
  assert.deepEqual(plain(created.debug.interventions().map((e) => e.kind)), [
    'resume-foreign-pause',
  ])
  await created.debug.release()
  await editor.dispose()
})

// protects=a worker that ends while no pause is open fails nothing; fails_when=an idle worker expiry ends the run; no_claim=the restart before the next click
test('a worker session that ends without a pause does not fail the run', async () => {
  // Arrange
  const run = await readyRun([WORKER_STOP])
  // Act
  run.editor.adapter.end(run.worker)
  // gstack-timing-ok: asserts no failure follows a worker end, so a short fixed wait is the contract
  await sleep(10)
  // Assert
  assert.deepEqual(run.failures, [])
  await run.debug.release()
  await run.editor.dispose()
})

// protects=a worker restarted before a click is re-armed and counted as a new generation, journaled as an intervention; fails_when=the click is allowed with an unverified stop or the re-arm is not disclosed; no_claim=real js-debug re-arming
test('a worker restarted before a click turns the stop unverified, then verified again, and the click waits for it', async () => {
  // Arrange
  const run = await readyRun([WORKER_STOP])
  const id = run.editor.adapterIdAt(run.worker, 'service-worker.js', 3)
  // Act
  run.editor.adapter.breakpointNews(run.worker, id, false)
  const generationAfterLoss = run.debug.workerGeneration()
  let readyResolved = false
  const ready = run.debug.ensureWorkerReady(SIGNAL()).then(() => {
    readyResolved = true
  })
  // gstack-timing-ok: the click must keep waiting while the stop is unverified, so holding it unverified for a fixed time is the contract
  await sleep(120)
  const resolvedBeforeVerified = readyResolved
  run.editor.adapter.breakpointNews(run.worker, id, true)
  await ready
  // Assert
  assert.equal(resolvedBeforeVerified, false)
  assert.equal(readyResolved, true)
  assert.equal(generationAfterLoss, 2)
  assert.deepEqual(
    plain(run.debug.interventions().map((entry) => entry.kind)),
    ['re-arm'],
  )
  assert.deepEqual(run.failures, [])
  await run.debug.release()
  await run.editor.dispose()
})

// protects=an idle worker that has no child session is started again before the click and the click waits for its stops; fails_when=the worker is not started, the intervention is hidden or the generation does not grow; no_claim=ServiceWorker.startWorker itself
test('a missing worker is started again before a click, journaled, and its stops are verified', async () => {
  // Arrange
  const editor = await extensionEditorHarness()
  const created = editor.createDebugger([WORKER_STOP], {
    startWorker: async () => {
      await editor.addChild({
        kind: 'service_worker',
        id: 'worker-session-2',
      })
    },
  })
  const attaching = created.debug.attach(SIGNAL())
  await until(() => editor.started.length > 0)
  await editor.addChild({
    kind: 'page',
    id: 'page-session',
  })
  await attaching
  const first = await editor.addChild({
    kind: 'service_worker',
    id: 'worker-session',
  })
  await created.debug.waitForWorker(SIGNAL())
  await created.debug.armStops(SIGNAL())
  created.debug.markReady()
  editor.adapter.end(first)
  // Act
  await created.debug.ensureWorkerReady(SIGNAL())
  // Assert
  assert.deepEqual(
    plain(created.debug.interventions().map((entry) => entry.kind)),
    ['start-worker'],
  )
  assert.equal(created.debug.workerGeneration(), 2)
  assert.deepEqual(plain(created.debug.stopsNotReached()), [1])
  await created.debug.release()
  await editor.dispose()
})

// protects=a worker generation change during an action fails the run with SERVICE_WORKER_RESTARTED and the action's guard refuses; fails_when=the restart is silent or the guard stays current; no_claim=a restart during a real click (not provoked in task 0)
test('a worker restart during an action fails the run with SERVICE_WORKER_RESTARTED and the guard refuses', async () => {
  // Arrange
  const run = await readyRun([WORKER_STOP])
  const guard = run.debug.beginAction()
  // Act
  run.editor.adapter.breakpointNews(
    run.worker,
    run.editor.adapterIdAt(run.worker, 'service-worker.js', 3),
    false,
  )
  // Assert
  assert.deepEqual(
    run.failures.map((error) => [error.code, error.message]),
    [
      [
        'SERVICE_WORKER_RESTARTED',
        "The extension's service worker restarted during a click.",
      ],
    ],
  )
  assert.throws(
    () => guard.assertCurrent(),
    (error: unknown) =>
      error instanceof StudyError && error.code === 'SERVICE_WORKER_RESTARTED',
  )
  guard.end()
  await run.debug.release()
  await run.editor.dispose()
})

// protects=a new worker child session during an action is a restart; fails_when=a replacement worker goes unnoticed; no_claim=js-debug's restart behavior
test('a new worker child session during an action fails the run with SERVICE_WORKER_RESTARTED', async () => {
  // Arrange
  const run = await readyRun([WORKER_STOP])
  const guard = run.debug.beginAction()
  // Act
  await run.editor.addChild({
    kind: 'service_worker',
    id: 'worker-session-2',
  })
  await until(() => run.failures.length === 1)
  // Assert
  assert.equal(run.failures[0]?.code, 'SERVICE_WORKER_RESTARTED')
  guard.end()
  await run.debug.release()
  await run.editor.dispose()
})

// protects=a changed source at capture fails the run with SOURCE_CHANGED and marks the capture failed; fails_when=a snapshot of changed bytes is accepted; no_claim=the disk and editor comparison itself
test('a source that changed before the capture fails the run with SOURCE_CHANGED', async () => {
  // Arrange
  const editor = await extensionEditorHarness()
  const created = editor.createDebugger([PAGE_STOP], {
    assertSourcesUnchanged: () => {
      throw new StudyError(
        'SOURCE_CHANGED',
        'popup.js changed after the run started.',
      )
    },
  })
  const attaching = created.debug.attach(SIGNAL())
  await until(() => editor.started.length > 0)
  const page = await editor.addChild({
    kind: 'page',
    id: 'page-session',
  })
  await attaching
  await created.debug.armStops(SIGNAL())
  created.debug.markReady()
  // Act
  editor.adapter.stop(
    page,
    'breakpoint',
    [editor.adapterIdAt(page, 'popup.js', 2)],
    {
      file: editor.path('popup.js'),
      line: 2,
    },
  )
  await until(() => created.failures.length === 1)
  // Assert
  assert.equal(created.failures[0]?.code, 'SOURCE_CHANGED')
  assert.equal(created.debug.pauses()[0]?.status, 'capture-failed')
  assert.equal(editor.captureCalls(), 0)
  await created.debug.release()
  await editor.dispose()
})

// protects=worker and page console output is journaled with its context, masked, root-hidden and cut at 4,096 characters; fails_when=a secret, a private path or a long line reaches the journal; no_claim=js-debug's output categories beyond console
test('console output is journaled with its context, masked, root-hidden and cut at 4096 characters', async () => {
  // Arrange
  const run = await readyRun([WORKER_STOP])
  // Act
  run.editor.adapter.output(run.worker, 'View mode: Popup\n')
  run.editor.adapter.output(
    run.page,
    'sent Bearer abcdefghijklmnopqrstuvwxyz0123456789 ok',
  )
  run.editor.adapter.output(
    run.worker,
    `at ${run.editor.folder}/service-worker.js:3`,
  )
  run.editor.adapter.output(run.worker, 'x'.repeat(5_000))
  run.editor.adapter.output(run.worker, 'telemetry text', 'telemetry')
  await until(
    () =>
      run.events.filter((event) => event.type === 'chrome-extension.output')
        .length === 4,
  )
  // Assert
  const outputs = run.events
    .filter((event) => event.type === 'chrome-extension.output')
    .map((event) => event.detail as { context: string; text: string })
  assert.deepEqual(
    outputs.slice(0, 3).map((entry) => [entry.context, entry.text]),
    [
      ['service-worker', 'View mode: Popup\n'],
      ['page', 'sent Bearer [masked] ok'],
      ['service-worker', 'at <workspace>/service-worker.js:3'],
    ],
  )
  assert.equal(outputs[3]?.text.length, 4_096)
  await run.debug.release()
  await run.editor.dispose()
})

// protects=at most 200 output events are journaled and the rest are counted once; fails_when=250 outputs journal 250 events or the dropped count is missing or repeated; no_claim=output timing
test('250 console outputs journal 200 events and one dropped count of 50', async () => {
  // Arrange
  const run = await readyRun([WORKER_STOP])
  // Act
  for (let count = 0; count < 250; count += 1)
    run.editor.adapter.output(run.worker, `line ${count}\n`)
  await until(
    () =>
      run.events.filter((event) => event.type === 'chrome-extension.output')
        .length === 200,
  )
  // gstack-timing-ok: asserts no output beyond the 200th is journaled, so a short fixed wait is the contract
  await sleep(20)
  await run.debug.release()
  // Assert
  assert.equal(
    run.events.filter((event) => event.type === 'chrome-extension.output')
      .length,
    200,
  )
  assert.deepEqual(
    plain(
      run.events.filter(
        (event) => event.type === 'chrome-extension.output-dropped',
      ),
    ),
    [{ type: 'chrome-extension.output-dropped', detail: { count: 50 } }],
  )
  await run.editor.dispose()
})

// protects=releasing removes the owned breakpoints and ends the sessions; fails_when=a breakpoint or session outlives the run; no_claim=real session teardown
test('releasing removes the owned breakpoints and stops every session of the run', async () => {
  // Arrange
  const run = await readyRun([PAGE_STOP, WORKER_STOP])
  // Act
  await run.debug.release()
  // Assert
  assert.equal(run.editor.editorBreakpoints.length, 0)
  assert.deepEqual([...run.editor.stopped].sort(), [
    'page-session',
    'root-session',
    'worker-session',
  ])
  await run.editor.dispose()
})

// protects=a worker restart that loses two declared worker stops is one restart: one generation, one failure of the click, one re-arm; fails_when=the generation grows or the click fails once per stop; no_claim=real js-debug restart news
test('a restart that loses two worker stops bumps the generation once, fails the click once and journals one re-arm', async () => {
  // Arrange
  const run = await readyRun([WORKER_STOP, SECOND_WORKER_STOP])
  const first = run.editor.adapterIdAt(run.worker, 'service-worker.js', 3)
  const second = run.editor.adapterIdAt(run.worker, 'service-worker.js', 4)
  const guard = run.debug.beginAction()
  // Act
  run.editor.adapter.breakpointNews(run.worker, first, false, 3)
  run.editor.adapter.breakpointNews(run.worker, second, false, 4)
  const generationAfterLoss = run.debug.workerGeneration()
  guard.end()
  run.editor.adapter.breakpointNews(run.worker, first, true, 3)
  run.editor.adapter.breakpointNews(run.worker, second, true, 4)
  // Assert
  assert.equal(generationAfterLoss, 2)
  assert.deepEqual(
    run.failures.map((failure) => failure.code),
    ['SERVICE_WORKER_RESTARTED'],
  )
  assert.deepEqual(
    plain(run.debug.interventions().map((entry) => entry.kind)),
    ['re-arm'],
  )
  await run.debug.release()
  await run.editor.dispose()
})

// protects=a restarted worker whose stop is never verified again refuses the click with STOP_NOT_BOUND; fails_when=SERVICE_WORKER_NOT_ATTACHED is reported although the worker runs; no_claim=the real bound of 5 s
test('a restarted worker stop that is not verified again in time is refused with STOP_NOT_BOUND', async () => {
  // Arrange
  const run = await readyRun([WORKER_STOP], {
    constants: { EXTENSION_WAKE_BOUND_MS: 80 },
  })
  const id = run.editor.adapterIdAt(run.worker, 'service-worker.js', 3)
  run.editor.adapter.breakpointNews(run.worker, id, false)
  // Act
  const ready = run.debug.ensureWorkerReady(SIGNAL())
  // Assert
  await assert.rejects(
    ready,
    (error: unknown) =>
      error instanceof StudyError &&
      error.code === 'STOP_NOT_BOUND' &&
      error.message === 'Stop 1 could not be set in the service worker.',
  )
  await run.debug.release()
  await run.editor.dispose()
})

// protects=a worker replaced by a new session is ready without a breakpoint event; fails_when=the lost-stop note of the ended worker holds the click until its bound; no_claim=js-debug's worker replacement order
test('a replacement worker session that verifies its stops through setBreakpoints makes the click ready', async () => {
  // Arrange
  const run = await readyRun([WORKER_STOP], {
    constants: { EXTENSION_WAKE_BOUND_MS: 400 },
  })
  const id = run.editor.adapterIdAt(run.worker, 'service-worker.js', 3)
  run.editor.adapter.breakpointNews(run.worker, id, false)
  run.editor.adapter.end(run.worker)
  await run.editor.addChild({
    kind: 'service_worker',
    id: 'worker-session-2',
  })
  // Act
  await run.debug.ensureWorkerReady(SIGNAL())
  // Assert
  assert.deepEqual(run.failures, [])
  await run.debug.release()
  await run.editor.dispose()
})

// protects=the page hold is 300 s and the worker hold 280 s and each expiry fails with the extension's recovery text; fails_when=the node-server recovery (server, node-server anchor) is shown for an extension run; no_claim=the real clock
test('a page stop held for 300 s fails the run with PAUSE_HOLD_EXPIRED and the extension recovery', async (context) => {
  // Arrange
  const run = await readyRun([PAGE_STOP])
  context.mock.timers.enable({ apis: ['setTimeout'] })
  // Act
  run.editor.adapter.stop(
    run.page,
    'breakpoint',
    [run.editor.adapterIdAt(run.page, 'popup.js', 2)],
    { file: run.editor.path('popup.js'), line: 2 },
  )
  await flush()
  context.mock.timers.tick(299_999)
  const failuresBefore = run.failures.length
  context.mock.timers.tick(1)
  // Assert
  assert.equal(failuresBefore, 0)
  assert.equal(run.failures[0]?.code, 'PAUSE_HOLD_EXPIRED')
  assert.equal(
    run.failures[0]?.describe().recovery,
    "Tell the learner the extension stayed paused longer than 300 s, so Codebook ended the run without resuming the paused code. Recovery: learner decision, at most one new run. The run is stopped and its owned browser closed; whether the click changed the extension's data is unknown, so have the learner check it. Start one new run with a new key only if the learner asks, and continue each stop within the hold. See codebook://help/chrome-extension#PAUSE_HOLD_EXPIRED.",
  )
  context.mock.timers.reset()
  await run.debug.release()
  await run.editor.dispose()
})

test('a worker stop held for 280 s fails the run with PAUSE_HOLD_EXPIRED naming 280 s', async (context) => {
  // Arrange
  const run = await readyRun([WORKER_STOP])
  context.mock.timers.enable({ apis: ['setTimeout'] })
  // Act
  run.editor.adapter.stop(
    run.worker,
    'breakpoint',
    [run.editor.adapterIdAt(run.worker, 'service-worker.js', 3)],
    { file: run.editor.path('service-worker.js'), line: 3 },
  )
  await flush()
  context.mock.timers.tick(279_999)
  const failuresBefore = run.failures.length
  context.mock.timers.tick(1)
  // Assert
  assert.equal(failuresBefore, 0)
  assert.equal(run.failures[0]?.code, 'PAUSE_HOLD_EXPIRED')
  assert.match(
    run.failures[0]?.describe().recovery ?? '',
    /^Tell the learner the extension stayed paused longer than 280 s,/,
  )
  context.mock.timers.reset()
  await run.debug.release()
  await run.editor.dispose()
})

// protects=a learner pause is refused with the extension's recovery, not the server's; fails_when=the continue refusal says server; no_claim=the learner's UI
test('continuing a learner pause answers LEARNER_PAUSED with the extension recovery', async () => {
  // Arrange
  const run = await readyRun([PAGE_STOP])
  run.editor.adapter.stop(run.page, 'pause', undefined, undefined, 7)
  await until(() => run.debug.pauses().length === 1)
  // Act
  const resuming = run.debug.resume(
    {
      participant: 'extension',
      sessionId: 'page-session',
      threadId: 7,
      generation: run.debug.pauses()[0]!.generation,
    },
    SIGNAL(),
  )
  // Assert
  await assert.rejects(
    resuming,
    (error: unknown) =>
      error instanceof StudyError &&
      error.code === 'LEARNER_PAUSED' &&
      error.describe().recovery ===
        "Let the learner continue the extension in the editor's debugger: the learner paused it, and Codebook never resumes such a pause. Recovery: learner action. Nothing changed. Read the run again after the learner continues; stop the run only if the learner asks. See codebook://help/chrome-extension#LEARNER_PAUSED.",
  )
  await run.debug.release()
  await run.editor.dispose()
})

// protects=a source changed on disk after the run started ends the run with the extension's SOURCE_CHANGED recovery; fails_when=the repository-browser or node-test wording is shown; no_claim=the editor document comparison
test('a stop file changed on disk fails the run with SOURCE_CHANGED and the extension recovery', async () => {
  // Arrange
  const run = await readyRun([PAGE_STOP])
  await writeFile(run.editor.path('popup.js'), 'changed after the start\n')
  // Act
  run.editor.adapter.stop(
    run.page,
    'breakpoint',
    [run.editor.adapterIdAt(run.page, 'popup.js', 2)],
    { file: run.editor.path('popup.js'), line: 2 },
  )
  await until(() => run.failures.length === 1)
  // Assert
  assert.equal(run.failures[0]?.code, 'SOURCE_CHANGED')
  assert.equal(
    run.failures[0]?.describe().recovery,
    'A source file of the extension changed after the run started, so the run ends and no resume was sent. Earlier observations and their captured source stay readable. Ask the learner to save or revert the file the message names, then start a new deliberate run. Never retry the click automatically. See codebook://help/chrome-extension#SOURCE_CHANGED.',
  )
  await run.debug.release()
  await run.editor.dispose()
})

// protects=a stop whose thread the learner continued while the classification awaited is no pause; fails_when=a pause stays open for a running thread; no_claim=js-debug event order
test('a continue processed right after a stop leaves no pause for the running thread', async () => {
  // Arrange
  const run = await readyRun([PAGE_STOP])
  // Act
  run.editor.adapter.stop(
    run.page,
    'breakpoint',
    [run.editor.adapterIdAt(run.page, 'popup.js', 2)],
    { file: run.editor.path('popup.js'), line: 2 },
  )
  run.editor.adapter.learnerContinues(run.page)
  // gstack-timing-ok: asserts no pause appears after the continue, so a short fixed wait is the contract
  await sleep(30)
  // Assert
  assert.deepEqual(plain(run.debug.pauses()), [])
  await run.debug.release()
  await run.editor.dispose()
})

// protects=output arriving after the release began is not journaled; fails_when=a late console line reaches the journal; no_claim=output order
test('console output that arrives after the release began is not journaled', async () => {
  // Arrange
  const run = await readyRun([PAGE_STOP])
  await run.debug.release()
  // Act
  run.editor.adapter.output(run.page, 'late line\n')
  // gstack-timing-ok: asserts the late line is never journaled, so a short fixed wait is the contract
  await sleep(20)
  // Assert
  assert.deepEqual(
    run.events.filter((event) => event.type === 'chrome-extension.output'),
    [],
  )
  await run.editor.dispose()
})

// protects=a live stop keeps its adapter id while its file's breakpoints are being replaced; fails_when=the hit reads as a learner breakpoint; no_claim=js-debug's replacement timing
test('a hit of a live stop while a replacement of its file is unanswered is still the declared stop', async () => {
  // Arrange
  const run = await readyRun([PAGE_STOP, SECOND_PAGE_STOP])
  const secondId = run.editor.adapterIdAt(run.page, 'popup.js', 3)
  run.editor.adapter.stop(
    run.page,
    'breakpoint',
    [run.editor.adapterIdAt(run.page, 'popup.js', 2)],
    { file: run.editor.path('popup.js'), line: 2 },
  )
  await until(() => run.debug.pauses().length === 1)
  await sleep(20)
  // Act
  run.editor.adapter.replacementUnanswered(run.page, 'popup.js')
  run.editor.adapter.stop(
    run.page,
    'breakpoint',
    [secondId],
    { file: run.editor.path('popup.js'), line: 3 },
    2,
  )
  await until(() => run.debug.pauses().length === 2)
  // Assert
  assert.deepEqual(
    run.debug.pauses().map((pause) => pause.kind),
    ['declared', 'declared'],
  )
  await run.debug.release()
  await run.editor.dispose()
})

// protects=SR14 attribution: with three workers only the run's own is armed and paused; fails_when=either foreign worker pauses or arms a stop; no_claim=js-debug's session creation
test('with two foreign workers and the run’s own, only the own worker’s hit opens a pause', async () => {
  // Arrange
  const editor = await extensionEditorHarness()
  const created = editor.createDebugger([WORKER_STOP])
  const attaching = created.debug.attach(SIGNAL())
  await until(() => editor.started.length > 0)
  await editor.addChild({
    kind: 'page',
    id: 'page-session',
  })
  await attaching
  const foreignOne = await editor.addChild({
    kind: 'service_worker',
    parent: editor.session('root-session'),
    id: 'foreign-one-session',
  })
  const own = await editor.addChild({
    kind: 'service_worker',
    id: 'worker-session',
  })
  const foreignTwo = await editor.addChild({
    kind: 'service_worker',
    parent: editor.session('root-session'),
    id: 'foreign-two-session',
  })
  await created.debug.waitForWorker(SIGNAL())
  await created.debug.armStops(SIGNAL())
  created.debug.markReady()
  const frame = { file: editor.path('service-worker.js'), line: 3 }
  // Act
  for (const foreign of [foreignOne, foreignTwo])
    editor.adapter.stop(
      foreign,
      'breakpoint',
      [editor.adapterIdAt(foreign, 'service-worker.js', 3)],
      frame,
    )
  await sleep(20)
  const pausesAfterForeign = created.debug.pauses().length
  editor.adapter.stop(
    own,
    'breakpoint',
    [editor.adapterIdAt(own, 'service-worker.js', 3)],
    frame,
  )
  await until(() => created.debug.pauses().length === 1)
  // Assert
  assert.equal(pausesAfterForeign, 0)
  assert.equal(created.debug.pauses()[0]?.sessionId, 'worker-session')
  await created.debug.release()
  await editor.dispose()
})

// protects=a surface that never appears is refused with SURFACE_NOT_ATTACHED; fails_when=the attach waits past its bound or reports another code; no_claim=the real 20 s bound
test('an attach whose surface page never appears is refused with SURFACE_NOT_ATTACHED', async () => {
  // Arrange
  const editor = await extensionEditorHarness({
    constants: { EXTENSION_OPEN_BOUND_MS: 80 },
  })
  const { debug } = editor.createDebugger([PAGE_STOP])
  // Act
  const attaching = debug.attach(SIGNAL())
  // Assert
  await assert.rejects(
    attaching,
    (error: unknown) =>
      error instanceof StudyError &&
      error.code === 'SURFACE_NOT_ATTACHED' &&
      error.message === 'The debugger could not attach to the extension popup.',
  )
  await debug.release()
  await editor.dispose()
})

// protects=TZ3 and the waking phase: the launch stopped every worker so js-debug could attach, so waking starts the extension's worker before it waits for its child session, and journals that intervention (CR10); fails_when=waking only waits, as in the Cycle 0061 pt2 native dry run where every start with a worker stop failed with SERVICE_WORKER_NOT_ATTACHED; no_claim=real Chrome starting the worker (real-Chrome tests, N61)
test('waking starts the extension worker once when no worker session is attached, then adopts its child session', async () => {
  // Arrange
  const editor = await extensionEditorHarness({})
  const created = editor.createDebugger([WORKER_STOP])
  const attaching = created.debug.attach(SIGNAL())
  await until(() => editor.started.length > 0)
  await editor.addChild({ kind: 'page', id: 'page-session', title: 'Popup' })
  await attaching
  // Act
  const waking = created.debug.waitForWorker(SIGNAL())
  await until(() => created.startWorkerCalls.length > 0)
  await editor.addChild({
    kind: 'service_worker',
    id: 'worker-session',
    title: 'service-worker.js',
  })
  await waking
  // Assert
  assert.deepEqual(created.startWorkerCalls, [1])
  // The debugger runs in the harness's module realm: its arrays are copied into this one before comparing.
  assert.deepEqual(
    Array.from(
      created.debug.interventions(),
      (intervention) => intervention.kind,
    ),
    ['start-worker'],
  )
  assert.equal(created.debug.workerGeneration(), 1)
  await created.debug.release()
  await editor.dispose()
})

// protects=ER16: a stop the adapter reports right after it answered a continue, before the continue call returns, stays an open pause that is captured and offered to the chat; fails_when=the continue's own bookkeeping closes the thread's newer pause, as in the Cycle 0061 pt2 native dry run, where the page stayed paused at its second stop while the run forgot it, listed it as reached and timed out reading the result; no_claim=real js-debug message timing
test('a stop the adapter reports right after answering a continue stays open and is captured', async () => {
  // Arrange
  const run = await readyRun([PAGE_STOP, SECOND_PAGE_STOP], {
    withWorker: false,
  })
  run.editor.adapter.stop(
    run.page,
    'breakpoint',
    [run.editor.adapterIdAt(run.page, 'popup.js', 2)],
    { file: run.editor.path('popup.js'), line: 2 },
  )
  await until(() => run.debug.pauses()[0]?.status === 'captured')
  const [first] = run.debug.pauses()
  run.editor.adapter.stopAfterContinue(
    run.page,
    'breakpoint',
    [run.editor.adapterIdAt(run.page, 'popup.js', 3)],
    { file: run.editor.path('popup.js'), line: 3 },
  )
  // Act
  await run.debug.resume(first!.continueArguments!, SIGNAL())
  await until(() => run.debug.pauses()[0]?.status === 'captured')
  // Assert
  assert.deepEqual(
    run.debug.pauses().map((pause) => [pause.stopIndex, pause.status]),
    [[2, 'captured']],
  )
  assert.deepEqual(plain(run.debug.stopsNotReached()), [])
  await run.debug.release()
  await run.editor.dispose()
})

// protects=a worker that never starts is refused with SERVICE_WORKER_NOT_ATTACHED; fails_when=the wait ends with another code; no_claim=the real 5 s bound
test('a worker session that never appears is refused with SERVICE_WORKER_NOT_ATTACHED', async () => {
  // Arrange
  const run = await readyRun([PAGE_STOP], {
    withWorker: false,
    constants: { EXTENSION_WAKE_BOUND_MS: 80 },
  })
  // Act
  const waiting = run.debug.waitForWorker(SIGNAL())
  // Assert
  await assert.rejects(
    waiting,
    (error: unknown) =>
      error instanceof StudyError &&
      error.code === 'SERVICE_WORKER_NOT_ATTACHED' &&
      error.message ===
        "The extension's service worker did not start while popup was open.",
  )
  await run.debug.release()
  await run.editor.dispose()
})

// protects=a worker `breakpoint` news is matched to the worker's own logical stop when a page stop shares the line, so a worker restart is detected; fails_when=the news resolves to the page stop, is ignored as a context mismatch and the click passes with the worker stop unverified; no_claim=real js-debug restart
test('a worker restart on a line the page also stops at bumps the generation and the click waits for the worker stop to verify again', async () => {
  // Arrange
  const run = await readyRun([
    { file: 'popup.js', line: 2, context: 'page' },
    { file: 'popup.js', line: 2, context: 'service-worker' },
  ])
  const workerId = run.editor.adapterIdAt(run.worker, 'popup.js', 2)
  // Act
  run.editor.adapter.breakpointNews(run.worker, workerId, false, 2)
  const generationAfterLoss = run.debug.workerGeneration()
  let readyResolved = false
  const ready = run.debug.ensureWorkerReady(SIGNAL()).then(() => {
    readyResolved = true
  })
  // gstack-timing-ok: the click must keep waiting while the worker stop is unverified, so holding it unverified for a fixed time is the contract
  await sleep(120)
  const resolvedBeforeVerified = readyResolved
  run.editor.adapter.breakpointNews(run.worker, workerId, true, 2)
  await ready
  // Assert
  assert.equal(generationAfterLoss, 2)
  assert.equal(resolvedBeforeVerified, false)
  assert.deepEqual(
    plain(run.debug.interventions().map((entry) => entry.kind)),
    ['re-arm'],
  )
  await run.debug.release()
  await run.editor.dispose()
})

// protects=a pause in a session the run ignores (another tab) is continued and journaled as an intervention; fails_when=the foreign thread stays paused for good or Codebook resumes it without disclosing; no_claim=which tabs js-debug attaches
test('a pause in another tab’s session is continued and journaled as resume-foreign-pause', async () => {
  // Arrange
  const run = await readyRun([PAGE_STOP])
  const other = await run.editor.addChild({
    kind: 'page',
    id: 'other-page',
  })
  // Act
  run.editor.adapter.stop(other, 'pause', undefined, undefined, 4)
  await until(() =>
    run.editor.requests.some(
      (request) =>
        request.sessionId === 'other-page' && request.command === 'continue',
    ),
  )
  // Assert
  assert.deepEqual(
    plain(run.editor.requests.filter((r) => r.command === 'continue')),
    [
      {
        sessionId: 'other-page',
        command: 'continue',
        arguments: { threadId: 4 },
      },
    ],
  )
  assert.deepEqual(
    plain(run.debug.interventions().map((entry) => entry.kind)),
    ['resume-foreign-pause'],
  )
  assert.equal(run.debug.pauses().length, 0)
  await run.debug.release()
  await run.editor.dispose()
})

// protects=once the run told the debugger the browser is closing, a worker session that ends with an open pause is the close's doing and fails nothing; fails_when=SERVICE_WORKER_LOST is raised during cleanup; no_claim=the browser close itself
test('a worker session that ends with an open pause after the browser is closing does not fail the run', async () => {
  // Arrange
  const run = await readyRun([WORKER_STOP])
  run.editor.adapter.stop(
    run.worker,
    'breakpoint',
    [run.editor.adapterIdAt(run.worker, 'service-worker.js', 3)],
    { file: run.editor.path('service-worker.js'), line: 3 },
  )
  await until(() => run.debug.pauses().length === 1)
  // Act
  run.debug.browserClosing()
  run.editor.adapter.end(run.worker)
  // Assert
  assert.deepEqual(run.failures, [])
  assert.equal(run.debug.pauses().length, 0)
  await run.debug.release()
  await run.editor.dispose()
})

// protects=a declared continue the adapter refuses keeps the pause open and lets the same arguments try again; fails_when=the pause closes, stays claimed (STALE_PAUSE on retry) or the refusal is swallowed; no_claim=js-debug's own refusal reasons
test('a declared continue the adapter refuses keeps the pause and a retry is allowed', async () => {
  // Arrange
  const run = await readyRun([PAGE_STOP])
  run.editor.adapter.stop(
    run.page,
    'breakpoint',
    [run.editor.adapterIdAt(run.page, 'popup.js', 2)],
    { file: run.editor.path('popup.js'), line: 2 },
  )
  await until(() => run.debug.pauses()[0]?.status === 'captured')
  const args = run.debug.pauses()[0]!.continueArguments!
  run.editor.adapter.refuseContinues(true)
  // Act
  await assert.rejects(run.debug.resume(args, SIGNAL()), /refused/)
  const stillPaused = run.debug.pauses().length
  run.editor.adapter.refuseContinues(false)
  await run.debug.resume(args, SIGNAL())
  // Assert
  assert.equal(stillPaused, 1)
  assert.equal(run.debug.pauses().length, 0)
  await run.debug.release()
  await run.editor.dispose()
})

// protects=a second continue of a declared pause while the first still claims it is stale; fails_when=two continues are sent for one pause; no_claim=the order of the adapter's replies
test('a second continue of a declared pause while the first is in progress answers STALE_PAUSE', async () => {
  // Arrange
  const gate = defer<void>()
  const run = await readyRun([PAGE_STOP], { captureGate: gate.promise })
  run.editor.adapter.stop(
    run.page,
    'breakpoint',
    [run.editor.adapterIdAt(run.page, 'popup.js', 2)],
    { file: run.editor.path('popup.js'), line: 2 },
  )
  await until(() => run.debug.pauses().length === 1)
  const args = run.debug.pauses()[0]!.continueArguments!
  // Act
  const first = run.debug.resume(args, SIGNAL())
  const second = run.debug.resume(args, SIGNAL())
  // Assert
  await assert.rejects(
    second,
    (error: unknown) =>
      error instanceof StudyError && error.code === 'STALE_PAUSE',
  )
  gate.resolve()
  await first
  assert.equal(
    run.editor.requests.filter((request) => request.command === 'continue')
      .length,
    1,
  )
  await run.debug.release()
  await run.editor.dispose()
})

// protects=the learner pressing Continue in the editor closes a learner pause; fails_when=a continued learner thread stays listed as paused; no_claim=the learner's UI
test('a learner pause ends when the learner continues it in the editor', async () => {
  // Arrange
  const run = await readyRun([PAGE_STOP])
  run.editor.adapter.stop(run.page, 'pause')
  await until(() => run.debug.pauses().length === 1)
  // Act
  run.editor.adapter.learnerContinues(run.page)
  // Assert
  assert.equal(run.debug.pauses().length, 0)
  await run.debug.release()
  await run.editor.dispose()
})

// protects=a learner pause whose owning session ends is closed and the run is not failed; fails_when=the pause stays listed or the run fails; no_claim=worker sessions (their loss fails by design)
test('a learner pause ends with its owning session and does not fail the run', async () => {
  // Arrange
  const run = await readyRun([PAGE_STOP])
  run.editor.adapter.stop(run.page, 'pause')
  await until(() => run.debug.pauses().length === 1)
  // Act
  run.editor.adapter.end(run.page)
  // Assert
  assert.equal(run.debug.pauses().length, 0)
  assert.deepEqual(run.failures, [])
  await run.debug.release()
  await run.editor.dispose()
})

// protects=a learner pause has no hold timer, so the page hold never expires it; fails_when=a learner pause fails the run with PAUSE_HOLD_EXPIRED; no_claim=the declared pause hold
test('a learner pause stays open past the page hold without failing the run', async (context) => {
  // Arrange
  const run = await readyRun([PAGE_STOP])
  context.mock.timers.enable({ apis: ['setTimeout'] })
  // Act
  run.editor.adapter.stop(run.page, 'pause')
  await flush()
  context.mock.timers.tick(600_000)
  // Assert
  assert.equal(run.debug.pauses().length, 1)
  assert.deepEqual(run.failures, [])
  context.mock.timers.reset()
  await run.debug.release()
  await run.editor.dispose()
})

// protects=real js-debug 1.140 gives a page child a `__pendingTargetId` that is its own CDP session id, so the surface is found by the session tree; fails_when=the attach is refused with SURFACE_NOT_ATTACHED because the session id is compared with the target id; no_claim=real js-debug
test('attach succeeds when the page child carries js-debug’s own session id instead of the surface target id', async () => {
  // Arrange
  const editor = await extensionEditorHarness()
  const { debug } = editor.createDebugger([PAGE_STOP])
  const attaching = debug.attach(SIGNAL())
  await until(() => editor.started.length > 0)
  // Act
  const page = await editor.addChild({ kind: 'page', id: 'page-session' })
  await attaching
  // Assert
  assert.equal(
    page.configuration.__pendingTargetId,
    'js-debug-session-page-session',
  )
  await debug.release()
  await editor.dispose()
})

// protects=a service worker started under the surface's page session is the run's worker with the generation bumped and the manifest's worker URL; fails_when=the worker is never adopted (SERVICE_WORKER_NOT_ATTACHED) or its URL differs; no_claim=how js-debug creates the worker session
test('a worker child under the surface page is adopted as the extension’s worker with the chrome-extension worker URL', async () => {
  // Arrange
  const editor = await extensionEditorHarness()
  const created = editor.createDebugger([WORKER_STOP])
  const attaching = created.debug.attach(SIGNAL())
  await until(() => editor.started.length > 0)
  await editor.addChild({ kind: 'page', id: 'page-session' })
  await attaching
  const generationBefore = created.debug.workerGeneration()
  // Act
  await editor.addChild({ kind: 'service_worker', id: 'worker-session' })
  await created.debug.waitForWorker(SIGNAL())
  await created.debug.armStops(SIGNAL())
  created.debug.markReady()
  const worker = editor.session('worker-session')
  editor.adapter.stop(
    worker,
    'breakpoint',
    [editor.adapterIdAt(worker, 'service-worker.js', 3)],
    { file: editor.path('service-worker.js'), line: 3 },
  )
  await until(() => created.debug.pauses().length === 1)
  // Assert
  assert.equal(created.debug.workerGeneration(), generationBefore + 1)
  assert.equal(created.debug.pauses()[0]?.sessionId, 'worker-session')
  await created.debug.release()
  await editor.dispose()
})

// protects=a second page child of the attach is another tab: ignored, its pause continued, and journaled once so it is visible; fails_when=the second page becomes the surface, arms a stop, or nothing is journaled; no_claim=which tabs js-debug attaches
test('a second page child of the attach is ignored and journaled once as a debugger error', async () => {
  // Arrange
  const editor = await extensionEditorHarness()
  const created = editor.createDebugger([PAGE_STOP])
  const attaching = created.debug.attach(SIGNAL())
  await until(() => editor.started.length > 0)
  await editor.addChild({ kind: 'page', id: 'page-session' })
  await attaching
  // Act
  await editor.addChild({ kind: 'page', id: 'second-page' })
  await editor.addChild({ kind: 'page', id: 'third-page' })
  const second = editor.session('second-page')
  editor.adapter.stop(second, 'pause', undefined, undefined, 4)
  await until(() =>
    editor.requests.some(
      (request) =>
        request.sessionId === 'second-page' && request.command === 'continue',
    ),
  )
  // Assert
  assert.deepEqual(
    plain(
      created.events
        .filter((event) => event.type === 'chrome-extension.debugger-error')
        .map((event) => event.detail),
    ),
    [
      {
        message: 'A second page matching the surface URL is open and ignored.',
      },
    ],
  )
  assert.deepEqual(created.debug.pauses(), [])
  await created.debug.release()
  await editor.dispose()
})

// protects=once the surface session has ended, a later page child is another tab, never a new surface whose pause is captured as a declared stop; fails_when=the later page is adopted as the surface or its pause is captured; no_claim=which tabs js-debug attaches
test('a page child appearing after the surface session ended is ignored and its pause is not captured', async () => {
  // Arrange
  const editor = await extensionEditorHarness()
  const created = editor.createDebugger([PAGE_STOP])
  const attaching = created.debug.attach(SIGNAL())
  await until(() => editor.started.length > 0)
  await editor.addChild({ kind: 'page', id: 'page-session' })
  await attaching
  editor.adapter.end(editor.session('page-session'))
  // Act
  await editor.addChild({ kind: 'page', id: 'later-page' })
  const later = editor.session('later-page')
  editor.adapter.stop(later, 'pause', undefined, undefined, 4)
  await until(() =>
    editor.requests.some(
      (request) =>
        request.sessionId === 'later-page' && request.command === 'continue',
    ),
  )
  // Assert
  assert.deepEqual(created.debug.pauses(), [])
  assert.deepEqual(
    plain(
      created.events
        .filter((event) => event.type === 'chrome-extension.debugger-error')
        .map((event) => event.detail),
    ),
    [
      {
        message: 'A second page matching the surface URL is open and ignored.',
      },
    ],
  )
  await created.debug.release()
  await editor.dispose()
})

// protects=a service-worker child directly under the root (not under the surface) never arms a stop and its pause is continued; fails_when=it is adopted as the extension's worker; no_claim=js-debug's session creation
test('a service-worker child under the root instead of the surface page is not the extension’s worker and never pauses a stop', async () => {
  // Arrange
  const editor = await extensionEditorHarness()
  const created = editor.createDebugger([WORKER_STOP])
  const attaching = created.debug.attach(SIGNAL())
  await until(() => editor.started.length > 0)
  await editor.addChild({ kind: 'page', id: 'page-session' })
  await attaching
  // Act
  const stray = await editor.addChild({
    kind: 'service_worker',
    id: 'stray-worker',
    parent: editor.session('root-session'),
  })
  editor.adapter.stop(stray, 'pause', undefined, undefined, 5)
  await until(() =>
    editor.requests.some(
      (request) =>
        request.sessionId === 'stray-worker' && request.command === 'continue',
    ),
  )
  // Assert
  assert.deepEqual(created.debug.pauses(), [])
  assert.equal(created.debug.workerGeneration(), 0)
  await created.debug.release()
  await editor.dispose()
})

// protects=the adopted page child is the surface only while the surface is the single page target matching the surface URL (Cycle 0062 task 13, task 9); fails_when=a second matching page that attached first is adopted as the surface; no_claim=which js-debug session belongs to which target
test('the attach is refused when a second page matching the surface URL is open, so no other tab becomes the surface', async () => {
  // Arrange
  const editor = await extensionEditorHarness()
  const created = editor.createDebugger([PAGE_STOP], {
    targets: [
      { targetId: 'other-tab', type: 'page', url: SURFACE_URL },
      { targetId: 'surface-target', type: 'page', url: SURFACE_URL },
    ],
  })
  const attaching = created.debug.attach(SIGNAL())
  await until(() => editor.started.length > 0)
  // Act
  await editor.addChild({ kind: 'page', id: 'other-tab-session' })
  // Assert
  await assert.rejects(
    attaching,
    (error) =>
      error instanceof StudyError && error.code === 'SURFACE_NOT_ATTACHED',
  )
  assert.deepEqual(
    plain(
      created.events
        .filter((event) => event.type === 'chrome-extension.debugger-error')
        .map((event) => event.detail),
    ),
    [
      {
        message:
          'The attached page could not be tied to the surface target; another page matches the surface URL.',
      },
    ],
  )
  await created.debug.release()
  await editor.dispose()
})

// protects=the attach tie compares the whole surface URL (Cycle 0062 review OCR-L2); fails_when=a page of the same file with a query string counts as a second surface and the attach is refused; no_claim=which js-debug session belongs to which target
test('the attach succeeds when another page of the same file differs only by a query string', async () => {
  // Arrange
  const editor = await extensionEditorHarness()
  const created = editor.createDebugger([PAGE_STOP], {
    targets: [
      { targetId: 'query-tab', type: 'page', url: `${SURFACE_URL}?x=1` },
      { targetId: 'surface-target', type: 'page', url: SURFACE_URL },
    ],
  })
  const attaching = created.debug.attach(SIGNAL())
  await until(() => editor.started.length > 0)
  // Act
  await editor.addChild({ kind: 'page', id: 'page-session' })
  // Assert
  await attaching
  assert.deepEqual(
    created.events.filter(
      (event) => event.type === 'chrome-extension.debugger-error',
    ),
    [],
  )
  await created.debug.release()
  await editor.dispose()
})

// protects=the worker child is adopted when the browser's target list lists the extension's worker only after the child appeared (Cycle 0062 review OCR-L3); fails_when=one early read of the list demotes the child for good and the attach fails with SERVICE_WORKER_NOT_ATTACHED; no_claim=real js-debug timing
test('a worker child is adopted when the target list shows the extension’s worker a moment after the child appeared', async () => {
  // Arrange
  const targets: { targetId: string; type: string; url: string }[] = [
    { targetId: 'surface-target', type: 'page', url: SURFACE_URL },
  ]
  const editor = await extensionEditorHarness()
  const created = editor.createDebugger([WORKER_STOP], { targets })
  const attaching = created.debug.attach(SIGNAL())
  await until(() => editor.started.length > 0)
  await editor.addChild({ kind: 'page', id: 'page-session' })
  await attaching
  await editor.addChild({ kind: 'service_worker', id: 'worker-session' })
  // Act
  const waking = created.debug.waitForWorker(SIGNAL())
  void sleep(50).then(() =>
    targets.push({
      targetId: 'worker-target',
      type: 'service_worker',
      url: WORKER_URL,
    }),
  )
  // Assert
  await waking
  assert.deepEqual(
    created.events.filter(
      (event) => event.type === 'chrome-extension.debugger-error',
    ),
    [],
  )
  await created.debug.release()
  await editor.dispose()
})

// protects=a worker child of the surface page is the extension's worker only while the browser lists the extension's service-worker target (Cycle 0062 task 12); fails_when=a worker child of another URL is adopted and armed; no_claim=which js-debug session belongs to which target
test('a worker child of the surface page is not adopted while the extension’s own worker target is not listed', async () => {
  // Arrange
  const editor = await extensionEditorHarness({
    constants: { EXTENSION_WAKE_BOUND_MS: 80 },
  })
  const created = editor.createDebugger([WORKER_STOP], {
    targets: [
      {
        targetId: 'surface-target',
        type: 'page',
        url: SURFACE_URL,
      },
      {
        targetId: 'foreign-worker-target',
        type: 'service_worker',
        url: 'chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba/service-worker.js',
      },
    ],
  })
  const attaching = created.debug.attach(SIGNAL())
  await until(() => editor.started.length > 0)
  await editor.addChild({ kind: 'page', id: 'page-session' })
  await attaching
  const foreign = await editor.addChild({
    kind: 'service_worker',
    id: 'foreign-worker',
  })
  // Act
  const waking = created.debug.waitForWorker(SIGNAL())
  // Assert
  await assert.rejects(
    waking,
    (error) =>
      error instanceof StudyError &&
      error.code === 'SERVICE_WORKER_NOT_ATTACHED',
  )
  editor.adapter.stop(foreign, 'pause', undefined, undefined, 6)
  await until(() =>
    editor.requests.some(
      (request) =>
        request.sessionId === 'foreign-worker' &&
        request.command === 'continue',
    ),
  )
  assert.deepEqual(created.debug.pauses(), [])
  await created.debug.release()
  await editor.dispose()
})

// protects=a failed debugger release is journaled and its tracker and termination listeners are still disposed (Cycle 0062 task 16); fails_when=the failure is not journaled or a listener stays registered after the failed stop; no_claim=the editor's own stop semantics
test('a release whose session would not stop journals the failure, rethrows it and still disposes both listeners', async () => {
  // Arrange
  const editor = await extensionEditorHarness()
  const created = editor.createDebugger([PAGE_STOP])
  const attaching = created.debug.attach(SIGNAL())
  await until(() => editor.started.length > 0)
  await editor.addChild({ kind: 'page', id: 'page-session' })
  await attaching
  editor.failStopDebugging(new Error('the editor could not stop the session'))
  // Act
  const releasing = created.debug.release()
  // Assert
  await assert.rejects(releasing, /the editor could not stop the session/)
  assert.deepEqual(editor.listeners(), { tracker: false, termination: false })
  assert.deepEqual(
    plain(
      created.events
        .filter((event) => event.type === 'chrome-extension.debugger-error')
        .map((event) => event.detail),
    ),
    [{ message: 'Error: the editor could not stop the session' }],
  )
  await editor.dispose()
})
