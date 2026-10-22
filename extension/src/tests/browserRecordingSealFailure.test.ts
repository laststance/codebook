import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { LearningLibrary } from '../learningLibrary'
import { RecordingStore } from '../recordingStore'
import { RepositoryBookStore } from '../repositoryBook'
import { StudyService } from '../service'
import { createRecordingObserver } from '../utils/createRecordingObserver'
import type { CodebookDiagnostic } from '../utils/formatCodebookDiagnostic'

import { configuredRuntimeHarness } from './utils/configuredRuntimeHarness'

/**
 * Prepares a recorded browser run of the real coordinator, with its recording writer started, as the seal-failure tests below need it.
 * @param context - The test, which shuts the service down after it.
 * @param key - The run's start key.
 * @returns The service, the start receipt and the run's record, prepared and recording.
 * @example const { service, receipt, record } = await preparedRecordedRun(context, 'seal')
 */
async function preparedRecordedRun(context: TestContext, key: string) {
  const harness = await configuredRuntimeHarness(context),
    directory = join(harness.directory, '.learning')
  const library = new LearningLibrary(directory, '0'.repeat(64))
  const books = new RepositoryBookStore(harness.sources, library)
  const service = new StudyService(
    {
      workspace: harness.directory,
      host: {
        id: 'vscode',
        productVersion: 'test',
        apiVersion: 'test',
        commit: 'test',
      },
      build: {
        revision: 'controlled-runtime',
        dirty: false,
        sourceHash: '0'.repeat(64),
      },
      prerequisites: async () => ({ ready: true, missing: [] }),
      createRuntime: async () => harness.run,
    },
    join(harness.directory, '.service'),
  )
  context.after(async () => {
    await service.shutdown()
    books.dispose()
  })
  await books.publish({
    bookId: 'interface',
    expectedRevision: 0,
    key: 'article',
    document: {
      title: 'Interface',
      summary: 'Two citations.',
      nodes: [
        {
          id: 'theme',
          title: 'Theme',
          sections: [{ title: 'Theme', text: 'Source-derived explanation.' }],
          anchors: harness.definition.descriptor.anchors,
          observations: [],
        },
      ],
      edges: [],
    },
  })
  service.repository = books
  service.recordings = new RecordingStore(directory, library.workspaceKey)
  const receipt = service.start({
    instanceId: service.instanceId,
    profile: 'repository-browser',
    key,
    configuration: harness.definition.configuration,
  })
  const record = service.record(receipt)
  harness.observeRecording(() => createRecordingObserver(record))
  await record.preparation
  return { service, receipt, record }
}

// Value: protects=codebook_stop's answer for a browser run whose recording could not be finished at its stop: HISTORY_SEAL_FAILED with the run, its outcome and stops reached and the sanitized cause, the same for a repeated stop, and no second finish; fails_when=the stop answers success after the recording's finish failed, so the agent claims a replayable recording that was never sealed; why_new=X1 covers the browser recording's failed finish as well as a test history's failed seal (AC2); seam=the recording writer's finish, which fails as a full disk would; no_claim=a real full disk, and the failure of a recording before input
test('codebook_stop answers HISTORY_SEAL_FAILED when a browser run’s recording cannot be finished at its stop, and the same again for a repeated stop', async (context) => {
  // Arrange
  const { service, receipt, record } = await preparedRecordedRun(
    context,
    'browser-seal-fails',
  )
  const finish = context.mock.method(record.recording!, 'finish', async () => {
    throw new Error('ENOSPC: no space left on device, write')
  })

  // Act
  const first = await service.stopForTool(receipt)
  const repeated = await service.stopForTool(receipt)

  // Assert
  assert.deepEqual(
    [first, repeated].map(({ sealFailure }) => ({
      code: sealFailure?.code,
      message: sealFailure?.message,
      cause: sealFailure?.causeDetail,
    })),
    [
      {
        code: 'HISTORY_SEAL_FAILED',
        message: `codebook_stop released run ${record.id} (not-demonstrated, 0 of 1 stops reached) but could not seal its history.`,
        cause: 'ENOSPC: no space left on device, write',
      },
      {
        code: 'HISTORY_SEAL_FAILED',
        message: `codebook_stop released run ${record.id} (not-demonstrated, 0 of 1 stops reached) but could not seal its history.`,
        cause: 'ENOSPC: no space left on device, write',
      },
    ],
  )
  assert.equal(finish.mock.callCount(), 1)
})

// Value: protects=the Output entry and the answer of a browser run whose recording could not be finished: one entry named HISTORY_SEAL_FAILED for the run's study, and a cause in both the answer and the entry that shows no storage path; fails_when=the failed finish is silent in Output › Codebook, or the cause names the learner's storage folder; why_new=the existing test's stub error names no path and no test read the Output entry (F24, gap E7); seam=the recording writer's finish fails with a path inside the service's storage; no_claim=a real full disk
test('a browser run’s failed recording finish writes one Output entry and shows no storage path', async (context) => {
  // Arrange
  const { service, receipt, record } = await preparedRecordedRun(
    context,
    'browser-seal-output',
  )
  const entries: CodebookDiagnostic[] = []
  service.diagnostics = (entry) => entries.push(entry)
  const storage = service.causeRoots.storage[0]!
  context.mock.method(record.recording!, 'finish', async () => {
    throw new Error(`EACCES: permission denied, open '${storage}/sealed.json'`)
  })

  // Act
  const answer = await service.stopForTool(receipt)

  // Assert
  assert.equal(
    answer.sealFailure?.causeDetail,
    "EACCES: permission denied, open '<storage>/sealed.json'",
  )
  assert.deepEqual(
    entries.map(({ surface, studyId, cause }) => ({
      surface,
      studyId,
      cause,
    })),
    [
      {
        surface: 'HISTORY_SEAL_FAILED',
        studyId: `${service.instanceId}_${record.id}`,
        cause: "EACCES: permission denied, open '<storage>/sealed.json'",
      },
    ],
  )
})

// Value: protects=a browser run whose saved study the learner removed: its stop answers no seal failure, because nothing of that study is to be sealed; fails_when=a removed study's recording, whose finish fails on its gone folder, is reported to the agent as a failed seal; why_new=X1 names the removed study as never answering HISTORY_SEAL_FAILED (AC2); seam=the recording writer's finish, which fails as on a removed folder; no_claim=the removal itself (studyRemoval tests)
test('codebook_stop answers no seal failure for a browser run whose saved study the learner removed', async (context) => {
  // Arrange
  const { service, receipt, record } = await preparedRecordedRun(
    context,
    'removed-study',
  )
  context.mock.method(record.recording!, 'finish', async () => {
    throw new Error('ENOENT: no such file or directory, open')
  })
  service.excludeHistory(record)

  // Act
  const answer = await service.stopForTool(receipt)

  // Assert
  assert.equal(answer.sealFailure, undefined)
})

// Value: protects=one sanitized cause for a browser recording whose finish failed at the stop: state.recording.reason and the HISTORY_SEAL_FAILED cause of the same codebook_stop answer both read `<storage>` where the failure named the storage path; fails_when=recording.reason keeps the raw failure beside the sanitized seal cause, so one answer carries the storage path; why_new=recordingFailure was assigned raw beside the sanitized seal cause (F48); seam=the recording writer's finish fails with a message naming the service's storage root; no_claim=a real full disk
test('a browser recording that failed to finish reports the same storage-free cause in recording.reason and in the HISTORY_SEAL_FAILED cause', async (context) => {
  // Arrange
  const { service, receipt, record } = await preparedRecordedRun(
    context,
    'browser-seal-path',
  )
  const storageRoot = service.causeRoots.storage[0]
  context.mock.method(record.recording!, 'finish', async () => {
    throw new Error(
      `ENOSPC: no space left on device, write '${storageRoot}/run/events.jsonl'`,
    )
  })

  // Act
  const answer = await service.stopForTool(receipt)

  // Assert
  assert.deepEqual(
    {
      reason: answer.state.recording.reason,
      cause: answer.sealFailure?.causeDetail,
    },
    {
      reason:
        "ENOSPC: no space left on device, write '<storage>/run/events.jsonl'",
      cause:
        "ENOSPC: no space left on device, write '<storage>/run/events.jsonl'",
    },
  )
})
