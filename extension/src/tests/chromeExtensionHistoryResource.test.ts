import assert from 'node:assert/strict'
import { before, test } from 'node:test'

import type { ChromeExtensionHistorySink } from '../chromeExtensionHistorySink'
import { CHROME_EXTENSION_PROFILE } from '../constants'
import { readResource } from '../resources'

import { createHarness } from './helpers'
import {
  capturedStop,
  extensionIdentity,
  pngOf,
} from './utils/chromeExtensionHistoryFixture'
import { FakeChromeExtensionRuntime } from './utils/fakeChromeExtensionRuntime'
import { openServerRepository } from './utils/nodeServerHistoryFixture'
import { realProcessStart } from './utils/realProcessStart'
import { chromeExtensionConfigurationOf } from './utils/startFakeChromeExtensionRun'

before(async () => {
  await realProcessStart(process.pid)
})

/** A fake run whose preparation starts the history the service handed it, as the real run does once its declaration resolved. */
class HistoryFakeExtensionRuntime extends FakeChromeExtensionRuntime {
  beginHistory?: (
    identity: ReturnType<typeof extensionIdentity>,
  ) => Promise<ChromeExtensionHistorySink | undefined>
  history?: ChromeExtensionHistorySink

  override async prepare(): Promise<void> {
    this.history = await this.beginHistory?.(extensionIdentity())
    await super.prepare()
  }
}

/** Starts a run on a service whose learning storage is the given repository. */
async function startRecordedRun(
  context: Parameters<typeof openServerRepository>[0],
  repositoryOptions: Parameters<typeof openServerRepository>[1] = {},
) {
  const harness = await createHarness()
  context.after(() => harness.close())
  const { repository } = await openServerRepository(context, repositoryOptions)
  harness.service.nodeHistoryRepository = repository
  harness.service.nodeHistoryStore = repository.testHistories
  const run = new HistoryFakeExtensionRuntime()
  harness.service.environment.createChromeExtensionRun = async (input) => {
    run.beginHistory = input.beginHistory
    return run
  }
  const receipt = harness.service.start({
    instanceId: harness.service.instanceId,
    profile: CHROME_EXTENSION_PROFILE,
    key: 'history',
    configuration: chromeExtensionConfigurationOf(harness),
  })
  const record = harness.service.record(receipt)
  await record.preparation
  return { harness, run, record, repository }
}

/** Reads a run resource or a history resource as the chat does. */
async function readJson(
  harness: Awaited<ReturnType<typeof createHarness>>,
  uri: string,
) {
  const resource = await readResource(harness.service, uri)
  if (!('text' in resource)) throw new Error('The resource is text.')
  return JSON.parse(resource.text)
}

/** Reads a paged history resource whose content fits one page and parses the JSON it carries. */
async function readPagedJson(
  harness: Awaited<ReturnType<typeof createHarness>>,
  uri: string,
) {
  const page = await readJson(harness, uri)
  assert.equal(page.complete, true)
  return JSON.parse(page.content)
}

// protects=the run resource names the recording history and where its events are read, then the sealed history and the codes its capture misses; fails_when=history, historyUri or captureMissing is absent or wrong; no_claim=learningCoverage and save actions (the save path)
test('the run resource reads recording while the run lives and sealed with its capture codes after the stop', async (context) => {
  // Arrange
  const { harness, run, record } = await startRecordedRun(context)
  const studyId = `${harness.service.instanceId}_${record.id}`
  const runUri = harness.service.uri(record.id)

  // Act
  const live = (await readJson(harness, runUri)).chromeExtension
  run.history?.pauseOpened({
    pauseId: `${record.id}:1:page:1`,
    generation: 1,
    context: 'page',
    stopIndex: 1,
    targetUrl: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/popup.html',
    workerGeneration: 0,
  })
  run.history?.captured(
    `${record.id}:1:page:1`,
    capturedStop({ stopIndex: 1, context: 'page' }),
  )
  await harness.service.stop({
    instanceId: harness.service.instanceId,
    runId: record.id,
  })
  const ended = (await readJson(harness, runUri)).chromeExtension

  // Assert
  assert.equal(live.history, 'recording')
  assert.equal(live.historyUri, `codebook://node-history/${studyId}`)
  assert.equal(live.captureMissing, undefined)
  assert.equal(ended.history, 'sealed')
  assert.deepEqual(ended.captureMissing, [
    'EXTENSION_HISTORY_STOP_NOT_REACHED',
    'EXTENSION_HISTORY_RESULT_MISSING',
    'EXTENSION_HISTORY_FILMSTRIP_MISSING',
  ])
})

// protects=a run that ends before any declared stop pauses removed its empty history at the seal, so the resource names no URI that answers NOT_FOUND and says nothing was recorded; fails_when=historyUri is returned for the removed history or the history reads sealed; no_claim=the save refusal text
test('a run that ends before any stop reports its removed empty history as unavailable with no history URI', async (context) => {
  // Arrange
  const { harness, record } = await startRecordedRun(context)
  const runUri = harness.service.uri(record.id)

  // Act
  await harness.service.stop({
    instanceId: harness.service.instanceId,
    runId: record.id,
  })
  const ended = (await readJson(harness, runUri)).chromeExtension

  // Assert
  assert.equal(ended.history, 'unavailable')
  assert.equal(ended.historyUri, undefined)
  assert.equal(ended.historyIssue.code, 'HISTORY_UNAVAILABLE')
  assert.equal(
    ended.historyIssue.message,
    'No declared stop was reached, so nothing was recorded.',
  )
})

// protects=the history's events resource lists the journal without debugger snapshots, source text or absolute paths, and one entry's detail returns it whole; fails_when=the list carries a snapshot, the learning-storage path, or the detail is missing; no_claim=frame bytes (the history holds none in this run)
test('the history events resource is lean and carries no snapshot or storage path', async (context) => {
  // Arrange
  const { harness, run, record, repository } = await startRecordedRun(context)
  const studyId = `${harness.service.instanceId}_${record.id}`
  run.history?.pauseOpened({
    pauseId: `${record.id}:1:page:1`,
    generation: 1,
    context: 'page',
    stopIndex: 1,
    targetUrl: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/popup.html',
    workerGeneration: 0,
  })
  run.history?.captured(
    `${record.id}:1:page:1`,
    capturedStop({ stopIndex: 1, context: 'page' }),
  )
  await harness.service.stop({
    instanceId: harness.service.instanceId,
    runId: record.id,
  })

  // Act
  const events = await readPagedJson(
    harness,
    `codebook://node-history/${studyId}/events`,
  )
  const detail = await readPagedJson(
    harness,
    `codebook://node-history/${studyId}/events/2`,
  )
  const top = await readPagedJson(harness, `codebook://node-history/${studyId}`)

  // Assert
  const eventsText = JSON.stringify(events)
  assert.equal(eventsText.includes('debuggerSnapshot'), false)
  assert.equal(
    eventsText.includes(repository.extensionHistories.learningDirectory),
    false,
  )
  assert.equal(events[1].type, 'capture')
  assert.equal(detail.type, 'capture')
  assert.equal(detail.debuggerSnapshot.frames[0].name, 'onClick')
  assert.equal(top.profile, 'chrome-extension')
  assert.equal(top.status, 'partial')
})

// protects=a run started on a full library runs live unrecorded: history unavailable with the full-library sentence as its issue; fails_when=the run is refused, or history reads recording or lacks the sentence; no_claim=the save refusal (the save path)
test('a run on a full library goes on unrecorded and the resource says unavailable with the full-library sentence', async (context) => {
  // Arrange, Act
  const { harness, run, record } = await startRecordedRun(context, { limit: 0 })
  const state = (await readJson(harness, harness.service.uri(record.id)))
    .chromeExtension

  // Assert
  assert.equal(run.history, undefined)
  assert.equal(state.history, 'unavailable')
  assert.equal(state.historyIssue.code, 'HISTORY_UNAVAILABLE')
  assert.match(state.historyIssue.message, /^Study library is full\./)
  assert.equal(state.historyUri, undefined)
})

// protects=the history resources the chat reads hold no frame bytes and no absolute path even when the history has filmstrip frames; fails_when=an event, the detail of a frame event or the top resource carries a base64 PNG, a data URL, the learning-storage path or a home or drive path; no_claim=masking of debugger values (their own tests)
test('the history resources carry no frame bytes and no absolute paths for a history with recorded frames', async (context) => {
  // Arrange
  const { harness, run, record, repository } = await startRecordedRun(context)
  const studyId = `${harness.service.instanceId}_${record.id}`
  run.history?.frameObserver.frame({
    data: pngOf(720, 640, 'resource').toString('base64'),
    elapsedMs: run.history.frameObserver.elapsedMs(),
    kind: 'stream',
  })
  run.history?.pauseOpened({
    pauseId: `${record.id}:1:page:1`,
    generation: 1,
    context: 'page',
    stopIndex: 1,
    targetUrl: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/popup.html',
    workerGeneration: 0,
  })
  run.history?.captured(
    `${record.id}:1:page:1`,
    capturedStop({ stopIndex: 1, context: 'page' }),
  )
  await harness.service.stop({
    instanceId: harness.service.instanceId,
    runId: record.id,
  })

  // Act
  const events = await readPagedJson(
    harness,
    `codebook://node-history/${studyId}/events`,
  )
  const everyEvent: unknown[] = []
  for (const [index] of events.entries()) {
    everyEvent.push(
      await readPagedJson(
        harness,
        `codebook://node-history/${studyId}/events/${index + 1}`,
      ),
    )
  }
  const top = await readPagedJson(harness, `codebook://node-history/${studyId}`)

  // Assert
  const text = JSON.stringify([events, everyEvent, top])
  assert.ok(events.some((event: { type: string }) => event.type === 'frame'))
  assert.equal(text.includes('iVBOR'), false)
  assert.equal(text.includes('data:image'), false)
  assert.equal(
    text.includes(repository.extensionHistories.learningDirectory),
    false,
  )
  assert.equal(/\/Users\/|\/home\/|[A-Za-z]:\\\\/.test(text), false)
})
