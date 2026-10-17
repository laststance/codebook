import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { z } from 'zod'

import { StudyError } from '../errors'
import { LearningLibrary } from '../learningLibrary'
import { RecordingStore } from '../recordingStore'
import { RepositoryBookStore } from '../repositoryBook'
import { readResource } from '../resources'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { StudyService } from '../service'
import { createRecordingObserver } from '../utils/createRecordingObserver'
import { systemTrashName } from '../utils/systemTrashName'

import { configuredRuntimeHarness } from './utils/configuredRuntimeHarness'
import { createConfiguredStudy } from './utils/createConfiguredStudy'

// The product names the system Trash the way the host's operating system does; the expected texts follow it, so the suite also holds on Windows ("Recycle Bin").
const TRASH = systemTrashName()

/**
 * Starts one configured run through the real service with a study library and a recording store that share a directory and a limit; the runtime and its application are the controlled harness.
 * @param context - The test whose teardown shuts the service down.
 * @param limit - The Saved Study Limit both stores read.
 * @param fill - Which store already holds one entry before the run starts.
 * @param arrangeBeforeStart - Arranges a condition that holds only once the run starts, after the stores are filled: it may replace the limit setting or act on the service and its store.
 * @param remoteName - `vscode.env.remoteName` of the window the service runs in; `wsl` models a WSL remote window, which has no Trash.
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
  remoteName?: string,
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
      remoteName,
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

/**
 * Starts one more configured run on a service whose earlier run has ended, and waits until this one has ended too; used to fill the service's retained runs with refused ones.
 * @param started - The service and its controlled application from {@link startRunWithStorage}.
 * @param key - The start key of the new run.
 * @example const second = await startEndedRun(started, 'run-2')
 */
async function startEndedRun(
  started: Awaited<ReturnType<typeof startRunWithStorage>>,
  key: string,
) {
  const receipt = started.service.start({
    instanceId: started.service.instanceId,
    profile: 'repository-browser',
    key,
    configuration: started.harness.definition.configuration,
  })
  const record = started.service.record(receipt)
  await record.preparation
  await waitUntil(() => record.stopped, `the end of run ${key}`)
  return { receipt, record }
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
    'Study library is full. Increase Codebook: Saved Study Limit (codebook.savedStudyLimit) in Settings, or delete a saved study from Saved studies in the Study workspace, before starting another run. Only the learner can do either; an editor agent cannot. Existing learning was kept.',
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

// Value: protects=an agent telling the saved-study limit from the fixed slot ceiling and seeing how full the library is; fails_when=codebook_status shows limits.slots 256 beside capacity.limit with no count and no word on which one admits a study; why_new=Cycle 0037 N6c (the agent read 256 and 64 as one limit); seam=none
test('codebook_status reports how many studies are saved beside the current limit and says that the 256 is only the highest limit', async (context) => {
  // Arrange: the library holds one study under a limit of two.
  const started = await startRunWithStorage(context, 2, 'study')

  // Act
  const recording = (await started.service.status()).recording

  // Assert
  assert.equal(recording?.capacity.savedStudies, 1)
  assert.equal(recording?.capacity.limit, 2)
  assert.equal(recording?.capacity.maximum, 256)
  assert.equal(recording?.limits.slots, 256)
  assert.equal(
    recording?.capacity.fields,
    'limit is the current Saved Study Limit setting: a new study is admitted while savedStudies (the studies saved now) is below it. maximum, like limits.slots, is the highest value that setting accepts, not the current limit.',
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
    'Recording unavailable before input: Error: Recording library is full. Increase Codebook: Saved Study Limit (codebook.savedStudyLimit) in Settings, or delete a saved study that has a recording from Saved studies in the Study workspace, before starting another session. Existing recordings were kept.',
  )
})

// Value: protects=a run under an invalid Saved Study Limit setting ends as a prerequisite the learner can fix, before a runtime exists or input is sent; fails_when=the invalid setting is read as admitted, or it ends the run as a runtime failure whose message names no setting; why_new=the admission tests start runs under a valid limit only, where the read answers and never throws; seam=none
test('a run started under an invalid Saved Study Limit setting ends as a missing prerequisite that names the setting, before the application receives any input', async (context) => {
  // Arrange / Act: one study was saved under a limit of one; the setting holds 0 when the run starts.
  const started = await startRunWithStorage(
    context,
    1,
    'study',
    ({ changeLimitSetting }) => changeLimitSetting(0),
  )
  // Assert
  assert.equal(started.record.error?.code, 'PREREQUISITE_MISSING')
  assert.equal(
    started.record.error?.message,
    'Set Codebook: Saved Study Limit (codebook.savedStudyLimit) to an integer from 1 to 256. Existing learning was kept.',
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
      store.admitsStudy = async (studyId) => {
        admissionReads++
        const admission = admitsStudy(studyId)
        // The admission is read before start() returns, where no caller can stop the run yet; the stop arrives one turn later.
        await new Promise((resolve) => setTimeout(resolve, 0))
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

// Value: protects=a run the full library refuses is never captured for a later save, so it cannot take the room a learner frees; fails_when=a record is a checkpoint candidate before its admission answered or after it was refused; why_new=no test asks for a checkpoint while the admission read is pending; seam=none
test('a run the full study library refuses is never offered for a history checkpoint, also while its admission is still being read', async (context) => {
  // Arrange: the library holds one study under a limit of one; a reader refresh arrives while the admission is read.
  let checkpointWhileAwaitingAdmission: number | undefined | 'not asked' =
    'not asked'
  const started = await startRunWithStorage(
    context,
    1,
    'study',
    ({ service, store }) => {
      const admitsStudy = store.admitsStudy.bind(store)
      store.admitsStudy = async (studyId) => {
        await new Promise((resolve) => setTimeout(resolve, 0))
        const [record] = service.records.values()
        checkpointWhileAwaitingAdmission = service.beginHistory(
          record!,
          service.state(record!).materialSignature,
        )
        return admitsStudy(studyId)
      }
    },
  )
  // Act
  const checkpointAfterRefusal = started.service.beginHistory(
    started.record,
    started.service.state(started.record).materialSignature,
  )
  // Assert
  assert.equal(started.record.error?.code, 'PREREQUISITE_MISSING')
  assert.equal(checkpointWhileAwaitingAdmission, undefined)
  assert.equal(checkpointAfterRefusal, undefined)
})

// Value: protects=an editor agent that reads a refused run is told nothing was saved and why; fails_when=the run resource of a refused run gives no reason for its missing history; why_new=the state of a refused run was never asserted; seam=none
test('the run resource of a run refused on a full study library reports its history as unavailable because the run never started', async (context) => {
  // Arrange / Act
  const started = await startRunWithStorage(context, 1, 'study')
  const state = started.service.state(started.record)
  // Assert
  assert.equal(state.historyOutcome.status, 'unavailable')
  assert.equal(
    state.historyOutcome.reason,
    'The run was refused before it started; nothing was saved.',
  )
  assert.equal(state.historyOutcome.savedSignature, undefined)
  assert.equal(state.recording.status, 'unavailable')
  assert.equal(state.recording.contextStatus, 'unavailable')
})

// Value: protects=an agent reading the events or manifest of a refused run gets the answers it got before removals existed; fails_when=the removed-study refusal is widened to every run excluded from history; why_new=only a removed run's evidence resources were asserted; seam=none
test('the events and manifest resources of a run refused on a full study library answer as for a run that never started, not as evidence that was removed', async (context) => {
  // Arrange: the library holds one study under a limit of one, so the run is refused at its admission.
  const started = await startRunWithStorage(context, 1, 'study')
  const eventsUri = started.service.uri(started.record.id, 'events/0'),
    manifestUri = started.service.uri(started.record.id, 'manifest')
  // Act
  const events = await readResource(started.service, eventsUri)
  const manifest = readResource(started.service, manifestUri)
  // Assert
  assert.equal(started.record.historyExcluded, 'refused-at-admission')
  assert.ok('text' in events)
  assert.deepEqual(JSON.parse(events.text), {
    events: [],
    afterSequence: 0,
    lastSequence: 0,
  })
  await assert.rejects(
    manifest,
    (error) =>
      error instanceof StudyError &&
      error.code === 'EVIDENCE_UNAVAILABLE' &&
      error.message ===
        'The run has not frozen its source and scenario manifest.',
  )
})

// Value: protects=a library that cannot be read ends the run as a failure that is still saved as not demonstrated; fails_when=every error of the admission read is treated as a refusal and the failed run is dropped from history; why_new=the admission read was only tested with an answer or an invalid setting; seam=none
test('a run whose study library cannot be read ends as a missing prerequisite whose message names the read error, and is still offered for a history checkpoint', async (context) => {
  // Arrange / Act: the library read rejects for a reason that is neither a full library nor an invalid limit.
  const started = await startRunWithStorage(
    context,
    2,
    'study',
    ({ store }) => {
      store.admitsStudy = () =>
        Promise.reject(new Error('EACCES: permission denied, scandir'))
    },
  )
  const checkpoint = started.service.beginHistory(
    started.record,
    started.service.state(started.record).materialSignature,
  )
  // Assert
  assert.equal(started.record.error?.code, 'PREREQUISITE_MISSING')
  assert.equal(
    started.record.error?.message,
    'The study library could not be read, so no run was started: EACCES: permission denied, scandir. Repair or remove the entry it names in the learning library, then start again. Existing learning was kept.',
  )
  assert.equal(
    started.record.error?.causeDetail,
    'Error: EACCES: permission denied, scandir',
  )
  assert.equal(started.runtimeAcquisitions(), 0)
  assert.equal(checkpoint, 1)
})

// Value: protects=a run that fails a prerequisite before the study library is asked ends as an ordinary failed run the reader still saves, not as one left waiting for its admission; fails_when=the exclusion a configured run starts with is not lifted when preparation fails before the admission answers, so the run is never saved and never gives up its retained slot; why_new=the failed preparations tested with a recording store attached fail at the admission read or after it; seam=none
test('a run whose repository storage is unavailable ends as a missing prerequisite and is still offered for a history checkpoint', async (context) => {
  // Arrange / Act: the library has room; the repository store is gone when the run starts, which preparation checks before it asks the library.
  const started = await startRunWithStorage(
    context,
    2,
    'study',
    ({ service }) => {
      service.repository = undefined
    },
  )
  const checkpoint = started.service.beginHistory(
    started.record,
    started.service.state(started.record).materialSignature,
  )
  // Assert
  assert.equal(started.record.error?.code, 'PREREQUISITE_MISSING')
  assert.equal(
    started.record.error?.message,
    'Repository source/book storage is unavailable in this editor.',
  )
  assert.equal(started.record.prepared, false)
  assert.equal(started.runtimeAcquisitions(), 0)
  assert.equal(checkpoint, 1)
})

// Value: protects=refusals on a full library never use up the sixteen runs an editor instance retains; fails_when=a refused run keeps its slot, so the seventeenth start is refused for the bound; why_new=the retained-run bound had no test; seam=none
test('after sixteen runs refused on a full study library a further start is accepted and the oldest refused run is forgotten', async (context) => {
  // Arrange: the first refused run comes from the harness; fifteen more follow on the same full library.
  const started = await startRunWithStorage(context, 1, 'study')
  await waitUntil(() => started.record.stopped, 'the end of the first run')
  for (let run = 2; run <= 16; run++) await startEndedRun(started, `run-${run}`)
  assert.equal(started.service.records.size, 16)
  // Act
  const seventeenth = await startEndedRun(started, 'run-17')
  // Assert
  assert.equal(seventeenth.record.error?.code, 'PREREQUISITE_MISSING')
  assert.equal(started.service.records.size, 16)
  assert.equal(started.service.records.has(started.record.id), false)
  assert.equal(started.service.records.has(seventeenth.record.id), true)
  assert.throws(
    () => started.service.record(started.receipt),
    (error) => error instanceof StudyError && error.code === 'NOT_FOUND',
  )
})

// Value: protects=a start key of a forgotten refused run starts a fresh run instead of replaying a receipt nobody can read; fails_when=eviction forgets the record but keeps its start key; why_new=eviction is new; seam=none
test('a start that reuses the key of a forgotten refused run begins a new run', async (context) => {
  // Arrange: sixteen refused runs, then one more start forgets the first run, whose key was "admission".
  const started = await startRunWithStorage(context, 1, 'study')
  await waitUntil(() => started.record.stopped, 'the end of the first run')
  for (let run = 2; run <= 17; run++) await startEndedRun(started, `run-${run}`)
  // Act
  const reused = await startEndedRun(started, 'admission')
  // Assert
  assert.notEqual(reused.receipt.runId, started.receipt.runId)
  assert.equal(started.service.records.has(reused.record.id), true)
  assert.equal(started.service.records.size, 16)
})

// Value: protects=after the learner made room, the agent's identical start runs instead of returning the refusal again; fails_when=a refused run keeps its start key, so the same start replays the refused receipt forever; why_new=a refused run was forgotten only at the sixteen-run bound; seam=none
test('a start that repeats the key of a run the full study library refused begins a new run, which prepares once the library has room', async (context) => {
  // Arrange: a run refused on a library full at one study; afterwards the limit is raised to two.
  let raiseLimit = (): void => {}
  const started = await startRunWithStorage(
    context,
    1,
    'study',
    ({ changeLimitSetting }) => {
      raiseLimit = (): void => changeLimitSetting(2)
    },
  )
  await waitUntil(() => started.record.stopped, 'the end of the refused run')
  raiseLimit()
  // Act: the same key and the same arguments.
  const repeated = started.service.start({
    instanceId: started.service.instanceId,
    profile: 'repository-browser',
    key: 'admission',
    configuration: started.harness.definition.configuration,
  })
  const repeatedRecord = started.service.record(repeated)
  await repeatedRecord.preparation
  // Assert
  assert.notEqual(repeated.runId, started.receipt.runId)
  assert.equal(repeatedRecord.error, undefined)
  assert.equal(repeatedRecord.prepared, true)
  assert.equal(started.runtimeAcquisitions(), 1)
  assert.equal(started.service.records.size, 1)
  assert.throws(
    () => started.service.record(started.receipt),
    (error) => error instanceof StudyError && error.code === 'NOT_FOUND',
  )
})

// Value: protects=repeating a refused start on a library that is still full gives a fresh refusal and never piles up retained runs; fails_when=the repeated start keeps the old record beside the new one; why_new=forgetting a refused run on a repeated start is new; seam=none
test('a start that repeats the key of a refused run on a library that is still full is refused again as a new run and retains one run', async (context) => {
  // Arrange
  const started = await startRunWithStorage(context, 1, 'study')
  await waitUntil(() => started.record.stopped, 'the end of the refused run')
  // Act
  const repeated = await startEndedRun(started, 'admission')
  // Assert
  assert.notEqual(repeated.receipt.runId, started.receipt.runId)
  assert.equal(repeated.record.error?.code, 'PREREQUISITE_MISSING')
  assert.equal(repeated.record.historyExcluded, 'refused-at-admission')
  assert.equal(started.service.records.size, 1)
  assert.equal(started.runtimeAcquisitions(), 0)
})

// Value: protects=a refused run never ran, so its key is free for a corrected request; fails_when=the refused record still owns the key and other arguments are answered as a conflict; why_new=forgetting a refused run on a repeated start is new; seam=none
test('a start that reuses the key of a refused run with other arguments begins a new run instead of a conflict', async (context) => {
  // Arrange
  const started = await startRunWithStorage(context, 1, 'study')
  await waitUntil(() => started.record.stopped, 'the end of the refused run')
  const configuration = started.harness.definition.configuration
  // Act: the same key with another action title.
  const receipt = started.service.start({
    instanceId: started.service.instanceId,
    profile: 'repository-browser',
    key: 'admission',
    configuration: {
      ...configuration,
      action: { ...configuration.action, title: 'Change theme again' },
    },
  })
  const record = started.service.record(receipt)
  await record.preparation
  // Assert: a new run that the still-full library refuses, not IDEMPOTENCY_CONFLICT.
  assert.notEqual(receipt.runId, started.receipt.runId)
  assert.equal(record.error?.code, 'PREREQUISITE_MISSING')
  assert.equal(started.service.records.size, 1)
})

// Value: protects=a repeated start that is rejected for a live run leaves the refused run where it was; fails_when=the refused record is forgotten before the guards, so a rejected repeat leaves neither the old receipt nor a new run; why_new=the existing repeats are all accepted; seam=none
test('a repeat of a refused start that is rejected because another run is live keeps the refused run, and begins a new run once that run has stopped', async (context) => {
  // Arrange: a run refused under the key "admission"; the limit is raised and another run is admitted and still live.
  let raiseLimit = (): void => {}
  const started = await startRunWithStorage(
    context,
    1,
    'study',
    ({ changeLimitSetting }) => {
      raiseLimit = (): void => changeLimitSetting(3)
    },
  )
  await waitUntil(() => started.record.stopped, 'the end of the refused run')
  raiseLimit()
  const live = started.service.start({
    instanceId: started.service.instanceId,
    profile: 'repository-browser',
    key: 'live',
    configuration: started.harness.definition.configuration,
  })
  await started.service.record(live).preparation
  const repeat = {
    instanceId: started.service.instanceId,
    profile: 'repository-browser' as const,
    key: 'admission',
    configuration: started.harness.definition.configuration,
  }
  // Act
  let rejection: unknown
  try {
    started.service.start(repeat)
  } catch (error) {
    rejection = error
  }
  const retainedAfterRejection = started.service.records.has(started.record.id)
  const refusedReceiptStillRead =
    started.service.record(started.receipt).id === started.record.id
  await started.service.stop(live)
  const accepted = started.service.start(repeat)
  await started.service.record(accepted).preparation
  // Assert
  assert.equal(rejection instanceof StudyError && rejection.code, 'BUSY')
  assert.equal(retainedAfterRejection, true)
  assert.equal(refusedReceiptStillRead, true)
  assert.notEqual(accepted.runId, started.receipt.runId)
  assert.equal(started.service.records.has(started.record.id), false)
  assert.equal(started.service.record(accepted).error, undefined)
})

// Value: protects=a repeated start refused while the reader changes its presentation leaves the refused run where it was; fails_when=the refused record is forgotten before the presentation guard; why_new=no start test had a presentation controller that rejects; seam=the service's presentation controller, set as the extension sets it
test('a repeat of a refused start that is rejected while a presentation change is pending keeps the refused run', async (context) => {
  // Arrange: a run refused under the key "admission"; the reader then reports a pending presentation change.
  const started = await startRunWithStorage(context, 1, 'study')
  await waitUntil(() => started.record.stopped, 'the end of the refused run')
  const pending = (): never => {
    throw new StudyError(
      'PRESENTATION_UNAVAILABLE',
      'A presentation change or reader close is pending. Read its state before another control.',
    )
  }
  started.service.presentationController = {
    presentationState: pending,
    readPresentationState: pending,
    changePresentation: pending,
    returnToCurrent: pending,
    assertPresentationIdle: pending,
    nodeHistoryLearningMaterialSaved: pending,
    replayControlAccepted: pending,
    markAgentRecordingOpen: pending,
  }
  // Act
  let rejection: unknown
  try {
    started.service.start({
      instanceId: started.service.instanceId,
      profile: 'repository-browser',
      key: 'admission',
      configuration: started.harness.definition.configuration,
    })
  } catch (error) {
    rejection = error
  }
  // Assert
  assert.equal(
    rejection instanceof StudyError && rejection.code,
    'PRESENTATION_UNAVAILABLE',
  )
  assert.equal(started.service.records.has(started.record.id), true)
  assert.equal(
    started.service.record(started.receipt).error?.code,
    'PREREQUISITE_MISSING',
  )
})

// Value: protects=a repeated start with a profile the service does not know leaves the refused run where it was; fails_when=the refused record is forgotten before the profile guard; why_new=the existing repeats use a supported profile; seam=none
test('a repeat of a refused start that names an unsupported profile is rejected and keeps the refused run', async (context) => {
  // Arrange
  const started = await startRunWithStorage(context, 1, 'study')
  await waitUntil(() => started.record.stopped, 'the end of the refused run')
  // Act
  let rejection: unknown
  try {
    started.service.start({
      instanceId: started.service.instanceId,
      profile: 'unknown-profile',
      key: 'admission',
      configuration: started.harness.definition.configuration,
    })
  } catch (error) {
    rejection = error
  }
  // Assert
  assert.equal(
    rejection instanceof StudyError && rejection.code,
    'UNSUPPORTED_PROFILE',
  )
  assert.equal(started.service.records.has(started.record.id), true)
  assert.equal(
    started.service.record(started.receipt).error?.code,
    'PREREQUISITE_MISSING',
  )
})

// Value: protects=a repeated start whose arguments do not parse leaves the refused run where it was; fails_when=the refused record is forgotten before the arguments are checked; why_new=the existing repeats pass valid arguments; seam=none
test('a repeat of a refused start whose arguments do not match the profile is rejected and keeps the refused run', async (context) => {
  // Arrange
  const started = await startRunWithStorage(context, 1, 'study')
  await waitUntil(() => started.record.stopped, 'the end of the refused run')
  // Act: the same key and profile without a configuration.
  let rejection: unknown
  try {
    started.service.start({
      instanceId: started.service.instanceId,
      profile: 'repository-browser',
      key: 'admission',
    })
  } catch (error) {
    rejection = error
  }
  // Assert: a refused run's key is free, so the answer is the arguments' own error and not a conflict.
  assert.equal(
    rejection instanceof StudyError && rejection.code,
    'INVALID_CONFIGURATION',
  )
  assert.equal(started.service.records.has(started.record.id), true)
  assert.equal(
    started.service.record(started.receipt).error?.code,
    'PREREQUISITE_MISSING',
  )
})

// Value: protects=repeating the newest refused start with every retained slot taken uses that refusal's own slot; fails_when=the repeat evicts the oldest run instead, or is refused for the bound; why_new=the repeat and the bound were only tested apart; seam=none
test("a repeat of the newest refused start with sixteen runs retained takes that run's slot and keeps the oldest run", async (context) => {
  // Arrange: sixteen refused runs on a full library; the last one has the key "run-16".
  const started = await startRunWithStorage(context, 1, 'study')
  await waitUntil(() => started.record.stopped, 'the end of the first run')
  let sixteenth = { record: started.record }
  for (let run = 2; run <= 16; run++)
    sixteenth = await startEndedRun(started, `run-${run}`)
  // Act
  const repeated = await startEndedRun(started, 'run-16')
  // Assert
  assert.notEqual(repeated.record.id, sixteenth.record.id)
  assert.equal(started.service.records.size, 16)
  assert.equal(started.service.records.has(sixteenth.record.id), false)
  assert.equal(started.service.records.has(started.record.id), true)
})

// Value: protects=a start repeated because its response was lost still returns the one run while that run is being refused; fails_when=a refused run is forgotten before it has ended, so two runs exist for one key during cleanup, or a start still waiting for its admission is restarted; why_new=forgetting a refused run on a repeated start is new; seam=a held source reveal keeps the refused run from ending
test('a start repeated while its run awaits the admission, and while the refused run is still ending, returns the same receipt', async (context) => {
  // Arrange: the repeated start arrives during the admission read; a held reveal keeps the refused run stopping.
  let receiptWhileAwaiting: unknown = 'not asked',
    releaseStop = (): void => {}
  const heldUntilReleased = new Promise<void>((resolve) => {
    releaseStop = resolve
  })
  const started = await startRunWithStorage(
    context,
    1,
    'study',
    ({ service, store }) => {
      const admitsStudy = store.admitsStudy.bind(store)
      store.admitsStudy = async (studyId) => {
        await new Promise((resolve) => setTimeout(resolve, 0))
        const [record] = service.records.values()
        record!.sourceReveals.add(heldUntilReleased)
        if (record!.profile === 'repository-browser')
          receiptWhileAwaiting = service.start({
            instanceId: service.instanceId,
            profile: 'repository-browser',
            key: 'admission',
            configuration: record!.configuration,
          })
        return admitsStudy(studyId)
      }
    },
  )
  const input = {
    instanceId: started.service.instanceId,
    profile: 'repository-browser' as const,
    key: 'admission',
    configuration: started.harness.definition.configuration,
  }
  // Act
  const stoppedBeforeRepeat = started.record.stopped
  const receiptWhileEnding = started.service.start(input)
  releaseStop()
  await waitUntil(() => started.record.stopped, 'the end of the refused run')
  // Assert
  assert.equal(started.record.error?.code, 'PREREQUISITE_MISSING')
  assert.equal(stoppedBeforeRepeat, false)
  assert.deepEqual(receiptWhileAwaiting, started.receipt)
  assert.deepEqual(receiptWhileEnding, started.receipt)
  assert.equal(started.service.records.size, 1)
})

// Value: protects=a run that was admitted keeps answering a repeated start with its own receipt, also after its saved study was removed; fails_when=forgetting on a repeated start reaches runs that really ran; why_new=forgetting a refused run on a repeated start is new; seam=none
test('a start that repeats the key of an admitted run returns the same receipt, also after its saved study was removed', async (context) => {
  // Arrange: an admitted, stopped run.
  const started = await startRunWithStorage(context, 2, 'nothing')
  await started.service.stop(started.receipt)
  const input = {
    instanceId: started.service.instanceId,
    profile: 'repository-browser' as const,
    key: 'admission',
    configuration: started.harness.definition.configuration,
  }
  // Act
  const repeated = started.service.start(input)
  started.service.excludeHistory(started.record)
  const repeatedAfterRemoval = started.service.start(input)
  // Assert
  assert.deepEqual(repeated, started.receipt)
  assert.deepEqual(repeatedAfterRemoval, started.receipt)
  assert.equal(started.runtimeAcquisitions(), 1)
})

// Value: protects=an editor agent is never told that a study the learner removed is still saved; fails_when=the run resource keeps reading its old receipts after the removal; why_new=no run could lose its saved study before; seam=none
test('the run resource of a run whose saved study the learner removed reports its history and its recording as gone', async (context) => {
  // Arrange: an admitted run that recorded, was stopped and whose history the reader saved.
  const started = await startRunWithStorage(context, 2, 'nothing')
  await started.service.stop(started.receipt)
  const signature = started.service.state(started.record).materialSignature,
    revision = started.service.beginHistory(started.record, signature)!
  started.service.reportHistory(started.record, signature, revision, 'saved')
  assert.equal(
    started.service.state(started.record).historyOutcome.status,
    'saved',
  )
  // Act
  started.service.excludeHistory(started.record)
  // Assert
  const state = started.service.state(started.record)
  assert.equal(state.historyOutcome.status, 'unavailable')
  assert.equal(
    state.historyOutcome.reason,
    `The learner moved this saved study to the ${TRASH}.`,
  )
  assert.equal(state.historyOutcome.savedSignature, undefined)
  assert.equal(state.recording.status, 'failed')
  assert.equal(
    state.recording.reason,
    `The learner moved this saved study to the ${TRASH}.`,
  )
  assert.equal(state.recording.contextStatus, 'unavailable')
  assert.equal(
    started.service.beginHistory(started.record, state.materialSignature),
    undefined,
  )
})

// Value: protects=a run that fails a prerequisite before its admission on a full library is never written later, so Retry storage cannot take room the learner freed and no "History not saved" line appears; fails_when=the early failure clears the exclusion and leaves the run a checkpoint candidate (0038-F10); why_new=the early-failure test arranged a library with room; seam=none
test('a run whose repository storage is unavailable on a full study library is not offered for a history checkpoint', async (context) => {
  // Arrange / Act: the library is full at one study; the repository store is gone when the run starts.
  const started = await startRunWithStorage(
    context,
    1,
    'study',
    ({ service }) => {
      service.repository = undefined
    },
  )
  const checkpoint = started.service.beginHistory(
    started.record,
    started.service.state(started.record).materialSignature,
  )
  // Assert
  assert.equal(
    started.record.error?.message,
    'Repository source/book storage is unavailable in this editor.',
  )
  assert.equal(started.record.historyExcluded, 'refused-at-admission')
  assert.equal(checkpoint, undefined)
})

// Value: protects=an editor agent is not told to read the history of a run that the library refused; fails_when=the refused run's next actions still list `read-history` although its history is unavailable (0038-F17b, 0038-N7-c); why_new=next actions of a refused run were not asserted; seam=none
test('the next actions of a run refused on a full study library do not offer to read its history', async (context) => {
  // Arrange
  const started = await startRunWithStorage(context, 1, 'study')
  await waitUntil(() => started.record.stopped, 'the end of the refused run')
  // Act
  const state = started.service.state(started.record)
  // Assert
  assert.equal(state.historyOutcome.status, 'unavailable')
  assert.deepEqual(state.nextActions, [])
})

// Value: protects=after this editor's Trash refused a removal, a refusal of a full library names only the remedy that can work here; fails_when=the refusal keeps telling the learner to delete a saved study in an editor that cannot move one to the Trash (0038-F9); why_new=the delete remedy was named unconditionally; seam=the service's record of a removal that left its study in the library, which the reader makes
test('a run refused on a full study library after the Trash refused a removal names only the limit setting', async (context) => {
  // Arrange / Act: the reader has reported that the Trash refused a removal in this session.
  const started = await startRunWithStorage(
    context,
    1,
    'study',
    ({ service }) => {
      service.recordStudyRemoval(false)
    },
  )
  // Assert
  assert.equal(
    started.record.error?.message,
    `Study library is full. Increase Codebook: Saved Study Limit (codebook.savedStudyLimit) in Settings before starting another run; this editor could not move a saved study to the ${TRASH} in this session. Only the learner can change the setting; an editor agent cannot. Existing learning was kept.`,
  )
})

// Value: protects=in a WSL remote window, whose files the editor cannot move to a Trash, the learner and the agent are never told to delete a saved study, and at the maximum are told the way out that exists; fails_when=the service starts with removal available there, so the first refusal names a deletion that cannot work, or the sentences claim a failed attempt that never happened (RT-7, DX-20, ER-12); why_new=the removal availability started as available in every window; seam=the environment's remote name, as `vscode.env.remoteName` gives it
test('in a WSL remote window the first full-library refusal names no removal', async (context) => {
  // Arrange: a WSL remote window with a library full at one study; no removal was tried in this session.
  let changeLimit: (value: unknown) => void = () => {}
  const started = await startRunWithStorage(
    context,
    1,
    'study',
    ({ changeLimitSetting }) => {
      changeLimit = changeLimitSetting
    },
    'wsl',
  )
  await waitUntil(() => started.record.stopped, 'the end of the refused run')
  // Act: the library is filled to the maximum of 256 studies and a second run is started under that limit.
  for (let count = 1; count < 256; count++)
    await writeFile(
      join(started.directory, `${randomUUID()}_${randomUUID()}.study.v3.json`),
      '{}',
    )
  changeLimit(256)
  const atMaximum = await startEndedRun(started, 'at-the-maximum')
  // Assert
  assert.equal(
    started.record.error?.message,
    'Study library is full. Increase Codebook: Saved Study Limit (codebook.savedStudyLimit) in Settings before starting another run; this window has no Trash, so Codebook cannot delete a saved study here. Only the learner can change the setting; an editor agent cannot. Existing learning was kept.',
  )
  assert.equal(
    atMaximum.record.error?.message,
    'Study library is full at its maximum of 256 saved studies, and this window has no Trash, so Codebook cannot delete a saved study here. Only the learner can make room: choose a study in Saved studies and open Remove by hand to list its files, then remove them by hand; an editor agent never deletes files. Existing learning was kept.',
  )
})

// Value: protects=an agent that publishes a Repository Wiki revision whose link names a deleted saved study is told which study is gone; fails_when=the publish fails with the library's bare "Study archive is unavailable." (0038-F18); why_new=no publish linked a study the library no longer holds; seam=none
test('publishing a Repository Wiki revision that links a saved study the library no longer holds is refused as an unavailable book that names that study', async (context) => {
  // Arrange: a published article; its next revision links an observation of a study that is not in the library.
  const started = await startRunWithStorage(context, 2, 'nothing')
  const removedStudyId =
    '33333333-3333-4333-8333-333333333333_44444444-4444-4444-8444-444444444444'
  // Act
  const publish = started.service.repository!.publish({
    bookId: 'interface',
    expectedRevision: 1,
    key: 'links-removed-study',
    document: {
      title: 'Interface',
      summary: 'Two citations.',
      nodes: [
        {
          id: 'theme',
          title: 'Theme',
          sections: [{ title: 'Theme', text: 'Source-derived explanation.' }],
          anchors: started.harness.definition.descriptor.anchors,
          observations: [
            {
              studyId: removedStudyId,
              observationId: 'browser-session:1',
              sourceHash: 'a'.repeat(64),
            },
          ],
        },
      ],
      edges: [],
    },
  })
  // Assert
  await assert.rejects(
    publish,
    (error) =>
      error instanceof StudyError &&
      error.code === 'BOOK_UNAVAILABLE' &&
      error.message ===
        `Linked saved study ${removedStudyId} is no longer in the study library; it was deleted or never saved.`,
  )
})

// Value: protects=the learner's next run and Close Study Workspace after a run whose evidence failed for good (a full disk, its buffering limit, its evidence folder removed by hand): the release frees every resource and only the final evidence write fails, so the run is stopped with that failure as its error and terminal reason, and the next start is admitted; fails_when=the configured run's release throws on its final persistence after it released everything (ConfiguredBrowserRun.cleanupOwned), so StudyService.stopRecord never marks the run stopped, every retry fails the same way, codebook_start answers BUSY ("Another run still owns resources.") and Close keeps failing until the server restarts; why_new=R1, Cycle 0046 /ship red-team review; seam=the real ConfiguredBrowserRun behind the real service (configuredRuntimeHarness, startRunWithStorage), its evidence folder removed before the stop, StudyService.stop as codebook_stop calls it, the run resource and StudyService.start
test('a run whose final evidence write fails after its release freed every resource is stopped with that failure as its error, and the next start is admitted', async (context) => {
  // Arrange: a prepared run whose evidence folder is removed by hand, so every later write of its evidence fails.
  const started = await startRunWithStorage(context, 4, 'nothing')
  const evidenceDirectory = started.record.runtime!.evidence.directory
  await rm(evidenceDirectory, { recursive: true, force: true })

  // Act: the agent stops the run, then starts the next one.
  const stopFailure = await started.service.stop(started.receipt).then(
    () => undefined,
    (error: unknown) => String(error),
  )
  const resource = await readResource(started.service, started.receipt.runUri)
  let nextStartRefusal: unknown
  try {
    const next = started.service.start({
      instanceId: started.service.instanceId,
      profile: 'repository-browser',
      key: 'after-failed-persistence',
      configuration: started.harness.definition.configuration,
    })
    await started.service.record(next).preparation
  } catch (error) {
    nextStartRefusal = error
  }

  // Assert: the terminal reason and the error's cause with the evidence folder's path replaced, which the system's error names.
  const withoutPath = (text: string): string =>
    text.replace(evidenceDirectory, '<evidence directory>')
  assert.ok('text' in resource)
  const state = z
    .object({
      state: z.string(),
      terminalReason: z.string(),
      error: z.object({
        code: z.string(),
        message: z.string(),
        cause: z.string(),
      }),
    })
    .parse(JSON.parse(resource.text))
  assert.deepEqual(
    {
      stopFailure,
      stopped: started.record.stopped,
      cleanupError: started.record.cleanupError,
      state: state.state,
      terminalReason: withoutPath(state.terminalReason),
      error: {
        code: state.error.code,
        message: state.error.message,
        cause: withoutPath(state.error.cause),
      },
      nextStartRefusal,
    },
    {
      stopFailure: undefined,
      stopped: true,
      cleanupError: undefined,
      state: 'stopped',
      terminalReason:
        "Error: ENOENT: no such file or directory, open '<evidence directory>/events.jsonl'",
      error: {
        code: 'RUNTIME_FAILED',
        message: 'The run failed in its runtime.',
        cause:
          "Final evidence persistence failed: Error: Evidence write failed: Error: ENOENT: no such file or directory, open '<evidence directory>/events.jsonl'",
      },
      nextStartRefusal: undefined,
    },
  )
})
