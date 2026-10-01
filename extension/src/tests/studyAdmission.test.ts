import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { LearningLibrary } from '../learningLibrary'
import { RecordingStore } from '../recordingStore'
import { RepositoryBookStore } from '../repositoryBook'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { StudyService } from '../service'
import { createRecordingObserver } from '../utils/createRecordingObserver'

import { configuredRuntimeHarness } from './utils/configuredRuntimeHarness'
import { createConfiguredStudy } from './utils/createConfiguredStudy'

/**
 * Starts one configured run through the real service with a study library and a recording store that share a directory and a limit; the runtime and its application are the controlled harness.
 * @param context - The test whose teardown shuts the service down.
 * @param limit - The Saved Study Limit both stores read.
 * @param fill - Which store already holds one entry before the run starts.
 * @param arrangeBeforeStart - Arranges a condition that holds only once the run starts, after the stores are filled: it may replace the limit setting or act on the service and its store.
 * @example const started = await startRunWithStorage(context, 1, 'study')
 * @example const started = await startRunWithStorage(context, 1, 'study', ({ changeLimitSetting }) => changeLimitSetting(0))
 */
async function startRunWithStorage(
  context: TestContext,
  limit: number,
  fill: 'study' | 'recording' | 'nothing',
  arrangeBeforeStart: (arranged: {
    service: StudyService
    store: RecordingStore
    changeLimitSetting(value: unknown): void
  }) => void = () => {},
) {
  let service: StudyService | undefined, books: RepositoryBookStore | undefined
  context.after(async () => {
    await service?.shutdown()
    books?.dispose()
  })
  const harness = await configuredRuntimeHarness(context),
    directory = join(harness.directory, '.learning')
  let limitSetting: unknown = limit
  const library = new LearningLibrary(
      directory,
      '0'.repeat(64),
      () => limitSetting,
    ),
    store = new RecordingStore(
      directory,
      library.workspaceKey,
      {},
      undefined,
      () => limitSetting,
    )
  const savedStudy = createConfiguredStudy()
  if (fill === 'study') await library.saveStudy(savedStudy)
  if (fill === 'recording')
    await (
      await store.start(
        {
          workspaceKey: library.workspaceKey,
          studyId: savedStudy.id,
          instanceId: savedStudy.instanceId,
          runId: savedStudy.runId,
          runtimeId: randomUUID(),
          profile: savedStudy.profile,
          sourceBuild: {
            revision: 'earlier-run',
            dirty: false,
            sourceHash: '1'.repeat(64),
          },
        },
        0,
      )
    ).finish(1)
  books = new RepositoryBookStore(harness.sources, library)
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
  let runtimeAcquisitions = 0
  service = new StudyService(
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
      createRuntime: async () => {
        runtimeAcquisitions++
        return harness.run
      },
    },
    join(harness.directory, '.service'),
  )
  service.repository = books
  service.recordings = store
  const libraryFilesBefore = await studyFiles(directory)
  arrangeBeforeStart({
    service,
    store,
    changeLimitSetting: (value) => {
      limitSetting = value
    },
  })
  const receipt = service.start({
    instanceId: service.instanceId,
    profile: 'repository-browser',
    key: 'admission',
    configuration: harness.definition.configuration,
  })
  const record = service.record(receipt)
  harness.observeRecording(() => createRecordingObserver(record))
  await record.preparation
  return {
    harness,
    service,
    store,
    receipt,
    record,
    directory,
    libraryFilesBefore,
    runtimeAcquisitions: () => runtimeAcquisitions,
  }
}

/** Reads every saved study file of a library directory with its bytes, so a test can assert the library is byte-unchanged. @example assert.deepEqual(await studyFiles(directory), before) */
async function studyFiles(directory: string): Promise<[string, string][]> {
  const names = (await readdir(directory))
    .filter((name) => name.includes('.study.'))
    .sort()
  return Promise.all(
    names.map(async (name): Promise<[string, string]> => [
      name,
      (await readFile(join(directory, name))).toString('base64'),
    ]),
  )
}

test('a run on a full study library is refused before the application receives any input and names the limit setting', async (context) => {
  // Arrange / Act: the library holds one study under a limit of one; no recording exists yet.
  const started = await startRunWithStorage(context, 1, 'study')
  // Assert
  assert.equal(started.record.error?.code, 'PREREQUISITE_MISSING')
  assert.equal(
    started.record.error?.message,
    'Study library is full. Increase Codebook: Saved Study Limit (codebook.savedStudyLimit) in Settings before starting another run. Existing learning was kept.',
  )
  assert.equal(started.record.prepared, false)
  // No runtime was acquired, so nothing was prepared and no click reached the application.
  assert.equal(started.runtimeAcquisitions(), 0)
  assert.equal(started.harness.mouse.length, 0)
  assert.equal((await started.store.list()).length, 0)
  assert.deepEqual(
    await studyFiles(started.directory),
    started.libraryFilesBefore,
  )
  assert.deepEqual(
    started.libraryFilesBefore.map(([name]) => name),
    [
      '11111111-1111-4111-8111-111111111111_22222222-2222-4222-8222-222222222222.study.meta.v3.json',
      '11111111-1111-4111-8111-111111111111_22222222-2222-4222-8222-222222222222.study.v3.json',
    ],
  )
})

test('a run on a study library below its limit prepares and its click reaches the application', async (context) => {
  // Arrange: the library holds one study under a limit of two.
  const started = await startRunWithStorage(context, 2, 'study')
  // Act
  started.service.action({
    ...started.receipt,
    key: 'one',
    action: 'repository-click',
  })
  await waitUntil(
    () => started.harness.mouse.length > 0,
    'the click on the application',
  )
  // Assert
  assert.equal(started.record.error, undefined)
  assert.equal(started.record.prepared, true)
  assert.equal(started.runtimeAcquisitions(), 1)
  assert.equal(
    started.service.state(started.record).recording.status,
    'recording',
  )
})

test('a run whose recording slots alone are used up still prepares and reports its recording as failed', async (context) => {
  // Arrange / Act: one finished recording under a limit of one; the study library is empty.
  const started = await startRunWithStorage(context, 1, 'recording')
  // Assert
  const recording = started.service.state(started.record).recording
  assert.equal(started.record.error, undefined)
  assert.equal(started.record.prepared, true)
  assert.equal(started.runtimeAcquisitions(), 1)
  assert.equal(recording.status, 'failed')
  assert.equal(
    recording.reason,
    'Recording unavailable before input: Error: Recording library is full. Increase Codebook: Saved Study Limit (codebook.savedStudyLimit) in Settings before starting another session. Existing recordings were kept.',
  )
})

// Value: protects=a run under an invalid Saved Study Limit setting ends before a runtime exists or input is sent, with the setting named in its error cause; fails_when=an error of the admission read is swallowed or read as admitted, so the run prepares and clicks though its study cannot be saved; why_new=the admission tests start runs under a valid limit only, where the read answers and never throws; seam=none
test('a run started under an invalid Saved Study Limit setting is refused before the application receives any input and its error cause names the setting', async (context) => {
  // Arrange / Act: one study was saved under a limit of one; the setting holds 0 when the run starts.
  const started = await startRunWithStorage(
    context,
    1,
    'study',
    ({ changeLimitSetting }) => changeLimitSetting(0),
  )
  // Assert: the error code is left open; the cause carries the text the learner can act on.
  assert.equal(
    started.record.error?.causeDetail,
    'Error: Set Codebook: Saved Study Limit (codebook.savedStudyLimit) to an integer from 1 to 256. Existing learning was kept.',
  )
  assert.equal(started.record.prepared, false)
  assert.equal(started.runtimeAcquisitions(), 0)
  assert.equal(started.harness.mouse.length, 0)
  assert.equal((await started.store.list()).length, 0)
  assert.deepEqual(
    await studyFiles(started.directory),
    started.libraryFilesBefore,
  )
  assert.equal(started.libraryFilesBefore.length, 2)
})

// Value: protects=a run stopped while its study-library admission is read acquires no runtime, reserves no recording and sends no input; fails_when=the stop check after the admission read is dropped, so a run already stopped goes on to acquire its runtime; why_new=no test stops a run with a recording store attached before its runtime is acquired; seam=none
test('a run stopped while its study library admission is being read acquires no runtime and reserves no recording', async (context) => {
  // Arrange / Act: the library has room; the stop arrives while the admission read is pending.
  let admissionReads = 0,
    stopped: Promise<unknown> = Promise.resolve()
  const started = await startRunWithStorage(
    context,
    2,
    'nothing',
    ({ service, store }) => {
      const admitsStudy = store.admitsStudy.bind(store)
      store.admitsStudy = (studyId) => {
        admissionReads++
        const admission = admitsStudy(studyId)
        const [record] = service.records.values()
        stopped = service.stop({
          instanceId: service.instanceId,
          runId: record!.id,
        })
        return admission
      }
    },
  )
  await stopped
  // Assert
  assert.equal(admissionReads, 1)
  assert.equal(started.record.error, undefined)
  assert.equal(started.record.prepared, false)
  assert.equal(started.record.stopped, true)
  assert.equal(started.runtimeAcquisitions(), 0)
  assert.equal(started.harness.mouse.length, 0)
  assert.equal((await started.store.list()).length, 0)
})
