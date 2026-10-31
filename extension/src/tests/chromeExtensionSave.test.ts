import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { before, test, type TestContext } from 'node:test'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

import { StudyError } from '../errors'
import { readResource } from '../resources'
import { startServer } from '../server'

import { realProcessStart } from './utils/realProcessStart'
import {
  extensionMaterial,
  readExtensionEvents,
  recordTwoStops,
  startRecordedExtensionRun,
} from './utils/startRecordedExtensionRun'

before(async () => {
  await realProcessStart(process.pid)
})

/** A recorded run with both stops captured and the run stopped, so its history is sealed. */
async function sealedRun(context: TestContext) {
  const started = await startRecordedExtensionRun(context)
  recordTwoStops(started.run, started.record)
  await started.service.stop({
    instanceId: started.service.instanceId,
    runId: started.record.id,
  })
  const events = await readExtensionEvents(started.service, started.studyId)
  return { ...started, events }
}

/** Reads the `chromeExtension` block of a run's resource as the chat does. */
async function readExtensionState(
  service: Parameters<typeof readResource>[0],
  runUri: string,
) {
  const resource = await readResource(service, runUri)
  if (!('text' in resource)) throw new Error('The resource is text.')
  return JSON.parse(resource.text)
}

// protects=AC3: codebook_explain_node_history saves an extension history and answers its study id and the new material revision; fails_when=the save is refused, answers another id or revision 0; no_claim=the replay presentation
test('saving the learning of a stopped extension run answers the study id and revision 1', async (context) => {
  // Arrange
  const { service, studyId, events } = await sealedRun(context)

  // Act
  const material = await service.explainNodeHistory({
    studyId,
    expectedRevision: 0,
    content: extensionMaterial(events),
  })

  // Assert
  assert.equal(material.studyId, studyId)
  assert.equal(material.revision, 1)
  assert.equal(material.content.title, 'Ping')
})

// protects=AC3: a second save passes the current revision and answers the next one; fails_when=the second save is refused or answers revision 1 again; no_claim=the content of the revision
test('a second save with the current revision answers revision 2', async (context) => {
  // Arrange
  const { service, studyId, events } = await sealedRun(context)
  await service.explainNodeHistory({
    studyId,
    expectedRevision: 0,
    content: extensionMaterial(events),
  })

  // Act
  const second = await service.explainNodeHistory({
    studyId,
    expectedRevision: 1,
    content: extensionMaterial(events),
  })

  // Assert
  assert.equal(second.revision, 2)
})

// protects=AC3: a save with a stale expectedRevision is refused naming the current revision and the retry; fails_when=the refusal omits the current revision or the save overwrites; no_claim=another window's save
test('a stale expectedRevision is refused naming the current revision', async (context) => {
  // Arrange
  const { service, studyId, events } = await sealedRun(context)
  await service.explainNodeHistory({
    studyId,
    expectedRevision: 0,
    content: extensionMaterial(events),
  })

  // Act, Assert
  await assert.rejects(
    service.explainNodeHistory({
      studyId,
      expectedRevision: 0,
      content: extensionMaterial(events),
    }),
    (error) =>
      error instanceof StudyError &&
      error.code === 'IDEMPOTENCY_CONFLICT' &&
      error.message.includes('is at revision 1; you sent expectedRevision 0') &&
      error.recoveryOverride?.includes('retry with expectedRevision 1') ===
        true,
  )
})

// protects=AC3 and the storage lock: two concurrent first saves leave one winner and tell the other the current revision; fails_when=both succeed, both fail or the loser is not told revision 1; no_claim=saves from two windows
test('two concurrent saves leave one winner and tell the other the current revision', async (context) => {
  // Arrange
  const { service, studyId, events } = await sealedRun(context)

  // Act
  const settled = await Promise.allSettled([
    service.explainNodeHistory({
      studyId,
      expectedRevision: 0,
      content: extensionMaterial(events),
    }),
    service.explainNodeHistory({
      studyId,
      expectedRevision: 0,
      content: extensionMaterial(events),
    }),
  ])

  // Assert
  assert.deepEqual(settled.map((outcome) => outcome.status).sort(), [
    'fulfilled',
    'rejected',
  ])
  const loser = settled.find((outcome) => outcome.status === 'rejected')
  assert.ok(loser?.status === 'rejected')
  assert.match(String(loser.reason.message), /is at revision 1/)
})

// protects=DX-7: a save while the history still records is refused at once with a stable code and the fix, writing nothing; fails_when=the save waits, writes, or answers another code; no_claim=the run's own continuation
test('saving while the run still records is refused at once with HISTORY_STILL_RECORDING and writes nothing', async (context) => {
  // Arrange
  const { service, studyId, run, record, repository } =
    await startRecordedExtensionRun(context)
  recordTwoStops(run, record)

  // Act, Assert
  await assert.rejects(
    service.explainNodeHistory({
      studyId,
      expectedRevision: 0,
      content: extensionMaterial([]),
    }),
    (error) =>
      error instanceof StudyError &&
      error.code === 'HISTORY_STILL_RECORDING' &&
      error.message.includes('Stop the run with codebook_stop, then save.'),
  )
  assert.equal(
    await repository.extensionHistories.readLearningMaterial(studyId),
    undefined,
  )
  assert.equal(record.stopped, false)
})

// protects=DX-7: a run whose history could not start is refused with the full-library sentence of its historyIssue; fails_when=the sentence differs from the issue the run resource shows; no_claim=freeing a place
test('saving a run on a full library is refused with the history issue sentence', async (context) => {
  // Arrange
  const { service, studyId, record } = await startRecordedExtensionRun(
    context,
    { limit: 0 },
  )
  const issue = (await readExtensionState(service, service.uri(record.id)))
    .chromeExtension.historyIssue

  // Act, Assert
  await assert.rejects(
    service.explainNodeHistory({
      studyId,
      expectedRevision: 0,
      content: extensionMaterial([]),
    }),
    (error) =>
      error instanceof StudyError &&
      error.code === 'EVIDENCE_UNAVAILABLE' &&
      error.message === issue.message &&
      error.message.startsWith('Study library is full.'),
  )
})

// protects=E-G: a citation with the right sequence and source hash but the other context is refused naming the step; fails_when=the stop registry's page and worker stops at one location can be swapped; no_claim=the nearest-sequence wording
test('a citation with the right hash but the wrong context is refused', async (context) => {
  // Arrange
  const { service, studyId, events } = await sealedRun(context)

  // Act, Assert
  await assert.rejects(
    service.explainNodeHistory({
      studyId,
      expectedRevision: 0,
      content: extensionMaterial(events, {
        contexts: ['page', 'page'],
      }),
    }),
    (error) =>
      error instanceof StudyError &&
      error.code === 'INVALID_REFERENCE' &&
      error.message.includes('refused step stop-2') &&
      error.message.includes('in the page context'),
  )
})

// protects=AC3: incomplete material keeps the history, lists what is missing and offers save-node-learning, and complete material clears both; fails_when=the coverage, the missing list or the next action do not follow the saved material; no_claim=the capture codes
test('learning coverage follows the saved material and save-node-learning disappears once complete', async (context) => {
  // Arrange
  const { service, studyId, record, events } = await sealedRun(context)
  const runUri = service.uri(record.id)
  const before = await readExtensionState(service, runUri)

  // Act
  await service.explainNodeHistory({
    studyId,
    expectedRevision: 0,
    content: extensionMaterial(events, { skipCaptures: [1], skipResult: true }),
  })
  const partial = await readExtensionState(service, runUri)
  await service.explainNodeHistory({
    studyId,
    expectedRevision: 1,
    content: extensionMaterial(events),
  })
  const complete = await readExtensionState(service, runUri)

  // Assert
  assert.equal(before.chromeExtension.learningCoverage, 'none')
  assert.equal(before.nextActions.includes('save-node-learning'), true)
  assert.equal(partial.chromeExtension.learningCoverage, 'partial')
  assert.deepEqual(
    partial.chromeExtension.learningMissing.map(
      (part: { type: string; context?: string }) => [part.type, part.context],
    ),
    [
      ['stop', 'service-worker'],
      ['result', undefined],
    ],
  )
  assert.equal(partial.nextActions.includes('save-node-learning'), true)
  assert.equal(complete.chromeExtension.learningCoverage, 'complete')
  assert.deepEqual(complete.chromeExtension.learningMissing, [])
  assert.equal(complete.chromeExtension.materialRevision, 2)
  assert.equal(complete.nextActions.includes('save-node-learning'), false)
})

/** Connects a real MCP SDK client to the service's endpoint, so a call passes the tool's input schema as an editor chat's does. */
async function connectMcpClient(
  context: TestContext,
  service: Parameters<typeof startServer>[0],
) {
  const endpoint = await startServer(service)
  context.after(() => endpoint.close())
  const client = new Client({ name: 'extension-save-test', version: '1.0' })
  await client.connect(
    new StreamableHTTPClientTransport(new URL(endpoint.descriptor.url), {
      requestInit: {
        headers: { authorization: `Bearer ${endpoint.descriptor.token}` },
      },
    }),
  )
  context.after(() => client.close())
  return client
}

// protects=AC3: over MCP an extension save succeeds with its revision, codebook_explain answers EVIDENCE_UNAVAILABLE naming the history, and a save during recording is isError with its code; fails_when=a refusal is success-shaped text or the codes differ; no_claim=the SDK
test('over MCP the save answers the revision and every refusal is isError with its code', async (context) => {
  // Arrange
  const started = await startRecordedExtensionRun(context)
  recordTwoStops(started.run, started.record)
  const client = await connectMcpClient(context, started.service)
  const during = await client.callTool({
    name: 'codebook_explain_node_history',
    arguments: {
      studyId: started.studyId,
      expectedRevision: 0,
      content: extensionMaterial([
        { sequence: 2, type: 'capture', sourceHash: 'a'.repeat(64) },
      ]),
    },
  })
  await started.service.stop({
    instanceId: started.service.instanceId,
    runId: started.record.id,
  })
  const events = await readExtensionEvents(started.service, started.studyId)

  // Act
  const saved = await client.callTool({
    name: 'codebook_explain_node_history',
    arguments: {
      studyId: started.studyId,
      expectedRevision: 0,
      content: extensionMaterial(events),
    },
  })
  const explained = await client.callTool({
    name: 'codebook_explain',
    arguments: {
      instanceId: started.service.instanceId,
      runId: started.record.id,
      key: 'explain',
      snapshotUri: started.service.uri(started.record.id, 'snapshots/x'),
      sourceHash: 'a'.repeat(64),
      valuePaths: ['value:answer'],
      interpretation: 'The answer is pong.',
    },
  })

  // Assert
  assert.equal(during.isError, true)
  assert.equal(
    (during.structuredContent as { error: { code: string } }).error.code,
    'HISTORY_STILL_RECORDING',
  )
  assert.notEqual(saved.isError, true)
  assert.equal(
    (saved.structuredContent as { data: { revision: number } }).data.revision,
    1,
  )
  assert.equal(explained.isError, true)
  const failure = (
    explained.structuredContent as {
      error: { code: string; message: string }
    }
  ).error
  assert.equal(failure.code, 'EVIDENCE_UNAVAILABLE')
  assert.match(failure.message, /chromeExtension\.historyUri/)
  assert.match(failure.message, /codebook_explain_node_history/)
})

/** Lists the non-test TypeScript files under a folder. */
function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name)
    if (statSync(path).isDirectory())
      return name === 'tests' ? [] : sourceFiles(path)
    return path.endsWith('.ts') ? [path] : []
  })
}

// protects=AC3: no source file or MCP instruction still carries the old refusal constant or its sentences; fails_when=any of them comes back; no_claim=README, SKILL.md and the packaged help (the docs lane)
test('the old extension save refusal appears nowhere in the shipped source or the MCP instructions', async (context) => {
  // Arrange
  const { service } = await startRecordedExtensionRun(context)
  const client = await connectMcpClient(context, service)
  const sources = sourceFiles(join(__dirname, '..', '..', 'src')).map((path) =>
    readFileSync(path, 'utf8'),
  )
  const instructions = client.getInstructions() ?? ''

  // Act
  const offenders = [
    'CHROME_EXTENSION_SAVE_REFUSAL',
    'Saving an extension run is not available in this version',
    'an extension run is live only and is not saved',
    'a chrome-extension run is not saved in this version',
  ].filter(
    (phrase) =>
      instructions.includes(phrase) ||
      sources.some((text) => text.includes(phrase)),
  )

  // Assert
  assert.deepEqual(offenders, [])
})
