import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  ChromeExtensionHistoryRecorder,
  type ExtensionHistoryBegun,
} from '../chromeExtensionHistoryRecorder'
import { parseExtensionHistoryHeader } from '../chromeExtensionHistorySchemas'
import type { ExtensionHistoryPause } from '../chromeExtensionHistorySink'
import { ChromeExtensionHistoryWriter } from '../chromeExtensionHistoryWriter'
import { sha256 } from '../runtimeSupport/utils/sha256'

import {
  capturedStop,
  EXTENSION_WORKSPACE_KEY,
  extensionHistoryHeader,
  openExtensionStore,
  pngOf,
  WORKER_SOURCE_TEXT,
} from './utils/chromeExtensionHistoryFixture'

const PAGE_PAUSE: ExtensionHistoryPause = {
  pauseId: 'run:1:page:1',
  generation: 1,
  context: 'page',
  stopIndex: 1,
  targetUrl: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/popup.html',
  workerGeneration: 0,
}
const WORKER_PAUSE: ExtensionHistoryPause = {
  pauseId: 'run:2:service-worker:2',
  generation: 2,
  context: 'service-worker',
  stopIndex: 2,
  targetUrl: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/worker.js',
  workerGeneration: 1,
}

/** Starts a recorder over a real store and returns it with the store and header. */
async function recorderOver(
  context: Parameters<typeof openExtensionStore>[0],
  onFault?: (error: unknown) => void,
) {
  const { store, learningDirectory } = await openExtensionStore(context)
  const header = extensionHistoryHeader(EXTENSION_WORKSPACE_KEY)
  const begun = await ChromeExtensionHistoryRecorder.begin({
    start: () => store.start(header),
    describeCause: String,
    summarize: (studyId) => store.summarize(studyId),
    ...(onFault ? { onFault } : {}),
  })
  assert.ok('recorder' in begun)
  return { recorder: begun.recorder, store, header, learningDirectory }
}

/** Journals a stream frame the way the viewport's observer hands one over. */
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

// protects=a page stop then a service-worker stop are journaled as pause-open, capture and pause-close with their target identity and source hash, then the result, and the history seals complete; fails_when=an event, a target URL, a worker generation, a source hash or the complete seal is missing; no_claim=a real Chrome or debugger (the pauses are told by hand)
test('a page stop then a service-worker stop are journaled with their target identity and the history seals complete', async (context) => {
  // Arrange
  const { recorder, store, header } = await recorderOver(context)

  // Act
  recorder.pauseOpened(PAGE_PAUSE)
  recorder.captured(
    PAGE_PAUSE.pauseId,
    capturedStop({ stopIndex: 1, context: 'page' }),
  )
  streamFrame(recorder, 'surface')
  recorder.pauseClosed(PAGE_PAUSE.pauseId, 'continue')
  recorder.pauseOpened(WORKER_PAUSE)
  recorder.captured(
    WORKER_PAUSE.pauseId,
    capturedStop({ stopIndex: 2, context: 'service-worker' }),
  )
  recorder.pauseClosed(WORKER_PAUSE.pauseId, 'continue')
  recorder.resultObserved({
    kind: 'text',
    before: { value: 'idle' },
    after: { value: 'pong' },
    changed: true,
    observedAtMs: 900,
  })
  await recorder.seal({}, 5_000)
  const history = await store.read(header.studyId)

  // Assert
  assert.equal(recorder.status, 'sealed')
  assert.equal(history.status, 'complete')
  assert.deepEqual(
    history.entries
      .filter((entry) => entry.type !== 'frame')
      .map((entry) => entry.type),
    [
      'pause-open',
      'capture',
      'pause-close',
      'pause-open',
      'capture',
      'pause-close',
      'result',
    ],
  )
  const opens = history.entries.filter((entry) => entry.type === 'pause-open')
  assert.deepEqual(
    opens.map((entry) => [
      entry.context,
      entry.stopIndex,
      entry.targetUrl,
      entry.workerGeneration,
    ]),
    [
      [
        'page',
        1,
        'chrome-extension://abcdefghijklmnopabcdefghijklmnop/popup.html',
        0,
      ],
      [
        'service-worker',
        2,
        'chrome-extension://abcdefghijklmnopabcdefghijklmnop/worker.js',
        1,
      ],
    ],
  )
  const workerCapture = history.entries.find(
    (entry) => entry.type === 'capture' && entry.path === 'worker.js',
  )
  assert.equal(
    workerCapture?.type === 'capture' && workerCapture.sourceHash,
    sha256(WORKER_SOURCE_TEXT),
  )
  const result = history.entries.find((entry) => entry.type === 'result')
  assert.equal(result?.type === 'result' && result.outcome, 'changed')
  assert.deepEqual(history.seal?.reasons, [])
})

// protects=a run that ended with a stop still paused and a lost surface seals partial naming the stop never reached and the surface end, and closes the open pause as surface-lost; fails_when=the seal is complete, a code is missing or the pause stays open; no_claim=the real surface-lost event of Chrome
test('a surface lost at an open pause seals partial naming the surface end and the stop never reached', async (context) => {
  // Arrange
  const { recorder, store, header } = await recorderOver(context)

  // Act
  recorder.pauseOpened(PAGE_PAUSE)
  recorder.captured(
    PAGE_PAUSE.pauseId,
    capturedStop({ stopIndex: 1, context: 'page' }),
  )
  recorder.surfaceEnded()
  await recorder.seal({ failureCode: 'SURFACE_LOST' }, 5_000)
  const history = await store.read(header.studyId)

  // Assert
  assert.equal(history.status, 'partial')
  assert.deepEqual(
    history.seal?.reasons.map((reason) => reason.code),
    [
      'EXTENSION_HISTORY_STOP_NOT_REACHED',
      'EXTENSION_HISTORY_SURFACE_ENDED',
      'EXTENSION_HISTORY_FILMSTRIP_MISSING',
    ],
  )
  const close = history.entries.find((entry) => entry.type === 'pause-close')
  assert.equal(close?.type === 'pause-close' && close.reason, 'surface-lost')
})

// protects=a stopped run with no stop reached holds nothing to replay: its folder is removed at the seal and it takes no place; fails_when=an empty history stays listed or counted; no_claim=a run that reached a stop
test('a history in which no stop paused is removed when it seals', async (context) => {
  // Arrange
  const { recorder, store, header } = await recorderOver(context)

  // Act
  await recorder.seal({}, 5_000)

  // Assert
  assert.equal(recorder.status, 'sealed')
  assert.equal(store.holdsHistoryFolder(header.studyId), false)
  assert.deepEqual(await store.list(), [])
})

// protects=an editor that closes mid-run leaves a journal with no seal that reads as interrupted, with its recorded stop replayable and the missing parts named; fails_when=the unsealed journal reads as complete or loses its prefix; no_claim=another window judging the dead writer (the writer record is removed by the abandon)
test('a history whose writer is abandoned reads as interrupted with its recorded stop and the parts it misses', async (context) => {
  // Arrange
  const { recorder, store, header } = await recorderOver(context)
  recorder.pauseOpened(PAGE_PAUSE)
  recorder.captured(
    PAGE_PAUSE.pauseId,
    capturedStop({ stopIndex: 1, context: 'page' }),
  )
  // Both entries are durable before the editor "closes".
  while ((await store.read(header.studyId)).entries.length < 2)
    await new Promise((resolve) => setTimeout(resolve, 5))

  // Act
  recorder.writer.abandon()
  const summary = await store.summarize(header.studyId)

  // Assert
  assert.equal(summary?.status, 'interrupted')
  assert.equal(summary?.stopCount, 1)
  assert.equal(summary?.capturedStopCount, 1)
  assert.deepEqual(
    summary?.captureMissing.map((reason) => reason.code),
    [
      'EXTENSION_HISTORY_STOP_NOT_REACHED',
      'EXTENSION_HISTORY_RESULT_MISSING',
      'EXTENSION_HISTORY_FILMSTRIP_MISSING',
    ],
  )
})

// protects=a writer that fails every append is reported once and never makes a recorder call throw into the live run; fails_when=a call throws, the fault is reported twice or not at all; no_claim=the wording of the cause
test('a writer whose appends fail is reported once and no recorder call throws', async () => {
  // Arrange
  class FailingWriter extends ChromeExtensionHistoryWriter {
    protected override append(): Promise<void> {
      return Promise.reject(new Error('EIO: simulated disk failure'))
    }
  }
  const directory = await mkdtemp(join(tmpdir(), 'codebook-extension-failing-'))
  const header = parseExtensionHistoryHeader({
    ...extensionHistoryHeader(EXTENSION_WORKSPACE_KEY),
    formatVersion: 1,
  })
  const faults: unknown[] = []
  const begun: ExtensionHistoryBegun =
    await ChromeExtensionHistoryRecorder.begin({
      start: async () =>
        new FailingWriter(directory, header, () => undefined, String),
      describeCause: String,
      summarize: async () => undefined,
      onFault: (error) => faults.push(error),
    })
  assert.ok('recorder' in begun)

  // Act
  begun.recorder.pauseOpened(PAGE_PAUSE)
  begun.recorder.captured(
    PAGE_PAUSE.pauseId,
    capturedStop({ stopIndex: 1, context: 'page' }),
  )
  await new Promise((resolve) => setImmediate(resolve))

  // Assert
  assert.equal(faults.length, 1)
  assert.match(String(faults[0]), /simulated disk failure/)
})

// protects=the recorder never waits for a disk: against a writer that never finishes an append, hundreds of pauses, captures and frames return at once; fails_when=a recorder call awaits the writer; no_claim=wall-clock timing of a real disk
test('recorder calls return at once while the writer never finishes an append', async () => {
  // Arrange
  class StalledWriter extends ChromeExtensionHistoryWriter {
    protected override append(): Promise<void> {
      return new Promise<void>(() => undefined)
    }
  }
  const directory = await mkdtemp(join(tmpdir(), 'codebook-extension-stalled-'))
  const header = parseExtensionHistoryHeader({
    ...extensionHistoryHeader(EXTENSION_WORKSPACE_KEY),
    formatVersion: 1,
  })
  const begun = await ChromeExtensionHistoryRecorder.begin({
    start: async () =>
      new StalledWriter(directory, header, () => undefined, String),
    describeCause: String,
    summarize: async () => undefined,
  })
  assert.ok('recorder' in begun)
  const startedAt = performance.now()

  // Act
  for (let index = 0; index < 500; index++) {
    const pauseId = `run:${index}:page:1`
    begun.recorder.pauseOpened({ ...PAGE_PAUSE, pauseId, generation: index })
    begun.recorder.captured(
      pauseId,
      capturedStop({ stopIndex: 1, context: 'page' }),
    )
    begun.recorder.pauseClosed(pauseId, 'continue')
  }
  const elapsedMs = performance.now() - startedAt

  // Assert
  assert.ok(elapsedMs < 1_000, `500 stops took ${elapsedMs} ms`)
})

// protects=a history that starts after its bound is sealed empty and removed, and the run goes on unrecorded with the bound named; fails_when=the late folder stays or the start waits for it; no_claim=the real 2 s bound
test('a history that starts after its bound leaves no folder and the run goes on unrecorded', async (context) => {
  // Arrange
  const { store, learningDirectory } = await openExtensionStore(context)
  const header = extensionHistoryHeader(EXTENSION_WORKSPACE_KEY)

  // Act
  const begun = await ChromeExtensionHistoryRecorder.begin({
    start: async () => {
      await new Promise((resolve) => setTimeout(resolve, 60))
      return store.start(header)
    },
    describeCause: String,
    summarize: async () => undefined,
    startBoundMs: 5,
  })
  await new Promise((resolve) => setTimeout(resolve, 200))

  // Assert
  assert.ok('unavailable' in begun)
  assert.equal(begun.unavailable, 'the history did not start within 0.005 s.')
  assert.equal(store.holdsHistoryFolder(header.studyId), false)
  assert.equal(
    existsSync(join(learningDirectory, 'chrome-extensions.v1', header.studyId)),
    false,
  )
})
