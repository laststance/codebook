import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import {
  appendFile,
  chmod,
  mkdir,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises'
import { join } from 'node:path'
import { before, test } from 'node:test'

import type { ExtensionPauseView } from '../chromeExtensionDebugger'
import type { ExtensionFrameBudget } from '../chromeExtensionHistoryFrames'
import { ExtensionHistoryPauseTracker } from '../chromeExtensionHistoryPauseTracker'
import { ChromeExtensionHistoryRecorder } from '../chromeExtensionHistoryRecorder'
import type { ExtensionHistoryPause } from '../chromeExtensionHistorySink'
import type { ExtensionHistoryJournalLimits } from '../chromeExtensionHistoryWriter'
import { createExtensionStorageDescriptor } from '../chromeExtensionStorageDescriptor'
import { NODE_TEST_HISTORY_WRITER_FILE } from '../constants'
import { NodeHistoryStore } from '../nodeTestHistoryStore'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import {
  capturedStop,
  EXTENSION_WORKSPACE_KEY,
  extensionHistoryHeader,
  openExtensionStore,
  pngOf,
} from './utils/chromeExtensionHistoryFixture'
import { realProcessStart } from './utils/realProcessStart'

before(async () => {
  await realProcessStart(process.pid)
})

const EXTENSION_URL = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop'

/** A declared pause of the page, or of the service worker. */
function pauseOf(
  generation: number,
  context: 'page' | 'service-worker',
): ExtensionHistoryPause {
  return {
    pauseId: `run:${generation}:${context}:${generation}`,
    generation,
    context,
    stopIndex: generation,
    targetUrl: `${EXTENSION_URL}/${context === 'page' ? 'popup.html' : 'worker.js'}`,
    workerGeneration: context === 'page' ? 0 : 1,
  }
}

/** Starts a recorder over a real store whose run clock the test moves by hand. */
async function recorderOver(
  context: Parameters<typeof openExtensionStore>[0],
  options: {
    limits?: ExtensionHistoryJournalLimits
    frameBudget?: ExtensionFrameBudget
    onFault?: (error: unknown) => void
  } = {},
) {
  const clock = { nowMs: 10 }
  const { store, learningDirectory } = await openExtensionStore(
    context,
    () => clock.nowMs,
    options.limits,
  )
  const header = extensionHistoryHeader(EXTENSION_WORKSPACE_KEY)
  const begun = await ChromeExtensionHistoryRecorder.begin({
    start: () => store.start(header),
    describeCause: String,
    summarize: (studyId) => store.summarize(studyId),
    retryDelay: async () => undefined,
    ...(options.onFault ? { onFault: options.onFault } : {}),
    ...(options.frameBudget ? { frameBudget: options.frameBudget } : {}),
  })
  assert.ok('recorder' in begun)
  return { recorder: begun.recorder, store, header, learningDirectory, clock }
}

/** A store over the same folder as `learningDirectory`, as another editor window or a restarted editor opens it. */
function reopenedStore(learningDirectory: string) {
  return new NodeHistoryStore(
    createExtensionStorageDescriptor(),
    learningDirectory,
    EXTENSION_WORKSPACE_KEY,
  )
}

/** Hands a stream frame to the recorder at the clock's current time. */
function streamFrame(
  recorder: ChromeExtensionHistoryRecorder,
  salt: string,
): void {
  recorder.frameObserver.frame({
    data: pngOf(720, 640, salt).toString('base64'),
    elapsedMs: recorder.frameObserver.elapsedMs(),
    kind: 'stream',
  })
}

/** Hands the screenshot of a pause to the recorder, as the run does. */
function pin(
  recorder: ChromeExtensionHistoryRecorder,
  pauseId: string,
  salt: string,
): void {
  recorder.pinned(pauseId, pngOf(720, 640, salt).toString('base64'))
}

/** Opens a pause and journals its capture. */
function openCaptured(
  recorder: ChromeExtensionHistoryRecorder,
  pause: ExtensionHistoryPause,
): void {
  recorder.pauseOpened(pause)
  recorder.captured(
    pause.pauseId,
    capturedStop({ stopIndex: pause.stopIndex, context: pause.context }),
  )
}

/** Waits until the history's folder holds this many entries. */
async function entriesDurable(
  store: Awaited<ReturnType<typeof recorderOver>>['store'],
  studyId: string,
  count: number,
): Promise<void> {
  await waitUntil(
    async () => (await store.read(studyId)).entries.length >= count,
    `${count} entries to be durable`,
  )
}

const CHANGED_RESULT = {
  kind: 'text' as const,
  before: { value: 'idle' },
  after: { value: 'pong' },
  changed: true,
  observedAtMs: 900,
}

// protects=E-B: the run's pinned pause screenshot becomes a pin frame naming its pause, appended after its blob is durable, and the seal names no missing pin; fails_when=the pin is not stored, names another pause, or the seal names a missing pin; no_claim=the screenshot from Chrome
test('a pinned pause frame is recorded as a pin naming its pause and no pinned frame is reported missing', async (context) => {
  // Arrange
  const { recorder, store, header } = await recorderOver(context)
  const page = pauseOf(1, 'page')
  openCaptured(recorder, page)

  // Act
  pin(recorder, page.pauseId, 'page pin')
  recorder.pauseClosed(page.pauseId, 'continue')
  recorder.resultObserved(CHANGED_RESULT)
  streamFrame(recorder, 'surface')
  await recorder.seal({}, 5_000)
  const history = await store.read(header.studyId)

  // Assert
  assert.deepEqual(
    history.seal?.reasons.map((reason) => reason.code),
    ['EXTENSION_HISTORY_STOP_NOT_REACHED'],
  )
  const pins = history.entries.filter(
    (entry) => entry.type === 'frame' && entry.kind === 'pin',
  )
  assert.deepEqual(
    pins.map((entry) => entry.type === 'frame' && entry.pauseId),
    [page.pauseId],
  )
})

// protects=E-B: a pause the live run never pinned (a paused page that did not answer its screenshot) is no recording loss, so a history whose other parts are present seals complete with nothing missing; fails_when=a pause without a pin frame is named EXTENSION_HISTORY_PINNED_FRAME_MISSING or makes the capture partial; no_claim=a pin the run captured and the history lost (next tests)
test('a sealed history whose pauses the live run never pinned reads complete with nothing missing', async (context) => {
  // Arrange
  const { recorder, store, header } = await recorderOver(context)
  const page = pauseOf(1, 'page')
  const worker = pauseOf(2, 'service-worker')

  // Act
  openCaptured(recorder, page)
  recorder.pauseClosed(page.pauseId, 'continue')
  openCaptured(recorder, worker)
  recorder.pauseClosed(worker.pauseId, 'continue')
  recorder.resultObserved(CHANGED_RESULT)
  streamFrame(recorder, 'surface')
  await recorder.seal({}, 5_000)
  const history = await store.read(header.studyId)

  // Assert
  assert.equal(history.status, 'complete')
  assert.deepEqual(history.seal?.reasons, [])
  assert.equal(
    history.entries.some(
      (entry) => entry.type === 'frame' && entry.kind === 'pin',
    ),
    false,
  )
})

// protects=E-B: a pin the live run captured and the frame budget refused is a missing recorded part, named with its stop, and the capture reads partial; fails_when=the refused pin is silent or the history reads complete; no_claim=the production budget sizes (injected small)
test('a captured pin the frame budget refuses is named missing and the capture reads partial', async (context) => {
  // Arrange
  const { recorder, store, header } = await recorderOver(context, {
    frameBudget: {
      frames: 1,
      pngBytes: 1_000_000,
      pinReserveFrames: 0,
      pinReserveBytes: 0,
    },
  })
  const page = pauseOf(1, 'page')
  const worker = pauseOf(2, 'service-worker')
  openCaptured(recorder, page)
  openCaptured(recorder, worker)
  streamFrame(recorder, 'surface')

  // Act
  pin(recorder, page.pauseId, 'refused by the budget')
  recorder.pauseClosed(page.pauseId, 'continue')
  recorder.pauseClosed(worker.pauseId, 'continue')
  recorder.resultObserved(CHANGED_RESULT)
  await recorder.seal({}, 5_000)
  const history = await store.read(header.studyId)

  // Assert
  assert.equal(history.status, 'partial')
  assert.deepEqual(
    history.seal?.reasons.map((reason) => [reason.code, reason.params]),
    [['EXTENSION_HISTORY_PINNED_FRAME_MISSING', { stop: 1 }]],
  )
})

// protects=E-B: a pin that arrives after the history began finalizing is dropped and the pause is named as having no pinned frame; fails_when=the pin is written after the seal began, or the pause is not named; no_claim=how long the run waits (it never waits)
test('a pin arriving after the history began finalizing is dropped and the pause is named without a pinned frame', async (context) => {
  // Arrange
  const { recorder, store, header } = await recorderOver(context)
  const page = pauseOf(1, 'page')
  openCaptured(recorder, page)
  recorder.resultObserved(CHANGED_RESULT)

  // Act
  const sealing = recorder.seal({}, 5_000)
  pin(recorder, page.pauseId, 'too late')
  await sealing
  const history = await store.read(header.studyId)

  // Assert
  assert.equal(history.status, 'partial')
  assert.equal(
    history.entries.some(
      (entry) => entry.type === 'frame' && entry.kind === 'pin',
    ),
    false,
  )
  assert.deepEqual(
    history.seal?.reasons
      .filter((reason) => reason.code.endsWith('PINNED_FRAME_MISSING'))
      .map((reason) => reason.params),
    [{ stop: 1 }],
  )
})

// protects=E-B: a second pin for one pause and a pin for a pause the history never opened are ignored without failing the writer; fails_when=either reaches the journal (the writer then refuses everything after it) or the seal names more than the stop never reached; no_claim=which pin is better
test('a second pin for a pause and a pin for an unknown pause are ignored', async (context) => {
  // Arrange
  const { recorder, store, header } = await recorderOver(context)
  const page = pauseOf(1, 'page')
  openCaptured(recorder, page)

  // Act
  pin(recorder, page.pauseId, 'first')
  pin(recorder, page.pauseId, 'second')
  pin(recorder, 'run:9:page:9', 'unknown pause')
  recorder.pauseClosed(page.pauseId, 'continue')
  recorder.resultObserved(CHANGED_RESULT)
  streamFrame(recorder, 'surface')
  await recorder.seal({}, 5_000)
  const history = await store.read(header.studyId)

  // Assert
  assert.deepEqual(
    history.seal?.reasons.map((reason) => reason.code),
    ['EXTENSION_HISTORY_STOP_NOT_REACHED'],
  )
  assert.equal(
    history.seal?.reasons.some((reason) =>
      reason.code.endsWith('PINNED_FRAME_MISSING'),
    ),
    false,
  )
  assert.equal(
    history.entries.filter(
      (entry) => entry.type === 'frame' && entry.kind === 'pin',
    ).length,
    1,
  )
})

// protects=matrix: a page pause that ends first while a worker pause overlaps it journals both and pins each; fails_when=an overlapping close, capture or pin is refused by the order rules; no_claim=the debugger's own ordering
test('overlapping pauses closed in the order they opened are both journaled and pinned', async (context) => {
  // Arrange
  const { recorder, store, header } = await recorderOver(context)
  const page = pauseOf(1, 'page')
  const worker = pauseOf(2, 'service-worker')

  // Act
  openCaptured(recorder, page)
  openCaptured(recorder, worker)
  pin(recorder, page.pauseId, 'page')
  pin(recorder, worker.pauseId, 'worker')
  recorder.pauseClosed(page.pauseId, 'continue')
  recorder.pauseClosed(worker.pauseId, 'continue')
  recorder.resultObserved(CHANGED_RESULT)
  streamFrame(recorder, 'surface')
  await recorder.seal({}, 5_000)
  const history = await store.read(header.studyId)

  // Assert
  assert.equal(history.status, 'complete')
  assert.deepEqual(
    history.entries
      .filter((entry) => entry.type === 'pause-close')
      .map((entry) => entry.pauseId),
    [page.pauseId, worker.pauseId],
  )
})

// protects=matrix: the later pause ending first journals both and pins each; fails_when=a close before the earlier pause's close is refused; no_claim=the debugger's own ordering
test('overlapping pauses closed in the reverse order are both journaled and pinned', async (context) => {
  // Arrange
  const { recorder, store, header } = await recorderOver(context)
  const page = pauseOf(1, 'page')
  const worker = pauseOf(2, 'service-worker')

  // Act
  openCaptured(recorder, page)
  openCaptured(recorder, worker)
  pin(recorder, page.pauseId, 'page')
  pin(recorder, worker.pauseId, 'worker')
  recorder.pauseClosed(worker.pauseId, 'continue')
  recorder.pauseClosed(page.pauseId, 'continue')
  recorder.resultObserved(CHANGED_RESULT)
  streamFrame(recorder, 'surface')
  await recorder.seal({}, 5_000)
  const history = await store.read(header.studyId)

  // Assert
  assert.equal(history.status, 'complete')
  assert.deepEqual(
    history.entries
      .filter((entry) => entry.type === 'pause-close')
      .map((entry) => entry.pauseId),
    [worker.pauseId, page.pauseId],
  )
})

// protects=matrix: a pause that opens, is pinned and closes wholly inside another open pause keeps both pauses whole; fails_when=the inner pause's entries are refused or the outer pause loses its pin or close; no_claim=the debugger's own ordering
test('a pause wholly inside another pause is journaled and the outer pause keeps its pin and close', async (context) => {
  // Arrange
  const { recorder, store, header } = await recorderOver(context)
  const outer = pauseOf(1, 'page')
  const inner = pauseOf(2, 'service-worker')

  // Act
  openCaptured(recorder, outer)
  openCaptured(recorder, inner)
  pin(recorder, inner.pauseId, 'inner')
  recorder.pauseClosed(inner.pauseId, 'continue')
  pin(recorder, outer.pauseId, 'outer')
  recorder.pauseClosed(outer.pauseId, 'continue')
  recorder.resultObserved(CHANGED_RESULT)
  streamFrame(recorder, 'surface')
  await recorder.seal({}, 5_000)
  const history = await store.read(header.studyId)

  // Assert
  assert.equal(history.status, 'complete')
  assert.deepEqual(
    history.entries
      .filter((entry) => entry.type === 'frame' && entry.kind === 'pin')
      .map((entry) => entry.type === 'frame' && entry.pauseId),
    [inner.pauseId, outer.pauseId],
  )
})

// protects=E-D: a busy surface that fills the journal's stream-frame room ends only its frames: the pause close, the result and the seal still record, and the seal names the size limit and the filmstrip; fails_when=the journal fills with frames and the result is lost, or the seal is complete; no_claim=the production 8 MiB (the limits are injected small)
test('a surface that fills the journal ends its stream frames while the close, the result and the seal still record', async (context) => {
  // Arrange
  const { recorder, store, header, clock } = await recorderOver(context, {
    limits: { journalLimitBytes: 16_384 + 8_000, maxEntries: 13_100 },
  })
  const page = pauseOf(1, 'page')
  openCaptured(recorder, page)

  // Act
  for (let index = 0; index < 60; index += 1) {
    clock.nowMs += 60
    streamFrame(recorder, `frame ${index}`)
  }
  clock.nowMs += 60
  recorder.pauseClosed(page.pauseId, 'continue')
  recorder.resultObserved(CHANGED_RESULT)
  await recorder.seal({}, 5_000)
  const history = await store.read(header.studyId)

  // Assert
  assert.equal(history.status, 'partial')
  const codes = history.seal?.reasons.map((reason) => reason.code)
  assert.ok(codes?.includes('EXTENSION_HISTORY_SIZE_LIMIT'))
  assert.ok(codes?.includes('EXTENSION_HISTORY_FILMSTRIP_MISSING'))
  assert.equal(codes?.includes('EXTENSION_HISTORY_APPEND_FAILED'), false)
  assert.equal(codes?.includes('EXTENSION_HISTORY_RESULT_MISSING'), false)
  assert.equal(
    history.entries.some((entry) => entry.type === 'result'),
    true,
  )
  const frameCount = history.entries.filter(
    (entry) => entry.type === 'frame',
  ).length
  assert.ok(frameCount > 0 && frameCount < 60)
})

// protects=E-D: a pin still fits after the stream frames hit the journal's reserve, so a stop frame is not crowded out by a busy surface; fails_when=the pin is refused with the stream frames; no_claim=the production sizes
test('a pin is still recorded after the stream frames reached the journal reserve', async (context) => {
  // Arrange
  const { recorder, store, header, clock } = await recorderOver(context, {
    limits: { journalLimitBytes: 16_384 + 8_000, maxEntries: 13_100 },
  })
  const page = pauseOf(1, 'page')
  openCaptured(recorder, page)
  for (let index = 0; index < 60; index += 1) {
    clock.nowMs += 60
    streamFrame(recorder, `frame ${index}`)
  }

  // Act
  clock.nowMs += 60
  pin(recorder, page.pauseId, 'the stop')
  recorder.pauseClosed(page.pauseId, 'continue')
  recorder.resultObserved(CHANGED_RESULT)
  await recorder.seal({}, 5_000)
  const history = await store.read(header.studyId)

  // Assert
  assert.equal(
    history.entries.some(
      (entry) => entry.type === 'frame' && entry.kind === 'pin',
    ),
    true,
  )
  assert.equal(
    history.seal?.reasons.some((reason) =>
      reason.code.endsWith('PINNED_FRAME_MISSING'),
    ),
    false,
  )
})

// protects=E-D: a temporary blob a writer left behind is removed when the history seals; fails_when=a .tmp file stays in frames/ after the seal; no_claim=another window's live writer
test('a temporary frame blob with no live writer is removed when the history seals', async (context) => {
  // Arrange
  const { recorder } = await recorderOver(context)
  const page = pauseOf(1, 'page')
  openCaptured(recorder, page)
  const frames = join(recorder.writer.historyDirectory, 'frames')
  await mkdir(frames, { recursive: true })
  await writeFile(join(frames, 'abc.png.1f2e.tmp'), 'half a frame')
  recorder.resultObserved(CHANGED_RESULT)

  // Act
  await recorder.seal({}, 5_000)

  // Assert
  assert.deepEqual(await readdir(frames), [])
})

// protects=E-D: a temporary blob left by an editor that closed mid-write is removed when the history is read as interrupted, and the recorded prefix still replays; fails_when=the .tmp file stays or the interrupted prefix is lost; no_claim=a history another window still writes
test('a temporary frame blob is removed when its history is read as interrupted', async (context) => {
  // Arrange
  const { recorder, store, header, learningDirectory } =
    await recorderOver(context)
  openCaptured(recorder, pauseOf(1, 'page'))
  const frames = join(recorder.writer.historyDirectory, 'frames')
  await mkdir(frames, { recursive: true })
  await writeFile(join(frames, 'abc.png.1f2e.tmp'), 'half a frame')
  await entriesDurable(store, header.studyId, 2)
  recorder.writer.abandon()

  // Act
  const history = await reopenedStore(learningDirectory).read(header.studyId)

  // Assert
  assert.equal(history.status, 'interrupted')
  assert.deepEqual(await readdir(frames), [])
})

// protects=E-D: a history whose header version this build cannot read is never touched, not even to remove a temporary blob; fails_when=the listing or a read deletes or rewrites anything of it; no_claim=what a newer Codebook does with it
test('a history with an unreadable header version keeps its temporary blob', async (context) => {
  // Arrange
  const { recorder, header, learningDirectory } = await recorderOver(context)
  openCaptured(recorder, pauseOf(1, 'page'))
  const directory = recorder.writer.historyDirectory
  recorder.writer.abandon()
  await writeFile(
    join(directory, 'header.json'),
    JSON.stringify({ ...header, formatVersion: 2 }),
  )
  const frames = join(directory, 'frames')
  await mkdir(frames, { recursive: true })
  await writeFile(join(frames, 'abc.png.1f2e.tmp'), 'half a frame')

  // Act
  const listed = await reopenedStore(learningDirectory).list()

  // Assert
  assert.deepEqual(listed, [])
  assert.deepEqual(await readdir(frames), ['abc.png.1f2e.tmp'])
})

// protects=E-C: a torn append (bytes no entry confirmed) stops the history from sealing, so a restarted editor reads it as interrupted with its valid prefix replayable and no APPEND_FAILED claim; fails_when=the torn history seals, loses its prefix or reads complete; no_claim=which entry was torn
test('a torn append leaves an interrupted history whose valid prefix replays', async (context) => {
  // Arrange
  const { recorder, store, header, learningDirectory } =
    await recorderOver(context)
  openCaptured(recorder, pauseOf(1, 'page'))
  await entriesDurable(store, header.studyId, 2)
  await appendFile(
    join(recorder.writer.historyDirectory, 'events.jsonl'),
    '{"type":"pause-close","pauseI',
  )

  // Act
  await recorder.seal({}, 5_000)
  const history = await reopenedStore(learningDirectory).read(header.studyId)

  // Assert
  assert.equal(recorder.status, 'failed')
  assert.equal(history.status, 'interrupted')
  assert.deepEqual(
    history.entries.map((entry) => entry.type),
    ['pause-open', 'capture'],
  )
  assert.equal(history.seal, undefined)
})

// protects=E-C: a failed seal write abandons the writer and the history reads as interrupted in a fresh store with everything before it replayable; fails_when=the history reads recording or sealed, or the run's stop fails; no_claim=the Output wording (the service test)
test('a failed seal write leaves an interrupted history readable in a fresh store', async (context) => {
  // Arrange
  const { recorder, store, header, learningDirectory } =
    await recorderOver(context)
  openCaptured(recorder, pauseOf(1, 'page'))
  recorder.resultObserved(CHANGED_RESULT)
  await entriesDurable(store, header.studyId, 3)
  // A folder that accepts no new file makes the seal's publication fail.
  const directory = recorder.writer.historyDirectory
  await chmod(directory, 0o500)

  // Act
  await recorder.seal({}, 5_000)
  await chmod(directory, 0o700)
  // The editor that wrote it is gone: its writer record would otherwise name this live test process.
  await rm(join(directory, NODE_TEST_HISTORY_WRITER_FILE), { force: true })
  const history = await reopenedStore(learningDirectory).read(header.studyId)

  // Assert
  assert.equal(recorder.status, 'failed')
  assert.equal(history.status, 'interrupted')
  assert.equal(history.entries.length >= 3, true)
})

// protects=E-C: an append that fails without tearing the journal still seals partial and names EXTENSION_HISTORY_APPEND_FAILED, and a fresh store reads that partial seal; fails_when=the failure is unnamed, the seal is complete or the history reads interrupted; no_claim=the disk error text
test('an append that fails cleanly seals partial naming the failed append', async (context) => {
  // Arrange
  const faults: unknown[] = []
  const { recorder, store, header, learningDirectory } = await recorderOver(
    context,
    { onFault: (error) => faults.push(error) },
  )
  const page = pauseOf(1, 'page')
  openCaptured(recorder, page)
  await entriesDurable(store, header.studyId, 2)
  await chmod(join(recorder.writer.historyDirectory, 'events.jsonl'), 0o400)

  // Act
  recorder.pauseClosed(page.pauseId, 'continue')
  await recorder.seal({}, 5_000)
  const history = await reopenedStore(learningDirectory).read(header.studyId)

  // Assert
  assert.equal(history.status, 'partial')
  assert.equal(
    history.seal?.reasons.some(
      (reason) => reason.code === 'EXTENSION_HISTORY_APPEND_FAILED',
    ),
    true,
  )
  assert.equal(faults.length, 1)
  assert.deepEqual(
    history.entries.map((entry) => entry.type),
    ['pause-open', 'capture'],
  )
})

// protects=E-C: a failed frame blob write ends the filmstrip, is reported once, and leaves the stops, the result and a partial seal that names the filmstrip; a fresh store reads it; fails_when=the stop evidence is lost, the failure is reported twice or the seal is complete; no_claim=which blob failed
test('a failed frame blob write seals partial naming the filmstrip and reports the cause once', async (context) => {
  // Arrange
  const faults: unknown[] = []
  const { recorder, header, learningDirectory } = await recorderOver(context, {
    onFault: (error) => faults.push(error),
  })
  const page = pauseOf(1, 'page')
  openCaptured(recorder, page)
  // A file where the frames folder goes makes every blob write fail.
  await writeFile(
    join(recorder.writer.historyDirectory, 'frames'),
    'not a folder',
  )

  // Act
  streamFrame(recorder, 'surface')
  pin(recorder, page.pauseId, 'pin')
  recorder.pauseClosed(page.pauseId, 'continue')
  recorder.resultObserved(CHANGED_RESULT)
  await recorder.seal({}, 5_000)
  const history = await reopenedStore(learningDirectory).read(header.studyId)

  // Assert
  assert.equal(history.status, 'partial')
  const codes = history.seal?.reasons.map((reason) => reason.code)
  assert.ok(codes?.includes('EXTENSION_HISTORY_FILMSTRIP_MISSING'))
  assert.ok(codes?.includes('EXTENSION_HISTORY_PINNED_FRAME_MISSING'))
  assert.equal(faults.length, 1)
  assert.deepEqual(
    history.entries.map((entry) => entry.type),
    ['pause-open', 'capture', 'pause-close', 'result'],
  )
})

// protects=matrix: a frame blob lost after a successful seal leaves the sealed history readable with its frame entries and the seal it had (the reader shows the missing frame, lane A3); fails_when=a missing blob makes the read fail or changes the seal; no_claim=the replay's frame state (the reader tests)
test('a frame blob that goes missing after the seal leaves the sealed history readable', async (context) => {
  // Arrange
  const { recorder, header, learningDirectory } = await recorderOver(context)
  const page = pauseOf(1, 'page')
  openCaptured(recorder, page)
  pin(recorder, page.pauseId, 'pin')
  recorder.pauseClosed(page.pauseId, 'continue')
  recorder.resultObserved(CHANGED_RESULT)
  streamFrame(recorder, 'surface')
  await recorder.seal({}, 5_000)
  const frames = join(recorder.writer.historyDirectory, 'frames')
  for (const name of await readdir(frames)) await rm(join(frames, name))

  // Act
  const history = await reopenedStore(learningDirectory).read(header.studyId)

  // Assert
  assert.equal(history.status, 'partial')
  assert.equal(
    history.entries.filter((entry) => entry.type === 'frame').length,
    2,
  )
  assert.equal(existsSync(frames), true)
})

/** The debugger's view of a declared pause, as the pause tracker reads it. */
function declaredPauseView(
  generation: number,
  context: 'page' | 'service-worker',
): ExtensionPauseView {
  return {
    generation,
    sessionId: 'session',
    threadId: 1,
    context,
    reason: 'breakpoint',
    kind: 'declared',
    stopIndex: generation,
    status: 'capturing',
    pausedAtMs: 1,
  }
}

/** A pause tracker over the fixture extension's surface and worker. */
function newTracker(): ExtensionHistoryPauseTracker {
  return new ExtensionHistoryPauseTracker(
    'run',
    `${EXTENSION_URL}/popup.html`,
    `${EXTENSION_URL}/worker.js`,
  )
}

/** The reasons of the journal's pause-close entries, in order. */
function pauseCloseReasons(history: {
  entries: readonly { type: string; reason?: unknown }[]
}): unknown[] {
  return history.entries.flatMap((entry) =>
    entry.type === 'pause-close' ? [entry.reason] : [],
  )
}

// protects=N69: a page pause that vanishes from the debugger with no continue (the test browser was killed) and whose run then ends with the surface lost is journaled surface-lost; fails_when=the pause-close reason is continue, so the replay says the run went past a stop it never left; no_claim=the real CDP socket close
test('a paused page stop that vanishes when the browser dies is journaled surface-lost, not continued', async (context) => {
  // Arrange
  const { recorder, store, header } = await recorderOver(context)
  const tracker = newTracker()
  tracker.sync([declaredPauseView(1, 'page')], 1, recorder)

  // Act
  recorder.surfaceEnded()
  tracker.sync([], 1, recorder)
  await recorder.seal({ failureCode: 'BROWSER_LOST' }, 5_000)
  const history = await store.read(header.studyId)

  // Assert
  assert.deepEqual(pauseCloseReasons(history), ['surface-lost'])
})

// protects=N69: a pause this run asked to continue is journaled continue when it leaves the debugger; fails_when=a continue the chat asked for is journaled as lost or run-ended
test('a paused page stop the run continued is journaled continue', async (context) => {
  // Arrange
  const { recorder, store, header } = await recorderOver(context)
  const tracker = newTracker()
  tracker.sync([declaredPauseView(1, 'page')], 1, recorder)

  // Act
  tracker.noteContinue(1)
  tracker.sync([], 1, recorder)
  await recorder.seal({}, 5_000)
  const history = await store.read(header.studyId)

  // Assert
  assert.deepEqual(pauseCloseReasons(history), ['continue'])
})

// protects=N69: a service-worker pause that vanishes because the worker was replaced is journaled worker-lost; fails_when=it is journaled continue or left for the seal
test('a paused service-worker stop whose worker was replaced is journaled worker-lost', async (context) => {
  // Arrange
  const { recorder, store, header } = await recorderOver(context)
  const tracker = newTracker()
  tracker.sync([declaredPauseView(1, 'service-worker')], 1, recorder)

  // Act
  tracker.sync([], 2, recorder)
  await recorder.seal({}, 5_000)
  const history = await store.read(header.studyId)

  // Assert
  assert.deepEqual(pauseCloseReasons(history), ['worker-lost'])
})
